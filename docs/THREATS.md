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
**Passkeys (D21, 2026-09-22).** A passkey lost with its device ecosystem is the folder lost, and passkeys do not sync across ecosystems, so an iCloud passkey and a Google one open two folders. The SDK says so; the way to make them one folder, and to survive a lost passkey with a second one, is the wrapped folder seed of D28.

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
**Mitigation.** `funding.health()` reports TTL, computed from the postage contract rather than from the node, whose `batchTTL` was 400 times too long on Sepolia (gate run, 2026-09-21); the SDK warns below a threshold; `topUp` is permissionless so the dapp or a sponsor can act without the user. **Status:** open until Phase 2.
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
A device with a blank or old `Stamper` bucket state reuses slots; the network replaces the earlier chunk and the node answers 201 (S3). Immutable batches do not prevent it (D4). The IDEA-198 study named the mechanism from Bee 2.8.2 source: `Reserve.Put` keys its stamp index on `(batchID, stampIndex)` alone and replaces the earlier chunk whenever the new stamp is newer, with no branch on the immutable flag; the only immutable-aware code is the node's own `StampIssuer`, which never runs for a pre-stamped upload (`docs/REVIEW-IDEA-198.md`, item 14).
**Mitigation.** D19: bucket state checkpointed to a reserved slot, restored before the first write on a new device, then advanced by a safety margin; the SDK stops at capacity rather than reuse. **Status:** open until D19 (Phase 2). Promised in D4's consequences on 2026-09-04; written here 2026-09-05.
**Proven on Sepolia (2026-09-21).** Two devices sharing one checkpoint, stamping into one bucket, took disjoint slots; the run before the fix did not, and that interleaving is now a regression test (D19). The remaining hole was the slot-backed checkpoint store, which could not stamp itself and so was not the default a user got.
**Lookahead landed (2026-09-22).** The slot store names the addresses its next write will need and the stamper reserves them inside the checkpoint it writes, so the default store pays for itself (D19). The slot write's `expectIndex` turns a simultaneous checkpoint by another device into a `CheckpointConflictError`, and the stamper restarts from the winner's lines, which a shared file could not do. **Status:** mitigated by default; the residual is the T18 propagation window on the checkpoint feed, shared with D6.

### T13 — Signature encoding splits a user into two folders
The same account signs the same message; one wallet reports `v` as 27, another as 0, or one emits high-`s`; `keccak256(sig)` differs and the user lands in an empty folder.
**Mitigation.** D15: seed from `r ‖ s` with low-`s`, plus public-key recovery as a check. **Status:** open until D15.

### T14 — A declared app identity widens the phishing surface
With app binding (D16) a phishing site can put the real dapp's `app` value in its own request. The wallet still shows the requesting site, but users of gateway-hosted dapps are used to seeing a gateway hostname there, so the signal is weaker than for a conventional dapp.
**Mitigation.** Origin binding stays the default. Dapps that choose app binding say so in their UX; a Phase 4 option verifies the ENS contenthash against the loaded bundle. **Status:** open; decided with D16.

### T15 — Shared origin on a Swarm gateway
On a path-based gateway every app shares one origin. Keys stay in memory and are safe; anything the SDK caches locally (feed index cache, stamper bucket state) can be read or altered by another app on the same gateway. Altered stamper state could point the SDK at used slots (T12); a poisoned index cache yields stale reads.
**Mitigation.** Local caches are hints: the slot checkpoint wins over the local stamper cache and buckets never move backwards; a stale index is caught by read-latest on a miss. The Phase 3 integration guide recommends subdomain gateways to Swarm-hosted dapps. **Status:** mitigated for the stamper by D19's slot checkpoint (2026-09-22); the cache half stays as described.
**Passkeys on a shared origin (D21, 2026-09-22).** A passkey belongs to the relying-party domain, so on a path-based gateway it is the gateway's passkey, shared by every dapp there, and a PRF prompt shows the user nothing to read: a co-hosted dapp can request the same PRF output silently and derive any other dapp's seed on that gateway, since the app id is public. The wallet prompt at least shows the `app` field (T1); PRF has no equivalent. Subdomain gateways, or a declared identity the dapp controls, are the remedy; the integration guide says so.

