# Phase 2 gate run — results

Status: **the run passes** (2026-09-21, Sepolia, Bee 2.8.2 on `127.0.0.1:1643`). Script: `src/gate.mjs`. Full log of the passing run: `results/gate-pass-2026-09-21.log`.

What it proves, in the order the gate asks for it:

| Gate item | Result |
|---|---|
| C4: sponsor pays, end to end | Batch `9f6d34f2…` bought by `0x6f49…f3Bc` and owned by `0xcc87f0c6…`, a key derived from a signature that holds no tokens. Usable 99 s after the transaction. |
| C4: user pays, same code path | Batch `4577d47f…` bought by the user's own wallet for their own derived key. Identical call; the only difference is which provider signs. |
| A write the node cannot pay for | The slot was stamped by the batch owner in this process and uploaded to a node holding no batch (D12). A second, freshly derived instance read it back — the C2 restore, on a real network. |
| Second device, no slot reuse | Both devices stamped into **one** bucket, where collision is possible. Laptop 0, 1, 2; phone restored and took 4, 5, 6; the laptop woke up and took 3 and 8. No slot twice. |
| Permissionless top-up (T9) | The sponsor extended a batch it does not own: 24.0 h → 48.0 h. |

## What the run found

Five defects, none of which the mocked tests could have caught. Each is fixed and has a regression test.

**1. The stamper handed the same slot to two devices.** The first attempt failed exactly as feared: laptop 0, 1, 2 · phone 4, 5, 6 · laptop 3, **4**. The phone had extended the shared reservation to 8 and spent 4–6; the laptop, still holding the state it had loaded at startup, extended from its own stale line of 4 and handed out 4 again. `mergeState` existed but ran only at construction. A stamper now re-reads the store before every extension and merges, so a line another device moved is never crossed. On a batch whose slots are single-use, that was data loss waiting to happen (D4, T12).

**2. Bee's `batchTTL` is wrong by a factor of about 400 on Sepolia.** The node reported **166.46 days** for a batch sized for one day. The postage contract disagrees: `remainingBalance / lastPrice` = 7 115 blocks, which at Sepolia's 12-second blocks is **0.99 days** — what we paid for. `health()` now computes the lifetime from the contract and reports `ttlSource`, because `daysLeft` is what a dapp shows a user before their folder expires. Worth reporting upstream.

**3. `BatchCreated` has seven parameters, not eight.** The ABI in `spikes/s3/src/modeb.mjs` declares a `payer` field the deployment does not emit, so matching on the event signature found nothing. S3 never noticed: it read `topics[1]` positionally as a fallback.

**4. The batch id needs no event at all.** It is `keccak256(abi.encode(payer, nonce))`, confirmed against tx `0xf5d60b9c…` to the byte. The SDK derives it, knows it before the transaction is sent, and uses the event only as a cross-check — so no future ABI drift can break funding.

**5. `/stamps/{id}` lists only batches the node owns**, and under D12 it owns none of ours. `health()` asked the wrong endpoint and would have returned null for ever. The transport now falls back to `/batches/{id}`, the node's view of the chain. Utilization is unavailable there, which is honest: only the holder counts chunks, and the stamper counts our own.

## What it cost

| | |
|---|---|
| depth 17, 1 day | 0.00558 sBZZ |
| depth 20, 1 day | 0.04464 sBZZ |
| Time from `createBatch` to usable | 81–158 s across runs |
| Whole run | about 4 minutes |

`quote()` asked for one day and bought 7 115 blocks of it. The depth-20 batch costs eight times the depth-17 one for the same day, as it should: depth is chunks, not time.

## Two mistakes of our own, recorded so they are not repeated

**The script used to mint a throwaway wallet each run** with `createRandom()`, stake it, and drop the key. Two runs stranded 0.0075 sETH and 0.0444 sBZZ each in keys nobody kept. It now uses a reusable key at `~/.dappdata-sepolia-user.key` and tops it up only when it is short.

**The two-device test first used random addresses**, which land in different buckets, where a collision is impossible. It proved nothing until both devices were pointed at one bucket. A test that cannot fail is not evidence.

## Still open before the Phase 2 gate can close

