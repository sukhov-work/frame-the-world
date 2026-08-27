// RESEARCH PROBE — the dusk light model (owner defect 2, 2026-08-27).
//
// The acceptance criterion for this half of ULTRA is a TIMELAPSE, never a frame (owner ruling on
// the original track), and the specific claims to see are:
//   · the scene DARKENS as the sun sets instead of holding a bright uniform tint;
//   · the sky is BRIGHTER toward the sun and darker away from it — hence two headings per instant;
//   · a local afterglow survives on the sun's side once the sun is down;
//   · faces pointing away from a low sun go into deep shadow.
// Usage: node --experimental-websocket scripts/probe-dusk.mjs [cdpPort] [shotsDir] [tag]
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
const TAG = process.argv[4] ?? "dusk";
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
const shoot = async (n) => {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  writeFileSync(`${SHOTS}/${n}.jpeg`, Buffer.from(r.data, "base64"));
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

// One spot in the Japanese Alps; the sun sets roughly WNW there in late August.
const SPOT = process.env.FTW_CITY
  // Dnipro, low over the left bank — the owner's "backs of the building lit with the same ugly
  // tint instead of being in deep shadow" frame.
  ? { lat: 48.464, lon: 35.046, alt: 600, tilt: 87 }
  : { lat: 35.5, lon: 138.35, alt: 3500, tilt: 86 };
const TOWARD = process.env.FTW_CITY ? 292 : 285;
const AWAY = process.env.FTW_CITY ? 112 : 105;
const SWEEP = process.env.FTW_CITY
  ? [
      ["low", Date.UTC(2026, 7, 21, 16, 20)],
      ["horizon", Date.UTC(2026, 7, 21, 17, 5)],
      ["set", Date.UTC(2026, 7, 21, 17, 25)],
    ]
  : [
      ["noon", Date.UTC(2026, 7, 21, 2, 45)],
      ["high", Date.UTC(2026, 7, 21, 7, 10)],
      ["low", Date.UTC(2026, 7, 21, 8, 35)],
      ["horizon", Date.UTC(2026, 7, 21, 9, 5)],
      ["set", Date.UTC(2026, 7, 21, 9, 25)],
      ["civil", Date.UTC(2026, 7, 21, 9, 50)],
      ["nautical", Date.UTC(2026, 7, 21, 10, 25)],
    ];

// Mean luminance of a rectangle of the frame, read from the canvas itself — the number that says
// "the scene darkened" without a human in the loop. Two windows: the SKY band above the horizon
// and the TERRAIN below it.
const LUMA = `(() => {
  const c = document.querySelector("canvas");
  if (!c) return null;
  const w = 320, h = 180;
  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  const g = off.getContext("2d");
  g.drawImage(c, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const band = (y0, y1) => {
    let s = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      n++;
    }
    return +(s / n).toFixed(1);
  };
  return { sky: band(20, 70), ground: band(105, 165) };
})()`;

await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");
await send("Page.navigate", { url: "http://localhost:4321/" });
await sleep(6000);
await evalJs(`(() => { const k="ftw:view-prefs:v1"; const o=JSON.parse(localStorage.getItem(k)||"{}");
  o.ultraQuality = true; localStorage.setItem(k, JSON.stringify(o)); })()`);

console.log("band      heading  sun°   skyLvl  directK  aftergl  keyLvl  disc   skyLuma groundLuma");
for (const [band, t] of SWEEP) {
  for (const [dirName, head] of [["toward", TOWARD], ["away", AWAY]]) {
    await send("Page.navigate", { url: "about:blank" });
    await sleep(400);
    await send("Page.navigate", {
      url: `http://localhost:4321/#p=${SPOT.lat},${SPOT.lon},${SPOT.alt},${head},${SPOT.tilt}&t=${t}`,
    });
    if (!(await waitFor(`!!window.__globe`))) continue;
    await evalJs(`window.__cameraStore.getState().setUltraQuality(true)`);
    await sleep(20000);
    const look = await evalJs(`window.__globe.ultraLook()`);
    const sunAlt = await evalJs(`(() => {
      const b = window.__globe.bodies();
      const p = window.__globe.camera.position.clone().normalize();
      const s = new (window.__globe.camera.position.constructor)(...b.sunDir);
      return +(Math.asin(Math.max(-1, Math.min(1, s.dot(p)))) * 180 / Math.PI).toFixed(2);
    })()`);
    const l = await evalJs(LUMA);
    const d = look.dusk ?? {};
    console.log(
      `${band.padEnd(9)} ${dirName.padEnd(7)} ${String(sunAlt).padStart(6)}  ` +
        `${(d.skyLevel ?? 0).toFixed(3)}   ${(d.directK ?? 0).toFixed(3)}    ` +
        `${(d.afterglow ?? 0).toFixed(3)}    ${(d.keyLevel ?? 0).toFixed(3)}   ` +
        `${(d.sunDiscExtinct ?? 0).toFixed(3)}  ${String(l?.sky ?? "-").padStart(6)} ${String(l?.ground ?? "-").padStart(8)}`,
    );
    await shoot(`${TAG}-${band}-${dirName}`);
  }
}

await send("Page.close").catch(() => {});
ws.close();
console.log("done");
process.exit(0);
