import { describe, expect, it } from "vitest";
import { createProfile, sampleProfile, type SilhouetteFrame } from "../../../src/lib/geo/horizonProfile";
import { sweepMeshEdges, sweepTreeInstances } from "../../../src/lib/geo/occlusion";
import { bboxClipPrismEcef } from "../../../src/lib/globe/enrichedMask";
import { add, enuBasis, geodeticToEcef, scale, type Vec3 } from "../../../src/lib/geo/projection";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Eye on the ground at the equator/prime meridian; ENU is hand-checkable there. */
const ORIGIN = geodeticToEcef(0, 0, 0);
const BASIS = enuBasis(0, 0);
const FRAME: SilhouetteFrame = {
  originEcef: ORIGIN,
  east: BASIS.east,
  north: BASIS.north,
  up: BASIS.up,
  refractionK: 0.13,
};

/** ECEF point at (eastM, northM, upM) from the eye. */
function enuPoint(eastM: number, northM: number, upM: number): Vec3 {
  return add(
    add(add(ORIGIN, scale(BASIS.east, eastM)), scale(BASIS.north, northM)),
    scale(BASIS.up, upM),
  );
}

/** A vertical wall quad (two triangles) facing the eye: north `dM`, spanning ±`halfW` east,
 *  0..`hM` up — positions are already ECEF, so matrixWorld = identity. */
function wallMesh(dM: number, halfW: number, hM: number) {
  const bl = enuPoint(-halfW, dM, 0);
  const br = enuPoint(halfW, dM, 0);
  const tr = enuPoint(halfW, dM, hM);
  const tl = enuPoint(-halfW, dM, hM);
  const positions = new Float32Array([...bl, ...br, ...tr, ...tl]);
  const index = [0, 1, 2, 0, 2, 3];
  return { positions, index };
}

describe("sweepMeshEdges — building silhouettes into azimuth bins", () => {
  it("a 30 m wall 100 m north raises the north bin to atan(30/100) ≈ 16.7°", () => {
    const p = createProfile(120, -0.1);
    const { positions, index } = wallMesh(100, 20, 30);
    const n = sweepMeshEdges(p, FRAME, positions, index, IDENTITY, { trustRadiusM: 3000 });
    expect(n).toBeGreaterThan(0);
    expect(sampleProfile(p, 0)).toBeGreaterThan(16.2);
    expect(sampleProfile(p, 0)).toBeLessThan(17.2);
    expect(sampleProfile(p, 90)).toBeCloseTo(-0.1, 6); // east untouched
  });

  it("subdivision fills bins BETWEEN corners of a long near wall (street-canyon case)", () => {
    const p = createProfile(120, -0.1);
    // spans az ±45°: corners at 141 m but the wall passes 100 m away at az 15°
    const { positions, index } = wallMesh(100, 100, 30);
    sweepMeshEdges(p, FRAME, positions, index, IDENTITY, { trustRadiusM: 3000 });
    // top edge at az 15°: dist = 100/cos(15°) ≈ 103.5 → atan(30/103.5) ≈ 16.2°.
    // Corner-only sampling would leave this bin near the floor.
    expect(sampleProfile(p, 15)).toBeGreaterThan(14);
  });

  it("geometry beyond the trust radius contributes nothing", () => {
    const p = createProfile(120, -0.1);
    const { positions, index } = wallMesh(5000, 20, 300);
    const n = sweepMeshEdges(p, FRAME, positions, index, IDENTITY, { trustRadiusM: 3000 });
    expect(n).toBe(0);
    expect(sampleProfile(p, 0)).toBeCloseTo(-0.1, 6);
  });

  it("non-indexed (soup) geometry works via consecutive triples", () => {
    const p = createProfile(120, -0.1);
    const { positions, index } = wallMesh(100, 20, 30);
    const soup = new Float32Array(index.length * 3);
    index.forEach((vi, i) => soup.set(positions.slice(vi * 3, vi * 3 + 3), i * 3));
    sweepMeshEdges(p, FRAME, soup, null, IDENTITY, { trustRadiusM: 3000 });
    expect(sampleProfile(p, 0)).toBeGreaterThan(16.2);
  });

  it("vertices inside the mask prism are rejected (clipped-away OSM must not occlude)", () => {
    const p = createProfile(120, -0.1);
    const { positions, index } = wallMesh(100, 20, 30); // ~100 m north ≈ lat +0.0009°
    const planes = bboxClipPrismEcef({ west: -0.01, south: -0.01, east: 0.01, north: 0.01 });
    const n = sweepMeshEdges(p, FRAME, positions, index, IDENTITY, {
      trustRadiusM: 3000,
      rejectPlanes: planes,
    });
    expect(n).toBe(0);
    expect(sampleProfile(p, 0)).toBeCloseTo(-0.1, 6);
  });

  it("a mesh OUTSIDE the mask prism still sweeps normally", () => {
    const p = createProfile(120, -0.1);
    const { positions, index } = wallMesh(100, 20, 30);
    const planes = bboxClipPrismEcef({ west: 1, south: 1, east: 1.02, north: 1.02 });
    sweepMeshEdges(p, FRAME, positions, index, IDENTITY, {
      trustRadiusM: 3000,
      rejectPlanes: planes,
    });
    expect(sampleProfile(p, 0)).toBeGreaterThan(16.2);
  });
});

