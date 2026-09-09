# AUDIT #4 CHARTER — the full breadth-first ADVERSARIAL pass (owner order 2026-09-10f)

**Status: CHARTER, not a report.** The report this charter produces lands beside it as
`audit-full-2026-09-1x.md` (the `audit-report-template.md` shape, newest-first in `README.md`).
The audit is **READ-ONLY on `src/`, `scripts/`, `public/` and the docs**: it produces findings;
fixes are separate sliced sessions. A `src/` diff in the audit session is itself a Track-D FAIL.

## Why this one is different

1. **It is run by a DIFFERENT AI model than the one that wrote the last five weeks of changes**, on
   purpose — to remove the author's bias. So this charter is self-contained: it names every file,
   seam, harness and doc the auditor needs, and assumes NO memory of any previous session. The
   auditor must not trust any claim in DECISIONS, MEASUREMENTS or the memories because it is
   written down; a claim is true when the cited code, the cited test, or a re-run reproduces it.
2. **It is breadth-first.** Every part of the product gets a pass before any part gets depth: the
   globe engine, the Wix backend, the desktop chrome, the `/m` shell, the guide, the marketplace
   stubs, the release path, the harnesses, the docs, the memory graph. Depth follows the breadth
   pass, on the surfaces the breadth pass flagged and on the RECENT-CHANGE surface named below.
3. **It is adversarial.** The stance for every recent ruling, fix and measurement is: *this is
   wrong until I reproduce it.* Each major finding needs one honest refutation attempt written
   down; each "verified clean" needs the probe that would have caught the defect (zero-result
   validation: prove the grep or the query CAN match).
4. **It looks for EMERGENT defects** — the ones no single change contains: two levers that fight,
   a guard that hides a symptom another lever then reintroduces, a harness that measures the
   wrong thing, a doc that records a ruling the code no longer honours, a business rule the UI
   contradicts.

## What "done" means

- A report under `.claude/claude-docs/audits/` with the template's sections: verdict · gates
  baseline (Track E, classified before any code is read) · findings (severity-first, each with
  severity · confidence · `file:line` or doc§ anchor · the violated convention/ruling · a specific
  fix · a verification tier) · verified-clean probes · backlog STATUS VERIFICATIONS (never
  re-discoveries — `.claude/skills/frame/references/tracked-backlog.md` is the one registry,
  T1–T135) · checklist amendments (the Pesticide harvest) · an ordered fix-session slicing.
- Every finding is re-read at its anchor by the main agent before it is written; a candidate that
  does not reproduce is deleted, not downgraded. If more than 20 % of a track's candidates die in
  verification, the offending checklist item is tightened (dated).
- Evidence tiers are honest: local-tested · browser-VERIFIED (which Chrome, which pose, which
  harness) · wix-cloud-VERIFIED · UNVERIFIED. A measurement that was not re-run is UNVERIFIED
  however confidently the doc states it.

## The tracks

Run Track E first (main agent). Then A–D and F–I as parallel finder agents, one checklist each
(`references/review-agent.md` is the finder contract), then the mandatory verification pass.

