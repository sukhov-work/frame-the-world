<!-- Authored 2026-08-25 by a design/prep session: 7 parallel read-only research agents (4 owner-bug
root-cause investigations, 2 audit-reconciliation passes against HEAD 1a486c9, 1 mobile/ULTRA
inventory), synthesized by the orchestrator. NOTHING here was implemented — this is the execution
charter for the next (long, autonomous) implementation session. -->

# RENDERING CHARTER — 2026-08-25

**What this is.** The implementation-ready consolidation of the FPV fidelity audit
(`FPV_FIDELITY_AUDIT_2026-08-22.md`, backlog T43), four owner-reported bugs from 2026-08-25
(§2 B1–B4), the ULTRA open tails (`ULTRA_ARCHITECTURE.md` §12), and a mobile-performance track.
Every audit gap has been re-verified against HEAD `1a486c9` — statuses and line anchors below
supersede the audit's where they differ; the audit stays the mechanism reference and its §4
refuted-candidates table still stands in full.

**Who executes it.** A long autonomous session (owner plan: Opus 5 + workflows, ultracode).
Slices are ordered so the session can run the ladder top-to-bottom; owner-taste decisions are
fenced into §4 and are NOT the autonomous session's to make — it prepares the A/B evidence and
moves on.

**Parked, unchanged by this charter** (owner order 2026-08-25): the BEST SPOT tails from
`NEXT_SESSION_PROMPT.md` 2026-08-24d — T52/S2 reproduction, the S9/S1 property tests, T49 taste
pass, T50 cloud verification. Also still parked: T46, T47, T1, T42, T34-as-iOS-measurement (the
desktop lever IS in this charter as RC20), P8, M4, U8 sync ladder, T29, T31.

---

## §0 Session protocol for the implementing session

1. **Read order:** this file → the audit's §2 tables (the as-built technique reference) →
   `ULTRA_ARCHITECTURE.md` (gate contract, §5 off-state exactness, §8 three.js facts, §10
   rejections) → `conventions/globe-tuning.md` for any tunable you touch.
2. **Gates per slice:** `npm test` + `npx astro check` green before claiming a slice done; browser
   claims are UNVERIFIED until run in `wix dev` via `node scripts/verify-chrome.mjs`. Screenshots
   go in `verify-shots/` only. Run `scripts/verify-ultra.mjs` (28 checks) after ANY shadow/light/
   ground-shader change and `scripts/verify-eclipse.mjs` (37) after ANY sky.ts change — both must
   stay ALL PASS.
3. **Fences that constrain this work** (all machine-checked at HEAD):
   - **ULTRA off-state exactness** (`ULTRA_ARCHITECTURE.md` §5 + `verify-ultra.mjs` literal-zero
     asserts): with the chip off, no ULTRA value may change a rendered pixel. Any baseline
     promotion of an ULTRA lever changes default pixels → §4 owner A/B, never a silent default.
   - **Byte-identical `high` tier** (`test/lib/globe/quality.test.ts:204,221-230,282-283`): the
     desktop-frozen discipline. Tile/renderer lever changes on `high` need the owner ruling named.
   - **ULTRA gate fence** (`test/components/globe/fences.test.ts:212-308`): five files may name
     the pref; engine reads sit on `hqAllowed` lines; boot reads name `ultraShellAllowed`.
   - **Brand fence** (`test/brandFence.test.ts`): `ftw:*` keys and `uFtw*`/`FTW_*` shader
     identifiers keep the old name; user-visible strings say PLUX.
4. **One vertical authority:** anything touching `heightAt`, seats, or the FPV eye is a [SEAT]
   slice — verify against `__globe.u2()` (eye-jump ring, zero >0.5 m single-frame jumps) and
   `__globe.debugSeats()`.
5. **Traps that will bite** (all previously paid for): declare orchestrator state ABOVE the
   ephemeris seam in `StylizedTiles.ts` (TDZ → silent placeholder globe) · restart `wix dev` and
   move `node_modules/.vite` aside after adding imports to the globe bundle · backticks inside
   injected-GLSL template literals · eased uniforms need the snap, not a wait (`≥6.2τ`) ·
   `Page.navigate` to a hash-only-different URL does not reload · keep `.claude/.ship-title`
   ≤ ~225 chars.
