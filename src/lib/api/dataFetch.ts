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
