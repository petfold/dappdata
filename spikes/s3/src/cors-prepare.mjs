// Prepares a pre-stamped SOC upload request for the browser CORS test (S3 browser write path, step 3).
// Prints JSON: url, stamp header, body as hex. The browser page (another origin) performs the fetch.
import { ethers } from 'ethers'; import { readFileSync } from 'node:fs'
import { PrivateKey, Topic, Stamper, makeContentAddressedChunk, convertEnvelopeToMarshaledStamp } from '@ethersphere/core-sdk'
const id = process.env.BATCH ?? 'c044860d45d2f53139a866c584c0d26c5bac68604d98411cd6a1c4dc7f0bd16b'
const ownerKey = new PrivateKey(readFileSync(`${process.env.HOME}/.dappdata-sepolia-owner.key`, 'utf8').trim())
const owner = ownerKey.publicKey().address().toHex()
const topic = Topic.fromString('dappdata/s3/cors/' + Date.now())
const identifier = ethers.getBytes(ethers.keccak256(ethers.concat([topic.toUint8Array(), new Uint8Array(8)])))
const cac = makeContentAddressedChunk(new TextEncoder().encode('cors test from a browser origin'))
const soc = cac.toSingleOwnerChunk(identifier, ownerKey)
const env = Stamper.fromBlank(ownerKey, id, 17).stamp(soc.address.toUint8Array())
const sig = ethers.hexlify(soc.signature.toUint8Array()).slice(2)
const idHex = ethers.hexlify(identifier).slice(2)
const url = 'http://127.0.0.1:1653/soc/' + owner + '/' + idHex + '?sig=' + sig
console.log(JSON.stringify({ url, stamp: convertEnvelopeToMarshaledStamp(env).toHex(), bodyHex: ethers.hexlify(cac.data).slice(2), expectedReference: soc.address.toHex() }))
