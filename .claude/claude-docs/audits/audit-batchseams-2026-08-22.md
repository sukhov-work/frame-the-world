# Audit — batch seams #4–#7 + QA slice + the 2026-08-22 micro-slice — 2026-08-22 — baseline DECISIONS 2026-08-19 → 2026-08-22b (prior report `audit-full-2026-08-18.md`)

Tier **Deep**, owner-scoped. Tracks A1 (radar/aim/MapWindow/chrome) · A2 (orchestrator/render/
platform-lite/debris) · C (tests + harness) · D (docs/memory/conventions) · E (mechanical,
carried from 2026-08-21h). Launched in **two waves** (A1+A2, then C+D) by owner order — the
2026-08-21h run fanned out all four at once and an API session limit killed every one before
any reported, voiding the pass.

**Session-purity note.** This session was NOT audit-only: the owner ordered a micro-slice FIRST
(`NEXT_SESSION_PROMPT` §0), then the audit. The `src/` diff belongs to that slice (2026-08-22a/b),
not to the audit — Track D verified this explicitly and returned PASS on the "a `src/` diff in an
audit session is itself a Track-D FAIL" rule, with the caveat that the audit ran concurrently
with a shipping session. Findings that were defects **in the slice being shipped** were fixed
before ship and are marked **FIXED 22b**; everything else is report-only.

## Verdict

The batch seams are structurally sound — the two invariants most at risk survived scrutiny
(the sticky overlay-px ratchet has exactly one writer and no bypass; the `skylineBins`
array-identity rebuild key is honest, with no null↔array flap path). The worst *shipped* finding
is **A1-2**: the ◉ RE-CENTRE button, the sole exit from a now-permanent manual-pan override, was
occludable on short `/m` viewports by a control that would nudge the eye's altitude instead —
found and fixed within the session. The **real story of this audit is verification integrity**:
Track C proved that four checks written this same session, plus one claim recorded in DECISIONS
2026-08-21h, could not fail — evidence that looked like proof and was not. All five are fixed.

Scope vs the permanently-out list (Zawinski guard): nothing here schedules Gaia-depth catalogs,
telescope GOTO, tides/rainbow, Skyfire, or the Phase-7 AI panel. One naming collision on that
list is flagged (D14) — the shipped camera-aim GOTO pill is a different thing from telescope
GOTO, and the bare token will burn a future refutation cycle.

## Gates baseline

| Gate | Value | Triage |
|---|---|---|
| `npm test` | **1,144 / 1,144** across 102 files, 2.99 s | green. Δ from the 2026-08-21h datum (1,128/101, 4.52 s) = **+16 tests**, exactly the 16 `it()` of this slice's new fence; **no single test ≥ 100 ms** (Track C re-ran and probed) |
| `npx astro check` | 369 files · **0 err / 0 warn / 5 hints** | green, dated baseline (not an accumulating pile) |
| `npm audit` | 30 total (5 low/3 mod/21 high/1 critical) | **ALL dev/build toolchain.** `--omit=dev` = **9 (3 low/6 high) — IDENTICAL to the audit-2 baseline.** pre-existing |
| Bundle (`wix build`) | dist 33 MB / client 31 MB | +1 MB over audit-2's 30 MB, **fully accounted**: PLUX `logo/` 560 K + `social-cover.jpg` 136 K (2026-08-19d rebrand) + `_astro` 7.4→7.7 MB over three shipped batches. Textures 22 MB / data 664 K / guide 260 K |
| knip / depcheck / ts-prune | 45 "unused files" · 2 dep FPs · 46 exports | **noise classes**, all identified: standalone `scripts/*.mjs` + dynamically-registered `public/sw.js`; `typescript`+`@astrojs/check` are the gates themselves; astro-island default exports. Config drafted → D15 |
| jscpd (`--min-tokens 100`) | 35 clones / 1.14 % | anchors re-quantified by hand — see A1-8 (the flagged hits were tips of larger blocks) |

Track E was executed 2026-08-21h and carried forward unchanged; Track C independently re-ran
`npm test` and `astro check` and confirmed both.

## Findings

Severity per `references/audit-mode.md`. Tier: local-tested / browser-VERIFIED / UNVERIFIED.
Every anchor below was re-read by the main agent in the verification pass; findings that did not
reproduce were deleted (none survived deletion this round — see §False-positive ratchet).

