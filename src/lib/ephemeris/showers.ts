// Meteor showers (Phase 8c P7) — pure, three-free.
//
// The baked major-shower table + the activity model behind the METEORS card, the shower radiant
// as a tracked SkyTarget (`showerTarget` in targets.ts), and the rail intensity trace.
//
// DATA PROVENANCE (bake 2026-08-17, hand-curated — NOT Stellarium's GPL showers.json):
//   · λ☉ peaks, radiants, ZHR, r, activity dates — IMO Meteor Shower Calendar 2026, Table 5
//     (imo.net/files/meteor-shower/cal2026.pdf; "All λ☉ are given for the equinox 2000.0").
//   · Activity windows as λ☉ — computed from the Table-5 calendar dates (soft bounds, ±0.5°).
//   · Radiant drift (deg/DAY) — IMO cal2026 Table 6 five-day positions differenced,
//     cross-checked vs IAU MDC streamfulldata.txt dRa/dDe (ta3.sk IAUC22DB, 2022-02-28).
//   · Vg + parent bodies — IAU MDC (cite Jopek & Kaňuchová 2017; Jenniskens et al. 2020).
//   · Activity slopes B — Jenniskens 1994, A&A 287, 990 (Table 3b + in-text fits; slopes only —
//     that paper's λ values are equinox 1950 and were not used).
// Refresh path: re-read Table 5/6 of the next year's IMO calendar; rows carry inline caveats.
//
// CONVENTIONS (the honesty contract):
//   · Solar longitude λ☉ is referred to EQUINOX J2000 (the IMO/MDC standard). astronomy-engine's
//     `SunPosition()` is ecliptic OF DATE and runs ~0.37° early in 2026 (≈9 h of peak timing) —
//     λ☉ here rotates the EQJ sun vector into the J2000 ecliptic (`Rotation_EQJ_ECL`; verified:
//     March-2000 equinox → 0.001°, 2026-01-03 19:00 UT → 283.048° matching the QUA almanac).
//   · Visible rate = ZHR(λ☉) × sin(radiant alt) — the IMO zenith correction with γ = 1 (modern
//     IMO practice; Zvolánková's γ≈1.4 only matters at low altitude). ZHR is defined for LM 6.5
//     skies; no limiting-magnitude term here — the moon rides the SEPARATE night score below.
//   · ZHR(λ☉) = ZHR_peak · 10^(−B·|λ☉ − λ☉peak|) (Jenniskens 1994 Eq. 8), B per side for the
//     asymmetric showers (GEM rises shallow, drops fast), hard-clipped to the activity window;
//     default B = 0.19 (the characteristic high-inclination-stream slope — there is NO general
//     0.9). Variable/outburst showers (ZHR "Var") get no curve — the card prints their note.
//   · Night score = peak visible rate × (1 − moon interference), moon interference = the
//     mwSeason convention (K&S phase intensity at the peak sample while the moon is up, no
//     altitude scaling). CONVENTION NOTE: mwSeason scores MINUTES×(1−i); a meteor night is
//     rate-shaped, not duration-shaped — the two scores are not comparable and never mix.

import { Body, GeoVector, MakeTime, RotateVector, Rotation_EQJ_ECL } from "astronomy-engine";
import { bodyStatesAt, ecefFrameAt, horizontal } from "./bodies";
import { localDayWindow } from "./dayArc";
import { moonPhaseIntensity } from "./moonlight";
import type { PlanObserver } from "./planner";
import { topoAzAlt } from "./topo";

const DEG = Math.PI / 180;
/** Mean solar-longitude rate (deg/day) — Newton slope + drift-day conversion. */
const LAMBDA_DEG_PER_DAY = 360 / 365.2422;
/** Astronomical darkness — ZHR's LM 6.5 definition wants true dark (the mwSeason gate). */
export const SHOWER_DARK_SUN_DEG = -18;
/** Default activity slope B (Jenniskens 1994 §3: 0.19 ± 0.08 for high-inclination streams). */
const DEFAULT_B = 0.19;
const DAY_MS = 24 * 3600_000;

