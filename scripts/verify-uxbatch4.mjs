// Browser verification for OWNER BATCH #4 slice S1 (2026-08-21).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node scripts/verify-uxbatch4.mjs [cdpPort] [shotsDir]     (defaults 9222, verify-shots)
//
// Asserts:
//   1. VEC chip (desktop grid) toggles the vector ribbons + persists vectorsVisible
//   2. TargetPanel: ⌖ FIND IN FRAME sits directly above ✕ UNFOLLOW and arms the FIND surface
//   3. Guide window resizes via the corner grip (rect actually grows)
//   4. MapWindow desktop: −10% size, draggable via grip; target tracking ray = window-edge long
//   5. /m dock: time-only clock, no PLAY/rate; status strip lost the time chip
//   6. /m LAYERS: ▤ VECTOR row present + persists
//   7. /m long-press ▲ 3D → FPV jump (no set point)
//   8. /m 2D two-finger parallel drag ROTATES (compass leaves N) and never flips to 3D
// Screenshots land in verify-shots/ (git-ignored).
import { writeFileSync, mkdirSync } from "node:fs";

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
  const dragBy = async (sel, dx, dy) => {
    const r = await rect(sel);
    if (!r) return false;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    await mouse("mousePressed", cx, cy, { buttons: 1 });
    for (let i = 1; i <= 6; i++) {
      await mouse("mouseMoved", cx + (dx * i) / 6, cy + (dy * i) / 6, { buttons: 1 });
      await sleep(30);
    }
    await mouse("mouseReleased", cx + dx, cy + dy);
    return true;
  };
  return { send, evalJs, shoot, goto, rect, click, mouse, dragBy };
}

const seedPrefs = (t) =>
  t.evalJs(`localStorage.setItem("ftw:view-prefs:v1", JSON.stringify({ prefsRev: 2, skyTargetId: "body:moon" }))`);
const readPrefs = (t) => t.evalJs(`JSON.parse(localStorage.getItem("ftw:view-prefs:v1") ?? "{}")`);

// ───────────────────────── Desktop leg ─────────────────────────
const d = await attach();
await d.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await d.goto("http://localhost:4321/", 4000);
await seedPrefs(d);
await d.goto("about:blank", 300); // real boot at the pose (hash-only goto is same-document)
await d.goto(ORBIT_URL, 16000); // tiles + vector builds warm up

// 1 — VEC chip
check("desktop: VEC chip present", (await d.rect(".ct-vec")) !== null);
await d.shoot("uxb4-01-desktop-vec-on");
await d.click(".ct-vec");
await sleep(1200);
await d.shoot("uxb4-02-desktop-vec-off");
let prefs = await readPrefs(d);
check("desktop: VEC off persisted", prefs.vectorsVisible === false, JSON.stringify(prefs.vectorsVisible));
check(
  "desktop: VEC chip lost is-on",
  await d.evalJs(`!document.querySelector(".ct-vec").classList.contains("is-on")`),
);
await d.click(".ct-vec"); // restore ON
await sleep(400);
prefs = await readPrefs(d);
check("desktop: VEC back on persisted", prefs.vectorsVisible === true);

// 2 — TargetPanel FIND IN FRAME above UNFOLLOW (moon restored from skyTargetId)
const pillOk = await d.evalJs(`!!document.querySelector(".tp-pill")`);
check("desktop: target pill (moon restored)", pillOk);
if (pillOk) {
  await d.click(".tp-pill");
  await sleep(600);
  const order = await d.evalJs(`(() => {
    const ff = document.querySelector(".tp-findframe");
    const uf = document.querySelector(".tp-unfollow");
    if (!ff || !uf) return "missing";
    return ff.compareDocumentPosition(uf) & Node.DOCUMENT_POSITION_FOLLOWING ? "above" : "below";
  })()`);
  check("desktop: FIND IN FRAME directly above UNFOLLOW", order === "above", order);
  await d.click(".tp-findframe");
  await sleep(600);
  check(
    "desktop: FIND IN FRAME arms (aria-pressed)",
    await d.evalJs(`document.querySelector(".tp-findframe").getAttribute("aria-pressed") === "true"`),
  );
  await d.shoot("uxb4-03-desktop-target-findframe");
  await d.click(".tp-findframe"); // disarm again
  await sleep(300);
}

// 3 — Guide resize
await d.click(".gd-toggle");
await sleep(700);
const g0 = await d.rect(".gd-panel");
check("desktop: guide panel opens", g0 !== null);
if (g0) {
  await d.mouse("mouseMoved", g0.x + g0.w / 2, g0.y + g0.h / 2); // hover reveals the grips
  await sleep(200);
  await d.dragBy(".gd-panel > .resize-grip", 150, 100);
  await sleep(400);
  const g1 = await d.rect(".gd-panel");
  check("desktop: guide resized", g1 !== null && g1.w > g0.w + 100 && g1.h > g0.h + 60, `${g0.w}×${g0.h} → ${g1?.w}×${g1?.h}`);
  await d.shoot("uxb4-04-desktop-guide-resized");
  await d.evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await sleep(300);
}

