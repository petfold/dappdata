// Secret → seed → keys (D15, D17, D21).
//
// The primitive is swarm-id's `HMAC-SHA256(key, utf8(context))` rather than
// HKDF, so the two projects can publish the same test vectors (D24). The app
// binding is applied after the entropy source, the same way for every source,
// so a mnemonic user gets per-app isolation too (D21).
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { secp256k1 } from "@noble/curves/secp256k1";

const N = secp256k1.CURVE.n;
const utf8 = new TextEncoder();

export const SEED_CONTEXT = "dappdata/seed/v1/";
export const FEED_CONTEXT = "dappdata/feed/v1";
export const ENC_CONTEXT = "dappdata/enc/v1";
export const SUB_CONTEXT = "dappdata/sub/v1/";

export const kdf = (key: Uint8Array, context: string): Uint8Array =>
  hmac(sha256, key, utf8.encode(context));

/** The app-bound seed. Every entropy source passes through here (D21). */
export const deriveSeed = (secret: Uint8Array, app: string): Uint8Array =>
  kdf(secret, SEED_CONTEXT + app);

/** A secp256k1 private key from a context string; re-hash on the (never seen) zero. */
export function deriveScalar(seed: Uint8Array, context: string): Uint8Array {
  for (let round = 0; ; round++) {
    const out = kdf(seed, round === 0 ? context : `${context}/retry${round}`);
    const k = BigInt("0x" + bytesToHex(out)) % N;
    if (k !== 0n) return hexToBytes(k.toString(16).padStart(64, "0"));
  }
}

export function addressOf(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, false).subarray(1);
  return "0x" + bytesToHex(keccak_256(pub).subarray(12));
}

export interface FolderKeys {
  /** secp256k1 key that owns the user's feeds. Never leaves the SDK (T2, T10). */
  feedKey: Uint8Array;
  /** The address a reader needs to find those feeds. */
  feedAddress: string;
  /** AES-256 key material, imported into WebCrypto as non-extractable. */
  encKey: Uint8Array;
}

export function deriveFolderKeys(seed: Uint8Array): FolderKeys {
  const feedKey = deriveScalar(seed, FEED_CONTEXT);
  return { feedKey, feedAddress: addressOf(feedKey), encKey: kdf(seed, ENC_CONTEXT) };
}

/**
 * A sub-key for another library (D17). The dapp may hold this one: it opens
 * what that library wrote and nothing else, because the folder keys hang off
 * other contexts and HMAC does not run backwards.
 */
export function deriveSubKey(seed: Uint8Array, purpose: string): {
  key: Uint8Array;
  address: string;
} {
  const key = deriveScalar(seed, SUB_CONTEXT + purpose);
  return { key, address: addressOf(key) };
}
