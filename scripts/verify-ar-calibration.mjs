// Browser verification for the AR CAMERA OVERLAY + VISUAL CALIBRATION + the GYRO-LED ladder
// (owner order 2026-09-19), on the desktop's phone twin. `verify-ar-look.mjs` stays the regression
// for the 2026-09-07 AR flow; this is everything that is NEW:
//
//   1. the FUSED rung — both Chromium streams interleaved (relative drives, absolute only trims),
//      then THE SWING: a side-to-side sweep with a compass that lags 400 ms must not reach the view;
//   2. the CAM chip (only while AR is on) and the shared-focal `<video>` layout — a synthetic
//      720 × 1280 stream is handed to the element, its box must be f·2·tan(camLong/2) tall and
//      follow a FOV change;
//   3. CALIBRATION — a long press on AR opens it, a drag on the pad moves the VIEW (grab-the-world),
//      CONFIRM persists `ftw:ar-calib:v1` and the view HOLDS, a reload keeps it, RESET forgets it,
//      CANCEL changes nothing.
//
//   node scripts/verify-ar-calibration.mjs [9333] [--no-lean] [--shots]
//
// The desktop's answer is a FUNCTIONAL proxy (the house Chrome has no camera and no compass): that
// the feed really lines up with a street, and what the phones' sensors do under a real swing, are
// the owner's phone's to confirm — DECISIONS 2026-09-19 names them.

import { mkdirSync, writeFileSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const LEAN = !args.includes("--no-lean");
const SHOTS = args.includes("--shots");
const notes = [];
const fails = [];
const ok = (cond, msg) => (cond ? notes.push(`  PASS  ${msg}`) : fails.push(`  FAIL  ${msg}`));
const circ = (a, b) => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.abs(d);
};
const W = 402;
const H = 714;

await ensureBrowser(PORT);
const fpv = byId("dnipro-fpv-south");
const { url } = poseUrl({ ...fpv, path: "/m" });
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
  await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}
await s.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true });

const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
const boot = async () => {
  await s.bootUrl(url);
  await s.waitFor(`!!window.__globe && typeof window.__globe.arLook === "function" && !!window.__cameraStore`, 90_000, "globe up");
  await s.waitFor(`window.__cameraStore.getState().fpvHud !== null`, 60_000, "FPV live");
  await sleep(2500);
  // The sample dispatcher (the unit tests' `euler()` helper): TRUE heading + pitch in a frame yawed
  // `frameYaw` from magnetic north; `absolute` picks the event stream.
  await s.evalJs(`(() => {
    window.__arSend = (absolute, headingTrue, pitch, frameYaw) => {
      const decl = window.__globe.arLook().declinationDeg;
      const alpha = ((-(headingTrue - decl - frameYaw)) % 360 + 360) % 360;
      window.dispatchEvent(new DeviceOrientationEvent(absolute ? "deviceorientationabsolute" : "deviceorientation", { alpha, beta: 90 + pitch, gamma: 0, absolute }));
    };
    // Both Chromium streams at ~60 Hz: the relative one tells the gyro's truth in a frame yawed
    // FRAME; the absolute one CLAIMS absFn(t) — what a magnetometer-fused heading would say.
    // The house Chrome has no camera: answer getUserMedia with a synthetic 720 × 1280 stream, so
    // the overlay's OWN acquisition path runs (constraints → stream → <video> → the per-frame
    // layout → tracks stopped on exit) — the layout must not care where the pixels come from.
    window.__arGum = { calls: [], tracks: [] };
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.__arGum.calls.push(c);
      const cv = document.createElement("canvas");
      cv.width = 720; cv.height = 1280;
      const g = cv.getContext("2d");
      g.fillStyle = "#246"; g.fillRect(0, 0, 720, 1280);
      g.fillStyle = "#fff"; g.fillRect(350, 0, 20, 1280);
      const st = cv.captureStream(15);
      window.__arGum.tracks.push(...st.getTracks());
      return st;
    };
    window.__arRun = (ms, trueFn, absFn, FRAME, withRelative) => new Promise((res) => {
      const t0 = performance.now();
      let worst = 0;
      const tick = () => {
        const t = performance.now() - t0;
        if (withRelative) window.__arSend(false, trueFn(t), 0, FRAME);
        window.__arSend(true, absFn(t), 0, 0);
        // The LADDER's own aim, read synchronously at the sample (the listeners run inside
        // dispatchEvent) — never the HUD mirror: that is written every third frame, and under
        // the 4× CPU throttle ~120 ms of staleness is ~19° of pure MEASUREMENT lag at 157°/s.
        const aim = window.__globe.arLook().aim;
        const want = trueFn(t);
        const d = aim ? ((aim.headingDeg - want) % 360 + 540) % 360 - 180 : 0;
        worst = Math.max(worst, Math.abs(d));
        if (t < ms) setTimeout(tick, 16); else res(worst);
      };
      tick();
    });
    return true;
  })()`);
};
const tap = async (selector, label) => {
  const hit = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  ok(hit === true || hit === "true", `tap ${label} (${selector})`);
  await sleep(200);
};
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync("verify-shots", { recursive: true });
  const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(r.data, "base64"));
};
const state = async () =>
  J(`(() => { const c = window.__cameraStore.getState(); return { h: c.fpvHud?.headingDeg, p: c.fpvHud?.pitchDeg, fov: c.fpvHud?.fovDeg, ar: c.arLook, cam: c.arCam, cal: c.arCalibration, draft: c.arCalDraft, st: c.arLookState }; })()`);
