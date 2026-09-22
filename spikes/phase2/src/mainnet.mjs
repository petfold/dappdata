/**
 * Gnosis mainnet run, 2026-09-22 (Peter approved the spend): the funding
 * rehearsal PLAN's Phase 2 owed, then the D19 two-device test spaced past the
 * network's visibility window, a visibility measurement, and a blob — all
 * against Swarm Desktop's light node, which holds no batch of ours.
 *
 *   BEE=http://127.0.0.1:1633 node src/mainnet.mjs
 *
 * Payer: ~/.dappdata-gnosis-payer.key (throwaway). Spends real xBZZ and xDAI.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ethers } from "ethers";
import { DappData, entropy, transport, gnosis } from "dappdata";

const BEE = process.env.BEE ?? "http://127.0.0.1:1633";
const RPC = process.env.RPC ?? "https://rpc.gnosischain.com";
const DEPTH = Number(process.env.DEPTH ?? 17);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 20_000); // wait past the visibility window between devices
const OUT = new URL("../results/", import.meta.url).pathname;
const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";

const provider = new ethers.JsonRpcProvider(RPC, undefined, { batchMaxCount: 1, staticNetwork: true });
const log = [];
const say = (...p) => { const l = p.join(" "); console.log(l); log.push(l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withRetry = async (what, fn, tries = 6) => {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (error) {
      if (attempt >= tries) throw error;
      say(`  (${what} failed: ${String(error.shortMessage ?? error.message).slice(0, 60)}; retry ${attempt})`);
      await sleep(2000 * attempt);
    }
  }
};
const walletProvider = (wallet) => ({
  async request({ method, params }) {
    switch (method) {
      case "eth_requestAccounts": return [wallet.address];
      case "eth_call": return withRetry("eth_call", () => provider.call({ to: params[0].to, data: params[0].data }));
      case "eth_sendTransaction": {
        say(`  tx -> ${params[0].to}`);
        const sent = await withRetry("send", () => wallet.sendTransaction({ to: params[0].to, data: params[0].data }));
        await withRetry("wait", () => sent.wait());
        return sent.hash;
      }
      case "eth_getTransactionReceipt": {
        const r = await withRetry("receipt", () => provider.getTransactionReceipt(params[0]));
        return r ? { logs: r.logs.map((l) => ({ topics: [...l.topics] })) } : null;
      }
      default: throw new Error(`unexpected ${method}`);
    }
  },
});
const waitFor = async (what, check, seconds = 300) => {
  const until = Date.now() + seconds * 1000;
  for (;;) { const r = await check(); if (r) return r; if (Date.now() > until) throw new Error(`timed out: ${what}`); await sleep(5000); }
};
const slotOf = (stamp) => { const v = new DataView(stamp.buffer, stamp.byteOffset + 32, 8); return `${v.getUint32(0)}/${v.getUint32(4)}`; };
const addressIn = (bucket, nonce) => { const a = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(`gno-${bucket}-${nonce}`))); a[0] = (bucket >> 8) & 0xff; a[1] = bucket & 0xff; return a; };
const spentByAll = [];
const tracked = (label, s) => ({ ...s, batchId: s.batchId, async sign(a) { const m = await s.sign(a); spentByAll.push({ label, slot: slotOf(m) }); return m; }, async stamp(a) { return this.sign(a); } });

const payer = new ethers.Wallet(readFileSync(`${process.env.HOME}/.dappdata-gnosis-payer.key`, "utf8").trim(), provider);
const app = `gnosis-${Date.now()}`;
const connect = () => DappData.connect({ entropy: entropy.mnemonic(PHRASE), app: { id: app }, transport: transport.fetch(BEE) });

say(`# Gnosis mainnet run — ${new Date().toISOString()}`);
say(`node ${BEE}; payer ${payer.address}; xDAI ${ethers.formatEther(await provider.getBalance(payer.address))}`);

// 1. Funding rehearsal (PLAN Phase 2, "Gnosis only for the funding rehearsal").
say(`\n## Sponsor buys a depth-${DEPTH} batch owned by the derived key (D3, D12) on Gnosis`);
const laptopDd = await connect();
say(`owner ${laptopDd.address}`);
const money = laptopDd.funding(walletProvider(payer), gnosis, payer.address);
const quote = await money.quote({ writesPerDay: 20, retentionDays: 1 });
say(`quote: ${quote.amountPerChunk} PLUR/chunk; depth ${DEPTH} for a day = ${ethers.formatUnits(quote.amountPerChunk * 2n ** BigInt(DEPTH), 16)} xBZZ`);
const t0 = Date.now();
const batch = await money.fund({ depth: DEPTH, amountPerChunk: quote.amountPerChunk });
say(`batch ${batch.batchId}; cost ${ethers.formatUnits(batch.totalCost, 16)} xBZZ; tx ${batch.transactionHash}`);
const health = await waitFor("usable", async () => { const h = await money.health(batch.batchId); return h?.usable ? h : null; });
say(`usable after ${Math.round((Date.now() - t0) / 1000)} s; contract says ${health.daysLeft.toFixed(2)} days (ttlSource ${health.ttlSource})`);
const nodeView = await (await fetch(`${BEE}/batches/${batch.batchId}`)).json().catch(() => null);
if (nodeView?.batchTTL) say(`node batchTTL ${(nodeView.batchTTL / 86400).toFixed(2)} days vs contract ${health.daysLeft.toFixed(2)} (Sepolia was 170x off; IDEA-198 found Gnosis within 1 %)`);

// 2. Laptop: default slot-backed store; data, one bucket, a blob.
say(`\n## Laptop writes (default self-stamping store)`);
const laptop = tracked("laptop", await laptopDd.stamper(batch.batchId, { depth: DEPTH, block: 2 }));
const notes = laptopDd.slot("notes", { schema: 1 });
for (let i = 0; i < 2; i++) { const h = await notes.get(); await notes.set([...(h?.value ?? []), `laptop ${i}`], { expectIndex: h?.index, stamp: laptop }); }
const BUCKET = 4242;
const laptopSlots = [slotOf(await laptop.stamp(addressIn(BUCKET, 1)))];
say(`notes written; bucket ${BUCKET}: ${laptopSlots.join(", ")}`);
const bulk = laptopDd.slot("bulk", { schema: 1 });
const tb = Date.now();
await bulk.set({ text: "gnosis ".repeat(1500) }, { stamp: laptop });
say(`blob (~10 KB, sealed, client-chunked, every chunk stamped) written in ${Date.now() - tb} ms`);
const cp = await laptopDd.slot(`.stamper/${batch.batchId}`, { schema: 1 }).get();
say(`checkpoint at index ${cp.index}, generation ${cp.value.generation}`);

// 3. Visibility on this node: write, then poll from a fresh instance.
say(`\n## Same-node visibility (T18) on the mainnet light node`);
const vis = laptopDd.slot("vis", { schema: 1 });
const reader = (await connect()).slot("vis", { schema: 1 });
for (let i = 0; i < 3; i++) {
  const h = await vis.get(); const tw = Date.now();
  const { index } = await vis.set({ i }, { expectIndex: h?.index, stamp: laptop });
  const wrote = Date.now() - tw; let seen = null; let polls = 0;
  while (Date.now() - tw < 90_000) { polls++; const g = await reader.get().catch(() => null); if (g && g.index === index) { seen = Date.now() - tw; break; } await sleep(250); }
  say(`update ${index}: write ${wrote} ms; visible to a fresh instance after ${seen ?? ">90000"} ms (${polls} polls)`);
}

// 4. Phone, after the window: restores from the network, takes slots above the line.
say(`\n## Phone restores after ${SETTLE_MS / 1000} s (T12) and writes`);
await sleep(SETTLE_MS);
const phoneDd = await waitFor("checkpoint readable by a fresh instance", async () => { const f = await connect(); const s = await f.slot(`.stamper/${batch.batchId}`, { schema: 1 }).get(); return s && s.index >= cp.index ? f : null; }, 180);
const phone = tracked("phone", await phoneDd.stamper(batch.batchId, { depth: DEPTH, block: 2 }));
// At depth 17 a bucket holds two slots and the laptop reserved both, so the
// shared bucket must come back "full" — the D4 refusal, not a reuse.
try {
  const s = slotOf(await phone.stamp(addressIn(BUCKET, 2)));
  say(`bucket ${BUCKET}: phone took ${s} (would only be right on a deeper batch)`);
} catch (e) {
  say(`bucket ${BUCKET}: phone refused with ${e.code}: the laptop's reservation covers the whole bucket at depth ${DEPTH} (D4, D19)`);
}
const phoneSlots = [slotOf(await phone.stamp(addressIn(BUCKET + 1, 2)))];
say(`bucket ${BUCKET + 1}: ${phoneSlots.join(", ")}`);
const pn = phoneDd.slot("notes", { schema: 1 }); const ph = await pn.get();
await pn.set([...(ph?.value ?? []), "phone 0"], { expectIndex: ph?.index, stamp: phone });
say(`phone appended to notes: ${(await pn.get()).value.length} entries; blob read back: ${(await phoneDd.slot("bulk", { schema: 1 }).get())?.value.text.length === 10500 ? "identical" : "DIFFERENT"}`);

// 5. Sponsor tops up the batch it does not own (T9), on Gnosis.
say(`\n## Non-owner topUp (T9)`);
const before = await money.health(batch.batchId);
const tx = await money.topUp(batch.batchId, quote.amountPerChunk);
const after = await waitFor("top-up on chain", async () => { const h = await money.health(batch.batchId); return h && h.ttlSeconds > before.ttlSeconds ? h : null; }, 240);
say(`topUp tx ${tx}: ${(before.ttlSeconds / 3600).toFixed(1)} h -> ${(after.ttlSeconds / 3600).toFixed(1)} h`);

// 6. Verdict.
const all = spentByAll.map((s) => s.slot); const dupes = all.filter((s, i) => all.indexOf(s) !== i);
say(`\n## Verdict: ${all.length} stamps, ${dupes.length === 0 ? "no slot spent twice" : "COLLISION " + [...new Set(dupes)].join(", ")}`);
say(`payer left: ${ethers.formatEther(await provider.getBalance(payer.address))} xDAI`);
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/gnosis-${new Date().toISOString().replace(/[:.]/g, "-")}.log`, log.join("\n") + "\n");
say(`\ndone`);
if (dupes.length) process.exit(1);
