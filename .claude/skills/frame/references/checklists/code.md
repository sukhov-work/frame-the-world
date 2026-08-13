# Track A — Code + engine invariants (GL / three.js / stores / workers)

Format: one assertion per item, then `— check:` (grep / tool / read) and `— anchor:` (doc§ or
dated ruling). Authored 2026-08-13 from DECISIONS §Traps + conventions; re-mine DECISIONS since
the baseline anchor at every audit start and append dated items.

TOC: 1 client:only · 2 worker decode · 3 float32 ECEF · 4 heightAt clamp · 5 renderOrder/points/
additive · 6 color-space traps · 7 tuning contract · 8 shared building material · 9 store seams ·
10 per-frame writes · 11 lazy contract · 12 contract strings · 13 degrade visibility ·
14 hidden-attr CSS · 15 frame-loop budgets · 16 dead/duplicated code · 17 instanced-mesh lifecycle ·
18 CSS containing-block traps · 19 FPV disabled-controls invariants

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
   new panels' store calls are reads + documented writers only.
   — anchor: conventions/architecture-and-patterns.md (globe⇆React seam); MOBILE_PLAN §2.
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
