/**
 * BEST SPOT S2a — the LANDCOVER / ACCESSIBILITY raster (`BESTSPOT_PLAN.md` §4, owner ruling R1).
 *
 * Scanline-rasterizes the already-streamed OpenFreeMap z14 MVT (rings + line ribbons) into ONE
 * `Uint8Array` class grid in a LOCAL ENU frame, so "can I stand here?" becomes an O(1) array read
 * for every cell of the disc, at every scrubber time and every altitude.
 *
 * Pure, three-free, store-free, DOM-free, clock-free — the `horizonProfile`/`occlusion` idiom, so
 * this imports cleanly inside the long-lived module worker (§5). The only cross-layer edges are
 * `components/globe/tuning` (VECTOR ribbon widths — the sanctioned edge, `tuning.ts` is verified
 * three-free) and a TYPE-ONLY import of the parser's feature shapes, which is erased at build time
 * and therefore costs the worker nothing. Types rather than a hand-copied structural mirror on
 * purpose: a duplicated shape is a shape that drifts, and this file's whole job is to consume the
 * five fields the 2026-08-24 parser widening stopped throwing away.
 *
 * ── THE FOUR THINGS THIS MODULE EXISTS TO GET RIGHT ─────────────────────────────────────────────
 *
 *  1. **PAINT ORDER IS THE ALGORITHM.** `green → landuse → water → road ribbons → path ribbons →
 *     decks → buildings LAST`. It is not cosmetic layering: it is how a bridge deck stops being
 *     "the Dnipro". The owner's hero location is a 29,039 m² deck floating over a lake polygon that
 *     is a hard exclusion, and the ONLY thing that makes it standable is that decks paint after
 *     water. Reorder these and the feature sends its user into the river.
 *
 *  2. **A PLAN-VIEW OUTLINE IS NOT A HEIGHT.** Water polygons, landuse rings and road centrelines
 *     carry no z. This raster answers a GROUND question. Owner ruling R1's aerial rules need the
 *     solid envelope (`render_min_height`/`render_height`), which lives in the DSM, not here — so
 *     `accessAt` takes the DSM's own VERDICT (`localDsm.insideSolidInterior`) rather than half of a
 *     height comparison it would have to re-datum. See `accessAt`'s "TWO DATUMS THAT LOOK ALIKE".
 *
 *  3. **UNKNOWN IS A VERDICT, NOT A ZERO.** 36.1 % of a dense Dnipro box has no landcover class at
 *     all (measured, 600 m @ 1 m). Unpainted cells are `"unknown"` with soft 0.45 and hard 1 — a
 *     real penalty that cannot delete an otherwise excellent spot, and never a hard exclusion. A
 *     class we have no ruling for (farmland, ice, rock) is deliberately LEFT unpainted rather than
 *     guessed at.
 *
 *  4. **THE RASTER CANNOT SEE FENCES.** 274 `gate` + 44 `lift_gate` POI points in the Dnipro 3×3
 *     ring prove the geometry is missing, not the reality. It also cannot see water LEVEL or bank
 *     height, retaining walls, locked courtyards, whether "grass" is a lawn or a swamp, seasonal
 *     ice, or construction. Those caveats belong in the UI; the honest signal here is that class
 *     boundaries carry a 1–2 cell uncertainty ribbon (MVT polylines are generalised at the 5–20 m
 *     chord scale — measured water median 5.5–16.8 m, buildings 7.8–12.3 m).
 */

import { VECTOR } from "../../components/globe/tuning";
import type {
  VecAreaFeat,
  VecLineFeat,
  VecPolyFeat,
} from "../../components/globe/scene/vectorTiles";
import {
  BESTSPOT_PHYSICS,
  BESTSPOT_SAFETY,
  BESTSPOT_SCORING_V1,
  type BestSpotScoring,
} from "./bestSpotScoring";
import type { CellAccess, LandClass } from "./bestSpotTypes";
import {
  enuFrameAt,
  enuOfLonLat,
  lonLatOfEnu,
  oddSpanCells,
  type EnuFrame,
} from "./localDsm";

// ---------------------------------------------------------------------------------------------
// The local ENU frame — BORROWED FROM THE DSM, NEVER RE-DERIVED
// ---------------------------------------------------------------------------------------------

