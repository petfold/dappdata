// S3 mode B on Sepolia: user owns the batch, anyone pays, stamps are signed client-side (D3(d), D12).
// Steps from docs/SPIKES.md: 1 createBatch by a payer with _owner = a different "user" key; 6 time until usable;
// 2 stamp a feed update client-side with the owner key and upload it to a node that holds NO batch;
// 3 topUp by a non-owner; 4 increaseDepth (dilute) by a non-owner must revert.
// Throwaway keys live outside the repo. Testnet only.
import { ethers } from 'ethers'
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { Bee } from '@ethersphere/bee-js'
import { PrivateKey, Topic, Stamper, makeContentAddressedChunk } from '@ethersphere/core-sdk'

const RPC = process.env.RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const POSTAGE = '0xcdfdC3752caaA826fE62531E0000C40546eC56A6' // TestnetPostageStampAddress, go-storage-incentives-abi
const SBZZ = '0x543dDb01Ba47acB11de34891cD86B675F04840db'
const UPLOAD_NODE = process.env.UPLOAD_NODE ?? 'http://127.0.0.1:1653' // ultra-light, owns no batch
const READ_NODE = process.env.READ_NODE ?? 'http://127.0.0.1:1643'
const DEPTH = 17, BUCKET_DEPTH = 16
const AMOUNT = BigInt(process.env.AMOUNT ?? '345852000') // per chunk; ~1 day at price 48035 and 12 s blocks

const p = new ethers.JsonRpcProvider(RPC)
const keyFile = (name) => `${process.env.HOME}/.dappdata-sepolia-${name}.key`
const payer = new ethers.Wallet(readFileSync(keyFile('swap'), 'utf8').trim(), p)
if (!existsSync(keyFile('owner'))) { writeFileSync(keyFile('owner'), ethers.Wallet.createRandom().privateKey + '\n'); chmodSync(keyFile('owner'), 0o600) }
const ownerKey = new PrivateKey(readFileSync(keyFile('owner'), 'utf8').trim())
const owner = ownerKey.publicKey().address().toHex()
console.log('payer', payer.address, 'owner (stands in for the derived storage key)', '0x' + owner)

const postage = new ethers.Contract(POSTAGE, [
  'function createBatch(address _owner, uint256 _initialBalancePerChunk, uint8 _depth, uint8 _bucketDepth, bytes32 _nonce, bool _immutable) returns (bytes32)',
  'function topUp(bytes32 _batchId, uint256 _topupAmountPerChunk)',
  'function increaseDepth(bytes32 _batchId, uint8 _newDepth)',
  'function batches(bytes32) view returns (address owner, uint8 depth, uint8 bucketDepth, bool immutableFlag, uint256 normalisedBalance, uint256 lastUpdatedBlockNumber)',
  'function remainingBalance(bytes32) view returns (uint256)',
  'function minimumInitialBalancePerChunk() view returns (uint256)',
  'function lastPrice() view returns (uint64)',
  'event BatchCreated(bytes32 indexed batchId, uint256 totalAmount, uint256 normalisedBalance, address owner, address payer, uint8 depth, uint8 bucketDepth, bool immutableFlag)',
], payer)
const bzz = new ethers.Contract(SBZZ, ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)'], payer)

const total = AMOUNT * (1n << BigInt(DEPTH))
console.log('price', (await postage.lastPrice()).toString(), 'minimumInitialBalancePerChunk', (await postage.minimumInitialBalancePerChunk()).toString(), 'paying', ethers.formatUnits(total, 16), 'sBZZ for depth', DEPTH)
const t = {}
// --- step 1: approve + createBatch, owner != payer
if ((await bzz.allowance(payer.address, POSTAGE)) < total) { const a = await bzz.approve(POSTAGE, total * 4n); await a.wait(); console.log('approve', a.hash) }
const nonce = ethers.hexlify(ethers.randomBytes(32))
const t0 = Date.now()
const tx = await postage.createBatch('0x' + owner, AMOUNT, DEPTH, BUCKET_DEPTH, nonce, true)
const rc = await tx.wait(); t.createConfirmedMs = Date.now() - t0
const ev = rc.logs.map(l => { try { return postage.interface.parseLog(l) } catch { return null } }).find(e => e?.name === 'BatchCreated')
const batchId = ev ? ev.args.batchId : rc.logs.find(l => l.address.toLowerCase() === POSTAGE.toLowerCase()).topics[1]
console.log('createBatch', tx.hash, 'block', rc.blockNumber, 'batchId', batchId, 'confirmed after', t.createConfirmedMs, 'ms')
const b = await postage.batches(batchId)
console.log('on-chain owner', b.owner, 'is the user key:', b.owner.toLowerCase() === '0x' + owner, '| depth', b.depth.toString(), 'immutable', b.immutableFlag)