6. **Recording:** every slice appends its DECISIONS.md line; the RC29 convention lines land with
   the first shipped slice (the backlog registry edits already landed 2026-08-25 with this
   charter); the session ends by writing `RENDERING_ARCHITECTURE.md` (RC30) and refreshing
   `NEXT_SESSION_PROMPT.md`.
7. **Namespace:** slices here are **RC#**. The audit's S# and ULTRA_PLAN's S# are different
   namespaces — never cite a bare "S2" without its document.

---

## §1 Reconciled audit state (2026-08-22h → HEAD 1a486c9)

Sessions in between: ULTRA #75, eclipses #76, BEST SPOT #77–79, brand fence #80. BEST SPOT's only
render-pipeline touch is a `terrainEpoch` counter exported next to `heightAt` (consumed by
`bestSpotFeed.ts:685-690`) — the seat/bake machinery is untouched by it.

| Audit item | Status at HEAD | What the implementer must know |
|---|---|---|
| #1 aniso/mips | S1 half SHIPPED ULTRA-gated | Knob is `ULTRA.anisotropy: 16` (`tuning.ts:589`), stamp at `imageryGround.ts:645-685` (prototype `fetchItem` wrap — the only path; `GROUND.overlayAniso` does not exist). Baseline still 1 tap. Mip chain still absent (capped hand-built levels only — see RC26). |
| #2 `heightAt` | OPEN, byte-equivalent | Now `imageryGround.ts:689-699`; `pickGround` `StylizedTiles.ts:1112-1114`. New neighbour: `terrainEpoch` in the same handle — don't break it. |
| #3 bake curvature | OPEN | `scripts/bake/**` zero-diff since the audit. Scope grew: THREE building bakes now exist (st-albans landed, `regions.ts:50-54`). |
| #4 seat sweep | OPEN | `enrichedBuildings.ts:891-913`; `loadAim` still passed at `:240`, still unread. |
| #5 45 m gate | OPEN | `tuning.ts:1582`; still zero rejection visibility (`grep reject` → 0). |
| #6 seat cache | OPEN | `dispose-model` at `enrichedBuildings.ts:617-640`. |
| #7 OSM unseated | OPEN | `buildings.ts` still zero seat reads; everest still `variants: []` (`regions.ts:63`). |
| #8 FPV walk | OPEN | Apply at `StylizedTiles.ts:3036`; zeroings `:2659/:2711/:2875`; integration `:2991-3005`. |
| #9 aerial persp. | SHIPPED ULTRA-gated | `FTW_AERIAL_GLSL` in ground + building fill + edge. Baseline inert by contract. The dome seam the audit predicted is now a confirmed open tail → RC24. |
| #10 far-field refinement | **PREMISE REFUTED on desktop** | Measured 2026-08-22i (recorded `tuning.ts:584-587`): ground errorTarget forced to 0.05 → ZERO extra tiles; desktop imagery is availability-capped (Esri z19 + patch L13). Do not implement audit S10 as written. The real availability problem is B1 → RC5. |
| #11 DSM | OPEN | `glo30.mjs:24`. (BEST SPOT's runtime "DSM" is unrelated.) |
| #12 governor | Half-superseded | ULTRA shipped the tile-lever edge seam (`quality.ts:154-162` `ultraTileLevers` via `stepUltraGate`, overlay px deliberately excluded `quality.ts:135-137`). RC18 = generalize that seam to governor promotes; do not re-invent in GlobeCanvas. |
| #13 rigid box | OPEN | Apply loop verbatim at `enrichedBuildings.ts:786`. |
| #14 depth encoding | OPEN, cost grew | Raw ShaderMaterial surface is now **22 instances / 14 modules** (+3 from `bestSpotSheet.ts`; module list: −skyTrail +bestSpotSheet). ULTRA's metres-derived shadow bias (`StylizedTiles.ts:4108`) must be re-derived if depth encoding changes. |
| #15 buildings SSE | OPEN | ULTRA lowers ion SSE 16→12 chip-on (`tuning.ts:531-539`) — an errorTarget change, not the px-basis fix. Baseline unchanged → §4 AB6. |
| #16 hemisphere | Tracking half SHIPPED ULTRA-gated | The audit's "no reference kept" sentence is now FALSE — hoisted at `GlobeCanvas.tsx:268-273`, tracked in `stepUltraLook`. Baseline deliberately restores ECEF +Y (off-state contract) → §4 AB2. |
| #17 FPV shadows | OPEN — survived ULTRA verbatim | Gate at `StylizedTiles.ts:4023`; discarded fallback at `:3108-3110`. → RC3/RC4 (B4). |
| #18 straddler | OPEN, ×3 bakes | st-albans adds a third mask boundary. |
| #19 sidecars | OPEN | Zero `.meta.json` in any bake dir; U8 pick floor hack live (`tuning.ts:1613`). |
| #20 occlusion culling | OPEN, stays out of scope | Audit disposition unchanged. |
| #21 post-AA | OPEN | Zero FXAA/SMAA/TAA in `src/`. |
| #22 composite aspect | OPEN | Upstream-contribution disposition stands. |
| #23 governor inputs | OPEN | `hitchCount()` still has zero runtime consumers. |
| #24 T34 churn | OPEN | ULTRA raises LRUs to 600 MB chip-on only; rest-trim unfixed → RC20. |
| #25 GlobeControls radians | OPEN — doc line never written | Cheapest item in the report → RC29. |
| #26 EXIF geoid | OPEN — doc line never written | New in-repo citation: `scripts/bake/terrain/geoid.mjs` (checked-in EGM2008 grids, born from a 48 m Everest reference bug) → RC29. |
| Audit S1 | DONE (ULTRA) | Remainder = §4 AB3 (baseline/per-tier knob). |
| Audit S10 | NEEDS-REWRITE | See #10. Do not build. |
| Audit S12 | REPHRASED | → RC18. |
| Audit S15 | Half done | → §4 AB2. |
| Measurements | M3 ANSWERED (maxAniso 16, owner machine); M4 largely discharged (availability cap); M1/M2/M5/M6/M7/M8/M9/M10/M11/M12/M13/M14 still open | M5 is still the §1.3 separator and still gates RC15 vs RC12 ordering. |

