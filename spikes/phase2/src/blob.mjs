/**
 * D27 on a real node: a value too large for one chunk, sealed, split
 * client-side, every chunk stamped by the default stamper (slot-backed
 * checkpoint), uploaded to a node that holds no batch, read back by a fresh
 * instance. Uses the D19 run's batch; APP must be that run's app id.
 */
import { DappData, entropy, transport } from "dappdata";
const BEE = process.env.BEE ?? "http://127.0.0.1:1643";
const BATCH = process.env.BATCH; const APP = process.env.APP;
if (!BATCH || !APP) throw new Error("BATCH and APP required");
const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
// deferred + pin: the user's own node keeps the chunks, so a same-node reader sees them at once (T18).
const t = () => transport.fetch(BEE, undefined, { deferred: true, pin: true });
const connect = () => DappData.connect({ entropy: entropy.mnemonic(PHRASE), app: { id: APP }, transport: t() });

const a = await connect();
const stamper = await a.stamper(BATCH, { depth: 20, block: 4 });
const big = { text: "d27 ".repeat(3000), at: Date.now() }; // ~12 KB JSON
const slot = a.slot(`d27-blob-${Date.now()}`, { schema: 1 });
const t0 = Date.now();
const { index } = await slot.set(big, { stamp: stamper });
console.log(`wrote a ${JSON.stringify(big).length}-byte value as a blob at feed index ${index} in ${Date.now() - t0} ms`);

const b = await connect();
const t1 = Date.now();
const back = await b.slot(slot.name, { schema: 1 }).get();
console.log(`fresh instance read it back in ${Date.now() - t1} ms: ${back?.value.text.length === big.text.length && back?.value.at === big.at ? "identical" : "DIFFERENT"}`);
