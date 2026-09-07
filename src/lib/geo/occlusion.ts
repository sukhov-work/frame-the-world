/**
 * Obstruction sweeps (Pass 3 WS4-A/B structural + Dnipro enrichment Slice 5).
 *
 * Folds the streamed city geometry — OSM building tiles, enriched Dnipro buildings, and the
 * slice-3 instanced trees — into a `HorizonProfile` as per-azimuth-bin max elevations. This is
 * deliberately NOT a three.Raycaster design:
 *   · trees carry `raycast = () => {}` (the slice-3 per-instance pick-cost trap) — we read the
 *     `instanceMatrix` TRS directly instead and treat each canopy as an analytic sphere;
 *   · the OSM mask inside the enriched bbox is FRAGMENT-level clipping — a CPU ray would hit
 *     masked-away geometry; here masked vertices are rejected against the same
 *     `bboxClipPrismEcef` planes the shader clips with;
 *   · a per-bin ray fan can miss thin/high features between rays — walking every triangle EDGE
 *     with azimuth-adaptive subdivision samples the actual silhouette.
 *
 * Pure and three-free: callers pass raw position/index arrays + column-major world matrices
 * (`mesh.geometry.attributes.position.array`, `mesh.matrixWorld.elements`), so everything here
 * is unit-testable in vitest without WebGL. The scene traversal + time slicing live in
 * `scene/planFeed.ts`.
 *
 * KNOWN LIMIT (recorded, acceptable v1): edges-only sweeping can under-report a max that lies
 * strictly inside a large tilted face; building geometry is extruded prisms + gable/pyramid
 * roofs whose silhouettes are edges, so the gap is theoretical at bin width ≥ ~3° and stays
 * small at the T110 fine widths (a roof's crest is still an edge).
 *
 * T110 (2026-09-07d): the edge walk projects each vertex ONCE (a module-level cache), fills
 * the bins between consecutive samples (`raiseSpan`), scales the subdivision cap with the bin
 * count, and can be resumed under a time budget (`sweepMeshEdgesSliced`) — the fine bin width
 * multiplies near-edge samples, so the build is bounded by milliseconds, not by mesh count.
 */

import { planeDistance, type EcefPlane } from "../globe/enrichedMask";
import {
  raiseBin,
  azAltOfEcef,
  azAltOfRelInto,
  type AzAltScratch,
  type HorizonProfile,
  type SilhouetteFrame,
} from "./horizonProfile";

/** Guards a single edge's subdivision count (an edge brushing the eye would otherwise ask for
 *  thousands of samples). Calibrated at 64 for 3° bins — the residual azimuth step is ≤
 *  edge-length/64; T110 scales it with the bin count (384 at 0.5°, 768 at 0.25°) so a near
 *  wall keeps one sample per bin, and `raiseSpan` closes whatever the cap still leaves. */
const MAX_EDGE_SUBDIV_AT_120 = 64;
/** `raiseSpan` fills the bins between two consecutive edge samples only across a gap this
 *  small — a wider jump is an edge crossing the zenith (the eye is under it), where the short
 *  azimuth arc is not the silhouette's path. */
const SPAN_FILL_MAX_DEG = 45;
/** How often the sliced sweep consults the clock (triangles) — `performance.now()` per
 *  triangle would cost more than the triangle. */
const DEADLINE_CHECK_TRIS = 64;

export interface SweepOptions {
  /** Ignore geometry farther than this from the eye (the 2–4 km trust radius). */
  trustRadiusM: number;
  /** Reject vertices inside this prism (the OSM-mask interior where enriched owns buildings). */
  rejectPlanes?: readonly EcefPlane[] | null;
}

/** T110 — the resumable form's extra inputs (`sweepMeshEdgesSliced`). */
export interface SlicedSweepOptions extends SweepOptions {
  /** First triangle to walk (0 = start; resume with the previous call's `nextTri`). */
  startTri: number;
  /** `performance.now()` value after which the walk yields (checked every few hundred
   *  triangles). `Infinity` = walk to the end. */
  deadlineMs: number;
}

