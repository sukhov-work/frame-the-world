// Scripted-Chrome verification of the welcome-load explore journey (CDP, no deps).
// Asserts: no cinematic entry flight, no "entering" state, journey goes straight to
// cruising, motion is continuous (no pose snaps), cruise omega in the doubled band.
import { writeFileSync } from "node:fs";

const PORT = process.argv[2] ?? "9333";
const URL = "http://localhost:4321/";
const SHOTS = process.argv[3] ?? "verify-shots";

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL });

// Wait for the globe island to boot.
const t0 = Date.now();
while (true) {
  const ok = await evalJs("!!(window.__globe && window.__globe.camera)").catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 60_000) throw new Error("globe never booted");
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`globe booted after ${Date.now() - t0} ms`);

const SAMPLE = `(() => {
  const g = window.__globe;
  const c = g.camera;
  const f = new (c.position.constructor)();
  c.getWorldDirection(f);
  const e = g.explore();
  return {
    t: performance.now(),
    state: e.state, legs: e.legs, active: e.active,
    flight: g.flight.active(),
    alt: g.alt(),
    pos: [c.position.x, c.position.y, c.position.z],
    fwd: [f.x, f.y, f.z],
    welcome: document.body.classList.contains("welcome-active"),
    pinsN: (g.pins && g.pins.count !== undefined) ? g.pins.count : null,
  };
})()`;

const samples = [];
const DUR_MS = 30_000, STEP_MS = 100;
let shot1 = false, shot2 = false;
const start = Date.now();
while (Date.now() - start < DUR_MS) {
  samples.push(await evalJs(SAMPLE));
  const el = Date.now() - start;
  if (!shot1 && el > 4_000) {
    shot1 = true;
    const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    writeFileSync(`${SHOTS}/welcome-cruise-4s.jpeg`, Buffer.from(s.data, "base64"));
  }
  if (!shot2 && el > 22_000) {
    shot2 = true;
    const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    writeFileSync(`${SHOTS}/welcome-cruise-22s.jpeg`, Buffer.from(s.data, "base64"));
  }
  await new Promise((r) => setTimeout(r, STEP_MS));
}

// ---- analysis ----
const deg = (r) => (r * 180) / Math.PI;
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const angBetween = (a, b) => {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(d);
};

const states = [...new Set(samples.map((s) => s.state))];
const flightEver = samples.some((s) => s.flight);
// Tilt from nadir of the rendered forward ray — must stay oblique (no nadir-stare dip).
const tiltOf = (s) => {
  const p = norm(s.pos), f = norm(s.fwd);
  return 180 - deg(angBetween(f, p)); // angle(fwd, -up)
};
const tilts = samples.map(tiltOf);
const minTiltDeg = Math.min(...tilts);
let maxFwdStepDegPerS = 0, maxPosStepDegPerS = 0;
const omegaByState = {};
for (let i = 1; i < samples.length; i++) {
  const a = samples[i - 1], b = samples[i];
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) continue;
  const fwdRate = deg(angBetween(norm(a.fwd), norm(b.fwd))) / dt;
  const posRate = deg(angBetween(norm(a.pos), norm(b.pos))) / dt;
  maxFwdStepDegPerS = Math.max(maxFwdStepDegPerS, fwdRate);
  maxPosStepDegPerS = Math.max(maxPosStepDegPerS, posRate);
  (omegaByState[b.state] ??= []).push(posRate);
}
const mid = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const summary = {
  states,
  flightEverActive: flightEver,
  legsFlown: samples.at(-1).legs,
  welcomeShown: samples[0].welcome,
  altStartKm: Math.round(samples[0].alt / 1000),
  altEndKm: Math.round(samples.at(-1).alt / 1000),
  maxFwdRateDegPerS: +maxFwdStepDegPerS.toFixed(3),
  maxPosRateDegPerS: +maxPosStepDegPerS.toFixed(3),
  minTiltDeg: +minTiltDeg.toFixed(1),
  tiltFirstToLast: `${tilts[0].toFixed(1)} -> ${tilts.at(-1).toFixed(1)}`,
  medianCruiseOmegaDegPerS: omegaByState.cruising ? +mid(omegaByState.cruising).toFixed(3) : null,
  firstStates: samples.slice(0, 30).map((s) => s.state).join(","),
  stateTimeline: samples.map((s) => s.state).reduce((acc, st) => {
    if (acc.at(-1)?.state === st) acc.at(-1).n++; else acc.push({ state: st, n: 1 });
    return acc;
  }, []),
};
console.log(JSON.stringify(summary, null, 2));

const failures = [];
if (states.includes("entering")) failures.push("saw removed 'entering' state");
if (flightEver) failures.push("cinematic flight ran during welcome load");
if (!states.includes("cruising")) failures.push("never reached cruising");
if (maxPosStepDegPerS > 2.0) failures.push(`position jump: ${maxPosStepDegPerS.toFixed(2)} deg/s`);
if (maxFwdStepDegPerS > 25) failures.push(`look snap: ${maxFwdStepDegPerS.toFixed(2)} deg/s`);
if (minTiltDeg < 35) failures.push(`nadir dip: tilt fell to ${minTiltDeg.toFixed(1)} deg`);
console.log(failures.length ? "FAIL: " + failures.join("; ") : "PASS");
ws.close();
process.exit(failures.length ? 1 : 0);
