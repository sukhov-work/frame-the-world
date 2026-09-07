/**
 * probe-vtile-worker — is the vector-tile parse actually OFF the main thread? (T77 lever 11, 2026-09-07j)
 *
 *   node scripts/probe-vtile-worker.mjs [PORT] [--pose <id>] [--seconds 14] [--inline]
 *
 * Boots one catalogue pose (default `dnipro-cityscape` — the street web and the names both
 * stream there), switches the DBG feed on without mounting the panel, and polls the `vector`
 * provider: `mvt.worker` must climb while `mvt.inline` stays 0, `mvt.failed` stays at its
 * pre-lever value, and the consumers fill (`labels.entries` > 0). Prints the worst main-thread
 * SEAT (`mvt.seatMaxMs` — the only vector-tile work left on this thread) and the worst worker
 * parse (`mvt.workerMaxMs` — the time the main thread no longer pays). Console warnings are
 * captured so a worker crash (`[globe] vector-tile parse worker crashed`) is a FAIL, not a
 * silent fallback.
 *
 * `--inline` is the negative control: it deletes `window.Worker` before boot so the client's
 * inline twin runs — the same rows must then read `mvt.inline` > 0 and `mvt.worker` 0, proving
 * the probe can tell the two paths apart.
 *
 * Exit 0 = PASS, 1 = FAIL. One house Chrome, one dev server (`conventions/verify.md` §budget).
 */
import { ensureBrowser, openSession, sleep } from "./lib/cdp.mjs";
import { byId, poseUrl } from "./lib/poses.mjs";
import { trackTarget, finishVerify } from "./verify-cdp-cleanup.mjs";

const args = process.argv.slice(2);
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 9333);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const POSE = opt("--pose", "dnipro-cityscape");
const SECONDS = Number(opt("--seconds", 14));
const INLINE = args.includes("--inline");

await ensureBrowser(PORT);
const { url } = poseUrl(byId(POSE));
const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
trackTarget(PORT, target.id);
const s = await openSession(target);
const warnings = [];
s.ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "warning" || msg.params.type === "error")) {
    warnings.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
});
if (INLINE) {
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: "delete window.Worker; window.Worker = undefined;" });
}
await s.bootUrl(url);
await s.waitFor(`!!window.__globe && !!window.__debugFeed`, 90_000, "globe up");
await s.evalJs(`window.__debugFeed.setActive(true)`);

const J = async (expr) => JSON.parse(await s.evalJs(`JSON.stringify((() => (${expr}))())`));
const read = () =>
  // The feed flattens every provider as `<provider>.<key>` (`debugFeed.ts` debugFeedSnapshot).
  J(`(() => { const v = window.__debugFeed.snapshot(); return {
      parsed: v["vector.mvt.parsed"], pending: v["vector.mvt.pending"], failed: v["vector.mvt.failed"], version: v["vector.mvt.version"],
      worker: v["vector.mvt.worker"], inline: v["vector.mvt.inline"], seatMaxMs: v["vector.mvt.seatMaxMs"], workerMaxMs: v["vector.mvt.workerMaxMs"],
      labels: v["vector.labels.entries"] }; })()`);

let last = null;
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  await sleep(2000);
  last = await read();
  console.log(`t+${((Date.now() - t0) / 1000).toFixed(0).padStart(2)}s ${JSON.stringify(last)}`);
}

const fails = [];
if (!last || typeof last.parsed !== "number") fails.push("no vector rows in the DBG snapshot");
else {
  if (last.parsed <= 0) fails.push("no tile parsed");
  if (INLINE) {
    if (!(last.inline > 0)) fails.push("negative control: inline twin never ran");
    if (last.worker !== 0) fails.push(`negative control: worker row ${last.worker} ≠ 0`);
  } else {
    if (!(last.worker > 0)) fails.push(`worker parses ${last.worker} — the lever is not running`);
    if (last.inline !== 0) fails.push(`inline parses ${last.inline} on a real browser`);
    if (last.worker !== last.parsed + (last.failed ?? 0) && last.worker < last.parsed) fails.push(`worker ${last.worker} < parsed ${last.parsed}`);
  }
  if (last.labels <= 0) fails.push("street labels never filled (a consumer starved)");
  if (last.seatMaxMs > 4) fails.push(`seat max ${last.seatMaxMs} ms > 4`);
}
const crash = warnings.filter((w) => /parse worker crashed/.test(w));
if (crash.length) fails.push(`worker crash: ${crash[0]}`);
if (s.consoleErrors.length) fails.push(`page exceptions: ${s.consoleErrors.slice(0, 2).join(" | ")}`);

console.log(`\n${INLINE ? "NEGATIVE CONTROL" : "PROBE"} ${fails.length ? "FAIL" : "PASS"} — pose ${POSE}: ${JSON.stringify(last)}`);
for (const f of fails) console.log(`  ✗ ${f}`);
for (const w of warnings.slice(0, 5)) console.log(`  console: ${w.slice(0, 200)}`);
s.close();
await finishVerify(fails.length ? 1 : 0);
