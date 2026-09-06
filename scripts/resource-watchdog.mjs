#!/usr/bin/env node
// Resource watchdog for browser-verify sessions (owner order 2026-09-06j, after six parallel
// headless Chromes + six dev servers froze the 36 GB machine). Companion to the budget guard in
// `scripts/verify-chrome.mjs` — the guard refuses NEW launches; this one watches what is RUNNING.
//
// Every --interval seconds it samples `memory_pressure` and counts house headless verify Chromes
// (`/tmp/ftw-cdp*` / the Playwright profile, `--headless`, main process only) and dev servers.
// It logs one line per sample to --log (default verify-shots/resource-watchdog.log) and, when
// free memory falls below --kill-below (default 12 %), it kills the HOUSE headless Chromes only
// (never the owner's headed :9222, never a foreign Chrome, never a dev server) and logs why.
// Usage: node scripts/resource-watchdog.mjs [--interval 20] [--kill-below 12] [--log <path>]
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const INTERVAL = Number(opt("--interval", "20")) * 1000;
const KILL_BELOW = Number(opt("--kill-below", "12"));
const LOG = opt("--log", "verify-shots/resource-watchdog.log");
mkdirSync(dirname(LOG), { recursive: true });

const ps = () => {
  try {
    return execSync("ps -Ao pid=,rss=,command=", { encoding: "utf8", maxBuffer: 64 << 20 })
      .split("\n").filter(Boolean)
      .map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], rssMb: Math.round(+m[2] / 1024), cmd: m[3] }; })
      .filter(Boolean);
  } catch { return []; }
};
const isHouseChrome = (r) => r.cmd.includes("--remote-debugging-port=") && r.cmd.includes("--headless") && !r.cmd.includes("--type=") && (r.cmd.includes("ftw-cdp") || r.cmd.includes("Playwright_Chrome_data"));
const isChromeAny = (r) => /Google Chrome( Helper)?/.test(r.cmd) && !r.cmd.includes("cef_server");
const isDev = (r) => /^(\S*\/)?node\b/.test(r.cmd) && /\/astro(\/[^\s]*)?(\.m?js)?\s+dev\b/.test(r.cmd); // `wix dev` spawns `astro dev`: count the listener once
const freePct = () => { try { const m = execSync("memory_pressure", { encoding: "utf8" }).match(/free percentage:\s*(\d+)%/); return m ? +m[1] : null; } catch { return null; } };
const log = (s) => { const line = `[${new Date().toISOString()}] ${s}`; console.log(line); try { appendFileSync(LOG, line + "\n"); } catch {} };

log(`watchdog up: interval ${INTERVAL / 1000}s, kill house Chromes below ${KILL_BELOW}% free`);
for (;;) {
  const rows = ps();
  const house = rows.filter(isHouseChrome);
  const chromeRss = rows.filter(isChromeAny).reduce((a, r) => a + r.rssMb, 0);
  const devs = rows.filter(isDev);
  const free = freePct();
  log(`free ${free ?? "?"}% · house headless Chromes ${house.length} · all-Chrome RSS ${chromeRss} MB · dev servers ${devs.length}`);
  if (free != null && free < KILL_BELOW && house.length) {
    for (const h of house) {
      log(`LOW MEMORY ${free}% < ${KILL_BELOW}% — killing house headless Chrome pid ${h.pid} (${h.cmd.slice(0, 120)})`);
      try { process.kill(h.pid, "SIGTERM"); } catch (e) { log(`  kill failed: ${e.message}`); }
    }
  }
  await new Promise((r) => setTimeout(r, INTERVAL));
}
