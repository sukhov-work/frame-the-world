/**
 * BEST SPOT — THE SCORING PROFILE (`.claude/claude-docs/BESTSPOT_SPEC_V2.md` §5, slice S3a).
 *
 * Owner requirement (vii) is a HARD ARCHITECTURAL requirement: every number a taste pass touches
 * must be reachable, hot-swappable and hashable. The audit found **30 of 67 scoring numbers
 * reachable and 37 not** — and the unreachable 37 included every gate edge, the whole accessibility
 * ladder, the moon-worth curve and the `A_soft` exponent, i.e. four of the seven things a taste pass
 * touches FIRST. This module is where those 37 now live.
 *
 * ─── THE FIVE RULES THIS FILE IS SHAPED BY ──────────────────────────────────────────────────────
 *
 *  1. **ZERO IMPORTS except `import type`.** Not a style preference: the §5.6 worker is long-lived
 *     and the profile rides the JOB (structured-cloned per message), never a module read — a
 *     module-scope read latches at worker spawn and is invisibly stale forever. Zero imports also
 *     means vitest reproduces the whole profile from nothing, and the worker bundle gains no
 *     `components/` edge. `tuning.ts` RE-EXPORTS this (the `WGS84_A/B` precedent, `tuning.ts:28`),
 *     it does not own it: all 52 tuning groups are `as const`, and `as const` on a nested profile
 *     makes every leaf a literal type — fine for a `readonly` interface, hostile to a `DeepPartial`
 *     merge and to a `Record<LandClass, …>` ladder.
 *
 *  2. **A PATH WITH NO `CLASS_OF` ENTRY IS `"rebuild"`.** Fail-safe: a newly added field is SLOW,
 *     never WRONG. `bestSpotScoring.test.ts` asserts every leaf of `BESTSPOT_SCORING_V1` has an
 *     entry, so the fallback is a safety net rather than the normal path.
 *
 *  3. **THREE THINGS ARE NOT TUNABLE, FOR THREE DIFFERENT REASONS** (§5.5). `BESTSPOT_PHYSICS`
 *     (tuning them makes the answer WRONG, not different), `BESTSPOT_SAFETY` (tuning them sends a
 *     person somewhere dangerous), `BESTSPOT_HONESTY` (asymmetric clamps — may become MORE honest,
 *     never less). They are SEPARATE exports precisely so the deep-merge literally cannot reach
 *     them: there is no key path from a patch to `GROUND[*].hard`.
 *
 *  4. **THE PATCH IS PERSISTED, NEVER THE RESOLVED PROFILE** (§5.7). So a future change to a
 *     shipped default propagates to every field the owner never touched. That is also why
 *     `sanitizeScoringPatch` copies only keys it KNOWS: a removed field must be dropped, not fatal.
 *
 *  5. **CLAMPS ARE CODE, NOT COMMENTS.** `smoothstep(edge0, edge1, x)` degenerates to a HARD STEP
 *     when `edge1 <= edge0` **without throwing** (`bestSpotMetric.smoothstep`), so
 *     `vGateHi >= vGateLo + 0.05` has to be an active clamp — a hard `V` gate would delete every
 *     silhouette shot the feature exists to find, silently.
 *
 * ─── TWO FLOORS NAMED `floor`, AND THEY ARE DIFFERENT NUMBERS ───────────────────────────────────
 *
 *  · `worth.floor` (0.25) is the TWILIGHT-GATE floor — the value `twilightGate(sunAlt)` ramps DOWN
 *    to when a moon event happens far outside the photographic twilight band. It shapes `worth`
 *    ITSELF, inside `bestSpotTrack`, and it is a shipped number (`WORTH_GATE_FLOOR`).
 *  · `worth.effectiveFloor` (0.35) is owner ruling **R7** and it is NEW. It shapes how the finished
 *    `worth` ENTERS THE PER-CELL PRODUCT: `M_eff = effectiveFloor + (1 − effectiveFloor)·worth`.
 *    Measured over 30 days at Dnipro, `worth` runs min 0.0003 / median 0.0290 / max 0.8639, so the
 *    best possible moon cell on a MEDIAN night scored ~0.020 — 25× below the sheet's legibility
 *    floor, i.e. the moon map was black ~26 nights in 30. R7: bad nights DIM rather than VANISH.
 *
 *  Conflating them is the obvious mistake: raising `worth.floor` compresses the honest signal
 *  (§8 Q1 option b, which the owner did NOT pick), raising `worth.effectiveFloor` compresses only
 *  the RENDERED dynamic range while leaving the ranking inside a night untouched.
 */

import type { LandClass, OccluderSrc } from "./bestSpotTypes";

// ---------------------------------------------------------------------------------------------
// The shape
// ---------------------------------------------------------------------------------------------

/** Bumped when a field's MEANING changes (§5.7 rule 3) — never when a default moves. */
export const BESTSPOT_SCORING_VERSION = 1;

/** Which composition terms exist. `cellScore` iterates THESE KEYS, so adding a term is one field
 *  plus a weight of 0 rather than an edit to the composition expression. */
export type BestSpotTermKey = "v" | "l" | "p" | "f";

