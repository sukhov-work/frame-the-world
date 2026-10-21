// Scripted-Chrome verification of the FULL DESKTOP FACADE FLOW (F1 gizmo + undo · F2 save / re-open /
// update / delete · F3 residency), 2026-10-21. The successor of verify-photo-projection-2026-10-18.mjs
// (its CDP boilerplate, pixel machinery and WGS84 helpers are copied verbatim) driving the gizmo the
// verify-meshedit way (handlePx / originPx / ringPx + synthetic Input.dispatchMouseEvent presses) and
// minting the test member the verify-modelupload way.
//
//   1 boot + the desktop attach gate (capacity 4) · 2 signed-out guard (401 + the overlay's sign-in
//   note) · 3 member session · 4 fixture → review → place (apex seated, draft slot on) · 5 the H-FOV
//   override law (tan ratio, exact restore) · 6 GIZMO MOVE (east, no camera fly, one journal entry)
//   · 7 UNDO · 8 GIZMO ROTATE (heading only, about the local up) · 9 GIZMO SCALE (= H-FOV, never a
//   stretch) · 10 SAVE (phase walk, wixstatic URLs, row = store) · 11 RE-OPEN from MY FACADES ·
//   12 EDIT → UPDATE (the server's copy) · 13 RESIDENCY (slot + marker + PIXELS on vs off) ·
//   14 DELETE (gone server-side, bogus 404) · 15 the pin flow untouched + a clean console.
//
// Usage: node scripts/verify-facade-flow-2026-10-21.mjs
//   env FTW_CDP_PORT (default 9333 — the house headless Chrome), FTW_FF_URL (page URL override),
//       FTW_FF_SKIP_SAVE=1 → legs 1, 2, 4–9, 15 only (no member, no Media writes — the gizmo gate).
// Needs `wix dev` on http://localhost:4321 (the window.__* DEV seams) and, for the save legs,
// TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD / WIX_CLIENT_ID in .env.local. Shots → verify-shots/facade-flow/.
// CLEANUP: every row this harness creates it deletes (leg 14); a FAIL / throw / Ctrl-C between the
// save and leg 14 still DELETEs the created id (the finally block + the prepended crash handlers).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, OAuthStrategy } from "@wix/sdk";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.env.FTW_CDP_PORT ?? 9333);
const SKIP_SAVE = process.env.FTW_FF_SKIP_SAVE === "1";
// The hash pins the daylight `dnipro-fpv-south` instant over the fixture's GPS point (the 2026-10-18
// entry, verbatim); the `?facade=1` flag retired on 2026-10-22 (T181 — the Upload split is the entry).
const URL =
  process.env.FTW_FF_URL ?? "http://localhost:4321/#p=48.4647,35.0462,1500,25,55.0&t=1788701556919";
const APP = new globalThis.URL(URL).origin;
const SHOTS = "verify-shots/facade-flow";
const FIXTURE = resolve("test/fixtures/facade-pattern.jpg");
const FIX = { lat: 48.4647, lon: 35.0462, heading: 25, w: 1600, h: 1200, focal35: 26 };
const H_FOV = (2 * Math.atan(36 / (2 * FIX.focal35)) * 180) / Math.PI; // 69.39° — the EXIF baseline
const FLIGHT_SETTLE_MS = 3500; // FLIGHT.durationMs 2200 + margin (tuning.ts)
const TITLE = "harness facade";
const D2R = Math.PI / 180;

