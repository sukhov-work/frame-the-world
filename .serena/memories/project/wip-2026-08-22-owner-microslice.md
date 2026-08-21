# WIP 2026-08-22 — OWNER MICRO-SLICE (3/3 SHIPPED)

Owner addendum after device-testing the 2026-08-21h QA slice. Spec was
`NEXT_SESSION_PROMPT.md` §0. All three items land together (1+2 are one behaviour + its
escape hatch).

## What shipped

### 1. The manual-pan override is PERMANENT (supersedes the 08-21g eye-motion re-arm)
Owner: *"I do not want to auto-latch back after any manual panning starts, at all."*

`src/components/panels/MapWindow.tsx`:
- DELETED: `FOLLOW_REARM_M` const, the `manualAnchor` ref, its capture in `latchManualPan()`,
  and the whole eye-motion re-arm block at the top of `draw()`.
- KEPT: `manualPan` armed by `panBy()` (drag + pinch midpoint) and by the 2-pointer branch of
  `onPointerDown` (zoom/twist-only pinches). Wheel/chip zoom still never latches. The
  `&& !manualPan` guard on the FPV-follow block stands.
- Radar / focal cone / eye dot needed **NO change** — `draw()` already places them at
  `toPx(anchor)` → `xformNow().fwd`, so they scroll off-screen with the world while the
  chart is overridden. VERIFIED, not edited (as the spec ordered).

### 2. NEW round ◉ RE-CENTRE button — the main path back
- `.mw-btn.mw-recenter`, glyph **◉ U+25C9**, `aria-label="Centre the map on me"`.
- NOT the *only* path (audit A1-13 corrected the 22a prose): `manualPan` + `setPanned` both
  live in the `[open]` effect, so closing and reopening the window clears the latch too — on
  /m the PiP tap IS close, so an accidental pinch-latch is one tap from clearing.
- Seat: `right: .75rem; top: 3.1rem` (the rung item 3 freed). **/m deviates from the spec's
  literal seat**: the PiP owns that rung, so the button hangs off the PiP's BOTTOM edge —
  and since 22b BOTH derive from `--mw-top-y` + `--mw-pip-h`, so the whole
  `[+ −] · [PiP] · [◉]` rail moves as one. The /m seat carries a `min()` FLOOR so it can
  never slide under `.m-altcol` — see the 22b section.
- Action = `aimAnchorNow(useCameraStore.getState())` — the SAME anchor the radar uses →
  write `view.current.lat/lonDeg` → clear the latch → `requestRedraw()`.
- Wiring = the existing bridge idiom `zoomButtons.current = zoomBy` → `recenterRef.current`.
- React mirror `panned` written on **transitions only** (`if (manualPan) return` at the top of
  `latchManualPan`); `setPanned(false)` on effect (re)open because the island stays mounted
  while closed. Muted while following, `.is-panned` accent-lit while overridden.

### 3. Attribution → ONE thin full-bleed line on the SCREEN's bottom edge
- NEW `--mw-credit-h: 0.85rem` (defined `:root` in `map-window.css`; consumers use
  `var(--mw-credit-h, 0.85rem)` so a late-loading sheet degrades gracefully).
- The two bottom-anchored time surfaces are **LIFTED, never z-bumped**:
  `body.mw-open .ts { bottom: calc(2.2rem + var(--mw-credit-h)) }` ·
  `body.m.mw-open .m-bottom { bottom: calc(var(--mw-credit-h) + env(safe-area-inset-bottom)) }`.
  `body.m.mw-open .md`'s `padding-bottom` **drops its safe-area term** — the credit bar owns
  the inset now (double-counting = a dead band above the line on every notched iPhone).
- `box-sizing: content-box` on the bar so the inset ADDS to the line height (this repo sets
  box-sizing per component; border-box would have crushed the text on iOS).
- `.mw-creditbar` is a **SIBLING of `.mw`**, not a child — `.mw` carries the centring/drag
  transform, which is the containing block for any `position:fixed` descendant.
- `pointer-events:none` on the bar, `auto` on the anchor only. `white-space: nowrap` +
  `font-size: clamp(...)` so the contractual list scales instead of truncating.

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
- `scripts/verify-qaslice-cab.mjs` — **39/39 ALL PASS**, now with a **DESKTOP leg** (it was
  /m-only). Numbers: chart held **0.0 m** through a walk; eye **302 m** from the chart centre
  vs a **184 m** half-diagonal (off-bounds proof); ◉ centres to **0.0 m**; following resumes
  and re-tracks to the **18.5 m** deadband edge; desktop bar `bottomGap 0`, one unclipped line.
- All **seven** regression suites PASS (uxbatch4 / s2 / s3 / 5 / 6 / 7 / qa7ab), Chrome
  restarted between suites.
- Shots: `qsl-01..05`, `qsl-04b`, `qsl-04c`, `qsl-06`, `qsl-07`.

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
◉ seat under the /m PiP (thumb reach) · the 0.85 rem attribution line's real-device
legibility · the permanent-override feel (is the ◉ discoverable enough?).

---

# 2026-08-22b — owner follow-up + FOUR audit-#3 defects fixed BEFORE ship

