/**
 * THE MOON'S PERCEIVED VISIBILITY (T200, owner 2026-10-25e) — "is it optically worth it?"
 *
 * The planner's rise / set row and the radar say WHEN and WHERE the moon is; this answers WHETHER
 * it will read in the frame: a thin crescent at civil dusk, a full moon low in the haze at 06:00,
 * a quarter moon against a noon sky. Pure, three-free, DOM-free; cheap enough for a UI memo
 * keyed to the minute, never for a per-frame call (the renderer takes its own two scalars from
 * the same curves — `scene/sky.ts`).
 *
 * The physics, each piece sourced (every number below carries its source; the SOFT ones are
 * named at the bottom):
 *  · APPARENT MAGNITUDE by phase angle α — Krisciunas & Schaefer 1991 (PASP 103, 1033) eq. 9,
 *    from Allen 1976: m = −12.73 + 0.026·|α| + 4e−9·α⁴ at the mean distance (384,400 km); the
 *    opposition surge (+35 % at α = 0, K&S §2) ramped in over the last 7°; distance by inverse
 *    square. A quarter moon is ~11× dimmer than full, not 50 %.
 *  · AIRMASS — Kasten & Young 1989 (`lib/globe/duskLight.airMass`, the sun's own; ~38 at the
 *    horizon, 5.6 at 10°, 2.0 at 30°).
 *  · EXTINCTION + REDDENING — Schaefer 1998 (S&T; the Bogan port) sea-level magnitudes per
 *    airmass: Rayleigh 0.1066·(λ/550 nm)⁻⁴ + aerosol 0.1·(λ/550 nm)⁻¹·³ + ozone (V 0.031):
 *    B 0.368 · G 0.238 · R 0.155 at 450 / 550 / 650 nm. The blue scatters out first — the low
 *    moon loses ~1.3 mag at 10° and turns orange; its TINT is the per-channel transmittance
 *    normalised to the red. Rayleigh scales with the site's elevation as e^(−h/8200 m), aerosol
 *    as e^(−h/1500 m) (Schaefer 1998).
 *  · THE LIT AREA'S LUMINANCE — full moon 4.9e3 cd/m² outside the atmosphere (Allen / K&S;
 *    Schmidt 2009 measured 4.9–5.4e3 at α = 1.6° with the surge), scaled by the phase law and
 *    DIVIDED by the illuminated fraction: the eye resolves the lit sliver as the target, so the
 *    lit area's surface brightness is what competes with the sky, not the disc average.
 *  · THE SKY'S LUMINANCE by sun altitude (zenith-ish, cd/m²): daylight 2.7–9e3 (Preetham 1999,
 *    turbidity 2.5–3), the twilight ladder at 1 mag per degree of solar depression (Schaefer
 *    1998; Patat et al. 2006 measure 1.14 mag/deg at Paranal: −5° 2.0, −10° 0.011, −15° 3.3e−4),
 *    the dark-sky floor 2.3e−4 (21.7 mag/arcsec²; K&S 21.8–22.0). Log-interpolated.
 *  · THE EYE — Weber contrast C = L_lit·T / L_sky against Crumey 2014's fit of Blackwell 1946:
 *    C∞ = 2.72e−3 photopic (L ≥ 0.354 cd/m²), 7.633e−3·L^−¼ − 7.174e−3 scotopic, × a field
 *    factor 2.5 (the practical, not laboratory, threshold), × a thin-crescent penalty beyond
 *    α = 140° (a 1′ sliver is not a large target).
 *  · THE DANJON LIMIT — a crescent within 7.5° of the sun cannot be seen (Fatoohi et al. 1998).
 *
 * SOFT (±2–4×, named so a reader knows what moves the verdict): the daytime sky luminance; the
 * aerosol term (site + humidity); the field factor; the moon's zero point (±20 %); the crescent
 * penalty. None of them moves a verdict across more than one band in the worked cases.
 */
