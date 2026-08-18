import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VIEW_PREFS_KEY,
  loadViewPrefs,
  sanitizeViewPrefs,
  saveViewPref,
} from "../../src/lib/prefs";

// The reload-surviving chip preferences (owner 2026-07-21). Load-bearing invariants: no storage
// (SSR / node tests) degrades to {} without throwing, and junk in storage can never poison the
// camera store's defaults — sanitize drops unknown keys and wrong types.

/** Minimal Storage stand-in — the node test env has no localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("sanitizeViewPrefs", () => {
  it("keeps only known keys with the right types and clamps solidity", () => {
    expect(
      sanitizeViewPrefs({
        groundMode: "dark",
        pinsVisible: false,
        skyGuides: true,
        fpvBuildingSolidity: 7,
        enrichedVariant: true,
        rogue: "x",
      }),
    ).toEqual({
      groundMode: "dark",
      pinsVisible: false,
      skyGuides: true,
      fpvBuildingSolidity: 1,
      enrichedVariant: true,
    });
  });

  it("drops wrong-typed values and degrades junk to {}", () => {
    expect(sanitizeViewPrefs({ groundMode: "neon", pinsVisible: "yes", fpvBuildingSolidity: NaN })).toEqual({});
    expect(sanitizeViewPrefs(null)).toEqual({});
    expect(sanitizeViewPrefs("garbage")).toEqual({});
    expect(sanitizeViewPrefs(42)).toEqual({});
  });

  // U4 AIM flags — per-body booleans, wrong types dropped like every other key.
  it("keeps the aim flags and drops wrong-typed ones", () => {
    expect(sanitizeViewPrefs({ aimTarget: false, aimSun: true, aimMoon: false })).toEqual({
      aimTarget: false,
      aimSun: true,
      aimMoon: false,
    });
    expect(sanitizeViewPrefs({ aimTarget: "on", aimSun: 1, aimMoon: null })).toEqual({});
  });

  // The phase-C key rename (2026-08-03): comet-era blobs keep their chip choices.
  it("migrates the comet-era sky-target keys to the new names", () => {
    expect(sanitizeViewPrefs({ cometVisible: false, cometHighlight: true })).toEqual({
      skyTargetVisible: false,
      skyTargetHighlight: true,
    });
  });

  it("new sky-target keys win over the comet-era fallbacks, trail is its own key", () => {
    expect(
      sanitizeViewPrefs({
        cometVisible: false,
        skyTargetVisible: true,
        cometHighlight: true,
        skyTargetHighlight: false,
        skyTargetTrail: false,
      }),
    ).toEqual({ skyTargetVisible: true, skyTargetHighlight: false, skyTargetTrail: false });
    // Wrong-typed old keys never leak through the fallback either.
    expect(sanitizeViewPrefs({ cometVisible: "yes", cometHighlight: 1 })).toEqual({});
  });
});

describe("loadViewPrefs / saveViewPref", () => {
  it("no localStorage (SSR / tests) → empty prefs, save is a silent no-op", () => {
    expect(typeof localStorage).toBe("undefined"); // the env this guards against
    expect(loadViewPrefs()).toEqual({});
    expect(() => saveViewPref("groundMode", "dark")).not.toThrow();
  });

  it("round-trips a pref and merges instead of clobbering siblings", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    saveViewPref("groundMode", "dark");
    saveViewPref("pinsVisible", false);
    expect(loadViewPrefs()).toEqual({ groundMode: "dark", pinsVisible: false });
    saveViewPref("groundMode", "satellite");
    expect(loadViewPrefs()).toEqual({ groundMode: "satellite", pinsVisible: false });
  });

  it("unparseable / junk stored JSON degrades to {}", () => {
    vi.stubGlobal("localStorage", fakeStorage({ [VIEW_PREFS_KEY]: "{not json" }));
    expect(loadViewPrefs()).toEqual({});
    vi.stubGlobal("localStorage", fakeStorage({ [VIEW_PREFS_KEY]: '"a string"' }));
    expect(loadViewPrefs()).toEqual({});
  });

  it("a throwing storage (private mode) never surfaces", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadViewPrefs()).toEqual({});
    expect(() => saveViewPref("skyGuides", false)).not.toThrow();
  });
});
