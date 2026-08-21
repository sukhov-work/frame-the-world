// Browser verification for OWNER BATCH #4 slice S3 (2026-08-21c).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-uxbatch4-s3.mjs [cdpPort] [shotsDir]
//
// Asserts:
//   Desktop leg
//   1. Item 18 — TargetPanel carries a GOTO pill BEFORE SHOW; clicking it steers the orbit
//      camera (targetHeadingDeg lands on a value)
//   2. Item 17 — radar bands: sun emphasized → body-tinted future fill (shot for the eye;
//      the ink mapping itself is unit-locked in aimCones.test.ts)
//   3. #5 no-regression — desktop is NOT lean: coarsePointer false, bloom pass enabled at LEO
//   4. #15 dev-gate — no service worker registration on localhost
//   /m leg (mobile emulation: coarse pointer + touch)
//   5. #5 lean profile — coarsePointer true ⇒ DPR ≤ leanMobile cap (1.25), bloom pass disabled
//   6. #1 PiP — fullscreen map: .mw-pip present, ✕ MINI-MAP absent, hole pixels differ from
//      the chart around them (live GL through the hole); tap → window closes back to FPV
// Screenshots land in verify-shots/ (git-ignored).
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — sun well up in Dnipro
const ORBIT_URL = `http://localhost:4321/#p=48.4640,35.0460,2500,0,30&t=${NOON_UTC}`;
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
  return { send, evalJs, shoot, goto, rect, click };
}

// ───────────────────────── Desktop leg ─────────────────────────
const d = await attach();
await d.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await d.goto(ORBIT_URL, 16000);

// 1 — item 18: GOTO pill before SHOW; clicking steers the orbit camera
await d.evalJs(`window.__skyStore.getState().setOpen(true)`);
await sleep(800);
const pills = await d.evalJs(
  `Array.from(document.querySelectorAll(".tp-toggles .tp-toggle")).map((b) => b.textContent.trim())`,
);
const gotoIdx = pills.indexOf("GOTO");
const showIdx = pills.indexOf("SHOW");
check("desktop: GOTO pill present BEFORE SHOW", gotoIdx !== -1 && showIdx !== -1 && gotoIdx < showIdx, JSON.stringify(pills));
const headingBefore = await d.evalJs(`window.__cameraStore.getState().targetHeadingDeg`);
await d.evalJs(
  `(() => { const b = Array.from(document.querySelectorAll(".tp-toggles .tp-toggle")).find((x) => x.textContent.trim() === "GOTO"); b?.click(); return !!b; })()`,
);
await sleep(600);
const headingAfter = await d.evalJs(`window.__cameraStore.getState().targetHeadingDeg`);
check(
  "desktop: GOTO steered the orbit camera (targetHeadingDeg set)",
  headingAfter !== null && headingAfter !== headingBefore,
  `${headingBefore} → ${headingAfter}`,
);
await d.shoot("uxb4-s3-01-desktop-targetpanel-goto");

// 2 — item 17: emphasize the SUN system → the radar band's future half wears sunGlow (shot)
await d.evalJs(`window.__skyStore.getState().setAimFocus("sun")`);
await sleep(1200);
await d.shoot("uxb4-s3-02-desktop-radar-sun-tint");

// 3 — #5 no-regression: desktop is NOT lean. The city pose above sits under the flat-map
// bloom gate (CONTROLS.mapFlatMaxAltM = 120 km — bloom off on the chart BY DESIGN,
// 2026-08-18e), so bloom is asserted at a LEO pose where the flagship look owns it.
const desktopCaps = await d.evalJs(`window.__quality?.deviceCaps?.coarsePointer`);
check("desktop: coarsePointer false (lean profile OFF)", desktopCaps === false, String(desktopCaps));
const desktopDpr = await d.evalJs(`window.__renderer.getPixelRatio()`);
check("desktop: DPR uncapped by lean (=1 at dsf 1)", desktopDpr === 1, String(desktopDpr));
await d.goto("about:blank", 300); // hash-only navs don't reload — the pose applies at load
await d.goto(`http://localhost:4321/#p=48.4640,35.0460,900000,0,30&t=${NOON_UTC}`, 12000);
// Match by substring — the dev bundle renames the class to `_UnrealBloomPass`.
const desktopBloom = await d.evalJs(
  `(() => { const p = window.__composer.passes.find((p) => p.constructor.name.includes("UnrealBloomPass")); return p ? p.enabled : null; })()`,
);
check("desktop: bloom pass enabled at LEO (lean did not leak)", desktopBloom === true, String(desktopBloom));

