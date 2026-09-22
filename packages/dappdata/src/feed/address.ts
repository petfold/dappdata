// Where a sequential feed's update lives, computed without asking anyone.
//
// The address of the chunk at (owner, topic, index) depends on nothing else,
// so a reader fetches by index (D5) and a writer knows, before it has a
// payload, which postage bucket its next update will need (D19 lookahead).
import { Identifier, keccak256, makeSOCAddress } from "@ethersphere/core-sdk";

/** Sequential feeds: identifier = keccak256(topic ‖ index), index 8 bytes big-endian. */
export function feedIdentifier(topic: Uint8Array, index: bigint): Uint8Array {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, index, false);
  const input = new Uint8Array(topic.length + 8);
  input.set(topic, 0);
  input.set(counter, topic.length);
  return keccak256(input);
}

/** The single-owner chunk address of one feed update, as a 32-byte array. */
export function feedChunkAddress(owner: string, topic: Uint8Array, index: bigint): Uint8Array {
  return makeSOCAddress(new Identifier(feedIdentifier(topic, index)), owner).toUint8Array();
}