export interface ShowerRow {
  /** IAU MDC 3-letter code — also the target short name ("PER"). */
  code: string;
  name: string;
  /** Extra search keys beyond name/code. */
  aliases: string[];
  /** Activity window in solar longitude λ☉ (deg, J2000), start → end along the year. */
  lamStart: number;
  lamEnd: number;
  /** Peak solar longitude (deg, J2000) — date-invariant across years. */
  lamPeak: number;
  /** Radiant at peak, J2000 (deg). */
  raDeg: number;
  decDeg: number;
  /** Radiant drift (deg/DAY — the IMO Table-6 unit). */
  driftRa: number;
  driftDec: number;
  /** ZHR at peak — null for the "Var" outburst showers (no honest annual number exists). */
  zhr: number | null;
  /** Population index r. */
  rIndex: number;
  /** Geocentric velocity (km/s) — display only. */
  vgKmS: number;
  /** Parent body — display only; null where the MDC leaves it blank. */
  parent: string | null;
  /** Activity slope B per side of the peak (10^(−B·|Δλ|)); omit → DEFAULT_B. */
  bAsc?: number;
  bDesc?: number;
  /** Variable/outburst caveat the card prints verbatim (sentence case). */
  note?: string;
}

/**
 * The IMO working-list majors (every row an established IAU MDC shower), ordered by peak along
 * the calendar year. 21 rows — the full visual working list, not just the famous six.
 */
