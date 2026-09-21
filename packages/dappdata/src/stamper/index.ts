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
 */
import { stamp as signStamp, convertEnvelopeToMarshaledStamp } from "@ethersphere/core-sdk";
import { DappDataError } from "../errors.js";
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
  save(state: StamperState): Promise<void>;
}

export interface Stamper {
  /** A marshalled postage stamp for this chunk address. */
  stamp(address: Uint8Array): Promise<Uint8Array>;
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

  const save = async (): Promise<void> => {
    saving = true;
    try {
      state = { ...state, generation: state.generation + 1 };
      await options.store?.save(state);
    } finally {
      saving = false;
    }
  };

  /** Reserve room in this bucket, leaving space for the checkpoint's own chunk. */
  const ensureRoom = async (bucket: number): Promise<void> => {
    const spent = used.get(bucket) ?? 0;
    if (spent < (state.reserved.get(bucket) ?? 0)) return;

    if (saving) {
      // A checkpoint that is stamped by this same stamper needs room that the
      // checkpoint being written already covers. Extending here would write
      // another checkpoint, which would need room, for ever. A store whose
      // writes are stamped from this stamper must therefore keep a step of
      // lookahead; see D19, "the checkpoint cannot stamp itself".
      throw new DappDataError(
        "unsupported",
        `the stamper ran out of reserved slots in bucket ${bucket} while writing its own ` +
          `checkpoint; a checkpoint store cannot be stamped by the stamper it checkpoints (D19)`,
      );
    }

    // Another device may have reserved past us since we last looked, and our
    // own copy of the state says nothing about that. Re-read before extending,
    // or we hand out slots it has already taken — which is what the Sepolia
    // gate run of 2026-09-21 caught: two devices both spent bucket 4242 slot 4.
    const stored = await options.store?.load();
    if (stored) {
      state = mergeState(state, stored);
      const line = state.reserved.get(bucket) ?? 0;
      if ((used.get(bucket) ?? 0) < line) used.set(bucket, line);
    }

    const from = used.get(bucket) ?? 0;
    if (from < (state.reserved.get(bucket) ?? 0)) return; // the merge made room

    const want = Math.min(from + block, capacity);
    if (want <= from) {
      throw new DappDataError(
        "too-large",
        `postage batch ${options.batchId} is full in bucket ${bucket} ` +
          `(${capacity} slots at depth ${options.depth}); dappdata stops rather than ` +
          `overwrite your data (D4). Buy a batch with a greater depth.`,
      );
    }
    state.reserved.set(bucket, want);
    await save();
  };

  return {
    async stamp(address: Uint8Array): Promise<Uint8Array> {
      const bucket = bucketOf(address);
      await ensureRoom(bucket);

      const slot = used.get(bucket) ?? 0;
      used.set(bucket, slot + 1);
      const envelope = signStamp(options.signer, options.batchId, address, slot);
      return convertEnvelopeToMarshaledStamp(envelope).toUint8Array();
    },

    state(): StamperState {
      return { ...state, reserved: new Map(state.reserved) };
    },

    async checkpoint(): Promise<void> {
      for (const [bucket, spent] of used) {
        state.reserved.set(bucket, Math.max(state.reserved.get(bucket) ?? 0, spent));
      }
      await save();
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
