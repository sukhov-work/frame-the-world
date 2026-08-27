/**
 * RESEARCH PROBE — R-2: DOES THE MINIMAL CHANGE SET ACTUALLY FIND HIS PHOTOGRAPH, AND WHAT DOES IT
 * COST EVERY OTHER CELL?
 *
 * NOT a verify script (no PASS/FAIL contract, no `verify-` prefix, so `test/verifyHarness.test.ts`
 * does not fence it).
 *
 * THE FINDING IT TESTS (`BESTSPOT_TASTE_V1.md` § ADDENDUM 2026-08-26h). The owner's hand-picked
 * cell does not merely score zero — it sits in a narrow `V ≈ 0` CORRIDOR pointing at the Monument
 * of Glory to within 0.23°. **The alignment locus is the shadow locus**: the set of cells from
 * which the body passes behind a landmark is exactly the set the metric zeroes, because `V` is a
 * weighted MEAN dominated by the blocked low samples and `G(V)` MULTIPLIES.
 *
 * THE MINIMAL CHANGE SET, and the two halves this probe measures:
 *   1. `gates.vStarFloor` — the gate may not veto a cell the body demonstrably CLEARS.
 *   2. `trackWeight.topAltDeg` — the window's top must reach the clearing moment. His own frame is
 *      at moon alt +5.90°, and the shipped top is +4°: his moment is not a low-weighted sample, it
 *      is NOT A SAMPLE.
 * Neither is expected to work alone, and the probe is built to show that rather than assume it:
 * without the raise he has no star for the floor to act on, and without the floor the star cannot
 * survive the gate.
 *
 * **THE DECISIVE ARM IS THE STAR MAP.** `{vGateLo: 1, vGateHi: 1.05, vStarFloor: 1}` makes
 * `G = 1` exactly when `TERM_FLAG.hasStar` is set and `0` otherwise, so a cell renders non-zero IFF
 * the body reaches half-visibility somewhere in the window. Run at top 4 and again at top 10 it
 * answers, by measurement rather than by arithmetic, whether raising the window gives his cell a
 * contact at all. Everything else is a cost question.
 *
 * RUN: `wix dev` + a CDP Chrome, then
 *   PATH="$HOME/.nvm/versions/node/v24.10.0/bin:$PATH" node scripts/probe-bestspot-gate.mjs
 * Node >= 21 is required for the global `WebSocket` the CDP attach uses.
 */

import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const CDP_HTTP = `http://127.0.0.1:${PORT}`;
const ORIGIN = process.env.PLUX_URL ?? "http://localhost:4321";

/** The owner's report, verbatim — same disc, same instant, same pick as `probe-bestspot-taste`. */
const CENTRE = { lat: 48.45125, lon: 35.07101 };
const PICK = { lat: 48.451827, lon: 35.070311 };
const T_MS = 1787762683150;
const URL = `${ORIGIN}/#p=${CENTRE.lat},${CENTRE.lon},477,135.1,38.0&t=${T_MS}`;

/** `G = 1` iff `hasStar`, `0` otherwise. `vGateLo: 1` puts every `V < 1` below the ramp, so the
 *  floor is the ONLY thing that can open the gate — which is exactly `TERM_FLAG.hasStar`. */
const STAR_MAP = { vGateLo: 1, vGateHi: 1.05, vStarFloor: 1 };

const ARMS = [
  ["base", null],
  // ── the decisive pair: does the raise give his cell a CONTACT at all? ─────────────────────
  ["star-map top=4 (shipped window)", { gates: STAR_MAP }],
  ["star-map top=10", { gates: STAR_MAP, trackWeight: { topAltDeg: 10 } }],
  ["star-map top=14", { gates: STAR_MAP, trackWeight: { topAltDeg: 14 } }],
  // ── each half ALONE, which is the falsification the recommendation needs ───────────────────
  ["top=10 only (shipped gate)", { trackWeight: { topAltDeg: 10 } }],
  ["floor=0.35 only (shipped window)", { gates: { vStarFloor: 0.35 } }],
  // ── the change set, and its cost to the whole field ────────────────────────────────────────
  ["top=10 + floor=0.35", { gates: { vStarFloor: 0.35 }, trackWeight: { topAltDeg: 10 } }],
  ["top=10 + floor=0.50", { gates: { vStarFloor: 0.5 }, trackWeight: { topAltDeg: 10 } }],
  ["top=14 + floor=0.35", { gates: { vStarFloor: 0.35 }, trackWeight: { topAltDeg: 14 } }],
  // ── measure V itself under the raised window: `S === V`, gate off, multipliers off ────────
  [
    "S===V at top=10",
    {
      gates: { vGateLo: 0, vGateHi: 0.05, vStarFloor: 0 },
      curves: { accessSoftExponent: 0 },
      worth: { effectiveFloor: 1 },
      weights: { v: 1, l: 0, p: 0, f: 0 },
      trackWeight: { topAltDeg: 10 },
    },
  ],
];

