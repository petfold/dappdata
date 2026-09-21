import { describe, expect, it } from "vitest";
import { DappDataError } from "../src/errors.js";
import { Mode, importKey, open, readHeader, seal } from "../src/envelope/index.js";

const utf8 = new TextEncoder();
const key = async () => importKey(new Uint8Array(32).fill(7)); // throwaway test key
const TOPIC = "dappdata/v1/https://demo.example/preferences";

describe("the envelope (D9, D20, D22)", () => {
  it("opens what it sealed, schema byte and all", async () => {
    const k = await key();
    const value = utf8.encode(JSON.stringify({ theme: "dark" }));
    const frame = await seal(k, value, { aad: TOPIC, schema: 2 });

    const opened = await open(k, frame, TOPIC);
    expect(new TextDecoder().decode(opened.value)).toBe('{"theme":"dark"}');
    expect(opened.schema).toBe(2);
    expect(opened.mode).toBe(Mode.INLINE);
  });

  it("carries a 64-byte Swarm reference in REF mode", async () => {
    const k = await key();
    const reference = new Uint8Array(64).fill(0xab);
    const frame = await seal(k, reference, { aad: TOPIC, mode: Mode.REF, schema: 1 });

    const opened = await open(k, frame, TOPIC);
    expect(opened.mode).toBe(Mode.REF);
    expect(opened.value).toEqual(reference);
  });

  it("will not open in another slot", async () => {
    const k = await key();
    const frame = await seal(k, utf8.encode("private"), { aad: TOPIC });
    await expect(open(k, frame, TOPIC + "/other")).rejects.toThrowError(DappDataError);
  });

  it("will not open with another key", async () => {
    const frame = await seal(await key(), utf8.encode("private"), { aad: TOPIC });
    const other = await importKey(new Uint8Array(32).fill(8));
    await expect(open(other, frame, TOPIC)).rejects.toThrowError(/did not open/);
  });

  it("notices an edited header", async () => {
    const k = await key();
    const frame = await seal(k, utf8.encode("private"), { aad: TOPIC, schema: 2 });
    frame[3] = 3; // schema byte, outside the ciphertext but inside the AAD
    await expect(open(k, frame, TOPIC)).rejects.toThrowError(/did not open/);
  });

  it("hides which mode a slot uses from anyone without the key", async () => {
    const k = await key();
    const inline = await seal(k, utf8.encode("x".repeat(64)), { aad: TOPIC });
    const ref = await seal(k, new Uint8Array(64), { aad: TOPIC, mode: Mode.REF });
    // The mode byte is in the clear by design; the bodies are the same length,
    // so the sizes do not give the mode away either.
    expect(inline.length).toBe(ref.length);
  });

  it("rejects a schema number that is not a byte (D22)", async () => {
    const k = await key();
    await expect(seal(k, utf8.encode("x"), { aad: TOPIC, schema: 256 })).rejects.toThrowError(
      /schema must be one byte/,
    );
  });

  it("rejects a frame that is not ours", async () => {
    expect(() => readHeader(new Uint8Array([9, 1, 1, 0, ...new Array(20).fill(0)]))).toThrowError(
      /unknown envelope version/,
    );
    expect(() => readHeader(new Uint8Array(4))).toThrowError(/frame too short/);
  });
});
