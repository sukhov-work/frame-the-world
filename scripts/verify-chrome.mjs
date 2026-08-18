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
//
// Exit codes: 0 = Chrome up, attach printed · 1 = port owned by a foreign process · 2 = boot timeout.
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
