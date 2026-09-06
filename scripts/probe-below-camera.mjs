#!/usr/bin/env node
/**
 * T79 probe — WHERE the controls' down-raycast spends its time, per scene object (2026-09-06).
 *
 *   node scripts/probe-below-camera.mjs [9222] [--pose orbit|city|everest|m|fpv] [--reps 5]
 *
 * Boots the pose in a fresh tab on the HEADED :9222 Chrome (`wix dev` up, Node 24 PATH), settles on
 * the tile queues, then — INSIDE the page — rebuilds the exact ray `EnvironmentControls._getPointBelowCamera`
 * builds (origin 1e5 m above the camera along `controls.up`, pointing down) and times
 * `raycaster.intersectObject(child, true)` for every top-level child of the controls' scene, and one
 * level deeper for every TilesGroup (per loaded tile scene). Prints the ranking, the triangle census
 * of each candidate, and the whole-call cost with and without `__globe.controls.belowCameraGate`
 * when that seam exists (the T79 A/B). Read-only: no seeds, no world writes, no src edits.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9222";
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const POSE = opt("--pose", "orbit");
const REPS = Number(opt("--reps", "5"));
const DEV = "http://localhost:4321";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = "verify-shots/perf";
mkdirSync(OUT_DIR, { recursive: true });
const T_FPV = 1787133600000;
const T_ULTRA = Date.UTC(2026, 7, 21, 9, 40);
const T_M = 1787313600000;
const POSES = {
  fpv: { url: `${DEV}/#f=48.4647,35.0462,1.7,25,8,60&t=${T_FPV}`, kind: "fpv" },
  orbit: { url: `${DEV}/#p=48.4647,35.0462,700,25,40&t=${T_FPV}`, kind: "orbit" },
  city: { url: `${DEV}/#p=48.464,35.046,900,74,300&t=${T_ULTRA}`, kind: "orbit" },
  everest: { url: `${DEV}/#p=27.87,86.83,11500,76,35&t=${T_ULTRA}`, kind: "orbit" },
  m: { url: `${DEV}/m#p=48.4640,35.0460,220,0,0&t=${T_M}`, kind: "m" },
};
const pose = POSES[POSE];
if (!pose) throw new Error(`unknown pose ${POSE}`);

const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
trackTarget(PORT, target.id);
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
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
  return r.result.value;
};
const waitFor = async (expr, timeoutMs = 120_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(expr)) return true;
    } catch {
      /* booting */
    }
    await sleep(400);
  }
  throw new Error(`timed out waiting for ${expr}`);
};
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => { try { const k = "ftw:view-prefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.ultraQuality = false; o.debugHud = false; localStorage.setItem(k, JSON.stringify(o)); } catch {} })()`,
});
if (pose.kind === "m") {
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
} else {
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 2, mobile: false });
}
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url: pose.url });
await waitFor(`!!(window.__globe && window.__globe.camera && window.__renderer && window.__globe.u5)`);
await send("Page.bringToFront");
await evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), true`);
await waitFor(`!window.__globe.flight || !window.__globe.flight.active()`);
if (pose.kind === "fpv") await waitFor(`!!window.__globe.fpv && window.__globe.fpv().active`);
const BUSY = `(() => { const u = window.__globe.u5(); const q = (r) => r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0; return q(u.buildings) + q(u.ground) + q(u.enriched); })()`;
{
  const t0 = Date.now();
  let quiet = null;
  while (Date.now() - t0 < 45_000) {
    if ((await evalJs(BUSY)) === 0) {
      quiet ??= Date.now();
      if (Date.now() - quiet > 2000) break;
    } else quiet = null;
    await sleep(250);
  }
}

const PROBE = `(() => {
  const c = window.__globe.controls; const scene = c.scene; const cam = c.camera;
  const RC = c.raycaster.constructor; const V3 = cam.position.constructor;
  const up = new V3().copy(c.up);
  const mk = () => { const r = new RC(); r.firstHitOnly = true; r.ray.direction.copy(up).multiplyScalar(-1); r.ray.origin.copy(cam.position).addScaledVector(up, 1e5); r.near = 0; r.far = Infinity; r.camera = cam; return r; };
  const tris = (o) => { let n = 0, meshes = 0, live = 0; o.traverse((x) => { if (x.isMesh && x.geometry) { meshes++; const p = x.geometry.getAttribute("position"); const idx = x.geometry.index; n += idx ? idx.count / 3 : p ? p.count / 3 : 0; if (x.raycast !== Object.getPrototypeOf(x).raycast || x.raycast.length !== 0) live++; } }); return { tris: Math.round(n), meshes, liveish: live }; };
  const time = (obj, reps) => { const r = mk(); let hits = null; const t0 = performance.now(); for (let i = 0; i < reps; i++) { hits = r.intersectObject(obj, true); } const ms = (performance.now() - t0) / reps; return { ms, hits: hits.length, first: hits[0] ? hits[0].distance - 1e5 : null }; };
  const label = (o) => (o.constructor && o.constructor.name) + (o.name ? ":" + o.name : "") + (o.userData && o.userData.ftwTileDepth !== undefined ? " d" + o.userData.ftwTileDepth : "") + (o.tilesRenderer ? " [TilesGroup]" : "");
  const rows = [];
  for (const ch of scene.children) {
    const t = time(ch, ${REPS}); const census = tris(ch);
    rows.push({ level: 0, label: label(ch), visible: ch.visible, children: ch.children.length, ...census, ...t });
    if (ch.tilesRenderer || (ch.children.length > 0 && t.ms > 0.5)) {
      for (const g of ch.children) { const tt = time(g, ${REPS}); if (tt.ms > 0.05 || tt.hits) rows.push({ level: 1, label: label(g), visible: g.visible, children: g.children.length, ...tris(g), ...tt }); }
    }
  }
  rows.sort((a, b) => b.ms - a.ms);
  const whole = (() => { const t0 = performance.now(); let h; for (let i = 0; i < ${REPS}; i++) h = c._getPointBelowCamera(); return { ms: (performance.now() - t0) / ${REPS}, dist: h ? h.distance : null }; })();
  let gate = null;
  if (typeof c.belowCameraGate === "function") {
    const was = c.belowCameraGate().enabled;
    c.belowCameraGate(true); const on = (() => { const t0 = performance.now(); let h; for (let i = 0; i < ${REPS}; i++) h = c._getPointBelowCamera(); return { ms: (performance.now() - t0) / ${REPS}, dist: h ? h.distance : null, stats: c.belowCameraGate() }; })();
    c.belowCameraGate(false); const off = (() => { const t0 = performance.now(); let h; for (let i = 0; i < ${REPS}; i++) h = c._getPointBelowCamera(); return { ms: (performance.now() - t0) / ${REPS}, dist: h ? h.distance : null, stats: c.belowCameraGate() }; })();
    c.belowCameraGate(was);
    gate = { on, off };
  }
  const f = window.__debugFeed; let cpu = null; if (f) { f.setActive(true); }
  return { camAlt: (() => { try { return window.__globe.u5().altM ?? null; } catch { return null; } })(), adjustHeight: c.adjustHeight, cameraRadius: c.cameraRadius, sceneChildren: scene.children.length, whole, gate, rows };
})()`;
const r = await evalJs(PROBE);
await sleep(1500);
const cpu = await evalJs(`(() => { const s = window.__debugFeed.series("frame.cpu"); const d = window.__debugFeed.series("frame.dt"); window.__debugFeed.setActive(false); return { cpuP50: s && s.p50, dtP50: d && d.p50 }; })()`).catch(() => null);

console.log(`pose ${POSE}: adjustHeight ${r.adjustHeight} cameraRadius ${r.cameraRadius} scene children ${r.sceneChildren}; frame.cpu p50 ${cpu?.cpuP50?.toFixed?.(1)} ms dt p50 ${cpu?.dtP50?.toFixed?.(1)} ms`);
// `_getPointBelowCamera` already subtracts the 1e5 m lift — its `distance` IS metres below the camera.
console.log(`whole _getPointBelowCamera(): ${r.whole.ms.toFixed(2)} ms/call (hit ${r.whole.dist !== null ? r.whole.dist.toFixed(1) + " m below" : "none"})`);
if (r.gate) console.log(`GATE A/B: on ${r.gate.on.ms.toFixed(2)} ms (${JSON.stringify(r.gate.on.stats)})  off ${r.gate.off.ms.toFixed(2)} ms  hit ${r.gate.on.dist?.toFixed?.(2)} vs ${r.gate.off.dist?.toFixed?.(2)} m below ${r.gate.on.dist === r.gate.off.dist ? "(IDENTICAL)" : "(the gate reports the ellipsoid fallback when every mesh is out of band — the same no-push decision)"}`);
console.log(`\n  ms/call  hits  first(m below)  tris      meshes  label`);
for (const row of r.rows.slice(0, 40)) console.log(`  ${row.ms.toFixed(2).padStart(7)}  ${String(row.hits).padStart(4)}  ${row.first === null ? "      —" : row.first.toFixed(1).padStart(8)}  ${String(row.tris).padStart(8)}  ${String(row.meshes).padStart(6)}  ${"  ".repeat(row.level)}${row.label}${row.visible ? "" : " (hidden)"}`);
const out = `${OUT_DIR}/below-camera-${POSE}-${STAMP}.json`;
writeFileSync(out, JSON.stringify({ pose: POSE, stamp: STAMP, cpu, ...r }, null, 2));
console.log(`\nwrote ${out}`);
await finishVerify(0);
