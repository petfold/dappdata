/**
 * The default checkpoint store end to end (D19): a stamper whose state lives
 * in a slot of the same folder, stamped by that stamper, over the in-memory
 * transport, which asks the stamper for every chunk's stamp as a node would.
 */
import { describe, expect, it } from "vitest";
import { DappData } from "../src/dappdata.js";
import { mnemonic } from "../src/entropy/mnemonic.js";
import { type MemoryTransport, memory } from "../src/transport/memory.js";

// Throwaway BIP-39 test vector. Never funded.
const WORDS = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const APP = "https://stamper.test";
const BATCH = "ab".repeat(32);

const connect = (transport: MemoryTransport): Promise<DappData> =>
  DappData.connect({ entropy: mnemonic(WORDS, APP), app: { id: APP }, transport });

/** The (bucket, slot) a marshalled stamp spends. */
function spent(stamp: Uint8Array): string {
  const view = new DataView(stamp.buffer, stamp.byteOffset + 32, 8);
  return `${view.getUint32(0)}/${view.getUint32(4)}`;
}

const slotsSpent = (transport: MemoryTransport): string[] => [
  ...transport.writes.map((w) => {
    if (!w.stamped) throw new Error(`write at index ${w.index} was not client-stamped`);
    return spent(w.stamped);
  }),
  ...transport.blobChunks.map((c) => {
    if (!c.stamped) throw new Error(`blob chunk ${c.address} was not client-stamped`);
    return spent(c.stamped);
  }),
];

describe("the slot-backed checkpoint store (D19)", () => {
  it("stamps its own checkpoint and every data write from one account of the batch", async () => {
    const transport = memory();
    const dd = await connect(transport);
    const stamper = await dd.stamper(BATCH, { depth: 20, block: 2 });
    const notes = dd.slot<string[]>("notes");

    let current = await notes.get();
    for (let i = 0; i < 6; i++) {
      await notes.set([...(current?.value ?? []), `note ${i}`], {
        expectIndex: current?.index,
        stamp: stamper,
      });
      current = await notes.get();
    }
    expect(current?.value).toHaveLength(6);

    // A value too large for one chunk: every chunk of the blob is stamped by
    // the same stamper, so a sponsored user can write blobs too (D27).
    const bulk = dd.slot<string>("bulk");
    await bulk.set("y".repeat(10_000), { stamp: stamper });
    expect((await bulk.get())?.value).toHaveLength(10_000);
    expect(transport.blobChunks.length).toBeGreaterThanOrEqual(3);

    // The checkpoint lives in the folder, readable with nothing but the key.
    const checkpoint = await dd.slot<{ reserved: Array<[number, number]> }>(`.stamper/${BATCH}`).get();
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.value.reserved.length).toBeGreaterThan(0);

    // Every write — data and checkpoint alike — was stamped by the stamper,
    // and no (bucket, slot) was spent twice.
    const all = slotsSpent(transport);
    expect(all.length).toBeGreaterThan(6);
    expect(new Set(all).size).toBe(all.length);
  });

  it("restores on a fresh device and keeps taking disjoint slots", async () => {
    const transport = memory();
    const laptop = await connect(transport);
    const laptopStamper = await laptop.stamper(BATCH, { depth: 20, block: 2 });
    const notes = laptop.slot<string>("draft");
    for (let i = 0; i < 3; i++) {
      const head = await notes.get();
      await notes.set(`draft ${i}`, { expectIndex: head?.index, stamp: laptopStamper });
    }

    // Nothing carried over but the derivation: a new instance, a new stamper.
    const phone = await connect(transport);
    const phoneStamper = await phone.stamper(BATCH, { depth: 20, block: 2 });
    const phoneNotes = phone.slot<string>("draft");
    for (let i = 0; i < 3; i++) {
      const head = await phoneNotes.get();
      await phoneNotes.set(`phone ${i}`, { expectIndex: head?.index, stamp: phoneStamper });
    }

    // The laptop wakes up, still holding its own view, and writes again.
    for (let i = 0; i < 2; i++) {
      const head = await notes.get();
      await notes.set(`late ${i}`, { expectIndex: head?.index, stamp: laptopStamper });
    }

    const all = slotsSpent(transport);
    expect(new Set(all).size).toBe(all.length);
    expect((await phoneNotes.get())?.value).toBe("late 1");
  });

  it("detects two devices publishing a checkpoint at once and keeps them apart", async () => {
    const transport = memory();
    // Both devices come up from the same empty folder before either writes.
    const a = await connect(transport);
    const b = await connect(transport);
    const aStamper = await a.stamper(BATCH, { depth: 20, block: 4 });
    const bStamper = await b.stamper(BATCH, { depth: 20, block: 4 });

    // Interleave writes to different slots so the only contention is the
    // checkpoint feed itself.
    for (let i = 0; i < 4; i++) {
      const aSlot = a.slot<number>("a");
      const bSlot = b.slot<number>("b");
      await aSlot.set(i, { expectIndex: (await aSlot.get())?.index, stamp: aStamper });
      await bSlot.set(i, { expectIndex: (await bSlot.get())?.index, stamp: bStamper });
    }

    const all = slotsSpent(transport);
    expect(new Set(all).size).toBe(all.length);
    // Both reached the end with the same view of the batch.
    const checkpointA = await a.slot<{ generation: number }>(`.stamper/${BATCH}`).get();
    const checkpointB = await b.slot<{ generation: number }>(`.stamper/${BATCH}`).get();
    expect(checkpointA?.index).toBe(checkpointB?.index);
  });
});
