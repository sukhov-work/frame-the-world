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
//   3. rails (MS5b 2026-09-02l): the seam is the COMMIT path and clamps onto the LOOSE sanity
//      rail only — a 90 m move (past the old 60 m absolute rail) and sy 12 (past the old 10×
//      cap) land exactly; 50 km is shortened to TRANSLATE_MAX_M 5 km keeping direction, the
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
//   8c. MS5b: the MOVE rail is PER EDIT about the committed position — from 70 m out a real
//      X-arrow drag carries the building further (|t| past the old 60 m rail; one drag ≤ 100 m)
//  10. S → SCALE; a drag on the X box scales the footprint inside the 0.1×–10× per-edit band
//  14b. MS5b §11.4: after the session an ORBIT drag moves the focus as much as the baseline drag
//      taken before any session (±25 %); no gizmo helper is left in the scene (a parked drag
//      plane used to catch GlobeControls' pivot raycast); a positive control proves the probe
//      CAN see a helper that is in the scene. Legs 7 + 14 open the menu with a REAL right-button
//      press + release (§11.3: the menu used to close on the release).
//  11. the chip's per-op ↺ reverts ROTATE alone (the move + scale survive)
//  12. Escape MID-DRAG cancels: target unchanged, drag ended, still armed
//  13. RESET ALL → identity, row gone, fast path, still armed
//  14. menu → DONE disarms; FPV intact; gizmo detached
//   MESH SUITE MS3 (world-shared edits — D2 activation, 2026-09-02; against the LIVE
//   BuildingOverrides collection, so every row this harness writes is removed in `finally`;
//   a member session is minted node-side — the verify-places-member recipe — and installed as
//   the `wixSession` cookie; needs TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD / WIX_CLIENT_ID in
//   .env.local):
//  15. a row seeded on the SERVER (as the member) applies for an ANONYMOUS visitor with NO
//      local row: the world fetch lands (`__bldgSyncStore.world === "ready"`, shared ≥ 1), the
//      building carries the seeded rotation + height, its tint level is SHARED (1), the hover
//      note over it says "EDITED · shared", the pill is absent (nothing pending)
//  16. LOCAL PENDING WINS: a seam edit of the shared building applies as MINE (tint 2, dirty 1,
//      the row carries the OSM id, the pill says SIGN IN TO SYNC 1 while anonymous); a RESET of
//      it leaves a TOMBSTONE (identity applied, tint 0, still pending) that masks the world's
//      row across a reload
//  17. SYNC as the member: the pill's SYNC pushes the tombstone (the world row is REMOVED —
//      server GET agrees; local tombstone gone; shared 0; dirty 0); a fresh edit + SYNC lands
//      the upsert (server GET: heightScale + osmId; the local row is stamped synced)
//  18. anonymous again: a dirty local edit masks the world's row (local wins) and the pill
//      offers SIGN IN TO SYNC; then the harness removes its rows and proves the world is clean
// Screenshots in verify-shots/ (git-ignored).
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createClient, OAuthStrategy } from "@wix/sdk";
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
/** The collection is the PRODUCTION world: other members' synced rows apply at boot (5 seen on
 *  2026-09-02l), so every world-level counter is RELATIVE to what boot found (the leg-17 rule,
 *  now everywhere). Wait for the world fetch first so the baseline is complete. */
const waitWorld = async (label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const w = await evalJs("window.__bldgSyncStore ? window.__bldgSyncStore.getState().world : null").catch(() => null);
    if (w === "ready") return;
    if (w === "error") fail(`${label}: the world fetch failed`);
    await sleep(250);
  }
  fail(`${label}: the world fetch never settled`);
};
const worldBaseline = async (label) => {
  await waitWorld(label);
  const s = await evalJs(SEATS);
  const w = { spatial: s.spatial, overridden: s.overridden };
  console.log(`${label}: world as found — spatial ${w.spatial} · overridden ${w.overridden} (the relative baseline)`);
  return w;
};

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
const W0 = await worldBaseline("boot");

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
const VARIANT = keys[0].split("|")[0]; // the resolved bake variant (the MS3 legs seed the world under it)
const s1 = await waitSettled(cellUri, fid, "spatial ease");
let seats = await evalJs(SEATS);
if (seats.spatial !== W0.spatial + 1) fail(`spatial should be ${W0.spatial + 1} after the edit, got ${seats.spatial}`);
if (seats.overridden < W0.overridden + 1) fail(`overridden should count the edited building (${W0.overridden} + 1), got ${seats.overridden}`);
const mirror = await evalJs(ARMED);
if (!mirror || !near(mirror.liveHeightM, mirror.originalHeightM * 1.4, 0.05)) fail(`armed mirror height not in step with the seam edit: ${JSON.stringify(mirror)}`);
console.log(`settled: applied ${JSON.stringify(s1.applied)} · spatial ${seats.spatial} · overridden ${seats.overridden}`);
await sleep(600);
await shoot("meshedit-01-spatial-applied.jpeg");

