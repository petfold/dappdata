// Control for overflow.mjs: same bucket, DISTINCT slots (0 and 1). Both chunks must stay retrievable.
// If they do while the same-slot pair loses its first chunk, slot collision really replaces the earlier chunk.
import { ethers } from 'ethers'; import { readFileSync } from 'node:fs'
import { Bee } from '@ethersphere/bee-js'
import { PrivateKey, Topic, makeContentAddressedChunk, stamp } from '@ethersphere/core-sdk'
const BATCH = process.env.BATCH ?? 'c044860d45d2f53139a866c584c0d26c5bac68604d98411cd6a1c4dc7f0bd16b'
const ownerKey = new PrivateKey(readFileSync(`${process.env.HOME}/.dappdata-sepolia-owner.key`, 'utf8').trim())
const up = new Bee('http://127.0.0.1:1653'), rd = new Bee('http://127.0.0.1:1643')
function socFor(topicName, index, text) { const topic = Topic.fromString(topicName); const idx = new Uint8Array(8); idx[7] = index; const identifier = ethers.getBytes(ethers.keccak256(ethers.concat([topic.toUint8Array(), idx]))); const cac = makeContentAddressedChunk(new TextEncoder().encode(text)); return { identifier, cac, soc: cac.toSingleOwnerChunk(identifier, ownerKey) } }
const tag = 'dappdata/s3/control/' + Date.now()
const c1 = socFor(tag, 0, 'control first'); let c2, t = 0
do { t++; c2 = socFor(tag + '/' + t, 1, 'control second') } while (c2.soc.address.toUint8Array()[0] !== c1.soc.address.toUint8Array()[0] || c2.soc.address.toUint8Array()[1] !== c1.soc.address.toUint8Array()[1])
console.log('same bucket, distinct slots; pair found after', t, 'tries; batch', BATCH.slice(0, 12))
const upl = async (s, slot) => { try { const r = await up.soc.makeWriter(ownerKey).upload(stamp(ownerKey, BATCH, s.soc.address.toUint8Array(), slot), s.identifier, s.cac.data); return 'accepted ' + r.reference.toHex().slice(0, 12) } catch (e) { return 'rejected ' + String(e.message).slice(0, 80) } }
console.log('slot 0 chunk 1:', await upl(c1, 0)); console.log('slot 1 chunk 2:', await upl(c2, 1))
const has = async (s) => { try { await rd.chunk.download(s.soc.address, undefined, { timeout: 40000 }); return true } catch { return false } }
for (const wait of [20000, 60000]) { await new Promise(r => setTimeout(r, wait)); console.log(`after +${wait / 1000} s: chunk 1 retrievable from the other node:`, await has(c1), '| chunk 2:', await has(c2)) }
