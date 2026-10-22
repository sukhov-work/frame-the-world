// Scripted-Chrome verification of the PHOTO PROJECTION prototype (the photo flow (b), 2026-10-18).
// A FACADE photo fed through the `?facade` overlay (store/facadePhoto) is placed at its EXIF pose and
// projected onto the 3D buildings by scene/photoProjector through the shared building material.
// This proves, by RENDERED PIXELS where it matters (never DOM properties — the [hidden] trap):
//   1 boot + the desktop attach gate · 2 the ?facade entry · 3 the fixture decodes to REVIEW with the
//   right EXIF · 4 place → the frustum at the GPS point + the projector snapshot (texture, depth map,
//   optics) · 5 projection ON vs OFF changes the frame, deterministically (landing pose + a close pose)
//   · 6 ownLight 1 vs 0 differs · 7 a nudge moves the apex + re-renders the depth · 10 frame cost ON
//   vs OFF · 8 no regression to the pin flow + clear() tears down · 9 a clean console.
// (Leg 10 runs before leg 8 because it needs a placed photo; legs keep their brief numbers.)
//
// Fixture: test/fixtures/facade-pattern.jpg (1600×1200, GPS 48.4647 N / 35.0462 E, heading 25 — the `legacy-fpv-eye` street pose,
// 26 mm eq, no altitude; TL red / TR green / BL blue / BR yellow quadrants).
//
// Usage: node scripts/verify-photo-projection-2026-10-18.mjs
//   env FTW_CDP_PORT (default 9333 — the house headless Chrome), FTW_PP_URL (the page URL override).
// Needs `wix dev` on http://localhost:4321 (the window.__* DEV seams). Shots → verify-shots/photo-projection/.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.env.FTW_CDP_PORT ?? 9333);
// The `?facade=1` flag retired on 2026-10-22 (T181). The `#p=…&t=…` hash pins a DAYLIGHT scene time (the
// `dnipro-fpv-south` catalogue instant, scripts/lib/poses.mjs) over the fixture's own GPS point, so
// the pixel legs never run on a black night city; place() cuts the camera to the arrival pose anyway.
const URL =
  process.env.FTW_PP_URL ?? "http://localhost:4321/#p=48.4647,35.0462,1500,25,55.0&t=1788701556919";
const SHOTS = "verify-shots/photo-projection";
const FIXTURE = resolve("test/fixtures/facade-pattern.jpg");
const FIX = { lat: 48.4647, lon: 35.0462, heading: 25, w: 1600, h: 1200, focal35: 26 };
// The FOV law (lib/decode/sensors.ts): hFov from the 35 mm eq against 36 mm; vFov = 2·atan(tan(h/2)/aspect).
const H_FOV = (2 * Math.atan(36 / (2 * FIX.focal35)) * 180) / Math.PI; // 69.39°
const ASPECT = FIX.w / FIX.h;
const V_FOV = (2 * Math.atan(Math.tan((H_FOV * Math.PI) / 360) / ASPECT) * 180) / Math.PI; // 54.87°
const FLIGHT_SETTLE_MS = 3500; // FLIGHT.durationMs 2200 + margin (tuning.ts)

