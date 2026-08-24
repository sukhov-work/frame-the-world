/**
 * BEST SPOT — THE EVENT TRACK (`BESTSPOT_PLAN.md` §3.1, slice S1b).
 *
 * The ephemeris half of the metric: ONE per-disc precompute that says where the sun/moon is, how
 * big it is, and how much each part of its rise/set is worth — reparameterised by AZIMUTH so the
 * per-cell work downstream is pure occlusion. Everything here is cell-INDEPENDENT (see the
 * parallax-invariance note on `TrackSample` in `bestSpotTypes.ts`: the dominant per-cell term is
 * the rotation of the local vertical, 16.2″ over 500 m — 1.7 % of ρ ≈ 949″).
 *
 * Pure, three-free, store-free, DOM-free, `Date.now()`-free — the `horizonProfile`/`occlusion`
 * idiom, so the whole thing imports cleanly inside the long-lived module worker of §5.
 *
 * ─── THE FIVE THINGS THIS FILE EXISTS TO PIN ────────────────────────────────────────────────────
 *
 *  1. **APPARENT vs AIRLESS — a 2.37-solar-radii lie if you skip it (plan F2).** The skyline this
 *     track is compared against is an APPARENT terrestrial angle by shipped contract
 *     (`horizonProfile.ts:10-13`), while `bodies.horizontal()` is AIRLESS by shipped contract
 *     (`bodies.ts:124,139`). At the event instant the gap is **0.6243°** — 2.37 solar radii, inside
 *     a feature that lives entirely in a 0–2° band. `altAppDeg` is therefore
 *     `airless + Refraction("normal", airless)` and NOTHING else in this module mixes the two
 *     refractions: the astronomical 34′ stays inside astronomy-engine, the terrestrial k = 0.13
 *     stays inside the profile. Symptom if you skip it: `V` over a PERFECT open horizon comes out
 *     0.698, so a gate anchored at 0.75 is unreachable and every cell reads mediocre.
 *
 *  2. **REFRACTED LABEL, APPARENT GEOMETRY.** `t0Ms` is the almanac's own refracted instant from
 *     `SearchRiseSet` (34′ refraction + the body's radius + the eye-height dip), matching the ☀ SET
 *     chip and every shipped almanac row. The AIRLESS centre there sits at ≈ −0.87° (the shipped
 *     pins `planner.test.ts:79-82` and `sunEventFrame.test.ts:50-51` bracket it at −1.1…−0.6°), and
 *     the APPARENT centre this module reports at the same instant sits at ≈ −0.25°. Both are
 *     correct; they are different quantities. Do not "fix" either one into the other.
 *
 *  3. **THE T32 OBSERVER CLAMP.** Every elevation any astronomy-engine call in this module sees
 *     comes out of `planElevationsM` (`planner.ts:107-113`). `Atmosphere()` THROWS outside
 *     [−500, +100000] m and `SearchRiseSet` builds a SECOND observer at
 *     `observer.height − metersAboveGround` (`astronomy.js:4930`), so clamping the observer alone
 *     is not enough — that pair is the whole point of the shipped helper. A 10 km eye must not
 *     throw; an orbital one must degrade to an aerial one, not report orbital rise times.
 *
 *  4. **THE MOON SKIPS DAYS, AND THE TROPICS DEFEAT THE REPARAMETERISATION.** A rise/set is not
 *     guaranteed to exist, and where one exists a track still is not. Over 2026 at Dnipro there are
 *     **366 sunrises and 353 moonrises** (measured, `bestSpotTrack.test.ts`) because the lunar day
 *     is ~24 h 50 m. `eventTrack` returns **`null`** for a day with no event and for a window that
 *     degenerates. `null` is the ONLY absent result — there is no half-built track, because a
 *     malformed track breaks the metric's "exactly one crossing per swept ray" invariant silently.
 *
 *     **WHERE THE DEGENERATE CASE ACTUALLY LIVES IS THE TROPICS, NOT THE POLES** (measured, LENS B
 *     2026-08-24 — the earlier wording named the wrong end of the globe and would have sent the next
 *     session hunting at 70°N). Polar day/night has no EVENT, so it exits at `eventInstantMs`. The
 *     REPARAMETERISATION is what fails near the solstices between roughly 0° and 8° of latitude: the
 *     setting azimuth is genuinely STATIONARY at the horizon there (at lat 0 on 2026-06-21 it sits at
 *     293.44° at `t0` and RISES on both sides), so `az(t)` is not invertible and no amount of code
 *     recovers a track. That is physics. It is also a UI obligation: the BEST SPOT panel must say
 *     "this event cannot be swept by azimuth here" rather than render an empty disc — noted for the
 *     panel slice (§10 S5), not built here.
 *
 *  5. **AZIMUTH WRAPS, AND THE SOUTHERN HEMISPHERE SWEEPS THE OTHER WAY.** `TrackSample.azDeg` is
 *     wrapped into [0,360) by contract, but the SEQUENCE is monotone in UNWRAPPED azimuth and may
 *     contain exactly one 0°/360° seam (a Tromsø midsummer sunset sweeps 316° → 404°). Consumers
 *     that need continuity call `unwrapTrackAzDeg`. And because samples are emitted in ASCENDING
 *     azimuth — which is what the fused sweep of §5 needs for its running maxima — a southern-
 *     hemisphere track is reverse-chronological. `w` uses |dt/daz|, so that is harmless; assuming
 *     time order is not.
 */

import { Body, Equator, Horizon, Observer, Refraction, SearchRiseSet } from "astronomy-engine";
import {
  angularRadiusRad,
  bodyStatesAt,
  KM_PER_AU,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
} from "../ephemeris/bodies";
import { localDayWindow } from "../ephemeris/dayArc";
import { moonPhaseIntensity } from "../ephemeris/moonlight";
import { planElevationsM, type PlanObserver } from "../ephemeris/planner";
import { LIGHT_DEG, sunAltDeg } from "../ephemeris/twilight";
import { horizonDipDeg } from "./horizonProfile";
import {
  BESTSPOT_HONESTY,
  BESTSPOT_SCORING_V1,
  type BestSpotScoring,
} from "./bestSpotScoring";
import {
  isRiseKind,
  kindBody,
  type BestSpotKind,
  type EventTrack,
  type TrackSample,
} from "./bestSpotTypes";

const DEG_PER_RAD = 180 / Math.PI;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

// ---------------------------------------------------------------------------------------------
// Refraction — the ONE conversion (pin 1)
// ---------------------------------------------------------------------------------------------

/**
 * AIRLESS altitude → APPARENT altitude (deg).
 *
 * Uses astronomy-engine's own EXPORTED `Refraction("normal", …)` — verified exported at
 * `node_modules/astronomy-engine/esm/astronomy.js:6361` and declared at
 * `node_modules/astronomy-engine/astronomy.d.ts:2300`. That function is the Saemundsson/Meeus
 * form `1.02 / tan(h + 10.3/(h + 5.11))` arcmin, clamped at h = −1° (the formula diverges near
 * h = −5.11°) and then linearly faded to zero toward the nadir, which is exactly the convention
 * `Horizon(..., "normal")` applies internally — so this module can never disagree with the
 * library's own refracted output.
 *
 * Reference values (measured, not asserted from memory): −0.87° → +0.6245° lift (the plan's
 * 0.6243° F2 figure), 0° → +0.4830°, +4° → +0.1893°.
 *
 * WHY NOT hand-roll Bennett: a second refraction implementation is a second convention, and this
 * repo's most expensive recurring bug class is exactly two conventions that look alike.
 */
