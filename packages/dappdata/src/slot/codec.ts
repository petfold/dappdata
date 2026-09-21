// A slot holds bytes. JSON is the default because that is what dapps keep;
// the SDK never looks inside either way (D14).
import { DappDataError } from "../errors.js";

export interface Codec<T> {
  encode(value: T): Uint8Array;
  decode(bytes: Uint8Array): T;
}

const utf8 = new TextEncoder();
const text = new TextDecoder();

export function jsonCodec<T>(): Codec<T> {
  return {
    encode: (value: T) => utf8.encode(JSON.stringify(value)),
    decode: (bytes: Uint8Array) => {
      try {
        return JSON.parse(text.decode(bytes)) as T;
      } catch (cause) {
        throw new DappDataError("bad-envelope", "the slot did not hold JSON", { cause });
      }
    },
  };
}

export const bytesCodec: Codec<Uint8Array> = {
  encode: (value: Uint8Array) => value,
  decode: (bytes: Uint8Array) => bytes,
};
