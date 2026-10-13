/**
 * verify-fpv-collision-2026-10-13 — THE STICKY BOX (owner order 2026-10-13: "do not bounce off
 * geometry … a more realistic bounding box around an average human … sticky, not bouncy").
 *
 * Every leg drives the temp-FPV eye against DEV test solids (`__globe.fpvTestSolid`, closed boxes
 * in the user-models group) and reads the eye per rAF frame through `__globe.alt()` +
 * `__globe.fpvClearance()`, so each claim is a number:
 *   A  a SLOW descent onto a 20 m roof — the eye never jumps up (was +19.9 m the frame the feet
 *      came within 0.35 m of the roof), lands at roof + 1.7 and stays;
 *   B  a FAST descent — lands at roof + 1.7, the feet never below the roof;
 *   C  rising under a raised slab — the head stops 0.3 m under its underside, never lifted onto it;
 *   D  walking into the roof's SIDE — the walk is blocked at the wall (the eye never inside the
 *      footprint below the roof), the feet climb over several frames, the box lands on the roof;
 *   E  hovering 30 m over the roof and walking off its edge — the eye does not move (the elevator);
 *   F  standing on the roof and standing still (the pin follows) — no bob;
 *   G  rising from the roof to 600 m — the eye is monotone (no dip when the roof leaves the column);
 *   H  standing on roof A and walking onto a lower roof B — an eased fall onto B, never a snap.
 *
 *   ~/.nvm/versions/node/v24.10.0/bin/node scripts/verify-fpv-collision-2026-10-13.mjs [9333] [--shots]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const SHOTS = args.includes("--shots");
const ORIGIN = "http://localhost:4321";
const P = { latDeg: 48.470991, lonDeg: 35.053172 }; // the owner's Dnipro spot (flat central ground)
const BODY = 1.7;
const notes = [];
const fails = [];
const ok = (cond, msg) => (cond ? notes.push(`  PASS  ${msg}`) : fails.push(`  FAIL  ${msg}`));
const f2 = (x) => (x === null || x === undefined ? "null" : Number(x).toFixed(2));

await ensureBrowser(PORT);
let target;
try {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
} catch {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
}
trackTarget(PORT, target.id);
const s = await openSession(target);
await s.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
const J = (expr) => s.evalJs(expr);
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync("verify-shots", { recursive: true });
  const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(r.data, "base64"));
};
const read = () =>
  J(`(() => { const g = window.__globe; const f = g.fpv(); const c = g.fpvClearance(); return { alt: g.alt(), eyeM: f.eyeM, lift: c.liftM, floor: c.floorAbsM, climbing: c.climbing, blocked: c.blocked, lifts: c.lifts, blockedFrames: c.blockedFrames, cols: c.cols, lastMs: c.lastMs }; })()`);
/** Trace the eye per rAF frame while an input is held; returns rows [n, alt, eyeM, lift, floor, blockedFrames, lastMs, lonDeg]. */
const trace = async (startJs, stopJs, frames) => {
  await J(`(() => {
    window.__trace = [];
    ${startJs};
    let n = 0;
    const step = () => {
      const g = window.__globe; const f = g.fpv(); const c = g.fpvClearance();
      const p = g.camera.position; const geo = window.__cameraStore.getState().camGeo;
      window.__trace.push([n, g.alt(), f.eyeM, c.liftM, c.floorAbsM, c.blockedFrames, c.lastMs, geo ? geo.lonDeg : null, c.cols]);
      if (++n < ${frames}) requestAnimationFrame(step);
      else { ${stopJs}; }
    };
    requestAnimationFrame(step);
  })()`);
  await sleep(frames * 17 + 900);
  return J(`window.__trace`);
};
const enterFpv = async (latDeg, lonDeg, eyeM, headingDeg = 0, pitchDeg = -60) => {
  await J(`window.__cameraStore.getState().setTempFpv(false)`);
  await sleep(500);
  await J(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${latDeg}, lonDeg: ${lonDeg}, eyeM: ${eyeM}, headingDeg: ${headingDeg}, pitchDeg: ${pitchDeg}, fovDeg: 55 })`);
  await s.waitFor(`window.__cameraStore.getState().fpvHud !== null`, 30_000, "FPV up");
  await sleep(1800);
  await s.ticks(10);
};
const maxUpJump = (t) => Math.max(0, ...t.map((r, i) => (i ? r[1] - t[i - 1][1] : 0)));
const maxDownJump = (t) => Math.max(0, ...t.map((r, i) => (i ? t[i - 1][1] - r[1] : 0)));

await s.bootUrl(`${ORIGIN}/#p=${P.latDeg},${P.lonDeg},2500,0,45&t=1788701556919`);
await s.waitFor(`!!window.__globe && !!window.__cameraStore && typeof window.__globe.fpvClearance === "function"`, 90_000, "globe up");
await sleep(4000);