// --- 3: rails (MS5b: the seam commits onto the LOOSE sanity rail; post-clamp read-back — engine
//     target AND row agree). The per-edit band is the gizmo's (leg 8c). ---------------------------
const r2 = await setXf(cellUri, fid, { sy: 1, sx: 1, sz: 1, rotDeg: 0, tE: 90, tN: 0, tU: 99 });
const t90 = r2.state.target;
if (t90.tE !== 90 || t90.tN !== 0) fail(`a 90 m move (past the old 60 m absolute rail) must land exactly: ${JSON.stringify(t90)}`);
if (t90.tU !== 25) fail(`lift rail: tU = ${t90.tU}, wanted 25`);
const r2b = await setXf(cellUri, fid, { sy: 12, sx: 1, sz: 1, rotDeg: 0, tE: 30_000, tN: 40_000, tU: 0 });
const tt = r2b.state.target;
if (!near(Math.hypot(tt.tE, tt.tN), 5000, 1e-6)) fail(`sanity translate rail: |t| = ${Math.hypot(tt.tE, tt.tN)}, wanted 5000`);
if (!near(tt.tE / tt.tN, 0.75, 1e-9)) fail(`sanity rail changed the direction: ${tt.tE}/${tt.tN}`);
if (tt.sy !== 12) fail(`sy 12 (past the old absolute 10× cap) must land exactly: ${tt.sy}`);
rows = await evalJs(ROWS);
const row2 = rows[Object.keys(rows)[0]];
if (!near(row2.tE, tt.tE) || !near(row2.tN, tt.tN) || row2.sy !== 12 || "tU" in row2) fail(`stored row disagrees with the clamped target: ${JSON.stringify(row2)}`);
await waitSettled(cellUri, fid, "rails ease", 15_000);
console.log(`rails: 90 m exact · sanity |t| 5000 m (${tt.tE.toFixed(1)}, ${tt.tN.toFixed(1)}) · sy 12 · lift 25 m · row agrees`);
await sleep(400);
await shoot("meshedit-02-rails.jpeg");

// --- 4: RESET through the seam → row gone, run back on the fast path ---------------------------
await setXf(cellUri, fid, { sy: 1, sx: 1, sz: 1, rotDeg: 0, tE: 0, tN: 0, tU: 0 });
rows = await evalJs(ROWS);
if (Object.keys(rows).length !== 0) fail(`RESET left a row behind: ${JSON.stringify(rows)}`);
await waitSettled(cellUri, fid, "reset ease");
await sleep(200);
seats = await evalJs(SEATS);
if (seats.spatial !== W0.spatial) fail(`after RESET the run must leave the absolute path (spatial=${seats.spatial}, world ${W0.spatial})`);
if (seats.overridden !== W0.overridden) fail(`after RESET only the world's rows stay overridden (overridden=${seats.overridden}, world ${W0.overridden})`);
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
  if (re && re.spatial >= W0.spatial + 1) break;
  await sleep(1000);
}
if (!(re && re.spatial >= W0.spatial + 1)) fail(`reload: the spatial row never re-applied (${JSON.stringify(re)}, world ${W0.spatial})`);
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
  if (lg && lg.overridden >= W0.overridden + 1) break;
  await sleep(1000);
}
if (!(lg && lg.overridden >= W0.overridden + 1)) fail(`legacy: the {k} row never re-applied (${JSON.stringify(lg)}, world ${W0.overridden})`);
const s4 = await state(cellUri, fid);
if (!s4 || s4.target.sy !== 2) fail(`legacy: target.sy = ${s4?.target.sy}, wanted 2 (read from k)`);
if (lg.spatial !== W0.spatial) fail(`legacy: a height-only row must stay on the fast path (spatial=${lg.spatial}, world ${W0.spatial})`);
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
/** MS5b §11.3: a REAL right-button click — press, then release with no travel (the gesture whose
 *  release used to close the menu). Returns whether the menu was already open at the press (macOS
 *  Chrome fires `contextmenu` on the press; Windows on the release). */
const rightClick = async (x, y) => {
  await hover(x, y);
  await sleep(40);
  await mouse("mousePressed", x, y, { button: "right", buttons: 2, clickCount: 1 });
  const atPress = await evalJs(`${BS}.menu !== null`);
  await sleep(60);
  await mouse("mouseReleased", x, y, { button: "right", buttons: 0, clickCount: 1 });
  return atPress;
};
// ── MS5b §11.4 — the ORBIT drag probe (an in-page FPV exit, never a reload: a reload would discard
//    a parked helper and hide the bug) ──────────────────────────────────────────────────────────
const CS = "window.__cameraStore.getState()";
const distM = (a, b) => Math.hypot((b.lat - a.lat) * 111_320, (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
/** The camera's own ground point + ECEF position. NOT the store's `focusLatDeg` mirror: while a
 *  temp pin is set (the `#f=` boot keeps one) that mirror stays pinned on the pin (probed 2026-09-02l
 *  — the camera moved 110 m, the mirror 0). */
const focus = () => evalJs(`(() => { const cs = ${CS}; const p = window.__globe.camera.position; return { lat: cs.camGeo?.latDeg ?? 0, lon: cs.camGeo?.lonDeg ?? 0, pos: [p.x, p.y, p.z] }; })()`);
const waitUntil = async (label, expr, timeoutMs = 15_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(expr).catch(() => false)) return;
    await sleep(200);
  }
  fail(`${label}: ${expr} never became true`);
};
/** What GlobeControls' OWN raycaster finds first under a client pixel (its drag pivot), and whether
 *  ANY hit along that ray belongs to a TransformControls helper (a parked drag plane / picker). */
const raycastAt = (x, y) =>
  evalJs(
    `(() => { const g = window.__globe, c = g.controls; const r = document.querySelector('canvas').getBoundingClientRect();` +
      ` const ndc = { x: ((${x} - r.left) / r.width) * 2 - 1, y: -((${y} - r.top) / r.height) * 2 + 1 };` +
      ` const isGizmo = (o) => { for (let p = o; p; p = p.parent) if (p.isTransformControlsRoot || p.isTransformControlsPlane) return true; return false; };` +
      ` c.raycaster.setFromCamera(ndc, g.camera); const first = c.raycaster.intersectObject(c.scene, true)[0] ?? null;` +
      ` const all = new c.raycaster.constructor(); all.setFromCamera(ndc, g.camera); const hits = all.intersectObject(c.scene, true);` +
      ` return { first: first ? { type: first.object.type, distance: first.distance, gizmo: isGizmo(first.object) } : null, hits: hits.length, gizmoHits: hits.filter((h) => isGizmo(h.object)).length }; })()`,
  );
