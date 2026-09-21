import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3";
import { hexToBytes } from "@noble/hashes/utils";
import { SequentialFeed } from "../src/feed/index.js";
import { ConflictError } from "../src/errors.js";
import { addressOf } from "../src/derive/kdf.js";
import { memory } from "../src/transport/memory.js";

// Throwaway test key. Never used on any network.
const KEY = hexToBytes("44".repeat(32));
const OWNER = addressOf(KEY);
const TOPIC = keccak_256(new TextEncoder().encode("dappdata/v1/test/slot"));
const STAMP = "00".repeat(32);

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

const feed = (transport = memory(), writable = true): SequentialFeed =>
  new SequentialFeed({
    transport,
    owner: OWNER,
    topic: TOPIC,
    ...(writable ? { signer: KEY } : {}),
  });

describe("the sequential feed (D5, D6)", () => {
  it("appends from zero and remembers where it got to", async () => {
    const f = feed();
    expect(await f.latest()).toBeNull();

    expect(await f.append(utf8("one"), { stamp: STAMP })).toBe(0n);
    expect(await f.append(utf8("two"), { stamp: STAMP, expectIndex: 0n })).toBe(1n);
    expect(f.knownIndex).toBe(1n);

    const head = await f.latest();
    expect(head?.index).toBe(1n);
    expect(text(head?.payload as Uint8Array)).toBe("two");
  });

  it("walks forward when another device wrote in between", async () => {
    const transport = memory();
    const mine = feed(transport);
    const theirs = feed(transport);

    await mine.append(utf8("one"), { stamp: STAMP });
    await mine.latest(); // my cache says 0
    await theirs.append(utf8("two"), { stamp: STAMP, expectIndex: 0n });
    await theirs.append(utf8("three"), { stamp: STAMP, expectIndex: 1n });

    const head = await mine.latest();
    expect(head?.index).toBe(2n);
    expect(text(head?.payload as Uint8Array)).toBe("three");
  });

  it("refuses to overwrite an index another device took (D6)", async () => {
    const transport = memory();
    const mine = feed(transport);
    const theirs = feed(transport);

    await mine.append(utf8("one"), { stamp: STAMP });
    await theirs.append(utf8("two"), { stamp: STAMP, expectIndex: 0n });

    // My view is still index 0, so I aim at 1 — which is taken.
    await expect(mine.append(utf8("mine"), { stamp: STAMP, expectIndex: 0n })).rejects.toBeInstanceOf(
      ConflictError,
    );
    try {
      await mine.append(utf8("mine"), { stamp: STAMP, expectIndex: 0n });
    } catch (error) {
      expect((error as ConflictError).index).toBe(1n);
      expect(text((error as ConflictError).payload)).toBe("two");
    }
  });

  it("takes a hint instead of a lookup (D5)", async () => {
    const transport = memory();
    const writer = feed(transport);
    await writer.append(utf8("one"), { stamp: STAMP });
    await writer.append(utf8("two"), { stamp: STAMP, expectIndex: 0n });

    let lookups = 0;
    const counted = {
      ...transport,
      findLatest: (args: Parameters<typeof transport.findLatest>[0]) => {
        lookups += 1;
        return transport.findLatest(args);
      },
    };
    const reader = new SequentialFeed({ transport: counted, owner: OWNER, topic: TOPIC });
    reader.hint(1n);

    expect(text((await reader.latest())?.payload as Uint8Array)).toBe("two");
    expect(lookups).toBe(0);
  });

  it("will not write without a key", async () => {
    await expect(feed(memory(), false).append(utf8("x"), { stamp: STAMP })).rejects.toThrowError(
      /read-only/,
    );
  });
});
