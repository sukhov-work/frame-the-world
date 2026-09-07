/**
 * Dnipro 3D enrichment (Slice 0) — pure geo helpers for MASKING the global Cesium OSM Buildings
 * inside an enriched-city bounding box, and for locating the enriched tileset's re-seat sample.
 * No three, no globe deps → unit-testable. Consumed by scene/buildings.ts (the mask plugin) and
 * scene/enrichedBuildings.ts (the 3rd TilesRenderer + R1 runtime re-seat).
 *
 * Contract source: `.claude/claude-docs/dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md` §Slice 0 +
 * `dnipro-enrichment/DNIPRO_SLICE0_SPIKE.md`. The mask tests each OSM tile's bounding-sphere CENTRE (lat/lon) against
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

/**
 * T77 NEW-3 — `seatStep` WITH A TAIL SNAP, so a seat actually LANDS.
 *
 * An exponential ease never reaches its target, and every seat writer in this app guards its
 * write with a 1 cm "did anything move?" gate. Those two facts multiply: the ease writes only
 * while its own step is ≥ the gate, so it parks the instant the STEP falls below it — at a
 * residual of gate/easeK, which for the enriched seat is 0.01/0.12 = **8.3 cm**. Measured
 * city-wide 2026-09-05 (`rendering/MEASUREMENTS_2026-09-05.md` §9): every settle leg ended at
 * exactly 0.083 m, on every leg, forever. The building is 8 cm off the ground and nothing will
 * ever move it again.
 *
 * The fix is not a smaller gate (that just moves the park point and pays more writes) but the
 * idiom the rest of the repo already uses for the same tail: land exactly once the REMAINING
 * distance is below a snap epsilon — `userModels.ts` (`MODELS.seatSnapM`), `featureTransform
 * .easeXf`, and the U8 height-override tail all end this way. With the snap in place the write
 * gate is redundant AND harmful, so callers drop it and compare against the previous applied
 * value instead: once landed, `seatLand` returns that value unchanged and the write stops of its
 * own accord, which is also what makes "settled" a real state rather than a rounding accident.
 *
 * `snapM` is the residual the seat is allowed to keep, not the step size — at the enriched ease
 * (k 0.12, snap 5 mm) a −31.7 m leg lands exactly in ~69 frames instead of parking at 8.3 cm.
 */
export function seatLand(
  appliedM: number | null,
  targetM: number,
  easeK: number,
  snapM: number,
): number {
  const next = seatStep(appliedM, targetM, easeK);
  return Math.abs(targetM - next) < snapM ? targetM : next;
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

/** Which run owns vertex index `v`? Binary search over the run starts — `featureRunsOf` appends
 *  runs in ascending `start` order by construction, so the array is already sorted. Returns the
 *  run INDEX (the CSR/features-array index, not the baked feature id), or −1 when `v` is outside
 *  every run. This is the U8 pick path: a non-indexed cell mesh gives `hit.face.a` as a direct
 *  vertex index into the shared position/feature-id arrays. */
export function runIndexOfVertex(runs: readonly FeatureRun[], v: number): number {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const run = runs[mid];
    if (v < run.start) hi = mid - 1;
    else if (v >= run.start + run.count) lo = mid + 1;
    else return mid;
  }
  return -1;
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

/** `vertexKeyToRun` plus the COLLISION list: every exact position claimed by ≥ 2 runs (party-wall
 *  corners, shared wall edges) with all its claimants in ascending run order. `map` keeps the
 *  first-wins answer; `collisions` is what lets a SEGMENT be attributed to the right building. */
export function vertexKeyToRunWithCollisions(
  positions: ArrayLike<number>,
  runs: readonly FeatureRun[],
): { map: Map<string, number>; collisions: Map<string, number[]> } {
  const map = new Map<string, number>();
  const collisions = new Map<string, number[]>();
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    for (let i = run.start; i < run.start + run.count; i++) {
      const key = `${positions[i * 3]}|${positions[i * 3 + 1]}|${positions[i * 3 + 2]}`;
      const have = map.get(key);
      if (have === undefined) map.set(key, r);
      else if (have !== r) {
        const list = collisions.get(key);
        if (!list) collisions.set(key, [have, r]);
        else if (list[list.length - 1] !== r) list.push(r); // runs ascend, so a repeat is the tail
      }
    }
  }
  return { map, collisions };
}

