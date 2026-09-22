#!/usr/bin/env node
/**
 * verify-fpv-carry-2026-09-22 — the browser twin of the owner's 2026-09-22 FPV / minimap block
 * (unit contract: `test/components/globe/fpvTransitions2026-09-22.test.ts`), on the DESKTOP shell:
 *
 *  1. INSTANT TRANSITIONS — `requestFly` lands the same frame (`flight.active()` false at once,
 *     the altitude mirror at the target within a second); the hidden seam re-arms the sweep.
 *  2. THE POSE IS KEPT — a saved-place jump brings its pose; EXIT VIEW then a POINT jump re-enters
 *     at the SAME eye height, pitch and lens (the carry) with the planned view's heading; a pin
 *     move while standing keeps everything and moves the feet; EXIT VIEW leaves at the orbit
 *     altitude / tilt the viewer entered from — not 200 m / 80°.
 *  3. MESH CLEARANCE — a 12 m test solid (the DEV seam `__globe.fpvTestSolid`, a closed box in
 *     the user-models group): walking into it lifts the feet onto its top the same frame at the
 *     standing eye height; walking off it descends (eased) to the ground; a pin dropped INSIDE it
 *     lands on top at entry; the kill switch lets the walker clip again.
 *
 * Usage: ~/.nvm/versions/node/v24.10.0/bin/node scripts/verify-fpv-carry-2026-09-22.mjs [cdpPort] [--shots]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const SHOTS = args.includes("--shots");
const notes = [];
const fails = [];
const ok = (cond, msg) => (cond ? notes.push(`  PASS  ${msg}`) : fails.push(`  FAIL  ${msg}`));
const circ = (a, b) => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.abs(d);
};

await ensureBrowser(PORT);
const { url } = poseUrl(byId("dnipro-cityscape"));
let target;
try {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
} catch {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
}
trackTarget(PORT, target.id);
const s = await openSession(target);
await s.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync("verify-shots", { recursive: true });
  const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(r.data, "base64"));
};
const cam = async () =>
  J(`(() => { const c = window.__cameraStore.getState(); const g = window.__globe; const p = g.camera.position; return { fpv: c.tempFpv, pin: c.tempPin, hud: c.fpvHud, tilt: c.tiltDeg, heading: c.headingDeg, alt: c.zoomAltM, geo: c.camGeo, flying: g.flight.active(), fov: g.camera.fov, plan: c.plannedView, mode: c.mapMode, clr: g.fpvClearance() }; })()`);
const settle = async (frames = 20) => s.ticks(frames);

await s.bootUrl(url);
await s.waitFor(`!!window.__globe && !!window.__cameraStore && typeof window.__globe.fpvClearance === "function"`, 90_000, "globe up");
await s.waitFor(`window.__globe.terrainReady ? window.__globe.terrainReady() : true`, 30_000, "terrain").catch(() => {});
await sleep(4000);

const P0 = { latDeg: 48.467806, lonDeg: 35.071753 }; // the fpv-south pose's ground point (the city)
const P1 = { latDeg: 48.4655, lonDeg: 35.0745 };
const P2 = { latDeg: 48.4662, lonDeg: 35.0702 };

// ── 1. INSTANT transitions ───────────────────────────────────────────────────────────────────
{
  const sm = await J(`window.__globe.smoothFlights()`);
  ok(sm === false, `the hidden switch is OFF by default (smoothFlights() → ${sm})`);
  await s.evalJs(`window.__cameraStore.getState().requestFly({ latDeg: ${P0.latDeg}, lonDeg: ${P0.lonDeg}, altM: 2500 })`);
  await settle(2);
  const a = await cam();
  ok(a.flying === false, `requestFly is a CUT: nothing in flight two frames later (flying ${a.flying})`);
  await settle(60);
  const b = await cam();
  // (±5 %: the arrival pose is derived from the terrain under the target, which refines as the
  // tiles land — the second run read 2,565 m; the claim here is "landed", not the metre.)
  ok(Math.abs(b.alt - 2500) < 125, `…the camera IS at the target (altitude ${Math.round(b.alt)} m, want 2500 ± 5 %)`);
  // the seam re-arms the sweep for a harness that measures one
  await s.evalJs(`window.__globe.smoothFlights(true)`);
  await s.evalJs(`window.__cameraStore.getState().requestFly({ latDeg: ${P0.latDeg}, lonDeg: ${P0.lonDeg}, altM: 1200 })`);
  await settle(2);
  const c = await cam();
  ok(c.flying === true, `__globe.smoothFlights(true) re-arms the sweep (flying ${c.flying})`);
  await sleep(2600);
  await s.evalJs(`window.__globe.smoothFlights(false)`);
  await settle(10);
  ok((await cam()).flying === false, "…and it lands; the switch is back OFF");
}

// ── 2. THE POSE IS KEPT ──────────────────────────────────────────────────────────────────────
{
  // the orbit pose the viewer will LEAVE for FPV — a known tilt over P0 (the 1,200 m cut above)
  await s.evalJs(`window.__cameraStore.getState().setTargetTilt(62)`);
  await sleep(1800);
  await settle(20);
  const pre = await cam();
  ok(Math.abs(pre.tilt - 62) < 2, `orbit before FPV: tilt ${pre.tilt.toFixed(1)}° · alt ${Math.round(pre.alt)} m (the pose to come back to)`);
  const preAboveGround = pre.alt - (pre.geo?.groundAltM ?? 0);
  // a saved place brings its FULL pose
  await s.evalJs(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${P0.latDeg}, lonDeg: ${P0.lonDeg}, eyeM: 8, headingDeg: 135, pitchDeg: 12, fovDeg: 40 })`);
  await s.waitFor(`window.__cameraStore.getState().fpvHud !== null`, 30_000, "FPV up");
  await settle(2);
  const inFlight = await cam();
  ok(inFlight.flying === false, `the FPV entry is a cut too (flying ${inFlight.flying})`);
  await sleep(1500);
  await settle(20);
  const place = await cam();
  ok(place.fpv && circ(place.hud.headingDeg, 135) < 1.5 && Math.abs(place.hud.pitchDeg - 12) < 1 && Math.abs(place.hud.fovDeg - 40) < 0.5 && Math.abs(place.hud.eyeAboveGroundM - 8) < 0.6,
    `a saved place stands at ITS pose: hdg ${place.hud.headingDeg.toFixed(1)}° · pitch ${place.hud.pitchDeg.toFixed(1)}° · fov ${place.hud.fovDeg.toFixed(1)}° · eye ${place.hud.eyeAboveGroundM.toFixed(1)} m`);
  ok(Math.abs(place.fov - 40) < 0.5, `…and the lens landed WITHOUT a glide (camera.fov ${place.fov.toFixed(2)} right after entry)`);
  await shot("fpv-carry-01-place");
  // a PIN MOVE while standing keeps the look, the eye and the lens — and moves the feet
  await s.evalJs(`window.__cameraStore.getState().setTempPin({ latDeg: ${P1.latDeg}, lonDeg: ${P1.lonDeg} })`);
  await sleep(600);
  await settle(20);
  const moved = await cam();
  ok(moved.fpv && moved.flying === false && Math.abs(moved.geo.latDeg - P1.latDeg) < 2e-4 && Math.abs(moved.geo.lonDeg - P1.lonDeg) < 3e-4,
    `a pin move stands at the new point at once (${moved.geo.latDeg.toFixed(5)}, ${moved.geo.lonDeg.toFixed(5)})`);
  ok(circ(moved.hud.headingDeg, 135) < 1.5 && Math.abs(moved.hud.pitchDeg - 12) < 1.5 && Math.abs(moved.hud.fovDeg - 40) < 0.5 && Math.abs(moved.hud.eyeAboveGroundM - 8) < 0.6,
    `…with the SAME hdg ${moved.hud.headingDeg.toFixed(1)}° · pitch ${moved.hud.pitchDeg.toFixed(1)}° · fov ${moved.hud.fovDeg.toFixed(1)}° · eye ${moved.hud.eyeAboveGroundM.toFixed(1)} m`);
  // EXIT VIEW → the orbit pose the viewer LEFT, over where they stand
  await s.evalJs(`window.__cameraStore.getState().setTempFpv(false)`);
  await settle(2);
  ok((await cam()).flying === false, "EXIT VIEW is a cut");
  await sleep(1500);
  await settle(30);
  const back = await cam();
  const backAbove = back.alt - (back.geo?.groundAltM ?? 0);
  ok(!back.fpv && Math.abs(back.tilt - pre.tilt) < 3, `back in orbit at the tilt the viewer LEFT (${back.tilt.toFixed(1)}° vs ${pre.tilt.toFixed(1)}°; the old default was ${80}°)`);
  ok(Math.abs(backAbove - preAboveGround) / Math.max(1, preAboveGround) < 0.15, `…at the altitude they left (${Math.round(backAbove)} m above ground vs ${Math.round(preAboveGround)}; the old default was 200 m)`);
  ok(Math.abs(back.fov - pre.fov) < 0.5, `…with the orbit lens (${back.fov.toFixed(1)}°)`);
  await shot("fpv-carry-02-back-in-orbit");
  // a POINT jump re-enters at what the viewer last stood at (no 1.7 m · 0° · 55°)
  await s.evalJs(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${P2.latDeg}, lonDeg: ${P2.lonDeg} })`);
  await s.waitFor(`window.__cameraStore.getState().fpvHud !== null`, 30_000, "FPV up again");
  await sleep(1500);
  await settle(20);
  const again = await cam();
  ok(again.fpv && Math.abs(again.hud.pitchDeg - 12) < 1.5 && Math.abs(again.hud.fovDeg - 40) < 0.5 && Math.abs(again.hud.eyeAboveGroundM - 8) < 0.8,
    `a POINT jump carries the pose: pitch ${again.hud.pitchDeg.toFixed(1)}° · fov ${again.hud.fovDeg.toFixed(1)}° · eye ${again.hud.eyeAboveGroundM.toFixed(1)} m (defaults would be 0° · 55° · 1.7 m)`);
  ok(circ(again.hud.headingDeg, 135) < 2, `…and the planned view's heading (${again.hud.headingDeg.toFixed(1)}° — what the last FPV faced)`);
  await shot("fpv-carry-03-point-jump");
  await s.evalJs(`window.__cameraStore.getState().setTempFpv(false)`);
  await sleep(1200);
  await settle(20);
}

// ── 3. MESH CLEARANCE ────────────────────────────────────────────────────────────────────────
{
  // stand at P0 at the standing height, facing EAST; a 12 m box 20 m ahead (its west face 5 m away)
  await s.evalJs(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${P0.latDeg}, lonDeg: ${P0.lonDeg}, eyeM: 1.7, headingDeg: 90, pitchDeg: 0, fovDeg: 55 })`);
  await s.waitFor(`window.__cameraStore.getState().fpvHud !== null`, 30_000, "FPV for the box");
  await sleep(1500);
  await settle(20);
  const mPerDegLon = 111_320 * Math.cos((P0.latDeg * Math.PI) / 180);
  const boxLon = P0.lonDeg + 20 / mPerDegLon;
  const box = await J(`window.__globe.fpvTestSolid(${P0.latDeg}, ${boxLon}, 12, 30)`);
  ok(box && Number.isFinite(box.topM), `a 12 m test solid stands 20 m east (base ${box?.baseM.toFixed(1)} m, top ${box?.topM.toFixed(1)} m)`);
  const before = await cam();
  ok(before.clr.on === true && before.clr.floorAbsM === null, `on the ground before the walk: clearance ON, floor = terrain (${JSON.stringify({ floor: before.clr.floorAbsM, lifts: before.clr.lifts })})`);
  await shot("fpv-carry-04-box-ahead");
  // walk east into it
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`);
  const t0 = Date.now();
  let lifted = null;
  while (Date.now() - t0 < 6000) {
    await settle(6);
    const c = await cam();
    if (c.clr.floorAbsM !== null && c.clr.lifts > 0) {
      lifted = c;
      break;
    }
  }
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
  await settle(10);
  const onTop = await cam();
  ok(lifted !== null, `walking into the wall LIFTED the feet (after ${lifted ? Date.now() - t0 : "?"} ms; lifts ${onTop.clr.lifts}, columns ${onTop.clr.columns})`);
  ok(lifted !== null && Math.abs(onTop.clr.floorAbsM - box.topM) < 0.6, `…onto the solid's TOP (floor ${onTop.clr.floorAbsM?.toFixed(2)} m vs top ${box.topM.toFixed(2)} m)`);
  ok(Math.abs(onTop.clr.eyeM - 1.7) < 0.05 && Math.abs(onTop.hud.eyeAboveGroundM - 1.7) < 0.05, `…standing (eye ${onTop.clr.eyeM.toFixed(2)} m above it — "as if standing on it")`);
  ok(onTop.clr.lastMs < 8, `…the column costs ${onTop.clr.lastMs.toFixed(2)} ms (< 8 ms under the harness throttle)`);
  await shot("fpv-carry-05-on-the-roof");
  // walk on across the roof and off its far edge: the floor returns to the terrain, eased
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`);
  const t1 = Date.now();
  let dropped = null;
  while (Date.now() - t1 < 8000) {
    await settle(6);
    const c = await cam();
    if (c.clr.floorAbsM === null) {
      dropped = c;
      break;
    }
  }
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
  await sleep(900);
  await settle(20);
  const down = await cam();
  ok(dropped !== null, `walking off the far edge drops the floor back to the terrain (after ${dropped ? Date.now() - t1 : "?"} ms)`);
  ok(Math.abs(down.clr.liftM) < 0.3 && Math.abs(down.hud.eyeAboveGroundM - 1.7) < 0.3, `…and the eye is back at the standing height over the ground (lift ${down.clr.liftM.toFixed(2)} m, eye ${down.hud.eyeAboveGroundM.toFixed(2)} m)`);
  // a pin dropped INSIDE the solid lands on top at entry
  await s.evalJs(`window.__cameraStore.getState().setTempFpv(false)`);
  await sleep(1000);
  await settle(20);
  await s.evalJs(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${P0.latDeg}, lonDeg: ${boxLon}, eyeM: 1.7, headingDeg: 0, pitchDeg: 0, fovDeg: 55 })`);
  await s.waitFor(`window.__cameraStore.getState().fpvHud !== null`, 30_000, "FPV inside the box");
  await sleep(800);
  await settle(20);
  const inside = await cam();
  ok(inside.clr.floorAbsM !== null && Math.abs(inside.clr.floorAbsM - box.topM) < 0.6 && Math.abs(inside.hud.eyeAboveGroundM - 1.7) < 0.1,
    `a pin dropped INSIDE the solid stands on its top at entry (floor ${inside.clr.floorAbsM?.toFixed(2)} m, eye ${inside.hud.eyeAboveGroundM.toFixed(2)} m)`);
  await shot("fpv-carry-06-pin-inside-lands-on-top");
  // the kill switch: off → the walker clips again
  await s.evalJs(`window.__globe.fpvClearance(false)`);
  await settle(5);
  const off = await cam();
  ok(off.clr.on === false && off.clr.floorAbsM === null && Math.abs(off.clr.liftM) < 1e-6, `__globe.fpvClearance(false): the lift is released (floor ${off.clr.floorAbsM}, lift ${off.clr.liftM})`);
  await s.evalJs(`window.__globe.fpvClearance(true)`);
  await settle(5);
  const on = await cam();
  ok(on.clr.on === true && on.clr.floorAbsM !== null, `…and back on it lifts again (floor ${on.clr.floorAbsM?.toFixed(2)} m)`);
  await s.evalJs(`window.__globe.fpvTestSolid(null)`);
  await settle(5);
  ok((await cam()).clr.floorAbsM === null, "the solid removed → the floor is the terrain again");
  await s.evalJs(`window.__cameraStore.getState().setTempFpv(false)`);
  await sleep(600);
}

console.log(notes.join("\n"));
if (fails.length) console.log(fails.join("\n"));
console.log(`\nverify-fpv-carry-2026-09-22: ${notes.filter((n) => n.startsWith("  PASS")).length} PASS · ${fails.length} FAIL`);
s.close();
await finishVerify(fails.length ? 1 : 0);
