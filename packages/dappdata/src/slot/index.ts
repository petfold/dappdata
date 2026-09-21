// One named piece of state: get, set, watch (D6, D9, D22).
import { ConflictError, DappDataError } from "../errors.js";
import { Mode, open, seal } from "../envelope/index.js";
import type { SequentialFeed } from "../feed/index.js";
import type { Transport } from "../transport/types.js";
import { type Codec, jsonCodec } from "./codec.js";

export type { Codec } from "./codec.js";
export { bytesCodec, jsonCodec } from "./codec.js";

/** One chunk, less the frame and the GCM tag. Anything larger becomes a blob. */
export const MAX_INLINE_BYTES = 4096 - 4 - 12 - 16;

export interface SlotValue<T> {
  value: T;
  index: bigint;
  /** The schema the stored value was written with (D22). */
  schema: number;
}

export interface SlotOptions<T> {
  /** The dapp's version of this value's shape (D22). Default 0. */
  schema?: number | undefined;
  /** Called when the stored schema is older than `schema`. */
  migrate?: ((old: unknown, fromSchema: number) => T | Promise<T>) | undefined;
  codec?: Codec<T> | undefined;
  /** Overrides the instance-wide postage batch for this slot. */
  stamp?: string | undefined;
}

export interface SetOptions<T> {
  /**
   * The index `get` returned, so the write fails when the feed has moved (D6).
   * `set(value, { expectIndex: current?.index })` is the intended call, and
   * `undefined` means "append to whatever the head is".
   */
  expectIndex?: bigint | undefined;
  /** Resolve a conflict instead of throwing it (D6). */
  merge?: ((local: T, remote: SlotValue<T>) => T | Promise<T>) | undefined;
  stamp?: string | undefined;
}

export interface WatchOptions {
  /** First poll delay, in ms. Doubles up to `maxIntervalMs` while nothing changes. */
  intervalMs?: number | undefined;
  maxIntervalMs?: number | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

export interface SlotContext<T> {
  feed: SequentialFeed;
  transport: Transport;
  key: CryptoKey;
  /** The AAD: the slot's topic, so a payload cannot be replayed elsewhere (D9). */
  aad: string;
  stamp: string | undefined;
  options: SlotOptions<T>;
}

export class Slot<T> {
  readonly name: string;

  #ctx: SlotContext<T>;
  #codec: Codec<T>;

  constructor(name: string, ctx: SlotContext<T>) {
    this.name = name;
    this.#ctx = ctx;
    this.#codec = ctx.options.codec ?? jsonCodec<T>();
  }

  /** The newest value, or null when nothing has been written yet. */
  async get(): Promise<SlotValue<T> | null> {
    const update = await this.#ctx.feed.latest();
    if (update === null) return null;

    const opened = await open(this.#ctx.key, update.payload, this.#ctx.aad);
    const raw =
      opened.mode === Mode.REF
        ? await this.#ctx.transport.getBlob(new TextDecoder().decode(opened.value))
        : opened.value;

    let value = this.#codec.decode(raw);
    const want = this.#ctx.options.schema ?? 0;
    if (opened.schema !== want) {
      const migrate = this.#ctx.options.migrate;
      if (!migrate) {
        // Two devices run two versions of a dapp for a while (D22), so say
        // which way round it is: an old shape needs a migrate callback, a
        // newer one means this copy of the dapp is behind.
        const direction =
          opened.schema > want
            ? `this copy of the dapp reads ${want} and is behind`
            : `this dapp reads ${want} and gave no migrate callback`;
        throw new DappDataError(
          "bad-envelope",
          `slot "${this.name}" holds schema ${opened.schema}: ${direction} (D22)`,
        );
      }
      value = await migrate(value, opened.schema);
    }
    return { value, index: update.index, schema: opened.schema };
  }

  /**
   * Write a new value. Resolves when the node accepts the upload; seeing it on
   * another device takes longer, and `watch` is how the dapp learns that (D5).
   */
  async set(value: T, options: SetOptions<T> = {}): Promise<{ index: bigint }> {
    const stamp = options.stamp ?? this.#ctx.options.stamp ?? this.#ctx.stamp;
    if (!stamp) {
      throw new DappDataError(
        "unsupported",
        "a write needs a postage batch; pass `stamp` to connect() or set() (funding lands in Phase 2)",
      );
    }

    try {
      const payload = await this.#frame(value, stamp);
      const index = await this.#ctx.feed.append(payload, {
        stamp,
        expectIndex: options.expectIndex,
      });
      return { index };
    } catch (error) {
      if (!(error instanceof ConflictError) || !options.merge) throw error;

      const opened = await open(this.#ctx.key, error.payload, this.#ctx.aad);
      const remoteRaw =
        opened.mode === Mode.REF
          ? await this.#ctx.transport.getBlob(new TextDecoder().decode(opened.value))
          : opened.value;
      const remote: SlotValue<T> = {
        value: this.#codec.decode(remoteRaw),
        index: error.index,
        schema: opened.schema,
      };

      const merged = await options.merge(value, remote);
      const payload = await this.#frame(merged, stamp);
      const index = await this.#ctx.feed.append(payload, { stamp, expectIndex: error.index });
      return { index };
    }
  }

  /**
   * Call `onValue` whenever the slot changes. Polling with backoff, because
   * visibility is a background concern with a documented window (D5).
   */
  watch(onValue: (value: SlotValue<T>) => void, options: WatchOptions = {}): () => void {
    const first = options.intervalMs ?? 1_000;
    const longest = options.maxIntervalMs ?? 15_000;
    let delay = first;
    let lastIndex: bigint | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async (): Promise<void> => {
      try {
        const current = await this.get();
        if (current && current.index !== lastIndex) {
          lastIndex = current.index;
          delay = first;
          onValue(current);
        } else {
          delay = Math.min(delay * 2, longest);
        }
      } catch (error) {
        delay = Math.min(delay * 2, longest);
        options.onError?.(error);
      }
      if (!stopped) timer = setTimeout(() => void tick(), delay);
    };

    void tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  /** Seal a value, sending anything too big for one chunk to a blob (D9). */
  async #frame(value: T, stamp: string): Promise<Uint8Array> {
    const bytes = this.#codec.encode(value);
    const schema = this.#ctx.options.schema ?? 0;

    if (bytes.length <= MAX_INLINE_BYTES) {
      return seal(this.#ctx.key, bytes, { aad: this.#ctx.aad, schema });
    }

    const reference = await this.#ctx.transport.putBlob({ data: bytes, stamp });
    const sealed = await seal(this.#ctx.key, new TextEncoder().encode(reference), {
      aad: this.#ctx.aad,
      schema,
      mode: Mode.REF,
    });
    if (sealed.length > 4096) {
      throw new DappDataError("too-large", "even the blob reference does not fit a chunk");
    }
    return sealed;
  }
}
