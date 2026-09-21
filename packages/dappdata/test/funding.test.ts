import { describe, expect, it } from "vitest";
import { memory } from "../src/transport/memory.js";
import { funding, sepolia, gnosis, BUCKET_DEPTH } from "../src/funding/index.js";
import {
  BATCH_CREATED_TOPIC,
  encodeApprove,
  encodeCreateBatch,
  encodeTopUp,
  selector,
} from "../src/funding/abi.js";
import type { Eip1193Provider } from "../src/entropy/types.js";
import { DappDataError } from "../src/errors.js";

const PAYER = "0x6f4900000000000000000000000000000000f3bc";
const OWNER = "0x340eaa8ae36e82bae2764ccb39a0c7490435c512"; // a derived storage key (D12)
const BATCH = "63a648e50ac5ddf2027fb4e8b40e9e2b15943cc3896dc15cc801f909b8acdab9";

interface Sent {
  to: string;
  data: string;
}

function mockChain(options: { allowance?: bigint } = {}): Eip1193Provider & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async request({ method, params }): Promise<unknown> {
      const p = params as unknown[];
      switch (method) {
        case "eth_requestAccounts":
          return [PAYER];
        case "eth_call":
          return "0x" + (options.allowance ?? 0n).toString(16).padStart(64, "0");
        case "eth_sendTransaction": {
          const tx = p[0] as Sent;
          sent.push({ to: tx.to, data: tx.data });
          return "0xdeadbeef" + sent.length;
        }
        case "eth_getTransactionReceipt":
          return { logs: [{ topics: [BATCH_CREATED_TOPIC, "0x" + BATCH] }] };
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  };
}

const make = (provider: Eip1193Provider, transport = memory()) =>
  funding({ payer: provider, chain: sepolia, transport, from: PAYER });

describe("ABI encoding", () => {
  it("uses the selectors the postage contract exposes", () => {
    // Every value here was computed independently with ethers v6 (ethers.id),
    // against the signatures in spikes/s3/src/modeb.mjs. Hand-written
    // encoding is only as good as its cross-check.
    expect(selector("approve(address,uint256)")).toBe("095ea7b3");
    expect(selector("allowance(address,address)")).toBe("dd62ed3e");
    expect(selector("topUp(bytes32,uint256)")).toBe("b67644b9");
    expect(selector("createBatch(address,uint256,uint8,uint8,bytes32,bool)")).toBe("5239af71");
    expect(selector("remainingBalance(bytes32)")).toBe("d71ba7c4");
    expect(BATCH_CREATED_TOPIC).toBe(
      "0xc56374a8e3361770343efe343883bf87efaeca24024afbba9062b88495f50f6e",
    );
    expect(encodeApprove("0x" + "11".repeat(20), 255n)).toBe(
      "0x095ea7b3" + "11".repeat(20).padStart(64, "0") + "ff".padStart(64, "0"),
    );
  });

  it("lays out createBatch as six static words", () => {
    const data = encodeCreateBatch({
      owner: OWNER,
      initialBalancePerChunk: 1n,
      depth: 20,
      bucketDepth: BUCKET_DEPTH,
      nonce: "0x" + "ab".repeat(32),
      immutable: true,
    });
    expect(data.slice(2 + 8).length).toBe(6 * 64);
    expect(data).toContain(OWNER.slice(2));
    expect(data.endsWith("1".padStart(64, "0"))).toBe(true); // immutable
  });

  it("refuses arguments that are not what they claim", () => {
    expect(() => encodeTopUp("nonsense", 1n)).toThrowError(/not a 32-byte value/);
    expect(() => encodeApprove("0x1234", 1n)).toThrowError(/not an address/);
  });
});

