import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLDG_OVERRIDES_KEY,
  CENTROID_TOL_M,
  EDIT_MAX_K,
  EDIT_MIN_K,
  OVERRIDES_CAP,
  SCALE_MAX_K,
  SCALE_MIN_K,
  checksumMatches,
  clampEditK,
  deleteOverride,
  dragScaleK,
  loadOverrides,
  markSynced,
  overrideKey,
  parseOverrideKey,
  roundCentroidM,
  sanitizeOverrides,
  saveOverrides,
  unsyncedEntries,
  upsertOverride,
  type OverrideMap,
  type OverrideRow,
} from "../../../src/lib/globe/bldgOverrides";

const row = (over: Partial<OverrideRow> = {}): OverrideRow => ({
  k: 2,
  cx: 120.5,
  cz: -44,
  vc: 96,
  hM: 12.5,
  t: 1000,
  ...over,
});

/** Minimal Storage stand-in — the node test env has no localStorage (prefs.test.ts idiom). */
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

beforeEach(() => vi.stubGlobal("localStorage", fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("bldgOverrides — keys", () => {
  it("round-trips (variant, cellUri, featureId)", () => {
    const key = overrideKey("dnipro-o2w", "cell-10-10.glb", 4711);
    expect(key).toBe("dnipro-o2w|cell-10-10.glb|4711");
    expect(parseOverrideKey(key)).toEqual({
      variant: "dnipro-o2w",
      cellUri: "cell-10-10.glb",
      featureId: 4711,
    });
  });

  it("rejects malformed keys (missing parts, non-integer / negative ids)", () => {
    expect(parseOverrideKey("dnipro-o2w|cell-1-1.glb")).toBeNull();
    expect(parseOverrideKey("|cell-1-1.glb|3")).toBeNull();
    expect(parseOverrideKey("v|c|3.5")).toBeNull();
    expect(parseOverrideKey("v|c|-1")).toBeNull();
    expect(parseOverrideKey("v|c|NaN")).toBeNull();
  });
});

describe("bldgOverrides — sanitize", () => {
  it("keeps a valid row and drops junk shapes without throwing", () => {
    const key = overrideKey("dnipro-o2w", "cell-1-2.glb", 7);
    const raw = {
      [key]: row(),
      "bad-key": row(),
      [overrideKey("v", "c", 1)]: "not-an-object",
      [overrideKey("v", "c", 2)]: { ...row(), k: Number.NaN },
      [overrideKey("v", "c", 3)]: { ...row(), vc: 0 },
      [overrideKey("v", "c", 4)]: { ...row(), hM: -3 },
    };
    expect(sanitizeOverrides(raw)).toEqual({ [key]: row() });
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides("junk")).toEqual({});
  });

  it("drops rows outside the absolute band and neutral (k≈1) rows", () => {
    const keep = overrideKey("v", "c", 1);
    const raw = {
      [keep]: row({ k: SCALE_MAX_K }),
      [overrideKey("v", "c", 2)]: row({ k: SCALE_MAX_K + 0.1 }),
      [overrideKey("v", "c", 3)]: row({ k: SCALE_MIN_K - 0.01 }),
      [overrideKey("v", "c", 4)]: row({ k: 1.001 }),
    };
    expect(Object.keys(sanitizeOverrides(raw))).toEqual([keep]);
  });

  it("preserves the syncedAt marker only when finite", () => {
    const key = overrideKey("v", "c", 1);
    expect(sanitizeOverrides({ [key]: row({ s: 500 }) })[key].s).toBe(500);
    expect(sanitizeOverrides({ [key]: { ...row(), s: "later" } })[key].s).toBeUndefined();
  });
});

describe("bldgOverrides — persistence", () => {
  it("load/save round-trips through localStorage and survives corrupt blobs", () => {
    const key = overrideKey("dnipro-o2w", "cell-3-4.glb", 12);
    const map: OverrideMap = { [key]: row() };
    saveOverrides(map);
    expect(loadOverrides()).toEqual(map);
    localStorage.setItem(BLDG_OVERRIDES_KEY, "{corrupt");
    expect(loadOverrides()).toEqual({});
  });

  it("caps at OVERRIDES_CAP, trimming the OLDEST-updated rows", () => {
    const map: OverrideMap = {};
    for (let i = 0; i < OVERRIDES_CAP + 5; i++)
      map[overrideKey("v", "c", i)] = row({ t: i }); // t ascending: 0..204
    saveOverrides(map);
    const kept = loadOverrides();
    expect(Object.keys(kept).length).toBe(OVERRIDES_CAP);
    expect(kept[overrideKey("v", "c", 0)]).toBeUndefined(); // oldest trimmed
    expect(kept[overrideKey("v", "c", OVERRIDES_CAP + 4)]).toBeDefined(); // newest kept
  });

  it("upsertOverride stores non-neutral, deletes neutral; deleteOverride removes", () => {
    const map: OverrideMap = {};
    const key = overrideKey("v", "c", 9);
    upsertOverride(map, key, row({ k: 1.8 }), 42);
    expect(map[key]).toMatchObject({ k: 1.8, t: 42 });
    expect(loadOverrides()[key]).toMatchObject({ k: 1.8 });
    upsertOverride(map, key, row({ k: 1.0009 }), 43); // neutral → delete
    expect(map[key]).toBeUndefined();
    expect(loadOverrides()[key]).toBeUndefined();
    upsertOverride(map, key, row({ k: 0.6 }), 44);
    deleteOverride(map, key);
    expect(loadOverrides()[key]).toBeUndefined();
  });
});

describe("bldgOverrides — checksum", () => {
  it("rounds to the 0.5 m grid", () => {
    expect(roundCentroidM(120.74)).toBe(120.5);
    expect(roundCentroidM(120.76)).toBe(121);
    expect(roundCentroidM(-3.2)).toBe(-3);
  });

  it("matches within tolerance + exact vert count; rejects a moved footprint or new count", () => {
    const r = row({ cx: 100, cz: -50, vc: 96 });
    expect(checksumMatches(r, 100 + CENTROID_TOL_M, -50, 96)).toBe(true);
    expect(checksumMatches(r, 100, -50 - CENTROID_TOL_M, 96)).toBe(true);
    expect(checksumMatches(r, 100 + CENTROID_TOL_M + 0.01, -50, 96)).toBe(false);
    expect(checksumMatches(r, 100, -50, 95)).toBe(false);
  });
});

describe("bldgOverrides — clamp + drag mapping (owner band 2026-08-18)", () => {
  it("one edit is bounded to [0.5×, 3×] of the height it STARTED at", () => {
    expect(clampEditK(1, 10)).toBe(EDIT_MAX_K);
    expect(clampEditK(1, 0.01)).toBe(EDIT_MIN_K);
    expect(clampEditK(1, 2.2)).toBe(2.2);
    // Compounding: a second edit re-anchors at the current scale…
    expect(clampEditK(3, 100)).toBe(3 * EDIT_MAX_K);
    // …but never escapes the absolute rail.
    expect(clampEditK(9, 100)).toBe(SCALE_MAX_K);
    expect(clampEditK(0.15, 0.001)).toBe(SCALE_MIN_K);
  });

  it("dragScaleK: up grows, down shrinks, distance scales the gain, clamp applies", () => {
    const cfg = { gainPerM: 0.002, minDistM: 8, maxDistM: 500 };
    const hM = 20;
    // 100 px up at 100 m: ΔM = 100·0.002·100 = 20 m → k = 1 + 20/20 = 2.
    expect(dragScaleK(1, 100, 100, hM, cfg)).toBeCloseTo(2);
    expect(dragScaleK(1, -50, 100, hM, cfg)).toBeCloseTo(0.5); // exactly the edit floor
    // Same px at 10× the distance moves 10× the metres (before clamping).
    expect(dragScaleK(1, 10, 500, hM, cfg)).toBeCloseTo(1.5);
    // Distance is clamped into [minDistM, maxDistM].
    expect(dragScaleK(1, 10, 1, hM, cfg)).toBeCloseTo(1 + (10 * 0.002 * 8) / hM);
    expect(dragScaleK(1, 10, 9999, hM, cfg)).toBeCloseTo(1.5);
    // A huge drag hits the per-edit ceiling.
    expect(dragScaleK(1, 10_000, 100, hM, cfg)).toBe(EDIT_MAX_K);
  });
});

describe("bldgOverrides — sync prep (next-phase batch DB sync)", () => {
  it("unsyncedEntries returns never-synced and edited-since rows; markSynced stamps + persists", () => {
    const a = overrideKey("v", "c", 1);
    const b = overrideKey("v", "c", 2);
    const c = overrideKey("v", "c", 3);
    const map: OverrideMap = {
      [a]: row({ t: 100 }), // never synced → dirty
      [b]: row({ t: 100, s: 200 }), // synced after edit → clean
      [c]: row({ t: 300, s: 200 }), // edited since sync → dirty
    };
    expect(unsyncedEntries(map).map(([k]) => k)).toEqual([a, c]);
    markSynced(map, [a, c], 400);
    expect(unsyncedEntries(map)).toEqual([]);
    expect(loadOverrides()[a].s).toBe(400);
  });
});
