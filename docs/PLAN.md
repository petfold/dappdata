# Development plan

Status: plan approved 2026-09-03. **Phase 0 gate: GO, confirmed by Peter 2026-09-21. Phase 1 gate: passed, signed off by Peter 2026-09-21. Phase 2 started.**

**Go / no-go.** Go. The three risky assumptions held up. One wallet signature over a fixed EIP-712 message derives a stable storage key: deterministic across 20 signatures, page reloads and wallet restarts, identical in MetaMask and Rabby and in three signing libraries (S1). Someone can pay without the dapp running a server: a payer created a batch owned by the user's derived key, the derived key stamped writes in the client, a Bee node holding no funds accepted them from Node and from a browser page, and top-ups need no owner permission (S3). Latency suits interactive use once the SDK keeps the feed index: reads by index take 10–300 ms, first-time reads 2–5 s, and updates are visible across mainnet gateways in about 2 s (S2). Two findings shape Phase 1 more than expected: Bee's feed lookup costs 2–5 s everywhere, so the index cache is core rather than an optimisation; and a reused stamp slot destroys the earlier chunk on immutable batches too, so stamper state is part of the user's stored metadata from day one. Left open on purpose: Coinbase Wallet, WalletConnect and Ledger in the matrix (Phase 3), the mode A autobuy check (dropped with mode A), and a repeat of the slot-reuse test on mainnet (Phase 2). Decisions D1, D2, D8, D10 closed 2026-09-03/04; D3, D4, D5, D12, D13 closed 2026-09-21.

See *Revision notes* at the end for what changed since the chat draft.

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
| C4 | Funding works without a server: sponsor pays or user pays, one code path, user-owned batch (D3) | Phase 2 |
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
- D1 (derivation message), D2 (wallet set and smart-account policy), D3 (default funding mode), D4 (batch type), D5 (latency thresholds), D8 (relation to swarm-id), D10 (bee-js pin), D12 (batch owner key and client-side stamping), D13 (browser-first) closed. Status 2026-09-21: all nine closed.
- Gate outcome written back into IDEA-190 as a comment, so the canvas and the code do not drift.

**Size.** Days per spike. S2 needs a Sepolia light node running for a day; start it first.

**S1 outcome (2026-09-03).** Done: derivation message, Node and library determinism, MetaMask and Rabby matrix, cross-wallet portability, D8 reading. Not run: Coinbase Wallet, WalletConnect mobile, Ledger, the Safe/passkey trial (step 5). Result: the sign-in identity can derive a stable storage key with one wallet signature, in every wallet and library tried. D1, D2, D8 closed in `DECISIONS.md` (Peter, 2026-09-03). The remaining wallets move to Phase 3, where the demo runs against them. Gate for Phase 0 stays open on S2 and S3.

---

## Phase 1 — Core SDK (M0)

**Goal.** The smallest library that turns a wallet signature into readable, writable, encrypted state on Swarm.

**Work.**
- `derive`: entropy source → secret → seed bound to the app identity → feed signing key, encryption key, sub-keys (D1, D15, D16, D17, D21). Sources in M0: wallet signature and mnemonic (D21).
- `envelope`: encrypt and frame a state value; inline when it fits a feed payload, otherwise upload the blob with Swarm encryption and put the reference in the feed. The frame carries a schema byte (D22); frame and crypto are a pure module reusable with any key (D20).
- `slot`: `get`, `set`, and `watch` on one named piece of state, over a sequential feed owned by the derived key. `set` takes `expectIndex` and a `merge` callback (D6); `get` returns the schema and runs `migrate` (D22).
- A transport supplied by the dapp: the default HTTP transport or the caller's own (D18); single writer; no funding logic (writes use a stamp the caller supplies).
- The D2 contract-account check, with the EIP-7702 delegation designator treated as an EOA (D25).
- Unit tests with a mocked Bee; integration tests against bee-factory.

**Out of scope for M0.** Funding flows, merge strategies beyond expect-index (D6), cross-dapp discovery, React bindings.

**Deliverables.** `packages/dappdata` with the public API in `ARCHITECTURE.md` implemented; CI running unit and bee-factory tests (`.github/workflows/ci.yml`: unit, typecheck and build on every push; the bee-factory job runs on demand, since the cluster takes minutes to warm up); a `README` that shows the integration in under 15 lines.

**Gate.**
- C1 is testable: the README example runs against bee-factory.
- C5 holds on the wire: a test reads the raw feed chunk and finds ciphertext only.
- The spec decisions that fix the derivation and the frame are closed **before the code**, not at this gate: D9, D15, D16, D17, D20 (direction), D21 (mnemonic source) and D22, all confirmed by Peter 2026-09-21. The gate checks that the code matches them.
- D18 closes here: Phase 1 ships the `Transport` interface over bee-js 13 and measures a `fetch` transport on core-sdk; the gate records its size and names the default.

