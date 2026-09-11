# Audit — full breadth (AUDIT #4, the adversarial pass by a different model) — 2026-09-11 — baseline DECISIONS 2026-09-10f (master `1ab6ff4`, app 1.36.8)

Per `AUDIT4_CHARTER_2026-09-10.md`. Read-only on `src/`/`scripts/`/`public/`/docs (verified: the session's
diff touches only this report, the README row, the checklists' dated amendments, the backlog registry's
dated state edits, and the Phase-4 records). Machinery: 15 parallel finder tracks (A code · B platform ·
C tests · D docs · F UX-static · G business · H1–H5 the 2026-09-05b→09-10f replay · I1/I2 the
3d-tiles-renderer@0.4.28 patch surface · J emergent interactions · K backlog status) → consolidation →
adversarial verification panels (3 lenses BLOCKER / 2 MAJOR / 1 MINOR / batched NIT) → main-agent re-read
of every BLOCKER/MAJOR anchor before writing. Two API usage walls hit the verifier fleet mid-run (both
resumed; the outcome column below states exactly what verified how). The main agent ran the browser tier
itself (one house Chrome, one dev server, VPN on — ion 401).

## Verdict

The engineering core is in the best shape of any audit yet — every gate green, the whole mobile + mesh
regression surface PASS, draw-counts exact on 10/14 poses with the 4 deltas inside the documented
ground-tile settle band, and all four interlude fixes (T131–T134) verified holding live. **The headline
is not code: it is the un-processed LIVE-SITE GRADUATION** — four owner-accepted POC risks (no moderation
gate on publication, tile-imagery ToS, unbounded uploads, an unvalidated `previewUrl` on every public pin)
rode into commercial live at www.plux.today on 2026-09-10 without a single re-ratification
(G1/G2/G3/B5, T138). Second: the library coupling is one careless `npm install` from silent breakage —
a caret range on the dep whose nine patch seams were verified against exactly 0.4.28, with drift degrades
that emit no console line (A1/A2, T136). Fitness for the next rung: good, after the S1/S2 fences and the
T138 owner batch.
Scope (Zawinski): nothing scheduled or drafted violates the permanently-out list — Phase 7 AI stays
parked (zero AI code in `src/`, probed), no Gaia/GOTO/tides/Skyfire/mobile-commerce drift found.

## Gates baseline (Track E, run 2026-09-11 by the main agent)

| Gate | Result | Triage |
|---|---|---|
| `npm test` | **3,098/3,098, 205 files, 27.6 s** | clean; the two known timing-flaky tests (bestSpotSolver, planFeed) passed this run |
| `npx astro check` | **0 err / 0 warn / 12 hints** | the 12 hints ARE the dated baseline (ultraEmisK unused ×2 scene files) — no 13th |
| `npx knip` | **0 findings** (empty output) | clean |
| `npm audit` | **could not run** | INFRA — both the Wix mirror and registry.npmjs.org unreachable from this network (VPN); the astro@5.18.2 advisory posture stays carried by T24's dated, machine-checked formula |
| `wix build` | **succeeds; `dist/client` 32 MB** vs the 33 MB baseline (2026-08-13) | PASS — textures 22 MB, `_astro` 8.4 MB (JS 7.06 MB total; largest: libheif 1.4 MB, index 804 KB, draco 704 KB, StylizedTiles 668 KB, three 576 KB) |
| unused `public/` assets | `logo/PLUX_MASTER_LOGO.png` + `logo/PLUX_FAVICON.png` referenced nowhere (src/scripts/README/layouts; og:image uses `ogImage`) | NIT L5 — zero-result validated (all other assets matched by basename or constructed path) |
| dead DEV seams | ~31 distinct `window.__*` seams; the load-bearing ones read by 56 harness files | clean (contracts.md §3 diff is D7, a docs finding) |
| ship pipeline | 0 open PRs, 0 local ship branches, no SHIP_ATTENTION.md | clean; 12 STALE REMOTE-TRACKING refs on origin/private (prune hygiene, NIT L6) |
| **audit purity** | `git status`: only checklists + memory + this report | PASS |

Browser tier (main agent, house :9333 + `wix dev`): sweep `audit4-2026-09-11` 14/14 poses
(`verify-shots/sweep/audit4-2026-09-11/`), freeze self-check **14/14 byte-identical** on the compare
re-run (first run: 11/14; cityscape 1,157 px Δ1 / west-sunset 47 px Δ114 / legacy-city 1,450 px — the
T103-documented intermittent class, all three byte-identical on re-run); **draw-count vs
`post-2026-09-10b`: 10/14 EXACT** (calls+tris to the triangle; the 4 diffs — cityscape +106 calls/+0.2 %
tris, zoom-sweep +2/+22, everest-fpv-sunset +32/+5.4 %, legacy-city −154/−0.35 % — are all in the
ground-tile settle band the standing order names as cache state, shifted legitimately by the T134 desktop
caps); pixel diffs vs the pre-interlude golden localize to the interlude's own grade changes (orbit-52,
a no-fog pose: 0.137 %; night/sunset poses 5–43 %) — a TREND read per T94/T95, not a byte gate.
Harnesses: `verify-debughud` ALL PASS · `verify-mobile-batch-2026-09-08` **127/127** · `verify-meshedit`
PASS (incl. live collections) · `verify-usermodels` **21 legs PASS** · `verify-guide` **3 FAIL — stale
pinned counts** (L1 below). Live site: www 200 · apex 301→www · `/_wix/pages.json` {/, /m, /guide} ·
`/api/ping` GET 200 + shaped POST 200 · `/m` `/guide` 200.