/** How expensive it is to honour a change to one leaf. Ordered cheapest → most expensive by
 *  `INVALIDATION_RANK`; `scoringInvalidation` returns the STRONGEST class over a diff. */
export type InvalidationClass =
  | "repaint"
  | "recompose"
  | "reweigh"
  | "rescore"
  | "resweep"
  | "rebuild";

/** Cheapest → most expensive. The order IS the contract — `scoringInvalidation` maxes over it. */
export const INVALIDATION_RANK: Readonly<Record<InvalidationClass, number>> = Object.freeze({
  repaint: 0,
  recompose: 1,
  reweigh: 2,
  rescore: 3,
  resweep: 4,
  rebuild: 5,
});

export interface BestSpotScoring {
  /** `BESTSPOT_SCORING_VERSION` as resolved. Identifies the SHAPE; nothing reads it as a number. */
  readonly version: number;

  /**
   * The preference REGISTRY. Gates (`A_hard`, `M`, `G(V)`) are deliberately NOT here — they
   * multiply, and a slider that can move a gate is a slider that can paper over standing in a
   * river (`bestSpotTypes.BestSpotWeights`). Normalised by their own sum at use, so a custom blend
   * cannot inflate `S` past 1.
   */
  readonly weights: Readonly<Record<BestSpotTermKey, number>>;

  readonly gates: {
    /** `G(V) = smoothstep(vGateLo, vGateHi, V)` — SOFT, never a step (`V_GATE_LO`). */
    readonly vGateLo: number;
    /** `V_GATE_HI`. Clamped to `>= vGateLo + 0.05` — see rule 5 in the header. */
    readonly vGateHi: number;
    /** `f >= this` is "the disc is still there", which is what defines `az*` / `alt*` (`HALF_DISC`). */
    readonly halfDiscFrac: number;
    /**
     * Evidence floor below which the cell is UNKNOWN — a RENDER CLASS, never a low score
     * (`PLAN.minCoverageForGaps`). BESTSPOT_HONESTY: `effective = max(0.5, patch)`. Raising it is
     * legitimate taste (more UNKNOWN ink); lowering it is a lie.
     */
    readonly minCoverage: number;
  };

  readonly curves: {
    /** Upper edge of the CONTACT-LOWNESS ramp, deg (`L_CEIL_DEG`). Above it the body is just "up". */
    readonly lCeilDeg: number;
    /** `P`'s log lower anchor, m (`DEPTH_NEAR_REF_M`). Below ~30 m a blocker is a fence. */
    readonly depthNearRefM: number;
    /** `P`'s log ceiling, m — `PLAN.trustRadiusM`, the streamed-LOD trust edge. */
    readonly depthTrustRadiusM: number;
    /** The `A_soft` exponent. Was an INLINED `Math.sqrt(...)` — not even a named constant. */
    readonly accessSoftExponent: number;
  };

  /**
   * THE FRAMING GROUP — owner ruling **R5**'s GRAZE (`SPEC_V2 §1.1`). `F_graze = 1 − exp(−τ/scale)`
   * with `τ = Σ cut·Q·Δα/ρ`.
   *
   * **LIVE SINCE S3b.** The group shipped one slice ahead of its kernel (S3a wired only
   * `tangentHalfWidthRadii`, which at ONE disc radius reproduced the shipped `silTangency` exactly
   * and was therefore numerically inert). `grazeSample` + `cellScore` now read every leaf of it, and
   * `bestSpotScoring.test.ts` proves that by perturbation: the ten `graze.*` leaves came OFF
   * `EXPECT_INERT_ON_FIXTURE` when the kernel landed. `conf.none` is the one that stayed, and for a
   * producer reason rather than a slice one — see its entry there.
   *
   * `conf` and `scaleRadii` are **RECOMPOSE** (0.272 ms) and not rescore, because `CellScore.grazeTau`
   * carries τ SPLIT BY SOURCE with relief and depth baked in and confidence deliberately left out.
   */
  readonly graze: {
    /** Relief ramp low edge, deg — below it an edge is mesh noise, not a silhouette. */
    readonly reliefLoDeg: number;
    /** Relief ramp high edge, deg (~1.5 ρ). */
    readonly reliefHiDeg: number;
    /** e-folding scale of the dwell integral, in disc RADII. The ONE swept taste number. */
    readonly scaleRadii: number;
    /** The AREA arm `4·f·(1−f)` — orientation-agnostic, fires on a vertical flank AND a roofline. */
    readonly areaArm: boolean;
    /** The TANGENT arm `1 − clamp01(δ/ρ)` — the shipped triangular kernel, kept as a FLOOR so a
     *  thin occluder (a 1.8 m deck slab at 1.5 km = 0.27 ρ) is not lost. */
    readonly tangentArm: boolean;
    /** Half-width of the tangent arm, in disc RADII. 1 == the shipped `silTangency` kernel. */
    readonly tangentHalfWidthRadii: number;
    /**
     * Per-source confidence. Provenance survives R5 ONLY as a soft weight.
     * BESTSPOT_SAFETY clamps `tree <= 0.6`: 151,046 of Dnipro's 161,823 canopies are seeded scatter
     * with jittered class-default heights, so raising a tree to a building's confidence lets the
     * framing term fire on fiction.
     */
    readonly conf: Readonly<Record<OccluderSrc, number>>;
  };

