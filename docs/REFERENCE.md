# dappdata — API reference

Every public export of the `dappdata` package and its two subpaths, as of the Phase 2 gate (2026-09-22). Written by hand from `packages/dappdata/src/index.ts`; the TypeScript declarations in `dist/` are authoritative where the two differ. Decision numbers point into `docs/DECISIONS.md`. For how to use these together, read `docs/GUIDE.md`.

Entry points: `dappdata` (everything below unless marked), `dappdata/envelope` (the envelope alone, for other libraries), `dappdata/transport/bee-js` (needs the optional peer `@ethersphere/bee-js`).

## `DappData`

```ts
static connect(options: ConnectOptions): Promise<DappData>
```
One signature, one folder. Asks the entropy source for its secret, binds it to `app.id`, derives the folder keys.

```ts
interface ConnectOptions {
  entropy: EntropySource;
  app: { id: string };          // browser origin, or a declared identity for gateway-hosted dapps (D16)
  transport: Transport;
  stamp?: Stamp;                // default payment for every write (§ Stamp); optional for a read-only instance
}
```

| Member | Type | Meaning |
|---|---|---|
| `app` | `string` | the app identity the keys are bound to |
| `address` | `string` | the folder's owner address; a reader needs only this |
| `account` | `string \| undefined` | the wallet account behind the folder, when the source had one |
| `slot<T>(name, options?)` | `Slot<T>` | one named piece of state; the same name returns the same object (index cache, D5) |
| `deriveKey(purpose)` | `{ key: Uint8Array; address: string }` | a sub-key for another library (D17) |
| `funding(payer, chain, from?)` | `Funding` | funding bound to this folder: the owner is `address` unless overridden (D3, D12, D23) |
| `stamper(batchId, { depth, block?, store? })` | `Promise<Stamper>` | a client-side stamper with its checkpoint in this folder by default (D19) |
| `encrypt(bytes, aad)` | `Promise<Uint8Array>` | seal bytes with the folder's key (D20) |
| `decrypt(frame, aad)` | `Promise<Opened>` | open them |

```ts
function slotTopic(app: string, name: string): Uint8Array   // keccak256("dappdata/v1/" + app + "/" + name)
```

## `Slot<T>`

```ts
interface SlotOptions<T> {
  schema?: number;                                             // your version of the value's shape, default 0 (D22)
  migrate?: (old: unknown, fromSchema: number) => T | Promise<T>;
  codec?: Codec<T>;                                            // default jsonCodec()
  stamp?: Stamp;                                               // overrides the instance-wide payment for this slot
}

get(): Promise<SlotValue<T> | null>                            // null before the first write
set(value: T, options?: SetOptions<T>): Promise<{ index: bigint }>
watch(onValue: (v: SlotValue<T>) => void, options?: WatchOptions): () => void

interface SlotValue<T> { value: T; index: bigint; schema: number }
interface SetOptions<T> {
  expectIndex?: bigint;                                        // the index get() returned; conflict if the feed moved (D6)
  merge?: (local: T, remote: SlotValue<T>) => T | Promise<T>;  // resolve instead of throwing
  stamp?: Stamp;
}
interface WatchOptions { intervalMs?: number; maxIntervalMs?: number; onError?: (e: unknown) => void }  // 1 000 / 15 000
```

`set` throws `ConflictError` when `expectIndex` is stale and no `merge` is given. A value over `MAX_INLINE_BYTES` (4 064) is sealed, chunked client-side and stamped chunk by chunk; the slot holds a sealed reference (D9, D27).

```ts
const MAX_INLINE_BYTES: number
interface Codec<T> { encode(value: T): Uint8Array; decode(bytes: Uint8Array): T }
function jsonCodec<T>(): Codec<T>
const bytesCodec: Codec<Uint8Array>
```

## Errors

```ts
class DappDataError extends Error { code: DappDataErrorCode }
type DappDataErrorCode = "wrong-account" | "contract-account" | "bad-signature" | "bad-envelope" | "conflict" | "too-large" | "unsupported"
class ConflictError extends DappDataError { index: bigint; payload: Uint8Array }          // code "conflict"
class CheckpointConflictError extends DappDataError { remote: StamperState }               // code "conflict"; stamper checkpoints
```

## `entropy`

```ts
interface EntropySource { kind: "wallet" | "mnemonic" | "passkey"; secret(ctx: { app: string }): Promise<EntropyResult> }
interface EntropyResult { secret: Uint8Array; account?: string; method: string }
interface Eip1193Provider { request(args: { method: string; params?: unknown[] | object }): Promise<unknown> }
```

