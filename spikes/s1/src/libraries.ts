// S1 step 3, software layer: do the signing libraries that wallets are built on
// produce byte-identical signatures for the same key and message?
//   ethers v6           — used by many dapps and some wallets
//   @metamask/eth-sig-util — the library MetaMask's extension signs with
//   viem                — used by Rabby, wagmi-based wallets, many others
// THROWAWAY random key. Real-wallet UI checks are in web/.
import { Wallet } from 'ethers'
import { signTypedData, SignTypedDataVersion, personalSign } from '@metamask/eth-sig-util'
import { privateKeyToAccount } from 'viem/accounts'
import { typedData, fallbackText, derive } from './derive.ts'

const w = Wallet.createRandom()
const pk = w.privateKey as `0x${string}`
const origin = 'https://demo.dappdata.example'
const td = typedData(w.address, origin)
const text = fallbackText(w.address, origin)
const RUNS = 20

const mmTyped = { types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }], ...td.types }, primaryType: td.primaryType, domain: td.domain, message: td.message }
const viemAcct = privateKeyToAccount(pk)

const runs = async (label: string, f: () => Promise<string> | string) => {
  const set = new Set<string>()
  for (let i = 0; i < RUNS; i++) set.add(await f())
  return { label, distinct: set.size, sig: [...set][0] }
}
const typed = [
  await runs('ethers.signTypedData', () => w.signTypedData(td.domain, td.types, td.message)),
  await runs('eth-sig-util.signTypedData(V4)', () => signTypedData({ privateKey: Buffer.from(pk.slice(2), 'hex'), data: mmTyped as never, version: SignTypedDataVersion.V4 })),
  await runs('viem.signTypedData', () => viemAcct.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message: td.message })),
]
const text_ = [
  await runs('ethers.signMessage', () => w.signMessage(text)),
  await runs('eth-sig-util.personalSign', () => personalSign({ privateKey: Buffer.from(pk.slice(2), 'hex'), data: text })),
  await runs('viem.signMessage', () => viemAcct.signMessage({ message: text })),
]
const same = (rs: typeof typed) => new Set(rs.map(r => r.sig.toLowerCase())).size === 1
const report = {
  runsPerLibrary: RUNS,
  typedData: typed.map(({ label, distinct }) => ({ label, distinct, deterministic: distinct === 1 })),
  typedDataIdenticalAcrossLibraries: same(typed),
  personalSign: text_.map(({ label, distinct }) => ({ label, distinct, deterministic: distinct === 1 })),
  personalSignIdenticalAcrossLibraries: same(text_),
  feedAddressFromTyped: derive(typed[0].sig).feedAddress,
}
console.log(JSON.stringify(report, null, 2))
process.exit(report.typedDataIdenticalAcrossLibraries && report.personalSignIdenticalAcrossLibraries && [...typed, ...text_].every(r => r.distinct === 1) ? 0 : 1)
