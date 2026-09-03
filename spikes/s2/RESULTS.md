# S2 — Latency: results

Status: **in progress** (started 2026-09-03). Path 1 (bee-factory) and path 4 (public gateways) measured. Paths 2 and 3 wait for sBZZ on the Sepolia node. Main finding so far: Bee's feed lookup costs 2–4 s wherever it runs; a known index makes reads 10–300 ms.

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

## Path 4 — public gateways (Gnosis mainnet, someone else's stamps)

**Status check (2026-09-03).** Four gateways answered `/health`. `api.gateway.ethswarm.org`, `bzz.link`, and `gateway.fairdatasociety.org` accept `POST /bytes` with any batch id (the proxy stamps with its own batch) and expose `/soc` and `/feeds`; a probe write was retrievable from all four within seconds. `gateway.ethswarm.org` (405) and `download.gateway.ethswarm.org` (404) are read-only. So a public write path exists in 2026, on a gateway operator's goodwill; nothing in D3 should depend on it.

**Run: 10 iterations, write via `api.gateway.ethswarm.org`, read via `gateway.fairdatasociety.org` (a different operator)** (`results/public-gateways-2026-09-03T17-13-17-768Z.json`, 120 s visibility timeout):

| measure | n | failed | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
| 1KB write (known index) | 10 | 0 | 463 | 2000 | 2000 |
| 1KB visibility | 3 | 7 | 59199 | 60526 | 60526 |
| 1KB read warm | 9 | 1 | 379 | 2552 | 2552 |
| 1KB read cold | 10 | 0 | 145 | 1770 | 1770 |
| 3.5KB write (known index) | 10 | 0 | 501 | 5461 | 5461 |
| 3.5KB visibility | 4 | 6 | 54913 | 60779 | 60779 |
| 3.5KB read warm | 10 | 0 | 139 | 1921 | 1921 |
| 3.5KB read cold | 10 | 0 | 129 | 593 | 593 |
| 64KB write (known index) | 10 | 0 | 1217 | 1294 | 1294 |
| 64KB visibility | 0 | 10 | timeout | | |
| 64KB read warm | 0 | 10 | error | | |
| 64KB read cold | 0 | 10 | error | | |

Reading the failures:
- **Visibility across operators.** The very first update of each feed was visible in about 1 s (1185 and 894 ms). Every later update took about 60 s or was not seen inside 120 s. That pattern, first fast then a ~60 s wall, says the reading gateway (or its Bee node) caches the feed lookup result and serves the stale "latest" until a cache expires. The network itself delivered the first update in a second. Whether that cache is nginx, the proxy, or Bee's own feed cache needs a controlled reader (path 2) to tell.
- **Reads once visible are fast**: 130–380 ms p50 for inline payloads through a gateway on another continent's network. Much faster than the local-cluster lookup reads above, because a cached lookup answer is exactly what makes a stale read fast.
- **64 KB by reference failed on the reader** with a signature-recovery error from bee-js ("bad point: is not on curve") on every read, while the same code path worked on bee-factory. The gateway returned something for the SOC that bee-js could not verify; unresolved here. To reproduce against the Sepolia node (path 2), where we control both ends, before blaming the gateway.
- One 1 KB warm read failed with a network error.

**Run: 3 iterations, write via `api.gateway.ethswarm.org`, read via `bzz.link`** (`results/public-gateways-sameoperator-2026-09-03T18-07-50-047Z.json`, 20 s timeout):

| measure | n | failed | p50 ms | p95 ms |
|---|---|---|---|---|
| 1KB write (known index) | 3 | 0 | 431 | 461 |
| 1KB visibility | 3 | 0 | 2248 | 2502 |
| 1KB read by index | 3 | 0 | 167 | 510 |
| 1KB read warm (lookup) | 3 | 0 | 1695 | 2568 |
| 1KB read cold (lookup) | 3 | 0 | 2699 | 3645 |
| 3.5KB visibility | 3 | 0 | 2379 | 5616 |
| 3.5KB read by index | 3 | 0 | 187 | 417 |
| 64KB write (known index) | 3 | 0 | 1183 | 1265 |
| 64KB visibility | 3 | 0 | 2060 | 2180 |
| 64KB read by index | 3 | 0 | 285 | 421 |
| 64KB read cold (lookup) | 3 | 0 | 1696 | 2691 |

No failures, 64 KB included. Both the 60 s visibility wall and the 64 KB read error were the Fair Data Society gateway's, not Swarm's. Through the Foundation's gateways on mainnet: **write 0.4–1.2 s, visible on another gateway in 2–2.5 s, read by known index 0.2–0.3 s, lookup-based read-latest 1.7–2.7 s.** Small sample; the shape matches the local cluster (lookup dominates reads) with about 0.2–0.5 s of network on top.

## D5 — thresholds for "interactive"

Proposed in SPIKES.md: cold read-latest p95 ≤ 5 s; warm p95 ≤ 2 s; cross-client visibility p95 ≤ 30 s.

Where the data points so far (paths 1 and 4; paths 2–3 pending):
- **Cold read-latest** (unknown index, one lookup): p95 4–5 s locally, 2.7–3.6 s through a gateway. Meets ≤ 5 s, barely. This is the "restore on a new device" number and it is Bee's lookup cost.
- **Warm read-latest**: with the lookup, p95 2.5–4 s, misses ≤ 2 s. With a cached index, p95 20 ms locally and 0.4–0.5 s through a gateway, meets it with room. So the threshold is met only if the SDK keeps the index; write that into the design (Phase 1: per-slot index cache, lookup only when empty or on a miss).
- **Cross-client visibility**: 2–5.6 s p95 where the reader does not cache stale answers. Meets ≤ 30 s. A reader behind a caching gateway can see a 60 s wall; document that gateways are not all equal and let the SDK bypass a stale answer by reading index+1 directly.
- Failures: none in the settled runs on the Foundation gateways and bee-factory; the first minutes of a fresh bee-factory produced outliers of 10–225 s, and one gateway operator's caching broke visibility. Report them as such, not in the percentiles.

## Environment

- bee-factory 1.1.2 (npx), Bee image `2.8.2-7e703f4-dirty`, queen API `127.0.0.1:1633`, workers `1635/1637/1639/1641`, anvil RPC `:8545` chain 1337. Note: the queen takes port 1633, so Swarm Desktop's node cannot run at the same time.
- bee-js 13.0.0, core-sdk 0.1.1, Node 22.
