// Browser verification for the Chernobyl / Pripyat region (owner ask 2026-08-26) — the FOURTH
// entry in src/lib/globe/regions.ts and the first since dnipro to carry BOTH an enriched
// buildings bake and a self-baked GLO-30 terrain patch.
//
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs --headless --port 9333
// --profile /tmp/ftw-cdp), then  node --experimental-websocket scripts/verify-chernobyl.mjs
// [cdpPort] [shotsDir]   (Node 20 needs the flag; ≥22 has global WebSocket).
//
// Asserts, from a `#p=` pose over the plant:
//   1. region selection: standing in the box resolves region "chernobyl" → variant
//      "chernobyl-o2w" (variants[0]), NOT the dnipro head of the registry
//   2. the o2w tileset + its cell glbs actually stream (network 200s under /enriched/chernobyl-o2w/)
//   3. the GLO-30 patch actually streams (network 200s under /terrain/chernobyl/) and its
//      served level tops out at the configured L12
//   4. terrain heights over the box are Polesian-plausible (~105-175 m), NOT the km-class CWT
//      fallback and NOT 0
//   5. `?enriched=chernobyl` A/B swaps to the classic extruder bake, `?enriched=off` streams
//      neither — proving the source swap rather than a coincidence
//   6. the New Safe Confinement's cell carries geometry no taller than its tagged 110 m (the
//      roof:height regression this bake found — it used to be a 220 m ridge)
// Screenshots in verify-shots/ (git-ignored).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readGlb } from "./bake/lib/readGlb.mjs";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

