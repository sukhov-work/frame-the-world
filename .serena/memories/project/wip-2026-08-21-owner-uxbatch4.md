# wip 2026-08-21 — OWNER BATCH #4 (16 items post-addendum) — S1 + S2 SHIPPED, S3 remains

Plan doc: `.claude/claude-docs/UXBATCH4_PLAN.md` (tracks A–F + §S2 DESIGN, per-item specs).
DECISIONS 2026-08-21 (S1) + 2026-08-21b (S2). Gates after S2: vitest 1,088/1,088 · astro
0 err/5 hints · `verify-uxbatch4.mjs` (S1 regression) ALL PASS · NEW `verify-uxbatch4-s2.mjs`
15/15 both shells (shots verify-shots/uxb4-s2-01..07).

## S1 shipped (see DECISIONS 2026-08-21 + plan §S1 — summary)
#2 selection tint killed · #3 2D two-finger ROTATE + tilt-door removed (`mobile2dFreeHeading`)
· #4-zoom MapWindow continuous pinch (PINCH_SENS 0.8, FPV z18) · #6 target ray far (rayLenK 6
/ canvas edge) · #7 vector ink halved + `vectorsVisible` pref + VEC/▤ VECTOR · #8 find-in-frame
above UNFOLLOW both shells · #10 long-press ▲ 3D → FPV jump · #12 /m time-only dock clock ·
#13 MapWindow drag/−10% (DragGrip clip trap) · #14 Guide resizable.

## S2 shipped (2026-08-21b — radar unify + focal cone everywhere + joystick + twist + item 16)
- **Item 16**: STREETS.textPxTarget [15,13,11]→[8,7,6] AND textHeightM [22,15,11]→[11,7.5,5.5]
  (tuning.ts:1439/1449). The giant riverfront label WAS the world-size floor branch: on-screen
  size = max(world-size-px, pxTarget) via labelScaleFor floor-at-1 — halving only pxTarget
  would have changed nothing at street level.
- **#9 radar bands**: AIMCONES.bandSun [0.3,0.38] · bandMoon [0.42,0.5] · bandTarget [0.55,1]
  (unit-radius [inner,outer], tuning.ts) — ONE model consumed by GL fan (scene/aimCones.ts
  annular quad strips, spokes inner→outer, `bandFor()` exported+tested), MapWindow canvas twin
  (outer-arc + reversed-inner-arc paths) and the NEW minimap radar. compactK/lineLenK RETIRED
  (radiusTauMs→emphTauMs; emphasis gates FILL alpha only — bands can't overlap by construction);
  sun/moon dials cap at own band outer; target ray keeps rayLenK 6. `N` marker at rim az 0 all
  surfaces (GL = 64px canvas-raster quad on tangent plane, northOffsetK 1.09/northSizeK 0.11;
  MapWindow fillText rides the rotation; minimap keeps DOM `.mm-n` — it never rotates).
- **Planned-view state**: camera store `plannedView {headingDeg, hFovDeg}` (+`plannedRates`,
  `setPlannedView/setPlannedRates`) — hFov stored HORIZONTAL (kills the aspect question).
  Session-only (mapMode precedent). Seeds LWW: photo placement (stepPlannedView watches
  phase+params key), #10 jump consume (StylizedTiles seeds from jump pose at live aspect),
  FPV exit (both hud-null branches seed from the dying hud — continuity), joystick first touch
  (camGeo heading + tempFovDeg hFov). Integration: `lib/geo/plannedView.ts` (stickRate expo /
  integratePlanned low-pass+wrap+log-clamp / plannedAtRest / horizontalFovDeg — CANONICAL home
  now, minimapFeed re-exports) + orchestrator `stepPlannedView` (no store churn at rest).
- **Focal cone everywhere**: NEW token `--color-focal-cone` #E08FC6 orchid-rose (tokens.css +
  tokens.ts bridge — timeFuture/pinIce/cometTail too close to radar future-blue, lavender =
  places). FOCALCONE tunables (fillAlpha 0.05, edgeAlpha 0.55, minHFovDeg 3/maxHFovDeg 120,
  rate ceilings 45°/s + 0.9/s, γ via CONTROLS.rateExpoGamma). GL = NEW `scene/focalCone.ts`
  (unit ENU wedge, rebuild only on hFov Δ>0.1°, heading = rotation.z; reach = radar radius ×
  rayLenK; rides aimCones anchor/band/master, hidden in FPV) wired in stepAimCones. MapWindow:
  hardcoded 0.22 block REPLACED — fpvHud (live, at eye) > plannedView (at radar anchor, gated
  aimVisible), reach = window edge. MiniMap cone re-inked focalCone.
- **#11 AimJoystick**: `Joystick` parameterized (raw unit-disc `onVector`, label/aria/class);
  NEW SHARED TIER `src/components/controls/Joystick.tsx` — the mobile fence forbids
  panels↔mobile so instruments whose FEEL must not fork live in controls/ (rule 3 added to
  mobileFence.test.ts: controls may import ONLY react+store+lib+globe/tuning+styles). In FPV
  writes real setHeadingRate/setFovRate; outside seeds+writes setPlannedRates. Mounts: /m
  2D/3D map surface bottom-left (MobileShell, !fpvOn) + minimap card bottom-right (both
  shells, `.m-joy--aim-minimap` 72px absolute) — knob wears focal-cone ink.
