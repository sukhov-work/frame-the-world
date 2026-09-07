// Browser verification for BEST SPOT ON /m (owner order 2026-09-07g) — the fifth bottom-row tab,
// the mobile sheet, the engine gate on both shells, buildings attached while armed, and the phone
// twin's frame time + JS heap while the sheet is up.
//
//   node scripts/verify-bestspot-mobile.mjs [9333] [--no-lean] [--shots]
//   node scripts/verify-bestspot-mobile.mjs 9444 --device [--shots]     # a real phone over adb (README §B)
//
// Boots `/m` at the catalogue's `legacy-m` pose (Dnipro, the 2D map) on the lean profile — touch +
// 402×714 @3 + 4 cores + 4× CPU — the `probe-skyline-fine --lean` idiom. Every scalar is read out of
// the LIVE engine (`__globe.bestSpot()`, `__globe.bestSpotSheet()`, `__globe.buildingsLoad()`) and
// the store (`__bestSpotStore`); the UI is driven through the REAL buttons (the tab, the switch,
// the pills, a row) so the sheet's wiring is what is tested, not the store seams. The 375 px tab
// fit is measured with a second metrics override — five labels, one row, no wrap, no overflow.
//
// Runs from the main session on the ONE house Chrome (conventions/verify.md §THE RESOURCE BUDGET).
// Screenshots land in verify-shots/ (git-ignored) with `--shots`.

