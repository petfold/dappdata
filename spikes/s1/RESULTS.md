# S1 — Key derivation: results

Status: **in progress** (started 2026-09-03). Node-side checks done; real-wallet matrix pending.

## What is here

- `src/derive.ts` — the EIP-712 message, the `personal_sign` fallback text, and `derive(signature)` → seed, feedKey, feedAddress, encKey. Shared by both harnesses.
- `src/determinism.ts` — Node check with a throwaway random key (`pnpm determinism`).
- `web/` — browser harness for real wallets (`pnpm serve`, then open http://127.0.0.1:8731). Use a throwaway account: signatures are printed on screen.

## Node results (2026-09-03, ethers v6 signer, RFC 6979)

| Check | Result |
|---|---|
| 20 typed-data signatures over the same message | 1 distinct: deterministic |
| 20 `personal_sign` signatures over the fallback text | 1 distinct: deterministic |
| Signatures recover to the signing address | yes, both |
| feedKey and encKey differ | yes |
| core-sdk `PrivateKey(feedKey)` gives the same feed address as our noble derivation | yes (note: core-sdk `toHex()` omits the `0x` prefix) |
| Typed-data path and fallback path give the same key | **no** (see F2) |

## Findings for D1 / D2

**F1 — no `chainId` in the EIP-712 domain.** SPIKES.md proposed `{ name, version, chainId }`. MetaMask rejects `eth_signTypedData_v4` when the domain `chainId` differs from the wallet's current chain, so a chain-bound domain would either force a chain switch before sign-in or derive a *different key per chain the user happens to be on*. `chainId` is optional in EIP-712. The spike omits it; the key depends on `account`, `origin`, and `scope` only. **Recommend for D1.**

**F2 — the fallback derives a different key.** `personal_sign` over the text serialisation cannot equal the typed-data signature, so a user who signs with a typed-data wallet today and a text-only wallet tomorrow gets two different folders. Options: (i) make the fallback sticky per account (the SDK records which method was used, in the feed itself or in a small marker chunk); (ii) on restore, try typed-data first and fall back to reading under the text-derived key; (iii) drop the fallback and require typed-data support (D2 shrinks the wallet set). **Lean (ii) for reads plus (i) for writes; decide in D1 after the wallet matrix shows how many wallets still lack typed data.**

**F3 — derivation is browser-safe with no Node-only code.** `@noble/hashes` + `@noble/curves` bundle to 83 KB for the harness; the same `derive.ts` runs in Node and the browser (D13 holds).

## Wallet matrix (fill from the browser harness)

| Wallet | Version | Typed data v4 | 20× deterministic | Across reload | Across wallet restart | Shows `origin` + `purpose` clearly | Fallback needed | Screenshot |
|---|---|---|---|---|---|---|---|---|
| MetaMask (extension) | | | | | | | | |
| Rabby | | | | | | | | |
| Coinbase Wallet | | | | | | | | |
| WalletConnect → (mobile wallet) | | | | | | | | |
| Ledger via MetaMask | | | | | | | | |

## Cross-wallet portability (step 4)

Import one throwaway seed phrase into two wallets; sign the same message in both; compare `feedAddress`.

Result: _pending_

## Smart accounts and passkeys (step 5)

Safe (ERC-1271): _pending_. Passkey wallet: _pending_. Recommendation for D2: _pending_

## D8 — swarm-id

_pending_ (notes in progress)

## Environment

- Node 22.23.2, pnpm 11.25.0, ethers 6, @noble/hashes 1.8, @noble/curves 1.9, @ethersphere/core-sdk 0.1.1.
- Sepolia light node for S2/S3: Bee 2.8.2 (Swarm Desktop binary), config `/home/test/bee-sepolia/config.yaml`, API `127.0.0.1:1643`, p2p `:1644`. Node address `0x13cB9947C508cf52a233a1E97d80Dd2485589481` (throwaway; needs sETH + sBZZ before it can deploy a chequebook or buy a batch).
