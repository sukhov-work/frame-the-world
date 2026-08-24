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
  BESTSPOT_WEIGHTS,
  type BestSpotWeights,
  type CellAccess,
  type CellScore,
  type EventTrack,
  type OccluderSrc,
  type RayEvidence,
} from "./bestSpotTypes";

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Named constants — every one of these is a number the spec fixed, with the reason it is that
// number. They are deliberately NOT in `components/globe/tuning.ts`: §10 S1 is a pure-lib slice
// and a slider that can move the gate edges is a slider that can paper over standing in a river.
// ---------------------------------------------------------------------------------------------

/** `G(V) = smoothstep(0.15, 0.75, V)` — the visibility GATE (§3.5). Soft, not a step, because the
 *  `F_sil` hero case INTENTIONALLY occults the disc for part of the track: a hard `V = 1` test
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

/** Is this setter MAN-MADE? `F_sil` is gated on it (§3.4).
 *
 *  WHY A TAG AND NOT A THRESHOLD: the pre-correction design inferred "man-made" from
 *  `H > terrainBaseline + 0.1°`, i.e. a threshold on a HEIGHT difference of `1.745e-3·D` metres —
 *  2.6 m at 1.5 km — decided by the least reliable channel in the whole pipeline (~145 m-posted
 *  terrain; the Dnipro river tile decodes to 29 vertices). The tag is exact and free.
 *
 *  TREES ARE NOT BUILT. 151,046 of Dnipro's 161,823 canopies are seeded scatter with jittered
 *  class-default heights (§8) — a "tangency with a tree" is a tangency with fiction. */
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
export function depthOfDistM(distM: number, trustRadiusM: number): number {
  const ceil = Math.log(Math.max(trustRadiusM, DEPTH_NEAR_REF_M * Math.E) / DEPTH_NEAR_REF_M);
  return clamp01(Math.log(Math.max(distM, 1e-6) / DEPTH_NEAR_REF_M) / ceil);
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
export function depthTerm(ev: RayEvidence, trustRadiusM: number): number {
  if (ev.openSky) return 1;
  return depthOfDistM(ev.blockerDistM, trustRadiusM);
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

/** `G(V)` — the SOFT visibility gate (§3.5). Multiplies, but must never be a hard step. */
export function visibilityGate(v: number): number {
  return smoothstep(V_GATE_LO, V_GATE_HI, v);
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
// §3.4 — F_sil, the tangency kernel
// ---------------------------------------------------------------------------------------------

/** Distance (deg) from an elevation to the NEAREST silhouette edge on this ray: the ground horizon
 *  itself, or either edge of any floating band. A deck has TWO edges and the body can be tangent
 *  to the underside — that is the "sun under the bridge" frame, and a ground-max profile has no
 *  way to name it.
 *
 *  UNGATED BY DESIGN: it answers "how far is the nearest edge", which is what the panel prints. The
 *  BUILT gate and the per-edge depth weight belong to `silTangency`, which walks the same edges one
 *  by one — LENS B's finding was precisely that this function already returned the right ANGLE for a
 *  deck while the gate and the depth weight beside it read a ray-wide field that could not name one. */
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
 * `F_sil` — the TANGENCY kernel (§3.4): a triangular ramp of half-width ρ around a BUILT
 * silhouette edge, weighted by THAT EDGE's depth term `P`.
 *
 * `max over built edges e of  (1 − clamp01(|altApp − e|/ρ)) · P(e)`
 *
 * **PER EDGE, NOT PER RAY (LENS B, 2026-08-24).** The old form gated the whole ray on `isBuiltSrc(
 * ev.src)` and weighted it by the ray's single `depthTerm`. Both fields were bound to the GROUND
 * setter, and `localDsm` deliberately keeps floating solids out of the surface (its pin 2) — so a real
 * bridge deck reported `"terrain"`, this kernel early-returned 0, and the hero case the term was
 * WRITTEN for ("a deck has TWO edges and the body can be tangent to the underside") could not fire on
 * any deck the producer can actually emit. Measured on the F3 geometry: `f = 0`, `S = 0.60799` WITH
 * the bridge against `0.62306` with no bridge at all. Now each edge carries its own tag
 * (`groundSrc` / `bandSrc[k]`) and its own distance (`groundDistM` / `bandDistM[k]`).
 *
 * Half-width ONE DISC RADIUS, not one time-step: sampled on time instead of azimuth the kernel's
 * half-width is ~1.02 two-minute samples, so identical geometry scored anywhere between 0.51 and
 * 1.00 depending on where the samples happened to land. The azimuth reparameterisation of
 * `EventTrack` is what removes that aliasing — this function assumes it.
 *
 * `P` multiplies rather than sums: a silhouette against a fence 4 m away is not a composition.
 *
 * @param depthP        the ray's own `depthTerm(...)` — the weight used when no `trustRadiusM` is
 *                      supplied, so the kernel stays a pure function of two angles and a weight for
 *                      callers that have already priced the ray.
 * @param trustRadiusM  when given (`cellScore` always gives it), EVERY edge is re-weighted by its OWN
 *                      distance instead of by `depthP`. Omitting it is not a different rule, only a
 *                      coarser one: the headline distance is the NEAREST occluder on the ray, so
 *                      `depthP` is a LOWER BOUND on every edge's own weight and the 4-argument form
 *                      can only ever under-credit.
 */
export function silTangency(
  ev: RayEvidence,
  altAppDeg: number,
  rhoDeg: number,
  depthP: number,
  trustRadiusM?: number,
): number {
  if (ev.known !== 1) return 0; // ignorance is not a silhouette
  if (!(rhoDeg > 0)) return 0;
  const fallback = clamp01(depthP);
  const weightFor = (distM: number): number =>
    trustRadiusM === undefined ? fallback : depthOfDistM(distM, trustRadiusM);
  const kernel = (edgeDeg: number): number => 1 - clamp01(Math.abs(altAppDeg - edgeDeg) / rhoDeg);

  let best = 0;
  // The GROUND edge is gated on `groundSrc`, NEVER on `ev.src`: the headline tag may name a nearer
  // floating band, and crediting the water horizon under a bridge with the bridge's own tag is the
  // mirror image of the bug this function was rewritten for.
  if (isBuiltSrc(ev.groundSrc)) {
    best = kernel(ev.groundAltAppDeg) * weightFor(ev.groundDistM);
  }
  for (let k = 0; k < ev.bands.length; k++) {
    if (!isBuiltSrc(ev.bandSrc[k])) continue;
    const w = weightFor(ev.bandDistM[k]);
    if (w <= 0) continue;
    const b = ev.bands[k];
    const v = Math.max(kernel(b[0]), kernel(b[1])) * w;
    if (v > best) best = v;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// §3.4 — F_notch, the "moon rising between buildings" kernel
// ---------------------------------------------------------------------------------------------

/** Tunable half of `notchAt`. Defaults are the spec's numbers; they are parameters so the kernel
 *  stays testable at the endpoints rather than only at the shipped values. */
export interface NotchOptions {
  /** `±3°` — how far out the flanking mass is looked for. */
  shoulderSpanDeg: number;
  /** `0.1°` — the salience floor. Below it a dip is mesh noise, not a notch. */
  salienceFloorDeg: number;
  /** `3°` — shoulder height at which the depth term saturates. */
  maxDepthDeg: number;
  /** `2°` — gap width at which the notch term dies. */
  maxWidthDeg: number;
}

export const NOTCH_DEFAULTS: NotchOptions = {
  shoulderSpanDeg: NOTCH_SHOULDER_DEG,
  salienceFloorDeg: NOTCH_SALIENCE_DEG,
  maxDepthDeg: NOTCH_MAX_DEPTH_DEG,
  maxWidthDeg: NOTCH_MAX_WIDTH_DEG,
};

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
  for (let i = 0; i < n; i++) {
    const r = rays[i];
    if (r.known !== 1) continue; // an unsampled shoulder is ignorance, not flat ground
    const d = wrapDeltaDeg(r.azDeg, az0);
    if (d <= -rhoDeg && d >= -opts.shoulderSpanDeg) {
      if (r.groundAltAppDeg > shoulderLDeg) shoulderLDeg = r.groundAltAppDeg;
    } else if (d >= rhoDeg && d <= opts.shoulderSpanDeg) {
      if (r.groundAltAppDeg > shoulderRDeg) shoulderRDeg = r.groundAltAppDeg;
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

  const clears = altStarDeg - floorDeg >= NOTCH_CLEARANCE_RADII * rhoDeg ? 1 : 0;
  const depthTermV = clamp01(
    (depthDeg - opts.salienceFloorDeg) / (opts.maxDepthDeg - opts.salienceFloorDeg),
  );
  const widthTermV = clamp01(
    (opts.maxWidthDeg - widthDeg) / (opts.maxWidthDeg - 2 * rhoDeg),
  );
  return {
    f: clears * depthTermV * widthTermV,
    floorDeg,
    shoulderLDeg,
    shoulderRDeg,
    depthDeg,
    widthDeg,
  };
}

// ---------------------------------------------------------------------------------------------
// §3.5 — the composition
// ---------------------------------------------------------------------------------------------

/** Everything `cellScore` needs that is not evidence. Explicit parameters, not a tuning import:
 *  §10 S1 is a pure-lib slice, and the whole kernel must be reproducible from a test fixture. The
 *  numbers below are mirrored from `components/globe/tuning.ts PLAN.*` — `bestSpotMetric.test.ts`
 *  asserts they still agree, so a drift in either direction is a RED test rather than a silent
 *  divergence between the worker and the shipped planner. */
export interface CellScoreOptions {
  /** Eye height above the CELL's ground (m). The pedestrian default is 1.7. */
  eyeM: number;
  /** Sheet LIFT above the cell's ground (m) — R3's altitude slider, 0 for the walked field. */
  liftM: number;
  /** Terrestrial refraction coefficient k — `PLAN.refractionK`. */
  refractionK: number;
  /** Geometry trust radius (m) — `PLAN.trustRadiusM`. The `P` term's log ceiling. */
  trustRadiusM: number;
  /** Evidence floor below which the cell is UNKNOWN — `PLAN.minCoverageForGaps`. */
  minCoverage: number;
  /** Quadrature columns across the disc (§3.3). */
  discColumns: number;
  /** Notch geometry. */
  notch: NotchOptions;
  /** Preference weights. Gates are NOT here — they multiply (§3.5). */
  weights: BestSpotWeights;
}

export const BESTSPOT_METRIC_DEFAULTS: CellScoreOptions = {
  eyeM: 1.7,
  liftM: 0,
  refractionK: 0.13,
  trustRadiusM: 3_000,
  minCoverage: 0.5,
  // 8 columns removes the midpoint-rule bias on a partially-cut disc for ~8 interval subtractions
  // per (cell, azimuth). It buys quadrature, never knowledge — the evidence step is the sweep's.
  discColumns: 8,
  notch: NOTCH_DEFAULTS,
  weights: BESTSPOT_WEIGHTS,
};

/**
 * Score ONE cell against ONE event track. §3.5, verbatim:
 *
 * ```
 * IF C < minCoverage           -> verdict "unknown"   (a render class, NEVER a low score)
 * ELSE S = A_hard · A_soft^0.5 · M · G(V) · [ 0.15·V + 0.30·L + 0.25·P + 0.30·F ]
 * ```
 *
 * GATES MULTIPLY, PREFERENCES SUM, and the split is not cosmetic:
 *  · `A_hard` multiplies — a cell in the Dnipro is not a spot at any framing score;
 *  · `G(V)` multiplies but is SOFT — "the body is not visible from here" is a gate, but the
 *    silhouette hero case deliberately occults the disc, so a hard test would delete it;
 *  · `M` (`track.worth`) multiplies — a 9 %-lit quarter moon rising in daylight is not a good spot
 *    however clean the horizon, and it is ONE SCALAR at zero per-cell cost;
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
    return discVisibleFraction(rays[i], s.altAppDeg, s.rhoDeg, opts.discColumns, columnRayAt);
  };

  // Which way does altitude run along the index? Monotone by the track's own contract, so ONE
  // comparison settles it — and it is what makes "the LOWEST alt with f ≥ 0.5" interpolable
  // without a bisection.
  const descending = n > 1 ? samples[0].altAppDeg > samples[n - 1].altAppDeg : true;

  // Window bounds, clamped to the ray array. A track with no shoulders (every synthetic fixture) marks
  // the whole span as window, so this degenerates to "all samples" rather than to a special case.
  const winLo = Math.max(0, Math.min(n - 1, track.windowLo));
  const winHi = Math.max(winLo, Math.min(n - 1, track.windowHi));

  let wSum = 0; // Σ w                — C denominator, over the FULL swept span
  let wKnown = 0; // Σ w·known        — C numerator
  let vNum = 0; // Σ known·w·f        — the WINDOW only (bug class 6)
  let vDen = 0; // Σ known·w          — bug class 4: unknown samples leave BOTH sums untouched
  let fSil = 0;
  let starIdx = -1;
  let starAlt = Infinity;

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const r = rays[i];
    wSum += s.w;
    if (r.known !== 1) continue;
    wKnown += s.w;
    const f = fAt(i);
    // `V` sees the WINDOW; the shoulders still feed `C`, `az*` and `F_notch` — the terms they were
    // swept for. The below-horizon half of bug class 6 is fixed in the TRACK's own weights, NOT by a
    // per-cell altitude filter here: see the header note for the measurement that rules that out.
    if (i >= winLo && i <= winHi) {
      vNum += s.w * f;
      vDen += s.w;
    }
    const sil = silTangency(r, s.altAppDeg, s.rhoDeg, depthTerm(r, opts.trustRadiusM), opts.trustRadiusM);
    if (sil > fSil) fSil = sil;
    if (f >= HALF_DISC && s.altAppDeg < starAlt) {
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
      if (fLow < HALF_DISC && fHere > fLow) {
        const t = (fHere - HALF_DISC) / (fHere - fLow);
        altStarDeg = starAlt + (samples[lowIdx].altAppDeg - starAlt) * t;
      }
    }
  }

  if (c < opts.minCoverage) {
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
      c,
      altStarDeg,
      dStarM: starRay ? starRay.blockerDistM : 0,
      srcStar: starRay ? starRay.src : "none",
      access,
    };
  }

  const dipFloorDeg = horizonDipDeg(opts.eyeM + opts.liftM, opts.refractionK);
  const l = starRay ? contactLowness(altStarDeg, dipFloorDeg) : 0;
  const p = starRay ? depthTerm(starRay, opts.trustRadiusM) : 0;
  const notch = starRay
    ? notchAt(rays, starIdx, altStarDeg, samples[starIdx].rhoDeg, opts.notch)
    : null;
  const f = Math.max(fSil, notch ? notch.f : 0);

  const w = opts.weights;
  const wTotal = w.v + w.l + w.p + w.f;
  // Normalised by the weight sum so a custom blend cannot inflate S past 1 — the GL ramp reads
  // ABSOLUTE score (an all-bad disc must look all-bad), so the top of the scale has to mean 1.
  const preference = wTotal > 0 ? (w.v * v + w.l * l + w.p * p + w.f * f) / wTotal : 0;
  const score = clamp01(
    (access.hard ? 1 : 0) *
      Math.sqrt(clamp01(access.soft)) *
      clamp01(track.worth) *
      visibilityGate(v) *
      preference,
  );

  return {
    verdict: "scored",
    score,
    v,
    l,
    p,
    f,
    c,
    altStarDeg,
    dStarM: starRay ? starRay.blockerDistM : 0,
    srcStar: starRay ? starRay.src : "none",
    access,
  };
}

/** The track's ceiling — reported as `alt*` when the disc NEVER reached half-visible, so the panel
 *  can read "never clears" instead of reading a fabricated contact altitude. */
function maxAlt(samples: EventTrack["samples"]): number {
  let m = -Infinity;
  for (let i = 0; i < samples.length; i++) if (samples[i].altAppDeg > m) m = samples[i].altAppDeg;
  return m;
}