- **#4b MapWindow twist**: `view.rot` (rad, north-up 0, reset per open) + ONE rotation-aware
  transform (`xformNow()` fwd/inv) replacing the 4 duplicated zDraw stacks; tiles blit under
  ctx.rotate with half-diagonal AABB range (+1px overdraw seam guard at rot≠0; texel-snap
  round kept at rot=0); pt()/N/cone angles add rot; tap-promote de-rotates via inv; pinch
  composes twist (angle Δ, undamped 1:1) + midpoint pan; wheel/chips untouched.
- **S1 BUG found+fixed**: long-press trailing click RETARGETS after the pressed chip unmounts
  (tempFpv flips chrome within a frame) → click landed on member-gated SAVE VIEW → LOGIN page
  navigation mid-jump (browser-caught: www.plux.today/__auth/loginv2, read as a white "crash").
  Fix: one-shot document-level capture click swallow, 900ms fuse — SceneActions.jumpHere +
  MapWindow.viewFromHere. **TRAP: element-level click-swallows die with the element.**

## Side quest (owner ask): rendering-pipeline optimization audit + cache measurement
- Static audit (scout, all file:line-cited in session log): U5 closest-first (loadAncestors
  false + comparator on buildings/enriched, ground excluded, fpvBiasK FPV-gated, queue caps
  12/3 mid via setQualityTier fan-out) · U6 foveation (per-tier cfg, region targets 8/4/2 all
  3 renderers, periphery relax buildings/enriched only, FPV-only boundary) · mobile tier
  (coarse→mid ceiling, DPR≤1.5, bloom on/shadows 2048 static-by-design, 3×256MB LRU + 192
  floors, 2k textures) — ALL IN-PLACE-WIRED, zero drift. S3 NOTE: GROUND.overlayResolution 512
  is a CONSTRUCTION-TIME ImageOverlayPlugin arg, no tier branch, no re-set path — the S3
  shrink-to-256 needs a plugin rebuild or upstream setter. Confirmed negatives (positive
  controls shown): zero webglcontextlost/pagehide handlers; the one visibilitychange listener
  only re-acquires the wake lock.
- **Cache measurement (S3 opener, `scripts/measure-tile-cache.mjs`, cache ENABLED)**: desktop
  view reload = 1,173 tile urls fromDiskCache vs 64 net at ~0.0MB (metadata revalidations);
  mobile view 711 vs 58 same shape; ZERO in-session re-fetches over a 6-pan wander →
  request-level cache-busting REFUTED; owner's desktop observation ≈ DevTools disable-cache
  artifact; iOS-small-cache ranking STANDS, SW mitigation stays iOS-directed. Gap: mobile-view
  WANDER gesture didn't register on the emulated tab — on-device re-measure rides T1.

## TRAPS (cumulative this batch)
- Synthetic CDP two-finger gestures on the LIBRARY canvas need ≤3px steps (ROTATE/ZOOM latch);
  MapWindow's own canvas needs no such care (twist+pinch compose continuously).
- `.mw`/any DragGrip host must NOT be overflow:hidden (clip belongs on the canvas child).
- guideContent structure test caps topic steps at 6.
- Stale-9222 Chrome (owner alias, no occlusion flags): pkill -f Playwright_Chrome_data +
  scripts/verify-chrome.mjs. ALSO: a long-lived `wix dev` predating new module files serves
  504 "Outdated Optimize Dep" → BLACK canvas — restart wix dev after adding modules.
- Element-level click-swallow dies when the element unmounts mid-gesture (S2 login-nav bug).
- vitest expectation must respect the clamp (hFov test: 60·e^0.9 > 120 clamps).

## Owner addendum #2 (2026-08-21b, post-S2 — do at S3 open, the item-16 pattern)
- **17 radar band body tint**: sun/moon band fills+rims future part = BODY colour (sunGlow /
  moonDial), past = grey; target keeps grey/blue. Cheap: GL fan/rim materials are per-body
  instances — set uFuture at creation; MapWindow + minimap twins pick future ink per body.
- **18 TargetPanel GOTO button** before SHOW (~TargetPanel.tsx:524): same action as the
  viewport chip — extract SkyGotoChips `aim` (~:105-122; below-horizon → nextRiseAzimuth →
  aimAtSky(rise.azDeg, 0)) into a shared helper, don't duplicate.

## Remaining (S3): items 17+18 above at open · #15 SW tile cache (iOS-directed now) + demand
shrink (overlayResolution needs rebuild path!) + force-cache per-URL · #5 iOS contextlost/
pagehide/lean profile · #1 minimap PiP (post-S2 draw() rewrite makes the punched hole
straightforward). Real-device gesture feel (twist damp? aim joystick feel, radar band radii
taste) rides T1 owner pass.
