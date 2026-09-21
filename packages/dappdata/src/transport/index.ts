export type { FeedUpdate, GetFeedUpdate, PutFeedUpdate, Stamp, Transport } from "./types.js";
export { stampBatchId } from "./types.js";
export { fetchTransport as fetch } from "./fetch.js";
export { memory } from "./memory.js";

// The bee-js transport lives behind its own entry point, `dappdata/transport/bee-js`,
// because bee-js is an optional peer dependency: it is six times the bundle of
// the default transport, and a Swarm-hosted dapp pays for every byte (D18).

import type { Transport } from "./types.js";

/** Your own implementation, over whatever Bee client you already ship (D18). */
export const custom = (implementation: Transport): Transport => implementation;
