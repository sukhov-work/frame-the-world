# WIP 2026-07-15 — pre-Phase-6 UI/UX batch (4 owner tasks) — SHIPPED (browser-VERIFIED) (compacted 2026-09-06 from 12,955 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-08-15)

**Gates: vitest 573/573 (+25) · astro check 0/0 · wix build Complete · browser-VERIFIED via
scripted headless-Chrome CDP.** Shots `verify-shots/prephase6-a1..d3`.

## 1 · Milky Way haze (scene/stars.ts + tuning.MILKYWAY)
- Asset: NASA/GSFC SVS **Deep Star Maps 2020 Milky-Way-only** layer (svs.gsfc.nasa.gov/4851 — Gaia
  DR2 with the bright Hipparcos/Tycho stars REMOVED, so zero BSC5 doubles; credit line in
  index.astro). Pipeline (offline, reproducible): the EXR → cv2 linear→sRGB + ±0.5 LSB dither →
  JPEG → `public/textures/milkyway-2020.jpg`. **Landmark-verified mapping** by cv2 peak-find against
  the Sgr A* and LMC projections.
- Render: an inward `SphereGeometry(1,48,24)` CHILD of the star `Points`, so it inherits the −GAST
  rotation, camera-follow and scale and is auto-aligned with BSC5. Per-fragment dir→RA/Dec: the
  object-space position IS the J2000 direction; `u = 0.5 − ra/2π` (SVS sky convention: RA 0h
  centred, increasing LEFT), `v = 0.5 + dec/π`. **Seam and pole traps solved by** RepeatWrapping
  absorbing the RA wrap (no `fract`), mips OFF so the wrap has no derivative artifact, and
  per-fragment math so there is no pole pinch.
- Tunables: `hazeGain` · `narrowFovLoDeg 8` / `narrowFovHiDeg 35` / `narrowFovFloor 0.22` —
  **fovK attenuates the DIFFUSE layers (haze + procedural sparkle) at long focal lengths, never the
  real BSC5 stars**, because at 250–300 mm the map magnifies ~15× into soft blobs and sparkle points
  would pose as fake stars. `MILKYWAY.alpha` retuned 0.35 → 0.14.
- Test `test/components/globe/milkyWayHaze.test.ts`: the UV twin must exactly invert `raDecToUnit`
  (stars and haze share one frame). KEEP IN SYNC with the shader.

## 2 · True-horizon occlusion rework (scene/{sky,atmosphere,stars}.ts) — the FPV razor cut
- **ROOT CAUSE (owner screenshots, 250–300 mm FPV):** the old `horizonFade` smoothstepped over
  closest-approach altitude against a SPHERE of radius **WGS84_A** — at 48°N the real surface sits
  ~11.9 km below that radius, so every below-horizontal ray pinned to fade 0 while the `tc<=0` guard
  pinned above-horizontal to 1: **a binary cut at exactly 0° geocentric elevation**, ~0.3° above the
  true horizon. The atmosphere sky regime had a matching C1 kink at sinEl = 0.
- **FIX — angular fade vs the TRUE ellipsoid horizon.** `scene/sky.ts` exports the CPU twins
  `horizonTerms(camPos, outUp)` (scaled-space up + horizon elevation sine — tangency is EXACT under
  the x,y÷a z÷b linear map, and the CPU works in float64 because float32 near r≈1 makes the dip
  noisy) and `horizonBandSin(alt)` (street 0.08° ↔ orbit 0.6° over `SKY.horizonFadeAltLoM 50 km` →
  `HiM 600 km`). The shader is ONE smoothstep over `dot(Ds, uHorizonUp)`, with sun and moon sharing
  the uniform holders. `sky.update` now takes `alt` from the orchestrator's shared geodetic sample.
- Stars and the Milky Way haze got the SAME fade, so bodies and stars sink at ONE line (before the
  fix, stars leaked below the horizon over the untiled gap).
