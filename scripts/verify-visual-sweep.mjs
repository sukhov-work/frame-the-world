#!/usr/bin/env node
/**
 * THE VISUAL SWEEP — boot every catalogue pose, wait for quiet, shoot it, read the engine, and
 * put nine views on one page (T77 rendering track, 2026-09-06).
 *
 * WHY (owner, 2026-09-06): every previous visual / perf session measured "very contained bland
 * views, often without any details or in dull spots and angles". `verify-perf-baseline.mjs` is
 * the proof — five poses, four of them the same block of Dnipro from 700 m. So the owner supplied
 * the views himself; they live in `scripts/lib/poses.mjs` and this script is what walks them.
 *
 * It is deliberately the FAST half of the pair:
 *   • `verify-perf-baseline.mjs` — the deep matrix (pose × ULTRA × tier × models × shadow A/B,
 *     10 s samples, tens of minutes). Nothing here replaces it and nothing there was modified.
 *   • THIS — one boot per pose, a short quiet-wait, ONE screenshot pair + a 3 s frame sample,
 *     then a CONTACT SHEET so a reviewer reads one image instead of nine. Made for the loop
 *     "change a lever → did anything get worse anywhere?".
 *
 *   node scripts/verify-visual-sweep.mjs [PORT] [--ids a,b] [--tags fpv,dnipro]
 *        [--ultra 0|1|both] [--tier high|mid|low] [--label name] [--golden] [--compare <label>]
 *        [--quiet-s 8] [--no-legs] [--sheet] [--tolerance 0] [--sample-s 3] [--cap-min 25]
 *        [--freeze | --no-freeze] [--freeze-drain-s 10] [--reveal-settle-s 3]
 *
 * PORT defaults to 9333 — the HEADLESS verify instance, launched here if it is down
 * (`scripts/verify-chrome.mjs --headless --port 9333 --profile /tmp/ftw-cdp --kill-stale`).
 * Port 9222 is the OWNER'S headed Chrome: it is attached to when asked for, never launched and
 * never killed (`lib/cdp.mjs` refuses to launch it at all).
 *
 * ── What lands on disk (`verify-shots/sweep/<label>/`, git-ignored) ───────────────────────────
 *   <id>.jpeg        the full-viewport frame (1600×900 @1, or 390×844 @3 for the `/m` pose)
 *   <id>.360.png     the 360-px-tall thumbnail — the DIFF and CONTACT-SHEET currency
 *   <id>.json        this pose's metrics (debug feed + renderer.info + seatSettle + frame sample)
 *   <id>/frame-NN.jpeg + <id>/leg.json + <id>/leg.csv     a leg's frames and per-frame rows
 *   sheet-NN.png     3×3 contact sheets (--sheet) · <id>/strip.png  one strip per leg
 *   report.md        the table: id · tier · ultra · fps p50 · dt p95 · calls · tris · heap ·
 *                    tiles visible · seat residual · hitches
 *   report.json      everything above, machine-readable, plus the md5 of every 360 PNG
 *
 * ── The three LEGS (skip with --no-legs) ──────────────────────────────────────────────────────
 *   descent   `dnipro-descent` — boot at 31.8 km, then DRIVE to 1.55 km and sample EVERY FRAME
 *             through the flight and 6 s past arrival. Driven by
 *             `__cameraStore.getState().requestFly({latDeg,lonDeg,altM})` (`store/camera.ts:277,
 *             397`) with `setTargetHeading` / `setTargetTilt` (`camera.ts:280-284`) issued the
 *             moment `__globe.flight.active()` goes false, so the arrival tilt is the owner's
 *             54.9° and not whatever the arrival-pose derivation picked. Synthetic wheel zoom is
 *             the documented fallback and was NOT needed — recorded per run in `leg.drive`.
 *   zoomSweep `dnipro-fpv-zoom-sweep` — fov 7.2° (≈200 mm), heading walked 0…315° in 45° steps.
 *             `window.__globe` has NO FPV look writer (the block at `StylizedTiles.ts:3385-3561`
 *             exposes `fpv()` as a pure read), so each stop RE-BOOTS its own `#f=` hash through
 *             about:blank. Recorded as `leg.drive === "reboot"`.
 *   timeSweep `everest-fpv-sunset-ab` — eight instants across sun elevation +3.5° → −1°, two of
 *             them the owner's own frames, driven by `__timeStore.getState().setTime(ms)`
 *             (`store/time.ts:32`) inside ONE boot: geometry and tiles are identical at every
 *             stop, so the only thing that moved is the light. Each stop keeps every
 *             light/shadow-shaped key of `__debugFeed.snapshot()` — that IS the sunset diagnosis.
 *
 * ── Determinism ───────────────────────────────────────────────────────────────────────────────
 *   Every pose pins `t` from the catalogue (never a live clock) · the welcome overlay is
 *   dismissed and asserted gone · `debugHud` is forced off pre-boot so no panel DOM rides the
 *   numbers · ULTRA is the pre-boot localStorage pref, not a URL param
 *   (`ftw:view-prefs:v1`.ultraQuality) · the device tier is pinned pre-boot by overriding
 *   `navigator.hardwareConcurrency` (2 → low, 4 → mid) because shadow-map size is boot-latched ·
 *   before every capture the harness waits for tile quiet and then TWO rAF ticks, so the pixels
 *   belong to a finished frame.
 *
 * ── Pixel compare: what it can and cannot prove (T94, MEASURED 2026-09-06) ────────────────────
 *   `--freeze` (DEFAULT whenever `--golden` or `--compare` is used) calls
 *   `__globe.freezeFrame(true)` after quiet and before the capture, waits two rAF, shoots, shoots
 *   AGAIN two rAF later, and diffs the pair. That SELF-CHECK is printed and gated per pose: it is
 *   the run's own proof that the frame it wrote is reproducible, so a `--compare --tolerance 0`
 *   failure means the picture changed and not that the dither moved.
 *   The seam holds the per-frame clock (every dt-driven ease, the F1 building-reveal dither, the
 *   star twinkle, the pin shimmer), tile STREAMING (no tile, and no `terrainEpoch` bump, lands
 *   mid-capture) and LATCHES the shadow rig. `row.freeze.held` records what it held.
 *   WITHOUT `--freeze` the canvas is not frame-deterministic while it is still converging: two
 *   captures two rAF apart at `legacy-orbit` right after tile quiet differed in 31-44 % of pixels
 *   (max channel Δ 198) and at `everest-orbit-73` in 4.4 %. Left alone for ~25 s past quiet the
 *   same poses settle to a byte-identical 0 % on their own — the noise is CONVERGENCE (streaming,
 *   the terrain epoch, the reveal/drape/exposure eases), not per-frame randomness.
 *   Run-to-run (two BOOTS) is a different question and `--freeze` does not answer it: star
 *   positions and phases are `Math.random()` at construction (`scene/stars.ts:73-80,203`) and tile
 *   arrival order varies — that residual is T95.
 *   The md5 of every 360 PNG is recorded either way: it proves which bytes were compared.
 *
 * ── Robustness ────────────────────────────────────────────────────────────────────────────────
 *   Artefacts are written after EVERY pose (a crash at pose 9 of 14 keeps 1–8) · a boot failure
 *   is recorded and the run continues on a fresh target · every rAF probe carries a watchdog
 *   (MEASUREMENTS §13: a rAF promise stalled > 90 s in 3 of 27 boots) · a total-time cap ·
 *   exit is always `finishVerify` so the CDP targets come back (`test/verifyHarness.test.ts` C11).
 *
 * Preconditions: `wix dev` on :4321 (the `window.__*` seams are DEV-only) · Node ≥ 22 (global
 * WebSocket) · never edit `src/` while this runs (HMR reloads the page under the harness).
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";
import { composeSheet, diffPngs, ensureBrowser, openSession, portOwner, sleep } from "./lib/cdp.mjs";
import { POSES, allTags, fpvHash, parseHash, poseUrl, select } from "./lib/poses.mjs";

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const list = (n) =>
  (opt(n, "") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

if (flag("--help") || flag("-h")) {
  console.log(
    `visual sweep — poses: ${POSES.map((p) => p.id).join(" ")}\n` +
      `tags: ${allTags().join(" ")}\n` +
      `usage: node scripts/verify-visual-sweep.mjs [PORT] [--ids a,b] [--tags fpv,dnipro] ` +
      `[--ultra 0|1|both] [--tier high|mid|low] [--label name] [--golden] [--compare <label>] ` +
      `[--quiet-s 8] [--no-legs] [--sheet] [--tolerance 0] [--sample-s 3] [--cap-min 25] ` +
      `[--freeze|--no-freeze] [--freeze-drain-s 10] [--reveal-settle-s 3]`,
  );
  await finishVerify(0);
}

// PORT is the one POSITIONAL argument. It must not swallow an option's VALUE: the house sniffer
// `args.find(/^\d+$/)` read `--quiet-s 10` as "port 10" and launched a Chrome on port 10 (caught
// on the first descent run, 2026-09-06). A numeric arg counts only when nothing option-shaped
// precedes it.
const PORT = args.find((a, i) => /^\d{2,5}$/.test(a) && !(args[i - 1] ?? "").startsWith("-")) ?? "9333";
const IDS = list("--ids");
const TAGS = list("--tags");
const ULTRA_ARG = opt("--ultra", "0");
const ULTRAS = ULTRA_ARG === "both" ? [false, true] : [ULTRA_ARG === "1"];
const TIER = opt("--tier", "high");
const LABEL = opt("--label", "sweep");
const GOLDEN = flag("--golden");
const COMPARE = opt("--compare", null);
const QUIET_S = Math.min(120, Number(opt("--quiet-s", "8")));
const SAMPLE_MS = Number(opt("--sample-s", "3")) * 1000;
const NO_LEGS = flag("--no-legs");
const SHEET = flag("--sheet");
const TOLERANCE = Number(opt("--tolerance", "0"));
// T94 — the deterministic-capture seam. ON by default exactly when the run exists to compare
// pixels (`--golden` writes the bytes a later `--compare` is measured against, so both halves
// must be shot the same way); a plain look-at-it sweep stays LIVE unless asked. `--no-freeze`
// wins over `--freeze` so a golden run can be forced back to the old behaviour.
const FREEZE = flag("--no-freeze") ? false : flag("--freeze") || GOLDEN || !!COMPARE;
/** Seconds allowed for the in-flight tiles to land AFTER the freeze (see the frozen drain). */
const FREEZE_DRAIN_S = Math.min(60, Number(opt("--freeze-drain-s", "10")));
const CAP_MS = Number(opt("--cap-min", "25")) * 60_000;
const DEV = opt("--dev", "http://localhost:4321");
const CORES_FOR_TIER = { high: null, mid: 4, low: 2 };
if (!(TIER in CORES_FOR_TIER)) throw new VerifyFailure(`--tier must be high|mid|low, got ${TIER}`);

