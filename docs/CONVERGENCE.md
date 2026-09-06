# Convergence with swarm-id

Status: assessment, 2026-09-06 (Claude, for Peter). Decision item: D24 in `DECISIONS.md`. The argument written for the swarm-id team is `PROPOSAL-swarm-id.md`.

Question asked: can dappdata and swarm-id converge, what would each give up, and can dappdata move toward swarm-id without giving up its aims? fdp-storage is covered at the end; it is prior art, not a convergence candidate.

## What swarm-id is, from its code

Read from `snaha/swarm-id` main at 2026-09-04 (one author, Attila Gazso; copyright "The Swarm Authors"; Apache-2.0; library `@snaha/swarm-id` 0.3.0; bee-js `^11.1.1`). Their `AGENTS.md` says: **pre-production while 0.x, formats may change in place, no migration owed.** That is the window for alignment.

**The account is a random BIP-39 seed.** `schemas.ts`: "There is exactly one kind of account: a BIP-39 seed account. What used to be distinct types (passkey / ethereum / agent) were really just different ways of protecting the seed." The seed's private key at the first BIP-44 path is the master key; its address is the account id.

**Access methods only lock the vault.** The encrypted seed lives in device-local storage and "never leaves the device". Three ways to derive the vault key:

- Passkey: WebAuthn PRF output, salt bound to the swarm-id hostname (`passkey.ts`).
- Wallet: `personal_sign` over a fixed text (`eth-wallet.ts`: "Swarm ID / Sign this message to encrypt your recovery phrase on this device. / v1"), signature canonicalised to 65 bytes with v in 27/28 (`signature.ts`), then a KDF with a random per-account salt. ERC-1271 wallets are rejected up front, as in our D2.
- Password: PBKDF2.

So the wallet signature is **not** the identity root. It unlocks a seed that was generated at random. A wallet user on a fresh device has no vault, and as far as the code shows the way back is the recovery phrase (alone, or with a `.swarmid` backup file). This corrects the earlier note in this session that said swarm-id seeds its master key from the signature.

**Key hierarchy** (`key-derivation.ts`, one primitive: `deriveSecret(keyHex, context) = HMAC-SHA256(bytes(keyHex), utf8(context))`):

```
masterKey (seed private key)
  ├─ appSecret         = deriveSecret(masterKey, appOrigin)          per connected app
  │    └─ dapp-visible = deriveSecret(appSecret, label)              client.deriveAppSecret(label)
  └─ derivationKey     = deriveSecret(masterKey, "derivation-key")   stored in the synced account
       ├─ swarmEncryptionKey = deriveSecret(derivationKey, "swarm-encryption")
       │    └─ backupKey     = deriveSecret(swarmEncryptionKey, "backup-key")   → backupSigner owns every feed and lock SOC
       └─ postageSignerKey   = deriveSecret(derivationKey, "postage-signer")    → signs stamps client-side
```

The dapp never holds `appSecret`; it gets `deriveAppSecret(label)` and everything else (uploads, feeds, stamping) runs in the iframe on the swarm-id origin.

