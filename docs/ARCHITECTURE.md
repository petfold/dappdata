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

**Derivation.**

```
sig      = eth_signTypedData_v4(derivationMessage)     // wallet
seed     = keccak256(sig)
feedKey  = HKDF-SHA256(seed, info="dappdata/feed/v1") mod n   (secp256k1 order; re-hash if 0)
encKey   = HKDF-SHA256(seed, info="dappdata/enc/v1")
```

The derivation message binds the dapp's origin, so each dapp gets its own feed owner. That is a privacy property (a dapp cannot enumerate another dapp's state) and a discoverability cost (see D7). The `scope` field is a version tag; changing it produces new keys, which is why it must never change without a migration path (Phase 4).

**What the dapp sees.** The derived address, so it can build feed references. Never `feedKey` or `encKey` directly; the SDK signs and decrypts internally. `encKey` is imported into WebCrypto as non-extractable. `feedKey` has to be used by a secp256k1 signer, so it stays a plain in-memory value with the shortest lifetime the session allows.

**Smart accounts.** ERC-1271 wallets cannot produce a deterministic secp256k1 signature. S1 decides the SDK's behaviour (D2); until then the SDK detects a contract account and refuses with a clear error.

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

> **Pending S3.** Direction as of 2026-09-03 is D3(d): the user *owns* the batch under the derived key (D12), anyone may *pay*, and the SDK stamps in the browser. If S3 confirms D12, mode A below is removed and mode B becomes the only model, with sponsorship as a parameter. Text below is the handoff design and is kept until then.

One interface, two adapters.

```ts
interface Funding {
  stampFor(write: PendingWrite): Promise<BatchId | ProxyRoute>;
  health(): Promise<{ ok: boolean; ttlSeconds?: number; warning?: string }>;
}
```

**Mode A — proxy.** Writes go to a gateway-proxy URL instead of a Bee node. The proxy attaches a stamp from the dapp's batch. Stateless, but it is an operated component, and an open one drains the batch: the proxy must accept writes only with a valid SIWE session token from the dapp (see THREATS T7).

**Mode B — sponsored batch.** The user owns an **immutable** batch (mutable batches overwrite old chunks when full and break feeds — S3 records the failure). The SDK helps buy one, watches its TTL, and exposes `sponsor.topUp(batchId, amount)` so the dapp or anyone else can extend it: `topUp` on the postage contract has no owner check; only `dilute` does. Onboarding friction is the cost; a dapp can pay the first batch and hand it over.

Both adapters are pluggable so the dapp switches with one line.

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