const dbg = async () => J(`window.__globe.arLook()`);
const stored = async () => J(`JSON.parse(localStorage.getItem("ftw:ar-calib:v1") || "null")`);

await boot();
await s.evalJs(`localStorage.removeItem("ftw:ar-calib:v1"), window.__cameraStore.getState().resetArCalibration(), true`);

// ── 0. Before AR: no CAM chip, no overlay ────────────────────────────────────────────────────
{
  const st = await J(`({ cam: !!document.querySelector(".m-cambtn"), feed: !!document.querySelector(".m-arcam"), colH: getComputedStyle(document.body).getPropertyValue("--m-altcol-h").trim() })`);
  ok(st.cam === false && st.feed === false, "AR off: no CAM chip, no feed");
  ok(st.colH === "148px", `the column publishes three cells (${st.colH})`);
}
await tap(".m-arbtn", "the AR chip");
await s.waitFor(`window.__cameraStore.getState().arLook === true`, 8000, "AR armed");

// ── 1. THE FUSED RUNG + THE SWING ────────────────────────────────────────────────────────────
const FRAME = 213;
{
  // three quiet seconds: pair, acquire, leave the fast window
  await s.evalJs(`window.__arRun(3200, () => 100, () => 100, ${FRAME}, true)`);
  const d = await dbg();
  ok(d.aim?.rung === "android-absolute" && d.aim.fused === true, `both streams ⇒ the gyro-led rung (fused ${d.aim?.fused}, trim ${d.aim?.trim})`);
  const h = await state();
  ok(circ(h.h, 100) < 0.6, `the view heads TRUE 100° (got ${h.h.toFixed(2)}°)`);
  // THE SWING: ±60° side to side, 2.4 s per cycle (peak ≈ 157°/s), the compass lagging 400 ms.
  const worstFused = await s.evalJs(`(() => { let y = 100, tp = 0; const sw = (t) => 100 + 60 * Math.sin(2 * Math.PI * t / 2400); const lag = (t) => { const k = 1 - Math.exp(-Math.max(0, t - tp) / 400); tp = t; y += (sw(t) - y) * k; return y; }; return window.__arRun(7200, sw, lag, ${FRAME}, true); })()`);
  const d2 = await dbg();
  ok(Number(worstFused) < 1, `THE SWING: the gyro-led aim never leaves the phone's true heading (worst ${Number(worstFused).toFixed(2)}° over three cycles with the compass lagging 400 ms)`);
  ok(d2.trim.state === "frozen-rate" || d2.trim.state === "trimming" || d2.trim.state === "frozen-field", `the trim stood down during the swing (${d2.trim.state}, rate ${d2.trim.rateDegPerS.toFixed(0)}°/s)`);
  // held still where it began: the heading is where it began — nothing accumulated
  await s.evalJs(`window.__arRun(1500, () => 100, () => 100, ${FRAME}, true)`);
  const h2 = await state();
  ok(circ(h2.h, 100) < 0.8, `after the swing the view is back where it started (got ${h2.h.toFixed(2)}° — no accumulated drift)`);
  // the comparator: the SAME swing through the direct rung (no relative stream) shows the lag
  await tap(".m-arbtn", "AR off (reset the ladder)");
  await tap(".m-arbtn", "AR on");
  await s.evalJs(`window.__arRun(1200, () => 100, () => 100, 0, false)`);
  const worstDirect = await s.evalJs(`(() => { let y = 100, tp = 0; const sw = (t) => 100 + 60 * Math.sin(2 * Math.PI * t / 2400); const lag = (t) => { const k = 1 - Math.exp(-Math.max(0, t - tp) / 400); tp = t; y += (sw(t) - y) * k; return y; }; return window.__arRun(7200, sw, lag, 0, false); })()`);
  ok(Number(worstDirect) > 15, `…the comparator: the direct rung (no relative stream) carries the compass's lag whole (worst ${Number(worstDirect).toFixed(1)}° vs ${Number(worstFused).toFixed(2)}° gyro-led)`);
  await s.evalJs(`window.__arRun(1500, () => 100, () => 100, 0, false)`);
}

