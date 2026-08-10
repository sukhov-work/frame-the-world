# mem:project/wip-2026-08-10-astro-engine-phase-bde — phases B+D+E + constellations SHIPPED

All remaining `ASTRO_ENGINE_PLAN.md` phases in one session (investigate-design-v3 implement mode,
Deep). Gates: **vitest 701/701 (+27) · astro check 0/0 (hints at baseline 6) · wix build Complete
· browser-VERIFIED in a VISIBLE window** (own wix dev + own headed Chrome on CDP :9222; shots
`verify-shots/astroB-01…04*.jpeg` — the 500 mm Saturn is the flagship). Full narrative:
DECISIONS 2026-08-10 line.

## B · Data — ONE lazy chunk (424 KB), boot untouched
- Sources baked: full OpenNGC (13,263 → `public/data/openngc.bin`, 20 B/record + `ngcNames.ts`
  tables) · 451 IAU WGSN star names (`starNames.ts` — own RA/Dec, NO bsc5 re-bake; 333 with HR)
  · 88 constellations (`constellations.ts` + `public/data/constellation-lines.json`, all 88
  figures) · 952 MPC comets (`comets.ts`; 10P skipped — hand-baked lightcurve profile stays) ·
  337 SBDB asteroids (`asteroids.ts`; numbered, H<9, a<6, **full-prec=1** — default 4-digit
  elements cost 10–15″; G=0.15 default for 246).
- Search: fuzzy index 1,947 entries; the anonymous 13k NGC/IC reachable ONLY via the pattern
  branch (`openngc.ts searchNgcById`) — keeps queries from drowning in field galaxies. Greek
  bayer expansion: **IAU-CSN uses "alf"/"tet"/"ksi" (browser-caught — NOT "alp")**; `GREEK_ABBR`
  in catalog.ts covers the 24 baked forms + constellation genitive keys ("alpha lyrae"→Vega).
- Long tail: `simbad.ts` (CDS sync TAP, CORS `*`, cached 30d/1d, in-flight dedupe) + `sbdb.ts`
  behind `/api/sbdb` (phase-A zero-caller tail wired). **SBDB TRAP: no `phys_par` without
  `phys-par=1`** (relay allowlist widened) — 2024 YR4 parsed H-less until then. Fallback fires
  debounced (600 ms) on empty local rows OR designation-shaped query without an EXACT local key
  match (2024 YR4 drowned under the C/2024 R4 typo family — 2nd browser catch);
  `looksLikeSmallBody` lives in boot-safe searchIndex.ts.
- Persistence: `skyTargetId` pref; store/sky restores AFTER boot via requestIdleCallback +
  `targetByIdAsync` (ngc: awaits the bin; simbad:/sbdb ids resolve from their caches).
  Browser-verified across reload with ngc:NGC7000.
- **Lazy contract now MACHINE-GUARDED**: `test/lib/sky/lazyContract.test.ts` walks src/ and
  fails on static imports of heavy sky modules outside lib/sky; also verified in dist/ (only
  dynamic import() references the catalog chunk).

## Kepler propagator — universal-variable (comet.ts)
- `perifocalAt`: Stumpff c2/c3, perihelion-anchored (q/e/Tp only), one path for every conic;
  elliptic wraps Δt to nearest perihelion; Newton safe (dF/dχ = r > 0).
  **TRAP (caught by the 10P Horizons fixtures): Vallado's α = 1/a — folding μ in corrupts
  ψ = αχ²** (0.23° @ 2 months, aphelion 9.06 vs 4.71 AU).
- `CometElements` split: brightness-free **`KeplerElements`** base (asteroids ride it) + m1/k1
  extension. `CometProfile.nucleusKm/rotationHours/discovery` now nullable (MPC rows);
  `nextPerihelionMs` → null for e ≥ 1. `cometShortDesignation` FIX: "C/1995 O1 (Hale-Bopp)" →
  "C/1995 O1" (old split("/") gave "C").
