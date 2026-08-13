#!/usr/bin/env node
/**
 * build-comet-catalog.mjs — bake the full MPC observable-comet orbit file into `src/lib/sky/comets.ts`
 * (ASTRO ENGINE: the comet half of the moving-target SKY catalog; two-body propagation happens
 * in the consumer, this module is elements-only).
 *
 * Source: Minor Planet Center — CometEls, https://minorplanetcenter.net/Extended_Files/cometels.json.gz
 * (gzipped JSON array, ~953 records, updated daily). Attribution: "Minor Planet Center — CometEls" —
 * REQUIRED wherever this data surfaces.
 *
 * Times: MPC perihelion + epoch dates are TT; we treat TT ≈ TDB (same stance as
 * src/lib/ephemeris/comet.ts, error ≤ 2 ms). Gaussian k = 0.01720209895 rad/day drives the mean
 * motion; hyperbolic/parabolic rows (e ≥ 1) carry aAu < 0 (−Infinity for the exactly-parabolic
 * e = 1 solutions, the e→1⁺ limit), nDegPerDay = 0, periodDays = Infinity.
 *
 * 10P policy: the record whose short designation is "10P" is SKIPPED — the repo carries a special
 * hand-baked 10P/Tempel 2 profile (src/lib/ephemeris/comet.ts) and must not be shadowed here.
 * The script asserts exactly one record was dropped for this reason.
 *
 * Needs network. Same run-once-and-commit idiom as build-messier-catalog.mjs:
 *   node scripts/build-comet-catalog.mjs
 * Fails loud (exit 1) on any spot-check drift, range violation, or duplicate designation.
 */

import { writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const SRC = "https://minorplanetcenter.net/Extended_Files/cometels.json.gz";
const OUT = new URL("../src/lib/sky/comets.ts", import.meta.url).pathname;

/** Gaussian gravitational constant, rad/day. */
const GAUSS_K = 0.01720209895;

function fatal(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

/** Meeus JD from a Gregorian calendar date with fractional day. TT in, TT out (≈ TDB, ≤2 ms). */
function jdTt(year, month, dayFrac) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + dayFrac + b - 1524.5;
}

/** null/undefined/"" → null, else Number (fail loud on NaN at the call site). */
const num = (v) => (v == null || v === "" ? null : Number(v));

/** Round finite numbers to `dp` decimals; pass ±Infinity / null through untouched. */
const round = (v, dp) => (v != null && Number.isFinite(v) ? Number(v.toFixed(dp)) : v);

/**
 * "C/1995 O1 (Hale-Bopp)" → { desig: "C/1995 O1", name: "Hale-Bopp" }
 * "1P/Halley"             → { desig: "1P",        name: "Halley" }
 * "73P-B/Schwassmann-Wachmann 3" → { desig: "73P-B", name: "Schwassmann-Wachmann 3" }
 * "C/2025 A1"             → { desig: "C/2025 A1", name: null }
 */
function splitDesig(full) {
  let desig = full.trim();
  let name = null;
  const paren = desig.indexOf(" (");
  if (paren !== -1) {
    name = desig.slice(paren + 2).replace(/\)\s*$/, "").trim() || null;
    desig = desig.slice(0, paren).trim();
  }
  // Numbered-periodic "NP/Name" (incl. fragments "73P-B/…") — the slash splits desig from name.
  // C/ P/ D/ provisional forms ("C/1995 O1") keep their slash: the prefix there is a single letter.
  const np = /^(\d+[A-Z](?:-[A-Z0-9]+)?)\/(.*)$/.exec(desig);
  if (np) {
    desig = np[1];
    if (name == null && np[2].trim()) name = np[2].trim();
  }
  return { desig, name };
}

const res = await fetch(SRC);
if (!res.ok) fatal(`${SRC}: ${res.status} ${res.statusText}`);
const raw = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
const records = JSON.parse(raw);
if (!Array.isArray(records) || records.length === 0) fatal("source is not a non-empty JSON array");

const rows = [];
let skipped10P = 0;
let parabolic = 0;
const orbitDist = new Map();