/**
 * ONE FRAME AND ONE GRID PARITY PER DISC — the two conventions this module used to fork.
 *
 * Both live in `localDsm` (`enuFrameAt` / `enuOfLonLat` / `lonLatOfEnu` and `oddSpanCells`) with the
 * measured numbers in their docstrings, because that is the module the obstruction field, the hull
 * sweep and the terrain TIN are already built in. This raster must land on the SAME cells as that
 * field or the accessibility mask and the skyline disagree about which square metre the owner is
 * standing on.
 *
 * What was removed here, and why it must not come back: a module-private `M_PER_DEG_LAT = 111_320`
 * plus the equirectangular idiom `x = Δlon·M·cos φ`, `y = Δlat·M`. It is the repo's fourth copy of
 * that literal (`scene/minimapFeed.ts:38`, `lib/geo/horizonProfile.ts:134`, `lib/geo/geocode.ts:31`)
 * and it is a DIFFERENT frame from the DSM's — off by 0.94 m east / 0.54 m north at 500 m at Dnipro,
 * 1.42 m at the 700 m collar, and up to 4.72 m at the equator, against a mask the plan advertises at
 * 1 m. The other three copies are fine where they are: they draw map ink at 10 m scales. This one
 * decides where a person stands.
 */

/** What a `LandGrid` is asked for. Square, centred on the disc's own centre. */
export interface LandGridSpec {
  /** ENU tangent point == the grid centre (the temp pin / FPV eye). */
  centreLatDeg: number;
  centreLonDeg: number;
  /** Half-extent of the square (m) — the disc radius plus the plan's 400 m collar. */
  halfSpanM: number;
  /** Cell size (m). 3 m default, 1 m under ULTRA and at the top-K re-solve (plan §8, R3). */
  cellM: number;
}

/**
 * The rasterized class field. Row-major, `iy * nx + ix`; `ix` grows EAST and `iy` grows NORTH, so
 * a naive image dump is upside down — that is the ENU convention, not a bug.
 *
 * `nx === ny` and both are ODD (`oddSpanCells`), so the centre pin is the cell
 * `((nx−1)/2, (ny−1)/2)` and its centre is the frame origin exactly.
 */
export interface LandGrid {
  nx: number;
  ny: number;
  cellM: number;
  /** ENU tangent point; the grid is centred on it (see `localOfLonLat`). */
  centreLatDeg: number;
  centreLonDeg: number;
  /** The DSM's own ENU frame at the centre — built by `localDsm.enuFrameAt`, so the landcover mask
   *  and the obstruction field are registered by CONSTRUCTION rather than by two formulas agreeing. */
  frame: EnuFrame;
  /** `LAND_CODE` values. Allocated zero-filled, and `LAND_CODE.unknown === 0` on purpose. */
  cls: Uint8Array;
  /**
   * PROVENANCE bits — `LAND_FLAG.demoted` (bit 0) and `LAND_FLAG.accessDenied` (bit 1).
   *
   * **§5.3(a), and it is the load-bearing half of the change.** This byte used to be `softQ`: the
   * soft preference BAKED IN at paint time, so moving one rung of the ladder meant re-rastering the
   * whole disc (2.2–31 ms). It is now pure provenance and `softAt` resolves the value from the
   * PROFILE at read time — which drops `access.soft.*` / `access.demoteK` / `access.aerialMinM`
   * from a re-raster to a RECOMPOSE (0.272 ms). Same byte count, same two arrays.
   *
   * The flag is needed because the ladder has demotions that are not classes: `surface=unpaved` and
   * `foot=no` "demote; they never certify" (plan §4), and an unpaved footway is still a footway.
   *
   * `accessDenied` is ADDITIONAL provenance, never a replacement: `access=no`/`private` is still
   * resolved EAGERLY into `paint("blocked")` at paint time, because that is what flips the SAFETY
   * `hard` bit through the class. The bit only records WHY a cell reads `blocked`, for the panel.
   */
  flags: Uint8Array;
}

/** Bits of `LandGrid.flags`. */
export const LAND_FLAG = {
  /** `surface=unpaved` or `foot=no` — multiply `soft` by `access.demoteK`. */
  demoted: 1,
  /** The cell was painted `blocked` because of `access=no` / `access=private`, rather than because
   *  of its own class. Provenance for the panel's row copy; the hard bit already came from the class. */
  accessDenied: 2,
} as const;

// ---------------------------------------------------------------------------------------------
// Classes, codes, and the ground ladder
// ---------------------------------------------------------------------------------------------

/** Code → class. The index IS the code stored in `LandGrid.cls`. */
export const LAND_CLASSES: readonly LandClass[] = [
  "unknown",
  "water",
  "wetland",
  "building",
  "deck",
  "path",
  "road",
  "majorRoad",
  "green",
  "pitch",
  "blocked",
];

/** Class → code. `unknown` MUST stay 0 so a fresh `Uint8Array` reads as "nobody has looked". */
export const LAND_CODE: Record<LandClass, number> = {
  unknown: 0,
  water: 1,
  wetland: 2,
  building: 3,
  deck: 4,
  path: 5,
  road: 6,
  majorRoad: 7,
  green: 8,
  pitch: 9,
  blocked: 10,
};

