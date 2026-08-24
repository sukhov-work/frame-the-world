/**
 * BEST SPOT — THE SCORING PROFILE (`BESTSPOT_SPEC_V2.md` §5, slice S3a).
 *
 * The centrepiece is §5.8's **EVERY FIELD IS LIVE**: owner requirement (vii) is only enforceable if
 * a test goes red the day someone re-inlines a constant, which is exactly how all 37 unreachable
 * numbers got there in the first place. Every leaf of `BESTSPOT_SCORING_V1` is perturbed against a
 * FIXED probe of `cellScore` calls and must move the score by more than 1e-12.
 *
 * THE TEST CANNOT PASS VACUOUSLY, in three independent ways:
 *   · a perturbation that `resolveScoring` clamps back to the shipped value is NOT counted as a
 *     probe at all (it is asserted to differ first, then required to move);
 *   · `EXPECT_INERT_ON_FIXTURE` is asserted to be EXACTLY the set of inert leaves — an allowlisted
 *     leaf that starts moving fails the test just as loudly as a live leaf that stops;
 *   · the fixtures themselves carry pins (`V` inside the gate's ramp, `C` inside the coverage
 *     window, `F` coming from the notch and not the tangency) so a fixture that degenerates into
 *     "everything is 0" is caught before it can silence the whole walk.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BESTSPOT_HONESTY,
  BESTSPOT_PHYSICS,
  BESTSPOT_PRESETS,
  BESTSPOT_SAFETY,
  BESTSPOT_SCORING_V1,
  BESTSPOT_SCORING_VERSION,
  CLASS_OF,
  resolveScoring,
  sanitizeScoringPatch,
  scoringDiff,
  scoringHash,
  scoringInvalidation,
  scoringLeafPaths,
  type BestSpotScoring,
  type BestSpotScoringPatch,
  type InvalidationClass,
} from "../../../src/lib/geo/bestSpotScoring";
import {
  BESTSPOT_METRIC_DEFAULTS,
  cellScore,
  depthOfDistM,
  DEPTH_NEAR_REF_M,
  HALF_DISC,
  L_CEIL_DEG,
  NOTCH_CLEARANCE_RADII,
  NOTCH_MAX_DEPTH_DEG,
  NOTCH_MAX_WIDTH_DEG,
  NOTCH_SALIENCE_DEG,
  NOTCH_SHOULDER_DEG,
  notchAt,
  V_GATE_HI,
  V_GATE_LO,
} from "../../../src/lib/geo/bestSpotMetric";
import {
  eventTrack,
  trackWeightShape,
  worthFromParts,
  WORTH_GATE_FLOOR,
  WORTH_GATE_HI_DEG,
  WORTH_GATE_LO_DEG,
  WORTH_RAMP_HI_DEG,
  WORTH_RAMP_LO_DEG,
} from "../../../src/lib/geo/bestSpotTrack";
import {
  accessAt,
  DEMOTE_K,
  LAND_CODE,
  LAND_FLAG,
  makeLandGrid,
  softAt,
} from "../../../src/lib/geo/landcoverRaster";
import {
  AERIAL_MIN_M,
  BESTSPOT_WEIGHTS,
  type CellAccess,
  type EventTrack,
  type LandClass,
  type RayEvidence,
  type TrackSample,
} from "../../../src/lib/geo/bestSpotTypes";
import { horizonDipDeg, R_MEAN_M } from "../../../src/lib/geo/horizonProfile";

// =================================================================================================
// The fixture — one moon disc, five geometries, thirteen probes
// =================================================================================================

const EYE_M = 1.7;
const K = 0.13;
const DIP = horizonDipDeg(EYE_M, K);
/** Lunar angular radius, mid of the shipped 0.245–0.279° band (`TrackSample.rhoDeg`). */
const RHO = 0.2468;
const AZ0 = 250;
const AZ_STEP = 0.05;

/** The two ephemeris readings §5.3(b) puts on the track, chosen so BOTH twilight ramps are exercised:
 *  `-9°` sits on the LOW ramp (plateauLo −6 → rampLo −12) and `+2°` on the HIGH one. */
const SUN_ALT_LOW = -9;
const SUN_ALT_HIGH = 2;
/** First quarter — the phase the Krisciunas–Schaefer curve exists to get right (9 %, not 50 %). */
const PHASE_DEG = 90;

interface TrackSpec {
  topAltDeg: number;
  bottomAltDeg: number;
  sunAltAtT0Deg: number;
  /** Weighted coverage target — the fraction of Σw that is marked `known`. `1` = fully sampled. */
  coverageTarget?: number;
}

interface Fixture {
  track: EventTrack;
  azs: number[];
  /** `known` mask, parallel to `azs`. */
  known: (0 | 1)[];
}

/**
 * A synthetic MOONSET track whose weights come from the real `trackWeightShape` and whose `worth`
 * comes from the real `worthFromParts` — which is what makes the `trackWeight.*` and `worth.*`
 * groups reachable from a `cellScore` probe at all. Everything else is hand-written, so the whole
 * fixture stays ephemeris-free and reproducible.
 */
function makeTrack(scoring: BestSpotScoring, spec: TrackSpec): Fixture {
  const samples: TrackSample[] = [];
  const azs: number[] = [];
  const raw: number[] = [];
  const n = Math.round((spec.topAltDeg - spec.bottomAltDeg) / (AZ_STEP / 1.4509)) + 1;
  const altStep = (spec.topAltDeg - spec.bottomAltDeg) / (n - 1);
  for (let i = 0; i < n; i++) {
    const alt = spec.topAltDeg - i * altStep;
    const az = AZ0 + i * AZ_STEP;
    raw.push(
      trackWeightShape(
        alt,
        RHO,
        DIP,
        scoring.trackWeight.altScaleDeg,
        scoring.trackWeight.horizonCeiling,
      ),
    );
    samples.push({ utcMs: 1_700_000_000_000 + i * 60_000, azDeg: az, altAppDeg: alt, rhoDeg: RHO, w: 0 });
    azs.push(az);
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) samples[i].w = raw[i] / sum;

  // The `known` mask is built to hit a WEIGHTED coverage target, not an index fraction: `C` is
  // `Σ w·known / Σ w`, and the weights are wildly non-uniform (the horizon ceiling kills the tail).
  const known: (0 | 1)[] = new Array(n).fill(1);
  if (spec.coverageTarget !== undefined && spec.coverageTarget < 1) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += samples[i].w;
      if (acc > spec.coverageTarget) known[i] = 0;
    }
  }

  return {
    track: {
      kind: "moonset",
      t0Ms: samples[0].utcMs,
      samples,
      windowLo: 0,
      windowHi: n - 1,
      setAzDeg: AZ0,
      worth: worthFromParts(
        "moonset",
        { sunAltAtT0Deg: spec.sunAltAtT0Deg, moonPhaseAngleDeg: PHASE_DEG },
        scoring,
      ),
    },
    azs,
    known,
  };
}

function ray(azDeg: number, o: Partial<RayEvidence> = {}): RayEvidence {
  return {
    azDeg,
    groundAltAppDeg: DIP,
    groundSrc: "terrain",
    groundDistM: 200_000,
    bands: [],
    bandSrc: [],
    bandDistM: [],
    blockerDistM: 200_000,
    src: "terrain",
    known: 1,
    /** S3c — how far the ray LOOKED (bestSpotTypes pin 7). Required, so it cannot be forgotten. */
    reachM: 200_000,
    openSky: true,
    ...o,
  };
}

/** A cell's accessibility, resolved through the REAL raster read path so `access.*` is reachable. */
function accessFor(
  scoring: BestSpotScoring,
  cls: LandClass,
  opts: { demoted?: boolean; heightM?: number; inSolid?: boolean } = {},
): CellAccess {
  const grid = makeLandGrid({
    centreLatDeg: 48.4647,
    centreLonDeg: 35.0462,
    halfSpanM: 15,
    cellM: 3,
  });
  grid.cls[0] = LAND_CODE[cls];
  grid.flags[0] = opts.demoted ? LAND_FLAG.demoted : 0;
  return accessAt(grid, 0, 0, opts.heightM ?? EYE_M, opts.inSolid ?? false, scoring);
}

// ── the five geometries ─────────────────────────────────────────────────────────────────────────

/** A built skyline at 0.55°, 900 m out. Occults the low half of the track (so `V` lands inside the
 *  gate's ramp), fires the tangency kernel (BUILT), and puts `alt*` well inside the `L` ramp. */
function citySkyline(azs: number[], known: (0 | 1)[]): RayEvidence[] {
  return azs.map((az, i) =>
    ray(az, {
      groundAltAppDeg: 0.55,
      groundSrc: "building",
      groundDistM: 900,
      src: "building",
      blockerDistM: 900,
      openSky: false,
      known: known[i],
    }),
  );
}

