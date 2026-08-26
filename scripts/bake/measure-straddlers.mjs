/**
 * RC16 — measure the BBOX-EDGE STRADDLER populations, read-only.
 *
 * Writes NOTHING and downloads NOTHING that is not already cached: it re-runs the two bakers'
 * *inputs* (the cached Overpass JSON for the extruder, the cached OSM2World glbs for the adapter)
 * up to the point where each decides a feature's grid cell, and then classifies that decision
 * instead of emitting geometry. Companion to `terrain/measure-dsm-signature.mjs` (same discipline:
 * measure before you build, and publish the control alongside the signal).
 *
 * WHY THE FOUR BUCKETS. The runtime seam is `bboxClipPrismEcef` (src/lib/globe/enrichedMask.ts):
 * four ECEF planes on the shared Cesium-OSM building material that discard fragments INSIDE the
 * bake bbox, so Cesium owns everything outside and the enriched tileset owns everything inside.
 * A feature is only well-behaved when it lies wholly on one side. The failure of each bucket is
 * therefore a property of the geometry, not of the baker — but the two bakers react differently:
 *
 *   IN     feature bounds ⊆ bbox                       → clean, both bakers agree.
 *   C_IN   centroid inside, bounds cross an edge        → BOTH bakers keep it whole, so the part
 *                                                         that pokes outside is drawn twice
 *                                                         (enriched + unclipped Cesium).
 *   C_OUT  centroid outside, bounds still touch bbox    → extruder CLAMPS the cell index and keeps
 *                                                         it whole (duplicate outside); adapter
 *                                                         DROPS it (`droppedOutside`), and the
 *                                                         prism then eats the Cesium copy's inside
 *                                                         half → a NOTCH.
 *   FAR    centroid outside AND bounds disjoint         → nothing of it is inside the prism, so the
 *                                                         adapter's drop is CORRECT; the extruder's
 *                                                         clamp drags it into an edge cell, where
 *                                                         it is a full coincident duplicate AND
 *                                                         inflates that cell's bounding region.
 *
 * `overlapM` is how far the feature reaches across the edge, in metres, measured on the local ENU
 * frame. That number is what a margin/crossfade ring would have to cover, so it is reported as a
 * distribution rather than a max — one 4 km outlier must not size a ring for 20 m straddlers.
 *
 *   node scripts/bake/measure-straddlers.mjs --city dnipro
 *   node scripts/bake/measure-straddlers.mjs --city chernobyl-o2w
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { enuBasis, projectEN, cellOf, DEG } from "./lib/geo.mjs";
import { makeExcluder } from "./lib/exclusion.mjs";
import { readGlb, readAccessor, readIndices } from "./lib/readGlb.mjs";
import { subBoxes } from "./lib/osmXml.mjs";
import { fetchBuildings, extractFootprints } from "./lib/overpass.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workDirFor = (city) => join(__dirname, ".cache", "o2w", city);

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--city") a.city = argv[++i];
    else if (argv[i] === "--list") a.list = argv[++i] ?? "C_OUT";
  }
  return a;
}

/** Same shallow `extends` merge the bakers use — the o2w variants inherit the parent's bbox. */
function loadCityConfig(name, depth = 0) {
  if (depth > 3) throw new Error(`config extends chain too deep at ${name}`);
  const p = join(__dirname, "cities", `${name}.json`);
  if (!existsSync(p)) throw new Error(`no city config: ${p}`);
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  return cfg.extends ? { ...loadCityConfig(cfg.extends, depth + 1), ...cfg } : cfg;
}

const classOf = (name) => name.split(" ")[0];

/** Classify one feature from its lon/lat bounds + the centroid the baker would compute. */
function classify(bbox, b, cLon, cLat, basis) {
  const [w, s, e, n] = bbox;
  const centroidIn = cLon >= w && cLon <= e && cLat >= s && cLat <= n;
  const boundsIn = b.minLon >= w && b.maxLon <= e && b.minLat >= s && b.maxLat <= n;
  const disjoint = b.maxLon < w || b.minLon > e || b.maxLat < s || b.minLat > n;

  if (boundsIn) return { bucket: "IN", overlapM: 0 };
  if (disjoint) return { bucket: "FAR", overlapM: gapMetres(bbox, b, basis) };
  return { bucket: centroidIn ? "C_IN" : "C_OUT", overlapM: crossMetres(bbox, b, basis) };
}

