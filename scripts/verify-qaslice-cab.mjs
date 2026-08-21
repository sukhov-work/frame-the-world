// Browser verification for the PRE-AUDIT QA SLICE (owner 2026-08-21g-end, order C → A → B).
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/verify-qaslice-cab.mjs [cdpPort] [shotsDir]
//
// Asserts (/m leg — mobile emulation; the fixed code paths are shell-shared):
//   C. overlay-composite stickiness — the SECOND full 2D→FPV→2D cycle issues ≈0 new Esri
//      GETs (the QA-7b regression rebuilt the whole overlay stack per flip: white chart +
//      a tile refetch storm) and the chart never white-gaps (uFtwFade holds, shots).
//   A. expanded-minimap manual-pan latch — a drag STAYS (no snap-back while standing);
//      an explicit walk re-arms the follow and recentres the chart onto the eye.
//   B. screen-relative walk — after a two-finger TWIST, stick-up walks CHART-up: the
//      world track's compass bearing ≈ −rot (published via store/minimap.mapWindowRotRad).
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — sun well up in Dnipro
// Low street altitude — the flat 2D chart runs its deep error target, so overlay composites
// are hot when the mode flips (the storm's worst case).
const M_URL = `http://localhost:4321/m#p=48.4640,35.0460,220,0,0&t=${NOON_UTC}`;

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
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
// Esri GET counter via CDP Network — performance resource entries overflow at 250 long
// before deep tile levels arrive (the qa7ab lesson).
let esriGets = 0;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === "Network.requestWillBeSent") {
    if (/World_Imagery\/MapServer\/tile\//.test(msg.params.request.url)) esriGets++;
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
await send("Network.enable");
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const shoot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.data, "base64"));
  console.log(`shot  ${SHOTS}/${name}.jpeg`);
};
const waitFor = async (expr, timeoutMs = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(expr)) return true;
    } catch {
      /* booting */
    }
    await sleep(500);
  }
  return false;
};
// Wait until the Esri GET stream has been quiet for `quietMs` (initial load / storm settle).
const waitEsriQuiet = async (quietMs = 4000, capMs = 40000) => {
  const t0 = Date.now();
  let last = esriGets;
  let lastChange = Date.now();
  while (Date.now() - t0 < capMs) {
    await sleep(1000);
    if (esriGets !== last) {
      last = esriGets;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) return true;
  }
  return false;
};
const longPress = async (x, y, holdMs = 700) => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await sleep(holdMs);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const enterFpv = async () => {
  const r = await evalJs(`(() => { const el = document.querySelector(".m-actrow button");
    if (!el) return null; const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) return false;
  await longPress(r.x, r.y);
  return waitFor(`window.__cameraStore.getState().fpvHud !== null`, 12000);
};
const exitFpv = async () => {
  await evalJs(`window.__cameraStore.getState().setTempFpv(false)`);
  return waitFor(`window.__cameraStore.getState().fpvHud === null`, 12000);
};
// Eye↔point distance in metres (equirectangular at these scales).
const distM = (a, b) => {
  const dN = (a.latDeg - b.latDeg) * 111320;
  const dE = (a.lonDeg - b.lonDeg) * 111320 * Math.cos((b.latDeg * Math.PI) / 180);
  return Math.hypot(dN, dE);
};

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: M_URL });
await sleep(14000);
check("/m: engine booted", await waitFor(`!!window.__cameraStore && !!window.__globe`));

// ── C. overlay-composite stickiness ─────────────────────────────────────────────────────
// Let the boot chart settle (initial load + the one legitimate sticky raise to 512).
check("/m 2D: initial Esri load settles", await waitEsriQuiet(4000, 45000), `${esriGets} GETs so far`);
await shoot("qsl-01-m-2d-settled");
// The invariant is the REBUILD counter, not raw GETs: the pre-existing LRU rest-trim churn
// (tracked — the #15 SW-cache motivation) re-fetches evicted tiles' sources at the same
// magnitude a rebuild would, so GET counts can't isolate the storm. A rebuild destroys ALL
// resident composites (the white chart); the LRU churn only re-composites re-loaded tiles.
const reb0 = await evalJs(`window.__overlayRebuilds ?? 0`);
check("C: ≤1 rebuild by boot settle (the one legitimate sticky raise 256→512)", reb0 <= 1, `${reb0} rebuilds`);
const lruProbe = `(() => { const c = window.__globe?.ground?.lruCache; return c ? { mb: Math.round((c.cachedBytes ?? 0) / 1048576), min: Math.round((c.minBytesSize ?? 0) / 1048576), max: Math.round((c.maxBytesSize ?? 0) / 1048576) } : null; })()`;

// Two full 2D→FPV→2D cycles: with the STICKY composite resolution NEITHER flip may rebuild
// the overlay stack (QA-7b rebuilt on every flip). GET counts per leg are diagnostics.
const legGets = [];
for (let cyc = 1; cyc <= 2; cyc++) {
  const g0 = esriGets;
  check(`/m: FPV entered (cycle ${cyc})`, await enterFpv());
  await waitEsriQuiet(4000, 30000);
  const gFpv = esriGets - g0;
  check(`/m: back to 2D (cycle ${cyc})`, await exitFpv());
  await waitEsriQuiet(4000, 30000);
  legGets.push({ cyc, fpv: gFpv, back: esriGets - g0 - gFpv, lru: await evalJs(lruProbe) });
}
const rebEnd = await evalJs(`window.__overlayRebuilds ?? 0`);
check(
  "C: ZERO overlay rebuilds across both 2D↔FPV cycles (sticky composite — the storm is dead)",
  rebEnd === reb0,
  `${rebEnd - reb0} new rebuilds; legs ${JSON.stringify(legGets)}`,
);
// No white gap: the ground reveal never dips (a rebuild used to blank every composite).
const fade = await evalJs(`window.__globe?.groundUniforms?.uFtwFade?.value ?? null`);
check("C: ground reveal holds after the cycles (uFtwFade ≈ 1, no white chart)", fade !== null && fade > 0.9, String(fade));
await shoot("qsl-02-m-2d-after-cycles");

// ── A. manual-pan latch on the expanded chart ───────────────────────────────────────────
check("/m: FPV re-entered for the map leg", await enterFpv());
await evalJs(`(() => { const el = document.querySelector(".mm-open"); el?.click(); return !!el; })()`);
await sleep(2500);
check("/m: fullscreen map open", await evalJs(`!!document.querySelector(".mw")`));
const eye0 = await evalJs(`window.__cameraStore.getState().camGeo`);
const v0 = await evalJs(`window.__mapWindowView ?? null`);
check("/m: __mapWindowView probe live", v0 !== null, JSON.stringify(v0));

// Drag the chart ~300 CSS px up-left (fast — never a long-press; clear of the left stick
// rail x≲126 and the top-right PiP). The follow used to snap it back on release.
{
  const path = [
    [330, 640],
    [300, 560],
    [250, 480],
    [180, 400],
    [140, 340],
  ];
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: path[0][0], y: path[0][1], id: 1 }] });
  for (const [x, y] of path.slice(1)) {
    await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
    await sleep(40);
  }
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
await sleep(600);
const vDragged = await evalJs(`window.__mapWindowView`);
const draggedAwayM = eye0 && vDragged ? distM(vDragged, eye0) : 0;
check("A: drag moved the chart off the eye", draggedAwayM > 40, `${draggedAwayM.toFixed(0)} m`);
await sleep(3000); // standing still — the old follow recentred within one paint
const vHeld = await evalJs(`window.__mapWindowView`);
check(
  "A: chart STAYS where dragged while standing (manual-pan latch, no snap-back)",
  vHeld !== null && distM(vHeld, vDragged) < 5,
  `moved ${vHeld ? distM(vHeld, vDragged).toFixed(1) : "?"} m in 3 s`,
);
await shoot("qsl-03-m-chart-dragged-held");

// Explicit walk (the /m stick's store write) → the eye-motion detector re-arms the follow
// and the rubber band recentres the chart onto the eye (deadband ≈ 12% of min(w,h)).
await evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`);
await sleep(1800);
await evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
await sleep(1200);
const eyeAfterWalk = await evalJs(`window.__cameraStore.getState().camGeo`);
const vAfterWalk = await evalJs(`window.__mapWindowView`);
const walkedM = eye0 && eyeAfterWalk ? distM(eyeAfterWalk, eye0) : 0;
check("A: walk moved the eye (re-arm trigger)", walkedM > 0.5, `${walkedM.toFixed(1)} m`);
check(
  "A: walking re-armed the follow — chart recentred onto the eye",
  vAfterWalk !== null && eyeAfterWalk !== null && distM(vAfterWalk, eyeAfterWalk) < 30,
  `chart ${vAfterWalk && eyeAfterWalk ? distM(vAfterWalk, eyeAfterWalk).toFixed(1) : "?"} m from eye`,
);
await shoot("qsl-04-m-follow-rearmed");

// ── B. screen-relative walk on a TWISTED chart ──────────────────────────────────────────
check("B: rot published while open (store/minimap)", (await evalJs(`window.__minimapStore.getState().mapWindowRotRad`)) !== null);
// Two-finger twist, constant 100 px separation (pure rotation, no zoom): the pair pivots
// ~90° about (240, 480) — clear of the stick rail and the PiP.
{
  const cx = 240, cy = 480, r = 50;
  const steps = 8;
  const pts = (a) => [
    { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: 1 },
    { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a), id: 2 },
  ];
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(0) });
  for (let i = 1; i <= steps; i++) {
    await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts((i / steps) * (Math.PI / 2)) });
    await sleep(50);
  }
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
await sleep(800);
const rotState = await evalJs(`({ view: window.__mapWindowView?.rot ?? null, pub: window.__minimapStore.getState().mapWindowRotRad })`);
check(
  "B: twist landed + published (view.rot ≈ mapWindowRotRad ≠ 0)",
  rotState.view !== null && rotState.pub !== null && Math.abs(rotState.view) > 0.5 && Math.abs(rotState.view - rotState.pub) < 0.01,
  JSON.stringify(rotState),
);

