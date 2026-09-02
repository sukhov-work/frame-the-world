# WIP 2026-09-02h — MESH SUITE MS4 (D3 upload pipeline) — BUILT

**Status: MS4 BUILT + browser-verified against the LIVE `UserModels` collection (cleanup proven).**
Mode: implement (design-first, investigate-design-v3 spine on `/frame`), tier Deep. Canonical:
`.claude/claude-docs/MESH_SUITE_PLAN.md` **§9 (MS4 as-built)** · §3 ladder (MS4 BUILT) · §5 recipe
(next = MS5) · §1 platform bullet (the thumbnail claim FALSIFIED). Prior:
`mem:project/wip-2026-09-02-mesh-suite-ms3`, `…-ms2`, `…-ms0-ms1`, `…-09-01-mesh-suite-plan`.
Backlog T74 (advanced) + NEW T76. DECISIONS 2026-09-02h.

## The design that shipped (full text §9.1)
- **Fork in the dropzone**: `classifyDrop` (pure) — any `.glb/.gltf/.obj/.fbx` in a drop → the
  model path, companions by basename (blob-URL `LoadingManager.setURLModifier`), extra model files
  ignored; no model → the photo path byte-identical (`files[0]`). `ACCEPT` += model exts + `.bin,.mtl`;
  input `multiple`; chips + copy grew "3D model".
- **SEPARATE `store/modelUpload.ts`** (17 modules read the photo store, 15 branch on its phase —
  untouched): `idle → loading → inspecting → decimating? → packing → review → uploading → stored`,
  `error` = named refusal back on the dropzone. Shares only `open` + the UPLOAD HERE seed (consumed
  at review, temp pin retired). Binary state (scene, GLB, thumbnail blob) in MODULE scope. Injectable
  `ModelPipeline` (`_setModelPipeline`) — the unit tests drive a fake; the default is ONE lazy import
  of `lib/models/normalizeModel.ts`.
- **Pipeline (main thread — recorded [ASSUMPTION]; FBX textures need `<img>`)**: GLTFLoader (+
  embedded-wasm `MeshoptDecoder`) / OBJLoader+MTLLoader / FBXLoader → `inspectModel` → `MODEL_CAPS`
  audit (100k tris · 2048² · 8 textures · 25 meshes · 15 MiB raw · 8 MiB GLB; raw gate BEFORE parse)
  → over-budget DECIMATED (`decimationPlan` proportional; MeshoptSimplifier `LockBorder` over error
  rungs 0.01/0.05/0.25/1; attribute COMPACTION; multi-material/drawRange meshes locked → else
  `TOO_MANY_TRIS`) → `GLTFExporter.parseAsync({binary, maxTextureSize, onlyVisible})` on a
  2048→1024→512 ladder until ≤ 8 MiB (untextured judged once) → `renderThumbnail` (disposable
  `WebGLRenderer` on an OffscreenCanvas, `alpha:true`, no setClearColor — fenced) → REVIEW. Units:
  `suggestUnit` (raw ≤ 600 → m · ≤ 60 000 → cm · else mm), baked into `root.scale` at pack;
  `rawSize` divides the root scale back out on re-inspect. DRACO/KTX2 → `UNSUPPORTED_COMPRESSION`.
