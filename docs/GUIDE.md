# dappdata — dapp developer guide

How to give your dapp's users a folder on Swarm that follows them to every device, from the wallet they already signed in with. This is the how-to; `docs/REFERENCE.md` lists every function, `docs/FUNDING.md` goes deep on paying for storage, and `docs/ARCHITECTURE.md` explains the design. Decision numbers (D1, D19…) point into `docs/DECISIONS.md`.

The package is not published yet. Until it is, consume it from this repository as a workspace dependency, as `apps/` and `spikes/` do.

## 1. The idea in one paragraph

Your user signs in with their wallet. dappdata asks that wallet for one more signature, over a fixed message that names your dapp, and derives from it a storage key and an encryption key. Nothing is stored about the user anywhere: any device with the same wallet reproduces the same signature, the same keys, the same folder. State lives in Swarm feeds the storage key owns, sealed before it leaves the browser. Storage is paid for with a postage batch the user owns through that key, bought by the user, by you, or by a sponsor.

## 2. Connect

```ts
import { DappData, entropy, transport } from "dappdata";

const dd = await DappData.connect({
  entropy: entropy.wallet(provider),                 // the EIP-1193 provider the user signed in with
  app: { id: window.location.origin },               // what the keys bind to (see §9 for gateway-hosted dapps)
  transport: transport.fetch("https://bee.example.org"),
  stamp: batchId,                                    // optional: how writes are paid for (§6)
});

dd.address;   // the folder's owner address; a reader needs only this
dd.account;   // the wallet account behind it
```

What the user sees: one signature prompt reading "Derive dappdata storage key", showing the account, your app id and a version. It appears once per session per device; keep the derived instance around, do not reconnect on every render.

**Wallets.** Every current wallet signs the typed-data message dappdata uses, hardware wallets included. A wallet that cannot is refused with a `DappDataError` of code `unsupported` before any prompt (D1). Over WalletConnect, list `eth_signTypedData_v4` among your session's optional methods, or the wallet is never asked. Smart-account wallets (Safe, Coinbase Smart Wallet) are refused with code `contract-account` today; EIP-7702 upgraded accounts work. How smart accounts come in later is in D2 and D28.

**Without a wallet.**

```ts
entropy.mnemonic(words)          // a BIP-39 phrase; Swarm Desktop users, tests, CI
entropy.passkey()                // a WebAuthn passkey with the PRF extension; created on first use
```

A passkey is one folder per passkey: iCloud and Google do not sync with each other, and a lost passkey is a lost folder. Say so in your UI. A wrapped folder seed that lets several passkeys open one folder is planned (D28).

## 3. Slots: read, write, watch

A slot is one named piece of state. Names are yours; the SDK never looks inside a value.

```ts
interface Prefs { theme: string; slippage: number }

const prefs = dd.slot<Prefs>("preferences", { schema: 1 });

const current = await prefs.get();                 // null on a first visit
await prefs.set({ theme: "dark", slippage: 0.5 }, { expectIndex: current?.index });

const stop = prefs.watch(({ value }) => render(value));   // polls with backoff, 1 s → 15 s
```

Three habits that matter:

- **Pass `expectIndex`.** It is the feed index `get` returned. If another device wrote since, `set` throws a `ConflictError` instead of overwriting (D6). Without it, `set` appends to whatever the head is.
- **Show the empty state at once.** On a fresh device, learning that a slot has never been written costs one Bee feed lookup, 2 to 5 s. Render your defaults immediately and fill in when `get` resolves.
- **Read after write is free.** `get` straight after `set` returns what you wrote, from memory, even though the network takes time to serve it back (T18).

### Resolving a conflict

```ts
await prefs.set(local, {
  expectIndex: current?.index,
  merge: (mine, theirs) => ({ ...theirs.value, ...mine }),   // theirs: { value, index, schema }
});
```

`merge` runs when the feed moved, and the merged value is written at the new head. Two devices writing within the network's propagation window (about a second on mainnet) cannot see each other, whatever the SDK does; for a small list edited from one device at a time this is fine, and the demo says so in its UI. The general answer is D6, Phase 4.

### Versioning a value

```ts
const prefs = dd.slot<PrefsV2>("preferences", {
  schema: 2,
  migrate: (old, fromSchema) => fromSchema === 1 ? { ...(old as PrefsV1), currency: "EUR" } : (old as PrefsV2),
});
```

Every write carries your schema number (D22). A read of an older shape calls `migrate`; a read of a *newer* shape than this build knows throws, so a stale copy of your dapp never silently downgrades a user's data.

### Bytes instead of JSON

```ts
import { bytesCodec } from "dappdata";
const avatar = dd.slot<Uint8Array>("avatar", { codec: bytesCodec });
```

### Large values

A value up to about 4 KB fits one chunk. Anything larger is sealed, split client-side into chunks, and every chunk is stamped; the slot then holds only a sealed reference (D9, D27). Nothing changes in your code, but a big value costs one stamp per 4 KB, which `quote()` accounts for when you tell it `bytesPerWrite`.

## 4. Follow another device

`watch` polls the feed by index, so it sees another device's write once the network serves it: about 1 to 3 s on mainnet, 8 to 20 s on the Sepolia testnet, longer in the tail. Show a "last synced" time rather than pretending it is instant (D5).

## 5. Keys for other libraries

