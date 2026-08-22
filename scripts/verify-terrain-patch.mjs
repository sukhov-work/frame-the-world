// Browser verification for the GLO-30 terrain-patch composite + best-variant buildings rule
// (design ruling 2026-08-18). Usage: wix dev on :4321 + CDP Chrome
// (scripts/verify-chrome.mjs [--headless] --port 9333), then
//   node scripts/verify-terrain-patch.mjs [cdpPort] [shotsDir]
//
// Asserts, at a street-level Dnipro pose:
//   1. patch tiles actually stream (network: /terrain/dnipro/{z}/{x}/{y}.terrain, zero failures)
//   2. the rendered river reads GLO-30 (heightAt min over a river transect ≤ 84 m ellipsoidal —
//      the CWT quads rendered ~88–94 there, the U7-measured +33 m error; GLO-30 truth ≈ 72–78)
//   3. the ENRICHED DEFAULT is the o2w bake (network: enriched/dnipro-o2w/tileset.json with NO
//      ?enriched= param — the owner's best-variant-by-default rule)
//   4. BLD chip = LIVE on/off (scene loses/regains the two building tile groups, no reload)
//   5. /m: ▦ 3D DETAIL twin toggles the same store live in 3D mode.
// Screenshots: city terrain + the 34.0°E extent seam + BLD off, in verify-shots/ (git-ignored).
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots";
const CITY_URL = "http://localhost:4321/#p=48.46470,35.04620,1400,35.0,55.0";
// Extent WEST seam: stand just east of 34.0°E looking WEST along the boundary — a height step
// between the outermost patch column and its CWT neighbour would read as a wall here. Daytime
// scene (&t=) so topography is legible; hash-only navigations don't reload (the app reads #p=
// at BOOT), so the script hops through about:blank to force a document load.
const SEAM_URL = "http://localhost:4321/#p=48.50000,34.02500,2600,120.0,272.0&t=1787133600000";

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
// audit #3 C11: register for close — an abandoned target holds a WebGL context.
trackTarget(PORT, target.id);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const netLog = { terrainOk: 0, terrainFail: 0, urls: new Set(), enrichedTilesets: new Set() };
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === "Network.responseReceived") {
    const { url, status } = msg.params.response;
    if (/\/terrain\/[^/]+\/\d+\/\d+\/\d+\.terrain/.test(url)) {
      status === 200 ? netLog.terrainOk++ : netLog.terrainFail++;
      if (/\/1[23]\/\d+\/\d+\.terrain/.test(url)) netLog.deepOk = (netLog.deepOk ?? 0) + 1;
      if (netLog.urls.size < 5) netLog.urls.add(`${status} ${url}`);
    }
    if (/\/enriched\/[^/]+\/tileset\.json/.test(url)) netLog.enrichedTilesets.add(url);
  }
  if (msg.method === "Network.loadingFailed" && /\.terrain/.test(msg.params.errorText ?? "")) {
    netLog.terrainFail++;
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shoot = async (name) => {
  const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 78 });
  const path = `${SHOTS}/${name}`;
  writeFileSync(path, Buffer.from(shot.data, "base64"));
  console.log(`shot: ${path}`);
};
/** audit #3 C11: THROW rather than `process.exit` — the throw unwinds to the cleanup handler
 *  in verify-cdp-cleanup.mjs, which closes this script's CDP target and exits 1. (An `await
 *  finishVerify()` here would NOT do: every call site is `if (x) fail(...)` with no await, so
 *  an async fail would let the script carry on past its own failure.) */
const fail = (msg) => {
  throw new VerifyFailure(msg);
};

mkdirSync(SHOTS, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: CITY_URL });

const t0 = Date.now();
while (true) {
  const ok = await evalJs("!!(window.__globe && window.__globe.camera)").catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 60_000) fail("globe never booted");
  await sleep(250);
}
console.log(`globe booted after ${Date.now() - t0} ms`);
// Welcome overlay eats pointer events + the first screenshot — dismiss via canvas pointerdown.
await evalJs(
  `document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`,
);