/**
 * The CANYON — a gap in the skyline, tuned so the `gap` group is unsaturated at every edge:
 *
 *  · the gap's right edge sits where the track's altitude is ~0.28°, i.e. between 1.00 ρ and 1.30 ρ
 *    above the floor, so `gap.clearanceRadii` decides the verdict;
 *  · the two shoulders are at DIFFERENT heights and the RIGHT one (the `min`) steps up just past
 *    3°, so `gap.shoulderSpanDeg` changes the depth;
 *  · depth 2.0° sits between `salienceFloorDeg` 0.1 and `maxDepthDeg` 3, and the gap is 0.7° wide
 *    against `maxWidthDeg` 2 — both terms strictly inside (0, 1).
 *
 * **RE-TUNED IN S3b, AND THE REASON IS THE POINT.** `F` is `max(GRAZE, GAP)`, so the `gap` group is
 * only reachable from a `cellScore` probe where the GAP arm WINS. The old shape started the track at
 * +3°, ABOVE the 1.5° left wall, so the body crossed that wall's top edge in ALTITUDE on its way
 * down — a textbook graze worth ~1.2 radii of dwell — and GRAZE then out-scored the notch 0.5881 to
 * 0.2079, taking all six `gap.*` leaves inert with it. The fix is not a threshold, it is GEOMETRY:
 * the body now starts BELOW every shoulder (top 1.2° against walls at 2.6° / 2.0°), so it never
 * crosses an edge in altitude — it slides sideways INTO the gap and sets on the gap's own floor,
 * which is exactly the "moon rising between two buildings" case the notch was written for. What is
 * left of GRAZE is the two azimuth transitions at the gap's edges (measured τ ≈ 1.0 radii), and the
 * notch beats it comfortably. A physically honest fixture, not a tuned one.
 */
const CANYON_TOP_ALT = 1.2;
/** Deep enough that the right shoulder's step (3.1° past `az*`) is inside the swept span. The tail
 *  below the observer's dip carries ~1e-3 of the weight, so it costs `V` almost nothing. */
const CANYON_BOTTOM_ALT = -2.6;
/** Left shoulder (deg) — the TALLER of the two, and above `CANYON_TOP_ALT + ρ` so the body is behind
 *  it from the first sample rather than crossing its top edge. */
const CANYON_LEFT_SHOULDER = 2.6;
/** Right shoulder (deg) — the `min` of the two, so it is what `gap.shoulderSpanDeg` moves. */
const CANYON_RIGHT_SHOULDER = 2;
/** …and what it steps UP to past `CANYON_RIGHT_STEP`, still below the left shoulder so the `min`
 *  genuinely changes. */
const CANYON_FAR_SHOULDER = 3.5;
/** The altitude at the gap's right edge — between 1.00 ρ and 1.30 ρ above the floor, so
 *  `gap.clearanceRadii` is the leaf that decides whether the notch fires at all. */
const CANYON_EDGE_ALT = 0.28;
/** Gap width in samples: 14 × 0.05° = 0.7°, against `maxWidthDeg` 2 and `2ρ` 0.49. Wide enough that
 *  the 0.49°-wide disc is fully inside it at the centre, narrow enough that `widthTerm` is interior. */
const CANYON_GAP_SAMPLES = 14;
/** Where the RIGHT shoulder (the `min` of the two) steps up: 62 × 0.05° = 3.1° past `az*`, i.e.
 *  outside a 3.0° shoulder span and inside a 3.9° one. */
const CANYON_RIGHT_STEP = 62;

/** Index of the gap's right edge: the LAST sample still at or above `CANYON_EDGE_ALT`. Derived
 *  rather than hard-coded, because the sample count follows from the altitude span. */
function canyonEdgeIdx(track: EventTrack): number {
  const i = track.samples.findIndex((s) => s.altAppDeg < CANYON_EDGE_ALT);
  return i - 1;
}

function canyonSkyline(fx: Fixture): RayEvidence[] {
  const iR = canyonEdgeIdx(fx.track);
  const iL = iR - (CANYON_GAP_SAMPLES - 1);
  return fx.azs.map((az, i) => {
    const hDeg =
      i >= iL && i <= iR
        ? 0
        : i < iL
          ? CANYON_LEFT_SHOULDER
          : i <= iR + CANYON_RIGHT_STEP
            ? CANYON_RIGHT_SHOULDER
            : CANYON_FAR_SHOULDER;
    return ray(az, {
      groundAltAppDeg: hDeg,
      groundSrc: "terrain",
      groundDistM: 1200,
      src: "terrain",
      blockerDistM: 1200,
      openSky: false,
    });
  });
}

/** The owner's HERO ray — flat water at the dip with a floating deck slab over it, both channels
 *  tagged. The only geometry in the fixture that can reach `graze.conf.deck`, because a `deck` tag
 *  lives on a BAND and no ground channel ever carries one (`localDsm` keeps floating solids out of
 *  the surface, its pin 2). */
function deckSkyline(azs: number[], known: (0 | 1)[]): RayEvidence[] {
  return azs.map((az, i) =>
    ray(az, {
      groundAltAppDeg: DIP,
      groundSrc: "terrain",
      groundDistM: 1700,
      bands: [[0.31, 0.38]],
      bandSrc: ["deck"],
      bandDistM: [1500],
      src: "deck",
      blockerDistM: 1500,
      openSky: false,
      known: known[i],
    }),
  );
}

/** A tree line at 0.9°, 300 m out — the only geometry that can reach `graze.conf.tree`. Trees are a
 *  DISCOUNT under R5 (0.45), never the hard zero the shipped `isBuiltSrc` gate applied. */
function treeSkyline(azs: number[], known: (0 | 1)[]): RayEvidence[] {
  return azs.map((az, i) =>
    ray(az, {
      groundAltAppDeg: 0.9,
      groundSrc: "tree",
      groundDistM: 300,
      src: "tree",
      blockerDistM: 300,
      openSky: false,
      known: known[i],
    }),
  );
}

/** Every class whose SOFT rung can reach the composite. `water`/`building`/`blocked` are absent on
 *  purpose — see `EXPECT_INERT_ON_FIXTURE`. */
const SOFT_PROBE_CLASSES: readonly LandClass[] = [
  "unknown",
  "wetland",
  "deck",
  "path",
  "road",
  "majorRoad",
  "green",
  "pitch",
];

/**
 * THE PROBE. Thirteen `cellScore` results, chosen so that between them every reachable leaf of the
 * profile changes at least one number. Returns a flat vector so a perturbation is "live" if ANY
 * component moves.
 */
function probe(scoring: BestSpotScoring): number[] {
  const opts = { eyeM: EYE_M, liftM: 0, refractionK: K, scoring };
  const out: number[] = [];

  // 1 — the city cell, SUN LOW on the twilight ramp, on a demoted road.
  const cityLo = makeTrack(scoring, { topAltDeg: 3, bottomAltDeg: -0.1, sunAltAtT0Deg: SUN_ALT_LOW });
  const cityRays = citySkyline(cityLo.azs, cityLo.known);
  out.push(
    cellScore(cityRays, cityLo.track, accessFor(scoring, "road", { demoted: true }), opts).score,
  );

  // 2 — the same cell with the SUN HIGH, so the upper half of the twilight gate is exercised too.
  const cityHi = makeTrack(scoring, {
    topAltDeg: 3,
    bottomAltDeg: -0.1,
    sunAltAtT0Deg: SUN_ALT_HIGH,
  });
  out.push(
    cellScore(
      citySkyline(cityHi.azs, cityHi.known),
      cityHi.track,
      accessFor(scoring, "road"),
      opts,
    ).score,
  );

  // 3 — the canyon: `F` is the NOTCH here, not the tangency.
  const canyon = makeTrack(scoring, {
    topAltDeg: CANYON_TOP_ALT,
    bottomAltDeg: CANYON_BOTTOM_ALT,
    sunAltAtT0Deg: SUN_ALT_LOW,
  });
  out.push(cellScore(canyonSkyline(canyon), canyon.track, accessFor(scoring, "green"), opts).score);

  // 4 — the COVERAGE cell: `C` deliberately parked just above the honesty floor.
  const thin = makeTrack(scoring, {
    topAltDeg: 3,
    bottomAltDeg: -0.1,
    sunAltAtT0Deg: SUN_ALT_LOW,
    coverageTarget: 0.56,
  });
  out.push(
    cellScore(
      citySkyline(thin.azs, thin.known),
      thin.track,
      accessFor(scoring, "green"),
      opts,
    ).score,
  );

  // 5 — the AERIAL cell: 6 m over water, i.e. between `aerialMinM` and `aerialMinM × 1.3`.
  out.push(
    cellScore(
      citySkyline(cityLo.azs, cityLo.known),
      cityLo.track,
      accessFor(scoring, "water", { heightM: 6 }),
      opts,
    ).score,
  );

  // 6 — the HERO deck: the only band-tagged geometry, and so the only path to `graze.conf.deck`.
  out.push(
    cellScore(
      deckSkyline(cityLo.azs, cityLo.known),
      cityLo.track,
      accessFor(scoring, "deck"),
      opts,
    ).score,
  );

  // 7 — the tree line: the only path to `graze.conf.tree`.
  out.push(
    cellScore(
      treeSkyline(cityLo.azs, cityLo.known),
      cityLo.track,
      accessFor(scoring, "green"),
      opts,
    ).score,
  );

  // 8…15 — one per SOFT rung that can reach the composite.
  for (const cls of SOFT_PROBE_CLASSES) {
    out.push(
      cellScore(citySkyline(cityLo.azs, cityLo.known), cityLo.track, accessFor(scoring, cls), opts)
        .score,
    );
  }

  return out;
}

