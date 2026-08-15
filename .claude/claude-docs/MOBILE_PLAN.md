# MOBILE_PLAN — true mobile support (planning-first, Stellarium × PhotoPills)

**Status (refreshed 2026-08-15): M0–M3 COMPLETE (shell + planning sheets + FPV touch + the
M3a/M3b/M3c planning twins; dated lines in the §Decision-log tail) · M4 (events twin) is next,
QUEUED BEHIND the guide track (`GUIDE_PLAN.md`, owner order 2026-08-15).** **RE-RULED 2026-08-13 (owner):** the §5 feature ladder
(P1–P10 + backlog + all future planning-app features) is **CORE scope** — its schedule now lives in
`IMPLEMENTATION_PLAN.md §Phase 8` (8a–8e) and every feature ships **desktop-first, then mobile**.
M0–M2 stay the mobile-infrastructure track here; §6's M3–M6 are re-scoped to the *mobile surfaces*
of Phase 8a–8e. Owner ask (2026-08-11): support iPhone-17-Pro /
Pixel-6-Pro-class phones for **planning photos + astro events + correct FPV preview for future
on-site shoots** — view globe, FPV mode + touch navigation, compact timeline scrubber, search;
map/info as tabs. NOT a porting of the desktop exploration UI. **Desktop is FROZEN** (owner:
expected state/design/behavior achieved) — mobile must not change it *(2026-08-13 amendment:
frozen = the shipped exploration UI's design/behavior; **additive** planning-feature surfaces are
allowed and in fact land on desktop FIRST per Phase 8)*. Research provenance: three
parallel evidence-cited tracks (codebase inventory · platform verification · PhotoPills/Stellarium
gap analysis), synthesized here; memory twin `mem:project/wip-2026-08-11-mobile-design`.

---

## 1. The decision — a separate `/m` page (Option 1)

| Option | Desktop risk | Platform fit | Cost | Verdict |
|---|---|---|---|---|
| **1. Separate page `src/pages/m.astro` + mobile shell, same engine/stores/libs** | **zero** (new files only + one optional banner) | Astro file-based routing is first-class on Wix-managed hosting | thin new shell (~5–8 small components); some UI duplication | **RECOMMENDED** |
| 2. Responsive retrofit of `index.astro` | high — 17 islands, hover/drag idioms, frozen design | n/a | CSS/JSX churn in frozen files | rejected |
| 3. Separate deploy (second site/subdomain) | zero | splits auth/session/prefs; second release pipeline | high ops | rejected |

**Platform evidence (all verified 2026-08-11):**
- App is `output: "server"` with the Wix cloud fetch adapter applied at build [CODE astro.config.mjs];
  8 routes under `src/pages/api/` already run **live in prod** (the `/api/ping` 200 canary,
  DECISIONS 2026-07-10) — routing through the adapter is proven, not assumed.
- Wix docs treat multi-page Astro as first-class; `@wix/astro-pages` auto-registers every route into
  `/_wix/pages.json` [DOCS dev.wix.com go-headless SEO guides; node_modules/@wix/astro-pages/README.md].
- The globe island is a plain React component mounted `client:only="react"` [CODE src/pages/index.astro:114-115]
  with no page/route coupling — a second page mounts it identically. C4 (never SSR WebGL) carries over.
- **Device routing = client-side only.** Wix fronts SSR HTML with a global CDN; `Vary: User-Agent`
  behavior is unverifiable locally (and the repo already logged a sharded-edge-cache trap) — a
  server-side UA redirect could be cached and misroute. v1: a tiny dismissible
  `matchMedia("(pointer: coarse)")` banner on index offering `/m` **plus a permanent `/m` link in
  the desktop topnav (owner-ratified 2026-08-11)** — together the only desktop-page deltas in the
  whole plan. No middleware.

