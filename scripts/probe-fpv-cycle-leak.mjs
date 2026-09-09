#!/usr/bin/env node
/**
 * T123 / T130 (2026-09-09) — WHICH geometries grow across FPV in/out + heatmap cycles on the /m shell?
 *
 * The Device Farm stress leg (`tools/devicefarm/ios-baseline.mjs --legs stress`) killed the iPhone
 * 17 Pro's page in cycle 4 (~240 s) with the tile LRUs FLAT under their caps and
 * `renderer.info.memory.geometries` climbing 201 → 795 (`fpv-out` rows 395 → 581 → 620 → 795) and
 * textures 38 → 87. A count says GROWTH; it does not say WHAT. This probe runs the SAME cycle on the
 * desktop twin (mobile emulation, the `/m` shell) and, after every stage, takes a CENSUS of the
 * scene graph — distinct geometries by owner (object name / type / parent chain) — beside
 * `renderer.info.memory`: the gap between "geometries in the scene" and "geometries the renderer
 * holds" is the detached-but-undisposed set (the classic leak), and the per-owner deltas across
 * cycles name the module. Read-only; no seam, no src change.
 *
 *   node scripts/probe-fpv-cycle-leak.mjs [9333] [--cycles 4] [--settle 6]
 *
 * 2026-09-10 (T123 lever (a)): every row also carries the two detached caches' item counts + MB
 * (`tiles.bld/enr.lruItems`) and the drain receipt (`buildings.detachedRelease*`) — the A/B for the
 * lever: the `fpv-out` / `heatmap-off` rows must show the caches at 0 items and the renderer's
 * geometries back near the boot count.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openSession, sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9333";
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const CYCLES = Number(opt("--cycles", "4"));
const SETTLE_S = Number(opt("--settle", "6"));
const DEV = process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321";
const T_M = 1787313600000;
const URL = `${DEV}/m#p=48.4640,35.0460,220,0,0&t=${T_M}`;
const SPOTS = [
  { id: "eye", lat: 48.4647, lon: 35.0462 },
  { id: "west-sunset", lat: 48.464627, lon: 35.064907 },
  { id: "south", lat: 48.467806, lon: 35.071753 },
  { id: "altanka", lat: 48.463651, lon: 35.039833 },
];
mkdirSync("verify-shots/perf", { recursive: true });

let target;
try { target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json()); }
catch { target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json()); }
trackTarget(PORT, target.id);
const s = await openSession(target);
await s.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
await s.bootUrl(URL);
await s.waitFor(`!!window.__globe && !!window.__cameraStore && !!window.__bestSpotStore && !!window.__renderer`, 90_000, "globe up");
await sleep(3000);

const CENSUS = `(() => {
  const r = window.__renderer; const info = r.info;
  const comp = window.__composer; const scene = (comp && comp.passes && comp.passes.find((p) => p.scene) || {}).scene || window.__globe.camera.parent;
  const owners = new Map(); const seen = new Set(); let attached = 0;
  const chain = (o) => { const parts = []; let p = o; let n = 0; while (p && n < 4) { parts.push(p.name || p.type); p = p.parent; n++; } return parts.join(" < "); };
  if (scene) scene.traverse((o) => { const g = o.geometry; if (!g) return; if (seen.has(g.uuid)) return; seen.add(g.uuid); attached++; const k = chain(o); owners.set(k, (owners.get(k) || 0) + 1); });
  const top = [...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  // T123 lever (a): the caches' item counts + the drain receipt (both read from the DBG feed; null when absent)
  const feed = window.__debugFeed; const tl = feed ? feed.read("tiles") : null; const bd = feed ? feed.read("buildings") : null;
  const lru = tl ? { bld: tl["bld.lruItems"], enr: tl["enr.lruItems"], bldMB: tl["bld.lruMB"], enrMB: tl["enr.lruMB"] } : null;
  const rel = bd ? { n: bd.detachedReleases, items: bd.detachedReleasedItems, mb: bd.detachedReleasedMB, left: bd.detachedReleaseLeft, maxMs: bd.detachedReleaseMaxMs } : null;
  return { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : null, attached, detached: info.memory.geometries - attached, top, hasScene: !!scene, lru, rel };
})()`;
const BUSY = `(() => { const f = window.__debugFeed; if (!f) return 999; const t = f.read("tiles"); if (!t) return 999; let b = 0; for (const p of ["bld","gnd","enr"]) for (const k of ["dlLen","parseLen","queued","downloading","parsing"]) b += Number(t[p + "." + k] || 0); return b; })()`;
const settle = async (maxS) => { const t0 = Date.now(); let quiet = null; while (Date.now() - t0 < maxS * 1000) { const b = await J(BUSY).catch(() => 999); if (b === 0) { quiet ??= Date.now(); if (Date.now() - quiet >= 1500) return; } else quiet = null; await sleep(500); } };
const LOOK = `(() => { const c = document.querySelector("canvas"); if (!c) return false; const r = c.getBoundingClientRect(); const x0 = r.left + r.width * 0.5, y0 = r.top + r.height * 0.6;
  const ev = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons }));
  ev("pointerdown", x0, y0, 1); for (let i = 1; i <= 12; i++) ev("pointermove", x0 + i * 9, y0 + Math.sin(i / 3) * 4, 1); ev("pointerup", x0 + 108, y0, 0); return true; })()`;
const rows = [];
let prevTop = new Map();
// 2026-09-10: the PROCESS read beside the census — what the byte-accounted caches do not count.
// The main isolate's heap (CDP) + the RSS of every renderer process of the probe's Chrome (its only
// page is this one; dedicated workers — the BEST SPOT solver — live inside the renderer, so RSS
// carries them). RSS is a proxy: Chrome's GPU process holds the textures, WebKit's WebContent does not.
import { execSync } from "node:child_process";
const chromePid = (() => { try { const v = execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null | head -1`).toString().trim(); return v ? Number(v) : null; } catch { return null; } })();
const rendererRssMB = () => {
  if (!chromePid) return null;
  try {
    const out = execSync(`ps -axo pid=,ppid=,rss=,command= | grep -- "--type=renderer" | grep -v grep`).toString().trim().split("\n");
    let sum = 0, n = 0, max = 0;
    for (const line of out) { const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); if (!m) continue; if (Number(m[2]) !== chromePid) continue; const kb = Number(m[3]); sum += kb; n++; if (kb > max) max = kb; }
    return { mb: sum / 1024, maxMb: max / 1024, procs: n };
  } catch { return null; }
};
const processRead = async () => {
  const heap = await s.send("Runtime.getHeapUsage").catch(() => null);
  const dom = await s.send("Memory.getDOMCounters").catch(() => null);
  const pm = await J(`(() => { const m = performance.memory; return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize } : null; })()`).catch(() => null);
  return { heapUsedMB: heap ? heap.usedSize / 1048576 : null, heapTotalMB: heap ? heap.totalSize / 1048576 : null, jsHeapMB: pm ? pm.used / 1048576 : null, nodes: dom?.nodes ?? null, jsListeners: dom?.jsEventListeners ?? null, rss: rendererRssMB() };
};
const stage = async (cyc, spot, name) => {
  const c = await J(CENSUS);
  c.proc = await processRead();
  const topMap = new Map(c.top);
  const deltas = [...topMap.entries()].map(([k, v]) => [k, v - (prevTop.get(k) || 0)]).filter(([, d]) => d !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
  prevTop = topMap;
  rows.push({ cyc, spot, name, ...c });
  const lruS = c.lru ? ` lru bld ${c.lru.bld}/${Number(c.lru.bldMB ?? 0).toFixed(1)}MB enr ${c.lru.enr}/${Number(c.lru.enrMB ?? 0).toFixed(1)}MB` : "";
  const relS = c.rel && c.rel.n != null ? ` · drains ${c.rel.n} (${c.rel.items} items, ${Number(c.rel.mb ?? 0).toFixed(1)} MB, left ${c.rel.left}, max ${Number(c.rel.maxMs ?? 0).toFixed(1)} ms)` : "";
  const pr = c.proc; const procS = pr ? ` · heap ${pr.heapUsedMB?.toFixed(0)}/${pr.heapTotalMB?.toFixed(0)} MB nodes ${pr.nodes} rss max ${pr.rss ? `${pr.rss.maxMb.toFixed(0)} MB (Σ ${pr.rss.mb.toFixed(0)}/${pr.rss.procs}p)` : "?"}` : "";
  console.log(`c${cyc} ${spot} ${name.padEnd(11)} geo ${String(c.geometries).padStart(4)} (attached ${c.attached}, detached ${c.detached}) tex ${c.textures} prog ${c.programs}${lruS}${relS}${procS} · Δ ${deltas.map(([k, d]) => `${d > 0 ? "+" : ""}${d} ${k}`).join(" · ") || "—"}`);
};
await settle(20);
await stage(-1, "boot", "map");
for (let i = 0; i < CYCLES; i++) {
  const spot = SPOTS[i % SPOTS.length];
  await s.evalJs(`(() => { const c = window.__cameraStore.getState(); c.setTempPin({ latDeg: ${spot.lat}, lonDeg: ${spot.lon} }); c.setTempFpv(true); return true; })()`);
  await s.waitFor(`!!(window.__cameraStore.getState().fpvHud)`, 60_000, "FPV in");
  await settle(SETTLE_S);
  await stage(i, spot.id, "fpv-in");
  for (let k = 0; k < 3; k++) { await s.evalJs(LOOK); await sleep(800); }
  await settle(4);
  await stage(i, spot.id, "look");
  await s.evalJs(`window.__cameraStore.getState().setTempFpv(false), true`);
  await s.waitFor(`!(window.__cameraStore.getState().fpvHud)`, 30_000, "FPV out");
  await settle(SETTLE_S);
  await stage(i, spot.id, "fpv-out");
  await s.evalJs(`(() => { const c = window.__cameraStore.getState(); c.setTempPin({ latDeg: ${spot.lat}, lonDeg: ${spot.lon} }); const b = window.__bestSpotStore.getState(); b.setOpen(true); b.setHeatmapOn(true); return true; })()`);
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) { const r = await J(`(() => { const b = window.__bestSpotStore.getState(); return { rung: b.ladderRung, solving: b.solving, topK: b.topK.length, cell: b.gridCellM, cellReq: b.cellM }; })()`); if (r.rung >= 3 && r.cell <= r.cellReq && !r.solving && r.topK > 0) break; await sleep(2000); }
  await stage(i, spot.id, "heatmap");
  await s.evalJs(`(() => { const b = window.__bestSpotStore.getState(); b.setHeatmapOn(false); b.setOpen(false); return true; })()`);
  await sleep(3000); // the farm leg's rest (ios-baseline `heatmap-off`) — past MOBILE2D.releaseDetachedGraceMs
  await stage(i, spot.id, "heatmap-off");
}
// the final census in full
const full = await J(`(() => {
  const r = window.__renderer; const comp = window.__composer; const scene = (comp && comp.passes && comp.passes.find((p) => p.scene) || {}).scene || window.__globe.camera.parent;
  const owners = new Map(); const seen = new Set();
  const chain = (o) => { const parts = []; let p = o; let n = 0; while (p && n < 5) { parts.push(p.name || p.type); p = p.parent; n++; } return parts.join(" < "); };
  if (scene) scene.traverse((o) => { const g = o.geometry; if (!g || seen.has(g.uuid)) return; seen.add(g.uuid); const k = chain(o); owners.set(k, (owners.get(k) || 0) + 1); });
  return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, owners: [...owners.entries()].sort((a, b) => b[1] - a[1]) };
})()`);
console.log("\nfinal owners (attached geometries by parent chain):");
for (const [k, v] of full.owners.slice(0, 25)) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`\nrenderer geometries ${full.geometries} · attached ${full.owners.reduce((a, [, v]) => a + v, 0)} · detached-undisposed ${full.geometries - full.owners.reduce((a, [, v]) => a + v, 0)} · textures ${full.textures}`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
writeFileSync(`verify-shots/perf/fpv-cycle-leak-${stamp}.json`, JSON.stringify({ rows, full }, null, 2));
console.log(`wrote verify-shots/perf/fpv-cycle-leak-${stamp}.json`);
s.close();
await finishVerify(0);
