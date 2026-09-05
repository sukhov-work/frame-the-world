# WIP 2026-09-05 — T77 PREP: the mesh track closed, the web research in, the reconciled audit plan written

**Status: DONE (docs-only). Mode: research / design (investigate-design-v3 spine on `/frame`), tier Standard.**
Owner rulings 2026-09-05: MS8 "deployed and tested manually"; **"this concludes all mesh-related work at
the moment"** → T74 / T78 CLOSED, their taste calls parked. The owner ran the web-research prompt and
stored `rendering/WEB_RESEARCH_PERFORMANCE_RESULT_2026_09_05.md`. Order: "wrap up and prepare next
session for a full blown audit and preparation to performance and engine architecture (T77) revamp".

## What was written
- **`rendering/T77_AUDIT_PLAN_2026-09-05.md`** — the RECONCILIATION of `ENGINE_STATE_2026-09-02.md`
  (§5 refuted, §6 gaps, §8 contract, §9 DBG, §11 order, §12 falsification) with the web report (24
  ranked levers, Rq-1..17, iPhone limits, do-not-do, 8 experiments):
  - §1 the merged ordered ledger — 23 levers with slice / cost / gate: #1 texel-snapped shadow-box
    CENTRE in float64 (light-space translation), #2 cascade dispatch + blend band + metric bias +
    world-space Vogel rotation, #3 the cascade ladder (Cesium 4 × `maximumDistance` vs far cascade /
    fade band — decided after MEASURE), #4 `compileAsync` prewarm, #5 `1−exp(−dt/τ)` eases (NEW trap:
    today's per-frame `k` is frame-rate dependent), #6 per-tile height-memo invalidation, #7 bake-time
    seats + per-feature `dy`, #8 `three-mesh-bvh` worker-built, #9 KTX2/UASTC user textures, #10 worker
    KTX2/Draco via `GLTFExtensionsPlugin` (the library has NO worker glTF parse — a library limit),
    #11 InstancedMesh per GLB URL + residency by projected size/VRAM, #12 terrain shadow-map caching
    (DEPENDS on #6), #13 half-res bloom, #14 continuous render scale + FSR1 EASU/RCAS, #15 mobile shadow
    tier (distance cap, low-rate updates, MSAA×2), #16 device tier table + VRAM budget + `lruCache.
    maxBytesSize` + `UnloadTilesPlugin`, #17 coarse REPLACE tier / octahedral impostors, #18 software
    horizon occluder (render-only, never eviction), #19 Hillaire LUT sky (LAST; ΔE < 2 gate), #20 2D
    clouds + cloud shadow, #21 progressive SSAA still, #22 SMAA opt-in / alpha-to-coverage (ULTRA-first),
    #23 UBO / data-texture per-tile params for batching (needs `customProgramCacheKey` — NEW trap).
  - The refuted list doubly confirmed (csm addon, PCSS, VSM, BatchedTilesPlugin, TAA + volumetric
    clouds, three-gpu-pathtracer on the live scene, GPU occlusion queries on iOS, meshlet Nanite, parse
    concurrency / blanket LRU on phones).
  - §2 eight seams resolved (shadow caching ← per-tile epoch first; cascade ladder after measuring; MSAA
    stays mobile AA; `heightAt` stays the vertical authority (D4); A2C ULTRA-first; Hillaire last;
    `__quality.force` is a slip → `window.__globeQuality` + `quality.ts:410 force(tier)`; three owner
    scope calls open: slice order after MEASURE, the still path, the atmosphere).
  - §3 the MEASURE protocol: poses = the existing harness poses (Dnipro FPV `#f=48.4647,35.0462,1.7,
    25,8,60`; ULTRA city `#p=48.464,35.046,900,74,300`; Everest `#p=27.87,86.83,11500,76,35`; the `/m`
    chart) × models 0/6/24 (dev-seed at ONE realistic textured GLB; the 12-tri box measures nothing) ×
    ULTRA × shadows × forced tiers; the DBG rows; TWO new metrics (shadow SHIMMER, RESEAT-SETTLE time)
    as the gates of slices A/B; traps (headless → tier `low`, no GPU timer → HEADED Chrome on the M3
    Pro, warm profile; whole-frame `renderer.info`; late/absent `frame.gpu`; production world → seeds
    removed in `finally`); 1b the phone by the owner's hands (remote inspector; ramp to the jetsam kill;
    log the last-good bytes — web exp 2 gates every mobile lever).
  - §4 the slice ladder A shadows → B seats → C streaming+workers → D mobile → E later; §5 the
    session-start recipe (`scripts/verify-perf-baseline.mjs`, fenced; `rendering/MEASUREMENTS_<date>.md`).
