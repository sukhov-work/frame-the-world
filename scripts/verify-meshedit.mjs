// Browser verification for MESH SUITE MS1 — the spatial-edit SUBSTRATE (2026-09-02), driven
// through the DEV seam `__globe.enrichedSetTransform` (the same commit path a gizmo release
// takes) because the gizmo UI is MS2. Usage: wix dev on :4321 + CDP Chrome
// (scripts/verify-chrome.mjs --headless --port 9333 --profile <dir>), then
//   node scripts/verify-meshedit.mjs [cdpPort] [shotsDir]      (Node ≥22: global WebSocket)
//
// Asserts, at the U8 street-level Dnipro FPV pose:
//   1. arm a building (dblclick grid) → the armed mirror now carries `cellUri`; the engine's
//      featureState reads identity target/applied + finite checksum facts
//   2. a spatial edit through the seam: target set exactly (inside the rails), the persisted
//      v2 row carries `sy sx rotDeg tE tN tU` and NO `k`, the run is re-queued for a terrain
//      sample the same tick (unseated +1 — landmine #1), the ease SETTLES on the target within
//      ~1.5 s (every component, exactly), enrichedSeats().spatial === 1
//   3. rails: an over-long translation is shortened to TRANSLATE_MAX_M keeping direction, the
//      lift is capped at LIFT_MAX_M — engine target AND stored row agree (post-clamp read-back)
//   4. RESET through the seam (identity): row deleted, ease settles, the run leaves the
//      absolute path (spatial 0) — the §4a-3 fall-back-to-fast-path claim
//   5. reload: a spatial row re-applies with NO gesture (spatial ≥ 1, target rotDeg exact)
//   6. LEGACY compat (§4a-1): a hand-written U8 `{k}` row for the same building re-applies as
//      `sy` after reload, on the FAST path (spatial 0, overridden 1)
//   MESH SUITE MS2 (the gizmo UI, 2026-09-02 — driven with REAL pointer/key events through the
//   FPV gesture table; `__globe.bldgGizmo()` only READS state + projects the handles to px):
//   7. right-click the armed building → the context menu (store mirror + DOM) → MOVE applies
//      (chip tab lit, gizmo attached, ghost body hidden between drags)
//   8. a mouse drag on the X arrow: hover highlights (axis X, cursor grab), the live transform
//      moves, the chip mirrors `dragging`, release COMMITS a move (target + row agree), the
//      camera never turned; then an OFF-handle drag is a plain look-around (yaw changes, the
//      building does not, still armed)
//   9. R → ROTATE; a drag on the Y ring yaws the building (rotDeg committed + persisted)
//  10. S → SCALE; a drag on the X box scales the footprint inside the per-edit band
//  11. the chip's per-op ↺ reverts ROTATE alone (the move + scale survive)
//  12. Escape MID-DRAG cancels: target unchanged, drag ended, still armed
//  13. RESET ALL → identity, row gone, fast path, still armed
//  14. menu → DONE disarms; FPV intact; gizmo detached
// Screenshots in verify-shots/ (git-ignored).
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots";
const FPV_URL = "http://localhost:4321/#f=48.4647,35.0462,1.7,25,8,60&t=1787133600000";
const KEY = "ftw:bldg-overrides:v1";

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
trackTarget(PORT, target.id); // audit #3 C11: an abandoned target holds a WebGL context
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

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
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
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
/** audit #3 C11: THROW — unwinds to verify-cdp-cleanup's handler (closes the target, exits 1). */
const fail = (msg) => {
  throw new VerifyFailure(msg);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const ARMED = "window.__bldgEditStore ? window.__bldgEditStore.getState().armed : null";
const SEATS = "window.__globe && window.__globe.enrichedSeats ? window.__globe.enrichedSeats() : null";
const ROWS = `(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) ?? '{}'); } catch { return null; } })()`;
const state = (cellUri, fid) => evalJs(`window.__globe.enrichedState(${JSON.stringify(cellUri)}, ${fid})`);
const setXf = (cellUri, fid, t) =>
  evalJs(
    `(() => { const before = window.__globe.enrichedSeats().unseated;` +
      ` window.__globe.enrichedSetTransform(${JSON.stringify(cellUri)}, ${fid}, ${JSON.stringify(t)});` +
      ` return { before, after: window.__globe.enrichedSeats().unseated, state: window.__globe.enrichedState(${JSON.stringify(cellUri)}, ${fid}) }; })()`,
  );
const waitSettled = async (cellUri, fid, label, timeoutMs = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await state(cellUri, fid);
    if (s && Object.keys(s.target).every((k) => s.applied[k] === s.target[k])) return s;
    await sleep(120);
  }
  const s = await state(cellUri, fid);
  fail(`${label}: ease never settled on the target (${JSON.stringify(s)})`);
};

