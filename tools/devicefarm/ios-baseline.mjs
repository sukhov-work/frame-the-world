#!/usr/bin/env node
/**
 * T77 step 1b — the PHONE BASELINE on AWS Device Farm (iPhone 17 Pro), driven from this Mac.
 *
 * `rendering/IPHONE_BASELINE_CHECKLIST_2026-09-05.md` §B, automated: a Device Farm REMOTE ACCESS
 * session exposes an Appium endpoint for the device (docs: appium-endpoint.html — "Test a web app by
 * specifying the `browserName` capability … `Safari` on iOS"; the URL comes back as
 * `endpoints.remoteDriverEndpoint` from GetRemoteAccessSession). WebdriverIO drives Safari on the
 * real phone; `executeScript` reads `window.__debugFeed.snapshot()` — the runtime read seam built
 * for exactly this — and the Mac seeds / removes the model-ramp rows against its own `wix dev`.
 * Device Farm records video + device syslog for the session (the console shows both).
 *
 *   cd tools/devicefarm && npm install                       # once
 *   node ios-baseline.mjs --host https://<tunnel-host> \
 *        [--project-arn arn:aws:devicefarm:us-west-2:…:project:…] [--device "iPhone 17 Pro"] \
 *        [--session-arn <reuse a RUNNING session>] [--keep-session] [--poses fpv,orbit,city,everest,m] \
 *        [--ramp 6,12,24,36] [--soak-min 8] [--soak-no-reboot] [--settle 30] [--label farm] [--dry-run]
 *
 * Preconditions on the Mac: `wix dev --allowed-hosts <tunnel-host>` on :4321 and a tunnel to it
 * (`cloudflared tunnel --url http://localhost:4321` — no interstitial page; or ngrok on a paid plan —
 * the free plan shows a "visit site" interstitial a scripted Safari would have to click through);
 * AWS credentials for a principal allowed `devicefarm:*` on the project — on this Mac the profile
 * is `plux` (`AWS_PROFILE=plux node …`; region us-west-2 is set in it). It carries the account's
 * ROOT key (owner 2026-09-06): this tool calls ONLY Device Farm List/Get/Create/Stop, never prints
 * or stores a credential, and nothing under the repo reads `~/.aws`. Node ≥ 20. The DEV seams exist over the tunnel
 * because it serves `wix dev` (a DEV build) — `__debugFeed` is published unconditionally there.
 *
 * Billing: a remote access session is metered per device minute from RUNNING to stop (the free
 * trial's 1,000 minutes cover it); the hard cap is 150 min; 5 idle minutes end it. This script
 * STOPS the session in `finally` unless --keep-session. Every Appium command has a 4-minute limit
 * (waits are Mac-side polls). Every seeded model row is removed in `finally` (the world is
 * PRODUCTION); the ids are journaled to verify-shots/perf/seeds-farm-<stamp>.json.
 *
 * What it records per pose (JSON → verify-shots/perf/devicefarm-<label>-<stamp>.json):
 *   the snapshot (tier, dpr, shadow px, frame.dt/cpu/draw p50/p95 — `frame.gpu` is absent on iOS
 *   (no EXT_disjoint_timer_query), calls, tris, renderer.info gauges, LRU MB, composites, models),
 *   screen + DPR + renderer string, a boot marker proving the page did NOT reload during the read,
 *   a screenshot. The RAMP: the last model count that survived 20 s settled, the first that reloaded
 *   Safari (the jetsam kill), whether tiles stormed before it. The SOAK: a snapshot every 30 s for
 *   --soak-min minutes with a synthetic look-around between reads; --soak-no-reboot soaks the fpv page
 *   ALREADY UP (poses ending in fpv, --ramp 0) — one page's survival, not the second-load shape (T83).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";
import {
  DeviceFarmClient,
  ListDevicesCommand,
  ListDevicePoolsCommand,
  ListProjectsCommand,
  CreateRemoteAccessSessionCommand,
  GetRemoteAccessSessionCommand,
  StopRemoteAccessSessionCommand,
} from "@aws-sdk/client-device-farm";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d;
};
const HOST = (opt("--host", "") || "").replace(/\/$/, "");
const PROJECT_ARN = opt("--project-arn", process.env.DEVICEFARM_PROJECT_ARN ?? null);
const DEVICE_MODEL = opt("--device", "iPhone 17 Pro");
const SESSION_ARN = opt("--session-arn", null);
const KEEP = flag("--keep-session");
const DRY = flag("--dry-run");
const POSES = opt("--poses", "fpv,orbit,city,everest,m").split(",");
const RAMP = opt("--ramp", "6,12,24,36").split(",").map(Number).filter((n) => n > 0);
const SOAK_MIN = Number(opt("--soak-min", "8"));
// --soak-no-reboot: soak the page that is ALREADY UP (the last pose must be fpv and the ramp empty) —
// T83 needs ONE page's survival, and the default soak's re-boot is the second `#f=` load that jetsam kills.
const SOAK_NO_REBOOT = flag("--soak-no-reboot");
const SETTLE_S = Number(opt("--settle", "30"));
// 2026-09-07h — the two MOBILE legs (owner order 2026-09-07g), run after the poses and before the
// ramp: `bestspot` = the heatmap armed on /m at the Dnipro pose (the solve ladder to 3 m, the sheet
// up, a 90 s hold with the page-age/frame readings — the jetsam question); `ar` = AR look-around in
// mobile FPV (the permission sheet under Appium, whether real sensor samples flow, which rung the
// phone lands on, the compass fields' presence). `--legs bestspot,ar` (default none).
const LEGS = (opt("--legs", "") || "").split(",").filter(Boolean);
const BESTSPOT_HOLD_S = Number(opt("--bestspot-hold", "90"));
// T130 (owner order 2026-09-08b — the device campaign): `stress` = the owner's T123 sequence on ONE
// /m page (never re-navigated): N cycles of FPV in at a Dnipro spot → look-around → FPV out → the
// heatmap armed at the spot → off, a snapshot per stage (page age, LRU bytes, textures, geometries,
// models, frame time, the boot marker) — GROWTH vs CEILING is read off the per-cycle rows; the syslog
// jetsam line is read after the session (`aws devicefarm list-artifacts`). `t124` = the owner's
// altanka pose in /m FPV, the `models.*` rows and the model's own residency read through the failure.
const STRESS_CYCLES = Number(opt("--stress-cycles", "8"));
const STRESS_SETTLE_S = Number(opt("--stress-settle", "20"));
const T124_TITLE = opt("--t124-title", "altanka");
const LABEL = opt("--label", "farm");
const DEV = "http://localhost:4321"; // the Mac's own wix dev — for dev-seed and the tunnel preflight
const OWNER_EMAIL = opt("--owner", "yevhens@wix.com");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
// Anchored to THIS FILE, not the cwd: the README runs the tool from the repo root, and a cwd-relative
// "../../" landed farm1's first JSON outside the repo (2026-09-06).
const OUT_DIR = fileURLToPath(new URL("../../verify-shots/perf", import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
if (!HOST && !DRY) throw new Error("--host https://<tunnel-host> is required (the phone cannot reach localhost)");

const T_FPV = 1787133600000;
const T_ULTRA = Date.UTC(2026, 7, 21, 9, 40);
const T_M = 1787313600000;
const POSE_URL = {
  fpv: `${HOST}/#f=48.4647,35.0462,1.7,25,8,60&t=${T_FPV}`,
  orbit: `${HOST}/#p=48.4647,35.0462,700,25,40&t=${T_FPV}`,
  city: `${HOST}/#p=48.464,35.046,900,74,300&t=${T_ULTRA}`,
  everest: `${HOST}/#p=27.87,86.83,11500,76,35&t=${T_ULTRA}`,
  m: `${HOST}/m#p=48.4640,35.0460,220,0,0&t=${T_M}`,
  // the /m shell at the FPV eye — the AR chip lives on /m only (2026-09-07h)
  mfpv: `${HOST}/m#f=48.4647,35.0462,1.7,25,8,60&t=${T_FPV}`,
  // T124 (owner report 2026-09-08b): the pose where the user mesh "altanka" vanished in iPhone FPV
  t124: `${HOST}/m#f=48.463651,35.039833,1.7,304.9,1.7,10.8&t=1788874369380`,
};
// T123 / T130: the stress spots — real Dnipro FPV stands from the pose catalogue (scripts/lib/poses.mjs)
// + the T124 stand; the cycle walks them in order and wraps.
const STRESS_SPOTS = [
  { id: "eye", lat: 48.4647, lon: 35.0462 },
  { id: "west-sunset", lat: 48.464627, lon: 35.064907 },
  { id: "south", lat: 48.467806, lon: 35.071753 },
  { id: "altanka", lat: 48.463651, lon: 35.039833 },
];
const EYE = { lat: 48.4647, lon: 35.0462 };
const GLB = {
  url: "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb",
  glbBytes: 3_773_916,
  tris: 15_452,
  meshes: 1,
  textures: 5,
  bbox: [2, 2, 2],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const results = { stamp: STAMP, label: LABEL, host: HOST, device: DEVICE_MODEL, poses: {}, ramp: [], soak: [], notes: [] };
const save = () => writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}.json`, JSON.stringify(results, null, 2));

// ─── seeds (the Mac's wix dev; the world is PRODUCTION) ─────────────────────────────────────
const seedIds = [];
const journal = `${OUT_DIR}/seeds-farm-${STAMP}.json`;
const seedTo = async (N) => {
  while (seedIds.length < N) {
    const i = seedIds.length;
    const bearing = ((360 * i) / N + 15) * (Math.PI / 180);
    const rad = 20 + 40 * (((i * 7) % N) / N);
    const body = {
      kind: "model",
      ownerEmail: OWNER_EMAIL,
      model: {
        fileId: `plux-t77-farm-${STAMP}-${i}.glb`, thumbnailFileId: null, title: `T77 farm ${i}`, fileName: null, sourceFormat: "glb", rawBytes: null,
        glbBytes: GLB.glbBytes, tris: GLB.tris, meshes: GLB.meshes, textures: GLB.textures, decimatedFromTris: null, bbox: GLB.bbox,
        lat: EYE.lat + (rad * Math.cos(bearing)) / 111_320,
        lon: EYE.lon + (rad * Math.sin(bearing)) / (111_320 * Math.cos((EYE.lat * Math.PI) / 180)),
        url: GLB.url,
      },
    };
    const r = await fetch(`${DEV}/api/dev-seed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const b = await r.json().catch(() => null);
    if (r.status !== 200 || !b?.modelId) throw new Error(`dev-seed ${i} → ${r.status} ${JSON.stringify(b)}`);
    seedIds.push(b.modelId);
    writeFileSync(journal, JSON.stringify({ stamp: STAMP, ids: seedIds }, null, 2));
  }
  await sleep(1500); // Wix Data reads lag writes ~1 s
};
const unseedAll = async () => {
  let n = 0;
  for (const id of seedIds.splice(0)) {
    const r = await fetch(`${DEV}/api/dev-seed?kind=model&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const b = await r.json().catch(() => null);
    if (b?.deleted === true) n++;
    else console.error(`  seed ${id} NOT removed: ${r.status} ${JSON.stringify(b)}`);
  }
  writeFileSync(journal, JSON.stringify({ stamp: STAMP, ids: seedIds }, null, 2));
  return n;
};

// ─── preflight: the tunnel must serve the same wix dev the seeds go to ──────────────────────
async function preflight() {
  const local = await fetch(`${DEV}/api/ping`).then((r) => r.status).catch(() => null);
  if (local !== 200) {
    if (DRY) {
      log(`(dry run) wix dev is not answering on ${DEV}/api/ping — the AWS half is checked anyway; start it before a real run`);
      return;
    }
    throw new Error(`wix dev is not answering on ${DEV}/api/ping (${local})`);
  }
  if (DRY) return;
  const viaTunnel = await fetch(`${HOST}/api/ping`, { redirect: "manual" }).then((r) => ({ status: r.status, server: r.headers.get("server"), ct: r.headers.get("content-type") })).catch((e) => ({ error: String(e) }));
  log("tunnel preflight", JSON.stringify(viaTunnel));
  if (viaTunnel.status !== 200) throw new Error(`the tunnel does not serve wix dev: ${JSON.stringify(viaTunnel)} — is \`wix dev --allowed-hosts ${new URL(HOST).host}\` running?`);
  const html = await fetch(`${HOST}/`).then((r) => r.text()).catch(() => "");
  if (/ngrok/i.test(html) && /visit site|browser warning/i.test(html)) throw new Error("the ngrok free interstitial is in the way — use cloudflared, or ngrok with a paid plan");
}

// ─── the Device Farm session ────────────────────────────────────────────────────────────────
const df = new DeviceFarmClient({ region: "us-west-2" }); // credentials: the SDK default chain — AWS_PROFILE=plux on this Mac
if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) log('no AWS_PROFILE set — on this Mac use `AWS_PROFILE=plux node ios-baseline.mjs …`');
async function resolveProject() {
  if (PROJECT_ARN) return PROJECT_ARN;
  const { projects } = await df.send(new ListProjectsCommand({}));
  if (!projects?.length) throw new Error("no Device Farm project — create one in the console (us-west-2) or pass --project-arn");
  if (projects.length > 1) log(`several projects; using "${projects[0].name}" — pass --project-arn to choose`);
  return projects[0].arn;
}
async function pickDevice() {
  let nextToken;
  const found = [];
  do {
    const page = await df.send(new ListDevicesCommand({ filters: [{ attribute: "MODEL", operator: "CONTAINS", values: [DEVICE_MODEL] }, { attribute: "PLATFORM", operator: "EQUALS", values: ["IOS"] }], nextToken }));
    for (const d of page.devices ?? []) found.push(d);
    nextToken = page.nextToken;
  } while (nextToken);
  if (!found.length) throw new Error(`no iOS device matching "${DEVICE_MODEL}" in the Device Farm fleet — check the fleet page`);
  for (const d of found) log(`  fleet: ${d.name} os ${d.os} ${d.resolution?.width}×${d.resolution?.height} mem ${d.memory ? (d.memory / 1e9).toFixed(0) + " GB" : "?"} availability ${d.availability} remoteAccess ${d.remoteAccessEnabled} fleet ${d.fleetType ?? "?"}`);
  const avail = found.filter((d) => d.remoteAccessEnabled && d.availability !== "TEMPORARY_NOT_AVAILABLE" && d.availability !== "BUSY");
  const d = (avail.length ? avail : found)[0];
  log(`device → ${d.name} (${d.os}) ${d.availability}`);
  return d;
}
/** Dry run only: the project's device pools (the owner's single-device pool should name the phone). */
async function showPools(projectArn) {
  const { devicePools } = await df.send(new ListDevicePoolsCommand({ arn: projectArn, type: "PRIVATE" })).catch(() => ({ devicePools: [] }));
  for (const pool of devicePools ?? []) log(`  pool "${pool.name}" (${pool.type}): ${(pool.rules ?? []).map((r) => `${r.attribute} ${r.operator} ${r.value}`).join("; ")}`);
  if (!devicePools?.length) log("  (no private device pools listed for this project — remote access picks a device directly, pools are for automated runs)");
}
/** The owner's own device pool names THE device (an `ARN IN [...]` rule) — prefer it over a MODEL
 *  match, so the session lands on the phone they chose in the console. */
