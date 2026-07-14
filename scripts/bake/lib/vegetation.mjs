// Vegetation stage (Slice 3): OSM tree points / tree rows / green polygons → deterministic tree
// placements. Dnipro maps only ~418 individual `natural=tree` nodes (probed 2026-07-13), so the bulk
// comes from seeded scatter over `natural=wood` / `landuse=forest` / `leisure=park` polygons +
// spacing samples along `natural=tree_row` ways. Everything is DETERMINISTIC (hash-seeded, no
// Math.random) so a re-bake is byte-identical — the same reproducibility contract as the buildings.
// Canopy-height rasters (ETH 10 m / Meta 1 m, CC-BY) are the documented UPGRADE tier (README):
// parsing GeoTIFF needs deps this env can't install (public npm blocked), and OSM+class heights
// already carry the stylized look.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pointInPolygon } from "./exclusion.mjs";
import { parseMeters } from "./buildings.mjs";

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

/** Fetch vegetation geometry for bbox [west,south,east,north] (deg). Cached like fetchBuildings. */
export async function fetchVegetation(bbox, { refresh = false } = {}) {
  const [w, s, e, n] = bbox;
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `osm-veg-${s.toFixed(4)}_${w.toFixed(4)}_${n.toFixed(4)}_${e.toFixed(4)}.json`);
  if (!refresh && existsSync(cachePath)) {
    return { json: JSON.parse(readFileSync(cachePath, "utf8")), cached: true, cachePath };
  }
  const B = `(${s},${w},${n},${e})`;
  const q =
    `[out:json][timeout:180];(` +
    `node["natural"="tree"]${B};` +
    `way["natural"="tree_row"]${B};` +
    `way["natural"="wood"]${B};relation["natural"="wood"]${B};` +
    `way["landuse"="forest"]${B};relation["landuse"="forest"]${B};` +
    `way["leisure"="park"]${B};relation["leisure"="park"]${B};` +
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
  throw lastErr ?? new Error("Overpass vegetation fetch failed (all endpoints)");
}

/**
 * Flatten an Overpass vegetation response.
 * @returns {{points:Array<{lon:number,lat:number,tags:Record<string,string>}>,
 *            rows:Array<{line:[number,number][], tags:Record<string,string>}>,
 *            polys:Array<{ring:[number,number][], kind:"wood"|"park", tags:Record<string,string>}>}}
 */
export function extractVegetation(json) {
  const points = [], rows = [], polys = [];
  const kindOf = (tags) =>
    tags.natural === "wood" || tags.landuse === "forest" ? "wood"
    : tags.leisure === "park" ? "park"
    : null;
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    if (el.type === "node" && tags.natural === "tree") {
      points.push({ lon: el.lon, lat: el.lat, tags });
    } else if (el.type === "way" && Array.isArray(el.geometry)) {
      if (tags.natural === "tree_row") {
        rows.push({ line: el.geometry.map((g) => [g.lon, g.lat]), tags });
      } else {
        const kind = kindOf(tags);
        if (kind) polys.push({ ring: el.geometry.map((g) => [g.lon, g.lat]), kind, tags });
      }
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      const kind = kindOf(tags);
      if (!kind) continue;
      // Multipolygon: outer rings only (holes/clearings ignored — same simplification as buildings).
      for (const m of el.members) {
        if (m.role === "outer" && Array.isArray(m.geometry)) {
          polys.push({ ring: m.geometry.map((g) => [g.lon, g.lat]), kind, tags });
        }
      }
    }
  }
  return { points, rows, polys };
}

// ── deterministic RNG ─────────────────────────────────────────────────────────────────────────────

/** FNV-1a-style integer hash of a list of int32s → uint32 (stable across runs/platforms). */
export function hashSeed(...nums) {
  let h = 0x811c9dc5;
  for (const n of nums) {
    let x = n | 0;
    for (let k = 0; k < 4; k++) {
      h ^= (x >>> (k * 8)) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/** mulberry32 PRNG — returns a () => [0,1) function. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── building-footprint rejection index ────────────────────────────────────────────────────────────

/**
 * Spatial-hash index over building footprint rings ([[lon,lat],…]) for O(1)-ish "is this point
 * inside any building" rejection. Bucket ~55 m; each ring registered in every bucket its bbox spans.
 */
export function buildFootprintIndex(rings, cellDeg = 0.0005) {
  const buckets = new Map(); // "i,j" → ring[]
  for (const ring of rings) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    const i0 = Math.floor(minLon / cellDeg), i1 = Math.floor(maxLon / cellDeg);
    const j0 = Math.floor(minLat / cellDeg), j1 = Math.floor(maxLat / cellDeg);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = `${i},${j}`;
        let list = buckets.get(key);
        if (!list) { list = []; buckets.set(key, list); }
        list.push(ring);
      }
    }
  }
  return {
    blocked(lon, lat) {
      const list = buckets.get(`${Math.floor(lon / cellDeg)},${Math.floor(lat / cellDeg)}`);
      if (!list) return false;
      for (const ring of list) if (pointInPolygon(lon, lat, ring)) return true;
      return false;
    },
  };
}

