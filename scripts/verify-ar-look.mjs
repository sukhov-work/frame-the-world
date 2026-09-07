// Browser verification for AR LOOK-AROUND in mobile FPV (owner order 2026-09-07g): the ladder's
// math END-TO-END on the desktop's phone twin — the toggle, the permission call, every rung driven
// by device-orientation samples, the drag standing down, the stale fallback, EXIT VIEW detaching.
//
//   node scripts/verify-ar-look.mjs [9333] [--no-lean]
//
// HOW THE SAMPLES ARRIVE. Two ways, both real listeners on `window`:
//   · synthetic `DeviceOrientationEvent`s dispatched in the page (the spec's constructor; Chrome 59+,
//     `isTrusted: false` — the module never checks it), with `webkitCompassHeading` /
//     `webkitCompassAccuracy` DEFINED on the instance for the iOS rung — Chrome has no such fields;
//   · the CDP virtual sensor (`Emulation.setSensorOverrideEnabled` + `setSensorOverrideReadings`,
//     type `absolute-orientation`, a quaternion) — the REAL `deviceorientationabsolute` path through
//     Chromium's sensor stack, reported as INFO if the headless build refuses it.
// The desktop's answer is a FUNCTIONAL proxy: the compass premises (magnetic north, the top-edge
// heading, the permission sheet) are a real iPhone's to confirm — DECISIONS 2026-09-07h names them.
//
// Every expectation is read from the LIVE engine: `__globe.arLook()` (the ladder) and the camera
// store's `fpvHud` (what the camera actually looks at) — never recomputed here.

import { mkdirSync, writeFileSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const LEAN = !args.includes("--no-lean");
const SHOTS = args.includes("--shots");
const notes = [];
const fails = [];
const ok = (cond, msg) => (cond ? notes.push(`  PASS  ${msg}`) : fails.push(`  FAIL  ${msg}`));
const info = (msg) => notes.push(`  INFO  ${msg}`);
const circ = (a, b) => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.abs(d);
};

