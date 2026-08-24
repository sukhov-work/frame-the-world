/**
 * BEST SPOT — the LAYERED LOCAL SURFACE MODEL (BESTSPOT_PLAN §5 "NEAR/MID zone", slice S2b).
 *
 * A regular grid of the disc in a LOCAL ENU frame carrying, per cell: the terrain height, the
 * extruded solid mass resting on it, and the tallest tree canopy over it — plus a SPARSE list of
 * FLOATING solids (bridge decks, arches, piers) that is deliberately NOT rasterised into any of
 * those layers.
 *
 * Pure, three-free, store-free, no `Date.now()` — the `horizonProfile`/`occlusion` idiom, so it
 * imports cleanly inside the long-lived module worker (§5 "Worker interop"). Callers pass RAW typed
 * arrays and column-major matrices (`geometry.attributes.position.array`, `mesh.matrixWorld.elements`)
 * exactly as `occlusion.sweepMeshEdges` does; nothing here knows what a `Mesh` is.
 *
 * THE FIVE THINGS THIS FILE EXISTS TO PIN — each is a measured cost or a shipped-bug class:
 *
 *  1. **TERRAIN BY BARYCENTRIC INTERPOLATION, NEVER BY RAYCAST.** `ground.heightAt` is a full
 *     `three.Raycaster.intersectObjects(tiles.group.children, true)` from 12 km — measured 18–58 µs
 *     warm (F1). A 300 m disc at 1 m is 282,743 cells ⇒ 7.4–16.4 s of raycasting for a field that is
 *     supposed to be re-solvable while the owner drags a slider. Interpolating the already-loaded TIN
 *     is one cross product and three multiplies per cell.
 *
 *  2. **A FLOATING SOLID IS NOT PART OF THE SURFACE (F3).** A max-only height field cannot represent
 *     sky UNDER a deck, which makes "the sun setting behind the bridge" and "a blank 15-storey wall"
 *     the same object — and the wall then OUTSCORES an open river horizon by 4.4 %. The owner's hero
 *     location IS a bridge deck (a measured 29,054 m² deck at 48.47831,35.05757), so `floating` stays
 *     an explicit sparse list and is swept ANALYTICALLY into angular bands by `horizonSweep`.
 *
 *  3. **IGNORANCE IS NOT SEA LEVEL.** `ground` is filled with **NaN**, not 0, and `groundKnown` is the
 *     honesty channel. 0 m is a plausible-looking height (it is the Dnipro's own water level), so a
 *     zero-filled DSM turns "no TIN triangle covered this cell" into "flat ground here" — the exact
 *     shape of the bug `profileCoverage` exists to prevent on the shipped profile. NaN propagates
 *     through every downstream arithmetic and is tested by `Number.isNaN`, so it cannot be laundered.
 *
 *  4. **VEGETATION IS FICTION AT THE INDIVIDUAL LEVEL (§8).** 151,046 of Dnipro's 161,823 canopies are
 *     SEEDED SCATTER with jittered class-default heights; only 628 are surveyed points, and outside
 *     the two baked cities there are none at all. Canopies therefore land in their own layer with
 *     their own `SRC_TREE` tag so a tree-set horizon is always identifiable downstream and can be
 *     applied as a SOFT penalty. `sealDsm({ includeCanopy: false })` removes them from the surface
 *     entirely, which is what makes "what would the horizon be without the tree" answerable.
 *
 *  5. **ENU `up` ALREADY CONTAINS THE EARTH'S FALL-AWAY — DO NOT COUNT IT TWICE.** A point 600 m from
 *     the frame origin sits 0.0283 m BELOW the tangent plane by pure geometry, and the apparent-
 *     elevation term the sweep subtracts is `d²(1−k)/2R` = 0.0246 m at the same range: the two are the
 *     same size. `ground` is therefore stored as height above the local SPHERE (`u + r²/2R`), the datum
 *     `marchTerrainBin` and `horizonProfile`'s formula are written in. `azAltOfEcef`'s docblock records
 *     the twin of this rule from the other side ("ECEF→ENU is EXACT geometry … only the refraction
 *     lift `k·d²/2R` is added").
 *
 * BUILD ORDER IS A CONTRACT: `createLocalDsm` → `rasterizeTinGround` → `stampSolid` → `addCanopy` /
 * `addFloatingSolid` → `sealDsm`. Solid stamps in the `aboveGround` datum read `ground`, and
 * `surfaceTop`/`surfaceSrc` are derived once by `sealDsm`. Every mutator clears `sealed`, and
 * `horizonSweep.buildHulls` refuses an unsealed DSM rather than silently sweeping stale tops.
 */

import type { OccluderSrc } from "./bestSpotTypes";
import { R_MEAN_M } from "./horizonProfile";
import { ecefToGeodetic, enuBasis, geodeticToEcef } from "./projection";

