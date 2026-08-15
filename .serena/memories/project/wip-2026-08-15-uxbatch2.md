# WIP 2026-08-15c — owner UX batch ×9 (pre-guide; SHIPPED both shells)

Gates: vitest 875/875 (+5) · astro check 0 err/5 hints. Browser: desktop CDP 1440×900 + /m
402×874, shots `verify-shots/uxbatch2-01..05`. DECISIONS twin: 2026-08-15c-uxbatch2 line.

## 1 · FIND scan config lifted into store/find (item 1 prereq)
- `store/find.ts` NEW: `bodies: Record<FindBody, boolean>` + `setBody(body, on)` ·
  `rangeDays` + `setRangeDays`. Defaults **moon-only, 30 days (1M — owner re-rule; was 182)**.
- FindPanel + the /m FIND surface consume the store (chips survive sheet remounts now);
  `test/store/find.test.ts` (NEW, 5) pins defaults + setBody isolation + `_syncGhosts`.

## 2 · SkyContextMenu grown (items 1, 5, 6)
- NEW entries (ghosts idiom — `ensureTracked()` first, label flips with state):
  **⊕ TRACKING** (camera lock) · **◌ MARK** · **∿ TRAIL** · **⌖ FIND IN FRAME** (per-body:
  sun/moon always, target only when `dso:gc`; ON also `find.setOpen(true)` and — DESKTOP
  ONLY via `!document.body.classList.contains("m")` — closes PLAN first for the
  shared-window exclusivity; on /m an open PLAN sheet keeps its planFeed).
- **Rise/set jumps now AIM the camera** (owner: "confusing — empty sky"): `aimBodyAt(ms)`
  recomputes `targetAzAlt(bodyTarget(kind), ms, obs)` at the NEW instant (the menu's az/alt
  snapshot is stale post-jump) → `aimAtSky(az, max(alt, 0))`. VERIFIED: SET click → 20:50,
  heading 245→265 = moon set az, inFrame true at alt −0.9° (refracted label instant, airless
  geometry — the §3.5 convention, expected negative). The FIND "camera never moves" rule
  stays scoped to ghost/row clicks.
- Moon header carries **illuminated %** (`bodyStatesAt(sceneTimeMs()).moonIllumination`,
  memo per open): `245° · +16° · 11%`.

## 3 · TRACKING camera lock (item 5) — net-new
- `store/sky.ts`: `track` + `setTrack` — session-only, deliberately NOT persisted (a reload
  must never grab the camera).
- `StylizedTiles.ts` NEW step **stepSkyTrack** between FpvTransitions and FpvPose (8.5):
  while `sky.track && fpvActive && !flight.active()`, computes `targetAzAlt(target,
  sceneTimeMs(), ecefToGeodetic(camera.position))` per frame into closure-local
  `skyTrackAim` (NEVER the store — no 60fps store writes). stepFpvPose's sky-look glide
  consumes `skyTrackAim ?? camNow.skyLook` — same solve, `FPV.skyTrackEaseTauMs 450`
  (vs one-shot 320), arrival does NOT clear when tracking.
- Releases: target below `FPV.skyTrackReleaseAltDeg −1` (stepSkyTrack calls setTrack(false))
  · a REAL look-drag past `ORCH.clickDragPx` in onFpvPointerMove (taps + wheel/pinch FOV
  zoom deliberately do NOT release — zoom-while-tracking works) · the toggle. FPV exit just
  suspends (flag survives, resumes on re-entry).
- UI: 5th toggle **TRACK** in TargetPanel `.tp-toggles` + TargetSheet `.m-toggles` (both
  rows now `flex-wrap: wrap`), NOT gated on `visible` (follows ephemeris, not render).
- VERIFIED: engage via menu → scrub +40 min → heading 238.0/pitch 20.8 vs moon az 238.1/
  alt 20.9 (glued); look-drag releases; jump past moonset self-releases.

## 4 · /m FIND = 4th tab + STICKY standings (items 2+7 — the Pixel bug fix)
- Pixel root cause: FindSection lived INSIDE PlanSheet; sheet unmount = `setOpen(false)` +
  `_syncGhosts(null, [])` → standings cleared the moment config collapsed. BY DESIGN wrong
  for a planning surface.
