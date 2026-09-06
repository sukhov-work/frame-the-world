/**
 * PROBE — T93's BLACK HORIZON BAND: the far-plane ladder + the backdrop census.
 *
 * `GlobeControls.adjustCamera` (`3d-tiles-renderer` 0.4.28,
 * `src/three/renderer/controls/GlobeControls.js:334`) sets
 *   `camera.far = calculateHorizonDistance(lat, cameraElevation) + 0.1 + maxRadius * farMargin`
 * — the distance to the SEA-LEVEL horizon. Terrain that rises above sea level BEYOND that
 * horizon is geometrically visible (a 8.8 km peak adds ~335 km of reach) and is clipped.
 *
 * The ladder scales `far` and reports where the terrain/sky boundary lands and how dark the band
 * is; the census names every backdrop sphere so "what fills the clipped band" is answered by an
 * object, not a guess.
 *
 * Usage: FTW_DEV_ORIGIN=http://localhost:4336 node scripts/probe-horizonband.mjs 9346 <poseId>
 * `### VERDICT` lines are MECHANICAL sanity checks only (the ladder actually moved `far`, the
 * census found backdrop geometry) — they cannot see pixels. The hypothesis itself is read from
 * `far-x1.png` … `far-x8.png`: if the black band shrinks/vanishes as the multiplier climbs, it
 * is the horizon clip (D2); if it persists unchanged, the census names what else is drawn there.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { POSES, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.argv[2] ?? 9346);
const POSE_ID = process.argv[3] ?? "everest-orbit-73";
const ORIGIN = process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321";
const OUT = "verify-shots/sheets";
const pose = POSES.find((p) => p.id === POSE_ID);
if (!pose) throw new Error(`unknown pose ${POSE_ID}`);
mkdirSync(OUT, { recursive: true });

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
await sleep(Number(process.env.SETTLE_MS ?? 30_000));
await s.ticks(4);

const shot = async (tag) => {
  await s.ticks(3);
  const r = await s.send("Page.captureScreenshot", { format: "png" });
  const f = `${OUT}/${POSE_ID}.${tag}.png`;
  writeFileSync(f, Buffer.from(r.data, "base64"));
  return f;
};

// ── The backdrop census: every sphere in the scene, named by its geometry parameters. ─────────
const census = await s.evalJs(`(() => {
  let scene = window.__globe.ground.group; while (scene.parent) scene = scene.parent;
  const out = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !/Sphere/.test(o.geometry.type)) return;
    const p = o.geometry.parameters || {};
    out.push({ name: o.name || '(unnamed)', vis: o.visible, ro: o.renderOrder,
               r: p.radius, wseg: p.widthSegments, side: o.material && o.material.side,
               mat: o.material && o.material.type, dw: o.material && o.material.depthWrite,
               dt: o.material && o.material.depthTest,
               scale: o.scale.x });
  });
  return out;
})()`);
console.log("### SPHERE CENSUS");
console.log(JSON.stringify(census, null, 1));
console.log(
  `${census.length > 0 ? "PASS" : "FAIL"}  backdrop sphere census: ${census.length} found${
    census.length === 0 ? " — nothing to blame for a solid backdrop colour; check the sky dome / clear colour instead" : ""
  }`,
);

// ── The far ladder. `camera.far` is rewritten every frame by GlobeControls.adjustCamera, so
//    the multiplier is applied behind a locked accessor. ────────────────────────────────────
await s.evalJs(`
  window.__lockFar = (mul) => {
    const c = window.__globe.camera;
    if (window.__farDesc) Object.defineProperty(c, 'far', window.__farDesc);
    window.__farDesc = window.__farDesc || Object.getOwnPropertyDescriptor(c, 'far');
    const base = c.far;
    if (mul === 1) { c.updateProjectionMatrix(); return base; }
    const v = base * mul;
    Object.defineProperty(c, 'far', { get: () => v, set: () => {}, configurable: true });
    c.updateProjectionMatrix();
    return v;
  };
  true;
`);

const rows = [];
for (const mul of [1, 1.25, 1.5, 2, 4, 8]) {
  const far = await s.evalJs(`window.__lockFar(${mul})`);
  const f = await shot(`far-x${mul}`);
  rows.push({ mul, far, file: f });
}
await s.evalJs(`Object.defineProperty(window.__globe.camera,'far',window.__farDesc); window.__globe.camera.updateProjectionMatrix(); true`);
console.log("### FAR LADDER");
console.log(JSON.stringify(rows, null, 1));
// Mechanical sanity check ONLY: proves the lock mechanism actually moved `far` monotonically —
// it says nothing about whether the black band responds. That call is read from the shots.
const monotonic = rows.every((r, i) => i === 0 || r.far > rows[i - 1].far);
console.log(
  `${monotonic ? "PASS" : "FAIL"}  far ladder monotonic across ×${rows.map((r) => r.mul).join(",×")}${
    monotonic ? "" : " — the accessor lock did not take; GlobeControls.adjustCamera may be bypassing it"
  }`,
);

// The horizon-distance arithmetic, evaluated from the live camera.
const geo = await s.evalJs(`(() => {
  const g = window.__globe, R = 6378137, alt = g.alt();
  const horizonAtSeaLevel = Math.sqrt(2 * R * alt + alt * alt);
  const reachTo = (h) => horizonAtSeaLevel + Math.sqrt(2 * R * h + h * h);
  return { alt, camFar: g.camera.far, horizonAtSeaLevel,
           reach1km: reachTo(1000), reach5km: reachTo(5000), reach8848: reachTo(8848) };
})()`);
console.log("### GEOMETRY");
console.log(JSON.stringify(geo, null, 1));
// This one IS decisive, independent of any screenshot: it asks whether Everest's own reach
// (sea-level horizon + the extra distance an 8,848 m peak's OWN horizon adds) exceeds the live
// camFar. If it does, geometry alone predicts a clip — the black band is consistent with D2
// without needing to read a pixel.
const clips = geo.reach8848 > geo.camFar;
console.log(
  `${clips ? "PASS" : "FAIL"}  Everest's reach (${geo.reach8848.toFixed(0)} m) ${clips ? ">" : "<="} camFar (${geo.camFar.toFixed(0)} m) — ${
    clips
      ? "terrain above sea level IS geometrically beyond the far plane (consistent with T93's black band being the horizon clip)"
      : "camFar already covers Everest's reach; the band is NOT the horizon clip at this pose — look at the sphere census instead"
  }`,
);

s.close();
await finishVerify(0);
