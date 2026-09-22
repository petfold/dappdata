import { describe, expect, it } from "vitest";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { PRF_SALT, passkey, type CredentialsApi } from "../src/entropy/passkey.js";
import { deriveSeed } from "../src/derive/kdf.js";

/**
 * A stand-in authenticator: one resident credential per relying party, and a
 * PRF that is HMAC over the salt under a per-credential key, which is what a
 * real authenticator's hmac-secret does. Throwaway keys, never a real device.
 */
function authenticator(options: { prf?: boolean } = {}) {
  const credentials = new Map<string, { id: Uint8Array; key: Uint8Array }>();
  const calls = { get: 0, create: 0 };
  const rpOf = (id: string | undefined): string => id ?? "dapp.test";
  const credential = (record: { id: Uint8Array; key: Uint8Array }, prf: object): Credential =>
    ({
      id: bytesToHex(record.id),
      type: "public-key",
      rawId: record.id.buffer,
      getClientExtensionResults: () => prf,
    }) as unknown as Credential;

  const api: CredentialsApi = {
    async get({ publicKey }) {
      calls.get += 1;
      const record = credentials.get(rpOf(publicKey.rpId));
      if (!record) throw Object.assign(new Error("no credential"), { name: "NotAllowedError" });
      const salt = (publicKey.extensions as { prf?: { eval?: { first?: Uint8Array } } }).prf?.eval?.first;
      if (!salt || options.prf === false) return credential(record, {});
      return credential(record, { prf: { results: { first: hmac(sha256, record.key, salt) } } });
    },
    async create({ publicKey }) {
      calls.create += 1;
      const record = {
        id: crypto.getRandomValues(new Uint8Array(16)),
        key: crypto.getRandomValues(new Uint8Array(32)),
      };
      credentials.set(rpOf(publicKey.rp.id), record);
      return credential(record, { prf: { enabled: options.prf !== false } });
    },
  };
  return { api, calls, credentials };
}

const APP = "https://dapp.test";

describe("the passkey source (D21, D25)", () => {
  it("creates a passkey when none exists, then derives from its PRF output", async () => {
    const auth = authenticator();
    const source = passkey({ credentials: auth.api });
    const result = await source.secret({ app: APP });

    expect(result.method).toBe("webauthn-prf");
    expect(result.secret).toHaveLength(32);
    expect(auth.calls).toEqual({ get: 2, create: 1 }); // get (none), create, get
  });

  it("is deterministic across sign-ins and never creates a second passkey", async () => {
    const auth = authenticator();
    const source = passkey({ credentials: auth.api });
    const first = await source.secret({ app: APP });
    const again = await passkey({ credentials: auth.api }).secret({ app: APP });

    expect(bytesToHex(again.secret)).toBe(bytesToHex(first.secret));
    expect(auth.calls.create).toBe(1);
    // The secret is the PRF over the fixed salt, nothing else.
    const record = [...auth.credentials.values()][0]!;
    expect(bytesToHex(first.secret)).toBe(bytesToHex(hmac(sha256, record.key, PRF_SALT)));
  });

  it("applies the app binding after the source like every other source (D21)", async () => {
    const auth = authenticator();
    const { secret } = await passkey({ credentials: auth.api }).secret({ app: APP });
    const seedA = deriveSeed(secret, APP);
    const seedB = deriveSeed(secret, "https://other.test");
    expect(bytesToHex(seedA)).not.toBe(bytesToHex(seedB));
  });

  it("refuses an authenticator without PRF rather than derive from nothing", async () => {
    const auth = authenticator({ prf: false });
    await expect(passkey({ credentials: auth.api }).secret({ app: APP })).rejects.toThrowError(
      /no PRF extension|does not support the WebAuthn PRF/,
    );
  });

  it("can leave creation to the dapp", async () => {
    const auth = authenticator();
    const source = passkey({ credentials: auth.api, createIfMissing: false });
    await expect(source.secret({ app: APP })).rejects.toThrowError(/call create\(\) first/);
    const id = await source.create();
    expect(id).toHaveLength(16);
    expect((await source.secret({ app: APP })).secret).toHaveLength(32);
  });

  it("says plainly when there is no WebAuthn API at all", async () => {
    await expect(passkey().secret({ app: APP })).rejects.toThrowError(/passkeys need a browser/);
  });
});
