// `bake --city <name>` — reproducible offline bake of roof-shaped enriched buildings for one city.
//
//   node scripts/bake/bake.mjs --city dnipro          (or:  npm run bake -- --city dnipro)
//   flags: --refresh (re-query Overpass), --out <dir> (override config.output)
//
// Pipeline (Slice 1, LIGHT Node path — dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md §Slice 1):
//   Overpass footprints+tags → C6 exclusion → height inference → roof-shaped extrusion →
//   spatial-grid 3D-Tiles 1.1 (per-cell glb, shared ENU frame for the runtime R1 re-seat) → public/.
// All data is public OSM (ODbL — attributed in the manifest + the app footer). No absolute Z is baked
// (h = 0); scene/enrichedBuildings.ts clamps the tileset to the rendered CWT at runtime.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBuildings, extractFootprints } from "./lib/overpass.mjs";
import { enuBasis, projectEN } from "./lib/geo.mjs";
import { inferBuilding, emitBuilding } from "./lib/buildings.mjs";
import { makeExcluder } from "./lib/exclusion.mjs";
import { encodeGlb, buildTileset, regionRad } from "./lib/gltf.mjs";
import {
  fetchVegetation,
  extractVegetation,
  scatterTrees,
  buildFootprintIndex,
  packTreeInstances,
  unitTreeGeometry,
} from "./lib/vegetation.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

