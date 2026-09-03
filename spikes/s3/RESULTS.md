# S3 — Funding: results

Status: **mode B demonstrated on Sepolia** (2026-09-03): user-owned batch paid by another key, client-side stamps accepted by a batch-less node, topUp permissionless, dilute owner-only. Left: mutable-overflow test, funding survey, browser write path.

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
| 5. mutable batch filled past capacity | _not run yet_ | |
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

## Still to do in S3

Step 5 (mutable batch overflow, for D4 wording), step 7 (multichain funding survey), the browser write path checks (weeb-3 status, CORS from a browser page), and the dependency status table.
