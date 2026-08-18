#!/usr/bin/env node
/**
 * build-openngc-catalog.mjs — bake the FULL OpenNGC deep-sky catalog (minus Messier / Dup / NonEx)
 * into a packed binary `public/data/openngc.bin` + its string tables `src/lib/sky/ngcNames.ts`.
 * The 110 Messier objects deliberately stay OUT of this bake — they already live (with richer
 * metadata) in `src/lib/sky/messier.ts`; every row whose `M` column is set is dropped here.
 *
 * Source: OpenNGC (github.com/mattiaverga/OpenNGC), NGC.csv (~13,970 rows) + addendum.csv (~64) —
 * SEMICOLON-delimited, RA "HH:MM:SS.ss" / Dec "±DD:MM:SS.s" (J2000), MajAx/MinAx arcmin,
 * PosAng deg. License: CC-BY-SA-4.0 — cite "OpenNGC (mattiaverga, CC-BY-SA-4.0)" wherever this
 * data surfaces. Column indices are resolved BY HEADER NAME, never hardcoded.
 *
 * Binary layout (little-endian DataView, same idiom as bsc5.bin / build-star-catalog.mjs):
 *   header: "ONGC" (4 ASCII bytes) + u32 version=1 + u32 count, then count × 20-byte records:
 *     u8  catalog   0=NGC, 1=IC, 2=extra (addendum objects with non-NGC/IC names — B033, Mel025…)
 *     u16 number    numeric part (NGC0521 → 521); catalog=2 → index into NGC_EXTRA_NAMES
 *     u8  suffixIdx 0=none, else 1-BASED index into NGC_SUFFIXES ("NGC0545A" → "A", " NED01"…)
 *     u8  typeIdx   index into NGC_TYPE_CODES
 *     u8  constIdx  index into NGC_CONST_CODES (0 reserved for none/blank)
 *     f32 raDeg (0..360) · f32 decDeg
 *     u8  mag       round((mag+2)*10) clamped 0..250, 255=none (V-Mag, fallback B-Mag)
 *     u8  pa        round(PosAng) 0..180, 255=none
 *     u16 majAx     round(MajAx*10) (0.1-arcmin units), 0=none · u16 minAx same
 *   (1+2+1+1+1+4+4+1+1+2+2 = 20 bytes)
 *
 * Needs network. Run-once-and-commit idiom:  node scripts/build-openngc-catalog.mjs
 * FAILS LOUD (exit 1) on any header/regex/range/count/round-trip violation.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BASE = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files";
const BIN_OUT = new URL("../public/data/openngc.bin", import.meta.url).pathname;
const TS_OUT = new URL("../src/lib/sky/ngcNames.ts", import.meta.url).pathname;

const HEADER_BYTES = 12;
const RECORD_BYTES = 20;

const fatal = (msg) => {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
};

/** Semicolon CSV → array of row objects keyed by the header line (messier-bake idiom). */
function parseCsv(text, file) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(";");
  // Assert every column we rely on exists at its expected header name — never trust positions.
  const REQUIRED = ["Name", "Type", "RA", "Dec", "Const", "MajAx", "MinAx", "PosAng", "B-Mag", "V-Mag", "M", "Common names"];
  for (const c of REQUIRED) if (!cols.includes(c)) fatal(`${file}: header is missing required column "${c}"`);
  return lines
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const cells = line.split(";");
      const row = {};
      cols.forEach((c, i) => (row[c] = (cells[i] ?? "").trim()));
      return row;
    });
}

/** `HH:MM:SS.ss` → degrees (×15). */
function raDeg(s) {
  const m = /^(\d+):(\d+):([\d.]+)$/.exec(s.trim());
  if (!m) return null;
  return (Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) * 15;
}

/** `±DD:MM:SS.s` → degrees (sign applies to all parts). */
function decDeg(s) {
  const m = /^([+-]?)(\d+):(\d+):([\d.]+)$/.exec(s.trim());
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600);
}

const num = (s) => (s === "" || s == null ? null : Number(s));

async function fetchCsv(name) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) fatal(`${name}: ${res.status} ${res.statusText}`);
  return parseCsv(await res.text(), name);
}

const ngcRows = await fetchCsv("NGC.csv");
const addRows = await fetchCsv("addendum.csv");
const allRows = [
  ...ngcRows.map((row) => ({ row, fromAddendum: false })),
  ...addRows.map((row) => ({ row, fromAddendum: true })),
];