import { mkdirSync, writeFileSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const DEVICE = args.includes("--device");
const LEAN = !args.includes("--no-lean") && !DEVICE;
const SHOTS = args.includes("--shots");

const notes = [];
const fails = [];
const ok = (cond, msg) => (cond ? notes.push(`  PASS  ${msg}`) : fails.push(`  FAIL  ${msg}`));

const browser = await ensureBrowser(PORT, { launch: !DEVICE });
const { url } = poseUrl(byId("legacy-m"));
let target;
if (DEVICE) {
  // T118 (2026-09-08): the same checks on a REAL phone — attach to the tab the README §B recipe
  // opened (Android Chrome refuses `/json/new`), no emulation, the device's own tier; the
  // viewport-fit checks below then read the phone's real width.
  const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
  const pages = list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  target = pages.find((t) => /localhost:4321/.test(t.url)) ?? pages[0];
  if (!target) throw new Error("no page tab on the phone — open http://localhost:4321/ in Chrome first (tools/devicefarm/README.md §B)");
  console.log(`attached to the phone tab ${target.id} ${target.url} (${browser.browser})`);
} else {
  try {
    target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  } catch {
    target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
  }
  trackTarget(PORT, target.id);
}
const s = await openSession(target);
if (DEVICE) await s.send("Page.bringToFront").catch(() => {});
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync("verify-shots", { recursive: true });
  const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(r.data, "base64"));
};
const phone = async (w, h, dsf) => {
  if (DEVICE) return; // the phone is its own viewport
  await s.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dsf, mobile: true });
};
if (LEAN) {
  await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 4, configurable: true });`,
  });
  await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}
await phone(402, 714, 3);
await s.bootUrl(url);
await s.waitFor(`!!window.__globe && typeof window.__globe.bestSpot === "function" && !!window.__bestSpotStore`, 90_000, "globe up");
await sleep(1500);
const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
const tap = async (selector, label) => {
  const hit = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  ok(hit === true || hit === "true", `tap ${label} (${selector})`);
  await sleep(120);
};
const tapText = async (root, text, label) => {
  const hit = await s.evalJs(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(root)})]; const el = els.find((e) => (e.textContent || "").trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
  ok(hit === true || hit === "true", `tap ${label} ("${text}")`);
  await sleep(120);
};

// ── 1. The tab bar: five items, SPOT last, fits 375 px ────────────────────────────────────────
{
  // The glyph span and the label have no separator in textContent — drop the first code point.
  const tabs = await J(`[...document.querySelectorAll(".m-tab")].map((b) => Array.from((b.textContent || "").trim()).slice(1).join("").trim())`);
  ok(tabs.length === 5, `five tabs (${tabs.join(" · ")})`);
  ok(tabs[4] === "SPOT" && tabs[3] === "SEARCH", "SPOT is the fifth item, right of SEARCH");
  await phone(375, 667, 2);
  await sleep(300);
  const fit = await J(`(() => {
    const row = document.querySelector(".m-tabs"); const r = row.getBoundingClientRect();
    const cells = [...row.querySelectorAll(".m-tab")].map((b) => { const c = b.getBoundingClientRect(); return { w: c.width, h: c.height, sw: b.scrollWidth, cw: b.clientWidth, lines: Math.round(c.height / parseFloat(getComputedStyle(b).lineHeight || "12")) }; });
    return { rowW: r.width, rowSW: row.scrollWidth, cells, vw: innerWidth };
  })()`);
  ok(DEVICE ? fit.vw > 0 : fit.vw === 375, `viewport ${DEVICE ? "the phone's own" : "375 px"} for the fit check (got ${fit.vw})`);
  ok(fit.rowSW <= fit.rowW + 1, `the tab row does not overflow at 375 px (scrollWidth ${fit.rowSW} ≤ ${Math.round(fit.rowW)})`);
  const maxH = Math.max(...fit.cells.map((c) => c.h));
  const minH = Math.min(...fit.cells.map((c) => c.h));
  ok(maxH - minH < 2, `all five cells share one height — no label wrapped (${minH.toFixed(1)}–${maxH.toFixed(1)} px)`);
  ok(fit.cells.every((c) => c.sw <= c.cw + 1), `no label overflows its cell (${fit.cells.map((c) => `${c.sw}/${c.cw}`).join(" ")})`);
  await shot("bestspot-m-01-tabbar-375");
  await phone(402, 714, 3);
  await sleep(300);
}

// ── 2. Open the sheet: the store opens, stays disarmed, and says so ───────────────────────────
await tap(".m-tab:nth-child(5)", "the SPOT tab");
{
  const st = await J(`(() => { const st = window.__bestSpotStore.getState(); return { open: st.open, on: st.heatmapOn, sheet: !!document.querySelector('.m-sheet[aria-label="BEST SPOT"]'), text: document.querySelector(".m-sheet__body")?.textContent || "" }; })()`);
  ok(st.open === true, "the first visit opens the window in the store");
  ok(st.on === false, "…and leaves the heatmap OFF (owner item 4)");
  ok(st.sheet, "the BEST SPOT sheet is up");
  ok(/HEATMAP OFF — NOTHING IS BEING COMPUTED/.test(st.text), "OFF copy on screen");
  ok(/NO CENTRE YET/.test(st.text) && /CENTRE HERE/.test(st.text), "no centre yet → CENTRE HERE offered");
  ok(!/ULTRA/.test(st.text) && !/REFINE/.test(st.text), "no ULTRA, no REFINE on the phone");
  const feed = await J(`window.__globe.bestSpot()`);
  ok(feed.jobs === 0 || feed.jobs === undefined || feed.inFlight === 0, `nothing solved while OFF (jobs ${feed.jobs}, inFlight ${feed.inFlight})`);
  await shot("bestspot-m-02-sheet-off");
}

// ── 3. CENTRE HERE → a temp pin at the map focus; the switch arms; buildings attach in 2D ─────
await tapText(".m-sheet__body button", "◎ CENTRE HERE", "CENTRE HERE");
{
  const pin = await J(`window.__cameraStore.getState().tempPin`);
  ok(pin && Math.abs(pin.latDeg - 48.464) < 0.01 && Math.abs(pin.lonDeg - 35.046) < 0.01, `temp pin at the map focus (${pin?.latDeg?.toFixed(4)}, ${pin?.lonDeg?.toFixed(4)})`);
}
const before = await J(`(() => { const b = window.__globe.buildingsLoad?.(); return { mapMode: window.__cameraStore.getState().mapMode, tiles: b?.tiles ?? -1 }; })()`);
ok(before.mapMode === "2d", `/m booted into the 2D map (mapMode ${before.mapMode})`);
const t0 = Date.now();
await tap(".m-bsp-switch", "the HEATMAP switch");
{
  const st = await J(`(() => { const st = window.__bestSpotStore.getState(); return { on: st.heatmapOn, state: document.querySelector(".m-bsp-switch__state")?.textContent }; })()`);
  ok(st.on === true, "the switch arms the store");
  ok(st.state === "ON", `the switch reads ON (got ${st.state})`);
}
// T118 (owner ruling 2026-09-08): the first post is HELD until the scene has streamed, and the
// ONE status chip narrates it — LOADING THE SCENE… → COMPUTING… → ✓ DONE. Poll the chip and the
// hold at 100 ms until first ink, then read the first rung's provenance: the first job must be a
// REAL solve (buildings reached the disc), not the `no-built-geometry` refusal + a heal.
// the solve ladder: 24 → 12 → 6 → 3 m; wait for the finest rung on the phone twin (bounded)
const chipStates = [];
let firstInk = null;
for (let i = 0; i < 600 && !firstInk; i++) {
  const r = await J(`(() => { const st = window.__bestSpotStore.getState(); const h = window.__globe.bestSpot().hold; const chip = document.querySelector(".m-bsp-progress"); return { rung: st.ladderRung, held: st.held, hold: h, chip: chip ? chip.textContent : null, busy: chip?.getAttribute("data-busy"), hp: st.heightProvenance, jobs: window.__globe.bestSpot().jobs }; })()`);
  if (r.chip && chipStates[chipStates.length - 1] !== r.chip) chipStates.push(r.chip);
  if (r.rung >= 0) firstInk = r;
  else await sleep(100);
}
ok(firstInk !== null, "first ink within 60 s");
const firstInkMs = Date.now() - t0;
await s.waitFor(`(() => { const st = window.__bestSpotStore.getState(); return st.ladderRung >= 3 && st.gridCellM <= st.cellM && !st.solving; })()`, 120_000, "finest rung landed");
const finestMs = Date.now() - t0;
{
  const h = firstInk?.hold ?? {};
  ok(h.holds >= 1 && h.heldFrames > 0, `T118: the first post was HELD for the scene (holds ${h.holds}, ${h.heldFrames} frames, last hold ${Math.round(h.lastHoldMs ?? 0)} ms, stream pending at ink ${h.streamPending})`);
  ok(firstInk && firstInk.hp.enriched + firstInk.hp.osm > 0, `T118: the FIRST rung already carries building heights (${firstInk?.hp?.enriched} surveyed + ${firstInk?.hp?.osm} OSM) — no refusal, no heal (jobs ${firstInk?.jobs})`);
  ok(chipStates.some((c) => /LOADING THE SCENE/.test(c)), `the chip said LOADING THE SCENE… during the hold (seen: ${chipStates.join(" → ")})`);
  ok(!/DONE/.test(chipStates[0] ?? ""), `…and never claimed DONE before anything was asked (first seen: ${chipStates[0] ?? "(no chip)"})`);
  ok(chipStates.some((c) => /COMPUTING/.test(c)), "…and COMPUTING… once the job posted");
}
await sleep(2500); // the streaming re-solve quiet window
{
  const done = await J(`(() => { const chip = document.querySelector(".m-bsp-progress"); return { text: chip?.textContent ?? null, busy: chip?.getAttribute("data-busy"), state: chip?.getAttribute("data-state") }; })()`);
  ok(done.state === "done" && /DONE/.test(done.text ?? "") && done.busy === "0", `the chip reads ✓ DONE at rest (${JSON.stringify(done)})`);
}
{
  const st = await J(`(() => { const st = window.__bestSpotStore.getState(); const f = window.__globe.bestSpot(); const sh = window.__globe.bestSpotSheet(); const b = window.__globe.buildingsLoad?.(); return { rung: st.ladderRung, cellM: st.gridCellM, topK: st.topK.length, counts: st.verdictCounts, coverage: st.coverage, reachM: st.reachM, hp: st.heightProvenance, terrainOnly: st.terrainOnly, centre: [st.centreLatDeg, st.centreLonDeg], sheetVisible: sh.visible, fade: sh.fade, jobs: f.jobs, timings: f.timings, mapMode: window.__cameraStore.getState().mapMode, bldTiles: b?.tiles ?? -1, bldMeshes: b?.meshes ?? -1, text: document.querySelector(".m-sheet__body")?.textContent || "" }; })()`);
  ok(st.rung >= 3 && st.cellM === 3, `the finest rung landed at 3 m (rung ${st.rung}, cell ${st.cellM} m) — first ink ${firstInkMs} ms, finest ${finestMs} ms`);
  ok(st.topK > 0, `a shortlist exists (${st.topK} rows)`);
  ok(st.counts.total > 0 && st.counts.scored > 0, `the disc is scored (${st.counts.scored} of ${st.counts.total}, coverage ${st.coverage.toFixed(2)}, reach ${Math.round(st.reachM)} m)`);
  ok(st.sheetVisible === true && st.fade > 0.5, `the GL sheet DRAWS on /m (visible ${st.sheetVisible}, fade ${st.fade.toFixed(2)}) — the §6.10 (C) gate is gone`);
  ok(st.mapMode === "2d", `still on the 2D map (mapMode ${st.mapMode})`);
  ok(st.bldMeshes > 0, `building meshes are RESIDENT on the 2D map while armed (${st.bldMeshes} meshes, ${st.bldTiles} tiles)`);
  ok(st.hp.enriched + st.hp.osm > 0, `building heights reached the disc (${st.hp.enriched} surveyed + ${st.hp.osm} OSM)`);
  ok(st.terrainOnly === false, "the disc is NOT terrain-only (the prior did not fire)");
  ok(/% UNMAPPED · COVERAGE/.test(st.text) && /OBSTRUCTION AT 3 m/.test(st.text) && /EVIDENCE REACHES/.test(st.text), "the three inline honesty lines are on screen");
  ok(/5 MORE CAVEATS/.test(st.text), "the other five are one tap away");
  ok(/THE FIELD STAYS ON THE MAP WHEN THIS SHEET CLOSES/.test(st.text), "the sticky promise is printed");
  await shot("bestspot-m-03-solved");
}
// the caveats fold: tap → five more lines appear, all from the shared copy
await tapText(".m-bsp-more", "▸", "MORE CAVEATS");
{
  const text = await J(`document.querySelector(".m-sheet__body")?.textContent || ""`);
  ok(/A VERTICAL EDGE RESOLVES TO ~HALF A DISC/.test(text) && /LANDCOVER EDGES CARRY/.test(text) && /BUILDING HEIGHTS:/.test(text) && /SCORING: /.test(text), "the folded caveats render on tap");
}

// ── 4. Collapse the sheet: the field survives; the tab reads SCENE ────────────────────────────
await tap(".m-sheet__x", "close (✕)");
{
  const st = await J(`(() => { const st = window.__bestSpotStore.getState(); const sh = window.__globe.bestSpotSheet(); return { open: st.open, on: st.heatmapOn, topK: st.topK.length, sheetVisible: sh.visible, sheetDom: !!document.querySelector('.m-sheet[aria-label="BEST SPOT"]'), active: document.querySelector(".m-tab--on")?.textContent?.trim() }; })()`);
  ok(st.sheetDom === false, "the sheet chrome is gone");
  ok(st.open === true && st.on === true, "…but the store stays OPEN and ARMED (the FIND idiom)");
  ok(st.sheetVisible === true && st.topK > 0, `the field + ${st.topK} markers stay on the map`);
  await shot("bestspot-m-04-collapsed-field-on-map");
}

// ── 5. Frame time + heap with the sheet up on the phone twin ──────────────────────────────────
await s.evalJs(`(() => { window.__ftDt = []; let last = performance.now(); const step = () => { const n = performance.now(); window.__ftDt.push(n - last); last = n; if (window.__ftDt.length < 240) requestAnimationFrame(step); }; requestAnimationFrame(step); return true; })()`);
await sleep(5000);
{
  const m = await J(`(() => { const dt = window.__ftDt || []; const sorted = [...dt].sort((a, b) => a - b); const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0; const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1; return { n: dt.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +Math.max(0, ...dt).toFixed(1), over33: dt.filter((x) => x > 33).length, heapMB: mem }; })()`);
  ok(m.n >= 120, `frames sampled with the sheet up (${m.n})`);
  notes.push(`  INFO  frame dt p50 ${m.p50} · p95 ${m.p95} · max ${m.max} ms · >33 ms ${m.over33}/${m.n} · JS heap ${m.heapMB} MB (4× CPU throttle, 402×714 @3 — a functional proxy, never a timing source)`);
}

// ── 6. Re-open: the list, a row → select → LOOK → FPV preview → EXIT VIEW ends it ────────────
await tap(".m-tab:nth-child(5)", "the SPOT tab again");
{
  const st = await J(`(() => { const st = window.__bestSpotStore.getState(); return { on: st.heatmapOn, rows: document.querySelectorAll(".m-bsp-row").length, ranking: document.querySelector(".m-rows")?.getAttribute("data-ranking") }; })()`);
  ok(st.on === true, "re-visiting the tab did NOT disarm the heatmap");
  ok(st.rows > 0 && st.ranking === "0", `${st.rows} shortlist rows, ranked (data-ranking ${st.ranking})`);
}
await tap(".m-bsp-row:first-child .m-row__jump", "row #1");
{
  const st = await J(`(() => { const st = window.__bestSpotStore.getState(); return { sel: st.selectedKey, key: st.topK[0]?.key, acts: document.querySelectorAll(".m-bsp-acts .m-act").length, text: document.querySelector(".m-bsp-why")?.textContent || "" }; })()`);
  ok(st.sel === st.key, `the tap SELECTS row #1 (${st.sel})`);
  ok(st.acts === 2, `two actions on the selected row (GO, LOOK) — got ${st.acts}`);
  ok(/FROM HERE/.test(st.text), "the WHY line is the shared copy's");
  await shot("bestspot-m-05-row-selected");
}
await tapText(".m-bsp-acts .m-act", "◎ LOOK FROM HERE", "LOOK FROM HERE");
await s.waitFor(`(() => { const c = window.__cameraStore.getState(); return c.tempFpv === true && c.fpvHud !== null; })()`, 30_000, "FPV preview entered");
await sleep(1500);
{
  const st = await J(`(() => { const st = window.__bestSpotStore.getState(); const c = window.__cameraStore.getState(); const sh = window.__globe.bestSpotSheet(); return { preview: st.previewKey, sel: st.selectedKey, fpv: c.tempFpv, sheetDom: !!document.querySelector('.m-sheet[aria-label="BEST SPOT"]'), sheetVisible: sh.visible, exit: !!document.querySelector(".m-act") && [...document.querySelectorAll(".m-act")].some((b) => /EXIT VIEW/.test(b.textContent)), centre: [st.centreLatDeg, st.centreLonDeg], topK: st.topK.length }; })()`);
  ok(st.preview === st.sel, `the preview is the selected row (${st.preview})`);
  ok(st.fpv === true, "FPV is live (the preview is a camera move)");
  ok(st.sheetDom === false, "the sheet closed to show the view");
  ok(st.sheetVisible === false, "the GL sheet renders NOTHING in FPV (owner R2)");
  ok(st.exit, "✕ EXIT VIEW is on screen (phones have no Escape)");
  ok(st.topK > 0, `the shortlist SURVIVED the trip (${st.topK} rows — the centre lock)`);
  await shot("bestspot-m-06-preview-fpv");
}
await tapText(".m-act", "✕ EXIT VIEW", "EXIT VIEW");
await s.waitFor(`(() => { const st = window.__bestSpotStore.getState(); const c = window.__cameraStore.getState(); return st.previewKey === null && c.tempFpv === false; })()`, 30_000, "preview ended");
await sleep(2500);
{
  const st = await J(`(() => { const st = window.__bestSpotStore.getState(); const c = window.__cameraStore.getState(); const sh = window.__globe.bestSpotSheet(); return { preview: st.previewKey, pin: c.tempPin, on: st.heatmapOn, topK: st.topK.length, sheetVisible: sh.visible }; })()`);
  ok(st.preview === null, "EXIT VIEW ended the preview through the shared watcher");
  ok(st.pin && Math.abs(st.pin.latDeg - 48.464) < 0.01, `the borrowed temp pin was RESTORED (${st.pin?.latDeg?.toFixed(4)}, ${st.pin?.lonDeg?.toFixed(4)})`);
  ok(st.on === true && st.topK > 0 && st.sheetVisible === true, `the heatmap is still armed, ${st.topK} rows, the sheet draws again`);
  await shot("bestspot-m-07-after-preview");
}

// ── 7. Disarm: the sheet releases, buildings detach again on the 2D map ──────────────────────
await tap(".m-tab:nth-child(5)", "the SPOT tab (disarm)");
await tap(".m-bsp-switch", "the HEATMAP switch (off)");
await sleep(1500);
{
  const st = await J(`(() => { const st = window.__bestSpotStore.getState(); const sh = window.__globe.bestSpotSheet(); return { on: st.heatmapOn, topK: st.topK.length, sheetVisible: sh.visible, state: document.querySelector(".m-bsp-switch__state")?.textContent }; })()`);
  ok(st.on === false && st.state === "OFF", "the switch disarms");
  ok(st.sheetVisible === false && st.topK === 0, `the sheet released and the mirror cleared (visible ${st.sheetVisible}, rows ${st.topK})`);
}

console.log(notes.join("\n"));
if (fails.length) console.log(fails.join("\n"));
console.log(`\nverify-bestspot-mobile: ${notes.filter((n) => n.startsWith("  PASS")).length} PASS · ${fails.length} FAIL (lean ${LEAN}${DEVICE ? ", DEVICE" : ""})`);
s.close();
await finishVerify(fails.length ? 1 : 0);
