// One-off ops tool: SERIALLY warm the Wix asset edge cache after a release.
//
// WHY: Wix's static-asset origin serves any cache-MISS `_astro`/texture at ~15–30s and 500s
// under the ~16-way PARALLEL chunk burst a browser page-boot fires. But a warmed (x-cache: HIT)
// asset is served fast and stays cached (max-age=604800 = 7d). Firing requests ONE AT A TIME
// avoids the concurrency contention that produces the timeouts, so each cold read completes and
// populates the edge cache. After this runs, a real browser load hits all-HIT → the globe loads.
//
// Usage: node scripts/warm-prod-assets.mjs [baseUrl]
// Re-run after every `wix release` (new hashes reset the cache cold).

const BASE = process.argv[2] || "https://frame-the-a173087b-yevhens.wix-site-host.com";
const PER_TRY_TIMEOUT_MS = 34_000;
const MAX_TRIES = 4;

// Critical-path textures the globe blocks on (not discoverable from JS imports).
const TEXTURES = [
  "/textures/earth-color-8k.jpg", "/textures/earth-color.jpg",
  "/textures/earth-night-8k.jpg", "/textures/earth-night.jpg",
  "/textures/earth-landmask-8k.png", "/textures/earth-normal.jpg",
  "/textures/earth-topology.png", "/textures/milkyway-2020.jpg",
];

const seen = new Set();
const queue = [];
const results = [];
const enqueue = (p) => { if (p && !seen.has(p)) { seen.add(p); queue.push(p); } };

// Resolve an `_astro` reference found inside a chunk to an absolute path.
function collectAstroRefs(js) {
  const out = new Set();
  // relative imports: from"./x.js"  import"./x.js"  import("./x.js")
  for (const m of js.matchAll(/["'`]\.\/([A-Za-z0-9_.-]+\.(?:js|css))["'`]/g)) out.add("/_astro/" + m[1]);
  // absolute _astro refs + vite mapDeps array entries ("_astro/x.js")
  for (const m of js.matchAll(/["'`](?:\/?_astro\/)([A-Za-z0-9_.-]+\.(?:js|css))["'`]/g)) out.add("/_astro/" + m[1]);
  return [...out];
}

async function fetchOnce(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_TRY_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { signal: ctrl.signal, headers: { "user-agent": "ftw-warm/1.0" } });
    const body = res.headers.get("content-type")?.includes("javascript") ? await res.text() : (await res.arrayBuffer(), "");
    return { status: res.status, ms: Date.now() - started, xcache: res.headers.get("x-cache"), body };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, xcache: null, body: "", err: e.name };
  } finally { clearTimeout(t); }
}

async function warm(path) {
  for (let i = 1; i <= MAX_TRIES; i++) {
    const r = await fetchOnce(path);
    if (r.status === 200) {
      if (path.endsWith(".js")) for (const ref of collectAstroRefs(r.body)) enqueue(ref);
      results.push({ path, status: 200, ms: r.ms, xcache: r.xcache, tries: i });
      console.log(`  ✔ 200 ${String(r.ms).padStart(6)}ms x-cache=${r.xcache ?? "?"} try${i}  ${path}`);
      return;
    }
    console.log(`  … ${r.status || r.err} ${String(r.ms).padStart(6)}ms try${i}/${MAX_TRIES}  ${path}`);
  }
  results.push({ path, status: "FAIL", tries: MAX_TRIES });
  console.log(`  ✖ FAIL after ${MAX_TRIES}  ${path}`);
}

// Seed: entry chunks + CSS from the live HTML, then textures.
const html = await (await fetch(BASE + "/?cb=" + Math.floor(Math.random() * 1e9))).text();
for (const m of html.matchAll(/\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)/g)) enqueue(m[0]);
// Prioritise the globe path first, then textures.
queue.sort((a, b) => (b.includes("GlobeCanvas") || b.includes("page") || b.includes("client") ? 1 : 0) - (a.includes("GlobeCanvas") || a.includes("page") || a.includes("client") ? 1 : 0));
TEXTURES.forEach(enqueue);

console.log(`Warming ${BASE}\nSeed queue: ${queue.length} assets (JS entry + CSS + textures); JS chunks expand transitively.\n`);
let n = 0;
while (queue.length) { console.log(`[${++n}] (queue ${queue.length})`); await warm(queue.shift()); }

const ok = results.filter((r) => r.status === 200).length;
const fail = results.filter((r) => r.status === "FAIL").length;
const slow = results.filter((r) => r.status === 200 && r.ms > 8000).length;
console.log(`\n=== DONE: ${ok} warmed, ${fail} failed, ${slow} were cold(>8s) on first warm. Total assets: ${results.length} ===`);
