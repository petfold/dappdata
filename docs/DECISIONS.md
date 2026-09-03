# Decision log

One entry per choice with lasting effect. Format: context, options, decision, consequences, who and when. A decision is **open** until Peter, or a spike result Peter has seen, closes it. Code that embodies a decision names the D-number in a comment.

Add new entries at the end. Do not renumber.

---

## D0 — Scope: compose, do not extend
**Status:** closed (canvas, 2026-09-03)
**Decision.** No protocol changes, no Bee fork. dappdata composes feeds, postage stamps, encryption, ACT, and existing tooling (gateway-proxy, bee-factory).
**Consequences.** Anything that needs a Bee change is out of scope and goes back to IDEA-190 as a note.

## D1 — Derivation message and signing method
**Status:** open — closes in S1
**Context.** Wallets cannot raw-sign feed updates. The storage key must come from a signature over a fixed message.
**Options.** (a) EIP-712 typed data via `eth_signTypedData_v4`, origin-bound; (b) `personal_sign` over a text message; (c) both, typed data preferred with text fallback.
**Leaning.** (c). Typed data shows the user structured fields; some wallets still lack it.
**Consequences.** The message is part of the key. Its `scope` field is the version; changing anything else changes every user's key.

## D2 — Supported wallets and smart-account policy
**Status:** open — closes in S1
**Context.** Deterministic ECDSA (RFC 6979) holds for MetaMask and hardware wallets; ERC-1271 contract wallets and passkey wallets cannot give a deterministic secp256k1 signature.
**Options for contract accounts.** (a) Refuse with a clear message; (b) dapp-held escrow key, released after SIWE; (c) session key registered on the account.
**Leaning.** (a) for v1, with the fallback direction recorded here so Phase 5 can pick it up.
**Consequences.** Some users cannot use dappdata in v1. The SDK must detect this before asking for a signature.

## D3 — Default funding mode
**Status:** open — direction set by Peter (2026-09-03); closes in S3
**Context.** The original options conflated two questions: who *owns* the batch and who *pays* for it. The postage contract's `createBatch` takes an owner address separate from the payer, and `topUp` is permissionless, so they are independent.
**Options.** (a) Proxy stamping as default, batch as advanced; (b) user-owned batch as default, proxy as advanced; (c) no default, dapp must choose; (d) **user owns, anyone pays**: the batch owner is always the user (see D12), and the payer is the user, a sponsor, or the dapp operator, through the same code path.
**Direction.** (d). The user's folder must outlive any one dapp, so the user holds the lease. Sponsorship by the dapp operator is the onboarding ramp, not a separate mode. The stamping proxy (mode A) survives only if S3 shows client-side stamping (D12) does not work; otherwise it goes.
**Onboarding notes (Peter).** Getting BZZ and xDAI is a Swarm-wide problem and several multichain funding solutions exist already; the SDK should plug into one rather than solve it. Funding is slow, so the flow starts at the *beginning* of the user's interaction with the dapp (in the background, right after sign-in) so that it has completed by the time the first write happens. Writes queue locally until the batch is usable.
**Still to settle in S3.** Which multichain funding path to integrate first; how the SDK behaves while a batch is pending (queue, warn, or block); what the demo shows on first run.
**Consequences.** Determines what the demo shows first and what the README teaches. Funding UX (background purchase, pending-batch queue) becomes Phase 2/3 work. ARCHITECTURE's funding section is rewritten when S3 closes this and D12.

## D4 — Postage batch type
**Status:** open — closes in S3 (expected: immutable required)
**Context.** Mutable batches overwrite old chunks when full, which corrupts feeds.
**Decision expected.** The SDK refuses to use a mutable batch and says why. S3 records the actual failure mode to quote.

## D5 — Latency thresholds for "interactive"
**Status:** open — closes in S2
**Proposed.** Cold read-latest p95 ≤ 5 s. Warm read-latest p95 ≤ 2 s. Cross-client visibility p95 ≤ 30 s.
**Consequences.** If the numbers miss, Phase 1 gains a local cache and `watch` uses a longer interval; the docs state the visibility window plainly.

## D6 — Multi-device write strategy
**Status:** open — closes in Phase 4
**Options.** (a) Read-before-write with retry and a conflict callback; (b) one feed per device plus a merge step on read; (c) a CRDT layer reusing swarm-collaborative-docs (Yjs over feeds).
**Leaning.** (a) shipped; (c) as an optional package if a real use case needs it.
**Consequences.** (b) changes the storage layout; decide before any adopter.

