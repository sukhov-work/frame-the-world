import { describe, expect, it } from "vitest";
import {
  applySyncResult,
  dirtyCount,
  isDirty,
  originOf,
  OverrideIndex,
  reconcileShared,
  sharedRowFromPublic,
  SYNC_READ_LAG_GRACE_MS,
  syncPayload,
  type SharedMap,
} from "../../../src/lib/globe/bldgSync";
import {
  overrideKey,
  tombstoneOverride,
  upsertOverride,
  type OverrideMap,
  type OverrideRow,
} from "../../../src/lib/globe/bldgOverrides";
import type { PublicOverride } from "../../../src/lib/wix/overrideRecords";

// MESH SUITE MS3 — the merge policy between MY rows and the WORLD's, the SYNC payload and the
// engine's two lookups. Pure: no storage (the persistence calls inside bldgOverrides are
// no-ops without localStorage), no engine.

const V = "dnipro-o2w";
const K = (cell: string, fid: number) => overrideKey(V, cell, fid);
const row = (over: Partial<OverrideRow> = {}): OverrideRow => ({
  sy: 2,
  cx: 120.5,
  cz: -44,
  vc: 96,
  hM: 12.5,
  t: 1000,
  ...over,
});
const pub = (over: Partial<PublicOverride> = {}): PublicOverride => ({
  variant: V,
  cell: "cell-10-10.glb",
  featureId: 7,
  osmId: "w141472295",
  heightScale: 1.5,
  cx: 120.5,
  cz: -44,
  vc: 96,
  bakedHeightM: 12.5,
  updatedAt: 5000,
  ...over,
});

describe("sharedRowFromPublic — the wire → the local row grammar", () => {
  it("maps heightScale/osmId/bakedHeightM/updatedAt and keeps only the present spatial fields", () => {
    const r = sharedRowFromPublic(pub({ rotDeg: 30, tE: 5, tN: -2 }), 9999);
    expect(r).not.toBeNull();
    expect(r!.key).toBe(K("cell-10-10.glb", 7));
    expect(r!.row).toEqual({ sy: 1.5, rotDeg: 30, tE: 5, tN: -2, cx: 120.5, cz: -44, vc: 96, hM: 12.5, t: 5000, s: 5000, o: "w141472295" });
  });

  it("falls back to the fetch time without updatedAt, drops junk keys and out-of-rail rows", () => {
    expect(sharedRowFromPublic(pub({ updatedAt: undefined }), 9999)!.row.t).toBe(9999);
    expect(sharedRowFromPublic(pub({ cell: "a|b" }), 1)).toBeNull();
    expect(sharedRowFromPublic(pub({ featureId: -1 }), 1)).toBeNull();
    expect(sharedRowFromPublic(pub({ heightScale: 5000 }), 1)).toBeNull(); // past the loose sanity rail (MS5b)
    expect(sharedRowFromPublic(pub({ osmId: null }), 1)!.row.o).toBeUndefined();
  });
});

