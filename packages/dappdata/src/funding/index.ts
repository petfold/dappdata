/**
 * Funding: the user owns the batch, anyone pays (D3, D12, D23).
 *
 * There is one code path. Whoever signs the transaction is the payer — the
 * user, the dapp operator, a sponsor — and the owner is always the user's
 * derived storage key, because that is the key that can sign stamps in a
 * browser (D12). `topUp` needs no permission from the owner, so a sponsor can
 * keep a user's folder alive without holding anything of theirs (S3).
 *
 * The SDK talks to the postage contract through the payer's EIP-1193 provider
 * and encodes the four calls itself, so it needs no web3 library beyond what
 * the derivation already uses.
 */
import { getDepthForSize, getStampUsage } from "@ethersphere/core-sdk";
import { DappDataError } from "../errors.js";
import type { Eip1193Provider } from "../entropy/types.js";
import type { Transport } from "../transport/types.js";
import {
  BATCH_CREATED_TOPIC,
  batchIdFor,
  decodeUint,
  encodeAllowance,
  encodeApprove,
  encodeCreateBatch,
  encodeLastPrice,
  encodeRemainingBalance,
  encodeTopUp,
} from "./abi.js";
import type { ChainConfig } from "./chains.js";

export * from "./chains.js";

/** Bee's own bucket depth. Not configurable: the network fixes it. */
export const BUCKET_DEPTH = 16;

/** A chunk holds 4 KB, and a write is a chunk unless it overflows to a blob. */
const CHUNK_BYTES = 4096;

export interface WriteBudget {
  writesPerDay: number;
  retentionDays: number;
  /**
   * The size of a typical value, in bytes. Up to about 4 KB a write is one
   * chunk; above that the value becomes a client-chunked blob and costs one
   * chunk per 4 KB plus the tree above them (D27). Default: fits one chunk.
   */
  bytesPerWrite?: number | undefined;
}

/** How many chunks one write of `bytes` spends, blob tree and feed chunk included (D27). */
export function chunksPerWrite(bytes: number): number {
  const inlineMax = 4096 - 4 - 12 - 16; // MAX_INLINE_BYTES, without importing the slot
  if (bytes <= inlineMax) return 1;
  const leaves = Math.ceil((bytes + 32) / 4096); // the envelope adds a header, nonce and tag
  let level = leaves;
  let tree = 0;
  while (level > 1) {
    level = Math.ceil(level / 128); // 128 references per intermediate chunk
    tree += level;
  }
  return 1 + leaves + tree; // the feed chunk that carries the sealed root
}

export interface FundOptions {
  /** The batch owner. Defaults to the folder's own address (D12). */
  owner: string;
  /** Either say what you need… */
  budget?: WriteBudget | undefined;
  /** …or say exactly what to buy. */
  depth?: number | undefined;
  amountPerChunk?: bigint | undefined;
  /** Immutable unless you insist otherwise; the SDK refuses mutable (D4). */
  immutable?: boolean | undefined;
}

export interface FundResult {
  batchId: string;
  depth: number;
  amountPerChunk: bigint;
  /** What the payer spent, in PLUR: amount × 2^depth. */
  totalCost: bigint;
  transactionHash: string;
}

export interface Health {
  /** Bee will stamp with it. A fresh batch takes about two minutes (S3). */
  usable: boolean;
  ttlSeconds: number;
  daysLeft: number;
  /** 0..1, as Bee sees it; 0 for a batch this node does not hold (D12). */
  usage: number;
  depth: number;
  immutable: boolean;
  /**
   * Where the lifetime came from. The contract is authoritative: Bee's own
   * `batchTTL` was about 170 times too long on Sepolia (gate run, 2026-09-21;
   * within 1 % on Gnosis per IDEA-198, so chain-specific and unexplained).
   */
  ttlSource: "contract" | "node";
}

export interface FundingLink {
  name: string;
  url: string;
  what: string;
}

