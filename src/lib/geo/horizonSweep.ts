/**
 * BEST SPOT — the EYE-HEIGHT-INDEPENDENT HULL SWEEP (BESTSPOT_PLAN §5 T0/T1, slice S2b).
 *
 * For ONE azimuth, produce per-cell `RayEvidence` for EVERY cell of a `LocalDsm`, in O(cells).
 * The grid is SHEAR-RESAMPLED so that cells lie on rays, and each ray gets a BACKWARD monotone-stack
 * pass that builds the UPPER CONVEX HULL of the along-ray surface (the Dozier & Frew horizon-algorithm
 * shape). Every cell then queries its own suffix hull for the maximum apparent elevation.
 *
 * Pure, three-free, store-free, no `Date.now()` — imports cleanly inside a module worker.
 *
 * ============================================================================================
 * THE LOAD-BEARING INVARIANT: **THE HULL IS INDEPENDENT OF EYE HEIGHT AND OF SCENE TIME.**
 * ============================================================================================
 * `buildHulls` takes NO eye height and NO epoch. Raising the eye only re-selects WHICH hull vertex
 * maximises the angle, and that maximiser moves monotonically OUTWARD, so the query is a monotone
 * walk / binary search over a hull built ONCE. This is the entire reason the altitude slider and the
 * time scrubber are live: T1 re-queries, it never rebuilds (§5, and S6's `hullBuilds` pin).
 *
 * The algebra that makes it true — and the reason `2·drop·s_c` exists below. Apparent elevation from
 * a cell `c` (ground `g_c`, lift `L`) to a sample `t`, at horizontal separation `D = s_t − s_c`:
 *
 *     tan(alt) = ( h_t − (g_c + L) − D²·drop ) / D                       drop = (1−k)/(2R)
 *
 * Expand `D² = s_t² − 2 s_c s_t + s_c²` and regroup around a COMMON along-ray origin:
 *
 *     tan(alt) = ( zs[t] − q_c ) / D  +  2·drop·s_c
 *         where  zs[t] = h_t − drop·s_t²          <- the curvature-folded surface, F4
 *                q_c   = g_c − drop·s_c² + L      <- the ONLY place the eye appears
 *
 * `q_c` shifts the query POINT vertically; `2·drop·s_c` is a per-cell additive constant that cannot
 * change an argmax. Neither touches `zs`. So the hull over `{(s_t, zs[t])}` is built once and every
 * eye height, and every scene time, is a query against it. (Verified numerically for a shifted ray
 * origin — the decomposition is origin-independent, which is why a ray may start at the grid edge.)
 *
 * ============================================================================================
 * F4 — CURVATURE IS FOLDED IN **BEFORE** THE HULL, AND THAT IS NOT A STYLE CHOICE
 * ============================================================================================
 * The drop term is CONVEX in `s`, so `zs = h − drop·s²` is `h` plus a CONCAVE function — which ADDS
 * hull vertices. A sample INTERIOR to `hull(raw h)` can be the true horizon setter of `hull(zs)`.
 * Building the hull on raw heights and applying curvature only at the surviving candidates silently
 * UNDER-REPORTS the skyline, worst at long range — exactly where the metric's "far in the distance"
 * term `P` is supposed to pay, and exactly where the owner's bridge lives.
 *
 * The spec's own counterexample (`d = 1,2,3`, `Z = [0, 0.9, 2]`) is pinned in the tests, together with
 * an arithmetic defect it contains: at the eye height the spec names (−1) the NEAREST sample wins in
 * BOTH orderings, so that eye cannot demonstrate anything. The structural claim is true and is pinned
 * on the hull membership plus an eye height at which the orderings genuinely disagree. See
 * `test/lib/geo/horizonSweep.test.ts`.
 *
 * ============================================================================================
 * F3 — FLOATING SOLIDS ARE BANDS, NOT A RAISED HORIZON
 * ============================================================================================
 * Decks/arches/piers never enter `zs`. Each ray is clipped analytically against the sparse footprint
 * list (eye-invariant, so it is precomputed in `buildHulls` and shares the hull's residency), and each
 * cell assembles `[lo, hi]` angular bands from the suffix of solids in front of it. A max-only profile
 * makes "the sun sets behind the bridge" and "a blank 15-storey wall" the same object.
 *
 * **AND EVERY BAND CARRIES ITS OWN PROVENANCE** — `bandSrc` + `bandDistM`, published all the way onto
 * `RayEvidence` (bestSpotTypes pin 5). Giving the deck an angular extent but leaving the SETTER TAG
 * bound to the ground horizon was the same bug one layer down: `surfaceSrc` never sees a floating
 * solid, so a real deck reported `"terrain"` and `F_sil` was structurally dead on the hero case.
 *
 * ============================================================================================
 * HONESTY CONTRACT
 * ============================================================================================
 *  · A ray with no forward evidence reports `known = 0` AND `openSky = 0`. The stored altitude is the
 *    eye's own horizon dip — a FLOOR, not a measurement — and `openSky` is the flag that stops a
 *    consumer converting that floor into "clear sky" (bestSpotTypes pin 4).
 *  · **`reachM` — HOW FAR THE RAY ACTUALLY LOOKED, and `openSky` is GATED ON IT (S3c, SPEC_V2 §3).**
 *    `known` means "this ray found ≥ 1 forward sample". It has never meant "this ray was swept to
 *    the trust radius", and until S3c nothing in the contract asked the second question — so a disc
 *    whose DSM stops halfway still reported `known = 1` on every ray, `C = 1.000`, and `openSky` on
 *    every ray. MEASURED (SPEC_V2 §3.1): a 30 m ridge 500 m up-sun with the DSM truncated at 350 m
 *    scored **0.6633 against the truth's 0.0000** and was indistinguishable from a genuinely open
 *    plain (0.6613). Missing data did not read as "unknown" — it read as THE BEST SPOT ON THE MAP.
 *    `reachM` is the along-ray distance of the LAST KNOWN slot forward of the cell, and `openSky`
 *    now additionally requires `reachM >= min(trustRadiusM, gridReachM)` where `gridReachM` is how
 *    far this cell's own ray could POSSIBLY have reached inside the grid. The `min` is why the
 *    400 m COLLAR is not optional: at the rim `gridReachM → 0`, the gate degenerates to "the sweep
 *    did all it could", and only the collar puts real evidence in front of every scored cell.
 *    (Measured, SPEC_V2 §3.1: a rim cell 290 m up-sun reads 0.0467 with the collar and 0.6619
 *    without — a 14× silent error, with `reachM` the channel that makes it visible.)
 *  · `groundAltAppDeg` is SIGNED and is NOT floored at the dip: a cell on a bluff has a genuinely
 *    DEPRESSED horizon, which `createProfile`+`raiseBin` structurally cannot express (pin 3).
 *  · Distances are HORIZONTAL along-ray metres. At ≤ 2 km and ≤ 2° the slant range differs by < 0.1 %,
 *    and `P = ln(D/30)/ln(trust/30)` is a ground-distance term.
 *  · The shear walks a DISCRETE line (`iy = j + round(slope·t)`), so a sample deviates from the exact
 *    ray by ≤ half a cell and the along-ray step is the exact average of the discrete steps. The
 *    deviation is BOUNDED, not cumulative. At `cellM = 3` that is ≤ 1.5 m of cross-ray slop, far inside
 *    the 5–20 m generalisation of the source vectors (§8).
 */