mkdirSync(SHOTS, { recursive: true });

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
// audit #3 C11: register for close — an abandoned target holds a WebGL context.
trackTarget(PORT, target.id);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const consoleErrors = []; // Runtime.consoleAPICalled type error + Runtime.exceptionThrown
const glNoise = []; // any console / log text matching the shader / GL pattern (errors AND warnings)
const GL_RE = /shader|GLSL|compile|WebGL/i;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.consoleAPICalled") {
    const type = msg.params?.type;
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (type === "error" && !/Content Script - Failed to load cookie bridge/.test(text)) consoleErrors.push(text.slice(0, 240));
    if ((type === "error" || type === "warning") && GL_RE.test(text)) glNoise.push(`console.${type}: ${text.slice(0, 240)}`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params?.exceptionDetails;
    // The house profile's extensions throw in THEIR content scripts (2026-10-23, verify.md (b0)) — never the app's.
    const fromExtension = (d?.url ?? "").startsWith("chrome-extension://") || (d?.stackTrace?.callFrames ?? []).some((f) => (f.url ?? "").startsWith("chrome-extension://"));
    if (!fromExtension) consoleErrors.push("EXCEPTION: " + (d?.exception?.description ?? d?.text ?? "").slice(0, 240));
  }
  if (msg.method === "Log.entryAdded") {
    const e = msg.params?.entry;
    if (e && (e.level === "error" || e.level === "warning") && GL_RE.test(e.text ?? ""))
      glNoise.push(`log.${e.level} (${e.source}): ${(e.text ?? "").slice(0, 240)}`);
  }
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(s.data, "base64"));
};
/** n requestAnimationFrame ticks in-page (the render loop has run n frames). */
const ticks = (n) =>
  evalJs(`new Promise((r) => { let k = ${n}; const f = () => (--k <= 0 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
/** Poll an in-page expression until it is truthy; returns { ok, value } (value = the last read). */
const waitFor = async (expr, timeoutMs, everyMs = 250) => {
  const t0 = Date.now();
  let value;
  while (Date.now() - t0 < timeoutMs) {
    value = await evalJs(expr).catch((e) => ({ evalError: String(e.message ?? e) }));
    if (value && !value.evalError) return { ok: true, value };
    await sleep(everyMs);
  }
  return { ok: false, value };
};
const near = (a, b, eps) => typeof a === "number" && Math.abs(a - b) <= eps;
const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const FS = "window.__facadeStore.getState()";
const SNAP = "window.__globe.photoProjector()";
const snapshot = () => evalJs(SNAP);
const geomNow = () =>
  evalJs(`(() => { const g = window.__globe.facadeFrustum.current(); return g ? { apex: [...g.apex], forward: [...g.forward], up: [...g.up], corners: g.corners.map((c) => [...c]) } : null; })()`);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// --- WGS84 (Node-side pure math: the expected ECEF of the placement) -----------------------------
const WGS_A = 6378137;
const WGS_F = 1 / 298.257223563;
const WGS_E2 = WGS_F * (2 - WGS_F);
const ecef = (latDeg, lonDeg, h = 0) => {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  const n = WGS_A / Math.sqrt(1 - WGS_E2 * Math.sin(la) ** 2);
  return [(n + h) * Math.cos(la) * Math.cos(lo), (n + h) * Math.cos(la) * Math.sin(lo), (n * (1 - WGS_E2) + h) * Math.sin(la)];
};
const normalAt = (latDeg, lonDeg) => {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

// --- the pixel machinery (in-page decode of a PNG capture; ImageData kept on window.__ppCap) -------
const capture = async (name, jpegName) => {
  const png = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(png.data, "base64"));
  if (jpegName) await shot(jpegName);
  return evalJs(`(async () => {
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = "data:image/png;base64,${png.data}"; });
    const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
    (window.__ppCap = window.__ppCap || {})[${JSON.stringify(name)}] = x.getImageData(0, 0, c.width, c.height);
    return [c.width, c.height];
  })()`);
};
/** Whole-frame mean |ΔRGB|, pixels changed by > 24 on any channel, and the "pattern-saturated"
 *  (max−min > 110) pixel counts of a and b. */
const diff = (a, b) =>
  evalJs(`(() => {
    const A = window.__ppCap[${JSON.stringify(a)}].data, B = window.__ppCap[${JSON.stringify(b)}].data;
    if (A.length !== B.length) return { sizeMismatch: [A.length, B.length] };
    let sum = 0, changed = 0, satA = 0, satB = 0;
    for (let i = 0; i < A.length; i += 4) {
      const dr = Math.abs(A[i] - B[i]), dg = Math.abs(A[i + 1] - B[i + 1]), db = Math.abs(A[i + 2] - B[i + 2]);
      sum += dr + dg + db;
      if (dr > 24 || dg > 24 || db > 24) changed++;
      if (Math.max(A[i], A[i + 1], A[i + 2]) - Math.min(A[i], A[i + 1], A[i + 2]) > 110) satA++;
      if (Math.max(B[i], B[i + 1], B[i + 2]) - Math.min(B[i], B[i + 1], B[i + 2]) > 110) satB++;
    }
    const n = A.length / 4;
    return { meanAbs: Math.round((sum / (n * 3)) * 1000) / 1000, changed, satA, satB, satDelta: satA - satB };
  })()`);
const dropCaps = () => evalJs("(window.__ppCap = {}, true)");
/** Set the projection and wait until the snapshot agrees + a few frames have rendered with it. */
const projection = async (patch) => {
  await evalJs(`${FS}.setProjection(${JSON.stringify(patch)}), true`);
  if (typeof patch.enabled === "boolean")
    await waitFor(`(() => { const s = ${SNAP}; return !!s && s.on === ${patch.enabled}; })()`, 5000, 50);
  await ticks(4);
  await sleep(300);
};
const camPos = () => evalJs("(() => { const p = window.__globe.camera.position; return [p.x, p.y, p.z]; })()");

/** ON → OFF → ON at the current pose: (a) ON/OFF diff, (b) the ON/ON control, (c) the saturated delta. */
const pixelProbe = async (tag, files) => {
  await projection({ enabled: true, strength: 1, ownLight: 1 });
  const c0 = await camPos();
  await capture(`${tag}-on`, files?.on);
  await projection({ enabled: false });
  await capture(`${tag}-off`, files?.off);
  await projection({ enabled: true });
  await capture(`${tag}-on2`, files?.on2);
  const camMovedM = dist3(c0, await camPos());
  const a = await diff(`${tag}-on`, `${tag}-off`);
  const b = await diff(`${tag}-on`, `${tag}-on2`);
  // The signal is REGION-sized (a facade in a 1600×1000 frame): the pattern's saturated pixels
  // appear (satDelta) and thousands of pixels change, while the ON/ON control stays near-identical.
  // A whole-frame mean is the wrong instrument — it read 0.46 on a plainly painted city.
  const pass = a.satDelta > 2000 && a.changed > 5000 && b.meanAbs < 1.0 && b.satDelta < 500;
  return { pass, onOff: a, control: b, camMovedM: r2(camMovedM) };
};

// --- the leg runner ---------------------------------------------------------------------------------
const results = [];
let aborted = null;
const runLeg = async (id, name, fn) => {
  if (aborted) {
    results.push({ id, name, pass: false, detail: `skipped — ${aborted}` });
    console.log(`FAIL [${id}] ${name} — skipped (${aborted})`);
    return false;
  }
  let pass = false;
  let detail = "";
  try {
    const r = await fn();
    pass = !!r.pass;
    detail = r.detail ?? "";
  } catch (e) {
    detail = `threw: ${e?.message ?? e}`;
  }
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${name}${detail ? ` — ${detail}` : ""}`);
  return pass;
};

