# S3 — Funding: results

Status: **done except mode A autobuy** (2026-09-04). Mode B demonstrated on Sepolia: user-owned batch paid by another key, client-side stamps accepted by a batch-less node from Node and from a browser page, topUp permissionless, dilute owner-only. Slot reuse silently replaces the earlier chunk on immutable and mutable batches alike. Funding survey, weeb-3 status, gateway-proxy state, dependency table recorded.

## What is here

- `src/pool.mjs` — finds the sBZZ/WETH Uniswap pool on Sepolia and prints balances.
- `src/quote.mjs` — quotes sETH → sBZZ on the V3 pool (0.3 % fee tier).
- `src/keygen.mjs` — makes a throwaway Sepolia key in `~/.dappdata-sepolia-swap.key` (outside the repo, CLAUDE.md rule 5). Prints only the address.
- `src/sbzz.mjs` — swaps sETH for sBZZ through Uniswap V3 `SwapRouter02` and delivers the sBZZ to a recipient (the Bee node) in one transaction. Env: `ETH`, `TO`, `RPC`, `SWAP_KEY_FILE`.

## Getting sBZZ on Sepolia (2026-09-03)

There is no sBZZ faucet. The Swarm docs point at a Uniswap swap in testnet mode. What worked without a browser wallet:

1. Sepolia sBZZ token `0x543dDb01Ba47acB11de34891cD86B675F04840db` (16 decimals). Uniswap V3 pool at fee 3000: `0x88A3f8097f091f457a3bf22e9BECAbCbE873eC1b`, liquidity present; the fee-10000 pool is empty; no V2 pair.
2. Price on the day: 0.01 sETH ≈ 0.051 sBZZ.
3. The node's own sETH was moved to a throwaway swap key with Bee's `POST /wallet/withdraw/NativeToken?address=&amount=` after whitelisting the address in `config.yaml` (`withdrawal-addresses-whitelist`) and restarting. Tx `0xf7fa39e2c5cd4637f633a3adc5d86df0fab532bbe0096e8aad90d38323610a9d`, 0.03 sETH.
4. Swap 0.025 sETH → 0.1276 sBZZ, recipient the node wallet `0x13cB9947C508cf52a233a1E97d80Dd2485589481`. Tx `0x30286c3799cae955adc87d5bdd2cd7fd62f1a830ae86959f45b9c279578a3f2f`, 129 319 gas.

Gotchas: Tenderly's public Sepolia RPC rate-limits this machine hard once the Bee node is using it too (429 on the node's withdraw and on the swap script). `ethereum-sepolia-rpc.publicnode.com` worked for both, but the node's log listener reportedly 429s on `eth_getLogs` there, so the node is back on Tenderly and scripts default to publicnode.

## Postage on Sepolia at today's price

`/chainstate` currentPrice 48035 PLUR per chunk per block, 12 s blocks:

| Batch | Cost |
|---|---|
| depth 17, 7 days | 0.032 sBZZ |
| depth 20, 7 days | 0.254 sBZZ |
| depth 20, 30 days | 1.09 sBZZ |

## gateway-proxy, state of the art (2026-09-03)

`@ethersphere/gateway-proxy` **0.16.0**, published 2026-01-05, is the latest. Its `package.json` still declares `engines.bee = 1.7.0-bbf13011` and depends on bee-js 7; its README calls it beta. Installed as a dev dependency of this spike (`node_modules/.bin/bee-gateway-proxy`); `npx` also works but shows no output while it installs.

Run for S2 path 3 with `BEE_API_URL=http://127.0.0.1:1643 PORT=3100 POSTAGE_STAMP=<batch>`. Against Bee 2.8.2:
- `/health` and `/readiness` answer `OK`. `POST /bytes` with no stamp header is stamped by the proxy and stored. `/feeds/:owner/:topic` and `/soc/:owner/:id` are proxied (400 on bogus input, as Bee itself answers). So the mode-A path the SDK needs works today with no changes.
- It binds `localhost`, which resolves to IPv6 first on this machine: reach it as `http://localhost:3100`, not `127.0.0.1`.
- Stamp modes on offer: fixed `POSTAGE_STAMP`; autobuy with `POSTAGE_DEPTH` + `POSTAGE_AMOUNT`; TTL extension with `POSTAGE_EXTENDSTTL=true` + `POSTAGE_TTL_MIN`. Access control: `AUTH_SECRET`, `ALLOWLIST`, `ALLOW_USER_AGENTS`. No per-user quota, no SIWE; anyone who can reach the proxy can spend its batch. Mode A in `ARCHITECTURE.md` needs a thin auth layer in front (the SIWE session token) or a fork, to be decided in Phase 2, D3.

