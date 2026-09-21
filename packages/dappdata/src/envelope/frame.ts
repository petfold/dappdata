// The frame every stored value wears (D9, D20, D22).
//
//   version(1) | alg(1) | mode(1) | schema(1) | nonce(12) | body
//
// INLINE bodies are the ciphertext of the value itself. REF bodies are the
// ciphertext of a 64-byte Swarm reference to a blob uploaded with Swarm's own
// encryption, so a reader who can read the feed still learns nothing.
import { DappDataError } from "../errors.js";

export const VERSION = 1;
export const ALG_AES_256_GCM = 1;
export const HEADER_BYTES = 4;
export const NONCE_BYTES = 12;

export const Mode = { INLINE: 1, REF: 2 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export interface Header {
  version: number;
  alg: number;
  mode: Mode;
  /** The dapp's own version of the value's shape (D22). */
  schema: number;
}

export function writeHeader(header: Header): Uint8Array {
  const { schema } = header;
  if (!Number.isInteger(schema) || schema < 0 || schema > 255) {
    throw new DappDataError("bad-envelope", `schema must be one byte, got ${String(schema)}`);
  }
  return new Uint8Array([header.version, header.alg, header.mode, schema]);
}

export function readHeader(frame: Uint8Array): Header {
  if (frame.length < HEADER_BYTES + NONCE_BYTES + 1) {
    throw new DappDataError("bad-envelope", `frame too short: ${frame.length} bytes`);
  }
  const version = frame[0] as number;
  const alg = frame[1] as number;
  const mode = frame[2] as number;
  const schema = frame[3] as number;
  if (version !== VERSION) {
    throw new DappDataError("bad-envelope", `unknown envelope version ${version}`);
  }
  if (alg !== ALG_AES_256_GCM) {
    throw new DappDataError("bad-envelope", `unknown algorithm ${alg}`);
  }
  if (mode !== Mode.INLINE && mode !== Mode.REF) {
    throw new DappDataError("bad-envelope", `unknown mode ${mode}`);
  }
  return { version, alg, mode, schema };
}

export const nonceOf = (frame: Uint8Array): Uint8Array =>
  frame.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);

export const bodyOf = (frame: Uint8Array): Uint8Array =>
  frame.subarray(HEADER_BYTES + NONCE_BYTES);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