const waitBoot = async (label) => {
  const t0 = Date.now();
  while (true) {
    const ok = await evalJs("!!(window.__globe && window.__globe.camera && window.__globe.enrichedSetTransform)").catch(() => false);
    if (ok) break;
    if (Date.now() - t0 > 90_000) fail(`${label}: globe (with the MS1 seam) never booted`);
    await sleep(300);
  }
  const t1 = Date.now();
  while (true) {
    const fpv = await evalJs("window.__globe.fpv && window.__globe.fpv().active").catch(() => false);
    if (fpv) break;
    if (Date.now() - t1 > 30_000) fail(`${label}: FPV never activated from the #f= share`);
    await sleep(300);
  }
  const t2 = Date.now();
  while (true) {
    const seats = await evalJs(SEATS).catch(() => null);
    if (seats && seats.cells > 0 && seats.features > 200 && seats.located > 0) {
      console.log(`${label}: enriched ready — ${seats.cells} cells · ${seats.features} features · spatial ${seats.spatial} · overridden ${seats.overridden}`);
      return seats;
    }
    if (Date.now() - t2 > 90_000) fail(`${label}: enriched cells never streamed (${JSON.stringify(seats)})`);
    await sleep(750);
  }
};
const dismissWelcome = () =>
  evalJs("(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true");

const mouse = (type, x, y, opts = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseMoved" ? 1 : undefined, ...opts });
const dblclick = async (x, y) => {
  await mouse("mousePressed", x, y, { clickCount: 1 });
  await mouse("mouseReleased", x, y, { clickCount: 1 });
  await sleep(60);
  await mouse("mousePressed", x, y, { clickCount: 2 });
  await mouse("mouseReleased", x, y, { clickCount: 2 });
};
let lastArmPx = { x: 0, y: 0 }; // the screen point whose dblclick armed (MS2 right-clicks it)
const armOne = async (label) => {
  const GRID = [
    [800, 470], [640, 470], [960, 470], [800, 560], [520, 520],
    [1080, 520], [800, 380], [400, 560], [1200, 560], [800, 640],
  ];
  for (const [x, y] of GRID) {
    await dblclick(x, y);
    await sleep(250);
    const armed = await evalJs(ARMED);
    if (armed) {
      lastArmPx = { x, y };
      return armed;
    }
  }
  fail(`${label}: no dblclick in the grid armed a building`);
};

mkdirSync(SHOTS, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
// Clean slate (a reused profile keeps rows — they'd re-apply at boot, correctly, and break "fresh").
await send("Page.navigate", { url: "http://localhost:4321/" });
await sleep(1500);
await evalJs(`localStorage.removeItem(${JSON.stringify(KEY)}), true`).catch(() => {});
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url: FPV_URL });
await waitBoot("boot");
await dismissWelcome();
await sleep(4000); // nearest-cell seats settle

// --- 1: arm → cellUri on the mirror, identity state --------------------------------------------
const armed = await armOne("arm");
if (typeof armed.cellUri !== "string" || !/^cell-\d+-\d+\.glb$/.test(armed.cellUri))
  fail(`armed mirror lacks a cell identity: ${JSON.stringify(armed)}`);
const { cellUri, featureId: fid } = armed;
const s0 = await state(cellUri, fid);
if (!s0) fail("enrichedState returned null for the armed building");
for (const k of ["sy", "sx", "sz"]) if (s0.target[k] !== 1 || s0.applied[k] !== 1) fail(`fresh ${k} not 1: ${JSON.stringify(s0)}`);
for (const k of ["rotDeg", "tE", "tN", "tU"]) if (s0.target[k] !== 0 || s0.applied[k] !== 0) fail(`fresh ${k} not 0: ${JSON.stringify(s0)}`);
if (![s0.cx, s0.cz, s0.bakedHeightM].every(Number.isFinite) || !(s0.vc > 0)) fail(`checksum facts missing: ${JSON.stringify(s0)}`);
console.log(`armed ${cellUri}|${fid}: baked ${s0.bakedHeightM.toFixed(1)} m · vc ${s0.vc} · cx/cz ${s0.cx.toFixed(1)}/${s0.cz.toFixed(1)}`);
const seatsBefore = await evalJs(SEATS);
if (seatsBefore.spatial !== 0) fail(`spatial should start at 0, got ${seatsBefore.spatial}`);

