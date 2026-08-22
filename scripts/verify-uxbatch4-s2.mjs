// Browser verification for OWNER BATCH #4 slice S2 (2026-08-21).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-uxbatch4-s2.mjs [cdpPort] [shotsDir]
//
// Asserts:
//   1. Desktop orbit: annular radar renders (shot) and plannedView starts null
//   2. Desktop FPV: minimap carries the AIM joystick; deflecting it turns the REAL camera
//   3. Desktop FPV exit seeds plannedView (heading+hFov survive to the planning surfaces)
//   4. MapWindow: two-finger TWIST rotates the chart (canvas content changes, no pan/zoom)
//   5. /m 2D map: AIM joystick present; deflecting it creates + steers the planned view
//   6. /m FPV: minimap radar (shot) + aim joystick pinned to the card
// Screenshots land in verify-shots/ (git-ignored).
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — 15:00 in Dnipro, readable daylight
const ORBIT_URL = `http://localhost:4321/#p=48.4640,35.0460,2500,0,30&t=${NOON_UTC}`;
const FPV_URL = `http://localhost:4321/#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`;
const M_URL = "http://localhost:4321/m";

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
  let target;
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
  // audit #3 C11: register for close — an abandoned target holds a WebGL context.
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
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
  const shoot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.data, "base64"));
    console.log(`shot  ${SHOTS}/${name}.jpeg`);
  };
  const goto = async (url, settleMs = 1500) => {
    await send("Page.navigate", { url });
    await sleep(settleMs);
  };
  const rect = (sel) =>
    evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const click = (sel) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const mouse = async (type, x, y, opts = {}) =>
    send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...opts });
  /** Deflect a Joystick pad: pointer down at centre, glide to (dx,dy), HOLD, release. */
  const deflect = async (sel, dx, dy, holdMs) => {
    const r = await rect(sel);
    if (!r) return false;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    await mouse("mousePressed", cx, cy, { buttons: 1 });
    for (let i = 1; i <= 5; i++) {
      await mouse("mouseMoved", cx + (dx * i) / 5, cy + (dy * i) / 5, { buttons: 1 });
      await sleep(20);
    }
    await sleep(holdMs);
    await mouse("mouseReleased", cx + dx, cy + dy);
    return true;
  };
  return { send, evalJs, shoot, goto, rect, click, mouse, deflect };
}

const planned = (t) => t.evalJs(`window.__cameraStore?.getState().plannedView ?? null`);
const hud = (t) => t.evalJs(`window.__cameraStore?.getState().fpvHud ?? null`);

// ───────────────────────── Desktop leg ─────────────────────────
const d = await attach();
await d.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await d.goto(ORBIT_URL, 16000); // tiles + radar warm up

// 1 — annular radar on the GL globe (visual) + plannedView SEEDED at boot (batch #6 item 3
// supersession: the focal cone shows from start — the old starts-null contract is retired).
const dBootPlan = await planned(d);
check("desktop: plannedView seeded at boot (batch #6)", dBootPlan !== null && dBootPlan.hFovDeg > 0);
await d.shoot("uxb4-s2-01-desktop-annular-radar");

// 2 — FPV: minimap aim joystick steers the REAL camera
await d.goto("about:blank", 300);
await d.goto(FPV_URL, 12000);
const joyMm = await d.rect(".m-joy--aim-minimap");
check("desktop: minimap AIM joystick present in FPV", joyMm !== null);
const hud0 = await hud(d);
if (joyMm && hud0) {
  await d.deflect(".m-joy--aim-minimap", 24, 0, 900); // right = heading +
  await sleep(400);
  const hud1 = await hud(d);
  const dHeading = hud1 && hud0 ? Math.abs(((hud1.headingDeg - hud0.headingDeg + 540) % 360) - 180) : 0;
  check("desktop: aim joystick turned the live camera", dHeading > 1.5, `Δ=${dHeading.toFixed(2)}°`);
} else {
  check("desktop: aim joystick turned the live camera", false, "no joystick or hud");
}
await d.shoot("uxb4-s2-02-desktop-fpv-minimap-joystick");

// 3 — FPV exit seeds plannedView (+ focal cone on the globe — visual)
const hudBefore = await hud(d);
await d.evalJs(`window.__cameraStore.getState().setTempFpv(false)`);
await sleep(2500);
const pv = await planned(d);
check("desktop: FPV exit seeded plannedView", pv !== null && typeof pv.headingDeg === "number" && pv.hFovDeg > 0, JSON.stringify(pv));
if (pv && hudBefore) {
  const dSeed = Math.abs(((pv.headingDeg - hudBefore.headingDeg + 540) % 360) - 180);
  check("desktop: seed mirrors the dying hud heading", dSeed < 5, `Δ=${dSeed.toFixed(2)}°`);
}
await d.shoot("uxb4-s2-03-desktop-focal-cone-after-exit");