// ── placement generation ──────────────────────────────────────────────────────────────────────────

const DEFAULT_VEG = {
  spacingWoodM: 13,
  spacingParkM: 24,
  rowSpacingM: 9,
  heightM: { default: [8, 15], wood: [10, 17], park: [8, 14], row: [7, 12] },
  canopyRadiusK: 0.32,
  maxTrees: 60000,
};

const M_PER_DEG_LAT = 111320;

function treeParams(rng, [lo, hi], canopyRadiusK) {
  const heightM = lo + (hi - lo) * rng();
  const radiusM = canopyRadiusK * heightM * (0.85 + 0.3 * rng());
  const yawRad = 2 * Math.PI * rng();
  return { heightM, radiusM, yawRad };
}

/**
 * Generate deterministic tree placements from extracted vegetation.
 * @param {{points:any[], rows:any[], polys:any[]}} veg
 * @param {{bbox:[number,number,number,number], footprintIndex?:{blocked:Function},
 *          excluder?:Function, cfg?:object}} opts
 * @returns {{placements:Array<{lon:number,lat:number,heightM:number,radiusM:number,yawRad:number}>,
 *            stats:Record<string,number>}}
 */
export function scatterTrees(veg, { bbox, footprintIndex, excluder, cfg }) {
  const v = { ...DEFAULT_VEG, ...(cfg ?? {}) };
  const heights = { ...DEFAULT_VEG.heightM, ...(cfg?.heightM ?? {}) };
  const [w, s, e, n] = bbox;
  const midLat = (s + n) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const placements = [];
  const stats = { points: 0, rows: 0, wood: 0, park: 0, rejectedBuilding: 0, rejectedExcluded: 0, rejectedOutside: 0, thinned: 0 };

  const push = (lon, lat, rng, hRange, src) => {
    if (lon < w || lon > e || lat < s || lat > n) { stats.rejectedOutside++; return; }
    if (footprintIndex?.blocked(lon, lat)) { stats.rejectedBuilding++; return; }
    if (excluder && excluder({}, lon, lat)) { stats.rejectedExcluded++; return; }
    placements.push({ lon, lat, ...treeParams(rng, hRange, v.canopyRadiusK) });
    stats[src]++;
  };

  // 1 · individual `natural=tree` nodes — the only per-tree ground truth (tagged height wins).
  for (const p of veg.points) {
    const rng = mulberry32(hashSeed(Math.round(p.lon * 1e7), Math.round(p.lat * 1e7)));
    const tagged = parseMeters(p.tags.height) ?? parseMeters(p.tags.est_height);
    const hRange = tagged != null ? [Math.max(2, tagged), Math.max(2, tagged)] : heights.default;
    push(p.lon, p.lat, rng, hRange, "points");
  }

  // 2 · `natural=tree_row` ways — one tree every rowSpacingM along the polyline.
  for (const row of veg.rows) {
    let carry = 0;
    for (let i = 0; i < row.line.length - 1; i++) {
      const [lon0, lat0] = row.line[i], [lon1, lat1] = row.line[i + 1];
      const segM = Math.hypot((lon1 - lon0) * mPerDegLon, (lat1 - lat0) * M_PER_DEG_LAT);
      if (segM < 1e-6) continue;
      for (let d = carry; d <= segM; d += v.rowSpacingM) {
        const t = d / segM;
        const lon = lon0 + (lon1 - lon0) * t, lat = lat0 + (lat1 - lat0) * t;
        const rng = mulberry32(hashSeed(Math.round(lon * 1e7), Math.round(lat * 1e7), 7));
        push(lon, lat, rng, heights.row, "rows");
      }
      carry = (carry - segM) % v.rowSpacingM;
      if (carry < 0) carry += v.rowSpacingM;
    }
  }

  // 3 · green polygons — jittered-grid scatter. The grid is GLOBAL (anchored at the bbox SW corner,
  // one grid per class) so overlapping polygons of the same class can't double-plant a cell.
  const seen = new Set();
  for (const kind of ["wood", "park"]) {
    const spacing = kind === "wood" ? v.spacingWoodM : v.spacingParkM;
    const dLon = spacing / mPerDegLon, dLat = spacing / M_PER_DEG_LAT;
    const classBit = kind === "wood" ? 1 : 2;
    for (const poly of veg.polys) {
      if (poly.kind !== kind || poly.ring.length < 3) continue;
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const [lon, lat] of poly.ring) {
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      }
      const i0 = Math.max(0, Math.floor((minLon - w) / dLon)), i1 = Math.floor((Math.min(maxLon, e) - w) / dLon);
      const j0 = Math.max(0, Math.floor((minLat - s) / dLat)), j1 = Math.floor((Math.min(maxLat, n) - s) / dLat);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const key = `${classBit}:${i},${j}`;
          if (seen.has(key)) continue;
          const rng = mulberry32(hashSeed(i, j, classBit));
          const lon = w + (i + 0.15 + 0.7 * rng()) * dLon;
          const lat = s + (j + 0.15 + 0.7 * rng()) * dLat;
          if (!pointInPolygon(lon, lat, poly.ring)) continue; // NOT marked seen — another poly may cover it
          seen.add(key);
          push(lon, lat, rng, heights[kind], kind);
        }
      }
    }
  }

  // 4 · deterministic thinning to the cap — hash-probability keep (spatially uniform, no banding).
  if (placements.length > v.maxTrees) {
    const keepP = v.maxTrees / placements.length;
    const kept = placements.filter(
      (p) => mulberry32(hashSeed(Math.round(p.lon * 1e7), Math.round(p.lat * 1e7), 13))() < keepP,
    );
    stats.thinned = placements.length - kept.length;
    return { placements: kept, stats };
  }
  return { placements, stats };
}

