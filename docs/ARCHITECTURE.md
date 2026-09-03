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

## Identity and keys *(D1, D2, D8)*

**Two signatures at sign-in.** SIWE proves the address to the dapp; its message has a nonce, so its signature is different every time and useless as a seed. A second, fixed, EIP-712 message yields the derivation signature. The SDK asks for it once per session and keeps the result in memory only.

**The message (D1, from S1).** Domain `{ name: "dappdata", version: "1" }` with **no `chainId`**: a chain-bound domain would make the key depend on the chain the wallet happens to be on. Primary type `DappDataKey` with four string-ish fields: `purpose` ("Derive dappdata storage key"), `account`, `origin`, `scope` ("v1"). Wallets show these as labelled fields, so a user can spot a wrong origin. Reference implementation: `spikes/s1/src/derive.ts`.

**Fallback (D1).** If the wallet lacks `eth_signTypedData_v4`, the SDK signs the same fields as plain text with `personal_sign`. That yields a different key, so on restore the SDK reads under the typed-data key first and then under the fallback key, and writes with the method it read with. Rare in practice: both wallets tested support typed data.

**Provider.** The dapp passes an EIP-1193 provider; the SDK never reads `window.ethereum`. Several wallet extensions in one browser fight over that global, and EIP-6963 is the discovery path dapps already use.

**Derivation.**

```
sig      = eth_signTypedData_v4(derivationMessage)     // wallet
seed     = keccak256(sig)
feedKey  = HKDF-SHA256(seed, info="dappdata/feed/v1") mod n   (secp256k1 order; re-hash if 0)
encKey   = HKDF-SHA256(seed, info="dappdata/enc/v1")
```

The derivation message binds the dapp's origin, so each dapp gets its own feed owner. That is a privacy property (a dapp cannot enumerate another dapp's state) and a discoverability cost (see D7). The `scope` field is a version tag; changing it produces new keys, which is why it must never change without a migration path (Phase 4).

**What the dapp sees.** The derived address, so it can build feed references. Never `feedKey` or `encKey` directly; the SDK signs and decrypts internally. `encKey` is imported into WebCrypto as non-extractable. `feedKey` has to be used by a secp256k1 signer, so it stays a plain in-memory value with the shortest lifetime the session allows.

**Smart accounts (D2).** ERC-1271 wallets and passkey wallets cannot produce a deterministic secp256k1 signature. The SDK checks `eth_getCode` before asking for a signature and refuses a contract account with a typed error the dapp can show. The seed comes in through an `EntropySource` interface (D8) whose default is the wallet signature, so an identity layer that holds a seed for such users can plug in later.

## Storage layout

