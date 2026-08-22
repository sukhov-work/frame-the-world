# wip 2026-08-22h/i — owner slice: scrubber card · Everest bake · FPV research · FPV ceiling · ULTRA HQ

Gates: **vitest 1,296/1,296 (110 files, +4)** · `astro check` 0 err / 5 hints · both product
changes browser-verified on the owner's persistent CDP Chrome (shots in `verify-shots/`:
`scrubber-01-BEFORE-no-card` / `scrubber-02-AFTER-card-restored` / `everest-00-probe` /
`everest-01-fpv-kala-patthar` / `everest-02-fpv-toward-summit`).

## 1. TimeScrubber card chrome — a REGRESSION, not a restyle

The owner asked which decision removed it. **None did.** `git log -L 1,40:src/styles/time-scrubber.css`
names the commit: **`086ff37` (2026-08-21f, owner QA batch item 4)**. That item needed a new
`body.mw-open .ts` seat carrying a z-index and a bottom lift. It was written by **MOVING the whole
declaration list** out of `.ts` into the state selector instead of adding a rule holding only the
delta — so `background` · `border` · `backdrop-filter` · `border-radius` · `padding` · `width`
existed ONLY while the expanded map was open. Everywhere else the rail was bare text.

Fix: those six back on the base `.ts` verbatim; `body.mw-open .ts` keeps only `z-index: 43` +
`bottom: calc(2.2rem + var(--mw-credit-h, 0.85rem))`.

**Fence** (`test/styles/mapWindowChrome.test.ts`, last test in the attribution describe): asserts
the chrome IS on `.ts` and is ABSENT from `body.mw-open .ts` — it pins the SHAPE of the mistake,
not just the symptom. **Trap while writing it**: `decl()` anchors on `^`/`;`/`{`, so a docblock
sitting immediately above a declaration hides it (the `*/` becomes the preceding char) — run
`stripComments` on the rule body first. `width` was the only property that failed for this reason.

Verification idiom worth reusing: **A/B on ONE live frame** — inject
`.ts{background:none!important;border:none!important;backdrop-filter:none!important}`, element-
screenshot `.ts`, remove, re-shoot. Over the pale Himalaya the before-shot loses "TIME SCRUB",
"−4 d 5 h" and every tick label. Far more convincing than two navigations.

## 2. EVEREST — the second GLO-30 true-heights bake (owner: "just for fun / test the height map")

Live at `terrain/everest/` on R2 (13,487 files · 200.39 MB uploaded, Worker 200s confirmed).
Config `scripts/bake/cities/everest.json`, registry entry in `src/lib/globe/regions.ts`.

- **Geometry**: `cityBbox [86.72, 27.805, 87.13, 28.17]` = 20 km radius on the summit
  (86.925278, 27.988056), from real degree lengths at φ=27.988 — **110.819 km/deg meridian vs
  98.376 km/deg parallel**. The 11 % axis difference is pinned by `regions.test.ts` (four
  cardinal points at exactly 20 km must be inside; 25 km must be outside = positive control).
  `extentBbox [86,27,88,29]` = the four 1° COGs it straddles (it crosses both 87 E and 28 N).
- **NEW registry shape — TERRAIN-ONLY regions.** `variants: []`. `enrichedVariant.defaultRegion`
  now skips a variant-less boot region: without it, standing on Everest resolved `variants[0]`
  to `undefined` and requested `…/enriched/undefined/tileset.json`. Terrain-only entries go at
  the **TAIL** — `BAKED_REGIONS[0]` is the last-resort fallback and its `variants[0]` is read
  unguarded (pinned by a new registry-head test). `regions.test.ts`'s "at least one variant"
  invariant relaxed to "at least one variant OR a terrain patch".
- **Runtime proof** (dev serves `bakes/terrain/**` at `/terrain` automatically): walking
  `__globe.ground.root` found **612 tiles with `/terrain/everest/` content URIs and 0 CWT**
  inside the extent; `__globe.terrainHeightAt(27.9955, 86.828)` = **5,550 m** against Kala
  Patthar's published **5,545 m**.
  (`performance.getEntriesByType('resource')` is USELESS here — the default 250-entry buffer is
  full of Vite module loads before the first tile. Walk the tile tree instead.)