// --- step 6: time until the upload node knows the batch
const up = new Bee(UPLOAD_NODE), rd = new Bee(READ_NODE)
const id = batchId.slice(2)
const t1 = Date.now()
for (;;) { try { const g = await up.stamp.getGlobal(id); if (g) break } catch { } if (Date.now() - t1 > 900_000) { console.log('upload node never saw the batch in 15 min'); process.exit(1) } await new Promise(r => setTimeout(r, 5000)) }
t.seenByNodeMs = Date.now() - t1
console.log('upload node sees the batch after', t.seenByNodeMs, 'ms from confirmation; its own stamps:', (await up.stamp.getAll()).length)

// --- step 2: client-side stamped feed update to the node with no batch
const stamper = Stamper.fromBlank(ownerKey, id, DEPTH)
const topic = Topic.fromString('dappdata/s3/modeb')
const payload = new TextEncoder().encode(JSON.stringify({ hello: 'dappdata', at: new Date().toISOString() }))
const cac = makeContentAddressedChunk(payload)
const index = new Uint8Array(8) // feed index 0, big-endian
const identifier = ethers.getBytes(ethers.keccak256(ethers.concat([topic.toUint8Array(), index])))
const soc = cac.toSingleOwnerChunk(identifier, ownerKey)
// One envelope per chunk address: each stamp() call takes a bucket slot (2^(depth-bucketDepth) per bucket), so do not re-stamp on retry.
const envelope = stamper.stamp(soc.address.toUint8Array())
// Use the SOC route (POST /soc/{owner}/{id}?sig=), not /chunks: Bee's /chunks parses SOC bytes as a plain CAC and
// validates the stamp against the wrong address ("stamp signature is invalid"). Found in S3; see RESULTS.md.
let uploaded = false
for (let i = 0; i < 60 && !uploaded; i++) {
  try { const r = await up.soc.makeWriter(ownerKey).upload(envelope, identifier, cac.data); console.log('pre-stamped SOC accepted by the batch-less node via /soc, reference', r.reference.toHex(), 'equals SOC address:', r.reference.toHex() === soc.address.toHex()); uploaded = true }
  catch (e) { const m = String(e.message).slice(0, 120); if (i % 6 === 0) console.log('upload not yet accepted:', m); await new Promise(r => setTimeout(r, 5000)) }
}
t.usableMs = Date.now() - t1
console.log('batch usable for client-side stamped upload after', t.usableMs, 'ms from confirmation')
// read it back as a feed update from the OTHER node
const t2 = Date.now()
for (let i = 0; i < 24; i++) {
  try { const u = await rd.feed.makeReader(topic, owner).downloadPayload(); console.log('feed read from the other node:', u.payload.toUtf8(), 'index', u.feedIndex.toBigInt(), 'after', Date.now() - t2, 'ms'); break }
  catch (e) { if (i === 23) console.log('feed read failed:', String(e.message).slice(0, 120)); await new Promise(r => setTimeout(r, 5000)) }
}

// --- step 3: topUp by a non-owner (the payer is not the owner)
const before = await postage.remainingBalance(batchId)
const tu = await postage.topUp(batchId, AMOUNT); await tu.wait()
const after = await postage.remainingBalance(batchId)
console.log('topUp by non-owner', tu.hash, 'remainingBalance per chunk', before.toString(), '->', after.toString())

// --- step 4: increaseDepth (dilute) by a non-owner must revert
try { await postage.increaseDepth.staticCall(batchId, DEPTH + 1); console.log('UNEXPECTED: non-owner increaseDepth did not revert') }
catch (e) { console.log('increaseDepth by non-owner reverted as expected:', (e.reason ?? e.shortMessage ?? String(e.message)).slice(0, 100)) }
// and on an immutable batch even the owner cannot dilute: check with staticCall from the owner
try { const asOwner = postage.connect(new ethers.Wallet(readFileSync(keyFile('owner'), 'utf8').trim(), p)); await asOwner.increaseDepth.staticCall(batchId, DEPTH + 1); console.log('UNEXPECTED: owner could dilute an immutable batch') }
catch (e) { console.log('increaseDepth by owner on immutable batch reverted as expected:', (e.reason ?? e.shortMessage ?? String(e.message)).slice(0, 100)) }
console.log(JSON.stringify({ batchId, owner: '0x' + owner, payer: payer.address, createTx: tx.hash, topUpTx: tu.hash, timings: t }, null, 2))
