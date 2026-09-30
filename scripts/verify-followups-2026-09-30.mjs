#!/usr/bin/env node
/**
 * verify-followups-2026-09-30 — the browser twin of the owner's 2026-09-30 order (unit contracts:
 * `test/lib/models/modelPlacement.test.ts` "the far law", `test/components/globe/userModels.test.ts`,
 * `test/store/userModels.test.ts`, `test/lib/globe/pinFollow.test.ts`, `test/styles/mapWindowChrome.test.ts`):
 *
 *  A. THE FAR LAW + THE EYE-CENTRED COVER (item 3 — "3 of 4 custom bridges never load in my zoomed
 *     viewport … they clip in and out"). At the owner's pose (`#f=48.494722,35.004545,96.3,121,-1,5.6`)
 *     against a SYNTHETIC world (the `/api/world-models` answers and the GLBs are fulfilled here over
 *     CDP `Fetch`, so the run never depends on what the production world holds): the cover is the
 *     eye's 16 km square, asked in chunks the route accepts; a 1.5 km bridge and a kiosk 5 km out in
 *     the frame are RESIDENT, a speck beside them, a bridge behind the camera and one past the range
 *     are not; nudging the pitch across the limb moves NEITHER the cover NOR a single model (the
 *     clip-in-and-out); a pan keeps what it loaded and loads what it now sees; zooming out lets the
 *     kiosk go and keeps the bridges.
 *  B. THE PIN FOLLOWS THE WALKER (item 2): in a temp-pin FPV the pin stays put WHILE walking and
 *     lands on the eye once the walk settles — ONE store write per stroll, the eye not moving a
 *     centimetre, the look unchanged; the arrow keys do the same; a point placed elsewhere still
 *     moves the viewer there; standing on a mesh roof the re-base keeps the roof; with the MAP window
 *     up the chart's pin and eye are one point, and the RE-CENTRE button wears the target glyph
 *     inside the same round button.
 *  C. `/m`: the same follow through the walk stick with the fullscreen map up, and the target glyph
 *     on the phone's round button.
 *
 * Usage: ~/.nvm/versions/node/v24.10.0/bin/node scripts/verify-followups-2026-09-30.mjs [cdpPort] [--shots]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const SHOTS = args.includes("--shots");
const notes = [];
const fails = [];
const ok = (cond, msg) => (cond ? notes.push(`  PASS  ${msg}`) : fails.push(`  FAIL  ${msg}`));
const info = (msg) => notes.push(`  INFO  ${msg}`);

// ── geometry helpers ─────────────────────────────────────────────────────────────────────────
const RAD = Math.PI / 180;
const offset = (p, distM, bearingDeg) => ({
  lat: p.lat + (distM * Math.cos(bearingDeg * RAD)) / 111_320,
  lon: p.lon + (distM * Math.sin(bearingDeg * RAD)) / (111_320 * Math.cos(p.lat * RAD)),
});
const distM = (a, b) =>
  Math.hypot(((a.latDeg ?? a.lat) - (b.latDeg ?? b.lat)) * 111_320, ((a.lonDeg ?? a.lon) - (b.lonDeg ?? b.lon)) * 111_320 * Math.cos((a.latDeg ?? a.lat) * RAD));
const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const gh5 = (lat, lon) => {
  let mnLa = -90, mxLa = 90, mnLo = -180, mxLo = 180, h = "", bit = 0, ch = 0, even = true;
  while (h.length < 5) {
    if (even) { const m = (mnLo + mxLo) / 2; if (lon >= m) { ch = ch * 2 + 1; mnLo = m; } else { ch *= 2; mxLo = m; } }
    else { const m = (mnLa + mxLa) / 2; if (lat >= m) { ch = ch * 2 + 1; mnLa = m; } else { ch *= 2; mxLa = m; } }
    even = !even;
    if (++bit === 5) { h += B32[ch]; bit = 0; ch = 0; }
  }
  return h;
};

// ── fixture: a minimal glTF-2.0 binary box (the verify-usermodels builder) ───────────────────────
function boxGlb(w, h, d) {
  const hw = w / 2, hd = d / 2;
  const P = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [-hw, h, -hd], [hw, h, -hd], [hw, h, hd], [-hw, h, hd]];
  const I = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  const pos = new Float32Array(P.flat());
  const idx = new Uint16Array(I);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const json = {
    asset: { version: "2.0", generator: "plux-verify-followups" },
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-hw, 0, -hd], max: [hw, h, hd] },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  while (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.from(" ")]);
  let binBuf = bin;
  while (binBuf.length % 4) binBuf = Buffer.concat([binBuf, Buffer.alloc(1)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binBuf.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
}

// ── the synthetic world around the owner's long-lens pose ───────────────────────────────────────
const EYE = { lat: 48.494722, lon: 35.004545 };
const HEADING = 121;
const GLB_HOST = "https://plux-verify.invalid";
const model = (id, at, [w, h, d]) => ({
  id,
  title: id,
  url: `${GLB_HOST}/${id}.glb`,
  thumbnailUrl: null,
  tris: 12,
  glbBytes: 1000,
  bbox: [w, h, d],
  lat: at.lat,
  lon: at.lon,
  rotDeg: 0,
  sx: 1, sy: 1, sz: 1,
  tU: 0,
  pitchDeg: 0,
  rollDeg: 0,
  updatedAt: "2026-09-30T12:00:00.000Z",
});
const WORLD = [
  model("far-bridge", offset(EYE, 5000, HEADING), [1500, 30, 40]), // fills the long lens
  model("far-kiosk", offset(EYE, 5000, HEADING - 2), [8, 10, 8]), // 3 % of the frame at 245 mm
  model("far-speck", offset(EYE, 5000, HEADING + 2), [2, 2, 2]), // under the threshold
  model("behind-bridge", offset(EYE, 5000, HEADING + 180), [1500, 30, 40]), // big, not looked at
  model("past-range", offset(EYE, 17_000, HEADING), [1500, 30, 40]), // in the cover, past farLoadRangeM
  model("near-box", offset(EYE, 60, HEADING + 90), [5, 5, 5]), // the radius law's, whatever the view
];
const SIZES = Object.fromEntries(WORLD.map((m) => [m.id, m.bbox]));

await ensureBrowser(PORT);
const newTarget = async () => {
  let t;
  try {
    t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  } catch {
    t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then((r) => r.json());
  }
  trackTarget(PORT, t.id);
  return t;
};

/** A session whose `/api/world-models` reads and verify GLBs are answered HERE. */
async function openWorldSession(metrics) {
  const s = await openSession(await newTarget());
  await s.send("Emulation.setDeviceMetricsOverride", metrics);
  const log = { world: [], glb: {} };
  s.ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method !== "Fetch.requestPaused") return;
    const { requestId, request } = msg.params;
    const url = new URL(request.url);
    if (url.pathname === "/api/world-models") {
      const cells = (url.searchParams.get("cells") ?? "").split(",").filter(Boolean);
      log.world.push(cells);
      const models = WORLD.filter((m) => cells.includes(gh5(m.lat, m.lon)));
      s.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ models, complete: true })).toString("base64"),
      }).catch(() => {});
      return;
    }
    if (request.url.startsWith(GLB_HOST)) {
      const id = url.pathname.slice(1).replace(/\.glb$/, "");
      log.glb[id] = (log.glb[id] ?? 0) + 1;
      const [w, h, d] = SIZES[id] ?? [1, 1, 1];
      s.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "model/gltf-binary" },
          { name: "Access-Control-Allow-Origin", value: "*" },
        ],
        body: boxGlb(w, h, d).toString("base64"),
      }).catch(() => {});
      return;
    }
    s.send("Fetch.continueRequest", { requestId }).catch(() => {});
  });
  await s.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/world-models*" }, { urlPattern: `${GLB_HOST}/*` }] });
  const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
  const shot = async (name) => {
    if (!SHOTS) return;
    mkdirSync("verify-shots", { recursive: true });
    const r = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    writeFileSync(`verify-shots/${name}.jpeg`, Buffer.from(r.data, "base64"));
  };
  const cam = () =>
    J(`(() => { const c = window.__cameraStore.getState(); const g = window.__globe; const p = g.camera.position; return { fpv: c.tempFpv, pin: c.tempPin, hud: c.fpvHud, geo: c.camGeo, pos: [p.x, p.y, p.z], fov: g.camera.fov, clr: g.fpvClearance(), jumps: g.u2().jumpsTotal, pinWrites: window.__pinWrites ?? 0 }; })()`);
  const models = async () => {
    const d = await J(`(() => { const st = window.__userModelsStore.getState(); const d = window.__globe.userModels(); return { cover: st.cover, phase: st.worldPhase, world: st.world.length, models: d.models.map((m) => ({ id: m.id, state: m.state, distM: m.distM, frac: m.frac, inView: m.inView })) }; })()`);
    d.state = Object.fromEntries(d.models.map((m) => [m.id, m.state]));
    return d;
  };
  const look = async (azDeg, altDeg) => {
    await s.evalJs(`window.__cameraStore.getState().requestSkyLook({ azDeg: ${azDeg}, altDeg: ${altDeg} })`);
    await s.waitFor(`window.__cameraStore.getState().skyLook === null`, 20_000, `look ${azDeg}/${altDeg}`).catch(() => {});
    await s.ticks(40);
  };
  return { s, log, J, shot, cam, models, look, settle: (n = 20) => s.ticks(n) };
}
const eyeMoveM = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
const circ = (a, b) => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.abs(d);
};

