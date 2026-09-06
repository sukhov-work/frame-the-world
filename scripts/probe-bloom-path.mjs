#!/usr/bin/env node
/**
 * probe-bloom-path — does T80 direction g change the picture? (2026-09-06, T77/T80)
 *
 * WHAT IT COMPARES. `__quality.bloomPath("msaa")` restores the pre-T80g chain (the bloom's
 * full-resolution additive blend goes back into the 4× MSAA scene buffer, forcing a second
 * resolve); `bloomPath("resolved")` is the ship default (one resolve, then the blend at one
 * sample per pixel). The arithmetic is the same either way — the bloom composite is a per-PIXEL
 * quantity, so `resolve(sample + bloom) == resolve(sample) + bloom` — and the only expected
 * difference is half-float rounding, i.e. ≤ 1 code at 8-bit output.
 *
 * WHY IT IS NOT A SINGLE DIFF (T94). The canvas is not frame-deterministic: dither, sky and tile
 * streaming move pixels between two rAF ticks of one settled boot, so `diff(A, B)` alone cannot
 * separate the lever from the noise. This shoots an INTERLEAVED ladder at ONE settled boot —
 *
 *     A1 msaa · B1 resolved · A2 msaa · B2 resolved   (same gap between every pair)
 *
 * — and reports the SIGNAL diffs (A1↔B1, A2↔B2) next to the NOISE floor measured over the same
 * interval with the path held fixed (A1↔A2, B1↔B2). A lever that changed the picture shows a
 * signal well above its own noise floor, and a structured (haloed) diff image; a lever that did
 * not shows the two indistinguishable. `--reps` repeats the ladder to tighten both.
 *
 * NATIVE RESOLUTION. `deviceScaleFactor 2` over a 1600×950 viewport is the 3200×1900 drawing
 * buffer §14.4 measured, and `Page.captureScreenshot` rasterises at that scale — a downsample
 * would hide exactly the fine-grain difference this is looking for (conventions/verify.md).
 *
 * RESOURCES (conventions/verify.md § the resource budget). This is a tier-V PIXEL probe, so it
 * runs on the ONE house headless Chrome (:9333, profile `/tmp/ftw-cdp`) and ATTACHES to it if a
 * sweep already has it up — never a second browser, never in parallel with another suite.
 *
 *   node scripts/probe-bloom-path.mjs [9333] [--ids a,b] [--reps 2] [--quiet-s 25] [--ultra 0|1]
 *
 * Writes `verify-shots/bloom-path/<stamp>/` — the four captures per rep plus every diff image —
 * and prints a table. Exit 1 if a capture or a diff failed structurally (never on the numbers:
 * the verdict is the owner's).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffPngs, ensureBrowser, httpJson, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const PORT = Number(args.find((a, i) => /^\d+$/.test(a) && (i === 0 || !args[i - 1].startsWith("--"))) ?? 9333);
const IDS = arg("--ids", "dnipro-fpv-west-sunset,dnipro-cityscape").split(",").filter(Boolean);
const REPS = Number(arg("--reps", "2"));
const QUIET_S = Number(arg("--quiet-s", "25"));
const ULTRA = arg("--ultra", "0") === "1";
const DEV = process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321";
const VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 2, mobile: false };

const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = join("verify-shots/bloom-path", STAMP);
mkdirSync(OUT, { recursive: true });

const BUSY = `(() => { const u = window.__globe.u5(); const q = (r) => r ? r.dl.len + r.parse.len + r.stats.queued + r.stats.downloading + r.stats.parsing : 0;
  return q(u.buildings) + q(u.ground) + q(u.enriched); })()`;

await ensureBrowser(PORT, { profile: "/tmp/ftw-cdp" }); // the HOUSE headless — attach, never a second
const target = await httpJson(PORT, "/json/new?about:blank", "PUT");
trackTarget(PORT, target.id);
const s = await openSession(target);
const rows = [];
let code = 0;

/** Two rAF ticks, then a native-resolution PNG. */
async function shoot() {
  await s.ticks(2);
  const r = await s.send("Page.captureScreenshot", { format: "png" });
  return r.data;
}

/** Set the path, let two frames carry it, shoot. */
async function shootPath(path) {
  const state = await s.evalJs(`(window.__quality.bloomPath(${JSON.stringify(path)}), window.__quality.bloomPath())`);
  await s.ticks(2);
  return { b64: await shoot(), state };
}

