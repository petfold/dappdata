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
| `docs/DECISIONS.md` | The decision log. Open items through D27; nothing they cover is final until closed | Before acting on anything marked *open* |
| `docs/THREATS.md` | What can go wrong and what we do about it | Before touching keys, signatures, or funding |
| `docs/CANVAS.md` | The IDEA-190 canvas — the *why* | When you need the original framing or references |
| `docs/CONVERGENCE.md` | How dappdata relates to swarm-id and fdp-storage, and what we adopt from them | Before touching derivation, sub-keys or stamper state; before talking to the swarm-id team |
| `docs/PROPOSAL-swarm-id.md` | The shared-spec argument for the swarm-id team | When Peter sends or discusses it |
| `docs/REVIEW-IDEA-198.md` | Solar Punk's feasibility study of the idea: what we adopted, what we corrected, what to send back | Before replying to the study or closing D26/D27 |

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

- Node 22 LTS, pnpm workspaces, TypeScript strict, vitest. ESLint + Prettier with defaults are the intent; neither is configured yet (IDEA-198 noticed).
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

**Sepolia nodes for S2/S3:** writer, Bee 2.8.2 (Swarm Desktop binary), `/home/test/bee-sepolia/`, API `127.0.0.1:1643`, wallet `0x13cB9947C508cf52a233a1E97d80Dd2485589481` (0.0991 sETH, 0.0659 sBZZ; chequebook deployed; the S2/S3 batch `98dfbb97…` expired and was pruned). **The Phase 2 money lives with the payer, not the node:** throwaway swap key `0x6f49…f3Bc` holds 0.0215 sETH and 0.5252 sBZZ after the 2026-09-21 top-up, which is what a user-pays and sponsor-pays gate run spends. Reader, ultra-light, `/home/test/bee-sepolia-reader/`, API `127.0.0.1:1653`. Each has a `start.sh`. RPC: Tenderly's public Sepolia endpoint 429s on bursts from this machine once the node is on it; both configs point at `ethereum-sepolia-rpc.publicnode.com` now (watch the log for `eth_getLogs` trouble). sBZZ came from a Uniswap V3 swap by a throwaway key (`spikes/s3/`), key at `~/.dappdata-sepolia-swap.key`. Swarm Desktop's own mainnet node (`:1633`) is off limits; bee-factory's queen takes that port while it runs.

**Review from swarmtyp, 2026-09-05** (`../swarmtyp`, first adopter candidate, PLAN Phase 5). Nine open items added, D15–D23: derivation input (`r‖s`, low-`s`), app identity instead of browser origin for gateway-hosted dapps, sub-keys for other libraries, caller-supplied transport, stamper as a service with checkpointed bucket state, envelope crypto as a reusable module, wallet-less entropy sources, slot schema versions, funding granularity. THREATS T12–T16 added; T7 and T9 statuses updated. `ARCHITECTURE.md` marks every affected section with its D-number; `PLAN.md` Phase 1 and 2 gates name them. The review thread that was `issues.txt` is folded into D15 and D23 and the file is gone.

**Convergence with swarm-id, 2026-09-06** (`docs/CONVERGENCE.md`, D24 open). swarm-id's wallet mode unlocks a random seed in a device-local vault; it does not derive from the signature. Both projects are pre-user, so a shared derivation spec is possible now and not later. `docs/PROPOSAL-swarm-id.md` is the draft argument for their team, awaiting Peter's edit and send. Regardless of their answer, Phase 1 adopts their HMAC KDF primitive, canonicalisation rules, `deriveAppSecret(label)` shape and commit-ordered stamper handoff.

**Ecosystem identity review, 2026-09-06** (D25, T17). dappdata rides wallet login, not SIWE the standard; the exposure is passkey-only smart accounts, not the sign-in format. D2's `eth_getCode` check must treat the EIP-7702 delegation designator as an EOA; the passkey PRF source moves to Phase 2; the Phase 3 matrix gains an embedded wallet and a 7702 account. Neither swarm-id nor fdp-storage sits on an ecosystem identity; dappdata does, and keeps that stance.

**Phase 0 gate closed GO, 2026-09-21.** Peter confirmed D3, D4, D5, D12, D13 as drafted, then closed the spec decisions that Phase 1 code depends on: D9 (AES-256-GCM, topic as AAD, Swarm-encrypted blobs with the reference inside the payload), D15 (secret over `r‖s` low-`s`, public key recovered and checked against the account, HMAC-SHA256 as the KDF with swarm-id's canonicalisation), D16 (one signed field `app`, origin by default, a declared identity for gateway-hosted dapps), D17 (`deriveKey(purpose)` in swarm-id's `deriveAppSecret(label)` shape), D20 (envelope as a pure module), D21 (wallet and mnemonic sources in Phase 1, passkey in Phase 2, app binding after every source), D22 (schema byte plus `migrate`). D18: the `Transport` interface ships and a `fetch` transport on core-sdk is measured in Phase 1, which names the default. D24: Peter sent the proposal; the swarm-id team has not answered, and the four adoptions were taken anyway. `ARCHITECTURE.md` derivation and encryption blocks match these closures.

