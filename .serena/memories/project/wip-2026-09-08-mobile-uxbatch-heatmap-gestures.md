# wip 2026-09-08b — THE MOBILE UX BATCH: AR chip · save cell · live tabs + long press · BEST SPOT hygiene + the rate encoder · THE TWO-FINGER TWIST — DONE (the Pixel reads owed)

Mode: implement, Deep (`/frame` under investigate-design-v3). Owner order 2026-09-08b (five asks + "proceed with
the plan"). Records: DECISIONS 2026-09-08b · backlog T120–T122 · `conventions/globe-tuning.md` (the twist family +
the BESTSPOT hygiene row) · `MOBILE_PLAN.md` banner · `NEXT_SESSION_PROMPT.md` · `mem:core`.
Gates: vitest 3,003/196 (+36, +4 files) · astro 0/0/12 · knip 0 · `verify-mobile-batch-2026-09-08.mjs` 109/109 ·
`verify-ar-look` 39/39 · `verify-bestspot-mobile` 67/67 · `verify-qaslice-cab` ALL PASS · `verify-uxbatch4/7` ALL PASS ·
sweep `post-2026-09-08b` vs `post-2026-09-08`: draw-count 14/14. Freshest golden `post-2026-09-08b`.

## 1 · 🧭 AR (ask 1) — `mobile/FpvControls.tsx` + `styles/mobile/fpv.css`
- `ArLookToggle` is the FIRST cell of `.m-altcol` (AR · ⤒ · ⤓, 44 px round, one x); `--m-altcol-h` 96 → 148
  (the A1-2 map-window contract). `.m-arfloat` (absolute, `bottom: calc(100% + 6px)`, right-aligned) carries the
  note + ALIGN chip ABOVE the column so its box never grows; hidden under `body.mw-open` (RE-CENTRE seats there).
