# wip 2026-10-25f — T200 THE MOON'S PERCEIVED VISIBILITY: the pure model + the verdict + the disc through the air

Mode: implement (`/frame` + the ecom-pilot core: deep tier; five Opus research agents in one fan-out, one Opus build agent for the UI
surfaces, one Fable adversarial review of the shader change; the advisor before the approach and before the ship). Owner ask (verbatim in
backlog T200 / DECISIONS 2026-10-25e): realistic brightness / colour / contrast of the moon against the CURRENT sky, Rayleigh + airmass,
"is it optically worth it" for a dusk / dawn shot, the safest rungs first, never degrade mobile. Records: DECISIONS 2026-10-25f · NSP ·
backlog T200 BUILT · this leaf. Gates on the final tree: vitest **3,942 / 259** · `astro check` **0 errors** (753 files).

## 1. The pure model — `src/lib/ephemeris/moonVisibility.ts` (NOT `lib/sky/`, the row's path was wrong: that dir is the lazy catalogs)
`moonVisibility({ phaseAngleDeg, moonAltDeg, sunAltDeg, elongationDeg?, moonDistanceKm?, siteAltM?, eclipseDim? })` → `{ verdict, label, reason,
sky, apparentMag, observedMag, airmass, extinctionMag, transmittance, tint, moonLuminance, skyLuminance, contrast, threshold, score,
illuminatedFraction }`; `moonVisibilityAt(utcMs, lat, lon)` for the UI (three `horizontal()`-class reads — memoise per minute, never per frame).
Physics, each sourced in the header: K&S 1991 eq. 9 magnitude (−12.73 + 0.026α + 4e−9α⁴) + the opposition surge (×1.35 over the last 7°) +
inverse-square distance · Kasten–Young airmass (`lib/globe/duskLight.airMass`, the sun's own) · Schaefer 1998 sea-level extinction per channel
(B 0.368 · G 0.238 · R 0.155 mag/airmass; Rayleigh e^(−h/8200), aerosol e^(−h/1500)) → the TINT = transmittance / its red peak · the LIT AREA's
luminance 4.9e3 cd/m² × the phase flux / the illuminated fraction (the eye resolves the sliver) · the sky ladder by sun altitude (Preetham
daylight 2.7–9e3 → Schaefer / Patat twilight at ~1 mag/° → the 2.3e−4 floor), × a daytime horizon-haze lift and a sunward lift (a crescent
in the sunset glow, ≤ ×10 within 20° of the sun, eased to half by day) · **contrast = L_lit·T / L_sky** (the airlight ADDS to the disc —
the first draft's (L−sky)/sky called a daytime quarter moon "lost") · Crumey 2014 / Blackwell threshold (2.72e−3 photopic; scotopic
7.633e−3·L^−¼ − 7.174e−3) × a field factor 2.5 × a thin-crescent penalty past α 140° · the Danjon limit 7.5°. Verdicts: below · sunward ·
lost (score < 1) · faint (< 5) · pale (C < 1) · clear (C < 20) · bright. Labels: BELOW HORIZON · NEAR THE SUN · LOST IN SKY · FAINT · PALE ·
CLEAR · BRIGHT. 27 tests (`test/lib/ephemeris/moonVisibility.test.ts`: the anchors, monotonicity, the real Dnipro instants).

## 2. The verdict on the planning surfaces (an Opus agent; both shells in parity)
- TODAY rows (`TodayCard` + `PlanSheet.TodaySection`): a second meta `☾ <LABEL>` on moonrise / moonset rows, sampled **40 min after a rise /
  before a set** (the moon ~6–8° up — the low-moon shot; at the event itself the moon is on the horizon by construction); the title / aria
  says so. `.pp-day__meta + .pp-day__meta { margin-left: 6px }` added (the phone had it).
- The MOON section's NOW line (`MoonCalCard` + `PlanSheet.MoonSection`): `☾ NOW · BRIGHT · CIVIL TWILIGHT · LOW IN HAZE` (the reason's clauses
  before the first " — "; the full reason in the title / aria); a per-minute tick; desktop `.pp-status--moon` nowrap + ellipsis.
- The tracked moon's badge (`TargetPanel` + `TargetSheet`, `target.kind === "moon"`, never `facts.kind`; skipped when "below" — the ABOVE / BELOW
  badge already says it); `--up`/`--clear` for bright + clear, `--sky-blocked`/`--blocked` for faint · lost · sunward.
- The /m peek's ☾ cell: `data-vis="<verdict>"` + the aria sentence ("Moon bright now: civil twilight · low in haze, 1.6 mag lost, orange" — no em
  dash on /m, the peek test forbids it); the row's 38.59 px and the name budget untouched; faint / lost dim the glyph to 0.55.
- Tests `test/components/moonVerdictSurfaces.test.ts` (8) + the peek almanac test (+2). On glass (`verify-t200-moon.mjs --legs V`): the /m and
  the desktop PLAN read NOW · BRIGHT at the 2026-10-25 dusk, NOW · PALE at the 2026-11-02 daytime quarter; the rows SET:BRIGHT RISE:CLEAR.

