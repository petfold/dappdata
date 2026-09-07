# Covering notes for the swarm-id proposal

Drafts, 2026-09-06. Three variants of the same message, for three channels. The proposal itself is `PROPOSAL-swarm-id.md`; the reasoning is `CONVERGENCE.md`; the decision is D24. Nothing here has been sent.

## Who is who

- **Attila Gazso** wrote all of `snaha/swarm-id`: every commit, the `snaha.net` deployments, the docs. Copyright "The Swarm Authors", Apache-2.0. He is the swarm-id team. IDEA-176 calls the project "the SwarmID POC" and depends on it.
- **Valentin Végh** owns IDEA-176 (Swarm ID core storage, the Foundation-sponsored identity substrate). **Dániel Wéber** is its assignee. **András Arányi** moved it to Feasibility Study on 2026-09-04 and tied it to the Desktop / File Manager project.

## Recommended order

1. Message Attila directly (variant A). The decision is his, and the technical conversation is between the two codebases.
2. Post the comment on IDEA-176 the same day (variant B), so the Ideabox side knows the conversation is happening and why it matters to the Persistent Core.
3. Variant C only if Attila does not answer within a week and an introduction is needed.

Before sending any of them: share the artifact from its page menu, or point at the GitHub files instead. The artifact is private until shared.

Links to include: proposal page https://claude.ai/code/artifact/03ccc5b4-b778-4017-91fc-79c9b9874290; repo files https://github.com/petfold/dappdata/blob/main/docs/PROPOSAL-swarm-id.md and https://github.com/petfold/dappdata/blob/main/docs/CONVERGENCE.md.

---

## A. Direct message to Attila

**Subject: swarm-id and dappdata: one derivation spec while both are pre-user?**

Hi Attila,

I am building dappdata (Solar Punk, Ideabox IDEA-190, https://github.com/petfold/dappdata ): per-user dapp state on Swarm, keyed off the wallet a user already signed in with. One fixed EIP-712 / SIWE signature derives the app's feed key, encryption key and stamp signer; the user owns the batch; stamps are signed client-side; no server.

I read swarm-id's code this week, not just the README, and we agree on nearly everything: per-origin isolation, deterministic derivation from one secret, client-side stamping on a user-owned batch, encrypted feeds, refusing ERC-1271 wallets, canonicalising the signature before it becomes key material. Your `signature.ts` is a problem I had only just written down.

The one difference is the root. Your account is a random BIP-39 seed and the wallet unlocks a device-local vault, so a wallet user needs the phrase on a new device. In dappdata the signature is the root, so any device with the wallet reproduces the keys. If both ship as they are, the same user gets a different folder depending on which library a dapp picked, and moving a dapp between them loses the user's data.

I am not proposing a merge. I am proposing one derivation spec with two profiles: swarm-id as the hosted keystore with passkeys and passwords, dappdata as the in-page profile with no third-party origin. Concretely: a wallet-rooted account kind in swarm-id whose master key comes from a shared EIP-712 message, a co-owned spec with test vectors, and an agreed app identity for gateway-hosted apps (your `/id` and `/demo` deployment has the same problem we do). In return dappdata adopts your `deriveSecret` HMAC primitive and your canonicalisation rules. We are doing that part regardless.

What swarm-id gets out of it: wallet users who restore on a clean device from the wallet alone, no phrase; a SIWE-rooted account that puts swarm-id on the login every Ethereum dapp already uses, next to ENS and EFP, rather than a Swarm-specific one; and a path for dapps that start on dappdata to adopt swarm-id later without losing their users' data. The proposal has a section on this.

Your AGENTS.md says 0.x formats may change in place. dappdata has no users yet. That window closes at your 1.0 or our first adopter, whichever comes first, so I would like to talk within the next two weeks if you are open to it.

The proposal, two pages: see attached md file (also in the repo as docs/PROPOSAL-swarm-id.md, with the longer reading of your code in docs/CONVERGENCE.md). If I have misread anything in the code, I would like to know that first.

Peter

---

## B. Comment on IDEA-176

Cross-reference from IDEA-190 (dappdata). I have read the swarm-id code and drafted a proposal to Attila for a shared key-derivation spec between swarm-id and dappdata, before either has a real user. Full text: [artifact link] / docs/PROPOSAL-swarm-id.md in github.com/petfold/dappdata.

Two findings bear on this idea:

1. Success criterion "reconstructed on a clean device using Swarm ID's deterministic account authority". In swarm-id today the account is a random seed and the passkey, wallet or password only unlocks a device-local vault, so a clean device needs the recovery phrase. A wallet-rooted account kind, which the proposal asks for, makes the criterion hold for wallet users with nothing but the wallet.
2. The funding model here, user-owned batch created by another payer and extended by permissionless topUp, is what dappdata verified end to end on Sepolia in its S3 spike (github.com/petfold/dappdata/blob/main/spikes/s3/RESULTS.md): batch owned by a derived key, paid by a different key, stamped client-side, accepted by a node holding no batch, topped up by a non-owner, dilute refused to a non-owner. Happy to share the scripts if the Persistent Core provisioning service wants a starting point.

The proposal is not a merge: two profiles, one spec. Comments welcome here or on IDEA-190.

---

## C. Note to Valentin, if an introduction is needed

Hi Valentin,

I have sent Attila a proposal to align swarm-id and dappdata (IDEA-190) on one key-derivation spec while both are still pre-user, and posted a summary on IDEA-176 because two of its points touch the Persistent Core: clean-device restore without a recovery phrase, and the user-owned-batch funding model we have already verified on Sepolia. If there is a better channel to Attila than a cold message, or someone on the Foundation side who should be in the conversation, I would be glad of a pointer. The proposal is here: [artifact link].

Thanks,
Peter
