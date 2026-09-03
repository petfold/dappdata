# Phase 0 spikes

Three experiments. Each is throwaway code under `spikes/<id>/` with a `RESULTS.md` next to it. The result, not the code, is the deliverable. When a spike closes a decision, update `DECISIONS.md` in the same commit.

Before any spike: read the bee-js 13.0 changelog, note feed and single-owner-chunk API changes, and pin the version (D10).

---

## S1 — Key derivation

**Question.** Can we derive a stable Swarm storage key from a wallet signature, safely, for the wallets that matter?

**Why it comes first.** The SIWE address cannot own the feed: feed updates are raw secp256k1 signatures over a chunk identifier, and browser wallets no longer expose raw signing (MetaMask removed `eth_sign` in 2024). So the storage key must be derived, and everything downstream depends on how.

**Note.** The SIWE message itself cannot be the seed. It carries a nonce and an issued-at timestamp, so its signature changes every login. Derivation needs a second, fixed message.

### Protocol

1. **Design the message.** EIP-712 typed data, signed with `eth_signTypedData_v4`:
   - Domain: `{ name: "dappdata", version: "1", chainId }`. No `verifyingContract`.
   - Message: `{ purpose: "Derive dappdata storage key", account: <address>, origin: <dapp origin>, scope: "v1" }`.
   - The wallet must display `origin` and `purpose` in clear text. Screenshot each wallet's prompt for `RESULTS.md`.
   - Also implement a `personal_sign` fallback with the same fields serialised as text, for wallets without typed-data support. Record which wallets needed it.
2. **Derive.** `seed = keccak256(signature)`. `feedKey = HKDF-SHA256(seed, info="dappdata/feed/v1")`, reduced mod the secp256k1 order, re-hashed if zero. `encKey = HKDF-SHA256(seed, info="dappdata/enc/v1")`. Keep the two keys independent so a future change to one does not orphan the other.
3. **Determinism test.** For each wallet, sign the same message 20 times across page reloads and, where possible, across wallet restarts. Pass = byte-identical signatures every time.
4. **Cross-wallet portability.** Import one throwaway seed phrase into two wallets (for example MetaMask and Rabby). Sign the same message in both. If signatures match, the state follows the seed phrase, not the wallet software; record either way.
5. **Smart accounts and passkeys.** Try a Safe (ERC-1271) and one passkey-based wallet. Expect failure: contract signatures are validation results, not deterministic secp256k1 signatures. Document what the SDK should do when it detects one: refuse with a clear message; offer a dapp-held escrow key; offer a session key. Recommend one for D2.

### Wallets to test

MetaMask (extension), Rabby, Coinbase Wallet, one WalletConnect-routed mobile wallet, Ledger through MetaMask. Add others if cheap.

### Output

- `spikes/s1/RESULTS.md`: compatibility matrix (wallet, typed-data support, deterministic yes/no, prompt screenshot), portability result, smart-account recommendation.
- Derivation spec section in `ARCHITECTURE.md` filled in.
- D1, D2, D8 closed. For D8, read snaha/swarm-id first: it derives app-specific secrets from a browser master identity with cross-app isolation. Decide: build on it, interoperate with it, or stay independent and SIWE-native. Write the reason.

**Pass.** MetaMask plus at least two other EOA wallets deterministic; message displays origin clearly in each.

---

## S2 — Latency

**Question.** Do feed writes and reads arrive fast enough for a dapp a person is using right now?

### Setup

Four paths, because a real dapp will use one of them:

1. bee-factory, local. The floor; tells us what the SDK adds.
2. Own light node on Sepolia, HTTP API direct.
3. gateway-proxy in front of the Sepolia node.
4. A public gateway, if one accepts writes. Check the current status first; if none does, measure reads only and say so.

Start the Sepolia node a day ahead so it is fully connected before measuring.

### Measurements

For each path, payload sizes 1 KB and 3.5 KB inline, and 64 KB through a reference:

