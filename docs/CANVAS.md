# IDEA-190 — Persistent dapp user state on Swarm

Copy of the Ideabox canvas as filed on 2026-09-03. Jira is authoritative for the idea's status; this copy exists so a Claude Code session has the *why* without a network call. If the canvas changes in Jira, update this file and note the date.

- Jira: https://solar-punk.atlassian.net/browse/IDEA-190
- Status at copy: Idea Canvas · Priority Medium · Owner and reporter: Peter Földiák
- Source thread: https://solar-punk-workspace.slack.com/archives/C079F2JEV5L/p1788423693286499

---

## 1. Problem / Opportunity

ERC-4361 (Sign-In with Ethereum) gives dapps passwordless, portable authentication: the user proves control of an Ethereum address and no password database is needed. But everything the user then does — preferences, documents, saves, drafts — still lands in a centralized backend, undoing the decentralization the sign-in achieved. Swarm can close that gap: per-user state keyed to the authenticated address, resolvable without any server, with funded persistence guarantees.

## 2. Description of the Idea

A pattern plus a small SDK (on bee-js) for per-user dapp state on Swarm, keyed by the user's SIWE identity.

* Key derivation: at sign-in the dapp asks the wallet for one deterministic, domain-bound signature (personal_sign/EIP-712); its hash seeds a Swarm storage key (feed owner key + encryption key). The SIWE address cannot own the feed directly: feed updates are raw-signed single-owner chunks, and browser wallets no longer expose raw secp256k1 signing (MetaMask removed eth_sign in 2024). The derived-key pattern is how dYdX and Loopring derive their L2 keys.
* State layout: user state lives in Swarm feeds owned by the derived key, encrypted by default. Small state fits directly in feed payloads (~4 KB per update); larger state is uploaded as a manifest with the feed holding the 32-byte reference.
* Funding: two modes. (a) The dapp stamps writes server-side via a stamping proxy (ethersphere/gateway-proxy already does this). (b) The user owns a postage batch and the dapp or a sponsor extends it via the permissionless topUp on the postage contract (no owner check; only dilute/upload are owner-only).
* Deliverables: a TypeScript library plus a reference dapp demonstrating cross-device state restore from nothing but the wallet.

## 3. Type of Idea

Developer tooling / integration pattern (SDK + reference implementation). No protocol changes; composes existing primitives (feeds, postage stamps, encryption, ACT).

## 4. Strategic Alignment

Moves Swarm from archival storage toward being the live state layer for dapps: every active user generates recurring small writes, i.e. recurring postage demand. Complements IDEA-176 (Swarm ID core storage — a deliberately bounded identity substrate whose scope-integrity criterion excludes arbitrary dapp state; this idea is that general dapp-state layer, and could reuse its sponsored user-owned-batch mechanics) and IDEA-166 (recordstore — a candidate structured/transactional state layer this SDK could sit on).

## 5. Target Audience

Dapp developers who want user persistence without operating a backend; end users who get portable, censorship-resistant app data under a key they already control; the Swarm ecosystem via recurring usage.

## 6. Market Situation & Competitive Landscape

The default today is a centralized DB (Firebase/Supabase/custom) keyed by wallet address. Web3-native analogues: Ceramic/ComposeDB (mutable streams with wallet sign-in — the closest analogue, but its own network without Swarm-style incentivized persistence), OrbitDB/Gun (no funded persistence guarantees). On Swarm: fdp-storage and fairOS-dfs (Fair Data Society) already offer personal dapp-data pods, but with their own mnemonic/password portable-account identity rather than SIWE; fdp-storage is beta with low activity (last commit June 2026), fairOS-dfs dormant since November 2024. Swarm's differentiators: incentivized persistence and native fit with the wallet UX users already have.

## 7. Value Proposition

Dapps drop the backend: state is resolvable from (address, topic), survives the dapp's own infrastructure disappearing, and is portable across dapps that share conventions. Users keep their data under their own key, encrypted by default.

## 8. Alternatives Considered

