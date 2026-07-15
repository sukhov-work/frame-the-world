# WIP 2026-07-15 — pre-Phase-6 UI/UX batch (4 owner tasks) — SHIPPED (browser-VERIFIED)

**Mode:** implement/Deep (/frame + investigate-design-v3). **Gates: vitest 573/573 (+25 over the
548 baseline) · astro check 0/0 · wix build Complete · browser-VERIFIED via scripted
headless-Chrome CDP** (extension bridge down). Shots: `verify-shots/prephase6-a1..a2` (PIN chip),
`b1` (sun 275 mm sunset — disc slices at the true horizon, no razor line, no sky seam), `b2`
(moon 229 mm — clean), `c1..c3` (Milky Way Cygnus 55°/25° + bulge over the skyline), `d1..d3`
(SAVE PLACE input · PLACES tab · jumped-into-place). DECISIONS.md 2026-07-15 batch line = the
full narrative; this memory carries the mechanics.

## 1 · Milky Way haze (scene/stars.ts + tuning.MILKYWAY)
- Asset: NASA/GSFC SVS **Deep Star Maps 2020 Milky-Way-only** layer (svs.gsfc.nasa.gov/4851;
  Gaia DR2 with bright Hipparcos/Tycho stars REMOVED → zero BSC5 doubles; effectively public
  domain, credit line added to index.astro attribution). Pipeline (offline, reproducible):
  `milkyway_2020_4k.exr` (36 MB) → cv2 linear→sRGB + ±0.5 LSB dither → 4096×2048 JPEG q92 →
  `public/textures/milkyway-2020.jpg` (2.9 MB). **Landmark-verified mapping** (cv2 peak-find):
  photometric bulge px (3064,1351) vs Sgr A* projection (3113,1354); LMC (1140,1815) vs (1128,1817).
- Render: inward `SphereGeometry(1,48,24)` CHILD of the star `Points` (inherits −GAST rotation +
  camera-follow + scale ⇒ auto-aligned with BSC5 — Cygnus asterism sits ON the Great Rift in c1).
  Per-fragment dir→RA/Dec: object-space position IS the J2000 direction; `u = 0.5 − ra/2π`
  (SVS "sky convention": RA 0h centred, RA increasing LEFT), `v = 0.5 + dec/π`.
  **Seam/pole traps solved**: RepeatWrapping absorbs the RA wrap (no fract), mips OFF
  (LinearFilter) so the wrap has no derivative artifact, per-fragment math = no pole pinch.
  Additive + DITHER_GLSL + uFade (same alt/night fade as stars) + true-horizon fade.
- Tunables: `hazeTexture · hazeGain 1.0 · narrowFovLoDeg 8 / narrowFovHiDeg 35 / narrowFovFloor
  0.22` — **fovK attenuates the DIFFUSE layers (haze + procedural sparkle) at long focal lengths,
  never the real BSC5 stars**: at 250–300 mm the 4k map magnifies ~15× (unresolved-star speckle →
  soft blobs, seen live on b2/c2 first pass) and sparkle points would pose as fake stars.
  Points retuned: `MILKYWAY.alpha 0.35 → 0.14` (sparkle riding the texture haze).
- Test: `test/components/globe/milkyWayHaze.test.ts` — UV twin must exactly invert `raDecToUnit`
  (stars and haze share one frame) + landmark px projections. KEEP IN SYNC with the shader.

## 2 · True-horizon occlusion rework (scene/{sky,atmosphere,stars}.ts) — the FPV razor cut
- **ROOT CAUSE (owner screenshots, 250–300 mm FPV):** old `horizonFade` = smoothstep over
  closest-approach altitude vs a SPHERE of radius **WGS84_A** — at 48°N the real surface is
  ~11.9 km BELOW that radius → every below-horizontal ray pinned to fade 0, and the `tc<=0`
  guard pinned above-horizontal to 1 → **binary cut exactly at 0° geocentric elevation**, ~0.3°
  above the true horizon. The atmosphere sky regime had a matching C1 kink at sinEl=0 (haze
  slope jump 1/0.075 vs 1/0.08 + zenith `pow(x,0.55)` infinite slope at 0⁺) = the full-frame seam.