```ts
entropy.wallet(provider: Eip1193Provider, options?: {
  account?: string;              // default: the provider's first account
  skipAccountCheck?: boolean;    // skip the eth_getCode contract-account check (D2)
  personalSignFallback?: boolean;// accept a wallet without typed data; opens a DIFFERENT folder (D1, off by default)
}): EntropySource
```
Signs the EIP-712 message `DappDataKey(purpose, account, app, scope)` under domain `{ name: "dappdata", version: "1" }` via `eth_signTypedData_v4`; refuses contract accounts (ERC-1271) except EIP-7702 designators (D2, D25); refuses a wallet without typed data unless the fallback is on (D1).

```ts
entropy.mnemonic(words: string, passphrase?: string): EntropySource        // BIP-39, checksum enforced (D21)
entropy.passkey(options?: {
  rpId?: string; rpName?: string; userName?: string;
  createIfMissing?: boolean;     // default true
  credentials?: CredentialsApi;  // default navigator.credentials
  random?: (n: number) => Uint8Array;
}): PasskeySource                // EntropySource & { create(): Promise<Uint8Array> }
const PRF_SALT: Uint8Array       // sha256("dappdata/prf/v1"); part of every passkey-derived key
```
The passkey secret is the WebAuthn PRF output over `PRF_SALT`; an authenticator without PRF is refused (D21).

## `transport`

```ts
interface Transport {
  readonly kind: string;
  putFeedUpdate(args: { signer: Uint8Array; topic: Uint8Array; index: bigint; payload: Uint8Array; stamp: Stamp }): Promise<void>;
  getFeedUpdate(args: { owner: string; topic: Uint8Array; index: bigint }): Promise<Uint8Array | null>;
  findLatest(args: { owner: string; topic: Uint8Array }): Promise<FeedUpdate | null>;   // Bee's own lookup, 2–5 s
  putBlob(args: { data: Uint8Array; stamp: Stamp }): Promise<string>;                    // sealed bytes in, 32-byte root out (D27)
  getBlob(reference: string): Promise<Uint8Array>;
  getBatch(batchId: string): Promise<BatchStatus | null>;
  getChainState(): Promise<{ currentPrice: bigint; block: number }>;
}
interface FeedUpdate { index: bigint; payload: Uint8Array }
```

```ts
transport.fetch(url: string, fetchImpl?: typeof fetch, options?: {
  deferred?: boolean;        // swarm-deferred-upload: the node stores before pushing (T18)
  pin?: boolean;             // swarm-pin: the node keeps the copy; for a node the user runs
  probeTimeoutMs?: number;   // a read by index slower than this counts as missing; default 2 000 (D5)
}): Transport
transport.memory(): MemoryTransport    // in-memory; exposes `writes` and `blobChunks` for tests
transport.custom(implementation: Transport): Transport
transport.isStampSigner(stamp): stamp is StampSigner
transport.stampBatchId(stamp): string
```

```ts
import { http } from "dappdata/transport/bee-js";
http(url: string, options?: { bee?: Bee }): Transport   // cannot carry client-side stamps on feed updates or blobs
```

### `Stamp`

```ts
type Stamp = string                                   // a batch id the node holds and stamps with
           | { batchId: string; marshalled: Uint8Array }   // one pre-signed stamp, one chunk
           | StampSigner                              // signs per chunk address; a Stamper is one
interface StampSigner { batchId: string; sign(chunkAddress: Uint8Array): Promise<Uint8Array> }
```

## Stamper (D12, D19)

```ts
createStamper(options: {
  signer: Uint8Array;            // the key that owns the batch
  batchId: string; depth: number;
  store?: CheckpointStore;       // without one the stamper is single-use
  block?: number;                // slots reserved per bucket at a time; default DEFAULT_BLOCK = 4
}): Promise<Stamper>

interface Stamper extends StampSigner {
  stamp(address: Uint8Array): Promise<Uint8Array>;    // a marshalled postage stamp; consumes one slot
  sign(address: Uint8Array): Promise<Uint8Array>;     // the same, under the name the transport calls
  state(): StamperState;
  checkpoint(): Promise<void>;
  usage(): number;                                    // reserved share of the batch, 0..1
}
interface CheckpointStore {
  load(): Promise<StamperState | null>;
  save(state: StamperState): Promise<void>;           // throws CheckpointConflictError if another writer moved it
  upcoming?(): Promise<Uint8Array[]>;                 // addresses the next save will stamp through this stamper
}
interface StamperState { batchId: string; depth: number; reserved: Map<number, number>; generation: number }
interface StamperStateWire { v: 1; batchId: string; depth: number; generation: number; reserved: Array<[number, number]> }
encodeState(state): StamperStateWire;  decodeState(wire: unknown): StamperState;  mergeState(a, b): StamperState
bucketCapacity(depth: number): number   // 2^(depth-16)
bucketOf(address: Uint8Array): number   // the top 16 bits
```

