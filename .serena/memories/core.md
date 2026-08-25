# mem:core — Frame the World graph root

## What this is
Wix-managed **headless** (Astro 5) web app: upload a camera RAW/JPEG → extract EXIF → project it as an
oriented **camera frustum + image plane** at its real capture location on a **stylized 3D globe with real
OSM buildings**; real-time EXIF what-if re-projection; ephemeris (sun/moon/stars) drives the scene; members
save/publish pins; light RAW marketplace; premium AI shot-analysis. **Client-heavy** (WASM decode + three.js
render + projection math all in-browser); Wix is a thin backend (auth/Data/Media/Pricing Plans/eCommerce/AI).
Owner: Yevhen. Hackathon build. Language: TypeScript + Astro. No SSH/prod box — "prod" is Wix cloud via `wix release`.
**THE PRODUCT IS PLUX** (owner 2026-08-19; supersedes working title SIDERA 2026-08-14),
planning-first; domain `plux.today` (www = primary). **Say PLUX in prose, docs and commit messages.**
"Frame the World" / "FTW" is the REPO NAME ONLY (`headless-frame-the-world` + the git remote) and is
not a synonym for the product. Internal identifiers deliberately keep it and must NOT be renamed:
the six `ftw:*` localStorage keys are PERSISTED USER STATE (renaming wipes every browser), the ~20
`uFtw*`/`vFtw*`/`FTW_*` shader identifiers fail SILENTLY if a rename is missed, and the `Ftw` Lean
namespace is internal. Owner re-affirmed 2026-08-25 after a real leak shipped —
`PRODID:-//Frame the World//…` and `UID:ftw-…@frame-the-world` were inside every exported .ics
file. Both halves are now machine-checked by `test/brandFence.test.ts`.

## Status (compacted 2026-08-15 — era index + pointers; the old narrative Status lives in DECISIONS.md digests + DECISIONS_ARCHIVE.md)

### Current state (re-dated 2026-08-18 at compaction r3 per policy; narrative below written 2026-08-15 post guide-G1 — the 08-17→18 delta [P7 + U1–U5 + audit-2 + fix slices] lives in the Era index HOT rows + Next step)
- **Phases 1–6.9 SHIPPED + RELEASED**: scaffold + LEO signature globe · WASM decode
  (libraw-wasm@1.0.5 worker) · frustum projection + click-to-place · ephemeris-driven scene
  (sun/moon/stars/terminator/shadows/golden) · members + C6 reduced-precision pins · Phase 5.5
  S1–S7 UX (flight/FPV, pin lifecycle+visuals, Explore/Welcome, night physics, street names,
  vector features) · Dnipro/St Albans enriched bakes on R2 · marketplace-light (Catalog V3
  digital products, quota 100/1000, EUR). Populated globe LIVE since 2026-07-17.
- **Astro engine A–E COMPLETE**: search/track ANY body (1,947-entry fuzzy index — stars,
  constellations, comets, asteroids, full OpenNGC), universal-variable kepler + SIMBAD/SBDB
  long-tail, target trail/markers/windows, planet phase discs.
- **Planning core (Phase 8 ladder)**: 8a twilight/GC/MW shipped · QoL-1..4 (scrubber v2 +
  trace, frameFinder cards, GHOSTS chain, NPF/moon-calendar/size-dist tools) · **FIND v2/v3**
  (dedicated FindPanel frame-as-query per-day scan + in-frame ghost projections + standings) ·
  **§3.5 SUNSETS-IN-FRAME** (sunEventFrame lib; refracted-labels/airless-geometry PINNED) —
  all desktop-first with /m twins.
- **Mobile M0–M3 COMPLETE**: `/m` planning shell (sheets/tab bar/dock conveyor), FPV touch
  (joystick walk, pinch-FOV, wake lock, minimap), PlanSheet twins, TARGET GHOSTS + long-press
  sky menu; mobile-default entry (`/?d=1` escape). Mobile = planning-only PERMANENTLY.
- **Owner UX batches 2026-08-15b/c (×5 + ×9)**: PLAN/FIND one shared resizable window · grown
  sky context menu (TRACKING/MARK/TRAIL/FIND-IN-FRAME + camera-aiming rise/set + moon %) ·
  TRACKING camera lock (`stepSkyTrack`) · /m FIND 4th tab w/ STICKY standings (Pixel fix) ·
  /m login + MY PLACES + SAVE VIEW + SAVED PLACES (place quota dropped) · collapsible mini-map.
- **THE GUIDE G1 + G2-content SHIPPED 2026-08-15 both shells (this session)**: ONE content
  module `lib/guide/guideContent.ts` (11 chapters · ~40 topics · goals router · `[[id|label]]`
  crosslinks) → desktop `panels/Guide.tsx` + /m `GuideSheet.tsx`; **FAQ ABSORBED** (Faq island
  deleted); 12 fresh screenshots `public/guide/*.webp` (warm-list-coupled); slop-lint +
  crosslink/image tests. Same session: DECISIONS round-2 compaction (verbatim 07-11→08-01 →
  DECISIONS_ARCHIVE + era digests), README/ARCHITECTURE refreshed, `mem:core` compacted.
- **Gates: vitest 886/886 · astro check 0 err/5 hints · prod LIVE.** Both shells CDP-verified.
- Standing rulings: Phase 7 (AI) OUT of all plans · desktop frozen additive-only ·
  desktop-first per feature · airless geometry with TRUE almanac label times · backlog =
  `.claude/skills/frame/references/tracked-backlog.md` (T1–T27).
- Open tails: owner taste pass (guide chapters/copy + UX-batch knobs) · real-device
  iPhone/Pixel pass · release canaries T2/T3 ride the next `wix release`.
- Freshest detail always: `NEXT_SESSION_PROMPT.md` + DECISIONS §Recent sessions (top entry
  2026-08-15d-guide-g1).
- Live site: `frame-the-a173087b-yevhens.wix-site-host.com` (siteId
  `f597bcf5-bd38-4941-9dfe-e16d775743a3`, appId `566ce8ce-d18c-4950-88ac-5d2c53311cd6`;
  `mem:project/wix-site`).

### Era index (DECISIONS.md §Per-phase digests for eras through 2026-08-15e after compaction r3 2026-08-18; verbatim logs in DECISIONS_ARCHIVE §Moved dividers; only the UPLIFT era 2026-08-17→ stays verbatim in DECISIONS §Recent sessions. Policy: every compaction round adds its era rows HERE and re-dates the Status block.)
- **Phases 1–4 — scaffold · globe · decode · projection · ephemeris (2026-07-09→10)** —
  digests "Bootstrap"→"Phase 4" (+ design-system import) ·
  `mem:patterns/globe-rendering` · `mem:patterns/upload-flow` · `mem:patterns/photo-frustum` ·
  `mem:patterns/sky-bodies-terrain` · `mem:patterns/design-system` ·
  `mem:project/wip-2026-07-10-phase4-scrubber` · `wip-2026-07-10-prephase5-fixbatch` ·
  `wip-2026-07-10-ui-fixes`.
- **Phase 5 + 5.5 S1–S7 + pre-S7 refactor (2026-07-10→12)** — digests "Phase 5", "Phase 5.5
  S1–S6", "Pre-S7 architecture review", "S7 tail + interlude" · `mem:patterns/members-pins` ·
  `mem:project/wip-2026-07-10-phase5-members-pins` · `wip-2026-07-11-phase5.5-ux-batch` ·
  `wip-2026-07-11-phase5.5-s2`…`s7` · `wip-2026-07-11-s7-feedback-batch` ·
  `wip-2026-07-11-pre-s7-refactor{,-s2}` · `wip-2026-07-11-b19-split` ·
  `wip-2026-07-12-readme-rewrite` · `mem:bugs/pin-arrival-reframe`.
- **Rendering passes + Dnipro enrichment slices 0–3 + illumination (2026-07-12→14)** — digest
  of the same title · `mem:project/wip-2026-07-12-rendering-quality-pass` ·
  `wip-2026-07-12-rendering-pass1-tiling-fluidity` · `wip-2026-07-12-rendering-pass2-dnipro-identity` ·
  `wip-2026-07-13-illumination-pass` · `wip-2026-07-13-terrain-reseat` ·
  `wip-2026-07-13-dnipro-enrichment-research` · `wip-2026-07-13-dnipro-slice0-spike` ·
  `wip-2026-07-13-dnipro-slice1-bake` · `wip-2026-07-13-dnipro-slice2` ·
  `wip-2026-07-13-dnipro-slice3-trees` · `mem:bugs/gallery-thumbnail-stale`.
- **OSM2World variant + R2 hosting + obstruction moat + owner seating/UI batches (2026-07-14)**
  — digest of the same title · `mem:project/wip-2026-07-14-osm2world-adapter` ·
  `wip-2026-07-14-osm2world-slice1.5-spike` · `wip-2026-07-14-r2-hosting-osm2world-prep` ·
  `wip-2026-07-14-pass3-obstruction-moat` · `wip-2026-07-14-owner-batch-seating-ui` ·
  `wip-2026-07-14-uiux-qol-batch`.
