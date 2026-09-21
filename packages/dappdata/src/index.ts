/**
 * dappdata — per-user dapp state on Swarm, under a key derived from the
 * signature the user already gave when they signed in.
 *
 * Phase 1 is in progress: derivation, entropy sources and the envelope are
 * here; transport, feed and slot follow (docs/PLAN.md).
 */
export { DappDataError } from "./errors.js";
export type { DappDataErrorCode } from "./errors.js";

export * as entropy from "./entropy/index.js";
export * as envelope from "./envelope/index.js";

export {
  DOMAIN,
  PURPOSE,
  SCOPE,
  deriveFolderKeys,
  deriveSeed,
  deriveSubKey,
  fallbackText,
  typedData,
  typedDataV4Json,
} from "./derive/index.js";
export type { FolderKeys } from "./derive/kdf.js";
