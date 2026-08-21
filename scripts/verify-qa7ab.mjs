// Browser verification for QA-7 a+b (owner 2026-08-21f follow-up: "try both").
// (a) photographic flat-2D chart — the stylized ground grade lerps out on the /m 2D map
// (b) crispness — esriMaxLevelCoarse 17→18 + flat-2D-only DPR 1.5 (leanMobile.dprCap2d)
// Usage: wix dev on :4321 + CDP Chrome, then
//   node --experimental-websocket scripts/verify-qa7ab.mjs [cdpPort] [shotsDir]
import { writeFileSync, mkdirSync } from "node:fs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z
// Low street altitude — deep 2D error target + small tile ranges pull the deepest Esri level.
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
// Esri fetches by level via the CDP Network domain — performance resource entries overflow
// their 250-entry buffer long before the deep levels arrive (bit this script once).
const esriLevels = {};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === "Network.requestWillBeSent") {
    const m = msg.params.request.url.match(/World_Imagery\/MapServer\/tile\/(\d+)\//);
    if (m) esriLevels[m[1]] = (esriLevels[m[1]] ?? 0) + 1;
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
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

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: M_URL });
await sleep(14000);
check("/m: engine booted", await waitFor(`!!window.__cameraStore && !!window.__globe`));

// (b) flat-2D DPR — assert CONSISTENCY against the governed tier: dpr must equal
// min(devicePixelRatio, tier cap, lean 2D cap 1.5). A headless run governs to `low`
// (1.25 binds); a real mid-tier phone reaches 1.5 — same formula either way.
const CAPS = { high: 2, mid: 1.5, low: 1.25 };
const q2d = await evalJs(`window.__globeQuality ?? null`);
check(
  "/m 2D: flat latch armed + DPR = min(dpr, tierCap, dprCap2d 1.5)",
  q2d !== null &&
    q2d.lean === true &&
    q2d.flat2d === true &&
    Math.abs(q2d.dpr - Math.min(3, CAPS[q2d.tier], 1.5)) < 0.01,
  JSON.stringify(q2d),
);

// (b) z18 Esri tiles now fetch on the coarse-pointer chart (cap 17→18 + the 512 composite —
// the level chooser needs BOTH; watched via CDP Network, resource entries overflow at 250)
{
  const t0 = Date.now();
  while (!esriLevels["18"] && Date.now() - t0 < 25000) await sleep(1000);
  check(
    "/m 2D: z18 Esri tiles fetched (coarse cap 17→18 + 512 chart composite)",
    (esriLevels["18"] ?? 0) > 0,
    `levels ${JSON.stringify(esriLevels)}`,
  );
}

// (a) photographic de-grade armed: eased flat2d ≈ 1 and the strength uniform = tunable
const photo = await evalJs(`(() => { const u = window.__globe?.groundUniforms; return u ? { flat: u.uFtwFlat2d.value, k: u.uFtwPhotoK.value } : null; })()`);
check("/m 2D: photo de-grade armed (uFtwFlat2d ≈ 1, uFtwPhotoK = 1)", photo !== null && photo.flat > 0.95 && photo.k === 1, JSON.stringify(photo));
await shoot("qa7-01-m-2d-photographic-chart");

// FPV: the heat cap returns (1.25) — long-press ▲3D
const chip = await evalJs(`(() => { const el = document.querySelector(".m-actrow button"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
if (chip) {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: chip.x, y: chip.y, id: 1 }] });
  await sleep(700);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(5200);
  await waitFor(`window.__globeQuality && window.__globeQuality.flat2d === false`, 10000);
  const qFpv = await evalJs(`window.__globeQuality ?? null`);
  check(
    "/m FPV: flat latch released + DPR = min(dpr, tierCap, heat cap 1.25)",
    qFpv !== null &&
      qFpv.flat2d === false &&
      Math.abs(qFpv.dpr - Math.min(3, CAPS[qFpv.tier], 1.25)) < 0.01,
    JSON.stringify(qFpv),
  );
  await shoot("qa7-02-m-fpv-heat-cap-back");
} else {
  check("/m: ▲3D chip found", false);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
