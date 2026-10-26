import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RECENT_SKY_KEEP,
  RECENT_SKY_SHOW,
  VIEW_PREFS_KEY,
  loadViewPrefs,
  recentSkyAfter,
  type RecentSkyEntry,
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

  // Owner 2026-09-01 — the DBG debug-HUD chip: the second off-by-default instrument, same
  // contract as ultraQuality above (plain clause, NO re-arm, persisted false survives).
  it("keeps debugHud verbatim and never re-arms it", () => {
    expect(sanitizeViewPrefs({ debugHud: true })).toEqual({ debugHud: true });
    expect(sanitizeViewPrefs({ debugHud: false })).toEqual({ debugHud: false });
    expect(sanitizeViewPrefs({ debugHud: "on" })).toEqual({});
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

  // BEST SPOT (SPEC_V2 §5.7) — the one NESTED value in the blob. It rides `sanitizeScoringPatch`,
  // so this block pins the seam (a patch survives, junk inside it does not), not the kernel's own
  // clamp table, which `bestSpotScoring.test.ts` owns.
  it("round-trips a bestSpotTuning PATCH and drops unknown keys inside it", () => {
    expect(
      sanitizeViewPrefs({ bestSpotTuning: { weights: { p: 0.4, f: 0.15 } } }),
    ).toEqual({ bestSpotTuning: { weights: { p: 0.4, f: 0.15 } } });
    // Shape-driven: keys the shipped profile does not have are never even looked at.
    expect(
      sanitizeViewPrefs({ bestSpotTuning: { weights: { p: 0.4 }, nonsense: 1, gates: { nope: 2 } } }),
    ).toEqual({ bestSpotTuning: { weights: { p: 0.4 } } });
    // A wrong-typed leaf cannot poison the Float32Array the GL sheet samples.
    expect(sanitizeViewPrefs({ bestSpotTuning: { gates: { vGateLo: "0.2" } } })).toEqual({
      bestSpotTuning: {},
    });
  });

  it("neutralises a patch that reaches for a BESTSPOT_SAFETY path", () => {
    // There is no key path from a patch to `groundHard` at all — it is a separate export, so the
    // shape-driven copy never sees it. `aerialMinM` IS a patchable leaf and is CLAMPED, not
    // banned: below ~2 m the R1 drone rules would apply to a standing person, water stops masking
    // and the map sends someone into the Dnipro. `graze.conf.tree` is capped the same way
    // (151,046 of Dnipro's 161,823 canopies are seeded scatter, not surveyed).
    expect(
      sanitizeViewPrefs({
        bestSpotTuning: {
          access: { aerialMinM: 0 },
          graze: { conf: { tree: 1 } },
          gates: { minCoverage: 0 },
          groundHard: { water: 1 },
        },
      }),
    ).toEqual({
      bestSpotTuning: {
        access: { aerialMinM: 2 },
        graze: { conf: { tree: 0.6 } },
        gates: { minCoverage: 0.5 },
      },
    });
  });

  it("ignores a non-object bestSpotTuning entirely", () => {
    expect(sanitizeViewPrefs({ bestSpotTuning: null })).toEqual({});
    expect(sanitizeViewPrefs({ bestSpotTuning: "custom" })).toEqual({});
    expect(sanitizeViewPrefs({ bestSpotTuning: 7 })).toEqual({});
    // An object that survives sanitize with nothing in it is still an object — the store treats
    // an empty patch as "shipped default", so it costs nothing to keep the key honest here.
    expect(sanitizeViewPrefs({ bestSpotTuning: {} })).toEqual({ bestSpotTuning: {} });
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

// MESH SUITE MS5 — the MDL chip's key rides the same blob (a plain clause; default ON is the
// store's `?? true`, so an absent key never persists an off).
describe("view prefs — modelsVisible (MS5)", () => {
  it("keeps a boolean modelsVisible and drops anything else", () => {
    expect(sanitizeViewPrefs({ modelsVisible: false }).modelsVisible).toBe(false);
    expect(sanitizeViewPrefs({ modelsVisible: true }).modelsVisible).toBe(true);
    expect("modelsVisible" in sanitizeViewPrefs({ modelsVisible: "no" })).toBe(false);
    expect("modelsVisible" in sanitizeViewPrefs({})).toBe(false);
  });
});

// T182 (owner 2026-10-22) — the TEX chip's key rides the same blob (a plain clause, the MDL
// recipe; default ON is the store's `?? true`, so an absent key never persists an off).
describe("view prefs — texturesVisible (T182)", () => {
  it("keeps a boolean texturesVisible and drops anything else", () => {
    expect(sanitizeViewPrefs({ texturesVisible: false }).texturesVisible).toBe(false);
    expect(sanitizeViewPrefs({ texturesVisible: true }).texturesVisible).toBe(true);
    expect("texturesVisible" in sanitizeViewPrefs({ texturesVisible: "no" })).toBe(false);
    expect("texturesVisible" in sanitizeViewPrefs({ texturesVisible: 0 })).toBe(false);
    expect("texturesVisible" in sanitizeViewPrefs({})).toBe(false);
  });
  it("a persisted OFF survives an un-stamped (pre-rev-2) blob — no re-arm join", () => {
    expect(sanitizeViewPrefs({ texturesVisible: false }).texturesVisible).toBe(false);
    expect(sanitizeViewPrefs({ prefsRev: 2, texturesVisible: false }).texturesVisible).toBe(false);
  });
});

// RECENT SKY SEARCHES (owner 2026-10-27, the /m search sheet) — the last sky objects tracked from a
// search, newest first, never the pinned sun/moon; 5 kept in the blob, 3 shown.
describe("view prefs — recentSky (owner 2026-10-27)", () => {
  const row = (n: number): RecentSkyEntry => ({ id: `m:${n}`, name: `M${n}`, detail: "GALAXY", kind: "galaxy" });

  it("recentSkyAfter puts the entry at the front and returns a NEW list", () => {
    const list = [row(1), row(2)];
    const next = recentSkyAfter(list, row(3));
    expect(next.map((e) => e.id)).toEqual(["m:3", "m:1", "m:2"]);
    expect(next).not.toBe(list);
    expect(list.map((e) => e.id)).toEqual(["m:1", "m:2"]);
  });
  it("recentSkyAfter dedupes by id — a re-pick moves to the front", () => {
    expect(recentSkyAfter([row(1), row(2), row(3)], row(3)).map((e) => e.id)).toEqual(["m:3", "m:1", "m:2"]);
  });
  it("recentSkyAfter caps at RECENT_SKY_KEEP", () => {
    const full = [1, 2, 3, 4, 5].map(row);
    const next = recentSkyAfter(full, row(6));
    expect(RECENT_SKY_KEEP).toBe(5);
    expect(RECENT_SKY_SHOW).toBe(3);
    expect(next.map((e) => e.id)).toEqual(["m:6", "m:1", "m:2", "m:3", "m:4"]);
  });
  it("recentSkyAfter never adds the pinned sun or moon", () => {
    const list = [row(1)];
    expect(recentSkyAfter(list, { id: "body:sun", name: "SUN", detail: "x", kind: "sun" })).toBe(list);
    expect(recentSkyAfter(list, { id: "body:moon", name: "MOON", detail: "x", kind: "moon" })).toBe(list);
  });

  it("sanitize: not an array → omitted", () => {
    expect("recentSky" in sanitizeViewPrefs({ recentSky: "m:1" })).toBe(false);
    expect("recentSky" in sanitizeViewPrefs({ recentSky: { id: "m:1" } })).toBe(false);
    expect("recentSky" in sanitizeViewPrefs({})).toBe(false);
  });
  it("sanitize: bad elements, the sun/moon and duplicates dropped; a long detail CUT to 120 (never dropped — the id is what resolves); > 5 cut", () => {
    const out = sanitizeViewPrefs({
      recentSky: [
        null,
        "m:1",
        { id: "nocolon", name: "X", detail: "X", kind: "star" },
        { id: "x:".padEnd(81, "a"), name: "X", detail: "X", kind: "star" },
        { id: "m:9", name: 7, detail: "X", kind: "star" },
        { id: "m:9", name: "X", detail: "X".repeat(121), kind: "star" },
        { id: "m:9", name: "X", detail: "X", kind: "planetoid" },
        { id: "body:moon", name: "MOON", detail: "X", kind: "moon" },
        row(1),
        row(1),
        row(2),
        { id: "body:sun", name: "SUN", detail: "X", kind: "sun" },
        row(3),
        row(4),
        row(5),
        row(6),
      ],
    });
    // The 121-char detail row SURVIVES, cut to 120 (the other two m:9 rows — a numeric name, an unknown kind — are junk).
    expect(out.recentSky?.map((e) => e.id)).toEqual(["m:9", "m:1", "m:2", "m:3", "m:4"]);
    expect(out.recentSky?.[0].detail).toBe("X".repeat(120));
    expect(sanitizeViewPrefs({ recentSky: [{ id: "m:1", name: "N".repeat(90), detail: "D", kind: "star" }] }).recentSky?.[0].name).toBe("N".repeat(80));
  });
  it("sanitize: an array of only junk → omitted", () => {
    expect("recentSky" in sanitizeViewPrefs({ recentSky: [1, null, { id: "body:sun" }] })).toBe(false);
  });
  it("round-trips through the shared blob (no new localStorage key)", () => {
    const store = fakeStorage();
    vi.stubGlobal("localStorage", store);
    saveViewPref("recentSky", [row(1)]);
    expect(loadViewPrefs().recentSky).toEqual([row(1)]);
    expect(store.length).toBe(1);
  });
});