| ID | Track | Sev | Conf | Anchor | Finding | Specific fix | Violated ruling | Tier |
|---|---|---|---|---|---|---|---|---|
| **A1-1** | A1 | MAJOR | 92% | `MapWindow.tsx:752,808-815` | **FIXED 22b.** `panBy()` latched on EVERY pointer move, so the ~2 px drift of a 500 ms long-press — the primary `/m` chart gesture — armed the *permanent* override | latch moved into `onPointerMove` behind the existing `DRAG_CANCEL_PX 6` threshold | DECISIONS 2026-08-22a item 1; checklist 25 | browser-VERIFIED (3 px jitter leaves it unlit) |
| **A1-2** | A1 | MAJOR | 92% | `map-window.css` `body.m .mw-recenter` vs `fpv.css .m-altcol` | **FIXED 22b.** The sole exit from the permanent override slid **under** the z-24 FPV altitude column on short viewports (86 % covered at 360×560); the tap would nudge eye altitude. Raising its z cannot fix it — `.mw` is itself a z-20 stacking context | `.m-altcol` publishes `--m-altcol-bottom`/`--m-altcol-h`; the seat is a `min()` whose floor clears that box | owner 2026-08-22 item 2 ("always visible… advertises the way back") | browser-VERIFIED at 390×844 / 360×640 / 360×560 |
| **A1-3** | A1 | MAJOR | 90% | `index.astro` `body.mw-open .map-credit` | **FIXED 22b.** The desktop attribution truncated below ≈900 px — the `clamp()` FLOOR stops shrinking while the 265-char list keeps its width, and `nowrap`+`overflow:hidden` clipped **both** ends, losing "© Esri" itself | `@media (max-width: 60rem)` wraps and redefines `--mw-credit-h`, so the scrubber lift tracks it | the rule stated 3 lines above it in the same file; T17 | browser-VERIFIED unclipped at 1100/820/700 px |
| **C1** | C | MAJOR | 85% | `verify-qaslice-cab.mjs` Esri counter | **FIXED 22b.** The entire QA-slice-C leg could run with **zero** Esri traffic and still pass: the counter only fires in satellite ground mode, `/tmp/ftw-cdp` persists that pref across sessions, and the settle check printed the count without ever asserting it > 0. The reported "≈0 new GETs" and "residual ~600 GETs/leg" would have been fiction | assert `groundMode === "satellite"` as a precondition + `esriGets > 0` as the counter's positive control | audit-mode §4 zero-result validation; checklist 10(f) | browser-VERIFIED |
| **C2** | C | MAJOR | 95% | `verify-qaslice-cab.mjs` desktop leg | **FIXED 22b.** "the REAL scrubber is LIFTED clear of the bar" **could not fail**: `.ts` base `bottom: 2.2rem` = 35.2 px already exceeds the 13.6 px bar, so it held with the `mw-open` lift deleted entirely. It proved the bar existed and never proved the lift | measure the **delta** — read the gap with the map closed, reopen, assert `open − closed ≈ barH` | checklist 8 (Goodhart) | browser-VERIFIED (lift 13.6 px == bar 13.6 px) |
| **C3** | C | MAJOR | 90% | `verify-qaslice-cab.mjs` "following RESUMED" | **FIXED 22b.** ◉ had just centred the chart *on* the eye, so if the follow-up walk moved nothing the distance stayed ≈0 and the check passed while following was dead. The first walk had a trigger guard; this one had none | assert the eye left the deadband (`> 60 m`) first, and tighten the chart bound to the measured 18.5 m edge | scope 2 | browser-VERIFIED (118.9 m walked) |
| **C4** | C | MAJOR | 100% | `mapWindowChrome.test.ts` hide-group | **FIXED 22b.** `expect(selectors[0]).not.toMatch(/display:\s*none/)` was **structurally unfalsifiable** — the capturing regex terminated at `visibility: hidden`, so the string could never contain it. The stated invariant ("islands stay mounted and subscribed") was unenforced | capture the full rule `\{([^}]*)\}` and assert on the body | laws.md falsifiability; scope 7 | local-tested |
| **C5** | C | MAJOR | 95% | `verify-qaslice-cab.mjs` A1-2 loop | **FIXED 22b.** The loop captured `altPresent` and never asserted it; `.m-altcol` mounts only inside FPV, so any reordering would make all three viewport checks pass **vacuously** — on the one occlusion they exist to disprove | assert `altPresent === true` | scope 2 | browser-VERIFIED |
| **A1-4** | A1 | MAJOR | 95% | `MapWindow.tsx:281-306` | The chart tile loader has **no error path**: a 404/timeout is cached `{ok:false}` forever, never retried on a later pan, and nothing warns. Zero-result validated (positive control `workerClient.ts:72`) | `entry.img.onerror = () => { console.warn(...); cache.delete(url); }` | checklist 13 (degrade-path visibility) | local-tested → **T37** |
| **A1-6 / A2-1** | A1+A2 | MINOR | 90% | `MapWindow.tsx:215-218` vs `StylizedTiles.ts:3959-3962` | **Found independently by two tracks.** The chart's radar/cone anchor ladder diverges from the GL fan's: the placed-photo rung is missing, and the bare `camGeo` rung means that outside FPV it anchors on the camera **nadir** (km away at tilt) while the GL fan uses the view focus — making the `focusLatDeg` tail dead code. **Refutation attempted and FAILED**: the only `setMapWindowOpen(false)` in the orchestrator is the Escape handler, so exiting FPV by any other route leaves the map open and the divergence live | hoist ONE `aimAnchorFor(cam, upload, focus)` used by all three surfaces | `aimCones.ts` "ONE geometry model shared by three surfaces" | local-tested → **T36** |
| **A2-3** | A2 | MINOR | 85% | `StylizedTiles.ts:2146,3250,3260,4048` | `plannedView.hFovDeg` is **unclamped in 4 of its 7 writers**. Measured breaches: 1.27° (/m portrait, max zoom-in) and 122.4° (landscape, min zoom) reach `plannedView` via the FPV-exit seed, against `FOCALCONE.minHFovDeg 3 / maxHFovDeg 120` → out-of-band cone on all three surfaces + a ~1624 mm AIM readout | clamp once at `store/camera.setPlannedView` + a test at aspect 0.46 / 2.17 | units contract `plannedView.ts:2-8`; checklist 7 | local-tested → **T39** |
| **A2-2** | A2 | MINOR | 85% | `GlobeCanvas.tsx:505-515` | The `/m` PiP's second `renderer.render` **re-renders the shadow map every frame** — three only skips it when `shadowMap.autoUpdate === false`, and `mid` tier has shadows on. Two full 1024² depth passes per frame on the most heat-constrained surface | bracket the PiP render with `autoUpdate = false` / restore | per-frame perf regression class | local-tested (cost code-exact, ms unmeasured) → **T38** |
| **A1-16** | A1 | MINOR | 85% | `horizonProfile.ts:15-18` vs the three radar surfaces | `profileCoverage` is **never consulted by any radar surface** (verified: it reaches planFeed, the store and the two PLAN panels only; positive control `profileBins` matches in both panels). A 15 %-covered profile draws gaps with the same authority as a complete one. Gaps drawn are *true* (an unswept azimuth cannot fracture a band), so this is an under-claim, not a lie — but the honesty contract asks for a signal | gate the fracture on `PLAN.minCoverageForGaps`, or dash/tint the rim below it — one rule, three surfaces | `horizonProfile.ts:15-18` HONESTY CONTRACT | local-tested |
| **A1-5** | A1 | MINOR | 90% | `aimCones.ts:386-401` | The terrain seat resets to unseeded (`groundM = NaN`) on rebuilds that do **not** move the anchor — a day-cross, target swap or async profile arrival. If `terrainHeightAt` returns null at that instant the whole radar seats at ellipsoid 0 and pops underground | `if (moved) groundM = NaN;` — the other triggers rebuild geometry, not the seat | the comment at `:401` says "re-seat at the new anchor"; the gate is broader | local-tested |
| **C7** | C | MINOR | 95% | `plannedView.ts:17` ↔ `sensors.ts:140` | **FIXED 22b.** The FOV inverse pair is a **production round trip** but no test imported both halves — each was pinned only at aspect 1. **This REFUTES a PASS recorded in DECISIONS 2026-08-21h** ("the FOV inverse pair is transitively pinned"), which came from a killed agent's pre-verification output | round-trip test across 5 aspects × 5 focal values, both directions (+ C9's cross-pin) | checklist 1 | local-tested (math confirmed correct; it was the *pin* that was missing) |
| **C12** | C | MINOR | 85% | `map-window.css .mw-credit` | **FIXED 22b.** `/m` had **no wrap fallback** — the same clamp-floor class as A1-3, which was fixed on desktop only (that media block is page-scoped to `/`). The 76-char `/m` list survives to ≈305 px, so the 320 px margin was ~28 px | mirrored `@media (max-width: 22rem)` wrap branch + `--mw-credit-h` bump on `body.m` | T17 attribution obligation | local-tested |
| **C6** | C | MINOR | 85% | `verify-qaslice-cab.mjs` bleed sweep | **FIXED 22b.** The sweep skipped `position: absolute/sticky` and `z-index: auto` (→ `NaN`), and its zero-result had **no positive control** — it could have examined zero candidates and "passed" | widened to non-static + `auto`-as-mid-stack, scoped out `.mw`'s own subtree, and returns `scanned` (now 11) as the control | audit-mode §4 | browser-VERIFIED |
| **C13** | C | MINOR | 100% | `mapWindowChrome.test.ts` | **FIXED 22b.** A fence titled "the ◉ button is the ONLY path back" asserted something the *same session's* DECISIONS explicitly records as false (close+reopen also resets; on `/m` a PiP tap **is** close) | retitled "…within an open session"; the mechanism assertion was always right | checklist 5 tier honesty | local-tested |
| **C15** | C | MINOR | 90% | `mapWindowChrome.test.ts` | **FIXED 22b.** The "discovery guard" scanned a **hardcoded 4-file list** while claiming to cover every scene-mounted DOM layer — complete by coincidence, not construction | `readdirSync` the scene directory | checklist 3 | local-tested |
| **A2-5** | A2 | MINOR | 95% | `GlobeCanvas.tsx:348-355` vs `global.d.ts` | `__globeQuality` is **not in the DEV-seam registry** and is published through the exact `as unknown as` cast the registry exists to replace — while `__mapWindowView`/`__overlayRebuilds` from the same slice *were* registered. Its `flat2d` field mirrors a lean-only latch, so on desktop it is permanently `false` even on the flat 2D map | register the type, drop the cast, and either set the latch unconditionally or rename the field `leanFlat2d` | checklist 12 | local-tested |
| **A2-6** | A2 | MINOR | 95% | `tuning.ts:2058-2061` vs `aimCones.ts:474-475` | Stale tunable comment: `emphTauMs` documents "emphasis gates FILL **+ rim brightness**". Verified — `rimMat.uAlpha = AIMCONES.rimAlpha * overlayA`, no `emphEased` term. `aimCones.ts:31-32` already has the correct wording | correct the tuning comment to "FILL wash only" | checklist 7 | local-tested |
| **A1-9** | A1 | MINOR | 85% code / UNVERIFIED device | `SceneActions.tsx:480`, `MobileSearch.tsx:170` | The iOS focus trap the QA batch fixed is **still armed in two siblings**: React `autoFocus` on an input inside the same 400 ms `translateY(100%)` sheet, and a re-focus without `preventScroll` | extract `useSheetInputFocus()` from the documented fix and use it at both | DECISIONS 2026-08-21 iOS focus discipline | UNVERIFIED (device) → T1 |
| **A1-10** | A1 | MINOR | 88% | `focalCone.ts:45,101-127` | Disposes and reallocates **both** BufferGeometries every frame while the aim stick is held — `HFOV_EPS_DEG 0.1` sits below the stick's rate | allocate once at `SEGMENTS`, write into the existing attribute with `needsUpdate` | checklists 15 + 24 | local-tested → **T38** |
| **A1-11** | A1 | MINOR | 90% | `MiniMap.tsx:157-166`, `MapWindow.tsx:166` | Per-paint `getComputedStyle` churn on both canvas radars (~320 forced style reads/s at 20 Hz) for theme-static values | resolve once into a module-level ink cache, invalidated on theme change (the streetNames idiom the module doc already cites) | checklist 15 | local-tested → **T38** |
| **A1-7 / A1-8** | A1 | MINOR | 93% | see §Extraction seams | Duplication quantified well past Track E's jscpd tips: `bandFor` ×3 hand-maintained copies with **no** cross-file fence; GL `aimCones↔focalCone` ≈47 lines (incl. a byte-identical material factory); canvas `MapWindow↔MiniMap` ≈95 lines (the 29-line hit is its tip) | three named seams — `lib/geo/radarBands.ts`, `scene/tangentOverlay.ts`, `panels/radarCanvas.ts`; additive extract-then-delegate | checklist 16; Gall | local-tested → **T35** |
| **A2-4 / A1-12** | A2+A1 | NIT | 88% | `StylizedTiles.ts:2333-2340`, `Joystick.tsx:136-148`, `SceneActions.tsx:29` | Branches made dead by the batch-#6 boot seed (`setPlannedView(null)` is called nowhere — probe validated). Includes the one site computing aspect from `window.innerWidth` rather than `camera.aspect` | delete with a dated DECISIONS line, or state the invariant and keep as documented guards — do not leave undated | checklist 16 | local-tested |
| **C8** | C | NIT | 90% | `slippy.test.ts:101` vs `MapWindow.tsx:194` | `chartWalkAzRad` is tested against a **hand-transcribed copy** of the chart transform (correct today — verified term-by-term — but `xformNow` lives in a `useEffect` closure and is unimportable, so a sign flip in the app leaves the test green) | extract `rotFwd/rotInv` into `lib/geo/slippy.ts` and import them in the test | checklist 1 "self-referential" | local-tested |
| **C11** | C | NIT | 95% | `verify-qaslice-cab.mjs` | Verify scripts leak CDP targets; this session's desktop leg doubled it to two per run against env class (a)'s ~5-suite WebGL budget. Discipline held operationally (Chrome restarted between suites) | `Target.closeTarget` in a `finally` — the `verify-pin-reframe.mjs:228` precedent | checklist 10(a) | local-tested |
| **C14** | C | NIT | 90% | `mapWindowChrome.test.ts` | Fence maintenance traps: regexes keyed on comment prose, indentation, units (`96px`→`6rem` fails) and taste literals will go red on harmless reformats | relax value pins to `\S+`; prove the sibling relation structurally | scope 7 | local-tested |
| **C16 / C17 / C18** | C | NIT | 95-100% | `verify-uxbatch5.mjs:190`; shot rename; `test/styles/*` | A latent vacuous `\|\| "absent"` arm on the very rule the new fence pins · a superseded *artifact* rename unannotated · `read`/`esc`/`ruleBody` triplicated across style tests | drop the arm; annotate the rename; extract `test/styles/_css.ts` | scope 2; checklist 6 | local-tested |
| **A2-7 … A2-11** | A2 | NIT | 70-95% | see A2 report | `_temp*` naming on **persistent** FPV basis state (a scratch reuse would silently corrupt it) · a magic ×2 alpha in MiniMap · the FOV pair split across two libs · `sw.js` silent on the ion ToS posture · `onResize` never re-evaluates DPR | as listed | naming; checklist 7/15; platform 10 | local-tested |
| **D1 … D16** | D | MINOR/NIT | 85-99% | see §Docs | 16 documentation findings, each with a doc-line → `src:line` pair. **D2/D1/D4/D6/D12 FIXED 22b**; the rest → **T40** | exact edits pre-written in the Track-D output | checklist docs 2/3/4/6/7/11/12 | local-tested |

