#!/usr/bin/env node
/**
 * T77 step 1 — MEASURE: the rendering PERFORMANCE BASELINE harness (2026-09-05).
 *
 * `rendering/T77_AUDIT_PLAN_2026-09-05.md` §3: nothing may be optimized before it is measured,
 * and until this script ran no draw-call / triangle / GPU-ms reading existed for any pose on any
 * hardware. This walks the plan's matrix on a HEADED Chrome (headless governs to tier `low` and
 * may lack the GPU timer) and writes ONE JSON + ONE markdown table per run; the MEASUREMENTS doc
 * is composed from those files, never from a transcript.
 *
 *   node scripts/verify-perf-baseline.mjs [PORT] [--quick] [--only <regex>] [--label warm|cold]
 *        [--settle 90] [--sample 10] [--feed 6] [--models 0,6,24] [--glb <https url>]
 *        [--owner <member email>] [--no-models] [--dsf 2] [--post-ab] [--device] [--cleanup-seeds <ids.json>]
 *
 * Preconditions: `wix dev` on :4321 (the `window.__*` seams are DEV-only) and the owner's headed
 * CDP Chrome on :9222 (`node scripts/verify-chrome.mjs`; NEVER killed). Node ≥ 22 (global
 * WebSocket). The Wix world is PRODUCTION even from `wix dev`: every model row this script seeds
 * is removed in `finally`, and the ids are journaled to `verify-shots/perf/seeds-<stamp>.json`
 * so a crashed run can be swept with `--cleanup-seeds <that file>`.
 *
 * THE MATRIX (one BOOT per pose × ULTRA × device tier × resident models; SAMPLES inside a boot):
 *   poses   — the plan's §3 poses, cited from their owning harnesses, never invented:
 *             fpv     `#f=48.4647,35.0462,1.7,25,8,60` (verify-usermodels EYE)
 *             city    `#p=48.464,35.046,900,74,300`     (verify-ultra DNIPRO — the hash grammar is
 *                     lat,lon,alt,HEADING,TILT, so this is heading 74°, tilt 300° → clamped 88°:
 *                     a near-horizontal view of the city from 900 m, ~26 km back; cited verbatim)
 *             orbit   `#p=48.4647,35.0462,700,25,40`   (verify-usermodels ORBIT — the pose the model
 *                     ramp uses in orbit: MODELS.loadRadiusM is 3 km from the CAMERA, and the
 *                     city pose's camera stands ~26 km from the eye, so nothing is resident there)
 *             everest `#p=27.87,86.83,11500,76,35`     (verify-ultra EVEREST)
 *             m       `/m#p=48.4640,35.0460,220,0,0`   (verify-qaslice-cab — 390×844 @3, touch)
 *   ULTRA   — the PERSISTED pref (`ftw:view-prefs:v1`.ultraQuality) written by a new-document
 *             script BEFORE boot: the 8192² map and the cascade ladder are construction-time.
 *   tier    — the DEVICE tier, forced BEFORE boot by overriding `navigator.hardwareConcurrency`
 *             (2 → `low`, 4 → `mid`, native → `high`; `quality.ts detectDeviceTier`): shadow map
 *             size and `shadowMap.enabled` are boot-latched from the device tier, so a live
 *             `__quality.force()` alone cannot produce a tier's real profile. The governor is then
 *             PINNED in-page (its `step` re-forces the tier and reports `changed:false`) so a
 *             40 s window on an M3 Pro cannot promote `mid` back to `high`; `tierLog` is recorded.
 *   models  — `/api/dev-seed kind:"model"` rows (row-only, DEV-gated, no member session) at ONE
 *             realistic textured GLB, 20–60 m around the FPV eye; seeded BEFORE the boot so the
 *             boot's own world fetch sees them. N is the TOTAL resident count: the world already
 *             holds real member models near the eye (3 at the time of writing), so the first
 *             m0 boot reads that baseline and later steps seed `N − baseline`. `userModels()`
 *             counts are asserted (resident === N, skipped === 0), never assumed.
 *   --dsf   — the viewport's deviceScaleFactor (default 2, the owner's retina). `--dsf 1` re-runs
 *             the same boots at a quarter of the pixels: the fill-bound A/B the GPU timer needs.
 *   --post-ab — two more samples per desktop boot: `aoOff` (`__quality.ao.enabled=false`, the live
 *             GTAOPass; high tier + low altitude only) and `bloomOff` (the UnrealBloomPass), each
 *             restored after — the GPU timer split between geometry and post-processing.
 *   --device — a REAL PHONE's Chrome over adb (T1 / the T77 phone baseline, Android half). No
 *             viewport or touch emulation, no tier override (the device's own detection is the
 *             measurement: coarse pointer → lean, tier capped `mid`), one boot per pose × ULTRA
 *             pref; the tier column reads `auto`. Recipe (Pixel 6 Pro, USB debugging on):
 *               adb reverse tcp:4321 tcp:4321                    # the phone's localhost:4321 → this Mac's wix dev
 *               adb forward tcp:9444 localabstract:chrome_devtools_remote   # the phone's Chrome CDP → :9444
 *               adb shell am start -a android.intent.action.VIEW -d "http://localhost:4321/" com.android.chrome
 *               node scripts/verify-perf-baseline.mjs 9444 --device --label pixel6pro --quick
 *             `performance.memory` exists on Android Chrome; `frame.gpu` is usually absent (no
 *             EXT_disjoint_timer_query on mobile GPUs) — recorded as such, never invented.
 *   shadows — three SAMPLES per shadow-capable boot, in this order: `on` (as booted) → `noUpdate`
 *             (`renderer.shadowMap.autoUpdate=false`: the depth pass is skipped, the stale map is
 *             still sampled → the PASS cost alone) → `off` (`renderer.shadowMap.enabled=false`:
 *             one full material recompile, then no shadow work at all → the whole shadow cost).
 *
 * WHAT IS READ, and from where (every one a seam that exists — see conventions/contracts.md §3):
 *   • an in-page rAF sampler with the HUD CLOSED: frame dt (p50/p95/max), `__renderer.info`
 *     draw calls + triangles per frame (autoReset is off and the tick resets once per frame, so
 *     these are whole-frame truth: shadow + composer + PiP), the governor's EMA + hitch count,
 *     the RC21 gate's draws/skips (asserted: gate OFF, every frame drew), JS heap;
 *   • then the DBG FEED for a shorter window (`window.__debugFeed`, the T77 read seam — the feed
 *     is activated WITHOUT mounting the panel, so its DOM cost stays out of the numbers): the
 *     orchestrator bracket `frame.cpu`, the submit bracket `frame.draw`, the GPU timer
 *     `frame.gpu` (EXT_disjoint_timer_query; a few frames late; may be absent), and EVERY
 *     provider snapshot — tiles (per-renderer lruMB / inCache / visible / queues, composites),
 *     terrain (epoch, memo hits·misses), buildings (deferred / rejected / seatEpoch), models,
 *     ultra.shadow.*, canvas (tier / dpr / shadow px / programs / geometries / textures).
 *   Cumulative counters are differenced across the sample window (the RC11 rule).
 *
 * Traps this script encodes (each one cost a session): bounce through about:blank for a
 * hash-only navigation · `Page.bringToFront` before every timed window (the owner's Chrome has
 * no occlusion flags) · settle on the u5() queue counters, not a sleep · `Runtime.evaluate`
 * with awaitPromise · a cold profile is a different machine (`--label`) · the seeds ride the
 * PRODUCTION world (journal + finally) · never edit src/ while this runs (HMR reloads the page).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9222";
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const QUICK = flag("--quick");
const ONLY = opt("--only", null) ? new RegExp(opt("--only")) : null;
const LABEL = opt("--label", "warm");
const SETTLE_MAX_MS = Number(opt("--settle", "90")) * 1000; // the city pose streams ~3,300 ground tiles (≈85 s); quiet ends it early elsewhere
const SAMPLE_MS = Number(opt("--sample", "10")) * 1000;
const FEED_MS = Number(opt("--feed", "6")) * 1000;
const MODEL_STEPS = flag("--no-models") ? [0] : opt("--models", QUICK ? "0" : "0,6,24").split(",").map(Number);
const OWNER_EMAIL = opt("--owner", "yevhens@wix.com");
const CLEANUP_FILE = opt("--cleanup-seeds", null);
const DSF = Number(opt("--dsf", "2"));
const POST_AB = flag("--post-ab"); // + the GTAO-off and bloom-off samples per boot (GPU attribution)
const DEVICE = flag("--device"); // a real phone's Chrome over adb: no emulation, no tier override
const DEV = "http://localhost:4321";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = "verify-shots/perf";
mkdirSync(OUT_DIR, { recursive: true });

// The realistic textured sample (Khronos glTF-Sample-Assets, CC-BY 4.0): 3,773,916 B, 15,452
// triangles, 1 mesh, five 2048² JPEG textures, no extensions — under every MODEL_CAPS rail
// (8 MiB, 100k tris, 8 textures, 2048 edge). The 12-triangle harness box measures nothing.
// `dev-seed` accepts any https URL (`dev-seed.ts:147-157`); raw.githubusercontent.com serves
// `access-control-allow-origin: *`. A stored static.wixstatic.com URL can be passed via --glb.
const GLB = {
  url: opt(
    "--glb",
    "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb",
  ),
  glbBytes: 3_773_916,
  tris: 15_452,
  meshes: 1,
  textures: 5,
  bbox: [2, 2, 2],
};

// ─── Poses (cited; see the docblock) ─────────────────────────────────────────────────────────
const T_FPV = 1787133600000; // verify-usermodels EYE instant
const T_ULTRA = Date.UTC(2026, 7, 21, 9, 40); // verify-ultra SWEEP "day"
const T_M = 1787313600000; // verify-qaslice-cab NOON_UTC
const EYE = { lat: 48.4647, lon: 35.0462 };
const POSES = {
  fpv: { url: `${DEV}/#f=48.4647,35.0462,1.7,25,8,60&t=${T_FPV}`, kind: "fpv", models: true },
  orbit: { url: `${DEV}/#p=48.4647,35.0462,700,25,40&t=${T_FPV}`, kind: "orbit", models: true },
  city: { url: `${DEV}/#p=48.464,35.046,900,74,300&t=${T_ULTRA}`, kind: "orbit", models: false },
  everest: { url: `${DEV}/#p=27.87,86.83,11500,76,35&t=${T_ULTRA}`, kind: "orbit", models: false },
  m: { url: `${DEV}/m#p=48.4640,35.0460,220,0,0&t=${T_M}`, kind: "m", models: false },
};
const CORES_FOR_TIER = { high: null, mid: 4, low: 2, auto: null }; // detectDeviceTier: ≤3 → low, <8 → mid; auto = the device's own

// ─── The boot list (models OUTERMOST so the world is written as few times as possible) ──────
function buildBoots() {
  const boots = [];
  if (DEVICE) {
    // A real phone: its own tier, every pose (the desktop route on a phone is the coarse-pointer
    // lean profile; `/m` is its natural shell), ULTRA off and on (the pref is refused on a coarse
    // pointer — the boot asserts that refusal instead of a rig).
    for (const N of MODEL_STEPS) {
      for (const pose of N === 0 ? ["fpv", "orbit", "city", "everest", "m"] : ["fpv", "orbit"]) {
        boots.push({ pose, ultra: false, tier: "auto", N });
        if (N === 0 && pose !== "m" && !QUICK) boots.push({ pose, ultra: true, tier: "auto", N });
      }
    }
    for (const b of boots) b.id = `${b.pose}.u${b.ultra ? 1 : 0}.${b.tier}.m${b.N}`;
    return ONLY ? boots.filter((b) => ONLY.test(b.id)) : boots;
  }
  const tiers = QUICK ? ["high"] : ["high", "mid", "low"];
  for (const N of MODEL_STEPS) {
    if (N === 0) {
      for (const pose of ["fpv", "orbit", "city", "everest"]) {
        for (const tier of tiers) boots.push({ pose, ultra: false, tier, N });
        boots.push({ pose, ultra: true, tier: "high", N });
      }
      for (const tier of QUICK ? ["mid"] : ["mid", "low"]) boots.push({ pose: "m", ultra: false, tier, N });
    } else {
      for (const pose of ["fpv", "orbit"]) for (const ultra of [false, true]) boots.push({ pose, ultra, tier: "high", N });
    }
  }
  for (const b of boots) b.id = `${b.pose}.u${b.ultra ? 1 : 0}.${b.tier}.m${b.N}`;
  return ONLY ? boots.filter((b) => ONLY.test(b.id)) : boots;
}

// ─── CDP plumbing (the house idiom: verify-usermodels.mjs / verify-rendering-charter.mjs) ────
const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
let ws = null;
let seq = 0;
const pending = new Map();
const consoleErrors = [];
const crashEvents = [];
const CDP_TIMEOUT_MS = 90_000; // the charter's lesson: a stalled main thread must not hang the run silently
/** Open (or REPLACE) the page target. A boot whose renderer hangs or crashes is abandoned: the
 *  old target is closed over HTTP (works with a dead renderer) and a fresh renderer process takes
 *  the next boot — the run continues and the failure is recorded, never re-raised as a crash. */