const OUT_DIR = join("verify-shots/sweep", LABEL);
const GOLDEN_DIR = join("verify-shots/golden", LABEL);
mkdirSync(OUT_DIR, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runT0 = Date.now();

// ─── Selection ───────────────────────────────────────────────────────────────────────────────
const { poses: selected, missing } = select({ ids: IDS, tags: TAGS });
if (missing.length) {
  // A typo'd --ids that quietly ran zero poses and exited 0 is exactly the vacuous pass
  // `test/verifyHarness.test.ts` exists to forbid. Refuse it loudly instead.
  throw new VerifyFailure(
    `unknown pose id/tag: ${missing.join(", ")} — known ids: ${POSES.map((p) => p.id).join(" ")}`,
  );
}
if (selected.length === 0) throw new VerifyFailure("selection resolved to zero poses");

// ─── Reporting ───────────────────────────────────────────────────────────────────────────────
const rows = [];
const notes = [];
const bootFailures = [];
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
const fmt = (v, d = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : typeof v === "number" ? v.toFixed(d) : String(v);
const fmtI = (v) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : Math.round(v).toLocaleString("en-US");
const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const writeB64 = (path, b64) => {
  mkdirSync(dirname(path), { recursive: true });
  const buf = Buffer.from(b64, "base64");
  writeFileSync(path, buf);
  return { bytes: buf.length, md5: md5(buf) };
};

// ─── In-page probes ──────────────────────────────────────────────────────────────────────────
/** The pre-boot document script: ULTRA + debugHud prefs and the device-tier pin. Both are
 *  CONSTRUCTION-time (the 8192² shadow map and `shadowMap.enabled` are latched at boot), so a
 *  live `__quality.force()` cannot reproduce a tier — `verify-perf-baseline.mjs:358-367`. */
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

/** Tile-stream busy counters, the settle signal (`verify-temporal-stability.mjs:188-190`). */
const BUSY = `(() => { const u = window.__globe.u5(); const q = (r) => r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0;
  let um = null; try { um = window.__globe.userModels ? window.__globe.userModels() : null; } catch {}
  return { busy: q(u.buildings) + q(u.ground) + q(u.enriched) + (um ? um.loading : 0),
           visible: { bld: u.buildings.stats.visible, gnd: u.ground.stats.visible, enr: u.enriched ? u.enriched.stats.visible : null } }; })()`;

const QUAL = `(() => { const q = window.__globeQuality, Q = window.__quality;
  return q ? { tier: q.tier, tileTier: q.tileTier, dpr: q.dpr, lean: q.lean, mapFlat: q.mapFlat, ultra: q.ultra,
               ultraBoot: q.ultraBoot, shadowMapPx: q.shadowMapPx, deviceTier: Q ? Q.deviceTier : null,
               cores: navigator.hardwareConcurrency, gpu: Q && Q.deviceCaps ? Q.deviceCaps.rendererString : null } : null; })()`;

/** Where the camera actually ended up — the report's proof that the hash was honoured. */
const POSE_READ = `(() => { const g = window.__globe, c = window.__cameraStore ? window.__cameraStore.getState() : null;
  let fpv = null; try { fpv = g.fpv ? g.fpv() : null; } catch {}
  return { altM: g.alt(), fovDeg: g.camera.fov,
           headingDeg: c ? c.headingDeg : null, tiltDeg: c ? c.tiltDeg : null,
           focusLatDeg: c ? c.focusLatDeg : null, focusLonDeg: c ? c.focusLonDeg : null,
           fpvActive: fpv ? fpv.active : false, fpvYawDeg: fpv ? fpv.yawDeg : null,
           fpvPitchDeg: fpv ? fpv.pitchDeg : null, fpvEyeAboveGroundM: fpv ? fpv.eyeAboveGroundM : null,
           timeMs: window.__timeStore ? window.__timeStore.getState().timeMs : null,
           live: window.__timeStore ? window.__timeStore.getState().live : null }; })()`;

/** The welcome overlay's REAL state — the element, not a flag (`panels/Welcome.tsx:49,70`). */
const WELCOME = `(() => { const el = document.querySelector(".wl"); if (!el) return { present: false };
  const cs = getComputedStyle(el);
  return { present: true, display: cs.display, visibility: cs.visibility, opacity: cs.opacity }; })()`;

/** A 3 s rAF frame sample with a watchdog. Same shape as the baseline's SAMPLER, trimmed to what
 *  a sweep row prints; `rafStalled` is RECORDED, never a hung run (MEASUREMENTS §13). */
const SAMPLER = (ms) => `new Promise((res) => {
  const watchdog = setTimeout(() => res({ rafStalled: true, frames: dts.length,
    windowMs: performance.now() - t0, visibility: document.visibilityState, hasFocus: document.hasFocus() }), ${ms} * 3 + 5000);
  const r = window.__renderer, g = window.__quality.governor;
  const dts = [], calls = [], tris = []; let last = performance.now(); const t0 = last;
  const h0 = g.hitchCount();
  const tick = () => {
    const n = performance.now(); dts.push(n - last); last = n;
    calls.push(r.info.render.calls); tris.push(r.info.render.triangles);
    if (n - t0 < ${ms}) requestAnimationFrame(tick);
    else {
      clearTimeout(watchdog);
      const s = dts.slice(1).sort((a, b) => a - b);
      const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
      const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
      res({ frames: s.length, windowMs: n - t0, fps: (1000 * s.length) / (n - t0),
        fpsP50: 1000 / q(0.5), dtP50: q(0.5), dtP95: q(0.95), dtMax: s[s.length - 1],
        calls: med(calls), callsMax: Math.max(...calls), tris: med(tris), trisMax: Math.max(...tris),
        hitches: g.hitchCount() - h0, emaMs: g.emaMs(),
        jsHeapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
        geometries: r.info.memory.geometries, textures: r.info.memory.textures,
        programs: r.info.programs ? r.info.programs.length : null });
    }
  };
  requestAnimationFrame(tick);
})`;

/** Activate the DBG feed WITHOUT mounting the panel, let the rings fill, snapshot, restore. */
const FEED = (ms) => `new Promise((res) => {
  const f = window.__debugFeed; if (!f) { res(null); return; }
  const was = f.active; f.setActive(true);
  setTimeout(() => { const s = f.snapshot(); if (!was) f.setActive(false); res(s); }, ${ms});
})`;

/** This frame's seat residuals (`__globe.seatSettle()` — `StylizedTiles.ts:3395`). */
const SEAT = `(() => { try { const s = window.__globe.seatSettle(); const e = s.enriched;
  return { frameCount: s.frameCount, terrainEpoch: s.terrainEpoch,
           nearMaxResidualM: e ? e.nearMaxResidualM : null, nearMovedFeatures: e ? e.nearMovedFeatures : null,
           maxResidualM: e ? e.maxResidualM : null, movedFeatures: e ? e.movedFeatures : null,
           quietFrames: e ? e.quietFrames : null, deferred: e ? e.deferred : null, rejected: e ? e.rejected : null };
  } catch (err) { return { error: String(err) }; } })()`;

/** The per-frame RECORDER used by the descent leg. Node polls `__sweepRec.rows.length` and pulls
 *  the rows at the end — an rAF loop pushing plain field reads (never `enrichedSeats()`, a
 *  39k-feature walk that would itself become the measurement). */
const REC_START = `(() => {
  const g = window.__globe, R = window.__renderer;
  const rec = { rows: [], stop: false, t0: performance.now(), last: performance.now(), error: null };
  window.__sweepRec = rec;
  const q = (r) => (r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0);
  // T77 slice C (the streaming measurement that gates levers 9–11, 2026-09-07): the DBG feed's
  // \`tiles\` provider and its \`frame.cpu\` series — one provider read (plain field reads off the
  // three tilesets' queues + the LRU's byte count) and one ring read per frame; the feed is
  // switched on for the leg so the series exists, and off again in REC_STOP.
  const F = window.__debugFeed; if (F) F.setActive(true);
  const tick = () => {
    if (rec.stop) return;
    try {
      const n = performance.now();
      const s = g.seatSettle(); const e = s.enriched; const u = g.u5();
      const c = window.__cameraStore ? window.__cameraStore.getState() : null;
      const T = F ? F.read("tiles") : null;
      const cpu = F ? F.series("frame.cpu") : null;
      const mb = (k) => (T && T[k] != null ? +T[k].toFixed(2) : null);
      rec.rows.push({
        ms: Math.round(n - rec.t0), dt: +(n - rec.last).toFixed(2),
        altM: Math.round(g.alt()),
        headingDeg: c ? +c.headingDeg.toFixed(1) : null, tiltDeg: c ? +c.tiltDeg.toFixed(1) : null,
        flight: !!(g.flight && g.flight.active()),
        busy: q(u.buildings) + q(u.ground) + q(u.enriched),
        visBld: u.buildings.stats.visible, visGnd: u.ground.stats.visible,
        visEnr: u.enriched ? u.enriched.stats.visible : null,
        calls: R.info.render.calls, tris: R.info.render.triangles,
        terrainEpoch: s.terrainEpoch,
        seatNearM: e ? +e.nearMaxResidualM.toFixed(4) : null,
        seatCityM: e ? +e.maxResidualM.toFixed(4) : null,
        seatMoved: e ? e.movedFeatures : null,
        // the streaming columns — DOWNLOAD side: queued items + jobs in flight; PARSE side: the
        // same; the LRU in MB; the orchestrator's main-thread ms for the frame
        dlLen: u.buildings.dl.len + u.ground.dl.len + (u.enriched ? u.enriched.dl.len : 0),
        dlJobs: u.buildings.dl.jobs + u.ground.dl.jobs + (u.enriched ? u.enriched.dl.jobs : 0),
        parseLen: u.buildings.parse.len + u.ground.parse.len + (u.enriched ? u.enriched.parse.len : 0),
        parseJobs: u.buildings.parse.jobs + u.ground.parse.jobs + (u.enriched ? u.enriched.parse.jobs : 0),
        lruBldMB: mb("bld.lruMB"), lruGndMB: mb("gnd.lruMB"), lruEnrMB: mb("enr.lruMB"),
        inCache: u.buildings.stats.inCache + u.ground.stats.inCache + (u.enriched ? u.enriched.stats.inCache : 0),
        cpuMs: cpu && cpu.last != null ? +cpu.last.toFixed(2) : null,
      });
      rec.last = n;
    } catch (err) { rec.error = String(err); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;
const REC_STOP = `(() => { const r = window.__sweepRec; if (!r) return null; r.stop = true;
  if (window.__debugFeed) window.__debugFeed.setActive(false);
  return { rows: r.rows, error: r.error }; })()`;

// ─── Attach ──────────────────────────────────────────────────────────────────────────────────
console.log(
  `VISUAL SWEEP  port ${PORT}  label ${LABEL}  poses ${selected.length}  ultra ${ULTRA_ARG}  tier ${TIER}  quiet≤${QUIET_S}s  legs ${!NO_LEGS}  sheet ${SHEET}  freeze ${FREEZE}${COMPARE ? `  compare ${COMPARE}` : ""}${GOLDEN ? "  (writing GOLDEN)" : ""}`,
);
const browser = await ensureBrowser(PORT, { profile: "/tmp/ftw-cdp" });
console.log(
  `browser  ${browser.browser}${browser.launched ? " (launched headless by this run)" : " (already up)"}  owners: ${portOwner(PORT).map((o) => o.pid).join(",") || "?"}`,
);

const newTarget = async () => {
  let t;
  try {
    t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  } catch {
    t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
  }
  trackTarget(PORT, t.id);
  return t;
};

let session = await openSession(await newTarget());
let bootScriptId = null;
/** Replace a hung/crashed page target — the old one is closed over HTTP (works with a dead
 *  renderer) and the run continues on a fresh renderer process. */
async function reattach() {
  const old = session;
  try {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${old.target.id}`).catch(() => {});
  } finally {
    old.close();
  }
  session = await openSession(await newTarget());
  bootScriptId = null;
}

