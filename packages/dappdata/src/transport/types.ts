// The Bee endpoint is an interface, not a URL (D13, D18).
//
// A dapp that already runs bee-js can hand the SDK its own instance instead of
// shipping a second copy: on a Swarm-hosted page the user pays for every byte
// of the bundle.

export interface FeedUpdate {
  index: bigint;
  payload: Uint8Array;
}

export interface PutFeedUpdate {
  /** 32-byte secp256k1 key that owns the feed. */
  signer: Uint8Array;
  topic: Uint8Array;
  index: bigint;
  /** At most 4096 bytes: one chunk (D9 sends anything larger to a blob). */
  payload: Uint8Array;
  /** A postage batch the node can stamp with. Funding is Phase 2 (D3). */
  stamp: string;
}

export interface GetFeedUpdate {
  owner: string;
  topic: Uint8Array;
  index: bigint;
}

export interface Transport {
  /** For diagnostics and the D18 measurement. */
  readonly kind: string;

  /** Write one feed update at an exact index. */
  putFeedUpdate(args: PutFeedUpdate): Promise<void>;

  /**
   * Read a known index: 10–300 ms (S2). This is the SDK's normal read, which
   * is why the slot keeps an index cache (D5).
   */
  getFeedUpdate(args: GetFeedUpdate): Promise<Uint8Array | null>;

  /**
   * Bee's own feed lookup: 2–5 s in every environment measured (S2), so the
   * SDK uses it only when it has no index to start from (D5).
   */
  findLatest(args: { owner: string; topic: Uint8Array }): Promise<FeedUpdate | null>;

  /** A value too large for one chunk, uploaded with Swarm's encryption (D9). */
  putBlob(args: { data: Uint8Array; stamp: string }): Promise<string>;
  getBlob(reference: string): Promise<Uint8Array>;
}