// --- 2: a spatial edit through the seam --------------------------------------------------------
const T1 = { sy: 1.4, sx: 1.2, sz: 1, rotDeg: 25, tE: 6, tN: -4, tU: 1.5 };
const r1 = await setXf(cellUri, fid, T1);
for (const k of Object.keys(T1)) if (r1.state.target[k] !== T1[k]) fail(`target.${k} = ${r1.state.target[k]}, wanted ${T1[k]} (inside the rails, must be exact)`);
if (!(r1.after >= r1.before + 1)) fail(`translation did not re-queue the footprint for a terrain sample (unseated ${r1.before} → ${r1.after})`);
let rows = await evalJs(ROWS);
let keys = Object.keys(rows ?? {});
if (keys.length !== 1 || !keys[0].endsWith(`|${cellUri}|${fid}`)) fail(`expected exactly one row for the building, got ${JSON.stringify(rows)}`);
const row1 = rows[keys[0]];
if ("k" in row1) fail("v2 row still carries legacy `k`");
for (const k of ["sy", "sx", "rotDeg", "tE", "tN", "tU"]) if (row1[k] !== T1[k]) fail(`row.${k} = ${row1[k]}, wanted ${T1[k]}`);
if ("sz" in row1) fail("identity component `sz` must be OMITTED from the row");
console.log(`row: ${keys[0]} → ${JSON.stringify(row1)}`);
const s1 = await waitSettled(cellUri, fid, "spatial ease");
let seats = await evalJs(SEATS);
if (seats.spatial !== 1) fail(`spatial should be 1 after the edit, got ${seats.spatial}`);
if (seats.overridden < 1) fail(`overridden should count the edited building, got ${seats.overridden}`);
const mirror = await evalJs(ARMED);
if (!mirror || !near(mirror.liveHeightM, mirror.originalHeightM * 1.4, 0.05)) fail(`armed mirror height not in step with the seam edit: ${JSON.stringify(mirror)}`);
console.log(`settled: applied ${JSON.stringify(s1.applied)} · spatial ${seats.spatial} · overridden ${seats.overridden}`);
await sleep(600);
await shoot("meshedit-01-spatial-applied.jpeg");

// --- 3: rails (post-clamp read-back — engine target AND row agree) -----------------------------
const r2 = await setXf(cellUri, fid, { sy: 1, sx: 1, sz: 1, rotDeg: 0, tE: 300, tN: 400, tU: 99 });
const tt = r2.state.target;
if (!near(Math.hypot(tt.tE, tt.tN), 60, 1e-6)) fail(`translate rail: |t| = ${Math.hypot(tt.tE, tt.tN)}, wanted 60`);
if (!near(tt.tE / tt.tN, 0.75, 1e-9)) fail(`translate rail changed the direction: ${tt.tE}/${tt.tN}`);
if (tt.tU !== 25) fail(`lift rail: tU = ${tt.tU}, wanted 25`);
rows = await evalJs(ROWS);
const row2 = rows[Object.keys(rows)[0]];
if (!near(row2.tE, tt.tE) || !near(row2.tN, tt.tN) || row2.tU !== 25) fail(`stored row disagrees with the clamped target: ${JSON.stringify(row2)}`);
if ("sy" in row2 && row2.sy !== 1) fail(`height must be back to 1: ${JSON.stringify(row2)}`);
await waitSettled(cellUri, fid, "rails ease");
console.log(`rails: |t| 60 m (${tt.tE.toFixed(2)}, ${tt.tN.toFixed(2)}) · lift 25 m · row agrees`);
await sleep(400);
await shoot("meshedit-02-rails.jpeg");

