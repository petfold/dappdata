# Threat model

What we protect, who might attack it, and what we do. Each item has a status: **open**, **mitigated** (with the mechanism), or **accepted** (with the reason). Phase 4 ends with no item left open.

## Assets

- **A1** The derivation signature and the keys derived from it (`feedKey`, `encKey`). Whoever holds them holds the user's state.
- **A2** The user's state in plaintext.
- **A3** Metadata: which derived address writes which topics, and when.
- **A4** Postage funds: the dapp's proxy batch, or the user's own batch.

## Threats

### T1 — Phishing for the derivation signature
A malicious site asks the user to sign the same derivation message a real dapp uses, then reads or overwrites the user's state.
**Mitigation.** The message binds the dapp origin in a field the wallet displays; a signature obtained on `evil.example` derives `evil.example`'s keys, not the real dapp's. Residual risk: a wallet that hides typed-data fields, or a user who does not read them. S1 screenshots every wallet prompt; wallets that hide the origin are marked in the D2 matrix.
**Status.** open until S1.

### T2 — Malicious or compromised dapp
The dapp itself has the plaintext; it can send it anywhere.
**Accepted.** This is true of any client-side app. What the SDK must not do is make it worse: it never returns `feedKey` or `encKey` to the dapp, and never sends them over the network. The user's protection against a bad dapp is the per-origin key (T1), which stops one dapp from reading another's state.

### T3 — Network observer
Anyone can read a public feed if they know owner and topic.
**Mitigation.** Encryption on by default; the envelope shows version and nonce, nothing else. Blobs use Swarm encryption and the reference is itself encrypted in the envelope. **Status:** mitigated in Phase 1 (D9).
**Residual.** Metadata (A3): the derived address, topic hashes, write timing, and payload size are visible. The derived address does not reveal the wallet address unless D7 publishes a mapping. Document this; do not claim more than we deliver.

### T4 — Key loss
The user loses the wallet, or the derivation message changes.
**Accepted, with duties.** No recovery exists and none is planned: a recovery path is a second key, and a second key is a second attack surface. The SDK docs say so in the first paragraph; the SDK gives the dapp a hook to show the warning. The derivation message carries a `scope` version so a deliberate change gets a migration path (Phase 4) instead of orphaning state.

### T5 — Stale or reordered state
Eventual consistency serves an older feed update; a device acts on it.
**Mitigation.** Every read returns the index; `set` does read-before-write; the dapp can detect going backwards. Multi-device races are D6. **Status:** partially mitigated in Phase 1; open until D6.

### T6 — Replay into another slot
An attacker copies an envelope from one topic's feed into another.
**Mitigation.** They cannot write to the feed at all without `feedKey`. Defence in depth: AES-GCM uses the topic as additional authenticated data, so a copied ciphertext fails to decrypt under another topic. **Status:** mitigated in Phase 1 (D9).

### T7 — Proxy abuse (funding mode A)
An open stamping proxy lets anyone drain the dapp's batch.
**Mitigation.** The proxy accepts writes only with a valid SIWE session token issued by the dapp; per-account rate limits; batch balance alerts. This lives in `infra/proxy/` config, not in advice. **Status:** moot if D3's draft closes as written (no stamping proxy in the SDK); kept for the record.

### T8 — Batch expiry (funding mode B)
The user's batch runs out; chunks are evicted; state is gone.
**Mitigation.** `funding.health()` reports TTL; the SDK warns below a threshold; `topUp` is permissionless so the dapp or a sponsor can act without the user. **Status:** open until Phase 2.
**Note.** Permissionless `topUp` is not a griefing vector: extending someone's TTL costs the sponsor and helps the owner. `dilute` is owner-only.

### T9 — Mutable batch corrupts feeds
A dapp configures a mutable batch; when it fills, old feed chunks are overwritten.
**Mitigation.** The SDK refuses mutable batches (D4) and quotes S3's recorded failure. **Status:** S3 done. Per the D4 draft the immutable flag is a marker, not a guarantee, so the protection that matters is the stamper-state rule in T12.

### T10 — XSS in the dapp steals keys from memory
**Mitigation.** `encKey` is a non-extractable WebCrypto key. `feedKey` must be usable by a JS secp256k1 signer, so it is a plain value; keep its lifetime to the session, never persist it, never log it. A future option is to move signing into a Worker with no shared scope. **Status:** accepted for v1 with the above; revisit in Phase 4.

### T11 — Cross-dapp enumeration
If D7 chooses a mapping feed, a third party who links the main address to the mapping key can list every dapp the user has state in.
**Status.** open; decided with D7. If we publish a mapping, it must itself be encrypted or opt-in.

### T12 — Lost or stale stamper state overwrites the user's own data
A device with a blank or old `Stamper` bucket state reuses slots; the network replaces the earlier chunk and the node answers 201 (S3). Immutable batches do not prevent it (D4).
**Mitigation.** D19: bucket state checkpointed to a reserved slot, restored before the first write on a new device, then advanced by a safety margin; the SDK stops at capacity rather than reuse. **Status:** open until D19 (Phase 2). Promised in D4's consequences on 2026-09-04; written here 2026-09-05.

### T13 — Signature encoding splits a user into two folders
The same account signs the same message; one wallet reports `v` as 27, another as 0, or one emits high-`s`; `keccak256(sig)` differs and the user lands in an empty folder.
**Mitigation.** D15: seed from `r ‖ s` with low-`s`, plus public-key recovery as a check. **Status:** open until D15.

### T14 — A declared app identity widens the phishing surface
With app binding (D16) a phishing site can put the real dapp's `app` value in its own request. The wallet still shows the requesting site, but users of gateway-hosted dapps are used to seeing a gateway hostname there, so the signal is weaker than for a conventional dapp.
**Mitigation.** Origin binding stays the default. Dapps that choose app binding say so in their UX; a Phase 4 option verifies the ENS contenthash against the loaded bundle. **Status:** open; decided with D16.

### T15 — Shared origin on a Swarm gateway
On a path-based gateway every app shares one origin. Keys stay in memory and are safe; anything the SDK caches locally (feed index cache, stamper bucket state) can be read or altered by another app on the same gateway. Altered stamper state could point the SDK at used slots (T12); a poisoned index cache yields stale reads.
**Mitigation.** Local caches are hints: the slot checkpoint wins over the local stamper cache and buckets never move backwards; a stale index is caught by read-latest on a miss. The Phase 3 integration guide recommends subdomain gateways to Swarm-hosted dapps. **Status:** open until D19.

### T16 — A sub-key leaks
A dapp holds a D17 sub-key in memory and loses it to XSS or a bad dependency.
**Accepted, bounded by design.** The attacker gets what that library wrote under that key; the folder keys derive through other `info` strings and cannot be reached from a sub-key. Same lifetime rules as `feedKey` (T10). **Status:** accepted once D17 closes.

## Not in scope

Compromise of the wallet itself. Compromise of the Bee node the dapp points at (it sees ciphertext and metadata only). Denial of service against Swarm.
