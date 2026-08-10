#!/usr/bin/env node
/**
 * build-star-names.mjs — bake the IAU official proper star names into `src/lib/sky/starNames.ts`
 * (ASTRO ENGINE: the named-star half of the SKY search index).
 *
 * Source: IAU WGSN IAU-CSN (2022-04-04) — https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt
 * (IAU Working Group on Star Names, ~451 rows). License: CC-BY per the file header — IAU products
 * are Creative Commons Attribution, "free to use … as long as the source is mentioned"; the
 * generated module carries the attribution.
 *
 * The file is FIXED-WIDTH and names contain spaces ("Alula Australis", "Barnard's Star") — the
 * name columns must NEVER be whitespace-split. Column slices are derived from the layout itself:
 * a character position is a separator iff it is a space in EVERY data row; the resulting spans are
 * verified against the header row's 16 labels and spot-checked on the first data rows (Absolutno,
 * Acamar). Any upstream layout drift fails loud here instead of shipping shifted columns.
 * One header line in the source starts with `$` instead of `#` (an upstream typo) — both are
 * treated as comments.
 *
 * Needs network. Same run-once-and-commit idiom as build-messier-catalog.mjs:
 *   node scripts/build-star-names.mjs
 * Fails loud (exit 1) on count / uniqueness / coordinate-range / spot-check drift.
 */

import { writeFileSync } from "node:fs";

const SRC = "https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt";
const OUT = new URL("../src/lib/sky/starNames.ts", import.meta.url).pathname;

function fatal(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

const res = await fetch(SRC);
if (!res.ok) fatal(`${SRC}: ${res.status} ${res.statusText}`);
const text = await res.text();

const lines = text.split("\n");
// Comment lines start with "#" (one stray header line starts with "$" — upstream typo).
const dataRows = lines.filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("$"));
if (dataRows.length < 400) fatal(`only ${dataRows.length} data rows — layout or filter drifted`);

/** Fixed-width spans: a char column is a separator iff it is a space in EVERY data row. */
function deriveSpans(rows) {
  const maxLen = Math.max(...rows.map((l) => l.length));
  const spans = [];
  let start = -1;
  for (let i = 0; i <= maxLen; i++) {
    const isGap = i === maxLen || rows.every((l) => (l[i] ?? " ") === " ");
    if (!isGap && start === -1) start = i;
    if (isGap && start !== -1) {
      spans.push([start, i]);
      start = -1;
    }
  }
  return spans;
}

// Expected 16 columns, per the header row:
// Name/ASCII  Name/Diacritics  Designation  ID  ID(greek)  Con  #  WDS_J  mag  bnd  HIP  HD
// RA(J2000)  Dec(J2000)  Date  Notes
const spans = deriveSpans(dataRows);
if (spans.length !== 16)
  fatal(`derived ${spans.length} columns, expected 16 — spans: ${JSON.stringify(spans)}`);
const [C_NAME, , C_DESIG, C_ID, , C_CON, , , C_MAG, , C_HIP, C_HD, C_RA, C_DEC] = spans;

// Verify the slicing against the header labels + the first data rows (the layout contract).
const header = lines.find((l) => l.startsWith("#Name/ASCII"));
if (!header) fatal("header row '#Name/ASCII …' not found");
const slice = (row, [a, b]) => row.slice(a, b).trim();
if (slice(header, C_DESIG) !== "Designation" || slice(header, C_CON) !== "Con")
  fatal("derived spans do not line up with the header labels");
if (slice(dataRows[0], C_NAME) !== "Absolutno" || slice(dataRows[0], C_DESIG) !== "XO-5")
  fatal(`row 0 mis-sliced: ${JSON.stringify(dataRows[0].slice(0, 60))}`);
if (slice(dataRows[1], C_ID) !== "tet01" || slice(dataRows[1], C_CON) !== "Eri")
  fatal(`row 1 (Acamar) mis-sliced: ${JSON.stringify(dataRows[1].slice(0, 70))}`);

const nul = (s) => (s === "" || s === "_" ? null : s);
const numOrNull = (s) => {
  const v = nul(s);
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) fatal(`non-numeric cell where a number was expected: "${s}"`);
  return n;
};

