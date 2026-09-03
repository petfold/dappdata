# S1 — Key derivation: results

Status: **in progress** (started 2026-09-03). Node-side checks and D8 reading done; real-wallet matrix, portability, and smart-account tests pending (need Peter at a browser with wallets).

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

## D8 — swarm-id (snaha/swarm-id), read 2026-09-03

What it is. A browser identity layer with a **trusted domain** (`swarm-id.snaha.net`) that holds a master key in first-party storage and hands each dapp an app-specific secret through an OAuth-style popup plus iframe. The master key comes from a signed challenge, via **Passkey/WebAuthn or SIWE**. App secret = HMAC-SHA256(masterKey, appOrigin). Below that: `derivationKey` → `swarmEncryptionKey` → backup feed signer and AES-GCM key; and a `postageSignerKey` that signs stamps **client-side** (`UtilizationAwareStamper`) against a **user-owned, mutable** batch shared across devices with a partition-lease protocol built from SOCs and epoch feeds. It also has a "subsidised gateway" fallback when the user has no batch. Docs are thorough and implementation-level (multi-device-postage-batches, Postage-Batch-Partitioning).

Overlap with dappdata: the derived-key idea, per-origin isolation, client-side stamping, user-owned batch, encrypted feeds. Nearly everything in our Phase 1 and 2.

Differences that matter:
- **Identity root.** swarm-id's identity is a swarm-id *account* unlocked by passkey or wallet; the key lives in a third party's origin. dappdata's identity is the wallet address itself, with no trusted domain, no popup, no operated identity service. That is the canvas's premise (the user already proved this identity with SIWE) and it is the reason a dapp can adopt dappdata with one package and no third-party origin.
- **Passkeys.** Their passkey path is exactly what our D2 lacks for non-EOA users. Worth pointing at when D2 closes "refuse in v1".
- **Batch model.** They chose mutable batches plus a lock protocol to share one batch across devices. We plan immutable batches and a simpler write discipline (D4, D6). Their docs are the best available evidence of what the mutable route costs in complexity.
- **Client-side stamping.** They do it in production code with a derived signer key, which is strong evidence for D12 before S3 runs.

Recommendation for D8: **(b) independent and SIWE-native, align where cheap.** Concretely: keep per-origin isolation as the isolation unit (same as theirs); keep the derivation pure-function and documented so an identity layer like swarm-id could later supply the seed (an `EntropySource` interface instead of hard-wiring `eth_signTypedData_v4`); reuse or copy their stamper and lease code if D6/D12 need multi-device stamping. Do not build on swarm-id now: it would add a hosted trusted domain and a second identity to a project whose point is to need neither. Revisit in Phase 5 if swarm-id ships and dapps already carry it.

## Environment

- Node 22.23.2, pnpm 11.25.0, ethers 6, @noble/hashes 1.8, @noble/curves 1.9, @ethersphere/core-sdk 0.1.1.
- Sepolia light node for S2/S3: Bee 2.8.2 (Swarm Desktop binary), config `/home/test/bee-sepolia/config.yaml`, API `127.0.0.1:1643`, p2p `:1644`. Node address `0x13cB9947C508cf52a233a1E97d80Dd2485589481` (throwaway; needs sETH + sBZZ before it can deploy a chequebook or buy a batch).
