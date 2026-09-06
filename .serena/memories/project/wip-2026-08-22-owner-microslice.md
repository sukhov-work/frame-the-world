# WIP 2026-08-22 — OWNER MICRO-SLICE (3/3 SHIPPED) (compacted 2026-09-06 from 11,740 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-09-06)

Owner addendum after device-testing the 2026-08-21h QA slice. Items 1+2 are one behaviour plus its
escape hatch.

## What shipped

### 1. The manual-pan override is PERMANENT (supersedes the 08-21g eye-motion re-arm)
Owner: *"I do not want to auto-latch back after any manual panning starts, at all."*

`src/components/panels/MapWindow.tsx`: `FOLLOW_REARM_M`, the `manualAnchor` ref and the eye-motion
re-arm block in `draw()` are DELETED. `manualPan` is armed by `panBy()` (drag + pinch midpoint) and
by the 2-pointer branch of `onPointerDown`; wheel and chip zoom never latch; the `&& !manualPan`
guard on the FPV-follow block stands. Radar, focal cone and eye dot needed NO change — `draw()`
already places them at `toPx(anchor)`, so they scroll off with the world.

### 2. NEW round ◉ RE-CENTRE button — the main path back
- `.mw-btn.mw-recenter`, glyph **◉ U+25C9**, `aria-label="Centre the map on me"`. Action =
  `aimAnchorNow(useCameraStore.getState())` (the SAME anchor the radar uses) → write
  `view.current.lat/lonDeg` → clear the latch → `requestRedraw()`. Wiring reuses the bridge idiom
  (`recenterRef.current`).
- NOT the *only* path (audit A1-13 corrected the 22a prose): `manualPan` + `setPanned` live in the
  `[open]` effect, so closing and reopening the window clears the latch too — and on /m the PiP tap
  IS close.
- Seat `right: .75rem; top: 3.1rem` on desktop; on /m the PiP owns that rung, so the button hangs
  off the PiP's bottom edge. Since 22b both derive from `--mw-top-y` + `--mw-pip-h`, so the whole
  `[+ −] · [PiP] · [◉]` rail moves as one; the /m seat carries a `min()` FLOOR against `.m-altcol`.
- The React mirror `panned` is written on **transitions only** (`if (manualPan) return` at the top of
  `latchManualPan`); `setPanned(false)` on (re)open, because the island stays mounted while closed.

### 3. Attribution → ONE thin full-bleed line on the SCREEN's bottom edge
- NEW `--mw-credit-h: 0.85rem` on `:root` in `map-window.css`; consumers read
  `var(--mw-credit-h, 0.85rem)` so a late sheet degrades gracefully.
- The two bottom-anchored time surfaces are **LIFTED, never z-bumped** (`body.mw-open .ts` and
  `body.m.mw-open .m-bottom` add the credit height). `body.m.mw-open .md` DROPS its safe-area term —
  the credit bar owns the inset, and double-counting leaves a dead band on every notched iPhone.
- `box-sizing: content-box` on the bar so the inset ADDS to the line height (border-box crushed the
  text on iOS). `.mw-creditbar` is a **SIBLING of `.mw`**, never a child: `.mw` carries the
  centring/drag transform, which is the containing block for any `position:fixed` descendant.
- `pointer-events:none` on the bar, `auto` on the anchor only; `nowrap` + `clamp()` font size.