const ORBIT_PX = { x: 800, y: 640 };
/** POSITIVE CONTROL for the probe: re-add a gizmo's helper root and cast a ray from the camera AT
 *  the parked drag plane's centre — the hit list must then contain a gizmo object. Removes the root
 *  again. `which` = "bldgGizmo" | "modelGizmo". */
const controlSeesHelper = (which) =>
  evalJs(
    `(() => { const g = window.__globe, c = g.controls; const root = g.${which}().helperRoot(); c.scene.add(root); root.updateMatrixWorld(true);` +
      ` const plane = (() => { let p = null; root.traverse((o) => { if (o.isTransformControlsPlane) p = o; }); return p; })();` +
      ` const isGizmo = (o) => { for (let q = o; q; q = q.parent) if (q.isTransformControlsRoot || q.isTransformControlsPlane) return true; return false; };` +
      ` const V = c.pivotPoint.constructor; const target = plane ? plane.getWorldPosition(new V()) : null;` +
      ` const rc = new c.raycaster.constructor(); let hits = [];` +
      ` if (target) { rc.set(g.camera.position.clone(), target.clone().sub(g.camera.position).normalize()); hits = rc.intersectObject(c.scene, true); }` +
      ` c.scene.remove(root);` +
      ` return { planeFound: !!plane, planeDistM: target ? target.distanceTo(g.camera.position) : null, hits: hits.length, gizmoHits: hits.filter((h) => isGizmo(h.object)).length, first: hits[0] ? { type: hits[0].object.type, distance: hits[0].distance, gizmo: isGizmo(hits[0].object) } : null }; })()`,
  );
const orbitDragProbe = async (label) => {
  await evalJs(`${CS}.setTempFpv(false), true`);
  await waitUntil(`${label}: FPV exit`, "!window.__globe.fpv().active && window.__globe.fpv().controlsEnabled", 20_000);
  await waitUntil(`${label}: fly-out settles`, "!window.__globe.flight.active()", 30_000);
  // The fly-out lands wherever the FPV look left it — re-seat on ONE fixed orbit pose so the
  // baseline and the post-edit drag are comparable (the s5-night fly idiom).
  await evalJs(`${CS}.requestFly({ latDeg: 48.4647, lonDeg: 35.0462, altM: 700 }), true`);
  await sleep(3500);
  await waitUntil(`${label}: fly-in settles`, "!window.__globe.flight.active()", 30_000);
  await evalJs("window.__cameraStore.setState({ targetTiltDeg: 40, targetHeadingDeg: 25 }), true");
  await sleep(3000);
  await sleep(2500); // terrain streams at the orbit pose — the pivot must land on real ground
  let ray = null;
  for (let i = 0; i < 20 && !(ray && ray.first); i++) {
    ray = await raycastAt(ORBIT_PX.x, ORBIT_PX.y);
    if (!ray.first) await sleep(500);
  }
  if (!ray || !ray.first) fail(`${label}: nothing under the press pixel (${JSON.stringify(ray)})`);
  const before = await focus();
  await hover(ORBIT_PX.x, ORBIT_PX.y);
  await sleep(60);
  await mouse("mousePressed", ORBIT_PX.x, ORBIT_PX.y, { buttons: 1, clickCount: 1 });
  await sleep(40);
  for (let i = 1; i <= 8; i++) {
    await mouse("mouseMoved", ORBIT_PX.x + (220 * i) / 8, ORBIT_PX.y, { buttons: 1 });
    await sleep(40);
  }
  await mouse("mouseReleased", ORBIT_PX.x + 220, ORBIT_PX.y, { buttons: 0, clickCount: 1 });
  await sleep(900);
  const after = await focus();
  const camM = Math.hypot(after.pos[0] - before.pos[0], after.pos[1] - before.pos[1], after.pos[2] - before.pos[2]);
  return { ray, dM: Math.max(distM(before, after), camM), camM, before, after };
};
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
// --- 6b (MS5b §11.4 BASELINE): an orbit drag BEFORE any gizmo session — leg 14b's comparator --
const base = await orbitDragProbe("baseline");
if (base.dM < 30) fail(`baseline orbit drag moved the focus only ${base.dM.toFixed(1)} m (${JSON.stringify(base)})`);
if (base.ray.first.gizmo || base.ray.gizmoHits !== 0) fail(`a gizmo object is raycastable before any session: ${JSON.stringify(base.ray)}`);
console.log(`orbit baseline: 220 px drag → focus moved ${base.dM.toFixed(1)} m · first hit ${base.ray.first.type} @ ${base.ray.first.distance.toFixed(0)} m · ${base.ray.hits} hits`);
// Back into FPV for the gizmo legs (a fresh boot — the in-page exit retired the temp FPV).
await send("Page.navigate", { url: "about:blank" });
await sleep(400);
await send("Page.navigate", { url: FPV_URL });
await waitBoot("gizmo-2");
await dismissWelcome();
await sleep(4000);
const W1 = await worldBaseline("gizmo-2");
const armedG = await armOne("gizmo-arm");
if (armedG.op !== "extrude") fail(`a fresh arm must start at EXTRUDE (U8 default), got ${armedG.op}`);
const gU = await gz();
if (gU.attached) fail("the gizmo is attached in the EXTRUDE op");

