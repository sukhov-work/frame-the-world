# iPhone 17 Pro baseline — the 30–45 minute checklist (T77 step 1b)

Owner rulings 2026-09-05: the phone is not the owner's; a short window with it may come later; a
cloud device farm is approved (paying is fine) for the stages that need a real phone before then.
This checklist is written so ONE short session with a real device produces the two numbers nothing
on the Mac can: **the memory kill point** and **sustained frame time on the A19**. Everything else
in T77 step 1 runs on the desktop (`T77_AUDIT_PLAN_2026-09-05.md` §3).

## A. Before the phone arrives — DONE on the Mac 2026-09-05 (the MEASURE session; verbatim recipes)

1. **Reach.** `wix dev` binds `127.0.0.1:4321` only, so a phone or a farm cannot hit it over the
   LAN. The route is a tunnel (both halves verified 2026-09-05: `ngrok` 3.22 is installed at
   `/opt/homebrew/bin/ngrok`; `wix dev --help` lists `--allowed-hosts <allowedHosts>` — "a
   comma-separated list of allowed hosts or allow any hostname"). The owner runs, in two terminals:
   ```bash
   ngrok http 4321                                   # → https://<id>.ngrok-free.app (the public host)
   npx wix dev --allowed-hosts <id>.ngrok-free.app   # the Host-header allowlist; restart if it was up
   ```
   Member sign-in over the tunnel is NOT needed (the OAuth callback is `localhost`) — the phone only
   VIEWS the world; the Mac seeds and removes models. **This is a `wix dev` (DEV) build over the
   tunnel, so every `window.__*` seam exists on the phone too**, including `window.__debugFeed`
   and `window.__globe` — the tunnel is strictly better than `wix preview` for the baseline.
   Alternative for a farm without a tunnel: `wix preview` (a release build) — the DEV seams are
   absent there and ONLY the runtime seam of step 3 reads.
2. **Poses** (as phone URLs on the tunnel host; the same instants the desktop baseline used):
   - Dnipro FPV eye — `https://<host>/#f=48.4647,35.0462,1.7,25,8,60&t=1787133600000`
   - Dnipro ULTRA city (heading 74°, tilt clamped 88°, ~26 km back) —
     `https://<host>/#p=48.464,35.046,900,74,300&t=1787305200000`
   - Dnipro orbit (the model ramp's orbit pose, camera ~0.9 km from the eye) —
     `https://<host>/#p=48.4647,35.0462,700,25,40&t=1787133600000`
   - Everest — `https://<host>/#p=27.87,86.83,11500,76,35&t=1787305200000`
   - the `/m` chart — `https://<host>/m#p=48.4640,35.0460,220,0,0&t=1787313600000`
   Pre-warm nothing — a phone's first load IS the measurement.
3. **The runtime read seam — BUILT 2026-09-05.** `window.__debugFeed` (`lib/globe/debugFeed.ts`
   `publishDebugFeedSeam`; registry `src/global.d.ts`; contract `conventions/contracts.md` §3):
   `snapshot()` flattens every DBG provider (`canvas.*` tier / dpr / shadow px / `renderer.info`
   geometries · textures · programs, `tiles.{bld,gnd,enr}.*` lruMB · inCache · visible · queues,
   `tiles.img.composites`, `terrain.*` epoch · memo, `buildings.*`, `models.*` resident · skipped ·
   tris, `ultra.*`) plus the six per-frame series' statistics (`frame.dt/cpu/draw/gpu/calls/tris`
   `.p50 .p95 .max .avg .n`). DEV builds publish it always; a release build publishes it — and
   ACTIVATES the per-frame series on a shell that never mounts the panel — only when the `debugHud`
   pref was on at boot (`lib/globe/debugBoot.ts` → `GlobeCanvas`). **Phone console recipe:**
   ```js
   // once, then reload (the pref is read at boot; on /m there is no chip):
   (k => { const o = JSON.parse(localStorage.getItem(k) || "{}"); o.debugHud = true; localStorage.setItem(k, JSON.stringify(o)); })("ftw:view-prefs:v1")
   // after 30 s settled at the pose (the series rings hold ~4 s of frames):
   const s = window.__debugFeed.snapshot();
   ({ tier: s["canvas.tier"], dpr: s["canvas.dpr"], shadowPx: s["canvas.shadowMapPx"],
      dt: s["frame.dt.p50"], cpu: s["frame.cpu.p50"], draw: s["frame.draw.p50"], gpu: s["frame.gpu.p50"],
      calls: s["frame.calls.p50"], tris: s["frame.tris.p50"],
      geom: s["canvas.infoGeometries"], tex: s["canvas.infoTextures"], programs: s["canvas.infoPrograms"],
      lruMB: [s["tiles.bld.lruMB"], s["tiles.gnd.lruMB"], s["tiles.enr.lruMB"]], composites: s["tiles.img.composites"],
      models: [s["models.resident"], s["models.world"], s["models.skipped"], s["models.tris"]],
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : "n/a on WebKit" })
   ```
   Under the `wix dev` tunnel the pref step is optional (`__debugFeed` is published anyway) but
   still needed to ACTIVATE the `frame.*` series — call `window.__debugFeed.setActive(true)` instead
   if you skipped the pref. `frame.gpu` will read absent on iOS (no `EXT_disjoint_timer_query`);
   WebKit has no `performance.memory` — the Memory instrument is the page total.
4. **The ramp — BUILT 2026-09-05: `scripts/t77-model-ramp.mjs`** (no browser; the DEV
   `/api/dev-seed kind:"model"` route, row-only, no session; ONE realistic textured GLB — the
   Khronos DamagedHelmet, 15,452 tris, five 2048² textures, 3.6 MiB, or `--glb <stored URL>`):
   ```bash
   node scripts/t77-model-ramp.mjs status     # the journal + the eye cell's world read
   node scripts/t77-model-ramp.mjs to 6       # then 12, 24, 36 … one call per step; the phone reloads
   node scripts/t77-model-ramp.mjs clear      # BEFORE the window ends — the world is PRODUCTION
   ```
   The journal (`verify-shots/perf/ramp-seeds.json`) survives a crash; `clear` reads it. The world
   already holds 3 real member models near the eye (2026-09-05), so `to 6` gives 9 resident; past
   `MODELS.maxResident` 24 the phone reports `skipped` and the ramp measures LRU + textures, not
   models. Node ≥ 22.6 (the script imports the app's own geohash encoder as TS).
5. **The desktop numbers for the same poses** are in `rendering/MEASUREMENTS_2026-09-05.md` —
   have them on screen to compare (the `renderer.info.memory` gauges and the LRU bytes per pose
   are the device-free memory proxy; the `/m` rows are the closest desktop stand-in for the phone).

## B0. STATUS 2026-09-06 — §B ran unattended on the farm (rows 0–10) and on the Pixel; rows 18–40 did not classify on iOS

The five poses were READ on the iPhone 17 Pro and the Pixel 6 Pro (`MEASUREMENTS_2026-09-05.md` §11 —
the verdict: FPV fine, every orbit pose 9–13 fps controls-bound; fixed the same day by T79). The kill
ramp (row 18) and the soak (row 30) did NOT classify on iOS: the `#f=` FPV page dies 40–60 s after
load with or without seeded models (backlog **T83** — the Device Farm console videos decide kill vs
hang). Rows 0/3/8 (Safari inspector, timelines, Memory instrument) remain the owner's-hands path for
the page-total number iOS never exposes to a script.

## B. With the phone (the owner's hands; ~35 minutes)

| min | Step | Record (verbatim) |
|---|---|---|
| 0 | Settings → Safari → Advanced → **Web Inspector ON**; USB to the Mac; "Trust". Mac Safari → Settings → Advanced → "Show features for web developers". Develop menu → the iPhone → the tab. | iOS version · Safari version · the `WEBGL_debug_renderer_info` string (console: `document.createElement('canvas').getContext('webgl2').getParameter(0x9246)` — expected "Apple GPU") |
| 3 | Open the Dnipro FPV URL. Wait for the buildings. Inspector → **Timelines** → record 30 s: Rendering Frames, CPU, Memory. | median frame ms · the Memory instrument's page total (JavaScript / Images / Layers / Page) at 30 s · hitches (frames > 50 ms) |
| 8 | Console: the runtime snapshot (`debugHud` pref on) — `calls`, `triangles`, `memory.textures / geometries`, tier, DPR. | the snapshot as printed |
| 10 | Same at the ULTRA city pose (ULTRA off, then on if the tier allows) and Everest. | frame ms · page total · snapshot, per pose |
| 18 | **The kill ramp** at the FPV eye: the Mac seeds 6 → 12 → 24 → 36 … models; reload the phone each step; 20 s settled; Memory instrument total. Stop at the Safari "A problem repeatedly occurred" reload (the jetsam kill). | the LAST GOOD page total and model count · the first killed count · whether tiles storm before the kill |
| 30 | **The thermal soak**: back to 0 models, the FPV eye, a slow look-around for 8–10 minutes with the Rendering Frames timeline running. | frame ms at 0 / 3 / 6 / 9 min · when the DPR / tier governor stepped (the snapshot) · phone warm to the touch? |
| 40 | The `/m` chart pose: one Memory + frame reading. | frame ms · page total |

Do not run the desktop harness on the same tunnel during the phone window (the world is shared and
the seeds move). The Mac keeps every model seed's id; `finally` removes them the moment the window
ends.

## C. What the numbers gate (the plan §1 / §4)

- The **last-good page total** is the VRAM budget for the device tier table (lever 16) and the
  pass threshold for the KTX2 A/B (lever 9, web exp 3).
- The **soak curve** decides whether continuous render scale + FSR1 (lever 14) or the shadow tier
  (lever 15) leads slice D.
- The **first-load frame ms and hitches** are the `compileAsync` (lever 4) and worker-decode
  (lever 10) baselines on a phone.

## D. The cloud farm — AWS Device Farm, BUILT 2026-09-06 (owner 2026-09-06: a project with an iPhone 17 Pro single-device pool exists; 1,000 free minutes; BrowserStack paid is the fallback)

The route is a **Remote Access session + its Appium endpoint**, driven from this Mac by
`tools/devicefarm/ios-baseline.mjs` (README beside it). The Device Farm developer guide (read
2026-09-06): the session exposes `endpoints.remoteDriverEndpoint`; "test a web app by specifying the
`browserName` capability … `Safari` on iOS"; 150-minute hard cap, 5-minute idle timeout, 4-minute
per-command limit, XCUITest driver only; metered per device minute (the trial covers it); the
console page keeps the video + device syslog. The script runs §B unattended: the five poses, the
kill ramp (seed → reload → 20 s → read; a vanished boot marker = Safari reloaded = the jetsam
kill), the soak, `finally` unseeds and STOPS the session. Free-minute budget: ~25–35 device minutes
per full run → ~30 runs on the trial.

```bash
cd tools/devicefarm && npm install                         # once (its own package.json — not the app's)
cloudflared tunnel --url http://localhost:4321               # no interstitial (ngrok free shows one a scripted Safari cannot click)
npx wix dev --allowed-hosts <random>.trycloudflare.com
node tools/devicefarm/ios-baseline.mjs --host https://<random>.trycloudflare.com --dry-run
node tools/devicefarm/ios-baseline.mjs --host https://<random>.trycloudflare.com
```

**Owner setup — DONE 2026-09-06:** `awscli` + `cloudflared` installed via brew; the AWS profile
**`plux`** (region `us-west-2`, output `json`) holds the account's **root** access key — the owner's
call, flagged "be careful": the tool touches only Device Farm's List / Get / Create / Stop calls and
never prints or stores a credential; swapping the root key for an IAM user with
`AWSDeviceFarmFullAccess` is the recommended follow-up. **Dry run 2026-09-06 (read-only, no
minutes):** project `…:project:69e9a004-b773-4e76-87d5-259381e752df`; pool "Iphone 17pro" → device
`…:device:6200F380A4874FEB9C72EED72B863B67` = Apple iPhone 17 Pro, iOS 26.3.1, 1206×2622,
HIGHLY_AVAILABLE, remote access enabled (a 17 Pro Max is also in the fleet). The tool prefers the
pool's device for the session. Nothing else is needed from the owner; during a run the Mac needs the
tunnel + `wix dev --allowed-hosts` up (both started by the session, not the owner). Run as
`AWS_PROFILE=plux node tools/devicefarm/ios-baseline.mjs --host https://<tunnel>`.

**Limits to expect:** no `performance.memory` and no GPU timer on iOS (the memory number IS the
ramp's last-good count + the syslog; frame time is `frame.dt`); the trial minutes are one-time; a
device may be BUSY (the script says so and stops without a session).

## D2. Android — the owner's Pixel 6 Pro over adb, BUILT 2026-09-06

Android Chrome speaks CDP over adb and `adb reverse` makes the phone's `localhost:4321` this Mac's
`wix dev`, so the DESKTOP harnesses run unchanged against the phone (`verify-perf-baseline.mjs
--device`: no emulation, no tier override, the device's own detection). Recipe in
`tools/devicefarm/README.md` §B (USB debugging on, `adb reverse tcp:4321 tcp:4321`, `adb forward
tcp:9444 localabstract:chrome_devtools_remote`, start Chrome at the URL, `node
scripts/verify-perf-baseline.mjs 9444 --device --label pixel6pro`). Android has `performance.memory`;
`frame.gpu` is usually absent. The Pixel was not attached when this was written — the first run
classifies the adb path.

## E. What stays unknown without a real phone

The jetsam kill point, the thermal soak curve, and A19 frame times. Every other T77 number comes
from the Mac (the plan §3) — desktop Safari for WebKit correctness (HalfFloat MSAA, missing
extensions, shader compile), `renderer.info.memory` bytes per pose as the device-free memory proxy,
judged against the published iOS ceilings (web report §3).