// ---------------------------------------------------------------------------------------------
// Filter: Dup + NonEx out; every Messier-tagged row out (messier.ts owns M1–M110). The addendum
// M102 trap (Name "M102", M=101 — a NED cross-ref) is covered either way: all M-set rows drop.
// A Name of the bare "M###" form is Messier by definition too — guard it in case the M column is
// ever blank on such a row (would otherwise leak into the catalog=2 extras).
// ---------------------------------------------------------------------------------------------
let droppedDup = 0;
let droppedNonEx = 0;
let droppedMessier = 0;
const kept = [];
for (const { row, fromAddendum } of allRows) {
  if (row.Type === "Dup") { droppedDup++; continue; }
  if (row.Type === "NonEx") { droppedNonEx++; continue; }
  if (row.M !== "" || /^M\s*\d+$/.test(row.Name)) { droppedMessier++; continue; }
  kept.push({ row, fromAddendum });
}
if (kept.length < 13000 || kept.length > 13600) {
  fatal(`kept count ${kept.length} outside the expected [13000, 13600] window`);
}
for (const { row } of kept) if (row.M !== "") fatal(`kept row ${row.Name} still has M="${row.M}"`);

// ---------------------------------------------------------------------------------------------
// Parse names → catalog/number/suffix; discover the suffix set from the data itself.
// ---------------------------------------------------------------------------------------------
const NAME_RE = /^(NGC|IC)(\d{4})(.*)$/;
const suffixSet = new Set();
const extraNames = [];
const records = [];
for (const { row, fromAddendum } of kept) {
  const m = NAME_RE.exec(row.Name);
  let catalog, number, suffix;
  if (m) {
    catalog = m[1] === "NGC" ? 0 : 1;
    number = Number(m[2]);
    suffix = m[3].trim();
    if (suffix) suffixSet.add(suffix);
  } else if (fromAddendum) {
    catalog = 2;
    number = extraNames.length;
    extraNames.push(row.Name);
    suffix = "";
  } else {
    fatal(`NGC.csv Name "${row.Name}" matches neither /^(NGC|IC)\\d{4}/ nor the addendum-extra path`);
  }

  const ra = raDeg(row.RA);
  const dec = decDeg(row.Dec);
  if (ra == null || dec == null) fatal(`${row.Name}: unparseable RA/Dec "${row.RA}" / "${row.Dec}"`);
  if (ra < 0 || ra >= 360.000001 || dec < -90 || dec > 90) fatal(`${row.Name}: RA/Dec out of range (${ra}, ${dec})`);
  if (number > 0xffff) fatal(`${row.Name}: number ${number} exceeds u16`);

  const mag = num(row["V-Mag"]) ?? num(row["B-Mag"]);
  const magEnc = mag == null ? 255 : Math.max(0, Math.min(250, Math.round((mag + 2) * 10)));
  const pa = num(row.PosAng);
  if (pa != null && (Math.round(pa) < 0 || Math.round(pa) > 180)) fatal(`${row.Name}: PosAng ${pa} outside 0..180`);
  const paEnc = pa == null ? 255 : Math.round(pa);
  const majAx = num(row.MajAx);
  const minAx = num(row.MinAx);
  const majEnc = majAx == null ? 0 : Math.round(majAx * 10);
  const minEnc = minAx == null ? 0 : Math.round(minAx * 10);
  if (majEnc > 0xffff || minEnc > 0xffff) fatal(`${row.Name}: axis ${majAx}/${minAx} arcmin exceeds u16 tenths`);

  records.push({ row, catalog, number, suffix, ra, dec, mag, magEnc, paEnc, majEnc, minEnc, suffixIdx: 0, typeIdx: 0, constIdx: 0 });
}

// String tables. Suffix indexing is 1-BASED in the binary (0 = none); tables are sorted for
// deterministic re-bakes, except NGC_EXTRA_NAMES which MUST stay in record order (number = index).
const NGC_SUFFIXES = [...suffixSet].sort();
if (NGC_SUFFIXES.length > 250) fatal(`${NGC_SUFFIXES.length} distinct suffixes exceed the u8 budget (250)`);
const suffixIdxOf = new Map(NGC_SUFFIXES.map((s, i) => [s, i + 1]));
const NGC_TYPE_CODES = [...new Set(records.map((r) => r.row.Type))].sort();
if (NGC_TYPE_CODES.length > 255) fatal(`type table exceeds u8`);
const typeIdxOf = new Map(NGC_TYPE_CODES.map((t, i) => [t, i]));
const NGC_CONST_CODES = ["", ...[...new Set(records.map((r) => r.row.Const).filter(Boolean))].sort()];
if (NGC_CONST_CODES.length > 255) fatal(`constellation table exceeds u8`);
const constIdxOf = new Map(NGC_CONST_CODES.map((c, i) => [c, i]));
for (const r of records) {
  r.suffixIdx = r.suffix ? suffixIdxOf.get(r.suffix) : 0;
  r.typeIdx = typeIdxOf.get(r.row.Type);
  r.constIdx = constIdxOf.get(r.row.Const || "");
}

