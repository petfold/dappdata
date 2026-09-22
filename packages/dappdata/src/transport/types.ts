// The Bee endpoint is an interface, not a URL (D13, D18).
//
// A dapp that already runs bee-js can hand the SDK its own instance instead of
// shipping a second copy: on a Swarm-hosted page the user pays for every byte
// of the bundle.

export interface FeedUpdate {
  index: bigint;
  payload: Uint8Array;
}

/**
 * How a write is paid for. A batch id asks the node to stamp, which needs a
 * node that holds the batch. A marshalled stamp is signed here by the batch
 * owner — the derived storage key — and any node will take it, funds or no
 * funds (D12, S3).
 */
export type Stamp = string | { batchId: string; marshalled: Uint8Array } | StampSigner;

/**
 * A stamper the transport asks for a stamp once it knows the chunk address.
 * A postage stamp signs one address, so it cannot be prepared in advance
 * (D12, D19).
 */
export interface StampSigner {
  batchId: string;
  sign(chunkAddress: Uint8Array): Promise<Uint8Array>;
}

export const isStampSigner = (stamp: Stamp): stamp is StampSigner =>
  typeof stamp !== "string" && typeof (stamp as StampSigner).sign === "function";

export const stampBatchId = (stamp: Stamp): string =>
  typeof stamp === "string" ? stamp : stamp.batchId;

export interface PutFeedUpdate {
  /** 32-byte secp256k1 key that owns the feed. */
  signer: Uint8Array;
  topic: Uint8Array;
  index: bigint;
  /** At most 4096 bytes: one chunk (D9 sends anything larger to a blob). */
  payload: Uint8Array;
  /** A batch the node stamps with, or a stamp this device signed (D12). */
  stamp: Stamp;
}

export interface GetFeedUpdate {
  owner: string;
  topic: Uint8Array;
  index: bigint;
}

/** What a Bee node knows about a postage batch. */
export interface BatchStatus {
  batchId: string;
  usable: boolean;
  depth: number;
  bucketDepth: number;
  immutable: boolean;
  /** Chunks stamped into the fullest bucket, as Bee reports it. */
  utilization: number;
  ttlSeconds: number;
}

/** What postage costs right now, for sizing a purchase (D23). */
export interface ChainState {
  /** PLUR per chunk per block. */
  currentPrice: bigint;
  block: number;
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

  /**
   * A value too large for one chunk: already sealed by the envelope, split
   * into plain chunks that a client-side stamper signs one by one, returned
   * as the 32-byte root reference in hex (D9, D27).
   */
  putBlob(args: { data: Uint8Array; stamp: Stamp }): Promise<string>;
  getBlob(reference: string): Promise<Uint8Array>;

  /** What the node knows about a batch, or null if it knows of none. */
  getBatch(batchId: string): Promise<BatchStatus | null>;
  /** The current postage price, for sizing a purchase (D23). */
  getChainState(): Promise<ChainState>;
}
