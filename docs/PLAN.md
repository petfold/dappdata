# Development plan

Status: draft for Peter's review, 2026-09-03. Supersedes the chat draft of the same day; see *Revision notes* at the end for what changed.

## Principles

- **Kill the risky assumptions first.** The canvas names three: the sign-in key is not the storage key; someone has to pay; latency may not suit interactive use. Phase 0 tests each with a throwaway script before we write SDK code.
- **Every phase ends at a gate.** A gate is a short list of checks plus the decisions it closes. We record the outcome in this file and in `DECISIONS.md`; only then does the next phase start.
- **Small SDK, honest demo.** The library stays small enough that "a few lines of integration" is testable. The reference dapp funds its writes the way a real deployment would, or it proves nothing.
- **Compose, don't extend.** Feeds, stamps, encryption, ACT, gateway-proxy, and bee-factory already exist. No protocol work.

## Success criteria (from the canvas, made checkable)

| # | Criterion | Checked in |
|---|---|---|
| C1 | A dapp adds persistent state with a handful of lines and no server code beyond an optional stamping proxy | Phase 1 (API shape), Phase 3 (demo) |
| C2 | Sign in on a fresh browser; state appears | Phase 3 |
| C3 | Latency suits interactive use: read-latest within seconds, cross-client visibility within a bounded, documented window | Phase 0 (S2 measures), Phase 3 (confirms) |
| C4 | Both funding modes work: proxy stamping and sponsored user batch | Phase 2 |
| C5 | A network observer cannot read the state | Phase 1 (encryption default), Phase 4 (review) |
| C6 | One external dapp adopts the SDK | Phase 5 |

---

## Phase 0 — Validation spikes

**Goal.** Find out whether the idea works as described, and lock the choices everything else depends on.

**Work.** Three independent spikes, protocols in `SPIKES.md`. Each is a script under `spikes/` plus a `RESULTS.md`.

- **S1 Key derivation.** Design the domain-bound derivation message; test signature determinism across wallets; decide what happens to smart-account users.
- **S2 Latency.** Measure feed write and read-latest times through the paths a real dapp would use.
- **S3 Funding.** Run both funding modes end to end on testnet; check the current state of gateway-proxy, bee-js 13, and browser write paths.

**Deliverables.** Three `RESULTS.md` files. A derivation spec draft in `ARCHITECTURE.md`. A wallet compatibility matrix. Latency numbers with p50/p95.

**Gate.**
- Go / no-go on the idea, written at the top of this file.
- D1 (derivation message), D2 (wallet set and smart-account policy), D3 (default funding mode), D4 (batch type), D5 (latency thresholds), D8 (relation to swarm-id), D10 (bee-js pin), D12 (batch owner key and client-side stamping), D13 (browser-first) closed.
- Gate outcome written back into IDEA-190 as a comment, so the canvas and the code do not drift.

**Size.** Days per spike. S2 needs a Sepolia light node running for a day; start it first.

**S1 outcome (2026-09-03).** Done: derivation message, Node and library determinism, MetaMask and Rabby matrix, cross-wallet portability, D8 reading. Not run: Coinbase Wallet, WalletConnect mobile, Ledger, the Safe/passkey trial (step 5). Result: the sign-in identity can derive a stable storage key with one wallet signature, in every wallet and library tried. D1, D2, D8 closures drafted in `DECISIONS.md`, awaiting Peter. The remaining wallets move to Phase 3, where the demo runs against them. Gate for Phase 0 stays open on S2 and S3.

---

## Phase 1 — Core SDK (M0)

**Goal.** The smallest library that turns a wallet signature into readable, writable, encrypted state on Swarm.

**Work.**
- `derive`: derivation signature → seed → feed signing key + encryption key (per D1).
- `envelope`: encrypt and frame a state value; inline when it fits a feed payload, otherwise upload the blob with Swarm encryption and put the reference in the feed.
- `slot`: `get`, `set`, and `watch` on one named piece of state, over a sequential feed owned by the derived key.
- One Bee endpoint supplied by the dapp; single writer; no funding logic (writes use a stamp the caller supplies).
- Unit tests with a mocked Bee; integration tests against bee-factory.

**Out of scope for M0.** Funding flows, multi-device conflict handling, cross-dapp discovery, React bindings.

**Deliverables.** `packages/dappdata` with the public API in `ARCHITECTURE.md` implemented; CI running unit and bee-factory tests; a `README` that shows the integration in under 15 lines.

**Gate.**
- C1 is testable: the README example runs against bee-factory.
- C5 holds on the wire: a test reads the raw feed chunk and finds ciphertext only.
- D9 (encryption scheme) closed.

**Size.** The plumbing exists in bee-js; expect the effort to go into the derivation edge cases and the envelope format.

---

## Phase 2 — Funding flows

**Goal.** Writes get paid for the way a deployed dapp would pay for them.

**Work.**
- **Mode A, proxy.** A `funding.proxy(url)` adapter that routes writes through a gateway-proxy deployment; `infra/proxy/` holds a working config against bee-factory and against a Sepolia node.
- **Mode B, sponsored batch.** A `funding.batch()` adapter: the user owns an immutable batch; helpers for purchase, `topUp` by a sponsor address, and TTL monitoring with a warning threshold.
- Both adapters behind one `Funding` interface so the dapp changes one line to switch.

**Deliverables.** Both modes runnable from a script, on bee-factory and on Sepolia. A short `docs/FUNDING.md` for dapp developers: which mode, when, and what it costs.

**Gate.**
- C4: both modes demonstrated end to end on Sepolia.
- Proxy abuse controls from `THREATS.md` (T7) are in the proxy config, not left as advice.

