import { describe, it, expect } from "vitest";
import {
  bboxCenterDeg,
  bboxClipPrismEcef,
  bboxContainsDeg,
  bboxContainsRad,
  bboxToRadians,
  csrFromRunIds,
  featureRunsOf,
  mapVertsToRuns,
  planeDistance,
  regionCenterDeg,
  runCentroid,
  seatStep,
  vertexKeyToRun,
  type GeoBbox,
} from "../../../src/lib/globe/enrichedMask";
import { geodeticToEcef, length } from "../../../src/lib/geo/projection";

// The Slice-0 mask bbox (matches ENRICHED.bbox in tuning.ts — a touch larger than the sample
// tileset extent so it fully covers the OSM buildings under every enriched building).
const DNIPRO: GeoBbox = { west: 35.038, south: 48.457, east: 35.053, north: 48.467 };
const DEG = Math.PI / 180;

describe("enrichedMask — bbox containment", () => {
  it("contains a point inside the Dnipro sample box (deg)", () => {
    expect(bboxContainsDeg(DNIPRO, 35.0456, 48.4622)).toBe(true); // the tileset origin
  });

  it("rejects points outside — Kyiv, and just west/east/north/south of the box", () => {
    expect(bboxContainsDeg(DNIPRO, 30.523, 50.45)).toBe(false); // Kyiv
    expect(bboxContainsDeg(DNIPRO, 35.03, 48.4622)).toBe(false); // west of box
    expect(bboxContainsDeg(DNIPRO, 35.06, 48.4622)).toBe(false); // east of box
    expect(bboxContainsDeg(DNIPRO, 35.0456, 48.47)).toBe(false); // north of box
    expect(bboxContainsDeg(DNIPRO, 35.0456, 48.45)).toBe(false); // south of box
  });

  it("is inclusive on the edges", () => {
    expect(bboxContainsDeg(DNIPRO, DNIPRO.west, DNIPRO.south)).toBe(true);
    expect(bboxContainsDeg(DNIPRO, DNIPRO.east, DNIPRO.north)).toBe(true);
  });

  it("radian containment matches degree containment (the hot path is radians)", () => {
    const r = bboxToRadians(DNIPRO);
    // inside
    expect(bboxContainsRad(r, 35.0456 * DEG, 48.4622 * DEG)).toBe(true);
    // outside
    expect(bboxContainsRad(r, 30.523 * DEG, 50.45 * DEG)).toBe(false);
    // radian conversion preserves order
    expect(r.west).toBeLessThan(r.east);
    expect(r.south).toBeLessThan(r.north);
  });
});

describe("enrichedMask — bbox centre (the R1 re-seat sample point)", () => {
  it("returns the geometric centre in degrees", () => {
    const c = bboxCenterDeg(DNIPRO);
    expect(c.lonDeg).toBeCloseTo((35.038 + 35.053) / 2, 6);
    expect(c.latDeg).toBeCloseTo((48.457 + 48.467) / 2, 6);
  });

  it("the centre is inside its own box", () => {
    const c = bboxCenterDeg(DNIPRO);
    expect(bboxContainsDeg(DNIPRO, c.lonDeg, c.latDeg)).toBe(true);
  });
});

describe("enrichedMask — region centre (Slice-2 per-cell re-seat sample points)", () => {
  it("converts a radian region [w,s,e,n,minH,maxH] to its centre in degrees", () => {
    // An asymmetric cell of the Dnipro bake grid (the baker writes regions from ACTUAL building
    // extents, so cells are never perfectly square) + the region-pad heights it now bakes.
    const region = [35.01 * DEG, 48.44 * DEG, 35.03 * DEG, 48.47 * DEG, -80, 209];
    const c = regionCenterDeg(region);
    expect(c.lonDeg).toBeCloseTo(35.02, 9);
    expect(c.latDeg).toBeCloseTo(48.455, 9);
  });

  it("agrees with bboxCenterDeg for the same box (radians vs degrees round-trip)", () => {
    const r = bboxToRadians(DNIPRO);
    const viaRegion = regionCenterDeg([r.west, r.south, r.east, r.north, 0, 100]);
    const viaBbox = bboxCenterDeg(DNIPRO);
    expect(viaRegion.lonDeg).toBeCloseTo(viaBbox.lonDeg, 9);
    expect(viaRegion.latDeg).toBeCloseTo(viaBbox.latDeg, 9);
  });
});

