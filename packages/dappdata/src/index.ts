/**
 * dappdata — per-user dapp state on Swarm, under a key derived from the
 * signature the user already gave when they signed in.
 *
 * ```ts
 * const dd = await DappData.connect({
 *   entropy: entropy.wallet(provider),
 *   app: { id: window.location.origin },
 *   transport: transport.fetch("https://bee.example.org"),
 *   stamp: batchId,
 * });
 * const prefs = dd.slot<Prefs>("preferences");
 * await prefs.set({ theme: "dark" }, { expectIndex: (await prefs.get())?.index });
 * ```
 */
export { DappData, slotTopic } from "./dappdata.js";
export type { AppIdentity, ConnectOptions } from "./dappdata.js";

export { ConflictError, DappDataError } from "./errors.js";
export type { DappDataErrorCode } from "./errors.js";

export { Slot, MAX_INLINE_BYTES, bytesCodec, jsonCodec } from "./slot/index.js";
export type { Codec, SetOptions, SlotOptions, SlotValue, WatchOptions } from "./slot/index.js";

export { SequentialFeed } from "./feed/index.js";

export * as entropy from "./entropy/index.js";
export * as envelope from "./envelope/index.js";
export * as transport from "./transport/index.js";

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
