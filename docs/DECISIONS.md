# Decision log

One entry per choice with lasting effect. Format: context, options, decision, consequences, who and when. A decision is **open** until Peter, or a spike result Peter has seen, closes it. Code that embodies a decision names the D-number in a comment.

Add new entries at the end. Do not renumber.

---

## D0 — Scope: compose, do not extend
**Status:** closed (canvas, 2026-09-03)
**Decision.** No protocol changes, no Bee fork. dappdata composes feeds, postage stamps, encryption, ACT, and existing tooling (gateway-proxy, bee-factory).
**Consequences.** Anything that needs a Bee change is out of scope and goes back to IDEA-190 as a note.

## D1 — Derivation message and signing method
**Status:** closed (S1 results, Peter confirmed 2026-09-03)
**Context.** Wallets cannot raw-sign feed updates. The storage key must come from a signature over a fixed message.
**Options.** (a) EIP-712 typed data via `eth_signTypedData_v4`, origin-bound; (b) `personal_sign` over a text message; (c) both, typed data preferred with text fallback.
**Decision.** (c), with three details fixed by S1 (`spikes/s1/RESULTS.md`):
1. **Message.** Domain `{ name: "dappdata", version: "1" }`, primary type `DappDataKey { purpose, account, origin, scope }`, `purpose = "Derive dappdata storage key"`, `scope = "v1"`. **No `chainId` in the domain** (F1): MetaMask rejects a typed-data request whose domain chain differs from the wallet's current chain, so a chain-bound domain would force a chain switch or give a different key per chain. The key depends on account, origin, and scope only.
2. **Fallback.** `personal_sign` over the same fields, one per line, fixed order (`fallbackText` in the spike). It derives a *different* key from the typed-data path (F2). Policy: the SDK tries typed data first; if the wallet rejects the method as unsupported, it uses the fallback. On restore, the SDK reads under the typed-data key first and, if that feed is empty, under the fallback key, so a user who moves between a typed-data wallet and a text-only wallet still finds their state. On write, the SDK uses whichever method it used to read. Both wallets tested support typed data, so the fallback is expected to be rare.
3. **Provider comes from the caller.** The SDK never reads `window.ethereum` (several extensions fight over it; EIP-6963 is the discovery path). The dapp hands in an EIP-1193 provider.
**Evidence.** MetaMask 13.46.1 and Rabby 0.94.6: 20 signatures each on both paths, one distinct signature per path; the same account gives the same key in both wallets; both stable across page reload and wallet restart. ethers, eth-sig-util, and viem agree headless.
**Consequences.** The message is part of the key. Changing anything but `scope` changes every user's key; `scope` moves only with a migration (Phase 4). `ARCHITECTURE.md` updated in the same commit.

## D2 — Supported wallets and smart-account policy
**Status:** closed (S1 results, Peter confirmed 2026-09-03)
**Context.** Deterministic ECDSA (RFC 6979) holds for MetaMask and hardware wallets; ERC-1271 contract wallets and passkey wallets cannot give a deterministic secp256k1 signature.
**Options for contract accounts.** (a) Refuse with a clear message; (b) dapp-held escrow key, released after SIWE; (c) session key registered on the account.
**Decision.**
- **Supported in v1:** EOA wallets that implement `eth_signTypedData_v4` or `personal_sign` and sign with RFC 6979. Verified: MetaMask, Rabby. Expected to work, unverified: Coinbase Wallet extension, Ledger through MetaMask (firmware signs on-device; determinism assumed, to confirm before Phase 3), WalletConnect mobile wallets. The matrix in `spikes/s1/RESULTS.md` records what was run.
- **Contract accounts (ERC-1271) and passkey wallets: (a), refuse in v1.** The SDK checks `eth_getCode(account)` before it asks for a signature and returns a typed error the dapp can show. Step 5 of the S1 protocol (try a Safe and a passkey wallet) was not run; the refusal rests on the signature model, not on an experiment, and does not need one.
- **Recorded for Phase 5.** The way back in for these users is an identity layer that holds the seed for them: swarm-id's passkey path (D8) is the closest existing design. The SDK exposes the seed source as an interface (`EntropySource`, D8) so such a layer can plug in without touching the rest.
**Consequences.** Some users cannot use dappdata in v1, and the dapp learns that before any prompt. The SDK never guesses the wallet type from `isMetaMask`-style flags.

