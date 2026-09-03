# dappdata

Persistent, per-user dapp state on Swarm, keyed to the identity a user already proved with Sign-In with Ethereum (ERC-4361). A small TypeScript SDK on bee-js, plus a reference dapp that restores a user's state on a fresh device from nothing but their wallet.

The name: every operating system gives an app a per-user folder for *your* data — `%APPDATA%`, `~/Library/Application Support`, `~/.local/share`. dappdata is that folder for dapps, on Swarm, under a key derived from one wallet signature. Any device that can reproduce the signature opens the same folder.

Origin: Solar Punk Ideabox **IDEA-190** — https://solar-punk.atlassian.net/browse/IDEA-190. Owner: Peter Földiák.

## Where things are

| File | What it answers | Read it when |
|---|---|---|
| `docs/PLAN.md` | What we build, in what order, and how we know a phase is done | First, always |
| `docs/SPIKES.md` | Exact protocols for the three Phase 0 experiments | Before any Phase 0 work |
| `docs/ARCHITECTURE.md` | Target design: keys, feed layout, encryption, funding, modules, API | Before any Phase 1+ code |
| `docs/DECISIONS.md` | The decision log. Open items D1–D11; nothing they cover is final until closed | Before acting on anything marked *open* |
| `docs/THREATS.md` | What can go wrong and what we do about it | Before touching keys, signatures, or funding |
| `docs/CANVAS.md` | The IDEA-190 canvas — the *why* | When you need the original framing or references |

`docs/CANVAS.md` is the source of truth for why this exists. This file and the rest of `docs/` are the source of truth for how. Jira (IDEA-190) tracks the idea's status; this repo tracks the work.

## Working rules

1. **Phases have gates.** Do not write Phase N+1 code until the Phase N gate is recorded in `docs/PLAN.md` and its decisions are closed in `docs/DECISIONS.md`.
2. **Decisions live in `docs/DECISIONS.md`.** Add an entry before you act on a choice with lasting effect. When code embodies a decision, name the D-number in a comment.
3. **Docs move with code.** A change that alters the design updates `docs/ARCHITECTURE.md` in the same commit.
4. **Money.** Never buy, top up, or dilute a postage batch on Gnosis mainnet without Peter confirming in the session. bee-factory and Sepolia testnet are free to use.
5. **Keys.** Never commit private keys, mnemonics, or derivation signatures. Test fixtures use throwaway keys, labelled as such in the file.
6. **Scope.** No protocol changes, no Bee forks. Compose what exists: feeds, postage stamps, encryption, ACT.
7. **Dependencies.** bee-js is pinned (see below). Ask before adding a dependency not listed in `docs/ARCHITECTURE.md`.
8. **Unsure? Write it down.** Add an open item to `docs/DECISIONS.md` instead of guessing.

## Toolchain and environment

