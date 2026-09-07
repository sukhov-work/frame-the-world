#!/usr/bin/env node
/**
 * T83 — the MEMORY FOOTPRINT of a page over time, on the desktop Chrome, in the shape the iPhone
 * died in (2026-09-07b).
 *
 * The Device Farm syslogs classified T83: `com.apple.WebKit.WebContent … exceeded mem limit:
 * ActiveHard 2048 MB (fatal) … killed by jetsam reason per-process-limit` — four sessions, the
 * same line, the process 70–198 s old, always on the SECOND `#f=` load in one WebContent process.
 * iOS gives no `performance.memory`, so the curve that explains the 2 GB has to be read here: this
 * probe boots the pose(s) in ONE tab (one renderer process, as Safari kept one WebContent for
 * every same-origin navigation), and every `--every` seconds writes a row of
 *
 *   footprint    the renderer process's physical footprint (`/usr/bin/footprint <pid>`, the same
 *                metric jetsam charges — IOSurfaces included) and the GPU process's
 *   heap         V8 `Runtime.getHeapUsage` — used / total, and `backingStorageSize` (ArrayBuffer
 *                backing stores: tile geometry, decoded RAW, the WASM heaps)
 *   scene        an in-page walk of the three renderers' LRU caches (`lruCache.itemList` →
 *                `tile.cached.{geometry,textures}`) and the visible scene graph — geometry bytes
 *                and the DECODED-IMAGE bytes three keeps alive in `texture.image` (w × h × 4 per
 *                ImageBitmap, the CPU-side copy WebKit charges to WebContent)
 *   gl           `renderer.info.memory` (geometries / textures alive on the GL side)
 *   tiles        the DBG feed's LRU MB + inCache
 *
 *   node scripts/probe-memory-footprint.mjs [PORT] [--sequence fpv,orbit,city,everest,m,fpv]
 *        [--dwell 30] [--soak 180] [--every 5] [--phone] [--label t83]
 *
 * `--sequence` navigates the poses in order in the same tab, dwelling `--dwell` s on each (the
 * Device Farm run's shape); a single pose with `--soak N` holds it N seconds (the "does one page
 * grow to 2 GB on its own?" question). `--phone` emulates the 17 Pro's profile (CSS 402×714 @ 3,
 * touch → coarse pointer → lean, 4 cores → tier mid). Output: `verify-shots/perf/mem-<label>-<stamp>.{csv,json}`
 * and the table on stdout. `probe-` prefix: a research instrument — it asserts nothing.
 *
 * Preconditions: `wix dev` :4321, the house Chrome :9333 (or the owner's :9222), macOS
 * (`footprint`). Never alongside a timed harness — the footprint calls take ~0.5 s each.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9333";
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const SEQ = opt("--sequence", "fpv").split(",").filter(Boolean);
const DWELL_S = Number(opt("--dwell", "30"));
const SOAK_S = Number(opt("--soak", "0"));
const EVERY_S = Number(opt("--every", "5"));
const PHONE = args.includes("--phone");
// --look: the Device Farm soak's synthetic look-around (one 108 px touch drag every 4 s) — the
// phone's single-page kill (2026-09-07c, page age 129 s) happened UNDER this streaming, and a
// static page stays flat; the probe must stream to reproduce the shape.
const LOOK = args.includes("--look");
const LABEL = opt("--label", "t83");
const DEV = process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321";
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
for (const p of SEQ) if (!POSES[p]) throw new Error(`unknown pose ${p}`);

const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const BLANK = !args.includes("--no-blank"); // an about:blank hop between poses = a REAL navigation per pose (the farm tool's shape; a hash-only navigate never reloads)
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
const bfcacheEvents = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method === "Page.backForwardCacheNotUsed") {
    // Chrome tells us when the document it just LEFT could not be kept in the back/forward cache
    // (and why). No event on a real navigation = the previous document IS cached — alive, with its
    // heap, ArrayBuffers and GL context — the residue model for T83's one-process kill.
    const reasons = (msg.params.notRestoredExplanations ?? []).map((e) => e.reason);
    bfcacheEvents.push({ at: Math.round((Date.now() - T0) / 1000), reasons });
    console.log(`      bfcache NOT used for the previous document: ${reasons.join(", ") || "(no reason given)"}`);
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

// ── the process side: footprint of every renderer + the GPU process (which one is ours: the
//    big one; all are printed so a wrong pick is visible) ─────────────────────────────────────
const ps = () => {
  const out = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  const rows = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, cmd] = m;
    if (!/Google Chrome Helper/.test(cmd)) continue;
    if (!new RegExp(`--remote-debugging-port=${PORT}\\b|--user-data-dir=/tmp/ftw-cdp`).test(cmd) && PORT === "9333") continue;
    const type = (cmd.match(/--type=([a-z-]+)/) ?? [])[1] ?? "?";
    rows.push({ pid: Number(pid), type });
  }
  return rows;
};
const footprintMB = (pid) => {
  try {
    const out = execFileSync("/usr/bin/footprint", [String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = out.match(/Footprint:\s+([\d.]+)\s*(KB|MB|GB)/);
    if (!m) return null;
    const v = Number(m[1]);
    return m[2] === "GB" ? v * 1024 : m[2] === "KB" ? v / 1024 : v;
  } catch {
    return null;
  }
};
const processes = () => {
  const rows = ps();
  const renderers = rows.filter((r) => r.type === "renderer").map((r) => ({ ...r, mb: footprintMB(r.pid) })).filter((r) => r.mb != null);
  const gpu = rows.find((r) => r.type === "gpu-process");
  renderers.sort((a, b) => b.mb - a.mb);
  return { renderer: renderers[0] ?? null, renderers: renderers.map((r) => `${r.pid}:${r.mb.toFixed(0)}`).join(" "), gpuMB: gpu ? footprintMB(gpu.pid) : null };
};

// ── the page side ────────────────────────────────────────────────────────────────────────────
const SCENE_WALK = `(() => {
  const G = window.__globe, R = window.__renderer;
  const geoms = new Set(), texs = new Set();
  let geoBytes = 0, texPix = 0, texDataBytes = 0, meshes = 0, lruTiles = 0, lruScenes = 0;
  const one = (i) => { if (!i) return 0; const w = i.width ?? i.videoWidth ?? 0, h = i.height ?? i.videoHeight ?? 0; return w * h; };
  const visitTex = (t) => { if (!t || !t.isTexture || texs.has(t)) return; texs.add(t); const im = t.image; texPix += Array.isArray(im) ? im.reduce((a, i) => a + one(i), 0) : one(im); if (im && im.data && im.data.byteLength) texDataBytes += im.data.byteLength; };
  const visitMat = (m) => { if (!m) return; for (const k in m) { const v = m[k]; if (v && v.isTexture) visitTex(v); } if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) visitTex(v); } };
  const visitGeo = (g) => { if (!g || geoms.has(g)) return; geoms.add(g); for (const k in g.attributes) geoBytes += (g.attributes[k].array && g.attributes[k].array.byteLength) || 0; if (g.index) geoBytes += (g.index.array && g.index.array.byteLength) || 0; };
  const walk = (root) => root.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) { meshes++; visitGeo(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(visitMat); } });
  // the LRU caches first (tiles cached but NOT in the scene graph are exactly what a scene walk misses)
  for (const r of [G.tiles, G.ground, G.enriched]) {
    if (!r || !r.lruCache) continue;
    const list = r.lruCache.itemList || [];
    lruTiles += list.length;
    for (const tile of list) { const c = tile && tile.cached; if (!c) continue; if (c.scene) { lruScenes++; walk(c.scene); } (c.textures || []).forEach(visitTex); (c.geometry || []).forEach(visitGeo); (c.materials || []).forEach(visitMat); }
  }
  // then the scene graph from the root (the base earth, sky, models, HUD sprites)
  const roots = new Set();
  for (const r of [G.tiles, G.ground, G.enriched]) if (r && r.group) { let o = r.group; while (o.parent) o = o.parent; roots.add(o); }
  for (const root of roots) walk(root);
  const info = R.info.memory;
  const pm = performance.memory ? { used: performance.memory.usedJSHeapSize / 1048576, total: performance.memory.totalJSHeapSize / 1048576 } : null;
  const F = window.__debugFeed; const T = F ? (F.setActive(true), F.read("tiles")) : null;
  const mb = (k) => (T && T[k] != null ? +T[k].toFixed(1) : null);
  return { meshes, geometries: geoms.size, geoMB: +(geoBytes / 1048576).toFixed(1), textures: texs.size, texMP: +(texPix / 1e6).toFixed(1), texImageMB: +((texPix * 4 + texDataBytes) / 1048576).toFixed(1), glGeometries: info.geometries, glTextures: info.textures, lruTiles, lruScenes, pmUsedMB: pm && +pm.used.toFixed(0), lruBld: mb("bld.lruMB"), lruGnd: mb("gnd.lruMB"), lruEnr: mb("enr.lruMB"), alt: Math.round(G.alt()) };
})()`;

const rows = [];
let phase = "";
const sample = async (note = "") => {
  const [page, heap, proc] = await Promise.all([evalJs(SCENE_WALK).catch((e) => ({ error: String(e).slice(0, 120) })), send("Runtime.getHeapUsage").catch(() => null), Promise.resolve(processes())]);
  const row = {
    s: Math.round((Date.now() - T0) / 1000),
    phase,
    note,
    footprintMB: proc.renderer ? +proc.renderer.mb.toFixed(0) : null,
    rendererPid: proc.renderer?.pid ?? null,
    renderers: proc.renderers,
    gpuMB: proc.gpuMB != null ? +proc.gpuMB.toFixed(0) : null,
    heapUsedMB: heap ? +(heap.usedSize / 1048576).toFixed(0) : null,
    heapTotalMB: heap ? +(heap.totalSize / 1048576).toFixed(0) : null,
    backingMB: heap && heap.backingStorageSize != null ? +(heap.backingStorageSize / 1048576).toFixed(0) : null,
    embedderMB: heap && heap.embedderHeapUsedSize != null ? +(heap.embedderHeapUsedSize / 1048576).toFixed(0) : null,
    ...page,
  };
  rows.push(row);
  console.log(
    `${String(row.s).padStart(4)} s  ${phase.padEnd(8)} footprint ${String(row.footprintMB ?? "-").padStart(5)} MB  gpu ${String(row.gpuMB ?? "-").padStart(5)}  heap ${String(row.heapUsedMB ?? "-").padStart(4)}/${String(row.heapTotalMB ?? "-").padStart(4)}  backing ${String(row.backingMB ?? "-").padStart(4)}  ` +
      `tex ${String(row.textures ?? "-").padStart(4)} = ${String(row.texImageMB ?? "-").padStart(5)} MB img  geo ${String(row.geometries ?? "-").padStart(4)} = ${String(row.geoMB ?? "-").padStart(5)} MB  gl ${row.glGeometries ?? "-"}/${row.glTextures ?? "-"}  lru ${row.lruTiles ?? "-"} tiles (${row.lruBld ?? "-"}/${row.lruGnd ?? "-"}/${row.lruEnr ?? "-"} MB)  ${note}${row.error ? ` ERR ${row.error}` : ""}`,
  );
  return row;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => { try { const k = "ftw:view-prefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.ultraQuality = false; o.debugHud = false; localStorage.setItem(k, JSON.stringify(o)); } catch {}
    ${PHONE ? `Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 4, configurable: true });` : ""} })()`,
});
if (PHONE) {
  await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
} else {
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 2, mobile: false });
}
console.log(`MEMORY FOOTPRINT  port ${PORT}  label ${LABEL}  sequence ${SEQ.join(" → ")}  dwell ${DWELL_S} s  soak ${SOAK_S} s  every ${EVERY_S} s  ${PHONE ? "PHONE profile (402×714 @3, touch, 4 cores)" : "desktop 1600×950 @2"}  ${BLANK ? "about:blank hop between poses" : "direct navigations"}`);

const LOOK_JS = `(() => { const c = document.querySelector("canvas"); if (!c) return false; const r = c.getBoundingClientRect(); const x0 = r.left + r.width * 0.5, y0 = r.top + r.height * 0.6;
  const ev = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons, pressure: buttons ? 0.5 : 0 }));
  ev("pointerdown", x0, y0, 1); for (let i = 1; i <= 12; i++) ev("pointermove", x0 + i * 9, y0 + Math.sin(i / 3) * 4, 1); ev("pointerup", x0 + 108, y0, 0); return true; })()`;
const BUSY = `(() => { const u = window.__globe.u5(); const q = (r) => r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0; return q(u.buildings) + q(u.ground) + q(u.enriched); })()`;
for (let i = 0; i < SEQ.length; i++) {
  const name = SEQ[i];
  const pose = POSES[name];
  phase = `${name}${SEQ.slice(0, i).filter((p) => p === name).length ? "#" + (SEQ.slice(0, i).filter((p) => p === name).length + 1) : ""}`;
  const tNav = Date.now();
  if (BLANK && i > 0) {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(400);
  }
  await send("Page.navigate", { url: pose.url });
  await waitFor(`!!(window.__globe && window.__globe.camera && window.__renderer && window.__globe.u5)`);
  await evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`);
  await sample(`booted ${((Date.now() - tNav) / 1000).toFixed(1)} s after navigate`);
  await waitFor(`!window.__globe.flight || !window.__globe.flight.active()`, 60_000).catch(() => {});
  if (pose.kind === "fpv") await waitFor(`!!window.__globe.fpv && window.__globe.fpv().active`, 60_000).catch(() => {});
  const hold = (SOAK_S && SEQ.length === 1 ? SOAK_S : DWELL_S) * 1000;
  const tHold = Date.now();
  let settledNoted = false;
  while (Date.now() - tHold < hold) {
    // --look: the farm tool's LOOK verbatim (pointerdown, 12 moves of 9 px, pointerup), once per
    // sample interval — run with `--every 4` to match the phone's cadence.
    if (LOOK) await evalJs(LOOK_JS).catch(() => null);
    await sleep(EVERY_S * 1000);
    const busy = await evalJs(BUSY).catch(() => null);
    let note = busy === 0 ? (settledNoted ? "" : "settled (queues empty)") : `busy ${busy}`;
    if (busy === 0) settledNoted = true;
    await sample(note);
  }
}
phase = "end";
// a forced GC at the end: what is GARBAGE (reclaimable) vs what is HELD
await send("HeapProfiler.enable").catch(() => {});
await send("HeapProfiler.collectGarbage").catch(() => {});
await sleep(1500);
await sample("after HeapProfiler.collectGarbage");

const csvCols = ["s", "phase", "note", "footprintMB", "gpuMB", "heapUsedMB", "heapTotalMB", "backingMB", "embedderMB", "textures", "texMP", "texImageMB", "geometries", "geoMB", "glGeometries", "glTextures", "lruTiles", "lruScenes", "meshes", "lruBld", "lruGnd", "lruEnr", "alt", "rendererPid", "renderers"];
writeFileSync(`${OUT_DIR}/mem-${LABEL}-${STAMP}.csv`, [csvCols.join(","), ...rows.map((r) => csvCols.map((c) => JSON.stringify(r[c] ?? "")).join(","))].join("\n"));
writeFileSync(`${OUT_DIR}/mem-${LABEL}-${STAMP}.json`, JSON.stringify({ label: LABEL, stamp: STAMP, sequence: SEQ, dwellS: DWELL_S, soakS: SOAK_S, phone: PHONE, blank: BLANK, bfcacheEvents, rows }, null, 2));
const peak = rows.reduce((a, r) => (r.footprintMB > (a?.footprintMB ?? -1) ? r : a), null);
console.log(`\npeak renderer footprint ${peak?.footprintMB} MB at ${peak?.s} s (${peak?.phase}) · peak texture image bytes ${Math.max(...rows.map((r) => r.texImageMB ?? 0))} MB · peak geometry ${Math.max(...rows.map((r) => r.geoMB ?? 0))} MB · peak backing ${Math.max(...rows.map((r) => r.backingMB ?? 0))} MB`);
console.log(`wrote ${OUT_DIR}/mem-${LABEL}-${STAMP}.csv`);
await finishVerify(0);
