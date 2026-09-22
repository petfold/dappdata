// Client-side chunking for blobs (D27).
//
// A value too large for one chunk becomes a tree of content-addressed chunks
// built here, not on the node, so that every chunk address is known before
// upload and a client-side stamper (D12, D19) can sign each one. The node
// then needs no batch of its own, which is what sponsor-pays requires (D3).
// The payload the caller hands in is already sealed by the envelope, so the
// chunks are plain and the root is a 32-byte reference (D9, amended by D27).
import { ChunkJoiner, ChunkSplitter } from "@ethersphere/core-sdk";
import type { ChunkBuilder } from "@ethersphere/core-sdk";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** The exact bytes of a built chunk: span, then only the payload written. */
export function chunkBytes(chunk: ChunkBuilder): Uint8Array {
  return chunk.build().subarray(0, 8 + chunk.writer.cursor);
}

/**
 * Split `data` into chunks, hand each one to `put` (address, bytes), and
 * return the root reference as hex. The root is put last, so a reader who
 * finds the root can find everything below it.
 */
export async function splitBlob(
  data: Uint8Array,
  put: (address: Uint8Array, bytes: Uint8Array) => Promise<void>,
): Promise<string> {
  const seen = new Set<string>();
  const upload = async (chunk: ChunkBuilder): Promise<void> => {
    const address = chunk.hash().toUint8Array();
    const key = hex(address);
    if (seen.has(key)) return;
    seen.add(key);
    await put(address, chunkBytes(chunk));
  };
  const splitter = new ChunkSplitter(async (batch) => {
    for (const entry of batch) await upload(entry.chunk);
    return [];
  });
  await splitter.append(data);
  const root = await splitter.finalize();
  await upload(root);
  return root.hash().toHex();
}

/** Reassemble a blob from its root, fetching chunks through `get`. */
export async function joinBlob(
  reference: Uint8Array,
  get: (address: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  return ChunkJoiner.collect(reference, get);
}