- The atmosphere regime is re-anchored at the true horizon: `sRel = dot(Ds,uHorizonUp) − uSinHor`,
  zenith ramp `pow(smoothstep(0,1,sRel), skyZenithPow)` (C1 — zero slope at the horizon), haze crest
  `exp(−softabs(sRel)/τ(sRel))` with `ATMOSPHERE.skyHazeSoft 0.01`. **The crest value stays exactly
  1, so the skyBudget bloom guard is arithmetically unaffected.**
- `SKY.horizonFadeBandM` is superseded and removed. Test:
  `test/components/globe/horizonFade.test.ts` — dip ≈ √(2h/R) at 95 m (−0.31°), LEO limb in
  (−0.56, −0.5), sub-surface camera safe, and a gradient EXISTS mid-band (that pins the regression).

## 3 · Saved places (photo-less FPV bookmarks, members)
- **Collection `SavedPlaces`** (ADMIN everything like Photos; provisioned live 2026-07-15): title ·
  ownerMemberId · lat/lon · eyeM · headingDeg · pitchDeg · fovDeg · timeMs (null = live). C6-safe:
  a member-private exact pose, never published.
- `lib/wix/placeRecords.ts` (pure): `SavePlaceBody = UrlFpvPose + timeMs`, SAME clamp bands as
  urlPose.ts (eye 0.5–10k, pitch ±89, fov 1–120, time < year-3000) — one contract with `#f=`.
  `PLACE_QUOTA 50` (simple cap, no pricing-plan tie-in). `placeListItem` drops incomplete-pose rows.
- `/api/places` GET/POST/DELETE mirrors photos.ts (401 / 400 / 402 / 502; ownedPlace guard on DELETE).
- **UI:** MyPins.tsx gained a `MY PINS | PLACES` tab strip (fetch per open per tab, two-press
  delete). **SAVE PLACE** = `SavePlaceControl` in CameraTiltPanel (any FPV, members only): button →
  inline input, **with keydown stopPropagation so FPV walk-arrows and Escape-exit never fire while
  typing**. The pose comes from the SAME mirrors the hash writer uses; `timeMs = live ? null :
  sceneTimeMs()` (LIVE is never persisted — the `&t=` rule).
- **Jump seam:** `camera.fpvJumpRequest: UrlFpvPose | null` + `requestFpvJump/_consumeFpvJump`.
  In `stepFpvTransitions` (BEFORE `wantKind`): consume → `pendingFpvShare = jump` → photo-FPV yields
  via `setViewMode("orbit")` → **`fpvKind = null` forces re-entry when already in temp FPV** (direct
  re-pose, no fly-out) → setTempPin + setTempFpv(true) → the normal temp-entry branch consumes the
  share EXACTLY like a `#f=` boot. Verified exact both from orbit and FPV→FPV.
- **Member verification recipe refinements** (vs `mem:patterns/members-pins`): the OAuth allowlist
  admits ONLY `/api/auth/callback` paths as `redirectUri` (NOT "/") — harvest the code from the
  redirect Location, never navigate; `.env.local`'s `WIX_CLIENT_ID` is QUOTED, so strip the quotes.
  Script: `scripts/verify-places-member.mjs`.
- **Watch: `WDE0054: Unknown Error`** from Wix Data, intermittently on a minutes-old collection
  (list AND insert). The endpoint code was correct; the script was hardened with id-keyed polling
  and unique per-run titles, because reads lag writes.

