/**
 * PROBE — the FPV collision "bounce" (owner bug 2026-10-13).
 *
 * Enters temp FPV over Dnipro, drops a DEV test solid (a closed box on the terrain) under the eye,
 * then holds SHIFT+SPACE (descend) at full ramp and records, per rAF frame, the eye's ellipsoid
 * altitude, the encoder (`fpv().eyeM`), the mesh floor and the lift (`fpvClearance()`), so the
 * frame the feet touch the roof — and whatever the eye does next — is a number, not a feeling.
 * Then the same from inside / below (the walker inside the box; a hover under a raised slab when
 * the seam supports it).
 *
 *   ~/.nvm/versions/node/v24.10.0/bin/node scripts/probe-fpv-bounce.mjs [9333]
 */
import { ensureBrowser, httpJson, openSession, sleep } from "./lib/cdp.mjs";

const PORT = Number(process.argv[2] ?? 9333);
const ORIGIN = "http://localhost:4321";
// The owner's Dnipro spot (flat central ground).
const P = { latDeg: 48.470991, lonDeg: 35.053172 };

await ensureBrowser(PORT);
const target = await httpJson(PORT, "/json/new?about:blank", "PUT");
const s = await openSession(target);
await s.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await s.bootUrl(`${ORIGIN}/#p=${P.latDeg},${P.lonDeg},2500,0,45&t=1788701556919`);
await s.waitFor(`!!window.__globe && !!window.__cameraStore && typeof window.__globe.fpvClearance === "function"`, 90_000, "globe up");
await sleep(4000);

const J = (expr) => s.evalJs(expr);
const read = () =>
  J(`(() => { const g = window.__globe; const f = g.fpv(); const c = g.fpvClearance(); return { alt: +g.alt().toFixed(3), eyeM: +f.eyeM.toFixed(3), eyeAbove: f.eyeAboveGroundM, lift: +c.liftM.toFixed(3), floor: c.floorAbsM, cols: c.columns, lifts: c.lifts }; })()`);

// --- leg A: descend onto a 20 m box from 60 m -------------------------------------------------
await J(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${P.latDeg}, lonDeg: ${P.lonDeg}, eyeM: 60, headingDeg: 0, pitchDeg: -60, fovDeg: 55 })`);
await s.waitFor(`window.__cameraStore.getState().fpvHud !== null`, 30_000, "FPV up");
await sleep(2500);
const box = await J(`window.__globe.fpvTestSolid(${P.latDeg}, ${P.lonDeg}, 20, 30)`);
await sleep(600);
console.log("box", box, "start", await read());

// hold SHIFT+SPACE and trace per frame
await J(`(() => {
  window.__trace = [];
  const kd = new KeyboardEvent("keydown", { code: "Space", key: " ", shiftKey: true, bubbles: true });
  window.dispatchEvent(kd);
  let n = 0;
  const step = () => {
    const g = window.__globe; const f = g.fpv(); const c = g.fpvClearance();
    window.__trace.push([n, +g.alt().toFixed(3), +f.eyeM.toFixed(3), +c.liftM.toFixed(3), c.floorAbsM === null ? null : +c.floorAbsM.toFixed(3), c.lifts]);
    if (++n < 420) requestAnimationFrame(step);
    else window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " ", shiftKey: true, bubbles: true }));
  };
  requestAnimationFrame(step);
})()`);
await sleep(8000);
const trace = await J(`window.__trace`);
console.log("frames", trace.length, "boxTop", box.topM);
// print every frame where alt or lift changed notably, plus the touch window
let prev = null;
for (const r of trace) {
  const [n, alt, eyeM, lift, floor, lifts] = r;
  const touch = alt - 1.7 <= box.topM + 2.5;
  const changed = !prev || Math.abs(alt - prev[1]) > 0.02 || lift !== prev[3] || floor !== prev[4] || lifts !== prev[5];
  if (changed && (touch || n % 30 === 0)) console.log(`f${String(n).padStart(3)} alt=${alt.toFixed(2)} feet=${(alt - 1.7).toFixed(2)} eyeM=${eyeM.toFixed(2)} lift=${lift.toFixed(2)} floor=${floor} lifts=${lifts}`);
  prev = r;
}
const minAlt = Math.min(...trace.map((r) => r[1]));
const after = trace.filter((r) => r[1] - 1.7 <= box.topM + 0.05);
console.log("minAlt", minAlt.toFixed(2), "touch frames", after.length, "end", await read());

// --- leg B: walk INTO the box side at 1.7 m (the climb) ----------------------------------------
await J(`window.__cameraStore.getState().setTempFpv(false)`);
await sleep(800);
await J(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${P.latDeg}, lonDeg: ${P.lonDeg - 0.0006}, eyeM: 1.7, headingDeg: 90, pitchDeg: 0, fovDeg: 55 })`);
await s.waitFor(`window.__cameraStore.getState().fpvHud !== null`, 30_000, "FPV up B");
await sleep(2000);
console.log("B start", await read());
await J(`(() => {
  window.__trace = [];
  window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 });
  let n = 0;
  const step = () => {
    const g = window.__globe; const f = g.fpv(); const c = g.fpvClearance();
    window.__trace.push([n, +g.alt().toFixed(3), +f.eyeM.toFixed(3), +c.liftM.toFixed(3), c.floorAbsM === null ? null : +c.floorAbsM.toFixed(3), c.lifts, f.walkOffsetM]);
    if (++n < 300) requestAnimationFrame(step);
    else window.__cameraStore.getState().setFpvWalkInput(null);
  };
  requestAnimationFrame(step);
})()`);
await sleep(6500);
const tb = await J(`window.__trace`);
prev = null;
for (const r of tb) {
  const [n, alt, eyeM, lift, floor, lifts, walk] = r;
  const changed = !prev || Math.abs(alt - prev[1]) > 0.05 || floor !== prev[4] || lifts !== prev[5];
  if (changed) console.log(`B f${String(n).padStart(3)} alt=${alt.toFixed(2)} eyeM=${eyeM.toFixed(2)} lift=${lift.toFixed(2)} floor=${floor} lifts=${lifts} walk=${walk}`);
  prev = r;
}
console.log("B end", await read());
await J(`window.__globe.fpvTestSolid(null)`);
await J(`window.__cameraStore.getState().setTempFpv(false)`);
s.close();
await httpJson(PORT, `/json/close/${target.id}`).catch(() => {});
