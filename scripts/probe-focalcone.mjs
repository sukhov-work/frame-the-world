/**
 * PROBE — T92's MAGENTA WEDGE: the focal cone's live terms, and which half carries the smear.
 *
 * `scene/focalCone.ts` draws the planned shot's ground sector at the plan anchor: a 48-triangle
 * fan (`fillMat`, `FOCALCONE.fillAlpha` 0.05) plus two boundary-ray quads (`edgeMat`,
 * `edgeAlpha` 0.7), both `tokens.focalCone` (#e08fc6), both `depthTest:false` /
 * `side: DoubleSide` / `renderOrder: OVERLAY_RENDER_ORDER`, seated on the anchor's tangent plane
 * at reach `clamp(alt × 0.35, 150, 12000) × rayLenK 6`.
 *
 * Reports the live reach / alphas / heading / hFov and captures fill-only, edges-only and
 * cone-off so the owner's "magenta wedge" is attributed to a term, not to a module.
 *
 * Usage: FTW_DEV_ORIGIN=http://localhost:4336 node scripts/probe-focalcone.mjs 9346 <poseId>
 * `### VERDICT` PASS means the condition actually touched ≥1 cone mesh (a real toggle, not a
 * no-op) — read the paired `<tag>.shot` PNG against `00-base` to judge the wedge itself. A FAIL
 * on the FIRST line (`found.n`) means the colour/uniform match is broken and every condition
 * below it is a no-op regardless of what it reports.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { POSES, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.argv[2] ?? 9346);
const POSE_ID = process.argv[3] ?? "dnipro-cityscape";
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
// poseUrl(), not `pose.path + pose.hash` — a pose whose catalogue `hash` carries no `&t=`
// would otherwise boot on the live clock (see probe-sheets.mjs for the full rationale).
await s.bootUrl(poseUrl(pose, { dev: ORIGIN }).url);
await s.waitFor("!!window.__globe", 90_000, "globe");
await s.evalJs(`document.querySelector('.wl-btn--primary')?.click()`).catch(() => {});
await sleep(Number(process.env.SETTLE_MS ?? 30_000));
await s.ticks(4);

const shot = async (tag) => {
  await s.ticks(3);
  const r = await s.send("Page.captureScreenshot", { format: "png" });
  const f = `${OUT}/${POSE_ID}.cone-${tag}.png`;
  writeFileSync(f, Buffer.from(r.data, "base64"));
  return f;
};

// Find the two focal-cone meshes by their material colour (tokens.focalCone = #e08fc6).
const found = await s.evalJs(`(() => {
  let scene = window.__globe.ground.group; while (scene.parent) scene = scene.parent;
  window.__cone = [];
  scene.traverse((o) => {
    const m = o.material;
    if (!o.isMesh || !m || !m.uniforms || !m.uniforms.uColor || !m.uniforms.uAlpha) return;
    if ('#' + m.uniforms.uColor.value.getHexString() !== '#e08fc6') return;
    window.__cone.push(o);
  });
  const g = window.__globe;
  return {
    n: window.__cone.length,
    alt: g.alt(),
    aim: g.aim(),
    meshes: window.__cone.map((o) => ({
      alpha: o.material.uniforms.uAlpha.value,
      tris: o.geometry.attributes.position.count / 3,
      rotZdeg: o.rotation.z * 180 / Math.PI,
      renderOrder: o.renderOrder,
      depthTest: o.material.depthTest,
      side: o.material.side,
      groupVisible: o.parent ? o.parent.visible : null,
      // the tangent basis length IS the reach in metres (seatTangentGroup)
      reachM: o.parent ? Math.hypot(o.parent.matrix.elements[0], o.parent.matrix.elements[1], o.parent.matrix.elements[2]) : null,
    })),
  };
})()`);
console.log("### FOCAL CONE");
console.log(JSON.stringify(found, null, 1));
console.log("\n### VERDICT");
console.log(
  `${found.n > 0 ? "PASS" : "FAIL"}  focal-cone meshes found: ${found.n}${
    found.n === 0 ? " — the colour/uniform match is broken; every condition below is a no-op" : ""
  }`,
);

await shot("00-base");
// Each condition RETURNS the count of meshes it actually touched, not a blind 'ok' — a probe
// that reports "ok" whether it modified 2 objects or 0 is exactly the fail-open shape the
// harness fence forbids (verify.md: "a probe that reads a missing field FAILS OPEN").
// Cumulative by design (each condition stacks on the last): fill0 → +edges0 → +off ablates the
// cone term by term, ending where "off" alone would have landed.
const conditions = [
  [
    "fill0",
    `(()=>{ let n=0; window.__cone.forEach((o)=>{ if(o.geometry.attributes.position.count/3 > 4) { Object.defineProperty(o.material.uniforms,'uAlpha',{value:{value:0},writable:true,configurable:true}); n++; } }); return n; })()`,
  ],
  [
    "edges0",
    `(()=>{ let n=0; window.__cone.forEach((o)=>{ if(o.geometry.attributes.position.count/3 <= 4) { Object.defineProperty(o.material.uniforms,'uAlpha',{value:{value:0},writable:true,configurable:true}); n++; } }); return n; })()`,
  ],
  [
    "off",
    `(()=>{ let n=0; window.__cone.forEach((o)=>{ Object.defineProperty(o,'visible',{get:()=>false,set:()=>{},configurable:true}); n++; }); return n; })()`,
  ],
];
const out = {};
for (const [tag, js] of conditions) {
  out[tag] = await s.evalJs(`(()=>{ try { return ${js}; } catch(e){ return 'ERR '+e.message } })()`);
  out[tag + ".shot"] = await shot(tag);
}
console.log("### CONDITIONS (cumulative)");
console.log(JSON.stringify(out, null, 1));
for (const [tag] of conditions) {
  const r = out[tag];
  const errored = typeof r === "string" && r.startsWith("ERR");
  const zero = r === 0;
  console.log(
    `${errored || zero ? "FAIL" : "PASS"}  ${tag}  ${
      errored ? `threw: ${r}` : zero ? "touched ZERO objects — no-op" : `touched ${r} object(s)`
    }`,
  );
}
s.close();
await finishVerify(0);
