/**
 * D19 closure run: the stamper's checkpoint lives in a slot of the user's own
 * folder and is stamped by the stamper it checkpoints — no caller-supplied
 * store, nothing on disk. Two devices share it through the network alone.
 *
 *   pnpm --filter @dappdata/phase2-gate d19
 *
 * Needs the Sepolia writer node on BEE (default :1643) and the throwaway
 * payer key from S3. Testnet only — it spends sBZZ and sETH.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ethers } from "ethers";
import { DappData, entropy, transport, sepolia } from "dappdata";

const BEE = process.env.BEE ?? "http://127.0.0.1:1643";
// publicnode, one request per HTTP call: ethers batches JSON-RPC by default and
// the first run of this script hung silently in sendTransaction on Tenderly.
const RPC = process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const OUT = new URL("../results/", import.meta.url).pathname;

// Throwaway BIP-39 phrase. This folder holds nothing but this run's state.
const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";

const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1, staticNetwork: true });
const log = [];
const say = (...parts) => {
  const line = parts.join(" ");
  console.log(line);
  log.push(line);
};
const withRetry = async (what, fn, tries = 6) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= tries) throw error;
      say(`  (${what} failed: ${String(error.shortMessage ?? error.message).slice(0, 60)}; retry ${attempt})`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
};
const walletProvider = (wallet) => ({
  async request({ method, params }) {
    switch (method) {
      case "eth_requestAccounts":
        return [wallet.address];
      case "eth_call":
        return withRetry("eth_call", () => provider.call({ to: params[0].to, data: params[0].data }));
      case "eth_sendTransaction": {
        say(`  sending a transaction to ${params[0].to}`);
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
const waitFor = async (what, check, seconds = 300) => {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
};
const slotOf = (stamp) => {
  const view = new DataView(stamp.buffer, stamp.byteOffset + 32, 8);
  return `${view.getUint32(0)}/${view.getUint32(4)}`;
};
/** An address in a chosen bucket: the bucket is the top 16 bits (D19). */
const addressIn = (bucket, nonce) => {
  const address = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(`d19-${bucket}-${nonce}`)));
  address[0] = (bucket >> 8) & 0xff;
  address[1] = bucket & 0xff;
  return address;
};

/** Every stamp this run hands out, so the collision check covers checkpoints too. */
const spentByAll = [];
const tracked = (label, stamper) => ({
  ...stamper,
  batchId: stamper.batchId,
  async sign(address) {
    const marshalled = await stamper.sign(address);
    spentByAll.push({ label, slot: slotOf(marshalled) });
    return marshalled;
  },
  async stamp(address) {
    return this.sign(address);
  },
});

const connect = (app) =>
  DappData.connect({ entropy: entropy.mnemonic(PHRASE), app: { id: app }, transport: transport.fetch(BEE) });

say(`# D19 closure run — ${new Date().toISOString()}`);
say(`node ${BEE}, chain ${sepolia.name} (${sepolia.chainId})`);

const sponsor = new ethers.Wallet(readFileSync(`${process.env.HOME}/.dappdata-sepolia-swap.key`, "utf8").trim(), provider);
const app = `d19-${Date.now()}`;

// 1. A sponsor buys a depth-20 batch owned by the derived key (D3, D12).
say(`\n## Sponsor buys the batch (D3)`);
const laptopDd = await connect(app);
say(`owner  ${laptopDd.address}   payer ${sponsor.address}`);
const money = laptopDd.funding(walletProvider(sponsor), sepolia, sponsor.address);
const quote = await money.quote({ writesPerDay: 20, retentionDays: 1 });
say(`quote  ${quote.amountPerChunk} PLUR per chunk; depth 20 costs ${ethers.formatUnits(quote.amountPerChunk * 2n ** 20n, 16)} sBZZ for a day`);
const started = Date.now();
const batch = await money.fund({ depth: 20, amountPerChunk: quote.amountPerChunk });
say(`batch  ${batch.batchId}  cost ${ethers.formatUnits(batch.totalCost, 16)} sBZZ  tx ${batch.transactionHash}`);
await waitFor("the batch to become usable", async () => (await money.health(batch.batchId))?.usable);
say(`usable after ${Math.round((Date.now() - started) / 1000)} s`);

