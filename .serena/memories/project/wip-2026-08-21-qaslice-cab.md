# wip 2026-08-21h — PRE-AUDIT QA SLICE C→A→B (owner order 2026-08-21g-end) — COMPLETE

DECISIONS 2026-08-21h. Gates: vitest 1,128/1,128 (+12) · astro 0 err/5 hints · NEW
`scripts/verify-qaslice-cab.mjs` 17/17 (shots qsl-01..05) · regressions uxb4 + s2 + s3 +
uxb5 + uxb6 + uxb7 + qa7ab ALL PASS (verify-chrome restarted between suites).

## What shipped (root causes)

### (C) CRITICAL — overlay-composite rebuild storm KILLED (sticky-up ratchet + refinement kick)
- Root cause 1 CONFIRMED: QA-7b's stepGroundUpdate resolver was TWO-WAY (512 on chart /
  tier 256 off it) → `setOverlayResolution` fresh-instance rebuild on EVERY 2D↔FPV/3D flip
  (all composited textures destroyed → white chart + refetch storm).
- FIX: NEW pure `stickyOverlayPx(prevPx, tierPx, flat2d, flat2dPx)` in `lib/globe/quality.ts`
  — effective px = max(prev, want): NEVER lowers on a mode flip OR a governor demote (the
  S3-era rebuild-on-demote folds under the same rule). `overlayPxEff` seeded 0 in
  StylizedTiles → frame-1 ratchet == constructor px (no spurious boot rebuild). ≤1 post-boot
  rebuild per rung per session (256→512 on first flat visit or a promote to high). FPV then
  shares the 512 composites — VRAM = the S3 jetsam concern, T1-judged; rollback knob:
  `GROUND.overlayResolution2dPx: 256` (kills the raise, keeps z18+DPR).
- Root cause 2 CONFIRMED by library source (UpdateOnChangePlugin.js): update() gated on
  camera-MVP change + needsUpdate flag; `preprocessNode()` self re-arms as new nodes stream
  in ⇒ ONE forced traversal chains refinement. Kicks added: `setOverlayResolution` (post-
  rebuild) AND `setQualityTier` (error-target change on a parked camera = same stall class).
- NEW DEV probe `window.__overlayRebuilds` (imageryGround) — THE storm assert: raw Esri GET
  counts CANNOT isolate the storm (see below). Verified: 1 rebuild at boot settle, 0 across
  two full 2D→FPV→2D cycles, uFtwFade holds ≈1.
- **RESIDUAL QUANTIFIED (not the regression — report to owner)**: ~600 Esri GETs per flip
  leg remain from the PRE-EXISTING ground-LRU rest-trim churn — the probe shows
  `lruCache` resting at exactly minBytesSize (145/144 MB, cap 192 on the headless `low`
  tier): the cache can't hold BOTH the 2D chart set and the FPV street set, each flip
  re-fetches the other's tiles (disk-cache hits on desktop; network on iOS's small cache —
  EXACTLY the #15 SW-cache motivation). A real phone runs `mid` → ground LRU 320 MB.
  Candidate future lever: mode-aware LRU floors or flip-freeze of the rest-trim.

### (A) Expanded-minimap follow yields to manual exploration
- `manualPan` latch in MapWindow (effect-scope let): armed by ANY pan (panBy — drag +
  pinch-midpoint) or pinch-start (2-finger down; zoom/twist without pan is manual too);
  wheel/chip zoom does NOT latch (follow-under-zoom was liked). Cleared ONLY by the
  eye-motion detector in draw(): distance-from-LATCH-ANCHOR > `FOLLOW_REARM_M 0.5` —
  anchor-distance, never per-frame delta (a 20 Hz stroll moves ~7 cm/frame; jitter must
  never accumulate). Null anchor (latched outside FPV) clears on first live camGeo (entry
  = teleport). Place-point relocation teleports camGeo ⇒ correctly re-arms (owner QA-1
  rule). Heading/focal edits move nothing ⇒ never re-arm (structural).
- Verified: drag 142 m away → holds 0.0 m for 3 s (old code snapped back in one paint);
  walk 119 m → recentres to 18.5 m (deadband edge ≈ 18.5 m at z18/390×844 — exact).

### (B) Screen-relative walk on the expanded chart (BOTH shells, one code path)
- NEW pure `chartWalkAzRad(x, y, rotRad) = atan2(x,y) − rot` in `lib/geo/slippy.ts` —
  derived from the chart's OWN fwd transform (screen = R(rot)·tileΔ, tile north = −y);
  unit tests round-trip every input direction THROUGH the transform.
- `store/minimap.mapWindowRotRad: number | null` (pipRect idiom): seeded 0 on open (before
  first draw — no camera-relative frame), deadbanded 1e-4 publish per paint, nulled in the
  open-effect cleanup. StylizedTiles walk block: if rotRad !== null build the basis in ENU
  at the eye (east = polarZ × up, the _skyEast idiom — the _sky temps are FREE there,
  skyLook consumed them earlier in the frame); fwd = az(0,1), right = fwd+90°. Else the
  camera-relative basis untouched. Desktop arrows/WASD ride the same block.
- Verified on a twisted chart (rot −4.712 ≈ −270°): stick-up world track 270.0° vs
  chart-up 270.0° — Δ 0.0° (camera heading 0° — proves it ignores the camera).
- NEW DEV probe `window.__mapWindowView` {latDeg, lonDeg, rot, z} (global.d.ts registry) —
  MapWindow view refs were unreachable from the harness.

