# Funding a dappdata folder

*Phase 2. The code is in `packages/dappdata/src/funding`; the decisions behind it are D3, D4, D12, D19 and D23.*

Storage on Swarm is paid for with a **postage batch**: you buy one, it holds a
fixed number of chunks for a fixed time, and writes stamped with it are kept by
the network until it expires. dappdata needs one batch per user per app.

## The short version

**The user owns the batch. Anyone can pay for it.** Those are two different
questions, and the postage contract keeps them apart: `createBatch` takes an
owner address separate from the payer, and `topUp` needs no permission from the
owner at all. So a dapp can buy a batch *for* a user who has never held a token,
and a sponsor can keep it alive later, without either of them being able to
write to the user's folder.

```ts
const money = dd.funding(payerProvider, chain);      // payer: user, operator, sponsor
const quote = await money.quote({ writesPerDay: 50, retentionDays: 90 }); // add bytesPerWrite for values over 4 KB (D27)
const batch = await money.fund({ budget: { writesPerDay: 50, retentionDays: 90 } });
const health = await money.health(batch.batchId);    // { usable, daysLeft, usage }
```

There is no second code path for "the user pays". It is the same call with a
different provider behind it.

## Who owns what

| | Holds it | Can write with it | Can extend it | Can shrink or dilute it |
|---|---|---|---|---|
| The user's derived storage key | the batch | yes | yes | yes (owner only) |
| The payer (operator, sponsor) | nothing | no | **yes** | no |

The owner is never the user's *wallet*. It is the key dappdata derives from
their signature (D12), because a browser wallet will not sign the raw hashes a
postage stamp needs. That key exists on every device the user can sign in from,
and nowhere else.

## What it costs

A batch's price is `amount per chunk × 2^depth`, where the amount is a price per
chunk **per block** that the network sets, and depth is how many chunks the batch
can hold. `quote()` reads the current price from a Bee node and sizes both from a
declared budget.

Measured on Sepolia during S3, at 48 035 PLUR per chunk per block:

| Batch | Cost |
|---|---|
| depth 17, 7 days | ≈ 0.03 BZZ |
| depth 20, 30 days | ≈ 1.1 BZZ |

Mainnet prices differ; never assume a figure, quote it.

Two things make a batch cost more than a naive count of a user's writes:

- **Every write may cost two chunks**, the value and the stamper checkpoint that
  reserves room for it (D19). `quote()` already counts the checkpoint. A value
  over about 4 KB becomes a blob of one chunk per 4 KB plus the tree above them
  (D27); tell `quote()` the typical `bytesPerWrite` and it counts those too.
- **A batch is 65 536 buckets**, and a chunk can only go in the bucket its
  address falls in. A batch is full when one bucket is full, not when the whole
  batch is. At depth 17 a bucket holds 2 chunks; at depth 20, 16.

## Stamping in the browser

Under this model the node that takes the write holds no batch, so the SDK signs
each stamp itself with the key that owns the batch:

```ts
const stamper = await dd.stamper(batch.batchId, { depth: batch.depth });
const notes = dd.slot<string[]>("notes", { stamp: stamper });   // or stamp: stamper on connect() or set()
```

A postage stamp names a slot in a bucket, and a slot used twice destroys the
earlier chunk, so the stamper keeps a record of which slots it may still use and
checkpoints that record into a reserved slot of the user's own folder,
`.stamper/<batchId>`, stamped by itself (D19). A second device restores it with
nothing but the signature and starts above the line the first device published.
Two devices that publish at the same moment are detected and the loser restarts
from the winner's lines. What no client can see is a write made inside the
network's propagation window, about a second on mainnet and about a minute on
the Sepolia testnet: two devices extending the same bucket inside it can still
collide, which is why the rule for v1 is one writing device at a time (D6).

The receiving node needs `cors-allowed-origins` for your dapp and a chain RPC so
its batch store knows the batch; it does not need to own it. Light, full and
ultra-light nodes all qualify when they have the RPC.

## One batch per app

Each app a user adopts brings its own batch, because the key that owns it is
derived per app (D16, D23). That is the cost of the isolation: no app can read
or spend another app's storage, and no shared component sits in the middle. A
sponsor can top up any of them.

## When a batch runs out

dappdata **stops writing**. It does not overwrite, and it does not silently pick
another slot: a reused stamp slot destroys the chunk that was there, on immutable
batches as well as mutable ones (D4, verified in S3). The SDK refuses mutable
batches outright, watches `health().daysLeft`, and raises a typed error naming
the full bucket when it can go no further. Buy a deeper batch and the folder
carries on; the old data stays where it is until its batch expires.

## Getting the tokens

The SDK links out and takes no cut (`funding.links()`). Jumper comes first
because it starts from any chain and ends with both xBZZ and xDAI on Gnosis,
which is what a user needs to hold a batch and pay for the transaction.

## Chains

| Chain | PostageStamp | BZZ |
|---|---|---|
| Gnosis (100) | `0x45a1502382541Cd610CC9068e88727426b696293` | `0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da` |
| Sepolia (11155111) | `0xcdfdC3752caaA826fE62531E0000C40546eC56A6` | `0x543dDb01Ba47acB11de34891cD86B675F04840db` |

Both pairs come from `ethersphere/go-storage-incentives-abi`, the package Bee
builds against. The Sepolia pair is the one our own S3 spike transacted with.
The Gnosis pair is sourced but untouched by us: verify it against a block
explorer before your first mainnet purchase. For anything else — a local
cluster, a chain we do not ship — pass your own with `customChain()`.