// --- 1+2: terrain tiles stream and heightAt reads GLO-30 over the river transect -------------
// REFINED-STATE GATE (v2 — the first run asserted while only coarse ancestors were parsed:
// heightAt's raw down-ray hits whatever mesh exists, and coarse CWT quads legitimately read
// tens of metres or negative; the clamp discipline in lib/geo/terrain.ts exists for exactly
// this). Truth requires: a DEEP patch tile (L12/13) streamed AND the city sample stable in the
// plausible refined band before the river transect means anything.
const RIVER = [
  [48.478, 35.052], [48.482, 35.06], [48.487, 35.068], [48.49, 35.078], [48.472, 35.088],
];
let riverMin = null;
let cityH = null;
let lastCity = null;
let stableSince = 0;
const t1 = Date.now();
while (Date.now() - t1 < 90_000) {
  const deepSeen = [...netLog.urls, ...(netLog.deep ?? [])].some((u) => /\/1[23]\/\d+\/\d+\.terrain/.test(u)) || netLog.deepOk > 0;
  cityH = await evalJs("window.__globe.terrainHeightAt(48.4647, 35.0462)").catch(() => null);
  const stable = cityH !== null && lastCity !== null && Math.abs(cityH - lastCity) < 0.5;
  if (stable && stableSince === 0) stableSince = Date.now();
  if (!stable) stableSince = 0;
  lastCity = cityH;
  if (deepSeen && cityH !== null && cityH > 60 && cityH < 220 && stableSince && Date.now() - stableSince > 3000) {
    const hs = await evalJs(
      `[${RIVER.map(([la, lo]) => `window.__globe.terrainHeightAt(${la}, ${lo})`).join(",")}]`,
    ).catch(() => null);
    const known = (hs ?? []).filter((h) => h !== null);
    if (known.length === RIVER.length) {
      riverMin = Math.min(...known);
      break;
    }
  }
  await sleep(1000);
}
console.log(
  `terrain: ${netLog.terrainOk} patch tiles OK (${netLog.deepOk ?? 0} deep L12/13) / ${netLog.terrainFail} failed · city heightAt ${cityH?.toFixed?.(1)} m (stable) · river min ${riverMin?.toFixed?.(1)} m`,
);
console.log(`  sample: ${[...netLog.urls].join("\n          ")}`);
await sleep(2500); // let refinement paint
await shoot("u7b-01-dnipro-glo30-terrain.jpeg");
if (netLog.terrainOk === 0) fail("no patch tiles streamed — hook inactive");
if (netLog.terrainFail > 0) fail(`${netLog.terrainFail} patch tile failures`);
if (riverMin === null) fail("refined state never reached (deep tiles + stable city height)");
if (!(riverMin >= 60 && riverMin <= 84))
  fail(`river min ${riverMin.toFixed(1)} m — outside the GLO-30 band [60,84] (CWT rendered ~88-94; coarse reads sit below 60)`);

// --- 3: best-variant default — o2w streams with NO ?enriched= param --------------------------
const tilesets = [...netLog.enrichedTilesets];
console.log(`enriched tilesets requested: ${tilesets.join(" · ") || "(none)"}`);
if (!tilesets.some((u) => u.includes("/enriched/dnipro-o2w/tileset.json")))
  fail("default did not stream the o2w bake (best-variant rule)");

// --- 4: BLD chip is a LIVE on/off ------------------------------------------------------------
const SCENE_COUNT = `(() => {
  let root = window.__globe.sunLight; while (root.parent) root = root.parent;
  return root.children.length;
})()`;
const before = await evalJs(SCENE_COUNT);
const clicked = await evalJs(
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'BLD'); if (!b) return false; b.click(); return true; })()`,
);
if (!clicked) fail("BLD chip not found");
await sleep(1200);
const after = await evalJs(SCENE_COUNT);
await shoot("u7b-02-bld-off.jpeg");
await evalJs(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'BLD').click(), true`);
await sleep(1200);
const restored = await evalJs(SCENE_COUNT);
console.log(`BLD live toggle: scene children ${before} → ${after} → ${restored}`);
if (!(after < before)) fail("BLD off did not detach building groups (expected scene children to drop)");
if (restored !== before) fail("BLD on did not restore the scene graph");

// --- seam shot (visual): the 34.0°E extent boundary ------------------------------------------
await send("Page.navigate", { url: "about:blank" });
await sleep(400);
await send("Page.navigate", { url: SEAM_URL });
await sleep(1000);
const t2 = Date.now();
while (Date.now() - t2 < 30_000) {
  const h = await evalJs("window.__globe && window.__globe.terrainHeightAt(48.5, 34.025)").catch(() => null);
  if (h !== null && h !== false) break;
  await sleep(1000);
}
await sleep(3500);
await shoot("u7b-03-extent-west-seam.jpeg");

// --- 5: /m twin — ▦ 3D DETAIL toggles live in 3D mode ----------------------------------------
await send("Page.navigate", { url: "http://localhost:4321/m" });
const t3 = Date.now();
while (true) {
  const ok = await evalJs("!!(window.__globe && window.__globe.camera)").catch(() => false);
  if (ok) break;
  if (Date.now() - t3 > 60_000) fail("/m never booted");
  await sleep(250);
}
await sleep(1500);
const to3d = await evalJs(
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => /3D$/.test(x.textContent.trim()) && !/DETAIL/.test(x.textContent)); if (!b) return null; b.click(); return b.textContent.trim(); })()`,
);
console.log(`/m mode chip clicked: ${JSON.stringify(to3d)}`);
await sleep(2500);
const mProbe = await evalJs(
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('3D DETAIL')); if (!b) return null; const was = b.getAttribute('aria-pressed'); b.click(); return { was, label: b.textContent.trim() }; })()`,
);
await sleep(1200);
const mProbe2 = await evalJs(
  `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('3D DETAIL')); return b && b.getAttribute('aria-pressed'); })()`,
);
console.log(`/m 3D DETAIL: ${JSON.stringify(mProbe)} → aria-pressed ${mProbe2}`);
await shoot("u7b-04-m-3d-detail.jpeg");
if (!mProbe) fail("/m 3D DETAIL chip not found in 3D mode");
if (mProbe.was === mProbe2) fail("/m 3D DETAIL did not flip");
// restore ON for the owner's next session
if (mProbe2 === "false")
  await evalJs(`[...document.querySelectorAll('button')].find((x) => x.textContent.includes('3D DETAIL'))?.click(), true`);

console.log("PASS: patch streams · river reads GLO-30 · o2w default · BLD live · /m twin live");
ws.close();
await finishVerify(0); // audit #3 C11: return the CDP target on the success path too