// --- 7: a REAL right-click → context menu (it must SURVIVE the release — MS5b §11.3) → MOVE ----
const press7 = await rightClick(lastArmPx.x, lastArmPx.y);
await sleep(300);
const menu7 = await evalJs(`${BS}.menu`);
if (!menu7 || typeof menu7.screenX !== "number") fail(`the context menu is not open 300 ms after the right button was RELEASED (open at press: ${press7}) — the §11.3 bug`);
if (!(await evalJs(ARMED))) fail("the right-click's release disarmed the building (§11.3)");
// A LEFT tap while the menu is open only closes the menu — the building stays armed.
await mouse("mousePressed", 300, 140, { clickCount: 1 });
await mouse("mouseReleased", 300, 140, { clickCount: 1 });
await sleep(200);
if (await evalJs(`${BS}.menu !== null`)) fail("a left tap did not close the context menu");
if (!(await evalJs(ARMED))) fail("the left tap that closed the menu also disarmed (the dismiss path is broken)");
console.log(`right-click: menu open at press ${press7} · still open 300 ms after the release · a left tap closes it, building stays armed`);
await rightClick(lastArmPx.x, lastArmPx.y);
await sleep(300);
if (!(await evalJs(`${BS}.menu !== null`))) fail("the second right-click did not re-open the menu");
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
if (seats.spatial !== W1.spatial + 1) fail(`after the move the run must be on the absolute path (spatial ${seats.spatial}, world ${W1.spatial})`);
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

// --- 8c: MS5b — the MOVE rail is PER EDIT about the committed position ------------------------
// Seat the building 70 m out along the eye's heading (it stays in view, smaller), past the old
// 60 m absolute rail; a real X-arrow drag must still carry it further, and one drag ≤ 100 m.
const hRad = (25 * Math.PI) / 180; // the #f= heading
const far = { ...s8b.target, tE: 70 * Math.sin(hRad), tN: 70 * Math.cos(hRad) };
await setXf(cellUri, fid, far);
await waitSettled(cellUri, fid, "70 m ease");
const base8c = await waitSeatedStill(cellUri, fid, "70 m seat");
const s8c0 = await state(cellUri, fid);
if (Math.hypot(s8c0.target.tE, s8c0.target.tN) < 69.9) fail(`the 70 m seat did not land: ${JSON.stringify(s8c0.target)}`);
const hX8c = await handleDir("X");
await dragFrom(hX8c.hp, hX8c.ux, hX8c.uy, 72, 6);
const s8c = await state(cellUri, fid);
const d8c = Math.hypot(s8c.target.tE - s8c0.target.tE, s8c.target.tN - s8c0.target.tN);
if (d8c < 0.3) fail(`the drag from 70 m out did not commit a move: ${JSON.stringify(s8c.target)}`);
if (d8c > 100 + 1e-6) fail(`one drag moved ${d8c.toFixed(2)} m — past the 100 m per-edit rail`);
if (Math.hypot(s8c.target.tE, s8c.target.tN) <= 60) fail(`the old 60 m absolute rail still binds: ${JSON.stringify(s8c.target)}`);
rows = await evalJs(ROWS);
const row8c = rows[Object.keys(rows)[0]];
if (Math.abs((row8c.tE ?? 0) - s8c.target.tE) > 1e-6 || Math.abs((row8c.tN ?? 0) - s8c.target.tN) > 1e-6) fail(`row disagrees after the far drag: ${JSON.stringify(row8c)}`);
await waitSettled(cellUri, fid, "8c ease");
console.log(`per-edit move: from 70 m out (base ${base8c.toFixed(2)}) a drag added ${d8c.toFixed(2)} m → |t| ${Math.hypot(s8c.target.tE, s8c.target.tN).toFixed(2)} m (past the old 60 m rail) · one drag ≤ 100 m · row agrees`);
// Back to where leg 8 left it, so the remaining legs see the same building on the same screen.
await setXf(cellUri, fid, s8b.target);
await waitSettled(cellUri, fid, "8c restore");

// --- 9: R → ROTATE; a drag on the Y ring yaws the building ------------------------------------
await key("KeyR", "r", 82);
await sleep(300);
g = await gz();
if (g.op !== "rotate" || !g.attached) fail(`R did not switch to ROTATE: ${JSON.stringify(g)}`);
// §4a (MESH SUITE MS8, 2026-09-05): a BUILDING stays yaw-only — the Y ring alone, no X / Z (the
// pitch / roll rings are the user-model gizmo's, `tilt: true`), no screen-space E ring.
const ringsB = await evalJs(`({ X: ${GZ}.handlePx("X") !== null, Y: ${GZ}.handlePx("Y") !== null, Z: ${GZ}.handlePx("Z") !== null, E: ${GZ}.handlePx("E") !== null })`);
if (ringsB.X || !ringsB.Y || ringsB.Z || ringsB.E) fail(`the building's ROTATE rings are ${JSON.stringify(ringsB)} (expected the Y ring alone — §4a yaw-only)`);
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
console.log(`ROTATE: ${s9.target.rotDeg.toFixed(1)}° (three sense) · row agrees · rings Y only (no X / Z / E — §4a)`);
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
if (s10.target.sx < 0.1 || s10.target.sx > 10) fail(`sx ${s10.target.sx} escaped the 0.1×–10× per-edit band`);
if (s10.target.rotDeg !== s9.target.rotDeg) fail("SCALE touched the rotation");
await waitSettled(cellUri, fid, "scale ease");
const chipScale = await evalJs("document.querySelector('.bec-row[data-op=\"scale\"] .bec-v')?.textContent ?? ''");
if (!/^\d+(\.\d+)? × \d+(\.\d+)? m \(\d\.\d\d × \d\.\d\d\)$/.test(chipScale)) fail(`MS5b: the SCALE row must lead with the footprint in metres: "${chipScale}"`);
const chipScaleWas = await evalJs("document.querySelector('.bec-row[data-op=\"scale\"] .bec-was')?.textContent ?? ''");
if (!/^was \d+(\.\d+)? × \d+(\.\d+)? m$/.test(chipScaleWas)) fail(`MS5b: the SCALE row's original must be the mapped footprint in metres: "${chipScaleWas}"`);
const labelScale = await evalJs("document.querySelector('.bldg-edit-label')?.textContent ?? ''");
if (!/⤢ \d+(\.\d+)? × \d+(\.\d+)? m ·/.test(labelScale)) fail(`MS5b: the pinned label's SCALE line carries no metres: "${labelScale}"`);
console.log(`SCALE: sx ${s10.target.sx.toFixed(3)} · sz ${s10.target.sz.toFixed(3)} · inside 0.1×–10× · chip "${chipScale}" / "${chipScaleWas}"`);
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
if (seats.spatial !== W1.spatial || seats.overridden !== W1.overridden) fail(`after RESET ALL: spatial ${seats.spatial} overridden ${seats.overridden} (world ${JSON.stringify(W1)})`);
if (!(await evalJs(ARMED))) fail("RESET ALL disarmed");
g = await gz();
if (!g.attached || g.op !== "move") fail(`the gizmo must stay on the building after RESET ALL: ${JSON.stringify(g)}`);
console.log("RESET ALL: identity · row gone · fast path · still armed with the gizmo");

