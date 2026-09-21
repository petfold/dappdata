export type { FeedUpdate, GetFeedUpdate, PutFeedUpdate, Transport } from "./types.js";
export { http } from "./http.js";
export { fetchTransport as fetch } from "./fetch.js";
export { memory } from "./memory.js";

import type { Transport } from "./types.js";

/** Your own implementation, over whatever Bee client you already ship (D18). */
export const custom = (implementation: Transport): Transport => implementation;