  /** `F_gap` — the "moon rising between buildings" notch (`notchAt`). */
  readonly gap: {
    /** `±3°` — how far out the flanking mass is looked for (`NOTCH_SHOULDER_DEG`). */
    readonly shoulderSpanDeg: number;
    /** `0.1°` — HeyWhatsThat's "a few arcminutes" salience floor (`NOTCH_SALIENCE_DEG`). */
    readonly salienceFloorDeg: number;
    /** `3°` — shoulder height at which the depth term saturates (`NOTCH_MAX_DEPTH_DEG`). */
    readonly maxDepthDeg: number;
    /** `2°` — gap width at which the notch term dies (`NOTCH_MAX_WIDTH_DEG`). Clamped `>= 0.7` so
     *  the width denominator `maxWidthDeg − 2ρ` stays positive at the largest lunar ρ (0.279°). */
    readonly maxWidthDeg: number;
    /** Disc radii of clearance above the notch floor before a gap counts (`NOTCH_CLEARANCE_RADII`
     *  — the one `NOTCH_*` constant that missed `NotchOptions`). */
    readonly clearanceRadii: number;
    /** How the two shoulders' quality is combined into the notch weight. **S3b consumes this**;
     *  applying it in S3a would change the shipped `F_notch`. */
    readonly shoulderQuality: "min" | "mean" | "off";
  };

  readonly trackWeight: {
    /** e-folding scale of the altitude weight, deg (`TRACK_WEIGHT_SCALE_DEG`). */
    readonly altScaleDeg: number;
    /**
     * KILL SWITCH for the AS-BUILT horizon-ceiling fix — a BOOLEAN, not a number, because the
     * ceiling has no free scale (it is the fraction of the disc a perfectly open eye could see).
     * OFF reproduces the measured defect: 46.9 % of the normalised weight below a 1.7 m eye's own
     * dip, `V = 0.5138` over a PERFECT open horizon. It exists so that measurement is reproducible,
     * not so anyone ships with it off.
     */
    readonly horizonCeiling: boolean;
  };

  /** `M` — the per-scene worth of the event. See the header for the two different `floor`s. */
  readonly worth: {
    /** Upper edge of the twilight PLATEAU, deg of sun altitude (`WORTH_GATE_HI_DEG`, +0.5). */
    readonly plateauHiDeg: number;
    /** Lower edge of the plateau (`WORTH_GATE_LO_DEG`, −6 = `LIGHT_DEG.blue`). */
    readonly plateauLoDeg: number;
    /** Where the gate reaches its floor above (`WORTH_RAMP_HI_DEG`, +6 = `LIGHT_DEG.goldenHi`). */
    readonly rampHiDeg: number;
    /** …and below (`WORTH_RAMP_LO_DEG`, −12 = `LIGHT_DEG.nautical`). */
    readonly rampLoDeg: number;
    /** The TWILIGHT-GATE floor (`WORTH_GATE_FLOOR`, 0.25). NOT `effectiveFloor`. */
    readonly floor: number;
    /**
     * Owner ruling **R7**: `M_eff = effectiveFloor + (1 − effectiveFloor)·worth`, so a bad night
     * DIMS rather than VANISHES. Median night 0.029 → 0.369; full moon 0.864 → 0.911. Exactly 1 for
     * every sun kind (`worth = 1` ⇒ `M_eff = 1`), so no sun number moves.
     */
    readonly effectiveFloor: number;
    /** `"badge"` takes `M` out of the per-cell product entirely (§8 Q1 option c) — the field then
     *  ranks WHERE to stand and the panel badge says WHETHER the night is worth going out for. */
    readonly mode: "multiply" | "badge";
    /**
     * `"ks1991"` is the repo's shipped Krisciunas–Schaefer 1991 curve (`moonlight.ts`) — a quarter
     * moon is ~9 % of full. `"illumFrac"` is the naive `(1+cos α)/2` (a quarter moon is 50 %) and
     * is **DEV-ONLY**: `sanitizeScoringPatch` REFUSES it with a console warning unless
     * `{ dev: true }`, because persisting it would reintroduce the error the curve exists to fix.
     */
    readonly phaseCurve: "ks1991" | "illumFrac" | "off";
  };

  readonly access: {
    /** Sheet height (m) at or above which R1 DRONE rules replace ground rules (`AERIAL_MIN_M`).
     *  BESTSPOT_SAFETY clamps `>= 2`: below ~2 m water stops masking for a STANDING person. */
    readonly aerialMinM: number;
    /** `surface=unpaved` / `foot=no` multiplier (`DEMOTE_K`). "They never certify" — a multiplier,
     *  never a gate. */
    readonly demoteK: number;
    /** The SOFT half of the ground ladder, 11 rows. The `hard` bits are `BESTSPOT_SAFETY`. */
    readonly soft: Readonly<Record<LandClass, number>>;
  };

  /** Quadrature columns across the disc (§3.3). Buys a smoother AREA integral, never more
   *  knowledge — the honest limit stays the sweep's own azimuth step. */
  readonly quadrature: { readonly discColumns: number };
}

