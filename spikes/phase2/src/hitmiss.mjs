/** How long does the node take to answer a read of a chunk it has, and of one that does not exist? */
import { DappData, entropy, transport, slotTopic } from "dappdata";
const BEE = process.env.BEE ?? "http://127.0.0.1:1643";
const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const APP = process.env.APP;
const SLOT = process.env.SLOT ?? "vis-pinned";
const t = transport.fetch(BEE);
const dd = await DappData.connect({ entropy: entropy.mnemonic(PHRASE), app: { id: APP }, transport: t });
const topic = slotTopic(APP, SLOT);
const head = await dd.slot(SLOT, { schema: 1 }).get();
console.log(`head index ${head?.index}`);
const time = async (label, index) => {
  const t0 = Date.now();
  const r = await t.getFeedUpdate({ owner: dd.address, topic, index });
  console.log(`${label} index ${index}: ${Date.now() - t0} ms -> ${r ? "found" : "missing"}`);
};
for (let i = 0; i < 4; i++) await time("hit ", head.index);
for (let i = 0; i < 4; i++) await time("miss", head.index + 1n + BigInt(i));