export interface SlicedSweepResult {
  /** Edge samples folded in by THIS call. */
  samples: number;
  /** The triangle to resume at; `=== triCount` when the mesh is done. */
  nextTri: number;
  /** Triangles in the mesh (so a caller can show progress without re-deriving it). */
  triCount: number;
}

function insidePrism(planes: readonly EcefPlane[], x: number, y: number, z: number): boolean {
  for (const pl of planes) {
    if (planeDistance(pl, [x, y, z]) >= 0) return false;
  }
  return true;
}

/** Apply a column-major 4×4 (three `Matrix4.elements`) to a point. */
function applyMat4(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  out: [number, number, number],
): void {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

/**
 * T110 — the per-vertex cache. A vertex of an indexed tile mesh sits on ~6 edges; the old
 * walk transformed and projected it once per edge END (up to 12 `azAltOfEcef` per vertex).
 * Here every vertex is projected ONCE, lazily, into module-level scratch (eye-relative ECEF
 * deltas in float32 — ≤ 3 km from the eye that is sub-millimetre — plus az/alt/dist and the
 * prism verdict). The scratch is keyed on (positions, matrixWorld, frame) and survives across
 * a sliced walk of the same mesh; any other mesh re-keys it.
 */
interface VertexCache {
  key: { positions: ArrayLike<number>; matrixWorld: ArrayLike<number>; frame: SilhouetteFrame } | null;
  rel: Float32Array; // 3 per vertex — eye-relative ECEF
  az: Float32Array;
  alt: Float32Array;
  dist: Float32Array;
  /** 0 = not projected yet · 1 = projected. */
  done: Uint8Array;
  /** 0 = unknown · 1 = inside the prism · 2 = outside. */
  prism: Uint8Array;
}
const cache: VertexCache = {
  key: null,
  rel: new Float32Array(0),
  az: new Float32Array(0),
  alt: new Float32Array(0),
  dist: new Float32Array(0),
  done: new Uint8Array(0),
  prism: new Uint8Array(0),
};

function ensureCache(
  positions: ArrayLike<number>,
  matrixWorld: ArrayLike<number>,
  frame: SilhouetteFrame,
  resume: boolean,
): void {
  const n = Math.floor(positions.length / 3);
  const k = cache.key;
  if (
    resume &&
    k &&
    k.positions === positions &&
    k.matrixWorld === matrixWorld &&
    k.frame === frame &&
    cache.done.length >= n
  )
    return;
  if (cache.done.length < n) {
    cache.rel = new Float32Array(n * 3);
    cache.az = new Float32Array(n);
    cache.alt = new Float32Array(n);
    cache.dist = new Float32Array(n);
    cache.done = new Uint8Array(n);
    cache.prism = new Uint8Array(n);
  } else {
    cache.done.fill(0, 0, n);
    cache.prism.fill(0, 0, n);
  }
  cache.key = { positions, matrixWorld, frame };
}

const _w: [number, number, number] = [0, 0, 0];
const _pt: AzAltScratch = { azDeg: 0, altDeg: 0, distM: 0 };

/** Project vertex `vi` into the cache (once). */
function projectVertex(
  vi: number,
  positions: ArrayLike<number>,
  matrixWorld: ArrayLike<number>,
  frame: SilhouetteFrame,
): void {
  if (cache.done[vi]) return;
  applyMat4(matrixWorld, positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2], _w);
  const dx = _w[0] - frame.originEcef[0];
  const dy = _w[1] - frame.originEcef[1];
  const dz = _w[2] - frame.originEcef[2];
  cache.rel[vi * 3] = dx;
  cache.rel[vi * 3 + 1] = dy;
  cache.rel[vi * 3 + 2] = dz;
  azAltOfRelInto(frame, dx, dy, dz, _pt);
  cache.az[vi] = _pt.azDeg;
  cache.alt[vi] = _pt.altDeg;
  cache.dist[vi] = _pt.distM;
  cache.done[vi] = 1;
}