// Common names: one entry per comma-separated name on every KEPT row (Messier names live in
// messier.ts and are excluded with their rows). ref = verbatim OpenNGC Name.
const commonNames = [];
for (const r of records) {
  for (const name of r.row["Common names"].split(",").map((s) => s.trim()).filter(Boolean)) {
    commonNames.push({ name, ref: r.row.Name });
  }
}

// ---------------------------------------------------------------------------------------------
// Output 1 — public/data/openngc.bin
// ---------------------------------------------------------------------------------------------
const buf = new ArrayBuffer(HEADER_BYTES + RECORD_BYTES * records.length);
const view = new DataView(buf);
"ONGC".split("").forEach((ch, i) => view.setUint8(i, ch.charCodeAt(0)));
view.setUint32(4, 1, true); // version
view.setUint32(8, records.length, true);
records.forEach((r, i) => {
  const o = HEADER_BYTES + i * RECORD_BYTES;
  view.setUint8(o, r.catalog);
  view.setUint16(o + 1, r.number, true);
  view.setUint8(o + 3, r.suffixIdx);
  view.setUint8(o + 4, r.typeIdx);
  view.setUint8(o + 5, r.constIdx);
  view.setFloat32(o + 6, r.ra, true);
  view.setFloat32(o + 10, r.dec, true);
  view.setUint8(o + 14, r.magEnc);
  view.setUint8(o + 15, r.paEnc);
  view.setUint16(o + 16, r.majEnc, true);
  view.setUint16(o + 18, r.minEnc, true);
});
mkdirSync(dirname(BIN_OUT), { recursive: true });
writeFileSync(BIN_OUT, Buffer.from(buf));

// ---------------------------------------------------------------------------------------------
// Output 2 — src/lib/sky/ngcNames.ts
// ---------------------------------------------------------------------------------------------
const list = (arr) => arr.map((s) => JSON.stringify(s)).join(", ");
writeFileSync(
  TS_OUT,
  `// GENERATED by scripts/build-openngc-catalog.mjs — do not hand-edit; re-run to refresh.
// Baked: ${new Date().toISOString().slice(0, 10)} from the OpenNGC snapshot fetched this run (audit-2 B3: date every bake).
// Data: OpenNGC (mattiaverga, CC-BY-SA-4.0) — github.com/mattiaverga/OpenNGC, NGC.csv + addendum.csv.
// Attribution is REQUIRED wherever this data surfaces. String tables for public/data/openngc.bin
// (binary layout documented in the bake script header). Messier objects are NOT here — see messier.ts.

export const NGC_TYPE_CODES: readonly string[] = [${list(NGC_TYPE_CODES)}];
export const NGC_CONST_CODES: readonly string[] = [${list(NGC_CONST_CODES)}]; // index 0 = ""
export const NGC_SUFFIXES: readonly string[] = [${list(NGC_SUFFIXES)}]; // 1-based indexing: suffixIdx 1 → [0]
/** Addendum objects whose Name is not NGC/IC-numbered (Barnard, Melotte…): catalog=2 records
 *  point here via their \`number\` field (index into this array). */
export const NGC_EXTRA_NAMES: readonly string[] = [${list(extraNames)}]; // verbatim OpenNGC Name, e.g. "B033"
export interface NgcCommonName { name: string; ref: string } // ref = verbatim OpenNGC Name
export const NGC_COMMON_NAMES: readonly NgcCommonName[] = [
${commonNames.map((n) => `  { name: ${JSON.stringify(n.name)}, ref: ${JSON.stringify(n.ref)} },`).join("\n")}
];
`,
);

// ---------------------------------------------------------------------------------------------
// FAIL-LOUD verification — RE-READ the binary from disk and decode with a fresh DataView.
// ---------------------------------------------------------------------------------------------
const raw = readFileSync(BIN_OUT);
if (raw.byteLength !== HEADER_BYTES + RECORD_BYTES * records.length) {
  fatal(`file size ${raw.byteLength} ≠ ${HEADER_BYTES} + ${RECORD_BYTES}×${records.length}`);
}
const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
if (String.fromCharCode(rv.getUint8(0), rv.getUint8(1), rv.getUint8(2), rv.getUint8(3)) !== "ONGC") fatal("bad magic");
if (rv.getUint32(4, true) !== 1) fatal("bad version");
if (rv.getUint32(8, true) !== records.length) fatal("bad count");

