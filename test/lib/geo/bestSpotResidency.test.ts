import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseVectorTile, type ParsedVtile } from "../../../src/components/globe/scene/vectorTiles";
import {
  BESTSPOT_SCORING_V1,
  CLASS_OF,
  INVALIDATION_RANK,
  scoringHash,
  trackHash,
} from "../../../src/lib/geo/bestSpotScoring";
import { eventTrack } from "../../../src/lib/geo/bestSpotTrack";
import type { BestSpotKind, EventTrack } from "../../../src/lib/geo/bestSpotTypes";
import {
  builtDensityOf,
  solveRung,
  trackKeyOf,
  type BestSpotSolveJob,
  type Resident,
  type TinMeshWire,
} from "../../../src/lib/geo/bestSpotWorker";
import { enuFrameAt, type EnuFrame } from "../../../src/lib/geo/localDsm";
import { BESTSPOT, PLAN, VECTOR } from "../../../src/components/globe/tuning";
import { timeNormalised } from "./_perf";

/**
 * =============================================================================================
 * **S6 — THE RESIDENCY CONTRACT, AS ONE FALSIFIABLE NUMBER.**
 * =============================================================================================
 *
 * `BESTSPOT_SPEC_V2 §7 S6`, re-pinned:
 *
 * > `hullBuilds` is EXACTLY **0** for a within-day scene-time scrub and for a 2 → 400 m lift drag,
 * > grows by at most `ceil(Δaz/azStep)` for a day step, and increments exactly once on a radius
 * > change.
 *
 * **This is THE falsifiable pin of the whole architecture.** The thesis the feature is built on is
 * that the per-ray upper convex hull is invariant in BOTH scene time AND eye height, so the
 * scrubber and the altitude slider pay only a cheap max-angle query. Restore an `(H,D)` slab —
 * the form this design replaced — and the lift row goes from 0 to K immediately, because that form
 * is a function of the eye. Nothing else in the test suite can tell those two architectures apart.
 *
 * **IT DOES NOT RUN AGAINST THE SOLVER, AND THAT IS THE POINT.** The kernel's half of the
 * invariant already had a pin (`bestSpotSolver.test.ts`, "a LIFT change re-queries the resident
 * hulls and rebuilds NONE of them"). It was green, and the feature still rebuilt every hull on
 * every drag frame, because `solveRung` called `buildDsm` unconditionally and handed the solver a
 * FRESH `ground` array — and the hull cache is keyed on that array's IDENTITY. The invariant was
 * correct in the kernel and thrown away one layer up. So these pins drive `bestSpotWorker.solveRung`
 * over a real `Resident`, which is the layer where the contract is actually kept or lost.
 *
 * **THE SOURCES ARE REAL.** `fixtures/ofm-z14-9787-5662-dnipro-central-bridge.pbf` is the committed
 * OpenFreeMap z14 tile over the owner's hero location (21 buildings, 108 landcover, 5 water), and
 * the track is a real astronomy-engine sunset. Only the terrain TIN is synthetic — a flat quad, so
 * the numbers below are about RESIDENCY and not about a particular skyline.
 *
 * House rules honoured: no clock (`Date.UTC` constants only), no three, no store, no DOM.
 */

const FIXTURE = join(__dirname, "fixtures", "ofm-z14-9787-5662-dnipro-central-bridge.pbf");
const TX = 9787;
const TY = 5662;
const TILE_Z = 14;
/** The tile's own centre-ish point — the Dnipro Central Bridge, the owner's hero location. */
const LAT = 48.47831;
const LON = 35.05757;
/** The scene epoch. An explicit constant — this module never reads a clock (house rule). */
const DAY_MS = Date.UTC(2026, 7, 24, 12);
const DAY = 86_400_000;
const SCORING = BESTSPOT_SCORING_V1;
const K_REFRACT = PLAN.refractionK;

const TILE: ParsedVtile = parseVectorTile(
  readFileSync(FIXTURE).buffer.slice(0) as ArrayBuffer,
  TX,
  TY,
);

