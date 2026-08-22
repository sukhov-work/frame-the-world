# WIP 2026-08-22k — ECLIPSES (solar occlusion + corona + world darkness · lunar umbra · panels)

Owner ask: "properly simulate eclipses (both solar and moon), from visual perspective… moon to
naturally occlude and diminish the sun (ideally leaving the corona and simulating world darkness)…
Moon eclipses should just change colour of the moon to red/yellow… Also add (for sun and moon only)
properties panel predicted eclipses section (both desktop and mobile)."

Repro: `#f=42.354484,-3.698240,17.0,283.5,7.2,8.3&t=1786559722469` = **the real 2026-08-12 Spanish
totality from Burgos, 6 min past peak (88% covered, NOT totality — peak is t=1786559347887).**

## ROOT CAUSE — worse than the in-code comment claimed
`scene/sky.ts` documented it as a "cosmetic edge: a total solar eclipse would let the additive sun
wash through the disc". **Measured: the moon mesh was not washed out, it was DISCARDED.**
- By day `uDaySky → 1` ⇒ the disc runs its premultiplied ADDITIVE arm at **alpha 0**.
- During a solar eclipse the near side is a NEW MOON (illuminated fraction **8e-5**) ⇒ `lit ≈ 0`.
- Both fall under `SKY.moonAlphaDiscard` (0.03) ⇒ `discard`.
⇒ **No render-order / depth / blend change on the MOON can fix it. The sun must carve itself.**

## THE LOAD-BEARING FACT — the geometry must be TOPOCENTRIC
At the repro instant: **geocentric** sun/moon separation **1.006°** vs radii 0.263°/0.272° — the
discs DO NOT TOUCH. **Topocentric: 0.062° = 88% covered.** Lunar parallax (~1°) is the same order as
the entire phenomenon, so `bodyStatesAt().moonDir` (geocentric by contract, bodies.ts:5-9) reports
NO ECLIPSE during totality. The scene was already right by accident: `sky.ts` derives the moon
direction as `moonPos − camera.position`. Rendered separation (geocentric sun × topocentric moon)
sits **2.6″** from truth = 0.28% of a solar radius. **A "consistency cleanup" that geocentricised
the moon direction would destroy the whole feature.**

## NEW `src/lib/ephemeris/eclipse.ts` (pure, three-free)
- `discCoverage(sep, rA, rB)` — circle-circle lens area. Three regimes all reachable: disjoint 0 ·
  B swallows A → 1 · **A swallows B (ANNULAR) → the area ratio, never 1**.
- `solarEclipseFromDiscs(sep, rSun, rMoon)` (scene face) / `solarEclipseAt(ms, lat, lon, elev)`.
- `lunarEclipseFromState(BodyStates)` / `lunarEclipseAt(ms)` — Meeus ch.54 shadow cone in ANGULAR
  measure at the moon: `umbra = k(π_m + π_s − s_s)`, `penumbra = k(π_m + π_s + s_s)`,
  `k = SHADOW_ENLARGEMENT 1.02` (Danjon/Chauvenet 1/50 atmospheric enlargement).
  Umbra ≈ **2.7 lunar radii** ⇒ a partial phase shows a CURVED bite, not a straight edge.
- `nextSolarEclipses` / `nextLunarEclipses(fromMs, PlanObserver, count)` · `eclipseDaylightK`.
- `NO_LUNAR_ECLIPSE` exported so a consumer can seed without an ephemeris sample (see TDZ below).

**Almanac-validated** (`test/lib/ephemeris/eclipse.test.ts`, 23 tests): umbral coverage matches
astronomy-engine's own `obscuration` to **<0.003** across the 2025-28 lunar series; modelled umbral
magnitude crosses 1.0 at **06:26Z / 07:31Z** for 2025-03-14 — the published totality contacts to
the minute. Costs measured: **~6 ms per eclipse found** (5 solar = 30 ms, 5 lunar = 6 ms) ⇒ a
`useMemo` on a day bucket is enough; no worker.

## RENDER
- **Sun fragment** carves the moon in the BILLBOARD'S OWN PLANE: `uMoonOff` (vec2) + `uMoonR`, both
  in sun-disc radii. The plane is billboarded ⇒ its local axes ARE camera right/up, so the offset is
  two dot products — exact, and precise exactly where `acos(dot)` of two near-parallel world rays is
  mush. Plus halo falloff (`haloAtTotality`), a two-term corona gated `coverage 0.985→1` (keeps it
  out of every ANNULAR eclipse) and a chromosphere hairline.
- **Moon vertex** gains `vDisc = position.yz` — the mesh basis is (toward-camera, north, z), so
  object-space y/z ARE the offset across the visible disc in moon-radii. That is the frame
  `uUmbraOff`/`uUmbraR`/`uPenumbraR` arrive in ⇒ the real curved shadow edge + edge-brightening.
- **`moonMesh.renderOrder` 11 → 12.** Equal renderOrder falls through to a depth sort and both
  impostors sit at the SAME anchor distance (`camera.far × impostorFarFrac`) — their clip-space z
  differ by ~1e-6 and the winner FLIPPED with camera aim.
- `depthWrite` stays FALSE on the moon (the browser-measured FPV dark-frame trap) — untouched.

