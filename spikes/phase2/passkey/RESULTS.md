# D21 passkey source — headless evaluation, 2026-09-22

`run.mjs` drives Chrome for Testing 151 (Playwright's build, headless, `--no-sandbox`) over the DevTools protocol with a **virtual authenticator**: CTAP 2.1, internal transport, resident keys, user verification, PRF, automatic presence. The page at `web/` is the SDK's `entropy.passkey()` bundled with esbuild. Run logs are gitignored; this file is the record.

| Step | Result |
|---|---|
| 20 sign-ins on one passkey | **1 distinct secret**; 2–13 ms each, the first including the passkey's creation; one credential on the authenticator afterwards |
| Page reload (nothing in memory survives) | same secret |
| Same passkey, app id `https://other.example` | same secret, **different folder**: the app binding is applied after the source (D21) |
| A second authenticator standing in for another device ecosystem | a different secret and folder: two passkeys are two folders |
| An authenticator without PRF | refused with a typed `unsupported` error naming the missing extension; no secret derived |

The PRF salt is `sha256("dappdata/prf/v1")` = `ae384002…0a5e`, fixed, part of every passkey-derived key.

## What this does and does not establish

It establishes the source's logic: discoverable credential, PRF evaluation, creation on first use, determinism, the app binding, and refusal without PRF. It does **not** establish real-authenticator behaviour: Chrome's virtual authenticator is not Touch ID, Windows Hello, Android, a YubiKey, or a passkey manager such as 1Password or Bitwarden, and it says nothing about Safari or Firefox. Those are Phase 3 wallet-matrix rows. Chrome allows one internal virtual authenticator at a time, which is why authenticator A is removed before B.

## The evaluation D25 asked for: PRF-only, or PRF unlocking a seed

**PRF-only ships now.** A passkey lost with its ecosystem is a folder lost (T4), and two ecosystems are two folders, as the second authenticator shows. **The wrapped seed is additive** and can come later without moving anyone: its first record for an existing user wraps the seed that user already derives, at a location derived from the same secret, so the folder stays where it is and gains a second unlock key. That makes it the same mechanism smart accounts need (D2 note of 2026-09-22), so it is opened as its own decision, D28, and built with that work rather than now.

## Reproduce

```bash
cd spikes/phase2 && pnpm install
pnpm passkey          # bundles web/entry.ts and runs run.mjs; needs Playwright's Chromium at ~/.cache/ms-playwright
```
