/**
 * BEST SPOT — the shared contract between the SWEEP (which produces per-cell ray evidence) and the
 * METRIC (which scores it). See `.claude/claude-docs/bestspot/BESTSPOT_PLAN.md` for the full design.
 *
 * Pure, three-free, store-free, explicit-epoch-ms — the `horizonProfile`/`occlusion` idiom, so the
 * whole kernel is unit-testable in vitest without WebGL and importable from a Web Worker.
 *
 * THE FOUR THINGS THIS FILE EXISTS TO PIN (each one is a shipped-bug class the design pass caught):
 *
 *  1. **APPARENT vs AIRLESS.** Every altitude in these types that names itself `...AppDeg` is an
 *     APPARENT angle — refraction folded in — because the skyline it is compared against is apparent
 *     by shipped contract (`horizonProfile.ts` subtracts the curvature drop `d²(1−k)/2R` in the march
 *     and `azAltOfEcef` adds the lift `k·d²/2R`). `lib/ephemeris/bodies.horizontal()` is AIRLESS by
 *     shipped contract. Comparing the two directly is a **0.6243° error at the event instant — 2.37
 *     solar radii** — in a feature that lives entirely inside a 0–2° band. Convert once, at the track,
 *     and never mix the two refractions: astronomical 34′ lives only inside astronomy-engine,
 *     terrestrial k = 0.13 lives only inside the profile.
 *
 *  2. **A MAX IS NOT A SILHOUETTE.** `groundAltAppDeg` is the horizon of things resting on the ground;
 *     FLOATING solids (bridge decks, arches, piers) live in a separate `bands` list. A single MAX
 *     cannot represent sky UNDER a deck, which makes "the sun setting behind the bridge" and "a blank
 *     15-storey wall" the same object — and the wall then outscores an open river horizon. The owner's
 *     hero location IS a bridge deck, so this separation is load-bearing, not a nicety.
 *
 *  3. **THE GROUND HORIZON IS SIGNED.** It is NOT floored at the eye-height dip. `createProfile` fills
 *     every bin with `openSkyAltDeg` and can only ever RISE (`raiseBin`), so it cannot tell a cell on a
 *     bluff above the river — which has a genuinely DEPRESSED horizon — from flat ground.
 *
 *  4. **IGNORANCE IS NOT CLEAR SKY.** `known` is the honesty channel. An unsampled azimuth must be
 *     DROPPED from the visibility integral, never scored as visible. The shipped convention is that an
 *     unsampled bin reports the open-sky floor with `known = 0`, so any consumer that reads the value
 *     without the flag silently converts ignorance into a good score.
 *
 *  5. **A BAND WITHOUT PROVENANCE IS A DEAD TERM (LENS B, 2026-08-24).** Pin 2 gave floating solids
 *     their own angular channel but left the SETTER TAG and the DISTANCE bound to the ground horizon
 *     alone — and `localDsm` deliberately keeps floating solids out of `surfaceTop`/`surfaceSrc`, so a
 *     genuine bridge deck published `src: "terrain"`. `F_sil` early-returns on `!isBuiltSrc(src)`, so
 *     the tangency kernel BESTSPOT_PLAN §3.4 wrote FOR the bridge was structurally unreachable on the
 *     owner's hero geometry: measured, the same cell scored 0.60799 WITH the deck against 0.62306 with
 *     no bridge at all — the bridge was a pure liability. `bands` therefore carries `bandSrc` and
 *     `bandDistM` alongside it, and §3.2's "the geometry that set Hg(a), OR the nearest band edge" is
 *     implemented on BOTH halves of that sentence.
 *
 *  7. **MISSING DATA DOES NOT READ AS "UNKNOWN" — IT READS AS THE BEST SPOT ON THE MAP (S3c,
 *     SPEC_V2 §3).** Pin 4 gave the sweep an evidence FLAG; it never gave it a RANGE. `known = 1`
 *     means "this ray found ≥ 1 forward sample", which is true of a ray that saw 10 m of ground and
 *     then fell off the edge of a truncated DSM. MEASURED, identical scene, identical track, centre
 *     cell, 1.7 m eye, a real 30 m ridge 500 m up-sun: with the DSM out to 700 m (the TRUTH) the
 *     cell scores **0.0000**; with the DSM truncated at 350 m it scores **0.6633**, reports
 *     coverage **1.000**, and claims open sky on **all 40 rays** — indistinguishable from a
 *     genuinely open plain (0.6613). At the rim the same shape costs 14×: a cell 290 m up-sun reads
 *     0.0467 with the 400 m collar and 0.6619 without.
 *
 *     `reachM` is the missing range, `openSky` is gated on it, and `CellScore.minReachM` publishes
 *     the worst direction so the panel can say it out loud. It is ALSO what makes refinement safe:
 *     without it, a disc that gains data as tiles stream in silently LOWERS its scores, and the
 *     owner reads that as a regression rather than as the truth arriving.
 *
 *  6. **THE SHOULDERS ARE NOT PART OF THE VISIBILITY INTEGRAL (LENS B, 2026-08-24).** `EventTrack`
 *     spans the window PLUS azimuth shoulders that exist only for `F_notch`'s sL/sR and for the
 *     coverage term `C`. Carrying no marker for that boundary cost 47 % of the normalised weight to a
 *     region where `f = 0` is guaranteed by geometry — `V` over a PERFECT open horizon measured 0.5138
 *     against §10 S1's own ≥ 0.95 done-check. `windowLo`/`windowHi` are that marker.
 */

