/**
 * "Not there" is not one status code.
 *
 * Verified against bee-factory (Bee 2.8.2, 2026-09-21): a feed lookup with no
 * updates answers 404 `lookup at failed`, a missing blob answers 404, but a
 * chunk the node cannot read answers **500 `read chunk failed`**. The SDK
 * reads a feed update by index all the time — before every write, to see
 * whether another device took the index (D6) — and on an empty index that
 * read is the 500 case, not the 404 one.
 *
 * So a failed chunk read counts as absent, and only there: the feed lookup
 * and the blob routes keep their 404s, and every other error still throws.
 */
const MISSING_CHUNK = /read chunk failed|chunk not found|not found|internal server error/i;

export function isNotFound(error: unknown): boolean {
  const e = error as { status?: number; message?: string } | undefined;
  return e?.status === 404 || /\b404\b|not found/i.test(e?.message ?? "");
}

/** A chunk read that failed because the chunk is not there (see above). */
export function isUnreadableChunk(error: unknown): boolean {
  const e = error as { status?: number; message?: string; responseBody?: unknown } | undefined;
  if (e?.status !== 500) return false;
  const body = typeof e.responseBody === "string" ? e.responseBody : JSON.stringify(e.responseBody);
  return MISSING_CHUNK.test(e.message ?? "") || MISSING_CHUNK.test(body ?? "");
}

/** The same judgement from a raw `fetch` response. */
export function isMissingChunkResponse(status: number, body: string): boolean {
  return status === 404 || (status === 500 && MISSING_CHUNK.test(body));
}