## Mode B — user owns the batch, anyone pays, stamps signed client-side (2026-09-03)

Script: `src/modeb.mjs` (log of the first run: `results/modeb-2026-09-03-run1.log`). Sepolia postage contract `0xcdfdC3752caaA826fE62531E0000C40546eC56A6` (from go-storage-incentives-abi). Payer = the throwaway swap key `0x6f49…f3Bc` holding 0.03 sBZZ withdrawn from the node (tx `0xe11251d2…7045`). Owner = a second throwaway key `0x340eAa8ae36e82Bae2764cCb39A0c7490435C512`, standing in for the user's derived storage key (D1); it holds no ETH and no BZZ at any point.

| Step | Result | Evidence |
|---|---|---|
| 1. `createBatch(_owner = user key)` by the payer, depth 17, immutable | **works; on-chain owner is the user key, not the payer** | tx `0xa6f00837…b295`, block 11628691, batch `0xc044860d…d16b`, confirmed 10.7 s after send |
| 6. time until a node that owns no batch knows it | **105 s** from confirmation (ultra-light node, publicnode RPC) | `GET /batches/{id}` polling |
| 2. stamp a feed update client-side with the owner key, upload to the batch-less node | **works via `POST /soc/{owner}/{id}`** (bee-js `bee.soc.makeWriter(ownerKey).upload(envelope, identifier, data)`); the other node reads it back as a feed update | reference `381c17ef…e55b` equals the SOC address; read on `:1643` returned the payload at index 0 |
| 3. `topUp` by a non-owner | **works, no owner permission needed** | tx `0xb287c45c…f6e`, remaining balance per chunk 343 781 937 → 689 585 796 |
| 4. `increaseDepth` (dilute) by a non-owner | **reverts** (`NotBatchOwner`) | static call |
| 4b. `increaseDepth` by the owner on an *immutable* batch | **does not revert on chain.** The current `PostageStamp.increaseDepth` checks owner, depth, expiry and balance only; `immutableFlag` is stored and reported, never enforced there. Immutability is Bee behaviour (how a node treats a full bucket), not a contract rule. | static call as owner; `src/PostageStamp.sol` lines 377–396 |
| 5. stamp slot reused (sharpened from "fill a mutable batch") | **the earlier chunk on that slot disappears from the network, on the immutable batch just as on the mutable one**; a control with distinct slots keeps both | see "Step 5" below |
| 7. multichain funding survey | _not run yet_ | |

**Findings.**
- **D12 verifies positive.** bee-js 13 + core-sdk 0.1.1 can stamp client-side (`Stamper.fromBlank(ownerKey, batchId, depth)` → `stamp(address)` → envelope) and a Bee 2.8.2 node with zero batches of its own accepts the pre-stamped chunk and forwards it. The signing scheme in core-sdk matches Bee's (personal-sign over keccak(address ‖ batchId ‖ index ‖ timestamp)).
- **Use the SOC route, not `/chunks`.** `POST /chunks` with a pre-stamped SOC answers `400 stamp signature is invalid` on both nodes: Bee parses the bytes as a plain content-addressed chunk and validates the stamp against that address. `POST /soc/{owner}/{id}?sig=` computes the SOC address and accepts. bee-js's `SOCWriter.upload` takes the envelope at runtime although its type only names `BatchId`; worth an upstream type fix.
- **One envelope per chunk.** Each `Stamper.stamp()` consumes a bucket slot (2 per bucket at depth 17 / bucket depth 16). The first run re-stamped on every retry and ran the bucket dry ("bucket is full"). The SDK stamps once and keeps the envelope until the upload is confirmed; and it must persist the Stamper's bucket state (`getState()`) across sessions, or a fresh device will reuse slots and get chunks rejected.
- **"Immutable" is weaker than the name.** The owner can still `increaseDepth` an immutable batch on chain. For dappdata the owner is the derived key held by the SDK, and the SDK never calls `increaseDepth`, so the practical protection holds: nobody else can dilute, and the node side refuses to over-fill. D4's wording should say that.
- **Cost of the demo flow.** createBatch ≈ 0.0045 sBZZ for depth 17 × 1 day at today's price plus one approve and one createBatch transaction of gas; from confirmation to a usable batch on an arbitrary node: about 2 minutes here. That is the number for D3's "start funding at sign-in" flow.
- The feed read of the client-stamped update returned the raw CAC bytes (8-byte span first). bee-js's feed writer prepends its own header on `uploadPayload`; the SDK defines its own payload framing and reads with `downloadReference`/raw SOC fetch accordingly (Phase 1 detail).

