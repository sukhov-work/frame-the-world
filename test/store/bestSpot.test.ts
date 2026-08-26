// store/bestSpot — the BEST SPOT seam's three bands (SPEC_V2 §5.6/§6.8/§6.9, slice S3d).
//
// What is actually load-bearing here, and why each one is a test rather than a comment:
//  · owner ruling R8 — a 1 m ULTRA cell on a 500 m disc is ~12.2 s of solve. No ORDER of setter
//    calls may reach it.
//  · the mutual-exclusion contract — BEST SPOT is the third `planfind` segment and the three
//    windows share one screen position, so two open at once is a visual collision.
//  · `hoverKey` (React) vs `sceneHoverKey` (canvas) — one field would make the two sides fight.
//  · the PATCH is persisted, never the resolved profile (§5.7), and the write is debounced
//    because `saveViewPref` re-parses the whole blob on every call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shortlistQuality, useBestSpotStore, type BestSpotSpot } from "../../src/store/bestSpot";
import { useFindStore } from "../../src/store/find";
import { usePlanStore } from "../../src/store/plan";
import { BESTSPOT } from "../../src/components/globe/tuning";
import { loadViewPrefs } from "../../src/lib/prefs";
import { BESTSPOT_SAFETY, resolveScoring } from "../../src/lib/geo/bestSpotScoring";
import { heatRampById } from "../../src/lib/theme/heatPalette";

/** Minimal Storage stand-in — the node test env has no localStorage (prefs.test.ts's twin). */
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

const DEFAULTS = () => ({
  open: false,
  kind: "sunset" as const,
  radiusM: BESTSPOT.defaultRadiusM,
  liftM: BESTSPOT.defaultLiftM,
  ultra: false,
  cellM: BESTSPOT.defaultCellM,
  rampId: BESTSPOT.rampId,
  hoverKey: null,
  sceneHoverKey: null,
  topK: [],
  solving: false,
  ladderRung: -1,
  tilesPending: false,
  trackNull: false,
  suggestedLiftM: null,
  verdictCounts: { scored: 0, unknown: 0, blocked: 0, total: 0 },
  coverage: 0,
  unmappedFrac: 0,
  reachM: 0,
  gridCellM: BESTSPOT.defaultCellM,
  sheetAltM: BESTSPOT.eyeM + BESTSPOT.defaultLiftM,
  builtDensityPerKm2: 0,
  scoringHashLive: null,
  scoringPatch: null,
  scoring: resolveScoring(null),
  scoringEpoch: 0,
});

