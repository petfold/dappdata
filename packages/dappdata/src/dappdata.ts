// The connected instance: one folder, one app, one user (D14, D16).
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { deriveFolderKeys, deriveSeed, deriveSubKey } from "./derive/kdf.js";
import type { EntropySource } from "./entropy/types.js";
import { importKey, open, seal } from "./envelope/index.js";
import type { Opened } from "./envelope/index.js";
import { SequentialFeed } from "./feed/index.js";
import { Slot, type SlotOptions } from "./slot/index.js";
import {
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
   * A stamper for this batch (D12, D19). The SDK signs stamps with the key
   * that owns the batch — the derived storage key — so any node will take the
   * write, and it keeps the bucket state in a reserved slot so a new device
   * never reuses a slot that the old one may have spent (D4, T12).
   *
   * Other libraries that write on the user's behalf take this object rather
   * than a batch id, so one device keeps one account of the batch.
   */
  async stamper(
    batchId: string,
    options: { depth: number; block?: number | undefined },
  ): Promise<Stamper> {
    // A reserved slot name: the leading dot is not something a dapp would
    // choose, and the batch id keeps two batches apart.
    const slot = this.slot<StamperStateWire>(`.stamper/${batchId}`, { schema: 1 });
    const store: CheckpointStore = {
      async load() {
        const checkpoint = await slot.get();
        return checkpoint === null ? null : decodeState(checkpoint.value);
      },
      async save(state) {
        const current = await slot.get();
        await slot.set(encodeState(state), { expectIndex: current?.index });
      },
    };
    return createStamper({
      signer: this.#feedKey,
      batchId,
      depth: options.depth,
      store,
      block: options.block,
    });
  }

  /** The folder's encryption, for bytes the dapp keeps somewhere else (D20). */
  encrypt(bytes: Uint8Array, aad: string): Promise<Uint8Array> {
    return seal(this.#encKey, bytes, { aad });
  }

  decrypt(frame: Uint8Array, aad: string): Promise<Opened> {
    return open(this.#encKey, frame, aad);
  }
}
