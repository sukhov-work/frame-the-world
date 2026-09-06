// Browser verification for the 2026-08-27 ULTRA rendering batch — the owner's three named
// immersion-breaking defects:
//
//   1. SHADOWS CROPPED. One capped shadow ortho covered 8-35 % of a mountain frame; everything
//      past it rendered fully lit with a straight cut. Fixed by a nested cascade ladder
//      (`lib/globe/shadowCascade`). The check is a RATIO — live shadow reach vs the live view
//      distance, both read off the engine — because "it looks better" is not a gate.
//   2. THE DUSK LIGHT MODEL. The key never died, the air-light was a bright paint colour with no
//      level and no direction, and the sky dome had no azimuth. Fixed in `lib/globe/duskLight` +
//      the shared `ftwAerial` + the dome's directional arm. Checked as a MONOTONE SEQUENCE across
//      a sunset, because a single frame cannot show "it darkens".
//   3. THE TILE SEAM GRID. The quantized-mesh skirt was both casting into and receiving from the
//      shadow map, drawing a dark band along every tile boundary. Fixed by clipping the draw
//      range to the surface cap on both paths (`lib/globe/terrainSkirt`).
//
// This is a SEPARATE script from verify-ultra.mjs on purpose: that one is the off-state/lever
// contract for the original track and must keep passing untouched, and mixing a second concern
// into it would make a failure ambiguous about which contract broke.
//
// Usage: wix dev on :4321 + CDP Chrome, then
//   node --experimental-websocket scripts/verify-ultra-dusk.mjs [cdpPort] [shotsDir]
import { writeFileSync, mkdirSync } from "node:fs";
import { Body, Observer, SearchAltitude } from "astronomy-engine";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

// The two POSITIONALS — the CDP port and the shot directory — are the non-option arguments, in
// that order; an option (`--ladder`, `--ultra 1`) never fills either. Before 2026-09-07 they were
// `argv[2]` / `argv[3]` verbatim, so `9333 --ladder --ultra 1` wrote every rung's shot into a
// directory literally named `--ladder` in the repo root (T105 — caught this session).
const POSITIONALS = process.argv.slice(2).filter(
  (a, i, all) => !a.startsWith("--") && !(all[i - 1] === "--ultra"),
);
const PORT = POSITIONALS[0] ?? "9222";
const DEV_ORIGIN = process.env.FTW_DEV_ORIGIN ?? "http://localhost:4321"; // FTW_DEV_ORIGIN: a worktree dev server (2026-09-06j)
const SHOTS = POSITIONALS[1] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });
/**
 * `--ultra 0|1` (default 1) — WHICH RIG the run measures.
 *
 * Added 2026-09-06 for T96. Until the owner's ruling this script could only ever measure the chip:
 * every navigation set `ultraQuality` true, because the whole dusk model was behind it. T96 moved
 * the light/shadow MODEL to the base rig (`ULTRA.baseTakesLook`), so "does the sunset behave" is
 * now a question about BOTH rigs and the interesting one is the default — `--ultra 0` is what a
 * user who never found the chip actually sees. The flag drives both the persisted boot pref (the
 * shadow map size and the cascade ladder are construction-time) and the live store write.
 *
 * Screenshots and the ladder's own shots carry the state in their names, so an off/on pair does
 * not overwrite itself.
 */
const ULTRA_PREF = (() => {
  const i = process.argv.indexOf("--ultra");
  return i < 0 || process.argv[i + 1] !== "0";
})();
const USUF = ULTRA_PREF ? "u1" : "u0";
console.log(`rig under test: ULTRA chip ${ULTRA_PREF ? "ON" : "OFF"} (--ultra ${ULTRA_PREF ? 1 : 0})`);

