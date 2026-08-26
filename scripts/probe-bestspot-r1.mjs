/**
 * RESEARCH PROBE — R-1, THE RANK CEILING. The fastest decisive answer to two questions:
 *
 *   Q1. If the window reached the owner's own moment, would his cell score at all? (R-1)
 *   Q2. Can that be had by CHANGING THE WINDOW of the CURRENT single-track mode — no per-cell
 *       argmax, no segment loop, no solver-core refactor — or does it genuinely need a new mode?
 *
 * **THE METHOD, AND WHY IT IS FAST.** It does not scrub time and it does not solve a disc. The
 * PLANNER builds a full horizon profile at an FPV anchor — `__globe.plan().binAltDeg`, one apparent
 * skyline elevation per azimuth bin, out to a 3 km trust radius. Read that ONCE at the owner's exact
 * hand-picked cell, and the moon's visibility at every instant becomes pure arithmetic against
 * `astronomy-engine` in node: deterministic, no streaming variance, no 9 s waits per sample.
 *
 * It then reproduces the shipped weighting (`bestSpotTrack.trackWeightShape`: `|dt/daz|` ×
 * `exp(−max(0,alt)/altScaleDeg)` × the horizon-ceiling disc fraction) and the shipped gate
 * (`G(V) = smoothstep(vGateLo, vGateHi, V)`) to report `V`, `G(V)`, `alt*` and hence `L` under four
 * candidate windows — the shipped one, two WIDENED ones, and a SHIFTED one.
 *
 * **THE ARITHMETIC THAT MOTIVATES IT.** `V` is a weighted MEAN over the window. Widening the top
 * adds samples where the moon is visible but whose weight has already decayed by `exp(−alt/2.5°)`,
 * while the blocked low samples keep the whole weight mass. Whether that lifts `V` past
 * `vGateLo = 0.15` is the entire question, and it is answerable to three decimals from one profile.
 *
 * The owner's case: disc `p=48.45125,35.07101,477,135.1,38.0&t=1787762683150`, his cell
 * `48.451827,35.070311` at 2.4 m, moon on the Monument of Glory at 16:44:43Z (alt +5.90°, az 125.4°)
 * against a moonrise contact at 15:57:36Z (alt −0.24°, az 116.7°).
 *
 * RUN: `wix dev` + a CDP Chrome, then
 *   PATH="$HOME/.nvm/versions/node/v24.10.0/bin:$PATH" node scripts/probe-bestspot-r1.mjs
 */

import * as Astronomy from "astronomy-engine";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const CDP_HTTP = `http://127.0.0.1:${PORT}`;
const ORIGIN = process.env.PLUX_URL ?? "http://localhost:4321";

const PICK = { lat: 48.451827, lon: 35.070311, eyeM: 2.4 };
const T_SHOT = 1787762683150; // his frame: 2026-08-26T16:44:43Z
const POSE = `${PICK.lat},${PICK.lon},477,135.1,38.0`;
const URL = `${ORIGIN}/#p=${POSE}&t=${T_SHOT}`;

/** The shipped scoring constants this probe reproduces. Kept as literals, and named, so a drift
 *  between them and `bestSpotScoring.ts` is visible rather than silent. */
const V_GATE_LO = 0.15;
const V_GATE_HI = 0.75;
const ALT_SCALE_DEG = 2.5; // trackWeight.altScaleDeg
const L_CEIL_DEG = 5; // curves.lCeilDeg
const TRACK_TOP_ALT_DEG = 4; // bestSpotTrack.TRACK_TOP_ALT_DEG
const TRACK_BOTTOM_RHO = 3;
const HALF_DISC = 0.5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CDP ───────────────────────────────────────────────────────────────────────────────────────
let sock;
let nextId = 0;
const waiters = new Map();

