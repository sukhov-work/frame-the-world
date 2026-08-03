#!/usr/bin/env node
/**
 * fit-comet-lightcurve.mjs — fit `TEMPEL2.lightCurve` to REAL observed magnitudes (COBS).
 *
 * WHY (owner catch 2026-08-03): JPL's M1/k1 are an automated fit to the magnitudes attached to
 * ASTROMETRIC submissions — mostly CCD frames measured through a tight photometric aperture, which
 * misses most of a big diffuse coma. For 10P in 2026 that model says mag 12.8 while observers with
 * binoculars were reporting 8.2–9.0 the same night. The observed curve is what a session planner
 * needs; this script is how it stays honest.
 *
 * Fits `m = h + 5·log10(Δ) + 2.5·n·log10(r)` by least squares over a WIDE-FIELD/VISUAL subset
 * (aperture ≤ 15 cm, or ICQ magnitude-method `T`) — mixing in large-aperture CCD rows drags the
 * fit ~2 mag faint and inflates the slope, because they are a different photometric system.
 * Δ and r come from the SAME propagator the app ships (`src/lib/ephemeris/comet.ts`).
 *
 * Prints the `lightCurve: {…}` literal to paste into `TEMPEL2`, plus a residual table against the
 * observed medians so a re-bake can never silently regress. Needs network.
 *   node scripts/fit-comet-lightcurve.mjs [designation] [fromISO] [toISO]
 */
import { Body, HelioVector, MakeTime } from "astronomy-engine";

const DESIGNATION = process.argv[2] ?? "10P";
const FROM = process.argv[3] ?? "2025-11-01";
const TO = process.argv[4] ?? new Date().toISOString().slice(0, 10);

// --- elements + propagator: keep in sync with src/lib/ephemeris/comet.ts -----------------------
const EL = {
  e: 0.5374521953618221,
  aAu: 3.065062238548651,
  iDeg: 12.02723670268361,
  nodeDeg: 117.797505656995,
  periDeg: 195.468145326466,
  tpJdTdb: 2461254.615211494733,
  nDegPerDay: 0.1836729187513333,
};
const DEG = Math.PI / 180;
const OBLIQ = 23.4392911 * DEG;
const C_AU_PER_DAY = 173.1446326846693;
const JD_UNIX_EPOCH = 2440587.5;
const TDB_MINUS_UTC_S = 69.184;
const jdTdb = (ms) => JD_UNIX_EPOCH + (ms + TDB_MINUS_UTC_S * 1000) / 86_400_000;

function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 40; i++) {
    const s = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= s;
    if (Math.abs(s) < 1e-13) break;
  }
  return E;
}
function helioEqjAu(jd) {
  const t = 2 * Math.PI;
  const M = (((EL.nDegPerDay * (jd - EL.tpJdTdb) * DEG) % t) + 2 * t) % t;
  const E = solveKepler(M, EL.e);
  const xp = EL.aAu * (Math.cos(E) - EL.e);
  const yp = EL.aAu * Math.sqrt(1 - EL.e ** 2) * Math.sin(E);
  const [om, w, inc] = [EL.nodeDeg * DEG, EL.periDeg * DEG, EL.iDeg * DEG];
  const [co, so, cw, sw, ci, si] = [
    Math.cos(om), Math.sin(om), Math.cos(w), Math.sin(w), Math.cos(inc), Math.sin(inc),
  ];
  const xe = (co * cw - so * sw * ci) * xp + (-co * sw - so * cw * ci) * yp;
  const ye = (so * cw + co * sw * ci) * xp + (-so * sw + co * cw * ci) * yp;
  const ze = sw * si * xp + cw * si * yp;
  return [xe, ye * Math.cos(OBLIQ) - ze * Math.sin(OBLIQ), ye * Math.sin(OBLIQ) + ze * Math.cos(OBLIQ)];
}
function deltaR(ms) {
  const earth = HelioVector(Body.Earth, MakeTime(new Date(ms)));
  const jd = jdTdb(ms);
  let tau = 0, g = [0, 0, 0], c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    c = helioEqjAu(jd - tau);
    g = [c[0] - earth.x, c[1] - earth.y, c[2] - earth.z];
    tau = Math.hypot(...g) / C_AU_PER_DAY;
  }
  return { delta: Math.hypot(...g), r: Math.hypot(...c) };
}

