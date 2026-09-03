# S1 — Key derivation: results

Status: **core done** (2026-09-03). Node checks, library check, D8 reading, and the real-wallet matrix for MetaMask and Rabby are done, portability confirmed. Left open: Coinbase Wallet, WalletConnect mobile, Ledger, smart accounts and passkeys (step 5). Enough to close D1, D2, D8.

## What is here

- `src/derive.ts` — the EIP-712 message, the `personal_sign` fallback text, and `derive(signature)` → seed, feedKey, feedAddress, encKey. Shared by both harnesses.
- `src/determinism.ts` — Node check with a throwaway random key (`pnpm determinism`).
- `web/` — browser harness for real wallets (`pnpm serve`, then open http://127.0.0.1:8731). Use a throwaway account: signatures are printed on screen. Wallets are discovered with EIP-6963 and picked from a dropdown, so several extensions can share one browser profile.
- `src/cdp.mjs` — drives Brave/Chrome over the DevTools protocol when the browser runs with `--remote-debugging-port=9222`: evaluates JS in the harness page, and finds the wallet popup, screenshots it, and clicks Confirm. Written so a Claude session can run the 20× loops without a human clicking. `approve <n> [shotPrefix]`.
- `results/` — one JSON per saved run (`wallet-*.json`) plus prompt screenshots.

## Node results (2026-09-03, ethers v6 signer, RFC 6979)

| Check | Result |
|---|---|
| 20 typed-data signatures over the same message | 1 distinct: deterministic |
| 20 `personal_sign` signatures over the fallback text | 1 distinct: deterministic |
| Signatures recover to the signing address | yes, both |
| feedKey and encKey differ | yes |
| core-sdk `PrivateKey(feedKey)` gives the same feed address as our noble derivation | yes (note: core-sdk `toHex()` omits the `0x` prefix) |
| Typed-data path and fallback path give the same key | **no** (see F2) |

## Signing-library results (2026-09-03, `pnpm libraries`, throwaway key, 20 runs each)

The libraries real wallets sign with, run headless. Same key, same message, same signature in every library and every run.

| Library | Used by | Typed data v4: distinct of 20 | personal_sign: distinct of 20 | Identical across libraries |
|---|---|---|---|---|
| ethers v6 | many dapps, some wallets | 1 | 1 | yes |
| @metamask/eth-sig-util 8 | the MetaMask extension | 1 | 1 | yes |
| viem 2 | Rabby, wagmi-based wallets | 1 | 1 | yes |

So the software layer is deterministic (RFC 6979) and interoperable. What remains for the real-wallet matrix is what code cannot see: whether each wallet's UI passes the message through unchanged, how it displays `origin` and `purpose`, hardware-wallet firmware (Ledger signs on-device with its own implementation), and mobile wallets through WalletConnect.

## Findings for D1 / D2

**F1 — no `chainId` in the EIP-712 domain.** SPIKES.md proposed `{ name, version, chainId }`. MetaMask rejects `eth_signTypedData_v4` when the domain `chainId` differs from the wallet's current chain, so a chain-bound domain would either force a chain switch before sign-in or derive a *different key per chain the user happens to be on*. `chainId` is optional in EIP-712. The spike omits it; the key depends on `account`, `origin`, and `scope` only. **Recommend for D1.**

**F2 — the fallback derives a different key.** `personal_sign` over the text serialisation cannot equal the typed-data signature, so a user who signs with a typed-data wallet today and a text-only wallet tomorrow gets two different folders. Options: (i) make the fallback sticky per account (the SDK records which method was used, in the feed itself or in a small marker chunk); (ii) on restore, try typed-data first and fall back to reading under the text-derived key; (iii) drop the fallback and require typed-data support (D2 shrinks the wallet set). **Lean (ii) for reads plus (i) for writes; decide in D1 after the wallet matrix shows how many wallets still lack typed data.**

**F3 — derivation is browser-safe with no Node-only code.** `@noble/hashes` + `@noble/curves` bundle to 83 KB for the harness; the same `derive.ts` runs in Node and the browser (D13 holds).

## Wallet matrix (fill from the browser harness)

| Wallet | Version | Typed data v4 | 20× deterministic | Across reload | Across wallet restart | Shows `origin` + `purpose` clearly | Fallback needed | Screenshot |
|---|---|---|---|---|---|---|---|---|
| MetaMask (extension) | 13.46.1, Brave 152 (Chromium 152), Linux | yes | yes (1 distinct of 20) | yes | yes (extension toggled off/on, unlocked; also full Brave restart) | yes: Purpose, Account, Origin, Scope as labelled fields; "Request from 127.0.0.1:8731" with an HTTP warning badge | no (personal_sign also deterministic, 1 of 20; different key as F2 says) | `results/metamask-typed-prompt.png`, `results/metamask-personal-sign-prompt.png` |
| Rabby | 0.94.6, Chromium (Ubuntu), Linux | yes | yes (1 distinct of 20) | n/a (not repeated; typed key equals MetaMask's) | n/a | yes: origin in the header, "Sign Typed Data" with the message JSON; labels the type "Unknown Signature Type" | no (personal_sign deterministic, 1 of 20, same key as MetaMask's fallback) | `results/rabby-typed-prompt.png`, `results/rabby-personal-sign-prompt.png`, `results/rabby-connect-prompt.png` |
| Coinbase Wallet | | | | | | | | |
| WalletConnect → (mobile wallet) | | | | | | | | |
| Ledger via MetaMask | | | | | | | | |

### MetaMask run notes (2026-09-03)

- Account `0xd5d8346f240af11ee5129b39e9bec6fa0f4a75e3` (throwaway), chain 1 selected in the wallet. Typed-data feedAddress `0x5912a60959141c0fe66e32706d0b519675e3692a` in every run: same session, after page reload, after extension restart, after killing and relaunching Brave. Fallback feedAddress `0xe279a673619c54653f52d3ceebe27705298d0ec9`, also stable across 21 signatures.
- MetaMask did not need a chain switch and did not complain about the domain without `chainId` (supports F1).
- Prompt rendering: the typed-data prompt lists `Primary type: DappDataKey` and the four fields by name; the personal_sign prompt shows the raw text. Both name the requesting origin twice (header and message). Good enough that a user could spot a wrong origin.
- Three wallets (MetaMask, Rabby, Brave Wallet) were installed in the same profile. Rabby had claimed `window.ethereum`, so the first harness version could only reach Rabby; the fix was EIP-6963 discovery. Any dapp that adopts dappdata will meet the same situation, so the SDK must take a provider from the caller rather than read `window.ethereum` (note for D14 / ARCHITECTURE).
- Timing: 20 typed signatures took 332 s with a human clicking, 20 personal_sign took 580 s including a Brave restart and unlock. Not a measure of the wallet; the driver clicks in under a second each.
- Files: `results/wallet-2026-09-03T15-08-00-122Z.json` (typed 1 + 20), `…15-09-22…` (after reload), `…15-14-50…` (after extension restart), `…15-18-40…` (typed + fallback once), `…15-35-00…` (fallback 20), `…15-35-15…` (typed once for screenshot).

## Cross-wallet portability (step 4)

Import one throwaway seed phrase into two wallets; sign the same message in both; compare `feedAddress`.

Result (2026-09-03): **portable.** The throwaway account `0xd5d8…75e3` was imported into Rabby (Chromium) by private key from the MetaMask (Brave) account. Both wallets, 20 signatures each:

| Path | MetaMask 13.46.1 | Rabby 0.94.6 | Match |
|---|---|---|---|
| typed data v4 → feedAddress | `0x5912a60959141c0fe66e32706d0b519675e3692a` | `0x5912a60959141c0fe66e32706d0b519675e3692a` | yes |
| personal_sign → feedAddress | `0xe279a673619c54653f52d3ceebe27705298d0ec9` | `0xe279a673619c54653f52d3ceebe27705298d0ec9` | yes |

Together with the headless library check (ethers, eth-sig-util, viem identical), this says the key depends on the account and the message only, not on the wallet. Files: `results/wallet-2026-09-03T15-56-25-605Z.json`, `results/wallet-2026-09-03T16-32-48-969Z.json` (the latter also holds two `User rejected` entries from an aborted run; see notes).

### Rabby run notes (2026-09-03)

- Rabby asks for **two clicks per signature**: "Sign", then a second "Confirm" screen. MetaMask asks for one. Rabby also flags our primary type as "Unknown Signature Type", which is expected for a custom EIP-712 type and is only cosmetic.
- Rabby did not object to the domain without `chainId` either (F1 holds for both wallets).
- Rabby's notification popup rendered empty once, after a request had been cancelled while another batch was still queued. "Reject All" from the Rabby dashboard and a fresh request fixed it. Lesson for the harness: run one batch at a time.
- Driving: MetaMask prompts were confirmed by `src/cdp.mjs` over the DevTools port; Rabby typed-data prompts likewise; the final Rabby personal_sign batch was clicked by hand. Wallet unlock (password entry) stays with the human in every case.

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
