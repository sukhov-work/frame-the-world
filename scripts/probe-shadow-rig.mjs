#!/usr/bin/env node
/**
 * probe-shadow-rig — why does the demand-driven cascade-0 rig refresh? (T77 slice A2, 2026-09-06h)
 *
 * Boots ONE pose (ULTRA on by default), freezes time, then samples `__globe.shadowRig()` and the
 * candidate triggers (terrain epoch, `_shadowFocus` drift, key swing, staleness) over N frames so
 * a refresh count that exceeds the frame count can be attributed instead of guessed at.
 *
 *   node scripts/probe-shadow-rig.mjs [9333] [--pose city|everest|fpv] [--ultra 0|1] [--frames 120]
 */
import { ensureBrowser, httpJson, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(args.find((a, i) => /^\d+$/.test(a) && (i === 0 || !args[i - 1].startsWith("--"))) ?? 9333);
const POSE = { city: "legacy-city", everest: "legacy-everest", fpv: "legacy-fpv-eye" }[arg("--pose", "city")] ?? arg("--pose");
const ULTRA = arg("--ultra", "1") === "1";
const FRAMES = Number(arg("--frames", 120));

await ensureBrowser(PORT, { profile: "/tmp/ftw-cdp-probe" });
const target = await httpJson(PORT, "/json/new?about:blank", "PUT");
trackTarget(PORT, target.id);
const s = await openSession(target);
let code = 0;
try {
  await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => { try { const k = "ftw:view-prefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.ultraQuality = ${ULTRA}; o.debugHud = false; localStorage.setItem(k, JSON.stringify(o)); } catch {} })()`,
  });
  await s.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 2, mobile: false });
  const pose = byId(POSE);
  const { url } = poseUrl(pose, { dev: "http://localhost:4321", ultra: ULTRA });
  console.log("boot", url);
  await s.bootUrl(url);
  await s.waitFor(`!!(window.__globe && window.__globe.shadowRig && window.__globe.ultraLook && window.__globe.u5)`, 120_000, "seams");
  await s.send("Page.bringToFront");
  await s.evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), true`);
  await s.waitFor(`!window.__globe.flight || !window.__globe.flight.active()`, 60_000, "flight");
  // Freeze the clock at the pose's pinned instant (no sun motion), then let tiles settle a bit.
  await s.evalJs(`window.__timeStore.getState().setTime(${pose.t}), true`);
  await sleep(12_000);
  const rows = await s.evalJs(`(async () => {
    const out = [];
    const G = window.__globe; const R = window.__renderer;
    let prevRef = null;
    for (let i = 0; i < ${FRAMES}; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const rig = G.shadowRig(); const look = G.ultraLook(); const u5 = G.u5();
      const q = u5 && u5.ground ? (u5.ground.stats.queued + u5.ground.stats.downloading + u5.ground.stats.parsing) : -1;
      out.push({ i, refreshes: rig.refreshes, dRef: prevRef == null ? 0 : rig.refreshes - prevRef, ageMs: rig.ageMs, auto: rig.autoUpdate,
        snapTexels: rig.snapTexels, demand: rig.demand, epoch: G.terrainEpoch ? G.terrainEpoch() : (look.terrain && look.terrain.epoch) ?? null,
        boundsM: look.shadow && look.shadow.boundsM, casting: look.shadow && look.shadow.casting, mPerTexel: look.shadow && look.shadow.metresPerTexel,
        cas1: look.cascades && look.cascades[0] ? look.cascades[0].ageMs : null, groundQ: q, sunElev: look.dusk ? look.dusk.sunElevDeg : null });
      prevRef = rig.refreshes;
    }
    return out;
  })()`);
  const refreshed = rows.filter((r) => r.dRef > 0);
  console.log(`frames ${rows.length}  refresh frames ${refreshed.length}  total dRef ${rows.reduce((a, r) => a + r.dRef, 0)}  demand ${rows[0].demand} auto ${rows[0].autoUpdate}`);
  const epochs = new Set(rows.map((r) => r.epoch)); const bounds = new Set(rows.map((r) => r.boundsM));
  console.log(`distinct epochs ${epochs.size}  distinct boundsM ${bounds.size} (${[...bounds].slice(0, 4).join(",")})  groundQ first/last ${rows[0].groundQ}/${rows.at(-1).groundQ}`);
  console.log("first 12 rows:");
  for (const r of rows.slice(0, 12)) console.log(JSON.stringify(r));
  console.log("refresh rows (up to 15):");
  for (const r of refreshed.slice(0, 15)) console.log(JSON.stringify(r));
  const maxDref = Math.max(...rows.map((r) => r.dRef));
  console.log(`max dRef per frame ${maxDref}`);
} catch (e) {
  console.error("PROBE ERROR", e && e.stack ? e.stack : e);
  code = 1;
} finally {
  try { s.close(); } catch {}
  await finishVerify(code);
}
