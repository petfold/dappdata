// Turning a wallet signature into the secret the keys hang off (D15).
//
// The recovery byte is an encoding choice, not part of the signature: wallets
// report 27/28, 0/1, or EIP-155 values, and a high-`s` signature would differ
// again. Same account, same message, two seeds, two folders. So the secret is
// taken over `r ‖ s` with `s` in the low half of the curve order, and the SDK
// recovers the public key to make sure the signature is the account's.
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { DappDataError } from "../errors.js";

const N = secp256k1.CURVE.n;
const HALF_N = N / 2n;

export interface SplitSignature {
  r: bigint;
  s: bigint;
  /** 0 or 1, whatever encoding the wallet used. */
  recovery: number;
}

const strip0x = (hex: string): string => (hex.startsWith("0x") ? hex.slice(2) : hex);

/** Split a 65-byte signature and canonicalise the recovery bit (compact, EIP-155 — D15, D24). */
export function splitSignature(signature: string | Uint8Array): SplitSignature {
  const bytes = typeof signature === "string" ? hexToBytes(strip0x(signature)) : signature;
  if (bytes.length !== 65) {
    throw new DappDataError("bad-signature", `expected 65 signature bytes, got ${bytes.length}`);
  }
  const r = BigInt("0x" + bytesToHex(bytes.subarray(0, 32)));
  const s = BigInt("0x" + bytesToHex(bytes.subarray(32, 64)));
  const v = bytes[64] as number;

  let recovery: number;
  if (v === 0 || v === 1) recovery = v;
  else if (v === 27 || v === 28) recovery = v - 27;
  else if (v >= 35) recovery = (v - 35) % 2; // EIP-155
  else throw new DappDataError("bad-signature", `unknown recovery byte ${v}`);

  if (r <= 0n || r >= N || s <= 0n || s >= N) {
    throw new DappDataError("bad-signature", "r or s outside the curve order");
  }
  return { r, s, recovery };
}

const to32 = (value: bigint): Uint8Array => hexToBytes(value.toString(16).padStart(64, "0"));

/** Normalise `s` to the low half of the curve order, and flip the recovery bit with it. */
export function lowS(sig: SplitSignature): SplitSignature {
  if (sig.s <= HALF_N) return sig;
  return { r: sig.r, s: N - sig.s, recovery: sig.recovery ^ 1 };
}

export function addressFromPublicKey(uncompressed: Uint8Array): string {
  return "0x" + bytesToHex(keccak_256(uncompressed.subarray(1)).subarray(12));
}

/** Which account signed this digest. */
export function recoverAddress(digest: Uint8Array, sig: SplitSignature): string {
  const point = secp256k1.Signature.fromCompact(
    new Uint8Array([...to32(sig.r), ...to32(sig.s)]),
  )
    .addRecoveryBit(sig.recovery)
    .recoverPublicKey(digest);
  return addressFromPublicKey(point.toRawBytes(false));
}

/**
 * The secret: `keccak256(r ‖ s_low)`, after checking the signature really is
 * the connected account's. A wrong account would otherwise open an empty
 * folder in silence, which is the failure users cannot diagnose (D15).
 */
export function secretFromSignature(
  signature: string | Uint8Array,
  digest: Uint8Array,
  account: string,
): Uint8Array {
  const raw = splitSignature(signature);
  const signer = recoverAddress(digest, raw);
  if (signer.toLowerCase() !== account.toLowerCase()) {
    throw new DappDataError(
      "wrong-account",
      `the wallet signed as ${signer}, not ${account.toLowerCase()}`,
    );
  }
  const norm = lowS(raw);
  return keccak_256(new Uint8Array([...to32(norm.r), ...to32(norm.s)]));
}
