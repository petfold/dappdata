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

**Fallback (D1).** If the wallet lacks `eth_signTypedData_v4`, the SDK signs the same fields as plain text with `personal_sign`. That yields a different key, so on restore the SDK reads under the typed-data key first and then under the fallback key, and writes with the method it read with. Rare in practice: both wallets tested support typed data.

**Provider.** The dapp passes an EIP-1193 provider; the SDK never reads `window.ethereum`. Several wallet extensions in one browser fight over that global, and EIP-6963 is the discovery path dapps already use.

**Derivation.**

```
sig      = eth_signTypedData_v4(derivationMessage)     // wallet; or another EntropySource (D21)
secret   = keccak256(r ‖ s_low)                        // D15: not the 65-byte signature; v is encoding, s normalised low
seed     = HKDF-SHA256(secret, info="dappdata/seed/v1/" + app)   // D21: the same app binding for every source
feedKey  = HKDF-SHA256(seed, info="dappdata/feed/v1") mod n   (secp256k1 order; re-hash if 0)
encKey   = HKDF-SHA256(seed, info="dappdata/enc/v1")
subKey   = HKDF-SHA256(seed, info="dappdata/sub/v1/" + purpose) mod n   // D17: the one key the dapp may hold
```

The derivation message binds the app identity (D16), so each dapp gets its own feed owner. That is a privacy property (a dapp cannot enumerate another dapp's state) and a discoverability cost (see D7). The `scope` field is a version tag; changing it produces new keys, which is why it must never change without a migration path (Phase 4).

**What the dapp sees.** The derived address, so it can build feed references. Never `feedKey` or `encKey` directly; the SDK signs and decrypts internally. `encKey` is imported into WebCrypto as non-extractable. `feedKey` has to be used by a secp256k1 signer, so it stays a plain in-memory value with the shortest lifetime the session allows. Sub-keys are the exception *(D17)*: `deriveKey(purpose)` returns a key the dapp may hand to another library; it cannot reach the folder keys.

**Smart accounts (D2).** ERC-1271 wallets and passkey wallets cannot produce a deterministic secp256k1 signature. The SDK checks `eth_getCode` before asking for a signature and refuses a contract account with a typed error the dapp can show. The seed comes in through an `EntropySource` interface (D8) whose default is the wallet signature, so an identity layer that holds a seed for such users can plug in later. D21 adds a mnemonic source now and passkeys over WebAuthn PRF later; every source passes through the same app binding.

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

**Encryption *(D9)*.** Working assumption: AES-256-GCM through WebCrypto with `encKey`, random 96-bit nonce per write, topic as additional authenticated data so a payload cannot be replayed into another slot. ACT is not used for v1: there is one reader, the user; ACT's grantee model adds nothing yet. Revisit if sharing between users enters scope.

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

**Owner.** The postage batch's `_owner` is the derived storage key's address (D12). The user's wallet never signs stamps and never holds the batch; the SDK signs stamps with the derived key using core-sdk's `Stamper`, and uploads pre-stamped chunks through `POST /soc/{owner}/{id}` on any Bee HTTP endpoint that allows CORS. The endpoint holds no batch and no funds.

**Stamper as a service *(D19)*.** `stamper(batchId)` exposes `stamp(address)`, `state()` and `checkpoint()` to any library that writes on the user's behalf. The SDK owns the bucket state: in memory, cached locally as a hint, checkpointed to a reserved slot every N stamps or T seconds. A new device restores the checkpoint and advances every bucket by a safety margin before its first stamp. A bucket never moves backwards, whatever a local cache says (T15).

**Payer.** Whoever calls `createBatch(owner, …)` or `topUp(batchId, …)` on the postage contract: the user, the dapp operator, a sponsor. Same code path, one function:

```ts
interface Funding {
  /** Buys or extends the user's batch. Payer is whoever signs the transaction. */
  fund(opts: { owner: EthAddress; depth: number; amountPerChunk: bigint; batchId?: BatchId }): Promise<BatchId>;
  /** D23: or declare a budget and let the SDK size depth and amount from it. */
  fund(opts: { owner: EthAddress; budget: { writesPerDay: number; retentionDays: number }; batchId?: BatchId }): Promise<BatchId>;
  /** Where the user can get xBZZ and xDAI; the SDK links out, it does not swap. */
  fundingLinks(): FundingLink[];   // Jumper first (D3)
  health(batchId: BatchId): Promise<{ usable: boolean; ttlSeconds: number; usage: number }>;
}
```

**Batch type.** Immutable, depth chosen for the slot count the dapp expects; the SDK refuses mutable batches. The protection against overwrites is the SDK's, not the flag's (D4): stamper bucket state is persisted with the slot metadata, restored before the first write on a new device, and the SDK stops at capacity and asks for a new batch. A reused slot silently replaces the earlier chunk on the network, immutable or not.

**Granularity *(D23)*.** One batch per user per app, because the owner key is per app. `fund()` takes a write budget (writes per day, retention days) and sizes depth and amount from it, including the D19 safety margin; `health()` turns TTL into days of storage left for the dapp to show. `docs/FUNDING.md` (Phase 2) says plainly that each app brings its own batch and that a sponsor can top up any of them.

**Timing.** From `createBatch` confirmation to a batch usable on an arbitrary node: about 2 minutes on Sepolia. Funding starts right after sign-in; writes queue locally until `health().usable`; the dapp gets a pending state to show.

**Cost on the day of S3** (Sepolia price 48 035 PLUR per chunk per block): depth 17 for 7 days ≈ 0.03 BZZ; depth 20 for 30 days ≈ 1.1 BZZ. Mainnet prices differ; the SDK quotes from `/chainstate` before buying.

## Modules

```
packages/dappdata/src/
  entropy/     wallet, mnemonic, later passkey sources     (Phase 1, D21)
  derive/      derivation message, HKDF, folder keys, sub-keys   (Phase 1, D15, D16, D17)
  envelope/    frame, encrypt, inline-vs-ref; pure, any key  (Phase 1, D20, D22)
  transport/   Bee routes behind an interface; http default (Phase 1, D18)
  feed/        sequential feed read/write over the transport (Phase 1)
  slot/        public get/set/watch, expectIndex, migrate  (Phase 1, D6, D22)
  funding/     Funding interface: fund, fundingLinks, health (Phase 2, D3, D23)
  stamper/     client-side stamping, bucket state, checkpoints  (Phase 2, D19)
  siwe/        helpers to detect a contract account, read origin   (Phase 1)
```

## Public API (sketch)

```ts
import { DappData, entropy, transport } from "dappdata";

const dd = await DappData.connect({
  entropy: entropy.wallet(provider),          // EIP-1193, already signed in with SIWE; or entropy.mnemonic(words) (D21)
  app: { id: window.location.origin },        // or a declared identity for a Swarm-hosted dapp (D16)
  transport: transport.http("https://bee.example.org"),   // or transport.custom(impl) over your own bee-js (D18)
});

const prefs = dd.slot<Prefs>("preferences", { schema: 2, migrate });
const current = await prefs.get();          // { value, index, schema } | null
await prefs.set({ theme: "dark" }, { expectIndex: current?.index });   // typed conflict error if the feed moved (D6)
const stop = prefs.watch(({ value }) => render(value));

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

- `@ethersphere/bee-js` **13.0.0** (pinned exact, D10) — feeds, SOCs, uploads, stamps, the HTTP transport to a Bee node. Under D18 it backs the default transport only; a caller may supply its own, and D18 measures whether a `fetch` transport over core-sdk can replace it.
- `@ethersphere/core-sdk` **0.1.1** (pinned exact, D10) — browser-safe primitives: `PrivateKey`, `Topic`, `FeedIndex`, SOC/CAC builders, `Stamper` for client-side stamping (D12). No network I/O.
- `@noble/hashes`, `@noble/curves` — keccak, HKDF, secp256k1 for feed signing. Small, audited, no native code.
- `siwe` — message parsing only, if needed; the dapp does the sign-in.
- WebCrypto (platform) — AES-GCM.
- Dev: vitest, bee-factory, a test EIP-1193 signer with a fixed key.

Anything else: ask, then add to this list.

## Non-goals for v1

Sharing state between users (a dapp does that with swarm-collaborative-docs and the D20 envelope). Multi-writer beyond one user's devices. Structured queries (that is IDEA-166's recordstore, a later layer). Identity portability beyond the wallet (IDEA-176 / swarm-id territory; D8 decides how close we stand). Protocol changes of any kind.