await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL });
console.log(`page ${URL} · CDP :${PORT} · fixture ${FIXTURE}`);
console.log(`expected optics: hFov ${H_FOV.toFixed(2)}° · vFov ${V_FOV.toFixed(2)}° · aspect ${ASPECT.toFixed(4)}`);

// ═══ 1 · BOOT ═══════════════════════════════════════════════════════════════════════════════════
const bootOk = await runLeg(1, "boot + the desktop attach gate", async () => {
  const t0 = Date.now();
  const up = await waitFor(
    `!!(window.__globe && window.__globe.camera && window.__globe.facadeFrustum && typeof window.__globe.photoProjector === "function" && window.__facadeStore && window.__uploadStore)`,
    90_000,
  );
  if (!up.ok) return { pass: false, detail: `the globe + facade seams never booted (90 s)` };
  const bootMs = Date.now() - t0;
  await sleep(3000); // first tile wave
  await evalJs(
    "(document.querySelector('.wl-btn--primary') || {click(){}}).click(), document.querySelector('canvas')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true",
  );
  await sleep(500);
  // Instant cuts (the 2026-09-22 default) — a stale `smoothFlights` pref must not leave a sweep in flight.
  await evalJs("window.__globe.smoothFlights ? window.__globe.smoothFlights(false) : null");
  const s = await snapshot();
  const isObj = s !== null && typeof s === "object";
  return {
    pass: isObj && s.on === false,
    detail: isObj
      ? `booted in ${bootMs} ms · snapshot on=${s.on} enabled=${s.enabled} depthRenders=${s.depthRenders}`
      : `photoProjector() returned ${JSON.stringify(s)} — the hqAllowed attach gate refused on a desktop run`,
  };
});
if (!bootOk) aborted = "boot failed";

