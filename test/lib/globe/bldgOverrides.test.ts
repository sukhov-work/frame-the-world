import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLDG_OVERRIDES_KEY,
  CENTROID_TOL_M,
  EDIT_MAX_K,
  EDIT_MIN_K,
  EDIT_MOVE_MAX_M,
  OVERRIDES_CAP,
  SCALE_MAX_K,
  SCALE_MIN_K,
  checksumMatches,
  clampEditK,
  deleteOverride,
  dragScaleK,
  finishSync,
  isNeutralRow,
  isOsmId,
  isTombstone,
  LIFT_MAX_M,
  loadOverrides,
  markSynced,
  overrideKey,
  parseOverrideKey,
  roundCentroidM,
  rowTransform,
  sanitizeOverrides,
  saveOverrides,
  tombstoneOverride,
  TRANSLATE_MAX_M,
  transformFields,
  unsyncedEntries,
  upsertOverride,
  type OverrideMap,
  type OverrideRow,
} from "../../../src/lib/globe/bldgOverrides";
import { IDENTITY_TRANSFORM } from "../../../src/lib/globe/featureTransform";

const row = (over: Partial<OverrideRow> = {}): OverrideRow => ({
  sy: 2,
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
      [overrideKey("v", "c", 2)]: { ...row(), sy: Number.NaN },
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
      [keep]: row({ sy: SCALE_MAX_K }),
      [overrideKey("v", "c", 2)]: row({ sy: SCALE_MAX_K + 0.1 }),
      [overrideKey("v", "c", 3)]: row({ sy: SCALE_MIN_K - 0.01 }),
      [overrideKey("v", "c", 4)]: row({ sy: 1.001 }),
    };
    expect(Object.keys(sanitizeOverrides(raw))).toEqual([keep]);
  });

  it("preserves the syncedAt marker only when finite", () => {
    const key = overrideKey("v", "c", 1);
    expect(sanitizeOverrides({ [key]: row({ s: 500 }) })[key].s).toBe(500);
    expect(sanitizeOverrides({ [key]: { ...row(), s: "later" } })[key].s).toBeUndefined();
  });
});

