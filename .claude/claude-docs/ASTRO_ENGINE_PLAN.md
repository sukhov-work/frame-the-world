# ASTRO ENGINE — plan (owner ask 2026-08-03)

Generalise the one-off 10P/Tempel 2 tracer into **"search and track any object in the sky."**
This doc is the execution plan; the shipped comet (DECISIONS 2026-08-02/03, `mem:project/
wip-2026-08-02-comet-10p-tracer`) is the reference implementation and the proof the seam works.

## Owner requirements (verbatim intent)
1. **Search gets a mode toggle** — EARTH (today's Photon/Nominatim place search) ⇄ **SKY**.
2. **SKY mode searches any celestial body** — planet, star, nebula, galaxy, comet, asteroid, etc.
   Search must be **advanced**: good suggestions for crude/misspelled queries.
3. **Once found, behave like the comet did** — track it, marker in the sky, **off-screen hint**
   (the sun/moon FPV edge-chip idiom), **projected trajectory across the sky** (MISSED for the
   comet — carried here), full information panel.
4. **Data: preload as much as possible**, fall back to client-side API calls for the long tail,
   handle the results and render them dynamically.
5. **Every main category gets a realistic treatment** the way the comet did.
6. **Markers must be thin and subtle** — done for the comet 2026-08-03 (hairline broken ring);
   that spec is now the house style for every body type.

---

## What we already have (owner asked — this is the honest inventory)

| Capability | Where | Covers |
|---|---|---|
| Sun, Moon, 8 planets + Pluto | `astronomy-engine` 2.1.19 (ADR D6) | positions, phases, rise/set, illumination |
| Jupiter's Galilean moons | `astronomy-engine` `JupiterMoons()` | Io/Europa/Ganymede/Callisto |
| 9,096 stars to ~mag 6.5 (as baked 2026-07-10) | `public/data/bsc5.bin` (Yale BSC5) | position + Vmag + B−V. **No names, no cross-IDs** |
| ~26 asterism figures | `public/data/asterisms.json` (d3-celestial) | constellation lines only |
| Milky Way | procedural band + NASA SVS haze texture | backdrop |
| 1 comet | `lib/ephemeris/comet.ts` (10P, baked JPL elements) | position, magnitude, tail direction |
| Sun/moon sky arcs | `globe/scene/dayArcs.ts` | the trajectory renderer to generalise |
| Off-screen body chips | `StylizedTiles.stepFpvHudAndSkyMarkers` + `panels/FpvHud.tsx` | sun/moon only |
| Topocentric az/alt + windows | `lib/ephemeris/planner.ts` | rise/set/golden/skyline + `cometWindows` |

**So: the owner is right that "some basic data is already there" — but it is thin.** No object
NAMES (BSC5 ships HR numbers), zero deep-sky objects, one comet, zero asteroids. Everything in
requirement 2 beyond the planets needs new data.

## Hard finding — verified 2026-08-03, this shapes the architecture

**JPL's APIs are NOT browser-callable.** Checked with an `Origin:` request:

| API | `Access-Control-Allow-Origin` | Verdict |
|---|---|---|
| `ssd-api.jpl.nasa.gov/sbdb.api` | **absent** (OPTIONS → 405) | ❌ needs a proxy |
| `ssd.jpl.nasa.gov/api/horizons.api` | **absent** | ❌ needs a proxy |
| `simbad.u-strasbg.fr/simbad/sim-tap` | `*` | ✅ direct from the client |
| `vizier.cds.unistra.fr` (conesearch/TAP) | `*` | ✅ direct from the client |

⇒ The "client-side fallback to NASA APIs" in requirement 4 works for **CDS (SIMBAD/VizieR)** but
NOT for JPL. Small-body lookups need a **thin pass-through Wix endpoint** (`GET /api/sbdb`), which
does not violate C1 — it relays JSON, it computes nothing. Budget it in Phase A.

---

## Architecture

```
                    ┌── bake (offline, committed) ──────────────┐
 search index  ◄────┤ stars+names · Messier/NGC · planets ·      │
 (one compact       │ bright asteroids · active comets          │
  JSON, fuzzy)      └───────────────────────────────────────────┘
        │                                   │
        ▼                                   ▼
  store/sky (target)  ──►  lib/ephemeris/targets.ts  ──►  scene/skyTarget.ts (marker + trail)
        │                   ONE interface, N providers          panels/TargetPanel.tsx
        │                   ├ fixed  (RA/Dec — stars, DSOs)     FpvHud edge chip
        │                   ├ engine (astronomy-engine bodies)
        │                   └ kepler (elements — comets/asteroids)
        └──► miss? ──► client fetch: SIMBAD TAP (name→RA/Dec/type/mag)
                              or /api/sbdb proxy (small bodies → elements)
```

**The load-bearing abstraction** is a `SkyTarget` that every category satisfies:

```ts
interface SkyTarget {
  id: string; name: string; kind: TargetKind;   // star | planet | moon | comet | asteroid |
  aliases: string[];                            //   galaxy | nebula | cluster | shower
  /** ECEF unit direction + distance at an instant — the ONE thing the scene needs. */
  stateAt(utcMs: number): { dir: Vec3; distanceAu: number | null; magnitude: number | null };
  /** Everything the panel shows — free-form per kind, rendered from a typed union. */
  facts: TargetFacts;
  /** Apparent size + orientation for extended objects (DSOs, planets, rings). */
  apparent?: { majorArcmin: number; minorArcmin: number; paDeg: number };
}
```
Position providers behind it:
- **fixed** — precess J2000 RA/Dec → of-date → ECEF via the existing `ecefFrameAt()`. Stars, DSOs.
- **engine** — `astronomy-engine` `GeoVector` for planets/moons, through the same `ecefFrameAt()`.
- **kepler** — the propagator already shipped in `comet.ts`, lifted to take any element set.

`ecefFrameAt()` (extracted 2026-08-02) is already the single frame conversion — every provider
lands through it, so nothing can drift out of the scene's frame.

---

## Data to bake (all permissively licensed — verify each before committing)

| Set | Source | Size | Gives |
|---|---|---|---|
| Star names + cross-IDs | IAU WGSN official names (~450) + HYG v4 | ~200 KB | "Vega", "Betelgeuse", Bayer/Flamsteed, HD/HIP |
| Deep-sky | **OpenNGC** (CC-BY-SA-4.0, 13,957 objects) | ~1 MB raw → ~350 KB packed | NGC/IC + Messier, type, mag, size, PA, common names |
| Bright asteroids | MPC/JPL, curated (numbered + mag < ~12 at opposition, ~300) | ~60 KB | elements + H/G |
| Active comets | MPC `CometEls.json` (~950, already fetched cleanly this session) | ~150 KB | elements + H/G |
| Meteor showers | IMO shower calendar | ~10 KB | radiant + peak dates |

Bake scripts follow the house pattern (`build-star-catalog.mjs`, `build-comet-elements.mjs`):
fetch → pack → commit → a residual/sanity check that fails loud. **Total preload target ≲ 800 KB**
gz, lazy-loaded on first SKY search (never in the boot chunk — the 14-island boot lesson).

## Search (requirement 2 is the differentiator)
- ONE flat index: `{ id, name, aliases[], kind, mag, ra, dec }`.
- Client-side fuzzy ranking: normalise (case/diacritics/greek letters "α"↔"alpha"), token prefix
  match, then Damerau-Levenshtein ≤2 for typos, boosted by **brightness and fame** (Messier and
  named stars outrank an anonymous NGC), penalised by kind when the query hints one ("m31",
  "andromeda galaxy", "comet 10p").
- Query grammar to handle for free: `M31` · `NGC 224` · `messier 31` · `andromeda` ·
  `alpha lyrae` · `α Lyr` · `HR 7001` · `jupiter` · `10P` · `2024 YR4` · `orion nebula`.
- Miss → SIMBAD TAP identifier resolution, then `/api/sbdb` for small bodies. Cache resolved
  objects in `localStorage` so the second search is instant and offline.
- **UI:** the existing `LocationFinder` grows an EARTH/SKY segmented toggle; SKY swaps the
  placeholder, the result-row renderer (kind glyph + magnitude + constellation) and the action
  (track instead of fly-to).

## Render — per-category treatment (requirement 5)
All ride the comet's proven machinery: camera-anchored impostor at `far×0.5` clamped into
`[near·1.2, far·0.95]`, shared `HORIZON_FADE_GLSL`, night gate, **hairline marker**.

| Kind | Treatment |
|---|---|
| Star | point at true colour from B−V, size by magnitude; subtle diffraction spikes only at long focal lengths |
| Planet | disc at TRUE angular size, phase-lit in-shader from the real sun direction (the moon's shader, reused); Saturn gets a ring quad; Jupiter shows the Galilean moons as points |
| Moon (planetary satellite) | as planet, smaller |
| Comet | coma + anti-sunward tail — SHIPPED |
| Asteroid | star-like point, no coma; magnitude from H/G |
| Galaxy / nebula / cluster | soft ellipse at the object's REAL major/minor arcmin and position angle, tinted by type (emission warm, reflection blue, galaxy pale) — this is why `apparent` is in the interface |
| Meteor shower | radiant mark + a few sample streaks near the peak date |

**Marker spec (house style as of 2026-08-03):** broken hairline ring, gaps on the axes, stroke
≈0.012 of its radius, gain ≈0.45, radius ~1.5° so it frames rather than crowds. Never a solid
crosshair — the sky must be visible through it.

## Trajectory (requirement 3 — SHIPPED in phase C, 2026-08-03)
`scene/dayArcs.ts` already draws the sun/moon arc for the FPV anchor. Generalise it to
`scene/skyTrail.ts`: sample `target.stateAt()` across a window (a night for fast movers, weeks for
a comet, a year for a planet — pick from the object's own motion rate), project to the observer's
sky, draw a fading polyline with past/future split and hour ticks. Feed it the SAME target the
marker uses so they can never disagree.

## Off-screen hint (requirement 3 — SHIPPED in phase C, 2026-08-03)
`stepFpvHudAndSkyMarkers` computes screen-space sun/moon chips today. Widen its input from two
hard-coded bodies to `[sun, moon, ...trackedTargets]` and let `FpvHud` render N chips with the
kind glyph. Small, contained change — the hard part (screen projection + edge clamping) exists.

---

## Phasing (each phase ends green and useful on its own)

- **A · Seam + one new category (planets). ✅ SHIPPED 2026-08-03** — `SkyTarget` + the three
  providers (`lib/ephemeris/targets.ts`), `store/sky`, `scene/skyTarget.ts` (comet/point/ellipse
  treatments), `panels/TargetPanel.tsx`, EARTH⇄SKY toggle with the hardcoded index (planets +
  Pluto + ALL 110 Messier via the OpenNGC bake + 10P), `/api/sbdb` proxy, `targetWindows()`.
  10P is now `cometTarget(TEMPEL2)`. Gates vitest 669/669 · astro 0/0; browser state+UI verified;
  **point/ellipse treatments + auto-widened ring visually UNVERIFIED** (hidden-window rAF trap) —
  eyeball first thing next visible-window session. *(Narrowed 2026-08-13, audit C2/D8: the ring
  widening + tracked-DSO flows WERE browser-verified — M31 hit ≈2.5° on 08-03, NGC7000 tracked
  across reload on 08-10 — but no session recorded eyeballing the point/ellipse impostor RENDER
  itself; that remainder is now backlog row T25.)* See DECISIONS 2026-08-03 ASTRO ENGINE line +
  `mem:project/wip-2026-08-03-astro-engine-phase-a`.
- **B · Data. ✅ SHIPPED 2026-08-10** — the full catalog fleet behind one lazy chunk (424 KB, boot
  chunk untouched — build-verified + `lazyContract.test.ts` guard): full OpenNGC (13,263 records
  packed to `public/data/openngc.bin`, 20 B/record; common names fuzzy, NGC/IC ids via a pattern
  branch) · 451 IAU WGSN star names (`starNames.ts`, own RA/Dec — no bsc5 re-bake; greek-bayer
  key expansion "alpha lyrae"→Vega) · 88 constellations (`constellations.ts` + the full 88-figure
  lines asset) · 952 MPC comets + 337 SBDB bright asteroids (full-prec, H<9) through a NEW
  **universal-variable (Stumpff) propagator** (all conics — Hale-Bopp e=0.9949 ≤2′ vs Horizons)
  + the **IAU (H,G) Bowell law** (Ceres ≤30″/0.2 mag vs Horizons); SIMBAD TAP + `/api/sbdb`
  long-tail (debounced, localStorage-cached, `phys-par=1` — SBDB omits H otherwise); last-tracked
  id persists (`skyTargetId`, idle-restored). Gates vitest 701/701 · astro 0/0 · browser-VERIFIED
  in a visible window. DECISIONS 2026-08-10 line + `mem:project/wip-2026-08-10-astro-engine-phase-bde`.
- **C · Trajectory + off-screen chips + interaction (owner feedback 2026-08-03 after testing A).
  ✅ SHIPPED 2026-08-03 (same day)** — all five items, browser-VERIFIED in a visible window
  (gates vitest 674/674 · astro 0/0; DECISIONS 2026-08-03 PHASE C line +
  `mem:project/wip-2026-08-03-astro-engine-phase-c`):
  1. `scene/skyTrail.ts` — the target's day-arc trajectory (dayArcs grammar generalised via
     `sampleTargetArc`/`targetAzAlt` — marker/trail/panel share ONE ephemeris face), ON by
     default, persisted; panel toggles renamed **SHOW · MARK · TRAIL**.
  2. Marker click → aim + panel opens: ANGULAR hit test (`hitRadiusDeg()`, ring × 1.25) in both
     the orbit and FPV pointer paths — the mesh keeps `raycast=()=>{}`.
  3. SKY-search auto-aim when the target is above the horizon at the panel's eye; the shared
     idiom now lives in `store/skyAim.ts` (`aimAtSky`: FPV skyLook · orbit heading + raise-only
     tilt) and `FpvHud.bringIntoView` rides it too.
  4. Tracked-target EDGE CHIP: `skyMarkers` → `{sun|null, moon|null, target|null}` (per-slot
     gating: guides chip vs TARGET SHOW), FpvHud renders glyph + designation + arrow.
  5. Cleanup: `SKY_TARGET` tuning group split out of `COMET` (which keeps coma/tail only);
     prefs → `skyTargetVisible/Highlight/Trail` with read-old-keys fallback (old blobs keep
     their chips).
- **D · Per-category render polish. ✅ SHIPPED 2026-08-10** — planet treatment = uMode 3 in
  `scene/skyTarget.ts`: phase-lit disc (moon lambert on the billboard, sun in billboard-local
  coords, +Y = celestial north → true terminator orientation; size floored at
  `SKY_TARGET.planetDiscMinDeg` 0.4°, TRUE size wins at long focal) + Saturn ring band (real
  pole via `saturnRingPoleDir`, projected opening sin B — near edge-on in 2026 — with the near
  arm crossing IN FRONT of the disc); star colour = per-star B−V tint (`bvToRgb`: Ballesteros
  temperature + blackbody sRGB, `STARS.bvTintAmount` 0.6 blend, all 9,096 BSC5 stars).
  Constellation treatment (net-new kind): tracked figure lights up in accent via
  `stars.update({constellation})` + the 88-figure asset. Browser shots
  `verify-shots/astroB-0[1-4]*.jpeg` (the 500 mm Saturn is the flagship).
- **E · Planner. ✅ SHIPPED 2026-08-10** — `skylineState` generalised over an injected az/alt
  sampler (`sampledSkylineState`; the scanWindows move); `targetSkylineState(target,…)` feeds a
  THIRD row in planFeed (gated by TARGET SHOW, target-swap invalidates the scan) mirrored as
  `store/plan.target` → PlanPanel row (glyph + designation) + a SKYLINE CLEAR / BEHIND SKYLINE
  badge in TargetPanel. Browser-verified both ways (Saturn CLEAR w/ HIDES crossing · Orion
  BEHIND w/ CLEARS crossing).

## Risks / open questions
- **Boot weight.** Everything lazy-loads on first SKY search; assert the boot chunk is unchanged.
- **OpenNGC is CC-BY-SA-4.0** — share-alike. Confirm attribution placement (the `.map-credit`
  strip) is sufficient for a baked derivative, or pick a permissive alternative.
- **SIMBAD is a courtesy service** — debounce, cache hard, never hammer it per keystroke.
- **Precession for fixed targets** — J2000 → of-date matters at arcminute scale; `Rotation_EQJ_EQD`
  already does it inside `ecefFrameAt()`.
- **Magnitude honesty generalises** (the 2026-08-03 lesson): every brightness is a MODEL. Carry the
  model label + uncertainty in `SkyTarget` from day one, not as an afterthought.