describe("fund (D3, D12, D23)", () => {
  it("buys an immutable batch owned by the user, paid by someone else", async () => {
    const provider = mockChain();
    const result = await make(provider).fund({ owner: OWNER, depth: 20, amountPerChunk: 100n });

    expect(result.batchId).toBe(BATCH);
    expect(result.totalCost).toBe(100n * 2n ** 20n);

    const [approve, create] = provider.sent;
    expect(approve?.to).toBe(sepolia.bzzToken);
    expect(create?.to).toBe(sepolia.postageStamp);
    expect(create?.data).toContain(OWNER.slice(2)); // owner is the derived key
    expect(create?.data).not.toContain(PAYER.slice(2)); // the payer is not the owner
  });

  it("skips the approval when the allowance is already there", async () => {
    const provider = mockChain({ allowance: 10n ** 30n });
    await make(provider).fund({ owner: OWNER, depth: 20, amountPerChunk: 100n });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.to).toBe(sepolia.postageStamp);
  });

  it("refuses a mutable batch, and says why (D4)", async () => {
    await expect(
      make(mockChain()).fund({ owner: OWNER, depth: 20, amountPerChunk: 1n, immutable: false }),
    ).rejects.toThrowError(/silently replaces your oldest data/);
  });

  it("needs either a budget or a depth and an amount", async () => {
    await expect(make(mockChain()).fund({ owner: OWNER })).rejects.toThrowError(DappDataError);
  });
});

describe("quote (D23)", () => {
  it("sizes depth and amount from a write budget", async () => {
    const transport = memory();
    transport.setPrice(24_000n);
    const quoted = await make(mockChain(), transport).quote({
      writesPerDay: 50,
      retentionDays: 90,
    });

    expect(quoted.depth).toBeGreaterThanOrEqual(17);
    // 90 days of Sepolia blocks at 12 s, times the price per chunk per block.
    expect(quoted.amountPerChunk).toBe(24_000n * BigInt(Math.ceil((90 * 86_400) / 12)));
    expect(quoted.total).toBe(quoted.amountPerChunk * 2n ** BigInt(quoted.depth));
  });

  it("asks for more depth when the dapp writes more", async () => {
    const f = make(mockChain());
    const small = await f.quote({ writesPerDay: 10, retentionDays: 30 });
    const large = await f.quote({ writesPerDay: 10_000, retentionDays: 365 });
    expect(large.depth).toBeGreaterThan(small.depth);
  });

  it("rejects a budget that asks for nothing", async () => {
    await expect(make(mockChain()).quote({ writesPerDay: 0, retentionDays: 1 })).rejects.toThrowError(
      /positive numbers/,
    );
  });
});

describe("health (D3, D23)", () => {
  it("turns what the node knows into days left", async () => {
    const transport = memory();
    transport.setBatch({
      batchId: BATCH,
      usable: true,
      depth: 20,
      bucketDepth: 16,
      immutable: true,
      utilization: 4,
      ttlSeconds: 172_800,
    });

    const health = await make(mockChain(), transport).health(BATCH);
    expect(health?.usable).toBe(true);
    expect(health?.daysLeft).toBe(2);
    expect(health?.usage).toBeGreaterThan(0);
    expect(health?.immutable).toBe(true);
  });

  it("returns null for a batch the node has never heard of", async () => {
    expect(await make(mockChain()).health(BATCH)).toBeNull();
  });
});

describe("topUp (D3, T9)", () => {
  it("extends a batch the payer does not own", async () => {
    const transport = memory();
    transport.setBatch({
      batchId: BATCH,
      usable: true,
      depth: 20,
      bucketDepth: 16,
      immutable: true,
      utilization: 1,
      ttlSeconds: 100,
    });

    const provider = mockChain({ allowance: 10n ** 30n });
    await make(provider, transport).topUp(BATCH, 50n);

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.to).toBe(sepolia.postageStamp);
    expect(provider.sent[0]?.data).toContain(BATCH);
  });
});

describe("chains", () => {
  it("carries the addresses Bee itself builds against", () => {
    expect(sepolia.postageStamp).toBe("0xcdfdC3752caaA826fE62531E0000C40546eC56A6");
    expect(sepolia.bzzToken).toBe("0x543dDb01Ba47acB11de34891cD86B675F04840db");
    expect(gnosis.postageStamp).toBe("0x45a1502382541Cd610CC9068e88727426b696293");
    expect(gnosis.bzzToken).toBe("0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da");
  });
});
