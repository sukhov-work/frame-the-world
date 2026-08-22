// Scripted-Chrome verification of the 2026-07-15 pre-Phase-6 UI/UX batch (CDP, no deps; Node ≥22).
// A: PIN chip — visibility toggle + pick gating + FPV default-off/restore dance.
// B: sun/moon horizon — no razor cut at long focal lengths; bodies slice at the TRUE horizon.
// C: Milky Way haze — SVS texture renders, aligned with the BSC5 stars (visual shots).
// Screenshots → verify-shots/prephase6-*.jpeg. Usage: node scripts/verify-prephase6-uiux.mjs [cdpPort]
import { writeFileSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";
import * as Astronomy from "astronomy-engine";

const PORT = process.argv[2] ?? "9333";
const URL = "http://localhost:4321/";
const SHOTS = "verify-shots";
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
const consoleErrors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description).join(" "));
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
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(s.data, "base64"));
  console.log(`  shot: ${SHOTS}/${name}`);
};
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

const bootTo = async (url) => {
  // Hash-only navigation does NOT reload an already-open page (no hashchange listener in the
  // app) — bounce through about:blank so every #f= boot is a real fresh boot.
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url });
  const t0 = Date.now();
  while (true) {
    const ok = await evalJs("!!(window.__globe && window.__globe.camera && window.__timeStore && window.__cameraStore)").catch(() => false);
    if (ok) break;
    if (Date.now() - t0 > 60_000) throw new Error("globe never booted");
    await sleep(250);
  }
  console.log(`globe booted after ${Date.now() - t0} ms`);
};

// Ephemeris pre-computation (topocentric az/alt at Dnipro).
const observer = new Astronomy.Observer(DNIPRO.latDeg, DNIPRO.lonDeg, 100);
const bodyAzAlt = (body, ms) => {
  const t = Astronomy.MakeTime(new Date(ms));
  const eq = Astronomy.Equator(body, t, observer, true, true);
  const hor = Astronomy.Horizon(t, observer, eq.ra, eq.dec, "normal");
  return { az: hor.azimuth, alt: hor.altitude };
};
/** Scan for the first instant (minute grid) where predicate over az/alt holds. */
const findInstant = (body, startMs, days, pred) => {
  for (let ms = startMs; ms < startMs + days * 86_400_000; ms += 60_000) {
    const sun = bodyAzAlt(Astronomy.Body.Sun, ms);
    const b = bodyAzAlt(body, ms);
    if (pred(b, sun)) return { ms, ...b };
  }
  return null;
};

// ============================== A · PIN chip ==============================
console.log("\n[A] PIN chip — visibility toggle + FPV default-off");
await bootTo(URL);
await sleep(3000);
// dismiss welcome / explore
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 500, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 800, y: 500, button: "left", clickCount: 1 });
await sleep(800);

check("chip exists", await evalJs("!!document.querySelector('.ct-pins')"));
check("defaults visible", await evalJs("window.__cameraStore.getState().pinsVisible === true"));
// wait for the global pin query to land
const tPins = Date.now();
while ((await evalJs("window.__globe.pins.mesh.count")) === 0 && Date.now() - tPins < 20_000) await sleep(500);
const pinCount = await evalJs("window.__globe.pins.mesh.count");
check("pins loaded", pinCount > 0, `count=${pinCount}`);
await shot("prephase6-a1-pins-on.jpeg");

await evalJs("document.querySelector('.ct-pins').click()");
await sleep(400);
check("chip OFF → store false", await evalJs("window.__cameraStore.getState().pinsVisible === false"));
check("chip OFF → meshes hidden", await evalJs("window.__globe.pins.mesh.visible === false"));
await shot("prephase6-a2-pins-off.jpeg");
await evalJs("document.querySelector('.ct-pins').click()");
await sleep(400);
check("chip ON → meshes back", await evalJs("window.__globe.pins.mesh.visible === true"));

// FPV default-off + restore
await evalJs(`window.__cameraStore.getState().setTempPin({ latDeg: ${DNIPRO.latDeg}, lonDeg: ${DNIPRO.lonDeg} }); window.__cameraStore.getState().setTempFpv(true)`);
await sleep(3500);
check("temp FPV active", await evalJs("window.__globe.fpv().active === true"));
check("FPV auto-hid pins", await evalJs("window.__cameraStore.getState().pinsVisible === false"));
await evalJs("window.__cameraStore.getState().setTempFpv(false)");
await sleep(3000);
check("exit restored pins", await evalJs("window.__cameraStore.getState().pinsVisible === true"));
// override inside FPV survives exit
await evalJs("window.__cameraStore.getState().setTempFpv(true)");
await sleep(2500);
await evalJs("document.querySelector('.ct-pins').click()"); // re-light inside FPV
await sleep(300);
check("chip re-lit inside FPV", await evalJs("window.__cameraStore.getState().pinsVisible === true"));
await evalJs("window.__cameraStore.getState().setTempPin(null)"); // clears pin AND exits FPV
await sleep(2500);
check("override survives exit", await evalJs("window.__cameraStore.getState().pinsVisible === true"));