### Docs findings (Track D) — status

| ID | Finding | Status |
|---|---|---|
| **D2** | **`guideContent.ts` teaches gestures the code does not perform.** Worst: `:905` "Long-press the full MAP — VIEW FROM HERE" while `/m` long-press **places a point and stays** — and `MapWindow.tsx:974` *deliberately delegates* the `/m` affordance to the guide ("/m's single long-press action lives in the guide") and hides the on-screen hint. Also: radar future halves described as "blue" when sun/moon wear body inks; the focal cone and the AIM joystick have **zero** topics (`grep -c "focal cone"` = 0, `twist` = 0; positive control `joystick` = 5) | **3 wrong claims FIXED 22b** (fpv-map, mobile-gestures, target-radar) + the stale upstream `MapWindow.tsx` header docblock that seeded the error. **4 new topics + 6 additions → T40/§3** |
| **D1** | ARCHITECTURE §7 five sessions stale with **3 factually wrong** claims: "8 routes" (9 on disk), 12 stores (14), and "all shared logic lives in `lib/**`+`store/**`" (false since 2026-08-21b) | **FIXED 22b** — re-dated, counts corrected, `components/controls/` tier documented, `public/sw.js` re-homed, bands/sticky-overlay/three-surface rules added |
| **D4** | README gate counts 4 sessions stale (`1,004 across 89 files`, 2026-08-18) | **FIXED 22b** → 1,144 / 102 / 2026-08-22, hints spelled out |
| **D6** | `components/controls/` is enforced only by a test no convention advertises; the design fence allow-list never learned about it | **FIXED 22b** — `CLAUDE.md` + `architecture-and-patterns.md` now name the three fence rules and the three shared tiers |
| **D12** | Debt registry not updated across 4 shipping sessions (newest `Since` = 2026-08-18) | **FIXED 22b** — T34–T40 added |
| **D5** | `globe-tuning.md` documents **none** of the batch-#4→#7 tunables (20 identifiers, 0 hits; positive control: it does name `EARTH.nightFloor` etc.) and lacks the sticky-overlay-px ONE-writer rule and the injected-GLSL header rule — the latter being search-order step 3, *ahead* of the checklist that has it | → **T40** |
| **D9** | `conventions/verify.md` names **zero** of the six harness environment classes `checklists/tests.md` item 10 requires it to, and omits the synthetic two-finger-twist recipe used by **9** scripts | → **T40** |
| **D8** | `UXBATCH4_PLAN.md` fully shipped and self-contradictory → `archive/`. **Ordering constraint: D1+D7 must land first** — it uniquely carries the live `public/sw.js` description (D1 half done) | → **T40** |
| **D16** | **DECISIONS compaction round 4 is DUE.** §Recent = 135 KB vs the 147 KB that triggered r3, and the "ladder parked mid-run" carve-out **expired** at U8. Exact boundary measured: move `:319`→`:879` (34 rows, ≈79.5 KB) under a `§Moved 2026-08-22` divider; keep the HOT owner-batch era verbatim | → **T40** |
| **D7 / D3 / D10 / D13 / D14 / D15 / D11** | `contracts.md` §2/§3/§7 drift (15→20 DEV seams, 5→6 localStorage keys, 8→9 routes) · 5 live structures in no doc · 11 of 12 guide shots stale · append-marker re-drift · the bare "GOTO" out-list token now collides with a shipped feature · `knip.json` content drafted · memory graph lag | → **T40** (D11 resolved at wrap) |