`dd.stamper()` supplies the default store: a slot named `.stamper/<batchId>` in the folder, stamped by the stamper itself through `upcoming()`.

## Funding (D3, D23)

```ts
funding(options: { payer: Eip1193Provider; chain: ChainConfig; transport: Transport; from?: string }): Funding

interface Funding {
  fund(options: FundOptions): Promise<FundResult>;
  topUp(batchId: string, amountPerChunk: bigint): Promise<string>;   // permissionless; returns the tx hash
  health(batchId: string): Promise<Health | null>;
  quote(budget: WriteBudget): Promise<{ depth: number; amountPerChunk: bigint; total: bigint }>;
  links(): FundingLink[];                                            // where a user can get xBZZ; the SDK takes no cut
}
interface WriteBudget { writesPerDay: number; retentionDays: number; bytesPerWrite?: number }
interface FundOptions { owner: string; budget?: WriteBudget; depth?: number; amountPerChunk?: bigint; immutable?: boolean /* mutable is refused, D4 */ }
interface FundResult { batchId: string; depth: number; amountPerChunk: bigint; totalCost: bigint; transactionHash: string }
interface Health { usable: boolean; ttlSeconds: number; daysLeft: number; usage: number; depth: number; immutable: boolean; ttlSource: "contract" | "node" }
interface FundingLink { name: string; url: string; what: string }
interface ChainConfig { name: string; chainId: number; postageStamp: string; bzzToken: string; decimals: number; blockSeconds: number }
const gnosis: ChainConfig;  const sepolia: ChainConfig;  customChain(config: ChainConfig): ChainConfig
const BUCKET_DEPTH = 16
chunksPerWrite(bytes: number): number    // 1 up to MAX_INLINE_BYTES, otherwise the blob tree plus the feed chunk (D27)
```

The batch id is `keccak256(abi.encode(payer, nonce))` and is known before the transaction is sent. `health()` computes the lifetime from the contract, not from Bee's `batchTTL`.

## Envelope (`dappdata/envelope`, also from the root) (D9, D20, D22)

```ts
importKey(raw: Uint8Array /* 32 bytes */): Promise<CryptoKey>          // non-extractable AES-GCM key
seal(key: CryptoKey, value: Uint8Array, options: { aad: string; schema?: number; mode?: Mode }): Promise<Uint8Array>
open(key: CryptoKey, frame: Uint8Array, aad: string): Promise<{ value: Uint8Array; schema: number; mode: Mode }>
const Mode = { INLINE: 1, REF: 2 }
// frame layout: version(1) | alg(1) | mode(1) | schema(1) | nonce(12) | ciphertext; header and aad are authenticated
const VERSION = 1, ALG_AES_256_GCM = 1, HEADER_BYTES = 4, NONCE_BYTES = 12
writeHeader, readHeader, nonceOf, bodyOf, concat                       // frame helpers
```

## Derivation (D1, D15, D16, D17, D21)

```ts
const DOMAIN = { name: "dappdata", version: "1" };  const PURPOSE = "Derive dappdata storage key";  const SCOPE = "v1"
typedData(account: string, app: string)             // the EIP-712 payload
typedDataV4Json(account: string, app: string): string
fallbackText(account: string, app: string): string  // the personal_sign text; a different key (opt-in only, D1)
deriveSeed(secret: Uint8Array, app: string): Uint8Array               // HMAC-SHA256(secret, "dappdata/seed/v1/" + app)
deriveFolderKeys(seed: Uint8Array): { feedKey: Uint8Array; feedAddress: string; encKey: Uint8Array }
deriveSubKey(seed: Uint8Array, purpose: string): { key: Uint8Array; address: string }
```

The v1 derivation is frozen and pinned by a golden vector in `test/derive.test.ts`. Changing any input moves every user's folder; a change goes through a versioned migration (Phase 4).

## Feeds (D5)

```ts
class SequentialFeed { constructor(options: { transport; owner: string; topic: Uint8Array; signer?: Uint8Array }); latest(); at(index); append(payload, { stamp, expectIndex? }); hint(index); knownIndex }
feedIdentifier(topic: Uint8Array, index: bigint): Uint8Array           // keccak256(topic ‖ index as 8 bytes big-endian)
feedChunkAddress(owner: string, topic: Uint8Array, index: bigint): Uint8Array
```

Most dapps never touch the feed directly; `Slot` is the public surface.