**New-file layout** (desktop untouched):
```
src/pages/m.astro                     — the mobile page (own boot, no Welcome/boot-poster port)
src/layouts/MobileLayout.astro        — viewport-fit=cover + safe-area + 100dvh (Layout.astro is frozen)
src/components/mobile/                — shell: MobileShell, TabBar, Sheet, MobileTimeDock,
                                        MobileSearch, PlanSheet, TargetSheet, FpvControls (joystick),
                                        ArAim (M4), calculators (M3)
src/styles/mobile/*.css               — tokens.css stays the single source of truth (no Tailwind)
```
Fence note: the Claude-Design import fence currently allows only `panels|ui/** + styles/**`; extend it
to `src/components/mobile/**` **when** a design import targets mobile (record in DECISIONS then).
Hand-written code is not fence-bound. Engine changes in `globe/**` (below §4) are hand-written and
allowed; they are additive and desktop-inert.

---

## 2. What is reused vs built (the load-bearing finding)

The entire planning stack is **store-mediated and shell-agnostic** — the mobile shell consumes the
same stores and libs the desktop panels do, and steers the camera through existing request seams:

| Seam | Evidence | Mobile use |
|---|---|---|
| `scene/planFeed` → `store/plan` (panel only reads) | planFeed.ts:1-19 · plan.ts:44 · PlanPanel.tsx:81-91 | PLAN sheet = a new reader, zero engine change |
| `store/camera` request/set writers (`requestFly`, `requestFpvJump`, `setTempPin`, `setTempFpv`, rate setters); `_sync*` orchestrator-only | camera.ts:17-21,121-122,156-161,180 | shell drives all camera motion via stores |
| `store/skyAim.aimAtSky(az,alt)` — FPV look OR orbit heading | skyAim.ts:37-46 | tap-a-target → aim, both modes |
| `lib/ephemeris/*` pure + three-free (planner, targets, dayArc, bodies, moonlight, golden) | planner.ts:1-20 · targets.ts:16-17 · dayArc.ts:10-13 | all new planning features are lib+tests first |
| `lib/sky` lazy catalog + pure `searchIndex` (boot-safe) | lazyContract.test.ts:9-48 · catalog.ts:383 | mobile SEARCH imports the **libs**, not LocationFinder — no desktop file edits; lazy contract auto-enforced by the existing test (it walks all of `src/`) |
| `store/minimap` pure consumer contract | minimapFeed.ts:7-20 · MiniMap.tsx:6-11 | MAP tab = full-screen minimap reader |
| `#p=`/`#f=`/`&t=` URL hashes, terrain-relative eye | urlPose.ts:38-140 · StylizedTiles.ts:398-420 | plan deep-links work on `/m` for free |
| `lib/prefs.ts` `ftw:view-prefs:v1` (same origin) | prefs.ts:13-61 | chips/target persist across desktop⇄mobile |
| Quality tiers + frame governor + "mobile floor" 8k-texture skip | GlobeCanvas.tsx:69-82 · tuning.ts:604-610 | perf baseline exists; extend, don't invent |

**Panel verdicts** (from the full inventory): REUSE `GlobeCanvas`, `MiniMap` (resize); REBUILD-thin
(same stores, new compact UI) search / time dock / plan / target / FPV controls; OMIT on mobile:
UploadFlow, Marketplace, Faq, PinHoverCard (hover-only), DragGrip idiom (hover-revealed grips),
Welcome. `CameraTiltPanel` logic matters (only UI path to temp-pin FPV + FPV FOCAL/ALTITUDE without
wheel/keyboard) — its **store calls** get mobile buttons; the panel itself stays desktop.

**Touch reality check (verified in source):**
- Orbit mode **already touch-capable**: `GlobeControls` sets `touchAction:'none'`, tracks multi-pointer
  pinch, branches on `pointerType==='touch'` [CODE node_modules/3d-tiles-renderer/.../EnvironmentControls.js:353-357,564,625].
  UNVERIFIED on a real device until M0.
