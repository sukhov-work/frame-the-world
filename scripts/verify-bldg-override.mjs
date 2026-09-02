// Browser verification for U8 per-building height override (owner 2026-08-18/19).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs --headless --port 9333
// --profile /tmp/…), then  node --experimental-websocket scripts/verify-bldg-override.mjs
// [cdpPort] [shotsDir]   (Node 20 needs the flag; ≥22 has global WebSocket).
//
// Asserts, at a street-level Dnipro FPV pose (both shells):
//   1. desktop dblclick ARMS an enriched building (chip + pinned label DOM present, armed tint)
//   2. drag: claimed pointer → ghost preview + live height in the store; camera does NOT turn
//   3. release COMMITS: real mesh eases (enrichedSeats().overridden ≥ 1) + a localStorage row
//      lands under ftw:bldg-overrides:v1 with the per-edit clamp respected
//   4. RESET one-shot restores the baked height + deletes the row
//   5. Escape disarms WITHOUT exiting FPV
//   6. reload → the persisted override re-applies with NO gesture (checksum-validated path)
//   7. /m: double-tap arms + touch drag commits (the glass twin)
// Screenshots in verify-shots/ (git-ignored).
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots";
// Street-level FPV in central Dnipro (the enriched o2w bake), eye 1.7 m, looking north-ish
// with a slight up-pitch — building mass fills the frame for the pick grid.
const FPV_URL = "http://localhost:4321/#f=48.4647,35.0462,1.7,25,8,60&t=1787133600000";
const M_FPV_URL = "http://localhost:4321/m#f=48.4647,35.0462,1.7,25,8,60&t=1787133600000";

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
// audit #3 C11: register for close — an abandoned target holds a WebGL context.
trackTarget(PORT, target.id);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

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
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shoot = async (name) => {
  const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 78 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(shot.data, "base64"));
  console.log(`shot: ${SHOTS}/${name}`);
};
/** audit #3 C11: THROW rather than `process.exit` — the throw unwinds to the cleanup handler
 *  in verify-cdp-cleanup.mjs, which closes this script's CDP target and exits 1. (An `await
 *  finishVerify()` here would NOT do: every call site is `if (x) fail(...)` with no await, so
 *  an async fail would let the script carry on past its own failure.) */
const fail = (msg) => {
  throw new VerifyFailure(msg);
};

const ARMED = "window.__bldgEditStore ? window.__bldgEditStore.getState().armed : null";
const SEATS = "window.__globe && window.__globe.enrichedSeats ? window.__globe.enrichedSeats() : null";
/** MS5b 2026-09-02l: the collection is the PRODUCTION world — other members' synced rows apply at
 *  boot (5 seen), so `overridden` is asserted RELATIVE to what boot found, after the world fetch. */
const worldBaseline = async (label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const w = await evalJs("window.__bldgSyncStore ? window.__bldgSyncStore.getState().world : null").catch(() => null);
    if (w === "ready" || w === "error") break;
    await sleep(250);
  }
  const seats = await evalJs(SEATS);
  console.log(`${label}: world as found — overridden ${seats.overridden} (the relative baseline)`);
  return seats.overridden;
};
const ROWS =
  "(() => { try { const m = JSON.parse(localStorage.getItem('ftw:bldg-overrides:v1') ?? '{}');" +
  " return Object.entries(m).map(([k, r]) => ({ k, scale: r.sy ?? r.k })); } catch { return null; } })()"; // MS1: v2 rows say `sy` (legacy `k` still read)

