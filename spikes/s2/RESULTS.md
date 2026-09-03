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

_pending_

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
