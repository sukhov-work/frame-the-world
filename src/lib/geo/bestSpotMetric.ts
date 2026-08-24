/**
 * BEST SPOT — the pure scoring kernel (`.claude/claude-docs/BESTSPOT_PLAN.md` §3, slice S1a).
 *
 * Consumes per-cell `RayEvidence[]` (what the sweep saw along each swept azimuth) plus the
 * per-disc `EventTrack` (where the body actually is, APPARENT), and returns one `CellScore`.
 * Zero ephemeris, zero three, zero store, zero DOM, zero `Date.now()` — every instant that
 * matters already lives inside the track as an explicit epoch-ms sample. The module imports
 * cleanly inside a Web Worker, which is where §5 runs it (6.79 M cell-azimuth queries per disc).
 *
 * ---------------------------------------------------------------------------------------------
 * THE FIVE SHIPPED-BUG CLASSES THIS FILE IS SHAPED AROUND (so the next audit reads them as
 * intentional rather than as accidents). Each has a named test in `test/lib/geo/bestSpotMetric.test.ts`.
 *
 *  1. **APPARENT vs AIRLESS (F2).** Nothing in here refracts anything. Every altitude it touches —
 *     `TrackSample.altAppDeg`, `RayEvidence.groundAltAppDeg`, every band edge — is an APPARENT
 *     angle, and the kernel simply believes that. The conversion happens ONCE, at the track, in the
 *     caller (`altApp = altAirless + Refraction("normal", altAirless)`). Feeding this kernel an
 *     AIRLESS track is a 0.5–0.62° systematic under-report right where the whole feature lives —
 *     ~2.4 solar radii — and it is silent: every number still looks plausible, the map just reads
 *     uniformly mediocre. The unit test pins the collapse so a future refactor cannot restore it.
 *
 *  2. **A MAX IS NOT A SILHOUETTE (F3).** `blocked(el)` is `el <= Hg` OR `el` inside a floating
 *     `band` — two separate channels, never merged into one per-bin max. Merging them makes "the
 *     sun setting behind the bridge" and "a blank 15-storey wall" the same object, and the wall
 *     then OUTSCORES an open river horizon. The owner's hero location is a bridge deck.
 *
 *  3. **COLUMNS, NOT A CHORD (§3.3).** `discVisibleFraction` integrates the disc over its own
 *     AZIMUTH COLUMNS against per-column evidence. The closed form `(acos u − u√(1−u²))/π` is a
 *     HORIZONTAL-chord segment read from ONE centre sample; every occluder in both hero cases cuts
 *     VERTICALLY (a tower flank, the two buildings making the gap), so the chord form flips f from
 *     0 to 1 across a single bin on a tower flank. The column form degrades gracefully instead, and
 *     its honest limit — a vertical edge resolves to about half a disc at the shipped 0.25° step —
 *     is a number the UI can print.
 *
 *  4. **IGNORANCE IS NOT CLEAR SKY (§3.4).** `known = 0` samples are dropped from BOTH sums of `V`
 *     — never scored as `f = 1`, and never scored as `f = 0` either. Coverage `C` is a separate
 *     channel measured over the FULL swept span, and below the floor the cell returns
 *     `verdict: "unknown"` — a render class, NOT a low score. A cold colour is a claim about
 *     geometry nobody has looked at.
 *
 *  5. **THE DIP IS THE FLOOR, AND IT MOVES WITH THE LIFT (§3.4 L).** `contactLowness` anchors its
 *     smoothstep at `horizonDipDeg(eyeM + liftM, k)`, not at 0. A fixed 0 anchor throws away the
 *     entire `[dip, 0]` band — which at a 400 m sheet is 0.6° wide and at 2000 m is 1.34° wide —
 *     so every lifted cell that sees down to its own horizon reads an identical, saturated L = 1
 *     and the altitude slider stops ranking anything.
 *
 *  6. **`V` IS THE WINDOW'S INTEGRAL, NOT THE WHOLE SWEEP'S (LENS B, 2026-08-24).** The track spans
 *     the window PLUS azimuth shoulders that exist only for `F_notch`'s sL/sR and for `C`, and it runs
 *     below the horizon so a LIFTED sheet or a cell on a bluff has something to be scored against
 *     (§3.1). Integrating `V` over all of it charged every pedestrian cell for samples where `f = 0`
 *     is guaranteed by the curvature of the earth: measured 46.9 % of the normalised weight below a
 *     1.7 m eye's own dip, `V = 0.5138` over a PERFECT open horizon against §10 S1's ≥ 0.95
 *     done-check, `G(V) = 0.657`, `S = 0.41` — on a ramp §6 calls indistinguishable from the map below
 *     ~50 %. So `V`'s two sums run over `[windowLo, windowHi]`, and the BELOW-HORIZON half of the same
 *     defect is fixed where it belongs, in the track's own weight (`bestSpotTrack`'s horizon ceiling).
 *
 *     **AND NOT BY A PER-CELL `altApp ≥ dipFloor` FILTER, WHICH WAS TRIED AND MEASURED (read this
 *     before re-adding it).** That filter reaches `V = 0.9537` on the real track — and it silently
 *     DISABLES pin 1. `V` is a RATIO, so a domain defined by the track's own reported altitudes moves
 *     with them: feeding the kernel an AIRLESS track (a uniform ~0.6° downward lie, the F2 blocker)
 *     then reads `V = 0.9662` against the apparent track's `0.9667` — measured, both fixtures, same
 *     geometry. §10 S1's first done-check would have become a check that cannot fail, which is the
 *     precise failure mode this repo has been bitten by six times. The window marker is domain-fixed
 *     and the weight ceiling is anchored at the OBSERVER's dip, so neither moves with the lie.
 *
 *  7. **A PROVENANCE GATE IS NOT A FRAMING TERM (owner ruling R5, S3b 2026-08-24).** `F_sil` gated
 *     the whole term on `isBuiltSrc` and then SATURATED on whatever survived the gate. Measured: a
 *     grazing 8 km mountain ridge scored **0.0000** — below a blank wall and below empty sea — while
 *     a bridge deck and a blank wall both scored **0.846**, to the last bit, so `F ≈ P` for every
 *     built cell in a city (corr 0.9985, r² 0.997) and the 0.30-weighted framing term carried almost
 *     no ranking signal. The owner's actual interest is *"sun visibility over a LARGE RANGE OF
 *     LANDSCAPES, OBJECTS, BUILDINGS"*. GRAZE replaces it with `cut × Q × dwell` — how LONG the body
 *     rides an edge, weighted by whether that edge is worth photographing — and provenance survives
 *     only as `Conf`, a soft weight. Re-measured on the same 66-cell fixture: corr **0.6268**,
 *     r² 0.393; ratio spread 0.0619 → 0.5401.
 *
 *     THE TWO FAILURE MODES TO WATCH FOR IF THIS IS EVER TOUCHED AGAIN: a term that CANNOT fire (the
 *     gate) and a term that ALWAYS fires (the saturation). They are indistinguishable from inside the
 *     composition — both just move `S` by a constant — and only a SPREAD measurement across a fixture
 *     of many geometries tells them apart. That is what `bestSpotGolden.test.ts` is.
 * ---------------------------------------------------------------------------------------------
 *
 * HONESTY CONTRACT. This kernel scores EVIDENCE, not reality. It cannot know about fences, gates,
 * locked courtyards, water level, retaining walls or whether the "grass" is a swamp (§4). It
 * reports `c` (coverage) and `verdict` so the surface above it can say so out loud.
 *
 * Angle convention matches `lib/ephemeris/bodies.AzAlt` and `horizonProfile`: azimuth deg [0,360),
 * N = 0, E = 90; elevations in degrees, SIGNED, apparent.
 */

import { horizonDipDeg } from "./horizonProfile";
import {
  BESTSPOT_SCORING_V1,
  type BestSpotScoring,
  type BestSpotTermKey,
} from "./bestSpotScoring";
import {
  type CellAccess,
  type CellScore,
  type EventTrack,
  type GrazeTauSplit,
  type OccluderSrc,
  type RayEvidence,
} from "./bestSpotTypes";

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Named constants — every one of these is a number the spec fixed, with the reason it is that
// number.
//
// **THEY ARE NO LONGER WHAT THE KERNEL READS (S3a, 2026-08-24).** Every one of them now has a twin
// in `bestSpotScoring.BESTSPOT_SCORING_V1`, and the kernel reads the PROFILE — which rides the job,
// so a taste pass can move it without a rebuild and the worker can never latch a stale copy. They
// stay exported because they are still the documented SHIPPED values and `bestSpotScoring.test.ts`
// pins the profile against them: a drift in either direction is a red test, not a silent fork.
//
// They are still deliberately NOT in `components/globe/tuning.ts` — §10 S1 is a pure-lib slice and
// the whole kernel must be reproducible from a test fixture; `tuning.ts` only RE-EXPORTS the
// profile for discoverability (the `WGS84_A/B` precedent).
// ---------------------------------------------------------------------------------------------

