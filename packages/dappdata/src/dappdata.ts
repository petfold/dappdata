// The connected instance: one folder, one app, one user (D14, D16).
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { deriveFolderKeys, deriveSeed, deriveSubKey } from "./derive/kdf.js";
import type { Eip1193Provider, EntropySource } from "./entropy/types.js";
import {
  type ChainConfig,
  type FundOptions,
  type Funding,
  funding,
} from "./funding/index.js";
import { importKey, open, seal } from "./envelope/index.js";
import type { Opened } from "./envelope/index.js";
import { ConflictError, DappDataError } from "./errors.js";
import { feedChunkAddress } from "./feed/address.js";
import { SequentialFeed } from "./feed/index.js";
import { Slot, type SlotOptions } from "./slot/index.js";
import {
  CheckpointConflictError,
  type CheckpointStore,
  type Stamper,
  type StamperStateWire,
  createStamper,
  decodeState,
  encodeState,
} from "./stamper/index.js";
import type { Stamp, Transport } from "./transport/types.js";

const utf8 = new TextEncoder();

export interface AppIdentity {
  /**
   * What the key binds to (D16): the browser origin by default, or a stable
   * identity — an ENS name, or the owner of the app's release feed — for a
   * dapp served from a Swarm gateway, where the origin belongs to the gateway.
   */
  id: string;
}

export interface ConnectOptions {
  entropy: EntropySource;
  app: AppIdentity;
  transport: Transport;
  /**
   * A postage batch the node can stamp writes with. Phase 1 takes it from the
   * caller; `funding.fund()` arrives in Phase 2 (D3, D23).
   */
  stamp?: Stamp | undefined;
}

/** topic = keccak256("dappdata/v1/" + app + "/" + slot) (D16, D7). */
export function slotTopic(app: string, name: string): Uint8Array {
  return keccak_256(utf8.encode(`dappdata/v1/${app}/${name}`));
}

export class DappData {
  /** The app identity the keys are bound to. */
  readonly app: string;
  /** The address that owns the user's feeds; a reader needs only this. */
  readonly address: string;
  /** The wallet account behind it, when the entropy source had one. */
  readonly account: string | undefined;

  #seed: Uint8Array;
  #feedKey: Uint8Array;
  #encKey: CryptoKey;
  #transport: Transport;
  #stamp: Stamp | undefined;
  #slots = new Map<string, Slot<unknown>>();

  private constructor(args: {
    app: string;
    seed: Uint8Array;
    feedKey: Uint8Array;
    feedAddress: string;
    encKey: CryptoKey;
    transport: Transport;
    stamp: Stamp | undefined;
    account: string | undefined;
  }) {
    this.app = args.app;
    this.address = args.feedAddress;
    this.account = args.account;
    this.#seed = args.seed;
    this.#feedKey = args.feedKey;
    this.#encKey = args.encKey;
    this.#transport = args.transport;
    this.#stamp = args.stamp;
  }

  /** One signature, one folder. Everything else hangs off this call. */
  static async connect(options: ConnectOptions): Promise<DappData> {
    const app = options.app.id;
    const { secret, account } = await options.entropy.secret({ app });
    const seed = deriveSeed(secret, app);
    const { feedKey, feedAddress, encKey } = deriveFolderKeys(seed);

    return new DappData({
      app,
      seed,
      feedKey,
      feedAddress,
      encKey: await importKey(encKey),
      transport: options.transport,
      stamp: options.stamp,
      account,
    });
  }

  /**
   * One named piece of state. The same name returns the same object, so the
   * feed index cache survives between reads (D5).
   */
  slot<T>(name: string, options: SlotOptions<T> = {}): Slot<T> {
    const existing = this.#slots.get(name);
    if (existing) return existing as Slot<T>;

    const topic = slotTopic(this.app, name);
    const slot = new Slot<T>(name, {
      feed: new SequentialFeed({
        transport: this.#transport,
        owner: this.address,
        topic,
        signer: this.#feedKey,
      }),
      transport: this.#transport,
      key: this.#encKey,
      aad: bytesToHex(topic),
      stamp: this.#stamp,
      options,
    });
    this.#slots.set(name, slot as Slot<unknown>);
    return slot;
  }

