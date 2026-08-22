import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cssFontFamily,
  cssInk,
  cssInkSize,
  invalidateCssInk,
} from "../../../src/lib/theme/cssInk";

/**
 * AUDIT #3 A1-11 / T38 — the canvas surfaces' resolved-token cache, added 2026-08-22.
 *
 * A 2D canvas cannot take `var(--color-accent)` as a fill style, so the mini-map radar (8
 * lookups) and the expanded chart (4) resolved their ink INSIDE their paint. `getComputedStyle`
 * on a live element forces a style recalculation, and both repaint at ~20 Hz: ~320 forced
 * reads a second for values declared once on `:root`.
 *
 * Mutation that makes these RED: drop the memo (the call counter below goes up with paints),
 * or key the cache on the element rather than the property name (each surface would then hold
 * its own copy and `invalidateCssInk` would only clear one).
 */

afterEach(() => {
  invalidateCssInk();
  vi.unstubAllGlobals();
});

/** A fake element + a counting `getComputedStyle`, so "how many recalcs" is observable. */
function stubStyles(values: Record<string, string>, fontFamily = "Space Grotesk, sans-serif") {
  const calls = { n: 0 };
  vi.stubGlobal("getComputedStyle", (_el: unknown) => {
    calls.n++;
    return {
      getPropertyValue: (name: string) => values[name] ?? "",
      fontFamily,
    };
  });
  return calls;
}

const EL = {} as unknown as Element;

describe("cssInk — one resolve per token, not one per paint", () => {
  it("resolves once and reuses the value across many paints", () => {
    const calls = stubStyles({ "--color-accent": " #38E1D0 " });
    invalidateCssInk();
    for (let paint = 0; paint < 20; paint++) {
      expect(cssInk(EL, "--color-accent")).toBe("#38E1D0"); // trimmed
    }
    expect(calls.n).toBe(1); // …not 20
  });

  it("caches per PROPERTY, so both radar surfaces share one entry", () => {
    const calls = stubStyles({ "--color-bg": "#05070b" });
    invalidateCssInk();
    const chartCanvas = {} as unknown as Element;
    const minimapCanvas = {} as unknown as Element;
    expect(cssInk(chartCanvas, "--color-bg")).toBe("#05070b");
    expect(cssInk(minimapCanvas, "--color-bg")).toBe("#05070b");
    expect(calls.n).toBe(1);
    expect(cssInkSize()).toBe(1);
  });

  it("invalidateCssInk really drops everything — the seam a theme flip would need", () => {
    stubStyles({ "--color-accent": "#111111" });
    invalidateCssInk();
    expect(cssInk(EL, "--color-accent")).toBe("#111111");
    expect(cssInkSize()).toBe(1);
    // A "theme flip": the same property now resolves to something else.
    stubStyles({ "--color-accent": "#222222" });
    expect(cssInk(EL, "--color-accent")).toBe("#111111"); // still cached — by design
    invalidateCssInk();
    expect(cssInkSize()).toBe(0);
    expect(cssInk(EL, "--color-accent")).toBe("#222222");
  });

  it("falls back rather than returning an empty fill style", () => {
    // An empty `ctx.fillStyle` silently paints BLACK, so an unresolved token must not reach it.
    stubStyles({});
    invalidateCssInk();
    expect(cssInk(EL, "--color-nope", "#8ef")).toBe("#8ef");
  });

  it("survives an environment with no getComputedStyle (SSR / jsdom-less)", () => {
    vi.stubGlobal("getComputedStyle", undefined);
    invalidateCssInk();
    expect(cssInk(EL, "--color-bg", "#05070b")).toBe("#05070b");
    expect(cssFontFamily(EL, "sans-serif")).toBe("sans-serif");
  });

  it("cssFontFamily is memoised on its own key (a canvas font string can't hold a var())", () => {
    const calls = stubStyles({}, "Space Grotesk, sans-serif");
    invalidateCssInk();
    for (let i = 0; i < 5; i++) expect(cssFontFamily(EL)).toBe("Space Grotesk, sans-serif");
    expect(calls.n).toBe(1);
    // …and it does not collide with a custom property's entry.
    expect(cssInkSize()).toBe(1);
  });
});
