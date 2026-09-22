// Bundled into web/passkey.js. Exposes the passkey source to the CDP driver.
import { passkey, PRF_SALT } from "../../../../packages/dappdata/src/entropy/passkey.js";
import { deriveSeed, deriveFolderKeys } from "../../../../packages/dappdata/src/derive/kdf.js";

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

declare global {
  interface Window {
    dappdata: {
      secrets(times: number, app: string): Promise<{ secrets: string[]; distinct: number; address: string; ms: number[] }>;
      attempt(app: string): Promise<{ ok: boolean; error?: string; code?: string }>;
      salt: string;
    };
  }
}

window.dappdata = {
  salt: hex(PRF_SALT),
  async secrets(times, app) {
    const secrets: string[] = [];
    const ms: number[] = [];
    for (let i = 0; i < times; i++) {
      const t0 = performance.now();
      const { secret } = await passkey().secret({ app });
      ms.push(Math.round(performance.now() - t0));
      secrets.push(hex(secret));
    }
    const { feedAddress } = deriveFolderKeys(deriveSeed(new Uint8Array(secrets[0]!.match(/../g)!.map((h) => parseInt(h, 16))), app));
    return { secrets, distinct: new Set(secrets).size, address: feedAddress, ms };
  },
  async attempt(app) {
    try {
      await passkey().secret({ app });
      return { ok: true };
    } catch (error) {
      const e = error as { message?: string; code?: string };
      return { ok: false, error: e.message, code: e.code };
    }
  },
};
