// Browser verification for the MOBILE UX BATCH of 2026-09-08b (owner order, five asks):
//   1. the 🧭 AR chip re-seated as the FIRST 44 px cell of the right-rail altitude column, the
//      status bubble TRANSIENT (clears after AR_NOTE_MS; re-shown on rung/stale transitions only);
//   2. 💾 SAVE — a 44 px icon cell, `aria-disabled` while signed out, a one-line hint on tap;
//   3. the FIND / SPOT tabs LIVE (accent dot) while their feature works; a long press toggles it;
//   4. the heatmap's hygiene — the lift DEBOUNCE (an encoder drag = one solve), the disarm
//      cancels in flight, arm/disarm cycles leave nothing running; the sheet altitude is the
//      spring-centred RATE encoder (`.ct-enc`) on /m;
//   5. the two-finger TWIST rotates the map WITH the fingers in 2D and 3D, with and without
//      midpoint drift (the library's inverted drift term cancelled), never in FPV.
//
//   node scripts/verify-mobile-batch-2026-09-08.mjs [9333] [--shots]
//   node scripts/verify-mobile-batch-2026-09-08.mjs 9444 --device [--shots]   # the Pixel over adb
//
// Boots `/m` at the catalogue's `legacy-m` pose on the phone twin (touch, 402×714 @3). Every scalar
// is read from the LIVE engine and stores; the UI is driven through the real buttons and real
// touch events (`Input.dispatchTouchEvent`). Runs on the ONE house Chrome (conventions/verify.md
// §THE RESOURCE BUDGET). Screenshots → verify-shots/ with `--shots`.

import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { createAdbInput } from "./lib/adbInput.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const DEVICE = args.includes("--device");
const SHOTS = args.includes("--shots");

const notes = [];
const fails = [];
// an UNCAUGHT throw (a waitFor time-out) must not lose the notes gathered so far
// (print only — verify-cdp-cleanup's own handler, registered first, reports and exits)
process.on("uncaughtException", () => { console.log(notes.join("\n")); if (fails.length) console.log(fails.join("\n")); });
const ok = (cond, msg) => (cond ? notes.push(`  PASS  ${msg}`) : fails.push(`  FAIL  ${msg}`));
const info = (msg) => notes.push(`  INFO  ${msg}`);
const circ = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

const browser = await ensureBrowser(PORT, { launch: !DEVICE });
const { url } = poseUrl(byId("legacy-m"));
let target;
if (DEVICE) {
  const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
  const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  target = pages.find((t) => /localhost:4321/.test(t.url)) ?? pages[0];
  if (!target) throw new Error("no page tab on the phone — open http://localhost:4321/ in Chrome first (tools/devicefarm/README.md §B)");
  console.log(`attached to the phone tab ${target.id} ${target.url} (${browser.browser})`);
  // 2026-09-08c: CDP `Input.dispatchTouchEvent` (and the synthesize* gestures) HANG on Android
  // Chrome — no answer, ever — while another window holds the focus (the notification shade
  // after a WAKEUP keyevent, the keyguard, a system dialog). Refuse to start rather than time
  // out 90 s into the first twist; `sendevent` is no fallback (the adb shell user is refused
  // /dev/input/event* by SELinux — measured).
  try {
    const win = execFileSync("adb", ["shell", "dumpsys", "window"], { encoding: "utf8" });
    const focus = (win.match(/mCurrentFocus=([^\n]*)/) ?? [])[1] ?? "?";
    if (!/com\.android\.chrome/.test(focus)) throw new Error(`Chrome is not the focused window on the phone (${focus.trim()}) — swipe the shade away / unlock, then re-run`);
    console.log(`phone focus: ${focus.trim()}`);
  } catch (e) {
    if (/not the focused window/.test(String(e.message))) throw e;
    console.log(`(adb focus check skipped: ${String(e.message).split("\n")[0]})`);
  }
} else {
  try {
    target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  } catch {
    target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
  }
  trackTarget(PORT, target.id);
}
const s = await openSession(target);
if (DEVICE) await s.send("Page.bringToFront").catch(() => {});
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync("verify-shots", { recursive: true });
  const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(r.data, "base64"));
};
if (!DEVICE) {
  await s.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
  await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
}
await s.bootUrl(url);
await s.waitFor(`!!window.__globe && typeof window.__globe.bestSpot === "function" && !!window.__bestSpotStore && !!window.__findStore`, 90_000, "globe up");
await sleep(2000);
const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
// THE GLASS (2026-09-08c): on the phone every touch goes through `adb shell input` (real, single
// pointer — scripts/lib/adbInput.mjs says why CDP touch is a mirage there); two-finger gestures
// have no injection path on the device and are INFO lines there (the owner's thumb is the tier).
const glass = DEVICE ? await createAdbInput(s) : null;
if (glass) info(`glass calibrated: dpr ${glass.calibration.dpr}, toolbar offset ${glass.calibration.offY.toFixed(1)} css px (the tap aimed at ${glass.calibration.aimed.map((v) => v.toFixed(0))} landed at ${glass.calibration.landed.x},${glass.calibration.landed.y} ${glass.calibration.landed.type})`);
/** One finger down at (x, y) for `holdMs`, then up — the twin's CDP touch or the phone's real glass. */
const pressAt = async (x, y, holdMs = 700, settleMs = 400) => {
  if (glass) {
    if (holdMs >= 300) await glass.longPress(x, y, holdMs);
    else await glass.tap(x, y);
  } else {
    await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    await sleep(holdMs);
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await sleep(settleMs);
};
/** One finger dragged through CSS points (~16 ms apart on the twin; adb-paced on the phone). */
const dragThrough = async (pts) => {
  if (glass) {
    await glass.drag(pts);
  } else {
    await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0][0], y: pts[0][1], id: 1 }] });
    for (let i = 1; i < pts.length; i++) {
      await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pts[i][0], y: pts[i][1], id: 1 }] });
      await sleep(16);
    }
    await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await sleep(600);
};
const tap = async (selector, label) => {
  const hit = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  ok(hit === true || hit === "true", `tap ${label} (${selector})`);
  await sleep(150);
};
const tapText = async (root, text, label) => {
  const hit = await s.evalJs(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(root)})]; const el = els.find((e) => (e.textContent || "").trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
  ok(hit === true || hit === "true", `tap ${label} ("${text}")`);
  await sleep(150);
};
const rect = async (selector) => J(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
/** A real touch long-press on an element (the uxbatch7 recipe: touchStart → hold → touchEnd). */
const longPress = async (selector, label, holdMs = 700) => {
  const r = await rect(selector);
  ok(r !== null, `long-press target present: ${label}`);
  if (!r) return;
  await pressAt(r.cx, r.cy, holdMs, 250);
};
/** Two fingers turning about (cx, cy) by `deg` in `steps`, radius R; `drift` px of midpoint travel. */
const twist = async (cx, cy, deg, { R = 90, steps = 24, drift = 0 } = {}) => {
  const pts = (thetaDeg, k) => {
    const t = (thetaDeg * Math.PI) / 180;
    const dx = (drift * k) / steps;
    return [
      { x: cx + dx + R * Math.cos(t), y: cy + R * Math.sin(t), id: 1 },
      { x: cx + dx - R * Math.cos(t), y: cy - R * Math.sin(t), id: 2 },
    ];
  };
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(0, 0) });
  await sleep(40);
  for (let i = 1; i <= steps; i++) {
    await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts((deg * i) / steps, i) });
    await sleep(16);
  }
  await sleep(60);
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(700);
};
const mapHeading = async () => J(`(() => { const h = window.__cameraStore.getState().headingDeg; return ((h % 360) + 360) % 360; })()`);