describe("reconcileShared — local pending wins, shared wins over my synced copy", () => {
  it("a dirty local row masks the world's row; a synced one is refreshed from it", () => {
    const local: OverrideMap = {
      [K("c.glb", 1)]: row({ sy: 3, t: 100 }), // dirty (no s)
      [K("c.glb", 2)]: row({ sy: 3, t: 100, s: 200 }), // synced copy
    };
    const shared: SharedMap = new Map();
    const rows = [
      { key: K("c.glb", 1), row: row({ sy: 1.2, t: 500, s: 500 }) },
      { key: K("c.glb", 2), row: row({ sy: 1.7, t: 500, s: 500 }) },
    ];
    const { changed } = reconcileShared(local, shared, rows, true, 900);
    expect(changed).toBe(1);
    expect(local[K("c.glb", 1)].sy).toBe(3); // mine, pending — untouched
    expect(local[K("c.glb", 2)]).toEqual({ ...row({ sy: 1.7, t: 500 }), s: 900 }); // the world's version
    expect(shared.size).toBe(2);
  });

  it("a COMPLETE fetch deletes a synced row the world no longer has; a partial one never does", () => {
    const mk = () => ({ [K("c.glb", 9)]: row({ t: 100, s: 200 }), [K("c.glb", 8)]: row({ t: 100 }) });
    const complete = mk();
    reconcileShared(complete, new Map(), [], true, 900_000);
    expect(complete[K("c.glb", 9)]).toBeUndefined(); // synced + absent → someone reset it
    expect(complete[K("c.glb", 8)]).toBeDefined(); // dirty → mine, kept
    const partial = mk();
    reconcileShared(partial, new Map(), [], false, 900_000);
    expect(Object.keys(partial)).toHaveLength(2);
  });

  it("a row synced within the read-lag grace is never judged gone (Wix Data reads lag writes)", () => {
    const local: OverrideMap = { [K("c.glb", 9)]: row({ t: 100, s: 1_000 }) };
    reconcileShared(local, new Map(), [], true, 1_000 + SYNC_READ_LAG_GRACE_MS); // exactly at the edge: kept
    expect(local[K("c.glb", 9)]).toBeDefined();
    reconcileShared(local, new Map(), [], true, 1_001 + SYNC_READ_LAG_GRACE_MS); // past it: gone
    expect(local[K("c.glb", 9)]).toBeUndefined();
    const custom: OverrideMap = { [K("c.glb", 9)]: row({ t: 100, s: 1_000 }) };
    reconcileShared(custom, new Map(), [], true, 1_500, 100); // an injected grace
    expect(custom[K("c.glb", 9)]).toBeUndefined();
  });

  it("a tombstone is pending too: it masks the shared row and survives the fetch", () => {
    const local: OverrideMap = {};
    tombstoneOverride(local, K("c.glb", 1), { cx: 1, cz: 2, vc: 3, hM: 4, o: "w1" }, 100);
    const shared: SharedMap = new Map();
    reconcileShared(local, shared, [{ key: K("c.glb", 1), row: row({ o: "w1" }) }], true, 900);
    expect(local[K("c.glb", 1)].d).toBe(1);
    expect(shared.has(K("c.glb", 1))).toBe(true);
  });
});

describe("OverrideIndex — the engine's two lookups", () => {
  const build = () => {
    const local: OverrideMap = {
      [K("a.glb", 1)]: row({ sy: 3, o: "w1" }), // mine
      [K("a.glb", 2)]: { ...row({ o: "w2" }), d: 1, sy: 1 }, // tombstone of a shared row
      ["other|a.glb|5"]: row({ sy: 2 }), // another variant — never served
    };
    const shared: SharedMap = new Map([
      [K("a.glb", 1), row({ sy: 1.5, o: "w1" })], // shadowed by mine
      [K("a.glb", 2), row({ sy: 1.5, o: "w2" })], // masked by the tombstone
      [K("a.glb", 3), row({ sy: 1.5, o: "w3", rotDeg: 10 })], // the world's
      [K("b.glb", 4), row({ sy: 1.5, o: "w4" })],
    ]);
    return { local, shared, index: new OverrideIndex(V, local, shared) };
  };

  it("forCell merges local over shared, masks tombstoned keys, ignores other variants", () => {
    const { index } = build();
    const a = index.forCell("a.glb");
    expect(a.map((e) => [e.featureId, e.origin, e.row.sy])).toEqual([
      [1, "mine", 3],
      [3, "shared", 1.5],
    ]);
    expect(a[1].xf.rotDeg).toBe(10);
    expect(index.forCell("b.glb").map((e) => e.origin)).toEqual(["shared"]);
    expect(index.forCell("zzz.glb")).toEqual([]);
  });

  it("byOsmId finds a row by OSM id, and a tombstone masks the id too", () => {
    const { index } = build();
    expect(index.byOsmId("w1")?.origin).toBe("mine");
    expect(index.byOsmId("w3")?.key).toBe(K("a.glb", 3));
    expect(index.byOsmId("w2")).toBeNull(); // reset pending — a re-baked twin must not come back
    expect(index.byOsmId("w999")).toBeNull();
  });

  it("invalidate() rebuilds from the live maps", () => {
    const { local, index } = build();
    expect(index.forCell("a.glb")).toHaveLength(2);
    upsertOverride(local, K("a.glb", 3), row({ sy: 4 }), 5);
    expect(index.forCell("a.glb")).toHaveLength(2); // stale until told
    index.invalidate();
    expect(index.forCell("a.glb").find((e) => e.featureId === 3)?.origin).toBe("mine");
  });
});