await ensureBrowser(PORT);
// The /m shell at the catalogue's Dnipro FPV pose (the `#f=` hash carries over to /m as-is).
const fpv = byId("dnipro-fpv-south");
const { url } = poseUrl({ ...fpv, path: "/m" });
let target;
try {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
} catch {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
}
trackTarget(PORT, target.id);
const s = await openSession(target);
if (LEAN) {
  await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 4, configurable: true });`,
  });
  await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}
await s.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
await s.bootUrl(url);
await s.waitFor(`!!window.__globe && typeof window.__globe.arLook === "function" && !!window.__cameraStore`, 90_000, "globe up");
await s.waitFor(`(() => { const c = window.__cameraStore.getState(); return c.fpvHud !== null; })()`, 60_000, "FPV live");
await sleep(2500);
const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
const tap = async (selector, label) => {
  const hit = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  ok(hit === true || hit === "true", `tap ${label} (${selector})`);
  await sleep(150);
};
// Page-side sample dispatcher: alpha/beta/gamma from a TRUE heading + pitch in a frame yawed by
// `frameYaw` from magnetic north (the unit tests' `euler()` helper, verbatim), with the WMM's
// declination read from the engine so the expectation and the product share ONE number.
await s.evalJs(`(() => {
  window.__arSend = (kind, headingTrue, pitch, frameYaw, extra) => {
    const decl = window.__globe.arLook().declinationDeg;
    const headingMag = headingTrue - decl;
    const alpha = ((-(headingMag - frameYaw)) % 360 + 360) % 360;
    const init = { alpha, beta: 90 + pitch, gamma: 0, absolute: kind === "absolute" };
    const ev = new DeviceOrientationEvent(kind === "absolute" ? "deviceorientationabsolute" : "deviceorientation", init);
    if (extra && typeof extra.compass === "number") {
      Object.defineProperty(ev, "webkitCompassHeading", { value: extra.compass });
      Object.defineProperty(ev, "webkitCompassAccuracy", { value: extra.accuracy ?? 5 });
    }
    window.dispatchEvent(ev);
    return alpha;
  };
  // the iOS compass field for a pose: the TOP EDGE's magnetic heading in the phone's frame
  window.__arTopMag = (alpha, beta, gamma, frameYaw) => {
    const D = Math.PI / 180, a = alpha * D, b = beta * D, g = gamma * D;
    const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b);
    const top = { x: -cB * sA, y: cA * cB, z: sB };
    const hdg = (Math.atan2(top.x, top.y) / D + 360) % 360;
    return { heading: (hdg + frameYaw + 360) % 360, horiz: Math.hypot(top.x, top.y) };
  };
  return true;
})()`);
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync("verify-shots", { recursive: true });
  const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(r.data, "base64"));
};
const hud = async () => J(`(() => { const c = window.__cameraStore.getState(); return { h: c.fpvHud?.headingDeg, p: c.fpvHud?.pitchDeg, ar: c.arLook, st: c.arLookState }; })()`);
const dbg = async () => J(`window.__globe.arLook()`);
const stream = async (kind, headingTrue, pitch, frameYaw, ms, extraFn) => {
  // ~60 Hz for `ms` — the page's own timers, so the samples interleave with rAF like a phone's
  await s.evalJs(`new Promise((res) => { const t0 = performance.now(); const tick = () => { const ex = ${extraFn ?? "null"}; window.__arSend(${JSON.stringify(kind)}, ${headingTrue}, ${pitch}, ${frameYaw}, ex); if (performance.now() - t0 < ${ms}) setTimeout(tick, 16); else res(true); }; tick(); })`);
};

// ── 0. The chip, OFF, and the declination the engine will apply ─────────────────────────────
{
  const st = await J(`(() => ({ btn: !!document.querySelector(".m-arbtn"), on: window.__cameraStore.getState().arLook, note: !!document.querySelector(".m-arnote") }))()`);
  ok(st.btn, "the AR chip is on the FPV controls");
  ok(st.on === false && !st.note, "AR boots OFF with no note (never asked at page load)");
}

// ── 1. The tap: permission from the gesture ─────────────────────────────────────────────────
const permApi = await J(`typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function"`);
info(`DeviceOrientationEvent.requestPermission on this Chrome: ${permApi ? "present" : "absent"}`);
await tap(".m-arbtn", "the AR chip");
await sleep(400);
{
  const st = await J(`(() => ({ on: window.__cameraStore.getState().arLook, note: document.querySelector(".m-arnote")?.textContent || "" }))()`);
  if (st.on) ok(true, `the tap armed AR (permission ${permApi ? "resolved granted" : "not required"}) — note: "${st.note.slice(0, 60)}"`);
  else {
    info(`the tap did NOT arm AR — the permission resolved denied/rejected on this Chrome (note: "${st.note.slice(0, 80)}"); arming through the store for the ladder legs`);
    await s.evalJs(`window.__cameraStore.getState().setArLook(true)`);
  }
}
await sleep(300);
{
  const d = await dbg();
  ok(d.attached === true, "the engine attached the sensor listeners (arLook && fpvActive)");
  ok(d.samples === 0, "no sample yet (the desktop has no sensors; the legs below dispatch them)");
  ok(d.declinationDeg > 8 && d.declinationDeg < 9.2, `the WMM at the eye is Dnipro's (+${d.declinationDeg.toFixed(2)}°)`);
  const st = await J(`window.__cameraStore.getState().arLookState`);
  ok(st && st.stale === true && st.samples === 0, "before any sample the mirror says STALE (no sensor data)");
  const line = await J(`document.querySelector(".m-arnote")?.textContent || ""`);
  ok(/MOVE THE PHONE|NO SENSOR DATA/.test(line), `the chip explains itself ("${line.slice(0, 50)}…")`);
}

