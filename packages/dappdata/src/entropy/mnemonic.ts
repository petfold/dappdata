// The mnemonic source (D21): Swarm Desktop users with no browser wallet, and
// tests that need a fixed seed. Mnemonic loss is key loss, and the SDK says so
// (T4) rather than pretending there is a recovery path.
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { EntropyResult, EntropySource } from "./types.js";
import { DappDataError } from "../errors.js";

const normalise = (words: string): string => words.normalize("NFKD").trim().replace(/\s+/g, " ");

/**
 * A BIP-39 mnemonic, checksum and all. The checksum matters here: a typo that
 * still parses would open a different, empty folder, and the user would read
 * that as "my data is gone".
 */
export function mnemonic(words: string, passphrase = ""): EntropySource {
  const phrase = normalise(words);
  if (!validateMnemonic(phrase, wordlist)) {
    throw new DappDataError(
      "unsupported",
      "that is not a valid BIP-39 mnemonic: check the words and their order",
    );
  }
  return {
    kind: "mnemonic",
    async secret(): Promise<EntropyResult> {
      return { secret: mnemonicToSeedSync(phrase, passphrase), method: "bip39" };
    },
  };
}
