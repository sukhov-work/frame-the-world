# wip 2026-09-08 — THE PIXEL READS of lever 11 + T115 (both hold) · the APP VERSION stamp · T119 the DEBUG window's grips · T118 FIXED (the readiness hold + the one status chip) — DONE

Mode: implement, Deep (`/frame` under investigate-design-v3). Owner order 2026-09-08: proceed with
`NEXT_SESSION_PROMPT.md` (the Pixel reads), plus (1) an app version (major 1) set + auto-incremented,
shown bottom-right on both shells; (2) the desktop DBG window loses its drag handle, resize handle at
the top → bottom-right; (3) T118 = ruling (a): hold the first solve until the scene is sufficiently
loaded, BOTH shells, + the simplest loading indicators.
Records: DECISIONS 2026-09-08 · MEASUREMENTS §27 · backlog T77 / T115 / T118 / T119 · this leaf.

## Boot
- PR #114 landed clean (master `fb3fa83`), checkout on master. VPN on (ion 401). Pixel 6 Pro on adb
  (thermal 1, unlocked; `stay_on_while_plugged_in 7` — set back to 0 at the end). House Chrome :9333.
  `wix dev` restarted PLAIN with `.vite` aside. NOTE: `wix dev` listens on `[::1]:4321` — curl
  `localhost`, not `127.0.0.1` (the phone reaches it through `adb reverse` fine).

## 1 · The Pixel reads (MEASUREMENTS §27.1–27.3) — both hold
- Lever 11: `probe-cpu-profile --leg descent --device` — NO vector-tile parse symbol in any table;
  app in the hitches 691 → 649, vector tiles 199 → 0. `probe-vtile-worker --device` (flag ADDED,
  the phone-tab idiom): 12/12 worker, 0 inline, seat max 0.7 ms, worker max 41.4 ms.
- T115: `probe-load-phase2 --device` — treeLocate 89 calls · 177 chunks · 34,578 instances · 21 ms ·
  worst 0.6 ms (was 7.5 atomic), pending 5 at the leg's end; enriched worst drain 11.4 (GC band),
  OSM 2.7; identity 0/0. T115 CLOSED.
- What the phone leg shows next (the lane): `applyFeatureSeats` 427 ms of the 8 s leg (biggest app
  item), the controls raycast 1.17 s (`rawHeightAt` 315 + `stepTiltGlide` 138 in the hitches → the
  terrain BVH, lever 8), ephemeris in the hitch frames 86 ms (new, small).

## 2 · The app version (owner ask 1)
- `package.json` 1.36.1 (+ lock). ONE writer `src/lib/version.ts` — a NAMED JSON import (tree-shaken:
  the built chunk carries `"1.36.1"` only), `versionLabel(dev = import.meta.env.DEV)` → `v1.36.1` /
  `v1.36.1-dev` (constant-folded in the build).
- Desktop: INSIDE the attribution anchor after "Natural Earth" — `<span class="map-version">`
  (index.astro; rides the credit line through both states; `verify-qaslice-cab`'s `.map-credit`
  geometry checks untouched). `/m`: `controls/VersionStamp.tsx` (the shared tier — mobileFence
  rule 1 forbids `ui/` from `mobile/**`) in `.m-bottom` after the TabBar; `styles/version-stamp.css`
  + `chrome.css` `.m-bottom .version-stamp` absolute, right 3px+safe-area, bottom 1px (Pixel: 7.2 px
  tall, no overlap with the SPOT label).
- Auto-bump: `session-end-ship.sh` `npm version patch --no-git-tag-version` AFTER the gates and the
  DRY_RUN exit, BEFORE `git add -A` → the next landing is 1.36.2. `test/lib/version.test.ts` pins
  the format, lock = manifest, both renderers, the hook's bump position.

## 3 · T119 — the DEBUG window's grips (owner ask 2)
- Cause (the mapping agent, confirmed in the dist manifest): both grips carry `.tip`; tips.css
  `.tip { position: relative }` has the SAME specificity as `.drag-grip { position: absolute }` →
  order decides; dev injects drag-grip.css LAST (clean), a BUILD emits tips.css last on every route →
  both grips in-flow in the column-flex window: ◢ at the top-left, ⠿ a panel-height above the
  viewport. App-wide (every DragGrip host).
