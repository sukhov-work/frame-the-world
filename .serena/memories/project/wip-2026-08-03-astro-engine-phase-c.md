# mem:project/wip-2026-08-03-astro-engine-phase-c — phase C: trail · click-aim · chips · cleanup

Phase C of `ASTRO_ENGINE_PLAN.md` (the owner's 5-item post-A feedback, same-day). Gates:
**vitest 674/674 (+5) · astro check 0/0 · browser-VERIFIED end to end in a VISIBLE window**
(shots `verify-shots/astroC-01-trail-on / 02-trail-off / 03-fpv-trail-marker.jpeg`).

## 1 · TRAIL (`scene/skyTrail.ts`, new)
- The tracked target's az/alt path across the observer's LOCAL SOLAR DAY — the dayArcs grammar,
  not a celestial-path chart: within a day the diurnal rotation dominates every kind (even a
  comet drifts only ~0.3°/day vs stars), and the day arc is meaningful for stars/DSOs where an
  RA/Dec path would be a dot. Accent colour = the marker's own line; hour ticks; past/future
  split; alpha-blended + depthTest:false (planning overlay — reads at noon when the marker
  itself is night-gated away).
- Sampler: **`sampleTargetArc(target, sceneMs, lat, lon)`** in `lib/ephemeris/dayArc.ts`,
  built on `targetAzAlt` — marker/trail/panel share ONE ephemeris face and cannot disagree.
  `SkyArc` = body-agnostic shape; `DayArc extends SkyArc {body}`. Shared `buildArc(at)` core.
- Renderer reuses EXPORTED dayArcs pieces: `makeArcMaterial` · `horizonFade` · `pointDirs`.
- Anchor = the SAME eye TargetPanel prints: `usePlanStore.anchor ?? camStore.focus*`. Rebuild
  deadband `SKY_TARGET.trailRebuildMinDeg` = 0.05° (an orbit pan must NOT re-run the ~170-call
  arc per frame) + rebuild on target-id change + day-crossing. Same impostor distance clamp as
  the marker ⇒ **the marker sits ON its trail** (browser-shot-verified, orbit + FPV).
- Panel toggles renamed **SHOW · MARK · TRAIL** (owner: SKY read as a mode). TRAIL persisted,
  default ON. `store/sky.trail` + `setTrail`.

## 2 · Marker click → aim + open panel
- Mesh keeps `raycast = () => {}` (billboard ≫ visible mark, would steal ground clicks). Hit
  test is ANGULAR: `trySkyMarkerClick(ndcX,ndcY)` in StylizedTiles — click-ray · targetDirW vs
  `skyTarget.hitRadiusDeg()` (= LIVE ring radius × `SKY_TARGET.clickSlack` 1.25; the ring
  widens for extended objects — M31 hit ≈ 2.5°). Requires `skyNow.visible && mesh.visible`.
- Wired into BOTH paths: orbit `onPointerUp` (priority placing > sky marker > pins) and FPV
  `onFpvPointerEnd` (new `fpvDownX/Y`; click = move ≤ ORCH.clickDragPx AND e.type==="pointerup"
  — pointercancel must not click).
- Below-horizon edge: at night mesh.visible is true even when the marker pixels are
  horizon-faded — an exact click on the hidden spot would still aim. Benign, noted.

## 3 · Post-search auto-aim + the shared aim seam
- **`store/skyAim.ts` (new): `aimAtSky(azDeg, altDeg)`** — FPV (`fpvHud || tempFpv ||
  upload.viewMode==='fpv'`) → `requestSkyLook`; orbit → `setTargetHeading` + RAISE-ONLY tilt
  `orbitTiltForAltDeg` (cap 88, margin 18). `FpvHud.bringIntoView` deduped onto it. Lives in
  store/ because lib/ is store-free by convention and both panels + the orchestrator import it.
- `LocationFinder.track()`: after target resolve → `targetAzAlt` at (plan anchor ?? focus) at
  `sceneTimeMs()` → aim only if `altDeg > 0` (below horizon: camera stays; NEXT SESSIONS is
  the tool). Verified: orbit pick sets th/tt then consumes them, heading lands on the azimuth;
  FPV pick sets `skyLook` and the glide centres M31 to NDC (−0.001, −0.004).
- **Platform limit (expected, documented in the chip comment):** GlobeControls caps tilt by
  altitude — at 246 km it arrives ~74°, so a high target stays best-effort ABOVE the frame top;
  at 4 km tilt 88 reaches it. Not a bug; matches the sun-chip best-effort contract.

## 4 · N-target edge chips
- `store/camera.ts`: `SkyMarkers { sun: FpvBodyMarker|null; moon: …|null; target:
  SkyTargetMarker|null }`; `SkyTargetMarker = FpvBodyMarker & {glyph, label}` (label =
  `targetShortName(target).toUpperCase()` — new helper in targets.ts, pillLabel deduped on it).
- `stepFpvHudAndSkyMarkers`: bearings reference computed when `skyGuides || skyNow.visible`;
  sun/moon slots gated by the SKY-guides chip, target slot by TARGET SHOW — verified
  independently in-browser (guides OFF → sun/moon null + target kept; SHOW off too → mirror
  null). Target dir = geocentric `targetDirW` (topocentric ≡ at chip precision for everything
  trackable).
- FpvHud: per-slot chips; target chip = glyph + `.fh-chip__label` + arrow, `fh-chip--target`
  (accent); its click aims AND fronts the panel (`onAim`).

## 5 · Cleanup (the comet-era hardcode)
- tuning.ts: **`SKY_TARGET`** group (pointCoreDeg, reticle*, impostorFarFrac, nightVis*,
  highlightDayFloor, trailRebuildMinDeg, clickSlack) split out of **`COMET`** (now coma/tail
  look ONLY). `scene/skyTarget.ts` re-pointed (~20 refs); SPAN_DEG mixes both groups (tail is
  the largest treatment).
- Prefs renamed: `cometVisible/cometHighlight` → **`skyTargetVisible/skyTargetHighlight`** +
  new `skyTargetTrail`. Migration in `sanitizeViewPrefs`: new key wins, old key read as
  fallback (wrong-typed old values still dropped). First `saveViewPref` rewrites the blob under
  new names having already migrated the values. Browser-verified: `{cometVisible:false}` →
  reload → store `visible:false`.
- `ecefFrameAt` doc comment now names all three consumer layers (bodies / comet / targets).

## VERIFY — the visible-window recipe (SUPERSEDES part of the phase-A trap)
- **This Playwright MCP rides a HEADED Chrome over CDP `:9222`** (user-data-dir
  `~/Playwright_Chrome_data`, `Browser: Chrome/150` — NOT HeadlessChrome). The tab is hidden
  only because it's backgrounded ⇒ **`curl http://localhost:9222/json/activate/<targetId>`
  makes it truly visible: `document.hidden:false`, real 60 fps rAF, glides land in seconds.**
  Get ids from `/json/list`; close stuck tabs with `/json/close/<id>`. Do this FIRST next time.
- Hidden-tab ladder (only if visibility is impossible): rAF→setTimeout shim gives ~1 s frames
  for ~5 min after each reload (standard throttling), then Chrome intensive throttling clamps
  to ~1/min and NOTHING glide-based completes; dt-capped glides advance ~10× slower than wall
  clock even in the 1 s regime. **TRAP: a MessageChannel "unthrottled rAF" pump floods the task
  queue and starves CDP evaluate — the page becomes unreachable and every MCP call times out;
  force-close the tab via `/json/close`.** Also: `page.waitForTimeout` is runner-side (never
  throttled); in-page `setTimeout` waits are throttled — never await page timers while hidden.
- Marker screen position for clicks: project through the REAL camera —
  `__globe.skyTarget.mesh.position.clone().project(__globe.camera)` (the mesh is the marker).
  Deriving px from heading/tilt mirrors FAILS: tilt is nadir-referenced at the FOCUS frame
  (view-centre elevation = tilt−90, NEGATIVE in orbit) and the camera-ENU vs focus-ENU frames
  diverge by the curvature angle at altitude.

## Tails
- Phase A tail unchanged: `/api/sbdb` on Wix cloud UNVERIFIED (first egress route).
- Phase B (data: full OpenNGC, IAU star names, MPC comets, asteroids w/ H/G law, SIMBAD TAP
  fallback + localStorage cache) · D (render polish) · E (planner skyline verdict) — in
  `ASTRO_ENGINE_PLAN.md`.
- Owner eyeball of the trail look/weight still pending (I verified presence/geometry, not taste).

Related: [[project/wip-2026-08-03-astro-engine-phase-a]] [[patterns/sky-bodies-terrain]]
[[patterns/globe-rendering]] [[bugs/comet-magnitude-model]]