export const SHOWERS: readonly ShowerRow[] = [
  {
    code: "QUA",
    name: "Quadrantids",
    aliases: ["quads"],
    lamStart: 276.1,
    lamEnd: 292.4,
    lamPeak: 283.15,
    raDeg: 230,
    decDeg: 49,
    driftRa: 0.6,
    driftDec: -0.2,
    zhr: 80,
    rIndex: 2.1,
    vgKmS: 41.4,
    parent: "(196256) 2003 EH1",
    bAsc: 1.4,
    bDesc: 2.2,
    note: "Sharp ~8-hour core — the night matters more than the week.",
  },
  {
    code: "LYR",
    name: "Lyrids",
    aliases: ["april lyrids"],
    lamStart: 23.7,
    lamEnd: 40.3,
    lamPeak: 32.32,
    raDeg: 271,
    decDeg: 34,
    driftRa: 1.1,
    driftDec: 0.0,
    zhr: 18,
    rIndex: 2.1,
    vgKmS: 46.6,
    parent: "C/1861 G1 (Thatcher)",
    bAsc: 0.22,
    bDesc: 0.22,
    note: "Occasional outbursts (1982: ~90/h).",
  },
  {
    code: "ETA",
    name: "eta-Aquariids",
    aliases: ["eta aquarids", "halley meteors"],
    lamStart: 28.6,
    lamEnd: 67.3,
    lamPeak: 45.5,
    raDeg: 338,
    decDeg: -1,
    driftRa: 0.9,
    driftDec: 0.4,
    zhr: 50,
    rIndex: 2.4,
    vgKmS: 65.9,
    parent: "1P/Halley",
    bAsc: 0.08,
    bDesc: 0.08,
    note: "Broad plateau — strong for a week; a dawn shower from mid-north.",
  },
  {
    code: "ELY",
    name: "eta-Lyrids",
    aliases: [],
    lamStart: 42.2,
    lamEnd: 53.8,
    lamPeak: 50.0,
    raDeg: 291,
    decDeg: 43,
    driftRa: 1.0,
    driftDec: 0.1,
    zhr: 3,
    rIndex: 3.0,
    // MDC 45.3 vs IMO V∞ 43 disagree — 42 is the IMO-implied value (UNVERIFIED between them).
    vgKmS: 42,
    parent: "C/1983 H1 (IRAS-Araki-Alcock)",
  },
  {
    code: "JBO",
    name: "June Bootids",
    aliases: ["bootids"],
    lamStart: 90.2,
    lamEnd: 100.7,
    // Traditional maximum (Jun 27); cal2026's OCR-read 90.3 collides with the activity start.
    lamPeak: 95.7,
    raDeg: 221,
    decDeg: 48,
    driftRa: 0.2,
    driftDec: -0.2,
    zhr: null,
    rIndex: 2.2,
    vgKmS: 14.1,
    parent: "7P/Pons-Winnecke",
    note: "Quiet most years — outbursts to 100+/h (1998, 2004).",
  },
  {
    code: "CAP",
    name: "alpha-Capricornids",
    aliases: ["capricornids"],
    lamStart: 100.7,
    lamEnd: 142.8,
    lamPeak: 128,
    raDeg: 307,
    decDeg: -10,
    driftRa: 0.9,
    driftDec: 0.3,
    zhr: 5,
    rIndex: 2.5,
    vgKmS: 22.2,
    parent: "169P/NEAT",
    bAsc: 0.041,
    bDesc: 0.041,
    note: "Low rates but famously bright, slow fireballs.",
  },
  {
    code: "SDA",
    name: "Southern delta-Aquariids",
    aliases: ["delta aquarids"],
    lamStart: 109.3,
    lamEnd: 150.5,
    lamPeak: 128,
    raDeg: 340,
    decDeg: -16,
    driftRa: 0.7,
    driftDec: 0.2,
    zhr: 25,
    rIndex: 2.5,
    vgKmS: 40.5,
    parent: "96P/Machholz (complex)",
    bAsc: 0.091,
    bDesc: 0.091,
  },
  {
    code: "PER",
    name: "Perseids",
    aliases: ["tears of st lawrence"],
    lamStart: 114.1,
    lamEnd: 151.5,
    lamPeak: 140.0,
    raDeg: 48,
    decDeg: 58,
    driftRa: 1.3,
    driftDec: 0.2,
    zhr: 100,
    rIndex: 2.2,
    vgKmS: 59.5,
    parent: "109P/Swift-Tuttle",
    bAsc: 0.2,
    bDesc: 0.2,
  },
  {
    code: "AUR",
    name: "Aurigids",
    aliases: [],
    lamStart: 154.4,
    lamEnd: 163.1,
    lamPeak: 158.6,
    raDeg: 91,
    decDeg: 39,
    driftRa: 1.1,
    driftDec: 0.0,
    zhr: 6,
    rIndex: 2.5,
    vgKmS: 65.7,
    parent: "C/1911 N1 (Kiess)",
    note: "Outburst history: 1994, 2007, 2021.",
  },
  {
    code: "SPE",
    name: "September epsilon-Perseids",
    aliases: [],
    lamStart: 162.1,
    lamEnd: 178.6,
    lamPeak: 166.7,
    raDeg: 48,
    decDeg: 40,
    driftRa: 1.0,
    driftDec: 0.1,
    zhr: 8,
    rIndex: 2.5,
    vgKmS: 64.5,
    parent: null,
    note: "Outbursts 2008 and 2013.",
  },
  {
    code: "STA",
    name: "Southern Taurids",
    aliases: ["taurids"],
    lamStart: 176.7,
    lamEnd: 238.3,
    lamPeak: 223,
    raDeg: 52,
    decDeg: 15,
    driftRa: 0.8,
    driftDec: 0.2,
    zhr: 7,
    rIndex: 2.3,
    vgKmS: 28,
    parent: "2P/Encke",
    bAsc: 0.026,
    bDesc: 0.026,
    note: "Weeks-long fireball season with the Northern branch; swarm years boost fireballs.",
  },
  {
    code: "ORI",
    name: "Orionids",
    aliases: ["halley meteors"],
    lamStart: 188.4,
    lamEnd: 225.2,
    lamPeak: 208,
    raDeg: 95,
    decDeg: 16,
    driftRa: 0.7,
    driftDec: 0.1,
    zhr: 20,
    rIndex: 2.5,
    vgKmS: 66.2,
    parent: "1P/Halley",
    bAsc: 0.12,
    bDesc: 0.12,
  },
  {
    code: "DRA",
    name: "October Draconids",
    aliases: ["giacobinids", "draconids"],
    lamStart: 192.4,
    lamEnd: 197.3,
    lamPeak: 195.4,
    raDeg: 262,
    decDeg: 54,
    driftRa: 0.0,
    driftDec: 0.0,
    zhr: 5,
    rIndex: 2.6,
    vgKmS: 20.4,
    parent: "21P/Giacobini-Zinner",
    note: "Storm shower (1933, 1946; ~300/h in 2011) — an evening radiant.",
  },
  {
    code: "LMI",
    name: "Leonis Minorids",
    aliases: [],
    lamStart: 205.2,
    lamEnd: 214.2,
    lamPeak: 211,
    raDeg: 162,
    decDeg: 37,
    driftRa: 1.0,
    driftDec: -0.4,
    zhr: 2,
    rIndex: 3.0,
    vgKmS: 61.9,
    parent: "C/1739 K1 (Zanotti)",
    bAsc: 0.14,
    bDesc: 0.14,
  },
  {
    code: "NTA",
    name: "Northern Taurids",
    aliases: ["taurids"],
    lamStart: 206.2,
    lamEnd: 258.6,
    lamPeak: 230,
    raDeg: 58,
    decDeg: 22,
    driftRa: 0.8,
    driftDec: 0.2,
    zhr: 5,
    rIndex: 2.3,
    vgKmS: 28.3,
    parent: "2004 TG10 (Encke complex)",
    bAsc: 0.026,
    bDesc: 0.026,
  },
  {
    code: "LEO",
    name: "Leonids",
    aliases: [],
    lamStart: 223.2,
    lamEnd: 248.4,
    lamPeak: 235.27,
    raDeg: 152,
    decDeg: 22,
    driftRa: 0.7,
    driftDec: -0.4,
    zhr: 15,
    rIndex: 2.5,
    vgKmS: 70.7,
    parent: "55P/Tempel-Tuttle",
    bAsc: 0.39,
    bDesc: 0.39,
    note: "Storm-capable near the parent's 33-year returns (1999-2002: 1000+/h).",
  },
  {
    code: "AMO",
    name: "alpha-Monocerotids",
    aliases: [],
    lamStart: 232.3,
    lamEnd: 243.4,
    lamPeak: 239.32,
    raDeg: 117,
    decDeg: 1,
    driftRa: 0.8,
    driftDec: -0.2,
    zhr: null,
    rIndex: 2.4,
    vgKmS: 63,
    parent: null,
    note: "Quiet most years — a ~400/h burst for half an hour in 1995.",
  },
  {
    code: "HYD",
    name: "sigma-Hydrids",
    aliases: [],
    lamStart: 250.4,
    lamEnd: 268.7,
    lamPeak: 257,
    raDeg: 125,
    decDeg: 2,
    driftRa: 0.7,
    driftDec: -0.2,
    zhr: 7,
    rIndex: 3.0,
    vgKmS: 58,
    parent: null,
    bAsc: 0.1,
    bDesc: 0.1,
  },
  {
    code: "GEM",
    name: "Geminids",
    aliases: ["gems"],
    lamStart: 251.5,
    lamEnd: 268.7,
    lamPeak: 262.2,
    raDeg: 112,
    decDeg: 33,
    driftRa: 1.0,
    driftDec: -0.1,
    zhr: 150,
    rIndex: 2.6,
    vgKmS: 34.6,
    parent: "(3200) Phaethon",
    bAsc: 0.39,
    bDesc: 0.72,
    note: "The strongest annual shower — shallow rise, fast drop after the peak.",
  },
  {
    code: "URS",
    name: "Ursids",
    aliases: [],
    lamStart: 264.7,
    lamEnd: 274.8,
    lamPeak: 270.7,
    raDeg: 217,
    decDeg: 76,
    driftRa: 0.0,
    driftDec: -0.4,
    zhr: 10,
    rIndex: 2.8,
    vgKmS: 33.0,
    parent: "8P/Tuttle",
    bAsc: 0.61,
    bDesc: 0.61,
    note: "Outbursts 1945 and 1986 (~50/h); circumpolar radiant from mid-north.",
  },
  {
    code: "COM",
    name: "Comae Berenicids",
    aliases: [],
    lamStart: 251.5,
    lamEnd: 310.5,
    lamPeak: 271,
    raDeg: 164,
    decDeg: 29,
    driftRa: 0.9,
    driftDec: -0.35,
    zhr: 3,
    rIndex: 3.0,
    vgKmS: 63.7,
    parent: null,
    bAsc: 0.08,
    bDesc: 0.08,
  },
] as const;