const entries = [];
const skipped = [];
for (const row of dataRows) {
  const name = slice(row, C_NAME);
  const designation = slice(row, C_DESIG);
  const id = nul(slice(row, C_ID));
  const con = nul(slice(row, C_CON));
  const raDeg = Number(slice(row, C_RA));
  const decDeg = Number(slice(row, C_DEC));
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) {
    skipped.push(name || row.slice(0, 24)); // keep pulsar/exoplanet hosts; drop only unlocatable rows
    continue;
  }
  const hr = /^HR (\d+)$/.exec(designation);
  entries.push({
    name,
    designation,
    hr: hr ? Number(hr[1]) : null,
    bayer: id && con ? `${id} ${con}` : null,
    con,
    hip: numOrNull(slice(row, C_HIP)),
    hd: numOrNull(slice(row, C_HD)),
    vmag: numOrNull(slice(row, C_MAG)),
    raDeg,
    decDeg,
  });
}

// ---- FAIL-LOUD checks (the residual-check idiom) ------------------------------------------------
if (entries.length < 440 || entries.length > 470)
  fatal(`${entries.length} entries — expected 440–470`);
const names = new Set(entries.map((e) => e.name));
if (names.size !== entries.length) fatal("duplicate star names in the catalog");
for (const e of entries) {
  if (!(e.raDeg >= 0 && e.raDeg < 360)) fatal(`${e.name}: raDeg ${e.raDeg} out of [0,360)`);
  if (!(e.decDeg >= -90 && e.decDeg <= 90)) fatal(`${e.name}: decDeg ${e.decDeg} out of [-90,90]`);
}
const byName = new Map(entries.map((e) => [e.name, e]));
function spot(name, check, label) {
  const e = byName.get(name);
  if (!e) fatal(`spot check: ${name} missing`);
  if (!check(e)) fatal(`spot check drifted: ${name} ${label} — got ${JSON.stringify(e)}`);
  return e;
}
spot("Vega", (e) => e.hr === 7001, "hr=7001");
spot("Vega", (e) => Math.abs(e.raDeg - 279.2347) <= 0.01, "raDeg≈279.2347");
spot("Vega", (e) => Math.abs(e.decDeg - 38.783) <= 0.01, "decDeg≈38.783");
spot("Vega", (e) => e.vmag != null && Math.abs(e.vmag - 0.03) <= 0.1, "vmag≈0.03");
spot("Polaris", (e) => e.hr === 424, "hr=424");
spot("Sirius", (e) => e.hr === 2491, "hr=2491");
spot("Sirius", (e) => e.vmag != null && Math.abs(e.vmag - -1.44) <= 0.1, "vmag≈-1.44");
spot("Acamar", (e) => e.hr === 897 && e.con === "Eri", "hr=897 con=Eri");
const withHr = entries.filter((e) => e.hr != null).length;
if (withHr < 320) fatal(`only ${withHr} entries carry an HR number — expected ≥ 320`);

// ---- emit ---------------------------------------------------------------------------------------
const body = entries
  .map((e) => `  ${JSON.stringify(e)},`)
  .join("\n")
  .replace(/"(\w+)":/g, "$1: ");

const module_ = `// GENERATED by scripts/build-star-names.mjs — do not hand-edit; re-run to refresh.
// Data: IAU WGSN IAU-CSN (2022-04-04) — pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt, CC-BY.
// Attribution (IAU / WGSN) is required wherever these names surface.

/** One IAU-named star — J2000, values verbatim from the IAU-CSN table. */
export interface StarNameEntry {
  /** IAU proper name (ASCII form). */
  name: string;
  /** Primary catalog designation, e.g. "HR 7001". */
  designation: string;
  /** Harvard Revised (Bright Star) number when the designation is HR, else null. */
  hr: number | null;
  /** Bayer-style short id + constellation, e.g. "alp Lyr", "tet01 Eri" — null when absent. */
  bayer: string | null;
  /** IAU constellation abbreviation ("Lyr"), null when absent. */
  con: string | null;
  hip: number | null;
  hd: number | null;
  vmag: number | null;
  /** J2000, decimal degrees. */
  raDeg: number;
  decDeg: number;
}

export const STAR_NAMES: StarNameEntry[] = [
${body}
];
`;

writeFileSync(OUT, module_);

console.log(
  `OK: wrote ${entries.length} star names (${withHr} with HR, ${Buffer.byteLength(module_)} bytes) ` +
    `to src/lib/sky/starNames.ts` +
    (skipped.length ? ` — skipped (no RA/Dec): ${skipped.join(", ")}` : ""),
);
