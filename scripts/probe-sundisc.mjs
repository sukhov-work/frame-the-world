// RESEARCH PROBE — the sun disc through the last degrees (owner taste pass, 2026-08-27c).
//
// "the sun disk becomes too white and transparent … keep it solid and even keep some brightness
//  and very little glow — start diminishing it earlier and keep diminishing it proportionally up
//  until some point e.g 1 degree to horizon, then can do a solid orange disk."
//
// Shoots a TIGHT CROP around the disc at a ladder of solar elevations, plus the numbers behind it,
// so "too white and transparent" becomes a measured core radiance rather than an impression.
// Usage: node --experimental-websocket scripts/probe-sundisc.mjs [cdpPort] [shotsDir] [tag]
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
const TAG = process.argv[4] ?? "disc";
mkdirSync(SHOTS, { recursive: true });
const http = (p, m = "GET") => fetch(`http://127.0.0.1:${PORT}${p}`, { method: m }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
await send("Page.enable");
await send("Runtime.enable");
const evalJs = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (e, ms = 45000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await evalJs(e)) return true;
    } catch {
      /* booting */
    }
    await sleep(500);
  }
  return false;
};

// A high, clear pose looking WNW over the Alps so the disc sits in open sky at every step.
const POSE = { lat: 35.5, lon: 138.35, alt: 3500, head: 285, tilt: 86 };
// UTC steps through the last ~4 degrees at that longitude.
const STEPS = [
  ["p10", Date.UTC(2026, 7, 21, 8, 12)],
  ["p06", Date.UTC(2026, 7, 21, 8, 32)],
  ["p04", Date.UTC(2026, 7, 21, 8, 44)],
  ["p03", Date.UTC(2026, 7, 21, 8, 50)],
  ["p02", Date.UTC(2026, 7, 21, 8, 56)],
  ["p01", Date.UTC(2026, 7, 21, 9, 2)],
  ["p00", Date.UTC(2026, 7, 21, 9, 8)],
  ["m01", Date.UTC(2026, 7, 21, 9, 14)],
];

// Where the disc is ON SCREEN, so the crop follows it — projecting the sun impostor's own world
// position through the live camera, never guessed.
const DISC_RECT = `(() => {
  const g = window.__globe;
  const v = g.sky.sunMesh.position.clone().project(g.camera);
  const w = window.innerWidth, h = window.innerHeight;
  const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
  return { x: Math.round(x), y: Math.round(y), z: v.z, onScreen: v.z > -1 && v.z < 1 };
})()`;

await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");
await send("Page.navigate", { url: "http://localhost:4321/" });
await sleep(6000);
await evalJs(`(() => { const k="ftw:view-prefs:v1"; const o=JSON.parse(localStorage.getItem(k)||"{}");
  o.ultraQuality = true; localStorage.setItem(k, JSON.stringify(o)); })()`);

console.log("step   sun°    level   coreRadiance  solid   haloK   tint      directK");
for (const [name, t] of STEPS) {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await send("Page.navigate", {
    url: `http://localhost:4321/#p=${POSE.lat},${POSE.lon},${POSE.alt},${POSE.head},${POSE.tilt}&t=${t}`,
  });
  if (!(await waitFor(`!!window.__globe`))) continue;
  await evalJs(`window.__cameraStore.getState().setUltraQuality(true)`);
  await sleep(16000);
  const sunAlt = await evalJs(`(() => {
    const b = window.__globe.bodies();
    const p = window.__globe.camera.position.clone().normalize();
    const s = new (window.__globe.camera.position.constructor)(...b.sunDir);
    return +(Math.asin(Math.max(-1, Math.min(1, s.dot(p)))) * 180 / Math.PI).toFixed(2);
  })()`);
  const u = await evalJs(`(() => {
    const m = window.__globe.sky.sunMesh.material.uniforms;
    return {
      ex: m.uExtinct.value,
      level: m.uCoreLevel.value,
      solid: m.uSolid.value,
      halo: m.uHaloK.value,
      tint: m.uCoreTint.value.getHex(),
    };
  })()`);
  const d = (await evalJs(`window.__globe.ultraLook()`)).dusk ?? {};
  // The number behind "white and transparent": the additive core's peak radiance. Below
  // BLOOM.threshold (0.9) it stops blooming entirely and can only tint the sky it sits on.
  const coreRadiance = u.level;
  console.log(
    `${name.padEnd(6)} ${String(sunAlt).padStart(6)}  ${u.ex.toFixed(3).padStart(6)}  ` +
      `${coreRadiance.toFixed(3).padStart(12)}  ${u.solid.toFixed(3)}  ${u.halo.toFixed(3)}  ` +
      `#${u.tint.toString(16).padStart(6, "0")}  ${(d.directK ?? 0).toFixed(3)}`,
  );
  const r = await evalJs(DISC_RECT);
  if (r?.onScreen) {
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      clip: {
        x: Math.max(0, r.x - 170),
        y: Math.max(0, r.y - 130),
        width: 340,
        height: 260,
        scale: 2,
      },
    });
    writeFileSync(`${SHOTS}/${TAG}-${name}.png`, Buffer.from(shot.data, "base64"));
  } else {
    console.log(`  (disc off screen at ${name})`);
  }
}

await send("Page.close").catch(() => {});
ws.close();
console.log("done");
process.exit(0);