- **Docs reorg → Phase 6 marketplace → 6.9 + release week + St Albans (2026-07-15→18)** —
  digest of the same title · `mem:project/wip-2026-07-15-docs-reorg-phase6-prep` ·
  `wip-2026-07-15-prephase6-uiux` · `wip-2026-07-16-phase6-marketplace-research` ·
  `wip-2026-07-16-prod-asset-outage` · `wip-2026-07-17-phase69-marketplace-batch` ·
  `wip-2026-07-17-demo-seed-curation` · `wip-2026-07-17-seed-orbital-faq-batch` ·
  `wip-2026-07-18-st-albans-city2` · `mem:bugs/ground-checkerboard-flicker`.
- **View-prefs persistence + default flips (2026-07-21)** — digest of the same title ·
  `mem:project/wip-2026-07-21-viewprefs-uiux`.
- **Astro engine A–E + comet 10P (2026-08-02→10)** — DECISIONS §Recent 2026-08-02→10 ·
  `mem:project/wip-2026-08-02-comet-10p-tracer` · `wip-2026-08-03-astro-engine-phase-a` ·
  `wip-2026-08-03-astro-engine-phase-c` · `wip-2026-08-10-astro-engine-phase-bde` ·
  `mem:bugs/comet-magnitude-model`.
- **Full audit #1 + fix slices 0–7 + Phase 8a + planning-core restructure (2026-08-13)** —
  DECISIONS §Recent 2026-08-13 + report `.claude/claude-docs/audits/audit-full-2026-08-13.md` ·
  `mem:project/wip-2026-08-13-full-audit-1` · `wip-2026-08-13-planning-core-restructure` ·
  `wip-2026-08-13-slice7-phase8a` · `mem:bugs/fpv-walk-orbit`.
- **Mobile M0–M3 (2026-08-11 design → 2026-08-14)** — DECISIONS §Recent + `MOBILE_PLAN.md` ·
  `mem:project/wip-2026-08-11-mobile-design` · `wip-2026-08-13-m1-mobile-planning` ·
  `wip-2026-08-13-m2-fpv-touch` · `wip-2026-08-14-mobile-m3ab` · `wip-2026-08-14-mobile-m3c`.
- **Planning QoL 1–4 + FIND v2/v3 + §3.5 sunsets (2026-08-14→15)** — DECISIONS §Recent +
  `PLANNING_QOL_PLAN.md` · `mem:project/wip-2026-08-14-qol-batch` ·
  `wip-2026-08-14-qol1-tail-trace` · `wip-2026-08-14-qol2-batch` · `wip-2026-08-14-qol3-batch` ·
  `wip-2026-08-14-qol4-batch` · `wip-2026-08-14-find-rework` ·
  `wip-2026-08-14-find-accuracy-labels` · `wip-2026-08-14-night6-hover-floor` ·
  `wip-2026-08-15-sunsets-in-frame` · `mem:project/owner-orders-2026-08-14-qol-batch`.
- **Owner UX batches ×5 + ×9 (2026-08-15b/c)** — DECISIONS §Recent 2026-08-15b + 2026-08-15c ·
  `mem:project/wip-2026-08-15-ux-batch` · `wip-2026-08-15-uxbatch2`.
- **Guide track G1 + polish (2026-08-15d/e)** — DECISIONS digest + ARCHIVE §Moved 2026-08-18 ·
  `archive/GUIDE_PLAN.md` · `mem:project/wip-2026-08-15-guide-g1`.
- **P7 meteors + UPLIFT ladder U1–U5 (2026-08-17→18, era still HOT — verbatim in DECISIONS
  §Recent)** — meteor showers (IMO cal2026) + UPLIFT_PLAN authored · U1 2D-first /m · U2 FPV
  stability ×8 · U3 fullscreen MapWindow + 2D-map batch + crispness + desktop flat-map · U4
  direction lines + aim cones (+2 owner rounds) · U5 closest-first loading. Ladder PARKED after
  U5 for AUDIT #2 + fix slices; UN-PARKED 18n → U6 foveation SHIPPED + U7 terrain audit DONE
  18o (`wip-2026-08-18-u6-foveation` + UPLIFT_PLAN Appendix A) → U7b GLO-30 terrain patch +
  best-variant buildings rule SHIPPED 18p (`wip-2026-08-18-u7b-glo30-terrain-buildings-rule`)
  → U8 height override SHIPPED 2026-08-19 (`wip-2026-08-18-u8-height-override`) — the ladder
  is COMPLETE. `mem:project/wip-2026-08-17-p7-meteors-uplift-plan` ·
  `wip-2026-08-17-u1-2d-mobile` · `wip-2026-08-17-u2-fpv-stability` · `wip-2026-08-18-u3-2dmap-batch` ·
  `wip-2026-08-18-u4-aim-cones` · `wip-2026-08-18-u5-loading` · `UPLIFT_PLAN.md`.
- **AUDIT #2 + fix slices (2026-08-18)** — report `audits/audit-full-2026-08-18.md` ·
  `mem:project/wip-2026-08-18-audit2` · `wip-2026-08-18-audit2-fixslices`.
- **Compaction round 4 (2026-08-22, audit-3 D16) — the UPLIFT + batch-#2/#3 + PLUX eras went
  COLD.** Verbatim 2026-08-17 → 2026-08-19d moved byte-identical to DECISIONS_ARCHIVE
  §Moved 2026-08-22 (md5 `5ed47c51b9d44a754964771ffe418330`, 556 lines / 79,306 B); 3 era
  digests in DECISIONS §Per-phase digests cover them. §Recent 141.7 → 62.6 KB. **Only the
  OWNER-BATCH era (2026-08-21 → 2026-08-22d) stays verbatim** — it all rides the un-shipped
  release gate. Next carve-out review when that era ships or §Recent nears ~140 KB again.
- **Owner UX batches #2/#3 + PLUX launch grooming (2026-08-19 → 19d)** — digests of those
  names · `mem:project/wip-2026-08-19-owner-uxbatch2` · `wip-2026-08-19-owner-uxbatch3` ·
  `wip-2026-08-19-plux-launch-grooming`.
- **GUIDE FINALIZATION — charter G-A…G-J (2026-08-22g, HOT)** — plan
  `GUIDE_FINALIZATION_PLAN.md` · `mem:project/wip-2026-08-22-guide-final` ·
  DECISIONS §Recent 2026-08-22g.
- **Owner micro-slice + AUDIT #3 + its fix slices F1–F10 (2026-08-22a→e, HOT)** — report
  `audits/audit-batchseams-2026-08-22.md` · `mem:project/wip-2026-08-22-owner-microslice` ·
  `wip-2026-08-22-audit3` · `wip-2026-08-22-audit3-fixslices`.
- **Owner 3-slice + HQ map (2026-08-22h/i, HOT)** — DECISIONS §Recent ·
  `mem:project/wip-2026-08-22-owner-3slice`.
- **ULTRA fidelity track — T44 textures + T45 light/shadows (2026-08-22j, HOT)** — plan
  `ULTRA_PLAN.md` (read its **AS BUILT** block first) · `mem:project/wip-2026-08-22-ultra-track` ·
  `scripts/verify-ultra.mjs` 28/28. Nine levers behind ONE desktop-only `ULT` chip, off by default;
  the owner LIFTED the frame-rate ceiling to buy them.
- **ECLIPSES (2026-08-22k, HOT)** — the moon now OCCLUDES the sun (it was being DISCARDED, not
  washed out) + corona + world darkness + copper umbra; works only because the scene is
  TOPOCENTRIC (geocentric misses by 1°) · `mem:project/wip-2026-08-22-eclipses`.
- **BEST SPOT — the observability heatmap, S1→S7 (2026-08-23 → 2026-08-24c, HOT)** — plans
  `BESTSPOT_PLAN.md` (**AS BUILT appendix first**) + `BESTSPOT_SPEC_V2.md` ·
  `mem:project/wip-2026-08-23-bestspot-heatmap` (design + pure-lib floor) ·
  `wip-2026-08-24-bestspot-s3-s7` (worker → GL sheet → panel → residency → honesty; FEATURE
  COMPLETE, browser-verified) · `scripts/verify-bestspot.mjs` 100/100. See §Next step.
- **FORMAL VERIFICATION — Lean 4 + Mathlib proof project (2026-08-24d, HOT)** — `formal/` ·
  `.claude/claude-docs/FORMAL_VERIFICATION.md` · `mem:project/wip-2026-08-24-formal-verification`.