// A 20 m roof under the owner's spot; a second, lower 8 m roof 40 m east for leg H.
await enterFpv(P.latDeg, P.lonDeg, 24);
const box = await J(`window.__globe.fpvTestSolid(${P.latDeg}, ${P.lonDeg}, 20, 30)`);
const mPerDegLon = 111_320 * Math.cos((P.latDeg * Math.PI) / 180);
const lonB = P.lonDeg + 40 / mPerDegLon;
const boxB = await J(`window.__globe.fpvTestSolid(${P.latDeg}, ${lonB}, 8, 30, 0, "__fpvTestSolidB")`);
await s.ticks(5);
ok(box && boxB && Number.isFinite(box.topM) && Number.isFinite(boxB.topM), `two test solids: a 20 m roof (top ${f2(box?.topM)} m) and an 8 m roof 40 m east (top ${f2(boxB?.topM)} m)`);

// ── A. the slow descent (the owner's bounce) ───────────────────────────────────────────────────
{
  const t = await trace(`window.__cameraStore.getState().setZoomRate(-0.25)`, `window.__cameraStore.getState().setZoomRate(null)`, 420);
  const up = maxUpJump(t);
  const end = await read();
  ok(up < 0.3, `A slow descent onto the roof: the eye never jumps up (max up-step ${f2(up)} m; was +19.9 m before the fix)`);
  ok(Math.abs(end.alt - (box.topM + BODY)) < 0.05, `A …and lands ON the roof at the standing height (eye ${f2(end.alt)} vs roof + 1.7 = ${f2(box.topM + BODY)} m)`);
  ok(end.floor !== null && Math.abs(end.floor - box.topM) < 0.05 && Math.abs(end.eyeM - BODY) < 0.01, `A …standing (floor ${f2(end.floor)} m, eyeM ${f2(end.eyeM)} m)`);
  await shot("fpv-collision-A-landed-slow");
}

// ── B. the fast descent ─────────────────────────────────────────────────────────────────────────
{
  await trace(`window.__cameraStore.getState().setZoomRate(2.5)`, `window.__cameraStore.getState().setZoomRate(null)`, 70); // back up to ~100 m
  const t = await trace(`window.__cameraStore.getState().setZoomRate(-3)`, `window.__cameraStore.getState().setZoomRate(null)`, 200);
  const minAlt = Math.min(...t.map((r) => r[1]));
  const end = await read();
  ok(minAlt > box.topM + BODY - 0.05, `B fast descent: the feet never go below the roof (min eye ${f2(minAlt)} vs ${f2(box.topM + BODY)} m)`);
  ok(Math.abs(end.alt - (box.topM + BODY)) < 0.05 && maxUpJump(t) < 0.3, `B …lands at roof + 1.7 (eye ${f2(end.alt)} m; max up-step ${f2(maxUpJump(t))} m)`);
}

// ── G. rising from the roof far above the column's reach — no dip ──────────────────────────────
{
  const t = await trace(`window.__cameraStore.getState().setZoomRate(3)`, `window.__cameraStore.getState().setZoomRate(null)`, 190);
  const down = maxDownJump(t);
  const end = await read();
  ok(down < 0.05, `G rising from the roof to ${f2(end.alt)} m: the eye is monotone — no dip when the roof leaves the column (max down-step ${f2(down)} m; was a 20 m eased dip)`);
  ok(end.floor === null && Math.abs(end.lift) < 0.01, `G …far above, the reference is the terrain again (floor ${end.floor}, lift ${f2(end.lift)} m)`);
}