// --- 14: a real right-click → menu → DONE disarms; FPV intact; gizmo detached ------------------
await rightClick(lastArmPx.x, lastArmPx.y);
await sleep(300);
if (!(await evalJs(`${BS}.menu !== null`))) fail("leg 14: the right-click's menu did not survive the release");
if (!(await evalJs("!!document.querySelector('.bldg-menu__item[data-act=\"done\"]')"))) fail("the menu has no DONE item");
await evalJs("document.querySelector('.bldg-menu__item[data-act=\"done\"]').click(), true");
await sleep(250);
if (await evalJs(ARMED)) fail("DONE did not disarm");
g = await gz();
if (g.attached || g.op !== "extrude") fail(`gizmo not released on disarm: ${JSON.stringify(g)}`);
if ((await evalJs(`${BS}.op`)) !== "extrude") fail("the store's op ask did not reset to EXTRUDE on disarm");
if (!(await evalJs("window.__globe.fpv().active"))) fail("DONE exited FPV");
console.log("DONE: disarmed · gizmo detached · op ask back to EXTRUDE · FPV intact");

// --- 14b: MS5b §11.4 — after the edit session an ORBIT drag must work exactly as before --------
const gzOut = await evalJs("(({ bldgGizmo, modelGizmo }) => ({ b: bldgGizmo().inScene, m: modelGizmo().inScene }))(window.__globe)");
if (gzOut.b || gzOut.m) fail(`a detached gizmo helper is still in the scene: ${JSON.stringify(gzOut)}`);
const post = await orbitDragProbe("post-edit");
if (post.ray.first.gizmo || post.ray.gizmoHits !== 0) fail(`the parked gizmo helper answers the orbit raycast (the §11.4 bug): ${JSON.stringify(post.ray)}`);
console.log(`orbit after edits: 220 px drag → ${post.dM.toFixed(1)} m (camera ${post.camM.toFixed(1)} m; baseline ${base.dM.toFixed(1)} m) · first hit ${post.ray.first.type} @ ${post.ray.first.distance.toFixed(0)} m · ${post.ray.hits} hits, ${post.ray.gizmoHits} gizmo`);
// POSITIVE CONTROL: re-add the building gizmo's helper and aim a ray at its parked plane — the
// probe must SEE it (proves the detector, not the fix).
const ctl = await controlSeesHelper("bldgGizmo");
if (!ctl.planeFound || ctl.gizmoHits === 0) fail(`positive control: the probe cannot see a helper that IS in the scene (${JSON.stringify(ctl)})`);
if (post.dM < 0.75 * base.dM || post.dM > 1.25 * base.dM) fail(`orbit drag after the edit session moved ${post.dM.toFixed(1)} m vs ${base.dM.toFixed(1)} m before (outside ±25 %)`);
console.log(`orbit after edits: within ±25 % of the baseline · helpers out of the scene · control: plane ${ctl.planeDistM.toFixed(0)} m away, ${ctl.gizmoHits} gizmo hit(s) of ${ctl.hits}`);

// ═══ MESH SUITE MS3 — world-shared edits, against the LIVE collection ═══════════════════════
// Member session (the verify-places-member recipe): OAuthStrategy login → session token →
// prompt=none authorize (code harvested from the redirect) → member tokens → wixSession cookie.
const SITE = process.env.FTW_SITE_URL || "https://www.plux.today";
const envLocal = readFileSync(".env.local", "utf-8");
const envVal = (k) => envLocal.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
const TEST_MEMBER = { email: envVal("TEST_MEMBER_EMAIL"), password: envVal("TEST_MEMBER_PASSWORD") };
const clientId = envVal("WIX_CLIENT_ID");
if (!TEST_MEMBER.email || !TEST_MEMBER.password || !clientId)
  fail("MS3 legs need TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD / WIX_CLIENT_ID in .env.local (audit B2)");