## Findings

Severity per `audit-mode.md`. **Verification column**: `V2/V3` = survived its workflow adversarial panel
(votes recorded); `MAIN` = re-read at the anchor by the main agent this session (quotes in the session
transcript); `FV` = the final trimmed verification pass (see the outcome note); `finder` = finder-anchored
(quote + zero-result-validated probe) with the panel pending — the panel that completed before the usage
walls refuted NOTHING (0 refuted in every completed verdict), so no finder-anchored row below was
downgraded; the false-positive ratchet therefore adds no tightening this run.

### MAJOR (6 — all survived both workflow panels AND the main-agent anchor re-read)

| ID | Track | Conf | Anchor | Finding | Specific fix | Violated ruling | Ver |
|---|---|---|---|---|---|---|---|
| A1 | A/I1 | 0.8 | `package.json:35` (`"3d-tiles-renderer": "^0.4.28"`) | A CARET range on the dep whose **nine** source-verified patch seams (charter said five — A's census: grade chain, aniso stamp, `_onTileVisibilityChange` re-wire, terrainPatch createChild wrap, esriPlaceholder fetch, overlayFetchPriority q.add+plugin-init, virtualSplitGuard expandVirtualChildren, compositeCanvasRelease `_init`, detachedRelease drain) were verified against exactly 0.4.28. The lockfile resolves today, but any lockfile-regenerating install (npm update, fresh machine, a deps PR, the ship hook's plain installs) can bump inside ^0.4.x silently. `libraw-wasm` is exact-pinned for precisely this class of reason. | Pin `"3d-tiles-renderer": "0.4.28"` + a version-pin test asserting `dependencies["3d-tiles-renderer"] === "0.4.28"` (T136) | D3/ADR locked stack; code.md item 22 | V2+MAIN |
| A2 | A/I1 | 0.75 | `lib/globe/overlayFetchPriority.ts:120-138` · `virtualSplitGuard.ts:121` · `esriPlaceholder.ts` (grep `console\.` = 0 in all three; positive control validated) | Every library-drift degrade is SILENT in production, below the charter's own bar ("degrades to the library's own path WITH a console line"): all `installed:false` paths return with zero console output; the DBG HUD surfaces only 2 of the flags, opt-in, off in prod. | One boot smoke reading every `installed` flag + `console.warn` naming what degraded (the `esriPlaceholder`/`overlayFetchPriority` pattern the charter names, actually built) — rides T136 | audit-mode Murphy item 13; the charter's Track-I brief | V2+MAIN |
| C1 | C | 0.55 | `test/components/globe/skyBudget.test.ts:8-50` vs `scene/atmosphere.ts:275-296`; `tuning.ts:1768` (`domeDirK 0.9`), `:957-965` | The horizon-bloom golden gate's twin models ONLY the rotationally-symmetric dome (zenith+haze). Since T96 (owner ruling 2026-09-06i, in the replay window) the directional LOOK ships ON the base rig — the live horizon adds `mix(sky, dirSky, uFtwDirK→domeDirK 0.9)` + the RC24 `uFtwUltraHaze` tint, none of it in the twin. Recomputed shipped worst case **0.8964 vs `BLOOM.threshold` 0.9** — a 0.4 % margin the gate cannot see. | Extend `horizonSky()` with the directional + haze terms; re-pin the margin; add a test that fails if `domeDirK` rises past the recomputed bound (T137) | tests.md item 2 (a golden gate weakened/staled = MAJOR) | V2+MAIN |
| G1 | G | 0.85 | `src/pages/api/photos.ts:117-126` · `src/store/save.ts:82` (`isPublic: true` default) · ARCHITECTURE.md:138 | C6's BINDING "moderation pass gates publication" is unimplemented on a LIVE product: any signed-in member publishes instantly to the world-readable PublicPins; the save store even DEFAULTS `isPublic: true`; the gate's planned home (`/api/moderate`, "PLANNED — Phase 7") is parked indefinitely (owner 2026-08-11). Accepted as a POC risk on 2026-07-10 while prod was dark; the site went commercial-live 2026-09-10 with no re-ratification. | Owner ruling first (T138): accept-as-is dated · a publish-review queue (a `moderationState` field + an owner approve surface) · or default `isPublic: false` + explicit opt-in copy | PROJECT_SEED §3 C6; audit-mode BLOCKER-adjacent (kept MAJOR: the seed text is binding but the acceptance was owner-ratified, only its TRIGGER — commercial live — has since fired unprocessed) | V2+MAIN |
| G2 | G | 0.8 | `tracked-backlog.md` T17 · `tuning.ts:2200` · DECISIONS 2026-09-10d | T17's own trigger FIRED and was never recorded: "Esri + CARTO + OpenFreeMap ToS = accepted POC risks; **re-check before commercial release**" — the site went commercial-live 2026-09-10 (paid plans + real-money checkout). The dated re-check the row demands has not happened; `ARCHITECTURE §9`'s TODO-VERIFY rides the same trigger. | One owner session: re-read the three ToS against the now-commercial use (attribution present — the credit line names the sources), record accept/mitigate/park per source, dated, on T17's row (T138) | laws.md Lehman encoding; the row's own text | V2+MAIN |
| G3 | G | 0.7 | `src/lib/wix/pinRecords.ts:89,126,167` · `panels/PinHoverCard.tsx:24` · `scene/PhotoFrustum.ts:176` | The one untrusted string on every public pin is validated by LENGTH alone: `previewUrl: str(r.previewUrl, 2_000)` accepts any content, `publicPinRecord` copies it verbatim into the world-readable row, every visitor's hover card renders it as `<img src>` and every visitor's globe FETCHES it as a texture — a hostile member points every visitor's browser at an arbitrary URL (tracking pixel, origin probe; `javascript:` is inert in img-src). | Scheme+host allowlist at BOTH the write (`parseSavePinBody`: `https:` + the Wix media host) and the render/fetch edge — or store only the media file id and derive the URL server-side (T139) | Postel strict-emit (platform.md 12); Murphy | V2+MAIN (verifier 2 suggests the escalation lever overlaps T26's accepted risk — core stands) |