## Next step
**FINISH THE RENDERING CHARTER — Group D (minus RC12) + RC18–RC21 + RC25 + RC30.**
SHIPPED: Groups B (RC1–RC5) and C (RC6–RC11) on 2026-08-25c/d, Group F's four implementable
slices + RC29 + RC22 on 2026-08-25e — all browser-proven. **TWO SLICES ARE REFUTED BY
MEASUREMENT — do not build them:** **RC12** (curvature residual is 0.568 m against 14.20 m rms of
within-cell relief = 4.0 % at the 3.5–4 km ring; every cell is re-seated at its own centre so the
tangent-plane rise is bounded by the CELL radius, never the bake radius) and **RC28** (DEPTH_BITS
24 over a 1.0 m near plane, no shimmer case in ten browser legs). A third refutation is recorded:
**M7's crossfading-parent mechanism never fires** (hitsPerSample exactly 1.00 over 47k samples).
Read `NEXT_SESSION_PROMPT.md` first, then `mem:project/wip-2026-08-25-rendering-charter-groupBC`
and `…-groupF`, then DECISIONS §Recent 2026-08-25e/d/c.
Gates: **vitest 1,996/1,996 (137 files)** · astro 0 err/0 warn/5 hints · knip exit-0 ·
verify-ultra 29/29 · verify-eclipse 38/38 · `verify-rendering-charter.mjs` **70/70**.
Three open tails: RC7's look-cone bar (50.3 % vs S4's 0.9 — null-terrain deferrals are uncounted),
RC9's warm-restore browser leg (banking proven, restore not), and RC22's three mobile proposals
(recorded in tuning, need a real device under T1).