/** Metres the feature reaches PAST the nearest crossed edge (0 if it crosses none). */
function crossMetres(bbox, b, basis) {
  const [w, s, e, n] = bbox;
  const west = b.minLon < w ? lonSpanM(b.minLon, w, (b.minLat + b.maxLat) / 2, basis) : 0;
  const east = b.maxLon > e ? lonSpanM(e, b.maxLon, (b.minLat + b.maxLat) / 2, basis) : 0;
  const south = b.minLat < s ? latSpanM(b.minLat, s, basis) : 0;
  const north = b.maxLat > n ? latSpanM(n, b.maxLat, basis) : 0;
  return Math.max(west, east, south, north);
}

/** Metres from the bbox to a fully-disjoint feature's nearest bound. */
function gapMetres(bbox, b, basis) {
  const [w, s, e, n] = bbox;
  const midLat = (b.minLat + b.maxLat) / 2;
  const dLon =
    b.maxLon < w ? lonSpanM(b.maxLon, w, midLat, basis) : b.minLon > e ? lonSpanM(e, b.minLon, midLat, basis) : 0;
  const dLat = b.maxLat < s ? latSpanM(b.maxLat, s, basis) : b.minLat > n ? latSpanM(n, b.minLat, basis) : 0;
  return Math.hypot(dLon, dLat);
}

const lonSpanM = (lonA, lonB, atLat, basis) => {
  const a = projectEN(atLat, lonA, basis);
  const bp = projectEN(atLat, lonB, basis);
  return Math.abs(bp[0] - a[0]);
};
const latSpanM = (latA, latB, basis) => {
  const a = projectEN(latA, 0 + basis.lon0, basis);
  const bp = projectEN(latB, 0 + basis.lon0, basis);
  return Math.abs(bp[1] - a[1]);
};

function quantiles(xs) {
  if (xs.length === 0) return { p50: 0, p90: 0, p99: 0, max: 0 };
  const a = Float64Array.from(xs).sort();
  const at = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  return { p50: at(0.5), p90: at(0.9), p99: at(0.99), max: a[a.length - 1] };
}

/** Extruder inputs: cached Overpass footprints, ring-vertex centroid (bake.mjs:73-76). */
async function measureExtruder(cfg, basis) {
  const { json, cached } = await fetchBuildings(cfg.bbox, { refresh: false });
  if (!cached) throw new Error("refusing to measure against a FRESH Overpass fetch — this tool is read-only");
  const footprints = extractFootprints(json);
  const excluder = makeExcluder(cfg);
  const rows = [];
  for (const b of footprints) {
    if (b.ring.length < 3) continue;
    let clon = 0, clat = 0;
    const bounds = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity };
    for (const [lon, lat] of b.ring) {
      clon += lon; clat += lat;
      if (lon < bounds.minLon) bounds.minLon = lon;
      if (lon > bounds.maxLon) bounds.maxLon = lon;
      if (lat < bounds.minLat) bounds.minLat = lat;
      if (lat > bounds.maxLat) bounds.maxLat = lat;
    }
    clon /= b.ring.length; clat /= b.ring.length;
    if (excluder(b.tags, clon, clat)) continue;
    rows.push({ ...classify(cfg.bbox, bounds, clon, clat, basis), osm: b.osm, cell: cellOf(cfg.bbox, cfg.grid ?? 4, clon, clat).key });
  }
  return rows;
}

/** Adapter inputs: the cached OSM2World glbs, density-weighted soup centroid
 *  (bake-osm2world.mjs:275-284) — including the index expansion, which weights shared vertices. */
