# PHOTO PROJECTION — the full desktop flow (plan, owner order 2026-10-21)

**Status: PLAN — nothing below is built.** The prototype (DECISIONS 2026-10-18, `scene/photoProjector.ts`, `store/facadePhoto.ts`,
`panels/FacadePhotoFlow.tsx`, `?facade=1`) is the base. Owner's read 2026-10-21 on his own photo in `wix dev`: *"looks promising"*.
Owner's orders, verbatim in spirit: build the FULL desktop flow per the design (triage §4), performance in mind; an efficient
low-memory way to store and display the textures — **hundreds per city, maybe thousands** — not huge, not too blurry; keep a path to
advanced alignment of the photo content with its buildings and "maybe some more advanced photogrammetry stuff"; and a UX addition:
**gizmos to move / rotate / scale the projected view** (as an alternative to the sliders), **less sensitive than the mesh flow's**, so the
texture can be positioned before SAVE and re-edited later (position + the other params).

## 1. What "full flow" means (the slices, in build order)
**Owner order 2026-10-21: the next big session does the research, then AT LEAST F1 + F2 + F3 in one go — shipped and tested — with
subagents per slice (see `NEXT_SESSION_PROMPT.md` §THE SESSION'S SCOPE for the agent split).**
| Slice | What | Reuses | Risk |
|---|---|---|---|
| F1 **The gizmo** | A move / rotate / scale gizmo on the facade frustum: translate = lat/lon (+ altitude on the vertical handle), rotate = heading / pitch / roll, scale = the H-FOV (a wider frustum IS a shorter focal — scale never stretches the photo). Sensitivity: a `PHOTO_PROJECT.gizmoGain` family at a fraction of the mesh gizmo's (`MESH SUITE MS2`, `scene/bldgGizmo.ts` + the model gizmo) — owner: "a bit less sensitive". The sliders stay as the precise twin; both write the same store fields. | `scene/bldgGizmo.ts` / the MS2 gizmo chrome, `lib/edit` (the journal for undo), `controls/**` | Low — the gizmo exists; the mapping to pose fields is new. |
| F2 **Persist** | SAVE / UPDATE / DELETE of a facade photo: a new Wix Data collection `FacadePhotos` (owner member id, the POSE `{lat, lon, altM, headingDeg, pitchDeg, rollDeg, hFovDeg}` + the gizmo delta if kept separate, `projection {strength, ownLight, rangeM}`, the Media ids (original private + the display derivative + a thumb), `cityKey` / geohash, `targetFeatureIds` (§4), `alignment` (§4, empty v1), moderation state). Writes through `jsonWriteInit`; the member's own list in a MY FACADES tab; re-open → the frustum + gizmo + panel. **Persist the pose, never a baked atlas** (triage §4 rule; C1). | `lib/save/pinBody.ts` (the pin save shape), `pages/api/photos.ts` + the Media upload path (TUS > 10 MB), `store/save.ts` | Medium — a second collection + endpoint pair; C6: facade photos are PRIVATE by default, the public tier (if ever) joins the pin moderation gate and reduced precision does not apply (a projected photo is exact by nature → public facades need explicit consent + moderation). |
| F3 **Residency** | Many photos, few live: the world query returns facade records by geohash cells around the view focus (the `pinFollow` / `userModels` cover law: the 16 km square, 5 queries per cover change — `MODELS.fpvFetchRadiusM`); each record is a MARKER (a small frustum glyph / the existing pin style) until it earns a **projector slot**: the K nearest in-view photos (K = `PHOTO_PROJECT.slots`, 4 on desktop) get a texture + a depth map; leaving the range releases the slot (LRU). Slots are the shader's uniform-block count (§3). | `scene/userModels.ts` `planResidency` / `apparentFrac` / `inViewCone`, `store/pins` viewport query | Medium — the residency planner exists for models; the slot handoff (texture load latency, the depth re-render) is new. |
| F4 **The texture pipeline** | §3 — the display derivative, its GPU form, the memory ceiling. | the decode worker, `lib/textures` | High — the design choice that decides the ceiling; research first (§3 UNVERIFIED items). |
| F5 **Alignment hooks** | §4 — the data model fields + the per-building association captured at save; no solver yet. | `vFtwFid` / `_feature_id_0`, `bldgSync`'s feature keys | Low now, the foundation for later. |
| F6 **Mobile twin** | After the desktop flow is judged. The projector is desktop-gated (`hqAllowed`); `/m` would need K=1–2 and a 1024-px derivative. | | Later. |

## 2. Performance posture (the shipped prototype's numbers + the K-slot cost)
- Prototype: ONE slot — per fragment when on: 1 depth fetch + 1 photo fetch + ~30 ALU under a uniform branch; off: one dead branch.
  Frame cost p95 16.7 vs 16.7 ms (vsync-bound). The depth map 1024×768 R8+D24 ≈ 3.9 MB; re-rendered on a pose / photo / tile change
  else every 500 ms (two layered scene traversals + narrow-frustum draws).
- K slots = K matrices (4 × mat4 + 4 × vec3 + 4 × vec4 = cheap), 2K samplers under the plain-sampler route (16 fragment units on
  WebGL2; the city material uses 1–4 today → K ≤ 6 plain; **an array texture makes it 2 samplers for any K** — §3), K depth targets
  (K × 3.9 MB), and per fragment K × (fetches + ALU) **unless a per-slot early-out skips slots whose frustum cannot contain the
  fragment** (the `ftwInside` mask already exists; hoist it to a uniform-indexed loop with `break` on the in-front test — ~5 ALU per
  dead slot). Cadence: at most ONE depth re-render per frame across slots (round-robin), the dirty one first.
- The ground, trees and user models as occluders (T168) cost one more layer each in the depth pass — add only the ground (a hill is the
  real false-positive); trees never (billboards would occlude as solid rectangles).

## 3. The texture pipeline — "hundreds per city, maybe thousands; not huge, not blurry"
> **Status 2026-10-22e (F4 BUILT — backlog T170):** lever 1 is live — ONE `DataArrayTexture` (`PHOTO_PROJECT.layerPx` 2048 square
> layers, every photo STRETCHED to the layer, K = `slots` **6**; 134 MB at K 6 on desktop per the §6 ruling), browser-probed on three
> 0.185 before the build (storage-only allocation via `source.dataReady = false`; `copyTextureToTexture` per layer ≈ 24 ms incl. the
> whole array's mips; a depth ARRAY target is unsupported → K depth samplers stay; units 3 + 1 + K). Lever 2 (KTX2) stays NO-GO for
> v1 (the 2026-10-21 measurement; ETC1S lands as 8-bpp BC7 on desktop) — revisit with F6. Lever 3 waits on F5's uv rectangle.
> The text below is the plan as written on 2026-10-21.

The ceiling is GPU memory while LIVE, and wire bytes + Media quota while STORED; the two are different problems.
**Stored (Wix Media, per photo):** the private original (as today for pins) + a **display derivative at 2048 px on the long edge,
JPEG q 80–84** (a 4:3 phone frame ≈ 350–600 KB; 1,000 photos ≈ 0.5 GB of Media — within the plan; the derivative is made client-side
at save in the decode worker from the already-decoded bitmap, so Wix does no compute, C1) + a 512-px thumb for markers / lists. Blur
check: at 2048 px a 69° frame resolves ~2 px per cm of facade at 20 m, ~2 px per 20 cm at 200 m — sharp inside the 600 m range the
prototype paints; 1024 px halves it and reads soft on a near facade (owner: "not too blurry") — keep 2048, make it a tunable
(`PHOTO_PROJECT.deriveLongEdgePx`), and let the **crop to the building** (F5) shrink what is stored later.
**Live (GPU, K slots):** RGBA8 + mips at 2048×1536 = 12.6 MB per slot (K=4 → 50 MB) — acceptable on desktop; the levers, in order:
1. **`sampler2DArray` (`DataArrayTexture`, K layers, one sampler)** — frees the sampler budget (2 samplers for photos + depths at any
   K) and keeps one program. Per-layer upload from a decoded bitmap: three ≥ r160 has `texture.addLayerUpdate(layer)` for
   `DataArrayTexture` (UNVERIFIED on 0.185 for ImageBitmap sources — verify `WebGLTextures` `texSubImage3D` with a bitmap, or upload
   through a `Uint8Array` from an OffscreenCanvas `getImageData`). Depth maps as an array: `WebGLArrayRenderTarget` with a
   `DepthArrayTexture`? (UNVERIFIED — may need K separate targets + K `sampler2D`s for depth, which is fine: K ≤ 6.)
2. **GPU-compressed textures (KTX2 / Basis UASTC or ETC1S)** — 4–6× less VRAM per slot (2048×1536 UASTC ≈ 3 MB) and a smaller wire
   payload; three's `KTX2Loader` transcodes on the client; the ENCODE side is the question: client-side `basis_encoder` WASM exists
   (UNVERIFIED speed for a 2048 frame on a laptop — seconds?), server-side encode is out (C1, no compute on Wix). Decide after a probe;
   JPEG + RGBA8 is the v1, KTX2 the upgrade when K grows or the mobile twin lands.
3. **Crop to the building** (F5): persist the uv rectangle of the photo that lands on the target building(s) and derive the
   display texture from that crop — a facade photo is mostly facade, but a street shot with sky and road halves its useful area.
4. **Mip bias / anisotropy** are already set (anisotropy 8, trilinear); `maxTexturePx` is the live cap today.
**Not this:** per-photo materials (the one-material invariant), vertex colours, baked facade atlases (triage §4; "textures" was the
owner's no for the generic city), storing full-resolution originals as the display texture.

## 4. Alignment — keep the door open (the data model carries it from F2)
> **Status 2026-10-22e (F5 BUILT, the association half — backlog T172):** the CPU ray grid won (7 × 5 inset rays, capped at the paint
> range, against the two building sets' fill layers 30 / 31 — `lib/globe/facadeTargets.ts` + `lib/globe/buildingHit.ts`, the
> orchestrator's `castFacadeTarget`, pulled by `saveFacade` / `updateFacade` through `probeFacadeTargets`); the OSM set's key is
> `osm:w<elementId>` from the b3dm batch table's `3DTILES_batch_table_hierarchy.Building` (probed on ion asset 96188), the enriched
> set's the sidecar's osm id or the override key. The id-map render was not needed. The uv rectangle per building, the `alignment`
> pairs and the PnP solve stay OFF (fields ride empty). The text below is the plan as written on 2026-10-21.

- **Per-building association:** at save, read back which `_feature_id_0`s the projector paints: cheapest = the depth pass rendered once
  more into a tiny R32 "id map" (a `MeshBasicMaterial` override writing `vFtwFid` — or a CPU raycast grid of the frustum's 5×5 rays
  against the building meshes) → `targetFeatureIds[]` + the uv rectangle per building. This is what a later "crop to the building",
  the per-building mask (triage §2's palette DataTexture carrier) and the facade-level moderation key on.
- **Correspondences:** `alignment: { pairs: [{ uv: [u, v], featureId, cornerIndex | worldEcef }] }` — a user (or later a detector) ties
  image points to building corners; a PnP solve (`lib/geo` is pure, testable) refines the pose; the gizmo is the manual v1 of the same
  edit. Store the EXIF pose AND the refined pose (provenance badge EXIF / MANUAL / SOLVED — the D4 idiom).
- **Photogrammetry later:** many photos of one facade → SfM / MVS is out of scope for the client (C1) but the records above (poses,
  correspondences, feature ids, the originals in Media) are exactly its inputs; an external job (the owner's machine, not Wix) could
  produce a per-building texture or an improved mesh for the bake. Nothing in F1–F5 forecloses it.
- Projection stays at RUNTIME; what is persisted is the pose + params + associations (triage §4). The owner's "keep a way" = fields now,
  solvers later.

## 5. Open research before building (next session's boot fan-out)
1. three 0.185: `DataArrayTexture` per-layer updates from an ImageBitmap; depth as an array render target; the sampler budget of the
   city material under ULTRA (3 cascades) with K slots.
2. The K-slot shader: a uniform-indexed loop with early-out vs K unrolled blocks (`#pragma unroll_loop_start`); the varying count stays 0.
3. Wix Media: the derivative upload path for a second file per photo (the private original + a display JPEG + a thumb); the collection
   shape + the member/owner permissions (the `Photos` collection as the template); C6 stance for facades (private by default).
4. `basis_encoder` WASM in a worker: encode time for a 2048×1536 frame on the owner's laptop — go/no-go for KTX2 v1.
5. The gizmo: the MS2 gizmo's handle → pose-field mapping, the gain family, undo through the edit journal.

## 6. Owner rulings on record (2026-10-18 → 21)
Building colour shade + day/night: OK. The AR yaw lock's feel: fine. The photo prototype: "looks promising" — build the full desktop
flow; no mobile twin until the desktop flow is judged; sliders stay, gizmos are the alternative.
**2026-10-21 (the two open questions answered):**
1. **Release: HOLD until SAVE (and edit / remove) exist** — the prototype stays dev-only behind `?facade=1` through F1; the first release
   is F2 (persist) or later. The ship still lands the code on master (invisible without the flag); `release:full` waits.
2. **Memory: even 100+ MB of GPU for live photos is acceptable on DESKTOP** — do not trade sharpness for VRAM there (K and the 2048-px
   derivative stand; K may grow). **Mobile, the iPhone especially, must not degrade:** the facade projector stays behind the `hqAllowed`
   gate until a mobile budget exists; when the twin lands (F6) it gets its own tier — K=1–2, a 1024-px live texture (the 2048 derivative
   is the stored truth; the phone downsizes on load), KTX2 if the client-side encode proves viable, no depth re-render cadence beyond a
   pose change, and the existing phone memory discipline (T77's levers, the LRU pair, the `leanMobile` posture) as the ceiling — measured
   on the farm (iPhone 17 Pro) before any release, never inferred from desktop numbers.
