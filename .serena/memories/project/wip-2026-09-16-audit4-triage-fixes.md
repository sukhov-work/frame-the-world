# wip 2026-09-17 — AUDIT #4 TRIAGE + FIX SESSION — DONE

Mode: implement (`/frame` + investigate-design-v3, Deep). Records: DECISIONS 2026-09-17 (the full ledger) · backlog
T17/T26/T30/T118/T136–T144 dated · `NEXT_SESSION_PROMPT.md` (rewritten) · `mem:core` (rewritten ≤ 12 KB).

## The owner's filter (2026-09-16, verbatim intent)
Fix only real issues (performance, stability, app-behaviour risk, codebase/docs maintenance). G1 G2 G3 are not
relevant and wasteful; public exposure, load and multi-user concerns (B2, B5 …) are not relevant — the app is a free
beta among a few trusted people. ZERO regressions. Declutter the NSP; archive DECISIONS; refresh the guide (mobile).

## Triage outcome (re-verified at the anchors on HEAD)
- MAJOR 6: T136 FIXED (exact pin + libraryPin.test + boot warns) · T137 FIXED (the LOOK-aware skyBudget twin; the
  audit's 0.8964 does not reproduce — the code says 0.8975, margin pinned) · G1/G2/G3 DEFERRED (T138/T139 rows) ·
  T142's visible half (ghosts + target pinned; Fuji pose verified).
- MINOR 37: 19 fixed (B1 B3 B4 C2 C3 D1–D7 F1 F2 G4 H1-1 H2-1 H2-2 H2-3 H3-1 H4-1 H4-3 H5-1 H5-2 H5-3 I1-3, D3 via the
  guide) · deferred by the filter B2 B5 F3 F6 · owner taste / invisible H5-4 (stars: 3 shaders + 3 built-in line
  materials) J2 (the far fog ≥150 km lands at the limb) J3 (needs eyes) A1's order probe · NOT REPRODUCED I1-5 · D8 trivia.
- NIT 13: 9 fixed; skipped C5 (test DRY), G6 (marketplace, no listings), I2-2 (moot under the pin), L5 (owner call).
- One hallucinated anchor: `mobile/ModelEditChip.tsx` never existed; `ModelEditChip` mounts on `index.astro` only.

## Traps paid for
- `verify-usermodels` leg 1 died on `Failed to fetch dynamically imported module …/.vite/deps/…GLTFLoader…` after the
  `.vite` aside: a LAZILY imported dep chunk 404s once after a fresh optimize. A plain `wix dev` restart cleared it —
  the T14 trap reads "expect to restart twice" now (NSP).
- `Map.prototype.set` on an existing key keeps its position — an LRU refresh must delete + set (seatCache).
- A test literal for `EditSnapshot` must be a real `PlacementSnapshot` (`lat, lon, rotDeg, sx, sy, sz, tU, pitchDeg,
  rollDeg`) — vitest passes structural junk that `astro check` rejects; run both.
- The house Chrome from the previous session was still up on :9333 — reused, closed at the end.

## Gates
vitest 3,138 / 210 · astro 0/0/12 · knip 0 · verify-guide ALL PASS (re-pinned 12/16/16) · uxbatch-09-16 ALL PASS ·
mobile-batch 127/127 · meshedit PASS · usermodels 21 legs · sweep vs `audit4-2026-09-11`: freeze 14/14; the
draw-count gate's three cold-run FAILs (fewer calls = the settle band) all PASS on the warm `--ids` re-run; pixel
diffs are the convergence trend (everest-orbit-52 65–95 %: the golden was CAPPED at 8 s / 74 ground tiles, this run
settled at 3.4 s / 128 — the same scene at a finer imagery level; legacy-m: the 09-16 strip vs a 09-11 golden).
Freshest promoted golden stays `audit4-2026-09-11`.

## Shipped + released (2026-09-17c)
Six guide figures re-shot (`scripts/shoot-guide.mjs`; NEW `shell-m` recipe; `target` sets the moon explicitly — the
store restores the last-tracked id from the profile, so a used profile inherited the sun). Ship hook in the foreground
→ `bd17d1e` (PR #126), package 1.36.13; `release:full` run 4 succeeded: canary 200/200, warm 168/0/0, live globe
verified, `/guide/shell-m.webp` served. TRAPS: `wix release` limits the comment to 250 chars and says so only AFTER the
build (two builds lost) → `release.sh` refuses it at step 1 now; the vitest gate can trip on the timing-measured
`bestSpotResidency` "< 1,000 ms" under load (8/8 alone) — re-run before believing.

Related: [[project/wip-2026-09-11-audit4]] [[project/wip-2026-09-16-mobile-uxbatch-menu-pinch-scale]]