/** Per-SEGMENT run attribution for a NON-INDEXED line-segment geometry (`EdgesGeometry` emits two
 *  vertices per segment and shares nothing). A segment belongs to the run that owns BOTH its
 *  endpoints: with plain first-wins per vertex a party-wall corner claimed by building A dragged
 *  B's stroke endpoint along whenever A moved (harmless at the cm scale of a re-seat, a visible
 *  stretch under a MESH SUITE move/rotate). A segment whose both endpoints are shared (the party
 *  wall's own edge) goes to the lowest claimant — deterministic and the same answer first-wins
 *  gave. Unmatched → −1. Output is per VERTEX (both endpoints alike) so `csrFromRunIds` consumes
 *  it unchanged. */
export function mapSegmentsToRuns(
  positions: ArrayLike<number>,
  map: ReadonlyMap<string, number>,
  collisions: ReadonlyMap<string, number[]>,
): Int32Array {
  const n = Math.floor(positions.length / 3);
  const out = new Int32Array(n).fill(-1);
  const keyOf = (i: number) => `${positions[i * 3]}|${positions[i * 3 + 1]}|${positions[i * 3 + 2]}`;
  for (let a = 0; a + 1 < n; a += 2) {
    const b = a + 1;
    const ka = keyOf(a);
    const kb = keyOf(b);
    const ra = map.get(ka) ?? -1;
    const rb = map.get(kb) ?? -1;
    let r = ra;
    if (ra !== rb) {
      const A = collisions.get(ka) ?? (ra >= 0 ? [ra] : []);
      const B = collisions.get(kb) ?? (rb >= 0 ? [rb] : []);
      let common = -1;
      for (const x of A) {
        if (B.includes(x)) {
          common = x;
          break;
        }
      }
      r = common >= 0 ? common : ra >= 0 ? ra : rb;
    }
    out[a] = r;
    out[b] = r;
  }
  return out;
}

/**
 * T106 (2026-09-07d) — the integer twin of `vertexKeyToRunWithCollisions` + `mapSegmentsToRuns`.
 * Those two cost the Pixel 6 Pro 873 ms per descent (MEASUREMENTS §21.3): one template-string
 * key per vertex into a `Map<string, …>`, then the same string again per edge endpoint. The
 * edge builder (`lib/globe/fastEdges`) now reports the SOURCE vertex behind every emitted
 * endpoint, so attribution needs no position key at all on the edge side, and the source side
 * keys EXACT float positions as three ints (the float bits; −0 folded onto 0 the way the
 * decimal string did) through an open-addressed table.
 *
 * SAME ANSWERS BY CONSTRUCTION — the rules are `mapSegmentsToRuns`'s, verbatim: first-wins per
 * exact position in ascending run order; a segment belongs to the run owning BOTH endpoints;
 * a segment with two shared endpoints goes to the lowest common claimant; else the first
 * endpoint's owner, else the second's; unmatched −1. Output per VERTEX, `csrFromRunIds` shape.
 * `test/lib/globe/fastEdges.test.ts` pins equality against the string path on party walls.
 */
export function segmentRunsFromSources(
  srcIndex: ArrayLike<number>,
  positions: ArrayLike<number>,
  runs: readonly FeatureRun[],
): Int32Array {
  const a = createSegmentRunAttributor(srcIndex, positions, runs);
  a.step(Infinity, 1 << 30);
  return a.result();
}

/** T106 slice (b) — the RESUMABLE form of `segmentRunsFromSources` (the deferred `load-model`
 *  queue steps it under a frame deadline; the biggest Dnipro cell's attribution alone was
 *  18 ms on the phone twin). Same algorithm, same answers: `step(deadlineMs, checkEvery)`
 *  works in chunks of `checkEvery` vertices / run-vertices / segments, always completing at
 *  least one chunk per call; `result()` after it returns true. */
