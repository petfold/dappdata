// S1 key derivation. Shared by the Node determinism test and the browser page.
// Embodies the D1 proposal from docs/SPIKES.md, with one change found in S1:
// no chainId in the EIP-712 domain (see RESULTS.md, finding F1).
// THROWAWAY spike code. The SDK version lives in packages/dappdata/src/derive (Phase 1).
import { keccak_256 } from '@noble/hashes/sha3'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

export const SCOPE = 'v1'
export const PURPOSE = 'Derive dappdata storage key'

export const DOMAIN = { name: 'dappdata', version: '1' } as const
export const TYPES = {
  DappDataKey: [
    { name: 'purpose', type: 'string' },
    { name: 'account', type: 'address' },
    { name: 'origin', type: 'string' },
    { name: 'scope', type: 'string' },
  ],
} as const

export function typedData(account: string, origin: string) {
  return {
    domain: DOMAIN,
    types: TYPES,
    primaryType: 'DappDataKey' as const,
    message: { purpose: PURPOSE, account, origin, scope: SCOPE },
  }
}

/** Full eth_signTypedData_v4 payload (needs EIP712Domain listed in types). */
export function typedDataV4Json(account: string, origin: string): string {
  const td = typedData(account, origin)
  return JSON.stringify({
    ...td,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
      ],
      ...td.types,
    },
  })
}

/** personal_sign fallback: same fields, one per line, fixed order. */
export function fallbackText(account: string, origin: string): string {
  return [
    `dappdata v${DOMAIN.version}`,
    `purpose: ${PURPOSE}`,
    `account: ${account.toLowerCase()}`,
    `origin: ${origin}`,
    `scope: ${SCOPE}`,
  ].join('\n')
}

const N = secp256k1.CURVE.n
const strip0x = (h: string) => (h.startsWith('0x') ? h.slice(2) : h)

export interface DerivedKeys {
  seed: string
  feedKey: string
  feedAddress: string
  encKey: string
}

export function derive(signatureHex: string): DerivedKeys {
  const sig = hexToBytes(strip0x(signatureHex))
  const seed = keccak_256(sig)
  let feedKeyBytes = hkdf(sha256, seed, undefined, 'dappdata/feed/v1', 32)
  let k = BigInt('0x' + bytesToHex(feedKeyBytes)) % N
  let round = 0
  while (k === 0n) {
    round++
    feedKeyBytes = hkdf(sha256, seed, undefined, `dappdata/feed/v1/retry${round}`, 32)
    k = BigInt('0x' + bytesToHex(feedKeyBytes)) % N
  }
  const feedKey = k.toString(16).padStart(64, '0')
  const pub = secp256k1.getPublicKey(hexToBytes(feedKey), false).slice(1)
  const feedAddress = '0x' + bytesToHex(keccak_256(pub).slice(12))
  const encKey = bytesToHex(hkdf(sha256, seed, undefined, 'dappdata/enc/v1', 32))
  return { seed: bytesToHex(seed), feedKey, feedAddress, encKey }
}
