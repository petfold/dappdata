// The passkey source (D21, D25): a WebAuthn credential with the PRF extension.
//
// A passkey's PRF output is a stable 32-byte secret per (credential, salt),
// computed inside the authenticator, so a user with no wallet — or a
// passkey-only smart account (D2) — still gets a deterministic seed from the
// login they already have. The salt is a fixed dappdata constant; the app
// binding is applied after the source, as for every source (D21).
//
// What a passkey cannot promise, and the SDK says so: a passkey lost with its
// device ecosystem is a folder lost (T4), and passkeys do not sync across
// ecosystems, so an iCloud passkey and a Google one are two folders. The
// wrapped-seed layer recorded in D2/D21 is the way to make them one.
import { sha256 } from "@noble/hashes/sha2";
import { DappDataError } from "../errors.js";
import type { EntropyContext, EntropyResult, EntropySource } from "./types.js";

const utf8 = new TextEncoder();

/** Fixed PRF salt. Part of the derived key: changing it moves every passkey folder. */
export const PRF_SALT: Uint8Array = sha256(utf8.encode("dappdata/prf/v1"));

/** The subset of the WebAuthn API the source uses, so tests can supply one. */
export interface CredentialsApi {
  get(options: { publicKey: PublicKeyCredentialRequestOptions }): Promise<Credential | null>;
  create(options: { publicKey: PublicKeyCredentialCreationOptions }): Promise<Credential | null>;
}

export interface PasskeySourceOptions {
  /**
   * The relying party id: the dapp's domain by default (the browser fills it
   * in). A dapp served from a Swarm gateway shares the gateway's domain with
   * every other dapp there (T15); the passkey is then the gateway's, not the
   * dapp's.
   */
  rpId?: string | undefined;
  /** Shown by the browser when a passkey is created. Default "dappdata". */
  rpName?: string | undefined;
  /** The user name the browser shows. Default "dappdata user". */
  userName?: string | undefined;
  /**
   * Create a passkey when the browser finds none for this site. Default true.
   * A dapp that wants a "create your passkey" step of its own turns this off
   * and calls `create()` itself.
   */
  createIfMissing?: boolean | undefined;
  /** The WebAuthn API to use. Default `navigator.credentials`. */
  credentials?: CredentialsApi | undefined;
  /** Random bytes for challenges and user handles. Default WebCrypto. */
  random?: ((length: number) => Uint8Array) | undefined;
}

export interface PasskeySource extends EntropySource {
  readonly kind: "passkey";
  /** Register a new passkey for this site and return its credential id. */
  create(): Promise<Uint8Array>;
}

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } };
}
type WithExtensions = PublicKeyCredential & { getClientExtensionResults(): PrfResults };

function credentialsApi(options: PasskeySourceOptions): CredentialsApi {
  if (options.credentials) return options.credentials;
  const nav = (globalThis as { navigator?: { credentials?: CredentialsApi } }).navigator;
  if (!nav?.credentials) {
    throw new DappDataError("unsupported", "no WebAuthn API here: passkeys need a browser");
  }
  return nav.credentials;
}

function randomBytes(options: PasskeySourceOptions, length: number): Uint8Array<ArrayBuffer> {
  // Copied into a fresh ArrayBuffer-backed array: WebAuthn wants a BufferSource.
  if (options.random) return new Uint8Array(options.random(length));
  return crypto.getRandomValues(new Uint8Array(length));
}

function prfOutput(credential: Credential | null): Uint8Array | null {
  const first = (credential as WithExtensions | null)?.getClientExtensionResults?.().prf?.results?.first;
  if (!first) return null;
  const bytes = first instanceof Uint8Array ? first : new Uint8Array(first as ArrayBuffer);
  if (bytes.length !== 32) {
    throw new DappDataError(
      "bad-signature",
      `the authenticator returned a ${bytes.length}-byte PRF output, not 32`,
    );
  }
  return new Uint8Array(bytes);
}

export function passkey(options: PasskeySourceOptions = {}): PasskeySource {
  const rpName = options.rpName ?? "dappdata";
  const userName = options.userName ?? "dappdata user";
  const rpId = options.rpId;

  // The extension is not in every TypeScript DOM lib yet, hence the cast.
  const prfEval = { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs;
  const prfEnable = { prf: {} } as AuthenticationExtensionsClientInputs;

  const get = async (): Promise<Uint8Array | null> => {
    const api = credentialsApi(options);
    let credential: Credential | null;
    try {
      credential = await api.get({
        publicKey: {
          challenge: randomBytes(options, 32),
          ...(rpId === undefined ? {} : { rpId }),
          userVerification: "required",
          // No allowCredentials: a discoverable credential, so the browser
          // finds the passkey and nothing about it needs storing anywhere.
          extensions: prfEval,
        },
      });
    } catch (error) {
      // NotAllowedError is also what the browser says when no passkey exists
      // for this site (or the user cancelled); the caller decides what next.
      if ((error as { name?: string }).name === "NotAllowedError") return null;
      throw error;
    }
    if (!credential) return null;
    const secret = prfOutput(credential);
    if (!secret) {
      throw new DappDataError(
        "unsupported",
        "this passkey or browser does not support the WebAuthn PRF extension, so it cannot " +
          "derive a stable secret; use a platform passkey on a current browser, or another source",
      );
    }
    return secret;
  };

  const create = async (): Promise<Uint8Array> => {
    const api = credentialsApi(options);
    const credential = (await api.create({
      publicKey: {
        challenge: randomBytes(options, 32),
        rp: { name: rpName, ...(rpId === undefined ? {} : { id: rpId }) },
        user: { id: randomBytes(options, 16), name: userName, displayName: userName },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -8 }, // EdDSA
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: prfEnable,
      },
    })) as WithExtensions | null;
    if (!credential) throw new DappDataError("unsupported", "the browser created no passkey");
    const results = credential.getClientExtensionResults?.();
    if (results?.prf?.enabled === false) {
      throw new DappDataError(
        "unsupported",
        "the passkey was created but its authenticator has no PRF extension; dappdata cannot " +
          "derive a stable secret from it",
      );
    }
    return new Uint8Array(credential.rawId);
  };

  return {
    kind: "passkey",
    create,
    async secret(_ctx: EntropyContext): Promise<EntropyResult> {
      let secret = await get();
      if (secret === null) {
        if (options.createIfMissing === false) {
          throw new DappDataError(
            "unsupported",
            "no passkey for this site; call create() first, or let the source create one",
          );
        }
        await create();
        // Some authenticators return the PRF output at creation and some do
        // not; one assertion straight after works everywhere.
        secret = await get();
        if (secret === null) {
          throw new DappDataError("unsupported", "the passkey was created but could not be used");
        }
      }
      return { secret, method: "webauthn-prf" };
    },
  };
}