const decoded = [];
for (let i = 0; i < records.length; i++) {
  const o = HEADER_BYTES + i * RECORD_BYTES;
  const d = {
    catalog: rv.getUint8(o),
    number: rv.getUint16(o + 1, true),
    suffixIdx: rv.getUint8(o + 3),
    typeIdx: rv.getUint8(o + 4),
    constIdx: rv.getUint8(o + 5),
    ra: rv.getFloat32(o + 6, true),
    dec: rv.getFloat32(o + 10, true),
    mag: rv.getUint8(o + 14),
    pa: rv.getUint8(o + 15),
    majAx: rv.getUint16(o + 16, true),
    minAx: rv.getUint16(o + 18, true),
  };
  decoded.push(d);
  const e = records[i];
  // Every index must round-trip through its table back to the source string.
  const suf = d.suffixIdx === 0 ? "" : NGC_SUFFIXES[d.suffixIdx - 1];
  if (suf === undefined || suf !== e.suffix) fatal(`record ${i} (${e.row.Name}): suffixIdx ${d.suffixIdx} ↛ "${e.suffix}"`);
  if (NGC_TYPE_CODES[d.typeIdx] !== e.row.Type) fatal(`record ${i} (${e.row.Name}): typeIdx ${d.typeIdx} ↛ "${e.row.Type}"`);
  if (NGC_CONST_CODES[d.constIdx] !== (e.row.Const || "")) fatal(`record ${i} (${e.row.Name}): constIdx ${d.constIdx} ↛ "${e.row.Const}"`);
  if (d.catalog === 2 && extraNames[d.number] !== e.row.Name) fatal(`record ${i}: extra number ${d.number} ↛ "${e.row.Name}"`);
}

// Spot round-trips: decoded bin values vs the CSV-parsed truth (±1e-3 deg, ±0.15 mag, ±0.15′).
const byName = new Map(records.map((r, i) => [r.row.Name, i]));
function spot(name, alsoCommonName) {
  const i = byName.get(name);
  if (i === undefined) fatal(`spot object ${name} missing from the baked set`);
  const e = records[i];
  const d = decoded[i];
  if (Math.abs(d.ra - e.ra) > 1e-3 || Math.abs(d.dec - e.dec) > 1e-3) {
    fatal(`${name}: RA/Dec drift — bin (${d.ra}, ${d.dec}) vs CSV (${e.ra}, ${e.dec})`);
  }
  const dMag = d.mag === 255 ? null : d.mag / 10 - 2;
  if ((dMag == null) !== (e.mag == null) || (dMag != null && Math.abs(dMag - e.mag) > 0.15)) {
    fatal(`${name}: mag drift — bin ${dMag} vs CSV ${e.mag}`);
  }
  const dMaj = d.majAx === 0 ? null : d.majAx / 10;
  const eMaj = num(e.row.MajAx);
  if ((dMaj == null) !== (eMaj == null) || (dMaj != null && Math.abs(dMaj - eMaj) > 0.15)) {
    fatal(`${name}: MajAx drift — bin ${dMaj} vs CSV ${eMaj}`);
  }
  if (alsoCommonName && !commonNames.some((n) => n.name === alsoCommonName && n.ref === name)) {
    fatal(`common name "${alsoCommonName}" → ${name} missing from NGC_COMMON_NAMES`);
  }
  return { e, d };
}
spot("NGC7000", "North America Nebula");
spot("IC0434");
spot("NGC0891");
const b33 = spot("B033", "Horsehead Nebula");
if (b33.d.catalog !== 2) fatal(`B033: expected catalog=2, got ${b33.d.catalog}`);
if (extraNames[b33.d.number] !== "B033") fatal(`B033: NGC_EXTRA_NAMES[${b33.d.number}] ≠ "B033"`);
if (decoded.some((d) => d.catalog === 0 && d.number === 224)) fatal("NGC0224 (M31) leaked into the binary — Messier drop failed");

// ---------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------
const typeDist = {};
for (const r of records) typeDist[r.row.Type] = (typeDist[r.row.Type] ?? 0) + 1;
console.log(`OK: wrote ${BIN_OUT} (${raw.byteLength} bytes) + ${TS_OUT}`);
console.log(`  kept ${records.length} objects (NGC ${records.filter((r) => r.catalog === 0).length}, IC ${records.filter((r) => r.catalog === 1).length}, extra ${extraNames.length})`);
console.log(`  dropped: Dup ${droppedDup}, NonEx ${droppedNonEx}, Messier ${droppedMessier}`);
console.log(`  suffixes (${NGC_SUFFIXES.length}): ${NGC_SUFFIXES.map((s) => JSON.stringify(s)).join(" ")}`);
console.log(`  types: ${Object.entries(typeDist).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(" ")}`);
console.log(`  common names: ${commonNames.length} · extras: ${extraNames.join(", ")}`);
console.log(`  spot-checked NGC7000 / IC0434 / NGC0891 / B033; NGC0224 (M31) confirmed absent`);