- NEW `mobile/FindSheet.tsx`: mounted UNCONDITIONALLY by MobileShell (`open` prop = tab
  active; `if (!open) return null` AFTER hooks — the PLAN/FIND desktop precedent), owns the
  two-stage scan + the single `_syncGhosts` writer on /m. **find.open STICKY on /m**: first
  tab visit (or the menu quick-toggle) sets it; collapsing the sheet leaves projections in
  the frame; teardown-only cleanup. Gate `(findOpen || open) && poseKey` (the || open kills
  the first-frame flash).
- `TabBar`: `MobileTab` + TABS gain `{id:"find", glyph:"⌖", label:"FIND"}` (SCENE · PLAN ·
  FIND · SEARCH). `MobileShell`: SheetId + activeTab wiring. PlanSheet: FindSection + its
  helpers DELETED (kept FIND_RANGES for SunsetSection), header rewritten.
- VERIFIED: 4 tabs; FIND sheet moon-only/1M/3 standings; scrim-close → sheet gone,
  find.open true, ghosts 3 alive, in-sky label `16.08 · 18%` rendering (shot uxbatch2-04).
- TRAP: the sheet covers the tab bar — Playwright must close via scrim tap, not tab click.

## 5 · Mobile-default entry (item 3)
- `index.astro` FIRST body script: client-side `location.replace("/m" + hash)` when ALL of
  mobile UA (`/Android.+Mobile|iPhone|iPod/`) · `pointer: coarse` + `hover: none` ·
  `maxTouchPoints > 1`. NEVER a server UA redirect (M0 `Vary` ruling STANDS — this is the
  sanctioned client seam). Any query string skips (checkout toasts); `/?d=1` persists
  `localStorage ftw:prefer-desktop`; the /m DESKTOP chip → `/?d=1` (else bounce loop).
- Welcome: NEW `MOBILE VERSION` ghost **anchor** beside EXPLORE THE GLOBE (belt for missed
  detection; `.wl-btn` now anchor-safe: inline-block + no underline + border-box).
- Topnav: Mobile link MOVED before Upload.
- VERIFIED via CDP device emulation (Pixel UA + touch + mobile metrics): `/` → `/m`;
  `/?d=1` stays + persists; bare `/` after pref stays. Desktop predicate false.

## 6 · /m SAVED PLACES + quota dropped (item 4)
- SceneActions: NEW member-gated `▤ SAVED PLACES` chip directly ABOVE 🧭 MY LOCATION
  (renders in FPV too), `onOpenPlaces` prop from MobileShell → opens the SEARCH sheet
  (idle = MY PLACES list). Anonymous: correctly absent (verified); member path rides the
  same phase idiom as the live-verified MobileAccount — UNVERIFIED live this pass.
- `placeRecords.ts`: `PLACE_QUOTA 50` → **`PLACE_PAGE 1000`** (Wix Data query max);
  `/api/places` POST 402 QUOTA_EXCEEDED gate DELETED, GET `.limit(1000)`, `quota` field
  dropped from both responses (no client read it — verified by grep). Test re-pinned.

## 7 · /m layout (items 8+9)
- `.m-altcol` bottom 14.4 → **16.4rem** (SAVE VIEW joined the stack: two ~31px chips from
  10.8rem top out ≈15.2rem; ⤓ was stealing SAVE VIEW taps). VERIFIED rects: altcol bottom
  612 vs actions top 626 — clear.
- MiniMap NEW collapse: `mm-collapse` button (CSS-hidden on desktop; `body.m` reveals) →
  `.mm--collapsed` = 46px puck, canvas/N/scale/grip display:none, right edge EXACTLY the
  altitude column's (390 = 390 verified); open by default; session-only state. Files:
  `panels/MiniMap.tsx` + `mini-map.css` (fence-legal: it's a panels component).

## Verify-env traps (new)
- CDP Chrome window hidden/minimized → `visibilityState: hidden`, rAF ~0 — window-bounds
  changes did NOT fix it; **`Page.setWebLifecycleState {state:'active'}`** (+ focus
  emulation) un-throttled to 30fps. Re-send it per newCDPSession.
- Positive mobile-redirect testing: `Emulation.setUserAgentOverride` + 
  `setDeviceMetricsOverride {mobile:true}` + `setTouchEmulationEnabled {maxTouchPoints:5}`
  makes `pointer:coarse`/`hover:none`/UA all real in an attached tab.

## Open tails (non-blocking)
- Real-device Pixel pass (T1) — emulated only here; owner should confirm standings + tab.
- SAVED PLACES member path live-verify (login round trip) rides the next /m login session.
- Owner taste: TRACK toggle label · TRACKING ease 450ms · menu length (9 items) · MOBILE
  VERSION button copy · minimap puck glyph (▣/»).