## THE TRAP THIS SLICE FOUND (browser-only — no unit test could have)
On **desktop** `src/pages/index.astro`'s page-level `.map-credit` ALREADY pins an attribution
line to the bottom edge, and its source list is a strict **SUPERSET** of the map window's
(Cesium ion · OpenMapTiles · Copernicus WorldDEM-30 · NASA · Gaia on top of Esri·CARTO·OSM).
The new bar drew straight over it — two overlapping lines in the first desktop shot.
**Resolution:** `.mw-creditbar` is **/m-only** (the `.mw-pip` precedent — /m has no page
credit at all); desktop instead **promotes the page line** to the same full-bleed bottom bar
while `body.mw-open`, via a new inert `.map-creditbar` wrapper. The anchor's
`pointer-events: auto` must live on the **BASE** `.map-credit` rule — scoping it to
`body.mw-open` silently killed the closed-state attribution link (caught by the new
closed-state check, now fenced in the unit test).
**Rule for next time:** before adding a screen-edge surface, enumerate what already owns that
edge on BOTH shells — they are not symmetric (`/m` has no page chrome).

## Verification
- Gates: **vitest 1,139/1,139 (102 files)** · `astro check` **0 err / 5 hints**.
- `scripts/verify-qaslice-cab.mjs` **39/39**, now with a DESKTOP leg (it was /m-only): the chart
  held **0.0 m** through a walk; the eye reached **302 m** from the chart centre against a 184 m
  half-diagonal (off-bounds proof); ◉ centres to 0.0 m; following re-tracks to the 18.5 m deadband.
- All **seven** regression suites PASS, Chrome restarted between suites. Shots `qsl-01..07`.

### Superseded checks (annotated, never silently deleted — the house rule)
- `verify-qaslice-cab.mjs`: *"A: walking re-armed the follow — chart recentred onto the eye"*
  → INVERTED to *"walking does NOT recentre the chart"* + a new off-bounds assertion.
- `verify-uxbatch7.mjs`: *"credit re-seated to the top band"* → INVERTED to bottom-anchored.

### NEW fence — `test/styles/mapWindowChrome.test.ts` (11 tests)
The swTileCache / hiddenPairs source-fence idiom. Locks: no re-arm survives ·
`manualPan = false` has exactly TWO sites (declaration + ◉) · the transition-only mirror
(`draw()` contains no `setPanned`) · the sibling-not-descendant bar · the `--mw-credit-h`
lift in all three files · the no-double-inset rule · round-button geometry · /m PiP clearance ·
the desktop one-line rule (`.mw-creditbar` display:none) · the base-rule pointer-events.

## Files
`src/components/panels/MapWindow.tsx` · `src/styles/map-window.css` ·
`src/styles/time-scrubber.css` · `src/styles/mobile/fpv.css` · `src/pages/index.astro` ·
`scripts/verify-qaslice-cab.mjs` · `scripts/verify-uxbatch7.mjs` ·
`test/styles/mapWindowChrome.test.ts`

## T1 device-pass riders added
◉ seat under the /m PiP (thumb reach) · the 0.85 rem attribution line's legibility on a real
device · whether the ◉ is discoverable enough.

---

# 2026-08-22b — owner follow-up + FOUR audit-#3 defects fixed BEFORE ship

## (A) Owner: the /m PiP moves up to TOP-ALIGN with the MAP/+/− pills
Done with TOKENS, not matching literals: NEW `--mw-top-y 0.6rem` + `--mw-pip-h 32dvh` in
`map-window.css`, which `.mw-top`, `body.m .mw-pip` and `body.m .mw-recenter` all derive from, so
the right rail moves as one. Measured PiP top 9.59 px == row top == pill top. `.mw-top` stays
`pointer-events:none` so its full-width invisible box passes taps through to the PiP.