**Topic.** `topic = keccak256("dappdata/v1/" + origin + "/" + slotName)`. One feed per slot. *(D7 may add a mapping feed that lists a user's slots.)*

**Feed type.** Sequential. Each update is a single-owner chunk at the next index.

**Envelope.** The feed payload is a small binary frame:

```
version(1) | alg(1) | mode(1) | nonce(12) | body
mode = INLINE   body = ciphertext of the state value (≤ ~3.9 KB after framing)
mode = REF      body = 64-byte encrypted Swarm reference to an uploaded blob
```

Inline when the value fits a chunk; otherwise the SDK uploads the value with Swarm's built-in encryption (which gives a 64-byte reference containing the decryption key) and stores that reference in the envelope, encrypted again with `encKey`. Readers never learn which mode a slot uses without the key.

**Encryption *(D9)*.** Working assumption: AES-256-GCM through WebCrypto with `encKey`, random 96-bit nonce per write, topic as additional authenticated data so a payload cannot be replayed into another slot. ACT is not used for v1: there is one reader, the user; ACT's grantee model adds nothing yet. Revisit if sharing between users enters scope.

**Size limit.** A chunk holds 4096 bytes of data. The framing costs a few dozen bytes. The SDK measures the ciphertext and picks the mode; the caller never sees the boundary.

## Writes, reads, and consistency *(D6)*

- `set` reads the latest index, writes index+1, then confirms by reading back. A failed read-back within the D5 window is reported, not swallowed.
- Same-index overwrites are unreliable on Swarm; the SDK never attempts one.
- Consistency is eventual. `get` returns the latest value the endpoint can see, with the index, so a dapp can detect that it went backwards.
- **Multi-device.** Two devices with the same derived key are two writers on one feed. M0 offers no protection beyond the read-before-write and the index in the result. Phase 4 chooses between: retry-on-race with a conflict callback; one feed per device plus a merge step; or a CRDT layer reusing swarm-collaborative-docs (Yjs over feeds). Keep the CRDT path separable.
- `watch` polls read-latest at an interval derived from the D5 visibility window; a push path (GSOC or PSS) is a later option, not M0.

## Funding *(D3, D4, D12)*

One model: **the user owns the batch, anyone pays, the SDK stamps.** Settled by S3 (`spikes/s3/RESULTS.md`); the earlier two-adapter design with a stamping proxy is gone.

**Owner.** The postage batch's `_owner` is the derived storage key's address (D12). The user's wallet never signs stamps and never holds the batch; the SDK signs stamps with the derived key using core-sdk's `Stamper`, and uploads pre-stamped chunks through `POST /soc/{owner}/{id}` on any Bee HTTP endpoint that allows CORS. The endpoint holds no batch and no funds.

**Payer.** Whoever calls `createBatch(owner, …)` or `topUp(batchId, …)` on the postage contract: the user, the dapp operator, a sponsor. Same code path, one function:

```ts
interface Funding {
  /** Buys or extends the user's batch. Payer is whoever signs the transaction. */
  fund(opts: { owner: EthAddress; depth: number; amountPerChunk: bigint; batchId?: BatchId }): Promise<BatchId>;
  /** Where the user can get xBZZ and xDAI; the SDK links out, it does not swap. */
  fundingLinks(): FundingLink[];   // Jumper first (D3)
  health(batchId: BatchId): Promise<{ usable: boolean; ttlSeconds: number; usage: number }>;
}
```

**Batch type.** Immutable, depth chosen for the slot count the dapp expects; the SDK refuses mutable batches. The protection against overwrites is the SDK's, not the flag's (D4): stamper bucket state is persisted with the slot metadata, restored before the first write on a new device, and the SDK stops at capacity and asks for a new batch. A reused slot silently replaces the earlier chunk on the network, immutable or not.

**Timing.** From `createBatch` confirmation to a batch usable on an arbitrary node: about 2 minutes on Sepolia. Funding starts right after sign-in; writes queue locally until `health().usable`; the dapp gets a pending state to show.

**Cost on the day of S3** (Sepolia price 48 035 PLUR per chunk per block): depth 17 for 7 days ≈ 0.03 BZZ; depth 20 for 30 days ≈ 1.1 BZZ. Mainnet prices differ; the SDK quotes from `/chainstate` before buying.

## Modules

```
packages/dappdata/src/
  derive/      derivation message, HKDF, key handling      (Phase 1)
  envelope/    frame, encrypt, inline-vs-ref                (Phase 1)
  feed/        sequential feed read/write over bee-js       (Phase 1)
  slot/        public get/set/watch                         (Phase 1)
  funding/     Funding interface; proxy and batch adapters  (Phase 2)
  siwe/        helpers to detect a contract account, read origin   (Phase 1)
```

## Public API (sketch)

```ts
import { DappData, funding } from "dappdata";

const hc = await DappData.connect({
  provider,                               // EIP-1193, already signed in with SIWE
  dapp: { origin: window.location.origin },
  bee: { url: "https://bee.example.org" },     // transport; in-browser node later (D13)
  funding: funding.proxy({ url: "https://proxy.example.org", session: siweToken }),
  // or: funding.batch({ sponsor: "0x..." })
});

const prefs = hc.slot<Prefs>("preferences");
const current = await prefs.get();        // { value, index } | null
await prefs.set({ theme: "dark" });
const stop = prefs.watch(({ value }) => render(value));
```

Fifteen lines is the budget for the README example; if the real API needs more, the API is wrong, not the budget.

## Dependencies

- `@ethersphere/bee-js` **13.0.0** (pinned exact, D10) — feeds, SOCs, uploads, stamps, the HTTP transport to a Bee node.
- `@ethersphere/core-sdk` **0.1.1** (pinned exact, D10) — browser-safe primitives: `PrivateKey`, `Topic`, `FeedIndex`, SOC/CAC builders, `Stamper` for client-side stamping (D12). No network I/O.
- `@noble/hashes`, `@noble/curves` — keccak, HKDF, secp256k1 for feed signing. Small, audited, no native code.
- `siwe` — message parsing only, if needed; the dapp does the sign-in.
- WebCrypto (platform) — AES-GCM.
- Dev: vitest, bee-factory, a test EIP-1193 signer with a fixed key.

Anything else: ask, then add to this list.

## Non-goals for v1

Sharing state between users. Multi-writer beyond one user's devices. Structured queries (that is IDEA-166's recordstore, a later layer). Identity portability beyond the wallet (IDEA-176 / swarm-id territory; D8 decides how close we stand). Protocol changes of any kind.