const waitBoot = async (label, wantFpv) => {
  const t0 = Date.now();
  while (true) {
    const ok = await evalJs("!!(window.__globe && window.__globe.camera)").catch(() => false);
    if (ok) break;
    if (Date.now() - t0 > 90_000) fail(`${label}: globe never booted`);
    await sleep(300);
  }
  console.log(`${label}: globe booted after ${Date.now() - t0} ms`);
  if (wantFpv) {
    const t1 = Date.now();
    while (true) {
      const fpv = await evalJs("window.__globe.fpv && window.__globe.fpv().active").catch(() => false);
      if (fpv) break;
      if (Date.now() - t1 > 30_000) fail(`${label}: FPV never activated from the #f= share`);
      await sleep(300);
    }
  }
  // Enriched cells + per-feature registries must be streamed before any pick can land.
  const t2 = Date.now();
  while (true) {
    const seats = await evalJs(SEATS).catch(() => null);
    if (seats && seats.cells > 0 && seats.features > 200 && seats.located > 0) {
      console.log(`${label}: enriched ready — ${seats.cells} cells · ${seats.features} features · overridden ${seats.overridden}`);
      return seats;
    }
    if (Date.now() - t2 > 90_000) fail(`${label}: enriched cells never streamed (${JSON.stringify(seats)})`);
    await sleep(750);
  }
};

const mouse = (type, x, y, opts = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseMoved" ? 1 : undefined, ...opts });

/** Real dblclick at (x,y): two press/release pairs, clickCount 1 then 2 (Chrome's own shape). */
const dblclick = async (x, y) => {
  await mouse("mousePressed", x, y, { clickCount: 1 });
  await mouse("mouseReleased", x, y, { clickCount: 1 });
  await sleep(60);
  await mouse("mousePressed", x, y, { clickCount: 2 });
  await mouse("mouseReleased", x, y, { clickCount: 2 });
};

mkdirSync(SHOTS, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
// Clean slate: a reused verify profile keeps the previous run's persisted override (which
// correctly re-applies at boot — that's assertion 6) — clear it, then boot fresh.
await send("Page.navigate", { url: "http://localhost:4321/" });
await sleep(1500);
await evalJs("localStorage.removeItem('ftw:bldg-overrides:v1'), true").catch(() => {});
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url: FPV_URL });
await waitBoot("desktop", true);
const W0 = await worldBaseline("desktop");
// Welcome overlay eats pointer events + shot #1 — a canvas pointerdown dismisses (no-op if gone).
await evalJs("document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true");
await sleep(4000); // let nearest-cell seats settle so the pick's committedK/heights are real

// --- 1: dblclick ARMS — grid-scan the frame until a building qualifies ------------------------
const GRID = [
  [800, 470], [640, 470], [960, 470], [800, 560], [520, 520],
  [1080, 520], [800, 380], [400, 560], [1200, 560], [800, 640],
];
let armed = null;
let armPt = null;
for (const [x, y] of GRID) {
  await dblclick(x, y);
  await sleep(250);
  armed = await evalJs(ARMED);
  if (armed) { armPt = [x, y]; break; }
}
if (!armed) fail("no dblclick in the grid armed a building (pick path dead?)");
console.log(`armed @${armPt}: featureId ${armed.featureId} · original ${armed.originalHeightM.toFixed(1)} m · live ${armed.liveHeightM.toFixed(1)} m`);
if (Math.abs(armed.liveHeightM - armed.originalHeightM) > 0.01) fail("fresh arm should start at the original height");
const chipDom = await evalJs("!!document.querySelector('.bldg-edit-chip')");
const labelDom = await evalJs("!!document.querySelector('.bldg-edit-label')");
if (!chipDom) fail("HEIGHT chip island did not render for the armed building");
if (!labelDom) fail("mesh-pinned label layer missing");
await sleep(400);
await shoot("u8-01-armed-tint-chip.jpeg");

// --- 2: drag = claimed pointer → ghost + live height; the camera must NOT turn ----------------
const yaw0 = await evalJs("window.__globe.fpv().yawDeg");
const [ax, ay] = armPt;
await sleep(450); // outside the dblclick window — this press must read as a fresh gesture
await mouse("mousePressed", ax, ay, { clickCount: 1 });
for (let i = 1; i <= 8; i++) {
  await mouse("mouseMoved", ax, ay - i * 25);
  await sleep(30);
}
const midDrag = await evalJs(ARMED);
if (!midDrag?.dragging) fail("mid-drag: store mirror never flipped to dragging");
if (!(midDrag.liveHeightM > midDrag.originalHeightM * 1.2))
  fail(`mid-drag: live height ${midDrag.liveHeightM.toFixed(1)} did not grow past 1.2× original ${midDrag.originalHeightM.toFixed(1)}`);
