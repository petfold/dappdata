// The README example, run. C1 says a dapp adds persistent state in a handful
// of lines; this keeps the claim honest between bee-factory runs. The only
// change from the README is the transport and the entropy source, so the test
// needs no node and no wallet.
import { describe, expect, it } from "vitest";
import { DappData, entropy, transport } from "../src/index.js";

// Throwaway BIP-39 test vector. Never funded.
const WORDS = "legal winner thank year wave sausage worth useful legal winner thank yellow";

interface Prefs {
  theme: string;
}

describe("the README example (C1)", () => {
  it("stores state, and a fresh device reads it back (C2)", async () => {
    const bee = transport.memory();
    const batchId = "00".repeat(32);
    const rendered: string[] = [];

    const dd = await DappData.connect({
      entropy: entropy.mnemonic(WORDS),
      app: { id: "https://demo.dappdata.example" },
      transport: bee,
      stamp: batchId,
    });

    const prefs = dd.slot<Prefs>("preferences", { schema: 1 });
    const current = await prefs.get();
    await prefs.set({ theme: "dark" }, { expectIndex: current?.index });
    const stop = prefs.watch(({ value }) => rendered.push(value.theme), { intervalMs: 5 });

    // A new laptop: same words, same app, nothing carried across.
    const freshDevice = await DappData.connect({
      entropy: entropy.mnemonic(WORDS),
      app: { id: "https://demo.dappdata.example" },
      transport: bee,
      stamp: batchId,
    });
    const restored = await freshDevice.slot<Prefs>("preferences", { schema: 1 }).get();
    expect(restored?.value).toEqual({ theme: "dark" });
    expect(freshDevice.address).toBe(dd.address);

    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    expect(rendered).toContain("dark");
  });
});
