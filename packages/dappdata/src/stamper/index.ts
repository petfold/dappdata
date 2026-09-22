/**
 * Client-side stamping with state that survives a new device (D12, D19).
 *
 * The rule is reserve-before-use. The checkpoint records a height per bucket
 * that this device *may* consume; the device stamps only below that line and
 * extends the reservation, with a fresh checkpoint, before crossing it. A
 * device that restores the checkpoint starts at the reserved heights, because
 * everything below them may already be spent and everything above them cannot
 * be. A crash therefore loses slots instead of reusing them, which is the
 * direction to fail in: a reused slot destroys the chunk that was there, on
 * immutable batches too (D4).
 *
 * Two refinements make the checkpoint safe to keep on Swarm itself, in a slot
 * of the user's folder that is stamped by this very stamper:
 *
 * - **Lookahead.** A store may say which chunk addresses its next `save` will
 *   stamp (`upcoming`). The stamper reserves those slots inside the checkpoint
 *   it is about to write, so the checkpoint chunk is covered by the state it
 *   carries, and the one after it by the state before. No checkpoint ever
 *   needs a checkpoint of its own.
 * - **Losing a race voids the reservation.** A store that can tell another
 *   writer got there first (`expectIndex` on a feed) throws
 *   `CheckpointConflictError` with the winner's state. The lines this device
 *   tried to publish were never published, so it starts again from the
 *   winner's lines. Two devices that begin from the same checkpoint at the
 *   same moment therefore take disjoint slots — a file that both overwrite
 *   cannot promise that.
 */
import { stamp as signStamp, convertEnvelopeToMarshaledStamp } from "@ethersphere/core-sdk";
import { DappDataError } from "../errors.js";
import type { StampSigner } from "../transport/types.js";
import {
  type StamperState,
  blankState,
  bucketCapacity,
  bucketOf,
  encodeState,
  mergeState,
} from "./state.js";

export * from "./state.js";

/** Slots reserved ahead of use, per bucket, per checkpoint. */
export const DEFAULT_BLOCK = 4;

/** How often a checkpoint write may lose to another device before we give up. */
const MAX_COMMIT_ATTEMPTS = 8;

export interface StamperOptions {
  /** 32-byte key that owns the batch: the derived storage key (D12). */
  signer: Uint8Array;
  batchId: string;
  depth: number;
  /** Where the checkpoint is kept. Without one the stamper is single-use. */
  store?: CheckpointStore | undefined;
  /** How many slots to reserve per bucket at a time. Default 4. */
  block?: number | undefined;
}

export interface CheckpointStore {
  load(): Promise<StamperState | null>;
  /**
   * Persist the checkpoint. A store that can detect another writer moving
   * the checkpoint since `load` throws `CheckpointConflictError` carrying
   * what it found, and the stamper retries from there.
   */
  save(state: StamperState): Promise<void>;
  /**
   * The chunk addresses the next `save` will stamp through this stamper, in
   * writing order (D19 lookahead). A store whose writes are paid for some
   * other way leaves this out.
   */
  upcoming?(): Promise<Uint8Array[]>;
}

/** Another device published a checkpoint first; `remote` is what it wrote. */
export class CheckpointConflictError extends DappDataError {
  readonly remote: StamperState;

  constructor(remote: StamperState) {
    super("conflict", "another device published a stamper checkpoint first");
    this.name = "CheckpointConflictError";
    this.remote = remote;
  }
}

/** A stamper is also a `Stamp`: pass it wherever a write asks for one. */
export interface Stamper extends StampSigner {
  readonly batchId: string;
  /** A marshalled postage stamp for this chunk address. */
  stamp(address: Uint8Array): Promise<Uint8Array>;
  /** The same, under the name the transport calls. */
  sign(address: Uint8Array): Promise<Uint8Array>;
  /** The live state, for persisting elsewhere or handing to another library. */
  state(): StamperState;
  /** Force a checkpoint now, whatever the reservation looks like. */
  checkpoint(): Promise<void>;
  /** How much of the batch this device has reserved, 0..1. */
  usage(): number;
}