## Verified clean

Named explicitly with their probes — these matter as much as the findings.

1. **The sticky overlay-px invariant holds end to end.** `stepGroundUpdate` is the **only** caller of `setOverlayResolution` (single call site), `resolution` has one writer, the constructor arg is the tier px so frame 1 is a genuine no-op, and `tierOverlayPx` has one writer / one reader. `applyQualityTier` is additionally FPV-deferred, an independent second guarantee that no rebuild lands mid-FPV. `stickyOverlayPx` is `Math.max` — monotone by construction.
2. **The `skylineBins` array-identity rebuild key is honest — no storm.** `planFeed` allocates `binsMirror` exactly once per build; the orchestrator feeds that stable array or `null`. Specifically probed for a `skylineGuardM`-boundary flap: the qualifying plan-anchor kinds are the same discrete point the aim anchor resolves to, so the guard distance is ≈0 (bounded by ~25 m plan chunking), never oscillating at the 60 m boundary.
3. **Injected-GLSL uniform sweep (checklist 23) — CLEAN, re-run mechanically rather than trusted.** Every `uFtw*`/injected uniform enumerated by grep, then each mutation site found via `shader.uniforms.` + `.fragmentShader`. `imageryGround`: **16 JS uniforms vs 16 header declarations, 0 JS-only, 0 header-only** (diffed by script). `buildingMaterial` fillMat: 12 JS vs 11 fragment declarations — the difference, `uFtwTileSeed`, is declared in the **vertex** header and used only there, so correct, not a miss. edgeMat 2/2; `enrichedBuildings` treeMat 1/1; the GTAO patch injects via the `uniform float intensity;` replace.
4. **C6 privacy on every new debug surface.** `__mapWindowView` and `__overlayRebuilds` are `import.meta.env.DEV`-gated; `mapWindowRotRad` carries a rotation only, no geo; every `window.__*` in `src/` sits inside a DEV gate.
5. **Shadow-map correctness under the PiP scissor is safe** — `setRenderTarget` copies the *target's* scissor state (default off), so the shadow pass is not clipped, and unbinding restores. Only the redundant re-render (A2-2) survives.
6. **Bottom-strip inventory complete on BOTH shells** — an awk scan of every `position:fixed` block with a `bottom:` declaration across `src/styles/**` + `src/pages/*.astro`. Every `--mw-credit-h` consumer carries the `0.85rem` fallback, so a late-loading sheet cannot collapse a lift. (This sweep is what surfaced A1-15.)
7. **MapWindow subscription set complete and leak-free** — all five stores subscribed and unsubscribed alongside canvas + window listeners; the only un-cancelled resource is a pending rAF, inert because `draw()` early-returns on a detached canvas *before* the rot publish, so a closed window cannot resurrect a stale twist.
8. **tap-promote ↔ `draw()` `rBase` mirror is exact**, and the transform round trip was re-derived analytically: `pt(az,r) → X.inv → atan2` returns exactly `az` for all `rot`.
9. **GL-vs-canvas fracture equivalence** — walked the straddling-cut, blocked-at-now and 2-sample-run cases; `splitAimRuns` places the interpolated sample in **both** halves, so any sub-run surviving one representation survives the other.
10. **`skylineGuardM` honesty** — a null sampler returns runs untouched on all three surfaces: no gap is ever claimed without a profile.
11. **Supersession discipline (Track C P1)** — `git diff -U0 scripts/ | grep '^-'` yields exactly three removed check lines, all replaced by annotated inversions in the same block. Prior supersessions still annotated.
12. **New-tunable coverage 12/12 + 5/5 CSS tokens** — every symbol the owner listed has a named test anchor.
13. **Golden gates intact** — `lazyContract` still walks `src` recursively with its 10-module HEAVY list; `skyBudget` still asserts off the live tuning import. No assertion deltas in the working diff.
14. **A refuted candidate, recorded** (Track C P4): the narrow-viewport `body.mw-open { --mw-credit-h: 1.8rem }` sits in an Astro *scoped* `<style>`. If Astro appended `data-astro-cid` to `body`, A1-3's fix would silently not apply. Probed by running `@astrojs/compiler` `transform()` on a minimal reproduction: the `body.mw-open` rule emits **unscoped**. Not a finding.
15. **Audit purity** — Track D verified no `src/` diff is attributable to the audit itself.