const sdk = createClient({ auth: OAuthStrategy({ clientId }) });
const login = await sdk.auth.login({ email: TEST_MEMBER.email, password: TEST_MEMBER.password });
if (login.loginState !== "SUCCESS") fail(`member login state ${login.loginState}`);
const REDIRECT = "http://localhost:4321/api/auth/callback";
const oauthData = sdk.auth.generateOAuthData(REDIRECT, "http://localhost:4321/");
const authorizeUrl =
  `${SITE}/_api/oauth2/authorize?clientId=${clientId}&responseType=code&state=${oauthData.state}` +
  `&redirectUri=${encodeURIComponent(REDIRECT)}&scope=offline_access&responseMode=query` +
  `&codeChallenge=${oauthData.codeChallenge}&codeChallengeMethod=S256&prompt=none&sessionToken=${login.data.sessionToken}`;
const authRes = await fetch(authorizeUrl, { redirect: "manual" });
const loc = authRes.headers.get("location");
if (!loc) fail(`authorize gave no redirect (${authRes.status})`);
const memberTokens = await sdk.auth.getMemberTokens(
  new URL(loc).searchParams.get("code"),
  new URL(loc).searchParams.get("state"),
  oauthData,
);
const cookieVal = encodeURIComponent(JSON.stringify({ clientId, tokens: memberTokens }));
console.log(`MS3: member tokens minted (${memberTokens.refreshToken.role})`);

const SS = "window.__bldgSyncStore.getState()";
const setCookie = () => evalJs(`document.cookie = "wixSession=${cookieVal}; path=/; max-age=10800", true`);
const clearCookie = () => evalJs(`document.cookie = "wixSession=; path=/; max-age=0", true`);
/** The API through the PAGE (it carries the cookie): `{ status, body }`. */
const pageApi = (path, init = null) =>
  evalJs(
    `fetch(${JSON.stringify(path)}, ${init ? JSON.stringify(init) : "undefined"}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`,
  );
const worldRow = async (cell, fid) => {
  const r = await pageApi(`/api/building-overrides?variant=${encodeURIComponent(VARIANT)}`);
  if (r.status !== 200) fail(`world GET ${r.status}: ${JSON.stringify(r.body)}`);
  return (r.body.overrides ?? []).find((o) => o.cell === cell && o.featureId === fid) ?? null;
};
/** Wix Data reads lag writes (~1 s, measured 2026-09-02f): poll the world GET until `pred(row)`
 *  holds (row may be null), else fail with the last thing seen. */
const worldRowEventually = async (cell, fid, pred, label, timeoutMs = 15_000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await worldRow(cell, fid);
    if (pred(last)) return last;
    await sleep(700);
  }
  fail(`${label}: world GET never showed the expected row (last ${JSON.stringify(last)})`);
};
const reload = async (label, opts = {}) => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await send("Page.navigate", { url: FPV_URL });
  await waitBoot(label);
  await dismissWelcome();
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const w = await evalJs(`${SS}.world`).catch(() => null);
    if (w === "ready" || w === "error") {
      if (w === "error") fail(`${label}: the world fetch failed (world === "error")`);
      break;
    }
    await sleep(250);
  }
  if (opts.member) {
    const t1 = Date.now();
    while ((await evalJs("window.__memberStore.getState().phase")) !== "member" && Date.now() - t1 < 15_000) await sleep(400);
    if ((await evalJs("window.__memberStore.getState().phase")) !== "member") fail(`${label}: no member session in the page`);
  }
};
const waitFor = async (label, expr, timeoutMs = 15_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(expr).catch(() => false)) return;
    await sleep(200);
  }
  fail(`${label}: ${expr} never became true`);
};
// The fixture building = the one the gizmo legs armed (its screen point is `lastArmPx`).
const F = { cell: armedG.cellUri, fid: armedG.featureId };
const sF = await state(F.cell, F.fid);
if (!sF || typeof sF.osm !== "string" || !/^[nwr]\d+$/.test(sF.osm)) fail(`fixture building has no OSM id on the seam: ${JSON.stringify(sF)}`);
const facts = { cx: Math.round(sF.cx * 2) / 2, cz: Math.round(sF.cz * 2) / 2, vc: sF.vc, bakedHeightM: Math.round(sF.bakedHeightM * 10) / 10 };
const removeKey = { variant: VARIANT, cell: F.cell, featureId: F.fid, osmId: sF.osm };
let cleanupProblem = null;
const syncViaPill = async (label) => {
  if (!(await evalJs("!!document.querySelector('.bldg-sync-pill .bec-sync[data-sync=\"sync\"]')")))
    fail(`${label}: the pill offers no SYNC button (${await evalJs("document.querySelector('.bldg-sync-pill')?.textContent ?? 'no pill'")})`);
  // Clear the previous outcome FIRST: the click is consumed on the next frame, so a wait that
  // starts now would read the last push's result (run 4, 2026-09-02f) — the outcome to await is
  // the one written after this click.
  await evalJs(`${SS}._set({ result: null }), true`);
  await evalJs("document.querySelector('.bldg-sync-pill .bec-sync').click(), true");
  await waitFor(`${label}: push outcome`, `${SS}.result !== null && ${SS}.syncing === false`, 20_000);
  const r = await evalJs(`${SS}.result`);
  if (r.kind !== "synced") fail(`${label}: push outcome ${JSON.stringify(r)}`);
  return r;
};