// 4 — #15 dev-gate: no SW on localhost
const regs = await d.evalJs(`navigator.serviceWorker.getRegistrations().then((r) => r.length)`);
check("desktop: service worker NOT registered in dev (localhost gate)", regs === 0, `${regs} registrations`);

// ───────────────────────── /m leg ─────────────────────────
const m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await m.goto(M_URL, 14000);

// 5 — #5 lean profile on coarse pointer
const mCoarse = await m.evalJs(`window.__quality?.deviceCaps?.coarsePointer`);
check("/m: coarsePointer true under mobile emulation", mCoarse === true, String(mCoarse));
const mDpr = await m.evalJs(`window.__renderer.getPixelRatio()`);
check("/m: lean DPR cap holds (≤1.25 at dsf 3)", typeof mDpr === "number" && mDpr <= 1.25, String(mDpr));
const mBloom = await m.evalJs(
  `(() => { const p = window.__composer.passes.find((p) => p.constructor.name.includes("UnrealBloomPass")); return p ? p.enabled : null; })()`,
);
check("/m: bloom pass disabled (lean)", mBloom === false, String(mBloom));
const mRegs = await m.evalJs(`navigator.serviceWorker.getRegistrations().then((r) => r.length)`);
check("/m: service worker NOT registered in dev", mRegs === 0, `${mRegs} registrations`);

// 6 — #1 PiP: long-press ▲ 3D → FPV, open the fullscreen map, punch-hole checks
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
  await m.click(".mm-open");
  await sleep(3000);
  const pipRect = await m.rect(".mw-pip");
  check("/m: map window carries the PiP hole", pipRect !== null, JSON.stringify(pipRect));
  const closeGone = await m.evalJs(`document.querySelector(".mw-close") === null`);
  check("/m: ✕ MINI-MAP button replaced by the PiP", closeGone === true);
  // The hole must be transparent on the MAP canvas (cleared pixels ⇒ alpha 0 there), while
  // the chart around it stays painted — read the 2D canvas itself, not the composited page.
  const holeProbe = await m.evalJs(`(() => {
    const pip = document.querySelector(".mw-pip");
    const canvas = document.querySelector(".mw-canvas");
    if (!pip || !canvas) return null;
    const pr = pip.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const dpr = canvas.width / cr.width;
    const ctx = canvas.getContext("2d");
    const inside = ctx.getImageData((pr.left - cr.left + pr.width / 2) * dpr, (pr.top - cr.top + pr.height / 2) * dpr, 1, 1).data;
    const outside = ctx.getImageData((pr.left - cr.left - 24) * dpr, (pr.top - cr.top + pr.height / 2) * dpr, 1, 1).data;
    return { insideAlpha: inside[3], outsideAlpha: outside[3] };
  })()`);
  check(
    "/m: hole pixels CLEARED on the map canvas, chart intact beside it",
    holeProbe !== null && holeProbe.insideAlpha === 0 && holeProbe.outsideAlpha === 255,
    JSON.stringify(holeProbe),
  );
  await m.shoot("uxb4-s3-03-m-pip-hole");
  await m.click(".mw-pip");
  await sleep(1200);
  const mwGone = await m.evalJs(`document.querySelector(".mw") === null`);
  check("/m: tapping the PiP closed the map (back to FPV)", mwGone === true);
  const stillFpv = await m.evalJs(`!!document.querySelector(".m-joy")`);
  check("/m: FPV intact after the close", stillFpv);
  await m.shoot("uxb4-s3-04-m-back-to-fpv");
} else {
  check("/m: long-press 3D entered FPV", false, "no ▲ 3D chip found");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
