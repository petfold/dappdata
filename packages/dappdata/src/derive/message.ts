// The message the user signs, and the digests that message hashes to.
// D1 fixes the fields and the absence of chainId (S1 finding F1); D16 renamed
// `origin` to `app`, because the user reads the field in the wallet prompt.
import { keccak_256 } from "@noble/hashes/sha3";

export const DOMAIN = { name: "dappdata", version: "1" } as const;
export const PURPOSE = "Derive dappdata storage key";
export const SCOPE = "v1";

const utf8 = new TextEncoder();
const hash = (s: string): Uint8Array => keccak_256(utf8.encode(s));

const DOMAIN_TYPE = "EIP712Domain(string name,string version)";
const STRUCT_TYPE = "DappDataKey(string purpose,address account,string app,string scope)";

/** The typed-data object, in the shape wallets and viem/ethers expect. */
export function typedData(account: string, app: string) {
  return {
    domain: DOMAIN,
    types: {
      DappDataKey: [
        { name: "purpose", type: "string" },
        { name: "account", type: "address" },
        { name: "app", type: "string" },
        { name: "scope", type: "string" },
      ],
    },
    primaryType: "DappDataKey" as const,
    message: { purpose: PURPOSE, account, app, scope: SCOPE },
  };
}

/** The JSON payload for `eth_signTypedData_v4`, which wants EIP712Domain listed. */
export function typedDataV4Json(account: string, app: string): string {
  const td = typedData(account, app);
  return JSON.stringify({
    ...td,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
      ],
      ...td.types,
    },
  });
}

/** The `personal_sign` fallback (D1): the same fields, one per line, fixed order. */
export function fallbackText(account: string, app: string): string {
  return [
    `dappdata v${DOMAIN.version}`,
    `purpose: ${PURPOSE}`,
    `account: ${account.toLowerCase()}`,
    `app: ${app}`,
    `scope: ${SCOPE}`,
  ].join("\n");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function address32(account: string): Uint8Array {
  const hex = account.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40 || !/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error(`not an address: ${account}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 20; i++) {
    out[12 + i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** The EIP-712 digest the wallet signs: keccak(0x1901 ‖ domainSeparator ‖ hashStruct). */
export function typedDataDigest(account: string, app: string): Uint8Array {
  const domainSeparator = keccak_256(
    concat(hash(DOMAIN_TYPE), hash(DOMAIN.name), hash(DOMAIN.version)),
  );
  const structHash = keccak_256(
    concat(hash(STRUCT_TYPE), hash(PURPOSE), address32(account), hash(app), hash(SCOPE)),
  );
  return keccak_256(concat(new Uint8Array([0x19, 0x01]), domainSeparator, structHash));
}

/** The digest `personal_sign` produces for the fallback text. */
export function fallbackDigest(account: string, app: string): Uint8Array {
  const body = utf8.encode(fallbackText(account, app));
  const prefix = utf8.encode(`\x19Ethereum Signed Message:\n${body.length}`);
  return keccak_256(concat(prefix, body));
}