import { airMass } from "../globe/duskLight";
import { bodyStatesAt, horizontal, KM_PER_AU } from "./bodies";
import { TWILIGHT_DEG, type TwilightPhase } from "./twilight";

export interface MoonVisibilityInput {
  /** Sun–moon–earth phase angle, deg (0 full · 90 quarter · 180 new). */
  phaseAngleDeg: number;
  /** The moon's topocentric altitude, deg (airless). */
  moonAltDeg: number;
  /** The sun's altitude, deg (airless). */
  sunAltDeg: number;
  /** Sun–moon angular separation, deg. Defaults to 180 − phase angle (exact enough for the
   *  Danjon gate; the real elongation differs by the lunar parallax, ≤ 1°). */
  elongationDeg?: number;
  /** Geocentric distance, km (the inverse-square term). Default: the mean distance. */
  moonDistanceKm?: number;
  /** The observer's elevation above sea level, m (thins the air). Default 0. */
  siteAltM?: number;
  /** A lunar-eclipse dimming of the lit area (1 = none; the umbra's `ECLIPSE.umbraLight`). */
  eclipseDim?: number;
}

/** Brightest → darkest story, then the two geometric refusals. */
export type MoonVerdict =
  | "bright" // the moon owns the sky — night, deep twilight
  | "clear" // plainly visible, well above the sky — a dusk full moon, a young crescent after sunset
  | "pale" // visible but washed — the daytime moon, a crescent in bright twilight
  | "faint" // at the edge of seeing — a sliver in daylight, a low moon in thick haze
  | "lost" // below the eye's threshold against this sky
  | "sunward" // inside the Danjon limit — too close to the sun
  | "below"; // under the horizon

export interface MoonVisibility {
  verdict: MoonVerdict;
  /** Short ALL-CAPS badge text (≤ 13 chars) — the row / badge grammar. */
  label: string;
  /** One sentence-case clause for a title / aria: the sky state and what limits the read. */
  reason: string;
  /** The sky's state by the sun's altitude (USNO bands). */
  sky: TwilightPhase;
  /** Visual magnitude outside the atmosphere (phase + distance). */
  apparentMag: number;
  /** …and as seen through the air at this altitude. */
  observedMag: number;
  airmass: number;
  /** Magnitudes lost to the atmosphere in V (green). */
  extinctionMag: number;
  /** Per-channel transmittance (r, g, b), absolute (1 = outside the atmosphere). */
  transmittance: [number, number, number];
  /** The reddening tint: transmittance normalised to its peak channel — (1, 1, 1) is white. */
  tint: [number, number, number];
  /** Luminance of the LIT area after extinction, cd/m². */
  moonLuminance: number;
  /** Background sky luminance in the moon's direction, cd/m². */
  skyLuminance: number;
  /** Weber contrast L_lit·T / L_sky — the perceived visibility proper (the airlight adds to the disc). */
  contrast: number;
  /** The eye's practical contrast threshold against this sky. */
  threshold: number;
  /** contrast / threshold — < 1 is invisible. */
  score: number;
  illuminatedFraction: number;
}

// ── constants ────────────────────────────────────────────────────────────────────────────────
/** Allen / K&S 1991 eq. 9 at the mean distance. */
const MAG_FULL = -12.73;
const MEAN_DISTANCE_KM = 384_400;
/** K&S §2: "when exactly full it is about 35 % brighter" than the polynomial, over |α| < 7°. */
const OPPOSITION_SURGE = 0.35;
const OPPOSITION_DEG = 7;
/** Schaefer 1998 sea-level extinction, mag / airmass, at ≈ 650 / 550 / 450 nm (r, g, b). */
const RAYLEIGH_MAG = [0.055, 0.1066, 0.238] as const;
const AEROSOL_MAG = [0.081, 0.1, 0.13] as const;
const OZONE_MAG = [0.02, 0.031, 0] as const;
/** The lit area's surface brightness at full, outside the atmosphere (cd/m²). */
const FULL_MOON_LUMINANCE = 4_900;
/** Twilight ladder — (sun altitude °, cd/m²). Daylight: Preetham 1999 zenith at turbidity
 *  2.5–3; 0 → −18°: Schaefer 1998 / Patat 2006; the floor 21.7 mag/arcsec². */