mkdirSync(SHOTS, { recursive: true });

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
const consoleErrors = []; // Runtime.consoleAPICalled type error + Runtime.exceptionThrown
const glNoise = []; // any console / log text matching the shader / GL pattern (errors AND warnings)
const GL_RE = /shader|GLSL|compile|WebGL/i;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.consoleAPICalled") {
    const type = msg.params?.type;
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (type === "error") consoleErrors.push(text.slice(0, 240));
    if ((type === "error" || type === "warning") && GL_RE.test(text)) glNoise.push(`console.${type}: ${text.slice(0, 240)}`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params?.exceptionDetails;
    consoleErrors.push("EXCEPTION: " + (d?.exception?.description ?? d?.text ?? "").slice(0, 240));
  }
  if (msg.method === "Log.entryAdded") {
    const e = msg.params?.entry;
    if (e && (e.level === "error" || e.level === "warning") && GL_RE.test(e.text ?? ""))
      glNoise.push(`log.${e.level} (${e.source}): ${(e.text ?? "").slice(0, 240)}`);
  }
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
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(s.data, "base64"));
};
/** n requestAnimationFrame ticks in-page (the render loop has run n frames). */
const ticks = (n) =>
  evalJs(`new Promise((r) => { let k = ${n}; const f = () => (--k <= 0 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
/** Poll an in-page expression until it is truthy; returns { ok, value } (value = the last read). */
const waitFor = async (expr, timeoutMs, everyMs = 250) => {
  const t0 = Date.now();
  let value;
  while (Date.now() - t0 < timeoutMs) {
    value = await evalJs(expr).catch((e) => ({ evalError: String(e.message ?? e) }));
    if (value && !value.evalError) return { ok: true, value };
    await sleep(everyMs);
  }
  return { ok: false, value };
};
const near = (a, b, eps) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps;
const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const r6 = (v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);
const FS = "window.__facadeStore.getState()";
const SS = "window.__facadeSaveStore.getState()";
const MS = "window.__facadesStore.getState()";
const GZ = "window.__globe.facadeGizmo()";
const SNAP = "window.__globe.photoProjector()";
const snapshot = () => evalJs(SNAP);
const geomNow = () =>
  evalJs(`(() => { const g = window.__globe.facadeFrustum.current(); return g ? { apex: [...g.apex], forward: [...g.forward], up: [...g.up], right: g.right ? [...g.right] : null, corners: g.corners.map((c) => [...c]) } : null; })()`);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const camPos = () => evalJs("(() => { const p = window.__globe.camera.position; return [p.x, p.y, p.z]; })()");
const facadeState = () =>
  evalJs(`(() => { const s = ${FS}; return { phase: s.phase, placement: s.placement ? { ...s.placement } : null,
    params: { ...s.params }, rollDeg: s.rollDeg ?? null, hFovDeg: s.hFovDeg ?? null, gizmoOp: s.gizmoOp,
    savedFacadeId: s.savedFacadeId ?? null, apexAltM: s.apexAltM ?? null, apexAboveGroundM: s.apexAboveGroundM ?? null,
    previewUrl: s.previewUrl ?? null, pose: s.poseSnapshot ? s.poseSnapshot() : null }; })()`);
const journalLen = () => evalJs("window.__editJournal ? window.__editJournal.entries.length : -1");
const journalLast = () =>
  evalJs("(() => { const e = window.__editJournal?.entries; const l = e && e[e.length - 1]; return l ? { label: l.label, steps: l.steps.length, target: l.steps[0]?.target ?? null } : null; })()");
const pageApi = (path, init = null) =>
  evalJs(
    `fetch(${JSON.stringify(path)}, ${init ? JSON.stringify(init) : "undefined"}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`,
  );

/** The far face's optics, measured from the corners alone ([TL, TR, BR, BL], lib/geo/frustum.ts):
 *  the plane distance along forward, tan(hFov/2), tan(vFov/2), the effective hFov and the aspect —
 *  independent of the plane distance, so a law change there cannot fake a FOV change. */
const opticsOf = (g) => {
  const c = g.corners;
  const centre = [0, 1, 2].map((k) => (c[0][k] + c[1][k] + c[2][k] + c[3][k]) / 4);
  const d = dot3(sub3(centre, g.apex), g.forward);
  const halfW = dist3(c[0], c[1]) / 2;
  const halfH = dist3(c[1], c[2]) / 2;
  return { d, widthM: 2 * halfW, tanH: halfW / d, tanV: halfH / d, hFovDeg: (2 * Math.atan(halfW / d)) / D2R, aspect: halfW / halfH };
};

// --- WGS84 (Node-side pure math — verbatim from the 2026-10-18 harness, + the ENU basis) ---------
const WGS_A = 6378137;
const WGS_F = 1 / 298.257223563;
const WGS_E2 = WGS_F * (2 - WGS_F);
const ecef = (latDeg, lonDeg, h = 0) => {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  const n = WGS_A / Math.sqrt(1 - WGS_E2 * Math.sin(la) ** 2);
  return [(n + h) * Math.cos(la) * Math.cos(lo), (n + h) * Math.cos(la) * Math.sin(lo), (n * (1 - WGS_E2) + h) * Math.sin(la)];
};
const normalAt = (latDeg, lonDeg) => {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};
const eastAt = (lonDeg) => [-Math.sin(lonDeg * D2R), Math.cos(lonDeg * D2R), 0];
const northAt = (latDeg, lonDeg) => {
  const la = latDeg * D2R;
  const lo = lonDeg * D2R;
  return [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
};
/** The camera forward for (heading, pitch) at a point — the cameraForward law in ENU. */
const forwardAt = (latDeg, lonDeg, headingDeg, pitchDeg = 0) => {
  const E = eastAt(lonDeg);
  const N = northAt(latDeg, lonDeg);
  const U = normalAt(latDeg, lonDeg);
  const h = headingDeg * D2R;
  const p = pitchDeg * D2R;
  return [0, 1, 2].map((k) => Math.cos(p) * (Math.sin(h) * E[k] + Math.cos(h) * N[k]) + Math.sin(p) * U[k]);
};

// --- the pixel machinery (verbatim from the 2026-10-18 harness) ----------------------------------
const capture = async (name, jpegName) => {
  const png = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(png.data, "base64"));
  if (jpegName) await shot(jpegName);
  return evalJs(`(async () => {
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = "data:image/png;base64,${png.data}"; });
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
    (window.__ppCap = window.__ppCap || {})[${JSON.stringify(name)}] = x.getImageData(0, 0, c.width, c.height);
    return [c.width, c.height];
  })()`);
};
const diff = (a, b) =>
  evalJs(`(() => {
    const A = window.__ppCap[${JSON.stringify(a)}].data, B = window.__ppCap[${JSON.stringify(b)}].data;
    if (A.length !== B.length) return { sizeMismatch: [A.length, B.length] };
    let sum = 0, changed = 0, satA = 0, satB = 0;
    for (let i = 0; i < A.length; i += 4) {
      const dr = Math.abs(A[i] - B[i]), dg = Math.abs(A[i + 1] - B[i + 1]), db = Math.abs(A[i + 2] - B[i + 2]);
      sum += dr + dg + db;
      if (dr > 24 || dg > 24 || db > 24) changed++;
      if (Math.max(A[i], A[i + 1], A[i + 2]) - Math.min(A[i], A[i + 1], A[i + 2]) > 110) satA++;
      if (Math.max(B[i], B[i + 1], B[i + 2]) - Math.min(B[i], B[i + 1], B[i + 2]) > 110) satB++;
    }
    const n = A.length / 4;
    return { meanAbs: Math.round((sum / (n * 3)) * 1000) / 1000, changed, satA, satB, satDelta: satA - satB };
  })()`);
const dropCaps = () => evalJs("(window.__ppCap = {}, true)");

// --- the gizmo machinery (the verify-meshedit idiom) ---------------------------------------------
const mouse = (type, x, y, opts = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseMoved" ? 1 : undefined, ...opts });
const hover = (x, y) => mouse("mouseMoved", x, y, { buttons: 0 });
/** Drag from `from` along unit `(ux, uy)` for `px` in `steps`; `midHook` runs at the half-way step.
 *  Returns the camera's max displacement (m) over the whole gesture — the "did not fly" check. */
const dragFrom = async (from, ux, uy, px, steps = 8, midHook = null) => {
  const c0 = await camPos();
  let camMax = 0;
  await hover(from.x, from.y);
  await sleep(60);
  await mouse("mousePressed", from.x, from.y, { clickCount: 1 });
  await sleep(40);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", from.x + (ux * px * i) / steps, from.y + (uy * px * i) / steps);
    await sleep(30);
    camMax = Math.max(camMax, dist3(c0, await camPos()));
    if (midHook && i === Math.ceil(steps / 2)) await midHook();
  }
  const end = { x: from.x + ux * px, y: from.y + uy * px };
  await mouse("mouseReleased", end.x, end.y, { clickCount: 1 });
  await sleep(150);
  await ticks(3);
  camMax = Math.max(camMax, dist3(c0, await camPos()));
  return { end, camMovedM: camMax };
};
/** A handle's press point + its axis direction on screen (handlePx − originPx), nudged 4 px off the
 *  centre line onto the arrow's body — verify-meshedit's `handleDir`, verbatim in spirit. */
const handleDir = async (name) => {
  const hp = await evalJs(`${GZ}?.handlePx(${JSON.stringify(name)}) ?? null`);
  const o = await evalJs(`${GZ}?.originPx() ?? null`);
  if (!hp || !o) return { error: `handle ${name} is not on screen: ${JSON.stringify({ hp, o })}` };
  const dx = hp.x - o.x;
  const dy = hp.y - o.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // three's picker has one arrow per SIDE and handlePx returns the first part — which may be the
  // NEGATIVE side. The sign the drag must produce in the world is read off the screen: the
  // projected direction of +east at the apex, dotted with the handle's screen direction.
  const east = await evalJs(`(() => {
    const g = window.__globe.facadeFrustum.current();
    const cam = window.__globe.camera;
    const V = cam.up.constructor;
    const lon = ${FS}.placement.lonDeg * Math.PI / 180;
    const e = new V(-Math.sin(lon), Math.cos(lon), 0);
    const a = new V(g.apex[0], g.apex[1], g.apex[2]).project(cam);
    const b = new V(g.apex[0], g.apex[1], g.apex[2]).addScaledVector(e, 10).project(cam);
    return { dx: b.x - a.x, dy: -(b.y - a.y) };
  })()`);
  const eastSign = Math.sign(ux * east.dx + uy * east.dy) || 1;
  return { hp: { x: hp.x - uy * 4, y: hp.y + ux * 4 }, centre: hp, o, ux, uy, lenPx: len, eastSign };
};
/** A ring point whose HOVER really reads the wanted axis (the rotate rings overlap on screen — the
 *  lowest Y-ring point can sit on the X ring): walk the ring's points, hover each, take the first
 *  the controls attribute to `axis`. Returns the point + the local tangent, or null. */
const ringPointFor = async (axis, count = 36) => {
  const ring = await evalJs(`${GZ}.ringPx(${JSON.stringify(axis)}, ${count})`);
  if (!Array.isArray(ring) || ring.length < 3) return null;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (!p || p.x < 20 || p.x > 1580 || p.y < 20 || p.y > 980) continue;
    // The module's own hover test (the seam's `hoverAt`) — deterministic; the drag itself is real.
    const ax = await evalJs(`${GZ}.hoverAt(${p.x}, ${p.y})`);
    if (ax !== axis) continue;
    const pa = ring[(i - 1 + ring.length) % ring.length];
    const pb = ring[(i + 1) % ring.length];
    const tl = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    return { p, i, n: ring.length, tx: (pb.x - pa.x) / tl, ty: (pb.y - pa.y) / tl };
  }
  return null;
};
const setOp = async (op) => {
  await evalJs(`${FS}.setGizmoOp(${JSON.stringify(op)}), true`);
  if (op === "none") return waitFor(`(() => { const g = ${GZ}; return !!g && g.attached === false; })()`, 1000, 50);
  return waitFor(`(() => { const g = ${GZ}; return !!g && g.attached === true && g.op === ${JSON.stringify(op)}; })()`, 1000, 50);
};
/** A deterministic oblique orbit pose on the draft's apex (55 m behind, 30 m up, 20 m right,
 *  looking just past the apex) so the X / Y / Z handles all project with a non-degenerate screen
 *  direction — the landing pose looks down the frustum, which foreshortens the forward axis. */
const frameGizmo = async () => {
  const ok = await evalJs(`(() => {
    const g = window.__globe.facadeFrustum.current();
    if (!g) return false;
    const V = window.__globe.camera.up.constructor; // the page's THREE.Vector3
    const apex = new V(g.apex[0], g.apex[1], g.apex[2]);
    const fwd = new V(g.forward[0], g.forward[1], g.forward[2]);
    const up = apex.clone().normalize();
    const right = new V().crossVectors(fwd, up).normalize();
    const pos = apex.clone().addScaledVector(fwd, -55).addScaledVector(up, 30).addScaledVector(right, 20);
    window.__globe.flight.start({ position: pos, lookAt: apex.clone().addScaledVector(fwd, 10) });
    return true;
  })()`);
  if (!ok) return false;
  await sleep(1500);
  // Still = two reads 250 ms apart within 1 cm (the cut has landed, no corrector in flight).
  let last = await camPos();
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const p = await camPos();
    if (dist3(p, last) < 0.01) return true;
    last = p;
  }
  return true;
};
const optOf = (a) => (a === undefined || a === null ? null : a);
const sameOpt = (a, b, eps) => (optOf(a) === null && optOf(b) === null) || near(optOf(a), optOf(b), eps);

// --- the member session (the verify-modelupload recipe, verbatim) --------------------------------
let cookieVal = null;
const mintMember = async () => {
  const SITE = process.env.FTW_SITE_URL || "https://www.plux.today";
  const envLocal = readFileSync(".env.local", "utf-8");
  const envVal = (k) => envLocal.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
  const TEST_MEMBER = { email: envVal("TEST_MEMBER_EMAIL"), password: envVal("TEST_MEMBER_PASSWORD") };
  const clientId = envVal("WIX_CLIENT_ID");
  if (!TEST_MEMBER.email || !TEST_MEMBER.password || !clientId)
    throw new Error("the save legs need TEST_MEMBER_EMAIL / TEST_MEMBER_PASSWORD / WIX_CLIENT_ID in .env.local (audit B2)");
  const sdk = createClient({ auth: OAuthStrategy({ clientId }) });
  const login = await sdk.auth.login({ email: TEST_MEMBER.email, password: TEST_MEMBER.password });
  if (login.loginState !== "SUCCESS") throw new Error(`member login state ${login.loginState}`);
  const REDIRECT = `${APP}/api/auth/callback`;
  const oauthData = sdk.auth.generateOAuthData(REDIRECT, `${APP}/`);
  const authorizeUrl =
    `${SITE}/_api/oauth2/authorize?clientId=${clientId}&responseType=code&state=${oauthData.state}` +
    `&redirectUri=${encodeURIComponent(REDIRECT)}&scope=offline_access&responseMode=query` +
    `&codeChallenge=${oauthData.codeChallenge}&codeChallengeMethod=S256&prompt=none&sessionToken=${login.data.sessionToken}`;
  const authRes = await fetch(authorizeUrl, { redirect: "manual" });
  const loc = authRes.headers.get("location");
  if (!loc) throw new Error(`authorize gave no redirect (${authRes.status})`);
  const memberTokens = await sdk.auth.getMemberTokens(
    new globalThis.URL(loc).searchParams.get("code"),
    new globalThis.URL(loc).searchParams.get("state"),
    oauthData,
  );
  cookieVal = encodeURIComponent(JSON.stringify({ clientId, tokens: memberTokens }));
  return memberTokens.refreshToken.role;
};
/** T156: the house profile KEEPS a seeded member cookie across harnesses — drop it at the browser
 *  level (httpOnly or not) before the signed-out legs, and again at the end. */
const dropMemberCookie = () =>
  send("Network.deleteCookies", { name: "wixSession", url: `${APP}/` }).catch(() => {});

// --- CLEANUP of the created row ------------------------------------------------------------------
let createdId = null;
let cleanupNote = "no row created";
/** SYNCHRONOUS delete over curl with the member cookie — the only kind that completes inside an
 *  uncaughtException handler before verify-cdp-cleanup's finishVerify exits the process. */
const syncDeleteCreated = (why) => {
  if (!createdId || !cookieVal) return;
  const r = spawnSync(
    "curl",
    ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", "DELETE", "-H", "Content-Type: application/json", "-H", `Cookie: wixSession=${cookieVal}`, `${APP}/api/facades?id=${encodeURIComponent(createdId)}`],
    { timeout: 20_000, encoding: "utf8" },
  );
  const code = (r.stdout ?? "").trim();
  console.error(`cleanup (${why}): DELETE ${createdId} → ${code || r.error?.message || "no answer"}`);
  if (code === "200" || code === "404") createdId = null;
};
// PREPENDED so they run before the cleanup module's own handlers (which exit once the targets close).
process.prependListener("uncaughtException", () => syncDeleteCreated("uncaughtException"));
process.prependListener("unhandledRejection", () => syncDeleteCreated("unhandledRejection"));
process.on("SIGINT", () => {
  syncDeleteCreated("SIGINT");
  void finishVerify(130);
});

// --- the leg runner ------------------------------------------------------------------------------
const results = [];
let aborted = null;
let saveAborted = SKIP_SAVE ? "FTW_FF_SKIP_SAVE=1" : null;
const runLeg = async (id, name, fn, { always = false, save = false } = {}) => {
  if (save && SKIP_SAVE) {
    results.push({ id, name, pass: true, skip: true, detail: "skipped — FTW_FF_SKIP_SAVE=1" });
    console.log(`SKIP [${id}] ${name} — FTW_FF_SKIP_SAVE=1`);
    return null;
  }
  const why = (!always && aborted) || (save && saveAborted);
  if (why) {
    results.push({ id, name, pass: false, detail: `skipped — ${why}` });
    console.log(`FAIL [${id}] ${name} — skipped (${why})`);
    return false;
  }
  let pass = false;
  let detail = "";
  try {
    const r = await fn();
    pass = !!r.pass;
    detail = r.detail ?? "";
  } catch (e) {
    detail = `threw: ${e?.message ?? e}`;
  }
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${name}${detail ? ` — ${detail}` : ""}`);
  return pass;
};
const fmtFails = (fails, rest) => (fails.length ? fails.join(" · ") + " || " : "") + rest;