/** One flat axis-aligned TIN quad in the local ENU tangent plane — the `bestSpotWorker.test.ts`
 *  idiom. Flat on purpose: this file measures RESIDENCY, not a skyline. */
function flatQuad(frame: EnuFrame, halfM: number, heightM = 0): TinMeshWire {
  const p: number[] = [];
  const corner = (e: number, n: number) => {
    p.push(
      frame.originEcef[0] + e * frame.east[0] + n * frame.north[0] + heightM * frame.up[0],
      frame.originEcef[1] + e * frame.east[1] + n * frame.north[1] + heightM * frame.up[1],
      frame.originEcef[2] + e * frame.east[2] + n * frame.north[2] + heightM * frame.up[2],
    );
  };
  corner(-halfM, -halfM);
  corner(halfM, -halfM);
  corner(halfM, halfM);
  corner(-halfM, -halfM);
  corner(halfM, halfM);
  corner(-halfM, halfM);
  return {
    positions: Float32Array.from(p),
    index: null,
    matrixWorld: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  };
}

function trackFor(kind: BestSpotKind, sceneMs: number): EventTrack {
  const t = eventTrack(
    { latDeg: LAT, lonDeg: LON, groundAltM: 0, eyeAboveGroundM: BESTSPOT.eyeM },
    kind,
    sceneMs,
    { refractionK: K_REFRACT, scoring: SCORING, snapAzLattice: true },
  );
  if (!t) throw new Error("fixture: no track");
  return t;
}

function job(over: Partial<BestSpotSolveJob> = {}): BestSpotSolveJob {
  return {
    type: "solve",
    jobId: 1,
    epoch: 0,
    scoring: SCORING,
    scoringHash: scoringHash(SCORING),
    centreLatDeg: LAT,
    centreLonDeg: LON,
    frameAltM: 0,
    radiusM: BESTSPOT.defaultRadiusM,
    collarM: BESTSPOT.collarM,
    ladderCellsM: [...BESTSPOT.ladderCellsM],
    kind: "sunset",
    sceneMs: DAY_MS,
    eyeM: BESTSPOT.eyeM,
    liftM: 0,
    refractionK: K_REFRACT,
    displayLo: BESTSPOT.displayLo,
    displayHi: BESTSPOT.displayHi,
    ribbonWidths: {
      roadWidthM: VECTOR.roadWidthM,
      waterwayWidthM: VECTOR.waterwayWidthM,
    },
    tileJsonUrl: "",
    tileZ: TILE_Z,
    minTilesForSolve: BESTSPOT.minTilesForSolve,
    terrain: [],
    built: [],
    heightProvenance: { enriched: 0, osm: 0 },
    sourcesEpoch: 0,
    mode: "resident",
    liftProbesM: [],
    liftProbeCellM: BESTSPOT.liftProbeCellM,
    emptyFieldFrac: BESTSPOT.emptyFieldFrac,
    topK: BESTSPOT.topK,
    topKMinSepM: BESTSPOT.topKMinSepM,
    refuseBelowReachM: BESTSPOT.refuseBelowReachM,
    builtDensityFloorPerKm2: BESTSPOT.builtDensityFloorPerKm2,
    shortlistCandidates: BESTSPOT.shortlistCandidates,
    shortlistCellM: BESTSPOT.ultraCellM,
    ...over,
  };
}

/** A `Resident` in the state `runSolve` leaves it in after the tiles and the track have landed —
 *  which is exactly the state every tier below T0 starts from. */