## (B) THE REGRESSION THAT MOVE EXPOSED — and the general fix
The PiP is a HOLE. Anything `position:fixed` with `1 ≤ z < 20` that overlaps its rect paints
INSIDE it (batch-#5 "minimap inside minimap"). The new rung put the hole over `.m-status`
(Plux · account · GUIDE · DESKTOP, z 10) → the chips showed through.
- `.m-status` joined the `body.m.mw-open { visibility: hidden }` group.
- The **z-2 DOM label layers** joined too (`.sky-names`, `.geo-labels`, `.bldg-edit-label`). That
  bleed is PRE-EXISTING: they are positioned for the FULL-SCREEN view while the hole shows a scaled
  miniature, so they can only paint wrong there.
- **The durable fix is the CHECK**: `verify-qaslice-cab.mjs` now enumerates every fixed
  `1 ≤ z < 20` surface intersecting the PiP rect instead of naming today's offenders, and a
  fence test discovery-guards every `.className = "..."` in the four scene label modules.

## (C) AUDIT #3 wave 1 (Track A1) found 3 MAJORs in 22a — fixed, not deferred
- **A1-1 · jitter latch.** `panBy()` latched on EVERY pointer move, so a 500 ms long-press (the
  primary /m chart gesture) drifting ~2 px armed the now-PERMANENT override. The latch moved into
  `onPointerMove` behind the SAME `DRAG_CANCEL_PX 6` threshold that decides drag-from-press;
  sub-threshold still pans but never latches. A 3 px jitter leaves the button unlit.
- **A1-2 · the escape hatch was occludable.** `.m-altcol` is lifted to z 24 by `body.mw-open`,
  ABOVE the z-20 `.mw`, so on short viewports the ◉ slid under it and the tap would NUDGE THE
  EYE'S ALTITUDE. **Raising the button's z cannot fix this — `.mw` is itself a z-20 stacking
  context, so a child's z-index is scoped inside it.** Fix = geometry: `.m-altcol` publishes
  `--m-altcol-bottom` + `--m-altcol-h`, and `body.m .mw-recenter`'s top is a `min()` whose
  second arm is the last rung clearing that box. Verified 390×844 (287.7 vs 485.6) ·
  360×640 (222.4 vs 281.6) · **360×560 → floor engages at 160 vs 201.6** (was 86% occluded).
- **A1-3 · the desktop attribution truncated below ≈900 px.** The `clamp()` FLOOR (6.4 px) stops
  the shrink while the 265-char list keeps its width, so `nowrap` + `overflow:hidden` clipped BOTH
  ends and lost "© Esri". `@media (max-width: 60rem)` wraps the line and redefines
  `--mw-credit-h: 1.8rem`, so the scrubber lift tracks it with no second rule.
- **A1-15 · co-axial instruments split.** `.tr` (TimeReadout) is deliberately co-axial with the
  scrub rail but was not lifted → 13.6 px drift; `body.mw-open .tr` takes the same lift (separation
  back to the designed 10.4 px). Lesson: a lift means sweeping EVERY bottom-anchored surface.

## (D) AUTO-SHIP TITLE TRAP CLOSED (owner report 2026-08-22b)
The 2026-08-22 00:20 ship pushed its branch but created **no PR**: GitHub rejects an over-long PR
title and the Wix automation derives it from the commit SUBJECT, which was **1,221 chars**.
`.claude/hooks/session-end-ship.sh` now caps the subject at `SUBJECT_MAX=200` BYTES, rewinds to the
last word boundary (discarding any byte-split multibyte char), appends `…`, and writes the FULL
title into the commit BODY. **Keep `.claude/.ship-title` ≤ ~225 chars anyway** — the cap is a net.

## Gates at 22b
vitest **1,144/1,144** (102 files) · `astro check` 0 err / 5 hints ·
`verify-qaslice-cab.mjs` **61/61 ALL PASS** both shells (adds the jitter latch, PiP
top-alignment, the mid-stack bleed sweep, 3 /m viewport sizes, 3 desktop widths) ·
**all seven** regression suites PASS, Chrome restarted between suites.

## Known open (NOT this slice — audit Track C, recovered lead)
`verify-uxbatch5.mjs`'s FPV-entry check keys on `.m-joy`, which mounts at /m boot
unconditionally (`MobileShell.tsx:85`) — it can PASS FOR THE WRONG REASON. Re-key to
`__cameraStore.getState().fpvHud !== null`. Sweep every `.m-joy`-keyed assertion.
