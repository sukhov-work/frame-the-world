#!/usr/bin/env node
// Close the HOUSE headless verify Chrome(s) and every helper they spawned — and nothing else.
//
// Owner order 2026-09-10: after a browser-verification block the headless Chrome and its helpers
// (gpu-process, utility, renderers) were being left behind in the background, session after
// session. This is the one sanctioned way to end them. What it kills, and what it never touches:
//
//   KILLS   a browser MAIN process (no `--type=`) that is `--headless` AND runs on the house
//           profile (`--user-data-dir=/tmp/ftw-cdp*`), then any straggler of ANY type still on
//           that profile after the grace (helpers die with their browser; the sweep is a backstop).
//   NEVER   the owner's real Chrome (no debugging port, no house profile) · the owner's headed CDP
//           Chrome on :9222 (`Playwright_Chrome_data`, not headless — owner ruling 2026-08-18: never
//           kill or relaunch it; killing it disconnects the Playwright MCP) · any Chrome on a port
//           passed with --keep · a foreign headless Chrome on another profile · dev servers.
//
// Usage: node scripts/close-verify-chrome.mjs [--dry-run] [--keep 9222] [--grace 5]
// Exit 0 always (a close is best-effort; the report says what happened). Idempotent: nothing to
// close → "nothing to close". Wired into the SessionEnd hook (`.claude/hooks/close-house-chrome.sh`)
// and to be run by hand after the last browser suite of a session.
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const DRY = flag("--dry-run");
const GRACE_S = Number(opt("--grace", "5"));
const KEEP_PORTS = new Set(String(opt("--keep", "9222")).split(",").map((s) => s.trim()).filter(Boolean));
const HOUSE_PROFILE = /--user-data-dir=\/tmp\/ftw-cdp[^\s]*/;

const ps = () => {
  try {
    return execSync("ps -Ao pid=,ppid=,command=", { encoding: "utf8", maxBuffer: 64 << 20 })
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
        return m ? { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] } : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};
const portOf = (cmd) => { const m = cmd.match(/--remote-debugging-port=(\d+)/); return m ? m[1] : null; };
const isChrome = (r) => /Google Chrome|Chromium|chrome-headless-shell/.test(r.cmd) && !/chrome_crashpad_handler|chrome-native-host/.test(r.cmd);
const onHouseProfile = (r) => HOUSE_PROFILE.test(r.cmd);
const keptPort = (r) => { const p = portOf(r.cmd); return p !== null && KEEP_PORTS.has(p); };
/** The browser MAIN process of a house headless Chrome. */
const houseMain = (r) => isChrome(r) && onHouseProfile(r) && r.cmd.includes("--headless") && !r.cmd.includes("--type=") && !keptPort(r);
/** Any process of any type still living on the house profile (a helper, or a browser that ignored SIGTERM). */
const houseAny = (r) => isChrome(r) && onHouseProfile(r) && !keptPort(r);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = (pid, sig) => { try { process.kill(pid, sig); return true; } catch { return false; } };

const rows = ps();
const mains = rows.filter(houseMain);
const helpersBefore = rows.filter((r) => houseAny(r) && !houseMain(r));
if (mains.length === 0 && helpersBefore.length === 0) {
  console.log("close-verify-chrome: nothing to close (no house headless Chrome on /tmp/ftw-cdp*).");
  process.exit(0);
}
for (const m of mains) console.log(`${DRY ? "would close" : "closing"} house headless Chrome pid ${m.pid} (port ${portOf(m.cmd) ?? "?"}, ${helpersBefore.filter((h) => h.ppid === m.pid).length} direct helpers)`);
if (helpersBefore.length && mains.length === 0) console.log(`${DRY ? "would sweep" : "sweeping"} ${helpersBefore.length} orphaned house helper(s) (their browser is already gone)`);
if (DRY) process.exit(0);

for (const m of mains) kill(m.pid, "SIGTERM");
// helpers exit with their browser; give them the grace, then sweep whatever is left on the profile
const t0 = Date.now();
let left = [];
while (Date.now() - t0 < GRACE_S * 1000) {
  await sleep(250);
  left = ps().filter(houseAny);
  if (left.length === 0) break;
}
if (left.length) {
  console.log(`${left.length} house process(es) still up after ${GRACE_S} s — SIGKILL: ${left.map((r) => r.pid).join(" ")}`);
  for (const r of left) kill(r.pid, "SIGKILL");
  await sleep(500);
  left = ps().filter(houseAny);
}
const kept = ps().filter((r) => isChrome(r) && !r.cmd.includes("--type=") && portOf(r.cmd) && KEEP_PORTS.has(portOf(r.cmd)));
console.log(
  left.length === 0
    ? `closed: no house process left on /tmp/ftw-cdp*${kept.length ? ` · kept :${[...KEEP_PORTS].join(",")} (pid ${kept.map((k) => k.pid).join(" ")})` : ""}`
    : `WARNING: ${left.length} house process(es) survived SIGKILL: ${left.map((r) => `${r.pid} ${r.cmd.slice(0, 80)}`).join(" | ")}`,
);
process.exit(0);