**Phase 1 started 2026-09-21.** Gate comment posted on IDEA-190 (comment 23417; the links went up as a second comment because the Jira API escapes wiki markup — use markdown links). `packages/dappdata` now holds `derive/`, `entropy/`, `siwe/` and `envelope/` with 26 unit tests, a typecheck and a build; the v1 derivation is pinned by a golden vector in `test/derive.test.ts`. Still to write: `transport/` (D18, plus the `fetch`-transport measurement), `feed/`, `slot/` with the per-slot index cache (D5), `DappData.connect`, and the bee-factory integration tests.

**Phase 1 slice two, 2026-09-21.** `transport/` (bee-js, fetch, in-memory, custom), `feed/` with the D5 index cache, `slot/` with expectIndex, merge, migrate and blob overflow, and `DappData.connect` over all of it. 46 unit tests against a mocked Bee; the README example runs as a test including the fresh-device restore. `@scure/bip39` added with Peter's agreement (mnemonic checksum). **D18 measured:** the fetch transport is 120 lines and 26 KB gzipped against bee-js's 167 KB, so it becomes the default once bee-factory has run it; numbers are in `DECISIONS.md` under D18.

**Phase 1 gate run, 2026-09-21 (bee-factory, Bee 2.8.2).** Peter stopped the mainnet node; the cluster ran on :1633 with an immutable depth-20 batch bought on its dev chain. All eight integration tests pass on both transports: slot write and read back, C5 checked on the raw chunk, the blob path, cross-transport interop, and the README example restoring on a freshly derived instance (C1, C2). **D18 closed with (b):** `transport.fetch` is the default, the package root no longer imports bee-js (68 KB, 26 KB gzipped, against 167 KB with bee-js), and the bee-js transport moved to `dappdata/transport/bee-js` with `@ethersphere/bee-js` as an optional peer. CI added (`.github/workflows/ci.yml`): unit, typecheck and build on push; a manual bee-factory job for the integration suite.

**T18, found by that run:** a chunk is unreadable for about a second after upload (`GET /chunks` → 500 `read chunk failed`, feed lookup → 404, then both 200), and a never-written chunk answers the same 500 for ever. So "missing" and "not yet readable" are indistinguishable. The feed now serves its own last write from memory, and the pre-write index probe is a positive conflict signal only. The residual write-write race inside that window is D19's to close.

**Phase 1 gate signed off 2026-09-21; Phase 2 under way.** `PLAN.md` records the sign-off, and its Phase 2 work list was rewritten: it still described the gateway-proxy adapter D3 removed from the design. D14's API half and D25's item 1 closed with the gate.

**Phase 2 so far.** `stamper/` (D19) and `funding/` (D3, D23) are written, with 73 unit tests in total. **D19's design changed and the entry records why:** the safety margin cannot work, because a batch has 65 536 buckets at every depth — 2 slots per bucket at depth 17, 16 at depth 20 — so a margin wide enough to cover an unsynced writer is wider than the space it protects. The rule is now reserve-before-use: the checkpoint records a height per bucket the device may spend, and a restoring device starts at that line. Peter confirms D19 at the Phase 2 gate. `funding/` encodes its four contract calls by hand (selectors cross-checked against ethers v6) so it adds no web3 library; chain addresses come from `go-storage-incentives-abi`, Sepolia's verified by S3, Gnosis's sourced but untouched. `docs/FUNDING.md` is the dapp-developer guide.

**Phase 2 gate run done, 2026-09-21: passes** (`spikes/phase2/RESULTS.md`, script `spikes/phase2/src/gate.mjs`, log in `results/`). On Sepolia: sponsor-pays and user-pays through one code path with the batch owned by a derived key holding nothing; a slot stamped by that key and uploaded to a node holding no batch, read back by a fresh instance; two devices sharing a checkpoint taking disjoint slots in one bucket; a non-owner top-up, 24 h to 48 h. Five defects found and fixed with regression tests, the worst being that two devices **did** collide at first: the stamper extended a reservation from its own stale state, so it now re-reads the store before every extension. Also found: **Bee's `batchTTL` is wrong on Sepolia** (166 days for a batch the contract gives 0.99: about 170× in days, about 400× in block count once Bee's fixed 5 s block-time factor is removed; on Gnosis the study found it within 1 %, so the cause is Sepolia-specific and still unknown), so `health()` computes the lifetime from `remainingBalance / lastPrice` and reports `ttlSource`; `BatchCreated` has seven parameters, not the eight S3's ABI declared; the batch id is `keccak256(abi.encode(payer, nonce))` and is derived, not parsed; `/stamps` lists only batches the node owns, so the transport falls back to `/batches`.