/** `G(V) = smoothstep(0.15, 0.75, V)` — the visibility GATE (§3.5). Soft, not a step, because the
 *  FRAMING hero case INTENTIONALLY occults the disc for part of the track: a hard `V = 1` test
 *  would delete every silhouette shot the feature exists to find. */
export const V_GATE_LO = 0.15;
export const V_GATE_HI = 0.75;

/** Upper edge of the CONTACT-LOWNESS ramp (deg). Above ~5° the body is simply "up", and the
 *  photograph the owner described stops being about the horizon at all. */
export const L_CEIL_DEG = 5;

/** `P` reference distance (m) — the log's lower anchor. Below ~30 m a blocker is a fence, not a
 *  skyline: `P` is log-scaled because apparent size AND the alignment gradient both go as 1/D. */
export const DEPTH_NEAR_REF_M = 30;

/** The disc must clear its own floor by at least ONE disc radius before a gap counts as a notch —
 *  otherwise every skyline the body merely grazes reads as "framed between buildings". */
export const NOTCH_CLEARANCE_RADII = 1;

/** HeyWhatsThat's "a few arcminutes" salience floor (deg). Below this a dip in the skyline is mesh
 *  noise from ~145 m-posted terrain (§8) and the map speckles with fake notches. */
export const NOTCH_SALIENCE_DEG = 0.1;

/** Shoulder height (deg) at which the notch term saturates — a 3°-deep gap is already dramatic. */
export const NOTCH_MAX_DEPTH_DEG = 3;

/** Gap width (deg) at which the notch term dies — wider than 2° and it is not a gap, it is sky. */
export const NOTCH_MAX_WIDTH_DEG = 2;

/** Half-span the shoulders are measured over (deg), `[az*−3°, az*−ρ]` and `[az*+ρ, az*+3°]`. */
export const NOTCH_SHOULDER_DEG = 3;

/** `f >= 0.5` is the "the disc is still there" threshold that defines `az*` / `alt*` (§3.4). */
export const HALF_DISC = 0.5;

/**
 * Largest per-sample altitude step, in disc RADII, at which GRAZE's dwell integral is still
 * TRUSTWORTHY (`CellScore.grazeStepRadii`). Above it the framing term is UNDER-RESOLVED and must be
 * reported as **UNKNOWN** — a render class, never a low score, and never a saturated high one.
 *
 * TWO disc radii = one disc DIAMETER, because that is the width of a cut event: the body is being
 * cut from the moment its lower limb reaches an edge until its upper limb clears it. A step wider
 * than that can step over an entire cut, or land on one sample of it and charge the whole width.
 *
 * MEASURED on the shipped 0.25° azimuth lattice (S3b, real `eventTrack`, four dates each):
 *  · Dnipro **1.19–1.25** — resolved with room to spare;
 *  · Tromsø **0.47–0.53** — a shallow polar-ish sunset oversamples altitude for free;
 *  · Sydney **2.07–2.09** — a steep mid-latitude sunset sits right ON the edge, and τ there still
 *    agrees with the 0.05° lattice to within 10 % (pinned in `bestSpotGolden.test.ts`);
 *  · Quito, equinox — **109**: the sun sets vertically, the azimuth reparameterisation collapses to
 *    8 samples spanning 88° of altitude, and τ saturates `F_graze` to 1 on nothing at all. THIS is
 *    the case the flag exists for.
 */
export const GRAZE_STEP_TRUST_RADII = 2;

// ---------------------------------------------------------------------------------------------
// Small pure helpers — exported because the tests pin their ENDPOINTS, and because the solver's
// fused loop (§5) re-implements the same arithmetic inline and must be diffable against these.
// ---------------------------------------------------------------------------------------------

/** NaN-safe clamp to [0,1]: `NaN > 0` is false, so garbage collapses to 0 rather than propagating
 *  into a Float32Array the GL sheet samples. */
export function clamp01(x: number): number {
  return x > 0 ? (x < 1 ? x : 1) : 0;
}

/** Hermite smoothstep with clamped edges. `edge1 <= edge0` degenerates to a hard step at `edge1`
 *  instead of dividing by zero — a lift high enough to push the dip past the ceiling must not
 *  produce NaN ink. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (!(edge1 > edge0)) return x < edge1 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Signed shortest azimuth difference `a − b` in (−180, 180]. */
export function wrapDeltaDeg(aDeg: number, bDeg: number): number {
  return ((((aDeg - bDeg + 180) % 360) + 360) % 360) - 180;
}

/**
 * Is this setter MAN-MADE?
 *
 * **NO LONGER A GATE ON ANYTHING SCORED (owner ruling R5, S3b).** `F_sil` used to early-return on
 * `!isBuiltSrc(...)`, and that gate is what scored a grazing 8 km mountain ridge at 0.0000 — below a
 * blank wall and below empty sea. GRAZE replaced it: provenance is now the soft weight
 * `graze.conf[src]` (terrain 1.00 · building 0.90 · deck 0.90 · tree 0.45), and RELIEF above the
 * observer's own dip is what decides whether an edge is a frame at all.
 *
 * It stays exported because it is still the right predicate for the SURFACE: the panel's row copy
 * says "BEHIND A BRIDGE" for a built setter and "OPEN HORIZON" / "BEHIND THE RIDGE" otherwise, and
 * that is a question about what the thing IS, not about how much it is worth.
 *
 * WHY A TAG AND NOT A THRESHOLD: the pre-correction design inferred "man-made" from
 * `H > terrainBaseline + 0.1°`, i.e. a threshold on a HEIGHT difference of `1.745e-3·D` metres —
 * 2.6 m at 1.5 km — decided by the least reliable channel in the whole pipeline (~145 m-posted
 * terrain; the Dnipro river tile decodes to 29 vertices). The tag is exact and free.
 */
export function isBuiltSrc(src: OccluderSrc): boolean {
  return src === "building" || src === "deck";
}

/**
 * `P` for ONE distance — `clamp01(ln(D/30) / ln(trustRadiusM/30))`, log-scaled because apparent size
 * AND the alignment gradient both go as `1/D`.
 *
 * Split out of `depthTerm` by LENS B so a tangency can be weighted by the depth of THE EDGE IT IS
 * TANGENT TO. A deck and the far bank behind it are two different distances on one ray, and reading
 * the ray's single summary for both is how the bridge came to be weighted by the bank.
 */
export function depthOfDistM(
  distM: number,
  trustRadiusM: number,
  nearRefM: number = DEPTH_NEAR_REF_M,
): number {
  return depthWithCeil(distM, nearRefM, depthLogCeil(trustRadiusM, nearRefM));
}

/** The log CEILING of `depthOfDistM` — constant for a whole cell, and it was being recomputed on
 *  every single edge of every sample (18.3 ns of the 418 ns/cell-azimuth path). Split out so the
 *  callers that run it in a loop can hoist it; `depthOfDistM` keeps the one-shot form for the tests
 *  and the panel, which call it a handful of times. */
function depthLogCeil(trustRadiusM: number, nearRefM: number): number {
  return Math.log(Math.max(trustRadiusM, nearRefM * Math.E) / nearRefM);
}

function depthWithCeil(distM: number, nearRefM: number, ceil: number): number {
  return clamp01(Math.log(Math.max(distM, 1e-6) / nearRefM) / ceil);
}

/**
 * `P` — DEPTH / OPENNESS of the thing the body sets behind (§3.4).
 *
 * `openSky ? 1 : depthOfDistM(blockerDistM, trust)`. This is THE term that separates "sets behind a
 * far bridge" from "sets behind the fence 4 m away", and it only exists because `RayEvidence` carries
 * `blockerDistM` at all — today's shipped `HorizonProfile` computes the winning distance in
 * `marchTerrainBin` and throws it away.
 *
 * It reads the ray's HEADLINE distance (the nearest of the ground setter and the bands, `RayEvidence`
 * pin 5), which is what "how deep is this view" means for a whole ray.
 */
export function depthTerm(
  ev: RayEvidence,
  trustRadiusM: number,
  nearRefM: number = DEPTH_NEAR_REF_M,
): number {
  if (ev.openSky) return 1;
  return depthOfDistM(ev.blockerDistM, trustRadiusM, nearRefM);
}

/**
 * `L` — CONTACT LOWNESS (§3.4). `1 − smoothstep(dipFloor, +5°, alt*)`.
 *
 * `dipFloor = horizonDipDeg(eyeM + liftM, k)` — the eye's OWN geometric horizon, which is where a
 * perfect open view actually bottoms out: −0.039° at 1.7 m, −0.299° at 100 m, −0.599° at 400 m,
 * −1.339° at 2000 m. Anchoring at a fixed 0 discards that whole band, so every lifted cell that
 * sees down to its own horizon reports an identical saturated `L = 1` and the altitude slider
 * stops discriminating between cells (bug class 5 in the header).
 */
export function contactLowness(
  altStarDeg: number,
  dipFloorDeg: number,
  ceilDeg: number = L_CEIL_DEG,
): number {
  return 1 - smoothstep(dipFloorDeg, ceilDeg, altStarDeg);
}