- FPV look-drag works on touch (pointer events, `isPrimary`) [CODE StylizedTiles.ts:795-828]. FPV
  **walk is arrow-keys-only** and **FOV zoom is wheel-only** [CODE :829-869] — no touch path exists
  (grepped: zero `TouchEvent`/`pointerType` handling in `src/`). This is the engine gap §4 closes.
- The ONLY gesture that drops a planning anchor is **double-click** [CODE :872-891] — undiscoverable
  on touch. Hover tips, hover grips, and the FPV hint copy ("◀▲▼▶ WALK · WHEEL ZOOM") don't translate.

---

## 3. Mobile IA + UX spec (planning-first)

Phone frame: ~402×874 (iPhone 17 Pro) / ~412×892 (Pixel 6 Pro) CSS px, `100dvh`, safe-area insets,
`touch-action` discipline on the canvas. Globe canvas is ALWAYS the base layer (the globe **is** the
map). Chrome = bottom tab bar + swipeable bottom sheets (never fixed side panels; sheets are
top-level islands — the S2 containing-block trap applies on mobile too [CODE index.astro:138-154]).

```
┌──────────────────────────┐
│ ◉ status strip           │  compact: place · scene-time chip · GPS-fix / AR badge
│                          │
│        GLOBE / FPV       │  full-bleed canvas (orbit touch = library; FPV = §4)
│                          │
│  [TARGET ▲ sheet peek]   │  tracked-target peek row: name · az/alt · CLEAR/BEHIND badge
│ ══ time dock ═══════════ │  compact scrubber: twilight-banded rail · date · ▶ · NOW
│ ⬤SCENE ⬤PLAN ⬤SEARCH ⬤⋯ │  tab bar (safe-area padded)
└──────────────────────────┘
```

- **SCENE** (default): canvas + time dock + peek row. FPV entry: `📍 stand here` (long-press or
  crosshair-drop → `LOOK FROM HERE` = `setTempPin`+`setTempFpv`), `🧭 my location` (geolocation →
  temp pin; **client-side only, never published — C6**), or a saved-place row (`requestFpvJump`).
- **PLAN**: sheet with the `store/plan` rows (almanac jump-chips, sun/moon/target skyline verdicts —
  every chip already just calls `setTime`), plus M3 additions: night-window list for the tracked
  target, MW/GC season calendar, moon calendar.
- **SEARCH**: full-screen sheet, EARTH (Photon/Nominatim geocode → `requestFly`) | SKY (lazy catalog
  → `setTarget` + aim) — imports `lib/sky/*` + `lib/geo/geocode` directly.
