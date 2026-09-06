# WIP 2026-07-14 — UI/UX QoL batch (6 owner tasks) — SHIPPED (browser-VERIFIED) (compacted 2026-09-06 from 12,571 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-08-15)

**Gates: 543 vitest (+13) · astro check 0/0 · wix build Complete · browser-VERIFIED in wix dev via
Playwright MCP.** Shots `verify-shots/uiux-01..04`.

## 1 · Uniform drag handles (DragGrip rework)
ONE placement for every panel: a tab floating just OUTSIDE the window above its top-right corner
(`bottom: calc(100% + 3px); right: 0; width: max(30px, 10%)`), hidden until the HOST panel is
hovered. **The reveal is `:hover > .drag-grip`** — CSS `:hover` matches an element when the pointer
is over ANY of its DOM descendants, even one positioned outside its box, so the panel body and the
tab both reveal it. An invisible `::before` halo (inset −6/−8) bridges the travel between them.
- **`pointer-events:none` hosts (`.tr`, `.fh`) never match `:hover` from their body** — they keep a
  faint 0.28 resting opacity so the handle stays findable.
- `inset`/`corner` variants DELETED. **RULE (in the DragGrip.tsx doc): a scrolling panel keeps
  overflow on an INNER wrapper** (`.pd-scroll` / `.mp-scroll`, flex column + `min-height:0`), or the
  outside tab is clipped.

## 2 · Time playback (store/time.ts) — the load-bearing design
Playback WITHOUT per-frame store writes: `play(rate)` records `{timeMs, playRate, playWallMs}`;
**`sceneTimeMs()` derives `timeMs + (now − playWallMs) · playRate`** (pure `playbackNowMs`,
unit-tested). Every per-frame consumer (stepEphemerisResample, shaders, arcs, planFeed) gets
continuous fluid time for free — SKY.sampleIntervalMs 1000 (SCENE ms) means at ≥1 min/s the
ephemeris resamples every frame; no stepping.
- Semantics: `play(1)` while LIVE = no-op (owner spec); `play` from LIVE at rate>1 pins first;
  `stopPlay()` freezes at the reached instant (stays pinned); `goLive()` clears playback;
  **`setTime()` during playback REBASES (keeps the reel running from the new instant)** — so
  scrubbing/chips mid-play adjust position without stopping.
- UI (TimeScrubber): ±H/±M steppers + PLAY/STOP + a rate `<select>` (`SCRUB.playRates`
  [60,600,3600] plus real ×1) in a `.ts-foot` row; steppers recentre the rail anchor only inside
  the `edgeRecenterFrac` clamp band. Display ticks at `SCRUB.playTickMs` 150 ms while playing.
- **CSS trap: `.tr-mode--ff` must out-specify `.tr-mode`, which is declared LATER in the file** →
  write it `.tr-mode.tr-mode--ff`.
- Live-verified: 3 real s at ×3600 advanced scene time 184 min, rolling past midnight fluidly.

## 3 · Precise time + shareable custom time
- `<input type="time">` beside the date picker (`localTimeStr`/`withLocalTime` pure helpers,
  same withLocalDate discipline: malformed → null, never scrub on garbage; seconds reset).
- URL: `formatSceneHash(pose, timeMs|null)` appends `&t=<utcMs>` ONLY when scene time is
  custom (pinned/playing); LIVE never shared (owner spec). `parsePoseHash` regex now
  `/^#?p=([^#&]+)(?:&t=\d+)?$/` (old links parse unchanged); NEW `parseTimeHash` (1–15 digits +
  sanity band < year 3000). Orchestrator: hash write passes `timeState.live ? null :
  sceneTimeMs()`; boot restores via `setTime(parseTimeHash(hash))` right after pose restore.
  Boot-poster `/^#p/` + Welcome checks unchanged-compatible. Live-verified: +1H → `&t=` appears;
  NOW → dropped on next write; fresh boot with `&t=` lands PINNED at 04:30; EXIF capture-time
  seeding now also rides the hash after placement.

## 4 · PLAN panel: top-left under the title, unfolds DOWN
`.pp-root { left: 1.6rem; top: 3.4rem; z-index: 31 }` (above `.pd`'s 30 — an opened planner must not
hide under the photo panel); `.pp` max-height `max(10rem, min(24rem, calc(100vh − 39rem)))`, where
the 39rem keeps the open card clear of the FPV mini-map slot. The head stays OUT of `.pp-scroll` so
the InfoDot tip never scroll-clips.