async function attach() {
  if (target) await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  for (const [, p] of pending) p.rej(new Error("target replaced"));
  pending.clear();
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
  trackTarget(PORT, target.id);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params.exceptionDetails?.text ?? "exception");
    if (msg.method === "Inspector.targetCrashed" || msg.method === "Inspector.detached") crashEvents.push(`${new Date().toISOString()} ${msg.method} ${JSON.stringify(msg.params ?? {})}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Inspector.enable").catch(() => {});
  bootScriptId = null; // a new target carries no new-document scripts
}
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      rej(new Error(`CDP ${method} timed out after ${CDP_TIMEOUT_MS} ms`));
    }, CDP_TIMEOUT_MS);
    pending.set(id, {
      res: (v) => (clearTimeout(timer), res(v)),
      rej: (e) => (clearTimeout(timer), rej(e)),
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
  return r.result.value;
};
const waitFor = async (expr, timeoutMs = 90_000, label = expr) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(expr)) return true;
    } catch {
      /* booting */
    }
    await sleep(400);
  }
  throw new VerifyFailure(`timed out after ${timeoutMs} ms waiting for: ${label}`);
};
const ticks = async (frames = 6) => {
  await send("Page.bringToFront");
  return evalJs(
    `new Promise((res) => { let n = 0; const step = () => (++n >= ${frames} ? res(n) : requestAnimationFrame(step)); requestAnimationFrame(step); })`,
  );
};
let bootScriptId = null;
await attach();

// ─── Reporting ───────────────────────────────────────────────────────────────────────────────
const results = [];
const notes = [];
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
};
const note = (s) => {
  console.log(`note  ${s}`);
  notes.push(s);
};
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : typeof v === "number" ? v.toFixed(d) : String(v));
const fmtI = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Math.round(v).toLocaleString("en-US"));

// ─── Seeds (the PRODUCTION world — journaled, removed in finally) ────────────────────────────
const seedIds = [];
const SEED_JOURNAL = `${OUT_DIR}/seeds-${STAMP}.json`;
const journal = () => writeFileSync(SEED_JOURNAL, JSON.stringify({ stamp: STAMP, ids: seedIds }, null, 2));
const devSeed = async (body) => {
  const r = await fetch(`${DEV}/api/dev-seed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const devUnseed = async (id) => {
  const r = await fetch(`${DEV}/api/dev-seed?kind=model&id=${encodeURIComponent(id)}`, { method: "DELETE" });
  return { status: r.status, body: await r.json().catch(() => null) };
};
/** Ring placements 20–60 m around the FPV eye — the plan's spread; deterministic per index. */
const placement = (i, N) => {
  const bearing = ((360 * i) / Math.max(1, N) + 15) * (Math.PI / 180);
  const r = 20 + 40 * (((i * 7) % Math.max(1, N)) / Math.max(1, N));
  return {
    lat: EYE.lat + (r * Math.cos(bearing)) / 111_320,
    lon: EYE.lon + (r * Math.sin(bearing)) / (111_320 * Math.cos((EYE.lat * Math.PI) / 180)),
  };
};
const seedTo = async (N) => {
  while (seedIds.length < N) {
    const i = seedIds.length;
    const { lat, lon } = placement(i, N);
    const r = await devSeed({
      kind: "model",
      ownerEmail: OWNER_EMAIL,
      model: {
        fileId: `plux-t77-baseline-${STAMP}-${i}.glb`,
        thumbnailFileId: null,
        title: `T77 baseline ${i}`,
        fileName: null,
        sourceFormat: "glb",
        rawBytes: null,
        glbBytes: GLB.glbBytes,
        tris: GLB.tris,
        meshes: GLB.meshes,
        textures: GLB.textures,
        decimatedFromTris: null,
        bbox: GLB.bbox,
        lat,
        lon,
        url: GLB.url,
      },
    });
    if (r.status !== 200 || !r.body?.modelId) throw new VerifyFailure(`dev-seed model ${i} → ${r.status} ${JSON.stringify(r.body)}`);
    seedIds.push(r.body.modelId);
    journal();
  }
  // Wix Data reads lag writes ~1 s — the boot's world fetch must see every row.
  await sleep(1500);
};
const unseedAll = async () => {
  let removed = 0;
  for (const id of seedIds.splice(0, seedIds.length)) {
    const r = await devUnseed(id);
    if (r.body?.deleted === true) removed++;
    else console.error(`  seed ${id} NOT removed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  journal();
  return removed;
};

if (CLEANUP_FILE) {
  const ids = JSON.parse(readFileSync(CLEANUP_FILE, "utf8")).ids ?? [];
  seedIds.push(...ids);
  const n = await unseedAll();
  console.log(`cleanup  removed ${n}/${ids.length} seeds from ${CLEANUP_FILE}`);
  await finishVerify(n === ids.length ? 0 : 1);
}

// ─── In-page probes ──────────────────────────────────────────────────────────────────────────
const BOOT_SCRIPT = (ultra, cores) => `(() => {
  try {
    const k = "ftw:view-prefs:v1";
    const o = JSON.parse(localStorage.getItem(k) || "{}");
    o.ultraQuality = ${ultra ? "true" : "false"};
    o.debugHud = false;
    localStorage.setItem(k, JSON.stringify(o));
  } catch {}
  ${cores ? `Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => ${cores}, configurable: true });` : ""}
})()`;
const QUAL = `(() => { const q = window.__globeQuality, Q = window.__quality; return q ? { tier: q.tier, tileTier: q.tileTier, dpr: q.dpr, lean: q.lean, mapFlat: q.mapFlat, ultra: q.ultra, ultraBoot: q.ultraBoot, shadowMapPx: q.shadowMapPx, deviceTier: Q?.deviceTier ?? null, cores: navigator.hardwareConcurrency, tierLog: Q ? Q.tierLog.length : null, gpu: Q?.deviceCaps?.rendererString ?? null } : null; })()`;
const BUSY = `(() => { const u = window.__globe.u5(); const q = (r) => r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0;
  let um = null; try { um = window.__globe.userModels ? window.__globe.userModels() : null; } catch {}
  return { busy: q(u.buildings) + q(u.ground) + q(u.enriched), modelsLoading: um ? um.loading : 0, visible: { bld: u.buildings.stats.visible, gnd: u.ground.stats.visible, enr: u.enriched ? u.enriched.stats.visible : null } }; })()`;
const PIN_GOVERNOR = (tier) => `(() => { const q = window.__quality; if (!q) return false; const g = q.governor;
  if (!g.__t77orig) g.__t77orig = g.step.bind(g);
  const pin = ${JSON.stringify(tier)};
  g.step = (dt) => { const r = g.__t77orig(dt); if (r.tier !== pin) g.force(pin); return { tier: pin, changed: false }; };
  q.force(pin); return true; })()`;
const SAMPLER = (ms) => `new Promise((res) => {
  // Watchdog: 3 of 27 boots in the first full run saw this promise never resolve (a rAF that
  // stopped firing for > 90 s while the page answered later evaluates within 50 ms; not
  // reproduced by a 2.4-min heartbeat repro at the same pose). A stalled rAF is now a RECORDED
  // sample (rafStalled: true, whatever frames were seen), never a hung run.
  const watchdog = setTimeout(() => res({ rafStalled: true, frames: dts.length, windowMs: performance.now() - t0, visibility: document.visibilityState, hasFocus: document.hasFocus() }), ${ms} * 3 + 5000);
  const r = window.__renderer, g = window.__quality.governor, fg = window.__frameGate;
  const feed = window.__debugFeed;
  const read = (id) => (feed ? feed.read(id) : null);
  const t0snap = { terrain: read("terrain"), buildings: read("buildings"), canvas: read("canvas") };
  const dts = [], calls = [], tris = []; let last = performance.now(); const t0 = last;
  const h0 = g.hitchCount(), d0 = fg ? fg.draws : 0, s0 = fg ? fg.skips : 0;
  const tick = () => {
    const n = performance.now(); dts.push(n - last); last = n;
    calls.push(r.info.render.calls); tris.push(r.info.render.triangles);
    if (n - t0 < ${ms}) requestAnimationFrame(tick); else {
      clearTimeout(watchdog);
      const s = dts.slice(1).sort((a, b) => a - b);
      const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
      const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
      const t1snap = { terrain: read("terrain"), buildings: read("buildings"), canvas: read("canvas") };
      const diff = (k, a, b) => (a && b && typeof a[k] === "number" && typeof b[k] === "number" ? b[k] - a[k] : null);
      const winS = (n - t0) / 1000;
      res({
        frames: s.length, windowMs: n - t0, fps: (1000 * s.length) / (n - t0),
        dtP50: q(0.5), dtP95: q(0.95), dtMax: s[s.length - 1],
        calls: med(calls), callsMax: Math.max(...calls), tris: med(tris), trisMax: Math.max(...tris),
        hitches: g.hitchCount() - h0, emaMs: g.emaMs(),
        gateDraws: fg ? fg.draws - d0 : null, gateSkips: fg ? fg.skips - s0 : null, gateEnabled: fg ? fg.enabled : null,
        jsHeapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
        infoGeometries: r.info.memory.geometries, infoTextures: r.info.memory.textures, infoPrograms: r.info.programs ? r.info.programs.length : null,
        rates: {
          terrainEpochPerS: diff("epoch", t0snap.terrain, t1snap.terrain) === null ? null : diff("epoch", t0snap.terrain, t1snap.terrain) / winS,
          memoHitsPerS: diff("memo.hits", t0snap.terrain, t1snap.terrain) === null ? null : diff("memo.hits", t0snap.terrain, t1snap.terrain) / winS,
          memoMissesPerS: diff("memo.misses", t0snap.terrain, t1snap.terrain) === null ? null : diff("memo.misses", t0snap.terrain, t1snap.terrain) / winS,
          deferredPerS: diff("deferred", t0snap.buildings, t1snap.buildings) === null ? null : diff("deferred", t0snap.buildings, t1snap.buildings) / winS,
          rejectedPerS: diff("rejected", t0snap.buildings, t1snap.buildings) === null ? null : diff("rejected", t0snap.buildings, t1snap.buildings) / winS,
          seatEpochPerS: diff("seatEpoch", t0snap.buildings, t1snap.buildings) === null ? null : diff("seatEpoch", t0snap.buildings, t1snap.buildings) / winS,
          tierChanges: diff("tierChanges", t0snap.canvas, t1snap.canvas),
        },
      });
    }
  };
  requestAnimationFrame(tick);
})`;
// The feed window: activate the feed WITHOUT mounting the panel (no DOM cost in the numbers),
// let the rings fill (240 samples ≈ 4 s @ 60 Hz), read the stats + every provider, deactivate.
const FEED_SAMPLE = (ms) => `new Promise((res) => {
  const f = window.__debugFeed; if (!f) { res(null); return; }
  f.setActive(true);
  setTimeout(() => {
    const snap = f.snapshot();
    f.setActive(false);
    res(snap);
  }, ${ms});
})`;

// ─── Boot / settle / sample ──────────────────────────────────────────────────────────────────
async function bootPose(b) {
  const pose = POSES[b.pose];
  if (bootScriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: bootScriptId }).catch(() => {});
  bootScriptId = (await send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT_SCRIPT(b.ultra, CORES_FOR_TIER[b.tier]) })).identifier;
  if (DEVICE) {
    // A real phone measures itself: no metrics or touch emulation, ever.
  } else if (pose.kind === "m") {
    // The qaslice-cab recipe: emulation BEFORE navigate (readDeviceCaps reads matchMedia once).
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  } else {
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: DSF, mobile: false });
  }
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  const t0 = Date.now();
  await send("Page.navigate", { url: pose.url });
  await waitFor(`!!(window.__globe && window.__globe.camera && window.__renderer && window.__quality && window.__globeQuality && window.__globe.u5)`, 120_000, "globe seams");
  // Pin the governor NOW, before the boot stream (EMA 100–160 ms for the first seconds at a heavy
  // pose) can demote the tier: a later re-force would replay the tier's renderer half — a DPR
  // realloc + a fresh-instance rebuild of every composite — inside the window being measured.
  if (b.tier !== "auto") await evalJs(PIN_GOVERNOR(b.tier)); // a real phone's governor is part of what is measured
  await send("Page.bringToFront");
  if (pose.kind !== "m") {
    await evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`);
  }
  await waitFor(`!window.__globe.flight || !window.__globe.flight.active()`, 60_000, "flight settled");
  if (pose.kind === "fpv") await waitFor(`!!window.__globe.fpv && window.__globe.fpv().active`, 60_000, "FPV active");
  const bootMs = Date.now() - t0;
  const q = await evalJs(QUAL);
  return { bootMs, q };
}
async function settle() {
  const t0 = Date.now();
  let quietSince = null;
  let last = null;
  while (Date.now() - t0 < SETTLE_MAX_MS) {
    last = await evalJs(BUSY);
    if (last.busy === 0 && last.modelsLoading === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= 2000) return { settleMs: Date.now() - t0, capped: false, visible: last.visible };
    } else quietSince = null;
    await sleep(250);
  }
  return { settleMs: Date.now() - t0, capped: true, visible: last?.visible ?? null, busy: last?.busy ?? null };
}
async function sampleCell(b, shadowsMode, extra) {
  const id = `${b.id}.${shadowsMode}`;
  await ticks(6);
  const pinned = b.tier === "auto" ? false : await evalJs(PIN_GOVERNOR(b.tier));
  await ticks(3);
  const st = await settle();
  const qStart = await evalJs(QUAL);
  const s = await evalJs(SAMPLER(SAMPLE_MS));
  const feed = await evalJs(FEED_SAMPLE(FEED_MS));
  const qEnd = await evalJs(QUAL);
  const um = await evalJs(`(() => { try { const u = window.__globe.userModels ? window.__globe.userModels() : null; return u ? { world: u.world, resident: u.resident, loading: u.loading, skipped: u.skipped, tris: u.tris, failed: u.failed, visible: u.visible } : null; } catch (e) { return { err: String(e) }; } })()`);
  const look = await evalJs(`(() => { try { const l = window.__globe.ultraLook(); return { on: l.on, casting: l.shadow.casting, mapPx: l.shadow.mapPx, boundsM: l.shadow.boundsM, mPerTexel: l.shadow.metresPerTexel, cascades: (l.cascades || []).map((c) => ({ casting: c.casting, active: c.active, boundsM: c.boundsM, mPerTexel: c.metresPerTexel })), terrainCasting: l.terrain ? l.terrain.casting : null }; } catch (e) { return { err: String(e) }; } })()`);
  const shadowState = await evalJs(`(() => { const r = window.__renderer; return { enabled: r.shadowMap.enabled, autoUpdate: r.shadowMap.autoUpdate, type: r.shadowMap.type }; })()`);
  const row = {
    id,
    label: LABEL,
    dsf: DSF,
    pose: b.pose,
    ultraPref: b.ultra,
    tierRequested: b.tier,
    modelsRequested: b.N,
    seeded: seedIds.length,
    shadows: shadowsMode,
    ...extra,
    settle: st,
    pinned,
    q: { start: qStart, end: qEnd },
    frame: s,
    feed,
    models: um,
    look,
    shadowState,
  };
  results.push(row);
  writeArtefacts(); // every cell lands on disk the moment it exists
  const fk = (k) => (feed && typeof feed[k] === "number" ? feed[k] : null);
  console.log(
    `  ${id.padEnd(30)} dt ${fmt(s.dtP50)}/${fmt(s.dtP95)} ms  fps ${fmt(s.fps, 0)}  cpu ${fmt(fk("frame.cpu.p50"))}  draw ${fmt(fk("frame.draw.p50"))}  gpu ${fmt(fk("frame.gpu.p50"))}  calls ${fmtI(s.calls)}  tris ${fmtI(s.tris)}  heap ${fmt(s.jsHeapMB, 0)} MB  tier ${qStart.tier}/${qEnd.tier}  dpr ${qStart.dpr}  shadow ${qStart.shadowMapPx}px${look.casting ? " casting" : ""}  models ${um ? `${um.resident}/${um.world}` : "—"}  settle ${st.settleMs} ms${st.capped ? " (CAPPED)" : ""}`,
  );
  // Structural assertions — the numbers are reported, these are the conditions under which they mean anything.
  check(`${id}: sampled ≥ 60 frames (rAF alive)`, !s.rafStalled && s.frames >= 60, s.rafStalled ? `rAF STALLED after ${s.frames} frames (visibility ${s.visibility}, focus ${s.hasFocus})` : `${s.frames}`);
  if (s.rafStalled) return row;
  check(`${id}: RC21 gate off — every frame drew`, s.gateEnabled === false && (s.gateSkips === 0 || s.gateSkips === null), `enabled=${s.gateEnabled} skips=${s.gateSkips}`);
  if (b.tier === "auto") note(`${id}: device tier ${qStart.deviceTier}, governor ${qStart.tier}→${qEnd.tier}, dpr ${qStart.dpr}, lean ${qStart.lean}, gpu ${qStart.gpu}`);
  else check(`${id}: tier held for the whole window`, qStart.tier === qEnd.tier && qStart.tier === b.tier, `${qStart.tier}→${qEnd.tier} (device ${qStart.deviceTier})`);
  if (b.N > 0) check(`${id}: ${b.N} models resident, none skipped`, um && um.resident === b.N && um.skipped === 0 && um.loading === 0, JSON.stringify(um));
  return row;
}

