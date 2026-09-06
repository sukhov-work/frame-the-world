#!/usr/bin/env node
/**
 * probe-bloom-path — does the bloom PATH change the picture? (2026-09-06, T77/T80 g → h)
 *
 * WHAT IT COMPARES. `__quality.bloomPath(p)` pins one of three chains at one settled boot:
 * `"msaa"` — the pre-T80g chain (the bloom's full-resolution additive blend into the 4× MSAA
 * scene buffer, forcing a second resolve); `"resolved"` — T80-g (one resolve, then the blend at
 * one sample per pixel); `"fused"` — T80-h, the ship default (no copy, no blend: the output
 * pass adds the mip-0 composite to the scene sample before the tone map). The arithmetic is the
 * same on all three — the bloom composite is a per-PIXEL quantity, so
 * `resolve(sample + bloom) == resolve(sample) + bloom`, and the fused add samples the same two
 * textures at the same `vUv` — and the only expected difference is half-float rounding
 * (`resolved` rounds the sum to half float once more than `fused`), i.e. ≤ 1 code at 8-bit output.
 *
 * THE LADDER, and the noise floor. This shoots an INTERLEAVED ladder at ONE settled boot —
 *
 *     P1 msaa · Q1 resolved · R1 fused · P2 msaa · Q2 resolved · R2 fused   (`--paths`)
 *
 * — and reports the SIGNAL diffs (every pair of distinct paths within a ladder) next to the NOISE
 * floor measured over the same interval with the path held fixed (P1↔P2, Q1↔Q2, R1↔R2). Since
 * T94 the frame is FROZEN first (`__globe.freezeFrame`, the sweep's two-phase recipe: streaming
 * held → drain → the reveal eases run out → the clock held too), so the noise floor reads ZERO
 * and a signal is exactly the lever's residual; `--no-freeze` measures the old way, against a
 * live noise floor. A lever that changed the picture shows a signal well above its noise floor
 * and a structured (haloed) `diff3` image; rounding shows as scattered `>0` pixels with
 * `maxDelta` 1 and an empty `>3`. `--reps` repeats the ladder.
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
 *                                     [--paths msaa,resolved,fused] [--no-freeze]
 *
 * Writes `verify-shots/bloom-path/<stamp>/` — every capture per rep plus every diff image — and
 * prints a table with a VERDICT line per pose. Exit 1 if a capture or a diff failed structurally,
 * or if the frozen self-check (noise floor) is not zero under `--freeze` (the probe cannot then
 * tell the lever from the noise); never on the signal numbers — that verdict is the owner's.
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
const PATHS = arg("--paths", "msaa,resolved,fused").split(",").filter(Boolean);
const FREEZE = !args.includes("--no-freeze");
const REVEAL_SETTLE_S = Number(arg("--reveal-settle-s", "3"));
for (const p of PATHS) if (!["msaa", "resolved", "fused"].includes(p)) throw new Error(`--paths: unknown path "${p}"`);
if (PATHS.length < 2) throw new Error("--paths needs at least two paths to compare");
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

/** The seam's own proof a pin took: the LIVE resolve / deferred-blend / output-material state. */
function pinTook(path, st) {
  if (path === "msaa") return st.resolveEnabled === false && st.deferBlend === false && st.outputMaterial === "OutputShader";
  if (path === "resolved") return st.resolveEnabled === true && st.deferBlend === false && st.outputMaterial === "OutputShader";
  return st.resolveEnabled === false && st.deferBlend === true && st.outputMaterial === "FusedOutputShader";
}

const FREEZE_PHASE1 = `(() => { const g = window.__globe; if (!g || typeof g.freezeFrame !== "function") return null;
  const s = g.freezeFrame(true, { clock: false }); return { frozenAtMs: s.frozenAtMs, parts: s.parts, held: s.held }; })()`;
const FREEZE_ON = `(() => { const g = window.__globe; if (!g || typeof g.freezeFrame !== "function") return null;
  const s = g.freezeFrame(true); return { frozenAtMs: s.frozenAtMs, parts: s.parts, held: s.held }; })()`;