/** `G(V)` — the SOFT visibility gate (§3.5). Multiplies, but must never be a hard step.
 *
 *  The edges come from the profile so a taste pass can move them (`gates.vGateLo`/`vGateHi`);
 *  `resolveScoring` keeps `vGateHi >= vGateLo + 0.05` because `smoothstep` degenerates to a hard
 *  step WITHOUT throwing, and a hard `V` gate would delete every silhouette shot. */
export function visibilityGate(
  v: number,
  gates: BestSpotScoring["gates"] = BESTSPOT_SCORING_V1.gates,
): number {
  return smoothstep(gates.vGateLo, gates.vGateHi, v);
}

// ---------------------------------------------------------------------------------------------
// §3.3 — the visibility atom
// ---------------------------------------------------------------------------------------------

/** Is a single elevation blocked on this ray? `el <= Hg` OR inside any floating band (§3.3). */
export function isBlockedAt(ev: RayEvidence, elDeg: number): boolean {
  if (elDeg <= ev.groundAltAppDeg) return true;
  for (let k = 0; k < ev.bands.length; k++) {
    const b = ev.bands[k];
    if (elDeg >= b[0] && elDeg <= b[1]) return true;
  }
  return false;
}

/**
 * Angular measure (deg) of `[loDeg, hiDeg]` that is NOT blocked on this ray.
 *
 * The ground horizon and the floating bands are two SEPARATE channels (bug class 2): the ground
 * clips the interval from below, then the band list subtracts slabs out of the middle. That is the
 * entire reason a bridge deck can be scored as a deck — there is sky under it, and a per-bin max
 * cannot express that.
 *
 * CONTRACT: `bands` are ascending by `lo` (`bestSpotTypes.RayEvidence`). The merge below is
 * tolerant of OVERLAP (two decks at the same azimuth), but NOT of unsorted input — an unsorted
 * band list would over-count open sky, which is the one direction this feature must never err in.
 */
export function unblockedSpanDeg(ev: RayEvidence, loDeg: number, hiDeg: number): number {
  let cursor = loDeg > ev.groundAltAppDeg ? loDeg : ev.groundAltAppDeg;
  if (cursor >= hiDeg) return 0;
  let open = 0;
  const bands = ev.bands;
  for (let k = 0; k < bands.length; k++) {
    const bLo = bands[k][0];
    const bHi = bands[k][1];
    if (bHi <= cursor) continue; // entirely below the cursor (or already swallowed by the ground)
    if (bLo >= hiDeg) break; // ascending ⇒ nothing after this can overlap either
    if (bLo > cursor) open += bLo - cursor;
    if (bHi > cursor) cursor = bHi;
    if (cursor >= hiDeg) return open;
  }
  return open + (hiDeg - cursor);
}

/**
 * Resolves the `RayEvidence` a disc COLUMN falls on. `null` means "the sweep has nothing at that
 * azimuth" and the caller falls back to the centre ray — see `discVisibleFraction`.
 */
export type ColumnRayAt = (azDeg: number) => RayEvidence | null;

/**
 * `f(a)` — the visible AREA fraction of the body's disc centred at `(ev.azDeg, altAppDeg)` (§3.3).
 *
 * THE DISC IS INTEGRATED OVER ITS OWN AZIMUTH COLUMNS, and each column is scored against the ray
 * evidence AT THAT COLUMN'S AZIMUTH — not against the centre ray. This is bug class 3 in the
 * header, and it is the difference between a metric that can see a tower flank and one that
 * cannot: the closed form `(acos u − u√(1−u²))/π` is a HORIZONTAL chord read from one sample, so a
 * vertical edge makes it jump 0 → 1 in a single azimuth bin.
 *
 * @param ev            the CENTRE ray (also the fallback for columns with no evidence)
 * @param altAppDeg     APPARENT altitude of the disc CENTRE (deg)
 * @param rhoDeg        angular RADIUS of the disc (deg): sun 0.262–0.271, moon 0.245–0.279
 * @param columns       quadrature columns across the disc. This is the DISC's own quadrature and
 *                      is independent of the evidence resolution — more columns buy a smoother
 *                      area integral, never more knowledge. The honest limit stays the sweep's
 *                      azimuth step: at 0.25° a 2ρ = 0.527° solar disc spans ~2.1 columns of
 *                      EVIDENCE, i.e. "a vertical edge is resolved to about half a disc".
 * @param columnRayAt   per-column evidence lookup; omit (or return `null`) to score every column
 *                      against `ev`, which degenerates to the horizontal-chord answer.
 *
 * Column azimuth offsets carry the `1/cos(alt)` widening of a small circle on the sky. It is a
 * 0.06 % correction inside the 0–2° band this feature lives in, but it is free and it stops the
 * function from being quietly wrong if it is ever reused higher up.
 *
 * IGNORANCE IN A COLUMN: a column whose ray reports `known = 0` inherits the CENTRE ray rather
 * than being painted as open sky. The honesty channel for a genuinely unsampled azimuth is
 * `known` on the centre ray, which `cellScore` drops from BOTH sums of `V` (bug class 4).
 */
export function discVisibleFraction(
  ev: RayEvidence,
  altAppDeg: number,
  rhoDeg: number,
  columns: number,
  columnRayAt: ColumnRayAt | null = null,
): number {
  // A zero-radius body is a point, not a disc — degrade to the point test rather than to 0/0.
  if (!(rhoDeg > 0)) return isBlockedAt(ev, altAppDeg) ? 0 : 1;
  const n = columns >= 1 ? Math.floor(columns) : 1;
  // Small-circle widening: an azimuth step subtends less sky the higher you look.
  const cosAlt = Math.max(0.05, Math.cos(altAppDeg * DEG));
  const colWidth = (2 * rhoDeg) / n;
  let open = 0;
  let total = 0;
  for (let j = 0; j < n; j++) {
    // MIDPOINT rule: symmetric about the centre, so a purely horizontal cut through the centre
    // returns exactly 0.5 at ANY column count (the analytic half-disc, pinned in the tests).
    const dx = -rhoDeg + (j + 0.5) * colWidth;
    const dy = Math.sqrt(Math.max(0, rhoDeg * rhoDeg - dx * dx));
    if (!(dy > 0)) continue;
    total += 2 * dy;
    let colEv = ev;
    if (columnRayAt) {
      const found = columnRayAt(ev.azDeg + dx / cosAlt);
      if (found && found.known === 1) colEv = found;
    }
    open += unblockedSpanDeg(colEv, altAppDeg - dy, altAppDeg + dy);
  }
  return total > 0 ? clamp01(open / total) : 0;
}

// ---------------------------------------------------------------------------------------------
// §1.1 — GRAZE, the framing kernel (owner ruling R5; replaced `F_sil`'s provenance-gated tangency)
// ---------------------------------------------------------------------------------------------

/** Distance (deg) from an elevation to the NEAREST silhouette edge on this ray: the ground horizon
 *  itself, or either edge of any floating band. A deck has TWO edges and the body can be tangent
 *  to the underside — that is the "sun under the bridge" frame, and a ground-max profile has no
 *  way to name it.
 *
 *  UNGATED BY DESIGN: it answers "how far is the nearest edge", which is what the panel prints. It
 *  is also GRAZE's inner loop — `grazeSampleInto` runs the same walk with the same tie-breaking and
 *  keeps the winning edge's TAG and RANGE instead of discarding them, which is the one thing this
 *  signature cannot express. Kept exported and behaviourally identical: the panel and three pins
 *  read it. */
export function nearestEdgeDeltaDeg(ev: RayEvidence, elDeg: number): number {
  let best = Math.abs(elDeg - ev.groundAltAppDeg);
  for (let k = 0; k < ev.bands.length; k++) {
    const b = ev.bands[k];
    const dLo = Math.abs(elDeg - b[0]);
    if (dLo < best) best = dLo;
    const dHi = Math.abs(elDeg - b[1]);
    if (dHi < best) best = dHi;
  }
  return best;
}

