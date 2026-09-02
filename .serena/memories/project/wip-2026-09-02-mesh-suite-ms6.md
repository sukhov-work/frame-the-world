# WIP 2026-09-02m — MESH SUITE MS6 (D3 management + world edit on the §10 record) — BUILT + browser-verified

**Status: BUILT; vitest 2,428/2,428 (162 files) · astro 0/0/8 · knip 0 · `verify-usermodels` PASS 18 legs
on the final tree · `verify-bldg-override` PASS · `verify-modelupload` 8/8. The MESH SUITE ladder MS0–MS6
is COMPLETE; next = T77.** Mode: implement (design-first, investigate-design-v3 spine
on `/frame`), tier Deep. Canonical: `.claude/claude-docs/MESH_SUITE_PLAN.md` **§13 (MS6 as-built)** ·
§3 ladder · §5 recipe. Prior: `mem:project/wip-2026-09-02-mesh-suite-ms5b` · `…-ms5`. Backlog T74
(ladder complete) · **T77 NEXT** (the architecture + performance audit). DECISIONS 2026-09-02m.

## Session facts (boot)
- MS5b landed as PR #96 (`0efea4b`) at 21:28 — the `/clear` ship fired at session start; read-only
  until "local checkout back on master" (the MS3 rule held).
- Four parallel research agents (platform/API/record · scene/orchestrator · UI/stores/list precedents ·
  verify/tests/docs), 88–90 %; the cruxes re-read by hand (the scene's row diff, the PATCH gate,
  `items.get` typing). Baseline: vitest 2,411 (run 1 had ONE flaky red under `astro check` CPU load).

## The design that shipped (full text plan §13.1)
- **World edit = the PATCH opened to every member, LWW structural** (`items.update` replaces the whole
  row by `_id`) — NOT the MS3 sync machinery (one row per model, server-first since MS4). Transform
  only (MOVE/ROTATE/SCALE; RESET ALL allowed); hide/title/delete stay the owner's.
- **PATCH dispatches on the body's shape**: coordinates → placement (any member; 404 "no such model";
  stamps `editorMemberId` — NEW provisioned TEXT field, 26 fields, LIVE 2026-09-02m); no coordinates →
  management `{ id, title? 1–120 trimmed, hidden? }` (owner-only). Answer `{ own, model, public }` —
  the owner-shaped list row only to the owner; `PublicModel` byte-identical (no identity); the list
  row gains `updatedAt` + `editedByOther` (derived; the GUID reaches nobody).
- **Arming gate = member phase**; `armed.mine` = the YOURS / SHARED badge (`data-origin="mine"|"shared"`,
  the MS3 CSS rule for shared reused; menu head " · shared"). A foreign commit swaps the public row
  into `world` only (`commitPlacement` was prepending into `mine` unconditionally).
- **MY PINS · MODELS tab** (`panels/MyModelsTab.tsx`, props view + connected wrapper; the panel's
  member gate, Escape, drag, scroll, row anatomy, two-press delete reused): our thumbnail / glyph ·
  title · `w × d × h m · N TRIS` at the committed scale · badges HIDDEN / PROCESSING / FAILED / NOT
  PLACED / EDITED · ✎ rename inline (Enter/Escape, stopPropagation) · HIDE/SHOW · ✕ → SURE?; the foot
  says hidden models leave the world, not the link. Rows come from `store/userModels.mine`
  (`loadMine()` on open); `rename` / `setHidden` / `remove` swap `mine` + `world` at once (`swapOwn`).
- **"Fly to it" = stand beside it in FPV**: `modelStandpoint` (pure, `lib/models/modelPlacement`,
  `STANDPOINT` eye 1.7 / fov 60 / 3 × longest scaled extent in 6..120 m, pitched at mid-height);
  the list uses heading 0, the orbit click the camera heading (`standBesideModel` in the orchestrator).
- **Orbit hover + click** (orchestrator only): `stepUserModels` picks under the resting pointer at
  `PINS.hoverEveryFrames` when not FPV / not placing / no button / no pin hovered; label on the
  `bldgEditLabel` hover slot; pointer cursor with hand-back; a left click stands beside it (before the
  pin pick); a dblclick on a model never drops a temp pin. `pickModelAt` lost its FPV gate.
- **Disarm on vanish**: `stepUserModels` disarms when `userModels.info(id)` is null (hide/delete).
- **Two-member harness leg rides `/api/dev-seed`** (DEV-gated): `POST kind:"model"` inserts a
  `UserModels` row owned by `yevhens@wix.com` reusing the stored GLB url; `GET ?kind=model` lists that
  owner's rows (to read `editedByOther`); `DELETE ?kind=model&id=` removes the ROW only.
- **Haze + FPV-dissolve chaining on GLB materials** (`MODELS.chainShader` ON, plan §13.2): ONE named
  `patchModelShader` chained (never assigned) onto every loaded material — three's program cache key is
  `onBeforeCompile.toString()`; holder uniforms `uFtw*` DECLARED in `<common>` (an undeclared bound
  uniform fails silently); `ftwAerial` after `<opaque_fragment>`; the BUILDINGS-slider screen-door at
  `<color_fragment>` (`uFtwModelAlpha` 0.28 + 0.72 k); `setUltraHaze` / `setSolidity` pushed beside
  the building sets; `debug().shader` for the harness; a console gate fails the run on shader errors.
