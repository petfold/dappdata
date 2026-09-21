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
  isStampSigner,
} from "./types.js";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Bee takes a batch id, which asks the node to stamp, or a marshalled stamp
 * in a different header. A stamper is asked to sign the address in hand.
 */
async function stampHeader(stamp: Stamp, chunkAddress: Uint8Array): Promise<Record<string, string>> {
  if (typeof stamp === "string") return { "swarm-postage-batch-id": stamp };
  if (isStampSigner(stamp)) {
    return { "swarm-postage-stamp": hex(await stamp.sign(chunkAddress)) };
  }
  return { "swarm-postage-stamp": hex(stamp.marshalled) };
}

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
      // The stamp signs the chunk's own address, which only exists once the
      // SOC is built, so the stamper is asked for it here and not before.
      const headers = await stampHeader(stamp, soc.address.toUint8Array());
      const response = await ask(
        `/soc/${owner}/${identifier.toHex()}?sig=${soc.signature.toHex()}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream", ...headers },
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
      if (isStampSigner(stamp)) {
        // /bytes splits the data into chunks on the node, so the client never
        // sees the addresses it would have to stamp. A blob therefore needs a
        // node that holds the batch, until the SDK splits client-side itself.
        throw new DappDataError(
          "unsupported",
          "a value too large for one chunk needs a node holding the batch: " +
            "client-side stamping cannot cover chunks it never sees (D12, D19)",
        );
      }
      const response = await ask("/bytes", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          ...(typeof stamp === "string"
            ? { "swarm-postage-batch-id": stamp }
            : { "swarm-postage-stamp": hex(stamp.marshalled) }),
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

    /**
     * `/stamps/{id}` lists the batches this node **owns**, and under D12 the
     * node owns none of ours: the owner is the user's derived key. So ask
     * `/stamps` first, for the utilization only a holder knows, and fall back
     * to `/batches/{id}`, the node's view of the chain, which is where a
     * user-owned batch actually shows up.
     */
    async getBatch(batchId: string): Promise<BatchStatus | null> {
      const id = batchId.replace(/^0x/, "");

      const own = await askMaybe(`/stamps/${id}`);
      if (own !== null) {
        const batch = (await own.json()) as {
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
      }

      const global = await askMaybe(`/batches/${id}`);
      if (global === null) return null;
      const batch = (await global.json()) as {
        batchID: string;
        depth: number;
        bucketDepth: number;
        immutable: boolean;
        batchTTL: number;
      };
      return {
        batchId: batch.batchID,
        // The chain says it exists and still has value; that is what a
        // client-side stamper needs. Utilization is unknown from here: only
        // the node holding the batch counts chunks, and we count our own in
        // the stamper's bucket state instead (D19).
        usable: batch.batchTTL > 0,
        depth: batch.depth,
        bucketDepth: batch.bucketDepth,
        immutable: batch.immutable,
        utilization: 0,
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
