// Overpass XML extract (tiled sub-boxes + disk cache + mirror cycling) and a REFERENCE-SAFE C6
// (wartime geo-sensitivity) filter for the OSM2World bake (bake-osm2world.mjs).
//
// XML (not JSON): OSM2World's reader consumes raw OSM elements; `out meta;` adds the version/
// timestamp attrs its parser expects, and `>;` recurses down to every referenced node so ways are
// complete. The full city bbox is too large for one reliable public-mirror call → `subBoxes` tiles
// it (features straddling a border appear complete in BOTH extracts; the adapter dedupes by OSM id).
//
// Reference-safety (vs the Slice-1.5 spike's node-drop simplification): excluded WAYS/RELATIONS are
// removed whole (their untagged member nodes remain as harmless orphans), while excluded TAGGED
// NODES keep their geometry but lose their tags — a bare node renders nothing yet stays valid for
// any way that references it, so the C6 strip can never dangle a reference. The osmium
// `tags-filter --invert-match --omit-referenced` path stays the documented production upgrade
// (scripts/bake/README.md §Higher-fidelity tiers).

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
const UA = "frame-the-world-bake/1.0 (Dnipro 3D enrichment, OSM2World variant; OSM ODbL)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Split [west,south,east,north] into a k×k tiling → [{ key:"xi-yi", bbox }]. */
export function subBoxes(bbox, k) {
  const [w, s, e, n] = bbox;
  const dw = (e - w) / k, dh = (n - s) / k;
  const out = [];
  for (let xi = 0; xi < k; xi++) {
    for (let yi = 0; yi < k; yi++) {
      out.push({ key: `${xi}-${yi}`, bbox: [w + xi * dw, s + yi * dh, w + (xi + 1) * dw, s + (yi + 1) * dh] });
    }
  }
  return out;
}

/** Fetch a full `nwr` OSM XML extract for bbox [west,south,east,north] (deg). Cached on disk;
 *  pass {refresh:true} to force. Cycles mirror endpoints with backoff (same idiom as overpass.mjs). */
export async function fetchOsmXml(bbox, { refresh = false } = {}) {
  const [w, s, e, n] = bbox;
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `o2w-${s.toFixed(4)}_${w.toFixed(4)}_${n.toFixed(4)}_${e.toFixed(4)}.osm`);
  if (!refresh && existsSync(cachePath)) {
    return { xml: readFileSync(cachePath, "utf8"), cached: true, cachePath };
  }
  const q = `[out:xml][timeout:300];(nwr(${s},${w},${n},${e});>;);out meta;`;
  let lastErr;
  for (let round = 0; round < 3; round++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
          body: "data=" + encodeURIComponent(q),
        });
        if (!res.ok) { lastErr = new Error(`${url} → HTTP ${res.status}`); continue; }
        const xml = await res.text();
        if (!xml.includes("<osm")) { lastErr = new Error(`${url} → not OSM XML`); continue; }
        writeFileSync(cachePath, xml);
        return { xml, cached: false, cachePath };
      } catch (err) { lastErr = err; }
    }
    if (round < 2) { const wait = 12000 * (round + 1); console.log(`  … Overpass busy (${lastErr?.message}); backoff ${wait / 1000}s`); await sleep(wait); }
  }
  throw lastErr ?? new Error("Overpass fetch failed (all endpoints)");
}

/**
 * Reference-safe C6 filter over OSM XML. Line-oriented (Overpass emits one element opening per
 * line). `excluder` = makeExcluder(cfg) — tag rules only here (coords are not resolved at this
 * stage; the polygon rules run again at the adapter's centroid gate, where real lon/lat exist).
 * @returns {{ xml:string, dropped:Record<string,number>, strippedNodes:number,
 *             kept:{node:number,way:number,relation:number}, seen:{node:number,way:number,relation:number} }}
 */
export function c6FilterXml(xml, excluder) {
  const lines = xml.split("\n");
  const out = [];
  const dropped = {};
  let strippedNodes = 0;
  const kept = { node: 0, way: 0, relation: 0 }, seen = { node: 0, way: 0, relation: 0 };
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    const m = t.match(/^<(node|way|relation)\b/);
    if (!m) { out.push(lines[i]); i++; continue; }
    const kind = m[1];
    seen[kind]++;
    if (/\/>\s*$/.test(t)) { out.push(lines[i]); kept[kind]++; i++; continue; } // tag-less geometry node
    const block = [lines[i]];
    let j = i + 1;
    const closeRe = new RegExp(`</${kind}>`);
    while (j < lines.length && !closeRe.test(lines[j])) { block.push(lines[j]); j++; }
    if (j < lines.length) block.push(lines[j]);
    const tags = {};
    for (const bl of block) {
      const tm = bl.match(/<tag k="([^"]*)" v="([^"]*)"/);
      if (tm) tags[tm[1]] = tm[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    }
    const reason = excluder(tags, 0, 0);
    if (!reason) { out.push(...block); kept[kind]++; }
    else if (kind === "node") {
      // Keep the node's GEOMETRY (it may be a vertex of a kept way) but strip its feature-ness:
      // re-emit the opening line self-closed, dropping every <tag>.
      out.push(block[0].replace(/>\s*$/, "/>"));
      dropped[reason] = (dropped[reason] ?? 0) + 1;
      strippedNodes++;
      kept[kind]++;
    } else {
      dropped[reason] = (dropped[reason] ?? 0) + 1;
    }
    i = j + 1;
  }
  return { xml: out.join("\n"), dropped, strippedNodes, kept, seen };
}
