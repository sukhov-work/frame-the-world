#!/usr/bin/env node
/**
 * T77 MEASURE — a main-thread CPU PROFILE of a settled pose (2026-09-05).
 *
 * The baseline harness read `frame.cpu` (the orchestrator's `tilesHandle.update()` bracket) at
 * 38 ms per frame on a STATIC orbit pose — a frame budget spent before a single draw call. A
 * number that size needs an attribution, not a guess: this probe attaches V8's sampling profiler
 * (CDP `Profiler`, 250 µs interval) to a settled pose for a few seconds and prints the self-time
 * ledger by FUNCTION and by FILE, and writes the raw `.cpuprofile` for DevTools (Performance →
 * load profile). Read-only: no seam, no behaviour, no src/ change.
 *
 *   node scripts/probe-cpu-profile.mjs [PORT] [--pose fpv|orbit|city|everest] [--seconds 6]
 *        [--ultra] [--top 30]
 *
 * Preconditions as the baseline harness (`wix dev` :4321, the owner's headed Chrome :9222,
 * Node ≥ 22). Never alongside another timed harness. `probe-` prefix: a research instrument, not
 * a gate — it asserts nothing.
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
const SECONDS = Number(opt("--seconds", "6"));
const ULTRA = args.includes("--ultra");
const TOP = Number(opt("--top", "30"));
const DEV = "http://localhost:4321";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = "verify-shots/perf";
mkdirSync(OUT_DIR, { recursive: true });
const T_FPV = 1787133600000;
const T_ULTRA = Date.UTC(2026, 7, 21, 9, 40);
const POSES = {
  fpv: { url: `${DEV}/#f=48.4647,35.0462,1.7,25,8,60&t=${T_FPV}`, kind: "fpv" },
  orbit: { url: `${DEV}/#p=48.4647,35.0462,700,25,40&t=${T_FPV}`, kind: "orbit" },
  city: { url: `${DEV}/#p=48.464,35.046,900,74,300&t=${T_ULTRA}`, kind: "orbit" },
  everest: { url: `${DEV}/#p=27.87,86.83,11500,76,35&t=${T_ULTRA}`, kind: "orbit" },
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
  source: `(() => { try { const k = "ftw:view-prefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.ultraQuality = ${ULTRA}; o.debugHud = false; localStorage.setItem(k, JSON.stringify(o)); } catch {} })()`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url: pose.url });
await waitFor(`!!(window.__globe && window.__globe.camera && window.__renderer && window.__globe.u5)`);
await send("Page.bringToFront");
await evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`);
await waitFor(`!window.__globe.flight || !window.__globe.flight.active()`);
if (pose.kind === "fpv") await waitFor(`!!window.__globe.fpv && window.__globe.fpv().active`);
// settle on the queue counters (the baseline harness's gate)
const BUSY = `(() => { const u = window.__globe.u5(); const q = (r) => r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0; return q(u.buildings) + q(u.ground) + q(u.enriched); })()`;
{
  const t0 = Date.now();
  let quiet = null;
  while (Date.now() - t0 < 30_000) {
    if ((await evalJs(BUSY)) === 0) {
      quiet ??= Date.now();
      if (Date.now() - quiet > 2000) break;
    } else quiet = null;
    await sleep(250);
  }
}
const before = await evalJs(`(() => { const f = window.__debugFeed; f.setActive(true); return true; })()`);
await sleep(1500);
const cpu0 = await evalJs(`(() => { const s = window.__debugFeed.series("frame.cpu"); const d = window.__debugFeed.series("frame.dt"); return { cpuP50: s && s.p50, dtP50: d && d.p50 }; })()`);
await evalJs(`window.__debugFeed.setActive(false), true`);
console.log(`pose ${POSE} ultra ${ULTRA}: settled — frame.cpu p50 ${cpu0.cpuP50?.toFixed(1)} ms, frame.dt p50 ${cpu0.dtP50?.toFixed(1)} ms (${before})`);

await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 250 });
await send("Page.bringToFront");
await send("Profiler.start");
await sleep(SECONDS * 1000);
const { profile } = await send("Profiler.stop");
await send("Profiler.disable");

// ── self-time ledger ────────────────────────────────────────────────────────────────────────
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const selfUs = new Map(); // nodeId → µs
for (let i = 0; i < profile.samples.length; i++) {
  selfUs.set(profile.samples[i], (selfUs.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
}
const totalUs = profile.endTime - profile.startTime;
const byFn = new Map();
const byFile = new Map();
const parentOf = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
const shortUrl = (u) => (u ? u.replace(/^https?:\/\/localhost:4321\//, "").replace(/\?.*$/, "") : "(native)");
for (const [id, us] of selfUs) {
  const n = nodes.get(id);
  const cf = n.callFrame;
  const fn = `${cf.functionName || "(anonymous)"}  ${shortUrl(cf.url)}:${cf.lineNumber + 1}`;
  byFn.set(fn, (byFn.get(fn) ?? 0) + us);
  const file = shortUrl(cf.url) || "(native)";
  byFile.set(file, (byFile.get(file) ?? 0) + us);
}
// inclusive time for a few named roots (the orchestrator bracket and three's render)
const inclusive = new Map();
for (const [id, us] of selfUs) {
  let cur = id;
  const seen = new Set();
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    const n = nodes.get(cur);
    const key = `${n.callFrame.functionName || "(anonymous)"}  ${shortUrl(n.callFrame.url)}`;
    inclusive.set(key, (inclusive.get(key) ?? 0) + us);
    cur = parentOf.get(cur);
  }
}
const pctOf = (us) => ((100 * us) / totalUs).toFixed(1).padStart(5);
const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
console.log(`\nprofile ${(totalUs / 1000).toFixed(0)} ms wall, ${profile.samples.length} samples\n`);
console.log(`── self time by FILE ──`);
for (const [f, us] of top(byFile, 15)) console.log(`${pctOf(us)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${f}`);
console.log(`\n── self time by FUNCTION (top ${TOP}) ──`);
for (const [f, us] of top(byFn, TOP)) console.log(`${pctOf(us)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${f}`);
console.log(`\n── inclusive time, selected roots ──`);
const want = /update|render|tick|step|heightAt|raycast|traverse|seat|sample|animate|frame|intersect|Object3D|Matrix4|Frustum|LRU|schedule|prior/i;
for (const [f, us] of top(inclusive, 400).filter(([k]) => want.test(k)).slice(0, 40)) console.log(`${pctOf(us)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${f}`);

const path = `${OUT_DIR}/cpu-${POSE}${ULTRA ? "-ultra" : ""}-${STAMP}.cpuprofile`;
writeFileSync(path, JSON.stringify(profile));
writeFileSync(
  `${OUT_DIR}/cpu-${POSE}${ULTRA ? "-ultra" : ""}-${STAMP}.summary.json`,
  JSON.stringify({ pose: POSE, ultra: ULTRA, seconds: SECONDS, cpuP50: cpu0.cpuP50, dtP50: cpu0.dtP50, totalUs, byFile: top(byFile, 30), byFn: top(byFn, 80), inclusive: top(inclusive, 200) }, null, 2),
);
console.log(`\nwrote ${path} (DevTools → Performance → Load profile)`);
await finishVerify(0);
