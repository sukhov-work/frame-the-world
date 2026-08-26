/**
 * RESEARCH PROBE — the owner's 2026-08-26 BEST SPOT "taste + coverage" report.
 *
 * NOT a verify script (no PASS/FAIL contract, no `verify-` prefix, so `test/verifyHarness.test.ts`
 * does not fence it). It exists to settle with measurement what would otherwise be argument.
 *
 * THE CASE.  The owner's disc `p=48.45125,35.07101,477,135.1,38.0&t=1787762683150` (Dnipro,
 * MOONRISE) showed no shortlist marker in the middle of Yavornytskoho avenue, yet his hand-picked
 * spot there — `f=48.451827,35.070311,2.4,126.8,2.6,38.0` — produced the shot he wanted: the full
 * moon resting on the apex of the monument column.
 *
 * PART 1 — the three-way question, because the three have three different fixes:
 *   (A) EXCLUDED by a hard gate   → `.g` reads UNKNOWN(0) or INACCESSIBLE(85)
 *   (B) SCORED LOW by the metric  → `.r` low, deep in the field's own ranking
 *   (C) SCORED WELL, CROWDED OUT  → `.r` high but rank > topK, or suppressed by the 25 m NMS
 * ...plus the coverage half: what fraction of the disc's genuinely good cells lies within reach of
 * one of the eight markers (if that is already ~1.0, spreading the markers is the wrong fix).
 *
 * PART 2 — ABLATION. Each hypothesis about WHY is expressed as a live scoring patch through
 * `__globe.bestSpotTuning`, and we re-measure. A hypothesis that does not move the owner's cell is
 * refuted; one that lifts it into the shortlist is the would-it-fire evidence a recommendation
 * needs. Every patch is applied against a RESET profile, never stacked accidentally.
 *
 * RUN: `node scripts/verify-chrome.mjs` (or attach to the owner's :9222) + `wix dev`, then
 *   PATH="$HOME/.nvm/versions/node/v24.10.0/bin:$PATH" node scripts/probe-bestspot-taste.mjs
 * Node >= 21 is required for the global `WebSocket` the CDP attach uses.
 */

import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const CDP_HTTP = `http://127.0.0.1:${PORT}`;
const ORIGIN = process.env.PLUX_URL ?? "http://localhost:4321";

/** The owner's report, verbatim from his message. */
const CENTRE = { lat: 48.45125, lon: 35.07101 };
const PICK = { lat: 48.451827, lon: 35.070311, eyeM: 2.4, headingDeg: 126.8, pitchDeg: 2.6 };
const T_MS = 1787762683150;
const POSE = `${CENTRE.lat},${CENTRE.lon},477,135.1,38.0`;
const URL = `${ORIGIN}/#p=${POSE}&t=${T_MS}`;

/**
 * The ablations, in the order they are run. Each is a full scoring PATCH applied to a freshly
 * reset profile. The names are the hypotheses they test.
 */