/**
 * Soft-preference quantisation. 200 and not 255: every rung of the plan's ladder AND its demoted
 * variant is then exactly representable — 1 → 200, 0.9 → 180, 0.85 → 170, 0.6 → 120, 0.45 → 90,
 * 0.15 → 30, 0.1 → 20, and ×`DEMOTE_K` gives 140/126/119/84/63/21/14. No rounding drift means a
 * test can assert `soft === 0.85` instead of `toBeCloseTo`, which is the difference between a pin
 * that fails when the ladder changes and one that shrugs.
 *
 * **RETIRED AS A STORAGE FORMAT (§5.3(a)), KEPT AS THE LADDER'S EXACTNESS CONTRACT.** The grid no
 * longer stores a quantised soft byte — `softAt` resolves the value from the profile at read time.
 * The exactness property it was chosen for is still the reason the ladder's rungs are the numbers
 * they are, and `landcoverRaster.test.ts` still asserts it, so the constant stays with its
 * reasoning attached. It is `BESTSPOT_PHYSICS.softQ`; there is one copy of the number.
 */
export const SOFT_Q = BESTSPOT_PHYSICS.softQ;

/**
 * `surface=unpaved` / `foot=no` demotion. The plan's words are "they never certify" — an unpaved
 * track is still walkable, so this is a multiplier, never a gate.
 *
 * The SHIPPED value; the live twin the code reads is `scoring.access.demoteK`.
 */
export const DEMOTE_K = BESTSPOT_SCORING_V1.access.demoteK;

/**
 * The HARD half of the GROUND ladder (plan §4). `hard = 0` kills the cell at any framing score —
 * "a cell in the Dnipro is not a spot".
 *
 * **These 11 bits are `BESTSPOT_SAFETY` and are NOT patchable** (§5.5): flipping `water` makes the
 * top-K tell a photographer to stand in a river, and `blocked` covers military / industrial /
 * railway, which is C6-relevant. The SOFT half moved into `BestSpotScoring.access.soft` and IS
 * tunable — `wetland` sits at the bottom of it (0.1) but is deliberately NOT hard-excluded, because
 * a marsh is miserable rather than impassable and calling it impassable would be a claim about a
 * water level this data does not carry.
 */
const GROUND_HARD = BESTSPOT_SAFETY.groundHard;

/** OpenMapTiles transportation classes that are "primary/trunk/motorway 0.15" in the ladder. */
const MAJOR_ROAD_CLASSES = new Set(["motorway", "trunk", "primary"]);

/** The PEDESTRIAN class. OpenMapTiles flattens footway / pedestrian / steps / cycleway / path into
 *  `class = "path"` and keeps the distinction in `subclass` (measured in the Dnipro 3×3: footway 88,
 *  pedestrian 31, steps 30, path 26, cycleway 17) — which is exactly why `subclass` had to survive
 *  the parser. All five are 1.0 on the ladder, so the class alone decides the score; the subclass
 *  is kept for the panel's row copy. */
const PATH_CLASSES = new Set(["path"]);

/** A pier LINE is a structure you stand on, not a carriageway — same bucket as a deck POLYGON. */
const DECK_LINE_CLASSES = new Set(["pier"]);

/** `access` values that are a HARD exclusion (plan §4: "access=no / private"). */
const ACCESS_DENIED = new Set(["no", "private"]);

/** landuse classes that are hard exclusions. C6-relevant: `military` is in here, and the plan
 *  mirrors the bake's military/critical-infrastructure blocklist as a suggestion suppressor. */
const BLOCKED_LANDUSE = new Set([
  "military",
  "industrial",
  "railway",
  "quarry",
  "landfill",
  "construction",
]);

/** landuse classes that are the ladder's "pitch/playground 0.85". */
const PITCH_LANDUSE = new Set(["pitch", "playground"]);

// ---------------------------------------------------------------------------------------------
// Grid construction + frame maths
// ---------------------------------------------------------------------------------------------

/**
 * Index of the CENTRE cell on an axis of `n` (always odd) cells. The frame origin — the disc centre,
 * the pin, the foot of the plumb line — is exactly this cell's centre.
 */
function centreIndex(n: number): number {
  return (n - 1) / 2;
}