export async function createStamper(options: StamperOptions): Promise<Stamper> {
  const block = options.block ?? DEFAULT_BLOCK;
  const capacity = bucketCapacity(options.depth);
  if (block < 1) throw new DappDataError("unsupported", "a reservation block is at least 1");

  let state = blankState(options.batchId, options.depth);
  const stored = await options.store?.load();
  if (stored) {
    if (stored.batchId !== options.batchId) {
      throw new DappDataError(
        "unsupported",
        `the checkpoint belongs to batch ${stored.batchId}, not ${options.batchId}`,
      );
    }
    state = mergeState(state, stored);
  }

  // Everything the checkpoint reserved may already be spent, so this device
  // starts at that line rather than trying to guess how far the last one got.
  const used = new Map<number, number>(state.reserved);

  let saving = false;

  const line = (bucket: number): number => state.reserved.get(bucket) ?? 0;
  const spent = (bucket: number): number => used.get(bucket) ?? 0;

  /** Take in another device's view: lines only move up, and a moved line is spent. */
  const absorb = (remote: StamperState, buckets: Iterable<number>): void => {
    state = mergeState(state, remote);
    for (const bucket of buckets) {
      if (spent(bucket) < line(bucket)) used.set(bucket, line(bucket));
    }
  };

  const full = (bucket: number): DappDataError =>
    new DappDataError(
      "too-large",
      `postage batch ${options.batchId} is full in bucket ${bucket} ` +
        `(${capacity} slots at depth ${options.depth}); dappdata stops rather than ` +
        `overwrite your data (D4). Buy a batch with a greater depth.`,
    );

  /**
   * Publish a checkpoint that reserves `want` slots in `bucket` (or nothing
   * new, for a forced checkpoint), plus one slot for every chunk the store
   * says the write itself will stamp. Retries from the winner's lines when
   * another device published first.
   */
  const commit = async (extension: { bucket: number; want: number } | null): Promise<void> => {
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      const before = new Map(state.reserved);
      const tentative = new Set<number>();

      if (extension && spent(extension.bucket) >= line(extension.bucket)) {
        const want = Math.min(Math.max(extension.want, spent(extension.bucket) + block), capacity);
        if (want <= spent(extension.bucket)) throw full(extension.bucket);
        state.reserved.set(extension.bucket, want);
        tentative.add(extension.bucket);
      }

      // Lookahead: the checkpoint chunk itself, and the one after it, must
      // have a slot below the line this checkpoint publishes.
      const need = new Map<number, number>();
      for (const address of (await options.store?.upcoming?.()) ?? []) {
        const bucket = bucketOf(address);
        need.set(bucket, (need.get(bucket) ?? 0) + 1);
      }
      for (const [bucket, count] of need) {
        if (line(bucket) - spent(bucket) >= count) continue;
        const want = spent(bucket) + count;
        if (want > capacity) throw full(bucket);
        state.reserved.set(bucket, want);
        tentative.add(bucket);
      }

      state = { ...state, generation: state.generation + 1 };
      saving = true;
      try {
        await options.store?.save(state);
        return;
      } catch (error) {
        if (!(error instanceof CheckpointConflictError)) throw error;
        // Nothing this attempt reserved was published. Drop it, take the
        // winner's lines, and treat everything below them as spent.
        state = { ...state, reserved: before, generation: state.generation - 1 };
        absorb(error.remote, tentative);
        if (extension && spent(extension.bucket) < line(extension.bucket)) extension = null;
      } finally {
        saving = false;
      }
    }
    throw new DappDataError(
      "conflict",
      `the stamper checkpoint kept moving under us (${MAX_COMMIT_ATTEMPTS} attempts); ` +
        `another device is writing to the same folder at the same time`,
    );
  };

  /** Make sure this bucket has a slot below the published line. */
  const ensureRoom = async (bucket: number): Promise<void> => {
    if (spent(bucket) < line(bucket)) return;

    if (saving) {
      // The checkpoint being written is stamped by this stamper and landed in
      // a bucket the checkpoint did not reserve. Extending here would write
      // another checkpoint, which would need room, for ever. A store whose
      // writes this stamper pays for must announce them through `upcoming`.
      throw new DappDataError(
        "unsupported",
        `the stamper ran out of reserved slots in bucket ${bucket} while writing its own ` +
          `checkpoint; a store stamped by the stamper it checkpoints must implement ` +
          `upcoming() so the checkpoint can reserve its own slot (D19)`,
      );
    }

    // Another device may have reserved past us since we last looked, and our
    // own copy of the state says nothing about that. Re-read before extending,
    // or we hand out slots it has already taken — which is what the Sepolia
    // gate run of 2026-09-21 caught: two devices both spent bucket 4242 slot 4.
    const stored = await options.store?.load();
    if (stored) absorb(stored, [bucket]);
    if (spent(bucket) < line(bucket)) return; // the merge made room

    await commit({ bucket, want: spent(bucket) + block });
  };

  const stamp = async (address: Uint8Array): Promise<Uint8Array> => {
    const bucket = bucketOf(address);
    await ensureRoom(bucket);

    const slot = spent(bucket);
    used.set(bucket, slot + 1);
    const envelope = signStamp(options.signer, options.batchId, address, slot);
    return convertEnvelopeToMarshaledStamp(envelope).toUint8Array();
  };

  return {
    batchId: options.batchId,
    stamp,
    sign: stamp,

    state(): StamperState {
      return { ...state, reserved: new Map(state.reserved) };
    },

    async checkpoint(): Promise<void> {
      for (const [bucket, height] of used) {
        state.reserved.set(bucket, Math.max(line(bucket), height));
      }
      await commit(null);
    },

    usage(): number {
      let reserved = 0;
      for (const height of state.reserved.values()) reserved += height;
      return reserved / 2 ** options.depth;
    },
  };
}

/** The wire form of a checkpoint, for a caller keeping it somewhere of its own. */
export { encodeState };
