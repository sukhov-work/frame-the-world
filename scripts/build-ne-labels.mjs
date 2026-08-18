#!/usr/bin/env node
/**
 * build-ne-labels.mjs — bake the Natural Earth geo-label assets (Phase 5.5 S7b, §Item 2b).
 * Last baked: 2026-07-12 (git-dated, audit-2 B3) — update this line on regen (the JSON assets
 * carry no header to stamp).
 *
 * Fetches Natural Earth 50m GeoJSON (public domain, naturalearthdata.com) from the canonical
 * nvkelso/natural-earth-vector mirror and writes two compact assets:
 *
 *   public/data/ne-boundaries.bin — country boundary polylines, Float32 little-endian:
 *     [partCount, count0, count1, …, then for each part count·(latDeg, lonDeg)]
 *     (loader: scene/geoLabels.ts builds one LineSegments from consecutive vertex pairs)
 *
 *   public/data/ne-places.json — { credit, places: [[name, scalerank, latDeg, lonDeg], …] }
 *     sorted by scalerank ascending (0–1 megacities … 8+ towns) for rank-gated culling.
 *
 * Run once (needs network), commit the output — same idiom as build-star-catalog.mjs.
 *   node scripts/build-ne-labels.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const BOUNDARIES_SRC = `${BASE}/ne_50m_admin_0_boundary_lines_land.geojson`;
const PLACES_SRC = `${BASE}/ne_50m_populated_places_simple.geojson`;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.json();
};

// --- boundaries → packed Float32 polylines ---------------------------------------------------
const boundaries = await fetchJson(BOUNDARIES_SRC);
const parts = [];
for (const feature of boundaries.features) {
  const g = feature.geometry;
  if (!g) continue;
  const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
  for (const line of lines) {
    if (line.length >= 2) parts.push(line);
  }
}
const totalVerts = parts.reduce((n, p) => n + p.length, 0);
const bin = new Float32Array(1 + parts.length + totalVerts * 2);
bin[0] = parts.length;
parts.forEach((p, i) => (bin[1 + i] = p.length));
let w = 1 + parts.length;
for (const p of parts) {
  for (const [lonDeg, latDeg] of p) {
    bin[w++] = latDeg;
    bin[w++] = lonDeg;
  }
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "ne-boundaries.bin"), Buffer.from(bin.buffer));
console.log(
  `wrote ne-boundaries.bin: ${parts.length} parts, ${totalVerts} vertices, ${Math.round(bin.byteLength / 1024)} KB`,
);

// --- populated places → compact ranked JSON ---------------------------------------------------
const placesSrc = await fetchJson(PLACES_SRC);
const places = [];
for (const feature of placesSrc.features) {
  const p = feature.properties ?? {};
  const name = p.name ?? p.NAME;
  const rank = p.scalerank ?? p.SCALERANK;
  const lat = p.latitude ?? feature.geometry?.coordinates?.[1];
  const lon = p.longitude ?? feature.geometry?.coordinates?.[0];
  if (!name || rank == null || lat == null || lon == null) continue;
  places.push([name, rank, Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4]);
}
places.sort((a, b) => a[1] - b[1]);
writeFileSync(
  join(OUT_DIR, "ne-places.json"),
  JSON.stringify({
    credit: "Populated places & boundaries from Natural Earth (naturalearthdata.com), public domain",
    places,
  }),
);
console.log(`wrote ne-places.json: ${places.length} places`);