for (const rec of records) {
  const full = rec.Designation_and_name;
  if (typeof full !== "string" || !full.trim()) fatal(`record without Designation_and_name: ${JSON.stringify(rec)}`);
  const { desig, name } = splitDesig(full);

  if (desig === "10P") {
    skipped10P += 1; // hand-baked profile in src/lib/ephemeris/comet.ts wins — see header.
    continue;
  }

  const e = num(rec.e);
  const qAu = num(rec.Perihelion_dist);
  const iDeg = num(rec.i);
  const nodeDeg = num(rec.Node);
  const periDeg = num(rec.Peri);
  for (const [k, v] of Object.entries({ e, qAu, iDeg, nodeDeg, periDeg })) {
    if (v == null || Number.isNaN(v)) fatal(`${full}: missing/NaN ${k}`);
  }

  const tpJdTdb = jdTt(
    Number(rec.Year_of_perihelion),
    Number(rec.Month_of_perihelion),
    Number(rec.Day_of_perihelion),
  );
  if (!Number.isFinite(tpJdTdb)) fatal(`${full}: bad perihelion date`);

  // Epoch may be absent on some (mostly one-apparition) records — fall back to Tp.
  const epochJdTdb =
    rec.Epoch_year != null && rec.Epoch_month != null && rec.Epoch_day != null
      ? jdTt(Number(rec.Epoch_year), Number(rec.Epoch_month), Number(rec.Epoch_day))
      : tpJdTdb;
  if (!Number.isFinite(epochJdTdb)) fatal(`${full}: bad epoch date`);

  let aAu;
  let nDegPerDay;
  let periodDays;
  if (e < 1) {
    aAu = qAu / (1 - e);
    nDegPerDay = ((GAUSS_K * 180) / Math.PI) / aAu ** 1.5;
    periodDays = 360 / nDegPerDay;
  } else {
    // e = 1 exactly (MPC parabolic solution): q/(1−e) is +Infinity in IEEE — take the e→1⁺
    // (hyperbolic-side) limit −Infinity so every e ≥ 1 row keeps the aAu < 0 convention.
    aAu = e === 1 ? -Infinity : qAu / (1 - e);
    if (e === 1) parabolic += 1;
    nDegPerDay = 0;
    periodDays = Infinity;
  }

  const orbit = String(rec.Orbit_type ?? "").trim();
  if (!orbit) fatal(`${full}: missing Orbit_type`);
  orbitDist.set(orbit, (orbitDist.get(orbit) ?? 0) + 1);

  rows.push({
    full: full.trim(),
    desig,
    name,
    orbit,
    epochJdTdb: round(epochJdTdb, 6),
    e,
    qAu,
    iDeg,
    nodeDeg,
    periDeg,
    tpJdTdb: round(tpJdTdb, 6),
    aAu: round(aAu, 8),
    nDegPerDay: round(nDegPerDay, 10),
    periodDays: round(periodDays, 4),
    h: num(rec.H),
    g: num(rec.G),
  });
}

// ---- FAIL-LOUD checks -------------------------------------------------------------------------

if (skipped10P !== 1) fatal(`expected exactly 1 skipped 10P record, got ${skipped10P}`);
if (rows.length < 900 || rows.length > 1100) fatal(`kept ${rows.length} rows — outside [900, 1100]`);

const halley = rows.find((r) => r.desig === "1P");
if (!halley) fatal("Halley (1P) missing");
if (!(halley.e > 0.96 && halley.e < 0.97)) fatal(`Halley e drifted: ${halley.e}`);
if (!(halley.qAu > 0.57 && halley.qAu < 0.6)) fatal(`Halley q drifted: ${halley.qAu}`);

const haleBopp = rows.find((r) => r.desig === "C/1995 O1");
if (!haleBopp) fatal("Hale-Bopp (C/1995 O1) missing");
if (!(haleBopp.e > 0.99 && haleBopp.e < 1.0)) fatal(`Hale-Bopp e drifted: ${haleBopp.e}`);
if (!(haleBopp.qAu > 0.89 && haleBopp.qAu < 0.93)) fatal(`Hale-Bopp q drifted: ${haleBopp.qAu}`);

