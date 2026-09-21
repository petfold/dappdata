// The seed enters through one interface, whatever produced it (D8, D21).

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

export interface EntropyContext {
  /** The app identity the key binds to: browser origin, or a declared one (D16). */
  app: string;
}

export interface EntropyResult {
  /** Raw secret, before the app binding. `deriveSeed` applies that (D21). */
  secret: Uint8Array;
  /** The wallet account, when the source has one. */
  account?: string;
  /** How the secret was produced, for the SDK's own diagnostics. */
  method: string;
}

export interface EntropySource {
  readonly kind: "wallet" | "mnemonic" | "passkey";
  secret(ctx: EntropyContext): Promise<EntropyResult>;
}
