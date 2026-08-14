# WIP 2026-08-14 night-4 — FIND v2 rework (dedicated panel + in-frame ghost projections) [SHIPPED desktop]

Twin: DECISIONS 2026-08-14 night-4 line. Gates: **vitest 842/842 (+14) · astro 0 err/5 hints**;
desktop browser-VERIFIED (headed Chrome CDP :9222 + wix dev :4322; shots
`verify-shots/find-rework-01..03`). Owner-device taste tier OPEN. §3.5 sunsets-in-frame DEFERRED.

## Owner order + the semantics answers (owner asked explicitly)
- OLD FIND (QoL-3 FindCard): az-CROSSING root-find at ANY hour, hardcoded ±3° az/±0.5° el, zero
  FOV reads → did NOT depend on frame size/orientation; the razor el-gate = "too few options".
- v2: window = the LIVE frustum (`azAltFrameMarker` over fpvHud heading/pitch/fovDeg/aspect) —
  zoom AND orientation shape results (measured live: 45 standings @60° FOV → 0 @3°); instant =
  the scrubber's LOCAL wall-clock time on EVERY following day (`sameLocalTimeInstants`, DST-safe
  Date#setDate walk, day 0 excluded); bodies ☀/☾/✦ GC (`galacticCentreTarget`).

## Architecture (panel computes → store mirror → globe draws)
- **Engine** `lib/ephemeris/frameFinder.ts` FIND-v2 section: `bodyDayPositions` (pose-FREE pass,
  ~30 µs/sample) + `frameStandingsFromPositions` (cheap frustum filter + annotations on
  survivors) + `frameStandings` one-call; `FIND_VIS` visibility model (moon .25+.75·illum · GC
  smoothstep sunAlt −8→−18 × (1−.65·moonGlare) · blocked ×.35 · sun 1) → drives ghost alpha.
  `FrameMarker` gained fx/fy (offscreen.ts). Old `azElHits` stays (tests only, no UI).
- **Store** `store/find.ts`: open, anchor+ghosts mirror (`_syncGhosts`, single writer =
  FindPanel), hoverKey (panel→ghost) + sceneHoverKey (globe→row). `FIND_GHOST_CAP 24` (sync
  note with tuning FINDGHOSTS.maxGhosts). DEV seam `window.__findStore` (global.d.ts).
- **Scene** `scene/findGhosts.ts` + `FINDGHOSTS` tuning: InstancedMesh billboards on the
  SKY_TARGET impostor shell; HOLLOW ring (sun/moon, ringRadFrac 1.6, floor minDiscDeg .55°) or
  L1-diamond (GC, per-instance aShape) + core dot; per-instance colour from
  `lib/theme/findPalette.ts` (10 tokens, warm/cool interleaved; sunCore/sunGlow/moonlight
  EXCLUDED — anti-confusion); alpha = date ramp (.5→.12) × visibility × horizon melt × fade;
  same-body now-gap 1.2 marker-diameters vs the TOPOCENTRIC live dirs (moonPosW −
  camera.position — the night-3 parallax lesson); `pick(rayDir)` angular, pickMinAlpha .08.
- **Wiring** StylizedTiles: `stepFindGhosts` between stepSkyTarget/stepSkyHover;
  `tryFindGhostClick` in onPointerUp AND onFpvPointerEnd → setTime(hit.utcMs) +
  setTarget(bodyTarget|GC) + SHOW, camera UNMOVED (the real body arrives where the ghost stood —
  verified heading 264.96 before/after, exact timeMs, real moon landed 243/17.4 for ghost
  242.6/17.7); ghost hover inside stepSkyHover's cadence tick reusing the just-seated _pickRay
  (priority bodies > ghosts > star-names; pointer cursor; identity-guarded sceneHoverKey write).
- **Panel** `panels/FindPanel.tsx` + `styles/find-panel.css`, island in index.astro: ⌖ FIND pill
  top-left beside ☀ PLAN (.fnd-root left 7.3rem); PLAN/FIND mutually exclusive open (verified
  both ways); reuses .pp-* grammar; context "AT 18:52 EVERY DAY · NEXT 6M / LOOKING W 265° ·
  FRAME 94°×60°"; chips ☀☾✦ + 1W/1M/6M(default)/1Y; rows = swatch(=ghost colour; hollow beyond
  cap) + light dot + date + glyph + ◀▶▲▼ hint (fx/fy) + CLEAR/✕ + vis% + .ics; two-stage memo.
  FindCard.tsx DELETED; PLAN deck = FRAME · TODAY · MOON · SPOT STARS · MW. planFeed UNCHANGED —
  photo/FPV builds keep the bins mirror warm with PLAN closed (gate re-read :361-368).