// ── 5a. THE TWIST on the 2D map (first: nothing else is armed yet) ────────────────────────────
if (glass) {
  const mode = await J(`window.__cameraStore.getState().mapMode`);
  ok(mode === "2d", `/m booted into the 2D map (mapMode ${mode})`);
  info("device: the two-finger TWIST / PINCH legs have no injection path on the phone (CDP touch undelivered, `input` single-pointer, sendevent refused) — the twin is their harness tier, the owner's thumb the device tier (T120)");
} else {
  const mode = await J(`window.__cameraStore.getState().mapMode`);
  ok(mode === "2d", `/m booted into the 2D map (mapMode ${mode})`);
  const canvas = await rect("canvas");
  ok(canvas !== null, "the globe canvas is up");
  const cx = canvas.x + canvas.w / 2;
  const cy = canvas.y + canvas.h * 0.45;
  await sleep(1500); // the north lock's own settle
  const h0 = await mapHeading();
  await twist(cx, cy, 30); // clockwise on the glass (screen y-down: atan2 grows)
  const h1 = await mapHeading();
  const d1 = ((h1 - h0 + 540) % 360) - 180;
  ok(d1 < -20 && d1 > -40, `2D: a 30° CLOCKWISE twist turns the map clockwise — the heading DEcreases by ≈30° (${h0.toFixed(1)}° → ${h1.toFixed(1)}°, Δ ${d1.toFixed(1)}°)`);
  await sleep(1200);
  const h1b = await mapHeading();
  ok(circ(h1b, h1) < 1.5, `…and the 2D north lock stands down — the heading STAYS (${h1.toFixed(1)}° → ${h1b.toFixed(1)}° after 1.2 s)`);
  await twist(cx, cy, -30); // counter-clockwise
  const h2 = await mapHeading();
  const d2 = ((h2 - h1b + 540) % 360) - 180;
  ok(d2 > 20 && d2 < 40, `2D: a 30° COUNTER-clockwise twist turns it back (Δ ${d2.toFixed(1)}°)`);
  await shot("mbatch-01-2d-twisted");
  // with midpoint DRIFT (a human twist): the library latches ROTATE from the drift; the net turn
  // must still be the twist alone, in the fingers' direction
  const h3 = await mapHeading();
  await twist(cx, cy, 40, { drift: 36 });
  const h4 = await mapHeading();
  const d4 = ((h4 - h3 + 540) % 360) - 180;
  ok(d4 < -28 && d4 > -52, `2D: a 40° clockwise twist WITH 36 px of midpoint drift still turns ≈40° clockwise (Δ ${d4.toFixed(1)}°) — the library's inverted drift term is cancelled`);
  const zoomBefore = await J(`window.__cameraStore.getState().zoomAltM`);
  await sleep(1000);
  const zoomAfter = await J(`window.__cameraStore.getState().zoomAltM`);
  ok(Math.abs(Math.log(zoomAfter / zoomBefore)) < 0.25, `no runaway zoom from the twists (alt ${Math.round(zoomBefore)} → ${Math.round(zoomAfter)} m)`);
  // a pure PINCH still zooms and does not turn the map
  const hp0 = await mapHeading();
  const zp0 = await J(`window.__cameraStore.getState().zoomAltM`);
  const pinch = (k) => [
    { x: cx - 60 - k * 4, y: cy, id: 1 },
    { x: cx + 60 + k * 4, y: cy, id: 2 },
  ];
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pinch(0) });
  for (let i = 1; i <= 20; i++) {
    await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pinch(i) });
    await sleep(16);
  }
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(900);
  const hp1 = await mapHeading();
  const zp1 = await J(`window.__cameraStore.getState().zoomAltM`);
  ok(zp1 < zp0 * 0.9, `a pinch OUT still zooms in (alt ${Math.round(zp0)} → ${Math.round(zp1)} m)`);
  ok(circ(hp1, hp0) < 2.5, `…and a pinch does not turn the map (heading ${hp0.toFixed(1)}° → ${hp1.toFixed(1)}°)`);
  // 3D: the same twist, same sign
  await tapText(".m-actrow button", "▲ 3D", "the 3D chip");
  await sleep(2500);
  const mode3 = await J(`window.__cameraStore.getState().mapMode`);
  ok(mode3 === "3d", `the map is 3D (mapMode ${mode3})`);
  const g0 = await mapHeading();
  await twist(cx, cy, 30);
  const g1 = await mapHeading();
  const dg = ((g1 - g0 + 540) % 360) - 180;
  ok(dg < -18 && dg > -42, `3D: a 30° clockwise twist turns the globe clockwise too (Δ ${dg.toFixed(1)}°)`);
  await shot("mbatch-02-3d-twisted");
  await tapText(".m-actrow button", "▼ 2D", "the 2D chip");
  await sleep(2500);
}