- **D21's passkey half** (`entropy.passkey()` over WebAuthn PRF) is not written.
- **The slot-backed checkpoint store cannot stamp itself** (D19). A checkpoint written through the stamper it checkpoints needs a slot, which needs a checkpoint, for ever; the stamper now raises a typed error instead of recursing. This run used a file-backed store, which is why it passed. The fix is a step of lookahead — the checkpoint reserves the slot its own next write will need — and it is the last piece of D19.
- **D19 and D23 are Peter's to close**, with the revision recorded in `DECISIONS.md`.

---

# D19 closure run — 2026-09-22

Script `src/d19.mjs`, log `results/d19-live.log`; the visibility follow-ups are `src/visibility.mjs` and `src/hitmiss.mjs` with their logs beside it. Same Sepolia writer node (Bee 2.8.2, light, `:1643`), same payer key. One depth-20 batch, `7148d39d…`, 0.0435 sBZZ for a day, usable 103 s after the transaction. **Result: the slot-backed checkpoint store works as the default, and the two-device test collided, for a reason that is now measured and is not the stamper's.**

## What worked

- **A stamper with no store supplied** wrote three slot updates and three stamps into one bucket, and checkpointed itself into the slot `.stamper/<batchId>` of the same folder, stamped by itself: feed index 3, generation 4, nine buckets reserved (three data chunks, three checkpoint chunks, the test bucket, and the lookahead). No recursion, no caller-supplied store, nothing on disk.
- **A fresh instance restored it from the network** with nothing but the phrase, and took slots 4, 5, 6 in the shared bucket, above the laptop's published line of 4. This is the T12 restore, through Swarm, end to end.

## What collided, and why

The laptop then woke up and stamped 3, **4, 5**: slot 3 was its own, but 4 and 5 were the phone's. Its re-read of the checkpoint feed before extending did not see the phone's checkpoint, written some seconds earlier through the same node, so it extended from its own stale line and wrote its checkpoint over the phone's at the same feed index. And the deliberately simultaneous extension in bucket 777 collided too (both took slot 0), which is the race inside the window that D6 already accepts.

The re-read missed because of how long a write takes to become readable **through the very node that accepted it**. Measured with two instances of the SDK on one node, one writing and one polling a read by index every 250 ms:

| Upload mode on `POST /soc` | Write returns | Visible to the other instance | n |
|---|---|---|---|
| direct (Bee's default for `/soc`), chequebook empty | 300–550 ms | **50–58 s** | 4 |
| direct, chequebook funded with 0.05 sBZZ | 265–300 ms (one 3.5 s) | **51–62 s** (one 8 s) | 6 |
| `swarm-deferred-upload: true` | 28–97 ms | 1–12 s on 5 of 6, **51 s** once | 6 |
| deferred + `swarm-pin: true` | 24–85 ms | **on the first poll, 6 of 6** | 6 |

The mechanism is in Bee's source, not in Swarm's propagation alone. `/soc` pushes directly unless told otherwise (`pkg/api/soc.go`, "historically /soc always pushed directly to the network"), and a directly pushed chunk is kept nowhere on a light node: `GET /chunks` is a local lookup and then a network retrieval (`pkg/storer/netstore.go`, `Download`). So the uploader's own node cannot answer a read of the chunk it just accepted until the network can, which on Sepolia is about a minute. Deferred upload stores the chunk locally, but only until the pusher has a receipt, after which it is dropped again, hence the mixed column. Pinned, the copy stays. **This is T18.** On bee-factory the same retrieval takes about a second, on a mainnet light node about 270 ms (the IDEA-198 study), on Sepolia 50–60 s. The 500 `read chunk failed` is what a failed retrieval looks like.

## A second cost the same measurement exposed

A read of a chunk the node holds takes 12–73 ms. A read of a chunk that does not exist costs a full retrieval attempt: **3.6, 5.6 and 9.0 s** here (one anomalous 3 ms), 3.6 s on the mainnet light node in the IDEA-198 study. The SDK reads a not-yet-written index on every warm `get()` (the forward probe from the cached index) and before every `set()` (the conflict probe), so on a light node each of those pays one miss. That is why the polling reader above needed 2.7–8.8 s per poll even when the chunk was local, and it means the "warm read 10–300 ms" of S2 and D5 holds for the hit but not for the operation. The fetch transport now bounds a read by index with a client-side timeout (`probeTimeoutMs`, default 2 s); a slow hit that trips it counts as missing, which the feed already handles.

## What this means for D19 and D6

- The lookahead closes what D19 left open: the default store pays for its own checkpoint, and a two-device handoff **that respects the visibility window** takes disjoint slots (the phone did, through the network).
- Two devices extending within the window cannot see each other, whatever the protocol, and the window is the network's retrieval readiness: about 1–3 s on mainnet, about a minute on Sepolia with direct uploads. The stamper's conflict detection (`expectIndex` on the checkpoint feed) works once the other checkpoint is visible; inside the window it cannot fire.
- Options for D6 in Phase 4, recorded in the decision: a settle wait after publishing a reservation before spending from it, done ahead of need since feed-chunk addresses are known in advance; or per-device checkpoint feeds folded on read. Until then the rule stands: one device writes at a time, and the demo says so.
- For a node the user runs, `transport.fetch(url, undefined, { deferred: true, pin: true })` makes the user's own writes readable at once by every tab and after every reload, and keeps their state on their node.

## D27 check, same day (`src/blob.mjs`)

A 12 030-byte value, sealed with the envelope, split client-side into four chunks, each stamped by the default (slot-backed) stamper and posted to `POST /chunks` on the node holding no batch, root last; the feed carries the sealed 32-byte root. Accepted by Bee 2.8.2; a fresh instance read it back identical through `GET /bytes` on the root (12.6 s to write including the cold lookup and two checkpoint writes; 6.0 s to read cold). Transport options `deferred: true, pin: true`, so the same node answered the read at once. Sponsor-pays now covers values of any size.

## Cost

One depth-20 batch for a day, 0.0435 sBZZ, plus gas; 0.05 sBZZ moved from the node wallet into its chequebook (it stays there). About 50 stamps spent across the run and the follow-ups. The payer key held 0.222 sBZZ and 0.054 sETH before the run.


---

# Gnosis mainnet run — 2026-09-22

Script `src/mainnet.mjs`, two runs (the first stopped by design at the shared-bucket step, see below). Node: Swarm Desktop's mainnet light node, Bee 2.8.2 on `:1633`, holding none of our batches. Payer: a throwaway key funded with 0.5 xBZZ and 0.05 xDAI withdrawn from the node's wallet through Bee's `/wallet/withdraw` routes after Peter whitelisted it. **Everything passed: 13 stamps, no slot spent twice, and the funding rehearsal PLAN's Phase 2 owed on Gnosis is done.**

| Step | Result |
|---|---|
| Sponsor buys a depth-17 batch owned by the derived key (Gnosis contracts from `chains.ts`, first use) | two batches, 0.0249 xBZZ each for a day, usable after 51 s and 45 s |
| Bee's `batchTTL` against the contract | **1.00 days both**; the Sepolia 170× error is chain-specific, as IDEA-198 found |
| Laptop, default self-stamping store: two notes, one bucket slot, a 10 KB blob | all written; blob 53 s and 59 s |
| Same-node visibility, three updates, fresh instance polling | **seen on the first poll every time**; the poll itself took 13–19 s |
| Phone after 20 s: restores the checkpoint from the network | restored; **refused the shared bucket with `too-large`**, because at depth 17 the laptop's reservation is the whole bucket (D4, D19); took its own bucket; appended to notes; read the blob back identical |
| Non-owner `topUp` on Gnosis | 23.9 h → 47.9 h |

## Two numbers that matter

**Visibility on mainnet is not the problem.** Every update was visible to a fresh instance on its first poll, so the window is below the poll's own duration, consistent with the study's 270 ms first reads and 1.3 s gateway visibility. The D6 residual on mainnet is a second or two, against a minute on Sepolia.

**Our own latency is.** A write took 11–13 s and a warm read 13–15 s, and none of it is the network. At depth 17 a bucket holds two slots, so every chunk opens a new bucket and every new bucket costs a checkpoint; each checkpoint reads the checkpoint feed three times (`load`, `upcoming`, `save`) and each read pays a 2 s probe miss on the index past the head, plus the write's own conflict probe. Ten to twelve seconds of a twelve-second write is probe timeouts and checkpoint churn. Three fixes, all client-side, for Phase 3: read the head once per checkpoint; default `probeTimeoutMs` lower on a network where hits take 13–270 ms (1 s is safe on mainnet); and prefer depth 20 with a larger reservation block, so a checkpoint covers many writes. The blob's 53–59 s is the same cost times four chunks.

## Cost

Two depth-17 batches for a day, 0.0498 xBZZ, one top-up of 0.0249 xBZZ, gas under 0.002 xDAI. The payer key `0x1c58…C5e0` keeps the rest for the demo; the node's wallet is otherwise untouched.