| Track | Surface | Checklist / brief |
|---|---|---|
| **E** Mechanical hygiene (FIRST) | `npm test` · `npx astro check` (the 12 hints are a dated baseline — a 13th is a finding) · `npx knip` · `npm audit` · `wix build` bundle size vs the 33 MB baseline (2026-08-13) · unused `public/` assets · dead DEV seams (`window.__*` nobody reads) | `audit-mode.md` §Track E |
| **A** Code + engine invariants | `src/components/globe/**` (the orchestrator `StylizedTiles.ts` 8.8 k lines, 35 scene modules, `tuning.ts`), `src/lib/globe/**`, the stores, the workers | `checklists/code.md` |
| **B** Wix platform + backend + ops | `src/pages/api/*`, `src/lib/wix/**`, media/TUS, quota, C6 precision tiers, the release script `scripts/release.sh`, env/token handling, the ship hook | `checklists/platform.md` |
| **C** Tests + math integrity | `test/**` (206 files, 3,098 tests), `formal/` (Lean; run `npm run proofs` ONLY if the math it mirrors changed), the JS-twin tests (are they still twins of the shader lines they mirror?) | `checklists/tests.md` |
| **D** Docs + memory + conventions | `.claude/claude-docs/**`, `.claude/conventions/**`, `.serena/memories/**`, `AGENTS.md`/`CLAUDE.md`, the guide content under `public/` | `checklists/docs.md` |
| **F** UX (NEW) | Both shells end to end as a first-time user and as the owner: the welcome, upload → decode → place, FPV entry/exit, the sliders, the time scrubber, PLAN/FIND/BEST SPOT, the `/m` tab bar + sheets, the guide, the DBG chip, keyboard + touch, error states, copy/microcopy (PLUX, never "Frame the World" — `test/brandFence.test.ts` is the fence), accessibility basics (focus, contrast, `aria`), loading/empty/error states, what happens on a slow network | the UX brief below |
| **G** Business + product (NEW) | Does the code honour the seed's intent (`PROJECT_SEED.md` §1–§4, C1–C6, D1–D15)? Marketplace v1 (C3: digital-only, owner-mediated payout), quota 100/1000, member tiers, C6 precision on every public payload (`lib/geo/precision.ts`), the parked Phase 7 (no AI code in `src/`), what the live site at `www.plux.today` actually serves vs what the docs claim, attribution/ToS (Esri, Cesium ion, OSM, CARTO, Google tiles never styled — C5), analytics/BI absence, what a paying user gets | the business brief below |
| **H** The RECENT-CHANGE adversarial replay (NEW) | Every change since **2026-09-05** (DECISIONS 2026-09-05b → 2026-09-10f): the T77 lane (levers 5/6/8/10/11, T80-h, T83 caps, T106/T107, T116), the mesh suite MS0–MS8 (`MESH_SUITE_PLAN.md` §4a is binding), the mobile batch (T120–T129), the T123 levers (a)/(d), and the 2026-09-10e/f interlude (T131–T134). For EACH: re-derive the root cause from the code, re-run the cited measurement where a harness exists, and try to break the fix | the replay brief below |
| **I** The LIBRARY-PATCH surface (NEW) | Every place the app reaches into `3d-tiles-renderer@0.4.28` internals: `lib/globe/overlayFetchPriority.ts`, `virtualSplitGuard.ts`, `compositeCanvasRelease.ts`, `detachedRelease.ts`, `esriPlaceholder.ts`, `terrainBvh.ts`, `belowCameraGate.ts`, the `_onTileVisibilityChange` re-wire and the aniso stamp in `scene/imageryGround.ts`, `pluxGlobeControls.ts`, the QuantizedMesh/ion plugin ordering. Question for each: what breaks SILENTLY on a library version bump, is there a fence (`fences.test.ts`, a fail-soft `installed:false` path), is the patched behaviour documented in the library's own terms, and does the patch interact with another patch | the library brief below |

### The UX brief (Track F)
Drive the real app (`wix dev`, the house headless Chrome on :9333 via `node scripts/verify-chrome.mjs
--headless --port 9333 --profile /tmp/ftw-cdp`, or the owner's :9222 when it answers — never kill
it). Poses come from `scripts/lib/poses.mjs` (the catalogue) plus the four interlude poses in
NEXT_SESSION_PROMPT. Screenshots to `verify-shots/` only. Judge: does a stranger understand what
to do in the first 10 s; does every control explain its disabled state; does the FPV HUD read;
does the `/m` shell survive a rotation, a background/foreground, a slow first load (the reveal
veil, the "LOADING THE SCENE…" chip); do the sheets and the tab bar agree; is the guide current.
Rendered geometry + screenshots prove visibility — DOM properties do not (the `[hidden]` trap).

### The business brief (Track G)
Read `PROJECT_SEED.md` first, then check the code against it, not the other way round. Name every
seed promise the code does not keep and every code behaviour the seed does not sanction. C6 is a
BLOCKER class: any public payload carrying exact GPS. The marketplace and the paid tier are stubs
by design — say which stubs would mislead a real visitor today (`www.plux.today` is live). The
attribution chip must name every data source actually drawn.

### The replay brief (Track H) — the adversarial questions, per change
- What did the change CLAIM (the DECISIONS line), what does the code DO, where do they differ?
- Which measurement backs it, on which Chrome, cold or warm cache, which pose? Re-run the cheap
  ones (`scripts/verify-visual-sweep.mjs --ids <pose> --compare <golden>`, `probe-cpu-profile`,
  the session scratchpad probes described in DECISIONS 2026-09-10e). Cache state is a confound
  the interlude documented: absolute tile counts at a settle cap are cache state, not code.
- What is the kill switch, is it tested in BOTH states, and is the off-state exact (the ULTRA
  off-state law: `=== 0`, `toBe` identity)?
- What does the change cost on the phone (the lean profile, the T83 caps, the 2 GB jetsam)? Was it
  measured there or only on the desktop twin?