// ── 6. T127: a stray touch on the /m map KEEPS the look-from-here pin (2026-09-08c) ──────────
// The long press is the glass twin of the desktop dblclick (no dblclick synthesizes from CDP
// touches — on a real phone the native double-tap lands the same `dropTempPinAt`); ✕ CLEAR PIN
// is the one clear. A single tap and a drag elsewhere must leave the pin where it is.
{
  const canvas = await rect("canvas");
  const cx = canvas.x + canvas.w / 2;
  const cy = canvas.y + canvas.h * 0.45;
  const pin = () => J(`(() => { const p = window.__cameraStore.getState().tempPin; return p ? { lat: p.latDeg, lon: p.lonDeg } : null; })()`);
  const same = (a, b) => !!a && !!b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
  /** The chips (◎ LOOK FROM HERE / ✕ CLEAR PIN) sit over the canvas — a "stray" touch must land
   *  on open MAP, not on a chip (the first cut of this leg tapped ✕ CLEAR PIN itself). */
  const onCanvas = (x, y) => J(`(() => { const el = document.elementFromPoint(${x}, ${y}); return el ? el.tagName.toLowerCase() : null; })()`);
  await pressAt(cx, cy);
  const p0 = await pin();
  ok(p0 !== null, `a long press on the 2D map drops the look-from-here pin (${p0 ? `${p0.lat.toFixed(5)}, ${p0.lon.toFixed(5)}` : "none"})`);
  const chips0 = await J(`(() => { const t = document.body.textContent || ""; return { look: /LOOK FROM HERE/.test(t), clear: /CLEAR PIN/.test(t) }; })()`);
  ok(chips0.look && chips0.clear, `the ◎ LOOK FROM HERE + ✕ CLEAR PIN chips show (look ${chips0.look}, clear ${chips0.clear})`);
  // a stray single tap on open map, up and to the left of the pin
  const tx = cx - 120, ty = cy - 110;
  const under = await onCanvas(tx, ty);
  ok(under === "canvas", `the stray-tap point is open map (element under it: ${under})`);
  await pressAt(tx, ty, 40);
  const p1 = await pin();
  ok(same(p0, p1), `a stray single tap elsewhere KEEPS the pin (${p1 ? "kept" : "CLEARED"})`);
  // a drag of the map, starting on open map
  const dx0 = cx - 110, dy0 = cy + 30;
  const underD = await onCanvas(dx0, dy0);
  ok(underD === "canvas", `the drag start is open map (element under it: ${underD})`);
  await dragThrough(Array.from({ length: 9 }, (_, i) => [dx0 + i * 6, dy0 - i * 5]));
  const p2 = await pin();
  ok(same(p0, p2), `a drag of the map KEEPS the pin (${p2 ? "kept" : "CLEARED"})`);
  // a second long press elsewhere MOVES it
  await pressAt(cx - 100, cy - 60);
  const p3 = await pin();
  ok(p3 !== null && !same(p0, p3), `a long press elsewhere MOVES the pin (${p3 ? `${p3.lat.toFixed(5)}, ${p3.lon.toFixed(5)}` : "none"})`);
  await shot("mbatch-06-pin-kept");
  // ✕ CLEAR PIN is the clear
  await tapText(".m-actrow button, .m-act", "✕ CLEAR PIN", "✕ CLEAR PIN");
  await sleep(300);
  const p4 = await pin();
  ok(p4 === null, `✕ CLEAR PIN clears it (${p4 ? "still set" : "cleared"})`);
  if (DEVICE) {
    // the native double-tap on real glass: a READ (the twin cannot synthesize dblclick)
    await glass.doubleTap(cx - 40, cy - 40);
    const p5 = await pin();
    info(`device: a real double-tap ${p5 ? "SETS the pin (native dblclick)" : "did not set a pin (dblclick not synthesized by this CDP touch shape)"}`);
    if (p5) {
      await tapText(".m-actrow button, .m-act", "✕ CLEAR PIN", "✕ CLEAR PIN (after the double-tap)");
      await sleep(300);
    }
  }
}

