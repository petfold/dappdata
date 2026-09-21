import { describe, expect, it } from "vitest";
import { memory } from "../src/transport/memory.js";
import { funding, sepolia, gnosis, BUCKET_DEPTH } from "../src/funding/index.js";
import {
  BATCH_CREATED_TOPIC,
  batchIdFor,
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

function mockChain(
  options: { allowance?: bigint; emits?: string | null } = {},
): Eip1193Provider & { sent: Sent[] } {
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
          // `emits` null means a receipt with no BatchCreated log, which is
          // what a node returns when it does not index them; the SDK then
          // trusts the id it derived.
          return options.emits === null
            ? { logs: [] }
            : { logs: [{ topics: [BATCH_CREATED_TOPIC, "0x" + (options.emits ?? BATCH)] }] };
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
    // The deployment emits the SEVEN-parameter event, without a payer. The
    // eight-parameter signature in spikes/s3/src/modeb.mjs is wrong; the
    // spike only worked because it read topics[1] positionally.
    expect(BATCH_CREATED_TOPIC).toBe(
      "0x9b088e2c89b322a3c1d81515e1c88db3d386d022926f0e2d0b9b5813b7413d58",
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

describe("the batch id is derived, not reported", () => {
  it("matches what the chain created, on a real transaction", () => {
    // From Sepolia tx 0xf5d60b9cf9b020ce8f0144f52bf8ab19c6b41eb3ff2f55c48b6acd01a9575981:
    // this payer and this nonce produced exactly this batch, per the event.
    expect(
      batchIdFor(
        "0x6f49CF1cE06E73649B1F07AFE46Cbb598Bc6f3Bc",
        "0xd024cc037191c945ffa18ebaf567425806e6736f09f833cc65f243ce35307642",
      ),
    ).toBe("a71e685b7452dd6520e0ba894de9f622cd3183fc3eb2430b4940d307b6fb39b6");
  });

  it("depends on the payer, not the owner", () => {
    const nonce = "0x" + "11".repeat(32);
    expect(batchIdFor(PAYER, nonce)).not.toBe(batchIdFor(OWNER, nonce));
  });
});

/** The nonce the SDK picked, read out of the createBatch call it sent. */
const nonceOf = (data: string): string => "0x" + data.slice(10).match(/.{64}/g)![4];

describe("fund (D3, D12, D23)", () => {
  it("buys an immutable batch owned by the user, paid by someone else", async () => {
    const provider = mockChain({ emits: null });
    const result = await make(provider).fund({ owner: OWNER, depth: 20, amountPerChunk: 100n });

    const [approve, create] = provider.sent;
    expect(result.batchId).toBe(batchIdFor(PAYER, nonceOf((create as Sent).data)));
    expect(result.totalCost).toBe(100n * 2n ** 20n);

    expect(approve?.to).toBe(sepolia.bzzToken);
    expect(create?.to).toBe(sepolia.postageStamp);
    expect(create?.data).toContain(OWNER.slice(2)); // owner is the derived key
    expect(create?.data).not.toContain(PAYER.slice(2)); // the payer is not the owner
  });

  it("skips the approval when the allowance is already there", async () => {
    const provider = mockChain({ allowance: 10n ** 30n, emits: null });
    await make(provider).fund({ owner: OWNER, depth: 20, amountPerChunk: 100n });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.to).toBe(sepolia.postageStamp);
  });

  it("catches a chain that created a different batch than the one derived", async () => {
    const provider = mockChain({ emits: "ff".repeat(32) });
    await expect(
      make(provider).fund({ owner: OWNER, depth: 20, amountPerChunk: 1n }),
    ).rejects.toThrowError(/the chain created batch/);
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

    // The mock's eth_call returns a zero allowance word, so lastPrice reads 0
    // and health falls back to the node's number, saying which it used.
    const health = await make(mockChain(), transport).health(BATCH);
    expect(health?.usable).toBe(true);
    expect(health?.daysLeft).toBe(2);
    expect(health?.ttlSource).toBe("node");
    expect(health?.usage).toBeGreaterThan(0);
    expect(health?.immutable).toBe(true);
  });

  it("returns null for a batch the node has never heard of", async () => {
    expect(await make(mockChain()).health(BATCH)).toBeNull();
  });
});

describe("health prefers the contract to the node (gate run, 2026-09-21)", () => {
  it("computes the lifetime from remainingBalance and lastPrice", async () => {
    const transport = memory();
    transport.setBatch({
      batchId: BATCH,
      usable: true,
      depth: 17,
      bucketDepth: 16,
      immutable: true,
      utilization: 0,
      ttlSeconds: 14_382_144, // what Bee said: 166 days, and wrong
    });

    // remainingBalance 420682097, lastPrice 59123 — the values the contract
    // held during the gate run, which are 7115 blocks, 0.99 days at 12 s.
    const chainReads = [420_682_097n, 59_123n];
    let read = 0;
    const provider = {
      async request({ method }: { method: string }): Promise<unknown> {
        if (method === "eth_requestAccounts") return [PAYER];
        if (method === "eth_call") {
          const value = chainReads[read++ % 2] as bigint;
          return "0x" + value.toString(16).padStart(64, "0");
        }
        throw new Error(`unexpected ${method}`);
      },
    };

    const health = await funding({
      payer: provider,
      chain: sepolia,
      transport,
      from: PAYER,
    }).health(BATCH);

    expect(health?.ttlSource).toBe("contract");
    expect(health?.daysLeft).toBeCloseTo(0.99, 2);
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
