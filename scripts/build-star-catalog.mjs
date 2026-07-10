/**
 * Build `public/data/bsc5.bin` — the packed Yale Bright Star Catalog asset (Phase 4, ADR D6).
 *
 * Run once (or on retune):  node scripts/build-star-catalog.mjs
 *
 * Source: https://brettonw.github.io/YaleBrightStarCatalog/bsc5.json (MIT, © 2016 Bretton Wade) —
 * a JSON conversion of Hoffleit D., Warren Jr W.H., "The Bright Star Catalogue, 5th Revised Ed."
 * (1991), 9,096 stars, RA/Dec J2000 as sexagesimal strings, Vmag + B-V. Verified against SIMBAD
 * (Sirius/Polaris) in the 2026-07-10 research pass.
 *
 * Output: little-endian float32 records [x, y, z, vmag, bv] (see `src/lib/ephemeris/stars.ts` —
 * the runtime parser + the layout contract + BV_SENTINEL for the 310 stars without B-V).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://brettonw.github.io/YaleBrightStarCatalog/bsc5.json";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "bsc5.bin");
const RECORD_FLOATS = 5; // = STAR_RECORD_FLOATS (lib/ephemeris/stars.ts)
const BV_SENTINEL = 9.99;

/** `"06h 45m 08.9s"` → decimal hours. */
function parseRa(s) {
  const m = /^(\d+)h\s+(\d+)m\s+([\d.]+)s$/.exec(s.trim());
  if (!m) throw new Error(`bad RA: ${s}`);
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
}

/** `"-16° 42′ 58″"` → decimal degrees (sign applies to all three parts). */
function parseDec(s) {
  const m = /^([+-]?)(\d+)°\s+(\d+)′\s+([\d.]+)″$/.exec(s.trim());
  if (!m) throw new Error(`bad Dec: ${s}`);
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600);
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
const catalog = await res.json();

const stars = catalog.filter((r) => r.RA && r.Dec && r.Vmag !== undefined);
const buf = new ArrayBuffer(stars.length * RECORD_FLOATS * 4);
const view = new DataView(buf);
let missingBv = 0;
stars.forEach((r, i) => {
  const ra = (parseRa(r.RA) * Math.PI) / 12; // hours → rad (15°/h)
  const dec = (parseDec(r.Dec) * Math.PI) / 180;
  const bvRaw = r["B-V"];
  const bv = bvRaw === undefined || bvRaw === "" ? (missingBv++, BV_SENTINEL) : Number(bvRaw);
  const o = i * RECORD_FLOATS * 4;
  view.setFloat32(o, Math.cos(dec) * Math.cos(ra), true); // little-endian, matches the parser
  view.setFloat32(o + 4, Math.cos(dec) * Math.sin(ra), true);
  view.setFloat32(o + 8, Math.sin(dec), true);
  view.setFloat32(o + 12, Number(r.Vmag), true);
  view.setFloat32(o + 16, bv, true);
});

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, Buffer.from(buf));

// Sanity echo: count, size, and the two anchor stars the unit tests assert.
const sirius = stars.find((r) => r.HR === "2491");
const polaris = stars.find((r) => r.HR === "424");
console.log(`wrote ${OUT}: ${stars.length} stars, ${(buf.byteLength / 1024).toFixed(1)} KB, ${missingBv} missing B-V`);
console.log(`  Sirius  HR2491: RA ${sirius?.RA} Dec ${sirius?.Dec} V ${sirius?.Vmag}`);
console.log(`  Polaris HR424 : RA ${polaris?.RA} Dec ${polaris?.Dec} V ${polaris?.Vmag}`);
