#!/usr/bin/env node
/**
 * probe-seat-loop — attribute the FPV-eye seat churn (T77 slice B, 2026-09-06h).
 *
 * Boots the Dnipro FPV eye, lets it stream, then every ~1 s dumps `__globe.enrichedCellSeats(6)`
 * (the cells with the most gate hits, their plane depth/gate, their worst features) and re-samples
 * one fixed footprint through `__globe.terrainSample` so a height that flip-flops between tile
 * depths shows up as a row, not a theory.
 *
 *   node scripts/probe-seat-loop.mjs [9334] [--seconds 40]
 */
import { ensureBrowser, httpJson, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(args.find((a, i) => /^\d+$/.test(a) && (i === 0 || !args[i - 1].startsWith("--"))) ?? 9334);
const SECONDS = Number(arg("--seconds", 40));

await ensureBrowser(PORT, { profile: "/tmp/ftw-cdp-2" });
const target = await httpJson(PORT, "/json/new?about:blank", "PUT");
trackTarget(PORT, target.id);
const s = await openSession(target);
let code = 0;
try {
  await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => { try { const k = "ftw:view-prefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.ultraQuality = false; o.debugHud = false; localStorage.setItem(k, JSON.stringify(o)); } catch {} })()`,
  });
  await s.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 2, mobile: false });
  const pose = byId("legacy-fpv-eye");
  const { url } = poseUrl(pose, { dev: "http://localhost:4321", ultra: false });
  console.log("boot", url);
  await s.bootUrl(url);
  await s.waitFor(`!!(window.__globe && window.__globe.enrichedCellSeats && window.__globe.terrainSample && window.__globe.seatSettle)`, 120_000, "seams");
  await s.send("Page.bringToFront");
  await s.evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), true`);
  await s.waitFor(`!window.__globe.flight || !window.__globe.flight.active()`, 60_000, "flight");
  await s.evalJs(`window.__timeStore.getState().setTime(${pose.t}), true`);
  // A fixed footprint near the eye to re-sample every tick.
  const eye = { lat: 48.4647, lon: 35.0462 };
  let prev = null;
  for (let t = 0; t < SECONDS; t += 2) {
    await sleep(2000);
    const snap = await s.evalJs(`(() => {
      const G = window.__globe; const ss = G.seatSettle(); const e = ss.enriched;
      const smp = G.terrainSample(${eye.lat}, ${eye.lon});
      const cells = G.enrichedCellSeats(5);
      const ps = G.terrainPickStats ? G.terrainPickStats() : null;
      const u5 = G.u5(); const q = u5 && u5.ground ? (u5.ground.stats.queued + u5.ground.stats.downloading + u5.ground.stats.parsing) : -1;
      return { frame: ss.frameCount, epoch: ss.terrainEpoch, rejected: e.rejected, collapsed: e.collapsed, shallow: e.shallow, moved: e.movedFeatures, maxResid: e.maxResidualM, cityQ: q, smp, cells, ps };
    })()`);
    const d = prev ? { dRej: snap.rejected - prev.rejected, dCol: snap.collapsed - prev.collapsed, dSh: snap.shallow - prev.shallow, dEpoch: snap.epoch - prev.epoch } : {};
    console.log(`t=${t}s frame ${snap.frame} epoch ${snap.epoch} (+${d.dEpoch ?? 0}) rej +${d.dRej ?? 0} col +${d.dCol ?? 0} shallow +${d.dSh ?? 0} moved ${snap.moved} maxResid ${snap.maxResid?.toFixed(2)} groundQ ${snap.cityQ}  eyeSample ${JSON.stringify(snap.smp)}`);
    for (const c of snap.cells.slice(0, 3)) {
      console.log(`   cell ${c.uri} seat ${c.seatM?.toFixed(2)} depth ${c.seatDepth} gate ${c.gateM.toFixed(1)} relief ${c.reliefM.toFixed(1)} rejected ${c.rejected} dirty ${c.dirtyFrames} feats ${c.features} worst ${JSON.stringify(c.worst.map((w) => ({ s: w.seatM?.toFixed?.(1) ?? null, d: w.seatDepth, a: w.appliedM?.toFixed?.(1) ?? null, r: +w.residM.toFixed(1) })))}`);
    }
    prev = snap;
  }
  const ps = await s.evalJs(`JSON.stringify(window.__globe.terrainPickStats ? window.__globe.terrainPickStats() : null)`);
  console.log("pickStats", ps);
} catch (e) {
  console.error("PROBE ERROR", e && e.stack ? e.stack : e);
  code = 1;
} finally {
  try { s.close(); } catch {}
  await finishVerify(code);
}
