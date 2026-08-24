import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseVectorTile, type ParsedVtile } from "../../../src/components/globe/scene/vectorTiles";
import { BESTSPOT, VECTOR } from "../../../src/components/globe/tuning";
import {
  BESTSPOT_SAFETY,
  BESTSPOT_SCORING_V1,
  resolveScoring,
  sanitizeScoringPatch,
  type BestSpotScoringPatch,
} from "../../../src/lib/geo/bestSpotScoring";
import {
  buildScoreMask,
  composeField,
  composeScores,
  discGeometry,
  solveTerms,
  STAND_G,
  ULTRA_MAX_RADIUS_M,
  type ComposeContext,
  type DiscGeometry,
  type SolveInput,
} from "../../../src/lib/geo/bestSpotSolver";
import { eventTrack } from "../../../src/lib/geo/bestSpotTrack";
import type { EventTrack } from "../../../src/lib/geo/bestSpotTypes";
import {
  builtDensityOf,
  shortlist,
  type FineAccess,
} from "../../../src/lib/geo/bestSpotWorker";
import { horizonDipDeg } from "../../../src/lib/geo/horizonProfile";
import {
  buildLandGrid,
  LAND_CODE,
  makeLandGrid,
  type LandGrid,
} from "../../../src/lib/geo/landcoverRaster";
import { createLocalDsm, sealDsm, type LocalDsm } from "../../../src/lib/geo/localDsm";

/**
 * =============================================================================================
 * **S7 — THE HONESTY LAYER.**
 * =============================================================================================
 *
 * Three defects, each measured before it was fixed, each with its fix pinned so that reverting it
 * turns a test red rather than turning the map warm:
 *
 *  1. **THE BUILT-DENSITY PRIOR — "the single most dangerous failure mode in the feature"**
 *     (`BESTSPOT_PLAN §11`). `parseTile` does `if (!layer) continue`, so **"tile fetched, zero
 *     buildings" is byte-identical to "OSM never surveyed here"**. Measured, a terrain-only rural
 *     disc came back `scored`, C = 1.000, V = 1.000, L = 1.000, P = 1.000, F = 0, openSky 40/40,
 *     **S = 0.470** over `unknown` landcover and **0.661** over `green` — uniform, warm, confident,
 *     reporting 100 % coverage. Both halves of that are reproduced below as the negative control.
 *
 *  2. **THE `reachM` REFUSAL.** §3.1: a disc whose DSM stops halfway scored **0.6633 against a
 *     truth of 0.0000** and claimed open sky on all 40 rays. S3c shipped the CHANNEL; S7 ships the
 *     POLICY, at the one threshold that costs nothing — the collar.
 *
 *  3. **R8's 1 m SHORTLIST.** 1 m accessibility on every solve ("stand on the footpath, not in the
 *     hedge"); 1 m obstruction only behind `REFINE THIS SPOT`. The done-check is that the two are
 *     visibly different numbers: **the shortlist reports `gridCellM === 1` while the field reports 3.**
 *
 * Plus the non-negotiables this slice must not have moved: UNKNOWN is a render class and never a
 * low score, the eleven `GROUND[*].hard` safety bits stay non-patchable, and `graze.conf.tree`
 * stays clamped at 0.6 because vegetation is fiction at the individual level.
 *
 * The MVT is real (`fixtures/ofm-z14-9787-5662-dnipro-central-bridge.pbf`, the committed
 * OpenFreeMap z14 tile over the owner's hero location) and the tracks are real astronomy-engine
 * sunsets. House rules: no clock, no three, no store, no DOM.
 */

const FIXTURE = join(__dirname, "fixtures", "ofm-z14-9787-5662-dnipro-central-bridge.pbf");
const TX = 9787;
const TY = 5662;
const TILE_Z = 14;
const LAT = 48.4647;
const LON = 35.0462;
const DAY_MS = Date.UTC(2026, 7, 24, 12);
const K_REFRACT = 0.13;
const EYE_M = 1.7;
const SCORING = BESTSPOT_SCORING_V1;