### Prior state (context)
**BEST SPOT — the observability heatmap — is FEATURE-COMPLETE AND BROWSER-VERIFIED. All seven
slices S1→S7 SHIPPED (pure-lib floor S1+S2 2026-08-23; S3a→S7 2026-08-24).** Predicts where to stand
for SUNRISE/SUNSET/MOONRISE/MOONSET inside a radius of the `look from here` pin, as a translucent
heatmap over the map. Plan `.claude/claude-docs/BESTSPOT_PLAN.md` — **read its `AS BUILT` appendix
BEFORE the body.** Logs `mem:project/wip-2026-08-24-bestspot-s3-s7` (the shipping session) +
`mem:project/wip-2026-08-23-bestspot-heatmap` (the floor + design). DECISIONS §Recent 2026-08-24c.
Gates: **vitest 1,902/1,902 (130 files, +342)** · astro check 0 err / 0 warn / 5 hints · knip exit-0 ·
**`scripts/verify-bestspot.mjs` 100 PASS / 0 FAIL.** Tier: **LOCAL + BROWSER** (shots
`verify-shots/bestspot-01…08`). Wix cloud UNVERIFIED — prod is dark behind the nameserver gate.
**THE ARCHITECTURE: all-CPU, one long-lived worker, and the per-ray UPPER CONVEX HULL is invariant in
BOTH scene time AND eye height** — which is what makes the scrubber and the altitude slider live.
The GPU path was proposed and **REFUTED** (3 breakers); reusing the shadow map, 7. Do not re-propose.
**THE HEADLINE, AND THE MOST TRANSFERABLE LESSON THIS PROJECT HAS LEARNED: every unit gate was green
while the FIELD WAS A CONSTANT.** The first browser run over dense central Dnipro measured the
published RG8 at **`rMin === rMax === 187`** — one distinct value across all 31,417 scored cells —
with 1,860 tests passing, `astro check` clean and `knip` clean. **No building geometry ever reached
the worker's DSM**: (1) the `▦ 3D DETAIL` chip was OFF in that browser's prefs and
`buildings.setActive(false)` *removes* `tiles.group` from the scene, so `flattenTin` traversed an
empty group; (2) **no epoch watched building-tile ARRIVALS** (the three streaming epochs were ground,
MVT version, and enriched *re-seat*). Fixed with `builtEpoch`; and because the engine knew both facts
and said nothing, a disc with dense MVT and zero building meshes now **REFUSES**
(`"no-built-geometry"`) instead of painting warm. After: 31 distinct score bytes, top-8 spread 0.4 %
→ 56 %. **Nine more defects were browser-only**, including a `postMessage` transfer detaching a
by-reference `conformM` — a class **vitest cannot express**, because `postMessage` there has no
transfer semantics. The question is never "do the tests pass"; it is **"what did I read out of the
live engine, and does its distribution have a spread?"**
Prior-slice headline (still true): both S1/S2 BLOCKERs were at slice SEAMS with every per-slice suite
passing — the bridge scored as a pure LIABILITY (0.608 with the deck vs 0.623 without), and 47 % of
the track's weight sat below the horizon, capping V at 0.51.
Owner rulings: drone semantics above 5 m · FPV is a centre source but renders nothing in the
viewfinder · field 3 m with 1 m reserved for ULTRA · GL overlay only, plumb line instead of a cylinder.
**NEXT: the TASTE PASS** — cheap by construction, every knob is a recompose (0.3–3 ms) or a repaint:
`__globe.bestSpotTuning({...})` · `.ab()` · `.export()`. Primary targets `graze.conf` /
`graze.reliefHiDeg` / `displayLo|Hi` / `worth.effectiveFloor` (all unswept judgements, now live).
Judge it at BOTH lifts — a 1.7 m city disc is legitimately near-black (97.7 % at zero) and that is
physics; at 56.7 m the mean score byte is 159. Then un-park T47/T46/T1/T42/T34/P8/M4/U8/T29/T31.
S8 (`/m` twin) and S9 (MapWindow/MiniMap DOM twin) stay deferred by owner ruling.
Entry point: `NEXT_SESSION_PROMPT.md`.
Prior: **THE ULTRA FIDELITY TRACK SHIPPED 2026-08-22j — T44 (textures) + T45 (light + shadows) both
CLOSED, nine levers behind ONE desktop-only `ULT` chip, off by default.** Gates: **vitest
1,330/1,330 (111 files)** · astro 0 err/5 hints · `npx knip` exit-0 · NEW `scripts/verify-ultra.mjs`
**28/28**. Executed against `ULTRA_PLAN.md` (read its **AS BUILT** block before touching this track).
**THE OWNER LIFTED THE FRAME-RATE CEILING** — *"even if it is sub 15FPS but graphics fidelity
improves … worth it, user enables it in it's own volition anyways"* — which supersedes the plan's own
"a 12 fps ULTRA is a broken feature" and is what made the construction-time shadow levers shippable.
Measured: city OFF 30.7 ms -> ON 36.1 ms (+18%, 33 -> 28 fps).
Shipped: photographic de-grade in 3D on its own uniform · anisotropy 16 on the drape composites ·
a **twilight-band day curve** (36 deg of solar elevation vs EARTH.termBand's 9.2, anchored on the
almanac's own thresholds) · an exposure ramp 1.00->1.46 · **aerial perspective, which did not exist
before** · the HemisphereLight finally on local up and tracking the ephemeris (**audit gap #16
dead**) · soft shadows · an 8192 map · and **TERRAIN CASTS SHADOWS** (the owner's named killer
feature, browser-proven at Everest).
**THE PLAN WAS WRONG IN FOUR PLACES, one of which would have shipped a no-op**: PCFSoftShadowMap
is DEAD CODE in three 0.185 (intercepted and rewritten; the real lever is shadow.radius on a
per-pixel-rotated Vogel disk, and it is LIVE) · shadow.bias's unit is a FRACTION of the shadow
camera's depth range, so ULTRA's 96 km range would have turned -2e-4 into -19 m of peter-panning ·
terrain casting fails SILENTLY without shadowSide = FrontSide · mapSize is LATCHED, so a live set
is a no-op. CSM/PCSS/VSM/GI all rejected with reasons (CSM's job is already done for free by the
altitude-adaptive shadow ortho). **OFF is EXACT and browser-proven**, and the mobile fence holds
under the real leak condition (pref:true on /m => on:false, every lever at baseline).
**NEXT: the RELEASE when the owner's domain fix lands**, then the ULTRA taste pass (dayCurve civil
anchor 0.30 first), the sky-dome/ground-haze seam at golden hour, T1 device pass, T42, T34, then
P8/P9/M4. Entry point: `NEXT_SESSION_PROMPT.md`; log: `mem:project/wip-2026-08-22-ultra-track`.
Prior: **THE GUIDE IS FINALIZED 2026-08-22g — all ten charter slices G-A…G-J shipped, the track is
CLOSED.** Gates: **vitest 1,292/1,292 (110 files)** · astro 0 err/5 hints · `npx knip` exit-0 ·
NEW `scripts/verify-guide.mjs` **ALL PASS** (30 checks over desktop / `/m` / `/guide`, shots
`guide-01..05`) · `verify-audit3` 16/16 regression PASS.
**THE HEADLINE: the charter was not enough.** `GUIDE_FINALIZATION_PLAN.md` was authored by a
10-agent pass (58 findings, 0 refuted). A 12-agent **adversarial re-audit of the copy that
charter produced** raised 44 more and **38 SURVIVED** — including that **`move-pin` claimed
"PLAN reads the light at the pin" when `scene/planFeed.ts:342-351` has NO temp-pin rung**
(`photoApex → fpvEye → focus` only; the pin seats the AIM, via `lib/geo/aimAnchor.ts:56-57`),
that **`fpv-hud.where` named the wrong corner on BOTH shells** (desktop is bottom-left, `/m` is
top), and that **`trust-airless` had the refraction sign backwards**. *Re-verify the copy you
just wrote, not only the copy you inherited.* The charter was also **wrong once**: it scoped
`find-sunsets` desktop-only, but `/m` ships SUNSETS IN FRAME inside the PLAN sheet
(`PlanSheet.tsx:284-426`) — landing that "fix" would have created a fresh error.
Headlines a future session must not relearn:
· **THE LIVE BUG killed** — `nav()` wrote an identical `chapterId` for a same-chapter target,
React bailed, and the `[chapterId, open]` scroll effect never re-ran, so **two shipped
crosslinks did not scroll on either island**. Fixed with a monotonic `navSeq` in the deps,
browser-proven with a trigger guard (target starts 1,742 px below the fold).
· **Search rebuilt**: aliases + glyph/`/m`/`36h` query expansion + caption indexing (topic AND
chapter) + fuzzy floor 5 + prefix minLen 3 + `w × idf` expansion caps + a six-tier identity
ladder. **Two tiers were forced by measurement**: resolving a bare `[[fpv]]` to its TITLE (the
parity fix) **deleted the literal token "fpv" from the corpus** → node **ids** are indexed at
2.5; and `foc` lost to `move-search` because a rare incidental "focus" out-IDF'd "focal" *in
the title and the id* → a title/id-prefix tier. Now every curated query, all **70** topic
titles, all 11 chapter titles and all **14** goal phrases rank their own node first, negatives
still `[]`. The charter's proposed LEXICAL alias fence was **rejected on measurement** (it
permits only aliases for already-findable words); the BEHAVIOURAL fence shipped instead and
caught 7 real over-claims on day one.
· **All three surfaces at parity**: one content model, 15 fields × 3 renderers fenced by
`test/components/guideParity.test.ts`; `/m` search hoisted above the index/chapter split;
`/guide` gained goal→**topic** anchors, an `h1`, a 70-topic outline and — on the owner's
explicit order, **reversing its own written "zero client JS" charter** — a bundled search.
· **Anti-slop applied JUDICIOUSLY**: four new BANNED groups at **0 current hits** (a regression
guard — 97 of ~120 stop-slop patterns already scored zero) + one-bounded-action-per-step.
**REJECTED with counts**: the em-dash ban (4,647 in `src/**`; the skill breaks it in its own
example), three-item lists, blanket `-ly`, `never` (the C6 privacy guarantee), "cut quotables"
(the `tip` field's whole job).
· **Three defects were caught by EYEBALLING SHOTS, not by tests**: Astro scopes `<style>` so
the runtime-built `/guide` hit rows had no styles at all (`:global()`), the header did not
wrap, and `.g-goals a` matched descendants and dressed 14 reading routes as full goal cards.
· **A source fence must strip LINE comments FIRST** — block-first let a `//` line containing
`components/mobile/**` open a phantom comment that ate ~100 lines of live code
(`stripComments`, now shared in `test/styles/_css.ts`).
**T41 CLOSED** (documented in both registers: guide topic `fpv-focal-axes` + a dated
`globe-tuning.md` trap row). **T24 re-verified + dated** in the same commit as the
`guide.astro` change, and now machine-checked every `npm test`. **T42 stays OPEN** (8
owner-taste crops) but is annotated with what this session settled.
**NEXT: the RELEASE when the owner's domain fix lands** (new rider — confirm `/guide`'s bundled
search unhides in prod), then T1 device pass, T34, then P8/P9/M4 · U8 sync ladder.
Entry point: `NEXT_SESSION_PROMPT.md`; log: `mem:project/wip-2026-08-22-guide-final`.
Prior: **AUDIT #3 FIX SLICES F1–F10 ALL SHIPPED 2026-08-22e — the queue is EMPTY.** Gates: **vitest
1,217/1,217 (107 files)** · astro 0 err/5 hints · **`npx knip` exit-0 clean** · all SEVEN
regression suites PASS + NEW `scripts/verify-audit3.mjs` both shells (shots `a3-01..04`).
Backlog **T32/T35/T36/T37/T38/T39/T40 CLOSED**; **T41 + T42 opened** (below).
Headlines a future session must not relearn:
· **F4/T36 — ONE `lib/geo/aimAnchor.aimAnchorFor()`** on all three radar surfaces (FPV eye →
placed photo → temp pin → view focus). Browser-measured: the camera NADIR sat **4,341 m** from
the view focus on a tilted desktop orbit — the size of the bug the chart's private ladder had.
**THE AUDIT'S OWN C8 FINDING THEN BIT THE HARNESS LIVE**: `verify-qaslice-cab.mjs` had
transcribed the old ladder and failed by 81.8 m against the CORRECTED app. The chart now
PUBLISHES its resolved anchor (`__mapWindowView.anchor*`) and the script reads it.
**RULE: a verify script never re-derives a shipped decision.**
· **F1/T32 — the test found a SECOND throw site inspection had missed**: `SearchRiseSet(...,
metersAboveGround)` builds a second observer at `height − metersAboveGround`, so a clamped
10 km observer against an un-clamped 6,000 km eye still threw. `planElevationsM()` writes both.
· **F1/T37 — the audit's literal one-liner would have been a regression**: `draw()` runs at
~20 Hz in FPV, so a bare `cache.delete(url)` in `onerror` = a 20 req/s storm. Shipped with a
30 s cooldown + a capped warn. **Read an audit's "specific fix" as a direction, not a patch.**
· **F5/T35 — four seams extracted** (`lib/geo/radarBands` · `scene/tangentOverlay` ·
`panels/radarCanvas` · `slippy.chartTransform`); jscpd 35→33 clones, 1.14→1.06 %.
· **F6 — CDP targets now close themselves** (`scripts/verify-cdp-cleanup.mjs`, all 20 scripts);
fences de-brittled (JSX depth, brace matching, presence pins); A1-16 `PLAN.minCoverageForGaps`
gives the three radars ONE evidence-floored gap gate.
· **F7 — docs**: `globe-tuning.md` gained the batch-#4→#7 tunables + the sticky-overlay-px and
injected-GLSL-header traps · `verify.md` gained all six harness classes + gesture recipes ·
`contracts.md` §3 15→**20** seams, §7 8→**9** routes · `UXBATCH4_PLAN.md` → `archive/`.
· **F9 — guide**: 4 NEW topics (`fpv-cone`, `move-aimstick`, `fpv-map-controls`,
`fpv-map-gestures`) + 6 extensions; NEW reproducible `scripts/shoot-guide.mjs` re-shot
`orbit`/`fpv`/`fpv-m`/`target` warm and added `fpv-map`.
**OWNER ORDERS 2026-08-22f — T41 RULED + the next session is SINGLE-TRACK: FINALIZE THE GUIDE.**
· **T41 ACCEPTED AS-IS** ("i am ok for now with this and understand the reasoning") → a DOCS item,
not a code item. Mechanism CORRECTED while ruling it: `Joystick.tsx:115-117` shows that **inside
FPV both readouts derive from the SAME live vertical FOV**, so the divergence is purely the sensor
AXIS — `focalFromVerticalFov` measures across the frame's HEIGHT (24 mm, 6 consumers),
`focalMmFromHFov` across its WIDTH (36 mm, 1 consumer). No second source of truth.
· **The guide charter is `.claude/claude-docs/GUIDE_FINALIZATION_PLAN.md`** (732 lines, 10
dependency-ordered slices G-A…G-J, each with the command that proves it done). Authored by a
10-agent fan-out; 58 findings, **0 refuted** in adversarial verification.
**The headline is a REJECTION** — 97 of ~120 stop-slop patterns score ZERO hits (the guide already
reads the way the skill wants), while adopting it wholesale would destroy em dashes (4,647 in
`src/**`; the skill breaks its own rule at `examples.md:45`), three-item lists (19 real UI
enumerations), `-ly` precision words, `never` (the C6 privacy guarantee) and "quotables" (the
`tip` field's whole job). ADOPTED instead: one new BANNED group covering the *essayist* tells the
*marketing* lint never reached, at 0 current hits — a REGRESSION GUARD — plus i-have-adhd's
one-bounded-action-per-step rule (12 of 43 shipped steps violate it).
**LIVE BUG found and verified, not yet fixed:** a crosslink to a topic in the CURRENT chapter does
not scroll on EITHER island — `nav()` sets an identical `chapterId`, React bails, and the scroll
effect's `[chapterId, open]` deps never re-fire (`Guide.tsx:110-116` vs `:157`;
`GuideSheet.tsx:95-100` vs `:117`). Two shipped crosslinks hit it today.
Then the standing release gate (owner's domain fix), T1 (which now also owes the **unmeasured** F3
per-frame ms), T34, then P8/P9/M4 · U8 sync ladder. Entry point: `NEXT_SESSION_PROMPT.md`;
log: `mem:project/wip-2026-08-22-audit3-fixslices`.
Prior: **OWNER MICRO-SLICE SHIPPED + AUDIT #3 COMPLETE 2026-08-22 (a/b/c)** — gates **vitest
1,147/1,147 (102 files)** · astro 0 err/5 hints · `verify-qaslice-cab.mjs` **64/64 both
shells** · all seven regression suites PASS.
**(a/b) Owner micro-slice, 4 items:** the expanded-map manual-pan override is now PERMANENT
(the `FOLLOW_REARM_M` eye-motion re-arm DELETED — walking never recentres the chart, verified
0.0 m hold with the eye 302 m out vs a 184 m half-diagonal; radar/cone unchanged by design) ·
NEW round **◉ RE-CENTRE** button both shells (`aimAnchorNow` centre + latch clear; muted →
accent-lit, transition-only mirror) · ALL map attribution → ONE thin full-bleed line on the
SCREEN's bottom edge (`--mw-credit-h` LIFT of `.ts`/`.m-bottom`/`.tr`, never a z-bump) ·
`/m` PiP TOP-ALIGNED with the MAP/+/− pills via shared `--mw-top-y`/`--mw-pip-h` tokens.
**Four defects in that slice were caught by the audit and fixed BEFORE ship**: a 2 px
long-press drift armed the permanent override · the ◉ (the sole exit) was occludable by the
z-24 FPV altitude column on short viewports — **a z-index cannot fix that, `.mw` is its own
stacking context**, so the seat carries a geometric floor · the desktop attribution truncated
below ≈900 px, losing "© Esri" · `.tr` was not lifted with `.ts`. Two collisions came from
the shells NOT being symmetric (desktop already had a superset `.map-credit` on that edge;
`/m` has no page chrome) — `.mw-creditbar` is /m-only and desktop promotes the page line.
**(c) AUDIT #3 COMPLETE — report `audits/audit-batchseams-2026-08-22.md`** (4 tracks, TWO
WAVES so a session limit can't void all four; 46 candidates, 0 deleted in verification).
**Headline: FIVE checks that could not fail — four written the same session — found and
fixed** (unfalsifiable regex · a lift check that held with the lift deleted · a GET counter
that could count zero and pass · a "responded" check with no trigger guard · a vacuously
captured guard). **C7 REFUTED a PASS recorded in DECISIONS 2026-08-21h** (the FOV inverse
pair was NOT transitively pinned — it came from a killed agent's pre-verification output;
now pinned for real). Docs reorg part 1 shipped (ARCHITECTURE §7 had 3 factually WRONG
claims; the guide taught a gesture the code doesn't perform, and the code *delegated* that
affordance to the guide). **NEXT SESSION: the audit's F1–F10 fix slices + T34–T40** —
start F1 (one-liners: tile `onerror`, seat-reset gate, stale comment, DEV-seam registry,
T32 planner ceiling), then F7 docs remainder (globe-tuning tunables + the two missing traps ·
verify.md's six harness classes · `contracts.md` §2/§3/§7 · `UXBATCH4_PLAN`→archive AFTER
`contracts.md`), then **F8 DECISIONS compaction round 4 (DUE — boundary measured `:319`→`:879`,
34 rows ≈79.5 KB)**, then F9 guide work (4 new topics + 6 extensions + 11 stale re-shoots).
Release still gated on the owner's domain fix; T1 device pass grown.
Logs: `mem:project/wip-2026-08-22-owner-microslice` · `mem:project/wip-2026-08-22-audit3`.
Prior: **PRE-AUDIT QA SLICE C→A→B SHIPPED 2026-08-21h + AUDIT #3 STARTED then RESCHEDULED**
(DECISIONS 2026-08-21h; gates **vitest 1,128/1,128** · astro 0 err/5 hints; NEW
`scripts/verify-qaslice-cab.mjs` 17/17 [shots qsl-01..05] + ALL SEVEN regression suites
uxb4/s2/s3/uxb5/uxb6/uxb7/qa7ab PASS, Chrome restarted between suites):
(C) **CRITICAL QA-7b regression KILLED** — the overlay-composite rebuild storm on every
2D↔FPV/3D flip. NEW pure `stickyOverlayPx()` (lib/globe/quality): the effective composite px
only RATCHETS UP (first flat-chart visit or a governor promote; ≤1 post-boot rebuild per
rung) and never lowers on a mode flip OR a governor demote (the S3-era rebuild-on-demote
folds under the same rule); `overlayPxEff` seeded 0 ⇒ frame-1 write == constructor px, a
no-op. Root cause 2 confirmed from UpdateOnChangePlugin source ⇒ ONE-frame refinement kicks
in imageryGround `setOverlayResolution` + `setQualityTier`. NEW DEV probe
`window.__overlayRebuilds` is THE storm assert (raw Esri GET counts CANNOT isolate it).
Verified 1 rebuild at boot, **0 across two full 2D→FPV→2D cycles**, uFtwFade holds.
RESIDUAL SURFACED (pre-existing, #15-adjacent): ~600 Esri GETs per flip leg from ground-LRU
rest-trim churn (cache rests at exactly minBytesSize) — candidate levers: mode-aware LRU
floors / flip-freeze.
(A) **expanded-minimap follow YIELDS to manual exploration** — `manualPan` latch (any
pan/pinch) cleared only by eye motion > `FOLLOW_REARM_M 0.5` m from the latch anchor;
verified drag 142 m holds 0.0 m standing, walk 119 m recentres to the 18.5 m deadband edge.
(B) **screen-relative walk on the expanded chart, both shells** — NEW pure `chartWalkAzRad`
+ `store/minimap.mapWindowRotRad` + DEV probe `window.__mapWindowView`; verified on a
twisted chart: stick-up track 270.0° vs chart-up 270.0°, **Δ 0.0°**.
**AUDIT #3**: checklists re-mined (code.md +23/+24/+25, tests.md +10) and **Track E
COMPLETE**; the 4 finder agents (A1/A2/C/D) all died on an API session limit before
reporting — transcripts harvested, recovered pre-verification leads in NEXT_SESSION_PROMPT's
"RECOVERED partial findings" block. **NEXT SESSION — (0) the OWNER MICRO-SLICE FIRST
(addendum 2026-08-22, after device-testing the 21h slice; spec = NEXT_SESSION_PROMPT §0):
the manual-pan override becomes PERMANENT (delete the `FOLLOW_REARM_M` eye-motion re-arm —
walking never recentres the chart, even past the view bounds; radar/cone rule unchanged) +
a NEW round ◉ RE-CENTRE button on the map's right edge under the +/− zooms (centres on
`aimAnchorNow`, clears the latch, restores follow) + ALL map attribution moved to one very
thin line at the BOTTOM EDGE under the time strip (needs `--mw-credit-h` dock/scrubber
offset, not a z-bump; keep the Esri/CARTO/OSM list legible — contractual); rider: the
qaslice-cab "walking re-armed the follow" check is SUPERSEDED — invert + annotate.
(1) THEN audit results handling — RE-LAUNCH the four finder tracks (two waves, so a limit
can't void all four) → verification pass → report to `audits/` → then DOCS REORG (ARCHITECTURE §7 · globe-tuning tunables · plans archive ·
verify.md traps · README gate counts · DECISIONS compaction check) → then GUIDE WORK
(bands/gaps/aim/PiP/place-point/time-strip/photo-chart/search + the NEW manual-drag and
chart-up-walk topics) + warm re-shoots. Release still gated on the owner's domain fix;
T1 device pass grown by the QA-slice items.**
Log: `mem:project/wip-2026-08-21-qaslice-cab`.
Prior: **OWNER QA BATCH SHIPPED 2026-08-21f — 6 fixes + 1 answered question after device QA**
(DECISIONS 2026-08-21f; gates 1,116/1,116 · astro 0 err/5 hints; regressions uxb4 23/23 +
s2 16/16 + s3 18/18 + uxb5 17/17 + uxb6 12/12 + NEW `verify-uxbatch7.mjs` 22/22, shots
uxb7-01..06): (1) expanded-minimap radar FOLLOWS the viewer — MapWindow anchor camGeo-first
while FPV live + `fpvPinKey` re-seat (fresh basis at a new pin, walk offset zeroed — eye
0.0 m from pin) + 0.12 rubber-band chart follow + size unified via `AIMCONES.mapRadiusHK
0.5` (fraction-of-height, was ≈3.7× too small on /m) · (2) FPV entry consumes plannedView
(heading + verticalFovDeg) on place-point + /m ▲3D + desktop map — verified 137.0°/76.5°
exact · (3) radar skyline GAPS on all 3 surfaces (`fractureRunsBySkyline` + `skylineGuardM
60`; research REFUTED the "lost gaps" suspicion — they never existed; GL-fan visual = T1
rider) · (4) expanded-map bottom = the REAL time dock (/m, mw-open z-24 lift) / REAL
TimeScrubber (desktop, z 43); bottom hint/credit retired to the top band · (5) /m .fh-chip
z 9 under all controls · (6) TYPE-TO-SEARCH placeholders + the iOS search dark-screen fix
(focus({preventScroll}) in-commit + scroll pin; REAL-iOS feel = T1) · (7) map-quality
question ANSWERED: 2D map = GL (z17 coarse cap + DPR 1.25 + stylized grade) vs minimap =
raw z19/DPR-2 canvas — owner ruling wanted on the free `uFtwFlat2d` de-grade vs z18/DPR-1.5.
SAME SESSION (2026-08-21g): QA-7 a+b SHIPPED on the owner's "try both" — (a) PHOTOGRAPHIC
flat chart (`GROUND.flat2dPhotoK` → uFtwPhotoK; grade lerps out on /m 2D + desktop nadir
flat-map; dark-CARTO untouched) · (b) `esriMaxLevelCoarse 17→18` + flat-only DPR 1.5
(`leanMobile.dprCap2d`, TilesHandle.mapFlat-gated) + `GROUND.overlayResolution2dPx 512`
(the 256 composite alone pinned the chart a level shallow — all three levers needed).
z18 CDP-verified; A/B shots qa7-08/09 night-and-day; rollback knobs independent (T1).
TRAPS: verify-Chrome exhausts WebGL contexts across suites (restart between suites);
Vite 504 "Outdated Optimize Dep" after new globe-bundle imports (restart wix dev);
imageryGround injected-GLSL uniforms MUST be declared in the fragment header (JS uniforms
object alone ⇒ silent compile fail, previous program keeps rendering, pokes no-op);
headless Chrome governs to tier `low` — assert DPR via __globeQuality tier-consistency.
**NEXT SESSION (owner orders 2026-08-21f-end + g-end): FIRST a 3-item QA slice —
(C) CRITICAL regression from QA-7b: overlay-composite REBUILD STORM on every 2D↔FPV/3D
flip (white chart seconds→10 s+, load storm, blurry stall; desktop below tier high too) —
sticky composite resolution + refinement kick; mitigation knob overlayResolution2dPx→256;
full diagnosis NEXT_SESSION_PROMPT §0C · then
(A) expanded-minimap follow YIELDS to manual drag/focal edits (manualPan latch cleared by
an eye-motion detector; follow only on explicit movement) · (B) SCREEN-relative walk
controls while mapWindowOpen, both shells (stick/arrow-up = chart-up regardless of twist,
converted to true-world bearing via a published mapWindowRotRad; nowhere else) — full specs
NEXT_SESSION_PROMPT §0. THEN the standing charter: AUDIT + REVIEW +
DOCS REORG + GUIDE WORK — the full charter is NEXT_SESSION_PROMPT.md (audit READ-ONLY →
audits/; adversarial review of the QA fixes' edges; ARCHITECTURE §7 + globe-tuning +
verify.md refresh + plans archive + DECISIONS-compaction check; guideContent topics for
bands/gaps/aim/PiP/place-point/time-strip/photo-chart/search + warm re-shoots). Release
still gated on the owner's domain fix (batches #4–#6 + QA batch ride it); T1 device pass
judges QA-7 a+b knobs → then P8/P9/M4 · U8 sync ladder.**
Log: `mem:project/wip-2026-08-21-owner-qabatch7`.
Prior: **OWNER BATCH #6 SHIPPED 2026-08-21e — 4/4 fixes on batch #5, same session** (DECISIONS
2026-08-21e; gates 1,109/1,109 · astro 0 err/5 hints; verify S1 23/23 + s2 16/16 [2 checks
superseded] + s3 18/18 + uxb5 17/17 + NEW `verify-uxbatch6.mjs` 12/12, shots uxb6-01..05):
(1) placed point OWNS the map radar (MapWindow anchor `tempPin ?? camGeo ?? focus`) and —
kept deliberately — relocates a STANDING temp FPV (tempPinPoint per-frame re-pose; the PiP
previews the new point, tap = you're there) · (2) band stack REORDERED+COMPACTED (supersedes
the batch-#4 sketch): moon INNERMOST / sun / target small-gap above at 3× band width off the
rim — desktop [0.3,0.38]/[0.42,0.5]/[0.55,0.79], mobile [0.24,0.32]/[0.34,0.42]/NEW
bandTargetMobile [0.46,0.7]; N rides bandTarget[1]×northOffsetK (GL + MapWindow); "lost
moon" = silver-on-bright readability (+ maybe a dismissed MOON direction) — drawn innermost
now, alpha bump = T1 taste · (3) focal cone seeded FROM BOOT (stepPlannedView null-seed) +
aim-stick mm focal footer (NEW pure `focalMmFromHFov`, Joystick `footer` prop,
`.m-joy__footer`) · (4) /m aim stick above the WALK stick (`.m-joy--aim-fpv`, one MobileShell
instance `variant={fpvOn?"fpv":"map"}`; minimap-corner instance DESKTOP-ONLY; rides the
mw-open z-24 rung so it survives the /m fullscreen map). TRAPS: the /m left rail is two
stacked z-24 pads — synthetic map presses below x≈126 land on sticks; wix dev on :4321 died
mid-session once — check before browser work. **NEXT SESSION (owner order 2026-08-21e): REVIEW/AUDIT PASS + reconcile docs/guides after
batches #4–#6 — /frame Audit mode (READ-ONLY report → audits/; scope: batch-touched seams +
debris sweep), ARCHITECTURE/globe-tuning refresh, guideContent topics (bands, aim-stick
seats + mm footer, PiP, place-point, dock inputs, shell-switch) + guide re-shoots. Release
still gated on the owner's domain fix (batches #4+#5+#6 ride it); T1 device pass after
(moon-silver readability, aim-pad size, place-point-FPV-relocate feel, PiP perf); then P8
conjunctions + P9 lunar eclipses + M4 · U8 sync-phase ladder.**
Log: `mem:project/wip-2026-08-21-owner-uxbatch6`.
Prior: **OWNER BATCH #5 SHIPPED 2026-08-21d — 6/6 post-batch-#4 fixes** (DECISIONS 2026-08-21d;
gates 1,107/1,107 · astro 0 err/5 hints; S1 23/23 + S2 15/15 + S3 18/18 regressions + NEW
`verify-uxbatch5.mjs` 17/17, shots uxb5-01..05; owner's report screenshots arrived BROKEN —
fixes driven from written descriptions + own shots): (1) radar bands ALWAYS-filled —
`AIMCONES.fillAlphaRest 0.05` (the ×emphEased gate zeroed non-focused fills, root cause), 3
surfaces; focal-cone edge de-fattened 3.0×→1.25× (`edgeHalfWidthK 0.000625` — GL width is in
ray-extended units ×rayLenK) + minimap cone legs-only · (2) /m radar ×0.8
(`mobileRadiusK`, orchestrator-pushed `mobile:` flag) + `bandSun/MoonMobile` inward rings ·
(3) /m PiP = TRUE miniature — `.mw-pip` 32vw×32dvh (equal fractions ⇒ screen aspect ⇒ live
camera reused), `minimap.pipRect` → `TilesHandle.pipRect()` → GlobeCanvas scissored second
render after composer (restore viewport!); `body.m.mw-open` hides `.mm/.m-fpvhud/.fh-chip`
(the minimap-in-minimap leak) · (4) /m map long-press = PLACE POINT only (setTempPin, stays
open; wantKind===fpvKind ⇒ no FPV re-entry; desktop keeps VIEW FROM HERE) · (5) /m dock —
S1's `.md-rate` CSS deletion had ORPHANED `.md-date` onto the invert rule (whole input
inverted/unstyled); rebuilt as .ts-date twin + native `<input type=time>` picker = desktop
parity · (6) shell-switch pose carry — NEW pure `mobileShellHash()` (#p= tilt→0 for the 2D
door, #f= exact) at topnav/banner/Welcome + /m DESKTOP chip carries raw hash to /?d=1.
TRAP: /m re-mirrors the live camera into location.hash ~1.6s after boot — assert boot
RESULTS in verify scripts, never the link hash. **NEXT SESSION: release when the owner
finishes the domain fix (batches #4+#5 ride it; probe /sw.js after); T1 device pass (grown:
PiP scaled-pass feel, band-wash + mobile-radar taste, iOS time-input popover); then P8
conjunctions + P9 lunar eclipses + M4 mobile resume · U8 sync-phase ladder.** Log:
`mem:project/wip-2026-08-21-owner-uxbatch5`.
Prior: **OWNER BATCH #4 S3 SHIPPED 2026-08-21c — BATCH CLOSED 18/18** (DECISIONS 2026-08-21c; gates
1,101/1,101 · astro 0 err/5 hints; S1 23/23 + S2 15/15 regression + NEW `verify-uxbatch4-s3.mjs`
18/18, shots uxb4-s3-01..04): (17) radar sun/moon band FUTURE halves wear body ink —
`bandFutureInk()` (aimCones, unit-locked), per-body uFuture + both canvas twins via `b.color` ·
(18) TargetPanel GOTO pill before SHOW — chip handler extracted to `store/skyAim.gotoSkyBody`
(marker mirror → live-ephemeris fallback; `gotoAimSolution` pure twin tested) · (#5) iOS
resilience — contextlost render gate + composer realloc on restore; hidden tick skip w/
governor-clock re-seat; visibilitychange/pagehide freeze of ALL NINE tile queues
(PriorityQueue.autoUpdate); NEW `QUALITY.leanMobile` coarse-pointer overrides (DPR 1.25 /
bloom off / shadow 1024 — tile knobs stay per-tier, high test-locked) · (#15) NEW
`public/sw.js` iOS-ONLY tile cache (dev-gated, 7-day-TTL performance cache — Esri ToS posture
flagged; policy fenced by test/swTileCache.test.ts) + per-tier `overlayResolutionPx` 512/256/256
w/ `ground.setOverlayResolution` fresh-instance rebuild path + `esriMaxLevelCoarse 17` +
ground-only `groundLruBytesMB` 320/192 + per-URL force-cache (overlay images / .terrain / .glb
/ .pbf; manifests revalidate) · (#1) /m PiP `.mw-pip` 200px live-3D hole (draw() clearRect
under its DOM box; body.m .mw background dropped) replaces ✕ MINI-MAP, tap → back to FPV.
UNVERIFIED → T1 + first release: /sw.js on Wix hosting (Content-Type unprobed), real-iOS
jetsam/heat, z17/256 look, tint/PiP taste. **NEXT SESSION: release when the owner finishes the
domain fix (batch #4 rides it; NEW rider — probe https://www.plux.today/sw.js after the flip);
T1 device pass (grown: lean heat, SW effect, PiP feel, band tint taste); then P8 conjunctions
+ P9 lunar eclipses + M4 mobile resume · U8 sync-phase ladder.** Log:
`mem:project/wip-2026-08-21-owner-uxbatch4` · plan `UXBATCH4_PLAN.md` (§S3 as-built).
Prior (S2, 2026-08-21b — 14/18 items done, owner addendum #2 post-S2 added 17+18) (DECISIONS 2026-08-21b; gates
1,088/1,088 · astro 0 err; S1 regression ALL PASS + NEW `verify-uxbatch4-s2.mjs` 15/15 both
shells): radar → concentric annular bands (AIMCONES.bandSun/.bandMoon/.bandTarget — ONE model,
three surfaces incl. the NEW minimap radar; compactK/lineLenK RETIRED; N rim marker
everywhere) · focal cone EVERYWHERE (camera-store `plannedView` heading+HORIZONTAL-fov,
session-only, seeds photo/jump/FPV-exit/stick; NEW `scene/focalCone.ts` + `--color-focal-cone`
#E08FC6; MapWindow hardcoded-0.22 replaced; math in `lib/geo/plannedView.ts`) · AIM joystick
both shells (NEW shared `components/controls/` tier — mobileFence rule 3) · MapWindow
two-finger TWIST (`view.rot` + ONE `xformNow()` transform) · street labels ×0.5 BOTH branches
(the world-size floor was the giant-label cause) · S1 long-press login-nav BUG fixed
(document-capture click swallow — element-level swallows die with their element). Side quest:
ALL UPLIFT rendering optimizations audited IN-PLACE-WIRED; cache-ENABLED measurement
(`scripts/measure-tile-cache.mjs`) REFUTES desktop cache-busting — disk cache holds ≈95% on
reload, owner's observation ≈ DevTools disable-cache; iOS-small-cache ranking STANDS (SW
mitigation now iOS-directed). S3 lever warning: GROUND.overlayResolution is construction-time
— the 256 shrink needs a plugin rebuild path. **NEXT SESSION: batch #4 S3 = #15 SW tile cache
(iOS-directed) + demand shrink + #5 iOS contextlost/pagehide/lean profile + #1 minimap PiP
(the S2 xformNow rewrite makes the punched hole easy). Release still GATED on the owner's
domain fix.** Log: `mem:project/wip-2026-08-21-owner-uxbatch4` · plan `UXBATCH4_PLAN.md`.
Prior (S1, 2026-08-21 — 10/15 items) (DECISIONS 2026-08-21; gates
1,074/1,074 · astro 0 err; both shells verified via NEW re-runnable
`scripts/verify-uxbatch4.mjs` 23/23): iOS selection tint killed (global user-select none) ·
2D-map two-finger ROTATE + tilt-into-3D door removed (`mobile2dFreeHeading` latch) ·
MapWindow continuous fractional pinch (PINCH_SENS 0.8, FPV z18) + desktop drag/−10% (DragGrip
overflow-clip trap fixed) · target tracking ray FAR (rayLenK 6 / canvas edge) · vector ink
halved + `vectorsVisible` pref + VEC / ▤ VECTOR toggles · ⌖ FIND IN FRAME above UNFOLLOW both
shells · long-press ▲ 3D → FPV jump at map centre w/ last focal · /m dock time-only clock
(PLAY+rate retired on /m) · Guide resizable (search had already shipped 19d). Plan + specs:
`UXBATCH4_PLAN.md`; log `mem:project/wip-2026-08-21-owner-uxbatch4`. **NEXT SESSION: batch #4
S2 = radar rework #9 (clipped target zone + thin sun/moon concentric bands + capped dials,
unified GL/canvas/minimap) + focal cone everywhere (needs planned-view heading+focal state) +
#11 focal joystick + #4b MapWindow twist — design-first. Then S3 = #15 tile-storm (SW cache;
headers probed fine — cause is LRU re-fetch vs iOS cache) + #5 iOS reload/heat (contextlost/
pagehide/lean profile) + #1 minimap PiP. Release still GATED on the owner's domain fix.**
Prior state (2026-08-19d): **PLUX LAUNCH GROOMING SHIPPED** (DECISIONS 2026-08-19d; gates 1,073/1,073 ·
astro 0 err; both shells + /guide CDP-verified): brand Sidera→PLUX everywhere (wordmark hero,
nav/strip/upload marks, favicon.png + apple-touch, favicon.svg deleted) · domain plux.today
assessed + repo flipped to `https://www.plux.today` (SITE_URL + 7 script defaults;
`FTW_SITE_URL` override) — **PROD IS DARK until the owner finishes the GoDaddy nameserver
replacement (Nameservers → Change → own nameservers = ONLY ns8/ns9.wixdns.net), Wix issues the
www TLS cert, and the headless OAuth allowlist gains plux.today; `wix release` is GATED on
that** · guide G2-refresh (16 topics corrected + 7 new + 3 goals; shell-m.webp re-shot; other
5 desktop shots = warm-cache tail) · guide BM25+fuzzy search both shells
(`lib/guide/search.ts` + rail/sheet UIs, 11 tests). See
`mem:project/wip-2026-08-19-plux-launch-grooming`. **NEXT SESSION: confirm domain live → wix
release (first Plux prod + standing canary) → warm-prod-assets → re-shoot the 5 stale guide
shots on a warm cache → owner taste pass (logo sizes, search placement).**
Prior batch (#3, 2026-08-19c — all 9 announced items + 2 batch-#2 tails)
(DECISIONS 2026-08-19c; gates 1,062/1,062 · astro 0 err/5 hints; browser-verified both
shells over the owner's CDP Chrome, shots uxb3-01..07): desktop 2×4 toggle grid · desktop
radar <10 km band · my-places-on-map desktop FIXED (missing `.ct-places.is-on` lit CSS +
new GL `scene/placeMarkers.ts` lavender dots on the MAIN globe + save/delete local push) ·
UNFOLLOW also disables its FIND body · /m LAYERS expands LEFT · radar-bearings regression
FIXED (UNFOLLOW dismissal now session-only + body-named DIRECTION labels + one-time
`prefsRev` re-arm of corrupted aim/SHOW offs) · places lists nearest-first
(`lib/geo/proximity.ts`) · /m SAVE VIEW optional-name Sheet (portaled) · GOTO tracked-target
chips both shells (`panels/SkyGotoChips.tsx`; below-horizon → `nextRiseAzimuth` aim). See
`mem:project/wip-2026-08-19-owner-uxbatch3` (rulings + traps — incl. the foreign-CDP
rAF-throttle trap + the depthTest:false far-hemisphere cull rule). **NEXT SESSION: batch-#3
tails if the owner flags them (FPV mini-map place markers · bright-target FIND refinement ·
taste pass), then P8 conjunctions + P9 lunar eclipses + M4 mobile resume.**
Prior batch (#2, 2026-08-19b — all 11 items; DECISIONS 2026-08-19b;
gates 1,052/1,052 · astro 0 err/5 hints; browser-verified both shells, shots uxb2-01..05):
cap 1000 · /m map glyph + day steppers + joystick-over-fullscreen-map · Esc-closes-map-first ·
SKY search default · DISABLE menu labels + find-in-frame composite-state fix · UNFOLLOW verb
(`sky.stopFollowing`; visible=false = dismissed everywhere) + peek hint + target-section
reorder both shells · FIND third body generalised `gc`→`target` (ANY tracked target) ·
/m ⊞ LAYERS chip + MY-PLACES-ON-MAP (`store/places.ts`, 2D MapWindow markers, pinLavender) +
`aimVisible` RADAR master + `pinsVisible` /m-default-off. See
`mem:project/wip-2026-08-19-owner-uxbatch2` (rulings, traps — incl. the wix-dev-SIGPIPE
harness trap). **NEXT SESSION: batch tails first if the owner flags them (GL-globe/minimap
saved-place markers · post-save push into placesMap · bright-target FIND visibility · taste
pass), then P8 conjunctions + P9 lunar eclipses + M4 mobile resume.**
Prior milestone (U8, ladder COMPLETE): (DECISIONS top entry 2026-08-19; gates 1,048/1,048 · astro 0 err/5 hints;
browser-verified both shells via `scripts/verify-bldg-override.mjs`, shots u8-01..06).
FPV dblclick/double-tap arms an enriched building → claimed-pointer drag with SOLID original +
ghost preview + mesh-pinned dual-height label → commit persists to `ftw:bldg-overrides:v1`
(per-edit band 0.5×/3×; scale folded into applyFeatureSeats — commutes with seats; checksum
invalidates on re-bake). Bakers now emit `cell-*.meta.json` osmId sidecars; backend PREPARED
but dormant for the batch-sync phase (LWW BuildingOverrides + bulkSave endpoint; activation
ladder in NEXT_SESSION §2 — provision script NOT yet run). **NEXT SESSION = the owner's
announced batch of minor-to-medium improvements + UX fixes (2026-08-18r)** — start from their
list; then P8 conjunctions + P9 lunar eclipses + M4 mobile resume.
Open riders: production canary (U8 + terrain + o2w-default + B1/T2/T3) on next `wix release` ·
T1 owner device pass (now also judges the U8 glass gesture feel) · T29 extraction slice · T32
one-liner · T28 · B4/T30 · Esri imagery rider · cross-region enriched attach mid-session
(named tail). See `NEXT_SESSION_PROMPT.md` + `mem:project/wip-2026-08-18-u8-height-override`
(rulings + traps incl. the TilesGroup ghost-matrix trap) +
`mem:project/wip-2026-08-18-u7b-glo30-terrain-buildings-rule` + **`BAKED_ASSETS.md`** (the
baked buildings/terrain/regions domain doc — now incl. the U8 identity sidecars).

## Source layout (as-built; refreshed 2026-08-15)
Fuller map: ARCHITECTURE §7 · contract-strings/field inventory: `conventions/contracts.md`.
- `src/components/globe/` — client:only three.js scene. `tuning.ts` (ALL tunables, documented) ·
  `scene/*` attach-modules (baseEarth/graticule/atmosphere/stars/buildings/enrichedBuildings/
  buildingMaterial/imageryGround/vectorTiles/vectorFeatures/streetNames/geoLabels/sky/skyTarget/
  skyTrail/skyGhosts/skyNames/findGhosts/dayArcs/planFeed/minimapFeed + glsl) ·
  `StylizedTiles.ts` orchestrator (named step-closures) · `PhotoFrustum.ts` · `Pins.ts` ·
  `flight.ts` · `explore.ts` · `GlobeCanvas.tsx`. Design imports NEVER touch.
  Convention: `.claude/conventions/globe-tuning.md`.
- `src/components/panels|ui/` — the full desktop chrome (UploadFlow, PhotoDetailPanel,
  LocationFinder, TimeScrubber, TimeReadout, CameraTiltPanel, FpvHud, TargetPanel, PlanPanel,
  FindPanel, PlanFindToggle, Guide, Frame/Today/MoonCal/SpotStars cards, SkyContextMenu,
  MyPins, MyLocation, Marketplace, Welcome, ExploreMode, MemberBadge, MiniMap, PinHoverCard
  + ui/*). Design imports allowed. `src/components/mobile/` — the full `/m` shell
  (MobileShell, Sheet/TabBar, PlanSheet, FindSheet, GuideSheet, TargetSheet/TargetPeek,
  MobileSearch, MobileAccount, MobilePlaces, MobileTimeDock, FpvControls, SceneActions).
- `src/lib/` — ALL REAL: decode (libraw-wasm@1.0.5 worker) · geo (projection/frustum/geohash/
  terrain/precision/urlPose/occlusion/horizonProfile/…) · ephemeris (bodies/comet/targets/
  planner/stars/asterisms/dayArc/frameFinder/sunEventFrame/moonCalendar/mwSeason/twilight/
  topo/…) · sky (catalog/searchIndex/openngc/simbad/sbdb/hoverNames/ttlCache/…) · globe
  (quality/enrichedVariant/enrichedMask) · guide (guideContent + inline crosslink grammar) ·
  pins (fields = shared row mappers, appearance) · photo (npf) · export (ics) · market+save+wix
  (record builders + SDK clients) · theme (GL token bridge) · format/api/prefs/textures.
- `src/store/` — zustand: upload/camera/time/pins/member/save/market/plan/sky/skyAim/minimap/find.
- `src/pages/` — index.astro + m.astro (+ layouts) + `api/*` thin endpoints (~8 routes: photos,
  places, listings, market, upload-url, sbdb, dev-seed, ping); there is NO `src/backend/`.
- `public/textures|data/` — earth + milky-way sets (8k desktop / 2k mobile) + baked catalogs
  (bsc5.bin, openngc.bin, constellation-lines.json). `public/guide/` — 12 guide screenshots
  (warm-list-coupled). `test/` — vitest twins of every lib (886 tests as of 2026-08-15).

## Key invariants (violations = bugs)
- Globe is `client:only` — **never SSR WebGL**. Decode runs in a **Web Worker**; free RAW buffers immediately.
- **Never fabricate a Wix API signature** — verify via Wix MCP. Keep endpoints thin (heavy compute client-side, C1).
- Stylize tiles via `load-model` material swap, **not** `BatchedTilesPlugin`. On ground-imagery tiles,
  **chain** onBeforeCompile (TilesFadePlugin already wrapped it). Astro **5** only (not 6).
- Globe/GL colour flows through `lib/theme/tokens.ts` (D14). Colour textures = sRGB; data textures =
  `NoColorSpace`. Fence design imports to panels/ui/styles.
- **C6 privacy:** never expose exact GPS on a public pin (reduced precision: exact/1km/city).
- No split payments → owner-mediated payout. Claude vision → JPEG only, never RAW. Wix Data → geohash, no geo query.

## Authority
`PROJECT_SEED.md` §3 (C1–C6) + §4 (ADR D1–D15) are **binding**. `ARCHITECTURE.md` + `IMPLEMENTATION_PLAN.md`
are the execution source of truth (distilled from `provenance/DEEP_RESEARCH.md` = provenance). Conventions:
`.claude/conventions/` (`wix-headless.md` = platform mechanics). Workflow: the **`/frame`** skill.

## Related memories
- `mem:tech_stack` — runtime/deps/tooling · `mem:suggested_commands` — build/test/dev/release
- `mem:task_completion` — quality gate before done · `mem:project/dev_environment` — what can't be tested locally
- `mem:project/wix-platform` — Wix mechanics + gotchas + TODO-VERIFY · `mem:project/wix-site` — live URL + siteId/appId
- `mem:architecture/system-overview` — the engine + pipelines
- `mem:patterns/globe-rendering` — how the organic LEO globe is built (bands, atmosphere, ground grade, traps)
- `mem:patterns/sky-bodies-terrain` — ephemeris sun/moon, scene time, bloom, shadows, REAL terrain (Phase-4-era snapshot, frozen 2026-07-10 — the ground pipeline was REBUILT 2026-08-18b/c U3; current truth = ARCHITECTURE §7 + `conventions/globe-tuning.md`)
- `mem:patterns/design-system` — imported Claude Design tokens/type/motion/screen boards (chrome; globe stays fenced)
- `mem:decisions/adr-000-locked-stack` — the 15 locked ADRs · `mem:decisions/session_workflow` — persistence loop
- `mem:decisions/session-end-autoship` — the SessionEnd auto-ship hook contract
- `mem:memory_maintenance` — how to maintain this graph
