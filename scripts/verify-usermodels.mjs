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
//   6b. MS5b §11.4: an in-page FPV exit, then an ORBIT drag moves the focus; no gizmo helper is
//      left in the scene; a positive control proves the probe can see one that is
//   7. reload (member): the seats + the placement re-apply from the world read
//   8. anonymous reload: the model is resident, MINE is empty, a right-click does NOT arm it
//   9. the MDL gate (store → engine): off releases the model, on brings it back
//  10. orbit click-to-place: beginPlacing + a ground click PATCHes a new placement
//  11. cleanup (finally): DELETE removes the row + media; the world read no longer lists it
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

mkdirSync(SHOTS, { recursive: true });
await send("Page.enable");
await send("Runtime.enable");
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
let cleanupProblem = null;
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
  console.log(`leg 2: public row clean · resident (${res2.tris} tris) · seated at ${seat.appliedM.toFixed(2)} m (real) · cover cell ${cell}`);

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
  if (await evalJs(`${GZ}.handlePx("Y") !== null`)) fail("leg 6: the lift arrow is shown on a model (there is no lift seat)");
  await waitSeatedStill(modelId, "leg 6");
  const hM = await handleDir("X");
  await dragFrom(hM.hp, hM.ux, hM.uy, 50, 6);
  a = await waitSaved("leg 6");
  const movedM = Math.hypot((a.lat - SEED.lat) * 111_320, (a.lon - SEED.lon) * 111_320 * Math.cos((SEED.lat * Math.PI) / 180));
  if (movedM < 0.5 || movedM > 250) fail(`leg 6: the placement moved ${movedM.toFixed(2)} m`);
  if (Math.abs(a.live.tE) > 1e-6 || Math.abs(a.live.tN) > 1e-6) fail(`leg 6: an offset survived the commit: ${JSON.stringify(a.live)}`);
  const m6 = await modelInfo(modelId);
  if (Math.hypot(...m6.anchor) > 1e-6) fail(`leg 6: the anchor did not return to zero: ${JSON.stringify(m6.anchor)}`);
  const own6 = await ownRowEventually(modelId, (r) => near(r.lat, a.lat, 1e-9) && near(r.lon, a.lon, 1e-9), "leg 6");
  const moved = { lat: own6.lat, lon: own6.lon, rotDeg: own6.rotDeg, scale: own6.scale };
  console.log(`leg 6: MOVE ${movedM.toFixed(2)} m → (${moved.lat.toFixed(6)}, ${moved.lon.toFixed(6)}) · anchor zero · own list agrees`);
  await evalJs(`${ES}.requestDisarm(), true`);
  await sleep(200);
  if (await armed()) fail("leg 6: DONE did not disarm");

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
  if (Math.abs(r7.target.rotDeg - moved.rotDeg) > 1e-6 || Math.abs(r7.target.scale - moved.scale) > 1e-6) fail(`leg 7: seats after reload ${JSON.stringify(r7.target)} vs ${JSON.stringify(moved)}`);
  if (!near(r7.lat, moved.lat, 1e-9) || !near(r7.lon, moved.lon, 1e-9)) fail(`leg 7: placement after reload ${r7.lat}, ${r7.lon}`);
  console.log(`leg 7: reload re-applied rot ${r7.target.rotDeg.toFixed(1)}° · scale ${r7.target.scale.toFixed(3)} · the moved placement`);

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
  if (own10.rotDeg !== moved.rotDeg || own10.scale !== moved.scale) fail("leg 10: click-to-place touched the seats");
  console.log(`leg 10: click-to-place moved it ${dM.toFixed(0)} m · seats kept`);
} finally {
  // --- 11: cleanup — the collection is the PRODUCTION world even from wix dev -----------------------
  if (modelId) {
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
console.log("PASS: verify-usermodels — 11 legs (upload → world read → real right-click arms, menu survives the release → rotate / scale (0.1×–10×, metres on the row) / move PATCH → orbit drag after the session (helpers out, control seen) → reload → anonymous → MDL gate → click-to-place → cleanup)");
ws.close();
await finishVerify(0);
