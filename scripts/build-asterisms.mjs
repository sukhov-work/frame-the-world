#!/usr/bin/env node
/**
 * build-asterisms.mjs — bake the FPV/night-sky asterism figures (Phase 5.5 S6, §Item 4).
 *
 * Fetches d3-celestial's asterisms.json (BSD-3-Clause, © Olaf Frohn — attribution kept in the
 * baked asset), keeps the famous figures (priority p ≤ MAX_PRIORITY ≈ the "~20 main asterisms"
 * of the design), dedupes repeated ids, and writes a compact `public/data/asterisms.json`:
 *
 *   { credit: "...", asterisms: [{ id, name, lines: [[[raDeg0to360, decDeg], …], …] }, …] }
 *
 * RA arrives mapped to ±180° (d3-celestial convention) and is re-mapped to 0–360 DEGREES here.
 * NOTE: `lib/ephemeris/stars.ts raDecToUnit` takes RA in HOURS — the runtime loader divides by 15.
 *
 * Run once (needs network), commit the output — same idiom as build-star-catalog.mjs.
 *   node scripts/build-asterisms.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE =
  "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/asterisms.json";
const MAX_PRIORITY = 3; // p1 seasonal landmarks … p3 classic figures ⇒ 26 figures, ~190 vertices
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "asterisms.json");

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`fetch ${SOURCE} → ${res.status}`);
const collection = await res.json();

const seen = new Set();
const asterisms = [];
for (const feature of collection.features) {
  const { id } = feature;
  const { n: name, p: priority } = feature.properties;
  if (priority > MAX_PRIORITY || seen.has(id)) continue;
  seen.add(id);
  const lines = feature.geometry.coordinates.map((seg) =>
    seg.map(([raPm180, decDeg]) => [
      Math.round(((raPm180 + 360) % 360) * 1e4) / 1e4,
      Math.round(decDeg * 1e4) / 1e4,
    ]),
  );
  asterisms.push({ id, name, lines });
}

const out = {
  credit:
    "Asterism figures from d3-celestial (github.com/ofrohn/d3-celestial), BSD-3-Clause, © Olaf Frohn",
  asterisms,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const vertices = asterisms.reduce(
  (n, a) => n + a.lines.reduce((m, l) => m + l.length, 0),
  0,
);
console.log(`wrote ${OUT}: ${asterisms.length} asterisms, ${vertices} vertices`);