export interface SegmentRunAttributor {
  step(deadlineMs: number, checkEvery?: number): boolean;
  result(): Int32Array;
  done(): boolean;
}

/**
 * The attributor's per-vertex tables, REUSABLE across builds (2026-09-07f — the same pool the
 * edge builder has, `fastEdges.createFastEdgesScratch`, for the same reason: a deferred queue
 * steps one unit at a time, and the ~6 MB of fresh typed arrays per cell was GC pressure on
 * the phone). One per queue; the result (`out`) is always a fresh array.
 */
export interface AttributorScratch {
  runOf: Int32Array;
  bx: Int32Array;
  by: Int32Array;
  bz: Int32Array;
  rep: Int32Array;
  uidOf: Int32Array;
  table: Int32Array;
  firstRun: Int32Array;
  reuses: number;
  growths: number;
}

export function createAttributorScratch(): AttributorScratch {
  const z = new Int32Array(0);
  return { runOf: z, bx: z, by: z, bz: z, rep: z, uidOf: z, table: z, firstRun: z, reuses: 0, growths: 0 };
}

function prepareAttributorScratch(sc: AttributorScratch, vertexCount: number, cap: number): void {
  let grew = false;
  if (sc.runOf.length < vertexCount) {
    sc.runOf = new Int32Array(vertexCount);
    sc.bx = new Int32Array(vertexCount);
    sc.by = new Int32Array(vertexCount);
    sc.bz = new Int32Array(vertexCount);
    sc.rep = new Int32Array(vertexCount);
    sc.uidOf = new Int32Array(vertexCount);
    sc.firstRun = new Int32Array(vertexCount); // uidCount ≤ vertexCount
    grew = true;
  }
  if (sc.table.length < cap) {
    sc.table = new Int32Array(cap);
    grew = true;
  }
  sc.runOf.fill(-1, 0, vertexCount);
  sc.table.fill(-1, 0, cap);
  if (grew) sc.growths++;
  else sc.reuses++;
}