/** Which event the disc is being scored for. */
export type BestSpotKind = "sunrise" | "sunset" | "moonrise" | "moonset";

/** Whether a `BestSpotKind` describes the body coming up or going down. */
export function isRiseKind(kind: BestSpotKind): boolean {
  return kind === "sunrise" || kind === "moonrise";
}

/** The body a `BestSpotKind` is about — the string `lib/ephemeris` bodies/targets faces expect. */
export function kindBody(kind: BestSpotKind): "sun" | "moon" {
  return kind === "sunrise" || kind === "sunset" ? "sun" : "moon";
}

// ---------------------------------------------------------------------------------------------
// The track — one per disc, NOT one per cell
// ---------------------------------------------------------------------------------------------

/**
 * One sample of the body's rise/set track, reparameterised by AZIMUTH rather than by time.
 *
 * WHY AZIMUTH IS THE INDEX: over the event window both `az(t)` and `alt(t)` are monotone, so every
 * swept ray has exactly ONE crossing — which collapses the time index and the azimuth index into one
 * and removes a real aliasing defect. Sampled on time instead, the tangency kernel's half-width is
 * ~1.02 two-minute samples, so identical geometry scored anywhere between 0.51 and 1.00 depending on
 * where the samples happened to land.
 *
 * PARALLAX INVARIANCE — why ONE track serves every cell in the disc: the dominant per-cell term is not
 * lunar parallax (0.27″ over a 500 m baseline) but the rotation of the LOCAL VERTICAL, 500/6_371_000
 * rad = 16.2″ = 1.7 % of ρ. Both are far below ρ ≈ 949″. The per-cell work is PURE OCCLUSION.
 */
export interface TrackSample {
  /** Scene time at this azimuth (epoch ms). */
  utcMs: number;
  /** Topocentric azimuth, deg [0,360), N=0 E=90 — matches `lib/ephemeris/bodies.AzAlt`. */
  azDeg: number;
  /** APPARENT topocentric altitude of the body's CENTRE (deg) — refraction folded in (pin 1). */
  altAppDeg: number;
  /** Topocentric angular RADIUS of the disc at this instant (deg). Sun 0.262–0.271, moon 0.245–0.279. */
  rhoDeg: number;
  /**
   * Integration weight, already normalised across the track. Two factors:
   * `|dt/daz|` (so an azimuth-indexed sum still integrates over TIME) times
   * `exp(-max(0, altAppDeg) / 2.5°)` (the last ~2° of the descent is what the photograph is about).
   */
  w: number;
}