const TILE: ParsedVtile = parseVectorTile(
  readFileSync(FIXTURE).buffer.slice(0) as ArrayBuffer,
  TX,
  TY,
);
/**
 * The SAME tile with its building layer removed, and nothing else touched.
 *
 * This is §3.2 case 3 in its purest form: a tile that was fetched, parsed and painted, whose
 * landcover, water and roads are all real, and which reports zero buildings. It is the case the
 * prior exists to tell apart from a genuinely open city block, and it is DERIVED from real data
 * rather than synthesised so the two sides of the comparison differ in exactly one layer.
 */
const TILE_NO_BUILDINGS: ParsedVtile = {
  ...TILE,
  polys: TILE.polys.filter((p) => p.kind !== "building"),
};

function sunsetTrack(): EventTrack {
  const t = eventTrack(
    { latDeg: LAT, lonDeg: LON, groundAltM: 0, eyeAboveGroundM: EYE_M },
    "sunset",
    DAY_MS,
    { refractionK: K_REFRACT, scoring: SCORING, snapAzLattice: true },
  );
  if (!t) throw new Error("fixture: no sunset track");
  return t;
}
const TRACK = sunsetTrack();

/** A LandGrid over the SWEEP grid, painted with ONE class — so what is measured is the METRIC and
 *  not the landcover. Painted, never fresh: an all-`unknown` grid is REFUSED by the solver. */
function uniformLand(geo: DiscGeometry, code: number): LandGrid {
  const grid = makeLandGrid({
    centreLatDeg: LAT,
    centreLonDeg: LON,
    halfSpanM: geo.radiusM + geo.collarM,
    cellM: geo.cellM,
  });
  grid.cls.fill(code);
  return grid;
}

/** Flat ground at 0 m over the SWEEP grid, optionally truncated, optionally carrying a ridge. */
function scene(
  geo: DiscGeometry,
  o: { truncateM?: number; ridge?: { distM: number; heightM: number; azDeg: number } } = {},
): LocalDsm {
  const dsm = createLocalDsm({
    nx: geo.nGrid,
    ny: geo.nGrid,
    cellM: geo.cellM,
    originE: -((geo.nGrid - 1) / 2) * geo.cellM,
    originN: -((geo.nGrid - 1) / 2) * geo.cellM,
  });
  const half = (geo.nGrid - 1) / 2;
  const trunc2 = o.truncateM !== undefined ? o.truncateM * o.truncateM : Infinity;
  for (let iy = 0; iy < geo.nGrid; iy++) {
    const n = (iy - half) * geo.cellM;
    for (let ix = 0; ix < geo.nGrid; ix++) {
      const e = (ix - half) * geo.cellM;
      if (e * e + n * n > trunc2) continue; // NaN — ignorance is not sea level
      const c = iy * geo.nGrid + ix;
      dsm.ground[c] = 0;
      dsm.groundKnown[c] = 1;
    }
  }
  if (o.ridge) {
    const rad = (o.ridge.azDeg * Math.PI) / 180;
    const ue = Math.sin(rad);
    const un = Math.cos(rad);
    const ce = ue * o.ridge.distM;
    const cn = un * o.ridge.distM;
    for (let iy = 0; iy < geo.nGrid; iy++) {
      const n = (iy - half) * geo.cellM;
      for (let ix = 0; ix < geo.nGrid; ix++) {
        const e = (ix - half) * geo.cellM;
        const along = (e - ce) * ue + (n - cn) * un;
        const across = -(e - ce) * un + (n - cn) * ue;
        if (Math.abs(along) > 40 || Math.abs(across) > 500) continue;
        const c = iy * geo.nGrid + ix;
        if (dsm.groundKnown[c] === 1) dsm.ground[c] = o.ridge.heightM;
      }
    }
  }
  sealDsm(dsm);
  return dsm;
}

function solve(geo: DiscGeometry, dsm: LocalDsm, land: LandGrid, over: Partial<SolveInput> = {}) {
  return solveTerms({
    dsm,
    land,
    track: TRACK,
    geo,
    eyeM: EYE_M,
    liftM: 0,
    refractionK: K_REFRACT,
    scoring: SCORING,
    ...over,
  });
}

