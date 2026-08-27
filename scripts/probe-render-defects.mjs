// RESEARCH PROBE (not a gate) — the owner's three ULTRA rendering defects, 2026-08-27.
//
//  1. shadows cropped/sliced at mountain scales (one capped shadow ortho → the cascade ladder)
//  2. the sunset "piss tint" / uniform sky dome / anti-sun faces lit
//  3. dark lines between drape tiles in ULTRA (the terrain skirt in the shadow pipeline)
//
// Shoots each pose TWICE — cascades on, then off — so every claim has its own A/B pair.
// `probe-` prefix = the C11 harness fence's research escape (test/verifyHarness.test.ts).
// Usage: wix dev on :4321 + CDP Chrome, then
//   node --experimental-websocket scripts/probe-render-defects.mjs [cdpPort] [shotsDir] [tag]
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
const TAG = process.argv[4] ?? "run";
mkdirSync(SHOTS, { recursive: true });

const http = (p, m = "GET") => fetch(`http://127.0.0.1:${PORT}${p}`, { method: m }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
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
await send("Page.enable");
await send("Runtime.enable");
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const shoot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.data, "base64"));
  console.log(`shot  ${SHOTS}/${name}.jpeg`);
};
const waitFor = async (expr, timeoutMs = 45000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(expr)) return true;
    } catch {
      /* booting */
    }
    await sleep(500);
  }
  return false;
};

// `#p=<focusLat>,<focusLon>,<camAltM>,<headingDeg>,<tiltDeg>` — lib/geo/urlPose. The focus is the
// point LOOKED AT; the camera is derived back along the heading at that altitude and tilt, and
// tilt is clamped to [0, 88] with 88 ≈ level. Getting this order wrong (tilt/heading swapped)
// silently flies somewhere else entirely — it cost a whole probe round on 2026-08-27.
//
// Times are UTC. Fuji sits at lon 138.73, so local solar noon is ≈ 02:45 UTC and the sun is low
// from ≈ 08:15 UTC on. Dnipro (lon 35.05) runs ≈ 09:40 UTC noon, sunset ≈ 17:20 UTC.
const POSES = [
  // 1a — over Fuji looking WNW at the massif, sun low behind it: the "all of these should have
  //      cast a shadow" frame.
  { id: "fuji-far", lat: 35.3606, lon: 138.7274, alt: 5000, head: 300, tilt: 84, t: Date.UTC(2026, 7, 21, 8, 15) },
  // 1b — east of Fuji looking back west into the low sun, where its own cone shadow lies.
  { id: "fuji-own", lat: 35.36, lon: 138.95, alt: 12000, head: 265, tilt: 78, t: Date.UTC(2026, 7, 21, 8, 35) },
  // 2a — mountains with the sun ~2° up (the tint + anti-sun-lit terrain).
  { id: "dusk-mtn", lat: 35.5, lon: 138.35, alt: 3500, head: 285, tilt: 86, t: Date.UTC(2026, 7, 21, 8, 50) },
  // 2b — the same, sun BELOW the horizon ("nothing changes").
  { id: "dusk-mtn-below", lat: 35.5, lon: 138.35, alt: 3500, head: 285, tilt: 86, t: Date.UTC(2026, 7, 21, 9, 25) },
  // 2c — city at sunset, backs of buildings ("deep shadow" expected).
  { id: "dusk-city", lat: 48.464, lon: 35.046, alt: 700, head: 292, tilt: 86, t: Date.UTC(2026, 7, 21, 17, 5) },
  // 3 — the drape seam grid, oblique over flat farmland.
  { id: "seams", lat: 48.62, lon: 35.2, alt: 5000, head: 210, tilt: 55, t: Date.UTC(2026, 7, 21, 12, 40) },
];