// ── 3a. The tab bar: nothing live at boot; FIND long-press out of FPV opens the sheet ─────────
{
  const live = await J(`[...document.querySelectorAll(".m-tab")].map((b) => b.classList.contains("m-tab--live"))`);
  ok(live.every((v) => v === false), `no tab is live at boot (${live.join(",")})`);
  const labels = await J(`[...document.querySelectorAll(".m-tab")].map((b) => b.getAttribute("aria-label"))`);
  ok(labels[2] === "FIND — hold to switch on" && labels[4] === "SPOT — hold to switch on", `the hold affordance is announced (${labels[2]} · ${labels[4]})`);
  await longPress(".m-tab:nth-child(3)", "the FIND tab (out of FPV)");
  const st = await J(`(() => ({ sheet: !!document.querySelector('.m-sheet[aria-label="FIND IN FRAME"]') || /LOOK-FROM-HERE|YOUR FRAME IS THE QUERY/.test(document.body.textContent || ""), findOpen: window.__findStore.getState().open, tab: document.querySelector(".m-tab--on")?.textContent?.trim() }))()`);
  ok(st.sheet, "out of FPV the long press OPENS the FIND sheet (its copy says to enter the view)");
  ok(/FIND/.test(st.tab || ""), `the FIND tab is selected (${st.tab})`);
  await tap(".m-tab:nth-child(1)", "SCENE (collapse)");
}

// ── 3b. SPOT: CENTRE HERE + long-press ARMS (a centre exists), the tab glows, long-press disarms ─
await tap(".m-tab:nth-child(5)", "the SPOT tab");
await tapText(".m-sheet__body button", "◎ CENTRE HERE", "CENTRE HERE");
await tap(".m-tab:nth-child(1)", "SCENE (collapse the sheet)");
{
  const before = await J(`(() => { const b = window.__bestSpotStore.getState(); return { open: b.open, on: b.heatmapOn, live: document.querySelector(".m-tab:nth-child(5)").classList.contains("m-tab--live") }; })()`);
  ok(before.open === true && before.on === false && before.live === false, `open (sticky) but OFF and dark before the hold (open ${before.open}, on ${before.on}, live ${before.live})`);
  await longPress(".m-tab:nth-child(5)", "the SPOT tab (arm)");
  const after = await J(`(() => { const b = window.__bestSpotStore.getState(); return { open: b.open, on: b.heatmapOn, live: document.querySelector(".m-tab:nth-child(5)").classList.contains("m-tab--live"), sheet: !!document.querySelector('.m-sheet[aria-label="BEST SPOT"]'), label: document.querySelector(".m-tab:nth-child(5)").getAttribute("aria-label"), on5: document.querySelector(".m-tab:nth-child(5)").classList.contains("m-tab--on") }; })()`);
  ok(after.on === true && after.open === true, `the long press ARMED the heatmap without the sheet (on ${after.on}, open ${after.open})`);
  ok(after.live === true, "…and the SPOT tab is LIVE (accent dot)");
  ok(after.sheet === false && after.on5 === false, "…with the sheet still collapsed and the tab not selected");
  ok(after.label === "SPOT — working; hold to switch off", `the affordance flips (${after.label})`);
  const dot = await J(`(() => { const g = document.querySelector(".m-tab--live .m-tab__glyph"); if (!g) return null; const cs = getComputedStyle(g, "::after"); return { w: cs.width, bg: cs.backgroundColor, content: cs.content }; })()`);
  ok(dot && dot.w === "6px" && dot.bg !== "rgba(0, 0, 0, 0)", `the dot is painted (${dot?.w}, ${dot?.bg})`);
  await shot("mbatch-03-spot-live");
  // it solves: the engine's readiness hold, then a job
  // T118's readiness hold caps at `BESTSPOT.holdMaxMs` 30 s (2026-09-08c) — on the phone (a slow
  // connection) the first post can sit at the cap; the twin never does.
  await s.waitFor(`window.__globe.bestSpot().jobs >= 1`, DEVICE ? 50_000 : 30_000, "a solve posted after the long-press arm");
  await s.waitFor(`window.__bestSpotStore.getState().ladderRung >= 0`, DEVICE ? 60_000 : 40_000, "first ink");
  const feed = await J(`(() => { const f = window.__globe.bestSpot(); return { jobs: f.jobs, inFlight: f.inFlight, rung: window.__bestSpotStore.getState().ladderRung }; })()`);
  ok(feed.rung >= 0, `the field landed (rung ${feed.rung}, jobs ${feed.jobs})`);
  // long-press again: DISARM — the ink goes, the tab goes dark, nothing runs
  await longPress(".m-tab:nth-child(5)", "the SPOT tab (disarm)");
  await sleep(400);
  const off = await J(`(() => { const b = window.__bestSpotStore.getState(); const f = window.__globe.bestSpot(); return { open: b.open, on: b.heatmapOn, live: document.querySelector(".m-tab:nth-child(5)").classList.contains("m-tab--live"), inFlight: f.inFlight, rung: b.ladderRung, topK: b.topK.length }; })()`);
  ok(off.on === false && off.open === true, `disarmed, the window stays open — a tab, not a segment (on ${off.on}, open ${off.open})`);
  ok(off.live === false, "the tab is dark again");
  ok(off.inFlight === 0 && off.rung === -1 && off.topK === 0, `nothing in flight, the mirror cleared (inFlight ${off.inFlight}, rung ${off.rung}, topK ${off.topK})`);
}

