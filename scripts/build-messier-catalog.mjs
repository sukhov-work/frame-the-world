#!/usr/bin/env node
/**
 * build-messier-catalog.mjs — bake the 110 Messier objects into `src/lib/sky/messier.ts`
 * (ASTRO ENGINE phase A: the hardcoded DSO half of the SKY search index).
 *
 * Source: OpenNGC (github.com/mattiaverga/OpenNGC), NGC.csv + addendum.csv — semicolon-delimited,
 * RA as HH:MM:SS.ss / Dec as ±DD:MM:SS.s (J2000), `M` column = zero-padded Messier cross-ref.
 * License: CC-BY-SA-4.0 — the generated module carries the attribution + license header, and the
 * TargetPanel prints "OPENNGC" in the source line for every DSO target.
 *
 * M102 policy (the catalog's one genuinely contested id): OpenNGC follows NED and treats M102 as
 * a duplicate observation of M101; the popular modern identification is NGC 5866. We take
 * whichever row OpenNGC tags `M 102` and KEEP its `Dup` type visible, so the panel can say the
 * identification is contested rather than silently picking a side.
 *
 * Needs network. Same run-once-and-commit idiom as build-comet-elements.mjs:
 *   node scripts/build-messier-catalog.mjs
 * Fails loud (exit 1) if any of M1–M110 is missing or a spot-check drifts >0.05°.
 */

import { writeFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files";
const OUT = new URL("../src/lib/sky/messier.ts", import.meta.url).pathname;

/** Semicolon CSV → array of row objects keyed by the header line. */
function parseCsv(text) {
  const [head, ...lines] = text.trim().split("\n");
  const cols = head.split(";");
  return lines.map((line) => {
    const cells = line.split(";");
    const row = {};
    cols.forEach((c, i) => (row[c] = cells[i] ?? ""));
    return row;
  });
}

/** `HH:MM:SS.ss` → degrees (×15). */
function raDeg(s) {
  const [h, m, sec] = s.split(":").map(Number);
  return (h + m / 60 + sec / 3600) * 15;
}

/** `±DD:MM:SS.s` → degrees. */
function decDeg(s) {
  const sign = s.trim().startsWith("-") ? -1 : 1;
  const [d, m, sec] = s.replace(/^[+-]/, "").split(":").map(Number);
  return sign * (d + m / 60 + sec / 3600);
}

const num = (s) => (s === "" || s == null ? null : Number(s));

async function fetchCsv(name) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText}`);
  return parseCsv(await res.text());
}

const rows = [...(await fetchCsv("NGC.csv")), ...(await fetchCsv("addendum.csv"))];

/** Messier number (1–110). The addendum's `M###` Name wins over the `M` column: for M102 the
 *  column holds `101` (the NED duplicate cross-ref), which would silently overwrite M101. */
function messierNo(row) {
  const m = /^M\s*0*(\d+)$/.exec(row.Name ?? "");
  if (m) return Number(m[1]);
  return /^\d+$/.test(row.M ?? "") ? Number(row.M) : null;
}

const byM = new Map();
for (const row of rows) {
  const n = messierNo(row);
  if (n == null || n < 1 || n > 110) continue;
  // NGC.csv is authoritative; the addendum fills the gaps (M40, M45…). First hit wins per file
  // order, EXCEPT a `Dup` NGC row loses to a real addendum row for the same number.
  const prev = byM.get(n);
  if (!prev || (prev.Type === "Dup" && row.Type !== "Dup")) byM.set(n, row);
}

const missing = [];
for (let n = 1; n <= 110; n++) if (!byM.has(n)) missing.push(`M${n}`);
if (missing.length) {
  console.error(`FATAL: missing from OpenNGC: ${missing.join(", ")}`);
  process.exit(1);
}

/** OpenNGC type code → the app's TargetKind + a human label for the card. */
const TYPES = {
  G: ["galaxy", "GALAXY"],
  GPair: ["galaxy", "GALAXY PAIR"],
  GGroup: ["galaxy", "GALAXY GROUP"],
  GTrpl: ["galaxy", "GALAXY TRIPLET"],
  OCl: ["cluster", "OPEN CLUSTER"],
  GCl: ["cluster", "GLOBULAR CLUSTER"],
  "Cl+N": ["nebula", "CLUSTER + NEBULA"],
  PN: ["nebula", "PLANETARY NEBULA"],
  SNR: ["nebula", "SUPERNOVA REMNANT"],
  Neb: ["nebula", "NEBULA"],
  HII: ["nebula", "H II REGION"],
  RfN: ["nebula", "REFLECTION NEBULA"],
  EmN: ["nebula", "EMISSION NEBULA"],
  DrkN: ["nebula", "DARK NEBULA"],
  "*": ["star", "STAR"],
  "**": ["star", "DOUBLE STAR"],
  "*Ass": ["cluster", "STELLAR ASSOCIATION"],
  Dup: ["other", "CONTESTED ID (SEE NOTES)"],
  Other: ["other", "OBJECT"],
};