const BOOTED = `!!(window.__globe && window.__globe.camera && window.__globe.facadeFrustum && typeof window.__globe.photoProjector === "function" && typeof window.__globe.facadeGizmo === "function" && typeof window.__globe.facades === "function" && window.__facadeStore && window.__facadeSaveStore && window.__facadesStore && window.__editJournalStore && window.__editJournal && window.__uploadStore && window.__memberStore)`;
const boot = async () => {
  const t0 = Date.now();
  const up = await waitFor(BOOTED, 90_000);
  if (!up.ok) return { ok: false, ms: Date.now() - t0 };
  await sleep(3000); // first tile wave
  await evalJs(
    "(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true",
  );
  await sleep(500);
  await evalJs("window.__globe.smoothFlights ? window.__globe.smoothFlights(false) : null");
  await send("Page.bringToFront").catch(() => {});
  return { ok: true, ms: Date.now() - t0 };
};
const navigate = async () => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: URL });
};
// T181 (2026-10-22): the `?facade` nav link is gone — the facade overlay's IDLE body (MY FACADES +
// the sign-in note) opens through the store seam; the PRODUCT entry is the Upload dropzone's lower
// half (`feedFacadeFixture` below).
const openOverlay = async () => {
  if (await evalJs(`!!document.querySelector(".uf.ff") && ${FS}.open === true`)) return true;
  await evalJs(`${FS}.openPanel(), true`);
  return (await waitFor(`!!document.querySelector(".uf.ff") && ${FS}.open === true`, 8000, 120)).ok;
};
/** The product path (T181): Upload → the split dropzone's FACADE half → the fixture on ITS file
 *  input → the Upload overlay closes, the facade overlay opens with the store decoding. */
const feedFacadeFixture = async () => {
  // A facade overlay left open (leg 2's idle body) would sit over the Upload one — close it.
  if (await evalJs(`${FS}.open === true`)) await evalJs(`${FS}.closePanel(), true`);
  await evalJs(`document.querySelector("[data-open-upload]")?.click(), true`);
  const half = await waitFor(`!!document.querySelector(".uf-dropzone--facade input[type=file]")`, 8000, 120);
  if (!half.ok) return { ok: false, detail: "no .uf-dropzone--facade input[type=file] — the split dropzone did not render" };
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".uf-dropzone--facade input[type=file]" });
  if (!nodeId) return { ok: false, detail: "DOM.querySelector found no facade file input node" };
  await send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
  const opened = await waitFor(`!!document.querySelector(".uf.ff") && ${FS}.open === true && !document.querySelector(".uf:not(.ff)")`, 8000, 120);
  if (!opened.ok) return { ok: false, detail: `the facade overlay did not take over from Upload (${JSON.stringify(opened.value)})` };
  return { ok: true, detail: "Upload → the facade half → .uf.ff open" };
};
const listMineServer = async () => {
  const r = await pageApi("/api/facades");
  return r.status === 200 ? (r.body?.facades ?? []) : null;
};

