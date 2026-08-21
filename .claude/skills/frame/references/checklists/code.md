# Track A — Code + engine invariants (GL / three.js / stores / workers)

Format: one assertion per item, then `— check:` (grep / tool / read) and `— anchor:` (doc§ or
dated ruling). Authored 2026-08-13 from DECISIONS §Traps + conventions; re-mine DECISIONS since
the baseline anchor at every audit start and append dated items.

TOC: 1 client:only · 2 worker decode · 3 float32 ECEF · 4 heightAt clamp · 5 renderOrder/points/
additive · 6 color-space traps · 7 tuning contract · 8 shared building material · 9 store seams ·
10 per-frame writes · 11 lazy contract · 12 contract strings · 13 degrade visibility ·
14 hidden-attr CSS · 15 frame-loop budgets · 16 dead/duplicated code · 17 instanced-mesh lifecycle ·
18 CSS containing-block traps · 19 FPV disabled-controls invariants · 20 mirror-never-seats ·
21 raw-focusHit pan math · 22 3d-tiles-renderer version-coupled internals

1. The globe island is never SSR'd (C4): every GlobeCanvas mount is `client:only="react"`; no
   three/globe import is reachable from .astro frontmatter server code.
   — check: `grep -rn "GlobeCanvas" src/pages/ src/layouts/` → every mount carries client:only;
   `grep -rn "from \"three\"\|from 'three'" src/pages/`.
   — anchor: PROJECT_SEED C4; CLAUDE.md.
2. RAW decode runs in a disposable per-file Worker; buffers freed/transferred; worker terminated;
   `libraw-wasm` stays EXACT-pinned at 1.0.5 (1.1.2+ needs COOP/COEP).
   — check: read `lib/decode/*` worker lifecycle; `grep '"libraw-wasm"' package.json` shows an
   exact version (no ^/~).
   — anchor: ADR D3; DECISIONS Phase-2 digest; mem:patterns/upload-flow.
3. Instanced / large-coordinate ECEF meshes render camera-anchored (mesh.position = camera,
   camera-relative instances, modelViewMatrix-only shaders); no new large×large float32 math in
   shaders or per-frame CPU paths.
   — check: any new InstancedMesh / world-scale geometry since baseline follows the Pins/
   PhotoFrustum pattern (read the module); hoverAnchor-style re-adds where positions are read.
   — anchor: DECISIONS §Traps "ECEF float32 cancellation" (S4).
4. Every `heightAt`/terrain-sample consumer clamps to [0, 9000] (clamp-only-upward) and samples
   at the VIEW FOCUS, not the camera footprint.
   — check: `grep -rn "heightAt\|terrainHeightAt" src/` → each consumer shows the clamp or cites
   the helper that owns it.
   — anchor: DECISIONS §Traps "Negative heightAt garbage" (S2).
5. renderOrder is set per OBJECT (never on a Group); point sizes ≥ 2 px; overlays that must read
   against a bright sky are alpha-blended, not additive.
   — check: `grep -rn "renderOrder" src/components/globe/` → no Group assignment; new Points
   materials show size ≥ 2; new sky overlays show blending mode + rationale.
   — anchor: DECISIONS §Traps (Phase 4 / S6).
6. Color-space traps hold: the space backdrop is `scene.background` (never setClearColor for it);
   typed-array textures flip in the DATA (UNPACK_FLIP_Y is ignored); single-channel data textures
   linearize in-shader (no single-channel sRGB exists); colour maps sRGB, data maps NoColorSpace.
   — check: `grep -rn "setClearColor\|UNPACK_FLIP\|colorSpace" src/components/globe/` triaged
   per hit against the rule.
   — anchor: DECISIONS §Traps "Navy night-sky floor" (S5) + S5 texture items.
7. Tuning contract: every scene tunable lives in a documented `tuning.ts` group; scene modules
   carry no magic numbers that belong there.
   — check: spot-read scene modules changed since baseline for numeric literals with tuning
   semantics; diff against `conventions/globe-tuning.md`.
   — anchor: conventions/globe-tuning.md.
8. ONE shared building material invariant: both tilesets consume `buildingMaterial.ts` factory
   instances (separate per-tileset where clip prisms differ); onBeforeCompile chains never
   double-patch; solidity/ghost paths stay opaque + depth-writing (screen-door, not transparency).
   — check: read buildingMaterial consumers; `grep -rn "onBeforeCompile" src/components/globe/`
   → each chain documented.
   — anchor: DECISIONS 2026-07-13 Slice-2 (c); 2026-07-14 FPV follow-up (a).
