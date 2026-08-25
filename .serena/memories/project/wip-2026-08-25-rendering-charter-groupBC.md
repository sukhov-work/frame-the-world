# WIP 2026-08-25c/d — RENDERING CHARTER: Groups B + C SHIPPED (RC0–RC11)

Executing `.claude/claude-docs/rendering/RENDERING_CHARTER_2026-08-25.md`. **Groups B (the four
owner bugs, RC1–RC5) and C (the seat/height core, RC6–RC11) are DONE and browser-proven.**
Groups D/E/F/G/H (RC12–RC30) are NOT started — see `NEXT_SESSION_PROMPT.md`.

Gates at hand-off: **vitest 1,996/1,996 (137 files, +85)** · astro check 0 err / 0 warn / 5 hints ·
`npx knip` exit-0 · `verify-ultra.mjs` 29/29 · `verify-eclipse.mjs` 38/38 ·
**NEW `scripts/verify-rendering-charter.mjs` 56/56 ALL PASS** (shots `charter-01..08`).

## The three lessons this session paid for

1. **THE HARNESS LIED BEFORE THE CODE DID.** The first sunset scrub reported
   `max |Δ shadowIntensity| = 0.0000` over 61 samples — a perfect pass — while measuring a
   FROZEN TAB. The verify Chrome carries no occlusion flags, rAF was throttled, and every
   per-frame scalar was the same stale frame's value 61 times. Fixed with `ticks()`
   (bringToFront + a real rAF count) **plus an assertion that consecutive samples carry
   DISTINCT sun elevations** — zero-result validation applied to the probe itself. Two more
   harness lies died with it: `bodies()` publishes `sunDir`, not `sunAltDeg`, so a bisection on
   `undefined > 0` walked silently to its own lower bound and "found sunset" at the search start;
   and `JSON.stringify(<async IIFE>)` stringifies the PROMISE, so a probe reported `{}` instead
   of failing.
2. **M5 MEASURED THE WRONG QUANTITY TWICE, PLAUSIBLY BOTH TIMES.** Per-feature applied delta →
   flat ~15 m everywhere (that is within-cell RELIEF; the cell seat absorbs bake error before any
   feature is placed). `terrainSeat − bakedHeight` → a clean +109 → +149 m growth that reads
   quadratic (that is the terrain height; the enriched bake is deliberately laid at h≈0).
   **The right quantity is the curvature residual the per-cell re-seat cannot absorb —
   `d · cellHalfSpan / R` — bounded by the CELL radius, never the bake radius.**
3. **A DEFECT INTRODUCED AND CAUGHT IN THE SAME SESSION, by the browser and not by 1,996 tests:**
   RC7's drain popped an index and re-pushed it on failure; `pop()` takes from the same end, so
   one unanswerable footprint retried immediately and forever and ate the whole budget.

## M5 — THE VERDICT: **F1 (tangent-plane curvature) REFUTED as dominant. RC12 is not worth a re-bake.**

Every cell is independently re-seated onto terrain at its own centre, so the tangent-plane rise
survives only as its VARIATION ACROSS ONE CELL. Browser-measured over the shipped Dnipro bake:
at the 3,500–4,000 m ring, **0.568 m of curvature residual vs 14.20 m rms of within-cell relief
= 4.0 %**. Group D's value is RC13 (skirt) / RC15 (DSM→DTM) / RC16 (straddler) / RC17 (sidecars).
The derivation lives in `debugSeats()` beside the numbers (`ENRICHED.cellHalfSpanM`).

## Group B — the four owner bugs (all browser-proven dead)

- **RC1 / B2 totality square** — `scene/glsl.impostorEdgeWindow` + `SKY.sunQuadFade [0.72, 0.98]`
  (+ `SKY_TARGET.quadFade [0.92, 0.995]`). The window multiplies **AFTER** the dither, so the
  ±1/256 noise fades out with the signal; gating the dither only moves the straight edge onto the
  gate. Measured: step across the old boundary **2.66 of 255 vs 32.05 in the control band**.
- **RC2 / B3 sunset snap** — `lib/globe/keyHandoff.ts` + `SHADOWS.fadeBandSin 0.0523` (≈3°).
  ENABLER: `shadow.intensity` is a LIVE per-frame light uniform in three 0.185 AND `getShadowMask()`
  routes it through `ShadowMaterial`, so ONE write fades building shadows and the ground twins
  together. Measured over 103 samples, sun +4.21° → −1.28°: **1.000 → 0.0000 → 0.601, max step
  0.0270** (the old boolean was 1.0), trough at 0.426° = the gate, key 0.0000 there,
  `castShadow` never flips. **The phantom night key is untouched where no moon waits — that is AB1.**