  /**
   * A key for another library (D17). It opens what that library writes and
   * nothing else: the folder keys hang off other contexts.
   */
  deriveKey(purpose: string): { key: Uint8Array; address: string } {
    return deriveSubKey(this.#seed, purpose);
  }

  /**
   * Funding, bound to this folder (D3, D12, D23). The owner of anything this
   * buys is the derived storage key, whoever signs the transaction: the user,
   * the dapp operator, a sponsor. One code path, and `topUp` needs no
   * permission from the owner at all.
   */
  funding(payer: Eip1193Provider, chain: ChainConfig, from?: string): Funding {
    const bound = funding({
      payer,
      chain,
      transport: this.#transport,
      ...(from === undefined ? {} : { from }),
    });
    return {
      ...bound,
      // The owner is this folder unless the caller insists otherwise.
      fund: (options: Partial<FundOptions> = {}) =>
        bound.fund({ owner: this.address, ...options }),
    };
  }

  /**
   * A stamper for this batch (D12, D19). The SDK signs stamps with the key
   * that owns the batch — the derived storage key — so any node will take the
   * write, and it keeps the bucket state in a reserved slot of this folder so
   * a new device never reuses a slot that the old one may have spent (D4, T12).
   *
   * The result is itself a `Stamp`: pass it to `connect`, `slot.set` or any
   * library that writes on the user's behalf, so one device keeps one account
   * of the batch.
   */
  async stamper(
    batchId: string,
    options: { depth: number; block?: number | undefined; store?: CheckpointStore | undefined },
  ): Promise<Stamper> {
    // The default store's own writes are stamped by the stamper it checkpoints,
    // which needs the stamper to exist first; it is bound after creation and
    // only used from `save`, which nothing calls during creation.
    let stamper: Stamper | undefined;
    const store = options.store ?? this.#slotCheckpointStore(batchId, () => stamper);
    stamper = await createStamper({
      signer: this.#feedKey,
      batchId,
      depth: options.depth,
      store,
      block: options.block,
    });
    return stamper;
  }

  /**
   * The default checkpoint store: a reserved slot in the user's own folder,
   * so a new device finds the state with nothing but the signature.
   *
   * Its write is stamped by the stamper it checkpoints. That works because a
   * feed chunk's address depends on the topic and index, not the payload, so
   * the store can name the addresses its next write will need (`upcoming`)
   * and the stamper reserves them inside the checkpoint being written (D19
   * lookahead). And because the slot write carries `expectIndex`, a second
   * device publishing at the same moment is detected rather than overwritten,
   * and the stamper restarts from the winner's lines.
   */
  #slotCheckpointStore(batchId: string, stamper: () => Stamper | undefined): CheckpointStore {
    // A reserved slot name: the leading dot is not something a dapp would
    // choose, and the batch id keeps two batches apart.
    const name = `.stamper/${batchId}`;
    const slot = this.slot<StamperStateWire>(name, { schema: 1 });
    const topic = slotTopic(this.app, name);
    const owner = this.address;

    const head = async (): Promise<bigint | undefined> => (await slot.get())?.index;

    return {
      async load() {
        const checkpoint = await slot.get();
        return checkpoint === null ? null : decodeState(checkpoint.value);
      },

      async upcoming() {
        const current = await head();
        const next = current === undefined ? 0n : current + 1n;
        // The write about to happen, and the one after it: a checkpoint pays
        // for itself and for its successor.
        return [feedChunkAddress(owner, topic, next), feedChunkAddress(owner, topic, next + 1n)];
      },

      async save(state) {
        const stamp = stamper();
        if (!stamp) throw new DappDataError("unsupported", "the checkpoint store has no stamper yet");
        try {
          await slot.set(encodeState(state), { expectIndex: await head(), stamp });
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error;
          const winner = await slot.get();
          if (winner === null) throw error;
          throw new CheckpointConflictError(decodeState(winner.value));
        }
      },
    };
  }

  /** The folder's encryption, for bytes the dapp keeps somewhere else (D20). */
  encrypt(bytes: Uint8Array, aad: string): Promise<Uint8Array> {
    return seal(this.#encKey, bytes, { aad });
  }

  decrypt(frame: Uint8Array, aad: string): Promise<Opened> {
    return open(this.#encKey, frame, aad);
  }
}