// ── 4a. Arm/disarm ×5 through the tab: one solve per arm, never a leak of jobs ────────────────
{
  const j0 = await J(`window.__globe.bestSpot().jobs`);
  for (let i = 0; i < 5; i++) {
    await longPress(".m-tab:nth-child(5)", `arm #${i + 1}`, 650);
    await sleep(350);
    await longPress(".m-tab:nth-child(5)", `disarm #${i + 1}`, 650);
    await sleep(250);
  }
  const f = await J(`(() => { const f = window.__globe.bestSpot(); return { jobs: f.jobs, inFlight: f.inFlight, disposes: f.workerDisposes, spawned: f.workerSpawned }; })()`);
  ok(f.jobs - j0 <= 5, `five arm/disarm cycles cost at most five solves (${f.jobs - j0})`);
  ok(f.inFlight === 0, `nothing left in flight after the cycles (${f.inFlight})`);
  ok(f.disposes === 0 && f.spawned === true, `inside the idle dwell the worker stays warm (disposes ${f.disposes}, spawned ${f.spawned})`);
  const heap = await J(`performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1`);
  info(`JS heap after the cycles: ${heap} MB`);
}

// ── 4b. The lift ENCODER on the sheet: a drag writes at frame rate, the feed posts ONE solve ──
await longPress(".m-tab:nth-child(5)", "arm for the encoder leg", 650);
await sleep(glass ? 1000 : 0); // the phone: past the long-press's trailing-click swallow (900 ms)
await tap(".m-tab:nth-child(5)", "open the SPOT sheet");
try {
  await s.waitFor(`!!document.querySelector(".m-sheet__body .ct-enc")`, 5_000, "the SPOT sheet with the encoder");
} catch {
  info("the SPOT sheet did not show on the first tap — tapping again");
  await tap(".m-tab:nth-child(5)", "open the SPOT sheet (retry)");
  await s.waitFor(`!!document.querySelector(".m-sheet__body .ct-enc")`, 8_000, "the SPOT sheet with the encoder (retry)");
}
await s.waitFor(`window.__bestSpotStore.getState().ladderRung >= 0`, DEVICE ? 60_000 : 40_000, "ink before the drag");
await sleep(700); // the sheet's 400 ms slide-in — a rect read mid-animation misses the track
{
  const enc = await rect(".m-sheet__body .ct-enc .uf-slider__track");
  ok(enc !== null, "the sheet altitude row is the RATE encoder (.ct-enc)");
  const legacy = await J(`!!document.querySelector('.m-sheet__body [aria-label="Sheet altitude above the ground"]')`);
  ok(legacy, "…with the same ARIA name");
  const centre = await J(`(() => { const c = document.querySelector(".m-sheet__body .ct-enc__centre"); return c ? getComputedStyle(c).width : null; })()`);
  ok(centre === "1px", `the centre tick is painted (${centre})`);
  const before = await J(`(() => { const f = window.__globe.bestSpot(); const b = window.__bestSpotStore.getState(); return { jobs: f.jobs, lift: b.liftM, debounced: f.lift.debounced }; })()`);
  // hold the knob at 85 % of the track for 700 ms — a steady climb — then release (the spring)
  const x = enc.x + enc.w * 0.85;
  const y = enc.cy;
  await pressAt(x, y, 700, 120);
  const mid = await J(`(() => { const f = window.__globe.bestSpot(); const b = window.__bestSpotStore.getState(); return { jobs: f.jobs, lift: b.liftM, defer: f.lift.deferFrames, pending: f.lift.pendingT1 }; })()`);
  ok(mid.lift > before.lift + 0.5, `the encoder LIFTED the sheet (liftM ${before.lift.toFixed(2)} → ${mid.lift.toFixed(2)} m)`);
  ok(mid.defer > 10, `the frame-rate writes were DEFERRED by the debounce (${mid.defer} frames waited)`);
  await sleep(1200); // past the coast-out and the debounce
  const after = await J(`(() => { const f = window.__globe.bestSpot(); const b = window.__bestSpotStore.getState(); return { jobs: f.jobs, lift: b.liftM, debounced: f.lift.debounced, pending: f.lift.pendingT1, inFlight: f.inFlight }; })()`);
  ok(after.jobs - before.jobs <= 2, `the whole drag cost ${after.jobs - before.jobs} solve(s) — not one per frame`);
  ok(after.pending === null, "the trailing edge posted (no lift still waiting)");
  ok(after.lift >= mid.lift, `release COASTS out, never snaps back (${mid.lift.toFixed(2)} → ${after.lift.toFixed(2)} m)`);
  const knob = await J(`(() => { const k = document.querySelector(".m-sheet__body .ct-enc .uf-slider__knob"); return k ? k.style.left : null; })()`);
  ok(knob === "50%", `the knob sprang back to centre (${knob})`);
  await shot("mbatch-04-encoder");
  // the DRONE badge rides the readout past 5 m
  if (after.lift + 1.7 >= 5) {
    const badge = await J(`/▲ DRONE/.test(document.querySelector(".m-sheet__body .ct-enc")?.textContent || "")`);
    ok(badge, "the ▲ DRONE badge is on the encoder row above 5 m");
  }
  // reset: double-tap → eye level
  await s.evalJs(`(() => { const t = document.querySelector(".m-sheet__body .ct-enc .uf-slider__track"); t.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return true; })()`);
  await sleep(600);
  const reset = await J(`window.__bestSpotStore.getState().liftM`);
  ok(reset === 0, `double-tap resets to eye level (liftM ${reset})`);
}
// the showing sheet covers the tab row — close it first, then the hold disarms
await tap(".m-sheet__x", "the SPOT sheet's ×");
await sleep(500);
await longPress(".m-tab:nth-child(5)", "disarm after the encoder leg", 650);
{
  const st = await J(`(() => { const b = window.__bestSpotStore.getState(); return { on: b.heatmapOn, live: document.querySelector(".m-tab:nth-child(5)").classList.contains("m-tab--live") }; })()`);
  ok(st.on === false && st.live === false, `disarmed after the encoder leg (on ${st.on}, live ${st.live})`);
}