// ---------------------------------------------------------------------------------------------
// Source tags — the numeric twin of `OccluderSrc`
// ---------------------------------------------------------------------------------------------

/** Nothing set this cell/ray. */
export const SRC_NONE = 0;
/** Bare terrain (the interpolated TIN). */
export const SRC_TERRAIN = 1;
/** Extruded building mass resting on the ground. */
export const SRC_BUILDING = 2;
/** A tree canopy — SOFT ONLY (pin 4); never a hard block. */
export const SRC_TREE = 3;
/** A FLOATING solid: bridge deck, arch, pier (pin 2). */
export const SRC_DECK = 4;

/** Parallel to the `SRC_*` codes; index with a code to get the `OccluderSrc` the contract names. */
export const SRC_NAMES: readonly OccluderSrc[] = ["none", "terrain", "building", "tree", "deck"];

/** Code → the `OccluderSrc` string `RayEvidence.src` / `CellScore.srcStar` carry. */
export function srcName(code: number): OccluderSrc {
  return SRC_NAMES[code] ?? "none";
}

// ---------------------------------------------------------------------------------------------
// Frames and grids
// ---------------------------------------------------------------------------------------------

/**
 * A local East-North-Up frame. Structurally the prefix of `horizonProfile.SilhouetteFrame`, so a
 * caller that already built one for the skyline sweep can pass it straight in — but this module has
 * no use for `refractionK` (curvature enters in `horizonSweep`, once, before the hull).
 *
 * Build it with `enuFrameAt` at the disc centre — never by hand, and never twice per site.
 */
export interface EnuFrame {
  /** Frame origin in ECEF metres. `ground` heights are measured against the sphere through it. */
  originEcef: readonly [number, number, number];
  east: readonly [number, number, number];
  north: readonly [number, number, number];
  up: readonly [number, number, number];
}

/**
 * THE frame constructor for a site — `projection.geodeticToEcef` + `projection.enuBasis`, once.
 *
 * **NAMED BUG CLASS — TWO FRAMES THAT LOOK ALIKE** (found 2026-08-24 by the adversarial math review;
 * this docstring exists so the next audit reads the single constructor as intentional). The landcover
 * raster projected its MVT rings with the equirectangular idiom — `Δlon · 111_320 · cos φ`,
 * `Δlat · 111_320` — while the DSM, the hull sweep and every terrain vertex were built by dotting ECEF
 * deltas against THIS basis. The two are not the same frame. Measured at Dnipro (48.4647, 35.0462):
 * 111_320 vs the true **111_199** m/deg lat and 73_810 vs the true **73_952** m/deg lon, i.e. a
 * SYSTEMATIC SCALE BIAS, not noise — 0.94 m east at 500 m, 0.54 m north at 500 m, 1.42 m at the 700 m
 * collar, 1.87 m at 1 km. The plan advertises accessibility at 1 m (§8), so the mask and the
 * obstruction field were misregistered by one to two cells at the rim. It is WORSE away from Dnipro:
 * 2.67 m at Sydney, and 4.72 m at the EQUATOR — where the latitude factor is at its most wrong
 * (110_574 m/deg), not its least. Both grids now start here, so there is one frame per site by
 * construction and it cannot drift.
 */
export function enuFrameAt(latDeg: number, lonDeg: number, altM = 0): EnuFrame {
  const { east, north, up } = enuBasis(latDeg, lonDeg);
  return { originEcef: geodeticToEcef(latDeg, lonDeg, altM), east, north, up };
}

/**
 * Geodetic → this frame's ENU PLAN VIEW (east, north) in metres: ECEF, then the same two dot products
 * `rasterizeTinGround` already applies to every TIN vertex.
 *
 * **ANTIMERIDIAN — SOLVED BY CONSTRUCTION, NOT BY A WRAP.** Longitude reaches the answer only through
 * `cos`/`sin`, which are periodic, so a disc straddling ±180° needs no Δlon normalisation: from a
 * centre at lon 179.999 a point at lon −179.999 reads **+222 m**, not the −40_074_977 m the subtracted
 * form returned. There is no delta-longitude left in this module to forget to wrap.
 *
 * `up` is dropped on purpose — a raster is a plan view, and the MVT rings this projects are plan-view
 * outlines with no z (landcoverRaster header pin 2). The point is likewise taken ON the ellipsoid: the
 * lean a real altitude would add is `h·r/R`, 11 mm for a 100 m-high point at a 700 m rim, and the same
 * bound applies to a frame whose own origin was lifted.
 *
 * COST, measured (M3 Pro): **27 ns/vertex** over 200 k points, and only RING VERTICES pay — the fill
 * and the ribbons run in local metres. The committed Dnipro z14 fixture carries 4,781 ring vertices,
 * so the whole projection is **0.13 ms of a 3.25 ms** 501²-at-1 m build (4 %); extrapolating §4's own
 * measurement (13,383 building rings + 5,741 road lines ⇒ ~200 k vertices) puts it at ~5 ms of the
 * 31 ms there. It is a T0 cost either way, paid once per centre or radius change and never on a scrub
 * or a lift. Do NOT "optimise" it back into a linear per-site form: that IS the bug named above.
 */