export interface Funding {
  fund(options: FundOptions): Promise<FundResult>;
  topUp(batchId: string, amountPerChunk: bigint): Promise<string>;
  health(batchId: string): Promise<Health | null>;
  quote(budget: WriteBudget): Promise<{ depth: number; amountPerChunk: bigint; total: bigint }>;
  links(): FundingLink[];
}

export interface FundingOptions {
  /** Whoever pays. Not necessarily the user's wallet (D3). */
  payer: Eip1193Provider;
  chain: ChainConfig;
  /** Reads batch state and the postage price from a Bee node. */
  transport: Transport;
  /** The payer's address. Default: the provider's first account. */
  from?: string | undefined;
}

const hexOfRandom32 = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export function funding(options: FundingOptions): Funding {
  const { payer, chain, transport } = options;

  const from = async (): Promise<string> => {
    if (options.from) return options.from;
    const accounts = (await payer.request({ method: "eth_requestAccounts" })) as string[];
    const account = accounts?.[0];
    if (!account) throw new DappDataError("unsupported", "the payer has no account");
    return account;
  };

  const call = async (to: string, data: string): Promise<string> =>
    (await payer.request({ method: "eth_call", params: [{ to, data }, "latest"] })) as string;

  const send = async (to: string, data: string): Promise<string> =>
    (await payer.request({
      method: "eth_sendTransaction",
      params: [{ from: await from(), to, data }],
    })) as string;

  const receipt = async (hash: string): Promise<{ logs: Array<{ topics: string[] }> } | null> =>
    (await payer.request({ method: "eth_getTransactionReceipt", params: [hash] })) as never;

  /**
   * Wait for the transaction and check the chain agrees with the batch id we
   * already computed. The id comes from `keccak256(abi.encode(payer, nonce))`,
   * not from an event: parsing events means pinning an ABI to a deployment,
   * and the deployed `BatchCreated` already differs from the one our S3 spike
   * declared. The event is a cross-check here, never the source.
   */
  const confirm = async (hash: string, expected: string): Promise<void> => {
    for (let attempt = 0; attempt < 90; attempt++) {
      const result = await receipt(hash);
      if (result) {
        const fromChain = (result.logs ?? []).find(
          (log) => log.topics?.[0]?.toLowerCase() === BATCH_CREATED_TOPIC.toLowerCase(),
        );
        const emitted = fromChain?.topics?.[1]?.replace(/^0x/, "").toLowerCase();
        if (emitted && emitted !== expected.toLowerCase()) {
          throw new DappDataError(
            "unsupported",
            `the chain created batch ${emitted}, not the ${expected} this SDK derived`,
          );
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new DappDataError("unsupported", `transaction ${hash} was still pending after three minutes`);
  };

  const quote = async (
    budget: WriteBudget,
  ): Promise<{ depth: number; amountPerChunk: bigint; total: bigint }> => {
    if (budget.writesPerDay <= 0 || budget.retentionDays <= 0) {
      throw new DappDataError("unsupported", "a write budget needs positive numbers");
    }
    // Per write: the value's chunks (one, or a blob tree, D27) plus the
    // stamper checkpoint that reserves room for them in the worst case (D19).
    const perWrite = chunksPerWrite(budget.bytesPerWrite ?? 0) + 1;
    const chunks = budget.writesPerDay * budget.retentionDays * perWrite;
    const depth = Math.max(17, getDepthForSize(chunks * CHUNK_BYTES, true));

    const { currentPrice } = await transport.getChainState();
    const blocks = BigInt(Math.ceil((budget.retentionDays * 86_400) / chain.blockSeconds));
    const amountPerChunk = currentPrice * blocks;
    return { depth, amountPerChunk, total: amountPerChunk * 2n ** BigInt(depth) };
  };

  return {
    quote,

    async fund(fundOptions: FundOptions): Promise<FundResult> {
      const immutable = fundOptions.immutable ?? true;
      if (!immutable) {
        throw new DappDataError(
          "unsupported",
          "a full mutable batch silently replaces your oldest data; dappdata needs an " +
            "immutable batch and will stop writing when it is full (D4)",
        );
      }

      let depth = fundOptions.depth;
      let amountPerChunk = fundOptions.amountPerChunk;
      if (depth === undefined || amountPerChunk === undefined) {
        if (!fundOptions.budget) {
          throw new DappDataError("unsupported", "fund() needs a budget, or a depth and an amount");
        }
        const quoted = await quote(fundOptions.budget);
        depth ??= quoted.depth;
        amountPerChunk ??= quoted.amountPerChunk;
      }

      const total = amountPerChunk * 2n ** BigInt(depth);
      const payerAddress = await from();

      // Approve only what is missing; an allowance already there is fine.
      const allowance = decodeUint(
        await call(chain.bzzToken, encodeAllowance(payerAddress, chain.postageStamp)),
      );
      if (allowance < total) {
        await send(chain.bzzToken, encodeApprove(chain.postageStamp, total));
      }

      const nonce = hexOfRandom32();
      const batchId = batchIdFor(payerAddress, nonce);
      const transactionHash = await send(
        chain.postageStamp,
        encodeCreateBatch({
          owner: fundOptions.owner,
          initialBalancePerChunk: amountPerChunk,
          depth,
          bucketDepth: BUCKET_DEPTH,
          nonce,
          immutable,
        }),
      );
      await confirm(transactionHash, batchId);

      return {
        batchId,
        depth,
        amountPerChunk,
        totalCost: total,
        transactionHash,
      };
    },

    /** Permissionless: extending someone's TTL costs the payer and helps them (T9). */
    async topUp(batchId: string, amountPerChunk: bigint): Promise<string> {
      const batch = await transport.getBatch(batchId);
      const depth = batch?.depth ?? 20;
      const total = amountPerChunk * 2n ** BigInt(depth);
      const payerAddress = await from();

      const allowance = decodeUint(
        await call(chain.bzzToken, encodeAllowance(payerAddress, chain.postageStamp)),
      );
      if (allowance < total) {
        await send(chain.bzzToken, encodeApprove(chain.postageStamp, total));
      }
      return send(chain.postageStamp, encodeTopUp(batchId, amountPerChunk));
    },

    /**
     * How long the batch has left. The lifetime comes from the postage
     * contract — `remainingBalance / lastPrice` blocks, times the chain's
     * block time — because a node's own `batchTTL` cannot be trusted: on
     * Sepolia it reported 166 days for a batch the contract gave 0.99 days
     * (gate run, 2026-09-21). The node is still asked, for the flags only.
     */
    async health(batchId: string): Promise<Health | null> {
      const batch = await transport.getBatch(batchId);
      if (batch === null) return null;

      let ttlSeconds = batch.ttlSeconds;
      let ttlSource: "contract" | "node" = "node";
      try {
        const [remaining, price] = await Promise.all([
          call(chain.postageStamp, encodeRemainingBalance(batchId)).then(decodeUint),
          call(chain.postageStamp, encodeLastPrice()).then(decodeUint),
        ]);
        if (price > 0n) {
          ttlSeconds = Number((remaining * BigInt(chain.blockSeconds)) / price);
          ttlSource = "contract";
        }
      } catch {
        // No chain access: fall back to what the node said, and say so.
      }

      return {
        usable: batch.usable && ttlSeconds > 0,
        ttlSeconds,
        daysLeft: ttlSeconds / 86_400,
        usage: getStampUsage(batch.utilization, batch.depth, batch.bucketDepth),
        depth: batch.depth,
        immutable: batch.immutable,
        ttlSource,
      };
    },

    /**
     * Where a user can get xBZZ and xDAI. The SDK links out; it does not swap,
     * and it takes no cut. Jumper first because it starts from any chain and
     * ends with both tokens (D3, from the S3 survey).
     */
    links(): FundingLink[] {
      return [
        {
          name: "Jumper",
          url: "https://jumper.exchange/?toChain=100&toToken=0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da",
          what: "Bridge and swap from any chain; ends with xBZZ and xDAI on Gnosis.",
        },
        {
          name: "Gnosis Chain bridge",
          url: "https://bridge.gnosischain.com/",
          what: "Move tokens you already hold on Ethereum to Gnosis.",
        },
      ];
    },
  };
}
