# Roadmap

Where dappdata is, phase by phase. The plan itself, with gates and work lists, is `docs/PLAN.md`; the reasons behind each choice are `docs/DECISIONS.md`. Dates are when a gate was recorded.

| Phase | What it proves | Status |
|---|---|---|
| 0 — Spikes | One signature derives a stable key across wallets; someone other than the user can pay; latency suits interactive use | **Done.** GO on 2026-09-21 (`spikes/s1..s3`) |
| 1 — SDK core | Derivation, entropy sources, envelope, transports, feeds, slots, `DappData.connect`; bee-factory integration | **Done.** Signed off 2026-09-21 |
| 2 — Funding and stamping | The user owns the batch, anyone pays; client-side stamping with state that survives a new device; passkeys; blobs under a client stamp | **Done.** Signed off 2026-09-22 |
| 3 — Reference dapp | A browser demo restores a user's state on a fresh device from the wallet alone; the wallet matrix; UX of the extra prompt; Swarm-hosted integration guide | **Next.** May start |
| 4 — Hardening | Independent review of `derive/`, `envelope/`, `stamper/`; multi-device strategy (D6) with the visibility window measured; discoverability (D7); wrapped folder seed for passkeys and smart accounts (D28); versioned derivation; `CONVENTIONS.md`; first 0.x on npm | Planned |
| 5 — Adoption | One external dapp in production; swarmtyp as first adopter candidate; File Manager `SwarmClient` adapter after SPDV-1500; recordstore and IDEA-176 composition | Planned |

## What is settled

- One wallet signature over a fixed EIP-712 message derives the storage key; typed data is required, and every current wallet signs it (D1, D15).
- The user owns the postage batch through a derived key; the user, the dapp operator or a sponsor pays; no operated component (D3, D12).
- Stamps are signed client-side, with reserve-before-use bucket state checkpointed in the user's own folder (D19).
- Values are sealed with AES-256-GCM under a derived key; large values are chunked client-side, every chunk stamped (D9, D27).
- Three entropy sources: wallet, mnemonic, passkey over WebAuthn PRF (D21).
- The default transport is `fetch` over four Bee routes, 26 KB gzipped, no bee-js (D18).

## What is open, and where it is decided

| Item | Decision | When |
|---|---|---|
| Two devices writing inside the network's visibility window (about a second on mainnet, about a minute on Sepolia) | D6 | Phase 4, with a mainnet two-device test |
| Cross-dapp discoverability of a user's folders | D7 | Phase 4, before any external adopter |
| Where the repository lives and who registers the npm name | D26 | Solar Punk tech leadership |
| One folder behind several passkeys or several smart-account owners | D28 | Phase 3/4, with the smart-account work |
| Shared derivation spec with swarm-id | D24 | On the swarm-id team's answer |

## Publication

Not published. The npm name `dappdata` is free and is to be registered as a placeholder; the first usable 0.x follows the Phase 4 review, not before (`docs/PLAN.md`, Phase 4 gate).