- THE BUBBLE: `const line = note ?? ""` — the rung line is never derived in render. `arNoteKey(on, state)` =
  `rung|stale` (never heading — the mirror's signature moves every ~1°). `arAnnouncement` (pure): off → clear;
  stale → sticky, `defer` while `samples === 0` (queued behind the armed hint — a phone's first HUD tick can
  precede its first sample); a rung → transient `AR_NOTE_MS` 3.5 s, queued behind a transient note (`announce`).
- Trap: a rung line announced while the armed hint is up must WAIT, not replace — `noteUntil` ref + one timer.

## 2 · 💾 SAVE (ask 2) — `mobile/SceneActions.tsx` `SavePlaceChip({ onHint })` + `chrome.css`
- `.m-act--icon` 44 px round (glyph + tiny label), same x as the altitude cells, directly below ⤓.
- Signed out / unknown: `aria-disabled="true"` (NEVER the attribute — it swallows the tap), opacity .45, tap →
  `SAVE_COPY.signIn` through the column's `flashNote` (4 s). `loginUrl`/`returnHereUrl` gone from the file.

## 3 · LIVE TABS + LONG PRESS (ask 3) — `mobile/tabLive.ts` (pure) · `TabBar.tsx` · `MobileShell.tsx`
- FIND live = `find.open && anyBody && fpvHud !== null` (the scan RUNS); SPOT live = `open && heatmapOn`
  (= `bestSpotArmed()`; never `open` alone — sticky on /m).
- `tabLongPress`: live → off (FIND collapses its sheet when showing + `publishGhosts(null, [])`); off → on when
  conditions hold (SPOT: `setOpen(true)` BEFORE `setHeatmapOn(true)` — `setOpen` clears the switch both ways),
  else OPEN THE SHEET (its copy names the missing thing).
- TabBar: ORCH shape (touch only, 500 ms, 6 px cancel, trailing click swallowed ≤ 900 ms, contextmenu prevented,
  `-webkit-touch-callout: none`); `.m-tab--live` = accent + a `::after` dot (the sheet test's label regex holds).
- `MobileShell` joined the `store/bestSpot` value-import OWNERS (fences.test.ts, dated).
- A showing `.m-sheet` (bottom 0, ≤ 62dvh) COVERS the tab row — tabs are touch-reachable only once it is closed.

## 4 · BEST SPOT HYGIENE + THE ENCODER (ask 4, T121)
- `BESTSPOT.liftDebounceMs` 220 — a T1-ONLY change (lift, solved disc, no move/day/rebuild) posts after 220 ms
  of stillness at the tier-key compare (trailing edge, keys wait, last value wins). First solve / move / day /
  rebuild never delayed. Test with `vi.spyOn(performance, "now")`.
- `!armed`: cancel UNCONDITIONALLY, `refining = false` (the REFINE latch), after `workerIdleDisposeMs` 45 s
  `client.dispose()` (resident TIN copies + per-rung DSM/grid/hulls + the tile cache go; `ensure()` re-spawns).
- DEV `bestSpot().lift {deferFrames, debounced, pendingT1}` + `workerDisposes`; DBG `planning.bs.lift*`, `bs.workerDisposes`.
- `controls/RateEncoder.tsx` = the ONE encoder (structural types; `ui/Encoder.tsx` a typed door); `.ct-enc*`
  CSS moved to upload-flow.css. `controls/useRateIntegrator.ts`: `stepRateValue` pure — ease at
  `CONTROLS.rateEaseTauMs`, step `rate·dt·max(v, BESTSPOT.liftEncoderBaseM 5)`, clamp, coast-out; its OWN position
  seeded from the store (`clampLiftM` snaps < 0.5 → 0; integrating the store echo parks a slow climb).
- TRAP (twin-caught, fenced): the hook must sit ABOVE each component's early return — below it React unmounted
  the whole /m shell on the first SPOT tap ("rendered more hooks").

## 5 · THE TWIST (ask 5, T120) — `lib/globe/twistTracker.ts` · `StylizedTiles.ts` `stepTouchTwist`
- The library has NO twist (PointerTracker measures no angle; ZOOM-vs-parallel-drag, one-shot, 2 px·DPR); the
  ROTATE azimuth is `−midpoint drift` — the orbit sign, inverted against a twisting hand (H1–H4 of the agent).
- Tracker: touch only, unwrapped angle since the pair formed, ARMED past `CONTROLS.twistArmDeg` 4, first
  `take()` = the whole angle (catch-up). `up()` returns "was armed" → `zc.rotationInertia.set(0,0)`.
- Step runs BEFORE `controls.update()`: `x = −Δ·twistGain`; on `state === 2` touch, subtract the library's
  `(c − p)·2π/H` read pre-update; `_applyRotation(x, 0, zc.pivotPoint)`; never FPV / flight / disabled.
  `twistLive` arms `mobile2dFreeHeading` and the north re-lock yields.
- Sign law: clockwise on the glass (y-down atan2 grows) → azimuth +Δ → heading DEcreases → the world turns
  clockwise with the fingers. Twin: 30° → −30.0° (2D), −30.1° (3D); 40° + 36 px drift → −40.0°.
- OWED: the Pixel read (the phone was on adb at boot, gone from USB by the harness). `verify-mobile-batch-2026-09-08.mjs 9444 --device`.

## 6 · T122 — the credit line at 1100 px
The stamp lengthened the `nowrap` list past the 60rem wrap breakpoint (HEAD failed A1-3 too by the stash A/B) →
72rem in `index.astro`; `mapWindowChrome.test` re-pinned.

## 7 · The owner calls, answered in-session (2026-09-08c) — and the next batch
Rulings: lean budgets keep 3/1.5 · `compileAsync` CLOSED · terrain BVH BUILD next · flip bank keep 112 MB ·
`treeLocateBudgetMs` 0.5 · **`holdMaxMs` 30 s (applied)** · `liftDebounceMs` 220 · `workerIdleDisposeMs` 45 s ·
`liftEncoderBaseM` 5 · `twistArmDeg` 4 · 2D parallel-drag rotation RETIRE (T129) · T113 parked · `skylineBehindAlpha`
0.35. Applied with it: the AR chip = the letters "AR" (no compass emoji), the save cell = ◎ (no floppy).
New asks → backlog T123 (iPhone jetsam residue after 2–5 min) · T124 (user meshes vanish in iPhone FPV, the
"altanka" pose) · T125 (REGRESSION: edited buildings not highlighted) · T126 (UNDO + drop-session-edits) · T127
(a stray touch clears the /m FPV pin) · T128 (user-mesh single-axis scale) · T129 · T130 (the device campaign,
stress + feature, minutes secondary to quality). Order in `NEXT_SESSION_PROMPT.md`: regressions first.

## Boot traps (this session)
- After `mv node_modules/.vite` aside, the FIRST `wix dev` served `504 Outdated Optimize Dep` on every module (no
  island mounted, the page merely blank; `curl` of a module read 200) — a SECOND plain restart fixed it.
- Never edit a served `src/` module while the sweep runs (I did once — the DBG rows; inert, the gate held).
- A `wix dev` left running ~9 h died on its own ("The development command failed to execute") — curl before every leg.
- Two timing-measured unit tests (`bestSpotSolver` ≥ 1.7×, `planFeed` bounded-by-time) flake under the dev server +
  Chrome load; re-run before believing them.

Related: [[project/wip-2026-09-07-mobile-bestspot-ar]] [[project/wip-2026-09-08-pixel-reads-version-t118]]
[[project/wip-2026-08-13-m2-fpv-touch]] [[project/wip-2026-08-18-u3-2dmap-batch]]
