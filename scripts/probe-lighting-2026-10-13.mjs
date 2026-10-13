/**
 * PROBE — the daylight LOOK at the owner's Dnipro pose (owner bug 2026-10-13: "shadows too deep
 * and contrasty even at noon, the whole scene too dark and dull").
 *
 * Boots the owner's embankment view at 15:03 local on 12 Oct 2026 (the first screenshot) in the
 * dark drape and in SAT mode, on the base rig and under ULTRA, settles the tile streams, shoots
 * each, and prints a LUMINANCE LEDGER of the ground-and-buildings band (the frame minus the sky
 * and the scrubber): p5 / p25 / p50 / p75 / p95, the mean, and the share of near-black pixels.
 * Run before and after a lighting retune with different `--label`s and diff the ledgers.
 *
 *   ~/.nvm/versions/node/v24.10.0/bin/node scripts/probe-lighting-2026-10-13.mjs [9333] [--label before] [--ultra 0|1|both]
 *       [--poses owner1,owner2,fpv] [--modes dark,sat]
 * Output: verify-shots/lighting/<label>-<pose>-<mode>-u<0|1>.png + ledger.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { ensureBrowser, httpJson, openSession, sleep } from "./lib/cdp.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const LABEL = flag("--label", "before");
const ULTRA = flag("--ultra", "both");
const POSE_IDS = flag("--poses", "owner1,owner2,fpv").split(",");
const MODES = flag("--modes", "dark,sat").split(",");
const ORIGIN = "http://localhost:4321";
const OUT = "verify-shots/lighting";
mkdirSync(OUT, { recursive: true });

// 12 Oct 2026 15:03 EEST (UTC+3) = 12:03Z — the owner's first screenshot; 16:47 EEST = 13:47Z the second.
const T1 = 1791806580000;
const T2 = 1791812820000;
const POSES = {
  owner1: { hash: `#p=48.470991,35.053172,320,28,63&t=${T1}`, kind: "orbit" },
  owner2: { hash: `#p=48.469500,35.050500,180,75,70&t=${T2}`, kind: "orbit" },
  // the catalogue's `dnipro-fpv-south` eye (scripts/lib/poses.mjs), at the first screenshot's instant
  fpv: { hash: `#f=48.45741,35.05653,1.7,180,4,55&t=${T1}`, kind: "fpv" },
};
const VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const BOOT_SCRIPT = (ultra) => `(() => { try { const k = "ftw:view-prefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.ultraQuality = ${ultra ? "true" : "false"}; o.debugHud = false; localStorage.setItem(k, JSON.stringify(o)); } catch {} })()`;
const BUSY = `(() => { const u = window.__globe.u5(); const q = (r) => r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0;
  let um = null; try { um = window.__globe.userModels ? window.__globe.userModels() : null; } catch {}
  return { busy: q(u.buildings) + q(u.ground) + q(u.enriched) + (um ? um.loading : 0), gnd: u.ground.stats.visible }; })()`;

await ensureBrowser(PORT);
const target = await httpJson(PORT, "/json/new?about:blank", "PUT");
const s = await openSession(target);
await s.send("Emulation.setDeviceMetricsOverride", VIEWPORT);
let bootScriptId = null;

async function quiet(maxS = 40, quietMs = 1500) {
  const t0 = Date.now();
  let since = null;
  while (Date.now() - t0 < maxS * 1000) {
    const b = await s.evalJs(BUSY);
    if (b.busy === 0 && b.gnd > 0) {
      since ??= Date.now();
      if (Date.now() - since >= quietMs) return { settleMs: Date.now() - t0, capped: false };
    } else since = null;
    await sleep(250);
  }
  return { settleMs: Date.now() - t0, capped: true };
}

async function ledger(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const y0 = Math.floor(height * 0.28), y1 = Math.floor(height * 0.86); // skip the sky and the scrubber
  const lum = [];
  for (let y = y0; y < y1; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * channels;
    lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  }
  lum.sort((a, b) => a - b);
  const q = (p) => Math.round(lum[Math.floor(p * (lum.length - 1))]);
  const mean = Math.round(lum.reduce((a, b) => a + b, 0) / lum.length);
  const black = lum.filter((v) => v < 12).length / lum.length;
  const dark = lum.filter((v) => v < 30).length / lum.length;
  return { p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), mean, black: +black.toFixed(3), dark: +dark.toFixed(3) };
}

const rows = [];
const ultras = ULTRA === "both" ? [0, 1] : [Number(ULTRA)];
for (const u of ultras) {
  for (const id of POSE_IDS) {
    const pose = POSES[id];
    if (bootScriptId) await s.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: bootScriptId }).catch(() => {});
    bootScriptId = (await s.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT_SCRIPT(!!u) })).identifier;
    await s.bootUrl(`${ORIGIN}/${pose.hash}`);
    await s.waitFor(`!!(window.__globe && window.__globe.camera && window.__globe.u5 && window.__cameraStore)`, 120_000, "globe up");
    await s.send("Page.bringToFront");
    await s.evalJs(`(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`);
    await s.waitFor(`!window.__globe.flight || !window.__globe.flight.active()`, 60_000, "flight settled");
    if (pose.kind === "fpv") await s.waitFor(`!!window.__globe.fpv && window.__globe.fpv().active`, 60_000, "FPV active");
    for (const mode of MODES) {
      await s.evalJs(`window.__cameraStore.getState().setGroundMode("${mode === "sat" ? "satellite" : "dark"}")`);
      await sleep(1200);
      const st = await quiet();
      await sleep(1500); // the drape crossfade (DRAPE.easeTauMs 350) + the reveal ease
      await s.ticks(3);
      const shot = await s.send("Page.captureScreenshot", { format: "png" });
      const png = Buffer.from(shot.data, "base64");
      const file = `${OUT}/${LABEL}-${id}-${mode}-u${u}.png`;
      writeFileSync(file, png);
      const L = await ledger(png);
      const q = await s.evalJs(`(() => { const q = window.__globeQuality; const g = window.__globe; const l = g.ultraLook ? g.ultraLook() : null; return { tier: q && q.tier, ultra: q && q.ultra, shadowPx: q && q.shadowMapPx, alt: +g.alt().toFixed(0), look: l ? { directK: l.directK, skyLevel: l.skyLevel } : null }; })()`);
      const row = { label: LABEL, pose: id, mode, ultra: u, file, settle: st, quality: q, ...L };
      rows.push(row);
      console.log(`${LABEL} ${id} ${mode} u${u} tier=${q.tier} shadow=${q.shadowPx} alt=${q.alt}  p5=${L.p5} p25=${L.p25} p50=${L.p50} p75=${L.p75} p95=${L.p95} mean=${L.mean} black<12=${(L.black * 100).toFixed(1)}% dark<30=${(L.dark * 100).toFixed(1)}%${st.capped ? "  (settle CAPPED)" : ""}`);
    }
  }
}
writeFileSync(`${OUT}/${LABEL}-ledger.json`, JSON.stringify(rows, null, 2));
s.close();
await httpJson(PORT, `/json/close/${target.id}`).catch(() => {});
