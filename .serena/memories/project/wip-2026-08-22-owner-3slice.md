# wip 2026-08-22h/i — owner slice: scrubber card · Everest bake · FPV research · FPV ceiling · ULTRA HQ (compacted 2026-09-06 from 16,033 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-09-06)

Gates: vitest 1,296/1,296 (110 files) · `astro check` 0 err / 5 hints · both product changes
browser-verified on CDP Chrome (shots `scrubber-01/02`, `everest-00..02`).

## 1. TimeScrubber card chrome — a REGRESSION, not a restyle
No decision removed it. `git log -L 1,40:src/styles/time-scrubber.css` names commit **`086ff37`**
(2026-08-21f, QA batch item 4): it needed a `body.mw-open .ts` seat with a z-index and a bottom lift,
and was written by **MOVING the whole declaration list** into the state selector instead of adding a
rule holding only the delta — so six properties existed ONLY while the expanded map was open.

Fix: those six back on the base `.ts`; the state rule keeps only the z-index and bottom.
**Fence** (`test/styles/mapWindowChrome.test.ts`): the chrome IS on `.ts` and is ABSENT from
`body.mw-open .ts` — it pins the SHAPE of the mistake, not the symptom. **Trap:** `decl()` anchors on
`^`/`;`/`{`, so a docblock immediately above a declaration hides it — run `stripComments` first.

## 2. EVEREST — the second GLO-30 true-heights bake
Live at `terrain/everest/` on R2 (13,487 files · 200.39 MB); config
`scripts/bake/cities/everest.json`, registry entry in `src/lib/globe/regions.ts`.
- **Geometry**: `cityBbox [86.72, 27.805, 87.13, 28.17]` = a 20 km radius on the summit, from real
  degree lengths at φ=27.988 — **110.819 km/deg meridian vs 98.376 km/deg parallel**. That 11 % axis
  difference is pinned by `regions.test.ts` (four cardinal points at 20 km inside, 25 km outside as
  the positive control). `extentBbox` covers the four 1° COGs it straddles.
- **NEW registry shape — TERRAIN-ONLY regions** (`variants: []`). `enrichedVariant.defaultRegion`
  now skips a variant-less boot region; without it, standing on Everest resolved `variants[0]` to
  `undefined` and requested `…/enriched/undefined/tileset.json`. **Terrain-only entries go at the
  TAIL** — `BAKED_REGIONS[0]` is the fallback and its `variants[0]` is read unguarded.
- **Runtime proof**: walking `__globe.ground.root` found 612 tiles with `/terrain/everest/` URIs and
  0 CWT inside the extent, and `terrainHeightAt(27.9955, 86.828)` = **5,550 m** against Kala
  Patthar's published 5,545 m. (`performance.getEntriesByType('resource')` is USELESS here — its
  250-entry buffer fills with Vite module loads before the first tile. Walk the tile tree.)

## 3. Three measured findings (rulings in `BAKED_ASSETS.md` §2 9–10, §3, §6)

**(a) THE VERIFICATION REFERENCE WAS WRONG, NOT THE BAKE.** The first Everest bake failed its own
probe with `median bias −39.3 m — datum or georeferencing fault`. It wasn't: `geoid.mjs` held ONE
grid and **CLAMPED** to its nearest corner, so the Everest probe was answered with Dnipro's value,
+20.025 m where the truth is −28.341 m. The clamp is now a **throw**, `geoidCovers(extentBbox)`
pre-flights before meshing, and grids are per-region. **A reference that extrapolates silently turns
"no data" into evidence, and the evidence indicts the wrong component.**

**(b) THE PROBE ONLY WORKED ON A PLAIN.** It is now a **9×9 interior grid** splitting **bias**
(median SIGNED error = the DATUM gate, and the discriminating one, because slope error is
sign-symmetric and cancels in a median however steep the ground, while a missed geoid does not) from
**spread** (median ABSOLUTE error = the RESOLUTION gate, the only one that grows with relief), plus a
**positive control**: all 81 samples must land inside a source COG. **NEW `--probe-only`** re-verifies
an on-disk tree writing nothing — the ONLY safe way to re-touch an existing bake, because **stage 3
(rim blend) is NOT idempotent**.

**(c) MESH INTENSITY IS NOT THE LEVER — REJECTED.** mago's `--intensity` (default 4) at 12 moved the
summit sample **0.1 m** while taking 210 MB → ~640 MB. Already at the source's information limit.

**What the height map can do:** GLO-30 reads the summit pixel at **8,732 m**, so a 30 m DSM is
**111 m below the published 8,848.86 m apex by construction**; our mesh carries that peak to within
3 m. **The bake is faithful to its source; the source is not faithful to the apex.**

**Also rejected:** `extentMaxDepth < maxDepth` would cut 210 MB → ~41 MB, but moves the patch↔CWT
boundary onto an **un-blended `cityBbox` edge** — a height cliff ringing the region.
**Relief, not area, sets the price**: Dnipro's 2 sq-deg cost 11.5 MB, Everest's 4 sq-deg 210 MB.

## 4. FPV far-field accuracy — READ-ONLY investigation
A six-dimension inventory (terrain heights · building seating · imagery/textures · camera and numeric
precision · adaptive loading and foveation · shaders/materials/post), with every proposed gap
adversarially refuted by an independent agent before it counted. The ladder became backlog T43.

## 5. ADDENDUM 2026-08-22i — FPV ceiling · ULTRA HQ · the HQ 3D MAP that was measured away
Gates: vitest 1,305/1,305 · astro 0 err / 5 hints · `npx knip` exit-0.