// ── 2. Rung 1 — android-absolute: the camera follows the phone, TRUE north ──────────────────
const before = await hud();
await stream("absolute", 120, -5, 0, 900);
await sleep(300);
{
  const h = await hud();
  const d = await dbg();
  ok(d.aim?.rung === "android-absolute", `rung android-absolute (samples ${d.samples}, absolute ${d.absoluteSamples})`);
  ok(circ(h.h, 120) < 0.6, `the camera heads TRUE 120° (got ${h.h.toFixed(2)}°, was ${before.h.toFixed(1)}°) — declination applied`);
  ok(Math.abs(h.p - -5) < 0.6, `pitch −5° (got ${h.p.toFixed(2)}°)`);
  ok(h.st?.rung === "android-absolute" && h.st.stale === false, "the store mirror agrees");
  await stream("absolute", 120, -5, 0, 3600); // keep the phone "moving" until the armed hint (AR_NOTE_MS) gives way
  const line = await J(`document.querySelector(".m-arnote")?.textContent || ""`);
  ok(/COMPASS · TRUE NORTH/.test(line), `the chip reads the rung ("${line}")`);
  await shot("ar-look-01-compass-rung");
}
// a turn: 40° right and 20° up
await stream("absolute", 160, 15, 0, 900);
await sleep(300);
{
  const h = await hud();
  ok(circ(h.h, 160) < 0.6 && Math.abs(h.p - 15) < 0.6, `follows a turn to 160° / +15° (got ${h.h.toFixed(2)}° / ${h.p.toFixed(2)}°)`);
}
// the drag stands down while live: a synthetic look-drag must not move the camera
await s.evalJs(`(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect(); const mk = (t, x, y) => new PointerEvent(t, { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: r.left + x, clientY: r.top + y }); c.dispatchEvent(mk("pointerdown", 200, 300)); for (let i = 1; i <= 10; i++) c.dispatchEvent(mk("pointermove", 200 + i * 12, 300)); c.dispatchEvent(mk("pointerup", 320, 300)); return true; })()`);
await stream("absolute", 160, 15, 0, 400);
await sleep(200);
{
  const h = await hud();
  ok(circ(h.h, 160) < 0.8, `a 120 px look-drag did NOT move the view while AR aims (heading ${h.h.toFixed(2)}°)`);
}

// ── 3. Rung 2 — ios-compass: relative α in an arbitrary frame + the top-edge compass ─────────
await sleep(700); // past absoluteHoldMs — the absolute stream is dead now
const FRAME = 137;
// tilted 45° up from flat: the top edge has a ground heading — the compass lands the offset
await stream("deviceorientation", 200, -45, FRAME, 900, `(() => { const decl = window.__globe.arLook().declinationDeg; const alpha = ((-(200 - decl - ${FRAME})) % 360 + 360) % 360; const t = window.__arTopMag(alpha, 45, 0, ${FRAME}); return { compass: t.heading, accuracy: 4 }; })()`);
await sleep(300);
{
  const h = await hud();
  const d = await dbg();
  ok(d.aim?.rung === "ios-compass", `rung ios-compass (compass samples ${d.compassSamples})`);
  ok(circ(h.h, 200) < 0.8, `TRUE heading recovered from a frame yawed ${FRAME}° (got ${h.h.toFixed(2)}°)`);
  ok(Math.abs(h.p - -45) < 0.8, `pitch −45° (got ${h.p.toFixed(2)}°)`);
}
// now UPRIGHT at 250°: the top edge points at the sky — a bogus compass value must be IGNORED
await stream("deviceorientation", 250, 0, FRAME, 900, `({ compass: 33, accuracy: 4 })`);
await sleep(300);
{
  const h = await hud();
  const d = await dbg();
  ok(d.aim?.rung === "ios-compass" && circ(h.h, 250) < 0.8, `upright: the learned offset CARRIES the gyro (got ${h.h.toFixed(2)}°, bogus compass ignored)`);
  ok(d.aim.compassAgeMs > 500, `compass age grows while upright (${Math.round(d.aim.compassAgeMs)} ms)`);
}