## Mode A — stamping proxy

gateway-proxy 0.16.0 in front of the Sepolia node stamped and forwarded feed writes for S2 path 3 (see `spikes/s2/RESULTS.md`). Autobuy mode and the bee-factory run are not done; given D12 verifies positive, mode A is the fallback, not the default, and its remaining steps are low priority.

## Step 5 — what a reused stamp slot does (2026-09-04)

SPIKES.md asked to fill a mutable batch past capacity and watch the feed break. The cheaper and more relevant version: reuse one stamp **slot** (bucket + index) for a second chunk, which is what happens when a batch is over-filled and also what a client does after losing its `Stamper` bucket state. Scripts `src/overflow.mjs` (A: immutable batch `c044860d…`, B: mutable batch `0x52262daf…2e79`, tx `0x884bb593…107f`) and `src/overflow-control.mjs`. Each test picks two SOCs whose addresses share the top 16 bits (same bucket; 70–90 k tries), stamps them with the raw `stamp()` at an explicit slot, uploads through the ultra-light node's `/soc` route, then asks the other node for both chunks. Logs in `results/overflow-*.log`.

| Case | Uploads | Chunk 1 retrievable afterwards | Chunk 2 |
|---|---|---|---|
| A. immutable batch, slot 0 then slot 0 again | both accepted (201) | **no**, at +15 s and again minutes later, from either node | yes |
| B. mutable batch, slot 0 then slot 0 again | both accepted | **no**, at +15 s and +75 s | yes |
| Control: immutable batch, slot 0 then slot 1, same bucket | both accepted | yes, at +20 s and +80 s | yes |

Reading it:
- **A slot collision replaces the earlier chunk on the network, and the immutable flag did not prevent it** on this Bee 2.8.2 testnet. The uploading node answers 201 either way; nothing tells the client. Whatever "immutable" protects against in Bee's reserve, it is not this, at least as seen from two light nodes pushing into the Swarm testnet. Both our nodes are light (no reserve of their own), so the storers were third-party testnet full nodes.
- **For the SDK this is the single most important operational rule from S3: never lose or reuse stamper state.** Persist the `Stamper` bucket state (`getState()`) with the slot; on a fresh device, restore it from the feed before writing, or start from a slot range the old device cannot have used. A user who signs in on a new device with a blank Stamper would overwrite their own earliest chunks without any error.
- D4 (batch type) still favours immutable, because the contract-level guarantees that do hold (nobody but the owner can `increaseDepth`, and the owner is our derived key) are the same for both, and the node-side semantics on a full bucket are at least not worse. But the reason to prefer immutable is no longer "overwrites cannot happen"; it is "the SDK refuses to write past capacity and asks for a new batch" as an SDK rule, with the flag as a marker.
- Caveat: n = 1 per case, one uploader, one testnet. Repeat on bee-factory with full nodes we control, and on mainnet, before treating the immutable behaviour as Bee's contract rather than this network's.

## Step 7 — funding paths a browser dapp could hand a user to (survey, 2026-09-04)

What exists, from ethswarm.org/get-bzz and the docs. None integrated; D3 says plug in, do not build.

