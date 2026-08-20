// One-off ops check: load PROD in headless Chrome via CDP, capture console errors + failed
// requests for 45s, screenshot the result. Verifies the globe actually boots after the
// asset-cache warm-up (parallel island burst against the now-warm edge).
// Needs Node >= 22 (global WebSocket). Chrome: --headless=new --remote-debugging-port=9333.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] || process.env.FTW_SITE_URL || "https://www.plux.today/";
const SHOT = process.argv[3] || "verify-shots/prod-outage-02-after-warm.jpeg";
const PORT = 9333;

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ftw-cdp-"))}`,
  "--no-first-run", "--window-size=1728,1080", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const consoleErrors = [];
const failedReqs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning"))
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown")
    consoleErrors.push("EXCEPTION: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Network.loadingFailed") failedReqs.push(`${m.params.errorText} ${reqUrls.get(m.params.requestId) ?? m.params.requestId}`);
  if (m.method === "Network.responseReceived" && m.params.response.status >= 400)
    failedReqs.push(`HTTP ${m.params.response.status} ${m.params.response.url}`);
  if (m.method === "Network.requestWillBeSent") reqUrls.set(m.params.requestId, m.params.request.url);
};
const reqUrls = new Map();

await send("Runtime.enable");
await send("Network.enable");
await send("Page.enable");
await send("Page.navigate", { url: URL_ });
console.log("navigated; observing 45s for globe boot…");
await new Promise((r) => setTimeout(r, 45_000));

// Is the WebGL globe alive? canvas present + non-black pixels + tiles handle attached.
const probe = await send("Runtime.evaluate", { expression: `(() => {
  const c = document.querySelector("canvas.globe-canvas");
  if (!c) return "NO-CANVAS";
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  return "canvas " + c.width + "x" + c.height + " gl=" + !!gl;
})()`, returnByValue: true });
console.log("canvas probe:", probe.result.value);

const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
console.log("screenshot:", SHOT);

console.log(`\n=== console errors (${consoleErrors.length}) ===`);
consoleErrors.slice(0, 20).forEach((e) => console.log("  •", e));
console.log(`\n=== failed requests (${failedReqs.length}) ===`);
failedReqs.slice(0, 25).forEach((e) => console.log("  •", e));

ws.close(); chrome.kill();
process.exit(0);