Some libraries write their own Swarm feeds on the user's behalf. Give them a sub-key rather than the folder key: it follows the user to every device like the folder does, and losing it never exposes the folder (D17).

```ts
const { key, address } = dd.deriveKey("swarm-collaborative-docs");
```

To encrypt bytes you keep elsewhere in the folder's format:

```ts
const frame = await dd.encrypt(bytes, "my-aad");
const { value } = await dd.decrypt(frame, "my-aad");
```

## 6. Paying for storage

Writes need a postage batch. There are two ways to pay for a write, and one rule: **the user owns the batch, whoever pays** (D3, D12).

**A node that holds a batch.** If your users write through a Bee node you run, and that node holds a batch, pass its id and the node stamps:

```ts
const dd = await DappData.connect({ ..., stamp: batchId });
```

The node then pays for everyone who can reach it. Fine for a private node; not for a public one.

**A batch the user owns, stamped in the browser.** Buy a batch owned by the user's derived key, then sign stamps client-side. Any Bee node that allows CORS and has a chain RPC will accept the writes, funds or no funds:

```ts
const money = dd.funding(payerProvider, gnosis);          // payer: the user, you, or a sponsor
const quote = await money.quote({ writesPerDay: 50, retentionDays: 90, bytesPerWrite: 2_000 });
const batch = await money.fund({ budget: { writesPerDay: 50, retentionDays: 90, bytesPerWrite: 2_000 } });

// about two minutes later, when health(batch.batchId).usable is true:
const stamper = await dd.stamper(batch.batchId, { depth: batch.depth });
const notes = dd.slot<string[]>("notes", { stamp: stamper });
```

The stamper keeps its bucket state in a reserved slot of the user's own folder, so a second device restores it with nothing but the signature and never reuses a slot the first may have spent (D19). A reused slot destroys the chunk that was there, on immutable batches too, so this is not optional. When the batch is full, writes stop with a `too-large` error naming the bucket; buy a deeper batch.

`health()` tells you when to warn the user:

```ts
const h = await money.health(batch.batchId);   // { usable, daysLeft, usage, ttlSource }
if (h.daysLeft < 7) showRenewBanner();
```

Anyone can extend a batch, owner or not:

```ts
await money.topUp(batch.batchId, amountPerChunk);
```

For the user to buy tokens, `money.links()` returns routes that start from any chain and end with xBZZ and xDAI. Read `docs/FUNDING.md` for costs, buckets and chains.

## 7. Transports

```ts
transport.fetch(url)                                         // default: 4 Bee routes, 26 KB gzipped, no bee-js
transport.fetch(url, undefined, { deferred: true, pin: true })  // a node the user runs (§8)
transport.fetch(url, undefined, { probeTimeoutMs: 2000 })    // how long a read by index may take before it counts as missing
transport.memory()                                           // no network at all: tests, storybooks
transport.custom(implementation)                             // your own, over whatever Bee client you ship

import { http } from "dappdata/transport/bee-js";            // reuse a bee-js instance the dapp already has
transport: http(url, { bee })
```

The bee-js transport cannot carry client-side stamps for feed updates (a bee-js typing limit); use `transport.fetch` for the user-owned batch mode.

## 8. A node the user runs

Bee's `/soc` route pushes a chunk straight to the network and keeps no copy, so the user's own node cannot answer a read of the user's own write until the network can serve it back: about a second on mainnet, about a minute on the Sepolia testnet. With `deferred: true, pin: true` the node stores and keeps the chunk, and every tab and every reload reads from it at once. Use those options when the node is the user's (Swarm Desktop); a public node's operator will not want everyone's state pinned.

## 9. Served from a Swarm gateway

A dapp served from a gateway has the gateway's origin, shared with every other dapp there. Bind your keys to something you control instead (D16):

```ts
app: { id: "myapp.eth" }        // an ENS name you own, or the owner of your release feed
```

The user's prompt shows that id, so a phishing copy on the same gateway cannot ask for your folder's key without showing your name. Two caveats: anything the SDK caches locally is readable by other dapps on the same origin (T15), and a passkey belongs to the gateway's domain, so on a shared gateway a co-hosted dapp can obtain the same PRF secret silently. Prefer a subdomain gateway. The full guide is `docs/SWARM-HOSTED.md` when Phase 3 writes it.

## 10. Errors

Every error is a `DappDataError` with a `code` you can branch on without reading English:

| code | means |
|---|---|
| `wrong-account` | the signature was not from the account you asked about |
| `contract-account` | a smart-account wallet; no deterministic key today |
| `bad-signature` | the wallet or authenticator returned something malformed |
| `bad-envelope` | wrong key, wrong slot, altered bytes, or a schema this build cannot read |
| `conflict` | another device wrote first (`ConflictError`, with the winning index and payload) |
| `too-large` | the value does not fit, or the batch is full in a bucket |
| `unsupported` | the wallet, node or environment cannot do what was asked |

## 11. What the SDK promises, and what it does not

- The derived private key and the encryption key never leave the SDK; your code sees neither.
- A folder is a pure function of the signature. There is no recovery: a lost wallet is a lost folder, and the SDK's docs and yours should say so (T4).
- One device writing at a time is safe. Two devices writing the same slot within the network's propagation window can overwrite each other; `expectIndex` catches everything outside it (D6).
- Reads are public bytes: anyone can see that a feed exists and how often it changes, not what it holds.