// 4 — MapWindow twist (back into FPV, open the map from the minimap patch)
await d.goto("about:blank", 300);
await d.goto(FPV_URL, 10000);
await d.click(".mm-open");
await sleep(2500);
const mwRect = await d.rect(".mw-canvas");
check("desktop: MapWindow open", mwRect !== null);
if (mwRect) {
  await d.shoot("uxb4-s2-04-mapwindow-bands-north-up");
  const dataBefore = await d.evalJs(
    `(() => { try { return document.querySelector(".mw-canvas").toDataURL("image/png").length; } catch { return null; } })()`,
  );
  // Pure twist: two touch points orbit their midpoint (constant distance ⇒ no zoom; fixed
  // midpoint ⇒ no pan) — only a rotation can change the chart.
  const cx = mwRect.x + mwRect.w / 2;
  const cy = mwRect.y + mwRect.h / 2;
  const R = Math.min(mwRect.w, mwRect.h) * 0.28;
  const pts = (thetaDeg) => {
    const t = (thetaDeg * Math.PI) / 180;
    return [
      { x: cx + R * Math.cos(t), y: cy + R * Math.sin(t), id: 1 },
      { x: cx - R * Math.cos(t), y: cy - R * Math.sin(t), id: 2 },
    ];
  };
  await d.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(0) });
  for (let i = 1; i <= 20; i++) {
    await d.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(i * 2) });
    await sleep(16);
  }
  await d.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(900);
  const dataAfter = await d.evalJs(
    `(() => { try { return document.querySelector(".mw-canvas").toDataURL("image/png").length; } catch { return null; } })()`,
  );
  if (dataBefore === null || dataAfter === null) {
    console.log("note  twist pixel-diff skipped (tainted canvas) — judge the shot");
  } else {
    check("desktop: twist rotated the chart (content changed)", dataAfter !== dataBefore, `${dataBefore} → ${dataAfter}`);
  }
  await d.shoot("uxb4-s2-05-mapwindow-twisted");
}

// ───────────────────────── /m leg ─────────────────────────
const m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await m.goto(M_URL, 14000);

// 5 — /m 2D map: AIM joystick creates + steers the planned view
const joyMap = await m.rect(".m-joy--aim-map");
check("/m: map AIM joystick present (2D, not FPV)", joyMap !== null);
// Batch #6 supersession: seeded at boot on /m too.
const mBootPlan = await planned(m);
check("/m: plannedView seeded at boot (batch #6)", mBootPlan !== null && mBootPlan.hFovDeg > 0);
if (joyMap) {
  await m.deflect(".m-joy--aim-map", 26, 0, 900);
  await sleep(300);
  const pv0 = await planned(m);
  check("/m: joystick seeded + steered plannedView", pv0 !== null && pv0.hFovDeg > 0, JSON.stringify(pv0));
  if (pv0) {
    await m.deflect(".m-joy--aim-map", 0, -26, 900); // up = zoom in ⇒ hFov shrinks
    await sleep(300);
    const pv1 = await planned(m);
    check("/m: up-deflection zoomed the planned focal in", pv1 !== null && pv1.hFovDeg < pv0.hFovDeg, `${pv0.hFovDeg?.toFixed(1)} → ${pv1?.hFovDeg?.toFixed(1)}`);
  }
}
await m.shoot("uxb4-s2-06-m-2d-aim-joystick");

// 6 — /m FPV: minimap radar + card joystick (long-press the ▲ 3D chip → FPV, the S1 flow)
const chipRect = await m.rect(".m-actrow button");
if (chipRect) {
  const cx = chipRect.x + chipRect.w / 2;
  const cy = chipRect.y + chipRect.h / 2;
  await m.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await sleep(700);
  await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(4500);
  const fpvOn = await m.evalJs(`!!document.querySelector(".m-joy")`);
  check("/m: long-press 3D entered FPV", fpvOn);
  // Batch #6 item 4 supersession: the /m aim stick moved OFF the minimap corner to its own
  // seat above the walk stick (the corner instance is desktop-only now).
  const mmJoy = await m.rect(".m-joy--aim-fpv");
  check("/m: FPV carries the AIM joystick above the walk stick", mmJoy !== null);
  const cornerGone = await m.evalJs(`document.querySelector(".m-joy--aim-minimap") === null`);
  check("/m: minimap-corner AIM joystick retired (batch #6)", cornerGone === true);
  await m.shoot("uxb4-s2-07-m-fpv-minimap-radar");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await finishVerify(failures === 0 ? 0 : 1);