import type { OccluderSrc, RayEvidence } from "./bestSpotTypes";
import { horizonDipDeg, R_MEAN_M } from "./horizonProfile";
import { SRC_NONE, SRC_TERRAIN, srcName, type LocalDsm } from "./localDsm";

const DEG = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------------------------
// The shear — a BIJECTION between cells and ray samples
// ---------------------------------------------------------------------------------------------

/**
 * How one azimuth's rays walk the grid.
 *
 * Cell `(ix, iy)` maps to EXACTLY ONE `(ray, step)` and back — no interpolation, no resampled copy,
 * no cell sampled twice or missed. That bijection is why the sweep is O(cells) with the constant of a
 * single pass, and why `sweepAzimuth` can write per-cell outputs while iterating in ray order.
 */
export interface RayShear {
  azDeg: number;
  nx: number;
  ny: number;
  cellM: number;
  /** Unit ray direction in ENU (east, north). */
  ue: number;
  un: number;
  /** true = one sample per EAST column (|sin az| ≥ |cos az|); false = one per NORTH row. */
  xDominant: boolean;
  /** +1/−1 step of the dominant grid axis per sample, so `t` always grows AWAY from the eye. */
  sgn: number;
  /** Off-axis cells advanced per dominant step. |slope| ≤ 1 by choice of dominant axis. */
  slope: number;
  /** Along-ray spacing between consecutive samples (m) = `cellM / max(|ue|, |un|)`. */
  dsM: number;
  /** `round(slope·t)` per dominant step, precomputed — the discrete line. */
  offOf: Int32Array;
  rayCount: number;
  /** Smallest ray key, so `r = ioff − off(t) − jMin`. */
  jMin: number;
  /** Slot of each ray's first sample; length `rayCount + 1` (the tail is the total slot count). */
  rayStart: Int32Array;
  /** Dominant-step index of each ray's first sample. */
  rayT0: Int32Array;
  /** Samples in each ray. `Σ rayLen === nx·ny`. */
  rayLen: Int32Array;
}

export function buildShear(nx: number, ny: number, cellM: number, azDeg: number): RayShear {
  const az = azDeg * DEG;
  const ue = Math.sin(az);
  const un = Math.cos(az);
  const aue = Math.abs(ue);
  const aun = Math.abs(un);
  const xDominant = aue >= aun;
  const dom = xDominant ? aue : aun;
  const dsM = cellM / dom;
  const sgn = (xDominant ? ue : un) >= 0 ? 1 : -1;
  // Signed off-axis cells per dominant step. |slope| ≤ 1 keeps the discrete line connected: every
  // dominant step moves the off-axis index by 0 or ±1, so no ray can skip a row.
  const slope = xDominant ? un / aue : ue / aun;
  const nDom = xDominant ? nx : ny;
  const nOff = xDominant ? ny : nx;

  const offOf = new Int32Array(nDom);
  for (let t = 0; t < nDom; t++) offOf[t] = Math.round(slope * t);
  const offEnd = offOf[nDom - 1];
  const offMin = Math.min(0, offEnd);
  const offMax = Math.max(0, offEnd);
  const jMin = -offMax;
  const rayCount = nOff + (offMax - offMin);

  // Per-ray extent. `off` is monotone in `t`, so each ray's valid steps are CONTIGUOUS — the reason a
  // ray is a run of slots rather than a scatter.
  const rayT0 = new Int32Array(rayCount).fill(-1);
  const rayLen = new Int32Array(rayCount);
  for (let t = 0; t < nDom; t++) {
    const rLo = -offOf[t] - jMin;
    for (let r = rLo, ioff = 0; ioff < nOff; ioff++, r++) {
      if (rayT0[r] < 0) rayT0[r] = t;
      rayLen[r] = t - rayT0[r] + 1;
    }
  }
  const rayStart = new Int32Array(rayCount + 1);
  for (let r = 0; r < rayCount; r++) rayStart[r + 1] = rayStart[r] + rayLen[r];
  if (rayStart[rayCount] !== nx * ny) {
    throw new Error(
      `horizonSweep: shear is not a bijection (${rayStart[rayCount]} slots for ${nx * ny} cells) at az ${azDeg}`,
    );
  }
  return {
    azDeg,
    nx,
    ny,
    cellM,
    ue,
    un,
    xDominant,
    sgn,
    slope,
    dsM,
    offOf,
    rayCount,
    jMin,
    rayStart,
    rayT0,
    rayLen,
  };
}

/** Ray-sample slot of a cell. The inverse of `cellOfSlot`; both are pure arithmetic, so the shear
 *  stores no `cells`-sized index maps (which would be 4 MB per azimuth at 601²). */
export function slotOfCell(sh: RayShear, cell: number): number {
  const ix = cell % sh.nx;
  const iy = (cell - ix) / sh.nx;
  const t = sh.xDominant
    ? sh.sgn > 0
      ? ix
      : sh.nx - 1 - ix
    : sh.sgn > 0
      ? iy
      : sh.ny - 1 - iy;
  const ioff = sh.xDominant ? iy : ix;
  const r = ioff - sh.offOf[t] - sh.jMin;
  return sh.rayStart[r] + (t - sh.rayT0[r]);
}

/** Ray index owning a slot (binary search over `rayStart`; `rayCount ≈ nx + ny`, so ~11 steps). */
export function rayOfSlot(sh: RayShear, slot: number): number {
  let lo = 0;
  let hi = sh.rayCount - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sh.rayStart[mid] <= slot) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Cell at dominant step `t` of ray `r` — the form the hot loops use, since they already know `r`
 *  and paying `rayOfSlot`'s binary search per sample would add O(cells·log rays) to every azimuth. */
export function cellOfRayStep(sh: RayShear, r: number, t: number): number {
  const ioff = r + sh.jMin + sh.offOf[t];
  if (sh.xDominant) {
    const ix = sh.sgn > 0 ? t : sh.nx - 1 - t;
    return ioff * sh.nx + ix;
  }
  const iy = sh.sgn > 0 ? t : sh.ny - 1 - t;
  return iy * sh.nx + ioff;
}