## D7 — Topic namespace and cross-dapp discoverability
**Status:** open — closes in Phase 4, before any external adopter
**Context.** Origin-bound derivation gives each dapp its own feed owner. Good for privacy; a second dapp cannot find the user's state from the main address.
**Options.** (a) Per-dapp isolation as a feature, no discovery; (b) a user-published mapping feed (owned by a key derived without the origin) listing slots per dapp; (c) a registry convention.
**Consequences.** Breaking to change later. Must be settled before Phase 5.

## D8 — Relationship to swarm-id (snaha/swarm-id) and IDEA-176
**Status:** open — closes in S1
**Context.** swarm-id is a work-in-progress browser master identity for Swarm dapps: it derives app-specific secrets, signs feed updates, and isolates apps from each other. That overlaps dappdata's derivation layer. IDEA-176 (Swarm ID core storage) is the Foundation-side identity substrate.
**Options.** (a) Build dappdata's derivation on swarm-id; (b) stay independent and SIWE-native, but align topic and isolation conventions so state is portable later; (c) independent, no alignment.
**Leaning.** (b). SIWE is the identity users already have; swarm-id's model is worth matching where cheap.
**Consequences.** Decides whether derivation is our code or a dependency.

## D9 — Encryption scheme
**Status:** open — closes in Phase 1
**Options.** (a) AES-256-GCM via WebCrypto with the derived key, topic as AAD; (b) Swarm built-in encryption only (64-byte references) with the reference stored in the clear; (c) ACT.
**Leaning.** (a) for inline payloads, (a)+(b) for blobs. (b) alone leaks the reference to anyone who can read the feed. (c) has no role while there is one reader.