---

## §2 Owner bugs (reported 2026-08-25) — root causes

All four were root-caused by read-only investigation; mechanisms are computed from source, not yet
browser-reproduced — each fix slice's proof-of-done includes the browser confirmation.

### B1 — "Map data not available" tiles at close zoom (Everest)

Esri World Imagery serves an HTTP-200 placeholder JPEG beyond local coverage — live-probed
2026-08-25: **2,521 bytes, byte-identical, md5 `f27d9de7f80c13501f470595e327aa6d`, ETag
`"vvvvvvvvvvvvf"`, `Cache-Control: max-age=86400`**. Around Everest, z19 coverage is an island:
the summit tile is real imagery, 100% of 32×32 tilemap windows 256–1024 tiles out are unavailable
at z19 (z16–z18 fully available). The placeholder decodes as a valid texture, so the only fallback
machinery in the stack — `info.failed` → `load-error` → debounced `resetFailedOverlays()`
(`imageryGround.ts:332-343`) — never arms: it is a network-failure path and this is a success.
`fetchOptions: {cache: "force-cache"}` (`imageryGround.ts:259,268`) then pins the placeholder
without revalidation, and on iOS `public/sw.js:105` caches any `res.ok` response for 7 days — so
it never heals in-session and mostly not across sessions. "Appears later" is most likely a camera
move re-compositing the region at a shallower zoom, not Esri publishing (UNVERIFIED as a server
phenomenon). A static per-region level cap cannot work — the coverage boundary is sub-kilometre.
Fix → RC5. Determinism trap for any `calculateLevel`-override alternative: `lockTexture`/
`releaseTexture` recompute the level as a default argument (`ImageOverlayPlugin.js:1617-1626`);
a cap table that changes between lock and release makes `DataCache.releaseViaFullKey` throw.

### B2 — square edge around the sun at totality

Two additive terms in the sun impostor's fragment never reach zero at the quad boundary
(`PlaneGeometry(2,2)` scaled by `SKY.sunGlowExtent: 7` → r = 0…7 disc radii at edge midpoints,
~9.9 at corners; `sky.ts:271,507`, `tuning.ts:71`):

1. The corona outer power law `0.42·x^-2.6` (`sky.ts:253`, `tuning.ts:829-830`) — a power law has
   no compact support; at the quad edge it is ≈0.0026–0.0041 linear after petal × tot ×
   `coronaGain 1.15`, truncated to zero by the boundary = a hard brightness step.
