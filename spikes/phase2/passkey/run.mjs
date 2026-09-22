/**
 * D21 passkey evaluation, headless: Chrome for Testing with a CDP virtual
 * authenticator (CTAP2, resident keys, user verification, PRF), driving the
 * bundled passkey source through 20 sign-ins, a page reload, a second
 * authenticator, and one without PRF.
 *
 *   node run.mjs            (after: npx esbuild web/entry.ts --bundle --format=esm --outfile=web/passkey.js)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "./serve.mjs";

const CHROME = process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const PORT = 8765;
const CDP = 9333;
const APP = "http://localhost:8765";

class Session {
  constructor(ws, sessionId) { this.ws = ws; this.sessionId = sessionId; this.id = 0; this.pending = new Map(); }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error("timeout " + method)); }, 30000);
    });
  }
  async eval(js) {
    const r = await this.send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

const say = (...a) => console.log(...a);
const server = await serve(PORT);
const profile = mkdtempSync(join(tmpdir(), "dappdata-passkey-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank",
], { stdio: "ignore" });

try {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!version) throw new Error("Chrome did not open its DevTools port");
  say(`# D21 passkey spike — ${new Date().toISOString()}`);
  say(`browser ${version.Browser}, protocol ${version["Protocol-Version"]}`);

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const sessions = new Map();
  const browser = new Session(ws, null);
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    const s = d.sessionId ? sessions.get(d.sessionId) : browser;
    if (!s || d.id === undefined) return;
    const p = s.pending.get(d.id);
    if (!p) return;
    s.pending.delete(d.id);
    d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result);
  };

  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Session(ws, sessionId);
  sessions.set(sessionId, page);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("WebAuthn.enable", { enableUI: false });

  const addAuthenticator = (hasPrf) => page.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
      hasPrf, automaticPresenceSimulation: true,
    },
  });

  const load = async () => {
    await page.send("Page.navigate", { url: `${APP}/` });
    for (let i = 0; i < 50; i++) {
      if (await page.eval("typeof window.dappdata === 'object'").catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("page did not load the bundle");
  };

  // 1. A platform authenticator with PRF: 20 sign-ins, one secret.
  say(`\n## Authenticator A (CTAP2.1, resident key, UV, PRF)`);
  const a = await addAuthenticator(true);
  await load();
  const run1 = await page.eval(`window.dappdata.secrets(20, ${JSON.stringify(APP)})`);
  say(`20 sign-ins: ${run1.distinct} distinct secret(s); first ${run1.secrets[0].slice(0, 16)}…; folder ${run1.address}`);
  say(`per sign-in ${Math.min(...run1.ms)}–${Math.max(...run1.ms)} ms (first includes the passkey creation)`);
  const creds = await page.send("WebAuthn.getCredentials", { authenticatorId: a.authenticatorId });
  say(`credentials on the authenticator: ${creds.credentials.length} (one passkey created, then reused)`);

  // 2. Reload: nothing in page memory survives; the secret must.
  say(`\n## Page reload`);
  await load();
  const run2 = await page.eval(`window.dappdata.secrets(3, ${JSON.stringify(APP)})`);
  say(`after reload: ${run2.distinct} distinct, same as before: ${run2.secrets[0] === run1.secrets[0]}`);

  // 3. App binding applied after the source: another app id, another folder, same passkey.
  const other = await page.eval(`window.dappdata.secrets(1, "https://other.example")`);
  say(`same passkey, app "https://other.example": same secret ${other.secrets[0] === run1.secrets[0]}, different folder ${other.address !== run1.address}`);

  // 4. A second authenticator standing in for another device ecosystem: a
  //    different passkey for the same site, hence a different folder. Chrome
  //    allows one internal authenticator at a time, so A is removed first.
  say(`\n## Authenticator B (another device: a second passkey for the same site)`);
  await page.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: a.authenticatorId });
  const b = await addAuthenticator(true);
  await load();
  const run3 = await page.eval(`window.dappdata.secrets(2, ${JSON.stringify(APP)})`);
  say(`B: ${run3.distinct} distinct; equal to A's: ${run3.secrets[0] === run1.secrets[0]} (expected false: two passkeys, two folders, the wrapped-seed case)`);
  await page.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: b.authenticatorId });

  // 5. An authenticator without PRF: the source must refuse, not derive from nothing.
  say(`\n## Authenticator C without PRF`);
  const c = await addAuthenticator(false);
  await load();
  const attempt = await page.eval(`window.dappdata.attempt(${JSON.stringify(APP)})`);
  say(`result: ${attempt.ok ? "DERIVED A SECRET (wrong)" : `refused, code ${attempt.code}: ${attempt.error}`}`);
  await page.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: c.authenticatorId });

  say(`\nsalt ${await page.eval("window.dappdata.salt")}`);
  say(`\ndone`);
  ws.close();
} finally {
  chrome.kill("SIGKILL");
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