/**
 * Pack per-cell tree placements (local ENU metres + params) into EXT_mesh_gpu_instancing TRS
 * arrays. ENU (e,n,u) → glTF Y-up (e, u, −n), same mapping as the building emitter; yaw becomes a
 * rotation about +Y; SCALE maps the unit tree (height 1, canopy radius 0.5) to real metres.
 * @param {Array<{e:number,n:number,heightM:number,radiusM:number,yawRad:number}>} cellTrees
 */
export function packTreeInstances(cellTrees) {
  const count = cellTrees.length;
  const translations = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const scales = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = cellTrees[i];
    translations[i * 3] = t.e;
    translations[i * 3 + 1] = 0; // base at ellipsoid h=0 — the runtime per-cell re-seat lifts it
    translations[i * 3 + 2] = -t.n;
    const half = t.yawRad / 2;
    rotations[i * 4] = 0;
    rotations[i * 4 + 1] = Math.sin(half);
    rotations[i * 4 + 2] = 0;
    rotations[i * 4 + 3] = Math.cos(half);
    scales[i * 3] = t.radiusM / 0.5;
    scales[i * 3 + 1] = t.heightM;
    scales[i * 3 + 2] = t.radiusM / 0.5;
  }
  return { translations, rotations, scales, count };
}

// ── unit tree geometry (glTF Y-up) ────────────────────────────────────────────────────────────────

/**
 * One stylized low-poly tree, authored UNIT-SIZE in glTF Y-up space: total height 1, canopy max
 * radius 0.5 (per-instance SCALE = [radiusM/0.5, heightM, radiusM/0.5]). Flat-shaded triangle soup
 * (positions + per-face normals, unindexed) matching the building emitter's format: an 8-sided
 * double-cone canopy (dark sage mass — the stylized "tree blob") over a 4-sided trunk prism.
 */
export function unitTreeGeometry() {
  const positions = [], normals = [];
  const pushTri = (a, b, c) => {
    // Face normal, oriented away from the trunk axis / canopy centroid (0, 0.55, 0).
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const fx = (a[0] + b[0] + c[0]) / 3, fy = (a[1] + b[1] + c[1]) / 3, fz = (a[2] + b[2] + c[2]) / 3;
    if (nx * fx + ny * (fy - 0.55) + nz * fz < 0) {
      [b, c] = [c, b];
      nx = -nx; ny = -ny; nz = -nz;
    }
    for (const p of [a, b, c]) positions.push(p[0], p[1], p[2]);
    for (let k = 0; k < 3; k++) normals.push(nx, ny, nz);
  };

  // Canopy: 8-gon ring at y=0.55 r=0.5, apexes at y=1.0 (top) and y=0.22 (underside).
  const N = 8;
  const ring = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    ring.push([0.5 * Math.cos(a), 0.55, 0.5 * Math.sin(a)]);
  }
  const top = [0, 1.0, 0], bot = [0, 0.22, 0];
  for (let i = 0; i < N; i++) {
    pushTri(ring[i], ring[(i + 1) % N], top);
    pushTri(ring[(i + 1) % N], ring[i], bot);
  }

  // Trunk: 4-sided prism, half-width 0.045, y 0 → 0.3 (tucks under the canopy underside).
  const hw = 0.045;
  const corners = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % 4];
    pushTri([x0, 0, z0], [x1, 0, z1], [x1, 0.3, z1]);
    pushTri([x0, 0, z0], [x1, 0.3, z1], [x0, 0.3, z0]);
  }
  return { positions, normals };
}
