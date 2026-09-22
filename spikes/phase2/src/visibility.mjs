/**
 * Same-node visibility: instance A writes a feed update through the node,
 * instance B (same folder, separate object, no memory of the write) polls a
 * read by index through the same node. How long until B sees it? This is the
 * window inside which two devices cannot see each other's checkpoints (D19,
 * D6, T18). Uses the D19 run's batch; a handful of slots.
 */
import { DappData, entropy, transport } from "dappdata";
const BEE = process.env.BEE ?? "http://127.0.0.1:1643";
const BATCH = process.env.BATCH;
if (!BATCH) throw new Error("BATCH=<batch id owned by the derived key of this phrase>");
const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const APP = process.env.APP ?? `d19-vis-${Date.now()}`;
const DEFERRED = process.env.DEFERRED === "1";
const PIN = process.env.PIN === "1";
const connect = () =>
  DappData.connect({
    entropy: entropy.mnemonic(PHRASE),
    app: { id: APP },
    transport: transport.fetch(BEE, undefined, { deferred: DEFERRED, pin: PIN }),
  });

const a = await connect();
const b = await connect();
const stamper = await a.stamper(BATCH, { depth: 20, block: 4, store: { async load() { return null; }, async save() {} } });
const SLOT = process.env.SLOT ?? "vis";
const wa = a.slot(SLOT, { schema: 1 });
const rb = b.slot(SLOT, { schema: 1 });
console.log(`app ${APP}; owner ${a.address}; deferred upload ${DEFERRED}, pin ${PIN}`);
for (let i = 0; i < 6; i++) {
  const head = await wa.get();
  const t0 = Date.now();
  const { index } = await wa.set({ i, t0 }, { expectIndex: head?.index, stamp: stamper });
  const tWrite = Date.now() - t0;
  let seen = null;
  let polls = 0;
  while (Date.now() - t0 < 120_000) {
    polls++;
    const got = await rb.get().catch((e) => ({ error: String(e.message).slice(0, 60) }));
    if (got && !("error" in got) && got.index === index) { seen = Date.now() - t0; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`update ${index}: write ${tWrite} ms; visible to the other instance after ${seen === null ? ">120000" : seen} ms (${polls} polls)`);
  await new Promise((r) => setTimeout(r, 3000));
}