- **FIX — angular fade vs the TRUE ellipsoid horizon.** `scene/sky.ts` exports the CPU twins:
  `horizonTerms(camPos, outUp)` → scaled-space up + horizon elevation sine (ellipsoid-scaled
  space x,y÷a z÷b — tangency is EXACT under the linear map, angle distortion ≤ flattening;
  float64 on the CPU because float32 near r≈1 makes the dip noisy) and `horizonBandSin(alt)`
  (street 0.08° ↔ orbit 0.6° over SKY.horizonFadeAltLoM 50 km → HiM 600 km; orbit width
  reproduces the old ~0.6°-equivalent 40 km limb melt). Shader: ONE smoothstep over
  `dot(Ds, uHorizonUp)` with shared uniform holders (sun + moon reference the same {value}s).
  `sky.update` now takes `alt` (orchestrator's shared geodetic sample — tunables contract).
- Stars + MW haze got the SAME fade (uniforms in makeStarMaterial vertex + haze fragment) —
  bodies and stars sink at ONE line (pre-fix, stars leaked below the horizon over the untiled gap).
- Atmosphere regime re-anchored at the true horizon: `sRel = dot(Ds,uHorizonUp) − uSinHor`;
  zenith ramp `pow(smoothstep(0,1,sRel), skyZenithPow)` (C1 — zero slope at the horizon); haze
  crest `exp(−(softabs(sRel))/τ(sRel))` with `ATMOSPHERE.skyHazeSoft 0.01` — **crest value stays
  exactly 1 → the skyBudget bloom guard is arithmetically unaffected** (test untouched, passes).
- `SKY.horizonFadeBandM` superseded/removed. DayArcs fade by astronomical altitude — untouched.
- Test: `test/components/globe/horizonFade.test.ts` — dip ≈ √(2h/R) at 95 m (−0.31°), LEO limb
  ∈ (−0.56,−0.5), sub-surface camera safe (−0 nit!), gradient EXISTS mid-band (pins the regression).

## 3 · Saved places (photo-less FPV bookmarks, members)
- **Collection `SavedPlaces`** (provision-collections.mjs; ADMIN everything like Photos;
  **provisioned live 2026-07-15**): title · ownerMemberId(req) · lat/lon · eyeM · headingDeg ·
  pitchDeg · fovDeg · timeMs (null = live). C6-safe: member-private exact pose, never published.
- `lib/wix/placeRecords.ts` (pure): `SavePlaceBody = UrlFpvPose + timeMs`, SAME clamp bands as
  urlPose.ts (eye 0.5–10k, pitch ±89, fov 1–120, time < year-3000) — one contract with `#f=`.
  `PLACE_QUOTA 50` (simple cap, no pricing-plan tie-in). `placeListItem` drops incomplete-pose rows.
- `/api/places` GET/POST/DELETE mirrors photos.ts (requireMember → 401 · parse → 400 · quota →
  402 · elevate → 502; ownedPlace guard on DELETE).
- **UI:** MyPins.tsx → tab strip `MY PINS | PLACES` (`.mp-tabs/.mp-tab`, fetch-per-open per tab,
  ◎ `.mp-thumb--place` rows, `lat°, lon° · MM · ⏱`, two-press delete). **SAVE PLACE** =
  `SavePlaceControl` in CameraTiltPanel (any FPV, members only): button → inline input (Enter
  saves, Escape cancels; **keydown stopPropagation so FPV walk-arrows/Escape-exit never fire
  while typing**); pose from the SAME mirrors the hash writer uses (`fpvHud` bearings/fov/eye +
  `camGeo` lat/lon); `timeMs = live ? null : sceneTimeMs()` (LIVE never persisted — the &t= rule).
- **Jump seam:** `camera.fpvJumpRequest: UrlFpvPose | null` + `requestFpvJump/_consumeFpvJump`.
  Orchestrator (stepFpvTransitions, BEFORE wantKind): consume → `pendingFpvShare = jump` →
  photo-FPV yields via setViewMode("orbit") → **`fpvKind = null` forces re-entry when already in
  temp FPV** (direct re-pose, no fly-out) → setTempPin + setTempFpv(true) → re-snapshot stores →
  the normal temp-entry branch consumes the share EXACTLY like a `#f=` boot. Jump restores time
  (setTime/goLive) then requests. Verified: orbit→place exact (heading 351.8/fov 55.0/eye 1.7),
  FPV→FPV re-jump exact (90.0/40.0).
- **Member verification recipe refinements** (vs mem:patterns/members-pins): the OAuth allowlist
  admits ONLY `/api/auth/callback` paths as redirectUri (NOT "/") — harvest the code from the
  redirect Location, never navigate; `.env.local` `WIX_CLIENT_ID` is QUOTED — strip quotes.
  Script: `scripts/verify-places-member.mjs` (mint tokens → wixSession cookie → full UI drive).
- **Watch: `WDE0054: Unknown Error`** from Wix Data intermittently on the minutes-old collection
  (list AND insert) — endpoint code correct (every path green ≥2× with server-state confirmation);
  script hardened with id-keyed polling + unique per-run titles (reads lag writes).

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

## Verification ops (scripted headless-Chrome CDP — extension bridge was down)
- `scripts/verify-prephase6-uiux.mjs` (A: chip/FPV dance asserts · B: sun/moon horizon shots at
  computed rise/set instants via astronomy-engine · C: Milky Way shots at Deneb/galactic-centre
  bearings) + `verify-places-member.mjs` (member flow). Chrome:
  `--headless=new --remote-debugging-port=9333`; **needs Node ≥22 for global WebSocket** (used
  nvm v24.10.0; system node is 20). **TRAP: hash-only Page.navigate does NOT reload** (no
  hashchange listener in the app) — bounce through about:blank between `#f=` boots.
- **Vite dep-cache stale after heavy edit sessions**: ALL islands fail with "Failed to fetch
  dynamically imported module" while curl serves them fine → restart `wix dev` (new symptom of
  the known trap).