- **MAP** (in ⋯/More or 4th tab): full-screen north-up vector map from `store/minimap`, tap-to-place.
- **TOOLS** (M3): Spot-stars (NPF/500), hyperfocal/DoF, star-trail, timelapse cards — each seeded
  from live context (FPV focal, tracked target's declination, scene time).
- **FPV controls**: one-finger drag = look (existing); **left-thumb virtual joystick = walk**
  (analog, sprint at full deflection — the Shift/Alt desktop modifiers become the stick radius);
  **pinch = FOV zoom** (maps to `fovTargetDeg`, same clamps); `⤒/⤓` altitude nudge buttons (existing
  encoder rate seam); compact HUD row (FOCAL · HEADING · PITCH · EYE) + edge chips (already
  resolution-independent [CODE FpvHud.tsx:180-187 uses window.inner*, fine]). Wake Lock while in FPV
  (iOS 16.4+ [DOCS MDN Screen Wake Lock]).
- **AR AIM (M4)**: `deviceorientation` drives the FPV look quaternion — "point the phone where the
  camera will point". Dual-path compass: iOS = gesture-gated `DeviceOrientationEvent.requestPermission()`
  + `webkitCompassHeading` (no `deviceorientationabsolute` on iOS); Android Chrome =
  `deviceorientationabsolute` [DOCS MDN; w3c/deviceorientation#137]. Our FPV-with-real-FOV is already
  the *simulated viewfinder* PlanIt ships as its AR alternative — AR is additive, not load-bearing.
- Reduced motion honored; mobile flight duration 1600 ms is already in the motion spec
  [mem:patterns/design-system].

---

## 4. Engine additions (`src/components/globe/**`, hand-written, additive, desktop-inert)

1. **Analog FPV walk input** — extend `store/camera` with a shell-written walk vector
   (`setFpvWalkInput({fwd, right})`, −1..1 + speed scalar); orchestrator integrates it into the
   existing **world-space `fpvWalkOffset`** (the 2026-08-11 pivot fix — the same invariant: only
   input mutates the offset, a head-turn never does) alongside `fpvKeysDown`. Same idiom as the
   encoder rate controls. Tunables: `FPV.walkStickMaxMult` (sprint at full deflection ≈ 3, matching
   `walkFastMult`).
2. **Pinch-FOV in FPV** — track a second pointer in the existing `onFpvPointer*` handlers; two-pointer
   distance ratio → `fovTargetDeg` (same `minFovDeg/maxFovDeg` clamps as the wheel path). One-finger
   look unchanged; guard `e.isPrimary` logic accordingly.
3. **Long-press pin drop** — a `pointerdown` timer (~500 ms, ≤ `ORCH.clickDragPx` movement, orbit mode
   only) beside the existing `onDblClick` → same `pickGround`+`setTempPin` path [CODE StylizedTiles.ts:872-891].
4. **Hash carries the tracked target** — extend `urlPose.ts` with `&sky=<targetId>` riding `#p=`/`#f=`
   (parsers stay tolerant; live time still never written). Closes the share-a-plan gap (target id is
   currently only in localStorage `skyTargetId` [CODE prefs.ts:37, sky.ts:69-87]); benefits desktop too.
5. **Mobile texture tier** — reuse the existing "mobile floor" pattern [CODE tuning.ts:604-610]: on
   coarse-pointer/low-tier devices skip the 8k earth swaps, load a 2k `milkyway` variant (the 6.5 MB
   `milkyway-2020.jpg` is a boot asset today), cap DPR via the quality governor. Measure first (M0).

All four input additions are inert without a mobile shell (no joystick writes, no second FPV pointer
on desktop mice, long-press doesn't fire under `ORCH.clickDragPx` with a mouse's instant clicks, hash
param absent = today's behavior).

---

## 5. Stellarium/PhotoPills feature additions (each = pure lib + tests first, UI second)

Research verdict: the app **already exceeds** every competitor's obstruction tooling (3D skyline
with buildings vs PhotoPills' dashed-line heuristic / TPE's terrain-only geodetics) and framing
(FPV at the photo's real focal FOV). The gaps that close the PhotoPills use-case, in value order:

> **Scheduling re-ruled 2026-08-13:** this table remains the feature SPEC (sketches, efforts,
> evidence), but the canonical SCHEDULE is `IMPLEMENTATION_PLAN.md §Phase 8` — each feature lands
> lib+tests → **desktop surface** → mobile surface (the M-phases below add the mobile surface
> second, never first).

| P | Feature | Effort | Sketch (all on existing engine) |
|---|---|---|---|
| 1 | **Twilight bands** (civil −6°/nautical −12°/astro −18°) on the time dock | S | sun-altitude thresholds from the existing sampler → `lib/ephemeris/twilight.ts`; also defines "astro darkness" for everything below |
| 2 | **MW band + GC as a first-class target** | S/M | galactic plane = fixed IAU rotation (NGP α 192.85° δ +27.13°, GC ≈ Sgr A* α 266.42° δ −29.01° J2000 [DOCS wikipedia Galactic_coordinate_system]); band = b=0 polyline (±10–15° ribbon) through the existing star-sphere path; GC = `fixed` provider target → reticle/trail/edge-chips/skyline verdict ALL inherited. Lock constants with unit tests (NGP↔GC round-trip) |
| 3 | **MW season calendar + darkness score** | S | `targetWindows(GC)` ∩ sun<−18° ∩ (moon down ∨ illum<~20% via `moonlight.ts`); score = darkness minutes × (1 − moon interference). Surface: PLAN calendar + "arc tilt at time T" readout (great-circle vs horizon angle — PhotoPills only gives this by manual scrubbing) |
| 4 | **Find: sun/moon/GC at azimuth(±tol)/elevation over a date range** (PhotoPills' killer tool) | M | invert the existing `dayArc` sampler per day (az monotonic per branch → root-find); GC is closed-form (fixed dec → solution shifts 3m56s/day). **Filter results by the real skyline — a category-first no competitor has** |
| 5 | **Spot Stars: NPF + 500 rule** seeded from FPV focal + view-center declination | S | `t = k·(16.856N + 0.0997f + 13.713p)/(f·cosδ)` (full NPF [DOCS sahavre.fr/regle-npf-rule]); simplified `t=(35N+30p)/f`; test vector: D850 p=4.35 µm, 14 mm f/2.8 → ≈16.3 s. 500-rule `t=500/(CF·f)` labeled legacy. Pixel pitch: manual sensor input v1, camera DB later |
| 6 | **Moon phase calendar** + supermoon/apogee-perigee | S | iterate lunations on the existing moon model |
| 7 | **Meteor showers** (radiant = tracked target, ZHR × sin(h) estimate, moon-scored peak nights) | S/M | bake from IAU MDC CSV (avoid Stellarium's GPL showers.json); `driftAlpha/Delta` per day |
| 8 | **Conjunctions/oppositions finder** | S/M | scan existing planetary ephemeris for pairwise separation minima + elongation extrema (Stellarium Phenomena precedent) |
| 9 | **Lunar eclipses** | M | shadow-cone geometry from existing sun/moon; local visibility = existing horizon test. (Solar-eclipse umbra path on the globe = flagship visual, L, later; Besselian elements or astronomy-engine's eclipse search) |
| 10 | Sensor-frame overlay on DSO targets (framing/mosaic vs catalog angular sizes) | S/M | angular rect from focal+sensor centered on target; Messier/NGC sizes already in catalog |
| — | Former backlog — **all scheduled** (owner 2026-08-11: every planning addition ships): star-trail simulator (M) · What's-Up-Tonight ranking (M) · light-pollution drape (M) · ISS passes (satellite.js SGP4 + CelesTrak TLE via a cached `/api/tle` proxy — CORS-unsafe direct, M) · long-exposure/ND + timelapse calcs (S) · Web-Push event alerts via Wix backend (M — no competitor has server push) · solar-eclipse umbra path (L, flagship) → phases **M5/M6** below. Permanently out: Gaia-depth catalogs · GOTO control · tides/rainbow · Skyfire forecasts (off-mission) | | |

Strategic read: P1–P5 ≈ "moon behind the landmark" + "MW over the subject" + "how long can I expose"
— the core of why landscape astrophotographers pay for PhotoPills — and every one of them lands in
`lib/ephemeris/*` as pure, vitest-covered math usable by BOTH shells.

---

## 6. Phases (each independently shippable; desktop gates green throughout)

**M0 — Foundation (route + render proof).** ☑ *BUILT 2026-08-13, browser-VERIFIED (coarse-tier
mid + 2k haze + zero 8k fetches; desktop byte-identical); the REAL-DEVICE exit gate below is
still OPEN (owner hardware). DECISIONS 2026-08-13.* `m.astro` + `MobileLayout` + minimal shell mounting
`GlobeCanvas`; index banner **+ desktop topnav `/m` link (owner-ratified delta)**; mobile texture
tier + DPR cap; **exit gate: globe renders + orbit touch-nav on a real iPhone + Pixel** (this also settles the biggest risk — WebGL memory/perf — before
any UI investment). Verify: `npm test` + `astro check` + real-device browser check + one release
canary (`/m` in prod, `/_wix/pages.json` contains it).

**M1 — Planning loop.** ☑ *BUILT 2026-08-13, phone-viewport browser-VERIFIED (the full exit-gate
walk: Dnipro fly → GC tracked+windows → pin → LOOK FROM HERE → FPV skyline verdicts → DUSK chip →
rail scrub → NOW; shots `verify-shots/mobile-m1-01..06`); real-device pass pairs backlog T1; the
SKY long-tail (SIMBAD//api/sbdb) deliberately deferred to a later M-phase. DECISIONS 2026-08-13
"night".* Tab bar + sheets; SEARCH (earth/sky via libs); compact time dock with
**twilight bands (P1 — lib + desktop rail land first in Phase 8a; M1 consumes
`lib/ephemeris/twilight.ts`)**; PLAN + TARGET sheets (store readers); long-press / crosshair pin drop +
`🧭 my location`; `LOOK FROM HERE`. Exit: pick place → track target → see windows + skyline verdict
→ scrub time — phone-only, browser-verified.

**M2 — FPV touch.** ☑ *BUILT 2026-08-14, phone-viewport browser-VERIFIED (the exit gate below:
joystick walk 65.92 m/s at full rail → 45° look-drag + reverse → **0.0000 m drift**; two-thumb
walk-while-looking; pinch 55°→27.7°, clamps at 80°; ⤒/⤓ 1.7→16.9 m, floors 1.7; wake lock
acquired/released; shots `verify-shots/mobile-m2-01..02`); REAL-DEVICE pass pairs backlog T1.
DECISIONS 2026-08-14.* Joystick walk (store seam) + pinch FOV + altitude nudges + compact HUD + MiniMap
resize + wake lock. Exit: FPV navigable phone-only; the 2026-08-11 pivot invariant re-verified on
touch (walk → look-drag → zero position drift).

**M3 — Planning features, mobile surfaces** *(twins: Phase 8a P2/P3 + Phase 8b P4–P6 —
re-scoped 2026-08-13)*. P2 MW band/GC → P3 season calendar/score → P4 Find → P5 NPF → P6 moon
calendar. Each feature's lib + desktop surface land FIRST in Phase 8a/8b; M3 adds the mobile
TOOLS/PLAN cards + sheets on the same libs/stores.
> **M3a ☑ + M3b ☑ BUILT 2026-08-14 night-5b, phone-viewport browser-VERIFIED** (DECISIONS
> night-5b): dock v2 = the desktop conveyor at phone scale (lightSegments bands + hour labels
> + sun/moon curves + target trace + edge-tap events); PlanSheet v2 = THIS FRAME · TODAY ·
> FIND v2 (the sheet is the store/find ghost writer on /m) · MOON · SPOT STARS twins.
> **M3c ☑ BUILT 2026-08-14 night-6, phone-viewport browser-VERIFIED** (DECISIONS night-6):
> GHOSTS toggle + ghost-chain steppers into the TARGET sheet (tp-ghostrow twin, pure skyStore
> writes, prefs round-trip) · long-press on a sky body opens `SkyContextMenu` on /m (island
> mounted from m.astro; one timer arbitrates sky-menu vs pin-drop at fire time, FPV honours
> the sky path only; card viewport-clamped) · tap-to-reveal = a 2 s synthetic-hover latch
> (`ORCH.tapRevealMs`) driving the whole stepSkyHover cascade (glow / ghost pulse / night
> names) · `ORCH.touchHitPadK 1.7` widens sky picks on coarse pointers. **M3 COMPLETE**;
> real-device pass rides T1.

**M4 — On-site + events.** AR aim (dual-path compass + calibration UX — mobile-native, stays here) ·
P7 meteors · P8 conjunctions · P9 lunar eclipses *(P7–P9 desktop-first in Phase 8c; M4 adds the
mobile surfaces)* · PWA manifest/A2HS (`public/` static serving is prod-proven for
bin/json/jpg; `.webmanifest` MIME = release-canary) · data-saver toggle.

**M5 — Advanced calculators + session tools, mobile surfaces** *(twin: Phase 8d — desktop-first,
re-scoped 2026-08-13)*. P10 sensor-frame/mosaic overlay on DSO targets ·
star-trail simulator (trail-length/gap/stacking math §5 + visual: integrate the existing star
renderer over a scrub interval around the pole) · long-exposure/ND + timelapse calculators ·
What's-Up-Tonight per-night ranking (the planner transpose: catalog subset × max altitude in
darkness × magnitude × moon distance). Exit: TOOLS tab feature-complete for a full night session.

**M6 — Ambience, alerts + flagship visuals, mobile surfaces** *(twin: Phase 8e — desktop-first,
re-scoped 2026-08-13)*. Light-pollution drape + Bortle estimate at the pin
(static VIIRS/World-Atlas tiles on the existing overlay path) · ISS/satellite passes (satellite.js
SGP4 + cached `/api/tle` CelesTrak proxy — direct browser CORS unsafe; TLEs valid days-to-weeks) ·
Web-Push event alerts via the Wix backend (**platform caveat: headless has NO cron** — alert
scheduling = an external scheduler hitting a token-secured endpoint, or on-open recomputation;
decide at build time) · solar-eclipse umbra path drawn on the globe (the flagship visual; Besselian
elements table 2020–2060 or an astronomy-engine port).

**Clarified 2026-08-15 (owner order):** login + MY PLACES (saved FPV viewpoints incl. pinned time)
are IN on /m — MobileAccount strip chip, MobilePlaces in the idle SEARCH sheet, ◎ SAVE VIEW in
SceneActions. "Pins-browsing" below still means the PHOTO-pin gallery, which stays out.

**Permanently out (owner-ratified 2026-08-11):** upload / marketplace / pins-browsing on mobile ·
Gaia-depth catalogs · telescope GOTO · tides/rainbow · Skyfire-style color forecasts · **Phase 7
AI panel — out of ALL plans** (not merely deferred; nothing schedules after M6).

---

## 7. Risks & open items

| Risk | P×I | Mitigation (specific) |
|---|---|---|
| Phone WebGL memory/perf (buildings+terrain+8k textures) | M×H | M0 gate on real devices BEFORE UI work; texture tier + DPR cap; quality governor exists; `about:` — the 6.5 MB milkyway pano gets a 2k mobile variant |
| iOS Safari layout quirks (dvh, safe-area, pinch-page-zoom) | M×M | MobileLayout owns `viewport-fit=cover` + `100dvh` + `touch-action:none` on canvas; test on real iPhone in M0 |
| Compass/sensor accuracy for AR | M×M | AR is M4 and additive; calibration hint UX; FPV simulated-viewfinder already covers the use case without sensors |
| CDN caches UA-dependent HTML | L×H | avoided by design (client-side banner only) |
| Two shells drift apart | M×M | shells stay thin; ALL logic lands in `lib/**`+`store/**` (the lazyContract test pattern generalizes: libs, not panels, are the shared surface) |
| Cellular data burn (tile streaming) | M×L | data-saver toggle (M4); OPFS/tile-cache already on the Phase-7 polish list |
| `.webmanifest` MIME / SW headers on Wix CDN | L×L | release canary; fall back to `.json` manifest; SW optional |

**[ASSUMPTION]s that stand:** route named `/m` · banner-not-autoredirect on index · camera
pixel-pitch DB deferred (manual sensor input v1).
**Owner rulings 2026-08-11 (the three [OPEN] items, now closed):**
1. `/m` gets a **permanent desktop topnav link** in addition to the banner (both land in M0).
2. Mobile is **planning-only PERMANENTLY** — upload/marketplace/pins-browsing never ship on `/m`;
   conversely EVERY current and future planning feature does (hence M5/M6 scheduling the entire
   researched backlog).
3. **Phase 7 (AI panel) is out of scope for all plans now** — M0→M6 is the only active ladder;
   M0 starts next session.

---

## 8. Verification tiers (per repo discipline)

- **Local:** every M-phase lands `npm test` + `npx astro check` green; new ephemeris math (twilight,
  galactic rotation, NPF, Find inversion, lunation walk) each with unit tests + literature test
  vectors (NPF D850 ≈ 16.3 s; NGP/GC round-trip; equinox/solstice twilight sanity).
- **Browser (desktop Chrome + REAL devices):** touch orbit, FPV joystick/pinch, sheets, wake lock,
  AR permission flow — Playwright covers layout/store wiring; input feel needs a hand on glass.
- **Wix cloud:** `/m` served + pages.json registration + `.webmanifest` MIME — release canaries.
- Shots → `verify-shots/mobile-*` (git-ignored).

## Decision log (append-only)
- 2026-08-11 · Separate `/m` page over responsive retrofit — desktop frozen + CDN/UA risk + platform
  proof (api routes live). Evidence: astro.config `output:"server"`, `/api/ping` prod canary,
  @wix/astro-pages route registry.
- 2026-08-11 · Client-side device banner, no middleware/UA-redirect — CDN `Vary` unverifiable.
- 2026-08-11 · Mobile shell = thin store/lib consumers under `src/components/mobile/**`; desktop
  panels never imported; engine gets 4 additive input seams (§4).
- 2026-08-11 · Feature priority P1–P10 (§5) from the PhotoPills/Stellarium gap analysis; MW/GC +
  Find + NPF are the PhotoPills-closing trio; skyline-filtered Find is the category-first bet.
- 2026-08-11 · OWNER RATIFIED: `/m` in desktop nav + banner · mobile = planning-only permanently
  (all planning features, present and future) · AI panel out of ALL plans · full backlog scheduled
  as M5/M6 · M0 starts next session.
- 2026-08-13 · OWNER RE-RULING: the §5 ladder (P1–P10 + backlog + all future planning-app features)
  = CORE scope, scheduled in `IMPLEMENTATION_PLAN.md §Phase 8` (8a–8e), **desktop-first then
  mobile**; M3–M6 re-scoped to the mobile SURFACES of 8a–8e (M0–M2 unchanged); desktop freeze
  amended additively (shipped chrome/behavior frozen, new planning surfaces allowed). SUPERSEDES
  the 2026-08-11 mobile-only scheduling of these features.
- 2026-08-13 · M1 SHIPPED (phone-viewport browser-verified). §4.3's long-press landed gated on
  `pointerType === "touch"` — STRICTER than the sketch's "inert under clickDragPx" argument: a
  mouse held 500 ms would otherwise drop pins on the frozen desktop (verified inert). The §2
  drift guard is now a test (`test/components/mobileFence.test.ts`), not a comment. M1 cut:
  SKY search long-tail (SIMBAD//api/sbdb) + MAP tab ride later M-phases.
- 2026-08-14 · M2 SHIPPED (phone-viewport browser-verified). §4.1's stick landed as a store seam
  (`fpvWalkInput`) that `clearAllTargets` deliberately SPARES — the FPV look-drag's own canvas
  pointerdown fires clearAllTargets, and walking-while-looking is the point (pinned by test);
  analog response is quadratic (`walkSpeedMps · walkStickMaxMult · d²` — the rim is the desktop
  Shift, the centre the desktop Option). §4.2's pinch freezes the look while it lives and hands
  the drag back seamlessly. MiniMap = the DESKTOP island mounted by m.astro (fence rule 2 exempts
  the page) + a `body.m` specificity hook in MobileLayout (island-chunk CSS order is not
  guaranteed). M0–M2 mobile infrastructure COMPLETE — next mobile work is M3 (8a/8b surfaces).