### T16 — A sub-key leaks
A dapp holds a D17 sub-key in memory and loses it to XSS or a bad dependency.
**Accepted, bounded by design.** The attacker gets what that library wrote under that key; the folder keys derive through other `info` strings and cannot be reached from a sub-key. Same lifetime rules as `feedKey` (T10). **Status:** accepted once D17 closes.

### T17 — The ecosystem moves to accounts that cannot sign deterministically
New-user wallets shift to passkey-owned smart accounts (ERC-4337, Coinbase Smart Wallet) whose ERC-1271 signatures are WebAuthn assertions and differ every time. D2 refuses them, so dappdata's reachable user base shrinks as the trend runs. A second, self-inflicted form: EIP-7702 upgraded EOAs still sign deterministically but return code from `eth_getCode`, and a naive check refuses them too.
**Mitigation.** D25: treat the 7702 delegation designator as an EOA (Phase 1); ship the WebAuthn PRF entropy source in Phase 2, with the PRF-unlocks-a-seed variant evaluated so a lost or non-synced passkey is not a lost folder; verify one embedded-wallet provider in the Phase 3 matrix. Login format risk (SIWE replaced) is not a threat: the derivation message is our own. **Status:** open until D25 items close.

### T18 — A write is invisible for as long as a retrieval takes, and a client cannot tell "missing" from "unreadable"
First seen on bee-factory with Bee 2.8.2 (2026-09-21): a chunk the node has just accepted answers `GET /chunks` with **500 `read chunk failed`** and the feed lookup with 404 for roughly a second, then both answer 200. A chunk that was never written answers the same 500 forever. So the index probe that guards a write (D6) cannot distinguish "nobody has written here" from "somebody wrote here a moment ago", and two devices writing inside that window both believe the index is free. One update then replaces the other at the same feed address, and neither client sees an error.
**The mechanism, from Bee's source and a Sepolia measurement (2026-09-22, `spikes/phase2/RESULTS.md`).** `POST /soc` pushes directly to the network unless asked otherwise, and a light node keeps no copy of a directly pushed chunk; `GET /chunks` is a local lookup and then a network retrieval. So "the node accepted it" and "the node can read it back" are separated by the network's retrieval readiness: about 270 ms on a mainnet light node (IDEA-198), about a second on bee-factory, **50–60 s on Sepolia**, chequebook funded or not. The 500 is a failed retrieval. Deferred upload keeps the copy only until the pusher has a receipt; pinning keeps it. And a read of an index nobody has written costs a full retrieval attempt, 3.6–9 s, which every warm read and every write used to pay.
**Reported upstream (2026-09-21).** ethersphere/bee#5624 asks Bee to stop sharing one status code between "retrieval found nothing" and "something broke" (its OpenAPI already documents 404 for `/chunks`); ethersphere/bee-js#1263 is why the node's message never reached us in the first place. Neither would make absence provable — that part is inherent — but a 404 would let the SDK drop its message matching.
**Mitigation.** The writer serves its own last write from memory, so a dapp never loses sight of what it just wrote. Reads by index are bounded by `probeTimeoutMs` (default 2 s) so a miss costs the bound, not the retrieval. A node the user runs can be given `transport.fetch(url, undefined, { deferred: true, pin: true })`, and then every tab and every reload reads the user's writes from that node at once. `expectIndex` catches every conflict outside the window, and `merge` resolves it; the stamper's checkpoint conflict works the same way. Inside the window nothing client-side can help: closing it is D6's settle wait or per-device feeds, decided in Phase 4 with the mainnet number. The Phase 3 demo writes from one device at a time and says so. **Status:** open until D6; quantified per network.

## Not in scope

Compromise of the wallet itself. Compromise of the Bee node the dapp points at (it sees ciphertext and metadata only). Denial of service against Swarm.