describe("syncPayload / applySyncResult — the push and its receipt", () => {
  it("dirty rows become upserts in wire names (spatial only when present); synced rows stay home", () => {
    const local: OverrideMap = {
      [K("c.glb", 1)]: row({ sy: 2, rotDeg: 15, tE: 3, tN: -1, o: "w1", t: 100 }),
      [K("c.glb", 2)]: row({ sy: 1.1, t: 100, s: 200 }), // synced
    };
    const p = syncPayload(local, new Map());
    expect(p.upserts).toEqual([
      {
        variant: V,
        cell: "c.glb",
        featureId: 1,
        osmId: "w1",
        heightScale: 2,
        rotDeg: 15,
        tE: 3,
        tN: -1,
        cx: 120.5,
        cz: -44,
        vc: 96,
        bakedHeightM: 12.5,
      },
    ]);
    expect(p.removes).toEqual([]);
    expect(p.sent).toEqual([[K("c.glb", 1), 100]]);
  });

  it("a tombstone is a remove keyed the way the WORLD knows the row; a stale one only dies", () => {
    const local: OverrideMap = {};
    tombstoneOverride(local, K("c.glb", 1), { cx: 1, cz: 2, vc: 3, hM: 4, o: "w1" }, 100);
    tombstoneOverride(local, K("c.glb", 5), { cx: 1, cz: 2, vc: 3, hM: 4, o: "w5" }, 100);
    const shared: SharedMap = new Map([[K("c.glb", 1), row({ o: "w1-server" })]]);
    const p = syncPayload(local, shared);
    expect(p.removes).toEqual([{ variant: V, cell: "c.glb", featureId: 1, osmId: "w1-server" }]);
    expect(p.sent.map(([k]) => k).sort()).toEqual([K("c.glb", 1), K("c.glb", 5)].sort());
    applySyncResult(local, shared, p, 900);
    expect(local).toEqual({}); // both tombstones gone
    expect(shared.has(K("c.glb", 1))).toBe(false);
  });

  it("applySyncResult stamps the pushed rows synced — unless they changed in flight — and updates the world map", () => {
    const local: OverrideMap = {
      [K("c.glb", 1)]: row({ sy: 2, t: 100 }),
      [K("c.glb", 2)]: row({ sy: 3, t: 100 }),
    };
    const shared: SharedMap = new Map();
    const p = syncPayload(local, shared);
    local[K("c.glb", 2)] = row({ sy: 3.5, t: 150 }); // edited while the request was in flight
    applySyncResult(local, shared, p, 900);
    expect(local[K("c.glb", 1)].s).toBe(900);
    expect(isDirty(local[K("c.glb", 1)])).toBe(false);
    expect(local[K("c.glb", 2)].s).toBeUndefined(); // still pending
    expect(shared.get(K("c.glb", 1))?.sy).toBe(2);
    expect(shared.get(K("c.glb", 2))?.sy).toBe(3.5); // the world map mirrors the local row as it is now
  });
});

describe("originOf / dirtyCount", () => {
  it("names the four states and counts tombstones as pending", () => {
    const local: OverrideMap = { [K("c.glb", 1)]: row({ t: 100 }), [K("c.glb", 2)]: row({ t: 100, s: 100 }) };
    tombstoneOverride(local, K("c.glb", 3), { cx: 1, cz: 2, vc: 3, hM: 4 }, 100);
    const shared: SharedMap = new Map([[K("c.glb", 4), row()]]);
    expect(originOf(local, shared, K("c.glb", 1))).toBe("dirty");
    expect(originOf(local, shared, K("c.glb", 2))).toBe("synced");
    expect(originOf(local, shared, K("c.glb", 3))).toBe("dirty");
    expect(originOf(local, shared, K("c.glb", 4))).toBe("shared");
    expect(originOf(local, shared, K("c.glb", 5))).toBe("none");
    expect(dirtyCount(local)).toBe(2);
  });
});
