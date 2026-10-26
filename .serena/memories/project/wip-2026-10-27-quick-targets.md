# wip 2026-10-27 — T202 THE /m QUICK TARGETS: ☀ ☾ cells lead the tracked row · ☀ SUN · ☾ MOON pinned + RECENT in the SKY search sheet

Mode: implement, small (`/frame` + the ecom-pilot core: quick tier; one Opus 5.5 agent built the search-sheet half, one Fable agent reviewed
the diff; the main session built the row, the harness, the gates). The owner's verbatim ask sits in backlog T202 + DECISIONS 2026-10-27.
Records: DECISIONS 2026-10-27 · backlog T202 BUILT · NSP · this leaf. Harness `scripts/verify-quick-targets-2026-10-27.mjs` (legs 1 the bar on
the iPhone 402 / Pixel 412 / 360 twins · 2 the iPhone FPV · 3 the search flow; `--devices`); shots `verify-shots/quick-targets-2026-10-27/`.
**Gates: vitest 3,965 / 261 (the `bestSpotSolver` timing test flaked under the house Chrome's load, green alone 75 / 75) · `astro check` 0 errors ·
the harness ALL PASS.**

## 1. THE ROW (`mobile/TargetPeek.tsx` + chrome.css)
- `<div class="m-peekbar">` (flex, carries the hairline) → `[☀][☾]` `<button class="m-peek__quick m-peek__quick--sun|moon" data-quick>` then the
  `<button class="m-peek">` (now `flex: 1 1 auto; min-width: 0; padding-left 0.4rem`, no border). The tracked body's own cell is dropped on
  `target.kind` (never `facts.kind` — the TargetSheet's eclipse rule). NEVER a button inside the row button (invalid markup; iOS hands the tap to the
  outer one; the long-press machinery and the `pressFired` click-swallow stay the row's own).
- The tap `quickTrackBody(kind)` (exported, unit-tested with `aimAtSkyBody` mocked): `setTarget(SUN_TARGET | MOON_TARGET)` (the row's module
  constants — one instance each, the almanac memo keys read the id) → `setVisible(true)` if off → `setTrack(true)` (the session-only FPV lock; the
  sky menu's ⊕ TRACKING idiom — "start tracking it") → `aimAtSkyBody(kind)` (the row's long-press goto: FPV look glide, below the horizon onto the
  rise azimuth; the map's planned cone turns) → a 12 ms haptic. **The lock is the one line to drop** if the owner wants the goto alone.
- THE TRADE: the accent kind glyph `.m-peek__glyph` is GONE (the rule too). On 402 px the pair (25 + 4 + 25 + the pads) costs ≈ what the glyph +
  its 10 px gap gave back; the almanac's own target cell still shows the kind. The name's budget with the comet: **48.4 / 58.4 / 45.2 px**
  (iPhone / Pixel / 360) vs 89 / 99 / 62 before — a 6-letter name keeps its letters; re-adding the glyph would leave ~27 px on the iPhone.
- The cells: 25 px round, `margin: -4px 0` (a 17 px margin box inside the row's 22.6 px content — the bar stays **38.59 px** on every twin, the
  2026-10-25 row = the owner's hard line), `::before` `inset: -7px -2px` (a 39 × 29 px touch target, no horizontal overlap at the 4 px gap), the
  body inks (`--color-sun-glow` / `--color-moonlight`), U+FE0E + `font-variant-emoji: text`. ≤ 375 px (its OWN media block — the 2026-10-25 block is
  pinned verbatim by the almanac test): 21 px cells, the bar / row pads 0.25rem, gap 2 px, `.m-peek .m-badge` pad 0.3rem, `.m-peek__pos` pad 4 px
  → the 360 twin's budget 26 → 45.2 px.

## 2. THE SHEET (`mobile/MobileSearch.tsx` + `lib/prefs.ts`; the Opus agent's half)
- Idle SKY (empty query, `mode === "sky"`): `<div class="m-quick" role="group">` with the `.m-places__head` heads `QUICK TARGETS` (☀ SUN · ☾ MOON —
  `QUICK_SKY` constants copied from the catalog's `bodyEntry` rows, never imported: `lazyContract.test.ts`; the test fails if the strings drift)
  then `RECENT` (≤ `RECENT_SKY_SHOW` 3 `data-recent` rows), ABOVE `<MobilePlaces>` — the MY PLACES idiom (typing swaps it for results). Every row
  is a `.m-hit` through the existing `track()` (the SOFT aim — a search pick is a data choice, owner 2026-08-18; the row's cells are the hard goto).
- Recents: `recentSky?: RecentSkyEntry[]` INSIDE `ftw:view-prefs:v1` (no seventh `ftw:*` key); `recentSkyAfter(list, entry)` pure (front insertion,
  dedupe by id, cap `RECENT_SKY_KEEP` 5, `body:sun` / `body:moon` never added); `sanitizeRecentSky` (id ≤ 80 with ":", name ≤ 80, detail ≤ 120,
  kind ∈ TargetKind, the pinned ids + duplicates dropped, an empty list omitted). Recorded in `track()` ONLY after `targetByIdAsync` resolves (taps +
  the Enter path alike); `useState(() => loadViewPrefs().recentSky ?? [])` — the sheet mounts client-side only (`sheet === "search"`). Desktop
  ignores the field; the row's cells and the sky menu never record.

## 3. MEASURED (the harness, dev)
- Leg 1 (all three twins): the bar 38.59 px with two cells and with one; a ☀ tap → `body:sun`, visible, track; the planned cone 0 → 178.8° = the
  sun's azimuth (alt 53.6° at the noon pose); a tap 5 px ABOVE ☾ (the extension) → `body:moon` (below the horizon → the cone to its rise azimuth
  135.7°); a plain row tap still opens TARGET; no DOM-nesting warning.
- Leg 2 (iPhone FPV): heading 25.0 → 178.8 vs az 178.8; pitch 8.2 → 53.4 vs alt 53.6; the one-shot glide and the per-frame lock agree (0.61° /
  0.18° drift over 1.5 s) — `stepSkyTrack` feeds the same bearing the glide targets.
- Leg 3 (the search flow): Saturn · Mars · Jupiter · Vega → the blob keeps four newest-first, RECENT shows Vega · Jupiter · Mars (Saturn held, not
  shown); the ☾ MOON pinned row tracks the moon and never enters RECENT; a re-pick of Mars moves to the front, no duplicate.

## 4. THE FABLE REVIEW (folded in; verdict was FIX-FIRST)
- **The shadowed one-shot:** under the FPV lock `stepFpvPose` takes `skyTrackAim ?? skyLook` and clears the one-shot only when no lock holds —
  the goto's `requestSkyLook` would sit there and fire as a PHANTOM glide toward the tap-time bearing when the lock released (the body setting
  past `FPV.skyTrackReleaseAltDeg` −1°, or TRACK off). `quickTrackBody` clears it (`cam._clearSkyLook()`) when `aimAtSkyBody` answered "look"
  and the body is above the release altitude at `camGeo ?? focus`; below it the lock releases next frame and the one-shot (the rise-azimuth
  glide) is right. The desktop GOTO-then-TRACK has the same latent bug (unfixed, not the ask).
- The width: the pair costs ≈ 35 px net on 402 px (not "the glyph's width"); ~9 px bought back (the bar's left pad 0.3rem, the row's 0.3rem,
  `.m-peek .m-badge` 0.4rem; narrow: the row gap 6 / the almanac gap 3 in the NEW block — the 2026-10-25 block stays verbatim for its test).
  FINAL budgets with the comet + BELOW: **56.4 / 66.4 / 51.2 px**; JUPITER + BELOW (the widest common case) unclipped on all three
  (50.7 / 60.7 / 45.5 px of budget for a 50.3 px name — tight on the iPhone, 0.4 px of slack).
- `role="option"` outside the results listbox dropped (plain buttons; the group label "Quick targets and recent sky searches").
- A long recent `name` / `detail` is cut to 80 / 120, never dropped; the narrow touch inset −1 px.

## Traps learned
- **The idle restore race:** `store/sky` restores the persisted `skyTargetId` on requestIdleCallback (≤ 8 s after boot) and its guard only skips a
  NON-comet current target — so a harness-set comet is re-seated by the house profile's last tracked body. Seed `skyTargetId: "comet:10P"` in the
  blob and reload (`SEED_COMET`) before the leg; clear `recentSky` the same way (the profile persists both).
- A rect read while the SEARCH sheet still slides sends the tap to the wrong place — settle 600 ms after it opens, 300 ms after the hits land.
- The almanac test's `label()` read the FIRST aria-label in the HTML — the cells render before the row with labels of their own; it reads
  `class="m-peek" aria-label=` now. Any new element before the row needs the same care in `scripts/verify-uxbatch-2026-09-16.mjs` (it reads
  `.m-peek__name` rects — unaffected).
- `Input.insertText` after `.focus()` drives React's onChange on the sheet's input (the house typing idiom).

Related: `mem:project/wip-2026-10-25-mobile-interlude-radar-almanac` (the almanac the cells sit beside) · the 2026-09-16 session (the long-press
goto the tap reuses) · `mem:project/wip-2026-08-19-owner-uxbatch2` (the sky menu's ⊕ TRACKING).
