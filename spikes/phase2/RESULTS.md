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
