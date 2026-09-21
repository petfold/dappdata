// The default transport: bee-js 13 against an HTTP Bee endpoint (D10, D18).
//
// Under D12 that endpoint holds no funds, so it can be the user's own node,
// the dapp operator's, or any public node that allows the origin.
import { Bee } from "@ethersphere/bee-js";
import { EthAddress, FeedIndex, PrivateKey, Topic } from "@ethersphere/core-sdk";
import type { FeedUpdate, GetFeedUpdate, PutFeedUpdate, Transport } from "./types.js";

function isNotFound(error: unknown): boolean {
  const e = error as { status?: number; message?: string } | undefined;
  return e?.status === 404 || /not found|404/i.test(e?.message ?? "");
}

export interface HttpTransportOptions {
  /** A bee-js instance the dapp already has; otherwise the SDK makes one. */
  bee?: Bee;
}

export function http(url: string, options: HttpTransportOptions = {}): Transport {
  const bee = options.bee ?? new Bee(url);

  return {
    kind: "http",

    async putFeedUpdate({ signer, topic, index, payload, stamp }: PutFeedUpdate): Promise<void> {
      const writer = bee.feed.makeWriter(new Topic(topic), new PrivateKey(signer));
      await writer.uploadPayload(stamp, payload, { index: FeedIndex.fromBigInt(index) });
    },

    async getFeedUpdate({ owner, topic, index }: GetFeedUpdate): Promise<Uint8Array | null> {
      const reader = bee.feed.makeReader(new Topic(topic), new EthAddress(owner));
      try {
        const update = await reader.downloadPayload({ index: FeedIndex.fromBigInt(index) });
        return update.payload.toUint8Array();
      } catch (error) {
        if (isNotFound(error)) return null;
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

    async putBlob({ data, stamp }: { data: Uint8Array; stamp: string }): Promise<string> {
      // Swarm's own encryption: the 64-byte reference carries the key, and the
      // SDK seals that reference in the feed payload (D9).
      const result = await bee.data.upload(stamp, data, { encrypt: true });
      return result.reference.toHex();
    },

    async getBlob(reference: string): Promise<Uint8Array> {
      return (await bee.data.download(reference)).toUint8Array();
    },
  };
}