/**
 * `GRAZE` — the generalized framing kernel, ONE swept sample (`SPEC_V2 §1.1 ①②`, owner ruling R5).
 *
 * ```
 * cut = max( 4·f·(1−f) ,  1 − clamp01(δ / (ρ·tangentHalfWidthRadii)) )
 *         ↑ AREA arm            ↑ TANGENT arm
 * Q   = Relief(e) · Conf(s) · Depth(D)      for the edge (e, s, D) NEAREST the body's centre
 * ```
 *
 * **WHY THIS REPLACED `silTangency` (owner ruling R5, 2026-08-24).** The shipped kernel gated every
 * edge on `isBuiltSrc`, so a grazing 8 km mountain ridge measured **0.0000** — ranked below a blank
 * wall and below empty sea — and the owner's actual interest is *"sun visibility over a LARGE RANGE
 * OF LANDSCAPES, OBJECTS, BUILDINGS"*. It also SATURATED on any built edge the body's centre crossed
 * (a bridge deck and a blank wall both measured 0.846, to the last bit), so `F ≈ P` for every built
 * cell in a city — r² 0.997 — and the 0.30-weighted framing term carried almost no ranking signal.
 * Provenance survives here ONLY as `Conf`, a soft weight.
 *
 * **THE TWO ARMS ARE NOT REDUNDANT.**
 *  · The AREA arm `4·f·(1−f)` is 1 when the disc is exactly HALF cut, 0 when it is fully clear OR
 *    fully hidden, and it is ORIENTATION-AGNOSTIC: it fires on a vertical tower flank (where no edge
 *    ever comes within ρ of the body's centre on the centre ray, so the tangent arm reads exactly 0)
 *    just as it fires on a diagonal roofline. It is also free — `f` is `discVisibleFraction`, which
 *    `cellScore` already computes for `V`, so the arm costs one multiply.
 *  · The TANGENT arm is the shipped triangular kernel, kept as a FLOOR so a THIN occluder is not
 *    lost: a 1.8 m deck slab at 1.5 km is 0.27 ρ and hides ~13 % of the disc's area, which the area
 *    arm alone nearly throws away.
 *
 * **Q IS PER EDGE, AND THE EDGE CARRIES ITS OWN TAG AND ITS OWN DISTANCE.** A deck and the far bank
 * behind it are two different distances on one ray; reading the ray's single summary for both is how
 * the bridge came to be weighted by the bank (LENS B). `Relief` is measured above the OBSERVER's own
 * dip, not above 0 — that is what makes an open sea horizon score exactly 0 for the right reason
 * (there is no edge standing above the horizon to ride) rather than for the old, wrong one
 * (`isBuiltSrc("terrain") === false`).
 *
 * @param dipFloorDeg   `horizonDipDeg(eyeM + liftM, k)` — the relief ramp's anchor.
 * @param discFrac      `f` at this sample. `cellScore` SHARES the value it already computed for `V`;
 *                      omit it and the kernel falls back to the centre ray's own
 *                      `discVisibleFraction`, which is the horizontal-chord answer (no column
 *                      lookup) and therefore blind to a vertical flank. Never recompute it in a hot
 *                      loop — `discVisibleFraction` is the single most expensive call in the path.
 */
export function grazeSample(
  ev: RayEvidence,
  altAppDeg: number,
  rhoDeg: number,
  dipFloorDeg: number,
  scoring: BestSpotScoring = BESTSPOT_SCORING_V1,
  discFrac?: number,
): GrazeSample {
  const f =
    discFrac ?? discVisibleFraction(ev, altAppDeg, rhoDeg, scoring.quadrature.discColumns);
  const work = newGrazeWork();
  grazeSampleInto(
    ev,
    altAppDeg,
    rhoDeg,
    dipFloorDeg,
    f,
    scoring.graze,
    depthByDistance(scoring.curves.depthTrustRadiusM, scoring.curves.depthNearRefM),
    work,
  );
  return { cut: work.cut, q: work.q, src: work.src, distM: work.distM };
}

/** What one swept sample contributes to GRAZE, before the dwell weight `Δα/ρ` is applied. */
export interface GrazeSample {
  /** `max(AREA arm, TANGENT arm)`, 0..1 — is the disc being cut here, and by how much. */
  cut: number;
  /** `Relief · Conf · Depth` of the edge nearest the body's centre, 0..1 — is the thing doing the
   *  cutting worth photographing. */
  q: number;
  /** Provenance of THAT edge. Not the ray's headline `src`, which may name a nearer band the body
   *  is nowhere near. */
  src: OccluderSrc;
  /** …and THAT edge's own distance (m). */
  distM: number;
}

/** The hot-loop shape: `GrazeSample` plus the confidence-free half of `Q`, which is what τ's four
 *  provenance buckets carry (`GrazeTauSplit`). Reused across every sample of a cell — the kernel
 *  runs 6.79 M times per disc and must not allocate.
 *
 *  Exported for `bestSpotSolver`'s FUSED PASS only: §7 S3c requires the fused loop to be written
 *  against these exported kernels rather than re-implementing them, so the two stay DIFFABLE and
 *  `cellScore` remains the reference the fused pass is measured against. */
export interface GrazeWork extends GrazeSample {
  /** `Relief · Depth` — `q` WITHOUT `Conf`, so `graze.conf.*` stays a RECOMPOSE. */
  qBase: number;
}

/** One reusable `GrazeWork` scratch. See `GrazeWork` for why this is exported. */
export function newGrazeWork(): GrazeWork {
  return { cut: 0, q: 0, qBase: 0, src: "none", distM: 0 };
}

/** Per-edge depth weight, hoisted: the log CEILING is a constant of the CELL, so it is computed once
 *  here rather than once per edge inside `depthOfDistM` (18.3 → 9.7 ns/call, ≈22 ms/solve).
 *
 *  Exported for the fused pass, which hoists it once per SOLVE rather than once per cell. */
export function depthByDistance(trustRadiusM: number, nearRefM: number): (distM: number) => number {
  const ceil = depthLogCeil(trustRadiusM, nearRefM);
  return (distM) => depthWithCeil(distM, nearRefM, ceil);
}

/**
 * `grazeSample`'s body, writing into a caller-owned scratch and taking the depth weight as a CLOSURE
 * so `cellScore` builds both ONCE per cell instead of once per swept sample.
 *
 * ONE walk over the ray's edges serves BOTH halves: the nearest edge's DISTANCE-IN-ANGLE is the
 * tangent arm's δ and that same edge's TAG and RANGE are `Q`'s. `nearestEdgeDeltaDeg` returns only
 * the angle and stays exported and behaviourally identical (the panel prints it); this is the same
 * walk with the same tie-breaking, carrying the winner rather than discarding it.
 *
 * The `Depth` log is evaluated ONLY when relief is non-zero — one `log` per cell-azimuth at most,
 * never one per edge and never one per disc column.
 *
 * Exported for `bestSpotSolver`'s fused pass (§7 S3c): ONE implementation of GRAZE, two callers.
 */
export function grazeSampleInto(
  ev: RayEvidence,
  altAppDeg: number,
  rhoDeg: number,
  dipFloorDeg: number,
  discFrac: number,
  cfg: BestSpotScoring["graze"],
  depthFor: (distM: number) => number,
  out: GrazeWork,
): GrazeWork {
  out.cut = 0;
  out.q = 0;
  out.qBase = 0;
  out.src = "none";
  out.distM = 0;
  if (ev.known !== 1) return out; // ignorance is not a frame
  if (!(rhoDeg > 0)) return out; // a point body has no area to cut and no radii to dwell for

  // ── the walk: nearest edge to the body's centre, with its own tag and its own range ──────────
  let bestDelta = Math.abs(altAppDeg - ev.groundAltAppDeg);
  let bestEdge = ev.groundAltAppDeg;
  let bestSrc = ev.groundSrc;
  let bestDist = ev.groundDistM;
  const bands = ev.bands;
  for (let k = 0; k < bands.length; k++) {
    const b = bands[k];
    // A band with no provenance is scored as `none` (conf 0) rather than inheriting the ground's
    // tag: crediting a slab we cannot name with terrain's confidence is how the deck fixture lied.
    const dLo = Math.abs(altAppDeg - b[0]);
    if (dLo < bestDelta) {
      bestDelta = dLo;
      bestEdge = b[0];
      bestSrc = ev.bandSrc[k] ?? "none";
      bestDist = ev.bandDistM[k] ?? Infinity;
    }
    const dHi = Math.abs(altAppDeg - b[1]);
    if (dHi < bestDelta) {
      bestDelta = dHi;
      bestEdge = b[1];
      bestSrc = ev.bandSrc[k] ?? "none";
      bestDist = ev.bandDistM[k] ?? Infinity;
    }
  }

  // ── ① CUT — two arms, each individually switchable ──────────────────────────────────────────
  let cut = 0;
  if (cfg.areaArm) {
    const f = clamp01(discFrac);
    cut = 4 * f * (1 - f);
  }
  if (cfg.tangentArm) {
    const halfWidthDeg = rhoDeg * cfg.tangentHalfWidthRadii;
    if (halfWidthDeg > 0) {
      const tangent = 1 - clamp01(bestDelta / halfWidthDeg);
      if (tangent > cut) cut = tangent;
    }
  }
  out.cut = cut;

  // ── ② Q — is the thing being cut worth photographing? ───────────────────────────────────────
  const relief = smoothstep(cfg.reliefLoDeg, cfg.reliefHiDeg, bestEdge - dipFloorDeg);
  out.src = bestSrc;
  out.distM = bestDist;
  if (!(relief > 0)) return out; // a flat horizon is not a frame — and the log is never evaluated
  out.qBase = relief * depthFor(bestDist);
  out.q = out.qBase * (cfg.conf[bestSrc] ?? 0);
  return out;
}

/** τ recomposed from its four provenance buckets: `Σ_s conf[s]·bucket[s]`.
 *
 *  Exported because S3c's COMPOSE pass reads the term buffer rather than the rays, and the two must
 *  agree bit for bit — one implementation, two callers, no second copy of the arithmetic. */
export function grazeTauTotal(split: GrazeTauSplit, conf: BestSpotScoring["graze"]["conf"]): number {
  return (
    split.terrain * (conf.terrain ?? 0) +
    split.building * (conf.building ?? 0) +
    split.deck * (conf.deck ?? 0) +
    split.tree * (conf.tree ?? 0)
  );
}