await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");
await send("Log.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await dropMemberCookie(); // T156 — the signed-out legs run first, on a cookie-free profile
await navigate();
console.log(`page ${URL} · CDP :${PORT} · fixture ${FIXTURE}${SKIP_SAVE ? " · FTW_FF_SKIP_SAVE=1 (legs 1, 2, 4–9, 15)" : ""}`);
console.log(`expected baseline hFov ${H_FOV.toFixed(4)}°`);

let row = null; // the saved FacadeListItem (leg 10 →)

try {
  // ═══ 1 · BOOT ═════════════════════════════════════════════════════════════════════════════════
  const bootOk = await runLeg(1, "boot + the desktop attach gate", async () => {
    const b = await boot();
    if (!b.ok) return { pass: false, detail: "the globe + facade seams never booted (90 s) — one of __globe.facadeGizmo / facades / __facadeSaveStore / __facadesStore / __editJournal(Store) is missing" };
    const s = await snapshot();
    const gz = await evalJs(`(() => { const g = ${GZ}; return g ? { attached: g.attached, op: g.op } : null; })()`);
    const fac = await evalJs("(() => { const f = window.__globe.facades(); return { markers: f.markers, resident: f.resident, world: f.world }; })()");
    const fails = [];
    if (!s || typeof s !== "object") fails.push(`photoProjector() ${JSON.stringify(s)} — the hqAllowed attach gate refused on a desktop run`);
    else {
      if (s.capacity !== 4) fails.push(`capacity ${s.capacity} ≠ 4`);
      if (s.on !== false) fails.push(`draft on=${s.on} before any photo`);
      if (s.slotsOn !== 0) fails.push(`slotsOn ${s.slotsOn} ≠ 0 at boot`);
    }
    if (!gz) fails.push("facadeGizmo() is null (the attach gate refused the gizmo)");
    else if (gz.attached) fails.push("the gizmo is attached with no photo");
    return {
      pass: fails.length === 0,
      detail: fmtFails(fails, `booted in ${b.ms} ms · capacity ${s?.capacity} · slotsOn ${s?.slotsOn} · gizmo ${JSON.stringify(gz)} · facades ${JSON.stringify(fac)}`),
    };
  });
  if (!bootOk) aborted = "boot failed";

  // ═══ 2 · SIGNED-OUT GUARD ═════════════════════════════════════════════════════════════════════
  await runLeg(2, "signed-out: GET /api/facades → 401 + the overlay's sign-in note", async () => {
    const fails = [];
    const anon = await waitFor(`window.__memberStore.getState().phase === "anonymous"`, 15_000, 300);
    if (!anon.ok) fails.push(`member phase ${await evalJs("window.__memberStore.getState().phase")} (a seeded cookie survived — T156)`);
    const r = await pageApi("/api/facades");
    if (r.status !== 401 || r.body?.error !== "SIGNED_OUT") fails.push(`GET /api/facades → ${r.status} ${JSON.stringify(r.body)}`);
    const w = await pageApi("/api/facades?cells=ubcu4");
    if (w.status !== 401) fails.push(`GET ?cells= → ${w.status}`);
    const d = await pageApi("/api/facades?id=bogus", { method: "DELETE", headers: { "Content-Type": "application/json" } });
    if (d.status !== 401) fails.push(`DELETE signed out → ${d.status}`);
    const opened = await openOverlay();
    if (!opened) fails.push("the overlay never opened (openPanel → .uf.ff)");
    // Rendered text, not a property: the note is the MY FACADES body while anonymous (FacadePhotoFlow).
    const note = opened
      ? await waitFor(`(() => { const el = document.querySelector(".uf.ff"); const t = el ? el.innerText : ""; return /SIGN IN TO SEE YOUR FACADE PHOTOS/i.test(t) ? t.length : 0; })()`, 5000, 200)
      : { ok: false };
    if (!note.ok) fails.push("no 'SIGN IN TO SEE YOUR FACADE PHOTOS' in the overlay's rendered text");
    await shot("01-signed-out.jpeg");
    return { pass: fails.length === 0, detail: fmtFails(fails, `GET ${r.status} ${r.body?.error} · cells ${w.status} · DELETE ${d.status} · sign-in note ${note.ok ? "rendered" : "absent"}`) };
  });

  // ═══ 3 · MEMBER SESSION ═══════════════════════════════════════════════════════════════════════
  const memberOk = await runLeg(
    3,
    "member session minted + the page reads it",
    async () => {
      const role = await mintMember();
      await evalJs(`document.cookie = "wixSession=${cookieVal}; path=/; max-age=10800", true`);
      await navigate();
      const b = await boot();
      if (!b.ok) return { pass: false, detail: "the reload never re-booted the seams" };
      const m = await waitFor(`window.__memberStore.getState().phase === "member"`, 15_000, 400);
      if (!m.ok) return { pass: false, detail: `member phase ${await evalJs("window.__memberStore.getState().phase")} after the cookie + reload` };
      // A stale row from an aborted earlier run is deleted here (never leave a "harness facade" behind).
      const mine = (await listMineServer()) ?? [];
      const stale = mine.filter((f) => f.title === TITLE);
      for (const f of stale) await pageApi(`/api/facades?id=${encodeURIComponent(f.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
      return { pass: true, detail: `role ${role} · member phase in ${b.ms} ms boot · ${mine.length} own facade(s) · ${stale.length} stale "${TITLE}" row(s) deleted` };
    },
    { save: true },
  );
  if (memberOk === false) saveAborted = "no member session";

  // ═══ 4 · FIXTURE → REVIEW → PLACE ═════════════════════════════════════════════════════════════
  const placedOk = await runLeg(4, "the fixture → review → place → apex seated + the draft slot on", async () => {
    const fails = [];
    const fed = await feedFacadeFixture();
    if (!fed.ok) return { pass: false, detail: fed.detail };
    const rv = await waitFor(`${FS}.phase === "review"`, 15_000, 200);
    if (!rv.ok) return { pass: false, detail: `phase never reached review (${await evalJs(`${FS}.phase`)})` };
    await evalJs(`${FS}.place(), true`);
    const tPlace = Date.now();
    const w = await waitFor(`${FS}.phase === "placed" && ${FS}.open === false`, 5000, 100);
    if (!w.ok) return { pass: false, detail: `place() did not reach placed/closed (phase ${await evalJs(`${FS}.phase`)})` };
    const apex = await waitFor(`(() => { const a = ${FS}.apexAltM; return typeof a === "number" && Number.isFinite(a) ? a : 0; })()`, 3000, 50);
    const apexMs = Date.now() - tPlace;
    if (!apex.ok) fails.push(`apexAltM not finite within 3 s (${await evalJs(`${FS}.apexAltM`)})`);
    await sleep(FLIGHT_SETTLE_MS);
    const sw = await waitFor(`(() => { const s = ${SNAP}; return !!s && s.on === true && s.textureReady === true && s.depthRenders >= 1; })()`, 5000, 100);
    const s = await snapshot();
    if (!sw.ok) fails.push(`the draft slot never went on+textureReady+depthRendered (${JSON.stringify({ on: s?.on, tex: s?.textureReady, depth: s?.depthRenders })})`);
    if (s?.slotsOn !== 1) fails.push(`slotsOn ${s?.slotsOn} ≠ 1`);
    const draft = (s?.slots ?? []).find((x) => x.id === "draft");
    if (!draft || draft.on !== true) fails.push(`no slots[] entry "draft" on (${JSON.stringify((s?.slots ?? []).map((x) => [x.id, x.on]))})`);
    const hts = await evalJs("window.__globe.facadeFrustum.apexHeights ? window.__globe.facadeFrustum.apexHeights() : null");
    const st = await facadeState();
    if (hts && !near(hts.apexAltM, st.apexAltM, 0.05)) fails.push(`store apexAltM ${r2(st.apexAltM)} ≠ the frustum's ${r2(hts.apexAltM)}`);
    await shot("02-placed.jpeg");
    return {
      pass: fails.length === 0,
      detail: fmtFails(fails, `apexAltM ${r2(st.apexAltM)} m (${r2(st.apexAboveGroundM)} m above ground) in ${apexMs} ms · draft on ${s?.on} tex ${s?.textureReady} depth ×${s?.depthRenders} · slotsOn ${s?.slotsOn}/${s?.capacity}`),
    };
  });
  if (!placedOk) aborted = aborted ?? "the facade never placed";

  // ═══ 5 · THE H-FOV OVERRIDE ═══════════════════════════════════════════════════════════════════
  await runLeg(5, "setHFovDeg(50) narrows the far face by the tan ratio; undefined restores it", async () => {
    const g0 = await geomNow();
    if (!g0) return { pass: false, detail: "no frustum" };
    const o0 = opticsOf(g0);
    await evalJs(`${FS}.setHFovDeg(50), true`);
    await waitFor(`(() => { const g = window.__globe.facadeFrustum.current(); if (!g) return false; const c = g.corners; const w = Math.hypot(c[0][0]-c[1][0], c[0][1]-c[1][1], c[0][2]-c[1][2]); return Math.abs(w - ${o0.widthM}) > 1e-6; })()`, 2000, 50);
    await ticks(2);
    const o1 = opticsOf(await geomNow());
    const want = Math.tan(25 * D2R) / o0.tanH;
    const got = o1.tanH / o0.tanH;
    await evalJs(`${FS}.setHFovDeg(undefined), true`);
    await waitFor(`(() => { const g = window.__globe.facadeFrustum.current(); if (!g) return false; const c = g.corners; const w = Math.hypot(c[0][0]-c[1][0], c[0][1]-c[1][1], c[0][2]-c[1][2]); return Math.abs(w - ${o1.widthM}) > 1e-6; })()`, 2000, 50);
    await ticks(2);
    const o2 = opticsOf(await geomNow());
    const fails = [];
    if (!near(got, want, 1e-6)) fails.push(`tan ratio ${r6(got)} ≠ ${r6(want)}`);
    if (!near(o1.hFovDeg, 50, 1e-6)) fails.push(`measured hFov ${r6(o1.hFovDeg)}° ≠ 50°`);
    if (!near(o1.aspect, o0.aspect, 1e-6)) fails.push(`aspect ${r6(o1.aspect)} ≠ ${r6(o0.aspect)} (a stretch)`);
    if (!near(o2.hFovDeg, o0.hFovDeg, 1e-6)) fails.push(`restore ${r6(o2.hFovDeg)}° ≠ ${r6(o0.hFovDeg)}°`);
    if (!near(o0.hFovDeg, H_FOV, 0.05)) fails.push(`baseline ${r6(o0.hFovDeg)}° ≠ EXIF ${r6(H_FOV)}°`);
    return {
      pass: fails.length === 0,
      detail: fmtFails(fails, `hFov ${r6(o0.hFovDeg)}° → ${r6(o1.hFovDeg)}° → ${r6(o2.hFovDeg)}° · width ${r2(o0.widthM)} → ${r2(o1.widthM)} m (plane d ${r2(o0.d)} → ${r2(o1.d)} m) · tan ratio ${r6(got)} vs ${r6(want)}`),
    };
  });

  // ═══ 6 · GIZMO · MOVE ═════════════════════════════════════════════════════════════════════════
  let preMove = null;
  let moveEntries = null;
  await runLeg(6, "GIZMO MOVE — the X handle drags the photo east; the camera stays", async () => {
    const fails = [];
    await frameGizmo();
    const at = await setOp("move");
    if (!at.ok) return { pass: false, detail: `setGizmoOp("move") → not attached within 1 s (${JSON.stringify(await evalJs(`${GZ} && { attached: ${GZ}.attached, op: ${GZ}.op }`))})` };
    await ticks(3);
    const h = await handleDir("X");
    if (h.error) return { pass: false, detail: h.error };
    preMove = await facadeState();
    const g0 = await geomNow();
    const n0 = await journalLen();
    let mid = null;
    const dr = await dragFrom(h.hp, h.ux, h.uy, 120, 8, async () => {
      mid = await evalJs(`(() => { const g = ${GZ}; return { dragging: g.dragging, axis: g.axis, dragId: g.dragId }; })()`);
    });
    await sleep(200);
    const after = await evalJs(`(() => { const g = ${GZ}; return { dragging: g.dragging, attached: g.attached }; })()`);
    const st = await facadeState();
    const g1 = await geomNow();
    const n1 = await journalLen();
    const last = await journalLast();
    moveEntries = n1;
    await shot("03-gizmo-move.jpeg");
    const dLon = st.placement.lonDeg - preMove.placement.lonDeg;
    const eastM = dot3(sub3(g1.apex, g0.apex), eastAt(FIX.lon));
    // The handle's own side decides the sign (the +X arrow drags east, the −X arrow west).
    const want = h.eastSign > 0 ? "east" : "west";
    if (!(Math.sign(dLon) === h.eastSign)) fails.push(`placement lon Δ ${dLon.toExponential(3)}° (not ${want} — the ${h.eastSign > 0 ? "+" : "−"}X side was pressed)`);
    // > 1 m: at the 66 m frame pose a 120 px drag is ~5 m raw × gain 0.5 ≈ 2.7 m (browser-measured 2026-10-22b);
    // the first run's 46 m rode a camera the landing corrector had yanked back to the 1 km arrival pose
    // before the drag (fixed the same day — the RADIAL lift test), so the old 5 m bar was calibrated on that.
    if (!(Math.sign(eastM) === h.eastSign && Math.abs(eastM) > 1)) fails.push(`apex east Δ ${eastM.toFixed(3)} m (want ${want}, > 1 m)`);
    if (!(dr.camMovedM < 1)) fails.push(`the camera moved ${dr.camMovedM.toFixed(3)} m during the drag (the orbit took it)`);
    if (!mid || mid.dragging !== true) fails.push(`mid-drag dragging=${mid?.dragging} (axis ${mid?.axis})`);
    if (after.dragging !== false) fails.push("still dragging after the release");
    if (n1 !== n0 + 1) fails.push(`journal entries ${n0} → ${n1} (want +1)`);
    if (last?.label !== "move") fails.push(`last entry label ${JSON.stringify(last?.label)} ≠ "move"`);
    return {
      pass: fails.length === 0,
      detail: fmtFails(fails, `handle X (${Math.round(h.lenPx)} px from origin, dir ${h.ux.toFixed(2)},${h.uy.toFixed(2)}, the ${h.eastSign > 0 ? "+" : "−"}X side) +120 px · lon Δ ${dLon.toExponential(3)}° · apex east ${eastM.toFixed(2)} m (total ${dist3(g0.apex, g1.apex).toFixed(2)} m) · cam ${dr.camMovedM.toFixed(3)} m · mid ${JSON.stringify(mid)} · journal ${n0}→${n1} ${JSON.stringify(last)}`),
    };
  });

  // ═══ 7 · UNDO ═════════════════════════════════════════════════════════════════════════════════
  await runLeg(7, "UNDO restores the pre-drag placement exactly", async () => {
    if (!preMove || moveEntries === null) return { pass: false, detail: "no move to undo (leg 6 did not drag)" };
    const n0 = await journalLen();
    const btn = await evalJs(`(() => { const b = document.querySelector("[data-facade-undo]"); if (!b) return "absent"; if (b.disabled) return "disabled"; b.click(); return "clicked"; })()`);
    if (btn !== "clicked") await evalJs(`window.__editJournalStore.getState().requestUndo("facade"), true`);
    const w = await waitFor(`Math.abs(${FS}.placement.lonDeg - ${preMove.placement.lonDeg}) <= 1e-9 && Math.abs(${FS}.placement.latDeg - ${preMove.placement.latDeg}) <= 1e-9`, 2000, 50);
    const st = await facadeState();
    const n1 = await journalLen();
    const fails = [];
    if (!w.ok) fails.push(`placement ${JSON.stringify(st.placement)} ≠ pre-drag ${JSON.stringify(preMove.placement)}`);
    if (n1 !== n0 - 1) fails.push(`journal entries ${n0} → ${n1} (want −1)`);
    if (btn !== "clicked") fails.push(`[data-facade-undo] ${btn} — fell back to requestUndo("facade")`);
    return {
      pass: fails.length === 0,
      detail: fmtFails(fails, `undo via ${btn === "clicked" ? "the panel button" : "requestUndo"} · lon err ${Math.abs(st.placement.lonDeg - preMove.placement.lonDeg).toExponential(2)}° · journal ${n0}→${n1}`),
    };
  });

  // ═══ 8 · GIZMO · ROTATE ═══════════════════════════════════════════════════════════════════════
  await runLeg(8, "GIZMO ROTATE — a Y-ring drag turns the heading only, about the local up", async () => {
    const fails = [];
    await frameGizmo();
    const at = await setOp("rotate");
    if (!at.ok) return { pass: false, detail: `setGizmoOp("rotate") → not attached within 1 s` };
    await ticks(3);
    // A point the controls themselves attribute to the Y ring (the rings overlap on screen — the
    // lowest Y point sat on the X ring in the first run, 2026-10-22); the drag runs along the
    // ring's screen tangent there (the neighbours' chord).
    const rp = await ringPointFor("Y", 36);
    if (!rp) return { pass: false, detail: "no Y-ring point whose hover reads axis Y (36 candidates)" };
    const { tx, ty } = rp;
    const best = rp.i;
    const ring = { length: rp.n, [best]: rp.p };
    const s0 = await facadeState();
    const g0 = await geomNow();
    const n0 = await journalLen();
    const dr = await dragFrom(rp.p, tx, ty, 80, 8);
    await sleep(200);
    const s1 = await facadeState();
    const g1 = await geomNow();
    const n1 = await journalLen();
    const last = await journalLast();
    await shot("04-gizmo-rotate.jpeg");
    const h0 = s0.pose?.headingDeg ?? s0.params.headingDeg;
    const h1 = s1.pose?.headingDeg ?? s1.params.headingDeg;
    const dH = typeof h0 === "number" && typeof h1 === "number" ? ((h1 - h0 + 540) % 360) - 180 : NaN;
    if (!(Math.abs(dH) > 0.05)) fails.push(`heading Δ ${dH}° (no rotation)`);
    if (!sameOpt(s0.params.pitchDeg, s1.params.pitchDeg, 1e-6)) fails.push(`pitch ${s0.params.pitchDeg} → ${s1.params.pitchDeg}`);
    if (!sameOpt(s0.rollDeg, s1.rollDeg, 1e-6)) fails.push(`roll ${s0.rollDeg} → ${s1.rollDeg}`);
    const U = normalAt(s1.placement.latDeg, s1.placement.lonDeg);
    const fdot = dot3(g0.forward, g1.forward);
    const elev0 = dot3(g0.forward, U);
    const elev1 = dot3(g1.forward, U);
    if (!(fdot < 0.9999)) fails.push(`forward barely turned (dot ${fdot.toFixed(6)})`);
    if (!(Math.abs(elev0 - elev1) < 1e-3)) fails.push(`forward·up ${elev0.toFixed(5)} → ${elev1.toFixed(5)} (not a rotation about the local up)`);
    if (!(dr.camMovedM < 1)) fails.push(`the camera moved ${dr.camMovedM.toFixed(3)} m`);
    if (n1 !== n0 + 1 || last?.label !== "rotate") fails.push(`journal ${n0}→${n1} last ${JSON.stringify(last?.label)} (want +1 "rotate")`);
    return {
      pass: fails.length === 0,
      detail: fmtFails(fails, `ring pt ${best}/${ring.length} (${Math.round(ring[best].x)},${Math.round(ring[best].y)}) tangent ${tx.toFixed(2)},${ty.toFixed(2)} 80 px · heading ${r2(h0)}° → ${r2(h1)}° (Δ ${r2(dH)}°) · fwd dot ${fdot.toFixed(6)} · fwd·up ${elev0.toFixed(5)}/${elev1.toFixed(5)} · cam ${dr.camMovedM.toFixed(3)} m`),
    };
  });

  // ═══ 9 · GIZMO · SCALE ════════════════════════════════════════════════════════════════════════
  await runLeg(9, "GIZMO SCALE — the centre box widens the H-FOV, never a stretch", async () => {
    const fails = [];
    await frameGizmo();
    const at = await setOp("scale");
    if (!at.ok) return { pass: false, detail: `setGizmoOp("scale") → not attached within 1 s` };
    await ticks(3);
    // three hides the XYZ scale picker in this configuration (browser-read 2026-10-22: the scale
    // picker group's XY / YZ / XZ / XYZ meshes are invisible) — and every scale box is UNIFORM in
    // the facade module anyway (never a stretch), so the X box is the handle: press on it and drag
    // OUTWARD (away from the origin) — a bigger ratio = a wider field of view.
    const h = await handleDir("X");
    if (h.error) return { pass: false, detail: h.error };
    const hp = h.centre;
    const o = h.o;
    const ux = h.ux;
    const uy = h.uy;
    const len = h.lenPx;
    const from = { x: hp.x + ux * 4, y: hp.y + uy * 4 };
    const s0 = await facadeState();
    const o0 = opticsOf(await geomNow());
    const n0 = await journalLen();
    const dr = await dragFrom(from, ux, uy, 60, 6);
    await sleep(200);
    const s1 = await facadeState();
    const o1 = opticsOf(await geomNow());
    const n1 = await journalLen();
    const last = await journalLast();
    await shot("05-gizmo-scale.jpeg");
    const eff0 = s0.hFovDeg ?? o0.hFovDeg;
    if (typeof s1.hFovDeg !== "number") fails.push(`hFovDeg override not set (${s1.hFovDeg})`);
    else if (!(s1.hFovDeg > eff0)) fails.push(`hFovDeg ${r6(s1.hFovDeg)}° not wider than ${r6(eff0)}°`);
    if (!(o1.widthM > o0.widthM && o1.tanH > o0.tanH)) fails.push(`far face ${r2(o0.widthM)} → ${r2(o1.widthM)} m (tan ${r6(o0.tanH)} → ${r6(o1.tanH)}) not wider`);
    if (!near(o1.aspect, o0.aspect, 1e-6)) fails.push(`aspect ${r6(o0.aspect)} → ${r6(o1.aspect)} — a STRETCH`);
    if (typeof s1.hFovDeg === "number" && !near(o1.hFovDeg, s1.hFovDeg, 1e-6)) fails.push(`frustum ${r6(o1.hFovDeg)}° ≠ the override ${r6(s1.hFovDeg)}°`);
    if (!(dr.camMovedM < 1)) fails.push(`the camera moved ${dr.camMovedM.toFixed(3)} m`);
    if (n1 !== n0 + 1 || last?.label !== "scale") fails.push(`journal ${n0}→${n1} last ${JSON.stringify(last?.label)} (want +1 "scale")`);
    await setOp("none");
    return {
      pass: fails.length === 0,
      detail: fmtFails(fails, `X box ${Math.round(len)} px off the origin (${Math.round(hp.x)},${Math.round(hp.y)}; origin ${Math.round(o.x)},${Math.round(o.y)}) dragged outward 60 px · hFov ${r6(eff0)}° → ${r6(s1.hFovDeg)}° · width ${r2(o0.widthM)} → ${r2(o1.widthM)} m · aspect ${r6(o0.aspect)} → ${r6(o1.aspect)} · cam ${dr.camMovedM.toFixed(3)} m`),
    };
  });

  // ═══ 10 · SAVE ════════════════════════════════════════════════════════════════════════════════
  const saveOk = await runLeg(
    10,
    "SAVE — the phase walk to saved, wixstatic URLs, the row = the store",
    async () => {
      const fails = [];
      await evalJs(`${SS}.setTitle(${JSON.stringify(TITLE)}), true`);
      const before = await facadeState();
      const oSave = opticsOf(await geomNow());
      const t0 = Date.now();
      await evalJs(`${SS}.saveFacade(), true`); // not awaited in-page: the walk is polled from here
      const walk = [];
      let last = null;
      let st = null;
      while (Date.now() - t0 < 60_000) {
        st = await evalJs(`(() => { const s = ${SS}; return { phase: s.phase, error: s.error ?? null, errorCode: s.errorCode ?? null, warning: s.warning ?? null, facadeId: s.facadeId ?? null }; })()`);
        if (st.phase !== last) {
          walk.push(`${st.phase}@${Date.now() - t0}ms`);
          last = st.phase;
        }
        if (st.phase === "saved" || st.phase === "error") break;
        await sleep(100);
      }
      console.log(`      save walk: ${walk.join(" → ")}`);
      if (st.facadeId) {
        createdId = st.facadeId;
        cleanupNote = `row ${createdId} created`;
      }
      if (st.phase !== "saved") return { pass: false, detail: `phase ${st.phase} after ${Date.now() - t0} ms · ${st.errorCode}: ${st.error} · walk ${walk.join(" → ")}` };
      if (st.warning) console.log(`      save warning (degraded): ${st.warning}`);
      const fsNow = await facadeState();
      if (fsNow.savedFacadeId !== st.facadeId) fails.push(`savedFacadeId ${fsNow.savedFacadeId} ≠ ${st.facadeId}`);
      const inMine = await waitFor(`(() => { const r = ${MS}.mine.find((m) => m.id === ${JSON.stringify(st.facadeId)}); return r ? JSON.parse(JSON.stringify(r)) : null; })()`, 5000, 200);
      row = inMine.ok ? inMine.value : null;
      if (!row) return { pass: false, detail: fmtFails(fails, `the saved id is not in __facadesStore.mine · walk ${walk.join(" → ")}`) };
      if (!String(row.displayUrl ?? "").startsWith("https://static.wixstatic.com/")) fails.push(`displayUrl ${row.displayUrl}`);
      const thumbOk = String(row.thumbUrl ?? "").startsWith("https://");
      if (!thumbOk) console.log(`      thumb DEGRADED: thumbUrl ${row.thumbUrl} (warning ${st.warning})`);
      if (!near(row.hFovDeg, oSave.hFovDeg, 1e-6)) fails.push(`row hFov ${r6(row.hFovDeg)}° ≠ the effective ${r6(oSave.hFovDeg)}°`);
      if (!near(row.apexAltM, before.apexAltM, 0.01)) fails.push(`row apexAltM ${row.apexAltM} ≠ the store's ${before.apexAltM}`);
      if (!near(row.lat, before.placement.latDeg, 1e-9) || !near(row.lon, before.placement.lonDeg, 1e-9)) fails.push(`row ${row.lat},${row.lon} ≠ placement`);
      if (row.title !== TITLE) fails.push(`title ${JSON.stringify(row.title)}`);
      const server = await listMineServer();
      if (!server || !server.some((f) => f.id === st.facadeId)) fails.push(`GET /api/facades does not list ${st.facadeId} yet (read lag?)`);
      await shot("06-saved.jpeg");
      return {
        pass: fails.length === 0,
        detail: fmtFails(fails, `id ${st.facadeId} in ${Date.now() - t0} ms · walk ${walk.join(" → ")} · display ${String(row.displayUrl).slice(0, 48)}… · thumb ${thumbOk ? "ok" : "DEGRADED"} · hFov ${r6(row.hFovDeg)}° · apex ${r2(row.apexAltM)} m${st.warning ? ` · warning "${st.warning}"` : ""}`),
      };
    },
    { save: true },
  );
  if (saveOk === false && !row) saveAborted = saveAborted ?? "the save did not land a row";

  // ═══ 11 · RE-OPEN ═════════════════════════════════════════════════════════════════════════════
  await runLeg(
    11,
    "RE-OPEN — clear(), then the MY FACADES row reproduces the saved photo",
    async () => {
      const fails = [];
      await evalJs(`${FS}.clear(), true`);
      const idle = await waitFor(`(() => { const s = ${SNAP}; return ${FS}.phase === "idle" && !!s && s.on === false; })()`, 3000, 100);
      if (!idle.ok) fails.push(`clear() → phase ${await evalJs(`${FS}.phase`)}, draft on ${(await snapshot())?.on}`);
      if (!(await openOverlay())) return { pass: false, detail: fmtFails(fails, "the overlay never opened") };
      const sel = `[data-facade-row="${row.id}"]`;
      let rowEl = await waitFor(`!!document.querySelector(${JSON.stringify(sel)})`, 8000, 200);
      if (!rowEl.ok) {
        await evalJs(`${MS}.loadMine(), true`);
        rowEl = await waitFor(`!!document.querySelector(${JSON.stringify(sel)})`, 8000, 200);
      }
      await shot("07-my-facades.jpeg");
      if (rowEl.ok) await evalJs(`document.querySelector(${JSON.stringify(sel)}).click(), true`);
      else {
        fails.push(`no ${sel} in the overlay — fell back to openSaved(item)`);
        await evalJs(`(() => { const r = ${MS}.mine.find((m) => m.id === ${JSON.stringify(row.id)}); ${FS}.openSaved(r); return true; })()`);
      }
      const placed = await waitFor(`${FS}.phase === "placed" && ${FS}.savedFacadeId === ${JSON.stringify(row.id)}`, 5000, 100);
      if (!placed.ok) return { pass: false, detail: fmtFails(fails, `phase ${await evalJs(`${FS}.phase`)} savedFacadeId ${await evalJs(`${FS}.savedFacadeId`)}`) };
      await sleep(FLIGHT_SETTLE_MS);
      const sw = await waitFor(`(() => { const s = ${SNAP}; return !!s && s.on === true && s.textureReady === true; })()`, 8000, 100);
      const st = await facadeState();
      const o = opticsOf(await geomNow());
      const fac = await evalJs("(() => { const f = window.__globe.facades(); return { editingId: f.editingId, resident: f.resident }; })()");
      if (!near(st.placement.latDeg, row.lat, 1e-9) || !near(st.placement.lonDeg, row.lon, 1e-9)) fails.push(`placement ${JSON.stringify(st.placement)} ≠ the row ${row.lat},${row.lon}`);
      if (!near(o.hFovDeg, row.hFovDeg, 1e-6)) fails.push(`frustum hFov ${r6(o.hFovDeg)}° ≠ the saved ${r6(row.hFovDeg)}°`);
      if (st.previewUrl !== row.displayUrl) fails.push(`previewUrl ${st.previewUrl} ≠ displayUrl`);
      if (!sw.ok) fails.push("the draft slot never went on + textureReady");
      if (fac.editingId !== row.id) fails.push(`facades().editingId ${fac.editingId} ≠ ${row.id}`);
      if (fac.resident.includes(row.id)) fails.push("the row under edit is ALSO resident (a double projection)");
      await shot("08-reopened.jpeg");
      return {
        pass: fails.length === 0,
        detail: fmtFails(fails, `via ${rowEl.ok ? "the row click" : "openSaved"} · placement ${st.placement.latDeg},${st.placement.lonDeg} · hFov ${r6(o.hFovDeg)}° (saved ${r6(row.hFovDeg)}°) · editingId ${fac.editingId} · apex ${r2(st.apexAltM)} m`),
      };
    },
    { save: true },
  );

  // ═══ 12 · EDIT → UPDATE ═══════════════════════════════════════════════════════════════════════
  await runLeg(
    12,
    "EDIT → UPDATE — a short move drag, updateFacade(), the server's copy moves",
    async () => {
      const fails = [];
      await frameGizmo();
      const at = await setOp("move");
      if (!at.ok) return { pass: false, detail: "setGizmoOp(\"move\") → not attached" };
      await ticks(3);
      const h = await handleDir("X");
      if (h.error) return { pass: false, detail: h.error };
      const lon0 = (await facadeState()).placement.lonDeg;
      await dragFrom(h.hp, h.ux, h.uy, 40, 5);
      await setOp("none");
      const lon1 = (await facadeState()).placement.lonDeg;
      if (!(lon1 > lon0)) fails.push(`the +40 px drag did not move east (lon Δ ${(lon1 - lon0).toExponential(3)})`);
      const t0 = Date.now();
      await evalJs(`${SS}.updateFacade(), true`);
      const up = await waitFor(`(() => { const p = ${SS}.phase; return p === "updated" || p === "error" ? p : 0; })()`, 30_000, 150);
      const ph = await evalJs(`(() => { const s = ${SS}; return { phase: s.phase, error: s.error ?? null, errorCode: s.errorCode ?? null }; })()`);
      if (ph.phase !== "updated") return { pass: false, detail: fmtFails(fails, `update → ${ph.phase} ${ph.errorCode}: ${ph.error}`) };
      const ms = Date.now() - t0;
      const local = await evalJs(`(() => { const r = ${MS}.mine.find((m) => m.id === ${JSON.stringify(row.id)}); return r ? r.lon : null; })()`);
      if (!near(local, lon1, 1e-9)) fails.push(`mine's lon ${local} ≠ the store ${lon1}`);
      // The server's copy is the truth — poll past the Wix Data read lag (~1 s).
      let srv = null;
      for (let i = 0; i < 12; i++) {
        const list = await listMineServer();
        srv = list?.find((f) => f.id === row.id) ?? null;
        if (srv && near(srv.lon, lon1, 1e-9)) break;
        await sleep(800);
      }
      if (!srv || !near(srv.lon, lon1, 1e-9)) fails.push(`GET /api/facades lon ${srv?.lon} ≠ ${lon1}`);
      if (srv && near(srv.lon, row.lon, 1e-12)) fails.push("the server still holds the saved lon");
      if (srv) row = srv;
      return { pass: fails.length === 0 && up.ok, detail: fmtFails(fails, `lon ${lon0} → ${lon1} · updated in ${ms} ms · server lon ${srv?.lon}`) };
    },
    { save: true },
  );

  // ═══ 13 · RESIDENCY ═══════════════════════════════════════════════════════════════════════════
  await runLeg(
    13,
    "RESIDENCY — the saved row projects from the world, by pixels",
    async () => {
      const fails = [];
      await evalJs(`${FS}.clear(), true`);
      await waitFor(`${FS}.phase === "idle" && window.__globe.facades().editingId === null`, 3000, 100);
      const fresh = await evalJs(`(() => { const r = ${MS}.mine.find((m) => m.id === ${JSON.stringify(row.id)}); return r ? JSON.parse(JSON.stringify(r)) : null; })()`);
      if (fresh) row = fresh;
      // The apex the markers placed (the world's own read); else the row's geodetic apex.
      let apex = await waitFor(`(() => { const a = window.__globe.facades().apexOf(${JSON.stringify(row.id)}); return a ? [...a] : null; })()`, 8000, 200);
      const apexXyz = apex.ok ? apex.value : ecef(row.lat, row.lon, row.apexAltM);
      if (!apex.ok) fails.push("facades().apexOf(id) null — the marker never placed the row (used the row's own apex)");
      const fwd = forwardAt(row.lat, row.lon, row.headingDeg, row.pitchDeg ?? 0);
      const U = normalAt(row.lat, row.lon);
      const pos = [0, 1, 2].map((k) => apexXyz[k] - 60 * fwd[k] + 15 * U[k]);
      const look = [0, 1, 2].map((k) => apexXyz[k] + 40 * fwd[k]);
      await evalJs(`(() => { const V = window.__globe.camera.up.constructor; window.__globe.flight.start({ position: new V(${pos.join(",")}), lookAt: new V(${look.join(",")}) }); return true; })()`);
      const id = JSON.stringify(row.id);
      const t0 = Date.now();
      const res = await waitFor(
        `(() => { const f = window.__globe.facades(); const s = ${SNAP}; const sl = s && s.slots.find((x) => x.id === ${id});
          return f.resident.includes(${id}) && !!sl && sl.on === true && s.slotsOn === 1 && !!f.markers && f.markers.drawn >= 1; })()`,
        5000,
        100,
      );
      const resMs = Date.now() - t0;
      const view = await evalJs(`(() => { const f = window.__globe.facades(); const s = ${SNAP}; return { resident: f.resident, occupied: f.occupied, markers: f.markers, world: f.world, slotsOn: s.slotsOn, slots: s.slots.map((x) => ({ id: x.id, on: x.on, tex: x.textureReady, depth: x.depthRenders })) }; })()`);
      if (!res.ok) return { pass: false, detail: fmtFails(fails, `not resident within 5 s: ${JSON.stringify(view)}`) };
      await waitFor(`(() => { const sl = ${SNAP}.slots.find((x) => x.id === ${id}); return !!sl && sl.textureReady === true && sl.depthRenders >= 1; })()`, 8000, 100);
      await sleep(2000); // the near tiles' LOD at the close pose
      await ticks(4);
      await capture("res-on", "09-resident-on.jpeg");
      // OFF: the planner skips `editingId` (StylizedTiles' slot plan) — the one store lever that
      // releases a world slot WITHOUT moving the camera. (A far `reportViewport` is overwritten by
      // the globe's own mirror every ORCH.mirrorEveryFrames frames, so it cannot hold the world off.)
      await evalJs(`${MS}.setEditing(${id}), true`);
      const off = await waitFor(`(() => { const sl = ${SNAP}.slots.find((x) => x.id === ${id}); return !sl || sl.on === false; })()`, 5000, 100);
      await ticks(4);
      await sleep(300);
      await capture("res-off", "10-resident-off.jpeg");
      const d = await diff("res-on", "res-off");
      await evalJs(`${MS}.setEditing(null), true`);
      const back = await waitFor(`(() => { const sl = ${SNAP}.slots.find((x) => x.id === ${id}); return !!sl && sl.on === true; })()`, 5000, 100);
      await dropCaps();
      if (!off.ok) fails.push("the slot never released under setEditing(id)");
      if (!(d.satDelta > 1500)) fails.push(`ON − OFF saturated Δ ${d.satDelta} ≤ 1500`);
      if (!back.ok) fails.push("the slot did not return after setEditing(null)");
      return {
        pass: fails.length === 0,
        detail: fmtFails(fails, `resident in ${resMs} ms · ${JSON.stringify({ markers: view.markers, slotsOn: view.slotsOn, world: view.world })} · ON/OFF ${JSON.stringify(d)} · slot back ${back.ok}`),
      };
    },
    { save: true },
  );

  // ═══ 14 · DELETE ══════════════════════════════════════════════════════════════════════════════
  await runLeg(
    14,
    "DELETE — gone from mine and the server, a bogus id 404s, the draft cleared",
    async () => {
      const fails = [];
      const item = await evalJs(`(() => { const r = ${MS}.mine.find((m) => m.id === ${JSON.stringify(row.id)}); return r ? JSON.parse(JSON.stringify(r)) : null; })()`);
      if (!item) return { pass: false, detail: "the row is not in mine before the delete" };
      await evalJs(`${FS}.openSaved(${JSON.stringify(item)}), true`);
      const placed = await waitFor(`${FS}.phase === "placed" && ${FS}.savedFacadeId === ${JSON.stringify(row.id)}`, 5000, 100);
      if (!placed.ok) return { pass: false, detail: "openSaved did not place the row" };
      await evalJs(`${SS}.deleteFacade(), true`);
      const done = await waitFor(`(() => { const p = ${SS}.phase; return p === "idle" || p === "error" ? p : 0; })()`, 30_000, 150);
      const ph = await evalJs(`(() => { const s = ${SS}; return { phase: s.phase, error: s.error ?? null, errorCode: s.errorCode ?? null }; })()`);
      if (!done.ok || ph.phase !== "idle") return { pass: false, detail: `delete → ${ph.phase} ${ph.errorCode}: ${ph.error}` };
      const inMine = await evalJs(`${MS}.mine.some((m) => m.id === ${JSON.stringify(row.id)})`);
      if (inMine) fails.push("mine still lists the id");
      let srvHas = true;
      for (let i = 0; i < 12 && srvHas; i++) {
        const list = await listMineServer();
        srvHas = !list || list.some((f) => f.id === row.id);
        if (srvHas) await sleep(800);
      }
      if (srvHas) fails.push("GET /api/facades still lists the id");
      else {
        createdId = null;
        cleanupNote = `row ${row.id} deleted by leg 14`;
      }
      const bogus = await pageApi("/api/facades?id=00000000-0000-0000-0000-000000000000", { method: "DELETE", headers: { "Content-Type": "application/json" } });
      if (bogus.status !== 404) fails.push(`DELETE bogus → ${bogus.status} ${JSON.stringify(bogus.body)}`);
      const st = await facadeState();
      const geomGone = await evalJs("window.__globe.facadeFrustum.current() === null");
      if (st.phase !== "idle" || !geomGone) fails.push(`the draft not cleared (phase ${st.phase}, frustum ${geomGone ? "gone" : "present"})`);
      return { pass: fails.length === 0, detail: fmtFails(fails, `deleted · server listing clean · bogus DELETE ${bogus.status} ${bogus.body?.error} · draft ${st.phase}`) };
    },
    { save: true },
  );
} finally {
  // A row this run created and leg 14 did not remove (a FAIL / an abort in between) — remove it now.
  if (createdId) {
    let status = "?";
    try {
      status = (await pageApi(`/api/facades?id=${encodeURIComponent(createdId)}`, { method: "DELETE", headers: { "Content-Type": "application/json" } })).status;
    } catch {
      /* the page is gone — the sync curl below is the fallback */
    }
    if (status === 200 || status === 404) {
      cleanupNote = `row ${createdId} deleted by the finally (DELETE ${status})`;
      createdId = null;
    } else {
      syncDeleteCreated("finally");
      cleanupNote = createdId ? `ROW LEFT BEHIND: ${createdId} (DELETE failed)` : "row deleted by the finally (curl)";
    }
  }
}

// ═══ 15 · THE PIN FLOW + CONSOLE ════════════════════════════════════════════════════════════════
await runLeg(
  15,
  "the pin flow untouched + a clean console",
  async () => {
    const fails = [];
    await evalJs(`${FS}.clear(), true`).catch(() => {});
    await ticks(3).catch(() => {});
    const pin = await evalJs(`({
      uploadPhase: window.__uploadStore.getState().phase,
      pinFrustum: window.__globe.frustum.current() === null,
      pinOverlay: document.querySelector(".uf:not(.ff)") === null,
    })`);
    if (pin.uploadPhase !== "idle") fails.push(`upload phase ${pin.uploadPhase}`);
    if (!pin.pinFrustum) fails.push("the PIN frustum built");
    if (!pin.pinOverlay) fails.push("the pin overlay (.uf:not(.ff)) is open");
    await sleep(300);
    for (const e of consoleErrors.slice(0, 10)) console.log(`      ! ${e}`);
    for (const e of glNoise.slice(0, 10)) console.log(`      ~ ${e}`);
    if (consoleErrors.length) fails.push(`${consoleErrors.length} console error(s)/exception(s)`);
    if (glNoise.length) fails.push(`${glNoise.length} shader/GL message(s)`);
    return { pass: fails.length === 0, detail: fmtFails(fails, `pin ${JSON.stringify(pin)} · ${consoleErrors.length} errors · ${glNoise.length} GL`) };
  },
  { always: true },
);

// --- summary -------------------------------------------------------------------------------------
await evalJs(`document.cookie = "wixSession=; path=/; max-age=0", true`).catch(() => {});
await dropMemberCookie(); // leave the house profile signed out for the next harness (T156)
const failures = results.filter((r) => !r.pass);
const skipped = results.filter((r) => r.skip);
console.log("\n── FACADE FLOW · SUMMARY ──────────────────────────────────────");
for (const r of results) console.log(`  ${r.skip ? "SKIP" : r.pass ? "PASS" : "FAIL"}  [${r.id}] ${r.name}`);
console.log(`  ${results.length - failures.length - skipped.length}/${results.length - skipped.length} legs pass${skipped.length ? ` (${skipped.length} skipped)` : ""} · shots in ${SHOTS}/`);
console.log(`  cleanup: ${cleanupNote}`);
console.log("────────────────────────────────────────────────────────────────");

await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
ws.close();
await finishVerify(failures.length || createdId ? 1 : 0);
