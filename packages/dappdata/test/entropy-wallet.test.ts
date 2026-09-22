import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { fallbackDigest, typedDataDigest } from "../src/derive/message.js";
import { addressOf } from "../src/derive/kdf.js";
import { wallet } from "../src/entropy/wallet.js";
import type { Eip1193Provider } from "../src/entropy/types.js";
import { DappDataError } from "../src/errors.js";

// Throwaway test key. Never used on any network.
const PRIVATE_KEY = hexToBytes("33".repeat(32));
const ACCOUNT = addressOf(PRIVATE_KEY);
const APP = "https://demo.dappdata.example";

const signDigest = (digest: Uint8Array): string => {
  const sig = secp256k1.sign(digest, PRIVATE_KEY);
  return (
    "0x" +
    sig.r.toString(16).padStart(64, "0") +
    sig.s.toString(16).padStart(64, "0") +
    (27 + (sig.recovery ?? 0)).toString(16).padStart(2, "0")
  );
};

interface MockOptions {
  code?: string;
  typedData?: "ok" | "missing";
}

function mockWallet(options: MockOptions = {}): Eip1193Provider & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async request({ method }: { method: string }): Promise<unknown> {
      asked.push(method);
      switch (method) {
        case "eth_requestAccounts":
          return [ACCOUNT];
        case "eth_getCode":
          return options.code ?? "0x";
        case "eth_signTypedData_v4":
          if (options.typedData === "missing") {
            throw Object.assign(new Error("Method not supported"), { code: 4200 });
          }
          return signDigest(typedDataDigest(ACCOUNT, APP));
        case "personal_sign":
          return signDigest(fallbackDigest(ACCOUNT, APP));
        default:
          throw new Error(`unexpected method ${method}`);
      }
    },
  };
}

describe("the wallet source (D1, D2, D21, D25)", () => {
  it("derives from a typed-data signature", async () => {
    const provider = mockWallet();
    const result = await wallet(provider).secret({ app: APP });

    expect(result.method).toBe("eth_signTypedData_v4");
    expect(result.account).toBe(ACCOUNT);
    expect(result.secret).toHaveLength(32);
    expect(provider.asked).toContain("eth_getCode");
  });

  it("refuses a wallet without typed data unless the dapp opts into the fallback (D1)", async () => {
    await expect(wallet(mockWallet({ typedData: "missing" })).secret({ app: APP })).rejects.toThrowError(
      /does not sign typed data/,
    );
  });

  it("with the opt-in, falls back to personal_sign, and that key differs (D1)", async () => {
    const typed = await wallet(mockWallet()).secret({ app: APP });
    const fallback = await wallet(mockWallet({ typedData: "missing" }), {
      personalSignFallback: true,
    }).secret({ app: APP });

    expect(fallback.method).toBe("personal_sign");
    expect(bytesToHex(fallback.secret)).not.toBe(bytesToHex(typed.secret));
  });

  it("refuses a contract account (D2)", async () => {
    const provider = mockWallet({ code: "0x60806040523480156100" });
    await expect(wallet(provider).secret({ app: APP })).rejects.toThrowError(DappDataError);
    await expect(wallet(provider).secret({ app: APP })).rejects.toThrowError(/contract account/);
  });

  it("accepts an EIP-7702 upgraded EOA (D25)", async () => {
    const designator = "0xef0100" + "cafe".repeat(10); // 0xef0100 ‖ 20-byte address
    const result = await wallet(mockWallet({ code: designator })).secret({ app: APP });
    expect(result.method).toBe("eth_signTypedData_v4");
  });

  it("is deterministic across repeated sign-ins", async () => {
    const first = await wallet(mockWallet()).secret({ app: APP });
    const second = await wallet(mockWallet()).secret({ app: APP });
    expect(bytesToHex(second.secret)).toBe(bytesToHex(first.secret));
  });
});
