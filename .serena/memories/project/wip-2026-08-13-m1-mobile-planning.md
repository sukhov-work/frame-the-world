# wip 2026-08-13 (session 3) — MOBILE M1: the planning loop on /m — SHIPPED

Mode: implement (investigate-design-v3, Standard/Deep). Gates at exit: **vitest 736/736 (+3)** ·
astro **0/0/6 hints (= baseline)**. Phone-viewport (402×874) **browser-VERIFIED end-to-end**;
REAL-DEVICE tier UNVERIFIED (pairs backlog T1). DECISIONS 2026-08-13 "night" line = twin.
Working tree UNCOMMITTED (session-end auto-ship hook / owner #pr).

## What shipped (all new files unless noted)
- `components/mobile/MobileShell.tsx` (grown) — status strip + TimeChip (pinned=warn amber,
  live=HH:MM LIVE) + bottom column [TargetPeek · MobileTimeDock · TabBar] + sheet switchboard
  (`useState<SheetId>`, no new store; SCENE tab closes sheets).
- `MobileTimeDock.tsx` + `styles/mobile/dock.css` — ±12 h rail twin of TimeScrubber: twilight
  memo `[anchorMs, lat*20, lon*20]` NEVER scene time, eye = planAnchor ?? focus, day segs
  filtered, moonlight color-mix 12/24/38/55%; major ticks only; date jump + PLAY (armed ×600
  default) + NOW; edge recenter + playback recenter carried verbatim.
- `Sheet.tsx` + `TabBar.tsx` + `styles/mobile/chrome.css` — bottom sheet (handle pull ≥90 px
  dismisses, scrim tap closes, 400 ms cubic-bezier(.65,0,.35,1), reduced-motion honored,
  backdrop-filter ONLY on the sheet surface — S2); tab bar owns safe-area-inset-bottom.
- `MobileSearch.tsx` — EARTH (photonSearch 320 ms debounce biased to focus · Enter→nominatim ·
  ODbL credit) | SKY (lazy `await import` catalog; instant searchSkyCatalog + searchSkyEnriched;
  **LONG-TAIL SIMBAD//api/sbdb NOT wired — deliberate M1 cut**). onFly closes sheet;
  onTrack swaps to TARGET sheet. Track = setTarget + setVisible(true) + auto-aim if alt>0.
- `PlanSheet.tsx` — **owns plan.setOpen(true/false) on mount/unmount** (planFeed computes
  focus-anchored chips ONLY while plan.open — the load-bearing seam). CHIP_LABEL duplicated
  from PlanPanel deliberately (two-shell cost, MOBILE_PLAN §1).
- `TargetSheet.tsx` — badges + ALT/AZ/MAG/ELONG grid + targetWindows(8d/15min/limit 5) keyed
  `[hourKey, lat*20, lon*20, target]` (mount = open gate) + SHOW/MARK/TRAIL. Fact blocks
  dropped (desktop depth). `TargetPeek.tsx` — per-minute az/alt row, verdict id-matched.
- `SceneActions.tsx` — 🧭 MY LOCATION (geolocation → setTempPin + requestFly(SEARCH.altDefaultM);
  client-only, C6) · ◎ LOOK FROM HERE (setTempFpv) · ✕ CLEAR PIN · ✕ EXIT VIEW (no Escape on
  phones). Fixed chip column bottom≈10.8rem (clears the ~158 px bottom column).
- ENGINE (`StylizedTiles.ts` + `tuning.ts`): long-press pin drop — `dropTempPinAt` extracted
  from onDblClick; `ORCH.longPressMs = 500`; slop = clickDragPx; cancels on lift/drag/second
  finger; **gated pointerType==="touch"** (stricter than MOBILE_PLAN §4.3 wording — keeps the
  frozen desktop behavior-identical; verified mouse-hold 800 ms drops NOTHING).
- `test/components/mobileFence.test.ts` — drift guard promoted to a fence: mobile ↛ panels|ui,
  desktop ↛ components/mobile (m.astro exempt), zero-result probe.

## TRAPS learned (also in DECISIONS)
- **Long-press fires BEFORE pointerup**: onPointerUp's empty-map-click branch clears tempPin —
  it would erase the just-dropped pin on finger lift. `longPressFired` flag suppresses that ONE
  release. (dblclick is immune: its drop happens after the last pointerup.)
- **Occluded/locked-display Chrome suspends rAF entirely** — flights never consume; rAF-based
  evaluate hangs; `/json/activate` + AppleScript CANNOT wake it. Verify-Chrome must launch with
  `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding
  --disable-background-timer-throttling`.
- Playwright click actionability stalls on elements near the astro-dev-toolbar overlay (dev
  only) → dispatch DOM clicks via evaluate.
- frog.wix.com beacon ERR_CONNECTION_REFUSED + members/my 403 (anonymous) = standing dev noise.

## Browser walk (shots verify-shots/mobile-m1-01..06)
01 SCENE (bands on rail, peek "10P BELOW") · 02 EARTH search · 04 GC TARGET sheet (windows
Aug 13 21:45–23:30 ★ no moon; auto-aim 164.8°) · 05 PLAN in FPV (ANCHOR·FPV · SKYLINE 100%
MAPPED · ☀☾GC CLEAR rows + HIDES chips + full grid) · 06 night FPV Aug 14 01:50 after DUSK
chip + rail scrub (`&t=` rides `#f=`). Desktop smoke: zero mobile chunks on `/`; dblclick pin
+ popup ✕ intact.

## Open / next
- M2 (FPV touch: joystick walk seam, pinch FOV, wake lock) or 8b desktop-first (P4 Find ·
  P5 NPF · P6 moon calendar) per NEXT_SESSION order.
- M1 tails: SKY long-tail on mobile · MAP tab (minimap reader) unscheduled in M1 · real-device
  pass (T1) · release canary `/m` (T2/T3).
Related: [[project/wip-2026-08-13-slice7-phase8a]] [[project/wip-2026-08-11-mobile-design]]