- Fix: `.drag-grip.tip, .resize-grip.tip { position: absolute }` (0,2,0 beats 0,1,0, order-free;
  the rebuilt dist carries it). Plus the clamps: `GRIP_CLEAR_PX` 22, `clampDragOffset` keeps the tab
  reachable (the old floor 4 px hid it), `clampResize` stops a centre-anchored growth at the clear
  line (at the line the corner grows width only — drag down first). `dragGrip.test.ts` (5); CDP drag
  probe: stops at top 22, ◢ at the bottom-right, 1:1; `verify-debughud` 17/17.

## 4 · T118 FIXED — the readiness hold + the one chip (owner ask 3, ruling (a), both shells)
- `StylizedTiles.sceneStreamPending()`: per attached tileset `(root === null) + isLoading +
  queued + downloading + parsing`, plus `buildings.loadPending() + enriched.loadPending()` (NEW
  integer reads on both handles). Passed to the feed as a THUNK (`ctx.streamPending?: () => number`)
  — evaluated ONLY while a solve is due. TRAP: the first cut read it every frame through the two
  `debugLoad()` ledger copies and cost the twin ~3.5 ms/frame at 4× throttle.
- `bestSpotFeed.ts`: in the T0/T05/T1/rebuild branch — held while pending > 0 and
  `now − holdSinceMs < BESTSPOT.holdMaxMs` (20 s); keys NOT advanced while held (the branch
  re-enters), `pendingRebuild` carries a rebuild that fired into a hold, disarm clears; store
  `held` (engine band); `bestSpot().hold` DEV seam; DBG `planning.bs.held / heldFrames / streamPending`.
  The "FIRST solve is not debounced" test still holds verbatim (no thunk = never held).
- The chip: `controls/bestSpotCopy.bestSpotProgress` — hold `LOADING THE SCENE…` · computing
  `COMPUTING…` (solving / tilesPending / refining) · `✓ DONE` only when nothing runs AND
  `ladderRung >= 0` (the twin read a false DONE for one poll before the hold was mirrored) · null
  while off. `BestSpotPanel` `.bsp-progress` (the R8 spinner rule spins the ◌) + `BestSpotSheet`
  `.m-bsp-progress` (chrome.css keyframes). `bestSpotProgress.test.ts` (4) + `bestSpotFeed.test`
  T118 block (6).
- Measured (§27.4): twin HEAD = refusal at 0.6 s, finest 14.2 s, 2 jobs → tree: held 8–12 s, first
  ink REAL (1 + 4), finest 9.2–13.9 s, 1 job. Pixel (`verify-bestspot-mobile --device`, flag
  ADDED): held 3.0 s, first ink 3.9 s real, finest 8.1 s, 67/67. The harness gained the T118 checks.
  Its 5 s frame proxy sat at its floor for HEAD too (128/120/119 vs the tree 117–119, floor 120) —
  not a regression.

## Gates
vitest 2,967/192 · astro 0/0/12 · `verify-bestspot` 3 reds = D8 (by design) · `verify-debughud`
17/17 · post sweep `post-2026-09-08` vs golden `post2-2026-09-07j`: draw-count 13/13 (calls AND
tris identical; legacy-orbit −1 call/−401 tris = streaming), pixel diffs the noise band (legacy-m
57.6 % the 2D map family; legacy-everest 12.3 % = one imagery tile's LOD at capture; the credit
line's bottom row differs everywhere = the stamp), sheets read.

## Owner calls, still open — ONE batch
The two lean load budgets · `compileAsync` · the terrain BVH (lever 8 — the Pixel leg's biggest
bucket) · `DAYARC.skylineBehindAlpha` · the flip bank · T113 · `ENRICHED.treeLocateBudgetMs` 0.5 ·
`BESTSPOT.holdMaxMs` 20 s (new) · T117 stays an ear.

Related: [[project/wip-2026-09-07-lever11-vtile-worker]] [[project/wip-2026-09-07-mobile-bestspot-ar]]