/** A second, THROWAWAY tab used only for composing sheets and decoding PNGs — kept off the page
 *  under measurement so a canvas the size of a contact sheet never rides its GPU budget. */
let composer = null;
const getComposer = async () => (composer ??= await openSession(await newTarget()));

// ─── Boot / settle / capture ─────────────────────────────────────────────────────────────────
const VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const VIEWPORT_M = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const THUMB_H = 360;

async function boot(pose, ultra, url) {
  if (bootScriptId) {
    await session.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: bootScriptId }).catch(() => {});
  }
  bootScriptId = (
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: BOOT_SCRIPT(ultra, CORES_FOR_TIER[TIER]),
    })
  ).identifier;
  if (pose.kind === "m") {
    // The qaslice-cab recipe: emulation BEFORE navigate (readDeviceCaps reads matchMedia once).
    await session.send("Emulation.setDeviceMetricsOverride", VIEWPORT_M);
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  } else {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await session.send("Emulation.setDeviceMetricsOverride", VIEWPORT);
  }
  const t0 = Date.now();
  await session.bootUrl(url);
  await session.waitFor(
    `!!(window.__globe && window.__globe.camera && window.__renderer && window.__quality && window.__globeQuality && window.__globe.u5 && window.__globe.seatSettle && window.__debugFeed)`,
    120_000,
    "globe + debugFeed seams",
  );
  await session.send("Page.bringToFront");
  // Dismiss the welcome overlay and give the canvas the pointerdown the hint copy asks for.
  await session.evalJs(
    `(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`,
  );
  await session.waitFor(`!window.__globe.flight || !window.__globe.flight.active()`, 60_000, "flight settled");
  if (pose.kind === "fpv") {
    await session.waitFor(`!!window.__globe.fpv && window.__globe.fpv().active`, 60_000, "FPV active");
  }
  return Date.now() - t0;
}

/** Wait for the tile streams to go quiet (zero queued/downloading/parsing held for `quietMs`),
 *  capped. A capped wait is REPORTED — the pose is still shot, and the report says it was busy.
 *  A quiet is only accepted once a GROUND tile is visible (2026-09-06j): under machine load the
 *  streams read `busy 0` for the first seconds — before the tileset root has even been fetched —
 *  and two goldens (`everest-orbit-52.u0`, `dnipro-descent.u1`) were shot with `visible 0/0/0`
 *  after a 1.3 s "quiet". A fail-open quiet is the vacuous pass; `noGround` names the cap reason. */
async function quiet(maxS = QUIET_S, quietMs = 1200) {
  const t0 = Date.now();
  let quietSince = null;
  let last = null;
  while (Date.now() - t0 < maxS * 1000) {
    last = await session.evalJs(BUSY);
    const groundUp = (last.visible?.gnd ?? 1) > 0;
    if (last.busy === 0 && groundUp) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) {
        return { settleMs: Date.now() - t0, capped: false, visible: last.visible, busy: 0 };
      }
    } else quietSince = null;
    await sleep(200);
  }
  const noGround = (last?.visible?.gnd ?? 1) === 0;
  return { settleMs: Date.now() - t0, capped: true, noGround, visible: last?.visible ?? null, busy: last?.busy ?? null };
}

/** Two rAF ticks after quiet, so the captured pixels belong to a FINISHED frame rather than one
 *  the compositor is mid-way through. `ticks` returns -1 on a rAF stall — recorded, not thrown. */
async function stableFrame() {
  const t = await session.ticks(2);
  return { rafTicks: t };
}

/** T94 — the deterministic-capture seam (`StylizedTiles.ts`'s `__globe.freezeFrame`). A page that
 *  predates the seam answers `null`, which is REPORTED (a silently un-frozen golden would be the
 *  vacuous pass `test/verifyHarness.test.ts` exists to forbid). */