## 4 · PIN visibility chip
- `camera.pinsVisible` (+`setPinsVisible`) → orchestrator `pins.setVisible(camNow.pinsVisible)`
  in stepPinsUpdate → `PinsHandle.setVisible()`: hidden = the `pins.length===0` branch (all three
  meshes hidden + early-return = zero per-frame matrix work; `dirty=true` on re-show) AND
  `pick()` returns null (covers click + hover in one seam — three's raycast ignores .visible).
- Chip `.ct-pins` in CameraTiltPanel between SAT and BLD (SAT store-toggle idiom).
- **FPV default-off dance:** entry captures `pinsVisibleBeforeFpv` + hides; exit restores UNLESS
  the chip was re-lit inside FPV (no-op restore). **TRAP (hit live, fixed): the entry branch sets
  `fpvActive = true` BEFORE the guard ran — capture `wasFpvActive` BEFORE the transition
  branches** or an FPV→FPV jump wipes the restore memory. Viewport queries keep running while
  hidden → instant re-show.

## Verification ops (scripted headless-Chrome CDP)
`scripts/verify-prephase6-uiux.mjs` + `verify-places-member.mjs`. Chrome
`--headless=new --remote-debugging-port=9333`; **needs Node ≥22 for a global WebSocket**.
**TRAP: a hash-only `Page.navigate` does NOT reload** (the app has no hashchange listener) —
bounce through about:blank between `#f=` boots. **Vite dep-cache stale after heavy edit sessions**:
all islands fail with "Failed to fetch dynamically imported module" while curl serves them fine →
restart `wix dev`.

## Files touched
`store/camera.ts` (pinsVisible + fpvJumpRequest) · `globe/Pins.ts` · `StylizedTiles.ts` ·
`scene/{sky,atmosphere,stars}.ts` · `tuning.ts` (SKY horizon*, ATMOSPHERE.skyHazeSoft, MILKYWAY
haze*/narrowFov*) · `CameraTiltPanel.tsx` · `MyPins.tsx` · styles camera-tilt / my-pins ·
`lib/wix/placeRecords.ts` · `pages/api/places.ts` · `scripts/provision-collections.mjs` ·
`index.astro` · `public/textures/milkyway-2020.jpg` · tests horizonFade / milkyWayHaze /
placeRecords / camera · scripts verify-prephase6-uiux / verify-places-member.

## Owner refinement pass (same day, 2026-07-15 — 8K + subtler + star punch + sky embed; browser-VERIFIED, wix build Complete)
- **8K texture** (8192×4096 JPEG q90, 6.4 MB, same filename). **TRAP, cost 2 bakes: the SVS star
  maps are FLUX-PER-PIXEL, not surface brightness** — the 8k per-pixel values are exactly ¼ the
  4k's, so bake with ×4 linear gain. **Second trap: flux hides in sub-texel star speckle** — with
  mips OFF (the RA-wrap safety) the renderer point-samples and, under the mild minification of wide
  FOVs, SKIPS the speckle, so the band went near-black at 55°. Fix: a **gaussian pre-blur σ=1 texel
  in LINEAR space before encoding**, which redistributes flux so point sampling integrates.
  Post-bake check: compare linear PATCH means (single-pixel comparisons mislead on speckle).
- Subtler: `hazeGain 1.0 → 0.8`.
- Star punch: `STARS.sizeGamma 0.35 → 0.42` + `sizeMax 5 → 6.5` — steeper flux→size hierarchy;
  first-magnitude stars read THROUGH the band, the mag-4+ tail barely moves.
- **Sky embed — atmospheric extinction on the DIFFUSE layers** (`MILKYWAY.extinctionBandDeg 16` ·
  `extinctionFloor 0.22` · `extAltLoM 20k` · `extAltHiM 150k`): haze and procedural sparkle dim from
  the floor at the true horizon to full by ~16° above it, with `uExtFloor` lifted to 1 by camera
  altitude so there is no extinction from orbit. Catalog stars keep an inert floor of 1.
- GPU note: 8k RGB ≈ 134 MB VRAM without mips, vs 33 MB at 4k. A mobile memory pass may want a
  quality-tier fallback to the 4k bake — re-derivable from the EXR pipeline above.

## UNVERIFIED / carried
- WDE0054 transients on SavedPlaces (likely fresh-collection propagation; watch on first real use).
- Milky-way haze on a real display at DPR > 1 (headless shots only); `hazeGain` and
  `narrowFovFloor` are the taste knobs.
- Saved-places quota UX (a silent 402 at 50 — no upgrade path, by design).

Related: [[patterns/sky-bodies-terrain]] [[patterns/members-pins]] [[patterns/globe-rendering]]
[[project/wip-2026-07-14-uiux-qol-batch]] [[decisions/session_workflow]]