export function apparentAltDeg(airlessDeg: number): number {
  return airlessDeg + Refraction("normal", airlessDeg);
}

// ---------------------------------------------------------------------------------------------
// Moon-event worth — ONE scene scalar (plan §3.4 `M`)
// ---------------------------------------------------------------------------------------------

/**
 * Sun altitudes (deg, airless) bounding the twilight plateau where a moonrise photographs.
 * Plan §3.4: gate = 1 on sunAlt ∈ [+0.5°, −6°]. The upper edge is just above the geometric
 * horizon (the balanced-exposure moonrise happens with the sun on or just over it); the lower
 * edge is civil twilight, `CIVIL_TWILIGHT_DEG` / `LIGHT_DEG.blue`.
 *
 * **These five constants are the SHIPPED VALUES, not what the code reads (S3a).** Their live twins
 * are `BESTSPOT_SCORING_V1.worth.*`, which rides the job so a taste pass can move the ramp without
 * a rebuild. They stay here, exported through `bestSpotScoring.test.ts`'s cross-check, because a
 * silently-widened ramp is the kind of drift that only ever shows up as "the moon map went quiet
 * in March", and a literal beside its provenance is how that drift gets caught.
 */
export const WORTH_GATE_HI_DEG = 0.5;
export const WORTH_GATE_LO_DEG = LIGHT_DEG.blue; // −6°, the shipped civil-twilight constant

/** Where the gate reaches its floor on each side. The plan names the plateau and the floor value
 *  but not the ramp width, so both edges are pinned to constants the repo ALREADY ships rather
 *  than to taste: above, `LIGHT_DEG.goldenHi` (+6°) — past it the sun is out of the photographic
 *  golden band and the moon is a daylight moon; below, `LIGHT_DEG.nautical` (−12°) — past it the
 *  sky is simply dark and the moon is "a moon at night", not the event this feature ranks. */
export const WORTH_RAMP_HI_DEG = LIGHT_DEG.goldenHi; // +6°
export const WORTH_RAMP_LO_DEG = LIGHT_DEG.nautical; // −12°

/** The floor the gate ramps DOWN to — never 0. A badly-timed moonrise is worth less, not nothing:
 *  a hard zero would delete whole months of the moon map, and "no ink" in this feature is reserved
 *  for UNKNOWN (no evidence), which is a different claim.
 *
 *  **NOT `worth.effectiveFloor`.** This one shapes `worth` ITSELF (the twilight gate's floor);
 *  R7's `effectiveFloor` shapes how the finished `worth` enters the per-cell product. Two floors,
 *  two jobs — see the `bestSpotScoring.ts` header. */
export const WORTH_GATE_FLOOR = 0.25;

/**
 * Twilight gate, `floor`..1, from the SUN's airless altitude at the moon event's contact instant.
 * Plateau `[plateauLoDeg, plateauHiDeg]`, linear ramps to `floor` at `rampHiDeg` / `rampLoDeg`.
 *
 * Exported so the ramp itself is pinnable without driving a whole almanac.
 */
export function twilightGate(
  sunAltitudeDeg: number,
  worth: BestSpotScoring["worth"] = BESTSPOT_SCORING_V1.worth,
): number {
  if (!Number.isFinite(sunAltitudeDeg)) return worth.floor;
  if (sunAltitudeDeg <= worth.plateauHiDeg && sunAltitudeDeg >= worth.plateauLoDeg) return 1;
  const [edge, floorAt] =
    sunAltitudeDeg > worth.plateauHiDeg
      ? [worth.plateauHiDeg, worth.rampHiDeg]
      : [worth.plateauLoDeg, worth.rampLoDeg];
  const span = Math.abs(floorAt - edge);
  const t = span > 0 ? Math.min(1, Math.abs(sunAltitudeDeg - edge) / span) : 1;
  return 1 + (worth.floor - 1) * t;
}

/**
 * The PHASE half of `worth`, as a function of the moon's phase angle (deg, 0 = full).
 *
 * `"ks1991"` — the repo's shipped Krisciunas–Schaefer 1991 curve (`moonlight.ts`): **a quarter moon
 * is ~9 % of full, not 50 %.** Without it the feature would list 353 mostly-worthless moonrises a
 * year with equal confidence.
 *
 * `"illumFrac"` — the naive illuminated fraction `(1 + cos α)/2`. It exists ONLY so the owner can
 * see the difference side by side; `sanitizeScoringPatch` refuses to persist it (§5.5).
 *
 * `"off"` — phase drops out entirely and `worth` becomes the twilight gate alone.
 */
export function moonPhaseTerm(
  phaseAngleDeg: number,
  curve: BestSpotScoring["worth"]["phaseCurve"],
): number {
  if (curve === "off") return 1;
  if (curve === "illumFrac") {
    const a = Math.min(Math.max(Math.abs(phaseAngleDeg), 0), 180);
    return (1 + Math.cos(a * (Math.PI / 180))) / 2;
  }
  return moonPhaseIntensity(phaseAngleDeg);
}

/**
 * §5.3(b) — the two ephemeris readings `worth` is a pure function of.
 *
 * Carrying them on the track is what moves the whole `worth.*` group from REBUILD (490 ms, the
 * ephemeris has to be re-driven) to RECOMPOSE (0.272 ms): with these two numbers in hand,
 * `worthFromParts` reproduces `M` exactly, for any profile, with no astronomy-engine call.
 *
 * The two readings live on `EventTrack` itself (`bestSpotTypes.ts`) as additive OPTIONAL fields, so
 * a hand-written fixture need not supply them; this alias is the NON-optional view the producer and
 * the recompose path both work in, and it is the reason `worthFromParts` can never be handed a
 * half-populated track.
 */
export type EventTrackWorthParts = Required<
  Pick<EventTrack, "sunAltAtT0Deg" | "moonPhaseAngleDeg">
>;

/**
 * `M` from the two stored readings — pure, ephemeris-free, and the function the RECOMPOSE path
 * calls. Exactly `1` for sun kinds (the sun is always worth photographing; `M` exists to rank MOON
 * days against each other, not sun days against moon days).
 */
export function worthFromParts(
  kind: BestSpotKind,
  parts: EventTrackWorthParts,
  scoring: BestSpotScoring = BESTSPOT_SCORING_V1,
): number {
  if (kindBody(kind) === "sun") return 1;
  return (
    moonPhaseTerm(parts.moonPhaseAngleDeg, scoring.worth.phaseCurve) *
    twilightGate(parts.sunAltAtT0Deg, scoring.worth)
  );
}

/** The two readings, taken once per disc at the contact instant. */
function worthPartsAt(
  kind: BestSpotKind,
  contactMs: number,
  o: PlanObserver,
): EventTrackWorthParts {
  if (kindBody(kind) === "sun") return { sunAltAtT0Deg: 0, moonPhaseAngleDeg: 0 };
  return {
    sunAltAtT0Deg: sunAltDeg(contactMs, o.latDeg, o.lonDeg),
    moonPhaseAngleDeg: bodyStatesAt(contactMs).moonPhaseAngleDeg,
  };
}

