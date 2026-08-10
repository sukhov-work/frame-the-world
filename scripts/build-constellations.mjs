#!/usr/bin/env node
/**
 * build-constellations.mjs — bake the 88 IAU constellations into `src/lib/sky/constellations.ts`
 * (label anchors + names for the SKY search index) and the stick-figure asset
 * `public/data/constellation-lines.json` (same shape as public/data/asterisms.json).
 *
 * Source: d3-celestial (Olaf Frohn, BSD-3-Clause) — github.com/ofrohn/d3-celestial
 *   data/constellations.json        89 GeoJSON Point features (label anchors, RA in −180..180)
 *   data/constellations.lines.json  89 MultiLineString features keyed by the same 3-letter ids
 * 88 unique ids: Serpens ("Ser") appears TWICE (Caput + Cauda). We merge it into ONE entry —
 * the Caput feature's centre wins, name "Serpens", genitive "Serpentis" — and concatenate both
 * halves' line arrays into a single figure.
 *
 * The centres are d3-celestial LABEL anchors, NOT official IAU centroids — good enough for
 * search fly-to and labels, not for boundary math.
 *
 * Needs network. Same run-once-and-commit idiom as build-messier-catalog.mjs:
 *   node scripts/build-constellations.mjs
 * Fails loud (exit 1) on count / uniqueness / range / cross-file-consistency drift.
 */

import { writeFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data";
const OUT_TS = new URL("../src/lib/sky/constellations.ts", import.meta.url).pathname;
const OUT_JSON = new URL("../public/data/constellation-lines.json", import.meta.url).pathname;

function fatal(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

async function fetchJson(name) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) fatal(`${name}: ${res.status} ${res.statusText}`);
  return res.json();
}

const centers = await fetchJson("constellations.json");
const figuresFc = await fetchJson("constellations.lines.json");
if (centers.features?.length !== 89) fatal(`constellations.json: ${centers.features?.length} features, expected 89`);
if (figuresFc.features?.length !== 89) fatal(`constellations.lines.json: ${figuresFc.features?.length} features, expected 89`);

/** d3-celestial RA is −180..180 → normalize to 0..360. */
const normRa = (ra) => ((ra % 360) + 360) % 360;
/** Round to 2 decimals (arcmin-scale — plenty for figure lines); fold a rounded-up 360 back to 0. */
const r2 = (v) => {
  const x = Math.round(v * 100) / 100;
  return Object.is(x, -0) ? 0 : x;
};
const r2ra = (ra) => {
  const x = r2(normRa(ra));
  return x >= 360 ? 0 : x;
};

// ---- centres → CONSTELLATIONS entries (Serpens merged: Caput centre wins) -----------------------
const entries = [];
let sawCauda = false;
for (const f of centers.features) {
  const p = f.properties;
  const [ra, dec] = f.geometry.coordinates;
  if (f.id === "Ser" && p.name === "Serpens Cauda") {
    sawCauda = true; // merged into the Caput entry — centre + name come from Caput
    continue;
  }
  const isCaput = f.id === "Ser";
  if (isCaput && p.name !== "Serpens Caput") fatal(`unexpected Ser feature name: ${p.name}`);
  entries.push({
    abbr: f.id,
    name: isCaput ? "Serpens" : p.name,
    genitive: isCaput ? "Serpentis" : p.gen,
    raDeg: +normRa(ra).toFixed(4),
    decDeg: dec,
    rank: Number(p.rank),
  });
}
if (!sawCauda) fatal("Serpens Cauda feature not found — upstream split changed");

// ---- line features → figures (Ser's two MultiLineStrings concatenated) --------------------------
const figuresByAbbr = new Map();
let vertices = 0;
for (const f of figuresFc.features) {
  if (f.geometry?.type !== "MultiLineString") fatal(`${f.id}: geometry ${f.geometry?.type}, expected MultiLineString`);
  const lines = figuresByAbbr.get(f.id) ?? [];
  for (const line of f.geometry.coordinates) {
    lines.push(line.map(([ra, dec]) => [r2ra(ra), r2(dec)]));
    vertices += line.length;
  }
  figuresByAbbr.set(f.id, lines);
}
const figures = [...figuresByAbbr].map(([abbr, lines]) => ({ abbr, lines }));