/** `F_graze = 1 − exp(−τ/scaleRadii)` (`SPEC_V2 §1.1 ④`).
 *
 *  Saturating rather than linear because dwell has diminishing returns: the difference between
 *  riding an edge for 1 radius and for 3 is the whole photograph; the difference between 8 and 10 is
 *  nothing. `scaleRadii` is the ONE swept taste number in the group (6 values, §1.1). */
export function grazeFromTau(tauRadii: number, scaleRadii: number): number {
  if (!(tauRadii > 0)) return 0;
  if (!(scaleRadii > 0)) return 1; // a zero e-folding scale is a hard step, never a NaN
  return 1 - Math.exp(-tauRadii / scaleRadii);
}

// ---------------------------------------------------------------------------------------------
// §3.4 — F_notch, the "moon rising between buildings" kernel
// ---------------------------------------------------------------------------------------------

/** Tunable half of `notchAt` — structurally the profile's `gap` group, so `cellScore` hands its own
 *  `scoring.gap` straight in. Kept as its own interface because the kernel stays testable at the
 *  endpoints rather than only at the shipped values. */
export interface NotchOptions {
  /** `±3°` — how far out the flanking mass is looked for. */
  shoulderSpanDeg: number;
  /** `0.1°` — the salience floor. Below it a dip is mesh noise, not a notch. */
  salienceFloorDeg: number;
  /** `3°` — shoulder height at which the depth term saturates. */
  maxDepthDeg: number;
  /** `2°` — gap width at which the notch term dies. */
  maxWidthDeg: number;
  /** Disc radii of clearance the body must have above the notch floor. Was `NOTCH_CLEARANCE_RADII`,
   *  read from module scope at the one line below — the single `NOTCH_*` constant that missed this
   *  interface when it was written. */
  clearanceRadii: number;
  /** How the two shoulders' own quality is combined into the notch weight. **Not read here** —
   *  S3b applies `min(Q(sL), Q(sR))` in `cellScore` where the per-edge `Q` lives; it rides on this
   *  interface so the whole `gap` group has ONE home. */
  shoulderQuality: "min" | "mean" | "off";
}

export const NOTCH_DEFAULTS: NotchOptions = BESTSPOT_SCORING_V1.gap;

/** Everything `notchAt` measured, not just the score — the panel prints "a 1.2° gap, 4° deep" and
 *  the tests pin the parts independently of the composition. */
export interface NotchResult {
  /** `F_notch`, 0..1. */
  f: number;
  /** The LOW POINT of the skyline under the disc at `az*` — see the `notchAt` docstring for why
   *  this is not simply `Hg(az*)`. */
  floorDeg: number;
  /** Max `Hg` over `[az*−3°, az*−ρ]`. `−Infinity` when that shoulder was never sampled. */
  shoulderLDeg: number;
  /** Max `Hg` over `[az*+ρ, az*+3°]`. `−Infinity` when that shoulder was never sampled. */
  shoulderRDeg: number;
  /**
   * Index of the ray that SET `shoulderLDeg` (`−1` when that shoulder was never sampled).
   *
   * ADDITIVE, S3b: `notchAt` itself is unchanged — all eight PIN-2 tests stay verbatim — but the
   * notch now has to be WEIGHTED by the quality of the two things that make it a gap (`F_gap =
   * f · min(Q(sL), Q(sR))`, `SPEC_V2 §1.1 ⑤`). `Q` is per EDGE and lives in `cellScore` beside the
   * profile and the dip floor, so what this kernel owes it is the IDENTITY of the shoulder, not a
   * second opinion about its worth. A gap between two 15-storey blocks 1.5 km out and the same gap
   * between two hedges are the same angles and different photographs.
   */
  shoulderLIdx: number;
  /** Index of the ray that set `shoulderRDeg` (`−1` when unsampled). See `shoulderLIdx`. */
  shoulderRIdx: number;
  /** `min(sL, sR) − floor`. `−Infinity` if either shoulder is unmeasured — ignorance is not depth. */
  depthDeg: number;
  /** Angular measure of the connected `{a : Hg(a) < alt*}` component containing `az*`. */
  widthDeg: number;
}

/**
 * `F_notch` — "the moon rising between buildings" (§3.4).
 *
 * ```
 * F_notch = [alt* − floor >= ρ]
 *         · clamp01((depth − 0.1°) / (3° − 0.1°))
 *         · clamp01((2° − width) / (2° − 2ρ))
 * ```
 *
 * THE DEGENERATE FORM THIS EXISTS TO EXCLUDE: if `alt*` is taken as the SKYLINE at `az*` rather
 * than as the BODY's apparent altitude there, `alt* − floor` is identically 0, the clearance gate
 * never opens, and `F_notch` is identically zero for every cell on the map — a term that cannot
 * fire is indistinguishable from a term that was never written. The test names that case.
 *
 * SPEC CORRECTION — `floor` is NOT `Hg(az*)` (measured, S1a 2026-08-24). `az*` is by definition the
 * LAST azimuth at which the disc is still half visible, i.e. the azimuth at which the disc is
 * STRADDLING A FLANK. Reading the floor from that single ray therefore samples the WALL, not the
 * gap — measured on the spec's own 1.5°-wide / 4°-deep canyon, `Hg(az*) = 4°`, `depth = 0` and
 * `F_notch` collapses to exactly 0 in the composition even though the standalone kernel returns
 * 0.36 for the same geometry. So the floor is taken as the LOW POINT of the skyline under the
 * disc's own ±ρ azimuth footprint (nearest-to-`az*` on ties), and the width walk starts there.
 * A uniform skyline still yields `depth = 0`, so this cannot invent a notch.
 *
 * @param rays        azimuth-ordered ray evidence (window + shoulders — §3.4 C is measured over the
 *                    same FULL span, which is exactly why the shoulders are swept at all)
 * @param starIndex   index of `az*` within `rays`
 * @param altStarDeg  `alt*` — the body's APPARENT centre altitude at `az*`
 * @param rhoDeg      the body's angular radius there
 */
export function notchAt(
  rays: readonly RayEvidence[],
  starIndex: number,
  altStarDeg: number,
  rhoDeg: number,
  opts: NotchOptions = NOTCH_DEFAULTS,
): NotchResult {
  const n = rays.length;
  const empty: NotchResult = {
    f: 0,
    floorDeg: 0,
    shoulderLDeg: -Infinity,
    shoulderRDeg: -Infinity,
    shoulderLIdx: -1,
    shoulderRIdx: -1,
    depthDeg: -Infinity,
    widthDeg: Infinity,
  };
  if (starIndex < 0 || starIndex >= n) return empty;
  const star = rays[starIndex];
  if (star.known !== 1) return empty;

  // --- floor: the low point UNDER THE DISC, not the ray at az* (see the SPEC CORRECTION above) --
  let floorIdx = starIndex;
  let floorDeg = star.groundAltAppDeg;
  let floorDaz = 0;
  for (let i = 0; i < n; i++) {
    const r = rays[i];
    if (r.known !== 1) continue;
    const d = Math.abs(wrapDeltaDeg(r.azDeg, star.azDeg));
    if (d > rhoDeg) continue;
    if (r.groundAltAppDeg < floorDeg || (r.groundAltAppDeg === floorDeg && d < floorDaz)) {
      floorDeg = r.groundAltAppDeg;
      floorIdx = i;
      floorDaz = d;
    }
  }
  const az0 = rays[floorIdx].azDeg;

  // --- shoulders: the flanking mass that makes a gap a GAP -------------------------------------
  // The ±ρ inner cut-off matters: the disc itself is 2ρ wide, so mass within one radius of az* is
  // part of what the body is setting INTO, not part of the frame around it.
  let shoulderLDeg = -Infinity;
  let shoulderRDeg = -Infinity;
  let shoulderLIdx = -1;
  let shoulderRIdx = -1;
  for (let i = 0; i < n; i++) {
    const r = rays[i];
    if (r.known !== 1) continue; // an unsampled shoulder is ignorance, not flat ground
    const d = wrapDeltaDeg(r.azDeg, az0);
    if (d <= -rhoDeg && d >= -opts.shoulderSpanDeg) {
      if (r.groundAltAppDeg > shoulderLDeg) {
        shoulderLDeg = r.groundAltAppDeg;
        shoulderLIdx = i;
      }
    } else if (d >= rhoDeg && d <= opts.shoulderSpanDeg) {
      if (r.groundAltAppDeg > shoulderRDeg) {
        shoulderRDeg = r.groundAltAppDeg;
        shoulderRIdx = i;
      }
    }
  }
  // min(): a notch with ONE tall flank is a corner, not a gap. −Infinity propagates by design.
  const depthDeg = Math.min(shoulderLDeg, shoulderRDeg) - floorDeg;

  // --- width: the connected component of {Hg < alt*} around az* --------------------------------
  // Walked outward and terminated by LINEAR INTERPOLATION of the crossing azimuth, so the width is
  // continuous in the ray step instead of quantised to it (a quantised width makes the notch term
  // flicker as the scrubber slides the contact azimuth across a bin boundary).
  const edgeAz = (inside: number, outside: number): number => {
    const a = rays[inside];
    const b = rays[outside];
    const span = b.groundAltAppDeg - a.groundAltAppDeg;
    const t = span > 0 ? clamp01((altStarDeg - a.groundAltAppDeg) / span) : 0;
    return a.azDeg + wrapDeltaDeg(b.azDeg, a.azDeg) * t;
  };
  let widthDeg: number;
  if (!(floorDeg < altStarDeg)) {
    widthDeg = 0; // the body is at or below the skyline at az* — there is no gap to be in
  } else {
    let lo = floorIdx;
    while (lo - 1 >= 0 && rays[lo - 1].known === 1 && rays[lo - 1].groundAltAppDeg < altStarDeg)
      lo--;
    let hi = floorIdx;
    while (hi + 1 < n && rays[hi + 1].known === 1 && rays[hi + 1].groundAltAppDeg < altStarDeg)
      hi++;
    // Running off the swept span means the "notch" is UNBOUNDED, and an unbounded gap is open sky,
    // not a frame. Reported as Infinity rather than as the swept extent so it can never wrap into
    // a small number on a wide sweep — `clamp01` turns it into a dead term either way.
    if (lo === 0 || hi === n - 1) {
      widthDeg = Infinity;
    } else {
      widthDeg = Math.abs(wrapDeltaDeg(edgeAz(hi, hi + 1), edgeAz(lo, lo - 1)));
    }
  }

  return {
    f: notchFFromParts(altStarDeg, floorDeg, depthDeg, widthDeg, rhoDeg, opts),
    floorDeg,
    shoulderLDeg,
    shoulderRDeg,
    shoulderLIdx,
    shoulderRIdx,
    depthDeg,
    widthDeg,
  };
}

