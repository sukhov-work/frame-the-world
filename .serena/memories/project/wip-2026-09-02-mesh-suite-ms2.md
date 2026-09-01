# WIP 2026-09-02d — MESH SUITE MS2 (the gizmo UI) — BUILT + browser-verified

**Status: MS2 BUILT.** Mode: implement (design-first, investigate-design-v3 spine on `/frame`),
tier Deep. Canonical: `.claude/claude-docs/MESH_SUITE_PLAN.md` **§7 (MS2 as-built)** · §6 (MS1) ·
§3 ladder (MS2 row BUILT). Prior: `mem:project/wip-2026-09-02-mesh-suite-ms0-ms1`,
`mem:project/wip-2026-09-01-mesh-suite-plan`. Backlog T74 (state updated). DECISIONS 2026-09-02d.
Also this session: the CHERNOBYL retirement slice (owner memo 2026-09-02c) — see below.

## The design that shipped (full text §7.1)
- **The proxy IS the ghost rig**: `anchor` (Group under the cell mesh, ENU frame — +X east /
  +Y up / −Z north — carries the translation) + child `body` (the ghost mesh: yaw + scale, XZ
  inflated). MOVE attaches three's `TransformControls` to the anchor, ROTATE/SCALE to the body.
  `rigToTransform` (featureTransform.ts) = the exact inverse of the engine's `placeGhost`
  (`transformToRig` pins the pair); `clampGizmoEdit` (bldgOverrides.ts) = rails + the U8
  per-edit 0.5×/3× band on EVERY scale axis; the clamped value is written back to the rig so a
  handle stops at the rail. Yaw is read from the quaternion (`2·atan2(qy,qw)`), never Euler.
- **No DOM listeners on the controls** — constructed without a domElement; the FPV handlers FEED
  `pointerHover/Down/Move/Up({x,y,button})` (button −1 for moves, 0 for down/up). One gesture
  table (look-drag, pinch, U8 claim, gizmo); /m gets the gizmo for free. `space:"local"` = ENU.
- **No camera layer**: GlobeControls is disabled throughout FPV (the only place a building can
  be armed). Visible gizmo/helper meshes get a no-op raycast — the PICKERS and the drag PLANE
  keep theirs (the plane is a helper child too: no-op it and every drag silently moves nothing —
  browser-caught).
- **EXTRUDE = the U8 drag verbatim and the default op on arm** (§4a-1 byte-identical). In a
  spatial op an off-handle drag is a look-around; a tap still disarms; a handle drag previews on
  the ghost body (visible only while dragging) and COMMITS on release via `commitBldgTransform`.
- Entry points: right-click / long-press a building (arms it, another re-targets, opens the
  context menu at the press point — `.skymenu` cut) · the chip's op strip · G / R / S / E while
  armed (S shadows walk-back for the armed session — [ASSUMPTION], owner may prefer 1/2/3/4) ·
  Shift = snap (1 m / 15° / 0.1×). Escape rungs: menu → cancel a live drag → disarm → FPV unwind.
- Chip: one row per op (current · original · ↺ when edited) + RESET ALL; the pinned label adds an
  op line (metres E/N/↑, COMPASS-sense yaw = −rotDeg, XZ scales). Op ownership: MOVE tE/tN/tU ·
  ROTATE rotDeg · SCALE sx/sz · EXTRUDE sy (`opIsEdited`/`revertOp`, store/bldgEdit.ts).
- Lift rail twice: `minY/maxY` on the anchor (parent space = bake-local: base .. base+LIFT_MAX_M)
  + `clampGizmoEdit`. The rig is re-placed from the committed target every frame between drags
  (rides the easing seat), re-created when an evicted cell streams back, released before hideGhost.

## Files
`scene/bldgGizmo.ts` (new) · `scene/enrichedBuildings.ts` (rig; `showGhost(…, bodyVisible)`,
`setGhostTransform`, `setGhostBodyVisible`, `ghostRig()`, ghost seeds from TARGET,
`featureState.seated`) · `scene/bldgEditLabel.ts` (op line) · `StylizedTiles.ts` (op state,
`applyBldgOp`/`finishGizmoDrag`/`revertBldg`, pointer routing, contextmenu + long-press entry,
G/R/S/E, Escape rungs, `stepBldgEdit`, DEV `__globe.bldgGizmo()` incl. `handlePx/originPx/debug`)
· `store/bldgEdit.ts` (ops, `committed`/`live`, `revertRequest`/`menu`/`disarmRequest`,
`requestReset` kept for the U8 harness) · `panels/BuildingEditChip.tsx` (island → pure
`BuildingEditChipView` + `BuildingEditMenu`) · `styles/building-edit.css` ·
`lib/globe/featureTransform.ts` (`yawDegFromQuaternion`, `rigToTransform`/`transformToRig`) ·
`lib/globe/bldgOverrides.ts` (`clampGizmoEdit`) · `tuning.ts` (`ENRICHED.gizmoSize` 0.8,
`gizmoSnapM/Deg/Scale`) · tests: featureTransform +5, bldgOverrides +5, `test/store/bldgEdit`
(new, 9), `test/components/buildingEditChip` (new, 6) · `scripts/verify-meshedit.mjs` legs 7–14.

