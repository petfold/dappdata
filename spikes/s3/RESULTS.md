# S3 — Funding: results

Status: **started 2026-09-03**. sBZZ obtained for the Sepolia node; funding-mode experiments pending.

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

## Funding modes (protocol in SPIKES.md)

_pending_