/** Row lookup by IAU code (case-insensitive) — the `shower:<code>` id resolver's engine. */
export function showerByCode(code: string): ShowerRow | null {
  const c = code.toUpperCase();
  return SHOWERS.find((s) => s.code === c) ?? null;
}

/** Wrap a degree difference into (−180, 180]. */
function wrap180(d: number): number {
  const w = ((d % 360) + 540) % 360;
  return w - 180;
}

/**
 * Apparent geocentric solar ecliptic longitude, EQUINOX J2000 (deg, [0,360)) — the meteor-table
 * frame. EQJ sun vector (aberration on, matching the apparent convention) rotated into the J2000
 * mean ecliptic; no precession model needed because the frame IS the epoch.
 */
export function sunLambdaJ2000(utcMs: number): number {
  const eqj = GeoVector(Body.Sun, MakeTime(new Date(utcMs)), true);
  const ecl = RotateVector(Rotation_EQJ_ECL(), eqj);
  const lam = Math.atan2(ecl.y, ecl.x) / DEG;
  return ((lam % 360) + 360) % 360;
}

/**
 * The next instant λ☉ = `lambdaDeg` at/after `fromMs` (ms) — the peak-date solver. Newton on the
 * mean rate (λ☉ is monotonic, rate varies ±3% over the year): 3 iterations land well under a
 * minute of error, far inside the table's λ☉ precision.
 */