/**
 * PASS 2 (`PROBE_ARMS=decompose`) — WHERE HIS CEILING ACTUALLY GOES.
 *
 * Pass 1 measured the thing that matters most and it REFUTES the change set: under the star map
 * (gate forced fully open for any cell with a contact) his cell reads **0.209 against a field best
 * of 0.397**, at the 66th percentile. No value of `vStarFloor` can put him in a shortlist whose
 * entry price is 0.38, because `G ≤ 1` and `G · 0.209 < 0.38` for every `G`. The gate is what makes
 * him EXACTLY ZERO; it is not what keeps him out of the ranking.
 *
 * So the question becomes: what is the 0.209 made of? `S = A_hard · A_soft^e · M · G · preference`,
 * and under the star map `G = 1`, so the number is `A_soft^e · M · preference`. He is standing in
 * the middle of Yavornytskoho avenue — `access.soft.majorRoad = 0.15` — and `M` is shared with
 * every other cell at this instant. These arms separate the ACCESS handicap from the PREFERENCE
 * blend, which is the difference between "F_peak has to carry 0.19" and "it has to carry 0.05".
 */
const ARMS_DECOMPOSE = [
  ["D0 star-map top=10 (the pass-1 control)", { gates: STAR_MAP, trackWeight: { topAltDeg: 10 } }],
  [
    "D1 star-map + roads free",
    {
      gates: STAR_MAP,
      trackWeight: { topAltDeg: 10 },
      access: { soft: { majorRoad: 1, road: 1 } },
    },
  ],
  [
    "D2 star-map + whole soft ladder off",
    { gates: STAR_MAP, trackWeight: { topAltDeg: 10 }, curves: { accessSoftExponent: 0 } },
  ],
  [
    "D3 star-map + ladder off + worth floor 1 (pure preference)",
    {
      gates: STAR_MAP,
      trackWeight: { topAltDeg: 10 },
      curves: { accessSoftExponent: 0 },
      worth: { effectiveFloor: 1 },
    },
  ],
  // S ≡ F, read directly: the whole preference weight on the framing term, everything else out of
  // the way. This is the number F_peak would have to move, measured rather than argued.
  [
    "D4 S===F (ladder off, worth 1, gate open)",
    {
      gates: STAR_MAP,
      trackWeight: { topAltDeg: 10 },
      curves: { accessSoftExponent: 0 },
      worth: { effectiveFloor: 1 },
      weights: { v: 0, l: 0, p: 0, f: 1 },
    },
  ],
  [
    "D5 S===L (same, on lowness)",
    {
      gates: STAR_MAP,
      trackWeight: { topAltDeg: 10 },
      curves: { accessSoftExponent: 0 },
      worth: { effectiveFloor: 1 },
      weights: { v: 0, l: 1, p: 0, f: 0 },
    },
  ],
  [
    "D6 S===P (same, on depth)",
    {
      gates: STAR_MAP,
      trackWeight: { topAltDeg: 10 },
      curves: { accessSoftExponent: 0 },
      worth: { effectiveFloor: 1 },
      weights: { v: 0, l: 0, p: 1, f: 0 },
    },
  ],
];

/**
 * PASS 3 (`PROBE_ARMS=unknown`) — WHICH RUNG IS CHARGING HIM.
 *
 * Pass 2 measured his soft GAIN at `0.2176 / 0.3235 = 0.673`, and `accessSoftGain` is `soft^0.5`
 * at the shipped exponent, so `soft = 0.673² = 0.453`. Exactly one rung sits there:
 * **`access.soft.unknown = 0.45`** — and `roads free` (D1) moving the field best while leaving him
 * untouched already ruled out `majorRoad` and `road`.
 *
 * If that is right, `{unknown: 1}` alone must reproduce D2's pick value EXACTLY (0.3235) while
 * leaving every other class penalised — a much sharper claim than D2's blanket exponent kill, and
 * one a wrong guess cannot pass. E2 then prices it on the SHIPPED profile.
 */