## 3. Three measured findings (all in BAKED_ASSETS.md §2 rulings 9–10, §3, §6)

**(a) THE VERIFICATION REFERENCE WAS WRONG, NOT THE BAKE.** First Everest bake failed its own
probe: `median bias −39.3 m > 20 m — datum or georeferencing fault`. It wasn't. `geoid.mjs`
held ONE grid (lons 34–36 / lats 48–49) and **CLAMPED** to its nearest corner, so the Everest
probe was answered with Dnipro's 36 E/48 N value — **+20.025 m where the truth is −28.341 m**.
Now: the clamp is a **throw**, `geoidCovers(extentBbox)` pre-flights before meshing, and grids
are per-region. **A reference that extrapolates silently turns "no data" into evidence, and the
evidence indicts the wrong component.**
Sampling recipe (no bake-time dependency; grids are checked in):
`brew install geographiclib` → `geographiclib-get-geoids -p ~/.geographiclib egm2008-5` →
`GEOGRAPHICLIB_GEOID_PATH=~/.geographiclib/geoids GeoidEval -n egm2008-5`. The 5′ model
reproduces all 15 of the 2.5′-sampled Dnipro rows to **within 1.6 mm**. The 0.25° Everest grid
interpolates to 0.73 m max / 0.21 m RMS against dense samples.

**(b) THE PROBE ONLY WORKED ON A PLAIN.** One tile-centre sample is accuracy on a river plain
and one point's slope error in the Khumbu. Now a **9×9 interior grid** splitting:
- **bias** = median SIGNED error → the DATUM gate, and the discriminating one (slope error is
  sign-symmetric and cancels in a median however steep the ground; a missed geoid does not).
- **spread** = median ABSOLUTE error → the RESOLUTION gate, the only one that must grow with relief.
- **positive control**: all 81 samples must land inside a source COG, so a mosaic at −180/90
  can't pass with a median of nothing.
Tolerances region-scoped (`probeBiasTolM` / `probeSpreadTolM` / `rimTolM`), Dnipro numbers as
defaults. **NEW `--probe-only`** re-runs verification against an on-disk tree writing nothing —
the ONLY safe way to re-touch an existing bake, because **stage 3 (rim blend) is NOT
idempotent**. It re-verified the SHIPPED Dnipro artifact unchanged (bias +0.4 / spread 2.4 m),
which is how the probe rewrite was proved harmless without re-baking.
Everest receipts: city-centre bias +8.8 / spread 10.2 m on a tile with **1,944 m of relief**;
extent-mid −2.0 / 3.1 m; **rim Δ −0.0 m**.

**(c) MESH INTENSITY IS NOT THE LEVER — measured and REJECTED.** mago's `--intensity`
(default 4, the bake never sets it) at 12: vertices 1,096 → 3,500, bytes 21 → 68 KB, summit
sample moved **0.1 m**, tile max 2.1 m. Already at the source's information limit; raising it
takes 210 MB → ~640 MB for nothing.