/** The whole per-disc precompute. Cell-independent — computed once, reused by every cell. */
export interface EventTrack {
  kind: BestSpotKind;
  /** The REFRACTED event instant at the disc centre (epoch ms) — the almanac's own time. */
  t0Ms: number;
  /** Azimuth-ordered samples spanning the window plus the notch shoulders. */
  samples: readonly TrackSample[];
  /**
   * FIRST sample index of the WINDOW (inclusive) — everything before it is a notch shoulder (pin 6).
   *
   * The shoulders are swept because §3.4 measures `F_notch`'s sL/sR over `[az*−3°, az*+3°]` and `az*`
   * can sit anywhere in the window, and because `C` is defined over the FULL span. They are NOT part
   * of `V`: the bottom shoulder of a Dnipro sunset reaches −3.51° apparent, where no ground cell on
   * earth can see any part of the disc. A consumer that integrates visibility over `samples` without
   * consulting these two indices is re-opening the LENS B defect.
   */
  windowLo: number;
  /** LAST sample index of the WINDOW (inclusive). See `windowLo`. */
  windowHi: number;
  /** Azimuth at `t0Ms` (deg) — the contact bearing the shoulders are measured around. */
  setAzDeg: number;
  /**
   * Per-scene worth of THIS event, 0..1 — `moonPhaseIntensity(phaseAngle) · twilightGate(sunAlt)`.
   * Exactly 1 for sun kinds. A scene SCALAR, never a per-cell term: a 9 %-lit quarter moon rising in
   * daylight is not a good spot however clean the horizon, and without it the feature would list 353
   * mostly-worthless moonrises a year with equal confidence.
   */
  worth: number;
  /**
   * SPEC_V2 §5.3(b) — the two ephemeris readings `worth` is a pure function of, carried on the track
   * so the whole `worth.*` scoring group is a RECOMPOSE (0.272 ms) instead of a REBUILD (490 ms).
   * Optional because a hand-written test fixture does not have to supply them; `worthFromParts`
   * (`bestSpotTrack.ts`) is the one consumer and it is only reachable when they are present.
   *
   * Sun altitude (AIRLESS, deg) at `t0Ms` — the input to the twilight gate.
   */
  sunAltAtT0Deg?: number;
  /** Moon phase angle (deg, 0 = full) at `t0Ms`. `0` for sun kinds, which never consult it. */
  moonPhaseAngleDeg?: number;
}

// ---------------------------------------------------------------------------------------------
// Per-cell ray evidence — what the SWEEP produces and the METRIC consumes
// ---------------------------------------------------------------------------------------------

/** What kind of thing set the horizon at an azimuth. Exact and free — vastly better than inferring
 *  "man-made" from a threshold on a height difference decided by ~145 m-posted terrain. */
export type OccluderSrc = "none" | "terrain" | "building" | "tree" | "deck";

/**
 * Everything one cell knows along ONE swept azimuth.
 *
 * Produced by `horizonSweep`, consumed by `bestSpotMetric`. Flattened into parallel typed arrays by
 * the solver (this interface is the readable shape; the hot loop never allocates one).
 */
export interface RayEvidence {
  /** The swept azimuth (deg). */
  azDeg: number;
  /**
   * SIGNED apparent elevation of the GROUND horizon — terrain, plus solids resting on the ground,
   * plus tree canopies. Negative where the cell looks DOWN onto its horizon (pin 3).
   */
  groundAltAppDeg: number;
  /** What set `groundAltAppDeg` — the GROUND channel's OWN tag (pin 5). Read this, never `src`, when
   *  asking "is the thing AT `groundAltAppDeg` man-made": `src` may name a nearer floating band. */
  groundSrc: OccluderSrc;
  /** Horizontal distance (m) to the geometry that set `groundAltAppDeg`. `Infinity` when nothing was
   *  found forward along the ray (which is also `known = 0`). */
  groundDistM: number;
  /**
   * Angular extents of FLOATING solids crossing this ray, ascending, non-overlapping, apparent deg
   * (pin 2). Usually empty — floating solids are rare (tens per disc).
   */
  bands: readonly (readonly [number, number])[];
  /** Setter tag of each band, PARALLEL to `bands` (pin 5). A deck reports `"deck"` here even though
   *  the ground horizon under it is water — and that tag is the only thing that lets `F_sil` fire on
   *  the owner's hero geometry. */
  bandSrc: readonly OccluderSrc[];
  /** Near-edge distance (m) of each band, PARALLEL to `bands` (pin 5). `F_sil` weights a tangency by
   *  the depth of THE EDGE IT IS TANGENT TO — for a deck that is the deck, not whatever far bank the
   *  ground horizon happens to be resting on. */
  bandDistM: readonly number[];
  /**
   * Distance (m) to the ray's HEADLINE occluder — §3.2's "the geometry that set `Hg(a)`, OR the
   * nearest band edge", i.e. whichever of the ground setter and the nearest band is CLOSER. THE field
   * that separates "sets behind a bridge 1.5 km away" from "behind a fence 4 m away".
   *
   * NEAREST, not "the ground unless the ground is missing" (pin 5): the owner's deck sits 1.5 km out
   * over water whose ground horizon is the far bank BEYOND it, so binding this field to the ground
   * setter alone made `depthTerm` weight the deck's silhouette by the bank's distance. The per-channel
   * distances stay available as `groundDistM` / `bandDistM`; this one is the ray's summary.
   */
  blockerDistM: number;
  /** Setter tag of the HEADLINE occluder — what `CellScore.srcStar` publishes and what the panel's
   *  "BEHIND A BRIDGE" / "OPEN HORIZON" row copy reads. Same nearest rule as `blockerDistM`; use
   *  `groundSrc` / `bandSrc` whenever the question is about ONE channel. */
  src: OccluderSrc;
  /** Evidence flag — 0 means NOTHING was sampled along this ray (pin 4). */
  known: 0 | 1;
  /**
   * **HOW FAR THIS RAY ACTUALLY LOOKED (m) — pin 7, S3c.** The along-ray distance of the LAST KNOWN
   * sample forward of the cell; `0` when nothing forward was sampled.
   *
   * REQUIRED, not optional, and that is deliberate: a fixture that does not say how far it looked is
   * exactly the defect this field exists to close. See pin 7 below.
   */
  reachM: number;
  /** The hull found nothing and the far profile is terrain-only: a genuinely open horizon. An explicit
   *  boolean, never the fragile float test `alt === openSkyAltDeg`.
   *
   *  **GATED ON `reachM` SINCE S3c** (`reachM >= min(trustRadiusM, gridReachM)`): before that it
   *  never asked how far the evidence reached, and a truncated disc claimed open sky on every ray. */
  openSky: boolean;
}

