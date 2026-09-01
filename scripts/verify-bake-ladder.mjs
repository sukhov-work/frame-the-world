// Browser verification for RENDERING CHARTER Group D — RC13 (base skirt) + RC17 (meta.json
// sidecar consumption), shipped 2026-08-26 across all five building bakes.
//
// Usage: wix dev on :4321 + CDP Chrome (node scripts/verify-chrome.mjs --headless --port 9333
// --profile /tmp/ftw-cdp), then  node --experimental-websocket scripts/verify-bake-ladder.mjs
// [cdpPort] [shotsDir]
//
// WHAT THIS EXISTS TO CATCH. Every claim below is one a passing unit test cannot make. The sidecar
// is fetched over HTTP by a 3d-tiles-renderer plugin, parsed in the browser, and consumed inside a
// load-model handler that vitest cannot reach; the skirt only means anything against real streamed
// geometry. Two of the checks are specifically shaped against FALSE PASSES:
//
//   · A pick fence reads as "working" whether it is fencing on the class token or still falling
//     back to the 2.5 m height floor. So the sidecar coverage is asserted FIRST and separately —
//     a run where `metaCells` is 0 must fail loudly rather than report a green pick.
//   · `?v=` cache-busting is invisible when it works. The check asserts the versioned URL is what
//     the network actually requested, because an `endsWith(".glb")` predicate that stopped
//     matching would silently drop both the force-cache claim and the sidecar prime.
import { writeFileSync, mkdirSync } from "node:fs";
import { trackTarget, finishVerify, VerifyFailure } from "./verify-cdp-cleanup.mjs";

const PORT = process.argv[2] ?? "9333";
const SHOTS = process.argv[3] ?? "verify-shots";
mkdirSync(SHOTS, { recursive: true });

const BASE = "http://localhost:4321/";
// Central Dnipro from 700 m on a low oblique — dense enough that a cell holds hundreds of
// features, and the default variant here is dnipro-o2w, which is the one with the street
// furniture RC17 fences. Fixed scene time so lighting is reproducible.
const POSE = "#p=48.4647,35.0462,700,35,60&t=1782032400000";

const http = (path, method = "GET") =>
  fetch(`http://127.0.0.1:${PORT}${path}`, { method }).then((r) => r.json());

