#!/usr/bin/env node
/**
 * T77 step 1 — MEASURE: the two TEMPORAL-STABILITY metrics the harnesses never had (2026-09-05).
 *
 * ENGINE_STATE §8 named the gap: "no harness asserts temporal stability; every shadow harness
 * is a pose ladder", and no reseat has ever been timed — "reseat off-cone takes tens of
 * seconds" is CONTESTED in §12 until measured. This script adds both instruments. They become
 * the GATES of the shadow slice (A) and the seat slice (B); this session records their
 * BASELINES, the thresholds are frozen from these numbers afterwards (the plan §3).
 *
 *   node scripts/verify-temporal-stability.mjs [PORT] [--shimmer] [--reseat] [--frames 600]
 *        [--step 2000] [--px 640] [--only <regex>] [--label warm|cold] [--owner <email>]
 *
 * (no leg flag = both legs). Preconditions as `verify-perf-baseline.mjs`: `wix dev` on :4321,
 * the owner's HEADED CDP Chrome on :9222 (never killed), Node ≥ 22. Never alongside another
 * timed harness (a second GPU client halves what the first one measures).
 *
 * ── A. SHIMMER — the shadow-mask pixel delta between adjacent frames, static camera, sun scrub
 *
 * The mask is taken by an A/B INSIDE ONE rAF: the frame the engine just drew (A, shadows) is
 * grabbed; every shadow's `shadow.intensity` — a plain float uniform, `mix(1.0, shadow,
 * shadowIntensity)` in three's shadowmap chunk, no recompile — is set to 0, the composer
 * re-renders with the depth pass skipped (`shadowMap.autoUpdate=false`, the map just rendered
 * is reused), B is grabbed, intensity is restored and the frame re-rendered for the compositor.
 * `mask = |luma(A) − luma(B)| > 4/255` is therefore the SCREEN-SPACE SHADOW MASK and nothing else:
 * sky, haze, exposure, key colour, hemisphere, star ramp — everything the sun ALSO moves — cancel
 * by construction (they are identical in A and B). Adjacent masks are then XORed:
 *   churn_k = |mask_k ⊕ mask_{k−1}| / |mask_k ∪ mask_{k−1}|     (the fraction of the shadow that flipped)
 *   speckle_k = isolated flips (no 4-neighbour) / flips             (acne vs coherent edge motion)
 * With the camera FROZEN, texel crawl from translation (mechanism 1) and the screen-space Vogel
 * noise (7) are silenced — what remains is DISCRETE change at a constant sun rate: the 1-Hz
 * ephemeris tread (11), extent-quantum re-rasterisation (2), cascade refreshes (5), the
 * cascade-0 seam (3), caster pop vs receiver crossfade (6). So the metric is a SPIKE detector on
 * a signal that should be smooth: report p50 / p95 / max churn and the ratios, not an absolute.
 * The sun is stepped by `setTime(t0 + k·STEP)` from inside the probe, STEP ≥ 2000 scene-ms so
 * the 1-scene-second resample dead-band (`SKY.sampleIntervalMs`) fires EVERY frame and the
 * angular rate is exact and dt-independent (0.0083°/frame at 2000 ms; `play()` would ride dt).
 * Legs: Dnipro FPV base rig · Dnipro city ULTRA (cascades) · Everest ULTRA (terrain casting),
 * each preceded by a FROZEN CONTROL (no scrub: churn must be exactly 0 — any nondeterminism
 * shows here first) and followed by a 4× STEP leg (rate-linearity: the signal must track the sun).
 *
 * ── B. RESEAT-SETTLE — frames from an arrival / a drag until every near seat is < 1 cm off
 *
 * Read through the new `__globe.seatSettle()` seam (this session): the per-frame residuals the
 * apply pass computes anyway — `nearMaxResidualM` / `nearMovedFeatures` over the RC7 look-cone
 * priority cells, and the city-wide twins. `settled` = near residual < 1 cm AND no near write,
 * held for `PLAN.reseatQuietFrames` consecutive frames (the engine's own quiet convention, read
 * from tuning in-page, never transcribed). The city-wide curve is REPORTED, not gated (§2.5: the
 * round-robin cannot clear 1 cm city-wide in a test window — the curve is what settles the
 * CONTESTED claim). Legs at the verify-usermodels ORBIT pose: arrival (boot → flight settled),
 * a scripted orbit DRAG (the verify-meshedit press/8-moves/release), and user models (seeded,
 * their own `seatM − appliedM`; models snap at MODELS.seatSnapM so they always clear 1 cm).
 * Frames, never ms: the eases have no dt term, so a 30 fps device doubles the wall time and
 * passes the same frame count.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = args.find((a) => /^\d+$/.test(a)) ?? "9222";
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const DO_SHIMMER = flag("--shimmer") || !flag("--reseat");
const DO_RESEAT = flag("--reseat") || !flag("--shimmer");
const FRAMES = Number(opt("--frames", "600"));
const STEP_MS = Number(opt("--step", "2000"));
const PX = Number(opt("--px", "640"));
const ONLY = opt("--only", null) ? new RegExp(opt("--only")) : null;
const LABEL = opt("--label", "warm");
const OWNER_EMAIL = opt("--owner", "yevhens@wix.com");
const DEV = "http://localhost:4321";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = "verify-shots/perf";
mkdirSync(OUT_DIR, { recursive: true });

const T_FPV = 1787133600000;
const T_ULTRA = Date.UTC(2026, 7, 21, 9, 40);
const EYE = { lat: 48.4647, lon: 35.0462 };
const POSES = {
  fpv: { url: `${DEV}/#f=48.4647,35.0462,1.7,25,8,60&t=${T_FPV}`, kind: "fpv" },
  orbit: { url: `${DEV}/#p=48.4647,35.0462,700,25,40&t=${T_FPV}`, kind: "orbit" },
  city: { url: `${DEV}/#p=48.464,35.046,900,74,300&t=${T_ULTRA}`, kind: "orbit" },
  everest: { url: `${DEV}/#p=27.87,86.83,11500,76,35&t=${T_ULTRA}`, kind: "orbit" },
};
const GLB = {
  url: "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb",
  glbBytes: 3_773_916,
  tris: 15_452,
  meshes: 1,
  textures: 5,
  bbox: [2, 2, 2],
};

// ─── CDP ─────────────────────────────────────────────────────────────────────────────────────
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
const CDP_TIMEOUT_MS = 120_000;
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => (pending.delete(id), rej(new Error(`CDP ${method} timed out`))), CDP_TIMEOUT_MS);
    pending.set(id, { res: (v) => (clearTimeout(timer), res(v)), rej: (e) => (clearTimeout(timer), rej(e)) });
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
  throw new VerifyFailure(`timed out waiting for: ${label}`);
};
const ticks = async (frames = 6) => {
  await send("Page.bringToFront");
  return evalJs(`new Promise((res) => { let n = 0; const step = () => (++n >= ${frames} ? res(n) : requestAnimationFrame(step)); requestAnimationFrame(step); })`);
};
const mouse = (type, x, y, opts = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", ...opts });
await send("Page.enable");
await send("Runtime.enable");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
};
const fmt = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? "—" : typeof v === "number" ? v.toFixed(d) : String(v));
const pct = (arr, p) => {
  const s = arr.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
};
const results = { stamp: STAMP, label: LABEL, args, shimmer: [], reseat: [] };

// ─── Boot (the baseline harness's recipe) ────────────────────────────────────────────────────
let bootScriptId = null;
async function boot(poseKey, ultra) {
  const pose = POSES[poseKey];
  if (bootScriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: bootScriptId }).catch(() => {});
  bootScriptId = (
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => { try { const k = "ftw:view-prefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.ultraQuality = ${ultra ? "true" : "false"}; o.debugHud = false; localStorage.setItem(k, JSON.stringify(o)); } catch {} })()`,
    })
  ).identifier;
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await send("Page.navigate", { url: pose.url });
  await waitFor(`!!(window.__globe && window.__globe.camera && window.__renderer && window.__composer && window.__globe.u5 && window.__globe.seatSettle && window.__timeStore && window.__debugFeed)`, 120_000, "globe seams");
  await send("Page.bringToFront");
  await evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`);
  await waitFor(`!window.__globe.flight || !window.__globe.flight.active()`, 60_000, "flight settled");
  if (pose.kind === "fpv") await waitFor(`!!window.__globe.fpv && window.__globe.fpv().active`, 60_000, "FPV active");
  const q = await evalJs(`(() => { const q = window.__globeQuality; return { tier: q.tier, dpr: q.dpr, ultraBoot: q.ultraBoot, shadowMapPx: q.shadowMapPx }; })()`);
  return q;
}
const BUSY = `(() => { const u = window.__globe.u5(); const q = (r) => r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0;
  let um = null; try { um = window.__globe.userModels ? window.__globe.userModels() : null; } catch {}
  return q(u.buildings) + q(u.ground) + q(u.enriched) + (um ? um.loading : 0); })()`;
async function settle(maxMs = 100_000, quietMs = 2000) { // the city pose streams ~3,300 ground tiles (≈85 s)
  const t0 = Date.now();
  let quietSince = null;
  while (Date.now() - t0 < maxMs) {
    const busy = await evalJs(BUSY);
    if (busy === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) return { settleMs: Date.now() - t0, capped: false };
    } else quietSince = null;
    await sleep(250);
  }
  return { settleMs: maxMs, capped: true };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A. SHIMMER
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const FREEZE = `(() => {
  const g = window.__globe;
  if (g.controls) g.controls.enabled = false;
  if (g.flight && typeof g.flight.cancel === "function") { try { g.flight.cancel(); } catch {} }
  const cs = window.__cameraStore && window.__cameraStore.getState();
  if (cs) { try { cs.setExplore(false); } catch {} try { cs.clearAllTargets(); } catch {} }
  if (window.__frameGate) window.__frameGate.enabled = false;
  return Array.from(g.camera.matrixWorld.elements);
})()`;
// The probe. Runs FRAMES rAF callbacks after the engine's own (registered later → runs later in
// the same frame, and each re-registration keeps that order). Returns per-frame rows.
const SHIMMER_PROBE = (frames, stepMs, px, controlOnly) => `new Promise((resolve, reject) => {
  const g = window.__globe, R = window.__renderer, C = window.__composer, T = window.__timeStore.getState();
  const feed = window.__debugFeed;
  const lights = [g.sunLight, ...(g.cascadeLights || [])].filter(Boolean);
  const src = R.domElement;
  const W = ${px}, H = Math.round(${px} * src.height / src.width);
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c.getContext("2d", { willReadFrequently: true }); };
  const ga = mk(), gb = mk();
  const N = W * H;
  let prev = null;
  const rows = [];
  const t0 = T.timeMs; // pinned by the pose's &t= (live:false) — the scrub steps from here
  const cam0 = Array.from(g.camera.matrixWorld.elements);
  let k = 0;
  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const tick = () => {
    try {
      const tFrame = performance.now();
      // A — the frame the engine just drew (same task: the drawing buffer is still valid).
      ga.drawImage(src, 0, 0, W, H);
      const A = ga.getImageData(0, 0, W, H).data;
      // B — the same frame with every shadow's intensity at 0 (a float uniform, no recompile),
      // the depth pass skipped (the map just rendered is reused). Then restore + re-render.
      const keep = lights.map((l) => l.shadow.intensity);
      const auto = R.shadowMap.autoUpdate;
      R.shadowMap.autoUpdate = false;
      for (const l of lights) l.shadow.intensity = 0;
      C.render();
      gb.drawImage(src, 0, 0, W, H);
      const B = gb.getImageData(0, 0, W, H).data;
      lights.forEach((l, i) => (l.shadow.intensity = keep[i]));
      C.render();
      R.shadowMap.autoUpdate = auto;
      const tAB = performance.now() - tFrame;
      // mask + flips
      const mask = new Uint8Array(N);
      let maskN = 0;
      for (let i = 0, p = 0; i < N; i++, p += 4) { if (Math.abs(luma(A, p) - luma(B, p)) > 4) { mask[i] = 1; maskN++; } }
      let flips = 0, union = 0, isolated = 0;
      if (prev) {
        const F = new Uint8Array(N);
        for (let i = 0; i < N; i++) { const f = mask[i] ^ prev[i]; F[i] = f; flips += f; union += mask[i] | prev[i]; }
        if (flips > 0) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!F[i]) continue;
          const n = (x > 0 && F[i - 1]) || (x < W - 1 && F[i + 1]) || (y > 0 && F[i - W]) || (y < H - 1 && F[i + W]); if (!n) isolated++; }
      }
      const u = feed ? feed.read("ultra") : null;
      rows.push({
        k, maskFrac: maskN / N, flips, union, churn: prev && union > 0 ? flips / union : (prev ? 0 : null), speckle: flips > 0 ? isolated / flips : null,
        sampleMs: g.bodies().sampleMs, sunElev: u ? u.sunElevDeg : null,
        boundsM: u ? u["shadow.boundsM"] : null, mPerTexel: u ? u["shadow.mPerTexel"] : null,
        cas1Age: u ? u["cas1.ageMs"] : null, cas2Age: u ? u["cas2.ageMs"] : null, casting: u ? u["shadow.casting"] : null,
        abMs: tAB,
      });
      prev = mask;
      k++;
      if (k >= ${frames}) {
        const cam1 = Array.from(g.camera.matrixWorld.elements);
        resolve({ rows, W, H, cam0, cam1, camFrozen: cam0.every((v, i) => v === cam1[i]), lights: lights.length, t0 });
        return;
      }
      ${controlOnly ? "" : "T.setTime(t0 + (k + 1) * " + stepMs + ");"}
      requestAnimationFrame(tick);
    } catch (e) { reject(e); }
  };
  requestAnimationFrame(tick);
})`;

async function shimmerLeg(poseKey, ultra, label) {
  const id = `${poseKey}.u${ultra ? 1 : 0}`;
  if (ONLY && !ONLY.test(id)) return;
  console.log(`\n=== SHIMMER ${id} (${label}) ===`);
  const q = await boot(poseKey, ultra);
  const st = await settle();
  check(`${id}: ULTRA boot pref as requested`, q.ultraBoot === ultra, JSON.stringify(q));
  await evalJs(FREEZE);
  await ticks(10);
  await settle(20_000, 1500);
  const sunElev = await evalJs(`(() => { const u = window.__debugFeed.read("ultra"); return u ? u.sunElevDeg : null; })()`);
  const casting = await evalJs(`window.__globe.sunLight.castShadow`);
  check(`${id}: sun above the fade band (≥ 10°) and casting`, sunElev !== null && sunElev >= 10 && casting === true, `elev ${fmt(sunElev, 1)}° casting ${casting}`);
  const tuning = await evalJs(`(async () => { const t = await import("/src/components/globe/tuning.ts"); return { sampleIntervalMs: t.SKY.sampleIntervalMs, cascadeMaxStaleMs: t.ULTRA.cascadeMaxStaleMs ?? null, gateEnabled: t.GATE.enabled }; })()`);
  const legs = [
    { name: "control", frames: Math.min(FRAMES, 240), step: 0, control: true },
    { name: "scrub", frames: FRAMES, step: STEP_MS, control: false },
    { name: "scrub4x", frames: Math.min(FRAMES, 300), step: STEP_MS * 4, control: false },
  ];
  const out = { id, pose: poseKey, ultra, label, q, settle: st, sunElev, tuning, legs: {} };
  for (const leg of legs) {
    await ticks(4);
    const r = await evalJs(SHIMMER_PROBE(leg.frames, leg.step, PX, leg.control));
    const rows = r.rows.slice(1); // the first row has no predecessor
    const churn = rows.map((x) => x.churn);
    const nz = churn.filter((c) => c !== null && c > 0);
    const speckle = rows.map((x) => x.speckle).filter((x) => x !== null);
    const sunMoved = rows.length > 1 ? rows[rows.length - 1].sunElev - rows[0].sunElev : 0;
    const resamples = rows.filter((x, i) => i > 0 && x.sampleMs !== rows[i - 1].sampleMs).length;
    const boundsSteps = rows.filter((x, i) => i > 0 && x.boundsM !== rows[i - 1].boundsM).length;
    const p50 = pct(churn, 0.5), p95 = pct(churn, 0.95), max = pct(churn, 1);
    const summary = {
      frames: rows.length, maskFracP50: pct(rows.map((x) => x.maskFrac), 0.5), churnP50: p50, churnP95: p95, churnMax: max,
      p95OverP50: p50 ? p95 / p50 : null, maxOverP50: p50 ? max / p50 : null, framesWithFlips: nz.length,
      speckleP50: pct(speckle, 0.5), sunMovedDeg: sunMoved, resamples, boundsSteps, abMsP50: pct(rows.map((x) => x.abMs), 0.5),
      camFrozen: r.camFrozen, lights: r.lights, W: r.W, H: r.H,
    };
    out.legs[leg.name] = { summary, rows: r.rows };
    console.log(`  ${leg.name.padEnd(8)} frames ${summary.frames}  mask ${fmt(summary.maskFracP50, 3)}  churn p50 ${fmt(p50, 4)} p95 ${fmt(p95, 4)} max ${fmt(max, 4)}  flips>0 in ${nz.length} frames  speckle p50 ${fmt(summary.speckleP50, 2)}  sun ${sunMoved >= 0 ? "+" : ""}${fmt(sunMoved, 3)}°  resamples ${resamples}  extent steps ${boundsSteps}  A/B ${fmt(summary.abMsP50, 1)} ms  camFrozen ${r.camFrozen}`);
    check(`${id}/${leg.name}: camera frozen for the whole leg`, r.camFrozen === true);
    check(`${id}/${leg.name}: a shadow mask exists (the A/B sees shadows)`, summary.maskFracP50 !== null && summary.maskFracP50 > 0.002, `mask ${fmt(summary.maskFracP50, 4)}`);
    if (leg.control) {
      check(`${id}/control: NO churn with sun and camera frozen (determinism)`, max === 0, `max churn ${fmt(max, 5)} over ${rows.length} frames`);
    } else {
      // The sun may be DESCENDING at the pose's instant (the FPV instant is local afternoon) —
      // the magnitude is what proves the scrub landed, never the sign.
      check(`${id}/${leg.name}: the sun actually moved (resample every frame)`, Math.abs(sunMoved) > 0 && resamples >= rows.length * 0.9, `${sunMoved >= 0 ? "+" : ""}${fmt(sunMoved, 3)}°, ${resamples}/${rows.length} resamples`);
    }
  }
  const s1 = out.legs.scrub?.summary, s4 = out.legs.scrub4x?.summary;
  if (s1 && s4 && s1.churnP50) {
    const ratio = s4.churnP50 / s1.churnP50;
    out.rateLinearity = ratio;
    console.log(`  rate-linearity: churn p50 at 4× step / 1× step = ${fmt(ratio, 2)} (tracks the sun if ≈ 4; noise if ≈ 1)`);
  }
  results.shimmer.push(out);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B. RESEAT-SETTLE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const RESEAT_PROBE = (maxFrames, quietFrames) => `new Promise((resolve, reject) => {
  const g = window.__globe;
  const rows = [];
  let k = 0, quiet = 0, firstQuiet = null, settled = null, cityUnder1cm = null, cityUnder10cm = null;
  const t0 = performance.now(); let last = t0;
  const tick = () => {
    try {
      const n = performance.now();
      const s = g.seatSettle();
      const e = s.enriched;
      let modelResid = null;
      try { const um = g.userModels ? g.userModels() : null; if (um) for (const m of um.models) if (m.state === "ready" && m.seatM != null && m.appliedM != null) modelResid = Math.max(modelResid ?? 0, Math.abs(m.seatM - m.appliedM)); } catch {}
      const u5 = g.u5();
      const gnd = u5.ground;
      rows.push({ k, dt: n - last, frameCount: s.frameCount, terrainEpoch: s.terrainEpoch,
        near: e ? e.nearMaxResidualM : null, nearMoved: e ? e.nearMovedFeatures : null, nearCells: e ? e.nearCells : null,
        city: e ? e.maxResidualM : null, moved: e ? e.movedFeatures : null, seatEpoch: e ? e.epoch : null, quietFrames: e ? e.quietFrames : null,
        deferred: e ? e.deferred : null, rejected: e ? e.rejected : null, modelResid,
        gndParse: gnd.parse.len, gndDl: gnd.dl.len, gndVisible: gnd.stats.visible, enrParse: u5.enriched ? u5.enriched.parse.len : 0 });
      last = n;
      const nearOk = e && e.nearMaxResidualM < 0.01 && e.nearMovedFeatures === 0;
      if (nearOk) { if (firstQuiet === null) firstQuiet = k; quiet++; if (settled === null && quiet >= ${quietFrames}) settled = k; } else quiet = 0;
      if (e && cityUnder1cm === null && e.maxResidualM < 0.01) cityUnder1cm = k;
      if (e && cityUnder10cm === null && e.maxResidualM < 0.10) cityUnder10cm = k;
      k++;
      if (k >= ${maxFrames} || (settled !== null && cityUnder1cm !== null && k > settled + 30)) { resolve({ rows, firstQuiet, settled, cityUnder1cm, cityUnder10cm }); return; }
      requestAnimationFrame(tick);
    } catch (e) { reject(e); }
  };
  requestAnimationFrame(tick);
})`;
function summarizeReseat(r, quietFrames) {
  const rows = r.rows;
  const epochBumps = rows.filter((x, i) => i > 0 && x.terrainEpoch !== rows[i - 1].terrainEpoch).length;
  const writesFrac = rows.filter((x) => x.moved > 0).length / Math.max(1, rows.length);
  const nearWritesFrac = rows.filter((x) => x.nearMoved > 0).length / Math.max(1, rows.length);
  const streamingQuietAt = rows.findIndex((x) => x.gndParse === 0 && x.gndDl === 0 && x.enrParse === 0);
  const modelSettled = rows.findIndex((x) => x.modelResid !== null && x.modelResid < 0.01);
  return {
    frames: rows.length, quietFrames, firstQuiet: r.firstQuiet, settled: r.settled, cityUnder10cm: r.cityUnder10cm, cityUnder1cm: r.cityUnder1cm,
    nearP50: pct(rows.map((x) => x.near), 0.5), nearMax: pct(rows.map((x) => x.near), 1),
    cityP50: pct(rows.map((x) => x.city), 0.5), cityP95: pct(rows.map((x) => x.city), 0.95), cityMax: pct(rows.map((x) => x.city), 1),
    cityAtEnd: rows.length ? rows[rows.length - 1].city : null, writesFrac, nearWritesFrac, epochBumps, streamingQuietAt,
    movedP50: pct(rows.map((x) => x.moved), 0.5), rejectedDelta: rows.length ? rows[rows.length - 1].rejected - rows[0].rejected : null,
    deferredDelta: rows.length ? rows[rows.length - 1].deferred - rows[0].deferred : null, modelSettledAt: modelSettled < 0 ? null : modelSettled,
    modelResidMax: pct(rows.map((x) => x.modelResid), 1), dtP50: pct(rows.map((x) => x.dt), 0.5),
  };
}
const seedIds = [];
const seedJournal = `${OUT_DIR}/seeds-temporal-${STAMP}.json`;
const devSeed = async (i, N) => {
  const bearing = ((360 * i) / N + 15) * (Math.PI / 180);
  const rad = 20 + 40 * (((i * 7) % N) / N);
  const lat = EYE.lat + (rad * Math.cos(bearing)) / 111_320;
  const lon = EYE.lon + (rad * Math.sin(bearing)) / (111_320 * Math.cos((EYE.lat * Math.PI) / 180));
  const r = await fetch(`${DEV}/api/dev-seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "model", ownerEmail: OWNER_EMAIL, model: { fileId: `plux-t77-temporal-${STAMP}-${i}.glb`, thumbnailFileId: null, title: `T77 temporal ${i}`, fileName: null, sourceFormat: "glb", rawBytes: null, glbBytes: GLB.glbBytes, tris: GLB.tris, meshes: GLB.meshes, textures: GLB.textures, decimatedFromTris: null, bbox: GLB.bbox, lat, lon, url: GLB.url } }),
  });
  const body = await r.json().catch(() => null);
  if (r.status !== 200 || !body?.modelId) throw new VerifyFailure(`dev-seed ${i} → ${r.status} ${JSON.stringify(body)}`);
  seedIds.push(body.modelId);
  writeFileSync(seedJournal, JSON.stringify({ stamp: STAMP, ids: seedIds }, null, 2));
};
const unseedAll = async () => {
  let n = 0;
  for (const id of seedIds.splice(0)) {
    const r = await fetch(`${DEV}/api/dev-seed?kind=model&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const b = await r.json().catch(() => null);
    if (b?.deleted === true) n++;
    else console.error(`  seed ${id} NOT removed: ${r.status} ${JSON.stringify(b)}`);
  }
  writeFileSync(seedJournal, JSON.stringify({ stamp: STAMP, ids: seedIds }, null, 2));
  return n;
};

async function reseatLegs() {
  const maxFrames = Math.max(600, FRAMES * 3);
  // ── arrival ──
  if (!ONLY || ONLY.test("reseat.arrival")) {
    console.log(`\n=== RESEAT arrival (orbit pose) ===`);
    await boot("orbit", false);
    const quietFrames = await evalJs(`(async () => { const t = await import("/src/components/globe/tuning.ts"); return t.PLAN.reseatQuietFrames; })()`);
    const easeK = await evalJs(`(async () => { const t = await import("/src/components/globe/tuning.ts"); return { reseatEaseK: t.ENRICHED.reseatEaseK, perFrame: t.ENRICHED.reseatFeatureSamplesPerFrame, trees: t.ENRICHED.reseatTreeSamplesPerFrame, cells: t.ENRICHED.reseatSamplesPerFrame, priorityEvery: t.ENRICHED.reseatPriorityEveryFrames, modelEase: t.MODELS.seatEaseK, modelSnap: t.MODELS.seatSnapM }; })()`);
    await ticks(2);
    const r = await evalJs(RESEAT_PROBE(maxFrames, quietFrames));
    const s = summarizeReseat(r, quietFrames);
    results.reseat.push({ leg: "arrival", tuning: easeK, summary: s, rows: r.rows });
    console.log(`  frames ${s.frames}  streaming quiet @${s.streamingQuietAt}  near firstQuiet @${s.firstQuiet} settled(${quietFrames}q) @${s.settled}  city <10cm @${s.cityUnder10cm} <1cm @${s.cityUnder1cm}  city p50/p95/max ${fmt(s.cityP50, 2)}/${fmt(s.cityP95, 2)}/${fmt(s.cityMax, 2)} m  end ${fmt(s.cityAtEnd, 3)} m  writes in ${(s.writesFrac * 100).toFixed(0)}% of frames (near ${(s.nearWritesFrac * 100).toFixed(0)}%)  epoch bumps ${s.epochBumps}  rejected +${s.rejectedDelta}  dt p50 ${fmt(s.dtP50, 1)}`);
    check(`arrival: the seam reads (enriched attached, near cells ranked)`, r.rows.some((x) => x.near !== null && x.nearCells > 0));
  }
  // ── drag ──
  if (!ONLY || ONLY.test("reseat.drag")) {
    console.log(`\n=== RESEAT drag (orbit pose, the meshedit press/8-moves/release) ===`);
    await boot("orbit", false);
    await settle();
    const quietFrames = await evalJs(`(async () => { const t = await import("/src/components/globe/tuning.ts"); return t.PLAN.reseatQuietFrames; })()`);
    // A settled pre-read so the drag's own effect is what we time.
    const pre = await evalJs(`window.__globe.seatSettle()`);
    const x0 = 800, y0 = 560;
    await mouse("mouseMoved", x0, y0, { buttons: 0 });
    await sleep(60);
    await mouse("mousePressed", x0, y0, { buttons: 1, clickCount: 1 });
    await sleep(40);
    for (let i = 1; i <= 8; i++) {
      await mouse("mouseMoved", x0 + i * 27, y0 + i * 6, { buttons: 1 });
      await sleep(40);
    }
    await mouse("mouseReleased", x0 + 8 * 27, y0 + 8 * 6, { buttons: 0 });
    const r = await evalJs(RESEAT_PROBE(maxFrames, quietFrames));
    const s = summarizeReseat(r, quietFrames);
    results.reseat.push({ leg: "drag", pre, summary: s, rows: r.rows });
    console.log(`  frames ${s.frames}  streaming quiet @${s.streamingQuietAt}  near firstQuiet @${s.firstQuiet} settled(${quietFrames}q) @${s.settled}  city <10cm @${s.cityUnder10cm} <1cm @${s.cityUnder1cm}  city p50/p95/max ${fmt(s.cityP50, 2)}/${fmt(s.cityP95, 2)}/${fmt(s.cityMax, 2)} m  end ${fmt(s.cityAtEnd, 3)} m  writes in ${(s.writesFrac * 100).toFixed(0)}% of frames (near ${(s.nearWritesFrac * 100).toFixed(0)}%)  epoch bumps ${s.epochBumps}  rejected +${s.rejectedDelta}  dt p50 ${fmt(s.dtP50, 1)}`);
    check(`drag: the camera moved (the drag landed)`, (await evalJs(`window.__globe.seatSettle().frameCount`)) > pre.frameCount);
  }
  // ── models ──
  if (!ONLY || ONLY.test("reseat.models")) {
    console.log(`\n=== RESEAT models (FPV eye, 6 seeded rows) ===`);
    try {
      for (let i = 0; i < 6; i++) await devSeed(i, 6);
      await sleep(1500);
      await boot("fpv", false);
      const quietFrames = await evalJs(`(async () => { const t = await import("/src/components/globe/tuning.ts"); return t.PLAN.reseatQuietFrames; })()`);
      await ticks(2);
      const r = await evalJs(RESEAT_PROBE(maxFrames, quietFrames));
      const s = summarizeReseat(r, quietFrames);
      const um = await evalJs(`(() => { const u = window.__globe.userModels(); return { world: u.world, resident: u.resident, loading: u.loading, skipped: u.skipped }; })()`);
      results.reseat.push({ leg: "models", summary: s, models: um, rows: r.rows });
      console.log(`  frames ${s.frames}  models ${JSON.stringify(um)}  model residual max ${fmt(s.modelResidMax, 3)} m  models <1cm @${s.modelSettledAt}  near settled @${s.settled}  city <1cm @${s.cityUnder1cm}`);
      check(`models: the seeded rows became resident`, um.resident >= 6 && um.loading === 0, JSON.stringify(um));
    } finally {
      const n = await unseedAll();
      console.log(`  finally removed ${n} seeded rows`);
    }
  }
}

// ─── run ─────────────────────────────────────────────────────────────────────────────────────
console.log(`T77 MEASURE — temporal stability  port ${PORT}  label ${LABEL}  frames ${FRAMES}  step ${STEP_MS} ms  px ${PX}  shimmer ${DO_SHIMMER}  reseat ${DO_RESEAT}`);
const t0 = Date.now();
try {
  if (DO_SHIMMER) {
    await shimmerLeg("fpv", false, "Dnipro FPV — base rig (4096², one ortho box)");
    await shimmerLeg("city", true, "Dnipro city — ULTRA (8192² + 2 cascades)");
    await shimmerLeg("everest", true, "Everest — ULTRA, terrain casting");
  }
  if (DO_RESEAT) await reseatLegs();
} finally {
  if (seedIds.length) await unseedAll();
}
const path = `${OUT_DIR}/temporal-${LABEL}-${STAMP}.json`;
writeFileSync(path, JSON.stringify(results, null, 2));
console.log(`\nwrote ${path}\n${((Date.now() - t0) / 60000).toFixed(1)} min · ${failures} structural failure(s)`);
await finishVerify(failures === 0 ? 0 : 1);
