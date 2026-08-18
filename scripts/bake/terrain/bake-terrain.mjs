#!/usr/bin/env node
// GLO-30 → quantized-mesh terrain patch bake (the U7→bake slice, design ruling 2026-08-18).
//
//   node --env-file=.env.local scripts/bake/terrain/bake-terrain.mjs --city dnipro [--refresh]
//        [--skip-mago]
//
// Steps: fetch GLO-30 COGs (anonymous AWS Open Data; WBM aux cached alongside) → stage a
// DEM-only input dir → mago-3d-terrainer (Java 21 jar, cached + sha256-verified; reads the COGs'
// own georeferencing and applies the EGM2008→ellipsoid shift with its built-in geoid — NEVER
// rewrite the rasters in Node: geotiff.js's writer produced geo-tags mago ignored, landing the
// mosaic at −180/90) → POST-BAKE rim blend toward decoded CWT (blend.mjs — the seam stitch) →
// prune deep levels outside the city bbox → layer.json post (Copernicus attribution +
// serve-set⊆availability assert) → probe verify (decode real tiles vs the source COG + geoid
// grid + CWT rim). Then upload:
//   node --env-file=.env.local scripts/bake/upload-r2.mjs --city dnipro --terrain
//
// Needs PUBLIC_CESIUM_ION_TOKEN in env (the rim blend samples CWT) — hence --env-file.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromArrayBuffer } from "geotiff";
import { blendRim } from "./blend.mjs";
import { makeCwtSampler } from "./cwt.mjs";
import { geoidN } from "./geoid.mjs";
import { ensureGlo30 } from "./glo30.mjs";
import { decodeQuantizedMesh, sampleQuantizedHeight } from "./qmesh.mjs";
import { tileBbox, tileRange, tileRangeInside } from "./tiling.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const city = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;
const refresh = args.includes("--refresh");
const skipMago = args.includes("--skip-mago");
if (!city) {
  console.error("usage: node --env-file=.env.local scripts/bake/terrain/bake-terrain.mjs --city <name>");
  process.exit(1);
}

const MAGO_VERSION = "1.14.2-release";
const MAGO_URL = `https://github.com/Gaia3D/mago-3d-terrainer/releases/download/v${MAGO_VERSION}/mago-3d-terrainer-${MAGO_VERSION}.jar`;
const MAGO_SHA256 = "c9f8c7a5c1e28b645c3d58ae7d6674839fa65fa3c34aba75006f31ef2f6d3ac1";

const cfg = JSON.parse(await readFile(join(here, "..", "cities", `${city}.json`), "utf8"));
const t = cfg.terrain;
if (!t) {
  console.error(`cities/${city}.json has no "terrain" section`);
  process.exit(1);
}
const repoRoot = resolve(here, "../../..");
const outDir = resolve(repoRoot, t.output);
const workDir = resolve(repoRoot, "bakes/terrain/.work", city);
const cacheGlo = join(here, "..", ".cache", "glo30");
const cacheCwt = join(here, "..", ".cache", "cwt");
const cacheMago = join(here, "..", ".cache", "mago");
const demDir = join(workDir, "dem");

const ionToken = process.env.PUBLIC_CESIUM_ION_TOKEN;
if (!ionToken) throw new Error("PUBLIC_CESIUM_ION_TOKEN missing — run with --env-file=.env.local");

