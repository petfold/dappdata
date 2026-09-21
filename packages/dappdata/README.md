# dappdata

Per-user dapp state on Swarm, under a key derived from the signature the user
already gave when they signed in. No server, no second password, no export
file: any device that can reproduce the signature opens the same folder.

**Phase 1, in progress.** Derivation, entropy sources and the envelope are
here. Transport, feed and slot are next, and until they land there is no
`DappData.connect` to call. See `../../docs/PLAN.md`.

## What works today

```ts
import { entropy, deriveSeed, deriveFolderKeys, deriveSubKey } from "dappdata";
import { seal, open, importKey } from "dappdata/envelope";

// One wallet signature over the D1 message, bound to this app (D16).
const source = entropy.wallet(provider);              // or entropy.mnemonic(words)
const { secret, account } = await source.secret({ app: window.location.origin });

const seed = deriveSeed(secret, window.location.origin);
const { feedAddress, encKey } = deriveFolderKeys(seed);   // feedKey stays inside
const collab = deriveSubKey(seed, "swarm-collaborative-docs");  // yours to hand out

const key = await importKey(encKey);
const frame = await seal(key, new TextEncoder().encode("state"), { aad: topic, schema: 1 });
const { value, schema } = await open(key, frame, topic);
```

## The rules this code embodies

| Decision | What it means here |
|---|---|
| D15 | The secret is `keccak256(r ‖ s_low)`, never the 65-byte signature, and the public key is recovered and checked against the account. |
| D16 | One signed field, `app`: the browser origin by default, a declared identity for a dapp served from a gateway. |
| D17 | `deriveSubKey(seed, purpose)` gives another library a key that cannot reach the folder. |
| D21 | Wallet and mnemonic sources now, passkey in Phase 2; the app binding is applied after every source. |
| D9, D22 | AES-256-GCM with the topic as AAD; the frame carries a schema byte and the header is authenticated. |
| D24 | The KDF is swarm-id's `HMAC-SHA256(key, utf8(context))`, so both projects can share test vectors. |
| D2, D25 | Contract accounts are refused with a typed error; an EIP-7702 upgraded EOA is treated as an EOA. |

The derivation is frozen for v1. `test/derive.test.ts` pins it with a golden
vector: if that test changes, every existing folder has moved.

## Development

```sh
pnpm test        # unit tests, Bee mocked
pnpm typecheck
pnpm build
```