- **A model under the pointer wins the hover-note slot** over an edited building behind it (the
  right-click precedence applied to the note — found by harness run 2).
- **NOT built**: the lift seat (owner undecided; needs a live field — the chain is plan §13.4).

## Files
`scripts/provision-collections.mjs` (`editorMemberId`, RAN live) · `lib/wix/modelRecords.ts`
(`editorMemberId`, `ManageBody`/`parseManageBody`/`applyModelManage`/`isPlacementPatch`/`MODEL_TITLE_MAX`,
`ModelPatchAnswer`, `ModelListItem.updatedAt/editedByOther`, `applyModelPlacement(…, editor)`) ·
`pages/api/models.ts` (PATCH split, `patchAnswer`) · `pages/api/dev-seed.ts` (model seed/list/delete) ·
`lib/save/uploadMedia.ts` (`patchModelMeta`, `deleteModelRecord`, answer type) · `store/userModels.ts`
(`patchMeta`/`deleteModel` wire, `swapOwn`, `rename`/`setHidden`/`remove`, ownership-aware commit) ·
`store/modelUpload.ts` (addMine literal) · `lib/models/modelPlacement.ts` (`modelStandpoint`, `STANDPOINT`) ·
`StylizedTiles.ts` (gate, orbit hover/click, `standBesideModel`, disarm-on-vanish, seam `standBeside`) ·
`panels/ModelEditChip.tsx` (badge, `MODEL_ORIGIN_TITLE`) · NEW `panels/MyModelsTab.tsx` · `panels/MyPins.tsx`
(4th tab) · `panels/ModelUploadStep.tsx` (`startModelPlacement`) · `styles/my-pins.css` · guide
(`fpv-models` reworded, NEW `my-models`) · tests: modelRecords +5 · store/userModels +3 · modelEditChip +1 ·
modelPlacement +2 · NEW `test/components/myModelsTab.test.ts` (5) · `scripts/verify-usermodels.mjs`
legs 11–17 (+ cleanup 18) · docs: plan §13 · contracts §4/§7 · wix-headless §9 · ARCHITECTURE §6/§7 ·
globe-tuning MODELS · backlog T74/T77.

## Verification receipt
- Unit: vitest **2,428/2,428 (162 files)** (baseline 2,411/161) · `astro check` 0/0/8 (run with the dev
  server STOPPED — the dep-cache trap) · knip 0. Live: `+ UserModels.editorMemberId field added` (26).
- Browser (`verify-usermodels.mjs`, headless Chrome :9333, `wix dev`, Dnipro pose, the LIVE collection):
  **PASS 18 legs** (run 4): legs 1–10 as MS5b (seated 19.54 m real, materials CHAINED haze 0 / alpha 1,
  menu open at press, ROTATE 84.5°, SCALE 3.104×, MOVE 0.79 m, orbit drag 245.1 m with 0 gizmo hits +
  control 18/21, reload, anonymous, MDL, click-to-place 628 m) · 11 the MODELS tab row `9.31 × 9.31 ×
  15.5 m · 12 TRIS`, no badges, ✎ HIDE ✕, tab `MODELS · 1` · 12 rename → own list + world read + scene
  agree, no reload · 13 HIDE out of the world read + scene at once (badge + foot note), SHOW back ·
  14 stood 46.6 m south (≈ expected), heading 0, model on screen · 15 the DEV-seeded FOREIGN model: not
  in MINE, hover note without "yours", real right-click ARMED it as SHARED, ROTATE 79.0° landed (LWW),
  the owner's row EDITED by another member, seed removed · 16 orbit hover (cursor pointer, note) + click
  stood 46.6 m away in FPV · 17 the list's ✕ → SURE? deleted it (row + media) · console: no shader
  error. Runs 1–3 = harness-environment reds, each fixed: a missed handle press (flaky) · the hover
  slot lost to an EDITED building behind the model → the precedence rule · the "no button held" gate
  stuck by the harness's synthetic welcome press (no release) → dropped (the pins have none).
- Smokes: `verify-bldg-override` PASS · `verify-modelupload` 8/8 on a re-run with cookies cleared (its
  first run's anonymous leg read a MEMBER cookie leaked by the new list-delete cleanup path — fixed:
  `clearCookie()` on every path). NOT re-run: the wider §4a-4 sweep (the only scene change is the
  chained model shader — inert with no model resident).

## Traps (new)
- Python edit scripts: derive needles from `repr()` of the real lines — an awk `$1=$1` reprint collapses
  whitespace and every needle then misses.
- `formatTris(84000)` prints `84.0K` — the list's fact line says `84.0K TRIS`.
- Never edit `src/**` while a CDP harness runs against `wix dev` — HMR reloads the page mid-leg.
