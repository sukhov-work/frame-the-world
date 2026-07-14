/**
 * Dnipro 3D enrichment (Slice 0) — pure geo helpers for MASKING the global Cesium OSM Buildings
 * inside an enriched-city bounding box, and for locating the enriched tileset's re-seat sample.
 * No three, no globe deps → unit-testable. Consumed by scene/buildings.ts (the mask plugin) and
 * scene/enrichedBuildings.ts (the 3rd TilesRenderer + R1 runtime re-seat).
 *
 * Contract source: `.claude/claude-docs/DNIPRO_3D_ENRICHMENT_PLAN.md` §Slice 0 +
 * `DNIPRO_SLICE0_SPIKE.md`. The mask tests each OSM tile's bounding-sphere CENTRE (lat/lon) against
 * the bbox — coordinates the library returns from `TilesRenderer.ellipsoid.getPositionToCartographic`
 * in RADIANS, so the hot path works in radians (bboxContainsRad); degree helpers are for tests/wiring.
 */

import { dot, enuBasis, geodeticToEcef, type Vec3 } from "../geo/projection";

/** A lon/lat bounding box in DEGREES (west/south/east/north). Small city extents only — NO
 *  antimeridian crossing (Dnipro is nowhere near ±180°); callers assume west < east, south < north. */
export interface GeoBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The same box pre-converted to RADIANS (built once at wire time, read every frame in the mask). */
export interface GeoBboxRad {
  west: number;
  south: number;
  east: number;
  north: number;
}

const DEG = Math.PI / 180;

export function bboxToRadians(b: GeoBbox): GeoBboxRad {
  return { west: b.west * DEG, south: b.south * DEG, east: b.east * DEG, north: b.north * DEG };
}

/** Centre of the bbox in DEGREES — the point where scene/enrichedBuildings samples the rendered
 *  Cesium World Terrain to seat the tileset (R1). */
export function bboxCenterDeg(b: GeoBbox): { latDeg: number; lonDeg: number } {
  return { latDeg: (b.south + b.north) / 2, lonDeg: (b.west + b.east) / 2 };
}

/** Is a lon/lat (RADIANS) inside the bbox (radians)? Inclusive edges — the hot-path predicate the
 *  OSM-buildings mask plugin evaluates per tile. */
export function bboxContainsRad(b: GeoBboxRad, lonRad: number, latRad: number): boolean {
  return lonRad >= b.west && lonRad <= b.east && latRad >= b.south && latRad <= b.north;
}

/** Degree-space containment (tests / cold paths). */
export function bboxContainsDeg(b: GeoBbox, lonDeg: number, latDeg: number): boolean {
  return lonDeg >= b.west && lonDeg <= b.east && latDeg >= b.south && latDeg <= b.north;
}

/** Centre (deg) of a 3D-Tiles geographic region bounding volume `[west, south, east, north,
 *  minH, maxH]` (angles in RADIANS — the raw `tile.boundingVolume.region` the baker writes per
 *  grid cell). This is each cell's OWN terrain-sample point for the Slice-2 per-cell re-seat. */
export function regionCenterDeg(region: readonly number[]): { latDeg: number; lonDeg: number } {
  const RAD = 180 / Math.PI;
  return {
    latDeg: ((region[1] + region[3]) / 2) * RAD,
    lonDeg: ((region[0] + region[2]) / 2) * RAD,
  };
}

/** One frame of the per-cell seat easing: the FIRST real terrain sample snaps (the cell is still
 *  streaming in — a one-time settle, exactly how the whole-group seat lands), every later change
 *  eases exponentially (`easeK` per frame) so terrain-LOD refinements slide instead of popping. */
export function seatStep(appliedM: number | null, targetM: number, easeK: number): number {
  if (appliedM == null) return targetM;
  return appliedM + (targetM - appliedM) * easeK;
}

/** An ECEF plane for three's `Material.clippingPlanes`: signed distance d(p) = normal·p + constant.
 *  three clips fragments with d < 0 (with `clipIntersection` only where ALL planes agree). */
export interface EcefPlane {
  /** Unit normal, ECEF. */
  normal: Vec3;
  constant: number;
}

/**
 * The Slice-2 CLIPPING-PLANE HOLE (the pixel-exact fix for the confirmed coarse-tile straddle-leak):
 * 4 ECEF planes forming an infinite vertical prism over the bbox, built so the signed distance is
 * NEGATIVE inside the box for every plane. Put on the shared OSM building material with
 * `clipIntersection = true`, three then discards ONLY fragments inside all four (the bbox interior —
 * where the enriched tileset owns the buildings), regardless of which ancestor tile they arrived in.
 *
 * Geometry: the E/W walls are EXACT (a constant-longitude surface is a true plane through the Earth
 * axis; normal = ±the local east direction, through the origin). The N/S walls are the tangent planes
 * to the constant-latitude cone at the bbox's centre longitude — over a city-scale box (~7 km) the
 * planar approximation deviates from the true parallel by ~(halfWidth)²/(2·R·cosφ) ≈ 2 m at the
 * corners, well under the building-footprint granularity of the mask/bake boundary itself. Height is
 * NOT bounded (buildings only exist near the ground) — and because geodetic north ⊥ up, the N/S walls
 * are exact along altitude too.
 */