function ctxFor(
  geo: DiscGeometry,
  res: ReturnType<typeof solveTerms>,
  over: Partial<ComposeContext> = {},
): ComposeContext {
  return {
    cellM: geo.cellM,
    radiusM: geo.radiusM,
    centreLatDeg: LAT,
    centreLonDeg: LON,
    centreGroundM: res.centreGroundM,
    sheetAltM: EYE_M,
    dipFloorDeg: horizonDipDeg(EYE_M, K_REFRACT),
    kind: TRACK.kind,
    worthParts: {
      sunAltAtT0Deg: TRACK.sunAltAtT0Deg ?? 0,
      moonPhaseAngleDeg: TRACK.moonPhaseAngleDeg ?? 0,
    },
    coverage: res.coverage,
    unmappedFrac: res.unmappedFrac,
    minReachM: res.minReachM,
    conformM: res.conformM,
    ...over,
  };
}

/** The S7 done-check's own metric: the fraction of cells INSIDE the disc scoring above `t`. */
function fracAbove(geo: DiscGeometry, scores: Float64Array, t: number): number {
  const mask = buildScoreMask(geo);
  let inside = 0;
  let hot = 0;
  for (let dy = 0; dy < geo.n; dy++) {
    for (let dx = 0; dx < geo.n; dx++) {
      if (mask[(dy + geo.offset) * geo.nGrid + dx + geo.offset] === 0) continue;
      inside++;
      if (scores[dy * geo.n + dx] > t) hot++;
    }
  }
  return inside > 0 ? hot / inside : 0;
}

function centreCell(geo: DiscGeometry): number {
  const h = (geo.n - 1) / 2;
  return h * geo.n + h;
}

// =============================================================================================
// 1. THE BUILT-DENSITY PRIOR
// =============================================================================================