const SKY_LADDER: readonly (readonly [number, number])[] = [
  [60, 9_000],
  [30, 4_700],
  [10, 2_700],
  [5, 1_000],
  [0, 150],
  [-3, 7.2],
  [-6, 0.44],
  [-9, 0.027],
  [-12, 1.9e-3],
  [-15, 3.3e-4],
  [-18, 2.3e-4],
];
/** Crumey 2014 (Blackwell 1946): the large-target 50 % threshold. */
const PHOTOPIC_FLOOR_CDM2 = 0.354;
const C_PHOTOPIC = 2.72e-3;
/** A practical field factor over the laboratory threshold (Crumey's age / field multipliers). */
const FIELD_FACTOR = 2.5;
/** Fatoohi et al. 1998: the Danjon limit. */
export const DANJON_LIMIT_DEG = 7.5;
/** A disc below the refracted horizon (−34′) is not up; a little slack for the airless input. */
const BELOW_DEG = -0.5;

const DEG = Math.PI / 180;

// ── pieces (exported for the tests and the renderer's own twin) ───────────────────────────────
/** Visual magnitude outside the atmosphere: the K&S polynomial + the opposition surge + distance. */
export function moonApparentMag(phaseAngleDeg: number, moonDistanceKm = MEAN_DISTANCE_KM): number {
  const a = Math.min(Math.max(Math.abs(phaseAngleDeg), 0), 180);
  let m = MAG_FULL + 0.026 * a + 4e-9 * a ** 4;
  if (a < OPPOSITION_DEG) m -= 2.5 * Math.log10(1 + OPPOSITION_SURGE * (1 - a / OPPOSITION_DEG));
  return m + 5 * Math.log10(Math.max(1, moonDistanceKm) / MEAN_DISTANCE_KM);
}

/** Sea-level extinction per channel (mag / airmass), thinned for the site's elevation. */
export function extinctionMagPerAirmass(siteAltM = 0): [number, number, number] {
  const h = Math.max(0, siteAltM);
  const ray = Math.exp(-h / 8_200);
  const aer = Math.exp(-h / 1_500);
  return [0, 1, 2].map((i) => RAYLEIGH_MAG[i] * ray + AEROSOL_MAG[i] * aer + OZONE_MAG[i]) as [
    number,
    number,
    number,
  ];
}

/** Per-channel transmittance through `airmass` airmasses, absolute. */
export function moonTransmittance(moonAltDeg: number, siteAltM = 0): {
  airmass: number;
  transmittance: [number, number, number];
} {
  const X = airMass(Math.max(moonAltDeg, -1.5));
  const k = extinctionMagPerAirmass(siteAltM);
  return {
    airmass: X,
    transmittance: [10 ** (-0.4 * k[0] * X), 10 ** (-0.4 * k[1] * X), 10 ** (-0.4 * k[2] * X)],
  };
}

/** The background sky in cd/m² for a sun altitude — the ladder, log-interpolated, clamped. */
export function skyLuminanceAt(sunAltDeg: number): number {
  const top = SKY_LADDER[0];
  const bot = SKY_LADDER[SKY_LADDER.length - 1];
  if (sunAltDeg >= top[0]) return top[1];
  if (sunAltDeg <= bot[0]) return bot[1];
  for (let i = 0; i < SKY_LADDER.length - 1; i++) {
    const [a0, l0] = SKY_LADDER[i];
    const [a1, l1] = SKY_LADDER[i + 1];
    if (sunAltDeg <= a0 && sunAltDeg >= a1) {
      const t = (a0 - sunAltDeg) / (a0 - a1);
      return 10 ** (Math.log10(l0) + (Math.log10(l1) - Math.log10(l0)) * t);
    }
  }
  return bot[1];
}