// ── E. hovering over the roof, walking off its edge — the elevator ────────────────────────────
{
  await enterFpv(P.latDeg, P.lonDeg, 50, 90, 0); // 50 m up over the roof, looking east
  await s.ticks(10);
  const before = await read();
  ok(before.floor !== null && Math.abs(before.floor - box.topM) < 0.05 && Math.abs(before.alt - (box.baseM + 50)) < 0.6, `E hovering ${f2(before.alt - box.topM)} m over the roof (eye ${f2(before.alt)} m, floor ${f2(before.floor)} m, eyeM ${f2(before.eyeM)} re-referenced to the roof)`);
  const t = await trace(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`, `window.__cameraStore.getState().setFpvWalkInput(null)`, 120);
  const alts = t.map((r) => r[1]);
  const span = Math.max(...alts) - Math.min(...alts);
  const end = await read();
  // the terrain under a hovering walker is followed (RC10) — a metre of slope over 40 m is the ground, not the fix
  const edgeIdx = t.findIndex((r, i) => i && r[4] !== t[i - 1][4]);
  const edgeJump = edgeIdx > 0 ? Math.abs(t[edgeIdx][1] - t[edgeIdx - 1][1]) : 0;
  ok(span < 1.2 && edgeJump < 0.15, `E walking off the roof's edge while hovering: the eye stays put (alt span ${f2(span)} m over ${t.length} frames, ${f2(edgeJump)} m on the edge frame; was a ${f2(box.topM - box.baseM)} m eased drop)`);
  ok(end.floor === null || Math.abs(end.floor - boxB.topM) < 0.05, `E …the reference moved under the eye without moving it (floor now ${f2(end.floor)})`);
}

// ── H. standing on roof A, walking onto the lower roof B — an eased fall ───────────────────────
{
  await enterFpv(P.latDeg, P.lonDeg, 1.7, 90, 0); // inside A → climbs onto its roof
  await sleep(1200);
  await s.ticks(10);
  const onA = await read();
  ok(onA.floor !== null && Math.abs(onA.floor - box.topM) < 0.05 && Math.abs(onA.alt - (box.topM + BODY)) < 0.05, `H a pin inside the 20 m solid climbs onto its roof at entry (eye ${f2(onA.alt)} m = roof + 1.7)`);
  // 36 m east at the base walk speed: off A's edge (15 m) and onto B (25–55 m)
  const t = await trace(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 0.58, right: 0 })`, `window.__cameraStore.getState().setFpvWalkInput(null)`, 135);
  await sleep(600);
  const end = await read();
  const down = maxDownJump(t);
  ok(down < 3, `H walking off A's edge: the fall is EASED (max down-step ${f2(down)} m per frame)`);
  const onB = end.floor !== null && Math.abs(end.floor - boxB.topM) < 0.05 && Math.abs(end.alt - (boxB.topM + BODY)) < 0.2;
  ok(onB, `H …and the feet settle on roof B (eye ${f2(end.alt)} m vs B's roof + 1.7 = ${f2(boxB.topM + BODY)}; floor ${f2(end.floor)})`);
  if (!onB) console.log("H trace", JSON.stringify(t.filter((r, i) => i % 6 === 0).map((r) => [r[0], +r[1].toFixed(1), r[4] === null ? null : +r[4].toFixed(1), r[5], r[7] === null ? null : +((r[7] - P.lonDeg) * mPerDegLon).toFixed(1)])));
  await shot("fpv-collision-H-on-roof-B");
}