## TRAPS (new, load-bearing)
- **Panel self-compute MUST be gated on `open && poseKey`** — stage-1 keyed on camera-focus
  lat/lon churns per frame during flights; ungated it re-ran the ~550-sample pass every frame
  and froze the boot flight (rAF starved, page evaluate hung 120 s). Caught + fixed live.
- **Playwright "current" tab ≠ window-selected tab** — rAF stays suspended until
  `browser_tabs select`; symptoms: flightActive forever, evaluate-with-rAF times out.
- FPV hash entry `#f=lat,lon,eyeM,heading,pitch,fov` works but the temp-FPV entry only engages
  after the boot flight lands (~20 s with tile streaming) — probe `__globe.fpv().active`.
- Ghost world dirs are static per anchor rebuild; positions re-anchored to camera per frame.

## Verified end-to-end (browser, CDP)
48 standings/6M @18:52 (old engine: a handful); ghost ladder renders (colored rings marching
into the skyline, blocked ones dimmed ×.35 matching ✕ rows); click ghost → exact jump + track +
frame unmoved; hover sync both directions + pointer cursor; zoom 60°→3° drops 45→0 live with
friendly empty state; PLAN/FIND exclusivity. UNVERIFIED: GC diamond visuals in-frame (no GC in
frame at test hour — shader branch is same-instanced, unit-tested visibility only), night moon
ghost look, welcome-hide/narrow-viewport CSS, owner-device taste (ring size at wide FOV reads
small — first knobs: FINDGHOSTS.ringRadFrac 1.6 / minDiscDeg .55 / alphaNear .5).

## Rework-2 (same session, owner follow-up) — markers restyle + paths + scrubber band + SIDERA
- Markers: fat band GONE → hairline quad-gap identity ring (hoverRing grammar; ringWidthN .07 +
  ringAlphaGain 2.2 clamped — hairlines NEED alpha compensation vs the day sky, browser-measured)
  + semi-transparent ACCURATE body picture inside (sun limb-darkened core→glow disc; moon = LROC
  SKY.moonTexture phase-lit for the HIT instant: per-instance world sunDir from
  bodyStatesAt(hit.utcMs), rotated into billboard space per frame via inverse camera quaternion,
  sphere-normal lighting + earthshine .08; bodyAlpha .6; texture sampled outside non-uniform
  branches). GC = slim diamond + dot.
- Sky paths: per sun/moon hit, the FULL day arc of ITS local day (sampleDayArc, step 20 min) as
  ONE LineSegments in the hit colour — dayArcs unit-dir + group pos/scale anchoring; per-vertex
  colour/alpha/idx + uHotIdx hover boost ×3; pathAlphaK .3 (0.5 read as a scratch bundle where
  sun arcs stack 1−(1−α)^N → soft corridor instead); arc CACHE per (body, utc-day), max 128,
  cleared on anchor move — minute scrubs never resample. GC: no path.
- Scrubber: `.ts-curves__trace-frame` 5px@78% + 3px@55% glow (was 3.6@65/2@45) — thick band =
  IN FRAME, base ribbon = absolute above-horizon visibility (semantics now in the css comment).
- SIDERA: UI-facing name only (Layout/MobileLayout titles + og alt, index logo+title, m.astro,
  UploadFlow brand, 4× ics "(Sidera)"); repo + PRODID + technical ids stay "frame the world".
- Cover slogan re-aimed (owner: upload = last priority/side gimmick): eyebrow "EVERY FRAME HAS
  ITS MOMENT" · title "Plan the shot where the world will take it." (past→future mirror of the
  old line) · sub = stand-anywhere/scrub/frame copy, upload sentence dropped; byte-mirrored in
  boot poster + Welcome (no-text-jump contract); CTAs FLIPPED: primary = EXPLORE THE GLOBE →,
  ghost = UPLOAD A PHOTO (VERIFY BREAK: .wl-btn--ghost now opens the upload overlay — dismiss
  welcome via .wl-btn--primary); Layout meta description planning-first. Shot find-rework2-05.
- Verify traps (NEW): React row hover from probes = dispatch `mouseover` (mouseenter no-op) ·
  hash-only goto = SAME-DOCUMENT nav (no reload; app rewrites its own #f=) → about:blank between
  loads ALWAYS · wix dev port flipped 4322→4321 mid-session.
- Gates 842/842 · astro 0/5; shots `verify-shots/find-rework2-01..04`. UNVERIFIED fine-grain:
  crescent orientation on the phase picture, GC diamond visuals, night look. Taste knobs:
  ringAlphaGain/bodyAlpha/pathAlphaK/pathHotBoost/ringWidthN.

Related: [[project/wip-2026-08-14-qol4-batch]] [[project/wip-2026-08-14-qol3-batch]]
