// M11 — "GLO-30's building signature (DSM-minus-bare-earth, metres)". READ-ONLY: it writes no
// file, touches no bake and downloads nothing that is not already cached.
//
//   node scripts/bake/terrain/measure-dsm-signature.mjs --city dnipro [--json]
//
// WHY THIS EXISTS. Copernicus GLO-30 is a digital SURFACE model: every posting includes whatever
// stood on the ground when it was flown — roofs and canopy included. The terrain patch baked from
// it is therefore not the bare earth the buildings are seated onto, and RC15 (charter Group D,
// audit S18) proposes to fix that by rasterising OSM footprints, punching them out of the raster,
// inpainting the holes and re-running the whole terrain pipeline. That is an L-sized slice which
// also has to get past the standing 2026-08-18 ruling against writing DEM rasters in Node.
//
// The audit was explicit that the slice should be SIZED before it is built (§6, M11: "decides
// whether it is worth an L"), and nothing in the repo measured it — the bake's own probe compares
// the baked mesh against the source COG, which are the same DSM and therefore agree by
// construction. This script is that measurement.
//
// METHOD. For each OSM footprint, compare the DSM over the footprint's own pixels against a LOCAL
// bare-earth reference: the median over an annulus of nearby pixels that are inside no footprint
// and are not water. Local, because a city-wide "buildings vs not-buildings" mean would just
// measure where the city was built (Dnipro's centre sits on the high right bank) rather than the
// buildings themselves.
//
// WHAT TO DO WITH THE NUMBER. Compare the signature against the SERVED posting, not against zero.
// The patch is a TIN decimated to L13 (~38 × 25 m over Dnipro) from a ~30 m source, so a signature
// well under the posting cannot survive into the mesh and RC15 would be moving numbers the
// renderer never sees. What matters is the tail: the fraction of footprints whose signature is a
// large share of their own height, since that is the double-count the FPV eye and the horizon
// profile inherit.
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { fromArrayBuffer } from "geotiff";
import { ensureGlo30 } from "./glo30.mjs";
import { fetchBuildings, extractFootprints } from "../lib/overpass.mjs";
import { inferBuilding } from "../lib/buildings.mjs";
import { makeExcluder } from "../lib/exclusion.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const city = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;
const asJson = args.includes("--json");
if (!city) {
  console.error("usage: node scripts/bake/terrain/measure-dsm-signature.mjs --city <name> [--json]");
  process.exit(1);
}
const cfgPath = join(here, "..", "cities", `${city}.json`);
if (!existsSync(cfgPath)) throw new Error(`no city config: ${cfgPath}`);
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
if (!cfg.terrain) throw new Error(`${city} has no terrain block — nothing to measure against`);

const [w, s, e, n] = cfg.bbox;
const cacheDir = join(here, "..", ".cache", "glo30");

/** Read one COG (DEM or the 8-bit WBM aux) into a flat typed array + its georeferencing. */
async function readCog(path) {
  const tif = await fromArrayBuffer((await readFile(path)).buffer);
  const img = await tif.getImage(0);
  return {
    path,
    origin: img.getOrigin(),
    res: img.getResolution(), // [dLon, dLat] — dLat is NEGATIVE (north-up)
    w: img.getWidth(),
    h: img.getHeight(),
    data: (await img.readRasters({ samples: [0] }))[0],
  };
}

console.log(`\n▶ M11 · DSM building signature — ${city}`);
console.log(`  bbox [${w}, ${s}, ${e}, ${n}]`);

// The Overpass cache is keyed on the CITY bbox, so the measurement is scoped to it (which is also
// the only place footprints were ever baked). The extent tiles beyond it are irrelevant here.
const demPaths = await ensureGlo30(cfg.bbox, cacheDir);
const dems = [];
for (const p of demPaths) dems.push(await readCog(p));
const wbms = [];
for (const p of demPaths) {
  const wp = p.replace(/_DEM\.tif$/, "_WBM.tif");
  if (existsSync(wp)) wbms.push(await readCog(wp));
}
console.log(
  `  source ${dems.map((d) => `${d.w}×${d.h} @ ${Math.abs(d.res[0] * 3600).toFixed(2)}″×${Math.abs(d.res[1] * 3600).toFixed(2)}″`).join(", ")}`,
);
// Ground sampling at this latitude, so the signature can be judged against what the mesh can hold.
const midLat = (s + n) / 2;
const mPerDegLat = 111132.92 - 559.82 * Math.cos((2 * midLat * Math.PI) / 180);
const mPerDegLon = 111412.84 * Math.cos((midLat * Math.PI) / 180);
const px = Math.abs(dems[0].res[0]) * mPerDegLon;
const py = Math.abs(dems[0].res[1]) * mPerDegLat;
console.log(`  posting source ${px.toFixed(1)} × ${py.toFixed(1)} m  ·  served L${cfg.terrain.maxDepth}`);