// ── 1 + 2. FPV: the right rail — AR first cell, ⤒, ⤓, then 💾 SAVE below; the bubble clears ──
await tapText(".m-act", "◎ LOOK FROM HERE", "LOOK FROM HERE");
await s.waitFor(`window.__cameraStore.getState().fpvHud !== null`, 30_000, "FPV live");
await sleep(1500);
{
  const col = await J(`(() => {
    const col = document.querySelector(".m-altcol"); if (!col) return null;
    const r = col.getBoundingClientRect();
    const cells = [...col.children].map((c) => { const b = c.querySelector("button") || c; const cr = b.getBoundingClientRect(); return { cls: b.className, w: cr.width, h: cr.height, x: cr.left, y: cr.top }; });
    const save = document.querySelector(".m-actions .m-act--icon"); const sr = save ? save.getBoundingClientRect() : null;
    const float = document.querySelector(".m-arfloat");
    return { top: r.top, h: r.height, right: innerWidth - r.right, cells, save: sr ? { w: sr.width, h: sr.height, x: sr.left, y: sr.top, dis: save.getAttribute("aria-disabled"), text: save.textContent } : null, float: float ? getComputedStyle(float).position : null, token: getComputedStyle(document.documentElement).getPropertyValue("--m-altcol-h").trim() };
  })()`);
  ok(col !== null, "the altitude column is up in FPV");
  ok(col.cells.length === 3, `three cells in the column (${col.cells.length})`);
  ok(/m-arbtn/.test(col.cells[0].cls) && /m-alt/.test(col.cells[1].cls) && /m-alt/.test(col.cells[2].cls), `AR is the FIRST cell, then ⤒ ⤓ (${col.cells.map((c) => c.cls.split(" ")[0]).join(" · ")})`);
  ok(col.cells.every((c) => Math.abs(c.w - 44) < 1 && Math.abs(c.h - 44) < 1), `every cell is 44 × 44 (${col.cells.map((c) => `${c.w.toFixed(0)}×${c.h.toFixed(0)}`).join(" ")})`);
  ok(col.cells[0].y < col.cells[1].y && col.cells[1].y < col.cells[2].y, "stacked top → bottom: AR above ⤒ above ⤓");
  const xs = col.cells.map((c) => c.x);
  ok(Math.max(...xs) - Math.min(...xs) < 1, `the three cells share one x — one column (${xs.map((v) => v.toFixed(0)).join(",")})`);
  ok(Math.abs(col.h - 148) < 1.5 && col.token === "148px", `the column box is the published --m-altcol-h (${col.h.toFixed(1)} px, token ${col.token})`);
  ok(col.save !== null, "💾 SAVE is in the actions column below");
  ok(col.save && Math.abs(col.save.w - 44) < 1 && Math.abs(col.save.h - 44) < 1, `…at 44 × 44 (${col.save?.w.toFixed(0)}×${col.save?.h.toFixed(0)})`);
  ok(col.save && Math.abs(col.save.x - xs[0]) < 1, `…in the same x as the altitude cells (${col.save?.x.toFixed(0)} vs ${xs[0].toFixed(0)})`);
  ok(col.save && col.save.y > col.cells[2].y, "…below the ⤓ cell");
  ok(col.save && col.save.dis === "true", `signed out: the save cell is aria-disabled (${col.save?.dis})`);
  ok(col.save && /SAVE/.test(col.save.text) && !/SIGN IN/.test(col.save.text), `…labelled SAVE, not SIGN IN TO SAVE (${col.save?.text.trim()})`);
  ok(col.right < 20, `the column hugs the right edge (${col.right.toFixed(1)} px)`);
  await shot("mbatch-05-fpv-rail");
  // the signed-out tap: a hint in the column, no navigation
  const href0 = await J(`location.href`);
  await tap(".m-actions .m-act--icon", "the dimmed SAVE cell");
  await sleep(200);
  const hint = await J(`(() => { const n = document.querySelector('.m-actions [role="status"]'); return { text: n ? n.textContent : null, href: location.href }; })()`);
  ok(hint.text !== null && /SIGN IN/.test(hint.text), `a brief hint says to sign in (${hint.text})`);
  ok(hint.href === href0, "…and nothing navigated to the login");
  await shot("mbatch-06-save-hint");
  await sleep(4300);
  const gone = await J(`document.querySelector('.m-actions [role="status"]') === null`);
  ok(gone, "the hint clears on its own (4 s)");
}
// AR: the note shows on arming, then CLEARS; a stale transition re-shows it; off clears
{
  const noteBefore = await J(`!!document.querySelector(".m-arnote")`);
  ok(noteBefore === false, "no AR bubble before the tap");
  await tap(".m-arbtn", "the AR chip");
  await sleep(300);
  let st = await J(`(() => ({ on: window.__cameraStore.getState().arLook, note: document.querySelector(".m-arnote")?.textContent || "" }))()`);
  if (!st.on) {
    info(`the tap did not arm AR on this Chrome (permission) — arming through the store (note "${st.note.slice(0, 40)}")`);
    await s.evalJs(`window.__cameraStore.getState().setArLook(true)`);
    await sleep(300);
    st = await J(`(() => ({ on: window.__cameraStore.getState().arLook, note: document.querySelector(".m-arnote")?.textContent || "" }))()`);
  }
  ok(st.on === true, "AR is on");
  const floatPos = await J(`(() => { const f = document.querySelector(".m-arfloat"); if (!f) return null; const r = f.getBoundingClientRect(); const c = document.querySelector(".m-altcol").getBoundingClientRect(); return { pos: getComputedStyle(f).position, above: r.bottom <= c.top + 1, colH: c.height }; })()`);
  ok(floatPos && floatPos.pos === "absolute" && floatPos.above, `the bubble FLOATS above the column (${floatPos?.pos}, above ${floatPos?.above})`);
  ok(floatPos && Math.abs(floatPos.colH - 148) < 1.5, `…and the column box did not grow with it (${floatPos?.colH.toFixed(1)} px)`);
  await shot("mbatch-07-ar-note");
  // On the desktop twin there are no sensors: the mirror reads STALE with 0 samples — deferred
  // behind the armed hint, then sticky (an action the user must take). It must NOT clear.
  await sleep(4200);
  const stale = await J(`(() => ({ st: window.__cameraStore.getState().arLookState, note: document.querySelector(".m-arnote")?.textContent || "" }))()`);
  if (stale.st && stale.st.stale) {
    ok(/NO SENSOR DATA/.test(stale.note), `stale with no sample → the sticky stale line stays up ("${stale.note.slice(0, 40)}…")`);
    // now a rung LANDS: the line changes to the rung, then CLEARS
    await s.evalJs(`(() => {
      const decl = window.__globe.arLook().declinationDeg;
      const send = () => { const ev = new DeviceOrientationEvent("deviceorientationabsolute", { alpha: ((-(120 - decl)) % 360 + 360) % 360, beta: 85, gamma: 0, absolute: true }); window.dispatchEvent(ev); };
      window.__arPump = setInterval(send, 16); send(); return true;
    })()`);
    await sleep(700);
    const rung = await J(`document.querySelector(".m-arnote")?.textContent || ""`);
    ok(/COMPASS · TRUE NORTH/.test(rung), `a rung landing RE-SHOWS the bubble with the rung line ("${rung.slice(0, 40)}…")`);
    await sleep(4000);
    const cleared = await J(`document.querySelector(".m-arnote") === null`);
    ok(cleared, "…and the bubble CLEARS after AR_NOTE_MS while the phone keeps streaming (the view is the point)");
    const still = await J(`window.__cameraStore.getState().arLookState?.stale === false`);
    ok(still, "…with AR still live underneath (not stale)");
    await shot("mbatch-08-ar-cleared");
    // the sensors die → stale → the bubble is BACK (an important change), and stays
    await s.evalJs(`(() => { clearInterval(window.__arPump); return true; })()`);
    await sleep(2600);
    const back = await J(`document.querySelector(".m-arnote")?.textContent || ""`);
    ok(/NO SENSOR DATA/.test(back), `the sensors dying RE-SHOWS it, sticky ("${back.slice(0, 40)}…")`);
  } else {
    info("this Chrome delivered sensor data — the stale legs are skipped");
  }
  await tap(".m-arbtn", "the AR chip (off)");
  await sleep(200);
  const offNote = await J(`document.querySelector(".m-arnote") === null`);
  ok(offNote, "switching AR off clears the bubble");
}
// FPV: the twist must do NOTHING (the second finger is the FOV pinch)
if (glass) info("device: the FPV twist leg is twin-only (no two-finger injection on the phone)");
else {
  const canvas = await rect("canvas");
  const h0 = await J(`window.__cameraStore.getState().fpvHud.headingDeg`);
  const f0 = await J(`window.__cameraStore.getState().fpvHud.fovDeg`);
  await twist(canvas.x + canvas.w / 2, canvas.y + canvas.h * 0.4, 30);
  const h1 = await J(`window.__cameraStore.getState().fpvHud.headingDeg`);
  const f1 = await J(`window.__cameraStore.getState().fpvHud.fovDeg`);
  ok(circ(h1, h0) < 3, `FPV: a twist does not turn the view (${h0.toFixed(1)}° → ${h1.toFixed(1)}°)`);
  ok(Math.abs(f1 - f0) < 1.5, `FPV: a pure twist is not a pinch either (FOV ${f0.toFixed(1)} → ${f1.toFixed(1)})`);
}