// TWO PHASES (2026-09-06k). Phase 1 holds STREAMING + the SHADOW RIG but lets the CLOCK run, so the
// drain happens on live time and every tile that landed during it finishes its reveal ease; only
// then does phase 2 pin the clock. Freezing everything at once captured tiles mid-reveal — the
// halftone dither frozen at half strength over the whole ground at everest-orbit-52/73 and the
// zoom sweep on the first post-integration sheet — a picture no user ever sees.
const FREEZE_PHASE1 = `(() => { const g = window.__globe;
  if (!g || typeof g.freezeFrame !== "function") return null;
  const s = g.freezeFrame(true, { clock: false });
  return { frozenAtMs: s.frozenAtMs, parts: s.parts, held: s.held, clocks: s.clocks }; })()`;
const FREEZE_ON = `(() => { const g = window.__globe;
  if (!g || typeof g.freezeFrame !== "function") return null;
  const s = g.freezeFrame(true);
  return { frozenAtMs: s.frozenAtMs, parts: s.parts, held: s.held, clocks: s.clocks }; })()`;
/** Seconds of LIVE clock after the drain for the last-landed tiles' reveal eases to finish. */
const REVEAL_SETTLE_S = Number(opt("--reveal-settle-s", "3"));
const FREEZE_OFF = `(() => { const g = window.__globe;
  if (!g || typeof g.freezeFrame !== "function") return null;
  const s = g.freezeFrame(false);
  return { frozenAtMs: s.frozenAtMs, skewMs: Math.round(s.skewMs), held: s.held }; })()`;

async function shoot(pose, thumbOnly = false) {
  const vp = pose.kind === "m" ? VIEWPORT_M : VIEWPORT;
  const full = thumbOnly ? { data: null } : await session.send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  // The thumbnail is a SECOND rasterisation at a clip scale that lands 360 px tall — no Node
  // image decoder is involved anywhere in the pipeline, so the harness has no image dependency.
  const scale = Math.min(640 / vp.width, THUMB_H / vp.height);
  const thumb = await session.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale },
  });
  return { fullB64: full.data, thumbB64: thumb.data };
}

async function measure() {
  const [q, poseRead, welcome, seat, frame] = [
    await session.evalJs(QUAL),
    await session.evalJs(POSE_READ),
    await session.evalJs(WELCOME),
    await session.evalJs(SEAT),
    await session.evalJs(SAMPLER(SAMPLE_MS)),
  ];
  const feed = await session.evalJs(FEED(1400));
  return { q, poseRead, welcome, seat, frame, feed };
}

const feedNum = (feed, k) => (feed && typeof feed[k] === "number" ? feed[k] : null);
/** Every flattened snapshot key that looks light/shadow-shaped — the time sweep's payload. */
function lightKeys(feed, needles) {
  if (!feed) return null;
  const out = {};
  for (const [k, v] of Object.entries(feed)) {
    if (needles.some((n) => k.toLowerCase().includes(n))) out[k] = v;
  }
  return out;
}

// ─── Artefacts ───────────────────────────────────────────────────────────────────────────────
const reportJson = join(OUT_DIR, "report.json");
const reportMd = join(OUT_DIR, "report.md");
const sheets = [];
const comparisons = [];
function writeArtefacts() {
  const runMin = ((Date.now() - runT0) / 60000).toFixed(1);
  writeFileSync(
    reportJson,
    JSON.stringify(
      {
        stamp: STAMP,
        label: LABEL,
        args,
        port: PORT,
        dev: DEV,
        tier: TIER,
        ultra: ULTRA_ARG,
        runMin,
        browser,
        notes,
        bootFailures,
        sheets,
        comparisons,
        crashEvents: session.crashEvents,
        consoleErrors: session.consoleErrors.slice(0, 20),
        rows,
      },
      null,
      2,
    ),
  );
  const head =
    `| id | tier (dev) | ultra | fps p50 | dt p50 / p95 ms | calls | tris | heap MB | tiles vis bld/gnd/enr | seat near / city m | hitches | quiet s | boot s |`;
  const sep = `|---|---|---|---|---|---|---|---|---|---|---|---|---|`;
  const body = rows.map((r) => {
    const f = r.frame ?? {};
    const s = r.seat ?? {};
    const v = r.settle?.visible ?? {};
    return (
      `| ${r.id} | ${r.q?.tier ?? "?"} (${r.q?.deviceTier ?? "?"}) | ${r.ultra ? "on" : "off"} | ` +
      `${fmt(f.fpsP50, 1)} | ${fmt(f.dtP50)} / ${fmt(f.dtP95)} | ${fmtI(f.calls)} | ${fmtI(f.tris)} | ` +
      `${fmt(f.jsHeapMB, 0)} | ${fmtI(v.bld)}/${fmtI(v.gnd)}/${fmtI(v.enr)} | ` +
      `${fmt(s.nearMaxResidualM, 3)} / ${fmt(s.maxResidualM, 3)} | ${fmtI(f.hitches)} | ` +
      `${fmt((r.settle?.settleMs ?? 0) / 1000, 1)}${r.settle?.capped ? "!" : ""} | ${fmt(r.bootMs / 1000, 1)} |`
    );
  });
  const legLines = rows
    .filter((r) => r.leg)
    .map((r) => `- **${r.id}** leg \`${r.leg.type}\` (drive: \`${r.leg.drive}\`) — ${r.leg.summary}`);
  // T94 — the determinism section: what the freeze held, and whether the frozen frame reproduced.
  const frzLines = rows
    .filter((r) => r.freeze)
    .map((r) => {
      const sc = r.freeze.selfCheck;
      const verdict = !r.freeze.held
        ? "SEAM ABSENT" // the page has no __globe.freezeFrame — nothing was frozen at all
        : !sc
          ? "NOT CHECKED" // frozen, but the pose failed before its second shot
          : sc.error
            ? `ERROR ${sc.error}`
            : sc.differing === 0
              ? "BYTE-IDENTICAL"
              : `${fmtI(sc.differing)} px (${fmt(sc.fraction * 100, 3)} %), max channel Δ ${sc.maxDelta}`;
      // The DRAIN state belongs on this line: a capped drain means in-flight tiles were still
      // landing when the shot was taken, which is the first thing to suspect behind a residual.
      const dr = r.freeze.drain
        ? ` · drain ${fmt(r.freeze.drain.settleMs / 1000, 1)}s${r.freeze.drain.capped ? " CAPPED (still streaming)" : ""}`
        : "";
      return `- ${verdict} \`${r.id}\`${dr} — held ${r.freeze.held?.length ?? 0}: ${(r.freeze.held ?? []).join(", ") || "—"}`;
    });
  const cmpLines = comparisons.map(
    (c) =>
      `- ${c.ok ? "MATCH" : "DIFF "} \`${c.id}\` — ${c.error ?? `${fmtI(c.differing)} px (${fmt((c.fraction ?? 0) * 100, 3)} %), max channel Δ ${c.maxDelta}`}`,
  );
  writeFileSync(
    reportMd,
    `# Visual sweep — ${LABEL} — ${STAMP}\n\n` +
      `port ${PORT} · tier ${TIER} · ultra ${ULTRA_ARG} · quiet ≤ ${QUIET_S} s · sample ${SAMPLE_MS / 1000} s · ` +
      `freeze ${FREEZE ? "on" : "off"} · ` +
      `run ${runMin} min · args \`${args.join(" ")}\`\n\n` +
      `${head}\n${sep}\n${body.join("\n")}\n\n` +
      (legLines.length ? `## Legs\n\n${legLines.join("\n")}\n\n` : "") +
      (sheets.length ? `## Contact sheets\n\n${sheets.map((s) => `- \`${s.file}\` — ${s.ids.join(", ")}`).join("\n")}\n\n` : "") +
      (frzLines.length
        ? `## Frame freeze (T94 — \`__globe.freezeFrame\`)\n\nEach capture was taken frozen; the ` +
          `verdict is the SELF-CHECK: the same frozen frame shot again two rAF later.\n\n${frzLines.join("\n")}\n\n`
        : "") +
      (cmpLines.length ? `## Pixel compare vs golden \`${COMPARE}\` (tolerance ${TOLERANCE})\n\n${cmpLines.join("\n")}\n\n` : "") +
      (notes.length ? `## Notes\n\n${notes.map((n) => `- ${n}`).join("\n")}\n\n` : "") +
      (bootFailures.length ? `## Boot failures\n\n${bootFailures.map((b) => `- **${b.id}**: ${b.error}`).join("\n")}\n` : ""),
  );
  return runMin;
}

// ─── Legs ────────────────────────────────────────────────────────────────────────────────────
/**
 * DESCENT — drive the camera from the boot pose down to the leg's END pose, sampling every frame.
 * Preference order from the plan: (a) the camera store's `requestFly` + the target setters,
 * (b) a synthetic wheel zoom. (a) is what runs; (b) is only reached if the store seam is absent,
 * and either way the choice is recorded in `leg.drive`.
 */
