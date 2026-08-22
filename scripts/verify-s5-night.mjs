// Scripted-Chrome verification of Phase 5.5 S5 — night-sky physics (CDP, no deps; Node ≥22).
// Asserts: 8k Black Marble swap landed (R8 DataTexture + gamma 2.2) · K&S moonlight ratio
// quarter/full ≈ 9–11% · moon shadows engage at a full-moon city night (rig source switch:
// castShadow + moonlight colour + K&S intensity) and stand down at quarter · sun rig intact by
// day · the night sky above the horizon reads near-black (navy-floor fix). Screenshots →
// verify-shots/phase55-36..40. Usage: node scripts/verify-s5-night.mjs [cdpPort] [shotsDir]
import { writeFileSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const URL = "http://localhost:4321/";
const SHOTS = process.argv[3] ?? "verify-shots";

// Precomputed over Dnipro (astronomy-engine, this session): full-moon night — illum 0.999,
// α 3.9° (ks ≈ 0.91), moon alt 21°, sun −23°; quarter night — illum 0.508, α 89°
// (ks ≈ 0.094), moon alt 49°, sun −13°.
const FULL_MS = Date.UTC(2026, 6, 29, 22, 10, 0);
const QUARTER_MS = Date.UTC(2026, 7, 6, 0, 50, 0);
const DAY_MS = Date.UTC(2026, 6, 29, 10, 0, 0);
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 78 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(s.data, "base64"));
  return s.data;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL });

const t0 = Date.now();
while (true) {
  const ok = await evalJs("!!(window.__globe && window.__globe.camera && window.__timeStore && window.__cameraStore)").catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 60_000) throw new Error("globe never booted");
  await sleep(250);
}
console.log(`globe booted after ${Date.now() - t0} ms`);
await sleep(3000); // first tile wave

// --- dismiss the welcome screen + exit the auto-armed explore journey (one gesture) ---------
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 500, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 800, y: 500, button: "left", clickCount: 1 });
await sleep(600);
const ui = await evalJs(`({ welcome: document.body.classList.contains("welcome-active"), explore: window.__globe.explore().active })`);
console.log("ui after dismiss:", JSON.stringify(ui));

const failures = [];

// --- 1) Black Marble 8k swap (async fetch+decode — poll) ------------------------------------
let swap = null;
for (let i = 0; i < 80; i++) {
  swap = await evalJs(`(() => {
    const u = window.__globe.earthUniforms;
    const t = u.uNight.value;
    return { gamma: u.uNightGamma.value, isData: !!t.isDataTexture, w: t.image && t.image.width, h: t.image && t.image.height };
  })()`);
  if (swap.isData) break;
  await sleep(250);
}
console.log("8k swap:", JSON.stringify(swap));
if (!swap.isData || swap.gamma !== 2.2 || swap.w !== 8192 || swap.h !== 4096) {
  failures.push(`8k swap wrong: ${JSON.stringify(swap)}`);
}

// --- 2) K&S moonlight: full vs quarter at LEO (no shadow mode up here) ------------------------
const sampleSky = async () => evalJs(`(() => {
  const g = window.__globe;
  const b = g.bodies();
  return {
    illum: +b.moonIllumination.toFixed(3), ks: +b.moonKs.toFixed(4),
    moonLightIntensity: +g.sky.moonLight.intensity.toFixed(4),
    keyIntensity: +g.sunLight.intensity.toFixed(3),
    keyColor: g.sunLight.color.getHexString(),
    castShadow: g.sunLight.castShadow,
    altKm: Math.round(g.alt() / 1000),
  };
})()`);

await evalJs(`window.__timeStore.getState().setTime(${FULL_MS})`);
await sleep(1600); // > SKY.sampleIntervalMs
const leoFull = await sampleSky();
console.log("LEO full-moon night:", JSON.stringify(leoFull));
await shot("phase55-36-leo-full-night.jpeg");

await evalJs(`window.__timeStore.getState().setTime(${QUARTER_MS})`);
await sleep(1600);
const leoQuarter = await sampleSky();
console.log("LEO quarter night:", JSON.stringify(leoQuarter));
const ratio = leoQuarter.moonLightIntensity / leoFull.moonLightIntensity;
console.log(`moonlight quarter/full ratio: ${(ratio * 100).toFixed(1)}%`);
if (!(ratio > 0.07 && ratio < 0.14)) failures.push(`K&S ratio off: ${(ratio * 100).toFixed(1)}% (want ~9-11%)`);
if (leoFull.castShadow) failures.push("shadows on at LEO (gate broken)");