async function attach() {
  const res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(URL)}`, { method: "PUT" });
  const target = await res.json();
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
  await send("Page.bringToFront");
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

async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}

async function until(expr, ms = 60_000, step = 250) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ev(`(() => { try { return !!(${expr}); } catch { return false; } })()`)) return true;
    await sleep(step);
  }
  return false;
}

// ── the model ─────────────────────────────────────────────────────────────────────────────────

/** `bestSpotTrack.trackWeightShape`, reproduced: the altitude decay times the horizon-ceiling disc
 *  fraction. The ceiling is what stops the below-horizon tail carrying weight it cannot earn. */
function weightShape(altDeg, rhoDeg, dipDeg) {
  const decay = Math.exp(-Math.max(0, altDeg) / ALT_SCALE_DEG);
  // Fraction of the disc standing above the eye's own dip — 0 fully set, 1 fully risen.
  const x = (altDeg - dipDeg) / rhoDeg;
  const above = x <= -1 ? 0 : x >= 1 ? 1 : (x + 1) / 2;
  return decay * above;
}

/** Visible fraction of the disc against a single skyline elevation — the 1-D reduction of
 *  `discVisibleFraction`. Exact at the two ends, linear across the disc, which is all this probe
 *  needs: the question is whether `V` crosses a gate, not its fourth decimal. */
function visibleFraction(altDeg, rhoDeg, skylineDeg) {
  const x = (altDeg - skylineDeg) / rhoDeg;
  return x <= -1 ? 0 : x >= 1 ? 1 : (x + 1) / 2;
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

await attach();
try {
  console.log(`\nattached  ${URL}`);
  if (!(await until(`window.__globe && window.__globe.plan && window.__planStore`, 90_000))) {
    throw new Error("globe/plan seams never came up");
  }
  await ev(`(() => { window.__cameraStore.getState().setBuildings3d(true); return true; })()`);
  await sleep(11_000); // let both building tilesets stream — the profile is only as good as the mass

  // Stand at his EXACT cell and let the planner build its own horizon profile there.
  await ev(`(() => {
    const c = window.__cameraStore.getState();
    c.setTempPin({ latDeg: ${PICK.lat}, lonDeg: ${PICK.lon} });
    c.setTempFpv(true);
    return true;
  })()`);
  const built = await until(
    `(() => { const p = window.__globe.plan(); return p.anchorKind === "fpv" && p.binAltDeg && p.coverage > 0.5; })()`,
    60_000,
  );
  const plan = await ev(`(() => { const p = window.__globe.plan();
    return { anchorKind: p.anchorKind, coverage: p.coverage, binAltDeg: p.binAltDeg }; })()`);
  console.log(`profile: built=${built} anchor=${plan.anchorKind} coverage=${plan.coverage?.toFixed(3)} bins=${plan.binAltDeg?.length}`);
  if (!plan.binAltDeg) throw new Error("no horizon profile at the pick");

  const bins = plan.binAltDeg;
  const binCount = bins.length;
  const skylineAt = (azDeg) => bins[((Math.floor((azDeg / 360) * binCount) % binCount) + binCount) % binCount];

  // ── the moon track, in node, at ONE-MINUTE resolution ────────────────────────────────────────
  const obs = new Astronomy.Observer(PICK.lat, PICK.lon, 120);
  const rise = Astronomy.SearchRiseSet(
    Astronomy.Body.Moon, obs, +1, new Date(T_SHOT - 12 * 3600e3), 2,
  );
  const t0 = rise.date.getTime();
  const dipDeg = -(Math.sqrt((2 * PICK.eyeM * (1 - 0.13)) / 6_371_000) * 180) / Math.PI;

  const samples = [];
  for (let m = -20; m <= 150; m++) {
    const d = new Date(t0 + m * 60_000);
    const eq = Astronomy.Equator(Astronomy.Body.Moon, d, obs, true, true);
    const hz = Astronomy.Horizon(d, obs, eq.ra, eq.dec, "normal");
    const rhoDeg = 0.2476; // moon apparent radius, near enough over 3 h
    const sky = skylineAt(hz.azimuth);
    samples.push({
      minute: m,
      ms: d.getTime(),
      altDeg: hz.altitude,
      azDeg: hz.azimuth,
      rhoDeg,
      skylineDeg: sky,
      f: visibleFraction(hz.altitude, rhoDeg, Math.max(sky, dipDeg)),
      w: weightShape(hz.altitude, rhoDeg, dipDeg),
    });
  }

  /** V, alt*, L and the gate under one [loAlt, hiAlt] window. `|dt/daz|` is uniform here because
   *  the samples are uniform in TIME, which is the honest quadrature for a per-minute march. */
  function evaluateWindow(label, loAlt, hiAlt) {
    const inWin = samples.filter((s) => s.altDeg >= loAlt && s.altDeg <= hiAlt);
    if (inWin.length === 0) return { label, n: 0 };
    let num = 0;
    let den = 0;
    for (const s of inWin) {
      num += s.w * s.f;
      den += s.w;
    }
    const V = den > 0 ? num / den : 0;
    const star = inWin.filter((s) => s.f >= HALF_DISC).sort((a, b) => a.altDeg - b.altDeg)[0] ?? null;
    const altStar = star ? star.altDeg : null;
    const L = altStar === null ? 0 : 1 - smoothstep(dipDeg, L_CEIL_DEG, altStar);
    return {
      label,
      n: inWin.length,
      V: +V.toFixed(4),
      gate: +smoothstep(V_GATE_LO, V_GATE_HI, V).toFixed(4),
      altStarDeg: altStar === null ? null : +altStar.toFixed(2),
      starMinute: star ? star.minute : null,
      L: +L.toFixed(4),
      skylineAtStar: star ? +star.skylineDeg.toFixed(2) : null,
    };
  }

  const rho = 0.2476;
  const shipped = evaluateWindow("SHIPPED  [-3ρ, +4°]", -TRACK_BOTTOM_RHO * rho, TRACK_TOP_ALT_DEG);
  const wide8 = evaluateWindow("WIDENED  [-3ρ, +8°]", -TRACK_BOTTOM_RHO * rho, 8);
  const wide12 = evaluateWindow("WIDENED  [-3ρ, +12°]", -TRACK_BOTTOM_RHO * rho, 12);
  const wide20 = evaluateWindow("WIDENED  [-3ρ, +20°]", -TRACK_BOTTOM_RHO * rho, 20);
  const shift = evaluateWindow("SHIFTED  [+3°, +12°]", 3, 12);
  const shiftHi = evaluateWindow("SHIFTED  [+5°, +15°]", 5, 15);

  const shotSample = samples.reduce((best, s) =>
    Math.abs(s.ms - T_SHOT) < Math.abs(best.ms - T_SHOT) ? s : best,
  );

  console.log(`\nmoonrise ${new Date(t0).toISOString()}   dip ${dipDeg.toFixed(4)}°`);
  console.log(
    `HIS FRAME  t=${new Date(T_SHOT).toISOString()}  +${shotSample.minute} min  ` +
      `moon alt ${shotSample.altDeg.toFixed(2)}° az ${shotSample.azDeg.toFixed(2)}°  ` +
      `skyline there ${shotSample.skylineDeg.toFixed(2)}°  f=${shotSample.f.toFixed(3)}`,
  );
  const firstClear = samples.find((s) => s.f >= HALF_DISC);
  console.log(
    firstClear
      ? `FIRST CLEAR  +${firstClear.minute} min at alt ${firstClear.altDeg.toFixed(2)}° (skyline ${firstClear.skylineDeg.toFixed(2)}°)`
      : `FIRST CLEAR  never within +150 min`,
  );

  console.log(`\n${"window".padEnd(22)} ${"n".padStart(4)} ${"V".padStart(8)} ${"G(V)".padStart(8)} ${"alt*".padStart(8)} ${"L".padStart(7)}`);
  for (const r of [shipped, wide8, wide12, wide20, shift, shiftHi]) {
    console.log(
      `${r.label.padEnd(22)} ${String(r.n).padStart(4)} ${String(r.V ?? "-").padStart(8)} ` +
        `${String(r.gate ?? "-").padStart(8)} ${String(r.altStarDeg ?? "-").padStart(8)} ${String(r.L ?? "-").padStart(7)}`,
    );
  }

  console.log(`\nper-minute timeline (alt · az · skyline · f · w):`);
  for (const s of samples.filter((s) => s.minute % 5 === 0 && s.minute >= -5 && s.minute <= 90)) {
    const bar = s.f >= 0.5 ? "VISIBLE" : s.f > 0 ? "partial" : "blocked";
    console.log(
      `  +${String(s.minute).padStart(3)}m  alt ${s.altDeg.toFixed(2).padStart(6)}°  az ${s.azDeg.toFixed(1).padStart(6)}°  ` +
        `sky ${s.skylineDeg.toFixed(2).padStart(6)}°  f ${s.f.toFixed(2)}  w ${s.w.toFixed(3)}  ${bar}`,
    );
  }

  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("verify-shots", { recursive: true });
  writeFileSync(
    "verify-shots/probe-bestspot-r1.json",
    JSON.stringify({ dipDeg, t0, shotSample, firstClear, windows: [shipped, wide8, wide12, wide20, shift, shiftHi], samples }, null, 2),
  );
  console.log(`\nwrote verify-shots/probe-bestspot-r1.json`);
} finally {
  await finishVerify(PORT);
}