function parseArgs(argv) {
  const a = { refresh: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--city") a.city = argv[++i];
    else if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--refresh") a.refresh = true;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.city) throw new Error("usage: node scripts/bake/bake.mjs --city <name> [--refresh] [--out dir]");

  const cfgPath = join(__dirname, "cities", `${args.city}.json`);
  if (!existsSync(cfgPath)) throw new Error(`no city config: ${cfgPath}`);
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const [w, s, e, n] = cfg.bbox;
  const originLon = (w + e) / 2, originLat = (s + n) / 2;
  const basis = enuBasis(originLat, originLon);
  const grid = cfg.grid ?? 4;
  const outDir = join(REPO_ROOT, args.out ?? cfg.output);

  console.log(`\n▶ bake --city ${args.city}`);
  console.log(`  bbox  [${w}, ${s}, ${e}, ${n}]  origin (${originLat.toFixed(5)}, ${originLon.toFixed(5)})  grid ${grid}×${grid}`);

  // 1 · OSM footprints (cached) -------------------------------------------------------------------
  const { json, cached, cachePath } = await fetchBuildings(cfg.bbox, { refresh: args.refresh });
  const footprints = extractFootprints(json);
  console.log(`  OSM   ${footprints.length} footprints  (${cached ? "cache" : "fresh"} ${cachePath.split("/").pop()})`);

  // 2 · C6 exclusion + 3 · height inference + 4 · project + bin into grid cells --------------------
  const excluder = makeExcluder(cfg);
  const excluded = {};
  const cells = new Map(); // "gi,gj" → { buildings:[], minLon,maxLon,minLat,maxLat, maxH }
  const heightSources = {};
  let featureId = 0, kept = 0;

  for (const b of footprints) {
    if (b.ring.length < 3) continue;
    let clon = 0, clat = 0;
    for (const [lon, lat] of b.ring) { clon += lon; clat += lat; }
    clon /= b.ring.length; clat /= b.ring.length;

    const reason = excluder(b.tags, clon, clat);
    if (reason) { excluded[reason] = (excluded[reason] ?? 0) + 1; continue; }

    const params = inferBuilding(b.tags, cfg.buildings);
    heightSources[params.heightSource] = (heightSources[params.heightSource] ?? 0) + 1;
    const ringEN = b.ring.map(([lon, lat]) => projectEN(lat, lon, basis));

    const gi = Math.min(grid - 1, Math.max(0, Math.floor(((clon - w) / (e - w)) * grid)));
    const gj = Math.min(grid - 1, Math.max(0, Math.floor(((clat - s) / (n - s)) * grid)));
    const key = `${gi},${gj}`;
    let cell = cells.get(key);
    if (!cell) { cell = { buildings: [], minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity, maxH: 0 }; cells.set(key, cell); }
    cell.buildings.push({ ringEN, params, featureId: featureId++, osm: b.osm });
    for (const [lon, lat] of b.ring) {
      if (lon < cell.minLon) cell.minLon = lon; if (lon > cell.maxLon) cell.maxLon = lon;
      if (lat < cell.minLat) cell.minLat = lat; if (lat > cell.maxLat) cell.maxLat = lat;
    }
    cell.maxH = Math.max(cell.maxH, params.height + (params.roofHeight ?? params.height * 0.5));
    kept++;
  }

  const excludedTotal = Object.values(excluded).reduce((a, x) => a + x, 0);
  console.log(`  C6    excluded ${excludedTotal}${excludedTotal ? " → " + JSON.stringify(excluded) : ""}`);
  console.log(`  infer heights ${JSON.stringify(heightSources)}  → kept ${kept} buildings in ${cells.size} cells`);

  // 4b · trees (Slice 3, opt-in per city config) — OSM tree points / tree rows / green-polygon
  // scatter → per-cell EXT_mesh_gpu_instancing instances riding the SAME grid cells (streaming,
  // LRU, and the per-cell terrain re-seat come for free). C6 exclusion + building-footprint
  // rejection are applied per placement.
  let treeStats = null, totalTrees = 0;
  if (cfg.vegetation) {
    const veg = await fetchVegetation(cfg.bbox, { refresh: args.refresh });
    const extracted = extractVegetation(veg.json);
    const footprintIndex = buildFootprintIndex(footprints.map((b) => b.ring));
    const { placements, stats } = scatterTrees(extracted, {
      bbox: cfg.bbox,
      footprintIndex,
      excluder,
      cfg: cfg.vegetation,
    });
    treeStats = stats;
    totalTrees = placements.length;
    for (const p of placements) {
      const [pe, pn] = projectEN(p.lat, p.lon, basis);
      const gi = Math.min(grid - 1, Math.max(0, Math.floor(((p.lon - w) / (e - w)) * grid)));
      const gj = Math.min(grid - 1, Math.max(0, Math.floor(((p.lat - s) / (n - s)) * grid)));
      const key = `${gi},${gj}`;
      let cell = cells.get(key);
      if (!cell) { cell = { buildings: [], minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity, maxH: 0 }; cells.set(key, cell); }
      (cell.trees ??= []).push({ e: pe, n: pn, heightM: p.heightM, radiusM: p.radiusM, yawRad: p.yawRad });
      if (p.lon < cell.minLon) cell.minLon = p.lon; if (p.lon > cell.maxLon) cell.maxLon = p.lon;
      if (p.lat < cell.minLat) cell.minLat = p.lat; if (p.lat > cell.maxLat) cell.maxLat = p.lat;
      cell.maxH = Math.max(cell.maxH, p.heightM);
    }
    console.log(`  trees ${totalTrees} placed (veg ${veg.cached ? "cache" : "fresh"}) → ${JSON.stringify(stats)}`);
  }

  // 5 · emit per-cell glb + tileset children ------------------------------------------------------
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Region height pad: the runtime PER-CELL re-seat (scene/enrichedBuildings.ts, Slice 2) shifts a
  // cell's CONTENT along geodetic up relative to its static bounding volume by (cell terrain −
  // bbox-centre terrain) — over Dnipro's riverbank-to-hills relief that's a few tens of metres.
  // Pad the baked height span so the culler never clips a lifted cell (cost: negligibly earlier loads).
  const RESEAT_PAD_M = 80;

  const treeGeometry = totalTrees > 0 ? unitTreeGeometry() : null;
  const children = [];
  let totalVerts = 0, totalBytes = 0, globalMaxH = 0;
  for (const [key, cell] of cells) {
    const out = { positions: [], normals: [], featureIds: [] };
    for (const b of cell.buildings) emitBuilding(b.ringEN, b.params, b.featureId, out, cfg.buildings);
    if (out.positions.length === 0 && !(cell.trees?.length > 0)) continue;
    if (cell.trees?.length > 0) {
      out.trees = { geometry: treeGeometry, ...packTreeInstances(cell.trees) };
    }
    const glb = encodeGlb(out);
    const uri = `cell-${key.replace(",", "-")}.glb`;
    writeFileSync(join(outDir, uri), glb);
    // U8 identity sidecar: featureId → stable OSM element id (+ inferred heights) per cell.
    // The OSM id can NEVER ride `_FEATURE_ID_0` itself — the attribute is float32 (exact only
    // to 2^24; way ids are ~10^9). Served/uploaded automatically (.json passes the dev
    // middleware and upload-r2's extension filter); the runtime upgrade to OSM-keyed overrides
    // is the next phase — this bake-side carry is what makes it possible.
    writeFileSync(
      join(outDir, uri.replace(/\.glb$/, ".meta.json")),
      JSON.stringify({
        features: cell.buildings.map((b) => ({
          id: b.featureId,
          osm: b.osm ?? null,
          base: b.params.base,
          height: b.params.height,
          heightSource: b.params.heightSource,
        })),
      }),
    );
    totalVerts += out.positions.length / 3;
    totalBytes += glb.length;
    globalMaxH = Math.max(globalMaxH, cell.maxH);
    children.push({
      regionRad: regionRad(cell.minLon, cell.minLat, cell.maxLon, cell.maxLat, -RESEAT_PAD_M, cell.maxH + RESEAT_PAD_M),
      contentUri: uri,
      geometricError: 0,
    });
  }

  // 6 · tileset.json ------------------------------------------------------------------------------
  const tileset = buildTileset({
    originLatDeg: originLat,
    originLonDeg: originLon,
    bboxRegionRad: regionRad(w, s, e, n, -RESEAT_PAD_M, globalMaxH + RESEAT_PAD_M),
    rootGeometricError: 512,
    cells: children,
    version: cfg.tilesetVersion,
  });
  writeFileSync(join(outDir, "tileset.json"), JSON.stringify(tileset));

  // 7 · manifest (provenance + ODbL attribution) --------------------------------------------------
  const manifest = {
    city: cfg.city,
    bbox: cfg.bbox,
    origin: { latDeg: originLat, lonDeg: originLon },
    grid,
    counts: { osmFootprints: footprints.length, excluded, baked: kept, cells: children.length, verts: totalVerts, trees: totalTrees },
    heightSources,
    treeStats,
    seating: "runtime clamp-to-CWT (baked at ellipsoid h=0; scene/enrichedBuildings.ts re-seats)",
    attribution: cfg.attribution,
    generator: "frame-the-world/scripts/bake",
  };
  writeFileSync(join(outDir, "bake-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n✓ baked ${children.length} tiles · ${totalVerts.toLocaleString()} verts · ${totalTrees.toLocaleString()} trees · ${(totalBytes / 1e6).toFixed(2)} MB · maxH ${globalMaxH.toFixed(0)} m`);
  console.log(`  → ${outDir.replace(REPO_ROOT + "/", "")}/tileset.json`);
  console.log(`  set PUBLIC_ENRICHED_TILES_URL=/${(args.out ?? cfg.output).replace(/^(public|bakes)\//, "")}/tileset.json + set ENRICHED.bbox to [${w},${s},${e},${n}]\n`);
}

main().catch((err) => { console.error("✗ bake failed:", err.message); process.exit(1); });