/** Per-scene worth of ONE event at ONE instant — `phase(α) · twilightGate(sunAlt)`. */
function worthAt(
  kind: BestSpotKind,
  contactMs: number,
  o: PlanObserver,
  scoring: BestSpotScoring = BESTSPOT_SCORING_V1,
): number {
  if (kindBody(kind) === "sun") return 1;
  return worthFromParts(kind, worthPartsAt(kind, contactMs, o), scoring);
}

/**
 * The plan's `M(kind, day)` as a standalone face: worth of the day's event, 0..1.
 *
 * `kind` defaults to `"moonrise"` because the scalar only ever varies for moon kinds — a sun kind
 * returns exactly 1 without touching the ephemeris. Returns **0** when the day carries no such
 * event (the moon skipped it): there is no event, so there is no worth, and `eventTrack` returns
 * `null` for the same day anyway.
 */
export function moonWorth(
  dayMs: number,
  observer: PlanObserver,
  kind: BestSpotKind = "moonrise",
  scoring: BestSpotScoring = BESTSPOT_SCORING_V1,
): number {
  if (kindBody(kind) === "sun") return 1;
  const t0 = eventInstantMs(kind, dayMs, observer);
  return t0 == null ? 0 : worthAt(kind, t0, observer, scoring);
}

// ---------------------------------------------------------------------------------------------
// The refracted event instant
// ---------------------------------------------------------------------------------------------

/**
 * The REFRACTED rise/set instant for the LOCAL SOLAR DAY containing `dayMs`, or `null` when the
 * day has no such event (pin 4). Local-day framing is `dayArc.localDayWindow` — the same window
 * `planner.dayEvents` uses, so a BEST SPOT day and an almanac chip can never disagree about which
 * day an event belongs to.
 *
 * T32 (pin 3): the observer elevation and the `metersAboveGround` argument BOTH come from the one
 * `planElevationsM` call, because `SearchRiseSet` subtracts the second from the first and runs the
 * difference through `Atmosphere()`.
 */
export function eventInstantMs(
  kind: BestSpotKind,
  dayMs: number,
  observer: PlanObserver,
): number | null {
  if (!Number.isFinite(dayMs)) return null;
  const { obsM, eyeM } = planElevationsM(observer);
  const obs = new Observer(observer.latDeg, observer.lonDeg, obsM);
  const { startMs, endMs } = localDayWindow(dayMs, observer.lonDeg);
  const found = SearchRiseSet(
    kindBody(kind) === "sun" ? Body.Sun : Body.Moon,
    obs,
    isRiseKind(kind) ? 1 : -1,
    new Date(startMs),
    (endMs - startMs) / DAY_MS,
    eyeM,
  );
  const ms = found?.date.getTime() ?? null;
  // Half-open window, exactly `dayEvents`' `inWindow`: a hit landing on the next day's boundary
  // belongs to the next day, which is what makes the moonrise count come out at 353 and not 366.
  return ms != null && ms >= startMs && ms < endMs ? ms : null;
}

// ---------------------------------------------------------------------------------------------
// The track
// ---------------------------------------------------------------------------------------------

/** Upper altitude edge of the window (deg, AIRLESS — the quantity the plan names). §3.1. */
const TRACK_TOP_ALT_DEG = 4;
/** How many disc RADII below the crossing altitude the window's lower edge sits. The lower
 *  extension exists so a LIFTED sheet or a cell on a bluff — both of which see a DEPRESSED
 *  horizon — can still be scored instead of falling off the end of the track. §3.1. */
const TRACK_BOTTOM_RHO = 3;
/** Azimuth sampling over the window (deg). §8: a solar disc (2ρ = 0.527°) spans ~2.1 columns, so a
 *  vertical building edge resolves to about half a disc — the honest limit, and it goes in the UI. */
const TRACK_AZ_STEP_DEG = 0.25;
/** Azimuth sampling over the shoulders (deg) — half the resolution, because the shoulders only
 *  ever feed running maxima (`F_notch`'s sL/sR) and the coverage term `C`, never the tangency
 *  kernel. §3.4/§8. */
const TRACK_SHOULDER_AZ_STEP_DEG = 0.5;
/** How far past EACH window edge the shoulders reach (deg). §3.4 measures the notch shoulders over
 *  `[az*−3°, az*−ρ]` and `[az*+ρ, az*+3°]`; `az*` sits at the low-altitude END of the window by
 *  construction, so covering 3° beyond BOTH edges is the superset that always contains them. */
const TRACK_SHOULDER_SPAN_DEG = 3;
/** e-folding scale of the altitude weight (deg). §3.1: `exp(−max(0, altApp)/2.5°)` — the last ~2°
 *  of the descent is what the photograph is about, and the +4° top of the window contributes ~20 %
 *  of a horizon sample rather than 0 (a hard cut would make the weight discontinuous at the edge).
 *
 *  The SHIPPED value; the live twin is `scoring.trackWeight.altScaleDeg`. It survives as the last
 *  fallback in `eventTrack` on purpose — the profile crosses `postMessage` (§5.6, "the profile rides
 *  the JOB"), and a structured clone of a hand-built partial must degrade to the shipped number
 *  rather than to `NaN` weights. */
const TRACK_WEIGHT_SCALE_DEG = 2.5;
/**
 * Weight floor, as a fraction (LENS B, 2026-08-24). The HORIZON CEILING below reaches exactly 0 once
 * the whole disc is under the observer's dip, and a zero-weight sample would silently vanish from
 * `C = Σ w·known / Σ w` — the honesty channel, which §3.4 defines over the FULL swept span. So the
 * ceiling is floored: 1e-3 is four orders below a window sample, i.e. invisible to `V`, while still
 * letting an unmapped shoulder register as ignorance rather than as nothing.
 *
 * It lives in `BESTSPOT_HONESTY` and is **not exposed on the tunable profile at all** (§5.5): the
 * only direction it could be moved is toward hiding ignorance, which is the one thing this feature
 * must never do.
 */
const TRACK_MIN_WEIGHT_FRACTION = BESTSPOT_HONESTY.minWeightFraction;
/** Terrestrial refraction coefficient for the eye-dip anchor — `PLAN.refractionK`, the surveyor's
 *  standard. Mirrored rather than imported so this module stays free of `components/`;
 *  `bestSpotTrack.test.ts` pins the two together. */
const TRACK_REFRACTION_K = 0.13;

/**
 * Area fraction of a disc lying ABOVE a horizontal cut `u` disc-RADII above its centre.
 * `(acos u − u√(1−u²))/π` — 1 at `u = −1`, exactly 0.5 at `u = 0`, 0 at `u = +1`.
 */
function discAboveFraction(u: number): number {
  if (u <= -1) return 1;
  if (u >= 1) return 0;
  return (Math.acos(u) - u * Math.sqrt(1 - u * u)) / Math.PI;
}