const ARMS_UNKNOWN = [
  ["E0 star-map top=10 (control)", { gates: STAR_MAP, trackWeight: { topAltDeg: 10 } }],
  [
    "E1 star-map + unknown:1",
    { gates: STAR_MAP, trackWeight: { topAltDeg: 10 }, access: { soft: { unknown: 1 } } },
  ],
  ["E2 SHIPPED + unknown:1 (what it costs the real field)", { access: { soft: { unknown: 1 } } }],
];

const ARM_SETS = { decompose: ARMS_DECOMPOSE, unknown: ARMS_UNKNOWN };
const SELECTED = ARM_SETS[process.env.PROBE_ARMS ?? ""] ?? ARMS;
const OUT_NAME = process.env.PROBE_ARMS
  ? `probe-bestspot-gate-${process.env.PROBE_ARMS}`
  : "probe-bestspot-gate";

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

/** `verify-bestspot.mjs`'s QUIESCE. A `resweep` (which `trackWeight.topAltDeg` is) re-runs the whole
 *  azimuth sweep, so the budget is generous — a measurement taken mid-ladder measures the ladder. */
async function quiesce(budgetMs = 90_000, quietPolls = 6) {
  const t0 = Date.now();
  let lastJobs = -1;
  let still = 0;
  while (Date.now() - t0 < budgetMs) {
    const p = await ev(`(() => { const d = window.__globe.bestSpot();
      return { inFlight: d.inFlight, jobs: d.jobs, refinedMs: d.timings.refinedMs,
               rungs: Object.keys(d.timings.rungMs).map(Number),
               gridCellM: window.__bestSpotStore.getState().gridCellM }; })()`);
    const settled =
      p.inFlight === 0 &&
      p.refinedMs > 0 &&
      p.rungs.length > 0 &&
      p.gridCellM === Math.min(...p.rungs);
    still = settled && p.jobs === lastJobs ? still + 1 : 0;
    lastJobs = p.jobs;
    if (still >= quietPolls) return true;
    await sleep(250);
  }
  return false;
}

/** The one in-page measurement, reused for every arm so the numbers are commensurable. Deliberately
 *  the same shape as `probe-bestspot-taste.mjs`'s so the two runs can be read side by side. */
const MEASURE = `(() => {
  const pack = window.__globe.bestSpotField();
  const st   = window.__bestSpotStore.getState();
  const dbg  = window.__globe.bestSpot();
  if (!pack) return { error: "no field pack" };

  const { n, cellM, centreLatDeg, centreLonDeg, rg8, displayLo, displayHi,
          coverage, unmappedFrac } = pack;
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
    return { i, e, n: nn, r: rg8[i * 2], g: rg8[i * 2 + 1] };
  };
  const deq = (r) => displayLo + (r / 255) * (displayHi - displayLo);
  const G = { 0: "UNKNOWN", 85: "INACCESSIBLE", 170: "SCORED-notReachable", 255: "SCORED-reachable" };

  const pick = cellOf(${PICK.lat}, ${PICK.lon});
  const cells = n * n;
  let scored = 0, unknown = 0, inacc = 0, rMax = 0, rSum = 0, atFloor = 0, nonZero = 0;
  const hist = new Array(16).fill(0);
  for (let i = 0; i < cells; i++) {
    const g = rg8[i * 2 + 1], r = rg8[i * 2];
    if (g === 0) { unknown++; continue; }
    if (g === 85) { inacc++; continue; }
    scored++; rSum += r; if (r > rMax) rMax = r;
    if (r === 0) atFloor++; else nonZero++;
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
    const p = toEN(s.latDeg, s.lonDeg);
    return { rank: s.rank, score: +s.score.toFixed(4), contact: s.contact,
             leadMinutes: +(s.leadMs / 60000).toFixed(1),
             distToPickM: pick ? Math.round(Math.hypot(p.e - pick.e, p.n - pick.n)) : null };
  });
  const nearestMarkerM = pick && rows.length
    ? Math.min(...rows.map(r => r.distToPickM)) : null;

  // THE CORRIDOR, re-read every arm: a 21x21 patch (63 m) centred on his pick. The 2026-08-26h
  // finding is that a band of exact zeros runs NW-SE through it; the fix has to CLOSE that band,
  // and a number alone cannot show whether it did.
  let corridor = null;
  if (pick) {
    const rowsOut = [];
    const pc = pick.i % n, pr = (pick.i - pc) / n;
    for (let dr = 10; dr >= -10; dr--) {
      let line = "";
      for (let dc = -10; dc <= 10; dc++) {
        const c = pc + dc, r0 = pr + dr;
        if (c < 0 || c >= n || r0 < 0 || r0 >= n) { line += " "; continue; }
        const i = r0 * n + c, g = rg8[i * 2 + 1], r = rg8[i * 2];
        line += g === 0 ? "?" : g === 85 ? "X" : r === 0 ? "." : String(Math.min(9, r >> 5));
      }
      rowsOut.push(line);
    }
    corridor = rowsOut;
  }

  return {
    field: { n, cellM, coverage: +coverage.toFixed(3), unmappedFrac: +unmappedFrac.toFixed(3) },
    counts: { cells, scored, unknown, inaccessible: inacc, atDisplayFloor: atFloor, nonZero,
              floorFrac: +(atFloor / Math.max(1, scored)).toFixed(3),
              rMax, rMaxS: +deq(rMax).toFixed(4), rMean: +(rSum / Math.max(1, scored)).toFixed(1) },
    hist16: hist,
    pick: pick ? { r: pick.r, S_atLeast: +deq(pick.r).toFixed(4), stand: G[pick.g],
                   distFromCentreM: Math.round(Math.hypot(pick.e, pick.n)),
                   cellsStrictlyBetter: better, cellsTied: equal,
                   percentile: scored ? +(1 - better / scored).toFixed(4) : null,
                   nearestMarkerM } : null,
    rows, corridor,
    debug: { jobs: dbg.jobs, hash: dbg.hash, ladderRung: dbg.ladderRung,
             refinedMs: dbg.timings.refinedMs, firstInkMs: dbg.timings.firstInkMs,
             contactISO: dbg.contactMs ? new Date(dbg.contactMs).toISOString() : null },
  };
})()`;