## D3 — Default funding mode
**Status:** closure drafted from S3 (Claude, 2026-09-04); Peter confirms, then closed
**Context.** The original options conflated two questions: who *owns* the batch and who *pays* for it. The postage contract's `createBatch` takes an owner address separate from the payer, and `topUp` is permissionless, so they are independent.
**Options.** (a) Proxy stamping as default, batch as advanced; (b) user-owned batch as default, proxy as advanced; (c) no default, dapp must choose; (d) **user owns, anyone pays**: the batch owner is always the user (see D12), and the payer is the user, a sponsor, or the dapp operator, through the same code path.
**Decision.** (d), confirmed end to end on Sepolia (`spikes/s3/RESULTS.md`, mode B): a payer key created a depth-17 batch owned by a different key; that key stamped a feed update client-side; a Bee node holding no batch accepted it, from Node and from a browser page on another origin; a non-owner topped the batch up; a non-owner could not dilute it. Mode A (gateway-proxy) works against Bee 2.8.2 and adds no measurable latency (S2 path 3), but it is an operated component whose batch anyone can drain, so it leaves the design: **no stamping proxy in the SDK.** A dapp that wants to sponsor users calls `createBatch(owner = user)` / `topUp`, the same code path as the user paying.
**Onboarding.** Sponsor-pays is the demo's first-run path. For "bring your own funds", the SDK links out to one multichain route first, Jumper, because it starts from any chain and ends with both xBZZ and xDAI (survey in S3 step 7). Funding starts in the background right after sign-in; writes queue locally until the batch is usable, about 2 minutes from confirmation on Sepolia (S3 step 6), and the SDK reports the pending state to the dapp.
**Consequences.** C4 in PLAN ("both funding modes") becomes "sponsor pays and user pays through one path". `ARCHITECTURE.md` funding section rewritten in this commit. THREATS T7 (proxy drain) is moot; a new threat replaces it: loss of stamper state (see D4).

## D4 — Postage batch type
**Status:** closure drafted from S3 (Claude, 2026-09-04); Peter confirms, then closed
**Context.** Mutable batches overwrite old chunks when full, which corrupts feeds. The expectation was that immutable batches prevent that.
**What S3 found** (`spikes/s3/RESULTS.md`, step 5). Reusing a stamp slot (bucket + index) made the earlier chunk on that slot unretrievable on the Swarm testnet **for an immutable batch as well as a mutable one**; a control with distinct slots kept both chunks. The uploading node answered 201 both times. On chain, `increaseDepth` does not check the immutable flag either. So "immutable" is a marker plus node-side behaviour on a full bucket, not an overwrite guarantee visible to the client.
**Decision.** The SDK uses **immutable** batches and refuses mutable ones, as planned, but the protection against overwrites is an SDK rule, not the flag: (1) the SDK persists the `Stamper` bucket state alongside the feed and never stamps with a blank state on a batch that has been written to; (2) it stops at capacity and asks for a new batch instead of overwriting; (3) on a fresh device it restores the stamper state from the feed before the first write. The refusal message for mutable batches says: "a full mutable batch silently replaces your oldest data; dappdata needs an immutable batch and will stop writing when it is full."
**Consequences.** Stamper state is part of the per-slot metadata (Phase 1 design). THREATS gains "lost stamper state overwrites own data" as a top item. Re-test the immutable behaviour on bee-factory full nodes and on mainnet during Phase 2; if Bee does reject slot reuse there, the rule stays anyway.

## D5 — Latency thresholds for "interactive"
**Status:** closure drafted from S2 (Claude, 2026-09-04); Peter confirms, then closed
**Proposed.** Cold read-latest p95 ≤ 5 s. Warm read-latest p95 ≤ 2 s. Cross-client visibility p95 ≤ 30 s.
**Decision.** Keep all three thresholds, with two rules that the measurements force (`spikes/s2/RESULTS.md`, four paths):
1. **The SDK caches the feed index per slot and reads by index.** Bee's feed lookup costs 2–5 s in every environment measured (local cluster, testnet light nodes, mainnet gateways); a read by known index costs 10–20 ms locally and 0.2–0.3 s through a gateway. The lookup is used only when the SDK has no index (first read on a new device: the "cold" case, 2–5 s, inside the threshold) or when the cached index misses.
2. **Visibility is a background concern with a documented window.** Cross-node visibility was 2–2.5 s p50 on mainnet via two gateways and on bee-factory, 8–20 s p50 with a tail past 50 s on the Sepolia testnet through light nodes. `watch` polls with backoff; the UI shows "last synced"; nothing blocks on it. The documented window is 30 s on mainnet.
**Numbers behind it.** Writes 15–70 ms on bee-factory, 0.3–1.7 s through a light node or gateway, tail to 12 s. Lookup reads 3–5 s p95. A stamping proxy adds no measurable latency.
**Consequences.** The Phase 1 slot API has a per-slot index cache and a `hint` for the last known index; `set()` resolves when the upload is accepted, and a separate `synced` signal reports visibility. C3 in PLAN is met on mainnet with these rules.

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
**Status:** closed (S1 results, Peter confirmed 2026-09-03)
**Context.** swarm-id is a work-in-progress browser master identity for Swarm dapps: it derives app-specific secrets, signs feed updates, and isolates apps from each other. That overlaps dappdata's derivation layer. IDEA-176 (Swarm ID core storage) is the Foundation-side identity substrate.
**Options.** (a) Build dappdata's derivation on swarm-id; (b) stay independent and SIWE-native, but align topic and isolation conventions so state is portable later; (c) independent, no alignment.
**Decision.** (b). Reasons in `spikes/s1/RESULTS.md`, D8 section: swarm-id needs a hosted trusted domain and its own account; dappdata's point is to need neither. Concretely:
- Per-origin isolation stays the isolation unit, the same as theirs.
- Derivation stays a pure function of one signature. The SDK takes the seed through an `EntropySource` interface whose default implementation is the D1 wallet signature; an identity layer such as swarm-id could supply the seed later without a change to feeds or encryption.
- Their `UtilizationAwareStamper` and partition-lease designs are the reference if D6/D12 need multi-device stamping. Their passkey path is the pointer for D2's excluded users.
- Revisit in Phase 5 if swarm-id ships and dapps already carry it.
**Consequences.** Derivation is our code. No third-party origin, no popup, no operated service in the dependency list.

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
**Status:** closure drafted from S3 (Claude, 2026-09-04); Peter confirms, then closed
**Context.** Postage stamps are secp256k1 signatures by the batch owner. A browser wallet cannot raw-sign, so a batch owned by the user's EOA cannot be stamped in the browser. The derived storage key (D1) can sign anything.
**Decision.** The batch owner is the **derived storage key's address**, and the SDK signs stamps client-side. All four S3 checks passed on Sepolia with bee-js 13.0.0 + core-sdk 0.1.1 and Bee 2.8.2: (1) `Stamper.fromBlank(key, batchId, depth).stamp(address)` produces envelopes whose signatures Bee accepts (same personal-sign-over-keccak scheme); (2) a node with zero batches accepts the pre-stamped chunk and forwards it; (3) `createBatch(_owner = derived address)` from a payer key, then stamping with the derived key, works end to end; (4) a browser page on another origin can upload, given `cors-allowed-origins` on the node.
**Two rules learned the hard way.** Upload pre-stamped SOCs through `POST /soc/{owner}/{id}` (bee-js `soc.makeWriter(key).upload(envelope, id, data)`), never `POST /chunks`, which validates the stamp against the wrong address. And stamp each chunk once: every `stamp()` call consumes a slot, and a reused slot destroys the earlier chunk (D4).
**Consequences.** Funding needs no operated stamping component (D3). The endpoint holds no funds; THREATS T7 is moot. bee-js's `SOCWriter.upload` type should be widened upstream to accept an envelope; until then the SDK casts.

