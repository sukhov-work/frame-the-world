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
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9222";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

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
  writeFileSync(`${SHOTS}/${name}.jpeg`, Buffer.from(r.data, "base64"));
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
    url: `http://localhost:4321/#p=${lat},${lon},${alt},${head},${tilt}&t=${t}`,
  });
  if (!(await waitFor(`!!window.__globe && !!window.__globeQuality`))) return false;
  await evalJs(`window.__cameraStore.getState().setUltraQuality(true)`);
  await sleep(22000); // stream terrain + drape, settle the eased ULTRA terms
  return true;
};

await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");
// The rig is CONSTRUCTION-TIME, so the pref has to be in storage before the boot we measure.
await send("Page.navigate", { url: "http://localhost:4321/" });
await sleep(6000);
await evalJs(`(() => { const k = "ftw:view-prefs:v1";
  const o = JSON.parse(localStorage.getItem(k) || "{}");
  o.ultraQuality = true; localStorage.setItem(k, JSON.stringify(o)); })()`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
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

// "APP errors" means errors from OUR bundle. The verify Chrome is the owner's persistent
// profile, so its extensions log into the same console — `Content Script - …` is one of them and
// is present on a clean checkout too. Excluded by name, not by silencing the check.
const appErrors = consoleErrors.filter(
  (e) => !/favicon|analytics|Content Script|cookie bridge|chrome-extension/i.test(e),
);
check("no APP console errors during the run", appErrors.length === 0, appErrors.slice(0, 2).join(" | "));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
await finishVerify(failures === 0 ? 0 : 1);