export function enuOfLonLat(frame: EnuFrame, lonDeg: number, latDeg: number): [number, number] {
  const p = geodeticToEcef(latDeg, lonDeg, 0);
  const dx = p[0] - frame.originEcef[0];
  const dy = p[1] - frame.originEcef[1];
  const dz = p[2] - frame.originEcef[2];
  return [
    dx * frame.east[0] + dy * frame.east[1] + dz * frame.east[2],
    dx * frame.north[0] + dy * frame.north[1] + dz * frame.north[2],
  ];
}

/**
 * The exact inverse of `enuOfLonLat` — walk the tangent plane, read the geodetic point back.
 *
 * The walked point sits `r²/2R` above the ellipsoid (28 mm at 600 m), and `ecefToGeodetic` drops that
 * altitude along the local normal; the horizontal error that projection introduces is `r³/2R²` — 4 µm
 * at 700 m. Round-trips through `enuOfLonLat` to ~1e-5 m at 1 km, which is Bowring's two refinements,
 * not the frame.
 */
export function lonLatOfEnu(
  frame: EnuFrame,
  eastM: number,
  northM: number,
): { lonDeg: number; latDeg: number } {
  const g = ecefToGeodetic([
    frame.originEcef[0] + eastM * frame.east[0] + northM * frame.north[0],
    frame.originEcef[1] + eastM * frame.east[1] + northM * frame.north[1],
    frame.originEcef[2] + eastM * frame.east[2] + northM * frame.north[2],
  ]);
  return { lonDeg: g.lonDeg, latDeg: g.latDeg };
}

/** Grid geometry of the disc raster. Cell `(ix, iy)` centre is `(originE + ix·cellM, originN + iy·cellM)`. */
export interface LocalDsmSpec {
  nx: number;
  ny: number;
  /** Cell pitch (m). 3 by default, 1 under ULTRA, 6 on the mid tier (§8, owner ruling R3). */
  cellM: number;
  /** ENU east/north (m) of cell (0,0)'s CENTRE. Defaults centre the grid on the frame origin. */
  originE?: number;
  originN?: number;
}

/**
 * Cell count across `±halfSpanM` at `cellM`, forced ODD — THE grid-parity rule, and the ONLY place it
 * is decided for either raster of the disc.
 *
 * **NAMED BUG CLASS — TWO GRIDS THAT LOOK ALIKE** (found 2026-08-24, same review as `enuFrameAt`).
 * `discGridSpec` deliberately forced an odd count so the centre pin lands on a cell CENTRE, while
 * `landcoverRaster.makeLandGrid` used `ceil(2·halfSpan/cellM)` — which is EVEN for every canonical
 * spec in §8's ladder (700 m @ 1 m → 1400, 700 m @ 3 m → 468, 300 m @ 1 m → 600) — so the SAME disc
 * centre read as a cell CORNER at (+0.5, +0.5) m on one grid and a cell centre on the other. Odd is
 * the only parity that can hold a centre: with `n = 2h + 1` the middle index `h` sits exactly on the
 * origin. The centre cell is the one the owner is standing on and the one the plumb line is drawn
 * through, so a half-cell offset there is a half-cell lie in the primary readout.
 *
 * The span this covers is `±(h·cellM + cellM/2)` — up to one extra cell of collar beyond `halfSpanM`,
 * which is the honest direction to round in for a mask whose class boundaries already carry a 1–2 cell
 * uncertainty ribbon (§8).
 */
export function oddSpanCells(halfSpanM: number, cellM: number): number {
  return 2 * Math.max(1, Math.ceil(halfSpanM / cellM)) + 1;
}

/**
 * A grid spec covering a disc of `radiusM` at `cellM`, centred on the frame origin.
 *
 * Cell counts are ODD (`oddSpanCells`) so the centre pin lands on a cell CENTRE rather than on a cell
 * corner. 300 m @ 3 m → 201², 300 m @ 1 m → 601² (the two grids §10 measures against).
 */
export function discGridSpec(radiusM: number, cellM: number): LocalDsmSpec {
  const n = oddSpanCells(radiusM, cellM);
  const half = (n - 1) / 2;
  return { nx: n, ny: n, cellM, originE: -half * cellM, originN: -half * cellM };
}

