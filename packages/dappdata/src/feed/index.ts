// One sequential feed, with the index cache S2 made compulsory (D5).
//
// Bee's own lookup costs 2–5 s in every environment measured; a read by known
// index costs 10–300 ms. So the feed remembers where it got to, reads by
// index, and falls back to the lookup only when it has nothing to start from.
import { ConflictError } from "../errors.js";
import type { FeedUpdate, Transport } from "../transport/types.js";

/** How far the feed walks forward from a cached index before asking Bee. */
const WALK_LIMIT = 16;

/** Cached state for "the lookup says this feed is still empty". */
const EMPTY = -1n;

export interface FeedOptions {
  transport: Transport;
  owner: string;
  topic: Uint8Array;
  /** Present when this device may write. */
  signer?: Uint8Array | undefined;
}

export class SequentialFeed {
  readonly owner: string;
  readonly topic: Uint8Array;

  #transport: Transport;
  #signer: Uint8Array | undefined;
  #index: bigint | null = null;
  #lastWritten: FeedUpdate | null = null;

  constructor(options: FeedOptions) {
    this.#transport = options.transport;
    this.owner = options.owner;
    this.topic = options.topic;
    this.#signer = options.signer;
  }

  /** The last index this feed knows about, or null before the first read. */
  get knownIndex(): bigint | null {
    return this.#index === null || this.#index === EMPTY ? null : this.#index;
  }

  /** Seed the cache from somewhere else, such as another slot's metadata (D5). */
  hint(index: bigint): void {
    if (this.#index === null || this.#index === EMPTY || index > this.#index) this.#index = index;
  }

  async at(index: bigint): Promise<Uint8Array | null> {
    return this.#transport.getFeedUpdate({ owner: this.owner, topic: this.topic, index });
  }

  /**
   * The newest update. Warm, this is one read by index plus one probe; cold,
   * it is Bee's lookup once and then never again for this feed — including
   * when the answer is "empty", because the next write goes to index 0.
   *
   * A write this device just made is served from memory: a chunk takes about
   * a second to become readable on the node that accepted it (measured on
   * bee-factory, 2026-09-21), and a dapp that renders after `set` should not
   * see the state it just wrote disappear.
   */
  async latest(): Promise<FeedUpdate | null> {
    const fromNetwork = await this.#latestFromNetwork();
    const mine = this.#lastWritten;
    if (mine && (fromNetwork === null || fromNetwork.index < mine.index)) return mine;
    return fromNetwork;
  }

  async #latestFromNetwork(): Promise<FeedUpdate | null> {
    if (this.#index === null) return this.#lookup();

    let index = this.#index;
    let payload: Uint8Array | null = null;

    if (index !== EMPTY) {
      payload = await this.at(index);
      if (payload === null) return this.#lookup(); // the cache was wrong
    }

    for (let step = 0; step < WALK_LIMIT; step++) {
      const ahead = await this.at(index + 1n);
      if (ahead === null) break;
      index += 1n;
      payload = ahead;
      if (step === WALK_LIMIT - 1) return this.#lookup(); // a long way behind
    }

    if (payload === null) {
      this.#index = EMPTY;
      return null;
    }
    this.#index = index;
    return { index, payload };
  }

  /**
   * Append one update. `expectIndex` is the index the caller read; the write
   * fails with a `ConflictError` when another device got there first (D6).
   *
   * The check is honest but not airtight. Bee answers a read for a chunk it
   * cannot find and one that does not exist the same way (500 "read chunk
   * failed"), and a write takes about a second to become readable, so a
   * foreign write inside that window is invisible to any client. `merge`
   * resolves what this catches; the window itself belongs to D6 and D19.
   */
  async append(
    payload: Uint8Array,
    options: { stamp: string; expectIndex?: bigint | undefined },
  ): Promise<bigint> {
    const signer = this.#signer;
    if (!signer) throw new Error("this feed is read-only: no signing key");

    let index: bigint;
    if (options.expectIndex === undefined) {
      const head = await this.latest();
      index = head === null ? 0n : head.index + 1n;
    } else {
      index = options.expectIndex + 1n;
    }

    const taken = await this.at(index);
    if (taken !== null) throw new ConflictError(index, taken);

    await this.#transport.putFeedUpdate({
      signer,
      topic: this.topic,
      index,
      payload,
      stamp: options.stamp,
    });
    this.#index = index;
    this.#lastWritten = { index, payload };
    return index;
  }

  async #lookup(): Promise<FeedUpdate | null> {
    const update = await this.#transport.findLatest({ owner: this.owner, topic: this.topic });
    this.#index = update ? update.index : EMPTY;
    return update;
  }
}