**Size.** The plumbing exists in bee-js; expect the effort to go into the derivation edge cases and the envelope format.

**Gate: passed, signed off by Peter 2026-09-21.** The checks below all hold; the decisions this phase owned are closed; `packages/dappdata` is the M0 SDK. Phase 2 may start.

**Gate check, 2026-09-21 (run against bee-factory, Bee 2.8.2).** C1: the README example runs as an integration test on a real node and restores on a second, freshly derived instance (C2 in miniature). C5: an integration test reads the raw feed chunk off the node and finds ciphertext, with neither the value nor its keys in it, for both transports. D18 closed: the `fetch` transport is the default, bee-js is an optional peer behind `dappdata/transport/bee-js`. The run found two things the mocked tests could not: a chunk is unreadable for about a second after upload, and Bee answers "missing" and "unreadable" identically (T18) — the feed now serves its own last write from memory, and the conflict probe is documented as a positive signal only. Both halves are reported upstream (ethersphere/bee#5624, ethersphere/bee-js#1263).

**Carried into later phases, named so they are not lost.** D9's encryption has had no second pair of eyes; the Phase 4 review is where that belongs. D14's API half is settled by the shipped surface, its adapter half waits for the Phase 3 demo. D21's passkey half and D20's public envelope module are Phase 2 and Phase 4 as planned. The T18 window stays open until D19.

**Progress, 2026-09-21.** `packages/dappdata` has `derive`, `entropy` (wallet and mnemonic), `siwe`, `envelope`, `transport` (bee-js, fetch, in-memory), `feed` and `slot`, with `DappData.connect` over them. 46 unit tests run against a mocked Bee, plus a typecheck and a build; the README example runs as a test, including the fresh-device restore (C2 in miniature). The v1 derivation is pinned by a golden vector. The D18 measurement is done and recorded in `DECISIONS.md`: the fetch transport is 120 lines and 26 KB gzipped against bee-js's 167 KB, so it becomes the default once it has passed the bee-factory run. Left for the gate: that integration run (a mainnet Bee holds port 1633 on this machine, so bee-factory needs it free), and C5 checked on a real node rather than in memory.

---

## Phase 2 — Funding flows

**Goal.** Writes get paid for the way a deployed dapp would pay for them.

**Work.** *(Rewritten 2026-09-21: D3 closed with no stamping proxy in the SDK, so the two-adapter shape this section used to describe is gone. One funding path, one `Funding` interface.)*
- **One path: the user owns the batch, anyone pays (D3, D12).** `funding.fund()` calls `createBatch(owner = the derived storage key)` from whatever payer the dapp supplies — the user's wallet, the operator's key, a sponsor — and `funding.topUp()` extends any batch without the owner's permission. The same code either way.
- **Health and warning (D3, D23).** `funding.health(batch)` turns TTL into days left and a `usable` flag; the SDK warns below a threshold; writes queue while a fresh batch is not yet usable, about two minutes on Sepolia.
- **Granularity (D23).** `fund()` sizes depth and amount from a declared write budget (writes per day, retention days) including the D19 safety margin; `docs/FUNDING.md` says plainly that each app brings its own batch and that a sponsor can top up any of them.
- **Stamper as a service (D19).** `stamper(batchId)` for the SDK and for other libraries; bucket state checkpointed to a reserved slot, restored and advanced past a safety margin on a new device; a test that a second device never reuses a slot. This is also what closes T18's write-write window.
- **Passkey entropy source (D21, D25).** `entropy.passkey()` over WebAuthn PRF, with an evaluation of PRF-only derivation against PRF unlocking an encrypted seed kept on Swarm; the choice closes D21's passkey half.

**Deliverables.** Sign-in to funded-and-writing runnable from a script, on bee-factory and on Sepolia, with the payer a different key from the owner. A short `docs/FUNDING.md` for dapp developers: who pays, what it costs, and what the user is left holding.

**Gate.**
- C4: user-pays and sponsor-pays both demonstrated end to end on Sepolia, through one code path.
- A second device restores stamper state and writes without reusing a slot, proven against bee-factory.
- D19, D23 closed; D21's passkey half closed (D25; landed 2026-09-22, `spikes/phase2/passkey/RESULTS.md`); T12, T15 and T18 have a status.

**Gate run, 2026-09-21: passes** (`spikes/phase2/RESULTS.md`, log in `spikes/phase2/results/`). On Sepolia, against Bee 2.8.2: a sponsor bought a batch owned by a key derived from a signature and holding nothing; the same call with a different signer had the user pay for their own; a slot was stamped by the owner key and uploaded to a node holding no batch, then read back by a freshly derived instance; two devices sharing one checkpoint took disjoint slots in one bucket; and the sponsor extended a batch it does not own, 24 h to 48 h. The run found five defects, all fixed with regression tests — the worst being that two devices *did* collide on the first attempt, because the stamper extended a reservation from its own stale copy of the state.

**Not yet met on 2026-09-21, so the gate stayed open:** D21's passkey half was unwritten, and D19's slot-backed checkpoint store could not stamp itself. Both landed on 2026-09-22 (the D19 and D21 entries), as did D27 (client-stamped blobs) and the budget sizing for them.

**Gate signed off by Peter, 2026-09-22.** D19, D21, D23 and D27 closed. Carried forward, named: the two-device visibility window (D6, quantified per network), the wrapped folder seed (D28), the repository's home and npm name (D26), the mainnet two-device test and the independent review (Phase 4 gate). Phase 3 may start.

**D19 lookahead landed 2026-09-22:** the slot-backed store is the default and stamps its own checkpoint; a checkpoint race between two devices is detected through `expectIndex` and retried from the winner's lines (D19 entry). `spikes/phase2/src/d19.mjs` repeated the two-device test on Sepolia with no store supplied: the self-stamping store and the network restore work; the interleaving collided inside a visibility window measured at 50–60 s on Sepolia (`spikes/phase2/RESULTS.md`, "D19 closure run"), which moves the residual to D6 with numbers. The same run found that every warm read and write paid a 3.6–9 s retrieval miss, now bounded by the transport's probe timeout (D5 note).

**Added by the IDEA-198 review (2026-09-22), same phase:** the dual-key restore that `entropy/wallet.ts` promised in a comment is **resolved by amending D1** the same day: typed data is required, the `personal_sign` fallback is an explicit opt-in that opens a separate folder, and no restore across the two is owed. Blob writes under a client-side stamp (D27) landed the same day: the sealed value is chunked client-side and every chunk stamped.

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
- **Empty-state fast path** (IDEA-198, Q6). Learning that a feed does not exist costs about 3.6 s, the missing-chunk retrieval timeout, on a mainnet light node. The demo shows a first-run state at once and fills it in when `get()` resolves; `docs/UX.md` records the pattern. The same note owes a paragraph on the per-app batch (D23): what a user sees when a second dapp needs a second batch, and what a sponsor sees.
- Wallet matrix additions (D25): one embedded-wallet provider (Privy or Dynamic) and one EIP-7702 upgraded MetaMask account, both checked for determinism and for the D2 check.
- Optional: `packages/dappdata-react` with `useSlot` if the demo makes the hooks obvious.

**Deliverables.** Deployed demo (Swarm-hosted if practical); a `docs/UX.md` note on the signature prompt with the wording we settled on; `docs/SWARM-HOSTED.md`, an integration guide for dapps served from a Swarm gateway (hash routing, gateway origins, no response headers, app binding per D16, subdomain gateways per T15).

**Gate.**
- C2 passes with MetaMask and at least one other wallet from the D2 set.
- C3 numbers from the browser fall within the D5 thresholds, or D5 is revised with a reason.

---

## Phase 4 — Hardening and conventions

**Goal.** Make the SDK safe to hand to someone we do not control.

**Work.**
- **Multi-device writes (D6).** M0 ships expect-index and `merge`; Phase 4 decides whether per-device feeds with a merge step are needed. The CRDT layer is swarm-collaborative-docs with the D20 envelope and a D17 sub-key, not code here.
- **Crypto for other libraries (D20).** Publish `dappdata/envelope`; land the encryption hook in swarm-collaborative-docs (Solar Punk owns it) so a dapp encrypts shared documents in the same format; optional ENS contenthash check for app binding (T14).
- **Namespace and discoverability (D7).** Settle the topic convention and whether a second dapp, or the user on another dapp, can find state written under a derived key from the main address alone. Options: per-dapp isolation as a privacy feature; a mapping feed the user publishes; a registry convention. This closes before Phase 5 because changing it later breaks every adopter.
- **Security review.** Adversarial pass over `THREATS.md`: phishing surface of the derivation message, envelope and nonce handling, key lifetime in memory, proxy abuse. Fix or document each item. **An independent reader** from outside the project goes over `derive/`, `envelope/` and `stamper/` with `THREATS.md` as the checklist before any 0.x reaches an external adopter (IDEA-198 condition 2); who arranges it follows from D26.
- **Mainnet two-device slot test** (IDEA-198 condition 1). Repeat the Phase 2 two-device test on Gnosis mainnet with a depth-17 immutable batch: disjoint slots from a shared checkpoint, and a deliberately reused slot replacing the earlier chunk on mainnet storers as it did on Sepolia. Needs a mainnet batch, so Peter confirms first (working rule 4).
- **`docs/CONVENTIONS.md`** is written so file-manager-lib and swarm-collaborative-docs can adopt the topic scheme too (`<library>/<version>/<scope>/<name>`, hashed, version mandatory); the study found three Solar Punk-adjacent libraries with three schemes.
- **Key loss.** No recovery is acceptable; the SDK must say so in its docs and give the dapp a hook to warn users. Add a versioned derivation message so a future change gets a migration path instead of orphaning state.

**Deliverables.** Version 0.x on npm behind the chosen scope; `THREATS.md` with every item resolved or accepted; `docs/CONVENTIONS.md` for topic naming.

**Gate.**
- D6, D7 closed; D26 closed and the npm name registered.
- The independent review is done and every finding is fixed or accepted in `THREATS.md`.
- The mainnet two-device slot test passes.
- Every `THREATS.md` item has a status.
- A second Claude session, given only the docs, can integrate the SDK into a toy dapp without asking a question. (Cheap proxy for C1 and for the docs.)

**Size.** The long tail. Hard to bound until S1 and S2 results are in, which is why they come first.

---

## Phase 5 — Adoption and extensions

**Goal.** C6, plus the extensions the canvas kept separable.

**Work.**
- Docs site or README of record; examples; announce in Swarm channels. `docs/GUIDE.md` and `docs/REFERENCE.md` exist since 2026-09-22 and are kept current by working rule 3; the Phase 4 review decides whether a generated reference (TypeDoc) replaces the hand-written one.
- Recruit one external dapp and support the integration.
- **Candidate first adopter: swarmtyp** (Solar Punk, `../swarmtyp`, a collaborative Typst editor served from Swarm). Its plan already puts identity and the per-user project list on dappdata in its Phase 3, about six to eight weeks after 2026-09-05. It would exercise what the demo cannot: D16 (an app with no origin of its own), D17 (a key for swarm-collaborative-docs), D19 (a snapshot every few seconds), D6 (two devices on one list), T15 (a shared gateway origin). swarmtyp's D-23 (2026-09-05) plans three identity roots behind one interface, device key, mnemonic and wallet, with the device key as the default for users without a wallet; from dappdata it needs the mnemonic source of D21 built rather than listed, and D16's declared app identity accepted by `derive`, before its Phase 3.
- **File Manager** (IDEA-198, finding T-b). file-manager-lib's `feat/swarm-id` branch has an `interface SwarmClient` seam with `BeeClient` and `SnahaClient` implementations; a `DappDataClient` over the dappdata transport, stamper and `deriveKey` would make the wallet a third identity root for the File Manager, restoring its `filemanager-state` feed on any device with the wallet. After SPDV-1500 lands the seam on master, not before and not inside the Swarm ID MVP; whether the File Manager wants a wallet root at all is a product decision nobody has recorded. The inverse shape, `entropy.swarmId(client)` (D21 note, P3), brings swarm-id's passkey users to dappdata and leaves the File Manager untouched.
- Tracked separately, each its own issue: recordstore as the structured or transactional layer (IDEA-166 convergence; a slot value can carry a recordstore root inline, the open point is whether the recordstore's feed bump becomes the slot write or the slot points at a second feed); reuse of IDEA-176's sponsored-batch mechanics if that idea advances; the smart-account fallback from S1.

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
- 2026-09-05, review from the swarmtyp side: D15–D23 added as open items; THREATS T12–T16; Phase 1 and 2 gates extended; Phase 3 gains the Swarm-hosted integration guide; Phase 5 names swarmtyp as first adopter candidate. The review note `issues.txt` is folded into D15 and D23 and removed.
- 2026-09-06, convergence assessment: `docs/CONVERGENCE.md` and `docs/PROPOSAL-swarm-id.md` added; D24 opened. Phase 1 spec adopts swarm-id's KDF primitive, canonicalisation and sub-key shape whatever the swarm-id team answers.
- 2026-09-06, ecosystem identity review: D25 opened, T17 added. The D2 check learns EIP-7702; the passkey PRF source moves to Phase 2; Phase 3 matrix gains an embedded wallet and a 7702 account.
- 2026-09-22, Solar Punk's feasibility study IDEA-198 (`docs/REVIEW-IDEA-198.md`): D26 and D27 opened; Phase 2 gains the dual-key restore and client-stamped blobs; Phase 3 the empty-state path and the batch UX note; Phase 4 the independent reader, the mainnet two-device test and a shareable `CONVENTIONS.md`; Phase 5 the File Manager `SwarmClient` adapter. T12 cites Bee source; T18 marked environment-dependent.