// Focus the ChNPP reactor block / New Safe Confinement (51.3893, 30.0988) from 1.2 km up on a
// low oblique, so the arch, the turbine hall and Pripyat's towers 3.5 km north are all in frame.
// Fixed scene time (2026-06-21 ~09:00 UTC) so lighting is reproducible across runs.
const POSE = "#p=51.3893,30.0988,1200,20,55&t=1782032400000";
const BASE = "http://localhost:4321/";

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
trackTarget(PORT, target.id);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let seq = 0;
const pending = new Map();
/** Every response URL seen since the last resetNet(), with its status. */
let net = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Network.responseReceived") {
    net.push({ url: msg.params.response.url, status: msg.params.response.status });
    return;
  }
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shoot = async (name) => {
  const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(shot.data, "base64"));
  console.log(`  shot: ${SHOTS}/${name}`);
};
const fail = (msg) => {
  throw new VerifyFailure(msg);
};
let passed = 0;
const ok = (label, extra = "") => {
  passed++;
  console.log(`  ✓ ${label}${extra ? "  " + extra : ""}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
// Every assertion below is "did this URL get fetched with a 200", so a warm profile cache would
// make the checks run-order-dependent: `layer.json` is requested once per navigation and a
// memory-cache hit fires `requestServedFromCache`, not `responseReceived`, so a second run
// reported "no 200 for the terrain layer.json" against a page that was serving the patch.
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

/** Navigate to `url` and wait for the globe island to publish `window.__globe`, then settle.
 *  Bounces through about:blank first: Page.navigate to a hash-only-different URL does NOT
 *  reload (a standing trap in NEXT_SESSION_PROMPT). */
async function goto(url, settleMs = 14000) {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  net = [];
  await send("Page.navigate", { url });
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await evalJs("!!window.__globe").catch(() => false)) break;
  }
  if (!(await evalJs("!!window.__globe"))) fail(`__globe never appeared at ${url}`);
  await sleep(settleMs); // let the tile pipeline stream
}

console.log(`\n▶ verify-chernobyl  ${BASE}${POSE}`);

// ── 1 · region + variant selection ────────────────────────────────────────────────────────────
// Read the CDP network log, NOT performance.getEntriesByType("resource"): that buffer caps at
// 250 entries and one settled globe frame issues ~1,700 requests (1,517 of them ArcGIS imagery
// alone), so by the time this runs the enriched entries have long been evicted. The first cut of
// this check did exactly that and reported "enriched prefixes seen: []" against a page that was
// streaming the bake correctly — a probe reading an emptied buffer FAILS OPEN.
await goto(BASE + POSE);
/** A cell glb request. NOT `endsWith(".glb")`: since 2026-08-26 the baker stamps a
 *  `?v=<tilesetVersion>` cache-buster onto every content uri, and the old test silently matched
 *  nothing — reporting "streamed ZERO cell glbs" against a page that was streaming them fine. */
const isGlb = (url) => /\.glb(\?|$)/.test(url);

/** Distinct `<prefix>` values seen under `/enriched/<prefix>/` or `/terrain/<prefix>/`. */
const prefixes = (kind) => [
  ...new Set(net.filter((r) => r.url.includes(`/${kind}/`)).map((r) => r.url.split(`/${kind}/`)[1].split("/")[0])),
];
const enrichedSeen = prefixes("enriched");
if (!enrichedSeen.includes("chernobyl-o2w"))
  fail(`expected the o2w bake to stream; enriched prefixes seen: ${JSON.stringify(enrichedSeen)}`);
if (enrichedSeen.includes("dnipro"))
  fail(`dnipro streamed inside the Chernobyl box — region selection fell back to the registry head`);
ok("region selection → chernobyl-o2w (not the dnipro head)", JSON.stringify(enrichedSeen));

// ── 2 · the o2w tileset and its cells really arrived ──────────────────────────────────────────
const o2w = net.filter((r) => r.url.includes("/enriched/chernobyl-o2w/"));
const o2wGlb = o2w.filter((r) => isGlb(r.url));
const o2wBad = o2w.filter((r) => r.status >= 400);
if (!o2w.some((r) => r.url.endsWith("tileset.json") && r.status === 200)) fail("no 200 for the o2w tileset.json");
if (o2wGlb.length === 0) fail("the o2w tileset loaded but streamed ZERO cell glbs");
if (o2wBad.length) fail(`o2w requests with errors: ${JSON.stringify(o2wBad.slice(0, 3))}`);
ok("o2w buildings streaming", `${o2wGlb.length} cell glbs, 0 errors`);

// ── 3 · the GLO-30 patch really arrived, and tops out where configured ────────────────────────
// POLLED, not sampled once: the patch is claimed by the ground renderer's fetchData hook and
// only starts pulling tiles after the camera has settled over the region, which lands well
// after the 14 s the buildings need. A fixed settle read zero tiles on a page that went on to
// stream 32 of them.
let terr = [];
for (let i = 0; i < 40 && terr.filter((r) => r.url.endsWith(".terrain")).length < 4; i++) {
  terr = net.filter((r) => r.url.includes("/terrain/chernobyl/") && r.status === 200);
  if (terr.filter((r) => r.url.endsWith(".terrain")).length >= 4) break;
  await sleep(1000);
}
const terrTiles = terr.filter((r) => r.url.endsWith(".terrain"));
if (terrTiles.length === 0)
  fail(`no /terrain/chernobyl/ tiles after 40 s — the patch is registered in regions.ts but never served`);
const levels = [...new Set(terrTiles.map((r) => Number(r.url.split("/terrain/chernobyl/")[1].split("/")[0])))].sort(
  (a, b) => a - b,
);
const maxLevel = Math.max(...levels);
if (maxLevel !== 12)
  fail(`terrain served up to L${maxLevel}; the bake and regions.ts both say 12 (levels seen: ${levels})`);
ok("GLO-30 patch streaming", `${terrTiles.length} tiles, levels ${levels.join(",")} (max L12 as configured)`);

// ── 4 · heights are Polesian, not CWT-flat and not zero ───────────────────────────────────────
const heights = await evalJs(`(() => {
  const pts = [[51.3893,30.0988],[51.4053,30.0567],[51.3700,30.1200],[51.4300,30.0300],[51.3600,30.0200]];
  return pts.map(([la,lo]) => { const h = window.__globe.terrainHeightAt(la, lo); return h == null ? null : +h.toFixed(1); });
})()`);
if (heights.some((h) => h === null)) fail(`terrainHeightAt returned null for some probes: ${JSON.stringify(heights)}`);
const [lo, hi] = [Math.min(...heights), Math.max(...heights)];
if (!(lo > 90 && hi < 200)) fail(`terrain heights out of the Polesian range 90..200 m: ${JSON.stringify(heights)}`);
if (hi - lo < 1) fail(`terrain is FLAT across the box (spread ${(hi - lo).toFixed(1)} m) — the patch is not seated`);
ok("terrain heights plausible", `${lo.toFixed(1)}..${hi.toFixed(1)} m across 5 probes`);
await shoot("chernobyl-01-reactor-o2w.jpeg");

// ── 6 · the New Safe Confinement is 110 m, not the 220 m ridge the roof:height bug produced ────
// Asserted against the BAKED GLB, not the scene graph. The first cut traversed
// `__globe.enriched.group` and compared `geometry.boundingBox.max.y` across every mesh — but
// those bounds are in each tile's own local space, under different parent transforms, so the
// 152.7 m it reported was not a height of anything. The glb accessor max IS the cell's geometry
// in the shared ENU frame, which is exactly the quantity the bug moved.
{
  const nscCell = "cell-6-4.glb"; // the ChNPP block: NSC, sarcophagus, reactors 1-4, turbine hall
  const tallest = (bake) => {
    const g = readGlb(readFileSync(`bakes/enriched/${bake}/${nscCell}`));
    let maxY = -Infinity;
    for (const m of g.json.meshes ?? [])
      for (const p of m.primitives) {
        const a = g.json.accessors[p.attributes.POSITION];
        if (a.max) maxY = Math.max(maxY, a.max[1]);
      }
    return +maxY.toFixed(1);
  };
  const classicH = tallest("chernobyl");
  const o2wH = tallest("chernobyl-o2w");
  // The extruder bakes the NSC's tagged height exactly; nothing else in the cell is taller.
  if (classicH !== 110)
    fail(`classic ${nscCell} tops out at ${classicH} m, expected exactly 110 (the NSC's tagged height; it was 220 before the roof:height fix)`);
  // OSM2World adds the plant's 750 kV switchyard towers, which genuinely stand above the arch.
  if (!(o2wH > 110 && o2wH <= 130))
    fail(`o2w ${nscCell} tops out at ${o2wH} m, expected 110 < h ≤ 130 (NSC 110 m + HV towers)`);
  ok("NSC cell heights are the tagged ones", `classic ${classicH} m (was 220) · o2w ${o2wH} m`);
}

// ── 5 · the A/B seam: classic bake, then off ──────────────────────────────────────────────────
await goto(BASE + "?enriched=chernobyl" + POSE);
const classic = net.filter((r) => r.url.includes("/enriched/chernobyl/") && r.status === 200);
if (!classic.some((r) => isGlb(r.url))) fail("?enriched=chernobyl streamed no classic cell glbs");
if (net.some((r) => r.url.includes("/enriched/chernobyl-o2w/")))
  fail("?enriched=chernobyl still pulled the o2w bake — the param did not swap the source");
ok("?enriched=chernobyl → classic extruder bake", `${classic.filter((r) => isGlb(r.url)).length} cell glbs`);
await shoot("chernobyl-02-reactor-classic.jpeg");

await goto(BASE + "?enriched=off" + POSE, 8000);
if (net.some((r) => r.url.includes("/enriched/chernobyl")))
  fail("?enriched=off still streamed an enriched bake");
ok("?enriched=off → no enriched bake (source swap proven by its absence)");
await shoot("chernobyl-03-reactor-off.jpeg");

// Pripyat itself, from the o2w bake — the other half of what the owner asked for.
await goto(BASE + "#p=51.4053,30.0567,900,200,60&t=1782032400000");
const pri = net.filter((r) => r.url.includes("/enriched/chernobyl-o2w/") && isGlb(r.url) && r.status === 200);
if (pri.length === 0) fail("no o2w cells streamed over Pripyat city centre");
ok("Pripyat city centre streams the o2w bake", `${pri.length} cell glbs`);
await shoot("chernobyl-04-pripyat-o2w.jpeg");

console.log(`\n✓ verify-chernobyl: ${passed}/${passed} checks passed`);
await finishVerify();