// Stick-UP on the twisted chart: the world track's compass bearing must be −rot (chart-up),
// NOT the camera heading and NOT north.
const eyeB0 = await evalJs(`window.__cameraStore.getState().camGeo`);
await evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`);
await sleep(1800);
await evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
await sleep(600);
const eyeB1 = await evalJs(`window.__cameraStore.getState().camGeo`);
{
  const dN = (eyeB1.latDeg - eyeB0.latDeg) * 111320;
  const dE = (eyeB1.lonDeg - eyeB0.lonDeg) * 111320 * Math.cos((eyeB0.latDeg * Math.PI) / 180);
  const trackAz = ((Math.atan2(dE, dN) * 180) / Math.PI + 360) % 360;
  const wantAz = (((-rotState.pub * 180) / Math.PI) % 360 + 360) % 360;
  const dAz = Math.abs((((trackAz - wantAz) % 360) + 540) % 360 - 180);
  const heading = await evalJs(`window.__cameraStore.getState().fpvHud?.headingDeg ?? null`);
  check(
    "B: stick-up walks CHART-up on the twisted chart (track ≈ −rot, world-correct)",
    Math.hypot(dN, dE) > 0.5 && dAz < 6,
    `track ${trackAz.toFixed(1)}° vs chart-up ${wantAz.toFixed(1)}° (Δ ${dAz.toFixed(1)}°; camera heading ${heading?.toFixed?.(0)}°)`,
  );
}
await shoot("qsl-05-m-twisted-chart-walk");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
