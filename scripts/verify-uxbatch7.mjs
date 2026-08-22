// Browser verification for the OWNER QA BATCH (2026-08-21f — post-batch-#6 QA fixes).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-uxbatch7.mjs [cdpPort] [shotsDir]
//
// Asserts:
//   Desktop leg
//   1. QA-6 — search placeholder reads "TYPE TO SEARCH — …"
//   2. QA-4 — the TimeScrubber rides z 43 while body.mw-open (above the map window)
//   /m leg (mobile emulation)
//   3. QA-6 — SEARCH sheet: input focused on open, layout viewport pinned at 0, new hint
//   4. QA-5 — .fh-chip computed z-index 9 (under the z-10 controls)
//   5. QA-2 — long-press ▲3D enters FPV at the PLANNED heading + focal (plannedView carry)
//   6. QA-1 — placing a point on the fullscreen map relocates the FPV eye ONTO the pin
//      (camGeo converges — no detach), map stays open
//   7. QA-4 — /m fullscreen map: dock lifted to z 24, tabs/peek dropped, time input live,
//      bottom hint retired, credit re-seated top
//   8. QA-3 — skyline gaps: soft check (profile build is tile/network-dependent) + shot
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — sun well up in Dnipro
const ORBIT_URL = `http://localhost:4321/#p=48.4640,35.0460,2500,0,30&t=${NOON_UTC}`;
const M_URL = `http://localhost:4321/m#p=48.4640,35.0460,600,0,0&t=${NOON_UTC}`;

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
check("desktop: engine booted", await d.waitFor(`!!window.__cameraStore && !!window.__cameraStore.getState()`));

// 1 — QA-6 placeholder
const dPh = await d.evalJs(`document.querySelector(".lf-input")?.placeholder ?? null`);
check("desktop: search placeholder = TYPE TO SEARCH …", dPh !== null && dPh.startsWith("TYPE TO SEARCH"), String(dPh));

// 2 — QA-4: the scrubber's mw-open rung (CSS contract — the desktop map window is z 42)
const tsZ = await d.evalJs(`(() => {
  document.body.classList.add("mw-open");
  const z = document.querySelector(".ts") ? getComputedStyle(document.querySelector(".ts")).zIndex : "absent";
  document.body.classList.remove("mw-open");
  return z; })()`);
check("desktop: TimeScrubber rides z 43 over the open map window", tsZ === "43", tsZ);
await d.shoot("uxb7-01-desktop-boot");

// ───────────────────────── /m leg ─────────────────────────
const m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await m.goto(M_URL, 14000);
check("/m: engine booted", await m.waitFor(`!!window.__cameraStore && !!document.querySelector(".m-joy--aim-map")`));

// 3 — QA-6: SEARCH sheet focus + hint + pinned viewport
await m.evalJs(`(() => { for (const b of document.querySelectorAll(".m-tab")) if (b.textContent.includes("SEARCH")) { b.click(); return true; } return false; })()`);
await sleep(900);
const mSearch = await m.evalJs(`(() => {
  const input = document.querySelector(".m-input");
  return input ? {
    ph: input.placeholder,
    focused: document.activeElement === input,
    scrollY: window.scrollY,
  } : null; })()`);
check("/m: search input mounted", mSearch !== null);
check("/m: placeholder = Type to search …", mSearch !== null && mSearch.ph.startsWith("Type to search"), mSearch?.ph);
check("/m: input FOCUSED on sheet open", mSearch !== null && mSearch.focused === true);
check("/m: layout viewport pinned at 0", mSearch !== null && mSearch.scrollY === 0, String(mSearch?.scrollY));
await m.shoot("uxb7-02-m-search-sheet");
await m.evalJs(`(() => { const b = document.querySelector(".m-sheet__close") ?? document.querySelector(".m-sheet__head button:last-child"); b?.click(); return true; })()`);
await sleep(700);

// 4 — QA-5: chip rung (computed on a live probe node — chips only exist with offscreen bodies)
const chipZ = await m.evalJs(`(() => {
  const el = document.createElement("div"); el.className = "fh-chip";
  document.body.appendChild(el);
  const z = getComputedStyle(el).zIndex;
  el.remove(); return z; })()`);
check("/m: .fh-chip rides z 9 (under the z-10 controls)", chipZ === "9", chipZ);