/** Cell owning a ray-sample slot. */
export function cellOfSlot(sh: RayShear, slot: number): number {
  const r = rayOfSlot(sh, slot);
  return cellOfRayStep(sh, r, sh.rayT0[r] + (slot - sh.rayStart[r]));
}

// ---------------------------------------------------------------------------------------------
// The hulls
// ---------------------------------------------------------------------------------------------

export interface BuildHullsOptions {
  /** Terrestrial refraction coefficient k (surveyor's standard 0.13 — `PLAN.refractionK`). Passed
   *  explicitly rather than imported so the kernel stays testable without the tuning module. */
  refractionK: number;
  /** Earth radius for the curvature drop (m). Default `R_MEAN_M`. A test may pass a TOY radius to
   *  make the drop visible at metre scale — that is the only way to exercise F4 by hand arithmetic. */
  earthRadiusM?: number;
  /** Precompute per-ray floating-solid intervals (default true). They are eye- and time-invariant,
   *  so they belong to T0 alongside the hull, not to the per-lift query. */
  includeFloating?: boolean;
}

/**
 * ONE azimuth's hulls. Serialisable, and **invariant in eye height and in scene time** — the whole
 * architecture rests on that (see the file docblock).
 *
 * Resident cost is `zs` (8 B) + `link` (4 B) = **12 B per cell per azimuth**.
 *
 * **THE LEDGER THAT USED TO BE HERE UNDERCOUNTED BY 5.4× — IT FORGOT THE COLLAR** (SPEC_V2 §2.1,
 * corrected S3c). It quoted 0.49 MB/az at "201²/3 m" and 4.35 MB/az at "601²/1 m", which are the
 * DISC grids — `oddSpanCells(radiusM, cellM)`. The grid a solve actually sweeps is
 * `oddSpanCells(radiusM + 400 m collar, cellM)`, because a cell at the rim must have real evidence
 * in front of it or `reachM` correctly refuses it open sky (see the HONESTY CONTRACT above). The
 * true resident cost, at the two configurations §2.1 measures:
 *
 * | disc | sweep grid | cells | hull | K = 40 |
 * |---|---|---|---|---|
 * | 300 m @ 3 m (201² disc) | **469²** | 219,961 | **2.52 MiB/az** | **101 MiB** |
 * | 500 m @ 3 m (335² disc) | 601² | 361,201 | 4.13 MiB/az | 165 MiB |
 * | 300 m @ 1 m (601² disc, ULTRA) | **1401²** | 1,962,801 | **22.46 MiB/az** | **899 MiB** |
 *
 * **At 1 m the hulls CANNOT be resident.** 899 MiB is 6.5× the 139 MB `(H, D)` slab §5 rejected on
 * memory grounds, so ULTRA must STREAM azimuths — build, sweep, score and release one at a time —
 * and therefore re-pays `buildHulls` on every lift change (`bestSpotSolver.solveTerms`, mode
 * `"stream"`). `hullBytes` exists so the solver can hold itself to this ledger rather than assume it.
 */
export interface RayHulls {
  azDeg: number;
  shear: RayShear;
  /** Curvature-folded surface height per slot, `h − drop·s²`. **NaN where the cell has no evidence** —
   *  NaN is the in-band unknown marker, so the hull build and every query skip it without a side array. */
  zs: Float64Array;
  /**
   * Persistent monotone-stack successor.
   *  · KNOWN slot → the next vertex of the upper hull of `{t … end}` (−1 ends the chain).
   *  · UNKNOWN slot → the hull HEAD of `{t+1 … end}`, so a cell behind a run of unknown samples still
   *    finds a valid chain start in O(1). One array serves both because a slot is written exactly once.
   */
  link: Int32Array;
  /** A LIVE VIEW of `dsm.ground` — the hull owns no copy. Any DSM edit invalidates these hulls, which
   *  is exactly T0's invalidation contract (centre or radius). */
  ground: Float32Array;
  /** `(1 − k) / (2R)`. */
  dropPerM2: number;
  refractionK: number;
  earthRadiusM: number;
  /** Per-ray floating-solid intervals, CSR over rays; `floatStart` has `rayCount + 1` entries. */
  floatStart: Int32Array;
  /** Index into `dsm.floating`. */
  floatIdx: Int32Array;
  /** Ray entry/exit in LOCAL along-ray metres (0 at each ray's first sample). */
  floatTau0: Float64Array;
  floatTau1: Float64Array;
  /** The largest number of floating solids any single ray crosses — the scratch size `sweepAzimuth`
   *  needs, computed here so the hot path allocates nothing. */
  maxFloatPerRay: number;
}

/**
 * Build one azimuth's hulls. **Takes no eye height and no time** — if either ever appears in this
 * signature, the altitude slider and the scrubber both become O(rebuild) and S6's `hullBuilds` pin
 * goes red. That is the pin's whole purpose.
 */
export function buildHulls(dsm: LocalDsm, azDeg: number, opts: BuildHullsOptions): RayHulls {
  if (!dsm.sealed) {
    throw new Error("horizonSweep.buildHulls: DSM is not sealed — call sealDsm() after every stamp");
  }
  const R = opts.earthRadiusM ?? R_MEAN_M;
  const drop = R === Infinity ? 0 : (1 - opts.refractionK) / (2 * R);
  const sh = buildShear(dsm.nx, dsm.ny, dsm.cellM, azDeg);
  const slots = dsm.cellCount;
  const zs = new Float64Array(slots);
  const link = new Int32Array(slots);
  const { surfaceTop } = dsm;
  const dsM = sh.dsM;

  for (let r = 0; r < sh.rayCount; r++) {
    const base = sh.rayStart[r];
    const len = sh.rayLen[r];
    const t0 = sh.rayT0[r];
    // --- fill: curvature folded in BEFORE the hull (F4). One multiply per sample.
    for (let li = 0; li < len; li++) {
      const s = li * dsM;
      // NaN surfaceTop propagates: `NaN − x` is NaN, so unknown stays unknown with no branch.
      zs[base + li] = surfaceTop[cellOfRayStep(sh, r, t0 + li)] - drop * s * s;
    }
    // --- backward monotone stack: the UPPER convex hull of every suffix, in O(len) amortised.
    let top = -1;
    for (let li = len - 1; li >= 0; li--) {
      const slot = base + li;
      const zt = zs[slot];
      if (zt !== zt) {
        link[slot] = top; // unknown slot carries the HEAD, not a hull edge
        continue;
      }
      let a = top;
      while (a >= 0) {
        const b = link[a];
        if (b < 0) break;
        // Pop `a` when slope(t→a) ≤ slope(t→b): cross-multiplied, so no division and no epsilon.
        // Both step gaps are positive, and `dsM` cancels, so integer gaps are exact.
        const ga = a - slot;
        const gb = b - slot;
        if ((zs[a] - zt) * gb <= (zs[b] - zt) * ga) a = b;
        else break;
      }
      link[slot] = a;
      top = slot;
    }
  }

  const hulls: RayHulls = {
    azDeg,
    shear: sh,
    zs,
    link,
    ground: dsm.ground,
    dropPerM2: drop,
    refractionK: opts.refractionK,
    earthRadiusM: R,
    floatStart: new Int32Array(sh.rayCount + 1),
    floatIdx: new Int32Array(0),
    floatTau0: new Float64Array(0),
    floatTau1: new Float64Array(0),
    maxFloatPerRay: 0,
  };
  if (opts.includeFloating !== false && dsm.floating.length > 0) clipFloatingToRays(dsm, hulls);
  return hulls;
}

