// Scripted-Chrome verification of F4 (T170 — the photo ARRAY texture, K 6) + F5 (T172 — the
// alignment hook: `targetFeatureIds` read back at save) + T186 (opening a saved row inside FPV
// jumps the walker to the apex), 2026-10-22. The CDP boilerplate is the owner-asks harness's; the
// T186 leg feeds a SYNTHETIC saved row through the store's own world / mine reads with an in-page
// fetch stub (dev cannot elevate — T173; a row poked straight into the store is wiped by the 401).
//
//   1 boot (the globe + the DEV seams) · 2 the split dropzone → the facade overlay → review → placed ·
//   3 F4 the draft lives in layer 0 of the 2048² × 6 array (134 MB), decoded size kept, no GL noise ·
//   4 F5 the probe names the buildings the photo paints (`osm:w…` / the override key; unique) ·
//   5 T186 a saved row opened INSIDE FPV jumps the eye to its apex, facing down its forward, at its
//     H-FOV · 6 teardown + a clean console.
//
// Usage: node scripts/verify-f4-f5-2026-10-22.mjs    (env FTW_CDP_PORT, FTW_F45_URL)
// Needs `wix dev` on http://localhost:4321. Shots → verify-shots/f4-f5-2026-10-22/.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.env.FTW_CDP_PORT ?? 9333);
const URL = process.env.FTW_F45_URL ?? "http://localhost:4321/#p=48.4647,35.0462,1500,25,55.0&t=1788701556919";
const SHOTS = "verify-shots/f4-f5-2026-10-22";
const FIXTURE = resolve("test/fixtures/facade-pattern.jpg");
const FIXTURE_URL = `http://localhost:4321/@fs${FIXTURE}`;
const FIX = { heading: 25, w: 1600, h: 1200, hFovDeg: 69.39 };
const FLIGHT_SETTLE_MS = 3500;
const D2R = Math.PI / 180;
mkdirSync(SHOTS, { recursive: true });

const http = (path, method = "GET") => fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(s.data, "base64"));
};
const ticks = (n) => evalJs(`new Promise((r) => { let k = ${n}; const f = () => (--k <= 0 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); })`);
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
const near = (a, b, eps) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps;
const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const FS = "window.__facadeStore.getState()";
const MS = "window.__facadesStore.getState()";
const CS = "window.__cameraStore.getState()";
const SNAP = "window.__globe.photoProjector()";
const snapshot = () => evalJs(SNAP);
const camPos = () => evalJs("(() => { const p = window.__globe.camera.position; return [p.x, p.y, p.z]; })()");
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const stateOf = () => evalJs(`(() => { const s = ${FS}; return { phase: s.phase, placement: s.placement, hFovDeg: s.hFovDeg ?? null, apexAltM: s.apexAltM ?? null, previewUrl: s.previewUrl ?? null }; })()`);
/** The draft's frustum: apex + forward (ECEF arrays) — what the projector and the T186 jump share. */
const frustumNow = () => evalJs(`(() => { const g = window.__globe.facadeFrustum.current(); return g ? { apex: [...g.apex], forward: [...g.forward] } : null; })()`);
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
const fmtFails = (fails, ok) => (fails.length ? fails.join(" · ") : ok);
const OSM_KEY = /^osm:[nwr]\d{1,16}$/;
const OVERRIDE_KEY = /^[^|]+\|[^|]+\|\d+$/;

