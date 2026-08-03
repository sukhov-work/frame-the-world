#!/usr/bin/env node
/**
 * build-comet-elements.mjs — re-bake the comet elements in `src/lib/ephemeris/comet.ts`.
 *
 * The comet tracer propagates two-body over OSCULATING elements baked at one epoch: exact for
 * the apparition it was baked for, drifting slowly away from it (measured: ≤0.35′ within ±1.5 yr,
 * 2.1′ at +3 yr). Run this to re-bake for a new epoch — a new apparition, or simply a fresher JPL
 * solution — then paste the printed literal over `TEMPEL2.elements` and update `TEMPEL2.source`.
 *
 * It also RE-CHECKS the propagator: after fetching elements it pulls a Horizons observer
 * ephemeris and prints the residuals, so a re-bake can never silently regress the accuracy claim
 * in the module header (and in test/lib/ephemeris/comet.test.ts, whose rows come from here).
 *
 * Needs network. Same run-once-and-commit idiom as build-star-catalog.mjs / build-asterisms.mjs.
 *   node scripts/build-comet-elements.mjs [designation] [epochISO]
 *   node scripts/build-comet-elements.mjs 10P 2026-08-01
 */
import { Body, HelioVector, MakeTime } from "astronomy-engine";

const DESIGNATION = process.argv[2] ?? "10P";
const EPOCH_ISO = process.argv[3] ?? "2026-08-01";
const API = "https://ssd.jpl.nasa.gov/api/horizons.api";

const DEG = Math.PI / 180;
const OBLIQUITY_RAD = 23.4392911 * DEG;
const C_AU_PER_DAY = 173.1446326846693;
const JD_UNIX_EPOCH = 2440587.5;
const TDB_MINUS_UTC_S = 69.184;