/**
 * Clip every floating solid against every ray. Pure geometry: no eye, no time, so it is part of T0
 * and rides the hull's residency (F3 says the bands are the hero case; making the metric pay for this
 * clip on every lift change would be the same mistake as rebuilding the hull).
 *
 * A solid is an ORIENTED rectangle (centreline + half-width). Two-slab clipping in the rectangle's own
 * frame gives the ray's entry/exit in one pass with no allocation.
 */
function clipFloatingToRays(dsm: LocalDsm, hulls: RayHulls): void {
  const sh = hulls.shear;
  const solids = dsm.floating;
  const idx: number[] = [];
  const t0s: number[] = [];
  const t1s: number[] = [];
  const start = hulls.floatStart;
  let maxPerRay = 0;

  for (let r = 0; r < sh.rayCount; r++) {
    start[r] = idx.length;
    const len = sh.rayLen[r];
    if (len <= 0) continue;
    const cell0 = cellOfRayStep(sh, r, sh.rayT0[r]);
    const ix0 = cell0 % sh.nx;
    const iy0 = (cell0 - ix0) / sh.nx;
    const pe = dsm.originE + ix0 * dsm.cellM;
    const pn = dsm.originN + iy0 * dsm.cellM;
    const sMax = (len - 1) * sh.dsM;
    let onThisRay = 0;

    for (let k = 0; k < solids.length; k++) {
      const s = solids[k];
      const ax = s.e1 - s.e0;
      const ay = s.n1 - s.n0;
      const alen = Math.hypot(ax, ay);
      if (!(alen > 0) || !(s.halfWidthM > 0)) continue;
      const ux = ax / alen;
      const uy = ay / alen;
      const cx = (s.e0 + s.e1) / 2;
      const cy = (s.n0 + s.n1) / 2;
      const relE = pe - cx;
      const relN = pn - cy;
      let lo = 0;
      let hi = sMax;
      // slab 1: along the centreline, half-extent alen/2. slab 2: across it, half-extent halfWidthM.
      const o1 = relE * ux + relN * uy;
      const d1 = sh.ue * ux + sh.un * uy;
      const o2 = -relE * uy + relN * ux;
      const d2 = -sh.ue * uy + sh.un * ux;
      let empty = false;
      for (let axis = 0; axis < 2 && !empty; axis++) {
        const o = axis === 0 ? o1 : o2;
        const d = axis === 0 ? d1 : d2;
        const half = axis === 0 ? alen / 2 : s.halfWidthM;
        if (Math.abs(d) < 1e-12) {
          if (Math.abs(o) > half) empty = true;
          continue;
        }
        const ta = (-half - o) / d;
        const tb = (half - o) / d;
        const enter = Math.min(ta, tb);
        const exit = Math.max(ta, tb);
        if (enter > lo) lo = enter;
        if (exit < hi) hi = exit;
        if (lo >= hi) empty = true;
      }
      if (empty) continue;
      idx.push(k);
      t0s.push(lo);
      t1s.push(hi);
      onThisRay++;
    }
    if (onThisRay > maxPerRay) maxPerRay = onThisRay;
  }
  start[sh.rayCount] = idx.length;
  hulls.floatIdx = Int32Array.from(idx);
  hulls.floatTau0 = Float64Array.from(t0s);
  hulls.floatTau1 = Float64Array.from(t1s);
  hulls.maxFloatPerRay = maxPerRay;
}

/** Resident bytes of one azimuth's hulls (the shared `ground` VIEW is counted once by the DSM). */
export function hullBytes(hulls: RayHulls): number {
  return (
    hulls.zs.byteLength +
    hulls.link.byteLength +
    hulls.shear.offOf.byteLength +
    hulls.shear.rayStart.byteLength +
    hulls.shear.rayT0.byteLength +
    hulls.shear.rayLen.byteLength +
    hulls.floatStart.byteLength +
    hulls.floatIdx.byteLength +
    hulls.floatTau0.byteLength +
    hulls.floatTau1.byteLength
  );
}

/**
 * Byte snapshot of everything the hull IS. Used by the lift-invariance pin: the serialised hull must
 * be byte-identical across eye heights while the query output differs. If a lift term ever leaks into
 * the build, these bytes move and the pin goes red.
 */
export function serializeHulls(hulls: RayHulls): Uint8Array {
  const sh = hulls.shear;
  const header = new Float64Array([
    hulls.azDeg,
    sh.nx,
    sh.ny,
    sh.cellM,
    sh.ue,
    sh.un,
    sh.xDominant ? 1 : 0,
    sh.sgn,
    sh.slope,
    sh.dsM,
    sh.rayCount,
    sh.jMin,
    hulls.dropPerM2,
    hulls.refractionK,
    hulls.earthRadiusM,
    hulls.maxFloatPerRay,
  ]);
  const parts: ArrayBufferView[] = [
    header,
    hulls.zs,
    hulls.link,
    hulls.ground,
    sh.offOf,
    sh.rayStart,
    sh.rayT0,
    sh.rayLen,
    hulls.floatStart,
    hulls.floatIdx,
    hulls.floatTau0,
    hulls.floatTau1,
  ];
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), at);
    at += p.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The query — one cell, one eye height
// ---------------------------------------------------------------------------------------------

export interface RayQuery {
  /** Maximum APPARENT elevation along the ray, deg. SIGNED, never floored at the dip. */
  altAppDeg: number;
  /** Horizontal along-ray distance to the setter (m). `Infinity` when nothing was found. */
  distM: number;
  /** SLOT of the setter, −1 when nothing was found. Its tag is `dsm.surfaceSrc[cellOfSlot(shear, srcIdx)]`. */
  srcIdx: number;
}

