# Review of IDEA-198, Solar Punk's feasibility study of IDEA-190

Read 2026-09-22 against the study as committed at
https://github.com/Solar-Punk-Ltd/ideabox-artifacts/tree/main/IDEA-190-persistent-dapp-user-state
(study `IDEA-198`, verdict *feasible with conditions*, run by a Claude worker on 2026-09-22
from `petfold/dappdata` at `4c5afed`). The study read every module and every doc, cloned Bee,
bee-js, core-sdk, swarm-id and file-manager-lib at pinned refs, ran the unit tests, and ran one
spike of its own on a Gnosis mainnet light node. It is careful work and mostly right. This file
records three things: what we take into our plans and where it landed, what we correct in our
own record because of it, and what is worth sending back to the study's authors.

## 1. What we take into the plan

Each item names where it now lives. Items marked *decision* need Peter.

1. **Independent review before any external adopter** (study condition 2, recommendation 2).
   One author, no second reader of `derive/`, `envelope/`, `stamper/`. PLAN Phase 4 already had
   a security review; it now names an outside reader with `THREATS.md` as the checklist and makes
   it a gate item. Reviewer availability, not code volume, sets the calendar.
2. **Two-device slot test on Gnosis mainnet** (condition 1, proposed spike 2). Sepolia proved
   it; the study wants the same on mainnet storers before a real user. Added to the Phase 4 gate
   under D6/D19. It costs a mainnet batch, so it waits for Peter's confirmation (working rule 4).
3. **Dual-key restore is described in a comment and not implemented** (finding Q1). The
   `personal_sign` fallback derives a different key from the typed-data path; `wallet.ts` says a
   restore tries the typed-data key and then the fallback key, and `connect()` does neither. A
   user whose wallet gains typed-data support between sessions lands in an empty folder. Added to
   the Phase 2 remaining list.
4. **Blob writes under a client-side stamp** (remains item 3). Blobs go through `POST /bytes`,
   which needs a node-held batch, so a sponsor-funded user cannot write a blob today. Closing it
   means chunking client-side and stamping each chunk, which reopens the encryption choice for
   blobs (D9 chose Swarm encryption; client-side chunking makes AES-GCM over the whole blob the
   simpler path). Opened as **D27**.
5. **Empty-state fast path** (Q6). A fresh device pays about 3.6 s to learn that a feed does not
   exist, the missing-chunk retrieval timeout. The Phase 3 UX note must give the dapp a way to
   show a first-run state at once and fill it in when `get()` resolves. Added to Phase 3.
6. **Write-target requirement stated precisely** (Q8). The receiving node validates a
   pre-signed stamp against its chain-synced batchstore, so it needs a blockchain RPC endpoint,
   not a batch of its own. `ARCHITECTURE.md` said "any Bee HTTP endpoint that allows CORS"; it
   now says which nodes qualify. See also correction B3 below.
7. **Repository home, ownership and the npm name** (open question 1). A personal repository,
   one author, already a named swarmtyp dependency. Opened as **D26**, Peter's and tech
   leadership's *decision*.
8. **File Manager integration shape** (finding T-b). file-manager-lib's `feat/swarm-id` branch
   has an `interface SwarmClient` seam; a `DappDataClient` implementing it would make the wallet
   a third identity root for the File Manager. Timing: after SPDV-1500 lands the seam on master,
   not inside the Swarm ID MVP. Whether the File Manager wants a wallet root at all is a product
   *decision* nobody has recorded. Added to PLAN Phase 5 as a candidate, and to `CONVERGENCE.md`.
9. **swarm-id as an entropy source is possible today** (P3, Q1). `SwarmIdClient.deriveAppSecret(label)`
   exists at `lib/src/swarm-id-client.ts:1303`; an `entropy.swarmId(client)` adapter would bring
   swarm-id's passkey and password users to the slot API at the cost of a second SDK and an
   iframe. One caveat the study did not draw out: swarm-id binds the secret to the calling
   origin with no declared-identity option, so a gateway-hosted dapp (D16) would get a different
   folder per gateway under that source. Added to Phase 5; D21 notes it.
10. **swarm-id 0.5.0 shipped 2026-09-21 with breaking changes** (R9): dApp and identity-UI entry
    split, bee-js 13. `CONVERGENCE.md` was read from 0.3.0; it now says so. The file-manager-lib
    branch still pins `^0.3.0`, which is another reason not to build against that branch yet.