const BASELINE = probe(BESTSPOT_SCORING_V1);

// =================================================================================================
// DONE-CHECK 1 — EVERY FIELD IS LIVE (§5.8)
// =================================================================================================

/**
 * The leaves that CANNOT move this fixture, each with the reason it cannot.
 *
 * **S3b PRUNED THIS FROM FIFTEEN ENTRIES TO FIVE.** Eleven of the original fifteen were the `graze`
 * group plus `gap.shoulderQuality`, allowlisted with one shared reason — *"S3b's kernel does not
 * exist yet"*. It exists now, and ten of those eleven move the score, so they are gone from here.
 * What is left is one identity tag, one rung no producer can reach, and three the `BESTSPOT_SAFETY`
 * hard bits shadow by design.
 *
 * Making them live cost two new probe geometries and one RE-TUNED one — see `canyonSkyline`,
 * `deckSkyline` and `treeSkyline`. That is the shape of an honest allowlist: a leaf comes off it
 * when a fixture can reach it, not when the assertion is relaxed.
 */
const EXPECT_INERT_ON_FIXTURE: Readonly<Record<string, string>> = {
  version:
    "The profile's own identity tag. It selects MIGRATIONS and it is hashed; nothing in the kernel " +
    "reads it as a number, and a version that changed the score would be a version that lied.",

  "graze.conf.none":
    "UNREACHABLE FROM ANY PRODUCER-EMITTABLE RAY — a different claim from the three SAFETY rungs " +
    "below. `srcName(SRC_NONE)` is written by `sealDsm` exactly where `groundKnown = 0` " +
    "(`localDsm.ts:689`), i.e. on rays that also carry `known = 0`, and τ drops those from both " +
    "sums because ignorance is not a frame. A BAND always carries a tag. So this rung is a " +
    "DEFENSIVE zero for a malformed band (`ev.bandSrc[k] ?? none` in `grazeSampleInto`), and a " +
    "fixture that moved it would be a fixture describing a ray the sweep cannot emit — which is " +
    "the LENS B defect re-opened, and costs more than the coverage is worth.",

  "access.soft.water":
    "BESTSPOT_SAFETY: `groundHard.water = 0` kills the cell before any soft rung is read, and " +
    "above `aerialMinM` soft is a flat 1. Unreachable from `cellScore` BY DESIGN — pinned instead " +
    "against `accessAt(...).soft` in the ladder test below.",
  "access.soft.building": "BESTSPOT_SAFETY: `groundHard.building = 0`. See `access.soft.water`.",
  "access.soft.blocked": "BESTSPOT_SAFETY: `groundHard.blocked = 0`. See `access.soft.water`.",
};

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (node[parts[i]] === undefined) node[parts[i]] = {};
    node = node[parts[i]] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

function leafAt(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split(".")) node = (node as Record<string, unknown>)[part];
  return node;
}

/**
 * Candidate perturbations for one leaf.
 *
 * §5.8 says "×1.3"; a leaf already sitting at the top of its own range (`access.soft.deck = 1`,
 * which `clamp01` pins) or clamped by §5.5 in one direction would then read as DEAD when it is only
 * SATURATED. So both directions are offered and a leaf counts as live if EITHER moves — and a
 * direction that `resolveScoring` clamps back to the shipped value is discarded before it is used,
 * so this cannot manufacture a pass.
 */
function candidatesFor(path: string): unknown[] {
  const value = leafAt(BESTSPOT_SCORING_V1, path);
  if (typeof value === "boolean") return [!value];
  if (typeof value === "string") {
    if (path === "gap.shoulderQuality") return ["mean", "off"];
    if (path === "worth.mode") return ["badge"];
    if (path === "worth.phaseCurve") return ["illumFrac", "off"];
    return [];
  }
  const n = value as number;
  return [n * 1.3, n * 0.7, n + 0.37, n - 0.37];
}

interface Perturbation {
  patch: BestSpotScoringPatch;
  resolved: BestSpotScoring;
}

/** Every perturbation of `path` that `resolveScoring` actually HONOURS (i.e. that survives the
 *  §5.5 clamps and changes exactly that leaf). */
function perturbationsFor(path: string): Perturbation[] {
  const out: Perturbation[] = [];
  for (const candidate of candidatesFor(path)) {
    const patch: Record<string, unknown> = {};
    setPath(patch, path, candidate);
    const resolved = resolveScoring(patch as BestSpotScoringPatch);
    const diff = scoringDiff(resolved);
    if (diff.length === 1 && diff[0].path === path) out.push({ patch, resolved });
  }
  return out;
}

