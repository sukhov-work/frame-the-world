/**
 * PROBE — the sheet defects (T92 magenta wedge at the cityscape; T93 black horizon band +
 * halftone dither at Everest tilt 73 / the 200 mm sweep).
 *
 * Read-only diagnosis: boots a pose, settles, reports the live state that the candidate
 * mechanisms are made of, then captures one native PNG per TOGGLE so a defect can be
 * attributed to the object that carries it.
 *
 * Usage:
 *   FTW_DEV_ORIGIN=http://localhost:4336 node scripts/probe-sheets.mjs 9346 <poseId> [--shots]
 * A `### VERDICT` PASS means the toggle actually found and locked ≥1 object — the paired
 * `<tag>.shot` PNG is a valid A/B for that hypothesis. FAIL means it threw or matched ZERO
 * objects (fail-open guard): the shot proves nothing and must not be read as a negative result.
 * The hypothesis itself is confirmed only by EYEBALLING the shots, never by this line alone.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { POSES, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.argv[2] ?? 9346);
const POSE_ID = process.argv[3] ?? "everest-orbit-73";
const SHOTS = process.argv.includes("--shots");
const ORIGIN = process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321";
const OUT = "verify-shots/sheets";

const pose = POSES.find((p) => p.id === POSE_ID);
if (!pose) throw new Error(`unknown pose ${POSE_ID}`);
mkdirSync(OUT, { recursive: true });

await ensureBrowser(PORT, { profile: "/tmp/ftw-cdp-sheets", launch: false });
const newTarget = async () => {
  let t;
  try {
    t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  } catch {
    t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
  }
  return t;
};
const target = await newTarget();
trackTarget(PORT, target.id);
const s = await openSession(target);

await s.send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 950,
  deviceScaleFactor: 1,
  mobile: false,
});
// poseUrl(), never a hand-rolled `pose.path + pose.hash` — several catalogue poses (e.g. the
// descent, the everest A/B) carry NO `&t=` in `hash` and rely on poseUrl() to append the
// pinned `t`; concatenating the raw fields would boot those on the LIVE clock (verify.md's
// determinism rule) even though this probe's own two defaults happen to carry `&t=` already.
await s.bootUrl(poseUrl(pose, { dev: ORIGIN }).url);
await s.waitFor("!!window.__globe", 90_000, "globe");
await s.evalJs(`document.querySelector('.wl-btn--primary')?.click()`).catch(() => {});
await sleep(Number(process.env.SETTLE_MS ?? 30_000));
await s.ticks(4);

const shot = async (tag) => {
  if (!SHOTS) return null;
  await s.ticks(3);
  const r = await s.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const f = `${OUT}/${POSE_ID}.${tag}.png`;
  writeFileSync(f, Buffer.from(r.data, "base64"));
  return f;
};

// ── STATE ───────────────────────────────────────────────────────────────────────────────────
const state = await s.evalJs(`(() => {
  const g = window.__globe;
  const gu = g.groundUniforms || {};
  const eu = g.earthUniforms || {};
  const cam = g.camera;
  let scene = g.ground.group; while (scene && scene.parent) scene = scene.parent;
  const nodes = [];
  const walk = (o, d) => {
    if (d > 3) return;
    nodes.push({ n: o.name || o.type, vis: o.visible, ro: o.renderOrder, kids: (o.children||[]).length,
                 mat: o.material ? (Array.isArray(o.material) ? o.material[0].type : o.material.type) : null,
                 col: o.material && !Array.isArray(o.material) && o.material.color ? '#'+o.material.color.getHexString() : null,
                 dt: o.material && !Array.isArray(o.material) ? o.material.depthTest : null,
                 op: o.material && !Array.isArray(o.material) ? o.material.opacity : null });
    (o.children||[]).forEach((c) => walk(c, d+1));
  };
  walk(scene, 0);
  return {
    uFtwFade: gu.uFtwFade ? gu.uFtwFade.value : null,
    uFtwHiAlt: gu.uFtwHiAlt ? gu.uFtwHiAlt.value : null,
    uFtwDark: gu.uFtwDark ? gu.uFtwDark.value : null,
    uFtwHaze: gu.uFtwHaze ? gu.uFtwHaze.value : null,
    groundUniformNames: Object.keys(gu),
    earthUniformNames: Object.keys(eu),
    cam: { near: cam.near, far: cam.far, fov: cam.fov },
    alt: g.alt(),
    aim: g.aim ? g.aim() : null,
    sceneRoot: scene.name || scene.type,
    nodes: nodes.filter((n)=>n.vis).slice(0, 200),
  };
})()`);

console.log("### STATE", POSE_ID);
console.log(JSON.stringify(state, null, 1));

await shot("00-base");

// ── TOGGLES ─────────────────────────────────────────────────────────────────────────────────
// Each toggle is applied, shot, and REVERTED, so the conditions are independent.
const SCENE = `(()=>{let s=window.__globe.ground.group;while(s.parent)s=s.parent;return s})()`;
// The orchestrator rewrites `group.visible`, `camera.far` and `uFtwFade` EVERY frame, so a plain
// assignment is a no-op by the next tick (measured: 0.57 % of pixels — the T94 noise floor, i.e.
// nothing). Every toggle below therefore LOCKS the property behind an accessor whose setter
// swallows the write, and `__unlockAll()` restores the original descriptors in reverse order.
const LOCK = `
  window.__lock=(o,k,v)=>{const d=Object.getOwnPropertyDescriptor(o,k);
    window.__locks=window.__locks||[];window.__locks.push([o,k,d]);
    Object.defineProperty(o,k,{get:()=>v,set:()=>{},configurable:true});};
  window.__unlockAll=()=>{(window.__locks||[]).reverse().forEach(([o,k,d])=>{
    if(d)Object.defineProperty(o,k,d);else{delete o[k];}});window.__locks=[];};
`;
// Every terrain tile whose geometry has the documented cap/skirt layout (terrainSkirt.ts).
const CAPS = `(()=>{const out=[];window.__globe.ground.group.traverse((o)=>{
   if(!o.isMesh||!o.geometry||!o.geometry.index)return;
   const g=o.geometry,g0=g.groups[0];
   if(!g0||g0.start!==0||!(g0.count>0)||g0.count>=g.index.count)return;
   out.push([g,g0.count,g.index.count]);}); return out})()`;
const RESTORE_RANGE = `window.__globe.ground.group.traverse((o)=>{
   if(o.geometry&&typeof o.geometry.setDrawRange==='function')o.geometry.setDrawRange(0,Infinity);});`;

const toggles = [
  // T93 (a) — the reveal halftone: is the screen-door dither the imagery ground's `uFtwFade`?
  ["fade-085", `${LOCK} window.__lock(window.__globe.groundUniforms.uFtwFade,'value',0.85); return 'locked 0.85';`,
                `window.__unlockAll();`],
  // T93 (b) — the black horizon band. The SKIRT APRONS in the COLOUR pass: the same surface-cap
  //           clip `imageryGround.ts:857-880` already applies to the shadow pass.
  ["skirt-clip", `${LOCK} const cs=${CAPS};
      cs.forEach(([g,n])=>{g.setDrawRange(0,n);window.__lock(g,'setDrawRange',()=>{});}); return cs.length;`,
                 `window.__unlockAll(); ${RESTORE_RANGE}`],
  //  …and the complement: draw ONLY the aprons, so the band's own shape is visible.
  ["skirt-only", `${LOCK} const cs=${CAPS};
      cs.forEach(([g,n,t])=>{g.setDrawRange(n,t-n);window.__lock(g,'setDrawRange',()=>{});}); return cs.length;`,
                 `window.__unlockAll(); ${RESTORE_RANGE}`],
  // T93 (c) — is the band the ground layer at all, or what is drawn behind it?
  ["ground-off", `${LOCK} window.__lock(window.__globe.ground.group,'visible',false); return 'locked';`,
                 `window.__unlockAll();`],
  ["earth-off", `${LOCK} const s=${SCENE}; let n=0;
      s.traverse((o)=>{if(o.isMesh&&o.geometry&&/Sphere/.test(o.geometry.type)&&o.visible){window.__lock(o,'visible',false);n++;}});
      return n;`, `window.__unlockAll();`],
  // T93 (d) — the far plane sits ON the horizon distance (D2 dynamic near/far).
  ["far-x4", `${LOCK} const c=window.__globe.camera; const f=c.far*4;
      window.__lock(c,'far',f); c.updateProjectionMatrix(); return f;`,
             `window.__unlockAll(); window.__globe.camera.updateProjectionMatrix();`],
  // T92 — the magenta wedge: the planning overlays (renderOrder >= 8, depthTest false).
  ["overlay-off", `${LOCK} const s=${SCENE}; let n=0;
      s.traverse((o)=>{if(o.visible&&o.material&&o.renderOrder>=8){window.__lock(o,'visible',false);n++;}});
      return n;`, `window.__unlockAll();`],
];

const results = {};
for (const [tag, on, off] of toggles) {
  const r = await s.evalJs(`(()=>{ try { ${on} } catch(e){ return 'ERR '+e.message } })()`);
  results[tag] = r;
  results[tag + ".shot"] = await shot(tag);
  await s.evalJs(`(()=>{ try { ${off} } catch(e){ return "ERR "+e.message } })()`);
  await s.ticks(2);
}
console.log("### TOGGLES");
console.log(JSON.stringify(results, null, 1));

// Fail-open guard: a toggle that threw or matched ZERO objects proved nothing — its shot is
// visually identical to 00-base by construction, not because the hypothesis is false.
console.log("\n### VERDICT");
for (const [tag] of toggles) {
  const r = results[tag];
  const errored = typeof r === "string" && r.startsWith("ERR");
  const zero = r === 0 || r === "0";
  const ok = !errored && !zero;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${tag}  ${errored ? `threw: ${r}` : zero ? "matched ZERO objects — cannot test this hypothesis on this pose" : `applied: ${JSON.stringify(r)}`}`,
  );
}

s.close();
await finishVerify(0);