2. `DITHER_GLSL` ±1/256 added unconditionally after all gates (`sky.ts:266`) with **no discard
   anywhere in the sun fragment** — the whole quad paints noise even where signal is 0.

Both are visible only when the background drops below a few times their level: `eclipseK` bottoms
at `daylightFloor 0.04` exactly at max coverage, and the corona pedestal exists only while
`tot = smoothstep(0.985, 1, uEclipse) > 0` — hence "appears at some moment, then gone". Bloom is
exonerated by arithmetic (0.003 never crosses threshold 0.9). Same defect class in the
tracked-target impostor (`skyTarget.ts:152-230`: comet/point halos + unconditional dither).
In-repo fix idiom already exists: `stars.ts:168-171` (discard + smoothstep-to-zero at the sprite
boundary) and `sky.ts:399-400` (moon discards below `moonAlphaDiscard` before its dither).
Fix → RC1.

### B3 — sunset/sunrise shadow snap + luminosity jump

Four mechanisms, ranked; the first two are one-frame CPU gates shared by baseline AND ultra:

1. **The `castShadow` boolean snap at sun elevation ≈ +0.46°.** `sunUp = sunDirW·_focusUp >
   SHADOWS.minSunElevSin (0.008)` (`StylizedTiles.ts:4024`, `tuning.ts:388`) →
   `sunLight.castShadow = sunShadows || moonShadows` (`:4068`). No easing exists anywhere. At that
   exact elevation the key is at its brightest of the day — `SUN.keyIntensity 1.5 ×
   (1 + GOLDEN.keyBrighten 0.35) = 2.025` (golden bell = 1.0 there) — so a kilometres-long,
   0.75-opacity shadow field vanishes in one frame and scene luminance jumps. Reverse at sunrise.
   ULTRA shares the gate and its exposure ramp (×1.12 at 0°) slightly amplifies the step.