describe("S7 — the built-density prior, and the threshold that decides it", () => {
  it("MEASURED — the density of a surveyed tile and of the same tile with the layer gone", () => {
    // The input is FREE: it comes off tiles the disc parsed anyway. §3.2 measured 3×3 z14 rings —
    // Dnipro centre 558 buildings over ~21 km² (26.6/km²), rural UA 1 (0.048/km²), Everest 0. This
    // is the same reading on the committed single-tile fixture.
    const surveyed = builtDensityOf([TILE], LAT, TILE_Z);
    const stripped = builtDensityOf([TILE_NO_BUILDINGS], LAT, TILE_Z);
    const floor = BESTSPOT.builtDensityFloorPerKm2;
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(
      `[S7 density] hero z14 tile ${surveyed.toFixed(2)}/km² (${TILE.polys.filter((p) => p.kind === "building").length} buildings) · ` +
        `same tile, building layer removed ${stripped.toFixed(2)}/km² · floor ${floor}/km² ` +
        `⇒ ${(surveyed / floor).toFixed(1)}× headroom above, ∞ below`,
    );
    expect(surveyed).toBeGreaterThan(floor);
    expect(stripped).toBeLessThan(floor);
    // The floor is the geometric mean of §3.2's two measured populations, rounded down:
    // √(26.6 × 0.048) = 1.13 ⇒ 1. State it here so the derivation is checkable rather than quoted.
    expect(Math.sqrt(26.6 * 0.048)).toBeGreaterThan(floor);
    expect(Math.sqrt(26.6 * 0.048)).toBeLessThan(floor * 1.5);
    expect(builtDensityOf([], LAT, TILE_Z)).toBe(0); // no tiles ⇒ 0, never a division by zero
  });

  it("THE DEFECT, reproduced: a terrain-only disc is warm, uniform and 100 % confident", () => {
    // The negative control, and the whole reason the prior exists. Nothing here is unusual — flat
    // ground, ordinary landcover, a real sunset — and the disc comes back as the best place in the
    // world to stand.
    const geo = discGeometry(300, 12);
    const dsm = scene(geo);
    const res = solve(geo, dsm, uniformLand(geo, LAND_CODE.green), { builtEvidence: true });
    const scores = composeScores(res.terms, ctxFor(geo, res), SCORING);
    const centre = scores[centreCell(geo)];
    const frac = fracAbove(geo, scores, 0.6);
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(
      `[S7 pre-fix] terrain-only over green: S(centre) ${centre.toFixed(4)} ` +
        `(§3.2 measured 0.661) · coverage ${res.coverage.toFixed(3)} · ` +
        `unmapped ${res.unmappedFrac.toFixed(3)} · frac S>0.6 ${frac.toFixed(3)}`,
    );
    expect(res.coverage).toBeGreaterThan(0.99); // it claims to have looked everywhere…
    expect(res.unmappedFrac).toBe(0); // …nothing renders UNKNOWN…
    expect(centre).toBeGreaterThan(0.6); // …and the centre is warm and confident.
    expect(frac).toBeGreaterThan(0.9); // …as is essentially the whole disc.
  });

  it("§3.2's OTHER half (S = 0.470 over `unknown`) is already unreachable — S3c refuses it first", () => {
    // Worth stating because the two numbers in the spec have different fates. `0.470` was measured
    // over an `unknown` landcover grid — and an all-`unknown` grid is byte-identical to a grid no
    // source ever painted, which S3c REFUSES outright (`landcoverRaster.ts:182`: zero sources ⇒
    // every cell `unknown, soft 0.45, hard 1`, i.e. the water mask disappears). So the live failure
    // mode the prior has to answer is the `0.661` one, over real painted landcover. Reporting both
    // as if both still needed fixing would overstate what this slice does.
    const geo = discGeometry(300, 24);
    const res = solve(geo, scene(geo), uniformLand(geo, LAND_CODE.unknown), { builtEvidence: true });
    expect(res.refusal).toBe("no-landcover");
    expect(res.coverage).toBe(0);
    expect(res.unmappedFrac).toBe(1);
  });

  it("THE FIX: with no building survey, an OPEN-SKY ray stops being evidence", () => {
    // The prior withdraws the CLAIM rather than lowering the SCORE. `openSky` means "nothing stands
    // between you and the horizon" — with no survey behind it, that sentence is not a measurement,
    // so the ray is not credited, `C` falls, and the cell lands in the UNKNOWN render class through
    // the machinery that already exists.
    const geo = discGeometry(300, 12);
    const dsm = scene(geo);
    const res = solve(geo, dsm, uniformLand(geo, LAND_CODE.green), { builtEvidence: false });
    const ctx = ctxFor(geo, res);
    const scores = composeScores(res.terms, ctx, SCORING);
    const frac = fracAbove(geo, scores, 0.6);
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(
      `[S7 prior ON] terrain-only over green: frac S>0.6 ${frac.toFixed(4)} (want < 0.05) · ` +
        `coverage ${res.coverage.toFixed(3)} · unmapped ${res.unmappedFrac.toFixed(3)} · ` +
        `${res.openSkyUncredited} cell-azimuth visits withheld`,
    );
    expect(frac).toBeLessThan(0.05); // THE DONE-CHECK
    expect(res.openSkyUncredited).toBeGreaterThan(0); // …and the prior is what did it
    expect(res.coverage).toBeLessThan(SCORING.gates.minCoverage);

    // UNKNOWN IS A RENDER CLASS, NEVER A LOW SCORE. The pack has to say so on the `.g` channel,
    // or the sheet paints a cold colour over ground nobody looked at — which is the same lie in
    // the opposite direction.
    const pack = composeField(res.terms, ctx, SCORING);
    let unknownG = 0;
    let scoredG = 0;
    for (let i = 1; i < pack.rg8.length; i += 2) {
      if (pack.rg8[i] === STAND_G.unknown) unknownG++;
      else scoredG++;
    }
    expect(unknownG).toBeGreaterThan(0);
    expect(scoredG).toBe(0);
    expect(pack.unmappedFrac).toBeGreaterThan(0.9);
  });

  it("EVEREST — terrain-only, but with REAL RELIEF the disc still scores", () => {
    // The three-site done-check's third row, and the reason the prior gates on `openSky` rather
    // than on "are there buildings". A ray whose horizon is a measured ridge is evidence whatever
    // the building layer says; a ray that claims empty sky is not. ONE rule, two answers.
    const geo = discGeometry(300, 12);
    const relief = scene(geo, { ridge: { distM: 600, heightM: 400, azDeg: TRACK.setAzDeg } });
    const res = solve(geo, relief, uniformLand(geo, LAND_CODE.green), { builtEvidence: false });
    const scores = composeScores(res.terms, ctxFor(geo, res), SCORING);
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(
      `[S7 Everest] terrain-only + 400 m ridge, prior ON: coverage ${res.coverage.toFixed(3)} · ` +
        `unmapped ${res.unmappedFrac.toFixed(3)} · ${res.openSkyUncredited} visits withheld · ` +
        `frac S>0.6 ${fracAbove(geo, scores, 0.6).toFixed(3)}`,
    );
    expect(res.openSkyUncredited).toBe(0); // no ray claimed open sky — nothing to withhold
    expect(res.coverage).toBeGreaterThan(0.99); // the relief IS the evidence
    expect(res.unmappedFrac).toBe(0);
    // …and it is honestly a BAD place to watch a sunset from, which is a different statement from
    // "unknown" and the sheet renders it differently.
    expect(fracAbove(geo, scores, 0.6)).toBe(0);
  });

  it("the prior is OFF by default — nothing shipped before S7 moves", () => {
    const geo = discGeometry(120, 24);
    const dsm = scene(geo);
    const land = uniformLand(geo, LAND_CODE.green);
    const a = solve(geo, dsm, land);
    const b = solve(geo, dsm, land, { builtEvidence: true });
    expect(a.openSkyUncredited).toBe(0);
    expect(a.coverage).toBe(b.coverage);
    expect(a.unmappedFrac).toBe(b.unmappedFrac);
  });
});