// ── 4. Rungs 3/4 — gyro only: seeded from the camera, ALIGN makes it exact ──────────────────
await tap(".m-arbtn", "the AR chip (off)");
await sleep(200);
{
  const d = await dbg();
  ok(d.attached === false, "OFF detaches the listeners and forgets the ladder");
}
// point the camera somewhere known first (a skyLook lands while AR is off)
await s.evalJs(`window.__cameraStore.getState().requestSkyLook({ azDeg: 300, altDeg: 0 })`);
await sleep(2500);
const seedH = (await hud()).h;
await s.evalJs(`window.__cameraStore.getState().setArLook(true)`); // the store path — the tap was proven above
await sleep(200);
const RF = 291;
await stream("deviceorientation", 45, 0, RF, 700); // no compass field at all
await sleep(300);
{
  const h = await hud();
  const d = await dbg();
  ok(d.aim?.rung === "relative-unaligned", "rung relative-unaligned without a compass");
  ok(circ(h.h, seedH) < 1.0, `the seed keeps the camera where it was (${h.h.toFixed(2)}° vs ${seedH.toFixed(2)}°) — nothing jumps at arming`);
  const align = await J(`!!document.querySelector(".m-aralign")`);
  ok(align, "the ALIGN chip is offered on the relative rung");
  await shot("ar-look-02-gyro-align");
}
await stream("deviceorientation", 75, 10, RF, 700); // turn 30° right, 10° up
await sleep(300);
{
  const h = await hud();
  ok(circ(h.h, seedH + 30) < 1.0 && Math.abs(h.p - 10) < 0.8, `turning the phone 30° turns the view 30° (got ${h.h.toFixed(2)}°, expected ${((seedH + 30) % 360).toFixed(2)}°) / pitch ${h.p.toFixed(1)}°`);
}
// ALIGN: "face where the view looks, tap" — the current phone pose becomes the camera's heading
const camH = (await hud()).h;
await tap(".m-aralign", "ALIGN");
await stream("deviceorientation", 75, 10, RF, 300);
await sleep(250);
{
  const d = await dbg();
  const h = await hud();
  ok(d.aim?.rung === "relative-aligned", "rung relative-aligned after the tap");
  ok(circ(h.h, camH) < 1.0, `ALIGN kept the view where it was (${h.h.toFixed(2)}° vs ${camH.toFixed(2)}°)`);
  await stream("deviceorientation", 95, 10, RF, 600);
  await sleep(250);
  const h2 = await hud();
  ok(circ(h2.h, camH + 20) < 1.0, `…and a further 20° turn lands at ${((camH + 20) % 360).toFixed(1)}° (got ${h2.h.toFixed(2)}°)`);
}

// ── 5. Stale: the sensors go quiet → the aim is null, the mirror says so, the drag is back ──
await sleep(3600); // past arSampleStaleMs AND past the ALIGN hint
{
  const d = await dbg();
  const st = await J(`window.__cameraStore.getState().arLookState`);
  ok(d.smoothed === null && d.lastSampleAgeMs > 1500, `no sample for ${Math.round(d.lastSampleAgeMs)} ms ⇒ the aim is null`);
  ok(st?.stale === true, "the mirror reads STALE");
  const line = await J(`document.querySelector(".m-arnote")?.textContent || ""`);
  ok(/NO SENSOR DATA/.test(line), `the chip says why ("${line.slice(0, 40)}…")`);
  const h0 = (await hud()).h;
  await s.evalJs(`(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect(); const mk = (t, x, y) => new PointerEvent(t, { bubbles: true, pointerId: 8, pointerType: "touch", isPrimary: true, clientX: r.left + x, clientY: r.top + y }); c.dispatchEvent(mk("pointerdown", 200, 300)); for (let i = 1; i <= 10; i++) c.dispatchEvent(mk("pointermove", 200 + i * 12, 300)); c.dispatchEvent(mk("pointerup", 320, 300)); return true; })()`);
  await sleep(600);
  const h1 = (await hud()).h;
  ok(circ(h1, h0) > 2, `the look-drag works again while stale (${h0.toFixed(1)}° → ${h1.toFixed(1)}°)`);
}