## D13 — Browser-first, with Node for spikes and tests
**Status:** closure drafted at the Phase 0 gate (Claude, 2026-09-04); Peter confirms, then closed
**Context.** The plan targets the browser (C2), but the spikes are Node scripts. Retrofitting browser support later is where polyfills and second code paths appear.
**Decision.** From Phase 1 the SDK uses only primitives that exist in both browser and Node: WebCrypto, an EIP-1193 provider, bee-js 13, core-sdk, `@noble/*`. No Node-only modules in `packages/dappdata`. Tests run in Node against bee-factory. S1 showed the derivation code runs unchanged in both (F3); S3 showed the write path (client-side stamp, `POST /soc`) works from a browser page cross-origin.
**The write path, status at the gate.** Every write today needs an HTTP Bee endpoint with `cors-allowed-origins` set; under D12 that endpoint holds no funds, so it can be the user's own node, the dapp operator's, or any public node that allows CORS. weeb-3 (github.com/lat-murmeldjur/weeb-3) now claims uploads, feed updates and postage purchase inside the browser; unverified here. So the SDK's Bee endpoint is an interface, not a URL: HTTP node in Phase 1, an in-browser node when one is verified (Phase 4 or 5).
**Consequences.** `bee: { url }` in the API sketch becomes a transport abstraction with one HTTP implementation. Phase 2 does not need to size weeb-3 work; Phase 4 checks its status again.

## D14 — Integration surface: how much must a dapp know about dappdata?
**Status:** direction set by Peter (2026-09-03); closes in Phase 1 (API shape) and Phase 3 (demo proves it)
**Context.** Peter asks whether dapps must be written with dappdata in mind, or whether adoption can be simpler.
**Options.** (a) Explicit SDK: the dapp calls `slot.get/set/watch`, and chooses what state to keep. (b) Storage adapters: dappdata implements interfaces dapps already use — a `Storage`-like key-value API, a state-library persistence plugin (zustand/redux-persist/pinia), a Yjs provider, a wagmi/Web3Modal hook — so an existing dapp swaps one line. (c) Transparent shim: intercept `localStorage`/IndexedDB for a namespace and mirror it to Swarm; the dapp does not change at all.
**Direction.** (a) is the core and is what Phase 1 builds; it is content-agnostic (a slot holds bytes or JSON, the SDK never inspects it). (b) is how most dapps will adopt; Phase 3 ships one adapter, chosen by the demo: a plain key-value / zustand-style persistence adapter over a `preferences` slot (the "DEX settings that vanish on a new laptop" case). (c) is out of scope unless a real adopter asks: the shim's problem is not data structure but semantics — synchronous API over an async store, size limits, and no way to tell user state from cache.
**Consequences.** Adapters are separate small packages on top of the SDK; the core API must stay small enough that an adapter is under a hundred lines. Phase 3 demo scope updated in PLAN.