// ═══ 2 · THE FLAG + THE ENTRY ═══════════════════════════════════════════════════════════════════
// T181 (2026-10-22): the `?facade` link retired — the entry is the Upload dropzone's LOWER half:
// the fixture goes on ITS file input, the Upload overlay closes and the facade overlay opens.
const entryOk = await runLeg(2, "Upload → the split dropzone's facade half → the facade overlay opens", async () => {
  await evalJs(`document.querySelector("[data-open-upload]")?.click(), true`);
  const half = await waitFor(`!!document.querySelector(".uf-dropzone--facade input[type=file]")`, 8000, 120);
  if (!half.ok) return { pass: false, detail: "no .uf-dropzone--facade input[type=file] — the split dropzone did not render" };
  const { root } = await send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".uf-dropzone--facade input[type=file]" });
  if (!nodeId) return { pass: false, detail: "DOM.querySelector found no facade file input node" };
  await send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
  const w = await waitFor(`!!document.querySelector(".uf.ff") && ${FS}.open === true && !document.querySelector(".uf:not(.ff)")`, 8000, 120);
  return { pass: w.ok, detail: w.ok ? "the facade half → .uf.ff mounted, store open, Upload closed" : `overlay never opened (last ${JSON.stringify(w.value)})` };
});
if (!entryOk) aborted = aborted ?? "the facade overlay did not open";

// ═══ 3 · FEED THE FIXTURE ═══════════════════════════════════════════════════════════════════════
const reviewOk = await runLeg(3, "the fixture decodes to REVIEW with its EXIF", async () => {
  // Leg 2 fed the fixture through the split dropzone; only an idle store (a re-run) feeds it here.
  if (await evalJs(`${FS}.phase === "idle"`)) {
    const inp = await waitFor(`!!document.querySelector(".ff input[type=file]")`, 8000, 120);
    if (!inp.ok) return { pass: false, detail: "no .ff input[type=file] in the overlay" };
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".ff input[type=file]" });
    if (!nodeId) return { pass: false, detail: "DOM.querySelector found no file input node" };
    await send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
  }
  const w = await waitFor(`${FS}.phase === "review"`, 15_000, 200);
  const s = await evalJs(`(() => { const s = ${FS}; return {
    phase: s.phase, loadError: s.loadError ?? null, decodeError: s.decodeError ?? null,
    heading: s.exif?.headingDeg ?? null, placement: s.placement ?? null,
    tw: s.textureWidth ?? null, th: s.textureHeight ?? null, exifW: s.exif?.width ?? null, exifH: s.exif?.height ?? null,
    altUndefined: s.params.altitudeM === undefined, focal: s.params.focalLengthMm ?? null,
    focal35: s.exif?.focalLengthIn35mmMm ?? null, previewSource: s.previewSource, previewUrl: s.previewUrl ?? null };
  })()`);
  await shot("01-review.jpeg");
  if (!w.ok) return { pass: false, detail: `phase never reached review (${JSON.stringify(s)})` };
  const fails = [];
  if (!near(s.heading, FIX.heading, 0.05)) fails.push(`heading ${s.heading} ≠ ${FIX.heading}`);
  if (!s.placement || !near(s.placement.latDeg, FIX.lat, 1e-5) || !near(s.placement.lonDeg, FIX.lon, 1e-5))
    fails.push(`placement ${JSON.stringify(s.placement)}`);
  if (!(s.tw === FIX.w && s.th === FIX.h))
    fails.push(`textureWidth/Height ${s.tw}×${s.th} (exif ${s.exifW}×${s.exifH}) ≠ ${FIX.w}×${FIX.h}`);
  if (!s.altUndefined) fails.push("params.altitudeM is set (the fixture has no altitude)");
  return {
    pass: fails.length === 0,
    detail:
      (fails.length ? fails.join(" · ") + " || " : "") +
      `heading ${s.heading} · placement ${s.placement?.latDeg},${s.placement?.lonDeg} · tex ${s.tw}×${s.th} · focal35 ${s.focal35} · preview ${s.previewSource}`,
  };
});
if (!reviewOk && !aborted) {
  // A dims mismatch alone must not stop the run (the projection legs measure what it causes).
  const phase = await evalJs(`${FS}.phase`).catch(() => "?");
  if (phase !== "review") aborted = `the fixture never reached review (phase ${phase})`;
}