// ── 2. The CAM chip + the shared-focal layout ────────────────────────────────────────────────
{
  const st = await J(`({ cam: !!document.querySelector(".m-cambtn"), colH: getComputedStyle(document.body).getPropertyValue("--m-altcol-h").trim(), camY: document.querySelector(".m-cambtn")?.getBoundingClientRect().top, arY: document.querySelector(".m-arbtn")?.getBoundingClientRect().top })`);
  ok(st.cam === true, "AR on: the CAM chip appears");
  ok(st.camY < st.arY && Math.abs(st.arY - st.camY - 52) < 2, `CAM sits one cell above AR (${Math.round(st.arY - st.camY)} px)`);
  ok(st.colH === "200px", `the column publishes four cells to the map window (${st.colH})`);
  await tap(".m-cambtn", "the CAM chip");
  await s.evalJs(`window.__arRun(600, () => 100, () => 100, 0, false)`);
  const v = await J(`({ mode: window.__cameraStore.getState().arCam, video: !!document.querySelector(".m-arcam__video"), pad: !!document.querySelector(".m-arcal__pad"), note: document.querySelector(".m-arcal")?.textContent || "" })`);
  ok(v.mode === "view" && v.video && !v.pad, "CAMERA VIEW: the feed element is up, no calibration pad");
  await s.waitFor(`document.querySelector(".m-arcam__video").videoWidth === 720`, 8000, "the stream reports its frame");
  const gum = await J(`({ n: window.__arGum.calls.length, c: window.__arGum.calls[0], note: document.querySelector(".m-arcal")?.textContent || "" })`);
  ok(gum.n >= 1 && gum.c.audio === false && gum.c.video.facingMode?.ideal === "environment" && gum.c.video.width.ideal === 1280, `the overlay asked for the REAR camera, video only, 720p ideals (${JSON.stringify(gum.c.video)})`);
  ok(/CAMERA ≈ \d+ mm · NOT CALIBRATED — HOLD AR/.test(gum.note), `the view readout ("${gum.note.slice(0, 60)}")`);
  await s.evalJs(`window.__arRun(500, () => 100, () => 100, 0, false)`);
  const lay = await J(`(() => { const v = document.querySelector(".m-arcam__video"); const c = window.__cameraStore.getState(); return { w: parseFloat(v.style.width), h: parseFloat(v.style.height), fov: window.__globe.camera.fov, camLong: c.arCalibration.camLongFovDeg, innerH: window.innerHeight, op: getComputedStyle(v).opacity, z: getComputedStyle(document.querySelector(".m-arcam")).zIndex, pe: getComputedStyle(document.querySelector(".m-arcam")).pointerEvents }; })()`);
  const f = lay.innerH / 2 / Math.tan((lay.fov * Math.PI) / 360);
  const wantH = 2 * f * Math.tan((lay.camLong * Math.PI) / 360);
  ok(Math.abs(lay.h - wantH) < 1.5, `the feed is drawn at the 3D view's pixel focal: ${lay.h.toFixed(1)} px tall for vFov ${lay.fov.toFixed(1)}° / camera ${lay.camLong}° (want ${wantH.toFixed(1)})`);
  ok(Math.abs(lay.w / lay.h - 720 / 1280) < 0.002, `…at the stream's own aspect (${(lay.w / lay.h).toFixed(4)})`);
  ok(lay.z === "1" && lay.pe === "none", `the feed is z ${lay.z}, pointer-events ${lay.pe} — the canvas keeps its gestures`);
  ok(Math.abs(Number(lay.op) - 0.55) < 0.01, `the 3D frame reads through it (opacity ${lay.op})`);
  await shot("ar-cal-01-camera-view");
}