// ── 6. The REAL sensor path: CDP virtual absolute-orientation sensor (INFO if unsupported) ───
{
  let supported = true;
  try {
    await s.send("Emulation.setSensorOverrideEnabled", { enabled: true, type: "absolute-orientation" });
  } catch (e) {
    supported = false;
    info(`CDP Emulation.setSensorOverrideEnabled(absolute-orientation) refused: ${String(e.message || e).slice(0, 80)}`);
  }
  if (supported) {
    // the spec's getQuaternion(alpha, beta, gamma) for TRUE heading 90 / pitch 0 in magnetic ENU
    const decl = (await dbg()).declinationDeg;
    const alpha = ((-(90 - decl)) % 360 + 360) % 360;
    const D = Math.PI / 180;
    const x2 = (90 * D) / 2, y2 = 0, z2 = (alpha * D) / 2;
    const cX = Math.cos(x2), cY = Math.cos(y2), cZ = Math.cos(z2), sX = Math.sin(x2), sY = Math.sin(y2), sZ = Math.sin(z2);
    const q = { x: sX * cY * cZ - cX * sY * sZ, y: cX * sY * cZ + sX * cY * sZ, z: cX * cY * sZ + sX * sY * cZ, w: cX * cY * cZ - sX * sY * sZ };
    const before6 = (await dbg()).absoluteSamples;
    for (let i = 0; i < 40; i++) {
      await s.send("Emulation.setSensorOverrideReadings", { type: "absolute-orientation", reading: { quaternion: q } }).catch(() => {});
      await sleep(25);
    }
    await sleep(400);
    const d = await dbg();
    const h = await hud();
    if (d.absoluteSamples > before6) {
      ok(true, `the REAL deviceorientationabsolute path delivered ${d.absoluteSamples - before6} samples through Chromium's sensor stack`);
      ok(circ(h.h, 90) < 1.5, `…and the camera heads TRUE 90° from a magnetic-frame quaternion (got ${h.h.toFixed(2)}°)`);
    } else {
      info("the virtual sensor produced no page events on this headless build (the synthetic legs above cover the same listeners)");
    }
    await s.send("Emulation.setSensorOverrideEnabled", { enabled: false, type: "absolute-orientation" }).catch(() => {});
  }
}

// ── 7. EXIT VIEW detaches; the toggle survives for the next FPV entry ────────────────────────
{
  const hit = await s.evalJs(`(() => { const el = [...document.querySelectorAll(".m-act")].find((b) => /EXIT VIEW/.test(b.textContent)); if (!el) return false; el.click(); return true; })()`);
  ok(hit === true || hit === "true", "tap ✕ EXIT VIEW");
  await s.waitFor(`window.__cameraStore.getState().fpvHud === null`, 20_000, "FPV exited");
  await sleep(300);
  const d = await dbg();
  const st = await J(`(() => { const c = window.__cameraStore.getState(); return { on: c.arLook, mirror: c.arLookState }; })()`);
  ok(d.attached === false, "FPV exit detached the sensor listeners");
  ok(st.mirror === null, "…and cleared the mirror");
  ok(st.on === true, "the toggle itself stays latched for the next LOOK FROM HERE (per-session)");
}

console.log(notes.join("\n"));
if (fails.length) console.log(fails.join("\n"));
console.log(`\nverify-ar-look: ${notes.filter((n) => n.startsWith("  PASS")).length} PASS · ${fails.length} FAIL (lean ${LEAN})`);
s.close();
await finishVerify(fails.length ? 1 : 0);