/**
 * `F_notch` from the GEOMETRY `notchAt` measured, with every tunable applied afresh.
 *
 * ```
 * F_notch = [alt* − floor >= clearanceRadii·ρ]
 *         · clamp01((depth − salienceFloorDeg) / (maxDepthDeg − salienceFloorDeg))
 *         · clamp01((maxWidthDeg − width) / (maxWidthDeg − 2ρ))
 * ```
 *
 * **THIS SPLIT IS WHAT MAKES `CLASS_OF`'s FOUR `gap.*` RECOMPOSE ENTRIES TRUE** (S3c). `notchAt`
 * measures three things about the skyline — a floor, a depth and a width — and then applies four
 * taste numbers to them. Storing only the PRODUCT froze those four at solve time, so the
 * invalidation table said `recompose` while the buffer could only deliver a rescore. The term
 * buffer now carries `floorDeg`, `depthDeg`, `widthDeg` and `rhoStar`, and COMPOSE calls THIS
 * function — the same one `notchAt` calls — with the live profile.
 *
 * `depthDeg` and `widthDeg` may be `±Infinity` by `notchAt`'s design (an unmeasured shoulder is
 * ignorance, an unbounded gap is open sky). `clamp01` collapses both to a dead term, and f32 storage
 * preserves the infinities exactly, so the round trip through the buffer changes nothing.
 */
export function notchFFromParts(
  altStarDeg: number,
  floorDeg: number,
  depthDeg: number,
  widthDeg: number,
  rhoDeg: number,
  opts: NotchOptions,
): number {
  const clears = altStarDeg - floorDeg >= opts.clearanceRadii * rhoDeg ? 1 : 0;
  const depthTermV = clamp01(
    (depthDeg - opts.salienceFloorDeg) / (opts.maxDepthDeg - opts.salienceFloorDeg),
  );
  const widthTermV = clamp01((opts.maxWidthDeg - widthDeg) / (opts.maxWidthDeg - 2 * rhoDeg));
  return clears * depthTermV * widthTermV;
}

// ---------------------------------------------------------------------------------------------
// §3.5 — the composition
// ---------------------------------------------------------------------------------------------

/**
 * Everything `cellScore` needs that is not evidence, split along ONE line (§5.2):
 *
 *  · the **SITUATION** — where the eye is and what the air is doing. It changes when the user moves
 *    a slider that moves the OBSERVER, and it invalidates the sweep (`resweep`) or the whole build.
 *  · the **TASTE** — `scoring`, one frozen profile object that rides the JOB. Every leaf of it is
 *    reachable, hashable and diffable, and changing one costs a recompose (0.272 ms) rather than a
 *    rebuild. `trustRadiusM` / `minCoverage` / `discColumns` / `notch` / `weights` used to be
 *    siblings of `eyeM` here; they are taste, and they moved.
 *
 * Still explicit parameters and not a tuning import: §10 S1 is a pure-lib slice and the whole kernel
 * must be reproducible from a test fixture. `bestSpotMetric.test.ts` asserts the defaults still
 * agree with `components/globe/tuning.ts PLAN.*`, so a drift in either direction is a RED test
 * rather than a silent divergence between the worker and the shipped planner.
 */
export interface CellScoreOptions {
  /** Eye height above the CELL's ground (m). The pedestrian default is 1.7. */
  eyeM: number;
  /** Sheet LIFT above the cell's ground (m) — R3's altitude slider, 0 for the walked field. */
  liftM: number;
  /** Terrestrial refraction coefficient k — `PLAN.refractionK`. BESTSPOT_PHYSICS: it is folded into
   *  three places that must agree, so it is NOT a profile leaf. */
  refractionK: number;
  /** The taste profile. Frozen and fully populated — `resolveScoring` never returns a partial. */
  scoring: BestSpotScoring;
}

export const BESTSPOT_METRIC_DEFAULTS: CellScoreOptions = {
  eyeM: 1.7,
  liftM: 0,
  refractionK: 0.13,
  scoring: BESTSPOT_SCORING_V1,
};

/**
 * Score ONE cell against ONE event track. §3.5, verbatim:
 *
 * ```
 * IF C < minCoverage           -> verdict "unknown"   (a render class, NEVER a low score)
 * ELSE S = A_hard · A_soft^0.5 · M_eff · G(V) · [ 0.15·V + 0.30·L + 0.25·P + 0.30·F ]
 *      M_eff = worth.effectiveFloor + (1 − worth.effectiveFloor)·M          (owner ruling R7)
 * ```
 *
 * GATES MULTIPLY, PREFERENCES SUM, and the split is not cosmetic:
 *  · `A_hard` multiplies — a cell in the Dnipro is not a spot at any framing score;
 *  · `G(V)` multiplies but is SOFT — "the body is not visible from here" is a gate, but the
 *    silhouette hero case deliberately occults the disc, so a hard test would delete it;
 *  · `M` (`track.worth`) multiplies — a 9 %-lit quarter moon rising in daylight is not a good spot
 *    however clean the horizon, and it is ONE SCALAR at zero per-cell cost — but it multiplies
 *    THROUGH R7's floor (`effectiveWorth`), because raw it made the moon map black ~26 nights in
 *    30. Sun kinds carry `worth = 1`, for which `M_eff` is exactly 1;
 *  · `L, P, F` SUM — a clean 30 km horizon (`P=1, F=0`) and a bridge silhouette (`F=1, P=0.9`) are
 *    BOTH correct answers to "where should I stand"; multiplying would zero the clean-horizon case
 *    the owner explicitly listed as good;
 *  · `A_soft^0.5` — 36.1 % of a dense Dnipro box is UNKNOWN landcover, so raw multiplication makes
 *    the map read as a landcover map.
 *
 * INDEX CONTRACT: `rays[i]` and `track.samples[i]` describe the SAME azimuth. That collapse is the
 * point of reparameterising the track by azimuth (§3.1) — over the window both `az(t)` and `alt(t)`
 * are monotone, so every swept ray has exactly ONE crossing time. A mismatch is a programming
 * error and throws rather than silently scoring one geometry against another's sky.
 */
