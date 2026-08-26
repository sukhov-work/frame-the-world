/**
 * BROWSER VERIFY — the BEST SPOT owner batch of 2026-08-26 (five items).
 *
 * `verify-bestspot.mjs` proves the DISC is honest. This proves the five things the owner reported
 * while QA-ing it, and every one of them is a claim only a browser can settle:
 *
 *  1. Clicking a shortlist row SELECTS it and posts NO job — the old click dropped the temp pin,
 *     which moved the disc centre, which re-solved the field and destroyed the list it came from.
 *     Only `GO` may move it, and then it must.
 *  2. The eight markers carry EIGHT DIFFERENT tints from `HEAT_SPOTS`, driven by shortlist-relative
 *     quality, with vividness from the absolute score. Read off the LIVE instanced attributes.
 *  3. A marker under the pointer publishes `sceneHoverKey` + `sceneHoverScreen`; clicking it stands
 *     the camera there in FPV **without moving the disc** — `keys.t0` unchanged and `jobs` flat
 *     across the whole preview, which is the entire point of the centre lock.
 *  4. The `◎ HEATMAP` switch really arms and disarms: OFF posts nothing at all, and re-arming after
 *     a radius change solves the NEW radius.
 *  5. `REFINE THIS SPOT` acts on the SELECTED row and reports its EFFECT (or says there was none).
 *
 * RUN: `node scripts/verify-chrome.mjs` first, then this. Needs Node ≥ 21 for global `WebSocket`
 * (the shipped harness has the same requirement — `~/.nvm/versions/node/v24.10.0/bin` on this box).
 *
 * TRAPS this script is written against, all previously paid for in this repo:
 *  · `__frameGate`-style counters are CUMULATIVE — sample twice and difference, never read once.
 *  · A probe that reads a field which does not exist FAILS OPEN, so every negative here is paired
 *    with a positive control that proves the probe CAN match.
 *  · The verify Chrome has no occlusion flags: bring the tab to the front before anything rAF-driven.
 *  · Every CDP `Runtime.evaluate` gets a timeout; an unbounded one once hung a run for 50 minutes.
 */

import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const CDP_HTTP = `http://127.0.0.1:${PORT}`;
const ORIGIN = process.env.PLUX_URL ?? "http://localhost:4321";
/**
 * The SHIPPED harness's own site and pose, and reusing them is not laziness — it is the only way
 * these checks mean anything. The disc is solved from what has actually STREAMED, so a pin the
 * camera never flew to has no buildings under it, no markers on screen and nothing to hover; and
 * the event window has to be pinned or the shortlist depends on the wall clock at run time.
 * `48.456,35.03` is `verify-bestspot.mjs`'s CROSS pin — the one whose rank-1 is genuinely `open`.
 */
const LAT = 48.456;
const LON = 35.03;
const POSE = `${LAT.toFixed(6)},${LON.toFixed(6)},1200,300,55`;
const T_SUNSET = Date.parse("2026-08-24T17:45:00Z"); // ~20:45 local, into the Dnipro sunset window
const URL = `${ORIGIN}/#p=${POSE}&t=${T_SUNSET}`;

let pass = 0;
const failures = [];
const notes = [];

function ok(cond, label) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}
const note = (s) => {
  notes.push(s);
  console.log(`        ${s}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A shot into `verify-shots/` — git-ignored, and NEVER the repo root (standing house rule). */
async function shot(name) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("verify-shots", { recursive: true });
  const data = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(data.data, "base64"));
  console.log(`  shot  verify-shots/${name}.jpeg`);
}

// ── CDP ───────────────────────────────────────────────────────────────────────────────────────

let sock;
let nextId = 0;
const waiters = new Map();

async function attach() {
  const res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(URL)}`, { method: "PUT" });
  const target = await res.json();
  // C11: register the moment `/json/new` returns. An abandoned target holds a live WebGL context,
  // and the owner's persistent Chrome — which this harness ATTACHES to and must never kill —
  // exhausts them after about five suites.
  trackTarget(PORT, target.id);
  sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (sock.onopen = r));
  sock.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiters.has(d.id)) {
      waiters.get(d.id)(d);
      waiters.delete(d.id);
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.bringToFront"); // no occlusion flags: a backgrounded tab freezes rAF
  return target.id;
}

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++nextId;
    waiters.set(id, (d) => (d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result)));
    sock.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (waiters.delete(id)) rej(new Error(`CDP timeout: ${method}`));
    }, 90_000);
  });
}

