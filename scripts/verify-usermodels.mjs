// Browser verification for MESH SUITE MS5 — D3 placement (2026-09-02): a member's uploaded model
// stands in the WORLD (the public cover read → the scene), arms in FPV through the MS2 gizmo with
// the model's own rig, commits ROTATE / SCALE / MOVE as PATCHes that survive a reload, stays
// un-armable for a visitor (and owner-free on the public read), yields to the MDL chip, and
// re-places by a click on the globe. Usage: wix dev on :4321 + CDP Chrome
// (scripts/verify-chrome.mjs --headless --port 9333 --profile <dir>):
//   node scripts/verify-usermodels.mjs [cdpPort] [shotsDir]      (Node ≥22: global WebSocket)
//
// Legs, at the Dnipro FPV pose (owner memo 2026-09-02c: Dnipro first, always):
//   1. member (the verify-places-member recipe) drops a 12-triangle 3 × 5 × 3 m box GLB with an
//      UPLOAD HERE seed 14 m ahead of the eye → STORED READY; the row joins MINE at once
//   2. the public world read (/api/world-models?cells=<gh5>) lists it within the read lag — no
//      ownerMemberId, no fileId — and the scene makes it RESIDENT with a REAL terrain seat
//   3. a REAL right-click (press + release) arms the model — the menu SURVIVES the release (MS5b
//      §11.3), a left tap closes it and keeps the model armed; screenshot
//   4. R → ROTATE: a drag on the Y ring commits a yaw → PATCH lands (the own list agrees)
//   5. S → SCALE: a drag on the X box scales UNIFORMLY inside the 0.1×–10× per-edit band; the
//      SCALE row leads with the size in metres (MS5b §11.1)
//   6. G → MOVE: a drag on the X arrow moves the placement (new lat/lon, never a stored offset)
//   6a. MESH SUITE MS7 (2026-09-03): the Y arrow is the LIFT — a drag up saves a lift (row `tU` +
//      the anchor's Y + the MOVE row); drags far DOWN stop at the FLOOR (a quarter of the scaled
//      model stays above the seat — never out of sight); MOVE's ↺ lands it; one more lift stays
//      for the reload leg
//   6b. MS5b §11.4: an in-page FPV exit, then an ORBIT drag moves the focus; no gizmo helper is
//      left in the scene; a positive control proves the probe can see one that is
//   7. reload (member): the seats + the placement re-apply from the world read
//   8. anonymous reload: the model is resident, MINE is empty, a right-click does NOT arm it
//   9. the MDL gate (store → engine): off releases the model, on brings it back
//  10. orbit click-to-place: beginPlacing + a ground click PATCHes a new placement
//  MESH SUITE MS6 (2026-09-02m) — management + world edit:
//  11. MY PINS · MODELS lists the model (our row: title, size × scale + tris + the lift, no badge,
//      ✎ / GOTO / RESET / HIDE / ✕ — MS7 added GOTO + RESET)
//  11b. MS7: RESET on the row → yaw 0 / scale 1 / lift 0 through ONE PATCH; the own list, the world
//      read and the scene agree; the spot stays; RESET goes dark
//  12. ✎ RENAME inline (Enter) → the own list, the world read and the scene's row agree (no reload)
//  13. HIDE → the own list says hidden, the world read and the scene drop it, the foot note shows;
//      SHOW → back in the world read and the scene
//  14. GOTO (MS7; the row click shares its handler) STANDS BESIDE the model: FPV, the eye south of
//      it looking north, ~3 heights back
//  15. FOREIGN EDIT: a row seeded (DEV-only /api/dev-seed) as ANOTHER member's model, reusing the
//      stored GLB — not in MINE, hover note without "yours", a real right-click ARMS it with the
//      SHARED badge, ROTATE PATCHes (LWW), the world read reflects it, the owner's list (a DEV read)
//      says EDITED by another member; the seed row is removed (row only) and leaves the world read
//  16. ORBIT hover (label + pointer cursor) and click → stands beside it in FPV
//  17. ✕ → SURE? in the list DELETES the model (row + media) — the list, the own API and the world
//      read all drop it
//  18. cleanup (finally): the seed row (if any) and, unless leg 17 did it, DELETE — the world left clean
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, OAuthStrategy } from "@wix/sdk";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots";
const EYE = { lat: 48.4647, lon: 35.0462, heading: 25 };
const FPV_URL = `http://localhost:4321/#f=${EYE.lat},${EYE.lon},1.7,${EYE.heading},8,60&t=1787133600000`;
const ORBIT_URL = `http://localhost:4321/#p=${EYE.lat},${EYE.lon},700,${EYE.heading},40&t=1787133600000`;
// The seed: 14 m ahead of the eye along the heading (dN = 14 cos h, dE = 14 sin h).
const AHEAD_M = 14;
const SEED = {
  lat: EYE.lat + (AHEAD_M * Math.cos((EYE.heading * Math.PI) / 180)) / 111_320,
  lon: EYE.lon + (AHEAD_M * Math.sin((EYE.heading * Math.PI) / 180)) / (111_320 * Math.cos((EYE.lat * Math.PI) / 180)),
};