/**
 * Allocate an all-`unknown` grid for a spec. `n` is ODD via the DSM's own `oddSpanCells`.
 *
 * BOTH arrays are plain zero-filled allocations now. That is not a shortcut — it is the equivalence
 * the §5.3(a) conversion rests on: `LAND_CODE.unknown === 0` and `LAND_FLAG` has no bit 0 meaning
 * "not demoted", so a fresh grid reads as `unknown`, undemoted, and `softAt` resolves
 * `access.soft.unknown = 0.45` — exactly what the old `.fill(round(0.45 · SOFT_Q)) = .fill(90)`
 * produced (`90 / 200 === 0.45`). One fewer `fill` over 361k cells, and the ladder is now
 * re-readable without re-rastering.
 */
export function makeLandGrid(spec: LandGridSpec): LandGrid {
  const cellM = spec.cellM;
  const n = oddSpanCells(spec.halfSpanM, cellM);
  return {
    nx: n,
    ny: n,
    cellM,
    centreLatDeg: spec.centreLatDeg,
    centreLonDeg: spec.centreLonDeg,
    frame: enuFrameAt(spec.centreLatDeg, spec.centreLonDeg),
    cls: new Uint8Array(n * n),
    flags: new Uint8Array(n * n),
  };
}

/** lon/lat → local ENU metres (east, north) about the grid centre, through the DSM's own frame.
 *  Antimeridian-safe by construction — see `localDsm.enuOfLonLat`. */
export function localOfLonLat(
  grid: LandGrid,
  lonDeg: number,
  latDeg: number,
): [number, number] {
  return enuOfLonLat(grid.frame, lonDeg, latDeg);
}

/** Local east metres of a column's cell CENTRES — `localDsm.cellEast`'s twin, written the same way
 *  (`originE + ix·cellM` with `originE = −centreIndex·cellM`) so the two grids cannot slip half a
 *  cell against each other. */
export function xOfIx(grid: LandGrid, ix: number): number {
  return (ix - centreIndex(grid.nx)) * grid.cellM;
}

/** Local north metres of a row's cell centres. */
export function yOfIy(grid: LandGrid, iy: number): number {
  return (iy - centreIndex(grid.ny)) * grid.cellM;
}

/** The cell containing a lon/lat. May be OUT OF RANGE — check with `inGrid`; clamping here would
 *  silently smear everything outside the disc onto its rim.
 *
 *  NEAREST cell centre (`round`), exactly as `localDsm.cellAtEnu` resolves the same question — a
 *  `floor` here would answer a DIFFERENT question than the obstruction field answers, which is the
 *  same class of bug as the two frames. Half-cell ties therefore go east/north on both grids. */
export function cellOfLonLat(
  grid: LandGrid,
  lonDeg: number,
  latDeg: number,
): { ix: number; iy: number } {
  const [x, y] = localOfLonLat(grid, lonDeg, latDeg);
  return {
    ix: Math.round(x / grid.cellM) + centreIndex(grid.nx),
    iy: Math.round(y / grid.cellM) + centreIndex(grid.ny),
  };
}

/** Geodetic centre of a cell — what the top-K list hands the user to walk to. */
export function lonLatOfCell(
  grid: LandGrid,
  ix: number,
  iy: number,
): { lonDeg: number; latDeg: number } {
  return lonLatOfEnu(grid.frame, xOfIx(grid, ix), yOfIy(grid, iy));
}

export function inGrid(grid: LandGrid, ix: number, iy: number): boolean {
  return ix >= 0 && iy >= 0 && ix < grid.nx && iy < grid.ny;
}

/** Class of a cell. Out of range reads `"unknown"` — ignorance, which is the honest answer for a
 *  cell nobody rasterized. */
export function classAt(grid: LandGrid, ix: number, iy: number): LandClass {
  if (!inGrid(grid, ix, iy)) return "unknown";
  return LAND_CLASSES[grid.cls[iy * grid.nx + ix]] ?? "unknown";
}

/**
 * Soft preference of a cell, 0.1..1 — resolved from the PROFILE at read time (§5.3(a)), demotions
 * included. Out of range reads the `unknown` rung, the same honest answer `classAt` gives.
 */
export function softAt(
  grid: LandGrid,
  ix: number,
  iy: number,
  scoring: BestSpotScoring = BESTSPOT_SCORING_V1,
): number {
  if (!inGrid(grid, ix, iy)) return scoring.access.soft.unknown;
  const k = iy * grid.nx + ix;
  const base = scoring.access.soft[LAND_CLASSES[grid.cls[k]] ?? "unknown"];
  return (grid.flags[k] & LAND_FLAG.demoted) !== 0 ? base * scoring.access.demoteK : base;
}

/** Fraction of cells carrying a class, 0..1 — the "% UNMAPPED" status line, and the pin that says
 *  the bridge deck actually survived the parser. */
