// Drives Brave over the DevTools protocol (Brave started with --remote-debugging-port=9222).
// Lets a Claude session click the wallet popup itself during the S1 wallet matrix.
// Usage:
//   node src/cdp.mjs list                          list page targets
//   node src/cdp.mjs eval <url-substring> <js>     evaluate js in the first page whose url contains the substring
//   node src/cdp.mjs approve <n> [shotPrefix]      wait for wallet popups and click Confirm/Sign/Connect n times;
//                                                  saves a screenshot of the first popup to <shotPrefix>.png if given
import { writeFile } from 'node:fs/promises'

const PORT = process.env.CDP_PORT ?? 9222
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const WALLET = /chrome-extension:\/\/[a-z]+\/(notification|popup|index)\.html/

class Session {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map() }
  static async open(url) {
    const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
    const s = new Session(ws)
    ws.onerror = ws.onclose = () => { for (const p of s.pending.values()) p.reject(new Error('target closed')); s.pending.clear() }
    ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = s.pending.get(d.id); if (p) { s.pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result) } }
    return s
  }
  send(method, params = {}) {
    const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); setTimeout(() => { if (this.pending.delete(id)) reject(new Error('timeout ' + method)) }, 4000) })
  }
  async eval(js) { const r = await this.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description)); return r.result.value }
  close() { this.ws.close() }
}

const CLICK = `(() => {
  const btns = [...document.querySelectorAll('button')].filter(b => !b.disabled)
  const b = btns.find(b => /^(confirm|sign|connect|approve|next)$/i.test(b.textContent.trim()))
  if (!b) return 'no button: ' + btns.map(b => b.textContent.trim()).filter(Boolean).slice(0, 12).join(' | ')
  b.click(); return 'clicked ' + b.textContent.trim()
})()`

const keepAlive = setInterval(() => {}, 1000)
const [cmd, a, b] = process.argv.slice(2)
if (cmd === 'list') {
  for (const t of await list()) if (t.type === 'page') console.log(t.id, t.title.slice(0, 40), '|', t.url.slice(0, 100))
} else if (cmd === 'eval') {
  const t = (await list()).find(t => t.type === 'page' && t.url.includes(a)); if (!t) throw new Error('no page matching ' + a)
  const s = await Session.open(t.webSocketDebuggerUrl); console.log(JSON.stringify(await s.eval(b), null, 2)); s.close()
} else if (cmd === 'approve') {
  const n = Number(a ?? 1); let done = 0; let shot = !!b; const t0 = Date.now()
  while (done < n && Date.now() - t0 < 600_000) {
    const t = (await list()).find(t => t.type === 'page' && WALLET.test(t.url))
    if (!t) { await new Promise(r => setTimeout(r, 300)); continue }
    const s = await Session.open(t.webSocketDebuggerUrl)
    try {
      await new Promise(r => setTimeout(r, 700)) // let the popup render
      if (shot) { const png = await s.send('Page.captureScreenshot', { format: 'png' }); await writeFile(`${b}.png`, Buffer.from(png.data, 'base64')); console.log(`screenshot ${b}.png`); shot = false }
      const r = await s.eval(CLICK); console.log(`${done + 1}/${n} ${r}`)
      if (r.startsWith('clicked')) { done++; await new Promise(r => setTimeout(r, 500)) } else await new Promise(r => setTimeout(r, 800))
    } catch (e) { console.log('popup went away: ' + e.message) } finally { s.close() }
  }
  console.log(done === n ? 'done' : `stopped after ${done}`)
} else console.log('commands: list | eval <url> <js> | approve <n> [shotPrefix]')
clearInterval(keepAlive)