## D10 — bee-js version pin
**Status:** closed (changelog check, 2026-09-03)
**Context.** 13.0.0 (released 2026-08-25) is the latest on npm; the Swarm skill and most examples describe 12.x.
**What changed in 13.0.** Two breaking refactors, no protocol-level change:
1. *Namespaced API* (#1219). Methods moved off `bee.*` into namespaces: `bee.feed.makeReader / makeWriter / fetchLatestUpdate / createManifest`, `bee.soc.makeReader / makeWriter`, `bee.stamp.create / topUp / dilute / get / getGlobal`, `bee.chunk.upload / download`, `bee.data`, `bee.file`, `bee.collection`, `bee.grantee`, `bee.pin`, and so on. A codemod ships in the package (`bee-js-codemod`) for 12→13 migration.
2. *Primitives moved to `@ethersphere/core-sdk`* (#1236; published as `core-sdk`, not the `swarm-core` name the PR mentions). `PrivateKey`, `PublicKey`, `EthAddress`, `Topic`, `Identifier`, `FeedIndex`, `BatchId`, `Reference`, `Signature`, `Bytes`, SOC and CAC builders, BMT, Mantaray, and the **`Stamper`** now live in core-sdk 0.1.1 and are re-exported from bee-js. core-sdk does no network I/O and runs in the browser.
Feeds and SOCs work as documented: sequential feeds via `makeWriter(topic, signer)` and `fetchLatestUpdate`; the feed signer is a `PrivateKey`, so the derived key (D1) plugs straight in. Supported Bee is 2.8.1, API 8.1.0.
**Relevant to D12.** Client-side stamping exists: `Stamper.fromBlank(signer, batchId, depth).stamp(chunkAddress)` returns an `EnvelopeWithBatchId`; bee-js sends it as the `swarm-postage-stamp` header instead of `swarm-postage-batch-id`. `bee.chunk.upload` is typed to accept an envelope. The SOC and feed upload paths are typed `BatchId` only, though the header code accepts an envelope at runtime; S3 tests whether a feed update can be uploaded with an envelope (cast, or build the SOC with core-sdk and upload via `bee.chunk.upload`). `bee.stamp.create` waits up to 240 s for a new batch to become usable, which is the order of delay D3's "start funding at sign-in" must hide.
**Decision.** Pin `@ethersphere/bee-js` **13.0.0 exact** and `@ethersphere/core-sdk` **0.1.1 exact** as a direct dependency (we use `Stamper`, SOC builders, and typed bytes directly). Bump only by an entry here. Reasoning: 13 is where the API is going, the codemod exists so examples written for 12 translate mechanically, and core-sdk is exactly the browser-side primitive layer dappdata needs. Risks: 13.0.0 is nine days old and core-sdk is 0.1.x, so expect point releases; S1 and S2 will surface any breakage early, while the code is still throwaway.
**Consequences.** Any 12.x snippet from the Swarm skill or docs must be translated to the namespaced form before use. ARCHITECTURE's dependency list gains core-sdk.

## D11 — Name, npm name, repo structure
**Status:** closed (Peter, 2026-09-03)
**Decision.** Project, repo, and package name `dappdata`, published **unscoped** on npm (free at handoff; register it early). pnpm monorepo with `packages/`, `apps/`, `spikes/`, `infra/`. The EIP-712 domain name, HKDF info strings, and topic prefix all use `dappdata` (see ARCHITECTURE); they are part of the derived keys, so the name must not change after the first real user.
**Reasoning.** Names the thing users care about — their data in the dapp — and mirrors the per-user application-data folder every OS provides (`AppData`, `~/.local/share`).
**Alternatives considered.** `hatcheck` (regional idiom), `kitbag`, `belongings`, `owndata`, `savefile`, `leftoff`; `locker`, `roaming`, `appdata` (taken unscoped).

## D12 — Batch owner key and where stamping happens
**Status:** open — closes in S3
**Context.** Postage stamps are secp256k1 signatures by the batch owner. A browser wallet cannot raw-sign, so a batch owned by the user's EOA cannot be stamped in the browser. The derived storage key (D1) can sign anything.
**Proposal.** The batch owner is the **derived storage key's address**. The SDK signs stamps in the browser (bee-js `Stamper`, Bee envelope / pre-stamped upload path) and uploads pre-stamped chunks to any Bee HTTP endpoint. The endpoint holds no batch and no funds, so there is nothing to drain (THREATS T7 becomes moot) and the endpoint can be any public node or the dapp operator's node.
**Verify in S3.** (1) bee-js 13 exposes client-side stamping and pre-stamped chunk upload; (2) a Bee 2.8 node with zero batches accepts pre-stamped chunks; (3) `createBatch` from a payer wallet with `_owner` = derived address, then stamping with the derived key, works end to end on Sepolia; (4) a browser page can do the upload cross-origin (CORS).
**Consequences.** If it works, funding needs no operated stamping component and D3(d) is the whole story. If not, fall back to a Bee node that owns the batch, which reintroduces an operator role.

## D13 — Browser-first, with Node for spikes and tests
**Status:** open — closes at the Phase 0 gate; direction set by Peter (2026-09-03)
**Context.** The plan targets the browser (C2), but the spikes are Node scripts. Retrofitting browser support later is where polyfills and second code paths appear.
**Direction.** Phase 0 spikes stay in Node. From Phase 1 the SDK uses only primitives that exist in both browser and Node: WebCrypto, an EIP-1193 provider, bee-js, `@noble/*`. No Node-only modules in `packages/dappdata`. Tests run in Node against bee-factory.
**The write path.** Today every write needs an HTTP Bee endpoint someone runs; weeb-3 is retrieval-only at handoff. Peter notes weeb-3 is adding or planning write support, and other in-browser nodes are in the pipeline (including Freedom Browser's attached ant node). So the SDK's Bee endpoint must be an interface, not a URL: HTTP node today, in-browser node when one exists. The minimum operator footprint today is one Bee node with API exposed and CORS set; under D12 that node holds no funds.
**Consequences.** `bee: { url }` in the API sketch becomes a transport abstraction. S3 records the status of weeb-3 writes and any in-browser node so Phase 2 can size the work.

## D14 — Integration surface: how much must a dapp know about dappdata?
**Status:** direction set by Peter (2026-09-03); closes in Phase 1 (API shape) and Phase 3 (demo proves it)
**Context.** Peter asks whether dapps must be written with dappdata in mind, or whether adoption can be simpler.
**Options.** (a) Explicit SDK: the dapp calls `slot.get/set/watch`, and chooses what state to keep. (b) Storage adapters: dappdata implements interfaces dapps already use — a `Storage`-like key-value API, a state-library persistence plugin (zustand/redux-persist/pinia), a Yjs provider, a wagmi/Web3Modal hook — so an existing dapp swaps one line. (c) Transparent shim: intercept `localStorage`/IndexedDB for a namespace and mirror it to Swarm; the dapp does not change at all.
**Direction.** (a) is the core and is what Phase 1 builds; it is content-agnostic (a slot holds bytes or JSON, the SDK never inspects it). (b) is how most dapps will adopt; Phase 3 ships one adapter, chosen by the demo: a plain key-value / zustand-style persistence adapter over a `preferences` slot (the "DEX settings that vanish on a new laptop" case). (c) is out of scope unless a real adopter asks: the shim's problem is not data structure but semantics — synchronous API over an async store, size limits, and no way to tell user state from cache.
**Consequences.** Adapters are separate small packages on top of the SDK; the core API must stay small enough that an adapter is under a hundred lines. Phase 3 demo scope updated in PLAN.
