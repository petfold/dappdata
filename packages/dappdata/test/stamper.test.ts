import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  CheckpointConflictError,
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

describe("a checkpoint that pays for itself (D19 lookahead)", () => {
  type Live = Awaited<ReturnType<typeof createStamper>>;
  interface CheckpointChunk {
    address: Uint8Array;
    state: StamperState;
  }
  /** A shared "feed" of checkpoint chunks: what two devices would both read. */
  const feed = (): CheckpointChunk[] => [];
  const addressAt = (index: number): Uint8Array =>
    keccak_256(new TextEncoder().encode(`checkpoint-chunk-${index}`));

  /**
   * A store whose own writes are stamped by the stamper it checkpoints — the
   * slot-backed default. It knows the address of its next write before it has
   * a payload, so it can announce it.
   */
  function selfStampingStore(
    chunks: CheckpointChunk[],
    getStamper: () => Live | null,
    stampsSeen: Array<{ bucket: number; slot: number }>,
  ): CheckpointStore {
    return {
      async load() {
        const last = chunks.at(-1);
        return last ? decodeState(encodeState(last.state)) : null;
      },
      async upcoming() {
        return [addressAt(chunks.length), addressAt(chunks.length + 1)];
      },
      async save(state) {
        const address = addressAt(chunks.length);
        // The transport asks the stamper for the checkpoint chunk's own stamp.
        const marshalled = await getStamper()?.stamp(address);
        if (!marshalled) throw new Error("no stamper");
        stampsSeen.push(spent(marshalled));
        chunks.push({ address, state: decodeState(encodeState(state)) });
      },
    };
  }

  it("writes its checkpoint through the stamper without recursing", async () => {
    const chunks = feed();
    const stampsSeen: Array<{ bucket: number; slot: number }> = [];
    let stamper: Live | null = null;
    stamper = await createStamper({
      signer: KEY,
      batchId: BATCH,
      depth: 24,
      store: selfStampingStore(chunks, () => stamper, stampsSeen),
      block: 4,
    });

    for (let i = 0; i < 10; i++) await stamper.stamp(addressIn(1, i));
    // 10 data stamps in one bucket at block 4: three checkpoints.
    expect(chunks).toHaveLength(3);

    // Every checkpoint chunk's slot sits below the line that same checkpoint
    // publishes: the checkpoint covers itself.
    for (const [i, chunk] of chunks.entries()) {
      const { bucket, slot } = stampsSeen[i]!;
      expect(bucketOf(chunk.address)).toBe(bucket);
      expect(chunk.state.reserved.get(bucket) ?? 0).toBeGreaterThan(slot);
    }
    // And each checkpoint already reserves a slot for the next checkpoint's chunk.
    for (let i = 0; i + 1 < chunks.length; i++) {
      const nextBucket = bucketOf(chunks[i + 1]!.address);
      expect(chunks[i]!.state.reserved.get(nextBucket) ?? 0).toBeGreaterThan(0);
    }
  });

  it("restores on a second device and never reuses a checkpoint's own slot", async () => {
    const chunks = feed();
    const stampsSeen: Array<{ bucket: number; slot: number }> = [];
    const key = (s: { bucket: number; slot: number }): string => `${s.bucket}/${s.slot}`;
    const data: string[] = [];

    let first: Live | null = null;
    first = await createStamper({
      signer: KEY,
      batchId: BATCH,
      depth: 20,
      store: selfStampingStore(chunks, () => first, stampsSeen),
      block: 2,
    });
    for (let i = 0; i < 5; i++) data.push(key(spent(await first.stamp(addressIn(2, i)))));

    let second: Live | null = null;
    second = await createStamper({
      signer: KEY,
      batchId: BATCH,
      depth: 20,
      store: selfStampingStore(chunks, () => second, stampsSeen),
      block: 2,
    });
    for (let i = 0; i < 5; i++) data.push(key(spent(await second.stamp(addressIn(2, 100 + i)))));

    // Data slots and checkpoint slots, both devices: no (bucket, slot) twice.
    const everything = [...data, ...stampsSeen.map(key)];
    expect(new Set(everything).size).toBe(everything.length);
  });

  it("still refuses a self-stamping store that gives no lookahead", async () => {
    let stamper: Live | null = null;
    let bucket = 100;
    const blind: CheckpointStore = {
      async load() {
        return null;
      },
      async save() {
        await stamper?.stamp(addressIn(bucket++, 1));
      },
    };
    stamper = await createStamper({ signer: KEY, batchId: BATCH, depth: 24, store: blind, block: 4 });
    await expect(stamper.stamp(addressIn(1, 1))).rejects.toThrowError(/must implement upcoming/);
  });
});