export function createSegmentRunAttributor(
  srcIndex: ArrayLike<number>,
  positions: ArrayLike<number>,
  runs: readonly FeatureRun[],
  scratch?: AttributorScratch,
): SegmentRunAttributor {
  const vertexCount = Math.floor(positions.length / 3);
  let cap = 1;
  while (cap < vertexCount * 2) cap <<= 1;
  const mask = cap - 1;
  const sc = scratch ?? createAttributorScratch();
  prepareAttributorScratch(sc, vertexCount, cap);
  // run per source vertex (−1 outside every run) — one fill, at construction
  const runOf = sc.runOf;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const end = Math.min(vertexCount, run.start + run.count);
    for (let i = run.start; i < end; i++) runOf[i] = r;
  }
  // exact-position uid per source vertex
  const f32 = new Float32Array(3);
  const i32 = new Int32Array(f32.buffer);
  const { bx, by, bz, table, rep, uidOf } = sc;
  let uidCount = 0;
  const keyVertices = (from: number, to: number): void => {
    for (let i = from; i < to; i++) {
      f32[0] = positions[i * 3] || 0; // −0 → 0 (the string key read both as "0")
      f32[1] = positions[i * 3 + 1] || 0;
      f32[2] = positions[i * 3 + 2] || 0;
      const x = i32[0];
      const y = i32[1];
      const z = i32[2];
      bx[i] = x;
      by[i] = y;
      bz[i] = z;
      // Mix ALL the bits down before masking: float bit patterns (and round-metre coordinates)
      // have long runs of zero low bits, and a plain multiply-xor leaves them zero — every
      // vertex would land in slot 0 and the probe would go quadratic (measured: 350 ms on a
      // 61k-vertex cell before this mixer, 3 ms after).
      let h = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
      h ^= Math.imul(y ^ (y >>> 13), 0xc2b2ae35);
      h ^= Math.imul(z ^ (z >>> 16), 0x27d4eb2f);
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d);
      h ^= h >>> 12;
      h &= mask;
      for (;;) {
        const u = table[h];
        if (u < 0) {
          table[h] = uidCount;
          rep[uidCount] = i;
          uidOf[i] = uidCount++;
          break;
        }
        const rr = rep[u];
        if (bx[rr] === x && by[rr] === y && bz[rr] === z) {
          uidOf[i] = u;
          break;
        }
        h = (h + 1) & mask;
      }
    }
  };
  // first-wins owner per uid (runs ascend, vertices ascend ⇒ the first claimant is the lowest
  // run) and the collision lists for uids claimed by ≥ 2 runs. Sized once the uids are known.
  let firstRun: Int32Array | null = null;
  const claimants = new Map<number, number[]>();
  const claimRuns = (from: number, to: number): void => {
    const fr = firstRun as Int32Array;
    for (let r = from; r < to; r++) {
      const run = runs[r];
      const end = Math.min(vertexCount, run.start + run.count);
      for (let i = run.start; i < end; i++) {
        const u = uidOf[i];
        const have = fr[u];
        if (have < 0) fr[u] = r;
        else if (have !== r) {
          const list = claimants.get(u);
          if (!list) claimants.set(u, [have, r]);
          else if (list[list.length - 1] !== r) list.push(r);
        }
      }
    }
  };
  const n = srcIndex.length;
  const out = new Int32Array(n).fill(-1);
  const attribute = (from: number, to: number): void => {
    const fr = firstRun as Int32Array;
    for (let a = from; a + 1 < to; a += 2) {
      const b = a + 1;
      const ua = uidOf[srcIndex[a]];
      const ub = uidOf[srcIndex[b]];
      const ra = fr[ua];
      const rb = fr[ub];
      let r = ra;
      if (ra !== rb) {
        const A = claimants.get(ua) ?? (ra >= 0 ? [ra] : []);
        const B = claimants.get(ub) ?? (rb >= 0 ? [rb] : []);
        let common = -1;
        for (const x of A) {
          if (B.includes(x)) {
            common = x;
            break;
          }
        }
        r = common >= 0 ? common : ra >= 0 ? ra : rb;
      }
      out[a] = r;
      out[b] = r;
    }
  };
  // stage 0 = keying vertices · 1 = claiming runs · 2 = attributing segments · 3 = done
  let stage = 0;
  let vCursor = 0;
  let rCursor = 0;
  let sCursor = 0; // segment START vertex (even)
  return {
    step(deadlineMs, checkEvery = 1024) {
      const chunk = Math.max(1, Math.floor(checkEvery));
      if (stage === 0) {
        for (;;) {
          const to = Math.min(vertexCount, vCursor + chunk);
          keyVertices(vCursor, to);
          vCursor = to;
          if (vCursor >= vertexCount) {
            firstRun = sc.firstRun.fill(-1, 0, uidCount);
            stage = 1;
            break;
          }
          if (performance.now() >= deadlineMs) return false;
        }
        if (performance.now() >= deadlineMs) return false;
      }
      if (stage === 1) {
        for (;;) {
          // a chunk = runs holding ~`chunk` vertices (a run is a building — tens to hundreds)
          let to = rCursor;
          let vs = 0;
          while (to < runs.length && vs < chunk) vs += runs[to++].count;
          claimRuns(rCursor, to);
          rCursor = to;
          if (rCursor >= runs.length) {
            stage = 2;
            break;
          }
          if (performance.now() >= deadlineMs) return false;
        }
        if (performance.now() >= deadlineMs) return false;
      }
      if (stage === 2) {
        for (;;) {
          const to = Math.min(n, sCursor + chunk * 2);
          attribute(sCursor, to);
          sCursor = to;
          if (sCursor >= n) {
            stage = 3;
            break;
          }
          if (performance.now() >= deadlineMs) return false;
        }
      }
      return stage === 3;
    },
    result() {
      if (stage !== 3) throw new Error("enrichedMask: result() before the attribution finished");
      return out;
    },
    done: () => stage === 3,
  };
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
