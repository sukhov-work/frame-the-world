// PROBE (owner bug 2026-09-19 c): "after … exit FPV, sometimes ALL ground tiles are reset to white".
// Boots a LEAN /m twin straight into FPV (`#f=`), leaves FPV (which forces the flat 2D chart), and
// watches every ground tile's imagery composite across the exit — beside the three global
// suspects: an overlay REBUILD (`__overlayRebuilds`), a quality-tier move, a lost WebGL context.
//
//   node scripts/probe-white-ground.mjs [9333] [--desktop] [--shots]
//
// `--desktop` runs the same exit on `/` (the comparator: a `high` desktop never ratchets).
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const DESKTOP = args.includes("--desktop");
const SHOTS = args.includes("--shots");
await ensureBrowser(PORT);
const { url } = poseUrl({ ...byId("dnipro-fpv-south"), path: DESKTOP ? "/" : "/m" });
let target;
try {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
} catch {
  target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
}
trackTarget(PORT, target.id);
const s = await openSession(target);
if (!DESKTOP) {
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 4, configurable: true });` });
  await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await s.send("Emulation.setDeviceMetricsOverride", { width: 402, height: 714, deviceScaleFactor: 3, mobile: true });
}
const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
const PROBE = `(() => { const g = window.__globe, t = g.ground; const p = t.getPluginByName && t.getPluginByName("IMAGE_OVERLAY_PLUGIN"); const o = { meshes: 0, white: 0, ok: 0 };
  if (p && p.meshParams) t.group.traverse((m) => { if (!m.isMesh || !m.visible || !p.meshParams.has(m)) return; o.meshes++; const d = m.material.defines || {}; const x = p.meshParams.get(m).layerMaps.value[0];
    if (!d.LAYER_COUNT || !d.LAYER_0_EXISTS || !x || (x.image && x.image.width === 0)) o.white++; else o.ok++; });
  const q = window.__quality || {}; return { ...o, rebuilds: window.__overlayRebuilds ?? 0, tier: q.tier ?? null, pending: q.pendingTier ?? null, ctxLost: window.__ctxLostN ?? 0, fpv: g.fpv().active }; })()`;
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync("verify-shots", { recursive: true });
  const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(r.data, "base64"));
};

await s.bootUrl(url);
await s.waitFor(`!!window.__globe && !!window.__cameraStore && window.__cameraStore.getState().fpvHud !== null`, 120_000, "FPV live");
await s.evalJs(`window.__ctxLostN = 0, document.querySelector("canvas").addEventListener("webglcontextlost", () => window.__ctxLostN++), true`);
await sleep(9000); // let the FPV ground settle
const pre = await J(PROBE);
console.log(`in FPV: ${pre.white}/${pre.meshes} tiles without imagery · tier ${pre.tier} (pending ${pre.pending}) · rebuilds ${pre.rebuilds}`);
await shot(`white-ground-${DESKTOP ? "desktop" : "m"}-00-fpv`);
await s.evalJs(`window.__cameraStore.getState().setTempFpv(false), (window.__uploadStore?.getState().setViewMode?.("orbit")), true`);
const t0 = Date.now();
let worst = null;
let firstWhiteAt = null;
let healedAt = null;
let shotTaken = false;
while (Date.now() - t0 < 30_000) {
  const r = await J(PROBE);
  const at = Date.now() - t0;
  const frac = r.meshes ? r.white / r.meshes : 0;
  if (!worst || frac > worst.frac) worst = { ...r, at, frac };
  if (frac > 0.5 && firstWhiteAt === null) firstWhiteAt = at;
  if (frac > 0.5 && !shotTaken) {
    shotTaken = true;
    await shot(`white-ground-${DESKTOP ? "desktop" : "m"}-01-white`);
  }
  if (firstWhiteAt !== null && healedAt === null && frac < 0.05 && r.meshes > 0) healedAt = at;
  await sleep(250);
}
const end = await J(PROBE);
await shot(`white-ground-${DESKTOP ? "desktop" : "m"}-02-end`);
console.log(`after EXIT: worst ${worst.white}/${worst.meshes} (${(worst.frac * 100).toFixed(0)} %) without imagery at +${worst.at} ms · first > 50 % at ${firstWhiteAt === null ? "never" : `+${firstWhiteAt} ms`} · healed ${healedAt === null ? "—" : `+${healedAt} ms`}`);
console.log(`          rebuilds ${pre.rebuilds} → ${end.rebuilds} · tier ${pre.tier} → ${end.tier} · ctxLost ${end.ctxLost} · end ${end.white}/${end.meshes}`);
s.close();
await finishVerify(0);
