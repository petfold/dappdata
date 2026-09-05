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
**Leaning.** (a) in M0: `set(value, { expectIndex })` fails with a typed conflict error when the feed has moved, and a `merge(local, remote)` callback lets the dapp resolve and retry. (c) is not built here: it is swarm-collaborative-docs with the D20 envelope and a D17 sub-key. Two devices editing one small list (swarmtyp's project list, PLAN Phase 5) is the first real test.
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

## D15 — Derivation input: hash `r‖s` with low-`s`, not the 65-byte signature
**Status:** open — closes before Phase 1 code. Changes every key, so it cannot move after the first real user.
**Context.** D1 and `spikes/s1/src/derive.ts` take `seed = keccak256(sig)` over the full 65-byte signature. The recovery byte `v` is an encoding choice, not part of the signature: wallets and libraries report 27/28 or 0/1 (Ledger through MetaMask has returned both over time), and a wallet that emits a high-`s` signature would differ again. Same account, same message, two seeds, two folders. Raised in the review thread of 2026-09-04 (the note that was `issues.txt`); S1 did not see it because it compared each wallet with itself and two wallets that happen to agree on `v`.
**Options.** (a) Keep `keccak256(sig)`. (b) `keccak256(r ‖ s)` with `s` normalised to the low half of the curve order. (c) (b) plus recovering the public key and checking it matches `account`.
**Leaning.** (c). The check costs one recovery and turns a wrong-account or malformed signature into a typed error instead of a silent empty folder.
**Consequences.** `ARCHITECTURE.md` derivation block updated in this commit, marked *(D15)*. S1's determinism result stands: `r` and `s` are what RFC 6979 fixes. The spike's `derive.ts` is superseded on this line and is not updated (throwaway code). THREATS T13.

## D16 — What the key binds to: browser origin or a declared app identity
**Status:** open — closes before Phase 1 code
**Context.** The D1 message binds `origin = window.location.origin`. A dapp served from a Swarm gateway has no origin of its own: `https://gateway.example/bzz/<ref>/` is shared with every other app on that gateway and differs on every gateway and on a local node. The same user gets a different folder per access path, and any app on the gateway can request the same signature. Raised by swarmtyp, the first adopter candidate (PLAN, Phase 5).
**Options.** (a) Keep `origin` as the only binding; Swarm-hosted dapps live with per-gateway folders or an alias tool. (b) Replace the field with `app`: the browser origin by default, or a stable identity the dapp declares when served from a gateway (an ENS name, or the owner address of the app's release feed). The wallet's own request header still shows the true site. (c) Two signed fields, `origin` and `app`; the key then depends on both, which defeats the purpose.
**Leaning.** (b), default equal to today's behaviour so conventional dapps change nothing. Field name `app`, not an overloaded `origin`, because the user reads it in the wallet prompt.
**Consequences.** Amends D1's message; no users yet, so no migration. Topic derivation uses `app` (`ARCHITECTURE.md`, storage layout). THREATS T14: with a declared `app`, a phishing site can name it too, and the remaining defence is the wallet's request-origin line, which for gateway users shows a gateway hostname anyway. Dapps that choose app binding accept that and say so in their UX; verifying an ENS contenthash against the loaded bundle is a Phase 4 option. D7 inherits the same identifier.

## D17 — Sub-keys for other libraries
**Status:** open — closes in Phase 1 (API shape)
**Context.** The SDK never returns `feedKey` or `encKey` (T2, T10). But a dapp on Swarm needs signing keys for things dappdata does not do: feeds the user owns in another library (swarm-collaborative-docs snapshots and signalling), GSOC, ACT grantees. Without a supported path, dapps will generate a random key and stash it in a slot, or ask the wallet for a second signature.
**Options.** (a) Nothing; dapps keep their own keys in slots. (b) `deriveKey(purpose)`: `HKDF-SHA256(seed, info = "dappdata/sub/v1/" + purpose) mod n`, returned to the dapp as a `PrivateKey` it may hold. (c) A signer object (`address`, `sign(digest)`) that keeps the sub-key inside the SDK; needs the consuming libraries to accept a signer.
**Leaning.** (b) now, (c) later for libraries that take a signer. The seed is already app-bound (D16), so `purpose` is enough. A leaked sub-key exposes what that library wrote, never the folder: the folder keys hang off other `info` strings and HKDF does not run backwards.
**Consequences.** The `info` strings are part of the key and go into the v1 spec. THREATS T16. The `EntropySource` (D8, D21) stays the only place the seed enters.

## D18 — The Bee transport is supplied by the caller
**Status:** open — closes in Phase 1
**Context.** D13 made the Bee endpoint an interface. The pin on bee-js 13 (D10) meets an ecosystem still on 12: swarm-collaborative-docs, most examples, the Swarm skill. A dapp that uses both would ship two bee-js majors from a Swarm address, where every byte is paid for on first load.
**Options.** (a) bee-js 13 inside, plus a `Transport` interface (upload SOC with envelope, read feed update by index, look up latest, upload and download bytes) that a caller implements over its own bee-js instance. (b) No bee-js at all: core-sdk builds chunks and SOCs, `fetch` talks to the four Bee routes the SDK uses. (c) Status quo.
**Leaning.** (a) for Phase 1, and measure (b): if the fetch transport is under a few hundred lines it becomes the default and bee-js a dev dependency.
**Consequences.** `bee: { url }` becomes `transport: transport.http(url)` with `transport.custom(impl)` beside it. The bee-js pin (D10) then governs the default transport only.

## D19 — The stamper as a service, and bucket state under frequent writes
**Status:** open — closes in Phase 2
**Context.** D4 and D12 make client-side stamping and never-lose-the-bucket-state the core operational rule (S3). Other libraries that write feeds on the user's behalf need to stamp too, and a collaborative editor writes a snapshot every few seconds, far more often than the SDK's own slots. A blank or stale stamper on a new device overwrites the user's own chunks and the node answers 201.
**Options.** (a) Stamping stays private to the SDK; other libraries bring their own batch. (b) `stamper(batchId)` returns `{ stamp(address), state(), checkpoint() }` for any library to call; the SDK owns bucket state: in memory, cached locally as a hint, checkpointed to a reserved slot every N stamps or T seconds; a new device restores the checkpoint and advances every bucket by a safety margin at least the checkpoint interval, which is S3's "start from a slot range the old device cannot have used". (c) swarm-id's partition-lease design (D8): each device leases a disjoint slot range.
**Leaning.** (b), with (c) as the refinement if two devices write at once. The margin costs capacity; depth sizing includes it (D23).
**Consequences.** THREATS T12 gets its mitigation, promised in D4's consequences and not yet written. A local cache on a shared gateway origin can be read or altered by another app (T15), so the slot checkpoint wins over the local cache and a bucket never moves backwards. Gives swarmtyp the "user owns the batch, any node uploads" mode; swarm-collaborative-docs must accept a `stamp` hook, an upstream change on the Solar Punk side.

## D20 — Envelope crypto as a module other libraries can use
**Status:** open — design in Phase 1, closes in Phase 4
**Context.** The D9 envelope (AES-256-GCM, nonce, additional authenticated data) is what any Swarm library needs to encrypt payloads before they leave the browser. swarm-collaborative-docs wants exactly this hook for private documents; its keys are per document and shared between collaborators, not the user's folder key.
**Options.** (a) Keep the envelope internal. (b) Publish it as a pure module (`dappdata/envelope`: frame, encrypt, decrypt, any WebCrypto key, mandatory AAD) and offer `encrypt(bytes, aad)` / `decrypt` with the folder's `encKey` on the connected instance, the key never leaving WebCrypto. (c) (b) plus a CRDT adapter here.
**Leaning.** (b). Not (c): D6 option (c) is "swarm-collaborative-docs with the D20 hook", so the two Solar Punk libraries divide the work: dappdata does keys, funding and encryption; swarm-collaborative-docs does sync.
**Consequences.** Envelope format frozen in Phase 1 with the D22 schema byte. A slot is the natural home for the per-document keys a dapp hands to the other library.

## D21 — Entropy sources without a wallet
**Status:** open — mnemonic closes in Phase 1; passkeys in Phase 5
**Context.** D2 refuses contract and passkey wallets; D8 left the seed behind an `EntropySource` interface with one implementation, the wallet signature. Swarm Desktop users often run a Bee node and no browser wallet, and CI needs a fixed seed.
**Options.** (a) Wallet only. (b) Ship `entropy.wallet(provider)` (default), `entropy.mnemonic(words)` (BIP-39 seed; also the test source), and later `entropy.passkey()` over the WebAuthn PRF extension, which yields a deterministic secret in current browsers and is the way back in for the D2-excluded users without swarm-id's hosted domain. (c) (b) with the app binding applied after the source for every source alike, `seed = HKDF(secret, info = "dappdata/seed/v1/" + app)`, so a mnemonic user gets per-app isolation too and the wallet path is bound twice, harmlessly.
**Leaning.** (c). One derivation spec for every source.
**Consequences.** Touches the D15 derivation block; decide the two together. A dapp with wallet and mnemonic users runs one code path (swarmtyp's Phase 2 local-key users and its Phase 3 wallet users). Mnemonic loss is key loss (T4); the SDK says so.

## D22 — Slot schema version and migration hook
**Status:** open — closes in Phase 1
**Context.** The envelope carries a format version; the value inside carries nothing. A dapp that changes its state shape has to guess what it reads back, and a two-device user runs two versions of the dapp for a while.
**Options.** (a) Nothing; dapps embed their own version. (b) A `schema` byte in the frame; `get` returns it with `value` and `index`; `slot(name, { schema, migrate(old, fromSchema) })` upgrades on read and writes the new shape on the next `set`.
**Leaning.** (b). One byte and one callback.
**Consequences.** Frame layout fixed in Phase 1 alongside D9 and D20.

## D23 — Funding granularity: one batch per user per app
**Status:** open — closes in Phase 2
**Context.** Per-app owner keys (D12, D16) mean each app a user adopts brings its own postage batch, funded separately. Raised in the review thread of 2026-09-04 (the note that was `issues.txt`) as probably the biggest UX question after the latency budget. A single user-level batch would need one key to sign every app's stamps, which is the cross-app isolation D8 keeps.
**Options.** (a) Accept per-app batches and make them cheap and visible: `fund()` sizes depth and amount from a write budget the dapp declares, `health()` reports days of storage left, the dapp shows it, sponsors can `topUp` any of them. (b) A user-level "storage wallet" app that holds one batch and signs stamps for other apps through `postMessage`; this is swarm-id's hosted-domain design, declined in D8. (c) A shared batch with per-app bucket ranges; still one owner key, same objection.
**Leaning.** (a) for v1, said plainly in `docs/FUNDING.md`. Revisit (b) in Phase 5 together with D8.
**Consequences.** `Funding.fund()` gains a `budget` argument (writes per day, retention days). `ARCHITECTURE.md` funding section updated.