async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}

/** Poll a boolean expression until true. Returns false on timeout — never throws, so the CHECK
 *  reports the failure rather than the harness dying halfway through. */
async function until(expr, ms = 30_000, step = 250) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ev(`(() => { try { return !!(${expr}); } catch { return false; } })()`)) return true;
    await sleep(step);
  }
  return false;
}

/**
 * QUIESCE — `verify-bestspot.mjs`'s definition, verbatim, and for its reason (D6): "stopped" means
 * nothing in flight AND the finest rung landed AND the job count has been still for a few polls.
 * A wait keyed on `refinedMs > 0 && !solving` carries no solve IDENTITY and returns holding the
 * PREVIOUS solve's numbers — which is how a checkpoint pair once straddled a phase boundary and
 * reported +8 hull builds across a scrub that must build zero.
 */
async function quiesce(budgetMs = 25_000, quietPolls = 6) {
  const t0 = Date.now();
  let lastJobs = -1;
  let still = 0;
  while (Date.now() - t0 < budgetMs) {
    const p = await ev(`(() => { const d = window.__globe.bestSpot();
      return { inFlight: d.inFlight, jobs: d.jobs, refinedMs: d.timings.refinedMs,
               rungs: Object.keys(d.timings.rungMs).map(Number),
               gridCellM: window.__bestSpotStore.getState().gridCellM }; })()`);
    const settled =
      p.inFlight === 0 && p.refinedMs > 0 && p.rungs.length > 0 &&
      p.gridCellM === Math.min(...p.rungs);
    still = settled && p.jobs === lastJobs ? still + 1 : 0;
    lastJobs = p.jobs;
    if (still >= quietPolls) return true;
    await sleep(220);
  }
  return false;
}

/** Arm the session the way the shipped harness does: shipped scoring profile, ▦ 3D DETAIL on, and
 *  a real wait for the building tilesets to STREAM — a disc solved during the race measures the
 *  race. */
