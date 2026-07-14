# WIP 2026-07-14 — UI/UX QoL batch (6 owner tasks) — SHIPPED (browser-VERIFIED)

**Mode:** implement/Standard (/frame + investigate-design-v3). **Gates: 543 vitest (+13) ·
astro check 0/0 · wix build Complete · browser-VERIFIED in wix dev via Playwright MCP.**
Shots: `verify-shots/uiux-01-plan-pill-topleft.jpeg` (new layout + transport) ·
`uiux-02-fastforward-1hrs.jpeg` (FF at 1 HR/S: red labels, day rollover) ·
`uiux-03-fpv-sunlook.jpeg` (FPV eased onto the sun after chip click) ·
`uiux-04-pd-grip-hover.jpeg` (placed photo, no h-scroll, outside grip).
NO globe scene/shader code touched → S5 night golden gate not re-run (not applicable).

## 1 · Uniform drag handles (DragGrip rework)
ONE placement for every panel: a tab floating just OUTSIDE the window above its top-right corner
(`bottom: calc(100% + 3px); right: 0; width: max(30px, 10%)`), hidden (`opacity: 0`) until the
HOST panel is hovered — **the reveal is `:hover > .drag-grip`**: CSS :hover matches an element
when the pointer is over ANY of its DOM descendants, even one positioned outside its box, so
hovering the panel body or the tab itself both reveal it. An invisible `::before` halo
(inset −6/−8) bridges the pointer's travel from panel edge to tab.
- **pointer-events:none hosts (.tr scene clock, .fh view card) never match :hover from their
  body** — they keep a faint 0.28 resting opacity so the handle stays findable.
- `inset`/`corner` variants DELETED. The overflow:auto panels that needed them (.pd photo
  detail, .mp-panel my-pins) were RESTRUCTURED: overflow moved to an INNER wrapper
  (`.pd-scroll` / `.mp-scroll`, flex column + `min-height:0`) so the outside tab isn't clipped.
  RULE recorded in DragGrip.tsx doc: a scrolling panel keeps overflow on an inner wrapper.
- mp-enter keyframes now compose `--drag-x/--drag-y` (the pd-enter fix, same idiom).
- usePanelDrag mechanics untouched (session Map, clamp, dblclick reset — re-verified live:
  drag −120/−90 exact, dblclick returns).

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
- UI (TimeScrubber): ±H/±M stepper pairs + PLAY/STOP chip + rate `<select>` (SCRUB.playRates
  [60,600,3600] + REAL ×1) live in a new `.ts-foot` row between the ±12h span labels; steppers
  recentre the rail anchor only when landing in the edgeRecenterFrac clamp band (day steps
  always do, hour/minute walk the knob). Display ticks at SCRUB.playTickMs 150 (playing) /
  10 s (live) — display only.
- FF signals: `.ts-offset` gets `▶▶` prefix + `--color-danger`; new `.ts-ff` "FAST-FORWARD
  1 HR/S" label; TimeReadout mode chip `▶▶ ×3600` red + `.tr-dot--ff` red dot (real-speed
  playback = `▶ PLAYING`, amber dot). **CSS trap: `.tr-mode--ff` must out-specify `.tr-mode`
  declared LATER in the file → `.tr-mode.tr-mode--ff`.**
- Live-verified: 3 real s at ×3600 advanced scene 184 min; clock rolled past midnight fluidly.

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
`.pp-root { left: 1.6rem; top: 3.4rem; z-index: 31 }` (above .pd's 30 — an opened planner must
not hide under the photo panel). `.pp { top: 2.4rem; width: 12.5rem; max-height: max(10rem,
min(24rem, calc(100vh − 39rem))) }` — the 39rem keeps the open card clear of the FPV mini-map
slot (mm top edge ≈ 33rem above viewport bottom + pill offsets). Narrow media query: top 7.5rem
(under the full-width search). Head (title + anchor + InfoDot) stays OUT of the new `.pp-scroll`
body so the InfoDot tip never scroll-clips.

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
- **FPV:** stepFpvPose glide BEFORE the yaw/pitch application, against the PRE-look anchor
  basis: final view az = az0 + fpvYaw (the −yaw rotation about geodetic up is compass-clockwise),
  final elev = baseElev + fpvPitch → targets fall out directly; pitch target honours
  ±FPV.pitchClampDeg; ease `1 − exp(−dt/FPV.skyLookEaseTauMs 320)`; snap+clear at <0.003 rad.
  ENU east/north from ecefToGeodetic at the eye (ECEF z = polar axis).
  Live: heading eased 112°→300° exactly onto sun az, pitch 2.9° vs sun alt 2.8°, chip gone.
- **Orbit:** chip click resolves directly into existing glides — `setTargetHeading(azDeg)` +
  tilt only ever RAISED: `min(88, 90 + altDeg − 18)` (18° margin keeps the body inside the
  ~55° vertical frame; 88 = platform tilt cap, high sun = best-effort at frame top).
  Live: tilt 60→75, sun in frame, chip disappeared, targets cleared.
- BodyChip is now a real `<button>` (pointer-events:auto, hover ring, tip "BRING IT INTO VIEW");
  FPV-vs-orbit branch: `st.fpvHud !== null || uploadStore.viewMode === "fpv"`.