const http = (p, m = "GET") => fetch(`http://127.0.0.1:${PORT}${p}`, { method: m }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "));
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
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const shoot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 86 });
  // T96: every shot carries the RIG it was taken on (`.u0` / `.u1`), the sweep's convention, so an
  // off/on pair can be laid side by side instead of overwriting each other. The ladder's own names
  // already carried it; this makes the claim true for the whole run.
  writeFileSync(`${SHOTS}/${name}.${USUF}.jpeg`, Buffer.from(r.data, "base64"));
};
const waitFor = async (expr, timeoutMs = 45000) => {
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

const LOOK = `(() => { try { return window.__globe.ultraLook(); } catch (e) { return { err: String(e) }; } })()`;
const SUN_ALT = `(() => { try {
  const b = window.__globe.bodies();
  const p = window.__globe.camera.position.clone().normalize();
  const s = new (window.__globe.camera.position.constructor)(...b.sunDir);
  return +(Math.asin(Math.max(-1, Math.min(1, s.dot(p)))) * 180 / Math.PI).toFixed(2);
} catch (e) { return null; } })()`;

// `#p=<focusLat>,<focusLon>,<camAltM>,<headingDeg>,<tiltDeg>` — heading BEFORE tilt (lib/geo/
// urlPose). Swapping them silently flies somewhere else and every assertion still "passes".
const goto = async (lat, lon, alt, head, tilt, t) => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await send("Page.navigate", {
    url: `${DEV_ORIGIN}/#p=${lat},${lon},${alt},${head},${tilt}&t=${t}`,
  });
  if (!(await waitFor(`!!window.__globe && !!window.__globeQuality`))) return false;
  await evalJs(`window.__cameraStore.getState().setUltraQuality(${ULTRA_PREF})`);
  await sleep(22000); // stream terrain + drape, settle the eased ULTRA terms
  return true;
};

