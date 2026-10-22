// verify-owner-asks-2026-10-23.mjs — the 2026-10-23 build's BROWSER legs on dev (the house Chrome,
// ONE target at a time): T189 the place-pin markers (hover highlight, a click → the clock then the
// FPV jump at the saved viewpoint, the minimap re-centre glyph) on the DESKTOP shell, then F6 the
// VIEW-ONLY mobile twin + T191 the LAYERS modal + the /m MY LOC cell on an EMULATED PHONE (coarse
// pointer + touch set BEFORE navigation — the tier is read at attach): the lean projector (K 2 ·
// 1024² layers · 512-px depth maps), a synthetic world row served by an in-page fetch stub to the
// store's own PUBLIC read (T190 — no member), the residency + the paint (the photo array fills), the
// frame cost ON vs OFF, the TAP PEEK (no hover card, no menu) → LOOK FROM HERE, the LAYERS grid
// (nothing in the stack shifts; the scrim closes), the 2D gate (the residents release).
//
// Needs `wix dev` on http://localhost:4321 (the window.__* DEV seams). Shots → verify-shots/owner-asks-2026-10-23/.
//   FTW_CDP_PORT (9333) · FTW_OA23_LEGS=d,m (default both)
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.env.FTW_CDP_PORT ?? 9333);
const APP = process.env.FTW_OA23_APP ?? "http://localhost:4321";
const LEGS = (process.env.FTW_OA23_LEGS ?? "d,m").split(",");
const SHOTS = "verify-shots/owner-asks-2026-10-23";
const FIXTURE = resolve("test/fixtures/facade-pattern.jpg");
const FIXTURE_URL = `${APP}/@fs${FIXTURE}`;
const T0 = 1788701556919; // the harnesses' shared noon
const D2R = Math.PI / 180;
const DEV = {
  desktop: { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
  iphone: { width: 402, height: 874, deviceScaleFactor: 3, mobile: true },
};
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps;
const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const fmtFails = (fails, ok) => (fails.length ? fails.join(" · ") : ok);
const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

/** One CDP target with the page helpers; the emulation is applied BEFORE the first navigation. */
async function openTarget(dev) {
  let target;
  try {
    target = await http("/json/new?about:blank", "PUT");
  } catch {
    target = await http("/json/new?about:blank", "GET");
  }
  trackTarget(PORT, target.id);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  const glNoise = [];
  const GL_RE = /shader|GLSL|compile|WebGL|texture unit|INVALID_/i;
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
      // The house profile's extensions throw in THEIR content scripts (a password manager's presence
      // marker: "factory is not a function", 2026-10-23) — never the app's; keep the app's only.
      const fromExtension = (d?.url ?? "").startsWith("chrome-extension://") || (d?.stackTrace?.callFrames ?? []).some((f) => (f.url ?? "").startsWith("chrome-extension://"));
      if (!fromExtension) consoleErrors.push("EXCEPTION: " + (d?.exception?.description ?? d?.text ?? "").slice(0, 240));
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
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
  const ticks = (n) => evalJs(`new Promise((r) => { let k = ${n}; const f = () => (--k <= 0 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
  const shot = async (name) => {
    await send("Page.bringToFront").catch(() => {});
    const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    writeFileSync(`${SHOTS}/${name}`, Buffer.from(s.data, "base64"));
  };
  const mouse = (type, x, y, opts = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseMoved" ? 0 : undefined, ...opts });
  const click = async (x, y) => {
    await mouse("mouseMoved", x, y, { buttons: 0 });
    await sleep(40);
    await mouse("mousePressed", x, y, { clickCount: 1 });
    await sleep(40);
    await mouse("mouseReleased", x, y, { clickCount: 1 });
  };
  const tap = async (x, y) => {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const camPos = () => evalJs("(() => { const p = window.__globe.camera.position; return [p.x, p.y, p.z]; })()");
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const settleCamera = async (maxMs = 9000) => {
    const t0 = Date.now();
    let last = await camPos();
    await sleep(600);
    while (Date.now() - t0 < maxMs) {
      const p = await camPos();
      if (dist3(p, last) < 0.02) return p;
      last = p;
      await sleep(250);
    }
    return last;
  };
  /** The frame-time sampler of the photo-projection harness (91 frames → p50 / p95 / max). */
  const sampleFrames = () =>
    evalJs(`(async () => {
      const d = []; let last = performance.now();
      await new Promise((r) => { const f = (t) => { d.push(t - last); last = t; if (d.length >= 91) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      d.shift(); d.sort((a, b) => a - b);
      const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
      return { p50: Math.round(q(0.5) * 100) / 100, p95: Math.round(q(0.95) * 100) / 100, max: Math.round(d[d.length - 1] * 100) / 100, n: d.length };
    })()`);
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: dev.width, height: dev.height, deviceScaleFactor: dev.deviceScaleFactor, mobile: dev.mobile });
  if (dev.mobile) {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }] });
  }
  await send("Page.bringToFront").catch(() => {});
  const goto = (url) => send("Page.navigate", { url });
  const close = () => { try { ws.close(); } catch { /* gone */ } };
  return { send, evalJs, waitFor, ticks, shot, mouse, click, tap, camPos, dist3, settleCamera, sampleFrames, goto, close, consoleErrors, glNoise };
}

const results = [];
const runLeg = async (id, name, fn) => {
  const t0 = Date.now();
  try {
    const r = await fn();
    results.push({ id, name, ...r, ms: Date.now() - t0 });
    console.log(`${r.pass ? "PASS" : "FAIL"} [${id}] ${name} — ${r.detail} (${Date.now() - t0} ms)`);
    return r.pass;
  } catch (e) {
    results.push({ id, name, pass: false, detail: `threw: ${e.message}`, ms: Date.now() - t0 });
    console.log(`FAIL [${id}] ${name} — threw: ${e.message}`);
    return false;
  }
};

/** The screen point of a GL marker's glyph CENTRE: the anchor (the pin's tip / the apex) lifted by
 *  half the instance's scale along the camera's up (the billboard's up is the screen's up). */
const glyphCentreExpr = (seam, id, liftFrac) => `(() => { const g = window.__globe; const cam = g.camera; const s = g.${seam}();
  const a = s.anchorOf ? s.anchorOf(${JSON.stringify(id)}) : s.apexOf(${JSON.stringify(id)}); const sc = s.scaleOf ? s.scaleOf(${JSON.stringify(id)}) : s.markerScaleOf(${JSON.stringify(id)});
  if (!a || !(sc > 0)) return null; const V = cam.up.constructor; const up = new V(0, 1, 0).applyQuaternion(cam.quaternion);
  const p = new V(a[0], a[1], a[2]).addScaledVector(up, sc * ${liftFrac}).project(cam);
  const r = document.querySelector("canvas.globe-canvas").getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, scale: sc, inFront: p.z < 1 }; })()`;

console.log(`app ${APP} · CDP :${PORT} · legs ${LEGS.join(",")} · fixture ${FIXTURE}`);
const PLACE_A = { id: "oa23-place-a", title: "harness place A", timeMs: null, createdAt: null, latDeg: 48.4647, lonDeg: 35.0462, eyeM: 1.7, headingDeg: 25, pitchDeg: 0, fovDeg: 60 };
const PLACE_B = { id: "oa23-place-b", title: "harness place B (3 h later)", timeMs: T0 + 3 * 3600_000, createdAt: null, latDeg: 48.4662, lonDeg: 35.0484, eyeM: 2.2, headingDeg: 200, pitchDeg: -4, fovDeg: 52 };

// ═══════════════════════════════════════ DESKTOP · T189 ═══════════════════════════════════════
if (LEGS.includes("d")) {
  const d = await openTarget(DEV.desktop);
  try {
    await d.goto(`${APP}/#p=48.4647,35.0462,1500,25,55.0&t=${T0}`);
    let bootOk = await runLeg("d1", "boot — the globe + the DEV seams (places, placesStore, photoProjector at K 6, timeStore)", async () => {
      const w = await d.waitFor(`!!window.__globe && typeof window.__globe.places === "function" && !!window.__placesStore && !!window.__globe.photoProjector && !!window.__cameraStore && !!window.__timeStore && !!document.querySelector(".nm-btn")`, 90_000, 500);
      if (!w.ok) return { pass: false, detail: "the seams never appeared" };
      await d.waitFor(`window.__globe.ready && window.__globe.ready()`, 60_000, 500).catch(() => {});
      await d.settleCamera(12_000);
      const cap = await d.evalJs("window.__globe.photoProjector().capacity");
      const lean = await d.evalJs("window.__globeQuality ? window.__globeQuality.lean : null");
      return { pass: cap === 6 && lean !== true, detail: `capacity ${cap} · lean ${lean}` };
    });
    if (bootOk) {
      await runLeg("d2", "T189 the place-pin markers: two rows pushed → two billboards; a HOVER at the glyph lights it (white × 1.4, eased) and the cursor says so", async () => {
        const fails = [];
        // The rows ride the store's OWN load through an in-page fetch stub (the facade harnesses' idiom):
        // dev answers `/api/places` 401 for a visitor and the store then wipes the list — a row added
        // beside it is gone at the next idle kick (the first run lost both markers mid-leg).
        await d.evalJs(`(() => { window.__oa23Places = { places: [${JSON.stringify(PLACE_A)}, ${JSON.stringify(PLACE_B)}] };
          if (!window.__oa23FetchD) { window.__oa23FetchD = window.fetch.bind(window); window.fetch = (input, init) => { const u = typeof input === "string" ? input : input.url; const mm = (init && init.method) || "GET";
            if (u.startsWith("/api/places") && mm === "GET") return Promise.resolve(new Response(JSON.stringify(window.__oa23Places), { status: 200, headers: { "Content-Type": "application/json" } })); return window.__oa23FetchD(input, init); }; }
          const s = window.__placesStore; s.setState({ loaded: false, places: [] }); s.getState().setOnMap(true); s.getState().ensureLoaded(); return true; })()`);
        const loaded = await d.waitFor(`window.__placesStore.getState().places.length === 2`, 8000, 100);
        if (!loaded.ok) return { pass: false, detail: `the stubbed /api/places never landed (places ${await d.evalJs("window.__placesStore.getState().places.length")})` };
        const w = await d.waitFor(`(() => { const c = window.__globe.places().markers; return c && c.drawn >= 2; })()`, 8000, 100);
        if (!w.ok) return { pass: false, detail: `markers ${JSON.stringify(await d.evalJs("window.__globe.places().markers"))}` };
        await d.ticks(3);
        const pt = await d.evalJs(glyphCentreExpr("places", PLACE_A.id, 0.5));
        if (!pt || !pt.inFront) return { pass: false, detail: `no screen point for the marker (${JSON.stringify(pt)})` };
        const s0 = pt.scale;
        await d.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        const hv = await d.waitFor(`window.__globe.places().hovered === ${JSON.stringify(PLACE_A.id)}`, 3000, 50);
        if (!hv.ok) fails.push(`hover at (${r2(pt.x)}, ${r2(pt.y)}) did not light the marker (hovered ${await d.evalJs("window.__globe.places().hovered")})`);
        await sleep(500);
        const s1 = await d.evalJs(`window.__globe.places().scaleOf(${JSON.stringify(PLACE_A.id)})`);
        if (!(s1 > s0 * 1.3)) fails.push(`the hovered marker grew ×${r2(s1 / s0)} (want ×1.4 eased)`);
        // The pointer cursor is set by the hover step; other steps (the sky affordance cascade) may
        // reset it between frames — recorded, not a bar (the pins' hover has the same race).
        const cursor = await d.evalJs(`document.querySelector("canvas.globe-canvas").style.cursor`);
        await d.shot("d2-place-hover.jpeg");
        await d.mouse("mouseMoved", pt.x + 260, pt.y + 180, { buttons: 0 });
        const off = await d.waitFor(`window.__globe.places().hovered === null`, 3000, 50);
        if (!off.ok) fails.push("the hover did not clear off the marker");
        return { pass: fails.length === 0, detail: fmtFails(fails, `2 markers · hover at (${r2(pt.x)}, ${r2(pt.y)}) → lit, scale ${r2(s0)} → ${r2(s1)} m (×${r2(s1 / s0)}) · cursor "${cursor}" · cleared`) };
      });
      await runLeg("d3", "T189 a CLICK on a saved place jumps INTO FPV at its viewpoint — the clock FIRST (the row's time), then the eye at its lat / lon / height / heading / fov", async () => {
        const fails = [];
        const pt = await d.evalJs(glyphCentreExpr("places", PLACE_B.id, 0.5));
        if (!pt || !pt.inFront) return { pass: false, detail: `no screen point for place B (${JSON.stringify(pt)})` };
        const liveBefore = await d.evalJs("window.__timeStore.getState().live");
        await d.click(pt.x, pt.y);
        const wf = await d.waitFor(`window.__globe.fpv().active === true`, 15_000, 100);
        if (!wf.ok) return { pass: false, detail: `FPV never activated after the click at (${r2(pt.x)}, ${r2(pt.y)}) — hovered ${await d.evalJs("window.__globe.places().hovered")}` };
        const t = await d.evalJs("(() => { const s = window.__timeStore.getState(); return { live: s.live, timeMs: s.timeMs }; })()");
        if (t.live !== false || !near(t.timeMs, PLACE_B.timeMs, 1000)) fails.push(`the clock: live ${t.live} timeMs ${t.timeMs} (want ${PLACE_B.timeMs}, live before ${liveBefore})`);
        await d.settleCamera(15_000);
        const fpv = await d.evalJs("(() => { const f = window.__globe.fpv(); const c = window.__cameraStore.getState().camGeo; return { active: f.active, fov: f.fovDeg, yaw: f.yawDeg, pitch: f.pitchDeg, eyeAbove: f.eyeAboveGroundM, geo: c }; })()");
        if (fpv.geo && (!near(fpv.geo.latDeg, PLACE_B.latDeg, 3 / 111_320) || !near(fpv.geo.lonDeg, PLACE_B.lonDeg, 3 / (111_320 * Math.cos(PLACE_B.latDeg * D2R)))))
          fails.push(`the eye stands at ${JSON.stringify(fpv.geo)} (want ${PLACE_B.latDeg}, ${PLACE_B.lonDeg} ± 3 m)`);
        if (!near(fpv.fov, PLACE_B.fovDeg, 2)) fails.push(`fov ${r2(fpv.fov)} (want ${PLACE_B.fovDeg})`);
        if (!near(fpv.eyeAbove, PLACE_B.eyeM, 0.6)) fails.push(`eye ${r2(fpv.eyeAbove)} m over the ground (want ${PLACE_B.eyeM})`);
        await d.shot("d3-place-click-fpv.jpeg");
        return { pass: fails.length === 0, detail: fmtFails(fails, `click → FPV · clock ${t.timeMs} (live ${t.live}) · eye ${fpv.geo ? `${r2(fpv.geo.latDeg)}, ${r2(fpv.geo.lonDeg)}` : "?"} · ${r2(fpv.eyeAbove)} m · fov ${r2(fpv.fov)}`) };
      });
      await runLeg("d4", "T189 the FPV minimap → the map window's re-centre button carries the SAME pin glyph", async () => {
        const fails = [];
        const mm = await d.waitFor(`!!document.querySelector(".mm")`, 8000, 100);
        if (!mm.ok) return { pass: false, detail: "no FPV mini-map (.mm) in the DOM" };
        // The window opens from the mini-map's own click (a React onClick on its element) — drive the
        // store seam when it exists, else a real pointer click at the patch's centre.
        const opened = await d.evalJs(`(() => { if (window.__miniMapStore) { window.__miniMapStore.getState().setMapWindowOpen(true); return "store"; } return null; })()`);
        if (!opened) {
          const r = await d.evalJs(`(() => { const r = document.querySelector(".mm").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
          await d.click(r.x, r.y);
        }
        const mw = await d.waitFor(`!!document.querySelector(".mw-recenter path")`, 8000, 100);
        if (!mw.ok) fails.push("the map window's .mw-recenter path never appeared");
        else {
          const g = await d.evalJs(`(() => { const p = document.querySelector(".mw-recenter path"); const c = document.querySelector(".mw-recenter circle.mw-recenter__dot"); return { d: p.getAttribute("d"), cy: c ? c.getAttribute("cy") : null, r: c ? c.getAttribute("r") : null }; })()`);
          if (!/^M12 2\.5a6\.5 6\.5/.test(g.d ?? "")) fails.push(`re-centre path "${(g.d ?? "").slice(0, 24)}…"`);
          if (g.cy !== "9" || g.r !== "2.3") fails.push(`re-centre dot cy ${g.cy} r ${g.r}`);
        }
        await d.shot("d4-map-window-recenter.jpeg");
        await d.evalJs(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`);
        return { pass: fails.length === 0, detail: fmtFails(fails, "the map window's re-centre button is the MY SPOT pin") };
      });
      await runLeg("d5", "desktop teardown — FPV left, the places cleared, no GL noise, no exceptions", async () => {
        const fails = [];
        await d.evalJs(`window.__cameraStore.getState().setTempPin(null), true`);
        await d.waitFor(`window.__globe.fpv().active === false`, 8000, 200);
        await d.evalJs(`(() => { if (window.__oa23FetchD) { window.fetch = window.__oa23FetchD; window.__oa23FetchD = null; } window.__placesStore.setState({ places: [], loaded: false }); window.__timeStore.getState().goLive(); return true; })()`);
        if (d.glNoise.length) fails.push(`GL noise ×${d.glNoise.length}: ${d.glNoise[0]}`);
        const real = d.consoleErrors.filter((e) => !/favicon|404|Failed to load resource|net::ERR|cesium|ion\.|401|403/i.test(e));
        if (real.length) fails.push(`console errors ×${real.length}: ${real[0]}`);
        return { pass: fails.length === 0, detail: fmtFails(fails, `clean (${d.consoleErrors.length} ignorable console lines)`) };
      });
    }
  } finally {
    d.close();
  }
}

// ═══════════════════════════════════ PHONE · F6 + T191 + T189(b) ═══════════════════════════════
if (LEGS.includes("m")) {
  const m = await openTarget(DEV.iphone);
  const rowId = "oa23-world-row";
  // The synthetic row stands this far ahead of the boot eye, in the street (120 m landed INSIDE the
  // facade the fixture photo faces — LOOK's eye was then stepped ~11 m clear by the FPV clearance;
  // the owner's real apexes are street poses). The marker at 30 m reads ~1.2 m / ~50 px.
  const AHEAD_M = 30;
  try {
    // FPV straight away (the `#f=` pose hash — mobileShellHash keeps it): the eye 1.7 m over the
    // ground at the fixture pose, facing 25°.
    await m.goto(`${APP}/m#f=48.4647,35.0462,1.7,25,8,60&t=${T0}`);
    const bootOk = await runLeg("m1", "F6 boot on an emulated phone — body.m, the LEAN tier, the projector at K 2 (draftless), the facade markers attached, no photo array yet", async () => {
      const fails = [];
      const w = await m.waitFor(`!!window.__globe && !!window.__globe.photoProjector && typeof window.__globe.facades === "function" && !!window.__facadesStore && !!window.__cameraStore && document.body.classList.contains("m")`, 90_000, 500);
      if (!w.ok) return { pass: false, detail: "the seams never appeared on /m" };
      await m.waitFor(`window.__globe.fpv().active === true`, 60_000, 500);
      await m.settleCamera(12_000);
      const s = await m.evalJs("window.__globe.photoProjector()");
      const f = await m.evalJs("(() => { const x = window.__globe.facades(); return { markers: x.markers, resident: x.resident, occupied: x.occupied, texturesOn: x.texturesOn }; })()");
      const lean = await m.evalJs("window.__globeQuality ? window.__globeQuality.lean : null");
      if (lean !== true) fails.push(`lean ${lean} (the coarse-pointer emulation must land BEFORE navigation)`);
      if (s.capacity !== 2) fails.push(`capacity ${s.capacity} (want 2 — PHOTO_PROJECT_LEAN.slots)`);
      if (s.photoArray !== null) fails.push("the photo array was allocated before any photo");
      if (s.slots.length !== 0 || f.occupied.length !== 0) fails.push(`a draft record on the view-only tier (slots ${JSON.stringify(s.slots.map((x) => x.id))}, occupied ${JSON.stringify(f.occupied)})`);
      if (f.markers === null) fails.push("no facade markers on /m");
      if (f.texturesOn !== true) fails.push(`TEX is ${f.texturesOn} (the default is on)`);
      await m.shot("m1-boot.jpeg");
      return { pass: fails.length === 0, detail: fmtFails(fails, `lean · capacity ${s.capacity} · depth ${s.depthSize.join("×")} · no array · markers ${JSON.stringify(f.markers)} · TEX on`) };
    });
    if (bootOk) {
      let rowPose = null;
      await runLeg("m2", "F6 a PUBLIC world row (the fetch stub, NO member) ahead in the street → a marker + a RESIDENT slot → the lean array fills: 1024² × 2 layers = 11.2 MB, a ≤ 512-px depth map", async () => {
        const fails = [];
        // The apex at the EYE's absolute height: the rendered ground under the viewer (`camGeo.groundAltM`)
        // + the eye's height over it (`fpv().eyeM` is that height, not an altitude — the first run put
        // the apex 100 m underground and the marker 300 px below the frame).
        // The eye stands on the ELLIPSOID until the ground tile under it streams in, then the walker
        // re-seats it ~86 m up (Dnipro): read the altitude only once the mirror names a ground height
        // and the camera has settled — an apex read earlier sits 86 m below the frame by m4.
        // Dnipro's ground is 50–170 m above the ellipsoid: a 0-ish reading is the ellipsoid seat before
        // the tile streams in (the mirror answers a number there too).
        const grounded = await m.waitFor(`(() => { const g = window.__cameraStore.getState().camGeo; return !!g && typeof g.groundAltM === "number" && g.groundAltM > 20; })()`, 45_000, 300);
        if (!grounded.ok) fails.push("no terrain height under the viewer after 45 s (the VPN — T98?)");
        await m.settleCamera(15_000);
        const eye = await m.evalJs("(() => { const f = window.__globe.fpv(); const c = window.__cameraStore.getState().camGeo; return { eyeM: f.eyeM, above: f.eyeAboveGroundM, geo: c }; })()");
        const lat0 = eye.geo?.latDeg ?? 48.4647;
        const lon0 = eye.geo?.lonDeg ?? 35.0462;
        const aheadM = AHEAD_M;
        const lat = lat0 + (aheadM * Math.cos(25 * D2R)) / 111_320;
        const lon = lon0 + (aheadM * Math.sin(25 * D2R)) / (111_320 * Math.cos(lat0 * D2R));
        // The eye's own ellipsoidal altitude off the camera's ECEF (WGS-84, the closed-form iteration) —
        // the row's apex at that height stands level with the eye (the mirrors carry no altitude).
        const eyeAltM = await m.evalJs(`(() => { const p = window.__globe.camera.position; const a = 6378137, e2 = 6.69437999014e-3; const x = p.x, y = p.y, z = p.z; const r = Math.hypot(x, y);
          let lat = Math.atan2(z, r * (1 - e2)); for (let i = 0; i < 6; i++) { const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); lat = Math.atan2(z + e2 * N * Math.sin(lat), r); }
          const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); return r / Math.cos(lat) - N; })()`);
        const apexAltM = typeof eyeAltM === "number" && Number.isFinite(eyeAltM) ? eyeAltM : 120;
        rowPose = { lat, lon, apexAltM };
        await m.evalJs(`(() => { const row = { id: ${JSON.stringify(rowId)}, title: "harness world row", displayUrl: ${JSON.stringify(FIXTURE_URL)}, thumbUrl: null, updatedAt: new Date().toISOString(),
          lat: ${lat}, lon: ${lon}, apexAltM: ${apexAltM}, altitudeM: 1.7, headingDeg: 205, pitchDeg: 0, rollDeg: 0, focalLengthMm: 26, hFovDeg: 69.39, fovEstimated: false,
          textureWidth: 1600, textureHeight: 1200, strength: 1, ownLight: 0.6, rangeM: null };
          window.__oa23Rows = { world: [row] };
          if (!window.__oa23Fetch) {
            window.__oa23Fetch = window.fetch.bind(window);
            window.fetch = (input, init) => {
              const u = typeof input === "string" ? input : input.url;
              const mm = (init && init.method) || "GET";
              if (u.startsWith("/api/facades") && mm === "GET" && u.includes("cells=")) return Promise.resolve(new Response(JSON.stringify({ facades: window.__oa23Rows.world, complete: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
              return window.__oa23Fetch(input, init);
            };
          }
          window.__facadesStore.getState().refresh();
          return true; })()`);
        const member = await m.evalJs("window.__memberStore.getState().phase");
        if (member !== "anonymous") fails.push(`the member phase is ${member} (the leg must run SIGNED OUT — T190)`);
        const w1 = await m.waitFor(`window.__facadesStore.getState().world.length === 1`, 10_000, 100);
        if (!w1.ok) return { pass: false, detail: fmtFails(fails, "") + ` · the world row never landed (world ${await m.evalJs("window.__facadesStore.getState().world.length")}, phase ${await m.evalJs("window.__facadesStore.getState().worldPhase")})` };
        const w2 = await m.waitFor(`(() => { const f = window.__globe.facades(); return f.markers && f.markers.drawn >= 1 && f.resident.length === 1; })()`, 15_000, 200);
        if (!w2.ok) fails.push(`no resident slot (${JSON.stringify(await m.evalJs("(() => { const f = window.__globe.facades(); return { markers: f.markers, resident: f.resident, occupied: f.occupied }; })()"))})`);
        const w3 = await m.waitFor(`(() => { const s = window.__globe.photoProjector(); return s.slots.length === 1 && s.slots[0].textureReady === true && s.slots[0].on === true && !!s.photoArray; })()`, 20_000, 200);
        const s = await m.evalJs("window.__globe.photoProjector()");
        if (!w3.ok) fails.push(`the slot never painted (${JSON.stringify(s.slots.map((x) => ({ id: x.id, on: x.on, tex: x.textureReady, err: x.error })))})`);
        if (s.photoArray) {
          if (s.photoArray.layerPx !== 1024 || s.photoArray.layers !== 2) fails.push(`array ${JSON.stringify(s.photoArray)} (want 1024² × 2)`);
          if (!near(s.photoArray.bytesMB, 11.2, 0.3)) fails.push(`array ${s.photoArray.bytesMB} MB (want ≈ 11.2)`);
        }
        const slot = s.slots[0];
        if (slot && Math.max(...slot.depthSize) > 512) fails.push(`depth map ${slot.depthSize.join("×")} (want ≤ 512)`);
        await m.shot("m2-resident-painted.jpeg");
        return { pass: fails.length === 0, detail: fmtFails(fails, `row ${aheadM} m ahead at ${r2(apexAltM)} m · marker + resident · array ${s.photoArray?.layerPx}² × ${s.photoArray?.layers} = ${s.photoArray?.bytesMB} MB · depth ${slot?.depthSize?.join("×")} · depth renders ${s.depthRendersTotal}`) };
      });
      await runLeg("m3", "F6 the phone's frame cost — ON (one resident) vs OFF (TEX off releases it): p95 within ×1.25 + 2 ms; TEX back on re-paints", async () => {
        const fails = [];
        await sleep(600);
        const on = await m.sampleFrames();
        const r0 = await m.evalJs("window.__globe.photoProjector().depthRendersTotal");
        await sleep(2500);
        const r1 = await m.evalJs("window.__globe.photoProjector().depthRendersTotal");
        await m.evalJs("window.__cameraStore.getState().setTexturesVisible(false), true");
        const rel = await m.waitFor(`window.__globe.facades().resident.length === 0 && window.__globe.photoProjector().slotsOn === 0`, 5000, 100);
        if (!rel.ok) fails.push("TEX off did not release the resident");
        await sleep(600);
        const off = await m.sampleFrames();
        await m.evalJs("window.__cameraStore.getState().setTexturesVisible(true), true");
        const back = await m.waitFor(`window.__globe.facades().resident.length === 1 && window.__globe.photoProjector().slotsOn === 1`, 15_000, 200);
        if (!back.ok) fails.push("TEX on did not re-paint");
        const budget = off.p95 * 1.25 + 2;
        if (!(on.p95 <= budget)) fails.push(`ON p95 ${on.p95} ms > budget ${r2(budget)} (OFF p95 ${off.p95})`);
        const perSec = (r1 - r0) / 2.5;
        if (perSec > 1.2) fails.push(`${r2(perSec)} depth renders / s while idle (the lean cadence is 2 s → ≤ 0.5 + tile churn)`);
        return { pass: fails.length === 0, detail: fmtFails(fails, `ON p50 ${on.p50} / p95 ${on.p95} / max ${on.max} ms · OFF p50 ${off.p50} / p95 ${off.p95} / max ${off.max} ms · budget ${r2(budget)} · idle depth renders ${r2(perSec)}/s`) };
      });
      await runLeg("m4", "F6 a TAP on the marker opens the PEEK (no hover card, no menu) → LOOK FROM HERE jumps the eye to the apex, the peek closes", async () => {
        const fails = [];
        const pt = await m.evalJs(glyphCentreExpr("facades", rowId, 0));
        if (!pt || !pt.inFront) return { pass: false, detail: `no screen point for the marker (${JSON.stringify(pt)})` };
        const cssW = DEV.iphone.width;
        if (pt.x < 0 || pt.x > cssW || pt.y < 0 || pt.y > DEV.iphone.height) return { pass: false, detail: `the marker is off-screen at (${r2(pt.x)}, ${r2(pt.y)})` };
        await m.tap(pt.x, pt.y);
        const pk = await m.waitFor(`window.__facadesStore.getState().peek && window.__facadesStore.getState().peek.id === ${JSON.stringify(rowId)}`, 4000, 50);
        if (!pk.ok) return { pass: false, detail: `the tap at (${r2(pt.x)}, ${r2(pt.y)}) set no peek (scale ${r2(pt.scale)} m; peek ${JSON.stringify(await m.evalJs("window.__facadesStore.getState().peek"))})` };
        const st = await m.evalJs("(() => { const s = window.__facadesStore.getState(); return { hover: s.hover, menu: s.menu, jump: s.peek.jump, dom: !!document.querySelector('[data-facade-peek]'), look: !!document.querySelector('.m-fpeek [data-act=\"look\"]'), hoverCard: !!document.querySelector('[data-facade-hover]'), fmenu: !!document.querySelector('.fmenu') }; })()");
        if (st.hover !== null || st.menu !== null || st.hoverCard || st.fmenu) fails.push(`a desktop surface leaked: ${JSON.stringify({ hover: st.hover, menu: st.menu, hoverCard: st.hoverCard, fmenu: st.fmenu })}`);
        if (!st.dom || !st.look) fails.push("the peek row / its LOOK button is not in the DOM");
        if (!rowPose || !near(st.jump.latDeg, rowPose.lat, 1e-6) || !near(st.jump.lonDeg, rowPose.lon, 1e-6)) fails.push(`the peek's jump ${JSON.stringify(st.jump)} is not at the row`);
        await m.shot("m4-tap-peek.jpeg");
        const eyeBefore = await m.camPos();
        await m.evalJs(`document.querySelector('.m-fpeek [data-act="look"]').click(), true`);
        const gone = await m.waitFor(`window.__facadesStore.getState().peek === null`, 3000, 50);
        if (!gone.ok) fails.push("LOOK did not close the peek");
        await m.settleCamera(15_000);
        const apex = await m.evalJs(`window.__globe.facades().apexOf(${JSON.stringify(rowId)})`);
        const eyeAfter = await m.camPos();
        const dApex = apex ? m.dist3(eyeAfter, apex) : NaN;
        if (!(m.dist3(eyeBefore, eyeAfter) > AHEAD_M * 0.6)) fails.push(`the eye moved only ${r2(m.dist3(eyeBefore, eyeAfter))} m (the row stands ${AHEAD_M} m ahead)`);
        // The FPV clearance may step the eye clear of a building face the apex sits against (the
        // owner's street apexes are free; a synthetic one may not be) — a short step is allowed.
        if (!(dApex < 6)) fails.push(`the eye stands ${r2(dApex)} m from the apex after LOOK (want < 6 — the clearance step)`);
        const fpv = await m.evalJs("window.__globe.fpv()");
        if (fpv.active !== true) fails.push("FPV was left");
        await m.shot("m4-look-from-here.jpeg");
        return { pass: fails.length === 0, detail: fmtFails(fails, `tap → peek (no hover / menu) · LOOK → ${r2(dApex)} m from the apex, fov ${r2(fpv.fovDeg)}, FPV kept`) };
      });
      await runLeg("m6", "T189 the /m MY LOC cell is an icon-only round cell carrying the pin glyph (the words in aria-label)", async () => {
        const fails = [];
        await m.evalJs(`window.__cameraStore.getState().setTempPin(null), true`); // the cell hides inside FPV (tempFpv)
        await m.waitFor(`window.__globe.fpv().active === false`, 8000, 200);
        const c = await m.waitFor(`!!document.querySelector(".m-act--myloc")`, 8000, 100);
        if (!c.ok) return { pass: false, detail: "no .m-act--myloc cell outside FPV" };
        const cell = await m.evalJs(`(() => { const b = document.querySelector(".m-act--myloc"); const r = b.getBoundingClientRect(); const p = b.querySelector("svg path"); return { text: b.textContent.trim(), label: b.getAttribute("aria-label"), icon: b.classList.contains("m-act--icon"), w: r.width, h: r.height, d: p ? p.getAttribute("d") : null, radius: getComputedStyle(b).borderRadius }; })()`);
        if (cell.text !== "") fails.push(`the cell still carries text "${cell.text}"`);
        if (!/location/i.test(cell.label ?? "")) fails.push(`aria-label "${cell.label}"`);
        if (!cell.icon) fails.push("not an .m-act--icon round cell");
        if (!/^M12 2\.5a6\.5 6\.5/.test(cell.d ?? "")) fails.push(`glyph path "${(cell.d ?? "").slice(0, 24)}…"`);
        if (!(cell.w >= 40 && cell.h >= 40)) fails.push(`cell ${r2(cell.w)}×${r2(cell.h)} px (want ≥ 40 — a touch target)`);
        await m.shot("m6-my-loc-cell.jpeg");
        return { pass: fails.length === 0, detail: fmtFails(fails, `icon-only ${r2(cell.w)}×${r2(cell.h)} · "${cell.label}" · the pin path`) };
      });
      await runLeg("m5", "T191 the LAYERS cell opens a modal GRID of six icon cells; the chip stack does not move; TEXTURES toggles the store; the scrim closes it", async () => {
        const fails = [];
        // The owner's complaint was the OTHER cells shifting — measure every sibling cell's rect (the
        // LAYERS cell itself may change its own border / lit state), not the rail's bounding box.
        // The compass / altitude READOUT (`.m-nav`) re-flows with its digits while the camera moves — settle
        // first and leave it out: the ask is about the ACTION cells.
        await m.settleCamera(12_000);
        const cellsExpr = `[...document.querySelectorAll(".m-actions .m-act:not(.m-act--layers):not(.m-nav)")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; })`;
        const before = await m.evalJs(`(() => { const a = document.querySelector(".m-actions"); const r = a.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cells: a.querySelectorAll(".m-act").length, row: !!document.querySelector(".m-layersrow"), siblings: ${cellsExpr} }; })()`);
        if (before.row) fails.push("the old .m-layersrow is still in the DOM");
        const anchor = await m.evalJs(`(() => { const b = document.querySelector(".m-act--layers"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, expanded: b.getAttribute("aria-expanded") }; })()`);
        if (!anchor) return { pass: false, detail: "no .m-act--layers cell" };
        await m.tap(anchor.x, anchor.y);
        const open = await m.waitFor(`!!document.querySelector("[data-layers-modal]")`, 3000, 50);
        if (!open.ok) return { pass: false, detail: "the tap on LAYERS opened no modal" };
        const grid = await m.evalJs(`(() => { const cells = [...document.querySelectorAll(".m-layers__cell")]; const panel = document.querySelector(".m-layers__panel").getBoundingClientRect(); const a = document.querySelector(".m-actions").getBoundingClientRect();
          return { n: cells.length, keys: cells.map((c) => c.dataset.layer), on: cells.filter((c) => c.classList.contains("is-on")).map((c) => c.dataset.layer), disabled: cells.filter((c) => c.disabled).map((c) => c.dataset.layer), panel: { x: panel.x, y: panel.y, w: panel.width, h: panel.height }, actions: { x: a.x, y: a.y, w: a.width, h: a.height }, siblings: ${cellsExpr}, blur: getComputedStyle(document.querySelector(".m-layers__panel")).backdropFilter }; })()`);
        if (grid.n !== 6) fails.push(`${grid.n} cells (want 6)`);
        if (grid.keys.join("/") !== "buildings3d/places/pins/radar/vectors/textures") fails.push(`cells ${grid.keys.join("/")}`);
        if (!grid.on.includes("textures")) fails.push(`TEXTURES is not lit while the store says on (lit: ${grid.on.join(",")})`);
        // The /m shell stands in 2D after leaving FPV (U1) — 3D DETAIL stands down there, nothing else.
        const mode2d = await m.evalJs(`window.__cameraStore.getState().mapMode === "2d"`);
        if (grid.disabled.join(",") !== (mode2d ? "buildings3d" : "")) fails.push(`disabled ${JSON.stringify(grid.disabled)} in ${mode2d ? "2D" : "3D"}`);
        if (JSON.stringify(grid.siblings) !== JSON.stringify(before.siblings)) fails.push(`the other cells moved: ${JSON.stringify(before.siblings)} → ${JSON.stringify(grid.siblings)}`);
        if (!/blur/.test(grid.blur ?? "")) fails.push(`the panel has no backdrop blur (${grid.blur})`);
        if (!(grid.panel.w > 150 && grid.panel.h > 100 && grid.panel.y + grid.panel.h <= DEV.iphone.height)) fails.push(`the panel sits at ${JSON.stringify(grid.panel)}`);
        await m.shot("m5-layers-modal.jpeg");
        await m.evalJs(`document.querySelector('.m-layers__cell[data-layer="textures"]').click(), true`);
        const off = await m.waitFor(`window.__cameraStore.getState().texturesVisible === false && !document.querySelector('.m-layers__cell[data-layer="textures"]').classList.contains("is-on")`, 2000, 50);
        if (!off.ok) fails.push("the TEXTURES cell did not write the store / unlight");
        await m.evalJs(`document.querySelector('.m-layers__cell[data-layer="textures"]').click(), true`);
        await m.waitFor(`window.__cameraStore.getState().texturesVisible === true`, 2000, 50);
        // The scrim covers the LAYERS cell too — a tap "on the cell" closes.
        await m.tap(anchor.x, anchor.y);
        const closed = await m.waitFor(`!document.querySelector("[data-layers-modal]")`, 3000, 50);
        if (!closed.ok) fails.push("a tap on the scrim (over the LAYERS cell) did not close the modal");
        const reopened = await m.evalJs(`!!document.querySelector("[data-layers-modal]")`);
        if (reopened) fails.push("the modal re-opened on the ghost click");
        return { pass: fails.length === 0, detail: fmtFails(fails, `6 cells (${grid.keys.join("/")}) · lit ${grid.on.join(",")} · the ${before.siblings.length} other cells held (rail ${r2(before.w)} → ${r2(grid.actions.w)} px) · TEXTURES toggles · the scrim closes`) };
      });
      await runLeg("m7", "F6 the /m 2D map: the residents RELEASE (no paint against detached buildings) while the markers stay; 3D paints again", async () => {
        const fails = [];
        await m.evalJs("window.__cameraStore.getState().setMapMode('2d'), true");
        const rel = await m.waitFor(`window.__globe.facades().resident.length === 0 && window.__globe.photoProjector().slotsOn === 0`, 8000, 100);
        if (!rel.ok) fails.push(`2D did not release the residents (${JSON.stringify(await m.evalJs("(() => { const f = window.__globe.facades(); return { resident: f.resident, slotsOn: window.__globe.photoProjector().slotsOn }; })()"))})`);
        const mk = await m.evalJs("window.__globe.facades().markers");
        if (!mk || mk.total < 1) fails.push(`the markers went with the residents (${JSON.stringify(mk)})`);
        await m.shot("m7-2d-released.jpeg");
        await m.evalJs("window.__cameraStore.getState().setMapMode('3d'), true");
        // The 2D map leaves the orbit camera wherever the map stood — stand 80 m off the apex looking
        // at it (the residency needs the painted volume IN VIEW and in range; the product's own entry
        // is a tap / a walk, not a map toggle).
        await m.evalJs(`(() => { const g = window.__globe; const a = g.facades().apexOf(${JSON.stringify(rowId)}); if (!a) return false; const V = g.camera.up.constructor; const apex = new V(a[0], a[1], a[2]);
          const away = new V().subVectors(g.camera.position, apex).normalize(); const up = apex.clone().normalize(); const pos = apex.clone().addScaledVector(away, 70).addScaledVector(up, 30);
          g.flight.start({ position: pos, lookAt: apex }); return true; })()`);
        const back = await m.waitFor(`window.__globe.facades().resident.length === 1`, 25_000, 200);
        if (!back.ok) fails.push(`3D did not re-plan the resident (${JSON.stringify(await m.evalJs("(() => { const f = window.__globe.facades(); return { markers: f.markers, resident: f.resident, world: f.world, tex: f.texturesOn }; })()"))})`);
        return { pass: fails.length === 0, detail: fmtFails(fails, `2D → released (markers ${JSON.stringify(mk)}) · 3D → resident again`) };
      });
      await runLeg("m8", "phone teardown — fetch restored, the world cleared, no GL noise, no exceptions", async () => {
        const fails = [];
        await m.evalJs(`(() => { if (window.__oa23Fetch) { window.fetch = window.__oa23Fetch; window.__oa23Fetch = null; } window.__facadesStore.setState({ world: [], peek: null, hover: null, menu: null }); return true; })()`);
        if (m.glNoise.length) fails.push(`GL noise ×${m.glNoise.length}: ${m.glNoise[0]}`);
        const real = m.consoleErrors.filter((e) => !/favicon|404|Failed to load resource|net::ERR|cesium|ion\.|401|403/i.test(e));
        if (real.length) fails.push(`console errors ×${real.length}: ${real[0]}`);
        return { pass: fails.length === 0, detail: fmtFails(fails, `clean (${m.consoleErrors.length} ignorable console lines)`) };
      });
    }
  } finally {
    m.close();
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} legs pass · shots ${SHOTS}/`);
await finishVerify(passed === results.length ? 0 : 1);