// ═════════════════════════════════════════════════════════════════════════════════════════════
// A. THE FAR LAW + THE EYE-CENTRED COVER — desktop, the owner's pose
// ═════════════════════════════════════════════════════════════════════════════════════════════
const D = await openWorldSession({ width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
{
  const { s, log, models, look, shot, cam, settle } = D;
  await s.bootUrl(`http://localhost:4321/#f=${EYE.lat},${EYE.lon},96.3,${HEADING}.0,-1.0,5.6`);
  await s.waitFor(`!!window.__globe && !!window.__userModelsStore && window.__cameraStore.getState().fpvHud !== null`, 120_000, "FPV live at the owner's pose");
  await s.waitFor(`window.__userModelsStore.getState().worldPhase === "ready" && window.__userModelsStore.getState().world.length > 0`, 60_000, "the world read answered");
  await s.waitFor(`window.__globe.userModels().loading === 0 && window.__globe.userModels().resident >= 3`, 60_000, "the residents landed").catch(() => {});
  await settle(30);
  const a = await models();
  const hud0 = (await cam()).hud;
  info(`pose: hdg ${hud0.headingDeg.toFixed(1)}° · pitch ${hud0.pitchDeg.toFixed(2)}° · fov ${hud0.fovDeg}° · eye ${hud0.eyeAboveGroundM.toFixed(1)} m`);

  // A1 — the cover is the EYE's square, bigger than one query, inside the cap
  ok(a.cover.length > 16 && a.cover.length <= 96, `the first-person cover is the eye's 16 km square: ${a.cover.length} cells (> 16, ≤ 96)`);
  ok(a.cover.includes(gh5(EYE.lat, EYE.lon)), `…and holds the eye's own cell (${gh5(EYE.lat, EYE.lon)})`);
  const far = offset(EYE, 12_000, HEADING);
  ok(a.cover.includes(gh5(far.lat, far.lon)), `…and a cell 12 km down the view (${gh5(far.lat, far.lon)})`);
  // A2 — asked in chunks the route accepts, together exactly the cover
  const burst = log.world.slice(-Math.ceil(a.cover.length / 16));
  ok(log.world.every((c) => c.length >= 1 && c.length <= 16), `every /api/world-models request names ≤ 16 cells (${log.world.map((c) => c.length).join(" · ")})`);
  ok(JSON.stringify(burst.flat().sort()) === JSON.stringify([...a.cover].sort()), `…and the last burst of ${burst.length} is exactly the cover`);
  ok(a.world === WORLD.length, `the merged world holds all ${WORLD.length} rows once each (${a.world})`);
  // A3 — the far law
  const row = (id) => a.models.find((m) => m.id === id);
  ok(a.state["far-bridge"] === "ready", `a 1.5 km bridge 5 km out, in the frame, is RESIDENT (frac ${row("far-bridge")?.frac?.toFixed(2)}, ${Math.round(row("far-bridge")?.distM)} m — past the 3 km radius)`);
  ok(a.state["far-kiosk"] === "ready", `a 15 m kiosk beside it is resident through the 245 mm lens (frac ${row("far-kiosk")?.frac?.toFixed(3)} ≥ 0.02)`);
  ok(a.state["far-speck"] === "idle", `a 3 m speck beside them is NOT (frac ${row("far-speck")?.frac?.toFixed(4)} < 0.02)`);
  ok(a.state["behind-bridge"] === "idle" && row("behind-bridge")?.inView === false, `the same bridge BEHIND the camera is not fetched (inView ${row("behind-bridge")?.inView})`);
  ok(a.state["past-range"] === "idle", `a bridge 17 km out is known (in the cover) and left alone — past the 16 km range (${Math.round(row("past-range")?.distM)} m)`);
  ok(a.state["near-box"] === "ready", `the radius law is untouched: a box 60 m away, out of the frame, is resident (inView ${row("near-box")?.inView})`);
  await shot("followups-a1-far-law-245mm");

  // A4 — the clip-in-and-out: a nudge of pitch across the limb moves neither the cover nor a model
  const reads0 = log.world.length;
  const glb0 = JSON.stringify(log.glb);
  let stable = true;
  const seen = [];
  for (const alt of [0.6, -3, -0.3, -1]) {
    await look(HEADING, alt);
    const m = await models();
    const focus = await D.J(`(() => { const c = window.__cameraStore.getState(); return { lat: c.focusLatDeg, lon: c.focusLonDeg }; })()`);
    seen.push(`${alt}° → focus ${(distM(EYE, focus) / 1000).toFixed(1)} km`);
    if (JSON.stringify(m.cover) !== JSON.stringify(a.cover) || JSON.stringify(m.state) !== JSON.stringify(a.state)) stable = false;
  }
  ok(stable, `pitch ${seen.join(" · ")}: the cover and every model's state never moved`);
  ok(log.world.length === reads0, `…no world read was issued for it (${log.world.length - reads0} new requests)`);
  ok(JSON.stringify(log.glb) === glb0, `…and no GLB was re-fetched (${JSON.stringify(log.glb)})`);

  // A5 — a pan keeps what it loaded and loads what it now sees
  await look(HEADING + 180, -1);
  await s.waitFor(`window.__globe.userModels().models.find((m) => m.id === "behind-bridge")?.state === "ready"`, 20_000, "the bridge behind loads once looked at").catch(() => {});
  const b = await models();
  ok(b.state["behind-bridge"] === "ready", "panned 180°: the bridge that was behind is resident now");
  ok(b.state["far-bridge"] === "ready" && b.state["far-kiosk"] === "ready", "…and the two the view left are KEPT (no view is needed to keep — a pan must not thrash)");
  ok(JSON.stringify(b.cover) === JSON.stringify(a.cover), "…on the same cover");
  await look(HEADING, -1);
  ok((log.glb["far-bridge"] ?? 0) === 1 && (log.glb["far-kiosk"] ?? 0) === 1, `panned back: nothing was fetched twice (${JSON.stringify(log.glb)})`);

  // A6 — zooming out lets the kiosk go and keeps the bridges
  await s.evalJs(`window.__cameraStore.getState().setFovRate(-1.2)`);
  await s.waitFor(`window.__cameraStore.getState().fpvHud.fovDeg >= 38`, 30_000, "zoomed out to ≥ 38°").catch(() => {});
  await s.evalJs(`window.__cameraStore.getState().setFovRate(null)`);
  await settle(40);
  const c = await models();
  const fovWide = (await cam()).hud.fovDeg;
  ok(fovWide >= 38, `zoomed out to ${fovWide.toFixed(1)}°`);
  ok(c.state["far-kiosk"] === "idle", `…the kiosk is released (frac ${c.models.find((m) => m.id === "far-kiosk")?.frac?.toFixed(4)} < 0.012)`);
  ok(c.state["far-bridge"] === "ready" && c.state["behind-bridge"] === "ready", `…both bridges stay: a third of a normal frame (frac ${c.models.find((m) => m.id === "far-bridge")?.frac?.toFixed(2)})`);
  await shot("followups-a2-far-law-wide");
  ok(s.consoleErrors.length === 0, `no page exception through leg A (${s.consoleErrors.length})`);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B. THE PIN FOLLOWS THE WALKER — desktop
// ═════════════════════════════════════════════════════════════════════════════════════════════
const P0 = { latDeg: 48.467806, lonDeg: 35.071753 }; // the fpv-south pose's ground point (the city)
const P1 = { latDeg: 48.4655, lonDeg: 35.0745 };
{
  const { s, J, cam, shot, settle } = D;
  await s.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await s.evalJs(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${P0.latDeg}, lonDeg: ${P0.lonDeg}, eyeM: 1.7, headingDeg: 90, pitchDeg: 4, fovDeg: 55 })`);
  await s.waitFor(`(() => { const c = window.__cameraStore.getState(); return c.fpvHud !== null && c.tempPin !== null && Math.abs(c.tempPin.latDeg - ${P0.latDeg}) < 1e-6; })()`, 30_000, "FPV at P0");
  await sleep(2500);
  await settle(30);
  await s.evalJs(`(() => { window.__pinWrites = 0; window.__cameraStore.subscribe((st, prev) => { if (st.tempPin !== prev.tempPin) window.__pinWrites++; }); return true; })()`);
  const start = await cam();
  ok(start.fpv && distM(start.pin, P0) < 0.01 && distM(start.geo, P0) < 1, `standing on the pin at P0 (eye ${distM(start.geo, start.pin).toFixed(2)} m from it)`);

  // B1 — the pin stays put WHILE walking
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`);
  await sleep(1200);
  await settle(4);
  const mid = await cam();
  ok(mid.pinWrites === 0 && distM(mid.pin, P0) < 0.01, `mid-stride (${distM(mid.geo, P0).toFixed(1)} m out) the pin has NOT moved — no write per frame (${mid.pinWrites})`);
  // B2 — …and lands on the eye once the walk settles
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
  await sleep(150);
  await settle(3);
  const released = await cam();
  ok(released.pinWrites === 0, `150 ms after the release the pin is still waiting for the settle (${released.pinWrites} writes)`);
  await sleep(900);
  await settle(20);
  const settled = await cam();
  ok(settled.pinWrites === 1, `once settled: exactly ONE pin write for the stroll (${settled.pinWrites})`);
  ok(distM(settled.pin, settled.geo) < 0.15, `…the pin is ON the eye (${(distM(settled.pin, settled.geo) * 100).toFixed(1)} cm apart; it was ${distM(released.geo, released.pin).toFixed(1)} m behind)`);
  ok(distM(settled.pin, P0) > 5, `…${distM(settled.pin, P0).toFixed(1)} m from where the walk started`);
  // B3 — the eye did not move and the look did not change
  ok(eyeMoveM(released, settled) < 0.05, `the re-base moved the eye ${(eyeMoveM(released, settled) * 100).toFixed(2)} cm (< 5 cm)`);
  ok(settled.jumps === released.jumps, `…no single-frame eye jump was logged (u2 jumps ${released.jumps} → ${settled.jumps})`);
  ok(circ(settled.hud.headingDeg, released.hud.headingDeg) < 0.05 && Math.abs(settled.hud.pitchDeg - released.hud.pitchDeg) < 0.05 && Math.abs(settled.hud.eyeAboveGroundM - released.hud.eyeAboveGroundM) < 0.05,
    `…same look: hdg ${settled.hud.headingDeg.toFixed(2)}° · pitch ${settled.hud.pitchDeg.toFixed(2)}° · eye ${settled.hud.eyeAboveGroundM.toFixed(2)} m`);
  // standing still afterwards writes nothing more
  await sleep(1500);
  ok((await cam()).pinWrites === 1, "standing still afterwards writes nothing more");

  // B4 — the arrow keys do the same
  await s.evalJs(`(() => { window.__keyLog = []; for (const t of ["keydown", "keyup", "blur"]) window.addEventListener(t, (e) => window.__keyLog.push(t + ":" + (e.key ?? "") + "@" + Math.round(performance.now()))); return true; })()`);
  await s.send("Page.bringToFront").catch(() => {});
  await s.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 });
  await sleep(900);
  await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 });
  await sleep(1000);
  await settle(20);
  let keyed = await cam();
  // The synthetic key pair is the BROWSER's to deliver: on 2026-09-30 an ageing house Chrome (30 min
  // up, hung at 100 % CPU one run later) dropped the keyUp, the walker never stopped and six later
  // checks fell with it. So the leg reads what the page actually received: both events → assert;
  // a missing one → INFO, release the keys the way the app's own stuck-key safety does (a window
  // blur), and carry on — the key path is the same `keysOn` branch as the stick's `stickOn`.
  const keyLog = JSON.parse(await s.evalJs(`JSON.stringify(window.__keyLog)`));
  const gotDown = keyLog.some((k) => k.startsWith("keydown:ArrowUp"));
  const gotUp = keyLog.some((k) => k.startsWith("keyup:ArrowUp"));
  if (gotDown && gotUp) {
    ok(distM(keyed.geo, settled.geo) > 1 && keyed.pinWrites === 2 && distM(keyed.pin, keyed.geo) < 0.15,
      `an ARROW-KEY walk (${distM(keyed.geo, settled.geo).toFixed(1)} m): the pin followed (${(distM(keyed.pin, keyed.geo) * 100).toFixed(1)} cm, writes ${keyed.pinWrites})`);
  } else {
    info(`the synthetic ArrowUp pair did not both reach the page (${JSON.stringify(keyLog)}) — key leg not asserted; releasing the keys through a window blur`);
    await s.evalJs(`(() => { window.dispatchEvent(new Event("blur")); return true; })()`);
    await sleep(1000);
    await settle(20);
    keyed = await cam();
  }

  // B5 — a point placed ELSEWHERE still moves the viewer there (the long-press path)
  await s.evalJs(`window.__cameraStore.getState().setTempPin({ latDeg: ${P1.latDeg}, lonDeg: ${P1.lonDeg} })`);
  await sleep(700);
  await settle(20);
  const placed = await cam();
  ok(distM(placed.pin, P1) < 0.01 && distM(placed.geo, P1) < 1, `a point placed elsewhere still moves the viewer to it (eye ${distM(placed.geo, P1).toFixed(2)} m from P1) — the long-press is kept`);
  ok(circ(placed.hud.headingDeg, keyed.hud.headingDeg) < 1.5, `…carrying the look (hdg ${placed.hud.headingDeg.toFixed(1)}°)`);

  // B6 — on a mesh roof the re-base keeps the roof (the same column)
  await s.evalJs(`window.__cameraStore.getState().requestFpvJump({ latDeg: ${P0.latDeg}, lonDeg: ${P0.lonDeg}, eyeM: 1.7, headingDeg: 90, pitchDeg: 0, fovDeg: 55 })`);
  await s.waitFor(`(() => { const c = window.__cameraStore.getState(); return c.fpvHud !== null && c.tempPin !== null && Math.abs(c.tempPin.latDeg - ${P0.latDeg}) < 1e-6; })()`, 30_000, "FPV back at P0");
  await sleep(1500);
  await settle(20);
  const boxLon = P0.lonDeg + 20 / (111_320 * Math.cos(P0.latDeg * RAD));
  const box = await J(`window.__globe.fpvTestSolid(${P0.latDeg}, ${boxLon}, 12, 30)`);
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`);
  const t0 = Date.now();
  let lifted = false;
  while (Date.now() - t0 < 6000) {
    await settle(6);
    const c = await cam();
    if (c.clr.floorAbsM !== null && c.clr.lifts > 0) {
      lifted = true;
      break;
    }
  }
  await sleep(250); // a few metres onto the roof
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
  await sleep(120);
  await settle(3);
  const roofBefore = await cam();
  await sleep(1000);
  await settle(20);
  const roof = await cam();
  ok(lifted && roofBefore.clr.floorAbsM !== null, `walked onto a 12 m test solid (floor ${roofBefore.clr.floorAbsM?.toFixed(2)} m, top ${box.topM.toFixed(2)} m)`);
  ok(distM(roof.pin, roof.geo) < 0.15, `on the roof the pin followed (${(distM(roof.pin, roof.geo) * 100).toFixed(1)} cm from the eye)`);
  ok(roof.clr.floorAbsM !== null && Math.abs(roof.clr.floorAbsM - box.topM) < 0.6 && Math.abs(roof.hud.eyeAboveGroundM - 1.7) < 0.1,
    `…and the viewer still STANDS on it: floor ${roof.clr.floorAbsM?.toFixed(2)} m, eye ${roof.hud.eyeAboveGroundM.toFixed(2)} m above it (the mesh floor is kept)`);
  ok(eyeMoveM(roofBefore, roof) < 0.05 && roof.jumps === roofBefore.jumps, `…without the eye moving (${(eyeMoveM(roofBefore, roof) * 100).toFixed(2)} cm, jumps ${roofBefore.jumps} → ${roof.jumps})`);
  await s.evalJs(`window.__globe.fpvTestSolid(null)`);
  await settle(10);

  // B7 — with the MAP window up: one point on the chart, and the target glyph on the round button
  await s.evalJs(`window.__minimapStore.getState().setMapWindowOpen(true)`);
  await s.waitFor(`!!document.querySelector(".mw-recenter")`, 10_000, "the map window");
  await sleep(1200);
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 1, right: 0 })`); // chart-up = north
  await sleep(1000);
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
  await sleep(1100);
  await settle(20);
  const onMap = await cam();
  ok(distM(onMap.geo, roof.geo) > 3 && onMap.geo.latDeg > roof.geo.latDeg, `with the MAP up the walk is chart-relative (north, ${distM(onMap.geo, roof.geo).toFixed(1)} m)`);
  ok(distM(onMap.pin, onMap.geo) < 0.15, `…and the pin ring sits on the eye dot (${(distM(onMap.pin, onMap.geo) * 100).toFixed(1)} cm) — one point on the chart, not two`);
  const rec = await J(`(() => { const b = document.querySelector(".mw-recenter"); const r = b.getBoundingClientRect(); const i = b.querySelector("svg.mw-recenter__icon"); const ir = i?.getBoundingClientRect(); const cs = getComputedStyle(b); return { text: b.textContent.trim(), w: r.width, h: r.height, radius: cs.borderTopLeftRadius, rem: parseFloat(getComputedStyle(document.documentElement).fontSize), icon: ir ? { w: ir.width, h: ir.height, cx: ir.left + ir.width / 2 - (r.left + r.width / 2), cy: ir.top + ir.height / 2 - (r.top + r.height / 2) } : null, shapes: i ? [...i.children].map((c) => c.tagName.toLowerCase()) : [], stroke: i ? getComputedStyle(i).stroke : null, color: cs.color, label: b.getAttribute("aria-label") }; })()`);
  ok(rec.icon !== null && rec.text === "" && rec.shapes.join() === "circle,circle,path", `RE-CENTRE wears the drawn target (ring · dot · ticks: ${rec.shapes.join(" ")}), no ◉ character`);
  ok(Math.abs(rec.w - 2.1 * rec.rem) < 0.6 && Math.abs(rec.h - rec.w) < 0.1, `…inside the SAME round button: ${rec.w.toFixed(1)} × ${rec.h.toFixed(1)} px = 2.1rem, as before`);
  ok(rec.icon && rec.icon.w < rec.w - 8 && Math.abs(rec.icon.cx) < 0.6 && Math.abs(rec.icon.cy) < 0.6, `…centred in it (${rec.icon?.w.toFixed(1)} px icon, off-centre ${rec.icon?.cx.toFixed(2)} / ${rec.icon?.cy.toFixed(2)} px)`);
  ok(rec.stroke === rec.color && rec.label === "Centre the map on me", `…drawn in the button's own colour (${rec.stroke}) and labelled "${rec.label}"`);
  await shot("followups-b1-map-window-desktop");
  await s.evalJs(`window.__minimapStore.getState().setMapWindowOpen(false)`);
  await s.evalJs(`window.__cameraStore.getState().setTempFpv(false)`);
  await sleep(600);
  ok(s.consoleErrors.length === 0, `no page exception through leg B (${s.consoleErrors.length})`);
  s.close();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C. /m — the stick over the fullscreen map, the target glyph on the phone
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  const M = await openWorldSession({ width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
  const { s, J, cam, shot, settle } = M;
  await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s.bootUrl(`http://localhost:4321/m#f=${P0.latDeg},${P0.lonDeg},1.7,90.0,2.0,55.0`);
  await s.waitFor(`!!window.__globe && window.__cameraStore.getState().fpvHud !== null && window.__cameraStore.getState().tempPin !== null`, 120_000, "/m FPV live");
  await sleep(3000);
  await settle(30);
  await s.evalJs(`window.__minimapStore.getState().setMapWindowOpen(true)`);
  await s.waitFor(`!!document.querySelector(".mw-recenter")`, 10_000, "the /m fullscreen map");
  await sleep(1200);
  const before = await cam();
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput({ fwd: 0.8, right: 0.4 })`);
  await sleep(1200);
  await s.evalJs(`window.__cameraStore.getState().setFpvWalkInput(null)`);
  await sleep(1100);
  await settle(20);
  const after = await cam();
  ok(distM(after.geo, before.geo) > 2, `/m: the stick walked ${distM(after.geo, before.geo).toFixed(1)} m over the fullscreen map`);
  ok(distM(after.pin, after.geo) < 0.15, `/m: the pin followed (${(distM(after.pin, after.geo) * 100).toFixed(1)} cm from the eye; it started ${distM(before.pin, after.geo).toFixed(1)} m away)`);
  const rec = await J(`(() => { const b = document.querySelector(".mw-recenter"); const r = b.getBoundingClientRect(); const i = b.querySelector("svg.mw-recenter__icon"); const ir = i?.getBoundingClientRect(); const alt = document.querySelector(".m-altcol")?.getBoundingClientRect(); return { text: b.textContent.trim(), w: r.width, h: r.height, bottom: r.bottom, right: r.right, vw: innerWidth, icon: ir ? { w: ir.width, h: ir.height } : null, altTop: alt ? alt.top : null, align: !!document.querySelector(".m-aralign, [data-act='ar-align']") }; })()`);
  ok(rec.icon !== null && rec.text === "" && Math.abs(rec.w - rec.h) < 0.1 && rec.icon.w < rec.w, `/m: the round RE-CENTRE (${rec.w.toFixed(1)} × ${rec.h.toFixed(1)} px) wears the target icon (${rec.icon?.w.toFixed(1)} px)`);
  ok(rec.altTop === null || rec.bottom <= rec.altTop + 0.5, `/m: …and still clears the altitude column (button bottom ${rec.bottom.toFixed(1)} ≤ column top ${rec.altTop?.toFixed(1)})`);
  ok(rec.align === false, "/m: no ALIGN cell in the first-person chrome");
  await shot("followups-c1-map-window-mobile");
  ok(s.consoleErrors.length === 0, `no page exception through leg C (${s.consoleErrors.length})`);
  s.close();
}

console.log(notes.join("\n"));
if (fails.length) console.log(fails.join("\n"));
console.log(`\nverify-followups-2026-09-30: ${notes.filter((n) => n.startsWith("  PASS")).length} PASS · ${fails.length} FAIL`);
await finishVerify(fails.length ? 1 : 0);
