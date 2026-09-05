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
 *        [--ramp 6,12,24,36] [--soak-min 8] [--settle 30] [--label farm] [--dry-run]
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
 *   --soak-min minutes with a synthetic look-around between reads.
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
const SETTLE_S = Number(opt("--settle", "30"));
const LABEL = opt("--label", "farm");
const DEV = "http://localhost:4321"; // the Mac's own wix dev — for dev-seed and the tunnel preflight
const OWNER_EMAIL = opt("--owner", "yevhens@wix.com");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = "../../verify-shots/perf";
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
};
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
const BOOT_MARK = `window.__t77boot = ${JSON.stringify(STAMP)}; sessionStorage.setItem("t77", ${JSON.stringify(STAMP)}); true`;
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
  const boot = async (poseKey) => {
    const t0 = Date.now();
    await driver.url("about:blank");
    await sleep(300);
    await driver.url(POSE_URL[poseKey]);
    await waitFor(READY, 120_000, `${poseKey} seams`);
    await js(BOOT_MARK);
    await js(`window.__debugFeed.setActive(true), true`); // the per-frame series (no panel on a phone)
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
    for (const poseKey of POSES) {
      const bootMs = await boot(poseKey);
      const st = await settle(SETTLE_S);
      await sleep(5000); // let the series rings fill (240 samples)
      const r = await read(poseKey, { bootMs, settle: st });
      results.poses[poseKey] = r;
      save();
      log(poseLine(r));
      if (r.snap.booted !== true) results.notes.push(`${poseKey}: the page RELOADED during the read (boot marker gone) — a WebContent kill?`);
    }
    // ── the kill ramp at the FPV eye ──
    for (const N of RAMP) {
      await seedTo(N);
      log(`ramp: ${seedIds.length} rows seeded → reload the FPV eye`);
      const bootMs = await boot("fpv");
      await sleep(20_000);
      const alive = await js(`window.__t77boot === ${JSON.stringify(STAMP)}`).catch(() => false);
      let r;
      try {
        r = await read("fpv", { tag: `ramp${N}`, bootMs, seeded: seedIds.length });
      } catch (e) {
        r = { pose: "fpv", tag: `ramp${N}`, seeded: seedIds.length, error: String(e) };
      }
      const killed = !alive || r.error || r.snap?.booted !== true;
      results.ramp.push({ N: seedIds.length, alive, killed, ...r });
      save();
      log(`ramp N=${seedIds.length}: ${killed ? "KILLED / RELOADED" : "alive"} ${r.snap ? `models ${r.snap.models?.join("/")} tex ${r.snap.textures} lru ${r.snap.lruMB?.map((x) => Math.round(x ?? 0)).join("/")} dt ${r.snap.dt?.[0]?.toFixed?.(1)}` : r.error ?? ""}`);
      if (killed) {
        results.notes.push(`kill ramp: first reload at N=${seedIds.length} resident rows (last good ${results.ramp.filter((x) => !x.killed).at(-1)?.N ?? 0})`);
        break;
      }
    }
    await unseedAll();
    // ── the soak at the FPV eye, 0 seeded models ──
    if (SOAK_MIN > 0) {
      await boot("fpv");
      await settle(SETTLE_S);
      const t0 = Date.now();
      let k = 0;
      while (Date.now() - t0 < SOAK_MIN * 60_000) {
        for (let i = 0; i < 6; i++) {
          await js(LOOK).catch(() => false);
          await sleep(4000);
        }
        const snap = await js(SNAP).catch((e) => ({ err: String(e) }));
        const row = { minute: (Date.now() - t0) / 60_000, k: k++, snap };
        results.soak.push(row);
        save();
        log(`soak ${row.minute.toFixed(1)} min: dt ${snap.dt?.[0]?.toFixed?.(1)}/${snap.dt?.[1]?.toFixed?.(1)} ms  tier ${snap.tier} dpr ${snap.dpr}  ema ${snap.emaMs?.toFixed?.(1)}  hitches ${snap.hitches}  booted ${snap.booted}`);
        if (snap.booted === false) results.notes.push(`soak: the page reloaded at ${row.minute.toFixed(1)} min`);
      }
    }
  } finally {
    await driver.deleteSession().catch(() => {});
  }
}

// ─── run ─────────────────────────────────────────────────────────────────────────────────────
log(`T77 phone baseline — device "${DEVICE_MODEL}" host ${HOST || "(dry run)"} poses ${POSES.join(",")} ramp ${RAMP.join("/")} soak ${SOAK_MIN} min`);
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