## Traps (new)
- **GET counts cannot isolate a composite-rebuild storm** — LRU rest-trim churn re-fetches
  at the same magnitude. Assert `window.__overlayRebuilds` (mechanism), report GETs as
  diagnostics with the lruCache mb/min/max probe.
- Synthetic two-finger TWIST via CDP: constant-separation point pairs pivoting about a
  centre = pure rotation (no zoom); 8 steps × 50 ms tracks reliably. MapWindow pinch also
  latches manualPan — order A-asserts before B-twist.
- `Math.hypot(Infinity, Infinity) = Infinity` — the null-anchor re-arm falls out of the
  same distance check (no special-case branch).

## Files
lib/globe/quality.ts (stickyOverlayPx) · lib/geo/slippy.ts (chartWalkAzRad) ·
StylizedTiles.ts (overlayPxEff ratchet · chart-walk basis · import) · scene/imageryGround.ts
(2 kicks + __overlayRebuilds) · panels/MapWindow.tsx (manualPan latch + FOLLOW_REARM_M +
rot publish + __mapWindowView) · store/minimap.ts (mapWindowRotRad) · global.d.ts (2 probes)
· tuning.ts (overlayResolution2dPx doc) · tests: quality.test (+8), slippy.test (+4) ·
scripts/verify-qaslice-cab.mjs NEW (17 checks).

## Open tails
- T1 device: 512-composite VRAM/heat on real iOS (rollback knob overlayResolution2dPx 256);
  manual-drag + walk-re-arm FEEL; twisted-chart walk feel.
- LRU rest-trim flip churn — surfaced to owner + audit report (pre-existing, #15-adjacent).
## AUDIT #3 — STARTED, then RESCHEDULED (owner wrap order + an API session limit)
- Owner ordered mid-session: "schedule all audit results handling + docs remaining reorg and
  guide work for next session immediately". Independently, ALL FOUR finder agents (A1/A2/C/D)
  terminated on an API **session limit** before returning reports. The owner also re-logged-in
  and switched model mid-session — NO work on disk was affected (gates re-confirmed after).
- DONE and carried forward (do not redo): checklists RE-MINED (code.md +23 injected-GLSL
  uniform declaration · +24 per-frame writers of construction-time values must be
  sticky/monotone · +25 event-swallow + shared-CSS lifecycles; tests.md +10 the six
  verify-harness environment classes) · **Track E COMPLETE** (gates · npm audit --omit=dev 9 =
  audit-2 baseline-identical, the 30 total are dev/build toolchain · bundle 33 MB with the
  +1 MB over audit-2 fully accounted by the PLUX rebrand assets + `_astro` growth · knip 45 =
  the standalone-scripts + sw.js noise class, no config in repo · jscpd 35/1.14% with
  MapWindow↔MiniMap 29-line and aimCones↔focalCone 14-line clones as the in-scope anchors).
- **OWNER ADDENDUM 2026-08-22 (after device-testing this slice) — item A is REVERSED, queued
  as NEXT_SESSION_PROMPT §0, ahead of the audit** (DECISIONS 2026-08-22): the eye-motion
  re-arm is OUT — once the user pans the expanded chart, the override is PERMANENT (walking
  never recentres it, not even when the eye leaves the visible chart bounds); default follow
  stands until that first pan; the radar/focal-cone anchor rule is explicitly UNCHANGED. The
  only way back is a NEW round **◉** RE-CENTRE button on the map's right edge under the +/−
  zooms (centres on `aimAnchorNow`, clears `manualPan`, restores follow) — wire it through
  the existing `zoomButtons.current` effect→JSX bridge idiom. Third item: ALL map attribution
  moves from the under-top-row `.mw-credit` seat to ONE very thin line at the screen's BOTTOM
  EDGE below the time strip (needs a `--mw-credit-h` offset on the /m dock + desktop
  scrubber, not a z-bump; full Esri/CARTO/OSM list stays legible — contractual). LESSON for
  the eventual fix: `FOLLOW_REARM_M`'s "movement re-arms" heuristic was MY design choice
  inside the owner's 21h spec ("only EXPLICIT MOVEMENT re-arms") — the owner tried it and
  wants no automatic re-arm at all. When a spec says "X re-arms it", confirm whether the user
  wants ANY automatic return before building the detector.
- **Agent transcripts were HARVESTED before wrap** — recovered PRE-VERIFICATION leads live in
  `NEXT_SESSION_PROMPT.md`'s "RECOVERED partial findings" block. Headlines: checklist-23 GLSL sweep
  CLEAN on all four chained-shader sites · `verify-uxbatch5.mjs` keys its FPV-entry check on
  `.m-joy`, which mounts UNCONDITIONALLY at /m boot (MobileShell.tsx:85) ⇒ passes for the
  WRONG reason (recurring pattern — sweep all scripts) · nothing fences the checklist-23 trap ·
  `conventions/globe-tuning.md` has ZERO hits for ALL new tunables · ARCHITECTURE current only
  to 2026-08-18 · UXBATCH4_PLAN fully shipped ⇒ archive · README gate counts stale (1,004 vs
  1,128) · T31/T32 OPEN · A1 recovered NOTHING (full re-run). Two independent confirmations of
  THIS session's work: imageryGround's constructor arg == tier px (sticky frame-1 write is a
  true no-op) and chartWalkAzRad's test convention matches MapWindow's real `fwd` exactly.
- LESSON: a 4-way parallel finder fan-out can exhaust the session limit — next run, launch the
  tracks in two waves (A1+A2, then C+D) or cap agent effort, so a limit never voids all four.
