**ARCHIVED (2026-08-15)** — superseded by `mem:project/wip-2026-08-14-qol4-batch` + DECISIONS 2026-08-14 lines.

# WIP 2026-08-14 night-2 — QoL-3 owner 3-ask batch (day-moon additive fix · distinct ghosts · panel de-occlusion/deck v2 · sky hover)

Twin: DECISIONS 2026-08-14 night-2 line. Gates: **vitest 789/789 (+5) · astro 0 err/5 hints**;
desktop browser-VERIFIED (headed Chrome CDP :9222 + wix dev; shots `verify-shots/qol3-01..04`,
probes `qol3-probe-01..04`). Owner-device taste tier OPEN. Tree UNCOMMITTED (auto-ship).

## Ask 1a — day-moon dark-crescent, ROUND 2 (the REAL mechanism, supersedes qol2 §moon)
The qol2 memory's "dome depth race + camera motion breaks it" story is **WRONG for the
camera-anchored regime** — live probes: dome surface 0.45·far is ALWAYS nearer than the moon
(d = clamp(0.5·far, 1.2·near, 0.95·far) ≥ 0.5·far), both read the same frame's far, three's
reversePainterSortStable draws moon-then-dome deterministically; rAF samplers through W-walk +
look-drag repros held uDaySky = 1, near = 1, far static. The REAL defect: the day arm was
NormalBlending `vec4(albedo·(0.12+lit·3.2), lit·1.35)` — a DARK colour (≈0.3) lerped over a
BRIGHTER sky darkens every mid-lit pixel (~20% at lit 0.3); haze/bloom usually masks it, and
"moving the camera" merely changed the masking → abrupt dark telephoto crescents.
**Fix (scene/sky.ts): premultiplied CustomBlending ONE/ONE_MINUS_SRC_ALPHA, two arms** —
day = ADDITIVE-ONLY (`rgb = albedo·lit·uBrightness·SKY.moonDayAddGain`, blend-alpha 0 → can
only ADD light, darkening is impossible by construction) · night = byte-identical opaque disc
(`alpha = fade·(1−uDaySky)`, occludes stars) · discard when rgb-max AND alpha < moonAlphaDiscard
(no depth from invisible fragments — dome safety kept). CPU twin `moonDiscArms(lit, albedo,
daySky, fade)` exported + `test/components/globe/moonDayArm.test.ts` (day-alpha ≡ 0 ∀ inputs,
lit=0 → 0 contribution, night byte-identity, twilight linear). `SKY.moonDayAlphaGain` RETIRED →
**`SKY.moonDayAddGain 0.55`** (owner knob; 1.0 = full moonBrightness on the add — bloomier).
DO NOT go back to NormalBlending or put earthshine in the day arm.

## Ask 1b — ghosts "blurry + smaller than main"
Geometry was ALREADY true-size (proved in-page: state angular diam 0.5316° vs moon mesh 0.5378°;
ghost plane width 2·tan(diam/2)·d ≡ moon sphere screen diameter; same impostorFarFrac 0.5).
Perceptual only: edgeSoftness 0.45 → solid core 55% of radius at peak alpha 0.5, no bloom.
Retune (tuning.ts GHOSTS): edgeSoftness **0.18** · alphaNear **0.62** · alphaFar **0.2**
(ramp shape + pastDim 0.6 kept — fainter the further, as ordered). skyGhosts.ts untouched.

## Ask 2 — de-occlusion + deck v2
- mini-map.css: `.mm bottom 22.6 → 20.6rem` (.fh measured ~16.3rem tall, NOT the comment's ~20;
  52 px gap remains above .fh).
- plan-panel.css `.pp max-height: 100vh−41.7rem` · target-panel.css `.tp max-height:
  100vh−31.3rem`. **TRAP: max-height caps the CONTENT box** — these cards are content-box with
  0.85/1rem padding + 1px border (~1.9rem rides on top); the first cut (39.8/29.4) left a 24 px
  overlap the browser caught. Verified: PLAN clears minimap by 5.6 px, TARGET clears deck by
  6.8 px @934 vh; both linear in vh (floors 10/12rem still allow short-viewport overlap → grip).
- camera-tilt.css: `.ct .uf-slider { border-bottom: 0 }` (dividers gone — SCOPED override; the
  UploadFlow base rule in upload-flow.css:432 keeps its hairline, never edit it) · `.ct-mode`
  flex: 1 1 0 / min-width 0 / padding 0 .15rem / 0.62rem font → 6 chips share ONE nowrap row
  (per-chip narrow-cuts + `.ct-row{flex-wrap:wrap}` retired; `.ct-compass` flex:none;
  `.ct--fpv .ct-mode min-width` dropped).
- CameraTiltPanel.tsx: CAM TILT + ROTATE wrapped `{!fpvMode && …}` — tilt was already dead in
  FPV (StylizedTiles skips the glide while fpvActive); FPV look/turn = drag + WASD. Both back
  in orbit (verified labels CAM TILT/ROTATE/ZOOM after EXIT LOOK).

## Ask 3 — sky-body hover affordance (right-click discoverability)
- StylizedTiles: contextmenu candidate set extracted to **`pickSkyBody(ndcX, ndcY)`** — hover
  highlights EXACTLY what right-click opens (sun/moon always, target when visible; same
  `ORCH.skyMenuMinAltDeg` floor via dirToAzAltAtCamera).
- New **`stepSkyHover`** invoked between stepSkyTarget() and stepFrustumResnapAndTick() (ORDER
  comment updated): banked hoverX/Y (noteHover), cadence `ORCH.skyHoverEveryFrames 4`
  (pre-increment frameCount group), house ease `1−exp(−dt/ORCH.skyHoverEaseTauMs 140)`,
  per-body amounts {sun, moon, target}. Stands down: placing · `anyPointerDown` (new flag —
  notePointerDown sets, dom pointerup/pointercancel `notePointerFree` clears, removed in
  dispose) · pointer off canvas.
- Drive: `sky.setHoverGlow(sunK, moonK)` — ABSOLUTE re-derivation (uIntensity =
  SKY.sunIntensity·(1+k), uBrightness = SKY.moonBrightness·(1+k)); these uniforms are
  write-once so absolute assignment is idempotent (uniform values widened `as number` — literal
  types broke astro check). `skyTarget.hoverBoost(k)` — POST-update multiply of
  uAmp/uMarkFade/uBodyFade (per-frame writes; must be called after skyTarget.update()).
  `ORCH.skyHoverGain 0.25`.
- Cursor: "pointer" on hover; **arbitration** — stepPinHover's two clear sites now check
  `!skyHoverKind`; pins win ties by running later; placing crosshair untouched (hover ineligible
  while placing).
- Verified: uBrightness 3.2→4.0 eased on-body / back off-body, cursor pointer↔"", sun stays 5.

## Owner taste knobs (new)
`SKY.moonDayAddGain 0.55` · `GHOSTS.edgeSoftness/alphaNear/alphaFar` ·
`ORCH.skyHoverGain/skyHoverEaseTauMs` · the .mm/.pp/.tp offsets above.

## Verify traps touched
- Playwright MCP screenshots may only write inside the repo → pass `verify-shots/...` RELATIVE.
- PointerEvent-dispatch drags on the canvas work headlessly (pointerId + buttons:1 + bubbles).
- `requestSkyLook` + `__globe.sky.moonMesh.position.project(camera)` = exact screen aim recipe.
- max-height caps the CONTENT box on content-box cards (the 24 px overlap round).

Related: [[project/wip-2026-08-14-qol2-batch]] [[project/owner-orders-2026-08-14-qol-batch]]
