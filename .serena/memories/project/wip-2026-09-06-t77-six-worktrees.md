# wip 2026-09-06j — T77 continues: slice BASE (T96+T66) · C-1 · T80-g · A-rest · T94 · sheet defects — CRASHED, then RETRACED (session k)

Mode: implement, Deep (`/frame` under the investigate-design-v3 spine). Owner order 2026-09-06j:
"proceed with plan from NEXT_SESSION_PROMPT.md; use workflows if needed".

## Session j (≈15:13–15:50) — the crash
Method as planned: six git worktrees `../ftw-wt-{base,c1,t80g,arest,t94,sheets}` (symlinked
`node_modules` + `bakes`, env copied, `astro.config.mjs` gained an env-driven `FTW_VITE_CACHE`
cacheDir), **one `wix dev` (:4331–4336) + one headless Chrome (:9341–9346) + one opus agent PER
WORKTREE**. On the 36 GB M3 (IntelliJ ≈20 GB, another Claude session running) swap passed 120 GB
and the machine froze at ≈15:50; the owner rebooted ≈15:57. Agents had edited 15:33→15:47.
What survived: the pre sweep sheets (`verify-shots/sweep/pre-2026-09-06j{,-reshoot}`), and the
UNCOMMITTED diffs in all six worktrees (patched to `~/.claude/ftw-wt-patches-2026-09-06j/*.patch`
by session k). No DECISIONS line, no agent reports (tmp wiped by the reboot).

## Session k (16:05→) — retrace under the resource budget
- The budget (`mem:project/dev_environment` §THE RESOURCE BUDGET, `conventions/verify.md`): 1 house
  headless Chrome · 1 dev server · agents never launch either; `verify-chrome.mjs` exit 3 guards it.
- Method now: worktrees stay for EDIT isolation; review/complete each slice with read/edit agents
  (focused vitest only); land onto master one at a time in the plan order BASE → C-1 → T80-g →
  A-rest → T94 → sheets; full vitest + astro check + the browser gates from the main session, one
  suite at a time, on master's `wix dev :4321` + the one headless Chrome on :9333.

## Where the record goes
DECISIONS 2026-09-06j+k line under the marker · MEASUREMENTS §15 · T77 plan pointer · backlog
T96/T66/T77/T80/T92–T95 · `mem:core` status · this leaf · `NEXT_SESSION_PROMPT.md` · `.claude/.ship-title`.

## Session k — six edit-only opus/sonnet agents (16:10→16:34) reviewed + completed every worktree
Reports: `~/.claude/ftw-wt-patches-2026-09-06j/reports/{base,c1,t80g,arest,t94,sheets}.md`; final
patches `*-final.patch` beside them (each EXCLUDES `.claude/conventions/verify.md` — every agent
rewrote the budget text because the guard lives on master only, not in the worktrees).
- **base LANDED on master 16:29** (staged): `ULTRA.baseTakesLook` (not `LIGHT.*` — no LIGHT block),
  `lookOn()` in StylizedTiles, `SHADOWS.rig*Texels` 0→1 (ruling 3 in tuning), T66 curves + F4
  `× uFtwSkyLevel`, charter Group F re-pointed (would have gone red), the T66 luma gate in
  `verify-ultra-dusk --ladder` (15→18 checks; `--ultra 0|1`), +29 tests. vitest 2,594/2,594 ·
  astro 0/0/9. Browser gates: queue running on :9333.
- c1 COMPLETE (5a/5b/5d/5e/deep-resample; 3 bugs fixed: zero-dt idle latch, 5e starvation,
  unbounded resample → `reseatDeepResampleMaxPerFrame` 6); streaming 9–11 NOT started (measure
  first). Patch applies clean.
- t80g COMPLETE: `resolvedComposer.ts` (`MsaaResolvePass` + `PinnedComposer`), rt1 demoted to
  non-MSAA/no-depth (~195 MB VRAM saved — gap 4 was FALSE: rt1 alternates as the scene target);
  `verify-uxbatch4-s3` bloom lookups repaired; `__quality.bloomPath()`. Applies clean.
- arest COMPLETE code-side: `shadowRig()` 5-lever DEV override, `scripts/lib/shadowArms.mjs`,
  `--arms/--rig-json/--legs`; NO ShaderChunk override (E1 decides). 3 browser experiments queued.
- t94 COMPLETE: `frameFreeze.ts` seam (12 clocks/holds incl. scene time, controls.update(0),
  governor park), sweep `--freeze` default under --golden/--compare; skew bug fixed. CONFLICTS
  with BASE at StylizedTiles ~:5942 (manual merge).
