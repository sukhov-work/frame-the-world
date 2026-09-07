#!/usr/bin/env node
/**
 * RC20 / T34 / T83 probe (2026-09-07e) — the ground-LRU FLIP BANK under the PHONE caps.
 *
 * T83 shrank a phone's ground cache to `QUALITY.leanMobile.groundLruBytesMB` (112 MB) and the
 * flip bank (`QUALITY.lruBank`, mid/low only) was never re-measured under it. This boots `/m`
 * as the phone twin (touch + 402×714 @3 + 4 cores ⇒ lean + tier `mid`), lets the 2D chart
 * settle, then runs two full 2D → FPV → 2D cycles counting Esri World_Imagery GETs per leg
 * through CDP Network (the `verify-qaslice-cab` idiom) and reading the ground LRU's own state
 * (`__globe.u2().lru.ground`: cached / floor / cap / bankMsLeft) at every stage. Diagnostics
 * only — no assertion; the numbers go to MEASUREMENTS.
 *
 *   node --experimental-websocket scripts/probe-flip-bank.mjs 9333 [--cycles 2] [--label x]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureBrowser, sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const cyclesArg = args.indexOf("--cycles");
const CYCLES = cyclesArg >= 0 ? Number(args[cyclesArg + 1]) : 2;
const labelArg = args.indexOf("--label");
const LABEL = labelArg >= 0 ? args[labelArg + 1] : "flip-bank-phone";
const NOON_UTC = 1787313600000; // 2026-08-21T12:00Z — sun well up in Dnipro (the cab leg's instant)
const M_URL = `http://localhost:4321/m#p=48.4640,35.0460,220,0,0&t=${NOON_UTC}`;

await ensureBrowser(PORT);
let target;
try {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
} catch {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
}
trackTarget(PORT, target.id);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let seq = 0;
const pending = new Map();
let esriGets = 0;
let esriBytes = 0;
const byUrl = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === "Network.requestWillBeSent") {
    if (/World_Imagery\/MapServer\/tile\//.test(msg.params.request.url)) {
      esriGets++;
      byUrl.set(msg.params.requestId, msg.params.request.url);
    }
  } else if (msg.method === "Network.loadingFinished" && byUrl.has(msg.params.requestId)) {
    esriBytes += msg.params.encodedDataLength ?? 0;
    byUrl.delete(msg.params.requestId);
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
const LRU = `(async () => { const u = await window.__globe.u2(); const g = u.lru.ground; return { cachedMB: +(g.cached / 1048576).toFixed(1), floorMB: +(g.min / 1048576).toFixed(1), capMB: +(g.max / 1048576).toFixed(1), items: g.items, bankMsLeft: g.bankMsLeft }; })()`;
const state = async () => ({
  lru: await evalJs(LRU),
  rebuilds: await evalJs(`window.__overlayRebuilds ?? 0`),
  gets: esriGets,
  bytesMB: +(esriBytes / 1048576).toFixed(2),
});

// The phone twin — the `probe-memory-footprint --phone` idiom (touch ⇒ coarse pointer ⇒ lean;
// 4 cores ⇒ tier mid, where the bank is ON). No CPU throttle: this is a network/cache count.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 4, configurable: true });`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: M_URL });
await sleep(14000);
if (!(await waitFor(`!!window.__cameraStore && !!window.__globe && !!window.__globeQuality`))) throw new Error("/m did not boot");
await evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), true`);
const groundMode = await evalJs(`window.__cameraStore.getState().groundMode`);
const quality = await evalJs(`JSON.stringify({ tier: window.__globeQuality.tier, tileTier: window.__globeQuality.tileTier, lean: window.__globeQuality.lean ?? null })`);
const settled = await waitEsriQuiet(4000, 45000);
const boot = await state();
const legs = [];
for (let cyc = 1; cyc <= CYCLES; cyc++) {
  const g0 = esriGets;
  const b0 = esriBytes;
  const entered = await enterFpv();
  await waitEsriQuiet(4000, 30000);
  const inFpv = await state();
  const gFpv = esriGets - g0;
  const exited = await exitFpv();
  await waitEsriQuiet(4000, 30000);
  const back = await state();
  legs.push({
    cyc,
    entered,
    exited,
    getsToFpv: gFpv,
    getsBackTo2d: esriGets - g0 - gFpv,
    legMB: +((esriBytes - b0) / 1048576).toFixed(2),
    lruInFpv: inFpv.lru,
    lruBack: back.lru,
    rebuilds: back.rebuilds,
  });
}
const out = { label: LABEL, url: M_URL, groundMode, quality: JSON.parse(quality), bootSettled: settled, boot, legs, totalGets: esriGets, totalMB: +(esriBytes / 1048576).toFixed(2) };
mkdirSync("verify-shots/flip-bank", { recursive: true });
const file = `verify-shots/flip-bank/${LABEL}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log(`wrote ${file}`);
ws.close();
await finishVerify(0);