// ── 3. CALIBRATION — the long press, the pad, CONFIRM / reload / RESET / CANCEL ───────────────
const press = async (holdMs) =>
  s.evalJs(`new Promise((res) => { const el = document.querySelector(".m-arbtn"); const r = el.getBoundingClientRect(); const mk = (t) => new PointerEvent(t, { bubbles: true, pointerId: 31, pointerType: "touch", isPrimary: true, clientX: r.left + 22, clientY: r.top + 22 }); el.dispatchEvent(mk("pointerdown")); setTimeout(() => { el.dispatchEvent(mk("pointerup")); el.dispatchEvent(new Event("touchend", { bubbles: true })); el.click(); res(true); }, ${holdMs}); })`);
const padDrag = async (dx, dy) =>
  s.evalJs(`(() => { const el = document.querySelector(".m-arcal__pad"); const mk = (t, x, y) => new PointerEvent(t, { bubbles: true, pointerId: 41, pointerType: "touch", isPrimary: true, clientX: x, clientY: y }); el.dispatchEvent(mk("pointerdown", 200, 380)); for (let i = 1; i <= 10; i++) el.dispatchEvent(mk("pointermove", 200 + (${dx} * i) / 10, 380 + (${dy} * i) / 10)); el.dispatchEvent(mk("pointerup", 200 + ${dx}, 380 + ${dy})); return true; })()`);
{
  await press(750);
  await sleep(300);
  let st = await state();
  ok(st.cam === "calibrate" && st.draft !== null && st.ar === true, `a long press on AR opens CALIBRATION (mode ${st.cam}) — and the trailing click did NOT switch AR off`);
  const ui = await J(`({ pad: !!document.querySelector(".m-arcal__pad"), cross: !!document.querySelector(".m-arcal__cross"), acts: [...document.querySelectorAll(".m-arcal__actions [data-act]")].map((b) => b.dataset.act), padZ: getComputedStyle(document.querySelector(".m-arcal__pad")).zIndex, joyZ: getComputedStyle(document.querySelector(".m-altcol")).zIndex })`);
  ok(ui.pad && ui.cross && ui.acts.join() === "ar-cal-confirm,ar-cal-reset,ar-cal-cancel", `the pad, the cross and CONFIRM / RESET / CANCEL (${ui.acts.join(" · ")})`);
  ok(Number(ui.padZ) < Number(ui.joyZ), `the pad (z ${ui.padZ}) sits UNDER the FPV instruments (z ${ui.joyZ})`);
  // RENDERED geometry, not DOM properties: the panel must clear the mini-map, the AIM stick and the right rail
  const geo = await J(`(() => { const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }; const kids = [...document.querySelector(".m-arcal").children].map((e) => e.getBoundingClientRect()); return { panel: { l: Math.min(...kids.map((k) => k.left)), t: Math.min(...kids.map((k) => k.top)), r: Math.max(...kids.map((k) => k.right)), b: Math.max(...kids.map((k) => k.bottom)) }, mm: r(".mm"), aim: r(".m-joy--aim") ?? r(".m-joy"), col: r(".m-altcol"), text: document.querySelector(".m-arcal").textContent }; })()`);
  const hits = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  ok(/CALIBRATE AR/.test(geo.text) && /YAW/.test(geo.text), `the calibration panel reads ("${geo.text.slice(0, 40)}…")`);
  ok(!hits(geo.panel, geo.mm) && !hits(geo.panel, geo.col), `the panel (${Math.round(geo.panel.l)}–${Math.round(geo.panel.r)} × ${Math.round(geo.panel.t)}–${Math.round(geo.panel.b)}) clears the mini-map and the right rail`);
  ok(!hits(geo.panel, geo.aim), `…and the AIM stick (top ${geo.aim ? Math.round(geo.aim.t) : "?"})`);
  await s.evalJs(`window.__arRun(500, () => 100, () => 100, 0, false)`);
  const before = await state();
  // drag RIGHT 60 px: grab-the-world — the scene goes right, the camera turns LEFT (heading −)
  await padDrag(60, 0);
  await s.evalJs(`window.__arRun(700, () => 100, () => 100, 0, false)`);
  st = await state();
  const f = H / 2 / Math.tan((st.fov * Math.PI) / 360);
  const wantYaw = (-Math.atan(60 / f) * 180) / Math.PI;
  ok(Math.abs(st.draft.yawDeg - wantYaw) < 0.4, `a 60 px drag = ${st.draft.yawDeg.toFixed(2)}° of yaw (one pixel of drag = one pixel of scene: want ${wantYaw.toFixed(2)}°)`);
  ok(circ(st.h, before.h + wantYaw) < 0.8, `the VIEW followed the finger while the phone kept aiming (${before.h.toFixed(2)}° → ${st.h.toFixed(2)}°)`);
  ok((await stored()) === null, "nothing is stored until CONFIRM");
  await shot("ar-cal-02-calibrating");
  // drag DOWN 30 px: the scene goes down, the camera tips UP (pitch +)
  await padDrag(0, 30);
  await s.evalJs(`window.__arRun(500, () => 100, () => 100, 0, false)`);
  st = await state();
  ok(st.draft.pitchDeg > 0.5 && st.p > before.p + 0.5, `a drag down tips the view up (pitch ${before.p.toFixed(2)}° → ${st.p.toFixed(2)}°)`);
  const held = st.h;
  await tap('[data-act="ar-cal-confirm"]', "✓ CONFIRM");
  await s.evalJs(`window.__arRun(600, () => 100, () => 100, 0, false)`);
  st = await state();
  const blob = await stored();
  ok(st.cam === "view" && st.draft === null, `CONFIRM leaves calibration, the feed stays up to judge it (mode ${st.cam})`);
  ok(blob && Math.abs(blob.yawDeg - wantYaw) < 0.5 && blob.pitchDeg > 0.5 && blob.savedAtMs > 0, `stored under ftw:ar-calib:v1 (yaw ${blob?.yawDeg?.toFixed(2)}°, pitch ${blob?.pitchDeg?.toFixed(2)}°)`);
  ok(circ(st.h, held) < 0.5, `the calibrated view did not move at CONFIRM (${held.toFixed(2)}° → ${st.h.toFixed(2)}°)`);
  await s.evalJs(`window.__arRun(4000, () => 100, () => 100, 0, false)`);
  st = await state();
  ok(circ(st.h, held) < 0.5, `…and it HOLDS — the trim does not pull it back (${st.h.toFixed(2)}° after 4 s)`);
  const d = await dbg();
  ok(Math.abs(d.cal.biasYawDeg - blob.yawDeg) < 1e-6 && d.trim.calibrated === true, `the yaw lives in the ladder as a compass BIAS (${d.cal.biasYawDeg.toFixed(2)}°), the trim in its calibrated (slow) mode`);
  const dot = await J(`document.querySelector(".m-arbtn").dataset.cal || ""`);
  ok(dot === "1", "the AR chip carries the calibrated mark");
}
// a RELOAD keeps it (the next session starts calibrated)
{
  await boot();
  let st = await state();
  ok(st.cal.savedAtMs > 0 && Math.abs(st.cal.yawDeg) > 1, `after a reload the stored calibration is loaded (yaw ${st.cal.yawDeg.toFixed(2)}°)`);
  await tap(".m-arbtn", "the AR chip");
  await s.waitFor(`window.__cameraStore.getState().arLook === true`, 8000, "AR armed");
  await s.evalJs(`window.__arRun(1200, () => 100, () => 100, 0, false)`);
  st = await state();
  ok(circ(st.h, 100 + st.cal.yawDeg) < 0.8, `…and applied from the first frame: TRUE 100° reads ${st.h.toFixed(2)}° (= 100 ${st.cal.yawDeg >= 0 ? "+" : "−"} ${Math.abs(st.cal.yawDeg).toFixed(2)})`);
  // CANCEL changes nothing stored
  await press(750);
  await sleep(300);
  await padDrag(-120, 0);
  await tap('[data-act="ar-cal-cancel"]', "✕ CANCEL");
  await s.evalJs(`window.__arRun(600, () => 100, () => 100, 0, false)`);
  const st2 = await state();
  ok(st2.cam === "view" && Math.abs(st2.cal.yawDeg - st.cal.yawDeg) < 1e-9 && circ(st2.h, st.h) < 0.6, `CANCEL: the stored calibration and the view are untouched (${st2.h.toFixed(2)}°)`);
  // RESET forgets it — at once
  await press(750);
  await sleep(300);
  await tap('[data-act="ar-cal-reset"]', "↺ RESET");
  await s.evalJs(`window.__arRun(700, () => 100, () => 100, 0, false)`);
  const st3 = await state();
  ok((await stored()) === null && st3.cal.savedAtMs === 0 && st3.cal.yawDeg === 0, "RESET removed ftw:ar-calib:v1");
  ok(circ(st3.h, 100) < 0.8, `…and the view is the sensors' own again (TRUE 100° reads ${st3.h.toFixed(2)}°)`);
  ok(st3.cam === "calibrate", "RESET stays in calibration mode (ready to calibrate afresh)");
  await tap('[data-act="ar-cal-cancel"]', "✕ CANCEL");
}
// AR off takes the overlay with it; EXIT VIEW unmounts it
{
  await tap(".m-arbtn", "AR off");
  await sleep(300);
  const st = await J(`({ cam: window.__cameraStore.getState().arCam, feed: !!document.querySelector(".m-arcam"), chip: !!document.querySelector(".m-cambtn") })`);
  ok(st.cam === "off" && !st.feed && !st.chip, "AR off: the feed and the CAM chip go with it");
  const tr = await J(`window.__arGum.tracks.map((t) => t.readyState)`);
  ok(tr.length > 0 && tr.every((x) => x === "ended"), `every camera track was STOPPED (${tr.join(", ")}) — the camera is never held past the overlay`);
}

console.log(notes.join("\n"));
if (fails.length) console.log(fails.join("\n"));
console.log(`\nverify-ar-calibration: ${notes.filter((n) => n.startsWith("  PASS")).length} PASS · ${fails.length} FAIL (lean ${LEAN})`);
s.close();
await finishVerify(fails.length ? 1 : 0);