- Node 22 LTS, pnpm workspaces, TypeScript strict, vitest. ESLint + Prettier with defaults.
- `@ethersphere/bee-js` **13.0.0** and `@ethersphere/core-sdk` **0.1.1**, both pinned exact (D10, closed 2026-09-03). 13 has a namespaced API (`bee.feed.*`, `bee.soc.*`, `bee.stamp.*`, `bee.chunk.*`); primitives and the `Stamper` live in core-sdk. The Swarm skill and most docs still show 12.x: translate any snippet to the namespaced form before use, or run the shipped `bee-js-codemod`.
- Local Bee: **bee-factory** (https://github.com/ethersphere/bee-factory). Bee 2.8.1 removed the old `bee dev` mode, so bee-factory is the supported local path.
- Testnet: Sepolia. Mainnet: Gnosis Chain (BZZ, postage contract).
- Reference material: the `swarm` skill if installed; https://docs.ethswarm.org; https://github.com/ethersphere/bee-js.

## Repo layout (target)

```
dappdata/
  CLAUDE.md
  README.md
  docs/                    plan, spikes, architecture, decisions, threats, canvas
  spikes/                  Phase 0 throwaway scripts; one folder per spike, each with RESULTS.md
  packages/
    dappdata/              the SDK, published unscoped as `dappdata` (D11)
    dappdata-react/        optional hooks; Phase 3 or later
  apps/
    demo/                  reference dapp (Phase 3)
  infra/
    proxy/                 gateway-proxy config for funding mode A
```

Create folders when a phase needs them, not before.

## Conventions

- Names are lowercase and functional. Package and folder names match the words used in `docs/`.
- Commits: imperative mood, one change each, reference the phase and any D-number (`S1: add EIP-712 derivation message (D1)`).
- Tests: unit tests mock Bee; integration tests run against bee-factory; nothing in CI touches a real network.
- Writing, in docs and comments: plain English, active voice, short words. Say who does what. Peter and future Claude sessions both read these files.

## Status

Phase 0 started 2026-09-03. D10 closed (bee-js 13.0.0 + core-sdk 0.1.1). D3 direction set: user owns the batch, anyone pays (see D12 for client-side stamping, D13 for browser-first, D14 for the integration surface).

**S1 wallet matrix done for MetaMask and Rabby** (`spikes/s1/RESULTS.md`): both deterministic across 20 signatures, page reload, and wallet restart; the same account in both wallets yields the same feed key, for the typed-data path and the fallback path alike. Prompts in both wallets show origin and purpose. F1 (no `chainId`) held in both. Still open in the matrix: Coinbase Wallet, WalletConnect mobile, Ledger, smart accounts (step 5). Harness now picks wallets via EIP-6963; `spikes/s1/src/cdp.mjs` clicks wallet prompts through Chrome's DevTools port (`--remote-debugging-port`), so a Claude session can run the 20× loops; unlocking stays with Peter. D1, D2, D8 closed 2026-09-03.

**S2 done** (`spikes/s2/RESULTS.md`, four paths): writes 15–70 ms locally, 0.3–1.7 s via a light node or gateway; Bee's feed lookup costs 2–5 s everywhere, reading by a known index 10–300 ms, so the SDK caches the index per slot (D5). Visibility 2–2.5 s on mainnet gateways, 8–20 s p50 on the Sepolia testnet. **S3 done except mode A autobuy** (`spikes/s3/RESULTS.md`): user-owned batch paid by another key works; client-side stamps accepted via `POST /soc` by a batch-less node, also cross-origin from a browser; topUp permissionless, dilute owner-only; a reused stamp slot silently replaces the earlier chunk on immutable and mutable batches alike, so the SDK must persist stamper state. weeb-3 now claims browser uploads. bee-factory runs via `npx @ethersphere/bee-factory start`; its queen takes port 1633 (`bee-factory stop` frees it).

**Sepolia nodes for S2/S3:** writer, Bee 2.8.2 (Swarm Desktop binary), `/home/test/bee-sepolia/`, API `127.0.0.1:1643`, wallet `0x13cB9947C508cf52a233a1E97d80Dd2485589481`, funded (sETH + 0.13 sBZZ, chequebook deployed, batch `98dfbb97…` depth 17). Reader, ultra-light, `/home/test/bee-sepolia-reader/`, API `127.0.0.1:1653`. Each has a `start.sh`. RPC: Tenderly's public Sepolia endpoint 429s on bursts from this machine once the node is on it; both configs point at `ethereum-sepolia-rpc.publicnode.com` now (watch the log for `eth_getLogs` trouble). sBZZ came from a Uniswap V3 swap by a throwaway key (`spikes/s3/`), key at `~/.dappdata-sepolia-swap.key`. Swarm Desktop's own mainnet node (`:1633`) is off limits; bee-factory's queen takes that port while it runs.

**Next action:** Peter confirms the drafted closures of D3, D4, D5, D12, D13 in `docs/DECISIONS.md` and the Phase 0 go/no-go at the top of `docs/PLAN.md`; then the gate comment goes on IDEA-190 and Phase 1 starts.
