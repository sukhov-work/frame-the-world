# Frame the World — Pre-S7 Architecture Review & Refactor Ledger

**Date:** 2026-07-11 · **Mode:** design + review, Deep tier (investigate-design-v3 under `/frame`, ultracode).
**Trigger:** owner asked, before the final Phase 5.5 **S7** (ground rework), for a reflective architecture
review + VERY careful refactor to clean up/organize the codebase, update conventions, compact DECISIONS.md,
and make the code readable/maintainable for humans **and** Claude agents.

## Method
A 7-track parallel review workflow (subsystem readers: orchestrator · scene+tuning · stores+lib ·
panels+ui+backend · docs+conventions drift · DECISIONS compaction · dead-code sweep) → a consolidator that
deduped/merged into one risk-classified backlog. 79 raw findings → 26 backlog items. Baseline before any
change: **304/304 vitest + astro check 0 errors** (~1 s) — the safety net every step is checked against.

## Health read (honest)
Structurally **good**: the `scene/*` attach-module pattern, the `flight.ts`/`explore.ts` factory-controllers,
and the pure-math `lib/` layer are clean and well-tested; the load-bearing invariants are intact and heavily
documented in-code. Accretion is concentrated in **three places**:
1. **`StylizedTiles.ts` → 1605 LOC** — a single closure whose 917-line `update()` absorbed five subsystems
   that never got their own module (FPV controller · manual glides/encoder-rates/underground-guard ·
   placement/pick/temp-pin/hover · FPV HUD + sky-marker mirror · ephemeris-lighting drive). Per-frame
   ordering is an implicit contract encoded only by statement order.
2. **Docs/conventions drift** — fake `npm run lint` gate; phantom repo layout (`src/backend/`, `public/wasm/`,
   `ecef.ts`, `sun-moon-stars.ts`); "~200-line orchestrator" (now 1605); unused Tailwind; renamed component
   names in ARCHITECTURE §7; store-name examples matching zero real stores.
3. **`DECISIONS.md` → 709 lines / 113 KB** loaded whole — outgrew its append-only format.

## Load-bearing invariants (a refactor that breaks one is a bug)
client:only globe / Web-Worker decode · **ONE shared building material** (chained onBeforeCompile, global
uniforms, O(1) per-frame, no per-tile swap) · **ECEF camera-anchored precision** (float32 cancellation;
hoverAnchor adds mesh.position back) · **tokens.ts GL bridge** (sRGB colour / NoColorSpace data) · **tuning.ts
= single tunable source** · design imports fenced to panels|ui|styles · **C6** reduced-precision public pins ·
store **seam + mirror** pattern (window.__* dev seams deliberate). Full list → `DECISIONS.md § Traps & Gotchas`.

## Falsification-gate catches (why the gate exists)
- **`api/ping.ts` is NOT dead** — the dead-code track saw "no internal reference," but it is the documented
  released-URL **POST-403 canary / pre-release gate** (Phase 5 release entry; NEXT_SESSION). An HTTP endpoint
  hit externally has no internal caller by design. → **B4 keeps ping.ts** (only its stale header is refreshed).
- **`Welcome.astro` IS dead** — only `panels/Welcome.tsx` is imported; its 3 SVGs are orphaned with it. → delete.
- Path fixes: `Pins.ts` is `globe/Pins.ts` (not `scene/Pins.ts`); `lib/geo/ellipsoid.ts` is a new file (B6).

## Decisions (owner, 2026-07-11)
- **Scope this session = Full local-verified tier** (B1–B18 + B26): all verified by review / astro-check /
  unit-test against the 304-test baseline. No browser-only changes bundled with them.
- **B19 (orchestrator readability) = pre-S7 pass now** — split the 917-line `update()` into named
  step-functions (exact per-frame order preserved), browser-verified, so S7 starts from a readable orchestrator.
- **B20–B22 (controller extraction, shader-GLSL dedup, tiles typing) folded into S7** — deferred, since S7
  edits the same terminator GLSL + camera math; verify together in one browser pass.
- **DECISIONS compaction** preserves the append-only invariant: old logs **moved byte-identical** to
  `DECISIONS_ARCHIVE.md`; supersession annotated only in new digest/ADR/Traps sections.

## Backlog (risk-classified) & status

**Done 2026-07-11 session 1** (314 vitest · astro check 0): B1, B2, B3, B4, B5, B7, B14 (dead-const), B18.
**Done 2026-07-11 session 2** (323 vitest · astro check 0 · a 3-reviewer adversarial workflow → 0 findings):
B6, B8, B9, B10, B11, B12, B13, B14 (section index), B15, B26. Two sub-scopes assessed and **declined** with
rationale (falsification gate): B6's `projectOntoTangent`/`horizontalApproach` (each call site's degenerate
fallback differs — forcing one helper would be lossy; left inline) and B12's `generic requestJson` (uploadMedia's
is the ONLY real instance; geocode's error contract differs). B9's `PRECISION_TIERS` applied to the pins
bad-data fallback (`DEFAULT_PRECISION_TIER`); the PhotoDetailPanel tier LABELS stay (presentational).
**Remaining:** **B19** (orchestrator `update()` split — browser-verified, the owner's pre-S7 ask; the
B6/B12/B13/B26 scaffolding it needs is now in place) · **B16/B17** (owner-declined moderate splits) + **B20–B25**
(fold into S7).