9. Store seam discipline: React panels read mirrors and call request/set writers; `_sync*`
   writers are orchestrator-only; camera motion goes through request seams (requestFly,
   requestFpvJump, setTempPin/Fpv, rate setters) — no panel writes the camera directly.
   — check: `grep -rn "_sync" src/components/panels/ src/components/mobile/` returns nothing;
   new panels' store calls are reads + documented writers only. A sanctioned panel→globe feed
   uses an UN-prefixed verb (`publishGhosts` — the FIND v2 inversion, renamed from `_syncGhosts`
   2026-08-18 audit-2 A3), so the probe needs no exception list.
   — anchor: conventions/architecture-and-patterns.md (globe⇆React seam + panel-published feed); MOBILE_PLAN §2.
10. Zero per-frame store writes: continuous values derive (the `sceneTimeMs()` pattern) or
    throttle; viewport-style queries THROTTLE, never debounce (perpetual drift starves timers).
    — check: `grep -rn "setState\|\.set(" src/components/globe/` in per-frame paths triaged;
    any polling loop names its throttle.
    — anchor: DECISIONS 2026-07-14 UI/UX QoL (playback); §Traps viewport THROTTLE (Phase 5).
11. Lazy contract: heavy `lib/sky/*` (and any future heavy catalog) modules are dynamic-import
    only outside their home dir; `lazyContract.test.ts` still walks ALL of `src/` (new dirs
    included) and stays green.
    — check: run the test; read its walk root; confirm new top-level src dirs aren't excluded.
    — anchor: test/lib/sky/lazyContract.test.ts; DECISIONS 2026-08-03 Phase A.
12. Contract strings stay compatible (Hyrum's law): URL hashes (`#p=`, `#f=`, `&t=`, future
    `&sky=`), localStorage keys (`ftw:*` prefs read-old-keys on rename), DEV seams (`__globe`,
    `__quality`, …) DEV-gated, collection field names, R2 tileset layout/versions. Any change is
    parse-tolerant both ways + gets a dated DECISIONS line.
    — check: diff hash/prefs parsers since baseline for tolerance (old links must not throw);
    `grep -rn "window.__" src/` → all inside `import.meta.env.DEV` gates.
    — anchor: lib/geo/urlPose.ts; lib/prefs.ts read-old-keys precedent (Phase C);
    conventions/contracts.md once authored (first-audit deliverable).
13. Degrade-path visibility (Murphy): every catch-and-continue fallback emits a `console.warn`
    naming what degraded (8k upgrade fetch, TUS→warning, SBDB proxy, tile overlay retry, HEIC
    fallback) — a silent fallback is a regression that stays invisible.
    — check: `grep -rn "catch" src/lib/ src/components/globe/ -A2` triaged: continue-paths show
    the warn (or a UI surface).
    — anchor: baseEarth 8k catch pattern; epistemic dark-latch lesson (imported 2026-08-13).
14. Styled hidden-able elements pair with an explicit `.x[hidden]{display:none}` (an author
    display beats the hidden attribute); visibility checks in verify scripts read RENDERED
    GEOMETRY, never the `hidden` property.
    — check: `grep -rn "hidden" src/pages/ src/components/ src/styles/` → each styled [hidden]
    carrier has the rule.
    — anchor: DECISIONS 2026-08-13 (m-banner trap).
15. No unbudgeted heavy work enters the frame loop (Tesler/C1: irreducible cost goes to Workers,
    bakes, or time-sliced scans): new per-frame scans follow the planFeed idiom (N bins + M
    meshes per frame, epoch invalidation).
    — check: read new step-loop additions in StylizedTiles since baseline; each names its budget.
    — anchor: scene/planFeed.ts (step 40); C1.
16. Dead / duplicated code: no orphaned exports, deleted-feature remnants (e.g. removed
    grow-on-zoom class helpers), or copy-pasted math that `lib/` already owns (WGS84/SUN consts
    stay deduped).
    — check: Track E tool output (knip/ts-prune/jscpd) triaged here; `grep -rn "WGS84_A ="
    src/` → one definition.
    — anchor: 2026-07-10 refactor (WGS84+SUN dedup); Track E.