// 2. The laptop: default store, nothing supplied. Its checkpoint is a slot.
say(`\n## Laptop: stamper with the default (slot-backed) checkpoint store`);
const laptop = tracked("laptop", await laptopDd.stamper(batch.batchId, { depth: 20, block: 4 }));
const notes = laptopDd.slot("notes", { schema: 1 });
for (let i = 0; i < 3; i++) {
  const head = await notes.get();
  const { index } = await notes.set([...(head?.value ?? []), `laptop ${i}`], { expectIndex: head?.index, stamp: laptop });
  say(`  wrote notes[${index}]`);
}
const BUCKET = 4242;
const laptopSlots = [];
for (let i = 0; i < 3; i++) laptopSlots.push(slotOf(await laptop.stamp(addressIn(BUCKET, i))));
say(`  bucket ${BUCKET}: ${laptopSlots.join(", ")}`);
const checkpointSlot = laptopDd.slot(`.stamper/${batch.batchId}`, { schema: 1 });
const cp = await checkpointSlot.get();
say(`  checkpoint slot at index ${cp.index}, generation ${cp.value.generation}, ${cp.value.reserved.length} buckets reserved`);

// 3. The phone: a fresh instance, nothing but the phrase. Must restore the
//    checkpoint from the network and take slots above the laptop's lines.
say(`\n## Phone: fresh instance restores the checkpoint from the folder (T12)`);
const phoneDd = await waitFor(
  "the checkpoint to be readable by a fresh instance",
  async () => {
    const fresh = await connect(app);
    const seen = await fresh.slot(`.stamper/${batch.batchId}`, { schema: 1 }).get();
    return seen && seen.index >= cp.index ? fresh : null;
  },
  180,
);
const phone = tracked("phone", await phoneDd.stamper(batch.batchId, { depth: 20, block: 4 }));
const phoneSlots = [];
for (let i = 0; i < 3; i++) phoneSlots.push(slotOf(await phone.stamp(addressIn(BUCKET, 100 + i))));
say(`  bucket ${BUCKET}: ${phoneSlots.join(", ")}`);
const phoneNotes = phoneDd.slot("notes", { schema: 1 });
const head = await phoneNotes.get();
await phoneNotes.set([...(head?.value ?? []), "phone 0"], { expectIndex: head?.index, stamp: phone });
say(`  phone appended to notes; ${(await phoneNotes.get()).value.length} entries`);

// 4. The laptop wakes up with its own stale view and writes again.
say(`\n## Laptop wakes up and extends from a moved line`);
const laptopLater = [];
for (let i = 0; i < 3; i++) laptopLater.push(slotOf(await laptop.stamp(addressIn(BUCKET, 200 + i))));
say(`  bucket ${BUCKET}: ${laptopLater.join(", ")}`);

// 5. Both devices publish a checkpoint at once: the race the slot store detects.
say(`\n## Both devices extend at the same moment (checkpoint race)`);
const OTHER = 777;
const raced = await Promise.all([
  laptop.stamp(addressIn(OTHER, 1)).then(slotOf),
  phone.stamp(addressIn(OTHER, 2)).then(slotOf),
]);
say(`  bucket ${OTHER}: laptop ${raced[0]}, phone ${raced[1]}`);

// 6. Verdict: no (bucket, slot) spent twice, checkpoints included.
const all = spentByAll.map((s) => s.slot);
const dupes = all.filter((slot, i) => all.indexOf(slot) !== i);
say(`\n## Verdict`);
say(`${all.length} stamps issued (${spentByAll.filter((s) => s.label === "laptop").length} laptop, ${spentByAll.filter((s) => s.label === "phone").length} phone), checkpoint chunks included`);
say(dupes.length === 0 ? "no slot was spent twice" : `COLLISION: ${[...new Set(dupes)].join(", ")}`);
const finalCp = await phoneDd.slot(`.stamper/${batch.batchId}`, { schema: 1 }).get();
say(`final checkpoint at index ${finalCp.index}, generation ${finalCp.value.generation}`);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/d19-${new Date().toISOString().replace(/[:.]/g, "-")}.log`, log.join("\n") + "\n");
say(`\ndone`);
if (dupes.length) process.exit(1);
