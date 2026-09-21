// The bucket state a stamper must never lose (D19, T12).
//
// A postage batch has 65 536 buckets whatever its depth, and a bucket holds
// `2^(depth-16)` chunks. Stamping the same (bucket, index) slot twice destroys
// the chunk that was there, on immutable batches too (D4, S3 step 5), so the
// heights below are the most safety-critical bytes the SDK keeps.
//
// Only the buckets a device has touched are recorded. A user with a handful of
// slots touches a handful of buckets, so the checkpoint stays small enough to
// live inline in a feed payload.
import { DappDataError } from "../errors.js";

export const BUCKETS = 65_536;

export interface StamperState {
  /** Which batch these heights belong to; a state never crosses batches. */
  batchId: string;
  depth: number;
  /**
   * Reserved height per bucket: the device may stamp indices below this line,
   * and a device that restores this state must start at it (D19).
   */
  reserved: Map<number, number>;
  /** Bumped on every checkpoint, so a stale copy can be recognised (T15). */
  generation: number;
}

export const bucketCapacity = (depth: number): number => 2 ** (depth - 16);

/** The bucket a chunk falls in: the top 16 bits of its address. */
export function bucketOf(address: Uint8Array): number {
  const high = address[0];
  const low = address[1];
  if (high === undefined || low === undefined) {
    throw new DappDataError("unsupported", "a chunk address is 32 bytes");
  }
  return (high << 8) | low;
}

export function blankState(batchId: string, depth: number): StamperState {
  if (depth < 17 || depth > 40) {
    throw new DappDataError("unsupported", `batch depth ${depth} is outside 17..40`);
  }
  return { batchId, depth, reserved: new Map(), generation: 0 };
}

/**
 * The wire shape: sparse pairs, because a dense 65 536-entry array would be
 * 256 KB per checkpoint and almost all of it zero.
 */
export interface StamperStateWire {
  v: 1;
  batchId: string;
  depth: number;
  generation: number;
  /** `[bucket, reservedHeight]` pairs, ascending by bucket. */
  reserved: Array<[number, number]>;
}

export function encodeState(state: StamperState): StamperStateWire {
  return {
    v: 1,
    batchId: state.batchId,
    depth: state.depth,
    generation: state.generation,
    reserved: [...state.reserved.entries()].sort((a, b) => a[0] - b[0]),
  };
}

export function decodeState(wire: unknown): StamperState {
  const w = wire as Partial<StamperStateWire> | null;
  if (!w || w.v !== 1 || typeof w.batchId !== "string" || typeof w.depth !== "number") {
    throw new DappDataError("bad-envelope", "this is not a stamper checkpoint");
  }
  const reserved = new Map<number, number>();
  for (const pair of w.reserved ?? []) {
    const [bucket, height] = pair;
    if (bucket >= 0 && bucket < BUCKETS && height > 0) reserved.set(bucket, height);
  }
  return { batchId: w.batchId, depth: w.depth, reserved, generation: w.generation ?? 0 };
}

/**
 * Merge two views of the same batch's state. A height never moves backwards:
 * a stale local cache, or one another app on a shared gateway origin has
 * edited, can only ever lose against the checkpoint (T15).
 */
export function mergeState(a: StamperState, b: StamperState): StamperState {
  if (a.batchId !== b.batchId) {
    throw new DappDataError("unsupported", "stamper states for two different batches");
  }
  const reserved = new Map(a.reserved);
  for (const [bucket, height] of b.reserved) {
    reserved.set(bucket, Math.max(reserved.get(bucket) ?? 0, height));
  }
  return {
    batchId: a.batchId,
    depth: Math.max(a.depth, b.depth),
    reserved,
    generation: Math.max(a.generation, b.generation),
  };
}