// ═══ 4 · PLACE ══════════════════════════════════════════════════════════════════════════════════
let placedGeom = null;
await runLeg(4, "place → frustum at the GPS point + the projector snapshot", async () => {
  await evalJs(`${FS}.place(), true`);
  const w = await waitFor(`${FS}.phase === "placed" && ${FS}.open === false`, 5000, 100);
  if (!w.ok) return { pass: false, detail: `place() did not reach placed/closed (phase ${await evalJs(`${FS}.phase`)})` };
  await sleep(FLIGHT_SETTLE_MS);
  const fails = [];
  const panel = await evalJs(`(() => { const p = document.querySelector(".pd.ff-panel"); if (!p) return 0; const r = p.getBoundingClientRect(); return Math.round(r.width * r.height); })()`);
  if (!(panel > 0)) fails.push(`.pd.ff-panel not rendered (area ${panel})`);
  const g = await geomNow();
  placedGeom = g;
  if (!g) {
    fails.push("facadeFrustum.current() is null after place()");
  } else {
    const R = Math.hypot(...g.apex);
    if (!(R > 6_356_000 && R < 6_400_000)) fails.push(`|apex| ${Math.round(R)} m off the Earth`);
    const p0 = ecef(FIX.lat, FIX.lon, 0);
    const nrm = normalAt(FIX.lat, FIX.lon);
    const d = [g.apex[0] - p0[0], g.apex[1] - p0[1], g.apex[2] - p0[2]];
    const h = d[0] * nrm[0] + d[1] * nrm[1] + d[2] * nrm[2];
    const horiz = Math.hypot(d[0] - h * nrm[0], d[1] - h * nrm[1], d[2] - h * nrm[2]);
    if (!(h >= 0 && h <= 300)) fails.push(`apex height above the ellipsoid ${h.toFixed(1)} m ∉ [0, 300]`);
    if (!(horiz < 2)) fails.push(`apex ${horiz.toFixed(2)} m off the GPS point horizontally`);
    console.log(`      apex: h ${h.toFixed(1)} m above the ellipsoid · ${horiz.toFixed(3)} m horizontal offset · |apex| ${Math.round(R)} m`);
  }
  const sw = await waitFor(
    `(() => { const s = ${SNAP}; return !!s && s.on === true && s.textureReady === true && s.depthRenders >= 1; })()`,
    5000,
    100,
  );
  const s = await snapshot();
  await shot("02-placed.jpeg");
  if (!sw.ok) fails.push(`snapshot never went on+textureReady+depthRendered (${JSON.stringify(s)})`);
  if (s) {
    if (JSON.stringify(s.textureSize) !== JSON.stringify([FIX.w, FIX.h])) fails.push(`textureSize ${JSON.stringify(s.textureSize)}`);
    if (s.flipV !== 1) fails.push(`flipV ${s.flipV}`);
    if (!(s.depthSize?.[0] === 1024 && s.depthSize?.[1] === 768)) fails.push(`depthSize ${JSON.stringify(s.depthSize)} ≠ [1024,768]`);
    if (s.error !== null) fails.push(`error ${JSON.stringify(s.error)}`);
    if (!near(s.aspect, ASPECT, 0.01)) fails.push(`aspect ${r2(s.aspect)} ≠ ${ASPECT.toFixed(4)}`);
    if (!near(s.vFovDeg, V_FOV, 1.5)) fails.push(`vFov ${r2(s.vFovDeg)}° ≠ ${V_FOV.toFixed(2)}° ±1.5`);
    if (g && Array.isArray(s.apex) && dist3(s.apex, g.apex) > 0.5) fails.push(`snapshot apex ${dist3(s.apex, g.apex).toFixed(2)} m from the frustum apex`);
  }
  return {
    pass: fails.length === 0,
    detail:
      (fails.length ? fails.join(" · ") + " || " : "") +
      (s
        ? `on ${s.on} · tex ${JSON.stringify(s.textureSize)} · depth ${JSON.stringify(s.depthSize)} ×${s.depthRenders} (${r2(s.lastDepthMs)} ms clock) · aspect ${r2(s.aspect)} · vFov ${r2(s.vFovDeg)}° · strength ${s.strength} ownLight ${s.ownLight}`
        : "no snapshot"),
  };
});
if (!placedGeom && !aborted) aborted = "the facade frustum never built";