/** One floating solid — a deck, an arch, a pier. Kept SPARSE and analytic (pin 2). */
export interface FloatingSolid {
  /**
   * Footprint centreline in local ENU metres. A deck IS a thick line: an axis-aligned box over a
   * diagonal 400 m deck would claim its whole bounding square, which is most of a 300 m disc.
   */
  e0: number;
  n0: number;
  e1: number;
  n1: number;
  /** Half of the deck's width (m), measured perpendicular to the centreline. */
  halfWidthM: number;
  /** ABSOLUTE heights in the DSM's own datum (height above the local sphere), not above ground —
   *  a deck's whole point is that the ground below it is 10 m of air and then water. */
  baseM: number;
  topM: number;
  /** Tag reported as `RayEvidence.src` when this solid frames the shot. */
  src: number;
}

/** One tree canopy, as the analytic sphere `occlusion.sweepTreeInstances` already treats it as. */
export interface CanopySphere {
  e: number;
  n: number;
  /** ABSOLUTE height of the sphere CENTRE (m). */
  centerM: number;
  radiusM: number;
}

/**
 * The layered model. Every `Float32Array` is `nx·ny` long, indexed `iy·nx + ix`.
 *
 * `ground`, `solidTop`/`solidBase` and `canopyTop` are kept SEPARATE rather than pre-maxed because
 * three different consumers need three different views: the sweep needs the max (`surfaceTop`), the
 * R1 aerial accessibility rule needs the solid INTERIOR test (`render_min_height ≤ h < render_height`
 * ⇒ `solidBase ≤ h < solidTop`), and the honesty layer needs to know whether a block was vegetation.
 */
export interface LocalDsm extends LocalDsmSpec {
  originE: number;
  originN: number;
  cellCount: number;
  /** Terrain height above the local sphere (m). **NaN where no TIN triangle covered the cell** (pin 3). */
  ground: Float32Array;
  /** 1 = a TIN triangle covered this cell. The honesty channel — read it, never trust `ground` alone. */
  groundKnown: Uint8Array;
  /** Bottom of the solid mass resting here (absolute m). Only meaningful where `solidMask` is 1. */
  solidBase: Float32Array;
  /** Top of the solid mass resting here (absolute m). */
  solidTop: Float32Array;
  solidMask: Uint8Array;
  /** `SRC_BUILDING` (or whatever the stamp declared) per stamped cell. */
  solidSrc: Uint8Array;
  /** Top of the tallest canopy sphere over this cell (absolute m). */
  canopyTop: Float32Array;
  canopyMask: Uint8Array;
  /** `max(ground, solidTop[, canopyTop])`, derived by `sealDsm`. NaN where `groundKnown` is 0. */
  surfaceTop: Float32Array;
  /** Which layer set `surfaceTop` — the exact, free replacement for "H exceeds the terrain baseline
   *  by >0.1°", a threshold on a height difference decided by ~145 m-posted terrain (§3.2). */
  surfaceSrc: Uint8Array;
  /** Sparse floating solids (pin 2). Tens per disc, so plain objects: the hot loop READS this list,
   *  it never allocates from it. */
  floating: FloatingSolid[];
  /** Sparse canopies, kept alongside the rasterised `canopyTop` so provenance survives (pin 4). */
  canopies: CanopySphere[];
  /** False until `sealDsm` derives `surfaceTop`/`surfaceSrc`; cleared by every mutator. */
  sealed: boolean;
  /** Whether the sealed surface folded canopies in. Recorded so a consumer can say so in the UI. */
  canopyInSurface: boolean;
}

export function createLocalDsm(spec: LocalDsmSpec): LocalDsm {
  const { nx, ny, cellM } = spec;
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 1 || ny < 1) {
    throw new Error(`localDsm: grid must be a positive integer size, got ${nx}x${ny}`);
  }
  if (!(cellM > 0)) throw new Error(`localDsm: cellM must be > 0, got ${cellM}`);
  const cellCount = nx * ny;
  const ground = new Float32Array(cellCount);
  // NaN, not 0 (pin 3). Float32Array has no `fill(NaN)` shortcut worth optimising here — T0 only.
  ground.fill(Number.NaN);
  const canopyTop = new Float32Array(cellCount);
  canopyTop.fill(Number.NaN);
  return {
    nx,
    ny,
    cellM,
    originE: spec.originE ?? -((nx - 1) / 2) * cellM,
    originN: spec.originN ?? -((ny - 1) / 2) * cellM,
    cellCount,
    ground,
    groundKnown: new Uint8Array(cellCount),
    solidBase: new Float32Array(cellCount),
    solidTop: new Float32Array(cellCount),
    solidMask: new Uint8Array(cellCount),
    solidSrc: new Uint8Array(cellCount),
    canopyTop,
    canopyMask: new Uint8Array(cellCount),
    surfaceTop: new Float32Array(cellCount),
    surfaceSrc: new Uint8Array(cellCount),
    floating: [],
    canopies: [],
    sealed: false,
    canopyInSurface: false,
  };
}

