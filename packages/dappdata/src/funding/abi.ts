// Just enough ABI encoding for four calls, so the SDK needs no web3 library
// on top of what it already has. Every argument here is a static type, which
// is one 32-byte word each and no offsets to get wrong.
import { keccak_256 } from "@noble/hashes/sha3";
import { DappDataError } from "../errors.js";

const utf8 = new TextEncoder();

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const selector = (signature: string): string =>
  hex(keccak_256(utf8.encode(signature)).subarray(0, 4));

const word = (value: string): string => value.replace(/^0x/, "").padStart(64, "0");

const addressWord = (address: string): string => {
  const raw = address.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(raw)) {
    throw new DappDataError("unsupported", `not an address: ${address}`);
  }
  return word(raw);
};

const uintWord = (value: bigint): string => {
  if (value < 0n) throw new DappDataError("unsupported", "a uint cannot be negative");
  return word(value.toString(16));
};

const bytes32Word = (value: string): string => {
  const raw = value.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(raw)) {
    throw new DappDataError("unsupported", `not a 32-byte value: ${value}`);
  }
  return raw;
};

const boolWord = (value: boolean): string => word(value ? "1" : "0");

export const encodeAllowance = (owner: string, spender: string): string =>
  "0x" + selector("allowance(address,address)") + addressWord(owner) + addressWord(spender);

export const encodeApprove = (spender: string, amount: bigint): string =>
  "0x" + selector("approve(address,uint256)") + addressWord(spender) + uintWord(amount);

export const encodeCreateBatch = (args: {
  owner: string;
  initialBalancePerChunk: bigint;
  depth: number;
  bucketDepth: number;
  nonce: string;
  immutable: boolean;
}): string =>
  "0x" +
  selector("createBatch(address,uint256,uint8,uint8,bytes32,bool)") +
  addressWord(args.owner) +
  uintWord(args.initialBalancePerChunk) +
  uintWord(BigInt(args.depth)) +
  uintWord(BigInt(args.bucketDepth)) +
  bytes32Word(args.nonce) +
  boolWord(args.immutable);

export const encodeTopUp = (batchId: string, amountPerChunk: bigint): string =>
  "0x" + selector("topUp(bytes32,uint256)") + bytes32Word(batchId) + uintWord(amountPerChunk);

export const encodeRemainingBalance = (batchId: string): string =>
  "0x" + selector("remainingBalance(bytes32)") + bytes32Word(batchId);

/** `BatchCreated(bytes32 indexed batchId, ...)`: the id is the first indexed topic. */
export const BATCH_CREATED_TOPIC =
  "0x" +
  hex(
    keccak_256(
      utf8.encode("BatchCreated(bytes32,uint256,uint256,address,address,uint8,uint8,bool)"),
    ),
  );

export const decodeUint = (data: string): bigint => {
  const raw = data.replace(/^0x/, "");
  return raw.length === 0 ? 0n : BigInt("0x" + raw.slice(0, 64));
};