const ABLATIONS = [
  ["base", null],
  // H1 — the landcover handicap. `accessSoftExponent: 0` makes `A_soft^0 === 1` for every class, so
  //      the whole landcover ladder stops multiplying. If the pick is on a `majorRoad` carriageway
  //      (soft 0.15 → a 0.387x handicap) this is where it shows.
  ["H1 soft-off", { curves: { accessSoftExponent: 0 } }],
  // H1b — the same question asked by class, so the answer names WHICH class the pick is in.
  ["H1b roads-free", { access: { soft: { majorRoad: 1, road: 1 } } }],
  // H2 — LOWNESS. `L = 1 - smoothstep(dipFloor, lCeilDeg, alt*)` is 0 at/above 5 deg. The owner's
  //      moon sits at 5.9 deg. Raising the ceiling to 30 deg lets a high alignment score at all.
  ["H2 lCeil 30", { curves: { lCeilDeg: 30 } }],
  // H3 — the TRACK WEIGHT. `w_i` carries `exp(-max(0,alpha)/altScaleDeg)`, so at 5.9 deg a sample is
  //      worth exp(-2.36) = 0.094 of a horizon sample. Flattening it stops discarding the sky.
  ["H3 altScale 30", { trackWeight: { altScaleDeg: 30 } }],
  // H4 — DEPTH. `P = ln(D/30)/ln(T/30)` with T = 3000 m scores a 150 m monument at 0.35 and a 3 km
  //      ridge at 1.0 — near foreground is penalised as such. T = 200 m inverts that preference.
  ["H4 trust 200", { curves: { depthTrustRadiusM: 200 } }],
  // H5 — all three taste hypotheses at once: does the hot region MOVE to the avenue?
  ["H5 combo", { curves: { lCeilDeg: 30, depthTrustRadiusM: 200 }, trackWeight: { altScaleDeg: 30 } }],
  // H6 — combo plus the two global multipliers removed, purely to get headroom above the 0.15
  //      display floor so the field's structure is readable rather than clipped.
  ["H6 combo+headroom", { curves: { lCeilDeg: 30, depthTrustRadiusM: 200, accessSoftExponent: 0 },
                          trackWeight: { altScaleDeg: 30 }, worth: { effectiveFloor: 1 } }],
  // H7 — the VISIBILITY GATE. `G(V) = smoothstep(0.15, 0.75, V)` is a MULTIPLIER, so V <= 0.15
  //      makes S exactly 0 — not low, zero — and `shortlist` then drops the cell at
  //      `!(scores[i] > 0)`. Collapsing the gate to a no-op is the one test that separates
  //      "scored badly" from "vetoed". If the pick lifts here and nowhere else, the moon is simply
  //      not visible from it during the swept window.
  ["H7 vGate off", { gates: { vGateLo: 0, vGateHi: 0.05 } }],
  ["H8 vGate off+headroom", { gates: { vGateLo: 0, vGateHi: 0.05 },
                              curves: { accessSoftExponent: 0 }, worth: { effectiveFloor: 1 } }],
  // H9 — READ V DIRECTLY. With the gate off, both global multipliers off and all preference weight
  //      on `v`, `S === V`, so the pick's display byte de-quantises to its own visible-disc
  //      fraction. This is a measurement of V, not an inference about it.
  ["H9 S===V", { gates: { vGateLo: 0, vGateHi: 0.05 }, curves: { accessSoftExponent: 0 },
                 worth: { effectiveFloor: 1 }, weights: { v: 1, l: 0, p: 0, f: 0 } }],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CDP ───────────────────────────────────────────────────────────────────────────────────────

let sock;
let nextId = 0;
const waiters = new Map();

async function attach() {
  const res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(URL)}`, { method: "PUT" });
  const target = await res.json();
  trackTarget(PORT, target.id); // C11 — register the moment `/json/new` returns
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
  await send("Page.bringToFront"); // no occlusion flags on this Chrome
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
  return r.result.value;
}

async function until(expr, ms = 30_000, step = 250) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ev(`(() => { try { return !!(${expr}); } catch { return false; } })()`)) return true;
    await sleep(step);
  }
  return false;
}

/** `verify-bestspot.mjs`'s QUIESCE: nothing in flight, the FINEST rung landed, and the job count
 *  still for several polls. A wait on `refinedMs > 0` alone carries no solve IDENTITY. */
async function quiesce(budgetMs = 40_000, quietPolls = 6) {
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

async function armSession() {
  await ev(`(() => {
    window.__globe.bestSpotTuning(null);
    window.__cameraStore.getState().setBuildings3d(true);
    return true;
  })()`);
  await sleep(11000); // let both building tilesets stream — a disc solved during the race measures the race
  return ev(`(() => { let n = 0;
    window.__globe.tiles.group.traverse(c => { if (c.isMesh) n++; });
    if (window.__globe.enriched) window.__globe.enriched.group.traverse(c => { if (c.isMesh) n++; });
    return { meshes: n, patch: window.__bestSpotStore.getState().scoringPatch }; })()`);
}

async function shot(name) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("verify-shots", { recursive: true });
  const data = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(data.data, "base64"));
  console.log(`  shot  verify-shots/${name}.jpeg`);
}

/** The one in-page measurement, reused for every ablation so the numbers are commensurable. */
const MEASURE = `(() => {
  const pack = window.__globe.bestSpotField();
  const st   = window.__bestSpotStore.getState();
  const dbg  = window.__globe.bestSpot();
  if (!pack) return { error: "no field pack" };

  const { n, cellM, centreLatDeg, centreLonDeg, radiusM, sheetAltM, rg8,
          displayLo, displayHi, coverage, unmappedFrac, minReachM } = pack;
  const half = (n - 1) / 2;

  const M_PER_DEG_LAT = 111199;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(centreLatDeg * Math.PI / 180);
  const toEN = (lat, lon) => ({ e: (lon - centreLonDeg) * mPerDegLon,
                                n: (lat - centreLatDeg) * M_PER_DEG_LAT });
  const cellOf = (lat, lon) => {
    const { e, n: nn } = toEN(lat, lon);
    const col = Math.round(e / cellM) + half, row = Math.round(nn / cellM) + half;
    if (col < 0 || col >= n || row < 0 || row >= n) return null;
    const i = row * n + col;
    return { i, col, row, e, n: nn, r: rg8[i * 2], g: rg8[i * 2 + 1] };
  };
  const deq = (r) => displayLo + (r / 255) * (displayHi - displayLo);
  const G = { 0: "UNKNOWN", 85: "INACCESSIBLE", 170: "SCORED-notReachable", 255: "SCORED-reachable" };

  const pick = cellOf(${PICK.lat}, ${PICK.lon});
  const cells = n * n;
  let scored = 0, unknown = 0, inacc = 0, rMax = 0, rSum = 0, atFloor = 0, argmax = -1;
  const hist = new Array(16).fill(0);
  for (let i = 0; i < cells; i++) {
    const g = rg8[i * 2 + 1], r = rg8[i * 2];
    if (g === 0) { unknown++; continue; }
    if (g === 85) { inacc++; continue; }
    scored++; rSum += r; if (r > rMax) { rMax = r; argmax = i; }
    if (r === 0) atFloor++;
    hist[Math.min(15, r >> 4)]++;
  }
  let better = 0, equal = 0;
  if (pick && pick.g !== 0 && pick.g !== 85) {
    for (let i = 0; i < cells; i++) {
      const g = rg8[i * 2 + 1]; if (g === 0 || g === 85) continue;
      const r = rg8[i * 2];
      if (r > pick.r) better++; else if (r === pick.r) equal++;
    }
  }

  const rows = (st.topK || []).map(s => {
    const c = cellOf(s.latDeg, s.lonDeg), p = toEN(s.latDeg, s.lonDeg);
    return { rank: s.rank, score: +s.score.toFixed(4), contact: s.contact,
             distM: Math.round(s.distM), bearingDeg: Math.round(s.bearingDeg),
             leadMinutes: +(s.leadMs / 60000).toFixed(1), cellR: c ? c.r : null,
             e: +p.e.toFixed(1), nn: +p.n.toFixed(1),
             distToPickM: pick ? Math.round(Math.hypot(p.e - pick.e, p.n - pick.n)) : null };
  });
  let nearestMarkerM = null;
  if (pick && rows.length) nearestMarkerM = Math.min(...rows.map(r => r.distToPickM));

  const cover = {};
  for (const frac of [0.9, 0.8]) {
    const thr = Math.floor(rMax * frac);
    let good = 0, near25 = 0, near60 = 0;
    for (let i = 0; i < cells; i++) {
      const g = rg8[i * 2 + 1]; if (g === 0 || g === 85) continue;
      if (rg8[i * 2] < thr) continue;
      good++;
      const col = i % n, row = (i - col) / n;
      const e = (col - half) * cellM, nn = (row - half) * cellM;
      let d = Infinity;
      for (const r of rows) d = Math.min(d, Math.hypot(e - r.e, nn - r.nn));
      if (d <= 25) near25++;
      if (d <= 60) near60++;
    }
    cover["top" + Math.round(frac * 100)] = { thrByte: thr, goodCells: good,
      within25m: good ? +(near25 / good).toFixed(3) : null,
      within60m: good ? +(near60 / good).toFixed(3) : null };
  }

  const amCol = argmax % n, amRow = (argmax - amCol) / n;
  return {
    field: { n, cellM, radiusM, sheetAltM: +sheetAltM.toFixed(2), displayLo, displayHi,
             coverage: +coverage.toFixed(3), unmappedFrac: +unmappedFrac.toFixed(3),
             minReachM: Math.round(minReachM) },
    counts: { cells, scored, unknown, inaccessible: inacc, atDisplayFloor: atFloor,
              floorFrac: +(atFloor / Math.max(1, scored)).toFixed(3),
              rMax, rMaxS: +deq(rMax).toFixed(4), rMean: +(rSum / Math.max(1, scored)).toFixed(1),
              argmaxE: +((amCol - half) * cellM).toFixed(0), argmaxN: +((amRow - half) * cellM).toFixed(0) },
    hist16: hist,
    pick: pick ? { eM: +pick.e.toFixed(1), nM: +pick.n.toFixed(1),
                   distFromCentreM: Math.round(Math.hypot(pick.e, pick.n)),
                   r: pick.r, S_atLeast: +deq(pick.r).toFixed(4), stand: G[pick.g],
                   cellsStrictlyBetter: better, cellsTied: equal,
                   percentile: scored ? +(1 - better / scored).toFixed(4) : null,
                   nearestMarkerM } : null,
    rows, cover,
    store: { kind: st.kind, radiusM: st.radiusM, gridCellM: st.gridCellM,
             eyeM: st.eyeM, liftM: st.liftM, sheetAltM: st.sheetAltM,
             suggestedLiftM: st.suggestedLiftM ?? null, verdict: st.verdictCounts },
    debug: { jobs: dbg.jobs, hash: dbg.hash, ladderRung: dbg.ladderRung,
             contactMs: dbg.contactMs,
             contactISO: dbg.contactMs ? new Date(dbg.contactMs).toISOString() : null },
  };
})()`;

// ── the run ───────────────────────────────────────────────────────────────────────────────────

await attach();
const results = {};
try {
  console.log(`\nattached  ${URL}`);
  console.log(`owner scrub instant  ${new Date(T_MS).toISOString()}\n`);

  if (!(await until(`window.__globe && window.__globe.bestSpot && window.__bestSpotStore`, 90_000))) {
    throw new Error("the globe island / BEST SPOT dev seams never came up");
  }
  const gate = await armSession();
  console.log(`session: ${JSON.stringify(gate)}`);

  // Open the disc exactly the way the owner did: temp pin at the centre, MOONRISE, panel open,
  // switch ARMED (the order matters — `setOpen` forces `heatmapOn` off in both directions).
  await ev(`(() => {
    window.__cameraStore.getState().setTempPin({ latDeg: ${CENTRE.lat}, lonDeg: ${CENTRE.lon} });
    const s = window.__bestSpotStore.getState();
    s.setKind("moonrise");
    s.setOpen(true);
    s.setHeatmapOn(true);
    window.__bestSpotStore.getState().setKind("moonrise");
    return true;
  })()`);
  await sleep(1500);
  console.log(`quiesced: ${await quiesce()}`);
  await shot("probe-taste-01-disc");

  for (const [label, patch] of ABLATIONS) {
    await ev(`window.__globe.bestSpotTuning(null)`);
    await sleep(400);
    if (patch) {
      const r = await ev(`window.__globe.bestSpotTuning(${JSON.stringify(patch)})`);
      console.log(`\n── ${label} · ${r}`);
    } else {
      console.log(`\n── ${label} · shipped default`);
    }
    await sleep(600);
    const settled = await quiesce();
    const m = await ev(MEASURE);
    results[label] = { patch, settled, ...m };
    const p = m.pick, c = m.counts;
    console.log(
      `   rMax ${c.rMax} (S ${c.rMaxS})  floorFrac ${c.floorFrac}  argmax@(${c.argmaxE},${c.argmaxN})m\n` +
      `   PICK r=${p.r} S>=${p.S_atLeast} ${p.stand}  better=${p.cellsStrictlyBetter} ` +
      `pct=${p.percentile}  nearestMarker=${p.nearestMarkerM}m\n` +
      `   rows: ${m.rows.map((x) => `${x.rank}:${x.score}/${x.contact}@${x.distToPickM}m`).join("  ")}`,
    );
  }
  await ev(`window.__globe.bestSpotTuning(null)`);

  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("verify-shots", { recursive: true });
  writeFileSync("verify-shots/probe-bestspot-taste.json", JSON.stringify(results, null, 2));
  console.log("\nwrote verify-shots/probe-bestspot-taste.json");
} finally {
  await finishVerify(PORT);
}
