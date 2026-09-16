// Browser verification for the MOBILE UX BATCH of 2026-09-16 (four owner asks, /m only).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-uxbatch-2026-09-16.mjs [cdpPort] [shotsDir]
//   (defaults 9333, verify-shots/uxbatch-2026-09-16)
//
// Asserts:
//   1. THE PLUX MENU — the strip's left is ONE logo button (aria-haspopup); no chips on the strip;
//      a tap drops SIGN IN · GUIDE · DESKTOP; the scrim closes it; GUIDE from the menu opens the sheet.
//   2. THE 2D SCALE BAR — present on the 2D map in the strip's right; its width is exactly the
//      ladder distance over the mirrored metres-per-px; it re-rounds after a pinch.
//   3. THE FINGER-PROPORTIONAL PINCH — a symmetric spread 120 → 240 px on the 2D map scales the
//      camera altitude by (120/240)^pinchZoomGain (0.75 → 0.595), not the old 2.9× pixel path.
//   4. FPV — the HUD pill sits ON the strip (right of the wordmark, no overlap); the minimap moved
//      up under it; the peek row carries ↑ rise / ↓ set; a LONG PRESS on the name turns the look
//      toward the sun WITHOUT opening the sheet; a plain tap still opens it.
//   5. THE CHART SCALE BAR — the fullscreen MapWindow (minimap tap) shows the bar; a pinch re-rounds it.
//   6. 2D long press — on the map the PLANNED view's heading turns to the target (the plan path).
// Screenshots land in verify-shots/uxbatch-2026-09-16/ (git-ignored).
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots/uxbatch-2026-09-16";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — 15:00 in Dnipro, the sun up in the SW
const M_URL = `http://localhost:4321/m`;
const M_2D_URL = `http://localhost:4321/m#p=48.4640,35.0460,2500,0,0&t=${NOON_UTC}`;
const M_FPV_URL = `http://localhost:4321/m#f=48.4647,35.0462,1.7,25,8,60&t=${NOON_UTC}`;
const GAIN_EXPECT = 0.75; // CONTROLS.pinchZoomGain at the time of writing (the check reads the live value)

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const angDist = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