try {
  await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => { try { const k = "ftw:view-prefs:v1"; const o = JSON.parse(localStorage.getItem(k) || "{}"); o.ultraQuality = ${ULTRA}; o.debugHud = false; localStorage.setItem(k, JSON.stringify(o)); } catch {} })()`,
  });
  await s.send("Emulation.setDeviceMetricsOverride", VIEWPORT);

  for (const id of IDS) {
    const pose = byId(id);
    if (!pose) throw new Error(`unknown pose id: ${id}`);
    const { url } = poseUrl(pose, { dev: DEV, ultra: ULTRA });
    console.log(`\n── ${id} ──\n boot ${url}`);
    await s.bootUrl(url);
    await s.waitFor(
      `!!(window.__globe && window.__globe.u5 && window.__renderer && window.__quality && typeof window.__quality.bloomPath === "function")`,
      120_000,
      "globe + bloomPath seam",
    );
    await s.send("Page.bringToFront");
    await s.evalJs(
      `(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true`,
    );
    await s.waitFor(`!window.__globe.flight || !window.__globe.flight.active()`, 60_000, "flight settled");
    if (pose.kind === "fpv") {
      await s.waitFor(`!!window.__globe.fpv && window.__globe.fpv().active`, 60_000, "FPV active");
    }
    // Pin the clock so the sun cannot move between the four captures, then wait for tile quiet.
    await s.evalJs(`window.__timeStore.getState().setTime(${pose.t}), true`);
    const t0 = Date.now();
    let quietSince = null;
    while (Date.now() - t0 < QUIET_S * 1000) {
      const busy = await s.evalJs(BUSY);
      if (busy === 0) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince > 1500) break;
      } else quietSince = null;
      await sleep(250);
    }
    const q0 = await s.evalJs(`window.__quality.bloomPath()`);
    console.log(` settled in ${((Date.now() - t0) / 1000).toFixed(1)} s  seam ${JSON.stringify(q0)}`);
    if (!q0.bloomEnabled) {
      rows.push({ id, note: "bloom DISABLED at this pose — the lever is inert here", skipped: true });
      continue;
    }

    // CAPTURE EVERY REP FIRST. `diffPngs` navigates the tab to about:blank to decode — running a
    // diff between reps would destroy the settled boot the ladder depends on, so the decoding is
    // deferred until the pose is finished with.
    const ladder = [];
    for (let rep = 0; rep < REPS; rep++) {
      const A1 = await shootPath("msaa");
      const B1 = await shootPath("resolved");
      const A2 = await shootPath("msaa");
      const B2 = await shootPath("resolved");
      await s.evalJs(`window.__quality.bloomPath(null), true`);
      // The seam's own proof the lever fired at capture time.
      if (A1.state.resolveEnabled !== false || B1.state.resolveEnabled !== true) {
        throw new Error(`bloomPath did not take: A1 ${JSON.stringify(A1.state)} B1 ${JSON.stringify(B1.state)}`);
      }
      const tag = `${id}.r${rep}`;
      for (const [k, v] of [["A1.msaa", A1], ["B1.resolved", B1], ["A2.msaa", A2], ["B2.resolved", B2]]) {
        writeFileSync(join(OUT, `${tag}.${k}.png`), Buffer.from(v.b64, "base64"));
      }
      ladder.push({ tag, rep, A1, B1, A2, B2 });
    }

    for (const L of ladder) {
      const pairs = [
        ["signal.A1-B1", L.A1.b64, L.B1.b64],
        ["signal.A2-B2", L.A2.b64, L.B2.b64],
        ["noise.A1-A2", L.A1.b64, L.A2.b64],
        ["noise.B1-B2", L.B1.b64, L.B2.b64],
      ];
      for (const [label, x, y] of pairs) {
        // TWO thresholds. `>0` counts every pixel that moved at all — that band is dominated by
        // the dither and by half-float rounding, and is where an identity claim lives. `>3`
        // strips both and leaves only STRUCTURE: a bloom-path change would show as a halo there,
        // streaming as a patch, and nothing else should survive.
        const d = await diffPngs(s, x, y, { threshold: 0 });
        if (d.error) throw new Error(`${L.tag} ${label}: ${d.error}`);
        const s3 = await diffPngs(s, x, y, { threshold: 3 });
        if (s3.error) throw new Error(`${L.tag} ${label} (t3): ${s3.error}`);
        const file = join(OUT, `${L.tag}.diff.${label}.png`);
        writeFileSync(file, Buffer.from(d.diffB64, "base64"));
        const file3 = join(OUT, `${L.tag}.diff3.${label}.png`);
        writeFileSync(file3, Buffer.from(s3.diffB64, "base64"));
        rows.push({
          id,
          rep: L.rep,
          pair: label,
          w: d.w,
          h: d.h,
          fraction: d.fraction,
          differing: d.differing,
          maxDelta: d.maxDelta,
          differing3: s3.differing,
          fraction3: s3.fraction,
          file,
          file3,
        });
        console.log(
          `  ${label}  ${d.w}×${d.h}  >0 ${d.differing} (${(d.fraction * 100).toFixed(3)} %)  >3 ${s3.differing} (${(s3.fraction * 100).toFixed(4)} %)  maxDelta ${d.maxDelta}`,
        );
      }
    }
  }

  console.log("\n| pose | rep | pair | px >0 | % >0 | px >3 | % >3 | maxDelta |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    if (r.skipped) {
      console.log(`| ${r.id} | — | ${r.note} | — | — | — | — | — |`);
      continue;
    }
    console.log(
      `| ${r.id} | ${r.rep} | ${r.pair} | ${r.differing} | ${(r.fraction * 100).toFixed(4)} % | ${r.differing3} | ${(r.fraction3 * 100).toFixed(4)} % | ${r.maxDelta} |`,
    );
  }
  writeFileSync(join(OUT, "rows.json"), JSON.stringify({ stamp: STAMP, ids: IDS, reps: REPS, ultra: ULTRA, rows }, null, 2));
  console.log(`\nartefacts: ${OUT}`);
} catch (e) {
  console.error("PROBE FAILED:", e.message);
  code = 1;
} finally {
  s.close();
  await finishVerify(code);
}
