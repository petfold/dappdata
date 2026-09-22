import { describe, expect, it } from "vitest";
import { fetchTransport } from "../src/transport/fetch.js";

const TOPIC = new Uint8Array(32).fill(7);
const OWNER = "0x" + "11".repeat(20);

/** A Bee that never answers a chunk read; the caller's timeout must win. */
const hangingBee: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });

describe("fetch transport options (D5, T18)", () => {
  it("treats a read by index that outlives the probe timeout as missing", async () => {
    const transport = fetchTransport("http://bee.test", hangingBee, { probeTimeoutMs: 20 });
    const started = Date.now();
    expect(await transport.getFeedUpdate({ owner: OWNER, topic: TOPIC, index: 3n })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("sends deferred and pin headers on a feed update when asked", async () => {
    const seen: Array<Record<string, string>> = [];
    const recordingBee: typeof fetch = async (_url, init) => {
      seen.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)));
      return new Response(null, { status: 201 });
    };
    const key = new Uint8Array(32).fill(9);
    const write = (options: Parameters<typeof fetchTransport>[2]) =>
      fetchTransport("http://bee.test", recordingBee, options).putFeedUpdate({
        signer: key,
        topic: TOPIC,
        index: 0n,
        payload: new Uint8Array([1, 2, 3]),
        stamp: "ab".repeat(32),
      });

    await write({});
    await write({ deferred: true, pin: true });

    expect(seen[0]).not.toHaveProperty("swarm-deferred-upload");
    expect(seen[0]).not.toHaveProperty("swarm-pin");
    expect(seen[1]).toMatchObject({ "swarm-deferred-upload": "true", "swarm-pin": "true" });
    expect(seen[1]).toHaveProperty("swarm-postage-batch-id");
  });
});
