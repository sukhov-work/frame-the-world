/**
 * The data panels' fetch budget (audit #4 F5, 2026-09-17). MY PINS / MY PLACES / SALES / the
 * marketplace / the /m places list read their lists with a bare `fetch()`, so a stalled
 * connection showed LOADING… forever. One timeout for all of them; `AbortSignal.timeout` is
 * Chrome 103+ / Safari 16+ — where it is missing the request simply carries no signal, exactly
 * as before. Client-side (no Wix import): both shells may import it (the mobile fence).
 */
export const DATA_FETCH_TIMEOUT_MS = 20_000;

/** `fetch` init with the timeout signal (or `{}` on a browser without `AbortSignal.timeout`). */
export function dataFetchInit(): RequestInit {
  const factory = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof factory === "function" ? { signal: factory.call(AbortSignal, DATA_FETCH_TIMEOUT_MS) } : {};
}

/** The message a panel shows for a failed list fetch — a timeout reads as one, not as "signal timed out". */
export function fetchErrorMessage(e: unknown): string {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "timed out — check the connection";
  return e instanceof Error ? e.message : String(e);
}

/**
 * EVERY `/api` WRITE CARRIES `Content-Type: application/json` — even one with NO BODY (owner bug
 * 2026-09-19: "couldn't delete a user model"). Astro's `security.checkOrigin` middleware
 * (`astro/dist/core/app/middlewares.js`) lets a non-safe method through only if it has a
 * NON-form content type OR its `Origin` equals `url.origin` — and on the live host the adapter
 * hands Astro an `http:` request URL (the 2026-09-18 sign-out root cause), so the origins NEVER
 * match. A body-less DELETE `fetch` (an init of just the method) sends no content type and was
 * refused `403 Cross-site DELETE form submissions are forbidden` BEFORE the route ran — every
 * delete (models, photos, listings, saved places) had been dead in production while `wix dev`,
 * which never runs the check, passed every harness. Measured live 2026-09-19: bare DELETE → 403,
 * the same request with this header → reaches the route. `test/lib/api/jsonWrites.test.ts` fences
 * every client write.
 */
export const JSON_WRITE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "Content-Type": "application/json" });

/** `fetch` init for a write to `/api/*`: the method, the JSON content type ALWAYS, the body when
 *  there is one. */
export function jsonWriteInit(method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): RequestInit {
  return {
    method,
    headers: { ...JSON_WRITE_HEADERS },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}
