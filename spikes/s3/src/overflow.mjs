// S3 step 5, sharpened: what happens when a stamp SLOT is reused (a client that lost its Stamper state, or a
// mutable batch past capacity). Test A on the existing immutable batch; test B on a fresh mutable one.
// Expect: immutable -> the node rejects the reused slot; mutable -> the node accepts and the earlier chunk is gone.
import { ethers } from 'ethers'; import { readFileSync } from 'node:fs'
import { Bee } from '@ethersphere/bee-js'
import { PrivateKey, Topic, makeContentAddressedChunk, stamp } from '@ethersphere/core-sdk'
const RPC = process.env.RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const POSTAGE = '0xcdfdC3752caaA826fE62531E0000C40546eC56A6'
const IMMUTABLE_ID = 'c044860d45d2f53139a866c584c0d26c5bac68604d98411cd6a1c4dc7f0bd16b'
const DEPTH = 17, BUCKET_DEPTH = 16, AMOUNT = 345852000n
const p = new ethers.JsonRpcProvider(RPC)
const payer = new ethers.Wallet(readFileSync(`${process.env.HOME}/.dappdata-sepolia-swap.key`, 'utf8').trim(), p)
const ownerKey = new PrivateKey(readFileSync(`${process.env.HOME}/.dappdata-sepolia-owner.key`, 'utf8').trim())
const owner = ownerKey.publicKey().address().toHex()
const up = new Bee('http://127.0.0.1:1653'), rd = new Bee('http://127.0.0.1:1643')
const postage = new ethers.Contract(POSTAGE, ['function createBatch(address,uint256,uint8,uint8,bytes32,bool) returns (bytes32)', 'event BatchCreated(bytes32 indexed batchId, uint256 totalAmount, uint256 normalisedBalance, address owner, address payer, uint8 depth, uint8 bucketDepth, bool immutableFlag)'], payer)

function socFor(topicName, index, text) {
  const topic = Topic.fromString(topicName); const idx = new Uint8Array(8); idx[7] = index
  const identifier = ethers.getBytes(ethers.keccak256(ethers.concat([topic.toUint8Array(), idx])))
  const cac = makeContentAddressedChunk(new TextEncoder().encode(text)); return { topic, identifier, cac, soc: cac.toSingleOwnerChunk(identifier, ownerKey) }
}
async function uploadWithSlot(batchId, s, slot) {
  const env = stamp(ownerKey, batchId, s.soc.address.toUint8Array(), slot)
  try { const r = await up.soc.makeWriter(ownerKey).upload(env, s.identifier, s.cac.data); return 'accepted ' + r.reference.toHex().slice(0, 12) } catch (e) { return 'rejected: ' + String(e.message).slice(0, 100) }
}
async function retrievable(s) { try { await rd.chunk.download(s.soc.address, undefined, { timeout: 40000 }); return true } catch { return false } }

// --- A: immutable batch, reuse slot 0 in the bucket of a fresh chunk (slot 0 there may be free; use slot 0 twice)
if (!process.env.ONLY_B) {
console.log('A. immutable batch', IMMUTABLE_ID.slice(0, 12))
const a1 = socFor('dappdata/s3/overflow-A', 0, 'A first'), a2 = socFor('dappdata/s3/overflow-A', 1, 'A second')
// force both into the same bucket by picking a2 whose address shares the top 16 bits with a1
let a2x = a2, tries = 0; while ((a2x.soc.address.toUint8Array()[0] !== a1.soc.address.toUint8Array()[0] || a2x.soc.address.toUint8Array()[1] !== a1.soc.address.toUint8Array()[1]) && tries < 400000) { tries++; a2x = socFor('dappdata/s3/overflow-A/' + tries, 1, 'A second') }
console.log('same-bucket pair found after', tries, 'tries')
console.log('  slot 0, chunk 1:', await uploadWithSlot(IMMUTABLE_ID, a1, 0))
console.log('  slot 0 again, chunk 2 (same bucket):', await uploadWithSlot(IMMUTABLE_ID, a2x, 0))
await new Promise(r => setTimeout(r, 15000))
console.log('  chunk 1 retrievable from the other node:', await retrievable(a1), '| chunk 2:', await retrievable(a2x))
}
// --- B: mutable batch
console.log('B. creating a MUTABLE batch, depth', DEPTH)
let mid = process.env.MUTABLE_ID, tx = { hash: 'reused existing batch' }
if (!mid) {
  tx = await postage.createBatch('0x' + owner, AMOUNT, DEPTH, BUCKET_DEPTH, ethers.hexlify(ethers.randomBytes(32)), false); const rc = await tx.wait()
  const ev = rc.logs.map(l => { try { return postage.interface.parseLog(l) } catch { return null } }).find(e => e?.name === 'BatchCreated')
  mid = (ev ? ev.args.batchId : rc.logs.find(l => l.address.toLowerCase() === POSTAGE.toLowerCase()).topics[1]).slice(2)
  console.log('  createBatch', tx.hash, 'batch', mid.slice(0, 12))
}
const t1 = Date.now(); for (;;) { try { if (await up.stamp.getGlobal(mid)) break } catch { } if (Date.now() - t1 > 900000) { console.log('node never saw the batch'); process.exit(1) } await new Promise(r => setTimeout(r, 5000)) }
console.log('  node sees it after', Date.now() - t1, 'ms')
const b1 = socFor('dappdata/s3/overflow-B', 0, 'B first'), bpair = [b1]
let triesB = 0; let b2 = socFor('dappdata/s3/overflow-B/x', 1, 'B second'); while ((b2.soc.address.toUint8Array()[0] !== b1.soc.address.toUint8Array()[0] || b2.soc.address.toUint8Array()[1] !== b1.soc.address.toUint8Array()[1]) && triesB < 400000) { triesB++; b2 = socFor('dappdata/s3/overflow-B/' + triesB, 1, 'B second') }
console.log('  same-bucket pair found after', triesB, 'tries')
let r1 = '', r2 = ''
for (let i = 0; i < 24; i++) { r1 = await uploadWithSlot(mid, b1, 0); if (r1.startsWith('accepted')) break; await new Promise(r => setTimeout(r, 5000)) }
console.log('  slot 0, chunk 1:', r1)
r2 = await uploadWithSlot(mid, b2, 0); console.log('  slot 0 again, chunk 2 (same bucket):', r2)
await new Promise(r => setTimeout(r, 15000))
console.log('  chunk 1 retrievable from the other node:', await retrievable(b1), '| chunk 2:', await retrievable(b2))
await new Promise(r => setTimeout(r, 60000))
console.log('  after 75 s: chunk 1 retrievable from the other node:', await retrievable(b1), '| chunk 2:', await retrievable(b2))
console.log('  chunk 1 retrievable from the upload node itself:', await (async () => { try { await up.chunk.download(b1.soc.address); return true } catch { return false } })())
console.log(JSON.stringify({ mutableBatch: '0x' + mid, createTx: tx.hash }))
