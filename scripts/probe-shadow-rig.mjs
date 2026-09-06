#!/usr/bin/env node
/**
 * probe-shadow-rig — why does the demand-driven cascade-0 rig refresh? (T77 slice A2, 2026-09-06h)
 *
 * Boots ONE pose (ULTRA on by default), freezes time, then samples `__globe.shadowRig()` and the
 * candidate triggers (terrain epoch, `_shadowFocus` drift, key swing, staleness) over N frames so
 * a refresh count that exceeds the frame count can be attributed instead of guessed at.
 *
 *   node scripts/probe-shadow-rig.mjs [9333] [--pose city|everest|fpv|<catalogue id>] [--ultra 0|1]
 *        [--frames 120] [--settle 12000] [--live]
 *
 * T77 slice A-rest (2026-09-06, lever 12) added the last two. `--settle 0 --live` is the STREAMING
 * mode: the clock is left running and the sampling starts the moment the flight lands, so the
 * terrain epoch is still bumping and `shadow.rig.refreshes` can be attributed to NEW CASTERS
 * rather than to a settled rig's staleness net. That is the reading lever 12 ("cache the terrain
 * shadow") has to be closed or kept on — a rig that already re-renders exactly when tiles arrive
 * has nothing left for a cache to save.
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
/** Quiet time (ms) between the flight landing and the first sampled frame. 0 = sample the stream. */
const SETTLE_MS = Number(arg("--settle", 12_000));
/** Leave the clock RUNNING (the sun keeps moving) — the honest state for a streaming reading. */
const LIVE = args.includes("--live");

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
  const { url } = poseUrl(pose, { dev: process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321", ultra: ULTRA });
  console.log("boot", url);
  await s.bootUrl(url);
  await s.waitFor(`!!(window.__globe && window.__globe.shadowRig && window.__globe.ultraLook && window.__globe.u5)`, 120_000, "seams");
  await s.send("Page.bringToFront");
  await s.evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), true`);
  await s.waitFor(`!window.__globe.flight || !window.__globe.flight.active()`, 60_000, "flight");
  // Freeze the clock at the pose's pinned instant (no sun motion), then let tiles settle a bit.
  // `--live` skips the freeze so a streaming leg reads the rig under a moving sun as well as
  // moving terrain; `--settle 0` starts sampling the moment the flight lands.
  if (!LIVE) await s.evalJs(`window.__timeStore.getState().setTime(${pose.t}), true`);
  if (SETTLE_MS > 0) await sleep(SETTLE_MS);
  const rows = await s.evalJs(`(async () => {
    const out = [];
    const G = window.__globe; const R = window.__renderer;
    let prevRef = null;
    for (let i = 0; i < ${FRAMES}; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const rig = G.shadowRig(); const look = G.ultraLook(); const u5 = G.u5();
      const q = u5 && u5.ground ? (u5.ground.stats.queued + u5.ground.stats.downloading + u5.ground.stats.parsing) : -1;
      // \`epoch\`/\`epochApplied\` come off the RIG's own record (T77 slice A-rest). The obvious
      // alternatives — \`G.terrainEpoch?.()\` and \`ultraLook().terrain.epoch\` — do not exist:
      // \`__globe\` has no top-level terrainEpoch and \`ultraLook().terrain\` is the cast CENSUS.
      // Both read \`undefined\` on every frame, which is a fail-open attribution (every refresh
      // lands in "not epoch-driven"). The guard below proves the field can actually move.
      out.push({ i, refreshes: rig.refreshes, dRef: prevRef == null ? 0 : rig.refreshes - prevRef, ageMs: rig.ageMs, auto: rig.autoUpdate,
        snapTexels: rig.snapTexels, demand: rig.demand, epoch: rig.epochLive ?? null, epochApplied: rig.epochApplied ?? null,
        rigHalfExtentM: rig.halfExtentM ?? null, cascadesCasting: rig.cascadesCasting ?? null,
        boundsM: look.shadow && look.shadow.boundsM, casting: look.shadow && look.shadow.casting, mPerTexel: look.shadow && look.shadow.metresPerTexel,
        cas1: look.cascades && look.cascades[0] ? look.cascades[0].ageMs : null, groundQ: q, sunElev: look.dusk ? look.dusk.sunElevDeg : null });
      prevRef = rig.refreshes;
    }
    return out;
  })()`);
  const refreshed = rows.filter((r) => r.dRef > 0);
  // `auto`, not `autoUpdate` — the row's field name. The old spelling printed `undefined` next to
  // `demand`, which is the one pair a reader uses to tell the demand-driven rig from the identity.
  console.log(`frames ${rows.length}  refresh frames ${refreshed.length}  total dRef ${rows.reduce((a, r) => a + r.dRef, 0)}  demand ${rows[0].demand} auto ${rows[0].auto}  cascades casting ${rows[0].cascadesCasting}`);
  const epochs = new Set(rows.map((r) => r.epoch)); const bounds = new Set(rows.map((r) => r.boundsM));
  console.log(`distinct epochs ${epochs.size}  distinct boundsM ${bounds.size} (${[...bounds].slice(0, 4).join(",")})  groundQ first/last ${rows[0].groundQ}/${rows.at(-1).groundQ}`);
  console.log("first 12 rows:");
  for (const r of rows.slice(0, 12)) console.log(JSON.stringify(r));
  console.log("refresh rows (up to 15):");
  for (const r of refreshed.slice(0, 15)) console.log(JSON.stringify(r));
  const maxDref = Math.max(...rows.map((r) => r.dRef));
  console.log(`max dRef per frame ${maxDref}`);
  // LEVER 12 — attribute each refresh. A refresh whose APPLIED epoch moved is one the terrain
  // itself forced (A2's key already re-renders on a tile arrival); the rest are the extent, the
  // key swing / centre drift, or the staleness net. The epoch-driven share is exactly the work a
  // "cache the terrain shadow" lever would still have had to do, so a high share CLOSES lever 12
  // rather than motivating it. `epochApplied` is the rig's OWN record of what the live map was
  // rendered under, so this is a reading, not an inference from a neighbouring frame's epoch.
  let byEpoch = 0, byExtent = 0, byOther = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].dRef <= 0) continue;
    if (rows[i].epochApplied !== rows[i - 1].epochApplied) byEpoch++;
    else if (rows[i].boundsM !== rows[i - 1].boundsM) byExtent++;
    else byOther++;
  }
  const epochBumps = rows.reduce((a, r, i) => a + (i > 0 && r.epoch !== rows[i - 1].epoch ? 1 : 0), 0);
  console.log(`attribution: refresh frames by EPOCH ${byEpoch}  by EXTENT ${byExtent}  by swing/drift/stale ${byOther}  (terrain epoch bumps in the window ${epochBumps})`);
  // PROVE THE PROBE CAN MATCH (conventions/verify.md — a probe that reads a missing field FAILS
  // OPEN). The epoch seam is `__globe.shadowRig().epochLive/.epochApplied`; if either is absent
  // the attribution above is a row of zeroes that reads exactly like "nothing was epoch-driven".
  // A window with no epoch movement at all is a legitimate answer at a SETTLED pose, so that is a
  // warning; a null field is not an answer at all, and fails the run.
  if (rows.some((r) => r.epoch === null || r.epochApplied === null)) {
    console.error("PROBE UNREADABLE: __globe.shadowRig() did not report epochLive/epochApplied — the lever-12 attribution above is fail-open, ignore it");
    code = 1;
  } else if (epochBumps === 0) {
    console.log("note: the terrain epoch never moved in this window — re-run with `--settle 0 --live` at a streaming pose before closing lever 12");
  }
} catch (e) {
  console.error("PROBE ERROR", e && e.stack ? e.stack : e);
  code = 1;
} finally {
  try { s.close(); } catch {}
  await finishVerify(code);
}