const { json, cached } = await fetchBuildings(cfg.bbox, { refresh: false });
const footprints = extractFootprints(json);
const excluder = makeExcluder(cfg);
console.log(`  OSM ${footprints.length} footprints (${cached ? "cache" : "fresh"})`);

// ── the global footprint mask ───────────────────────────────────────────────────────────────────
// Built ONCE over the whole grid, because a footprint's bare-earth reference must exclude its
// NEIGHBOURS' roofs too. In a dense block that is most of the annulus, and using it anyway would
// measure a building against other buildings and report ~0 — the exact false negative that would
// wrongly kill this slice.
const masks = dems.map((d) => new Uint8Array(d.w * d.h));

/** Which COG holds (lon,lat)? Returns its index, or −1. */
const cogOf = (lon, lat) => {
  for (let i = 0; i < dems.length; i++) {
    const d = dems[i];
    const c = (lon - d.origin[0]) / d.res[0];
    const r = (lat - d.origin[1]) / d.res[1];
    if (c >= 0 && r >= 0 && c < d.w && r < d.h) return i;
  }
  return -1;
};

/** Pixel-space ring for a lon/lat ring on COG `d` (fractional pixel coordinates). */
const toPixels = (ring, d) =>
  ring.map(([lon, lat]) => [(lon - d.origin[0]) / d.res[0], (lat - d.origin[1]) / d.res[1]]);

/** Even-odd scanline fill of a pixel-space ring → the covered pixel indices on COG `d`.
 *  A footprint smaller than a pixel covers no pixel CENTRE, so the caller falls back to the
 *  centroid's pixel — at a 30 m posting that is the common case, not the exception. */
function fillRing(ringPx, d) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ringPx) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(d.w - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(d.h - 1, Math.ceil(maxY));
  const out = [];
  for (let py2 = y0; py2 <= y1; py2++) {
    const yc = py2 + 0.5;
    const xs = [];
    for (let i = 0, j = ringPx.length - 1; i < ringPx.length; j = i++) {
      const [xi, yi] = ringPx[i], [xj, yj] = ringPx[j];
      if (yi > yc !== yj > yc) xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(x0, Math.ceil(xs[k] - 0.5));
      const b = Math.min(x1, Math.floor(xs[k + 1] - 0.5));
      for (let cx = a; cx <= b; cx++) out.push(py2 * d.w + cx);
    }
  }
  return out;
}

const kept = [];
for (const b of footprints) {
  if (b.ring.length < 3) continue;
  let clon = 0, clat = 0;
  for (const [lon, lat] of b.ring) { clon += lon; clat += lat; }
  clon /= b.ring.length; clat /= b.ring.length;
  if (excluder(b.tags, clon, clat)) continue;
  const ci = cogOf(clon, clat);
  if (ci < 0) continue;
  const d = dems[ci];
  const pixels = fillRing(toPixels(b.ring, d), d);
  if (pixels.length === 0) {
    const c = Math.floor((clon - d.origin[0]) / d.res[0]);
    const r = Math.floor((clat - d.origin[1]) / d.res[1]);
    pixels.push(r * d.w + c);
  }
  for (const p of pixels) masks[ci][p] = 1;
  kept.push({ ci, pixels, params: inferBuilding(b.tags, cfg.buildings), osm: b.osm });
}
const maskedPx = masks.reduce((a, m) => a + m.reduce((x, v) => x + v, 0), 0);
console.log(`  masked ${kept.length} footprints over ${maskedPx.toLocaleString()} source pixels`);

// Water: GLO-30's production flattens water surfaces, so a lake pixel is a legitimate bare-earth
// value but a noisy one, and a river-front building's annulus is mostly river. Excluded from
// references (never from the footprints themselves).
const waterAt = (ci, idx) => {
  const wb = wbms[ci];
  return wb ? wb.data[idx] > 0 : false;
};

