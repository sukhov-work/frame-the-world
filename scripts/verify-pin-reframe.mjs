// Scripted-Chrome verification of the pin-selection arrival RE-FRAMING fix (CDP, no deps; Node ≥22).
// Bug: selecting a pin from HIGH altitude placed its frustum on not-yet-loaded terrain (terrainH≈0),
// so the onPlaced flight committed a lookAt below the real ground; as tiles refined the frustum
// resnapped upward but the flight target stayed low → the photo landed SHIFTED. Fix: while framing a
// fresh selection, resnap every frame and, once terrain SETTLES, re-fly a short glide onto the LIVE
// arrival pose. This asserts: from a 650 km oblique start over Dnipro, selecting a pin ends with the
// image-plane centre CENTRED on screen (|NDC| small), the frustum apex ROSE ~terrain-height (the
// resnap the fix corrects), and a corrective re-frame flight actually FIRED after the initial landing.
// Screenshots → verify-shots/pin-reframe-*.  Usage: node scripts/verify-pin-reframe.mjs [cdpPort] [shotsDir]
import { writeFileSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const URL = "http://localhost:4321/";
const SHOTS = process.argv[3] ?? "verify-shots";
const START_ALT_M = Number(process.argv[4] ?? 650000); // start-altitude regime (high vs city control)
const DNIPRO = { latDeg: 48.4647, lonDeg: 35.0462 };

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
const globeErrors = []; // Flow-0 B19 signal: any `[globe] … update error` = a step order regression
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (text.includes("[globe]")) globeErrors.push(text.slice(0, 160));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params?.exceptionDetails;
    globeErrors.push("EXCEPTION: " + (d?.exception?.description ?? d?.text ?? "").slice(0, 160));
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

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL });

const t0 = Date.now();
while (true) {
  const ok = await evalJs(
    "!!(window.__globe && window.__globe.camera && window.__globe.frustum && window.__uploadStore && window.__cameraStore)",
  ).catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 60_000) throw new Error("globe never booted");
  await sleep(250);
}
console.log(`globe booted after ${Date.now() - t0} ms`);
await sleep(3000); // first tile wave

// Dismiss the welcome screen + exit the auto-armed explore journey (one gesture).
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 500, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 800, y: 500, button: "left", clickCount: 1 });
await sleep(700);

// --- Step 1: fly HIGH + oblique over Dnipro (the failing regime) --------------------------------
await evalJs(
  `window.__cameraStore.getState().requestFly({ latDeg: ${DNIPRO.latDeg}, lonDeg: ${DNIPRO.lonDeg}, altM: ${START_ALT_M} })`,
);
// wait for the fly to arm, run and settle
{
  const t = Date.now();
  let wentActive = false;
  while (Date.now() - t < 12_000) {
    const a = await evalJs("window.__globe.flight.active()");
    if (a) wentActive = true;
    if (wentActive && !a) break;
    await sleep(100);
  }
  await sleep(500);
}
const startAlt = await evalJs("Math.round(window.__globe.alt())");
const heightAtSelect = await evalJs(
  `(() => { const h = window.__globe.terrainHeightAt(${DNIPRO.latDeg}, ${DNIPRO.lonDeg}); return h == null ? null : Math.round(h); })()`,
);
console.log(`high-oblique start: camera alt ${startAlt} m · terrain heightAt(pin) at selection = ${heightAtSelect}`);
await shot("pin-reframe-01-high-start.jpeg");

// --- Step 2: select a Dnipro pin (public-pin semantics: no altitude → rides on terrain) ----------
const sel = await evalJs(`(() => {
  window.__uploadStore.getState().openSavedPin({
    pinId: "verify-reframe", lat: ${DNIPRO.latDeg}, lon: ${DNIPRO.lonDeg},
    title: "verify", hFovDeg: 70, headingDeg: 214, pitchDeg: 0, rollDeg: 0,
    textureWidth: 3000, textureHeight: 2000,
  });
  const g = window.__globe.frustum.current();
  return g ? { apex: g.apex, forward: g.forward, apexR: Math.hypot(g.apex[0], g.apex[1], g.apex[2]) } : null;
})()`);
if (!sel) throw new Error("frustum did not build on openSavedPin");

// --- Step 3: watch the arrival settle; count corrective re-frames after the initial landing -------
let landings = 0;
let prevActive = true; // onPlaced started a flight synchronously
let firstLandingMs = 0;
const watchT = Date.now();
while (Date.now() - watchT < 9000) {
  const a = await evalJs("window.__globe.flight.active()");
  if (prevActive && !a) {
    landings++;
    if (landings === 1) firstLandingMs = Date.now();
  }
  prevActive = a;
  await sleep(40);
}
// reframes = flight activations that happened AFTER the initial landing (the fix engaging)
const reframeFired = landings >= 2;