- **RC3 / B4a** — `!!focusHit` is GONE from `shadowEligible`. 4 of 7 sweep samples have no
  ellipsoid hit at all (fit == `sqrt(h(2R+h))` at that altitude) and still cast.
- **RC4 / B4b** — `lib/globe/shadowFit.ts`, rig-only `_shadowFocus` (`_focus` untouched: it is the
  tilt/heading pivot and the lat/lon source for PLAN/FIND/BEST SPOT). The pre-RC4 box needed
  pitch ≥ **atan(1/boundsAltK) = 59.0° base / 42.0° ULTRA at EVERY altitude**, which is why
  zooming never helped. **Crispness trade, stated:** near-level looks now spend texels on 5 km
  instead of 1.6 km (0.78 → 2.44 m/texel) — but at those pitches there were NO shadows before.
  `SHADOWS.viewFitK: 0` restores the old extent while keeping the re-centring → AB4.
- **RC5 / B1 Esri sentinel** — `lib/globe/esriPlaceholder.ts` + a `public/sw.js` carve-out.
  **THE CHARTER'S PROPOSED DETECTOR WOULD HAVE HALF-FAILED: Esri sends no
  `Access-Control-Expose-Headers`, so `ETag` is NOT CORS-readable from a page.** Detection is on
  the BYTES (length 2521 + FNV-1a-32 `0x92d9118f`), pinned against a committed fixture.
  Browser-proven against the LIVE service via `__globe.esriProbe`: three real Everest sentinels
  came back as **6,790 / 12,618 / 11,441 B of real imagery**; repeat GETs all skipped without
  re-asking; the unreachable case (past Esri's max level) fails soft and is then served from a
  banked body rather than re-GET forever.

## Group C — the seat/height core

- **RC6** `lib/globe/terrainPick.ts` — deepest-tile hit selection. **M7's answer is a NEGATIVE:
  `hitsPerSample` exactly 1.00 over 37,742 at-rest + 9,874 mid-refine samples; the fading parent
  won ZERO times.** Cheap insurance, not the fix for anything observed.
- **RC11** `lib/globe/heightMemo.ts` — an EXACT (epoch, lat, lon) memo, invalidated by
  `terrainEpoch`, `null` never cached. **84.0 % hit rate, 18,457 entries, 0 overflows** → funded
  `reseatFeatureSamplesPerFrame` 16 → 64 and trees 10 → 40.
- **RC7** look-biased priority (`lookBiasedDistance`, shared with the download queue) +
  never-sampled-first drain. Cone 50.3 % vs city 33.9 %. **S4's >0.9 bar NOT met — open tail.**
- **RC8** relief-scaled plausibility gate + `debugSeats().rejected` (audit gap #5: the number did
  not exist, so a gate rejecting everything looked like an unswept cell).
- **RC9** seat cache across LRU eviction. **Distance alone does not evict** — the 6 km bake fits
  inside the desktop LRU cap, so at `high` these cells are never dropped; the first check
  reported 0 banked / 0 warm and looked like a pass. Squeezing the cache proves the BANKING leg
  (101 → 95 cells, 6 banked); the **WARM-RESTORE leg is browser-UNVERIFIED — open tail.**
- **RC10** FPV walk re-seat, sampled on DISTANCE (`FPV.walkReseatDistM` 4 m), `seatStep`-eased.
  302 m walk: correction 0.50 m, worst altitude step 0.23 m, **zero >0.5 m eye jumps outside walk**.

## RC0 probes (recorded)

M1 FPV `near` **1.0 m** / `far` **180,375 m** (ratio 180,375) · M2 **DEPTH_BITS 24**, webgl2 ·
M6 `heightAt` **0.018–0.067 ms/sample** · M7 see RC6 · M8 Dnipro terrain 68.9–186.0 m.
**RC28 (depth) has no evidence behind it** — 24-bit depth over a 1 m near plane, and no shimmer
case was observed; skip without one.

## Open tails owned by the next session

1. RC7's S4 bar — instrument WHY the drain defers (unloaded terrain vs the gate; gate rejections
   are counted, null-terrain deferrals are not).
2. RC9's warm-restore browser leg — wait on `load-model`, not on a timer.
3. Groups D/E/F/G/H (RC12–RC30) untouched. **RC12 is REFUTED by M5 — do not build it.**

Related: `mem:core` · `mem:project/wip-2026-08-25-rendering-charter` (the charter's authoring
session) · DECISIONS §Recent **2026-08-25c** (Group B) and **2026-08-25d** (Group C) ·
`rendering/RENDERING_CHARTER_2026-08-25.md` · backlog T54.