11. **Per-app batch UX is undiscussed** (R8). D23 accepts one batch per user per app for v1 and
    records the cost as "probably the biggest UX question after latency"; nothing more is
    written. `docs/UX.md` in Phase 3 owes a paragraph on what a user sees when a second dapp
    needs a second batch, and what a sponsor sees.
12. **A Solar Punk-wide topic convention** (Q3). Three Solar Punk-adjacent libraries, three
    topic schemes. `<library>/<version>/<scope>/<name>` hashed, version mandatory, is what we do
    already; `docs/CONVENTIONS.md` in Phase 4 should be written so file-manager-lib and
    swarm-collaborative-docs can adopt it, not only dappdata.
13. **Recordstore composition** (Q4). A slot value can carry a recordstore root reference
    inline; the open question is whether the recordstore's own feed bump becomes the slot write
    or the slot points at a second feed. Nothing to do now; noted for IDEA-181.
14. **Source reading behind D4** (R2). The study read Bee 2.8.2's `Reserve.Put`
    (`pkg/storer/internal/reserve/reserve.go:132-235`): the stamp index is keyed on
    `(batchID, stampIndex)` alone, a newer timestamp replaces the earlier chunk, and there is no
    branch on the immutable flag; `errOverwriteOfImmutableBatch` is declared and never
    returned. The only immutable-aware code is the node's own `StampIssuer`, which never runs for
    a pre-stamped upload. S3 saw this empirically; now the mechanism is named. T12 cites it.
15. **T18 is environment-dependent** (Q6). On the mainnet light node, reading back through the
    uploading node, all 13 first reads after a write answered 200; the first read took about
    270 ms against 12 ms later, and none answered 500. The error window is a bee-factory
    observation so far. T18 now says so; the mitigation stays, because the two-writer race is
    about a second on either reading and the study measured gateway visibility at about 1.3 s.
16. **Mainnet latency from a light node**, a rung we never measured: write p50 273 ms, read by
    index 13.5 ms, `/feeds` lookup 2.06 s p50 and 5.85 s p95, unknown feed 3.6 s, gateway
    visibility about 1.3 s. Same shape as S2's four paths; the D5 cache stays load-bearing. The
    canvas's cold-read threshold (p95 ≤ 5 s) is marginal on one lookup, which is a Phase 3 gate
    input.
17. **Housekeeping the study noticed**: `README.md` status and test count were stale (fixed in
    this commit); `CLAUDE.md` claimed ESLint and Prettier that are not configured (the claim is
    now marked as pending). The canvas on IDEA-190 is stale in §2, §10 and §11 (recommendation 7);
    Peter edits the canvas, not this repo.

## 2. What we correct in our own record

- **"About 400×" for Bee's `batchTTL` on Sepolia.** The node said 166 days for a batch the
  contract gives 0.99 days: that is about 170× in days. The 400× figure is the block-count
  ratio once Bee's own block-time factor is removed (Bee multiplies by `--block-time`, default
  5 s, whatever chain it is on). Both numbers are in the RESULTS; `CLAUDE.md` now says which is
  which.
- **`CLAUDE.md` toolchain line** claimed ESLint and Prettier. Neither is configured. Add them or
  drop the claim; marked pending for now.
- **`README.md`** said funding arrives in Phase 2 and named 46 tests. Updated.
- **`ARCHITECTURE.md` write target** widened from "any CORS-enabled endpoint" to the actual
  requirement (chain-synced batchstore).

## 3. Comments and corrections for the study's authors

Ordered by how much they change the study's conclusions. B1 and B2 change a finding; the rest
are precision.

- **B1. The D12 discrepancy is not unknown; Bee's `/chunks` handler explains it.** The study says
  Bee 2.8.2 accepts SOC bodies on `POST /chunks` (`pkg/api/chunk.go:142-168`) and leaves our
  "validates the stamp against the wrong address" as *Unknown*. Read the handler's order: it
  calls `cac.NewWithDataSpan(data)` first and tries `soc.FromChunk` only if that fails. `cac`
  accepts any body of 8 to 4 104 bytes (`validateDataLength` checks length only), so a SOC body
  with a payload under about 4 000 bytes parses as a content-addressed chunk, gets the BMT address
  of its own bytes, and the stamp, signed over the SOC address, fails with `400 stamp signature is
  invalid`. That is exactly what S3 logged on both nodes. The SOC fallback fires only for SOC
  bodies longer than a chunk with span, which is why swarm-id's CAC uploads through `/chunks`
  prove nothing about SOCs. D12's rule stands, with the mechanism now written into it.
