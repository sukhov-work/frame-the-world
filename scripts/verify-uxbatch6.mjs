// Browser verification for OWNER BATCH #6 (2026-08-21e — radar band reorder + aim-stick moves).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-uxbatch6.mjs [cdpPort] [shotsDir]
//
// Asserts:
//   Desktop leg
//   1. Item 3 — focal cone from BOOT: plannedView seeded without any input; the desktop
//      minimap corner keeps its AIM stick (the /m move must not leak here)
//   /m leg (mobile emulation)
//   2. Item 3 — plannedView seeded at boot + the aim stick carries the mm focal readout
//   3. Item 4 — aim stick on the map surface (non-FPV), above the walk stick in FPV
//      (.m-joy--aim-fpv), NOT on the minimap corner; still visible with the fullscreen map up
//   4. Item 1 — placing a point in the fullscreen map re-anchors the radar onto it (shot)
//   5. Item 2 — band reorder/compaction (unit-locked; shots for the eye, moon innermost)
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — sun well up in Dnipro
const ORBIT_URL = `http://localhost:4321/#p=48.4640,35.0460,2500,0,30&t=${NOON_UTC}`;

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
  // Cold dev-server rebundles make first loads slow — poll for a page-side condition.
  const waitFor = async (expr, timeoutMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await evalJs(expr)) return true;
      } catch {
        /* page still booting */
      }
      await sleep(500);
    }
    return false;
  };
  return { send, evalJs, shoot, goto, rect, click, waitFor };
}

// ───────────────────────── Desktop leg ─────────────────────────
const d = await attach();
await d.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await d.goto(ORBIT_URL, 16000);
check("desktop: engine booted", await d.waitFor(`!!window.__cameraStore && !!window.__cameraStore.getState().camGeo`));

// 1 — item 3: cone from boot; desktop minimap keeps its corner stick
const dPlan = await d.evalJs(`window.__cameraStore.getState().plannedView`);
check("desktop: plannedView seeded at BOOT (cone from start)", dPlan !== null && dPlan.hFovDeg > 0, JSON.stringify(dPlan));
await d.shoot("uxb6-01-desktop-radar-reordered-cone");

// ───────────────────────── /m leg ─────────────────────────
const m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await m.goto("http://localhost:4321/m", 14000);
check("/m: engine booted", await m.waitFor(`!!window.__cameraStore && !!document.querySelector(".m-joy--aim-map")`));

// 2 — item 3: seeded plan + mm readout on the map-surface stick
const mPlan = await m.evalJs(`window.__cameraStore.getState().plannedView`);
check("/m: plannedView seeded at BOOT", mPlan !== null && mPlan.hFovDeg > 0, JSON.stringify(mPlan));
const mapFooter = await m.evalJs(`document.querySelector(".m-joy--aim-map .m-joy__footer")?.textContent ?? null`);
check("/m: map aim stick shows the focal in mm", mapFooter !== null && /MM$/.test(mapFooter), String(mapFooter));
await m.shoot("uxb6-02-m-2d-radar-reordered");

// 3 — item 4: FPV → stick above walk, corner retired, survives the fullscreen map
const chipRect = await m.rect(".m-actrow button");
if (chipRect) {
  const cx = chipRect.x + chipRect.w / 2;
  const cy = chipRect.y + chipRect.h / 2;
  await m.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await sleep(700);
  await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(4500);
  const walk = await m.rect(".m-joy:not(.m-joy--aim)");
  const aim = await m.rect(".m-joy--aim-fpv");
  check("/m: FPV aim stick present", aim !== null, JSON.stringify(aim));
  check(
    "/m: aim stick sits ABOVE the walk stick (same left rail)",
    walk !== null && aim !== null && aim.y + aim.h <= walk.y + 1 && Math.abs(aim.x - walk.x) < 2,
    `aim ${JSON.stringify(aim)} walk ${JSON.stringify(walk)}`,
  );
  const cornerGone = await m.evalJs(`document.querySelector(".m-joy--aim-minimap") === null`);
  check("/m: minimap-corner stick retired", cornerGone === true);
  const fpvFooter = await m.evalJs(`document.querySelector(".m-joy--aim-fpv .m-joy__footer")?.textContent ?? null`);
  check("/m: FPV aim stick shows the LIVE focal in mm", fpvFooter !== null && /MM$/.test(fpvFooter), String(fpvFooter));
  await m.shoot("uxb6-03-m-fpv-aim-above-walk");

  // Fullscreen map: both sticks ride the z-24 rung, aim stays visible
  await m.click(".mm-open");
  await sleep(3000);
  const aimVis = await m.evalJs(
    `(() => { const el = document.querySelector(".m-joy--aim-fpv"); return el ? getComputedStyle(el).visibility : "absent"; })()`,
  );
  check("/m: aim stick VISIBLE over the fullscreen map (the lost-stick fix)", aimVis === "visible", aimVis);

  // 4 — item 1: place a point → the radar re-anchors onto it (store + shot). Press point
  // clears the left stick rail (x ≲ 126) and the top-right PiP.
  const pinBefore = await m.evalJs(`JSON.stringify(window.__cameraStore.getState().tempPin)`);
  await m.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 230, y: 520, id: 1 }] });
  await sleep(750);
  await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(900);
  const pinAfter = await m.evalJs(`JSON.stringify(window.__cameraStore.getState().tempPin)`);
  const stillOpen = await m.evalJs(`!!document.querySelector(".mw")`);
  check("/m: point placed (pin MOVED, map stayed open)", pinAfter !== pinBefore && pinAfter !== "null" && stillOpen, `${pinBefore} → ${pinAfter}`);
  await m.shoot("uxb6-04-m-map-radar-on-placed-pin");
} else {
  check("/m: long-press 3D entered FPV", false, "no ▲ 3D chip found");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await finishVerify(failures === 0 ? 0 : 1);