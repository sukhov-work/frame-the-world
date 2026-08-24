# BEST SPOT — observability heatmap for sun/moon rise & set

**Authored 2026-08-23** by a 13-agent `/frame` + `investigate-design-v3` pass (8 research tracks →
architect → 3 adversarial lenses → consolidator). Owner rulings folded in 2026-08-24 (§0).
Log: `mem:project/wip-2026-08-23-bestspot-heatmap`. Twin: DECISIONS 2026-08-23.

> **The one-line thesis.** Per-cell horizon profiles are hopeless (one profile costs 0.1–0.45 s →
> 8–35 hours for a 300 m disc at 1 m, measured). Invert it: rasterize ONE local height field, then
> sweep it per azimuth. **The per-ray upper convex hull is invariant in BOTH scene time AND eye
> height** — so the scrubber and the altitude slider only ever pay a cheap query.

---

## 0. Owner rulings (2026-08-24) — binding

| # | Ruling |
|---|---|
| **R1** | **DRONE semantics above 5 m.** Below 5 m the ground mask gates (no water, no buildings). At/above 5 m only solid INTERIORS are masked (`render_min_height ≤ h < render_height`), painted as a distinct **AERIAL** class. Owner's stated preference was "a place I can climb to" — so every cell ALSO carries a cheap `groundReachable` bit (is the cell directly above accessible ground?) as a secondary readout. Primary use is a pedestrian photographer; aerial is capability, not the main path. |
| **R2** | **FPV is a CENTRE SOURCE but renders NOTHING in the viewfinder.** Toggle enables when `tempPin != null \|\| fpvActive`. In FPV it solves at the walked eye (nadir if flying); re-toggling re-solves at the new position; leaving FPV keeps the last field until the toggle goes off. **No sheet, no contours, no plumb line inside FPV.** See §9 for why, and what to change if this is revisited. |
| **R3** | **Field at 3 m by default; 1 m reserved for ULTRA.** ("1 m was just a ballpark.") The top-K shortlist is ALWAYS re-solved at 1 m regardless of tier — that is the number the user walks to. |
| **R4** | **GL overlay only** (3D orbit + desktop nadir/flat map + `/m` 2D — one scene, three surfaces). The MapWindow/MiniMap DOM-canvas twin is DEFERRED (§10 S9). The sheet needs a **radial falloff at the rim**, distinct colour/definition, and must not obscure the map. **The hollow cylinder is REPLACED by a centre PLUMB LINE** — a vertical normal from the map point up to the sheet's altitude, carrying an altitude label, legible from directly above as well as obliquely. |

### Rulings R5–R8 (2026-08-24, second round — after the measurement pass)

| # | Ruling |
|---|---|
| **R5** | **GENERALIZE THE FRAMING TERM.** Owner: *"do not bind too much specifically to bridge — I am interested in sun visibility over a LARGE RANGE OF LANDSCAPES, OBJECTS, BUILDINGS etc."* `F_sil`'s `isBuiltSrc` provenance gate is **DELETED** — measured, it scored a grazing 8 km mountain ridge at **0.0000**, ranking it below a blank wall and below empty sea. Replaced by **GRAZE** (`SPEC_V2 §1.1`): `cut × Q × dwell`, where dwell is the body's travel in disc-radii while the edge cuts it. Provenance survives ONLY as a soft confidence weight (`terrain 1.00 · building 0.90 · deck 0.90 · tree 0.45`, tree clamped ≤ 0.6 because 151,046 of 161,823 canopies are synthetic scatter). Measured: the same ridge scores **0.9897** grazing / **0.4830** perpendicular, and F's correlation with P falls from **r² 0.997 to 0.392** — it finally carries independent ranking signal. Owner-facing name: **GRAZE**. |
| **R6** | **OPEN AT 1.7 m, AND AUTO-SUGGEST THE LIFT.** Measured: at pedestrian height a real central-Dnipro disc is **97.7 % black, max score 0.381, median 0.000**; at 57 m every cell clears 0.5. Eye level is the honest default and the top-8 markers ARE the product. But when the field is nearly empty the panel must offer a way out: if the fraction of cells scoring above `displayLo` falls under `BESTSPOT.emptyFieldFrac`, probe a few lifts at the 24 m coarse rung (21 ms each — 10/20/40/80 m ≈ 85 ms total), pick the LOWEST lift that clears the floor, and show a one-tap chip — *"NOTHING CLEARS THE SKYLINE AT EYE LEVEL — TRY 30 m"*. The suggested altitude is **computed, never a constant**. |
| **R7** | **MOON WORTH KEEPS MULTIPLYING, BUT THE FLOOR RISES.** Measured over 30 days at Dnipro, `worth` runs min 0.0003 / median 0.0290 / max 0.8639, so on a median night the best possible moon cell scored ~0.020 — 25× below the legibility floor, i.e. the moon map was black ~26 nights in 30. Owner ruling: **raise the floor so bad nights DIM rather than VANISH**, keeping the multiply. Shipped form `M_eff = worthFloor + (1 − worthFloor)·M`, `worthFloor = 0.35` (proposed, tunable): median night → 0.369 so the best cell reads 0.31, full moon → 0.91 so it reads 0.77. Separation preserved, nothing disappears. `worthFloor` is a **recompose-class** leaf (0.27 ms) so it is a taste-pass slider, not a rebuild. |
| **R8** | **THE 1 m SHORTLIST SPLITS IN TWO.** Measured, 1 m vs 3 m is Spearman **ρ = 0.969**, mean \|ΔS\| 0.0054, and changes 4 of the top 20 — but the two halves cost wildly differently. **1 m ACCESSIBILITY on every solve** (+59 ms, invisible; it is what says "stand on the footpath, not in the hedge", and the resolution the landcover data actually supports). **1 m OBSTRUCTION only behind a user-triggered `REFINE THIS SPOT`** (~1.0–1.6 s: `queryRay` is 6.6 ms but it needs a 985 ms 1 m hull, 900 MB resident at K=40, so it must stream). **This is the one place a spinner is justified.** Rider: **forbid ULTRA above a 300 m radius** — 1 m @ 500 m is 1,002,001 cells at ~12.2 s. |

---

## 1. What it does

Given a **centre** (the `look from here` temp pin, or the FPV eye), a **radius** (300 m default;
100/200/400/500) and an **event kind** (SUNRISE / SUNSET / MOONRISE / MOONSET), score every ground
cell in the disc for how good it is as a place to stand and watch/photograph that event — live under
the time scrubber and a real altitude sheet.

Hero cases the metric must actually rank first:
- **sun setting behind a bridge** in Dnipro (a distant BUILT silhouette the disc straddles);
- **moon rising between buildings** (a narrow notch in the skyline flanked by taller mass);
- a **clean horizon-level** view (open sky at the contact azimuth).

---

## 2. The five findings a future session must not relearn

### F1 — The naive generalization is 8–35 hours, measured
`planFeed` builds ONE profile per anchor: 120 az bins × 21 terrain samples = **2,520 raycasts**, and
`ground.heightAt` is a full `three.Raycaster.intersectObjects(tiles.group.children, true)` from 12 km
(`scene/imageryGround.ts:679-689`) — measured **18–58 µs/ray** warm, and it bypasses
3d-tiles-renderer's own bounding-volume traversal (`TilesGroup.js:19-30`; no `three-mesh-bvh` in this
repo). Plus a mesh edge sweep whose subdivision density is a function of the EYE's closest approach
(`occlusion.ts:110-127`) — i.e. **structurally non-reusable across eyes**. Total ~0.1–0.45 s/profile.
A 300 m disc at 1 m is 282,743 cells.