describe("§5.8 EVERY FIELD IS LIVE — a re-inlined constant goes RED here", () => {
  const paths = scoringLeafPaths();

  it("the fixture itself is non-degenerate (a fixture that scores 0 everywhere silences the walk)", () => {
    // Nothing below can mean anything if the probes are flat, so pin their shape first.
    expect(paths.length).toBeGreaterThanOrEqual(50);
    expect(BASELINE).toHaveLength(7 + SOFT_PROBE_CLASSES.length);
    expect(BASELINE.filter((s) => s > 1e-6).length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...BASELINE)).toBeLessThanOrEqual(1);

    const opts = { eyeM: EYE_M, liftM: 0, refractionK: K, scoring: BESTSPOT_SCORING_V1 };

    // (a) `V` sits strictly INSIDE the gate's ramp, so both edges can move the score.
    const city = makeTrack(BESTSPOT_SCORING_V1, {
      topAltDeg: 3,
      bottomAltDeg: -0.1,
      sunAltAtT0Deg: SUN_ALT_LOW,
    });
    const cityCell = cellScore(
      citySkyline(city.azs, city.known),
      city.track,
      accessFor(BESTSPOT_SCORING_V1, "road", { demoted: true }),
      opts,
    );
    expect(cityCell.verdict).toBe("scored");
    expect(cityCell.v).toBeGreaterThan(V_GATE_LO * 1.3);
    expect(cityCell.v).toBeLessThan(V_GATE_HI);
    // …and `alt*` is inside the `L` ramp, and `P` inside the depth log, and `F` non-trivial.
    expect(cityCell.altStarDeg).toBeGreaterThan(DIP);
    expect(cityCell.altStarDeg).toBeLessThan(L_CEIL_DEG);
    expect(cityCell.p).toBeGreaterThan(0);
    expect(cityCell.p).toBeLessThan(1);
    expect(cityCell.f).toBeGreaterThan(0);

    // (b) the CANYON's `F` is the NOTCH, and its clearance margin lies between 1.0 ρ and 1.3 ρ.
    const canyon = makeTrack(BESTSPOT_SCORING_V1, {
      topAltDeg: CANYON_TOP_ALT,
      bottomAltDeg: CANYON_BOTTOM_ALT,
      sunAltAtT0Deg: SUN_ALT_LOW,
    });
    const rays = canyonSkyline(canyon);
    const canyonCell = cellScore(rays, canyon.track, accessFor(BESTSPOT_SCORING_V1, "green"), opts);
    expect(canyonCell.verdict).toBe("scored");
    expect(canyonCell.f).toBeGreaterThan(0.05);
    expect(canyonCell.f).toBeLessThan(1);
    // `F = max(GRAZE, GAP)`, and on this geometry the GAP arm must WIN — otherwise the six `gap.*`
    // leaves are unreachable from `cellScore` and the walk below silently stops testing them. This
    // is the assertion that guards the S3b re-tune: the body never crosses a shoulder in ALTITUDE
    // (it starts below both), so what is left of GRAZE is the two azimuth transitions at the gap's
    // own edges (τ = 0.6325 ρ) — measured GRAZE 0.30332 against GAP 0.46621, a 54 % margin.
    const starIdx = canyonEdgeIdx(canyon.track);
    const n = notchAt(rays, starIdx, canyonCell.altStarDeg, RHO, BESTSPOT_SCORING_V1.gap);
    expect(canyonCell.fGap).toBeGreaterThan(canyonCell.fGraze * 1.2);
    expect(canyonCell.f).toBeCloseTo(canyonCell.fGap, 12);
    // …and `F_gap` is `notchAt`'s own `f`, weighted by the quality of the two shoulders that make
    // it a gap: both are terrain at 1200 m with saturated relief, so the weight is Depth(1200).
    expect(canyonCell.fGap).toBeCloseTo(n.f * depthOfDistM(1200, 3000), 12);
    expect(n.floorDeg).toBe(0);
    expect(canyonCell.altStarDeg - n.floorDeg).toBeGreaterThan(1.0 * RHO);
    expect(canyonCell.altStarDeg - n.floorDeg).toBeLessThan(1.3 * RHO);
    // …and both notch terms are strictly interior, so neither edge is saturated.
    expect(n.depthDeg).toBeGreaterThan(NOTCH_SALIENCE_DEG);
    expect(n.depthDeg).toBeLessThan(NOTCH_MAX_DEPTH_DEG);
    expect(n.widthDeg).toBeGreaterThan(2 * RHO);
    expect(n.widthDeg).toBeLessThan(NOTCH_MAX_WIDTH_DEG);

    // (c) the COVERAGE probe is parked in the window `[minCoverage, minCoverage × 1.3]`.
    const thin = makeTrack(BESTSPOT_SCORING_V1, {
      topAltDeg: 3,
      bottomAltDeg: -0.1,
      sunAltAtT0Deg: SUN_ALT_LOW,
      coverageTarget: 0.56,
    });
    const thinCell = cellScore(
      citySkyline(thin.azs, thin.known),
      thin.track,
      accessFor(BESTSPOT_SCORING_V1, "green"),
      opts,
    );
    expect(thinCell.verdict).toBe("scored");
    expect(thinCell.c).toBeGreaterThan(BESTSPOT_SCORING_V1.gates.minCoverage);
    expect(thinCell.c).toBeLessThan(BESTSPOT_SCORING_V1.gates.minCoverage * 1.3);

    // (d) both twilight ramps are genuinely on a ramp — not on the plateau, not on the floor.
    for (const sunAlt of [SUN_ALT_LOW, SUN_ALT_HIGH]) {
      const w = worthFromParts(
        "moonset",
        { sunAltAtT0Deg: sunAlt, moonPhaseAngleDeg: PHASE_DEG },
        BESTSPOT_SCORING_V1,
      );
      const gate = w / worthFromParts(
        "moonset",
        { sunAltAtT0Deg: 0, moonPhaseAngleDeg: PHASE_DEG },
        BESTSPOT_SCORING_V1,
      );
      expect(gate).toBeGreaterThan(WORTH_GATE_FLOOR);
      expect(gate).toBeLessThan(1);
    }
  });

  it("every leaf that is NOT allowlisted moves `cellScore` by more than 1e-12", () => {
    const inert: string[] = [];
    const live: string[] = [];
    const unreachable: string[] = [];

    for (const path of paths) {
      const perturbations = perturbationsFor(path);
      if (perturbations.length === 0) {
        unreachable.push(path);
        continue;
      }
      const moved = perturbations.some(({ resolved }) => {
        const after = probe(resolved);
        return after.some((s, i) => Math.abs(s - BASELINE[i]) > 1e-12);
      });
      (moved ? live : inert).push(path);
    }

    // Every leaf must be PERTURBABLE at all — a leaf no patch can move is a leaf the hot-swap seam
    // cannot reach, which is requirement (vii) failing at a different layer.
    expect(unreachable).toEqual([]);
    expect([...inert].sort()).toEqual(Object.keys(EXPECT_INERT_ON_FIXTURE).sort());
    // The allowlist must stay SMALL relative to the profile, and the walk must have real teeth.
    expect(inert.length).toBeLessThan(paths.length / 3);
    expect(live.length).toBeGreaterThanOrEqual(35);
  });

  it("every allowlist entry carries a WRITTEN reason, and none is stale", () => {
    for (const [path, reason] of Object.entries(EXPECT_INERT_ON_FIXTURE)) {
      expect(paths, `${path} is allowlisted but is not a leaf of the profile`).toContain(path);
      expect(reason.length, `${path} has no real reason`).toBeGreaterThan(40);
    }
  });

  it("the three SAFETY-shadowed soft rungs ARE live where they can be read — `accessAt`", () => {
    // They cannot reach `cellScore` (hard = 0 kills the cell first), which is exactly why they are
    // allowlisted above. They must still be tunable, or the ladder is half dead.
    for (const cls of ["water", "building", "blocked"] as const) {
      const patched = resolveScoring({ access: { soft: { [cls]: 0.33 } } });
      const grid = makeLandGrid({
        centreLatDeg: 48.4647,
        centreLonDeg: 35.0462,
        halfSpanM: 15,
        cellM: 3,
      });
      grid.cls[0] = LAND_CODE[cls];
      expect(softAt(grid, 0, 0, BESTSPOT_SCORING_V1)).toBe(
        BESTSPOT_SCORING_V1.access.soft[cls],
      );
      expect(softAt(grid, 0, 0, patched)).toBe(0.33);
      // …and the HARD bit is untouched by that patch — it has no key path from one.
      expect(accessAt(grid, 0, 0, EYE_M, false, patched).hard).toBe(0);
    }
  });
});

// =================================================================================================
// DONE-CHECKS 2 + 3 — the invalidation table IS the contract (§5.4)
// =================================================================================================

describe("§5.4 the invalidation-class table", () => {
  it("every leaf of BESTSPOT_SCORING_V1 has a CLASS_OF entry", () => {
    const missing = scoringLeafPaths().filter((p) => CLASS_OF[p] === undefined);
    expect(missing).toEqual([]);
  });

  it("CLASS_OF has no entry for a path that is not a leaf (a stale row is a silent lie)", () => {
    const leaves = new Set(scoringLeafPaths());
    expect(Object.keys(CLASS_OF).filter((p) => !leaves.has(p))).toEqual([]);
  });

  it("scoringInvalidation returns exactly what §5.4's table says, per path", () => {
    // Transcribed from SPEC_V2 §5.4. Every row of the table is here; the two rows that EXTEND it
    // (`graze.tangentHalfWidthRadii`, `version`) are named in `bestSpotScoring.ts`'s own docstring.
    const TABLE: Readonly<Record<string, InvalidationClass>> = {
      "weights.p": "recompose",
      "gates.vGateLo": "recompose",
      "gates.vGateHi": "recompose",
      "gates.minCoverage": "recompose",
      "curves.lCeilDeg": "recompose",
      "curves.accessSoftExponent": "recompose",
      "graze.scaleRadii": "recompose",
      "graze.conf.tree": "recompose",
      "gap.salienceFloorDeg": "recompose",
      "gap.maxDepthDeg": "recompose",
      "gap.maxWidthDeg": "recompose",
      "gap.clearanceRadii": "recompose",
      "gap.shoulderQuality": "recompose",
      "access.soft.green": "recompose",
      "access.demoteK": "recompose",
      "access.aerialMinM": "recompose",
      "worth.floor": "recompose",
      "worth.effectiveFloor": "recompose",
      "worth.mode": "recompose",
      "trackWeight.altScaleDeg": "reweigh",
      "trackWeight.horizonCeiling": "reweigh",
      "curves.depthNearRefM": "rescore",
      "curves.depthTrustRadiusM": "rescore",
      "graze.reliefLoDeg": "rescore",
      "graze.reliefHiDeg": "rescore",
      "graze.areaArm": "rescore",
      "graze.tangentArm": "rescore",
      "quadrature.discColumns": "rescore",
      "gates.halfDiscFrac": "rescore",
      "gap.shoulderSpanDeg": "rescore",
      "version": "rebuild",
    };
    for (const [path, expected] of Object.entries(TABLE)) {
      // The same honoured-perturbation machinery the liveness walk uses, so a row cannot be
      // "verified" by a patch the clamps quietly threw away.
      const perturbations = perturbationsFor(path);
      expect(perturbations.length, `${path} has no honoured perturbation`).toBeGreaterThan(0);
      const next = perturbations[0].resolved;
      expect(scoringDiff(next).map((d) => d.path)).toEqual([path]);
      expect(scoringInvalidation(BESTSPOT_SCORING_V1, next), path).toBe(expected);
    }
  });

  it("the STRONGEST class wins over a multi-leaf diff, and an empty diff is the cheapest", () => {
    const both = resolveScoring({ weights: { p: 0.4 }, quadrature: { discColumns: 16 } });
    expect(scoringInvalidation(BESTSPOT_SCORING_V1, both)).toBe("rescore"); // not "recompose"
    expect(scoringInvalidation(BESTSPOT_SCORING_V1, resolveScoring({}))).toBe("repaint");
    expect(scoringInvalidation(BESTSPOT_SCORING_V1, BESTSPOT_SCORING_V1)).toBe("repaint");
  });

  it("a path with NO entry defaults to `rebuild` — a new field is slow, never wrong", () => {
    // Simulated by diffing against a baseline that is missing a leaf: the diff walker reports the
    // extra path and the lookup misses.
    const stripped = { ...BESTSPOT_SCORING_V1, futureKnob: 1 } as unknown as BestSpotScoring;
    expect(CLASS_OF["futureKnob"]).toBeUndefined();
    expect(scoringInvalidation(BESTSPOT_SCORING_V1, stripped)).toBe("rebuild");
  });
});

