// The D18 measurement: the same four operations with core-sdk and `fetch`,
// and no bee-js. If this stays small it becomes the default and bee-js drops
// to a dev dependency, which matters on a Swarm-hosted page where the user
// pays for every byte of the bundle.
//
// The routes are the ones S3 exercised: POST /soc for a feed update, GET
// /chunks for a known index, GET /feeds for Bee's own lookup, and /bytes for
// blobs.
import {
  Identifier,
  PrivateKey,
  keccak256,
  makeContentAddressedChunk,
  makeSOCAddress,
  unmarshalSingleOwnerChunk,
} from "@ethersphere/core-sdk";
import { DappDataError } from "../errors.js";
import { isMissingChunkResponse } from "./missing.js";
import {
  type BatchStatus,
  type ChainState,
  type FeedUpdate,
  type GetFeedUpdate,
  type PutFeedUpdate,
  type Stamp,
  type Transport,
} from "./types.js";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Bee takes a batch id or a marshalled stamp, in different headers. */
const stampHeader = (stamp: Stamp): Record<string, string> =>
  typeof stamp === "string"
    ? { "swarm-postage-batch-id": stamp }
    : { "swarm-postage-stamp": hex(stamp.marshalled) };

/** Sequential feeds: identifier = keccak256(topic ‖ index), index 8 bytes big-endian. */
function feedIdentifier(topic: Uint8Array, index: bigint): Uint8Array {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, index, false);
  const input = new Uint8Array(topic.length + 8);
  input.set(topic, 0);
  input.set(counter, topic.length);
  return keccak256(input);
}

export function fetchTransport(url: string, fetchImpl: typeof fetch = fetch): Transport {
  const base = url.replace(/\/+$/, "");

  const ask = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await fetchImpl(`${base}${path}`, init);
    if (response.ok || response.status === 404) return response;
    throw new DappDataError(
      "unsupported",
      `Bee answered ${response.status} for ${path}: ${await response.text()}`,
    );
  };

  /** Reads that are allowed to come back empty: see `missing.ts`. */
  const askMaybe = async (path: string): Promise<Response | null> => {
    const response = await fetchImpl(`${base}${path}`);
    if (response.ok) return response;
    const body = await response.text();
    if (isMissingChunkResponse(response.status, body)) return null;
    throw new DappDataError("unsupported", `Bee answered ${response.status} for ${path}: ${body}`);
  };

  return {
    kind: "fetch",

    async putFeedUpdate({ signer, topic, index, payload, stamp }: PutFeedUpdate): Promise<void> {
      const key = new PrivateKey(signer);
      const identifier = new Identifier(feedIdentifier(topic, index));
      const soc = makeContentAddressedChunk(payload).toSingleOwnerChunk(identifier, key);
      const body = new Uint8Array([...soc.span.toUint8Array(), ...soc.payload.toUint8Array()]);

      const owner = key.publicKey().address().toHex();
      const response = await ask(
        `/soc/${owner}/${identifier.toHex()}?sig=${soc.signature.toHex()}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream", ...stampHeader(stamp) },
          body: body as BodyInit,
        },
      );
      if (response.status === 404) {
        throw new DappDataError("unsupported", "this Bee node has no /soc endpoint");
      }
    },

    async getFeedUpdate({ owner, topic, index }: GetFeedUpdate): Promise<Uint8Array | null> {
      const identifier = new Identifier(feedIdentifier(topic, index));
      const address = makeSOCAddress(identifier, owner);
      const response = await askMaybe(`/chunks/${address.toHex()}`);
      if (response === null) return null;
      const chunk = unmarshalSingleOwnerChunk(
        new Uint8Array(await response.arrayBuffer()),
        address,
      );
      return chunk.payload.toUint8Array();
    },

    async findLatest({
      owner,
      topic,
    }: {
      owner: string;
      topic: Uint8Array;
    }): Promise<FeedUpdate | null> {
      const response = await askMaybe(`/feeds/${owner.replace(/^0x/, "")}/${hex(topic)}`);
      if (response === null) return null;
      const index = response.headers.get("swarm-feed-index");
      if (!index) return null;
      return {
        index: BigInt("0x" + index),
        payload: new Uint8Array(await response.arrayBuffer()),
      };
    },

    async putBlob({ data, stamp }: { data: Uint8Array; stamp: Stamp }): Promise<string> {
      const response = await ask("/bytes", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          ...stampHeader(stamp),
          "swarm-encrypt": "true",
        },
        body: data as BodyInit,
      });
      const body = (await response.json()) as { reference?: string };
      if (!body.reference) throw new DappDataError("unsupported", "no reference in the response");
      return body.reference;
    },

    async getBlob(reference: string): Promise<Uint8Array> {
      const response = await ask(`/bytes/${reference.replace(/^0x/, "")}`);
      if (response.status === 404) throw new DappDataError("unsupported", `no blob ${reference}`);
      return new Uint8Array(await response.arrayBuffer());
    },

    async getBatch(batchId: string): Promise<BatchStatus | null> {
      const response = await askMaybe(`/stamps/${batchId.replace(/^0x/, "")}`);
      if (response === null) return null;
      const batch = (await response.json()) as {
        batchID: string;
        usable: boolean;
        depth: number;
        bucketDepth: number;
        immutableFlag: boolean;
        utilization: number;
        batchTTL: number;
      };
      return {
        batchId: batch.batchID,
        usable: batch.usable,
        depth: batch.depth,
        bucketDepth: batch.bucketDepth,
        immutable: batch.immutableFlag,
        utilization: batch.utilization,
        ttlSeconds: batch.batchTTL,
      };
    },

    async getChainState(): Promise<ChainState> {
      const response = await ask("/chainstate");
      const state = (await response.json()) as { currentPrice: string; block: number };
      return { currentPrice: BigInt(state.currentPrice), block: state.block };
    },
  };
}
