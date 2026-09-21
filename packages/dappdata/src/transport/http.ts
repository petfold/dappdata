// The bee-js transport, published as `dappdata/transport/bee-js` (D10, D18).
//
// Use it when the dapp already ships bee-js, or wants bee-js to own the Bee
// conversation. Otherwise `transport.fetch` does the same four operations in
// 26 KB gzipped against this one's 167 KB. bee-js is an optional peer
// dependency, so importing this module without it installed will fail loudly.
//
// Under D12 the endpoint holds no funds, so it can be the user's own node,
// the dapp operator's, or any public node that allows the origin.
import { Bee } from "@ethersphere/bee-js";
import { EthAddress, FeedIndex, PrivateKey, Topic } from "@ethersphere/core-sdk";
import { DappDataError } from "../errors.js";
import { isNotFound, isUnreadableChunk } from "./missing.js";
import {
  type BatchStatus,
  type ChainState,
  type FeedUpdate,
  type GetFeedUpdate,
  type PutFeedUpdate,
  type Stamp,
  type Transport,
  stampBatchId,
} from "./types.js";

export interface HttpTransportOptions {
  /** A bee-js instance the dapp already has; otherwise the SDK makes one. */
  bee?: Bee;
}

export function http(url: string, options: HttpTransportOptions = {}): Transport {
  const bee = options.bee ?? new Bee(url);

  return {
    kind: "http",

    async putFeedUpdate({ signer, topic, index, payload, stamp }: PutFeedUpdate): Promise<void> {
      if (typeof stamp !== "string") {
        // bee-js takes an Envelope, not marshalled bytes, and widening its
        // SOCWriter type is the upstream change D12 noted. Until then, a
        // client-signed stamp goes through `transport.fetch`.
        throw new DappDataError(
          "unsupported",
          "the bee-js transport cannot carry a client-signed stamp yet; use transport.fetch (D12, D19)",
        );
      }
      const writer = bee.feed.makeWriter(new Topic(topic), new PrivateKey(signer));
      await writer.uploadPayload(stamp, payload, { index: FeedIndex.fromBigInt(index) });
    },

    async getFeedUpdate({ owner, topic, index }: GetFeedUpdate): Promise<Uint8Array | null> {
      const reader = bee.feed.makeReader(new Topic(topic), new EthAddress(owner));
      try {
        const update = await reader.downloadPayload({ index: FeedIndex.fromBigInt(index) });
        return update.payload.toUint8Array();
      } catch (error) {
        // An index nobody has written is a failed chunk read, not a 404.
        if (isNotFound(error) || isUnreadableChunk(error)) return null;
        throw error;
      }
    },

    async findLatest({
      owner,
      topic,
    }: {
      owner: string;
      topic: Uint8Array;
    }): Promise<FeedUpdate | null> {
      const reader = bee.feed.makeReader(new Topic(topic), new EthAddress(owner));
      try {
        const update = await reader.downloadPayload();
        return { index: update.feedIndex.toBigInt(), payload: update.payload.toUint8Array() };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async putBlob({ data, stamp }: { data: Uint8Array; stamp: Stamp }): Promise<string> {
      // Swarm's own encryption: the 64-byte reference carries the key, and the
      // SDK seals that reference in the feed payload (D9).
      const result = await bee.data.upload(stampBatchId(stamp), data, { encrypt: true });
      return result.reference.toHex();
    },

    async getBlob(reference: string): Promise<Uint8Array> {
      return (await bee.data.download(reference)).toUint8Array();
    },

    /** `/stamps` is what this node owns; a user-owned batch is in `/batches` (D12). */
    async getBatch(batchId: string): Promise<BatchStatus | null> {
      try {
        const batch = await bee.stamp.get(batchId);
        return {
          batchId: batch.batchID.toHex(),
          usable: batch.usable,
          depth: batch.depth,
          bucketDepth: batch.bucketDepth,
          immutable: batch.immutableFlag,
          utilization: batch.utilization,
          ttlSeconds: Number(batch.duration.toSeconds()),
        };
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      try {
        const batch = await bee.stamp.getGlobal(batchId);
        return {
          batchId: batch.batchID.toHex(),
          usable: batch.batchTTL > 0,
          depth: batch.depth,
          bucketDepth: batch.bucketDepth,
          immutable: batch.immutable,
          utilization: 0,
          ttlSeconds: batch.batchTTL,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async getChainState(): Promise<ChainState> {
      const state = await bee.status.getChainState();
      return { currentPrice: BigInt(state.currentPrice), block: state.block };
    },
  };
}