// ─── Artefacts (written after EVERY cell — a crash at boot 9 of 26 must not lose boots 1–8) ───
const f = (r, k) => (r.feed && typeof r.feed[k] === "number" ? r.feed[k] : null);
const jsonPath = `${OUT_DIR}/baseline-${LABEL}-dsf${DSF}-${STAMP}.json`;
const mdPath = `${OUT_DIR}/baseline-${LABEL}-dsf${DSF}-${STAMP}.md`;
const bootFailures = [];
let env = null;
const runT0 = Date.now();
function writeArtefacts() {
  const runMin = ((Date.now() - runT0) / 60000).toFixed(1);
  writeFileSync(jsonPath, JSON.stringify({ stamp: STAMP, label: LABEL, dsf: DSF, env, args, runMin, notes, bootFailures, crashEvents, consoleErrors: consoleErrors.slice(0, 20), results }, null, 2));
  const lines = [];
  lines.push(`| cell | tier (dev) | dpr | shadow px | models res/world | settle s | fps | dt p50 / p95 ms | cpu p50 | draw p50 | gpu p50 | calls | tris | heap MB | geom / tex / prog | bld/gnd/enr lruMB | visible bld/gnd/enr | composites | terrain epoch/s | memo hit·miss /s | deferred/rej /s | seatEpoch/s | hitches |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of results) {
    const s = r.frame;
    lines.push(
      `| ${r.id} | ${r.q.start.tier} (${r.q.start.deviceTier}) | ${r.q.start.dpr} | ${r.q.start.shadowMapPx}${r.look?.casting ? "·cast" : ""}${r.shadows === "noUpdate" ? "·noUpd" : r.shadows === "off" || r.shadows === "offBoot" ? "·OFF" : r.shadows === "aoOff" ? "·AO off" : r.shadows === "bloomOff" ? "·bloom off" : ""} | ${r.models && r.models.resident !== undefined ? `${r.models.resident}/${r.models.world}` : "—"} | ${(r.settle.settleMs / 1000).toFixed(1)}${r.settle.capped ? "!" : ""} | ${fmt(s.fps, 0)} | ${fmt(s.dtP50)} / ${fmt(s.dtP95)} | ${fmt(f(r, "frame.cpu.p50"))} | ${fmt(f(r, "frame.draw.p50"))} | ${fmt(f(r, "frame.gpu.p50"))} | ${fmtI(s.calls)} | ${fmtI(s.tris)} | ${fmt(s.jsHeapMB, 0)} | ${fmtI(s.infoGeometries)} / ${fmtI(s.infoTextures)} / ${fmtI(s.infoPrograms)} | ${fmt(f(r, "tiles.bld.lruMB"), 0)}/${fmt(f(r, "tiles.gnd.lruMB"), 0)}/${fmt(f(r, "tiles.enr.lruMB"), 0)} | ${fmtI(f(r, "tiles.bld.visible"))}/${fmtI(f(r, "tiles.gnd.visible"))}/${fmtI(f(r, "tiles.enr.visible"))} | ${fmtI(f(r, "tiles.img.composites"))} | ${fmt(s.rates?.terrainEpochPerS, 2)} | ${fmt(s.rates?.memoHitsPerS, 0)}·${fmt(s.rates?.memoMissesPerS, 0)} | ${fmt(s.rates?.deferredPerS, 1)}/${fmt(s.rates?.rejectedPerS, 1)} | ${fmt(s.rates?.seatEpochPerS, 1)} | ${s.hitches} |`,
    );
  }
  writeFileSync(
    mdPath,
    `# T77 perf baseline — ${LABEL} profile — dsf ${DSF} — ${STAMP}\n\nenv: ${JSON.stringify(env)}  run ${runMin} min  args ${args.join(" ")}\n\n${lines.join("\n")}\n\n${notes.map((n) => `- ${n}`).join("\n")}\n${bootFailures.map((b) => `- BOOT FAILED ${b.id}: ${b.error}`).join("\n")}\n`,
  );
  return runMin;
}