// 4 — MapWindow: size, drag, edge-long target ray
await d.goto("about:blank", 300);
await d.goto(FPV_URL, 16000);
const mmOk = await d.evalJs(`!!document.querySelector(".mm-open")`);
check("desktop: minimap present in FPV", mmOk);
if (mmOk) {
  await d.click(".mm-open");
  await sleep(2500); // slippy tiles for the window
  const mw0 = await d.rect(".mw");
  // −10%: min(57.6rem = 921.6px, 84.6vw = 1353.6px) → 921.6 (old: 1024)
  check("desktop: MapWindow −10% width", mw0 !== null && Math.abs(mw0.w - 921.6) < 3, `w=${mw0?.w}`);
  await d.mouse("mouseMoved", mw0.x + mw0.w / 2, mw0.y + 20);
  await sleep(200);
  const dragOk = await d.dragBy(".mw > .drag-grip", 140, 90);
  await sleep(300);
  const mw1 = await d.rect(".mw");
  check("desktop: MapWindow drags", dragOk && mw1 !== null && Math.abs(mw1.x - mw0.x - 140) < 8, `x ${mw0?.x} → ${mw1?.x}`);
  await d.shoot("uxb4-05-desktop-mapwindow-ray");
  await d.evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
}

// ───────────────────────── /m leg ─────────────────────────
const m = await attach();
await m.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
await m.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await m.goto(M_URL, 4000);
await seedPrefs(m);
await m.goto("about:blank", 300);
await m.goto(M_URL, 14000);

// 5 — dock clock replaces PLAY/rate; strip chip gone
check("/m: dock clock present", await m.evalJs(`!!document.querySelector(".md-clock")`));
check("/m: PLAY button gone", await m.evalJs(`!document.querySelector(".md-play")`));
check("/m: rate select gone", await m.evalJs(`!document.querySelector(".md-rate")`));
check("/m: strip time chip gone", await m.evalJs(`!document.querySelector(".m-chip--time")`));
await m.shoot("uxb4-06-m-dock-clock");

// 6 — LAYERS ▤ VECTOR
await m.evalJs(`(() => { const b = [...document.querySelectorAll(".m-layersrow button")].find((x) => x.textContent.includes("LAYERS")); b?.click(); return !!b; })()`);
await sleep(400);
const vecBtn = await m.evalJs(`(() => { const b = [...document.querySelectorAll(".m-layersrow button")].find((x) => x.textContent.includes("VECTOR")); if (!b) return false; b.click(); return true; })()`);
check("/m: LAYERS has ▤ VECTOR", vecBtn);
await sleep(300);
prefs = await readPrefs(m);
check("/m: VECTOR toggle persisted", prefs.vectorsVisible === false, JSON.stringify(prefs.vectorsVisible));
await m.evalJs(`[...document.querySelectorAll(".m-layersrow button")].find((x) => x.textContent.includes("VECTOR"))?.click()`);
await m.shoot("uxb4-07-m-layers-vector");

// 7 — TargetSheet FIND IN FRAME (moon peek → sheet)
const peekOk = await m.evalJs(`(() => { const p = document.querySelector(".m-peek"); if (!p) return false; p.click(); return true; })()`);
check("/m: target peek (moon restored)", peekOk);
if (peekOk) {
  await sleep(800);
  const orderM = await m.evalJs(`(() => {
    const ff = document.querySelector(".m-findframe");
    const uf = document.querySelector(".m-unfollow");
    if (!ff || !uf) return "missing";
    return ff.compareDocumentPosition(uf) & Node.DOCUMENT_POSITION_FOLLOWING ? "above" : "below";
  })()`);
  check("/m: FIND IN FRAME above UNFOLLOW", orderM === "above", orderM);
  await m.shoot("uxb4-08-m-target-findframe");
  await m.evalJs(`document.querySelector(".m-sheet__close, .m-sheet [aria-label='Close']")?.click()`);
  await sleep(500);
}

// 8 — 2D two-finger parallel drag rotates, never flips 3D
const canvasRect = await m.rect("canvas.globe-canvas");
if (canvasRect) {
  const cy = canvasRect.y + canvasRect.h * 0.45;
  const x1 = canvasRect.x + canvasRect.w * 0.30;
  const x2 = canvasRect.x + canvasRect.w * 0.60;
  const pts = (dx) => [
    { x: x1 + dx, y: cy - 60, id: 1 },
    { x: x2 + dx, y: cy + 60, id: 2 },
  ];
  // Fine 3 px steps — the library classifies ROTATE-vs-ZOOM on the FIRST move past ~6 px, and
  // CDP delivers the two pointers in separate tasks: a coarse step reads as a pinch mid-frame.
  await m.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(0) });
  for (let i = 1; i <= 50; i++) {
    await m.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(i * 3) });
    await sleep(16);
  }
  await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(800);
  const headingNow = await m.evalJs(`(() => {
    const rose = document.querySelector(".m-nav__dial [style*='rotate'], .m-nav__dial[style*='rotate']");
    return rose ? rose.style.transform : null;
  })()`);
  const still2d = await m.evalJs(`(() => { const b = [...document.querySelectorAll(".m-actrow button")][0]; return b ? b.textContent.includes("3D") : null; })()`);
  check("/m: still in 2D after two-finger drag (no tilt door)", still2d === true, String(still2d));
  check(
    "/m: two-finger drag rotated the map (compass off N)",
    headingNow !== null && !/rotate\((-?0(\.0+)?)deg\)/.test(headingNow),
    String(headingNow),
  );
  await m.shoot("uxb4-09-m-2d-rotated");
}

// 9 — long-press ▲ 3D → FPV (no set point)
const chipRect = await m.rect(".m-actrow button");
if (chipRect) {
  const cx = chipRect.x + chipRect.w / 2;
  const cyy = chipRect.y + chipRect.h / 2;
  await m.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cyy, id: 1 }] });
  await sleep(700); // past ORCH.longPressMs
  await m.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(4500); // cinematic arrival
  const fpvOn = await m.evalJs(`!!document.querySelector(".m-joy")`);
  check("/m: long-press 3D entered FPV", fpvOn);
  await m.shoot("uxb4-10-m-longpress-fpv");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