export function cellScore(
  rays: readonly RayEvidence[],
  track: EventTrack,
  access: CellAccess,
  opts: CellScoreOptions = BESTSPOT_METRIC_DEFAULTS,
): CellScore {
  const samples = track.samples;
  const n = rays.length;
  if (n !== samples.length) {
    throw new Error(
      `bestSpotMetric: rays (${n}) and track.samples (${samples.length}) must share one azimuth index`,
    );
  }

  // ONE read of the profile per cell, hoisted out of every loop below it. `nearRefM`/`depthCeil`
  // are the `P` kernel's two constants: the ceiling used to be recomputed inside `depthOfDistM` on
  // every edge of every sample.
  const sc = opts.scoring;
  const nearRefM = sc.curves.depthNearRefM;
  const trustRadiusM = sc.curves.depthTrustRadiusM;
  const depthCeil = depthLogCeil(trustRadiusM, nearRefM);
  const halfDisc = sc.gates.halfDiscFrac;
  const graze = sc.graze;
  const depthFor = depthByDistance(trustRadiusM, nearRefM);
  const depthOfRay = (ev: RayEvidence): number =>
    ev.openSky ? 1 : depthWithCeil(ev.blockerDistM, nearRefM, depthCeil);
  // The relief ramp's anchor. Hoisted ABOVE the loop (it used to be read after the coverage gate):
  // GRAZE needs it per sample, and it is a constant of the observer, not of the ray.
  const dipFloorDeg = horizonDipDeg(opts.eyeM + opts.liftM, opts.refractionK);

  // A closure per CELL (not per sample): the column lookup walks outward from the sample currently
  // being scored, which is O(1) because a disc spans ~2 ray steps.
  let centreIdx = 0;
  const columnRayAt: ColumnRayAt = (azDeg) => {
    if (n === 0) return null;
    let best = centreIdx;
    let bestD = Math.abs(wrapDeltaDeg(rays[centreIdx].azDeg, azDeg));
    for (let j = centreIdx - 1; j >= 0; j--) {
      const d = Math.abs(wrapDeltaDeg(rays[j].azDeg, azDeg));
      if (d >= bestD) break; // azimuth-ordered ⇒ the distance is unimodal in the index
      best = j;
      bestD = d;
    }
    for (let j = centreIdx + 1; j < n; j++) {
      const d = Math.abs(wrapDeltaDeg(rays[j].azDeg, azDeg));
      if (d >= bestD) break;
      best = j;
      bestD = d;
    }
    return rays[best];
  };

  const fAt = (i: number): number => {
    centreIdx = i;
    const s = samples[i];
    return discVisibleFraction(
      rays[i],
      s.altAppDeg,
      s.rhoDeg,
      sc.quadrature.discColumns,
      columnRayAt,
    );
  };

  // Which way does altitude run along the index? Monotone by the track's own contract, so ONE
  // comparison settles it — and it is what makes "the LOWEST alt with f ≥ 0.5" interpolable
  // without a bisection.
  const descending = n > 1 ? samples[0].altAppDeg > samples[n - 1].altAppDeg : true;

  // Window bounds, clamped to the ray array. A track with no shoulders (every synthetic fixture) marks
  // the whole span as window, so this degenerates to "all samples" rather than to a special case.
  const winLo = Math.max(0, Math.min(n - 1, track.windowLo));
  const winHi = Math.max(winLo, Math.min(n - 1, track.windowHi));

  // `Δα_i = |α_{i+1} − α_{i−1}| / 2` — the central difference of §1.1 ③, i.e. the ALTITUDE TRAVEL
  // this sample stands for. Clamped at the ends to the one-sided step, so the quadrature is a
  // trapezoid rather than a fiction. Measured over the FULL sample array (the track's own property),
  // not over the window, so a window edge is not charged half a step.
  const altStepAt = (i: number): number => {
    const lo = i > 0 ? i - 1 : i;
    const hi = i < n - 1 ? i + 1 : i;
    return hi > lo ? Math.abs(samples[hi].altAppDeg - samples[lo].altAppDeg) / (hi - lo) : 0;
  };

  let wSum = 0; // Σ w                — C denominator, over the FULL swept span
  let wKnown = 0; // Σ w·known        — C numerator
  let vNum = 0; // Σ known·w·f        — the WINDOW only (bug class 6)
  let vDen = 0; // Σ known·w          — bug class 4: unknown samples leave BOTH sums untouched
  let starIdx = -1;
  let starAlt = Infinity;
  // τ, SPLIT BY PROVENANCE and confidence-free (`GrazeTauSplit`) — that split is what makes
  // `graze.conf.*` and `graze.scaleRadii` a recompose instead of a rescore.
  const grazeTau: GrazeTauSplit = { terrain: 0, building: 0, deck: 0, tree: 0 };
  const work = newGrazeWork(); // ONE scratch per cell; the kernel never allocates
  let grazeStepRadii = 0;
  let bestGraze = 0;
  let grazeSrc: OccluderSrc = "none";
  let grazeDistM = 0;
  // The HONESTY RANGE (bestSpotTypes pin 7). Measured over the FULL swept span exactly like `c`,
  // and over ALL rays — an unsampled ray reaches 0, which is the reading that matters most.
  let minReachM = n > 0 ? Infinity : 0;

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const r = rays[i];
    wSum += s.w;
    if (r.reachM < minReachM) minReachM = r.reachM;
    if (r.known !== 1) continue;
    wKnown += s.w;
    const f = fAt(i);
    // `V` sees the WINDOW; the shoulders still feed `C`, `az*` and `F_gap` — the terms they were
    // swept for. The below-horizon half of bug class 6 is fixed in the TRACK's own weights, NOT by a
    // per-cell altitude filter here: see the header note for the measurement that rules that out.
    if (i >= winLo && i <= winHi) {
      vNum += s.w * f;
      vDen += s.w;
      // ── τ — GRAZE's dwell integral. Window + known only, exactly like `V`: the shoulders exist
      // for `C` and for the notch's flanks, and charging dwell to a sample nobody looked at is the
      // "ignorance is clear sky" defect wearing a different hat.
      const stepRadii = s.rhoDeg > 0 ? altStepAt(i) / s.rhoDeg : 0;
      if (stepRadii > grazeStepRadii) grazeStepRadii = stepRadii;
      // `f` is SHARED from `V` above — never recomputed. That sharing is what makes the AREA arm
      // cost one multiply instead of a second `discVisibleFraction`.
      grazeSampleInto(r, s.altAppDeg, s.rhoDeg, dipFloorDeg, f, graze, depthFor, work);
      const contribution = work.cut * work.qBase * stepRadii;
      if (contribution > 0) {
        if (work.src === "terrain") grazeTau.terrain += contribution;
        else if (work.src === "building") grazeTau.building += contribution;
        else if (work.src === "deck") grazeTau.deck += contribution;
        else if (work.src === "tree") grazeTau.tree += contribution;
        // The MAX-CONTRIBUTING edge is what the panel names ("…riding an 8 km ridge"), so it is
        // ranked by the CONFIDENCE-WEIGHTED contribution — the same number the score sees.
        const weighted = contribution * (graze.conf[work.src] ?? 0);
        if (weighted > bestGraze) {
          bestGraze = weighted;
          grazeSrc = work.src;
          grazeDistM = work.distM;
        }
      }
    }
    if (f >= halfDisc && s.altAppDeg < starAlt) {
      starAlt = s.altAppDeg;
      starIdx = i;
    }
  }

  const c = wSum > 0 ? clamp01(wKnown / wSum) : 0;
  const v = vDen > 0 ? clamp01(vNum / vDen) : 0;

  const starRay = starIdx >= 0 ? rays[starIdx] : null;
  // `alt*` refined between the last half-visible sample and its neighbour on the LOW side, where
  // f crosses 0.5. Per-ray interpolation, no bisection (§3.4) — it also stops L from being
  // quantised to the azimuth step, which would make the altitude slider read as stair steps.
  let altStarDeg = starIdx >= 0 ? starAlt : samples.length > 0 ? maxAlt(samples) : 0;
  if (starIdx >= 0) {
    const lowIdx = descending ? starIdx + 1 : starIdx - 1;
    if (lowIdx >= 0 && lowIdx < n && rays[lowIdx].known === 1) {
      const fHere = fAt(starIdx);
      const fLow = fAt(lowIdx);
      if (fLow < halfDisc && fHere > fLow) {
        const t = (fHere - halfDisc) / (fHere - fLow);
        altStarDeg = starAlt + (samples[lowIdx].altAppDeg - starAlt) * t;
      }
    }
  }

  if (c < sc.gates.minCoverage) {
    // §3.5 — a DISTINCT render class. No ink, excluded from the top-K, counted in "% UNMAPPED".
    // The preference terms are deliberately NOT evaluated: there is nothing to prefer. Consumers
    // MUST branch on `verdict`; `score` is 0 here only because the field is a number.
    return {
      verdict: "unknown",
      score: 0,
      v,
      l: 0,
      p: 0,
      f: 0,
      fGraze: 0,
      fGap: 0,
      grazeRadii: 0,
      // τ's buckets are zeroed with the rest of the preference half — but `grazeStepRadii` is
      // published for real, because it is a property of the TRACK (how finely the sky was sampled),
      // not a preference about this cell, and the panel's honesty line reads it either way.
      grazeTau: { terrain: 0, building: 0, deck: 0, tree: 0 },
      grazeSrc: "none",
      grazeDistM: 0,
      grazeStepRadii,
      c,
      // Published on the UNKNOWN branch too: "we looked 40 m" is exactly what the panel must say
      // about a cell it is refusing to score (bestSpotTypes pin 7).
      minReachM: minReachM === Infinity ? 0 : minReachM,
      altStarDeg,
      dStarM: starRay ? starRay.blockerDistM : 0,
      srcStar: starRay ? starRay.src : "none",
      access,
    };
  }

  // The third argument is the one that used to be DEAD: `contactLowness` has always declared
  // `ceilDeg`, and `cellScore` has always called it with two arguments.
  const l = starRay ? contactLowness(altStarDeg, dipFloorDeg, sc.curves.lCeilDeg) : 0;
  const p = starRay ? depthOfRay(starRay) : 0;

  // ── F = max(GRAZE, GAP) ──────────────────────────────────────────────────────────────────────
  const grazeRadii = grazeTauTotal(grazeTau, graze.conf);
  const fGraze = grazeFromTau(grazeRadii, graze.scaleRadii);
  const notch = starRay
    ? notchAt(rays, starIdx, altStarDeg, samples[starIdx].rhoDeg, sc.gap)
    : null;
  // `notchAt` is UNCHANGED (all eight PIN-2 tests stay verbatim); the weight is applied HERE,
  // where the per-edge `Q` and the dip floor live. A gap is only as good as the two things that
  // make it a gap — the same notch between two hedges is not the same photograph.
  const fGap = notch
    ? notch.f *
      shoulderQualityOf(rays, notch, dipFloorDeg, graze, depthFor, sc.gap.shoulderQuality)
    : 0;
  const f = Math.max(fGraze, fGap);

  // REGISTRY, not a hard-coded 4-term sum (§5.2): the composition iterates the keys of `weights`,
  // so adding a term is one field plus a weight of 0 rather than an edit here. The iteration order
  // is the record's own insertion order (v, l, p, f), which is exactly the order the hard-coded sum
  // used — so this is bit-identical, not merely equivalent.
  const terms: Record<BestSpotTermKey, number> = { v, l, p, f };
  const w = sc.weights;
  let wTotal = 0;
  let wDotT = 0;
  for (const key of Object.keys(w) as BestSpotTermKey[]) {
    const t = terms[key];
    // A NEWER profile read by an OLDER kernel carries a weight for a term this build cannot
    // compute. Dropping it (rather than multiplying by `undefined`) is the difference between one
    // stale term and a whole disc of NaN ink — the profile crosses `postMessage`, so the version
    // skew is real, not hypothetical.
    if (t === undefined) continue;
    wTotal += w[key];
    wDotT += w[key] * t;
  }
  // Normalised by the weight sum so a custom blend cannot inflate S past 1 — the GL ramp reads
  // ABSOLUTE score (an all-bad disc must look all-bad), so the top of the scale has to mean 1.
  const preference = wTotal > 0 ? wDotT / wTotal : 0;
  const score = clamp01(
    (access.hard ? 1 : 0) *
      accessSoftGain(clamp01(access.soft), sc.curves.accessSoftExponent) *
      effectiveWorth(track.worth, sc.worth) *
      visibilityGate(v, sc.gates) *
      preference,
  );

  return {
    verdict: "scored",
    score,
    v,
    l,
    p,
    f,
    fGraze,
    fGap,
    grazeRadii,
    grazeTau,
    grazeSrc,
    grazeDistM,
    grazeStepRadii,
    c,
    minReachM: minReachM === Infinity ? 0 : minReachM,
    altStarDeg,
    dStarM: starRay ? starRay.blockerDistM : 0,
    srcStar: starRay ? starRay.src : "none",
    access,
  };
}