export function lambdaToMs(lambdaDeg: number, fromMs: number): number {
  const ahead = (((lambdaDeg - sunLambdaJ2000(fromMs)) % 360) + 360) % 360;
  let ms = fromMs + (ahead / LAMBDA_DEG_PER_DAY) * DAY_MS;
  for (let i = 0; i < 3; i++) {
    ms -= (wrap180(sunLambdaJ2000(ms) - lambdaDeg) / LAMBDA_DEG_PER_DAY) * DAY_MS;
  }
  return ms;
}

/** Is the shower active at this instant (λ☉ inside the activity window, wrap-aware)? */
export function showerActive(row: ShowerRow, utcMs: number): boolean {
  const lam = sunLambdaJ2000(utcMs);
  const span = (((row.lamEnd - row.lamStart) % 360) + 360) % 360;
  const into = (((lam - row.lamStart) % 360) + 360) % 360;
  return into <= span;
}

/** Drifted radiant (J2000 deg) — peak position + per-day IMO drift, referenced to the peak. */
export function radiantAt(row: ShowerRow, utcMs: number): { raDeg: number; decDeg: number } {
  const days = wrap180(sunLambdaJ2000(utcMs) - row.lamPeak) / LAMBDA_DEG_PER_DAY;
  return { raDeg: row.raDeg + row.driftRa * days, decDeg: row.decDeg + row.driftDec * days };
}

/** Topocentric az/alt of the (drifted) radiant — the same frame path every fixed target rides. */
export function radiantAzAlt(
  row: ShowerRow,
  utcMs: number,
  latDeg: number,
  lonDeg: number,
): { azDeg: number; altDeg: number } {
  const { raDeg, decDeg } = radiantAt(row, utcMs);
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const j = { x: Math.cos(dec) * Math.cos(ra), y: Math.cos(dec) * Math.sin(ra), z: Math.sin(dec) };
  const [ex, ey, ez] = ecefFrameAt(MakeTime(new Date(utcMs))).toEcef(j);
  const t = topoAzAlt([ex, ey, ez], null, latDeg, lonDeg, 0);
  return { azDeg: t.azDeg, altDeg: t.altDeg };
}

/** ZHR at an instant — the Jenniskens profile clipped to the activity window (0 outside; 0 for
 *  the "Var" showers — an outburst has no honest curve). */
export function zhrAt(row: ShowerRow, utcMs: number): number {
  if (row.zhr == null || !showerActive(row, utcMs)) return 0;
  const dLam = wrap180(sunLambdaJ2000(utcMs) - row.lamPeak);
  const b = dLam < 0 ? (row.bAsc ?? DEFAULT_B) : (row.bDesc ?? DEFAULT_B);
  return row.zhr * 10 ** (-b * Math.abs(dLam));
}

/**
 * Expected visible meteors/hour for a perfect dark sky: ZHR(λ☉) × sin(radiant alt), 0 below the
 * horizon. Moonlight/twilight deliberately NOT folded in here — the night score carries them.
 */
export function visibleRateAt(
  row: ShowerRow,
  utcMs: number,
  latDeg: number,
  lonDeg: number,
): number {
  const z = zhrAt(row, utcMs);
  if (z === 0) return 0;
  const { altDeg } = radiantAzAlt(row, utcMs, latDeg, lonDeg);
  return altDeg <= 0 ? 0 : z * Math.sin(altDeg * DEG);
}

export interface RateSample {
  utcMs: number;
  /** Visible meteors/hour (dark-sky), 0 when the radiant is down or the shower inactive. */
  rate: number;
}

/** Rate series for the rail trace — same shape discipline as `elevationSeries`. */
export function meteorRateSeries(
  row: ShowerRow,
  startMs: number,
  endMs: number,
  latDeg: number,
  lonDeg: number,
  stepMin = 10,
): RateSample[] {
  const out: RateSample[] = [];
  const stepMs = stepMin * 60_000;
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    out.push({ utcMs: ms, rate: visibleRateAt(row, ms, latDeg, lonDeg) });
  }
  return out;
}

