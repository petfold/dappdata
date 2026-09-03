// Browser harness for S1 steps 1, 3, 4, 5 with real wallets. Bundled to web/derive.js.
// Wallets are discovered with EIP-6963 so the tester can pick MetaMask, Rabby, Brave Wallet
// etc. explicitly even when several extensions fight over window.ethereum.
import { derive, typedDataV4Json, fallbackText } from './derive.ts'

type Eip1193 = { request(a: { method: string; params?: unknown[] }): Promise<unknown>; isMetaMask?: boolean; isRabby?: boolean; isCoinbaseWallet?: boolean; isBraveWallet?: boolean }
type Announced = { info: { uuid: string; name: string; rdns: string }; provider: Eip1193 }
declare global { interface Window { ethereum?: Eip1193 } }

const $ = (id: string) => document.getElementById(id)!
const log = (s: string) => { const el = $('log'); el.textContent += s + '\n'; el.scrollTop = el.scrollHeight }
const results: Record<string, unknown>[] = []
const wallets = new Map<string, Announced>()
let chosen: Announced | undefined
let account = ''

function providerName(p: Eip1193) {
  return p.isRabby ? 'Rabby' : p.isBraveWallet ? 'Brave Wallet' : p.isCoinbaseWallet ? 'Coinbase Wallet' : p.isMetaMask ? 'MetaMask' : 'unknown EIP-1193'
}
function walletName() { return chosen ? chosen.info.name : providerName(provider()) }
function provider(): Eip1193 {
  if (chosen) return chosen.provider
  if (!window.ethereum) throw new Error('no wallet: nothing announced via EIP-6963 and no window.ethereum')
  return window.ethereum
}

// EIP-6963 discovery. Each extension announces itself; we list them in a <select>.
window.addEventListener('eip6963:announceProvider', (e) => {
  const d = (e as CustomEvent<Announced>).detail
  if (wallets.has(d.info.rdns)) return
  wallets.set(d.info.rdns, d)
  const sel = $('wallet') as HTMLSelectElement
  const o = document.createElement('option'); o.value = d.info.rdns; o.textContent = `${d.info.name} (${d.info.rdns})`; sel.appendChild(o)
  if (!chosen) { chosen = d; sel.value = d.info.rdns }
  log(`discovered ${d.info.name}`)
})
window.dispatchEvent(new Event('eip6963:requestProvider'))
;($('wallet') as HTMLSelectElement).onchange = (e) => {
  chosen = wallets.get((e.target as HTMLSelectElement).value); account = ''; $('who').textContent = ''
  log(`selected ${walletName()}`)
}

async function connect() {
  const p = provider()
  const accs = (await p.request({ method: 'eth_requestAccounts' })) as string[]
  account = accs[0]
  const chainId = (await p.request({ method: 'eth_chainId' })) as string
  $('who').textContent = `${walletName()}  ${account}  chain ${parseInt(chainId, 16)}`
  log(`connected ${walletName()} ${account}`)
}

async function signTyped(): Promise<string> {
  return (await provider().request({ method: 'eth_signTypedData_v4', params: [account, typedDataV4Json(account, location.origin)] })) as string
}
async function signText(): Promise<string> {
  const hex = '0x' + Array.from(new TextEncoder().encode(fallbackText(account, location.origin))).map(b => b.toString(16).padStart(2, '0')).join('')
  return (await provider().request({ method: 'personal_sign', params: [hex, account] })) as string
}

async function runDeterminism(kind: 'typed' | 'text', n: number) {
  if (!account) await connect()
  const sigs = new Set<string>()
  const t0 = performance.now()
  for (let i = 0; i < n; i++) {
    try { sigs.add(kind === 'typed' ? await signTyped() : await signText()) }
    catch (e) { log(`${kind} sign ${i + 1} failed: ${(e as Error).message}`); results.push({ wallet: walletName(), account, kind, error: String((e as Error).message) }); return }
    log(`${kind} ${i + 1}/${n} ok`)
  }
  const [sig] = sigs
  const k = derive(sig)
  const r = { wallet: walletName(), account, kind, runs: n, distinct: sigs.size, deterministic: sigs.size === 1, signature: sig, feedAddress: k.feedAddress, ms: Math.round(performance.now() - t0), ua: navigator.userAgent }
  results.push(r)
  log(`${kind}: ${sigs.size === 1 ? 'DETERMINISTIC' : 'NOT deterministic (' + sigs.size + ' distinct)'} feedAddress ${k.feedAddress}`)
  $('out').textContent = JSON.stringify(results, null, 2)
}

$('connect').onclick = () => connect().catch(e => log(`connect failed: ${(e as Error).message}`))
$('typed1').onclick = () => runDeterminism('typed', 1)
$('typed20').onclick = () => runDeterminism('typed', 20)
$('text1').onclick = () => runDeterminism('text', 1)
$('text20').onclick = () => runDeterminism('text', 20)
$('copy').onclick = () => navigator.clipboard.writeText(JSON.stringify(results, null, 2))
$('save').onclick = async () => {
  const note = (document.getElementById('note') as HTMLInputElement).value
  const r = await fetch('/results', { method: 'POST', body: JSON.stringify({ note, savedAt: new Date().toISOString(), results }, null, 2) })
  log(`saved to spikes/s1/results/${(await r.json()).saved}`)
}
$('preview').textContent = typedDataV4Json('0x0000000000000000000000000000000000000000', location.origin)