// ─── The run ─────────────────────────────────────────────────────────────────────────────────
console.log(`T77 MEASURE — perf baseline  port ${PORT}  label ${LABEL}  quick ${QUICK}  models ${MODEL_STEPS.join("/")}  settle≤${SETTLE_MAX_MS / 1000}s  sample ${SAMPLE_MS / 1000}s  feed ${FEED_MS / 1000}s`);
const boots = buildBoots();
console.log(`boots: ${boots.length}  → ${boots.map((b) => b.id).join(" ")}`);
let worldBaseline = null; // real member models resident near the eye before any seed (read at the first boot)
try {
  let currentN = -1;
  for (const b of boots) {
    try {
    if (b.N !== currentN) {
      const want = Math.max(0, b.N - (worldBaseline ?? 0));
      if (want > seedIds.length) {
        if (worldBaseline === null) note(`world baseline unknown before the first boot — seeding the full ${b.N}`);
        await seedTo(want);
        console.log(`seeded ${seedIds.length} model rows for N=${b.N} (world baseline ${worldBaseline ?? "?"}; journal ${SEED_JOURNAL})`);
      }
      currentN = b.N;
    }
    console.log(`\n=== BOOT ${b.id} ===`);
    const { bootMs, q } = await bootPose(b);
    env ??= { gpu: q.gpu, cores: q.cores, dsf: DEVICE ? "device" : DSF, device: DEVICE, ua: (await send("Browser.getVersion").catch(() => null))?.userAgent ?? null, screen: await evalJs(`({ w: screen.width, h: screen.height, dpr: devicePixelRatio, inner: [innerWidth, innerHeight], coarse: matchMedia("(pointer: coarse)").matches, mem: navigator.deviceMemory ?? null })`) };
    if (worldBaseline === null && b.N === 0 && POSES[b.pose].models) {
      await settle();
      const um = await evalJs(`(() => { try { const u = window.__globe.userModels(); return u ? { world: u.world, resident: u.resident } : null; } catch { return null; } })()`);
      worldBaseline = um?.resident ?? 0;
      note(`world baseline at ${b.pose}: ${um ? `${um.resident} resident / ${um.world} in cover` : "unreadable"} real member models — N counts TOTAL resident, seeds add N − ${worldBaseline}`);
    }
    console.log(`  booted in ${bootMs} ms  device ${q.deviceTier} (cores ${q.cores})  tier ${q.tier}  dpr ${q.dpr}  ultraBoot ${q.ultraBoot}  shadow ${q.shadowMapPx}px  lean ${q.lean}`);
    if (b.tier !== "auto") check(`${b.id}: device tier as forced`, q.deviceTier === b.tier, `${q.deviceTier} (cores ${q.cores})`);
    // On a coarse-pointer device the ULTRA pref is REFUSED at boot (`ultraShellAllowed`): the boot
    // asserts the refusal — the mobile fence proof — rather than an 8192² rig.
    check(`${b.id}: ULTRA boot pref ${DEVICE && q.lean ? "REFUSED on a coarse pointer" : "as requested"}`, DEVICE && q.lean ? q.ultraBoot === false : q.ultraBoot === b.ultra, `ultraBoot=${q.ultraBoot} lean=${q.lean}`);
    if (b.pose === "m" && !DEVICE) check(`${b.id}: /m is the coarse-pointer lean profile`, q.lean === true, `lean=${q.lean}`);
    const shadowsOnAtBoot = await evalJs(`window.__renderer.shadowMap.enabled`);
    await sampleCell(b, shadowsOnAtBoot ? "on" : "offBoot", { bootMs });
    if (POST_AB && (b.pose !== "m" || DEVICE)) {
      // The two POST-PROCESS A/Bs (each restored before the next): GTAO (high tier + low altitude
      // only — `__quality.ao` is the live GTAOPass, null when AO is off) and bloom. Both are pure
      // GPU levers, so their deltas split the GPU timer between geometry and post.
      // Both enables are REWRITTEN by the engine (bloom every frame in the tick, AO on every tier
      // apply — which the governor pin's re-force triggers), so a plain assignment lasts a frame:
      // a getter trap holds the pass off for the sample and is deleted after (the
      // probe-render-defects.mjs idiom for the cascades' castShadow).
      const TRAP = (expr, on) => `(() => { const p = ${expr}; if (!p) return false; if (${on}) { delete p.enabled; p.enabled = true; return true; } Object.defineProperty(p, "enabled", { get: () => false, set: () => {}, configurable: true }); return true; })()`;
      const AO = `(window.__quality && window.__quality.ao)`;
      const BLOOM = `(window.__composer && window.__composer.passes.find((x) => x.constructor && /Bloom/.test(x.constructor.name)))`;
      const hasAo = await evalJs(`!!(${AO} && ${AO}.enabled)`);
      if (hasAo) {
        await evalJs(TRAP(AO, false));
        await sampleCell(b, "aoOff", { bootMs });
        await evalJs(TRAP(AO, true));
      }
      const bloomOn = await evalJs(`(() => { const p = ${BLOOM}; return p ? p.enabled : null; })()`);
      if (bloomOn === true) {
        await evalJs(TRAP(BLOOM, false));
        await sampleCell(b, "bloomOff", { bootMs });
        await evalJs(TRAP(BLOOM, true));
      }
    }
    if (shadowsOnAtBoot && (b.pose !== "m" || DEVICE)) {
      // The PASS cost alone: skip the depth pass, keep sampling the (stale) map.
      await evalJs(`window.__renderer.shadowMap.autoUpdate = false, true`);
      await sampleCell(b, "noUpdate", { bootMs });
      await evalJs(`window.__renderer.shadowMap.autoUpdate = true, true`);
      // The WHOLE shadow cost: one full material recompile, then no shadow work at all.
      await evalJs(`window.__renderer.shadowMap.enabled = false, true`);
      await sleep(4000); // the recompile hitch stays out of the window
      await sampleCell(b, "off", { bootMs });
    }
    } catch (e) {
      // A hung or crashed renderer at ONE pose is a FINDING about that pose, not the end of the
      // run: record it, replace the target, carry on. (VerifyFailure from a structural check is
      // also caught here — it is recorded under the boot it belongs to.)
      const msg = e instanceof Error ? e.message : String(e);
      bootFailures.push({ id: b.id, error: msg, crashEvents: crashEvents.splice(0) });
      failures++;
      console.log(`BOOT FAILED  ${b.id}: ${msg} — replacing the target and continuing`);
      writeArtefacts();
      await attach();
    }
    writeArtefacts();
  }
} finally {
  const removed = await unseedAll();
  if (removed > 0) console.log(`\nfinally  removed ${removed} seeded model rows`);
}

const runMin = writeArtefacts();
console.log(`\nwrote ${jsonPath}\nwrote ${mdPath}\n${results.length} cells in ${runMin} min · ${failures} structural failure(s) · ${bootFailures.length} boot failure(s)`);
await finishVerify(failures === 0 ? 0 : 1);
