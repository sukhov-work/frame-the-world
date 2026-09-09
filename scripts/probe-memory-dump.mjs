#!/usr/bin/env node
/**
 * T123 (2026-09-10) — WHAT is the renderer's memory when the tile caches are (nearly) empty?
 *
 * After lever (a) the `/m` stress cycle holds the byte-accounted caches at 0 / 97 / 0 MB on every rest,
 * `renderer.info.memory.geometries` is flat — and the iPhone still hit WebContent's 2 GB ceiling in
 * the 8th cycle; the desktop twin's renderer RSS sits at ~1.4 GB after the FIRST cycle with a
 * ~35 MB/cycle creep (`probe-fpv-cycle-leak.mjs`). A count says PLATEAU; it does not say WHAT. This
 * probe asks Chrome's own memory-infra (the `chrome://memory-internals` dump, through CDP tracing) for
 * the per-allocator breakdown of the page's renderer process — malloc, v8 (the main isolate + every
 * worker isolate), blink_gc, partition_alloc (ArrayBuffers), skia, discardable, shared memory, the
 * WebGL command buffers — at three rests: the 2D boot, after the first FPV exit (drained), and after
 * a second FPV cycle. The deltas name the module class; the absolute sizes name the plateau.
 * Read-only; no src change.
 *
 *   node scripts/probe-memory-dump.mjs [9333] [--cycles 2] [--settle 6] [--top 28] [--canvas-zero]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openSession, sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9333";
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const CYCLES = Number(opt("--cycles", "2"));
const SETTLE_S = Number(opt("--settle", "6"));
const TOP = Number(opt("--top", "28"));
const DEV = process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321";
const T_M = 1787313600000;
const URL = `${DEV}/m#p=48.4640,35.0460,220,0,0&t=${T_M}`;
const SPOTS = [
  { id: "eye", lat: 48.4647, lon: 35.0462 },
  { id: "west-sunset", lat: 48.464627, lon: 35.064907 },
];
mkdirSync("verify-shots/perf", { recursive: true });

let target;
try { target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json()); }
catch { target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json()); }
trackTarget(PORT, target.id);
const s = await openSession(target, { timeoutMs: 120_000 });
await s.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));

// ── the memory-infra collector: trace events arrive on Tracing.dataCollected after Tracing.end ──
const events = [];
s.ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Tracing.dataCollected") events.push(...m.params.value);
});
const dump = async (label) => {
  events.length = 0;
  await s.send("Tracing.start", {
    traceConfig: { includedCategories: ["disabled-by-default-memory-infra"], excludedCategories: ["*"], memoryDumpConfig: { triggers: [] } },
    transferMode: "ReportEvents",
  });
  const r = await s.send("Tracing.requestMemoryDump", { deterministic: true, levelOfDetail: "detailed" });
  await sleep(1500);
  const ended = new Promise((res) => { const h = (ev) => { const m = JSON.parse(ev.data); if (m.method === "Tracing.tracingComplete") { s.ws.removeEventListener("message", h); res(); } }; s.ws.addEventListener("message", h); });
  await s.send("Tracing.end");
  await ended;
  // the memory dump events: ph "v", args.dumps.allocators = { name: { attrs: { size: { value: hex } } } }
  const dumps = events.filter((e) => e.ph === "v" && e.args && e.args.dumps && e.args.dumps.allocators);
  const perProcess = dumps.map((e) => {
    const alloc = e.args.dumps.allocators;
    const size = (n) => { const a = alloc[n]; const v = a && a.attrs && a.attrs.size && a.attrs.size.value; return v ? parseInt(v, 16) : 0; };
    const effective = (n) => { const a = alloc[n]; const v = a && a.attrs && a.attrs.effective_size && a.attrs.effective_size.value; return v ? parseInt(v, 16) : size(n); };
    const names = Object.keys(alloc);
    const top = names
      .filter((n) => !n.includes("/")) // top-level allocators only
      .map((n) => [n, effective(n) / 1048576])
      .sort((a, b) => b[1] - a[1]);
    // the second level of the big ones — v8 isolates (main + workers), partition_alloc's array buffers, malloc's children
    const second = names
      .filter((n) => n.split("/").length === 2 || (n.startsWith("v8/") && n.split("/").length <= 3))
      .map((n) => [n, effective(n) / 1048576])
      .filter(([, mb]) => mb >= 4)
      .sort((a, b) => b[1] - a[1]);
    const totals = e.args.dumps.process_totals || {};
    const rssMB = totals.resident_set_bytes ? parseInt(totals.resident_set_bytes, 16) / 1048576 : null;
    const pmfMB = totals.private_footprint_bytes ? parseInt(totals.private_footprint_bytes, 16) / 1048576 : null;
    return { pid: e.pid, rssMB, pmfMB, top, second };
  });
  // the page's renderer = the process with the largest v8 + blink_gc footprint
  const score = (p) => p.top.filter(([n]) => n === "v8" || n === "blink_gc" || n === "partition_alloc").reduce((a, [, mb]) => a + mb, 0);
  perProcess.sort((a, b) => score(b) - score(a));
  const page = perProcess[0];
  console.log(`\n=== ${label} — renderer pid ${page?.pid} · RSS ${page?.rssMB?.toFixed(0)} MB · private footprint ${page?.pmfMB?.toFixed(0)} MB · success ${r.success} ===`);
  if (page) {
    console.log("  top-level allocators (effective MB):");
    for (const [n, mb] of page.top.slice(0, TOP)) if (mb >= 0.5) console.log(`    ${mb.toFixed(1).padStart(8)}  ${n}`);
    console.log("  second level ≥ 4 MB:");
    for (const [n, mb] of page.second.slice(0, TOP)) console.log(`    ${mb.toFixed(1).padStart(8)}  ${n}`);
  }
  return { label, page, others: perProcess.slice(1).map((p) => ({ pid: p.pid, rssMB: p.rssMB, pmfMB: p.pmfMB, top: p.top.slice(0, 6) })) };
};

await s.bootUrl(URL);
await s.waitFor(`!!window.__globe && !!window.__cameraStore && !!window.__bestSpotStore && !!window.__renderer`, 90_000, "globe up");
await sleep(3000);
// --canvas-zero: the EXPERIMENT — wrap every overlay's composite-cache `disposeItem` so a disposed
// composite `CanvasTexture` also drops its <canvas> backing store NOW (`width = height = 0`, the
// iOS canvas-memory idiom) instead of at the element's GC. Read-only otherwise; a scratch seam.
if (args.includes("--canvas-zero")) {
  const r = await J(`(() => {
    const g = window.__globe; const plug = (g.ground.plugins || []).find((p) => p.overlayInfo instanceof Map);
    if (!plug) return { ok: false, why: "no overlay plugin" };
    let wrapped = 0; window.__canvasZeroed = 0; window.__canvasZeroedBytes = 0;
    const wrap = (overlay) => {
      const rs = overlay.regionImageSource; if (!rs || rs.__zeroWrapped) return;
      const orig = rs.disposeItem.bind(rs);
      rs.disposeItem = (target, keys) => { orig(target, keys); const c = target && target.image; if (c && typeof HTMLCanvasElement !== "undefined" && c instanceof HTMLCanvasElement && c.width > 0) { window.__canvasZeroedBytes += c.width * c.height * 4; c.width = 0; c.height = 0; window.__canvasZeroed++; } };
      rs.__zeroWrapped = true; wrapped++;
    };
    plug.overlayInfo.forEach((_, overlay) => wrap(overlay));
    return { ok: true, wrapped };
  })()`);
  console.log(`canvas-zero wrapper: ${JSON.stringify(r)}`);
}
const BUSY = `(() => { const f = window.__debugFeed; if (!f) return 999; const t = f.read("tiles"); if (!t) return 999; let b = 0; for (const p of ["bld","gnd","enr"]) for (const k of ["dlLen","parseLen","queued","downloading","parsing"]) b += Number(t[p + "." + k] || 0); return b; })()`;
const settle = async (maxS) => { const t0 = Date.now(); let quiet = null; while (Date.now() - t0 < maxS * 1000) { const b = await J(BUSY).catch(() => 999); if (b === 0) { quiet ??= Date.now(); if (Date.now() - quiet >= 1500) return; } else quiet = null; await sleep(500); } };
const LOOK = `(() => { const c = document.querySelector("canvas"); if (!c) return false; const r = c.getBoundingClientRect(); const x0 = r.left + r.width * 0.5, y0 = r.top + r.height * 0.6;
  const ev = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons }));
  ev("pointerdown", x0, y0, 1); for (let i = 1; i <= 12; i++) ev("pointermove", x0 + i * 9, y0 + Math.sin(i / 3) * 4, 1); ev("pointerup", x0 + 108, y0, 0); return true; })()`;
const CACHES = `(() => { const f = window.__debugFeed; const t = f ? f.read("tiles") : null; const r = window.__renderer.info.memory; return t ? { bld: t["bld.lruItems"], gnd: t["gnd.lruItems"], enr: t["enr.lruItems"], bldMB: t["bld.lruMB"], gndMB: t["gnd.lruMB"], enrMB: t["enr.lruMB"], geometries: r.geometries, textures: r.textures } : null; })()`;
const caches = async (label) => { const c = await J(CACHES); if (args.includes("--canvas-zero")) { const z = await J(`({ n: window.__canvasZeroed, mb: (window.__canvasZeroedBytes || 0) / 1048576 })`); console.log(`  canvases zeroed so far: ${z.n} (${z.mb.toFixed(1)} MB of backing store)`); } console.log(`  caches @ ${label}: bld ${c?.bld}/${Number(c?.bldMB ?? 0).toFixed(1)} MB · gnd ${c?.gnd}/${Number(c?.gndMB ?? 0).toFixed(1)} MB · enr ${c?.enr}/${Number(c?.enrMB ?? 0).toFixed(1)} MB · geometries ${c?.geometries} textures ${c?.textures}`); return c; };

const out = [];
await settle(20);
out.push({ ...(await dump("boot 2D map, rested")), caches: await caches("boot") });
for (let i = 0; i < CYCLES; i++) {
  const spot = SPOTS[i % SPOTS.length];
  await s.evalJs(`(() => { const c = window.__cameraStore.getState(); c.setTempPin({ latDeg: ${spot.lat}, lonDeg: ${spot.lon} }); c.setTempFpv(true); return true; })()`);
  await s.waitFor(`!!(window.__cameraStore.getState().fpvHud)`, 60_000, "FPV in");
  await settle(SETTLE_S);
  for (let k = 0; k < 3; k++) { await s.evalJs(LOOK); await sleep(800); }
  await settle(4);
  if (i === 0) out.push({ ...(await dump(`c${i} ${spot.id} FPV, looked around`)), caches: await caches(`c${i} fpv`) });
  await s.evalJs(`window.__cameraStore.getState().setTempFpv(false), true`);
  await s.waitFor(`!(window.__cameraStore.getState().fpvHud)`, 30_000, "FPV out");
  await settle(SETTLE_S);
  await sleep(4000); // past MOBILE2D.releaseDetachedGraceMs — the drain has run
  out.push({ ...(await dump(`c${i} ${spot.id} fpv-out, rested + drained`)), caches: await caches(`c${i} fpv-out`) });
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
writeFileSync(`verify-shots/perf/memory-dump-${stamp}.json`, JSON.stringify(out, null, 2));
console.log(`\nwrote verify-shots/perf/memory-dump-${stamp}.json`);
s.close();
await finishVerify(0);
