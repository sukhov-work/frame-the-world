#!/usr/bin/env node
// The browser-verify Chrome launcher — the ONE runnable home of the recipe that previously
// lived as prose across DECISIONS traps, three wip memories, UPLIFT_PLAN and the gitignored
// NEXT_SESSION_PROMPT (audit-2 F2, 2026-08-18). Companion one-pager: conventions/verify.md.
//
// What it encodes (each line has cost a real session real time):
//   1. WHO OWNS THE PORT comes first — a stale verify Chrome (same profile, launched without
//      the occlusion flags) binds the port; a fresh flagged launch then SILENTLY fails to
//      bind and the MCP/CDP client attaches to the buried stale window where rAF is frozen
//      (~20 min lost in U5). A FOREIGN owner (user's real Chrome, another tool) is an error —
//      never killed.
//   2. The 3 occlusion flags — without them a backgrounded/occluded window throttles rAF and
//      every motion/perf probe reads garbage.
//   3. CDP attach info printed at the end — clients connect to ws:// from /json/version, or
//      Playwright-MCP style via --cdp-endpoint http://localhost:<port>.
//
// Usage:
//   node scripts/verify-chrome.mjs                  # check port 9222, launch, print attach
//   node scripts/verify-chrome.mjs --headless       # --headless=new (bake probes, shots)
//   node scripts/verify-chrome.mjs --kill-stale     # kill a STALE verify-profile owner first
//   node scripts/verify-chrome.mjs --port 9333      # alternate port (house verify scripts)
//   node scripts/verify-chrome.mjs --budget         # print the resource budget + what is running
//
// Exit codes: 0 = Chrome up, attach printed · 1 = port owned by a foreign process · 2 = boot timeout
//             · 3 = REFUSED by the resource budget (see below).
//
//   4. THE RESOURCE BUDGET (owner order 2026-09-06j, after the crash that killed the session):
//      six worktrees × (wix dev + a headless Chrome rendering the globe + an agent) on a 36 GB M3
//      pushed swap past 120 GB and froze the whole machine, taking an unrelated research session
//      with it. Browser verification is therefore budgeted HERE, machine-checked, before any launch:
//        - at most FTW_MAX_VERIFY_CHROMES house headless verify Chromes at once (default 1); the
//          owner's headed :9222 is not counted (never launched or killed from here anyway);
//        - at most FTW_MAX_DEV_SERVERS dev servers (`wix dev` / astro) running at once (default 1);
//        - free memory (`memory_pressure`) must be ≥ FTW_MIN_FREE_MEM_PCT (default 20).
//      Raising a limit is an explicit env override in the shell that launches, never a default
//      change; a harness that needs a second Chrome waits for the first to finish instead.
import { execSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const PORT = Number(opt("--port", "9222"));
const PROFILE = opt("--profile", join(homedir(), "Playwright_Chrome_data"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// The 3 occlusion flags — the whole point of a managed launch (U2/U5 lesson).
const OCCLUSION_FLAGS = [
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
];

// ---- 0. The resource budget (owner order 2026-09-06j) --------------------------------------
const MAX_CHROMES = Number(process.env.FTW_MAX_VERIFY_CHROMES ?? 1);
const MAX_DEV_SERVERS = Number(process.env.FTW_MAX_DEV_SERVERS ?? 1);
const MIN_FREE_PCT = Number(process.env.FTW_MIN_FREE_MEM_PCT ?? 20);

const psAll = () => {
  try {
    return execSync("ps -Ao pid=,command=", { encoding: "utf8", maxBuffer: 64 << 20 })
      .split("\n")
      .filter(Boolean)
      .map((l) => ({ pid: Number(l.trim().split(/\s+/)[0]), cmd: l.trim().replace(/^\d+\s+/, "") }));
  } catch {
    return [];
  }
};
/** House headless verify Chromes: browser MAIN processes (no --type=) with a CDP port + headless. */
const verifyChromes = (rows) =>
  rows.filter(
    (r) =>
      r.cmd.includes("--remote-debugging-port=") &&
      r.cmd.includes("--headless") &&
      !r.cmd.includes("--type=") &&
      (r.cmd.includes("ftw-cdp") || r.cmd.includes("Playwright_Chrome_data")),
  );
/** Dev servers: the `astro dev` listeners (the CLI spawns one under `wix dev`; count it once). */
const devServers = (rows) =>
  rows.filter(
    (r) =>
      /^(\S*\/)?node\b/.test(r.cmd) && // a node process, never a shell wrapper quoting these words
      /\/astro(\/[^\s]*)?(\.m?js)?\s+dev\b/.test(r.cmd), // `wix dev` spawns `astro dev`: count the listener once
  );
const freeMemPct = () => {
  try {
    const m = execSync("memory_pressure", { encoding: "utf8" }).match(/free percentage:\s*(\d+)%/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
};
const budgetReport = () => {
  const rows = psAll();
  const chromes = verifyChromes(rows);
  const devs = devServers(rows);
  const free = freeMemPct();
  return { chromes, devs, free };
};
/** Cesium ion reachability (owner note 2026-09-06k3): `api.cesium.com` is 403-blocked from the
 *  owner's Dnipro ISP address and answers only through the owner's Proton VPN; a harness that
 *  boots without it measures a flat plain (`terrainEpoch` 0). Reported, never acted on. */
const ionStatus = () => {
  try {
    return execSync(
      `curl -s -o /dev/null --max-time 6 -w "%{http_code}" https://api.cesium.com/v1/assets/1/endpoint`,
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "?";
  }
};
const printBudget = ({ chromes, devs, free }) => {
  console.log(`Resource budget: verify Chromes ${chromes.length}/${MAX_CHROMES} · dev servers ${devs.length}/${MAX_DEV_SERVERS} · free mem ${free ?? "?"}% (min ${MIN_FREE_PCT}%)`);
  const ion = ionStatus();
  console.log(
    `  ion: api.cesium.com HTTP ${ion}` +
      (ion === "403" ? " — BLOCKED from this network: terrain/OSM tiles will not load; connect the owner's Proton VPN (open -a ProtonVPN) before any browser gate (T98)" : ""),
  );
  for (const c of chromes) console.log(`  chrome pid ${c.pid}: ${c.cmd.slice(0, 160)}`);
  for (const d of devs) console.log(`  dev    pid ${d.pid}: ${d.cmd.slice(0, 160)}`);
};
if (flag("--budget")) {
  printBudget(budgetReport());
  process.exit(0);
}
{
  const b = budgetReport();
  // A Chrome already on THIS port is reused below, not launched — it does not count against a new launch.
  const listening = (() => {
    try {
      return execSync(`lsof -nP -tiTCP:${PORT} -sTCP:LISTEN`, { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(Number);
    } catch {
      return [];
    }
  })();
  const others = b.chromes.filter((c) => !listening.includes(c.pid));
  const refusals = [];
  if (others.length >= MAX_CHROMES) refusals.push(`${others.length} house headless Chrome(s) already running (max ${MAX_CHROMES})`);
  if (b.devs.length > MAX_DEV_SERVERS) refusals.push(`${b.devs.length} dev servers running (max ${MAX_DEV_SERVERS})`);
  if (b.free != null && b.free < MIN_FREE_PCT) refusals.push(`free memory ${b.free}% < ${MIN_FREE_PCT}%`);
  if (refusals.length && listening.length === 0) {
    console.error(`REFUSED by the resource budget (owner order 2026-09-06j): ${refusals.join("; ")}.`);
    printBudget(b);
    console.error(`Finish or stop the running instance(s) first. Explicit override: FTW_MAX_VERIFY_CHROMES / FTW_MAX_DEV_SERVERS / FTW_MIN_FREE_MEM_PCT in THIS shell only.`);
    process.exit(3);
  }
}

// ---- 1. Who owns the port? -----------------------------------------------------------------
const owners = (() => {
  try {
    return execSync(`lsof -nP -tiTCP:${PORT} -sTCP:LISTEN`, { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((pid) => ({
        pid: Number(pid),
        cmd: execSync(`ps -p ${pid} -o command=`, { encoding: "utf8" }).trim(),
      }));
  } catch {
    return []; // lsof exits 1 when nobody listens
  }
})();

for (const { pid, cmd } of owners) {
  const isVerifyProfile = cmd.includes(PROFILE) || cmd.includes("ftw-cdp-");
  if (!isVerifyProfile) {
    console.error(`Port ${PORT} is owned by a FOREIGN process — not killing it. Owner:`);
    console.error(`  pid ${pid}: ${cmd.slice(0, 200)}`);
    console.error(`Close it yourself or pick another port (--port).`);
    process.exit(1);
  }
  const hasFlags = OCCLUSION_FLAGS.every((f) => cmd.includes(f));
  if (!flag("--kill-stale")) {
    // OWNER RULING 2026-08-18: a running verify-profile Chrome is the owner's persistent
    // `chrome-playwright` instance — REUSE it, never kill (killing it also disconnects the
    // Playwright MCP for the whole session). It usually lacks the occlusion flags: use
    // bringToFront + in-page rAF-tick guards for timed probes, or run headless probes on a
    // separate port/profile (--headless --port 9333 --profile /tmp/ftw-cdp).
    console.log(
      `Port ${PORT}: reusing the running ${hasFlags ? "flagged" : "UNFLAGGED"} verify Chrome (pid ${pid})` +
        (hasFlags ? "." : " — occlusion flags absent; timed probes need bringToFront + rAF-tick guards."),
    );
    break; // fall through to attach-info
  }
  console.log(`--kill-stale: killing verify Chrome pid ${pid} (explicit override — this disconnects an attached Playwright MCP)…`);
  try {
    process.kill(pid);
  } catch {}
  execSync("sleep 2");
}

// ---- 2. Launch (only if nobody usable owns the port now) -----------------------------------
const portFree = (() => {
  try {
    execSync(`lsof -nP -tiTCP:${PORT} -sTCP:LISTEN`, { stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
})();

if (portFree) {
  const chromeArgs = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    ...OCCLUSION_FLAGS,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (flag("--headless")) chromeArgs.push("--headless=new");
  const child = spawn(CHROME, chromeArgs, { detached: true, stdio: "ignore" });
  child.unref();
  console.log(`Launched ${flag("--headless") ? "headless " : ""}Chrome pid ${child.pid} on :${PORT}`);
}

// ---- 3. Wait for CDP + print attach info ---------------------------------------------------
const t0 = Date.now();
let version = null;
while (Date.now() - t0 < 15_000) {
  try {
    version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 300));
  }
}
if (!version) {
  console.error(`CDP endpoint never answered on :${PORT} within 15 s.`);
  process.exit(2);
}
console.log(`\nCDP up: ${version.Browser}`);
console.log(`  ws (browser): ${version.webSocketDebuggerUrl}`);
console.log(`  http:         http://localhost:${PORT}  (Playwright MCP: --cdp-endpoint)`);
console.log(`  new tab:      curl -sX PUT 'http://127.0.0.1:${PORT}/json/new?about:blank'`);
console.log(
  `\nTraps (full list: conventions/verify.md): evaluate only POST-load (in-page probes for` +
    `\nconstruction metrics) · select the right tab from /json/list · bringToFront before rAF` +
    `\nsampling — the occlusion flags do NOT cover tab-backgrounding.`,
);
