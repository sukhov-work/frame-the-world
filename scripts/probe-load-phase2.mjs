#!/usr/bin/env node
/**
 * T106 slice (b) probe (2026-09-07e) — the two-phase `load-model` handler through the descent.
 *
 * Boots the catalogue's `dnipro-descent` START pose on the house Chrome, settles, then drives the
 * owner's descent exactly as `verify-visual-sweep` / `probe-cpu-profile --leg descent` do
 * (`requestFly` → the arrival targets → quiet), recording every rAF dt through the landing and
 * sampling the deferred queue every 250 ms. At the end it READS the orchestrator's own seams:
 *   · `__globe.enrichedLoad()` — the handler ledger: phase 1 (`handlerMaxMs`, now µs), the
 *     per-unit worst (`edgesMaxMs` / `maskMaxMs` / `registerMaxMs`), the per-DRAIN worst
 *     (`deferredMaxMs` — the number the budget bounds), totals, units done / cancelled;
 *   · `__globe.enrichedBench(50)` — the §4a identity proof on the resident cells (`mismatch` 0);
 *   · `__globe.enrichedSeats()` — that the registry is populated (features seated after quiet);
 *   · the frame-time p50 / p95 / max and the >33 ms count over the leg.
 * `--lean` boots the phone twin (touch + 402×714 @3 + 4 cores + 4× CPU throttle) — the number
 * the Pixel decision reads while the device is away.
 *
 *   node --experimental-websocket scripts/probe-load-phase2.mjs 9333 [--lean] [--budget ms] [--label x]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const LEAN = args.includes("--lean");
const labelArg = args.indexOf("--label");
const budgetArg = args.indexOf("--budget");
/** Override the phase-2 budget live (ms). A huge value (1e6) reproduces the pre-slice shape. */
const BUDGET = budgetArg >= 0 ? Number(args[budgetArg + 1]) : null;
const LABEL = labelArg >= 0 ? args[labelArg + 1] : `t106b${LEAN ? "-lean" : ""}`;
const DEV = "http://localhost:4321";