// =============================================================================================
// 2. THE `reachM` REFUSAL POLICY
// =============================================================================================

describe("S7 — `refuseBelowReachM` is ON, at the one threshold that costs nothing", () => {
  it("the ceiling IS the collar — the two numbers must stay the same number", () => {
    // `as const` cannot self-reference, so this is the only form of the rule that can FAIL. On a
    // fully-mapped disc a RIM cell has exactly the collar's worth of evidence up-sun and no more,
    // so a threshold above the collar refuses the rim of a disc with nothing wrong with it.
    expect(BESTSPOT.refuseBelowReachM).toBe(BESTSPOT.collarM);
  });

  it("MEASURED — a fully-mapped disc refuses ZERO cells at EVERY rung of the ladder", () => {
    // The calibration in `bestSpotSolver.test.ts` was taken at 3 m. The ladder climbs 24 → 12 → 6
    // → 3, and `reachM` is the along-ray distance of the last KNOWN SLOT — a quantity quantised by
    // the cell pitch. A coarse rung could therefore report a reach one cell short of the collar and
    // refuse a perfectly good rim, which is exactly the case "the calibration missed" would look
    // like. It does not: measured below at all four.
    const rows: string[] = [];
    for (const cellM of BESTSPOT.ladderCellsM) {
      const geo = discGeometry(300, cellM);
      const res = solve(geo, scene(geo), uniformLand(geo, LAND_CODE.green), {
        refuseBelowReachM: BESTSPOT.refuseBelowReachM,
      });
      rows.push(`${cellM}m→${res.refusedShortReach}`);
      expect(res.refusedShortReach).toBe(0);
      expect(res.unmappedFrac).toBe(0);
    }
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(
      `[S7 refuse] fully-mapped 300 m disc at ${BESTSPOT.refuseBelowReachM} m, per rung: ${rows.join("  ")}`,
    );
  });

  it("…and the TRUNCATED disc withdraws its claim, which is the whole point of §3.1", () => {
    // §3.1's headline: missing data does not read as "unknown", it reads as THE BEST SPOT ON THE
    // MAP. With the DSM stopping at 350 m the centre cell scored 0.6633 against a truth of 0.0000
    // and claimed open sky on all 40 rays. S3c's `reachM` gate took that to 0.5530; the POLICY
    // takes it to nothing at all.
    const geo = discGeometry(300, 6);
    const truncated = scene(geo, { truncateM: 350 });
    const land = uniformLand(geo, LAND_CODE.green);
    const off = solve(geo, truncated, land);
    const on = solve(geo, truncated, land, { refuseBelowReachM: BESTSPOT.refuseBelowReachM });
    const c = centreCell(geo);
    const sOff = composeScores(off.terms, ctxFor(geo, off), SCORING)[c];
    const sOn = composeScores(on.terms, ctxFor(geo, on), SCORING)[c];
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(
      `[S7 truncated] centre S ${sOff.toFixed(4)} → ${sOn.toFixed(4)} · ` +
        `unmapped ${off.unmappedFrac.toFixed(3)} → ${on.unmappedFrac.toFixed(3)} · ` +
        `${on.refusedShortReach} cells refused`,
    );
    expect(sOff).toBeGreaterThan(0.4); // the defect is present without the policy…
    expect(sOn).toBe(0); // …and the claim is withdrawn with it
    expect(on.refusedShortReach).toBeGreaterThan(0);
    expect(on.unmappedFrac).toBeGreaterThan(off.unmappedFrac);
    // WITHDRAWN, not down-scored: the refused cells report zero COVERAGE, which is what makes them
    // the UNKNOWN render class rather than a cold patch.
    expect(on.terms.c[c]).toBe(0);
  });
});