/**
 * The per-sample weight KERNEL — §3.1's altitude term times LENS B's horizon ceiling.
 *
 * ```
 * exp(−max(0, altApp)/scale)  ·  max(floor, discAboveFraction((dip − altApp)/ρ))
 * ```
 *
 * **WHY THE CEILING EXISTS (measured, and it is a blocker, not a polish).** §3.1's literal
 * `exp(−max(0, altApp)/2.5°)` does not decay below zero, so every sample of the lower extension and
 * of the bottom shoulder carried the SAME weight as the sun sitting on the horizon. On the real
 * 2026-08-24 Dnipro sunset that put **46.9 % of the normalised weight below a 1.7 m eye's own dip**,
 * where `f = 0` is guaranteed by the curvature of the earth for every ground cell on earth — so `V`
 * over a PERFECT open horizon came out **0.5138** against §10 S1's own ≥ 0.95 done-check, `G(V)` never
 * reached 1, and the best possible pedestrian cell rendered at `S ≈ 0.41`, which §6 calls
 * indistinguishable from the map.
 *
 * **WHY THIS SHAPE AND NOT AN e-FOLDING.** It has NO free scale: it is exactly the fraction of the
 * body a PERFECTLY OPEN eye could see at that instant, so it says "this instant is worth what is left
 * of the disc" rather than picking a decay rate by taste. `f(a) ≤ this` is a geometric identity, so
 * the weight can never suppress an instant the cell could actually have used.
 *
 * **WHY IT IS ANCHORED AT THE OBSERVER'S DIP AND NOT AT 0.** That is what keeps §3.1's lower extension
 * worth having: the anchor is −0.039° for a pedestrian, −0.599° at a 400 m sheet and −1.339° at
 * 2000 m, so a LIFTED eye keeps full weight exactly through the band it was extended for while a
 * pedestrian's tail dies. Anchoring at 0 would delete the lift story instead of paying it out.
 *
 * Exported so the kernel is pinnable at its endpoints without driving a whole almanac — the plan
 * gives §3.1's exponential as a literal, and a silently-changed weight profile is the kind of drift
 * that only ever shows up as "the map went quiet".
 */
export function trackWeightShape(
  altAppDeg: number,
  rhoDeg: number,
  dipDeg: number,
  weightScaleDeg: number,
  horizonCeiling: boolean = BESTSPOT_SCORING_V1.trackWeight.horizonCeiling,
): number {
  const above = Math.exp(-Math.max(0, altAppDeg) / weightScaleDeg);
  // The KILL SWITCH (`trackWeight.horizonCeiling`). OFF is §3.1's literal exponential, which is the
  // measured defect: 46.9 % of the normalised weight below a 1.7 m eye's own dip, `V = 0.5138` over
  // a PERFECT open horizon. It exists so that measurement stays reproducible, not to be shipped.
  if (!horizonCeiling) return above;
  if (!(rhoDeg > 0)) return above * (altAppDeg >= dipDeg ? 1 : TRACK_MIN_WEIGHT_FRACTION);
  const ceiling = discAboveFraction((dipDeg - altAppDeg) / rhoDeg);
  return above * Math.max(TRACK_MIN_WEIGHT_FRACTION, ceiling);
}

/** Coarse march step while hunting a window edge (ms). At Dnipro the body moves ~0.19° of azimuth
 *  and ~0.16° of altitude per minute, so one step can never jump a turning point unseen. */
const TRACK_MARCH_STEP_MS = MIN_MS;
/** Hard cap on how far a march may walk from `t0` (ms). At 64°N the +4° edge is already ~2.6 h out;
 *  6 h is generous for any event that is not simply degenerate, and it bounds the worst case. */
const TRACK_MARCH_CAP_MS = 6 * 3_600_000;
/** Bisection budget for a window edge. The real floor is NOT this number: `new Date(ms)` truncates
 *  to whole milliseconds, so every edge quantises to ±1 ms ≈ 3e-6° of azimuth however hard we
 *  bisect. 24 halvings of a 1-minute bracket reach that floor with room to spare. */
const TRACK_BISECT_ITERS = 24;
/** Hard ceiling on emitted samples. A grazing polar track can ask for thousands; the metric's cost
 *  is linear in this, so it is bounded rather than trusted. */
const TRACK_MAX_SAMPLES = 4096;
/** Below this many samples the track is not a track — return `null` rather than a stub (pin 4). */
const TRACK_MIN_SAMPLES = 5;

export interface EventTrackOptions {
  /** Azimuth step over the window (deg). Default `0.25` (§8); `0.125` is the desktop-high option. */
  azStepDeg?: number;
  /** Azimuth step over the shoulders (deg). Default `0.5`. */
  shoulderAzStepDeg?: number;
  /** How far past each window edge the shoulders reach (deg). Default `3`. */
  shoulderSpanDeg?: number;
  /** Upper (AIRLESS) altitude edge of the window (deg). Default `4`. */
  topAltDeg?: number;
  /** Lower window edge, in disc radii below the crossing altitude. Default `3`. */
  bottomRhoMultiple?: number;
  /** e-folding scale of the altitude weight (deg). Defaults to `scoring.trackWeight.altScaleDeg`
   *  (2.5) — an explicit value here still wins, so a test can pin the kernel without a profile. */
  weightScaleDeg?: number;
  /** Terrestrial refraction coefficient for the dip anchor. Default `0.13` (`PLAN.refractionK`). */
  refractionK?: number;
  /** Hard sample ceiling. Default `4096`. */
  maxSamples?: number;
  /**
   * Place every lattice point on an **ABSOLUTE** azimuth grid (`k · azStepDeg`, anchored at 0°)
   * instead of on a grid anchored at this day's own window edges. Default **false**.
   *
   * **WHY IT EXISTS — the residency ladder's T0.5 tier turns on it (SPEC_V2 §2.2).** The hulls are
   * eye-free and time-free, so a scene-time scrub inside one local day re-queries them for 0 ms.
   * But the SET OF AZIMUTHS is a function of the DAY: measured at Dnipro, +1 day moves `setAzDeg`
   * by −0.534°, and because the shipped lattice is anchored on the window edges, **exact azimuth
   * matches between consecutive days = 0 of 40.** Every hull is rebuilt for a one-day step. On the
   * absolute grid the two days' lattices are subsets of ONE lattice, so a hull cache keyed on the
   * snapped azimuth hits for everything the two windows share (measured 37 of 39, SPEC_V2 §2.2).
   *
   * **WHAT IT COSTS.** The shipped lattice puts its endpoints EXACTLY on the window edges and
   * spreads the interior uniformly; the absolute grid cannot, so the window loses up to one
   * `azStepDeg` at each end and the emitted `azDeg` is the LATTICE value rather than the
   * re-evaluated ephemeris azimuth (`utcMs` / `altAppDeg` / `rhoDeg` stay exact at the instant the
   * inversion returns, so the azimuth is exact and the ALTITUDE carries the ~1e-4° inversion error
   * instead — the swept ray is then at exactly the azimuth its hull was built for, which is what a
   * cache key needs). OFF by default so existing pins keep their spacing.
   *
   * It falls back to the relative lattice when the window is narrower than one `azStepDeg` (no
   * absolute point would land inside it) — a degenerate track must not become a `null` track.
   */
  snapAzLattice?: boolean;
  /**
   * The taste profile. Reaches exactly three things in this module: `trackWeight.altScaleDeg`,
   * `trackWeight.horizonCeiling` and the whole `worth.*` group. Everything else here is GEOMETRY
   * (the lattice, the marches, the inversion grid) and stays an `EventTrackOptions` field, because
   * changing it is a rebuild whatever the profile says.
   */
  scoring?: BestSpotScoring;
}