## Verification receipt
- Unit: vitest **2,284/2,284 (151 files)** (baseline 2,259/149) · `astro check` 0 err / 0 warn /
  8 hints.
- Browser (fresh headless Chrome :9333, wix dev, Dnipro-o2w FPV pose): **`verify-meshedit.mjs`
  14/14 legs PASS** — menu→MOVE · a REAL X-arrow drag commits −9.41 m E (row agrees, camera
  pinned, chip readout, label op line) · off-handle drag looks around (yaw 0 → −17°) with the
  building untouched · R ring drag → 84.2° · S box drag → sx 3.000 (band held) · per-op ↺ ·
  Esc mid-drag cancels · RESET ALL → identity/row gone/fast path · DONE disarms. Shots
  `verify-shots/meshedit-04..06`.
- §4a-4 sweep: see DECISIONS 2026-09-02d (recorded at session end).

## Traps (new, all browser-caught this session)
- **A no-op raycast sweep over "every non-picker helper mesh" takes the DRAG PLANE too** — the
  plane is a plain Mesh child of the helper root; without its raycast `pointerDown/Move` never
  get a plane point and the drag moves nothing while `dragging` reads true. Scope the no-op to
  `_gizmo.gizmo[*]` + `_gizmo.helper[*]`.
- **The rig rides the building, the building rides its terrain seat**: the RC7 drain lands a
  feature's first sample seconds after boot and the run can drop by the cell's relief (47 m seen)
  — a harness that presses a projected handle must wait for `featureState.seated` + a still rig
  base. Correct UX (the gizmo follows the building), stale screen point otherwise.
- **`handlePx` for the rotate ring**: the picker torus's bounding-sphere centre is the HOLE; the
  farthest projected vertex is the tube's outer SILHOUETTE where a ray only grazes — pull it to
  the centre-line (0.5/0.6 of the outer radius; three's `TorusGeometry(0.5, 0.1, …)`).
- **zustand 5 serves a store hook its INITIAL state under `renderToStaticMarkup`** — component
  tests must render a props-driven view, not the island.
- **The /m PiP-hole guard (`mapWindowChrome.test`) takes every `.className = "…"` in scene/ for
  a new LAYER** — don't class-name a child element of a label layer.
- **`tc.dispose()` with no domElement throws** (`disconnect()` dereferences null) —
  `getHelper().dispose()` instead.
- **A 504 Outdated-Optimize-Dep after a new globe-bundle import** (TransformControls) — stop
  wix dev, move `node_modules/.vite/deps` aside, restart (the NSP trap, hit again).

## Chernobyl retirement (owner memo 2026-09-02c) — done this session
`scripts/verify-chernobyl.mjs` deleted · the Chernobyl leg dropped from `verify-bake-ladder.mjs`
· `scripts/bake/README.md` re-pointed at the ladder · T75 mechanics marked done · rosters clean.
**2026-09-02e — owner confirmed ("Yes, delete the Chernobyl region, bakes and R2 objects"):**
`regions.ts` entry removed (dated comment left; regions.test.ts needed no change) ·
`cities/chernobyl{,-o2w}.json` git-rm'd · `geoid.mjs` chernobyl grid removed · guide
`trust-detail` copy → three modelled places · DBG catalogue note → Dnipro + Everest ·
`enrichedMeta.test` fixture → dnipro-o2w · README region #4 → retirement note · R2: NEW
`scripts/bake/delete-r2.mjs` (pure SigV4; `--prefix` must end in `/`; dry-run default; lists,
deletes 6-wide, re-lists to prove zero; `s3sign.mjs` gained a canonical `query` param for the
signed ListObjectsV2) removed 146 + 150 + 1,489 objects — 0 remain. NOT done: the local
gitignored copies (`bakes/enriched/chernobyl{,-o2w}`, `bakes/terrain/chernobyl`,
`scripts/bake/.cache/o2w/chernobyl-o2w`, four `o2w-51.*.osm` extracts; ~136 MB) — `rm -rf` was
blocked by the tool permission gate twice; the owner runs it by hand. Gates after: vitest
2,284/2,284 · astro 0/0/8 · knip 0 · globe boots clean at the Dnipro FPV pose.

## Taste calls surfaced (not decided)
`TRANSLATE_MAX_M` 60 (tile culling volume not grown) · the shared party-wall post follows the
lower run under a move · three's rotate speed (20/dist: a 70 px drag ≈ 84°) and the scale gain
(a 60 px drag saturates the 3× band at street range) · the Y ring is near edge-on from a
street-level eye · G/R/S vs 1/2/3/4 keys · bloom on the gizmo at ULTRA.

## Next
MS3 = D2 activation (provisioning, boot fetch + merge, SYNC + login gate, markSynced, tint
ladder, osmId dual key) — needs MS1 fields, not MS2; the wire/collection grow by the v2 row's
spatial fields. MS5 reuses this gizmo on user meshes (attach to the model's Object3D — no rig).