/** The cached prism verdict for vertex `vi` (absolute ECEF is re-derived from the delta). */
function vertexInPrism(vi: number, planes: readonly EcefPlane[], frame: SilhouetteFrame): boolean {
  const c = cache.prism[vi];
  if (c) return c === 1;
  const inside = insidePrism(
    planes,
    cache.rel[vi * 3] + frame.originEcef[0],
    cache.rel[vi * 3 + 1] + frame.originEcef[1],
    cache.rel[vi * 3 + 2] + frame.originEcef[2],
  );
  cache.prism[vi] = inside ? 1 : 2;
  return inside;
}

/** Raise every bin strictly between two consecutive edge samples with the linearly
 *  interpolated elevation (shortest azimuth arc) — closes the holes a capped subdivision
 *  leaves at a fine bin width. Endpoints are raised by the caller. */
function raiseSpan(
  profile: HorizonProfile,
  az0: number,
  alt0: number,
  az1: number,
  alt1: number,
): void {
  let d = az1 - az0;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  const ad = Math.abs(d);
  const binWidthDeg = 360 / profile.binCount;
  if (ad <= binWidthDeg || ad > SPAN_FILL_MAX_DEG) return;
  const steps = Math.ceil(ad / binWidthDeg);
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    raiseBin(profile, az0 + d * t, alt0 + (alt1 - alt0) * t);
  }
}

/**
 * Sweep every triangle edge of a mesh into the profile. `positions` are LOCAL vertex positions;
 * `matrixWorld` places them in ECEF. Non-indexed geometry passes `index = null` (consecutive
 * vertex triples). Returns the number of edge samples folded in (0 ⇒ mesh fully out of range —
 * lets the caller's time-slicer account progress honestly).
 *
 * Subdivision: each edge is sampled every ≤ one bin-width of azimuth arc at its nearest
 * endpoint distance, so a long roof line passing close to the eye cannot dip between bins
 * (linear interpolation between endpoint elevations badly under-reports a near wall — the
 * street-canyon case this exists for).
 */
export function sweepMeshEdges(
  profile: HorizonProfile,
  frame: SilhouetteFrame,
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  matrixWorld: ArrayLike<number>,
  opts: SweepOptions,
): number {
  return sweepMeshEdgesSliced(profile, frame, positions, index, matrixWorld, {
    ...opts,
    startTri: 0,
    deadlineMs: Infinity,
  }).samples;
}

/**
 * T110 — the resumable, deadline-bounded form of `sweepMeshEdges`. Walks triangles from
 * `opts.startTri` until the mesh ends or `performance.now()` passes `opts.deadlineMs`, and
 * reports where to resume; the per-vertex cache carries across the resumed calls of one mesh.
 * A fine bin width multiplies the near-edge samples (0.25° = 12× the 3° count) — bounding the
 * walk by TIME instead of by mesh count is what keeps a phone's frame flat while the build
 * simply takes more frames (the carry policy keeps the previous profile published meanwhile).
 */
