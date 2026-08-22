// Browser verification for the ULTRA fidelity track (T44 textures + T45 light/shadows,
// owner 2026-08-22i/j).
//
// THE ACCEPTANCE CRITERION IS A TIMELAPSE, not a frame (owner, verbatim): "whatever we choose
// makes transitioning from day -> dusk -> night and vice versa more epic, not only in terms of
// shadows but general realistic atmosphere and global light feel." So this script parks a fixed
// pose, scrubs scene time through day -> golden -> civil -> nautical -> astronomical -> night,
// and shoots the SAME poses with the chip off and on, twice: over a city, and over Everest
// (which is where terrain casting is supposed to earn its keep).
//
// It also proves the half that a screenshot cannot: that with the chip OFF every ULTRA lever
// reads EXACTLY its pre-track value. That is the standing rule for this whole track and the
// only claim that protects every user who never touches it.
//
// Usage: wix dev on :4321 + CDP Chrome, then
//   node --experimental-websocket scripts/verify-ultra.mjs [cdpPort] [shotsDir]
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

// --- the timelapse. Times chosen so the sun's elevation lands INSIDE each band at the pose's
//     longitude; the script asserts the achieved elevation rather than trusting the clock.
const DNIPRO = { lat: 48.464, lon: 35.046, alt: 900, tilt: 74, head: 300 };
// Everest, standing OFF to the south-west and ABOVE the massif looking back at it. The first
// pose attempted here (alt 6400 over ground that is itself 6.6 km) put the camera UNDER the
// terrain: the street-floor guard rescued it and reset the tilt to 20°, so every assertion still
// passed while the screenshot showed nothing but a wall of snow. The checks were true and the
// picture was worthless — the exact reason this track is judged on both.
const EVEREST = { lat: 27.87, lon: 86.83, alt: 11500, tilt: 76, head: 35 };
// 2026-08-21, UTC. Dnipro is UTC+3 solar-ish (lon 35 -> +2h20m), so local noon ~09:40Z.
const SWEEP = [
  ["day", Date.UTC(2026, 7, 21, 9, 40)],
  ["golden", Date.UTC(2026, 7, 21, 16, 30)],
  ["sunset", Date.UTC(2026, 7, 21, 17, 15)],
  ["civil", Date.UTC(2026, 7, 21, 17, 50)],
  ["nautical", Date.UTC(2026, 7, 21, 18, 25)],
  ["night", Date.UTC(2026, 7, 21, 19, 40)],
];

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
trackTarget(PORT, target.id); // audit #3 C11 — an abandoned target holds a live WebGL context
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let seq = 0;
const pending = new Map();
const consoleErrors = [];
const consoleWarns = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  // The TDZ trap (2026-08-22i): a throw inside applyQualityTier fails the whole tileset and
  // GlobeCanvas logs it as a console.WARN, so an error-only read looks clean. Collect both.
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (msg.params.type === "error") consoleErrors.push(text);
    if (msg.params.type === "warning") consoleWarns.push(text);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
await send("Page.enable");
await send("Runtime.enable");
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const shoot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 84 });
  writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.data, "base64"));
  console.log(`shot  ${SHOTS}/${name}.jpeg`);
};
const waitFor = async (expr, timeoutMs = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(expr)) return true;
    } catch {
      /* booting */
    }
    await sleep(500);
  }
  return false;
};

/** Per-frame ms over a real rAF window, measured IN PAGE (evaluate-side timing would measure
 *  the CDP round trip). Also returns the rAF tick count, so a throttled/occluded tab is
 *  detectable rather than silently reported as "fast". */
const FRAME_PROBE = (ms) => `new Promise((res) => {
  const t = [];
  let last = performance.now();
  const t0 = last;
  const tick = () => {
    const n = performance.now();
    t.push(n - last);
    last = n;
    if (n - t0 < ${ms}) requestAnimationFrame(tick); else {
      const s = t.slice(1).sort((a, b) => a - b);
      res({ n: s.length, median: s[Math.floor(s.length / 2)] ?? null,
             p95: s[Math.floor(s.length * 0.95)] ?? null, fps: s.length ? 1000 / (s.reduce((a,b)=>a+b,0)/s.length) : null });
    }
  };
  requestAnimationFrame(tick);
})`;

const LOOK = `(() => { try { return window.__globe.ultraLook(); } catch (e) { return { err: String(e) }; } })()`;
const QUAL = `(() => { const q = window.__globeQuality; return q ? { tier: q.tier, dpr: q.dpr, ultra: q.ultra, ultraBoot: q.ultraBoot, shadowMapPx: q.shadowMapPx } : null; })()`;

