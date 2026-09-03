// S2 latency spike. THROWAWAY. Measures feed write, cross-node visibility, warm and cold read-latest.
// Protocol: docs/SPIKES.md, S2. Bee API through bee-js 13 (namespaced, D10).
//
//   WRITER=http://127.0.0.1:1634 READER=http://127.0.0.1:1636 BATCH=<id> RUNS=30 LABEL=bee-factory pnpm latency
//
// WRITER  node the dapp writes through. READER  a different node, for visibility and cold reads.
// BATCH   postage batch id on WRITER; if unset, buys one there (only sane on bee-factory / testnet).
import { Bee } from '@ethersphere/bee-js'
import { PrivateKey, Topic } from '@ethersphere/core-sdk'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const WRITER = process.env.WRITER ?? 'http://127.0.0.1:1634'
const READER = process.env.READER ?? 'http://127.0.0.1:1636'
const RUNS = Number(process.env.RUNS ?? 30)
const LABEL = process.env.LABEL ?? 'unlabelled'
const SIZES = { '1KB': 1024, '3.5KB': 3584, '64KB': 65536 } as const
const POLL_MS = 250
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 60_000)
// WRITE_LOOKUP=1 lets bee-js look up the latest index before each write (slow on Bee: the lookup probes
// indexes that do not exist yet). Default: pass the index, as the SDK will once it has read the feed.
const WRITE_LOOKUP = process.env.WRITE_LOOKUP === '1'

// Throwaway signer; stands in for the D1-derived feed key.
const signer = new PrivateKey(randomBytes(32))
const owner = signer.publicKey().address()
const writer = new Bee(WRITER)
const reader = new Bee(READER)

type Sample = { ok: true; ms: number } | { ok: false; error: string }
type Series = Record<string, Sample[]>

const now = () => performance.now()
const pct = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] }
async function timed(f: () => Promise<unknown>): Promise<Sample> {
  const t = now()
  try { await f(); return { ok: true, ms: Math.round(now() - t) } } catch (e) { return { ok: false, error: String((e as Error).message).slice(0, 200) } }
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, j) => setTimeout(() => j(new Error(`timeout after ${ms} ms`)), ms))])
}

// Gateways answer /health with plain "OK"; Bee answers with JSON.
const version = (b: Bee) => b.status.getHealth().then(h => h.version).catch(() => 'unknown (gateway)')

async function batchId(): Promise<string> {
  if (process.env.BATCH) return process.env.BATCH
  const usable = (await writer.stamp.getAll()).filter(b => b.usable)
  if (usable.length) return usable[0].batchID.toHex()
  console.log('buying a postage batch on the writer node (depth 20, amount 1e9)...')
  const id = await writer.stamp.create('1000000000', 20, { waitForUsable: true })
  return id.toHex()
}

async function main() {
  const batch = await batchId()
  const env = { label: LABEL, writer: WRITER, reader: READER, batch, runs: RUNS, writeMode: WRITE_LOOKUP ? 'lookup' : 'known index', writerVersion: await version(writer), readerVersion: await version(reader), date: new Date().toISOString() }
  console.log(env)
  const series: Series = {}
  const add = (k: string, s: Sample) => (series[k] ??= []).push(s)

  for (const [sizeName, size] of Object.entries(SIZES)) {
    const topic = Topic.fromString(`dappdata/s2/${sizeName}/${Date.now()}`)
    const w = writer.feed.makeWriter(topic, signer)
    const r = reader.feed.makeReader(topic, owner)
    const viaReference = size > 4000
    for (let i = 0; i < RUNS; i++) {
      const payload = randomBytes(size)
      payload.set([i], 0) // make each update distinct
      let written = -1n
      // write: set() call to return
      add(`${sizeName} write (${WRITE_LOOKUP ? 'lookup' : 'known index'})`, await timed(async () => {
        const opts = WRITE_LOOKUP ? {} : { index: i }
        if (viaReference) await w.uploadReference(batch, (await writer.data.upload(batch, payload)).reference, opts)
        else await w.uploadPayload(batch, payload, opts)
        written = BigInt(i) // fresh topic per size, so update i has index i
      }))
      // visibility: poll read-latest on the other node until the new index shows up
      add(`${sizeName} visibility`, await timed(() => withTimeout((async () => {
        for (;;) {
          try {
            const u = await r.downloadReference()
            if (u.feedIndex.toBigInt() >= written) { if (viaReference) await reader.data.download(u.reference); return }
          } catch { /* not yet */ }
          await new Promise(res => setTimeout(res, POLL_MS))
        }
      })(), TIMEOUT_MS)))
      // warm read-latest: same client, second read
      add(`${sizeName} read warm`, await timed(async () => { const u = await r.downloadReference(); if (viaReference) await reader.data.download(u.reference) }))
      // cold read-latest: fresh client against the reader node ("restore on a new device", minus node-level caches)
      add(`${sizeName} read cold`, await timed(async () => { const fresh = new Bee(READER).feed.makeReader(topic, owner); const u = await fresh.downloadReference(); if (viaReference) await new Bee(READER).data.download(u.reference) }))
      process.stdout.write(`${sizeName} ${i + 1}/${RUNS}\r`)
    }
    console.log()
  }

  const rows = Object.entries(series).map(([k, v]) => { const ok = v.filter(s => s.ok).map(s => (s as { ms: number }).ms); return { measure: k, n: ok.length, failed: v.length - ok.length, p50: pct(ok, 50), p95: pct(ok, 95), max: Math.max(...ok) } })
  console.table(rows)
  await mkdir('results', { recursive: true })
  const file = `results/${LABEL}-${env.date.replace(/[:.]/g, '-')}.json`
  await writeFile(file, JSON.stringify({ env, rows, series }, null, 2))
  console.log('| measure | n | failed | p50 ms | p95 ms | max ms |\n|---|---|---|---|---|---|\n' + rows.map(r => `| ${r.measure} | ${r.n} | ${r.failed} | ${r.p50} | ${r.p95} | ${r.max} |`).join('\n'))
  console.log('saved', file)
}
main().catch(e => { console.error(e); process.exit(1) })
