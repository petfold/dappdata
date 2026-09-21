// Is this account an EOA that can sign deterministically? (D2, D25)
import { DappDataError } from "../errors.js";
import type { Eip1193Provider } from "../entropy/types.js";

/** EIP-7702 delegation designator: `0xef0100 ‖ address`, 23 bytes. */
const DELEGATION_PREFIX = "ef0100";

/**
 * ERC-1271 and passkey wallets cannot produce a deterministic secp256k1
 * signature, so the SDK refuses them with an error the dapp can show. One
 * exception (D25): an EIP-7702 upgraded EOA carries the delegation
 * designator as code and still signs with its own key.
 */
export async function assertSigningAccount(
  provider: Eip1193Provider,
  account: string,
): Promise<void> {
  const code = (await provider.request({
    method: "eth_getCode",
    params: [account, "latest"],
  })) as string | null;

  const hex = (code ?? "0x").replace(/^0x/, "").toLowerCase();
  if (hex === "" || /^0+$/.test(hex)) return;
  if (hex.length === 46 && hex.startsWith(DELEGATION_PREFIX)) return; // 7702 EOA

  throw new DappDataError(
    "contract-account",
    `${account} is a contract account; dappdata needs an account that signs with its own key ` +
      `(see D2). A smart account can still use dappdata through a mnemonic or passkey source.`,
  );
}