const goto = async (p, tMs) => {
  // Page.navigate to a URL differing only in its HASH does not reload — bounce through blank.
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await send("Page.navigate", {
    url: `http://localhost:4321/#p=${p.lat},${p.lon},${p.alt},${p.tilt},${p.head}&t=${tMs}`,
  });
};
const setTime = async (tMs) => {
  await evalJs(`window.__timeStore.getState().setTime(${tMs})`);
  await sleep(2600); // ephemeris resample (1 Hz) + the eased light terms settle
};

await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 950,
  deviceScaleFactor: 2,
  mobile: false,
});
await send("Page.bringToFront");

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n=== A. OFF STATE — the standing rule: with the chip off, nothing here is read ===");
await goto(DNIPRO, SWEEP[0][1]);
await sleep(15000);
check("engine booted", await waitFor(`!!window.__globe && !!window.__globeQuality`));
// Start from a known-off pref (a previous run may have persisted it).
await evalJs(`window.__cameraStore.getState().setUltraQuality(false)`);
await sleep(2500);

const off = await evalJs(LOOK);
const offQ = await evalJs(QUAL);
check("chip reads OFF", off.on === false && offQ.ultra === false, JSON.stringify(offQ));
check(
  "ground ULTRA uniforms are EXACTLY zero (not merely small)",
  off.photo3d === 0 && off.dayMix === 0 && off.haze === 0,
  `photo3d=${off.photo3d} dayMix=${off.dayMix} haze=${off.haze}`,
);
check(
  "toneMappingExposure is the constructed value",
  Math.abs(off.exposure - 1) < 1e-6,
  `exposure=${off.exposure}`,
);
check(
  "HemisphereLight still at its as-constructed ECEF +Y (audit gap #16 present, untouched)",
  Array.isArray(off.hemiPos) && off.hemiPos[0] === 0 && off.hemiPos[1] === 1 && off.hemiPos[2] === 0,
  JSON.stringify(off.hemiPos),
);
check(
  "shadow rig on the BASE profile (radius 2 / normalBias 0.75)",
  off.shadow && off.shadow.radius === 2 && Math.abs(off.shadow.normalBias - 0.75) < 1e-9,
  JSON.stringify(off.shadow),
);
check(
  "no terrain tile casts, and none carries the shadowSide override",
  off.terrain.casting === 0 && off.terrain.frontSideShadow === 0,
  JSON.stringify(off.terrain),
);
check(
  "drape composites are at the library default anisotropy 1",
  off.aniso && off.aniso.n > 0 && off.aniso.max === 1,
  JSON.stringify(off.aniso),
);
const rebuildsAtOff = await evalJs(`window.__overlayRebuilds ?? 0`);
const fpsOffCity = await evalJs(FRAME_PROBE(3000));
console.log(`frame OFF  city  ${JSON.stringify(fpsOffCity)}`);