async function attach() {
  let target;
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
  trackTarget(PORT, target.id); // audit #3 C11: register for close
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
  const waitFor = async (expr, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await evalJs(expr)) return true;
      await sleep(250);
    }
    return false;
  };
  const rect = (sel) =>
    evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; })()`);
  const text = (sel) => evalJs(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
  const tap = async (x, y, holdMs = 60) => {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    await sleep(holdMs);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const tapSel = async (sel, holdMs = 60) => {
    const r = await rect(sel);
    if (!r) return false;
    await tap(r.x + r.w / 2, r.y + r.h / 2, holdMs);
    return true;
  };
  /** A symmetric two-finger spread about (cx, cy): half-gap d0 → d1 over `steps` frames. */
  const pinch = async (cx, cy, d0, d1, steps = 40) => {
    const pts = (d) => [
      { x: cx - d, y: cy, id: 1 },
      { x: cx + d, y: cy, id: 2 },
    ];
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(d0) });
    for (let i = 1; i <= steps; i++) {
      await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d0 + ((d1 - d0) * i) / steps) });
      await sleep(16);
    }
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  return { send, evalJs, shoot, goto, waitFor, rect, text, tap, tapSel, pinch };
}

const parseLabelMeters = (label) => {
  const m = /^([\d.\u2009]+) (m|km)$/.exec(label?.trim() ?? "");
  if (!m) return null;
  const v = Number(m[1].replace(/\u2009/g, ""));
  return m[2] === "km" ? v * 1000 : v;
};

let m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

// Seed the tracked target = the SUN (deterministic bearings for the long-press legs).
await m.goto(M_URL, 3000);
await m.evalJs(`localStorage.setItem("ftw:view-prefs:v1", JSON.stringify({ prefsRev: 2, skyTargetId: "body:sun" }))`);
await m.goto("about:blank", 300);
await m.goto(M_2D_URL, 1000);
check("/m 2D: engine booted", await m.waitFor(`!!window.__cameraStore`));
await sleep(8000);
const gain = await m.evalJs(`window.__globe?.tuning?.CONTROLS?.pinchZoomGain ?? null`);
console.log(`live pinchZoomGain: ${gain ?? "(not exposed — using " + GAIN_EXPECT + ")"}`);
const GAIN = typeof gain === "number" ? gain : GAIN_EXPECT;

// ── 1. THE PLUX MENU ──────────────────────────────────────────────────────────────────────
{
  const title = await m.rect(".m-status .m-title[aria-haspopup='menu']");
  check("1a. the strip's left is ONE logo button with aria-haspopup=menu", title !== null);
  const stripChips = await m.evalJs(`document.querySelectorAll(".m-status .m-chip").length`);
  check("1b. no chips on the strip while the menu is closed", stripChips === 0, `${stripChips} chips`);
  check("1c. the micro hint (▾) rides the wordmark", (await m.text(".m-title__hint"))?.trim() === "▾");
  await m.shoot("01-2d-strip-closed");
  await m.tapSel(".m-title");
  await sleep(400);
  const items = await m.evalJs(`[...document.querySelectorAll(".m-menu[role='menu'] [role='menuitem']")].map(e => e.textContent.trim())`);
  check(
    "1d. a tap drops the menu: SIGN IN · GUIDE · DESKTOP",
    Array.isArray(items) && items.length === 3 && /^SIGN IN/.test(items[0]) && /^GUIDE/.test(items[1]) && /^DESKTOP/.test(items[2]),
    JSON.stringify(items),
  );
  check("1e. aria-expanded=true while open", (await m.evalJs(`document.querySelector(".m-title").getAttribute("aria-expanded")`)) === "true");
  const desktopHref = await m.evalJs(`document.querySelector('.m-menu a.m-chip[href="/?d=1"]') !== null`);
  check("1f. the DESKTOP item keeps its /?d=1 href (the uxbatch5 hash idiom)", desktopHref === true);
  await m.shoot("02-menu-open");
  await m.tap(200, 560); // the scrim
  await sleep(300);
  check("1g. a tap outside closes the menu", (await m.rect(".m-menu")) === null);
  await m.tapSel(".m-title");
  await sleep(300);
  await m.evalJs(`[...document.querySelectorAll(".m-menu [role='menuitem']")].find(b => b.textContent.trim().startsWith("GUIDE"))?.click()`);

  await sleep(700);
  const guideOpen = (await m.rect(".m-sheet")) !== null;
  const menuGone = (await m.rect(".m-menu")) === null;
  check("1h. GUIDE from the menu opens the sheet and closes the menu", guideOpen && menuGone, `sheet ${guideOpen} menu closed ${menuGone}`);
  await m.shoot("03-guide-from-menu");
  await m.evalJs(`document.querySelector(".m-sheet__x")?.click()`);
  await sleep(600);
}

// ── 2 + 3. THE 2D SCALE BAR + THE FINGER-PROPORTIONAL PINCH ─────────────────────────────
{
  const bar0 = await m.rect(".m-status .m-scalebar__bar");
  const label0 = await m.text(".m-status .m-scalebar__label");
  const mpp0 = await m.evalJs(`window.__cameraStore.getState().mapScaleMPerPx`);
  const meters0 = parseLabelMeters(label0);
  check("2a. the 2D scale bar is on the strip's right with a ladder label", bar0 !== null && meters0 !== null, `label "${label0}"`);
  check(
    "2b. the bar is exactly the label's distance at the mirrored m/px (±3 %)",
    bar0 !== null && meters0 !== null && typeof mpp0 === "number" && Math.abs(bar0.w - meters0 / mpp0) / (meters0 / mpp0) < 0.03,
    `bar ${bar0?.w?.toFixed(1)} px vs ${meters0 && mpp0 ? (meters0 / mpp0).toFixed(1) : "?"} px (m/px ${mpp0})`,
  );
  const strip = await m.rect(".m-status");
  check("2c. …and it sits inside the strip (the top row)", bar0 !== null && strip !== null && bar0.y >= strip.y && bar0.bottom <= strip.bottom + 1);

  const alt0 = await m.evalJs(`window.__cameraStore.getState().zoomAltM`);
  await m.pinch(195, 422, 60, 120); // half-gaps: 120 → 240 px between the fingers
  await sleep(1800); // the log bank drains on zoomSmoothTauMs
  const alt1 = await m.evalJs(`window.__cameraStore.getState().zoomAltM`);
  const ratio = alt1 / alt0;
  const want = (120 / 240) ** GAIN;
  check(
    `3a. a 120 → 240 px spread scales the altitude by (1/2)^${GAIN} = ${want.toFixed(3)} (±0.05), not the old ≈0.34`,
    Math.abs(ratio - want) < 0.05,
    `alt ${alt0.toFixed(0)} → ${alt1.toFixed(0)} m, ratio ${ratio.toFixed(3)}`,
  );
  const mpp1 = await m.evalJs(`window.__cameraStore.getState().mapScaleMPerPx`);
  check("3b. the metres-per-px mirror followed the zoom (same ratio ±0.05)", typeof mpp1 === "number" && Math.abs(mpp1 / mpp0 - ratio) < 0.05, `m/px ${mpp0?.toFixed(2)} → ${mpp1?.toFixed(2)}`);
  const label1 = await m.text(".m-status .m-scalebar__label");
  const bar1 = await m.rect(".m-status .m-scalebar__bar");
  const meters1 = parseLabelMeters(label1);
  check("2d. the bar re-rounded after the pinch and still fits the budget", meters1 !== null && bar1 !== null && bar1.w <= 111 && (label1 !== label0 || Math.abs(bar1.w - bar0.w) > 2), `"${label0}" ${bar0?.w?.toFixed(1)} px → "${label1}" ${bar1?.w?.toFixed(1)} px`);
  await m.shoot("04-2d-after-pinch");
}

// ── 6. 2D long press on the name → the PLANNED view turns to the sun ────────────────────
{
  const az = await m.evalJs(`window.__cameraStore.getState().skyMarkers?.target?.azDeg ?? null`);
  const rs = await m.evalJs(`[...document.querySelectorAll(".m-peek__rs-row")].map(e => e.textContent.trim())`);
  check("4b. the peek row carries ↑ rise / ↓ set clocks", Array.isArray(rs) && rs.length === 2 && rs.every((t) => /^[↑↓]\s*(\d\d:\d\d|—)$/.test(t)), JSON.stringify(rs));
  const name = await m.rect(".m-peek__name");
  check("6a. the tracked target has a sky marker (the sun, up at 15:00)", typeof az === "number" && name !== null, `az ${az}`);
  await m.tap(name.x + Math.min(20, name.w / 2), name.y + name.h / 2, 750); // past ORCH.longPressMs
  await sleep(500);
  const pv = await m.evalJs(`window.__cameraStore.getState().plannedView`);
  const sheet = (await m.rect(".m-sheet")) !== null;
  check("6b. the long press turned the PLANNED heading to the sun's azimuth (±2°) and opened no sheet", pv !== null && typeof az === "number" && angDist(pv.headingDeg, az) < 2 && !sheet, `planned ${pv?.headingDeg?.toFixed(1)} vs az ${az?.toFixed(1)}, sheet ${sheet}`);
  await m.shoot("05-2d-longpress-plan");
}

// ── 4. FPV: the HUD on the strip, the minimap up, the long press aims the look ──────────
// A FRESH target: a `Page.navigate` after a touch sequence leaves headless Chrome delivering
// synthesized clicks but NO pointer events on the next document (measured 2026-09-16 — the row
// saw `click` alone, the chart canvas nothing), which is a CDP emulation artefact, not the app
// (a phone never navigates between its 2D map and FPV). The seeded prefs are origin-wide.
m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await m.goto(M_FPV_URL, 1000);
check("/m FPV: engine booted", await m.waitFor(`!!window.__cameraStore`));
check("/m FPV: the HUD mirror is live", await m.waitFor(`!!window.__cameraStore.getState().fpvHud`, 25000));
await sleep(11000); // let the FPV boot's cell landings (T77) settle — a stalled thread shortens a CDP hold

{
  const hud = await m.rect(".m-fpvhud");
  const title = await m.rect(".m-title");
  const strip = await m.rect(".m-status");
  const mm = await m.rect(".mm");
  check("4a. the FOCAL·HDG·PITCH·EYE pill sits ON the strip row", hud !== null && strip !== null && hud.y >= strip.y - 1 && hud.bottom <= strip.bottom + 1, `hud y ${hud?.y?.toFixed(0)}–${hud?.bottom?.toFixed(0)} vs strip ${strip?.y?.toFixed(0)}–${strip?.bottom?.toFixed(0)}`);
  check("4c. …right of the wordmark, no overlap", hud !== null && title !== null && hud.x > title.right + 4, `title right ${title?.right?.toFixed(0)} hud x ${hud?.x?.toFixed(0)}`);
  check("4d. the minimap moved up under the strip (top < 80 px) and clears the HUD", mm !== null && hud !== null && mm.y < 80 && mm.y >= hud.bottom - 1, `mm top ${mm?.y?.toFixed(0)} hud bottom ${hud?.bottom?.toFixed(0)}`);
  check("4e. no scale bar in FPV (2D only)", (await m.rect(".m-status .m-scalebar")) === null);
  await m.shoot("06-fpv-strip-hud-minimap");

  const az = await m.evalJs(`window.__cameraStore.getState().skyMarkers?.target?.azDeg ?? null`);
  const h0 = await m.evalJs(`window.__cameraStore.getState().fpvHud.headingDeg`);
  const name = await m.rect(".m-peek__name");
  check("4f. the peek is up in FPV with the sun as the target", name !== null && typeof az === "number", `az ${az}`);
  // An event log on the document (capture phase) — the detail string names what the row saw.
  await m.evalJs(`(() => { window.__evlog = []; for (const t of ["pointerdown","pointerup","click"]) document.addEventListener(t, (e) => window.__evlog.push(e.type + ":" + String(e.target?.className ?? e.target?.tagName).slice(0, 24) + ":" + (e.pointerType ?? "") + "@" + Math.round(e.timeStamp)), true); return true; })()`);
  const hitAt = await m.evalJs(`document.elementFromPoint(${name.x + Math.min(20, name.w / 2)}, ${name.y + name.h / 2})?.className ?? null`);
  await m.tap(name.x + Math.min(20, name.w / 2), name.y + name.h / 2, 900);
  await sleep(3500); // the look glide

  const h1 = await m.evalJs(`window.__cameraStore.getState().fpvHud.headingDeg`);
  const sheets = await m.evalJs(`[...document.querySelectorAll(".m-sheet")].map(s => s.getAttribute("aria-label"))`);
  const sheet = sheets.length > 0;
  const evlog = await m.evalJs(`JSON.stringify(window.__evlog)`);
  check(
    "4g. the long press glided the FPV look toward the sun (closer by > 20°) and opened no sheet",
    typeof az === "number" && angDist(h0, az) - angDist(h1, az) > 20 && !sheet,
    `heading ${h0?.toFixed(1)} → ${h1?.toFixed(1)}, sun az ${az?.toFixed(1)}, sheets ${JSON.stringify(sheets)}, hit ${hitAt}, events ${evlog}`,
  );
  await m.shoot("07-fpv-longpress-aimed");
  await m.tapSel(".m-peek__pos"); // a plain tap elsewhere on the row still opens the sheet
  await sleep(700);
  const opened = (await m.rect(".m-sheet")) !== null;
  check("4h. a plain tap on the row still opens the TARGET sheet", opened);
  await m.evalJs(`document.querySelector(".m-sheet__x")?.click()`);
  await sleep(600);
}

// ── 5. THE CHART SCALE BAR (the fullscreen MapWindow) ───────────────────────────────────
{
  const opened = await m.tapSel(".mm-open");
  await sleep(1500);
  const mw = await m.rect(".mw");
  check("5a. the minimap tap opens the fullscreen chart", opened && mw !== null);
  const label0 = await m.text(".mw-scale .m-scalebar__label");
  const bar0 = await m.rect(".mw-scale .m-scalebar__bar");
  check("5b. the chart shows its scale bar under the pills", parseLabelMeters(label0) !== null && bar0 !== null && bar0.w <= 111 && bar0.y > 40, `"${label0}" ${bar0?.w?.toFixed(1)} px at y ${bar0?.y?.toFixed(0)}`);
  await m.shoot("08-chart-scalebar");
  // FPV opens the chart at its MAX zoom (z18) — only a pinch OUT can move it: 120 → 60 px, seated
  // at y 330 so neither finger lands on the AIM joystick (x ≤ 126, y 435–545 — it floats OVER the
  // chart at z 24) or the PiP (top-right, bottom ≈ 282).
  await m.evalJs(`(() => { window.__evlog = []; for (const t of ["pointerdown","pointerup"]) document.addEventListener(t, (e) => window.__evlog.push(e.type + ":" + String(e.target?.className ?? e.target?.tagName).slice(0, 24) + "#" + e.pointerId), true); return true; })()`);
  const z0 = await m.evalJs(`window.__mapWindowView?.z ?? null`);
  await m.pinch(195, 330, 60, 30);

  await sleep(600);
  const label1 = await m.text(".mw-scale .m-scalebar__label");
  const bar1 = await m.rect(".mw-scale .m-scalebar__bar");
  check("5c. a pinch (out, from the max zoom) re-rounds the chart's bar", (label1 !== label0 || Math.abs((bar1?.w ?? 0) - bar0.w) > 2) && (bar1?.w ?? 999) <= 111, `"${label0}" ${bar0?.w?.toFixed(1)} → "${label1}" ${bar1?.w?.toFixed(1)}; z ${z0} → ${await m.evalJs(`window.__mapWindowView?.z ?? null`)}; events ${await m.evalJs(`JSON.stringify(window.__evlog.slice(0, 4))`)}`);

  await m.shoot("09-chart-after-pinch");
  await m.tapSel(".mw-pip");
  await sleep(800);
  check("5d. the PiP tap returns to FPV", (await m.rect(".mw")) === null);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await finishVerify(failures === 0 ? 0 : 1);
