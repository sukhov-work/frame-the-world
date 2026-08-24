/**
 * BEST SPOT — THE SOLVER KERNEL (`BESTSPOT_SPEC_V2.md` §7 S3c).
 *
 * The FUSED sweep+score pass over a whole disc, and the trivial COMPOSE pass that turns its output
 * into a score field. Pure, three-free, store-free, no `Date.now()`, and — the fence that matters —
 * **it imports nothing outside `lib/geo/**`.** The BEST SPOT worker is long-lived, so a module-scope
 * read of `components/globe/tuning` would latch at spawn and be invisibly stale forever; the taste
 * profile and every ribbon width ride on the JOB (`SPEC_V2 §5.6`).
 *
 * =============================================================================================
 * THE ONE CONSTRAINT THIS FILE EXISTS TO HOLD: **THE FUSED PASS NEVER WRITES `S`.**
 * =============================================================================================
 * It writes a per-cell **TERM VECTOR** — 59 bytes, struct-of-arrays over ONE transferable
 * `ArrayBuffer` — and a separate ~15-multiply-add COMPOSE pass produces `S`. Retrofitting the term
 * buffer after the fact is exactly the "substantial architecture rework" the owner ruled out, and
 * the ratio it buys is the whole answer to owner requirement (vii): **RECOMPOSE is measured 1,260×
 * cheaper than the cheapest achievable re-solve** (0.272 ms against 343 ms), so every taste knob is
 * live instead of being a 490 ms rebuild.
 *
 * =============================================================================================
 * THE FOUR THINGS S3c FIXED, EACH A MEASURED DEFECT
 * =============================================================================================
 *  1. **MISSING DATA READ AS THE BEST SPOT ON THE MAP.** A disc whose DSM is truncated at 350 m
 *     scored **0.6633** where the truth is **0.0000**, reported coverage **1.000**, and claimed open
 *     sky on **all 40 rays** — indistinguishable from a genuinely open plain (0.6613). `known` meant
 *     "the ray found ≥ 1 sample", never "the ray was swept to the trust radius". `horizonSweep`'s
 *     new `reachM` channel is the missing range, `openSky` is gated on it, and `minReachM` rides in
 *     the term buffer so the panel can say it out loud. See `horizonSweep.ts`'s HONESTY CONTRACT.
 *  2. **THE COLLAR IS NOT OPTIONAL.** A rim cell 290 m up-sun scores **0.0467 with the 400 m collar
 *     and 0.6619 without** — a 14× silent error. The sweep grid is therefore
 *     `oddSpanCells(radiusM + collarM, cellM)` while the SCORED disc, the term buffer and the RG8
 *     texture are `oddSpanCells(radiusM, cellM)`. Two grids, one centre, both odd, so the offset
 *     between them is an integer and the disc centre lands on a cell CENTRE on both.
 *  3. **85.7 % OF THE SWEEP WAS WASTED.** The scored disc is 14.3 % / 24.2 % / 14.4 % of the sweep
 *     grid at the three shipped configurations. `buildScoreMask` + `SweepOptions.scoreMask` skip the
 *     per-cell peak search and band assembly outside it — measured **2.20×**, i.e. **−243 ms per
 *     solve at the default and −2.2 s at ULTRA**, for ~10 lines in a shipped, tested function.
 *  4. **AT 1 m THE HULLS ARE 899 MiB AND CANNOT BE RESIDENT.** `mode: "stream"` builds, sweeps and
 *     releases ONE azimuth's hull at a time. It therefore re-pays `buildHulls` on a lift change,
 *     which is the honest trade: ULTRA is a shortlist tool, not a field tool (§2.3).
 *
 * =============================================================================================
 * WHY THE PASS IS AZIMUTH-MAJOR, AND WHAT THAT COSTS
 * =============================================================================================
 * `cellScore` is written cell-major over a ready-made `RayEvidence[]`. A solver cannot be: holding
 * K sweep outputs resident is ~200 MB at 3 m and ~1.8 GB at 1 m. So the fused pass walks AZIMUTHS
 * and accumulates per-cell, keeping only a small RING of sweep outputs — deep enough that
 * `discVisibleFraction`'s column lookup still finds the same nearest ray `cellScore` would find
 * (`W = ceil(1.05 · maxRho / minAzStep)`, which is 1 at the shipped 0.25° lattice ⇒ 3 slots).
 *
 * Two things genuinely need the whole sweep at once, and they get exactly what they need and no
 * more: `notchAt` (the GAP kernel walks every ray for its floor, its two shoulders and its width)
 * and `shoulderQualityOf` (which prices those two shoulders through `Relief · Conf · Depth`). They
 * are served by a **SKYLINE RIBBON** — `groundAltAppDeg` + `groundDistM` + `groundSrc`, 9 B per
 * disc-cell per azimuth, laid out CELL-MAJOR so the notch's three walks are contiguous. 14.5 MB at
 * 201²/K = 40. `notchAt` itself is untouched: it is handed a reused scratch `RayEvidence[]`, so all
 * eight PIN-2 tests stay verbatim and there is no second copy of the kernel.
 *
 * The fused pass is written against the EXPORTED kernels of `bestSpotMetric` — `discVisibleFraction`,
 * `grazeSampleInto`, `notchAt`, `shoulderQualityOf`, `depthByDistance` — so it stays DIFFABLE
 * against `cellScore`, which remains the reference. `bestSpotSolver.test.ts` pins the two together
 * term by term at f32 exactness on the real composition chain.
 */

import {
  BESTSPOT_SAFETY,
  scoringHash,
  type BestSpotScoring,
  type BestSpotTermKey,
} from "./bestSpotScoring";
// `worthFromParts` is a PURE function of the two ephemeris readings the track already carries plus
// the profile — no astronomy-engine call — and calling it here is exactly what makes the whole
// `worth.*` group a RECOMPOSE (0.272 ms) instead of a REBUILD (490 ms). It lives in
// `bestSpotTrack.ts` beside the producer that stores those two numbers.
// BUNDLE NOTE (AS-BUILT open item 8, and S3d's done-check 7 measures it): this is the solver's only
// edge to a module that ALSO imports astronomy-engine. `worthFromParts` reaches only
// `moonPhaseTerm` / `twilightGate`, so the ephemeris is tree-shakeable — but "should be shaken" is
// not "was measured", and the worker-chunk measurement belongs to S3d.
import { worthFromParts, type EventTrackWorthParts } from "./bestSpotTrack";
import {
  accessSoftGain,
  clamp01,
  depthByDistance,
  discVisibleFraction,
  effectiveWorth,
  grazeFromTau,
  grazeSampleInto,
  combineShoulderQuality,
  grazeTauTotal,
  newGrazeWork,
  notchAt,
  notchFFromParts,
  shoulderQualityParts,
  smoothstep,
  visibilityGate,
  wrapDeltaDeg,
  type ColumnRayAt,
} from "./bestSpotMetric";
import type {
  BestSpotKind,
  CellAccess,
  EventTrack,
  GrazeTauSplit,
  LandClass,
  OccluderSrc,
  RayEvidence,
} from "./bestSpotTypes";
import { horizonDipDeg } from "./horizonProfile";
import {
  buildHulls,
  createSweepOut,
  hullBytes,
  sweepAzimuth,
  type RayHulls,
  type RaySweepOut,
} from "./horizonSweep";
import { LAND_CLASSES, LAND_FLAG, type LandGrid } from "./landcoverRaster";
import {
  insideSolidInterior,
  oddSpanCells,
  SRC_NAMES,
  SRC_NONE,
  type LocalDsm,
} from "./localDsm";

// ---------------------------------------------------------------------------------------------
// Disc geometry — TWO grids, one centre
// ---------------------------------------------------------------------------------------------

/**
 * The collar (m) the sweep grid carries beyond the scored disc.
 *
 * **NOT A TUNABLE AND NOT OPTIONAL** (`SPEC_V2 §3.1`). Without it a rim cell has almost no evidence
 * in front of it, `reachM` correctly reports ~10 m, and — because the open-sky gate can only ever
 * ask for `min(trustRadiusM, gridReachM)` and `gridReachM → 0` at the rim — the cell claims a clear
 * horizon anyway. Measured: a cell 290 m up-sun of a 300 m disc scores **0.0467 with the collar and
 * 0.6619 without**. The collar is what puts real geometry in front of the outermost scored cell.
 */
export const BESTSPOT_COLLAR_M = 400;

/** ULTRA's cell pitch (m), owner ruling R3. */
export const ULTRA_CELL_M = 1;

/**
 * The largest disc radius ULTRA may be asked for (m), owner ruling R8 + `SPEC_V2 §2.3`.
 *
 * 1 m at 500 m is `oddSpanCells(900, 1)` = 1801² = 3.24 M swept cells and 1,002,001 scored ones,
 * extrapolated at **~12.2 s**. `discGeometry` THROWS rather than returning it: the store is not the
 * only way into this module, and a solver reachable with an illegal configuration is a bug, not a
 * UI affordance.
 */
export const ULTRA_MAX_RADIUS_M = 300;

/** The two grids of a disc, and the integer offset between them. */
export interface DiscGeometry {
  /** SCORED grid — `oddSpanCells(radiusM, cellM)`. The term buffer and the RG8 texture are `n²`. */
  n: number;
  /** SWEEP grid — `oddSpanCells(radiusM + collarM, cellM)`. The DSM, the hulls and the LandGrid. */
  nGrid: number;
  /** `(nGrid − n) / 2` — an integer, because BOTH counts are odd (`oddSpanCells`). */
  offset: number;
  cellM: number;
  radiusM: number;
  collarM: number;
}

/**
 * Build the two grids. **This is the ULTRA gate** — see `ULTRA_MAX_RADIUS_M`.
 *
 * Both counts come from `oddSpanCells`, the ONE place grid parity is decided (`localDsm.ts:203`,
 * the named "two grids that look alike" bug class). Odd is the only parity that can hold a centre,
 * and the difference of two odd numbers is even, so `offset` is exact.
 */
export function discGeometry(
  radiusM: number,
  cellM: number,
  collarM: number = BESTSPOT_COLLAR_M,
): DiscGeometry {
  if (!(radiusM > 0)) throw new Error(`bestSpotSolver: radiusM must be > 0, got ${radiusM}`);
  if (!(cellM > 0)) throw new Error(`bestSpotSolver: cellM must be > 0, got ${cellM}`);
  assertUltraLegal(cellM, radiusM);
  const n = oddSpanCells(radiusM, cellM);
  const nGrid = oddSpanCells(radiusM + collarM, cellM);
  return { n, nGrid, offset: (nGrid - n) / 2, cellM, radiusM, collarM };
}

/** The ULTRA rule, in ONE place, called from both `discGeometry` and `solveTerms` — a hand-built
 *  `DiscGeometry` is a legal object, and "the store enforces it" is not enforcement. */
function assertUltraLegal(cellM: number, radiusM: number): void {
  if (cellM <= ULTRA_CELL_M && radiusM > ULTRA_MAX_RADIUS_M) {
    throw new Error(
      `bestSpotSolver: ULTRA (cellM ${cellM} m) is FORBIDDEN above a ${ULTRA_MAX_RADIUS_M} m ` +
        `radius — asked for ${radiusM} m ⇒ ${oddSpanCells(radiusM, cellM) ** 2} scored cells, ` +
        `extrapolated ~12.2 s (SPEC_V2 §2.3, owner ruling R8).`,
    );
  }
}

