// The wallet source: one signature over the D1 message (D21 default).
import { fallbackDigest, fallbackText, typedDataDigest, typedDataV4Json } from "../derive/message.js";
import { secretFromSignature } from "../derive/signature.js";
import { assertSigningAccount } from "../siwe/account.js";
import { DappDataError } from "../errors.js";
import type { Eip1193Provider, EntropyContext, EntropyResult, EntropySource } from "./types.js";

export interface WalletSourceOptions {
  /** Which account to derive from. Default: the provider's first account. */
  account?: string;
  /** Skip the contract-account check when the dapp has already done it. */
  skipAccountCheck?: boolean;
}

const utf8 = new TextEncoder();

const hexOf = (text: string): string =>
  "0x" + Array.from(utf8.encode(text), (b) => b.toString(16).padStart(2, "0")).join("");

function isMethodMissing(error: unknown): boolean {
  const e = error as { code?: number; message?: string } | undefined;
  if (e?.code === 4200 || e?.code === -32601) return true;
  return /not (supported|found)|unsupported method|unknown method/i.test(e?.message ?? "");
}

/**
 * The dapp passes an EIP-1193 provider; the SDK never reads `window.ethereum`,
 * because several wallet extensions fight over that global and EIP-6963 is the
 * discovery path dapps already use.
 */
export function wallet(provider: Eip1193Provider, options: WalletSourceOptions = {}): EntropySource {
  return {
    kind: "wallet",
    async secret(ctx: EntropyContext): Promise<EntropyResult> {
      const account = options.account ?? (await firstAccount(provider));
      if (!options.skipAccountCheck) await assertSigningAccount(provider, account);

      try {
        const signature = (await provider.request({
          method: "eth_signTypedData_v4",
          params: [account, typedDataV4Json(account, ctx.app)],
        })) as string;
        return {
          secret: secretFromSignature(signature, typedDataDigest(account, ctx.app), account),
          account,
          method: "eth_signTypedData_v4",
        };
      } catch (error) {
        if (!isMethodMissing(error)) throw error;
      }

      // D1 fallback. It yields a different key, so a restore reads under the
      // typed-data key first and then under this one.
      const signature = (await provider.request({
        method: "personal_sign",
        params: [hexOf(fallbackText(account, ctx.app)), account],
      })) as string;
      return {
        secret: secretFromSignature(signature, fallbackDigest(account, ctx.app), account),
        account,
        method: "personal_sign",
      };
    },
  };
}

async function firstAccount(provider: Eip1193Provider): Promise<string> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts?.[0];
  if (!account) {
    throw new DappDataError("unsupported", "the provider returned no account to derive from");
  }
  return account;
}