/** ENU east (m) of cell column `ix`'s centre. */
export function cellEast(dsm: LocalDsmSpec & { originE: number }, ix: number): number {
  return dsm.originE + ix * dsm.cellM;
}

/** ENU north (m) of cell row `iy`'s centre. */
export function cellNorth(dsm: LocalDsmSpec & { originN: number }, iy: number): number {
  return dsm.originN + iy * dsm.cellM;
}

/** Flat cell index, or -1 when outside the grid. */
export function cellIndexAt(dsm: LocalDsm, ix: number, iy: number): number {
  if (ix < 0 || iy < 0 || ix >= dsm.nx || iy >= dsm.ny) return -1;
  return iy * dsm.nx + ix;
}

/** Nearest cell to an ENU point, or -1 when outside the grid. */
export function cellAtEnu(dsm: LocalDsm, e: number, n: number): number {
  return cellIndexAt(
    dsm,
    Math.round((e - dsm.originE) / dsm.cellM),
    Math.round((n - dsm.originN) / dsm.cellM),
  );
}

// ---------------------------------------------------------------------------------------------
// Terrain — barycentric interpolation of the loaded TIN (pin 1)
// ---------------------------------------------------------------------------------------------

export interface TinRasterOptions {
  /**
   * Radius used to convert ENU `up` into height above the local sphere (pin 5). Pass `Infinity` to
   * work on a FLAT earth — the only honest way to unit-test the interpolation itself, since the
   * curvature term is 0.028 m at 600 m and would otherwise contaminate an "exact plane" assertion.
   */
  earthRadiusM?: number;
  /**
   * Plan-view triangle area (m²) below which a triangle is skipped. Streamed terrain tilesets carry
   * near-VERTICAL SKIRT triangles at every tile edge; those project to ~zero plan area and would
   * otherwise divide by a denominator at the noise floor and smear a tile's edge height across the
   * grid. 1e-6 m² is far below any real TIN facet (~145 m posting over Dnipro, §8).
   */
  minTriAreaM2?: number;
}

/** Apply a column-major 4×4 (three `Matrix4.elements`) to a point — the `occlusion.applyMat4` twin. */
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
 * Rasterise one TIN mesh into `ground` by BARYCENTRIC INTERPOLATION (pin 1). Returns the number of
 * (triangle, cell) writes — 0 means the mesh missed the disc entirely, which lets a caller account
 * its streaming honestly instead of publishing a grid of NaN as "done".
 *
 * `positions` are LOCAL vertex coords; `matrixWorld` places them in ECEF; `index` is null for
 * non-indexed geometry (consecutive vertex triples) — the exact call shape `sweepMeshEdges` takes,
 * so `planFeed`'s existing traversal can feed both from one walk.
 *
 * MERGE RULE IS **MAX**, not last-wins. Streamed tilesets keep a coarse LOD resident under a fine one
 * and the traversal order of `tiles.group.children` is not stable between frames; last-wins would
 * make the DSM — and therefore the serialised hulls, and therefore the S6 `hullBuilds` pin — depend
 * on tile arrival order. Max is order-independent, so the same scene always bakes the same bytes.
 */
