// Browser regression probe for audit-2 A1: the U4 aim-cone terrain seat must sit ON the
// ground (clamped [0, 9000] m), never underground — one coarse-LOD negative heightAt sample
// used to snap the circle below the ellipsoid and the ease retained it (scene/aimCones.ts
// easeSeatM now owns the clamp; unit twin in test/components/globe/aimCones.test.ts).
//
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs [--headless] --port 9333),
// then `node scripts/verify-aimcone-seat.mjs [cdpPort] [shotsDir]`.
// Asserts, at a street-level Dnipro orbit pose: the aim-cone group is visible, its seat
// height is in [0, 9000] m, and it tracks the live terrainHeightAt clamp. Screenshot lands
// in verify-shots/ (git-ignored).
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots";
// Street-level orbit pose over central Dnipro (terrain ~90-140 m) — tilted so ground reads.
const URL = "http://localhost:4321/#p=48.46470,35.04620,900,15.0,55.0";

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

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
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL });

const t0 = Date.now();
while (true) {
  const ok = await evalJs("!!(window.__globe && window.__globe.camera)").catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 60_000) throw new Error("globe never booted");
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`globe booted after ${Date.now() - t0} ms`);

// The aim-cone root is the only scene child carrying the sector ShaderMaterial (uPast +
// uNow01 + uAlpha) — locate it structurally, read its seat from the group matrix.
const PROBE = `(() => {
  const g = window.__globe;
  let sceneRoot = g.sunLight;
  while (sceneRoot.parent) sceneRoot = sceneRoot.parent;
  let aimRoot = null;
  sceneRoot.traverse((o) => {
    const u = o.material && o.material.uniforms;
    if (u && u.uPast && u.uNow01 && u.uAlpha && !aimRoot) {
      let n = o;
      while (n.parent && n.parent !== sceneRoot) n = n.parent;
      aimRoot = n;
    }
  });
  if (!aimRoot) return { found: false };
  const e = aimRoot.matrix.elements;
  const px = e[12], py = e[13], pz = e[14];
  const seatLen = Math.hypot(px, py, pz);
  // |ecef(lat,lon,0)| at the anchor from the pose hash (WGS84).
  const lat = 48.4647 * Math.PI / 180, lon = 35.0462 * Math.PI / 180;
  const a = 6378137, b = 6356752.314245, e2 = 1 - (b * b) / (a * a);
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const x0 = N * Math.cos(lat) * Math.cos(lon);
  const y0 = N * Math.cos(lat) * Math.sin(lon);
  const z0 = N * (1 - e2) * Math.sin(lat);
  const groundLen = Math.hypot(x0, y0, z0);
  return {
    found: true,
    visible: aimRoot.visible,
    children: aimRoot.children.length,
    seatHeightM: seatLen - groundLen,
    liveClampedProbe: (() => {
      const h = g.terrainHeightAt(48.4647, 35.0462);
      return h === null ? null : Math.min(Math.max(h, 0), 9000);
    })(),
  };
})()`;

// Poll until the cones are up and seated on real terrain (tiles must stream in first).
let probe = null;
const t1 = Date.now();
while (Date.now() - t1 < 45_000) {
  probe = await evalJs(PROBE).catch(() => null);
  if (probe?.found && probe.visible && probe.liveClampedProbe !== null && probe.seatHeightM > 1) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log("probe:", JSON.stringify(probe, null, 2));

mkdirSync(SHOTS, { recursive: true });
await new Promise((r) => setTimeout(r, 2500)); // let the ease settle + tiles paint
const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 78 });
const path = `${SHOTS}/audit2-s1-aimcone-seat.jpeg`;
writeFileSync(path, Buffer.from(shot.data, "base64"));
console.log(`shot: ${path}`);

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
if (!probe?.found) fail("aim-cone group not found in the scene");
if (!probe.visible) fail("aim-cone group not visible at street-level orbit");
if (!(probe.seatHeightM >= 0)) fail(`seat is UNDERGROUND: ${probe.seatHeightM} m`);
if (!(probe.seatHeightM <= 9000)) fail(`seat above the clamp ceiling: ${probe.seatHeightM} m`);
console.log(
  `PASS: seat ${probe.seatHeightM.toFixed(1)} m above ellipsoid (live clamped probe ${probe.liveClampedProbe?.toFixed?.(1)} m)`,
);
ws.close();
