# dappdata

Persistent, per-user dapp state on Swarm, keyed to a Sign-In with Ethereum identity — the per-user application-data folder, for dapps. One wallet signature derives a storage key; state lives in encrypted Swarm feeds that key owns; any device that can reproduce the signature gets the state back.

Status: Phase 0 and Phase 1 are done and signed off (2026-09-21); Phase 2 is under way in `packages/dappdata`, where derivation, entropy sources, the envelope, the transports, the feed, slots, the client-side stamper and funding work — against a mocked Bee in 96 unit tests, against a real node on bee-factory, and on Sepolia for funding. The SDK is not published yet. Solar Punk's feasibility study of the idea (IDEA-198) is reviewed in `docs/REVIEW-IDEA-198.md`. Planning and decision docs live in `docs/`; start with `docs/PLAN.md`. Working with Claude Code? Read `CLAUDE.md` first.

## What it looks like

The API below is implemented in `packages/dappdata` and covered by its tests, funding included. It is not published, so it can still move.

**Keep a user's settings across devices.** After Sign-In with Ethereum, hand dappdata the same provider. It asks the wallet for one more signature, over a fixed message that names your dapp's origin, and derives the user's storage key from it.

```ts
import { DappData, entropy, transport } from "dappdata";

const dd = await DappData.connect({
  entropy: entropy.wallet(provider),          // EIP-1193, the one the user signed in with; or entropy.mnemonic(words), entropy.passkey()
  app: { id: window.location.origin },        // or a stable identity if you are served from a Swarm gateway
  transport: transport.fetch("https://bee.example.org"),   // 26 KB gzipped, no bee-js
  stamp: batchId,                             // or a client-side stamper over a batch dd.funding bought (D3, D12)
});

const prefs = dd.slot<Prefs>("preferences");
const saved = await prefs.get();              // null on a first visit
await prefs.set({ theme: "dark", slippage: 0.5 });
```

**Restore on a fresh device.** Nothing to migrate and no account to create. The same wallet reproduces the same signature, so the same call finds the same folder:

```ts
const dd = await DappData.connect({ entropy, app, transport });
const { value } = (await dd.slot<Prefs>("preferences").get()) ?? { value: defaults };
applyTheme(value.theme);
```

**Give another library a key.** Some libraries write their own feeds on the user's behalf. Ask for a sub-key: it follows the user to every device like the folder does, and losing it never exposes the folder.

```ts
const collabKey = dd.deriveKey("swarm-collaborative-docs");
```

**Follow changes from another tab or device.**

```ts
const stop = prefs.watch(({ value }) => render(value));
// later
stop();
```

**Adopt without rewriting state code.** Phase 3 ships one adapter for a state library so an existing dapp swaps one line; a zustand persistence adapter over the `preferences` slot is the first candidate (D14).

```ts
import { dappdataStorage } from "dappdata/zustand";

const useSettings = create(persist(settingsStore, { name: "settings", storage: dappdataStorage(dd) }));
```

What the user sees: one signature prompt at sign-in that names the dapp and says "Derive dappdata storage key". What the user does not see: keys, feeds, or stamps. What the dapp never sees: the derived private key or the encryption key.

Origin: petfold (also posted to Solar Punk Ideabox as IDEA-190).