async function poolDevice(projectArn) {
  const { devicePools } = await df.send(new ListDevicePoolsCommand({ arn: projectArn, type: "PRIVATE" })).catch(() => ({ devicePools: [] }));
  for (const pool of devicePools ?? []) {
    for (const r of pool.rules ?? []) {
      if (r.attribute !== "ARN") continue;
      let arns = [];
      try {
        arns = JSON.parse(r.value);
      } catch {
        arns = [];
      }
      for (const arn of arns) {
        const { devices } = await df.send(new ListDevicesCommand({ filters: [{ attribute: "ARN", operator: "IN", values: [arn] }] })).catch(() => ({ devices: [] }));
        const d = devices?.[0];
        if (d && d.platform === "IOS" && d.remoteAccessEnabled) {
          log(`pool "${pool.name}" → ${d.name} (${d.os}) ${d.availability}`);
          return d;
        }
      }
    }
  }
  return null;
}
async function openSession(projectArn) {
  if (SESSION_ARN) return SESSION_ARN;
  const device = (await poolDevice(projectArn)) ?? (await pickDevice());
  const resp = await df.send(new CreateRemoteAccessSessionCommand({
    projectArn,
    deviceArn: device.arn,
    name: `T77 phone baseline ${STAMP}`,
    // iOS 27+ requires the server version to be set; 3 is the current major.
    configuration: { parameters: { "appium:version": "3" } },
  }));
  const arn = resp.remoteAccessSession.arn;
  log(`remote access session ${arn} → ${resp.remoteAccessSession.status}`);
  return arn;
}
async function waitRunning(arn) {
  const t0 = Date.now();
  while (Date.now() - t0 < 600_000) {
    const { remoteAccessSession: s } = await df.send(new GetRemoteAccessSessionCommand({ arn }));
    if (s.status === "RUNNING") {
      const ep = s.endpoints?.remoteDriverEndpoint;
      if (!ep) throw new Error("the session is RUNNING but has no remoteDriverEndpoint — update the AWS SDK / check the console's Appium endpoint");
      log(`RUNNING — device ${s.device?.name} ${s.device?.os}; interactive ${s.endpoints?.interactiveEndpoint ? "yes" : "no"}`);
      return { endpoint: ep, session: s };
    }
    if (s.status === "STOPPING" || s.status === "COMPLETED") throw new Error(`session ended early: ${s.status} ${s.message ?? ""}`);
    log(`session ${s.status}…`);
    await sleep(5000);
  }
  throw new Error("timed out waiting for the session to be RUNNING");
}