/**
 * Maximum apparent elevation seen from one cell at one eye height.
 *
 * `eyeAltM` is metres ABOVE THE CELL'S OWN GROUND — the altitude-sheet lift, not an absolute altitude.
 * That is what the owner's slider moves, and it is the term that enters `q_c` and nothing else.
 *
 * Walks the suffix hull chain and stops at the first non-increase. That is exact, not a heuristic: the
 * hull is concave, so `g(s) = (h(s) − q)/(s − s_c)` has `N'(s) = h''(s)·(s − s_c) ≤ 0`, its derivative
 * changes sign at most once (+ → −), and the slope sequence over hull vertices is UNIMODAL. The same
 * fact is why the maximiser moves monotonically outward as the eye rises.
 */
export function queryRay(hulls: RayHulls, cellIndex: number, eyeAltM: number): RayQuery {
  const sh = hulls.shear;
  const slot = slotOfCell(sh, cellIndex);
  const r = rayOfSlot(sh, slot);
  const base = sh.rayStart[r];
  const len = sh.rayLen[r];
  const li = slot - base;
  const g0 = hulls.ground[cellIndex];
  if (g0 !== g0) return noQuery(); // no eye without ground (pin 3)
  const sc = li * sh.dsM;
  const q = g0 - hulls.dropPerM2 * sc * sc + eyeAltM;

  let cur = li + 1 < len ? headOf(hulls, base + li + 1) : -1;
  let bestSlot = -1;
  let bestG = -Infinity;
  while (cur >= 0) {
    const g = (hulls.zs[cur] - q) / ((cur - slot) * sh.dsM);
    if (g <= bestG) break; // unimodal: the first non-increase is the peak
    bestG = g;
    bestSlot = cur;
    cur = hulls.link[cur];
  }
  if (bestSlot < 0) return noQuery();
  return {
    altAppDeg: Math.atan(bestG + 2 * hulls.dropPerM2 * sc) * RAD2DEG,
    distM: (bestSlot - slot) * sh.dsM,
    srcIdx: bestSlot,
  };
}

/** Nothing forward on this ray. NaN, not a plausible floor — `queryRay` has no eye-dip context and a
 *  fabricated angle here would be laundered into evidence by the first caller that skipped `srcIdx`. */
function noQuery(): RayQuery {
  return { altAppDeg: Number.NaN, distM: Infinity, srcIdx: -1 };
}

/** Hull head of the suffix starting at `slot`: `slot` itself when known, else the head it carries. */
function headOf(hulls: RayHulls, slot: number): number {
  return hulls.zs[slot] === hulls.zs[slot] ? slot : hulls.link[slot];
}

// ---------------------------------------------------------------------------------------------
// The sweep — every cell of one azimuth, into parallel typed arrays
// ---------------------------------------------------------------------------------------------

/**
 * `RayEvidence` flattened. The solver calls the sweep ~24–42 times per solve over 10⁴–10⁶ cells, so
 * the hot loop writes typed arrays and allocates nothing; `rayEvidenceAt` rebuilds the readable shape
 * for tests and panels.
 *
 * Bands are stored COO-by-cell (`bandStart`/`bandN`) rather than CSR, because the sweep visits cells
 * in RAY order, not in cell-index order — CSR would force a counting pre-pass or a sort.
 */
export interface RaySweepOut {
  azDeg: number;
  cellCount: number;
  /** SIGNED apparent elevation of the GROUND horizon (deg). The eye dip FLOOR where `known = 0`. */
  groundAltAppDeg: Float32Array;
  /**
   * Horizontal distance to the GROUND setter (m), `Infinity` when there is none.
   *
   * NAMED FOR ITS CHANNEL ON PURPOSE (LENS B, 2026-08-24). It used to be `blockerDistM` and to fall
   * back to a band's distance when the ground had none, which read as "the ray's blocker" while
   * meaning "the ground setter, mostly" — and `RayEvidence.blockerDistM` (the ray's HEADLINE, nearest
   * of the two channels) then silently inherited the wrong one. Two channels, two names.
   */
  groundDistM: Float32Array;
  /** GROUND setter slot (−1 = none) — resolve the tag with `cellOfSlot` + `dsm.surfaceSrc`. */
  srcSlot: Int32Array;
  /** `SRC_*` code of the GROUND setter. Floating solids never reach `surfaceSrc` (localDsm pin 2), so
   *  this can NEVER be `SRC_DECK` for a real deck — that tag lives in `bandSrc`. */
  groundSrc: Uint8Array;
  known: Uint8Array;
  /**
   * **THE HONESTY CHANNEL (S3c).** Along-ray distance (m) of the LAST KNOWN slot forward of this
   * cell — i.e. how far the evidence behind `known` actually reached. `0` when nothing forward was
   * sampled (which is also `known = 0`).
   *
   * `known` says "≥ 1 sample was found". This says "…and it stopped HERE". Without the second
   * number a disc whose DSM is truncated at 350 m reports `C = 1.000` and open sky on every ray
   * (measured `S = 0.6633` against a truth of `0.0000`, SPEC_V2 §3.1), and — worse — a later
   * refinement that fills the hole LOWERS the score, which the owner reads as a regression.
   */
  reachM: Float32Array;
  /**
   * 1 = a terrain-only horizon at or below the eye's own dip, with nothing floating over it, **AND
   * the ray reached `min(trustRadiusM, gridReachM)`** (S3c). It is a claim about the NEAR/MID model
   * only — the disc ends at its own radius, so "open" here means "the layered DSM holds nothing in
   * the way as far as it was able to look", not "nothing on earth". §5's FAR zone (the shared
   * `marchTerrainBin` profile plus the per-cell parallax correction) is what answers the rest.
   */
  openSky: Uint8Array;
  /** First band index of each cell, and how many. Bands are ascending and non-overlapping. */
  bandStart: Int32Array;
  bandN: Int32Array;
  bandLoDeg: Float32Array;
  bandHiDeg: Float32Array;
  /**
   * Near-edge distance of each band (m). The bridge hero case needs BOTH the far-bank ground distance
   * and the deck's own distance, because `F_sil`'s `P(a)` term is meaningless without the latter.
   * Published on `RayEvidence.bandDistM` since LENS B — before that it stopped here, at the flattened
   * arrays, and the contract shape the metric actually reads never saw it.
   */
  bandDistM: Float32Array;
  /** `SRC_*` of each band's solid. */
  bandSrc: Uint8Array;
  bandUsed: number;
  /** True when `bandCapacity` was reached. Recorded rather than silently truncated. */
  bandOverflow: boolean;
}

/**
 * Allocate a sweep buffer. `bandCapacity` bounds the total bands across ALL cells of one azimuth;
 * floating solids are rare (tens per disc) but a single deck is seen by every cell in front of it, so
 * budget ~`cellCount / 4` when decks are present and 0 when the disc has none.
 */