export function classFraction(grid: LandGrid, cls: LandClass): number {
  const code = LAND_CODE[cls];
  let n = 0;
  for (let i = 0; i < grid.cls.length; i++) if (grid.cls[i] === code) n++;
  return n / grid.cls.length;
}

// ---------------------------------------------------------------------------------------------
// Accessibility — OWNER RULING R1
// ---------------------------------------------------------------------------------------------

/**
 * The accessibility verdict for one cell at one sheet height (owner ruling R1, 2026-08-24).
 *
 * BELOW `AERIAL_MIN_M` (5 m) the GROUND rules gate: no water, no buildings, no military/industrial
 * landuse, no `access=no`. AT OR ABOVE it the cell is judged by DRONE rules, and the ONLY thing
 * that can gate it is a SOLID INTERIOR — `solidBaseM <= h < solidTopM`. Water stops masking, roofs
 * stop masking, and `soft` is a flat 1: at 60 m the landcover under you is not a preference.
 *
 * The owner's stated preference was "a place I can climb to", so the ground verdict is NOT
 * discarded — it rides along as `groundReachable` at EVERY height, ground rules or drone rules.
 *
 * **THE ONE DATUM RULE — why this takes a boolean and not a solid envelope.** `sheetHeightAboveGroundM`
 * is ABOVE THIS CELL'S GROUND (the altitude slider's own number). The DSM's `solidBase`/`solidTop` are
 * ABSOLUTE — height above the local sphere. Those two datums differ by the cell's ground elevation, so
 * this function is handed the ANSWER, computed by the one function that owns all three numbers:
 * `localDsm.insideSolidInterior(dsm, cell, sheetHeightAboveGroundM)` — the SAME height passed here.
 * A plan-view raster has no z (header pin 2); it must not hold half of a height comparison.
 *
 * **NAMED BUG CLASS — TWO DATUMS THAT LOOK ALIKE** (found 2026-08-24, adversarial math review). This
 * function used to take `(solidBaseM, solidTopM)` and compare the above-ground sheet height straight
 * against them, while its own docstring said the pair came "from the DSM at this cell" — where it is
 * absolute. A Dnipro cell with ground 100 m under a 30 m building (absolute 100 → 130), called as the
 * docstring instructed, evaluated `10 >= 100` ⇒ false ⇒ `hard = 1`: **R1's only aerial gate off, a
 * drone declared free inside every building.** Every test passed because every test used ground 0,
 * where the two datums coincide — the check that could not fail. Tests here now use a NONZERO ground.
 *
 * WHAT `cls` REPORTS ABOVE 5 m: the class that DECIDED — `"building"` when the sheet is inside a
 * solid, otherwise the ground class underneath, because "you are 60 m over water" is what the
 * legend and the uncertainty ribbon need to say. R1 calls aerial cells "a distinct AERIAL class",
 * but `LandClass` has no aerial member and `CellAccess` has no aerial flag (recorded as a contract
 * gap): the caller already knows, because it passed the height in.
 */
export function accessAt(
  grid: LandGrid,
  ix: number,
  iy: number,
  sheetHeightAboveGroundM: number,
  inSolidInterior: boolean,
  scoring: BestSpotScoring = BESTSPOT_SCORING_V1,
): CellAccess {
  const cls = classAt(grid, ix, iy);
  // The HARD bit is BESTSPOT_SAFETY and comes from the module const, never from `scoring` — there
  // is no key path from a patch to it. Only the SOFT rung and the aerial threshold are tunable.
  const hard = GROUND_HARD[cls];
  const groundReachable = hard === 1;

  if (sheetHeightAboveGroundM < scoring.access.aerialMinM) {
    return { hard, soft: softAt(grid, ix, iy, scoring), cls, groundReachable };
  }

  // R1 aerial: the ONLY gate up here. Water stops masking, roofs stop masking, and `soft` is a flat
  // 1 — at 60 m the landcover under you is not a preference.
  return {
    hard: inSolidInterior ? 0 : 1,
    soft: 1,
    cls: inSolidInterior ? "building" : cls,
    groundReachable,
  };
}

// ---------------------------------------------------------------------------------------------
// Rasterizer core — scanline fill + capsule ribbons
// ---------------------------------------------------------------------------------------------

/** One ring as interleaved local metres `[x0,y0, x1,y1, …]`; implicitly closed. */
type RingXY = Float64Array;

const ascending = (a: number, b: number) => a - b;

/** Write one cell (class + provenance flags). The ONLY writer — paint order is enforced by call
 *  order, so there is deliberately no priority test here to get out of sync with §4's list.
 *
 *  The flags are ASSIGNED, not OR-ed: a later pass repainting a cell replaces the whole verdict,
 *  and a demotion inherited from the road a footway crosses would be a claim about the wrong way. */