**Why before the demo.** The demo is only convincing if its writes are funded like a real deployment's, not hand-stamped from a dev batch.

---

## Phase 3 — Reference dapp and cross-device restore

**Goal.** Prove C2 and C3 in a browser, with real wallets.

**Work.**
- `apps/demo`: SIWE sign-in, one or two state slots (preferences, a draft). Funding per D3(d): user pays, with a "sponsor this user" switch that plays the dapp operator. The preferences slot goes through the one adapter Phase 3 ships (D14): a plain key-value / zustand-style persistence adapter, so the demo shows both the explicit slot API and the "swap one line" adoption path.
- `packages/dappdata-adapter-kv` (name to settle): the adapter above, under a hundred lines. Its size is a check on the core API.
- The restore path: mutate state, open a fresh browser profile, sign in, watch the state return.
- Instrumentation: restore time, read-latest time, time until a second client sees a write. Reported in the UI and logged.
- First honest test of the derivation UX: the extra signature prompt at sign-in and how the dapp explains it.
- Optional: `packages/dappdata-react` with `useSlot` if the demo makes the hooks obvious.

**Deliverables.** Deployed demo (Swarm-hosted if practical); a `docs/UX.md` note on the signature prompt with the wording we settled on.

**Gate.**
- C2 passes with MetaMask and at least one other wallet from the D2 set.
- C3 numbers from the browser fall within the D5 thresholds, or D5 is revised with a reason.

---

## Phase 4 — Hardening and conventions

**Goal.** Make the SDK safe to hand to someone we do not control.

**Work.**
- **Multi-device writes (D6).** Sequence discipline first: read the latest index before writing, detect a lost race, retry or surface a conflict. Then decide whether per-device feeds with a merge step, or a CRDT layer reusing the Yjs-over-feeds work in swarm-collaborative-docs, is worth adding. Ship the simple thing; keep the CRDT layer separable.
- **Namespace and discoverability (D7).** Settle the topic convention and whether a second dapp, or the user on another dapp, can find state written under a derived key from the main address alone. Options: per-dapp isolation as a privacy feature; a mapping feed the user publishes; a registry convention. This closes before Phase 5 because changing it later breaks every adopter.
- **Security review.** Adversarial pass over `THREATS.md`: phishing surface of the derivation message, envelope and nonce handling, key lifetime in memory, proxy abuse. Fix or document each item.
- **Key loss.** No recovery is acceptable; the SDK must say so in its docs and give the dapp a hook to warn users. Add a versioned derivation message so a future change gets a migration path instead of orphaning state.

**Deliverables.** Version 0.x on npm behind the chosen scope; `THREATS.md` with every item resolved or accepted; `docs/CONVENTIONS.md` for topic naming.

**Gate.**
- D6, D7 closed.
- Every `THREATS.md` item has a status.
- A second Claude session, given only the docs, can integrate the SDK into a toy dapp without asking a question. (Cheap proxy for C1 and for the docs.)

**Size.** The long tail. Hard to bound until S1 and S2 results are in, which is why they come first.

---

## Phase 5 — Adoption and extensions

**Goal.** C6, plus the extensions the canvas kept separable.

**Work.**
- Docs site or README of record; examples; announce in Swarm channels.
- Recruit one external dapp and support the integration.
- Tracked separately, each its own issue: recordstore as the structured or transactional layer (IDEA-166 convergence); reuse of IDEA-176's sponsored-batch mechanics if that idea advances; the smart-account fallback from S1.

**Gate.** One external dapp in production or public beta with dappdata state.

---

## Cross-cutting

**Testing.** Unit tests mock Bee. Integration tests run against bee-factory in CI. End-to-end tests for the demo use a test signer that implements EIP-1193 with a fixed key, so CI never needs a browser wallet. Nothing in CI touches Sepolia or Gnosis.

**Environments.** bee-factory for development and CI; Sepolia for anything that needs a real network and real stamps; Gnosis only for the funding rehearsal in Phase 2 and the demo, with Peter's confirmation each time.

**Docs.** `ARCHITECTURE.md` changes in the same commit as the code it describes. `DECISIONS.md` gets an entry before any lasting choice. Phase gates are recorded here, dated.

**Jira.** IDEA-190 gets a comment at each gate. When the idea graduates from the Ideabox, each phase becomes an epic in SpDevTeam; the gates become the epic's done criteria.

## Sizing

Phase 0: days per spike, in parallel where wallets allow. Phases 1–3 together are the canvas's "small prototype". Phase 4 is the bulk of the real effort and the part we cannot size yet. Phase 5 depends on finding an adopter.

## Revision notes (vs. the chat draft)

- Added checkable success criteria C1–C6 and mapped each to the phase that proves it.
- Every phase now has an explicit gate and names the decisions it closes; a pre-seeded decision log (`DECISIONS.md`) replaces the loose "open questions".
- Local development moved to bee-factory: Bee 2.8.1 removed `bee dev` mode. Testnet named as Sepolia.
- bee-js 13.0.0 flagged: it is newer than the version the Swarm skill documents; pinning is now the first task.
- swarm-id (snaha/swarm-id) added as prior art to examine in S1 (D8): it already derives app-specific secrets from a browser master identity with cross-app isolation. The plan must decide whether dappdata builds on it, interoperates, or stays SIWE-native and independent.
- S1 now also tests cross-wallet portability (same seed in two wallets) and names the smart-account fallback as a written decision, not a "later".
- S2 gets proposed numeric thresholds (D5) so "interactive" is something the demo can pass or fail.
- Phase 2 gains a single `Funding` interface and proxy abuse controls; Phase 4 gains a versioned derivation message for migrations.
- Added a testing and environments section, and the rule that CI never touches a real network.
- Added the Jira write-back at each gate.