// 5 — QA-2: plan carry into FPV via long-press ▲3D
await m.evalJs(`window.__cameraStore.getState().setPlannedView({ headingDeg: 137, hFovDeg: 40 })`);
const chipRect = await m.rect(".m-actrow button");
if (chipRect) {
  const cx = chipRect.x + chipRect.w / 2;
  const cy = chipRect.y + chipRect.h / 2;
  await m.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy, id: 1 }] });
  await sleep(700);
  await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(5200);
  const hud = await m.evalJs(`window.__cameraStore.getState().fpvHud`);
  const expected = await m.evalJs(`(() => {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const hRad = (40 * Math.PI) / 180;
    return 2 * Math.atan(Math.tan(hRad / 2) / aspect) * (180 / Math.PI); })()`);
  const dHead = hud ? Math.abs((((hud.headingDeg - 137) % 360) + 540) % 360 - 180) : 999;
  check("/m: FPV entered via long-press ▲3D", hud !== null);
  check("/m: entry HEADING = planned 137°", hud !== null && dHead < 3, `hud ${hud?.headingDeg?.toFixed(1)}`);
  check(
    "/m: entry FOCAL = planned hFov 40° → vertical at the live aspect",
    hud !== null && Math.abs(hud.fovDeg - Math.min(80, expected)) < 2,
    `hud ${hud?.fovDeg?.toFixed(1)} vs expected ${expected?.toFixed(1)}`,
  );
  await m.shoot("uxb7-03-m-fpv-planned-entry");

  // 6+7 — fullscreen map: dock strip + place-point relocation (no detach)
  await m.click(".mm-open");
  await sleep(3000);
  const mapUi = await m.evalJs(`(() => {
    const bottom = document.querySelector(".m-bottom");
    const tabs = document.querySelector(".m-tabs");
    const time = document.querySelector("input.md-time");
    const hint = document.querySelector(".mw-hint");
    const credit = document.querySelector(".mw-credit");
    return {
      open: !!document.querySelector(".mw"),
      bottomZ: bottom ? getComputedStyle(bottom).zIndex : "absent",
      tabsGone: tabs ? getComputedStyle(tabs).display === "none" : false,
      timeLive: time ? time.getBoundingClientRect().height > 0 && !!time.value : false,
      hintGone: hint === null,
      // SUPERSEDED 2026-08-22 (owner micro-slice item 3): this read creditTop and asserted
      // the attribution had re-seated into the TOP band (< 160 px). The owner then moved ALL
      // map attribution to one thin line on the screen's BOTTOM edge under the time strip, so
      // the assertion below is its inversion — bottom-anchored, still exactly one line.
      creditBottomGap: credit ? window.innerHeight - credit.getBoundingClientRect().bottom : -1,
    }; })()`);
  check("/m: fullscreen map open", mapUi.open === true);
  check("/m: dock lifted to z 24 over the map", mapUi.bottomZ === "24", mapUi.bottomZ);
  check("/m: tabs dropped from layout (dock flush at bottom)", mapUi.tabsGone === true);
  check("/m: time input LIVE on the map bottom strip", mapUi.timeLive === true);
  check("/m: bottom hint retired", mapUi.hintGone === true);
  check(
    "/m: credit rides the BOTTOM edge under the time strip (2026-08-22 supersedes the top band)",
    mapUi.creditBottomGap >= 0 && mapUi.creditBottomGap < 40,
    `${mapUi.creditBottomGap} px above the viewport bottom`,
  );
  await m.shoot("uxb7-04-m-map-dock-strip");

  // Place a point clear of the left stick rail (x ≲ 126) and the top-right PiP.
  await m.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 230, y: 420, id: 1 }] });
  await sleep(750);
  await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(1600);
  const relo = await m.evalJs(`(() => {
    const s = window.__cameraStore.getState();
    if (!s.tempPin || !s.camGeo) return null;
    const dN = (s.camGeo.latDeg - s.tempPin.latDeg) * 111320;
    const dE = (s.camGeo.lonDeg - s.tempPin.lonDeg) * 111320 * Math.cos((s.tempPin.latDeg * Math.PI) / 180);
    return { m: Math.hypot(dN, dE), open: !!document.querySelector(".mw") }; })()`);
  check(
    "/m: placed point RELOCATES the FPV eye onto it (no detach) + map stays open",
    relo !== null && relo.m < 20 && relo.open === true,
    relo ? `eye ${relo.m.toFixed(1)} m from pin` : "no pin/camGeo",
  );
  await m.shoot("uxb7-05-m-map-radar-follows-eye");

  // 8 — QA-3 soft check: gaps need a READY skyline profile (tile/network dependent in dev).
  const profReady = await m.waitFor(`window.__planStore && window.__planStore.getState().profileReady === true`, 25000);
  if (profReady) {
    const guard = await m.evalJs(`(() => {
      const p = window.__planStore.getState();
      const s = window.__cameraStore.getState();
      if (!p.anchor || !s.camGeo) return null;
      const dN = (s.camGeo.latDeg - p.anchor.latDeg) * 111320;
      const dE = (s.camGeo.lonDeg - p.anchor.lonDeg) * 111320 * Math.cos((p.anchor.latDeg * Math.PI) / 180);
      return { m: Math.hypot(dN, dE), bins: !!p.profileBins }; })()`);
    check("/m: skyline profile READY + bins mirrored (gaps armed)", guard !== null && guard.bins === true, guard ? `anchor ${guard.m.toFixed(1)} m from eye` : "no anchor");
    await m.shoot("uxb7-06-m-radar-skyline-gaps");
  } else {
    console.log("SKIP  /m: skyline profile did not become ready in 25 s (tile/network) — gaps unverified visually");
  }
} else {
  check("/m: long-press 3D entered FPV", false, "no ▲ 3D chip found");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await finishVerify(failures === 0 ? 0 : 1);