# One signature, one folder: a shared derivation spec for swarm-id and dappdata

Draft for the swarm-id team (Swarm Foundation), from the dappdata side (Solar Punk, IDEA-190). 2026-09-06. Peter Földiák; drafted by Claude from `snaha/swarm-id` main at 2026-09-04 and the dappdata design docs.

## The problem in one paragraph

Swarm is about to have two ways for a dapp to give a user per-app keys and encrypted state: swarm-id, a hosted keystore with passkeys and wallets, and dappdata, an in-page SDK that derives everything from one wallet signature. They agree on almost every design choice. They disagree on one: what the identity is rooted in. If both ship as they are, the same user gets a different folder in every dapp depending on which SDK the dapp chose, and moving a dapp from one SDK to the other loses the user's data. A small ecosystem cannot afford that. We would like to fix it now, while swarm-id is 0.x and dappdata has no users, which are the only conditions under which it can be fixed at all.

## What we already agree on

Read from your code, not your README:

- Per-app isolation keyed by the app's origin (`deriveSecret(masterKey, appOrigin)`; our `HKDF(secret, "dappdata/seed/v1/" + app)`).
- One deterministic secret at the root, everything else derived, no key stored that can be re-derived.
- The user owns the postage batch; a derived key signs stamps in the client; any node can upload.
- Encrypted state in feeds owned by a derived key.
- Refuse ERC-1271 wallets because their signatures are not reproducible.
- Canonicalise the wallet signature before it becomes key material (your `signature.ts`; our D15).
- Both projects serve apps from a shared gateway origin (`swarm.snaha.net/id` and `/demo` on your side) and both need an app identity that is not the browser origin.

## The one difference

In swarm-id the account is a random BIP-39 seed. A passkey, a wallet signature or a password only unlocks a device-local vault that holds that seed. On a new device the user needs the recovery phrase.

In dappdata the wallet signature over a fixed EIP-712 message *is* the root. There is no seed to store, no vault and no phrase. Any device with the wallet reproduces the same keys.

Neither is wrong. Yours serves users with no wallet and protects keys from XSS by keeping them off the dapp's origin. Ours serves users who already signed in with a wallet and needs no infrastructure. They should be two profiles of one spec, not two specs.

## The proposal

**P1. One derivation spec, two implementations.** A short document with test vectors, co-owned, that fixes:

- The wallet message. EIP-712, domain `{ name, version }` with no `chainId` (MetaMask rejects a domain chain that differs from the wallet's current chain, and a chain-bound key is a different key per chain). Fields the user can read in the wallet prompt: purpose, account, app, scope.
- Canonicalisation: your rules for compact and EIP-155 forms, plus low-s. Root secret = `keccak256(r ‖ s)`.
- The KDF chain, using your primitive `deriveSecret(key, context) = HMAC-SHA256(key, utf8(context))`. dappdata drops HKDF and adopts this.
- The context strings for the app seed, the feed key, the encryption key, the stamp signer and app-chosen sub-keys (`deriveAppSecret(label)` in your API, `deriveKey(purpose)` in ours; same function, same labels).
- The app identity: browser origin by default, a declared identity for gateway-hosted apps, with the phishing consequence written down.

**P2. A wallet-rooted account kind in swarm-id.** Beside the seed account, an account whose master key is the spec's root secret. No vault, no phrase. Your own `generateMasterKey` comment says "in production, this would be derived". Everything below the master key stays as it is. A wallet user then gets the same per-app folder whether the dapp integrates swarm-id or dappdata.

**P3. swarm-id as an entropy source for dappdata.** dappdata takes its root through an `EntropySource` interface (wallet today, mnemonic next, passkey PRF later). `deriveAppSecret` is enough for swarm-id to be one. A dapp that wants your keystore and our slot API gets both without a second identity.

**P4. Shared formats, later.** An encryption envelope (AES-256-GCM, mandatory additional data, a schema byte) and a stamper state format that lets a batch be handed between implementations. Not needed for P1 to be useful.

## What each side keeps

swarm-id keeps the hosted keystore, passkeys, password accounts, the mutable-batch partition lease, the account bus, Safari support and the funding UI. dappdata keeps the in-page profile with no third-party origin, immutable batches, bee-js 13 and the one-package integration. Neither codebase merges into the other. Neither team takes on the other's roadmap.

## Why now

Your `AGENTS.md`: "While the version is 0.x we consider the project pre-production: a schema, wire format, storage key, or protocol may change in place." dappdata has finished its Phase 0 spikes and writes its derivation spec next. The root secret, the KDF chain and the app identity cannot move after the first real user on either side. This is a two- to three-week window of cheap agreement followed by a permanent one.

## What we are asking for

1. A call within two weeks.
2. Agreement on P1 as a short spec with test vectors, in a shared repository or as a SWIP. We will write the first draft.
3. A decision on P2. If yes, we align our Phase 1 to your context strings before we ship. If no, we still adopt your KDF primitive and canonicalisation, so a later change of mind stays cheap.

## What we are not asking for

Merging codebases. Changing your bee-js pin or ours. dappdata depending on swarm-id's hosted domain, or swarm-id depending on dappdata's package. One organisation owning the other's roadmap.

## References

- swarm-id: `lib/src/utils/key-derivation.ts`, `ui/src/lib/crypto/eth-wallet.ts`, `ui/src/lib/crypto/signature.ts`, `lib/src/schemas.ts` (SyncedAccountSchemaV1), docs-site "Multi-Device Postage Batches", "Key derivation (the interop root)".
- dappdata: `docs/ARCHITECTURE.md` (Identity and keys), `docs/DECISIONS.md` D1, D2, D8, D15, D16, D17, D21, D24; `spikes/s1/RESULTS.md` (determinism across MetaMask, Rabby, ethers, eth-sig-util, viem).
- Ideabox: IDEA-190 (dappdata), IDEA-176 (Swarm ID core storage).