// ═══ 5 · PIXELS ═════════════════════════════════════════════════════════════════════════════════
// The image plane (FRUSTUM.planeOpacity 0.7, the photo itself) is drawn on top of everything the
// projection lands on when seen from behind the apex — hide it for the pixel legs so ON vs OFF
// measures the BUILDINGS, not the plane (the wireframe lines stay; they are identical in both).
await runLeg(5, "PIXELS — the projection is really on the buildings", async () => {
  await evalJs(`${FS}.setPlaneOpacity(0), true`);
  await ticks(3);
  const land = await pixelProbe("land", { on: "03-on.jpeg", off: "04-off.jpeg", on2: "05-on-control.jpeg" });
  console.log(`      landing pose: ON/OFF ${JSON.stringify(land.onOff)} · ON/ON control ${JSON.stringify(land.control)} · cam moved ${land.camMovedM} m`);
  // The close pose: 40 m behind the apex along −forward, 15 m up (radial), looking at the far-face centre.
  const g = await geomNow();
  await evalJs(`(() => {
    const g = window.__globe.facadeFrustum.current();
    const V = window.__globe.camera.up.constructor; // the page's THREE.Vector3
    const apex = new V(g.apex[0], g.apex[1], g.apex[2]);
    const fwd = new V(g.forward[0], g.forward[1], g.forward[2]);
    const up = apex.clone().normalize();
    const c = g.corners;
    const look = new V((c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4, (c[0][2] + c[1][2] + c[2][2] + c[3][2]) / 4);
    const pos = apex.clone().addScaledVector(fwd, -40).addScaledVector(up, 15);
    window.__globe.flight.start({ position: pos, lookAt: look });
    return true;
  })()`);
  await sleep(2500); // the cut + the near tiles' LOD
  const camToApex = dist3(await camPos(), g.apex);
  const close = await pixelProbe("close", { on: "06-close-on.jpeg", off: "07-close-off.jpeg" });
  console.log(`      close pose (cam ${camToApex.toFixed(1)} m from the apex): ON/OFF ${JSON.stringify(close.onOff)} · control ${JSON.stringify(close.control)} · cam moved ${close.camMovedM} m`);
  await dropCaps(); // ~6.4 MB of ImageData per capture lives on window until dropped
  const fmt = (p) => `ON/OFF ${p.onOff.meanAbs} (sat +${p.onOff.satDelta}, ${p.onOff.changed} px changed) · control ${p.control.meanAbs}`;
  return {
    pass: land.pass || close.pass,
    detail: `landing ${land.pass ? "PASS" : "fail"} [${fmt(land)}] · close ${close.pass ? "PASS" : "fail"} [${fmt(close)}] · need sat Δ > 2000, > 5000 px changed, control mean < 1.0 + sat Δ < 500`,
  };
});

// ═══ 6 · OWN-LIGHT vs LIT ═══════════════════════════════════════════════════════════════════════
await runLeg(6, "ownLight 1 vs 0 — the lit half shades the photo", async () => {
  await projection({ enabled: true, strength: 1, ownLight: 1 });
  await capture("own1");
  await projection({ ownLight: 0 });
  await capture("own0", "08-ownlight0.jpeg");
  const d = await diff("own1", "own0");
  const s = await snapshot();
  await projection({ ownLight: 1 });
  await evalJs(`${FS}.setPlaneOpacity(undefined), true`);
  await dropCaps();
  return {
    pass: d.changed > 3000 && s?.ownLight === 0,
    detail: `mean |Δ| ${d.meanAbs} (${d.changed} px changed) · snapshot ownLight at the lit capture ${s?.ownLight} · need > 3000 px changed`,
  };
});

// ═══ 7 · THE NUDGE RE-RENDERS THE DEPTH ═════════════════════════════════════════════════════════
await runLeg(7, "nudgePlacement(2 m N) moves the apex + re-renders the depth", async () => {
  const s0 = await snapshot();
  const g0 = await geomNow();
  await evalJs(`${FS}.nudgePlacement(2, 0), true`);
  await ticks(3);
  await sleep(200);
  const s1 = await snapshot();
  const g1 = await geomNow();
  await shot("09-nudged.jpeg");
  if (!g0 || !g1 || !s0 || !s1) return { pass: false, detail: `missing geometry/snapshot (g0 ${!!g0} g1 ${!!g1} s0 ${!!s0} s1 ${!!s1})` };
  const moved = dist3(g0.apex, g1.apex);
  const snapMoved = dist3(s0.apex, s1.apex);
  return {
    pass: moved >= 1.5 && moved <= 2.5 && s1.depthRenders > s0.depthRenders,
    detail: `apex moved ${moved.toFixed(3)} m (snapshot apex ${snapMoved.toFixed(3)} m) · depthRenders ${s0.depthRenders} → ${s1.depthRenders}`,
  };
});

