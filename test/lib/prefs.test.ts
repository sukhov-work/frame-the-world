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
        buildings3d: false,
        rogue: "x",
      }),
    ).toEqual({
      groundMode: "dark",
      pinsVisible: false,
      skyGuides: true,
      fpvBuildingSolidity: 1,
      buildings3d: false,
    });
  });

  it("drops the retired enrichedVariant key from pre-2026-08-18 blobs (BLD is on/off now)", () => {
    expect(sanitizeViewPrefs({ enrichedVariant: true })).toEqual({});
  });

  it("drops wrong-typed values and degrades junk to {}", () => {
    expect(sanitizeViewPrefs({ groundMode: "neon", pinsVisible: "yes", fpvBuildingSolidity: NaN })).toEqual({});
    expect(sanitizeViewPrefs(null)).toEqual({});
    expect(sanitizeViewPrefs("garbage")).toEqual({});
    expect(sanitizeViewPrefs(42)).toEqual({});
  });

  // U4 AIM flags — per-body booleans, wrong types dropped like every other key. An
  // UN-stamped blob (prefsRev < 2) drops persisted FALSE (the 2026-08-19b re-arm — the
  // prior build could write offs the user never chose); a stamped blob keeps them.
  it("keeps the aim flags (re-arm drops un-stamped falses) and drops wrong-typed ones", () => {
    expect(sanitizeViewPrefs({ aimTarget: false, aimSun: true, aimMoon: false })).toEqual({
      aimSun: true,
    });
    expect(
      sanitizeViewPrefs({ prefsRev: 2, aimTarget: false, aimSun: true, aimMoon: false }),
    ).toEqual({
      prefsRev: 2,
      aimTarget: false,
      aimSun: true,
      aimMoon: false,
    });
    expect(sanitizeViewPrefs({ aimTarget: "on", aimSun: 1, aimMoon: null })).toEqual({});
  });

  // The 2026-08-19b radar re-arm in full: skyTargetVisible rides the same one-time drop
  // (UNFOLLOW used to persist it false on every use).
  it("re-arms skyTargetVisible from un-stamped blobs, keeps a stamped off", () => {
    expect(sanitizeViewPrefs({ skyTargetVisible: false })).toEqual({});
    expect(sanitizeViewPrefs({ skyTargetVisible: true })).toEqual({ skyTargetVisible: true });
    expect(sanitizeViewPrefs({ prefsRev: 2, skyTargetVisible: false })).toEqual({
      prefsRev: 2,
      skyTargetVisible: false,
    });
  });

  // LAYERS batch (owner 2026-08-19) — the RADAR master switch + MY PLACES on the map.
  it("keeps aimVisible + savedPlacesOnMap and drops wrong-typed ones", () => {
    expect(sanitizeViewPrefs({ aimVisible: false, savedPlacesOnMap: true })).toEqual({
      aimVisible: false,
      savedPlacesOnMap: true,
    });
    expect(sanitizeViewPrefs({ aimVisible: "off", savedPlacesOnMap: 0 })).toEqual({});
  });

  // Batch #4 item 7 (owner 2026-08-21) — the VEC / ▤ VECTOR map-ink toggle.
  it("keeps the DESKTOP EXPERIMENTAL flag, and never re-arms it", () => {
    // owner 2026-08-22h. This is the only pref whose default is OFF, so the `rearmed` clause
    // (which un-sticks persisted `false` for the four default-ON radar keys) must NOT apply:
    // joining it would turn an opt-out into an opt-in and silently enable a machine-hurting
    // mode for people who never chose it.
    expect(sanitizeViewPrefs({ ultraQuality: true })).toEqual({ ultraQuality: true });
    // A persisted FALSE survives verbatim on an UN-stamped (pre-rev-2) blob — the exact case
    // the re-arm rewrites for aimTarget/aimSun/aimMoon/skyTargetVisible.
    expect(sanitizeViewPrefs({ ultraQuality: false })).toEqual({ ultraQuality: false });
    expect(sanitizeViewPrefs({ ultraQuality: 1 })).toEqual({});
    // Absent = absent; the store supplies the `?? false` default, not the sanitiser.
    expect(sanitizeViewPrefs({})).toEqual({});
  });

  it("keeps vectorsVisible and drops wrong-typed ones", () => {
    expect(sanitizeViewPrefs({ vectorsVisible: false })).toEqual({ vectorsVisible: false });
    expect(sanitizeViewPrefs({ vectorsVisible: "off" })).toEqual({});
  });

  // The phase-C key rename (2026-08-03): comet-era blobs keep their chip choices. (A
  // comet-era SHOW-off is un-stamped by definition, so the 2026-08-19b re-arm drops it —
  // the ON choices survive.)
  it("migrates the comet-era sky-target keys to the new names", () => {
    expect(sanitizeViewPrefs({ cometVisible: false, cometHighlight: true })).toEqual({
      skyTargetHighlight: true,
    });
    expect(sanitizeViewPrefs({ cometVisible: true, cometHighlight: true })).toEqual({
      skyTargetVisible: true,
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

  it("round-trips a pref, merges instead of clobbering siblings, stamps prefsRev", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    saveViewPref("groundMode", "dark");
    saveViewPref("pinsVisible", false);
    expect(loadViewPrefs()).toEqual({ groundMode: "dark", pinsVisible: false, prefsRev: 2 });
    saveViewPref("groundMode", "satellite");
    expect(loadViewPrefs()).toEqual({
      groundMode: "satellite",
      pinsVisible: false,
      prefsRev: 2,
    });
  });

  it("a stamped save makes a later aim/SHOW off stick (the re-arm is one-time)", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    saveViewPref("aimSun", false);
    saveViewPref("skyTargetVisible", false);
    expect(loadViewPrefs()).toEqual({ aimSun: false, skyTargetVisible: false, prefsRev: 2 });
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
