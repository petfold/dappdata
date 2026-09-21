import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  type CheckpointStore,
  type StamperState,
  bucketCapacity,
  bucketOf,
  createStamper,
  decodeState,
  encodeState,
  mergeState,
} from "../src/stamper/index.js";
import { DappDataError } from "../src/errors.js";

// Throwaway test key. Never used on any network.
const KEY = hexToBytes("66".repeat(32));
const BATCH = "aa".repeat(32);

/** A checkpoint store in memory, standing in for the reserved slot. */
function store(): CheckpointStore & { saves: number; state: StamperState | null } {
  const box = {
    saves: 0,
    state: null as StamperState | null,
    async load() {
      return box.state;
    },
    async save(state: StamperState) {
      box.saves += 1;
      // Round-trip through the wire form, as the real slot does.
      box.state = decodeState(encodeState(state));
    },
  };
  return box;
}

/** The (bucket, slot) a marshalled stamp spends: `index` is two big-endian u32s. */
function spent(stamp: Uint8Array): { bucket: number; slot: number } {
  const view = new DataView(stamp.buffer, stamp.byteOffset + 32, 8);
  return { bucket: view.getUint32(0), slot: view.getUint32(4) };
}

/** An address that lands in a chosen bucket. */
function addressIn(bucket: number, nonce: number): Uint8Array {
  const address = keccak_256(new TextEncoder().encode(`addr-${bucket}-${nonce}`));
  address[0] = (bucket >> 8) & 0xff;
  address[1] = bucket & 0xff;
  return address;
}

describe("bucket arithmetic (D19)", () => {
  it("knows how little room a shallow batch has per bucket", () => {
    expect(bucketCapacity(17)).toBe(2);
    expect(bucketCapacity(20)).toBe(16);
    expect(bucketCapacity(24)).toBe(256);
  });

  it("takes the bucket from the top 16 bits of the address", () => {
    expect(bucketOf(addressIn(0x1234, 1))).toBe(0x1234);
    expect(bucketOf(addressIn(0, 1))).toBe(0);
    expect(bucketOf(addressIn(65_535, 1))).toBe(65_535);
  });
});

describe("reserve before use (D19)", () => {
  it("checkpoints before the first stamp, not after", async () => {
    const box = store();
    const stamper = await createStamper({ signer: KEY, batchId: BATCH, depth: 24, store: box });

    expect(box.saves).toBe(0);
    await stamper.stamp(addressIn(7, 1));
    expect(box.saves).toBe(1);
    expect(box.state?.reserved.get(7)).toBe(4); // the default block
  });

  it("only checkpoints again when the reservation runs out", async () => {
    const box = store();
    const stamper = await createStamper({
      signer: KEY,
      batchId: BATCH,
      depth: 24,
      store: box,
      block: 4,
    });

    for (let i = 0; i < 4; i++) await stamper.stamp(addressIn(7, i));
    expect(box.saves).toBe(1);

    await stamper.stamp(addressIn(7, 4)); // crosses the line
    expect(box.saves).toBe(2);
    expect(box.state?.reserved.get(7)).toBe(8);
  });

  it("counts each bucket separately", async () => {
    const box = store();
    const stamper = await createStamper({ signer: KEY, batchId: BATCH, depth: 24, store: box });

    await stamper.stamp(addressIn(1, 1));
    await stamper.stamp(addressIn(2, 1));
    expect(box.state?.reserved.get(1)).toBe(4);
    expect(box.state?.reserved.get(2)).toBe(4);
  });

  it("produces a marshalled stamp of the size Bee expects", async () => {
    const stamper = await createStamper({ signer: KEY, batchId: BATCH, depth: 24 });
    const stamp = await stamper.stamp(addressIn(3, 1));
    expect(stamp).toHaveLength(32 + 8 + 8 + 65); // batchId, index, timestamp, signature
  });
});

