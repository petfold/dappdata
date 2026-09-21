// The mnemonic source (D21): Swarm Desktop users with no browser wallet, and
// tests that need a fixed seed. Mnemonic loss is key loss, and the SDK says so
// (T4) rather than pretending there is a recovery path.
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha512 } from "@noble/hashes/sha2";
import type { EntropyResult, EntropySource } from "./types.js";
import { DappDataError } from "../errors.js";

const utf8 = new TextEncoder();
const normalise = (words: string): string => words.normalize("NFKD").trim().replace(/\s+/g, " ");

/**
 * BIP-39 seed derivation, the standard PBKDF2 with 2048 rounds of HMAC-SHA512.
 * The words are not checked against a wordlist: that needs a wordlist
 * dependency, which `docs/ARCHITECTURE.md` does not list yet (working rule 7).
 * A typo therefore opens a different, empty folder — the dapp should confirm
 * the derived address with the user before writing.
 */
export function mnemonic(words: string, passphrase = ""): EntropySource {
  const phrase = normalise(words);
  if (phrase.split(" ").length < 12) {
    throw new DappDataError("unsupported", "a BIP-39 mnemonic needs at least 12 words");
  }
  return {
    kind: "mnemonic",
    async secret(): Promise<EntropyResult> {
      return {
        secret: pbkdf2(sha512, utf8.encode(phrase), utf8.encode("mnemonic" + passphrase), {
          c: 2048,
          dkLen: 64,
        }),
        method: "bip39",
      };
    },
  };
}