function resident(over: Partial<Resident> = {}): Resident {
  const frame = enuFrameAt(LAT, LON, 0);
  const tiles = [TILE];
  return {
    key: "fixture",
    centreLatDeg: LAT,
    centreLonDeg: LON,
    radiusM: BESTSPOT.defaultRadiusM,
    collarM: BESTSPOT.collarM,
    frame,
    frameAltM: 0,
    // No canopies in this fixture — it is a residency pin, not a vegetation one, and an empty
    // canopy list is exactly the pre-2026-08-26g DSM these numbers were measured against.
    canopies: [],
    // 1,000 m half-width covers the 700 m sweep grid with room for the rim's own reach.
    terrain: [flatQuad(frame, 1_000)],
    built: [],
    heightProvenance: { enriched: 0, osm: 0 },
    sourcesKey: "0|1|0",
    tiles,
    tilesNeeded: 1,
    builtDensityPerKm2: builtDensityOf(tiles, LAT, TILE_Z),
    terrainOnly: false,
    fineLand: null,
    fineLandKey: "",
    track: trackFor("sunset", DAY_MS),
    trackKey: "sunset|0",
    rungs: new Map(),
    finestCellM: Number.POSITIVE_INFINITY,
    eyeM: BESTSPOT.eyeM,
    liftM: 0,
    refractionK: K_REFRACT,
    kind: "sunset",
    moonWorth: 1,
    terrainPostingM: 0,
    ...over,
  };
}

/** Run one rung THE WAY `runSolve` does — solve, then install it as the resident rung. */
function climb(j: BestSpotSolveJob, res: Resident, cellM: number): number {
  const rung = solveRung(j, res, cellM);
  if (!rung) throw new Error("fixture: rung refused");
  res.rungs.set(cellM, rung);
  res.finestCellM = Math.min(res.finestCellM, cellM);
  return rung.hullBuilds;
}

const COARSE = BESTSPOT.ladderCellsM[0];

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * **WHY THE TIMING PINS BELOW CARRY THE PLAN'S BUDGET ON THE MEDIAN AND REPORT THE p95.**
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * The plan states both budgets as p95, and a p95 is a claim about a USER waiting. `npm test` runs
 * this file inside one of ~12 parallel vitest workers on the same CPU, so the TAIL here measures
 * the runner's contention rather than the solver: run standalone this file reports a 24 m p95 of
 * **9.1 ms** and a 3 m p95 of **591-616 ms**; run inside the full suite the identical code reports
 * **31.9 ms** and **1,046 ms**. Pinning the contended tail makes the suite flaky; RAISING the
 * budget to fit it makes the number meaningless. So the median carries the plan's budget, the p95
 * is printed on every run so a regression is visible in the log, and a hard ceiling catches a
 * regression that is not subtle. The standalone p95 is what the plan's own form of the pin asks
 * for, and it passes with 3.6× and 1.6× of headroom respectively.
 *
 * **THE UNIT IS CALIBRATED, NOT THE BUDGET (2026-08-24).** A fixed `×2` on the WALL CLOCK was
 * measured to fail on a machine at load average 30+ (the full suite, a `wix dev` server and a CDP
 * Chrome all running): the identical solver reported a 3 m median of 646 ms standalone and
 * 1,380-1,522 ms in-suite. A wall-clock constant inside a 12-way-parallel runner is a claim about
 * the RUNNER, so it is a false alarm in one direction and — if raised to fit the worst machine — a
 * rubber ruler in the other.
 *
 * So **both numbers below are exactly where the plan put them** (33 ms and 1,000 ms on the median,
 * `TAIL_CONTENTION_K ×` that on the tail) and only the UNIT moved: `_perf.timeNormalised` times a
 * fixed arithmetic workload IN THIS PROCESS immediately before each iteration, divides by what that
 * workload costs on an idle M3 Pro, and reports the sample in *reference-machine* milliseconds. A
 * solver regression still fails — the calibration loop does not get slower when the solver does —
 * while machine load no longer does. The calibration must be INTERLEAVED and not taken once up
 * front: measured, a single `machineK()` before the loop read `k = 1.04` while the solves it was
 * normalising ran at a median of 1,335 ms, because vitest's other workers happened to be between
 * files at that instant. Contention is bursty. The factor is clamped (`_perf.MACHINE_K_MAX`) so a
 * pathologically slow box cannot dissolve the pin entirely, and both scales are printed on every run.
 */
const TAIL_CONTENTION_K = 2;

// =============================================================================================
// THE PIN
// =============================================================================================