await ensureBrowser(PORT);
const descent = byId("dnipro-descent");
const url = `${DEV}${descent.path}${descent.hash}&t=${descent.t}`;
let target;
try {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
} catch {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
}
trackTarget(PORT, target.id);
const s = await openSession(target);
if (LEAN) {
  await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 4, configurable: true });`,
  });
  await s.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
  await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}
await s.bootUrl(url);
await s.waitFor(`!!window.__globe && typeof window.__globe.enrichedLoad === "function"`, 90_000, "globe up");
await s.evalJs(
  `(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`,
);
const BUSY = `(() => { const u = window.__globe.u5(); const q = (r) => r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0; return q(u.buildings) + q(u.ground) + q(u.enriched); })()`;
// settle the start pose (bounded)
{
  const t0 = Date.now();
  let quietSince = null;
  while (Date.now() - t0 < 40_000) {
    const busy = await s.evalJs(BUSY);
    if (busy === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince > 2000) break;
    } else quietSince = null;
    await sleep(250);
  }
}
if (BUDGET != null) console.log(`budget override → ${await s.evalJs(`window.__globe.enrichedLoadBudget ? window.__globe.enrichedLoadBudget(${BUDGET}) : null`)} ms`);
const loadAtStart = JSON.parse(await s.evalJs(`JSON.stringify(window.__globe.enrichedLoad())`));
// the rAF recorder for the leg
await s.evalJs(`(() => { window.__ftDt = []; let last = performance.now(); const step = () => { const n = performance.now(); window.__ftDt.push(n - last); last = n; if (window.__ftDt.length < 20000) requestAnimationFrame(step); }; requestAnimationFrame(step); return true; })()`);
const { end, afterArrivalS, maxLegS } = descent.leg;
const hasStore = await s.evalJs(`!!(window.__cameraStore && window.__cameraStore.getState().requestFly)`);
if (!hasStore) throw new Error("__cameraStore.requestFly absent");
const tLeg0 = Date.now();
await s.evalJs(`(() => { const st = window.__cameraStore.getState(); st.requestFly({ latDeg: ${end.latDeg}, lonDeg: ${end.lonDeg}, altM: ${end.altM} }); return true; })()`);
let arrivedAt = null;
let targetsIssued = false;
let quietAtEnd = false;
let drainedAt = null; // first sample after arrival with pending == 0 and the streams quiet
const samples = [];
let peakPending = 0;
while (Date.now() - tLeg0 < maxLegS * 1000) {
  const flying = await s.evalJs(`!!(window.__globe.flight && window.__globe.flight.active())`);
  if (!flying && !targetsIssued) {
    await s.evalJs(`(() => { const st = window.__cameraStore.getState(); st.setTargetHeading(${end.headingDeg}); st.setTargetTilt(${end.tiltDeg}); st.setTargetZoom(${end.altM}); return true; })()`);
    targetsIssued = true;
  }
  const busy = await s.evalJs(BUSY);
  const ld = JSON.parse(await s.evalJs(`JSON.stringify(window.__globe.enrichedLoad())`));
  const pending = ld.pending ?? 0; // absent on the pre-slice ledger
  samples.push({ tMs: Date.now() - tLeg0, flying, busy, pending, done: ld.unitsDone ?? null, deferredMaxMs: +(ld.deferredMaxMs ?? 0).toFixed(1) });
  if (pending > peakPending) peakPending = pending;
  if (!flying && targetsIssued) {
    arrivedAt ??= Date.now();
    if (busy === 0 && pending === 0) drainedAt ??= Date.now();
    if (Date.now() - arrivedAt >= afterArrivalS * 1000 && busy === 0 && pending === 0) {
      quietAtEnd = true;
      break;
    }
  }
  await sleep(250);
}
const legMs = Date.now() - tLeg0;
const dt = JSON.parse(await s.evalJs(`JSON.stringify(window.__ftDt)`));
const load = JSON.parse(await s.evalJs(`JSON.stringify(window.__globe.enrichedLoad())`));
const bench = JSON.parse(await s.evalJs(`JSON.stringify(window.__globe.enrichedBench(50))`));
const seats = JSON.parse(
  await s.evalJs(`(() => { const x = window.__globe.enrichedSeats(); return JSON.stringify(x ? { cells: x.cells, located: x.located, features: x.features, featuresSampled: x.featuresSampled, overridden: x.overridden } : null); })()`),
);
const sorted = [...dt].sort((a, b) => a - b);
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const out = {
  label: LABEL,
  lean: LEAN,
  url,
  leg: { legMs, quietAtEnd, arrivalToDrainedMs: arrivedAt && drainedAt ? drainedAt - arrivedAt : null, peakPending },
  budgetOverride: BUDGET,
  loadAtStart: { cells: loadAtStart.cells, deferredMaxMs: +(loadAtStart.deferredMaxMs ?? 0).toFixed(1), handlerMaxMs: +loadAtStart.handlerMaxMs.toFixed(2) },
  load: Object.fromEntries(Object.entries(load).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v])),
  frames: { n: dt.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +Math.max(...dt).toFixed(1), over33: dt.filter((x) => x > 33).length, over50: dt.filter((x) => x > 50).length },
  bench: bench && { parts: bench.parts, tris: bench.tris, mismatch: bench.mismatch, runMismatch: bench.runMismatch, fastMs: +bench.fastMs.toFixed(1), maskIntMs: +bench.maskIntMs.toFixed(1) },
  seats,
  samples,
};
mkdirSync("verify-shots/t106b", { recursive: true });
const file = `verify-shots/t106b/${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
const { samples: _s, ...summary } = out;
console.log(JSON.stringify(summary, null, 2));
console.log(`wrote ${file}`);
s.close();
await finishVerify(0);