// ═══ 10 · FRAME COST (runs here: it needs a placed photo) ═══════════════════════════════════════
await runLeg(10, "frame cost — projection ON vs OFF", async () => {
  const sample = () =>
    evalJs(`(async () => {
      const d = []; let last = performance.now();
      await new Promise((r) => { const f = (t) => { d.push(t - last); last = t; if (d.length >= 91) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      d.shift(); d.sort((a, b) => a - b);
      const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
      return { p50: Math.round(q(0.5) * 100) / 100, p95: Math.round(q(0.95) * 100) / 100, max: Math.round(d[d.length - 1] * 100) / 100, n: d.length };
    })()`);
  await projection({ enabled: true, strength: 1, ownLight: 1 });
  await sleep(500);
  const on = await sample();
  await projection({ enabled: false });
  await sleep(500);
  const off = await sample();
  await projection({ enabled: true });
  const budget = off.p95 * 1.6 + 4;
  return {
    pass: on.p95 <= budget,
    detail: `ON p50 ${on.p50} / p95 ${on.p95} / max ${on.max} ms · OFF p50 ${off.p50} / p95 ${off.p95} / max ${off.max} ms · budget p95 ≤ ${budget.toFixed(2)} ms`,
  };
});

// ═══ 8 · NO REGRESSION TO THE PIN FLOW + clear() ════════════════════════════════════════════════
await runLeg(8, "the pin flow untouched + clear() tears the projection down", async () => {
  const fails = [];
  const pin = await evalJs(`({
    uploadPhase: window.__uploadStore.getState().phase,
    pinFrustum: window.__globe.frustum.current() === null,
    pinOverlay: document.querySelector(".uf:not(.ff)") === null,
  })`);
  if (pin.uploadPhase !== "idle") fails.push(`upload phase ${pin.uploadPhase}`);
  if (!pin.pinFrustum) fails.push("the PIN frustum built");
  if (!pin.pinOverlay) fails.push("the pin overlay (.uf:not(.ff)) is open");
  await evalJs(`${FS}.clear(), true`);
  await ticks(3);
  await sleep(150);
  const after = await evalJs(`(() => {
    const s = ${SNAP};
    return { snapOn: s ? s.on : undefined, textureReady: s ? s.textureReady : undefined,
      panelGone: document.querySelector(".pd.ff-panel") === null,
      facadeGone: window.__globe.facadeFrustum.current() === null, phase: ${FS}.phase };
  })()`);
  await shot("10-cleared.jpeg");
  if (after.snapOn !== false) fails.push(`snapshot on ${after.snapOn} after clear()`);
  if (!after.panelGone) fails.push(".pd.ff-panel still mounted");
  if (!after.facadeGone) fails.push("facadeFrustum.current() not null");
  if (after.phase !== "idle") fails.push(`facade phase ${after.phase}`);
  return {
    pass: fails.length === 0,
    detail: (fails.length ? fails.join(" · ") + " || " : "") + `pin ${JSON.stringify(pin)} · after clear ${JSON.stringify(after)}`,
  };
});

// ═══ 9 · CONSOLE ════════════════════════════════════════════════════════════════════════════════
await sleep(300);
await runLeg(9, "console — no errors, no shader/GL noise", async () => {
  for (const e of consoleErrors.slice(0, 10)) console.log(`      ! ${e}`);
  for (const e of glNoise.slice(0, 10)) console.log(`      ~ ${e}`);
  return {
    pass: consoleErrors.length === 0 && glNoise.length === 0,
    detail: `${consoleErrors.length} console error(s)/exception(s) · ${glNoise.length} shader/GL-matching message(s)`,
  };
});

// --- summary --------------------------------------------------------------------------------------
const failures = results.filter((r) => !r.pass);
console.log("\n── PHOTO PROJECTION · SUMMARY ─────────────────────────────────");
for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  [${r.id}] ${r.name}`);
console.log(`  ${results.length - failures.length}/${results.length} legs pass · shots in ${SHOTS}/`);
console.log("────────────────────────────────────────────────────────────────");

await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
ws.close();
await finishVerify(failures.length ? 1 : 0);
