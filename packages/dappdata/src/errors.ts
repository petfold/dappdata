/**
 * Every error the SDK raises carries a `code`, so a dapp can branch on it
 * without reading English. New codes are additive; existing ones do not change.
 */
export type DappDataErrorCode =
  /** The signature does not belong to the account the dapp asked about (D15). */
  | "wrong-account"
  /** ERC-1271 or passkey wallet: no deterministic secp256k1 signature (D2, D25). */
  | "contract-account"
  /** The wallet returned something that is not a 65-byte secp256k1 signature. */
  | "bad-signature"
  /** The bytes read back are not a dappdata envelope, or the key does not open them. */
  | "bad-envelope"
  /** The wallet or environment cannot do what the SDK needs. */
  | "unsupported";

export class DappDataError extends Error {
  readonly code: DappDataErrorCode;

  constructor(code: DappDataErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DappDataError";
    this.code = code;
  }
}