export function sweepMeshEdgesSliced(
  profile: HorizonProfile,
  frame: SilhouetteFrame,
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  matrixWorld: ArrayLike<number>,
  opts: SlicedSweepOptions,
): SlicedSweepResult {
  const triCount = Math.floor((index ? index.length : positions.length / 3) / 3);
  const binWidthRad = (2 * Math.PI) / profile.binCount;
  const maxSubdiv = Math.max(
    MAX_EDGE_SUBDIV_AT_120,
    Math.ceil((MAX_EDGE_SUBDIV_AT_120 * profile.binCount) / 120),
  );
  const reject = opts.rejectPlanes && opts.rejectPlanes.length ? opts.rejectPlanes : null;
  const trust = opts.trustRadiusM;
  const deadline = opts.deadlineMs;
  const timed = Number.isFinite(deadline);
  let samples = 0;

  ensureCache(positions, matrixWorld, frame, opts.startTri > 0);
  const rel = cache.rel;

  let t = Math.max(0, opts.startTri);
  for (; t < triCount; t++) {
    if (timed && t % DEADLINE_CHECK_TRIS === 0 && t > opts.startTri && performance.now() > deadline)
      break;
    for (let e = 0; e < 3; e++) {
      const i0 = index ? index[t * 3 + e] : t * 3 + e;
      const i1 = index ? index[t * 3 + ((e + 1) % 3)] : t * 3 + ((e + 1) % 3);
      projectVertex(i0, positions, matrixWorld, frame);
      projectVertex(i1, positions, matrixWorld, frame);
      const da = cache.dist[i0];
      const db = cache.dist[i1];
      if (da > trust && db > trust) continue;
      // Boundary bias: an edge with EITHER endpoint inside the masked prism is dropped whole —
      // the enriched tileset owns that interior; under-counting a boundary sliver beats double
      // skylines from clipped-away OSM mass.
      if (reject && (vertexInPrism(i0, reject, frame) || vertexInPrism(i1, reject, frame))) continue;

      const ax = rel[i0 * 3];
      const ay = rel[i0 * 3 + 1];
      const az = rel[i0 * 3 + 2];
      const ex = rel[i1 * 3] - ax;
      const ey = rel[i1 * 3 + 1] - ay;
      const ez = rel[i1 * 3 + 2] - az;
      const edgeLenM = Math.hypot(ex, ey, ez);
      // Subdivision density is set by the segment's CLOSEST approach to the eye, not its
      // endpoints — a long wall passing near the eye has far corners but a near midsection,
      // and endpoint-based steps skip bins exactly there (the case the canyon test pins).
      const tClosest =
        edgeLenM > 0
          ? Math.min(1, Math.max(0, -(ax * ex + ay * ey + az * ez) / (edgeLenM * edgeLenM)))
          : 0;
      const nearDistM = Math.max(
        1,
        Math.hypot(ax + ex * tClosest, ay + ey * tClosest, az + ez * tClosest),
      );
      const steps = Math.min(maxSubdiv, Math.max(1, Math.ceil(edgeLenM / (nearDistM * binWidthRad))));
      let prevAz = 0;
      let prevAlt = 0;
      let havePrev = false;
      for (let s = 0; s <= steps; s++) {
        let pAz: number;
        let pAlt: number;
        let pDist: number;
        if (s === 0) {
          pAz = cache.az[i0];
          pAlt = cache.alt[i0];
          pDist = da;
        } else if (s === steps) {
          pAz = cache.az[i1];
          pAlt = cache.alt[i1];
          pDist = db;
        } else {
          const k = s / steps;
          const x = ax + ex * k;
          const y = ay + ey * k;
          const z = az + ez * k;
          if (
            reject &&
            insidePrism(
              reject,
              x + frame.originEcef[0],
              y + frame.originEcef[1],
              z + frame.originEcef[2],
            )
          ) {
            havePrev = false;
            continue;
          }
          azAltOfRelInto(frame, x, y, z, _pt);
          pAz = _pt.azDeg;
          pAlt = _pt.altDeg;
          pDist = _pt.distM;
        }
        if (pDist > trust) {
          havePrev = false;
          continue;
        }
        raiseBin(profile, pAz, pAlt);
        samples++;
        if (havePrev) raiseSpan(profile, prevAz, prevAlt, pAz, pAlt);
        prevAz = pAz;
        prevAlt = pAlt;
        havePrev = true;
      }
    }
  }
  return { samples, nextTri: t, triCount };
}

// ---------------------------------------------------------------------------------------------
// Trees — analytic canopy spheres from the instanced TRS
// ---------------------------------------------------------------------------------------------