export interface ShowerNight {
  /** Start of the local solar day whose EVENING begins this night (the mwSeason anchor). */
  dayStartMs: number;
  /** Best sample of the night, or null (radiant never up in darkness / shower inactive). */
  peak: { utcMs: number; rate: number; altDeg: number; azDeg: number } | null;
  /** Dark minutes (sun < −18°) with the radiant above the horizon. */
  usableMinutes: number;
  /** 0..1 — the mwSeason moon convention, sampled at the night's peak. */
  moonInterference: number;
  /** peak rate × (1 − moonInterference); 0 when no peak. */
  score: number;
}

export interface ShowerNightOptions {
  /** Nights to scan (default 5 — a peak neighbourhood). */
  days?: number;
  /** Sample step (min, default 15 — the planner cadence). */
  stepMin?: number;
}

/**
 * One row per local night from the night containing/after `fromMs` — the moon-scored peak-night
 * scan. Cost ≈ days × 96 ephemeris samples; memoise per (day, eye) in consumers, never per frame.
 */
export function showerNights(
  fromMs: number,
  observer: PlanObserver,
  row: ShowerRow,
  opts: ShowerNightOptions = {},
): ShowerNight[] {
  const days = opts.days ?? 5;
  const stepMin = opts.stepMin ?? 15;
  const stepMs = stepMin * 60_000;
  const nights: ShowerNight[] = [];
  for (let i = 0; i < days; i++) {
    const day = localDayWindow(fromMs + i * DAY_MS, observer.lonDeg);
    // Scan noon→noon so one pass covers exactly one night (the mwSeason discipline).
    const noonMs = day.startMs + DAY_MS / 2;
    let usableMinutes = 0;
    let peak: ShowerNight["peak"] = null;
    for (let ms = noonMs; ms < noonMs + DAY_MS; ms += stepMs) {
      if (horizontal("sun", ms, observer.latDeg, observer.lonDeg).altDeg > SHOWER_DARK_SUN_DEG) {
        continue;
      }
      const z = zhrAt(row, ms);
      if (z === 0) continue;
      const { azDeg, altDeg } = radiantAzAlt(row, ms, observer.latDeg, observer.lonDeg);
      if (altDeg <= 0) continue;
      usableMinutes += stepMin;
      const rate = z * Math.sin(altDeg * DEG);
      if (peak == null || rate > peak.rate) peak = { utcMs: ms, rate, altDeg, azDeg };
    }
    const moonUp = peak
      ? horizontal("moon", peak.utcMs, observer.latDeg, observer.lonDeg).altDeg > 0
      : false;
    const interference =
      peak && moonUp ? moonPhaseIntensity(bodyStatesAt(peak.utcMs).moonPhaseAngleDeg) : 0;
    nights.push({
      dayStartMs: day.startMs,
      peak,
      usableMinutes,
      moonInterference: interference,
      score: peak ? peak.rate * (1 - interference) : 0,
    });
  }
  return nights;
}

export interface ShowerPeak {
  row: ShowerRow;
  /** The instant λ☉ crosses the row's peak longitude. */
  peakMs: number;
  /** Best local night in the peak's ±1-night neighbourhood (by score), or null. */
  night: ShowerNight | null;
}

/**
 * Upcoming shower maxima within `horizonDays` (default 120 — the METEORS card window), each with
 * its best moon-scored night near the peak. Sorted by peak date. The "Var" showers ride along
 * (their radiant + date are the value; night/score stay null/0 without a ZHR curve).
 */
export function upcomingShowerPeaks(
  fromMs: number,
  observer: PlanObserver,
  horizonDays = 120,
): ShowerPeak[] {
  const out: ShowerPeak[] = [];
  for (const row of SHOWERS) {
    const peakMs = lambdaToMs(row.lamPeak, fromMs);
    if (peakMs - fromMs > horizonDays * DAY_MS) continue;
    const nights = showerNights(peakMs - 1.5 * DAY_MS, observer, row, { days: 3 });
    const night = nights.reduce<ShowerNight | null>(
      (a, n) => (n.peak != null && (a == null || n.score > a.score) ? n : a),
      null,
    );
    out.push({ row, peakMs, night });
  }
  return out.sort((a, b) => a.peakMs - b.peakMs);
}
