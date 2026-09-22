// An in-memory transport. Unit tests mock Bee (PLAN, "Tests"), and a dapp can
// use this one to develop against nothing at all.
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { secp256k1 } from "@noble/curves/secp256k1";
import { feedChunkAddress } from "../feed/address.js";
import { joinBlob, splitBlob } from "./blob.js";
import {
  type BatchStatus,
  type ChainState,
  type FeedUpdate,
  type GetFeedUpdate,
  type PutFeedUpdate,
  type Stamp,
  type Transport,
  isStampSigner,
  stampBatchId,
} from "./types.js";

const addressOf = (privateKey: Uint8Array): string =>
  "0x" + bytesToHex(keccak_256(secp256k1.getPublicKey(privateKey, false).subarray(1)).subarray(12));

const slotKey = (owner: string, topic: Uint8Array, index: bigint): string =>
  `${owner.toLowerCase()}/${bytesToHex(topic)}/${index}`;

export interface MemoryWrite {
  owner: string;
  topic: Uint8Array;
  index: bigint;
  bytes: number;
  stamp: Stamp;
  /** The marshalled stamp a client-side stamper signed for this chunk, if one did. */
  stamped?: Uint8Array;
}

export interface MemoryTransport extends Transport {
  /** Every write the SDK made, in order. Handy in tests. */
  readonly writes: MemoryWrite[];
  /** Every blob chunk the SDK uploaded, with the stamp a stamper signed for it. */
  readonly blobChunks: Array<{ address: string; stamped?: Uint8Array }>;
  /** Pretend the node knows about this batch. */
  setBatch(batch: BatchStatus): void;
  /** Pretend postage costs this much per chunk per block. */
  setPrice(currentPrice: bigint): void;
}

export function memory(): MemoryTransport {
  const feeds = new Map<string, Uint8Array>();
  const latest = new Map<string, bigint>();
  const chunks = new Map<string, Uint8Array>();
  const blobChunks: Array<{ address: string; stamped?: Uint8Array }> = [];
  const writes: MemoryWrite[] = [];
  const batches = new Map<string, BatchStatus>();
  let price = 24_000n;

  return {
    kind: "memory",
    writes,
    blobChunks,

    async putFeedUpdate({ signer, topic, index, payload, stamp }: PutFeedUpdate): Promise<void> {
      if (!stampBatchId(stamp)) throw new Error("a write needs a postage batch");
      if (payload.length > 4096) throw new Error("a feed payload is one chunk");
      const owner = addressOf(signer);
      // A real node asks the stamper for the chunk's own address (D12), and a
      // stamper spends a slot per call (D19), so this transport asks too:
      // tests of the stamper's bookkeeping need the same sequence of calls.
      const write: MemoryWrite = { owner, topic, index, bytes: payload.length, stamp };
      if (isStampSigner(stamp)) {
        write.stamped = await stamp.sign(feedChunkAddress(owner, topic, index));
      }
      feeds.set(slotKey(owner, topic, index), new Uint8Array(payload));
      const head = `${owner.toLowerCase()}/${bytesToHex(topic)}`;
      if ((latest.get(head) ?? -1n) < index) latest.set(head, index);
      writes.push(write);
    },

    async getFeedUpdate({ owner, topic, index }: GetFeedUpdate): Promise<Uint8Array | null> {
      return feeds.get(slotKey(owner, topic, index)) ?? null;
    },

    async findLatest({
      owner,
      topic,
    }: {
      owner: string;
      topic: Uint8Array;
    }): Promise<FeedUpdate | null> {
      const index = latest.get(`${owner.toLowerCase()}/${bytesToHex(topic)}`);
      if (index === undefined) return null;
      const payload = feeds.get(slotKey(owner, topic, index));
      return payload ? { index, payload } : null;
    },

    async putBlob({ data, stamp }: { data: Uint8Array; stamp: Stamp }): Promise<string> {
      if (!stampBatchId(stamp)) throw new Error("a write needs a postage batch");
      // Split as the real transport does, and ask a stamper for every chunk.
      return splitBlob(data, async (address, bytes) => {
        const entry: { address: string; stamped?: Uint8Array } = { address: bytesToHex(address) };
        if (isStampSigner(stamp)) entry.stamped = await stamp.sign(address);
        chunks.set(entry.address, new Uint8Array(bytes));
        blobChunks.push(entry);
      });
    },

    async getBlob(reference: string): Promise<Uint8Array> {
      const ref = reference.replace(/^0x/, "");
      if (ref.length !== 64) throw new Error(`no blob ${reference}: this transport stores plain chunk trees`);
      return joinBlob(hexToBytes(ref), async (address) => {
        const chunk = chunks.get(bytesToHex(address));
        if (!chunk) throw new Error(`no chunk ${bytesToHex(address)}`);
        return chunk;
      });
    },

    async getBatch(batchId: string): Promise<BatchStatus | null> {
      return batches.get(batchId.replace(/^0x/, "").toLowerCase()) ?? null;
    },

    async getChainState(): Promise<ChainState> {
      return { currentPrice: price, block: 1 };
    },

    setBatch(batch: BatchStatus): void {
      batches.set(batch.batchId.replace(/^0x/, "").toLowerCase(), batch);
    },

    setPrice(currentPrice: bigint): void {
      price = currentPrice;
    },
  };
}