describe("S6 — `hullBuilds` is the residency contract, and it is ONE number", () => {
  it("MEASURED — the four tiers, side by side", () => {
    const res = resident();
    const K = res.track!.samples.length;
    const first = climb(job(), res, COARSE);

    // T1′ — a scene-time scrub INSIDE the same local day. `eventTrack` frames on `localDayWindow`,
    // so the track is byte-identical and the azimuth set does not move at all.
    const scrub = climb(job({ sceneMs: DAY_MS + 3 * 3_600_000 }), res, COARSE);

    // T1 — the 2 → 400 m lift drag, at the coarse rung the drag actually runs at.
    let drag = 0;
    for (const liftM of [2, 10, 25, 60, 120, 200, 300, 400]) {
      drag += climb(job({ liftM }), res, COARSE);
    }

    // T0.5 — a DAY step. The lattice snapping is what makes this small.
    const dayRes = resident({
      rungs: res.rungs,
      track: trackFor("sunset", DAY_MS + DAY),
    });
    const dayStep = climb(job({ sceneMs: DAY_MS + DAY }), dayRes, COARSE);
    const K2 = dayRes.track!.samples.length;

    // T0 — a RADIUS change. A different disc is a different height field, so this one is K by
    // construction; what the pin is about is that it happens ONCE.
    const wide = resident({ radiusM: 500 });
    const radius = climb(job({ radiusM: 500 }), wide, COARSE);
    const radiusAgain = climb(job({ radiusM: 500 }), wide, COARSE);

    // eslint-disable-next-line no-console -- the measurement IS the deliverable (house idiom)
    console.log(
      `[S6 residency] K=${K}  first solve ${first}  ·  within-day scrub ${scrub}  ·  ` +
        `2→400 m drag (8 frames) ${drag}  ·  day step ${dayStep}/${K2}  ·  ` +
        `radius change ${radius} then ${radiusAgain}`,
    );

    // ── the contract ────────────────────────────────────────────────────────────────────────
    expect(first).toBe(K); // the cold solve pays for every azimuth — the positive control
    expect(scrub).toBe(0); // T1′: 0 ms, and 0 hulls
    expect(drag).toBe(0); // T1: THE PIN. An `(H,D)` slab makes this 8·K.
    // T0.5: at most `ceil(Δaz/azStep)`. Measured: the +1-day window shares all but ~2 of its
    // azimuths with the previous day's ON THE ABSOLUTE LATTICE (0/40 without the snapping).
    const dAz = Math.abs(dayRes.track!.setAzDeg - res.track!.setAzDeg);
    const budget = Math.ceil(dAz / 0.25);
    expect(dayStep).toBeLessThanOrEqual(budget);
    expect(dayStep).toBeLessThan(K2); // …and strictly cheaper than a cold rebuild
    expect(radius).toBe(K); // T0: a new disc is a new height field
    expect(radiusAgain).toBe(0); // …ONCE. The second frame at the same radius is free.
  });

  it("THE NEGATIVE CONTROL — break the sources invariant and the drag costs K per frame", () => {
    // This is the shape the pin exists to catch, reproduced: a `Resident` whose `sourcesKey` moves
    // on every frame is exactly what a rebuilt DSM (or a restored `(H,D)` slab, which is a function
    // of the eye) looks like from here. If this does NOT blow up, the pin above proves nothing.
    const res = resident();
    const K = res.track!.samples.length;
    climb(job(), res, COARSE);
    let drag = 0;
    let epoch = 1;
    for (const liftM of [2, 100, 400]) {
      res.sourcesKey = `${epoch++}|1|0`;
      drag += climb(job({ liftM }), res, COARSE);
    }
    expect(drag).toBe(3 * K);
  });

  it("a KIND change is a full rebuild BECAUSE the windows are disjoint — not because the cache is", () => {
    // The hull cache is keyed on the SNAPPED AZIMUTH and on nothing else, so "sunrise costs K" has
    // to be explained by geometry rather than accepted as a cache miss. It is: at Dnipro in August
    // the sunrise and sunset windows do not share a single azimuth. The pin states BOTH halves, so
    // a future cache keyed on the kind (a real regression) fails the second one.
    const res = resident();
    climb(job(), res, COARSE);
    const sunrise = resident({
      rungs: res.rungs,
      track: trackFor("sunrise", DAY_MS),
    });
    const setAz = new Set(res.track!.samples.map((s) => Math.round(s.azDeg * 1e4)));
    const riseAz = sunrise.track!.samples.map((s) => Math.round(s.azDeg * 1e4));
    const shared = riseAz.filter((a) => setAz.has(a)).length;
    const builds = climb(job({ kind: "sunrise" }), sunrise, COARSE);
    const K2 = sunrise.track!.samples.length;
    // eslint-disable-next-line no-console -- measured, not asserted from theory
    console.log(
      `[S6 kind] sunset → sunrise: ${shared} of ${K2} azimuths shared ⇒ ${builds} rebuilt`,
    );
    expect(shared).toBe(0); // the WINDOWS are disjoint — that is the whole explanation
    expect(builds).toBe(K2 - shared);
    // …and the SAME sunrise a second time is free, which is what says the cache is keyed on the
    // azimuth and not on the event.
    expect(climb(job({ kind: "sunrise" }), sunrise, COARSE)).toBe(0);
  });
});

