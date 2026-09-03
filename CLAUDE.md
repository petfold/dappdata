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
- `@ethersphere/bee-js`: **13.0.0** is the latest on npm at handoff (2026-09-03); the Swarm skill and most docs still describe 12.x. First task of Phase 0: read the 13.0 changelog for feed and single-owner-chunk API changes, then pin (see D10).
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

Phase 0 not started.

**Next action:** open `docs/SPIKES.md`, start with S1 (key derivation). Before S1, do the bee-js 13.0 changelog check and record the pin in D10.