describe("a second device (D19, T12)", () => {
  it("never issues a slot the first device may have spent", async () => {
    const box = store();
    const laptop = await createStamper({ signer: KEY, batchId: BATCH, depth: 24, store: box });

    // The laptop reserves 4 slots in bucket 9 and spends 2, then goes away
    // without checkpointing again: the crash case D19 is built for.
    const laptopSpent = [
      spent(await laptop.stamp(addressIn(9, 1))),
      spent(await laptop.stamp(addressIn(9, 2))),
    ];
    expect(laptopSpent.map((s) => s.slot)).toEqual([0, 1]);

    // A second device restores the checkpoint and writes.
    const phone = await createStamper({ signer: KEY, batchId: BATCH, depth: 24, store: box });
    const phoneSpent = [
      spent(await phone.stamp(addressIn(9, 3))),
      spent(await phone.stamp(addressIn(9, 4))),
      spent(await phone.stamp(addressIn(9, 5))),
    ];

    // The phone starts at the reserved line, not at what was actually spent,
    // so the laptop's unsynced writes cannot collide with it.
    expect(phoneSpent.every((p) => p.slot >= 4)).toBe(true);

    const key = (s: { bucket: number; slot: number }): string => `${s.bucket}/${s.slot}`;
    const overlap = phoneSpent.map(key).filter((k) => laptopSpent.map(key).includes(k));
    expect(overlap).toEqual([]);

    // Even if the laptop wakes up and uses the rest of its reservation.
    const laptopLater = [
      spent(await laptop.stamp(addressIn(9, 6))),
      spent(await laptop.stamp(addressIn(9, 7))),
    ];
    expect(laptopLater.map((s) => s.slot)).toEqual([2, 3]);
    expect(laptopLater.map(key).filter((k) => phoneSpent.map(key).includes(k))).toEqual([]);
  });

  it("does not hand back a checkpoint from another batch", async () => {
    const box = store();
    const first = await createStamper({ signer: KEY, batchId: BATCH, depth: 24, store: box });
    await first.stamp(addressIn(1, 1));

    await expect(
      createStamper({ signer: KEY, batchId: "bb".repeat(32), depth: 24, store: box }),
    ).rejects.toThrowError(/belongs to batch/);
  });
});

describe("state never moves backwards (T15)", () => {
  it("merges a stale copy by taking the higher line", () => {
    const fresh = decodeState({
      v: 1,
      batchId: BATCH,
      depth: 24,
      generation: 5,
      reserved: [
        [1, 12],
        [2, 4],
      ],
    });
    const stale = decodeState({
      v: 1,
      batchId: BATCH,
      depth: 24,
      generation: 2,
      reserved: [
        [1, 4],
        [3, 8],
      ],
    });

    const merged = mergeState(fresh, stale);
    expect(merged.reserved.get(1)).toBe(12); // not rolled back to 4
    expect(merged.reserved.get(2)).toBe(4);
    expect(merged.reserved.get(3)).toBe(8); // a bucket the fresh copy lacked
    expect(merged.generation).toBe(5);
  });

  it("refuses to merge two batches", () => {
    const a = decodeState({ v: 1, batchId: BATCH, depth: 24, generation: 1, reserved: [] });
    const b = decodeState({ v: 1, batchId: "cc".repeat(32), depth: 24, generation: 1, reserved: [] });
    expect(() => mergeState(a, b)).toThrowError(/two different batches/);
  });

  it("rejects bytes that are not a checkpoint", () => {
    expect(() => decodeState({ hello: true })).toThrowError(/not a stamper checkpoint/);
  });
});

describe("a full batch stops rather than overwrite (D4)", () => {
  it("raises a typed error naming the bucket", async () => {
    // Depth 17: two slots per bucket, so this fills quickly.
    const stamper = await createStamper({ signer: KEY, batchId: BATCH, depth: 17, store: store() });
    await stamper.stamp(addressIn(4, 1));
    await stamper.stamp(addressIn(4, 2));

    await expect(stamper.stamp(addressIn(4, 3))).rejects.toThrowError(DappDataError);
    await expect(stamper.stamp(addressIn(4, 3))).rejects.toThrowError(/is full in bucket 4/);
  });

  it("clamps the reservation to what the bucket holds", async () => {
    const box = store();
    const stamper = await createStamper({
      signer: KEY,
      batchId: BATCH,
      depth: 17,
      store: box,
      block: 4,
    });
    await stamper.stamp(addressIn(5, 1));
    expect(box.state?.reserved.get(5)).toBe(2); // capacity, not the block size
  });
});