const FREEZE_OFF = `(() => { const g = window.__globe; if (!g || typeof g.freezeFrame !== "function") return null;
  const s = g.freezeFrame(false); return { frozenAtMs: s.frozenAtMs, skewMs: Math.round(s.skewMs) }; })()`;

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
    // T94 — FREEZE the frame (the sweep's two-phase recipe) so the ladder's noise floor is zero:
    // streaming + rig held with the clock live → the in-flight tiles drain → their reveal eases
    // run out → the clock is held too. Without it the diff cannot tell rounding from dither.
    let frozen = null;
    if (FREEZE) {
      frozen = await s.evalJs(FREEZE_PHASE1);
      if (!frozen) {
        console.log(" freezeFrame seam ABSENT — measuring against a live noise floor");
      } else {
        const d0 = Date.now();
        while (Date.now() - d0 < 10_000 && (await s.evalJs(BUSY)) !== 0) await sleep(250);
        await sleep(REVEAL_SETTLE_S * 1000);
        frozen = await s.evalJs(FREEZE_ON);
        await s.ticks(2);
        console.log(` frozen: ${frozen.held.length} holds (${frozen.parts ? Object.keys(frozen.parts).filter((k) => frozen.parts[k]).join("+") : "?"})`);
      }
    }

    // CAPTURE EVERY REP FIRST. `diffPngs` navigates the tab to about:blank to decode — running a
    // diff between reps would destroy the settled boot the ladder depends on, so the decoding is
    // deferred until the pose is finished with.
    const ladder = [];
    for (let rep = 0; rep < REPS; rep++) {
      const shots = {}; // `${path}.1` / `${path}.2`
      for (const rung of [1, 2]) {
        for (const path of PATHS) {
          const shot = await shootPath(path);
          // The seam's own proof the lever fired at capture time (live state, not the request).
          if (!pinTook(path, shot.state)) throw new Error(`bloomPath("${path}") did not take: ${JSON.stringify(shot.state)}`);
          shots[`${path}.${rung}`] = shot;
        }
      }
      await s.evalJs(`window.__quality.bloomPath(null), true`);
      // POSITIVE CONTROL (zero-result validation): on the last rep, pin the mip chain to half
      // resolution — a change that MUST move pixels — and shoot once more. If that diff is also
      // zero the frame is not being re-rendered under the freeze and every "SAME picture" above
      // is vacuous; the verdict then reads PROBE BLIND rather than passing the lever.
      let control = null;
      if (rep === REPS - 1 && (await s.evalJs(`!!(window.__quality && typeof window.__quality.bloomScale === "function")`))) {
        const st = await s.evalJs(`(window.__quality.bloomScale(0.5), window.__quality.bloomScale())`);
        await s.ticks(2);
        control = { b64: await shoot(), state: st };
        await s.evalJs(`window.__quality.bloomScale(null), true`);
        await s.ticks(2);
      }
      const tag = `${id}.r${rep}`;
      for (const [k, v] of Object.entries(shots)) writeFileSync(join(OUT, `${tag}.${k}.png`), Buffer.from(v.b64, "base64"));
      if (control) writeFileSync(join(OUT, `${tag}.control.scale05.png`), Buffer.from(control.b64, "base64"));
      ladder.push({ tag, rep, shots, control });
    }
    if (frozen) await s.evalJs(FREEZE_OFF);

    for (const L of ladder) {
      const pairs = [];
      for (let i = 0; i < PATHS.length; i++) {
        for (let j = i + 1; j < PATHS.length; j++) {
          for (const rung of [1, 2]) {
            pairs.push([`signal.${PATHS[i]}-${PATHS[j]}.${rung}`, L.shots[`${PATHS[i]}.${rung}`].b64, L.shots[`${PATHS[j]}.${rung}`].b64]);
          }
        }
      }
      for (const p of PATHS) pairs.push([`noise.${p}.1-2`, L.shots[`${p}.1`].b64, L.shots[`${p}.2`].b64]);
      if (L.control) pairs.push([`control.${PATHS.at(-1)}.2-scale05`, L.shots[`${PATHS.at(-1)}.2`].b64, L.control.b64]);
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
          frozen: !!frozen,
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
  // VERDICT per pose: the frozen noise floor must be ZERO (else the probe is blind and exits 1);
  // then each path pair is "same picture (rounding)" when its `>3` count is 0 and maxDelta ≤ 1,
  // "same picture" when nothing moved, and "CHANGED" otherwise (the owner reads the diff3 image).
  const verdicts = [];
  for (const id of IDS) {
    const mine = rows.filter((r) => r.id === id && !r.skipped);
    if (!mine.length) continue;
    const noise = mine.filter((r) => r.pair.startsWith("noise."));
    const noiseMax = Math.max(0, ...noise.map((r) => r.differing));
    const frozenHere = mine.every((r) => r.frozen);
    const ctrl = mine.find((r) => r.pair.startsWith("control."));
    if (ctrl && ctrl.differing === 0) {
      code = 1;
      verdicts.push(`${id}: UNINFORMATIVE — the positive control (mip chain at 0.5) moved 0 px: either the bloom contributes no visible pixel at this pose (nothing above the threshold in frame) or the frame is not re-rendering under the freeze; every zero above is vacuous either way — read a pose where the control moves`);
      continue;
    }
    if (frozenHere && noiseMax > 0) {
      code = 1;
      verdicts.push(`${id}: PROBE BLIND — the frozen frame moved ${noiseMax} px between two captures; the freeze did not hold (T94/T102 shape), no verdict`);
      continue;
    }
    const byPair = new Map();
    for (const r of mine.filter((r) => r.pair.startsWith("signal."))) {
      const key = r.pair.replace(/\.\d$/, "");
      const acc = byPair.get(key) ?? { d0: 0, d3: 0, max: 0, n: 0 };
      acc.d0 = Math.max(acc.d0, r.differing);
      acc.d3 = Math.max(acc.d3, r.differing3);
      acc.max = Math.max(acc.max, r.maxDelta);
      acc.n++;
      byPair.set(key, acc);
    }
    for (const [key, a] of byPair) {
      const state = a.d0 === 0 ? "SAME picture (byte-identical)" : a.d3 === 0 && a.max <= 1 ? `SAME picture up to rounding (${a.d0} px at Δ1, none >3)` : `CHANGED — ${a.d3} px >3, maxDelta ${a.max} (read the diff3 image)`;
      verdicts.push(`${id} ${key.replace("signal.", "")}: ${state}${frozenHere ? " · noise floor 0 (frozen)" : ` · live noise floor ≤ ${noiseMax} px`}${ctrl ? ` · control moved ${ctrl.differing} px` : ""}`);
    }
  }
  console.log("");
  for (const v of verdicts) console.log(`VERDICT  ${v}`);
  if (!verdicts.length) console.log("VERDICT  no pose produced a comparison (bloom off everywhere?) — nothing was proven");
  writeFileSync(join(OUT, "rows.json"), JSON.stringify({ stamp: STAMP, ids: IDS, reps: REPS, ultra: ULTRA, paths: PATHS, freeze: FREEZE, rows, verdicts }, null, 2));
  console.log(`\nartefacts: ${OUT}`);
} catch (e) {
  console.error("PROBE FAILED:", e.message);
  code = 1;
} finally {
  s.close();
  await finishVerify(code);
}
