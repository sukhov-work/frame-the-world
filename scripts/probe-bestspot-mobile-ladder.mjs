// probe (no PASS/FAIL contract): watch the /m disc ladder on the lean twin — rung, jobs, drops,
// reach, buildings — every 4 s, to see where a solve stalls. `node scripts/probe-bestspot-mobile-ladder.mjs [9333] [--no-lean] [--3d]`
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";
const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const LEAN = !args.includes("--no-lean");
const THREED = args.includes("--3d");
await ensureBrowser(PORT);
const { url } = poseUrl(byId("legacy-m"));
const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
trackTarget(PORT, target.id);
const s = await openSession(target);
if (LEAN) {
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 4, configurable: true });` });
  await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}
await s.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
await s.bootUrl(url);
await s.waitFor(`!!window.__globe && typeof window.__globe.bestSpot === "function" && !!window.__bestSpotStore`, 90_000, "globe up");
await sleep(1500);
const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
if (THREED) await s.evalJs(`window.__cameraStore.getState().setMapMode("3d")`);
await s.evalJs(`(() => { const c = window.__cameraStore.getState(); c.setTempPin({ latDeg: c.focusLatDeg, lonDeg: c.focusLonDeg }); const b = window.__bestSpotStore.getState(); b.setOpen(true); b.setHeatmapOn(true); return true; })()`);
const t0 = Date.now();
for (let i = 0; i < 20; i++) {
  await sleep(4000);
  const r = await J(`(() => { const st = window.__bestSpotStore.getState(); const f = window.__globe.bestSpot(); const b = window.__globe.buildingsLoad?.(); const sh = window.__globe.bestSpotSheet(); return { t: 0, rung: st.ladderRung, cell: st.gridCellM, cellReq: st.cellM, solving: st.solving, tiles: st.tilesPending, topK: st.topK.length, reach: Math.round(st.reachM), cov: +st.coverage.toFixed(2), counts: st.verdictCounts.total, hp: st.heightProvenance, terrainOnly: st.terrainOnly, jobs: f.jobs, drops: f.drops, inFlight: f.inFlight, keys: f.keys, timings: f.timings, honesty: f.honesty, lastClass: f.lastClass, bld: b ? { tiles: b.tiles, meshes: b.meshes, pending: b.pending } : null, mapMode: window.__cameraStore.getState().mapMode, sheet: sh.visible, fade: +sh.fade.toFixed(2) }; })()`);
  r.t = Math.round((Date.now() - t0) / 1000);
  console.log(JSON.stringify(r));
}
s.close();
await finishVerify(0);
