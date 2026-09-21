/**
 * Phase 2 gate run (PLAN, "Funding flows"): sign-in to funded-and-writing on
 * a real network, with the payer a different key from the owner.
 *
 *   pnpm --filter @dappdata/phase2-gate gate
 *
 * Needs a Bee node on BEE (default: the Sepolia writer on :1643) and the
 * throwaway payer key from S3. Testnet only — it spends sBZZ and sETH.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { ethers } from "ethers";
import { DappData, entropy, transport, funding as fundingFor, sepolia } from "dappdata";

const BEE = process.env.BEE ?? "http://127.0.0.1:1643";
// A different endpoint from the one the node uses: publicnode rate-limits
// bursts from this machine once Bee is on it (CLAUDE.md, S2/S3).
const RPC = process.env.RPC ?? "https://sepolia.gateway.tenderly.co";
const OUT = new URL("../results/", import.meta.url).pathname;

// Throwaway BIP-39 phrases. These folders hold nothing but this run's state.
const SPONSORED = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const SELF_PAYING = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const provider = new ethers.JsonRpcProvider(RPC);

/** Public endpoints drop requests under load; a few retries beat a lost run. */
const withRetry = async (what, fn, tries = 6) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= tries) throw error;
      console.log(`  (${what} failed: ${String(error.shortMessage ?? error.message).slice(0, 60)}; retry ${attempt})`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
};
const log = [];
const say = (...parts) => {
  const line = parts.join(" ");
  console.log(line);
  log.push(line);
};

/** The smallest EIP-1193 surface the SDK's funding module asks for. */
const walletProvider = (wallet) => ({
  async request({ method, params }) {
    switch (method) {
      case "eth_requestAccounts":
        return [wallet.address];
      case "eth_call":
        return withRetry("eth_call", () => provider.call({ to: params[0].to, data: params[0].data }));
      case "eth_sendTransaction": {
        const sent = await withRetry("sendTransaction", () =>
          wallet.sendTransaction({ to: params[0].to, data: params[0].data }),
        );
        await withRetry("wait", () => sent.wait());
        return sent.hash;
      }
      case "eth_getTransactionReceipt": {
        const receipt = await withRetry("getReceipt", () => provider.getTransactionReceipt(params[0]));
        return receipt ? { logs: receipt.logs.map((l) => ({ topics: [...l.topics] })) } : null;
      }
      default:
        throw new Error(`unexpected ${method}`);
    }
  },
});

/** A checkpoint store on disk: one device's own copy of the bucket state. */
const fileStore = (path) => ({
  async load() {
    if (!existsSync(path)) return null;
    const wire = JSON.parse(readFileSync(path, "utf8"));
    return {
      batchId: wire.batchId,
      depth: wire.depth,
      generation: wire.generation,
      reserved: new Map(wire.reserved),
    };
  },
  async save(state) {
    writeFileSync(
      path,
      JSON.stringify({
        batchId: state.batchId,
        depth: state.depth,
        generation: state.generation,
        reserved: [...state.reserved.entries()],
      }),
    );
  },
});

/** An address in a chosen bucket: the bucket is the top 16 bits (D19). */
const addressIn = (bucket, nonce) => {
  const address = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(`gate-${bucket}-${nonce}`)));
  address[0] = (bucket >> 8) & 0xff;
  address[1] = bucket & 0xff;
  return address;
};

const slotOf = (stamp) => {
  const view = new DataView(stamp.buffer, stamp.byteOffset + 32, 8);
  return `${view.getUint32(0)}/${view.getUint32(4)}`;
};

const waitFor = async (what, check, seconds = 300) => {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
};

async function connect(phrase, app) {
  return DappData.connect({
    entropy: entropy.mnemonic(phrase),
    app: { id: app },
    transport: transport.fetch(BEE),
  });
}

async function buy(dd, payer, label, depth = 17) {
  say(`\n## ${label}`);
  say(`payer  ${payer.address}`);
  say(`owner  ${dd.address}   (derived from the signature; holds no tokens)`);

  const money = dd.funding(walletProvider(payer), sepolia, payer.address);
  const quote = await money.quote({ writesPerDay: 20, retentionDays: 1 });
  say(`quote  depth ${quote.depth} would cost ${ethers.formatUnits(quote.total, 16)} sBZZ for a day`);

  const started = Date.now();
  const batch = await money.fund({ depth, amountPerChunk: quote.amountPerChunk });
  say(`batch  ${batch.batchId}`);
  say(`cost   ${ethers.formatUnits(batch.totalCost, 16)} sBZZ at depth ${depth} ` +
      `(${2 ** (depth - 16)} slots per bucket), tx ${batch.transactionHash}`);

  const health = await waitFor("the batch to become usable", async () => {
    const h = await money.health(batch.batchId);
    return h?.usable ? h : null;
  });
  say(`usable after ${Math.round((Date.now() - started) / 1000)} s; ${health.daysLeft.toFixed(2)} days, immutable ${health.immutable}`);
  return { money, batch };
}

say(`# Phase 2 gate run — ${new Date().toISOString()}`);
say(`node ${BEE}, chain ${sepolia.name} (${sepolia.chainId})`);

const sponsor = new ethers.Wallet(
  readFileSync(`${process.env.HOME}/.dappdata-sepolia-swap.key`, "utf8").trim(),
  provider,
);
const app = `phase2-gate-${Date.now()}`;

// 1. Sponsor pays for a user who holds nothing at all.
const sponsoredDd = await connect(SPONSORED, `${app}-sponsored`);
// Depth 20 for the batch the stamper uses: a bucket holds 2^(depth-16)
// chunks, so depth 17 gives two slots per bucket and the two-device test
// below needs more than that (D19).
const sponsored = await buy(sponsoredDd, sponsor, "Sponsor pays (D3)", 20);