export function createSweepOut(cellCount: number, bandCapacity: number): RaySweepOut {
  return {
    azDeg: Number.NaN,
    cellCount,
    groundAltAppDeg: new Float32Array(cellCount),
    groundDistM: new Float32Array(cellCount),
    srcSlot: new Int32Array(cellCount),
    groundSrc: new Uint8Array(cellCount),
    known: new Uint8Array(cellCount),
    reachM: new Float32Array(cellCount),
    openSky: new Uint8Array(cellCount),
    bandStart: new Int32Array(cellCount),
    bandN: new Int32Array(cellCount),
    bandLoDeg: new Float32Array(bandCapacity),
    bandHiDeg: new Float32Array(bandCapacity),
    bandDistM: new Float32Array(bandCapacity),
    bandSrc: new Uint8Array(bandCapacity),
    bandUsed: 0,
    bandOverflow: false,
  };
}

export interface SweepOptions {
  /**
   * Elevation slack (deg) below which a terrain-only horizon at or under the eye's dip is called
   * OPEN SKY. Default 0.01° ≈ 36″ ≈ 4 % of a solar radius — well under a twentieth of the disc, so a
   * cell called open-sky cannot be hiding a blocker that would eat a measurable slice of it.
   */
  openSkyTolDeg?: number;
  /**
   * Floating solids nearer than this (m) are ignored. A deck the eye is standing UNDER has no
   * meaningful silhouette — it fills the sky — and its apparent extent runs to ±90°, which would leave
   * bands nothing can honestly clear. The `sweepTreeInstances` "eye inside a canopy" precedent.
   */
  nearClipM?: number;
  /**
   * How far a ray must have REACHED (m) before a terrain-only horizon at the dip may be called OPEN
   * SKY. Default 3000 — the shipped `scoring.curves.depthTrustRadiusM`, which is what "we looked as
   * far as this metric claims to see" means. The solver passes the live profile's value.
   *
   * The effective threshold is `min(trustRadiusM, gridReachM)`: no disc is 3 km wide, so demanding
   * the literal trust radius would refuse open sky to every cell on earth. See the HONESTY CONTRACT
   * in the file docblock for why the COLLAR is the other half of this gate.
   *
   * It is an EVIDENCE-QUALITY threshold, so it stays here rather than on the tunable profile
   * (`BESTSPOT_HONESTY`, SPEC_V2 §5.5) — alongside `openSkyTolDeg` and `nearClipM`.
   */
  trustRadiusM?: number;
  /**
   * OPTIONAL per-cell scoring mask over the SAME grid as `out` — 1 = score this cell, 0 = skip the
   * per-cell binary peak search AND the band assembly and write the "no evidence" tuple instead.
   *
   * **THE CHEAPEST LEVER IN THE FEATURE** (SPEC_V2 §7 S3c-1). The sweep grid carries a 400 m collar
   * that exists only so the DISC's rim cells have evidence in front of them, so just 14.3 % of the
   * grid at 3 m/300 m is actually scored — and the peak search and the band assembly are pure
   * overhead for the other 85.7 %. Measured **2.20× at 3 m/300 m (10.23 → 4.15 ms/az)**, 1.71× at
   * 500 m, 2.30× at 1 m ⇒ **−243 ms per solve at the default and −2.2 s at ULTRA.**
   *
   * CONTRACT: with a FULL (all-1) mask the output is BYTE-IDENTICAL to the unmasked call — the mask
   * may only ever remove work, never change an answer. `bestSpotSolver.test.ts` pins that on the
   * serialised buffers.
   *
   * The monotone stack and the per-ray REACH are maintained for EVERY slot regardless of the mask:
   * a masked cell is still a sample that the cells behind it see.
   */
  scoreMask?: ArrayLike<number> | null;
}

/**
 * Sweep ONE azimuth: fill `out` with per-cell ray evidence for EVERY cell.
 *
 * `eyeHeights` is either a scalar lift (the altitude slider — the common case) or a per-cell lift
 * array (an FPV eye, or a terrain-conforming sheet). Either way the lift touches only `q_c`; the hull
 * is untouched, which is the invariant this whole module exists to preserve.
 *
 * Cost: one O(len) stack reconstruction per ray plus one O(log hull) binary peak search per cell.
 * The stack is rebuilt from `link` — pop until the top is `link[slot]`, then push — which is O(len)
 * amortised in total because every slot is pushed exactly once. MEASURED on an M-series laptop, warm:
 * ~40 ns/cell ⇒ **1.6–1.9 ms at 201²/3 m** and **14–17 ms at 601²/1 m**, against `buildHulls` at
 * 0.5 ms and 4.9 ms. The sweep, not the hull, is the expensive half — the opposite of §5's projection
 * (which had resample+hull at 2.24× the query), so the K-per-frame budget belongs here.
 */