/** One raw ephemeris reading along the track, with azimuth kept CONTINUOUS (pin 5). */
interface TrackState {
  tMs: number;
  /** Unwrapped azimuth (deg) — may sit outside [0,360). */
  azUnwrapDeg: number;
  /** AIRLESS topocentric altitude of the body's centre (deg). */
  altAirlessDeg: number;
}

/** Shortest signed angular difference `a − b`, deg, in (−180, 180]. */
function deltaDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Wrap into [0,360) — the `AzAlt` contract shared with `bodies.horizontal()`. */
function wrap360(a: number): number {
  return ((a % 360) + 360) % 360;
}

/**
 * AIRLESS topocentric az/alt of the body at an instant, at the CLAMPED observer elevation.
 *
 * This is `bodies.horizontal()`'s recipe verbatim — `Equator(body, t, observer, ofdate=true,
 * aberration=true)` → `Horizon(t, observer, ra, dec)` with NO refraction argument, which is
 * airless by that module's stated contract (`bodies.ts:139`). The ONE difference is the Observer's
 * height: `horizontal()` pins it to 0, and this feature is driven by a live eye that reaches the
 * FPV ceiling. Reusing `horizontal()` would mean the rise/set search saw a 400 m observer while
 * the track saw a sea-level one — two elevations, which is the T32 defect shape. Widening
 * `horizontal()` itself is a `bodies.ts` change this slice does not own; the copy is fenced by a
 * unit test that asserts the two agree exactly at eye height 0.
 */
function airlessAzAlt(body: Body, tMs: number, obs: Observer): { azDeg: number; altDeg: number } {
  const t = new Date(tMs);
  const eq = Equator(body, t, obs, true, true);
  const hor = Horizon(t, obs, eq.ra, eq.dec);
  return { azDeg: hor.azimuth, altDeg: hor.altitude };
}

/**
 * Topocentric angular RADIUS of the disc (deg) at an instant.
 *
 * GEOCENTRIC distance, which is `sunEventFrame.ts:187`'s shipped recipe (`angularRadiusRad` over
 * `bodyStatesAt`) and reproduces the plan's own ranges — sun 0.262–0.271°, moon 0.245–0.279°.
 * HONESTY: at the horizon the topocentric moon is one earth radius further away, so its true disc
 * is up to ~1.7 % smaller than this — 0.004°, which is 1.6 % of one azimuth step and ~0.8 % of ρ.
 * Below every threshold this metric can express; recorded rather than silently corrected, because
 * changing it would move the pinned range.
 */
function rhoDegAt(body: Body, tMs: number): number {
  const s = bodyStatesAt(tMs);
  return body === Body.Sun
    ? angularRadiusRad(SUN_RADIUS_KM, s.sunDistanceAu * KM_PER_AU) * DEG_PER_RAD
    : angularRadiusRad(MOON_RADIUS_KM, s.moonDistanceKm) * DEG_PER_RAD;
}

/**
 * March away from `t0Ms` in one time direction until `progress` crosses zero, bisect the crossing,
 * and return that instant — OR, if the body TURNS OVER first in EITHER altitude or azimuth, return
 * the last instant that is still monotone in both.
 *
 * The turn guard is the whole reason this is a march and not a root-find. `SearchAltitude` is
 * documented-unreliable near a body's extremes (`planner.ts:8-9` says so about culminations), and
 * at Reykjavík on the solstice the sun's own minimum is only 0.75° below this window's floor — one
 * more step of extension and the track would fold back on itself, which silently breaks the
 * "exactly ONE crossing per swept ray" invariant the whole azimuth reparameterisation rests on.
 *
 * **BOTH COORDINATES, NOT JUST ALTITUDE (LENS B, 2026-08-24).** The guard used to watch
 * `altAirlessDeg` alone, which is a guard against the wrong extremum for the SHOULDER marches: those
 * ask for 3° of AZIMUTH, and outside the tropics-to-mid-latitude band the sun reaches its azimuth
 * extremum long before its altitude one. Measured: at lat 10–14° on the solstices the top shoulder
 * marched clean past the azimuth turning point near 26° of altitude, the inversion grid it produced
 * folded, and `eventTrack` returned `null` for a WINDOW that is perfectly monotone — `{
 * shoulderSpanDeg: 0 }` returned 6–7 samples and `{ shoulderSpanDeg: 0.5 }` returned 8–9 for the same
 * observer and day. An unreachable shoulder must TRUNCATE the span, never poison the track.
 *
 * `progress` must be NEGATIVE at `t0Ms` and become non-negative at the edge.
 */
function marchEdgeMs(
  stateAt: (tMs: number) => TrackState,
  t0Ms: number,
  sign: 1 | -1,
  progress: (s: TrackState) => number,
  stepMs: number,
  capMs: number,
): number {
  let prev = stateAt(t0Ms);
  let altUp: boolean | null = null;
  let azUp: boolean | null = null;
  for (let dt = stepMs; dt <= capMs; dt += stepMs) {
    const s = stateAt(t0Ms + sign * dt);
    if (altUp === null) altUp = s.altAirlessDeg > prev.altAirlessDeg;
    if (azUp === null) azUp = s.azUnwrapDeg > prev.azUnwrapDeg;
    const monotone =
      (altUp ? s.altAirlessDeg > prev.altAirlessDeg : s.altAirlessDeg < prev.altAirlessDeg) &&
      (azUp ? s.azUnwrapDeg > prev.azUnwrapDeg : s.azUnwrapDeg < prev.azUnwrapDeg);
    if (!monotone) return prev.tMs; // the body turned over — clamp, never extend past it
    if (progress(s) >= 0) {
      // Bisect in TIME between the last inside sample and this first outside one.
      let lo = prev.tMs;
      let hi = s.tMs;
      for (let i = 0; i < TRACK_BISECT_ITERS; i++) {
        const mid = (lo + hi) / 2;
        if (progress(stateAt(mid)) >= 0) hi = mid;
        else lo = mid;
      }
      return (lo + hi) / 2;
    }
    prev = s;
  }
  return prev.tMs; // cap reached — a very shallow track; the caller decides if it is usable
}

/**
 * Build the per-disc event track, or `null` if this day/observer has no usable event (pin 4).
 *
 * Shape of the work:
 *   1. `t0` — the REFRACTED instant from `SearchRiseSet`, through `planElevationsM` (pin 3).
 *   2. window — from AIRLESS `+topAltDeg` down to `alt(t0) − bottomRhoMultiple·ρ(t0)`, found by a
 *      monotone march + bisection so a polar grazing event clamps instead of folding.
 *   3. shoulders — `±shoulderSpanDeg` of AZIMUTH beyond each window edge, same march.
 *   4. a moderate time grid over the whole span, azimuth unwrapped along it, used to invert
 *      `az(t)` by linear interpolation at ~half an azimuth step — then every emitted sample is
 *      RE-EVALUATED exactly at its own instant, so `utcMs`/`azDeg`/`altAppDeg` are mutually exact
 *      and only the SPACING is approximate (which is all the plan asks for).
 *   5. weights `w = |dt/daz| · exp(−max(0, altApp)/scale)`, normalised to sum 1.
 */
