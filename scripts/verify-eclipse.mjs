// Browser verification for ECLIPSES (owner 2026-08-22k).
//
// THE REPRO IS THE SPEC. The owner flew to the real 2026-08-12 Spanish totality with
//   #f=42.354484,-3.698240,17.0,283.5,7.2,8.3&t=1786559722469
// and reported: "sun and moon got aligned but sun totally dominated moon and nothing was
// visible." The measured cause was worse than the in-code comment claimed — the moon mesh was
// not merely washed out, it was DISCARDED (day arm -> alpha 0, new moon -> lit ~0, both under
// SKY.moonAlphaDiscard). So this script proves two different things:
//
//   1. THE GEOMETRY IS TOPOCENTRIC. Geocentrically the discs miss by 1.006 deg at that instant;
//      topocentrically they overlap by 88%. A pass here that read the geocentric separation
//      would report "no eclipse" during totality, so the script asserts the SEPARATION, not just
//      the coverage — that number is the whole bug.
//   2. THE PIXELS AGREE. Every scalar is read out of the LIVE engine (__globe.eclipse()), never
//      recomputed here — a verify script that re-derives the ephemeris can go green while the
//      screen shows nothing. And the frames are shot, because a green check over a worthless
//      picture is this repo's standing lesson.
//
// Usage: wix dev on :4321 + CDP Chrome, then
//   node --experimental-websocket scripts/verify-eclipse.mjs [cdpPort] [shotsDir]
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

// The owner's pose, verbatim from the reported hash: Burgos, 17 m up, looking WNW at the sun.
const BURGOS = "42.354484,-3.698240,17.0,283.5,7.2,8.3";
// Local circumstances from astronomy-engine's own SearchLocalSolarEclipse at this site.
const T_PARTIAL_IN = 1_786_558_200_000; // 18:10Z — climbing, 58% covered (a true crescent)
const T_TOTAL = 1_786_559_347_887; // 18:29:07.9Z — GREATEST ECLIPSE, obscuration 1
const T_OWNER = 1_786_559_722_469; // 18:35:22.5Z — the owner's own hash, 88% covered
const T_NONE = 1_786_552_000_000; // 16:26Z — an hour before first contact
// The 2026-03-03 TOTAL lunar eclipse from Tokyo, where the moon is comfortably up for the whole
// event. Each phase gets its OWN pose because the disc is 0.5 deg: at a wide FOV it is 16 px and
// the copper gradient and the curved umbral edge — the two things actually being verified — are
// invisible. FOV 6 deg puts the disc at ~79 px. Poses are the almanac's own topocentric az/alt at
// each instant (Horizon(), airless — the house contract), so the moon lands dead centre.
const TOKYO = "35.68,139.69,20.0";
const T_LUNAR_TOTAL = Date.parse("2026-03-03T11:33:00Z");
const T_LUNAR_PARTIAL = Date.parse("2026-03-03T10:35:00Z"); // curved umbral bite across the disc
const POSE_LUNAR_TOTAL = `${TOKYO},110.4,35.1,6.0`;
const POSE_LUNAR_PARTIAL = `${TOKYO},100.2,24.1,6.0`;

const fails = [];
const notes = [];
const ok = (cond, msg) => (cond ? notes.push(`  PASS  ${msg}`) : fails.push(`  FAIL  ${msg}`));
const near = (a, b, tol, msg) =>
  ok(Math.abs(a - b) <= tol, `${msg} — got ${Number(a).toFixed(4)}, want ${b} ±${tol}`);

// --- raw CDP (no deps; the house idiom) -------------------------------------------------------
const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
const target = await res.json();
trackTarget(PORT, target.id);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let msgId = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails)
    throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate threw");
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function goto(hash) {
  // A navigation differing only in the HASH does not reload — bounce through about:blank.
  await send("Page.navigate", { url: "about:blank" });
  await sleep(120);
  await send("Page.navigate", { url: `http://localhost:4321/${hash}` });
  // Wait for the globe island AND a first ephemeris sample, then let the tiles settle.
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    const up = await evaluate(`(() => {
      try { return !!(window.__globe && window.__globe.eclipse); } catch { return false; }
    })()`).catch(() => false);
    if (up) break;
  }
  await sleep(2500); // tile stream + the eclipse ease (ECLIPSE.tauMs 220) settle
}

