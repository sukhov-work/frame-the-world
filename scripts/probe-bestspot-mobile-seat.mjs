import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";
const PORT = 9333;
const ARM = !process.argv.includes("--no-arm");
await ensureBrowser(PORT);
const { url } = poseUrl(byId("legacy-m"));
const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
trackTarget(PORT, target.id);
const s = await openSession(target);
await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await s.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
await s.bootUrl(url);
await s.waitFor(`!!window.__globe && typeof window.__globe.bestSpot === "function" && !!window.__bestSpotStore`, 90_000, "globe up");
await sleep(1500);
const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
if (ARM) await s.evalJs(`(() => { const c = window.__cameraStore.getState(); c.setTempPin({ latDeg: c.focusLatDeg, lonDeg: c.focusLonDeg }); const b = window.__bestSpotStore.getState(); b.setOpen(true); b.setHeatmapOn(true); return true; })()`);
for (let i = 0; i < 4; i++) {
  await sleep(3000);
  const r = await J(`(() => { const ss = window.__globe.seatSettle?.(); const cs = window.__globe.enrichedCellSeats?.(); const f = window.__globe.bestSpot(); return { seatEpoch: f.stream?.seatEpoch, reasons: ss?.enriched?.applyReasons, settleKeys: ss ? Object.keys(ss.enriched || {}) : null }; })()`);
  console.log(JSON.stringify(r).slice(0, 1400));
}
s.close();
await finishVerify(0);