## WORLD DARKNESS — ONE scalar, `stepEclipse()`
New step **between `stepEphemerisResample` and `stepUltraLook`**. It CANNOT ride `sampleEphemeris`'s
1 Hz cadence (the geometry is camera-relative) and it MUST precede `stepKeyLightAndShadow` (which
would otherwise light the world with a frame-old eclipse). Consumers:
`sunLight.intensity` · `ground.setShadowStrength` · ground `uFtwEclipse` · atmosphere `uEclipse` ·
`stars` eclipse reveal · moon `uDaySky`.
- **Ground/earth are ALTITUDE-GATED** (`1 − skyPresence·(1 − eclipseK)`): being inside the umbra is
  a street-level truth; from orbit it is a ~100 km spot on a 12,700 km planet, so dimming the whole
  day hemisphere would be a bigger lie. **`baseEarth` deliberately NOT wired** for the same reason.
- Atmosphere's multiply sits INSIDE its low-altitude branch, so the orbital limb is untouched.
- **Stars: folded in BEFORE the `fade > 0.01` hard return** — downstream of it, it is unreachable.
- **LUNAR dimming multiplies `moonKs` AT THE SAMPLE** — the ONE write that reaches uMoonGlow,
  uFtwMoonGlow, the moon-shadow key light, ground shadow strength AND `moonLight` together.
  Dimming `sky.ts`'s `moonLight` alone is a half-fix.

## PANELS — both shells
`EclipseFacts` in `panels/TargetPanel.tsx` + a `/m` twin inlined in `mobile/TargetSheet.tsx`.
- **Gated on `target.kind`, NEVER `facts.kind`** — the sun and the moon both carry
  `facts.kind === "planet"` (they reuse the planet fact shape); a facts gate prints eclipse rows on Mars.
- Mounted **AFTER the unfollow button**: `verify-uxbatch4.mjs` asserts FIND-IN-FRAME sits directly
  above UNFOLLOW on BOTH shells with `compareDocumentPosition`.
- Rows carry the **YEAR** (`eclipseDateLabel`) — the next 5 solar eclipses at one site span a decade,
  so `dateLabel`'s month+day is a factual error here. Penumbral rows show **"—", not a false 0%**
  (astronomy-engine reports obscuration 0 for penumbral BY DEFINITION).
- Memo keyed to the DAY bucket + 0.05°-quantized anchor (the FindPanel froze-the-boot-flight lesson).
- Live "NOW:" line in accent when scene time is inside an eclipse.
- `test/components/eclipseParity.test.ts` (11 tests) fences all of the above on both shells.

## TRAPS BOUGHT THIS SESSION
- **TDZ — browser-caught, invisible to vitest AND `astro check`.** The eclipse state was first
  declared with the other look state ~1,300 lines BELOW `sampleEphemeris`, which runs at module init.
  `ReferenceError: Cannot access 'lunarEcl' before initialization` → swallowed by the dynamic
  import's own `.catch()` as `[globe] tiles disabled` → **the ENTIRE real-Earth globe silently fell
  back to the procedural placeholder.** Second time this exact trap has bitten in this file (see the
  `ultraOn` note at StylizedTiles ~444). **Declare orchestrator state ABOVE the ephemeris seam.**
- **Ease vs "EXACT no-op" assertions.** `eclipseK` eases on `ECLIPSE.tauMs` 220 and only SNAPS
  inside 1e-3 ≈ 6.2τ. A 1.2 s settle left it at 0.9983 and failed the exact-1 off-state check — the
  ease was right, the wait was not. Anything asserting the STEADY state must wait for the snap.
- `astronomy-engine`: `SearchLocalSolarEclipse` has an **UNBOUNDED `for(;;)`** where its global and
  lunar siblings cap at 12 lunations (walkers carry `MAX_STEPS`); eclipse searches throw **raw
  STRINGS**, not Errors; `LocalSolarEclipseInfo.peak` is an `EclipseEvent` (`.time`) but
  `LunarEclipseInfo.peak` IS the AstroTime; `sd_*` are **SEMI-durations in MINUTES** (0 = phase never
  reached); an ANNULAR eclipse populates `total_begin`/`total_end` and reports obscuration < 1.
- Colours went to `tokens.css` + the GL bridge (`eclipseUmbra`, `eclipseChromo`) — D14; the two hex
  literals I first put in `tuning.ts` were the only ones in that file.

## GATES
vitest **1,373/1,373 (113 files, +43)** · `astro check` 0 err / 5 hints · `npx knip` exit-0 ·
**`scripts/verify-eclipse.mjs` 37/37 ALL PASS** · `verify-ultra` 28/28 + `verify-uxbatch4` ALL PASS.
**BROWSER-VERIFIED** on CDP, both shells, pictures looked at:
`verify-shots/eclipse-0{1..6}-*` + `eclipse-panel-{desktop,mobile}-{sun,moon}`.

## OPEN — owner taste pass (`ECLIPSE` block in tuning.ts)
`umbraLight` 0.055 (the honest physical number is ~1e-4 of full moon = invisible; this is eye
adaptation applied ONCE, in one named place — C2) · `daylightFloor` 0.04 · `coronaGain` 1.15 ·
`shadowSoftFrac` 0.09 (the umbra edge may want to be softer) · the earthshine-lit silhouette reads
mid-grey rather than black at partial phases (earthshine IS maximal at new moon — defensible).
**NOT DONE:** the true LEO umbral SPOT drawn on the globe from orbit — `baseEarth` already holds
`uMoonDir`, so it is a contained follow-up. Backlog P9 (lunar eclipses) is now CLOSED by this.

Related: `mem:patterns/sky-bodies-terrain` · `mem:project/wip-2026-08-22-ultra-track` ·
`mem:decisions/adr-000-locked-stack` (D6 astronomy-engine).
