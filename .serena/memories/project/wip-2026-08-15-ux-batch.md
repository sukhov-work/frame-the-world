# WIP 2026-08-15b — owner UX batch ×5 (SHIPPED both shells)

Gates: vitest 870/870 (+4) · astro check 0 err/5 hints. Browser: desktop CDP 1440×900 +
phone-viewport 402×874, shots `verify-shots/uxbatch-01..06`. DECISIONS twin: 2026-08-15b line.

## 1 · PLAN/FIND → one toggle + shared window
- `panels/PlanFindToggle.tsx` (NEW island, mounted in index.astro `.topnav-left` beside the
  wordmark) — segmented ☀ PLAN | ⌖ FIND IN FRAME (rename; `.pft-ext` " IN FRAME" hidden
  <1100px). Click-time exclusivity; FindPanel keeps its planOpen belt effect. Welcome-hidden
  (`body.welcome-active .pft`).
- Panels lost their pills; BOTH mount at left 1.6rem/top 3.4rem (fnd-root moved from 7.3rem)
  under ONE session key **"planfind"** for `usePanelDrag` AND the NEW `usePanelResize` →
  one window: spot + size persist across the mode switch (verified (86,94) 366×403 both faces).
- NEW resize primitive in `ui/DragGrip.tsx`: `usePanelResize(key)` + `ResizeGrip` (◢ corner,
  border-box px into `--win-w/--win-h`, dbl-click reset, min 200×130, max 92vw/vh). Host CSS
  contract: `box-sizing: border-box; width: var(--win-w, 17.25rem); height: var(--win-h, auto);
  max-height: var(--win-h, max(11.9rem, min(27.9rem, calc(100vh - 39.8rem))))` — user resize
  lifts the mini-map cap (var wins both slots). `.pp-x` close button in both heads.
- **TRAP (durable):** panels stay mounted when closed (`if (!open) return null` AFTER hooks —
  keeps FindPanel's ghost-mirror clearing + gating alive). So `useState(() => sessionMap.get(key))`
  initializers go STALE under a shared key when the sibling writes → both hooks adopt the Map
  during render (derived-state setState; same-key siblings never render simultaneously).

## 2 · Sky-ghost first-gap + count (TargetPanel GHOSTS)
- Root cause of "first ghost too far + wrong count": `GHOSTS.nowGapDiscs 1.2` = exclusion cone
  1.2×disc-DIAMETER around the live body (`skyGhosts.ts` minSepCos) ate k=±1…3 at 1–2 min
  steps (diurnal ≈0.25°/min vs 0.53° disc). Loop was ALWAYS symmetric N/side, exact instants.
- Fix: nowGapDiscs **0.25** (only near-concentric drops — pole-slow movers) · maxPerSide
  **8→15** (30 discs) synced across `tuning.ts` + `store/sky.ts:74` + `lib/prefs.ts:67` +
  TargetPanel/TargetSheet `>= 15` disables. FINDGHOSTS.nowGapDiscs (day-spaced rings) untouched.
- NEW `test/components/globe/skyGhosts.test.ts` — drives attachSkyGhosts().update() headlessly
  (THREE Scene + PerspectiveCamera, dtMs 60_000 ≫ fadeTau): 2N semantics, k=±1 at 1 min,
  30 ceiling, cone < 1-min solar drift (the bug's arithmetic pinned).

## 3 · Daytime nav
- global.css (NOT index.astro scoped — the nav islands render their own buttons): `.topnav`
  gradient scrim `color-mix(--color-bg 58%→26%→transparent)` + text halo on `.topnav a, button`.

## 4 · /m login + MY PLACES + SAVE VIEW
- `mobile/MobileAccount.tsx` (NEW): anonymous → SIGN IN via `loginUrl(returnHereUrl())` at
  CLICK time (hash rides; VERIFIED live — `#p=` survived the real dev OAuth hop, member chip
  `◎ frame-p5-tester` after); member → opens SEARCH sheet. `.m-chip--account` ellipsis 6rem.
- `mobile/MobilePlaces.tsx` (NEW): idle SEARCH sheet = places list (query non-empty swaps to
  results). Tap = time FIRST (`setTime(p.timeMs)` / `goLive`) then `requestFpvJump` — verified
  exact-ms restore + tempFpv + sheet close. Anonymous → sign-in row (a.m-hit, underline stripped).
- `SavePlaceChip` in `mobile/SceneActions.tsx`: renders when `fpvHud && camGeo`; one-tap POST
  /api/places, auto title `View · <local stamp>`, `⏱` suffix when pinned, same body as desktop
  SavePlaceControl (`timeMs: live ? null : sceneTimeMs()`); anonymous → ◎ SIGN IN TO SAVE.
  Delete/rename stay desktop-only. All fence-legal (stores only). MOBILE_PLAN clarified:
  places ≠ pins-browsing (owner order).

## 5 · Scrubber past/future
- NEW chrome token `--color-time-future: #7cb0f5` (danger/warn precedent → NOT in the GL
  bridge). Pinned split amber past / blue future: `.ts-cursor--future` + ts-offset tint
  (exclusive class pick in TSX keeps --ff danger precedence), `/m` `.md-cursor--future` +
  md-offset, `m-chip--future` on the strip time chip. Verified rgb(232,162,104)/rgb(124,176,245).

## 6 · Same-session follow-up (owner)
- Ghosts BEHIND the real body: `scene/sky.ts` sunMesh/moonMesh `renderOrder = 11` — above the
  depth-free overlay tier (ghosts/trail/dayArcs/findGhosts all 10). Safe: day arms are additive
  (commutes with the atmosphere dome); moon night-arm opaque disc replacing ghosts behind it is
  the desired look. Verified `uxbatch-07-moon-ghosts-behind.jpeg` (crescent crisp, k=±1 behind
  the limb). New overlays that must sit UNDER the bodies: renderOrder ≤ 10; OVER: > 11.
- FIND IN FRAME default bodies = moon-only (`{sun:false, moon:true, gc:false}`) in
  FindPanel.tsx + PlanSheet.tsx FindSection (chips re-enable per session; SUNSETS independent).

## Env notes
- Member store showing anonymous while /api/places 200s = Vite dep-cache 504 on
  `@wix_members.js` → `touch astro.config.mjs` (documented trap, hit live).
- Playwright MCP run_code accepts files only under repo/.playwright-mcp (creds file pattern:
  write there from .env.local via bash heredoc, delete after).

## Open tails (non-blocking)
- Owner taste: `--color-time-future` hue · `.pft` styling · window default 17.25rem/cap ·
  nav scrim strength · SAVE VIEW auto-title format.
- Pre-existing at ≤1440px: centre LocationFinder overlaps the Explore link (not this batch).
- /m places: no delete/rename (desktop MY PINS · PLACES owns those).