describe("enrichedMask — seatStep (per-cell seat easing)", () => {
  it("snaps to the target on the first sample (applied null)", () => {
    expect(seatStep(null, -23.4, 0.12)).toBe(-23.4);
  });

  it("eases exponentially toward a refreshed target", () => {
    expect(seatStep(0, 10, 0.12)).toBeCloseTo(1.2, 9);
    expect(seatStep(1.2, 10, 0.12)).toBeCloseTo(1.2 + (10 - 1.2) * 0.12, 9);
  });

  it("converges: repeated steps land within 1 cm of the target", () => {
    let applied: number | null = null;
    applied = seatStep(applied, 0, 0.12); // first sample snaps to 0
    for (let i = 0; i < 120; i++) applied = seatStep(applied, -31.7, 0.12); // ~2 s at 60 Hz
    expect(Math.abs(applied - -31.7)).toBeLessThan(0.01);
  });

  it("is a fixed point at the target (no drift once settled)", () => {
    expect(seatStep(-31.7, -31.7, 0.12)).toBe(-31.7);
  });
});

describe("enrichedMask — bboxClipPrismEcef (Slice-2 clipping-plane hole)", () => {
  // The FULL-city bbox (Slice 2) — the prism must hold at this scale, not just the sample's.
  const BOX: GeoBbox = { west: 35.0, south: 48.42, east: 35.1, north: 48.5 };
  const prism = bboxClipPrismEcef(BOX);
  // three's clipIntersection semantics: a fragment is discarded ONLY when d < 0 for ALL planes.
  const clipped = (latDeg: number, lonDeg: number, hM = 0) => {
    const p = geodeticToEcef(latDeg, lonDeg, hM);
    return prism.every((pl) => planeDistance(pl, p) < 0);
  };

  it("returns 4 unit-normal planes", () => {
    expect(prism).toHaveLength(4);
    for (const pl of prism) expect(length(pl.normal)).toBeCloseTo(1, 9);
  });

  it("clips inside the box — centre, near-corner insets, and at building height", () => {
    expect(clipped(48.46, 35.05)).toBe(true); // centre, ground
    expect(clipped(48.46, 35.05, 200)).toBe(true); // centre, above the tallest roof
    // ~50 m inside each corner (0.0005° lat ≈ 55 m, 0.0007° lon ≈ 52 m at this latitude)
    expect(clipped(48.4205, 35.0007)).toBe(true); // SW
    expect(clipped(48.4995, 35.0993)).toBe(true); // NE
    expect(clipped(48.4205, 35.0993)).toBe(true); // SE
    expect(clipped(48.4995, 35.0007)).toBe(true); // NW
  });

  it("keeps fragments outside each wall (the OSM city around the box survives)", () => {
    expect(clipped(48.46, 34.999)).toBe(false); // just west
    expect(clipped(48.46, 35.101)).toBe(false); // just east
    expect(clipped(48.419, 35.05)).toBe(false); // just south
    expect(clipped(48.501, 35.05)).toBe(false); // just north
  });

  it("never clips far geometry — Kyiv, the southern hemisphere, the antipode", () => {
    expect(clipped(50.45, 30.523)).toBe(false); // Kyiv
    expect(clipped(-48.46, 35.05)).toBe(false); // mirrored latitude
    expect(clipped(-48.46, -144.95)).toBe(false); // antipode
    expect(clipped(48.46, -144.95)).toBe(false); // same lat, far lon
  });

  it("the E/W meridian walls are exact through the Earth axis (constant 0)", () => {
    expect(prism[0].constant).toBe(0);
    expect(prism[1].constant).toBe(0);
    // and their normals have no z-component (the meridian plane contains the axis)
    expect(Math.abs(prism[0].normal[2])).toBe(0); // |−0| — the west wall negates east
    expect(Math.abs(prism[1].normal[2])).toBe(0);
  });

  it("N/S tangent-plane error at the corners stays under ~3 m (city-scale approximation bound)", () => {
    // A point ON the south parallel at the box's west edge: the exact boundary. Its distance to the
    // tangent-plane wall is the planar-approximation error — must be far below building granularity.
    const cornerOnParallel = geodeticToEcef(48.42, 35.0, 0);
    const southWall = prism[2];
    expect(Math.abs(planeDistance(southWall, cornerOnParallel))).toBeLessThan(3);
  });
});

