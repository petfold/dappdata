import { ethers } from 'ethers'; import { readFileSync } from 'node:fs'
import { Bee } from '@ethersphere/bee-js'
import { PrivateKey, Topic, makeContentAddressedChunk } from '@ethersphere/core-sdk'
const ownerKey = new PrivateKey(readFileSync(`${process.env.HOME}/.dappdata-sepolia-owner.key`, 'utf8').trim())
function socFor(topicName, index, text) { const topic = Topic.fromString(topicName); const idx = new Uint8Array(8); idx[7] = index; const identifier = ethers.getBytes(ethers.keccak256(ethers.concat([topic.toUint8Array(), idx]))); return makeContentAddressedChunk(new TextEncoder().encode(text)).toSingleOwnerChunk(identifier, ownerKey) }
const a1 = socFor('dappdata/s3/overflow-A', 0, 'A first')
let a2, tries = 0; do { tries++; a2 = socFor('dappdata/s3/overflow-A/' + tries, 1, 'A second') } while (a2.address.toUint8Array()[0] !== a1.address.toUint8Array()[0] || a2.address.toUint8Array()[1] !== a1.address.toUint8Array()[1])
console.log('a1', a1.address.toHex(), 'a2', a2.address.toHex())
for (const [name, url] of [['writer :1643', 'http://127.0.0.1:1643'], ['uploader :1653', 'http://127.0.0.1:1653'], ['gateway bzz.link', 'https://bzz.link']]) {
  const bee = new Bee(url); const get = async (c) => { const t = Date.now(); try { await bee.chunk.download(c.address, undefined, { timeout: 40000 }); return `yes (${Date.now() - t} ms)` } catch (e) { return `no (${String(e.message).slice(0, 40)})` } }
  console.log(name, '| chunk 1:', await get(a1), '| chunk 2:', await get(a2))
}