// ── per-footprint signature ─────────────────────────────────────────────────────────────────────
const REF_INNER = 2; // px — skip the DSM's own smearing at the footprint edge
const REF_OUTER = 6; // px — ~180 m at this posting: local enough to be the same hillside
const median = (a) => {
  const q = Float64Array.from(a).sort();
  const m = q.length >> 1;
  return q.length % 2 ? q[m] : (q[m - 1] + q[m]) / 2;
};

const rows = [];
let noRef = 0;
for (const f of kept) {
  const d = dems[f.ci];
  const mask = masks[f.ci];
  let sum = 0;
  for (const p of f.pixels) sum += d.data[p];
  const own = sum / f.pixels.length;

  // Annulus around the footprint's pixel bbox, bare-earth only.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of f.pixels) {
    const x = p % d.w, y = (p - x) / d.w;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const ref = [];
  for (let y = minY - REF_OUTER; y <= maxY + REF_OUTER; y++) {
    if (y < 0 || y >= d.h) continue;
    for (let x = minX - REF_OUTER; x <= maxX + REF_OUTER; x++) {
      if (x < 0 || x >= d.w) continue;
      const inInner = x >= minX - REF_INNER && x <= maxX + REF_INNER && y >= minY - REF_INNER && y <= maxY + REF_INNER;
      if (inInner) continue;
      const idx = y * d.w + x;
      if (mask[idx]) continue; // a neighbour's roof is not bare earth
      if (waterAt(f.ci, idx)) continue;
      ref.push(d.data[idx]);
    }
  }
  if (ref.length < 8) { noRef++; continue; }
  rows.push({
    sig: own - median(ref),
    heightM: f.params.height + (f.params.roofHeight ?? 0),
    src: f.params.heightSource,
    px: f.pixels.length,
    osm: f.osm,
  });
}

// ── the CANOPY half ─────────────────────────────────────────────────────────────────────────────
// M11 is written about buildings, but audit gap #11 names trees in the same breath — "and trees,
// where the sampled value IS the canopy". That half is mechanically DIFFERENT and cannot be
// inferred from the building numbers: a `natural=wood` polygon covers hundreds of CONTIGUOUS
// postings, so unlike a sub-pixel building it fully occupies the sample and the DSM records the
// canopy top rather than an area-weighted blend with the street beside it. Measuring it here is
// what makes the RC15 verdict a verdict about the slice rather than about half of it.
let veg = null;
if (cfg.vegetation) {
  const { fetchVegetation, extractVegetation } = await import("../lib/vegetation.mjs");
  const vjson = await fetchVegetation(cfg.bbox, { refresh: false });
  const { polys } = extractVegetation(vjson.json);
  // A second mask: canopy pixels are not bare earth either, and a forest edge's reference ring
  // must exclude the forest it is measuring.
  const vmasks = dems.map((d) => new Uint8Array(d.w * d.h));
  const shapes = [];
  for (const p of polys) {
    if (p.ring.length < 3) continue;
    let clon = 0, clat = 0;
    for (const [lon, lat] of p.ring) { clon += lon; clat += lat; }
    clon /= p.ring.length; clat /= p.ring.length;
    const ci = cogOf(clon, clat);
    if (ci < 0) continue;
    const pixels = fillRing(toPixels(p.ring, dems[ci]), dems[ci]);
    if (pixels.length === 0) continue;
    for (const q of pixels) vmasks[ci][q] = 1;
    shapes.push({ ci, pixels, kind: p.kind });
  }
  const sig = [];
  for (const f of shapes) {
    const d = dems[f.ci];
    let sum = 0;
    for (const q of f.pixels) sum += d.data[q];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of f.pixels) {
      const x = q % d.w, y = (q - x) / d.w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const ref = [];
    for (let y = minY - REF_OUTER; y <= maxY + REF_OUTER; y++) {
      if (y < 0 || y >= d.h) continue;
      for (let x = minX - REF_OUTER; x <= maxX + REF_OUTER; x++) {
        if (x < 0 || x >= d.w) continue;
        if (x >= minX - REF_INNER && x <= maxX + REF_INNER && y >= minY - REF_INNER && y <= maxY + REF_INNER) continue;
        const i2 = y * d.w + x;
        if (masks[f.ci][i2] || vmasks[f.ci][i2] || waterAt(f.ci, i2)) continue;
        ref.push(d.data[i2]);
      }
    }
    if (ref.length < 8) continue;
    sig.push({ v: sum / f.pixels.length - median(ref), px: f.pixels.length });
  }
  veg = { polys: shapes.length, measured: sig, canopyPx: vmasks.reduce((a, m) => a + m.reduce((x, y) => x + y, 0), 0) };
}