- Which OTHER lever does it interact with? Named suspects: the 12 desktop ground parse slots
  (`LOADING.groundDesktopCaps`) vs the T77 hitch budget (a 12-tile landing frame — never
  measured); the cache-full re-traverse kick (`GROUND.fullCacheKickMs`) vs the RC20 flip bank and
  the T83 rest-trim on `/m`; the imagery FIFO bands vs U5 closest-first on buildings; the far-plane
  fog (`ULTRA.farFogStartFrac`) vs the T93 limb lobe and the dusk afterglow at the terrain/sky
  junction (RC24); the dome depth pin vs anything that relied on the dome painting over far
  terrain (MEASUREMENTS §17.5 read it as the sky); the moonlight retune vs the building night
  path (`buildingMaterial.ts`, T125's floor) and vs the `/m` chart's photo look; the split guard's
  growth floor (512) vs street-level composite zoom (z19 must hold — it did at Dnipro FPV); the
  reveal hold cap (`GROUND.revealMaxHoldMs`) vs the boot-time patchwork it was built to prevent.
- T135 (parked): a cold-cache FPV boot in high terrain seats the eye at the ellipsoid and never
  re-seats; a white diagonal band crossed one pre-fix Everest frame. Reproduce or close.

### The library brief (Track I)
`node_modules/3d-tiles-renderer` is pinned at 0.4.28 by the lockfile. For each patch: cite the
library line it depends on, state the behaviour a minor bump could change, and check that a
drift degrades to the library's own path with a console line (the `esriPlaceholder` and
`overlayFetchPriority` `installed:false` pattern) rather than a silent half-install. Count the
patches; propose the ONE fence that would catch a bump (a version-pin test, or a smoke that reads
each `installed` flag at boot).

## Hot spots the last author names against themself (start here; verify, do not trust)
- `scene/imageryGround.ts` is 1,600+ lines of plugin wiring, shader injection, seat machinery and
  five monkey-patches — the densest seam in the repo; `StylizedTiles.ts` at 8.8 k lines runs ~55
  step functions per frame with orchestrator state that must be declared above the ephemeris
  seam (a TDZ trap that silently renders the placeholder globe).
- The night grade now has SIX tunables interacting (`nightFloor`, `nightFloorSkyMin`, `moonFillK`,
  `moonFillNormalK`, `moonSheenK`, `ambientNightK`) plus the 1.46 night exposure; the JS twin
  `moonlightTerrain.test.ts` mirrors the shader by hand — any drift between them is silent.
- The T77 lane changed the per-frame cost model on the desktop repeatedly without a single
  consolidated re-measure after the interlude (the 12 parse slots, the split guard, the FIFO
  bands). The hitch table in MEASUREMENTS §26.2 predates all of it.
- `verify-visual-sweep.mjs`'s absolute counts at the 8 s settle cap depend on the imagery cache
  state (fresh `mkdtemp` profile = cold; Chrome's disk cache thrashes across a long probe
  session) — the gate is calls/tris at convergence; check that the goldens were shot warm.
- The ship hook writes commits in its own format (no session trailer), bumps the version on every
  ship, and force-syncs a mirror — audit its failure modes against `mem:decisions/session-end-autoship`.
- The house Chrome after ~100 probe boots hung a sweep's first heavy leg; the resource budget
  script (`scripts/resource-watchdog.mjs`) counts Chromes and memory but not page-boot count.

## Constraints the auditor inherits
- The RESOURCE BUDGET (owner order 2026-09-06j): one house headless Chrome, one dev server, free
  memory ≥ 20 %; finder agents never launch a browser, a dev server, the full `npm test` or `astro
  check` — the main agent runs those, one after another.
- The VPN is a precondition for every terrain gate (`curl https://api.cesium.com/v1/assets/1/endpoint`
  reads 401 when it is on, 403 when it is off).
- Never edit a served `src/` module while a harness runs (HMR reaches every open tab).
- Close the house Chrome and stop `wix dev` at the end (`node scripts/close-verify-chrome.mjs`; the
  SessionEnd hook does both).
- The audit's diff touches only its report, `README.md`'s index row, the checklists' dated
  amendments, and the Phase-4 records (a memory leaf, one DECISIONS line, the handover).

## Baseline anchor
DECISIONS 2026-09-10f (master `fc6b568`, app 1.36.8). The previous full audits for shape and
calibration: `audit-full-2026-08-13.md` (#1), `audit-full-2026-08-18.md` (#2),
`audit-batchseams-2026-08-22.md` (#3), `audit-occlusion-2026-09-07.md`, `audit-docs-hygiene-2026-09-06.md`.
Severity and cadence: `audit-mode.md`. The laws each checklist item encodes: `references/laws.md`.