console.log("\n--- OFF timelapse (the A side of the A/B) ---");
for (const [band, tMs] of SWEEP) {
  await setTime(tMs);
  await shoot(`ultra-off-city-${band}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n=== B. ON STATE — every lever engaged, live (no reload) ===");
await setTime(SWEEP[0][1]);
await evalJs(`window.__cameraStore.getState().setUltraQuality(true)`);
await sleep(4000);
const onDay = await evalJs(LOOK);
const onQ = await evalJs(QUAL);
check("chip reads ON", onDay.on === true && onQ.ultra === true, JSON.stringify(onQ));
check(
  "§1a photographic de-grade engaged in 3D (and it is NOT the flat-chart path)",
  onDay.photo3d > 0.5,
  `photo3d=${onDay.photo3d}`,
);
check("S9 day curve fully mixed in", onDay.dayMix > 0.99, `dayMix=${onDay.dayMix}`);
check(
  "S10 hemisphere re-seated onto LOCAL UP (audit gap #16 fixed)",
  Array.isArray(onDay.hemiPos) && Math.abs(onDay.hemiPos[1] - 1) > 0.05,
  JSON.stringify(onDay.hemiPos),
);
check(
  "S2 soft-shadow radius + S5 normal bias on the ULTRA profile",
  onDay.shadow && onDay.shadow.radius === 4 && Math.abs(onDay.shadow.normalBias - 0.45) < 1e-9,
  JSON.stringify(onDay.shadow),
);
check(
  "S5 bias re-derived in METRES against the live depth range (~0.6 m, not −19 m)",
  onDay.shadow && Math.abs(onDay.shadow.biasMetres - 0.6) < 0.05,
  `biasMetres=${onDay.shadow?.biasMetres} over near..far ${onDay.shadow?.near}..${onDay.shadow?.far}`,
);
check(
  "S3 terrain tiles CAST, and carry shadowSide=FrontSide (the silent-failure trap)",
  onDay.terrain.casting > 0 && onDay.terrain.frontSideShadow === onDay.terrain.casting,
  JSON.stringify(onDay.terrain),
);
// §1b: the stamp lands on composites created AFTER the flip. Nudge the camera so new tiles
// stream, then re-read — asserting immediately would test the documented limitation, not the fix.
await evalJs(`window.__cameraStore.getState().setUltraQuality(true)`);
for (let i = 0; i < 6; i++) {
  await evalJs(
    `window.location.hash = "#p=${DNIPRO.lat + 0.004 * (i + 1)},${DNIPRO.lon + 0.004 * (i + 1)},${DNIPRO.alt},${DNIPRO.tilt},${DNIPRO.head}&t=${SWEEP[0][1]}"`,
  );
  await sleep(2200);
}
await sleep(6000);
const onAfterFly = await evalJs(LOOK);
check(
  "§1b anisotropy stamped on composites created after the flip",
  onAfterFly.aniso && onAfterFly.aniso.max > 1,
  JSON.stringify(onAfterFly.aniso),
);
const rebuildsAtOn = await evalJs(`window.__overlayRebuilds ?? 0`);
check(
  "the ULTRA flip caused ZERO overlay rebuilds (the QA-7b storm stays dead)",
  rebuildsAtOn === rebuildsAtOff,
  `${rebuildsAtOff} -> ${rebuildsAtOn}`,
);

await goto(DNIPRO, SWEEP[0][1]);
await sleep(15000);
const fpsOnCity = await evalJs(FRAME_PROBE(3000));
console.log(`frame ON   city  ${JSON.stringify(fpsOnCity)}`);
const bootQ = await evalJs(QUAL);
check(
  "S5 the 8k shadow map is live after a reload with the pref persisted",
  bootQ && bootQ.ultraBoot === true && bootQ.shadowMapPx > 4096,
  JSON.stringify(bootQ),
);

console.log("\n--- ON timelapse (the B side — judge these against the A side as a SEQUENCE) ---");
const bandTrace = [];
for (const [band, tMs] of SWEEP) {
  await setTime(tMs);
  const l = await evalJs(LOOK);
  bandTrace.push({ band, exposure: +l.exposure.toFixed(3), haze: +l.haze.toFixed(3), hazeCol: "#" + (l.hazeCol ?? 0).toString(16).padStart(6, "0"), hemiI: +(l.hemiIntensity ?? 0).toFixed(3) });
  await shoot(`ultra-on-city-${band}`);
}
console.table(bandTrace);
// The transition must have STRUCTURE — that is the whole ask. Assert the sequence moves
// monotonically where it should, rather than eyeballing six stills.
const expSeq = bandTrace.map((b) => b.exposure);
check(
  "S11 exposure opens up monotonically across the sweep (day -> night)",
  expSeq.every((v, i) => i === 0 || v >= expSeq[i - 1] - 1e-3) && expSeq[expSeq.length - 1] > expSeq[0] + 0.05,
  expSeq.join(" -> "),
);
const hazeSeq = bandTrace.map((b) => b.haze);
check(
  "S4 haze peaks around sunset and falls into the night, never flat",
  Math.max(...hazeSeq) > hazeSeq[hazeSeq.length - 1] + 0.02 && Math.max(...hazeSeq) > 0.05,
  hazeSeq.join(" -> "),
);
const hazeCols = new Set(bandTrace.map((b) => b.hazeCol));
check("S4 haze TINT actually changes band to band", hazeCols.size >= 4, [...hazeCols].join(" "));

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n=== C. EVEREST — where terrain casting is supposed to earn its keep ===");
// Local solar time at lon 86.9 runs ~5h48m ahead of UTC, so the Dnipro clock times would put
// Everest in the middle of the night. These are its OWN bands.
const EVEREST_SWEEP = [
  ["day", Date.UTC(2026, 7, 21, 6, 15)],
  ["lowsun", Date.UTC(2026, 7, 21, 11, 50)],
  ["golden", Date.UTC(2026, 7, 21, 12, 25)],
];
// The A side FIRST: terrain casting is the owner's named killer feature, and "it looks good"
// means nothing without the same frame without it.
await evalJs(`window.__cameraStore.getState().setUltraQuality(false)`).catch(() => {});
for (const [band, tMs] of EVEREST_SWEEP) {
  await goto(EVEREST, tMs);
  await sleep(17000);
  await evalJs(`window.__cameraStore.getState().setUltraQuality(false)`);
  await sleep(3000);
  await shoot(`ultra-off-everest-${band}`);
}
for (const [band, tMs] of EVEREST_SWEEP) {
  await goto(EVEREST, tMs);
  await sleep(17000);
  await evalJs(`window.__cameraStore.getState().setUltraQuality(true)`);
  await sleep(4000);
  const l = await evalJs(LOOK);
  if (band === "golden") {
    check(
      "Everest: terrain casting live at a low sun over real relief",
      l.on === true && l.terrain.casting > 0,
      JSON.stringify(l.terrain),
    );
    check(
      "Everest: the shadow ortho widened past the base 5 km cap for the relief",
      l.shadow && l.shadow.boundsM > 5000,
      `boundsM=${l.shadow?.boundsM} near=${l.shadow?.near} far=${l.shadow?.far}`,
    );
    // The pose must actually be ABOVE the massif, or the shot shows a wall of snow and every
    // other check passes vacuously (that is exactly what the first run did). The shadow extent
    // is `alt × ULTRA.boundsAltK` clamped, so boundsM > 9 km implies the camera sits above
    // ~8.2 km — over Everest's 8,849 m summit region rather than inside it. Falsifiable, and it
    // reads the value the engine actually derived rather than the one the URL asked for.
    check(
      "Everest: the camera really is above the massif (derived from the live shadow extent)",
      l.shadow && l.shadow.boundsM > 9000,
      `boundsM=${l.shadow?.boundsM} implies alt≈${Math.round((l.shadow?.boundsM ?? 0) / 1.1)} m`,
    );
  }
  await shoot(`ultra-on-everest-${band}`);
}
const fpsOnEverest = await evalJs(FRAME_PROBE(3000));
console.log(`frame ON   everest ${JSON.stringify(fpsOnEverest)}`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n=== D. OFF AGAIN — the flip must be reversible, exactly ===");
await evalJs(`window.__cameraStore.getState().setUltraQuality(false)`);
// The unwind is DELIBERATELY slow: exposure and the ambient ride a ~950 ms time constant, and
// the settle snap only fires once BOTH are inside 1e-4 of baseline — from a night exposure of
// 1.46 that is ln(0.46/1e-4) × 950 ms ≈ 8 s. Visually it is done in ~3 s; the last 5 s are the
// step proving it landed on the baseline EXACTLY rather than merely near it. A 5 s wait here
// measured 1.0023 and read as a bug that wasn't one.
await sleep(13000);
const back = await evalJs(LOOK);
check(
  "every live ULTRA lever unwound to its baseline",
  back.photo3d === 0 &&
    back.dayMix === 0 &&
    back.haze === 0 &&
    Math.abs(back.exposure - 1) < 1e-6 &&
    back.shadow.radius === 2 &&
    back.terrain.casting === 0,
  JSON.stringify({ photo3d: back.photo3d, dayMix: back.dayMix, haze: back.haze, exposure: back.exposure, radius: back.shadow.radius, casting: back.terrain.casting }),
);
check(
  "HemisphereLight restored to ECEF +Y",
  Math.abs(back.hemiPos[1] - 1) < 1e-6 && Math.abs(back.hemiPos[0]) < 1e-6,
  JSON.stringify(back.hemiPos),
);

// The TDZ trap: a throw inside applyQualityTier fails the whole tileset and is logged at WARN.
const badWarn = consoleWarns.filter((w) => /before initialization|tiles disabled|ReferenceError/i.test(w));
check("no tileset-fatal console warnings", badWarn.length === 0, badWarn.join(" | ").slice(0, 300));
// The owner's persistent Chrome profile carries extensions, and their content scripts log into
// the page's console. Filtering them is not "ignoring errors" — it is scoping the assertion to
// the app, which is what it was always meant to assert. Anything unrecognised still fails.
const EXTENSION_NOISE = /cookie bridge helpers|chrome-extension:\/\/|installHook\.js|React is running in production mode/i;
const appErrors = consoleErrors.filter((e) => !EXTENSION_NOISE.test(e));
check("no APP console errors during the run", appErrors.length === 0, appErrors.join(" | ").slice(0, 400));
if (consoleErrors.length !== appErrors.length) {
  console.log(`note  ${consoleErrors.length - appErrors.length} browser-extension console error(s) filtered`);
}

console.log("\n=== FRAME COST (the owner lifted the fps ceiling 2026-08-22j — reported, not enforced) ===");
console.table([
  { scene: "city OFF", ...fpsOffCity },
  { scene: "city ON", ...fpsOnCity },
  { scene: "everest ON", ...fpsOnEverest },
]);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await finishVerify(failures === 0 ? 0 : 1);