// ── the NEGATIVE CONTROL ────────────────────────────────────────────────────────────────────────
// Without this the measurement above cannot be read. "Median +0.39 m over footprints" only means
// "the DSM sees roofs" if an ARBITRARY pixel does not score the same against its own annulus —
// and a pixel-vs-neighbourhood-median statistic has a spread on any terrain that is not a plane.
// So: run the identical statistic on random pixels that are inside no footprint and are not water.
// If the two distributions coincide, the signature is terrain roughness wearing a building's name.
function controlSample(count) {
  const out = [];
  // Deterministic stride rather than Math.random, so the control is reproducible run to run.
  const d = dems[0];
  const mask = masks[0];
  const stride = 7919; // prime — walks the whole raster without aliasing to the row length
  let idx = 12347;
  for (let tries = 0; tries < count * 40 && out.length < count; tries++) {
    idx = (idx + stride) % (d.w * d.h);
    const x = idx % d.w;
    const y = (idx - x) / d.w;
    const lon = d.origin[0] + (x + 0.5) * d.res[0];
    const lat = d.origin[1] + (y + 0.5) * d.res[1];
    if (lon < w || lon > e || lat < s || lat > n) continue; // stay inside the city box
    if (mask[idx] || waterAt(0, idx)) continue;
    const ref = [];
    for (let yy = y - REF_OUTER; yy <= y + REF_OUTER; yy++) {
      if (yy < 0 || yy >= d.h) continue;
      for (let xx = x - REF_OUTER; xx <= x + REF_OUTER; xx++) {
        if (xx < 0 || xx >= d.w) continue;
        if (Math.abs(xx - x) <= REF_INNER && Math.abs(yy - y) <= REF_INNER) continue;
        const i2 = yy * d.w + xx;
        if (mask[i2] || waterAt(0, i2)) continue;
        ref.push(d.data[i2]);
      }
    }
    if (ref.length < 8) continue;
    out.push(d.data[idx] - median(ref));
  }
  return out;
}
const control = controlSample(20000);