// ── the run ───────────────────────────────────────────────────────────────────────────────────

await attach();
const results = {};
let exitCode = 0;
try {
  console.log(`\nattached  ${URL}`);
  if (!(await until(`window.__globe && window.__globe.bestSpot && window.__bestSpotStore`, 90_000))) {
    throw new Error("the globe island / BEST SPOT dev seams never came up");
  }
  await ev(`(() => { window.__globe.bestSpotTuning(null);
    window.__cameraStore.getState().setBuildings3d(true); return true; })()`);
  await sleep(11_000); // let both building tilesets stream — a disc solved during the race measures the race

  // The owner's own opening order. `setOpen` forces `heatmapOn` off in BOTH directions, and the
  // store defaults to `kind: "sunset"` — a probe that skips either measures a different event.
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
  console.log(`quiesced: ${await quiesce()}\n`);

  for (const [label, patch] of SELECTED) {
    await ev(`window.__globe.bestSpotTuning(null)`);
    await sleep(400);
    if (patch) await ev(`window.__globe.bestSpotTuning(${JSON.stringify(patch)})`);
    await sleep(700);
    const settled = await quiesce();
    const m = await ev(MEASURE);
    results[label] = { patch, settled, ...m };
    const p = m.pick;
    const c = m.counts;
    console.log(`── ${label}${settled ? "" : "   [NOT SETTLED]"}`);
    console.log(
      `   rMax ${c.rMax} (S ${c.rMaxS})  nonZero ${c.nonZero}/${c.scored}  ` +
        `floorFrac ${c.floorFrac}  unknown ${c.unknown}  refinedMs ${m.debug.refinedMs}`,
    );
    console.log(
      `   PICK r=${p.r} S>=${p.S_atLeast} ${p.stand}  better=${p.cellsStrictlyBetter} ` +
        `pct=${p.percentile}  nearestMarker=${p.nearestMarkerM}m`,
    );
    console.log(`   rows: ${m.rows.map((x) => `${x.rank}:${x.score}@${x.distToPickM}m`).join("  ")}`);
    if (m.corridor) for (const line of m.corridor) console.log(`     ${line}`);
    console.log("");
  }
  await ev(`window.__globe.bestSpotTuning(null)`);

  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("verify-shots", { recursive: true });
  writeFileSync(`verify-shots/${OUT_NAME}.json`, JSON.stringify(results, null, 2));
  console.log(`wrote verify-shots/${OUT_NAME}.json`);
} catch (e) {
  // `finishVerify` calls `process.exit`, so a bare `finally` around it SWALLOWS the throw and the
  // run reports nothing but a cleanup line. Print first, exit second.
  console.error(`\nPROBE FAILED: ${e?.stack ?? e}`);
  exitCode = 1;
} finally {
  await finishVerify(exitCode);
}