for (const r of rows) {
  if (!(r.qAu > 0)) fatal(`${r.full}: qAu ${r.qAu} not > 0`);
  if (!(r.e >= 0)) fatal(`${r.full}: e ${r.e} < 0`);
  if (!(r.tpJdTdb > 2300000 && r.tpJdTdb < 2600000)) fatal(`${r.full}: tpJdTdb ${r.tpJdTdb} out of range`);
  if (r.e < 1) {
    if (!(Number.isFinite(r.periodDays) && r.periodDays > 0)) fatal(`${r.full}: elliptic but periodDays ${r.periodDays}`);
    if (!(r.aAu > 0)) fatal(`${r.full}: elliptic but aAu ${r.aAu}`);
  } else {
    if (!(r.aAu < 0)) fatal(`${r.full}: e ≥ 1 but aAu ${r.aAu} not < 0`);
    if (r.periodDays !== Infinity) fatal(`${r.full}: e ≥ 1 but periodDays ${r.periodDays}`);
    if (r.nDegPerDay !== 0) fatal(`${r.full}: e ≥ 1 but nDegPerDay ${r.nDegPerDay}`);
  }
}

const seen = new Map();
for (const r of rows) seen.set(r.desig, (seen.get(r.desig) ?? 0) + 1);
const dupes = [...seen.entries()].filter(([, n]) => n > 1);
if (dupes.length) fatal(`duplicate desig values: ${dupes.map(([d, n]) => `${d}×${n}`).join(", ")}`);

// ---- emit -------------------------------------------------------------------------------------

const KEYS = [
  "full", "desig", "name", "orbit", "epochJdTdb", "e", "qAu", "iDeg", "nodeDeg", "periDeg",
  "tpJdTdb", "aAu", "nDegPerDay", "periodDays", "h", "g",
];
const fmt = (v) =>
  v == null
    ? "null"
    : typeof v === "string"
      ? JSON.stringify(v)
      : v === Infinity
        ? "Infinity"
        : v === -Infinity
          ? "-Infinity"
          : String(v);
const body = rows.map((r) => `  {${KEYS.map((k) => `${k}: ${fmt(r[k])}`).join(",")}},`).join("\n");

const module_ = `// GENERATED by scripts/build-comet-catalog.mjs — do not hand-edit; re-run to refresh.
// Baked: ${new Date().toISOString().slice(0, 10)} from the MPC snapshot fetched this run (audit B4: elements age — date every bake).
// Data: Minor Planet Center — CometEls (minorplanetcenter.net/Extended_Files/cometels.json.gz).
// Attribution is REQUIRED wherever this data surfaces ("Minor Planet Center — CometEls").
// Times are TT treated as TDB (≤2 ms, same stance as src/lib/ephemeris/comet.ts). e ≥ 1 rows:
// aAu < 0 (−Infinity for exactly-parabolic e = 1), nDegPerDay = 0, periodDays = Infinity.
// 10P is intentionally ABSENT — the hand-baked profile in src/lib/ephemeris/comet.ts owns it.

/** One MPC comet — osculating elements verbatim, derived a/n/period per Gaussian k. */
export interface CometRow {
  /** Full MPC designation + name, verbatim ("C/1995 O1 (Hale-Bopp)"). */
  full: string;
  /** Short designation ("C/1995 O1" · "1P"). */
  desig: string;
  /** Common name when present ("Hale-Bopp"), else null. */
  name: string | null;
  /** MPC orbit type: C (long-period) · P (periodic) · D (defunct) · other codes verbatim. */
  orbit: string;
  epochJdTdb: number;
  e: number;
  qAu: number;
  iDeg: number;
  nodeDeg: number;
  periDeg: number;
  tpJdTdb: number;
  /** Semi-major axis (NEGATIVE for e ≥ 1). */
  aAu: number;
  /** 0 for e ≥ 1. */
  nDegPerDay: number;
  /** Infinity for e ≥ 1. */
  periodDays: number;
  /** MPC total absolute magnitude H (comet convention → consumer maps m1 = H) — null if absent. */
  h: number | null;
  /** MPC slope G (comet convention → consumer maps k1 = 2.5·G) — null if absent. */
  g: number | null;
}

export const COMETS: CometRow[] = [
${body}
];
`;

writeFileSync(OUT, module_);

const eHyper = rows.filter((r) => r.e >= 1).length;
const dist = [...orbitDist.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" ");
console.log(
  `OK: wrote ${rows.length} comets to src/lib/sky/comets.ts (${Buffer.byteLength(module_)} bytes)\n` +
    `  skipped-10P: ${skipped10P} · e>=1: ${eHyper} (of which e=1 parabolic: ${parabolic}) · orbit types: ${dist}`,
);