let target;
try {
  target = await http("/json/new?about:blank", "PUT");
} catch {
  target = await http("/json/new?about:blank", "GET");
}
trackTarget(PORT, target.id);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let seq = 0;
const pending = new Map();
let net = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Network.responseReceived") {
    net.push({ url: msg.params.response.url, status: msg.params.response.status });
    return;
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
    // Every CDP call is bounded: an unbounded Runtime.evaluate once turned a page stall into a
    // fifty-minute silent hang (standing trap, NEXT_SESSION_PROMPT).
    setTimeout(() => {
      if (pending.delete(id)) rej(new Error(`CDP timeout: ${method}`));
    }, 90_000);
  });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shoot = async (name) => {
  const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(shot.data, "base64"));
  console.log(`  shot: ${SHOTS}/${name}`);
};
const fail = (msg) => {
  throw new VerifyFailure(msg);
};
let passed = 0;
const ok = (label, extra = "") => {
  passed++;
  console.log(`  ✓ ${label}${extra ? "  " + extra : ""}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

async function goto(url, settleMs = 16000) {
  await send("Page.navigate", { url: "about:blank" }); // hash-only navigations do NOT reload
  await sleep(400);
  net = [];
  await send("Page.navigate", { url });
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await evalJs("!!window.__globe").catch(() => false)) break;
  }
  if (!(await evalJs("!!window.__globe"))) fail(`__globe never appeared at ${url}`);
  await sleep(settleMs);
}

/** Poll `probe` until `done`, up to `tries` seconds — cells stream in well after __globe exists. */
async function until(probe, done, tries = 40) {
  let v = null;
  for (let i = 0; i < tries; i++) {
    v = await probe();
    if (done(v)) return v;
    await sleep(1000);
  }
  return v;
}

console.log(`\n▶ verify-bake-ladder (RC13 + RC17)  ${BASE}${POSE}`);

// ── 1 · the versioned content uri is what the network actually requested ───────────────────────
await goto(BASE + POSE);
const glbs = net.filter((r) => /\/enriched\/.*\.glb(\?|$)/.test(r.url));
if (glbs.length === 0) fail("no enriched cell glbs streamed at all — nothing below can be trusted");
const versioned = glbs.filter((r) => /\.glb\?v=/.test(r.url));
if (versioned.length !== glbs.length)
  fail(`${glbs.length - versioned.length} of ${glbs.length} cell glbs were requested WITHOUT the ?v= cache-buster`);
ok("every cell glb carries the ?v= cache-buster", `${glbs.length} glbs, e.g. ${versioned[0].url.split("/").pop()}`);

// ── 2 · the sidecars were fetched, versioned in step with their glbs, and none 404'd ───────────
// Asserted BEFORE any pick check: if this is zero, a green pick below would just be the old
// height floor answering, and the whole run would be a false pass.
const metas = net.filter((r) => /\/enriched\/.*\.meta\.json(\?|$)/.test(r.url));
if (metas.length === 0)
  fail("ZERO .meta.json requests — the fetch plugin never primed a sidecar (RC17 is inert)");
const metaBad = metas.filter((r) => r.status >= 400);
if (metaBad.length) fail(`sidecar requests failed: ${JSON.stringify(metaBad.slice(0, 3))}`);
const metaUnversioned = metas.filter((r) => !/\.meta\.json\?v=/.test(r.url));
if (metaUnversioned.length)
  fail(`${metaUnversioned.length} sidecars fetched without ?v= — they would outlive their own bake`);
ok("sidecars fetched, versioned, zero errors", `${metas.length} requests`);

// ── 3 · the runtime PARSED them — coverage, not just traffic ───────────────────────────────────
const seats = await until(
  () => evalJs(`(() => { const d = window.__globe.enrichedSeats(); return {
      cells: d.cells, metaCells: d.metaCells, metaMissing: d.metaMissing, metaFeatures: d.metaFeatures,
      features: d.features }; })()`),
  (v) => v && v.metaCells > 0,
);
if (!seats || !seats.metaCells)
  fail(`enrichedSeats reports metaCells=${seats?.metaCells} over ${seats?.cells} cells — sidecars arrived but none parsed`);
if (seats.metaMissing > 0)
  fail(`${seats.metaMissing} cells resolved to NO meta (404 or a refused schema) on a freshly re-baked variant`);
ok("sidecars parsed for every loaded cell", `${seats.metaCells} cells, ${seats.cells} loaded, 0 missing`);

// ── 4 · the class token is live, and it is fencing something real ──────────────────────────────
const cls = seats.metaFeatures ?? {};
const total = Object.values(cls).reduce((a, x) => a + x, 0);
const buildings = Object.entries(cls).filter(([k]) => k.startsWith("Building")).reduce((a, [, v]) => a + v, 0);
const fenced = total - buildings;
if (total === 0) fail("the class histogram is empty — no feature carries a class token");
if (fenced === 0)
  fail(`every one of ${total} loaded features is a Building — this pose cannot demonstrate the fence; move it`);
ok("class tokens live on loaded features", `${total} features, ${fenced} non-Building now fenced (${Object.keys(cls).length} classes)`);

// ── 5 · RC13: the skirt is in the geometry, and the reported height is NOT ──────────────────────
// The two halves of the same claim. The vertices must reach below the base (or the skirt did not
// bake), and `topY - baseY` must still be the building's real height (or the sidecar's
// skirt-undo is not being applied and every reported height is 4 m too tall).
const skirt = await evalJs(`window.__globe.enrichedSeats().skirt ?? null`);
if (skirt === null) fail("enrichedSeats().skirt is unavailable — the DEV seam this check needs does not exist");
if (!skirt.n) fail("enrichedSeats().skirt saw zero features");
if (!(skirt.minVertexY <= -3.5))
  fail(`lowest baked vertex is ${skirt.minVertexY} m; a 4 m skirt should reach about −4 (RC13 did not bake)`);
if (!(skirt.baseYMin >= -0.75))
  fail(`lowest reported BASE is ${skirt.baseYMin} m — the skirt is being counted as building (RC17 undo not applied)`);
if (skirt.heightMaxM > 400)
  fail(`a feature reports ${skirt.heightMaxM} m of height — the skirt is inflating reported heights`);
ok(
  "skirt is in the geometry but not in the reported height",
  `vertices reach ${skirt.minVertexY} m · bases stay ≥ ${skirt.baseYMin} m · ${skirt.n} features`,
);
await shoot("bakeladder-01-dnipro-o2w-street.jpeg");

// ── 6 · the pick fence: a fenced class is not pickable, a building still is ─────────────────────
const picks = await evalJs(`window.__globe.enrichedSeats().pickFence ?? null`);
if (picks === null) fail("enrichedSeats().pickFence is unavailable");
if (!picks.armable) fail(`zero features would arm a pick — the fence is rejecting everything (${JSON.stringify(picks)})`);
if (picks.classed !== picks.features)
  fail(`${picks.features - picks.classed} loaded features carry no class token on a freshly re-baked variant`);
// The claim that is NOT a tautology: the old height floor admitted MORE than the class token
// does, and the difference is the street furniture that used to be rescalable.
if (picks.reclaimed <= 0)
  fail(
    `the class fence refuses nothing the 2.5 m floor admitted (armable ${picks.armable} vs oldFloor ${picks.oldFloorArmable}) — ` +
      `either the fence is inert or this pose has no street furniture in it`,
  );
ok(
  "pick fence is on the class token",
  `${picks.armable} armable of ${picks.features} · ${picks.reclaimed} non-building features RECLAIMED from the old 2.5 m floor`,
);

// ── 7 · the classic variant carries the SAME schema (the A/B seam, not just the default) ───────
await goto(BASE + "?enriched=dnipro" + POSE);
const cMetas = net.filter((r) => /\/enriched\/dnipro\/.*\.meta\.json/.test(r.url) && r.status === 200);
if (cMetas.length === 0) fail("?enriched=dnipro streamed no sidecars — the extruder bake's writer half is not landing");
const cSeats = await until(
  () => evalJs(`(() => { const d = window.__globe.enrichedSeats(); return { metaCells: d.metaCells, metaFeatures: d.metaFeatures }; })()`),
  (v) => v && v.metaCells > 0,
);
if (!cSeats?.metaCells) fail("the classic bake's sidecars arrived but none parsed");
const cCls = Object.keys(cSeats.metaFeatures ?? {});
if (cCls.length !== 1 || cCls[0] !== "Building")
  fail(`the extruder bake should class everything "Building"; saw ${JSON.stringify(cCls)}`);
ok("classic variant carries the unified schema too", `${cSeats.metaCells} cells, classes ${JSON.stringify(cCls)}`);
await shoot("bakeladder-02-dnipro-classic.jpeg");

console.log(`\n✓ verify-bake-ladder: ${passed}/${passed} checks passed`);
await finishVerify();