## (A) Owner: the /m PiP moves up to TOP-ALIGN with the MAP/+/− pills
Done with TOKENS, not matching literals: NEW `--mw-top-y 0.6rem` + `--mw-pip-h 32dvh` in
`map-window.css`; `.mw-top`, `body.m .mw-pip` and `body.m .mw-recenter` all derive from them,
so the whole `[+ −] · [PiP] · [◉]` right rail moves as one. Measured: PiP top **9.59 px** ==
row top == pill top; pills end 140 px, PiP starts 253 px; `.mw-top` stays
`pointer-events:none` so its full-width invisible box passes taps through to the PiP.

## (B) THE REGRESSION THAT MOVE EXPOSED — and the general fix
The PiP is a HOLE. Anything `position:fixed` with `1 ≤ z < 20` that overlaps its rect paints
INSIDE it (batch-#5 "minimap inside minimap"). The new rung put the hole over `.m-status`
(Plux · account · GUIDE · DESKTOP, z 10) → the chips showed through.
- `.m-status` joined the `body.m.mw-open { visibility: hidden }` group.
- The **z-2 DOM label layers** joined too — `.sky-names` (scene/skyNames + scene/findGhosts),
  `.geo-labels`, `.bldg-edit-label`. That bleed is **PRE-EXISTING** (the hole overlapped the
  upper screen at 3.4rem too) and was SURFACED, not caused, by the new sweep. They are
  positioned for the FULL-SCREEN view while the hole shows a scaled miniature ⇒ they can only
  ever paint in the wrong place there.
- **The durable fix is the CHECK**: `verify-qaslice-cab.mjs` now enumerates every fixed
  `1 ≤ z < 20` surface intersecting the PiP rect instead of naming today's offenders, and a
  fence test discovery-guards every `.className = "..."` in the four scene label modules.

## (C) AUDIT #3 wave 1 (Track A1) found 3 MAJORs in 22a — fixed, not deferred
- **A1-1 · jitter latch.** `panBy()` latched on EVERY pointer move, so a 500 ms long-press
  (the primary /m chart gesture — it places a point) drifting ~2 px armed the now-PERMANENT
  override. Latch moved into `onPointerMove` behind the SAME `DRAG_CANCEL_PX 6` threshold that
  decides drag-from-press. Sub-threshold still pans (follow tidies it), never latches.
  Verified: a 3 px jitter leaves the button unlit.
- **A1-2 · the escape hatch was occludable.** `.m-altcol` is lifted to z 24 by `body.mw-open`,
  ABOVE the z-20 `.mw`, so on short viewports the ◉ slid under it and the tap would NUDGE THE
  EYE'S ALTITUDE. **Raising the button's z cannot fix this — `.mw` is itself a z-20 stacking
  context, so a child's z-index is scoped inside it.** Fix = geometry: `.m-altcol` publishes
  `--m-altcol-bottom` + `--m-altcol-h`, and `body.m .mw-recenter`'s top is a `min()` whose
  second arm is the last rung clearing that box. Verified 390×844 (287.7 vs 485.6) ·
  360×640 (222.4 vs 281.6) · **360×560 → floor engages at 160 vs 201.6** (was 86% occluded).
- **A1-3 · the desktop attribution truncated below ≈900 px.** The `clamp()` FLOOR (6.4 px)
  stops the shrink while the 265-char list keeps its width; `nowrap` + `overflow:hidden`
  clipped BOTH ends, losing "© Esri" itself — against the rule 22a had just written and T17.
  `@media (max-width: 60rem)` wraps the line and redefines `--mw-credit-h: 1.8rem`, so the
  scrubber lift tracks it with no second rule. Verified unclipped at 1100 / 820 / 700 px.
- **A1-15 · co-axial instruments split.** `.tr` (TimeReadout) is deliberately co-axial with
  the scrub rail but was not lifted → 13.6 px drift. `body.mw-open .tr` takes the same lift;
  separation measured **10.4 px** (the designed 0.65 rem). Lesson: when a lift is introduced,
  sweep EVERY bottom-anchored surface, not just the one in the spec.

## (D) AUTO-SHIP TITLE TRAP CLOSED (owner report 2026-08-22b)
The 2026-08-22 00:20 ship pushed its branch fine but **no PR was created**: GitHub rejects an
over-long PR title and the Wix automation derives it from the commit SUBJECT, which was
**1,221 chars**. `.claude/hooks/session-end-ship.sh` now caps the subject at
`SUBJECT_MAX=200` BYTES, rewinds to the last word boundary (which also discards any
byte-split multibyte char), appends `…`, logs the cap, and writes the FULL title into the
commit BODY. Exercised on the 1,184-char title → 198 chars / 202 bytes, valid UTF-8, 225 with
the ` #pr #skipreview #automerge` tags. **Keep `.claude/.ship-title` ≤ ~225 chars anyway** —
the cap is a net, not a licence.

## Gates at 22b
vitest **1,144/1,144** (102 files) · `astro check` 0 err / 5 hints ·
`verify-qaslice-cab.mjs` **61/61 ALL PASS** both shells (adds the jitter latch, PiP
top-alignment, the mid-stack bleed sweep, 3 /m viewport sizes, 3 desktop widths) ·
**all seven** regression suites PASS, Chrome restarted between suites.

## Known open (NOT this slice — audit Track C, recovered lead)
`verify-uxbatch5.mjs`'s FPV-entry check keys on `.m-joy`, which mounts at /m boot
unconditionally (`MobileShell.tsx:85`) — it can PASS FOR THE WRONG REASON. Re-key to
`__cameraStore.getState().fpvHud !== null`. Sweep every `.m-joy`-keyed assertion.