## Pre-existing / out-of-scope

| Item | Class | Row |
|---|---|---|
| Ground-LRU rest-trim churn, ~600 Esri GETs per 2D↔FPV leg, cache resting at exactly `minBytesSize` | pre-existing, #15-adjacent — **explicitly surfaced to the owner** as ordered. Levers: mode-aware LRU floors · flip-freeze of the rest-trim. iOS network cost is the concern | **NEW T34** |
| z-2 DOM label layers bleeding through the `/m` PiP hole | pre-existing (the hole overlapped the upper screen at its old rung too); surfaced by the new intersection sweep, fixed 22b | — |
| `npm audit` 9 production advisories | pre-existing, identical to the audit-2 baseline | — |
| astro@5.18.2 XSS advisories | ACCEPTED RISK, dated, extended formula | T24 |
| 45 knip "unused files" | infra noise; config drafted | **NEW T36→T40** |

## Backlog status changes

- **T23** (author `contracts.md`, CLOSED, "later audits diff it") — **the diff was performed**: §2/§3/§7 all drifted (D7). Row stays CLOSED; D7 is the diff result, not a re-discovery.
- **T28** (U-era + guide taste tails) — **scope understated.** T28 frames the guide remainder as *owner taste*; D2 shows three claims were factually **wrong** and two features wholly undocumented. Recommend a dated split: taste half stays, correctness half becomes engineering work.
- **T29** (tile-tier extraction, trigger FIRED) — unchanged. A1-7/A1-8 (T35) and C8 are **different** seams; do not merge the rows.
- **T31** (trap→test tail) — OPEN, unchanged. **Two new testable traps unencoded**: the PiP-hole "anything fixed 1 ≤ z < 20 paints inside the clearRect" class (now fenced by a browser sweep + a directory-scanning discovery guard, but no unit test), and "close+reopen clears the latch".
- **T17** — bears on C12's `/m` attribution legibility; A2-10 asks to extend its host list with Cesium ion, whose content the SW now caches.
- **T1** — grew again (◉ seat vs the alt column on short viewports · the attribution line's real-device legibility · permanent-override feel · SAVE VIEW autofocus scroll). Dated growth edit applied.
- **T22** (README demo URL withheld) — still correct and deliberate; untouched by the D4 edit.
- **NEW: T34–T40.**
- **DECISIONS 2026-08-21h carries a now-REFUTED claim** ("the FOV inverse pair is transitively pinned") sourced from a killed agent's pre-verification output. Superseded here and pinned for real (C7).

## Fitness scorecard

| Promise | Best available proxy | Value |
|---|---|---|
| Geo-accuracy | projection/geodesy/ephemeris vectors + the newly-pinned FOV inverse pair | 1,144 green; FOV round trip now exact to 9 dp across 5 aspects |
| Beauty | dated shots | `qsl-01..08` this session, both shells |
| Perf | tier/DPR/composite invariants | sticky ratchet holds, **0** rebuilds across two 2D↔FPV cycles; three per-frame waste sites identified (T38), ms **unmeasured** |
| Privacy (C6) | DEV-gate sweep over every `window.__*` | clean |
| Docs currency | stale-claim count | **3 factually wrong** ARCHITECTURE claims + **3 wrong** guide claims found; all fixed. Remaining stale surface tracked as T40 |
| Verification integrity | checks that cannot fail | **5 found, 5 fixed** — the headline result of this audit |

## Proposed convention / checklist amendments (the Pesticide-Paradox harvest)

1. **`checklists/tests.md` — new item: "can this check fail?"** For every assertion added, name the mutation that would make it red. C2/C4/C5 were all shaped as "assert a value that is already true for an unrelated reason". Sub-rule: a check on a *lift/offset* must measure the **delta**, never the absolute.
2. **`checklists/tests.md` — new item: a counter needs a positive control.** Any check reading an event counter must assert the counter counted (C1) and pin the precondition that makes it fire.
3. **`checklists/code.md` — new item: enumerate what already owns a screen edge, on BOTH shells, before adding a surface there.** The shells are not symmetric (`/m` has no page chrome). This cost two collisions in one session (the desktop attribution overlap; the PiP-over-status bleed).
4. **`checklists/code.md` — new item: a z-index cannot lift a child out of its parent's stacking context.** A1-2's fix had to be geometric; reaching for `z-index` first is the trap.
5. **`checklists/code.md` — new item: when a shared offset token is introduced, sweep EVERY surface anchored to that edge** — A1-15 (`.tr`) was missed because only the surfaces named in the spec were lifted.
6. **`checklists/docs.md` — new item: if code DELEGATES an affordance to the guide, the guide topic is load-bearing** and must be verified in the same pass (D2: the code hid the `/m` hint *because* the guide covered it, and the guide was wrong).

## Fix-session slicing

| Slice | Size | Contents | Deps | Gate |
|---|---|---|---|---|
| **F1 — one-liners** | S | A1-4 tile `onerror` · A1-5 seat-reset gate · A2-6 comment · A2-5 registry + cast · T32 planner ceiling | none | `npm test` + `astro check` |
| **F2 — range + registry contracts** | S | A2-3 `plannedView` clamp at the store seam + aspect tests · A2-4/A1-12 dead-branch decision (dated) | F1 | tests |
| **F3 — per-frame waste** | M | A1-10 focalCone realloc · A1-11 style-read cache · A2-2 PiP shadow bracket | none | browser shots + T1 device numbers |
| **F4 — the anchor ladder** | M | A1-6/A2-1 hoist ONE `aimAnchorFor()` across the three surfaces; closes half of the MapWindow↔MiniMap clone | F2 | tests + browser (3 surfaces) |
| **F5 — extraction seams** | M/L | T35's three named seams + C8's `rotFwd/rotInv` (makes `chartWalkAzRad` a true round trip) | F4 | tests + browser regression suites |
| **F6 — harness hardening** | S | C11 target close · C14 fence brittleness · C16/C17/C18 · A1-16 coverage signal | none | suites re-run |
| **F7 — docs reorg remainder** | M | D5 · D9 · D8 (after D1/D7) · D7 · D3 · D13 · D14 · D15 | D1 ✓ | none |
| **F8 — DECISIONS compaction r4** | S | D16, boundary measured `:319`→`:879`, checksummed byte-identical move + era digests + `mem:core` re-date | F7 | checksum |
| **F9 — guide work** | L | D2's remaining table: 4 new topics + 6 extensions + D10 re-shoots on a warm cache | F7 | guide slop-lint, crosslink + image tests, `warm-prod-assets.mjs` |
| **F10 — iOS focus** | S | A1-9 shared `useSheetInputFocus()` | none | T1 device pass |

**Frozen-chrome flag:** F4 and F5 touch all three radar surfaces — desktop is additive-only by standing ruling, so each needs the full seven-suite regression run, Chrome restarted between suites.

## False-positive ratchet

Candidate findings raised: 46 across four tracks. Deleted in verification: **0** — but two were *demoted* by their own tracks before reporting (A2's desktop zero-area PiP render, refuted by the JSX gate; C's Astro-scoping concern, refuted by running the compiler). One recovered claim from the previous session's killed run was **refuted** (C7). Rate is well under the 20 % ratchet threshold, so no checklist item is loosened; six are *added* above.