async function horizons(params) {
  const url = new URL(API);
  url.searchParams.set("format", "text");
  // Horizons wants its values QUOTED — an unquoted `1,4,9` or `2026-08-01 00:00` is parsed as
  // "too many constants" and the whole request fails with an INPUT ERROR.
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`horizons ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (/INPUT ERROR|cannot proceed/.test(text)) throw new Error(text.slice(0, 600));
  return text;
}

/** `EC= 0.53 QR= 1.41 …` → { EC: 0.53, QR: 1.41, … } for the first $$SOE row. */
function parseElements(text) {
  const body = text.split("$$SOE")[1]?.split("$$EOE")[0];
  if (!body) throw new Error("no $$SOE block in the elements response");
  const out = {};
  for (const [, k, v] of body.matchAll(/([A-Za-z]+)\s*=\s*(-?[\d.]+E?[-+]?\d*)/g)) out[k] = Number(v);
  return out;
}

const elText = await horizons({
  COMMAND: `'DES=${DESIGNATION}; CAP'`,
  OBJ_DATA: "YES",
  MAKE_EPHEM: "YES",
  EPHEM_TYPE: "ELEMENTS",
  CENTER: "'500@10'",
  START_TIME: `'${EPOCH_ISO}'`,
  STOP_TIME: `'${EPOCH_ISO} 01:00'`,
  STEP_SIZE: "'1 d'",
  REF_PLANE: "ECLIPTIC",
  REF_SYSTEM: "ICRF",
  OUT_UNITS: "'AU-D'",
});

const e = parseElements(elText);
const epochJdTdb = Number(elText.match(/\$\$SOE\s+([\d.]+)/)[1]);
const fullname = elText.match(/Target body name:\s*(.+?)\s*\{/)?.[1] ?? DESIGNATION;
const soln = elText.match(/Soln\.date:\s*(\S+)/)?.[1] ?? "unknown";
// M1/k1 drive the magnitude law; they live in the "Comet physical" block, not the element rows.
const m1 = Number(elText.match(/M1=\s*([\d.]+)/)?.[1] ?? NaN);
const k1 = Number(elText.match(/k1=\s*([\d.]+)/)?.[1] ?? NaN);

const elements = {
  epochJdTdb,
  e: e.EC,
  aAu: e.A,
  qAu: e.QR,
  iDeg: e.IN,
  nodeDeg: e.OM,
  periDeg: e.W,
  tpJdTdb: e.Tp,
  nDegPerDay: e.N,
  periodDays: e.PR,
  m1,
  k1,
};

console.log(`// ${fullname} — JPL Horizons, soln date ${soln}, epoch ${EPOCH_ISO} TDB`);
console.log("elements: {");
for (const [k, v] of Object.entries(elements)) console.log(`  ${k}: ${v},`);
console.log("},");

// --- re-check: propagate and diff against a Horizons observer ephemeris ----------------------
const jdTdbFromUtcMs = (ms) => JD_UNIX_EPOCH + (ms + TDB_MINUS_UTC_S * 1000) / 86_400_000;

function helioEqjAu(jdTdb) {
  const twoPi = 2 * Math.PI;
  const M = (((elements.nDegPerDay * (jdTdb - elements.tpJdTdb) * DEG) % twoPi) + 2 * twoPi) % twoPi;
  let E = elements.e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 40; i++) {
    const step = (E - elements.e * Math.sin(E) - M) / (1 - elements.e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  const xp = elements.aAu * (Math.cos(E) - elements.e);
  const yp = elements.aAu * Math.sqrt(1 - elements.e ** 2) * Math.sin(E);
  const [om, w, inc] = [elements.nodeDeg * DEG, elements.periDeg * DEG, elements.iDeg * DEG];
  const [co, so, cw, sw, ci, si] = [
    Math.cos(om), Math.sin(om), Math.cos(w), Math.sin(w), Math.cos(inc), Math.sin(inc),
  ];
  const xe = (co * cw - so * sw * ci) * xp + (-co * sw - so * cw * ci) * yp;
  const ye = (so * cw + co * sw * ci) * xp + (-so * sw + co * cw * ci) * yp;
  const ze = sw * si * xp + cw * si * yp;
  return [
    xe,
    ye * Math.cos(OBLIQUITY_RAD) - ze * Math.sin(OBLIQUITY_RAD),
    ye * Math.sin(OBLIQUITY_RAD) + ze * Math.cos(OBLIQUITY_RAD),
  ];
}

function astrometric(utcMs) {
  const earth = HelioVector(Body.Earth, MakeTime(new Date(utcMs)));
  const jd = jdTdbFromUtcMs(utcMs);
  let tau = 0;
  let g = [0, 0, 0];
  let helio = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    helio = helioEqjAu(jd - tau);
    g = [helio[0] - earth.x, helio[1] - earth.y, helio[2] - earth.z];
    tau = Math.hypot(...g) / C_AU_PER_DAY;
  }
  const delta = Math.hypot(...g);
  const r = Math.hypot(...helio);
  return {
    raDeg: ((Math.atan2(g[1], g[0]) / DEG) % 360 + 360) % 360,
    decDeg: (Math.asin(g[2] / delta) * 180) / Math.PI,
    delta,
    mag: elements.m1 + 5 * Math.log10(delta) + elements.k1 * Math.log10(r),
  };
}

const epochMs = Date.parse(`${EPOCH_ISO}T00:00:00Z`);
const checkStart = new Date(epochMs - 60 * 86_400_000).toISOString().slice(0, 10);
const checkStop = new Date(epochMs + 120 * 86_400_000).toISOString().slice(0, 10);
const obsText = await horizons({
  COMMAND: `'DES=${DESIGNATION}; CAP'`,
  OBJ_DATA: "NO",
  MAKE_EPHEM: "YES",
  EPHEM_TYPE: "OBSERVER",
  CENTER: "'500@399'",
  START_TIME: `'${checkStart}'`,
  STOP_TIME: `'${checkStop}'`,
  STEP_SIZE: "'10 d'",
  QUANTITIES: "'1,9,20,23'",
  ANG_FORMAT: "DEG",
  CSV_FORMAT: "YES",
});

console.log(`\n// re-check vs Horizons (${checkStart} … ${checkStop})`);
let worstSep = 0;
let worstMag = 0;
for (const line of obsText.split("$$SOE")[1].split("$$EOE")[0].trim().split("\n")) {
  const c = line.split(",").map((s) => s.trim());
  const [when, raDeg, decDeg, tmag] = [c[0], Number(c[3]), Number(c[4]), Number(c[5])];
  // Horizons stamps rows as `2026-Aug-02 00:00` — not ISO. The " UTC" suffix is what makes the
  // month-name form parse (and parse as UTC rather than local).
  const ms = Date.parse(`${when} UTC`);
  if (!Number.isFinite(ms) || !Number.isFinite(raDeg)) continue;
  const p = astrometric(ms);
  const dRa = (((p.raDeg - raDeg + 540) % 360) - 180) * Math.cos(decDeg * DEG);
  const sepArcsec = Math.hypot(dRa, p.decDeg - decDeg) * 3600;
  worstSep = Math.max(worstSep, sepArcsec);
  worstMag = Math.max(worstMag, Math.abs(p.mag - tmag));
  console.log(`//   ${when}  ${sepArcsec.toFixed(2).padStart(7)}"  Δmag ${(p.mag - tmag).toFixed(3)}`);
}
console.log(`// WORST: ${worstSep.toFixed(2)}" · ${worstMag.toFixed(3)} mag`);
if (worstSep > 60) {
  console.error("\n!! residuals exceed 1' — do NOT ship these elements without investigating");
  process.exitCode = 1;
}