## Files
EDITED: `store/time.ts` (playback + localTimeStr/withLocalTime) · `store/camera.ts` (skyLook) ·
`lib/geo/urlPose.ts` (formatSceneHash/parseTimeHash) · `StylizedTiles.ts` (boot t-restore ·
hash t-write · skyLook glide + cancels · scratch vecs) · `tuning.ts` (SCRUB.playRates/playTickMs ·
FPV.skyLookEaseTauMs) · panels TimeScrubber (transport rework) / TimeReadout (FF states) /
FpvHud (clickable chips) / PlanPanel (pp-scroll) / PhotoDetailPanel (pd-scroll + tiers tip pos) /
MyPins (mp-scroll) · `ui/DragGrip.tsx` (variants removed) · styles drag-grip (rewrite) /
time-scrubber / time-readout / fpv-hud / plan-panel / photo-detail / my-pins / upload-flow ·
tests time.test.ts (+9) / urlPose.test.ts (+4).

## UNVERIFIED tails
- Playback knob tick at 150 ms on sub-M3 hardware (display-only interval; scene itself is
  per-frame smooth).
- MyPins .mp-scroll live check needs a member cookie (same construction as verified .pd/.pp).
- Time input UX while the native picker is open during fast-forward (value re-renders under it).
- Chip click while a cinematic flight owns the camera (targets apply after; explore eats them).

## Follow-up same session — 2 more FPV tasks (SHIPPED, browser-VERIFIED; 548 vitest (+5) ·
astro check 0/0 · wix build; shots `verify-shots/uiux-05..09`)

### 7 · BUILDINGS slider: gradual + uniform dissolve (the 55→56 jump)
ROOT CAUSE: solidity was alpha-blend + a BINARY `depthWrite = k > 0.55` flip (enriched; OSM at
0.6) — opacity ramped but the instant depth-writing engaged, faces occluded each other and the
whole mass read fully solid between two slider ticks. FIX: solidity now renders as the repo's
own SCREEN-DOOR Bayer dissolve (the F1 idiom) — **materials stay OPAQUE + depth-writing at every
k**: no transparent-sort, no recompile toggles, no threshold.
- `buildingMaterial.ts`: new `uFlatAlpha` uniform (enriched's flat law); the fill chunk computes
  `ftwA = mix(1, mix(ghostA, 1, uSolidK), uGhostK) * uFlatAlpha` and discards on
  `(ftwBayer4 + ftwHash11(vFtwBId+5)) / 16 > ftwA` — the PER-BUILDING hash jitter inside each
  Bayer step turns 16 ordered levels into an effectively continuous city-wide response (no
  banding). `FTW_BAYER_GLSL` now exported.
- `buildings.ts` setGhost/setGhostSolid: transparent/depthWrite lines DELETED (opaque always);
  edge-opacity lerp kept (thin lines blend fine).
- `enrichedBuildings.ts` setSolidity: drives `uniforms.uFlatAlpha` (0.28+0.72k) instead of
  opacity/transparent/depthWrite; trees got their OWN onBeforeCompile Bayer discard
  (`uFtwTreeAlpha`, TREES.fpvMinOpacity law) — opaque + depth-writing too.
- NOTE: the OSM near-camera ghost melt is now a stipple dissolve instead of an alpha fade (same
  F1 look the owner approved). Shadows unchanged (depth material ignores discard — was already
  true for the transparent path). Verified live: 15/50/60/100 sweep = smooth density ramp, no
  jump anywhere, 100 = clean solid.

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
- RESTORE: boot parses `#f=` (mutually exclusive with `#p=`; the `#p` boot construction was
  refactored into ONE `bootPoseAt()` helper — re-verified identical) → boots the camera
  `FPV.shareBootAltM` 260 m above the point along the shared bearing (tiles pre-stream) →
  `setTempPin`+`setTempFpv(true)` → the temp-FPV ENTRY consumes `pendingFpvShare`: exact basis
  from the shared heading (built with FRESH scratch vectors — the S7 aliasing trap),
  `fpvPitch = pitch`, `fpvEyeM = eyeM` (clamped to tempEyeMaxM), `fovTargetDeg = fov`; entry
  flight descends onto the exact eye. Welcome.tsx + the boot-poster inline regex
  (`/^#(p|f)=/`) skip on `#f`. `&t=` restore hoisted to cover both hash forms.
- Verified live: composed view (drag look + wheel zoom) → hash `#f=…,1.7,352.1,24.5,26.8` →
  fresh boot restores heading 352.1 / fov 26.8 / eye 1.7 / lat-lon exact, pitch within 0.2°
  (terrain-settle interaction with the pitch clamp — cosmetic); FPV+`&t=` combo restores both;
  `#p=` links + plain-URL welcome both regression-clean.
- Tails: pitch ±0.2° drift while terrain settles · fpvBuildingSolidity deliberately NOT in the
  hash (display preference — easy 7th field later) · walk offsets fold into the shared lat/lon
  (by design: the hash captures the CURRENT viewpoint, not the walk history).

Related: [[project/wip-2026-07-14-owner-batch-seating-ui]] [[patterns/sky-bodies-terrain]]
[[project/wip-2026-07-14-pass3-obstruction-moat]] [[patterns/design-system]]
[[patterns/globe-rendering]]