- **Write latency.** `set` call to return.
- **Visibility.** Write on one client, poll read-latest from a second client on a different node until the new value appears. Report the delay.
- **Read-latest, warm.** Same client, second read.
- **Read-latest, cold.** Fresh client, first read: this is the "restore on a new device" number.

Thirty runs each. Report p50 and p95. Note any failed or timed-out runs separately; do not fold them into the percentiles.

### Output

- `spikes/s2/RESULTS.md` with the table and the environment details (Bee version, node type, region).
- D5 closed: thresholds for "interactive". Proposed starting values, to confirm or revise with data: cold read-latest p95 ≤ 5 s; warm read-latest p95 ≤ 2 s; cross-client visibility p95 ≤ 30 s. If the numbers miss, the plan does not stop; it gains a caching layer in Phase 1 and a documented visibility window.

---

## S3 — Funding

**Question.** Can writes be paid for without the dapp running a server, and does the prior art still work?

### Mode A — Stamping proxy

1. Run gateway-proxy against bee-factory with a hard-coded stamp, then with stamp auto-buy. Write a feed through it from a browser page.
2. Check gateway-proxy's health: last release, Bee 2.8 compatibility, open issues that would block us. If it is stale, note what it would take to fix or fork, and whether a tiny stamping proxy of our own is cheaper.
3. Check whether Bee's CORS settings allow a browser to write to a node directly; note what a dapp operator must configure.

### Mode B — User-owned batch, anyone pays *(D3(d), D12)*

On Sepolia:

1. A throwaway *payer* wallet calls `createBatch` with `_owner` set to a *different* throwaway address that stands in for the user's derived storage key. Small, **immutable**. Confirm the batch is owned by the owner address, not the payer.
2. Stamp a chunk in the browser (or Node) with the owner key using bee-js's client-side stamping, and upload the pre-stamped chunk to a Bee node that holds **no** batch of its own. Confirm the node accepts it. Record the bee-js and Bee API used.
3. A second, sponsor wallet calls `topUp(batchId, amount)`. Confirm the TTL extends and the transaction needs no owner permission.
4. The sponsor calls `dilute`. Confirm it reverts for a non-owner.
5. Write a feed with the batch. Then repeat step 1 with a **mutable** batch and fill it past capacity; record how the feed breaks. This becomes the wording of D4 and of the SDK's refusal to use mutable batches.
6. Time the gap between `createBatch` confirming and the batch being usable for uploads. This number sizes the "start funding at sign-in" flow in D3.
7. Survey multichain funding paths for BZZ + xDAI that a browser dapp could hand a user to; list them with status. Do not integrate one yet.

If step 2 fails, fall back to the original mode B (a Bee node owns the batch) and say so in RESULTS.md; D12 then closes negative and mode A stays in scope.

### Browser write path *(D13)*

1. Check weeb-3 for write support: shipped, in progress, or planned, with links. At handoff it is retrieval-only, which means every write needs an HTTP Bee endpoint.
2. Check other in-browser or attached nodes in the pipeline (Freedom Browser's ant node, any others) for the same.
3. From a browser page on one origin, upload a pre-stamped chunk to a Bee node on another origin. Record the CORS flags the node needs.
4. Record the minimum a dapp operator must run today for writes to work, and what shrinks if an in-browser write path lands.

### Output

- `spikes/s3/RESULTS.md`: both modes demonstrated with transaction hashes; dependency status table (gateway-proxy, weeb-3, bee-js 13, fdp-storage for prior-art reference).
- D3 closed: default funding mode for the demo and the docs. D4 closed: batch type requirement. D12 closed: batch owner key and client-side stamping. D13: write-path status recorded for the gate.

---

## Gate

When all three `RESULTS.md` exist and D1–D5, D8, D10, D12, D13 are closed:

1. Write the go / no-go and one paragraph of reasoning at the top of `PLAN.md`.
2. Post the same paragraph and links to the three results as a comment on IDEA-190.
3. Start Phase 1.