// ─── the phone probes (all run INSIDE Safari via executeScript; each < 4 min) ────────────────
// A COMMA expression, not statements: `js()` wraps every probe in `return (…)` and JavaScriptCore rejects
// `return (a; b)` with "Expected ')' to end a compound expression" (farm1 attempt 1, 2026-09-06).
const BOOT_MARK = `(window.__t77boot = ${JSON.stringify(STAMP)}, sessionStorage.setItem("t77", ${JSON.stringify(STAMP)}), true)`;
const READY = `!!(window.__debugFeed && (window.__globe || document.querySelector("canvas")))`;
const SNAP = `(() => {
  const f = window.__debugFeed; if (!f) return { err: "no __debugFeed" };
  const s = f.snapshot();
  const pick = (k) => s[k];
  return {
    booted: window.__t77boot === ${JSON.stringify(STAMP)},
    tier: pick("canvas.tier"), deviceTier: pick("canvas.deviceTier"), dpr: pick("canvas.dpr"), devicePixelRatio: devicePixelRatio, lean: pick("canvas.lean"), shadowPx: pick("canvas.shadowMapPx"), shadowsOn: pick("canvas.shadowsOn"), bloom: pick("canvas.bloom"), ultra: pick("canvas.ultra"),
    dt: [pick("frame.dt.p50"), pick("frame.dt.p95"), pick("frame.dt.max")], cpu: [pick("frame.cpu.p50"), pick("frame.cpu.p95")], draw: [pick("frame.draw.p50"), pick("frame.draw.p95")], gpu: pick("frame.gpu.p50") ?? null,
    calls: pick("frame.calls.p50"), tris: pick("frame.tris.p50"), emaMs: pick("canvas.emaMs"), hitches: pick("canvas.hitches"), tierChanges: pick("canvas.tierChanges"),
    geometries: pick("canvas.infoGeometries"), textures: pick("canvas.infoTextures"), programs: pick("canvas.infoPrograms"),
    lruMB: [pick("tiles.bld.lruMB"), pick("tiles.gnd.lruMB"), pick("tiles.enr.lruMB")], visible: [pick("tiles.bld.visible"), pick("tiles.gnd.visible"), pick("tiles.enr.visible")], composites: pick("tiles.img.composites"),
    queues: [pick("tiles.gnd.dlLen"), pick("tiles.gnd.parseLen"), pick("tiles.bld.dlLen"), pick("tiles.enr.dlLen")],
    models: [pick("models.resident"), pick("models.world"), pick("models.skipped"), pick("models.tris"), pick("models.loading")],
    terrainEpoch: pick("terrain.epoch"), memo: [pick("terrain.memo.hits"), pick("terrain.memo.misses")], seatEpoch: pick("buildings.seatEpoch"), rejected: pick("buildings.rejected"),
    gpuString: pick("system.gpu"), cores: navigator.hardwareConcurrency, screen: [screen.width, screen.height], inner: [innerWidth, innerHeight], coarse: matchMedia("(pointer: coarse)").matches,
    visibility: document.visibilityState, feedActive: pick("feed.active"),
  };
})()`;
const BUSY = `(() => { const f = window.__debugFeed; if (!f) return 999; const t = f.read("tiles"); if (!t) return 999; let b = 0; for (const p of ["bld","gnd","enr"]) for (const k of ["dlLen","parseLen","queued","downloading","parsing"]) b += Number(t[p + "." + k] ?? 0); const m = f.read("models"); return b + Number(m ? m.loading : 0); })()`;
// A synthetic look-around for the soak: the FPV gesture table reads pointer events on the canvas.
const LOOK = `(() => { const c = document.querySelector("canvas"); if (!c) return false; const r = c.getBoundingClientRect(); const x0 = r.left + r.width * 0.5, y0 = r.top + r.height * 0.6;
  const ev = (type, x, y, buttons) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons }));
  ev("pointerdown", x0, y0, 1); for (let i = 1; i <= 12; i++) ev("pointermove", x0 + i * 9, y0 + Math.sin(i / 3) * 4, 1); ev("pointerup", x0 + 108, y0, 0); return true; })()`;