// =============================================================================================
// 3. R8 — THE 1 m SHORTLIST, WHICH SPLITS IN TWO
// =============================================================================================

describe("S7/R8 — 1 m ACCESSIBILITY on every solve; 1 m OBSTRUCTION only on demand", () => {
  const geo = discGeometry(300, 3);
  const frame = makeLandGrid({
    centreLatDeg: LAT,
    centreLonDeg: LON,
    halfSpanM: geo.radiusM,
    cellM: 1,
  }).frame;

  /** The 3 m field the shortlist is drawn from — every cell fully covered, ordinary ground. */
  function field(cls: number) {
    const res = solve(geo, scene(geo), uniformLand(geo, cls));
    const scores = composeScores(res.terms, ctxFor(geo, res), SCORING);
    // A gradient, so the ranking is a ranking rather than a plateau the NMS has to invent order in.
    for (let i = 0; i < scores.length; i++) scores[i] = 0.2 + 0.6 * ((i % 97) / 97);
    return { res, scores };
  }

  it("the done-check: shortlist rows report `gridCellM === 1` while the field reports 3", () => {
    const { res, scores } = field(LAND_CODE.green);
    const fine: FineAccess = {
      land: buildLandGrid(
        { centreLatDeg: LAT, centreLonDeg: LON, halfSpanM: geo.radiusM, cellM: 1 },
        [TILE],
        { roadWidthM: VECTOR.roadWidthM, waterwayWidthM: VECTOR.waterwayWidthM },
      ),
      cellM: 1,
      candidates: BESTSPOT.shortlistCandidates,
    };
    const rows = shortlist(res.terms, scores, SCORING, geo, frame, TRACK, EYE_M, 8, 25, fine);
    expect(rows.length).toBeGreaterThan(0);
    expect(geo.cellM).toBe(3);
    for (const r of rows) {
      expect(r.gridCellM).toBe(1); // ACCESSIBILITY, re-solved
      expect(r.obstructionRefined).toBe(false); // OBSTRUCTION, still the field's
    }
    // …and WITHOUT the fine pass the rows honestly report the field's own pitch. An unqualified
    // "1 m" when the pass did not run is exactly the C2 violation §8 names.
    const coarse = shortlist(res.terms, scores, SCORING, geo, frame, TRACK, EYE_M, 8, 25, null);
    for (const r of coarse) expect(r.gridCellM).toBe(3);
  });

  it("a candidate the 1 m grid puts in the water is DROPPED — the whole point of the pass", () => {
    // "Stand on the footpath, not in the hedge", stated as the failure it prevents. The fine grid
    // here is REAL: the hero tile's own water polygons at 1 m. A 3 m cell that straddles a bank
    // resolves to the wrong side often enough that this is the ordinary case, not the corner one.
    const { res, scores } = field(LAND_CODE.green);
    const real = buildLandGrid(
      { centreLatDeg: LAT, centreLonDeg: LON, halfSpanM: geo.radiusM, cellM: 1 },
      [TILE],
      { roadWidthM: VECTOR.roadWidthM, waterwayWidthM: VECTOR.waterwayWidthM },
    );
    // A fine grid that says WATER everywhere: the strongest form of the test, because every
    // surviving row would then be a row the pass failed to look at.
    const allWater = makeLandGrid({
      centreLatDeg: LAT,
      centreLonDeg: LON,
      halfSpanM: geo.radiusM,
      cellM: 1,
    });
    allWater.cls.fill(LAND_CODE.water);
    const drowned = shortlist(res.terms, scores, SCORING, geo, frame, TRACK, EYE_M, 8, 25, {
      land: allWater,
      cellM: 1,
      candidates: res.terms.cellCount, // every candidate, so nothing survives by falling out of the window
    });
    expect(drowned).toEqual([]);
    // POSITIVE CONTROL: the same call over the REAL 1 m grid does return rows, so the zero above
    // is the water mask and not a dead harness.
    const alive = shortlist(res.terms, scores, SCORING, geo, frame, TRACK, EYE_M, 8, 25, {
      land: real,
      cellM: 1,
      candidates: BESTSPOT.shortlistCandidates,
    });
    expect(alive.length).toBeGreaterThan(0);
  });

  it("MEASURED — what the 1 m accessibility pass costs, and what it changes", () => {
    const { res, scores } = field(LAND_CODE.green);
    const t0 = performance.now();
    const real = buildLandGrid(
      { centreLatDeg: LAT, centreLonDeg: LON, halfSpanM: geo.radiusM, cellM: 1 },
      [TILE],
      { roadWidthM: VECTOR.roadWidthM, waterwayWidthM: VECTOR.waterwayWidthM },
    );
    const gridMs = performance.now() - t0;
    const t1 = performance.now();
    const fine = shortlist(res.terms, scores, SCORING, geo, frame, TRACK, EYE_M, 8, 25, {
      land: real,
      cellM: 1,
      candidates: BESTSPOT.shortlistCandidates,
    });
    const passMs = performance.now() - t1;
    const coarse = shortlist(res.terms, scores, SCORING, geo, frame, TRACK, EYE_M, 8, 25, null);
    const moved = fine.filter((r, i) => coarse[i]?.key !== r.key).length;
    // eslint-disable-next-line no-console -- the measurement IS the deliverable. The `moved` count
    // is NOT §8 Q3's "4 of the top 20": that figure came from a real 1 m OBSTRUCTION re-solve on a
    // real disc, and this field is a synthetic tie-heavy gradient, so its ordering is dominated by
    // the soft-rung rescale. What is being measured here is the COST.
    console.log(
      `[S7 R8 fine] 1 m grid ${real.nx}² built in ${gridMs.toFixed(1)} ms · re-rank of ` +
        `${BESTSPOT.shortlistCandidates} candidates ${passMs.toFixed(1)} ms · ` +
        `${moved} of ${fine.length} rows differ on a synthetic gradient (§8 Q3's own figure is 4 of 20)`,
    );
    // §8 Q3 budgets the whole thing at +52-59 ms and calls it invisible. The grid is the cost.
    expect(gridMs + passMs).toBeLessThan(250);
  });

  it("ULTRA stays FORBIDDEN above a 300 m radius — in the SOLVER, not only in the store", () => {
    // R8's rider, and it is enforced twice on purpose: `store/bestSpot` clears the flag when the
    // radius grows past the ceiling, and the solver re-checks because a hand-built `DiscGeometry`
    // is a legal object and "the store enforces it" is not enforcement.
    expect(BESTSPOT.ultraMaxRadiusM).toBe(ULTRA_MAX_RADIUS_M);
    expect(() => discGeometry(500, 1)).toThrow(/ULTRA/);
    expect(() => discGeometry(ULTRA_MAX_RADIUS_M, 1)).not.toThrow();
    // …and a hand-built geometry cannot smuggle it past `solveTerms` either.
    const legal = discGeometry(ULTRA_MAX_RADIUS_M, 1);
    const illegal = { ...legal, radiusM: 500 };
    expect(() =>
      solveTerms({
        dsm: scene(legal),
        land: uniformLand(legal, LAND_CODE.green),
        track: TRACK,
        geo: illegal,
        eyeM: EYE_M,
        liftM: 0,
        refractionK: K_REFRACT,
        scoring: SCORING,
      }),
    ).toThrow(/ULTRA/);
  });
});

