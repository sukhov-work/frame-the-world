#!/usr/bin/env node
/**
 * T77 MEASURE — a main-thread CPU PROFILE of a settled pose, or of the DESCENT leg (2026-09-05;
 * the leg + the bucket ledger 2026-09-07b).
 *
 * The baseline harness read `frame.cpu` (the orchestrator's `tilesHandle.update()` bracket) at
 * 38 ms per frame on a STATIC orbit pose — a frame budget spent before a single draw call. A
 * number that size needs an attribution, not a guess: this probe attaches V8's sampling profiler
 * (CDP `Profiler`, 250 µs interval) to a settled pose for a few seconds and prints the self-time
 * ledger by FUNCTION and by FILE, and writes the raw `.cpuprofile` for DevTools (Performance →
 * load profile). Read-only: no seam, no behaviour, no src/ change.
 *
 *   node scripts/probe-cpu-profile.mjs [PORT] [--pose fpv|orbit|city|everest|m] [--seconds 6]
 *        [--ultra] [--top 30] [--device]
 *   node scripts/probe-cpu-profile.mjs [PORT] --leg descent [--device] [--top 30]
 *
 * `--leg descent` (T77 slice C, the measurement that decides lever 10 — MEASUREMENTS §20 showed
 * every descent hitch is a parse-phase frame with the orchestrator's own bracket at 5–11 ms, so
 * the time is OUTSIDE `update()` and this column set could not say whether it is the glTF PARSE
 * (worker-movable, lever 10) or the first-draw GPU UPLOAD / shader COMPILE (not)): boots the
 * catalogue's `dnipro-descent` start pose, settles, starts the profiler, drives the owner's
 * descent exactly as `verify-visual-sweep` does (`requestFly` → the arrival targets → quiet),
 * stops, and attributes every sample to a BUCKET by walking its stack leaf → root and taking the
 * first frame that names one:
 *
 *   parse         GLTFLoader / GLTFParser / B3DMLoader / DRACO / KTX2 / `parseTile` / JSON.parse /
 *                 image decode — the work a worker could take (lever 10)
 *   compile       `acquireProgram` → `WebGLProgram` → compileShader / linkProgram (plan lever 4,
 *                 `compileAsync`)
 *   upload        `uploadTexture` / `createBuffer` / `updateBuffer` — the first-draw GPU uploads
 *                 (upload PACING, a different lever)
 *   seats         `seatQuiet` / `enrichedBuildings` — the seat pass on landed tiles
 *   app           our own `src/` code not in the buckets above (the `load-model` handlers, the
 *                 material swap, the sky, the HUD) — sub-reported by FILE
 *   orchestrator  the tiles renderer's traversal / queues / LRU (the `frame.cpu` bracket)
 *   render        `WebGLRenderer.render` and the pass chain
 *   controls      the controls' raycast (T79's territory)
 *   gc · program · idle · other
 *
 * and prints the ledger over the WHOLE leg, over the parse-phase frames only, and over the
 * HITCH frames (dt > 33 ms) — the last is the number lever 10 is judged on. Frames come from an
 * in-page rAF recorder (the sweep's columns: dt, alt, dl/parse queues); the profiler's µs clock
 * is aligned to `performance.now()` by bracketing `Profiler.start`/`stop` with two page reads
 * each (both are `mach_absolute_time`-based in Chromium, so the offset is a constant; the two
 * estimates' disagreement is printed as the alignment error — a hitch is 33+ ms, the error ~2 ms).
 *
 * `--device`: a phone's Chrome over adb (the README §B recipe) — attaches to the phone's
 * `localhost:4321` tab instead of opening one, no emulation, the device's own tier.
 *
 * Preconditions as the baseline harness (`wix dev` :4321, the house Chrome :9333 or the owner's
 * headed :9222, Node ≥ 22). Never alongside another timed harness. `probe-` prefix: a research
 * instrument, not a gate — it asserts nothing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";
import { byId } from "./lib/poses.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9222";
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const POSE = opt("--pose", "orbit");
const LEG = opt("--leg", null);
const SECONDS = Number(opt("--seconds", "6"));
const ULTRA = args.includes("--ultra");
const DEVICE = args.includes("--device");
const TOP = Number(opt("--top", "30"));
const DEV = process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321"; // FTW_DEV_ORIGIN: a worktree dev server (2026-09-06j)
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = "verify-shots/perf";
mkdirSync(OUT_DIR, { recursive: true });
const T_FPV = 1787133600000;
const T_ULTRA = Date.UTC(2026, 7, 21, 9, 40);
const T_M = 1787313600000; // verify-qaslice-cab NOON_UTC (the perf harness's `/m` instant)
const POSES = {
  fpv: { url: `${DEV}/#f=48.4647,35.0462,1.7,25,8,60&t=${T_FPV}`, kind: "fpv" },
  orbit: { url: `${DEV}/#p=48.4647,35.0462,700,25,40&t=${T_FPV}`, kind: "orbit" },
  city: { url: `${DEV}/#p=48.464,35.046,900,74,300&t=${T_ULTRA}`, kind: "orbit" },
  everest: { url: `${DEV}/#p=27.87,86.83,11500,76,35&t=${T_ULTRA}`, kind: "orbit" },
  m: { url: `${DEV}/m#p=48.4640,35.0460,220,0,0&t=${T_M}`, kind: "m" },
};
let pose = POSES[POSE];
let descent = null;
if (LEG) {
  if (LEG !== "descent") throw new Error(`unknown leg ${LEG} (only "descent")`);
  descent = byId("dnipro-descent");
  if (!descent?.leg) throw new Error("catalogue has no dnipro-descent leg");
  pose = { url: `${DEV}${descent.path}${descent.hash}&t=${descent.t}`, kind: "orbit" };
}
if (!pose) throw new Error(`unknown pose ${POSE}`);
const LABEL = LEG ? `descent${DEVICE ? "-device" : ""}` : `${POSE}${ULTRA ? "-ultra" : ""}${DEVICE ? "-device" : ""}`;

const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
if (DEVICE) {
  // Android Chrome answers `PUT /json/new` with "Could not create new page" — drive the tab the
  // README recipe opened, never create or close tabs on the owner's phone (perf harness, 2026-09-06).
  const list = await http("/json/list");
  const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  target = pages.find((t) => /localhost:4321/.test(t.url)) ?? pages[0];
  if (!target) throw new Error("no page tab on the phone — open http://localhost:4321/ in Chrome first (tools/devicefarm/README.md §B)");
  console.log(`attached to the phone tab ${target.id} ${target.url}`);
} else {
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
  trackTarget(PORT, target.id);
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
if (!DEVICE) {
  if (pose.kind === "m") await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  else await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 2, mobile: false });
}
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
const settle = async (capMs = 30_000) => {
  const t0 = Date.now();
  let quiet = null;
  while (Date.now() - t0 < capMs) {
    if ((await evalJs(BUSY)) === 0) {
      quiet ??= Date.now();
      if (Date.now() - quiet > 2000) return true;
    } else quiet = null;
    await sleep(250);
  }
  return false;
};
await settle(LEG ? 60_000 : 30_000);
const before = await evalJs(`(() => { const f = window.__debugFeed; f.setActive(true); return true; })()`);
await sleep(1500);
const cpu0 = await evalJs(`(() => { const s = window.__debugFeed.series("frame.cpu"); const d = window.__debugFeed.series("frame.dt"); return { cpuP50: s && s.p50, dtP50: d && d.p50 }; })()`);
await evalJs(`window.__debugFeed.setActive(false), true`);
console.log(`${LEG ? "leg descent (start pose)" : `pose ${POSE}`} ultra ${ULTRA}${DEVICE ? " DEVICE" : ""}: settled — frame.cpu p50 ${cpu0.cpuP50?.toFixed(1)} ms, frame.dt p50 ${cpu0.dtP50?.toFixed(1)} ms (${before})`);

// ── the in-page rAF recorder (the sweep's descent columns, trimmed to what the ledger joins on) ──
const MARKS = 16;
const MARK_MS = 0.7;
const REC_START = `(() => {
  const g = window.__globe;
  const rec = { rows: [], stop: false, error: null };
  window.__cpuRec = rec;
  // FRAME MARKERS: each tick spins ${MARK_MS} ms inside a NAMED function (16 rotating names) so the
  // sampling profiler sees the frame boundary in ITS OWN clock — no alignment guess, a missed
  // marker shows as a skipped residue. The spin is excluded from the ledger (bucket "marker").
  const M = []; for (let i = 0; i < ${MARKS}; i++) M.push(new Function("return function __ftwMark" + i + "(t0) { while (performance.now() - t0 < ${MARK_MS}) {} }")());
  let i = 0;
  const tick = (ts) => {
    if (rec.stop) return;
    try {
      const n = performance.now();
      M[i % ${MARKS}](n);
      const u = g.u5();
      const c = window.__cameraStore ? window.__cameraStore.getState() : null;
      rec.rows.push({
        i: i++, n, // the tick's own performance.now() (the marker's start) and its index
        ts, // the rAF timestamp: performance.now()-based, the frame's start
        altM: Math.round(g.alt()),
        tiltDeg: c ? +c.tiltDeg.toFixed(1) : null,
        flight: !!(g.flight && g.flight.active()),
        dlLen: u.buildings.dl.len + u.ground.dl.len + (u.enriched ? u.enriched.dl.len : 0),
        dlJobs: u.buildings.dl.jobs + u.ground.dl.jobs + (u.enriched ? u.enriched.dl.jobs : 0),
        parseLen: u.buildings.parse.len + u.ground.parse.len + (u.enriched ? u.enriched.parse.len : 0),
        parseJobs: u.buildings.parse.jobs + u.ground.parse.jobs + (u.enriched ? u.enriched.parse.jobs : 0),
      });
    } catch (err) { rec.error = String(err); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;
const REC_STOP = `(() => { const r = window.__cpuRec; if (!r) return null; r.stop = true; return { rows: r.rows, error: r.error }; })()`;
const NOW = `performance.now()`;

await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 250 });
await send("Page.bringToFront");
await evalJs(REC_START);
const tA = await evalJs(NOW);
await send("Profiler.start");
const tB = await evalJs(NOW);

let legInfo = null;
if (LEG) {
  const { end, afterArrivalS, maxLegS } = descent.leg;
  const t0 = Date.now();
  const hasStore = await evalJs(`!!(window.__cameraStore && window.__cameraStore.getState().requestFly)`);
  if (!hasStore) throw new Error("__cameraStore.requestFly absent — the descent needs the store seam (the sweep's drive)");
  await evalJs(`(() => { const s = window.__cameraStore.getState(); s.requestFly({ latDeg: ${end.latDeg}, lonDeg: ${end.lonDeg}, altM: ${end.altM} }); return true; })()`);
  let arrivedAt = null;
  let targetsIssued = false;
  let quietAtEnd = false;
  while (Date.now() - t0 < maxLegS * 1000) {
    const flying = await evalJs(`!!(window.__globe.flight && window.__globe.flight.active())`);
    if (!flying && !targetsIssued) {
      await evalJs(`(() => { const s = window.__cameraStore.getState(); s.setTargetHeading(${end.headingDeg}); s.setTargetTilt(${end.tiltDeg}); s.setTargetZoom(${end.altM}); return true; })()`);
      targetsIssued = true;
    }
    if (!flying && targetsIssued) {
      arrivedAt ??= Date.now();
      if (Date.now() - arrivedAt >= afterArrivalS * 1000 && (await evalJs(BUSY)) === 0) {
        quietAtEnd = true;
        break;
      }
    }
    await sleep(250);
  }
  legInfo = { legMs: Date.now() - t0, quietAtEnd, arrivalPose: await evalJs(`(() => { const g = window.__globe; const c = window.__cameraStore.getState(); return { altM: Math.round(g.alt()), headingDeg: +c.headingDeg.toFixed(1), tiltDeg: +c.tiltDeg.toFixed(1) }; })()`) };
} else {
  await sleep(SECONDS * 1000);
}

const tC = await evalJs(NOW);
const { profile } = await send("Profiler.stop");
const tD = await evalJs(NOW);
await send("Profiler.disable");
const rec = await evalJs(REC_STOP);

// ── clock alignment: profile µs = performance.now() ms × 1000 + K. The bracket estimate first
//    (Profiler.start/stop run on the main thread, so a busy page can put them anywhere in their
//    bracket — ±165 ms on the first descent run); the MARKERS refine it below to ~±1 ms. ──────
const kBracket = ((profile.startTime - ((tA + tB) / 2) * 1000) + (profile.endTime - ((tC + tD) / 2) * 1000)) / 2;
let K = kBracket;
let alignErrMs = Math.abs((profile.startTime - ((tA + tB) / 2) * 1000) - (profile.endTime - ((tC + tD) / 2) * 1000)) / 1000;
let alignSource = "bracket";

// ── the bucket classifier ───────────────────────────────────────────────────────────────────
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const parentOf = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
const shortUrl = (u) => (u ? u.replace(new RegExp("^" + DEV.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/"), "").replace(/\?.*$/, "") : "");
// Order matters: each frame is tested against the buckets in THIS order, and the walk from the
// leaf up stops at the first frame that names any bucket — so `parseTile` (in TilesRenderer.js)
// reads as parse, not orchestrator, and `uploadTexture` under `setProgram` reads as upload, not render.
const BUCKETS = [
  ["marker", (fn) => /^__ftwMark\d+$/.test(fn)],
  ["gc", (fn) => fn === "(garbage collector)"],
  ["idle", (fn) => fn === "(idle)"],
  ["program", (fn) => fn === "(program)"],
  ["parse", (fn, url) => /GLTFLoader|GLTFParser|GLTFBinaryExtension|GLTF[A-Z]\w*Extension|B3DMLoader|I3DMLoader|CMPTLoader|PNTSLoader|LoaderBase|DRACOLoader|KTX2Loader|parseTile|parseAsync|readMagicBytes|arrayToString|ImageBitmapLoader|TextureLoader|ImageLoader|createImageBitmap|decodeImage|FileLoader/.test(fn + " " + url) || /^(parse|JSON\.parse)$/.test(fn)],
  ["compile", (fn, url) => /acquireProgram|WebGLProgram\b|WebGLProgram\.js|WebGLShader|compileShader|linkProgram|onBeforeCompile|compileAsync|resolveIncludes|replaceLightNums|replaceClippingPlaneNums|generatePrecision|getToneMappingFunction|generateShadowMapTypeDefine|generateEnvMapBlendingDefine|filterEmptyLine|fetchAttributeLocations|getShaderErrors|handleSource|ShaderChunk|ShaderLib/.test(fn + " " + url)],
  ["upload", (fn, url) => /uploadTexture|uploadCubeTexture|initTexture|createBuffer|updateBuffer|generateMipmap|updateVideoTexture|setupRenderTarget|setupFrameBufferTexture|setupDepthTexture|setupDepthRenderbuffer|WebGLGeometries\.(get|update)|getWireframeAttribute|updateWireframeAttribute/.test(fn + " " + url)],
  ["seats", (fn, url) => /seatQuiet|enrichedBuildings|seatSettle|reseat|\bseat/i.test(fn + " " + url)],
  ["controls", (fn, url) => /EnvironmentControls|GlobeControls|PluxGlobeControls|_getPointBelowCamera|belowCameraGate|raycast|Raycaster|intersectObject/.test(fn + " " + url)],
  ["app", (fn, url) => /(^|\/)src\/(components|lib|store)\//.test(url)],
  ["orchestrator", (fn, url) => /3d-tiles-renderer|TilesRenderer|TilesRendererBase|traverseFrustum|markUsedTiles|toggleTiles|determineFrustumSet|LRUCache|PriorityQueue|tryRunJobs|scheduleJob|updateVisibleTiles|recursivelyLoadTiles|skipTraversal|markUsedSetLeaves|markVisibleTiles|TilesGroup|Ellipsoid|preprocessNode|TilesFadePlugin|TileCompressionPlugin|GLTFExtensionsPlugin|ImageOverlayPlugin|ReorientationPlugin/.test(fn + " " + url)],
  ["render", (fn, url) => /WebGLRenderer|renderBufferDirect|projectObject|renderObjects|renderScene|renderTransmissionPass|setProgram|refreshUniforms|WebGLUniforms|WebGLState|WebGLRenderLists|WebGLRenderStates|WebGLShadowMap|EffectComposer|ScaledBloom|FusedOutput|MsaaResolve|resolvedComposer|WebGLBufferRenderer|WebGLIndexedBufferRenderer|WebGLBackground|WebGLMorphtargets|WebGLClipping|WebGLCubeMaps|WebGLMaterials|WebGLInfo|WebGLBindingStates|setupVertexAttributes|WebGLAttributes|WebGLTextures|WebGLObjects|WebGLPrograms|WebGLProperties|WebGLUtils|WebGLCapabilities|WebGLExtensions|\/postprocessing\/|Pass\.js|ShaderPass|RenderPass/.test(fn + " " + url)],
];
const bucketCache = new Map(); // nodeId → bucket
const bucketOf = (leafId) => {
  if (bucketCache.has(leafId)) return bucketCache.get(leafId);
  let cur = leafId;
  let found = "other";
  const seen = new Set();
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    const cf = nodes.get(cur).callFrame;
    const fn = cf.functionName || "(anonymous)";
    const url = shortUrl(cf.url);
    const hit = BUCKETS.find(([, test]) => test(fn, url));
    if (hit) {
      found = hit[0];
      break;
    }
    cur = parentOf.get(cur);
  }
  bucketCache.set(leafId, found);
  return found;
};

// ── the sample walk: absolute µs per sample, bucket, leaf fn ────────────────────────────────
const samples = [];
{
  let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i] ?? 0;
    samples.push({ id: profile.samples[i], t, us: profile.timeDeltas[i + 1] ?? 0 }); // a sample's weight = the gap to the NEXT sample
  }
}
const totalUs = profile.endTime - profile.startTime;
// marker clusters: consecutive samples whose leaf is the same __ftwMarkN → one marker at the first sample
const markers = [];
const markerResidue = (id) => {
  // the spin's samples land in the marker itself OR in the native `performance.now()` it calls
  for (let cur = id, hops = 0; cur !== undefined && hops < 2; cur = parentOf.get(cur), hops++) {
    const m = /^__ftwMark(\d+)$/.exec(nodes.get(cur).callFrame.functionName);
    if (m) return Number(m[1]);
  }
  return null;
};
for (const s of samples) {
  const r0 = markerResidue(s.id);
  if (r0 === null) continue;
  const m = [null, r0];
  const r = Number(m[1]);
  const last = markers[markers.length - 1];
  if (last && last.r === r && s.t - last.tLast < 5000) last.tLast = s.t;
  else markers.push({ r, t: s.t, tLast: s.t });
}
{
  const rowsIn = rec?.rows ?? [];
  const ks = [];
  let j = 0;
  let matched = 0;
  // A two-pointer merge on the residue ring: a marker whose residue is AHEAD of the row's (by
  // 1..MARKS/2) means this row's marker was missed → skip the row; a residue BEHIND means a stray
  // or split cluster → skip the marker. Searching a residue further ahead would re-match one full
  // cycle later (16 frames off) — the bug in the first version of this matcher.
  for (const row of rowsIn) {
    const want = row.i % MARKS;
    while (j < markers.length) {
      const d = (markers[j].r - want + MARKS) % MARKS;
      if (d === 0) {
        ks.push(markers[j].t - row.n * 1000);
        j++;
        matched++;
        break;
      }
      if (d <= MARKS / 2) break; // the marker belongs to a later row: this row's marker is missing
      j++; // a marker from an earlier residue: stray, skip it
    }
  }
  if (ks.length >= 8) {
    ks.sort((a, b) => a - b);
    const med = ks[Math.floor(ks.length / 2)];
    const p05 = ks[Math.floor(ks.length * 0.05)];
    const p95 = ks[Math.floor(ks.length * 0.95)];
    K = med;
    alignErrMs = Math.max(med - p05, p95 - med) / 1000;
    alignSource = `markers (${matched}/${rowsIn.length} ticks seen by the sampler; bracket estimate was off by ${((kBracket - med) / 1000).toFixed(1)} ms)`;
  }
}
const fnKey = (id) => {
  const cf = nodes.get(id).callFrame;
  return `${cf.functionName || "(anonymous)"}  ${shortUrl(cf.url) || "(native)"}:${cf.lineNumber + 1}`;
};
const ledger = (sel) => {
  const byBucket = new Map();
  const byFn = new Map(); // bucket → Map(fn → us)
  let us = 0;
  for (const s of sel) {
    const b = bucketOf(s.id);
    if (b === "marker") continue; // the probe's own frame markers are not the page's work
    byBucket.set(b, (byBucket.get(b) ?? 0) + s.us);
    if (!byFn.has(b)) byFn.set(b, new Map());
    const m = byFn.get(b);
    const k = fnKey(s.id);
    m.set(k, (m.get(k) ?? 0) + s.us);
    us += s.us;
  }
  return { us, byBucket, byFn };
};
const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
const ms = (us) => (us / 1000).toFixed(1).padStart(7);
const pct = (us, of) => (of ? ((100 * us) / of).toFixed(1).padStart(5) : "    -");
const printLedger = (title, L, { fns = 0, only = null } = {}) => {
  console.log(`\n── ${title}: ${ms(L.us)} ms of main thread ──`);
  const order = [...BUCKETS.map(([b]) => b).filter((b) => b !== "marker"), "other"];
  for (const b of order) {
    const us = L.byBucket.get(b) ?? 0;
    if (!us) continue;
    console.log(`  ${b.padEnd(13)} ${ms(us)} ms  ${pct(us, L.us)} %`);
    if (fns && (!only || only.includes(b)) && b !== "idle" && b !== "program" && b !== "gc") {
      for (const [f, u] of top(L.byFn.get(b), fns)) console.log(`      ${ms(u)} ms  ${f}`);
    }
  }
};

// ── frames (from the recorder) and their windows in profile µs ───────────────────────────────
const rows = rec?.rows ?? [];
const frames = [];
for (let i = 0; i + 1 < rows.length; i++) {
  const a = rows[i].ts * 1000 + K;
  const b = rows[i + 1].ts * 1000 + K;
  frames.push({ ...rows[i], dt: rows[i + 1].ts - rows[i].ts, t0: a, t1: b, parsePhase: rows[i].parseLen + rows[i].parseJobs > 0, dlPhase: rows[i].dlLen + rows[i].dlJobs > 0 });
}
const inWindows = (wins) => {
  // samples sorted by t; windows sorted by t0 — one merge pass
  const out = [];
  let j = 0;
  const W = wins.slice().sort((x, y) => x.t0 - y.t0);
  for (const s of samples) {
    while (j < W.length && W[j].t1 <= s.t) j++;
    if (j < W.length && s.t >= W[j].t0 && s.t < W[j].t1) out.push(s);
  }
  return out;
};

console.log(`\nprofile ${(totalUs / 1000).toFixed(0)} ms wall, ${profile.samples.length} samples · recorder ${rows.length} frames${rec?.error ? ` (recorder error: ${rec.error})` : ""} · clock alignment ±${alignErrMs.toFixed(1)} ms via ${alignSource}`);
if (legInfo) console.log(`leg ${(legInfo.legMs / 1000).toFixed(1)} s · ${legInfo.quietAtEnd ? "settled" : "STILL BUSY"} at the end · arrival alt ${legInfo.arrivalPose.altM} m heading ${legInfo.arrivalPose.headingDeg}° tilt ${legInfo.arrivalPose.tiltDeg}°`);

const all = ledger(samples);
printLedger("WHOLE PROFILE", all, { fns: 6 });

let hitchLedger = null;
let parseLedger = null;
let quietLedger = null;
let hitchFrames = [];
if (frames.length) {
  const dts = frames.map((f) => f.dt).sort((a, b) => a - b);
  const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
  hitchFrames = frames.filter((f) => f.dt > 33);
  const parseFrames = frames.filter((f) => f.parsePhase);
  const quietFrames = frames.filter((f) => !f.parsePhase && !f.dlPhase);
  console.log(`\nframes ${frames.length} · dt p50 ${q(0.5).toFixed(1)} / p95 ${q(0.95).toFixed(1)} / max ${dts[dts.length - 1].toFixed(1)} ms · parse-phase ${parseFrames.length} · quiet ${quietFrames.length} · HITCHES (> 33 ms) ${hitchFrames.length}${hitchFrames.length ? ` — of which parse-phase ${hitchFrames.filter((f) => f.parsePhase).length}` : ""}`);
  parseLedger = ledger(inWindows(parseFrames));
  quietLedger = ledger(inWindows(quietFrames));
  hitchLedger = ledger(inWindows(hitchFrames));
  printLedger(`PARSE-PHASE frames (${parseFrames.length})`, parseLedger);
  printLedger(`QUIET frames (${quietFrames.length})`, quietLedger);
  printLedger(`HITCH frames (${hitchFrames.length}, dt > 33 ms) — the frames lever 10 is judged on`, hitchLedger, { fns: TOP >= 30 ? 8 : 4 });
  if (hitchFrames.length) {
    // WHO issues the work: for the buckets whose leaf is library code (a raycast, a buffer upload,
    // three's EdgesGeometry), the nearest frame of OUR code above it — the lever lives there, not
    // in three. Wrappers that merely forward (the T79 gate, the controls subclass) are skipped.
    const WRAPPERS = /belowCameraGate|pluxGlobeControls/;
    const callerOf = (leafId) => {
      let cur = leafId;
      const seen = new Set();
      while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur);
        const cf = nodes.get(cur).callFrame;
        const u = shortUrl(cf.url);
        if (/(^|\/)src\//.test(u) && !WRAPPERS.test(u)) return `${cf.functionName || "(anonymous)"}  ${u}:${cf.lineNumber + 1}`;
        cur = parentOf.get(cur);
      }
      return "(no app frame above)";
    };
    console.log(`\n── HITCH frames: the nearest APP caller above each library-heavy bucket ──`);
    const hitchSamples = inWindows(hitchFrames);
    for (const b of ["controls", "upload", "app", "seats", "compile", "render"]) {
      const tally = new Map();
      let us = 0;
      for (const smp of hitchSamples) {
        if (bucketOf(smp.id) !== b) continue;
        const c = callerOf(smp.id);
        tally.set(c, (tally.get(c) ?? 0) + smp.us);
        us += smp.us;
      }
      if (us < 20_000) continue;
      console.log(`  ${b} (${(us / 1000).toFixed(0)} ms):`);
      for (const [c, u] of top(tally, 5)) console.log(`      ${ms(u)} ms  ${c}`);
    }
    console.log(`\n── the worst 12 hitch frames, one line each (ms of each bucket inside the frame) ──`);
    const worst = hitchFrames.slice().sort((a, b) => b.dt - a.dt).slice(0, 12);
    for (const f of worst) {
      const L = ledger(inWindows([f]));
      const cells = [...BUCKETS.map(([b]) => b).filter((b) => b !== "marker"), "other"].filter((b) => (L.byBucket.get(b) ?? 0) >= 500).map((b) => `${b} ${(L.byBucket.get(b) / 1000).toFixed(1)}`);
      console.log(`  dt ${f.dt.toFixed(1).padStart(6)} ms  alt ${String(f.altM).padStart(6)} m  ${f.flight ? "flying " : "arrived"}  dl ${String(f.dlLen).padStart(3)}/${f.dlJobs}  parse ${String(f.parseLen).padStart(3)}/${f.parseJobs}  │ ${cells.join(" · ")}`);
    }
  }
}

// ── the classic ledgers (kept from the settled-pose probe) ──────────────────────────────────
const byFn = new Map();
const byFile = new Map();
for (const s of samples) {
  const cf = nodes.get(s.id).callFrame;
  const fn = fnKey(s.id);
  byFn.set(fn, (byFn.get(fn) ?? 0) + s.us);
  const file = shortUrl(cf.url) || "(native)";
  byFile.set(file, (byFile.get(file) ?? 0) + s.us);
}
console.log(`\n── self time by FILE (top 15) ──`);
for (const [f, us] of top(byFile, 15)) console.log(`${pct(us, totalUs)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${f}`);
console.log(`\n── self time by FUNCTION (top ${TOP}) ──`);
for (const [f, us] of top(byFn, TOP)) console.log(`${pct(us, totalUs)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${f}`);

const serial = (L) => L && { ms: L.us / 1000, byBucket: Object.fromEntries([...L.byBucket].map(([b, u]) => [b, +(u / 1000).toFixed(2)])), topFns: Object.fromEntries([...L.byFn].map(([b, m]) => [b, top(m, 12).map(([f, u]) => [f, +(u / 1000).toFixed(2)])])) };
const path = `${OUT_DIR}/cpu-${LABEL}-${STAMP}.cpuprofile`;
writeFileSync(path, JSON.stringify(profile));
writeFileSync(
  `${OUT_DIR}/cpu-${LABEL}-${STAMP}.summary.json`,
  JSON.stringify(
    {
      pose: LEG ? "dnipro-descent" : POSE,
      leg: LEG,
      ultra: ULTRA,
      device: DEVICE,
      seconds: LEG ? null : SECONDS,
      cpuP50: cpu0.cpuP50,
      dtP50: cpu0.dtP50,
      totalMs: totalUs / 1000,
      alignErrMs,
      alignSource,
      markersSeen: markers.length,
      legInfo,
      frames: frames.length,
      hitchFrames: hitchFrames.map(({ t0, t1, ...f }) => f),
      whole: serial(all),
      parsePhase: serial(parseLedger),
      quiet: serial(quietLedger),
      hitch: serial(hitchLedger),
      byFile: top(byFile, 30),
      byFn: top(byFn, 80),
    },
    null,
    2,
  ),
);
console.log(`\nwrote ${path} (DevTools → Performance → Load profile)`);
await finishVerify(0);