export function bboxClipPrismEcef(b: GeoBbox): EcefPlane[] {
  const lonC = (b.west + b.east) / 2;
  const eastAtW = enuBasis(0, b.west).east; // east is lat-independent: (−sinλ, cosλ, 0)
  const eastAtE = enuBasis(0, b.east).east;
  const northAtS = enuBasis(b.south, lonC).north;
  const northAtN = enuBasis(b.north, lonC).north;
  const pS = geodeticToEcef(b.south, lonC, 0);
  const pN = geodeticToEcef(b.north, lonC, 0);
  return [
    // West wall: inside (east of the west meridian) → d = −east·p < 0.
    { normal: [-eastAtW[0], -eastAtW[1], -eastAtW[2]], constant: 0 },
    // East wall: inside (west of the east meridian) → d = east·p < 0.
    { normal: eastAtE, constant: 0 },
    // South wall: inside (north of the south edge) → d = −north·p + north·pS < 0.
    { normal: [-northAtS[0], -northAtS[1], -northAtS[2]], constant: dot(northAtS, pS) },
    // North wall: inside (south of the north edge) → d = north·p − north·pN < 0.
    { normal: northAtN, constant: -dot(northAtN, pN) },
  ];
}

/** Signed distance of an ECEF point to an `EcefPlane` (test/diagnostic helper — the hot path is
 *  three's own shader clipping). */
export function planeDistance(plane: EcefPlane, p: Vec3): number {
  return dot(plane.normal, p) + plane.constant;
}

/* ── Per-FEATURE re-seat helpers (owner 2026-07-14: buildings sink/levitate on within-cell
 *    relief). The baker emits each building as ONE contiguous vertex run of non-indexed
 *    triangles sharing a constant `_FEATURE_ID_0`, so a cell's geometry decomposes into runs
 *    that can be lifted independently by writing the position attribute on the CPU — which
 *    keeps the occlusion sweeps (lib/geo/occlusion.ts reads the same arrays), shadows and
 *    controls picks automatically consistent. Pure array math only — three-free, unit-tested. */

/** One building's contiguous vertex run inside a cell geometry. */
export interface FeatureRun {
  /** The baked feature id (GLOBAL across the bake — never assume 0..N-1 per cell). */
  id: number;
  /** First vertex index of the run. */
  start: number;
  /** Vertex count of the run. */
  count: number;
}

/** Scan a per-vertex feature-id attribute into contiguous runs. The baker emits each building
 *  in one pass, so equal-id runs ARE buildings; a re-appearing id would simply yield a second
 *  (still independently correct) run. */
export function featureRunsOf(ids: ArrayLike<number>): FeatureRun[] {
  const runs: FeatureRun[] = [];
  if (ids.length === 0) return runs;
  let start = 0;
  let id = ids[0];
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] !== id) {
      runs.push({ id, start, count: i - start });
      start = i;
      id = ids[i];
    }
  }
  runs.push({ id, start, count: ids.length - start });
  return runs;
}

/** Mean of a run's vertices (stride-3 positions) — the terrain-sample point for that building
 *  (horizontal centre; roof verts bias x/z negligibly for prism-like buildings). */
export function runCentroid(
  positions: ArrayLike<number>,
  run: FeatureRun,
): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = run.start; i < run.start + run.count; i++) {
    x += positions[i * 3];
    y += positions[i * 3 + 1];
    z += positions[i * 3 + 2];
  }
  const n = Math.max(1, run.count);
  return [x / n, y / n, z / n];
}

/** Exact-position key → run index, built from the PRISTINE source positions (before any
 *  mutation). `EdgesGeometry` copies source floats verbatim, so an exact-key lookup maps every
 *  edge vertex back to its building. Shared corners between adjacent buildings can collide —
 *  first run wins; neighbours seat within centimetres of each other so the error is invisible. */
export function vertexKeyToRun(
  positions: ArrayLike<number>,
  runs: readonly FeatureRun[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    for (let i = run.start; i < run.start + run.count; i++) {
      const key = `${positions[i * 3]}|${positions[i * 3 + 1]}|${positions[i * 3 + 2]}`;
      if (!map.has(key)) map.set(key, r);
    }
  }
  return map;
}

/** Map derived-geometry vertices (edge strokes) to run indices via the exact-key map;
 *  unmatched → −1 (left untouched by the re-seat — safe). */
export function mapVertsToRuns(
  positions: ArrayLike<number>,
  keyToRun: ReadonlyMap<string, number>,
): Int32Array {
  const n = Math.floor(positions.length / 3);
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${positions[i * 3]}|${positions[i * 3 + 1]}|${positions[i * 3 + 2]}`;
    out[i] = keyToRun.get(key) ?? -1;
  }
  return out;
}

/** CSR buckets: vertex indices grouped by run id (−1 entries dropped) — the per-building
 *  apply loop touches ONLY its own edge verts instead of rescanning the whole array. */
export function csrFromRunIds(
  runIds: ArrayLike<number>,
  runCount: number,
): { offsets: Int32Array; verts: Int32Array } {
  const counts = new Int32Array(runCount);
  let kept = 0;
  for (let i = 0; i < runIds.length; i++) {
    const r = runIds[i];
    if (r >= 0 && r < runCount) {
      counts[r]++;
      kept++;
    }
  }
  const offsets = new Int32Array(runCount + 1);
  for (let r = 0; r < runCount; r++) offsets[r + 1] = offsets[r] + counts[r];
  const verts = new Int32Array(kept);
  const cursor = offsets.slice(0, runCount);
  for (let i = 0; i < runIds.length; i++) {
    const r = runIds[i];
    if (r >= 0 && r < runCount) verts[cursor[r]++] = i;
  }
  return { offsets, verts };
}