// ── fixture: a minimal glTF-2.0 binary box (positions + indices; the loader computes normals) ──
function boxGlb(w, h, d) {
  const hw = w / 2;
  const hd = d / 2;
  const P = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-hw, h, -hd], [hw, h, -hd], [hw, h, hd], [-hw, h, hd]];
  const I = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const pos = new Float32Array(P.flat());
  const idx = new Uint16Array(I);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const json = {
    asset: { version: "2.0", generator: "plux-verify-usermodels" },
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-hw, 0, -hd], max: [hw, h, hd] },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  while (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.from(" ")]);
  let binBuf = bin;
  while (binBuf.length % 4) binBuf = Buffer.concat([binBuf, Buffer.alloc(1)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binBuf.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
}
const FIX = mkdtempSync(join(tmpdir(), "plux-usermodels-"));
const BOX = join(FIX, "plux-ms5-box.glb");
writeFileSync(BOX, boxGlb(3, 5, 3));
console.log(`fixture ${BOX}: ${readFileSync(BOX).byteLength} B`);

// ── CDP plumbing (the verify-modelupload idiom) ────────────────────────────────────────────────
const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
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
// MS6: the page's error console — a shader that fails to compile (the chained model materials)
// logs through three's console.error and never throws; the run must not pass over it.
const consoleErrors = [];
const noteConsole = (text) => {
  if (typeof text !== "string") return;
  if (/THREE\.WebGLProgram|Shader Error|THREE\.WebGLShader|Program Info Log/i.test(text)) consoleErrors.push(text.slice(0, 400));
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled" && (msg.params?.type === "error" || msg.params?.type === "warning"))
    noteConsole((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
  if (msg.method === "Log.entryAdded") noteConsole(msg.params?.entry?.text);
  if (msg.method === "Runtime.exceptionThrown") noteConsole(msg.params?.exceptionDetails?.exception?.description ?? msg.params?.exceptionDetails?.text);
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
const fail = (msg) => {
  throw new VerifyFailure(msg);
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

const MS = "window.__modelUploadStore.getState()";
const US = "window.__userModelsStore.getState()";
const ES = "window.__modelEditStore.getState()";
const UM = "window.__globe.userModels()";
const GZ = "window.__globe.modelGizmo()";
const modelState = () => evalJs(`(() => { const s = ${MS}; return { phase: s.phase, error: s.error ?? null, errorCode: s.errorCode ?? null, title: s.title, stats: s.stats ?? null, placement: s.placement ?? null, stored: s.stored ?? null }; })()`);
const waitModelPhase = async (label, phases, timeoutMs = 90_000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await modelState();
    if (phases.includes(last.phase)) return last;
    if (last.phase === "error" && !phases.includes("error")) fail(`${label}: pipeline refused — ${last.errorCode}: ${last.error}`);
    await sleep(200);
  }
  fail(`${label}: model phase never reached ${phases.join("|")} (last ${JSON.stringify(last)})`);
};
const openOverlay = async (label) => {
  await evalJs("window.__uploadStore.getState().openPanel(), true");
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    if (await evalJs("!!document.querySelector('.uf input[type=file]')")) return;
    await sleep(120);
  }
  fail(`${label}: the upload overlay never mounted its file input`);
};
const dropFiles = async (label, paths) => {
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".uf input[type=file]" });
  if (!nodeId) fail(`${label}: no file input in the overlay`);
  await send("DOM.setFileInputFiles", { files: paths, nodeId });
};
const dismissWelcome = () =>
  evalJs("(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true");
const waitBoot = async (label) => {
  const t0 = Date.now();
  while (true) {
    const ok = await evalJs(
      "!!(window.__globe && window.__globe.camera && window.__globe.userModels && window.__uploadStore && window.__modelUploadStore && window.__userModelsStore && window.__modelEditStore && window.__memberStore)",
    ).catch(() => false);
    if (ok) return;
    if (Date.now() - t0 > 90_000) fail(`${label}: globe + the MS5 seams never booted`);
    await sleep(300);
  }
};
const waitFpv = async (label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < 40_000) {
    if (await evalJs("!!window.__globe.fpv && window.__globe.fpv().active").catch(() => false)) return;
    await sleep(250);
  }
  fail(`${label}: FPV never became active`);
};
const pageApi = (path, init = {}) =>
  evalJs(`fetch(${JSON.stringify(path)}, ${JSON.stringify(init)}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
const postJson = (path, body, method = "POST") =>
  pageApi(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const mouse = (type, x, y, opts = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseMoved" ? 1 : undefined, ...opts });
const hover = (x, y) => mouse("mouseMoved", x, y, { buttons: 0 });
const key = async (code, k, vk) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
};
const dragFrom = async (from, ux, uy, px, steps = 6) => {
  await hover(from.x, from.y);
  await sleep(60);
  await mouse("mousePressed", from.x, from.y, { clickCount: 1 });
  await sleep(40);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", from.x + (ux * px * i) / steps, from.y + (uy * px * i) / steps);
    await sleep(30);
  }
  const end = { x: from.x + ux * px, y: from.y + uy * px };
  await mouse("mouseReleased", end.x, end.y, { clickCount: 1 });
  await sleep(150);
  return end;
};
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
/** MS5b §11.3: a REAL right-button click — press, then release with no travel. Returns whether
 *  the model menu was already open at the press (macOS Chrome fires `contextmenu` on the press). */
const rightClick = async (x, y) => {
  await hover(x, y);
  await sleep(40);
  await mouse("mousePressed", x, y, { button: "right", buttons: 2, clickCount: 1 });
  const atPress = await evalJs(`${ES}.menu !== null`);
  await sleep(60);
  await mouse("mouseReleased", x, y, { button: "right", buttons: 0, clickCount: 1 });
  return atPress;
};
// MS5b §11.4 — the orbit-drag probe (the verify-meshedit idiom; in-page FPV exit, never a reload).
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
const modelInfo = (id) => evalJs(`(${UM}.models.find((m) => m.id === ${JSON.stringify(id)}) ?? null)`);
/** The model becomes RESIDENT (its GLB fetched) — the wixstatic round trip takes a few seconds. */
const waitResident = async (id, label, timeoutMs = 45_000) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await modelInfo(id);
    if (last && last.state === "ready") return last;
    await sleep(300);
  }
  fail(`${label}: the model never became resident (last ${JSON.stringify(last)}; counts ${JSON.stringify(await evalJs(`(() => { const u = ${UM}; return { world: u.world, resident: u.resident, loading: u.loading, failed: u.failed, skipped: u.skipped, visible: u.visible }; })()`))})`);
};
/** Press handles only once the seat is REAL and still (the meshedit lesson: a terrain refine
 *  moves the handles from under the press). */
const waitSeatedStill = async (id, label, timeoutMs = 30_000) => {
  const t0 = Date.now();
  let still = 0;
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const m = await modelInfo(id);
    if (m && m.state === "ready" && m.seatReal && m.appliedM !== null) {
      if (last !== null && Math.abs(m.appliedM - last) < 0.005) still++;
      else still = 0;
      last = m.appliedM;
      if (still >= 4) return last;
    }
    await sleep(150);
  }
  fail(`${label}: the model never seated on real terrain and settled (last ${last})`);
};
const armed = () => evalJs(`${ES}.armed`);
const waitSaved = async (label, timeoutMs = 20_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const a = await armed();
    if (a && !a.saving) {
      if (a.saveError) fail(`${label}: the PATCH failed — ${a.saveError}`);
      return a;
    }
    await sleep(150);
  }
  fail(`${label}: the PATCH never settled`);
};
const ownRowEventually = async (id, pred, label, timeoutMs = 20_000) => {
  const t0 = Date.now();
  let row = null;
  while (Date.now() - t0 < timeoutMs) {
    const res = await pageApi("/api/models");
    row = res.body?.models?.find((m) => m.id === id) ?? null;
    if (row && pred(row)) return row;
    await sleep(700);
  }
  fail(`${label}: the own list never agreed (last ${JSON.stringify(row)})`);
};
const worldRowEventually = async (cell, id, pred, label, timeoutMs = 20_000) => {
  const t0 = Date.now();
  let row = null;
  while (Date.now() - t0 < timeoutMs) {
    const res = await pageApi(`/api/world-models?cells=${cell}`);
    if (res.status !== 200) fail(`${label}: world read ${res.status} ${JSON.stringify(res.body)}`);
    row = res.body?.models?.find((m) => m.id === id) ?? null;
    if (pred(row)) return row;
    await sleep(700);
  }
  fail(`${label}: the world read never agreed (last ${JSON.stringify(row)})`);
};
// The p5 cell of the seed, computed page-side by the app's own encoder (no second implementation).
const gh5Of = (lat, lon) =>
  evalJs(`(async () => { const m = await import("/src/lib/geo/geohash.ts"); return m.encodeGeohash(${lat}, ${lon}, 5); })()`);

// ── the member session (the verify-places-member recipe) ─────────────────────────────────────
const SITE = process.env.FTW_SITE_URL || "https://www.plux.today";
const envLocal = readFileSync(".env.local", "utf-8");
const envVal = (k) => envLocal.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
const TEST_MEMBER = { email: envVal("TEST_MEMBER_EMAIL"), password: envVal("TEST_MEMBER_PASSWORD") };
const clientId = envVal("WIX_CLIENT_ID");
if (!TEST_MEMBER.email || !TEST_MEMBER.password || !clientId) fail("TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD / WIX_CLIENT_ID missing in .env.local");
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
if (!loc) fail(`authorize did not redirect (${authRes.status})`);
const memberTokens = await sdk.auth.getMemberTokens(new URL(loc).searchParams.get("code"), new URL(loc).searchParams.get("state"), oauthData);
const cookieVal = encodeURIComponent(JSON.stringify({ clientId, tokens: memberTokens }));
const setCookie = () => evalJs(`document.cookie = "wixSession=${cookieVal}; path=/; max-age=10800", true`);
const clearCookie = () => evalJs(`document.cookie = "wixSession=; path=/; max-age=0", true`);
const loadUrl = async (url, label, { member }) => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url });
  await waitBoot(label);
  await dismissWelcome();
  await sleep(500);
  if (member) {
    await evalJs("window.__memberStore.getState().refresh(), true");
    const t0 = Date.now();
    while (Date.now() - t0 < 15_000) {
      if ((await evalJs("window.__memberStore.getState().phase")) === "member") return;
      await sleep(200);
    }
    fail(`${label}: the member session never resolved`);
  }
};

// ── MS6 helpers: the MY PINS · MODELS tab ─────────────────────────────────────────────────────
const openModelsTab = async (label) => {
  await evalJs("(document.querySelector('.mp-toggle') || {click(){}}).click(), true");
  await waitUntil(`${label}: the MY PINS panel`, "!!document.querySelector('.mp-panel')", 10_000);
  await evalJs("document.querySelector('.mp-tab[data-tab=\"models\"]').click(), true");
  await waitUntil(`${label}: the MODELS tab`, "!!document.querySelector('.mp-list[data-tab=\"models\"]') || !!document.querySelector('.mp-panel .mp-note')", 20_000);
};
const rowSel = (id) => `.mp-row[data-model-id="${id}"]`;
const rowText = (id, sel) => evalJs(`document.querySelector(${JSON.stringify(`${rowSel(id)} ${sel}`)})?.textContent ?? null`);
const clickIn = (id, sel) => evalJs(`(document.querySelector(${JSON.stringify(`${rowSel(id)} ${sel}`)}) || {click(){}}).click(), true`);
const ownListLacks = async (id, label, timeoutMs = 15_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const res = await pageApi("/api/models");
    if (res.status === 200 && !res.body?.models?.some((m) => m.id === id)) return;
    await sleep(700);
  }
  fail(`${label}: the own list still carries ${id}`);
};
const standDistance = (sizeH, scale) => Math.max(6, Math.min(120, 3 * sizeH * scale));
/** MS7: `liftFloorM` in numbers — a quarter of the scaled height (never under 0.5 m) stays above the seat. */
const liftFloor = (scaledH) => {
  const keep = Math.max(0.25 * scaledH, 0.5);
  const d = Math.max(0, Math.min(50, scaledH - keep));
  return d > 0 ? -d : 0;
};

mkdirSync(SHOTS, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("DOM.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
// Clean slate: the view prefs (the MDL chip default is ON) — a reused profile keeps them.
await send("Page.navigate", { url: "http://localhost:4321/" });
await sleep(1500);
await evalJs('localStorage.removeItem("ftw:view-prefs:v1"), true').catch(() => {});
await setCookie();
await loadUrl(FPV_URL, "boot", { member: true });
await waitFpv("boot");

let modelId = null;
let foreignId = null; // MS6 leg 15: the DEV-seeded row owned by ANOTHER member (row only)
let deletedViaUi = false; // MS6 leg 17 removed the own row through the list
let cleanupProblem = null;
const FOREIGN_OWNER = "yevhens@wix.com"; // the demo-pins owner: signs in with Google, no password (dev-seed.ts)
try {
  // --- 1: upload the box with the seed ------------------------------------------------------------
  await openOverlay("leg 1");
  await evalJs(`window.__uploadStore.getState().uploadAt(${SEED.lat}, ${SEED.lon}), true`);
  await dropFiles("leg 1", [BOX]);
  const rev = await waitModelPhase("leg 1", ["review"]);
  if (rev.stats?.tris !== 12) fail(`leg 1: the box read ${rev.stats?.tris} triangles, not 12`);
  if (!rev.placement || !near(rev.placement.latDeg, SEED.lat, 1e-9)) fail(`leg 1: the seed was not consumed: ${JSON.stringify(rev.placement)}`);
  await evalJs(`${MS}.setTitle("MS5 verify box"), true`);
  await evalJs(`${MS}.upload(), true`);
  const stored = await waitModelPhase("leg 1", ["stored"], 120_000);
  modelId = stored.stored.modelId;
  if (stored.stored.readiness !== "READY") fail(`leg 1: readiness ${stored.stored.readiness}`);
  const mineNow = await evalJs(`${US}.mine.map((m) => m.id)`);
  if (!mineNow.includes(modelId)) fail(`leg 1: the stored row did not join MINE at once (${JSON.stringify(mineNow)})`);
  const placeBtn = await evalJs("document.querySelector('.uf-btn[data-act=\"place\"]')?.textContent ?? null");
  if (!placeBtn || !placeBtn.includes("MOVE IT")) fail(`leg 1: the STORED card's placement button reads ${JSON.stringify(placeBtn)}`);
  await evalJs(`${MS}.clear(), window.__uploadStore.getState().closePanel(), true`);
  console.log(`leg 1: stored ${modelId} at the seed (${SEED.lat.toFixed(6)}, ${SEED.lon.toFixed(6)}) · MINE ${mineNow.length}`);

  // --- 2: the public world read + residency ---------------------------------------------------
  const cell = await gh5Of(SEED.lat, SEED.lon);
  const pub = await worldRowEventually(cell, modelId, (r) => !!r, "leg 2");
  for (const k of ["ownerMemberId", "fileId", "thumbnailFileId"]) if (k in pub) fail(`leg 2: the public row leaks ${k}`);
  if (!near(pub.lat, SEED.lat, 1e-9) || pub.rotDeg !== 0 || pub.scale !== 1 || pub.tris !== 12) fail(`leg 2: public row ${JSON.stringify(pub)}`);
  const worldIds = await evalJs(`${US}.world.map((m) => m.id)`);
  if (!worldIds.includes(modelId)) fail(`leg 2: the store's world lacks the row (${JSON.stringify(worldIds)})`);
  const res2 = await waitResident(modelId, "leg 2");
  await waitSeatedStill(modelId, "leg 2");
  const seat = await modelInfo(modelId);
  // The seat is whatever the RENDERED terrain answers (a fresh headless profile may still hold a
  // coarse tile — T76's shape); the contract is a REAL, clamped sample, not a surveyed height.
  if (!seat.seatReal || !(seat.appliedM >= 0 && seat.appliedM <= 9000)) fail(`leg 2: the seat is not a real terrain sample: ${JSON.stringify(seat)}`);
  if (Math.abs(seat.heightM - 5) > 0.01 || Math.abs(seat.sizeM - 3) > 0.01) fail(`leg 2: ground-fit bounds ${seat.heightM} × ${seat.sizeM}`);
  const shader2 = await evalJs(`${UM}.shader`);
  if (!shader2 || shader2.chained !== true) fail(`leg 2: the model materials are not chained onto the haze/dissolve patch: ${JSON.stringify(shader2)}`);
  console.log(`leg 2: public row clean · resident (${res2.tris} tris) · seated at ${seat.appliedM.toFixed(2)} m (real) · cover cell ${cell} · shader chained (haze ${shader2.haze}, alpha ${shader2.alpha})`);

  // --- 3: right-click arms the model --------------------------------------------------------------
  // The upload's review step retired the temp pin (the GPS-less photo idiom) — and the `#f=` boot
  // FPV rides a temp pin, so FPV ended with it. Re-enter FPV for the edit legs; MINE resolves
  // again with the member session.
  await loadUrl(FPV_URL, "leg 3", { member: true });
  await waitFpv("leg 3");
  await waitResident(modelId, "leg 3");
  await waitSeatedStill(modelId, "leg 3");
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 15_000) {
      if (await evalJs(`${US}.minePhase === "ready" && ${US}.mine.some((m) => m.id === ${JSON.stringify(modelId)})`)) break;
      await sleep(200);
    }
    if (!(await evalJs(`${US}.mine.some((m) => m.id === ${JSON.stringify(modelId)})`))) fail("leg 3: MINE never listed the model after the reload");
  }
  const px = await evalJs(`${GZ}.modelPx(${JSON.stringify(modelId)})`);
  if (!px) fail("leg 3: the model is not on screen");
  await hover(px.x, px.y);
  await sleep(200);
  const hoverNote = await evalJs("document.querySelector('.bldg-edit-label')?.textContent ?? ''");
  if (!hoverNote.includes("MODEL · MS5 verify box")) {
    const diag = await evalJs(`(() => { const g = ${GZ}; return { px: ${JSON.stringify(px)}, hoverId: g.hoverId, pickAt: g.pickAt(${px.x}, ${px.y}), fpv: window.__globe.fpv().active, modelsVisible: window.__cameraStore.getState().modelsVisible, counts: (() => { const u = ${UM}; return { resident: u.resident, visible: u.visible }; })(), label: document.querySelector('.bldg-edit-label')?.innerHTML ?? null }; })()`);
    fail(`leg 3: no hover note over the model (${JSON.stringify(hoverNote)}) — ${JSON.stringify(diag)}`);
  }
  const press3 = await rightClick(px.x, px.y);
  await sleep(300);
  let a = await armed();
  if (!a || a.id !== modelId || !a.mine) fail(`leg 3: the right-click did not arm the model (or its release disarmed it — §11.3): ${JSON.stringify(a)}`);
  if (!(await evalJs(`${ES}.menu !== null`))) fail(`leg 3: the model menu is not open 300 ms after the right button was RELEASED (open at press: ${press3}) — the §11.3 bug`);
  if (!(await evalJs("!!document.querySelector('.bldg-edit-chip[data-kind=\"model\"]') && !!document.querySelector('.bldg-menu[data-kind=\"model\"]')")))
    fail("leg 3: the model chip / menu are not in the DOM");
  if (await evalJs("!!window.__bldgEditStore.getState().armed")) fail("leg 3: a building is armed alongside the model");
  await shoot("usermodels-01-armed.jpeg");
  // A LEFT tap while the menu is open only closes the menu — the model stays armed.
  await mouse("mousePressed", 300, 140, { clickCount: 1 });
  await mouse("mouseReleased", 300, 140, { clickCount: 1 });
  await sleep(200);
  if (await evalJs(`${ES}.menu !== null`)) fail("leg 3: a left tap did not close the model menu");
  if (!(await armed())) fail("leg 3: the left tap that closed the menu also disarmed the model");
  const head3 = await evalJs("document.querySelector('.bldg-edit-chip[data-kind=\"model\"] .bec-row[data-op=\"scale\"] .bec-v')?.textContent ?? ''");
  if (!/^3\.00 × 3\.00 × 5\.00 m \(1\.00×\)$/.test(head3)) fail(`leg 3: the SCALE row must print the box's size in metres (MS5b §11.1): "${head3}"`);
  console.log(`leg 3: armed ${a.title} (op ${a.op}, size ${a.sizeM} m, ${JSON.stringify(a.sizeM3)}) · menu open at press ${press3}, survived the release · left tap closed it · SCALE row "${head3}"`);

  // --- 4: R → ROTATE, a ring drag commits a yaw and PATCHes -----------------------------------------
  await key("KeyR", "r", 82);
  await sleep(300);
  let g = await evalJs(GZ);
  if (g.op !== "rotate" || !g.attached) fail(`leg 4: R did not switch to ROTATE: ${JSON.stringify({ op: g.op, attached: g.attached })}`);
  await waitSeatedStill(modelId, "leg 4");
  const hY = await handleDir("Y");
  await dragFrom(hY.hp, 0.95, -0.3, 70, 7);
  a = await waitSaved("leg 4");
  if (Math.abs(a.committed.rotDeg) < 1) fail(`leg 4: the ring drag did not commit a yaw: ${JSON.stringify(a.committed)}`);
  if (a.committed.scale !== 1) fail("leg 4: ROTATE touched the scale");
  const own4 = await ownRowEventually(modelId, (r) => Math.abs(r.rotDeg - a.committed.rotDeg) < 1e-6, "leg 4");
  await shoot("usermodels-02-rotated.jpeg");
  console.log(`leg 4: ROTATE ${a.committed.rotDeg.toFixed(1)}° (three sense) · own list rotDeg ${own4.rotDeg}`);

  // --- 5: S → SCALE, uniform inside the band ------------------------------------------------------
  await key("KeyS", "s", 83);
  await sleep(300);
  g = await evalJs(GZ);
  if (g.op !== "scale" || !g.attached) fail("leg 5: S did not switch to SCALE");
  await waitSeatedStill(modelId, "leg 5");
  const hX = await handleDir("X");
  await dragFrom(hX.hp, hX.ux, hX.uy, 60, 6);
  a = await waitSaved("leg 5");
  if (Math.abs(a.committed.scale - 1) < 0.05) fail(`leg 5: the X box drag did not scale: ${JSON.stringify(a.committed)}`);
  if (a.committed.scale < 0.1 || a.committed.scale > 10) fail(`leg 5: scale ${a.committed.scale} escaped the 0.1×–10× per-edit band`);
  const m5 = await modelInfo(modelId);
  if (Math.abs(m5.bodyScale - a.committed.scale) > 1e-6) fail(`leg 5: the rig scale ${m5.bodyScale} ≠ committed ${a.committed.scale} (not uniform?)`);
  await ownRowEventually(modelId, (r) => Math.abs(r.scale - a.committed.scale) < 1e-6, "leg 5");
  const row5 = await evalJs("document.querySelector('.bldg-edit-chip[data-kind=\"model\"] .bec-row[data-op=\"scale\"] .bec-v')?.textContent ?? ''");
  const w5 = 3 * a.committed.scale;
  if (!row5.startsWith(`${w5 >= 10 ? w5.toFixed(1) : w5.toFixed(2)} × `) || !row5.endsWith(`m (${a.committed.scale.toFixed(2)}×)`)) fail(`leg 5: the SCALE row does not show the scaled size in metres: "${row5}"`);
  console.log(`leg 5: SCALE ${a.committed.scale.toFixed(3)}× uniform · inside 0.1×–10× · own list agrees · row "${row5}"`);

  // --- 6: G → MOVE, an arrow drag moves the PLACEMENT ---------------------------------------------
  await key("KeyG", "g", 71);
  await sleep(300);
  g = await evalJs(GZ);
  if (g.op !== "move" || !g.attached) fail("leg 6: G did not switch to MOVE");
  if (!(await evalJs(`${GZ}.handlePx("Y") !== null`))) fail("leg 6: the lift arrow is missing on the model (MS7: the Y arrow is the lift)");
  await waitSeatedStill(modelId, "leg 6");
  const hM = await handleDir("X");
  await dragFrom(hM.hp, hM.ux, hM.uy, 50, 6);
  a = await waitSaved("leg 6");
  const movedM = Math.hypot((a.lat - SEED.lat) * 111_320, (a.lon - SEED.lon) * 111_320 * Math.cos((SEED.lat * Math.PI) / 180));
  if (movedM < 0.5 || movedM > 250) fail(`leg 6: the placement moved ${movedM.toFixed(2)} m`);
  if (Math.abs(a.live.tE) > 1e-6 || Math.abs(a.live.tN) > 1e-6) fail(`leg 6: an offset survived the commit: ${JSON.stringify(a.live)}`);
  const m6 = await modelInfo(modelId);
  if (Math.hypot(...m6.anchor) > 1e-6) fail(`leg 6: the anchor did not return to zero: ${JSON.stringify(m6.anchor)}`);
  await ownRowEventually(modelId, (r) => near(r.lat, a.lat, 1e-9) && near(r.lon, a.lon, 1e-9), "leg 6");
  console.log(`leg 6: MOVE ${movedM.toFixed(2)} m → (${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}) · anchor zero · own list agrees`);

  // --- 6a: MS7 — the Y arrow is the LIFT: a real drag lifts it; the floor holds; the list resets ----
  // (a) A REAL gizmo Y-arrow drag proves the vertical gesture end to end: the drag moves the
  //     model's ANCHOR in metres and the live lift + the MOVE row follow it (a vertical translate
  //     has little screen gain at a street eye, so the drag is small — direction-agnostic — but it
  //     is a genuine pointer drag on the real handle). The grab searches along the projected axis
  //     because the thin picker's midpoint pixel can miss it.
  await waitSeatedStill(modelId, "leg 6a");
  const o6 = await evalJs(`${GZ}.originPx()`);
  const hp6 = await evalJs(`${GZ}.handlePx("Y")`);
  if (!o6 || !hp6) fail(`leg 6a: the Y (lift) arrow is not on screen (${JSON.stringify({ o6, hp6 })})`);
  const dyx = hp6.x - o6.x, dyy = hp6.y - o6.y, dyl = Math.hypot(dyx, dyy) || 1;
  const ux6 = dyx / dyl, uy6 = dyy / dyl;
  let start6 = null;
  for (const f of [0.5, 0.4, 0.6, 0.45, 0.55, 0.35, 0.65, 0.3, 0.7]) {
    const cand = { x: o6.x + dyx * f, y: o6.y + dyy * f };
    await hover(cand.x, cand.y);
    await sleep(30);
    await mouse("mousePressed", cand.x, cand.y, { clickCount: 1 });
    await sleep(40);
    if ((await evalJs(`${GZ}.dragging`)) && (await evalJs(`${GZ}.axis`)) === "Y") { start6 = cand; break; }
    await key("Escape", "Escape", 27); // cancel a non-Y grab cleanly (never commit a stray axis)
    await mouse("mouseReleased", cand.x, cand.y, { clickCount: 1 });
    await sleep(40);
  }
  if (!start6) fail(`leg 6a: could not grab the Y (lift) arrow (origin ${o6.x.toFixed(0)},${o6.y.toFixed(0)} → handle ${hp6.x.toFixed(0)},${hp6.y.toFixed(0)})`);
  for (let k = 1; k <= 10; k++) { await mouse("mouseMoved", start6.x + ux6 * 90 * k / 10, start6.y + uy6 * 90 * k / 10); await sleep(30); }
  const liveDrag = await evalJs(`${ES}.armed?.live?.liftM ?? null`);
  const anchorDrag = await evalJs(`(${UM}.models.find((m) => m.id === ${JSON.stringify(modelId)})?.anchor) ?? null`);
  const rowDrag = await evalJs("document.querySelector('.bldg-edit-chip[data-kind=\"model\"] .bec-row[data-op=\"move\"] .bec-v')?.textContent ?? ''");
  if (!(Math.abs(liveDrag ?? 0) > 0.02)) fail(`leg 6a: a real Y-arrow drag did not move the live lift (${liveDrag})`);
  if (!anchorDrag || !near(anchorDrag[1], liveDrag, 1e-6) || Math.hypot(anchorDrag[0], anchorDrag[2]) > 1e-6) fail(`leg 6a: the drag did not move the anchor's Y only: ${JSON.stringify(anchorDrag)} vs live ${liveDrag}`);
  if (!/\u2191[+\-]/.test(rowDrag)) fail(`leg 6a: the MOVE row does not show the dragged lift: "${rowDrag}"`);
  await key("Escape", "Escape", 27); // cancel the probe drag — the row goes back to the ground
  await mouse("mouseReleased", start6.x + ux6 * 90, start6.y + uy6 * 90, { clickCount: 1 });
  await sleep(200);
  await waitUntil("leg 6a: the cancelled drag returns to the ground", `Math.abs((${UM}.models.find((m) => m.id === ${JSON.stringify(modelId)})?.anchor?.[1]) ?? 1) < 0.05`, 10_000);

  // (b) SAVE + SYNC + the FLOOR + RESET through the exact commit a release calls (`commitPlacement`
  //     → PATCH → the server clamp on the world read → the scene). First a bury that must clamp so
  //     a quarter of the SCALED height (≥ 0.5 m) always stands above the seat (never fully sunk).
  const hScaled = 5 * a.committed.scale;
  const floor = liftFloor(hScaled);
  const cellLift = await gh5Of(a.lat, a.lon);
  const deep = await evalJs(`${US}.commitPlacement(${JSON.stringify(modelId)}, { lat: ${a.lat}, lon: ${a.lon}, tU: -1000 }).then((r) => r && r.tU)`);
  if (!near(deep, floor, 0.01)) fail(`leg 6a: a bury commit stored ${deep} m, not the floor ${floor.toFixed(3)} m for a ${hScaled.toFixed(2)} m model`);
  await ownRowEventually(modelId, (r) => near(r.tU, floor, 0.01), "leg 6a (floor)");
  await worldRowEventually(cellLift, modelId, (r) => !!r && near(r.tU, floor, 0.01), "leg 6a (floor, world read — server clamp)");
  await waitUntil("leg 6a: the scene sank to the floor", `(() => { const m = ${UM}.models.find((m) => m.id === ${JSON.stringify(modelId)}); return !!m && Math.abs(m.target.liftM - ${floor}) < 0.05 && Math.abs(m.anchor[1] - ${floor}) < 0.15; })()`, 15_000);
  if (!(await evalJs(`${GZ}.modelPx(${JSON.stringify(modelId)})`))) fail("leg 6a: the sunk model is off screen");
  await shoot("usermodels-09-sunk-floor.jpeg");
  // A full LIFT the reload leg re-applies.
  const LIFT = 6.5;
  const upRow = await evalJs(`${US}.commitPlacement(${JSON.stringify(modelId)}, { lat: ${a.lat}, lon: ${a.lon}, tU: ${LIFT} }).then((r) => r && r.tU)`);
  if (!near(upRow, LIFT, 1e-6)) fail(`leg 6a: a lift commit stored ${upRow} m, not ${LIFT}`);
  await ownRowEventually(modelId, (r) => near(r.tU, LIFT, 1e-6), "leg 6a (lift)");
  await waitUntil("leg 6a: the scene rose to the lift", `(() => { const m = ${UM}.models.find((m) => m.id === ${JSON.stringify(modelId)}); return !!m && Math.abs(m.anchor[1] - ${LIFT}) < 0.1; })()`, 15_000);
  const own6 = await ownRowEventually(modelId, (r) => near(r.tU, LIFT, 1e-6) && near(r.lat, a.lat, 1e-9), "leg 6a (lift)");
  const moved = { lat: own6.lat, lon: own6.lon, rotDeg: own6.rotDeg, scale: own6.scale, tU: own6.tU };
  await evalJs(`${ES}.requestDisarm(), true`);
  await sleep(200);
  console.log(`leg 6a: real Y-arrow drag moved the anchor ${liveDrag.toFixed(2)} m ("${rowDrag}") \u00b7 a bury commit clamped to the floor ${floor.toFixed(2)} m (row + world read + scene, ${hScaled.toFixed(1)} m model) \u00b7 a +${LIFT} m lift applied for the reload`);

  // --- 6b: MS5b §11.4 — leave FPV in-page; an ORBIT drag must work after the model session ------
  const gzOut = await evalJs("(({ bldgGizmo, modelGizmo }) => ({ b: bldgGizmo().inScene, m: modelGizmo().inScene }))(window.__globe)");
  if (gzOut.b || gzOut.m) fail(`leg 6b: a detached gizmo helper is still in the scene: ${JSON.stringify(gzOut)}`);
  const post = await orbitDragProbe("leg 6b");
  if (post.ray.first.gizmo || post.ray.gizmoHits !== 0) fail(`leg 6b: the parked model gizmo answers the orbit raycast (the §11.4 bug): ${JSON.stringify(post.ray)}`);
  console.log(`leg 6b: orbit drag after the session → ${post.dM.toFixed(1)} m (camera ${post.camM.toFixed(1)} m) · first hit ${post.ray.first.type} @ ${post.ray.first.distance.toFixed(0)} m · ${post.ray.hits} hits, ${post.ray.gizmoHits} gizmo`);
  const ctl = await controlSeesHelper("modelGizmo");
  if (!ctl.planeFound || ctl.gizmoHits === 0) fail(`leg 6b: positive control — the probe cannot see a helper that IS in the scene (${JSON.stringify(ctl)})`);
  if (post.dM < 30) fail(`leg 6b: the orbit drag moved the focus only ${post.dM.toFixed(1)} m (${JSON.stringify(post)})`);
  console.log(`leg 6b: helpers out of the scene · control: plane ${ctl.planeDistM.toFixed(0)} m away, ${ctl.gizmoHits} gizmo hit(s) of ${ctl.hits}`);

  // --- 7: reload (member): the seats + the placement re-apply from the world read ----------------
  await loadUrl(FPV_URL, "leg 7", { member: true });
  await waitFpv("leg 7");
  const r7 = await waitResident(modelId, "leg 7");
  if (Math.abs(r7.target.rotDeg - moved.rotDeg) > 1e-6 || Math.abs(r7.target.scale - moved.scale) > 1e-6 || Math.abs(r7.target.liftM - moved.tU) > 1e-6) fail(`leg 7: seats after reload ${JSON.stringify(r7.target)} vs ${JSON.stringify(moved)}`);
  if (!near(r7.lat, moved.lat, 1e-9) || !near(r7.lon, moved.lon, 1e-9)) fail(`leg 7: placement after reload ${r7.lat}, ${r7.lon}`);
  if (!near(r7.anchor[1], moved.tU, 1e-6)) fail(`leg 7: the anchor after reload does not carry the lift: ${JSON.stringify(r7.anchor)}`);
  console.log(`leg 7: reload re-applied rot ${r7.target.rotDeg.toFixed(1)}° · scale ${r7.target.scale.toFixed(3)} · lift +${r7.target.liftM.toFixed(2)} m · the moved placement`);

  // --- 8: anonymous: resident, not armable, MINE empty --------------------------------------------
  await clearCookie();
  await loadUrl(FPV_URL, "leg 8", { member: false });
  await waitFpv("leg 8");
  await waitResident(modelId, "leg 8");
  const t8 = Date.now();
  while ((await evalJs(`${US}.minePhase`)) === "loading" && Date.now() - t8 < 10_000) await sleep(200);
  if ((await evalJs(`${US}.mine.length`)) !== 0) fail("leg 8: an anonymous visitor has MINE rows");
  const px8 = await evalJs(`${GZ}.modelPx(${JSON.stringify(modelId)})`);
  if (!px8) fail("leg 8: the model is not on screen");
  await rightClick(px8.x, px8.y);
  await sleep(300);
  if (await armed()) fail("leg 8: a visitor armed someone else's model");
  console.log("leg 8: anonymous sees the model, cannot arm it");

  // --- 9: the MDL gate --------------------------------------------------------------------------------
  await evalJs("window.__cameraStore.getState().setModelsVisible(false), true");
  await sleep(600);
  const off = await evalJs(`(() => { const u = ${UM}; return { visible: u.visible, resident: u.resident }; })()`);
  if (off.visible || off.resident !== 0) fail(`leg 9: MDL off left ${JSON.stringify(off)}`);
  await evalJs("window.__cameraStore.getState().setModelsVisible(true), true");
  await waitResident(modelId, "leg 9");
  const pref = await evalJs('JSON.parse(localStorage.getItem("ftw:view-prefs:v1") || "{}").modelsVisible');
  if (pref !== true) fail(`leg 9: the pref did not persist (${pref})`);
  console.log("leg 9: MDL off released the model, on brought it back, the pref persisted");

  // --- 10: orbit click-to-place -----------------------------------------------------------------------
  await setCookie();
  await loadUrl(ORBIT_URL, "leg 10", { member: true });
  await sleep(2500);
  await evalJs(`${US}.beginPlacing(${JSON.stringify(modelId)}, "MS5 verify box"), true`);
  await sleep(200);
  if ((await evalJs("document.querySelector('canvas').style.cursor")) !== "crosshair") fail("leg 10: no crosshair while placing");
  if (!(await evalJs("!!document.querySelector('.pd-hint[data-kind=\"model\"]')"))) fail("leg 10: no placing hint pill");
  await shoot("usermodels-03-placing.jpeg");
  await hover(800, 520);
  await sleep(200);
  await mouse("mousePressed", 800, 520, { clickCount: 1 });
  await mouse("mouseReleased", 800, 520, { clickCount: 1 });
  const t10 = Date.now();
  while ((await evalJs(`${US}.placing !== null`)) && Date.now() - t10 < 15_000) await sleep(200);
  if (await evalJs(`${US}.placing !== null`)) fail("leg 10: the click did not consume the placing");
  const own10 = await ownRowEventually(modelId, (r) => !near(r.lat, moved.lat, 1e-7) || !near(r.lon, moved.lon, 1e-7), "leg 10");
  const dM = Math.hypot((own10.lat - moved.lat) * 111_320, (own10.lon - moved.lon) * 111_320 * Math.cos((moved.lat * Math.PI) / 180));
  if (own10.rotDeg !== moved.rotDeg || own10.scale !== moved.scale || own10.tU !== moved.tU) fail("leg 10: click-to-place touched the seats");
  console.log(`leg 10: click-to-place moved it ${dM.toFixed(0)} m · seats kept (lift +${own10.tU.toFixed(2)} m rode along)`);
  let ref = own10; // the seats the later legs compare against (leg 11b resets them)

  // ═══ MESH SUITE MS6 — management + world edit ═══════════════════════════════════════════════════
  // --- 11: MY PINS · MODELS — the my-uploads list -----------------------------------------------------
  await openModelsTab("leg 11");
  await waitUntil("leg 11: the row", `!!document.querySelector(${JSON.stringify(rowSel(modelId))})`, 15_000);
  const name11 = await rowText(modelId, ".mp-name");
  if (name11 !== "MS5 verify box") fail(`leg 11: the row's title reads ${JSON.stringify(name11)}`);
  const sub11 = await rowText(modelId, ".mp-sub");
  if (!/ m · 12 TRIS · ↑ \+\d+\.\d+$/.test(sub11 ?? "")) fail(`leg 11: the fact line reads ${JSON.stringify(sub11)} (expected "… m · 12 TRIS · ↑ +x.xx" — the model is lifted)`);
  const w11 = 3 * ref.scale;
  if (!(sub11 ?? "").startsWith(`${w11 >= 10 ? w11.toFixed(1) : w11.toFixed(2)} × `)) fail(`leg 11: the fact line does not start with the scaled width: ${JSON.stringify(sub11)}`);
  const badges11 = await evalJs(`[...document.querySelectorAll(${JSON.stringify(`${rowSel(modelId)} .mp-badge`)})].map((b) => b.textContent)`);
  if (badges11.length !== 0) fail(`leg 11: a placed, ready, own model wears badges ${JSON.stringify(badges11)}`);
  const acts11 = await evalJs(`[...document.querySelectorAll(${JSON.stringify(`${rowSel(modelId)} [data-act]`)})].map((b) => b.dataset.act)`);
  if (JSON.stringify(acts11) !== JSON.stringify(["rename", "goto", "reset", "hide", "delete"])) fail(`leg 11: the action group is ${JSON.stringify(acts11)}`);
  const tab11 = await evalJs("document.querySelector('.mp-tab[data-tab=\"models\"]')?.textContent ?? ''");
  if (!/^MODELS · \d+$/.test(tab11)) fail(`leg 11: the tab label reads ${JSON.stringify(tab11)}`);
  await shoot("usermodels-04-models-tab.jpeg");
  console.log(`leg 11: MODELS tab lists ${JSON.stringify(name11)} · "${sub11}" · no badges · ✎ GOTO RESET HIDE ✕ · tab "${tab11}"`);

  // --- 11b: MS7 — RESET on the row: yaw 0 / scale 1 / lift 0 through ONE PATCH; the spot stays ------
  const resetSel = `${rowSel(modelId)} [data-act="reset"]`;
  if ((await rowText(modelId, '[data-act="reset"]')) !== "RESET") fail("leg 11b: no RESET on the row");
  if (await evalJs(`document.querySelector(${JSON.stringify(resetSel)})?.disabled`)) fail("leg 11b: RESET is dark on an edited model");
  const gotoSel = `${rowSel(modelId)} [data-act="goto"]`;
  if (await evalJs(`document.querySelector(${JSON.stringify(gotoSel)})?.disabled`)) fail("leg 11b: GOTO is dark on a placed model");
  await clickIn(modelId, '[data-act="reset"]');
  const own11b = await ownRowEventually(modelId, (r) => r.rotDeg === 0 && r.scale === 1 && r.tU === 0, "leg 11b");
  if (!near(own11b.lat, own10.lat, 1e-9) || !near(own11b.lon, own10.lon, 1e-9)) fail("leg 11b: RESET moved the placement");
  const cell11 = await gh5Of(own10.lat, own10.lon);
  await worldRowEventually(cell11, modelId, (r) => !!r && r.rotDeg === 0 && r.scale === 1 && r.tU === 0, "leg 11b (world read)");
  await waitUntil(
    "leg 11b: the scene eased onto the upload",
    `(() => { const m = ${UM}.models.find((m) => m.id === ${JSON.stringify(modelId)}); return !!m && Math.abs(m.target.scale - 1) < 1e-9 && Math.abs(m.target.liftM) < 1e-9 && Math.abs(m.target.rotDeg) < 1e-9 && Math.abs(m.anchor[1]) < 0.01 && Math.abs(m.bodyScale - 1) < 0.01; })()`,
    15_000,
  );
  const sub11b = await rowText(modelId, ".mp-sub");
  if (sub11b !== "3.00 × 3.00 × 5.00 m · 12 TRIS") fail(`leg 11b: the fact line after RESET reads ${JSON.stringify(sub11b)}`);
  if (!(await evalJs(`document.querySelector(${JSON.stringify(resetSel)})?.disabled`))) fail("leg 11b: RESET stays lit on an as-uploaded model");
  ref = own11b;
  await shoot("usermodels-10-list-reset.jpeg");
  console.log(`leg 11b: RESET → rot 0 · scale 1 · lift 0 (own list · world read · scene eased) · spot kept · row "${sub11b}" · RESET dark, GOTO lit`);

  // --- 12: ✎ RENAME inline --------------------------------------------------------------------------
  const NEW_TITLE = "MS6 renamed box";
  await clickIn(modelId, '[data-act="rename"]');
  await waitUntil("leg 12: the rename input", `!!document.querySelector(${JSON.stringify(`${rowSel(modelId)} .mp-rename__input`)})`, 5_000);
  await evalJs(
    `(() => { const el = document.querySelector(${JSON.stringify(`${rowSel(modelId)} .mp-rename__input`)});` +
      ` const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(NEW_TITLE)});` +
      ` el.dispatchEvent(new Event("input", { bubbles: true })); el.focus(); return el.value; })()`,
  );
  await sleep(150);
  await key("Enter", "Enter", 13);
  await waitUntil("leg 12: the row renamed", `document.querySelector(${JSON.stringify(`${rowSel(modelId)} .mp-name`)})?.textContent === ${JSON.stringify(NEW_TITLE)}`, 15_000);
  const own12 = await ownRowEventually(modelId, (r) => r.title === NEW_TITLE, "leg 12");
  const cell12 = await gh5Of(own10.lat, own10.lon);
  await worldRowEventually(cell12, modelId, (r) => r?.title === NEW_TITLE, "leg 12");
  const info12 = await modelInfo(modelId);
  if (info12?.title !== NEW_TITLE) fail(`leg 12: the scene's row did not take the new title without a reload: ${JSON.stringify(info12?.title)}`);
  if (own12.rotDeg !== ref.rotDeg || own12.scale !== ref.scale || own12.tU !== ref.tU || !near(own12.lat, ref.lat, 1e-9)) fail("leg 12: the rename touched the placement or the seats");
  console.log(`leg 12: renamed → "${NEW_TITLE}" · own list, world read and the scene agree · seats + placement untouched`);

  // --- 13: HIDE / SHOW ------------------------------------------------------------------------------
  await clickIn(modelId, '[data-act="hide"]');
  await ownRowEventually(modelId, (r) => r.hidden === true, "leg 13");
  await waitUntil("leg 13: HIDDEN badge + the foot note", `!!document.querySelector(${JSON.stringify(`${rowSel(modelId)} .mp-badge.is-hidden`)}) && !!document.querySelector('[data-note="hidden"]')`, 10_000);
  await worldRowEventually(cell12, modelId, (r) => r === null, "leg 13 (hidden → out of the world read)");
  await waitUntil("leg 13: the scene dropped it", `!${UM}.models.some((m) => m.id === ${JSON.stringify(modelId)})`, 15_000);
  const hideBtn13 = await rowText(modelId, '[data-act="hide"]');
  if (hideBtn13 !== "SHOW") fail(`leg 13: the hide control reads ${JSON.stringify(hideBtn13)} while hidden`);
  await shoot("usermodels-05-hidden.jpeg");
  await clickIn(modelId, '[data-act="hide"]');
  await ownRowEventually(modelId, (r) => r.hidden === false, "leg 13 (show)");
  await worldRowEventually(cell12, modelId, (r) => !!r, "leg 13 (shown → back in the world read)");
  await waitUntil("leg 13: back in the scene", `${UM}.models.some((m) => m.id === ${JSON.stringify(modelId)})`, 15_000);
  if (await evalJs("!!document.querySelector('[data-note=\"hidden\"]')")) fail("leg 13: the hidden foot note outlived SHOW");
  console.log("leg 13: HIDE left the world read + the scene at once (badge + note) · SHOW brought it back");

  // --- 14: GOTO (MS7; the row click shares the handler) STANDS BESIDE the model ---------------------
  await clickIn(modelId, '[data-act="goto"]');
  await waitUntil("leg 14: the panel closed", "!document.querySelector('.mp-panel')", 5_000);
  await waitFpv("leg 14");
  await waitUntil("leg 14: the entry flight settles", "!window.__globe.flight.active()", 30_000);
  await sleep(1200);
  const geo14 = await evalJs(`(() => { const cs = ${CS}; return { lat: cs.camGeo?.latDeg ?? null, lon: cs.camGeo?.lonDeg ?? null, heading: cs.fpvHud?.headingDeg ?? cs.headingDeg }; })()`);
  if (geo14.lat === null) fail("leg 14: no camGeo in FPV");
  const d14 = distM({ lat: own10.lat, lon: own10.lon }, geo14);
  const want14 = standDistance(5, ref.scale);
  if (!(d14 > want14 * 0.5 && d14 < want14 * 1.6 + 5)) fail(`leg 14: the eye stands ${d14.toFixed(1)} m from the model (expected ≈ ${want14.toFixed(1)} m)`);
  if (geo14.lat >= own10.lat) fail("leg 14: the eye is not SOUTH of the model");
  const hd14 = ((geo14.heading % 360) + 360) % 360;
  if (Math.min(hd14, 360 - hd14) > 12) fail(`leg 14: the eye looks ${hd14.toFixed(1)}°, not north`);
  await waitResident(modelId, "leg 14");
  await sleep(600);
  const px14 = await evalJs(`${GZ}.modelPx(${JSON.stringify(modelId)})`);
  if (!px14) fail("leg 14: the model is not in front of the eye");
  await shoot("usermodels-06-stand-beside.jpeg");
  console.log(`leg 14: GOTO stood beside it — ${d14.toFixed(1)} m south (≈ ${want14.toFixed(1)} m), heading ${hd14.toFixed(1)}°, the model on screen at (${px14.x.toFixed(0)}, ${px14.y.toFixed(0)})`);

  // --- 15: FOREIGN EDIT — another member's model, seeded DEV-only ----------------------------------
  const seedLat = SEED.lat + 22 / 111_320; // 22 m north of the eye
  const seedBody = {
    kind: "model",
    ownerEmail: FOREIGN_OWNER,
    model: {
      fileId: `plux-ms6-foreign-${Date.now()}.glb`, // a row-only seed: the bytes are the own row's
      thumbnailFileId: null,
      title: "MS6 foreign box",
      fileName: null,
      sourceFormat: "glb",
      rawBytes: null,
      glbBytes: own10.glbBytes ?? 1000,
      tris: 12,
      meshes: 1,
      textures: 0,
      decimatedFromTris: null,
      bbox: [3, 5, 3],
      lat: seedLat,
      lon: SEED.lon,
      url: own10.url,
    },
  };
  const seeded = await postJson("/api/dev-seed", seedBody);
  if (seeded.status !== 200 || !seeded.body?.modelId) fail(`leg 15: dev-seed answered ${seeded.status} ${JSON.stringify(seeded.body)}`);
  foreignId = seeded.body.modelId;
  await loadUrl(FPV_URL, "leg 15", { member: true });
  await waitFpv("leg 15");
  await waitResident(foreignId, "leg 15");
  await waitSeatedStill(foreignId, "leg 15");
  if (await evalJs(`${US}.mine.some((m) => m.id === ${JSON.stringify(foreignId)})`)) fail("leg 15: another member's model joined MINE");
  const pxF = await evalJs(`${GZ}.modelPx(${JSON.stringify(foreignId)})`);
  if (!pxF) fail("leg 15: the foreign model is not on screen");
  await hover(pxF.x, pxF.y);
  await sleep(300);
  const noteF = await evalJs("document.querySelector('.bldg-edit-label')?.textContent ?? ''");
  if (!noteF.includes("MODEL · MS6 foreign box") || noteF.includes("yours")) {
    const diagF = await evalJs(`(() => { const g = ${GZ}; return { px: ${JSON.stringify(pxF)}, hoverId: g.hoverId, pickAt: g.pickAt(${pxF.x}, ${pxF.y}), bldgArmed: !!window.__bldgEditStore.getState().armed, fpv: window.__globe.fpv().active, label: document.querySelector('.bldg-edit-label')?.innerHTML ?? null }; })()`);
    fail(`leg 15: the hover note over a foreign model reads ${JSON.stringify(noteF)} — ${JSON.stringify(diagF)}`);
  }
  const pressF = await rightClick(pxF.x, pxF.y);
  await sleep(300);
  let af = await armed();
  if (!af || af.id !== foreignId || af.mine !== false) fail(`leg 15: the right-click did not arm the foreign model as SHARED: ${JSON.stringify(af)}`);
  if (!(await evalJs(`${ES}.menu !== null`))) fail(`leg 15: the menu is not open after the release (open at press: ${pressF})`);
  const badgeF = await evalJs("document.querySelector('.bldg-edit-chip[data-kind=\"model\"] .bec-origin')?.textContent ?? ''");
  const originF = await evalJs("document.querySelector('.bldg-edit-chip[data-kind=\"model\"] .bec-origin')?.dataset.origin ?? ''");
  if (badgeF !== "SHARED" || originF !== "shared") fail(`leg 15: the badge reads ${JSON.stringify(badgeF)} / ${JSON.stringify(originF)}`);
  await shoot("usermodels-07-foreign-armed.jpeg");
  await mouse("mousePressed", 300, 140, { clickCount: 1 });
  await mouse("mouseReleased", 300, 140, { clickCount: 1 });
  await sleep(200);
  if (!(await armed())) fail("leg 15: the left tap that closed the menu disarmed the foreign model");
  await key("KeyR", "r", 82);
  await sleep(300);
  await waitSeatedStill(foreignId, "leg 15");
  const hYF = await handleDir("Y");
  await dragFrom(hYF.hp, 0.95, -0.3, 70, 7);
  af = await waitSaved("leg 15");
  if (Math.abs(af.committed.rotDeg) < 1) fail(`leg 15: the foreign ROTATE did not commit: ${JSON.stringify(af.committed)}`);
  const cellF = await gh5Of(seedLat, SEED.lon);
  await worldRowEventually(cellF, foreignId, (r) => !!r && Math.abs(r.rotDeg - af.committed.rotDeg) < 1e-6, "leg 15 (LWW landed)");
  const ownerList = await pageApi(`/api/dev-seed?ownerEmail=${encodeURIComponent(FOREIGN_OWNER)}&kind=model`);
  const ownerRow = ownerList.body?.models?.find((m) => m.id === foreignId) ?? null;
  if (!ownerRow || ownerRow.editedByOther !== true) fail(`leg 15: the owner's row does not say EDITED by another member: ${JSON.stringify(ownerRow)}`);
  if (Math.abs(ownerRow.rotDeg - af.committed.rotDeg) > 1e-6) fail("leg 15: the owner's row does not carry the foreign yaw");
  const ownList15 = await pageApi("/api/models");
  if (ownList15.body?.models?.some((m) => m.id === foreignId)) fail("leg 15: the own list carries the foreign row");
  await evalJs(`${ES}.requestDisarm(), true`);
  await sleep(200);
  const delF = await pageApi(`/api/dev-seed?kind=model&id=${encodeURIComponent(foreignId)}`, { method: "DELETE" });
  if (delF.body?.deleted !== true) fail(`leg 15: the seed row could not be removed: ${JSON.stringify(delF)}`);
  await worldRowEventually(cellF, foreignId, (r) => r === null, "leg 15 (seed removed → out of the world read)");
  foreignId = null;
  console.log(`leg 15: foreign model armed as SHARED (menu open at press ${pressF}) · ROTATE ${af.committed.rotDeg.toFixed(1)}° landed for everyone · owner's row EDITED by another member · MINE clean · seed removed`);

  // --- 16: ORBIT hover + click → stand beside it --------------------------------------------------
  await loadUrl(ORBIT_URL, "leg 16", { member: true });
  await sleep(2000);
  await evalJs(`${CS}.requestFly({ latDeg: ${own10.lat}, lonDeg: ${own10.lon}, altM: 220 }), true`);
  await sleep(3000);
  await waitUntil("leg 16: the fly-in settles", "!window.__globe.flight.active()", 30_000);
  await waitResident(modelId, "leg 16");
  await sleep(1000);
  const px16 = await evalJs(`${GZ}.modelPx(${JSON.stringify(modelId)})`);
  if (!px16) fail("leg 16: the model is not on screen in orbit");
  await hover(px16.x, px16.y);
  await sleep(150);
  await hover(px16.x + 1, px16.y);
  await sleep(450);
  const hov16 = await evalJs(`${GZ}.hoverId`);
  const cur16 = await evalJs("document.querySelector('canvas').style.cursor");
  const note16 = await evalJs("document.querySelector('.bldg-edit-label')?.textContent ?? ''");
  if (hov16 !== modelId) fail(`leg 16: the orbit hover did not pick the model (hoverId ${JSON.stringify(hov16)}, pickAt ${JSON.stringify(await evalJs(`${GZ}.pickAt(${px16.x}, ${px16.y})`))})`);
  if (cur16 !== "pointer") fail(`leg 16: the cursor over a model in orbit is ${JSON.stringify(cur16)}`);
  if (!note16.includes(`MODEL · ${NEW_TITLE}`) || !note16.includes("yours")) fail(`leg 16: the orbit hover note reads ${JSON.stringify(note16)}`);
  await shoot("usermodels-08-orbit-hover.jpeg");
  await mouse("mousePressed", px16.x + 1, px16.y, { clickCount: 1 });
  await mouse("mouseReleased", px16.x + 1, px16.y, { clickCount: 1 });
  await waitFpv("leg 16");
  await waitUntil("leg 16: the entry flight settles", "!window.__globe.flight.active()", 30_000);
  await sleep(1200);
  const geo16 = await evalJs(`(() => { const cs = ${CS}; return { lat: cs.camGeo?.latDeg ?? null, lon: cs.camGeo?.lonDeg ?? null }; })()`);
  const d16 = distM({ lat: own10.lat, lon: own10.lon }, geo16);
  if (!(d16 > want14 * 0.5 && d16 < want14 * 1.6 + 5)) fail(`leg 16: the click did not stand beside the model (${d16.toFixed(1)} m, expected ≈ ${want14.toFixed(1)} m)`);
  console.log(`leg 16: orbit hover picked it (cursor pointer, note "${note16}") · the click stood ${d16.toFixed(1)} m from it in FPV`);

  // --- 17: ✕ → SURE? in the list DELETES the model ------------------------------------------------
  await loadUrl(ORBIT_URL, "leg 17", { member: true });
  await sleep(1500);
  await openModelsTab("leg 17");
  await waitUntil("leg 17: the row", `!!document.querySelector(${JSON.stringify(rowSel(modelId))})`, 15_000);
  await clickIn(modelId, '[data-act="delete"]');
  await sleep(150);
  const sure17 = await rowText(modelId, '[data-act="delete"]');
  if (sure17 !== "SURE?") fail(`leg 17: the first press did not arm the delete (${JSON.stringify(sure17)})`);
  await clickIn(modelId, '[data-act="delete"]');
  await waitUntil("leg 17: the row gone", `!document.querySelector(${JSON.stringify(rowSel(modelId))})`, 20_000);
  await ownListLacks(modelId, "leg 17");
  await worldRowEventually(cell12, modelId, (r) => r === null, "leg 17 (deleted → out of the world read)");
  deletedViaUi = true;
  console.log("leg 17: the list's ✕ → SURE? deleted the model — the list, the own API and the world read all dropped it");
} finally {
  // --- 18: cleanup — the collection is the PRODUCTION world even from wix dev -----------------------
  if (foreignId) {
    // The DEV-seeded foreign row (row only — its bytes are the own row's) goes FIRST.
    try {
      const delF = await pageApi(`/api/dev-seed?kind=model&id=${encodeURIComponent(foreignId)}`, { method: "DELETE" });
      if (delF.body?.deleted !== true) cleanupProblem = `cleanup: the seeded foreign row could not be removed ${JSON.stringify(delF)}`;
      else console.log(`cleanup: seeded foreign row ${foreignId} removed`);
    } catch (e) {
      cleanupProblem = `cleanup (seed) threw: ${e?.message ?? e}`;
    }
  }
  if (modelId && deletedViaUi) {
    console.log(`cleanup: ${modelId} was deleted through the list in leg 17 (row + media) — nothing left to remove`);
    // The member cookie must not outlive the run: the profile is shared with the next suite (a
    // leaked session made verify-modelupload's anonymous leg read a member, 2026-09-02m).
    await clearCookie().catch(() => {});
  } else if (modelId) {
    try {
      await setCookie();
      const del = await pageApi(`/api/models?id=${encodeURIComponent(modelId)}`, { method: "DELETE" });
      if (del.body?.deleted !== true || del.body?.mediaDeleted !== true) cleanupProblem = `cleanup: DELETE answered ${JSON.stringify(del)}`;
      else {
        const t0 = Date.now();
        let gone = false;
        while (Date.now() - t0 < 15_000) {
          const res = await pageApi("/api/models");
          if (!res.body?.models?.some((m) => m.id === modelId)) {
            gone = true;
            break;
          }
          await sleep(800);
        }
        if (!gone) cleanupProblem = "cleanup: the row is still listed after DELETE";
        else console.log(`cleanup: ${modelId} removed (row + media), the world left as found`);
      }
      await clearCookie();
    } catch (e) {
      cleanupProblem = `cleanup threw: ${e?.message ?? e}`;
    }
  }
  rmSync(FIX, { recursive: true, force: true });
}
if (cleanupProblem) fail(cleanupProblem);
if (consoleErrors.length > 0) fail(`the page logged ${consoleErrors.length} shader/program error(s) — the chained model materials do not compile: ${consoleErrors[0]}`);
console.log(`console: no shader/program errors logged across the run`);
console.log("PASS: verify-usermodels — 20 legs (upload → world read → real right-click arms, menu survives the release → rotate / scale (0.1×–10×, metres on the row) / move PATCH → MS7 lift: up saved, floor held, ↺ landed → orbit drag after the session (helpers out, control seen) → reload (lift re-applied) → anonymous → MDL gate → click-to-place → MS6: MODELS tab (✎ GOTO RESET HIDE ✕) → MS7 RESET → rename → hide/show → GOTO stands beside → foreign member edits as SHARED (LWW, owner sees EDITED) → orbit hover + click → list delete → cleanup)");
ws.close();
await finishVerify(0);