/** Crumey 2014's large-target threshold at a sky luminance, × the practical field factor. */
export function contrastThreshold(skyLuminance: number, phaseAngleDeg: number): number {
  const L = Math.max(skyLuminance, 1e-6);
  const cInf =
    L >= PHOTOPIC_FLOOR_CDM2 ? C_PHOTOPIC : Math.max(C_PHOTOPIC, 7.633e-3 * L ** -0.25 - 7.174e-3);
  // A thin crescent is a sliver ~31′·k wide — not the large target the fit assumes.
  const a = Math.abs(phaseAngleDeg);
  const crescent = a > 140 ? 1 + (a - 140) / 10 : 1;
  return cInf * FIELD_FACTOR * crescent;
}

function phaseOfSun(sunAltDeg: number): TwilightPhase {
  if (sunAltDeg >= TWILIGHT_DEG.day) return "day";
  if (sunAltDeg >= TWILIGHT_DEG.civil) return "civil";
  if (sunAltDeg >= TWILIGHT_DEG.nautical) return "nautical";
  if (sunAltDeg >= TWILIGHT_DEG.astro) return "astro";
  return "night";
}

const SKY_WORDS: Record<TwilightPhase, string> = {
  day: "daylight",
  civil: "civil twilight",
  nautical: "nautical twilight",
  astro: "astronomical twilight",
  night: "night",
};

const LABELS: Record<MoonVerdict, string> = {
  bright: "BRIGHT",
  clear: "CLEAR",
  pale: "PALE",
  faint: "FAINT",
  lost: "LOST IN SKY",
  sunward: "NEAR THE SUN",
  below: "BELOW HORIZON",
};