## Files touched
`src/store/camera.ts` (pinsVisible + fpvJumpRequest) · `src/components/globe/Pins.ts`
(setVisible/pick gate) · `StylizedTiles.ts` (jump consume · wasFpvActive · pins gate + FPV dance ·
sky.update alt) · `scene/sky.ts` (horizonTerms/horizonBandSin + angular fade) · `scene/atmosphere.ts`
(sRel regime) · `scene/stars.ts` (star/MW horizon fade + haze mesh + fovK) · tuning (SKY horizon* ·
ATMOSPHERE.skyHazeSoft · MILKYWAY haze*/narrowFov*) · `CameraTiltPanel.tsx` (PIN chip +
SavePlaceControl) · `MyPins.tsx` (tabs + places) · styles camera-tilt/my-pins ·
`lib/wix/placeRecords.ts` · `pages/api/places.ts` · `scripts/provision-collections.mjs` ·
`index.astro` (attribution) · `public/textures/milkyway-2020.jpg` · tests horizonFade/milkyWayHaze/
placeRecords/camera · scripts verify-prephase6-uiux/verify-places-member.

## Owner refinement pass (same day, 2026-07-15 — 8K + subtler + star punch + sky embed; browser-VERIFIED, wix build Complete)
- **8K texture** (`milkyway_2020_8k.exr` → 8192×4096 JPEG q90, **6.4 MB**, same filename).
  **TRAP (cost 2 bakes): the SVS star maps are FLUX-PER-PIXEL, not surface brightness** — the 8k
  per-pixel values are exactly ¼ the 4k's (patch-measured ratio 4.0) → bake with ×4 linear gain.
  **Second trap: flux hides in sub-texel star speckle** — with mips OFF (the RA-wrap safety) the
  renderer point-samples, and under the mild minification of wide FOVs it SKIPS the speckle →
  the band went near-black at 55°. Fix: **gaussian pre-blur σ=1 texel in LINEAR space before
  encoding** (redistributes flux so point sampling integrates; haze stays haze; JPEG shrinks
  13→6.4 MB). Post-bake check: linear PATCH means match the 4k bake within 1% at 3 landmarks —
  single-pixel comparisons mislead on speckle content, always compare patch means.
- Subtler: `hazeGain 1.0 → 0.8`.
- Star punch: `STARS.sizeGamma 0.35 → 0.42` + `sizeMax 5 → 6.5` — steeper flux→size hierarchy;
  first-magnitude stars read THROUGH the band, the mag-4+ tail barely moves.
- **Sky embed — atmospheric extinction on the DIFFUSE layers** (`MILKYWAY.extinctionBandDeg 16 ·
  extinctionFloor 0.22 · extAltLoM 20k · extAltHiM 150k`): haze + procedural sparkle dim from
  the floor at the true horizon to full by ~16° above it (band baked via glf; floor is a per-frame
  uniform `uExtFloor` lifted to 1 with camera altitude — no extinction from orbit). Catalog stars
  keep an inert floor 1 (punch preserved). The band now melts into the horizon sky instead of
  riding on top of it (shot c3: bulge fades into the skyline naturally).
- GPU note: 8k RGB ≈ 134 MB VRAM (no mips) vs 33 MB at 4k — fine on M3; mobile memory pass may
  want a quality-tier fallback to the 4k bake (kept at `/tmp/mw/milkyway-2020.jpg` this session
  only — re-derivable from the EXR pipeline above).

## UNVERIFIED / carried
- WDE0054 transients on SavedPlaces (watch on first real member use; likely fresh-collection
  propagation).
- Milky-way haze look on a real display/DPR>1 (headless shots only); owner may want hazeGain or
  narrowFovFloor retuned to taste. 8k texture upgrade possible (137 MB EXR → ~8 MB JPEG) if 4k
  reads soft on wide FOV.
- Saved-places quota UX (silent 402 at 50 — no upgrade path needed per design).
- Release: live URL still serves the pre-batch build (`wix release` not run this session).

Related: [[patterns/sky-bodies-terrain]] [[patterns/members-pins]] [[patterns/globe-rendering]]
[[project/wip-2026-07-14-uiux-qol-batch]] [[decisions/session_workflow]]
