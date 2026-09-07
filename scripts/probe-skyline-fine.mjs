#!/usr/bin/env node
/**
 * T110/T112 probe (2026-09-07d) — the FINE horizon profile at a long-lens FPV pose.
 *
 * Boots the catalogue's `dnipro-fpv-zoom-sweep` base (fov 7.2° ≈ 200 mm) on the house Chrome,
 * waits for the profile build, and READS the orchestrator's own seams (never re-derives):
 *   · `__globe.plan()`         — azBins / terrainAzBins / coverage / the mesh phase's cost ledger
 *                                 (`sweep.maxFrameMs`, `sweep.totalMs`, `sweep.frames`, budget)
 *   · the store mirror         — `profileBins.length`, `profileKnown` share, and how many DISTINCT
 *                                 0.25° features the 3° coarse view would have merged
 *   · frame-time p50/p95 during the build (the hitch question the time budget answers)
 * Optional `--lean` boots the same pose with the coarse-pointer media emulated (the phone's
 * profile: `PLAN.azBinsLean` + `sweepBudgetMsLean`), which is the T110 mobile decision's number.
 *
 *   node --experimental-websocket scripts/probe-skyline-fine.mjs 9333 [--lean] [--heading 98]
 */
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const LEAN = args.includes("--lean");
const headingArg = args.indexOf("--heading");
const HEADING = headingArg >= 0 ? Number(args[headingArg + 1]) : null;

await ensureBrowser(PORT);
const pose = byId("dnipro-fpv-zoom-sweep");
const { url } =
  HEADING == null ? poseUrl(pose) : poseUrl({ ...pose, hash: pose.hash.replace(/,98\.0,/, `,${HEADING},`) });
let target;
try {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
} catch {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
}
trackTarget(PORT, target.id);
const s = await openSession(target);
if (LEAN) {
  // The 17 Pro's profile, the `probe-memory-footprint --phone` idiom: touch → coarse pointer →
  // lean; 4 cores → tier mid. Plus a 4× CPU throttle so the ms budget is exercised as a phone
  // would (the desktop's 56 ms sweep is ~0.25 s of a Pixel's main thread).
  await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 4, configurable: true });`,
  });
  await s.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
  await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}
await s.bootUrl(url);
await s.waitFor(`!!window.__globe && typeof window.__globe.plan === "function"`, 90_000, "globe up");
await s.evalJs(
  `(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`,
);
// frame-time recorder for the build window
await s.evalJs(`(() => { window.__ftDt = []; let last = performance.now(); const step = () => { const n = performance.now(); window.__ftDt.push(n - last); last = n; if (window.__ftDt.length < 3000) requestAnimationFrame(step); }; requestAnimationFrame(step); return true; })()`);
// wait for the first complete profile (bounded)
await s.waitFor(`(() => { const p = window.__globe.plan(); return p.anchorKind === "fpv" && !p.building && p.coverage > 0; })()`, 90_000, "profile ready");
const first = await s.evalJs(`JSON.stringify(window.__globe.plan())`);
// let the streaming re-sweep (90 quiet frames after the last tile) settle, then read again
await sleep(6000);
await s.waitFor(`(() => { const p = window.__globe.plan(); return !p.building; })()`, 60_000, "re-sweep settled");
const plan = JSON.parse(await s.evalJs(`JSON.stringify(window.__globe.plan())`));
const dt = JSON.parse(await s.evalJs(`JSON.stringify(window.__ftDt)`));
const mirror = JSON.parse(
  await s.evalJs(`(() => {
    const st = window.__planStore?.getState?.() ?? null;
    if (!st) return "null";
    const bins = st.profileBins, known = st.profileKnown;
    if (!bins) return JSON.stringify({ bins: null });
    const n = bins.length, w = 360 / n;
    let knownN = 0; for (const k of known ?? []) knownN += k ? 1 : 0;
    // distinct 0.25° features a 3° bin would merge: count fine bins whose value differs from the
    // 3° box-max around them by > 0.5° (i.e. where the coarse profile would over-block)
    const per = Math.round(n / 120);
    let overBlocked = 0, gaps = 0;
    for (let c = 0; c < 120; c++) {
      let mx = -99; for (let i = 0; i < per; i++) mx = Math.max(mx, bins[c * per + i]);
      for (let i = 0; i < per; i++) if (mx - bins[c * per + i] > 0.5) overBlocked++;
    }
    for (let i = 1; i + 1 < n; i++) if (bins[i - 1] - bins[i] > 1 && bins[i + 1] - bins[i] > 1) gaps++;
    const az = (i) => (i + 0.5) * w;
    // the frame under the 200 mm lens: ±~2.4° around the heading (hFov of a 7.2° vertical at 16:9 ≈ 12.7°... report the ±2.4° core)
    const cam = window.__cameraStore?.getState?.().fpvHud;
    const h = cam ? cam.headingDeg : null;
    let frame = null;
    if (h != null) { frame = []; for (let i = 0; i < n; i++) { const d = ((az(i) - h + 540) % 360) - 180; if (Math.abs(d) <= 2.4) frame.push(+bins[i].toFixed(2)); } }
    return JSON.stringify({ n, w, coverage: knownN / n, overBlockedFineBins: overBlocked, narrowGaps: gaps, heading: h, frameBins: frame });
  })()`),
);
const sorted = [...dt].sort((a, b) => a - b);
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const out = {
  lean: LEAN,
  url,
  first: { coverage: first && JSON.parse(first).coverage, sweep: JSON.parse(first).sweep, meshCount: JSON.parse(first).meshCount },
  settled: { azBins: plan.azBins, terrainAzBins: plan.terrainAzBins, coverage: plan.coverage, meshCount: plan.meshCount, sweep: plan.sweep, carried: plan.carried },
  frames: { n: dt.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +Math.max(...dt).toFixed(1), over33: dt.filter((x) => x > 33).length },
  mirror,
};
console.log(JSON.stringify(out, null, 2));
s.close();
await finishVerify(0);