### F2 — THE REFRACTION MIX IS A 2.37-SOLAR-RADII LIE (blocker, would have shipped silently)
The skyline `H` is an **APPARENT terrestrial angle** by shipped contract (the march subtracts
`d²(1−k)/2R`, `azAltOfEcef` adds `k·d²/2R`, `horizonProfile.ts:10-13`). But `bodies.horizontal()` is
**AIRLESS** by shipped contract (`bodies.ts:124,139`). Comparing them directly is a **0.6243° error at
the event instant** — 2.37 solar radii, in a feature that lives entirely inside a 0–2° band.
**Fix:** `altApp = altAirless + Refraction("normal", altAirless)` using astronomy-engine's exported
`Refraction` (`node_modules/astronomy-engine/esm/astronomy.js:6361`). The two refractions still never
mix: astronomical 34′ stays inside astronomy-engine, terrestrial `k = 0.13` stays inside the profile.
Symptom if you skip it: `V` over a PERFECT open horizon comes out **0.698**, so a gate anchored at
0.75 is unreachable and every cell reads mediocre.

### F3 — A MAX-ONLY PROFILE CANNOT SEE UNDER A BRIDGE (blocker; it is the hero case)
`HorizonProfile` stores a per-bin MAX. A deck 10 m over the water at 1.5 km occupies `[0.306, 0.382]°`
— a max profile declares everything below 0.382° blocked, so **"sun setting behind the bridge" and
"blank 15-storey wall" become the same object**, and the wall then *outscores* an open river horizon
by 4.4 % (same landcover) to 55.6 % (unmapped bank). **Fix:** floating solids are swept analytically
into an explicit **band list** `[lo_k, hi_k]` per ray, separate from the ground horizon `Hg`. They are
rare (tens per disc), so this is cheap.
**Rider:** `scene/vectorTiles.ts:329` currently throws bridge decks away —
`if (f.type !== 2) continue; // skip the schema's polygon features — plazas/piers`. Probed: a
**29,054 m² deck** at 48.47831,35.05757 and 11,652 m² at 48.48506,35.02557 in central Dnipro, plus 29
pier polygons and 16 pedestrian plazas in the 3×3 ring. The Central Bridge tile measures
**water 91.2 % / road 5.0 % / DECK 3.8 %** — the deck IS the standable strip over the river, and it is
the owner's hero location.

### F4 — CURVATURE MUST BE FOLDED IN *BEFORE* THE HULL
Apparent elevation is `atan2(h − eye − d²(1−k)/2R, d)`. The drop term is **convex**, so
`Z′ = Z − d²·drop` is `Z` plus a **concave** function — which **ADDS hull vertices**. A sample interior
to `hull(Z)` can be the true horizon setter of `hull(Z′)`. Verified counterexample: samples at
`d = 1,2,3` with `Z = [0, 0.9, 2]` — the middle sample is NOT on `hull(raw Z)`, but from an eye at −1 it
IS the true maximum apparent elevation (−2.86° vs −26.57°). Applying curvature only at hull candidates
under-reports the skyline, worst at long range — exactly where the "far in the distance" term pays.
**Fix:** `zs[s] = heightAt(s) − s²(1−k)/(2R)` before the monotone stack. One multiply per sample.

### F5 — THE GPU PATH IS REFUTED (three independent breakers)
1. Its "361,201 fragments" is the **cell** count (601²) — that only happens inside an offscreen 601²
   render target, which needs a `WebGLRenderTarget` (the first in `src/` outside
   `GlobeCanvas.tsx:279`), a second `renderer.render()`, the `shadowMap.autoUpdate` bracket (three
   re-renders the ENTIRE shadow map on every `render()` — already a pinned fence at
   `GlobeCanvas.tsx:585-593`), and `readRenderTargetPixelsAsync`, which **throws on any non-RGBA
   target**. That is four mechanisms, the exact count used to reject the pure-GPU option.
