import { describe, expect, it, vi } from "vitest";
import { DappData } from "../src/dappdata.js";
import { ConflictError, DappDataError } from "../src/errors.js";
import { mnemonic } from "../src/entropy/mnemonic.js";
import { memory, type MemoryTransport } from "../src/transport/memory.js";
import { MAX_INLINE_BYTES } from "../src/slot/index.js";

// Throwaway BIP-39 test vector. Never funded.
const WORDS = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const APP = "https://demo.dappdata.example";
const STAMP = "00".repeat(32);

interface Prefs {
  theme: string;
}

const connect = (transport: MemoryTransport, app = APP): Promise<DappData> =>
  DappData.connect({
    entropy: mnemonic(WORDS),
    app: { id: app },
    transport,
    stamp: STAMP,
  });

describe("a slot, end to end over a mocked Bee", () => {
  it("reads back what it wrote", async () => {
    const dd = await connect(memory());
    const prefs = dd.slot<Prefs>("preferences");

    expect(await prefs.get()).toBeNull();
    const { index } = await prefs.set({ theme: "dark" });
    expect(index).toBe(0n);

    const current = await prefs.get();
    expect(current?.value).toEqual({ theme: "dark" });
    expect(current?.index).toBe(0n);
  });

  it("appends, and a second device sees the newer value", async () => {
    const transport = memory();
    const laptop = await connect(transport);
    const phone = await connect(transport);

    await laptop.slot<Prefs>("preferences").set({ theme: "dark" });
    await laptop.slot<Prefs>("preferences").set({ theme: "light" }, { expectIndex: 0n });

    // The phone derives the same folder from the same words (C2).
    const seen = await phone.slot<Prefs>("preferences").get();
    expect(seen?.value).toEqual({ theme: "light" });
    expect(seen?.index).toBe(1n);
  });

  it("stores nothing a network observer can read (C5)", async () => {
    const transport = memory();
    const dd = await connect(transport);
    await dd.slot<Prefs>("preferences").set({ theme: "dark" });

    const owner = dd.address;
    const topic = (await import("../src/dappdata.js")).slotTopic(APP, "preferences");
    const raw = await transport.getFeedUpdate({ owner, topic, index: 0n });
    expect(raw).not.toBeNull();
    expect(new TextDecoder().decode(raw as Uint8Array)).not.toContain("theme");
    expect(new TextDecoder().decode(raw as Uint8Array)).not.toContain("dark");
  });

  it("uses Bee's slow lookup once and then reads by index (D5)", async () => {
    const transport = memory();
    let lookups = 0;
    const counted = { ...transport, findLatest: (args: Parameters<typeof transport.findLatest>[0]) => {
      lookups += 1;
      return transport.findLatest(args);
    } };

    const dd = await DappData.connect({
      entropy: mnemonic(WORDS),
      app: { id: APP },
      transport: counted,
      stamp: STAMP,
    });
    const prefs = dd.slot<Prefs>("preferences");

    await prefs.get(); // cold: nothing there yet, one lookup
    await prefs.set({ theme: "dark" });
    await prefs.get();
    await prefs.get();
    await prefs.set({ theme: "light" }, { expectIndex: 0n });
    await prefs.get();

    expect(lookups).toBe(1);
  });

  it("gives a different folder to a different app (D16)", async () => {
    const transport = memory();
    const here = await connect(transport, APP);
    const there = await connect(transport, "https://other.example");

    await here.slot<Prefs>("preferences").set({ theme: "dark" });
    expect(here.address).not.toBe(there.address);
    expect(await there.slot<Prefs>("preferences").get()).toBeNull();
  });
});