const yaw1 = await evalJs("window.__globe.fpv().yawDeg");
if (Math.abs(yaw1 - yaw0) > 0.5) fail(`camera turned during the claimed drag (yaw ${yaw0.toFixed(2)} → ${yaw1.toFixed(2)})`);
console.log(`mid-drag: live ${midDrag.liveHeightM.toFixed(1)} m (Δ ${midDrag.deltaM.toFixed(1)}) · yaw pinned`);
await shoot("u8-02-ghost-drag.jpeg");
await mouse("mouseReleased", ax, ay - 200, { clickCount: 1 });
await sleep(1500); // ease settles

// --- 3: commit — real mesh + localStorage row -------------------------------------------------
const afterCommit = await evalJs(ARMED);
if (afterCommit?.dragging) fail("release did not end the drag");
if (!afterCommit?.overridden) fail("release did not mark the building overridden");
let seats = await evalJs(SEATS);
if (!(seats.overridden >= W0 + 1)) fail(`commit did not reach the mesh (overridden=${seats.overridden}, world ${W0})`);
let rows = await evalJs(ROWS);
if (!rows || rows.length !== 1) fail(`expected exactly 1 stored row, got ${JSON.stringify(rows)}`);
if (!rows[0].k.startsWith("dnipro-o2w|cell-")) fail(`row key shape wrong: ${rows[0].k}`);
if (!(rows[0].scale > 1.2 && rows[0].scale <= 10.001)) fail(`stored scale ${rows[0].scale} outside the expected (1.2, 10] per-edit band (MS5b: 0.1×–10× per edit)`);
console.log(`committed: row ${rows[0].k} scale ${rows[0].scale.toFixed(2)} · mesh overridden ${seats.overridden}`);
const committedScale = rows[0].scale;
await shoot("u8-03-committed.jpeg");

// --- 4: RESET one-shot ------------------------------------------------------------------------
const resetBtn = await evalJs("!!document.querySelector('.bec-reset')");
if (!resetBtn) fail("RESET button absent on an overridden armed building");
await evalJs("window.__bldgEditStore.getState().requestReset(), true");
await sleep(1500);
rows = await evalJs(ROWS);
seats = await evalJs(SEATS);
if (rows.length !== 0) fail(`RESET left rows behind: ${JSON.stringify(rows)}`);
if (seats.overridden !== W0) fail(`RESET did not restore the mesh (overridden=${seats.overridden}, world ${W0})`);
console.log("RESET: row deleted · mesh back to baked height");

// --- re-establish an override for the reload test (same armed building, fresh drag) ----------
await sleep(450);
await mouse("mousePressed", ax, ay, { clickCount: 1 });
for (let i = 1; i <= 6; i++) { await mouse("mouseMoved", ax, ay - i * 25); await sleep(30); }
await mouse("mouseReleased", ax, ay - 150, { clickCount: 1 });
await sleep(1200);
rows = await evalJs(ROWS);
if (rows.length !== 1) fail("re-drag after RESET did not store a row");

// --- 5: Escape disarms, FPV survives ----------------------------------------------------------
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(400);
const armedAfterEsc = await evalJs(ARMED);
const fpvAfterEsc = await evalJs("window.__globe.fpv().active");
if (armedAfterEsc) fail("Escape did not disarm");
if (!fpvAfterEsc) fail("Escape exited FPV instead of just disarming");
console.log("Escape: disarmed · FPV intact");

