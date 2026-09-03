# S2 — Latency: results

Status: **in progress** (started 2026-09-03). Path 1 (bee-factory) running; paths 2–4 wait for sBZZ on the Sepolia node (path 2, 3) and a check of public gateways (path 4).

## What is here

- `src/latency.ts` — the measurement script (`pnpm latency`). Env: `WRITER`, `READER` (two different Bee nodes), `BATCH` (buys one if unset), `RUNS` (30), `LABEL`, `TIMEOUT_MS`. Throwaway random feed signer stands in for the D1 key.
- `results/` — one JSON per run: environment, summary rows, every sample.

## Method

Per payload size (1 KB and 3.5 KB inline in the feed chunk; 64 KB as data upload plus a feed reference), `RUNS` iterations of:

1. **write**: `uploadPayload` / `data.upload` + `uploadReference` on the writer node, call to return.
2. **visibility**: poll `downloadReference` on the reader node every 250 ms until the new index appears (plus `data.download` for 64 KB), write end to first sight.
3. **read warm**: second read-latest on the same client.
4. **read cold**: read-latest with a fresh `Bee` client against the reader node. This is "restore on a new device" minus whatever the node itself caches; a truly cold read needs a node that has never seen the chunk, which only paths 2–4 give.

p50 and p95 over successful samples; failures and timeouts counted separately.

## Path 1 — bee-factory (local, Bee 2.8.2 queen + 4 workers, anvil chain)

Writer: queen (`:1633`). Reader: worker 2 (`:1637`). Poll interval 250 ms.

**Smoke run, 5 iterations, writes with bee-js index lookup** (`results/bee-factory-smoke-2026-09-03T17-05-19-783Z.json`). Write p50 about 1.0–1.2 s, p95 2.1–2.7 s for all three sizes. But each iteration took about 35 s end to end: bee-js's lookup of the current index before an upload probes indexes that do not exist yet, and Bee's retrieval of a missing chunk waits for its full timeout on a 5-node network. The SDK will know the index after its first read, so the main run passes the index and skips the lookup. Inline reads in this run failed on a harness bug (reading a payload update as a reference); the 64 KB rows stood: visibility p50 2.0 s, warm and cold read p50 2.0 s, p95 3.0 s.

**Main run, 30 iterations, known-index writes** (`results/bee-factory-2026-09-03T17-13-14-708Z.json`):

| measure | n | failed | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
| 1KB write (known index) | 30 | 0 | 56 | 1082 | 2032 |
| 1KB visibility | 29 | 1 | 3008 | 5009 | 21513 |
| 1KB read warm | 29 | 1 | 3007 | 13179 | 93147 |
| 1KB read cold | 30 | 0 | 3008 | 5173 | 224648 |
| 3.5KB write (known index) | 30 | 0 | 17 | 31 | 83 |
| 3.5KB visibility | 30 | 0 | 3009 | 4011 | 5011 |
| 3.5KB read warm | 30 | 0 | 3006 | 4008 | 5007 |
| 3.5KB read cold | 30 | 0 | 3006 | 4010 | 5008 |
| 64KB write (known index) | 30 | 0 | 61 | 84 | 102 |
| 64KB visibility | 30 | 0 | 3031 | 5293 | 5296 |
| 64KB read warm | 30 | 0 | 3020 | 4025 | 5019 |
| 64KB read cold | 30 | 0 | 3018 | 4025 | 5020 |

Failures: one 1 KB visibility timeout (30 s) and one 1 KB warm read where the node closed the connection; the 1 KB block also had outliers of 9, 13, 21, 93 and 225 s while the cluster was still settling in its first minutes after start. The 3.5 KB and 64 KB blocks, run later, had none.

**What the numbers say.**
- **Writes are cheap once the index is known**: 17–61 ms p50 on localhost. The 1 s p95 on 1 KB is the settling period, not the size.
- **Every read-latest costs 3 s or more, and the values cluster at whole seconds (3.0, 4.0, 5.0 s).** That is not network: it is Bee's `/feeds` lookup, which probes indexes that do not exist yet and waits out a retrieval timeout per miss. It is the same cost whether the client is warm or cold, and it also sets the floor for visibility (the poll cannot see a new update faster than one lookup).
- So the "visibility" numbers here are lookup-bound, and cross-node propagation itself is below the 250 ms poll interval on a local cluster.
- **Consequence for the SDK (feeds into D5 and Phase 1 design):** cache the last known index per slot and read the SOC directly by index (a plain chunk fetch, milliseconds); use the lookup only when the index is unknown (first read on a new device) or as a fallback when the cached index misses. A second run measured "read by index" to confirm the gap.

**Read by index vs read-latest, 15 iterations** (`results/bee-factory-byindex-2026-09-03T17-33-11-770Z.json`):

| measure | n | failed | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
| 1KB read by index | 15 | 0 | 12 | 19 | 19 |
| 1KB read warm (lookup) | 15 | 0 | 2007 | 4008 | 4008 |
| 1KB read cold (lookup) | 15 | 0 | 2006 | 4006 | 4006 |
| 3.5KB read by index | 15 | 0 | 11 | 17 | 17 |
| 3.5KB read warm (lookup) | 15 | 0 | 2007 | 4007 | 4007 |
| 64KB read by index | 15 | 0 | 19 | 24 | 24 |
| 64KB read warm (lookup) | 15 | 0 | 2033 | 4029 | 4029 |
| 64KB visibility (lookup-bound) | 15 | 0 | 2032 | 4038 | 4038 |

Same cluster, a few minutes later: writes 15–69 ms, lookup reads now 2–4 s (the cluster had settled), direct reads by index 11–24 ms. **A known index turns a 2–4 s read into a 10–20 ms read.** The remaining cost of a lookup is Bee's, not ours; the SDK avoids it wherever it has an index.

## Path 2 — own light node on Sepolia, HTTP API direct

_pending: node has sETH, needs sBZZ for a batch_

## Path 3 — gateway-proxy in front of the Sepolia node

_pending_

## Path 4 — public gateway

_pending: check which gateways accept writes in 2026_

## D5 — thresholds for "interactive"

Proposed in SPIKES.md: cold read-latest p95 ≤ 5 s; warm p95 ≤ 2 s; cross-client visibility p95 ≤ 30 s. _Decide after paths 2–3._

## Environment

- bee-factory 1.1.2 (npx), Bee image `2.8.2-7e703f4-dirty`, queen API `127.0.0.1:1633`, workers `1635/1637/1639/1641`, anvil RPC `:8545` chain 1337. Note: the queen takes port 1633, so Swarm Desktop's node cannot run at the same time.
- bee-js 13.0.0, core-sdk 0.1.1, Node 22.
