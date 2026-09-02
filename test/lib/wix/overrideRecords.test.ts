import { describe, expect, it } from "vitest";
import {
  GET_MAX_PAGES,
  overrideId,
  overrideRecord,
  parseSyncBody,
  parseSyncEntry,
  publicOverride,
  SYNC_MAX,
} from "../../../src/lib/wix/overrideRecords";
import { LIFT_MAX_M, SCALE_MAX_K, SCALE_MIN_K, TRANSLATE_MAX_M } from "../../../src/lib/globe/bldgOverrides";

// The building-overrides wire contract (U8 backend prep → MESH SUITE MS3 activation):
// deterministic LWW ids (OSM-keyed when the building has one — the §4a-2 dual key), server-side
// clamps on EVERY component, identity spatial components omitted, memberId stamped-but-never-
// published. "dnipro-o2w" is a real registry variant — parseSyncEntry validates variants against
// lib/globe/regions.

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  variant: "dnipro-o2w",
  cell: "cell-10-10.glb",
  featureId: 4711,
  osmId: "w141472295",
  heightScale: 2,
  cx: 120.5,
  cz: -44,
  vc: 96,
  bakedHeightM: 12.5,
  ...over,
});

describe("overrideId — the deterministic LWW upsert key (dual: OSM id, else the fingerprint)", () => {
  it("is stable, 32 hex chars, and key-sensitive on the fingerprint", () => {
    const a = overrideId("dnipro-o2w", "cell-10-10.glb", 4711);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(overrideId("dnipro-o2w", "cell-10-10.glb", 4711)).toBe(a);
    expect(overrideId("dnipro-o2w", "cell-10-10.glb", 4712)).not.toBe(a);
    expect(overrideId("dnipro", "cell-10-10.glb", 4711)).not.toBe(a);
    expect(overrideId("dnipro-o2w", "cell-10-11.glb", 4711)).not.toBe(a);
  });

  it("MS3: an OSM id keys the row by (variant, osm) — the same building survives a re-bake's new cell/featureId", () => {
    const osm = overrideId("dnipro-o2w", "cell-10-10.glb", 4711, "w141472295");
    expect(osm).toMatch(/^[0-9a-f]{32}$/);
    expect(overrideId("dnipro-o2w", "cell-99-99.glb", 1, "w141472295")).toBe(osm); // re-bake moved it
    expect(overrideId("dnipro", "cell-10-10.glb", 4711, "w141472295")).not.toBe(osm); // per variant
    expect(overrideId("dnipro-o2w", "cell-10-10.glb", 4711, "w141472296")).not.toBe(osm);
    expect(osm).not.toBe(overrideId("dnipro-o2w", "cell-10-10.glb", 4711)); // ≠ the fingerprint id
    expect(overrideId("dnipro-o2w", "cell-10-10.glb", 4711, null)).toBe(overrideId("dnipro-o2w", "cell-10-10.glb", 4711));
  });
});

describe("parseSyncEntry", () => {
  it("accepts a valid entry and clamps heightScale to the shared band (never rejects drift)", () => {
    expect(parseSyncEntry(entry())).toMatchObject({ heightScale: 2, osmId: "w141472295" });
    expect(parseSyncEntry(entry({ heightScale: 99 }))?.heightScale).toBe(SCALE_MAX_K);
    expect(parseSyncEntry(entry({ heightScale: 0.001 }))?.heightScale).toBe(SCALE_MIN_K);
  });

  it("MS3: clamps the spatial components onto the rails and OMITS identity ones", () => {
    const e = parseSyncEntry(entry({ tE: 300, tN: 400, tU: 99, sx: 50, sz: 0.5, rotDeg: 370 }))!;
    expect(Math.hypot(e.tE!, e.tN!)).toBeCloseTo(TRANSLATE_MAX_M, 6);
    expect(e.tE! / e.tN!).toBeCloseTo(0.75, 9); // direction kept
    expect(e.tU).toBe(LIFT_MAX_M);
    expect(e.sx).toBe(SCALE_MAX_K);
    expect(e.sz).toBe(0.5);
    expect(e.rotDeg).toBe(10);
    const plain = parseSyncEntry(entry({ sx: 1, sz: 1.001, rotDeg: 0, tE: 0, tN: 0, tU: 0 }))!;
    for (const k of ["sx", "sz", "rotDeg", "tE", "tN", "tU"]) expect(plain).not.toHaveProperty(k);
    const legacy = parseSyncEntry(entry())!; // no spatial fields at all → none emitted
    for (const k of ["sx", "sz", "rotDeg", "tE", "tN", "tU"]) expect(legacy).not.toHaveProperty(k);
  });

  it("MS3: a malformed osmId drops to null (the fingerprint still identifies the building)", () => {
    expect(parseSyncEntry(entry({ osmId: "building-7" }))?.osmId).toBeNull();
    expect(parseSyncEntry(entry({ osmId: 42 }))?.osmId).toBeNull();
    expect(parseSyncEntry(entry({ osmId: undefined }))?.osmId).toBeNull();
    expect(parseSyncEntry(entry({ osmId: "n1782058413" }))?.osmId).toBe("n1782058413");
  });

  it("rejects unknown variants (typo/vandalism probe) and structural junk", () => {
    expect(parseSyncEntry(entry({ variant: "not-a-region" }))).toBeNull();
    expect(parseSyncEntry(entry({ featureId: 1.5 }))).toBeNull();
    expect(parseSyncEntry(entry({ featureId: -1 }))).toBeNull();
    expect(parseSyncEntry(entry({ vc: 0 }))).toBeNull();
    expect(parseSyncEntry(entry({ bakedHeightM: 0 }))).toBeNull();
    expect(parseSyncEntry(entry({ cell: "" }))).toBeNull();
    expect(parseSyncEntry(null)).toBeNull();
  });
});