// --- 4: RESET through the seam → row gone, run back on the fast path ---------------------------
await setXf(cellUri, fid, { sy: 1, sx: 1, sz: 1, rotDeg: 0, tE: 0, tN: 0, tU: 0 });
rows = await evalJs(ROWS);
if (Object.keys(rows).length !== 0) fail(`RESET left a row behind: ${JSON.stringify(rows)}`);
await waitSettled(cellUri, fid, "reset ease");
await sleep(200);
seats = await evalJs(SEATS);
if (seats.spatial !== 0) fail(`after RESET the run must leave the absolute path (spatial=${seats.spatial})`);
if (seats.overridden !== 0) fail(`after RESET nothing is overridden (overridden=${seats.overridden})`);
console.log("RESET: row deleted · ease settled · fast path restored (spatial 0)");

// --- 5: reload re-applies a spatial row with NO gesture ----------------------------------------
const T3 = { sy: 1.25, sx: 1, sz: 1.1, rotDeg: 30, tE: 5, tN: 0, tU: 0 };
await setXf(cellUri, fid, T3);
rows = await evalJs(ROWS);
if (Object.keys(rows).length !== 1) fail("the reload row did not persist");
await send("Page.navigate", { url: "about:blank" });
await sleep(400);
await send("Page.navigate", { url: FPV_URL });
await waitBoot("reload");
await dismissWelcome();
const t3 = Date.now();
let re = null;
while (Date.now() - t3 < 45_000) {
  re = await evalJs(SEATS).catch(() => null);
  if (re && re.spatial >= 1) break;
  await sleep(1000);
}
if (!(re && re.spatial >= 1)) fail(`reload: the spatial row never re-applied (${JSON.stringify(re)})`);
const s3 = await waitSettled(cellUri, fid, "reload ease", 10_000);
if (s3.target.rotDeg !== 30 || s3.target.tE !== 5 || s3.target.sz !== 1.1 || s3.target.sy !== 1.25) fail(`reload target wrong: ${JSON.stringify(s3.target)}`);
console.log(`reload: re-applied (spatial ${re.spatial}) · target ${JSON.stringify(s3.target)}`);
await sleep(1500);
await shoot("meshedit-03-reload-reapplied.jpeg");