**The gate stays open on two things.** D21's passkey half (`entropy.passkey()`, WebAuthn PRF) is unwritten. And D19's slot-backed checkpoint store cannot stamp itself — a checkpoint written through the stamper it checkpoints needs a slot, which needs a checkpoint, for ever — so `dd.stamper()` needs a caller-supplied store until the one-step lookahead lands. The stamper raises a typed error rather than recursing.

**IDEA-198, Solar Punk's feasibility study, read 2026-09-22** (`docs/REVIEW-IDEA-198.md`). Verdict feasible with conditions; it confirms the three risky assumptions from Bee source and a mainnet light node, and asks for an independent review of `derive/`, `envelope/`, `stamper/` and a mainnet two-device slot test before any real user. Taken into the plan: D26 (repo home, npm name) and D27 (client-stamped blobs) opened; dual-key restore added to Phase 2; empty-state path to Phase 3; independent reader, mainnet slot test and a shareable `CONVENTIONS.md` to the Phase 4 gate; File Manager `SwarmClient` adapter to Phase 5. Three corrections go back to the study: `/chunks` parses a SOC body as a CAC first, so D12 stands; the `batchTTL` block-time inference is off (the error is 170× in days and in the wrong direction for that cause); an ultra-light node with a chain RPC does validate pre-signed stamps. The Sepolia TTL bug is written up as "about 170× in days, about 400× in blocks" from now on.

**D19 lookahead landed, 2026-09-22.** The slot-backed checkpoint store is the default and stamps itself: the store names the addresses of its next two feed updates (`upcoming()`), the stamper reserves them inside the checkpoint it writes, and a checkpoint write that loses to another device raises `CheckpointConflictError` and restarts from the winner's lines. `Stamper` is itself a `Stamp`. 89 unit tests. **Run on Sepolia** (`spikes/phase2/RESULTS.md`, "D19 closure run"): self-stamping and network restore work; the two-device interleaving collided because a chunk written through a light node is unreadable through that node until the network serves it back, **50–60 s on Sepolia** with `/soc`'s direct upload (about a second on bee-factory, 270 ms on mainnet per IDEA-198). That is what T18 is. Also found: a read of a not-yet-written index costs a 3.6–9 s retrieval attempt, and every warm read and write paid one; the fetch transport now bounds reads by index (`probeTimeoutMs`, 2 s) and offers `deferred` and `pin` for a node the user runs. The residual two-device window is D6's, quantified. The Sepolia writer node is running (started 2026-09-22), chequebook funded with 0.05 sBZZ; batch `7148d39d…` depth 20 is usable until 2026-09-23.

**D1 amended 2026-09-22 (Peter): typed data required.** The `personal_sign` fallback is off by default and opens a separate folder when a dapp opts in; a wallet without `eth_signTypedData_v4` gets a typed error. Checked first: every current wallet signs v4, hardware wallets included, and the WalletConnect "method not available" reports of 2023 were dapps not listing the method. D2 gained a note on how smart accounts come in later: owner-EOA root for 1-of-1 accounts (Phase 3, cheap), passkey PRF and a wrapped folder seed (D21's evaluation, next).

**D21 passkey source landed, 2026-09-22.** `entropy.passkey()`: discoverable WebAuthn credential, PRF over a fixed salt, creation on first use, typed refusal without PRF. Evaluated headless with Chrome's virtual authenticator over CDP (`spikes/phase2/passkey/`, `pnpm passkey`): 20 sign-ins one secret, stable across reload, one folder per app id, one folder per passkey. PRF-only ships; the wrapped folder seed that would make several passkeys or several smart-account owners one folder is opened as **D28**, additive, built with the smart-account work. 96 unit tests. Headless Chrome here needs `--no-sandbox`; Chrome allows one internal virtual authenticator at a time.

**Next action:** Peter closes D19, D21 and D23 and signs off the Phase 2 gate, or sends items back for work first; decides D26 with Solar Punk tech leadership; then D27 (client-stamped blobs) and the Phase 3 demo. A third upstream issue is worth filing on Bee for the `batchTTL` arithmetic, drafted only when Peter says so. Note for any session: bee-factory holds port 1633 while it runs, so Swarm Desktop stays off until `npx @ethersphere/bee-factory stop`.