const LOOK = `(() => { try { return window.__globe.ultraLook(); } catch (e) { return { err: String(e) }; } })()`;
const SUN_ALT = `(() => { try {
  const b = window.__globe.bodies();
  const p = window.__globe.camera.position.clone().normalize();
  const s = new (window.__globe.camera.position.constructor)(...b.sunDir);
  return +(Math.asin(Math.max(-1, Math.min(1, s.dot(p)))) * 180 / Math.PI).toFixed(2);
} catch (e) { return null; } })()`;
// Cascades off = a getter trap, because the orchestrator rewrites castShadow every frame.
const CASCADES_OFF = `(() => {
  const list = window.__globe.cascadeLights || [];
  for (const L of list) Object.defineProperty(L, "castShadow", { get: () => false, set: () => {}, configurable: true });
  return list.length;
})()`;

await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 2, mobile: false });
await send("Page.bringToFront");

// Persist the ULTRA pref BEFORE the first boot so the construction-time rig is the ULTRA one.
await send("Page.navigate", { url: "http://localhost:4321/" });
await sleep(6000);
await evalJs(`(() => {
  const k = "ftw:view-prefs:v1";
  const o = JSON.parse(localStorage.getItem(k) || "{}");
  o.ultraQuality = true;
  localStorage.setItem(k, JSON.stringify(o));
  return o;
})()`);

for (const p of POSES) {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(500);
  await send("Page.navigate", {
    url: `http://localhost:4321/#p=${p.lat},${p.lon},${p.alt},${p.head},${p.tilt}&t=${p.t}`,
  });
  if (!(await waitFor(`!!window.__globe && !!window.__globeQuality`))) {
    console.log(`SKIP ${p.id} — engine never booted`);
    continue;
  }
  await evalJs(`window.__cameraStore.getState().setUltraQuality(true)`);
  await sleep(24000); // stream terrain + drape, settle the eased ULTRA terms
  const look = await evalJs(LOOK);
  const sunAlt = await evalJs(SUN_ALT);
  const cov = Math.round(look.shadowCoverM ?? 0);
  const fit = Math.round(look.shadow?.viewFitM ?? 0);
  console.log(`\n=== ${p.id} ===   sun ${sunAlt}°`);
  console.log(`  cascade0 boundsM=${look.shadow?.boundsM} focusOffsetM=${Math.round(look.shadow?.focusOffsetM ?? 0)}`);
  console.log(`  ladder   ${JSON.stringify((look.cascades ?? []).map((c) => ({
    on: c.casting && c.active, px: c.mapPx, half: c.boundsM, mpt: +c.metresPerTexel.toFixed(1), lit: c.lightIntensity,
  })))}`);
  console.log(`  COVER ${cov} m vs view ${fit} m → ${fit > 0 ? Math.round((100 * Math.min(cov, fit)) / fit) : 0}%`);
  console.log(`  terrain ${JSON.stringify(look.terrain)}`);
  console.log(`  haze=${(look.haze ?? 0).toFixed(3)} hazeCol=#${(look.hazeCol ?? 0).toString(16)} exposure=${(look.exposure ?? 0).toFixed(3)}`);
  const d = look.dusk ?? {};
  console.log(`  DUSK skyLevel=${(d.skyLevel ?? 0).toFixed(3)} directK=${(d.directK ?? 0).toFixed(3)} afterglow=${(d.afterglow ?? 0).toFixed(3)}`);
  console.log(`       keyLevel=${(d.keyLevel ?? 0).toFixed(3)} keyCol=#${(d.keyCol ?? 0).toString(16)} cool=#${(d.hazeCool ?? 0).toString(16)} disc=${(d.sunDiscExtinct ?? 0).toFixed(3)}`);
  await shoot(`rdef-${TAG}-${p.id}-cascades`);
  const n = await evalJs(CASCADES_OFF);
  await sleep(2000);
  await shoot(`rdef-${TAG}-${p.id}-onebox`);
  console.log(`  A/B: ${n} cascade lights suppressed for the "onebox" shot`);
}

await send("Page.close").catch(() => {});
ws.close();
console.log("\ndone");
process.exit(0);