Risk: `SM` safe-mechanical · `MOD` moderate · `RISK` risky-loadbearing. Verify: `rev` review · `ac` astro-check
· `ut` unit-test · `br` browser/wix-only.

| ID | Pri | Risk | V | Title | Status |
|----|-----|------|---|-------|--------|
| B1 | P0 | SM | rev | Compact DECISIONS.md (ADRs hoisted · Traps · digests · archive) | ✅ s1 |
| B2 | P0 | SM | rev | Fix doc-drift (lint gate · repo layout · ARCH §7 · store names · orchestrator claim · wasm TODO) | ✅ s1 |
| B3 | P0 | SM | rev | Codify 4 conventions (seam+mirror · ECEF anchoring · shared-material · verify-harness+seam registry) | ✅ s1 |
| B4 | P0 | SM | ac | Delete Welcome.astro + 3 orphaned SVGs (KEEP ping.ts, refresh header) | ✅ s1 |
| B5 | P1 | MOD | ut | Resolve dead exports (frustumPose · altMToSlider · neighbourGeohashes · extract classifiers) | ✅ s1 |
| B6 | P1 | SM | ut | Extract shared geo/math helpers to lib (clampGroundM · ndc↔client · focalFromHFov · wrapHeadingDeg; projectOntoTangent declined) | ✅ s2 |
| B7 | P1 | SM | ut | Consolidate format helpers into lib/format/readout.ts (formatEyeM/AltM · cardinal · formatSigned) | ✅ s1 |
| B8 | P1 | SM | ut | Fix lib→store layering (param layer → lib/decode/params.ts; pinBody imports lib) | ✅ s2 |
| B9 | P2 | SM | ac | Single-source shapes (coerce.ts numOrNull/strOrNull · CameraPoseOptics · DEFAULT_PRECISION_TIER) | ✅ s2 |
| B10 | P1 | SM | ac | Extract lib/api/http.ts (json() + requireMember()) | ✅ s2 |
| B11 | P1 | SM | ac | Standardize DEV window seams on typed `declare global` (keep all) | ✅ s2 |
| B12 | P1 | SM | ac | Type-safety at boundaries (GlobeControlsInternal; generic requestJson declined — no 2nd consumer) | ✅ s2 |
| B13 | P1 | SM | ac | Promote ~20 orchestrator magic numbers to tuning.ts (new ORCH group) | ✅ s2 |
| B14 | P2 | SM | ac | tuning.ts hygiene (section-banner index [s2] · delete dead TERRAIN const [s1]) | ✅ s1+s2 |
| B15 | P2 | MOD | ut | Dedup save-flow guards (BUSY_PHASES/isBusy + toApiError) | ✅ s2 |
| B16 | P2 | MOD | ut | Split store/upload.ts (savedPinToExif adapter + decode-timer isolation) | ⏸ S7 (owner-declined) |
| B17 | P2 | MOD | ut | Panel dedup + splits (ProjectionSlider · provenanceBadge · SavePinSection · useParamRate) | ⏸ S7 (owner-declined) |
| B18 | P2 | SM | ut | Add extract.test.ts (fileExtension/isRawFile/isHeicFile/isBrowserDisplayable) | ✅ s1 |
| B26 | P3 | SM | rev | Throttle the per-frame catch (log-once-then-count) | ✅ s2 |
| B19 | P1 | RISK | br | Orchestrator readability: update() → named step-functions (order preserved) + header rewrite | ☐ pre-S7 |
| B20 | P3 | RISK | br | Extract StylizedTiles subsystems to createX factories | ⏸ S7 |
| B21 | P3 | RISK | br | Dedup terminator/golden shader GLSL into scene/glsl.ts | ⏸ S7 |
| B22 | P3 | RISK | br | Typed shims for 3d-tiles-renderer callbacks | ⏸ S7 |
| B23 | P3 | MOD | br | Extract scene/textureUpgrade.ts from baseEarth | ⏸ S7 |
| B24 | P3 | MOD | br | Extract impostorDistance() shared by sky/dayArcs | ⏸ S7 |
| B25 | P2 | MOD | br | Harden POST /api/photos against orphaned PublicPins | ⏸ S7 (wix-verify) |

## Deferred to S7 (browser/wix-verified)
B19 done pre-S7 (browser-verified this session); **B20–B25** fold into S7 — that phase edits the same
terminator GLSL, camera math, and ground pipeline, so they verify in one browser pass rather than paying the
browser-verification cost twice. NEXT_SESSION_PROMPT carries them forward.