- **B2. The `batchTTL` inference does not hold arithmetically.** The study infers the Sepolia
  error is Bee assuming Gnosis's 5 s block time on a 12 s chain. Bee 2.8.2 does use a fixed
  `--block-time` (default 5, `cmd/bee/cmd/cmd.go:371`), but 5 s on a 12 s chain makes the TTL
  2.4× too *short*, not 170× too *long*. The inputs that can produce a 400× block-count error are
  `normalizedBalance − cumulativePayout` or `pricePerBlock` in `estimateBatchTTL`
  (`pkg/api/postage.go:498-513`), which come from Bee's batchstore and price-oracle view of the
  chain, not from the postage contract's `remainingBalance`/`lastPrice` that we compared against.
  The study's mainnet check (within 1 %) is the useful part: the defect is Sepolia-specific, and a
  chainstate price that disagrees with the contract's `lastPrice` on the testnet is the hypothesis
  to test before anyone files it upstream. Cause still unknown on both sides.
- **B3. Ultra-light nodes can validate pre-signed stamps when they have a chain RPC.** Finding Q8
  says ultra-light nodes have no batchstore and cannot validate pre-signed stamps, citing
  IDEA-197. Our S3 uploaded pre-stamped SOCs through an ultra-light node (`full-node: false`,
  `swap-enable: false`, a Sepolia RPC endpoint configured, `spikes/s3/RESULTS.md` step 5 and
  row 6), and that node learnt a new batch in 105 s through `GET /batches`. The requirement is a
  chain-synced batchstore, which is a function of `blockchain-rpc-endpoint`, not of light versus
  ultra-light. IDEA-197's node probably had no RPC or `chain-enable: false`; worth checking there.
- **B4. Condition 3 is half met and the study knows it.** It asks for D7 *and D16* to be frozen
  before swarmtyp's Phase 3, but its own R1 records D16 as closed (2026-09-21). The app binding
  in the prompt is decided; what stays open is D7, discoverability. And D7's option (b), a
  directory folder under a reserved app identity, is additive: it adds a signature and a folder
  and changes no existing key. So "Q2 and Q9 are one decision that cannot be unmade" overstates
  it. Where the app binds is settled and frozen with the v1 golden vector; whether to add
  discovery on top is open and reversible. Recommendation 4 should read "close D7", not "decide
  where the app binds".
- **B5. R10, the shared-spec freeze, has already happened.** The v1 derivation is pinned by a
  golden vector and Phase 1 is signed off, so the EIP-712 domain name `dappdata` is not going to
  move. A shared spec with swarm-id would be a *second* derivation version reached through the
  Phase 4 versioned-derivation migration, not a rename of v1. The study's "the window is still
  open" is true for the shared spec and false for our v1 keys.
- **B6. Effort band for closing Phase 2** (S, under two person-weeks) assumes client-stamped blob
  writes are a wire-together job over core-sdk's CAC builder. They also reopen the blob
  encryption choice (our D27) and need a Swarm-side chunker that matches what `/bytes` produces
  if Swarm encryption is kept. Still small, but a design item, not glue.
- **B7. Two leads the study left as dead ends that are worth an upstream look**, not ours to
  file: bee-js's `probeFeed` sends `Swarm-Only-Root-Chunk` as a query parameter while Bee reads a
  header (`bee-js src/api/feed.ts:105-119` vs `pkg/api/feed.go:67`); and `swarm-feed-index-next`
  was never set in any lookup response on 2.8.2. Neither affects dappdata: the fetch transport
  reads `swarm-feed-index` only.

What the study got right that we had not written down: the `Reserve.Put` reading (item 14), the
mainnet light-node rung (16), the missing dual restore (3), the ultra-light and CORS wording (6),
and that condition 2, a second reader, is the real gate to an external adopter.
