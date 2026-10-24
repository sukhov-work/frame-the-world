// verify-facade-align-2026-10-24.mjs — F5's PAIRS UI (T172) on dev, the house Chrome, ONE target at a
// time: the DESKTOP legs take the fixture through Upload → place, read the GROUND TRUTH off the
// placed frustum itself (`__globe.facadeAlign().castUv` — where the CURRENT pose says a photo point
// sits on the real buildings), PERTURB the pose the way a GPS would (4 m east, 2 m north, 1 m up,
// 3° of heading), then pick the pairs through the REAL UI — + PAIR → the photo overlay → a click on
// the photo → a click on the building on the globe (the orbit rung, then the FPV rung) — SOLVE, and
// assert the pose lands back on the truth; UNDO takes it back; Escape belongs to the orchestrator
// (the pick cancels, FPV never unwinds). The PHONE legs cover the owner's micro-ask of the same day:
// ✕ EXIT VIEW stays in its seat over the open fullscreen map and one tap leaves both.
//
// Needs `wix dev` on http://localhost:4321 (the window.__* DEV seams). Shots → verify-shots/facade-align-2026-10-24/.
//   FTW_CDP_PORT (9333) · FTW_FA_LEGS=d,m (default both)
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.env.FTW_CDP_PORT ?? 9333);
const APP = process.env.FTW_FA_APP ?? "http://localhost:4321";
const LEGS = (process.env.FTW_FA_LEGS ?? "d,m").split(",");
const SHOTS = "verify-shots/facade-align-2026-10-24";
const FIXTURE = resolve("test/fixtures/facade-pattern.jpg");
const T0 = 1788701556919; // the harnesses' shared noon
const D2R = Math.PI / 180;
const DEV = {
  desktop: { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
  iphone: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
};
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps;
const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const r3 = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
const fmtFails = (fails, ok) => (fails.length ? fails.join(" · ") : ok);
const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
const angDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const M_PER_DEG = 111_320;

/** One CDP target with the page helpers; the emulation is applied BEFORE the first navigation. */
async function openTarget(dev) {
  let target;
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
  trackTarget(PORT, target.id);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.consoleAPICalled") {
      const type = msg.params?.type;
      const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
      if (type === "error" && !/Content Script - Failed to load cookie bridge/.test(text)) consoleErrors.push(text.slice(0, 240));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params?.exceptionDetails;
      // The house profile's extensions throw in THEIR content scripts (verify.md (b0)) — keep the app's only.
      const fromExtension = (d?.url ?? "").startsWith("chrome-extension://") || (d?.stackTrace?.callFrames ?? []).some((f) => (f.url ?? "").startsWith("chrome-extension://"));
      if (!fromExtension) consoleErrors.push("EXCEPTION: " + (d?.exception?.description ?? d?.text ?? "").slice(0, 240));
    }
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
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
  const waitFor = async (expr, timeoutMs, everyMs = 250) => {
    const t0 = Date.now();
    let value;
    while (Date.now() - t0 < timeoutMs) {
      value = await evalJs(expr).catch((e) => ({ evalError: String(e.message ?? e) }));
      if (value && !value.evalError) return { ok: true, value };
      await sleep(everyMs);
    }
    return { ok: false, value };
  };
  const ticks = (n) => evalJs(`new Promise((r) => { let k = ${n}; const f = () => (--k <= 0 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
  const shot = async (name) => {
    await send("Page.bringToFront").catch(() => {});
    const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    writeFileSync(`${SHOTS}/${name}`, Buffer.from(s.data, "base64"));
  };
  const mouse = (type, x, y, opts = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseMoved" ? 0 : undefined, ...opts });
  const click = async (x, y) => {
    await mouse("mouseMoved", x, y, { buttons: 0 });
    await sleep(40);
    await mouse("mousePressed", x, y, { clickCount: 1 });
    await sleep(40);
    await mouse("mouseReleased", x, y, { clickCount: 1 });
  };
  const tap = async (x, y) => {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const escape = async () => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  };
  /** The centre of the first element matching `sel` (client px), or null. */
  const centreOf = (sel) =>
    evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top } : null; })()`);
  /** Click an element by selector — scrolled into its scroll container's view first (the facade
   *  panel is a scrolling aside: a button below its fold has a rect, but a click there lands on
   *  whatever paints under it). */
  const clickSel = async (sel) => {
    await evalJs(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: "center", inline: "nearest" }), true`);
    await ticks(2);
    const c = await centreOf(sel);
    if (!c) return false;
    await click(c.x, c.y);
    return true;
  };
  const camPos = () => evalJs("(() => { const p = window.__globe.camera.position; return [p.x, p.y, p.z]; })()");
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const settleCamera = async (maxMs = 9000) => {
    const t0 = Date.now();
    let last = await camPos();
    await sleep(600);
    while (Date.now() - t0 < maxMs) {
      const p = await camPos();
      if (dist3(p, last) < 0.02) return p;
      last = p;
      await sleep(250);
    }
    return last;
  };
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("DOM.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: dev.width, height: dev.height, deviceScaleFactor: dev.deviceScaleFactor, mobile: dev.mobile });
  if (dev.mobile) {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] });
  }
  await send("Page.bringToFront").catch(() => {});
  const goto = (url) => send("Page.navigate", { url });
  const close = () => { try { ws.close(); } catch { /* gone */ } };
  return { send, evalJs, waitFor, ticks, shot, mouse, click, tap, escape, centreOf, clickSel, camPos, dist3, settleCamera, goto, close, consoleErrors };
}

const results = [];
const runLeg = async (id, name, fn) => {
  const t0 = Date.now();
  try {
    const r = await fn();
    results.push({ id, name, ...r, ms: Date.now() - t0 });
    console.log(`${r.pass ? "PASS" : "FAIL"} [${id}] ${name} — ${r.detail} (${Date.now() - t0} ms)`);
    return r.pass;
  } catch (e) {
    results.push({ id, name, pass: false, detail: `threw: ${e.message}`, ms: Date.now() - t0 });
    console.log(`FAIL [${id}] ${name} — threw: ${e.message}`);
    return false;
  }
};

const FS = "window.__facadeStore.getState()";
const FA = "window.__globe.facadeAlign()";
/** The store's pose RESOLVED to numbers (the unset params fall to the EXIF — the panel's own law). */
const POSE_EXPR = `(() => { const s = ${FS}; const e = s.exif || {}; const g = window.__globe.facadeFrustum.current(); if (!s.placement || !g) return null;
  const c = g.corners; const centre = [0, 1, 2].map((k) => (c[0][k] + c[1][k] + c[2][k] + c[3][k]) / 4); const f = g.forward;
  const d = (centre[0] - g.apex[0]) * f[0] + (centre[1] - g.apex[1]) * f[1] + (centre[2] - g.apex[2]) * f[2];
  const halfW = Math.hypot(c[0][0] - c[1][0], c[0][1] - c[1][1], c[0][2] - c[1][2]) / 2;
  return { lat: s.placement.latDeg, lon: s.placement.lonDeg, headingDeg: s.params.headingDeg ?? e.headingDeg ?? 0, pitchDeg: s.params.pitchDeg ?? e.pitchDeg ?? 0,
    rollDeg: s.rollDeg ?? e.rollDeg ?? 0, hFovDeg: (2 * Math.atan(halfW / d)) * 180 / Math.PI, apexAltM: s.apexAltM ?? null, aboveGroundM: s.apexAboveGroundM ?? null,
    snap: s.poseSnapshot(), pairs: s.pairs.length, pick: s.pairPick, solved: s.solved ? { rmsPx: s.solved.rmsPx, n: s.solved.n, fovSolved: s.solved.fovSolved, planar: s.solved.planar } : null }; })()`;
const journalLast = (t) =>
  t.evalJs("(() => { const e = window.__editJournal?.entries; const l = e && e[e.length - 1]; return l ? { label: l.label, steps: l.steps.length, target: l.steps[0]?.target ?? null, n: e.length } : null; })()");
const mOff = (a, b) => Math.hypot((a.lat - b.lat) * M_PER_DEG, (a.lon - b.lon) * M_PER_DEG * Math.cos(b.lat * D2R));

console.log(`app ${APP} · CDP :${PORT} · legs ${LEGS.join(",")} · fixture ${FIXTURE}`);

// ═══════════════════════════════════════ DESKTOP · the PAIRS UI ═══════════════════════════════════
if (LEGS.includes("d")) {
  const d = await openTarget(DEV.desktop);
  const BOOTED = `!!(window.__globe && window.__globe.camera && window.__globe.facadeFrustum && typeof window.__globe.facadeAlign === "function" && typeof window.__globe.fpv === "function" && window.__facadeStore && window.__editJournal && window.__uploadStore && window.__cameraStore)`;
  /** The product path (T181): Upload → the split dropzone's FACADE half → the fixture on ITS file input. */
  const feedFacadeFixture = async () => {
    if (await d.evalJs(`${FS}.open === true`)) await d.evalJs(`${FS}.closePanel(), true`);
    await d.evalJs(`document.querySelector("[data-open-upload]")?.click(), true`);
    const half = await d.waitFor(`!!document.querySelector(".uf-dropzone--facade input[type=file]")`, 8000, 120);
    if (!half.ok) return "no .uf-dropzone--facade input[type=file]";
    const { root } = await d.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await d.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".uf-dropzone--facade input[type=file]" });
    if (!nodeId) return "no facade file input node";
    await d.send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
    const opened = await d.waitFor(`!!document.querySelector(".uf.ff") && ${FS}.open === true`, 8000, 120);
    return opened.ok ? null : "the facade overlay did not open";
  };
  let truth = null; // the resolved pose the fixture was placed at — the GROUND TRUTH
  let points = []; // [{ u, v, ecef, target }] off the truth frustum against the real buildings
  let perturbed = null; // the snapshot after the GPS-like offset
  try {
    await d.goto(`${APP}/#t=${T0}`);
    const bootOk = await runLeg("d1", "boot — the globe + the F5 seams (facadeAlign, facadeStore, the journal)", async () => {
      const w = await d.waitFor(BOOTED, 90_000, 500);
      if (!w.ok) return { pass: false, detail: "the seams never appeared" };
      await sleep(2500);
      await d.evalJs("(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true");
      await d.evalJs("window.__globe.smoothFlights ? window.__globe.smoothFlights(false) : null");
      const seam = await d.evalJs(`(() => { const a = ${FA}; return { pick: a.pick, pairs: a.pairs, fns: ["castAt", "castUv", "screenOf", "enuOf"].filter((k) => typeof a[k] === "function").length }; })()`);
      return { pass: seam.fns === 4 && seam.pick === "none", detail: `facadeAlign() { pick ${seam.pick}, pairs ${seam.pairs}, ${seam.fns}/4 fns }` };
    });
    if (!bootOk) throw new Error("boot failed");

    const placedOk = await runLeg("d2", "the fixture → review → place → the apex seated, the camera settled", async () => {
      const fed = await feedFacadeFixture();
      if (fed) return { pass: false, detail: fed };
      const rv = await d.waitFor(`${FS}.phase === "review"`, 20_000, 200);
      if (!rv.ok) return { pass: false, detail: `never reached review (${await d.evalJs(`${FS}.phase`)})` };
      await d.evalJs(`${FS}.place(), true`);
      const w = await d.waitFor(`${FS}.phase === "placed" && ${FS}.open === false`, 5000, 100);
      if (!w.ok) return { pass: false, detail: "place() did not reach placed" };
      const apex = await d.waitFor(`(() => { const a = ${FS}.apexAltM; return typeof a === "number" && Number.isFinite(a) && a > 0; })()`, 8000, 50);
      if (!apex.ok) return { pass: false, detail: "the apex never seated" };
      // The apex stands on the ELLIPSOID until the ground tile under it streams in (the 2026-10-23
      // m4 lesson): Dnipro's street is 50–170 m up — a truth read before that is a pose 85 m
      // underground, and the frustum re-seats under the harness's feet a leg later.
      const ground = await d.waitFor(`(() => { const s = ${FS}; const t = (s.apexAltM ?? 0) - (s.apexAboveGroundM ?? 0); return t > 20 ? t : false; })()`, 45_000, 250);
      if (!ground.ok) return { pass: false, detail: "no terrain under the apex after 45 s (the VPN — T98?)" };
      await d.settleCamera(12_000);
      await sleep(1500); // the resnap after the fine tile
      const sec = await d.waitFor(`!!document.querySelector("[data-facade-pair-add]")`, 5000, 100);
      const p = await d.evalJs(POSE_EXPR);
      await d.shot("d2-placed.jpeg");
      return { pass: sec.ok && !!p, detail: `apex ${r2(p?.apexAltM)} m (${r2(p?.aboveGroundM)} over the ground at ${r2(ground.value)} m) · heading ${r2(p?.headingDeg)}° · hFov ${r2(p?.hFovDeg)}° · the PAIRS section rendered ${sec.ok}` };
    });
    if (!placedOk) throw new Error("the facade never placed");

    await runLeg("d3", "the GROUND TRUTH — castUv over a 6×4 grid of the far face against the real buildings: ≥ 6 building hits", async () => {
      const UVS = [];
      for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) UVS.push([(i + 0.5) / 6, (j + 0.5) / 4]);
      const t0 = Date.now();
      while (Date.now() - t0 < 40_000) {
        const hits = await d.evalJs(`(() => { const a = ${FA}; return ${JSON.stringify(UVS)}.map(([u, v]) => { const h = a.castUv(u, v); return h ? { u, v, ecef: h.ecef, target: h.target } : null; }).filter(Boolean); })()`);
        points = hits.filter((h) => h.target);
        if (points.length >= 6) break;
        await sleep(1500);
      }
      truth = await d.evalJs(POSE_EXPR);
      const targets = [...new Set(points.map((p) => p.target))];
      return { pass: points.length >= 6 && !!truth?.snap, detail: `${points.length} building points on ${targets.length} building(s) ${JSON.stringify(targets.slice(0, 3))} · truth heading ${r2(truth?.headingDeg)}°` };
    });
    if (points.length < 6) throw new Error("no ground truth — are the buildings streamed in at the fixture's spot?");

    await runLeg("d4", "PERTURB the pose like a GPS error — 4 m east, 2 m north, 1 m up, +3° heading — the frustum re-seats", async () => {
      const lat = truth.lat + 2 / M_PER_DEG;
      const lon = truth.lon + 4 / (M_PER_DEG * Math.cos(truth.lat * D2R));
      const snap = { lat, lon, altitudeM: truth.aboveGroundM + 1, headingDeg: truth.headingDeg + 3, pitchDeg: truth.pitchDeg, rollDeg: truth.rollDeg, hFovDeg: null };
      const apex0 = truth.apexAltM;
      await d.evalJs(`${FS}.restorePose(${JSON.stringify(snap)}), true`);
      const w = await d.waitFor(`(() => { const a = ${FS}.apexAltM; return typeof a === "number" && Math.abs(a - ${apex0}) > 0.5 ? a : false; })()`, 5000, 50);
      await d.settleCamera(8000);
      const p = await d.evalJs(POSE_EXPR);
      perturbed = p.snap;
      const fails = [];
      if (!w.ok) fails.push(`the apex did not move (${r2(p.apexAltM)} vs ${r2(apex0)})`);
      if (!near(p.apexAltM, apex0 + 1, 0.35)) fails.push(`apex ${r2(p.apexAltM)} ≠ ${r2(apex0 + 1)} ± 0.35`);
      if (!near(mOff(p, truth), Math.hypot(4, 2), 0.05)) fails.push(`offset ${r3(mOff(p, truth))} m ≠ 4.47`);
      // The live readout at the perturbed pose (no pairs yet): nothing to show; the SOLVE is disabled.
      const solveDisabled = await d.evalJs(`(() => { const b = document.querySelector("[data-facade-solve]"); return b ? b.disabled || b.getAttribute("aria-disabled") === "true" : null; })()`);
      if (solveDisabled !== true) fails.push(`SOLVE enabled with 0 pairs (${solveDisabled})`);
      return { pass: fails.length === 0, detail: fmtFails(fails, `offset ${r3(mOff(p, truth))} m · apex ${r2(p.apexAltM)} (+${r2(p.apexAltM - apex0)}) · heading ${r2(p.headingDeg)}° · SOLVE disabled`) };
    });

    /** ONE pair through the real UI: + PAIR → the overlay → a click on the photo at (u, v) → the globe
     *  click at the point's screen position (the CURRENT camera; the point must be visible there),
     *  else the seam completes it. Returns { how, err } — how ∈ ui | seam. */
    const pickPair = async (pt, viaUi = true) => {
      const before = await d.evalJs(`${FS}.pairs.length`);
      if (!(await d.clickSel("[data-facade-pair-add]"))) return { how: "none", err: "no + PAIR button" };
      const ov = await d.waitFor(`${FS}.pairPick === "photo" && !!document.querySelector("[data-facade-pick-img]")`, 3000, 50);
      if (!ov.ok) return { how: "none", err: `the photo overlay did not open (pick ${await d.evalJs(`${FS}.pairPick`)})` };
      await d.ticks(2);
      const img = await d.centreOf("[data-facade-pick-img]");
      await d.click(img.left + pt.u * img.w, img.top + pt.v * img.h);
      const gl = await d.waitFor(`${FS}.pairPick === "globe" && !!${FS}.pendingUv`, 3000, 50);
      if (!gl.ok) return { how: "none", err: "the photo click did not arm the globe half" };
      const uv = await d.evalJs(`${FS}.pendingUv`);
      if (!near(uv[0], pt.u, 0.004) || !near(uv[1], pt.v, 0.004)) return { how: "none", err: `pendingUv ${JSON.stringify(uv.map(r3))} ≠ (${r3(pt.u)}, ${r3(pt.v)})` };
      const hint = await d.evalJs(`!!document.querySelector(".pd-hint")`);
      let how = "seam";
      if (viaUi) {
        const scr = await d.evalJs(`${FA}.screenOf(${JSON.stringify(pt.ecef)})`);
        const vis = scr && scr.x > 420 && scr.x < 1590 && scr.y > 10 && scr.y < 940
          ? await d.evalJs(`(() => { const el = document.elementFromPoint(${scr.x}, ${scr.y}); if (!el || el.tagName !== "CANVAS") return { el: el ? el.className : null }; const h = ${FA}.castAt(${scr.x}, ${scr.y}); return { el: "CANVAS", hit: h }; })()`)
          : null;
        const hitD = vis?.hit ? Math.hypot(vis.hit.ecef[0] - pt.ecef[0], vis.hit.ecef[1] - pt.ecef[1], vis.hit.ecef[2] - pt.ecef[2]) : Infinity;
        if (vis?.el === "CANVAS" && hitD < 0.3) {
          await d.click(scr.x, scr.y);
          how = "ui";
        }
      }
      if (how === "seam") await d.evalJs(`${FS}.completePair(${FA}.enuOf(${JSON.stringify(pt.ecef)}), ${JSON.stringify(pt.target)}), true`);
      const done = await d.waitFor(`${FS}.pairPick === "none" && ${FS}.pairs.length === ${before + 1}`, 3000, 50);
      if (!done.ok) return { how, err: `the pair did not complete (pick ${await d.evalJs(`${FS}.pairPick`)}, pairs ${await d.evalJs(`${FS}.pairs.length`)})` };
      const last = await d.evalJs(`(() => { const p = ${FS}.pairs.at(-1); const want = ${FA}.enuOf(${JSON.stringify(pt.ecef)}); return { enu: p.enu, want, target: p.target ?? null, d: Math.hypot(p.enu[0] - want[0], p.enu[1] - want[1], p.enu[2] - want[2]) }; })()`);
      if (last.d > 0.3) return { how, err: `the pair's ENU is ${r3(last.d)} m off the truth point` };
      return { how, err: null, hint, d: last.d, target: last.target };
    };

    let picked = { ui: 0, seam: 0 };
    await runLeg("d5", "SIX PAIRS through the UI — + PAIR → the photo overlay click → the globe click (the orbit rung) — each lands within 0.3 m of the truth point", async () => {
      const fails = [];
      const notes = [];
      for (const pt of points.slice(0, 6)) {
        const r = await pickPair(pt, true);
        if (r.err) fails.push(r.err);
        else {
          picked[r.how]++;
          notes.push(`${r.how}:${r3(r.d)}m`);
        }
        if (fails.length >= 2) break;
      }
      const n = await d.evalJs(`${FS}.pairs.length`);
      const rows = await d.evalJs(`document.querySelectorAll("[data-facade-pair-row]").length`);
      const thumbDots = await d.evalJs(`document.querySelectorAll(".ff-align__dot, [data-facade-pair-dot]").length`);
      if (n < 6) fails.push(`${n} pairs (want 6)`);
      if (rows !== n) fails.push(`${rows} rows for ${n} pairs`);
      const solveOn = await d.evalJs(`(() => { const b = document.querySelector("[data-facade-solve]"); return b ? !(b.disabled || b.getAttribute("aria-disabled") === "true") : null; })()`);
      if (solveOn !== true) fails.push("SOLVE still disabled at 6 pairs");
      const rmsLine = await d.evalJs(`(() => { const s = document.querySelector(".ff-align"); return s ? (s.textContent.match(/NOW[^P]*PX/) || [null])[0] : null; })()`);
      await d.shot("d5-six-pairs.jpeg");
      return { pass: fails.length === 0, detail: fmtFails(fails, `${n} pairs (${picked.ui} by the globe click, ${picked.seam} by the seam) [${notes.join(" ")}] · ${rows} rows · ${thumbDots} dots · "${rmsLine}"`) };
    });

    let solvedSnap = null;
    /** SOLVE through the button; the pose, the journal, the badges and the status lines read back. */
    const solveAndRead = async () => {
      const j0 = (await journalLast(d))?.n ?? 0;
      if (!(await d.clickSel("[data-facade-solve]"))) return { err: "no SOLVE button" };
      const w = await d.waitFor(`!!${FS}.solved`, 5000, 50);
      if (!w.ok) return { err: `no solve record after SOLVE (${await d.evalJs(`[...document.querySelectorAll(".ff-align__status")].map((e) => e.textContent).join(" | ")`)})` };
      await d.waitFor(`(() => { const a = ${FS}.apexAltM; return typeof a === "number"; })()`, 2000, 50);
      await d.settleCamera(6000);
      const p = await d.evalJs(POSE_EXPR);
      const j = await journalLast(d);
      const dom = await d.evalJs(`(() => { const badges = [...document.querySelectorAll(".ff-panel .uf-badge")].map((b) => b.textContent.trim()); const st = [...document.querySelectorAll(".ff-align__status")].map((e) => e.textContent.replace(/\\s+/g, " ").trim()); return { solvedBadges: badges.filter((t) => t === "SOLVED").length, status: st.join(" | ").slice(0, 220) }; })()`);
      return { p, j, j0, dom, off: mOff(p, truth), dh: angDiff(p.headingDeg, truth.headingDeg), dp: Math.abs(p.pitchDeg - truth.pitchDeg), dr: Math.abs(p.rollDeg - truth.rollDeg) };
    };
    const judge = (r, posM, angDeg, fails) => {
      if (r.off > posM) fails.push(`position ${r3(r.off)} m off the truth (bar ${posM})`);
      if (r.dh > angDeg) fails.push(`heading ${r2(r.p.headingDeg)} vs ${r2(truth.headingDeg)} (bar ${angDeg}°)`);
      if (r.dp > angDeg) fails.push(`pitch ${r2(r.p.pitchDeg)} vs ${r2(truth.pitchDeg)}`);
      if (r.dr > angDeg) fails.push(`roll ${r2(r.p.rollDeg)} vs ${r2(truth.rollDeg)}`);
      if (!near(r.p.apexAltM, truth.apexAltM, Math.max(0.4, posM))) fails.push(`apex ${r2(r.p.apexAltM)} vs ${r2(truth.apexAltM)}`);
      if (r.j?.label !== "solve" || r.j.n !== r.j0 + 1) fails.push(`journal ${JSON.stringify(r.j)} (want one "solve" entry)`);
      if (r.dom.solvedBadges < 1) fails.push(`no SOLVED badge (${r.dom.solvedBadges})`);
      if (!/SOLVED · RMS/.test(r.dom.status)) fails.push(`status "${r.dom.status}"`);
    };
    const fmtSolve = (r) => `off ${r3(r.off)} m · heading Δ ${r3(r.dh)}° · pitch Δ ${r3(r.dp)}° · roll Δ ${r3(r.dr)}° · rms ${r2(r.p.solved?.rmsPx)} px · planar ${r.p.solved?.planar} · ${r.dom.solvedBadges} SOLVED badges · "${r.dom.status}"`;

    await runLeg("d6", "SOLVE on the UI-picked pairs — the pose returns to the truth within the ORBIT click's own noise (≤ 0.75 m · ≤ 0.75°), one journal entry \"solve\", the SOLVED badges, the status line", async () => {
      // Three of the six pairs were picked with real ORBIT clicks from a camera ~60 m back: one
      // screen pixel there spans 0.2–0.3 m on the wall (d5 measured 0.17–0.28 m), so the solve
      // can only be as exact as those world points. The exact-pair twin follows in d6b.
      const fails = [];
      const r = await solveAndRead();
      if (r.err) return { pass: false, detail: r.err };
      solvedSnap = r.p.snap;
      judge(r, 0.75, 0.75, fails);
      await d.shot("d6-solved.jpeg");
      return { pass: fails.length === 0, detail: fmtFails(fails, fmtSolve(r)) };
    });

    await runLeg("d6b", "SOLVE on six EXACT pairs (the seam, the same building points) — the real frustum + the real terrain: ≤ 0.05 m · ≤ 0.05° · RMS < 0.5 px", async () => {
      const fails = [];
      await d.evalJs(`${FS}.clearPairs(), true`);
      // Back to the perturbed pose so the solve has the same distance to cover.
      await d.evalJs(`${FS}.restorePose(${JSON.stringify(perturbed)}), true`);
      await d.settleCamera(5000);
      for (const pt of points.slice(0, 6)) {
        await d.evalJs(`${FS}.startPairPick(), ${FS}.setPendingUv([${pt.u}, ${pt.v}]), ${FS}.completePair(${FA}.enuOf(${JSON.stringify(pt.ecef)}), ${JSON.stringify(pt.target)}), true`);
      }
      const n = await d.evalJs(`${FS}.pairs.length`);
      if (n !== 6) return { pass: false, detail: `${n} seam pairs` };
      const r = await solveAndRead();
      if (r.err) return { pass: false, detail: r.err };
      solvedSnap = r.p.snap;
      judge(r, 0.05, 0.05, fails);
      if (!(r.p.solved?.rmsPx < 0.5)) fails.push(`rms ${r2(r.p.solved?.rmsPx)} px (bar 0.5)`);
      await d.shot("d6b-solved-exact.jpeg");
      return { pass: fails.length === 0, detail: fmtFails(fails, fmtSolve(r)) };
    });

    await runLeg("d7", "UNDO takes the solve back to the perturbed pose (the badges drop, the pairs stay); SOLVE again returns", async () => {
      const fails = [];
      if (!(await d.clickSel("[data-facade-undo]"))) return { pass: false, detail: "no UNDO button" };
      const w = await d.waitFor(`(() => { const s = ${FS}.poseSnapshot(); return s && Math.abs(s.lat - ${perturbed.lat}) < 1e-9 && Math.abs(s.lon - ${perturbed.lon}) < 1e-9 && Math.abs((s.headingDeg ?? 0) - ${perturbed.headingDeg}) < 1e-9; })()`, 4000, 50);
      if (!w.ok) fails.push(`UNDO did not restore the perturbed pose (${JSON.stringify(await d.evalJs(`${FS}.poseSnapshot()`))})`);
      const after = await d.evalJs(`(() => { const badges = [...document.querySelectorAll(".ff-panel .uf-badge")].map((b) => b.textContent.trim()); return { solvedBadges: badges.filter((t) => t === "SOLVED").length, pairs: ${FS}.pairs.length, solved: !!${FS}.solved }; })()`);
      if (after.solvedBadges !== 0) fails.push(`${after.solvedBadges} SOLVED badges after UNDO`);
      if (after.pairs !== 6) fails.push(`${after.pairs} pairs after UNDO (want 6)`);
      await d.clickSel("[data-facade-solve]");
      const back = await d.waitFor(`(() => { const s = ${FS}.poseSnapshot(); return s && Math.abs(s.lat - ${solvedSnap.lat}) < 1e-6 && Math.abs(s.lon - ${solvedSnap.lon}) < 1e-6; })()`, 5000, 50);
      if (!back.ok) fails.push("the second SOLVE did not land on the first's pose");
      return { pass: fails.length === 0, detail: fmtFails(fails, `UNDO → the perturbed pose · 0 SOLVED badges · ${after.pairs} pairs kept · SOLVE again → the solved pose`) };
    });

    await runLeg("d8", "Escape belongs to the orchestrator — the photo overlay cancels on Escape; the globe half too; nothing else unwinds", async () => {
      const fails = [];
      await d.clickSel("[data-facade-pair-add]");
      const ov = await d.waitFor(`${FS}.pairPick === "photo" && !!document.querySelector("[data-facade-pick-img]")`, 3000, 50);
      if (!ov.ok) return { pass: false, detail: "the overlay did not open" };
      await d.ticks(2);
      await d.shot("d8-photo-overlay.jpeg");
      await d.escape();
      const c1 = await d.waitFor(`${FS}.pairPick === "none" && !document.querySelector("[data-facade-pick-img]")`, 2000, 50);
      if (!c1.ok) fails.push("Escape did not cancel the photo half");
      const state1 = await d.evalJs(`(() => ({ phase: ${FS}.phase, fpv: window.__globe.fpv().active, pairs: ${FS}.pairs.length }))()`);
      if (state1.phase !== "placed" || state1.pairs !== 6) fails.push(`after Escape: ${JSON.stringify(state1)}`);
      // the globe half
      await d.clickSel("[data-facade-pair-add]");
      await d.waitFor(`${FS}.pairPick === "photo"`, 2000, 50);
      const img = await d.centreOf("[data-facade-pick-img]");
      await d.click(img.x, img.y);
      const gl = await d.waitFor(`${FS}.pairPick === "globe"`, 2000, 50);
      if (!gl.ok) fails.push("the globe half did not arm");
      const cursor = await d.evalJs(`document.querySelector("canvas.globe-canvas")?.style.cursor ?? document.querySelector("canvas")?.style.cursor`);
      if (cursor !== "crosshair") fails.push(`cursor "${cursor}" while the globe half is armed (want crosshair)`);
      const hint = await d.evalJs(`!!document.querySelector(".pd-hint")`);
      if (!hint) fails.push("no .pd-hint while the globe half is armed");
      await d.escape();
      const c2 = await d.waitFor(`${FS}.pairPick === "none" && !${FS}.pendingUv`, 2000, 50);
      if (!c2.ok) fails.push("Escape did not cancel the globe half");
      const cursor2 = await d.evalJs(`document.querySelector("canvas.globe-canvas")?.style.cursor ?? document.querySelector("canvas")?.style.cursor`);
      if (cursor2 === "crosshair") fails.push("the crosshair stayed after the cancel");
      const state2 = await d.evalJs(`(() => ({ phase: ${FS}.phase, fpv: window.__globe.fpv().active, pairs: ${FS}.pairs.length, mapOpen: window.__minimapStore ? window.__minimapStore.getState().mapWindowOpen : null }))()`);
      if (state2.phase !== "placed" || state2.pairs !== 6 || state2.fpv !== false) fails.push(`after the second Escape: ${JSON.stringify(state2)}`);
      return { pass: fails.length === 0, detail: fmtFails(fails, `both halves cancel on Escape · the crosshair + .pd-hint while the globe half is armed · placed, 6 pairs, orbit untouched`) };
    });

    await runLeg("d9", "FPV — standing at the wall: a pair through the FPV tap rung; Escape cancels a pick WITHOUT leaving FPV", async () => {
      const fails = [];
      await d.evalJs(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${truth.lat}, lonDeg: ${truth.lon}, eyeM: 1.7, headingDeg: ${truth.headingDeg}, pitchDeg: 0, fovDeg: 60 }), true`);
      const inFpv = await d.waitFor(`window.__globe.fpv().active === true`, 15_000, 200);
      if (!inFpv.ok) return { pass: false, detail: "FPV never activated" };
      await d.settleCamera(8000);
      await sleep(800);
      // A fresh truth point (the 7th if the grid gave one; else the first again — the store accepts a repeat, only a solve refuses it).
      const pt = points[6] ?? points[0];
      const r = await pickPair(pt, true);
      if (r.err) fails.push(`FPV pair: ${r.err}`);
      else if (r.how !== "ui") fails.push(`the FPV pair did not go through the tap rung (${r.how}) — the point was off-screen or occluded from the eye`);
      const fpvStill = await d.evalJs(`window.__globe.fpv().active`);
      if (fpvStill !== true) fails.push("FPV ended during the pick");
      // Escape inside FPV while a pick is armed: the pick cancels, FPV stays.
      await d.clickSel("[data-facade-pair-add]");
      const ov = await d.waitFor(`${FS}.pairPick === "photo"`, 3000, 50);
      if (!ov.ok) fails.push("the overlay did not open in FPV");
      await d.escape();
      await sleep(300);
      const after = await d.evalJs(`(() => ({ pick: ${FS}.pairPick, fpv: window.__globe.fpv().active, pairs: ${FS}.pairs.length }))()`);
      if (after.pick !== "none") fails.push(`pick ${after.pick} after Escape`);
      if (after.fpv !== true) fails.push("Escape left FPV instead of cancelling the pick");
      await d.shot("d9-fpv-pair.jpeg");
      return { pass: fails.length === 0, detail: fmtFails(fails, `the FPV pair by the tap rung (${r3(r.d)} m off the truth point, target ${r.target}) · ${after.pairs} pairs · Escape cancelled the pick, FPV held`) };
    });
    await d.shot("d-final.jpeg");
    if (d.consoleErrors.length) console.log(`console errors (desktop): ${d.consoleErrors.slice(0, 5).join(" | ")}`);
  } catch (e) {
    console.log(`desktop aborted: ${e.message}`);
  } finally {
    d.close();
  }
}

// ═══════════════════════════════════════ PHONE · EXIT VIEW over the open map ══════════════════════
if (LEGS.includes("m")) {
  const m = await openTarget(DEV.iphone);
  try {
    await m.goto(`${APP}/m#f=48.4647,35.0462,1.7,25,8,60&t=${T0}`);
    const bootOk = await runLeg("m1", "boot /m straight into FPV (the #f= pose) — the rail shows ✕ EXIT VIEW as the last cell", async () => {
      const w = await m.waitFor(`!!window.__globe && !!window.__cameraStore && !!window.__minimapStore && document.body.classList.contains("m")`, 90_000, 500);
      if (!w.ok) return { pass: false, detail: "the seams never appeared on /m" };
      const fpv = await m.waitFor(`window.__globe.fpv().active === true && window.__cameraStore.getState().tempFpv === true`, 60_000, 500);
      if (!fpv.ok) return { pass: false, detail: `FPV never activated (tempFpv ${await m.evalJs("window.__cameraStore.getState().tempFpv")})` };
      await m.settleCamera(10_000);
      const rail = await m.evalJs(`(() => { const cells = [...document.querySelectorAll(".m-actions > .m-act")]; const last = cells.at(-1); return { n: cells.length, last: last ? { cls: last.className, text: last.textContent.trim() } : null }; })()`);
      await m.shot("m1-fpv.jpeg");
      const ok = rail.last && /m-act--exit/.test(rail.last.cls) && /EXIT VIEW/.test(rail.last.text);
      return { pass: !!ok, detail: `rail ${rail.n} cells · last ${JSON.stringify(rail.last)}` };
    });
    if (bootOk) {
      let seatBefore = null;
      await runLeg("m2", "open the fullscreen map — ✕ EXIT VIEW keeps its EXACT seat over the map (z 24), is the element under its centre, the other cells hide, the map still takes taps beside it", async () => {
        const fails = [];
        seatBefore = await m.centreOf(".m-act--exit");
        if (!seatBefore) return { pass: false, detail: "no .m-act--exit before the map" };
        await m.evalJs("window.__minimapStore.getState().setMapWindowOpen(true), true");
        const open = await m.waitFor(`document.body.classList.contains("mw-open") && !!document.querySelector(".mw-canvas")`, 5000, 50);
        if (!open.ok) return { pass: false, detail: "the map window did not open" };
        await m.ticks(3);
        const seat = await m.centreOf(".m-act--exit");
        if (!seat) fails.push("the exit cell lost its box with the map open");
        else if (!near(seat.x, seatBefore.x, 1) || !near(seat.y, seatBefore.y, 1) || !near(seat.w, seatBefore.w, 1) || !near(seat.h, seatBefore.h, 1)) fails.push(`the seat moved: ${JSON.stringify(seat)} vs ${JSON.stringify(seatBefore)}`);
        const probe = await m.evalJs(`(() => { const exit = document.querySelector(".m-act--exit"); const r = exit.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const under = document.elementFromPoint(cx, cy); const stack = document.querySelector(".m-actions"); const cs = getComputedStyle(stack); const ce = getComputedStyle(exit);
          const others = [...stack.querySelectorAll(".m-act:not(.m-act--exit)")].map((e) => getComputedStyle(e).visibility);
          const beside = document.elementFromPoint(Math.max(8, r.left - 60), cy);
          return { underIsExit: !!under && (under === exit || exit.contains(under)), z: cs.zIndex, stackPe: cs.pointerEvents, exitVis: ce.visibility, exitPe: ce.pointerEvents, others, beside: beside ? (beside.className || beside.tagName) : null, besideIsStack: !!beside && stack.contains(beside) }; })()`);
        if (!probe.underIsExit) fails.push("the element under the exit cell's centre is not the exit cell");
        if (probe.z !== "24") fails.push(`.m-actions z-index ${probe.z} (want 24)`);
        if (probe.exitVis !== "visible") fails.push(`exit visibility ${probe.exitVis}`);
        if (probe.others.some((v) => v !== "hidden")) fails.push(`other cells not hidden: ${JSON.stringify(probe.others)}`);
        if (probe.besideIsStack) fails.push(`a tap 60 px left of the exit cell lands on the rail (${probe.beside}), not the map`);
        await m.shot("m2-map-open-exit.jpeg");
        return { pass: fails.length === 0, detail: fmtFails(fails, `seat ${r2(seat?.x)},${r2(seat?.y)} ${r2(seat?.w)}×${r2(seat?.h)} unchanged · under its centre: itself · z 24 · others ${JSON.stringify(probe.others)} · beside → ${probe.beside}`) };
      });
      await runLeg("m3", "one tap on ✕ EXIT VIEW over the map closes the map AND leaves FPV — the global map", async () => {
        const seat = await m.centreOf(".m-act--exit");
        if (!seat) return { pass: false, detail: "no exit cell to tap" };
        await m.tap(seat.x, seat.y);
        const w = await m.waitFor(`window.__minimapStore.getState().mapWindowOpen === false && window.__cameraStore.getState().tempFpv === false`, 4000, 50);
        await sleep(1200);
        const st = await m.evalJs(`(() => ({ mapOpen: window.__minimapStore.getState().mapWindowOpen, tempFpv: window.__cameraStore.getState().tempFpv, bodyOpen: document.body.classList.contains("mw-open"), fpv: window.__globe.fpv().active }))()`);
        await m.shot("m3-after-exit.jpeg");
        return { pass: w.ok && st.bodyOpen === false, detail: `${JSON.stringify(st)}` };
      });
    }
    if (m.consoleErrors.length) console.log(`console errors (phone): ${m.consoleErrors.slice(0, 5).join(" | ")}`);
  } catch (e) {
    console.log(`phone aborted: ${e.message}`);
  } finally {
    m.close();
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} legs passed`);
await finishVerify(passed === results.length ? 0 : 1);
