# WIP 2026-08-19 — Owner UX batch #2 (11/11 SHIPPED)

Full record: DECISIONS.md 2026-08-19b. Gates 1,052/1,052 · astro 0 err/5 hints ·
browser-verified BOTH shells (shots verify-shots/uxb2-01..05).

## The 11 items → where they live
1. `OVERRIDES_CAP` 200→1000 (`lib/globe/bldgOverrides.ts:31`; == `SYNC_MAX` platform cap, never past).
2. /m collapsed mini-map puck: folded-map inline SVG + accent dot (`MiniMap.tsx` `.mm-glyph*`).
3. `MobileTimeDock` ◀ ▶ day steppers (`.md-day`, desktop `.ts-day` parity, 86_400_000 literal).
4. Walk controls over the fullscreen map: `MapWindow` toggles `body.mw-open` → `.m-joy`/`.m-altcol`
   z 24 (map 20 / sheets 30, `mobile/fpv.css`). The joystick input path was NEVER gated — pure
   paint/pointer occlusion.
5. Desktop Esc ladder rung: `mapWindowOpen` consume in `StylizedTiles.onFpvKey` AFTER the
   bldgArmed rung (MapWindow's own listener double-closes — idempotent).
6. Search default = SKY both shells; catalog stays lazy (desktop warms on input FOCUS, /m on
   sheet mount — never at page boot).
7/8. `sky.stopFollowing()` = visible:false + track:false, target KEPT (non-nullable contract);
   ✕ UNFOLLOW row both target surfaces; TargetPeek gates on `visible`, tp-root on
   `!visible && !open` (SHOW-off inside the open panel is never a one-way door); U4 aim TARGET
   line gates on `visible` in BOTH renderers. Peek hint = `.m-peek__more` accent nudge.
   Section order both shells: badges → live → pills+ghostrow+UNFOLLOW → facts (desktop) →
   NEXT SESSIONS.
9. Sky-menu labels: "X OFF" → "DISABLE X" (6 items). The "inverted" FIND label was a COMPOSITE
   STATE bug: `bodies.moon` defaults TRUE while `find.open` false (nothing renders) — `findOn`
   now = `find.open && bodies[findBody]` (`SkyContextMenu.tsx`).
10. `FindBody` "gc" → **"target"** = the LIVE tracked target. Engine was already
   sampler-injected; only the union + per-shell tuples were special. `targetIsBody` guard
   (tracked sun/moon → chip disabled + scan skip). Jump/ghost-click no-op setTarget for
   "target". `dso:gc` de-specialised in the menu — ANY tracked target gets FIND IN FRAME.
   Historic names KEPT: `FIND_VIS.gcSunHiDeg/gcMoonGlareK`, `FINDGHOSTS.gcMarkDeg`, findGhosts
   `isGc` (all comment-flagged).
11. `LayersChip` (/m SceneActions) absorbs the standalone BuildingsChip and expands
   {3D DETAIL (2D-disabled) · MY PLACES · PHOTO PINS · RADAR}. New prefs `aimVisible`
   (RADAR master over the whole U4 overlay: `enabled && aimVisible` in stepAimCones +
   `aimBodiesNow` early-return; desktop AIM chip) + `savedPlacesOnMap` (new `store/places.ts`).
   Desktop chips: AIM + PLC appended to the ct-row. `pinsVisible` /m default OFF via
   shell-aware default in store/camera (`location.pathname === "/m"`).

## New feature — MY PLACES ON MAP
`store/places.ts`: lazy single-flight `/api/places` fetch on map-window open; **401 = final
empty** (anonymous never hammers), transport failure clears `loaded` for a retry. Markers in
`MapWindow` = the temp-pin ring drawing at `tokens.pinLavender` + store subscribe for the
async-arrival repaint. 2D MapWindow ONLY this round — GL globe + mini-map markers are tails.

## Rulings / semantics decided this session
- **UNFOLLOW semantics** = hide + unlock, keep target (option (a); nullable target would touch
  ~8 consumers). Recovery paths: search / sky menu / FIND jumps all setVisible(true).
- **`visible=false` now means "dismissed everywhere"** — peek, pill, aim line all gate on it
  (planFeed/scrubber/cards already did).
- **Desktop pills placement**: BEFORE the per-kind fact cards (literal "right after first
  essential details"). Owner taste-pass may nudge.
- Generic-target FIND visibility = the gc darkness×moon-glare model for ANY target — bright
  planets read conservative (flagged tail, not a bug).

## Traps (new this session)
- **Piping `wix dev` through `head` SIGPIPE-kills it minutes later** (vite WS dies first,
  HTTP lingers) — run it unpiped via run_in_background.
- Playwright MCP screenshot paths are repo-root-relative and reject `../` — pass
  `verify-shots/...` directly.
- Playwright MCP may need one retry to attach after a fresh verify-chrome launch.

## Open tails
GL-globe/mini-map saved-place markers · just-saved place appears only after reload (no push
into placesMap) · bright-target FIND visibility refinement · day-stepper ▶ sits beside play's
▶ (taste) · owner taste pass on glyph/labels/UNFOLLOW wording · batch rides the standing
production canary (next `wix release`).