// ── the model ────────────────────────────────────────────────────────────────────────────────
export function moonVisibility(input: MoonVisibilityInput): MoonVisibility {
  const a = Math.min(Math.max(Math.abs(input.phaseAngleDeg), 0), 180);
  const elong = input.elongationDeg ?? 180 - a;
  const k = (1 + Math.cos(a * DEG)) / 2;
  const sky = phaseOfSun(input.sunAltDeg);
  const apparentMag = moonApparentMag(a, input.moonDistanceKm);
  const { airmass, transmittance } = moonTransmittance(input.moonAltDeg, input.siteAltM);
  const peak = Math.max(transmittance[0], transmittance[1], transmittance[2], 1e-9);
  const tint: [number, number, number] = [
    transmittance[0] / peak,
    transmittance[1] / peak,
    transmittance[2] / peak,
  ];
  const extinctionMag = -2.5 * Math.log10(Math.max(transmittance[1], 1e-12));
  const observedMag = apparentMag + extinctionMag;

  // The LIT area's luminance: the phase law's flux over the lit fraction, through the air.
  const fluxRel = 10 ** (-0.4 * (apparentMag - MAG_FULL));
  const litRel = fluxRel / Math.max(k, 1e-3);
  const eclipseDim = input.eclipseDim ?? 1;
  const moonLuminance = FULL_MOON_LUMINANCE * litRel * transmittance[1] * eclipseDim;

  // The sky in the moon's direction: the ladder (zenith-ish) × a horizon-haze lift by day
  // (the daytime horizon sky is ~2× the zenith) × a sunward lift in twilight (a crescent sits
  // in the sunset glow: ~5× within 20° of the sun, nothing beyond 60°).
  const dayW = Math.min(1, Math.max(0, (input.sunAltDeg + 3) / 6)); // 0 at −3°, 1 at +3°
  const hazeK = 1 + 1.5 * Math.exp(-Math.max(input.moonAltDeg, 0) / 10) * dayW;
  // Full in twilight; by day the solar aureole still lifts the sky near the sun (Schaefer's
  // F(ρ)), so it eases to half rather than vanishing; gone once the sky is dark.
  const twiW =
    input.sunAltDeg <= 0
      ? Math.min(1, Math.max(0, (input.sunAltDeg + 14) / 4)) // 1 above −10°, 0 by −14°
      : 1 - 0.5 * Math.min(1, input.sunAltDeg / 10);
  const sunwardK = 1 + 9 * Math.max(0, 1 - elong / 60) ** 2 * twiW;
  const skyLuminance = skyLuminanceAt(input.sunAltDeg) * hazeK * sunwardK;

  // The sky's airlight sits IN FRONT of the disc and adds to it, so the seen disc is L_lit·T + L_sky
  // and the Weber contrast against the sky is simply L_lit·T / L_sky (K&S 1991; Crumey 2014).
  const contrast = moonLuminance / skyLuminance;
  const threshold = contrastThreshold(skyLuminance, a);
  const score = contrast / threshold;

  let verdict: MoonVerdict;
  if (input.moonAltDeg < BELOW_DEG) verdict = "below";
  else if (elong < DANJON_LIMIT_DEG) verdict = "sunward";
  else if (score < 1) verdict = "lost";
  else if (score < 5) verdict = "faint";
  else if (contrast < 1) verdict = "pale";
  else if (contrast < 20) verdict = "clear";
  else verdict = "bright";

  // The reason: the sky's state, then what limits the read (the haze first — it is the one a
  // planner can wait out by half an hour).
  const parts: string[] = [];
  if (verdict === "below") parts.push(`${Math.abs(input.moonAltDeg).toFixed(0)}° under the horizon`);
  else if (verdict === "sunward") parts.push(`${elong.toFixed(0)}° from the sun — inside the Danjon limit`);
  else {
    parts.push(SKY_WORDS[sky]);
    if (input.moonAltDeg < 4) parts.push(`very low — ${extinctionMag.toFixed(1)} mag lost in the haze, deep orange`);
    else if (input.moonAltDeg < 10) parts.push(`low in haze — ${extinctionMag.toFixed(1)} mag lost, orange`);
    else if (input.moonAltDeg < 20 && tint[2] < 0.75) parts.push("a warm tint low in the sky");
    if (a > 150) parts.push("a thin crescent");
    else if (a > 120) parts.push("a crescent");
    if (verdict === "lost" || verdict === "faint") parts.push(`the lit limb is ${contrast < 0.01 ? "under 1 %" : `${(contrast * 100).toFixed(0)} %`} over the sky`);
    else if (verdict === "pale") parts.push(`the lit limb is ${(contrast * 100).toFixed(0)} % over the sky — washed, not hidden`);
  }
  return {
    verdict,
    label: LABELS[verdict],
    reason: parts.join(" · "),
    sky,
    apparentMag,
    observedMag,
    airmass,
    extinctionMag,
    transmittance,
    tint,
    moonLuminance,
    skyLuminance,
    contrast,
    threshold,
    score,
    illuminatedFraction: k,
  };
}

/**
 * The verdict at one instant for an observer — the UI's call (three `horizontal()`-class
 * ephemeris reads: memoise per minute, never per frame). Airless topocentric altitudes, the
 * real phase angle and distance, the real elongation from the geocentric vectors.
 */
export function moonVisibilityAt(
  utcMs: number,
  latDeg: number,
  lonDeg: number,
  opts: { siteAltM?: number; eclipseDim?: number } = {},
): MoonVisibility {
  const s = bodyStatesAt(utcMs);
  const moon = horizontal("moon", utcMs, latDeg, lonDeg);
  const sun = horizontal("sun", utcMs, latDeg, lonDeg);
  const dot =
    s.sunDir[0] * s.moonDir[0] + s.sunDir[1] * s.moonDir[1] + s.sunDir[2] * s.moonDir[2];
  const elongationDeg = Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
  return moonVisibility({
    phaseAngleDeg: s.moonPhaseAngleDeg,
    moonAltDeg: moon.altDeg,
    sunAltDeg: sun.altDeg,
    elongationDeg,
    moonDistanceKm: s.moonDistanceKm,
    siteAltM: opts.siteAltM,
    eclipseDim: opts.eclipseDim,
  });
}

/** `KM_PER_AU` re-exported for consumers that hold a distance in AU (the sky targets). */
export { KM_PER_AU };