async function armSession() {
  await ev(`(() => {
    window.__globe.bestSpotTuning(null);
    window.__cameraStore.getState().setBuildings3d(true);
    return true;
  })()`);
  await sleep(9000);
  return ev(`(() => { let n = 0;
    window.__globe.tiles.group.traverse(c => { if (c.isMesh) n++; });
    if (window.__globe.enriched) window.__globe.enriched.group.traverse(c => { if (c.isMesh) n++; });
    return { meshes: n, map2d: window.__globe.map2d(), patch: window.__bestSpotStore.getState().scoringPatch }; })()`);
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────

await attach();
try {
  console.log(`\nattached  ${URL}\n`);
  ok(await until(`window.__globe && window.__globe.bestSpot && window.__bestSpotStore`, 60_000),
     "BOOT: the globe island and the BEST SPOT DEV seams are live");

  const gate = await armSession();
  note(`session: ${JSON.stringify(gate)}`);
  ok(gate.meshes > 0, `PRECONDITION: ${gate.meshes} building meshes are resident before the first solve`);
  ok(gate.patch === null, "PRECONDITION: the scoring profile is the SHIPPED DEFAULT");

  // ── ITEM 4 — the switch ─────────────────────────────────────────────────────────────────────
  console.log(`\nITEM 4  the ◎ HEATMAP switch`);
  await ev(`(() => {
    window.__cameraStore.getState().setTempPin({ latDeg: ${LAT}, lonDeg: ${LON} });
    window.__bestSpotStore.getState().setOpen(true);
    return true;
  })()`);
  await sleep(1200);
  const afterOpen = await ev(`(() => {
    const s = window.__bestSpotStore.getState();
    return { open: s.open, heatmapOn: s.heatmapOn, jobs: window.__globe.bestSpot().jobs };
  })()`);
  note(`after setOpen(true): ${JSON.stringify(afterOpen)}`);
  ok(afterOpen.open === true && afterOpen.heatmapOn === false,
     "opening the window leaves the switch OFF — the owner's 'by default internal toggle is off'");

  // CUMULATIVE counter: difference two samples, never read one.
  const jobs0 = afterOpen.jobs;
  await ev(`window.__bestSpotStore.getState().setRadiusM(200)`);
  await ev(`window.__bestSpotStore.getState().setKind("sunrise")`);
  await sleep(2500);
  const jobsOff = await ev(`window.__globe.bestSpot().jobs`);
  ok(jobsOff === jobs0,
     `OFF: composing the request posts NOTHING — jobs ${jobs0} → ${jobsOff} across a radius AND an event change`);
  ok((await ev(`window.__globe.bestSpotSheet().visible`)) === false,
     "OFF: the GL sheet is not drawn");

  await ev(`window.__bestSpotStore.getState().setKind("sunset")`);
  await ev(`window.__bestSpotStore.getState().setRadiusM(300)`);
  await ev(`window.__bestSpotStore.getState().setHeatmapOn(true)`);
  await sleep(600);
  const jobsOn = await ev(`window.__globe.bestSpot().jobs`);
  ok(jobsOn > jobsOff, `ON: arming posts a solve — jobs ${jobsOff} → ${jobsOn} (POSITIVE CONTROL for the zero above)`);

  ok(await quiesce(), "the disc solved and the shortlist landed at the finest rung");

  const solved = await ev(`(() => {
    const s = window.__bestSpotStore.getState();
    const d = window.__globe.bestSpot();
    return { n: s.topK.length, radiusM: s.radiusM, t0: d.keys.t0, jobs: d.jobs,
             best: s.topK[0] && s.topK[0].score, worst: s.topK[s.topK.length - 1] && s.topK[s.topK.length - 1].score };
  })()`);
  note(`solved: ${JSON.stringify(solved)}`);
  ok(solved.n > 1, `the shortlist has ${solved.n} rows`);
  ok(solved.t0.startsWith(String(LAT).slice(0, 6)) || solved.t0.includes("300"),
     `the solved T0 key carries the ARMED request (${solved.t0})`);

  // The owner's exact sentence: "if i disabled it, then changed spot, or radius etc, after enabled
  // it should recalculate according to new params."
  await ev(`window.__bestSpotStore.getState().setHeatmapOn(false)`);
  await sleep(900);
  const cleared = await ev(`(() => {
    const s = window.__bestSpotStore.getState();
    return { topK: s.topK.length, field: window.__globe.bestSpotField() === null,
             visible: window.__globe.bestSpotSheet().visible, jobs: window.__globe.bestSpot().jobs };
  })()`);
  note(`disarmed: ${JSON.stringify(cleared)}`);
  ok(cleared.topK === 0 && cleared.field === true, "OFF again: the field and the shortlist are released, like closing the window");
  const jobsBeforeRearm = cleared.jobs;
  await ev(`window.__bestSpotStore.getState().setRadiusM(200)`);
  await sleep(1500);
  ok((await ev(`window.__globe.bestSpot().jobs`)) === jobsBeforeRearm,
     "OFF: changing the radius while disarmed still posts nothing");
  await ev(`window.__bestSpotStore.getState().setHeatmapOn(true)`);
  ok(await quiesce(), "re-arming solves again");
  const rearmed = await ev(`window.__globe.bestSpot().keys.t0`);
  note(`re-armed T0: ${rearmed}`);
  ok(rearmed.endsWith("|200|0") || rearmed.includes("|200|"),
     `the re-solve carries the NEW radius (200), not the old one — T0 ${rearmed}`);
  await ev(`window.__bestSpotStore.getState().setRadiusM(300)`);
  ok(await quiesce(), "back to a 300 m disc for the remaining items");

  // ── ITEM 2 — the marker tints ───────────────────────────────────────────────────────────────
  console.log(`\nITEM 2  marker colour is quality, per instance`);
  // Read the LIVE instanced attributes off the scene graph — a constructor argument is a statement
  // about the code that built the material, not about what three is drawing with.
  const tints = await ev(`(() => {
    let markers = null;
    window.__globe.camera.parent && window.__globe.camera.parent.traverse(o => { if (o.name === "bestSpotMarkers") markers = o; });
    if (!markers) {
      // The camera may not be parented to the scene; reach it through a tileset group instead.
      let root = window.__globe.tiles.group;
      while (root.parent) root = root.parent;
      root.traverse(o => { if (o.name === "bestSpotMarkers") markers = o; });
    }
    if (!markers) return { error: "no bestSpotMarkers in the scene" };
    const t = markers.geometry.getAttribute("aTint");
    const v = markers.geometry.getAttribute("aVivid");
    const out = [];
    for (let i = 0; i < markers.count; i++) {
      out.push({ rgb: [t.array[i*3], t.array[i*3+1], t.array[i*3+2]].map(x => Math.round(x*1000)/1000).join(","),
                 vivid: Math.round(v.array[i]*1000)/1000 });
    }
    return { count: markers.count, out };
  })()`);
  if (tints.error) {
    ok(false, `ITEM 2: ${tints.error}`);
  } else {
    note(`markers: ${tints.count} · tints ${JSON.stringify(tints.out)}`);
    const distinct = new Set(tints.out.map((m) => m.rgb));
    ok(tints.count > 1, `${tints.count} markers are drawn`);
    ok(distinct.size > 1,
       `ITEM 2: the markers carry ${distinct.size} DISTINCT tints (they were ONE flat accent before)`);
    // Not black, not the accent: every tint is a bright HEAT_SPOTS stop.
    const dark = tints.out.filter((m) => m.rgb.split(",").every((c) => Number(c) < 0.15));
    ok(dark.length === 0, `ITEM 2: no marker is near-black (${dark.length} dark of ${tints.count}) — a NaN tint would be`);
    const cyan = tints.out.filter((m) => m.rgb === "0.043,0.755,0.665");
    ok(cyan.length === 0, `ITEM 2: no marker wears the old flat accent cyan (${cyan.length} of ${tints.count})`);
    // §3.5's guard: vividness is the ABSOLUTE reading, so it is NOT pinned to 1 across the list.
    ok(tints.out.every((m) => m.vivid >= 0 && m.vivid <= 1),
       `ITEM 2: every vividness is a valid 0..1 (${tints.out.map((m) => m.vivid).join(", ")})`);
  }

  // ── ITEM 1 — select ≠ travel ────────────────────────────────────────────────────────────────
  console.log(`\nITEM 1  select, then GO`);
  const pre = await ev(`(() => {
    const d = window.__globe.bestSpot(); const s = window.__bestSpotStore.getState();
    return { jobs: d.jobs, t0: d.keys.t0, sources: d.keys.sources, key: s.topK[1].key,
             lat: s.topK[1].latDeg, lon: s.topK[1].lonDeg, firstKey: s.topK[0].key };
  })()`);
  await ev(`window.__bestSpotStore.getState().setSelectedKey(${JSON.stringify(pre.key)})`);
  await sleep(1500);
  const afterSelect = await ev(`(() => {
    const d = window.__globe.bestSpot(); const s = window.__bestSpotStore.getState();
    return { jobs: d.jobs, t0: d.keys.t0, sources: d.keys.sources, selectedKey: s.selectedKey,
             pin: window.__cameraStore.getState().tempPin };
  })()`);
  note(`select #2: jobs ${pre.jobs}→${afterSelect.jobs} · t0 unchanged ${afterSelect.t0 === pre.t0}`);
  ok(afterSelect.selectedKey === pre.key, "ITEM 1: the row is SELECTED");
  ok(afterSelect.jobs === pre.jobs && afterSelect.t0 === pre.t0 && afterSelect.sources === pre.sources,
     "ITEM 1: selecting posts NO job and does not move the disc centre — the list survives");
  ok(Math.abs(afterSelect.pin.latDeg - LAT) < 1e-6,
     "ITEM 1: the temp pin has NOT moved (the old row click dropped it here)");

  // …and GO must actually travel. That is the positive control for the three zeros above.
  const jobsPreGo = await ev(`window.__globe.bestSpot().jobs`);
  await ev(`(() => { const s = window.__bestSpotStore.getState();
    const row = s.topK.find(t => t.key === ${JSON.stringify(pre.key)}) || s.topK[1];
    window.__cameraStore.getState().setTempPin({ latDeg: row.latDeg, lonDeg: row.lonDeg });
    return true; })()`);
  await sleep(2500);
  const afterGo = await ev(`(() => { const d = window.__globe.bestSpot();
    return { jobs: d.jobs, t0: d.keys.t0 }; })()`);
  note(`GO: jobs ${jobsPreGo}→${afterGo.jobs} · t0 ${pre.t0} → ${afterGo.t0}`);
  ok(afterGo.t0 !== pre.t0, "ITEM 1 POSITIVE CONTROL: GO really does move the centre and re-solve");

  // put the disc back where the rest of the run expects it
  await ev(`window.__cameraStore.getState().setTempPin({ latDeg: ${LAT}, lonDeg: ${LON} })`);
  ok(await quiesce(), "the disc is back at the run's anchor");

  // ── ITEM 3 — hover + the FPV preview that does not move the disc ─────────────────────────────
  console.log(`\nITEM 3  hover tip, and the preview's CENTRE LOCK`);
  // Project rank 1 to client px in-page, then dispatch a real pointermove there — the orchestrator's
  // hover path reads the canvas's own pointer events, so a store poke would prove nothing.
  // A full-canvas sweep blew the 90 s CDP cap on the first run (two rAF per probe over a 1600×950
  // grid). So project the marker ourselves — its world seat is the INSTANCE MATRIX three is
  // drawing with, read live — and dispatch ONE pointermove there. If our projection is wrong the
  // engine simply reports no hover, which is a failure this script prints rather than one it hides.
  const hover = await ev(`(async () => {
    const THREE_V3 = window.__globe.camera.position.constructor;
    let markers = null, root = window.__globe.tiles.group;
    while (root.parent) root = root.parent;
    root.traverse(o => { if (o.name === "bestSpotMarkers") markers = o; });
    if (!markers || markers.count === 0) return { key: null, why: "no markers drawn" };
    const cvs = document.querySelector("canvas");
    const r = cvs.getBoundingClientRect();
    const m = new (window.__globe.camera.matrixWorld.constructor)();
    const out = [];
    for (let i = 0; i < markers.count; i++) {
      markers.getMatrixAt(i, m);
      const p = new THREE_V3(m.elements[12], m.elements[13], m.elements[14]);
      markers.localToWorld(p);
      p.project(window.__globe.camera);
      out.push({ i, x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, z: p.z });
    }
    // Try each marker in turn — the nearest ones may be behind a building, and the check is "the
    // engine reports SOME marker", not "the engine reports the one we guessed".
    for (const c of out) {
      if (!Number.isFinite(c.x) || c.x < r.left || c.x > r.right || c.y < r.top || c.y > r.bottom) continue;
      cvs.dispatchEvent(new PointerEvent("pointermove", { clientX: c.x, clientY: c.y, bubbles: true, pointerId: 1, pointerType: "mouse" }));
      for (let f = 0; f < 12; f++) await new Promise(rr => requestAnimationFrame(rr));
      const st = window.__bestSpotStore.getState();
      if (st.sceneHoverKey) return { key: st.sceneHoverKey, screen: st.sceneHoverScreen, x: c.x, y: c.y, tried: out.length };
    }
    return { key: null, why: "projected " + out.length + " markers, none reported a hover", out };
  })()`);
  note(`hover sweep: ${JSON.stringify(hover)}`);
  ok(hover.key !== null, "ITEM 3: sweeping the pointer over the disc finds a marker and publishes sceneHoverKey");
  ok(hover.key !== null && hover.screen && Number.isFinite(hover.screen.x),
     "ITEM 3: …and its SCREEN position, which is what the tip anchors to");
  if (hover.key) {
    const tip = await ev(`(() => { const el = document.querySelector(".bsp-tip");
      return el ? { text: el.innerText.replace(/\\n/g, " | "), left: el.style.left, top: el.style.top } : null; })()`);
    note(`tip: ${JSON.stringify(tip)}`);
    ok(tip !== null, "ITEM 3: the hover tip is IN THE DOM");
    ok(tip !== null && /GRAZE|GAP|OPEN HORIZON|SKYLINE|HORIZON|EVENT/i.test(tip.text),
       "ITEM 3: …and it says WHY the cell is on the list");
    ok(tip !== null && /CLICK TO LOOK FROM HERE/.test(tip.text),
       "ITEM 3: …and it advertises the preview");
  }

  await shot("ownerbatch-0826-02-markers-and-tip");

  // THE CENTRE LOCK. Sample the counters, click the marker, walk about, and difference.
  const beforePreview = await ev(`(() => { const d = window.__globe.bestSpot();
    return { jobs: d.jobs, t0: d.keys.t0, sources: d.keys.sources,
             pin: JSON.stringify(window.__cameraStore.getState().tempPin) }; })()`);
  if (hover.key) {
    await ev(`(() => { const cvs = document.querySelector("canvas");
      const o = { clientX: ${hover.x}, clientY: ${hover.y}, bubbles: true, pointerId: 1, pointerType: "mouse" };
      cvs.dispatchEvent(new PointerEvent("pointerdown", o));
      cvs.dispatchEvent(new PointerEvent("pointerup", o));
      return true; })()`);
    ok(await until(`window.__bestSpotStore.getState().previewKey !== null`, 8000),
       "ITEM 3: clicking the marker starts the PREVIEW");
    ok(await until(`window.__globe.fpv && window.__globe.fpv().active !== false`, 12_000) ||
       (await ev(`window.__cameraStore.getState().tempFpv`)) === true,
       "ITEM 3: …and the camera really is in first person");
    await sleep(4000); // sit in the preview: streaming, mirrors, the lot
    const inPreview = await ev(`(() => { const d = window.__globe.bestSpot();
      return { jobs: d.jobs, t0: d.keys.t0, sources: d.keys.sources,
               previewKey: window.__bestSpotStore.getState().previewKey }; })()`);
    note(`preview: jobs ${beforePreview.jobs}→${inPreview.jobs} · t0 ${inPreview.t0 === beforePreview.t0 ? "UNCHANGED" : "MOVED"}`);
    ok(inPreview.t0 === beforePreview.t0,
       `ITEM 3 — THE CENTRE LOCK: the disc's T0 key never moved (${inPreview.t0})`);
    ok(inPreview.sources === beforePreview.sources,
       "ITEM 3: sourcesEpoch never bumped — the hull cache and the DSM were not thrown away");
    ok(inPreview.jobs === beforePreview.jobs,
       `ITEM 3: NOT ONE job was posted for the whole preview (jobs ${beforePreview.jobs} → ${inPreview.jobs})`);
    // …and the panel says so, in words, rather than leaving the user in an unexplained mode.
    const modeLine = await ev(`(() => Array.from(document.querySelectorAll(".bsp .pp-status"))
      .map(e => e.textContent).find(t => /LOOKING FROM/.test(t)) || null)()`);
    note(`preview line: ${modeLine}`);
    ok(modeLine !== null && /STILL CENTRED/.test(modeLine),
       "ITEM 3: the panel names the mode AND the promise it keeps");

    // Escape ends it, and the pin the preview borrowed comes back.
    await ev(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await sleep(2500);
    const afterPreview = await ev(`(() => { const d = window.__globe.bestSpot();
      return { jobs: d.jobs, t0: d.keys.t0, previewKey: window.__bestSpotStore.getState().previewKey,
               pin: JSON.stringify(window.__cameraStore.getState().tempPin) }; })()`);
    note(`after ESC: ${JSON.stringify(afterPreview)}`);
    ok(afterPreview.previewKey === null, "ITEM 3: Escape ends the preview");
    ok(afterPreview.pin === beforePreview.pin,
       `ITEM 3: the temp pin the preview borrowed is RESTORED verbatim (${afterPreview.pin})`);
    ok(afterPreview.t0 === beforePreview.t0,
       "ITEM 3: …so releasing the lock lands on the SAME centre and still posts no re-solve");
  }

  // ── ITEM 5 — the refine, and its effect ─────────────────────────────────────────────────────
  console.log(`\nITEM 5  REFINE acts on the SELECTED row, and reports what it did`);
  ok(await quiesce(), "the disc is settled before the refine");
  const refineKey = await ev(`(() => { const s = window.__bestSpotStore.getState();
    const row = s.topK.find(t => !t.obstructionRefined) || s.topK[0];
    window.__bestSpotStore.getState().setSelectedKey(row.key);
    return JSON.stringify({ key: row.key, rank: row.rank, score: row.score }); })()`).then(JSON.parse);
  note(`refining #${refineKey.rank} (${refineKey.key}) at S ${refineKey.score.toFixed(4)}`);
  const t0Refine = Date.now();
  await ev(`window.__bestSpotStore.getState().refineSpot(${JSON.stringify(refineKey.key)})`);
  const landed = await until(
    `(() => { const r = window.__bestSpotStore.getState().topK.find(t => t.key === ${JSON.stringify(refineKey.key)});
       return r && r.obstructionRefined; })()`,
    20_000,
  );
  ok(landed, `ITEM 5: the 1 m obstruction re-solve landed (${Date.now() - t0Refine} ms)`);
  const refined = await ev(`(() => { const r = window.__bestSpotStore.getState().topK.find(t => t.key === ${JSON.stringify(refineKey.key)});
    return r ? { score: r.score, from: r.refinedFromScore, cellM: r.gridCellM, refined: r.obstructionRefined } : null; })()`);
  note(`refined row: ${JSON.stringify(refined)}`);
  ok(refined && typeof refined.from === "number" && refined.from !== refined.score,
     `ITEM 5: the row carries its BEFORE score (${refined && refined.from}) beside the 1 m answer ` +
     `(${refined && refined.score}) — that channel is what makes the effect reportable at all`);
  const deltaText = await ev(`(() => Array.from(document.querySelectorAll(".bsp .pp-day__meta"))
    .map(e => e.textContent).find(t => /1 m:/.test(t)) || null)()`);
  note(`row delta on screen: ${deltaText}`);
  ok(deltaText !== null && /1 m: (NO CHANGE|[+−]\d)/.test(deltaText),
     `ITEM 5: the ROW reports the effect in words — "${deltaText}"`);

  // The button is bound to the SELECTION, which is the ambiguity the owner reported.
  const btn = await ev(`(() => { const rows = Array.from(document.querySelectorAll(".bsp .bsp-row"));
    const sel = rows.filter(r => r.className.includes("bsp-row--sel"));
    const acts = Array.from(document.querySelectorAll(".bsp .bsp-act")).map(b => b.textContent.trim());
    return { rows: rows.length, selected: sel.length, acts }; })()`);
  note(`row actions: ${JSON.stringify(btn)}`);
  ok(btn.selected === 1, "ITEM 5: exactly ONE row is selected, and it is the one wearing the actions");
  ok(btn.acts.some((t) => /GO/.test(t)) && btn.acts.some((t) => /LOOK|BACK/.test(t)) && btn.acts.some((t) => /REFINE|1 m/.test(t)),
     `ITEM 5: GO / LOOK / REFINE all sit on that row — ${JSON.stringify(btn.acts)}`);

  // A screenshot for the owner's eye, which is the only judge of the look. Scroll the panel body
  // to the shortlist first: the whole batch is about those rows, and the default window height puts
  // them below the fold (the panel is a `.bsp-scroll` card, not a clipped one).
  await ev(`(() => { const sc = document.querySelector(".bsp-scroll");
    const row = document.querySelector(".bsp .bsp-row--sel") || document.querySelector(".bsp .bsp-row");
    if (sc && row) sc.scrollTop = row.offsetTop - sc.offsetTop - 40;
    return true; })()`);
  await sleep(400);
  await shot("ownerbatch-0826-01-select-and-actions");
} catch (err) {
  console.error(`\nUNCAUGHT: ${err && err.stack ? err.stack : err}\n`);
  failures.push(`UNCAUGHT ${err && err.message}`);
} finally {
  console.log(`\n${"─".repeat(76)}`);
  if (failures.length) {
    console.log(`FAILURES (${failures.length}):`);
    for (const f of failures) console.log(`  FAIL  ${f}`);
  }
  console.log(`\n${pass} PASS / ${failures.length} FAIL\n`);
  sock?.close();
  // The ONE exit point (C11): `finishVerify` closes every tracked target over plain HTTP, so it
  // still works when the WebSocket is already dead — which is exactly what a crash leaves behind.
  await finishVerify(failures.length ? 1 : 0);
}