// ── D. walking into the roof's SIDE — blocked at the wall, then the climb ──────────────────────
{
  const lonW = P.lonDeg - 24 / mPerDegLon; // 24 m west of the box centre (the box is 30 m square → the wall is 15 m from the centre)
  await enterFpv(P.latDeg, lonW, 1.7, 90, 0);
  // 0.4 m a frame: ~23 frames to the wall, the climb, then onto the roof — stop near its centre
  const t = await trace(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 0.6, right: 0 })`, `window.__cameraStore.getState().setFpvWalkInput(null)`, 100);
  await sleep(500);
  const end = await read();
  // the eye per frame: while it is below the roof it must stay OUTSIDE the 30 m footprint
  const half = 15 / mPerDegLon;
  let clipped = 0, blockedFrames = 0, firstBlocked = -1;
  for (const r of t) {
    const [n, alt, , , , bf, , lon] = r;
    if (lon !== null && alt - BODY < box.topM - 0.1 && Math.abs(lon - P.lonDeg) < half - 0.2 / mPerDegLon) clipped++;
    if (bf > blockedFrames) { blockedFrames = bf; if (firstBlocked < 0) firstBlocked = n; }
  }
  if (clipped > 0 || end.floor === null) console.log("D trace", JSON.stringify(t.filter((r, i) => i % 5 === 0).map((r) => [r[0], +r[1].toFixed(1), r[4] === null ? null : +r[4].toFixed(1), r[5], r[7] === null ? null : +((r[7] - P.lonDeg) * mPerDegLon).toFixed(1)])));
  const up = maxUpJump(t);
  ok(blockedFrames > 0, `D walking into the wall: the box's edge met it and the walk was blocked (${blockedFrames} blocked frames, first at frame ${firstBlocked})`);
  ok(clipped === 0, `D …the eye was never inside the footprint below the roof (${clipped} clipped frames of ${t.length})`);
  ok(up > 0 && up < 4, `D …the climb is a glide, not a snap (max up-step ${f2(up)} m per frame; the old snap was ${f2(box.topM - box.baseM)} m)`);
  ok(end.floor !== null && Math.abs(end.floor - box.topM) < 0.05 && Math.abs(end.alt - (box.topM + BODY)) < 0.1, `D …and the box lands on the roof (eye ${f2(end.alt)} m, floor ${f2(end.floor)} m)`);
  const colMs = Math.max(...t.map((r) => r[6]));
  const cols = Math.max(...t.map((r) => r[8]));
  ok(colMs < 12, `D …the ${cols}-column box costs at most ${f2(colMs)} ms a frame while walking`);
  await shot("fpv-collision-D-climbed-the-wall");
}

// ── D2. the input stops mid-climb: the latch finishes the climb and holds the box at the wall's top ──
{
  const lonW = P.lonDeg - 24 / mPerDegLon;
  await enterFpv(P.latDeg, lonW, 1.7, 90, 0);
  // ~23 frames to the wall, then 8 frames of climbing, then release
  const t = await trace(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 0.6, right: 0 })`, `window.__cameraStore.getState().setFpvWalkInput(null)`, 31);
  const atRelease = { alt: t[t.length - 1][1] };
  const hold = await trace(`void 0`, `void 0`, 90);
  const end = await read();
  ok(atRelease.alt < box.topM + BODY - 1 && atRelease.alt > box.baseM + BODY + 0.5, `D2 the walk stops mid-climb (eye ${f2(atRelease.alt)} m, between the ground and the roof)`);
  const heldOk = Math.abs(end.alt - (box.topM + BODY)) < 0.1 && end.floor === null;
  ok(heldOk, `D2 …the climb finishes anyway and holds at the wall's top edge (eye ${f2(end.alt)} m; hovering, floor ${end.floor})`);
  if (!heldOk) console.log("D2 hold", JSON.stringify(hold.filter((r, i) => i % 6 === 0).map((r) => [r[0], +r[1].toFixed(2), +r[2].toFixed(2), +r[3].toFixed(2), r[4], r[5], r[8]])), JSON.stringify(end));
  // one step forward lands on the roof; a step BACK releases the latch and the box falls
  await trace(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`, `window.__cameraStore.getState().setFpvWalkInput(null)`, 10);
  await s.ticks(5);
  const onRoof = await read();
  ok(onRoof.floor !== null && Math.abs(onRoof.floor - box.topM) < 0.05, `D2 …a step forward lands on the roof (floor ${f2(onRoof.floor)} m)`);
  void t; void hold;
  await enterFpv(P.latDeg, lonW, 1.7, 90, 0);
  await trace(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 0.6, right: 0 })`, `window.__cameraStore.getState().setFpvWalkInput(null)`, 31);
  await trace(`void 0`, `void 0`, 90);
  const held = await read();
  await trace(`window.__cameraStore.getState().setFpvWalkInput({ fwd: -0.6, right: 0 })`, `window.__cameraStore.getState().setFpvWalkInput(null)`, 40);
  await sleep(900);
  const back = await read();
  ok(Math.abs(held.alt - (box.topM + BODY)) < 0.1 && Math.abs(back.alt - (box.baseM + BODY)) < 0.3 && back.floor === null, `D2 …a step BACK releases the latch and the box falls to the ground (held at ${f2(held.alt)} m → ${f2(back.alt)} m)`);
  // leave the walker ON the roof for leg F
  await enterFpv(P.latDeg, P.lonDeg, 1.7, 90, 0);
  await sleep(1200);
  await s.ticks(10);
}