// ── 3c. FIND in FPV: long-press arms the scan (live), long-press again stands it down ─────────
{
  // The 3a leg opened the FIND sheet once, so `find.open` is STICKY true already and, now in
  // FPV with the moon chip on by default, the scan is LIVE — exactly what the tab must show.
  const before = await J(`(() => ({ open: window.__findStore.getState().open, live: document.querySelector(".m-tab:nth-child(3)").classList.contains("m-tab--live") }))()`);
  ok(before.open === true && before.live === true, `FIND is LIVE in FPV after its sheet was visited once (open ${before.open}, live ${before.live})`);
  await longPress(".m-tab:nth-child(3)", "the FIND tab (stand down)");
  const off = await J(`(() => ({ open: window.__findStore.getState().open, live: document.querySelector(".m-tab:nth-child(3)").classList.contains("m-tab--live"), ghosts: window.__findStore.getState().ghosts.length, label: document.querySelector(".m-tab:nth-child(3)").getAttribute("aria-label") }))()`);
  ok(off.open === false && off.live === false && off.ghosts === 0, `stood down without the sheet: open ${off.open}, live ${off.live}, ghosts ${off.ghosts}`);
  ok(off.label === "FIND — hold to switch on", `the affordance flips (${off.label})`);
  await longPress(".m-tab:nth-child(3)", "the FIND tab (arm the scan, in FPV)");
  const on = await J(`(() => ({ open: window.__findStore.getState().open, live: document.querySelector(".m-tab:nth-child(3)").classList.contains("m-tab--live"), sheet: !!document.querySelector('.m-sheet[aria-label="FIND IN FRAME"]'), sel: document.querySelector(".m-tab--on")?.textContent?.trim() }))()`);
  ok(on.open === true && on.live === true, `the scan is ON and the tab LIVE again (open ${on.open}, live ${on.live})`);
  ok(on.sheet === false, `…without the sheet (selected tab ${on.sel})`);
  await shot("mbatch-09-find-live");
  // a plain TAP still selects the tab (the trailing click of a long press is swallowed, a tap is not)
  await tap(".m-tab:nth-child(3)", "the FIND tab (tap)");
  const tapped = await J(`(() => ({ sheet: !!document.querySelector('.m-sheet[aria-label="FIND IN FRAME"]'), open: window.__findStore.getState().open, live: document.querySelector(".m-tab:nth-child(3)").classList.contains("m-tab--live") }))()`);
  ok(tapped.sheet === true && tapped.open === true && tapped.live === true, `a tap opens the sheet over the live scan (sheet ${tapped.sheet}, open ${tapped.open}, live ${tapped.live})`);
  // A showing sheet COVERS the tab row (bottom: 0, up to 62dvh) — by touch the tabs are only
  // reachable once the sheet is closed, so: close it by its ×, the scan stays live (sticky),
  // then the long press stands it down.
  const under = await J(`(() => { const t = document.querySelector(".m-tab:nth-child(3)").getBoundingClientRect(); const el = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return el ? !el.closest(".m-tabs") : true; })()`);
  ok(under, "while the FIND sheet shows, the tab row sits under it (the tab is not a touch target)");
  await tap(".m-sheet__x", "the sheet's ×");
  await sleep(500);
  const closed = await J(`(() => ({ sheet: !!document.querySelector('.m-sheet[aria-label="FIND IN FRAME"]'), open: window.__findStore.getState().open, live: document.querySelector(".m-tab:nth-child(3)").classList.contains("m-tab--live") }))()`);
  ok(closed.sheet === false && closed.open === true && closed.live === true, `closing the sheet keeps the scan LIVE — the tab still says so (sheet ${closed.sheet}, open ${closed.open}, live ${closed.live})`);
  await longPress(".m-tab:nth-child(3)", "the FIND tab (stand down after closing the sheet)");
  const down = await J(`(() => ({ sheet: !!document.querySelector('.m-sheet[aria-label="FIND IN FRAME"]'), open: window.__findStore.getState().open, live: document.querySelector(".m-tab:nth-child(3)").classList.contains("m-tab--live") }))()`);
  ok(down.sheet === false && down.open === false && down.live === false, `…and the hold stands it down (open ${down.open}, live ${down.live})`);
  await shot("mbatch-10-find-down");
}

console.log(notes.join("\n"));
if (fails.length) console.log(fails.join("\n"));
console.log(`\nverify-mobile-batch-2026-09-08: ${notes.filter((n) => n.startsWith("  PASS")).length} PASS · ${fails.length} FAIL${DEVICE ? " (DEVICE)" : ""}`);
s.close();
await finishVerify(fails.length ? 1 : 0);