await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");
// The rig is CONSTRUCTION-TIME, so the pref has to be in storage before the boot we measure.
await send("Page.navigate", { url: `${DEV_ORIGIN}/` });
await sleep(6000);
await evalJs(`(() => { const k = "ftw:view-prefs:v1";
  const o = JSON.parse(localStorage.getItem(k) || "{}");
  o.ultraQuality = ${ULTRA_PREF}; localStorage.setItem(k, JSON.stringify(o)); })()`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
const LADDER_ONLY = process.argv.includes("--ladder"); // §4 alone (the sunset ladder), ~3 min
if (!LADDER_ONLY) {
console.log("\n=== 1. SHADOW CASCADES — every part of the visible map is inside a box ===");
const MOUNTAIN = [35.3606, 138.7274, 5000, 300, 84, Date.UTC(2026, 7, 21, 8, 15)];
if (!(await goto(...MOUNTAIN))) {
  check("engine booted at the mountain pose", false);
} else {
  const look = await evalJs(LOOK);
  const cas = look.cascades ?? [];
  check("the ladder was CONSTRUCTED (ULTRA was on at boot)", cas.length >= 1, `${cas.length} cascades`);
  check(
    "at least one cascade is live at a mountain pose",
    cas.some((c) => c.casting && c.active),
    JSON.stringify(cas.map((c) => ({ on: c.casting && c.active, half: c.boundsM }))),
  );
  // THE HEADLINE. Before the ladder this ratio was 0.08-0.35 at the owner's own poses.
  const cover = look.shadowCoverM ?? 0;
  const view = look.shadow?.viewFitM ?? 0;
  check(
    "shadow reach covers the whole view distance",
    view > 0 && cover >= view,
    `cover ${Math.round(cover)} m vs view ${Math.round(view)} m (${Math.round((100 * cover) / Math.max(view, 1))}%)`,
  );
  // A cascade that lit anything would double the key and break every band in the light model.
  check(
    "no cascade contributes LIGHT — they own depth maps only",
    cas.every((c) => c.lightIntensity === 0),
    JSON.stringify(cas.map((c) => c.lightIntensity)),
  );
  // three truncates `directionalShadow[]` to the CASTER COUNT, so a non-casting light in front of
  // a casting one silently drops the caster's shadow. `sun` is first; this is the invariant that
  // keeps it safe.
  check(
    "no cascade casts while the sun light does not (three's shadow-index rule)",
    look.shadow?.casting === true || cas.every((c) => !c.casting),
    `sun casting=${look.shadow?.casting}`,
  );
  check(
    "each live cascade is strictly OUTSIDE the one before it",
    (() => {
      let prev = look.shadow?.boundsM ?? 0;
      for (const c of cas) {
        if (!(c.casting && c.active)) continue;
        if (!(c.boundsM > prev)) return false;
        prev = c.boundsM;
      }
      return true;
    })(),
    `cascade0 ${look.shadow?.boundsM} → ${cas.map((c) => c.boundsM).join(" → ")}`,
  );
  check(
    "the coarse cascade's bias scales with ITS OWN texel size (it must err toward LIT)",
    cas.filter((c) => c.casting && c.active).every((c) => c.normalBias > c.metresPerTexel),
    JSON.stringify(cas.map((c) => ({ nb: c.normalBias, mpt: c.metresPerTexel }))),
  );
  await shoot("ultradusk-01-cascades-mountain");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n=== 2. THE TILE SEAM — the skirt is out of the shadow pipeline both ways ===");
const FARMLAND = [48.62, 35.2, 5000, 210, 55, Date.UTC(2026, 7, 21, 9, 40)];
if (!(await goto(...FARMLAND))) {
  check("engine booted at the farmland pose", false);
} else {
  const t = (await evalJs(LOOK)).terrain ?? {};
  check("terrain is casting at all (the precondition for the seam)", t.casting > 0, JSON.stringify(t));
  // The clip is installed on every caster. `skirtGroups` is how many geometries actually carry the
  // cap/skirt layout the clip depends on — if a library upgrade reorders the groups the two
  // numbers separate and the fix has quietly stopped working while everything still "passes".
  check(
    "every caster carries the skirt clip",
    t.casting > 0 && t.skirtClipped === t.casting,
    `clipped ${t.skirtClipped} of ${t.casting} casters`,
  );
  check(
    "the cap/skirt geometry layout the clip depends on is still what the library produces",
    t.skirtGroups > 0 && t.skirtGroups <= t.meshes,
    `${t.skirtGroups} of ${t.meshes} meshes have a cap group`,
  );
  await shoot("ultradusk-02-seams-farmland");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n=== 3. DUSK — judged as a SEQUENCE, because no frame can show 'it darkens' ===");
const SPOT = [35.5, 138.35, 3500, 285, 86];
const SWEEP = [
  ["high", Date.UTC(2026, 7, 21, 7, 10)],
  ["low", Date.UTC(2026, 7, 21, 8, 35)],
  ["horizon", Date.UTC(2026, 7, 21, 9, 5)],
  ["set", Date.UTC(2026, 7, 21, 9, 25)],
  ["civil", Date.UTC(2026, 7, 21, 9, 50)],
];
const trace = [];
for (const [band, t] of SWEEP) {
  if (!(await goto(...SPOT, t))) continue;
  const look = await evalJs(LOOK);
  const sunAlt = await evalJs(SUN_ALT);
  trace.push({ band, sunAlt, ...(look.dusk ?? {}) });
  await shoot(`ultradusk-03-${band}`);
}
console.table(
  trace.map((r) => ({
    band: r.band,
    sunDeg: r.sunAlt,
    skyLevel: +(r.skyLevel ?? 0).toFixed(3),
    directK: +(r.directK ?? 0).toFixed(3),
    afterglow: +(r.afterglow ?? 0).toFixed(3),
    keyLevel: +(r.keyLevel ?? 0).toFixed(3),
    disc: +(r.sunDiscExtinct ?? 0).toFixed(3),
  })),
);
check("the sweep actually ran through the bands", trace.length === SWEEP.length, `${trace.length}/${SWEEP.length}`);
if (trace.length === SWEEP.length) {
  const mono = (key) => trace.every((r, i) => i === 0 || r[key] <= trace[i - 1][key] + 1e-6);
  // THE defect, in one assertion: the air-light has to go out with the sun. Before this it had no
  // level term at all and the far field ended up brighter than the foreground at sunset.
  check("skyLevel falls monotonically across the sunset", mono("skyLevel"),
    trace.map((r) => (r.skyLevel ?? 0).toFixed(2)).join(" → "));
  check("directK falls monotonically and reaches zero after sunset", mono("directK") &&
    (trace.at(-1).directK ?? 1) === 0,
    trace.map((r) => (r.directK ?? 0).toFixed(2)).join(" → "));
  // "the sun is still too bright when it is lower than around 3-4 degrees"
  const horizon = trace.find((r) => r.band === "horizon");
  check("the sun DISC is well down by ~3° elevation", (horizon?.sunDiscExtinct ?? 1) < 0.5,
    `disc=${(horizon?.sunDiscExtinct ?? 1).toFixed(3)} at sun ${horizon?.sunAlt}°`);
  check("the key light is effectively gone once the sun has set",
    (trace.find((r) => r.band === "set")?.keyLevel ?? 1) < 0.2,
    `keyLevel=${(trace.find((r) => r.band === "set")?.keyLevel ?? 1).toFixed(3)}`);
  // The afterglow must OUTLIVE the sky level or there is no afterglow — it is deliberately the
  // one non-monotone curve in the model.
  const set = trace.find((r) => r.band === "set");
  const high = trace.find((r) => r.band === "high");
  check("a local afterglow survives below the horizon, and is absent in daylight",
    (set?.afterglow ?? 0) > (high?.afterglow ?? 1) && (set?.afterglow ?? 0) > 0.2,
    `high=${(high?.afterglow ?? 0).toFixed(3)} set=${(set?.afterglow ?? 0).toFixed(3)}`);
  check("daylight is untouched — full sky level and full direct sun at a high sun",
    (high?.skyLevel ?? 0) > 0.95 && (high?.directK ?? 0) > 0.95,
    `skyLevel=${(high?.skyLevel ?? 0).toFixed(3)} directK=${(high?.directK ?? 0).toFixed(3)}`);
}

// The DIRECTIONAL claim needs two headings at one instant; a scalar cannot carry it, so this pair
// is shot for the eye and only the numbers behind it are asserted.
console.log("\n--- the directional pair: same instant, toward the sun and away from it ---");
for (const [name, head] of [["toward", 285], ["away", 105]]) {
  if (!(await goto(35.5, 138.35, 3500, head, 86, Date.UTC(2026, 7, 21, 9, 25)))) continue;
  await shoot(`ultradusk-04-set-${name}`);
  console.log(`shot  ${SHOTS}/ultradusk-04-set-${name}.jpeg`);
}

}
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 4. THE SUNSET SHADOW-RELEASE LADDER — an ELEVATION ladder, at the owner's own pose.
//
// Section 3 above is a TIME ladder, and that is exactly why it could not see this defect: its five
// stamps land at +26.8° / +9.5° / +3.4° / −0.5° / −5.4°, so two consecutive samples straddle a
// 3.9° gap that contains the entire shadow release band (report §10). Everything the release did
// happened inside that gap — the field went 1.000 → 0.000 between +1.06° and +0.4584° while the
// ground overlay was at its deepest ever, and the terrain that had been in shadow came back
// × 5.22 brighter. `mono("skyLevel")` and `mono("directK")` passed throughout.
//
// So this leg walks ELEVATION, not the clock: `astronomy-engine`'s `SearchAltitude` solves the
// instant at which the sun's CENTRE descends through each angle. That is the right function
// because it is airless and centre-based — the same convention the engine's own `sunDirW` uses
// (`lib/ephemeris/bodies.ts:101,139`, "no refraction argument = airless"), which is the whole
// reason the shipped gate fired 0.83° early. `SearchAltitude` is topocentric and `sunDot` is
// geocentric, but solar parallax is 8.8″ = 0.0024°, two orders below the ladder's resolution.
console.log("\n=== 4. THE RELEASE BAND — an elevation ladder at the owner's Everest FPV pose ===");
// `#f=<lat>,<lon>,<eyeM>,<headingDeg>,<pitchDeg>,<fovDeg>` (lib/geo/urlPose) — the owner's frame.
const EVEREST = { lat: 27.989179, lon: 86.925144, eye: 27.6, head: 276.7, pitch: -1.9, fov: 42.0 };
const LADDER_DEG = [3, 2, 1.3, 1.06, 0.9, 0.5, 0.2, 0, -0.14, -0.5, -0.9, -1.5];
// The owner's two frames are 2026-09-06T12:18Z and T12:24Z; seed the search before that evening's
// descent and let it find each crossing on the way DOWN (direction −1).
const SEED = new Date(Date.UTC(2026, 8, 6, 6, 0, 0));
const OBS = new Observer(EVEREST.lat, EVEREST.lon, 0);
const stops = LADDER_DEG.map((deg) => {
  const t = SearchAltitude(Body.Sun, OBS, -1, SEED, 1, deg);
  return { deg, ms: t ? t.date.getTime() : null };
});
check(
  "every ladder elevation resolved to a real instant",
  stops.every((s) => s.ms !== null),
  stops.map((s) => `${s.deg}:${s.ms ?? "unsolved"}`).join(" "),
);
// The lower band of the frame, 320×180, Rec.709 — `probe-dusk.mjs`'s window, promoted to a check.
// At this pose it is terrain, most of it in the shadow of the ridge the sun is behind.
// NOT `drawImage(canvas)`: the WebGL canvas has no `preserveDrawingBuffer`, so a 2D copy taken
// outside the render callback reads ZEROS — measured 2026-09-06h, the whole ladder came back
// luma 0 and the monotone check passed on nothing (the fail-open probe trap). The frame is taken
// through CDP `Page.captureScreenshot` (the compositor's copy) and decoded as an image in-page.
const groundLuma = async () => {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  return evalJs(`(async () => {
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = "data:image/png;base64,${shot.data}"; });
    const w = 320, h = 180;
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const g = off.getContext("2d", { willReadFrequently: true });
    g.drawImage(im, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    let s = 0, n = 0;
    for (let y = 105; y < 165; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      n++;
    }
    return +(s / n).toFixed(2);
  })()`);
};

/** FPV twin of `goto` — the arrival is a cinematic flight, so the rig must not be sampled until
 *  it has landed or every scalar below is read off an orbit camera. */
const gotoFpv = async (t) => {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await send("Page.navigate", {
    url:
      `${DEV_ORIGIN}/#f=${EVEREST.lat},${EVEREST.lon},${EVEREST.eye},` +
      `${EVEREST.head},${EVEREST.pitch},${EVEREST.fov}&t=${t}`,
  });
  if (!(await waitFor(`!!window.__globe && !!window.__globeQuality`))) return false;
  await evalJs(`window.__cameraStore.getState().setUltraQuality(${ULTRA_PREF})`);
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (!(await evalJs(`!!window.__globe.flight.active()`).catch(() => true))) break;
  }
  await sleep(22000); // stream terrain, settle the eased ULTRA terms
  return true;
};

const rungs = [];
for (const stop of stops) {
  if (stop.ms === null) continue;
  if (!(await gotoFpv(stop.ms))) continue;
  const look = await evalJs(LOOK);
  rungs.push({
    want: stop.deg,
    // T96: the CHIP and the LOOK, per rung. The 2026-09-06h run lost a leg to a chip that had
    // been demoted mid-ladder by a slow frame and had no way to say so; with the model on the base
    // rig the pair also says WHICH rig each number came from.
    chip: look.on,
    look: look.look,
    sunAlt: await evalJs(SUN_ALT),
    intensity: look.shadow?.intensity,
    casting: look.shadow?.casting,
    groundOpacity: look.shadow?.groundOpacity,
    directShareK: look.shadow?.directShareK,
    gateSin: look.shadow?.gateSin,
    // T100 (2026-09-06n) — the top of the band the field is reading, off the engine.
    bandTop: look.shadow?.fieldBandTopSin,
    // T100 (a) (2026-09-07) — the overlay's own extinction tail, the value `max(directK, tail)`
    // read; 0 with the chip off, above +0.2°, and at or below the gate.
    tailK: look.shadow?.overlayTailK,
    directK: look.dusk?.directK,
    luma: await groundLuma(),
  });
  await shoot(`ultradusk-05-elev-${String(stop.deg).replace(".", "p").replace("-", "m")}`);
}
console.table(rungs);
check("the elevation ladder ran every rung", rungs.length === stops.length, `${rungs.length}/${stops.length}`);
check(
  `the chip held its state for the WHOLE ladder (requested ${ULTRA_PREF ? "ON" : "OFF"})`,
  rungs.every((r) => r.chip === ULTRA_PREF),
  rungs.map((r) => `${r.want}:${r.chip ? 1 : 0}`).join(" "),
);
check(
  "T96 — the LOOK is on for every rung, whichever rig is under test",
  rungs.every((r) => r.look === true),
  rungs.map((r) => `${r.want}:${r.look ? 1 : 0}`).join(" "),
);
if (rungs.length === stops.length) {
  const at = (deg) => rungs.find((r) => r.want === deg);
  // Every rung must have LANDED on the elevation it asked for, or the ladder measured a different
  // sunset than the one it names and every assertion below is about the wrong frames.
  check(
    "each rung is at the elevation it solved for (±0.06°)",
    rungs.every((r) => Math.abs(r.sunAlt - r.want) < 0.06),
    rungs.map((r) => `${r.want}→${r.sunAlt}`).join(" "),
  );
  // (a) THE FIELD SURVIVES THE RAKING HOUR. The shipped rig is at 0.000 by +0.4584° — measured
  // 1.000 at +1.06° and 0.014 at +0.5°, the whole field gone in 0.6° of elevation while a quarter
  // of the direct sun was still on the ground. The fixed rig holds full strength until the shadow
  // it throws stops fitting the box, whose knee is atan(shadowLengthCasterM / boundsM) — 0.54° at
  // this pose's ~10.7 km fit — and then fades on that geometry.
  // T96 (2026-09-06k, measured): the BASE rig's length-guard reach is its own 5 km box, not the
  // cascade ladder's 260 km, so at this 8 km-peak pose the field starts fading from ~+2.5°
  // (measured 1.000 → 0.790 → 0.594 → 0.527 → 0.482 down the five rungs) — a ramp on geometry,
  // where the pre-T96 base rig held 1.000 and then deleted the field at +0.9°. On the base rig the
  // assertion is therefore "present and ramping", never "full": full strength there would mean the
  // guard had stopped reading the box.
  if (ULTRA_PREF) {
    check(
      "the field is still FULL at +0.9°, where the shipped rig had already deleted it",
      [3, 2, 1.3, 1.06, 0.9].every((d) => (at(d)?.intensity ?? 0) >= 0.9),
      [3, 2, 1.3, 1.06, 0.9].map((d) => `${d}:${(at(d)?.intensity ?? 0).toFixed(3)}`).join(" "),
    );
  } else {
    check(
      "BASE rig: the field is FULL at +3° and still ≥ 0.4 at +0.9° (a ramp on the 5 km box's geometry, not the old cliff)",
      (at(3)?.intensity ?? 0) >= 0.9 && (at(0.9)?.intensity ?? 0) >= 0.4,
      [3, 2, 1.3, 1.06, 0.9].map((d) => `${d}:${(at(d)?.intensity ?? 0).toFixed(3)}`).join(" "),
    );
  }
  check(
    "…and still substantially present at +0.5°, where the shipped rig measured 0.014",
    (at(0.5)?.intensity ?? 0) > 0.3,
    `+0.5°: ${(at(0.5)?.intensity ?? 0).toFixed(3)}`,
  );
  // T100 — ruling (b) of 2026-09-06m slid the CHIP's field band to +0.2°; the ladder on it (§17.2)
  // moved the T66 rise, did not remove it, and its four arms showed the shader product
  // (`opacity × (1 − (1 − field)³)` over the nested cascades) zeroes the overlay wherever the
  // field is 0 — so a band ending at −0.33° left the −0.5° rung at the bare composite on every
  // arm. Ruling (a) of 2026-09-06o: the field band is back on the DISC (−0.30° → the gate) on
  // BOTH rigs, and the OVERLAY carries its own tail (`overlayTailK`, `duskLight.overlayReleaseK`)
  // under the chip's cascade reach. Read off the engine (`fieldBandTopSin`, `overlayTailK`),
  // never assumed.
  {
    const topDeg = (Math.asin(at(0)?.bandTop ?? 0) * 180) / Math.PI;
    check(
      `T100 — the ${ULTRA_PREF ? "chip reads the disc band (top −0.30°, engine-published): full at −0.14°, still ≥ 0.6 at −0.5°, zero at −0.9°" : "BASE rig keeps the disc band (top −0.30°): present at −0.14° (its 5 km box ramps on geometry), still ≥ 0.1 at −0.5°, zero at −0.9°"}`,
      Math.abs(topDeg + 0.3) < 0.03 &&
        (at(-0.14)?.intensity ?? 0) >= (ULTRA_PREF ? 0.999 : 0.3) &&
        (at(-0.5)?.intensity ?? 0) >= (ULTRA_PREF ? 0.6 : 0.1) &&
        (at(-0.9)?.intensity ?? 1) <= 1e-6,
      `bandTop ${topDeg.toFixed(3)}°; −0.14:${(at(-0.14)?.intensity ?? 0).toFixed(3)} −0.5:${(at(-0.5)?.intensity ?? 0).toFixed(3)} −0.9:${(at(-0.9)?.intensity ?? 0).toFixed(3)}`,
    );
  }
  if (ULTRA_PREF) {
    // The tail: under the key above +0.2° (clamped at its top; directShareK is F1's own number
    // there, the l/n digits), the key still rules at −0.14°, an overlay is LEFT at −0.5° where
    // directK is 0, gone at −0.9°.
    check(
      "T100 (a) — the overlay's tail: under the key above +0.2°, below the key at −0.14°, > 0 at −0.5° (directK 0), 0 at −0.9°",
      [3, 2, 1.3, 1.06, 0.9, 0.5].every((d) => (at(d)?.tailK ?? 1) < (at(d)?.directK ?? 0)) &&
        (at(-0.14)?.tailK ?? 1) < (at(-0.14)?.directK ?? 0) &&
        (at(-0.5)?.directK ?? 1) === 0 &&
        (at(-0.5)?.tailK ?? 0) > 0.01 &&
        (at(-0.5)?.directShareK ?? 0) > 0.01 &&
        (at(-0.5)?.groundOpacity ?? 0) > 0.01 &&
        (at(-0.9)?.tailK ?? 1) === 0 &&
        (at(-0.9)?.directShareK ?? 1) === 0,
      rungs.map((r) => `${r.want}:${(r.tailK ?? 0).toFixed(3)}/${(r.directShareK ?? 0).toFixed(3)}`).join(" "),
    );
  } else {
    check(
      "T100 (a) — the BASE rig never reads the overlay's tail (0 at every rung) — its ladder is byte-identical",
      rungs.every((r) => (r.tailK ?? 1) === 0),
      rungs.map((r) => `${r.want}:${(r.tailK ?? 0).toFixed(3)}`).join(" "),
    );
  }
  check(
    "the field only ever falls down the ladder — it never comes back",
    rungs.every((r, i) => i === 0 || (r.intensity ?? 0) <= (rungs[i - 1].intensity ?? 0) + 1e-6),
    rungs.map((r) => (r.intensity ?? 0).toFixed(3)).join(" → "),
  );
  // (b) THE GATE ITSELF, now `ULTRA.shadowGateSin` = sin(−0.8333°) — the sun's own upper limb.
  // The rig therefore still casts half a degree BELOW the geometric horizon and stands down at
  // true sunset, by which point the field has been at zero for a quarter-degree: the one remaining
  // boolean flips where it cannot be seen.
  check(
    "the rig still casts at −0.5° and has stood down below true sunset",
    at(-0.5)?.casting === true && at(-0.9)?.casting === false && at(-1.5)?.casting === false,
    `−0.5:${at(-0.5)?.casting} −0.9:${at(-0.9)?.casting} −1.5:${at(-1.5)?.casting}`,
  );
  check(
    "the live gate is the ULTRA one, read off the engine rather than assumed",
    Math.abs((Math.asin(at(0)?.gateSin ?? 0) * 180) / Math.PI + 0.8333) < 0.01,
    `gateSin=${at(0)?.gateSin}`,
  );
  // (c) THE PIXELS — the whole point. The frame the owner photographed got BRIGHTER as the sun
  // went down: in-shadow terrain × 5.22 between +1.3° and −0.14°, × 6.5 across the release band.
  // Two codes of tolerance covers dither and any tile that streamed in between navigations.
  const lumas = rungs.map((r) => r.luma ?? 0);
  check(
    "the ground band never brightens while the field is at full strength",
    rungs
      .filter((r) => r.want >= 0.9)
      .every((r, i, a) => i === 0 || (r.luma ?? 0) <= (a[i - 1].luma ?? 0) + 2),
    rungs.filter((r) => r.want >= 0.9).map((r) => `${r.want}:${r.luma}`).join(" "),
  );
  // T66, THE OWNER'S OWN GATE (ruling 2026-09-06i, verbatim): *"the ladder's luma series monotone
  // non-increasing from +3° to −1.5° within 2 codes"*. The two ratio checks below were the
  // sunset-release's gate and they are kept — they price the CLIFF. This one prices the RISE, and
  // it is stricter in the only direction that matters: no rung anywhere on the ladder may be
  // brighter than the one above it by more than dither. Before T66 this failed on the authored
  // curves alone (exposure kept opening up through 0°, haze peaked at 0°, and the dome's afterglow
  // band climbed × 1.71 after sunset while the sky collapsed) — which is why it could not be
  // written until the curves were flattened. Two codes of 255 is the stated tolerance and it is
  // the dither/tile-stream budget, not slack: the pre-T66 frame rose ~15 codes.
  const worstLumaRise = Math.max(
    0,
    ...lumas.slice(1).map((v, i) => v - lumas[i]),
  );
  check(
    "T66 — the luma series is monotone non-increasing +3° → −1.5° (within 2 codes)",
    worstLumaRise <= 2,
    `worst rung-to-rung RISE ${worstLumaRise.toFixed(2)} codes; series ` +
      rungs.map((r) => `${r.want}:${(r.luma ?? 0).toFixed(1)}`).join(" "),
  );
  // Below that the field is retiring — `keyExtinctCurve` collapses to 0 by −0.5°, and a shadow
  // with no direct light left to remove is not a shadow, so in-shadow and lit ground MUST meet.
  // The law is that they meet as a RAMP. Stated as the two numbers the report used: the worst
  // brightening anywhere down the ladder, and the worst single step.
  const worstRise = lumas.reduce(
    (acc, v) => ({ min: Math.min(acc.min, v), rise: Math.max(acc.rise, v / Math.max(acc.min, 1)) }),
    { min: lumas[0], rise: 1 },
  ).rise;
  const worstStep = Math.max(
    ...lumas.slice(1).map((v, i) => v / Math.max(lumas[i], 1)),
  );
  check(
    "the release is a RAMP, not a cliff — worst brightening anywhere on the ladder",
    worstRise < 1.35,
    `worst rise × ${worstRise.toFixed(2)} (the shipped rig measured × 5.22 across two of these ` +
      `same rungs); series ${rungs.map((r) => `${r.want}:${r.luma}`).join(" ")}`,
  );
  check(
    "…and no single rung-to-rung step is a jump",
    worstStep < 1.25,
    `worst step × ${worstStep.toFixed(2)}`,
  );
  // (d) The light model itself is still monotone through the band the TIME ladder skipped.
  check(
    "directK falls monotonically across every rung of the release band",
    rungs.every((r, i) => i === 0 || (r.directK ?? 0) <= (rungs[i - 1].directK ?? 0) + 1e-6),
    rungs.map((r) => (r.directK ?? 0).toFixed(3)).join(" → "),
  );
  // F1's own number, live: the overlay is bounded by the direct share, so it retires with the sun
  // instead of peaking at 0.88 the instant before the field is deleted.
  check(
    "the ground overlay retires with the direct sun rather than peaking at its deletion",
    (at(3)?.groundOpacity ?? 0) > (at(0.2)?.groundOpacity ?? 1) &&
      (at(0)?.directShareK ?? 1) < 0.4,
    rungs.map((r) => `${r.want}:${(r.groundOpacity ?? 0).toFixed(3)}`).join(" "),
  );
}

// "APP errors" means errors from OUR bundle. The verify Chrome is the owner's persistent
// profile, so its extensions log into the same console — `Content Script - …` is one of them and
// is present on a clean checkout too. Excluded by name, not by silencing the check.
const appErrors = consoleErrors.filter(
  (e) => !/favicon|analytics|Content Script|cookie bridge|chrome-extension/i.test(e),
);
check("no APP console errors during the run", appErrors.length === 0, appErrors.slice(0, 2).join(" | "));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await finishVerify(failures === 0 ? 0 : 1);