describe("S6 — the rung timings, at the rungs the plan actually pins", () => {
  it("MEASURED — coarse solve < 33 ms at 24 m (12 m structurally cannot pass)", () => {
    // `SPEC_V2 §2.3` re-pinned this: the shipped pin said 12 m and 12 m measures 54-83 ms. 24 m
    // measures 21 ms, and 24 m IS `BESTSPOT.dragCellM`, so the rung the pin is about is the rung
    // the drag runs at. See `TAIL_CONTENTION_K` for what carries the budget and in what unit.
    expect(COARSE).toBe(BESTSPOT.dragCellM);
    const res = resident();
    climb(job(), res, COARSE); // warm: the drag never pays the cold hull build
    const t = timeNormalised(`S6 coarse ${COARSE} m rung`, 20, (i) => {
      climb(job({ liftM: 2 + i * 20 }), res, COARSE);
    });
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(`${t.line} — §2.3 measured 21 ms; standalone p95 ~9 ms`);
    expect(t.medianRefMs).toBeLessThan(33);
    expect(t.p95RefMs).toBeLessThan(33 * TAIL_CONTENTION_K);
    // Twenty drag frames plus twenty interleaved calibrations. The BUDGET is the assertion above;
    // the number below is only the harness's patience, and it has to cover the contended case the
    // pin exists to survive — the calibration alone is ~27 ms quiet and was measured at 135 ms on
    // a 2× oversubscribed box, i.e. 13× what the rung it is normalising costs.
  }, 60_000);

  it("MEASURED — full solve < 1,000 ms at the 3 m default", () => {
    // See `TAIL_CONTENTION_K` for what carries the budget and in what unit.
    const fine = BESTSPOT.defaultCellM;
    // A COLD full solve each time — a fresh `Resident` pays the hull build, which is the honest
    // reading of "full solve" (a warm one is the T1 tier and is measured above). Building it is
    // `setup`, so it stays OUTSIDE the timed region exactly as it did when this loop was inline.
    let res = resident();
    const t = timeNormalised(
      `S6 full ${fine} m COLD solve`,
      5,
      (i) => {
        climb(job({ liftM: i }), res, fine);
      },
      () => {
        res = resident();
      },
    );
    // eslint-disable-next-line no-console -- the measurement IS the deliverable
    console.log(`${t.line} (n=5 ⇒ p95 IS the maximum; standalone ~600 ms)`);
    expect(t.medianRefMs).toBeLessThan(1000);
    expect(t.p95RefMs).toBeLessThan(1000 * TAIL_CONTENTION_K);
    // Five cold 3 m solves measured at 1,300-1,800 ms EACH in-suite, plus five calibrations: the
    // 5 s default expired mid-loop and reported a TIMEOUT rather than a number, which is the one
    // outcome a measurement pin must never produce.
  }, 180_000);
});