// ---- FAIL-LOUD checks (the residual-check idiom) ------------------------------------------------
if (entries.length !== 88) fatal(`${entries.length} constellation entries — expected exactly 88`);
const abbrs = new Set(entries.map((e) => e.abbr));
if (abbrs.size !== 88) fatal("duplicate abbrs in CONSTELLATIONS");
const ori = entries.find((e) => e.abbr === "Ori");
if (!ori || ori.name !== "Orion" || ori.genitive !== "Orionis")
  fatal(`Orion drifted: ${JSON.stringify(ori)}`);
for (const want of ["UMa", "Cru", "And", "Ser"]) {
  if (!abbrs.has(want)) fatal(`${want} missing from CONSTELLATIONS`);
}
for (const e of entries) {
  if (!(e.raDeg >= 0 && e.raDeg < 360)) fatal(`${e.abbr}: raDeg ${e.raDeg} out of [0,360)`);
  if (!(e.decDeg >= -90 && e.decDeg <= 90)) fatal(`${e.abbr}: decDeg ${e.decDeg} out of [-90,90]`);
  if (!(e.rank >= 1 && e.rank <= 3)) fatal(`${e.abbr}: rank ${e.rank} out of 1..3`);
}
if (figures.length !== 88) fatal(`${figures.length} figures — expected exactly 88`);
for (const f of figures) if (!abbrs.has(f.abbr)) fatal(`figure ${f.abbr} has no CONSTELLATIONS entry`);
for (const e of entries) if (!figuresByAbbr.has(e.abbr)) fatal(`${e.abbr} has no line figure`);
for (const f of figures) {
  for (const line of f.lines) {
    for (const [ra, dec] of line) {
      if (!(ra >= 0 && ra < 360)) fatal(`figure ${f.abbr}: vertex raDeg ${ra} out of [0,360)`);
      if (!(dec >= -90 && dec <= 90)) fatal(`figure ${f.abbr}: vertex decDeg ${dec} out of [-90,90]`);
    }
  }
}
if (vertices <= 500) fatal(`only ${vertices} line vertices across figures — expected > 500`);

// ---- emit ---------------------------------------------------------------------------------------
const body = entries
  .map((e) => `  ${JSON.stringify(e)},`)
  .join("\n")
  .replace(/"(\w+)":/g, "$1: ");

const module_ = `// GENERATED by scripts/build-constellations.mjs — do not hand-edit; re-run to refresh.
// Data: d3-celestial (Olaf Frohn, BSD-3-Clause) — github.com/ofrohn/d3-celestial constellations.json.
// Serpens' two features (Caput + Cauda) are merged into ONE entry (Caput's centre, name "Serpens").
// Line figures live in public/data/constellation-lines.json (same source, same merge).

/** One IAU constellation — label anchor + names from d3-celestial. */
export interface ConstellationEntry {
  /** 3-letter IAU abbreviation — unique (Serpens merged into one entry). */
  abbr: string;
  name: string; // "Andromeda"
  genitive: string; // "Andromedae"
  /** Label-anchor centre from d3-celestial (NOT an official IAU centroid), J2000 deg. */
  raDeg: number; // normalized 0..360
  decDeg: number;
  /** Prominence rank 1..3 (1 = most prominent). */
  rank: number;
}

export const CONSTELLATIONS: ConstellationEntry[] = [
${body}
];
`;

const asset = JSON.stringify({
  credit: "d3-celestial (BSD-3-Clause) — constellation figures",
  figures,
});
if (Buffer.byteLength(asset) >= 120 * 1024)
  fatal(`constellation-lines.json is ${Buffer.byteLength(asset)} bytes — expected < 120 KB`);

writeFileSync(OUT_TS, module_);
writeFileSync(OUT_JSON, asset);

console.log(
  `OK: wrote ${entries.length} constellations (${Buffer.byteLength(module_)} bytes) to ` +
    `src/lib/sky/constellations.ts + ${figures.length} figures / ${vertices} vertices ` +
    `(${Buffer.byteLength(asset)} bytes) to public/data/constellation-lines.json`,
);