- NEXT_SESSION_PROMPT rewritten as the MEASURE-session recipe (mesh sections compacted into one CLOSED
  block); backlog T74/T78 closed, T77 → report + plan; DECISIONS 2026-09-05b; `mem:core` Next step.

## The web report's key reframes (for the audit's frame-challenge)
- **Mobile = memory first.** iPhone tile storms / Safari reloads are the WebKit JETSAM kill (page
  ceiling ~2–3 GB incl. GPU; practical crash range far lower), not a frame-rate ceiling → KTX2, LRU caps,
  UnloadTiles, render scale; instrumentation before optimization. iOS has no GPU timer; occlusion
  queries false-positive; WebGPU shipped Safari 26 but the look is GLSL-string (D12 stands).
- **Shadows:** the missing piece is texel-snapping the CENTRE (PLUX quantises only the extent); the
  three `csm` addon overwrites `onBeforeCompile` (StrandedKitty #26) → a bespoke chained patch.
- **Seats:** Cesium #9533 documents PLUX's cache-until-tile-changes model as the fix; the fixed
  per-frame ease is a latent frame-rate bug.
- 3d-tiles-renderer 0.4.28: queue defaults 25/5 = ours; `GLTFExtensionsPlugin` (Draco/KTX2 workers),
  `UnloadTilesPlugin`, `lruCache.maxBytesSize`, `QuantizedMeshPlugin`; glTF parse is main-thread.

## Owner rulings 2026-09-05c — the phone baseline
The 17 Pro is NOT the owner's (a short borrowed window later). Owner "ok with everything": the desktop
MEASURE session as planned + the device-free proxies (`renderer.info.memory` bytes per pose on the Mac
vs the published iOS ceilings; desktop Safari on the M3 Pro for WebKit correctness) + a prepared
short-window checklist + **a cloud device farm APPROVED, paying is fine** (BrowserStack / LambdaTest /
AWS Device Farm; [UNVERIFIED] which lists the 17 Pro — a 16 Pro is a stricter stand-in). Honest
limits accepted: nothing on the Mac gives the jetsam KILL POINT, the THERMAL SOAK or A19 frame times;
Chrome/Playwright emulation = layout + touch only; the iOS Simulator (Xcode NOT installed) = real
WebKit, the Mac's GPU, no jetsam. Written: `rendering/IPHONE_BASELINE_CHECKLIST_2026-09-05.md` — part A
on the Mac (`wix dev` binds `127.0.0.1:4321` ONLY (measured) → `ngrok http 4321` (installed) + `wix dev
--allowed-hosts <host>`; sign-in not needed; the pose URLs; a runtime-gated read snapshot behind the
`debugHud` pref — the DBG window refuses coarse pointers (`dbgAllowed`) and `window.__globe` is
DEV-gated; the model-ramp script with `finally` cleanup), part B the ~35-min phone table (inspector
on, renderer string, 30 s timelines per pose, the kill ramp 6→12→24→36… until Safari's reload, an
8–10 min soak, /m), part C what each number gates, part D the farm variant, part E what stays unknown.

## Not done / for the owner
No `src/` change, no gate re-run beyond the 2026-09-05 MS8 ones (vitest 2,444 · astro 0/0/8 · knip 0).
The phone baseline needs the owner's hands. The three scope calls (§2.8) are the owner's.