console.log(`page ${URL} · CDP :${PORT} · fixture ${FIXTURE}`);
let aborted = null;
const rowId = "harness-f45-row";
try {
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.bringToFront");
  await send("Page.navigate", { url: URL });

  // ═══ 1 · BOOT ═════════════════════════════════════════════════════════════════════════════════
  const bootOk = await runLeg(1, "boot — the globe + the DEV seams (photoProjector, facadeTargets, facadeFrustum)", async () => {
    const w = await waitFor(`!!window.__globe && !!window.__globe.photoProjector && typeof window.__globe.facadeTargets === "function" && !!window.__globe.facadeFrustum && !!window.__facadesStore && !!window.__cameraStore`, 90_000, 500);
    if (!w.ok) return { pass: false, detail: "the globe / the seams never arrived" };
    await sleep(2500);
    const s = await snapshot();
    if (!s || typeof s !== "object") return { pass: false, detail: "photoProjector() null — the desktop attach gate refused" };
    const fails = [];
    if (s.capacity !== 6) fails.push(`capacity ${s.capacity} (want 6 — PHOTO_PROJECT.slots)`);
    if (s.photoArray !== null) fails.push(`the photo array is allocated before any load (${JSON.stringify(s.photoArray)}) — it must be lazy`);
    const t = await evalJs(`window.__globe.facadeTargets()`);
    if (t !== null) fails.push(`facadeTargets() with nothing placed = ${JSON.stringify(t)} (want null)`);
    await shot("01-boot.jpeg");
    return { pass: fails.length === 0, detail: fmtFails(fails, `capacity 6 · the array is lazy · facadeTargets() null while idle`) };
  });
  if (!bootOk) aborted = "boot failed";

  // ═══ 2 · THE SPLIT DROPZONE → PLACED ══════════════════════════════════════════════════════════
  const placedOk = aborted ? false : await runLeg(2, "Upload → the facade half → review → placed (the draft slot on)", async () => {
    const fails = [];
    await evalJs(`document.querySelector("[data-open-upload]")?.click(), true`);
    const halves = await waitFor(`!!document.querySelector(".uf-dropzone--facade input[type=file]")`, 8000, 120);
    if (!halves.ok) return { pass: false, detail: "the facade half never rendered" };
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".uf-dropzone--facade input[type=file]" });
    if (!nodeId) return { pass: false, detail: "DOM.querySelector found no facade file input node" };
    await send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
    const rv = await waitFor(`${FS}.phase === "review"`, 15_000, 200);
    if (!rv.ok) return { pass: false, detail: `phase never reached review (${await evalJs(`${FS}.phase`)})` };
    await evalJs(`${FS}.place(), true`);
    const w = await waitFor(`${FS}.phase === "placed" && ${FS}.open === false`, 5000, 100);
    if (!w.ok) return { pass: false, detail: "place() did not reach placed/closed" };
    await sleep(FLIGHT_SETTLE_MS);
    const sw = await waitFor(`(() => { const s = ${SNAP}; return !!s && s.on === true && s.textureReady === true && s.depthRenders >= 1; })()`, 10_000, 100);
    const s = await snapshot();
    if (!sw.ok) fails.push(`the draft slot never went on (${JSON.stringify({ on: s?.on, tex: s?.textureReady, depth: s?.depthRenders, err: s?.error })})`);
    await shot("02-placed.jpeg");
    return { pass: fails.length === 0, detail: fmtFails(fails, `review → placed · draft on, depth ×${s?.depthRenders}`) };
  });
  if (!placedOk) aborted = aborted ?? "the facade never placed";

  // ═══ 3 · F4 THE PHOTO ARRAY ═══════════════════════════════════════════════════════════════════
  if (!aborted) await runLeg(3, "F4 (T170) the draft lives in layer 0 of ONE 2048² × 6 array (134 MB); the decoded size is kept; no GL noise", async () => {
    const fails = [];
    await ticks(30);
    const s = await snapshot();
    const pa = s.photoArray;
    if (!pa) fails.push("photoArray null after a load — the array never allocated");
    else {
      if (pa.layerPx !== 2048) fails.push(`layerPx ${pa.layerPx} (want 2048)`);
      if (pa.layers !== 6) fails.push(`layers ${pa.layers} (want 6)`);
      if (!near(pa.bytesMB, 134.2, 0.5)) fails.push(`bytesMB ${pa.bytesMB} (want ≈ 134.2 — 2048² × 4 B × 4/3 × 6)`);
    }
    const draft = (s.slots ?? [])[0];
    if (!draft || draft.id !== "draft") fails.push(`the first feed slot is ${JSON.stringify(draft?.id)} (want the draft)`);
    else {
      if (draft.layer !== 0) fails.push(`the draft's layer is ${draft.layer} (want 0 — its pool index)`);
      if (!draft.textureReady || !draft.on) fails.push(`draft textureReady ${draft.textureReady} on ${draft.on}`);
    }
    if (JSON.stringify(s.textureSize) !== JSON.stringify([FIX.w, FIX.h])) fails.push(`textureSize ${JSON.stringify(s.textureSize)} (want the DECODED ${FIX.w}×${FIX.h}, not the stretched layer)`);
    if (s.flipV !== 1) fails.push(`flipV ${s.flipV} (the 2026-10-18 contract: 1 for a bitmap source)`);
    // The painted city: the fragment compiled with the sampler2DArray — a compile error would have
    // surfaced as GL noise on the console (three logs shader errors) and the slot would stay dark.
    if (glNoise.length) fails.push(`GL noise: ${glNoise.slice(0, 3).join(" | ")}`);
    // A second, DIFFERENT photo would take layer 1 only through a saved slot (the pool index) —
    // covered by the unit twin; here the pool's layers are the indices by construction.
    const layers = (s.slots ?? []).map((x) => x.layer);
    await shot("03-f4-array.jpeg");
    return { pass: fails.length === 0, detail: fmtFails(fails, `array ${pa?.layerPx}² × ${pa?.layers} = ${pa?.bytesMB} MB · draft layer ${draft?.layer} on · decoded ${s.textureSize?.join("×")} · slots' layers ${JSON.stringify(layers)} · GL quiet`) };
  });

  // ═══ 4 · F5 THE TARGET PROBE ══════════════════════════════════════════════════════════════════
  let targets = null;
  if (!aborted) await runLeg(4, "F5 (T172) facadeTargets() names the buildings the photo paints — stable keys, unique, within the server's caps", async () => {
    const fails = [];
    // Let the building tiles under the pose stream in (the probe reads what is loaded NOW).
    const wt = await waitFor(`(() => { const t = window.__globe.facadeTargets(); return Array.isArray(t) && t.length > 0 ? t : null; })()`, 20_000, 500);
    targets = wt.ok ? wt.value : await evalJs(`window.__globe.facadeTargets()`);
    if (!Array.isArray(targets)) return { pass: false, detail: `facadeTargets() = ${JSON.stringify(targets)} (want an array while placed)` };
    if (targets.length === 0) fails.push("no building under any of the 35 rays (the fixture pose faces the Dnipro blocks — tiles not loaded?)");
    const bad = targets.filter((t) => !(OSM_KEY.test(t) || OVERRIDE_KEY.test(t)));
    if (bad.length) fails.push(`ids off the contract: ${JSON.stringify(bad.slice(0, 3))}`);
    if (new Set(targets).size !== targets.length) fails.push("duplicate ids");
    if (targets.length > 200) fails.push(`${targets.length} ids (the cap is 200)`);
    if (targets.some((t) => t.length > 80)) fails.push("an id longer than 80 chars");
    // Stable across two reads of the same pose (no per-frame churn in the ids themselves).
    const again = await evalJs(`window.__globe.facadeTargets()`);
    if (JSON.stringify(again) !== JSON.stringify(targets)) fails.push(`two reads differ: ${targets.length} vs ${again?.length}`);
    const osm = targets.filter((t) => OSM_KEY.test(t)).length;
    return { pass: fails.length === 0, detail: fmtFails(fails, `${targets.length} buildings (${osm} osm keys, ${targets.length - osm} override keys): ${JSON.stringify(targets.slice(0, 4))}…`) };
  });

  // ═══ 5 · T186 OPEN A SAVED ROW INSIDE FPV → THE WALKER JUMPS TO THE APEX ══════════════════════
  if (!aborted) await runLeg(5, "T186 a saved row opened INSIDE FPV jumps the eye to its apex, facing its forward, at its H-FOV", async () => {
    const fails = [];
    const st = await stateOf();
    const f0 = await frustumNow();
    if (!st.placement || !f0) return { pass: false, detail: "no placement / frustum to build the row from" };
    // The synthetic saved row AT the draft's pose, its texture the fixture served by the dev server
    // (not the draft's blob — `clear()` revokes that). Served to the store's own reads by a fetch stub.
    await evalJs(`(() => { const s = ${FS}; const row = { id: ${JSON.stringify(rowId)}, title: "harness f45 row", displayUrl: ${JSON.stringify(FIXTURE_URL)}, thumbUrl: null, updatedAt: new Date().toISOString(),
      lat: s.placement.latDeg, lon: s.placement.lonDeg, apexAltM: s.apexAltM, altitudeM: 1.7, headingDeg: ${FIX.heading}, pitchDeg: 0, rollDeg: 0, focalLengthMm: 26, hFovDeg: ${FIX.hFovDeg}, fovEstimated: false,
      textureWidth: ${FIX.w}, textureHeight: ${FIX.h}, strength: 1, ownLight: 0.6, rangeM: null };
      const mine = { ...row, targetFeatureIds: ${JSON.stringify(targets ?? [])}, alignment: {}, capturedAt: null, cameraMake: null, cameraModel: null, lensModel: null, fileName: "harness.jpg", fileSizeBytes: 1000, poseSource: "exif", exifPose: null, createdAt: row.updatedAt, isPublic: false, moderation: "none" };
      window.__f45Rows = { world: [row], mine: [mine] };
      if (!window.__f45Fetch) {
        window.__f45Fetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const u = typeof input === "string" ? input : input.url;
          const m = (init && init.method) || "GET";
          if (u.startsWith("/api/facades") && m === "GET") {
            const body = u.includes("cells=") ? { facades: window.__f45Rows.world, complete: true } : { facades: window.__f45Rows.mine, hasNext: false };
            return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
          }
          return window.__f45Fetch(input, init);
        };
      }
      window.__memberStore.setState({ phase: "member" });
      ${MS}.refresh();
      ${MS}.loadMine && ${MS}.loadMine();
      return true; })()`);
    const w0 = await waitFor(`${MS}.mine.length === 1`, 8000, 100);
    if (!w0.ok) return { pass: false, detail: `the mine row never landed (mine ${await evalJs(`${MS}.mine.length`)}, world ${await evalJs(`${MS}.world.length`)})` };
    // Drop the draft, then stand in FPV 12 m SOUTH of the apex looking NORTH (nowhere near the pose's
    // heading 25°) — the walker's own place before the open.
    await evalJs(`${FS}.clear(), true`);
    await evalJs(`${CS}.requestFpvJump({ latDeg: ${st.placement.latDeg - 12 / 111_320}, lonDeg: ${st.placement.lonDeg}, eyeM: 1.7, headingDeg: 0, pitchDeg: 0, fovDeg: 60 }), true`);
    const wf = await waitFor(`window.__globe.fpv().active === true`, 15_000, 200);
    if (!wf.ok) return { pass: false, detail: "FPV never activated from requestFpvJump" };
    await settleCamera();
    const eyeBefore = await camPos();
    const dBefore = dist3(eyeBefore, f0.apex);
    await shot("05a-fpv-before-open.jpeg");
    // OPEN the saved row from inside FPV (the marker menu's EDIT / MY CONTENT's OPEN call this).
    await evalJs(`(() => { const item = ${MS}.mine.find((m) => m.id === ${JSON.stringify(rowId)}); ${FS}.openSaved(item); return true; })()`);
    const wp = await waitFor(`${FS}.phase === "placed"`, 8000, 100);
    if (!wp.ok) return { pass: false, detail: "openSaved did not reach placed" };
    await sleep(2500);
    const eyeAfter = await settleCamera(12_000);
    const f1 = await frustumNow();
    const dAfter = f1 ? dist3(eyeAfter, f1.apex) : NaN;
    const fpv = await evalJs(`(() => { const f = window.__globe.fpv(); const c = window.__globe.camera; const V = c.up.constructor; const d = c.getWorldDirection(new V()); return { active: f.active, dir: [d.x, d.y, d.z], fov: c.fov, aspect: c.aspect }; })()`);
    const cosFwd = f1 ? fpv.dir[0] * f1.forward[0] + fpv.dir[1] * f1.forward[1] + fpv.dir[2] * f1.forward[2] : NaN;
    const wantFov = (2 * Math.atan(Math.tan((FIX.hFovDeg * D2R) / 2) / fpv.aspect)) / D2R;
    if (fpv.active !== true) fails.push("FPV was left (the orbit flight fired — the T176 snap)");
    if (!(dBefore > 8)) fails.push(`the eye stood only ${r2(dBefore)} m from the apex BEFORE the open (the test needs a real jump)`);
    if (!(dAfter < 2.5)) fails.push(`the eye is ${r2(dAfter)} m from the apex AFTER the open (want < 2.5 — the My spot jump to the apex)`);
    if (!(cosFwd > Math.cos(3 * D2R))) fails.push(`the eye faces ${r2(Math.acos(Math.min(1, cosFwd)) / D2R)}° off the photo's forward (want < 3°)`);
    if (!near(fpv.fov, wantFov, 2)) fails.push(`camera.fov ${r2(fpv.fov)} (want ≈ ${r2(wantFov)} — the photo's H-FOV ${FIX.hFovDeg}° at aspect ${r2(fpv.aspect)})`);
    const s = await snapshot();
    if (!s.on) fails.push(`the re-opened row's draft slot is not on (${JSON.stringify({ tex: s.textureReady, depth: s.depthRenders, err: s.error })})`);
    await shot("05b-fpv-at-the-apex.jpeg");
    return { pass: fails.length === 0, detail: fmtFails(fails, `before ${r2(dBefore)} m off → after ${r2(dAfter)} m from the apex · ${r2(Math.acos(Math.min(1, cosFwd)) / D2R)}° off forward · fov ${r2(fpv.fov)} (want ${r2(wantFov)}) · FPV kept · slot on`) };
  });

  // ═══ 6 · TEARDOWN + A CLEAN CONSOLE ═══════════════════════════════════════════════════════════
  await runLeg(6, "teardown (fetch restored, member anonymous, FPV left) + no GL noise, no exceptions", async () => {
    const fails = [];
    await evalJs(`${FS}.clear(), true`);
    await evalJs(`(() => { if (window.__f45Fetch) { window.fetch = window.__f45Fetch; window.__f45Fetch = null; } window.__memberStore.setState({ phase: "anonymous" }); window.__facadesStore.setState({ world: [], mine: [], editingId: null, hover: null, menu: null }); return true; })()`);
    await evalJs(`${CS}.setTempPin(null), true`);
    await waitFor(`window.__globe.fpv().active === false`, 8000, 200);
    const t = await evalJs(`window.__globe.facadeTargets()`);
    if (t !== null) fails.push(`facadeTargets() after clear = ${JSON.stringify(t)} (want null)`);
    if (glNoise.length) fails.push(`GL noise: ${glNoise.slice(0, 3).join(" | ")}`);
    const real = consoleErrors.filter((e) => !/favicon|404|WDE0027|LIST_FAILED|502|Failed to load resource|net::ERR/i.test(e));
    if (real.length) fails.push(`console errors: ${real.slice(0, 3).join(" | ")}`);
    return { pass: fails.length === 0, detail: fmtFails(fails, `restored · console clean (${consoleErrors.length} filtered dev-elevation / asset lines)`) };
  });
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} legs passed${aborted ? ` (aborted: ${aborted})` : ""} · shots ${SHOTS}/`);
  writeFileSync(`${SHOTS}/results.json`, JSON.stringify({ url: URL, aborted, results }, null, 2));
  ws.close();
  await finishVerify(passed === results.length && !aborted ? 0 : 1);
}