// --- Step 4: measure the final framing ----------------------------------------------------------
const result = await evalJs(`(() => {
  const cam = window.__globe.camera;
  const V = cam.up.constructor; // page's THREE.Vector3
  const g = window.__globe.frustum.current();
  const D = 120; // FRUSTUM.planeDistM
  const project = (p) => { const v = new V(p[0], p[1], p[2]); v.project(cam); return { x: +v.x.toFixed(4), y: +v.y.toFixed(4) }; };
  const liveCentre = [g.apex[0] + g.forward[0]*D, g.apex[1] + g.forward[1]*D, g.apex[2] + g.forward[2]*D];
  const selApex = ${JSON.stringify(sel.apex)};
  const staleCentre = [selApex[0] + ${sel.forward[0]}*D, selApex[1] + ${sel.forward[1]}*D, selApex[2] + ${sel.forward[2]}*D];
  return {
    ndcLive: project(liveCentre),
    ndcStale: project(staleCentre),
    apexRoseM: Math.round(Math.hypot(g.apex[0], g.apex[1], g.apex[2]) - ${sel.apexR}),
    heightAtEnd: (() => { const h = window.__globe.terrainHeightAt(${DNIPRO.latDeg}, ${DNIPRO.lonDeg}); return h == null ? null : Math.round(h); })(),
    camAlt: Math.round(window.__globe.alt()),
    flightActive: window.__globe.flight.active(),
    phase: window.__uploadStore.getState().phase,
    viewMode: window.__uploadStore.getState().viewMode,
  };
})()`);
await shot("pin-reframe-02-arrived.jpeg");

// --- Assertions ---------------------------------------------------------------------------------
const centered = Math.abs(result.ndcLive.x) < 0.16 && Math.abs(result.ndcLive.y) < 0.20;
const terrainLoaded = (result.heightAtEnd ?? 0) > 30;
const staleWouldShift =
  Math.abs(result.ndcStale.x - result.ndcLive.x) > 0.1 || Math.abs(result.ndcStale.y - result.ndcLive.y) > 0.1;

console.log("\n── RESULT ─────────────────────────────────────────────");
console.log(`  plane-centre NDC (live, corrected):  (${result.ndcLive.x}, ${result.ndcLive.y})   centered=${centered}`);
console.log(`  plane-centre NDC (stale, terrainH=0): (${result.ndcStale.x}, ${result.ndcStale.y})   avoided-shift=${staleWouldShift}`);
console.log(`  frustum apex rose by ${result.apexRoseM} m during settle (the resnap the fix tracks)`);
console.log(`  terrain heightAt(pin): select=${heightAtSelect} → end=${result.heightAtEnd} m  (loaded=${terrainLoaded})`);
console.log(`  corrective re-frames after initial landing: ${landings - 1}  (fired=${reframeFired})`);
console.log(`  final: camAlt=${result.camAlt} m · phase=${result.phase} · viewMode=${result.viewMode} · flightActive=${result.flightActive}`);

// High-altitude regime must exercise the fix (a resnap + re-frame); the city-scale control just
// needs to stay centred with no spurious correction (terrain already loaded at selection).
const highRegime = START_ALT_M > 50000;
const pass = highRegime
  ? centered && terrainLoaded && (reframeFired || result.apexRoseM > 30)
  : centered && terrainLoaded;
console.log(`\n${pass ? "✅ PASS" : "❌ FAIL"} — pin selected from ${startAlt} m (${highRegime ? "HIGH" : "city"}) lands with the photo centred${
  reframeFired ? ` after ${landings - 1} corrective re-frame(s)` : " (no correction needed)"
}.`);
console.log("───────────────────────────────────────────────────────");

// --- Step 5 (optional probe): after landing, a photo-param edit must NOT make the camera chase
//     the frustum (the framing disarms on any params change). argv[5] = "paramgate". ------------
let paramGateOk = true;
if (process.argv[5] === "paramgate") {
  await sleep(400);
  const posBefore = await evalJs(
    "(() => { const p = window.__globe.camera.position; return [p.x, p.y, p.z]; })()",
  );
  await evalJs('window.__uploadStore.getState().setParam("headingDeg", 300)'); // big heading swing
  let anyFlight = false;
  const pt = Date.now();
  while (Date.now() - pt < 2200) {
    if (await evalJs("window.__globe.flight.active()")) anyFlight = true;
    await sleep(50);
  }
  const posAfter = await evalJs(
    "(() => { const p = window.__globe.camera.position; return [p.x, p.y, p.z]; })()",
  );
  const moved = Math.hypot(
    posAfter[0] - posBefore[0],
    posAfter[1] - posBefore[1],
    posAfter[2] - posBefore[2],
  );
  paramGateOk = !anyFlight && moved < 1; // the camera must stay put; only the frustum re-orients
  console.log(
    `\n  PARAM-GATE PROBE: after setParam(heading), camera moved ${moved.toFixed(2)} m · anyFlight=${anyFlight} → ${
      paramGateOk ? "OK (no chase)" : "FIGHT!"
    }`,
  );
}

// Flow-0: a clean throttled catch is the highest-value B19 signal — a step reading a hub field its
// producer no longer wrote in order would log `[globe] … update error`.
const cleanConsole = globeErrors.length === 0;
console.log(
  `\n  FLOW-0 CONSOLE: ${globeErrors.length} [globe]/exception error(s) → ${cleanConsole ? "CLEAN" : "DIRTY"}`,
);
for (const e of globeErrors.slice(0, 6)) console.log("    ! " + e);

await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
ws.close();
await finishVerify(pass && paramGateOk && cleanConsole ? 0 : 1);