// --- 3) Moon shadows at a full-moon city night (rig source switch) ---------------------------
await evalJs(`window.__timeStore.getState().setTime(${FULL_MS})`);
await evalJs(`window.__cameraStore.getState().requestFly({ latDeg: ${DNIPRO.latDeg}, lonDeg: ${DNIPRO.lonDeg}, altM: 1600 })`);
await sleep(3500);
for (let i = 0; i < 40; i++) {
  const flying = await evalJs("window.__globe.flight.active()");
  if (!flying) break;
  await sleep(250);
}
await sleep(6000); // tiles + shadow rig settle
const cityFull = await sampleSky();
console.log("city full-moon night:", JSON.stringify(cityFull));
await shot("phase55-38-moon-shadows-city.jpeg");
if (!cityFull.castShadow) failures.push("moon shadows did NOT engage at full-moon city night");
if (cityFull.keyColor !== "bfd0e8") failures.push(`moon-mode key colour ${cityFull.keyColor} != moonlight bfd0e8`);
if (Math.abs(cityFull.keyIntensity - 0.3 * leoFull.ks) > 0.02) failures.push(`moon-mode key intensity ${cityFull.keyIntensity} != 0.3×ks ${(0.3 * leoFull.ks).toFixed(3)}`);
if (cityFull.moonLightIntensity !== 0) failures.push(`dedicated moonLight not stood down: ${cityFull.moonLightIntensity}`);

// quarter night: below the illum gate — shadows off, dedicated moonlight back at K&S level
await evalJs(`window.__timeStore.getState().setTime(${QUARTER_MS})`);
await sleep(1600);
const cityQuarter = await sampleSky();
console.log("city quarter night:", JSON.stringify(cityQuarter));
await shot("phase55-39-quarter-night-city.jpeg");
if (cityQuarter.castShadow) failures.push("shadows on at quarter moon (illum gate broken)");
if (cityQuarter.moonLightIntensity <= 0) failures.push("dedicated moonLight dead at quarter night");

// day: the sun rig must be untouched by the S5 switch
await evalJs(`window.__timeStore.getState().setTime(${DAY_MS})`);
await sleep(1600);
const cityDay = await sampleSky();
console.log("city day:", JSON.stringify(cityDay));
if (!cityDay.castShadow) failures.push("sun shadows lost at city day");
if (Math.abs(cityDay.keyIntensity - 1.5) > 0.01) failures.push(`day key intensity ${cityDay.keyIntensity} != SUN.keyIntensity 1.5`);

// --- 4) Navy-floor fix: night sky above the horizon reads near-black at mid altitude ---------
await evalJs(`window.__timeStore.getState().setTime(${FULL_MS})`);
await evalJs(`window.__cameraStore.getState().requestFly({ latDeg: ${DNIPRO.latDeg}, lonDeg: ${DNIPRO.lonDeg}, altM: 60000 })`);
await sleep(3500);
for (let i = 0; i < 40; i++) {
  const flying = await evalJs("window.__globe.flight.active()");
  if (!flying) break;
  await sleep(250);
}
// oblique view facing NORTH (the moon sits in the south — keep its bloom out of frame)
await evalJs(`window.__cameraStore.setState({ targetTiltDeg: 80, targetHeadingDeg: 0 })`);
await sleep(3000);
const b64 = await shot("phase55-37-midalt-night-sky.jpeg");
// decode the screenshot IN PAGE and average the top quarter (sky above the horizon)
const skyMean = await evalJs(`(async () => {
  const img = await createImageBitmap(await (await fetch("data:image/jpeg;base64,${b64}")).blob());
  const cv = document.createElement("canvas");
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext("2d");
  cx.drawImage(img, 0, 0);
  const region = cx.getImageData(0, 0, img.width, Math.floor(img.height * 0.25)).data;
  let r = 0, g = 0, b = 0, n = region.length / 4;
  for (let i = 0; i < region.length; i += 4) { r += region[i]; g += region[i + 1]; b += region[i + 2]; }
  return { r: +(r / n).toFixed(1), g: +(g / n).toFixed(1), b: +(b / n).toFixed(1) };
})()`);
console.log("night-sky mean RGB (top 25% of frame):", JSON.stringify(skyMean));
if (skyMean.b > 20) failures.push(`night sky still lifted: mean ${JSON.stringify(skyMean)} (want ≲ bg #05070B + stars)`);

// --- 5) LEO day limb — the signature halo must be untouched by the obliquity factor ----------
await evalJs(`window.__cameraStore.getState().requestFly({ latDeg: 46.0, lonDeg: 31.3, altM: 1_100_000 })`);
await sleep(3500);
for (let i = 0; i < 40; i++) {
  const flying = await evalJs("window.__globe.flight.active()");
  if (!flying) break;
  await sleep(250);
}
await evalJs(`window.__timeStore.getState().setTime(${DAY_MS})`);
await sleep(1600);
await shot("phase55-40-leo-day-limb.jpeg");

console.log(failures.length ? "FAIL: " + failures.join("; ") : "PASS");
ws.close();
await finishVerify(failures.length ? 1 : 0);