async function drive(endpoint) {
  const u = new URL(endpoint);
  const driver = await remote({
    protocol: u.protocol.replace(":", ""),
    hostname: u.hostname,
    port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
    path: u.pathname + u.search,
    logLevel: "warn",
    connectionRetryTimeout: 240_000,
    // ONE attempt per command: after a WebContent kill or a JS hang the remote debugger answers
    // nothing for 120 s, and the default three retries turned one dead page into eight device
    // minutes (farm1 attempt 2, 2026-09-06). The tool classifies the stall itself instead.
    connectionRetryCount: 0,
    capabilities: {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      browserName: "Safari",
      // no udid / platformVersion: Device Farm rejects device-specific caps (appium-endpoint-support)
    },
  });
  const js = (expr) => driver.execute(`return (${expr});`);
  const waitFor = async (expr, timeoutMs, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await js(expr)) return true;
      } catch {
        /* navigating */
      }
      await sleep(1000);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const settle = async (maxS) => {
    const t0 = Date.now();
    let quiet = null;
    while (Date.now() - t0 < maxS * 1000) {
      const busy = await js(BUSY).catch(() => 999);
      if (busy === 0) {
        quiet ??= Date.now();
        if (Date.now() - quiet >= 2000) return { settleMs: Date.now() - t0, capped: false };
      } else quiet = null;
      await sleep(1000);
    }
    return { settleMs: maxS * 1000, capped: true };
  };
  let pageUnresponsive = false; // set when Safari's remote debugger stopped answering (kill or hang)
  const STALL = /did not respond|JavaScript execution is blocked/i;
  const boot = async (poseKey) => {
    const t0 = Date.now();
    try {
      await driver.url("about:blank");
      await sleep(300);
      await driver.url(POSE_URL[poseKey]);
      await waitFor(READY, 120_000, `${poseKey} seams`);
      await js(BOOT_MARK);
      await js(`window.__debugFeed.setActive(true), true`); // the per-frame series (no panel on a phone)
    } catch (e) {
      // A 120 s "remote Safari debugger did not respond" = the page's WebContent process is gone
      // (jetsam) or its main thread is blocked. Either way nothing more can be read from this
      // session — record it and let the caller decide; never retry into another two minutes.
      if (STALL.test(String(e))) {
        pageUnresponsive = true;
        throw new Error(`boot ${poseKey}: the remote Safari debugger stopped responding (WebContent kill or a JS hang — the console session video decides)`);
      }
      throw e;
    }
    // the desktop route on a phone shows the welcome overlay only without a hash — the poses carry one
    return Date.now() - t0;
  };
  const read = async (poseKey, extra = {}) => {
    const snap = await js(SNAP);
    let shot = null;
    try {
      shot = `${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-${poseKey}${extra.tag ? `-${extra.tag}` : ""}.png`;
      writeFileSync(shot, Buffer.from(await driver.takeScreenshot(), "base64"));
    } catch {
      shot = null;
    }
    return { pose: poseKey, ...extra, snap, shot };
  };
  const poseLine = (r) => {
    const s = r.snap;
    return `${r.pose.padEnd(8)} tier ${s.tier}/${s.deviceTier} dpr ${s.dpr} (${s.devicePixelRatio}) lean ${s.lean} shadow ${s.shadowPx}px  dt ${s.dt?.[0]?.toFixed?.(1)}/${s.dt?.[1]?.toFixed?.(1)} ms  cpu ${s.cpu?.[0]?.toFixed?.(1)}  draw ${s.draw?.[0]?.toFixed?.(1)}  gpu ${s.gpu ?? "—"}  calls ${s.calls}  tris ${s.tris}  tex/geo ${s.textures}/${s.geometries}  lru ${s.lruMB?.map((x) => Math.round(x ?? 0)).join("/")} MB  comp ${s.composites}  models ${s.models?.join("/")}  booted ${s.booted}  ${s.gpuString}`;
  };

  try {
    // ── the poses ──
    const seenPose = {};
    let fpvBootAt = 0; // wall clock of the last fpv page's birth — the soak's page-age column
    for (const poseKey of POSES) {
      const n = (seenPose[poseKey] = (seenPose[poseKey] ?? 0) + 1);
      const slot = n === 1 ? poseKey : `${poseKey}#${n}`; // fpv,fpv = a second `#f=` boot in ONE Safari session
      let bootMs;
      try {
        bootMs = await boot(poseKey);
      } catch (e) {
        results.poses[slot] = { pose: poseKey, error: String(e) };
        results.notes.push(`${slot}: ${String(e)}`);
        save();
        log(`${slot}: ${String(e)}`);
        if (pageUnresponsive) throw e; // nothing more can be read from this session
        continue;
      }
      if (poseKey === "fpv") fpvBootAt = Date.now() - bootMs;
      const st = await settle(SETTLE_S);
      await sleep(5000); // let the series rings fill (240 samples)
      const r = await read(poseKey, { bootMs, settle: st });
      results.poses[slot] = r;
      save();
      log(poseLine(r));
      if (r.snap.booted !== true) results.notes.push(`${slot}: the page RELOADED during the read (boot marker gone) — a WebContent kill?`);
    }
    // ── the kill ramp at the FPV eye ──
    for (const N of RAMP) {
      await seedTo(N);
      log(`ramp: ${seedIds.length} rows seeded → reload the FPV eye`);
      let bootMs;
      try {
        bootMs = await boot("fpv");
      } catch (e) {
        results.ramp.push({ N: seedIds.length, alive: false, killed: true, unresponsive: true, error: String(e) });
        results.notes.push(`kill ramp: the debugger stopped responding at N=${seedIds.length} resident rows (last good ${results.ramp.filter((x) => !x.killed).at(-1)?.N ?? 0}) — kill vs hang: see the session video`);
        save();
        log(`ramp N=${seedIds.length}: UNRESPONSIVE — ${String(e)}`);
        break;
      }
      await sleep(20_000);
      const alive = await js(`window.__t77boot === ${JSON.stringify(STAMP)}`).catch(() => false);
      let r;
      try {
        r = await read("fpv", { tag: `ramp${N}`, bootMs, seeded: seedIds.length });
      } catch (e) {
        r = { pose: "fpv", tag: `ramp${N}`, seeded: seedIds.length, error: String(e) };
      }
      const killed = !alive || r.error || r.snap?.booted !== true;
      // farm2 (2026-09-06): the page BOOTED with 9 resident helmets (seams answered, marker set),
      // then went silent inside the 20 s wait — every later command stalls 120 s. That silence is
      // the kill-class event itself; flag the page so the soak is skipped and the session stops now.
      if (r.error && STALL.test(String(r.error))) pageUnresponsive = true;
      results.ramp.push({ N: seedIds.length, alive, killed, unresponsive: pageUnresponsive, ...r });
      save();
      log(`ramp N=${seedIds.length}: ${killed ? "KILLED / RELOADED" : "alive"} ${r.snap ? `models ${r.snap.models?.join("/")} tex ${r.snap.textures} lru ${r.snap.lruMB?.map((x) => Math.round(x ?? 0)).join("/")} dt ${r.snap.dt?.[0]?.toFixed?.(1)}` : r.error ?? ""}`);
      if (killed) {
        results.notes.push(`kill ramp: first reload at N=${seedIds.length} resident rows (last good ${results.ramp.filter((x) => !x.killed).at(-1)?.N ?? 0})`);
        break;
      }
    }
    // ── 2026-09-07h: the BEST SPOT leg on /m ──
    if (LEGS.includes("bestspot") && !pageUnresponsive) {
      results.bestspot = { rows: [], notes: [] };
      const bs = results.bestspot;
      try {
        const bootMs = await boot("m");
        await settle(SETTLE_S);
        // the request through the store seams (the sheet's own buttons do exactly this): a centre at
        // the map focus, the window open, the switch ON
        await js(`(() => { const c = window.__cameraStore.getState(); c.setTempPin({ latDeg: c.focusLatDeg, lonDeg: c.focusLonDeg }); const b = window.__bestSpotStore.getState(); b.setOpen(true); b.setHeatmapOn(true); return true; })()`);
        const t0 = Date.now();
        const LADDER = `(() => { const st = window.__bestSpotStore.getState(); const f = window.__globe.bestSpot(); const sh = window.__globe.bestSpotSheet(); const b = window.__globe.buildingsLoad ? window.__globe.buildingsLoad() : null; return { rung: st.ladderRung, cell: st.gridCellM, cellReq: st.cellM, solving: st.solving, topK: st.topK.length, reach: Math.round(st.reachM), cov: +st.coverage.toFixed(2), total: st.verdictCounts.total, scored: st.verdictCounts.scored, hp: st.heightProvenance, terrainOnly: st.terrainOnly, jobs: f.jobs, timings: f.timings, sheet: sh.visible, fade: +sh.fade.toFixed(2), bldMeshes: b ? b.meshes : -1, mapMode: window.__cameraStore.getState().mapMode, booted: window.__t77boot === ${JSON.stringify(STAMP)} }; })()`;
        let landed = null;
        while (Date.now() - t0 < 150_000) {
          const r = await js(LADDER).catch((e) => ({ err: String(e) }));
          if (r.err) { bs.notes.push(`ladder read failed: ${r.err}`); if (STALL.test(r.err)) pageUnresponsive = true; break; }
          bs.rows.push({ tS: Math.round((Date.now() - t0) / 1000), ...r });
          log(`bestspot ${Math.round((Date.now() - t0) / 1000)} s: rung ${r.rung} cell ${r.cell} (req ${r.cellReq}) jobs ${r.jobs} topK ${r.topK} reach ${r.reach} m cov ${r.cov} hp ${r.hp?.enriched}+${r.hp?.osm} bld ${r.bldMeshes} sheet ${r.sheet}`);
          if (r.rung >= 3 && r.cell <= r.cellReq && !r.solving && r.topK > 0) { landed = r; break; }
          if (r.booted === false) { bs.notes.push("the page RELOADED during the solve (boot marker gone) — a WebContent kill?"); break; }
          await sleep(5000);
        }
        bs.bootMs = bootMs;
        bs.finestMs = landed ? Date.now() - t0 : null;
        bs.landed = landed;
        save();
        if (landed) {
          log(`bestspot: FINEST rung landed in ${Math.round(bs.finestMs / 1000)} s — ${landed.scored}/${landed.total} scored, ${landed.topK} spots, reach ${landed.reach} m`);
          // the hold: the sheet up, a snapshot every 15 s — the jetsam question and the frame time
          bs.hold = [];
          const h0 = Date.now();
          while (Date.now() - h0 < BESTSPOT_HOLD_S * 1000) {
            await sleep(15_000);
            const snap = await js(SNAP).catch((e) => ({ err: String(e) }));
            const row = { tS: Math.round((Date.now() - h0) / 1000), pageAgeS: Math.round((Date.now() - (t0 - bootMs)) / 1000), snap };
            bs.hold.push(row);
            save();
            log(`bestspot hold ${row.tS} s (page ${row.pageAgeS} s): dt ${snap.dt?.[0]?.toFixed?.(1)}/${snap.dt?.[1]?.toFixed?.(1)} cpu ${snap.cpu?.[0]?.toFixed?.(1)}/${snap.cpu?.[1]?.toFixed?.(1)} lru ${snap.lruMB?.map?.((x) => x?.toFixed?.(0)).join("/")} MB hitches ${snap.hitches}`);
            if (snap.err || snap.booted === false) { bs.notes.push(`hold: the page ${snap.err ? "stopped answering" : "RELOADED"} at ${row.tS} s (page age ${row.pageAgeS} s)`); if (snap.err && STALL.test(snap.err)) pageUnresponsive = true; break; }
          }
          // a marker preview (LOOK) and back, then disarm
          const prev = await js(`(() => { const b = window.__bestSpotStore.getState(); const k = b.topK[0] && b.topK[0].key; if (!k) return null; b.setSelectedKey(k); b.previewSpot(k); return k; })()`).catch(() => null);
          await sleep(6000);
          const inFpv = await js(`(() => { const c = window.__cameraStore.getState(); const b = window.__bestSpotStore.getState(); return { fpv: c.tempFpv, preview: b.previewKey, topK: b.topK.length }; })()`).catch((e) => ({ err: String(e) }));
          bs.preview = { key: prev, ...inFpv };
          await js(`window.__cameraStore.getState().setTempFpv(false), true`).catch(() => {});
          await sleep(3000);
          bs.afterPreview = await js(LADDER).catch((e) => ({ err: String(e) }));
          await js(`window.__bestSpotStore.getState().setHeatmapOn(false), true`).catch(() => {});
          try { writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-bestspot.png`, Buffer.from(await driver.takeScreenshot(), "base64")); } catch { /* no shot */ }
        } else {
          bs.notes.push("the finest rung never landed within 150 s");
        }
        save();
      } catch (e) {
        bs.notes.push(`bestspot leg: ${String(e)}`);
        if (STALL.test(String(e))) pageUnresponsive = true;
        save();
        log(`bestspot leg: ${String(e)}`);
      }
    }
    // ── 2026-09-07h: the AR look-around leg in /m FPV ──
    if (LEGS.includes("ar") && !pageUnresponsive) {
      results.ar = { notes: [] };
      const ar = results.ar;
      try {
        await boot("mfpv");
        await waitFor(`!!(window.__cameraStore && window.__cameraStore.getState().fpvHud)`, 60_000, "FPV live on /m");
        await sleep(3000);
        ar.chip = await js(`!!document.querySelector(".m-arbtn")`).catch(() => false);
        ar.permissionApi = await js(`typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function"`).catch(() => null);
        // the REAL tap on the chip — the permission sheet must come from the gesture; Appium's
        // element click is a real touch on the phone
        let tapped = false;
        try {
          const el = await driver.$(".m-arbtn");
          await el.click();
          tapped = true;
        } catch (e) {
          ar.notes.push(`chip click failed: ${String(e).slice(0, 120)}`);
        }
        ar.tapped = tapped;
        await sleep(1500);
        // WebKit's "Would Like to Access Motion and Orientation" sheet — accept it if it is up
        let alert = null;
        try {
          alert = await driver.getAlertText();
          await driver.acceptAlert();
          ar.alertAccepted = true;
        } catch {
          ar.alertAccepted = false;
        }
        ar.alertText = alert;
        await sleep(2500);
        const AR = `(() => { const c = window.__cameraStore.getState(); const d = window.__globe.arLook ? window.__globe.arLook() : null; return { on: c.arLook, state: c.arLookState, note: (document.querySelector(".m-arnote") || {}).textContent || "", dbg: d ? { attached: d.attached, samples: d.samples, absoluteSamples: d.absoluteSamples, compassSamples: d.compassSamples, lastSampleAgeMs: Math.round(d.lastSampleAgeMs), declinationDeg: d.declinationDeg, aim: d.aim ? { rung: d.aim.rung, heading: +d.aim.headingDeg.toFixed(1), pitch: +d.aim.pitchDeg.toFixed(1), roll: +d.aim.rollDeg.toFixed(1), compassAgeMs: Math.round(d.aim.compassAgeMs), yawOffset: +d.aim.yawOffsetDeg.toFixed(1), pose: { topHoriz: +d.aim.pose.topHoriz.toFixed(3), lookHoriz: +d.aim.pose.lookHoriz.toFixed(3) } } : null } : null, hud: c.fpvHud ? { h: +c.fpvHud.headingDeg.toFixed(1), p: +c.fpvHud.pitchDeg.toFixed(1) } : null }; })()`;
        ar.first = await js(AR).catch((e) => ({ err: String(e) }));
        log(`ar: on ${ar.first.on} tapped ${tapped} alert ${JSON.stringify(alert)} accepted ${ar.alertAccepted} samples ${ar.first.dbg?.samples} rung ${ar.first.dbg?.aim?.rung} note "${ar.first.note}"`);
        if (!ar.first.on) {
          // the store path — proves the sensor stream even if the sheet could not be accepted
          await js(`window.__cameraStore.getState().setArLook(true), true`).catch(() => {});
          ar.notes.push("the tap did not arm AR (permission sheet not accepted?) — armed through the store to read the sensors");
          await sleep(2500);
        }
        // the raw event fields, once, straight off a listener: which event fires, and the iOS extras
        ar.rawEvent = await js(`new Promise((res) => { const seen = {}; let n = 0; const h = (e) => { n++; seen[e.type] = { alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: e.absolute, webkitCompassHeading: e.webkitCompassHeading, webkitCompassAccuracy: e.webkitCompassAccuracy, isTrusted: e.isTrusted }; }; window.addEventListener("deviceorientation", h); window.addEventListener("deviceorientationabsolute", h); setTimeout(() => { window.removeEventListener("deviceorientation", h); window.removeEventListener("deviceorientationabsolute", h); res({ n, seen }); }, 3000); })`).catch((e) => ({ err: String(e) }));
        ar.rows = [];
        for (let i = 0; i < 6; i++) {
          await sleep(5000);
          const r = await js(AR).catch((e) => ({ err: String(e) }));
          ar.rows.push({ tS: (i + 1) * 5, ...r });
          save();
          log(`ar ${(i + 1) * 5} s: samples ${r.dbg?.samples} abs ${r.dbg?.absoluteSamples} compass ${r.dbg?.compassSamples} rung ${r.dbg?.aim?.rung} hdg ${r.dbg?.aim?.heading} pitch ${r.dbg?.aim?.pitch} topHoriz ${r.dbg?.aim?.pose?.topHoriz} hud ${r.hud?.h}/${r.hud?.p} stale ${r.state?.stale} note "${r.note}"`);
          if (r.err) { if (STALL.test(r.err)) pageUnresponsive = true; break; }
        }
        try { writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-ar.png`, Buffer.from(await driver.takeScreenshot(), "base64")); } catch { /* no shot */ }
        await js(`window.__cameraStore.getState().setArLook(false), true`).catch(() => {});
        save();
      } catch (e) {
        ar.notes.push(`ar leg: ${String(e)}`);
        if (STALL.test(String(e))) pageUnresponsive = true;
        save();
        log(`ar leg: ${String(e)}`);
      }
    }
    // ── T130 / T124: the altanka pose in /m FPV — is the user mesh there? ──
    if (LEGS.includes("t124") && !pageUnresponsive) {
      results.t124 = { notes: [], reads: [] };
      const r124 = results.t124;
      try {
        const bootMs = await boot("t124");
        await waitFor(`!!(window.__cameraStore && window.__cameraStore.getState().fpvHud)`, 60_000, "FPV live at the T124 pose");
        r124.bootMs = bootMs;
        // the model rows through the scene's own debug seam: the title match, its residency state,
        // the seat, the applied scale, the bounds; plus the DBG models.* counters and the lean caps.
        const READ = `(() => { const um = window.__globe.userModels(); const f = window.__debugFeed.snapshot(); const pick = (k) => f[k];
          const rows = um.models.map((m) => ({ id: m.id, title: m.title, state: m.state, seatReal: m.seatReal, appliedM: m.appliedM, seatM: m.seatM, tris: m.tris, dragging: m.dragging, scale: m.bodyScaleXYZ, sizeM: m.sizeM }));
          const hit = rows.filter((m) => String(m.title).toLowerCase().includes(${JSON.stringify(T124_TITLE.toLowerCase())}));
          const cs = window.__cameraStore.getState();
          return { booted: window.__t77boot === ${JSON.stringify(STAMP)}, models: [pick("models.resident"), pick("models.world"), pick("models.skipped"), pick("models.tris"), pick("models.loading")], lruMB: [pick("tiles.bld.lruMB"), pick("tiles.gnd.lruMB"), pick("tiles.enr.lruMB")], lean: pick("canvas.lean"), tier: pick("canvas.tier"), modelsVisible: cs.modelsVisible, mapMode: cs.mapMode, fpv: !!cs.fpvHud, worldRows: window.__userModelsStore.getState().world.length, worldPhase: window.__userModelsStore.getState().worldPhase, rows: rows.length, hit, dt: [pick("frame.dt.p50"), pick("frame.dt.p95")] }; })()`;
        // read at 5 / 15 / 30 / 60 / 90 s — a residency glitch is a timeline, not a moment
        const t0 = Date.now();
        for (const atS of [5, 15, 30, 60, 90]) {
          while (Date.now() - t0 < atS * 1000) await sleep(500);
          const r = await js(READ).catch((e) => ({ err: String(e) }));
          if (r.err && STALL.test(r.err)) pageUnresponsive = true;
          r124.reads.push({ atS, ...r });
          save();
          const h = r.hit?.[0];
          log(`t124 ${atS} s: world ${r.worldRows} (${r.worldPhase}) · models r/w/s/l ${r.models?.join("/")} · ${T124_TITLE}: ${h ? `${h.state} seatReal ${h.seatReal} applied ${h.appliedM?.toFixed?.(1)} m tris ${h.tris}` : "NOT IN THE SCENE ROWS"} · lean ${r.lean} lru ${r.lruMB?.map?.((x) => Math.round(x ?? 0)).join("/")}`);
          if (r.err || r.booted === false) { r124.notes.push(`the page ${r.err ? "stopped answering" : "RELOADED"} at ${atS} s`); break; }
          if (atS === 30 || atS === 90) { try { writeFileSync(`${OUT_DIR}/devicefarm-${LABEL}-${STAMP}-t124-${atS}s.png`, Buffer.from(await driver.takeScreenshot(), "base64")); } catch { /* no shot */ } }
        }
        const last = r124.reads.at(-1);
        const hit = last?.hit?.[0];
        r124.verdict = !last || last.err ? "unread" : !hit ? (last.worldRows > 0 ? "not-in-scene-rows (the world read has rows; the model is not among them → the cover / the residency plan / a hidden row)" : "world-read-empty (no rows reached the phone — the fetch, the cover, or the network)") : hit.state === "resident" || hit.state === "ready" ? "resident" : `state:${hit.state}`;
        results.notes.push(`t124: ${r124.verdict}`);
        log(`t124 verdict: ${r124.verdict}`);
        save();
      } catch (e) {
        r124.notes.push(`t124 leg: ${String(e)}`);
        if (STALL.test(String(e))) pageUnresponsive = true;
        save();
        log(`t124 leg: ${String(e)}`);
      }
    }
    // ── T130 / T123: the STRESS leg — the owner's jetsam sequence on ONE page ──
    if (LEGS.includes("stress") && !pageUnresponsive) {
      results.stress = { cycles: [], notes: [], spots: STRESS_SPOTS, cyclesAsked: STRESS_CYCLES };
      const st = results.stress;
      try {
        const bootMs = await boot("m");
        await settle(SETTLE_S);
        const pageT0 = Date.now() - bootMs;
        const LADDER_LITE = `(() => { const b = window.__bestSpotStore.getState(); return { booted: window.__t77boot === ${JSON.stringify(STAMP)}, rung: b.ladderRung, solving: b.solving, topK: b.topK.length, cell: b.gridCellM, cellReq: b.cellM }; })()`;
        let dead = false;
        for (let i = 0; i < STRESS_CYCLES && !dead && !pageUnresponsive; i++) {
          const spot = STRESS_SPOTS[i % STRESS_SPOTS.length];
          const cyc = { i, spot: spot.id, stages: [] };
          st.cycles.push(cyc);
          const stage = async (name, fn) => {
            const t0 = Date.now();
            let err = null;
            try {
              await fn();
            } catch (e) {
              err = String(e);
              if (STALL.test(err)) pageUnresponsive = true;
            }
            const snap = pageUnresponsive ? { err: err ?? "unresponsive" } : await js(SNAP).catch((e) => ({ err: String(e) }));
            if (snap.err && STALL.test(snap.err)) pageUnresponsive = true;
            const row = { name, pageAgeS: Math.round((Date.now() - pageT0) / 1000), ms: Date.now() - t0, err, snap };
            cyc.stages.push(row);
            save();
            log(`stress c${i} ${spot.id} ${name} (page ${row.pageAgeS} s, ${Math.round(row.ms / 1000)} s): ${snap.err ? `ERR ${snap.err.slice(0, 80)}` : `dt ${snap.dt?.[0]?.toFixed?.(1)}/${snap.dt?.[1]?.toFixed?.(1)} lru ${snap.lruMB?.map?.((x) => Math.round(x ?? 0)).join("/")} tex ${snap.textures} geo ${snap.geometries} prog ${snap.programs} models ${snap.models?.join("/")} booted ${snap.booted}`}`);
            if (snap.err || snap.booted === false) {
              dead = true;
              st.notes.push(`the page ${snap.err ? "stopped answering" : "RELOADED"} in cycle ${i} at stage ${name} (page age ${row.pageAgeS} s)${snap.err ? ` — ${snap.err.slice(0, 120)}` : ""}`);
              log(`stress: DEAD in cycle ${i} at ${name} (page age ${row.pageAgeS} s)`);
              return false;
            }
            return !err;
          };
          if (!(await stage("fpv-in", async () => {
            await js(`(() => { const c = window.__cameraStore.getState(); c.setTempPin({ latDeg: ${spot.lat}, lonDeg: ${spot.lon} }); c.setTempFpv(true); return true; })()`);
            await waitFor(`!!(window.__cameraStore.getState().fpvHud)`, 60_000, "FPV in");
            await settle(STRESS_SETTLE_S);
          }))) break;
          if (!(await stage("look", async () => {
            for (let k = 0; k < 3; k++) { await js(LOOK); await sleep(1500); }
            await settle(10);
          }))) break;
          if (!(await stage("fpv-out", async () => {
            await js(`window.__cameraStore.getState().setTempFpv(false), true`);
            await waitFor(`!(window.__cameraStore.getState().fpvHud)`, 30_000, "FPV out");
            await settle(STRESS_SETTLE_S);
          }))) break;
          if (!(await stage("heatmap", async () => {
            await js(`(() => { const c = window.__cameraStore.getState(); c.setTempPin({ latDeg: ${spot.lat}, lonDeg: ${spot.lon} }); const b = window.__bestSpotStore.getState(); b.setOpen(true); b.setHeatmapOn(true); return true; })()`);
            const t0 = Date.now();
            while (Date.now() - t0 < 90_000) {
              const r = await js(LADDER_LITE);
              if (r.booted === false) throw new Error("the page reloaded during the solve");
              if (r.rung >= 3 && r.cell <= r.cellReq && !r.solving && r.topK > 0) break;
              await sleep(4000);
            }
          }))) break;
          if (!(await stage("heatmap-off", async () => {
            await js(`(() => { const b = window.__bestSpotStore.getState(); b.setHeatmapOn(false); b.setOpen(false); return true; })()`);
            await sleep(3000);
          }))) break;
        }
        // GROWTH vs CEILING — the `fpv-out` rows across cycles: a resource that climbs cycle over
        // cycle is growth (named); flat resources on a page that still died read as the ceiling.
        const outs = st.cycles.map((c) => c.stages.find((r) => r.name === "fpv-out")?.snap).filter((sn) => sn && !sn.err);
        const series = (f) => outs.map(f).filter((v) => Number.isFinite(v));
        const climb = (arr) => arr.length >= 3 && arr.at(-1) > arr[0] * 1.15 && arr.every((v, i) => i === 0 || v >= arr[i - 1] * 0.97);
        const lru = series((sn) => (sn.lruMB ?? []).reduce((a, b) => a + (b ?? 0), 0));
        const tex = series((sn) => sn.textures);
        const geo = series((sn) => sn.geometries);
        const prog = series((sn) => sn.programs);
        const growth = [];
        if (climb(lru)) growth.push(`tile LRU ${lru.map((v) => Math.round(v)).join("→")} MB`);
        if (climb(tex)) growth.push(`textures ${tex.join("→")}`);
        if (climb(geo)) growth.push(`geometries ${geo.join("→")}`);
        if (climb(prog)) growth.push(`programs ${prog.join("→")}`);
        st.series = { lruMB: lru, textures: tex, geometries: geo, programs: prog };
        st.verdict = dead ? (growth.length ? `GROWTH then death: ${growth.join(" · ")}` : `CEILING: died with flat resources (lru ${lru.map((v) => Math.round(v)).join("/")} tex ${tex.join("/")} geo ${geo.join("/")})`) : growth.length ? `alive ${st.cycles.length} cycles, GROWING: ${growth.join(" · ")}` : `alive ${st.cycles.length} cycles, flat (lru ${lru.map((v) => Math.round(v)).join("/")} tex ${tex.join("/")} geo ${geo.join("/")})`;
        results.notes.push(`stress: ${st.verdict}`);
        log(`stress verdict: ${st.verdict}`);
        save();
      } catch (e) {
        st.notes.push(`stress leg: ${String(e)}`);
        if (STALL.test(String(e))) pageUnresponsive = true;
        save();
        log(`stress leg: ${String(e)}`);
      }
    }
    await unseedAll();
    // ── the soak at the FPV eye, 0 seeded models ──
    if (SOAK_MIN > 0 && !pageUnresponsive) {
      const inPlace = SOAK_NO_REBOOT && POSES.at(-1) === "fpv" && RAMP.length === 0 && results.poses.fpv?.snap?.booted === true;
      if (SOAK_NO_REBOOT && !inPlace) results.notes.push("--soak-no-reboot ignored: the last pose was not a booted fpv, or the ramp ran");
      if (inPlace) {
        log("soak: IN PLACE on the fpv page already up (--soak-no-reboot) — no second load");
      } else {
        await boot("fpv");
        await settle(SETTLE_S);
      }
      const t0 = Date.now();
      results.soakStart = { inPlace, pageAgeS: inPlace ? Math.round((Date.now() - fpvBootAt) / 1000) : 0 };
      let k = 0;
      let dead = false;
      while (Date.now() - t0 < SOAK_MIN * 60_000 && !dead) {
        // Each Appium call on a dead page stalls 120 s: the FIRST stall-class LOOK failure ends the
        // row (a second LOOK + the SNAP were another 4 min of billing on the 2026-09-07c A/B run);
        // a non-stall failure (a transient) gets one more try before the SNAP classifies.
        let lookFails = 0;
        let stalled = null;
        for (let i = 0; i < 6 && lookFails < 2 && !stalled; i++) {
          const ok = await js(LOOK).catch((e) => (STALL.test(String(e)) ? ((stalled = String(e)), null) : null));
          lookFails = ok === null ? lookFails + 1 : 0;
          if (!stalled) await sleep(4000);
        }
        const snap = stalled ? { err: `timeout: ${stalled}` } : await js(SNAP).catch((e) => ({ err: String(e) }));
        const row = { minute: (Date.now() - t0) / 60_000, pageAgeS: inPlace ? Math.round((Date.now() - fpvBootAt) / 1000) : Math.round((Date.now() - t0) / 1000), k: k++, snap };
        results.soak.push(row);
        save();
        if (snap.err || snap.booted === false || lookFails >= 2 || stalled) {
          dead = true;
          if (snap.err && STALL.test(snap.err)) pageUnresponsive = true;
          results.notes.push(`soak: the page ${snap.err ? "stopped answering" : "RELOADED"} at ${row.minute.toFixed(1)} min (page age ${row.pageAgeS} s)${snap.err ? ` — ${snap.err}` : ""}`);
          log(`soak: DEAD at ${row.minute.toFixed(1)} min (page age ${row.pageAgeS} s) — stopping the soak`);
        }
        log(`soak ${row.minute.toFixed(1)} min: dt ${snap.dt?.[0]?.toFixed?.(1)}/${snap.dt?.[1]?.toFixed?.(1)} ms  tier ${snap.tier} dpr ${snap.dpr}  ema ${snap.emaMs?.toFixed?.(1)}  hitches ${snap.hitches}  booted ${snap.booted}`);
        if (snap.booted === false) results.notes.push(`soak: the page reloaded at ${row.minute.toFixed(1)} min`);
      }
    }
  } finally {
    // deleteSession on an unresponsive page is another 120 s stall per attempt; the remote-access
    // session stop (the outer finally) tears the browser down regardless.
    if (!pageUnresponsive) await driver.deleteSession().catch(() => {});
  }
}

// ─── run ─────────────────────────────────────────────────────────────────────────────────────
log(`T77 phone baseline — device "${DEVICE_MODEL}" host ${HOST || "(dry run)"} poses ${POSES.join(",")} legs ${LEGS.join(",") || "-"} ramp ${RAMP.join("/")} soak ${SOAK_MIN} min`);
await preflight();
if (DRY) {
  const projectArn = await resolveProject();
  log(`project ${projectArn}`);
  await showPools(projectArn);
  const d = await pickDevice();
  log(`dry run OK — device ${d.arn}; no session created, no minutes spent`);
  process.exitCode = 0;
} else {
  const projectArn = await resolveProject();
  let sessionArn = null;
  try {
    sessionArn = await openSession(projectArn);
    const { endpoint, session } = await waitRunning(sessionArn);
    results.session = { arn: sessionArn, device: session.device?.name, os: session.device?.os, started: session.started };
    await drive(endpoint);
  } finally {
    const n = await unseedAll();
    if (n) log(`finally removed ${n} seeded rows`);
    if (sessionArn && !KEEP) {
      const s = await df.send(new StopRemoteAccessSessionCommand({ arn: sessionArn })).catch((e) => ({ error: String(e) }));
      log(`session stop → ${s.remoteAccessSession?.status ?? JSON.stringify(s)}`);
    } else if (sessionArn) log(`session KEPT running (--keep-session): ${sessionArn} — stop it in the console, it bills per minute`);
    results.sessionMinutes = sessionArn ? (await df.send(new GetRemoteAccessSessionCommand({ arn: sessionArn })).catch(() => null))?.remoteAccessSession?.deviceMinutes ?? null : null;
    save();
    log(`wrote ${OUT_DIR}/devicefarm-${LABEL}-${STAMP}.json`);
  }
}