**What the height map can actually do** (the owner's actual question): GLO-30 reads the summit
pixel at **8,732 m** — a 30 m DSM is **111 m below the published 8,848.86 m apex by
construction**. Our mesh carries that peak to within **3 m** (tile max 8,734.9 vs the source's
8,737.8 m window max). A point sample AT the apex coordinate reads ~8,664 m because a 34 m
posting cannot resolve a pyramid. **The bake is faithful to its source; the source is not
faithful to the apex.**

**Also rejected, with its price**: `extentMaxDepth < maxDepth` would cut 210 MB → ~41 MB, but it
moves the patch↔CWT boundary off the rim-blended extent edge onto an **un-blended `cityBbox`
edge** — 170 MB bought with a height cliff ringing the region. This is why Dnipro and Everest
both run `extentMaxDepth == maxDepth`.

**Relief, not area, sets the price.** Dnipro 2 sq-deg → 11.5 MB (a plain decimates to ~190
verts/tile). Everest 4 sq-deg → **210 MB** (Himalayan tiles can't decimate; ~17 KB/tile at both
L12 and L13). Budget a new mountain patch by RELIEF.

## 4. FPV far-field accuracy — READ-ONLY investigation

Owner: *"do not implement anything in this session"*. Ran a six-dimension inventory (terrain/
heights · building seating · imagery/textures · camera+numeric precision · adaptive/loading/
foveation · shaders/materials/post) with every proposed gap adversarially refuted by an
independent agent before it counted. Report + ranked slice ladder recorded with the session
output; nothing under `src/` was touched.


## 5. ADDENDUM 2026-08-22i — FPV ceiling · ULTRA HQ · the HQ 3D MAP that was measured away

Gates: **vitest 1,305/1,305 (110 files)** · astro 0 err / 5 hints · `npx knip` exit-0.

### (a) FPV altitude ceiling 400 → 2,000 m — `FPV.tempEyeMaxM`
ONE constant, five clamp sites (two encoder branches, two Space-lift branches, the `#f=` share
parser at `StylizedTiles.ts:2326`), so a shared link stays inside it by construction. No rate
change: the encoders step by `rate · dt · max(h, vertEncoderBaseM)` — exponential — so at
`spaceLiftRatePerS 1.1` the climb reaches 2,000 m in ≈5.0 s vs ≈3.6 s for 400 m.
**Browser-measured: held at exactly 2000.0.** Real consequence is the VIEW: the geometric
horizon moves 71 → 160 km, so a maxed eye pulls a bigger working set — reaching further into
the T43 far field, not a new failure mode.

### (b) ULTRA HQ — shipped, desktop-only, off by default (`ULT` chip)
**NOT a fourth tier.** `QualityTier` / `TIER_ORDER` / `detectDeviceTier` / `makeGovernor` /
`QUALITY.tiers` untouched — a fourth rung is a type error at `queueCapsForTier` AND a `toEqual`
failure on the TIER_ORDER lock. It is `QUALITY.ultraDesktop`, an override profile layered on
the running tier: the structural mirror of `leanMobile`.
- TILE half lands immediately on the chip edge — `stepUltraGate` re-runs
  `applyQualityTier(activeQualityTier)`. Waiting for the governor would never fire: on a `high`
  machine it is a documented no-op.
- TIER PIN rides GlobeCanvas's existing FPV-deferred `pendingTier`. **`governor.force()` alone
  is NOT enough** — it only moves the index and resets hysteresis, so the next over-budget
  streak walks the tier back down. The governor keeps STEPPING (EMA stays honest); only its
  results are dropped, with an EXPLICIT re-seat to `deviceTier` on the OFF edge.
- `ultraTileLevers(base, false, …)` returns `base` **BY IDENTITY** → the off-proof is `toBe`.
  `lruCapBytesForUltra(t, mb, false, …)` is DEFINED as `lruCapBytesForTier` → the null-on-high
  "restore the library default" path is literally unchanged.
- **Measured round trip: OFF `SSE 16 / LRU 410 / floor 307` → ON `SSE 12 / LRU 600 / floor 450`
  → OFF byte-identical; `__overlayRebuilds` 0 across every flip.** The LRU raise is the one
  lever tier `high` can never pull; the floor travels with the cap (U2/A9).
- EXCLUDED, pinned by test: `dprCap` (inert behind `min(devicePixelRatio, …)`),
  `overlayResolutionPx` (one-way ratchet ⇒ un-undoable + QA-7b storm), shadows/AO/8k
  (construction-time), `foveation` (a cfg on high SOFTENS the periphery), queue caps (hitches).

### (c) HQ 3D MAP — BUILT IN FULL, MEASURED INERT, REMOVED. See T44.
Implemented as designed (bounded `SphereRegion` on its own `LoadRegionPlugin`, never widening
`mapFlatNow()`); verified attached at the view focus 18 km out on a 72° tilt, right radius,
`mapFlat` still false. **Zero extra tiles at 895 m AND at 5,969 m.**
**The control that settles it: forcing the GLOBAL `errorTarget` to 0.05 ALSO produced zero.**
The ground is availability-capped (Esri z19 + patch L13) and `GROUND.errorNearAlt` is **60 km**,
so below that the 3D target already sits at its finest (2). **Desktop has NO unspent
imagery-refinement headroom — the premise "the 2D chart holds detail the 3D view lacks" is
false.** Independently corroborates T43 §1.1: tilted blur is grazing-angle minification
(`generateMipmaps=false`, `anisotropy=1`; `getMaxAnisotropy()` measured **16** available).
A chip measured to do nothing is a decoration → removed. The lever that WOULD deliver it is
anisotropy = T43 slice S1, and gating S1 behind a re-instated HQ chip lets it land opt-in.

### (d) `.ct-vec.is-on` — a pre-existing bug fixed in passing
`ct-vec` appeared nowhere under `src/styles/**`: the VEC chip has had NO lit state since it
shipped 2026-08-21. The by-hand lit group in `camera-tilt.css` has now bitten twice (PLC first)
and carries a comment saying so.

### (e) THE BUG ONLY THE BROWSER COULD FIND
`let ultraOn` declared beside the shell gate put it in the **TDZ** for `applyQualityTier`, which
is called at ATTACH time hundreds of lines earlier → `ReferenceError: Cannot access 'ultraOn'
before initialization`, the whole tileset failing to attach. GlobeCanvas's `.catch` logs that as
a console.**WARN**, so the app silently rendered the procedural placeholder and every `error`-level
console read came back clean. `astro check` cannot see TDZ across a closure. **When a globe
change "does nothing", read console.warn before anything else.**

### The mobile fence (both toggles were designed against it)
The prefs blob is ONE shared localStorage key, the store is one store, and /m mounts the SAME
GlobeCanvas + StylizedTiles. So hiding a chip isolates NOTHING. The fence is one predicate,
`hqAllowed = !isMobileShell && !coarsePointerShell`, and every engine read sits on a line that
also names it. `fences.test.ts` pins BOTH halves (which files may name the flag; every read
guarded) and was **adversarially verified to fail** by temporarily adding a read in
`components/mobile/FpvControls.tsx`.

## 6. OWNER ORDER 2026-08-22i (end of session) — the NEXT session is SINGLE-TRACK

*"Schedule whatever it takes (T44, anisotropy etc) … to bring that crisp 3d high fidelity
textures look in 3d"* + a NEW ask: **ULTRA shadows pushed to the limit** — crisper, more
physically accurate building shadows, better sunrise/sunset/moonlight, and **terrain casting
shadows**. No ray tracing. Same standing rules: desktop only, experimental, opt-in, off by
default, zero prod/mobile disruption.

**Entry point: `.claude/claude-docs/ULTRA_PLAN.md`.** Backlog **T44** (textures) + **T45**
(shadows).

**The unlock, from the owner's own two words:**
- *"very grayish"* = the PHOTOGRAPHIC GRADE. `photo = uFtwFlat2d * uFtwPhotoK * (1-uFtwDark)`
  at `imageryGround.ts:377` is what makes the chart bright, and it is **separable** from
  `dayK = max(dayK, uFtwFlat2d)` at `:372`, which is the one that would delete the terminator.
  Drive `photo` from a NEW uniform (declared in BOTH `shader.uniforms` and the fragment header
  block `:326-353`, or it is a silent compile fail) and day/night stays real. This is the half
  the 2026-08-22i session refused wholesale — it was right to refuse `dayK`, wrong to bundle them.
- *"less resolution"* = ANISOTROPY, and it is NOT tile depth. Settled by measurement — see §5(c).

`mem:core` · `mem:project/wip-2026-08-18-u7b-glo30-terrain-buildings-rule` (the first bake) ·
`.claude/claude-docs/BAKED_ASSETS.md` (canonical) · DECISIONS §Recent 2026-08-22h + 2026-08-22i · backlog T43 (FPV audit) + T44 (HQ 3D MAP).