2. The one genuinely-single-mechanism reading (score inside the sheet's own material) is worse: at
   `dprCap 2` a 1512×982 viewport is a 3024×1964 = 5.94 M-fragment buffer, and it is paid **every
   frame**, twice on `/m` (the PiP re-renders the scene).
3. The headroom it was budgeted against is wrong in both directions: 4.3 ms is the ULTRA-**OFF**
   figure (30.7 ms) while every GPU argument assumed ULTRA-**ON** (36.1 ms ⇒ **−1.1 ms**), and under
   the ULTRA pin the governor's results are **discarded**, so there is no backstop at all.

Reusing the shipped directional shadow map was separately rejected on seven verified breakers (one
shadow light; latched `mapSize`; a second `DirectionalLight` forces a full material recompile and
darkens every ground `ShadowMaterial` twin; terrain does not cast outside ULTRA; the rig itself refuses
below 0.46° elevation because "a below-horizon sun projects garbage" — and the hero cases are 0–2°).

**⇒ All-CPU, one long-lived module worker. No GPU compute in v1.**

---

## 3. The metric

### 3.1 Shared per-disc precompute (cell-independent — one track serves the whole disc)

```
t0     = SearchRiseSet(...)            the REFRACTED event instant at the disc centre.
                                       Every elevation goes through planElevationsM (planner.ts:63-113):
                                       Atmosphere() THROWS outside [-500,+100000] m, and SearchRiseSet
                                       builds a SECOND observer at height - metersAboveGround.
WINDOW = [ airless alt +4°  ..  t0 + (time to fall 3ρ below the crossing) ]
                                       measured at Dnipro: ~30 min, azimuth sweep 5.5-7.5°,
                                       descent 0.1608°/min. The lower extension exists so a LIFTED
                                       sheet or a cell on a bluff can still be scored.
TRACK  = altApp(az), reparameterised by AZIMUTH, not by time.
                                       Both az(t) and alt(t) are monotone over the window, so each
                                       swept ray has exactly ONE crossing time. This removes the
                                       F_sil time-sampling aliasing (kernel half-width ρ = 1.02
                                       two-minute samples ⇒ 0.51..1.00 swing on identical geometry)
                                       and collapses J and K into one index.
altApp = altAirless + Refraction("normal", altAirless)        <- F2
w(a)   = |dt/daz| · exp(-max(0, altApp(a)) / 2.5°)            normalised; the last ~2° dominates
ρ(t)   = angularRadiusRad(R_body, dist)·180/π                 sun 0.262-0.271°, moon 0.245-0.279°
```

**Parallax invariance (pin this as a unit test).** The dominant per-cell term is NOT lunar parallax
(0.27″ over 500 m) but the **rotation of the local vertical**, `500/6371000 rad = 16.2″ = 1.7 % of ρ`.
Both are far below `ρ = 949″`. Per-cell work is **pure occlusion**. The eclipse session proved this
geocentric/topocentric distinction is the repo's most expensive recurring bug class.

### 3.2 Per-cell ray evidence, per swept azimuth `a`

| Field | Meaning |
|---|---|
| `Hg(a)` | **SIGNED** apparent elevation of the GROUND horizon (terrain + solids resting on ground + trees). **NOT clamped at the eye dip** — a cell on a bluff above the river has a DEPRESSED horizon; `createProfile` floors every bin at the dip (`horizonProfile.ts:44-47`) and can only rise, so it cannot tell a bluff from flat ground. |
| `bands(a)` | Angular extents `[lo_k, hi_k]` of **FLOATING** solids crossing the ray — decks, arches, piers (F3). |
| `D(a)` | Distance (m) to the geometry that set `Hg(a)`, or to the nearest band edge. **THE NEW FIELD.** Today's `HorizonProfile` carries no distance, so "sets behind a far bridge" is indistinguishable from "behind the fence 4 m away". `marchTerrainBin` already computes `d` at the winning sample and discards it (`horizonProfile.ts:185-193`). GRASS `r.horizon` carries exactly this as its `-l` output. |
| `src(a)` | Setter tag: `terrain \| building \| tree \| deck`. Replaces "H exceeds the terrain baseline by >0.1°", which is a threshold on a **height** difference of `1.745e-3·D` m (2.6 m at 1.5 km) decided by the least reliable channel in the pipeline (~145 m-posted terrain, 29 verts on the river tile). The tag is exact and free. |
| `known(a)` | 0/1 evidence flag. |
| `openSky(a)` | 0/1 — the hull found nothing and the far profile is terrain-only. An explicit boolean, **not** the fragile float test `H == openSkyAltDeg`. |

### 3.3 The visibility atom

```
blocked(el, a) = (el <= Hg(a)) OR (∃k: lo_k(a) <= el <= hi_k(a))
f(a)           = visible AREA fraction of the disc centred at (a, altApp(a)), computed as the disc
                 area not covered by the union of blocked bands, integrated over the disc's
                 azimuth COLUMNS.
```
**Why columns, not a chord.** `f = (acos u − u√(1−u²))/π` is a **horizontal**-chord segment evaluated
from ONE centre-azimuth sample. Every occluder in both hero cases cuts **vertically** (a tower flank;
the two buildings making the gap), so a vertical edge flips `f` from 0 to 1 in one bin. At
`azStep 0.25°` a solar disc (2ρ = 0.527°) spans **~2.1 columns** — the honest limit, and it goes in
the UI: *a vertical edge is resolved to about half a disc.* `azStep` is a tunable; 0.125° (4 columns)
is available on desktop-high at 2× sweep cost.

### 3.4 The terms

```
V   = Σ known(a)·w(a)·f(a) / Σ known(a)·w(a)
      HONESTY: samples with known(a)=0 are DROPPED FROM BOTH SUMS, never scored as f=1.
      The shipped convention is that an unsampled bin REPORTS OPEN SKY (createProfile fills altDeg
      with openSkyAltDeg and leaves known=0), so an ungated V is inflated by ignorance — and V is
      the term that decides whether the body is there at all.
C   = Σ w(a)·known(a) / Σ w(a), over the FULL swept span (window + shoulders).
      NOT ±3° around contact: az* sits at the END of the window by construction, so a ±3° window
      audits only half of what V integrates.
az* = the largest a with f(a) >= 0.5;   alt* = altApp(az*)     (per-ray interpolation, no bisection)
L   = 1 - smoothstep(dipFloor, +5°, alt*)                       CONTACT LOWNESS
      dipFloor = horizonDipDeg(eyeM + lift, PLAN.refractionK)
      1.7 m -> -0.038° | 100 m -> -0.299° | 400 m -> -0.599° | 2000 m -> -1.339°
P   = openSky ? 1 : clamp01( ln(D*/30) / ln(PLAN.trustRadiusM/30) )     DEPTH / OPENNESS
      log-scaled: apparent size and the alignment gradient are both ~1/D.
F   = max(F_sil, F_notch)                                       FRAMING (the two hero kernels)
  F_sil   = max_a [ (1 - clamp01(|altApp(a) - edge(a)|/ρ)) · P(a) · isBuilt(src(a)) ]
            a triangular TANGENCY kernel of half-width one disc radius, gated on a BUILT setter.
  F_notch = [alt* - floor >= ρ]
            · clamp01((depth - 0.1°)/(3° - 0.1°))
            · clamp01((2° - width)/(2° - 2ρ))
            floor = Hg(az*), shoulders sL/sR = max Hg over [az*-3°, az*-ρ] and [az*+ρ, az*+3°],
            depth = min(sL,sR) - floor, width = angular measure of {a: Hg(a) < alt*} around az*.
            0.1° is HeyWhatsThat's "a few arcminutes" salience floor — below it the notch is mesh
            noise and the map speckles.
A_hard ∈ {0,1}, A_soft ∈ [0.1,1]                                ACCESSIBILITY (§4)
M(kind, day)                                                    MOON-EVENT WORTH (scene scalar)
      = moonPhaseIntensity(phaseAngleDeg) · twilightGate(sunAlt at contact)
      twilightGate = 1 on sunAlt ∈ [+0.5°, -6°], ramp to 0.25 outside.  1 for sun kinds.
      Krisciunas-Schaefer: a quarter moon is ~9 % of full, NOT 50 %. Without M the feature lists
      353 mostly-worthless moonrises a year with equal confidence. ONE SCALAR, zero per-cell cost.
```

### 3.5 Composition — gates multiply, preferences sum

```
IF C < PLAN.minCoverageForGaps (0.5)  ->  UNKNOWN
   a distinct render class: NO INK, excluded from the top-K ranking, counted in a "% UNMAPPED"
   status line. NEVER 0, never a cold colour, never green.
ELSE
S = A_hard · A_soft^0.5 · M · G(V) · [ 0.15·V + 0.30·L + 0.25·P + 0.30·F ]
    G(V) = smoothstep(0.15, 0.75, V)
```

- **`A_hard` multiplies** — a cell in the Dnipro is not a spot at any framing score. A sum would let
  `F = 1` paper over standing in the river.
- **`G(V)` multiplies but is SOFT** — "the body is not visible from here" is a gate, not a preference.
  It must be a smoothstep and not a step because the hero case `F_sil` **intentionally occults the
  disc** for part of the track; a hard `V = 1` test would delete every silhouette shot.
- **`M` multiplies** — a 9 %-lit quarter moon rising in daylight is not a good spot however clean the
  horizon, and it makes the moon map go quiet at the wrong times, which is honest and legible.
- **`L, P, F` SUM** — these genuinely trade off. A clean 30 km horizon (`P=1, F=0`) and a bridge
  silhouette (`F=1, P=0.9`) are BOTH correct answers to "where should I stand", and multiplying would
  zero the clean-horizon case the owner explicitly listed as good.
- **`A_soft^0.5`** — 36.1 % of a dense Dnipro box is UNKNOWN landcover (measured, 600 m @ 1 m). At
  `A_soft = 0.45` for unknown, `^0.5` gives 0.67: a real penalty that cannot delete an otherwise
  excellent spot. Raw multiplication makes the map read as a landcover map.

**Display normalisation.** The GL ramp reads **absolute** `S` (an all-bad disc must look all-bad). The
panel's spot list may use the `pp-mw__bar` relative bar, but **must print the absolute value beside
it** — otherwise "best of a bad lot" reads as "great".

---

## 4. Accessibility (R1 — drone above 5 m)

Source is the **already-streamed** OpenFreeMap z14 MVT (`scene/vectorTiles.ts`), parsed CPU-side and
three-free. Measured: rasterizing a 600×600 m box at 1 m — 13,383 building rings + 5,741 road lines +
water/green — costs **31.0 ms / 352 KB**. Paint order (verified to give the right answer):
`green → landuse → water → road ribbons → path ribbons → decks → buildings LAST`.

```
h < 5 m   (GROUND rules)
  A_hard = 0  if inside a building ring
            || inside a water polygon (the Dnipro is class "lake" in OpenMapTiles)
            || inside a waterway centreline stamped at VECTOR.waterwayWidthM
               (river 12, stream 4, canal 8, drain/ditch 2), honouring brunnel=tunnel + intermittent
            || landuse ∈ {military, industrial, railway, quarry, landfill, construction}
            || access=no / private
  OVERRIDES that beat the water mask (the hero location):
            transportation POLYGONS class=bridge (the deck) · man_made/highway=pier
            · highway=pedestrian + area=yes
  A_soft = deck/pier/pedestrian/footway 1.0 > park/grass/beach 0.9 > pitch/playground 0.85
         > service/residential verge 0.6 > UNKNOWN 0.45 > primary/trunk/motorway 0.15 > wetland 0.1
         (surface=unpaved and foot=no demote; they never certify)

h >= 5 m  (AERIAL class — R1)
  A_hard = 0 only inside a SOLID INTERIOR: render_min_height <= h < render_height
  A_soft = 1
  groundReachable = the ground-rule verdict of the cell directly below (a secondary readout, because
                    the owner's stated preference was "a place I can climb to")
```

**Parser widening — the single highest-value change, ~5 fields, ZERO new fetches.** Guard each with a
unit test on a committed fixture tile:
- (a) keep `f.type === 3` transportation features as a new `kind:"deck"` carrying `class` + `subclass`
  — this alone delivers bridge decks, piers, pedestrian plazas and platforms;
- (b) keep `subclass`, `surface`, `access`, `foot`, `layer` on road lines (the pedestrian taxonomy
  exists and is thrown away: footway 88, pedestrian 31, steps 30, path 26, cycleway 17 in the 3×3);
- (c) keep `class` on water polys (lake/river vs `swimming_pool`);
- (d) add the `landuse` layer to `polyLayers` (493 rings in the 3×3, incl. **military 3**);
- (e) keep `render_height` / `render_min_height` on building polys (present on **every** z14 feature).

**Bug to fix while in there:** `landcover`'s filter reads `class ?? subclass`, but every landcover
feature carries `class` — so the `subclass` branch is **dead** and `GREEN_CLASSES`' `park`/`meadow`/
`recreation_ground` entries can never match. Read `subclass` explicitly.

**What it cannot know (must be stated in the UI):** fences/gates/locked courtyards (274 `gate` +
44 `lift_gate` POI points prove the geometry is missing, not the reality), private land, whether
"grass" is a lawn or a swamp, water LEVEL and bank height (a water polygon is a plan-view outline with
no z), retaining walls, construction, seasonal ice, and the 36 % unclassified.

---

## 5. Architecture — all-CPU, one long-lived module worker

### Three residency tiers

| Tier | Invalidated by | Contents | Cost (M3 Pro, projected @ 3 m) |
|---|---|---|---|
| **T0** | centre **or** radius | 1 m landcover raster + layered DSM + per-ray column **HULLS** (curvature folded in first, F4) | ~105 ms |
| **T1** | **lift or time** | ONE FUSED query+score pass over the resident hulls — per-ray max-angle query, band assembly and metric accumulation in the same loop | ~90 ms · **~6 ms** coarse-during-drag |
| **T2** | per frame | 2 draw calls (sheet, plumb line). No per-frame CPU beyond the low-cadence mirror. | ~0 |

Measured at 601² / 1 m / K=24 (6.79 M cell-azimuth queries): resample+hull **243 ms**, eye-height
query **108 ms**, score arithmetic **100 ms** — ratio 2.24:1. Every rejected option re-ran 351 ms when
only 108 ms changed.

**NO `(H, D)` SLAB IS EVER MATERIALISED.** A stored slab at 1 m × K=42 × 6 B is **139 MB** — the memory
wall. Fusing sweep and score needs ~12 float32 accumulators per cell (`Vnum, Vden, Fsil, altStar,
floorH, Dstar, sL, sR, widthL, widthR, knownW, flags`) = 48 B/cell: **17.3 MB at 1 m**, **1.9 MB at
3 m**. Fusion requires azimuth-**ordered** sweeping, which the notch/shoulder/width running maxima
need anyway.

### Three-zone obstruction model

```
NEAR  0 -> R + 400 m collar   per-cell layered DSM at cellM.
      Sources, priority order: enriched FeatureSeat baseY/topY (CPU-authoritative BY DESIGN,
      DECISIONS.md:231-234) > MVT building rings extruded by render_height/render_min_height >
      trees as analytic spheres (SOFT ONLY).
      Terrain by BARYCENTRIC INTERPOLATION OF THE LOADED TIN — zero raycasts, versus 282,743
      heightAt calls at 26-58 µs = 7.4-16.4 s.
MID   -> ~1,500 m              same DSM at 4x cell size.
      Both fit inside ensureRing(pin, 1)'s WORST-CASE guaranteed 1,622 m at Dnipro's latitude —
      the ring is TILE-centred, not pin-centred, so a pin at a tile edge guarantees only ONE tile
      in that direction. (This is why the far DSM was cut: a 3 km MVT DSM reads from tiles ring 1
      never fetches, over up to half the far annulus, exactly where P is supposed to pay.)
FAR   > ~1,500 m               ONE shared profile at the disc centre from the SHIPPED time-sliced
      marchTerrainBin (PLAN.terrainBinsPerFrame 3, ~63 rays/frame, 40 frames), PLUS a first-order
      per-cell PARALLAX CORRECTION:
          H_c(az) ≈ H_0(az) · (1 + (r_c · u_az)/D_0(az))
      using the new per-bin distance field. A 2° ridge at 3 km moves 0.22° for a 300 m displacement
      = 0.83ρ — across a 1000 m-diameter disc that is 0.5-0.9°, one to two full solar diameters.
      One multiply-add per (cell, azimuth); it deletes the far DSM scale entirely and removes the
      artificial flat patch at 1.5-11 km, which in Dnipro is precisely where the right-bank
      skyline sits.
```

### Worker interop
Long-lived module worker — **a new pattern here** (the one shipped worker is single-shot-and-terminate,
`workerClient.ts:45,78-80`). Transferable ArrayBuffers only; **no SharedArrayBuffer** (COOP/COEP
unverified on Wix hosting, `decode/worker.ts:8-9`).
**The worker re-fetches and re-parses MVT itself** — `@mapbox/vector-tile` and `pbf` are already
Vite-pre-bundled because the main thread imports them, so no new `optimizeDeps` entry and no
"optimized dependencies changed" reload; `force-cache` serves the bytes. Reading the existing MVT
handle is impossible: `attachVectorTiles()` is instantiated once inside the orchestrator closure and
its cache is a nested `[number,number][][][]` — a deep structured clone on the main thread, recurring
on every rebuild, and the 56-tile FIFO cache can evict under it.
TIN triangles and enriched `FeatureSeat` runs are flattened to typed arrays on the main thread and
transferred as **copies** — never detach a live `instanceMatrix`.

---

## 6. Render (R4)

**A new mesh class — NOT `tangentOverlay`'s flat grammar.** `makeFlatOverlayMaterial` is
`depthTest:false / depthWrite:false / DoubleSide`, and its own docblock says why: *"a metre-scale plane
cannot follow terrain relief, and a planning overlay reads THROUGH the world."* Both owner
requirements — respect the terrain under each cell, and do not obscure the map — are the two things
that grammar cannot do.

- **Sheet:** a COARSE **terrain-conforming** grid (64×64 verts, heights from the same DSM, rewritten
  **in place** on lift change — the `focalCone` allocate-once lesson), `depthTest TRUE` +
  `polygonOffset` (the `vectorFeatures` precedent), `renderOrder 9` set **per object** (a Group's
  renderOrder does not propagate), `raycast` disabled, `frustumCulled false`.
- **Score texture:** RG8 `DataTexture` (`.r` score, `.g` class/validity), `NoColorSpace`, allocated
  once at the **max grid over the whole tier ladder** — note the largest grid is at the SMALLEST
  radius (3 m @ 300 m = 201² beats 3 m @ 500 m = 334²… compute it, do not assume). **Full-surface
  `texSubImage2D` only**: three 0.185 hard-codes `componentStride = 4` (`three.module.js:11804`), so
  ranged uploads on RG8 silently scramble rows.
- **LUT:** a 256×1 `SRGBColorSpace` ramp. Data = `NoColorSpace`, colour = `SRGBColorSpace` — swapping
  these is a previously-shipped bug class here.
- **Ramp:** **INFERNO** (monotone OKLab lightness 0.048 → 0.978), the documented "semantic heat"
  exception to the no-rainbow rule, with a mandatory scale legend. **Turbo behind an A/B chip** so the
  owner can judge it in the real scene. *Measured why:* composited at alpha 0.6 over `--color-bg
  #05070b`, Turbo's hot end `#7a0403` reads **1.27:1** and its cold end `#30123b` reads **1.11:1** —
  Turbo's lightness runs low→high→low, so **both ends of the scale become the least visible things on
  screen**. Inferno reads 7.01:1 at the hot end and keeps ~75 % of the colour separation.
- **Alpha:** score-keyed `a(s) = 0.04 + 0.58·s²`, fill capped at `BESTSPOT.fillAlphaMax ≤ 0.25` (the
  VECTOR ceiling, halved on owner order 2026-08-21). Below ~50 % score the sheet is literally
  indistinguishable from the map at contrast < 1.1.
- **Contours:** `fwidth`-antialiased isolines with a dark `tokens.bg` halo carrying the reading (the
  FOCALCONE doctrine + the `streetNames` halo recipe: measured 6.82:1 halo-vs-light-tile, 11.23:1
  ink-vs-halo). Alpha-blended, **never additive**. No stipple — the ground already carries two dither
  grids.
- **Rim falloff (R4):** radial alpha falloff over the outer ~8 % of the radius, so the disc dissolves
  into the map instead of ending on a hard circle.
- **UNKNOWN** is a distinct class: no fill, dotted boundary, its own legend entry — never a cold
  colour, which would read as "bad spot".
- **PLUMB LINE (R4, replaces the hollow cylinder):** a vertical normal from the centre ground point up
  to the sheet altitude — a thin ink line + a **billboarded `CanvasTexture` altitude chip** (the
  `aimCones` 'N'-marker recipe + the `placeMarkers` angular-size clamp) + a small **ground tick** at
  the base so the anchor still reads when the line degenerates to a point at nadir. **At nadir the
  NUMBER is the source of truth, not the mesh.**
- **NOT rendered in FPV** (R2) — see §9.

---

## 7. Seams and fences

- Pure metric + sweep in `src/lib/geo/**` — three-free, vitest (the `horizonProfile`/`occlusion`
  precedent). `lib/` and `store/` MAY import tunables from `components/globe/tuning.ts` (sanctioned
  cross-layer edge; `tuning.ts` is verified three-free, so the worker can import it).
- `scene/bestSpotFeed.ts` must be **ADDED to the SANCTIONED store-bridge map** in
  `test/components/globe/fences.test.ts` — today only `planFeed → store/plan, store/sky` and
  `minimapFeed → store/minimap`. A deliberate, reviewed edit.
- `stepBestSpotFeed` goes in the **FEEDS-LAST band immediately after `stepPlanFeed`**. NOT after
  `stepKeyLightAndShadow` — that is ~20 steps earlier and on the other side of `++frameCount`, which
  lives inside `stepFrustumResnapAndTick` and splits every cadence gate into pre/post groups, so the
  two plan-family mirrors would land on alternating frames.
- Mirror via `_syncBestSpot` at `PLAN.mirrorEveryFrames` cadence with a quantized change signature and
  **allocate-once typed arrays** — `planFeed`'s `binsMirror` identity rule is load-bearing for React
  memos.
- Centre resolved through the **already-hoisted `aimAnchorFor()`** (`lib/geo/aimAnchor.ts:56`), never a
  fresh ladder — a hand-written copy is the exact defect T36 fixed on three surfaces at once. Note the
  temp pin is **not** a plan anchor (`planFeed`'s ladder is `photoApex → fpvEye → focus`, no tempPin
  rung), so `plan.profileBins` may **not** be lent to this disc.
- **Desktop-first gate:** every BEST SPOT engine read AND-ed with `!isMobileShell &&
  !coarsePointerShell`, fenced in `fences.test.ts` **in the same slice**. The GL scene is shared with
  `/m` (`m.astro` mounts the same `GlobeCanvas`) and `ftw:view-prefs` is ONE localStorage key shared by
  both shells on the same origin — the fence must be **at the read**, exactly as the ULTRA HQ fence is
  (`const hqAllowed = !isMobileShell && !coarsePointerShell;`, `StylizedTiles.ts:729`).
- Radius/kind chips + altitude slider in `src/components/controls/**` from day one (verified leaf
  whitelist: react + store + lib + styles + `globe/tuning`), so the feel cannot fork when the `/m` twin
  lands — `ui/Slider` is unreachable from mobile by fence rule 1.
- BEST SPOT = a **third segment** of `PlanFindToggle` in the shared `planfind` window (PLAN and FIND
  already share one drag/resize session key and are mutually exclusive at click time).
- `BESTSPOT` tuning group: pure data, no three import, **no colour literals**. The heat ramp lands as
  tokens in `src/styles/tokens.css` regenerated into `lib/theme/tokens.ts`, assembled in
  `lib/theme/heatPalette.ts` (the `findPalette` precedent).

---

## 8. The honest resolution ladder (R3)

| Layer | Truth |
|---|---|
| **Accessibility / landcover** | **1 m.** MVT z14 quantises at 0.396 m/unit at Dnipro, so coordinates are sub-metre — but the polyline is GENERALISED at the 5–20 m chord scale (measured: water median 5.5–16.8 m, buildings 7.8–12.3 m), so class boundaries carry a **1–2 cell uncertainty ribbon**. Draw it. |
| **Obstruction / score field** | **3 m default** (R3) · **1 m under ULTRA** · 6 m on mid tier · **refused** on low / coarse-pointer. |
| **Shortlist (top-K)** | **1 m always**, every tier. Re-solve the top ~256 candidates at 1 m — the number the user walks to, and nearly free. |
| **Azimuth** | 0.25° over the window (~2.1 columns per solar disc), 0.5° over the shoulders. A vertical building edge resolves to ~half a disc. 0.125° available on desktop-high at 2× sweep cost. |
| **Ground elevation** | **~145 m effective posting** over Dnipro (GLO-30 baked to L13; the city-centre tile 13/9787/6301 decodes to **188 vertices over 3.965 km²**, the river tile 6302 has **29**), and **~2 km** on plain Cesium World Terrain outside the baked regions. **NOT tunable upward** — mago's decimation is at the source's information limit. |
| **Building heights** | Metre-exact where the enriched bake has real geometry; elsewhere OSM-derived with **~78 % defaults** (`heightSources.default` 99,590 of 127,890). |
| **Vegetation** | **Fiction at the individual level**: 151,046 of Dnipro's 161,823 canopies are seeded scatter with jittered class-default heights, only 628 are surveyed points, and outside the two baked cities there are NO trees. **Soft penalty with its own flag; never a hard block.** |
| **UI copy** | *"OBSTRUCTION AT 3 m (1 m AT THE SHORTLIST) OVER TERRAIN AT ~150 m"*. An unqualified "1 m heatmap" is a **C2 violation**. |

---

## 9. FPV — DEFERRED (R2), and exactly what to change if it is revisited

**Owner ruling 2026-08-24: FPV is a CENTRE SOURCE; nothing is drawn in the viewfinder.**

**Why it was parked.** Every GL planning overlay in this app is hard-disabled in FPV on purpose —
`aimCones` and `focalCone` are both constructed with `enabled: !fpvActive`, doctrine *"the viewfinder
stays clean"*. Rendering the sheet there is a deliberate exception to a shipped rule, and it carries
one real cost the owner should judge in-scene before paying: **a 300–500 m disc seen from inside it
covers most of the viewport**. It only stays readable because this design's sheet is
terrain-conforming and depth-tested (it is) — but the fill will still dominate the frame, which is why
the recommendation was contours-only.

**To un-park it, three changes and nothing else:**
1. Drop the `!fpvActive` term from the sheet/plumb-line visibility predicate, scoped so it renders
   **only while the BEST SPOT panel is open** and **only** the sheet + line (no radar fan, no focal
   cone, no other chrome).
2. Default `fill` OFF in FPV — contours + top-K markers only — behind a chip.
3. Give the exception a **named docstring line in `tuning.ts`**, so the next audit reads it as
   intentional rather than as a copied gate with the sign flipped. (This repo has been bitten by
   exactly that shape.)

**What IS built now:** the toggle enables when `tempPin != null || fpvActive`; in FPV it solves at the
walked eye (nadir if flying); re-toggling re-solves at the new position; leaving FPV keeps the last
field until the toggle goes off.

---

## 10. Slice plan

Build invariant: **pure lib + vitest → desktop panel → mobile sheet.** Each done-check must be able
to FAIL — this repo has been bitten five times by checks that could not.

| # | Title | Files | Proves done |
|---|---|---|---|
| **S1** | Pure metric kernel — apparent-altitude track, band occlusion, disc-column fraction, notch, tangency | `lib/geo/bestSpotMetric.ts` + test | 5 pins that each FAIL against the pre-correction design: (1) airless track is a 2.37-ρ lie — a flat open horizon at 1.7 m yields `V ≥ 0.95`; the airless form yields ~0.70 · (2) `F_notch` is not identically zero on a synthetic 1.5°-wide 4°-deep canyon · (3) **a deck is not a wall** — ground horizon −0.04° + deck band [0.31,0.38]° scores strictly higher than `Hg = 0.38°` everywhere; under max-only the wall wins by 4.4 % · (4) ignorance is not clear sky — 40 % `known=0` returns `UNKNOWN`, not 0.7 · (5) lift is monotone across 1.7/100/400/2000 m |
| **S2** | Landcover raster + layered DSM + eye-height-independent hull sweep; MVT parser widening | `lib/geo/{landcoverRaster,localDsm,horizonSweep}.ts` + tests, `scene/vectorTiles.ts` | (1) **curvature before the hull** — `d=[1,2,3], Z=[0,0.9,2]` must return the MIDDLE sample as the setter from an eye at −1 · (2) **the deck survives the parser** — on a committed Central Bridge z14 fixture, ≥2 % of cells class `deck` with `A_hard=1`; the shipped `f.type !== 2` yields zero · (3) hull == brute force to 1e-9 over 100 random columns × 3 eye heights · (4) **hulls are lift-invariant** — the serialised hull is byte-identical across 1.7/100/400 m while the query output differs |
| **S3** | Disc solver in a long-lived worker + `BESTSPOT` tuning + store bridge + orchestrator step + DEV seam | `lib/geo/bestSpotSolver.ts`, `lib/geo/bestSpotWorker.ts`, `scene/bestSpotFeed.ts`, `store/bestSpot.ts`, `tuning.ts`, `StylizedTiles.ts`, `fences.test.ts` | `scripts/verify-bestspot.mjs` **cross-model check**: seat FPV at the top-ranked non-deck cell via the shipped tempPin+tempFpv path, wait for `planFeed`'s own profile (raycasts + `sweepMeshEdges` — machinery this feature does NOT share) and assert `isBlocked(binAltDeg, azStar, altStarApparent) === false`; the lowest-ranked accessible cell asserts `true`. Negatives: a pin mid-reservoir returns 0 candidates and every cell `A_hard=0`; a rural pin returns `coverage < 0.5` and verdict UNKNOWN, not a warm uniform disc |
| **S4** | GL render — terrain-conforming depth-tested sheet, contour shader, rim falloff, heat tokens, plumb line + altitude chip | `scene/bestSpotSheet.ts`, `lib/theme/heatPalette.ts`, `styles/tokens.css` | Read the **live** material and scene graph (the `__globe.ultraLook` lesson): `depthTest === true` (FAILS if `makeFlatOverlayMaterial` is reused), max sampled fragment alpha ≤ `fillAlphaMax` ≤ 0.25, score texture `colorSpace === NoColorSpace` and LUT `=== SRGBColorSpace`, `renderOrder === 9` on every child individually, zero colour literals in the `BESTSPOT` tuning block. Shots `bestspot-01-nadir` / `-02-oblique` proving the map reads through, UNKNOWN is visually distinct, and the plumb line + chip are legible from directly above |
| **S5** | Desktop surface — BEST SPOT as the third `planfind` segment, shared controls, legend, top-K list | `panels/BestSpotPanel.tsx`, `controls/*`, `panels/PlanFindToggle.tsx`, `styles/*` | `astro check` + `npm test` clean (mobileFence rule 3 fails if the new controls import outside react/store/lib/styles/globe-tuning). Browser: double-click ground → popup shows a third action → toggle shows three segments → radius row + event row + altitude slider at 1.7 m + legend + "% UNMAPPED" + ≥1 top-K row → hovering row 1 brightens exactly one patch and `__globe.bestSpot().sceneHoverKey` matches |
| **S6** | Live scrub + live lift — the residency ladder, coarse-during-drag, cadence contract | `bestSpotFeed.ts`, `bestSpotSolver.ts` | `hullBuilds` is **UNCHANGED** across a 30-day scrub AND a 2→400 m altitude drag, and increments **exactly once** on a radius change. This is THE falsifiable pin — it fails if the `(H,D)`-slab invariant is ever restored, because that form must rebuild on lift. Plus: coarse-solve p95 < 33 ms, full-solve p95 < 500 ms, mirror < 1 write per 8 frames, published grid ArrayBuffer **identity stable** across a no-op scrub, FRAME_PROBE median < 35 ms for the whole drag |
| **S7** | Honesty layer — built-density prior, provenance badges, 1 m shortlist re-solve | `bestSpotSolver.ts`, `panels/BestSpotPanel.tsx` | Three sites, three DIFFERENT verdicts (impossible before this slice): central Dnipro → `heightProvenance.enriched > 0`; a rural pin → TERRAIN-ONLY class, built density below floor, and **fraction of cells with S > 0.6 is < 0.05** (the pre-fix metric produces ~0.70 uniformly); Everest → terrain-only with real relief. Shortlist cells report `gridCellM === 1` while the field reports 3 |
| **S8** | *(deferred)* `/m` twin — flips the desktop-only shell gate | `mobile/PlanSheet.tsx` | fences assert the gate is named in exactly ONE engine file and every read is AND-ed with it |
| **S9** | *(deferred, R4)* MapWindow / MiniMap DOM-canvas twin | `panels/bestSpotCanvas.ts` | one painter, N surfaces — routed through `slippy.chartTransform`, never re-derived |

---

## 11. Open risks

- **The long-lived worker is a new pattern here.** The shipped one is single-shot-and-terminate. Its
  lifecycle (spawn on first toggle, terminate on panel close or centre change?) needs a decision and a
  leak check.
- **`marchTerrainBin`'s far profile is time-sliced over ~40 frames.** The FAR zone therefore lands
  ~0.67 s after the near field. The UI must show the disc refining, not pretend it is complete.
- **MVT presence is not evidence of survey.** `parseTile` does `if (!layer) continue` — "tile fetched,
  zero buildings" is byte-identical to "OSM never surveyed here". Without the S7 built-density prior a
  rural disc renders **warm, confident and uniform at S ≈ 0.70** with coverage reading 100 %. This is
  the single most dangerous failure mode in the feature.
- **The 56-tile MVT cache is FIFO-by-insertion, and `"failed"` is permanent.** The feature cannot
  assume its tiles stay resident and must degrade rather than blank.
- **C6.** A ~1 m "stand exactly here" surface is a precision artefact over a city at war. It stays
  local and ephemeral, is never persisted onto a public pin, and the bake's military/critical-
  infrastructure blocklist is mirrored as a suggestion suppressor.

---

> **SUPERSEDED IN PART, 2026-08-24 — read `BESTSPOT_SPEC_V2.md` alongside this file.**
> A four-agent measurement pass (latency · framing kernel · tuning architecture · visual) produced
> `.claude/claude-docs/BESTSPOT_SPEC_V2.md`, which **supersedes §3.4 (framing), §5 (residency tiers and
> budget), §6 (render) and §10 (S3–S7)** wherever they conflict, and closes AS BUILT open items 1 and 3.
> Headlines: the §5 budget is off by 2× and 12× · **missing data currently renders as the BEST spot on
> the map** (a truncated disc scores 0.6633 against a true 0.0000) · at pedestrian height a real city
> disc is **97.7 % black** · `F_sil` is replaced by **GRAZE**, which drops the provenance gate so
> ridgelines, tree lines and towers score at all.

# AS BUILT — S1 + S2 (2026-08-24)

**Read this before §3, §4 and §10. The plan above was written by a design pass, not by running the
code, and building it proved the plan wrong in fifteen places.** Every correction below is measured.
Gates at the end of the slice: **vitest 1,560/1,560 (119 files)** · `astro check` 0 err / 0 warn /
5 pre-existing hints · `npx knip` exit-0. Baseline before the feature: 1,373/1,373 (113 files) —
**+187 tests, zero regressions in old files.**

Shipped: `lib/geo/bestSpotTypes.ts` (contract) · `bestSpotTrack.ts` · `bestSpotMetric.ts` ·
`localDsm.ts` · `horizonSweep.ts` · `landcoverRaster.ts` + 6 test files (~9,500 lines total) + an
additive widening of `scene/vectorTiles.ts`.

## THE HEADLINE — both blockers were at SLICE SEAMS, and every slice passed its own tests

An adversarial mutation pass found that **each library was individually correct and the composition
was broken twice**, on the owner's hero case. Neither was visible to any per-slice suite.

1. **THE BRIDGE WAS SCORED AS A PURE LIABILITY.** `RayEvidence.src` was bound to the GROUND setter
   only, and `localDsm` deliberately keeps floating solids OUT of `surfaceTop`/`surfaceSrc` (pin 2) —
   so a genuine deck published `src: "terrain"`, and `silTangency`'s `if (!isBuiltSrc(src)) return 0`
   made the tangency kernel §3.4 wrote FOR the bridge **structurally unreachable**. Measured on the F3
   hero geometry: the same cell scored **0.60799 WITH the deck against 0.62306 with no bridge at all**.
   §3.2 defines the tag over "the geometry that set Hg(a), OR the nearest band edge" — only the first
   half existed. `bestSpotMetric.test.ts` PIN 3 passed **only because its fixture hand-wrote
   `src: "deck"` on a ray the producer cannot emit.**
   **Fixed:** `RayEvidence` now carries `groundSrc`/`groundDistM` AND `bandSrc`/`bandDistM`;
   `src`/`blockerDistM` are REDEFINED as the ray's HEADLINE = the nearer of the two channels.
   `silTangency` walks the ground edge and every band edge, each gated on ITS OWN tag and weighted by
   ITS OWN distance. Composed on the real ephemeris: **withDeck 0.88853 vs bare 0.69606 (+0.19247)**;
   under the faithful pre-fix mutation the ordering flips to 0.65264 vs 0.69606.
   The mirror-image bug is guarded too: gating the ground edge on the headline `src` would score
   **the water under a bridge as a built silhouette** (mutation M2a → 3 red).

2. **47 % OF THE TRACK'S WEIGHT SAT BELOW THE HORIZON, WHERE `f = 0` IS GUARANTEED.** §3.1's window
   extends to `alt(t0) − 3ρ` and adds ±3° of azimuth shoulder (a Dnipro sunset's last sample is
   **−3.51° apparent**), while the weight `exp(−max(0, altApp)/2.5°)` **does not decay below 0**.
   Measured over a PERFECT open horizon at a 1.7 m eye: **V = 0.5138**, `G(V) = 0.657`, `S = 0.41` —
   and §6 says the sheet is *"indistinguishable from the map"* below ~50 % score, so **the best
   possible pedestrian cell rendered invisible.** Only a 2 km sheet saturated the gate.
   `bestSpotMetric.test.ts` PIN 1 reached 0.9566 only because its synthetic track stops at −0.1°; the
   composed system never saw that track.
   **Fixed, two causes:** (a) `EventTrack` gains **`windowLo`/`windowHi`** — the shoulders exist only
   for `F_notch`'s sL/sR and for `C`, and are now excluded from V's two sums; (b) the weight gains a
   **HORIZON CEILING** = the disc's own chord fraction above the OBSERVER'S dip, anchored at the dip
   and never at 0 — which is what finally makes §3.1's lower extension pay for a lifted sheet
   (−0.599° at 400 m, −1.339° at 2000 m) instead of being dead weight. It has no free scale: it is
   exactly what is left of the body. Measured: weight below the dip **0.46879 → 0.00750**,
   **V 0.51376 → 0.96849**, `G(V)` saturates, `S 0.41 → 0.69527`. A 15° courtyard skyline still reads
   `v = 0, S = 0`.

**Process consequence.** `test/lib/geo/bestSpotComposition.test.ts` now exercises the whole chain on
the hero case (real `eventTrack` → real `localDsm` with a floating deck over water → real
`horizonSweep` → `cellScore`). **A per-slice suite cannot catch a seam.** Also: the RED tests were
UNTRACKED when the fix agents ran, so `git diff` could not prove the assertions were not relaxed —
verification fell back to reconstruction-by-reversion (which reproduced `V = 0.5137554515047305`
exactly). **Commit red tests before handing them to a fix pass.**

## Corrections to §3 (the metric)

| Where | The plan said | Measured truth |
|---|---|---|
| §3.4 `F_notch` floor | `floor = Hg(az*)` | **Reads the WALL, not the gap.** `az*` is by definition where the disc straddles a flank, so a single-ray floor samples the flank. On the plan's own 1.5°/4° canyon: `Hg(az*) = 4°`, depth 0, `F_notch` collapses to exactly 0 in `cellScore` while the standalone kernel returns 0.358. **Corrected:** floor = `min Hg` over the disc's own ±ρ footprint. A uniform skyline still yields depth 0, so it cannot invent a notch. |
| §10 S1 pin 2 | a 1.5° canyon returns `F_notch > 0.5` | **Arithmetically impossible** under §3.4's own width kernel: `(2−1.5)/(2−2ρ) = 0.339` is an upper bound before depth and clearance. Break-even width is **1.264°**. Measured 1.5° → 0.3644 · 1.2° → 0.5681 · 1.0° → 0.7039. Pin moved to a 1.2° canyon. |
| §10 S1 pin 5 | a 0-anchor makes `S` **decrease** by 6.3 % at 400 m | **Backwards.** With `edge0 = dip < 0`, `t = (alt*−dip)/(5−dip) ≥ alt*/5`, so a 0 anchor returns a HIGHER-or-equal `L` everywhere. The real damage is **loss of discrimination** — at a 2000 m sheet the whole [−1.339°, 0] band collapses to `L = 1`. Re-pinned as "a 2000 m sheet reading `alt* = 0` must NOT report `L = 1`" (0.885 vs 1.000 = 3.45 points of S). |
| §10 S1 pin 5 | "ONE fixed skyline" | Only meaningful against a **RE-SWEPT** skyline. `RayEvidence` is APPARENT, so the angles are a function of the eye; holding the array fixed makes the CORRECT formula strictly decrease with lift. |
| §3.1 lower window | a fixed `3ρ` below the crossing | **Too short for R3's 2000 m sheet** — `dip(2000 m) = −1.339° = 5.08ρ`, so the tail cannot reach a lifted sheet's own horizon. Must be `dip(maxLift) − ρ − margin`. |
| §3.4 `az*` | "the largest `a` with `f(a) ≥ 0.5`" | Silently assumes a **northern-hemisphere SET**. For a RISE the largest azimuth is the HIGHEST altitude — the opposite of what `CellScore.altStarDeg` documents. Implemented direction-agnostic (min altitude) per the type. |
| §3.4 salience floor | 0.1° "stops the map speckling" | **DEAD at solar/lunar ρ.** `[alt*−floor ≥ ρ]` already forces ≥0.245°, so any notch clearing the width kernel is ≥2.45× deeper. Kept (free), but **a different guard is still needed** for terrain speckle. |
| §3.1 `w = \|dt/daz\|` | — | **Ambiguous quadrature.** `\|dt/daz\|` is a DENSITY; the trapezoid weight is `\|dt/daz\|·Δaz`. With the two-resolution lattice (0.25° window / 0.5° shoulders) they differ by exactly **2× over the shoulders**. Literal form shipped and pinned; the plan should say which it means. |
| §3.1 monotonicity | "both `az(t)` and `alt(t)` are monotone" | **FALSE without a turning-point clamp.** Reykjavík 64.15N 2026-06-21: the sun's nightly minimum is −2.42° while the window floor is −1.66°. Without the clamp the track folds and **nothing throws** — `az*` and the notch's running maxima silently return the wrong answer. |
| §3.1 azimuth | (unstated) | **It WRAPS and it can DECREASE.** Tromsø 2026-05-15 sunrise sweeps 359.97° → 404.60° (a real 0/360 seam inside one track); at Sydney azimuth decreases with time for all four kinds. `unwrapTrackAzDeg` is the seam. Any azimuth-indexed consumer must be told. |
| §3.1 ρ | "sun 0.262–0.271°" | Those are **GEOCENTRIC** and the plan does not say so. Topocentric shrinks the moon ~1.7 % (0.004°) — below every threshold this metric can express, but say it. |
| §3.4 twilight gate | "ramp to 0.25 outside" | **No ramp width given** — a second implementer gets a different moon map. Pinned to shipped constants: upper `LIGHT_DEG.goldenHi` (+6°), lower `LIGHT_DEG.nautical` (−12°). |
| §3.4 dip table | "1.7 m → −0.038°" | That is `horizonDipDeg(1.6)`. At 1.7 m it is **−0.03904**. (100/400/2000 m match to 3 dp.) |
| §3.1 Dnipro numbers | descent 0.1608°/min, window ~30 min | Measured **0.1582°/min**, window **~36 min**, azimuth sweep 6.59°. **Full swept span incl. shoulders ≈ 68 min / 12.6°** — which the plan never states and which is what the solver actually pays for. |

**`new Date(ms)` truncates to whole milliseconds** (ECMA TimeClip) ⇒ ~3e-6° of azimuth at Dnipro. Not
academic: a tight `floor` on the shoulder count **silently dropped the outermost 0.5° step on BOTH
sides**, so the ±3° that `F_notch`'s sL/sR are defined over quietly became ±2.5°. Fixed with a named
`EDGE_SLACK`. S3 will hit the same quantum.

**`eventTrack` returns `null` across the TROPICS, not at the poles.** Measured at lon 0: 2026-06-21 →
null at lat 0/2/5/8/10/12; 2026-12-21 → null at lat 0..10. At lat 0 this is **physics** (the setting
azimuth is stationary at the horizon — 293.44° at t0, rising on both sides). But 2–14° was an
**avoidable bug**: `marchEdgeMs` guarded ALTITUDE monotonicity while the shoulder march's progress
predicate is an AZIMUTH one, so it walked past the azimuth extremum near 26° altitude and poisoned the
grid. Fixed by clamping on whichever turning point comes first — lat 2/5/10/12/14 all recovered.
**The panel copy (S5) owes this limit a line**; lat 0 at solstice is still null by physics.

## Corrections to §4 (accessibility)

- **"The deck IS the standable strip over the river" is WRONG, measured.** In a 500 m box on the hero
  location, **ZERO of 11,703 deck cells were `water`** in a no-deck rebuild: the bridge's carriageway
  and its two footways are LINES, and §4's own paint order puts road ribbons after water, so they
  already lift every deck cell out of the river (~31 m of ribbon vs the deck polygon's 28 m). What the
  deck actually buys is **the VERDICT, not the hard gate**: `A_soft` 0.15 (a trunk carriageway, the
  second-worst rung) becomes 1.0, and the class the panel prints stops being "primary road".
- **A 6th widening was needed.** §4's `A_soft` ladder names `wetland 0.1`, but nothing in the (a)–(f)
  list could ever reach it — landcover's non-green classes are rejected by the green ink filter, so
  `LandClass.wetland` was dead. Rejected landcover features now route to `areas` as evidence (a feature
  is ink OR evidence, never both).
- **§4 tells the raster to honour `brunnel=tunnel` on waterways, but the shipped parser hard-codes
  `tunnel: false` for the waterway kind** — the flag did not exist. Exposed as a new optional `brunnel`
  string rather than setting `tunnel` (non-additive: `minimapFeed` skips `line.tunnel`, so a culverted
  drain would vanish from the shipped FPV mini-map). **SEPARATE PRE-EXISTING DEFECT, out of scope:
  the FPV mini-map draws culverted drains as visible watercourses.**
- **The "dead filter" fix is behaviour-NEUTRAL on the ink side**, contrary to the plan's implication
  that features were being lost: `park`/`meadow`/`recreation_ground` are all subclasses of
  `class = "grass"`, which the class-only read already matched. The falsifiable half is in the
  ACCESSIBILITY read — `subclass = "pitch"` under `class = "grass"` must score 0.85, not 0.9.
- **`parseTile` was closure-local** inside `attachVectorTiles()`, so the widening was observable only
  through a live network fetch — exactly the unfalsifiable-check failure mode this plan opens with.
  Hoisted to an exported pure `parseVectorTile(buf, tx, ty)`; no behaviour change.

## Corrections to the frames (found by the math review, both "two conventions that look alike")

- **`accessAt`'s datum disagreed with its own docstring, so R1's ONLY aerial gate was silently off.**
  It compared an ABOVE-GROUND sheet height against `solidBase`/`solidTop`, which `localDsm` documents
  as ABSOLUTE. A Dnipro cell with ground 100 m under a 59 m building evaluated `10 >= 100 → false →
  hard = 1`: **a drone declared free inside every building.** Fixed by deleting the second site — the
  envelope test now exists only in `localDsm.insideSolidInterior`, and `accessAt` takes a boolean, so
  TypeScript rejects the old call. Mutation → 7 red.
- **The landcover raster was in a DIFFERENT FRAME from the DSM and the sweep.** Equirectangular with
  `M_PER_DEG_LAT = 111_320` vs the true 111_199 m/°lat and 73_810 vs 73_952 m/°lon at Dnipro: a
  **systematic 0.937 m error at 500 m east, 1.418 m at the 700 m collar, 1.875 m at 1 km** — the mask
  and the obstruction field misregistered by 1–2 cells at the rim, in a feature advertising 1 m.
  `localDsm` now owns the frame (`enuFrameAt`/`enuOfLonLat`/`lonLatOfEnu`, built on
  `projection.geodeticToEcef` + `enuBasis`); worst round-trip error is now **1.2e-5 m**. Cost 27 ns/vertex.
- **The disc centre sat on a cell CORNER.** `makeLandGrid` used `ceil(2·halfSpan/cellM)` → **23 of the
  30 canonical (radius, cellM) specs were EVEN**, offsetting the centre by exactly `cellM/2`, while
  `discGridSpec` deliberately forces ODD. One shared `oddSpanCells` now serves both; the two rasters
  are ONE lattice. Mutation → 26 red. (Grid sizes shift by 1: 250 m @ 1 m is 501², not 500².)
- **Longitude did not wrap** — at centre lon 179.999 a point 222 m east read as −40,074,977 m. Fixed
  *by construction*: longitude now reaches the answer only through `cos`/`sin`, so there is no Δlon
  left to forget.

## Open, carried forward

1. **`F_sil` SATURATES TRIVIALLY.** `1 − clamp01(|altApp − edge|/ρ)` reaches 1 for ANY built skyline
   whose edge the body's centre crosses, so in a city **`F ≈ P` for almost every cell** (measured
   0.846 for BOTH the deck and the wall) and the 0.30-weighted framing term carries almost no ranking
   signal. Candidate fixes: gate `F_sil` on the disc actually being occulted, or weight by dwell time
   near tangency. **Owner-visible decision — belongs in S7.**
2. **R1's aerial gate is structurally blind to FLOATING solids.** `insideSolidInterior` reads the
   raster layer; `addFloatingSolid` deliberately writes none of it (pin 2). Both correct alone; jointly
   **a drone parked at 12 m inside the Central Bridge's deck slab reads as free air.** Same bug class
   as the two blockers, on the same object. Pinned with a positive control in
   `bestSpotComposition.test.ts`, NOT fixed: the producer that would populate both channels is S3's
   feed, and whether a deck should be double-represented is a design call.
3. **`LandClass` has no AERIAL member** and `CellAccess` has no aerial flag, so R1's "distinct AERIAL
   class" cannot be expressed. `cls` currently reports whatever DECIDED. **S4 needs a real decision.**
4. **`rail → blocked`** (a hard exclusion for a railway CENTRELINE) is an inference — §4 names `railway`
   only as a LANDUSE class. Documented as the safe direction to be wrong in; needs an owner ruling if
   it ever suppresses a real spot. Same for `intermittent → wetland`.
5. **Multi-tile assembly is untested.** The fixture is one tile; seam behaviour where a feature is
   clipped at a tile boundary and its neighbour supplies the rest has no test.
6. **`accessAt`'s signature changed** — 5th parameter is now `inSolidInterior: boolean`, produced only
   by `localDsm.insideSolidInterior(dsm, cell, sheetHeightAboveGroundM)` at the SAME height. S3 must know.
7. **Perf is UNVERIFIED at plan scale.** `buildLandGrid` measures ~17 ms at 500² @1 m on the hero
   tile — but that tile has 21 buildings and 123 transportation features, not dense Dnipro's 13,383
   rings. `eventTrack` is ~2.8 ms. Neither was measured inside a worker. **§5's T0 ≈ 105 ms / T1 ≈ 90 ms
   budget is still a projection.**
8. Worker import is verified by a static three-free source fence plus a Node/vitest ESM import — **not
   by loading inside a real Web Worker.** Note that `planElevationsM` drags comet/targets/showers into
   the worker chunk; S3 should measure the bundle.