## 3. The disc through the air (rung 2 — two uniforms, no new pass / texture / ephemeris call)
- `uMoonAir` (float) + `uMoonTint` (vec3) multiply the ALBEDO right after the umbra block → both premultiplied arms dim and warm, alpha
  untouched (a dim low moon still occludes the stars). CPU: `moonAirTerms(moonAltDeg, skyK)` — the moon's own altitude from `_dir · uHorizonUp`
  (the sine the sun's extinction reads): EXACTLY level 1 / white at ≥ `SKY.moonAirHiDeg` 12° and from orbit (skyK 0); the level a smoothstep to
  `moonAirFloor` 0.45 at 0°; the tint = `solarChroma` (Kasten–Young × the sun's per-channel τ) floored `moonChromaFloor [1, .42, .16]` ×
  `moonChromaK` 1 at full strength from `moonChromaBandFrac` 0.67 (8°) downward, blending to white by 12°. The curve: 10° (1, .91, .76) ·
  8.4° (1, .80, .46) · 4.5° (1, .65, .23) · 0° (1, .42, .16); levels .96 / .88 / .62 / .45.
- `uDaySky` = `moonDaySkyK(dayK, skyK, eclipseK)` = (1 − `moonNightShare`(SKY_DAY_LUM·dayK·skyK)) × eclipseK, the night arm's share =
  ((E / (E + sky))² − 0.01)/0.99 clamped at 0, E = `moonMeanAlbedo` 0.3 × `moonEarthshine` 0.12 = 0.036, SKY_DAY_LUM = lum(`tokens.skyDay`) ×
  `ATMOSPHERE.skyDayGain` = 0.38: the dark limb is opaque only once the dome behind it is darker than its own earthshine → reads as
  max(sky, earthshine) through the whole ±7° ramp. By day the raw share is 0.0075 → the day arm additive-only TO THE BIT (2026-08-14);
  at night 0 → the opaque disc; the eclipse factor multiplies OUTSIDE the share → a total eclipse's dark disc unchanged.
- The twins: `moonDiscArms(lit, albedo, daySky, fade, air = 1)`, `moonAirTerms`, `moonNightShare`, `moonDaySkyK` — `test/components/globe/moonAir.test.ts`
  (13) + the untouched `moonDayArm.test.ts`; the depth-pin fence still counts two pins.
- NOT built, deliberately: a "paler at a high sun" day gain — the daytime quarter (sun +24°) measured a Weber contrast 0.09–0.26 on glass, what
  physics says (0.13); the day arm is already right. The eclipse / `ECLIPSE.*` untouched (T47 parked).

## 4. Measured on glass — `scripts/verify-t200-moon.mjs` (iPhone 402×874@3 · Pixel 412×892@3.5 · desktop 1600×1000@2; FPV aimed at the moon at fov 14, 90 m eye over the owner's street; `--baseline` / `--compare pre` / `--replay <label>` / `--legs M,V` / `--prod`)
| cell (sun · moon) | before rgb · b/g · dark−sky | after rgb · b/g · dark−sky |
|---|---|---|
| dusk-full-low 2026-10-25 14:45Z (−2.8° · 8.4° E, full) | 184,183,177 · 0.967 · +86 | **149,138,115 · 0.833** · +57 |
| dawn-full-setting 10-26 04:00Z (−3.4° · 4.5° W, full) | 184,183,176 · 0.962 · +95 | **130,111,80 · 0.72** · +41 |
| dusk-gibbous-daylight 10-20 14:30Z (+1.0° · 15.6°, 0.68) | 143,160,173 · p10 under the sky by **16** | 141,161,179 · **−1** |
| dusk-quarter-nautical 10-18 15:30Z (−8.1° · 16.7°, 0.50) | 79,80,77 | identical |
| day-quarter-high 11-02 08:00Z (+24° · 32.9°, 0.45) | 148,187,223 · contrast 0.09 | identical |
| night-full 07-29 22:10Z (−22.8° · 21.3°) | 203,201,193 · 0.96 · +145 | identical (byte) |
60 / 60 checks vs the baseline on the three twins (the Pixel figures = the iPhone's to ±1). The sunset-pair sweep sheet (the moon down) unchanged.
The Pixel 6 Pro was NOT attached (`adb devices` empty) — no adb frame-time run; the honest cost claim is two uniform writes + one vec3 multiply
on a 48×48 sphere. The farm leg `tools/devicefarm/ios-t200-moon-2026-10-25.mjs --prod` (legs M + V) runs AFTER the release on the live site.

## Traps learned
- The FPV seam's `fpv().yawDeg` is the controls' own frame (reads 0), not a compass heading — the harness corrects the disc's centre by PITCH only
  and refines a full disc by its bright blob; the first baseline run's centres were 60,000 px off.
- The moon's render pipeline: `uBrightness` is overwritten every frame by `setHoverGlow` (a new uniform, never a fold); the dome draws BEFORE the
  moon (renderOrder 0 vs 12) so the night arm's alpha REPLACES the sky — the measured 16/255 hole at sun +1°.
- `contrast = L_lit·T / L_sky`, not (L − sky)/sky — the airlight sits in front of the disc.
- The chroma blended over the whole 12° band left the 8.4° moon grey (149,145,133); full strength below 8° gives the orange a dusk moonrise shows.
- A new, unimported `src/` file does not HMR-reload the page; editing `sky.ts` does — run the baseline BEFORE the edit, never beside it.

Related: `mem:patterns/sky-bodies-terrain` (the moon mechanics; its `depthWrite` note is STALE — off since 2026-08-14) · `mem:project/wip-2026-08-27-dusk-taste-pass`
(the sun's dim-and-solid precedent) · `mem:project/wip-2026-09-10-interlude-render-quirks` (T131 / T133) · the interlude leaf `wip-2026-10-25-mobile-interlude-radar-almanac`.