async function ensureMagoJar() {
  await mkdir(cacheMago, { recursive: true });
  const jar = join(cacheMago, `mago-3d-terrainer-${MAGO_VERSION}.jar`);
  if (!(await stat(jar).catch(() => null))) {
    console.log(`▶ downloading mago-3d-terrainer ${MAGO_VERSION} (~228 MB, one-off)`);
    const res = await fetch(MAGO_URL, { redirect: "follow" });
    if (!res.ok) throw new Error(`jar download → ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== MAGO_SHA256) throw new Error(`jar sha256 mismatch: ${sha}`);
    await writeFile(jar, buf);
  }
  return jar;
}

// ---- 1. inputs (DEM-only staging dir: the WBM aux tiles cached beside the DEMs must never
//      reach mago — it would ingest the masks as elevation) -----------------------------------
console.log(
  `▶ bake-terrain --city ${city}  extent ${t.extentBbox} ≤L${t.extentMaxDepth}  city ${t.cityBbox} ≤L${t.maxDepth}`,
);
const demPaths = await ensureGlo30(t.extentBbox, cacheGlo, { refresh });
await rm(demDir, { recursive: true, force: true });
await mkdir(demDir, { recursive: true });
for (const p of demPaths) await copyFile(p, join(demDir, basename(p)));

// ---- 2. mago-3d-terrainer (its own COG georeferencing + built-in EGM2008 geoid) --------------
if (!skipMago) {
  const jar = await ensureMagoJar();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  console.log(`▶ mago-3d-terrainer → ${outDir}`);
  execFileSync(
    "java",
    ["-Xmx6g", "-jar", jar, "-input", demDir, "-output", outDir, "-max", String(t.maxDepth), "-it", "bilinear", "--geoid", "EGM2008"],
    { stdio: "inherit" },
  );
  await rm(join(outDir, "temp"), { recursive: true, force: true });
}

// ---- 3. rim blend toward CWT (the spatial seam stitch) ---------------------------------------
console.log(`▶ rim blend (${t.blendKm} km toward CWT at the extent edge)`);
const cwtHeight = await makeCwtSampler({ ionToken, cacheDir: cacheCwt });
const blended = await blendRim({
  outDir,
  extentBbox: t.extentBbox,
  extentMaxDepth: t.extentMaxDepth,
  blendKm: t.blendKm,
  cwtHeight,
});
console.log(`  blended ${blended.verts} verts across ${blended.tiles} rim tiles`);

// ---- 4. prune levels above extentMaxDepth outside the city bbox ------------------------------
let pruned = 0;
for (let z = t.extentMaxDepth + 1; z <= t.maxDepth; z++) {
  const keep = tileRange(t.cityBbox, z);
  const lvlDir = join(outDir, String(z));
  for (const xDir of await readdir(lvlDir).catch(() => [])) {
    const x = Number(xDir);
    for (const yFile of await readdir(join(lvlDir, xDir)).catch(() => [])) {
      const y = Number(yFile.replace(".terrain", ""));
      if (x < keep.startX || x > keep.endX || y < keep.startY || y > keep.endY) {
        await rm(join(lvlDir, xDir, yFile));
        pruned++;
      }
    }
  }
}
console.log(`▶ pruned ${pruned} deep tiles outside the city bbox`);

// ---- 5. layer.json post: attribution + serve-set ⊆ availability ------------------------------
const layerPath = join(outDir, "layer.json");
const layer = JSON.parse(await readFile(layerPath, "utf8"));
layer.attribution = t.attribution;
if (!layer.available) throw new Error("layer.json has no available[] — unexpected terrainer output");
const bakedMax = layer.available.length - 1;
if (bakedMax < t.maxDepth) {
  console.warn(`  NOTE: bake topped out at L${bakedMax} (asked L${t.maxDepth}) — serve set adapts; update regions.ts maxDepth if this is final`);
}
for (let z = t.extentMaxDepth + 1; z <= Math.min(t.maxDepth, bakedMax); z++) {
  const keep = tileRange(t.cityBbox, z);
  layer.available[z] = [{ startX: keep.startX, endX: keep.endX, startY: keep.startY, endY: keep.endY }];
}
const contains = (ranges, r) =>
  (ranges ?? []).some((a) => r.startX >= a.startX && r.endX <= a.endX && r.startY >= a.startY && r.endY <= a.endY);
for (let z = 0; z <= Math.min(t.maxDepth, bakedMax); z++) {
  const serve = z > t.extentMaxDepth ? tileRange(t.cityBbox, z) : tileRangeInside(t.extentBbox, z);
  if (!serve) continue; // too coarse for any fully-inside tile — the runtime never forces here
  if (!contains(layer.available[z], serve)) {
    throw new Error(
      `availability mismatch at L${z}: runtime serve-set ${JSON.stringify(serve)} ⊄ baked ${JSON.stringify(layer.available[z])}`,
    );
  }
}
await writeFile(layerPath, JSON.stringify(layer, null, 2));
console.log(`▶ layer.json: attribution set, serve-set containment verified (baked max L${bakedMax})`);

// ---- 6. probe verify against the SOURCE COG + geoid grid + CWT rim ---------------------------
const srcCogs = [];
for (const p of demPaths) {
  const tif = await fromArrayBuffer((await readFile(p)).buffer);
  const img = await tif.getImage(0);
  srcCogs.push({
    origin: img.getOrigin(),
    res: img.getResolution(),
    w: img.getWidth(),
    h: img.getHeight(),
    data: (await img.readRasters({ samples: [0] }))[0],
  });
}
const srcEllipsoidalAt = (lon, lat) => {
  for (const cog of srcCogs) {
    const c = Math.floor((lon - cog.origin[0]) / cog.res[0]);
    const r = Math.floor((lat - cog.origin[1]) / cog.res[1]); // res[1] negative, north-up
    if (c < 0 || r < 0 || c >= cog.w || r >= cog.h) continue;
    return cog.data[r * cog.w + c] + geoidN(lon, lat);
  }
  return null;
};

async function probeTile(z, x, y, label, tolM) {
  const buf = await readFile(join(outDir, String(z), String(x), `${y}.terrain`));
  const mesh = decodeQuantizedMesh(buf);
  const [w, s, e, n] = tileBbox(z, x, y);
  const lon = (w + e) / 2;
  const lat = (s + n) / 2;
  const got = sampleQuantizedHeight(mesh, 0.5, 0.5);
  const want = srcEllipsoidalAt(lon, lat);
  const d = want === null ? NaN : got - want;
  console.log(
    `  probe ${label} L${z} ${x}/${y}: ${mesh.vertexCount} verts, centre ${got.toFixed(1)} vs COG+N ${want?.toFixed(1)} (Δ ${d.toFixed(1)} m)`,
  );
  if (!(Math.abs(d) <= tolM)) throw new Error(`probe ${label}: |Δ| ${Math.abs(d).toFixed(1)} > ${tolM} m`);
}
const cityDeep = Math.min(t.maxDepth, bakedMax);
const cityR = tileRange(t.cityBbox, cityDeep);
await probeTile(cityDeep, Math.floor((cityR.startX + cityR.endX) / 2), Math.floor((cityR.startY + cityR.endY) / 2), "city-centre", 12);
const l13 = tileRangeInside(t.extentBbox, t.extentMaxDepth);
await probeTile(t.extentMaxDepth, Math.floor((l13.startX + l13.endX) / 2), Math.floor((l13.startY + l13.endY) / 2), "extent-mid", 25);

// Rim continuity: the westmost served tile's west-edge vertex row must sit ON the CWT surface.
{
  const z = t.extentMaxDepth;
  const y = Math.floor((l13.startY + l13.endY) / 2);
  const buf = await readFile(join(outDir, String(z), String(l13.startX), `${y}.terrain`));
  const mesh = decodeQuantizedMesh(buf);
  const [w, s, , n] = tileBbox(z, l13.startX, y);
  const latMid = (s + n) / 2;
  const patchEdge = sampleQuantizedHeight(mesh, 0, 0.5);
  const cwtEdge = await cwtHeight(w, latMid);
  console.log(
    `  rim continuity @ ${w.toFixed(3)},${latMid.toFixed(3)}: patch ${patchEdge.toFixed(1)} vs CWT ${cwtEdge.toFixed(1)} (Δ ${(patchEdge - cwtEdge).toFixed(1)} m)`,
  );
  if (Math.abs(patchEdge - cwtEdge) > 4) throw new Error("rim seam exceeds 4 m — blend failed");
}

// ---- 7. summary + runtime registry snippet ---------------------------------------------------
let files = 0;
let bytes = 0;
async function walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) await walk(p);
    else {
      files++;
      bytes += (await stat(p)).size;
    }
  }
}
await walk(outDir);
const info = {
  city,
  template: `terrain/${city}/{z}/{x}/{y}.terrain`,
  extentBbox: t.extentBbox,
  extentMaxDepth: t.extentMaxDepth,
  cityBbox: t.cityBbox,
  maxDepth: Math.min(t.maxDepth, bakedMax),
  attribution: t.attribution,
  bakedAt: new Date().toISOString(),
  files,
  bytes,
};
await writeFile(join(outDir, "patch-info.json"), JSON.stringify(info, null, 2));
console.log(`✓ bake complete: ${files} files · ${(bytes / 1e6).toFixed(1)} MB`);
console.log(`  regions.ts terrain block: ${JSON.stringify({ path: city, extentBbox: info.extentBbox, extentMaxDepth: info.extentMaxDepth, cityBbox: info.cityBbox, maxDepth: info.maxDepth })}`);
console.log(`  NEXT: node --env-file=.env.local scripts/bake/upload-r2.mjs --city ${city} --terrain`);