* Centralized backend keyed by the SIWE address: works, but reintroduces the trusted server this idea removes.
* Adopt/revive fdp-storage / fairOS-dfs: closest prior art; mnemonic/password identity and dormant maintenance make SIWE-native a cleaner path, but their pod model is worth borrowing.
* Ceramic/ComposeDB: mature, but a separate network without Swarm's storage incentives.
* Fully on-chain state: cost-prohibitive for app state.
* localStorage only: no portability or durability.

## 9. Success Criteria

* A dapp adds SIWE-keyed persistent state with a few lines of integration and no server code beyond an optional stamping proxy.
* Cross-device restore: sign in on a fresh browser, state appears.
* Measured read/write latency acceptable for interactive use (read latest state within seconds; cross-client visibility within a bounded, documented window).
* Both funding modes demonstrated (proxy stamping and sponsored user batch).
* State is unreadable to third parties observing the network (encryption on by default).
* At least one external dapp adopts the SDK.

## 10. Resourcing Estimate

Prototype is a small effort: bee-js feeds and the existing gateway-proxy cover most plumbing. The larger share is SDK hardening — key-derivation UX, funding flows, encryption defaults — plus the reference dapp. Optional later stages (recordstore integration, multi-writer CRDT state) are separable.

## 11. Dependencies & Risks

* Signature-derived keys: the derivation message must be domain-bound (EIP-712), otherwise a phishing site requesting the same signature gains access to the user's state. Deterministic signing does not exist for smart-contract wallets (ERC-1271), excluding AA users from this pattern.
* Feeds require immutable postage batches; same-index overwrites are unreliable; consistency is eventual. Concurrent multi-device writes need sequence discipline or CRDTs (GSOC and Solar Punk's swarm-collaborative-docs are prior art).
* Funding: proxy stamping reintroduces an operated component (stateless, but a component); user-owned batches add onboarding friction (mitigated by permissionless topUp sponsorship).
* Privacy: state on a public network must be encrypted by default; key or derivation-signature loss means data loss (no recovery).
* Feed payloads cap at 4 KB; larger state needs reference indirection.
* No serverless browser write path today: weeb-3 is retrieval-only, so writes need an HTTP Bee endpoint (own light node, gateway, or the stamping proxy).

## 12. Research & Feasibility Questions

* Is wallet signing deterministic enough across the ecosystem (RFC 6979 holds for MetaMask; passkey/AA wallets fail)? What is the fallback for smart accounts?
* Cross-dapp discoverability: how does a second dapp (or a third party) find state written under a derived key given only the main address — a mapping feed, a registry convention, or per-dapp isolation as a feature?
* Topic namespace conventions (domain-scoped topics? shared schemas?).
* Where does IDEA-166's recordstore slot in for structured/transactional state?
* Should the funding story reuse IDEA-176's Foundation-maintained user-owned batch mechanics?
* What read/write latency does a light-node or gateway path actually deliver for interactive dapps?

## 13. Owner

Peter Földiák

## 14. Supporting Links / References

* https://eips.ethereum.org/EIPS/eip-4361 (ERC-4361, Sign-In with Ethereum)
* https://docs.ethswarm.org/docs/develop/tools-and-features/feeds/ (Swarm feeds)
* https://github.com/ethersphere/gateway-proxy (server-side stamping proxy)
* https://github.com/ethersphere/storage-incentives/blob/master/src/PostageStamp.sol (permissionless topUp, owner-only dilute)
* https://github.com/fairDataSociety/fdp-storage and https://github.com/fairDataSociety/fairOS-dfs (prior art: personal dapp-data pods)
* https://support.metamask.io/privacy-and-security/what-is-eth_sign-and-why-is-it-a-risk/ (eth_sign removal)
* https://github.com/Solar-Punk-Ltd/swarm-collaborative-docs (CRDTs over feeds)
* https://github.com/snaha/swarm-id (added at handoff: browser master identity for Swarm dapps; see D8)
* https://github.com/ethersphere/bee-factory (added at handoff: local test environment)
* https://solar-punk.atlassian.net/browse/IDEA-176 and https://solar-punk.atlassian.net/browse/IDEA-166 (related Ideas)

## Questions → decisions

The §12 questions map onto the decision log: determinism and smart accounts → D1, D2; discoverability and topics → D7; recordstore → Phase 5 item; IDEA-176 batch mechanics → D8 and Phase 5; latency → D5.
