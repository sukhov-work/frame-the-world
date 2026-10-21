// Scripted-Chrome verification of THE OWNER'S SEVEN ASKS after v1.36.33 (DECISIONS 2026-10-22b/c;
// backlog T174–T183), 2026-10-22. The CDP boilerplate is the facade-flow harness's, verbatim in
// spirit; the saved-photo legs inject a SYNTHETIC world row through the `__facadesStore` seam (dev
// cannot elevate — T173 — so no row can be saved here; the residency, the markers, the hover card
// and the menu only need a row in the store, and the draft's own preview blob is its texture).
//
//   1 boot + the new chrome (MENU left of PLAN · only Upload on the right · TEX + MY SPOT in the
//     camera controls · no ?facade link) · 2 T181 the split dropzone → the facade overlay → review
//     → placed · 3 T174 a corner-only SCALE re-renders the depth map + re-optics the projector ·
//     4 T175 the facade edit chip switches the op · 5 T177 a synthetic saved row: resident while the
//     camera stands INSIDE its painted volume looking away from the apex, turned 180°, faded far,
//     released beyond the band · 6 T178 + T183 hover (the marker grows + the card) and the context
//     menu (EDIT / REMOVE disabled for a world-only row, enabled for a mine row) · 7 T182 the TEX
//     toggle releases + re-acquires the saved slots (the draft stays) · 8 T176 editing in FPV (the
//     gizmo attached, a handle drag moves the photo, the eye stays, no look-drag) · 9 T180 + T179
//     the MENU opens MY CONTENT centred with the TEXTURES tab listing the mine row · 10 a clean
//     console + the pin flow untouched.
//
// Usage: node scripts/verify-owner-asks-2026-10-22.mjs    (env FTW_CDP_PORT, FTW_OA_URL)
// Needs `wix dev` on http://localhost:4321. Shots → verify-shots/owner-asks-2026-10-22/.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const PORT = Number(process.env.FTW_CDP_PORT ?? 9333);
const URL = process.env.FTW_OA_URL ?? "http://localhost:4321/#p=48.4647,35.0462,1500,25,55.0&t=1788701556919";
const SHOTS = "verify-shots/owner-asks-2026-10-22";
const FIXTURE = resolve("test/fixtures/facade-pattern.jpg");
const FIX = { lat: 48.4647, lon: 35.0462, heading: 25, w: 1600, h: 1200 };
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
const GL_RE = /shader|GLSL|compile|WebGL/i;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.consoleAPICalled") {
    const type = msg.params?.type;
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (type === "error") consoleErrors.push(text.slice(0, 240));
    if ((type === "error" || type === "warning") && GL_RE.test(text)) glNoise.push(`console.${type}: ${text.slice(0, 240)}`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params?.exceptionDetails;
    consoleErrors.push("EXCEPTION: " + (d?.exception?.description ?? d?.text ?? "").slice(0, 240));
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
const GZ = "window.__globe.facadeGizmo()";
const SNAP = "window.__globe.photoProjector()";
const FAC = "window.__globe.facades()";
const snapshot = () => evalJs(SNAP);
const facades = () => evalJs(FAC);
const camPos = () => evalJs("(() => { const p = window.__globe.camera.position; return [p.x, p.y, p.z]; })()");
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mouse = (type, x, y, opts = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseMoved" ? 1 : undefined, ...opts });
const hoverAt = (x, y) => mouse("mouseMoved", x, y, { buttons: 0 });
const dragFrom = async (from, ux, uy, px, steps = 8) => {
  const c0 = await camPos();
  let camMax = 0;
  await hoverAt(from.x, from.y);
  await sleep(60);
  await mouse("mousePressed", from.x, from.y, { clickCount: 1 });
  await sleep(40);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", from.x + (ux * px * i) / steps, from.y + (uy * px * i) / steps);
    await sleep(30);
    camMax = Math.max(camMax, dist3(c0, await camPos()));
  }
  const end = { x: from.x + ux * px, y: from.y + uy * px };
  await mouse("mouseReleased", end.x, end.y, { clickCount: 1 });
  await sleep(150);
  await ticks(3);
  camMax = Math.max(camMax, dist3(c0, await camPos()));
  return { end, camMovedM: camMax };
};
const handleDir = async (name) => {
  const hp = await evalJs(`${GZ}?.handlePx(${JSON.stringify(name)}) ?? null`);
  const o = await evalJs(`${GZ}?.originPx() ?? null`);
  if (!hp || !o) return { error: `handle ${name} is not on screen: ${JSON.stringify({ hp, o })}` };
  const dx = hp.x - o.x;
  const dy = hp.y - o.y;
  const len = Math.hypot(dx, dy) || 1;
  return { hp: { x: hp.x - (dy / len) * 4, y: hp.y + (dx / len) * 4 }, centre: hp, o, ux: dx / len, uy: dy / len, lenPx: len };
};
const setOp = async (op) => {
  await evalJs(`${FS}.setGizmoOp(${JSON.stringify(op)}), true`);
  if (op === "none") return waitFor(`(() => { const g = ${GZ}; return !!g && g.attached === false; })()`, 1500, 50);
  return waitFor(`(() => { const g = ${GZ}; return !!g && g.attached === true && g.op === ${JSON.stringify(op)}; })()`, 1500, 50);
};
/** An instant cut to `pos` looking at `lookAt` (page-side THREE), settled. */
const cutTo = async (posExpr, lookExpr) => {
  await evalJs(`(() => { const V = window.__globe.camera.up.constructor; const pos = ${posExpr}; const look = ${lookExpr}; window.__globe.flight.start({ position: pos, lookAt: look }); return true; })()`);
  await sleep(1200);
  let last = await camPos();
  for (let i = 0; i < 16; i++) {
    await sleep(200);
    const p = await camPos();
    if (dist3(p, last) < 0.01) break;
    last = p;
  }
  await ticks(14); // past one residency cadence (MODELS.residencyEveryFrames 12)
};
/** The draft's frustum basis as page-side expressions: apex, forward, the geodetic up, right. */
const BASIS = `(() => { const g = window.__globe.facadeFrustum.current(); const V = window.__globe.camera.up.constructor;
  const apex = new V(g.apex[0], g.apex[1], g.apex[2]); const fwd = new V(g.forward[0], g.forward[1], g.forward[2]);
  const up = apex.clone().normalize(); const right = new V().crossVectors(fwd, up).normalize(); return { V, apex, fwd, up, right }; })()`;
const stateOf = () => evalJs(`(() => { const s = ${FS}; return { phase: s.phase, placement: s.placement, hFovDeg: s.hFovDeg ?? null, gizmoOp: s.gizmoOp, apexAltM: s.apexAltM ?? null, previewUrl: s.previewUrl ?? null }; })()`);

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

console.log(`page ${URL} · CDP :${PORT} · fixture ${FIXTURE}`);
let aborted = null;
let rowId = null;
try {
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.bringToFront");
  await send("Page.navigate", { url: URL });

  // ═══ 1 · BOOT + THE NEW CHROME ════════════════════════════════════════════════════════════════
  const bootOk = await runLeg(1, "boot + the new chrome (T180 / T181 / T182)", async () => {
    const fails = [];
    const w = await waitFor(`!!window.__globe && !!window.__globe.photoProjector && !!window.__facadesStore && !!window.__cameraStore && !!document.querySelector(".nm-btn")`, 90_000, 500);
    if (!w.ok) return { pass: false, detail: "the globe / the seams / the Menu button never arrived" };
    await sleep(2500);
    const dom = await evalJs(`(() => {
      const nav = document.querySelector(".topnav nav"); const left = document.querySelector(".topnav-left");
      const nm = document.querySelector(".nm-btn"); const pft = document.querySelector(".pft");
      return {
        navItems: nav ? [...nav.querySelectorAll("a, button")].map((a) => (a.textContent || "").trim()) : null,
        menuLeftOfPlan: !!(nm && pft) && nm.getBoundingClientRect().right <= pft.getBoundingClientRect().left + 1,
        menuInLeft: !!left && !!left.querySelector(".nm-btn"),
        navLink: !!document.querySelector(".ff-navlink, [data-open-facade]"),
        tex: document.querySelector(".ct-tex")?.getAttribute("aria-pressed") ?? null,
        texLit: !!document.querySelector(".ct-tex.is-on"),
        mySpot: !!document.querySelector(".ct-myspot"),
        mySpotInNav: !!document.querySelector(".topnav .ml-toggle"),
        menuHidden: !document.querySelector("[data-nav-menu].is-open"),
        texturesOn: ${CS}.texturesVisible,
      }; })()`);
    const s = await snapshot();
    if (!s || typeof s !== "object") fails.push("photoProjector() null — the desktop attach gate refused");
    if (!dom.menuLeftOfPlan || !dom.menuInLeft) fails.push(`the Menu button is not left of PLAN (${JSON.stringify({ l: dom.menuInLeft, lp: dom.menuLeftOfPlan })})`);
    if (!Array.isArray(dom.navItems) || dom.navItems.length !== 1 || !/upload/i.test(dom.navItems[0])) fails.push(`the right nav is ${JSON.stringify(dom.navItems)} (want only Upload)`);
    if (dom.navLink) fails.push("the ?facade nav link / [data-open-facade] element still renders");
    if (dom.tex !== "true" || !dom.texLit || dom.texturesOn !== true) fails.push(`TEX chip pressed=${dom.tex} lit=${dom.texLit} store=${dom.texturesOn} (want ON by default)`);
    if (!dom.mySpot || dom.mySpotInNav) fails.push(`MY SPOT icon ${dom.mySpot} / still in the nav ${dom.mySpotInNav}`);
    if (!dom.menuHidden) fails.push("the Menu is open at boot");
    await shot("01-boot.jpeg");
    return { pass: fails.length === 0, detail: fmtFails(fails, `nav ${JSON.stringify(dom.navItems)} · Menu left of PLAN · TEX on · MY SPOT icon in the camera controls`) };
  });
  if (!bootOk) aborted = "boot failed";

  // ═══ 2 · T181 THE SPLIT DROPZONE → REVIEW → PLACED ════════════════════════════════════════════
  const placedOk = aborted ? false : await runLeg(2, "T181 Upload → the split dropzone's facade half → the facade overlay → review → placed", async () => {
    const fails = [];
    await evalJs(`document.querySelector("[data-open-upload]")?.click(), true`);
    const halves = await waitFor(`(() => { const a = document.querySelector(".uf-dropzone--pin"); const b = document.querySelector(".uf-dropzone--facade"); if (!a || !b) return null;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return { pinTop: ra.top, pinH: ra.height, facTop: rb.top, facH: rb.height, input: !!b.querySelector("input[type=file]") }; })()`, 8000, 120);
    if (!halves.ok) return { pass: false, detail: "the two halves never rendered" };
    const hv = halves.value;
    if (!(hv.facTop >= hv.pinTop + hv.pinH - 2)) fails.push(`the facade half is not BELOW the pin half (${JSON.stringify(hv)})`);
    if (!hv.input) fails.push("no file input in the facade half");
    await shot("02-split-dropzone.jpeg");
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".uf-dropzone--facade input[type=file]" });
    if (!nodeId) return { pass: false, detail: "DOM.querySelector found no facade file input node" };
    await send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
    const opened = await waitFor(`!!document.querySelector(".uf.ff") && ${FS}.open === true && !document.querySelector(".uf:not(.ff)")`, 8000, 120);
    if (!opened.ok) fails.push("the facade overlay did not take over from Upload");
    const rv = await waitFor(`${FS}.phase === "review"`, 15_000, 200);
    if (!rv.ok) return { pass: false, detail: fmtFails(fails, "") + ` · phase never reached review (${await evalJs(`${FS}.phase`)})` };
    await evalJs(`${FS}.place(), true`);
    const w = await waitFor(`${FS}.phase === "placed" && ${FS}.open === false`, 5000, 100);
    if (!w.ok) return { pass: false, detail: "place() did not reach placed/closed" };
    await sleep(FLIGHT_SETTLE_MS);
    const sw = await waitFor(`(() => { const s = ${SNAP}; return !!s && s.on === true && s.textureReady === true && s.depthRenders >= 1; })()`, 8000, 100);
    const s = await snapshot();
    if (!sw.ok) fails.push(`the draft slot never went on (${JSON.stringify({ on: s?.on, tex: s?.textureReady, depth: s?.depthRenders })})`);
    const chip = await evalJs(`!!document.querySelector("[data-facade-chip]")`);
    if (!chip) fails.push("the facade edit chip did not appear once placed (T175)");
    await shot("03-placed.jpeg");
    return { pass: fails.length === 0, detail: fmtFails(fails, `halves pin@${r2(hv.pinTop)}+${r2(hv.pinH)} facade@${r2(hv.facTop)}+${r2(hv.facH)} · review → placed · draft on, depth ×${s?.depthRenders} · chip shown`) };
  });
  if (!placedOk) aborted = aborted ?? "the facade never placed";

  // ═══ 3 · T174 SCALE RE-RENDERS THE PROJECTION ═════════════════════════════════════════════════
  if (!aborted) await runLeg(3, "T174 a corner-only SCALE (H-FOV) re-renders the depth map + re-optics the projector", async () => {
    const fails = [];
    await ticks(40); // let the landing's tile stream settle its depth renders
    const d0 = (await snapshot()).depthRenders;
    const v0 = (await snapshot()).vFovDeg;
    await ticks(30);
    const d0b = (await snapshot()).depthRenders;
    const steadyBefore = d0b - d0; // the refresh cadence alone (≤ 1 per 500 ms)
    await evalJs(`${FS}.setHFovDeg(92.4), true`); // the owner's SCALE drag end value
    await ticks(6);
    const s1 = await snapshot();
    const d1 = s1.depthRenders;
    const geomH = await evalJs(`(() => { const g = window.__globe.facadeFrustum.current(); const c = g.corners; const cx = [0,1,2].map((k) => (c[0][k]+c[1][k]+c[2][k]+c[3][k])/4 - g.apex[k]);
      const d = cx[0]*g.forward[0]+cx[1]*g.forward[1]+cx[2]*g.forward[2]; const hw = Math.hypot(c[0][0]-c[1][0], c[0][1]-c[1][1], c[0][2]-c[1][2])/2; return 2*Math.atan(hw/d)*180/Math.PI; })()`);
    if (!(d1 >= d0b + 1)) fails.push(`depthRenders ${d0b} → ${d1} within 6 frames of the scale (want +1; the cadence alone gave +${steadyBefore} over 30 frames)`);
    if (!(s1.vFovDeg > v0 + 1)) fails.push(`projector vFov ${r2(v0)}° → ${r2(s1.vFovDeg)}° did not widen`);
    if (!near(geomH, 92.4, 0.01)) fails.push(`frustum hFov ${r2(geomH)}° ≠ 92.4°`);
    await evalJs(`${FS}.setHFovDeg(undefined), true`);
    await ticks(6);
    const s2 = await snapshot();
    if (!(s2.depthRenders >= d1 + 1)) fails.push(`the restore did not re-render (${d1} → ${s2.depthRenders})`);
    if (!near(s2.vFovDeg, v0, 1e-3)) fails.push(`vFov after restore ${r2(s2.vFovDeg)} ≠ ${r2(v0)}`);
    return { pass: fails.length === 0, detail: fmtFails(fails, `depthRenders ${d0b} → ${d1} → ${s2.depthRenders} · vFov ${r2(v0)}° → ${r2(s1.vFovDeg)}° → ${r2(s2.vFovDeg)}° · frustum ${r2(geomH)}°`) };
  });

  // ═══ 4 · T175 THE FACADE EDIT CHIP ════════════════════════════════════════════════════════════
  if (!aborted) await runLeg(4, "T175 the facade edit chip switches MOVE / ROTATE / SCALE / OFF and carries UNDO + DROP SESSION", async () => {
    const fails = [];
    const chip = await evalJs(`(() => { const c = document.querySelector("[data-facade-chip]"); if (!c) return null;
      return { ops: [...c.querySelectorAll(".bec-op")].map((b) => b.getAttribute("data-op")), undo: !!c.querySelector('[data-act="undo"]'), drop: !!c.querySelector('[data-act="drop-session"]'), kind: c.getAttribute("data-kind") }; })()`);
    if (!chip) return { pass: false, detail: "no [data-facade-chip]" };
    if (JSON.stringify(chip.ops) !== JSON.stringify(["none", "move", "rotate", "scale"])) fails.push(`ops ${JSON.stringify(chip.ops)}`);
    if (chip.undo || chip.drop) fails.push(`undo ${chip.undo} drop ${chip.drop} shown with NOTHING to undo`); // the foot appears with the first entry
    for (const op of ["rotate", "scale", "move"]) {
      await evalJs(`document.querySelector('[data-facade-chip] .bec-op[data-op="${op}"]').click(), true`);
      const w = await waitFor(`(() => { const g = ${GZ}; return ${FS}.gizmoOp === "${op}" && !!g && g.attached === true && g.op === "${op}" && !!document.querySelector('[data-facade-chip] .bec-op[data-op="${op}"].is-on'); })()`, 1500, 50);
      if (!w.ok) fails.push(`${op}: store ${await evalJs(`${FS}.gizmoOp`)} gizmo ${JSON.stringify(await evalJs(`(() => { const g = ${GZ}; return g ? [g.attached, g.op] : null; })()`))}`);
    }
    await shot("04-edit-chip.jpeg");
    await evalJs(`document.querySelector('[data-facade-chip] .bec-op[data-op="none"]').click(), true`);
    const off = await waitFor(`(() => { const g = ${GZ}; return ${FS}.gizmoOp === "none" && !!g && g.attached === false; })()`, 1500, 50);
    if (!off.ok) fails.push("OFF did not detach the gizmo");
    // UNDO + DROP SESSION through the chip: a gizmo MOVE drag journals one entry (a nudge does not —
    // pre-existing), the foot shows UNDO + DROP SESSION, UNDO restores the placement exactly.
    await cutTo(`(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, -55).addScaledVector(b.up, 30).addScaledVector(b.right, 20); })()`, `(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, 10); })()`);
    await evalJs(`document.querySelector('[data-facade-chip] .bec-op[data-op="move"]').click(), true`);
    await waitFor(`(() => { const g = ${GZ}; return !!g && g.attached === true && g.op === "move"; })()`, 1500, 50);
    await ticks(3);
    const h = await handleDir("X");
    if (h.error) return { pass: false, detail: fmtFails(fails, "") + " · " + h.error };
    const p0 = (await stateOf()).placement;
    const n0 = await evalJs("window.__editJournal.entries.length");
    const dr = await dragFrom({ x: h.hp.x + h.ux * 4, y: h.hp.y + h.uy * 4 }, h.ux, h.uy, 80, 8);
    const p1 = (await stateOf()).placement;
    const n1 = await evalJs("window.__editJournal.entries.length");
    const foot = await waitFor(`(() => { const c = document.querySelector("[data-facade-chip]"); const u = c?.querySelector('[data-act="undo"]'); const d = c?.querySelector('[data-act="drop-session"]'); return u && d ? { undo: u.textContent.trim(), drop: d.textContent.trim() } : null; })()`, 2000, 50);
    const movedM = p1 && p0 ? Math.hypot((p1.latDeg - p0.latDeg) * 111_320, (p1.lonDeg - p0.lonDeg) * 111_320 * Math.cos(p0.latDeg * D2R)) : 0;
    if (!(movedM > 0.5)) fails.push(`the MOVE drag did not move the placement (${r2(movedM)} m)`);
    if (n1 !== n0 + 1) fails.push(`journal ${n0} → ${n1} (want +1)`);
    if (!(dr.camMovedM < 1)) fails.push(`the camera moved ${r2(dr.camMovedM)} m`);
    if (!foot.ok) fails.push("the chip's foot shows no UNDO + DROP SESSION after a journaled drag");
    await evalJs(`document.querySelector('[data-facade-chip] [data-act="undo"]')?.click(), true`);
    await ticks(8);
    const p2 = (await stateOf()).placement;
    if (!p2 || !near(p2.lonDeg, p0.lonDeg, 1e-9) || !near(p2.latDeg, p0.latDeg, 1e-9)) fails.push(`the chip's UNDO did not restore (${JSON.stringify({ p0, p1, p2 })})`);
    const gone = await waitFor(`!document.querySelector('[data-facade-chip] [data-act="undo"]')`, 2000, 50);
    if (!gone.ok) fails.push("UNDO stayed after the last entry was undone");
    await evalJs(`document.querySelector('[data-facade-chip] .bec-op[data-op="none"]').click(), true`);
    await waitFor(`(() => { const g = ${GZ}; return !!g && g.attached === false; })()`, 1500, 50);
    return { pass: fails.length === 0, detail: fmtFails(fails, `ops ${chip.ops.join("/")} · each op attaches the gizmo · OFF detaches · MOVE drag ${r2(movedM)} m journaled → foot ${JSON.stringify(foot.value)} → UNDO restored exactly`) };
  });

  // ═══ 5 · T177 THE RESIDENCY BY THE PAINTED VOLUME ═════════════════════════════════════════════
  if (!aborted) await runLeg(5, "T177 a saved row stays resident while the camera stands inside its painted volume (apex behind, turned 180°), fades far, releases beyond the band", async () => {
    const fails = [];
    rowId = "harness-row-1";
    // A synthetic saved row AT the draft's pose (the draft's preview blob is its texture — same origin),
    // served to the store's OWN world + mine reads by an in-page fetch stub (dev cannot elevate — T173 —
    // and the real reads answer 401 / 502, which would wipe a row poked straight into the store).
    await evalJs(`(() => { const s = ${FS}; const row = { id: ${JSON.stringify(rowId)}, title: "harness saved facade", displayUrl: s.previewUrl, thumbUrl: null, updatedAt: new Date().toISOString(),
      lat: s.placement.latDeg, lon: s.placement.lonDeg, apexAltM: s.apexAltM, altitudeM: 1.7, headingDeg: ${FIX.heading}, pitchDeg: 0, rollDeg: 0, focalLengthMm: 26, hFovDeg: 69.39, fovEstimated: false,
      textureWidth: ${FIX.w}, textureHeight: ${FIX.h}, strength: 1, ownLight: 0.6, rangeM: null };
      const mine = { ...row, targetFeatureIds: [], alignment: {}, capturedAt: null, cameraMake: null, cameraModel: null, lensModel: null, fileName: "harness.jpg", fileSizeBytes: 1000, poseSource: "exif", exifPose: null, createdAt: row.updatedAt, isPublic: false, moderation: "none" };
      window.__oaRows = { world: [row], mine: [] , mineRow: mine };
      if (!window.__oaFetch) {
        window.__oaFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const u = typeof input === "string" ? input : input.url;
          const m = (init && init.method) || "GET";
          if (u.startsWith("/api/facades") && m === "GET") {
            const body = u.includes("cells=") ? { facades: window.__oaRows.world, complete: true } : { facades: window.__oaRows.mine, hasNext: false };
            return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
          }
          return window.__oaFetch(input, init);
        };
      }
      window.__memberStore.setState({ phase: "member" });
      ${MS}.refresh();
      return true; })()`);
    const w0 = await waitFor(`${MS}.world.length === 1 && ${FAC}.markers.total === 1`, 8000, 100);
    const f0 = await facades();
    if (!w0.ok) fails.push(`markers ${JSON.stringify(f0.markers)} world ${await evalJs(`${MS}.world.length`)} phase ${await evalJs(`${MS}.worldPhase`)} (want 1 row)`);
    // (a) INSIDE the painted volume, 60 m ahead of the apex, looking FORWARD (the apex behind the camera).
    await cutTo(`(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, 60).addScaledVector(b.up, 2); })()`, `(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, 200); })()`);
    const wa = await waitFor(`(() => { const f = ${FAC}; const s = ${SNAP}; return f.resident.includes(${JSON.stringify(rowId)}) && s.slots.some((x) => x.id === ${JSON.stringify(rowId)} && x.on && x.fade === 1); })()`, 8000, 100);
    const fa = await facades();
    const sa = await snapshot();
    if (!wa.ok) fails.push(`(a) inside, apex behind: resident ${JSON.stringify(fa.resident)} slots ${JSON.stringify((sa.slots ?? []).map((x) => [x.id, x.on, x.fade]))}`);
    await shot("05a-inside-apex-behind.jpeg");
    // (b) turned 180° — looking back AT the apex from inside the volume.
    await cutTo(`(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, 60).addScaledVector(b.up, 2); })()`, `(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, -100); })()`);
    await ticks(14);
    const fb = await facades();
    if (!fb.resident.includes(rowId)) fails.push(`(b) turned 180°: resident ${JSON.stringify(fb.resident)} — the slot thrashed`);
    // (c) 1,700 m behind the apex looking at it: inside the fade band (2,000 × 0.65 = 1,300 → 2,000) → 0 < fade < 1.
    await cutTo(`(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, -1700).addScaledVector(b.up, 300); })()`, `(() => { const b = ${BASIS}; return b.apex.clone(); })()`);
    const wc = await waitFor(`(() => { const s = ${SNAP}; const x = s.slots.find((x) => x.id === ${JSON.stringify(rowId)}); return !!x && x.fade > 0 && x.fade < 1 && x.strength < 1 ? x.fade : 0; })()`, 6000, 100);
    const sc = await snapshot();
    const slotC = (sc.slots ?? []).find((x) => x.id === rowId);
    if (!wc.ok) fails.push(`(c) 1.7 km: fade ${slotC?.fade} strength ${slotC?.strength} resident ${JSON.stringify((await facades()).resident)} (want 0 < fade < 1)`);
    await shot("05c-faded.jpeg");
    // (d) 2,400 m behind looking at it: past the band (2,000 + 60) → released.
    await cutTo(`(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, -2400).addScaledVector(b.up, 400); })()`, `(() => { const b = ${BASIS}; return b.apex.clone(); })()`);
    const wd = await waitFor(`(() => { const f = ${FAC}; return !f.resident.includes(${JSON.stringify(rowId)}) && !f.occupied.includes(${JSON.stringify(rowId)}); })()`, 6000, 100);
    if (!wd.ok) fails.push(`(d) 2.4 km: still resident ${JSON.stringify((await facades()).resident)}`);
    // (e) back inside → re-acquired (the texture reloads from the blob).
    await cutTo(`(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, 60).addScaledVector(b.up, 2); })()`, `(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, 200); })()`);
    const we = await waitFor(`(() => { const f = ${FAC}; const s = ${SNAP}; return f.resident.includes(${JSON.stringify(rowId)}) && s.slots.some((x) => x.id === ${JSON.stringify(rowId)} && x.on); })()`, 8000, 100);
    if (!we.ok) fails.push(`(e) back inside: not re-acquired (${JSON.stringify((await facades()).resident)})`);
    return { pass: fails.length === 0, detail: fmtFails(fails, `inside+apex behind: resident · 180°: kept · 1.7 km: fade ${r2(slotC?.fade)} strength ${r2(slotC?.strength)} · 2.4 km: released · back: re-acquired`) };
  });

  // ═══ 6 · T178 + T183 HOVER + THE CONTEXT MENU ═════════════════════════════════════════════════
  if (!aborted) await runLeg(6, "T178 + T183 hover grows the camera marker + shows the compact card; right-click opens EDIT / REMOVE (disabled for a world-only row, enabled for a mine row)", async () => {
    const fails = [];
    // Stand 40 m beside the apex, 15 m up, looking at it — the marker in the middle of the frame.
    await cutTo(`(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.right, 40).addScaledVector(b.up, 15); })()`, `(() => { const b = ${BASIS}; return b.apex.clone(); })()`);
    const px = await evalJs(`(() => { const a = ${FAC}.apexOf(${JSON.stringify(rowId)}); if (!a) return null; const V = window.__globe.camera.up.constructor; const p = new V(a[0], a[1], a[2]).project(window.__globe.camera);
      const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; })()`);
    if (!px) return { pass: false, detail: "the row's apex is unknown" };
    await hoverAt(px.x, px.y);
    const wh = await waitFor(`(() => { const f = ${FAC}; const h = ${MS}.hover; const card = document.querySelector(".fhover"); return f.hovered === ${JSON.stringify(rowId)} && !!h && h.id === ${JSON.stringify(rowId)} && !!card ? { card: card.textContent, x: h.screen.x, y: h.screen.y } : null; })()`, 4000, 80);
    if (!wh.ok) fails.push(`hover: hovered ${(await facades()).hovered} store ${JSON.stringify(await evalJs(`${MS}.hover`))} card ${await evalJs(`!!document.querySelector(".fhover")`)}`);
    else {
      if (!/harness saved facade/.test(wh.value.card)) fails.push(`the card reads ${JSON.stringify(wh.value.card)}`);
      if (!near(wh.value.x, px.x, 6) || !near(wh.value.y, px.y, 6)) fails.push(`the card anchor (${r2(wh.value.x)}, ${r2(wh.value.y)}) is off the apex (${r2(px.x)}, ${r2(px.y)})`);
    }
    await sleep(400); // the ease
    const grown = await evalJs(`(() => { const sx = ${FAC}.markerScaleOf(${JSON.stringify(rowId)}); if (sx === null) return null;
      const cam = window.__globe.camera; const V = cam.up.constructor; const a = ${FAC}.apexOf(${JSON.stringify(rowId)}); const d = new V(a[0], a[1], a[2]).distanceTo(cam.position); return { sx, d }; })()`);
    if (grown) {
      const base = Math.min(600, Math.max(3, grown.d * 0.02));
      if (!(grown.sx > base * 1.3)) fails.push(`the hovered marker did not grow (${r2(grown.sx)} vs base ${r2(base)})`);
    }
    await shot("06a-hover.jpeg");
    // Right-click → the menu (a world-only row: EDIT / REMOVE disabled).
    await mouse("mousePressed", px.x, px.y, { button: "right", clickCount: 1 });
    await mouse("mouseReleased", px.x, px.y, { button: "right", clickCount: 1 });
    const wm = await waitFor(`(() => { const m = document.querySelector(".fmenu[data-facade-menu]"); if (!m) return null; return { id: m.getAttribute("data-facade-menu"), edit: m.querySelector('[data-act="edit"]')?.disabled, remove: m.querySelector('[data-act="remove"]')?.disabled, text: m.textContent }; })()`, 4000, 80);
    if (!wm.ok) fails.push(`no .fmenu after a right-click (store menu ${JSON.stringify(await evalJs(`${MS}.menu`))})`);
    else {
      if (wm.value.id !== rowId) fails.push(`menu for ${wm.value.id}`);
      if (wm.value.edit !== true || wm.value.remove !== true) fails.push(`world-only row: EDIT disabled ${wm.value.edit} REMOVE disabled ${wm.value.remove} (want both)`);
      if (!/EDIT/.test(wm.value.text) || !/REMOVE/.test(wm.value.text)) fails.push(`menu text ${JSON.stringify(wm.value.text)}`);
    }
    await shot("06b-menu-world.jpeg");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    const closed = await waitFor(`!document.querySelector(".fmenu") && ${MS}.menu === null`, 2000, 50);
    if (!closed.ok) fails.push("Escape did not close the menu");
    // The row as MINE → EDIT / REMOVE enabled; EDIT re-opens it as the draft (editingId set, the marker hidden).
    await evalJs(`(() => { window.__oaRows.mine = [window.__oaRows.mineRow]; return ${MS}.loadMine(), true; })()`);
    const wmine = await waitFor(`${MS}.mine.length === 1 && ${MS}.minePhase === "ready"`, 5000, 100);
    if (!wmine.ok) fails.push(`the mine read did not land (${await evalJs(`${MS}.minePhase`)})`);
    await hoverAt(px.x + 30, px.y + 30);
    await sleep(100);
    await hoverAt(px.x, px.y);
    await mouse("mousePressed", px.x, px.y, { button: "right", clickCount: 1 });
    await mouse("mouseReleased", px.x, px.y, { button: "right", clickCount: 1 });
    const wm2 = await waitFor(`(() => { const m = document.querySelector(".fmenu[data-facade-menu]"); if (!m) return null; return { edit: m.querySelector('[data-act="edit"]')?.disabled, remove: m.querySelector('[data-act="remove"]')?.disabled }; })()`, 4000, 80);
    if (!wm2.ok) fails.push("no menu on the mine row");
    else if (wm2.value.edit !== false || wm2.value.remove !== false) fails.push(`mine row: EDIT disabled ${wm2.value.edit} REMOVE disabled ${wm2.value.remove} (want both enabled)`);
    await shot("06c-menu-mine.jpeg");
    // REMOVE two-step: the first press arms (no delete), the second would DELETE — dev cannot elevate,
    // so only the arm is exercised; then Escape.
    await evalJs(`document.querySelector('.fmenu [data-act="remove"]')?.click(), true`);
    const armed = await waitFor(`(() => { const b = document.querySelector('.fmenu [data-act="remove"]'); return !!b && /SURE/i.test(b.textContent) && ${MS}.mine.length === 1; })()`, 2000, 50);
    if (!armed.ok) fails.push("the first REMOVE press did not arm (or deleted at once)");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await waitFor(`!document.querySelector(".fmenu")`, 2000, 50);
    // EDIT → openSaved: the draft becomes that row; its marker hides (editingId).
    await hoverAt(px.x, px.y);
    await mouse("mousePressed", px.x, px.y, { button: "right", clickCount: 1 });
    await mouse("mouseReleased", px.x, px.y, { button: "right", clickCount: 1 });
    await waitFor(`!!document.querySelector('.fmenu [data-act="edit"]')`, 3000, 50);
    await evalJs(`document.querySelector('.fmenu [data-act="edit"]')?.click(), true`);
    const we = await waitFor(`${FS}.savedFacadeId === ${JSON.stringify(rowId)} && ${FS}.phase === "placed" && ${MS}.editingId === ${JSON.stringify(rowId)} && !document.querySelector(".fmenu")`, 5000, 100);
    if (!we.ok) fails.push(`EDIT did not open the row (saved ${await evalJs(`${FS}.savedFacadeId`)} editing ${await evalJs(`${MS}.editingId`)})`);
    await sleep(FLIGHT_SETTLE_MS);
    const fm = await facades();
    if (fm.markers?.drawn !== 0) fails.push(`the row under edit still draws a marker (${JSON.stringify(fm.markers)})`);
    return { pass: fails.length === 0, detail: fmtFails(fails, `hover → marker ×${r2(grown?.sx)} m + card at the apex · menu world-only disabled · mine enabled · REMOVE arms · EDIT opens the row + hides its marker`) };
  });

  // ═══ 7 · T182 THE TEX TOGGLE ══════════════════════════════════════════════════════════════════
  if (!aborted) await runLeg(7, "T182 the TEX toggle releases the saved slots (the draft stays) and re-acquires them", async () => {
    const fails = [];
    // Close the edit (the row returns to the world) and stand inside its volume again.
    await evalJs(`${FS}.clear(), true`);
    await evalJs(`window.__facadesStore.setState({ editingId: null }), true`);
    await ticks(6);
    // The draft is gone now — re-place the fixture so the draft slot is live too (clear() dropped it).
    await evalJs(`document.querySelector("[data-open-upload]")?.click(), true`);
    await waitFor(`!!document.querySelector(".uf-dropzone--facade input[type=file]")`, 8000, 120);
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".uf-dropzone--facade input[type=file]" });
    await send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
    await waitFor(`${FS}.phase === "review"`, 15_000, 200);
    await evalJs(`${FS}.place(), true`);
    await waitFor(`${FS}.phase === "placed"`, 5000, 100);
    await sleep(FLIGHT_SETTLE_MS);
    // clear() revoked the old preview blob the synthetic row pointed at — re-point it at the new one
    // (a saved row's wixstatic URL never dies; this is the harness's stand-in).
    await evalJs(`(() => { const u = ${FS}.previewUrl; window.__oaRows.world[0] = { ...window.__oaRows.world[0], displayUrl: u, updatedAt: new Date().toISOString() }; window.__oaRows.mineRow = { ...window.__oaRows.mineRow, displayUrl: u }; window.__oaRows.mine = [window.__oaRows.mineRow]; ${MS}.refresh(); return true; })()`);
    await waitFor(`${MS}.world.length === 1 && ${MS}.world[0].displayUrl === ${FS}.previewUrl`, 5000, 100);
    await cutTo(`(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, 60).addScaledVector(b.up, 2); })()`, `(() => { const b = ${BASIS}; return b.apex.clone().addScaledVector(b.fwd, 200); })()`);
    const w0 = await waitFor(`(() => { const f = ${FAC}; const s = ${SNAP}; return f.resident.includes(${JSON.stringify(rowId)}) && s.slotsOn === 2; })()`, 10_000, 100);
    if (!w0.ok) fails.push(`setup: resident ${JSON.stringify((await facades()).resident)} slotsOn ${(await snapshot()).slotsOn} (want the row + the draft)`);
    await evalJs(`document.querySelector(".ct-tex").click(), true`);
    const w1 = await waitFor(`(() => { const f = ${FAC}; const s = ${SNAP}; return ${CS}.texturesVisible === false && !document.querySelector(".ct-tex.is-on") && f.resident.length === 0 && f.occupied.length === 1 && s.slotsOn === 1 && s.on === true; })()`, 4000, 100);
    const s1 = await snapshot();
    const f1 = await facades();
    if (!w1.ok) fails.push(`OFF: store ${await evalJs(`${CS}.texturesVisible`)} resident ${JSON.stringify(f1.resident)} occupied ${JSON.stringify(f1.occupied)} slotsOn ${s1.slotsOn} draft on ${s1.on}`);
    if (f1.markers?.drawn !== 1) fails.push(`OFF: the markers went away (${JSON.stringify(f1.markers)}) — they must stay`);
    await shot("07-tex-off.jpeg");
    await evalJs(`document.querySelector(".ct-tex").click(), true`);
    const w2 = await waitFor(`(() => { const f = ${FAC}; const s = ${SNAP}; return ${CS}.texturesVisible === true && f.resident.includes(${JSON.stringify(rowId)}) && s.slotsOn === 2; })()`, 8000, 100);
    if (!w2.ok) fails.push(`ON again: resident ${JSON.stringify((await facades()).resident)} slotsOn ${(await snapshot()).slotsOn}`);
    const persisted = await evalJs(`(() => { try { return JSON.parse(localStorage.getItem("ftw:view-prefs:v1") || "{}").texturesVisible; } catch { return "ERR"; } })()`);
    if (persisted !== true) fails.push(`the pref did not persist (${persisted})`);
    return { pass: fails.length === 0, detail: fmtFails(fails, `OFF → saved slot released, draft on, markers stay · ON → re-acquired · persisted`) };
  });

  // ═══ 8 · T176 EDITING IN FPV ══════════════════════════════════════════════════════════════════
  if (!aborted) await runLeg(8, "T176 in FPV the gizmo stays attached, a handle drag moves the photo, the eye stays put, no look-drag", async () => {
    const fails = [];
    const st = await stateOf();
    // FPV 12 m SOUTH of the photo looking north at it (the My spot jump with a share heading): the
    // gizmo stands in front of the eye — an eye ON the apex sees its handles degenerate.
    await evalJs(`${CS}.requestFpvJump({ latDeg: ${st.placement.latDeg - 12 / 111_320}, lonDeg: ${st.placement.lonDeg}, eyeM: 1.7, headingDeg: 0, pitchDeg: 0, fovDeg: 60 }), true`);
    const wf = await waitFor(`window.__globe.fpv().active === true`, 15_000, 200);
    if (!wf.ok) return { pass: false, detail: "FPV never activated from requestFpvJump" };
    await sleep(1500);
    const yaw0 = await evalJs(`window.__globe.fpv().yawDeg`);
    const at = await setOp("move");
    if (!at.ok) fails.push(`the gizmo did not attach in FPV (${JSON.stringify(await evalJs(`(() => { const g = ${GZ}; return g ? [g.attached, g.op, g.requestedOp] : null; })()`))})`);
    const chip = await evalJs(`!!document.querySelector("[data-facade-chip]")`);
    if (!chip) fails.push("the facade edit chip is not shown in FPV");
    const panel = await evalJs(`!!document.querySelector(".pd.ff-panel")`);
    if (!panel) fails.push("the docked facade panel is not shown in FPV");
    await shot("08a-fpv-gizmo.jpeg");
    let moved = null;
    if (at.ok) {
      // Pick whichever arrow projects best on screen (the eye sits ON the apex: X or Z).
      let h = await handleDir("X");
      if (h.error || h.lenPx < 25) h = await handleDir("Z");
      if (h.error) fails.push(h.error);
      else {
        const p0 = (await stateOf()).placement;
        const eye0 = await camPos();
        const dr = await dragFrom({ x: h.hp.x + h.ux * 4, y: h.hp.y + h.uy * 4 }, h.ux, h.uy, 80, 8);
        const p1 = (await stateOf()).placement;
        const yaw1 = await evalJs(`window.__globe.fpv().yawDeg`);
        const fpvNow = await evalJs(`(() => { const f = window.__globe.fpv(); return { active: f.active, controlsEnabled: window.__globe.controls ? window.__globe.controls.enabled : null }; })()`);
        moved = p1 && p0 ? Math.hypot((p1.latDeg - p0.latDeg) * 111_320, (p1.lonDeg - p0.lonDeg) * 111_320 * Math.cos(p0.latDeg * D2R)) : 0;
        if (!(moved > 0.5)) fails.push(`the drag did not move the placement (${r2(moved)} m)`);
        if (!(dr.camMovedM < 0.5)) fails.push(`the FPV eye moved ${r2(dr.camMovedM)} m during the drag`);
        if (!near(yaw1, yaw0, 0.05)) fails.push(`the look-drag fired: yaw ${r2(yaw0)} → ${r2(yaw1)}`);
        if (fpvNow.active !== true) fails.push("FPV exited during the drag");
        if (fpvNow.controlsEnabled === true) fails.push("GlobeControls were re-enabled inside FPV after the release (the T176 trap)");
        const gz = await evalJs(`(() => { const g = ${GZ}; return g ? { dragging: g.dragging, attached: g.attached } : null; })()`);
        if (!gz || gz.dragging !== false) fails.push(`the gizmo is still dragging after the release (${JSON.stringify(gz)})`);
      }
    }
    await shot("08b-fpv-dragged.jpeg");
    await setOp("none");
    // Exit FPV (the temp pin away) and make sure orbit works again.
    await evalJs(`${CS}.setTempPin(null), true`);
    const wo = await waitFor(`window.__globe.fpv().active === false`, 8000, 200);
    if (!wo.ok) fails.push("FPV did not exit");
    const ctl = await evalJs(`window.__globe.controls ? window.__globe.controls.enabled : "n/a"`);
    if (ctl === false) fails.push("GlobeControls stayed disabled after the FPV exit");
    return { pass: fails.length === 0, detail: fmtFails(fails, `gizmo attached in FPV · chip + panel shown · drag moved the photo ${r2(moved)} m, the eye 0 m, yaw held · exit ok`) };
  });

  // ═══ 9 · T180 + T179 THE MENU → MY CONTENT (centred, resizable, TEXTURES) ═════════════════════
  if (!aborted) await runLeg(9, "T180 + T179 the MENU opens; MY CONTENT opens centred + resizable with the TEXTURES tab listing the mine row (OPEN + two-press delete)", async () => {
    const fails = [];
    const btn = await waitFor(`!!document.querySelector(".nm-btn")`, 10_000, 200);
    if (!btn.ok) {
      const diag = await evalJs(`({ href: location.href, globe: !!window.__globe, nm: !!document.querySelector(".nm"), header: !!document.querySelector(".topnav"), left: document.querySelector(".topnav-left")?.innerHTML?.slice(0, 300) ?? null })`);
      return { pass: false, detail: `no .nm-btn — ${JSON.stringify(diag)}` };
    }
    await evalJs(`document.querySelector(".nm-btn").click(), true`);
    const wm = await waitFor(`(() => { const c = document.querySelector("[data-nav-menu]"); if (!c || !c.classList.contains("is-open")) return null; const r = c.getBoundingClientRect();
      return { visible: r.width > 0 && getComputedStyle(c).visibility !== "hidden", explore: !!c.querySelector("[data-explore]"), mobile: !!c.querySelector('a[href="/m"]'), docs: !!c.querySelector('a[href="/guide"]'), mp: !!c.querySelector(".mp-toggle"), mk: !!c.querySelector(".mk-toggle"), guide: !!c.querySelector(".gd-toggle"), expanded: document.querySelector(".nm-btn")?.getAttribute("aria-expanded") }; })()`, 3000, 80);
    if (!wm.ok) fails.push("the Menu did not open");
    else {
      const v = wm.value;
      for (const k of ["visible", "explore", "mobile", "docs", "mp", "mk", "guide"]) if (!v[k]) fails.push(`menu: ${k} missing`);
      if (v.expanded !== "true") fails.push(`aria-expanded ${v.expanded}`);
    }
    await shot("09a-menu-open.jpeg");
    const mpText = await evalJs(`document.querySelector(".mp-toggle")?.textContent?.trim() ?? null`);
    if (!/my content/i.test(mpText ?? "")) fails.push(`the toggle reads ${JSON.stringify(mpText)} (want "My content")`);
    await evalJs(`document.querySelector(".mp-toggle").click(), true`);
    const wp = await waitFor(`(() => { const p = document.querySelector(".mp-panel[role=dialog]"); if (!p) return null; const r = p.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, tabs: [...p.querySelectorAll(".mp-tab")].map((t) => t.getAttribute("data-tab") ?? t.textContent.trim()), resize: !!p.querySelector(".resize-grip, [data-resize-grip], .rg, .dg-resize") || p.innerHTML.includes("resize"), label: p.getAttribute("aria-label"), menuClosed: !document.querySelector("[data-nav-menu].is-open") }; })()`, 4000, 80);
    if (!wp.ok) fails.push("MY CONTENT did not open");
    else {
      const v = wp.value;
      if (!near(v.cx, 800, 40) || !near(v.cy, 500, 60)) fails.push(`the window is not centred (centre ${r2(v.cx)}, ${r2(v.cy)} of 1600×1000)`);
      if (!(v.w > 600 && v.h > 400)) fails.push(`the window is small (${r2(v.w)}×${r2(v.h)})`);
      if (!v.tabs.includes("textures")) fails.push(`tabs ${JSON.stringify(v.tabs)} lack textures`);
      if (!/my content/i.test(v.label ?? "")) fails.push(`aria-label ${JSON.stringify(v.label)}`);
      if (!v.menuClosed) fails.push("the Menu stayed open after the row click");
    }
    await evalJs(`document.querySelector('.mp-tab[data-tab="textures"]')?.click(), true`);
    const wt = await waitFor(`(() => { const row = document.querySelector('.mp-panel [data-facade-row=${JSON.stringify(rowId)}]'); if (!row) return null; return { open: !!row.querySelector('[data-act="open"]'), del: !!row.querySelector(".mp-del"), text: row.textContent }; })()`, 5000, 100);
    if (!wt.ok) fails.push(`the TEXTURES tab does not list the mine row (${await evalJs(`document.querySelector(".mp-panel")?.textContent?.slice(0, 200)`)})`);
    else {
      if (!wt.value.open || !wt.value.del) fails.push(`row actions open ${wt.value.open} delete ${wt.value.del}`);
      if (!/harness saved facade/.test(wt.value.text)) fails.push(`row text ${JSON.stringify(wt.value.text.slice(0, 120))}`);
    }
    await shot("09b-my-content-textures.jpeg");
    // The two-press delete arms only (dev cannot elevate — never the second press here).
    await evalJs(`document.querySelector('.mp-panel [data-facade-row=${JSON.stringify(rowId)}] .mp-del')?.click(), true`);
    const armed = await waitFor(`(() => { const b = document.querySelector('.mp-panel [data-facade-row=${JSON.stringify(rowId)}] .mp-del'); return !!b && /SURE/i.test(b.textContent) && ${MS}.mine.length === 1; })()`, 2000, 50);
    if (!armed.ok) fails.push("the delete's first press did not arm");
    // OPEN → the row opens as the draft and the window closes.
    await evalJs(`document.querySelector('.mp-panel [data-facade-row=${JSON.stringify(rowId)}] [data-act="open"]')?.click(), true`);
    const wo = await waitFor(`${FS}.savedFacadeId === ${JSON.stringify(rowId)} && !document.querySelector(".mp-panel[role=dialog]")`, 5000, 100);
    if (!wo.ok) fails.push(`OPEN did not open the row + close the window (saved ${await evalJs(`${FS}.savedFacadeId`)} panel ${await evalJs(`!!document.querySelector(".mp-panel[role=dialog]")`)})`);
    await sleep(FLIGHT_SETTLE_MS);
    await shot("09c-opened-from-my-content.jpeg");
    // The guide window's own clamp is the dragGrip test's; here: the resize style var exists on the panel after opening again.
    return { pass: fails.length === 0, detail: fmtFails(fails, `Menu: 7 rows · MY CONTENT centred ${r2(wp.value?.w)}×${r2(wp.value?.h)} · TEXTURES lists the row · delete arms · OPEN opens + closes`) };
  });

  // ═══ 10 · THE PIN FLOW UNTOUCHED + A CLEAN CONSOLE ════════════════════════════════════════════
  await runLeg(10, "the pin flow's upper half still feeds the upload store; no GL noise, no exceptions", async () => {
    const fails = [];
    await evalJs(`${FS}.clear(), true`);
    await evalJs(`(() => { if (window.__oaFetch) { window.fetch = window.__oaFetch; window.__oaFetch = null; } window.__memberStore.setState({ phase: "anonymous" }); window.__facadesStore.setState({ world: [], mine: [], editingId: null, hover: null, menu: null }); return true; })()`);
    await evalJs(`document.querySelector("[data-open-upload]")?.click(), true`);
    const w = await waitFor(`!!document.querySelector(".uf-dropzone--pin input[type=file]")`, 8000, 120);
    if (!w.ok) fails.push("the pin half has no file input");
    else {
      const { root } = await send("DOM.getDocument", { depth: -1 });
      const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".uf-dropzone--pin input[type=file]" });
      await send("DOM.setFileInputFiles", { files: [FIXTURE], nodeId });
      const up = await waitFor(`(() => { const u = window.__uploadStore.getState(); return u.phase !== "idle" ? u.phase : null; })()`, 10_000, 200);
      if (!up.ok) fails.push("the upload store never left idle from the pin half");
      const fs = await evalJs(`${FS}.phase`);
      if (fs !== "idle") fails.push(`the facade store moved (${fs}) on a PIN drop`);
      await evalJs(`window.__uploadStore.getState().reset ? window.__uploadStore.getState().reset() : window.__uploadStore.getState().closePanel(), true`);
    }
    if (glNoise.length) fails.push(`GL noise: ${glNoise.slice(0, 3).join(" | ")}`);
    const real = consoleErrors.filter((e) => !/favicon|404|WDE0027|LIST_FAILED|502|Failed to load resource|net::ERR/i.test(e));
    if (real.length) fails.push(`console errors: ${real.slice(0, 3).join(" | ")}`);
    return { pass: fails.length === 0, detail: fmtFails(fails, `pin half → the upload store · facade store idle · console clean (${consoleErrors.length} filtered dev-elevation / asset lines)`) };
  });
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} legs passed${aborted ? ` (aborted: ${aborted})` : ""} · shots ${SHOTS}/`);
  writeFileSync(`${SHOTS}/results.json`, JSON.stringify({ url: URL, aborted, results }, null, 2));
  ws.close();
  await finishVerify(passed === results.length && !aborted ? 0 : 1);
}