/** Pin scene time WITHOUT a reload, then let the ease land. `settleMs` matters: the darkness
 *  scalar eases on ECLIPSE.tauMs (220 ms) and only SNAPS to its target inside 1e-3, which takes
 *  ~6.2 tau. 1.2 s left it at 0.9983 and failed the EXACT-1 off-state assertion — the ease was
 *  correct, the wait was not. Anything asserting the STEADY state must wait for the snap. */
async function pinTime(ms, settleMs = 1400) {
  await evaluate(`window.__timeStore.getState().setTime(${ms})`);
  await sleep(settleMs);
}

const probe = () => evaluate(`JSON.stringify(window.__globe.eclipse())`).then(JSON.parse);

async function shot(name) {
  await send("Page.bringToFront");
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.result.data, "base64"));
  notes.push(`  shot  ${SHOTS}/${name}.jpeg`);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 950,
  deviceScaleFactor: 1,
  mobile: false,
});

// =============================================================================================
// 1. THE OWNER'S EXACT HASH — a deep partial, 88% covered.
// =============================================================================================
await goto(`#f=${BURGOS}&t=${T_OWNER}`);
let e = await probe();
notes.push(`\nOWNER HASH  ${JSON.stringify(e, null, 1).slice(0, 700)}`);
ok(e.phase === "partial", `owner instant is a PARTIAL phase (got ${e.phase})`);
near(e.coverage, 0.8802, 0.01, "owner instant coverage");
// The load-bearing number: TOPOCENTRIC separation. Geocentric would be 1.0058 deg = no overlap.
near(e.sepDeg, 0.0621, 0.004, "TOPOCENTRIC separation (geocentric would be 1.0058 = no eclipse)");
near(e.sunRadDeg, 0.263, 0.003, "sun angular radius");
near(e.moonRadDeg, 0.2718, 0.004, "moon angular radius");
// The uniform the sun's fragment actually reads must equal the state.
near(e.sunUEclipse, e.coverage, 1e-6, "sun shader uEclipse tracks the state");
// The moon must be sitting essentially on top of the sun in the plane, ~0.24 sun-radii away.
near(Math.hypot(e.moonOff[0], e.moonOff[1]), e.sepDeg / e.sunRadDeg, 0.02, "moonOff magnitude");
near(e.moonR, e.moonRadDeg / e.sunRadDeg, 0.01, "moonR = moon/sun radius ratio");
// World darkness: 88% covered -> ~20% of daylight left, and every consumer must carry it.
ok(e.daylightK < 0.3 && e.daylightK > 0.1, `daylight cut to ${e.daylightK.toFixed(3)} (want 0.1-0.3)`);
near(e.skyEclipse, e.daylightK, 1e-6, "sky dome carries the daylight scalar");
near(e.groundEclipse, e.daylightK, 0.02, "ground carries it (altitude-gated; street level = full)");
ok(e.moonDaySky < 0.3, `moon disc flipped toward its opaque arm (uDaySky ${e.moonDaySky.toFixed(3)})`);
await shot("eclipse-01-owner-hash-88pct");

// =============================================================================================
// 2. TOTALITY — the corona frame.
// =============================================================================================
await pinTime(T_TOTAL);
e = await probe();
notes.push(`\nTOTALITY  ${JSON.stringify(e, null, 1).slice(0, 700)}`);
ok(e.phase === "total", `greatest eclipse is TOTAL (got ${e.phase})`);
near(e.coverage, 1, 1e-6, "coverage is exactly 1 at totality");
ok(e.magnitude > 1, `magnitude exceeds 1 at totality (got ${e.magnitude.toFixed(3)})`);
near(e.daylightK, 0.04, 0.005, "daylight at the totality floor");
ok(e.keyIntensity < 0.2, `key light collapsed to ${Number(e.keyIntensity).toFixed(3)}`);
await shot("eclipse-02-totality-corona");

// =============================================================================================
// 3. PARTIAL CLIMBING IN — the crescent.
// =============================================================================================
await pinTime(T_PARTIAL_IN);
e = await probe();
ok(e.phase === "partial", `mid-ingress is partial (got ${e.phase})`);
ok(
  e.coverage > 0.45 && e.coverage < 0.7,
  `mid-ingress coverage ${e.coverage.toFixed(3)} in the crescent band`,
);
ok(
  e.daylightK > 0.4,
  `light still largely holding at ${(e.coverage * 100).toFixed(0)}% covered (daylightK ${e.daylightK.toFixed(2)}) — limb darkening`,
);
await shot("eclipse-03-partial-crescent");