// =================================================================================================
// DONE-CHECK 4 — the §5.5 clamps, all of them, as CODE and not as comments
// =================================================================================================

describe("§5.5 the clamps", () => {
  it("HONESTY — `vGateHi >= vGateLo + 0.05`, because smoothstep degenerates WITHOUT throwing", () => {
    const inverted = resolveScoring({ gates: { vGateLo: 0.9, vGateHi: 0.1 } });
    expect(inverted.gates.vGateHi).toBeGreaterThanOrEqual(
      inverted.gates.vGateLo + BESTSPOT_HONESTY.vGateMinSpan,
    );
    // …and the persisted patch is already sane on its own, checked against the shipped twin.
    expect(sanitizeScoringPatch({ gates: { vGateHi: 0.1 } }).gates?.vGateHi).toBe(
      BESTSPOT_SCORING_V1.gates.vGateLo + BESTSPOT_HONESTY.vGateMinSpan,
    );
    expect(sanitizeScoringPatch({ gates: { vGateLo: 0.99 } }).gates?.vGateLo).toBe(
      BESTSPOT_SCORING_V1.gates.vGateHi - BESTSPOT_HONESTY.vGateMinSpan,
    );
  });

  it("HONESTY — `minCoverage` may become MORE honest, never less", () => {
    expect(resolveScoring({ gates: { minCoverage: 0.1 } }).gates.minCoverage).toBe(0.5);
    expect(sanitizeScoringPatch({ gates: { minCoverage: 0.1 } }).gates?.minCoverage).toBe(0.5);
    expect(resolveScoring({ gates: { minCoverage: 0.8 } }).gates.minCoverage).toBe(0.8);
  });

  it("SAFETY — `aerialMinM >= 2` and `conf.tree <= 0.6`", () => {
    expect(resolveScoring({ access: { aerialMinM: 0.5 } }).access.aerialMinM).toBe(2);
    expect(sanitizeScoringPatch({ access: { aerialMinM: -9 } }).access?.aerialMinM).toBe(2);
    expect(resolveScoring({ access: { aerialMinM: 60 } }).access.aerialMinM).toBe(60);

    expect(resolveScoring({ graze: { conf: { tree: 1 } } }).graze.conf.tree).toBe(0.6);
    expect(sanitizeScoringPatch({ graze: { conf: { tree: 0.95 } } }).graze?.conf?.tree).toBe(0.6);
    expect(resolveScoring({ graze: { conf: { tree: 0.2 } } }).graze.conf.tree).toBe(0.2);
  });

  it("the §1004 proposed ranges are PINNED here rather than trusted from the spec", () => {
    // `maxWidthDeg >= 0.7` keeps the width denominator `maxWidthDeg − 2ρ` positive at the largest
    // lunar ρ (0.279° ⇒ 2ρ = 0.558).
    expect(resolveScoring({ gap: { maxWidthDeg: 0.2 } }).gap.maxWidthDeg).toBe(0.7);
    expect(0.7).toBeGreaterThan(2 * 0.279);
    expect(resolveScoring({ quadrature: { discColumns: 0 } }).quadrature.discColumns).toBe(1);
    expect(resolveScoring({ quadrature: { discColumns: 999 } }).quadrature.discColumns).toBe(64);
    expect(resolveScoring({ quadrature: { discColumns: 12.7 } }).quadrature.discColumns).toBe(12);
    expect(resolveScoring({ curves: { lCeilDeg: 0.01 } }).curves.lCeilDeg).toBe(0.5);
    expect(resolveScoring({ curves: { lCeilDeg: 90 } }).curves.lCeilDeg).toBe(30);
  });

  it('`phaseCurve: "illumFrac"` is REFUSED by the persisted sanitizer and ACCEPTED by the DEV seam', () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const refused = sanitizeScoringPatch({ worth: { phaseCurve: "illumFrac", floor: 0.4 } });
      expect(refused.worth?.phaseCurve).toBeUndefined();
      // A refused value must not take the REST of the saved tune down with it.
      expect(refused.worth?.floor).toBe(0.4);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toMatch(/illumFrac/);

      const dev = sanitizeScoringPatch({ worth: { phaseCurve: "illumFrac" } }, { dev: true });
      expect(dev.worth?.phaseCurve).toBe("illumFrac");
      expect(warn).toHaveBeenCalledTimes(1); // …and the DEV seam does not nag
    } finally {
      warn.mockRestore();
    }

    // The other two members of the enum persist normally.
    expect(sanitizeScoringPatch({ worth: { phaseCurve: "off" } }).worth?.phaseCurve).toBe("off");
    expect(sanitizeScoringPatch({ worth: { phaseCurve: "ks1991" } }).worth?.phaseCurve).toBe(
      "ks1991",
    );
    // …and the refusal is about PERSISTENCE, not about the value being unusable: `resolveScoring`
    // still honours it, which is what makes the DEV A/B a one-liner.
    expect(resolveScoring({ worth: { phaseCurve: "illumFrac" } }).worth.phaseCurve).toBe(
      "illumFrac",
    );
    // The measured reason it is refused: KS says ~9 % at quarter, illumFrac says 50 %.
    const ks = worthFromParts("moonset", { sunAltAtT0Deg: 0, moonPhaseAngleDeg: 90 });
    const naive = worthFromParts(
      "moonset",
      { sunAltAtT0Deg: 0, moonPhaseAngleDeg: 90 },
      resolveScoring({ worth: { phaseCurve: "illumFrac" } }),
    );
    expect(ks).toBeCloseTo(0.091, 3);
    expect(naive).toBeCloseTo(0.5, 6);
  });
});

// =================================================================================================
// DONE-CHECKS 5 + 6 — round-trip, and the four no-breaking-change rules (§5.7)
// =================================================================================================