function put(grid: LandGrid, ix: number, iy: number, code: number, flags: number): void {
  const k = iy * grid.nx + ix;
  grid.cls[k] = code;
  grid.flags[k] = flags;
}

/**
 * Even-odd scanline fill of ONE polygon (outer ring + holes), sampled at cell CENTRES.
 *
 * Even-odd across ALL rings of the polygon is what makes holes work: a hole ring lies inside the
 * outer, so a scanline crossing it flips parity twice and the interior of the hole stays unpainted.
 * MVT gives us exactly this structure (`polys[polygon][ring]`, ring 0 outer, the rest holes), so no
 * winding bookkeeping is needed.
 *
 * The crossing test is the half-open rule `(y0 <= y) !== (y1 <= y)`: a vertex sitting exactly on the
 * scanline is counted once, not zero or twice, which is the classic source of one-cell bleed lines
 * out of an otherwise correct rasterizer. Horizontal edges have `y0 === y1` and are skipped by the
 * same expression.
 */
function fillPolygon(
  grid: LandGrid,
  rings: readonly RingXY[],
  code: number,
  flags: number,
): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (let i = 1; i < r.length; i += 2) {
      if (r[i] < minY) minY = r[i];
      if (r[i] > maxY) maxY = r[i];
    }
  }
  if (!(minY <= maxY)) return;
  // `+ centreIndex(n)` is the exact index offset of the cell-centre lattice `xOfIx`/`yOfIy` define;
  // ceil/floor then bracket the centres that fall inside the span.
  const iy0 = Math.max(0, Math.ceil(minY / grid.cellM + centreIndex(grid.ny)));
  const iy1 = Math.min(grid.ny - 1, Math.floor(maxY / grid.cellM + centreIndex(grid.ny)));
  const xs: number[] = [];
  for (let iy = iy0; iy <= iy1; iy++) {
    const y = yOfIy(grid, iy);
    xs.length = 0;
    for (const r of rings) {
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const y0 = r[i * 2 + 1];
        const y1 = r[j * 2 + 1];
        if ((y0 <= y) === (y1 <= y)) continue;
        const x0 = r[i * 2];
        const x1 = r[j * 2];
        xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
    if (xs.length < 2) continue;
    xs.sort(ascending);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ixa = Math.max(0, Math.ceil(xs[k] / grid.cellM + centreIndex(grid.nx)));
      const ixb = Math.min(grid.nx - 1, Math.floor(xs[k + 1] / grid.cellM + centreIndex(grid.nx)));
      for (let ix = ixa; ix <= ixb; ix++) put(grid, ix, iy, code, flags);
    }
  }
}

/**
 * Stamp a polyline as a ribbon of `widthM`, as a union of CAPSULES (one per segment).
 *
 * Capsules rather than quads because the round join is free and correct: a mitred quad strip either
 * leaves a wedge of unpainted ground on the outside of every bend or overshoots on a hairpin, and a
 * riverbank polyline generalised at a 5–20 m chord scale is nothing but bends. A cell is painted
 * when its CENTRE lies within `widthM/2` of the centreline, so a `widthM` ribbon is `widthM/cellM`
 * cells across, within one cell.
 */