- **`hgMagnitude`** — IAU (H,G) Bowell 1989 (3.33/0.63/1.87/1.22, α from the r/Δ/R triangle);
  `magnitudeModel:"hg"`; `asteroidTarget` provider + `smallBodyGeometryAt` (extracted light-time
  geometry shared with cometStateAt).
- Horizons-locked @2026-08-10 00:00 UT (`test/lib/sky/phaseB.test.ts`): Ceres ≤30″ ±0.2 mag ·
  Vesta ≤30″ · Hale-Bopp (e=0.9949, Δ=50.6 au) ≤2′ · Encke ≤2′.

## D · Render (scene/skyTarget.ts uMode 3 + stars)
- Planet disc: moon-lambert on the billboard; `uSunLocal` = sun in billboard basis (+Y =
  projected celestial north ⇒ true terminator orientation); radius floored
  `SKY_TARGET.planetDiscMinDeg` 0.4° (true size wins at long focal — 500 mm FPV shows it).
- Saturn ring: real pole (`saturnRingPoleDir` in targets.ts through ecefFrameAt); uRing =
  (rot cos/sin, SIGNED sin B, enable); 2026 is near edge-on (sin B ≈ −0.16); pole-side arm masks
  behind the disc (near arm crosses in front — verified in the flagship shot); Cassini dip baked;
  `SKY_TARGET.ringGain` 0.55.
- Star colour: `bvToRgb` (Ballesteros 2012 temp + blackbody sRGB, max-normalized) → `aTint`
  attribute at catalog swap, blend `STARS.bvTintAmount` 0.6. Geometry-probed live: 9,096 stars,
  7,609 clearly tinted, r∈[0.82,1] b∈[0.69,1].
- Constellation kind (net-new): fixed target at figure centre + **figure highlight** — tracked
  constellation's lines render accent (`stars.update({constellation})`, lazy 88-figure asset,
  `figureSegmentsByAbbr` in asterisms.ts, `ASTERISMS.highlightAlpha` 0.55, gated TARGET SHOW).

## E · Planner skyline verdict
- planner.ts: `sampledSkylineState` (injected az/alt sampler — the scanWindows move; sun/moon
  wrapper output test-locked) + `targetSkylineState` via targetAzAlt (same face as marker/panel).
- planFeed: third row gated by TARGET SHOW; target-swap invalidates the scan; mirrored as
  `store/plan.target` (`PlanTargetState` + id/label/glyph). PlanPanel row + TargetPanel
  SKYLINE CLEAR / BEHIND SKYLINE badge. Verified both branches (Saturn CLEAR + HIDES · Orion
  BEHIND + CLEARS).

## Verify session notes
- Own `wix dev` + own headed Chrome (`--remote-debugging-port=9222 --user-data-dir
  ~/Playwright_Chrome_data`) → `/json/activate/<id>` → document.hidden false, everything lands
  in seconds. Playwright MCP screenshot paths must stay INSIDE the repo (verify-shots/...).
- FPV for high-altitude targets: orbit tilt cap keeps them above frame — temp pin
  (`setTempPin` + `setTempFpv(true)`) + `requestSkyLook({azDeg,altDeg})` centres exactly; FPV
  focal zoom via wheel events on the canvas (no native range inputs — custom sliders).
- WATCH: one non-converged auto-aim glide during rapid consecutive re-tracks (direct
  requestSkyLook exact; not reproduced in isolation).

## Tails
- `/api/sbdb` on Wix CLOUD UNVERIFIED (dev-verified incl. phys-par; rides the next release).
- Owner taste-pass: ringGain · highlightAlpha · bvTintAmount · trail weight (carried).
- Galilean-moon points on the Jupiter disc unbuilt (render-table wish).

Related: [[project/wip-2026-08-03-astro-engine-phase-c]] [[project/wip-2026-08-03-astro-engine-phase-a]]
[[patterns/sky-bodies-terrain]] [[bugs/comet-magnitude-model]]