describe("bldgOverrides — v2 rows (MESH SUITE MS1, 2026-09-02)", () => {
  it("reads a LEGACY `k` row as `sy` — never migrated in place, never dropped (§4a-1)", () => {
    const key = overrideKey("dnipro-o2w", "cell-9-10.glb", 61106);
    const legacy = { k: 3, cx: 12.5, cz: -3, vc: 96, hM: 15, t: 1 }; // a row U8 wrote 2026-08-19
    const out = sanitizeOverrides({ [key]: legacy });
    expect(out[key]).toEqual({ sy: 3, cx: 12.5, cz: -3, vc: 96, hM: 15, t: 1 });
    expect(out[key]).not.toHaveProperty("k");
    expect(rowTransform(out[key])).toEqual({ ...IDENTITY_TRANSFORM, sy: 3 });
    // `sy` wins over a stray legacy `k` when both are present
    expect(sanitizeOverrides({ [key]: { ...legacy, sy: 2 } })[key].sy).toBe(2);
  });

  it("keeps spatial components inside their rails; a junk component drops the WHOLE row", () => {
    const key = overrideKey("v", "c", 1);
    const base = row({ sy: 1 });
    const ok = { ...base, rotDeg: 370, tE: 30, tN: -40, tU: 2, sx: 1.5 }; // |t| = 50 ≤ TRANSLATE_MAX_M
    expect(sanitizeOverrides({ [key]: ok })[key]).toEqual({
      ...base,
      rotDeg: 10,
      tE: 30,
      tN: -40,
      tU: 2,
      sx: 1.5,
    });
    const bad: Array<Record<string, unknown>> = [
      { ...base, tE: 4000, tN: 4000 }, // 5657 m > TRANSLATE_MAX_M (the loose sanity rail, MS5b)
      { ...base, tE: TRANSLATE_MAX_M + 0.01, tN: 0 },
      { ...base, tU: -1 },
      { ...base, tU: LIFT_MAX_M + 1 },
      { ...base, sx: 0 },
      { ...base, sz: SCALE_MAX_K + 1 },
      { ...base, rotDeg: "north" },
      { ...base, tE: Number.NaN, tN: 1 },
    ];
    for (const b of bad) expect(sanitizeOverrides({ [key]: b })).toEqual({});
    // a lone tN is a valid pair (tE defaults to 0)
    expect(sanitizeOverrides({ [key]: { ...base, tN: 5 } })[key]).toMatchObject({ tE: 0, tN: 5 });
  });

  it("neutrality is judged across ALL components: rotated-but-unscaled is KEPT, all-identity is dropped", () => {
    const key = overrideKey("v", "c", 2);
    const base = row({ sy: 1 });
    expect(Object.keys(sanitizeOverrides({ [key]: { ...base, rotDeg: 15 } }))).toEqual([key]);
    expect(sanitizeOverrides({ [key]: { ...base, rotDeg: 0.01, tE: 0.001 } })).toEqual({});
    expect(isNeutralRow({ sy: 1 })).toBe(true);
    expect(isNeutralRow({ sy: 1, tN: 5 })).toBe(false);
    expect(isNeutralRow({ sy: 1.5 })).toBe(false);
    const map: OverrideMap = {};
    upsertOverride(map, key, { ...base, tE: 3, tN: 0 }, 1);
    expect(map[key]).toMatchObject({ tE: 3, t: 1 });
    upsertOverride(map, key, { ...base }, 2); // everything back to original → deleted
    expect(map[key]).toBeUndefined();
  });

  it("transformFields omits identity components and round-trips through rowTransform", () => {
    const t = { sy: 2, sx: 1, sz: 1.25, rotDeg: -30, tE: 0, tN: 0, tU: 0 };
    const fields = transformFields(t);
    expect(fields).toEqual({ sy: 2, sz: 1.25, rotDeg: -30 });
    expect(rowTransform(fields)).toEqual(t);
    // sub-threshold gizmo noise never lands in storage; a translation pair travels together
    expect(transformFields({ ...IDENTITY_TRANSFORM, sy: 1.5, tE: 0.004, tU: 0.001 })).toEqual({ sy: 1.5 });
    expect(transformFields({ ...IDENTITY_TRANSFORM, tE: 2, tN: 0 })).toEqual({ sy: 1, tE: 2, tN: 0 });
    expect(transformFields({ ...IDENTITY_TRANSFORM, rotDeg: 400 })).toEqual({ sy: 1, rotDeg: 40 });
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
    upsertOverride(map, key, row({ sy: 1.8 }), 42);
    expect(map[key]).toMatchObject({ sy: 1.8, t: 42 });
    expect(loadOverrides()[key]).toMatchObject({ sy: 1.8 });
    upsertOverride(map, key, row({ sy: 1.0009 }), 43); // neutral → delete
    expect(map[key]).toBeUndefined();
    expect(loadOverrides()[key]).toBeUndefined();
    upsertOverride(map, key, row({ sy: 0.6 }), 44);
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

describe("bldgOverrides — clamp + drag mapping (per-edit band: owner 2026-09-02j, the extrude editing model)", () => {
  it("one edit is bounded to [0.1×, 10×] of the value it STARTED at — the committed one", () => {
    expect(EDIT_MIN_K).toBe(0.1);
    expect(EDIT_MAX_K).toBe(10);
    expect(clampEditK(1, 100)).toBe(EDIT_MAX_K);
    expect(clampEditK(1, 0.01)).toBe(EDIT_MIN_K);
    expect(clampEditK(1, 2.2)).toBe(2.2);
    // Compounding: a second edit re-anchors at the current scale, with NO absolute cap…
    expect(clampEditK(3, 100)).toBe(3 * EDIT_MAX_K);
    expect(clampEditK(9, 100)).toBe(90);
    expect(clampEditK(0.15, 0.001)).toBeCloseTo(0.015, 12);
    // …short of the loose sanity rail (garbage, not taste).
    expect(clampEditK(500, 1e6)).toBe(SCALE_MAX_K);
    expect(clampEditK(0.005, 1e-9)).toBe(SCALE_MIN_K);
  });

  it("dragScaleK: up grows, down shrinks, distance scales the gain, clamp applies", () => {
    const cfg = { gainPerM: 0.002, minDistM: 8, maxDistM: 500 };
    const hM = 20;
    // 100 px up at 100 m: ΔM = 100·0.002·100 = 20 m → k = 1 + 20/20 = 2.
    expect(dragScaleK(1, 100, 100, hM, cfg)).toBeCloseTo(2);
    expect(dragScaleK(1, -50, 100, hM, cfg)).toBeCloseTo(0.5); // −10 m on 20 m (unclamped)
    // Same px at 10× the distance moves 10× the metres (before clamping).
    expect(dragScaleK(1, 10, 500, hM, cfg)).toBeCloseTo(1.5);
    // Distance is clamped into [minDistM, maxDistM].
    expect(dragScaleK(1, 10, 1, hM, cfg)).toBeCloseTo(1 + (10 * 0.002 * 8) / hM);
    expect(dragScaleK(1, 10, 9999, hM, cfg)).toBeCloseTo(1.5);
    // A huge drag hits the per-edit ceiling (ten times the start), a huge downward one the floor.
    expect(dragScaleK(1, 10_000, 100, hM, cfg)).toBe(EDIT_MAX_K);
    expect(dragScaleK(1, -10_000, 100, hM, cfg)).toBe(EDIT_MIN_K);
    expect(dragScaleK(4, 10_000, 100, hM, cfg)).toBe(40);
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

// ── MESH SUITE MS2 — the gizmo's live clamp ─────────────────────────────────────────────────
import { clampGizmoEdit } from "../../../src/lib/globe/bldgOverrides";

describe("clampGizmoEdit (per-edit rails about the COMMITTED transform — MS5b 2026-09-02l)", () => {
  const start = { ...IDENTITY_TRANSFORM };

  it("inside the rails and the band it is the identity map", () => {
    const t = { sx: 1.2, sz: 0.9, sy: 1.4, rotDeg: 25, tE: 6, tN: -4, tU: 1.5 };
    expect(clampGizmoEdit(t, start)).toEqual(t);
  });

  it("applies the 0.1×/10× per-edit band about the START value on X, Z and Y; edits compound with no absolute cap", () => {
    const t = { sx: 40, sz: 0.05, sy: 12, rotDeg: 0, tE: 0, tN: 0, tU: 0 };
    const c = clampGizmoEdit(t, start);
    expect(c.sx).toBe(EDIT_MAX_K); // 10 = start 1 × 10
    expect(c.sz).toBe(EDIT_MIN_K); // 0.1
    expect(c.sy).toBe(EDIT_MAX_K);
    // A second drag re-anchors on the committed value — the old absolute 10× cap is gone.
    const c2 = clampGizmoEdit({ ...t, sx: 9 }, { ...start, sx: 3 });
    expect(c2.sx).toBe(9);
    const c3 = clampGizmoEdit({ ...t, sx: 60 }, { ...start, sx: 5 });
    expect(c3.sx).toBe(50); // 5 × 10, past the old absolute rail
    // Only the loose sanity rail ever caps the compound.
    const c4 = clampGizmoEdit({ ...t, sx: 5000 }, { ...start, sx: 500 });
    expect(c4.sx).toBe(SCALE_MAX_K);
  });

  it("the MOVE rail is per edit: the OFFSET from the committed position is shortened to EDIT_MOVE_MAX_M, direction kept", () => {
    expect(EDIT_MOVE_MAX_M).toBe(100);
    const c = clampGizmoEdit({ sx: 1, sz: 1, sy: 1, rotDeg: 370, tE: 300, tN: 400, tU: 99 }, start);
    expect(Math.hypot(c.tE, c.tN)).toBeCloseTo(EDIT_MOVE_MAX_M, 9);
    expect(c.tE / c.tN).toBeCloseTo(0.75, 12);
    expect(c.tU).toBe(LIFT_MAX_M); // the lift stays absolute
    expect(c.rotDeg).toBeCloseTo(10, 9);
    // Re-anchored: a building standing 90 m east (past the old 60 m absolute rail) goes on to 190 m.
    const far = { ...start, tE: 90, tN: 0 };
    const c2 = clampGizmoEdit({ ...far, tE: 300 }, far);
    expect(c2.tE).toBeCloseTo(190, 9);
    expect(c2.tN).toBe(0);
    // Inside the per-edit radius nothing is touched, wherever the building stands.
    const c3 = clampGizmoEdit({ ...far, tE: 150, tN: -30 }, far);
    expect(c3.tE).toBe(150);
    expect(c3.tN).toBe(-30);
    // The loose sanity rail on the ABSOLUTE offset still holds (5 km).
    const edge = { ...start, tE: 4990, tN: 0 };
    const c4 = clampGizmoEdit({ ...edge, tE: 5050 }, edge);
    expect(c4.tE).toBeCloseTo(TRANSLATE_MAX_M, 9);
  });

  it("a mirrored (negative) scale from a handle crossing the origin lands on the band floor", () => {
    const c = clampGizmoEdit({ sx: -2, sz: 1, sy: -1, rotDeg: 0, tE: 0, tN: 0, tU: 0 }, start);
    expect(c.sx).toBe(EDIT_MIN_K);
    expect(c.sy).toBe(EDIT_MIN_K);
  });

  it("non-finite input degrades to the START per component (identity from identity), never NaN", () => {
    const c = clampGizmoEdit({ sx: NaN, sz: 1, sy: NaN, rotDeg: NaN, tE: NaN, tN: 0, tU: NaN }, start);
    expect(c).toEqual({ ...IDENTITY_TRANSFORM });
    const s2 = { ...start, sx: 3, sy: 2, tE: 40, tN: -10 };
    const c2 = clampGizmoEdit({ sx: NaN, sz: 1, sy: NaN, rotDeg: 0, tE: NaN, tN: NaN, tU: 0 }, s2);
    expect(c2).toEqual({ ...s2, sz: 1, rotDeg: 0, tU: 0 });
  });
});

// ── MESH SUITE MS3 (2026-09-02): the OSM recovery key `o`, TOMBSTONES `d`, and the SYNC bookends ──
describe("bldgOverrides — MS3 row grammar (o / d) + the SYNC bookends", () => {
  it("sanitizeRow keeps a well-formed OSM id and drops a malformed one (the field, never the row)", () => {
    expect(sanitizeOverrides({ "v|c|1": { ...row(), o: "w141472295" } })["v|c|1"].o).toBe("w141472295");
    expect(sanitizeOverrides({ "v|c|1": { ...row(), o: "building-7" } })["v|c|1"]).toEqual(row());
    expect(sanitizeOverrides({ "v|c|1": { ...row(), o: 42 } })["v|c|1"].o).toBeUndefined();
  });

  it("a tombstone survives sanitize although it is neutral, with only the facts", () => {
    const tomb = { d: 1, sy: 1, cx: 1, cz: 2, vc: 3, hM: 4, t: 9, o: "n5", sx: 3, rotDeg: 40 };
    const out = sanitizeOverrides({ "v|c|1": tomb })["v|c|1"];
    expect(out).toEqual({ sy: 1, d: 1, cx: 1, cz: 2, vc: 3, hM: 4, t: 9, o: "n5" }); // the spatial junk is dropped
    expect(isTombstone(out)).toBe(true);
    expect(rowTransform(out)).toEqual(IDENTITY_TRANSFORM);
    expect(isNeutralRow(out)).toBe(true);
    expect(sanitizeOverrides({ "v|c|1": { d: 1, sy: 1 } })).toEqual({}); // no facts → junk
  });

  it("upsertOverride stores a tombstone (neutral by construction) and a later real edit replaces it", () => {
    const map: OverrideMap = {};
    tombstoneOverride(map, "v|c|1", { cx: 1, cz: 2, vc: 3, hM: 4, o: "w1" }, 100);
    expect(map["v|c|1"]).toEqual({ sy: 1, d: 1, cx: 1, cz: 2, vc: 3, hM: 4, t: 100, o: "w1" });
    expect(unsyncedEntries(map)).toHaveLength(1); // a pending removal is pending
    upsertOverride(map, "v|c|1", { ...row({ sy: 2, o: "w1" }) }, 200);
    expect(map["v|c|1"].d).toBeUndefined();
    expect(map["v|c|1"].sy).toBe(2);
    upsertOverride(map, "v|c|1", { ...row({ sy: 1 }) }, 300); // a plain neutral row still deletes
    expect(map["v|c|1"]).toBeUndefined();
  });

  it("finishSync stamps only the rows still as sent, and deletes landed tombstones", () => {
    const map: OverrideMap = { "v|c|1": row({ t: 100 }), "v|c|2": row({ t: 100 }) };
    tombstoneOverride(map, "v|c|3", { cx: 1, cz: 2, vc: 3, hM: 4 }, 100);
    const sent: Array<[string, number]> = [["v|c|1", 100], ["v|c|2", 100], ["v|c|3", 100], ["v|c|9", 100]];
    map["v|c|2"] = row({ t: 150 }); // edited while in flight
    finishSync(map, sent, 900);
    expect(map["v|c|1"].s).toBe(900);
    expect(map["v|c|2"].s).toBeUndefined();
    expect(map["v|c|3"]).toBeUndefined();
    expect(unsyncedEntries(map).map(([k]) => k)).toEqual(["v|c|2"]);
  });

  it("isOsmId accepts node/way/relation ids only", () => {
    expect(isOsmId("w141472295")).toBe(true);
    expect(isOsmId("n1")).toBe(true);
    expect(isOsmId("r99")).toBe(true);
    expect(isOsmId("141472295")).toBe(false);
    expect(isOsmId("w")).toBe(false);
    expect(isOsmId("x12")).toBe(false);
  });
});