- sheets: 4 probes fixed (target leak, poseUrl, verdict lines); run on :9333 (not :9346).
- TRAP hit 16:31: after a big landing, `wix dev` served `504 Outdated Optimize Dep` for EVERY
  island (0/12 rungs); fix = kill dev, `mv node_modules/.vite aside`, restart — ALWAYS after a landing.

## Outcome (17:20)
- **ALL SIX INTEGRATED on master** (staged, uncommitted; the ship carries them) in the plan order;
  the T94 hunk at `StylizedTiles.ts` ~:6140 re-contexted by hand against BASE's `lookOn()` line.
  Unit gates on the stack: vitest **2,692/2,692 (172 files)** · astro **0/0/9** · knip **0**.
- BASE browser gates: ladder `--ultra 1` **18/18**, `--ultra 0` **17/18** → the red was the base
  rig's field ramping from +2.5° at Everest (5 km box geometry, not a defect) → check re-pointed
  ("FULL at +3°, ≥0.4 at +0.9°" on the base rig). T66: 0.00 codes worst rise on BOTH rigs.
- **BLOCKER (T98): `api.cesium.com` → HTTP 403 "Request blocked" (CloudFront WAF)** from the Dnipro
  ISP IP, no VPN, with/without token, curl/Chrome UA. No terrain / OSM buildings load
  (`terrainEpoch` 0; charter 68/82 with 0/39,415 seated; the Everest ladder is a flat plain). Was
  fine at 15:29. Leading cause: a rate-based WAF rule tripped by session j's six globes. Every other
  browser gate is UNRUN; the queue is `scratchpad/gates/post-queue.sh` (aborts on 403).
- Records: DECISIONS 2026-09-06j+k · MEASUREMENTS §15 · T77 pointer · backlog T66/T80/T92–T96 amended,
  T97–T99 added · `mem:core` · NEXT_SESSION_PROMPT rewritten.
## k2 (17:55 → 19:25) — the block lifted BECAUSE THE OWNER CONNECTED PROTON VPN (k3 correction; a block on the Dnipro ISP address, not a rate limit — `mem:project/dev_environment` §NETWORK) and the gates ran
- Queue (43 min, one Chrome) + 3 solo re-runs + timed pair on a headed :9222 (launched + closed by me).
- Numbers: ladder off 18/18 (luma 108.9→68.4, 0.00 codes; field 1.0 to +0.5° then 0.887/0.712/0.590/
  0.175) · on 17/18 solo (0° bump GONE 78.0→68.6; −0.5° +4.9 codes = the ULTRA release band, T100;
  the first run's +3° = 53.9 was a half-revealed ground) · charter 84→83/85 → re-pointed (moon gate
  literal +0.4° → `gateDeg`; RC7 equality at full convergence; `ultraQuality:false` precondition —
  trap (f) bit: the ladder's `--ultra 1` pref leaked into the off-state checks) · ultra 30/30 solo
  (§1b in-queue red = warm tile cache) · shimmer base fpv.u0 churn p50 0.0000, control 0.00000, RL
  2.64 · reseat FPV eye rejected +0 / collapsed 0 / end 0.000; ARRIVAL rejected +39,629 (T101) ·
  sweep 14/14 BYTE-IDENTICAL; 3 harness defects fixed (measure-first; two-phase freeze
  `--reveal-settle-s 3`; descent re-boot after a frozen capture, T102) · bloom probe: signal below the
  noise floor · E3: 122/122 refreshes by EPOCH → lever 12 CLOSED · T92 = focal cone fill · T93 = base
  earth limb · `frame.cpu` fpv 0.7 ms · fpv GPU on 19.8 / bloomMsaa 22.5 / off 9.8 / cheap 18.4 →
  T80-g −2.7 ms, gate ≤ 15 unmet → T80-h = the blur.
- Records: DECISIONS 2026-09-06k2 · MEASUREMENTS §15.5 · backlog T92/T93/T94/T96/T66/T80/T98 amended,
  T100–T102 added · NEXT_SESSION_PROMPT rewritten. Chrome closed; dev server left for the hook.
- Reversal, if a gate goes red next session: `git apply -R ~/.claude/ftw-wt-patches-2026-09-06j/<slice>-final.patch`
  (each slice is one clean patch; order of reversal = t94, arest, t80g, c1 — sheets and base are independent).