### (a) FPV altitude ceiling 400 → 2,000 m — `FPV.tempEyeMaxM`
ONE constant, five clamp sites (two encoder branches, two Space-lift branches, the `#f=` share
parser), so a shared link stays inside it by construction. The real consequence is the VIEW: the
geometric horizon moves 71 → 160 km, so a maxed eye pulls a bigger working set into the T43 far field.

### (b) ULTRA HQ — shipped, desktop-only, off by default (`ULT` chip)
**NOT a fourth tier.** `QualityTier` / `TIER_ORDER` / `detectDeviceTier` / `makeGovernor` /
`QUALITY.tiers` are untouched — a fourth rung is a type error at `queueCapsForTier` and a `toEqual`
failure on the TIER_ORDER lock. It is `QUALITY.ultraDesktop`, an override profile layered on the
running tier — the structural mirror of `leanMobile`.
- The TILE half lands on the chip edge, because `stepUltraGate` re-runs
  `applyQualityTier(activeQualityTier)`; waiting for the governor would never fire on a `high` box.
- The TIER PIN rides GlobeCanvas's FPV-deferred `pendingTier`. **`governor.force()` alone is NOT
  enough** — it only moves the index and resets hysteresis, so the next over-budget streak walks the
  tier back down. The governor keeps STEPPING and only its results are dropped, with an explicit
  re-seat to `deviceTier` on the OFF edge.
- `ultraTileLevers(base, false, …)` returns `base` **BY IDENTITY**, so the off-proof is `toBe`.
  Measured round trip: OFF `SSE 16 / LRU 410` → ON `SSE 12 / LRU 600` → OFF byte-identical.
- EXCLUDED and pinned by test: `dprCap` (inert behind `min(devicePixelRatio, …)`),
  `overlayResolutionPx` (a one-way ratchet plus the QA-7b storm), shadows/AO/8k (construction-time),
  `foveation` (on high it SOFTENS the periphery), queue caps (hitches).

### (c) HQ 3D MAP — BUILT IN FULL, MEASURED INERT, REMOVED (T44)
Built as designed (a bounded `SphereRegion` on its own `LoadRegionPlugin`) and verified attached at
the view focus. **Zero extra tiles at 895 m AND at 5,969 m.** The control that settles it: forcing
the GLOBAL `errorTarget` to 0.05 ALSO produced zero. The ground is availability-capped (Esri z19 +
patch L13) and `GROUND.errorNearAlt` is 60 km, so below that the 3D target already sits at its
finest. **Desktop has NO unspent imagery-refinement headroom — the premise "the 2D chart holds detail
the 3D view lacks" is false.** The chip was removed; the lever that WOULD deliver it is anisotropy
(T43 S1) — `getMaxAnisotropy()` measured 16 available against a shipped `anisotropy=1`.

### (d) `.ct-vec.is-on` — a pre-existing bug fixed in passing
`ct-vec` appeared nowhere under `src/styles/**`: the VEC chip had had NO lit state since it shipped.
The by-hand lit group in `camera-tilt.css` has now bitten twice.

### (e) THE BUG ONLY THE BROWSER COULD FIND
`let ultraOn` declared beside the shell gate put it in the **TDZ** for `applyQualityTier`, which runs
at ATTACH time hundreds of lines earlier, so the whole tileset failed to attach. GlobeCanvas's
`.catch` logs that as a console.**WARN**, so the app silently rendered the procedural placeholder
while every `error`-level read came back clean, and `astro check` cannot see a TDZ across a closure.
**When a globe change "does nothing", read console.warn before anything else.**

### The mobile fence (both toggles were designed against it)
The prefs blob is ONE shared localStorage key, the store is one store, and /m mounts the SAME
GlobeCanvas and StylizedTiles — so hiding a chip isolates NOTHING. The fence is one predicate,
`hqAllowed = !isMobileShell && !coarsePointerShell`, and every engine read sits on a line naming it.
`fences.test.ts` pins both halves and was adversarially verified to fail.

## 6. OWNER ORDER 2026-08-22i — SHIPPED as the ULTRA track (2026-08-22j)
The order: the crisp high-fidelity 3D texture look (T44) plus **ULTRA shadows pushed to the limit**
(T45) — no ray tracing, desktop only, opt-in, off by default.
**OWNER STEER: the GI rejection is ACCEPTED with a condition** — day → dusk → night must become more
epic in general atmosphere and global light feel, not only in shadows. That put light transport above
CSM and terrain casts: S9 (drive `dayK` from REAL sun elevation and the ephemeris twilight
thresholds, not a smoothstep over a dot product) → S11 (`toneMappingExposure` eased with sun
elevation) → S4 → S10 (key/ambient/hemisphere track the ephemeris; `HemisphereLight` was along ECEF
+Y, not local up) → S2 → S5 → S3. **JUDGE AS A TIMELAPSE, NEVER SINGLE FRAMES.**
Two owner words decoded: *"very grayish"* is the PHOTOGRAPHIC GRADE, **separable** from
`dayK = max(dayK, uFtwFlat2d)`, the term that would delete the terminator; a new uniform must be
declared in BOTH `shader.uniforms` and the fragment header block, or it is a silent compile fail.
*"less resolution"* is ANISOTROPY, not tile depth. Shipped: `mem:project/wip-2026-08-22-ultra-track`.

`mem:core` · `mem:project/wip-2026-08-18-u7b-glo30-terrain-buildings-rule` ·
`.claude/claude-docs/BAKED_ASSETS.md` (canonical) · DECISIONS 2026-08-22h/i · T43 / T44.