function measureAdapter(cfg, basis) {
  const EARTH_C = 40075016.686;
  const mercatorInverse = (lat0, lon0) => {
    const S = EARTH_C * Math.cos(lat0 * DEG);
    const x0 = ((lon0 + 180) / 360) * S;
    const sin0 = Math.sin(lat0 * DEG);
    const y0 = (Math.log((1 + sin0) / (1 - sin0)) / (4 * Math.PI) + 0.5) * S;
    return {
      lonOf: (x) => ((x + x0) / S - 0.5) * 360,
      latOf: (zNorth) => (360 * Math.atan(Math.exp(((zNorth + y0) / S - 0.5) * 2 * Math.PI))) / Math.PI - 90,
    };
  };
  const o2w = cfg.osm2world;
  const dropRe = new RegExp(o2w.dropClassesRegex ?? "^(Road|Rail|Surface|Water|Parking|Traffic)");
  const WORK_DIR = workDirFor(cfg.city);
  const excluder = makeExcluder(cfg);
  const [w, s, e, n] = cfg.bbox;

  // Handedness, exactly as the baker derives it (bake-osm2world.mjs:262-266): whichever sign of
  // north lands more Building centroids inside the bbox wins. Measured on a first pass so the
  // second pass classifies with the same sign the shipped bake used.
  const glbPaths = subBoxes(cfg.bbox, o2w.subGrid ?? 2).map((b) => join(WORK_DIR, `o2w-${b.key}.glb`));
  const missing = glbPaths.filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`missing cached converts (${missing.length}) — e.g. ${missing[0]}`);

  const seen = new Set();
  const rows = [];
  let inPlus = 0, inMinus = 0, bldgs = 0;
  const pending = [];
  for (const glbPath of glbPaths) {
    const { json, bin } = readGlb(glbPath);
    const origin = json.scenes?.[json.scene ?? 0]?.extras?.origin;
    if (!origin) throw new Error(`${glbPath}: no scene.extras.origin`);
    const inv = mercatorInverse(origin.lat, origin.lon);
    for (const node of json.nodes ?? []) {
      if (node.mesh == null || !node.name) continue;
      const cls = classOf(node.name);
      if (dropRe.test(cls)) continue;
      const osm = node.extras?.osmId ?? null;
      const key = `${cls}|${osm ?? node.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Accumulate the density-weighted centroid sums and the OSM-LOCAL x/z extremes — never the
      // soup. `lonOf` and `latOf` are both monotone increasing, so lon/lat bounds follow from the
      // x/z extremes once the handedness sign is known; retaining 7.7M Dnipro vertices to
      // re-derive them would cost ~120 MB for nothing.
      let sx = 0, sz = 0, nv = 0;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const prim of json.meshes[node.mesh].primitives ?? []) {
        if (prim.mode != null && prim.mode !== 4) continue;
        if (prim.attributes?.POSITION == null) continue;
        const p = readAccessor(json, bin, prim.attributes.POSITION).array;
        const idx = readIndices(json, bin, prim, p.length / 3);
        for (const vi of idx) {
          const x = p[vi * 3], z = p[vi * 3 + 2];
          sx += x; sz += z; nv++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
      if (nv === 0) continue;
      if (cls.startsWith("Building")) {
        bldgs++;
        for (const sign of [+1, -1]) {
          const lat = inv.latOf(sign * (-(sz / nv)));
          const lon = inv.lonOf(sx / nv);
          const hit = lon >= w && lon <= e && lat >= s && lat <= n ? 1 : 0;
          if (sign > 0) inPlus += hit; else inMinus += hit;
        }
      }
      pending.push({ inv, sx, sz, nv, minX, maxX, minZ, maxZ, osm });
    }
  }
  const signN = inPlus >= inMinus ? +1 : -1;
  console.log(`  axis   north=−Z ⇒ ${inPlus}/${bldgs} in-bbox · north=+Z ⇒ ${inMinus}/${bldgs} → using ${signN > 0 ? "−Z" : "+Z"}`);

  for (const f of pending) {
    const cLon = f.inv.lonOf(f.sx / f.nv);
    const cLat = f.inv.latOf(signN * (-(f.sz / f.nv)));
    // north = −Z ⇒ latOf(−z) reverses the z ordering; north = +Z keeps it.
    const zLo = signN > 0 ? -f.maxZ : f.minZ;
    const zHi = signN > 0 ? -f.minZ : f.maxZ;
    const b = {
      minLon: f.inv.lonOf(f.minX),
      maxLon: f.inv.lonOf(f.maxX),
      minLat: f.inv.latOf(zLo),
      maxLat: f.inv.latOf(zHi),
    };
    if (excluder({}, cLon, cLat)) continue;
    rows.push({ ...classify(cfg.bbox, b, cLon, cLat, basis), osm: f.osm, cell: cellOf(cfg.bbox, cfg.grid ?? 10, cLon, cLat).key });
  }
  return rows;
}

function report(label, rows) {
  const total = rows.length;
  const by = { IN: [], C_IN: [], C_OUT: [], FAR: [] };
  for (const r of rows) by[r.bucket].push(r.overlapM);
  console.log(`\n  ${label} — ${total} features`);
  console.log(`  ${"bucket".padEnd(7)} ${"count".padStart(8)} ${"share".padStart(7)}   ${"p50".padStart(8)} ${"p90".padStart(8)} ${"p99".padStart(8)} ${"max".padStart(9)}  (metres across the edge)`);
  for (const k of ["IN", "C_IN", "C_OUT", "FAR"]) {
    const q = quantiles(by[k]);
    const share = total ? ((100 * by[k].length) / total).toFixed(2) + "%" : "—";
    console.log(
      `  ${k.padEnd(7)} ${String(by[k].length).padStart(8)} ${share.padStart(7)}   ` +
      `${q.p50.toFixed(1).padStart(8)} ${q.p90.toFixed(1).padStart(8)} ${q.p99.toFixed(1).padStart(8)} ${q.max.toFixed(1).padStart(9)}`,
    );
  }
  const seam = by.C_IN.length + by.C_OUT.length;
  console.log(`  → seam population (C_IN + C_OUT) = ${seam} (${((100 * seam) / Math.max(1, total)).toFixed(2)}%)`);
  console.log(`  → extruder today: keeps all ${by.C_IN.length + by.C_OUT.length + by.FAR.length} non-IN whole (duplicates); adapter today: keeps ${by.C_IN.length}, drops ${by.C_OUT.length + by.FAR.length} (${by.C_OUT.length} of them NOTCHES)`);
  return by;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.city) throw new Error("usage: node scripts/bake/measure-straddlers.mjs --city <name>");
  const cfg = loadCityConfig(args.city);
  const [w, s, e, n] = cfg.bbox;
  const basis = enuBasis((s + n) / 2, (w + e) / 2);
  basis.lon0 = (w + e) / 2; // latSpanM needs a reference meridian; any fixed one works.
  console.log(`\n▶ measure-straddlers --city ${args.city}`);
  console.log(`  bbox  [${w}, ${s}, ${e}, ${n}]`);
  const rows = cfg.osm2world ? measureAdapter(cfg, basis) : await measureExtruder(cfg, basis);
  report(cfg.osm2world ? "adapter (OSM2World soup centroid)" : "extruder (ring centroid)", rows);
  if (args.list) {
    // The identities RC16 recovered, so a shipped artifact can be checked against them: each of
    // these must now appear in its cell's `.meta.json` sidecar. `C_OUT` is the notch population.
    const hits = rows.filter((r) => r.bucket === args.list);
    console.log(`\n  --list ${args.list} → ${hits.length} features (osm · cell · metres past the edge)`);
    for (const r of hits.slice(0, 40)) {
      console.log(`    ${String(r.osm ?? "?").padEnd(14)} cell ${String(r.cell).padEnd(7)} ${r.overlapM.toFixed(1)} m`);
    }
    if (hits.length > 40) console.log(`    … ${hits.length - 40} more`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