// ── report ──────────────────────────────────────────────────────────────────────────────────────
const pct = (arr, q) => {
  const a = Float64Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
};
const sigs = rows.map((r) => r.sig);
const mean = sigs.reduce((a, x) => a + x, 0) / sigs.length;
const summary = {
  city,
  footprints: rows.length,
  skippedNoReference: noRef,
  sourcePostingM: [+px.toFixed(1), +py.toFixed(1)],
  servedLevel: cfg.terrain.maxDepth,
  signatureM: {
    mean: +mean.toFixed(2),
    p05: +pct(sigs, 0.05).toFixed(2),
    p25: +pct(sigs, 0.25).toFixed(2),
    median: +pct(sigs, 0.5).toFixed(2),
    p75: +pct(sigs, 0.75).toFixed(2),
    p95: +pct(sigs, 0.95).toFixed(2),
    p99: +pct(sigs, 0.99).toFixed(2),
  },
  // The decision-relevant tail: how much of a building's own height the DSM has already absorbed.
  ratioToOwnHeight: {
    median: +pct(rows.map((r) => r.sig / Math.max(1, r.heightM)), 0.5).toFixed(3),
    p95: +pct(rows.map((r) => r.sig / Math.max(1, r.heightM)), 0.95).toFixed(3),
  },
  shareOverM: {
    "1m": +(sigs.filter((x) => x > 1).length / sigs.length).toFixed(3),
    "3m": +(sigs.filter((x) => x > 3).length / sigs.length).toFixed(3),
    "5m": +(sigs.filter((x) => x > 5).length / sigs.length).toFixed(3),
    "10m": +(sigs.filter((x) => x > 10).length / sigs.length).toFixed(3),
  },
  // Split by how many source pixels the footprint actually covers: a sub-pixel building cannot
  // register its own roof, so this is where a "the DSM does not see most buildings" verdict shows.
  byPixelCount: {},
  /** The same statistic on random NON-building pixels. Read every number above against this one. */
  control: {
    n: control.length,
    median: +pct(control, 0.5).toFixed(2),
    p95: +pct(control, 0.95).toFixed(2),
    p99: +pct(control, 0.99).toFixed(2),
    shareOver3m: +(control.filter((x) => x > 3).length / control.length).toFixed(3),
    shareOver5m: +(control.filter((x) => x > 5).length / control.length).toFixed(3),
  },
};
for (const [label, lo, hi] of [["1px", 1, 1], ["2-4px", 2, 4], ["5-16px", 5, 16], ["17+px", 17, Infinity]]) {
  const g = rows.filter((r) => r.px >= lo && r.px <= hi);
  summary.byPixelCount[label] = g.length
    ? { n: g.length, medianSigM: +pct(g.map((r) => r.sig), 0.5).toFixed(2), meanHeightM: +(g.reduce((a, r) => a + r.heightM, 0) / g.length).toFixed(1) }
    : { n: 0 };
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`\n  signature (DSM over footprint − local bare-earth median), ${rows.length} footprints`);
  const g = summary.signatureM;
  console.log(`    mean ${g.mean} m · p05 ${g.p05} · p25 ${g.p25} · MEDIAN ${g.median} · p75 ${g.p75} · p95 ${g.p95} · p99 ${g.p99}`);
  console.log(`    share above  1 m ${(summary.shareOverM["1m"] * 100).toFixed(1)}%  ·  3 m ${(summary.shareOverM["3m"] * 100).toFixed(1)}%  ·  5 m ${(summary.shareOverM["5m"] * 100).toFixed(1)}%  ·  10 m ${(summary.shareOverM["10m"] * 100).toFixed(1)}%`);
  console.log(`    as a fraction of the building's own inferred height: median ${summary.ratioToOwnHeight.median} · p95 ${summary.ratioToOwnHeight.p95}`);
  console.log(`  by source pixels covered:`);
  for (const [k, v] of Object.entries(summary.byPixelCount))
    console.log(`    ${k.padEnd(7)} n ${String(v.n).padStart(7)}${v.n ? `  median signature ${String(v.medianSigM).padStart(6)} m  (mean building ${v.meanHeightM} m)` : ""}`);
  if (noRef) console.log(`  (${noRef} footprints had no clean bare-earth annulus and were skipped)`);
  if (veg && veg.measured.length) {
    const big = veg.measured.filter((x) => x.px >= 17).map((x) => x.v);
    const all = veg.measured.map((x) => x.v);
    console.log(`\n  CANOPY (natural=wood / landuse=forest / leisure=park), ${veg.polys} polygons over ${veg.canopyPx.toLocaleString()} pixels`);
    console.log(`    all polygons      n ${String(all.length).padStart(5)} · median ${pct(all, 0.5).toFixed(2)} m · p75 ${pct(all, 0.75).toFixed(2)} · p95 ${pct(all, 0.95).toFixed(2)}`);
    if (big.length)
      console.log(`    17+ px (contiguous) n ${String(big.length).padStart(3)} · median ${pct(big, 0.5).toFixed(2)} m · p75 ${pct(big, 0.75).toFixed(2)} · p95 ${pct(big, 0.95).toFixed(2)}`);
    console.log(`    → unlike a sub-pixel building, a large wood FILLS its postings, so this is the canopy top.`);
  }
  const c = summary.control;
  console.log(`\n  NEGATIVE CONTROL — the same statistic on ${c.n.toLocaleString()} random NON-building pixels:`);
  console.log(`    median ${c.median} m · p95 ${c.p95} · p99 ${c.p99} · share above 3 m ${(c.shareOver3m * 100).toFixed(1)}% · above 5 m ${(c.shareOver5m * 100).toFixed(1)}%`);
  console.log(`    → the footprint signal is the DIFFERENCE from this, not the raw number above.`);
  console.log(
    `\n  Judge against the SERVED posting, not against zero: L${cfg.terrain.maxDepth} is coarser than the ${px.toFixed(0)} × ${py.toFixed(0)} m source,\n  so a signature below the source posting cannot survive TIN decimation into the mesh.\n`,
  );
}