function stampPolyline(
  grid: LandGrid,
  pts: RingXY,
  widthM: number,
  code: number,
  flags: number,
): void {
  const half = widthM / 2;
  if (!(half > 0)) return;
  const half2 = half * half;
  const n = pts.length / 2;
  for (let s = 0; s + 1 < n; s++) {
    const ax = pts[s * 2];
    const ay = pts[s * 2 + 1];
    const bx = pts[s * 2 + 2];
    const by = pts[s * 2 + 3];
    const cx = centreIndex(grid.nx);
    const cy = centreIndex(grid.ny);
    const ix0 = Math.max(0, Math.ceil((Math.min(ax, bx) - half) / grid.cellM + cx));
    const ix1 = Math.min(grid.nx - 1, Math.floor((Math.max(ax, bx) + half) / grid.cellM + cx));
    const iy0 = Math.max(0, Math.ceil((Math.min(ay, by) - half) / grid.cellM + cy));
    const iy1 = Math.min(grid.ny - 1, Math.floor((Math.max(ay, by) + half) / grid.cellM + cy));
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    for (let iy = iy0; iy <= iy1; iy++) {
      const py = yOfIy(grid, iy);
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = xOfIx(grid, ix);
        let t = len2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - (ax + ex * t);
        const dy = py - (ay + ey * t);
        if (dx * dx + dy * dy <= half2) put(grid, ix, iy, code, flags);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The paint passes
// ---------------------------------------------------------------------------------------------

/** Everything one parsed MVT tile contributes. `ParsedVtile` satisfies this structurally. */
export interface LandSource {
  lines: readonly VecLineFeat[];
  polys: readonly VecPolyFeat[];
  areas: readonly VecAreaFeat[];
}

/** A class + its provenance flags. `null` = "no ruling — leave the cell alone", which is NOT the
 *  same as painting `unknown`: an unruled landuse ring must leave the park beneath it.
 *
 *  It carried `softByte` until §5.3(a); the soft VALUE is now resolved from the profile at read
 *  time, so what the paint pass records is only what it OBSERVED — the class, whether the way was
 *  demoted, and whether `access` is what blocked it. */
export type Paint = { code: number; flags: number } | null;

function paint(cls: LandClass, demote = false, accessDenied = false): Paint {
  return {
    code: LAND_CODE[cls],
    flags: (demote ? LAND_FLAG.demoted : 0) | (accessDenied ? LAND_FLAG.accessDenied : 0),
  };
}

/** Project a lon/lat ring into interleaved local metres — through `localOfLonLat`, never a second
 *  copy of the projection. (It WAS a second copy: the same equirectangular expression inlined here,
 *  so a fix applied to one of the two would have missed the other.) */
function ringXY(grid: LandGrid, ring: readonly (readonly [number, number])[]): RingXY {
  const out = new Float64Array(ring.length * 2);
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = localOfLonLat(grid, ring[i][0], ring[i][1]);
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  }
  return out;
}

function fillFeature(
  grid: LandGrid,
  polys: readonly (readonly (readonly (readonly [number, number])[])[])[],
  p: Paint,
): void {
  if (!p) return;
  for (const rings of polys) {
    if (rings.length === 0) continue;
    fillPolygon(
      grid,
      rings.map((r) => ringXY(grid, r)),
      p.code,
      p.flags,
    );
  }
}

function stampFeature(grid: LandGrid, feat: VecLineFeat, widthM: number, p: Paint): void {
  if (!p || !(widthM > 0)) return;
  for (const part of feat.lines) {
    if (part.length < 2) continue;
    stampPolyline(grid, ringXY(grid, part), widthM, p.code, p.flags);
  }
}

/** The landcover classes AND subclasses the ladder calls "park/grass/beach 0.9". Deliberately a
 *  separate set from the parser's map-ink `GREEN_CLASSES`: ink and accessibility are different
 *  questions and coupling them is how the `class ?? subclass` dead branch survived a year. */
const GREEN_SUBSET = new Set([
  "grass",
  "wood",
  "park",
  "meadow",
  "recreation_ground",
  "garden",
  "village_green",
  "golf_course",
  "grassland",
  "allotments",
]);

/** Landcover class/subclass → the ladder. Returns `null` for classes we have no ruling for
 *  (farmland, ice, rock): guessing would turn ignorance into a score. */
export function landcoverPaint(cls: string, subclass: string): Paint {
  if (cls === "wetland" || subclass === "wetland" || subclass === "marsh") return paint("wetland");
  if (cls === "sand" || subclass === "beach") return paint("green"); // the 0.9 bucket, not a colour
  if (subclass === "pitch" || subclass === "playground") return paint("pitch");
  if (GREEN_SUBSET.has(cls) || GREEN_SUBSET.has(subclass)) return paint("green");
  return null;
}

/** landuse class → the ladder. `null` for classes with no ruling (residential, school, zoo…): a
 *  residential neighbourhood ring covers half a city and must not repaint the parks inside it. */
export function landusePaint(cls: string): Paint {
  if (BLOCKED_LANDUSE.has(cls)) return paint("blocked");
  if (PITCH_LANDUSE.has(cls)) return paint("pitch");
  return null;
}

/** transportation class → the ladder, for LINES. */
function roadPaint(feat: VecLineFeat): Paint {
  const access = feat.access ?? "";
  if (ACCESS_DENIED.has(access)) return paint("blocked", false, true);
  // A live railway is a hard exclusion. The plan names `railway` only as a LANDUSE class; extending
  // it to the centreline is this module's inference, and it is the safe direction to be wrong in —
  // the alternative is a top-K row that tells a photographer in a war zone to stand on a track.
  if (feat.cls === "rail") return paint("blocked");
  const demote = feat.surface === "unpaved" || feat.foot === "no";
  if (DECK_LINE_CLASSES.has(feat.cls)) return paint("deck", demote);
  if (PATH_CLASSES.has(feat.cls)) return paint("path", demote);
  if (MAJOR_ROAD_CLASSES.has(feat.cls)) return paint("majorRoad", demote);
  return paint("road", demote);
}

/**
 * Rasterize a set of parsed MVT tiles into a class grid.
 *
 * PAINT ORDER (plan §4, "verified to give the right answer"):
 * `green → landuse → water → road ribbons → path ribbons → decks → buildings LAST`.
 * Each pass overwrites the last, so LATER means STRONGER. The two that matter:
 *  · decks after water — the bridge over the Dnipro is standable and the Dnipro is not;
 *  · paths after roads — a footway crossing a trunk road is where you stand, at soft 1.0 rather
 *    than the trunk road's 0.15.
 * Buildings paint last unconditionally: a footprint is the one polygon in the schema that is a
 * physical solid rather than a surface classification.
 */
export function buildLandGrid(spec: LandGridSpec, sources: Iterable<LandSource>): LandGrid {
  const grid = makeLandGrid(spec);
  const tiles = [...sources];

  // 1 — GREEN (map-ink landcover) + the landcover classes the ink filter rejects.
  for (const t of tiles) {
    for (const f of t.polys) {
      if (f.kind !== "green") continue;
      fillFeature(grid, f.polys, landcoverPaint(f.cls ?? "", f.subclass ?? ""));
    }
    for (const f of t.areas) {
      if (f.kind !== "landcover") continue;
      fillFeature(grid, f.polys, landcoverPaint(f.cls, f.subclass));
    }
  }

  // 2 — LANDUSE (military / industrial / railway / quarry / landfill / construction; pitch).
  for (const t of tiles) {
    for (const f of t.areas) {
      if (f.kind !== "landuse") continue;
      const p = ACCESS_DENIED.has(f.access ?? "")
        ? paint("blocked", false, true)
        : landusePaint(f.cls);
      fillFeature(grid, f.polys, p);
    }
  }

  // 3 — WATER: polygons first (the Dnipro is a `class = "lake"` polygon, 2.03 km² on the hero
  //     tile), then waterway CENTRELINES stamped at VECTOR.waterwayWidthM. An INTERMITTENT
  //     watercourse paints `wetland` (soft 0.1, hard 1) rather than `water` (hard 0): a dry ditch
  //     is bad ground, and hard-excluding it would be a claim about a water level nothing here
  //     measures.
  for (const t of tiles) {
    for (const f of t.polys) {
      if (f.kind !== "water") continue;
      fillFeature(grid, f.polys, f.intermittent ? paint("wetland") : paint("water"));
    }
    for (const f of t.lines) {
      if (f.kind !== "waterway") continue;
      // `brunnel`, not `tunnel`: the parser leaves `tunnel` hard-false for waterways so the FPV
      // mini-map keeps drawing what it always drew. A CULVERTED drain is under the ground you are
      // standing on and is not a hazard.
      if (f.brunnel === "tunnel") continue;
      const widthM = VECTOR.waterwayWidthM[f.cls] ?? VECTOR.waterwayWidthM.stream;
      stampFeature(grid, f, widthM, f.intermittent ? paint("wetland") : paint("water"));
    }
  }

  // 4 / 5 — ROAD ribbons then PATH ribbons, at VECTOR.roadWidthM. Tunnels are skipped: a road in a
  //         tunnel says nothing about the surface above it. Classes absent from roadWidthM (or at
  //         width 0, i.e. `transit`) never reach here — the parser's own render filter dropped them.
  for (const pass of [false, true]) {
    for (const t of tiles) {
      for (const f of t.lines) {
        if (f.kind !== "road" || f.brunnel === "tunnel") continue;
        const isPath = PATH_CLASSES.has(f.cls) || DECK_LINE_CLASSES.has(f.cls);
        if (isPath !== pass) continue;
        stampFeature(grid, f, VECTOR.roadWidthM[f.cls] ?? 0, roadPaint(f));
      }
    }
  }

  // 6 — DECKS. The whole point of the widening: transportation POLYGONS (bridge decks, piers,
  //     pedestrian plazas, platforms) paint OVER water. An OSM transportation AREA is by
  //     construction a surface people traverse, so every class here is `deck` at soft 1.0 —
  //     `access` is the only thing that can take it away.
  for (const t of tiles) {
    for (const f of t.areas) {
      if (f.kind !== "deck") continue;
      const p = ACCESS_DENIED.has(f.access ?? "") ? paint("blocked", false, true) : paint("deck");
      fillFeature(grid, f.polys, p);
    }
  }

  // 7 — BUILDINGS, LAST.
  for (const t of tiles) {
    for (const f of t.polys) {
      if (f.kind !== "building") continue;
      fillFeature(grid, f.polys, paint("building"));
    }
  }

  return grid;
}