describe("§5.7 sanitize / resolve / migrate", () => {
  const PATCH: BestSpotScoringPatch = {
    weights: { p: 0.4, f: 0.15 },
    gates: { vGateLo: 0.2 },
    access: { soft: { green: 0.95 }, demoteK: 0.8 },
    worth: { mode: "badge", floor: 0.3 },
    trackWeight: { horizonCeiling: false },
    quadrature: { discColumns: 16 },
  };

  it("round-trips through JSON, the sanitizer and the resolver without drifting", () => {
    const wire = JSON.parse(JSON.stringify(PATCH)) as unknown;
    const once = resolveScoring(sanitizeScoringPatch(wire));
    const twice = resolveScoring(sanitizeScoringPatch(JSON.parse(JSON.stringify(once))));
    expect(scoringHash(twice)).toBe(scoringHash(once));
    expect(once.weights.p).toBe(0.4);
    expect(once.access.soft.green).toBe(0.95);
    expect(once.worth.mode).toBe("badge");
    expect(once.trackWeight.horizonCeiling).toBe(false);
    // A `Record` map patches KEY BY KEY — the ten rungs the patch did not name are untouched.
    expect(once.access.soft.road).toBe(BESTSPOT_SCORING_V1.access.soft.road);
    expect(once.weights.v).toBe(BESTSPOT_SCORING_V1.weights.v);
  });

  it("a v0 patch with a REMOVED field and an UNKNOWN field still resolves — never throws", () => {
    const v0 = {
      version: 0,
      weights: { p: 0.4, legacyBridgeBias: 0.9 }, // a field that no longer exists
      framing: { silRequiresOcculting: true }, // a whole GROUP that no longer exists
      gates: { vGateLo: "0.2" }, // …and one with the wrong TYPE
      quadrature: { discColumns: 16 },
      nonsense: [1, 2, 3],
    };
    expect(() => sanitizeScoringPatch(v0)).not.toThrow();
    const patch = sanitizeScoringPatch(v0);
    expect(patch).not.toHaveProperty("framing");
    expect(patch).not.toHaveProperty("nonsense");
    expect(patch.weights).toEqual({ p: 0.4 });
    expect(patch.gates).toBeUndefined(); // the whole group was type-garbage, so nothing survived

    const resolved = resolveScoring(patch);
    expect(resolved.weights.p).toBe(0.4);
    expect(resolved.gates.vGateLo).toBe(BESTSPOT_SCORING_V1.gates.vGateLo);
    expect(resolved.quadrature.discColumns).toBe(16);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.access.soft)).toBe(true);

    // …and the hostile shapes a real `localStorage` blob can carry.
    for (const junk of [null, undefined, 42, "x", [], NaN, { weights: null }]) {
      expect(() => resolveScoring(sanitizeScoringPatch(junk))).not.toThrow();
    }
    expect(scoringHash(resolveScoring(sanitizeScoringPatch(null)))).toBe(
      scoringHash(BESTSPOT_SCORING_V1),
    );
  });

  it("`resolveScoring(null)` is the shipped default, and it is FROZEN and COMPLETE", () => {
    const d = resolveScoring(null);
    expect(scoringDiff(d)).toEqual([]);
    expect(scoringLeafPaths().every((p) => leafAt(d, p) !== undefined)).toBe(true);
    expect(() => {
      (d.gates as { vGateLo: number }).vGateLo = 0.9;
    }).toThrow();
  });

  it("the presets are patches, and they resolve to sane profiles", () => {
    expect(Object.keys(BESTSPOT_PRESETS).sort()).toEqual([
      "default",
      "depth-forward",
      "framing-forward",
    ]);
    expect(scoringDiff(resolveScoring(BESTSPOT_PRESETS["default"]))).toEqual([]);
    const depth = resolveScoring(BESTSPOT_PRESETS["depth-forward"]);
    expect(depth.weights.p).toBe(0.4);
    expect(depth.weights.f).toBe(0.15);
    expect(scoringInvalidation(BESTSPOT_SCORING_V1, depth)).toBe("recompose");
    const framing = resolveScoring(BESTSPOT_PRESETS["framing-forward"]);
    expect(framing.weights.f).toBeGreaterThan(framing.weights.p);
  });
});

// =================================================================================================
// DONE-CHECK 8 — PHYSICS / SAFETY / HONESTY have NO key path from a patch
// =================================================================================================

describe("§5.5 the three non-tunable blocks", () => {
  it("a patch naming a PHYSICS / SAFETY / HONESTY path is a NO-OP", () => {
    const hostile = {
      refractionK: 0.5,
      earthRadiusM: 1,
      softQ: 255,
      physics: { refractionK: 0.5 },
      safety: { groundHard: { water: 1 } },
      honesty: { minCoverageFloor: 0, minWeightFraction: 0 },
      groundHard: { water: 1, building: 1, blocked: 1 },
      access: { hard: { water: 1 }, groundHard: { water: 1 } },
      trackWeight: { minWeightFraction: 0.5 },
      gates: { minCoverageFloor: 0.1 },
    };
    const resolved = resolveScoring(sanitizeScoringPatch(hostile) as BestSpotScoringPatch);
    expect(scoringHash(resolved)).toBe(scoringHash(BESTSPOT_SCORING_V1));
    expect(scoringDiff(resolved)).toEqual([]);
    // …and even bypassing the sanitizer entirely.
    expect(scoringHash(resolveScoring(hostile as BestSpotScoringPatch))).toBe(
      scoringHash(BESTSPOT_SCORING_V1),
    );

    // The blocks themselves are frozen, and none of their keys is a leaf of the tunable profile.
    const leaves = new Set(scoringLeafPaths());
    for (const block of [BESTSPOT_PHYSICS, BESTSPOT_SAFETY, BESTSPOT_HONESTY]) {
      expect(Object.isFrozen(block)).toBe(true);
      for (const key of Object.keys(block)) {
        expect([...leaves].some((p) => p === key || p.endsWith(`.${key}`))).toBe(false);
      }
    }
  });

  it("the SAFETY hard bits are the shipped ladder, and `water` is still 0", () => {
    expect(BESTSPOT_SAFETY.groundHard).toEqual({
      unknown: 1,
      water: 0,
      wetland: 1,
      building: 0,
      deck: 1,
      path: 1,
      road: 1,
      majorRoad: 1,
      green: 1,
      pitch: 1,
      blocked: 0,
    });
    // Every SOFT rung has a HARD twin and vice versa — a class in one and not the other is a class
    // that silently reads `undefined` somewhere.
    expect(Object.keys(BESTSPOT_SCORING_V1.access.soft).sort()).toEqual(
      Object.keys(BESTSPOT_SAFETY.groundHard).sort(),
    );
  });
});

// =================================================================================================
// DONE-CHECK 9 — the hash
// =================================================================================================

