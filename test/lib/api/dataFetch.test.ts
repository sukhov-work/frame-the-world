import { describe, expect, it } from "vitest";
import { DATA_FETCH_TIMEOUT_MS, dataFetchInit, fetchErrorMessage } from "../../../src/lib/api/dataFetch";

describe("dataFetch — the panels' list fetches carry a timeout (audit #4 F5)", () => {
  it("hands fetch a timeout signal where the platform has AbortSignal.timeout", () => {
    const init = dataFetchInit();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
    expect(DATA_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000); // a slow mobile link is not a failure
  });

  it("reads a timeout as one, and passes every other error's message through", () => {
    const timeout = new DOMException("signal timed out", "TimeoutError");
    expect(fetchErrorMessage(timeout)).toBe("timed out — check the connection");
    expect(fetchErrorMessage(new Error("HTTP 502"))).toBe("HTTP 502");
    expect(fetchErrorMessage("nope")).toBe("nope");
  });
});