| Path | What it gives | Status / notes |
|---|---|---|
| Jumper (LI.FI) | any chain, any token → xBZZ on Gnosis in one flow; also delivers xDAI | Linked from get-bzz; the only listed route that starts from arbitrary chains. Has an embeddable widget and an SDK; the natural first integration for "fund at sign-in". |
| CoW Swap on Gnosis | xDAI/WETH → xBZZ | Needs the user already on Gnosis with xDAI. |
| Uniswap on Ethereum | ETH → BZZ (mainnet BZZ), then Omnibridge to Gnosis | Two steps, two chains; poor UX for onboarding. |
| Omnibridge | BZZ ↔ xBZZ, DAI ↔ xDAI | Bridge only. |
| Centralized exchanges | BZZ, sometimes xBZZ directly | Listed via CoinMarketCap / CoinGecko; a withdrawal to the user's wallet on Gnosis is the only requirement. |
| Fiat on-ramp | none named for BZZ on the Swarm site | A dapp would use a generic on-ramp to xDAI on Gnosis, then CoW Swap; two steps. |
| Sponsor pays (D3(d)) | the dapp operator or anyone calls `createBatch(owner = user)` / `topUp` | Demonstrated above. Needs no user funds at all; the onboarding ramp. |

Recommendation for D3: the demo starts with sponsor-pays; the "bring your own funds" path offers Jumper first, since it is the one that starts from wherever the user's funds are and ends with both xBZZ and xDAI.

## Browser write path (D13), 2026-09-04

- **weeb-3** (github.com/lat-murmeldjur/weeb-3; the `ethersphere/weeb-3` URL is gone): a Rust Swarm client compiled to WebAssembly. Its README now claims "networking, retrieval, **upload**, persistence, service-worker integration" in the browser, including "optionally as a feed update", plus "postage batch acquisition, chequebook deployment, cheque signer persistence, and chequebook deposits through the browser wallet". At handoff it was retrieval-only, so this is new. 348 commits, one open issue; no release tag seen. Not verified here. If it holds, a dapp could write to Swarm with no HTTP Bee endpoint at all; the SDK's transport interface should allow a weeb-3 backend later (Phase 4/5), which fits D8's "keep the seed and transport pluggable".
- Other in-browser or attached nodes: not surveyed beyond weeb-3 tonight.
- **CORS from a browser page: works.** A page on `http://127.0.0.1:8731` (headless Chromium, `src/cors-prepare.mjs` built the request) did `fetch(POST /soc/{owner}/{id}?sig=…)` with the `swarm-postage-stamp` header against the node on `:1653`: status 201, reference `bfc32e72…5f6a` equal to the SOC address. The node needs `cors-allowed-origins` set (ours: `'*'`); its preflight answer allows `POST`, echoes the origin, and lists `Swarm-Postage-Stamp` among the allowed headers. Bee's default config has no CORS origins, so a dapp operator must set that one line, or the dapp must use a gateway that does.
- **Minimum a dapp operator must run today for writes:** nothing of their own if the user's node or any public Bee HTTP endpoint with `cors-allowed-origins` set accepts pre-stamped uploads (mode B), or one gateway-proxy plus a Bee node for mode A. What shrinks if weeb-3's write path holds: the HTTP endpoint disappears; funding stays.

## Dependency status (for the gate)

| Dependency | Version seen | State | Notes |
|---|---|---|---|
| Bee | 2.8.2 | current | `/soc` accepts pre-stamped SOCs; `/chunks` does not (address mismatch). Feed lookup 2–5 s (S2). |
| bee-js | 13.0.0 | current, pinned (D10) | Envelope upload works via `soc.makeWriter().upload` at runtime; the TypeScript type omits it. Feed writer takes a batch id only. |
| core-sdk | 0.1.1 | current, pinned (D10) | `Stamper`, `makeContentAddressedChunk`, `toSingleOwnerChunk` sufficient for client-side stamping; signing matches Bee. |
| gateway-proxy | 0.16.0 (2026-01) | works, beta, README pins Bee 1.7 | mode A fallback; no per-user auth. |
| bee-factory | 1.1.2 (2026-08) | works | queen on `:1633`, workers `:1635…1641`. |
| weeb-3 | git main | claims browser uploads | unverified; watch for D13/Phase 4. |
| fdp-storage (prior art) | not examined tonight | | |