// ── F. standing still on the roof: the pin follows the walker — no bob ─────────────────────────
{
  const before = await read();
  const t = await trace(`void 0`, `void 0`, 100); // ~1.7 s of standing still (pinFollowSettleMs 400)
  const alts = t.map((r) => r[1]);
  const span = Math.max(...alts) - Math.min(...alts);
  ok(span < 0.1 && Math.abs(before.alt - (box.topM + BODY)) < 0.1, `F standing on the roof while the pin follows: no bob (alt span ${f2(span)} m over ${t.length} frames)`);
}

// ── C. rising under a raised slab — the head stops under it ────────────────────────────────────
{
  await J(`window.__globe.fpvTestSolid(null)`);
  await J(`window.__globe.fpvTestSolid(null, 0, 0, 0, 0, "__fpvTestSolidB")`);
  const slab = await J(`window.__globe.fpvTestSolid(${P.latDeg}, ${P.lonDeg}, 0.5, 30, 6)`); // a 0.5 m slab, 6 m up
  await enterFpv(P.latDeg, P.lonDeg, 1.7, 0, 0);
  const under = slab.baseM; // the slab's underside
  const t = await trace(`window.__cameraStore.getState().setZoomRate(1.2)`, `window.__cameraStore.getState().setZoomRate(null)`, 240);
  const maxAlt = Math.max(...t.map((r) => r[1]));
  const hold = await trace(`void 0`, `void 0`, 60); // after the release: the eye must HOLD under the slab
  const end = await read();
  if (Math.abs(end.alt - (under - 0.3)) >= 0.1) console.log("C tail", JSON.stringify(t.slice(-6).map((r) => r.slice(0, 5))), "hold", JSON.stringify(hold.filter((r, i) => i % 10 === 0).map((r) => r.slice(0, 5))));
  ok(maxAlt <= under - 0.3 + 0.05, `C rising under a slab: the head stops under it (max eye ${f2(maxAlt)} vs underside − 0.3 = ${f2(under - 0.3)} m)`);
  ok(Math.abs(end.alt - (under - 0.3)) < 0.1, `C …and stays there while the input is held (eye ${f2(end.alt)} m)`);
  ok(end.floor === null && Math.abs(end.lift) < 0.01, `C …never lifted onto the slab (floor ${end.floor}, lift ${f2(end.lift)} m; was a snap onto the deck)`);
  await shot("fpv-collision-C-under-the-slab");
  await J(`window.__globe.fpvTestSolid(null)`);
}

await J(`window.__cameraStore.getState().setTempFpv(false)`);
await sleep(400);

console.log(notes.join("\n"));
if (fails.length) console.log(fails.join("\n"));
console.log(`\nverify-fpv-collision-2026-10-13: ${notes.filter((n) => n.startsWith("  PASS")).length} PASS · ${fails.length} FAIL`);
s.close();
await finishVerify(fails.length ? 1 : 0);