const entries = [];
for (let n = 1; n <= 110; n++) {
  const r = byM.get(n);
  const [kind, typeLabel] = TYPES[r.Type] ?? ["other", r.Type.toUpperCase()];
  const names = (r["Common names"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ngc = /^(NGC|IC)/.test(r.Name) ? r.Name.replace(/^(NGC|IC)0*/, "$1 ") : null;
  entries.push({
    m: n,
    ngc,
    names,
    dsoType: r.Type,
    kind,
    typeLabel,
    raDeg: +raDeg(r.RA).toFixed(5),
    decDeg: +decDeg(r.Dec).toFixed(5),
    vmag: num(r["V-Mag"]) ?? num(r["B-Mag"]),
    majArcmin: num(r.MajAx),
    minArcmin: num(r.MinAx),
    paDeg: num(r.PosAng),
    constellation: r.Const || null,
  });
}

// Spot checks — fail loud rather than commit a shifted catalog (the residual-check idiom).
// Tolerance is per-row: compact objects 0.05°; wide clusters 0.5° (their "center" is a catalog
// convention — OpenNGC's Pleiades row sits on Alcyone, 0.25° from SIMBAD's centroid).
const SPOT = [
  [31, 10.6847, 41.2688, 0.05], // Andromeda Galaxy
  [42, 83.8221, -5.3911, 0.05], // Orion Nebula
  [45, 56.601, 24.114, 0.5], // Pleiades (center convention varies)
  [13, 250.4235, 36.4613, 0.05], // Hercules Cluster
];
for (const [n, ra, dec, tol] of SPOT) {
  const e = entries[n - 1];
  const dRa = Math.abs(e.raDeg - ra) * Math.cos((dec * Math.PI) / 180);
  const dDec = Math.abs(e.decDeg - dec);
  if (Math.hypot(dRa, dDec) > tol) {
    console.error(`FATAL: M${n} drifted — got ${e.raDeg},${e.decDeg}, expected ~${ra},${dec}`);
    process.exit(1);
  }
}
const noMag = entries.filter((e) => e.vmag == null).map((e) => `M${e.m}`);

const body = entries
  .map((e) => `  ${JSON.stringify(e)},`)
  .join("\n")
  .replace(/"(\w+)":/g, "$1: ");

writeFileSync(
  OUT,
  `// GENERATED by scripts/build-messier-catalog.mjs — do not edit by hand; re-run to refresh.
// Data: OpenNGC (github.com/mattiaverga/OpenNGC) NGC.csv + addendum.csv, CC-BY-SA-4.0.
// Attribution is REQUIRED wherever this data surfaces (TargetPanel prints "OPENNGC" per DSO).
// M102 carries OpenNGC's contested-id stance (type Dup) — the panel says so instead of picking.

/** One Messier object — J2000, magnitudes/type/size verbatim from OpenNGC. */
export interface MessierEntry {
  /** Messier number 1–110. */
  m: number;
  /** Primary NGC/IC designation, if the object has one. */
  ngc: string | null;
  /** Common names ("Andromeda Galaxy", …). */
  names: string[];
  /** OpenNGC type code (G, OCl, GCl, PN, SNR, …). */
  dsoType: string;
  kind: "galaxy" | "nebula" | "cluster" | "star" | "other";
  typeLabel: string;
  raDeg: number;
  decDeg: number;
  /** V magnitude (B where V is missing) — null when OpenNGC has neither. */
  vmag: number | null;
  majArcmin: number | null;
  minArcmin: number | null;
  paDeg: number | null;
  constellation: string | null;
}

export const MESSIER: MessierEntry[] = [
${body}
];
`,
);

console.log(
  `OK: wrote ${entries.length} objects to src/lib/sky/messier.ts` +
    (noMag.length ? ` (no magnitude: ${noMag.join(", ")})` : ""),
);