export function sweepAzimuth(
  dsm: LocalDsm,
  hulls: RayHulls,
  azDeg: number,
  eyeHeights: number | ArrayLike<number>,
  out: RaySweepOut,
  opts: SweepOptions = {},
): RaySweepOut {
  if (hulls.ground !== dsm.ground) {
    throw new Error("horizonSweep.sweepAzimuth: hulls were built from a different DSM");
  }
  if (hulls.azDeg !== azDeg) {
    throw new Error(
      `horizonSweep.sweepAzimuth: azimuth mismatch — hulls at ${hulls.azDeg}, asked for ${azDeg}`,
    );
  }
  if (out.cellCount !== dsm.cellCount) {
    throw new Error("horizonSweep.sweepAzimuth: out buffer is sized for a different grid");
  }
  const sh = hulls.shear;
  const drop = hulls.dropPerM2;
  const dsM = sh.dsM;
  const tol = opts.openSkyTolDeg ?? 0.01;
  const nearClip = opts.nearClipM ?? 1;
  const trustRadiusM = opts.trustRadiusM ?? 3000;
  const scoreMask = opts.scoreMask ?? null;
  const scalarLift = typeof eyeHeights === "number";
  const { zs, link, ground } = hulls;
  const { surfaceSrc, floating } = dsm;
  const stack = new Int32Array(Math.max(1, sh.nx + sh.ny));
  const nFloat = hulls.maxFloatPerRay;
  const bLo = new Float64Array(Math.max(1, nFloat));
  const bHi = new Float64Array(Math.max(1, nFloat));
  const bD = new Float64Array(Math.max(1, nFloat));
  const bS = new Int32Array(Math.max(1, nFloat));

  out.azDeg = azDeg;
  out.bandUsed = 0;
  out.bandOverflow = false;
  const bandCap = out.bandLoDeg.length;
  // The dip is a function of the lift alone — hoist it for the scalar-lift case (the slider).
  const scalarDipDeg = scalarLift ? horizonDipDeg(eyeHeights, hulls.refractionK) : 0;

  for (let r = 0; r < sh.rayCount; r++) {
    const base = sh.rayStart[r];
    const len = sh.rayLen[r];
    const t0 = sh.rayT0[r];
    const fFrom = hulls.floatStart[r];
    const fTo = hulls.floatStart[r + 1];
    let stackSize = 0;
    // The FARTHEST known slot on this ray. Walking backward, the FIRST known slot we meet is the
    // largest index there is, so this is written at most once per ray and every cell behind it
    // reads its reach in O(1). (`known` here is the hull's own NaN marker on `zs` — the same
    // channel the stack uses, so the reach can never disagree with the evidence.)
    let farKnownSlot = -1;

    for (let li = len - 1; li >= 0; li--) {
      const slot = base + li;
      const cell = cellOfRayStep(sh, r, t0 + li);
      const g0 = ground[cell];
      const lift = scalarLift ? eyeHeights : eyeHeights[cell];
      const sc = li * dsM;
      // How far this cell's ray COULD have reached inside the grid, and how far it DID.
      const gridReachM = (len - 1 - li) * dsM;
      const reachM = farKnownSlot >= 0 ? (farKnownSlot - slot) * dsM : 0;

      if (scoreMask !== null && scoreMask[cell] === 0) {
        // MASKED — the collar, or anything outside the disc. Written as "no evidence" rather than
        // left stale: `out` is reused across azimuths, and a stale row from the previous azimuth is
        // exactly the kind of lie this file exists to refuse. The cost is 8 stores against a ~9-step
        // binary search plus a band assembly, which is where the measured 2.20× comes from.
        out.groundAltAppDeg[cell] = Number.NaN;
        out.groundDistM[cell] = Infinity;
        out.srcSlot[cell] = -1;
        out.groundSrc[cell] = SRC_NONE;
        out.known[cell] = 0;
        out.reachM[cell] = 0;
        out.openSky[cell] = 0;
        out.bandStart[cell] = out.bandUsed;
        out.bandN[cell] = 0;
      } else if (g0 === g0) {
        const q = g0 - drop * sc * sc + lift;
        // --- ground horizon: binary peak search over the concave hull (unimodal, see queryRay).
        let bestSlot = -1;
        let bestG = -Infinity;
        if (stackSize > 0) {
          let lo = 0;
          let hi = stackSize - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            const a = stack[stackSize - 1 - mid];
            const b = stack[stackSize - 2 - mid];
            // Slope compare by CROSS-MULTIPLICATION, not division: both step gaps are positive and
            // `dsM` cancels, so this is exact — and it removes ~18 divisions per cell from the hot
            // loop, which is ~9 binary steps × 2. Measured: it is the single biggest cost here.
            if ((zs[a] - q) * (b - slot) < (zs[b] - q) * (a - slot)) lo = mid + 1;
            else hi = mid;
          }
          bestSlot = stack[stackSize - 1 - lo];
          bestG = (zs[bestSlot] - q) / ((bestSlot - slot) * dsM);
        }
        const dipDeg = scalarLift ? scalarDipDeg : horizonDipDeg(lift, hulls.refractionK);
        if (bestSlot >= 0) {
          const alt = Math.atan(bestG + 2 * drop * sc) * RAD2DEG;
          const code = surfaceSrc[cellOfRayStep(sh, r, t0 + (bestSlot - base))];
          out.groundAltAppDeg[cell] = alt;
          out.groundDistM[cell] = (bestSlot - slot) * dsM;
          out.srcSlot[cell] = bestSlot;
          out.groundSrc[cell] = code;
          out.known[cell] = 1;
          out.reachM[cell] = reachM;
          // S3c — the reach gate. `min(...)` because no disc is 3 km wide: the honest question is
          // "did this ray get as far as it could, up to the trust radius", not "did it get 3 km".
          out.openSky[cell] =
            code === SRC_TERRAIN &&
            alt <= dipDeg + tol &&
            reachM >= (trustRadiusM < gridReachM ? trustRadiusM : gridReachM)
              ? 1
              : 0;
        } else {
          // pin 4/pin 5: no forward evidence. The value is the dip FLOOR, and `openSky` stays 0 so
          // nobody can read that floor as a measured clear horizon.
          out.groundAltAppDeg[cell] = dipDeg;
          out.groundDistM[cell] = Infinity;
          out.srcSlot[cell] = -1;
          out.groundSrc[cell] = SRC_NONE;
          out.known[cell] = 0;
          out.reachM[cell] = reachM;
          out.openSky[cell] = 0;
        }

        // --- floating bands, assembled ANALYTICALLY from the sparse list (F3), never from the hull.
        let nb = 0;
        for (let f = fFrom; f < fTo; f++) {
          const tau0 = hulls.floatTau0[f];
          const tau1 = hulls.floatTau1[f];
          const d0 = Math.max(tau0 - sc, nearClip);
          const d1 = tau1 - sc;
          if (!(d1 > d0)) continue;
          const solid = floating[hulls.floatIdx[f]];
          const eye = g0 + lift;
          const hi = maxAltDeg(solid.topM - eye, d0, d1, drop);
          const lo = minAltDeg(solid.baseM - eye, d0, d1, drop);
          if (!(hi > lo)) continue;
          bLo[nb] = lo;
          bHi[nb] = hi;
          bD[nb] = d0;
          bS[nb] = solid.src;
          nb++;
        }
        out.bandStart[cell] = out.bandUsed;
        out.bandN[cell] = 0;
        if (nb > 0) {
          // insertion sort by lo (nb is single digits) then merge overlaps → ascending, disjoint.
          for (let i = 1; i < nb; i++) {
            const l = bLo[i];
            const h = bHi[i];
            const d = bD[i];
            const s = bS[i];
            let j = i - 1;
            while (j >= 0 && bLo[j] > l) {
              bLo[j + 1] = bLo[j];
              bHi[j + 1] = bHi[j];
              bD[j + 1] = bD[j];
              bS[j + 1] = bS[j];
              j--;
            }
            bLo[j + 1] = l;
            bHi[j + 1] = h;
            bD[j + 1] = d;
            bS[j + 1] = s;
          }
          let written = 0;
          let curLo = bLo[0];
          let curHi = bHi[0];
          let curD = bD[0];
          let curS = bS[0];
          for (let i = 1; i <= nb; i++) {
            if (i < nb && bLo[i] <= curHi) {
              if (bHi[i] > curHi) curHi = bHi[i];
              if (bD[i] < curD) curD = bD[i];
              continue;
            }
            if (out.bandUsed >= bandCap) {
              out.bandOverflow = true;
              break;
            }
            out.bandLoDeg[out.bandUsed] = curLo;
            out.bandHiDeg[out.bandUsed] = curHi;
            out.bandDistM[out.bandUsed] = curD;
            out.bandSrc[out.bandUsed] = curS;
            out.bandUsed++;
            written++;
            if (i < nb) {
              curLo = bLo[i];
              curHi = bHi[i];
              curD = bD[i];
              curS = bS[i];
            }
          }
          out.bandN[cell] = written;
          if (written > 0) {
            // `known` stays the GROUND-horizon evidence flag. A band on a ray whose terrain was never
            // sampled is real geometry and is published — but `f(a)` cannot be computed without `Hg`,
            // so the sample must still be DROPPED from V rather than scored against a dip floor.
            // (The "no ground distance ⇒ borrow the band's" patch that used to live here is gone: the
            // headline occluder is resolved once, in `rayEvidenceAt`, as the NEAREST of the two
            // channels — of which "the ground has none, so the band wins" is just the Infinity case.)
            out.openSky[cell] = 0; // something floats overhead: not an open horizon
          }
        }
      } else {
        // The cell has no ground, so it has no eye. Everything about it is unknown (pin 3) — and
        // `reachM` is 0, not the ray's forward reach: a cell we cannot stand on did not look
        // anywhere. (The ray's geometry is still swept for the cells BEHIND it, below.)
        out.groundAltAppDeg[cell] = Number.NaN;
        out.groundDistM[cell] = Infinity;
        out.srcSlot[cell] = -1;
        out.groundSrc[cell] = SRC_NONE;
        out.known[cell] = 0;
        out.reachM[cell] = 0;
        out.openSky[cell] = 0;
        out.bandStart[cell] = out.bandUsed;
        out.bandN[cell] = 0;
      }

      // --- push this slot, reconstructing the persistent stack from `link` (O(1) amortised).
      if (zs[slot] === zs[slot]) {
        const target = link[slot];
        while (stackSize > 0 && stack[stackSize - 1] !== target) stackSize--;
        stack[stackSize++] = slot;
        if (farKnownSlot < 0) farKnownSlot = slot; // backward walk ⇒ the first known slot is the last
      }
    }
  }
  return out;
}