describe("conflicts between devices (D6)", () => {
  it("throws a typed conflict when the feed moved", async () => {
    const transport = memory();
    const laptop = await connect(transport);
    const phone = await connect(transport);

    await laptop.slot<Prefs>("preferences").set({ theme: "dark" });
    const seen = await phone.slot<Prefs>("preferences").get();

    // The laptop writes again before the phone does.
    await laptop.slot<Prefs>("preferences").set({ theme: "light" }, { expectIndex: 0n });

    await expect(
      phone.slot<Prefs>("preferences").set({ theme: "sepia" }, { expectIndex: seen?.index }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("resolves with the dapp's merge and writes the result", async () => {
    const transport = memory();
    const laptop = await connect(transport);
    const phone = await connect(transport);

    await laptop.slot<Prefs>("preferences").set({ theme: "dark" });
    const seen = await phone.slot<Prefs>("preferences").get();
    await laptop.slot<Prefs>("preferences").set({ theme: "light" }, { expectIndex: 0n });

    const merge = vi.fn((local: Prefs, remote: { value: Prefs }) => ({
      theme: `${remote.value.theme}+${local.theme}`,
    }));
    const { index } = await phone
      .slot<Prefs>("preferences")
      .set({ theme: "sepia" }, { expectIndex: seen?.index, merge });

    expect(merge).toHaveBeenCalledOnce();
    expect(index).toBe(2n);
    expect((await laptop.slot<Prefs>("preferences").get())?.value).toEqual({
      theme: "light+sepia",
    });
  });
});

describe("schema versions (D22)", () => {
  it("runs migrate when the stored shape is older", async () => {
    const transport = memory();
    const v1 = await connect(transport);
    await v1.slot<{ dark: boolean }>("preferences", { schema: 1 }).set({ dark: true });

    const v2 = await connect(transport);
    const slot = v2.slot<Prefs>("preferences", {
      schema: 2,
      migrate: (old, from) => {
        expect(from).toBe(1);
        return { theme: (old as { dark: boolean }).dark ? "dark" : "light" };
      },
    });
    expect((await slot.get())?.value).toEqual({ theme: "dark" });
  });

  it("refuses an unknown schema when the dapp gave no migrate", async () => {
    const transport = memory();
    const v1 = await connect(transport);
    await v1.slot<Prefs>("preferences", { schema: 1 }).set({ theme: "dark" });

    const v2 = await connect(transport);
    await expect(v2.slot<Prefs>("preferences", { schema: 2 }).get()).rejects.toThrowError(
      /gave no migrate callback/,
    );
  });
});

describe("a dapp that is behind its own data (D22)", () => {
  it("says so rather than blaming the value", async () => {
    const transport = memory();
    const upgraded = await connect(transport);
    await upgraded.slot<Prefs>("preferences", { schema: 3 }).set({ theme: "dark" });

    const old = await connect(transport);
    await expect(old.slot<Prefs>("preferences", { schema: 1 }).get()).rejects.toThrowError(
      /is behind/,
    );
  });
});

describe("big values (D9)", () => {
  it("puts a value too large for a chunk in a blob and keeps the reference sealed", async () => {
    const transport = memory();
    const dd = await connect(transport);
    const slot = dd.slot<{ blob: string }>("bulk");

    const big = { blob: "x".repeat(MAX_INLINE_BYTES + 1000) };
    await slot.set(big);

    const write = transport.writes.at(-1);
    expect(write?.bytes).toBeLessThan(200); // the feed holds a reference, not the value
    expect((await slot.get())?.value).toEqual(big);
  });
});

describe("writes need a stamp until Phase 2", () => {
  it("says so plainly", async () => {
    const dd = await DappData.connect({
      entropy: mnemonic(WORDS),
      app: { id: APP },
      transport: memory(),
    });
    await expect(dd.slot<Prefs>("preferences").set({ theme: "dark" })).rejects.toThrowError(
      DappDataError,
    );
    await expect(dd.slot<Prefs>("preferences").set({ theme: "dark" })).rejects.toThrowError(
      /postage batch/,
    );
  });
});

describe("watch (D5)", () => {
  it("calls back on the first value and again when it changes", async () => {
    const transport = memory();
    const laptop = await connect(transport);
    const phone = await connect(transport);

    await laptop.slot<Prefs>("preferences").set({ theme: "dark" });

    const seen: string[] = [];
    const stop = phone
      .slot<Prefs>("preferences")
      .watch(({ value }) => seen.push(value.theme), { intervalMs: 5, maxIntervalMs: 20 });

    await vi.waitFor(() => expect(seen).toEqual(["dark"]), { timeout: 1000 });
    await laptop.slot<Prefs>("preferences").set({ theme: "light" }, { expectIndex: 0n });
    await vi.waitFor(() => expect(seen).toEqual(["dark", "light"]), { timeout: 2000 });

    stop();
    const after = seen.length;
    await laptop.slot<Prefs>("preferences").set({ theme: "sepia" }, { expectIndex: 1n });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(seen).toHaveLength(after);
  });
});