// --- COBS ------------------------------------------------------------------------------------
const url =
  `https://cobs.si/api/obs_list.api?des=${encodeURIComponent(DESIGNATION)}` +
  `&exclude_faint=false&exclude_not_accurate=false&from_date=${FROM}&to_date=${TO}`;
const res = await fetch(url);
if (!res.ok) throw new Error(`COBS ${res.status} ${res.statusText}`);
const text = await res.text();

// ICQ-ish rows: "  10   2026 08 01.66  Z  8.9 TJ  5.0R …"; a "[" before the magnitude = upper limit.
const num = DESIGNATION.replace(/\D/g, "");
const rowRe = new RegExp(
  String.raw`^\s*${num}\s+(\d{4}) (\d{2}) (\d{2}\.\d+)\s+(.)\s*([\[\s])\s*(\d{1,2}\.\d)\s+([A-Z])([A-Z])\s+([\d.]+)([A-Z])`,
);
const rows = [];
for (const line of text.split("\n")) {
  const m = rowRe.exec(line);
  if (!m || m[5] === "[") continue;
  const day = parseFloat(m[3]);
  const ms = Date.UTC(+m[1], +m[2] - 1, Math.floor(day)) + (day - Math.floor(day)) * 86_400_000;
  rows.push({ ms, mag: +m[6], method: m[7], apertCm: +m[9], ...deltaR(ms) });
}
if (rows.length < 20) throw new Error(`only ${rows.length} usable observations — refusing to fit`);

const visual = rows.filter((o) => o.apertCm <= 15 || o.method === "T");
const fitAtSlope = (s, n) => {
  const h = s.reduce((a, o) => a + o.mag - 5 * Math.log10(o.delta) - 2.5 * n * Math.log10(o.r), 0) / s.length;
  const ss = s.reduce((a, o) => a + (o.mag - (h + 5 * Math.log10(o.delta) + 2.5 * n * Math.log10(o.r))) ** 2, 0);
  return { h, n, rms: Math.sqrt(ss / s.length) };
};
let best = null;
for (let n = 2; n <= 30; n += 0.1) {
  const f = fitAtSlope(visual, n);
  if (!best || f.rms < best.rms) best = f;
}

console.log(`// ${DESIGNATION} — COBS visual/wide-field fit, ${FROM} … ${TO}`);
console.log(`//   ${rows.length} observations parsed, ${visual.length} in the visual subset`);
console.log("lightCurve: {");
console.log(`  h: ${best.h.toFixed(2)},`);
console.log(`  n: ${best.n.toFixed(1)},`);
console.log(`  rmsMag: ${best.rms.toFixed(2)},`);
console.log(`  nObs: ${visual.length},`);
console.log(`  fromIso: "${FROM}",`);
console.log(`  toIso: "${TO}",`);
console.log(`  source: "COBS visual/wide-field observations (cobs.si), fitted ${TO}",`);
console.log("},");

// --- residual table: fitted vs the observed median, month by month ----------------------------
const model = (d, r) => best.h + 5 * Math.log10(d) + 2.5 * best.n * Math.log10(r);
console.log("\n// date         obs-median (N)   fitted   residual");
const months = [...new Set(visual.map((o) => new Date(o.ms).toISOString().slice(0, 7)))].sort();
let worst = 0;
for (const month of months) {
  const s = visual.filter((o) => new Date(o.ms).toISOString().startsWith(month));
  const mags = s.map((o) => o.mag).sort((a, b) => a - b);
  const med = mags[Math.floor(mags.length / 2)];
  const mid = s[Math.floor(s.length / 2)];
  const fit = model(mid.delta, mid.r);
  worst = Math.max(worst, Math.abs(fit - med));
  console.log(
    `//   ${month}        ${med.toFixed(1).padStart(5)} (${String(s.length).padStart(3)})   ` +
      `${fit.toFixed(1).padStart(5)}   ${(fit - med >= 0 ? "+" : "") + (fit - med).toFixed(1)}`,
  );
}
console.log(`// WORST monthly residual: ${worst.toFixed(2)} mag (fit rms ${best.rms.toFixed(2)})`);
if (worst > 1.5) {
  console.error("\n!! the fit misses a month by >1.5 mag — inspect before shipping these numbers");
  process.exitCode = 1;
}