export function rasterizeTinGround(
  dsm: LocalDsm,
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  matrixWorld: ArrayLike<number>,
  frame: EnuFrame,
  opts: TinRasterOptions = {},
): number {
  const R = opts.earthRadiusM ?? R_MEAN_M;
  const minArea = opts.minTriAreaM2 ?? 1e-6;
  const invTwoR = R === Infinity ? 0 : 1 / (2 * R);
  const triCount = Math.floor((index ? index.length : positions.length / 3) / 3);
  const p: [number, number, number] = [0, 0, 0];
  const e = [0, 0, 0];
  const n = [0, 0, 0];
  const h = [0, 0, 0];
  const { nx, ny, cellM, originE, originN, ground, groundKnown } = dsm;
  let writes = 0;

  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = index ? index[t * 3 + k] : t * 3 + k;
      applyMat4(matrixWorld, positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2], p);
      const dx = p[0] - frame.originEcef[0];
      const dy = p[1] - frame.originEcef[1];
      const dz = p[2] - frame.originEcef[2];
      const ee = dx * frame.east[0] + dy * frame.east[1] + dz * frame.east[2];
      const nn = dx * frame.north[0] + dy * frame.north[1] + dz * frame.north[2];
      const uu = dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2];
      e[k] = ee;
      n[k] = nn;
      // pin 5 — undo the tangent plane's fall-away so `ground` is height above the SPHERE, the
      // datum the apparent-elevation formula `h − d²(1−k)/2R` is written in.
      h[k] = uu + (ee * ee + nn * nn) * invTwoR;
    }

    // Signed plan-view area × 2. Skirts and degenerate facets fall out here.
    const den = (n[1] - n[2]) * (e[0] - e[2]) + (e[2] - e[1]) * (n[0] - n[2]);
    if (!(Math.abs(den) > 2 * minArea)) continue;

    const minE = Math.min(e[0], e[1], e[2]);
    const maxE = Math.max(e[0], e[1], e[2]);
    const minN = Math.min(n[0], n[1], n[2]);
    const maxN = Math.max(n[0], n[1], n[2]);
    const ix0 = Math.max(0, Math.ceil((minE - originE) / cellM));
    const ix1 = Math.min(nx - 1, Math.floor((maxE - originE) / cellM));
    const iy0 = Math.max(0, Math.ceil((minN - originN) / cellM));
    const iy1 = Math.min(ny - 1, Math.floor((maxN - originN) / cellM));
    if (ix1 < ix0 || iy1 < iy0) continue;

    const inv = 1 / den;
    for (let iy = iy0; iy <= iy1; iy++) {
      const N = originN + iy * cellM;
      const row = iy * nx;
      for (let ix = ix0; ix <= ix1; ix++) {
        const E = originE + ix * cellM;
        const l0 = ((n[1] - n[2]) * (E - e[2]) + (e[2] - e[1]) * (N - n[2])) * inv;
        if (l0 < -BARY_EPS) continue;
        const l1 = ((n[2] - n[0]) * (E - e[2]) + (e[0] - e[2]) * (N - n[2])) * inv;
        if (l1 < -BARY_EPS) continue;
        const l2 = 1 - l0 - l1;
        if (l2 < -BARY_EPS) continue;
        const z = l0 * h[0] + l1 * h[1] + l2 * h[2];
        const c = row + ix;
        if (groundKnown[c] === 0 || z > ground[c]) ground[c] = z;
        groundKnown[c] = 1;
        writes++;
      }
    }
  }
  dsm.sealed = false;
  return writes;
}

/** Barycentric slack. A cell centre exactly on a shared edge belongs to BOTH neighbours; the max
 *  merge then resolves it identically whichever order the triangles arrive in. */
const BARY_EPS = 1e-9;

// ---------------------------------------------------------------------------------------------
// Solids resting on the ground
// ---------------------------------------------------------------------------------------------

export interface SolidStamp {
  /** Footprint ring in local ENU metres, `[e0,n0,e1,n1,…]`. Open or closed — the last→first edge is
   *  always closed implicitly. */
  ring: ArrayLike<number>;
  /** Bottom of the mass. */
  baseM: number;
  /** Top of the mass. */
  topM: number;
  /**
   * `"aboveGround"` — MVT `render_min_height` / `render_height`, metres over the LOCAL terrain, which
   * is what the z14 building layer carries on every feature (§4e). `"absolute"` — the enriched
   * `FeatureSeat` `baseY`/`topY`, already in the DSM's own datum and CPU-authoritative by design
   * (DECISIONS.md:231-234), so it must NOT be re-based onto interpolated terrain.
   */
  datum: "aboveGround" | "absolute";
  /** `SRC_BUILDING` unless the caller knows better. */
  src?: number;
}

/**
 * Scanline-fill one footprint ring into the solid layer. Returns the number of cells stamped.
 *
 * Even-odd fill at CELL CENTRES with the half-open crossing rule `(na ≤ N) !== (nb ≤ N)`, so a vertex
 * landing exactly on a scanline is counted once rather than twice — the classic double-crossing that
 * turns a building into a stripe. Cells with no terrain stay unstamped in the `aboveGround` datum:
 * a height "10 m above nothing" is not a height (pin 3).
 *
 * Merge is MAX on `solidTop` and MIN on `solidBase` over overlapping stamps, so a building split into
 * parts by the vector tiler reads as one mass and the R1 interior test still sees a solid interior.
 */