beforeEach(() => {
  // Fake timers for the WHOLE file, not just the persistence block: `setScoring` schedules the
  // debounced write unconditionally, and a real timer left pending by one test would fire mid-way
  // through another against whatever storage that one had stubbed.
  vi.useFakeTimers();
  useBestSpotStore.setState(DEFAULTS());
  usePlanStore.setState({ open: false });
  useFindStore.setState({ open: false });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("store/bestSpot — UI band", () => {
  it("defaults are the owner rulings: closed, sunset, 300 m, EYE LEVEL, 3 m field", () => {
    const s = useBestSpotStore.getState();
    expect(s.open).toBe(false);
    // R6 — open at 1.7 m. `liftM` is metres ABOVE the eye, so the default is exactly 0.
    expect(s.liftM).toBe(0);
    expect(s.radiusM).toBe(300);
    // R3 — field at 3 m; 1 m is reserved for ULTRA.
    expect(s.cellM).toBe(BESTSPOT.defaultCellM);
    expect(s.ultra).toBe(false);
  });

  it("mirrors the tunables the panel needs, so panels/controls need no globe import", () => {
    const s = useBestSpotStore.getState();
    expect(s.radiiM).toEqual(BESTSPOT.radiiM);
    expect(s.topKCap).toBe(BESTSPOT.topK);
    expect(s.ultraMaxRadiusM).toBe(BESTSPOT.ultraMaxRadiusM);
    expect([s.displayLo, s.displayHi]).toEqual([BESTSPOT.displayLo, BESTSPOT.displayHi]);
  });

  it("both tuned ramp ids resolve to REAL, distinct palettes", () => {
    // `heatRampById` falls back to inferno for anything it does not know, so a typo in
    // `rampAltId` would silently make the panel's A/B button a no-op.
    const s = useBestSpotStore.getState();
    expect(s.rampId).toBe(BESTSPOT.rampId);
    expect(heatRampById(BESTSPOT.rampId)).not.toBe(heatRampById(BESTSPOT.rampAltId));
  });

  it("setOpen is the plain unconditional setter PlanFindToggle's pick() needs", () => {
    // The exact shape of `pick("bestSpot")`: close the other two, toggle this one.
    const pick = () => {
      usePlanStore.getState().setOpen(false);
      useFindStore.getState().setOpen(false);
      useBestSpotStore.getState().setOpen(!useBestSpotStore.getState().open);
    };
    usePlanStore.getState().setOpen(true);
    pick();
    expect(useBestSpotStore.getState().open).toBe(true);
    expect(usePlanStore.getState().open).toBe(false);
    expect(useFindStore.getState().open).toBe(false);
    // …and the reverse direction still closes BEST SPOT without touching anything else.
    useBestSpotStore.getState().setOpen(false);
    useFindStore.getState().setOpen(true);
    expect(useBestSpotStore.getState().open).toBe(false);
    expect(useFindStore.getState().open).toBe(true);
  });

  it("setRadiusM snaps to a chip on the radius ladder — never an off-ladder radius", () => {
    const set = (m: number) => {
      useBestSpotStore.getState().setRadiusM(m);
      return useBestSpotStore.getState().radiusM;
    };
    expect(set(120)).toBe(100);
    expect(set(470)).toBe(500);
    expect(set(10_000)).toBe(500);
    expect(set(-5)).toBe(100);
    expect(set(Number.NaN)).toBe(BESTSPOT.defaultRadiusM);
    for (const r of BESTSPOT.radiiM) expect(set(r)).toBe(r);
  });

  it("setLiftM clamps into the slider's range, with 0 reserved for the pedestrian reset", () => {
    const set = (m: number) => {
      useBestSpotStore.getState().setLiftM(m);
      return useBestSpotStore.getState().liftM;
    };
    expect(set(-40)).toBe(0);
    // Below the log slider's own floor there is no visible sheet — snap to the labelled 0.
    expect(set(BESTSPOT.liftMinM / 2)).toBe(0);
    expect(set(BESTSPOT.liftMinM)).toBe(BESTSPOT.liftMinM);
    expect(set(56.7)).toBe(56.7);
    expect(set(10_000)).toBe(BESTSPOT.liftMaxM);
    expect(set(Number.NaN)).toBe(0);
  });
});

describe("store/bestSpot — owner ruling R8 (ULTRA is forbidden above 300 m)", () => {
  it("setUltra is REFUSED above ultraMaxRadiusM", () => {
    const s = () => useBestSpotStore.getState();
    s().setRadiusM(500);
    s().setUltra(true);
    expect(s().ultra).toBe(false);
    expect(s().cellM).toBe(BESTSPOT.defaultCellM);
  });

  it("growing the disc past the ceiling drops an ULTRA that was already on", () => {
    const s = () => useBestSpotStore.getState();
    s().setRadiusM(BESTSPOT.ultraMaxRadiusM);
    s().setUltra(true);
    expect(s().ultra).toBe(true);
    expect(s().cellM).toBe(BESTSPOT.ultraCellM);
    s().setRadiusM(400);
    expect(s().ultra).toBe(false);
    expect(s().cellM).toBe(BESTSPOT.defaultCellM);
  });

  it("no ORDER of setter calls reaches a 1 m cell above the ceiling", () => {
    const s = () => useBestSpotStore.getState();
    for (const radiusM of BESTSPOT.radiiM) {
      for (const order of [0, 1]) {
        useBestSpotStore.setState(DEFAULTS());
        if (order === 0) {
          s().setRadiusM(radiusM);
          s().setUltra(true);
        } else {
          s().setUltra(true);
          s().setRadiusM(radiusM);
        }
        const reachedUltra = s().cellM === BESTSPOT.ultraCellM;
        expect({ radiusM, order, reachedUltra }).toEqual({
          radiusM,
          order,
          reachedUltra: radiusM <= BESTSPOT.ultraMaxRadiusM,
        });
      }
    }
  });
});

describe("store/bestSpot — engine band", () => {
  const spot = (key: string, rank: number): BestSpotSpot => ({
    key,
    rank,
    score: 0.9 - rank * 0.05,
    latDeg: 48.4647,
    lonDeg: 35.0462,
    distM: 62,
    bearingDeg: 45,
    contact: "graze",
    note: null,
    aerial: false,
    groundReachable: true,
    leadMs: 200_000,
    gridCellM: 1,
    obstructionRefined: false,
    refinedFromScore: null,
  });

  it("_syncBestSpot is a PARTIAL merge — a feed that learned one field blanks nothing", () => {
    const s = () => useBestSpotStore.getState();
    s()._syncBestSpot({
      topK: [spot("12:9", 1)],
      coverage: 0.71,
      unmappedFrac: 0.36,
      reachM: 700,
      verdictCounts: { scored: 700, unknown: 300, blocked: 100, total: 1100 },
      ladderRung: 3,
      gridCellM: 3,
      sheetAltM: BESTSPOT.eyeM,
      builtDensityPerKm2: 26.6,
      scoringHashLive: "3f9a2c17",
    });
    // The `READING THE MAP` chip alone must not take the field with it.
    s()._syncBestSpot({ tilesPending: true });
    const after = s();
    expect(after.tilesPending).toBe(true);
    expect(after.topK).toHaveLength(1);
    expect(after.coverage).toBe(0.71);
    expect(after.reachM).toBe(700);
    expect(after.ladderRung).toBe(3);
    expect(after.scoringHashLive).toBe("3f9a2c17");
  });

  it("the honesty channels have honest defaults (nothing claims knowledge before a solve)", () => {
    const s = useBestSpotStore.getState();
    expect(s.coverage).toBe(0);
    expect(s.reachM).toBe(0);
    expect(s.scoringHashLive).toBeNull(); // no result yet ⇒ no hash to compare against
    expect(s.ladderRung).toBe(-1); // before first ink, not "rung 0 landed"
    expect(s.verdictCounts).toEqual({ scored: 0, unknown: 0, blocked: 0, total: 0 });
  });

  it("R6's suggested lift is a COMPUTED mirror, not a UI field", () => {
    useBestSpotStore.getState()._syncBestSpot({ suggestedLiftM: 30 });
    expect(useBestSpotStore.getState().suggestedLiftM).toBe(30);
    // …and it clears the moment the field is legible again.
    useBestSpotStore.getState()._syncBestSpot({ suggestedLiftM: null });
    expect(useBestSpotStore.getState().suggestedLiftM).toBeNull();
  });

  it("hoverKey (React) and sceneHoverKey (canvas) stay independent", () => {
    const s = () => useBestSpotStore.getState();
    s().setHoverKey("12:9");
    expect(s().sceneHoverKey).toBeNull();
    s()._syncBestSpot({ sceneHoverKey: "40:3" });
    expect(s().hoverKey).toBe("12:9"); // the canvas did not steal the row's hover
    s().setHoverKey(null);
    expect(s().sceneHoverKey).toBe("40:3"); // …nor the row the canvas's
  });
});

/**
 * The owner batch of 2026-08-26 — the two REQUEST-band fields it adds, and the one invariant that
 * makes them worth having.
 */
describe("store/bestSpot — the heatmap switch and the row selection (owner 2026-08-26)", () => {
  const s = () => useBestSpotStore.getState();

  it("ITEM 4 — the window OPENS with the heatmap off, in both directions", () => {
    s().setOpen(true);
    expect(s().open).toBe(true);
    expect(s().heatmapOn).toBe(false); // …not "on because a centre exists", which is what it was
    s().setHeatmapOn(true);
    expect(s().heatmapOn).toBe(true);
    // Closing (including `PlanFindToggle`'s mutual exclusion closing it from PLAN/FIND) disarms, so
    // re-opening never inherits an arming decision the user made in a previous session.
    s().setOpen(false);
    expect(s().heatmapOn).toBe(false);
    s().setOpen(true);
    expect(s().heatmapOn).toBe(false);
    s().setOpen(false);
  });

  it("ITEM 1 — a selection is a plain key, and closing the window drops it", () => {
    s().setOpen(true);
    s().setSelectedKey("12:34");
    expect(s().selectedKey).toBe("12:34");
    // It is DELIBERATELY not validated against `topK`: the panel looks the row up, so a key that a
    // re-solve retired resolves to "nothing selected" with no clean-up pass anywhere.
    expect(s().topK.find((t) => t.key === "12:34")).toBeUndefined();
    s().setSelectedKey(null);
    expect(s().selectedKey).toBeNull();
    s().setSelectedKey("12:34");
    s().setOpen(false);
    expect(s().selectedKey).toBeNull();
  });

  /**
   * ITEM 2's shared formula. It is a STORE export rather than a palette one because it is about the
   * shortlist, not about colour — and because it is the only way the panel's swatch and the GL
   * marker can be proved to use one normalisation (the panel may not import `scene/**`).
   */
  it("ITEM 2 — shortlistQuality spreads the list over its OWN span, and never returns NaN", () => {
    // The browser finding: a real Dnipro shortlist. `score ÷ best` spans only 1.000 → 0.824, which
    // confined the hue to the top fifth of the ramp; over the list's own span it uses all of it.
    const real = [0.7336, 0.7259, 0.7011, 0.6968, 0.6771, 0.6303, 0.5936, 0.5885];
    const q = real.map((s) => shortlistQuality(s, real));
    expect(q[0]).toBe(1);
    expect(q[real.length - 1]).toBe(0);
    expect(Math.max(...q) - Math.min(...q)).toBe(1); // the FULL ramp, every time
    // …and the ORDER is still the score order — the spread may not reshuffle anything.
    expect([...q].sort((a, b) => b - a)).toEqual(q);
    // The ratio it replaces would have used a fifth of the scale; this is the measurement that
    // justified the change rather than a preference.
    const ratio = real.map((s) => s / real[0]);
    expect(Math.max(...ratio) - Math.min(...ratio)).toBeLessThan(0.2);

    // Degenerate spans map to 1 ("all equal-best"), NEVER to NaN: a NaN reaching a vertex attribute
    // is a silently black marker, and reaching a swatch is `undefined.css`.
    expect(shortlistQuality(0.5, [0.5])).toBe(1);
    expect(shortlistQuality(0.5, [0.5, 0.5, 0.5])).toBe(1);
    expect(shortlistQuality(0.5, [])).toBe(1);
    expect(shortlistQuality(NaN, real)).toBe(1);
    for (const v of [...q, shortlistQuality(0.5, [0.5])]) expect(Number.isFinite(v)).toBe(true);
    // Out-of-list scores clamp rather than running off the ramp.
    expect(shortlistQuality(9, real)).toBe(1);
    expect(shortlistQuality(-9, real)).toBe(0);
  });

  it("ITEM 3 — the preview seam is engine-installed and inert until the globe mounts", () => {
    // The `refineSpot` grammar: the panel calls it unconditionally and a no-op absorbs the call
    // before the island exists. (Its OWNER differs — the orchestrator, not the feed — because a
    // preview is a camera move; the store cannot tell, and must not care.)
    expect(() => s().previewSpot("12:34")).not.toThrow();
    expect(s().previewKey).toBeNull();
    s()._syncBestSpot({ previewKey: "12:34" });
    expect(s().previewKey).toBe("12:34");
    s()._syncBestSpot({ previewKey: null });
  });
});

describe("store/bestSpot — setScoring (§5.6/§5.7)", () => {
  it("sanitizes the patch, resolves the profile and bumps the epoch", () => {
    const s = () => useBestSpotStore.getState();
    const before = s().scoringEpoch;
    s().setScoring({
      weights: { p: 0.4, f: 0.15 },
      // BESTSPOT_SAFETY: below ~2 m the map sends a standing person into the river.
      access: { aerialMinM: 0 },
      // Unknown keys are dropped by the shape-driven sanitizer, not carried into the patch.
      nonsense: 1,
    } as never);
    expect(s().scoringEpoch).toBe(before + 1);
    expect(s().scoringPatch).toEqual({
      weights: { p: 0.4, f: 0.15 },
      access: { aerialMinM: BESTSPOT_SAFETY.aerialMinFloorM },
    });
    expect(s().scoring.weights.p).toBe(0.4);
    expect(s().scoring.access.aerialMinM).toBe(BESTSPOT_SAFETY.aerialMinFloorM);
    // Untouched leaves still come from the SHIPPED default — that is the point of a patch.
    expect(s().scoring.weights.v).toBe(resolveScoring(null).weights.v);
  });

  it("null resets to the shipped default and still bumps the epoch", () => {
    const s = () => useBestSpotStore.getState();
    s().setScoring({ weights: { p: 0.4 } });
    const mid = s().scoringEpoch;
    s().setScoring(null);
    expect(s().scoringPatch).toBeNull();
    expect(s().scoring).toEqual(resolveScoring(null));
    expect(s().scoringEpoch).toBe(mid + 1);
  });

  it("an all-unknown patch resolves to the default and is NOT stored as `{}`", () => {
    const s = () => useBestSpotStore.getState();
    s().setScoring({ bogus: true, alsoBogus: { x: 1 } } as never);
    expect(s().scoringPatch).toBeNull(); // "custom (0 fields)" is not a tune
    expect(s().scoring).toEqual(resolveScoring(null));
  });

  it("persists the PATCH — never the resolved profile — and debounces the write", () => {
    const storage = fakeStorage();
    const setItem = vi.spyOn(storage, "setItem");
    vi.stubGlobal("localStorage", storage);

    const s = () => useBestSpotStore.getState();
    // A slider drag: many sets inside one debounce window.
    for (let i = 0; i < 12; i++) s().setScoring({ weights: { p: 0.3 + i * 0.01 } });
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BESTSPOT.persistDebounceMs);
    expect(setItem).toHaveBeenCalledTimes(1); // ONE write, not twelve full blob re-parses

    const stored = loadViewPrefs().bestSpotTuning;
    expect(stored).toEqual({ weights: { p: 0.41 } }); // the LAST value of the drag
    // The resolved profile has ~45 leaves; the patch must carry exactly the one that moved, or a
    // future change to a shipped default can never reach the fields the owner never touched.
    expect(Object.keys(stored ?? {})).toEqual(["weights"]);
    expect(stored).not.toHaveProperty("gates");
    expect(stored).not.toHaveProperty("access");
  });

  it("a reset clears the persisted key rather than storing an empty patch", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const s = () => useBestSpotStore.getState();
    s().setScoring({ weights: { p: 0.4 } });
    vi.advanceTimersByTime(BESTSPOT.persistDebounceMs);
    expect(loadViewPrefs().bestSpotTuning).toEqual({ weights: { p: 0.4 } });
    s().setScoring(null);
    vi.advanceTimersByTime(BESTSPOT.persistDebounceMs);
    expect(loadViewPrefs().bestSpotTuning).toBeUndefined();
  });
});