2. **The sun→moon key switch is a same-frame flip** on the same 0.008 threshold
   (`StylizedTiles.ts:4026-4030`): intensity 2.025 → 0.3×moonKs, colour golden → cool, shadow
   azimuth teleports to the moon. (moonKs is Krisciunas–Schaefer 1991 — the audit's "Kasten &
   Young" label is wrong.)
3. **When no qualifying moon: the sun key never dies.** The sun arm has no elevation term on
   intensity (`:4047-4066`) — after the golden fade it stays 1.5 all night, lighting walls from
   below the horizon. Baseline "dusk → night" for buildings therefore doesn't exist; the ground's
   `dayK` band (−6°…+3.15°), the night band (−0.29°…−6.9°), the golden bell (−12°…+21°) and the
   additive moon fill are mutually mis-phased, and dark ground under a bright moon can brighten
   through dusk.
4. Near-horizon shadows also truncate at the ortho bounds before dying (a 20 m building casts
   ~2.5 km at +0.46° vs the 1.6 km street-level half-extent) — B4's framing fix helps here.

Key enabler, source-verified in three 0.185.0: **`shadow.intensity` is a live per-frame uniform**
(`LightShadow.js:35-41` → `WebGLLights.js:289,343` → `shadowmap_pars_fragment.glsl.js:147`
`mix(1.0, shadow, shadowIntensity)`) — no recompile, and one write fades building-received
shadows and the ground `ShadowMaterial` twins together. Fix → RC2 (+ §4 AB1 for the full
"real dusk" package, which changes the frozen default look).

### B4 — shadows off when the look ray misses the ellipsoid; partial shadow coverage

Two mechanisms, both certain; streaming/stamp theories ruled out (the terrain-caster
stamp-at-load is already correctly wired — `imageryGround.ts:590-595,603-625,773-782`):

1. **The `!!focusHit` gate** (`StylizedTiles.ts:4023`) — survived the ULTRA rewrite verbatim. Any
   near-level look nulls the ellipsoid intersection (`projection.ts:135-151`) → `castShadow` false
   AND `setTerrainCast(false)` in one frame. Worst over mountains: `alt` is ellipsoidal, the ray
   exits through the relief, and a look at a facing peak slightly above level kills everything
   while terrain fills the frame. The fallback the fix needs already exists at `:3107-3110`
   (`_focus.copy(camera.position)` on miss) and is discarded by the gate.
2. **Ortho framing geometry.** The box is centred on the screen-centre ellipsoid hit with
   half-extent `clamp(alt·K, 1600, cap)` (K = 0.6 base / 1.1 ULTRA; `tuning.ts:363-369,772-773`).
   Covering your own foreground requires pitch ≥ ~59° (base) / ~42° (ULTRA) — independent of
   altitude, because extent scales with altitude while the hit distance does too. Everything
   outside the box renders fully lit with a hard edge (three r185
   `shadowmap_pars_fragment.glsl.js:124-127` returns lit outside [0,1]). Moving/zooming slides
   and resizes the covered patch — "shadows missing on part of the map".

Also by design: terrain casting is ULTRA-only (`:4115-4120`), so "no terrain shadows at all"
without the chip is intended — whether that split stays is §4 AB7. Fix → RC3 + RC4.

---

## §3 The ladder

Kind: **[ADD]** additive · **[SEAT]** touches the vertical-authority contract · **[BAKE]**
re-bake + R2 upload · **[A/B-PREP]** produces evidence for §4, changes nothing by default.
Order within groups is execution order; groups A→B can interleave, C before D.

### Group A — probes first (one `wix dev` session, no code)

| # | Slice | Proof-of-done |
|---|---|---|
| RC0 | Take the still-open measurements that gate ladder ordering: M1 (live FPV `camera.near/far`), M2 (`gl.getParameter(gl.DEPTH_BITS)`), **M5 (seat delta vs distance-from-bake-origin — the §1.3 separator)**, M6/M7 (per-frame `heightAt` count/ms; how often a fading parent wins), M8 (measured OSM float in the annulus + Khumbu) | Numbers recorded in DECISIONS; M5 verdict names which floating mechanism dominates (quadratic ⇒ F1/RC12 first; flat bias ⇒ F2/RC15 first; time-decaying ⇒ F4/RC7 first) |

### Group B — the owner bugs (highest visible value, smallest blast radius)

| # | Slice | Kind | Effort | Proof-of-done |
|---|---|---|---|---|
| RC1 | **B2 fix.** Sun quad: radial smoothstep window to exactly 0 inside the quad edge (start ≥ 0.6×`sunGlowExtent`, tunable) + epsilon discard before `DITHER_GLSL` (`sky.ts:265-266`), per the `stars.ts:168-171` idiom. Sibling pass on `skyTarget.ts`. CPU-twin unit test asserting `window(sunGlowExtent) === 0`. Implementation A/B seam: `ECLIPSE.coronaOuterGain = 0` in dev separates pedestal vs noise | [ADD] | S | `verify-eclipse.mjs` 37/37; a totality screenshot at the Burgos repro (`#f=42.354484,-3.698240,17.0,283.5,7.2,8.3`, t≈1786559347887) shows no square; corona streamers visually unchanged |
| RC2 | **B3 fix, snap-killers only.** (i) `sunLight.shadow.intensity = smoothstep(minSunElevSin, ~0.06, sunUpDot)` in `stepKeyLightAndShadow` (~5 lines + tunable; moon arm same over moon elevation) so shadows fade to nothing before `castShadow` flips. (ii) Lerp the `sky.ts` moonLight handoff (`:4140`) and trough `sunLight.intensity` across the flip band so the source switch happens at zero visible contribution | [ADD] | S | Scrub sunset+sunrise at a city: no single-frame luminance step (record a timelapse, judge as a timelapse); `verify-ultra.mjs` 28/28; screenshot pair for §4 AB4 (raking-shadow look in the last ~3°) |
| RC3 | **B4 fix (a).** Drop `!!focusHit` from `shadowEligible` (`:4023`); change the miss-fallback (`:3107-3110`) to the eye **projected to the surface** (`_focus −= up·alt`) so the base-profile depth range still contains the receivers. `_focus` consumer sweep already done — lat/lon consumers unaffected; FIND pan uses raw `focusHit` and is immune | [ADD] | XS | FPV pitch sweep through the horizon: `__globe.ultraLook().shadow.casting` stays true, terrain `casting` count stays nonzero; screenshot pair |
| RC4 | **B4 fix (b).** Rig-only `_shadowFocus` (do NOT re-point `_focus`): eye-edge of the box at the viewer, centre `eyeGround + fwdHorizontal·(d/2)`, half-extent `clamp(max(alt·K, d/2 + boundsM/2), boundsM, cap)`. Extend `verify-ultra.mjs`: after streaming new tiles, `terrain.casting === terrain.meshes && frontSideShadow === meshes`. Full visible-frustum fit stays in reserve — build only if shots after RC4 still show hard shadow edges inside the frame | [ADD] | S | Shots: (i) FPV pitch −0.2° — own street shadowed; (ii) Everest oblique — Khumbu shadows reach the foreground; `shadow.boundsM/near/far` sane in `ultraLook()` |
| RC5 | **B1 fix.** Construction-time `o.fetch` wrapper on the Esri overlay (`makeEsriOverlay`, `imageryGround.ts:254-261` — the fetchOptions + aniso-wrap precedents): detect the placeholder by byte length 2521 + ETag `"vvvvvvvvvvvvf"` (fail-soft: unknown → pass through), then fetch the parent tile, `createImageBitmap` the correct quadrant, upscale to 256, return a synthesized Response — the placeholder never draws. Capped recursion (2–3 levels), in-wrapper learned cap table to skip known-placeholder GETs. Plus: `sw.js` carve-out (don't cache the sentinel body) and once-per-session `cache:"default"` re-issue on placeholder hits so new imagery heals ≤1 day | [ADD] | M | Everest FPV in browser: zero "Map data not available" tiles visible; summit z19 imagery still sharp; network log shows placeholder GETs collapsing to parent fetches after first hit |

### Group C — seat/height core (audit slices, anchors updated; [SEAT] discipline throughout)

| # | Slice (audit ref) | Kind | Effort |
|---|---|---|---|
| RC6 | `heightAt` + `pickGround` → `intersectObject(tiles.group, true)` + `firstHitOnly` + deepest-tile-level hit selection (audit S3; anchors `imageryGround.ts:689-699`, `StylizedTiles.ts:1112-1114`; keep the `terrainEpoch` neighbour intact) | [SEAT] | S |
| RC7 | Seat-sweep priority: look-biased top-K cells (reuse the `LoadAim` already passed at `enrichedBuildings.ts:240`), never-sampled-first drain, minimum round-robin share (audit S4) | [ADD] | S |
| RC8 | Relief-scaled plausibility gate + rejection counter in `debugSeats` (audit S5) | [SEAT] | S |
| RC9 | Per-cell seat cache across LRU eviction — warm start, SNAP `appliedM`, drop on variant switch (audit S6) | [ADD] | S |
| RC10 | FPV walk terrain re-seat at the `PLAN.rebuildDistM` cadence, eased with `seatStep`, hold last-good on null (audit S8; apply site `StylizedTiles.ts:3036`) | [SEAT] | M |
| RC11 | Per-tile terrain height cache (the `vectorFeatures` lattice pattern) → raise seat budgets 5–10× (audit S16; sized by RC0's M6) | [SEAT] | M |

Proof-of-done per slice: as written in audit §5 (S3/S4/S5/S6/S8/S16 rows) — those commands are
still correct; only line anchors moved.

### Group D — bake ladder (now ×3 building bakes: dnipro classic, dnipro-o2w, st-albans-o2w)

| # | Slice (audit ref) | Kind | Effort | Note |
|---|---|---|---|---|
| RC12 | Tangent-plane curvature subtraction at all `projectEN` sites, both bakers + bake-manifest flag so it can never double-apply (audit S7; `geoid.mjs` is the manifest-flag precedent) | [BAKE][SEAT] | M | Ordering vs RC15 decided by RC0's M5 |
| RC13 | Base skirt 3–5 m below `base` in both bakers (audit S13) — masks residuals of everything else | [BAKE] | S–M | |
| RC14 | OSM per-tile seat from a baked signed `cwtMinusPatch` grid (audit S11; everest is the worst case; needs M8/M9/M10 from RC0) | [ADD]+[SEAT] | M | st-albans has no terrain patch — unaffected |
| RC15 | DSM→DTM: rasterize footprints + cached WBM mask, punch, inpaint, re-run the bake pipeline (audit S18; sized by M11) | [BAKE][SEAT] | L | Gated on M5 saying F2 matters |
| RC16 | Straddler rule unified + margin/crossfade ring (audit S19) — ×3 bakes | [BAKE] | M | |
| RC17 | `meta.json` sidecar consumption: class token kills the 2.5 m pick-floor hack, stable OSM id for U8 keying (audit S20) | [BAKE][ADD] | M | |

### Group E — pipeline & mobile performance

| # | Slice | Kind | Effort | Proof-of-done |
|---|---|---|---|---|
| RC18 | Governor lever split: generalize the shipped ULTRA edge seam (`quality.ts:154-162` + `stepUltraGate`) so governor **promotes** land tile levers inside FPV, `tierOverlayPx` stays deferred (audit S12 rephrased; also un-parks the ULTRA pin's tier half) | [ADD] | S–M | Force `low`, enter FPV, force promote: new errorTarget/LRU live, zero `__overlayRebuilds` |
| RC19 | /m PiP: render the second pass at half rate or only on camera/time delta (`GlobeCanvas.tsx:578-596`; the shadow-map half is already guarded) | [ADD] | S | PiP still tracks; main-loop ms drop measured |
| RC20 | T34 ground-LRU rest-trim churn: mode-aware LRU floors or a flip-freeze of the rest-trim (`quality.ts:29-45`; floor must stay < cap per mode — the U2/A9 inversion history) | [ADD] | M | Esri GETs per 2D↔FPV leg drop from ~600 to near-zero; cache no longer rests at exactly `minBytesSize` |
| RC21 | On-demand render (RENDERING_QUALITY_PASS P11): skip `composer.render()` when nothing animates (`GlobeCanvas.tsx:518-570`). The "is anything animating" predicate must cover: uTime twinkle, all eased uniforms (ULTRA look, eclipse, reveals, drape crossfade), flights/glides/FPV, governor DPR changes | [ADD] | M–L | Static street view: GPU ~0%, no visible freezes on interaction resume; soak a full ULTRA timelapse to prove no stuck eases |
| RC22 | Mobile knob pass (constants only, judged on device later under T1): sticky-overlay flat-chart constant, lean shadow `maxAltM`, queue caps | [A/B-PREP] | S | Values proposed + rationale recorded; nothing changed without §4 |

### Group F — ULTRA fidelity & stability

| # | Slice | Kind | Effort | Proof-of-done |
|---|---|---|---|---|
| RC23 | ULTRA×eclipse haze seam: scale the haze target by `eclipseK` in `stepUltraLook` (`:3947`) so totality under ULT isn't painted over by day-tinted haze | [ADD] | S | Totality scrub with ULT on: world darkens coherently; `verify-eclipse` + `verify-ultra` green |
| RC24 | The golden-hour dome seam (ULTRA_ARCHITECTURE §12's one visible SEAM): feed the band tint/haze into `atmosphere.ts`'s low-alt regime so the dome above the horizon agrees with the ULTRA ground haze. ULTRA-gated; off-state exact | [ADD] | M | Timelapse day→night with ULT on: no colour fork at the terrain/sky junction; `skyBudget` test green; off-state byte-identical |
| RC25 | Capped mip chain on drape composites (3–4 hand-built levels, ULTRA-gated behind the same chip; the transparent-border bleed is why a full auto chain is banned) | [ADD] | M | A/B at 20 km grazing; no tile-seam grid at any 4-tile junction; VRAM delta ≤ +33% |
| RC26 | Chip-flip UX: surface the "reload for the full shadow rig" state (`__globeQuality.ultra !== .ultraBoot`) as a tooltip line/toast on the ULT chip | [ADD] | S | Flip mid-session → hint visible; reload → gone |
| RC27 | Design notes to land in tuning comments: the 8192² ≈ 512 MiB rollback knob criteria; if GTAO (T10) is ever enabled it silently couples to the ULT tier pin — record the "is AO an ULTRA lever?" decision point | docs | XS | Comments landed next to `ULTRA.shadowMapSize` and `AO.enabled` |

### Group G — depth (hold until evidence)

| # | Slice | Note |
|---|---|---|
| RC28 | Audit S17 ladder: FPV near clamp (≤1.5 m) first; `logarithmicDepthBuffer` only if RC0's M1/M2 + an observed shimmer case justify touching **22 raw-ShaderMaterial instances across 14 modules** (module list at HEAD: Pins 3, sky 3, bestSpotSheet 3, findGhosts 2, stars 2, + 9 singles). ULTRA's metres-derived shadow bias must be re-derived with any depth change | Low priority; skip without evidence |

### Group H — docs & registry (close the session)

| # | Slice | Content |
|---|---|---|
| RC29 | Convention hygiene (land with the first shipped slice, not the last): the #25 radians trap line in `conventions/globe-tuning.md` next to the 0.4.28 block · the #26 geoid convention line citing `geoid.mjs` and the 48 m Everest incident. (The registry edits — T38 dated close, T43 dated edit, the T54 charter row — already landed 2026-08-25 with this charter.) |
| RC30 | **`RENDERING_ARCHITECTURE.md`** — the final as-built doc. See §5 |

---

## §4 Owner A/B queue — decisions the autonomous session must NOT make

The session prepares evidence (screenshot/timelapse pairs, knobs wired behind flags where cheap)
and records each item; the owner judges. These are ordinary taste items, not blocking questions.

| # | Decision | Prepared by |
|---|---|---|
| AB1 | **The "real dusk" baseline package**: promote the twilight band curve (or a subset) to baseline + give the sun key an elevation term so it actually dies below the horizon + decide the phantom night key (walls currently lit all night at intensity 1.5 — the frozen night look depends on it). Changes the default look everywhere; must be judged as a timelapse | RC2's timelapse + a flag-gated prototype |
| AB2 | Hemisphere baseline orientation (#16 baseline half): local-up always, or keep ECEF +Y off-state | screenshot pair at Dnipro + a 90°-different longitude |
| AB3 | Baseline/per-tier drape anisotropy (S1 remainder): default some anisotropy for everyone, or keep it ULTRA-only | A/B horizon shots at aniso 1/4/16 |
| AB4 | RC2's look change: shadows now fade over the last ~3° of sun — confirm the raking-shadow loss is acceptable | RC2 screenshot pair |
| AB5 | ULTRA taste knobs (§12: `dayCurve` civil anchor 0.30 first, `hazeMaxK`, `photo3dK`, `hemiTintK`) — unchanged from ULTRA_ARCHITECTURE | timelapse per knob change |
| AB6 | #15 buildings SSE: tunable DPR exponent / per-tier re-calibration (≈4× far-field tiles on `high`) | tile-count + shot deltas |
| AB7 | Terrain shadows outside ULTRA: keep the split (current design) or promote terrain casting to `high` | frame-time measurement at city + Everest with casting forced on |

---

## §5 RC30 — the final rendering-architecture doc (spec)

Write `.claude/claude-docs/rendering/RENDERING_ARCHITECTURE.md` after the ladder lands. It
supersedes and absorbs the audit's §2 "what we already do" tables (the audit stays as provenance).
Two audiences, one file:

1. **Broad terms** (first half): the frame's journey — scene graph and the two tile renderers →
   per-frame orchestrator step order (`stepViewFocus` → … → `stepEclipse` → `stepUltraLook` →
   `stepKeyLightAndShadow` → composer) → the light model (key/hemisphere/ambient, band curves,
   eclipse scalar) → shadows (rig, twins, terrain casting) → imagery (drape pipeline, availability
   handling from RC5) → seats and the one-vertical-authority law → adaptive quality (tiers,
   governor, ULTRA, mobile) → post chain.
2. **Technical detail** (second half): per-module tables in the audit-§2 style (technique · where ·
   knob), the tunables-contract pointer, the DEV seam catalogue (`__globe.*`), the verification
   harness catalogue, the three.js facts that constrain the design (ULTRA_ARCHITECTURE §8 absorbed),
   the rejected-techniques table (§10 absorbed), and known limits (refuted audit candidates, the
   availability cap, depth-encoding status).

Apply `.claude/skills/no-slop/SKILL.md` (the pass, §The pass) before saving — same gate as this
charter.

---

## §6 Do-not-do (standing, with reasons on record)

- Audit §4 refuted candidates — all 15 still refuted; never re-discover.
- Audit S10 as written (desktop refinement region) — premise measured dead (§1 #10).
- CSM / PCSS / VSM / real-time GI — ULTRA_ARCHITECTURE §10 rejections stand.
- Full auto mip chains on drape composites — transparent-border bleed; only RC25's capped
  hand-built levels.
- A runtime geoid (#26) — D4 binding; document, don't code.
- Occlusion culling (#20) — out of scope until the horizon profile has a conservative variant.
- Renaming `ftw:*` keys / `uFtw*` shader ids / widening `mapFlatNow()` — standing fences.
- Deciding any §4 item autonomously.