export function stampSolid(dsm: LocalDsm, stamp: SolidStamp): number {
  const { ring } = stamp;
  const vCount = Math.floor(ring.length / 2);
  if (vCount < 3) return 0;
  const src = stamp.src ?? SRC_BUILDING;
  const { nx, ny, cellM, originE, originN, ground, groundKnown } = dsm;

  let minN = Infinity;
  let maxN = -Infinity;
  for (let v = 0; v < vCount; v++) {
    const n = ring[v * 2 + 1];
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  }
  const iy0 = Math.max(0, Math.ceil((minN - originN) / cellM));
  const iy1 = Math.min(ny - 1, Math.floor((maxN - originN) / cellM));
  if (iy1 < iy0) return 0;

  const xs: number[] = [];
  let stamped = 0;
  for (let iy = iy0; iy <= iy1; iy++) {
    const N = originN + iy * cellM;
    xs.length = 0;
    for (let v = 0; v < vCount; v++) {
      const w = (v + 1) % vCount;
      const na = ring[v * 2 + 1];
      const nb = ring[w * 2 + 1];
      if (na <= N === nb <= N) continue; // half-open `(na≤N) !== (nb≤N)`: no double count at a vertex
      const ea = ring[v * 2];
      const eb = ring[w * 2];
      xs.push(ea + ((eb - ea) * (N - na)) / (nb - na));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = iy * nx;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ix0 = Math.max(0, Math.ceil((xs[k] - originE) / cellM));
      const ix1 = Math.min(nx - 1, Math.floor((xs[k + 1] - originE) / cellM));
      for (let ix = ix0; ix <= ix1; ix++) {
        const c = row + ix;
        let base = stamp.baseM;
        let top = stamp.topM;
        if (stamp.datum === "aboveGround") {
          if (groundKnown[c] === 0) continue;
          base += ground[c];
          top += ground[c];
        }
        if (dsm.solidMask[c] === 0) {
          dsm.solidBase[c] = base;
          dsm.solidTop[c] = top;
          dsm.solidSrc[c] = src;
          dsm.solidMask[c] = 1;
        } else {
          if (base < dsm.solidBase[c]) dsm.solidBase[c] = base;
          if (top > dsm.solidTop[c]) {
            dsm.solidTop[c] = top;
            dsm.solidSrc[c] = src;
          }
        }
        stamped++;
      }
    }
  }
  dsm.sealed = false;
  return stamped;
}

/**
 * Owner ruling R1's aerial hard gate — **THE ONE IMPLEMENTATION**: at or above `AERIAL_MIN_M` a cell
 * is masked only inside a SOLID INTERIOR, `render_min_height ≤ h < render_height`. Exposed here
 * because `solidBase`/`solidTop` are the only place that pair survives — folding them into a max would
 * delete the test.
 *
 * **THE ONE DATUM RULE.** `heightAboveGroundM` is the sheet's height ABOVE THIS CELL'S GROUND (the
 * number the altitude slider carries, and the same number `accessAt` is given), while `solidBase` and
 * `solidTop` are ABSOLUTE — height above the local sphere, this module's datum for every layer. The
 * rebase `ground[cell] + h` is the whole content of this function, and it happens **here and nowhere
 * else**.
 *
 * **NAMED BUG CLASS — TWO DATUMS THAT LOOK ALIKE** (found 2026-08-24, adversarial math review).
 * `landcoverRaster.accessAt` used to take the `(solidBase, solidTop)` pair itself and compare the
 * ABOVE-GROUND sheet height straight against it. On a Dnipro cell with ground 100 m under a 30 m
 * building (absolute 100 → 130) that evaluates `10 >= 100` ⇒ false ⇒ `hard = 1`: **R1's only aerial
 * gate silently off, and a drone declared free inside every building.** It passed its own tests only
 * because every one of them used ground 0, where the two datums are identical — the check that cannot
 * fail. `accessAt` now takes the BOOLEAN this function returns; there is no longer a second place
 * where a height meets a solid envelope, so the two cannot disagree.
 *
 * Unknown ground ⇒ false, i.e. "no solid here". We cannot locate an interior without the ground it
 * rests on, and R1's aerial rule masks only what it can prove is inside a solid (pin 3: ignorance is
 * not a verdict).
 */
export function insideSolidInterior(
  dsm: LocalDsm,
  cell: number,
  heightAboveGroundM: number,
): boolean {
  if (dsm.solidMask[cell] === 0 || dsm.groundKnown[cell] === 0) return false;
  const h = dsm.ground[cell] + heightAboveGroundM;
  // Half-open on purpose: the roof is standable, so `h === solidTop` is OUTSIDE. It also makes a
  // zero-thickness envelope (base === top) empty at every height without a special case.
  return h >= dsm.solidBase[cell] && h < dsm.solidTop[cell];
}

// ---------------------------------------------------------------------------------------------
// Floating solids (sparse) and canopies (soft)
// ---------------------------------------------------------------------------------------------

/**
 * Record a floating solid. Deliberately NOT rasterised (pin 2): the whole value of a deck is the
 * SKY UNDER IT, which no single-valued height field can carry. `horizonSweep` clips each ray against
 * the footprint and emits `[lo, hi]` angular bands instead.
 */
export function addFloatingSolid(dsm: LocalDsm, solid: FloatingSolid): void {
  dsm.floating.push(solid);
  dsm.sealed = false;
}