describe("scoringHash — the one integer that stops the picture disagreeing with the numbers", () => {
  it("is stable across KEY ORDER (a structured clone does not promise an order)", () => {
    const shuffled = JSON.parse(
      JSON.stringify(BESTSPOT_SCORING_V1, Object.keys(BESTSPOT_SCORING_V1).sort().reverse()),
    );
    const rebuilt = resolveScoring(shuffled as BestSpotScoringPatch);
    expect(scoringHash(rebuilt)).toBe(scoringHash(BESTSPOT_SCORING_V1));
    expect(scoringHash(resolveScoring({}))).toBe(scoringHash(BESTSPOT_SCORING_V1));
    expect(scoringHash(BESTSPOT_SCORING_V1)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when ANY leaf changes — all of them, one at a time", () => {
    const base = scoringHash(BESTSPOT_SCORING_V1);
    const seen = new Set<string>([base]);
    for (const path of scoringLeafPaths()) {
      const perturbations = perturbationsFor(path);
      expect(perturbations.length, `${path} has no honoured perturbation`).toBeGreaterThan(0);
      const h = scoringHash(perturbations[0].resolved);
      expect(h, `${path} did not move the hash`).not.toBe(base);
      seen.add(h);
    }
    // …and the hashes are not all colliding with each other either.
    expect(seen.size).toBeGreaterThan(scoringLeafPaths().length * 0.9);
  });

  it("ignores last-bit float noise, so arithmetic cannot trigger a re-solve", () => {
    const noisy = resolveScoring({ weights: { p: 0.1 + 0.2 - 0.05 } }); // 0.25000000000000006
    expect(noisy.weights.p).not.toBe(0.25);
    expect(scoringHash(noisy)).toBe(scoringHash(BESTSPOT_SCORING_V1));
  });

  it("scoringDiff counts exactly the fields the status line must announce", () => {
    const custom = resolveScoring({ weights: { p: 0.4, f: 0.15 }, gates: { vGateLo: 0.2 } });
    const diff = scoringDiff(custom);
    expect(diff.map((d) => d.path).sort()).toEqual(["gates.vGateLo", "weights.f", "weights.p"]);
    expect(diff.find((d) => d.path === "weights.p")).toEqual({
      path: "weights.p",
      from: 0.25,
      to: 0.4,
    });
  });
});

// =================================================================================================
// DONE-CHECK 7 — the profile IS the shipped constants (the `bestSpotMetric.test.ts:945` idiom)
// =================================================================================================

describe("BESTSPOT_SCORING_V1 agrees with every constant it replaced", () => {
  it("the `PLAN.*` mirrors — a drift in either direction must be RED, not silent", async () => {
    const { PLAN, BESTSPOT_SCORING_V1: reExported } = await import(
      "../../../src/components/globe/tuning"
    );
    expect(BESTSPOT_SCORING_V1.curves.depthTrustRadiusM).toBe(PLAN.trustRadiusM);
    expect(BESTSPOT_SCORING_V1.gates.minCoverage).toBe(PLAN.minCoverageForGaps);
    expect(BESTSPOT_PHYSICS.refractionK).toBe(PLAN.refractionK);
    expect(BESTSPOT_METRIC_DEFAULTS.refractionK).toBe(BESTSPOT_PHYSICS.refractionK);
    expect(BESTSPOT_PHYSICS.earthRadiusM).toBe(R_MEAN_M);
    // §5.2: `tuning.ts` RE-EXPORTS the profile (the WGS84 precedent) — same object, not a copy.
    expect(reExported).toBe(BESTSPOT_SCORING_V1);
  });

  it("the `bestSpotMetric` constants", () => {
    expect(BESTSPOT_SCORING_V1.version).toBe(BESTSPOT_SCORING_VERSION);
    expect(BESTSPOT_SCORING_V1.gates.vGateLo).toBe(V_GATE_LO);
    expect(BESTSPOT_SCORING_V1.gates.vGateHi).toBe(V_GATE_HI);
    expect(BESTSPOT_SCORING_V1.gates.halfDiscFrac).toBe(HALF_DISC);
    expect(BESTSPOT_SCORING_V1.curves.lCeilDeg).toBe(L_CEIL_DEG);
    expect(BESTSPOT_SCORING_V1.curves.depthNearRefM).toBe(DEPTH_NEAR_REF_M);
    expect(BESTSPOT_SCORING_V1.gap.shoulderSpanDeg).toBe(NOTCH_SHOULDER_DEG);
    expect(BESTSPOT_SCORING_V1.gap.salienceFloorDeg).toBe(NOTCH_SALIENCE_DEG);
    expect(BESTSPOT_SCORING_V1.gap.maxDepthDeg).toBe(NOTCH_MAX_DEPTH_DEG);
    expect(BESTSPOT_SCORING_V1.gap.maxWidthDeg).toBe(NOTCH_MAX_WIDTH_DEG);
    expect(BESTSPOT_SCORING_V1.gap.clearanceRadii).toBe(NOTCH_CLEARANCE_RADII);
    expect(BESTSPOT_SCORING_V1.weights).toEqual(BESTSPOT_WEIGHTS);
    // The `A_soft` exponent was not even a named constant — it was an inlined `Math.sqrt`.
    expect(BESTSPOT_SCORING_V1.curves.accessSoftExponent).toBe(0.5);
    expect(BESTSPOT_SCORING_V1.quadrature.discColumns).toBe(8);
  });

  it("the `bestSpotTrack` constants (the five WORTH_* and the weight scale)", () => {
    expect(BESTSPOT_SCORING_V1.worth.plateauHiDeg).toBe(WORTH_GATE_HI_DEG);
    expect(BESTSPOT_SCORING_V1.worth.plateauLoDeg).toBe(WORTH_GATE_LO_DEG);
    expect(BESTSPOT_SCORING_V1.worth.rampHiDeg).toBe(WORTH_RAMP_HI_DEG);
    expect(BESTSPOT_SCORING_V1.worth.rampLoDeg).toBe(WORTH_RAMP_LO_DEG);
    expect(BESTSPOT_SCORING_V1.worth.floor).toBe(WORTH_GATE_FLOOR);
    expect(BESTSPOT_SCORING_V1.trackWeight.altScaleDeg).toBe(2.5);
    // The horizon ceiling's floor is HONESTY, not a profile leaf — and it is still 1e-3.
    expect(trackWeightShape(DIP - 3 * RHO, RHO, DIP, 2.5)).toBeCloseTo(
      BESTSPOT_HONESTY.minWeightFraction,
      12,
    );
  });

  it("the `landcoverRaster` / `bestSpotTypes` constants", () => {
    expect(BESTSPOT_SCORING_V1.access.aerialMinM).toBe(AERIAL_MIN_M);
    expect(BESTSPOT_SCORING_V1.access.demoteK).toBe(DEMOTE_K);
    expect(BESTSPOT_PHYSICS.softQ).toBe(200);
    expect(BESTSPOT_SCORING_V1.access.soft).toEqual({
      unknown: 0.45,
      water: 0.1,
      wetland: 0.1,
      building: 0.1,
      deck: 1,
      path: 1,
      road: 0.6,
      majorRoad: 0.15,
      green: 0.9,
      pitch: 0.85,
      blocked: 0.1,
    });
    // §5.3(a) EQUIVALENCE: the retired `softQ` byte array was pre-filled with `round(0.45 · 200)`,
    // and a zero-filled `cls` (`LAND_CODE.unknown === 0`) must resolve to the same 0.45 at read.
    const fresh = makeLandGrid({
      centreLatDeg: 48.4647,
      centreLonDeg: 35.0462,
      halfSpanM: 15,
      cellM: 3,
    });
    expect(Math.round(0.45 * BESTSPOT_PHYSICS.softQ) / BESTSPOT_PHYSICS.softQ).toBe(0.45);
    expect(softAt(fresh, 0, 0)).toBe(0.45);
    expect(fresh.cls.every((c) => c === 0)).toBe(true);
    expect(fresh.flags.every((f) => f === 0)).toBe(true);
    expect(accessAt(fresh, 0, 0, EYE_M, false)).toEqual({
      hard: 1,
      soft: 0.45,
      cls: "unknown",
      groundReachable: true,
    });
  });
});

// =================================================================================================
// §5.2 — the module is ZERO-IMPORT, which is what lets it ride the job
// =================================================================================================

describe("bestSpotScoring — ZERO runtime imports", () => {
  const source = readFileSync(
    join(__dirname, "..", "..", "..", "src", "lib", "geo", "bestSpotScoring.ts"),
    "utf8",
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("imports NOTHING at runtime — only `import type` from the shared contract", () => {
    // §5.2 is explicit about why: the profile RIDES THE JOB across `postMessage` into a long-lived
    // worker, so it must instantiate from nothing; vitest must be able to reproduce it from nothing;
    // and the worker bundle must gain no `components/` edge. A single runtime import here would
    // quietly re-couple all three.
    const specifiers = [...code.matchAll(/^import([\s\S]*?)from "([^"]+)";$/gm)];
    expect(specifiers).toHaveLength(1);
    expect(specifiers[0][2]).toBe("./bestSpotTypes");
    expect(specifiers[0][1]).toMatch(/^\s*type\s/); // `import type`, erased at build time
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/from ["'](three|zustand)/);
    expect(code).not.toMatch(/\/(store|components)\//);
    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/\b(document|window|localStorage|requestAnimationFrame)\b/);
  });
});

// =================================================================================================
// §5.3(b) — the term the whole `worth.*` group rides on
// =================================================================================================

describe("§5.3(b) — a real track carries its own worth PARTS, so `M` is recomputable", () => {
  const DNIPRO = {
    latDeg: 48.4647,
    lonDeg: 35.0462,
    groundAltM: 100,
    eyeAboveGroundM: 2, // `PLAN.eyeHeightM` — the same anchor the almanac chips use
  };
  const AUG_MS = Date.UTC(2026, 7, 24, 12);

  it("`sunAltAtT0Deg` + `moonPhaseAngleDeg` reproduce `worth` EXACTLY, with no ephemeris call", () => {
    const track = eventTrack(DNIPRO, "moonrise", AUG_MS);
    expect(track).not.toBeNull();
    if (!track) return;

    expect(Number.isFinite(track.sunAltAtT0Deg)).toBe(true);
    expect(Number.isFinite(track.moonPhaseAngleDeg)).toBe(true);
    expect(track.moonPhaseAngleDeg).toBeGreaterThanOrEqual(0);
    expect(track.moonPhaseAngleDeg).toBeLessThanOrEqual(180);

    // THE POINT: the same number, from the two stored readings, with no astronomy-engine call.
    expect(worthFromParts("moonrise", track)).toBe(track.worth);

    // …and it recomputes under a DIFFERENT profile too, which is what turns `worth.*` from a
    // rebuild (490 ms — re-drive the ephemeris) into a recompose (0.272 ms).
    const raised = resolveScoring({ worth: { floor: 0.6 } });
    const under = eventTrack(DNIPRO, "moonrise", AUG_MS, { scoring: raised });
    expect(under).not.toBeNull();
    expect(worthFromParts("moonrise", track, raised)).toBe(under?.worth);
    expect(under?.sunAltAtT0Deg).toBe(track.sunAltAtT0Deg);
    expect(under?.moonPhaseAngleDeg).toBe(track.moonPhaseAngleDeg);
  });

  it("a SUN track carries the parts too, and its worth is exactly 1 without consulting them", () => {
    const track = eventTrack(DNIPRO, "sunset", AUG_MS);
    expect(track).not.toBeNull();
    expect(track?.worth).toBe(1);
    expect(worthFromParts("sunset", { sunAltAtT0Deg: -90, moonPhaseAngleDeg: 180 })).toBe(1);
  });

  it("`trackWeight.horizonCeiling` is a real KILL SWITCH on a real track (the AS-BUILT fix)", () => {
    const on = eventTrack(DNIPRO, "sunset", AUG_MS)!;
    const off = eventTrack(DNIPRO, "sunset", AUG_MS, {
      scoring: resolveScoring({ trackWeight: { horizonCeiling: false } }),
    })!;
    expect(on.samples).toHaveLength(off.samples.length);
    // With the ceiling OFF, the below-dip tail keeps full weight — that IS the measured LENS B
    // defect (~47 % of the normalised weight sitting below a pedestrian eye's own dip, where
    // `f = 0` is guaranteed by the curvature of the earth for every ground cell on earth).
    // Measured here on the real 2026-08-24 Dnipro sunset, 40 samples: 50.99 % OFF vs 4.84 % ON.
    const dip = horizonDipDeg(2, K); // `planElevationsM` clamps the eye at `PLAN.eyeHeightM`
    const belowFrac = (t: typeof on) =>
      t.samples.reduce((a, s) => a + (s.altAppDeg < dip ? s.w : 0), 0);
    expect(belowFrac(off)).toBeCloseTo(0.5099, 3);
    expect(belowFrac(on)).toBeCloseTo(0.0484, 3);
    expect(belowFrac(off)).toBeGreaterThan(belowFrac(on) * 10);
  });
});

// =================================================================================================
// OWNER RULING R7 — the one deliberate behaviour change
// =================================================================================================

describe("R7 — the moon map dims instead of vanishing (BESTSPOT_PLAN.md:29)", () => {
  const opts = { eyeM: EYE_M, liftM: 0, refractionK: K, scoring: BESTSPOT_SCORING_V1 };
  const fx = makeTrack(BESTSPOT_SCORING_V1, {
    topAltDeg: 3,
    bottomAltDeg: -0.1,
    sunAltAtT0Deg: 0,
  });
  const open = fx.azs.map((az) => ray(az));
  const access = accessFor(BESTSPOT_SCORING_V1, "green");

  const scoreAtWorth = (worth: number, scoring = BESTSPOT_SCORING_V1) =>
    cellScore(open, { ...fx.track, worth }, access, { ...opts, scoring }).score;

  it("EVERY SUN NUMBER IS UNCHANGED — `worth = 1` gives `M_eff = 1` EXACTLY, not to an epsilon", () => {
    const ef = BESTSPOT_SCORING_V1.worth.effectiveFloor;
    expect(ef).toBe(0.35);
    expect(ef + (1 - ef) * 1).toBe(1); // the IEEE identity the whole slice rests on
    const sunScore = scoreAtWorth(1);
    expect(sunScore).toBe(scoreAtWorth(1, resolveScoring({ worth: { mode: "badge" } })));
    expect(sunScore).toBe(scoreAtWorth(1, resolveScoring({ worth: { effectiveFloor: 0.9 } })));
    expect(sunScore).toBe(scoreAtWorth(1, resolveScoring({ worth: { effectiveFloor: 0 } })));
  });

  it("the measured moon nights: median 0.0290 was BLACK, and is now legible", () => {
    const clean = scoreAtWorth(1);
    // BEFORE R7 the multiplier was `worth` raw. AFTER it is `0.35 + 0.65·worth`.
    const before = (w: number) => clean * w;
    const after = (w: number) => scoreAtWorth(w);

    // The 30-day Dnipro measurement (A): min 0.0003 · median 0.0290 · max 0.8639.
    expect(before(0.029) / clean).toBeCloseTo(0.029, 12);
    expect(after(0.029) / clean).toBeCloseTo(0.369, 3);
    expect(after(0.8639) / clean).toBeCloseTo(0.9115, 3);
    expect(after(0.0003) / clean).toBeCloseTo(0.35, 3);

    // SEPARATION IS PRESERVED — a good night still beats a bad one by a wide margin, and the order
    // is strict all the way down. (That is what rules out §8 Q1 option b, "just raise worth.floor".)
    const nights = [0.0003, 0.029, 0.09, 0.35, 0.8639];
    const scores = nights.map(after);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    expect(scores[4] / scores[0]).toBeGreaterThan(2.5);
  });

  it("`worth.floor` and `worth.effectiveFloor` are DIFFERENT numbers doing different jobs", () => {
    // The twilight-gate floor shapes `worth` ITSELF, inside the track…
    expect(BESTSPOT_SCORING_V1.worth.floor).toBe(0.25);
    const dark = worthFromParts("moonset", { sunAltAtT0Deg: -90, moonPhaseAngleDeg: 0 });
    expect(dark).toBeCloseTo(BESTSPOT_SCORING_V1.worth.floor, 12);
    const raisedGate = resolveScoring({ worth: { floor: 0.6 } });
    expect(
      worthFromParts("moonset", { sunAltAtT0Deg: -90, moonPhaseAngleDeg: 0 }, raisedGate),
    ).toBeCloseTo(0.6, 12);

    // …while the effective floor shapes how the finished `worth` ENTERS the product, and does not
    // touch `worth` at all.
    expect(BESTSPOT_SCORING_V1.worth.effectiveFloor).toBe(0.35);
    const raisedComp = resolveScoring({ worth: { effectiveFloor: 0.6 } });
    expect(worthFromParts("moonset", { sunAltAtT0Deg: -90, moonPhaseAngleDeg: 0 }, raisedComp))
      .toBeCloseTo(0.25, 12);
    expect(scoreAtWorth(0.029, raisedComp) / scoreAtWorth(1)).toBeCloseTo(
      0.6 + 0.4 * 0.029,
      6,
    );
  });
});

/**
 * THE LEAN-FOUND CLAMPS (2026-08-24d).
 *
 * Both of these were found by writing the composition down as a theorem in
 * `formal/Ftw/Score.lean` and discovering that its HYPOTHESES were not enforced at runtime —
 * not by any test, and not by inspection. `clampResolved`'s own docstring promises it "can be
 * handed a raw, unsanitized patch and still cannot return an unsafe or dishonest profile", and
 * `ftw:view-prefs:v1` feeds it a persisted blob on every boot, so both were reachable in the
 * shipped product.
 */
describe("SAFETY — the clamps the Lean specification forced", () => {
  it("graze.conf.* is bounded above by 1, so CellScore.f cannot exceed its documented range", () => {
    // `F_gap = notch.f · (relief · conf[src] · depth)`. `notch.f`, `relief` and `depth` are all
    // clamped to [0,1]; before this clamp `conf` was not, so conf = 2 published f = 1.6.
    // Lean: `Ftw.confBound` (holds given conf ≤ 1) + `Ftw.confBound_is_necessary` (fails without).
    const hostile = resolveScoring({
      graze: { conf: { none: 3, terrain: 5, building: 2, deck: 1.5, tree: 9 } },
    });
    expect(hostile.graze.conf.none).toBeLessThanOrEqual(1);
    expect(hostile.graze.conf.terrain).toBe(1);
    expect(hostile.graze.conf.building).toBe(1);
    expect(hostile.graze.conf.deck).toBe(1);
    // the pre-existing, TIGHTER tree ceiling still wins over the new general one
    expect(hostile.graze.conf.tree).toBe(BESTSPOT_SAFETY.confTreeMax);
    expect(BESTSPOT_SAFETY.confTreeMax).toBeLessThan(BESTSPOT_SAFETY.confMax);

    // and a legal profile is untouched — the clamp may only ever remove an out-of-range value
    const shipped = resolveScoring(null);
    expect(shipped.graze.conf).toEqual(BESTSPOT_SCORING_V1.graze.conf);

    // the single-leaf path is clamped too (`__globe.bestSpotTuning` reaches this one)
    expect(sanitizeScoringPatch({ graze: { conf: { terrain: 5 } } })).toEqual({
      graze: { conf: { terrain: 1 } },
    });
  });

  it("weights.* cannot go negative, so the blend stays monotone in every term", () => {
    // The composition normalises by Σw, which keeps S ≤ 1 — but a NEGATIVE weight makes S
    // non-monotone in its own term (a better silhouette would rank LOWER), and Σw = 0
    // short-circuits `preference` to 0.
    // Lean: `Ftw.preference_mono_f` (needs 0 ≤ w) + `Ftw.weights_nonneg_is_necessary`.
    const hostile = resolveScoring({ weights: { v: -1, l: -0.5, p: 0.25, f: 0.3 } });
    expect(hostile.weights.v).toBe(0);
    expect(hostile.weights.l).toBe(0);
    expect(hostile.weights.p).toBe(0.25);
    expect(hostile.weights.f).toBe(0.3);
    const sum =
      hostile.weights.v + hostile.weights.l + hostile.weights.p + hostile.weights.f;
    expect(sum).toBeGreaterThan(0);

    // zero is still reachable — "ignore this term" is a legitimate tune, and both presets rely on
    // being able to push a weight down hard
    expect(resolveScoring({ weights: { f: 0 } }).weights.f).toBe(0);
    expect(sanitizeScoringPatch({ weights: { f: -1 } })).toEqual({ weights: { f: 0 } });

    // every shipped preset survives untouched
    for (const [name, preset] of Object.entries(BESTSPOT_PRESETS)) {
      const r = resolveScoring(preset);
      const t = r.weights.v + r.weights.l + r.weights.p + r.weights.f;
      expect(t, `preset ${name}`).toBeGreaterThan(0);
    }
  });
});
