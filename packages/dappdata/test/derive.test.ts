import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  deriveFolderKeys,
  deriveSeed,
  deriveSubKey,
  fallbackDigest,
  secretFromSignature,
  typedDataDigest,
} from "../src/derive/index.js";
import { mnemonic } from "../src/entropy/mnemonic.js";
import { DappDataError } from "../src/errors.js";

// Throwaway test key. Never used on any network.
const PRIVATE_KEY = hexToBytes("11".repeat(32));
const ACCOUNT = "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a";
const APP = "https://demo.dappdata.example";

const sign = (digest: Uint8Array, v: 27 | 0 = 27): Uint8Array => {
  const sig = secp256k1.sign(digest, PRIVATE_KEY);
  return new Uint8Array([
    ...hexToBytes(sig.r.toString(16).padStart(64, "0")),
    ...hexToBytes(sig.s.toString(16).padStart(64, "0")),
    v + (sig.recovery ?? 0),
  ]);
};

describe("the signed message", () => {
  // Cross-checked against ethers v6 TypedDataEncoder.hash and hashMessage.
  // These digests are what the wallet signs; changing them changes every key.
  it("hashes the typed data the way every wallet will", () => {
    const account = "0x13cB9947C508cf52a233a1E97d80Dd2485589481";
    expect("0x" + bytesToHex(typedDataDigest(account, APP))).toBe(
      "0xaac4f125e1a5622f596c3a66edf685569502383fb9542dc44ead3bb4af6341f7",
    );
  });

  it("hashes the personal_sign fallback the same way ethers does", () => {
    const account = "0x13cB9947C508cf52a233a1E97d80Dd2485589481";
    expect("0x" + bytesToHex(fallbackDigest(account, APP))).toBe(
      "0x9004702a2a9bcc149efb1c764e0f16704f1834890085bbe9d9655f590bc68f7e",
    );
  });
});

describe("the secret (D15)", () => {
  const digest = typedDataDigest(ACCOUNT, APP);

  it("ignores the recovery byte encoding", () => {
    const as27 = secretFromSignature(sign(digest, 27), digest, ACCOUNT);
    const as0 = secretFromSignature(sign(digest, 0), digest, ACCOUNT);
    expect(bytesToHex(as0)).toBe(bytesToHex(as27));
  });

  it("ignores a high-s encoding of the same signature", () => {
    const n = secp256k1.CURVE.n;
    const low = sign(digest, 27);
    const s = BigInt("0x" + bytesToHex(low.subarray(32, 64)));
    const high = new Uint8Array(low);
    high.set(hexToBytes((n - s).toString(16).padStart(64, "0")), 32);
    high[64] = (low[64] as number) === 27 ? 28 : 27; // flipping s flips recovery

    expect(bytesToHex(secretFromSignature(high, digest, ACCOUNT))).toBe(
      bytesToHex(secretFromSignature(low, digest, ACCOUNT)),
    );
  });

  it("refuses a signature from another account", () => {
    const sig = sign(digest);
    const other = "0x0000000000000000000000000000000000000001";
    expect(() => secretFromSignature(sig, digest, other)).toThrowError(DappDataError);
    try {
      secretFromSignature(sig, digest, other);
    } catch (error) {
      expect((error as DappDataError).code).toBe("wrong-account");
    }
  });

  it("refuses bytes that are not a signature", () => {
    expect(() => secretFromSignature(new Uint8Array(64), digest, ACCOUNT)).toThrowError(
      /65 signature bytes/,
    );
  });
});

describe("keys (D16, D17, D21)", () => {
  const secret = secretFromSignature(sign(typedDataDigest(ACCOUNT, APP)), typedDataDigest(ACCOUNT, APP), ACCOUNT);

  it("gives a different folder per app", () => {
    const here = deriveFolderKeys(deriveSeed(secret, APP));
    const elsewhere = deriveFolderKeys(deriveSeed(secret, "https://other.example"));
    expect(here.feedAddress).not.toBe(elsewhere.feedAddress);
    expect(bytesToHex(here.encKey)).not.toBe(bytesToHex(elsewhere.encKey));
  });

  it("derives the same folder twice", () => {
    const first = deriveFolderKeys(deriveSeed(secret, APP));
    const second = deriveFolderKeys(deriveSeed(secret, APP));
    expect(second.feedAddress).toBe(first.feedAddress);
    expect(bytesToHex(second.encKey)).toBe(bytesToHex(first.encKey));
  });

  it("keeps sub-keys apart from the folder keys and from each other", () => {
    const seed = deriveSeed(secret, APP);
    const folder = deriveFolderKeys(seed);
    const docs = deriveSubKey(seed, "swarm-collaborative-docs");
    const gsoc = deriveSubKey(seed, "gsoc");

    expect(bytesToHex(docs.key)).not.toBe(bytesToHex(folder.feedKey));
    expect(docs.address).not.toBe(gsoc.address);
    expect(deriveSubKey(seed, "gsoc").address).toBe(gsoc.address);
  });

  // Golden vector. If this changes, every existing user's folder has moved:
  // the derivation spec is frozen for v1 (D15, D16, D17, D21).
  it("pins the v1 derivation", () => {
    const seed = deriveSeed(hexToBytes("22".repeat(32)), APP);
    const folder = deriveFolderKeys(seed);
    expect(folder.feedAddress).toBe("0x70cbce3b51bc7857711be378a0977d2f0a6adde6");
    expect(bytesToHex(folder.encKey)).toBe(
      "289b6e1114fbd5112fecca5413f3969088858aa69c60446150ce7ec42df0135d",
    );
  });
});

describe("the mnemonic source (D21)", () => {
  // Throwaway BIP-39 test vector, never funded.
  const WORDS = "legal winner thank year wave sausage worth useful legal winner thank yellow";

  it("is deterministic and binds to the app like any other source", async () => {
    const source = mnemonic(WORDS);
    const { secret } = await source.secret({ app: APP });
    const again = await mnemonic(WORDS).secret({ app: APP });
    expect(bytesToHex(again.secret)).toBe(bytesToHex(secret));

    const here = deriveFolderKeys(deriveSeed(secret, APP)).feedAddress;
    const elsewhere = deriveFolderKeys(deriveSeed(secret, "https://other.example")).feedAddress;
    expect(here).not.toBe(elsewhere);
  });

  it("separates a passphrase-protected mnemonic from a bare one", async () => {
    const bare = await mnemonic(WORDS).secret({ app: APP });
    const guarded = await mnemonic(WORDS, "hunter2").secret({ app: APP });
    expect(bytesToHex(guarded.secret)).not.toBe(bytesToHex(bare.secret));
  });

  it("refuses something that is not a mnemonic", () => {
    expect(() => mnemonic("too few words")).toThrowError(/at least 12 words/);
  });
});