/**
 * Stamp one canopy sphere's UPPER SURFACE into `canopyTop` and keep the sphere itself.
 *
 * The sphere model is the shipped one — `occlusion.sweepTreeInstances` already treats every baked
 * instance as a sphere at the canopy centre, so the two surfaces agree by construction rather than
 * by coincidence. Whether canopies reach the swept surface at all is `sealDsm`'s decision (pin 4).
 */
export function addCanopy(dsm: LocalDsm, canopy: CanopySphere): number {
  const { nx, ny, cellM, originE, originN, canopyTop, canopyMask } = dsm;
  const r = canopy.radiusM;
  if (!(r > 0)) return 0;
  const ix0 = Math.max(0, Math.ceil((canopy.e - r - originE) / cellM));
  const ix1 = Math.min(nx - 1, Math.floor((canopy.e + r - originE) / cellM));
  const iy0 = Math.max(0, Math.ceil((canopy.n - r - originN) / cellM));
  const iy1 = Math.min(ny - 1, Math.floor((canopy.n + r - originN) / cellM));
  const r2 = r * r;
  let stamped = 0;
  for (let iy = iy0; iy <= iy1; iy++) {
    const dn = originN + iy * cellM - canopy.n;
    const row = iy * nx;
    for (let ix = ix0; ix <= ix1; ix++) {
      const de = originE + ix * cellM - canopy.e;
      const rem = r2 - de * de - dn * dn;
      if (rem < 0) continue;
      const top = canopy.centerM + Math.sqrt(rem);
      const c = row + ix;
      if (canopyMask[c] === 0 || top > canopyTop[c]) canopyTop[c] = top;
      canopyMask[c] = 1;
      stamped++;
    }
  }
  dsm.canopies.push(canopy);
  dsm.sealed = false;
  return stamped;
}

export interface SealOptions {
  /**
   * Fold canopy tops into `surfaceTop` (tagged `SRC_TREE`), default TRUE.
   *
   * TRUE is the geometrically honest surface — a tree really is between the eye and the sun — and the
   * tag is what lets the metric treat it as a SOFT penalty (pin 4). FALSE gives the terrain+built-only
   * surface, which is how "what would this horizon be WITHOUT the fictional trees" is answered without
   * paying for a second hull. Both are one `sealDsm` call over a resident DSM; the hull build is the
   * expensive half and it is not repeated by choosing here.
   */
  includeCanopy?: boolean;
}

/**
 * Derive `surfaceTop` / `surfaceSrc` from the layers. Cheap (one pass), and it must run before any
 * sweep — `buildHulls` throws on an unsealed DSM rather than sweeping stale tops, because a stale
 * surface is invisible in every downstream number.
 */
export function sealDsm(dsm: LocalDsm, opts: SealOptions = {}): void {
  const withCanopy = opts.includeCanopy ?? true;
  const { cellCount, ground, groundKnown, solidMask, solidTop, solidSrc } = dsm;
  const { canopyMask, canopyTop, surfaceTop, surfaceSrc } = dsm;
  for (let c = 0; c < cellCount; c++) {
    if (groundKnown[c] === 0) {
      surfaceTop[c] = Number.NaN; // pin 3 — ignorance propagates, it does not become 0
      surfaceSrc[c] = SRC_NONE;
      continue;
    }
    let top = ground[c];
    let src = SRC_TERRAIN;
    if (solidMask[c] === 1 && solidTop[c] > top) {
      top = solidTop[c];
      src = solidSrc[c];
    }
    if (withCanopy && canopyMask[c] === 1 && canopyTop[c] > top) {
      top = canopyTop[c];
      src = SRC_TREE;
    }
    surfaceTop[c] = top;
    surfaceSrc[c] = src;
  }
  dsm.canopyInSurface = withCanopy;
  dsm.sealed = true;
}

/** Fraction of cells with real terrain evidence, 0..1 — the DSM's twin of `profileCoverage`. */
export function groundCoverage(dsm: LocalDsm): number {
  let n = 0;
  for (let c = 0; c < dsm.cellCount; c++) n += dsm.groundKnown[c];
  return n / dsm.cellCount;
}

/** Resident bytes of the rasterised layers (excludes the two sparse lists). §5's memory ledger is
 *  load-bearing: the `(H,D)` slab was rejected at 139 MB, so every resident array is counted. */
export function dsmBytes(dsm: LocalDsm): number {
  return (
    dsm.ground.byteLength +
    dsm.groundKnown.byteLength +
    dsm.solidBase.byteLength +
    dsm.solidTop.byteLength +
    dsm.solidMask.byteLength +
    dsm.solidSrc.byteLength +
    dsm.canopyTop.byteLength +
    dsm.canopyMask.byteLength +
    dsm.surfaceTop.byteLength +
    dsm.surfaceSrc.byteLength
  );
}