// =============================================================================================
// 4. THE NON-NEGOTIABLES, RE-CHECKED AFTER THE SLICE
// =============================================================================================

describe("S7 — the safety bits and the vegetation clamp still hold", () => {
  it("`graze.conf.tree` cannot be raised past 0.6, because vegetation is FICTION", () => {
    // 151,046 of Dnipro's 161,823 canopies are seeded scatter with jittered class-default heights;
    // only 628 are surveyed points; outside the two baked cities there are none at all. The framing
    // term may NOTICE a tree line — R5 deleted the provenance gate so it scores at all — but it may
    // never fire CONFIDENTLY on one.
    expect(BESTSPOT_SAFETY.confTreeMax).toBe(0.6);
    const patched = resolveScoring(sanitizeScoringPatch({ graze: { conf: { tree: 1 } } }));
    expect(patched.graze.conf.tree).toBeLessThanOrEqual(BESTSPOT_SAFETY.confTreeMax);
    // …and it can still be LOWERED, so the clamp is a ceiling and not a constant.
    expect(resolveScoring(sanitizeScoringPatch({ graze: { conf: { tree: 0.2 } } })).graze.conf.tree).toBe(0.2);
  });

  it("water · building · blocked stay `hard = 0`, and no patch can reach them", () => {
    // The eleven `GROUND[*].hard` bits are `BESTSPOT_SAFETY`, a SEPARATE export precisely so the
    // deep merge has no key path to them. Tuning them does not make the answer different, it makes
    // it dangerous.
    for (const cls of ["water", "building", "blocked"] as const) {
      expect(BESTSPOT_SAFETY.groundHard[cls]).toBe(0);
    }
    // The cast is the test: `BestSpotScoringPatch` HAS no `groundHard` key — `BESTSPOT_SAFETY` is a
    // separate export precisely so the deep merge cannot reach it — so the hostile patch has to be
    // smuggled past the type to prove the RUNTIME drops it too.
    const hostile = sanitizeScoringPatch({
      groundHard: { water: 1 },
      access: { soft: { water: 1 } },
    } as BestSpotScoringPatch);
    expect("groundHard" in hostile).toBe(false);
    expect(resolveScoring(hostile).access.soft.water).toBe(1); // the SOFT rung is tunable…
    expect(BESTSPOT_SAFETY.groundHard.water).toBe(0); // …the HARD bit is not.
  });

  it("C6 — the solver is ephemeral: nothing it produces carries a persistable identity", () => {
    // "It stays local and ephemeral, is never persisted onto a public pin." The enforcement that
    // matters is upstream (`store/bestSpot` persists the scoring PATCH and nothing else), but the
    // shape here is what makes that easy to keep: a solved row is a grid key plus a lat/lon, with
    // no id, no timestamp and no handle a persistence layer could latch onto.
    const g = discGeometry(60, 20, 40);
    const res = solve(g, scene(g), uniformLand(g, LAND_CODE.green));
    const scores = composeScores(res.terms, ctxFor(g, res), SCORING);
    const rows = shortlist(res.terms, scores, SCORING, g, makeLandGrid({
      centreLatDeg: LAT,
      centreLonDeg: LON,
      halfSpanM: 60,
      cellM: 20,
    }).frame, TRACK, EYE_M, 8, 25);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        [
          "aerial",
          "bearingDeg",
          "contact",
          "distM",
          "gridCellM",
          "groundReachable",
          "key",
          "latDeg",
          "leadMs",
          "lonDeg",
          "note",
          "obstructionRefined",
          "rank",
          "score",
        ].sort(),
      );
    }
  });
});