// --- 6: reload — the persisted override re-applies with NO gesture ----------------------------
await send("Page.navigate", { url: "about:blank" });
await sleep(400);
await send("Page.navigate", { url: FPV_URL });
await waitBoot("reload", true);
const t3 = Date.now();
let reSeats = null;
while (Date.now() - t3 < 45_000) {
  reSeats = await evalJs(SEATS).catch(() => null);
  if (reSeats && reSeats.overridden >= W0 + 1) break;
  await sleep(1000);
}
if (!(reSeats && reSeats.overridden >= W0 + 1)) fail(`reload: persisted override never re-applied (${JSON.stringify(reSeats)}, world ${W0})`);
console.log(`reload: override re-applied (overridden=${reSeats.overridden})`);
await sleep(2500);
await shoot("u8-04-reload-reapplied.jpeg");

// --- 7: /m — double-tap arms + touch drag commits ---------------------------------------------
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true });
await send("Page.navigate", { url: M_FPV_URL });
await waitBoot("/m", true);
const W0m = await worldBaseline("/m");
await sleep(4000);
const touch = (type, points) => send("Input.dispatchTouchEvent", { type, touchPoints: points });
const tapAt = async (x, y) => {
  await touch("touchStart", [{ x, y }]);
  await sleep(40);
  await touch("touchEnd", []);
};
const M_GRID = [
  [195, 380], [140, 380], [250, 380], [195, 300], [195, 460], [120, 440], [270, 440], [195, 240],
];
let mArmed = null;
let mPt = null;
for (const [x, y] of M_GRID) {
  await tapAt(x, y);
  await sleep(120); // inside doubleTapMs
  await tapAt(x, y);
  await sleep(300);
  mArmed = await evalJs(ARMED);
  if (mArmed) { mPt = [x, y]; break; }
  await sleep(400); // outside the window before the next candidate
}
if (!mArmed) fail("/m: no double-tap in the grid armed a building");
console.log(`/m armed @${mPt}: featureId ${mArmed.featureId} · original ${mArmed.originalHeightM.toFixed(1)} m`);
await sleep(300);
await shoot("u8-05-m-armed.jpeg");
const rowsBefore = (await evalJs(ROWS)).length;
const [mx, my] = mPt;
await sleep(500);
await touch("touchStart", [{ x: mx, y: my }]);
for (let i = 1; i <= 7; i++) {
  await touch("touchMove", [{ x: mx, y: my - i * 20 }]);
  await sleep(30);
}
const mMid = await evalJs(ARMED);
if (!mMid?.dragging) fail("/m mid-drag: dragging never flipped");
if (!(mMid.liveHeightM > mMid.originalHeightM)) fail("/m mid-drag: height did not grow");
await shoot("u8-06-m-ghost-drag.jpeg");
await touch("touchEnd", []);
await sleep(1500);
const mRows = await evalJs(ROWS);
const mSeats = await evalJs(SEATS);
if (!(mRows.length > rowsBefore || mRows.some((r) => Math.abs(r.scale - 1) > 0.01)))
  fail(`/m commit did not store (rows ${JSON.stringify(mRows)})`);
// The fixture building already carries the desktop legs' persisted row (re-applied at the /m boot), so
// the COUNT cannot grow — assert the building's own engine target instead (MS5b: relative counts).
const mState = await evalJs(`window.__globe.enrichedState(${JSON.stringify(mMid.cellUri)}, ${mMid.featureId})`);
if (!mState || !(mState.target.sy > 1.01)) fail(`/m commit did not reach the mesh (target ${JSON.stringify(mState?.target)})`);
if (!(mSeats.overridden >= W0m)) fail(`/m: overridden fell below the world baseline (${mSeats.overridden}, world ${W0m})`);
console.log(`/m committed: ${mRows.length} row(s) · target sy ${mState.target.sy.toFixed(3)} · mesh overridden ${mSeats.overridden} (world ${W0m})`);

console.log(
  `PASS: arm(dblclick+double-tap) · claimed drag (ghost, yaw pinned) · commit (mesh+storage, scale ${committedScale.toFixed(2)}) · RESET · Esc-in-FPV · reload re-apply · /m twin`,
);
ws.close();
await finishVerify(0); // audit #3 C11: return the CDP target on the success path too