describe("parseSyncBody", () => {
  it("parses upserts + removes (removes carry the OSM id the row is keyed by) and names the offending index on junk", () => {
    const ok = parseSyncBody({
      upserts: [entry()],
      removes: [
        { variant: "dnipro-o2w", cell: "cell-1-1.glb", featureId: 7, osmId: "w7" },
        { variant: "dnipro-o2w", cell: "cell-1-1.glb", featureId: 8 },
      ],
    });
    expect("error" in ok).toBe(false);
    if (!("error" in ok)) {
      expect(ok.upserts).toHaveLength(1);
      expect(ok.removes).toEqual([
        { variant: "dnipro-o2w", cell: "cell-1-1.glb", featureId: 7, osmId: "w7" },
        { variant: "dnipro-o2w", cell: "cell-1-1.glb", featureId: 8, osmId: null },
      ]);
    }
    const bad = parseSyncBody({ upserts: [entry(), entry({ vc: -1 })] });
    expect(bad).toEqual({ error: "upserts[1] is not a valid override entry" });
    const badRemove = parseSyncBody({ removes: [{ variant: "v" }] });
    expect(badRemove).toEqual({ error: "removes[0] is not a valid override key" });
  });

  it("rejects empty syncs and oversize batches (the platform bulk cap)", () => {
    expect(parseSyncBody({})).toMatchObject({ error: expect.stringContaining("nothing") });
    expect(
      parseSyncBody({ upserts: Array.from({ length: SYNC_MAX + 1 }, () => entry()) }),
    ).toMatchObject({ error: expect.stringContaining(`${SYNC_MAX}`) });
    expect(GET_MAX_PAGES * SYNC_MAX).toBeGreaterThanOrEqual(10_000);
  });
});

describe("overrideRecord / publicOverride", () => {
  it("builds a COMPLETE row (bulkSave replaces whole items): the OSM-keyed _id, every spatial field (null = identity), region, memberId", () => {
    const e = parseSyncEntry(entry({ rotDeg: 25, tE: 6, tN: -4 }));
    expect(e).not.toBeNull();
    const row = overrideRecord(e!, "member-guid-123");
    expect(row).toEqual({
      _id: overrideId("dnipro-o2w", "cell-10-10.glb", 4711, "w141472295"),
      variant: "dnipro-o2w",
      cell: "cell-10-10.glb",
      featureId: 4711,
      osmId: "w141472295",
      heightScale: 2,
      sx: null,
      sz: null,
      rotDeg: 25,
      tE: 6,
      tN: -4,
      tU: null,
      cx: 120.5,
      cz: -44,
      vc: 96,
      bakedHeightM: 12.5,
      region: "dnipro",
      memberId: "member-guid-123",
    });
    expect(overrideRecord(parseSyncEntry(entry({ osmId: null }))!, "m")._id).toBe(
      overrideId("dnipro-o2w", "cell-10-10.glb", 4711),
    );
  });

  it("publicOverride NEVER emits memberId (C6), emits the present spatial fields + osmId + bakedHeightM + updatedAt, and drops bad rows", () => {
    const e = parseSyncEntry(entry({ tU: 3 }));
    const row = overrideRecord(e!, "member-guid-123");
    const pub = publicOverride({ ...row, _updatedDate: new Date(1_700_000_000_000) });
    expect(pub).not.toBeNull();
    expect(pub).not.toHaveProperty("memberId");
    expect(pub).toEqual({
      variant: "dnipro-o2w",
      cell: "cell-10-10.glb",
      featureId: 4711,
      osmId: "w141472295",
      heightScale: 2,
      tU: 3,
      cx: 120.5,
      cz: -44,
      vc: 96,
      bakedHeightM: 12.5,
      updatedAt: 1_700_000_000_000,
    });
    expect(publicOverride({ ...row, _updatedDate: "2026-09-02T00:00:00.000Z" })?.updatedAt).toBe(Date.parse("2026-09-02T00:00:00.000Z"));
    expect(publicOverride(row)).not.toHaveProperty("updatedAt");
    expect(publicOverride({ ...row, osmId: "junk" })?.osmId).toBeNull();
    expect(publicOverride({ variant: "v" })).toBeNull();
    expect(publicOverride({ ...row, bakedHeightM: "12" })).toBeNull();
  });
});