## 5 · No horizontal scroll — ROOT CAUSE + rule
**Root cause of every widget h-scrollbar: `overflow-y: auto` forces computed `overflow-x` to
`auto` (CSS spec — visible can't pair with a scrolling axis), and the tips.css `::after` tooltip
pills (laid out even when visibility:hidden) extend past the card edge → phantom horizontal
scrollbar.** Fixes: `overflow-x: hidden` pinned on every scroll container (.pp-scroll,
.pd-scroll, .mp-scroll, .uf) + tips that genuinely poked out re-anchored (PhotoDetail
`.pd-save__tiers` tip → `data-tip-pos="left"`; PlanPanel head kept out of the scroll wrapper).
Verified live with a full-page audit (every overflow-y:auto element, scrollWidth ≤ clientWidth)
in orbit + FPV + placed-photo + upload-overlay states → zero offenders.

## 6 · Click ☀/☾ edge chip → bring body into view
`camera.skyLook` one-shot request (`requestSkyLook`/`_clearSkyLook`; cleared by
clearAllTargets, FPV pointerdown look-drag, ROTATE-encoder deflection in FPV, and on FPV exit).
- **FPV:** the `stepFpvPose` glide runs BEFORE yaw/pitch are applied, against the PRE-look anchor
  basis: final view az = az0 + fpvYaw, final elev = baseElev + fpvPitch, so the targets fall out
  directly. Pitch honours ±`FPV.pitchClampDeg`; ease `1 − exp(−dt/FPV.skyLookEaseTauMs 320)`;
  snap and clear below 0.003 rad. Live: heading eased 112°→300° onto the sun's azimuth.
- **Orbit:** the click resolves into the existing glides — `setTargetHeading(azDeg)` with tilt only
  ever RAISED, `min(88, 90 + altDeg − 18)` (the 18° margin keeps the body inside the ~55° vertical
  frame; 88 is the platform tilt cap).
- BodyChip is a real `<button>`; the FPV-vs-orbit branch is
  `st.fpvHud !== null || uploadStore.viewMode === "fpv"`.

## Files
`store/{time,camera}.ts` · `lib/geo/urlPose.ts` · `StylizedTiles.ts` (boot t-restore, hash t-write,
skyLook glide + cancels) · `tuning.ts` (`SCRUB.playRates`/`playTickMs`, `FPV.skyLookEaseTauMs`) ·
panels `TimeScrubber` / `TimeReadout` / `FpvHud` / `PlanPanel` / `PhotoDetailPanel` / `MyPins` ·
`ui/DragGrip.tsx` · the matching styles · tests `time` (+9) / `urlPose` (+4).

## UNVERIFIED tails
- Playback knob tick at 150 ms on sub-M3 hardware (display-only; the scene is per-frame smooth).
- MyPins `.mp-scroll` needs a member cookie to check live (same construction as the verified panels).
- Time-input UX while the native picker is open during fast-forward.
- A chip click while a cinematic flight owns the camera (targets apply after; explore eats them).

## Follow-up same session — 2 more FPV tasks (SHIPPED, browser-VERIFIED; 548 vitest, shots uiux-05..09)

### 7 · BUILDINGS slider: gradual + uniform dissolve (the 55→56 jump)
ROOT CAUSE: solidity was alpha-blend + a BINARY `depthWrite = k > 0.55` flip (enriched; OSM at
0.6) — opacity ramped but the instant depth-writing engaged, faces occluded each other and the
whole mass read fully solid between two slider ticks. FIX: solidity now renders as the repo's
own SCREEN-DOOR Bayer dissolve (the F1 idiom) — **materials stay OPAQUE + depth-writing at every
k**: no transparent-sort, no recompile toggles, no threshold.
- `buildingMaterial.ts`: new `uFlatAlpha` uniform; the fill chunk computes
  `ftwA = mix(1, mix(ghostA, 1, uSolidK), uGhostK) * uFlatAlpha` and discards on
  `(ftwBayer4 + ftwHash11(vFtwBId+5)) / 16 > ftwA` — **the PER-BUILDING hash jitter inside each
  Bayer step turns 16 ordered levels into an effectively continuous city-wide response**, which is
  what removes the banding. `FTW_BAYER_GLSL` is exported.
- `buildings.ts` setGhost/setGhostSolid: the transparent/depthWrite lines are DELETED (opaque
  always); the edge-opacity lerp stays. `enrichedBuildings.ts` setSolidity drives `uFlatAlpha`
  (0.28 + 0.72k); trees got their own Bayer discard (`uFtwTreeAlpha`), opaque and depth-writing too.
- Shadows unchanged — the depth material ignores `discard`. Verified live: a 15/50/60/100 sweep is a
  smooth density ramp with no jump, and 100 is a clean solid.

### 8 · FPV views shareable via URL (`#f=` hash)
`#f=<lat6dp>,<lon6dp>,<eyeM>,<headingDeg>,<pitchDeg>,<fovDeg>` (+ `&t=` custom time) — NEW pure
`formatFpvHash`/`parseFpvHash` + `UrlFpvPose` in urlPose.ts; `parseTimeHash` accepts `[pf]=`.
**Eye height is GROUND-RELATIVE on purpose** (reproduces across machines regardless of terrain
LOD; absolute altitude would float/sink).
- WRITE: stepPoseMirrorAndViewport's hash block lost its `!fpvActive` gate and branches — FPV →
  `formatFpvHash` from the LIVE camera (ecefToGeodetic eye + enuBasis view az/alt from
  `camera.getWorldDirection` + `fpvEyeAboveGroundM` + `camera.fov`); orbit → formatSceneHash as
  before. Same cadence/change-gate/replaceState. Photo-FPV also writes (restores as temp FPV —
  the VIEW is shareable, the photo isn't).
- RESTORE: boot parses `#f=` (mutually exclusive with `#p=`; the `#p` construction was refactored
  into one `bootPoseAt()` helper) → boots `FPV.shareBootAltM` 260 m above the point along the shared
  bearing so tiles pre-stream → `setTempPin` + `setTempFpv(true)` → the temp-FPV ENTRY consumes
  `pendingFpvShare` with an exact basis from the shared heading (built with FRESH scratch vectors —
  the S7 aliasing trap). Welcome.tsx and the boot-poster inline regex (`/^#(p|f)=/`) skip on `#f`.
- Verified live: a composed view round-trips heading, fov, eye and lat/lon exactly, pitch within
  0.2° (terrain-settle against the pitch clamp — cosmetic); `#p=` links stay regression-clean.
- Tails: pitch ±0.2° drift while terrain settles · fpvBuildingSolidity deliberately NOT in the
  hash (display preference — easy 7th field later) · walk offsets fold into the shared lat/lon
  (by design: the hash captures the CURRENT viewpoint, not the walk history).

Related: [[project/wip-2026-07-14-owner-batch-seating-ui]] [[patterns/sky-bodies-terrain]]
[[project/wip-2026-07-14-pass3-obstruction-moat]] [[patterns/design-system]]
[[patterns/globe-rendering]]
