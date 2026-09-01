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
const armOne = async (label) => {
  const GRID = [
    [800, 470], [640, 470], [960, 470], [800, 560], [520, 520],
    [1080, 520], [800, 380], [400, 560], [1200, 560], [800, 640],
  ];
  for (const [x, y] of GRID) {
    await dblclick(x, y);
    await sleep(250);
    const armed = await evalJs(ARMED);
    if (armed) return armed;
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

console.log(
  "PASS: arm+cellUri · seam edit (exact target, v2 row, re-queued sample, settled ease, spatial 1) · rails (60 m / 25 m, row agrees) · RESET (row gone, fast path) · reload re-apply · legacy k→sy",
);
ws.close();
await finishVerify(0);
