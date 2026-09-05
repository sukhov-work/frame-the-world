# iPhone 17 Pro baseline — the 30–45 minute checklist (T77 step 1b)

Owner rulings 2026-09-05: the phone is not the owner's; a short window with it may come later; a
cloud device farm is approved (paying is fine) for the stages that need a real phone before then.
This checklist is written so ONE short session with a real device produces the two numbers nothing
on the Mac can: **the memory kill point** and **sustained frame time on the A19**. Everything else
in T77 step 1 runs on the desktop (`T77_AUDIT_PLAN_2026-09-05.md` §3).

## A. Before the phone arrives (the MEASURE session does this on the Mac)

1. **Reach.** `wix dev` binds `127.0.0.1:4321` only (measured 2026-09-05), so a phone or a farm
   cannot hit it over the LAN. The route is a tunnel: `ngrok http 4321` (installed at
   `/opt/homebrew/bin/ngrok`) → a public https URL; start the dev server as
   `wix dev --allowed-hosts <the-ngrok-host>` (the Host-header allowlist, `@wix/cli` docs).
   Member sign-in over the tunnel is NOT needed (the OAuth callback is `localhost`) — the phone only
   VIEWS the world; the harness on the Mac seeds and removes models. Alternative for a farm run
   without a tunnel: `wix preview` (a preview deployment) — a release build, so the `window.__*`
   DEV seams are absent there; only the inspector's own instruments and a runtime seam (step 3) read.
2. **Poses** (the plan's §3, as phone URLs on the tunnel host): the Dnipro FPV eye
   `#f=48.4647,35.0462,1.7,25,8,60&t=1787133600000`; the ULTRA city orbit
   `#p=48.464,35.046,900,74,300`; Everest `#p=27.87,86.83,11500,76,35`; the `/m` chart pose.
   Pre-warm nothing — a phone's first load IS the measurement.
3. **A runtime read seam** (a DEV-seam-class `src/` change the MEASURE session may make): the DBG
   window refuses coarse pointers (`DebugPanel.tsx` `dbgAllowed`) and `window.__globe` is
   `import.meta.env.DEV`-gated, so on a phone nothing reads `renderer.info`. Expose ONE read-only
   snapshot (`renderer.info.render` + `renderer.info.memory`, the tier, DPR, the resident-model
   counts) on `window` behind the same `debugHud` pref the desktop chip uses — compiled everywhere,
   inert until the pref is on, no behaviour.
4. **The ramp.** A script on the Mac that seeds N resident models (`/api/dev-seed kind:"model"` at
   ONE realistic textured GLB — the plan's rule) at 20–60 m around the FPV eye: N = 0, 6, 12, 24,
   then +12 per step; it removes every row in `finally` (the Wix world is PRODUCTION).
5. Print this file; have the desktop numbers for the same poses on screen to compare.

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

## D. The cloud-farm variant (approved 2026-09-05; paying is fine)

Same checklist, run remotely: BrowserStack Live / LambdaTest Real Device / AWS Device Farm offer
real iPhones with a remote Safari and an inspector-class devtools pane; the app reaches them
through the vendor's local tunnel (BrowserStack Local) pointed at `wix dev`, or through `wix
preview`. Limits to expect: session-time caps cut the soak short (run it as several 10-minute
sessions and compare the start of each), no USB Web Inspector — the vendor pane exposes console +
network + a frame-rate readout; **[UNVERIFIED 2026-09-05] which vendor lists the iPhone 17 Pro
itself today** — check the fleet page before subscribing; a 16 Pro (A18 Pro) is an acceptable
stand-in for the kill mechanism and gives a stricter bound.

## E. What stays unknown without a real phone

The jetsam kill point, the thermal soak curve, and A19 frame times. Every other T77 number comes
from the Mac (the plan §3) — desktop Safari for WebKit correctness (HalfFloat MSAA, missing
extensions, shader compile), `renderer.info.memory` bytes per pose as the device-free memory proxy,
judged against the published iOS ceilings (web report §3).
