// Tile-cache behaviour measurement (batch #4 item 15 / S3 opener — owner addendum 2026-08-21:
// verify the re-fetch storm in DESKTOP Chrome with the HTTP cache ENABLED, both views, before
// trusting the "iOS cache too small" ranking).
//
// Usage: wix dev on :4321 + CDP Chrome (scripts/verify-chrome.mjs), then
//   node --experimental-websocket scripts/measure-tile-cache.mjs [cdpPort]
//
// Method, per view (desktop 1600×1000 / mobile 390×844 dsf3 touch):
//   phase LOAD   — boot the orbit pose, settle, record every tile response
//   phase WANDER — drag-pan far away and back (LRU churn), keep recording
//   phase RELOAD — fresh navigation to the same pose (disk-cache test), keep recording
// A URL re-requested over the NETWORK (not served from cache) after having been fetched once
// = the re-fetch storm signature. Cache is explicitly ENABLED (Network.setCacheDisabled false).
import process from "node:process";

const PORT = process.argv[2] ?? "9222";
const NOON_UTC = 1787313600000;
const ORBIT_URL = `http://localhost:4321/#p=48.4640,35.0460,2500,0,30&t=${NOON_UTC}`;
const TILE_HOSTS = [
  "server.arcgisonline.com",
  "basemaps.cartocdn.com",
  "assets.ion.cesium.com",
  "workers.dev",
  "openfreemap",
  "tile.googleapis.com",
];

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach() {
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
  const handlers = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res } = pending.get(msg.id);
      pending.delete(msg.id);
      res(msg.result ?? {});
    } else if (msg.method) {
      for (const h of handlers) h(msg);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq;
      pending.set(id, { res });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, onEvent: (h) => handlers.push(h) };
}