// ---------------------------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------------------------

/** Landcover class of a cell, from the OpenFreeMap z14 MVT already streamed by `scene/vectorTiles`.
 *  Paint order is `green → landuse → water → road → path → deck → building` (building LAST). */
export type LandClass =
  | "unknown"
  | "water"
  | "wetland"
  | "building"
  | "deck" // bridge deck / pier / pedestrian plaza — STANDABLE, and it overrides water
  | "path" // footway / pedestrian / steps / cycleway
  | "road"
  | "majorRoad"
  | "green"
  | "pitch"
  | "blocked"; // military / industrial / railway / quarry / landfill / construction / access=no

/** The accessibility verdict for one cell at one sheet height. */
export interface CellAccess {
  /** Hard gate — 0 kills the cell at any framing score. */
  hard: 0 | 1;
  /** Soft preference, 0.1..1. Enters the score as `soft^0.5` so landcover cannot dominate. */
  soft: number;
  /** The class that decided it (for the legend + the uncertainty ribbon). */
  cls: LandClass;
  /**
   * Owner ruling R1: above `AERIAL_MIN_M` the cell is judged by DRONE rules, so water and roofs stop
   * masking. The owner's stated preference was "a place I can climb to", so the GROUND verdict is
   * carried alongside as a secondary readout rather than being discarded.
   */
  groundReachable: boolean;
}

/** Sheet height (m above local ground) at or above which DRONE rules replace ground rules — owner
 *  ruling R1, 2026-08-24. Below it, water and buildings are hard exclusions; at or above it only the
 *  INTERIORS of solids are (`render_min_height ≤ h < render_height`). */
export const AERIAL_MIN_M = 5;

// ---------------------------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------------------------

/** A cell either has enough evidence to be scored, or it does not. There is no third state and
 *  UNKNOWN is NEVER rendered as a low score — a cold colour reads as "bad spot", which is a claim
 *  about geometry nobody has looked at. */
export type CellVerdict = "scored" | "unknown";

/**
 * τ — GRAZE's dwell integral (`SPEC_V2 §1.1 ③`), **split by the provenance of the edge that earned
 * each contribution** (S3b, owner ruling R5).
 *
 * Each bucket carries `Σ cut·Relief(e)·Depth(D)·Δα/ρ` — relief- and depth-weighted, with the
 * per-source CONFIDENCE deliberately left OUT. That is the whole reason the split exists: `τ` is
 * recovered as `Σ_s conf[s]·bucket[s]`, so moving `graze.conf.*` or `graze.scaleRadii` is a
 * **recompose** (0.272 ms) rather than a rescore (177 ms) — and S3c's 59-byte-per-cell term buffer
 * stores exactly these four f32s.
 *
 * `none` has no bucket: `conf.none` is 0 and an untagged edge is ignorance, not a silhouette.
 */
export interface GrazeTauSplit {
  terrain: number;
  building: number;
  deck: number;
  tree: number;
}

