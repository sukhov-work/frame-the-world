#!/usr/bin/env node
/**
 * build-asteroid-catalog.mjs — bake the bright numbered asteroids (H < 9, a < 6 AU) into
 * `src/lib/sky/asteroids.ts` (ASTRO ENGINE: the asteroid half of the moving-target SKY catalog;
 * two-body propagation happens in the consumer, this module is elements-only).
 *
 * Source: JPL SBDB Query API (https://ssd-api.jpl.nasa.gov/sbdb_query.api), numbered asteroids
 * only (sb-kind=a, sb-ns=n) constrained to H|LT|9 AND a|LT|6 — ~337 rows.
 * Attribution: "JPL SSD/CNEOS SBDB" — REQUIRED wherever this data surfaces.
 *
 * Times: SBDB epochs are JD TDB; mean anomaly at epoch is converted to a perihelion time
 * tpJdTdb = epoch − M0/n with M0 wrapped into (−180°, 180°] so Tp stays within half a period of
 * the epoch. Gaussian k = 0.01720209895 rad/day drives the mean motion. All rows are elliptic.
 * Slope G defaults to the MPC standard 0.15 where SBDB carries none.
 *
 * Needs network. Same run-once-and-commit idiom as build-messier-catalog.mjs:
 *   node scripts/build-asteroid-catalog.mjs
 * Fails loud (exit 1) on any spot-check drift or range violation.
 */

import { writeFileSync } from "node:fs";

const API = "https://ssd-api.jpl.nasa.gov/sbdb_query.api";
const OUT = new URL("../src/lib/sky/asteroids.ts", import.meta.url).pathname;

/** Gaussian gravitational constant, rad/day. */
const GAUSS_K = 0.01720209895;

