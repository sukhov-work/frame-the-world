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
  return { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : null, attached, detached: info.memory.geometries - attached, top, hasScene: !!scene };
})()`;
const BUSY = `(() => { const f = window.__debugFeed; if (!f) return 999; const t = f.read("tiles"); if (!t) return 999; let b = 0; for (const p of ["bld","gnd","enr"]) for (const k of ["dlLen","parseLen","queued","downloading","parsing"]) b += Number(t[p + "." + k] || 0); return b; })()`;
const settle = async (maxS) => { const t0 = Date.now(); let quiet = null; while (Date.now() - t0 < maxS * 1000) { const b = await J(BUSY).catch(() => 999); if (b === 0) { quiet ??= Date.now(); if (Date.now() - quiet >= 1500) return; } else quiet = null; await sleep(500); } };
const LOOK = `(() => { const c = document.querySelector("canvas"); if (!c) return false; const r = c.getBoundingClientRect(); const x0 = r.left + r.width * 0.5, y0 = r.top + r.height * 0.6;
  const ev = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons }));
  ev("pointerdown", x0, y0, 1); for (let i = 1; i <= 12; i++) ev("pointermove", x0 + i * 9, y0 + Math.sin(i / 3) * 4, 1); ev("pointerup", x0 + 108, y0, 0); return true; })()`;
const rows = [];
let prevTop = new Map();
const stage = async (cyc, spot, name) => {
  const c = await J(CENSUS);
  const topMap = new Map(c.top);
  const deltas = [...topMap.entries()].map(([k, v]) => [k, v - (prevTop.get(k) || 0)]).filter(([, d]) => d !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
  prevTop = topMap;
  rows.push({ cyc, spot, name, ...c });
  console.log(`c${cyc} ${spot} ${name.padEnd(11)} geo ${String(c.geometries).padStart(4)} (attached ${c.attached}, detached ${c.detached}) tex ${c.textures} prog ${c.programs} · Δ ${deltas.map(([k, d]) => `${d > 0 ? "+" : ""}${d} ${k}`).join(" · ") || "—"}`);
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
  await sleep(2500);
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