/**
 * Max apparent elevation (deg) of a horizontal surface at height `dh` above the eye, over the distance
 * span `[d0, d1]`. `tan(alt) = dh/D − drop·D` has one interior extremum at `D* = √(dh/drop)` (a MAXIMUM
 * only when `dh > 0`), so the endpoints alone are not sufficient — at a real `drop` that point sits at
 * 12 km for a 10 m deck, but a toy planet moves it inside a metre-scale test and a silently-wrong band
 * would then pass unnoticed.
 */
function maxAltDeg(dh: number, d0: number, d1: number, drop: number): number {
  let best = Math.max(tanAlt(dh, d0, drop), tanAlt(dh, d1, drop));
  if (dh > 0 && drop > 0) {
    const dStar = Math.sqrt(dh / drop);
    if (dStar > d0 && dStar < d1) best = Math.max(best, tanAlt(dh, dStar, drop));
  }
  return Math.atan(best) * RAD2DEG;
}

/** Min apparent elevation of the same surface. The interior extremum is a MINIMUM when `dh < 0`. */
function minAltDeg(dh: number, d0: number, d1: number, drop: number): number {
  let worst = Math.min(tanAlt(dh, d0, drop), tanAlt(dh, d1, drop));
  if (dh < 0 && drop > 0) {
    const dStar = Math.sqrt(-dh / drop);
    if (dStar > d0 && dStar < d1) worst = Math.min(worst, tanAlt(dh, dStar, drop));
  }
  return Math.atan(worst) * RAD2DEG;
}

function tanAlt(dh: number, d: number, drop: number): number {
  return dh / d - drop * d;
}

/**
 * Rebuild the readable `RayEvidence` for one cell — the contract shape, for tests and panels. The hot
 * loop never calls this; it exists so the parallel arrays can be PROVEN to satisfy the contract.
 *
 * **THE DECK KEEPS ITS TAG HERE (LENS B, 2026-08-24).** The two channels are published side by side —
 * `groundSrc`/`groundDistM` for the horizon, `bandSrc`/`bandDistM` for every floating solid — and the
 * ray's HEADLINE `src`/`blockerDistM` is resolved as §3.2 defines it: "the geometry that set `Hg(a)`,
 * OR the nearest band edge", i.e. whichever channel is CLOSER. Before this, `src` was bound to the
 * ground setter alone; `localDsm` deliberately keeps floating solids out of `surfaceSrc` (its pin 2),
 * so a real bridge deck published `"terrain"`, `bestSpotMetric.silTangency` early-returned on
 * `!isBuiltSrc`, and the tangency kernel written FOR the bridge could not fire on any genuine deck.
 * Measured on the F3 hero geometry: `S = 0.60799` with the deck against `0.62306` with no bridge at
 * all — the owner's hero location was scored as a pure liability.
 */
export function rayEvidenceAt(out: RaySweepOut, cell: number): RayEvidence {
  const from = out.bandStart[cell];
  const n = out.bandN[cell];
  const bands: [number, number][] = [];
  const bandSrc: OccluderSrc[] = [];
  const bandDistM: number[] = [];
  // Bands are ascending in ANGLE, not in distance, so the nearest one is found by scan, not by [0].
  let nearestBandDistM = Infinity;
  let nearestBandSrc: OccluderSrc = "none";
  for (let i = 0; i < n; i++) {
    bands.push([out.bandLoDeg[from + i], out.bandHiDeg[from + i]]);
    const s = srcName(out.bandSrc[from + i]);
    const d = out.bandDistM[from + i];
    bandSrc.push(s);
    bandDistM.push(d);
    if (d < nearestBandDistM) {
      nearestBandDistM = d;
      nearestBandSrc = s;
    }
  }
  const groundDistM = out.groundDistM[cell];
  const groundSrc = srcName(out.groundSrc[cell]);
  const bandWins = nearestBandDistM < groundDistM;
  return {
    azDeg: out.azDeg,
    groundAltAppDeg: out.groundAltAppDeg[cell],
    groundSrc,
    groundDistM,
    bands,
    bandSrc,
    bandDistM,
    blockerDistM: bandWins ? nearestBandDistM : groundDistM,
    src: bandWins ? nearestBandSrc : groundSrc,
    known: out.known[cell] === 1 ? 1 : 0,
    reachM: out.reachM[cell],
    openSky: out.openSky[cell] === 1,
  };
}
