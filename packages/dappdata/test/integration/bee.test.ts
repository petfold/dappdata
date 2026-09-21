/**
 * Integration tests against a real Bee node — bee-factory locally
 * (`npx @ethersphere/bee-factory start`), or any node whose API you point at.
 *
 *   DAPPDATA_BEE_URL=http://127.0.0.1:1633 \
 *   DAPPDATA_STAMP=<batch id> \
 *   pnpm test:integration
 *
 * Nothing in CI touches a real network (PLAN, "Tests"), and the suite skips
 * itself unless both variables are set. Never point it at a mainnet node: a
 * write spends postage (CLAUDE.md, working rule 4).
 */
import { describe, expect, it, vi } from "vitest";
import { DappData } from "../../src/dappdata.js";
import { mnemonic } from "../../src/entropy/mnemonic.js";
import { http } from "../../src/transport/http.js";
import { fetchTransport } from "../../src/transport/fetch.js";
import { MAX_INLINE_BYTES } from "../../src/slot/index.js";
import type { Transport } from "../../src/transport/types.js";

const URL = process.env.DAPPDATA_BEE_URL;
const STAMP = process.env.DAPPDATA_STAMP;
const run = URL && STAMP ? describe : describe.skip;

// Throwaway BIP-39 test vector. Never funded.
const WORDS = "legal winner thank year wave sausage worth useful legal winner thank yellow";

interface Prefs {
  theme: string;
  updatedAt: number;
}

const connect = (transport: Transport, app: string): Promise<DappData> =>
  DappData.connect({
    entropy: mnemonic(WORDS, app), // a fresh folder per run, so tests never collide
    app: { id: app },
    transport,
    stamp: STAMP as string,
  });

for (const [name, make] of [
  ["bee-js transport (dappdata/transport/bee-js)", () => http(URL as string)],
  ["fetch transport (the default)", () => fetchTransport(URL as string)],
] as const) {
  run(`${name}, against a real node`, () => {
    it("writes a slot and reads it back", async () => {
      const app = `test-${name}-${Date.now()}`;
      const dd = await connect(make(), app);
      const prefs = dd.slot<Prefs>("preferences", { schema: 1 });

      expect(await prefs.get()).toBeNull();
      await prefs.set({ theme: "dark", updatedAt: Date.now() });

      const current = await prefs.get();
      expect(current?.value.theme).toBe("dark");
      expect(current?.index).toBe(0n);
      expect(current?.schema).toBe(1);

      // A second reader, with no memory of the write, has to wait for the
      // chunk to become readable: about a second on bee-factory.
      const reader = await connect(make(), app);
      await vi.waitFor(
        async () => {
          const seen = await reader.slot<Prefs>("preferences", { schema: 1 }).get();
          expect(seen?.value.theme).toBe("dark");
        },
        { timeout: 30_000, interval: 250 },
      );
    }, 60_000);

    it("keeps the state unreadable on the wire (C5)", async () => {
      const app = `test-wire-${name}-${Date.now()}`;
      const transport = make();
      const dd = await connect(transport, app);
      await dd.slot<Prefs>("preferences").set({ theme: "sepia", updatedAt: 1 });

      const { slotTopic } = await import("../../src/dappdata.js");
      await vi.waitFor(
        async () => {
          const raw = await transport.getFeedUpdate({
            owner: dd.address,
            topic: slotTopic(app, "preferences"),
            index: 0n,
          });
          expect(raw).not.toBeNull();
          // What a network observer gets: the sealed frame, not the value.
          expect(new TextDecoder().decode(raw as Uint8Array)).not.toContain("sepia");
          expect(new TextDecoder().decode(raw as Uint8Array)).not.toContain("theme");
        },
        { timeout: 30_000, interval: 250 },
      );
    }, 60_000);

    it("sends a large value to an encrypted blob and back (D9)", async () => {
      const app = `test-blob-${name}-${Date.now()}`;
      const dd = await connect(make(), app);
      const slot = dd.slot<{ blob: string }>("bulk");
      const big = { blob: "x".repeat(MAX_INLINE_BYTES + 5_000) };

      await slot.set(big);
      expect((await slot.get())?.value).toEqual(big);
    }, 120_000);
  });
}

run("the two transports agree", () => {
  it("reads with fetch what bee-js wrote (same feed, same bytes)", async () => {
    const app = `test-interop-${Date.now()}`;
    const written = await connect(http(URL as string), app);
    await written.slot<Prefs>("preferences").set({ theme: "dark", updatedAt: 7 });

    const read = await connect(fetchTransport(URL as string), app);
    await vi.waitFor(
      async () => {
        expect((await read.slot<Prefs>("preferences").get())?.value.theme).toBe("dark");
      },
      { timeout: 30_000, interval: 250 },
    );
  }, 60_000);
});

run("the README example, against a real node (C1)", () => {
  it("stores state and restores it on a fresh device (C2)", async () => {
    const app = `test-readme-${Date.now()}`;
    const rendered: string[] = [];

    // The README's lines, with the mnemonic source standing in for a wallet.
    const dd = await connect(http(URL as string), app);
    const prefs = dd.slot<Prefs>("preferences", { schema: 1 });
    const current = await prefs.get();
    await prefs.set({ theme: "dark", updatedAt: Date.now() }, { expectIndex: current?.index });
    const stop = prefs.watch(({ value }) => rendered.push(value.theme), { intervalMs: 500 });

    // A fresh device: same words, same app, nothing carried across.
    const freshDevice = await connect(http(URL as string), app);
    expect(freshDevice.address).toBe(dd.address);
    await vi.waitFor(
      async () => {
        const restored = await freshDevice.slot<Prefs>("preferences", { schema: 1 }).get();
        expect(restored?.value.theme).toBe("dark");
      },
      { timeout: 30_000, interval: 250 },
    );

    await vi.waitFor(() => expect(rendered).toContain("dark"), { timeout: 10_000 });
    stop();
  }, 120_000);
});