/**
 * The `scoreMask` for `sweepAzimuth` — 1 inside the disc RADIUS, 0 in the collar and in the scored
 * square's own corners.
 *
 * It is the CIRCLE and not the square: `π r² / (r + 400)²` is the measured 14.3 % / 24.2 % / 14.4 %
 * of `SPEC_V2 §2.1`, and the corners of the `n²` texture are outside the disc the plumb line is
 * drawn for. They render UNKNOWN, which is the honest reading — nobody looked.
 */
export function buildScoreMask(geo: DiscGeometry): Uint8Array {
  const mask = new Uint8Array(geo.nGrid * geo.nGrid);
  const half = (geo.nGrid - 1) / 2;
  const r2 = geo.radiusM * geo.radiusM;
  for (let iy = 0; iy < geo.nGrid; iy++) {
    const dn = (iy - half) * geo.cellM;
    const row = iy * geo.nGrid;
    for (let ix = 0; ix < geo.nGrid; ix++) {
      const de = (ix - half) * geo.cellM;
      if (de * de + dn * dn <= r2) mask[row + ix] = 1;
    }
  }
  return mask;
}

/** Cells inside a mask — the honest denominator for "% UNMAPPED", and the number §2.1 quotes. */
export function maskedCellCount(mask: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------
// The TERM BUFFER — 59 B/cell, one ArrayBuffer, one `postMessage`
// ---------------------------------------------------------------------------------------------

/**
 * 18 × f32 + 3 × u8.
 *
 * **75, NOT §5.3's 59 (S3c follow-up).** The 59 B layout stored the notch as its finished product
 * (`notchRaw`, `notchQ`), which froze `gap.salienceFloorDeg / maxDepthDeg / maxWidthDeg /
 * clearanceRadii / shoulderQuality` at solve time — while `CLASS_OF` (S3a, from `SPEC_V2 §5.4`)
 * files all five as **recompose**. The table was right and the buffer was the lie. Paying 16 B/cell
 * for the notch GEOMETRY (`notchFloorDeg`, `notchDepthDeg`, `notchWidthDeg`, `rhoStar`) and
 * splitting `notchQ` into `notchQL`/`notchQR` makes all five true.
 *
 * Cost: **3.03 MB @ 201² · 8.42 MB @ 335² · 27.1 MB @ 601²** (was 2.38 / 6.62 / 21.3). Noise
 * against 101 MiB of hulls at 3 m, and it is the difference between a documented contract and a
 * lie in a table.
 */
export const TERM_BYTES_PER_CELL = 75;

/**
 * Bits of `BestSpotTermBuffer.flags`.
 *
 * Bits 0 and 1 are DELIBERATELY the `LAND_FLAG` bits, unshifted, so the stored byte is a superset
 * of the LandGrid's own provenance byte and `access.demoteK` / `access.soft.*` stay a recompose
 * without a second encoding to keep in step.
 */
export const TERM_FLAG = {
  /** `LAND_FLAG.demoted` — `surface=unpaved` / `foot=no`. */
  demoted: 1,
  /** `LAND_FLAG.accessDenied` — painted `blocked` because of `access=no`/`private`. */
  accessDenied: 2,
  /** The SHEET is inside a solid interior here (`localDsm.insideSolidInterior`) — R1's only aerial
   *  gate. Resolved at solve time, because it needs the DSM's ABSOLUTE solid envelope and the
   *  cell's own ground (the named "two datums that look alike" bug class); `access.aerialMinM`
   *  then stays a recompose on top of the bit. */
  inSolid: 4,
  /** The disc reached half-visible at least once, so `altStar` is a CONTACT and not the track's
   *  ceiling. Without it COMPOSE cannot tell `L = 0` ("never clears") from `L` at `altStar`. */
  hasStar: 8,
  /** The contact ray reported `openSky`. `p` is stored, so this is provenance for the panel — and
   *  the reason a `p` of exactly 1 can be read as "open horizon" rather than "3 km away". */
  starOpenSky: 16,
} as const;

/**
 * The per-cell TERM VECTOR. Struct-of-arrays over ONE `ArrayBuffer` so the whole field crosses
 * `postMessage` as a single transferable — no SharedArrayBuffer, no per-field copy.
 *
 * All 14 f32 fields come first (so every view is 4-byte aligned for any `n`), then the 3 u8 fields.
 *
 * | bytes | fields |
 * |---|---|
 * | 16 | `tauTerrain, tauBuilding, tauDeck, tauTree` — already relief- and depth-weighted, with the per-source CONFIDENCE deliberately NOT applied. That omission is the entire reason `graze.conf.*` and `graze.scaleRadii` are a RECOMPOSE and not a 177 ms rescore. |
 * | 24 | `notchFloorDeg, notchDepthDeg, notchWidthDeg, rhoStar, notchQL, notchQR` — the GAP's raw GEOMETRY plus its two shoulder qualities, uncombined |
 * | 24 | `v, l, p, c, altStar, dStar` |
 * | 4 | `grazeDistM` — the max-contributing edge's own distance, for the panel copy |
 * | 4 | `minReachM` — the honesty channel |
 * | 3 | `srcStar, cls, flags` — `cls` is the `LAND_CODE` byte, so `accessAt` is recomputable |
 *
 * **THE RULE THE LAYOUT OBEYS, stated once: STORE WHAT THE TASTE KNOB IS A FUNCTION OF, NEVER THE
 * ANSWER.** Every group that `CLASS_OF` calls a recompose appears here in its PRE-TASTE form —
 * τ split by source with confidence withheld, the notch as floor/depth/width with the four gap
 * numbers withheld, the two shoulders uncombined, `altStar` rather than `L`, `cls`+`flags` rather
 * than `soft`. Store the product instead and the invalidation table quietly becomes a lie: it says
 * 0.272 ms and the buffer can only deliver a 177 ms rescore. That failure is invisible — the number
 * still moves, just via the wrong path — which is exactly why `bestSpotSolver.test.ts` perturbs
 * every one of those leaves and asserts that RECOMPOSING ALONE moves `S`.
 */
export interface BestSpotTermBuffer {
  /** Side of the SCORED square. `cellCount === n · n`. */
  n: number;
  cellCount: number;
  /** The single transferable. Every view below is a window onto it. */
  buffer: ArrayBuffer;
  tauTerrain: Float32Array;
  tauBuilding: Float32Array;
  tauDeck: Float32Array;
  tauTree: Float32Array;
  /** `notchAt(...).floorDeg` — the LOW POINT of the skyline under the disc at `az*`. */
  notchFloorDeg: Float32Array;
  /** `notchAt(...).depthDeg` = `min(sL, sR) − floor`. **`−Infinity` when a shoulder was never
   *  sampled** — ignorance is not depth, and f32 preserves that exactly. */
  notchDepthDeg: Float32Array;
  /** `notchAt(...).widthDeg`. **`Infinity` when the gap ran off the swept span** — an unbounded gap
   *  is open sky, not a frame. */
  notchWidthDeg: Float32Array;
  /** The body's angular RADIUS at `az*`. Both notch terms are scaled by it, so it has to travel. */
  rhoStar: Float32Array;
  /** `Q` of the LEFT shoulder, UNCOMBINED — see `notchQR`. */
  notchQL: Float32Array;
  /** `Q` of the RIGHT shoulder. Stored uncombined so `gap.shoulderQuality` ("min"/"mean"/"off") is
   *  a recompose rather than a decision frozen at solve time. */
  notchQR: Float32Array;
  v: Float32Array;
  l: Float32Array;
  p: Float32Array;
  c: Float32Array;
  altStar: Float32Array;
  dStar: Float32Array;
  grazeDistM: Float32Array;
  minReachM: Float32Array;
  srcStar: Uint8Array;
  cls: Uint8Array;
  flags: Uint8Array;
}

const TERM_F32_FIELDS = [
  "tauTerrain",
  "tauBuilding",
  "tauDeck",
  "tauTree",
  "notchFloorDeg",
  "notchDepthDeg",
  "notchWidthDeg",
  "rhoStar",
  "notchQL",
  "notchQR",
  "v",
  "l",
  "p",
  "c",
  "altStar",
  "dStar",
  "grazeDistM",
  "minReachM",
] as const;
const TERM_U8_FIELDS = ["srcStar", "cls", "flags"] as const;

/** Allocate a term buffer for an `n²` scored square. */
export function createTermBuffer(n: number): BestSpotTermBuffer {
  return termBufferView(n, new ArrayBuffer(n * n * TERM_BYTES_PER_CELL));
}

/**
 * Re-view a transferred `ArrayBuffer` as a term buffer. The RECEIVING side of `postMessage` calls
 * this; there is exactly one description of the layout and both sides read it.
 */
export function termBufferView(n: number, buffer: ArrayBuffer): BestSpotTermBuffer {
  const cellCount = n * n;
  if (buffer.byteLength !== cellCount * TERM_BYTES_PER_CELL) {
    throw new Error(
      `bestSpotSolver.termBufferView: buffer is ${buffer.byteLength} B, expected ` +
        `${cellCount * TERM_BYTES_PER_CELL} B for n=${n}`,
    );
  }
  const out = { n, cellCount, buffer } as BestSpotTermBuffer;
  let at = 0;
  for (const key of TERM_F32_FIELDS) {
    out[key] = new Float32Array(buffer, at, cellCount);
    at += cellCount * 4;
  }
  for (const key of TERM_U8_FIELDS) {
    out[key] = new Uint8Array(buffer, at, cellCount);
    at += cellCount;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The wire format — S4's GL sheet is written against THIS, byte for byte
// ---------------------------------------------------------------------------------------------

/** Terrain-conform lattice resolution: 65 samples = 64 quads across the disc bbox. */
export const CONFORM_N = 65;

/** The wire format between the solver and the GL sheet. One transferable ArrayBuffer per field. */
export interface BestSpotFieldPack {
  /** Odd square grid, nx === ny === n (the `oddSpanCells` parity contract). */
  n: number;
  cellM: number;
  centreLatDeg: number;
  centreLonDeg: number;
  /** Terrain height (m above the ELLIPSOID) at the disc centre — the tangent-group seat. */
  centreGroundM: number;
  radiusM: number;
  /** Sheet height above LOCAL GROUND (m). `eyeM + liftM`. */
  sheetAltM: number;
  /**
   * n*n*2 bytes, row-major, row 0 = the SOUTHERN edge, x ascending EAST.
   *  .r = score remapped into [displayLo, displayHi] and quantised to a byte
   *  .g = the ORDINAL standability axis, 4 levels: 0 UNKNOWN · 85 INACCESSIBLE (A_hard=0)
   *       · 170 SCORED-not-groundReachable · 255 SCORED-reachable
   *       (ordinal so LinearFilter can only ever land BETWEEN two adjacent classes)
   */
  rg8: Uint8Array;
  /** Terrain conform lattice: CONFORM_N² samples of ground height (m above the ELLIPSOID) on a
   *  regular lattice spanning the disc bbox, row 0 = SOUTH. Null when the DSM had no coverage. */
  conformN: number; // 65 — 64 quads
  conformM: Float32Array | null;
  /**
   * The score window `.r` was quantised over — `r = round(255 · clamp01((S − displayLo)/(displayHi
   * − displayLo)))`.
   *
   * **ECHOED ON THE PACK ON PURPOSE (S3c follow-up).** These two rode as module constants here
   * while `BESTSPOT.displayLo/displayHi` carried the same pair in `tuning.ts`, so `.r` was
   * quantised with one copy and de-quantised by the sheet with the other — and a taste pass on
   * either silently shifted every contour on the map. The solver may not import
   * `components/globe/tuning` (the worker fence, §5.6), so the range RIDES THE JOB exactly like the
   * scoring profile: the feed passes `BESTSPOT.displayLo/displayHi` into `ComposeContext`, and the
   * effective values come back here so the sheet reads what was actually used rather than what it
   * assumes was used. `DISPLAY_LO`/`DISPLAY_HI` remain only as the shipped default for pure tests.
   */
  displayLo: number;
  displayHi: number;
  /** Honesty readouts for the panel. */
  coverage: number;
  unmappedFrac: number;
  minReachM: number;
  scoringHash: string;
}

/**
 * The four ORDINAL levels of `rg8.g`, and they are ordinal on purpose: `LinearFilter` between two
 * texels can only ever land BETWEEN two adjacent classes, so a filtered sample can never invent a
 * verdict the solver did not emit. (A `NearestFilter` regression is invisible on `.g` and blocky on
 * `.r`, which is why S4's done-check reads the LIVE material.)
 */
export const STAND_G = {
  unknown: 0,
  inaccessible: 85,
  scoredNotGroundReachable: 170,
  scoredReachable: 255,
} as const;

/**
 * The SHIPPED DEFAULT score window the RG8 red channel is quantised over (`SPEC_V2 §6`, where both
 * are UNVERIFIED — they come from the AS-BUILT hero numbers, not from a solved disc, and they are
 * exactly the two numbers a taste pass moves first).
 *
 * **A DEFAULT, NOT THE VALUE.** The live pair rides the JOB (`ComposeContext.displayLo/displayHi`,
 * fed from `BESTSPOT.displayLo/displayHi`) and is echoed on `BestSpotFieldPack` so the sheet
 * de-quantises with the numbers the solver actually used. These constants exist so the pure tests
 * stay self-contained — the kernel must be reproducible from a fixture with no tuning import.
 */
export const DISPLAY_LO = 0.15;
export const DISPLAY_HI = 0.9;

// ---------------------------------------------------------------------------------------------
// The terrain conform lattice — AND THE DATUM
// ---------------------------------------------------------------------------------------------

/**
 * `CONFORM_N²` ground heights **above the ELLIPSOID**, on a regular lattice spanning the DISC bbox,
 * row 0 = SOUTH. `null` when the DSM has no coverage at all.
 *
 * =============================================================================================
 * **THE DATUM, MEASURED — because it is load-bearing and the obvious reading of it is wrong.**
 * =============================================================================================
 * `localDsm.ground` is documented as "height above the local SPHERE", stored as `u + r²/2R`
 * (`localDsm.ts:41-47`, pin 5). It is tempting to read that as "not the ellipsoid, so subtract the
 * `r²/2R` back off before it leaves the solver". **That is the wrong correction and it would put
 * the rim 38 mm low at 700 m.** The `r²/2R` term is precisely the UNDO of the ENU tangent plane's
 * fall-away, and the local sphere through the frame origin IS the ellipsoid to second order — so
 * `ground` is already an ellipsoid-referenced height, measured from the FRAME ORIGIN's own
 * geodetic altitude.
 *
 * MEASURED (this repo, `enuFrameAt(48.4647, 35.0462, a0)` + `rasterizeTinGround` over a TIN whose
 * vertices sit at geodetic altitude 137 m):
 *
 * | frame origin `a0` | `ground` at the centre | `ground` at the 700 m rim |
 * |---|---|---|
 * | 0 m | **137.0006** | **137.0006** |
 * | 137 m | **0.0006** | **0.0006** |
 *
 * i.e. `heightAboveEllipsoid = ground + frameAltM`, flat to 0.6 mm across the whole disc (the
 * residual is the ellipsoid-vs-`R_MEAN` curvature difference interpolated over a 2 km test
 * triangle, not the datum). **So the conversion is `+ frameAltM`, and the trap is forgetting the
 * frame origin's own altitude — not the curvature term.** `bestSpotSolver.test.ts` pins both
 * directions: it fails if `frameAltM` is dropped AND it fails if `r²/2R` is subtracted.
 *
 * HOLES. A lattice point over unmapped ground is filled from its nearest mapped neighbour rather
 * than left NaN. That is not a claim about height: the drape has to be a manifold surface or three
 * cannot build a mesh at all, and IGNORANCE IS REPORTED ON THE SCORE CHANNEL — `rg8.g === 0`,
 * UNKNOWN ink — which is where this feature has always said it belongs.
 *
 * =============================================================================================
 * **THE SPAN IS `n · cellM` — THE TEXEL FOOTPRINT — NOT `(n−1)·cellM` AND NOT `2·radiusM`.**
 * =============================================================================================
 * "Spanning the disc bbox" has three readings and only one of them registers the score texture to
 * the mesh. With `LinearFilter` and standard UVs, texel `i` samples at `u = (i + 0.5)/n`; over a
 * quad of width `n·cellM` centred on the disc that lands at ENU east `(i − (n−1)/2)·cellM`, which
 * is EXACTLY cell `i`'s own centre. The mapping is exact, for every `i`, with no epsilon.
 *
 * The other two readings are half-cell lies:
 *  · `(n−1)·cellM` (first cell CENTRE to last cell CENTRE) leaves the mesh half a cell short on
 *    every side, so every texel samples `cellM/2` off its own cell — **1.5 m at the R3 default**.
 *    It does not read as a blur; it reads as contours sliding off building flanks, which survives a
 *    screenshot because the map underneath moves with it.
 *  · `2·radiusM` is not even commensurate: `oddSpanCells(300, 3)` is 201, so `n·cellM` is 603 m
 *    against 600 m, and the error is not a constant fraction of a cell.
 *
 * Confirmed against `scene/bestSpotSheet.ts` (S4), which builds its quad at `n · cellM`.
 */
export function buildConformLattice(
  dsm: LocalDsm,
  geo: DiscGeometry,
  frameAltM: number,
): Float32Array | null {
  const out = new Float32Array(CONFORM_N * CONFORM_N).fill(Number.NaN);
  // ── THE FOOTPRINT: `n · cellM`, i.e. the outer EDGE of the outer texels. See the docstring.
  const halfM = conformHalfSpanM(geo);
  const span = CONFORM_N > 1 ? (2 * halfM) / (CONFORM_N - 1) : 0;
  const discHalf = (geo.n - 1) / 2;
  let known = 0;
  for (let jy = 0; jy < CONFORM_N; jy++) {
    const nM = -halfM + span * jy;
    // Nearest cell of the DISC, clamped there and only then offset into the sweep grid. The outer
    // lattice points sit half a cell OUTSIDE the outer cell centres (that is the whole footprint
    // argument above), and `Math.round` breaks a .5 tie toward +∞ — so clamping to the disc is what
    // keeps the drape SYMMETRIC and keeps it covering exactly the texture's own footprint instead
    // of reaching one cell into the collar on the north and east edges only.
    const iy = clampIndex(Math.round(nM / geo.cellM + discHalf), geo.n) + geo.offset;
    for (let jx = 0; jx < CONFORM_N; jx++) {
      const eM = -halfM + span * jx;
      const ix = clampIndex(Math.round(eM / geo.cellM + discHalf), geo.n) + geo.offset;
      const g = dsm.ground[iy * geo.nGrid + ix];
      if (g === g) {
        out[jy * CONFORM_N + jx] = g + frameAltM; // ← THE DATUM. See the docstring.
        known++;
      }
    }
  }
  if (known === 0) return null;
  if (known < out.length) dilateNaN(out, CONFORM_N);
  return out;
}

/**
 * Half-width (m) of the conform lattice AND of the score texture's quad — `n · cellM / 2`.
 *
 * Exported so `scene/bestSpotSheet.ts` sizes its quad from THE SAME expression rather than from a
 * second reading of the same sentence. One number, one home; a disagreement here is a half-cell
 * registration error that a screenshot cannot catch.
 */
export function conformHalfSpanM(geo: Pick<DiscGeometry, "n" | "cellM">): number {
  return (geo.n * geo.cellM) / 2;
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/** Fill NaN holes from mapped 4-neighbours, repeatedly, until the lattice is manifold. Bounded by
 *  `CONFORM_N` sweeps over 4,225 cells, so it is microseconds and cannot loop forever. */
function dilateNaN(a: Float32Array, n: number): void {
  for (let pass = 0; pass < n; pass++) {
    let filled = 0;
    let remaining = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        if (a[k] === a[k]) continue;
        let sum = 0;
        let cnt = 0;
        if (x > 0 && a[k - 1] === a[k - 1]) (sum += a[k - 1]), cnt++;
        if (x + 1 < n && a[k + 1] === a[k + 1]) (sum += a[k + 1]), cnt++;
        if (y > 0 && a[k - n] === a[k - n]) (sum += a[k - n]), cnt++;
        if (y + 1 < n && a[k + n] === a[k + n]) (sum += a[k + n]), cnt++;
        if (cnt > 0) {
          a[k] = sum / cnt;
          filled++;
        } else remaining++;
      }
    }
    if (remaining === 0 || filled === 0) return;
  }
}

// ---------------------------------------------------------------------------------------------
// The fused pass
// ---------------------------------------------------------------------------------------------

/** How the K hulls are held. */
export type HullResidency = "resident" | "stream";

export interface SolveInput {
  /** The layered surface over the SWEEP grid (`geo.nGrid²`), sealed. */
  dsm: LocalDsm;
  /** The landcover raster over the SAME grid — one frame per site (`localDsm.enuFrameAt`). */
  land: LandGrid;
  track: EventTrack;
  geo: DiscGeometry;
  /** Eye height above the cell's ground (m). */
  eyeM: number;
  /** Sheet lift above the cell's ground (m). */
  liftM: number;
  /** `PLAN.refractionK`. BESTSPOT_PHYSICS — folded into the hull's drop, `L`'s dip anchor and the
   *  track's dip, and those three must agree. */
  refractionK: number;
  scoring: BestSpotScoring;
  /** Geodetic altitude (m) the `EnuFrame` behind `dsm`/`land` was built at. THE DATUM BRIDGE —
   *  see `buildConformLattice`. Default 0, which is `enuFrameAt`'s own default. */
  frameAltM?: number;
  /**
   * `"resident"` (default) keeps all K hulls so a lift change is a re-sweep; `"stream"` builds and
   * releases ONE at a time and re-pays `buildHulls` on every lift change. At 1 m the hulls are
   * 899 MiB at K = 40 and streaming is the only option (`horizonSweep`'s ledger).
   */
  mode?: HullResidency;
  /** Hulls from a previous solve at the same centre/radius — the T1 tier. One per track sample, in
   *  sample order. Ignored in `"stream"` mode. */
  hulls?: readonly RayHulls[] | null;
  /** Total floating-solid bands across ALL cells of one azimuth. Defaults to `cellCount / 4` when
   *  the DSM has floating solids and 0 when it does not. */
  bandCapacity?: number;
  earthRadiusM?: number;
  /** Reuse a term buffer across solves (the ladder re-climbs at four resolutions). */
  terms?: BestSpotTermBuffer;
  /**
   * REFUSE any cell whose `minReachM` falls below this (m), rendering it UNMAPPED instead of
   * scoring it. **Default 0 — OFF.**
   *
   * `reachM` + the `openSky` gate make a truncated disc *cheaper*, not *silent*: measured on the
   * §3.1 fixture the truncated centre cell falls 0.6633 → 0.5530 against a truth of 0.0000 and an
   * open plain's 0.6620, because `P` loses its open-sky credit while `V` and `L` are still computed
   * from evidence that stopped 347 m out. §3.4 item 5 mandated the CHANNEL and the gate, and that
   * is what ships ON.
   *
   * This is the policy on top of it, and it is a policy — "how far must a cell have looked before
   * its answer is worth painting" is a product judgement, not a geometric fact, so it is named,
   * defaulted off, and left for S7 to turn on WITH A MEASUREMENT rather than a rewrite.
   *
   * **MEASURED, and the calibration is the part that matters: THE CEILING IS `BESTSPOT_COLLAR_M`.**
   * On a fully-mapped disc a RIM cell's up-sun reach is bounded by the collar — it has 400 m of
   * evidence in front of it and no more — so a threshold above the collar refuses the rim of a disc
   * with nothing wrong with it. On a fully-mapped 300 m disc (31,417 scored cells): 200 m → 0
   * refused, 380 m → 0, **400 m → 0**, 420 m → 175, 500 m → 3,027. At the safe ceiling of 400 m on
   * the §3.1 truncation fixture the centre cell goes `0.5530 → 0.0000`, `verdict: unknown`,
   * `rg8.g = 0`, and `unmappedFrac` reads 0.879 — the disc says "I did not look" instead of
   * quietly scoring 88 % of itself off 347 m of evidence.
   */
  refuseBelowReachM?: number;
  /**
   * **S7 — THE BUILT-DENSITY PRIOR. `false` means "no building survey covers this disc".**
   *
   * `SPEC_V2 §3.2` case 3, the plan's own "single most dangerous failure mode in the feature":
   * `parseTile` does `if (!layer) continue`, so **"tile fetched, zero buildings" is byte-identical
   * to "OSM never surveyed here"** — and a terrain-only rural disc measured `scored`, C = 1.000,
   * V = 1.000, L = 1.000, P = 1.000, openSky 40/40 and **S = 0.470 (0.661 over `green`)**: uniform,
   * warm, confident, reporting 100 % coverage.
   *
   * **WHAT THIS FLAG DOES, AND WHY IT IS THE COVERAGE CHANNEL AND NOT A SCORE PENALTY.** UNKNOWN
   * is a render class and never a low score (`bestSpotTypes`), so the prior may not multiply `S`
   * down — it has to withdraw the CLAIM. `openSky` is exactly the claim that needs building data:
   * `horizonSweep` sets it when the ray's setter is TERRAIN at or below the eye's own dip, i.e.
   * "nothing stands between you and the horizon". With no survey behind it that sentence is not a
   * measurement, so the ray is **not credited as evidence** — `known` is withheld, `C` falls, and
   * the cell lands in the UNKNOWN render class through the machinery that already exists.
   *
   * A ray whose horizon is set by REAL RELIEF is untouched, which is the whole reason Everest and
   * a flat rural pin come back differently from ONE rule: Everest's rays are not `openSky` (a
   * measured ridge sets them), so the disc still scores, terrain-only, with real relief.
   *
   * Default `true` — the prior is OFF unless the caller measured the density and says otherwise.
   * The FLOOR that decides it is a product judgement and lives in `BESTSPOT.builtDensityFloorPerKm2`
   * with its derivation; the solver is handed the verdict, never the threshold.
   */
  builtEvidence?: boolean;
}

/**
 * Why the solver painted nothing.
 *
 * `"no-landcover"` — the `LandGrid` has ZERO painted cells. **That is not "a rural site", it is
 * "no source was parsed"** (`SPEC_V2 §3.2` case 2): `vectorTiles` caches a failed fetch as
 * permanently `"failed"`, `buildLandGrid` with zero sources costs 0.03 ms and returns every cell
 * `unknown` — and `unknown` carries **`hard = 1`** (verified `landcoverRaster.ts:182`). So the
 * WATER MASK DISAPPEARS and the top-K would happily rank a cell in the middle of the Dnipro. A
 * genuinely rural disc is not this case: Everest's 3×3 z14 ring still paints 13 green features and
 * rural UA paints 7 water + 26 lines; only a fetch failure paints nothing at all.
 *
 * The response is to render the whole disc UNMAPPED, never to throw: UNKNOWN is a render class the
 * surface already knows how to draw, and a thrown solve is a blank screen with no explanation.
 */
export type SolveRefusal = "no-landcover";

export interface SolveResult {
  terms: BestSpotTermBuffer;
  /** Non-null when the whole disc was refused — every cell is UNMAPPED. See `SolveRefusal`. */
  refusal: SolveRefusal | null;
  /** Resident hulls for the next lift change, or `null` in `"stream"` mode. */
  hulls: RayHulls[] | null;
  /** How many `buildHulls` calls this solve paid — S6's residency pin reads this. */
  hullBuilds: number;
  /** Largest resident hull bytes at any instant. In `"stream"` mode this is ONE azimuth. */
  peakHullBytes: number;
  /**
   * `max over the swept WINDOW of Δα_i/ρ_i` — how coarsely the dwell integral was sampled.
   *
   * A property of the TRACK, so it is one number for the disc rather than a 15th f32 in the term
   * buffer. `cellScore` reports the same maximum taken over each cell's KNOWN window samples, so
   * this is that value's upper bound and the two agree for any cell with full coverage. Above
   * `GRAZE_STEP_TRUST_RADII` (2) the framing term is UNDER-RESOLVED and must render UNKNOWN.
   */
  grazeStepRadii: number;
  /** Weighted evidence coverage averaged over the scored disc, 0..1. */
  coverage: number;
  /** Fraction of scored cells whose verdict is UNKNOWN at the solve-time profile. */
  unmappedFrac: number;
  /** The WORST `minReachM` over the scored disc (m) — the disc's own honesty headline. */
  minReachM: number;
  /** How many cells `refuseBelowReachM` turned UNMAPPED. 0 when the option is off (the default),
   *  so S7 can measure the policy's cost before shipping it. */
  refusedShortReach: number;
  /** S7's prior, MEASURED rather than assumed: how many (cell, azimuth) visits had their `known`
   *  bit withheld because the ray claimed open sky with no building survey behind it. 0 whenever
   *  `builtEvidence` is true (the default), so the prior's cost is always readable. */
  openSkyUncredited: number;
  /** Ground height (m above the ELLIPSOID) at the disc centre. `NaN` when the centre is unmapped. */
  centreGroundM: number;
  /** `CONFORM_N²` ground heights above the ELLIPSOID, row 0 = SOUTH. Null with no DSM coverage. */
  conformM: Float32Array | null;
  /** Bytes of the two per-(cell,azimuth) side buffers the fused pass needs — the ring of sweep
   *  outputs and the skyline ribbon. Reported because at ULTRA they, not the hulls, are the
   *  resident cost, and §2.1's memory table does not mention them. */
  scratchBytes: number;
  timings: {
    hullMs: number;
    sweepMs: number;
    /** The azimuth-major accumulation half of the fused pass. */
    accumMs: number;
    /** The cell-major finish: `alt*` interpolation, the notch, and the term-buffer writes. */
    finishMs: number;
    /** `accumMs + finishMs`. */
    scoreMs: number;
    totalMs: number;
  };
}

/** A non-allocating `RayEvidence`. The hot loop runs 6.79 M times per disc; `rayEvidenceAt` builds
 *  three arrays per call, which would be 1.6 M allocations per solve at the default. */
interface EvidenceView {
  azDeg: number;
  groundAltAppDeg: number;
  groundSrc: OccluderSrc;
  groundDistM: number;
  bands: [number, number][];
  bandSrc: OccluderSrc[];
  bandDistM: number[];
  blockerDistM: number;
  src: OccluderSrc;
  known: 0 | 1;
  reachM: number;
  openSky: boolean;
}

function newEvidenceView(): EvidenceView {
  return {
    azDeg: 0,
    groundAltAppDeg: Number.NaN,
    groundSrc: "none",
    groundDistM: Infinity,
    bands: [],
    bandSrc: [],
    bandDistM: [],
    blockerDistM: Infinity,
    src: "none",
    known: 0,
    reachM: 0,
    openSky: false,
  };
}

/**
 * A PARTIAL fill, for a disc COLUMN's neighbouring ray and nothing else.
 *
 * `discVisibleFraction` reads exactly two things off a column's evidence: `known` (to decide
 * whether to use it at all) and then `unblockedSpanDeg`, which reads `groundAltAppDeg` and the
 * band EXTENTS. It never reads a tag, a distance or `openSky`. Filling the other six fields for
 * every column of every cell of every azimuth costs two string lookups and ten writes per call, ×3
 * ring slots × 1.26 M cell-azimuths — measured at roughly a fifth of the whole fused pass.
 *
 * **THE FOOTGUN, NAMED:** a view filled by this function has STALE `groundSrc` / `groundDistM` /
 * `blockerDistM` / `src` / `reachM` / `openSky` / `bandSrc` / `bandDistM`. It is safe ONLY as a
 * `columnRayAt` result. The CENTRE ray always gets the full `fillEvidence`, because `grazeSampleInto`
 * and the star bookkeeping read every one of those fields.
 */
function fillColumnEvidence(out: RaySweepOut, cell: number, ev: EvidenceView): EvidenceView {
  const from = out.bandStart[cell];
  const n = out.bandN[cell];
  if (ev.bands.length !== n) ev.bands.length = n;
  for (let i = 0; i < n; i++) {
    const tuple = ev.bands[i];
    if (tuple === undefined) ev.bands[i] = [out.bandLoDeg[from + i], out.bandHiDeg[from + i]];
    else {
      tuple[0] = out.bandLoDeg[from + i];
      tuple[1] = out.bandHiDeg[from + i];
    }
  }
  ev.groundAltAppDeg = out.groundAltAppDeg[cell];
  ev.known = out.known[cell] === 1 ? 1 : 0;
  return ev;
}

/**
 * Fill a reusable view from the flattened sweep output — `horizonSweep.rayEvidenceAt`'s arithmetic,
 * verbatim, writing into caller-owned storage instead of allocating. The two are pinned equal on
 * every field in `bestSpotSolver.test.ts`; if `rayEvidenceAt` ever changes its headline rule this
 * MUST follow, and that pin is what says so.
 */
function fillEvidence(out: RaySweepOut, cell: number, ev: EvidenceView): EvidenceView {
  const from = out.bandStart[cell];
  const n = out.bandN[cell];
  if (ev.bands.length !== n) {
    ev.bands.length = n;
    ev.bandSrc.length = n;
    ev.bandDistM.length = n;
  }
  let nearestBandDistM = Infinity;
  let nearestBandSrc: OccluderSrc = "none";
  for (let i = 0; i < n; i++) {
    const tuple = ev.bands[i];
    if (tuple === undefined) ev.bands[i] = [out.bandLoDeg[from + i], out.bandHiDeg[from + i]];
    else {
      tuple[0] = out.bandLoDeg[from + i];
      tuple[1] = out.bandHiDeg[from + i];
    }
    const s = SRC_NAMES[out.bandSrc[from + i]] ?? "none";
    const d = out.bandDistM[from + i];
    ev.bandSrc[i] = s;
    ev.bandDistM[i] = d;
    if (d < nearestBandDistM) {
      nearestBandDistM = d;
      nearestBandSrc = s;
    }
  }
  const groundDistM = out.groundDistM[cell];
  const groundSrc = SRC_NAMES[out.groundSrc[cell]] ?? "none";
  const bandWins = nearestBandDistM < groundDistM;
  ev.azDeg = out.azDeg;
  ev.groundAltAppDeg = out.groundAltAppDeg[cell];
  ev.groundSrc = groundSrc;
  ev.groundDistM = groundDistM;
  ev.blockerDistM = bandWins ? nearestBandDistM : groundDistM;
  ev.src = bandWins ? nearestBandSrc : groundSrc;
  ev.known = out.known[cell] === 1 ? 1 : 0;
  ev.reachM = out.reachM[cell];
  ev.openSky = out.openSky[cell] === 1;
  return ev;
}

/**
 * THE FUSED PASS. Sweeps every azimuth over the whole disc and writes the TERM BUFFER — never `S`.
 *
 * @throws if the DSM / LandGrid / geometry disagree, or if the configuration is illegal (the ULTRA
 *         gate — see `discGeometry`).
 */
export function solveTerms(input: SolveInput): SolveResult {
  const t0 = nowMs();
  const { dsm, land, track, geo, scoring } = input;
  // FIRST, before any other validation: an illegal configuration must be refused for BEING
  // illegal, not incidentally because two grids happened to disagree about it.
  assertUltraLegal(geo.cellM, geo.radiusM);
  if (dsm.nx !== geo.nGrid || dsm.ny !== geo.nGrid) {
    throw new Error(
      `bestSpotSolver: DSM is ${dsm.nx}×${dsm.ny}, geometry expects the SWEEP grid ${geo.nGrid}²`,
    );
  }
  if (land.nx !== geo.nGrid || land.ny !== geo.nGrid) {
    throw new Error(
      `bestSpotSolver: LandGrid is ${land.nx}×${land.ny}, geometry expects ${geo.nGrid}² — the ` +
        `mask and the obstruction field must share ONE grid (localDsm's "two grids" bug class)`,
    );
  }
  if (Math.abs(dsm.cellM - geo.cellM) > 1e-9) {
    throw new Error(`bestSpotSolver: DSM cellM ${dsm.cellM} ≠ geometry cellM ${geo.cellM}`);
  }

  const samples = track.samples;
  const K = samples.length;
  if (K < 2) throw new Error(`bestSpotSolver: track has ${K} samples, need at least 2`);

  const terms = input.terms ?? createTermBuffer(geo.n);
  if (terms.n !== geo.n) {
    throw new Error(`bestSpotSolver: term buffer is n=${terms.n}, geometry is n=${geo.n}`);
  }

  // ── THE REFUSAL (§3.2 case 2 / §3.4 item 6). Checked BEFORE any work is done. ──────────────
  if (!landHasAnyPaint(land)) return refusedResult(terms, geo, dsm, input, "no-landcover");
  const discCells = terms.cellCount;
  const mask = buildScoreMask(geo);
  const mode: HullResidency = input.mode ?? "resident";
  const bandCapacity =
    input.bandCapacity ?? (dsm.floating.length > 0 ? Math.ceil(dsm.cellCount / 4) : 0);
  const sheetAltM = input.eyeM + input.liftM;
  const dipFloorDeg = horizonDipDeg(sheetAltM, input.refractionK);
  const trustRadiusM = scoring.curves.depthTrustRadiusM;
  const depthFor = depthByDistance(trustRadiusM, scoring.curves.depthNearRefM);
  const graze = scoring.graze;
  const halfDisc = scoring.gates.halfDiscFrac;
  const discColumns = scoring.quadrature.discColumns;

  // ── the ring: how many neighbouring azimuths `discVisibleFraction`'s column lookup can reach ──
  // `cellScore` walks the WHOLE ray array; the fused pass keeps a window. `W` is sized from the
  // track's own numbers so the window always contains the ray `cellScore` would have found — the
  // 1.05 covers the `1/cos(alt)` small-circle widening inside the 0–7° band this feature lives in.
  let maxRho = 0;
  let minStepDeg = Infinity;
  let prevU = 0;
  for (let i = 0; i < K; i++) {
    if (samples[i].rhoDeg > maxRho) maxRho = samples[i].rhoDeg;
    const u = i === 0 ? samples[0].azDeg : prevU + wrapDeltaDeg(samples[i].azDeg, samples[i - 1].azDeg);
    if (i > 0) {
      const d = Math.abs(u - prevU);
      if (d > 0 && d < minStepDeg) minStepDeg = d;
    }
    prevU = u;
  }
  const W = minStepDeg > 0 && minStepDeg < Infinity
    ? Math.max(1, Math.ceil((1.05 * maxRho) / minStepDeg))
    : 1;
  const ringLen = Math.min(K, 2 * W + 1);
  const ring: RaySweepOut[] = [];
  const ringView: EvidenceView[] = [];
  const ringAt = new Int32Array(ringLen).fill(-1);
  /** Which VISIT each ring slot's view was last filled for. A token beats clearing a boolean array
   *  per cell, and it cannot go stale across azimuths the way a reset flag can. */
  const ringFilledFor = new Int32Array(ringLen).fill(-1);
  for (let i = 0; i < ringLen; i++) {
    ring.push(createSweepOut(dsm.cellCount, bandCapacity));
    ringView.push(newEvidenceView());
  }
  // The COLUMN-AZIMUTH MEMO. `discVisibleFraction` asks for the same `discColumns` azimuths for
  // EVERY cell of an azimuth — they are a function of the sample's own `azDeg`, `altAppDeg` and
  // `rhoDeg`, and of nothing per-cell. Resolving them costs 2·ringLen modulo pairs each time
  // (`wrapDeltaDeg`), which at 8 columns × 1.26 M cell-azimuths is 30 M modulo pairs per solve.
  // Memoised, the first cell of each azimuth pays and every other cell scans ≤ 8 float compares.
  const memoAz = new Float64Array(64);
  const memoSlot = new Int32Array(64);
  let memoN = 0;

  // ── the skyline ribbon: what `notchAt` and `shoulderQualityOf` need, and nothing else ─────────
  // CELL-MAJOR and INTERLEAVED — `[alt, dist, srcCode]` at `(c·K + i)·3`. Two decisions, both paid
  // for by measurement:
  //  · cell-major, because the notch's three walks over K rays are then contiguous, and they run
  //    once per cell while the writes run once per cell-azimuth either way;
  //  · interleaved into ONE array rather than three parallel ones, because a cell-azimuth write
  //    then touches ONE 12-byte region instead of three cache lines 160 kB apart. At 1.26 M
  //    cell-azimuths that is the difference between ~1.3 M and ~3.8 M misses.
  // `srcCode` rides as an f32: `SRC_*` are 0..4 and exactly representable, and one array beats a
  // second index calculation.
  const ribbon = new Float32Array(discCells * K * 3);

  // ── per-cell accumulators. f64, because the term buffer's f32 quantisation must be the ONLY
  // precision loss between `cellScore` and the fused pass.
  const accWSum = new Float64Array(discCells);
  const accWKnown = new Float64Array(discCells);
  const accVNum = new Float64Array(discCells);
  const accVDen = new Float64Array(discCells);
  const accTauTerrain = new Float64Array(discCells);
  const accTauBuilding = new Float64Array(discCells);
  const accTauDeck = new Float64Array(discCells);
  const accTauTree = new Float64Array(discCells);
  const accStarIdx = new Int32Array(discCells).fill(-1);
  const accStarAlt = new Float64Array(discCells).fill(Infinity);
  const accFStar = new Float64Array(discCells).fill(Number.NaN);
  const accFLow = new Float64Array(discCells).fill(Number.NaN);
  const accFPrev = new Float64Array(discCells).fill(Number.NaN);
  // The CONTACT ray's own headline channels, captured at the instant the star moves. They are the
  // NEAREST of the ground setter and the bands (`RayEvidence` pin 5), which the ground-only ribbon
  // cannot reconstruct — and reading the ground for a cell whose contact is a bridge deck is
  // exactly the LENS B defect.
  const accStarDist = new Float64Array(discCells);
  const accStarSrc = new Uint8Array(discCells);
  const accStarOpen = new Uint8Array(discCells);
  const accBestGraze = new Float64Array(discCells);
  const accGrazeDist = new Float64Array(discCells);
  const accMinReach = new Float64Array(discCells).fill(Infinity);

  // Track-level constants (`cellScore` derives all of these from the same arrays).
  const descending = K > 1 ? samples[0].altAppDeg > samples[K - 1].altAppDeg : true;
  const winLo = Math.max(0, Math.min(K - 1, track.windowLo));
  const winHi = Math.max(winLo, Math.min(K - 1, track.windowHi));
  const altStep = new Float64Array(K);
  for (let i = 0; i < K; i++) {
    const lo = i > 0 ? i - 1 : i;
    const hi = i < K - 1 ? i + 1 : i;
    altStep[i] = hi > lo ? Math.abs(samples[hi].altAppDeg - samples[lo].altAppDeg) / (hi - lo) : 0;
  }
  let grazeStepRadii = 0;
  for (let i = winLo; i <= winHi; i++) {
    const s = samples[i].rhoDeg > 0 ? altStep[i] / samples[i].rhoDeg : 0;
    if (s > grazeStepRadii) grazeStepRadii = s;
  }

  // S7's BUILT-DENSITY PRIOR — see `SolveInput.builtEvidence`. Resolved once, read in the hot loop.
  const noBuiltEvidence = input.builtEvidence === false;
  let openSkyUncredited = 0;

  const work = newGrazeWork();
  const hullOpts = { refractionK: input.refractionK, earthRadiusM: input.earthRadiusM };
  const resident: RayHulls[] | null = mode === "stream" ? null : [];
  let hullBuilds = 0;
  let peakHullBytes = 0;
  let residentHullBytes = 0;
  let hullMs = 0;
  let sweepMs = 0;
  let accumMs = 0;
  let finishMs = 0;

  /** The column lookup, restricted to the resident ring — see `W` above for why that is exact. */
  let centreSlot = 0;
  let cellForViews = -1;
  let visitToken = 0;
  const columnRayAt: ColumnRayAt = (azDeg) => {
    let bestSlot = -1;
    for (let m = 0; m < memoN; m++) {
      if (memoAz[m] === azDeg) {
        bestSlot = memoSlot[m];
        break;
      }
    }
    if (bestSlot < 0) {
      bestSlot = centreSlot;
      let bestD = Math.abs(wrapDeltaDeg(ring[centreSlot].azDeg, azDeg));
      for (let s = 0; s < ringLen; s++) {
        if (ringAt[s] < 0 || s === centreSlot) continue;
        const d = Math.abs(wrapDeltaDeg(ring[s].azDeg, azDeg));
        if (d < bestD) {
          bestD = d;
          bestSlot = s;
        }
      }
      if (memoN < memoAz.length) {
        memoAz[memoN] = azDeg;
        memoSlot[memoN] = bestSlot;
        memoN++;
      }
    }
    if (ringFilledFor[bestSlot] !== visitToken) {
      // The CENTRE slot is always fully filled by the caller before `discVisibleFraction` runs; a
      // neighbour only ever needs the two fields `unblockedSpanDeg` reads (see the docstring).
      fillColumnEvidence(ring[bestSlot], cellForViews, ringView[bestSlot]);
      ringFilledFor[bestSlot] = visitToken;
    }
    return ringView[bestSlot] as RayEvidence;
  };

  /** Accumulate ONE azimuth into every scored cell — the fused pass, per sample. */
  const scoreSample = (j: number): void => {
    const slot = j % ringLen;
    if (ringAt[slot] !== j) return; // defensive: an overwritten ring slot cannot be scored
    const out = ring[slot];
    // Hoisted out of the cell loop: `out.known[gc]` re-reads the property on every one of the
    // 1.26 M cell-azimuth visits otherwise, and the sweep buffer is a plain object.
    const outKnown = out.known;
    const outReach = out.reachM;
    const outGroundSrc = out.groundSrc;
    const outOpenSky = out.openSky;
    const s = samples[j];
    const inWindow = j >= winLo && j <= winHi;
    const stepRadii = s.rhoDeg > 0 ? altStep[j] / s.rhoDeg : 0;
    centreSlot = slot;
    memoN = 0; // the column azimuths are a function of the SAMPLE, so the memo is per-azimuth
    for (let dy = 0; dy < geo.n; dy++) {
      const gRow = (dy + geo.offset) * geo.nGrid + geo.offset;
      const dRow = dy * geo.n;
      for (let dx = 0; dx < geo.n; dx++) {
        const gc = gRow + dx;
        if (mask[gc] === 0) continue;
        const c = dRow + dx;
        accWSum[c] += s.w;
        const reach = outReach[gc];
        if (reach < accMinReach[c]) accMinReach[c] = reach;
        // ── S7's BUILT-DENSITY PRIOR, in one line (see `SolveInput.builtEvidence`) ────────────
        // An `openSky` ray says "nothing stands between you and the horizon". With no building
        // survey over the disc that is not a measurement, so the ray is NOT credited as evidence:
        // `C` falls and the cell becomes UNKNOWN through the machinery that already exists —
        // never a low score, never a cold colour.
        let known = outKnown[gc] === 1;
        if (known && noBuiltEvidence && outOpenSky[gc] === 1) {
          known = false;
          openSkyUncredited++;
        }
        const rb = (c * K + j) * 3;

        let f = Number.NaN;
        let ev: EvidenceView | null = null;
        if (known) {
          cellForViews = gc;
          visitToken++;
          ev = fillEvidence(out, gc, ringView[slot]);
          ringFilledFor[slot] = visitToken;
          f = discVisibleFraction(
            ev as RayEvidence,
            s.altAppDeg,
            s.rhoDeg,
            discColumns,
            columnRayAt,
          );
          // The RIBBON — the GROUND channel only, which is exactly what `notchAt` and
          // `shoulderQualityOf` read. NaN marks `known = 0`, so the notch's own `known !== 1` skip
          // is reproduced without a fourth array.
          ribbon[rb] = ev.groundAltAppDeg;
          ribbon[rb + 1] = ev.groundDistM;
          ribbon[rb + 2] = outGroundSrc[gc];

          accWKnown[c] += s.w;
          if (inWindow) {
            accVNum[c] += s.w * f;
            accVDen[c] += s.w;
            grazeSampleInto(
              ev as RayEvidence,
              s.altAppDeg,
              s.rhoDeg,
              dipFloorDeg,
              f,
              graze,
              depthFor,
              work,
            );
            const contribution = work.cut * work.qBase * stepRadii;
            if (contribution > 0) {
              if (work.src === "terrain") accTauTerrain[c] += contribution;
              else if (work.src === "building") accTauBuilding[c] += contribution;
              else if (work.src === "deck") accTauDeck[c] += contribution;
              else if (work.src === "tree") accTauTree[c] += contribution;
              const weighted = contribution * (graze.conf[work.src] ?? 0);
              if (weighted > accBestGraze[c]) {
                accBestGraze[c] = weighted;
                accGrazeDist[c] = work.distM;
              }
            }
          }
        } else {
          ribbon[rb] = Number.NaN;
        }

        // `alt*`'s low-side neighbour, recorded HERE — before the star can move to `j` — because
        // the two cases are mirror images: with altitude DESCENDING the star walks forward and its
        // neighbour is the sample AFTER it (this branch); ASCENDING, the star is set once and its
        // neighbour is the sample BEFORE it (`accFPrev`, below). NaN means "unavailable", which is
        // exactly `cellScore`'s `rays[lowIdx].known === 1` guard.
        if (descending && accStarIdx[c] === j - 1) accFLow[c] = f;

        if (!known) {
          accFPrev[c] = Number.NaN;
          continue;
        }
        if (f >= halfDisc && s.altAppDeg < accStarAlt[c]) {
          accStarAlt[c] = s.altAppDeg;
          accStarIdx[c] = j;
          accFStar[c] = f;
          accFLow[c] = descending ? Number.NaN : accFPrev[c];
          const e = ev as EvidenceView;
          accStarDist[c] = e.blockerDistM;
          accStarSrc[c] = srcCodeOf(e.src);
          accStarOpen[c] = e.openSky ? 1 : 0;
        }
        accFPrev[c] = f;
      }
    }
  };

  // ── the azimuth walk ──────────────────────────────────────────────────────────────────────
  for (let i = 0; i < K; i++) {
    const az = samples[i].azDeg;
    const cached = resident && input.hulls ? input.hulls[i] : undefined;
    let hulls: RayHulls;
    if (cached && cached.azDeg === az && cached.ground === dsm.ground) {
      hulls = cached;
    } else {
      const hb = nowMs();
      hulls = buildHulls(dsm, az, hullOpts);
      hullMs += nowMs() - hb;
      hullBuilds++;
    }
    if (resident) {
      resident.push(hulls);
      residentHullBytes += hullBytes(hulls);
      if (residentHullBytes > peakHullBytes) peakHullBytes = residentHullBytes;
    } else {
      const bytes = hullBytes(hulls);
      if (bytes > peakHullBytes) peakHullBytes = bytes;
    }

    const slot = i % ringLen;
    const sw = nowMs();
    sweepAzimuth(dsm, hulls, az, sheetAltM, ring[slot], { trustRadiusM, scoreMask: mask });
    sweepMs += nowMs() - sw;
    ringAt[slot] = i;
    // STREAMING: `hulls` goes out of scope here and the 22.46 MiB/az is collectable before the next
    // `buildHulls`. That, and only that, is what makes 1 m possible at all.

    if (i >= 1) {
      const sc = nowMs();
      scoreSample(i - 1);
      accumMs += nowMs() - sc;
    }
  }
  {
    const sc = nowMs();
    scoreSample(K - 1);
    accumMs += nowMs() - sc;
  }

  // ── the cell-major finish: C, V, alt*, the notch, and the term buffer ─────────────────────
  const scFinish = nowMs();
  const notchScratch: EvidenceView[] = [];
  for (let i = 0; i < K; i++) {
    const view = newEvidenceView();
    view.azDeg = samples[i].azDeg; // a property of the TRACK — hoisted out of the cell loop
    notchScratch.push(view);
  }
  const notchRays = notchScratch as unknown as RayEvidence[];
  let coverageSum = 0;
  let unmapped = 0;
  let scored = 0;
  let discMinReach = Infinity;
  const minCoverage = scoring.gates.minCoverage;
  const refuseBelowReachM = Math.max(0, input.refuseBelowReachM ?? 0);
  let refusedShortReach = 0;

  for (let dy = 0; dy < geo.n; dy++) {
    const gRow = (dy + geo.offset) * geo.nGrid + geo.offset;
    const dRow = dy * geo.n;
    for (let dx = 0; dx < geo.n; dx++) {
      const c = dRow + dx;
      const gc = gRow + dx;
      if (mask[gc] === 0) {
        // Outside the disc: UNKNOWN, not zero. `c = 0 < minCoverage` makes COMPOSE read it as the
        // render class it is (`bestSpotTypes`: UNKNOWN is never a low score).
        terms.c[c] = 0;
        terms.minReachM[c] = 0;
        terms.cls[c] = 0;
        terms.flags[c] = 0;
        continue;
      }
      scored++;
      const wSum = accWSum[c];
      // The REFUSAL (opt-in, see `refuseBelowReachM`): a cell that did not look far enough is
      // UNMAPPED, which drives `c` below `minCoverage` and lands it in the render class it belongs
      // to. Coverage is zeroed rather than the score, because the claim being withdrawn is about
      // EVIDENCE — "we did not look", not "it is a bad spot".
      const shortReach = refuseBelowReachM > 0 && accMinReach[c] < refuseBelowReachM;
      const cCov = shortReach ? 0 : wSum > 0 ? clamp01(accWKnown[c] / wSum) : 0;
      const v = accVDen[c] > 0 ? clamp01(accVNum[c] / accVDen[c]) : 0;
      const minReach = accMinReach[c] === Infinity ? 0 : accMinReach[c];
      coverageSum += cCov;
      if (minReach < discMinReach) discMinReach = minReach;

      const starIdx = accStarIdx[c];
      let altStarDeg: number;
      if (starIdx >= 0) {
        altStarDeg = accStarAlt[c];
        const lowIdx = descending ? starIdx + 1 : starIdx - 1;
        const fLow = accFLow[c];
        if (lowIdx >= 0 && lowIdx < K && fLow === fLow) {
          const fHere = accFStar[c];
          if (fLow < halfDisc && fHere > fLow) {
            const t = (fHere - halfDisc) / (fHere - fLow);
            altStarDeg = accStarAlt[c] + (samples[lowIdx].altAppDeg - accStarAlt[c]) * t;
          }
        }
      } else {
        altStarDeg = trackCeilingAlt(samples);
      }

      // Terms that survive the UNKNOWN branch: `c`, `minReachM`, `altStar`, `v`, and the contact's
      // identity are properties of the EVIDENCE, not preferences about the cell, and the panel
      // reads them either way (`cellScore` publishes exactly this set on its unknown return).
      terms.c[c] = cCov;
      terms.minReachM[c] = minReach;
      terms.altStar[c] = altStarDeg;
      terms.v[c] = v;
      terms.dStar[c] = starIdx >= 0 ? accStarDist[c] : 0;
      terms.srcStar[c] = starIdx >= 0 ? accStarSrc[c] : SRC_NONE;
      terms.cls[c] = land.cls[gc];
      let flags = land.flags[gc] & (LAND_FLAG.demoted | LAND_FLAG.accessDenied);
      if (insideSolidInterior(dsm, gc, sheetAltM)) flags |= TERM_FLAG.inSolid;

      if (cCov < minCoverage) {
        unmapped++;
        if (shortReach) refusedShortReach++;
        terms.tauTerrain[c] = 0;
        terms.tauBuilding[c] = 0;
        terms.tauDeck[c] = 0;
        terms.tauTree[c] = 0;
        terms.notchFloorDeg[c] = 0;
        terms.notchDepthDeg[c] = -Infinity; // ignorance is not depth
        terms.notchWidthDeg[c] = Infinity;
        terms.rhoStar[c] = 0;
        terms.notchQL[c] = 0;
        terms.notchQR[c] = 0;
        terms.l[c] = 0;
        terms.p[c] = 0;
        terms.grazeDistM[c] = 0;
        terms.flags[c] = flags;
        continue;
      }

      let l = 0;
      let p = 0;
      if (starIdx >= 0) {
        flags |= TERM_FLAG.hasStar;
        l = 1 - smoothstep(dipFloorDeg, scoring.curves.lCeilDeg, altStarDeg);
        if (accStarOpen[c] === 1) {
          p = 1;
          flags |= TERM_FLAG.starOpenSky;
        } else p = depthFor(accStarDist[c]);
      }

      // ── the notch, on a reused scratch: `notchAt` is UNCHANGED (all eight PIN-2 tests) ─────
      // The GAP's raw geometry. `notchAt` measures a floor, a depth and a width; the four `gap.*`
      // numbers that turn them into `F_notch` are applied in COMPOSE, not here — that is what makes
      // them a recompose (see the term-buffer docstring).
      let notchFloorDeg = 0;
      let notchDepthDeg = -Infinity;
      let notchWidthDeg = Infinity;
      let rhoStar = 0;
      let notchQL = 0;
      let notchQR = 0;
      if (starIdx >= 0) {
        // `azDeg` is a property of the TRACK, not of the cell — it is written once, above the
        // cell loop, so the per-cell refill is four fields and not five.
        let at = c * K * 3;
        for (let i = 0; i < K; i++, at += 3) {
          const view = notchScratch[i];
          const alt = ribbon[at];
          view.groundAltAppDeg = alt;
          view.known = alt === alt ? 1 : 0;
          view.groundDistM = ribbon[at + 1];
          view.groundSrc = SRC_NAMES[ribbon[at + 2]] ?? "none";
        }
        // `notchAt` is UNCHANGED and is still handed the SOLVE-TIME profile: `gap.shoulderSpanDeg`
        // decides WHICH rays are the shoulders, so it is a rescore (`CLASS_OF` says so) and it has
        // to be applied here. Everything downstream of the three measurements is deferred.
        rhoStar = samples[starIdx].rhoDeg;
        const notch = notchAt(notchRays, starIdx, altStarDeg, rhoStar, scoring.gap);
        notchFloorDeg = notch.floorDeg;
        notchDepthDeg = notch.depthDeg;
        notchWidthDeg = notch.widthDeg;
        const q = shoulderQualityParts(notchRays, notch, dipFloorDeg, graze, depthFor);
        notchQL = q.qL;
        notchQR = q.qR;
      }

      terms.tauTerrain[c] = accTauTerrain[c];
      terms.tauBuilding[c] = accTauBuilding[c];
      terms.tauDeck[c] = accTauDeck[c];
      terms.tauTree[c] = accTauTree[c];
      terms.notchFloorDeg[c] = notchFloorDeg;
      terms.notchDepthDeg[c] = notchDepthDeg;
      terms.notchWidthDeg[c] = notchWidthDeg;
      terms.rhoStar[c] = rhoStar;
      terms.notchQL[c] = notchQL;
      terms.notchQR[c] = notchQR;
      terms.l[c] = l;
      terms.p[c] = p;
      terms.grazeDistM[c] = accGrazeDist[c];
      terms.flags[c] = flags;
    }
  }
  finishMs = nowMs() - scFinish;

  let ringBytes = 0;
  for (const r of ring) ringBytes += sweepOutBytes(r);

  return {
    terms,
    refusal: null,
    hulls: resident,
    hullBuilds,
    peakHullBytes,
    grazeStepRadii,
    coverage: scored > 0 ? coverageSum / scored : 0,
    unmappedFrac: scored > 0 ? unmapped / scored : 1,
    minReachM: discMinReach === Infinity ? 0 : discMinReach,
    refusedShortReach,
    openSkyUncredited,
    centreGroundM: centreGroundAboveEllipsoidM(dsm, input.frameAltM ?? 0),
    conformM: buildConformLattice(dsm, geo, input.frameAltM ?? 0),
    scratchBytes: ringBytes + ribbon.byteLength + terms.buffer.byteLength,
    timings: {
      hullMs,
      sweepMs,
      accumMs,
      finishMs,
      scoreMs: accumMs + finishMs,
      totalMs: nowMs() - t0,
    },
  };
}

/** Did ANY source paint this grid? `LAND_CODE.unknown === 0`, so a fresh allocation and a grid
 *  built from zero parsed tiles are byte-identical — which is precisely the ambiguity that lets a
 *  fetch failure read as "the whole disc is standable". One pass, no allocation. */
function landHasAnyPaint(land: LandGrid): boolean {
  for (let i = 0; i < land.cls.length; i++) if (land.cls[i] !== 0) return true;
  return false;
}

/** A disc that is entirely UNMAPPED: `c = 0` everywhere, so COMPOSE reads every cell as the render
 *  class UNKNOWN. Nothing is swept, so nothing can be claimed. */
function refusedResult(
  terms: BestSpotTermBuffer,
  geo: DiscGeometry,
  dsm: LocalDsm,
  input: SolveInput,
  refusal: SolveRefusal,
): SolveResult {
  new Uint8Array(terms.buffer).fill(0);
  return {
    terms,
    refusal,
    hulls: input.mode === "stream" ? null : [],
    hullBuilds: 0,
    peakHullBytes: 0,
    grazeStepRadii: 0,
    coverage: 0,
    unmappedFrac: 1,
    minReachM: 0,
    refusedShortReach: 0,
    openSkyUncredited: 0,
    centreGroundM: centreGroundAboveEllipsoidM(dsm, input.frameAltM ?? 0),
    conformM: buildConformLattice(dsm, geo, input.frameAltM ?? 0),
    scratchBytes: terms.buffer.byteLength,
    timings: { hullMs: 0, sweepMs: 0, accumMs: 0, finishMs: 0, scoreMs: 0, totalMs: 0 },
  };
}

function sweepOutBytes(o: RaySweepOut): number {
  return (
    o.groundAltAppDeg.byteLength +
    o.groundDistM.byteLength +
    o.srcSlot.byteLength +
    o.groundSrc.byteLength +
    o.known.byteLength +
    o.reachM.byteLength +
    o.openSky.byteLength +
    o.bandStart.byteLength +
    o.bandN.byteLength +
    o.bandLoDeg.byteLength +
    o.bandHiDeg.byteLength +
    o.bandDistM.byteLength +
    o.bandSrc.byteLength
  );
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

function srcCodeOf(src: OccluderSrc): number {
  const i = SRC_NAMES.indexOf(src);
  return i < 0 ? SRC_NONE : i;
}

/** The track's ceiling — what `alt*` reports when the disc NEVER reached half-visible, so the panel
 *  reads "never clears" instead of a fabricated contact altitude. `cellScore.maxAlt`'s twin. */
function trackCeilingAlt(samples: EventTrack["samples"]): number {
  let m = -Infinity;
  for (let i = 0; i < samples.length; i++) if (samples[i].altAppDeg > m) m = samples[i].altAppDeg;
  return m;
}

/** Ground at the disc centre, converted to height above the ELLIPSOID. See `buildConformLattice`
 *  for the measurement that says the conversion is `+ frameAltM`. */
function centreGroundAboveEllipsoidM(dsm: LocalDsm, frameAltM: number): number {
  const centre = ((dsm.ny - 1) / 2) * dsm.nx + (dsm.nx - 1) / 2;
  const g = dsm.ground[centre];
  return g === g ? g + frameAltM : Number.NaN;
}

// ---------------------------------------------------------------------------------------------
// COMPOSE — the term buffer → `S` → the RG8 pack
// ---------------------------------------------------------------------------------------------

/**
 * The 11-rung ladder, resolved ONCE per profile into typed arrays indexed by `LAND_CODE`.
 *
 * COMPOSE runs 40,401 times at 201² inside a 1 ms budget. A per-cell `BESTSPOT_SAFETY.groundHard[cls]`
 * is a dictionary lookup on a frozen object keyed by a dynamic string, and two of those per cell
 * measured **6.1 ms** — 22× over budget on their own.
 */
export interface AccessTables {
  /** `BESTSPOT_SAFETY.groundHard`, by `LAND_CODE`. Never from `scoring` — there is no key path. */
  hard: Uint8Array;
  /** `scoring.access.soft`, by `LAND_CODE`. */
  soft: Float64Array;
  /** `scoring.access.soft × scoring.access.demoteK`, by `LAND_CODE`. */
  softDemoted: Float64Array;
  aerialMinM: number;
}

/** Compile the ladder for one profile. THE one place the two class-keyed tables are read. */
export function compileAccessTables(scoring: BestSpotScoring): AccessTables {
  const n = LAND_CLASSES.length;
  const hard = new Uint8Array(n);
  const soft = new Float64Array(n);
  const softDemoted = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cls = LAND_CLASSES[i];
    hard[i] = BESTSPOT_SAFETY.groundHard[cls];
    soft[i] = scoring.access.soft[cls];
    softDemoted[i] = soft[i] * scoring.access.demoteK;
  }
  return { hard, soft, softDemoted, aerialMinM: scoring.access.aerialMinM };
}

/**
 * `accessAt` recomputed from the term buffer's stored `cls` / `flags` byte, into a caller-owned
 * scratch so COMPOSE allocates nothing.
 *
 * **This is the ONE place the byte is decoded**, and it is built on `compileAccessTables` — which
 * is in turn the ONE place `BESTSPOT_SAFETY.groundHard` and `scoring.access.soft` are read by
 * class. `bestSpotSolver.test.ts` pins it equal to `landcoverRaster.accessAt` over the whole
 * 11-class × demoted × ground/aerial × in-solid cross product, which is what makes the duplication a
 * BRIDGE rather than a fork. (A `LandGrid` cannot be handed here: COMPOSE's whole point is that it
 * reads the transferred term buffer and the job, and nothing else.)
 */
export function accessFromTermByte(
  clsCode: number,
  flagsByte: number,
  sheetHeightAboveGroundM: number,
  tables: AccessTables,
  out: CellAccess,
): CellAccess {
  const cls: LandClass = LAND_CLASSES[clsCode] ?? "unknown";
  const hard = (tables.hard[clsCode] ?? 1) === 1 ? 1 : 0;
  out.groundReachable = hard === 1;
  if (sheetHeightAboveGroundM < tables.aerialMinM) {
    out.hard = hard;
    out.soft =
      (flagsByte & TERM_FLAG.demoted) !== 0 ? tables.softDemoted[clsCode] : tables.soft[clsCode];
    out.cls = cls;
    return out;
  }
  const inSolid = (flagsByte & TERM_FLAG.inSolid) !== 0;
  out.hard = inSolid ? 0 : 1;
  out.soft = 1;
  out.cls = inSolid ? "building" : cls;
  return out;
}

/** Everything COMPOSE needs that is not in the term buffer. All of it is per-DISC scalars — the
 *  whole point of the split is that the per-CELL work is 15 multiply-adds. */
export interface ComposeContext {
  cellM: number;
  radiusM: number;
  centreLatDeg: number;
  centreLonDeg: number;
  /** m above the ELLIPSOID — `SolveResult.centreGroundM`. */
  centreGroundM: number;
  /** `eyeM + liftM`. */
  sheetAltM: number;
  /** `horizonDipDeg(sheetAltM, refractionK)` — `L`'s anchor and GRAZE's relief anchor. */
  dipFloorDeg: number;
  kind: BestSpotKind;
  /** The track's stored ephemeris readings. `M` is recomputed from THESE, which is what makes the
   *  whole `worth.*` group a recompose instead of a 490 ms rebuild (`SPEC_V2 §5.3(b)`). */
  worthParts: EventTrackWorthParts;
  coverage: number;
  unmappedFrac: number;
  minReachM: number;
  conformM: Float32Array | null;
  /**
   * The score window `.r` is quantised over. **The feed passes `BESTSPOT.displayLo/displayHi`
   * here**; the defaults (`DISPLAY_LO`/`DISPLAY_HI`) exist only so a pure test needs no tuning
   * import. Whatever is used is echoed on `BestSpotFieldPack`, so the sheet cannot de-quantise with
   * a different pair than the solver quantised with.
   */
  displayLo?: number;
  displayHi?: number;
}

/**
 * `S` for every cell, in **f64** — the reference the RG8 quantisation is measured against.
 *
 * ```
 * S = A_hard · A_soft^e · M_eff · G(V) · Σ w·T / Σ w        over the KEYS of `weights` (a registry)
 * ```
 *
 * `verdict` is not stored: `c < gates.minCoverage` decides it here, which is what makes
 * `minCoverage` a recompose. An UNKNOWN cell returns exactly 0 AND is reported through `.g = 0` in
 * the pack — a render class, never a low score.
 */
export function composeScores(
  terms: BestSpotTermBuffer,
  ctx: ComposeContext,
  scoring: BestSpotScoring,
  out?: Float64Array,
): Float64Array {
  const n = terms.cellCount;
  const scores = out && out.length === n ? out : new Float64Array(n);
  // Every view hoisted: `terms.tauTerrain[i]` is a property load on a 17-field object, and there
  // are fourteen of them per cell against a 1 ms / 40,401-cell budget.
  const tC = terms.c;
  const tV = terms.v;
  const tL = terms.altStar;
  const tP = terms.p;
  const tFlags = terms.flags;
  const tCls = terms.cls;
  const tNotchFloor = terms.notchFloorDeg;
  const tNotchDepth = terms.notchDepthDeg;
  const tNotchWidth = terms.notchWidthDeg;
  const tRhoStar = terms.rhoStar;
  const tNotchQL = terms.notchQL;
  const tNotchQR = terms.notchQR;
  const tTauT = terms.tauTerrain;
  const tTauB = terms.tauBuilding;
  const tTauD = terms.tauDeck;
  const tTauR = terms.tauTree;
  const dipFloorDeg = ctx.dipFloorDeg;
  // THE REGISTRY, hoisted. `cellScore` iterates the KEYS of `weights` and drops any key this build
  // cannot compute; so does this, but ONCE per compose rather than 40,401 times — 16 string
  // comparisons per cell is most of a 1 ms budget. Order is the record's own insertion order, so
  // the sum is bit-identical to `cellScore`'s, not merely equal.
  const w = scoring.weights;
  const termIdx: number[] = [];
  const termW: number[] = [];
  let wTotal = 0;
  for (const key of Object.keys(w) as BestSpotTermKey[]) {
    const idx = key === "v" ? 0 : key === "l" ? 1 : key === "p" ? 2 : key === "f" ? 3 : -1;
    if (idx < 0) continue; // a NEWER profile's term this build cannot compute — drop it
    termIdx.push(idx);
    termW.push(w[key]);
    wTotal += w[key];
  }
  const nTerms = termIdx.length;
  const termIdxA = Int32Array.from(termIdx);
  const termWA = Float64Array.from(termW);
  const tv = new Float64Array(4);
  const tables = compileAccessTables(scoring);
  const tHard = tables.hard;
  const tSoft = tables.soft;
  const tSoftDem = tables.softDemoted;
  const aerialMinM = tables.aerialMinM;
  const aerial = ctx.sheetAltM >= aerialMinM;
  const conf = scoring.graze.conf;
  const scaleRadii = scoring.graze.scaleRadii;
  const lCeil = scoring.curves.lCeilDeg;
  const minCoverage = scoring.gates.minCoverage;
  const gates = scoring.gates;
  const softExp = scoring.curves.accessSoftExponent;
  const gap = scoring.gap;
  const shoulderMode = gap.shoulderQuality;
  // ONE ephemeris-free recomposition of `M` for the whole disc (`SPEC_V2 §5.3(b)`).
  const mEff = effectiveWorth(worthFromParts(ctx.kind, ctx.worthParts, scoring), scoring.worth);
  const tauSplit: GrazeTauSplit = { terrain: 0, building: 0, deck: 0, tree: 0 };

  const invWTotal = wTotal > 0 ? 1 / wTotal : 0;
  for (let i = 0; i < n; i++) {
    if (tC[i] < minCoverage) {
      scores[i] = 0;
      continue;
    }
    const flags = tFlags[i];
    const v = tV[i];
    // `L` is RECOMPUTED from `altStar`, not read back from `terms.l` — that is what makes
    // `curves.lCeilDeg` a recompose. `terms.l` is the solve-time value and the two agree exactly
    // at the solve-time profile, which `bestSpotSolver.test.ts` asserts.
    const l = (flags & TERM_FLAG.hasStar) !== 0 ? 1 - smoothstep(dipFloorDeg, lCeil, tL[i]) : 0;
    // (`tL` is `altStar`; `L` is recomputed from it so `curves.lCeilDeg` stays live.)
    tauSplit.terrain = tTauT[i];
    tauSplit.building = tTauB[i];
    tauSplit.deck = tTauD[i];
    tauSplit.tree = tTauR[i];
    const fGraze = grazeFromTau(grazeTauTotal(tauSplit, conf), scaleRadii);
    // `F_gap` is RE-DERIVED from the stored notch GEOMETRY with the live `gap.*` numbers — not read
    // back from a product baked at solve time. That is what makes `CLASS_OF`'s five `gap.*`
    // recompose entries true rather than aspirational.
    const hasStar = (flags & TERM_FLAG.hasStar) !== 0;
    const fGap = hasStar
      ? notchFFromParts(tL[i], tNotchFloor[i], tNotchDepth[i], tNotchWidth[i], tRhoStar[i], gap) *
        combineShoulderQuality(tNotchQL[i], tNotchQR[i], shoulderMode)
      : 0;
    const f = fGraze > fGap ? fGraze : fGap;

    tv[0] = v;
    tv[1] = l;
    tv[2] = tP[i];
    tv[3] = f;
    let wDotT = 0;
    for (let k = 0; k < nTerms; k++) wDotT += termWA[k] * tv[termIdxA[k]];
    // `accessFromTermByte`'s two branches, over the SAME compiled tables, without the `CellAccess`
    // object — an object write per cell costs a string field and a GC write barrier, and this loop
    // has a 1 ms / 40,401-cell budget. The exported function stays the readable form and is pinned
    // against `landcoverRaster.accessAt` over the whole cross-product; THIS path is pinned by
    // DONE-CHECK 5, whose independent reference compose resolves access through `accessAt` itself
    // over a fixture that paints every rung of the ladder.
    const clsCode = tCls[i];
    let hard: number;
    let soft: number;
    if (aerial) {
      hard = (flags & TERM_FLAG.inSolid) !== 0 ? 0 : 1;
      soft = 1;
    } else {
      hard = tHard[clsCode];
      soft = (flags & TERM_FLAG.demoted) !== 0 ? tSoftDem[clsCode] : tSoft[clsCode];
    }
    scores[i] =
      hard === 0
        ? 0
        : clamp01(
            accessSoftGain(clamp01(soft), softExp) *
              mEff *
              visibilityGate(v, gates) *
              (wDotT * invWTotal),
          );
  }
  return scores;
}

/**
 * COMPOSE — the term buffer plus the job in, `BestSpotFieldPack` out. ~15 multiply-adds per cell,
 * measured **0.272 ms at 201²** (`SPEC_V2 §2.2` T2), i.e. 1,260× cheaper than the cheapest
 * achievable re-solve. That ratio is the whole answer to owner requirement (vii).
 */
export function composeField(
  terms: BestSpotTermBuffer,
  ctx: ComposeContext,
  scoring: BestSpotScoring,
): BestSpotFieldPack {
  const n = terms.n;
  const cells = terms.cellCount;
  const scores = composeScores(terms, ctx, scoring);
  const lo = ctx.displayLo ?? DISPLAY_LO;
  const hi = ctx.displayHi ?? DISPLAY_HI;
  const span = hi > lo ? hi - lo : 1;
  const minCoverage = scoring.gates.minCoverage;
  const rg8 = new Uint8Array(cells * 2);
  const tables = compileAccessTables(scoring);
  const access: CellAccess = { hard: 1, soft: 1, cls: "unknown", groundReachable: true };
  for (let i = 0; i < cells; i++) {
    if (terms.c[i] < minCoverage) {
      rg8[i * 2] = 0;
      rg8[i * 2 + 1] = STAND_G.unknown;
      continue;
    }
    accessFromTermByte(terms.cls[i], terms.flags[i], ctx.sheetAltM, tables, access);
    rg8[i * 2] = Math.round(255 * clamp01((scores[i] - lo) / span));
    rg8[i * 2 + 1] =
      access.hard === 0
        ? STAND_G.inaccessible
        : access.groundReachable
          ? STAND_G.scoredReachable
          : STAND_G.scoredNotGroundReachable;
  }
  return {
    n,
    cellM: ctx.cellM,
    centreLatDeg: ctx.centreLatDeg,
    centreLonDeg: ctx.centreLonDeg,
    centreGroundM: ctx.centreGroundM,
    radiusM: ctx.radiusM,
    sheetAltM: ctx.sheetAltM,
    rg8,
    conformN: CONFORM_N,
    conformM: ctx.conformM,
    displayLo: lo,
    displayHi: hi,
    coverage: ctx.coverage,
    unmappedFrac: ctx.unmappedFrac,
    minReachM: ctx.minReachM,
    scoringHash: scoringHash(scoring),
  };
}
