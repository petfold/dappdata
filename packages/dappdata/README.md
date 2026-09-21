# dappdata

Per-user dapp state on Swarm, under a key derived from the signature the user
already gave when they signed in. No server, no second password, no export
file: any device that can reproduce the signature opens the same folder.

**Phase 1, in progress.** Derivation, entropy sources, the envelope, the
transports, the feed and slots all work against a mocked Bee. What is left for
the Phase 1 gate: the bee-factory integration run, and funding (Phase 2), so a
caller still supplies a postage batch. See `../../docs/PLAN.md`.

## The whole integration

```ts
import { DappData, entropy, transport } from "dappdata";

const dd = await DappData.connect({
  entropy: entropy.wallet(provider),        // or entropy.mnemonic(words)
  app: { id: window.location.origin },      // what the key binds to (D16)
  transport: transport.http(beeUrl),        // or transport.fetch(beeUrl)
  stamp: batchId,                           // funding arrives in Phase 2
});

const prefs = dd.slot<Prefs>("preferences", { schema: 1 });
const current = await prefs.get();                              // { value, index, schema } | null
await prefs.set({ theme: "dark" }, { expectIndex: current?.index });
const stop = prefs.watch(({ value }) => render(value));
```

Fifteen lines, and the dapp keeps no keys. On a fresh device the same three
lines restore the same state, because the same signature derives the same
folder.

## What each piece does

| Module | What it gives you |
|---|---|
| `entropy` | `wallet(provider)` and `mnemonic(words)`; one secret, whatever produced it (D21). |
| `derive` | The signed message, the folder keys, and `deriveKey(purpose)` for other libraries (D15, D16, D17). |
| `envelope` | The frame and AES-256-GCM, usable with any WebCrypto key (D9, D20, D22). |
| `transport` | `http` (bee-js), `fetch` (core-sdk, no bee-js), `memory` (tests), `custom` (yours) — D18. |
| `feed` | One sequential feed with the index cache S2 made compulsory (D5). |
| `slot` | `get`, `set`, `watch`, `expectIndex`, `merge`, `migrate` (D6, D22). |

## The rules this code embodies

| Decision | What it means here |
|---|---|
| D15 | The secret is `keccak256(r ‖ s_low)`, never the 65-byte signature, and the public key is recovered and checked against the account. |
| D16 | One signed field, `app`: the browser origin by default, a declared identity for a dapp served from a gateway. |
| D17 | `deriveKey(purpose)` gives another library a key that cannot reach the folder. |
| D21 | Wallet and mnemonic sources now, passkey in Phase 2; the app binding is applied after every source. |
| D9, D22 | AES-256-GCM with the topic as AAD; the frame carries a schema byte and the header is authenticated. |
| D5 | Reads go by cached index; Bee's 2–5 s lookup runs once per feed. `set` resolves on upload; `watch` reports visibility. |
| D6 | `expectIndex` fails with a typed `ConflictError` that carries the update that won, so `merge` needs no second read. |
| D24 | The KDF is swarm-id's `HMAC-SHA256(key, utf8(context))`, so both projects can share test vectors. |
| D2, D25 | Contract accounts are refused with a typed error; an EIP-7702 upgraded EOA is treated as an EOA. |

The derivation is frozen for v1. `test/derive.test.ts` pins it with a golden
vector: if that test changes, every existing folder has moved.

## Development

```sh
pnpm test              # 46 unit tests, Bee mocked, no network
pnpm typecheck
pnpm build

# Against a real node — bee-factory, never a mainnet node (working rule 4):
DAPPDATA_BEE_URL=http://127.0.0.1:1633 DAPPDATA_STAMP=<batch> pnpm test:integration
```