describe("sweepTreeInstances — canopy spheres from the instanced TRS", () => {
  /** Cell frame per the slice-3 bake: local X=east, Y=up, Z=−north, translation = eye origin. */
  const CELL_WORLD = [
    BASIS.east[0], BASIS.east[1], BASIS.east[2], 0,
    BASIS.up[0], BASIS.up[1], BASIS.up[2], 0,
    -BASIS.north[0], -BASIS.north[1], -BASIS.north[2], 0,
    ORIGIN[0], ORIGIN[1], ORIGIN[2], 1,
  ];

  /** Instance TRS: scale (radius/0.5, height, radius/0.5), translation local (x, 0, z). */
  function treeInstance(xLocal: number, zLocal: number, heightM: number, radiusM: number) {
    const s = radiusM / 0.5;
    // column-major TRS with yaw=0
    return [s, 0, 0, 0, 0, heightM, 0, 0, 0, 0, s, 0, xLocal, 0, zLocal, 1];
  }

  it("a 10 m tree 50 m north raises the north bin to canopy-top ≈ 11.4°", () => {
    const p = createProfile(120, -0.1);
    const m = new Float32Array(treeInstance(0, -50, 10, 3)); // z=−50 → north 50 m
    const n = sweepTreeInstances(p, FRAME, m, 1, CELL_WORLD, { trustRadiusM: 3000 });
    expect(n).toBe(1);
    // canopy centre 6.1 m up at 50 m → alt ≈ 6.96°; sphere r = max(3, 3.9) → +asin(3.9/50.4) ≈ 4.4°
    expect(sampleProfile(p, 0)).toBeGreaterThan(10);
    expect(sampleProfile(p, 0)).toBeLessThan(13);
    expect(sampleProfile(p, 180)).toBeCloseTo(-0.1, 6); // south untouched
  });

  it("a canopy grazing the eye clamps at the zenith (never >90° — the park-anchor bug)", () => {
    const p = createProfile(120, -0.1);
    // 10 m tree 4 m north: canopy sphere r = 3.9 m, centre 6.1 m up at ~7.3 m → asin ≈ 32°+
    // centre alt ≈ 57° stays under 90; push harder with a big low canopy 4.2 m away.
    const m = new Float32Array(treeInstance(0, -4.2, 12, 5));
    const n = sweepTreeInstances(p, FRAME, m, 1, CELL_WORLD, { trustRadiusM: 3000 });
    expect(n).toBe(1);
    let mx = -99;
    for (let az = 0; az < 360; az += 1) mx = Math.max(mx, sampleProfile(p, az));
    expect(mx).toBeLessThan(90); // clamped at 89.9 (f32 bin storage rounds the tail)
    expect(mx).toBeGreaterThan(45); // still reads as a dominating overhead canopy
  });

  it("trees beyond the trust radius are skipped", () => {
    const p = createProfile(120, -0.1);
    const m = new Float32Array(treeInstance(0, -5000, 10, 3));
    const n = sweepTreeInstances(p, FRAME, m, 1, CELL_WORLD, { trustRadiusM: 3000 });
    expect(n).toBe(0);
  });

  it("multiple instances read from their 16-float strides", () => {
    const p = createProfile(120, -0.1);
    const m = new Float32Array([
      ...treeInstance(0, -50, 10, 3), // north
      ...treeInstance(50, 0, 20, 4), // east, taller
    ]);
    const n = sweepTreeInstances(p, FRAME, m, 2, CELL_WORLD, { trustRadiusM: 3000 });
    expect(n).toBe(2);
    expect(sampleProfile(p, 0)).toBeGreaterThan(10);
    // east tree: canopy centre 12.2 m at 50 m → ≈13.7°; r = max(4, 7.8) → +asin(7.8/51.5) ≈ 8.7°
    expect(sampleProfile(p, 90)).toBeGreaterThan(18);
  });
});