### MINOR (32 in the table below + L1/L2 live-tier — final-pass outcomes per the verification column)

| ID | Track | Anchor | Finding | Specific fix | Ver |
|---|---|---|---|---|---|
| A1 | A | `test/lib/globe/overlayFetchPriority.test.ts:26-63` | The T134 queue-ORDER patch ships pure-function band tests but NO runtime probe asserting which tile class lands first (code.md item 31, appended for this audit, names exactly this gap; grep over `scripts/` = 0, probe validated) | One sweep leg reading `terrain.stream.tagged`/`slotBoosts` per class on a cold cache | FV |
| B1 | B | `.claude/hooks/session-end-ship.sh:306` | The auto-ship's push-failure path is log-only — no `attention()` write, so `SHIP_ATTENTION.md` is NOT written and committed work strands on a local branch with the checkout left on it (the NSP boot check then depends on the log being read) | Mirror the `ABORT: push failed` branch into the attention-file writer the hook already has (T143) | FV |
| B2 | B | `src/pages/api/photos.ts:96-117` | Quota is count-then-insert with no guard: N parallel POSTs all count `used=99` and all insert (Wix Data has no unique constraint/transaction) — the checklist's "unbypassable wall" holds for the sequential case only | Compensating re-count-and-trim after insert, or accept-and-date the race (owner call, T143) | MAIN |
| B3 | B | `scripts/release.sh:82` | The POST canary is single-shot after the GET loop, while the script's own step-7 fail text says the edge is sharded ("reload until clean") — a transient POST non-200 aborts the ritual AFTER `wix release` shipped, printing FAILED without the sharded-edge retry it itself prescribes | Loop the shaped POST with the same retry the GET loop has (T143) | FV |
| B4 | B | `src/lib/globe/regions.ts:14-16` vs `test/lib/globe/regions.test.ts` | The bbox coupling contract ("MUST equal the city's bake bbox … violations = bugs") has NO machine fence — the test asserts internal consistency but never reads `scripts/bake/cities/*.json`, so city-edit drift fails silently | One test importing the city JSONs and diffing against `regions.ts` (T143); ALSO: checklist platform.md item 8's anchor is stale — the registry moved to `regions.ts` (owner 2026-08-18) | FV |
| B5 | B | `src/pages/api/upload-url.ts:62-67` | T26's re-open trigger FIRED 2026-09-10 (commercial live) AND a new axis: the preview mint calls `generateFileUploadUrl(mimeType, {private:false})` with the client's ARBITRARY mimeType — the repo's first server-side mime allowlist (modelRecords, MS4) covers kind:"model" only | Extend the allowlist to the preview/original kinds or pin the accepted set; fold into the T138 owner batch | FV |
| C2 | C | `scene/imageryGround.ts:546,775-777` · `tuning.ts:3055` | T133's comments are stale ON ARRIVAL (same commit `fc6b568`): ":777 says base = 0.4 × **0.2**" where the shipped floor multiplier is **0.15**; ":546 says × illuminated fraction" where it is K&S phase intensity (quarter 9 % vs 50 %) | Three comment fixes (T142) | FV |
| C3 | C | DECISIONS §Traps TDZ bullet · `StylizedTiles.ts` (~:979, :1085) | The TDZ trap (twice-bitten, placeholder-globe-silent) has NO machine fence — and A's constraint sharpens it: the REAL seam is `applyQualityTier`+`sampleEphemeris` at :979/:1085, while the "declared HERE, above the ephemeris seam" comments sit ~2.4k lines BELOW it (safe only because that state is frame-loop-read) — a refactor reading the comments reintroduces the trap | An import-order smoke (build-time or vitest) that constructs the module with a mocked ephemeris, OR move the comments to the seam | FV |
| D1 | D | `.serena/memories/core.md` (46,772 B measured) vs `memory_maintenance.md:22` | The graph root regrew to **3.9× its 12 KB cap in five days** (the 2026-09-06g session compacted it 93,859→12,259 B); Status blocks for 09-06o→09-10f duplicate the wip leaves again — T87's own subject, regressed | The T141 hygiene session (same shape as 2026-09-06g) | MAIN (measured) |
| D2 | D | `.claude/conventions/globe-tuning.md` vs `tuning.ts` | The tunables-contract doc documents NONE of the ~19 families shipped 2026-09-07j→09-10f (the T40 pattern a third time: nightFloorSkyMin/moonFill*/moonSheenK/ambientNightK/moonGroundOpacity, farFog*, overlayFetchPriority, fullCacheKick, groundDesktopCaps, virtualSplitGuard/*, revealMaxHoldMs, desktopGroundLruBytesMB…) | T141 | FV |
| D3 | D | `src/lib/guide/guideContent.ts:1652,1714` vs `tuning.ts:2164` | The /m guide teaches a gesture T129 RETIRED: "A two-finger drag TURNS the chart" — since 2026-09-09 it PANS (twist is the only rotation). A user following the guide concludes the app is broken (the delegated-affordance class, docs.md item 13) | T140 (both topics) | MAIN |
| D4 | D | `NEXT_SESSION_PROMPT.md:62` | The NSP self-contradicts: "T2/T50 now have a live host" AND keeps T50 in the PARKED list in the same line; says "T1–T130" where the registry runs T1–T135 | Fix in the T141 session (NSP is gitignored; the registry is durable) | FV |
| D5 | D | `IMPLEMENTATION_PLAN.md:315` | The plan's T77 row is frozen at 2026-09-06 ("T80 blocked on an owner ruling; slices A–E not started") — T80 CLOSED 09-06n, slices A/B shipped, levers 8/11 built; a Phase-0 read of the plan mis-dates the whole lane by a week | T141 | FV |
| D6 | D | `README.md:180,209` | README still says "1,902 vitest tests … (2026-08-24)" vs **3,098/205** at HEAD (and the hygiene session's named leftovers never became T-rows) | T141 | FV (count confirmed by this run) |
| D7 | D | `.claude/conventions/contracts.md` (mtime 2026-09-06) | The Hyrum inventory was not re-diffed after 2026-09-06: the UserModels schema change (scaleX/scaleZ, 2026-09-08c) and the edit-journal DEV seams (09-09) are absent | T141 | FV |
| D8 | D | `mem:core` Status 09-10e vs `DECISIONS.md:556` | Conflicting volatile counts for the SAME session: 3,093/205 (mem:core) vs 3,094/206 (DECISIONS). One is wrong; arbitrating needs git archaeology on the 09-10e tree (out of scope here) | T141 | finder (arbitration pending) |
| F1 | F | `guideContent.ts:1321,230-231` vs `mobile/TabBar.tsx:29-30` | The guide says "BEST SPOT is desktop only" and lists it among what "the phone leaves out" — false since the /m ◎ SPOT tab (2026-09-07h); my own live /m census shows the tab | T140 | MAIN+live |
| F2 | F | `BuildingEditChip.tsx:294-299` · `mobile/ModelEditChip.tsx:186-191` · `mobile/FpvControls.tsx:311-315` | Two shipped features have ZERO guide coverage: T126's UNDO/DROP-SESSION pills (both shells) and the AR chip (whose iOS permission prompt arrives unexplained — the farm verified the prompt exists) | T140 (two topics) | FV |
| F3 | F | `mobile/Sheet.tsx:48-75` vs `panels/Guide.tsx:232-237` | Every /m sheet is `role='dialog'` with no aria-modal decision, no focus move on open, no restore on close, no Escape — the desktop Guide got focus-in/restore; the shell has 6+ sheets | Extract `useSheetInputFocus` to the sheets (T144) | MAIN |
| G4 | G | `api/photos.ts:68-77,205` · `MyPins.tsx:69` | T30 STATUS, now UI-biting: MY PINS caps at 50 rows while the free quota is 100 — GET hard-limits 50, `quota.used = photos.length` (≤50), no paging; pins 51+ exist, count against quota, are invisible/unmanageable | Reuse POST's `knownLimit` + a paging fetch (owner-called display fix, T30) | MAIN |
| H1-1 | H1 | `imageryGround.ts:1081` · `tuning.ts:3009` · `terrainBvh.test.ts` (sole file) | The T77 lever-8 kill switch (`GROUND.terrainBvh`) is tested in its ON state only — no OFF-state test, no source fence | Add the off-state twin (the `fences.test.ts` pattern) | FV |
| H2-1 | H2 | `enrichedBuildings.ts:1187-1203` · `StylizedTiles.ts:555-580` | The OSM recovery sweep's first-feature-wins rule breaks on DUPLICATE OSM ids: `onRecovered` fires inside the pass-2 loop, re-keying the row; a second feature with the same id hits the re-keyed row | Deduplicate ids before the sweep or defer re-keying to pass end | FV |
| H2-2 | H2 | `scene/userModels.ts:493-494,542-543,566-589` | A failed GLB fetch is never retried in-session (startLoad requires idle, replan skips `failed`, setModels resets only on URL change — immutable for a stored GLB); the doc says "until its row changes" but a transient 5xx is not a row change | A retry-on-next-replan or a manual retry affordance in the MODELS tab | FV |
| H2-3 | H2 | `lib/globe/bldgSync.ts:115-129` | The shared-overwrites-my-synced stamp writes `s: nowMs()` (CLIENT clock) onto a row whose `t` is the SERVER's `updatedAt` — with client-clock skew, LWW can order a refresh write as newer than a newer server write | Stamp from the server field on the overwrite branch (grace exists only on delete) | finder (its verifier died to a 429; anchor quote recorded) |
| H3-1 | H3 | `store/userModels.ts:432-443` + `lib/edit/editJournal.ts:187-188` | A DELETED user model is never forgotten from the edit journal (the journal's own doc names "its model deleted" as a `forgetTarget` case) — the MESH EDITS pill lingers with a DROP that would restore a deleted row | Call `forgetTarget` in `remove()` | MAIN |
| H4-1 | H4 | `scene/streetNames.ts:187-195,284-289` | Lever (d)'s canvas-store release was applied ONLY to overlay composites: streetNames' label textures (one canvas per name) release via `texture.dispose()` alone — the backing store waits for GC, the exact class lever (d) was built for | Route `releaseTexture` through the same zero-size release | FV |
| H4-3 | H4 | `enrichedBuildings.ts:1786-1794,3490` | A named candidate for the §31.6 renderer creep: `seatCache` (RC9 banked seats) has NO size bound — every dispose-model banks a features-Map + per-tree Float32Array keyed by cell URI, for the session | LRU or epoch-clear the seat cache | FV |
| H5-1 | H5 | DECISIONS 2026-09-10e (T134(1)) vs `overlayFetchPriority.ts:101-107` | DECISIONS describes the shipped priority as "downloaded tiles 2e12 **+ error**" — the shipped code has NO error term (the error-ordered first cut was rejected, as the same entry later records): the ruling text contradicts the shipped code it introduced | One-line DECISIONS correction (append-only: new dated line in T141) | FV |
| H5-2 | H5 | `moonlightTerrain.test.ts:16-19` vs `imageryGround.ts:717` | The T133 load-bearing gate — `photo3d × (1 − night)` keeping the /m chart's photo look — is pinned by the twin as a COMMENT, not an assertion (tests.md item 15, appended for this audit, demands the twin land the same commit) | Encode the gate as a twin assertion | FV |
| H5-3 | H5 | `scene/skyGhosts.ts:70,184` · `skyTarget.ts:123,338` | T131 pinned only the two `sky.ts` discs; the ghost chain (depthTest TRUE — its own comment demands terrain clip it) and the target reticle anchor at ~far×0.5×1.02 ≈ 92 km, UNPINNED — far terrain (Fuji 107 km) no longer clips what the discs' fix promised ("any terrain wins at every altitude") | Extend the far-plane pin to the ghosts/target vertex shaders (T142) | MAIN |
| H5-4 | H5 | `scene/stars.ts:498` (material :113-117) | The star points need the pin and lack it: sphere scaled to min(1.05·limbDist, 0.9·far) ≈ 37.5 km from a 100 m eye while terrain draws to ~180 km, depthTest ON — catalog stars render IN FRONT of any ridge beyond their sphere | Pin stars' depth like the discs (owner taste: the pre-pin behaviour was never complained about) | FV |
| I1-3 | I1 | `imageryGround.ts:1195-1215` vs `compositeCanvasRelease.ts` | RC25's mip-chain canvases escape lever (d): under ULTRA each composite carries 1–3 extra halving canvases (~33 % of level-0 bytes) the dispose-path release never zeroes | Release the chain entries with the level-0 canvas | FV |
| I1-4 | I1 | `virtualSplitGuard.ts:93,98` | The split guard's install probe checks only `typeof expandVirtualChildren === 'function'` — a bump that renames `internal.isVirtual` keeps `installed:true` while silently killing the depth and slow-ancestor fences (the lineage walks break) | Probe the lineage field too; ride T136's smoke | FV |
| I2-1 | I2 | `TilesRendererBase.js:172-181,397-411` + three app docs citing it | The `loadAncestors=false → distancePriorityCallback` routing — cited as source-verified in three docs — is the one library coupling with NO executable fence | A unit test importing the installed library and asserting the routing (T136) | FV |
| J2 | J | `scene/glsl.ts:96-108` + `tuning.ts:1236,1998` | T132's far-plane fog is UNREACHABLE above 150 km: `ftwAerial`'s `if (hazeK <= 0.0) return col;` early-return precedes the `uFtwFarM` block, and hazeAlt is 0 at ≥ `hazeGoneAltM` — yet ground imagery stays drawn to `groundFadeTop` 750 km, so the hard far-clip T132 softened can still land on unfogged pixels at very high altitude | Move the fog block before the early-return (or gate the return on `uFtwFarM > 0`) | FV |
| J3 | J | `StylizedTiles.ts:7026` + `sky.ts:727` | T133 retuned ONLY the ground's moon terms; the buildings' moonlight rides the unchanged moon KEY (`moonKeyIntensity` × K&S × rigTakeover) — no twin pins a ground↔building night ratio, so the two halves can drift apart silently (the C2 both-halves law) | A night twin assertion on one ground/building pair (needs-eyes first: T142) | FV |

### NIT (13, batched per track — quotes at anchors; FV batch verdicts landed 0 refutations at press time)

| ID | Track | Anchor | Finding |
|---|---|---|---|
| B6 | B | `scripts/provision-collections.mjs:16` | Header still says "10-pin free quota" — 100/1000 since 2026-07-17 |
| B7 | B | `.gitignore:16-18` | `.env.development`/`.env.production` not gitignored (Astro loads both; none exist today) |
| C4 | C | `moonlightTerrain.test.ts:41` | Twin comment "grey → desat/cast are identity" — cast is a per-channel multiplier, not identity even for grey |
| C5 | C | 5 test files | `sinDeg` defined six times (the checklist's own DRY class) |
| F4 | F | `mobile/**` (0 logout hits; desktop `MemberBadge.tsx:74`) | No sign-out anywhere on /m |
| F5 | F | `Marketplace.tsx:36-47` etc. | Data-panel fetches carry no timeout/abort — LOADING… forever on a stalled connection |
| F6 | F | `ExploreMode.tsx:29-32` | Mid-placement Explore click silently no-ops (the guide documents the refusal; the click gives no feedback) |
| G6 | G | `PhotoDetailPanel.tsx:658` | Buyer fine print omits the 30-day link expiry D9 requires buyers be told |
| H1-2 | H1 | `tuning.ts:3007` vs `terrainBvh.test.ts:88+` | "bit-identical" documented; the pin matches hits BY faceIndex at 1e-6 relative, order-insensitive — weaker than the word |
| H3-2 | H3 | backlog T118 row vs `tuning.ts:4618` | Row says holdMaxMs 20 s; owner raised it to 30 s the same day (living value 30_000) |
| H4-2 | H4 | `imageryGround.ts:423,433` | Lever (d)'s kill switch untested in the OFF state (lever (a)'s is) |
| I1-5 | I1 | `overlayFetchPriority.ts:100-104` | A comment INVERTS the library mechanism it explains (the lock/range order) |
| I2-2 | I2 | `quality.test.ts:396-398` | Queue-defaults pin hardcodes 25/5 instead of reading the installed library |

### Main-agent live-tier findings (browser evidence, this session)

| ID | Sev | Anchor | Finding | Evidence |
|---|---|---|---|---|
| L1 | MINOR | `scripts/verify-guide.mjs:211,357` (+13b) | The guide harness pins STALE CONTENT COUNTS: asserts 11 chapters / 14 goals / a route count; HEAD ships **12 chapters / 86 topics / 16 goals** — 3 checks RED on clean HEAD with no known-red banner (the T61 class) | 3 FAIL lines reproduced twice; the guide surface itself passes (86/86 outline/topics, search, marks) |
| L2 | MINOR | `verify-shots/golden/` | The interlude session never PROMOTED its golden — `interlude-2026-09-10b` exists only under `sweep/`, so every `--compare interlude-2026-09-10b` is vacuous (14/14 "no golden" FAILs) until one is promoted; the pixel-changing interlude had left the freshest PROMOTED golden pre-dating its changes | My compare run; today's `audit4-2026-09-11` golden IS promoted (14 thumbnails) |
| L3 | NIT | `UploadFlow.tsx:273` (`["","","Two","Three"][missing.length]`) | The REVIEW step says "Three fields are missing" while SIX rows show MISSING (the count names only the D4 FOV set; GPS/shutter/ISO/date show MISSING badges the sentence doesn't count) — and the word array yields "undefined fields" if `missingParamKeys` ever returns ≥4 | Live: `ux-upload-10s.jpeg` (panel text captured verbatim) |
| L4 | — | `npm audit` | INFRA: both registries unreachable from this network — recorded above; the T24 posture carries | two failed runs |
| L5 | NIT | `public/logo/PLUX_MASTER_LOGO.png`, `PLUX_FAVICON.png` | Unreferenced anywhere (master assets, likely deliberate — owner call) | zero-result validated |
| L6 | NIT | origin/private remote refs | 12 stale `claude/ship-*` remote-tracking refs (branches long squash-merged); `git fetch --prune` + `git remote prune private` clears | `git branch -a` |
| L7 | NIT | `scripts/verify-visual-sweep.mjs:18-21` | The sweep's usage header omits `--experimental-websocket` (Node 20 has no global WebSocket — my first run died on exactly this; the uxbatch scripts document it) | the crash + the sibling headers |

## Verified clean (named probes, never implied)

- **Gates**: the Track-E table above; the freeze seam 14/14 byte-identical (T94 healthy at HEAD).
- **T131–T134 hold LIVE** (the four owner poses re-run on the house Chrome, `verify-shots/audit4/p1..p4*`):
  P1 Fuji-moon dark scene with the disc region at the ridge (fence + interlude crop carry the occlusion
  read); P2 tele-horizon — **no blown white band** (row maxima 176–251, the 251 = the documented albedo
  crest); P3 moonlight mean luma 23 with relief (not the pre-fix milky mass); P4 ULTRA Everest — every
  row brightens early→late (the stream converging), DBG `slotBoosts` 1729 / `growthCapped` 24 active,
  `fullCacheKick` 0.
- **T135a NOT REPRODUCED** (again): cold cache + Everest FPV → t+60 s `camera.altM` 8601 m,
  `eyeAboveGroundM` 312.4 — seated on terrain (row re-verified note landed).
- **The mobile + mesh regression surface**: mobile-batch twin **127/127** (AR, SAVE, live tabs, encoder,
  FIND, twist, T126 undo/drop on the twin), meshedit PASS incl. live collections, usermodels 21 legs
  (per-axis scale, lift, tilt, LWW, MODELS tab) — the H2/H3 replay's browser evidence.
- **The five 2026-08-22e closures hold at HEAD** (K1's zero-result validation: `planElevationsM`,
  `radarBands.ts`, `tangentOverlay.ts`, `radarCanvas.ts`, `aimAnchor.ts`, `TILE_RETRY_MS`,
  `clampPlannedView` all present and wired) — registry rows closed this session.
- **Live-site canaries** (Track G's live half): all 200/301 as listed in the gates block.
- **First-run UX (desktop)**: welcome overlay + "EXPLORE THE GLOBE →"; Tab focus reaches chrome; the
  full control deck, scrubber, PLAN/FIND/BEST SPOT surfaces present; upload flow LIVE-VERIFIED end to
  end (panel → file accept → REVIEW with honest per-field MISSING disclosure + "SET ON GLOBE" affordance).
- **/m shell**: 5-tab bar (SCENE/PLAN/FIND/SEARCH/SPOT), LAYERS, MY LOC, AIM readout, version stamp.
- **Slow network graceful**: 400 kbps/400 ms — dark reveal-hold at 4–10 s, 38 % content by 20 s, no
  error surfaces (`slow-*.jpeg`).
- **C6 precision itself**: no exact-GPS leak found on any public payload (the tiers + re-reduction
  verified by G's walk); the C6 exposure is the missing moderation GATE, not precision.
- **Audit purity**: zero `src/`/`scripts/`/`public/` diffs in the session.

## Pre-existing / out-of-scope

- `npm audit` — infra (network); T24 carries the advisory posture.
- The 3 intermittent freeze residues — the T103-documented class (all byte-identical on re-run).
- D8's 3,093-vs-3,094 — needs git archaeology on the 09-10e tree (named in T141).
- Device/Farm tiers — not run in an audit session by design (the T130 farm feature legs stay owed;
  T124's device tier stays the owner's phone).
- The FV panel's history: two API usage walls interrupted the verifier fleet mid-run (both resumed; the
  final pass then COMPLETED — 29/29 MINOR verifiers ran, 26 confirmed / 2 refuted, one verdict's agent
  died post-verdict to a 429, noted on its row; 13/13 NITs confirmed). The H2 finder died once to a 429
  and re-ran on resume.

## Backlog status changes (this session's dated edits — the registry IS the record)

- **CLOSED (registry repair, K1)**: T32 · T35 · T36 · T37 · T39 — closed by DECISIONS 2026-08-22e
  (F1/F5/F4/A1-4/F2) but never edited; each row now carries the closure + this audit's HEAD
  re-verification.
- **T135**: re-verified note — (a) not reproduced again (live, cold cache); stays OPEN-parked (no
  re-seat rule exists).
- **NEW ROWS**: T136 (the ONE library-bump fence: exact pin + installed-flags boot smoke) · T137 (the
  skyBudget twin vs the T96 LOOK) · T138 (the LIVE-SITE GRADUATION owner batch: moderation, ToS,
  uploads, analytics) · T139 (previewUrl allowlist) · T140 (guide currency + harness re-pin) · T141
  (docs/memory drift batch incl. DECISIONS round 7 — §Recent measured AT 135,178 B) · T142 (interlude
  tails: ghosts/target/stars pins, the J2 fog ordering, night needs-eyes) · T143 (platform hardening:
  B1/B3/B4/B7/B6, quota race).
- **Flagged, rows updated by T138 when ruled**: T17 (trigger fired), T26 (trigger fired + mime axis),
  T30 (UI now bites — G4), T50 (unpark candidate — D4). T71's pointer corrected, T88's premise
  discharged (K2/K3 — folded into T140/T141 notes).

## Fitness scorecard

| Seed promise | Proxy | Value |
|---|---|---|
| Geo-accuracy | literature-vector tests (FOV/geohash/projection/ephemeris/kepler/moonlight) | local-tested, 3,098/3,098 green |
| Beauty | dated sweep sheets + the four interlude poses | browser-VERIFIED (house :9333, 2026-09-11) |
| Perf | sweep fps/dt per pose; bundle | fps p50 32.9–60.6 by pose, dt p50 16.5–33.6 ms, 0–4 hitches/pose; 32 MB bundle — browser-read |
| Privacy C6 | public-payload walk | tiers enforced, no exact-GPS leak; moderation gate ABSENT (G1) — mixed |
| Docs currency | stale-tag/registry census | degraded (D1–D8, K1 — repaired in part this session) |
| Business (C3/D9) | marketplace stubs vs live site | checkout contract intact; buyer fine-print gap G6; stubs would mislead only at the market surface (no listings seeded) |

## Proposed convention / checklist amendments (the Pesticide harvest — LANDED this session)

- `checklists/code.md` **29** (GLSL backtick-in-template-literal trap) · **30** (float32 storage
  round-trip) · **31** (order-sensitive queue probes).
- `checklists/tests.md` **13** (`/json/new` tab activation) · **14** (cold-cache expectations) · **15**
  (the night-twin same-commit law) · **16** (house-Chrome lifetime + `.vite` aside on EVERY restart).
- `checklists/platform.md` **14** (the shaped POST canary).
- From THIS audit's own harvest (not yet encoded — proposed): (a) tests.md — *a harness that pins
  content COUNTS re-pins them when the content grows* (L1, the T61 banner class); (b) code.md — *a
  depth-tested camera-anchored impostor states its anchor band vs the far-plane pin explicitly* (H5-3/4);
  (c) platform.md — *an accepted-risk row whose trigger fires gets re-ruled the same session* (the
  LIVE-SITE GRADUATION class). Encode (a)–(c) in the fix sessions that own their surfaces.
- False-positive ratchet: 0 refutations in every completed verification — no checklist tightening due.

## Fix-session slicing (ordered; gates named; fixes are NOT part of this audit)

1. **S1 (S)** T136: exact-pin `0.4.28` + the installed-flags boot smoke + the routing/probe fences
   (A1/A2/I1-4/I2-1). Gate: the new pin test green; boot warn path exercised once in dev.
2. **S2 (S)** T137: the skyBudget twin gets the LOOK terms. Gate: recomputed worst < 0.9 with margin;
   twin red if `domeDirK` + 0.05.
3. **S3 (M, OWNER)** T138: the live-site graduation batch — moderation, ToS re-check, upload bounds,
   analytics. Gate: four dated rulings on the rows; code only where ruled.
4. **S4 (S–M)** T139: previewUrl allowlist at both edges. Gate: a hostile-URL twin + one manual pin
   round-trip.
5. **S5 (M)** T140: guide currency (D3/F1/F2 + two topics) + the harness re-pin (L1). Gate:
   `verify-guide` ALL PASS on clean HEAD.
6. **S6 (M)** T141: docs/memory hygiene (+ DECISIONS round 7 — the trigger is AT) incl. D4/D5/D6/D7,
   contracts.md re-diff, H5-1's DECISIONS correction line. Gate: `mem:core` ≤ 12 KB; NSP consistent.
7. **S7 (M)** T142: interlude tails — ghosts/target/stars far-pin (verify with the Fuji pose + a ghost
   visible), J2's fog ordering, C2's comments, H5-2's twin assertion, J3 needs-eyes with the owner.
8. **S8 (S×5)** T143: B1 ship-attention write (FIRST — it guards every future ship), B3 canary retry,
   B4 bbox fence, B7 gitignore, B6 header.
9. **S9 (M)** the mobile UX batch (F3 focus/Escape on sheets, F4 sign-out, F5 fetch timeouts, F6
   feedback) + L3's copy fix. Gate: the mobile-batch twin extended, still 100 %.
10. **S10 (M)** the replay tails that earned their own slice: H2-1 duplicate-id sweep, H2-2 GLB retry,
    H2-3 clock skew, H3-1 forgetTarget, H4-1 streetNames canvases, H4-3 seatCache bound, J1 note, A1's
    order probe. Gate per item: its named twin/probe.

---
*Verification outcome (FINAL): run #1's completed panels (16 verdicts) refuted nothing. The final
trimmed pass completed 2026-09-11: **29/29 MINOR verifiers ran (26 CONFIRMED, 2 REFUTED — one verifier's
verdict stands but its agent died to a request-rate 429, noted on the row) and 13/13 NITs CONFIRMED.**
Total across all passes: **0 BLOCKER · 6 MAJOR (all panel- and anchor-verified) · 37 MINOR · 13 NIT
confirmed (plus the 5 live-tier L-series); 2 candidates DELETED per the charter (recorded here so they
are never re-discovered):*
- **G5 (deleted — "zero analytics on a live product")**: the analytics live on the Wix headless EDGE,
  not in the repo — a live fetch of www.plux.today (2026-09-11) shows every served page carrying
  edge-injected `site-bi`, `site-analytics`, `tag-manager-client` + consent bundles, an inline
  `wixAnalytics.trackEvent('PageView')` on DOMContentLoaded and on SPA navigations; checkout flows
  through Wix redirects and lands in the dashboard natively. The residual (custom upload→save funnel
  events, client error capture) is a dashboard-side Tag-Manager wish, not a defect. T138's analytics
  item is discharged by this.
- **J1 (deleted — "the DBG fullCacheKicks note misleads during the RC20 bank window")**: the premise is
  false for the installed library — `LRUCache.isFull()` (0.4.28 `LRUCache.js:128-132`) is CAP-relative,
  the bank writes only `minBytesSize`, and `lruBankFloorBytes` guarantees cap − floor ≥ 16 MiB
  (`tuning.ts:892`, `quality.ts:92-100`), so the kick does not tick at rest during the bank window and
  the note stays accurate.*