try {
  // --- 15: a SERVER row applies for an anonymous visitor with no local row (SHARED tint) --------
  await setCookie();
  const seed = await pageApi("/api/building-overrides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upserts: [{ ...removeKey, heightScale: 1.5, rotDeg: 40, ...facts }] }),
  });
  if (seed.status !== 200 || (seed.body.inserted ?? 0) + (seed.body.updated ?? 0) < 1) fail(`seed POST ${seed.status}: ${JSON.stringify(seed.body)}`);
  const seeded = await worldRowEventually(F.cell, F.fid, (o) => !!o && o.rotDeg === 40 && o.heightScale === 1.5 && o.osmId === sF.osm, "seed visible");
  if ("memberId" in (seeded ?? {})) fail("the public GET leaked memberId (C6)");
  console.log(`seeded ${F.cell}|${F.fid} (osm ${sF.osm}): rotDeg 40 · heightScale 1.5 · updatedAt ${seeded.updatedAt ?? "—"}`);
  await clearCookie();
  await evalJs(`localStorage.removeItem(${JSON.stringify(KEY)}), true`);
  await reload("world");
  const ss15 = await evalJs(`(({ world, shared, complete, dirty }) => ({ world, shared, complete, dirty }))(${SS})`);
  if (ss15.world !== "ready" || ss15.shared < 1 || ss15.dirty !== 0 || ss15.complete !== true) fail(`sync store after boot: ${JSON.stringify(ss15)}`);
  await waitFor("shared row applied", `(() => { const s = window.__globe.enrichedState(${JSON.stringify(F.cell)}, ${F.fid}); return !!s && s.target.rotDeg === 40 && s.target.sy === 1.5 && s.tint === 1; })()`, 45_000);
  const seats15 = await evalJs(SEATS);
  if (seats15.shared < 1 || seats15.overridden < 1) fail(`enrichedSeats after the world fetch: shared ${seats15.shared} overridden ${seats15.overridden}`);
  if (Object.keys(await evalJs(ROWS)).length !== 0) fail("a shared row must not land in the LOCAL map");
  if (await evalJs("!!document.querySelector('.bldg-sync-pill')")) fail("the pill shows with nothing pending");
  await waitSettled(F.cell, F.fid, "shared ease", 10_000);
  await hover(lastArmPx.x, lastArmPx.y);
  await sleep(400);
  await hover(lastArmPx.x + 2, lastArmPx.y + 1);
  await sleep(400);
  const hovTxt = await evalJs("document.querySelector('.bldg-edit-label')?.textContent ?? ''");
  if (!/EDITED · shared/.test(hovTxt)) fail(`hover note over the shared building: "${hovTxt}"`);
  console.log(`world: ${ss15.shared} shared row(s) · applied rotDeg 40 / sy 1.5 · tint SHARED · hover "${hovTxt.trim()}" · no pill`);
  await sleep(300);
  await shoot("meshedit-07-shared-applied.jpeg");

  // --- 16: LOCAL PENDING WINS + a RESET becomes a TOMBSTONE that masks the world row ----------
  await setXf(F.cell, F.fid, { sy: 1, sx: 1, sz: 1, rotDeg: 10, tE: 0, tN: 0, tU: 0 });
  const s16 = await state(F.cell, F.fid);
  if (s16.target.rotDeg !== 10 || s16.tint !== 2) fail(`local edit of a shared building: ${JSON.stringify(s16)}`);
  let rows16 = await evalJs(ROWS);
  const k16 = Object.keys(rows16)[0];
  if (!k16 || rows16[k16].o !== sF.osm || rows16[k16].rotDeg !== 10 || "d" in rows16[k16]) fail(`local row after the edit: ${JSON.stringify(rows16)}`);
  if ((await evalJs(`${SS}.dirty`)) !== 1) fail("dirty should be 1 after a local edit");
  await sleep(300);
  const pill16 = await evalJs("document.querySelector('.bldg-sync-pill .bec-sync')?.textContent ?? ''");
  if (!/SIGN IN TO SYNC 1/.test(pill16)) fail(`anonymous pill copy: "${pill16}"`);
  await setXf(F.cell, F.fid, { sy: 1, sx: 1, sz: 1, rotDeg: 0, tE: 0, tN: 0, tU: 0 }); // RESET
  rows16 = await evalJs(ROWS);
  if (rows16[k16]?.d !== 1 || rows16[k16].o !== sF.osm) fail(`RESET of a shared building must leave a tombstone: ${JSON.stringify(rows16)}`);
  const s16b = await state(F.cell, F.fid);
  if (s16b.target.rotDeg !== 0 || s16b.target.sy !== 1 || s16b.tint !== 0) fail(`tombstone must apply identity: ${JSON.stringify(s16b)}`);
  if ((await evalJs(`${SS}.dirty`)) !== 1) fail("a tombstone is pending (dirty 1)");
  await reload("tombstone");
  await sleep(1500);
  const s16c = await state(F.cell, F.fid);
  if (!s16c || s16c.target.rotDeg !== 0 || s16c.target.sy !== 1) fail(`the tombstone did not mask the world row across a reload: ${JSON.stringify(s16c)}`);
  if ((await evalJs(`${SS}.shared`)) < 1) fail("the world row must still be held (masked, not deleted)");
  if ((await evalJs(ROWS))[k16]?.d !== 1) fail("the tombstone did not survive the reload");
  console.log("local wins: edit → tint MINE, dirty 1, pill SIGN IN · RESET → tombstone (identity, masks the world row across a reload)");

  // --- 17: SYNC as the member — the tombstone removes the world row; a fresh edit lands ---------
  await setCookie();
  await reload("member", { member: true });
  await sleep(600);
  const r17 = await syncViaPill("sync tombstone");
  if (r17.removed < 1) fail(`the tombstone's removal did not land: ${JSON.stringify(r17)}`);
  if (Object.keys(await evalJs(ROWS)).length !== 0) fail("the landed tombstone must be gone locally");
  const ss17 = await evalJs(`(({ shared, dirty }) => ({ shared, dirty }))(${SS})`);
  // Relative to the world as found: the collection is the PRODUCTION world (2026-09-02i: a
  // member's real synced edit sat beside the seed and an absolute `shared === 0` read it as a
  // regression) — the removal takes exactly the seeded row, everything else stays.
  if (ss17.dirty !== 0 || ss17.shared !== ss15.shared - 1) fail(`after the removal: ${JSON.stringify(ss17)} (world held ${ss15.shared} before)`);
  await worldRowEventually(F.cell, F.fid, (o) => o === null, "row gone after the removal synced");
  // The pill shows the outcome ("✓ SYNCED n") for SYNC_RESULT_MS, then — nothing pending — it goes.
  const done17 = await evalJs("document.querySelector('.bldg-sync-pill .bec-sync')?.dataset.sync ?? ''");
  if (done17 !== "done") fail(`the pill must show the push outcome first (data-sync "${done17}")`);
  await waitFor("pill gone after the outcome expired", "!document.querySelector('.bldg-sync-pill')", 8000);
  await setXf(F.cell, F.fid, { sy: 1.3, sx: 1, sz: 1, rotDeg: 0, tE: 0, tN: 0, tU: 0 });
  await sleep(300);
  const r17b = await syncViaPill("sync edit");
  if (r17b.upserted < 1) fail(`the edit did not land: ${JSON.stringify(r17b)}`);
  const w17 = await worldRowEventually(F.cell, F.fid, (o) => !!o && o.heightScale === 1.3 && o.osmId === sF.osm && !("rotDeg" in o), "row visible after the push");
  const rows17 = await evalJs(ROWS);
  const l17 = rows17[Object.keys(rows17)[0]];
  if (!l17 || !(l17.s >= l17.t) || l17.sy !== 1.3) fail(`the local row was not stamped synced: ${JSON.stringify(l17)}`);
  if ((await evalJs(`${SS}.dirty`)) !== 0) fail("dirty should be 0 after a landed push");
  const s17 = await state(F.cell, F.fid);
  if (s17.tint !== 2 || s17.target.sy !== 1.3) fail(`after the push the building is still MINE: ${JSON.stringify(s17)}`);
  console.log(`member SYNC: tombstone → world row removed (removed ${r17.removed}) · edit → upserted ${r17b.upserted} (heightScale 1.3, osmId ${w17.osmId}) · local stamped synced`);
  await sleep(300);
  await shoot("meshedit-08-synced.jpeg");

  // --- 18: anonymous again — a dirty local edit masks the world's row; SIGN IN offered ---------
  await clearCookie();
  await evalJs(`localStorage.removeItem(${JSON.stringify(KEY)}), true`); // a fresh browser sees the world's row…
  await reload("anon");
  await waitFor("world row for the fresh browser", `(() => { const s = window.__globe.enrichedState(${JSON.stringify(F.cell)}, ${F.fid}); return !!s && s.target.sy === 1.3 && s.tint === 1; })()`, 45_000);
  await setXf(F.cell, F.fid, { sy: 1.6, sx: 1, sz: 1, rotDeg: 0, tE: 0, tN: 0, tU: 0 }); // …and edits over it
  const s18 = await state(F.cell, F.fid);
  if (s18.target.sy !== 1.6 || s18.tint !== 2) fail(`local edit over a world row: ${JSON.stringify(s18)}`);
  await sleep(300);
  const pill18 = await evalJs("document.querySelector('.bldg-sync-pill .bec-sync')?.textContent ?? ''");
  if (!/SIGN IN TO SYNC 1/.test(pill18)) fail(`anonymous pill copy: "${pill18}"`);
  console.log(`anonymous: world sy 1.3 (tint SHARED) → local edit sy 1.6 wins (tint MINE) · pill "${pill18.trim()}"`);
} finally {
  // The collection is the production world: remove what this harness wrote, whatever happened.
  // Never throw in here (it would mask the leg that failed) — record, and fail after the block.
  // A remove issued within ~1 s of the row's insert counts 0 (reads lag writes) → retry until
  // the world GET shows it gone.
  try {
    await setCookie();
    let left = "unknown";
    for (let attempt = 1; attempt <= 6; attempt++) {
      const rm = await pageApi("/api/building-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removes: [removeKey] }),
      });
      await sleep(1200);
      left = await worldRow(F.cell, F.fid);
      console.log(`cleanup ${attempt}: removes → ${rm.status} ${JSON.stringify(rm.body)} · world row now ${left === null ? "gone" : JSON.stringify(left)}`);
      if (left === null) break;
    }
    if (left !== null) cleanupProblem = `cleanup left a row on the world: ${JSON.stringify(left)}`;
  } catch (e) {
    cleanupProblem = `cleanup threw: ${e?.message ?? e}`;
  }
  await evalJs(`localStorage.removeItem(${JSON.stringify(KEY)}), true`).catch(() => {});
  await clearCookie().catch(() => {});
}
if (cleanupProblem) fail(cleanupProblem);

console.log(
  "PASS: arm+cellUri · seam edit (exact target, v2 row, re-queued sample, settled ease, spatial 1) · rails (90 m exact, sanity 5 km / sy 12 / lift 25, row agrees) · RESET (row gone, fast path) · reload re-apply · legacy k→sy" +
    " · MS2: real right-click menu survives the release → MOVE · X-arrow drag commits (camera pinned) · off-handle look · per-edit move from 70 m out · R ring yaw · S box scale (0.1×–10×, metres on the row) · per-op ↺ · Esc cancels · RESET ALL · DONE · orbit drag after the session = baseline (helpers out of the scene, control seen)" +
    " · MS3: world row applies (SHARED tint, hover note, no pill) · local wins + tombstone masks · member SYNC removes + upserts (server agrees, osmId keyed) · anonymous sign-in gate · world left clean",
);
ws.close();
await finishVerify(0);