**Storage and funding.** One mutable batch per account, shared by all devices through a partition lease (K=2 lanes per bucket, lock SOC on a reserved slot, 10 s refresh, 30 s TTL). Account state syncs through per-device epoch feeds folded on read. Funding: the fund.bzz.limo widget by default, a built-in multichain flow, and an optional subsidised gateway (the dapp operator's node with a public batch, which is the mode A we dropped in D3).

## Where the two already agree

Per-app isolation keyed by origin. Deterministic derivation from one secret. Client-side stamping with a derived signer on a user-owned batch. Encrypted state in feeds the derived key owns. Refuse contract wallets. Canonicalise the signature before it becomes key material (their `signature.ts` is our D15). Both hit the gateway-hosted-app problem: their own deployment serves the identity UI and the demo from one origin, `swarm.snaha.net/id` and `/demo`, which is D16's case.

That is most of our Phase 1 and 2. The disagreement is narrow and structural.

## The structural difference, stated once

| | dappdata | swarm-id |
|---|---|---|
| Root of identity | The wallet signature over a fixed EIP-712 message | A random BIP-39 seed |
| What a fresh device needs | The wallet | The recovery phrase (or the device-local vault) |
| Where keys live at runtime | In the dapp page, in memory | In an iframe on a trusted origin |
| Operated components | None | Identity UI, signaling relay, optional gateway |
| Per-app scope | One folder, one batch owner per app | One account, one batch, per-app secrets under it |

Each side's strength is the other's weakness. Their keystore-in-iframe protects against XSS in the dapp better than we do (our T10 mitigation is "shortest lifetime in memory"). Our wallet-rooted identity needs no phrase, no vault, no third-party origin, and works with one npm package.

## Three futures

**1. Full convergence: dappdata builds on swarm-id.** dappdata becomes a slot API over `SwarmIdClient`. Gives up: no third-party origin (the canvas premise), single-package adoption, the wallet as the only identity, bee-js 13. Gains: passkeys, password accounts, Safari, the keystore's XSS protection, multi-device stamping today. Verdict: too much. It removes the reason the project exists, and it binds a Solar Punk deliverable to a 0.x Foundation service with one maintainer.

**2. Competition: two SDKs, two folders.** Costs the ecosystem, not us: a user's data in one dapp is unreachable from a dapp that chose the other SDK, and every dapp author has to pick a side. This is the default if nobody acts.

**3. One spec, two profiles.** Agree the derivation, the app identity, and later the envelope and stamper state. dappdata is the in-page, zero-infrastructure profile. swarm-id is the hosted-keystore profile with passkeys and passwords. A wallet user gets the same per-app folder through either. Dapps pick a profile; users do not lose data when a dapp switches. Codebases stay separate, owners stay separate. **Recommended.**

## What dappdata can adopt from swarm-id without giving up its aims

Principles that stay: no operated service in the dependency list; identity is the wallet the user already proved with SIWE; derivation is a pure function of one signature; one package; immutable batches with the never-reuse-a-slot rule; browser-first on bee-js 13.

Things we can take, in order of cost:

1. **Their KDF primitive and context-string convention.** `HMAC-SHA256(key, utf8(context))` chained, instead of HKDF with info strings. Equal strength for 32-byte keys, and it makes our chain expressible in their `deriveSecret`. Touches D15, D17, D21 (all open). Cost: a few lines and a paragraph of spec.
2. **Their signature canonicalisation rules** (EIP-2098 compact, EIP-155 folded v) in D15's normalisation, on top of low-s.
3. **`deriveAppSecret(label)` as the shape of D17.** Our `deriveKey(purpose)` becomes the same function under a different root. Agree the label strings for shared consumers (swarm-collaborative-docs).
4. **Commit-ordered handoff for D19.** Their rule: a write is not acknowledged until the bucket state that reserves its slots is published; a new device resumes at the published counter with no margin. Adopt the rule. Their on-Swarm counter format assumes rewriting reserved slots on a mutable batch, which our D4 rule forbids, so the format itself stays open.
5. **swarm-id as an `EntropySource`.** Already the D8 and D21 plan; needs their client to expose a root secret for the app, which `deriveAppSecret` does.
6. **A hosted-keystore profile of dappdata, later.** If T10 ever matters more than zero-infrastructure, the hosted profile is swarm-id, and with a shared spec we do not have to build it.

What we do not take: mutable batches and the partition lease as our write path (D4); the trusted origin and popup as a requirement; the subsidised gateway (D3); bee-js 11.

## What swarm-id would have to change to get closer

Small, and all inside their 0.x window:

1. **A wallet-rooted account kind.** Today the wallet unlocks a random seed. Add a kind where the seed *is* derived from the signature over the shared EIP-712 message, canonicalised and hashed as the spec says. No vault, no phrase, reproducible on any device from the wallet alone. Their `generateMasterKey` comment already anticipates a derived master key.
2. **A shared app identity field** in place of raw `appOrigin`: browser origin by default, a declared identity for gateway-hosted apps (D16). They need it for their own `/id` and `/demo` deployment.
3. **Publish the derivation as a spec with test vectors**, co-owned. Their multi-device page already calls its key derivation "the interop root" and is written to be re-implemented, so the habit exists.
4. **Agree label strings** for `deriveAppSecret` consumers.
5. Optional: expose the app secret through an interface dappdata can consume as an `EntropySource`.

Nothing structural: the hosted keystore, passkeys, password accounts, the partition lease, the account bus and the funding UI all stay as they are.

## Honest costs of the shared-spec route

- Coordination with a one-person Foundation project on its own schedule. If they say no, we lose nothing but the emails; D8 stands.
- A shared spec is a shared freeze. After the first real user on either side, the message, KDF chain and app identity cannot move without a joint migration.
- Two profiles still means two SDK surfaces for dapp authors. The spec removes user lock-in, not developer choice.
- Their per-account single batch and our per-app batch (D23) do not reconcile under one spec; a shared-spec user who moves between profiles keeps the folder but not the funding.

## fdp-storage

Prior art, not a convergence candidate: username-and-password identity, encrypted seed on Swarm, beta, low activity. Two things to keep: the pod-per-app model matches our folder-per-app, and their v0.18 format migration is the case D22 exists for. A possible later `entropy.fdp()` source for Fairdrive users is the only integration worth listing, and it is not worth building now.

## Recommendation

Take future 3. Open D24, send the proposal to the swarm-id author, and in the meantime adopt items 1 to 4 above in the Phase 1 spec, because they are good on their own merits and cost nothing if the proposal is declined.