17. InstancedMesh lifecycle (appended 2026-08-13, audit #1 re-mine): every instance-count /
    matrix change sets `mesh.boundingSphere = null` (three caches the empty count=0 sphere and
    every later raycast early-outs forever); `instanceMatrix.needsUpdate` rides the same write.
    — check: `grep -rn "InstancedMesh" src/components/globe/` → each mutation site shows the
    boundingSphere reset (or cites the helper that owns it).
    — anchor: DECISIONS §Traps "Stale InstancedMesh.boundingSphere" (Phase 5.1).
18. CSS containing-block traps (appended 2026-08-13, audit #1 re-mine): no `position:fixed`
    element renders inside a `backdrop-filter`/`filter`/`transform` ancestor (those create a
    containing block — the popup becomes panel-relative); fixed popups portal outside.
    — check: `grep -rn "position: *fixed" src/styles/` → for each, confirm no backdrop-filtered
    ancestor in its mount path (read the owning component).
    — anchor: DECISIONS §Traps "backdrop-filter containing block" (S3).
19. FPV / disabled-controls invariants (appended 2026-08-13, audit #1 re-mine): any mode that
    sets `controls.enabled = false` calls `controls.adjustCamera(camera)` every frame (the
    near/far fit is skipped when disabled — frozen planes black-screen at street level); FPV
    walk displacement stays a WORLD-SPACE offset mutated only by key-holds (never re-derived
    from the current look basis — the pivot-ellipse bug class).
    — check: read the FPV blocks in StylizedTiles (`stepFpvPose`, entry/exit sites): adjustCamera
    present; walk offset is a Vector3 integrated at key time.
    — anchor: DECISIONS §Traps "GlobeControls.update() skips near/far" (S2); 2026-08-11
    fpv-walk-orbit fix (mem:bugs/fpv-walk-orbit).
20. Mirror-never-seats (appended 2026-08-18, audit #2 re-mine): a panel/store MIRROR (low-cadence,
    quantized, lifecycle-gated — e.g. the plan-store anchor: `PLAN.mirrorEveryFrames` ≈ 5 Hz,
    focus quantized 0.05°, `!build && !open → return` strands the last value) is NEVER a per-frame
    geometric seat — per-frame GL geometry resolves its anchor LIVE at orchestrator level (photo
    placement > tempPin > THIS-frame `_focus`). Deadbands may gate EXPENSIVE recompute (the ~145
    ephemeris calls), never the geometric seat write — the U4 cone seat riding the 0.02° ephemeris
    deadband lagged ~2 km behind the camera.
    — check: grep scene modules' step*/frame paths for plan/find/panel store reads used as
    positions/anchors → each is a readout mirror or cites its live resolve.
    — anchor: DECISIONS 2026-08-18h (aim-cone lag + stranded FPV anchor); 2026-08-18f
    (deadband-seat browser-caught bug).
21. Raw-focusHit pan math (appended 2026-08-18, audit #2 re-mine): camera pan/reframe deltas
    subtract the RAW `focusHit`, never `_focus`, anywhere a focus-lock can be active — the
    temp-pin focus-lock overrides `_focus` to the pin, zeroing the delta (the centerOnly flight
    degenerated to a rotate-in-place, tilt +19.7°).
    — check: read `_focus` consumers in StylizedTiles camera/pan/flight paths → each names
    whether it needs the locked focus or the raw hit.
    — anchor: DECISIONS 2026-08-18i (centerOnly pose-preserving pan, probe-caught).
22. 3d-tiles-renderer version-coupled internals (appended 2026-08-18, audit #2 re-mine): on the
    installed 0.4.28, tile fields live on `traversal.*`/`internal.*` (pre-0.4 `__dunder`s are
    GONE); queue comparator contract is "return 1 ⇒ a runs FIRST" (items.sort then pop) and
    comparators stay TOTAL over non-tile items (processNodeQueue reads
    `downloadQueue.priorityCallback` dynamically); `loadAncestors=false` ALONE flips a renderer
    onto `distancePriorityCallback`. Any lib upgrade re-verifies these against the installed
    source, not docs.
    — check: grep `traversal\.` / `\.internal\.` / `priorityCallback` sites in src/ → each cites
    the 0.4.28 contract; comparator tests cover non-tile items.
    — anchor: DECISIONS 2026-08-18g (source-verified library facts);
    mem:project/wip-2026-08-18-u5-loading crib.
23. Injected-GLSL uniform declaration (appended 2026-08-21, QA-batch re-mine): adding a uniform
    to a scene module's JS `uniforms` object is NOT enough on injected/chained shaders — the
    fragment-HEADER injection must DECLARE each uniform explicitly; a missing declaration makes
    the new program fail compile while tiles keep rendering with the PREVIOUS program, so live
    uniform pokes silently no-op (cost ~40 min in QA-7a: gain/fade/photo all "inert").
    — check: for every uniform in imageryGround/buildingMaterial-style injected GLSL, grep the
    header-injection block for its declaration; a JS-only uniform is a FAIL.
    — anchor: DECISIONS 2026-08-21g; mem:project/wip-2026-08-21-owner-qabatch7 §Traps.
24. Per-frame writers of construction-time values (appended 2026-08-21, QA-slice-C re-mine): a
    per-frame writer that resolves an EXPENSIVE construction-time value (overlay composite px,
    LRU rebuild paths, fresh-instance plugin swaps) must be STICKY/monotone — a two-way resolver
    that restores on a mode flip is a rebuild LOOP (QA-7b: overlay rebuild storm on every
    2D↔FPV flip, white chart 10 s+ on device). "Flips are rare" is not a cost argument; treat
    any value change on a mode flip as happening at interaction rate.
    — check: grep step*/frame paths for set*/rebuild calls whose argument depends on a mode
    flag (flat/fpv/tier) → each is a no-op-on-same-value AND monotone or attach-time-fixed.
    — anchor: DECISIONS 2026-08-21g regression + 2026-08-21h fix (stickyOverlayPx);
    mem:project/wip-2026-08-21-owner-qabatch7 §REGRESSION.
25. Event-swallow and shared-CSS lifecycles (appended 2026-08-21, batch #4/#5 re-mine): an
    element-level click swallow DIES with its element (unmount retargets the trailing click to
    whatever chrome is underneath — use a document-level capture swallow, short-fused); deleting
    a CSS selector from a SHARED rule can orphan the surviving selectors onto the wrong rule
    (the .md-rate deletion left .md-date on the invert rule — whole input inverted).
    — check: grep stopPropagation/preventDefault swallows near unmount paths → document-capture
    or justified; any CSS rule deletion in the diff re-reads the FULL selector list it touched.
    — anchor: DECISIONS 2026-08-21b (S1 long-press login-nav bug); 2026-08-21d item 5.

26. Screen-edge ownership, on BOTH shells, before adding a surface (appended 2026-08-22,
    audit #3 re-mine — this cost TWO collisions in one session). Before pinning anything to a
    viewport edge, enumerate what already owns that edge in each shell. **The shells are not
    symmetric**: `/m` has no page-level chrome, desktop does. Real failures: a new map
    attribution bar drew straight on top of `index.astro`'s existing `.map-credit`, whose
    source list was a strict SUPERSET of it (two overlapping lines); and moving the `/m` PiP
    up one rung put its transparent hole over the status strip, which then showed through it.
    — check: for a new fixed/absolute edge surface, an enumeration of that edge's existing
    occupants per shell exists in the commit or the comment.

27. A z-index cannot lift a child out of its parent's stacking context (appended 2026-08-22,
    audit #3 A1-2). If element A must paint above element B and A is a descendant of a
    positioned/z-indexed ancestor, raising A's own `z-index` does NOTHING — the whole subtree
    is composited at the ancestor's level. Real failure: the map's ◉ RE-CENTRE button (inside
    the z-20 `.mw`) was occluded by the z-24 FPV altitude column; the fix had to be
    **geometric** (a `min()` floor derived from the column's published geometry tokens), or
    else move the element out of the ancestor entirely (the sibling-not-child pattern the
    attribution bar uses to escape `.mw`'s transform). Reaching for `z-index` first is the
    trap. — check: any new "must paint above" requirement names the stacking context both
    elements resolve in.

28. When a shared offset token is introduced, sweep EVERY surface anchored to that edge
    (appended 2026-08-22, audit #3 A1-15). Introducing `--mw-credit-h` and lifting the two
    surfaces named in the spec left a third — the TimeReadout, deliberately co-axial with the
    scrub rail — unlifted, splitting two instruments that are specified to share an axis. The
    sweep is mechanical: grep every `position: fixed|absolute` block with a `bottom:`/`top:`
    declaration for that edge, in both shells, and decide each one explicitly.
    — check: the commit that adds an offset token lists every edge-anchored surface and its
    lift/no-lift decision.