function fatal(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

/** Round finite numbers to `dp` decimals. */
const round = (v, dp) => Number(v.toFixed(dp));

const url = new URL(API);
url.searchParams.set("fields", "pdes,name,H,G,e,a,i,om,w,ma,epoch");
url.searchParams.set("sb-kind", "a");
url.searchParams.set("sb-ns", "n");
url.searchParams.set("sb-cdata", JSON.stringify({ AND: ["H|LT|9", "a|LT|6"] }));
// Full-precision elements — the default ~4-sig-digit rounding costs ~10–15″ vs Horizons.
url.searchParams.set("full-prec", "1");

const res = await fetch(url);
if (!res.ok) fatal(`${API}: ${res.status} ${res.statusText}`);
const json = await res.json();
if (!Array.isArray(json.data) || !Array.isArray(json.fields)) fatal(`unexpected response shape: ${JSON.stringify(json).slice(0, 300)}`);
if (Number(json.count) !== json.data.length) fatal(`count ${json.count} != data length ${json.data.length}`);

const col = Object.fromEntries(json.fields.map((f, i) => [f, i]));
for (const f of ["pdes", "name", "H", "G", "e", "a", "i", "om", "w", "ma", "epoch"]) {
  if (col[f] == null) fatal(`missing field ${f} in response (got: ${json.fields.join(",")})`);
}

let gDefaulted = 0;
const rows = json.data.map((d) => {
  const cell = (f) => d[col[f]];
  const reqNum = (f) => {
    const v = Number(cell(f));
    if (!Number.isFinite(v)) fatal(`pdes=${cell("pdes")}: missing/NaN ${f} (${cell(f)})`);
    return v;
  };

  const n = reqNum("pdes");
  if (!Number.isInteger(n) || n < 1) fatal(`non-integer MPC number: ${cell("pdes")}`);
  const name = String(cell("name") ?? "").trim();
  if (!name) fatal(`asteroid ${n} has no name`);

  const gRaw = cell("G");
  const hasG = gRaw != null && String(gRaw).trim() !== "";
  if (!hasG) gDefaulted += 1;
  const g = hasG ? Number(gRaw) : 0.15; // MPC default slope

  const e = reqNum("e");
  const aAu = reqNum("a");
  const iDeg = reqNum("i");
  const nodeDeg = reqNum("om");
  const periDeg = reqNum("w");
  const ma = reqNum("ma");
  const epochJdTdb = reqNum("epoch");

  const qAu = aAu * (1 - e);
  const nDegPerDay = ((GAUSS_K * 180) / Math.PI) / aAu ** 1.5;
  const periodDays = 360 / nDegPerDay;
  // Wrap M0 into (−180, 180] → Tp lands within half a period of the epoch.
  let m0 = ((ma % 360) + 360) % 360;
  if (m0 > 180) m0 -= 360;
  const tpJdTdb = epochJdTdb - m0 / nDegPerDay;

  return {
    n,
    name,
    h: reqNum("H"),
    g,
    epochJdTdb,
    e,
    qAu: round(qAu, 8),
    aAu,
    iDeg,
    nodeDeg,
    periDeg,
    tpJdTdb: round(tpJdTdb, 6),
    nDegPerDay: round(nDegPerDay, 10),
    periodDays: round(periodDays, 4),
  };
});

rows.sort((a, b) => a.n - b.n);

// ---- FAIL-LOUD checks -------------------------------------------------------------------------

if (rows.length < 300 || rows.length > 400) fatal(`${rows.length} rows — outside [300, 400]`);

const byN = new Map(rows.map((r) => [r.n, r]));
const ceres = byN.get(1);
if (!ceres) fatal("Ceres (1) missing");
if (Math.abs(ceres.h - 3.34) > 0.2) fatal(`Ceres H drifted: ${ceres.h}`);
if (Math.abs(ceres.aAu - 2.766) > 0.05) fatal(`Ceres a drifted: ${ceres.aAu}`);
if (Math.abs(ceres.g - 0.12) > 0.05) fatal(`Ceres G drifted: ${ceres.g}`);
const vesta = byN.get(4);
if (!vesta) fatal("Vesta (4) missing");
if (Math.abs(vesta.h - 3.2) > 0.3) fatal(`Vesta H drifted: ${vesta.h}`);
if (!byN.get(2)) fatal("Pallas (2) missing");
if (!byN.get(3)) fatal("Juno (3) missing");

for (const r of rows) {
  if (!(r.e >= 0 && r.e <= 0.9)) fatal(`${r.n} ${r.name}: e ${r.e} outside [0, 0.9]`);
  if (!(r.iDeg >= 0 && r.iDeg <= 90)) fatal(`${r.n} ${r.name}: i ${r.iDeg} outside [0, 90]`);
  if (!(Math.abs(r.tpJdTdb - r.epochJdTdb) <= r.periodDays / 2 + 1))
    fatal(`${r.n} ${r.name}: |Tp − epoch| ${Math.abs(r.tpJdTdb - r.epochJdTdb)} > period/2 + 1`);
  if (!(r.g >= -0.5 && r.g <= 1)) fatal(`${r.n} ${r.name}: G ${r.g} outside [−0.5, 1]`);
  if (!(r.qAu > 0 && Number.isFinite(r.periodDays) && r.periodDays > 0))
    fatal(`${r.n} ${r.name}: bad derived q/period (${r.qAu}, ${r.periodDays})`);
}

// ---- emit -------------------------------------------------------------------------------------

const KEYS = [
  "n", "name", "h", "g", "epochJdTdb", "e", "qAu", "aAu", "iDeg", "nodeDeg", "periDeg",
  "tpJdTdb", "nDegPerDay", "periodDays",
];
const fmt = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v));
const body = rows.map((r) => `  {${KEYS.map((k) => `${k}: ${fmt(r[k])}`).join(",")}},`).join("\n");

const module_ = `// GENERATED by scripts/build-asteroid-catalog.mjs — do not hand-edit; re-run to refresh.
// Baked: ${new Date().toISOString().slice(0, 10)} from the SBDB snapshot fetched this run (audit B4: elements age — date every bake).
// Data: JPL SBDB Query API (ssd-api.jpl.nasa.gov/sbdb_query.api), numbered asteroids H < 9, a < 6 AU.
// Attribution is REQUIRED wherever this data surfaces ("JPL SSD/CNEOS SBDB").
// Epochs are JD TDB. tpJdTdb = epoch − M0/n with M0 wrapped into (−180°, 180°]. All rows elliptic.

/** One numbered asteroid — SBDB osculating elements, derived q/Tp/n/period per Gaussian k. */
export interface AsteroidRow {
  /** MPC number. */
  n: number;
  name: string;
  h: number;
  /** Slope G — 0.15 MPC default where SBDB has none. */
  g: number;
  epochJdTdb: number;
  e: number;
  qAu: number;
  aAu: number;
  iDeg: number;
  nodeDeg: number;
  periDeg: number;
  tpJdTdb: number;
  nDegPerDay: number;
  periodDays: number;
}

export const ASTEROIDS: AsteroidRow[] = [
${body}
];
`;

writeFileSync(OUT, module_);

console.log(
  `OK: wrote ${rows.length} asteroids to src/lib/sky/asteroids.ts (${Buffer.byteLength(module_)} bytes)\n` +
    `  G-defaulted (0.15): ${gDefaulted}`,
);