// 2. The user pays for themselves: same call, different signer.
//
// The key is kept on disk and reused. An earlier version of this script made
// a fresh random wallet each run and staked it, which stranded the funds in
// a key nobody had saved — twice.
const userKeyFile = `${process.env.HOME}/.dappdata-sepolia-user.key`;
if (!existsSync(userKeyFile)) {
  writeFileSync(userKeyFile, ethers.Wallet.createRandom().privateKey, { mode: 0o600 });
  say(`\ncreated a reusable "user pays" key at ${userKeyFile}`);
}
const userWallet = new ethers.Wallet(readFileSync(userKeyFile, "utf8").trim(), provider);

const bzz = new ethers.Contract(
  sepolia.bzzToken,
  [
    "function transfer(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ],
  sponsor,
);
const needsEth = (await provider.getBalance(userWallet.address)) < ethers.parseEther("0.004");
const needsBzz = (await bzz.balanceOf(userWallet.address)) < ethers.parseUnits("0.02", 16);
say(`\n"user pays" wallet ${userWallet.address}` + (needsEth || needsBzz ? ", staking it" : ", already funded"));
if (needsEth) {
  await withRetry("stake sETH", async () =>
    (await sponsor.sendTransaction({ to: userWallet.address, value: ethers.parseEther("0.006") })).wait(),
  );
}
if (needsBzz) {
  await withRetry("stake sBZZ", async () =>
    (await bzz.transfer(userWallet.address, ethers.parseUnits("0.03", 16))).wait(),
  );
}
const selfDd = await connect(SELF_PAYING, `${app}-self`);
const self = await buy(selfDd, userWallet, "User pays (D3) — the same code path");

// 3. A write stamped by the batch owner, on a node that holds no batch (D12).
say(`\n## Client-side stamped write (D12, D19)`);
mkdirSync(OUT, { recursive: true });
const checkpoint = `${OUT}/stamper-${sponsored.batch.batchId.slice(0, 8)}.json`;
const laptop = await sponsoredDd.stamper(sponsored.batch.batchId, {
  depth: sponsored.batch.depth,
  store: fileStore(checkpoint),
});
say(`checkpoint kept at ${checkpoint}`);

const prefs = sponsoredDd.slot("preferences", {
  schema: 1,
  stamp: { batchId: sponsored.batch.batchId, sign: (address) => laptop.stamp(address) },
});
const written = await prefs.set({ theme: "dark", at: Date.now() });
say(`wrote the slot at index ${written.index}, stamped by the owner key, uploaded to a node holding no batch`);

const seen = await waitFor(
  "a fresh instance to read it back",
  async () => {
    const fresh = await connect(SPONSORED, `${app}-sponsored`);
    const value = await fresh.slot("preferences", { schema: 1 }).get();
    return value?.value?.theme === "dark" ? value : null;
  },
  180,
);
say(`a second, freshly derived instance read it back: ${JSON.stringify(seen.value)} at index ${seen.index}`);

// 4. A second device restores the checkpoint and must not reuse a slot.
say(`\n## Second device restores the checkpoint (D19, T12)`);
// Both devices stamp into ONE bucket: two devices writing in different
// buckets could not collide anyway, so that would prove nothing.
const BUCKET = 4242;
const laptopSlots = [];
for (let i = 0; i < 3; i++) laptopSlots.push(slotOf(await laptop.stamp(addressIn(BUCKET, i))));

const phone = await sponsoredDd.stamper(sponsored.batch.batchId, {
  depth: sponsored.batch.depth,
  store: fileStore(checkpoint),
});
const phoneSlots = [];
for (let i = 0; i < 3; i++) phoneSlots.push(slotOf(await phone.stamp(addressIn(BUCKET, 100 + i))));

// And the laptop waking up afterwards must not collide either.
const laptopLater = [];
for (let i = 0; i < 2; i++) laptopLater.push(slotOf(await laptop.stamp(addressIn(BUCKET, 200 + i))));

const all = [...laptopSlots, ...phoneSlots, ...laptopLater];
const collisions = all.filter((slot, i) => all.indexOf(slot) !== i);
say(`all in bucket ${BUCKET}, which holds ${2 ** (sponsored.batch.depth - 16)} slots at depth ${sponsored.batch.depth}:`);
say(`  laptop before  ${laptopSlots.join(", ")}`);
say(`  phone restored ${phoneSlots.join(", ")}`);
say(`  laptop after   ${laptopLater.join(", ")}`);
say(collisions.length === 0 ? "no slot was spent twice" : `COLLISION: ${collisions.join(", ")}`);

// 5. A non-owner extends someone else's batch (T9).
say(`\n## The sponsor tops up a batch it does not own (T9)`);
const before = await self.money.health(self.batch.batchId);
const sponsorMoney = selfDd.funding(walletProvider(sponsor), sepolia, sponsor.address);
const topUp = await sponsorMoney.topUp(self.batch.batchId, self.batch.amountPerChunk);
say(`topUp tx ${topUp}`);
const after = await waitFor(
  "the top-up to reach the node",
  async () => {
    const h = await self.money.health(self.batch.batchId);
    return h && h.ttlSeconds > before.ttlSeconds ? h : null;
  },
  240,
);
say(`TTL ${(before.ttlSeconds / 3600).toFixed(1)} h -> ${(after.ttlSeconds / 3600).toFixed(1)} h, paid by a non-owner`);

writeFileSync(`${OUT}/run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`, log.join("\n") + "\n");
say(`\ndone`);