async function runDescent(pose, dir) {
  const leg = pose.leg;
  const end = leg.end;
  const frames = [];
  await session.evalJs(REC_START);
  const hasStore = await session.evalJs(`!!(window.__cameraStore && window.__cameraStore.getState().requestFly)`);
  let drive = "requestFly+targets";
  if (hasStore) {
    await session.evalJs(
      `(() => { const s = window.__cameraStore.getState();
         s.requestFly({ latDeg: ${end.latDeg}, lonDeg: ${end.lonDeg}, altM: ${end.altM} }); return true; })()`,
    );
  } else {
    // Fallback: synthetic wheel zoom toward the view centre. Recorded, never silent.
    drive = "wheel";
    note(`${pose.id}: __cameraStore.requestFly absent — fell back to synthetic wheel zoom`);
    for (let i = 0; i < 30; i++) {
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: VIEWPORT.width / 2,
        y: VIEWPORT.height / 2,
        deltaX: 0,
        deltaY: -240,
      });
      await sleep(120);
    }
  }
  const t0 = Date.now();
  let arrivedAt = null;
  let targetsIssued = false;
  let quietAtEnd = false;
  while (Date.now() - t0 < leg.maxLegS * 1000) {
    if (frames.length < leg.maxShots) {
      const shot = await session.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 72,
        clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 0.3 },
      });
      const file = join(dir, `frame-${String(frames.length).padStart(2, "0")}.jpeg`);
      const meta = writeB64(file, shot.data);
      frames.push({ file, atMs: Date.now() - t0, ...meta, b64: shot.data });
    }
    const flying = await session.evalJs(`!!(window.__globe.flight && window.__globe.flight.active())`);
    if (!flying && !targetsIssued && hasStore) {
      // Arrival heading/tilt: the flight's own arrival-pose derivation picks its heading off the
      // approach azimuth, so the owner's 35.9° / 54.9° are requested explicitly the instant the
      // flight lets go of the camera (setTargetHeading/setTargetTilt — `store/camera.ts:280-284`).
      await session.evalJs(
        `(() => { const s = window.__cameraStore.getState();
           s.setTargetHeading(${end.headingDeg}); s.setTargetTilt(${end.tiltDeg}); s.setTargetZoom(${end.altM}); return true; })()`,
      );
      targetsIssued = true;
    }
    if (!flying && targetsIssued) {
      arrivedAt ??= Date.now();
      // The leg ends when BOTH are true: the owner's N seconds have passed AND the tile streams
      // have gone quiet. At +6 s the arrival was still pulling ~660 tiles (measured 2026-09-06),
      // so a purely time-boxed tail cut the leg off in the middle of what it exists to show.
      if (Date.now() - arrivedAt >= leg.afterArrivalS * 1000) {
        const b = await session.evalJs(BUSY);
        if (b.busy === 0) {
          quietAtEnd = true;
          break;
        }
      }
    }
    await sleep(leg.shotEveryMs);
  }
  const rec = await session.evalJs(REC_STOP);
  const endBusy = await session.evalJs(BUSY);
  // The ARRIVAL frame at full size — the 480-px strip cells cannot show whether the buildings
  // actually seated, and "did the city arrive?" is the whole question this leg asks.
  const arrivalShot = await session.send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  const arrivalFile = join(dir, "arrival.jpeg");
  writeB64(arrivalFile, arrivalShot.data);
  const pose1 = await session.evalJs(POSE_READ);
  const rowsRec = rec?.rows ?? [];
  const dts = rowsRec.slice(1).map((r) => r.dt).sort((a, b) => a - b);
  const p = (q) => (dts.length ? dts[Math.min(dts.length - 1, Math.floor(dts.length * q))] : null);
  const summary =
    `${rowsRec.length} frames over ${((Date.now() - t0) / 1000).toFixed(1)} s · ` +
    `alt ${fmtI(rowsRec[0]?.altM)} → ${fmtI(rowsRec[rowsRec.length - 1]?.altM)} m · ` +
    `dt p50 ${fmt(p(0.5))} / p95 ${fmt(p(0.95))} / max ${fmt(dts[dts.length - 1])} ms · ` +
    `arrival heading ${fmt(pose1.headingDeg)}° tilt ${fmt(pose1.tiltDeg)}° · ` +
    `${quietAtEnd ? "settled" : `STILL BUSY (${endBusy.busy} queued)`} at the leg's end`;
  // The STREAMING read-out (T77 slice C, levers 9–11): where the leg spent its frames. A frame is
  // "download-bound" when items wait in the download queue with no parse in flight, and
  // "parse-bound" when the parse queue holds work (the main thread or the worker pool is the
  // limit). The LRU peak and the parse-frame CPU say what the lever would buy.
  const streaming = (() => {
    const busyRows = rowsRec.filter((r) => r.busy > 0);
    const dlBound = busyRows.filter((r) => r.dlLen + r.dlJobs > 0 && r.parseLen + r.parseJobs === 0).length;
    const parseBound = busyRows.filter((r) => r.parseLen + r.parseJobs > 0).length;
    const peakBusy = rowsRec.reduce((m, r) => Math.max(m, r.busy), 0);
    const peakDl = rowsRec.reduce((m, r) => Math.max(m, r.dlLen + r.dlJobs), 0);
    const peakParse = rowsRec.reduce((m, r) => Math.max(m, r.parseLen + r.parseJobs), 0);
    const lru = (k) => rowsRec.reduce((m, r) => (r[k] != null ? Math.max(m, r[k]) : m), 0);
    const cpuOf = (rows) => {
      const v = rows.map((r) => r.cpuMs).filter((x) => x != null).sort((a, b) => a - b);
      return v.length ? { p50: v[Math.floor(v.length * 0.5)], p95: v[Math.floor(v.length * 0.95)], n: v.length } : null;
    };
    const parseFrames = rowsRec.filter((r) => r.parseJobs > 0);
    const quietFrames = rowsRec.filter((r) => r.busy === 0);
    const dtParse = parseFrames.map((r) => r.dt).sort((a, b) => a - b);
    const dtQuiet = quietFrames.map((r) => r.dt).sort((a, b) => a - b);
    const p50 = (v) => (v.length ? v[Math.floor(v.length * 0.5)] : null);
    return {
      frames: rowsRec.length, busyFrames: busyRows.length, dlBoundFrames: dlBound, parseBoundFrames: parseBound,
      peakBusy, peakDl, peakParse,
      lruPeakMB: { bld: lru("lruBldMB"), gnd: lru("lruGndMB"), enr: lru("lruEnrMB") },
      cpuParseFrames: cpuOf(parseFrames), cpuQuietFrames: cpuOf(quietFrames),
      dtP50ParseFrames: p50(dtParse), dtP50QuietFrames: p50(dtQuiet),
    };
  })();
  writeFileSync(
    join(dir, "leg.json"),
    JSON.stringify(
      { type: "descent", drive, end, quietAtEnd, endBusy, arrivalFile, frames: frames.map(({ b64, ...f }) => f), rows: rowsRec, recError: rec?.error ?? null, arrival: pose1, streaming },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, "leg.csv"),
    ["ms,dt,altM,headingDeg,tiltDeg,flight,busy,visBld,visGnd,visEnr,calls,tris,terrainEpoch,seatNearM,seatCityM,seatMoved,dlLen,dlJobs,parseLen,parseJobs,lruBldMB,lruGndMB,lruEnrMB,inCache,cpuMs"]
      .concat(rowsRec.map((r) => [r.ms, r.dt, r.altM, r.headingDeg, r.tiltDeg, r.flight ? 1 : 0, r.busy, r.visBld, r.visGnd, r.visEnr, r.calls, r.tris, r.terrainEpoch, r.seatNearM, r.seatCityM, r.seatMoved, r.dlLen, r.dlJobs, r.parseLen, r.parseJobs, r.lruBldMB, r.lruGndMB, r.lruEnrMB, r.inCache, r.cpuMs].join(",")))
      .join("\n"),
  );
  writeFileSync(join(dir, "streaming.json"), JSON.stringify(streaming, null, 2));
  console.log(
    `  streaming  busy ${streaming.busyFrames}/${streaming.frames} frames · download-bound ${streaming.dlBoundFrames} · parse-bound ${streaming.parseBoundFrames} · ` +
      `peak queue ${streaming.peakBusy} (dl ${streaming.peakDl} / parse ${streaming.peakParse}) · ` +
      `LRU peak MB bld ${fmt(streaming.lruPeakMB.bld)} gnd ${fmt(streaming.lruPeakMB.gnd)} enr ${fmt(streaming.lruPeakMB.enr)} · ` +
      `frame.cpu p50 parse-frames ${fmt(streaming.cpuParseFrames?.p50)} / quiet ${fmt(streaming.cpuQuietFrames?.p50)} ms · ` +
      `dt p50 parse-frames ${fmt(streaming.dtP50ParseFrames)} / quiet ${fmt(streaming.dtP50QuietFrames)} ms`,
  );
  check(
    `${pose.id}: descent recorded frames`,
    rowsRec.length >= 60,
    `${rowsRec.length} rAF rows, ${frames.length} shots${rec?.error ? ` (recorder error: ${rec.error})` : ""}`,
  );
  check(
    `${pose.id}: descent ARRIVED low and tilted (owner's end pose)`,
    pose1.altM < 4000 && pose1.tiltDeg >= 35 && pose1.tiltDeg <= 60,
    `alt ${fmtI(pose1.altM)} m, tilt ${fmt(pose1.tiltDeg)}°, heading ${fmt(pose1.headingDeg)}°`,
  );
  return { type: "descent", drive, summary, frames, rows: rowsRec.length, arrival: pose1, arrivalFile, quietAtEnd, endBusy: endBusy.busy, dtP50: p(0.5), dtP95: p(0.95), dtMax: dts[dts.length - 1] ?? null };
}

