/**
 * Envelope crypto (D9, D20). A pure module: it takes any WebCrypto AES-GCM key
 * and a caller-chosen AAD, so other Swarm libraries can reuse the format for
 * keys that have nothing to do with a dappdata folder.
 *
 * The header travels inside the AAD, so a schema byte or a mode cannot be
 * edited on the wire, and the caller's AAD (the SDK passes the feed topic)
 * stops a ciphertext being replayed into another slot.
 */
import { DappDataError } from "../errors.js";
import {
  ALG_AES_256_GCM,
  HEADER_BYTES,
  Mode,
  NONCE_BYTES,
  VERSION,
  bodyOf,
  concat,
  nonceOf,
  readHeader,
  writeHeader,
} from "./frame.js";

export * from "./frame.js";

const utf8 = new TextEncoder();

export interface SealOptions {
  /** Bound into the ciphertext; the SDK passes the feed topic. */
  aad: string;
  /** The dapp's version of the value's shape (D22). Default 0. */
  schema?: number;
  /** INLINE for a value, REF for a 64-byte Swarm reference. Default INLINE. */
  mode?: Mode;
}

export interface Opened {
  value: Uint8Array;
  schema: number;
  mode: Mode;
}

/** Import raw key material as a non-extractable AES-GCM key. */
export async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) {
    throw new DappDataError("bad-envelope", `AES-256 needs 32 key bytes, got ${raw.length}`);
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function seal(
  key: CryptoKey,
  value: Uint8Array,
  options: SealOptions,
): Promise<Uint8Array> {
  const mode = options.mode ?? Mode.INLINE;
  const header = writeHeader({
    version: VERSION,
    alg: ALG_AES_256_GCM,
    mode,
    schema: options.schema ?? 0,
  });
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const additionalData = concat(header, utf8.encode(options.aad));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: additionalData as BufferSource },
      key,
      value as BufferSource,
    ),
  );
  return concat(header, nonce, ciphertext);
}

export async function open(
  key: CryptoKey,
  frame: Uint8Array,
  aad: string,
): Promise<Opened> {
  const header = readHeader(frame);
  const additionalData = concat(frame.subarray(0, HEADER_BYTES), utf8.encode(aad));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonceOf(frame) as BufferSource,
        additionalData: additionalData as BufferSource,
      },
      key,
      bodyOf(frame) as BufferSource,
    );
  } catch (cause) {
    throw new DappDataError(
      "bad-envelope",
      "the envelope did not open: wrong key, wrong slot, or altered bytes",
      { cause },
    );
  }
  return { value: new Uint8Array(plaintext), schema: header.schema, mode: header.mode };
}
