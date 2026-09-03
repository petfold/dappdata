// S1 step 2/3 in Node with a THROWAWAY random key. Checks: the derivation code
// is self-consistent, an RFC 6979 signer is deterministic over typed data and
// personal_sign, the two paths give different keys, and core-sdk agrees on the
// feed address. Real-wallet results come from the browser page (web/).
import { Wallet, TypedDataEncoder, verifyTypedData, verifyMessage } from 'ethers'
import { PrivateKey } from '@ethersphere/core-sdk'
import { derive, typedData, fallbackText } from './derive.ts'

const wallet = Wallet.createRandom() // throwaway, never persisted
const origin = 'https://demo.dappdata.example'
const td = typedData(wallet.address, origin)
const RUNS = 20

const typedSigs = new Set<string>()
for (let i = 0; i < RUNS; i++) typedSigs.add(await wallet.signTypedData(td.domain, td.types, td.message))
const textSigs = new Set<string>()
for (let i = 0; i < RUNS; i++) textSigs.add(await wallet.signMessage(fallbackText(wallet.address, origin)))

const [typedSig] = typedSigs
const [textSig] = textSigs
const kTyped = derive(typedSig)
const kText = derive(textSig)
const coreAddr = '0x' + new PrivateKey(kTyped.feedKey).publicKey().address().toHex() // core-sdk toHex() has no 0x prefix

const report = {
  signer: 'ethers v6 Wallet (RFC 6979), throwaway key',
  runs: RUNS,
  typedData: { distinctSignatures: typedSigs.size, deterministic: typedSigs.size === 1,
    recovers: verifyTypedData(td.domain, td.types, td.message, typedSig) === wallet.address },
  personalSign: { distinctSignatures: textSigs.size, deterministic: textSigs.size === 1,
    recovers: verifyMessage(fallbackText(wallet.address, origin), textSig) === wallet.address },
  typedDataHash: TypedDataEncoder.hash(td.domain, td.types, td.message),
  feedAddressTyped: kTyped.feedAddress,
  feedAddressText: kText.feedAddress,
  pathsGiveDifferentKeys: kTyped.feedAddress !== kText.feedAddress,
  coreSdkAgreesOnFeedAddress: coreAddr.toLowerCase() === kTyped.feedAddress.toLowerCase(),
  feedAndEncKeysDiffer: kTyped.feedKey !== kTyped.encKey,
}
console.log(JSON.stringify(report, null, 2))
const ok = report.typedData.deterministic && report.personalSign.deterministic && report.typedData.recovers &&
  report.personalSign.recovers && report.coreSdkAgreesOnFeedAddress && report.feedAndEncKeysDiffer
process.exit(ok ? 0 : 1)