// ====================== B · sun/moon true-horizon slice ======================
console.log("\n[B] Horizon slice — sun & moon at long focal length");
const now = Date.now();
const sunset = findInstant(Astronomy.Body.Sun, now, 2, (b) => b.alt < 0.45 && b.alt > 0.35);
console.log(`  sun @ ${new Date(sunset.ms).toISOString()} az ${sunset.az.toFixed(1)} alt ${sunset.alt.toFixed(2)}`);
await bootTo(`${URL}#f=${DNIPRO.latDeg},${DNIPRO.lonDeg},40,${sunset.az.toFixed(1)},0.3,5&t=${sunset.ms}`);
await sleep(9000); // tiles + entry flight settle
check("FPV restored (sun)", await evalJs("window.__globe.fpv().active === true"));
check("fov ≈ 5°", await evalJs("Math.abs(window.__globe.fpv().fovDeg - 5) < 0.6"));
await shot("prephase6-b1-sun-horizon-5deg.jpeg");

const moonrise = findInstant(Astronomy.Body.Moon, now, 30, (b, sun) => b.alt > 0.4 && b.alt < 1.2 && sun.alt < -6);
console.log(`  moon @ ${new Date(moonrise.ms).toISOString()} az ${moonrise.az.toFixed(1)} alt ${moonrise.alt.toFixed(2)}`);
await bootTo(`${URL}#f=${DNIPRO.latDeg},${DNIPRO.lonDeg},40,${moonrise.az.toFixed(1)},0.6,6&t=${moonrise.ms}`);
await sleep(9000);
check("FPV restored (moon)", await evalJs("window.__globe.fpv().active === true"));
await shot("prephase6-b2-moon-horizon-6deg.jpeg");

// ============================ C · Milky Way haze ============================
console.log("\n[C] Milky Way haze — texture + alignment");
check("haze texture served", await evalJs("fetch('/textures/milkyway-2020.jpg',{method:'HEAD'}).then(r=>r.ok)"));
// Deneb (Cygnus, on the Great Rift) tonight, high in the sky, dark hour.
const denebEq = { ra: 20.6905, dec: 45.2803 };
let mwView = null;
for (let ms = now; ms < now + 86_400_000; ms += 300_000) {
  const sun = bodyAzAlt(Astronomy.Body.Sun, ms);
  if (sun.alt > -14) continue;
  const t = Astronomy.MakeTime(new Date(ms));
  const hor = Astronomy.Horizon(t, observer, denebEq.ra, denebEq.dec, "normal");
  if (hor.altitude > 35) { mwView = { ms, az: hor.azimuth, alt: hor.altitude }; break; }
}
console.log(`  Deneb @ ${new Date(mwView.ms).toISOString()} az ${mwView.az.toFixed(1)} alt ${mwView.alt.toFixed(1)}`);
await bootTo(`${URL}#f=${DNIPRO.latDeg},${DNIPRO.lonDeg},40,${mwView.az.toFixed(1)},${mwView.alt.toFixed(1)},55&t=${mwView.ms}`);
await sleep(9000);
await shot("prephase6-c1-milkyway-cygnus-55deg.jpeg");
await bootTo(`${URL}#f=${DNIPRO.latDeg},${DNIPRO.lonDeg},40,${mwView.az.toFixed(1)},${mwView.alt.toFixed(1)},25&t=${mwView.ms}`);
await sleep(9000);
await shot("prephase6-c2-milkyway-cygnus-25deg.jpeg");
// galactic centre low in the south (bulge + dust lanes near the horizon)
const gcEq = { ra: 17.7611, dec: -29.0078 };
let gcView = null;
for (let ms = now; ms < now + 86_400_000; ms += 300_000) {
  const sun = bodyAzAlt(Astronomy.Body.Sun, ms);
  if (sun.alt > -12) continue;
  const t = Astronomy.MakeTime(new Date(ms));
  const hor = Astronomy.Horizon(t, observer, gcEq.ra, gcEq.dec, "normal");
  if (hor.altitude > 5) { gcView = { ms, az: hor.azimuth, alt: hor.altitude }; break; }
}
if (gcView) {
  console.log(`  Gal centre @ ${new Date(gcView.ms).toISOString()} az ${gcView.az.toFixed(1)} alt ${gcView.alt.toFixed(1)}`);
  await bootTo(`${URL}#f=${DNIPRO.latDeg},${DNIPRO.lonDeg},40,${gcView.az.toFixed(1)},${Math.max(gcView.alt, 4).toFixed(1)},45&t=${gcView.ms}`);
  await sleep(9000);
  await shot("prephase6-c3-milkyway-bulge-45deg.jpeg");
} else {
  console.log("  gal centre never above 5° in the next dark day — skipped (Dnipro summer)");
}

// ============================== console errors ==============================
const errs = consoleErrors.filter((e) => !/favicon|manifest/i.test(e ?? ""));
check("no console errors", errs.length === 0, errs.slice(0, 3).join(" | "));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
await finishVerify(failures === 0 ? 0 : 1);