/** Every leaf optional, recursively. `Record` maps patch KEY-BY-KEY (a partial ladder touches only
 *  the classes it names) because this is a plain deep-partial over a flat number map. */
export type DeepPartial<T> = {
  -readonly [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type BestSpotScoringPatch = DeepPartial<BestSpotScoring>;

// ---------------------------------------------------------------------------------------------
// The three NON-TUNABLE blocks — §5.5. No key path from a patch reaches any of these.
// ---------------------------------------------------------------------------------------------

/**
 * **Tuning these makes the answer WRONG, not different.**
 *
 * `refractionK` is folded into THREE places that must agree — the hull's `drop = (1−k)/2R`
 * (`horizonSweep.ts`), the dip anchor in `L` (`bestSpotMetric`) and the track's dip
 * (`bestSpotTrack`) — and it is also `PLAN.refractionK`, used by the shipped planner. Forking it
 * recreates "two conventions that look alike", this repo's most expensive recurring bug class.
 *
 * `softQ` is here for a subtler reason: it is the quantisation the ground ladder was CHOSEN around
 * (200, not 255, so every rung AND its ×`demoteK` demote is exactly representable — 1 → 200,
 * 0.9 → 180, 0.85 → 170, 0.6 → 120, 0.45 → 90, 0.15 → 30, 0.1 → 20). §5.3(a) retired it as a
 * STORAGE format (`LandGrid` resolves `soft` at read time now), but the exactness property is what
 * lets `landcoverRaster.test.ts` assert `soft === 0.85` instead of `toBeCloseTo`, which is the
 * difference between a pin that fails when the ladder changes and one that shrugs.
 */
export const BESTSPOT_PHYSICS = Object.freeze({
  /** Terrestrial refraction coefficient (surveyor's standard) — `PLAN.refractionK`. */
  refractionK: 0.13,
  /** Mean earth radius (m) — `horizonProfile.R_MEAN_M`, the ONE radius the dip, the curvature drop
   *  and the ECEF sweep lift all share. */
  earthRadiusM: 6_371_000,
  /** The ground ladder's exactness quantisation — `landcoverRaster.SOFT_Q`. */
  softQ: 200,
  /** Azimuth-lattice edge slack (deg): `new Date(ms)` truncates, so a bisected 3.000° shoulder
   *  lands at 2.9999985° and a tight `floor` silently drops the outermost step on BOTH sides. */
  edgeSlack: 1e-3,
  /** Strict-ascent epsilon on the track's unwrapped azimuth — a zero-width central difference is
   *  an infinite weight. */
  ascentEps: 1e-9,
  /** Lower clamp inside `P`'s logarithm (m) — `ln(0)` is `-Infinity`, and `clamp01` would hide it. */
  logClampM: 1e-6,
  /** Floor on `cos(alt)` in the disc's small-circle widening — stops a 90° reuse dividing by 0. */
  cosAltFloor: 0.05,
} as const);

/** The HARD half of the ground ladder — all 11 bits, `landcoverRaster`'s one source for them. */
const GROUND_HARD: Readonly<Record<LandClass, 0 | 1>> = Object.freeze({
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

/**
 * **Tuning these sends a person somewhere DANGEROUS.**
 *
 * `groundHard` — all 11 bits. Flipping `water.hard` makes the top-K tell a photographer to stand in
 * a river; `blocked` covers military / industrial / railway and is **C6-relevant**. The SOFT values
 * ARE tunable (`BestSpotScoring.access.soft`); only the bits are locked.
 */
export const BESTSPOT_SAFETY = Object.freeze({
  /** `0` kills the cell at any framing score. */
  groundHard: GROUND_HARD,
  /** Floor under `access.aerialMinM` (m). Below ~2 m the R1 drone rules would apply to a STANDING
   *  person, water stops masking, and the map sends you into the Dnipro. Clamped, not banned. */
  aerialMinFloorM: 2,
  /** Ceiling on `graze.conf.tree` — see the `conf` docstring. */
  confTreeMax: 0.6,
} as const);

/**
 * **Asymmetric clamps: may become MORE honest, never less.**
 *
 * `minWeightFraction` is deliberately NOT a `BestSpotScoring` leaf — it is not exposed at all. The
 * horizon ceiling reaches exactly 0 once the whole disc is under the observer's dip, and a
 * zero-weight sample would silently vanish from `C = Σ w·known / Σ w`, the honesty channel that
 * §3.4 defines over the FULL swept span.
 */
export const BESTSPOT_HONESTY = Object.freeze({
  /** `gates.minCoverage` may only be RAISED: `effective = max(0.5, patch)`. */
  minCoverageFloor: 0.5,
  /** `gates.vGateHi - gates.vGateLo` may never fall below this — `smoothstep` degenerates to a hard
   *  step WITHOUT THROWING, and a hard `V` gate deletes every silhouette shot. */
  vGateMinSpan: 0.05,
  /** Floor on the track's per-sample weight, as a fraction — `TRACK_MIN_WEIGHT_FRACTION`. */
  minWeightFraction: 1e-3,
} as const);

// ---------------------------------------------------------------------------------------------
// THE SHIPPED PROFILE — every value verbatim from the constants it replaces
// ---------------------------------------------------------------------------------------------

/**
 * `v1`. Every number here is the value that was already shipping, so landing the profile was a
 * numerically INERT refactor apart from the one named behaviour change, owner ruling R7
 * (`worth.effectiveFloor` / `worth.mode`).
 */
export const BESTSPOT_SCORING_V1: BestSpotScoring = freezeDeep<BestSpotScoring>({
  version: BESTSPOT_SCORING_VERSION,

  // `bestSpotTypes.BESTSPOT_WEIGHTS`
  weights: { v: 0.15, l: 0.3, p: 0.25, f: 0.3 },

  gates: {
    vGateLo: 0.15, // V_GATE_LO
    vGateHi: 0.75, // V_GATE_HI
    halfDiscFrac: 0.5, // HALF_DISC
    minCoverage: 0.5, // PLAN.minCoverageForGaps
  },

  curves: {
    lCeilDeg: 5, // L_CEIL_DEG
    depthNearRefM: 30, // DEPTH_NEAR_REF_M
    depthTrustRadiusM: 3_000, // PLAN.trustRadiusM
    accessSoftExponent: 0.5, // the inlined Math.sqrt in the composition
  },

  graze: {
    reliefLoDeg: 0.05,
    reliefHiDeg: 0.4,
    scaleRadii: 1.75,
    areaArm: true,
    tangentArm: true,
    tangentHalfWidthRadii: 1, // the shipped `silTangency` half-width
    conf: { none: 0, terrain: 1, building: 0.9, tree: 0.45, deck: 0.9 },
  },

  gap: {
    shoulderSpanDeg: 3, // NOTCH_SHOULDER_DEG
    salienceFloorDeg: 0.1, // NOTCH_SALIENCE_DEG
    maxDepthDeg: 3, // NOTCH_MAX_DEPTH_DEG
    maxWidthDeg: 2, // NOTCH_MAX_WIDTH_DEG
    clearanceRadii: 1, // NOTCH_CLEARANCE_RADII
    shoulderQuality: "min",
  },

  trackWeight: {
    altScaleDeg: 2.5, // TRACK_WEIGHT_SCALE_DEG
    horizonCeiling: true, // the AS-BUILT fix, ON
  },

  worth: {
    plateauHiDeg: 0.5, // WORTH_GATE_HI_DEG
    plateauLoDeg: -6, // WORTH_GATE_LO_DEG  == LIGHT_DEG.blue
    rampHiDeg: 6, // WORTH_RAMP_HI_DEG  == LIGHT_DEG.goldenHi
    rampLoDeg: -12, // WORTH_RAMP_LO_DEG  == LIGHT_DEG.nautical
    floor: 0.25, // WORTH_GATE_FLOOR   (the TWILIGHT-GATE floor)
    effectiveFloor: 0.35, // owner ruling R7   (the COMPOSITION floor)
    mode: "multiply",
    phaseCurve: "ks1991",
  },

  access: {
    aerialMinM: 5, // bestSpotTypes.AERIAL_MIN_M
    demoteK: 0.7, // landcoverRaster.DEMOTE_K
    soft: {
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
    },
  },

  quadrature: { discColumns: 8 },
});

/**
 * Named starting points (§5.7). Stored as the RESOLVED PATCH, so a preset that later changes does
 * not retroactively move a tune somebody already saved.
 */
export const BESTSPOT_PRESETS: Readonly<Record<string, BestSpotScoringPatch>> = Object.freeze({
  default: Object.freeze({}),
  "depth-forward": Object.freeze({ weights: Object.freeze({ p: 0.4, f: 0.15 }) }),
  "framing-forward": Object.freeze({ weights: Object.freeze({ p: 0.15, f: 0.45 }) }),
});

// ---------------------------------------------------------------------------------------------
// §5.4 — the invalidation-class table. THE TABLE IS THE CONTRACT.
// ---------------------------------------------------------------------------------------------

/**
 * Leaf path → how expensive it is to honour a change to it.
 *
 * The costs behind the classes, measured at 3 m / 300 m (§5.4): repaint < 0.1 ms · recompose
 * 0.272 ms · reweigh 4.27 ms · rescore 177 ms · resweep 343 ms · rebuild 490–548 ms. **Every taste
 * knob is recompose, reweigh or repaint**; the rescore rows are acceptable on slider RELEASE, not
 * during a drag. Nothing here needs an architecture change to re-taste.
 *
 * Two rows extend §5.4's table rather than contradicting it, and both are named here so the
 * extension is visible: `graze.tangentHalfWidthRadii` rides the table's `graze.*Arm` row (it is the
 * same τ-baking family), and `version` is `rebuild` because a version change means the SHAPE moved.
 */
const CLASS_TABLE: Record<string, InvalidationClass> = {
  version: "rebuild",

  "weights.v": "recompose",
  "weights.l": "recompose",
  "weights.p": "recompose",
  "weights.f": "recompose",

  "gates.vGateLo": "recompose",
  "gates.vGateHi": "recompose",
  "gates.halfDiscFrac": "rescore",
  "gates.minCoverage": "recompose",

  "curves.lCeilDeg": "recompose",
  "curves.accessSoftExponent": "recompose",
  // P is recompose, but GRAZE's per-edge Depth is baked into τ — so these two are rescore.
  "curves.depthNearRefM": "rescore",
  "curves.depthTrustRadiusM": "rescore",

  "graze.scaleRadii": "recompose", // τ is stored SPLIT BY SOURCE, so the scale is free
  "graze.conf.none": "recompose",
  "graze.conf.terrain": "recompose",
  "graze.conf.building": "recompose",
  "graze.conf.tree": "recompose",
  "graze.conf.deck": "recompose",
  "graze.reliefLoDeg": "rescore",
  "graze.reliefHiDeg": "rescore",
  "graze.areaArm": "rescore",
  "graze.tangentArm": "rescore",
  "graze.tangentHalfWidthRadii": "rescore",

  "gap.salienceFloorDeg": "recompose",
  "gap.maxDepthDeg": "recompose",
  "gap.maxWidthDeg": "recompose",
  "gap.clearanceRadii": "recompose",
  "gap.shoulderQuality": "recompose",
  "gap.shoulderSpanDeg": "rescore",

  "trackWeight.altScaleDeg": "reweigh",
  "trackWeight.horizonCeiling": "reweigh",

  // recompose only AFTER §5.3(b) — `EventTrack` carries `sunAltAtT0Deg` + `moonPhaseAngleDeg`, so
  // the whole worth curve is recomputable without touching the ephemeris. Without that it is a
  // rebuild.
  "worth.plateauHiDeg": "recompose",
  "worth.plateauLoDeg": "recompose",
  "worth.rampHiDeg": "recompose",
  "worth.rampLoDeg": "recompose",
  "worth.floor": "recompose",
  "worth.effectiveFloor": "recompose",
  "worth.mode": "recompose",
  "worth.phaseCurve": "recompose",

  // recompose only AFTER §5.3(a) — `LandGrid` carries `cls` + `flags` and resolves `soft` at READ
  // time. Without that every one of these is a re-raster (2.2–31 ms).
  "access.aerialMinM": "recompose",
  "access.demoteK": "recompose",
  "access.soft.unknown": "recompose",
  "access.soft.water": "recompose",
  "access.soft.wetland": "recompose",
  "access.soft.building": "recompose",
  "access.soft.deck": "recompose",
  "access.soft.path": "recompose",
  "access.soft.road": "recompose",
  "access.soft.majorRoad": "recompose",
  "access.soft.green": "recompose",
  "access.soft.pitch": "recompose",
  "access.soft.blocked": "recompose",

  "quadrature.discColumns": "rescore",
};

export const CLASS_OF: Readonly<Record<string, InvalidationClass>> = Object.freeze(CLASS_TABLE);

// ---------------------------------------------------------------------------------------------
// Merge / resolve / sanitize
// ---------------------------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

function isPlainObject(x: unknown): x is PlainObject {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Recursively `Object.freeze`. `resolveScoring` returns a FROZEN, fully-populated profile — there
 *  is no partially-resolved state anywhere in the system. */
function freezeDeep<T>(value: T): T {
  if (isPlainObject(value)) {
    for (const k of Object.keys(value)) freezeDeep(value[k]);
    Object.freeze(value);
  }
  return value;
}

/** Structural clone of a plain-object tree (the profile has no arrays, dates or class instances). */
function cloneTree<T>(value: T): T {
  if (!isPlainObject(value)) return value;
  const out: PlainObject = {};
  for (const k of Object.keys(value)) out[k] = cloneTree(value[k]);
  return out as T;
}

/** The enum leaves, and what each one accepts. A patch naming an unlisted value is DROPPED. */
const ENUM_VALUES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "gap.shoulderQuality": ["min", "mean", "off"],
  "worth.mode": ["multiply", "badge"],
  "worth.phaseCurve": ["ks1991", "illumFrac", "off"],
});

/**
 * Merge `patch` onto `base`, DRIVEN BY THE SHAPE OF `base`.
 *
 * That direction is the whole trick: keys the shipped profile does not have are never even looked
 * at, so an unknown key (a v0 field that was renamed, a typo, a hostile blob out of localStorage)
 * is dropped silently and for free — the `sanitizeViewPrefs` idiom (`prefs.ts:77-121`). Values of
 * the wrong TYPE are dropped the same way, so `{ gates: { vGateLo: "0.2" } }` cannot poison a
 * Float32Array the GL sheet samples.
 */
function mergeInto(base: PlainObject, patch: unknown, path: string): void {
  if (!isPlainObject(patch)) return;
  for (const key of Object.keys(base)) {
    const leafPath = path ? `${path}.${key}` : key;
    const current = base[key];
    const next = (patch as PlainObject)[key];
    if (next === undefined) continue;
    if (isPlainObject(current)) {
      mergeInto(current, next, leafPath);
      continue;
    }
    if (typeof current === "number") {
      if (typeof next === "number" && Number.isFinite(next)) base[key] = next;
      continue;
    }
    if (typeof current === "boolean") {
      if (typeof next === "boolean") base[key] = next;
      continue;
    }
    if (typeof current === "string") {
      const allowed = ENUM_VALUES[leafPath];
      if (typeof next === "string" && (!allowed || allowed.includes(next))) base[key] = next;
    }
  }
}

/**
 * The §5.5 clamps, applied to a RESOLVED profile.
 *
 * Deliberately run at resolve time and not only at sanitize time: the pairwise
 * `vGateHi >= vGateLo + 0.05` invariant needs BOTH values, and a patch that names only one of them
 * cannot be checked against a value it does not carry. `resolveScoring` is therefore TOTAL — it can
 * be handed a raw, unsanitized patch and still cannot return an unsafe or dishonest profile.
 */
function clampResolved(s: PlainObject): void {
  const gates = s.gates as PlainObject;
  const curves = s.curves as PlainObject;
  const graze = s.graze as PlainObject;
  const gap = s.gap as PlainObject;
  const access = s.access as PlainObject;
  const quadrature = s.quadrature as PlainObject;

  // HONESTY — may become MORE honest, never less.
  gates.minCoverage = Math.max(BESTSPOT_HONESTY.minCoverageFloor, gates.minCoverage as number);
  gates.vGateLo = Math.min(1, Math.max(0, gates.vGateLo as number));
  gates.vGateHi = Math.max(
    (gates.vGateLo as number) + BESTSPOT_HONESTY.vGateMinSpan,
    gates.vGateHi as number,
  );

  // SAFETY.
  access.aerialMinM = Math.max(BESTSPOT_SAFETY.aerialMinFloorM, access.aerialMinM as number);
  const conf = graze.conf as PlainObject;
  conf.tree = Math.min(BESTSPOT_SAFETY.confTreeMax, conf.tree as number);

  // §1004's proposed ranges — pinned in the tests rather than trusted from the spec.
  gap.maxWidthDeg = Math.max(0.7, gap.maxWidthDeg as number);
  curves.lCeilDeg = Math.min(30, Math.max(0.5, curves.lCeilDeg as number));
  quadrature.discColumns = Math.min(64, Math.max(1, Math.floor(quadrature.discColumns as number)));
}

/**
 * `patch` → a FROZEN, fully-populated profile. Never throws, never returns a partial.
 *
 * Objects deep-merge; `Record` maps patch KEY-BY-KEY; unknown keys are dropped silently. A `null`
 * or `undefined` patch resolves to the shipped default — that is `__globe.bestSpotTuning(null)`.
 */
export function resolveScoring(patch?: BestSpotScoringPatch | null): BestSpotScoring {
  const out = cloneTree(BESTSPOT_SCORING_V1) as unknown as PlainObject;
  if (patch) mergeInto(out, patch as unknown as PlainObject, "");
  clampResolved(out);
  return freezeDeep(out as unknown as BestSpotScoring);
}

/**
 * A raw, untrusted blob → a patch safe to PERSIST (§5.7). The `sanitizeViewPrefs` idiom.
 *
 * Copies only keys it KNOWS (so a field removed in a later version is dropped, not fatal), applies
 * the §5.5 clamps that can be decided from one value, and REFUSES `worth.phaseCurve: "illumFrac"`
 * with a console warning unless `{ dev: true }` — that seam exists so the owner can SEE the
 * difference in a session without persisting "a quarter moon is 50 %" into `ftw:view-prefs:v1`.
 */
export function sanitizeScoringPatch(
  raw: unknown,
  opts: { dev?: boolean } = {},
): BestSpotScoringPatch {
  const out: PlainObject = {};
  if (!isPlainObject(raw)) return out as BestSpotScoringPatch;
  sanitizeInto(BESTSPOT_SCORING_V1 as unknown as PlainObject, raw, out, "", opts.dev === true);
  return out as BestSpotScoringPatch;
}

function sanitizeInto(
  shape: PlainObject,
  raw: PlainObject,
  out: PlainObject,
  path: string,
  dev: boolean,
): void {
  for (const key of Object.keys(shape)) {
    const leafPath = path ? `${path}.${key}` : key;
    const model = shape[key];
    const value = raw[key];
    if (value === undefined) continue;

    if (isPlainObject(model)) {
      if (!isPlainObject(value)) continue;
      const child: PlainObject = {};
      sanitizeInto(model, value, child, leafPath, dev);
      if (Object.keys(child).length > 0) out[key] = child;
      continue;
    }

    if (typeof model === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      out[key] = clampLeaf(leafPath, value);
      continue;
    }

    if (typeof model === "boolean") {
      if (typeof value === "boolean") out[key] = value;
      continue;
    }

    if (typeof model === "string") {
      if (typeof value !== "string") continue;
      const allowed = ENUM_VALUES[leafPath];
      if (allowed && !allowed.includes(value)) continue;
      if (leafPath === "worth.phaseCurve" && value === "illumFrac" && !dev) {
        // Not a throw: a refused value must not take the REST of a saved tune down with it.
        console.warn(
          'bestSpotScoring: worth.phaseCurve "illumFrac" is DEV-only and was refused — ' +
            "Krisciunas–Schaefer says a quarter moon is ~9 % of full, not 50 %. " +
            "Pass { dev: true } to A/B it in this session without persisting it.",
        );
        continue;
      }
      out[key] = value;
    }
  }
}

/** The per-leaf clamps that need only the leaf's own value. The pairwise `vGateHi >= vGateLo + 0.05`
 *  invariant cannot live here (it needs both) — `clampResolved` owns it, and a patch naming only one
 *  edge is checked against the SHIPPED value of the other so the persisted patch is already sane. */
function clampLeaf(leafPath: string, value: number): number {
  switch (leafPath) {
    case "gates.minCoverage":
      return Math.max(BESTSPOT_HONESTY.minCoverageFloor, value);
    case "gates.vGateLo":
      return Math.min(
        BESTSPOT_SCORING_V1.gates.vGateHi - BESTSPOT_HONESTY.vGateMinSpan,
        Math.max(0, value),
      );
    case "gates.vGateHi":
      return Math.max(BESTSPOT_SCORING_V1.gates.vGateLo + BESTSPOT_HONESTY.vGateMinSpan, value);
    case "access.aerialMinM":
      return Math.max(BESTSPOT_SAFETY.aerialMinFloorM, value);
    case "graze.conf.tree":
      return Math.min(BESTSPOT_SAFETY.confTreeMax, value);
    case "gap.maxWidthDeg":
      return Math.max(0.7, value);
    case "curves.lCeilDeg":
      return Math.min(30, Math.max(0.5, value));
    case "quadrature.discColumns":
      return Math.min(64, Math.max(1, Math.floor(value)));
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------------------------
// Hash / diff / invalidation — the three things that keep the picture agreeing with the numbers
// ---------------------------------------------------------------------------------------------

/** Every leaf path of a profile-shaped tree, in a STABLE (sorted) order. */
function leafPaths(node: unknown, path: string, out: string[]): void {
  if (isPlainObject(node)) {
    for (const k of Object.keys(node).sort()) leafPaths(node[k], path ? `${path}.${k}` : k, out);
    return;
  }
  out.push(path);
}

/** Every leaf path of `BESTSPOT_SCORING_V1`, sorted. The test walks exactly this list. */
export function scoringLeafPaths(): string[] {
  const out: string[] = [];
  leafPaths(BESTSPOT_SCORING_V1, "", out);
  return out;
}

function leafAt(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split(".")) {
    if (!isPlainObject(node)) return undefined;
    node = node[part];
  }
  return node;
}

/** Canonical JSON: keys sorted at every level, numbers rendered at `toPrecision(12)`.
 *
 *  The precision is not cosmetic. Two profiles that differ only in the last bits of a double are
 *  the SAME tune — `0.1 + 0.2` and `0.30000000000000004` must hash alike, or the store's
 *  "did the scoring change?" test fires on arithmetic noise and the map re-solves forever. */
function canonicalJson(node: unknown): string {
  if (typeof node === "number") return JSON.stringify(node.toPrecision(12));
  if (isPlainObject(node)) {
    const parts = Object.keys(node)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(node[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(node);
}

/**
 * FNV-1a over the canonical JSON, as 8 lowercase hex digits.
 *
 * §5.6: this integer is echoed on every worker result and asserted against the store's current hash
 * BEFORE the texture upload. A mismatch means a stale job landed after a newer patch — drop it.
 * That one check is what stops "the picture disagrees with the numbers".
 */
export function scoringHash(s: BestSpotScoring): string {
  const text = canonicalJson(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply without BigInt: 16777619 = 2^24 + 2^8 + 0x93.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface ScoringDiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

/**
 * Leaf-by-leaf difference against the shipped default (or any other baseline).
 *
 * This is what the panel's status line counts (`SCORING: custom (4 fields) · 3f9a2c17`) and what
 * `.export()` prints as a paste-ready patch. §5.7 rule 4: a non-empty persisted patch MUST announce
 * itself, or the next taste pass runs against numbers the owner forgot he set.
 */
export function scoringDiff(
  s: BestSpotScoring,
  baseline: BestSpotScoring = BESTSPOT_SCORING_V1,
): ScoringDiffEntry[] {
  const out: ScoringDiffEntry[] = [];
  const paths: string[] = [];
  leafPaths(baseline, "", paths);
  for (const path of paths) {
    const from = leafAt(baseline, path);
    const to = leafAt(s, path);
    if (!Object.is(from, to)) out.push({ path, from, to });
  }
  // Leaves the baseline does not have (a NEWER profile against an older baseline) still count.
  const own: string[] = [];
  leafPaths(s, "", own);
  for (const path of own) {
    if (paths.includes(path)) continue;
    out.push({ path, from: undefined, to: leafAt(s, path) });
  }
  return out;
}

/**
 * The STRONGEST invalidation class over everything that changed between two profiles.
 *
 * A path with no `CLASS_OF` entry is `"rebuild"` — fail-safe, because a new field is slow and never
 * wrong. An EMPTY diff returns `"repaint"`, the cheapest class: nothing about the score moved, so
 * at most the surface needs redrawing.
 */
export function scoringInvalidation(
  prev: BestSpotScoring,
  next: BestSpotScoring,
): InvalidationClass {
  let worst: InvalidationClass = "repaint";
  for (const { path } of scoringDiff(next, prev)) {
    const cls = CLASS_OF[path] ?? "rebuild";
    if (INVALIDATION_RANK[cls] > INVALIDATION_RANK[worst]) worst = cls;
  }
  return worst;
}
