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
 * roofs whose silhouettes are edges, so the gap is theoretical at bin width ≥ ~3°.
 */

import { planeDistance, type EcefPlane } from "../globe/enrichedMask";
import { raiseBin, azAltOfEcef, type HorizonProfile, type SilhouetteFrame } from "./horizonProfile";

/** Guards a single edge's subdivision count (an edge brushing the eye would otherwise ask for
 *  thousands of samples). At 64 the residual azimuth step is ≤ edge-length/64 — combined with
 *  the bin merge this keeps worst-case cost bounded without visible skyline error. */
const MAX_EDGE_SUBDIV = 64;

export interface SweepOptions {
  /** Ignore geometry farther than this from the eye (the 2–4 km trust radius). */
  trustRadiusM: number;
  /** Reject vertices inside this prism (the OSM-mask interior where enriched owns buildings). */
  rejectPlanes?: readonly EcefPlane[] | null;
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
  const triCount = (index ? index.length : positions.length / 3) / 3;
  const binWidthRad = (2 * Math.PI) / profile.binCount;
  const reject = opts.rejectPlanes && opts.rejectPlanes.length ? opts.rejectPlanes : null;
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];
  let samples = 0;

  const vertAt = (vi: number, out: [number, number, number]) => {
    applyMat4(matrixWorld, positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2], out);
  };

  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const i0 = index ? index[t * 3 + e] : t * 3 + e;
      const i1 = index ? index[t * 3 + ((e + 1) % 3)] : t * 3 + ((e + 1) % 3);
      vertAt(i0, a);
      vertAt(i1, b);

      const pa = azAltOfEcef(frame, a[0], a[1], a[2]);
      const pb = azAltOfEcef(frame, b[0], b[1], b[2]);
      if (pa.distM > opts.trustRadiusM && pb.distM > opts.trustRadiusM) continue;
      // Boundary bias: an edge with EITHER endpoint inside the masked prism is dropped whole —
      // the enriched tileset owns that interior; under-counting a boundary sliver beats double
      // skylines from clipped-away OSM mass.
      if (reject && (insidePrism(reject, a[0], a[1], a[2]) || insidePrism(reject, b[0], b[1], b[2])))
        continue;

      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const ez = b[2] - a[2];
      const edgeLenM = Math.hypot(ex, ey, ez);
      // Subdivision density is set by the segment's CLOSEST approach to the eye, not its
      // endpoints — a long wall passing near the eye has far corners but a near midsection,
      // and endpoint-based steps skip bins exactly there (the case the canyon test pins).
      const ax = a[0] - frame.originEcef[0];
      const ay = a[1] - frame.originEcef[1];
      const az = a[2] - frame.originEcef[2];
      const tClosest =
        edgeLenM > 0
          ? Math.min(1, Math.max(0, -(ax * ex + ay * ey + az * ez) / (edgeLenM * edgeLenM)))
          : 0;
      const nearDistM = Math.max(
        1,
        Math.hypot(ax + ex * tClosest, ay + ey * tClosest, az + ez * tClosest),
      );
      const steps = Math.min(
        MAX_EDGE_SUBDIV,
        Math.max(1, Math.ceil(edgeLenM / (nearDistM * binWidthRad))),
      );
      for (let s = 0; s <= steps; s++) {
        const k = s / steps;
        const x = a[0] + (b[0] - a[0]) * k;
        const y = a[1] + (b[1] - a[1]) * k;
        const z = a[2] + (b[2] - a[2]) * k;
        const pt = s === 0 ? pa : s === steps ? pb : azAltOfEcef(frame, x, y, z);
        if (pt.distM > opts.trustRadiusM) continue;
        if (reject && s !== 0 && s !== steps && insidePrism(reject, x, y, z)) continue;
        raiseBin(profile, pt.azDeg, pt.altDeg);
        samples++;
      }
    }
  }
  return samples;
}

// ---------------------------------------------------------------------------------------------
// Trees — analytic canopy spheres from the instanced TRS
// ---------------------------------------------------------------------------------------------

/** Slice-3 unit tree (scripts/bake/lib/gltf.mjs): canopy spans y 0.22→1.0 at radius 0.5,
 *  instance scale = (radiusM/0.5, heightM, radiusM/0.5), rotation is yaw-only about +Y. */
const CANOPY_CENTER_Y = 0.61;
const CANOPY_HALF_Y = 0.39;
const UNIT_CANOPY_R = 0.5;

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
    for (let az = c.azDeg - azHalfDeg; az <= c.azDeg + azHalfDeg; az += binWidthDeg) {
      raiseBin(profile, az, altTop);
    }
    raiseBin(profile, c.azDeg + azHalfDeg, altTop); // inclusive far edge
    swept++;
  }
  return swept;
}