describe("enrichedMask — per-feature run helpers (owner 2026-07-14 per-building re-seat)", () => {
  it("featureRunsOf scans contiguous constant-id runs (GLOBAL ids, gaps allowed)", () => {
    expect(featureRunsOf([7, 7, 7, 42, 42, 9])).toEqual([
      { id: 7, start: 0, count: 3 },
      { id: 42, start: 3, count: 2 },
      { id: 9, start: 5, count: 1 },
    ]);
    expect(featureRunsOf([])).toEqual([]);
    expect(featureRunsOf([5])).toEqual([{ id: 5, start: 0, count: 1 }]);
  });

  it("runCentroid is the vertex mean of the run only", () => {
    // Two runs: feature A = 2 verts around (1, 2, 3); feature B far away.
    const pos = [0, 0, 0, 2, 4, 6, 100, 100, 100];
    const runs = featureRunsOf([1, 1, 2]);
    expect(runCentroid(pos, runs[0])).toEqual([1, 2, 3]);
    expect(runCentroid(pos, runs[1])).toEqual([100, 100, 100]);
  });

  it("vertexKeyToRun + mapVertsToRuns maps EXACT float copies back to their building", () => {
    // Source: run 0 owns verts at (0,0,0)/(1,5,0); run 1 owns (10,0,0). The "edges" buffer holds
    // exact copies (EdgesGeometry copies floats verbatim) plus one vertex from nowhere.
    const src = [0, 0, 0, 1, 5, 0, 10, 0, 0];
    const runs = featureRunsOf([3, 3, 8]);
    const keyMap = vertexKeyToRun(src, runs);
    const edges = [10, 0, 0, 1, 5, 0, -99, 0, 0, 0, 0, 0];
    expect(Array.from(mapVertsToRuns(edges, keyMap))).toEqual([1, 0, -1, 0]);
  });

  it("csrFromRunIds buckets vertex indices per run and drops unmatched (−1)", () => {
    const runIds = Int32Array.from([1, 0, -1, 0]);
    const csr = csrFromRunIds(runIds, 2);
    expect(Array.from(csr.offsets)).toEqual([0, 2, 3]);
    // run 0 owns verts 1 and 3; run 1 owns vert 0
    expect(Array.from(csr.verts.slice(csr.offsets[0], csr.offsets[1]))).toEqual([1, 3]);
    expect(Array.from(csr.verts.slice(csr.offsets[1], csr.offsets[2]))).toEqual([0]);
  });

  it("shared corners between adjacent buildings resolve to the FIRST run (never crash)", () => {
    const src = [0, 0, 0, 5, 0, 0, 5, 0, 0, 9, 0, 0]; // vert (5,0,0) appears in BOTH runs
    const runs = featureRunsOf([1, 1, 2, 2]);
    const keyMap = vertexKeyToRun(src, runs);
    expect(keyMap.get("5|0|0")).toBe(0); // first wins
    expect(Array.from(mapVertsToRuns([5, 0, 0], keyMap))).toEqual([0]);
  });
});