/** ZOOM SWEEP — re-boot the `#f=` hash per heading (no FPV look writer exists; see the docblock). */
async function runZoomSweep(pose, ultra, dir) {
  const leg = pose.leg;
  const stops = [];
  const frames = [];
  for (const headingDeg of leg.headings) {
    const hash = fpvHash({ ...leg.base, headingDeg }, pose.t);
    const url = `${DEV}${pose.path ?? "/"}${hash}`;
    await boot(pose, ultra, url);
    const st = await quiet(Math.max(leg.settleS, 4));
    await sleep(leg.settleS * 1000);
    await stableFrame();
    const shot = await session.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 78,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 0.4 },
    });
    const file = join(dir, `frame-${String(frames.length).padStart(2, "0")}.jpeg`);
    const meta = writeB64(file, shot.data);
    frames.push({ file, ...meta, b64: shot.data, caption: `${headingDeg}°` });
    const m = await measure();
    stops.push({
      headingDeg,
      hash,
      file,
      md5: meta.md5,
      settle: st,
      fpsP50: m.frame.fpsP50 ?? null,
      dtP95: m.frame.dtP95 ?? null,
      calls: m.frame.calls,
      tris: m.frame.tris,
      visible: st.visible,
      seat: m.seat,
      poseRead: m.poseRead,
    });
    console.log(
      `    zoom ${String(headingDeg).padStart(3)}°  fps ${fmt(m.frame.fpsP50, 0)}  calls ${fmtI(m.frame.calls)}  tris ${fmtI(m.frame.tris)}  compass ${fmt(m.poseRead.headingDeg)}°  fov ${fmt(m.poseRead.fovDeg)}°  seat ${fmt(m.seat?.nearMaxResidualM, 2)} m`,
    );
  }
  writeFileSync(join(dir, "leg.json"), JSON.stringify({ type: "zoomSweep", drive: leg.drive, stops }, null, 2));
  writeFileSync(
    join(dir, "leg.csv"),
    ["headingDeg,camHeadingDeg,fpsP50,dtP95,calls,tris,visBld,visGnd,visEnr,seatNearM,fovDeg,md5"]
      .concat(stops.map((s) => [s.headingDeg, s.poseRead?.headingDeg, s.fpsP50, s.dtP95, s.calls, s.tris, s.visible?.bld, s.visible?.gnd, s.visible?.enr, s.seat?.nearMaxResidualM, s.poseRead?.fovDeg, s.md5].join(",")))
      .join("\n"),
  );
  const fovOk = stops.every((s) => Math.abs((s.poseRead?.fovDeg ?? 0) - leg.base.fovDeg) < 1.5);
  check(`${pose.id}: every zoom stop held the long lens (fov ${leg.base.fovDeg}°)`, fovOk, stops.map((s) => fmt(s.poseRead?.fovDeg)).join(" "));
  // The COMPASS heading, not `fpv().yawDeg`: on a boot from a `#f=` hash the FPV basis is
  // reconstructed FROM that heading, so `yawDeg` is the offset from it and reads 0.0 at every
  // stop — measured 2026-09-06. `__cameraStore.headingDeg` is the absolute bearing and tracked
  // all eight stops to 1e-11°.
  const headOk = stops.every((s) => Math.abs(((s.poseRead?.headingDeg ?? -999) - s.headingDeg + 540) % 360 - 180) < 0.5);
  check(`${pose.id}: every stop turned the head to its compass heading`, headOk, stops.map((s) => fmt(s.poseRead?.headingDeg)).join(" "));
  // …and the eight frames must actually DIFFER. Eight identical screenshots would otherwise sail
  // through every check above — the same vacuous-pass shape the time sweep's sun check kills.
  const distinct = new Set(stops.map((s) => s.md5)).size;
  check(`${pose.id}: the eight stops are eight different views`, distinct === stops.length, `${distinct} distinct frames of ${stops.length}`);
  return {
    type: "zoomSweep",
    drive: leg.drive,
    summary: `${stops.length} headings at fov ${leg.base.fovDeg}° · fps p50 ${stops.map((s) => fmt(s.fpsP50, 0)).join("/")}`,
    frames,
    stops,
  };
}

/** TIME SWEEP — one boot, `__timeStore.setTime()` per stop, light snapshot kept per stop. */
async function runTimeSweep(pose, dir) {
  const leg = pose.leg;
  const stops = [];
  const frames = [];
  const hasStore = await session.evalJs(`!!(window.__timeStore && window.__timeStore.getState().setTime)`);
  if (!hasStore) throw new VerifyFailure("__timeStore.setTime absent — the time sweep has no driver");
  for (const t of leg.stops) {
    await session.evalJs(`(window.__timeStore.getState().setTime(${t}), true)`);
    await sleep(leg.settleS * 1000);
    await quiet(4);
    await stableFrame();
    const shot = await session.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 78,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 0.4 },
    });
    const file = join(dir, `frame-${String(frames.length).padStart(2, "0")}.jpeg`);
    const meta = writeB64(file, shot.data);
    const iso = new Date(t).toISOString().slice(11, 19);
    frames.push({ file, ...meta, b64: shot.data, caption: iso });
    const feed = await session.evalJs(FEED(1200));
    const poseRead = await session.evalJs(POSE_READ);
    const light = lightKeys(feed, leg.lightKeys);
    const owner = (leg.ownerFrames ?? []).includes(t);
    stops.push({ t, iso, owner, file, light, poseRead, sunElevDeg: feedNum(feed, "astro.sunElevDeg") ?? feedNum(feed, "ultra.sunElevDeg") });
    console.log(
      `    time ${iso}${owner ? " (OWNER)" : "       "}  sunElev ${fmt(feedNum(feed, "astro.sunElevDeg"), 2)}°  exposure ${fmt(feedNum(feed, "ultra.exposure"), 3)}  key ${fmt(feedNum(feed, "ultra.keyLevel"), 3)}  sky ${fmt(feedNum(feed, "ultra.skyLevel"), 3)}  afterglow ${fmt(feedNum(feed, "ultra.afterglow"), 3)}  shadowCast ${light?.["ultra.shadow.casting"]}`,
    );
  }
  writeFileSync(join(dir, "leg.json"), JSON.stringify({ type: "timeSweep", drive: leg.drive, stops }, null, 2));
  const cols = [...new Set(stops.flatMap((s) => Object.keys(s.light ?? {})))].sort();
  writeFileSync(
    join(dir, "leg.csv"),
    [["t", "iso", "owner", ...cols].join(",")]
      .concat(stops.map((s) => [s.t, s.iso, s.owner ? 1 : 0, ...cols.map((c) => s.light?.[c] ?? "")].join(",")))
      .join("\n"),
  );
  // The stops must actually differ in the light — a sweep where `setTime` did nothing looks like
  // eight identical frames and would otherwise "pass".
  const elevs = stops.map((s) => s.sunElevDeg).filter((v) => typeof v === "number");
  check(
    `${pose.id}: the time sweep MOVED the sun`,
    elevs.length === stops.length && Math.max(...elevs) - Math.min(...elevs) > 1,
    `sun elevation ${fmt(Math.min(...elevs), 2)}° → ${fmt(Math.max(...elevs), 2)}° across ${stops.length} stops`,
  );
  check(
    `${pose.id}: both owner instants sampled`,
    (leg.ownerFrames ?? []).every((t) => stops.some((s) => s.t === t)),
    stops.filter((s) => s.owner).map((s) => s.iso).join(" "),
  );
  return {
    type: "timeSweep",
    drive: leg.drive,
    summary: `${stops.length} instants · sun ${fmt(Math.min(...elevs), 2)}° → ${fmt(Math.max(...elevs), 2)}° · cols ${cols.length}`,
    frames,
    stops,
  };
}

