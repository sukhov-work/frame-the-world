// Overpass fetch for building footprints (ways with inline geometry + multipolygon relations),
// cached on disk so re-bakes don't re-query. `out geom` inlines each node's lat/lon per way, so no
// separate node resolution is needed. All inputs are public OSM data (ODbL — attribute downstream).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "..", ".cache");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const UA = "frame-the-world-bake/1.0 (Dnipro 3D enrichment; OSM ODbL)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch building geometry for bbox [west,south,east,north] (deg). Cached; pass {refresh:true} to force.
 *  Cycles mirror endpoints with backoff — Overpass rate-limits (429) + times out (504) under load. */
export async function fetchBuildings(bbox, { refresh = false } = {}) {
  const [w, s, e, n] = bbox;
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `osm-${s.toFixed(4)}_${w.toFixed(4)}_${n.toFixed(4)}_${e.toFixed(4)}.json`);
  if (!refresh && existsSync(cachePath)) {
    return { json: JSON.parse(readFileSync(cachePath, "utf8")), cached: true, cachePath };
  }
  const q =
    `[out:json][timeout:180];(` +
    `way["building"](${s},${w},${n},${e});` +
    `relation["building"]["type"="multipolygon"](${s},${w},${n},${e});` +
    `);out body geom;`;
  let lastErr;
  for (let round = 0; round < 3; round++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
          body: "data=" + encodeURIComponent(q),
        });
        if (res.status === 429 || res.status === 504) { lastErr = new Error(`${url} → HTTP ${res.status}`); continue; }
        if (!res.ok) { lastErr = new Error(`${url} → HTTP ${res.status}`); continue; }
        const json = await res.json();
        if (!Array.isArray(json.elements)) { lastErr = new Error(`${url} → no elements`); continue; }
        writeFileSync(cachePath, JSON.stringify(json));
        return { json, cached: false, cachePath };
      } catch (err) {
        lastErr = err;
      }
    }
    if (round < 2) { const wait = 12000 * (round + 1); console.log(`  … Overpass busy (${lastErr?.message}); backoff ${wait / 1000}s`); await sleep(wait); }
  }
  throw lastErr ?? new Error("Overpass fetch failed (all endpoints)");
}

/**
 * Flatten an Overpass response into building footprints. `osm` is the stable OSM element id
 * (U8: carried into the per-cell `.meta.json` sidecar so height-override keys survive re-bakes
 * — bake-sequential feature ids reshuffle, element ids don't): `w<id>` for ways; a relation
 * with N outer rings yields N footprints sharing the relation id, disambiguated `r<id>#<ring>`
 * (an override must hit ONE ring, not all of them).
 * @returns {Array<{tags:Record<string,string>, ring:[number,number][], osm:string}>} ring = [[lon,lat],…]
 */
export function extractFootprints(json) {
  const buildings = [];
  for (const el of json.elements ?? []) {
    if (el.type === "way" && Array.isArray(el.geometry)) {
      buildings.push({
        tags: el.tags ?? {},
        ring: el.geometry.map((g) => [g.lon, g.lat]),
        osm: `w${el.id}`,
      });
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      // Multipolygon: treat each outer ring as its own footprint carrying the relation's tags.
      let outerIdx = 0;
      for (const m of el.members) {
        if (m.role === "outer" && Array.isArray(m.geometry)) {
          buildings.push({
            tags: el.tags ?? {},
            ring: m.geometry.map((g) => [g.lon, g.lat]),
            osm: `r${el.id}#${outerIdx++}`,
          });
        }
      }
    }
  }
  return buildings;
}