// =============================================================================================
// 4. NO ECLIPSE — the off state must be an EXACT no-op. This is the claim that protects every
//    user who never sees an eclipse, and it is the half a screenshot cannot show.
// =============================================================================================
await pinTime(T_NONE, 3000); // the exact-no-op claim is about the SETTLED state — wait for the snap
e = await probe();
notes.push(`\nOFF STATE  ${JSON.stringify(e, null, 1).slice(0, 500)}`);
ok(e.phase === "none", `an hour before first contact: no eclipse (got ${e.phase})`);
ok(e.coverage === 0, `coverage is exactly 0 (got ${e.coverage})`);
ok(e.daylightK === 1, `daylight scalar is EXACTLY 1 (got ${e.daylightK})`);
ok(e.skyEclipse === 1, `sky dome uniform is EXACTLY 1 (got ${e.skyEclipse})`);
ok(e.groundEclipse === 1, `ground uniform is EXACTLY 1 (got ${e.groundEclipse})`);
ok(e.sunUEclipse === 0, `sun shader eclipse uniform is EXACTLY 0 (got ${e.sunUEclipse})`);
ok(e.lunar.umbraOn === 0, `moon umbra branch is OFF (got ${e.lunar.umbraOn})`);
await shot("eclipse-04-off-state-noop");

// =============================================================================================
// 5. LUNAR — the copper moon, and the curved umbral bite.
// =============================================================================================
await goto(`#f=${POSE_LUNAR_TOTAL}&t=${T_LUNAR_TOTAL}`);
e = await probe();
notes.push(`\nLUNAR TOTAL  ${JSON.stringify(e.lunar, null, 1)}`);
ok(e.lunar.phase === "total", `2026-03-03 is a TOTAL lunar eclipse (got ${e.lunar.phase})`);
near(e.lunar.umbralCoverage, 1, 1e-6, "the whole disc is inside the umbra");
ok(e.lunar.umbralMag > 1, `umbral magnitude > 1 (got ${e.lunar.umbralMag.toFixed(3)})`);
ok(e.lunar.umbraOn === 1, "the moon shader's umbra branch is LIVE");
// The umbra is ~2.7 lunar radii — the reason a partial phase shows a curve, not a straight edge.
ok(
  e.lunar.umbraR > 2.3 && e.lunar.umbraR < 3.0,
  `umbra radius ${e.lunar.umbraR.toFixed(2)} moon-radii (want 2.3-3.0)`,
);
ok(e.lunar.penumbraR > e.lunar.umbraR, "penumbra is wider than the umbra");
// During totality the umbra centre is within ~1 moon radius of the disc centre.
ok(
  Math.hypot(e.lunar.umbraOff[0], e.lunar.umbraOff[1]) < e.lunar.umbraR - 1,
  "the disc sits fully inside the umbra circle (offset + 1 < umbraR)",
);
// And the moonlight the CITY receives must collapse with it — the half that is not the disc.
ok(e.lunar.moonKs < 0.1, `moonlight key collapsed to ${e.lunar.moonKs.toFixed(4)} of full`);
await shot("eclipse-05-lunar-total-copper");

// A fresh pose, not a pin: the moon has moved ~12 deg between the two phases, which is two FOVs.
await goto(`#f=${POSE_LUNAR_PARTIAL}&t=${T_LUNAR_PARTIAL}`);
e = await probe();
notes.push(`\nLUNAR PARTIAL  ${JSON.stringify(e.lunar, null, 1)}`);
ok(e.lunar.phase === "partial", `pre-totality is a PARTIAL umbral phase (got ${e.lunar.phase})`);
ok(
  e.lunar.umbralCoverage > 0.05 && e.lunar.umbralCoverage < 0.95,
  `a real BITE: ${(e.lunar.umbralCoverage * 100).toFixed(0)}% of the disc in the umbra`,
);
await shot("eclipse-06-lunar-partial-bite");

// =============================================================================================
const body = [
  "",
  "=".repeat(78),
  `ECLIPSE VERIFY — ${fails.length === 0 ? "ALL PASS" : `${fails.length} FAILURE(S)`}`,
  "=".repeat(78),
  ...notes,
  ...(fails.length ? ["", "FAILURES:", ...fails] : []),
  "",
].join("\n");
console.log(body);
await finishVerify(fails.length ? 1 : 0);