// ─── The run ─────────────────────────────────────────────────────────────────────────────────
const multiUltra = ULTRAS.length > 1;
for (const pose of selected) {
  for (const ultra of ULTRAS) {
    if (Date.now() - runT0 > CAP_MS) {
      note(`TIME CAP (${CAP_MS / 60000} min) reached — stopping before ${pose.id}`);
      break;
    }
    const runId = multiUltra ? `${pose.id}.u${ultra ? 1 : 0}` : pose.id;
    const { url, hash, t } = poseUrl(pose, { dev: DEV, ultra });
    console.log(`\n=== ${runId} ===  ${url}`);
    const row = { id: runId, poseId: pose.id, kind: pose.kind, region: pose.region, tags: pose.tags, ultra, tier: TIER, url, hash, t };
    try {
      row.bootMs = await boot(pose, ultra, url);
      row.settle = await quiet();
      row.stable = await stableFrame();
      // MEASURE FIRST, on the settled LIVE engine (fps, streaming, the seat residuals) — then
      // freeze for the capture. Measuring after the thaw sampled the burst of tiles the frozen
      // drain had held back (2026-09-06k: near residual 44 m at dnipro-fpv-west-sunset, 18 m at
      // fpv-south, and a 0-frame "rAF stalled" on the first pose — all post-thaw artefacts).
      const m = await measure();
      Object.assign(row, m);
      // T94 — freeze BEFORE the capture, thaw after: the capture is then reproducible.
      if (FREEZE) {
        // Phase 1: streaming + rig held, clock LIVE.
        row.freeze = { on: true, ...(await session.evalJs(FREEZE_PHASE1)) };
        check(`${runId}: freezeFrame seam present`, !!row.freeze.held, JSON.stringify(row.freeze.held ?? null));
        // The FROZEN DRAIN. Holding `tiles.update()` stops NEW requests but cannot un-issue the
        // ones already in flight: a tile downloaded before the freeze still resolves and still
        // adds itself to the scene. Under the freeze no replacements are queued, so the counters
        // fall to zero and STAY there — which is the first moment the picture is final. (Without
        // it a capped `quiet()` shot a frame with tiles still landing: 607 px moved between two
        // frozen captures at dnipro-fpv-south, 2026-09-06.)
        row.freeze.drain = await quiet(FREEZE_DRAIN_S, 400);
        // Let the reveal eases of whatever landed during the drain run out on the live clock…
        await sleep(REVEAL_SETTLE_S * 1000);
        // …then phase 2: pin the clock too (a second freeze re-arms with the fuller part set).
        const full = await session.evalJs(FREEZE_ON);
        if (full) row.freeze = { ...row.freeze, parts: full.parts, held: full.held, frozenAtMs: full.frozenAtMs };
        await session.ticks(2);
      }
      const shots = await shoot(pose);
      if (FREEZE && row.freeze?.held) {
        // The SELF-CHECK: shoot the same frozen frame again two rAF later and diff. This is the
        // run's own proof that a `--compare --tolerance 0` failure means the PICTURE changed.
        await session.ticks(2);
        const again = await shoot(pose, true);
        const comp = await getComposer();
        const d = await diffPngs(comp, shots.thumbB64, again.thumbB64, { threshold: 0 });
        row.freeze.selfCheck = d.error
          ? { error: d.error }
          : { differing: d.differing, total: d.total, fraction: d.fraction, maxDelta: d.maxDelta };
        check(
          `${runId}: frozen frame is byte-identical two rAF apart`,
          !d.error && d.differing === 0,
          d.error ?? `${fmtI(d.differing)} / ${fmtI(d.total)} px (${fmt(d.fraction * 100, 3)} %), max channel Δ ${d.maxDelta}`,
        );
      }
      if (FREEZE) row.freeze = { ...row.freeze, thaw: await session.evalJs(FREEZE_OFF) };
      row.files = {
        jpeg: join(OUT_DIR, `${runId}.jpeg`),
        png360: join(OUT_DIR, `${runId}.360.png`),
        json: join(OUT_DIR, `${runId}.json`),
      };
      const fullMeta = writeB64(row.files.jpeg, shots.fullB64);
      const thumbMeta = writeB64(row.files.png360, shots.thumbB64);
      row.jpegBytes = fullMeta.bytes;
      row.png360 = { bytes: thumbMeta.bytes, md5: thumbMeta.md5 };
      row.thumbB64 = shots.thumbB64; // held in memory for the sheet / diff; stripped before write
      writeFileSync(row.files.json, JSON.stringify({ ...row, thumbB64: undefined }, null, 2));

      console.log(
        `  boot ${fmt(row.bootMs / 1000, 1)}s  quiet ${fmt(row.settle.settleMs / 1000, 1)}s${row.settle.capped ? (row.settle.noGround ? "!(no ground tile)" : "!") : ""}  ` +
          `fps ${fmt(m.frame.fpsP50, 0)}  dt ${fmt(m.frame.dtP50)}/${fmt(m.frame.dtP95)}  calls ${fmtI(m.frame.calls)}  ` +
          `tris ${fmtI(m.frame.tris)}  heap ${fmt(m.frame.jsHeapMB, 0)} MB  tier ${m.q?.tier}  ` +
          `vis ${fmtI(row.settle.visible?.bld)}/${fmtI(row.settle.visible?.gnd)}/${fmtI(row.settle.visible?.enr)}  ` +
          `seat ${fmt(m.seat?.nearMaxResidualM, 3)} m  hitches ${m.frame.hitches}`,
      );

      // Structural gates — the numbers above only mean something under these.
      check(`${runId}: rAF alive (not a frozen tab)`, !m.frame.rafStalled && m.frame.frames >= 20, m.frame.rafStalled ? `STALLED after ${m.frame.frames} frames` : `${m.frame.frames} frames`);
      check(`${runId}: welcome overlay gone`, m.welcome.present === false, JSON.stringify(m.welcome));
      check(`${runId}: something was drawn (canvas is not empty)`, m.frame.calls > 0 && m.frame.tris > 0, `${fmtI(m.frame.calls)} calls / ${fmtI(m.frame.tris)} tris`);
      check(`${runId}: scene time is the pinned instant`, m.poseRead.live === false && m.poseRead.timeMs === t, `timeMs=${m.poseRead.timeMs} live=${m.poseRead.live} (want ${t})`);
      if (pose.kind === "fpv") check(`${runId}: FPV is the active view`, m.poseRead.fpvActive === true, JSON.stringify({ yaw: m.poseRead.fpvYawDeg, pitch: m.poseRead.fpvPitchDeg, fov: m.poseRead.fovDeg }));
      if (pose.kind === "orbit" && !pose.leg) {
        const want = parseHash(hash).fields;
        check(`${runId}: camera altitude matches the hash (±15 %)`, Math.abs(m.poseRead.altM - want.altM) / want.altM < 0.15, `${fmtI(m.poseRead.altM)} m vs ${fmtI(want.altM)} m`);
      }

      if (!NO_LEGS && pose.leg) {
        const dir = join(OUT_DIR, runId);
        mkdirSync(dir, { recursive: true });
        console.log(`  leg: ${pose.leg.type}`);
        // A leg is a LIVE-engine measurement. After a freeze/thaw the page is not a clean engine
        // (2026-09-06k: the descent leg recorded 37 app frames and never left the top pose after
        // a frozen capture, while the same requestFly on a never-frozen page flew 31,730 →
        // 1,598 m in 3 s), so a leg that drives THIS page re-boots the pose first. The zoom sweep
        // re-navigates on its own; the time sweep only scrubs the clock.
        if (FREEZE && row.freeze?.held && pose.leg.type === "descent") {
          row.leg_reboot = { bootMs: await boot(pose, ultra, url), settle: await quiet() };
          await stableFrame();
        }
        if (pose.leg.type === "descent") row.leg = await runDescent(pose, dir);
        else if (pose.leg.type === "zoomSweep") row.leg = await runZoomSweep(pose, ultra, dir);
        else if (pose.leg.type === "timeSweep") row.leg = await runTimeSweep(pose, dir);
        // The leg STRIP — one image per leg, so a reviewer scans the motion in one glance.
        if (row.leg?.frames?.length) {
          try {
            const comp = await getComposer();
            const strip = await composeSheet(
              comp,
              row.leg.frames.map((f, i) => ({ b64: f.b64, caption: f.caption ?? `#${i}`, sub: "" })),
              { cols: Math.min(4, row.leg.frames.length), cellW: 400, cellH: 225, title: `${runId} — ${row.leg.type} (${row.leg.summary})` },
            );
            const stripFile = join(dir, "strip.png");
            writeB64(stripFile, strip.data);
            row.leg.strip = stripFile;
            console.log(`  strip → ${stripFile} (${strip.width}×${strip.height})`);
          } catch (e) {
            // Same rule as the contact sheets: the leg's frames and CSV are already on disk.
            const msg = e instanceof Error ? e.message : String(e);
            row.leg.stripError = msg;
            check(`${runId}: leg strip`, false, msg);
          }
        }
        for (const f of row.leg?.frames ?? []) delete f.b64;
        writeFileSync(row.files.json, JSON.stringify({ ...row, thumbB64: undefined }, null, 2));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      bootFailures.push({ id: runId, error: msg, crashEvents: session.crashEvents.splice(0) });
      failures++;
      row.error = msg;
      console.log(`POSE FAILED  ${runId}: ${msg} — replacing the target and continuing`);
      await reattach().catch((err) => note(`reattach after ${runId} failed: ${err.message}`));
    }
    rows.push(row);
    writeArtefacts();
  }
}

// ─── Golden ──────────────────────────────────────────────────────────────────────────────────
if (GOLDEN) {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  let n = 0;
  for (const r of rows) {
    if (!r.files?.png360 || !existsSync(r.files.png360)) continue;
    // Keyed by POSE and ULTRA state (`<id>.u0|u1`), never by the run id: a golden written by a
    // `--ultra both` run must be found by a later `--ultra 0` compare and vice versa.
    copyFileSync(r.files.png360, join(GOLDEN_DIR, `${r.poseId}.u${r.ultra ? 1 : 0}.360.png`));
    n++;
  }
  note(`golden: wrote ${n} thumbnails to ${GOLDEN_DIR}`);
}

// ─── Pixel compare ───────────────────────────────────────────────────────────────────────────
if (COMPARE) {
  const goldenDir = join("verify-shots/golden", COMPARE);
  const comp = await getComposer();
  // The golden run's own per-pose counters (draw calls, triangles) — `verify-shots/sweep/<label>/report.json`.
  const goldenRows = new Map();
  try {
    const gr = JSON.parse(readFileSync(join("verify-shots/sweep", COMPARE, "report.json"), "utf8"));
    for (const row of gr.rows ?? []) goldenRows.set(row.id, row);
  } catch {
    note(`no report.json for golden ${COMPARE} — the draw-count gate is skipped`);
  }
  if (TOLERANCE < 1000) {
    // Say it up front rather than let a reader read a 99 %-different canvas as a regression.
    // The note is written from the run's MEASURED self-checks, never from the fact that --freeze
    // was passed. A frozen run whose self-check failed is exactly the case where "a real canvas
    // gate" would be the vacuous claim: say which poses reproduced and which did not.
    const scRows = rows.filter((r) => r.freeze?.selfCheck);
    const scOk = scRows.filter((r) => r.freeze.selfCheck.differing === 0);
    const scBad = scRows.filter((r) => r.freeze.selfCheck.differing !== 0);
    note(
      FREEZE
        ? `--tolerance ${TOLERANCE} is a canvas gate ONLY as far as this run's own self-checks reach: ` +
          `every capture was taken under __globe.freezeFrame(true) and ${scOk.length}/${scRows.length} poses ` +
          `re-shot BYTE-IDENTICAL two rAF apart` +
          (scBad.length
            ? `. NOT reproducible, so their diffs below are a TREND and not a gate: ` +
              `${scBad.map((r) => `${r.id} (${fmtI(r.freeze.selfCheck.differing)} px)`).join(", ")}`
            : ` (T94)`) +
          `. What it cannot gate either way is BOOT-to-BOOT variance — star phases are Math.random() at ` +
          `construction and tile arrival order varies (T95); compare goldens shot in the same boot for a ` +
          `byte gate, across boots for a trend.`
        : `--tolerance ${TOLERANCE} is a UI-CHROME gate: WITHOUT --freeze the canvas keeps converging past ` +
          `tile quiet — 31-44 % of pixels differ two rAF apart at legacy-orbit (T94, 2026-09-06). ` +
          `Read fraction / maxDelta / the diff image as a trend, or re-run with --freeze.`,
    );
  }
  for (const r of rows) {
    if (!r.thumbB64) continue;
    const gpKeyed = join(goldenDir, `${r.poseId}.u${r.ultra ? 1 : 0}.360.png`);
    const gp = existsSync(gpKeyed) ? gpKeyed : join(goldenDir, `${r.id}.360.png`); // legacy run-id key
    if (!existsSync(gp)) {
      comparisons.push({ id: r.id, ok: false, error: `no golden at ${gp}` });
      check(`${r.id}: golden exists`, false, gp);
      continue;
    }
    // 2026-09-07f — THE DRAW-COUNT GATE: a picture diff at tolerance 0 sits on the streaming
    // noise floor (T95), but the renderer's own counters do not. Same triangles (± 0.5 %) with
    // fewer draw calls (> 2 % or > 3) means whole OBJECTS stopped drawing — the shape of a late
    // child never seated in world space (41 OSM edge objects at the ECEF origin, 37 calls short,
    // hiding inside a 1 % pixel diff). Read from the golden run's report, when it kept one.
    const gRow = goldenRows.get(r.id);
    if (gRow?.frame && r.frame) {
      const gt = gRow.frame.tris, ct = r.frame.tris, gc = gRow.frame.calls, cc = r.frame.calls;
      if (gt > 0 && ct > 0 && gc > 0 && cc > 0 && Math.abs(ct - gt) / gt <= 0.005) {
        const dropped = gc - cc;
        check(
          `${r.id}: draw calls vs golden ${COMPARE} (same triangles ⇒ same objects)`,
          !(dropped > 3 && dropped / gc > 0.02),
          `calls ${fmtI(gc)} → ${fmtI(cc)}, tris ${fmtI(gt)} → ${fmtI(ct)}`,
        );
      }
    }
    const goldenB64 = readFileSync(gp).toString("base64");
    const d = await diffPngs(comp, goldenB64, r.thumbB64, { threshold: 0 });
    if (d.error) {
      comparisons.push({ id: r.id, ok: false, error: d.error });
      check(`${r.id}: diff vs golden ${COMPARE}`, false, d.error);
      continue;
    }
    const diffFile = join(OUT_DIR, `${r.id}.diff.png`);
    writeB64(diffFile, d.diffB64);
    const ok = d.differing <= TOLERANCE;
    comparisons.push({ id: r.id, ok, differing: d.differing, total: d.total, fraction: d.fraction, maxDelta: d.maxDelta, diffFile, goldenMd5: md5(readFileSync(gp)), currentMd5: r.png360.md5 });
    check(
      `${r.id}: diff vs golden ${COMPARE} within tolerance ${TOLERANCE}`,
      ok,
      `${fmtI(d.differing)} / ${fmtI(d.total)} px (${fmt(d.fraction * 100, 3)} %), max channel Δ ${d.maxDelta} → ${diffFile}`,
    );
  }
  writeArtefacts();
}

// ─── Contact sheets ──────────────────────────────────────────────────────────────────────────
if (SHEET) {
  const withThumbs = rows.filter((r) => r.thumbB64);
  const comp = await getComposer();
  for (let i = 0, page = 0; i < withThumbs.length; i += 9, page++) {
    const batch = withThumbs.slice(i, i + 9);
    try {
      const sheet = await composeSheet(
        comp,
        batch.map((r) => ({
          b64: r.thumbB64,
          caption: r.id,
          sub:
            `${r.q?.tier ?? "?"}${r.ultra ? " ultra" : ""} · fps ${fmt(r.frame?.fpsP50, 0)} · ` +
            `dt p95 ${fmt(r.frame?.dtP95)} · ${fmtI(r.frame?.calls)} calls · ${fmtI(r.frame?.tris)} tris` +
            (r.error ? ` · FAILED: ${r.error.slice(0, 60)}` : ""),
        })),
        { cols: 3, cellW: 640, cellH: 360, title: `PLUX visual sweep — ${LABEL} — ${STAMP} — sheet ${page + 1}` },
      );
      const file = join(OUT_DIR, `sheet-${String(page + 1).padStart(2, "0")}.png`);
      const meta = writeB64(file, sheet.data);
      sheets.push({ file, ids: batch.map((r) => r.id), width: sheet.width, height: sheet.height, bytes: meta.bytes });
      console.log(`sheet → ${file} (${sheet.width}×${sheet.height}, ${(meta.bytes / 1024).toFixed(0)} KB)`);
    } catch (e) {
      // A sheet is a CONVENIENCE over artefacts that are already on disk — its failure must not
      // throw away a 14-pose run at the last step (it did exactly that on the first full run).
      const msg = e instanceof Error ? e.message : String(e);
      sheets.push({ file: null, ids: batch.map((r) => r.id), error: msg });
      check(`contact sheet ${page + 1}`, false, msg);
    }
  }
  writeArtefacts();
}

// ─── Done ────────────────────────────────────────────────────────────────────────────────────
for (const r of rows) delete r.thumbB64;
const runMin = writeArtefacts();
console.log(
  `\nwrote ${reportJson}\nwrote ${reportMd}\n` +
    `${rows.length} pose run(s) in ${runMin} min (${((Date.now() - runT0) / 1000 / Math.max(1, rows.length)).toFixed(1)} s each) · ` +
    `${failures} failure(s) · ${bootFailures.length} boot failure(s)`,
);
if (composer) composer.close();
session.close();
await finishVerify(failures === 0 ? 0 : 1);
