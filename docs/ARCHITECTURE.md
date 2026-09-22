# Architecture

Target design. Sections marked *(D#)* depend on an open decision in `DECISIONS.md` and may change when it closes. Update this file in the same commit as the code that changes it.

## The shape of it

```
 browser                                    Swarm
 ┌───────────────────────────────┐          ┌──────────────────────────┐
 │ dapp                          │          │                          │
 │  SIWE sign-in ─┐              │          │  feed (owner=derived key,│
 │                ▼              │  HTTP    │        topic=slot)       │
 │  dappdata SDK                 │ ───────► │    └─ SOC[i] = envelope  │
 │   derive ─► feedKey, encKey   │  Bee     │         (ciphertext, or  │
 │   slot.get/set/watch          │  endpoint│          ref ─► blob)    │
 │   funding adapter ────────────┼──┐       │                          │
 └───────────────────────────────┘  │       └──────────────────────────┘
                                    │
                    Mode A: gateway-proxy stamps writes
                    Mode B: user's own batch, sponsor may topUp
```

One wallet signature at sign-in yields a storage identity. State lives in feeds that identity owns, encrypted before it leaves the browser. A funding adapter decides who pays for the stamps.

## Identity and keys *(D1, D2, D8, D15, D16, D17, D21)*

**Two signatures at sign-in.** SIWE proves the address to the dapp; its message has a nonce, so its signature is different every time and useless as a seed. A second, fixed, EIP-712 message yields the derivation signature. The SDK asks for it once per session and keeps the result in memory only.

**The message (D1, from S1).** Domain `{ name: "dappdata", version: "1" }` with **no `chainId`**: a chain-bound domain would make the key depend on the chain the wallet happens to be on. Primary type `DappDataKey` with four string-ish fields: `purpose` ("Derive dappdata storage key"), `account`, `app`, `scope` ("v1"). `app` is the browser origin unless the dapp declares a stable identity because it is served from a Swarm gateway *(D16; D1 named this field `origin`)*. Wallets show these as labelled fields, so a user can spot a wrong app. Reference implementation: `spikes/s1/src/derive.ts`.

**Typed data required (D1, amended 2026-09-22).** A wallet that cannot sign `eth_signTypedData_v4` gets a typed `unsupported` error before any prompt; every current wallet can, and over WalletConnect the dapp lists the method among its optional methods. The `personal_sign` fallback survives only as an explicit opt-in, `entropy.wallet(provider, { personalSignFallback: true })`, and opens a different folder, which the dapp that enables it owns. Its text and digest stay in `derive/` with their golden vectors.

**Provider.** The dapp passes an EIP-1193 provider; the SDK never reads `window.ethereum`. Several wallet extensions in one browser fight over that global, and EIP-6963 is the discovery path dapps already use.

**Derivation.**

```
sig      = eth_signTypedData_v4(derivationMessage)     // wallet; or another EntropySource (D21)
           recover(sig) == account, else typed error    // D15: a wrong account must not open an empty folder
secret   = keccak256(r ‖ s_low)                        // D15: not the 65-byte signature; v is encoding, s normalised low
seed     = HMAC-SHA256(secret, "dappdata/seed/v1/" + app)   // D21: the same app binding for every source
feedKey  = HMAC-SHA256(seed, "dappdata/feed/v1") mod n   (secp256k1 order; re-hash if 0)
encKey   = HMAC-SHA256(seed, "dappdata/enc/v1")
subKey   = HMAC-SHA256(seed, "dappdata/sub/v1/" + purpose) mod n   // D17: the one key the dapp may hold
```

**The primitive *(D15, D24, closed 2026-09-21)*.** The KDF is swarm-id's `HMAC-SHA256(key, utf8(context))` rather than HKDF, and the signature is canonicalised their way — compact form, EIP-155 rules — on top of low-`s`. Both projects can then publish the same test vectors whatever comes of the convergence proposal.

The derivation message binds the app identity (D16), so each dapp gets its own feed owner. That is a privacy property (a dapp cannot enumerate another dapp's state) and a discoverability cost (see D7). The `scope` field is a version tag; changing it produces new keys, which is why it must never change without a migration path (Phase 4).

**What the dapp sees.** The derived address, so it can build feed references. Never `feedKey` or `encKey` directly; the SDK signs and decrypts internally. `encKey` is imported into WebCrypto as non-extractable. `feedKey` has to be used by a secp256k1 signer, so it stays a plain in-memory value with the shortest lifetime the session allows. Sub-keys are the exception *(D17)*: `deriveKey(purpose)` returns a key the dapp may hand to another library; it cannot reach the folder keys.

**Smart accounts (D2, D25).** ERC-1271 wallets and passkey wallets cannot produce a deterministic secp256k1 signature. The SDK checks `eth_getCode` before asking for a signature and refuses a contract account with a typed error the dapp can show. One exception *(D25)*: an EIP-7702 upgraded EOA returns the 23-byte delegation designator `0xef0100 ‖ address`; it still signs with its own key, so the SDK treats that code as an EOA. The seed comes in through an `EntropySource` interface (D8) whose default is the wallet signature. D21 adds a mnemonic source (Phase 1) and `entropy.passkey()` over WebAuthn PRF (landed 2026-09-22, *D25*): a discoverable credential whose PRF output over the fixed salt `sha256("dappdata/prf/v1")` is the secret, created on first use, refused with a typed error when the authenticator has no PRF. Every source passes through the same app binding. A passkey is one folder per passkey; the wrapped folder seed that makes several passkeys or several smart-account owners one folder is D28. How smart accounts come in is D2's note of 2026-09-22. Embedded wallets (Privy, Dynamic, Magic) are EOAs and need no special path, pending a determinism check in Phase 3.

## Storage layout

**Topic.** `topic = keccak256("dappdata/v1/" + app + "/" + slotName)` *(D16)*. One feed per slot. *(D7 may add a mapping feed that lists a user's slots.)*

**Feed type.** Sequential. Each update is a single-owner chunk at the next index.

**Envelope.** The feed payload is a small binary frame:

```
version(1) | alg(1) | mode(1) | schema(1) | nonce(12) | body
mode = INLINE   body = ciphertext of the state value (≤ ~3.9 KB after framing)
mode = REF      body = 64-byte encrypted Swarm reference to an uploaded blob
schema        = the dapp's own version of the value's shape (D22); returned by get, fed to migrate
```

Frame, encrypt and decrypt are a pure module (`dappdata/envelope`) that works with any WebCrypto key and a caller-chosen AAD, so other libraries can reuse the format *(D20)*. The connected instance also offers `encrypt(bytes, aad)` / `decrypt` with the folder's `encKey`, which never leaves WebCrypto.

Inline when the value fits a chunk; otherwise the SDK uploads the value with Swarm's built-in encryption (which gives a 64-byte reference containing the decryption key) and stores that reference in the envelope, encrypted again with `encKey`. Readers never learn which mode a slot uses without the key.

**Encryption *(D9, closed 2026-09-21)*.** AES-256-GCM through WebCrypto with `encKey`, random 96-bit nonce per write, topic as additional authenticated data so a payload cannot be replayed into another slot. ACT is not used for v1: there is one reader, the user; ACT's grantee model adds nothing yet. Revisit if sharing between users enters scope.

**Size limit.** A chunk holds 4096 bytes of data. The framing costs a few dozen bytes. The SDK measures the ciphertext and picks the mode; the caller never sees the boundary.

## Writes, reads, and consistency *(D6)*

- `set` reads the latest index, writes index+1, then confirms by reading back. A failed read-back within the D5 window is reported, not swallowed.
- Same-index overwrites are unreliable on Swarm; the SDK never attempts one.
- Consistency is eventual. `get` returns the latest value the endpoint can see, with the index, so a dapp can detect that it went backwards.
- `get` returns `{ value, index, schema }`; a `migrate(old, fromSchema)` callback given at `slot()` upgrades old shapes on read, and the next `set` writes the new shape *(D22)*.
- **Multi-device *(D6)*.** Two devices with the same derived key are two writers on one feed. M0 ships `set(value, { expectIndex })`, which fails with a typed conflict error when the feed has moved, and a `merge(local, remote)` callback so the dapp resolves and retries. A CRDT layer is not built here: it is swarm-collaborative-docs with the D20 envelope and a D17 sub-key. One feed per device plus a merge step stays an option if Phase 4 finds a need.
- `watch` polls read-latest at an interval derived from the D5 visibility window; a push path (GSOC or PSS) is a later option, not M0.

## Funding *(D3, D4, D12)*

One model: **the user owns the batch, anyone pays, the SDK stamps.** Settled by S3 (`spikes/s3/RESULTS.md`); the earlier two-adapter design with a stamping proxy is gone.

**Owner.** The postage batch's `_owner` is the derived storage key's address (D12). The user's wallet never signs stamps and never holds the batch; the SDK signs stamps with the derived key using core-sdk's `Stamper`, and uploads pre-stamped chunks through `POST /soc/{owner}/{id}` on any Bee HTTP endpoint that allows CORS and has a chain-synced batchstore, which is any light, full or ultra-light node given a `blockchain-rpc-endpoint` (S3 wrote through an ultra-light node; a node with no chain access cannot check the stamp). The endpoint holds no batch and no funds. Three transport options tune it to the node: `probeTimeoutMs` bounds a read by index so a not-yet-written index costs the bound rather than a network retrieval attempt (D5, T18); `deferred` and `pin` make a node the user runs store and keep their writes, so their own reads are answered at once instead of after the network's retrieval delay (T18). `POST /soc` is the only route for a pre-stamped SOC: `POST /chunks` parses the body as a content-addressed chunk first and validates the stamp against that address, so it answers `400 stamp signature is invalid` for any SOC payload under about 4 000 bytes (D12; Bee 2.8.2 `pkg/api/chunk.go`).

**Stamper as a service *(D19, revised in Phase 2)*.** `dd.stamper(batchId, { depth })` exposes `stamp(address)`, `state()` and `checkpoint()` to any library that writes on the user's behalf. The SDK owns the bucket state, checkpointed to a reserved slot, and the rule is **reserve before use**: the checkpoint records a height per bucket the device may spend, the device stamps below that line, and it extends the reservation with a fresh checkpoint before crossing it. A device that restores starts at the reserved heights, because everything below them may be spent and everything above cannot be. A crash therefore loses slots rather than reusing them (D4). The safety margin this section used to describe is gone: a batch has 65 536 buckets at every depth, so a bucket holds 2 chunks at depth 17 and 16 at depth 20, and a margin wide enough to cover an unsynced writer is wider than the space it protects. A bucket never moves backwards, whatever a local cache says (T15). The default checkpoint store is a reserved slot in the user's folder, `.stamper/<batchId>`, stamped by the stamper it checkpoints: the store names the addresses of its own next two feed updates (`upcoming()`), which are computable from topic and index alone, and the stamper reserves one slot for each inside the checkpoint it is about to write, so the checkpoint covers itself and its successor. The slot write carries `expectIndex`; when another device published first the store raises `CheckpointConflictError` with the winner's state and the stamper restarts from those lines, so two devices starting from one checkpoint at the same moment take disjoint slots. A `Stamper` is itself a `Stamp` and goes straight into `slot.set` or another library's write path.

**Payer.** Whoever calls `createBatch(owner, …)` or `topUp(batchId, …)` on the postage contract: the user, the dapp operator, a sponsor. Same code path, one function:

```ts
// dd.funding(payerProvider, chain) binds the owner to this folder's address.
interface Funding {
  /** Buy the user's batch. Depth and amount, or a budget the SDK sizes from (D23). */
  fund(opts: { owner: string; depth?: number; amountPerChunk?: bigint; budget?: WriteBudget }): Promise<FundResult>;
  /** What a budget would cost right now, quoted from the node's chain state. */
  quote(budget: WriteBudget): Promise<{ depth: number; amountPerChunk: bigint; total: bigint }>;
  /** Permissionless: a sponsor extends any batch, owner or not. */
  topUp(batchId: string, amountPerChunk: bigint): Promise<string>;
  health(batchId: string): Promise<{ usable: boolean; ttlSeconds: number; daysLeft: number; usage: number } | null>;
  /** Where the user can get xBZZ and xDAI; the SDK links out, it does not swap. */
  links(): FundingLink[];   // Jumper first (D3)
}
```

The SDK encodes the four contract calls itself — `allowance`, `approve`, `createBatch`, `topUp` — and sends them through the payer's EIP-1193 provider, so funding adds no web3 library to the bundle. Contract addresses come from `ethersphere/go-storage-incentives-abi`; `docs/FUNDING.md` lists them and says which we have actually transacted with.

**Batch type.** Immutable, depth chosen for the slot count the dapp expects; the SDK refuses mutable batches. The protection against overwrites is the SDK's, not the flag's (D4): stamper bucket state is persisted with the slot metadata, restored before the first write on a new device, and the SDK stops at capacity and asks for a new batch. A reused slot silently replaces the earlier chunk on the network, immutable or not.

**Granularity *(D23)*.** One batch per user per app, because the owner key is per app. `fund()` takes a write budget (writes per day, retention days) and sizes depth and amount from it, including the D19 safety margin; `health()` turns TTL into days of storage left for the dapp to show. `docs/FUNDING.md` (Phase 2) says plainly that each app brings its own batch and that a sponsor can top up any of them.

**Reading your own write.** A chunk is not readable on the node that accepted it for about a second, and Bee answers a missing chunk and an unreadable one the same way (T18, measured 2026-09-21). The feed therefore keeps the update this device just wrote in memory and serves it from there, and the index probe before a write is a positive conflict signal only: it can prove a conflict, never prove its absence (D6).

**Timing.** From `createBatch` confirmation to a batch usable on an arbitrary node: about 2 minutes on Sepolia. Funding starts right after sign-in; writes queue locally until `health().usable`; the dapp gets a pending state to show.

**Cost on the day of S3** (Sepolia price 48 035 PLUR per chunk per block): depth 17 for 7 days ≈ 0.03 BZZ; depth 20 for 30 days ≈ 1.1 BZZ. Mainnet prices differ; the SDK quotes from `/chainstate` before buying.

## Modules

```
packages/dappdata/src/
  entropy/     wallet, mnemonic, passkey sources           (written, D21)
  derive/      derivation message, HMAC KDF, folder keys, sub-keys (written, D15, D16, D17, D21)
  envelope/    frame, encrypt, inline-vs-ref; pure, any key  (written, D20, D22)
  transport/   Bee routes behind an interface; fetch default, bee-js optional (written, D18)
  feed/        sequential feed read/write, index cache      (written, D5)
  slot/        public get/set/watch, expectIndex, migrate  (written, D6, D22)
  funding/     fund, quote, topUp, health, links; chains, ABI  (written, D3, D23)
  stamper/     client-side stamping, reserve-before-use state (written, D19)
  siwe/        contract-account check, 7702 designator      (written, D2, D25)
```

## Public API

Phase 1 implements everything below except the funding and stamper lines,
which are Phase 2. `packages/dappdata` matches this shape today.

```ts
import { DappData, entropy, transport } from "dappdata";

const dd = await DappData.connect({
  entropy: entropy.wallet(provider),          // EIP-1193, already signed in with SIWE; or entropy.mnemonic(words), entropy.passkey() (D21)
  app: { id: window.location.origin },        // or a declared identity for a Swarm-hosted dapp (D16)
  transport: transport.fetch("https://bee.example.org"),  // the default (D18); or dappdata/transport/bee-js, transport.custom(impl)
  stamp: batchId,                             // Phase 1: the caller supplies a batch; dd.funding lands in Phase 2
});

const prefs = dd.slot<Prefs>("preferences", { schema: 2, migrate });   // JSON by default; codec for raw bytes
const current = await prefs.get();          // { value, index, schema } | null
await prefs.set({ theme: "dark" }, { expectIndex: current?.index });   // typed conflict error if the feed moved (D6)
const stop = prefs.watch(({ value }) => render(value));   // polls with backoff; set() resolves on upload, not on sight

// Funding: the user owns the batch, anyone pays (D3, D12, D23)
const batch = await dd.funding.fund({ budget: { writesPerDay: 50, retentionDays: 90 } });
const { ttlSeconds } = await dd.funding.health(batch);

// For other libraries (D17, D19, D20)
const collabKey = dd.deriveKey("swarm-collaborative-docs");   // a PrivateKey the dapp may hold; cannot reach the folder
const stamper = dd.stamper(batch);                             // { stamp(address), state(), checkpoint() }
const box = await dd.encrypt(bytes, "project-keys");           // folder key, never leaves WebCrypto
```

The first block is the README example and fifteen lines is its budget; if the real API needs more, the API is wrong, not the budget. The rest is for library authors.

## Dependencies

- `@ethersphere/bee-js` **13.0.0** (pinned exact, D10) — an **optional peer** since D18 closed: it backs `dappdata/transport/bee-js`, for dapps that already ship it. The default transport does not use it, and the package root does not import it.
- `@ethersphere/core-sdk` **0.1.1** (pinned exact, D10) — browser-safe primitives: `PrivateKey`, `Topic`, `FeedIndex`, SOC/CAC builders, `Stamper` for client-side stamping (D12). No network I/O.
- `@noble/hashes`, `@noble/curves` — keccak, HMAC-SHA256 (the D15 KDF), PBKDF2, secp256k1 for feed signing. Small, audited, no native code.
- `@scure/bip39` — mnemonic validation and seed derivation for the D21 mnemonic source. Added 2026-09-21 with Peter's agreement: without the wordlist a typo opens a different, empty folder, which a user reads as lost data.
- `siwe` — message parsing only, if needed; the dapp does the sign-in.
- WebCrypto (platform) — AES-GCM.
- Dev: vitest, bee-factory, a test EIP-1193 signer with a fixed key.

Anything else: ask, then add to this list.

## Non-goals for v1

Sharing state between users (a dapp does that with swarm-collaborative-docs and the D20 envelope). Multi-writer beyond one user's devices. Structured queries (that is IDEA-166's recordstore, a later layer). Identity portability beyond the wallet (IDEA-176 / swarm-id territory; D8 decides how close we stand). Protocol changes of any kind.