// --- 6: LEGACY `k` row (§4a-1) re-applies as `sy` on the FAST path -----------------------------
const legacyKey = Object.keys(await evalJs(ROWS))[0];
const legacyRow = { k: 2, cx: Math.round(s3.cx * 2) / 2, cz: Math.round(s3.cz * 2) / 2, vc: s3.vc, hM: Math.round(s3.bakedHeightM * 10) / 10, t: 1 };
await evalJs(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify({ [legacyKey]: legacyRow }))}), true`);
await send("Page.navigate", { url: "about:blank" });
await sleep(400);
await send("Page.navigate", { url: FPV_URL });
await waitBoot("legacy");
await dismissWelcome();
const t4 = Date.now();
let lg = null;
while (Date.now() - t4 < 45_000) {
  lg = await evalJs(SEATS).catch(() => null);
  if (lg && lg.overridden >= 1) break;
  await sleep(1000);
}
if (!(lg && lg.overridden >= 1)) fail(`legacy: the {k} row never re-applied (${JSON.stringify(lg)})`);
const s4 = await state(cellUri, fid);
if (!s4 || s4.target.sy !== 2) fail(`legacy: target.sy = ${s4?.target.sy}, wanted 2 (read from k)`);
if (lg.spatial !== 0) fail(`legacy: a height-only row must stay on the fast path (spatial=${lg.spatial})`);
const stored = (await evalJs(ROWS))[legacyKey];
if (!stored || stored.k !== 2 || "sy" in stored) fail(`legacy: the stored row must stay untouched until the next edit (${JSON.stringify(stored)})`);
console.log(`legacy: {k:2} applied as sy 2 · fast path (spatial 0) · row untouched in storage`);

// ═══ MESH SUITE MS2 — the gizmo UI, through REAL pointer + key events ═══════════════════════
const GZ = "window.__globe.bldgGizmo()";
const gz = () => evalJs(GZ);
const BS = "window.__bldgEditStore.getState()";
const key = async (code, k, vk) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
};
const hover = (x, y) => mouse("mouseMoved", x, y, { buttons: 0 });
/** Drag from `from` along unit `(ux, uy)` for `px` in `steps`; returns the release point. */
const dragFrom = async (from, ux, uy, px, steps = 6, midHook = null) => {
  await hover(from.x, from.y);
  await sleep(60);
  await mouse("mousePressed", from.x, from.y, { clickCount: 1 });
  await sleep(40);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", from.x + (ux * px * i) / steps, from.y + (uy * px * i) / steps);
    await sleep(30);
    if (midHook && i === Math.ceil(steps / 2)) await midHook();
  }
  const end = { x: from.x + ux * px, y: from.y + uy * px };
  await mouse("mouseReleased", end.x, end.y, { clickCount: 1 });
  await sleep(150);
  return end;
};
/** A handle's press point + the axis direction on screen. `handlePx` projects the picker's
 *  exact centre; the press is nudged 4 px off that centre line — on the arrow's body, where a
 *  hand lands, never on its mathematical axis. */
const handleDir = async (name) => {
  const hp = await evalJs(`${GZ}.handlePx(${JSON.stringify(name)})`);
  const o = await evalJs(`${GZ}.originPx()`);
  if (!hp || !o) fail(`handle ${name} is not on screen: ${JSON.stringify({ hp, o })}`);
  const dx = hp.x - o.x;
  const dy = hp.y - o.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return { hp: { x: hp.x - uy * 4, y: hp.y + ux * 4 }, centre: hp, o, ux, uy };
};
const yawDeg = () => evalJs("window.__globe.fpv().yawDeg");
/** The gizmo rides the building, and the building rides its terrain seat: the RC7 drain lands
 *  a first sample per feature seconds after boot and the run can drop by the cell's relief when
 *  it does (browser-caught 2026-09-02: a 47 m jump mid-leg moved the handles from under the
 *  press). Press handles only once the armed feature is SEATED and the rig base has been still
 *  for four samples. */
const waitSeatedStill = async (cellUri, fid, label, timeoutMs = 30_000) => {
  const t0 = Date.now();
  let still = 0;
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const st = await state(cellUri, fid);
    const rig = await evalJs(`${GZ}.rig`);
    if (st && st.seated && rig) {
      if (last !== null && Math.abs(rig.liveBaseY - last) < 0.005) still++;
      else still = 0;
      last = rig.liveBaseY;
      if (still >= 4) return rig.liveBaseY;
    }
    await sleep(150);
  }
  fail(`${label}: the armed building never seated and settled (last base ${last})`);
};

// Clean slate for the gizmo legs (the legacy row of leg 6 is not the fixture here).
await evalJs(`localStorage.removeItem(${JSON.stringify(KEY)}), true`);
await send("Page.navigate", { url: "about:blank" });
await sleep(400);
await send("Page.navigate", { url: FPV_URL });
await waitBoot("gizmo");
await dismissWelcome();
await sleep(4000);
const armedG = await armOne("gizmo-arm");
if (armedG.op !== "extrude") fail(`a fresh arm must start at EXTRUDE (U8 default), got ${armedG.op}`);
const gU = await gz();
if (gU.attached) fail("the gizmo is attached in the EXTRUDE op");

// --- 7: right-click → context menu → MOVE ------------------------------------------------------
await evalJs(
  `(() => { const c = document.querySelector('canvas'); c.dispatchEvent(new MouseEvent('contextmenu', { clientX: ${lastArmPx.x}, clientY: ${lastArmPx.y}, bubbles: true, cancelable: true })); return true; })()`,
);
await sleep(150);
const menu7 = await evalJs(`${BS}.menu`);
if (!menu7 || typeof menu7.screenX !== "number") fail("right-click on the armed building did not open the context menu");
if (!(await evalJs("!!document.querySelector('.bldg-menu')"))) fail("menu mirror set but no .bldg-menu in the DOM");
if (!(await evalJs("!!document.querySelector('.bldg-menu__item[data-op=\"move\"]')"))) fail("the menu has no MOVE item");
await evalJs("document.querySelector('.bldg-menu__item[data-op=\"move\"]').click(), true");
await sleep(300); // ≥ 2 frames: the frame service applies the op, the helper composes
let g = await gz();
if (g.op !== "move" || !g.attached) fail(`MOVE not applied via the menu: ${JSON.stringify(g)}`);
if (await evalJs(`${BS}.menu !== null`)) fail("the menu did not close after choosing an op");
if ((await evalJs(`${BS}.armed.op`)) !== "move") fail("armed mirror op is not move");
if (!(await evalJs("!!document.querySelector('.bec-op.is-on[data-op=\"move\"]')"))) fail("the chip's MOVE tab is not lit");
if (!g.rig || g.rig.bodyVisible) fail(`ghost body must exist and hide between drags: ${JSON.stringify(g.rig)}`);
console.log(`menu → MOVE: attached · rig liveBase ${g.rig.liveBaseY.toFixed(2)} · body hidden`);

// --- 8: a real drag on the X arrow commits a move; the camera never turns --------------------
const base8 = await waitSeatedStill(cellUri, fid, "move");
console.log(`seated: rig base ${base8.toFixed(2)} m, still`);
const s7 = await state(cellUri, fid);
const hX = await handleDir("X");
await hover(hX.hp.x, hX.hp.y);
await sleep(80);
g = await gz();
if (g.axis !== "X") fail(`hovering the X handle did not highlight it (axis ${g.axis})`);
if ((await evalJs("document.querySelector('canvas').style.cursor")) !== "grab") fail("cursor is not 'grab' over a handle");
const yaw8 = await yawDeg();
let sawDrag = null;
await dragFrom(hX.hp, hX.ux, hX.uy, 72, 6, async () => {
  sawDrag = { g: await gz(), mirror: await evalJs(`${BS}.armed`), cursor: await evalJs("document.querySelector('canvas').style.cursor") };
});
if (!sawDrag || !sawDrag.g.dragging) fail(`no gizmo drag was live mid-gesture: ${JSON.stringify(sawDrag)}`);
if (!sawDrag.g.live || Math.hypot(sawDrag.g.live.tE, sawDrag.g.live.tN) < 0.3) fail(`live transform did not move: ${JSON.stringify(sawDrag.g.live)}`);
if (!sawDrag.g.rig.bodyVisible) fail("ghost body hidden during the drag");
if (!sawDrag.mirror.dragging || sawDrag.mirror.op !== "move") fail(`chip mirror mid-drag: ${JSON.stringify(sawDrag.mirror)}`);
g = await gz();
if (g.dragging || g.live) fail(`drag did not end on release: ${JSON.stringify(g)}`);
if (g.rig.bodyVisible) fail("ghost body still visible after release");
if (Math.abs((await yawDeg()) - yaw8) > 1e-6) fail("a gizmo drag turned the camera");
const s8 = await state(cellUri, fid);
const movedM = Math.hypot(s8.target.tE - s7.target.tE, s8.target.tN - s7.target.tN);
if (movedM < 0.3) fail(`release did not commit a move: ${JSON.stringify(s8.target)}`);
rows = await evalJs(ROWS);
keys = Object.keys(rows ?? {});
if (keys.length !== 1) fail(`the move did not persist exactly one row: ${JSON.stringify(rows)}`);
if (Math.abs((rows[keys[0]].tE ?? 0) - s8.target.tE) > 1e-6 || Math.abs((rows[keys[0]].tN ?? 0) - s8.target.tN) > 1e-6)
  fail(`row disagrees with the committed target: ${JSON.stringify(rows[keys[0]])} vs ${JSON.stringify(s8.target)}`);
await waitSettled(cellUri, fid, "move ease");
seats = await evalJs(SEATS);
if (seats.spatial !== 1) fail(`after the move the run must be on the absolute path (spatial ${seats.spatial})`);
const chipMove = await evalJs("document.querySelector('.bec-row[data-op=\"move\"] .bec-v')?.textContent ?? ''");
if (!/E · .* N · ↑/.test(chipMove)) fail(`chip MOVE row readout: "${chipMove}"`);
if (!(await evalJs("!!document.querySelector('.bec-revert[data-op=\"move\"]')"))) fail("no per-op ↺ on the edited MOVE row");
const labelTxt = await evalJs("document.querySelector('.bldg-edit-label')?.textContent ?? ''");
if (!labelTxt.includes("↔")) fail(`the pinned label carries no MOVE op line: "${labelTxt}"`);
console.log(`MOVE: dragged ${movedM.toFixed(2)} m (tE ${s8.target.tE.toFixed(2)}, tN ${s8.target.tN.toFixed(2)}) · row agrees · camera pinned · chip "${chipMove}"`);
await sleep(300);
await shoot("meshedit-04-gizmo-move.jpeg");

// --- 8b: an OFF-handle drag in a spatial op is a look-around, not an edit ---------------------
const yawA = await yawDeg();
await dragFrom({ x: 300, y: 140 }, 1, 0, 90, 5);
const yawB = await yawDeg();
if (Math.abs(yawB - yawA) < 0.05) fail(`an off-handle drag did not look around (yaw ${yawA} → ${yawB})`);
const s8b = await state(cellUri, fid);
if (s8b.target.tE !== s8.target.tE || s8b.target.tN !== s8.target.tN) fail("an off-handle drag edited the building");
if (!(await evalJs(ARMED))) fail("an off-handle drag disarmed the building");
console.log(`off-handle drag: yaw ${yawA.toFixed(1)} → ${yawB.toFixed(1)} deg · building untouched · still armed`);

// --- 9: R → ROTATE; a drag on the Y ring yaws the building ------------------------------------
await key("KeyR", "r", 82);
await sleep(300);
g = await gz();
if (g.op !== "rotate" || !g.attached) fail(`R did not switch to ROTATE: ${JSON.stringify(g)}`);
await waitSeatedStill(cellUri, fid, "rotate");
const hY = await handleDir("Y");
// The ring's rotation direction is screen-horizontal (axis × eye); a diagonal drag has a
// horizontal component whichever side of the ring the extreme point landed on.
await dragFrom(hY.hp, 0.95, -0.3, 70, 7);
const s9 = await state(cellUri, fid);
if (Math.abs(s9.target.rotDeg) < 1) fail(`the ring drag did not commit a rotation: ${JSON.stringify(s9.target)}`);
if (s9.target.tE !== s8.target.tE) fail("ROTATE touched the translation");
rows = await evalJs(ROWS);
const row9 = rows[Object.keys(rows)[0]];
if (row9.rotDeg !== s9.target.rotDeg) fail(`row rotDeg ${row9.rotDeg} vs target ${s9.target.rotDeg}`);
await waitSettled(cellUri, fid, "rotate ease");
console.log(`ROTATE: ${s9.target.rotDeg.toFixed(1)}° (three sense) · row agrees`);
await sleep(300);
await shoot("meshedit-05-gizmo-rotate.jpeg");

// --- 10: S → SCALE; a drag on the X box scales the footprint inside the band -----------------
await key("KeyS", "s", 83);
await sleep(300);
g = await gz();
if (g.op !== "scale" || !g.attached) fail(`S did not switch to SCALE: ${JSON.stringify(g)}`);
await waitSeatedStill(cellUri, fid, "scale");
const hS = await handleDir("X");
await dragFrom(hS.hp, hS.ux, hS.uy, 60, 6);
const s10 = await state(cellUri, fid);
if (Math.abs(s10.target.sx - 1) < 0.05) fail(`the X box drag did not scale the footprint: ${JSON.stringify(s10.target)}`);
if (s10.target.sx < 0.5 || s10.target.sx > 3) fail(`sx ${s10.target.sx} escaped the per-edit band`);
if (s10.target.rotDeg !== s9.target.rotDeg) fail("SCALE touched the rotation");
await waitSettled(cellUri, fid, "scale ease");
console.log(`SCALE: sx ${s10.target.sx.toFixed(3)} · sz ${s10.target.sz.toFixed(3)} · band held`);
await sleep(300);
await shoot("meshedit-06-gizmo-scale.jpeg");

// --- 11: the chip's per-op ↺ reverts ROTATE alone --------------------------------------------
if (!(await evalJs("!!document.querySelector('.bec-revert[data-op=\"rotate\"]')"))) fail("no ↺ on the edited ROTATE row");
await evalJs("document.querySelector('.bec-revert[data-op=\"rotate\"]').click(), true");
await sleep(250);
const s11 = await state(cellUri, fid);
if (s11.target.rotDeg !== 0) fail(`revert ROTATE left rotDeg ${s11.target.rotDeg}`);
if (s11.target.tE !== s10.target.tE || s11.target.sx !== s10.target.sx) fail("revert ROTATE touched another op");
rows = await evalJs(ROWS);
const row11 = rows[Object.keys(rows)[0]];
if (!row11 || "rotDeg" in row11 || Math.abs(row11.tE - s11.target.tE) > 1e-6) fail(`row after the per-op revert: ${JSON.stringify(row11)}`);
if (await evalJs("!!document.querySelector('.bec-revert[data-op=\"rotate\"]')")) fail("↺ still shown on the reverted ROTATE row");
console.log("per-op revert: rotation 0 · move + scale intact · row rewritten without rotDeg");

// --- 12: Escape MID-DRAG cancels ------------------------------------------------------------------
await key("KeyG", "g", 71);
await sleep(300);
g = await gz();
if (g.op !== "move") fail("G did not switch to MOVE");
await waitSeatedStill(cellUri, fid, "cancel");
const hX2 = await handleDir("X");
await hover(hX2.hp.x, hX2.hp.y);
await sleep(60);
await mouse("mousePressed", hX2.hp.x, hX2.hp.y, { clickCount: 1 });
await sleep(40);
for (let i = 1; i <= 4; i++) {
  await mouse("mouseMoved", hX2.hp.x + hX2.ux * 12 * i, hX2.hp.y + hX2.uy * 12 * i);
  await sleep(30);
}
g = await gz();
if (!g.dragging || !g.live) fail("no live drag to cancel");
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(120);
g = await gz();
if (g.dragging || g.live) fail(`Escape did not cancel the drag: ${JSON.stringify(g)}`);
await mouse("mouseReleased", hX2.hp.x + hX2.ux * 48, hX2.hp.y + hX2.uy * 48, { clickCount: 1 });
await sleep(150);
const s12 = await state(cellUri, fid);
for (const k of Object.keys(s11.target)) if (s12.target[k] !== s11.target[k]) fail(`a cancelled drag changed ${k}: ${s11.target[k]} → ${s12.target[k]}`);
if (!(await evalJs(ARMED))) fail("Escape mid-drag disarmed instead of cancelling");
if (!(await evalJs("window.__globe.fpv().active"))) fail("Escape mid-drag exited FPV");
console.log("Escape mid-drag: cancelled · target unchanged · still armed · FPV intact");

// --- 13: RESET ALL → identity, row gone, fast path, still armed ------------------------------
if (!(await evalJs("!!document.querySelector('.bec-reset')"))) fail("RESET ALL absent on an edited building");
await evalJs("document.querySelector('.bec-reset').click(), true");
await sleep(250);
rows = await evalJs(ROWS);
if (Object.keys(rows).length !== 0) fail(`RESET ALL left a row: ${JSON.stringify(rows)}`);
await waitSettled(cellUri, fid, "reset-all ease");
await sleep(200);
seats = await evalJs(SEATS);
if (seats.spatial !== 0 || seats.overridden !== 0) fail(`after RESET ALL: spatial ${seats.spatial} overridden ${seats.overridden}`);
if (!(await evalJs(ARMED))) fail("RESET ALL disarmed");
g = await gz();
if (!g.attached || g.op !== "move") fail(`the gizmo must stay on the building after RESET ALL: ${JSON.stringify(g)}`);
console.log("RESET ALL: identity · row gone · fast path · still armed with the gizmo");

// --- 14: menu → DONE disarms; FPV intact; gizmo detached ----------------------------------------
await evalJs(
  `(() => { const c = document.querySelector('canvas'); c.dispatchEvent(new MouseEvent('contextmenu', { clientX: ${lastArmPx.x}, clientY: ${lastArmPx.y}, bubbles: true, cancelable: true })); return true; })()`,
);
await sleep(150);
if (!(await evalJs("!!document.querySelector('.bldg-menu__item[data-act=\"done\"]')"))) fail("the menu has no DONE item");
await evalJs("document.querySelector('.bldg-menu__item[data-act=\"done\"]').click(), true");
await sleep(250);
if (await evalJs(ARMED)) fail("DONE did not disarm");
g = await gz();
if (g.attached || g.op !== "extrude") fail(`gizmo not released on disarm: ${JSON.stringify(g)}`);
if ((await evalJs(`${BS}.op`)) !== "extrude") fail("the store's op ask did not reset to EXTRUDE on disarm");
if (!(await evalJs("window.__globe.fpv().active"))) fail("DONE exited FPV");
console.log("DONE: disarmed · gizmo detached · op ask back to EXTRUDE · FPV intact");

console.log(
  "PASS: arm+cellUri · seam edit (exact target, v2 row, re-queued sample, settled ease, spatial 1) · rails (60 m / 25 m, row agrees) · RESET (row gone, fast path) · reload re-apply · legacy k→sy" +
    " · MS2: menu→MOVE · X-arrow drag commits (camera pinned) · off-handle look · R ring yaw · S box scale (band) · per-op ↺ · Esc cancels · RESET ALL · DONE",
);
ws.close();
await finishVerify(0);
