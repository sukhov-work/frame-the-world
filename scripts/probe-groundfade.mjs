/**
 * PROBE — the imagery-ground REVEAL uniform over time (T93's halftone dither).
 *
 * `imageryGround.ts:1424` eases `uFtwFade` toward `altFade × readiness`, and
 * `imageryGround.ts:1415-1419` caps `readiness` at `GROUND.revealProgressCap` (0.85) until the
 * `tiles-load-end` event fires. The fragment shader (`:775-778`) then DISCARDS every fragment
 * whose 4×4 bayer threshold exceeds the fade — so any settled value below 15.5/16 = 0.969 is a
 * permanent screen-door halftone over the whole terrain.
 *
 * Reports the time series so "still easing" and "settled below 1" are distinguishable.
 *
 * Usage: FTW_DEV_ORIGIN=http://localhost:4336 node scripts/probe-groundfade.mjs 9346 <poseId> [secs]
 * The closing `### VERDICT` line does the distinguishing: PASS = settled at 1 (no permanent
 * dither); FAIL = settled below 1 (the halftone is permanent at this pose); note = still moving
 * at the window's end — rerun with a larger [secs] before drawing any conclusion.
 */
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { POSES, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.argv[2] ?? 9346);
const POSE_ID = process.argv[3] ?? "everest-orbit-73";
const SECS = Number(process.argv[4] ?? 60);
const ORIGIN = process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321";

const pose = POSES.find((p) => p.id === POSE_ID);
if (!pose) throw new Error(`unknown pose ${POSE_ID}`);

await ensureBrowser(PORT, { profile: "/tmp/ftw-cdp-sheets", launch: false });
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })
  .then((r) => r.json())
  .catch(() => fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json()));
trackTarget(PORT, t.id);
const s = await openSession(t);

await s.send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 950,
  deviceScaleFactor: 1,
  mobile: false,
});
// poseUrl(), not `pose.path + pose.hash` — see probe-sheets.mjs for the full rationale.
await s.bootUrl(poseUrl(pose, { dev: ORIGIN }).url);
await s.waitFor("!!window.__globe", 90_000, "globe");
await s.evalJs(`document.querySelector('.wl-btn--primary')?.click()`).catch(() => {});

// Count the load-end events ourselves — the module's own flag is a closure.
await s.evalJs(`(() => {
  const t = window.__globe.ground;
  window.__ge = { start: 0, end: 0 };
  t.addEventListener('tiles-load-start', () => window.__ge.start++);
  t.addEventListener('tiles-load-end', () => window.__ge.end++);
  return true;
})()`);

console.log("t(s)\tuFtwFade\tloadProgress\tqueued\tdl\tparse\tvisible\tstart\tend");
let prev = null;
let last = null;
for (let i = 0; i <= SECS; i += 2) {
  const r = await s.evalJs(`(() => {
    const g = window.__globe, t = g.ground, st = t.stats || {};
    return { f: g.groundUniforms.uFtwFade.value, p: t.loadProgress,
             q: st.queued ?? -1, d: st.downloading ?? -1, pa: st.parsing ?? -1, v: st.visible ?? -1,
             s: window.__ge.start, e: window.__ge.end };
  })()`);
  console.log(
    `${i}\t${r.f.toFixed(4)}\t${(r.p ?? -1).toFixed(3)}\t${r.q}\t${r.d}\t${r.pa}\t${r.v}\t${r.s}\t${r.e}`,
  );
  prev = last;
  last = r;
  if (i < SECS) await sleep(2000);
}

// The verdict: SETTLED means the last two 2 s samples agree within 1e-3 (the tuning's own snap
// epsilon — verify.md's "an EASED scalar is not its target yet" trap). Below that, the reading
// is still easing and neither a PASS nor a FAIL can be drawn from it yet.
console.log("\n### VERDICT");
if (!last) {
  console.log("FAIL  no samples collected — SECS must be >= 0");
} else {
  const settled = prev !== null && Math.abs(last.f - prev.f) < 1e-3;
  if (!settled) {
    console.log(
      `note  uFtwFade still easing at t=${SECS}s (${prev ? (last.f - prev.f).toFixed(4) : "?"} over the last 2 s, loadEnd=${last.e}) — rerun with a larger [secs] before concluding`,
    );
  } else if (last.f >= 0.999) {
    console.log(`PASS  uFtwFade settled at ${last.f.toFixed(4)} (loadEnd=${last.e}) — no permanent halftone`);
  } else {
    console.log(
      `FAIL  uFtwFade settled at ${last.f.toFixed(4)} < 1 (loadEnd=${last.e}) — permanent screen-door halftone confirmed at this pose (discard threshold ${(last.f * 16).toFixed(2)}/16)`,
    );
  }
}

s.close();
await finishVerify(0);