/**
 * =============================================================================================
 * **THE T0.5 KEY — and the two profile leaves that were silently dead until 2026-08-26g.**
 * =============================================================================================
 *
 * `eventTrack` bakes `trackWeight.altScaleDeg` and `trackWeight.horizonCeiling` into its own
 * per-sample weights `w_i` (`bestSpotTrack.ts:629-631, 950-957`), and `V` is integrated against
 * `w`. But the resident track was cached on `${kind}|${localDay}` alone, and both leaves were
 * classed `reweigh` — which `runApply` answers from the RESIDENT TERM BUFFER, where `V` already
 * carries the old weights. So a taste pass on either leaf changed nothing at all until the scene
 * crossed a local-day or kind boundary.
 *
 * **Nothing went red**, because every recompose/reweigh test in this repo asserts only that *some*
 * score moved for *some* patch — never that a patch's own mechanism ran. These three cases are the
 * missing assertions, and the third is the one that gives the other two meaning.
 */
describe("T0.5 — the track key covers what the track is a function of, and nothing else", () => {
  it("a `trackWeight` leaf MOVES the key — and really does move the weights it claims to", () => {
    const base = SCORING;
    const patched: typeof SCORING = {
      ...base,
      trackWeight: { ...base.trackWeight, altScaleDeg: base.trackWeight.altScaleDeg * 2 },
    };
    expect(trackKeyOf(job({ scoring: base }))).not.toBe(trackKeyOf(job({ scoring: patched })));

    // The key would be worth nothing if the leaf were inert in `eventTrack` too, so prove the
    // mechanism end to end: rebuild the track under the patch and show a real weight moved.
    const mk = (s: typeof SCORING) =>
      eventTrack(
        { latDeg: LAT, lonDeg: LON, groundAltM: 0, eyeAboveGroundM: BESTSPOT.eyeM },
        "sunset",
        DAY_MS,
        { refractionK: K_REFRACT, scoring: s, snapAzLattice: true },
      );
    const a = mk(base);
    const b = mk(patched);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // Same lattice (the absolute snap is unchanged), different weights — which is exactly the
    // shape that makes this a `rescore` and not a `rebuild`.
    expect(b!.samples.length).toBe(a!.samples.length);
    const moved = a!.samples.filter((s, i) => s.w !== b!.samples[i].w).length;
    expect(moved).toBeGreaterThan(0);
  });

  it("THE NEGATIVE CONTROL — a recompose leaf must NOT move the key", () => {
    // Without this, folding the whole `scoringHash` into the key would pass the case above while
    // making every 0.272 ms taste knob pay a full track rebuild. The key has to be narrow.
    const base = SCORING;
    const reweighted: typeof SCORING = {
      ...base,
      weights: { ...base.weights, v: base.weights.v + 0.1 },
    };
    expect(trackKeyOf(job({ scoring: reweighted }))).toBe(trackKeyOf(job({ scoring: base })));
    expect(trackHash(reweighted)).toBe(trackHash(base));
    // …and the key still moves for the two things it is *supposed* to track.
    expect(trackKeyOf(job({ kind: "sunrise" }))).not.toBe(trackKeyOf(job()));
  });

  it("both `trackWeight` leaves are classed `rescore` — `reweigh` cannot honour them", () => {
    // `reweigh` routes to `runApply` → `composeRung`, which never rebuilds the track. The class is
    // the half of the fix that makes a re-solve HAPPEN; `trackKeyOf` is the half that makes the
    // re-solve rebuild the track. Either alone is not a fix.
    for (const leaf of ["trackWeight.altScaleDeg", "trackWeight.horizonCeiling"] as const) {
      expect(INVALIDATION_RANK[CLASS_OF[leaf]]).toBeGreaterThanOrEqual(INVALIDATION_RANK.rescore);
    }
  });
});