/** Slice-3 unit tree (scripts/bake/lib/gltf.mjs): canopy spans y 0.22→1.0 at radius 0.5,
 *  instance scale = (radiusM/0.5, heightM, radiusM/0.5), rotation is yaw-only about +Y.
 *
 *  EXPORTED since 2026-08-26g: `bestSpotWorker.buildDsm` decodes the same instance TRS into the
 *  BEST SPOT DSM's canopy layer. Two decoders with two private copies of these three numbers is
 *  precisely how the plan feed and the disc would come to disagree about how tall a tree is. */
export const CANOPY_CENTER_Y = 0.61;
export const CANOPY_HALF_Y = 0.39;
export const UNIT_CANOPY_R = 0.5;

/**
 * Fold every tree instance of one cell into the profile as a sphere at the canopy centre.
 * `instanceMatrices` is the raw `InstancedMesh.instanceMatrix.array` (16 floats per instance,
 * LOCAL cell frame where +Y is geodetic up); `matrixWorld` is the mesh's rigid cell→ECEF
 * transform (no scale — slice-3 bake contract), so instance scale components survive compose.
 */
export function sweepTreeInstances(
  profile: HorizonProfile,
  frame: SilhouetteFrame,
  instanceMatrices: ArrayLike<number>,
  instanceCount: number,
  matrixWorld: ArrayLike<number>,
  opts: SweepOptions,
): number {
  const base: [number, number, number] = [0, 0, 0];
  // Cell-local +Y in ECEF (rigid matrix ⇒ unit length is preserved).
  const upX = matrixWorld[4];
  const upY = matrixWorld[5];
  const upZ = matrixWorld[6];
  let swept = 0;
  for (let i = 0; i < instanceCount; i++) {
    const o = i * 16;
    // Yaw-only rotation about +Y keeps scale on the basis columns: |col0| = radius/0.5, m5 = height.
    const sx = Math.hypot(instanceMatrices[o], instanceMatrices[o + 1], instanceMatrices[o + 2]);
    const heightM = instanceMatrices[o + 5];
    const radiusM = sx * UNIT_CANOPY_R;
    applyMat4(
      matrixWorld,
      instanceMatrices[o + 12],
      instanceMatrices[o + 13],
      instanceMatrices[o + 14],
      base,
    );
    const cy = CANOPY_CENTER_Y * heightM;
    const cx = base[0] + upX * cy;
    const cyw = base[1] + upY * cy;
    const cz = base[2] + upZ * cy;
    if (opts.rejectPlanes?.length && insidePrism(opts.rejectPlanes, cx, cyw, cz)) continue;
    const c = azAltOfEcef(frame, cx, cyw, cz);
    if (c.distM > opts.trustRadiusM) continue;
    const sphereR = Math.max(radiusM, CANOPY_HALF_Y * heightM);
    if (c.distM <= sphereR) continue; // eye inside a canopy — no meaningful silhouette
    const angRadDeg = (Math.asin(Math.min(1, sphereR / c.distM)) * 180) / Math.PI;
    // Zenith clamp: a canopy grazing the eye pushes centre+radius past 90° — an elevation
    // above the zenith is meaningless and would leave bins nothing can ever clear honestly.
    const altTop = Math.min(c.altDeg + angRadDeg, 89.9);
    // Azimuth footprint of the sphere widens with 1/cos(alt); walk it in bin steps (a
    // near-overhead canopy legitimately spans everything — cap at the half circle).
    const azHalfDeg = Math.min(
      angRadDeg / Math.max(0.2, Math.cos((c.altDeg * Math.PI) / 180)),
      180,
    );
    const binWidthDeg = 360 / profile.binCount;
    // Walk the footprint by BIN, inclusive of both edges (at a fine width the float loop's
    // rounding could skip the last bin — T110).
    const bins = Math.ceil((2 * azHalfDeg) / binWidthDeg);
    for (let k = 0; k <= bins; k++) {
      raiseBin(profile, c.azDeg - azHalfDeg + (2 * azHalfDeg * k) / Math.max(1, bins), altTop);
    }
    swept++;
  }
  return swept;
}