- **Platform**: `/api/upload-url` kind:"model" = the FIRST server-side mime allowlist —
  `checkModelUploadRequest`: ONE mime (`model/gltf-binary`), sanitized `.glb` (`safeModelFileName`),
  1..8 MiB, `private:false` (private 3D refused — MS0), `filePath: "/plux/models"` (VERIFIED: the
  descriptor's `parentFolderId` = `f204ebecab51489e92ea8e9af543ae9d`). **`UserModels` PROVISIONED
  (24 fields, ADMIN everything)**: `title ownerMemberId fileId url thumbnailFileId thumbnailUrl
  fileName sourceFormat rawBytes glbBytes tris meshes textures decimatedFromTris bboxX/Y/Z readiness
  hidden lat lon geohash9 rotDeg scale`. `/api/models`: GET own (page 200) · POST (`parseCreateModelBody`
  → dup-by-fileId → `files.getFileDescriptor` elevated → `verifyModelDescriptor` (public GLB-typed
  MODEL3D under cap, https url; codes NOT_A_MODEL/WRONG_MIME/PRIVATE_FILE/TOO_LARGE/NO_URL/
  INGEST_FAILED) → optional `thumbnailFileId` → `verifyThumbnailDescriptor` (public IMAGE ≤ 2 MiB)
  → insert) · DELETE (row, then `bulkDeleteFiles([fileId, thumbnailFileId])`, `mediaDeleted`).
  Re-POST same fileId → `existing: true`; other member's → 409. NO quota.
- **FINDING: the platform's MODEL3D thumbnail URL is a permanent 403** (`static.wixstatic.com/
  media/<hash>.png`; plain/UA/referer/`v1/fill` alike; a day after upload; `preview.status: READY`).
  The MS0 "free 256² preview" was inferred, never fetched. → the client uploads OUR rendered PNG via
  `uploadPreview(blob, name, "image/png")` (mime param added) and the record stores ours.
- **UI** (`panels/ModelUploadStep.tsx`): PROGRESS card → CHECK card (thumbnail, 6 facts, SOURCE
  UNITS chips + GUESSED badge, TITLE, warnings, `UPLOAD MODEL` / `SIGN IN TO UPLOAD` link /
  `CHECKING SIGN-IN…`, honest hints: public by URL; sign-in reloads) → STORED card (local
  thumbnail first; `UPLOAD ANOTHER` / `← GLOBE` clears). Header steps `1 UPLOAD · 2 CHECK · 3 STORE`.
  CSS appended to `upload-flow.css` (`.uf-preview--model`, `.uf-units`, `button.uf-chip`,
  `.uf-title__input`, `a.uf-btn`).

## Files
NEW `lib/models/modelCaps.ts` · NEW `lib/models/normalizeModel.ts` · NEW `lib/models/three-examples.d.ts`
· NEW `lib/wix/modelRecords.ts` · NEW `pages/api/models.ts` · `pages/api/upload-url.ts` ·
`lib/save/uploadMedia.ts` · NEW `store/modelUpload.ts` · NEW `panels/ModelUploadStep.tsx` ·
`panels/UploadFlow.tsx` · `styles/upload-flow.css` · `global.d.ts` · `scripts/provision-collections.mjs`
· `conventions/contracts.md` §3/§4/§7 · `conventions/wix-headless.md` §9 · ARCHITECTURE §7 routes ·
tests NEW `test/lib/models/modelCaps.test.ts` (18) · NEW `test/lib/wix/modelRecords.test.ts` (18) ·
NEW `test/store/modelUpload.test.ts` (19) · NEW `scripts/verify-modelupload.mjs`.

## Verification receipt (fresh)
- Unit: vitest **2,367/2,367 (156 files)** (baseline 2,312/153) · `astro check` 0/0/8 · knip 0.
- Browser (`verify-modelupload.mjs`, headless Chrome :9333 fresh profile, `wix dev`, Dnipro FPV
  pose): **8/8** — small GLB → CHECK in 1.7 s (6,240 tris exact, 178 KB) · 159,200-tri textured
  sphere → decimated to exactly 100,000 in 0.8 s, texture kept, 2.7 MB · OBJ+MTL cm guess → M
  re-pack (3,000 m) · 16 MiB refused pre-parse, zero /api · anonymous SIGN IN link + 401 · member
  allowlist 400s + sanitized mint + bogus 404 · upload → STORED READY in 11.2 s, listed with facts +
  seed, served `model/gltf-binary` ACAO `*`, generator `THREE.GLTFExporter r185`, POSITION 50,999 of
  80,601 (compaction on the stored bytes), our thumbnail `image/png` in 270 ms (platform's 403),
  re-POST existing, `/plux/models` folder · DELETE → `mediaDeleted: true`, GET clean.
- `verify-bldg-override` PASS. `verify-pin-reframe` RED identically on bare master (stash
  comparator: `heightAt(pin) −2047`, `loaded=false`) → PRE-EXISTING → **T76**.

## Traps (new)
- `.setClearColor(` is fenced repo-wide (`fences.test.ts`); `alpha:true` clears transparent anyway.
- `Box3.setFromObject` includes the root's own scale → divide it out after `applyUnitScale`.
- A `File` in vitest keeps `size` = content length → `Object.defineProperty(f, "size", …)`.
- Killing the `wix dev` CLI pid leaves the `astro dev` LISTENER alive on :4321 — kill that pid.
- CDP `DOM.setFileInputFiles` (node id via `DOM.querySelector`, absolute paths) fires React's
  `onChange` → the whole dropzone fork is testable headless.
- The platform's media-derived URLs must be FETCHED to be believed (the 403 thumbnail).

## Taste calls surfaced (not decided)
Main-thread pipeline · unit thresholds · ladder floor 512² · locked multi-material meshes refuse
rather than split · sign-in reloads and loses the packed model · MS3 calls still open.

## Next
MS5 = D3 placement: public world read (geohash-prefix on `geohash9`, strip `ownerMemberId`, skip
hidden / non-READY) · `scene/userModels.ts` · click-to-place + seed placement · MS2 gizmo for the
fit (PATCH rotDeg/scale) · MDL chip ON by default · density warning. MS6 = my-uploads list (thumbs
are ours) · hide/delete/title · user-mesh transforms through the MS3 sync machinery.
