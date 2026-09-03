# dappdata

Persistent, per-user dapp state on Swarm, keyed to a Sign-In with Ethereum identity — the per-user application-data folder, for dapps. One wallet signature derives a storage key; state lives in encrypted Swarm feeds that key owns; any device that can reproduce the signature gets the state back.

Status: pre-development. Phase 0 spikes are running (`spikes/`); the SDK is not published yet. Planning and decision docs live in `docs/`; start with `docs/PLAN.md`. Working with Claude Code? Read `CLAUDE.md` first.

## What it will look like

The API below is the target from `docs/ARCHITECTURE.md`, not shipped code. It may still move; the shape is the promise.

**Keep a user's settings across devices.** After Sign-In with Ethereum, hand dappdata the same provider. It asks the wallet for one more signature, over a fixed message that names your dapp's origin, and derives the user's storage key from it.

```ts
import { DappData, funding } from "dappdata";

const dd = await DappData.connect({
  provider,                                   // EIP-1193, the one the user signed in with
  dapp: { origin: window.location.origin },
  bee: { url: "https://bee.example.org" },
  funding: funding.proxy({ url: "https://proxy.example.org", session: siweToken }),
});

const prefs = dd.slot<Prefs>("preferences");
const saved = await prefs.get();              // null on a first visit
await prefs.set({ theme: "dark", slippage: 0.5 });
```

**Restore on a fresh device.** Nothing to migrate and no account to create. The same wallet reproduces the same signature, so the same call finds the same folder:

```ts
const dd = await DappData.connect({ provider, dapp, bee, funding });
const { value } = (await dd.slot<Prefs>("preferences").get()) ?? { value: defaults };
applyTheme(value.theme);
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