describe("losing the checkpoint race voids the reservation (D19)", () => {
  /**
   * A store with feed semantics: `save` fails when the checkpoint moved since
   * this device last loaded it, and hands over what it found. This is what
   * the slot-backed store does with `expectIndex`, and what a shared file
   * cannot do.
   */
  function racyStore() {
    let published: StamperState | null = null;
    let version = 0;
    // One shared "last seen" is enough here because the two devices below
    // take turns; each save is preceded by that device's own load.
    let lastSeen = 0;
    return {
      get published() {
        return published;
      },
      async load() {
        const copy = published ? decodeState(encodeState(published)) : null;
        // Remember which version this device last saw: a save from an older
        // view conflicts, as a feed write with a stale expectIndex would.
        lastSeen = version;
        return copy;
      },
      async save(state: StamperState) {
        if (lastSeen !== version && published) throw new CheckpointConflictError(published);
        published = decodeState(encodeState(state));
        version += 1;
        lastSeen = version;
      },
    };
  }

  it("two devices starting from the same blank checkpoint take disjoint slots", async () => {
    const feed = racyStore();
    // Both devices load "nothing" before either has published.
    const a = await createStamper({ signer: KEY, batchId: BATCH, depth: 20, store: feed, block: 4 });
    const b = await createStamper({ signer: KEY, batchId: BATCH, depth: 20, store: feed, block: 4 });

    const key = (m: Uint8Array): string => {
      const s = spent(m);
      return `${s.bucket}/${s.slot}`;
    };
    const aSlots = [key(await a.stamp(addressIn(7, 1)))]; // publishes [0,4) in bucket 7
    // b's first stamp tries to publish [0,4) too, from its blank view; the
    // save conflicts, b takes a's lines and reserves [4,8) instead.
    const bSlots = [key(await b.stamp(addressIn(7, 2)))];
    expect(bSlots[0]).toBe("7/4");

    for (let i = 0; i < 5; i++) aSlots.push(key(await a.stamp(addressIn(7, 10 + i))));
    for (let i = 0; i < 5; i++) bSlots.push(key(await b.stamp(addressIn(7, 20 + i))));
    const all = [...aSlots, ...bSlots];
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives up after too many lost races with a typed error", async () => {
    const alwaysLoses: CheckpointStore = {
      async load() {
        return null;
      },
      async save() {
        // Someone else always publishes a checkpoint that reserved more.
        throw new CheckpointConflictError(
          decodeState({ v: 1, batchId: BATCH, depth: 20, generation: 99, reserved: [[3, 16]] }),
        );
      },
    };
    const stamper = await createStamper({ signer: KEY, batchId: BATCH, depth: 20, store: alwaysLoses });
    // Bucket 3 is full in the remote state, so the retry ends in "full", which
    // is the right answer: nothing is left for this device to reserve.
    await expect(stamper.stamp(addressIn(3, 1))).rejects.toThrowError(/is full in bucket 3/);

    const stillLoses = await createStamper({ signer: KEY, batchId: BATCH, depth: 20, store: alwaysLoses });
    await expect(stillLoses.stamp(addressIn(5, 1))).rejects.toThrowError(/kept moving/);
  });
});

describe("two devices sharing one checkpoint (D19, T12)", () => {
  // The interleaving the Sepolia gate run of 2026-09-21 caught: the laptop
  // reserves, the phone restores and extends, and then the laptop — still
  // holding its own older view of the state — extends from a line that has
  // already moved. Before the fix both spent bucket 4242 slot 4.
  it("never hands out a slot the other device already took", async () => {
    const shared = store();
    const bucket = 4242;
    const spentBy = (stamp: Uint8Array): string => {
      const s = spent(stamp);
      return `${s.bucket}/${s.slot}`;
    };

    const laptop = await createStamper({
      signer: KEY,
      batchId: BATCH,
      depth: 20,
      store: shared,
      block: 4,
    });
    const laptopFirst = [];
    for (let i = 0; i < 3; i++) laptopFirst.push(spentBy(await laptop.stamp(addressIn(bucket, i))));

    const phone = await createStamper({
      signer: KEY,
      batchId: BATCH,
      depth: 20,
      store: shared,
      block: 4,
    });
    const phoneSlots = [];
    for (let i = 0; i < 3; i++) phoneSlots.push(spentBy(await phone.stamp(addressIn(bucket, 100 + i))));

    // The laptop wakes up with a stale reservation line and writes again.
    const laptopLater = [];
    for (let i = 0; i < 2; i++)
      laptopLater.push(spentBy(await laptop.stamp(addressIn(bucket, 200 + i))));

    const all = [...laptopFirst, ...phoneSlots, ...laptopLater];
    expect(new Set(all).size).toBe(all.length);
  });

  it("skips past a line another device reserved but did not spend", async () => {
    const shared = store();
    const first = await createStamper({ signer: KEY, batchId: BATCH, depth: 20, store: shared, block: 4 });
    await first.stamp(addressIn(7, 1)); // reserves 4, spends 1

    const second = await createStamper({ signer: KEY, batchId: BATCH, depth: 20, store: shared, block: 4 });
    const slot = spent(await second.stamp(addressIn(7, 2)));
    expect(slot.slot).toBeGreaterThanOrEqual(4); // not slot 1, which the first may yet use
  });
});