export function eventTrack(
  observer: PlanObserver,
  kind: BestSpotKind,
  dayMs: number,
  opts: EventTrackOptions = {},
): (EventTrack & EventTrackWorthParts) | null {
  // The intersection is deliberate: `EventTrack`'s two worth fields are OPTIONAL (a fixture need not
  // supply them) but this PRODUCER always does, so callers of `eventTrack` get them non-optional.
  const scoring = opts.scoring ?? BESTSPOT_SCORING_V1;
  const azStep = Math.max(1e-3, opts.azStepDeg ?? TRACK_AZ_STEP_DEG);
  const shoulderStep = Math.max(1e-3, opts.shoulderAzStepDeg ?? TRACK_SHOULDER_AZ_STEP_DEG);
  const shoulderSpan = Math.max(0, opts.shoulderSpanDeg ?? TRACK_SHOULDER_SPAN_DEG);
  const topAlt = opts.topAltDeg ?? TRACK_TOP_ALT_DEG;
  const bottomRho = Math.max(0, opts.bottomRhoMultiple ?? TRACK_BOTTOM_RHO);
  const weightScale = Math.max(
    1e-6,
    opts.weightScaleDeg ?? scoring.trackWeight.altScaleDeg ?? TRACK_WEIGHT_SCALE_DEG,
  );
  const refractionK = opts.refractionK ?? TRACK_REFRACTION_K;
  const maxSamples = Math.max(TRACK_MIN_SAMPLES, opts.maxSamples ?? TRACK_MAX_SAMPLES);

  const t0Ms = eventInstantMs(kind, dayMs, observer);
  if (t0Ms == null) return null;

  const body = kindBody(kind) === "sun" ? Body.Sun : Body.Moon;
  const { obsM, eyeM } = planElevationsM(observer);
  const obs = new Observer(observer.latDeg, observer.lonDeg, obsM);
  // The DISC CENTRE's own geometric horizon (≤ 0). It anchors the below-horizon weight decay so a
  // lifted sheet keeps the samples §3.1's lower extension was added for (pin 3 hands us `eyeM`, the
  // same clamped eye the rise/set search saw — two elevations here would be the T32 defect shape).
  const dipDeg0 = horizonDipDeg(eyeM, refractionK);

  // Azimuth is unwrapped RELATIVE TO t0 throughout, so the whole track shares one continuous
  // branch even when it crosses the 0°/360° seam (pin 5).
  const az0Raw = airlessAzAlt(body, t0Ms, obs).azDeg;
  const stateAt = (tMs: number): TrackState => {
    const p = airlessAzAlt(body, tMs, obs);
    return { tMs, azUnwrapDeg: az0Raw + deltaDeg(p.azDeg, az0Raw), altAirlessDeg: p.altDeg };
  };

  const s0 = stateAt(t0Ms);
  const rho0 = rhoDegAt(body, t0Ms);
  const bottomAlt = s0.altAirlessDeg - bottomRho * rho0;

  // Time direction in which the altitude RISES. `SearchRiseSet` was handed exactly this sign, so
  // it is definitional, not an inference about hemisphere or season.
  const upSign: 1 | -1 = isRiseKind(kind) ? 1 : -1;
  const downSign: 1 | -1 = upSign === 1 ? -1 : 1;

  const tTop = marchEdgeMs(
    stateAt,
    t0Ms,
    upSign,
    (s) => s.altAirlessDeg - topAlt,
    TRACK_MARCH_STEP_MS,
    TRACK_MARCH_CAP_MS,
  );
  const tBottom = marchEdgeMs(
    stateAt,
    t0Ms,
    downSign,
    (s) => bottomAlt - s.altAirlessDeg,
    TRACK_MARCH_STEP_MS,
    TRACK_MARCH_CAP_MS,
  );

  const uTop = stateAt(tTop).azUnwrapDeg;
  const uBottom = stateAt(tBottom).azUnwrapDeg;
  const tTopShoulder =
    shoulderSpan > 0
      ? marchEdgeMs(
          stateAt,
          tTop,
          upSign,
          (s) => Math.abs(s.azUnwrapDeg - uTop) - shoulderSpan,
          TRACK_MARCH_STEP_MS,
          TRACK_MARCH_CAP_MS,
        )
      : tTop;
  const tBottomShoulder =
    shoulderSpan > 0
      ? marchEdgeMs(
          stateAt,
          tBottom,
          downSign,
          (s) => Math.abs(s.azUnwrapDeg - uBottom) - shoulderSpan,
          TRACK_MARCH_STEP_MS,
          TRACK_MARCH_CAP_MS,
        )
      : tBottom;

  // ── The inversion grid ────────────────────────────────────────────────────────────────────
  // Step sized to about HALF an azimuth step, from the azimuth rate measured at t0, so the linear
  // az→t inversion below is second-order accurate over a bracket narrower than one sample gap.
  const azRateDegPerMs =
    Math.abs(
      deltaDeg(
        airlessAzAlt(body, t0Ms + TRACK_MARCH_STEP_MS, obs).azDeg,
        airlessAzAlt(body, t0Ms - TRACK_MARCH_STEP_MS, obs).azDeg,
      ),
    ) /
    (2 * TRACK_MARCH_STEP_MS);
  if (!(azRateDegPerMs > 0)) return null; // a body standing still in azimuth cannot be reparameterised

  const gridLoMs = Math.min(tTopShoulder, tBottomShoulder);
  const gridHiMs = Math.max(tTopShoulder, tBottomShoulder);
  const gridStepMs = (azStep / 2) / azRateDegPerMs;
  // Capped at 4 grid points per emitted sample: the grid is the only unbounded allocation here, and
  // a grazing polar track combined with a fine `azStepDeg` could otherwise ask for millions.
  const gridN = Math.min(
    4 * maxSamples,
    Math.max(4, Math.ceil((gridHiMs - gridLoMs) / gridStepMs) + 1),
  );
  const gridT = new Float64Array(gridN);
  const gridU = new Float64Array(gridN);
  for (let i = 0; i < gridN; i++) {
    const t = gridLoMs + ((gridHiMs - gridLoMs) * i) / (gridN - 1);
    const s = stateAt(t);
    gridT[i] = t;
    gridU[i] = s.azUnwrapDeg;
  }
  // The grid is in TIME order; azimuth may run either way along it (northern vs southern
  // hemisphere — pin 5). Normalise to ASCENDING unwrapped azimuth so the inversion is one branch.
  const azAscendsWithTime = gridU[gridN - 1] > gridU[0];
  if (!azAscendsWithTime) {
    gridT.reverse();
    gridU.reverse();
  }
  for (let i = 1; i < gridN; i++) if (!(gridU[i] > gridU[i - 1])) return null; // az folded — degenerate

  /** `az(t)` inverted by linear interpolation on the ascending grid. */
  const timeAtAz = (u: number): number => {
    if (u <= gridU[0]) return gridT[0];
    if (u >= gridU[gridN - 1]) return gridT[gridN - 1];
    let lo = 0;
    let hi = gridN - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (gridU[mid] <= u) lo = mid;
      else hi = mid;
    }
    const span = gridU[hi] - gridU[lo];
    const f = span > 0 ? (u - gridU[lo]) / span : 0;
    return gridT[lo] + (gridT[hi] - gridT[lo]) * f;
  };

  // ── The azimuth lattice: 0.25° over the window, 0.5° over the shoulders ───────────────────
  const uWinLo = Math.min(uTop, uBottom);
  const uWinHi = Math.max(uTop, uBottom);
  const uAllLo = gridU[0];
  const uAllHi = gridU[gridN - 1];
  if (!(uWinHi > uWinLo)) return null; // no azimuth sweep at all — degenerate

  // Endpoints are placed EXACTLY on the window edges and the interior is spread uniformly at
  // ~azStep, rather than stepping from one edge and appending the other: a stride that lands
  // 1e-4° short of the far edge would emit two samples at the same instant, whose central
  // difference `dt/daz` blows up. Shoulder points are counted OUTWARD from the window edges, so
  // the smallest gap anywhere in the lattice is one whole step.
  // `ceil`, not `round`: the step is a RESOLUTION GUARANTEE (§8 sizes it against the solar disc —
  // 2ρ = 0.527° must span ~2.1 columns), so the emitted spacing may come out finer than asked but
  // never coarser.
  //
  // EDGE_SLACK is not cosmetic. `new Date(ms)` TRUNCATES to whole milliseconds (ECMA `TimeClip`),
  // so no amount of bisection resolves an edge finer than one millisecond — ~3e-6° of azimuth at
  // Dnipro's 0.19°/min sweep. A bisected 3.000° shoulder therefore lands at 2.9999985°, and a
  // tight `floor` would silently drop the outermost shoulder step on BOTH sides (measured: 12
  // shoulder samples became 10, i.e. the ±3° the notch's sL/sR are defined over became ±2.5°).
  const EDGE_SLACK = 1e-3;
  const targets: number[] = [];
  // Parallel to `targets`. The window/shoulder split is carried as a FLAG rather than recovered later
  // by comparing azimuths against `uWinLo`/`uWinHi`: every emitted sample is re-evaluated at its own
  // instant, so its azimuth lands within the inversion error of its lattice point and an edge sample
  // could be classified either way. The metric drops the shoulders from `V` (bestSpotTypes pin 6), so
  // a one-sample misclassification at the window's low edge would silently move the very boundary the
  // marker exists to make explicit.
  const inWindow: boolean[] = [];

  // ── ABSOLUTE lattice (opt-in, `snapAzLattice`) ────────────────────────────────────────────
  // `Math.round(u/azStep)*azStep` stated as index arithmetic, so every emitted point is EXACTLY a
  // multiple of `azStep` and two different days produce SUBSETS OF ONE LATTICE — which is the only
  // thing that lets a hull cache survive a day step (SPEC_V2 §2.2: 0/40 matches without it).
  // 360/0.25 = 1440 is an integer, so the grid is also consistent modulo a full turn, and the
  // unwrapped branch (which may leave [0,360)) cannot shear it.
  const kWinLo = Math.ceil(uWinLo / azStep - EDGE_SLACK);
  const kWinHi = Math.floor(uWinHi / azStep + EDGE_SLACK);
  // Shoulders keep their own coarser spacing, expressed in WHOLE lattice units so they stay on the
  // same absolute grid: 0.5°/0.25° = 2. A non-integer ratio rounds, which costs a little shoulder
  // resolution and buys the cache hit — the shoulders only ever feed running maxima and `C`.
  const shoulderK = Math.max(1, Math.round(shoulderStep / azStep));
  // A window narrower than one step has no absolute point inside it. Falling back is not a silent
  // degradation: an option must never turn a real track into `null`.
  const snapAz = (opts.snapAzLattice ?? false) && kWinHi > kWinLo;

  if (snapAz) {
    // The shoulders are anchored at ABSOLUTE MULTIPLES of `shoulderK` too, not counted outward from
    // this day's own window edge. Anchoring them on `kWinLo` reintroduces the very defect the snap
    // exists to fix, one level down: `kWinLo` moves ~2.14 lattice units per day, so an odd shift
    // flips the shoulders' parity and they share NOTHING with the day before. Measured at Dnipro:
    // window-anchored shoulders share 31 of 38 azimuths, absolute shoulders share 37.
    const floorTo = (k: number): number => Math.floor(k / shoulderK) * shoulderK;
    const loLimitK = uAllLo / azStep - EDGE_SLACK;
    const loShoulderKs: number[] = [];
    for (let k = floorTo(kWinLo - 1); k >= loLimitK; k -= shoulderK) loShoulderKs.push(k);
    for (let i = loShoulderKs.length - 1; i >= 0; i--) {
      targets.push(loShoulderKs[i] * azStep);
      inWindow.push(false);
    }
    for (let k = kWinLo; k <= kWinHi; k++) {
      targets.push(k * azStep);
      inWindow.push(true);
    }
    const hiLimitK = uAllHi / azStep + EDGE_SLACK;
    for (let k = floorTo(kWinHi + shoulderK); k <= hiLimitK; k += shoulderK) {
      targets.push(k * azStep);
      inWindow.push(false);
    }
  } else {
    const nLoShoulder = Math.max(0, Math.floor((uWinLo - uAllLo) / shoulderStep + EDGE_SLACK));
    for (let k = nLoShoulder; k >= 1; k--) {
      targets.push(uWinLo - k * shoulderStep);
      inWindow.push(false);
    }
    const nWin = Math.max(1, Math.ceil((uWinHi - uWinLo) / azStep - EDGE_SLACK));
    for (let i = 0; i <= nWin; i++) {
      targets.push(uWinLo + ((uWinHi - uWinLo) * i) / nWin);
      inWindow.push(true);
    }
    const nHiShoulder = Math.max(0, Math.floor((uAllHi - uWinHi) / shoulderStep + EDGE_SLACK));
    for (let k = 1; k <= nHiShoulder; k++) {
      targets.push(uWinHi + k * shoulderStep);
      inWindow.push(false);
    }
  }
  if (targets.length > maxSamples) {
    // Decimate uniformly rather than truncate: a truncated track loses one whole shoulder, and the
    // notch's sL/sR are measured on BOTH sides of az*. Both ENDS are kept exactly, so the swept
    // span — which is what the coverage term `C` is integrated over — does not silently shrink.
    const last = targets.length - 1;
    const thinned: number[] = [];
    const thinnedWin: boolean[] = [];
    for (let i = 0; i < maxSamples; i++) {
      const j = Math.round((i * last) / (maxSamples - 1));
      thinned.push(targets[j]);
      thinnedWin.push(inWindow[j]);
    }
    targets.length = 0;
    inWindow.length = 0;
    targets.push(...thinned);
    inWindow.push(...thinnedWin);
  }

  // ── Emit: every sample re-evaluated EXACTLY at its own instant ────────────────────────────
  const raw: {
    tMs: number;
    azUnwrapDeg: number;
    altAppDeg: number;
    rhoDeg: number;
    win: boolean;
  }[] = [];
  for (let ti = 0; ti < targets.length; ti++) {
    const u = targets[ti];
    const tMs = timeAtAz(u);
    const p = airlessAzAlt(body, tMs, obs);
    // SNAPPED: the azimuth IS the lattice point (that is the whole contract — a hull cache keyed on
    // an azimuth that is only APPROXIMATELY the swept one is not a cache). The ~1e-4° inversion
    // residual moves onto the altitude instead, which is 4e-4 of one azimuth step.
    const azUnwrapDeg = snapAz ? u : az0Raw + deltaDeg(p.azDeg, az0Raw);
    // STRICT ascent is a contract, not a hope: a lattice point that clamps onto a grid end (or a
    // re-evaluation that lands a nanodegree behind its predecessor) would otherwise produce a
    // zero-width central difference and an infinite weight.
    if (raw.length > 0 && !(azUnwrapDeg > raw[raw.length - 1].azUnwrapDeg + 1e-9)) continue;
    // …and on the snapped path the azimuths are strictly ascending BY CONSTRUCTION, so the guard
    // above can no longer catch the case it was written for: two lattice points whose instants both
    // CLAMPED onto the same end of the inversion grid. `dt = 0` there, which is a zero weight and a
    // sample claiming an azimuth it was never at.
    if (snapAz && raw.length > 0 && tMs === raw[raw.length - 1].tMs) continue;
    raw.push({
      tMs,
      azUnwrapDeg,
      altAppDeg: apparentAltDeg(p.altDeg),
      rhoDeg: rhoDegAt(body, tMs),
      win: inWindow[ti],
    });
  }
  if (raw.length < TRACK_MIN_SAMPLES) return null;

  // ── Strict-ordering guard ─────────────────────────────────────────────────────────────────
  // The marches already stop at the body's turning point, so this normally keeps everything. It
  // exists because a MALFORMED track is worse than a short one: `az*` is defined as "the LARGEST a
  // with f(a) ≥ 0.5" and the notch's running maxima sweep in azimuth order — both silently return
  // the wrong answer on a track that folds back, and neither would throw. Grow outward from the
  // sample nearest `t0` (which is interior by construction) while both orders hold.
  let pivot = 0;
  for (let i = 1; i < raw.length; i++) {
    if (Math.abs(raw[i].tMs - t0Ms) < Math.abs(raw[pivot].tMs - t0Ms)) pivot = i;
  }
  const altRises =
    pivot + 1 < raw.length
      ? raw[pivot + 1].altAppDeg > raw[pivot].altAppDeg
      : raw[pivot].altAppDeg > raw[pivot - 1].altAppDeg;
  const ordered = (a: number, b: number): boolean => (altRises ? b > a : b < a);
  let lo = pivot;
  let hi = pivot;
  while (
    lo > 0 &&
    raw[lo].azUnwrapDeg > raw[lo - 1].azUnwrapDeg &&
    ordered(raw[lo - 1].altAppDeg, raw[lo].altAppDeg)
  )
    lo--;
  while (
    hi + 1 < raw.length &&
    raw[hi + 1].azUnwrapDeg > raw[hi].azUnwrapDeg &&
    ordered(raw[hi].altAppDeg, raw[hi + 1].altAppDeg)
  )
    hi++;
  const kept = raw.slice(lo, hi + 1);
  if (kept.length < TRACK_MIN_SAMPLES) return null;

  // ── Weights ───────────────────────────────────────────────────────────────────────────────
  // `w = |dt/daz| · trackWeightShape(altApp, ρ, dip0, scale)`, normalised to sum 1. `|dt/daz|` is a
  // central difference, so an azimuth-indexed sum still integrates over TIME; the shape is §3.1's
  // `exp(−max(0, altApp)/2.5°)` times LENS B's HORIZON CEILING (see that function for the 46.9 %
  // measurement that made it necessary).
  // NOTE the plan's literal form carries the DENSITY |dt/daz| and not the quadrature width Δaz, so a
  // 0.5°-spaced shoulder sample counts for the same time as a 0.25°-spaced window one rather than
  // double — deliberate here (the shoulders exist for the notch, not for the visibility integral),
  // and pinned by a test.
  const n = kept.length;
  const w = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = kept[Math.max(0, i - 1)];
    const b = kept[Math.min(n - 1, i + 1)];
    const dAz = b.azUnwrapDeg - a.azUnwrapDeg;
    const dt = Math.abs(b.tMs - a.tMs);
    const density = dAz > 0 ? dt / dAz : 0;
    const wi =
      density *
      trackWeightShape(
        kept[i].altAppDeg,
        kept[i].rhoDeg,
        dipDeg0,
        weightScale,
        scoring.trackWeight.horizonCeiling,
      );
    w[i] = wi;
    sum += wi;
  }
  if (!(sum > 0)) return null;

  const samples: TrackSample[] = kept.map((s, i) => ({
    utcMs: s.tMs,
    azDeg: wrap360(s.azUnwrapDeg),
    altAppDeg: s.altAppDeg,
    rhoDeg: s.rhoDeg,
    w: w[i] / sum,
  }));

  // Window markers (bestSpotTypes pin 6). The window always emits at least two lattice points, so a
  // track that survives the ordering guard with no window sample left is structurally impossible —
  // but if the guard ever trims one away, "the whole span is window" is the conservative reading (it
  // restores the pre-marker behaviour rather than silently emptying `V`).
  let windowLo = kept.findIndex((s) => s.win);
  let windowHi = -1;
  for (let i = kept.length - 1; i >= 0; i--) {
    if (kept[i].win) {
      windowHi = i;
      break;
    }
  }
  if (windowLo < 0 || windowHi < 0) {
    windowLo = 0;
    windowHi = kept.length - 1;
  }

  // §5.3(b): the two readings ride ALONG with the resolved worth, so a later profile change can
  // recompute `M` without touching the ephemeris — the whole `worth.*` group is then a recompose
  // (0.272 ms) instead of a rebuild (490 ms).
  const worthParts = worthPartsAt(kind, t0Ms, observer);

  return {
    kind,
    t0Ms,
    samples,
    windowLo,
    windowHi,
    setAzDeg: wrap360(az0Raw),
    worth: worthFromParts(kind, worthParts, scoring),
    sunAltAtT0Deg: worthParts.sunAltAtT0Deg,
    moonPhaseAngleDeg: worthParts.moonPhaseAngleDeg,
  };
}

/**
 * The track's azimuths made CONTINUOUS (pin 5): `azDeg` is wrapped into [0,360) by contract, so a
 * track that crosses the 0°/360° seam looks non-monotone to anyone who reads the raw field. This
 * returns the same sequence on one branch, anchored at the FIRST sample, so `u[i] > u[i-1]` holds
 * for every real track and a consumer can difference azimuths without a wrap test.
 *
 * A Tromsø midsummer sunset really does sweep 316° → 404°; assuming otherwise is the bug this
 * exists to make impossible.
 */
export function unwrapTrackAzDeg(samples: readonly { azDeg: number }[]): number[] {
  const out: number[] = [];
  let u = samples.length > 0 ? samples[0].azDeg : 0;
  for (let i = 0; i < samples.length; i++) {
    if (i > 0) u += deltaDeg(samples[i].azDeg, samples[i - 1].azDeg);
    out.push(u);
  }
  return out;
}