async function measure(label, metrics) {
  const t = await attach();
  await t.send("Page.enable");
  await t.send("Network.enable", { maxTotalBufferSize: 200_000_000 });
  await t.send("Network.setCacheDisabled", { cacheDisabled: false }); // cache ON — the point
  if (metrics.mobile) {
    await t.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  await t.send("Emulation.setDeviceMetricsOverride", metrics);

  // requestId → url so loadingFinished bytes + servedFromCache map back to tiles.
  const reqUrl = new Map();
  // url → per-phase counters
  const stats = new Map();
  let phase = "LOAD";
  const bump = (url, kind, bytes = 0) => {
    if (!TILE_HOSTS.some((h) => url.includes(h))) return;
    let e = stats.get(url);
    if (!e) stats.set(url, (e = {}));
    const p = (e[phase] ??= { net: 0, disk: 0, mem: 0, bytes: 0 });
    p[kind]++;
    p.bytes += bytes;
  };
  t.onEvent((msg) => {
    if (msg.method === "Network.requestWillBeSent") {
      reqUrl.set(msg.params.requestId, msg.params.request.url);
    } else if (msg.method === "Network.requestServedFromCache") {
      const url = reqUrl.get(msg.params.requestId);
      if (url) bump(url, "mem");
    } else if (msg.method === "Network.responseReceived") {
      const { response } = msg.params;
      const url = response.url;
      if (response.fromDiskCache) bump(url, "disk");
      else if (!response.fromServiceWorker && !response.fromPrefetchCache) {
        // net counted at loadingFinished (bytes there); mark presence for 304s w/o body
        bump(url, "net", 0);
      }
    } else if (msg.method === "Network.loadingFinished") {
      const url = reqUrl.get(msg.params.requestId);
      if (url && TILE_HOSTS.some((h) => url.includes(h))) {
        const e = stats.get(url);
        const p = e?.[phase];
        if (p) p.bytes += msg.params.encodedDataLength;
      }
    }
  });

  const goto = async (url, settle) => {
    await t.send("Page.navigate", { url });
    await sleep(settle);
  };
  const mouse = (type, x, y, opts = {}) =>
    t.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...opts });
  const dragPan = async (cx, cy, dx, dy) => {
    await mouse("mousePressed", cx, cy, { buttons: 1 });
    for (let i = 1; i <= 10; i++) {
      await mouse("mouseMoved", cx + (dx * i) / 10, cy + (dy * i) / 10, { buttons: 1 });
      await sleep(30);
    }
    await mouse("mouseReleased", cx + dx, cy + dy);
    await sleep(300);
  };

  phase = "LOAD";
  await goto(ORBIT_URL, 18000);
  phase = "WANDER";
  const cx = metrics.width / 2;
  const cy = metrics.height / 2;
  // Pan far away and back — enough churn to trip LRU eviction on the small caches.
  for (const [dx, dy] of [[-500, 0], [-500, 0], [0, -400], [500, 0], [500, 0], [0, 400]]) {
    await dragPan(cx, cy, dx, dy);
    await sleep(2500);
  }
  await sleep(4000);
  phase = "RELOAD";
  await goto("about:blank", 400);
  await goto(ORBIT_URL, 18000);

  // Aggregate per phase.
  const agg = {};
  for (const [url, phases] of stats) {
    for (const [ph, p] of Object.entries(phases)) {
      const a = (agg[ph] ??= { urls: new Set(), net: 0, disk: 0, mem: 0, bytes: 0, dupNet: 0 });
      a.urls.add(url);
      a.net += p.net;
      a.disk += p.disk;
      a.mem += p.mem;
      a.bytes += p.bytes;
    }
  }
  // Storm signature: same URL over the NETWORK in more than one phase (or >1× in one phase).
  let refetchedUrls = 0;
  let wanderRefetch = 0;
  let reloadNet = 0;
  let reloadDisk = 0;
  for (const [, phases] of stats) {
    const totalNet = Object.values(phases).reduce((s, p) => s + p.net, 0);
    if (totalNet > 1) refetchedUrls++;
    if (phases.LOAD?.net && phases.WANDER?.net) wanderRefetch++;
    if (phases.RELOAD) {
      reloadNet += phases.RELOAD.net;
      reloadDisk += phases.RELOAD.disk + phases.RELOAD.mem;
    }
  }
  console.log(`\n== ${label} ==`);
  for (const ph of ["LOAD", "WANDER", "RELOAD"]) {
    const a = agg[ph];
    if (!a) continue;
    console.log(
      `${ph.padEnd(7)} urls=${a.urls.size}  net=${a.net}  disk=${a.disk}  mem=${a.mem}  MB=${(a.bytes / 1e6).toFixed(1)}`,
    );
  }
  console.log(
    `storm:  urls net-fetched >1× total=${refetchedUrls} · LOAD-then-WANDER re-fetch=${wanderRefetch} · RELOAD net=${reloadNet} vs cached=${reloadDisk}`,
  );
  return { refetchedUrls, wanderRefetch, reloadNet, reloadDisk };
}

console.log("cache ENABLED measurement — LOAD → WANDER (pan loop) → RELOAD (same pose)");
const desktop = await measure("DESKTOP view (1600×1000 dsf1)", {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
const mobile = await measure("MOBILE view (390×844 dsf3 touch)", {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
});
console.log("\nVERDICT:");
console.log(
  `desktop: ${desktop.reloadNet === 0 ? "disk cache HOLDS on reload" : `${desktop.reloadNet} net re-fetches on reload — cache NOT holding`}` +
    ` · in-session re-fetch ${desktop.wanderRefetch ? `PRESENT (${desktop.wanderRefetch} urls)` : "absent"}`,
);
console.log(
  `mobile : ${mobile.reloadNet === 0 ? "disk cache HOLDS on reload" : `${mobile.reloadNet} net re-fetches on reload — cache NOT holding`}` +
    ` · in-session re-fetch ${mobile.wanderRefetch ? `PRESENT (${mobile.wanderRefetch} urls)` : "absent"}`,
);
process.exit(0);