/** One cell's full result. The panel reads `score` + `terms`; the GL sheet reads `score` + `verdict`. */
export interface CellScore {
  verdict: CellVerdict;
  /** Composite 0..1. Absolute, not normalised against the disc — an all-bad disc must look all-bad. */
  score: number;
  /** Time-integrated visible disc fraction, 0..1. */
  v: number;
  /** Contact lowness, 0..1 — 1 when the body stays visible to this cell's own horizon floor. */
  l: number;
  /** Depth/openness of the blocker, 0..1 — log-scaled in distance. */
  p: number;
  /** Framing, 0..1 — `max(GRAZE, GAP)` (`SPEC_V2 §1.1`, owner ruling R5). */
  f: number;
  /** The GRAZE half of `f`: `1 − exp(−τ/graze.scaleRadii)` — how LONG the body rides an edge. */
  fGraze: number;
  /** The GAP half of `f`: `notchAt(...).f · min(Q(shoulderL), Q(shoulderR))`. */
  fGap: number;
  /** τ itself, in disc RADII of the body's own vertical travel, with confidence applied. */
  grazeRadii: number;
  /** τ before confidence, split by provenance — see `GrazeTauSplit`. */
  grazeTau: GrazeTauSplit;
  /** Provenance of the edge that contributed the MOST τ — the panel's "BEHIND A BRIDGE" copy reads
   *  `srcStar` (the contact) and this (the frame); they are different questions and can disagree. */
  grazeSrc: OccluderSrc;
  /** …and that edge's own distance (m). */
  grazeDistM: number;
  /**
   * `max over the summed window of Δα_i/ρ_i` — how coarsely the dwell integral was sampled.
   *
   * Above `GRAZE_STEP_TRUST_RADII` (2 — one disc DIAMETER, the width of a cut event) the body can
   * step over an entire cut between two samples, so τ is not resolvable and the framing term is
   * **UNKNOWN**: a render class, never a low score and never a saturated high one. At Quito's
   * equinox the sun sets vertically, the azimuth reparameterisation collapses to 8 samples spanning
   * 88° of altitude, and this reads **109** — which is exactly the reading the flag exists to make
   * visible. The honesty channel for FRAMING, mirroring `c` for the sweep.
   */
  grazeStepRadii: number;
  /** Per-cell evidence coverage over the FULL swept span, 0..1. */
  c: number;
  /**
   * **The HONESTY RANGE (pin 7, S3c): the SMALLEST `RayEvidence.reachM` over the whole swept span**
   * — how far the evidence reached in this cell's WORST direction (m).
   *
   * `c` says WHETHER we looked; this says HOW FAR. A cell can report `c = 1.000` on a disc whose
   * DSM stops 350 m out, and did (measured `S = 0.6633` against a truth of `0.0000`, SPEC_V2 §3.1).
   * `min` and not `mean` for the same reason `notchAt` takes `min(sL, sR)`: one blind direction is
   * enough to invalidate the answer, and the sun only sets in one of them.
   *
   * Published on the UNKNOWN branch too — "we looked 40 m" is exactly what the panel must say about
   * a cell it is refusing to score.
   */
  minReachM: number;
  /** Lowest apparent centre altitude at which the disc is still ≥50 % visible (deg). Signed. */
  altStarDeg: number;
  /** Distance (m) to the blocker at the contact azimuth — what "far in the distance" actually means. */
  dStarM: number;
  /** What set the contact blocker — drives the "BEHIND A BRIDGE" / "OPEN HORIZON" row copy. */
  srcStar: OccluderSrc;
  /** Accessibility as applied. */
  access: CellAccess;
}

/** Weights for the preference half of the composite. Gates (`A_hard`, `M`, `G(V)`) are NOT here —
 *  they multiply, and making them tunable would let a slider paper over standing in a river. */
export interface BestSpotWeights {
  /** Time-integrated visibility. Small: `V` already enters as the gate `G(V)`. */
  v: number;
  /** Contact lowness — "LOW on the horizon, or touching it". */
  l: number;
  /** Depth — "visible relatively FAR in the distance". */
  p: number;
  /** Framing — the bridge silhouette and the between-buildings notch. */
  f: number;
}

/** The shipped blend. `l + p + f = 0.85` against `v = 0.15` because `V` is mostly consumed by the
 *  gate; the three preferences are what actually rank one standable cell against another. */
export const BESTSPOT_WEIGHTS: BestSpotWeights = { v: 0.15, l: 0.3, p: 0.25, f: 0.3 };