/**
 * `min(Q(sL), Q(sR))` — how much the two shoulders are worth as a FRAME (`SPEC_V2 §1.1 ⑤`).
 *
 * `min` and not `mean` by default for the same reason `notchAt` takes `min(sL, sR)` as its depth: a
 * gap with ONE good flank is a corner, not a gap. An unmeasured shoulder scores 0 — ignorance is
 * not quality — which agrees with `notchAt`'s own `−Infinity` propagation rather than papering over
 * it. `"off"` returns 1 and reproduces the shipped, unweighted `F_notch` exactly.
 *
 * Each shoulder is priced through the SAME `Relief · Conf · Depth` as a GRAZE edge, on that
 * shoulder ray's own GROUND channel — the shoulder IS the ground horizon there by `notchAt`'s
 * construction.
 */
function shoulderQualityOf(
  rays: readonly RayEvidence[],
  notch: NotchResult,
  dipFloorDeg: number,
  graze: BestSpotScoring["graze"],
  depthFor: (distM: number) => number,
  mode: BestSpotScoring["gap"]["shoulderQuality"],
): number {
  const parts = shoulderQualityParts(rays, notch, dipFloorDeg, graze, depthFor);
  return combineShoulderQuality(parts.qL, parts.qR, mode);
}

/** The two shoulders' qualities, UNCOMBINED.
 *
 *  Exported because `gap.shoulderQuality` is a **recompose** (`CLASS_OF`), and a recompose can only
 *  be honest if the term buffer stores what the mode is a function OF. Storing the combined number
 *  would freeze the mode at solve time and make the table a lie — S3c stores `qL` and `qR` and
 *  combines them in COMPOSE. */
export function shoulderQualityParts(
  rays: readonly RayEvidence[],
  notch: NotchResult,
  dipFloorDeg: number,
  graze: BestSpotScoring["graze"],
  depthFor: (distM: number) => number,
): { qL: number; qR: number } {
  return {
    qL: groundEdgeQuality(rays, notch.shoulderLIdx, dipFloorDeg, graze, depthFor),
    qR: groundEdgeQuality(rays, notch.shoulderRIdx, dipFloorDeg, graze, depthFor),
  };
}

/** `min` / `mean` / `off` over the two shoulder qualities — the ONE implementation of the mode, so
 *  `cellScore` and COMPOSE cannot fork on it. `"off"` returns 1 and reproduces the shipped,
 *  unweighted `F_notch` exactly. */
export function combineShoulderQuality(
  qL: number,
  qR: number,
  mode: BestSpotScoring["gap"]["shoulderQuality"],
): number {
  if (mode === "off") return 1;
  return mode === "mean" ? (qL + qR) / 2 : Math.min(qL, qR);
}

/** `Q` for the GROUND edge of one ray — GRAZE's own quality kernel, addressed by index. */
function groundEdgeQuality(
  rays: readonly RayEvidence[],
  idx: number,
  dipFloorDeg: number,
  graze: BestSpotScoring["graze"],
  depthFor: (distM: number) => number,
): number {
  if (idx < 0 || idx >= rays.length) return 0;
  const r = rays[idx];
  if (r.known !== 1) return 0;
  const relief = smoothstep(graze.reliefLoDeg, graze.reliefHiDeg, r.groundAltAppDeg - dipFloorDeg);
  if (!(relief > 0)) return 0;
  return relief * (graze.conf[r.groundSrc] ?? 0) * depthFor(r.groundDistM);
}

/**
 * `A_soft ^ accessSoftExponent`. 36.1 % of a dense Dnipro box is UNKNOWN landcover, so raw
 * multiplication makes the whole map read as a landcover map; the exponent is what turns landcover
 * into a penalty rather than a decision.
 *
 * The `0.5` fast path is not a micro-optimisation. `Math.sqrt` is CORRECTLY ROUNDED by IEEE-754;
 * `Math.pow(x, 0.5)` is implementation-approximated and may differ in the last ulp. Routing the
 * shipped exponent through `sqrt` keeps the refactor bit-identical AND keeps the more accurate of
 * the two functions on the default path.
 *
 * Exported for the COMPOSE pass, which recomputes `accessAt` from the term buffer's stored `cls` /
 * `flags` byte and must reproduce this arithmetic to the last bit.
 */
export function accessSoftGain(soft: number, exponent: number): number {
  return exponent === 0.5 ? Math.sqrt(soft) : Math.pow(soft, exponent);
}

/**
 * `M_eff` — owner ruling **R7**, the ONE deliberate behaviour change of slice S3a.
 *
 * ```
 * mode === "badge"  ->  1                                        (M leaves the product entirely)
 * otherwise         ->  effectiveFloor + (1 − effectiveFloor)·M
 * ```
 *
 * **Why.** Measured over 30 consecutive days at Dnipro, moonrise `worth` runs min 0.0003 / median
 * 0.0290 / max 0.8639. Because `M` multiplied RAW, the best possible moon cell on a median night
 * scored `0.029 × 0.7 ≈ 0.020` — 25× below the sheet's own legibility floor, i.e. **the moon map
 * was black ~26 nights in 30**. R7: bad nights DIM rather than VANISH. At the shipped 0.35 a median
 * night reads 0.369 (best cell ≈ 0.31) and a full moon 0.911 (≈ 0.77): separation preserved,
 * nothing disappears.
 *
 * **Every sun number is untouched.** Sun kinds have `worth === 1` by construction
 * (`bestSpotTrack.worthAt`), and `0.35 + (1 − 0.35)·1` is exactly 1 in IEEE doubles — not 1 to
 * within an epsilon. `bestSpotScoring.test.ts` asserts that identity rather than assuming it.
 *
 * Exported for the COMPOSE pass: `worth.*` is a RECOMPOSE only because COMPOSE recovers `M` from the
 * track's stored `sunAltAtT0Deg`/`moonPhaseAngleDeg` through `worthFromParts` and then through THIS
 * function — the same one `cellScore` uses, so the two can never fork.
 */
export function effectiveWorth(worth: number, cfg: BestSpotScoring["worth"]): number {
  if (cfg.mode === "badge") return 1;
  const floor = clamp01(cfg.effectiveFloor);
  return floor + (1 - floor) * clamp01(worth);
}

/** The track's ceiling — reported as `alt*` when the disc NEVER reached half-visible, so the panel
 *  can read "never clears" instead of reading a fabricated contact altitude. */
function maxAlt(samples: EventTrack["samples"]): number {
  let m = -Infinity;
  for (let i = 0; i < samples.length; i++) if (samples[i].altAppDeg > m) m = samples[i].altAppDeg;
  return m;
}
