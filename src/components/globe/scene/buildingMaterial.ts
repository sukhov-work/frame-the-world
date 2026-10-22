import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { BUILDINGS, ENRICHED, FPV, PHOTO_PROJECT } from "../tuning";
import { FTW_AERIAL_GLSL, glf } from "./glsl";

/**
 * The ONE shared building-material construction (Slice 2 stylization reconcile): the global Cesium
 * OSM Buildings (scene/buildings.ts) and the self-hosted enriched Dnipro tileset
 * (scene/enrichedBuildings.ts) must read as ONE city, so they share this factory — dark slate mass +
 * lighter edge strokes, Pass-2 per-building tonal variation (R2), the dormant night-window emissive
 * (R3), the F1 screen-door reveal, and the FPV ghost curve. Each tileset gets its OWN material
 * INSTANCE + uniform holders (the per-tileset one-shared-material invariant holds within each
 * renderer): the instances must stay separate because Slice 2 puts the bbox clipping-plane hole on
 * the OSM instance only — the enriched set lives INSIDE that prism and would be clipped away by a
 * literally-shared material.
 *
 * All look constants are glf-baked from BUILDINGS/FPV (the tuning convention) — the two tilesets are
 * stylistically identical by construction; only the edge tint/opacity is parameterized (the enriched
 * set's ENRICHED.debugDistinctEdges A/B).
 */

// Screen-door dither (RENDERING_QUALITY_PASS F1) — the SAME 4×4 ordered bayer the imagery ground
// dissolves with (imageryGround.ts:280). Injected into the shared fill + edge material so each
// tile can reveal per its own birth age WITHOUT a per-tile material (which would break the
// one-material invariant + recompile constantly, the reason TilesFadePlugin can't ride this layer).
// Exported: the enriched tree material reuses the identical dissolve for the BUILDINGS slider.
export const FTW_BAYER_GLSL = /* glsl */ `
  float ftwBayer2(vec2 v) { return mod(3.0 * v.y + 2.0 * v.x, 4.0); }
  float ftwBayer4(vec2 v) {
    vec2 P1 = mod(v, 2.0);
    vec2 P2 = floor(0.5 * mod(v, 4.0));
    return 4.0 * ftwBayer2(P1) + ftwBayer2(P2);
  }`;
// Pass 2 (Dnipro identity): a cheap 1-D hash for per-building variation. Fed a stable per-building
// key (batch id + per-tile seed) it returns a deterministic value in [0,1) — R2 maps it to a tonal
// tint, R3 to a "which windows are lit" gate. Lives in the shared fill material's fragment.
const FTW_HASH_GLSL = /* glsl */ `
  float ftwHash11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }`;
/** Age-driven screen-door `discard` for a tile whose birth ms lives in `birthUniform` (written
 *  per-mesh by onBeforeRender). Opaque — no transparent sort, no depth loss. `uFtwNowMs` is the
 *  shared per-frame clock; the fade duration is baked (BUILDINGS.fadeInMs — a constant, glf-injected
 *  per the tuning convention). */
const ftwFadeDiscard = (birthUniform: string) => /* glsl */ `
  {
    float ftwAge = clamp((uFtwNowMs - ${birthUniform}) / ${glf(BUILDINGS.fadeInMs)}, 0.0, 1.0);
    if (ftwAge < 1.0) {
      float fb = ftwBayer4(floor(mod(gl_FragCoord.xy, 4.0)));
      if ((0.5 + fb) / 16.0 > ftwAge) discard;
    }
  }`;

/** The uniform holders backing one material set — persistent objects (onBeforeCompile re-binds them
 *  across any transparent-toggle recompile, so state survives). The consumer writes these directly:
 *  `uNowMs` every frame, `uFillBirthMs`/`uEdgeBirthMs`/`uFtwTileSeed` per-tile via onBeforeRender,
 *  `uFtwNight`/`uFtwUp` from the ephemeris sample, the ghost trio from the FPV curve. */
interface BuildingMaterialUniforms {
  uGhostK: { value: number };
  uSolidK: { value: number };
  uGhostAlpha: { value: number };
  /** Flat solidity multiplier (enriched tileset's BUILDINGS slider law) — 1 = fully solid.
   *  Applied through the SAME screen-door dissolve as the ghost curve. */
  uFlatAlpha: { value: number };
  uNowMs: { value: number };
  uFillBirthMs: { value: number };
  uEdgeBirthMs: { value: number };
  uFtwNight: { value: number };
  uFtwTileSeed: { value: number };
  uFtwWindow: { value: THREE.Color };
  uFtwUp: { value: THREE.Vector3 };
  /** U8 armed building — the RAW baked `_feature_id_0` of the run under edit (−1 = none, the
   *  no-op default; only the enriched consumer ever writes it). Compared against a raw-id
   *  varying, NOT vFtwBId — that one is seed-polluted by design. */
  uFtwArmedId: { value: number };
  /** U8 tint colour (tokens.accent through the D14 bridge). */
  uFtwAccent: { value: THREE.Color };
  /** ULTRA S4 aerial perspective — effective haze strength, ALREADY carrying the twilight-band
   *  curve and every gate (the orchestrator hands the ground and the buildings the same number,
   *  which is what keeps the air over the city and the air over the ground identical). 0 = the
   *  pre-ULTRA look, and the shared `ftwAerial` returns its input untouched at 0. */
  uFtwHaze: { value: number };
  /** ULTRA S4 — haze tint for the current twilight band (day → golden → blue → night). */
  uFtwHazeCol: { value: THREE.Color };
  /** Owner defect 2 (2026-08-27): the anti-solar air-light tint and the sky's own luminance —
   *  the two terms that make the shared `ftwAerial` directional and make it go out with the sun.
   *  Inert with the chip off, twice over: `uFtwHaze` 0 early-returns, and `uFtwSkyLevel` 0 would
   *  zero the in-scatter regardless. */
  uFtwHazeCool: { value: THREE.Color };
  uFtwSkyLevel: { value: number };
  uFtwAfterglowG: { value: number };
  /** ULTRA S4 — world-space direction TO the sun, for the forward-scattering term. The buildings
   *  never needed the sun VECTOR before (only its elevation, via `uFtwNight`). */
  uFtwSunW: { value: THREE.Vector3 };
  /** 2026-10-13 — the DAY fill (`tokens.buildingDay`), lerped to the slate `color` by `uFtwNight`. */
  uFtwDayFill: { value: THREE.Color };
  /** PHOTO PROJECTION (2026-10-18, the photo flow (b) prototype — PHOTO_PROJECT; K SLOTS since
   *  2026-10-21, T171): the per-PASS holders the fill material's own onBeforeRender fills from the
   *  shared feed (never per draw — three re-uploads a non-ShaderMaterial's uniforms only on a
   *  material / program / camera switch, so a per-mesh write reaches the GPU for the first mesh of
   *  a run only). `uFtwProjOn` = the LIVE slot count; 0 = the whole block is one dead uniform
   *  branch (byte-identical city). The per-slot holders are arrays of exactly `PHOTO_PROJECT.slots`
   *  — three's `flatten` reads `size` entries, so they are pre-allocated once and never shrunk
   *  (WebGLUniforms.js `setValueM4Array` / `flatten`); a null sampler entry binds three's empty
   *  texture (black, no upload — `setValueT1Array`), which still costs its texture unit. */
  uFtwProjOn: { value: number };
  /** VIEW space → photo clip space (bias folded: xyz/w ∈ [0,1] inside the frustum) per slot —
   *  computed in float64 from `slot.projVP × camera.matrixWorld` per pass, applied to
   *  `-vViewPosition` (which three builds from the float64 modelViewMatrix): the RTC discipline,
   *  no ECEF swim. */
  uFtwProjFromView: { value: THREE.Matrix4[] };
  /** The projector apex in VIEW space (per pass, per slot) — the facing test's ray origin. */
  uFtwProjApexV: { value: THREE.Vector3[] };
  /** T170 (F4): the ONE `DataArrayTexture` every live photo lives in (`PHOTO_PROJECT.layerPx`
   *  square layers, K of them — layer = the projector's pool index, fixed for a slot's life); a
   *  `sampler2DArray` costs ONE texture unit for any K where the plain route cost K. Null while no
   *  slot is live (three binds its empty array texture). */
  uFtwProjPhotoArr: { value: THREE.DataArrayTexture | null };
  uFtwProjDepth: { value: (THREE.Texture | null)[] };
  /** Per slot: x strength · y the photo's LAYER in `uFtwProjPhotoArr` (the pack writes it from the
   *  slot's `layer`; every source is an ImageBitmap — row 0 at v 0 — so the v-flip is a constant in
   *  the fragment since F4) · z range (m — beyond it the photo fades out over
   *  PHOTO_PROJECT.rangeFadeFrac of itself; a street photo must not paper the skyline) · w ownLight
   *  (0 = lit by the scene, 1 = the photo's own colours). */
  uFtwProjSlot: { value: THREE.Vector4[] };
  /** Shared: x a global strength multiplier (1) · y, z spare · w the colour gain. */
  uFtwProjK: { value: THREE.Vector4 };
  /** x near m · y far m · z bias m · w bias per metre of range (shared by every slot). */
  uFtwProjDepthP: { value: THREE.Vector4 };
  /** x facing lo · y facing hi · z edge feather (uv) · w spare (the range moved per slot). */
  uFtwProjFacing: { value: THREE.Vector4 };
}

/** ONE projector SLOT of the feed (T171): a photo + its depth map at its pose. The projector owns
 *  the objects and mutates them in place; `on` false (or a missing texture) = the slot is skipped
 *  when the pass packs the live slots. */
export interface PhotoProjectorSlot {
  on: boolean;
  /** bias · P · V_photo — WORLD (ECEF) → photo clip space with xyz in [0,1] inside the frustum.
   *  float64 on the CPU; it is never uploaded as-is (its translation is ECEF-sized). */
  projVP: THREE.Matrix4;
  /** The apex (ECEF m). */
  apexW: THREE.Vector3;
  /** T170: the photo's layer in the feed's `photos` array (−1 = no photo uploaded — the slot is
   *  skipped exactly as a missing `map` was before F4). */
  layer: number;
  depth: THREE.Texture | null;
  /** x strength · y the layer (written by the pack from `layer`) · z rangeM · w ownLight (the
   *  `uFtwProjSlot` layout). */
  slot: THREE.Vector4;
}

/** PHOTO PROJECTION feed — ONE object owned by scene/photoProjector.ts and handed to BOTH building
 *  sets by reference (`setPhotoProjector`); the projector mutates it in place, each set's fill
 *  material packs its LIVE slots (in `slots` order — the draft first, then the nearest saved
 *  photos: the compositing is front-to-back "under", so order IS priority) into its own uniform
 *  holders once per render pass. */
export interface PhotoProjectorFeed {
  slots: PhotoProjectorSlot[];
  /** T170: the photo array (allocated by the projector on the first load; null until then). */
  photos: THREE.DataArrayTexture | null;
  k: THREE.Vector4;
  depthP: THREE.Vector4;
  facing: THREE.Vector4;
}

/** T171: the slot count compiled into the city material (a GLSL sampler array is indexable only by
 *  a constant, so the slots are K unrolled blocks — `#pragma unroll_loop_start`, the literal bound
 *  three's `unrollLoops` demands; a `#define` would not match its regex). Changing the tunable
 *  recompiles the material once at boot — the program cache key is `onBeforeCompile.toString()`,
 *  which does not see a closure value, so K is read ONCE here, never at runtime. */
export const PHOTO_PROJECT_SLOTS = PHOTO_PROJECT.slots;

export interface BuildingMaterialSet {
  fillMat: THREE.MeshStandardMaterial;
  edgeMat: THREE.LineBasicMaterial;
  uniforms: BuildingMaterialUniforms;
  /** PHOTO PROJECTION: bind (or unbind with null) the shared feed. The fill material reads it per
   *  render pass; nothing else in the set changes. */
  setPhotoProjector(feed: PhotoProjectorFeed | null): void;
}

export function createBuildingMaterials(
  opts: { edgeColor?: string; edgeOpacity?: number } = {},
): BuildingMaterialSet {
  const fillMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tokens.surface), // dark slate mass (design building front #0F151D–#12161C)
    roughness: BUILDINGS.roughness,
    metalness: 0.0,
    flatShading: true, // crisp per-facet silhouettes (the documented stylization move)
    emissive: new THREE.Color(tokens.land),
    emissiveIntensity: BUILDINGS.emissiveIntensity,
    side: THREE.DoubleSide, // guard against missing backfaces on some b3dm tiles
  });
  // Push the building faces back a hair so their OWN edge lines win the depth tie (lines ignore
  // polygonOffset). Still less than the ground's offset, so bases keep winning vs the imagery.
  fillMat.polygonOffset = true;
  fillMat.polygonOffsetFactor = BUILDINGS.polygonOffset;
  fillMat.polygonOffsetUnits = BUILDINGS.polygonOffset;

  const uniforms: BuildingMaterialUniforms = {
    // FPV ghost curve (S6): uGhostK gates the whole effect (0 in the normal look — the injected
    // math multiplies alpha by exactly 1.0).
    uGhostK: { value: 0 },
    uSolidK: { value: 0 },
    uGhostAlpha: { value: FPV.buildingGhostOpacity as number },
    uFlatAlpha: { value: 1 },
    // F1 screen-door reveal: ONE shared per-frame clock (written in the consumer's update()) +
    // per-tile birth ms written by each mesh's / edge's onBeforeRender right before it draws (birth
    // is constant per tile — cheap uniform writes, no per-tile material). Fill and edge draw as
    // SEPARATE render-list items, so each needs its own birth holder.
    uNowMs: { value: 0 },
    uFillBirthMs: { value: 0 },
    uEdgeBirthMs: { value: 0 },
    // Pass 2 (Dnipro identity): R2 per-building tone + R3 night window emissive. uFtwNight = the
    // day↔night factor (0..1, EARTH.lightsBand terminator; written by setNight); uFtwTileSeed
    // decorrelates tiles (written per-tile by onBeforeRender, like the birth stamp); uFtwWindow =
    // the warm sodium window colour (THREE.Color => LINEAR uniform, same idiom as the earth's
    // uCityLights).
    uFtwNight: { value: 0 },
    uFtwTileSeed: { value: 0 },
    uFtwWindow: { value: new THREE.Color(tokens.cityLights) },
    // R3 facade gating: geodetic up at the view focus (city-scale ≈ constant across the visible
    // skyline; written by setNight). The night emissive lights only VERTICAL walls (roofs stay
    // dark), so it reads as lit facades — a flat roof glow read as "buildings painted yellow"
    // (owner 2026-07-13).
    uFtwUp: { value: new THREE.Vector3(0, 0, 1) },
    // U8 height-override tint: armed id −1 = byte-identical no-op (the toneVariation-0
    // comparator idiom); the committed tint rides the `_ftw_override` vertex attribute, which
    // three zero-fills when a geometry doesn't carry it (the `_batchid` precedent above) — so
    // the OSM instance renders unchanged without any gating.
    uFtwArmedId: { value: -1 },
    uFtwAccent: { value: new THREE.Color(tokens.accent) },
    // ULTRA S4 (T45) — all three inert at their defaults: `ftwAerial` early-returns at haze 0.
    uFtwHaze: { value: 0 },
    uFtwHazeCol: { value: new THREE.Color(tokens.skyHorizon) },
    uFtwHazeCool: { value: new THREE.Color(tokens.skyHorizon) },
    uFtwSkyLevel: { value: 0 },
    uFtwAfterglowG: { value: 0 },
    uFtwSunW: { value: new THREE.Vector3(0, 0, 1) },
    uFtwDayFill: { value: new THREE.Color(tokens.buildingDay) },
    // PHOTO PROJECTION — inert at the defaults: uFtwProjOn 0 short-circuits the fragment block
    // and the <opaque_fragment> mix (ftwProjOwn stays 0.0 → mix(x, 0, 0) = x, byte-identical).
    // The per-slot arrays are allocated to exactly K once (see the holder doc).
    uFtwProjOn: { value: 0 },
    uFtwProjFromView: { value: Array.from({ length: PHOTO_PROJECT_SLOTS }, () => new THREE.Matrix4()) },
    uFtwProjApexV: { value: Array.from({ length: PHOTO_PROJECT_SLOTS }, () => new THREE.Vector3()) },
    uFtwProjPhotoArr: { value: null },
    uFtwProjDepth: { value: Array.from({ length: PHOTO_PROJECT_SLOTS }, () => null) },
    uFtwProjSlot: {
      value: Array.from(
        { length: PHOTO_PROJECT_SLOTS },
        () => new THREE.Vector4(PHOTO_PROJECT.strength, 0, PHOTO_PROJECT.rangeM, PHOTO_PROJECT.ownLight),
      ),
    },
    uFtwProjK: { value: new THREE.Vector4(1, 0, 0, PHOTO_PROJECT.gain) },
    uFtwProjDepthP: {
      value: new THREE.Vector4(PHOTO_PROJECT.nearM, PHOTO_PROJECT.farM, PHOTO_PROJECT.depthBiasM, PHOTO_PROJECT.depthBiasPerM),
    },
    uFtwProjFacing: {
      value: new THREE.Vector4(PHOTO_PROJECT.facingLo, PHOTO_PROJECT.facingHi, PHOTO_PROJECT.edgeFeather, 0),
    },
  };

  // PHOTO PROJECTION — the per-PASS sync. `material.onBeforeRender` runs before the draw's
  // `setProgram`, and the FIRST draw of this material in a render pass carries `refreshMaterial`
  // (three resets its current-material id at every `render()`), so writing the holders here is
  // exactly one upload per pass. Keyed on (render frame, camera): the composer pass, the /m PiP
  // and a depth pass each get their own camera-relative matrix; consecutive draws cost one compare.
  let projFeed: PhotoProjectorFeed | null = null;
  let projLastFrame = -1;
  let projLastCamera: THREE.Camera | null = null;
  fillMat.onBeforeRender = (renderer, _scene, camera) => {
    const frame = renderer.info.render.frame;
    if (frame === projLastFrame && camera === projLastCamera) return;
    projLastFrame = frame;
    projLastCamera = camera;
    const f = projFeed;
    const depths = uniforms.uFtwProjDepth.value;
    // Pack the LIVE slots in feed order (the draft first, then the nearest saved photos — the
    // front-to-back compositing in the fragment makes order priority). A slot that is off, or
    // whose photo layer / depth is missing, is skipped; the tail beyond the live count drops its
    // depth references (a disposed target still bound here would be re-uploaded by three on the
    // next draw — "source data has been detached"). The photos ride ONE array texture (T170): the
    // packed index n is NOT the layer — the layer travels in `uFtwProjSlot[n].y`.
    let n = 0;
    if (f) {
      for (const s of f.slots) {
        if (n >= PHOTO_PROJECT_SLOTS) break;
        if (!s.on || s.layer < 0 || !s.depth) continue;
        // float64 on the CPU: the ECEF-sized translations cancel BEFORE the float32 cast — the
        // uploaded matrix carries the camera→apex offset (metres to kilometres), never 6.4e6 m.
        uniforms.uFtwProjFromView.value[n].multiplyMatrices(s.projVP, camera.matrixWorld);
        uniforms.uFtwProjApexV.value[n].copy(s.apexW).applyMatrix4(camera.matrixWorldInverse);
        depths[n] = s.depth;
        uniforms.uFtwProjSlot.value[n].copy(s.slot);
        uniforms.uFtwProjSlot.value[n].y = s.layer;
        n++;
      }
      uniforms.uFtwProjK.value.copy(f.k);
      uniforms.uFtwProjDepthP.value.copy(f.depthP);
      uniforms.uFtwProjFacing.value.copy(f.facing);
    }
    for (let j = n; j < PHOTO_PROJECT_SLOTS; j++) depths[j] = null;
    const photos = n > 0 && f ? f.photos : null;
    if (uniforms.uFtwProjPhotoArr.value !== photos) uniforms.uFtwProjPhotoArr.value = photos;
    if (uniforms.uFtwProjOn.value !== n) uniforms.uFtwProjOn.value = n;
  };

  fillMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGhostK = uniforms.uGhostK;
    shader.uniforms.uSolidK = uniforms.uSolidK;
    shader.uniforms.uGhostAlpha = uniforms.uGhostAlpha;
    shader.uniforms.uFlatAlpha = uniforms.uFlatAlpha;
    shader.uniforms.uFtwNowMs = uniforms.uNowMs;
    shader.uniforms.uFtwFillBirthMs = uniforms.uFillBirthMs;
    shader.uniforms.uFtwNight = uniforms.uFtwNight;
    shader.uniforms.uFtwTileSeed = uniforms.uFtwTileSeed;
    shader.uniforms.uFtwWindow = uniforms.uFtwWindow;
    shader.uniforms.uFtwUp = uniforms.uFtwUp;
    shader.uniforms.uFtwArmedId = uniforms.uFtwArmedId;
    shader.uniforms.uFtwAccent = uniforms.uFtwAccent;
    shader.uniforms.uFtwHaze = uniforms.uFtwHaze;
    shader.uniforms.uFtwHazeCol = uniforms.uFtwHazeCol;
    shader.uniforms.uFtwHazeCool = uniforms.uFtwHazeCool;
    shader.uniforms.uFtwSkyLevel = uniforms.uFtwSkyLevel;
    shader.uniforms.uFtwAfterglowG = uniforms.uFtwAfterglowG;
    shader.uniforms.uFtwSunW = uniforms.uFtwSunW;
    shader.uniforms.uFtwDayFill = uniforms.uFtwDayFill;
    shader.uniforms.uFtwProjOn = uniforms.uFtwProjOn;
    shader.uniforms.uFtwProjFromView = uniforms.uFtwProjFromView;
    shader.uniforms.uFtwProjApexV = uniforms.uFtwProjApexV;
    shader.uniforms.uFtwProjPhotoArr = uniforms.uFtwProjPhotoArr;
    shader.uniforms.uFtwProjDepth = uniforms.uFtwProjDepth;
    shader.uniforms.uFtwProjSlot = uniforms.uFtwProjSlot;
    shader.uniforms.uFtwProjK = uniforms.uFtwProjK;
    shader.uniforms.uFtwProjDepthP = uniforms.uFtwProjDepthP;
    shader.uniforms.uFtwProjFacing = uniforms.uFtwProjFacing;
    // Pass 2 R2: carry a stable per-building key to the fragment. The b3dm batch id survives GLTF
    // load as `_batchid` (legacy) or `_feature_id_0` (3D Tiles 1.1 — also what the Slice-1 baker
    // writes per building) — whichever the tile has; the other defaults to 0 (three disables an
    // unbound attribute — no error). Plus the per-tile seed, so ids that restart at 0 each tile
    // don't repeat. No batch id at all → key = seed → variation degrades to per-tile, never breaks
    // the one-material invariant.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float _batchid;
        attribute float _feature_id_0;
        attribute float _ftw_override;
        uniform float uFtwTileSeed;
        varying float vFtwBId;
        varying float vFtwFid;
        varying float vFtwOverride;
        varying vec3 vFtwWNormal;
        varying vec3 vFtwWPos;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // ULTRA S4: world position for the aerial-perspective distance + scattering angle. Taken
        // right after begin_vertex, where 'transformed' is the untouched local position (these
        // tiles carry no morph/skin) and modelMatrix already folds in the 3D-Tiles transform.
        vFtwWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vFtwBId = _batchid + _feature_id_0 + uFtwTileSeed;
        // U8: the RAW id (no seed — comparable against uFtwArmedId) + the committed-override
        // mask the enriched consumer writes per run (absent attribute → 0 → no tint).
        vFtwFid = _feature_id_0;
        vFtwOverride = _ftw_override;
        // R3: world face normal (direction only → float32-safe at ECEF scale, unlike world position).
        // objectNormal is defined by <beginnormal_vertex> above; the tile transform is rigid.
        vFtwWNormal = mat3(modelMatrix) * objectNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uGhostK;
        uniform float uSolidK;
        uniform float uGhostAlpha;
        uniform float uFlatAlpha;
        uniform float uFtwNowMs;
        uniform float uFtwFillBirthMs;
        uniform float uFtwNight;
        uniform vec3 uFtwWindow;
        uniform vec3 uFtwUp;
        uniform float uFtwArmedId;
        uniform vec3 uFtwAccent;
        varying float vFtwBId;
        varying float vFtwFid;
        varying float vFtwOverride;
        varying vec3 vFtwWNormal;
        varying vec3 vFtwWPos;
        uniform float uFtwHaze;
        uniform vec3 uFtwHazeCol;
        uniform vec3 uFtwHazeCool;
        uniform float uFtwSkyLevel;
        uniform float uFtwAfterglowG;
        uniform vec3 uFtwSunW;
        uniform vec3 uFtwDayFill;
        uniform float uFtwProjOn;
        uniform mat4 uFtwProjFromView[ ${PHOTO_PROJECT_SLOTS} ];
        uniform vec3 uFtwProjApexV[ ${PHOTO_PROJECT_SLOTS} ];
        uniform highp sampler2DArray uFtwProjPhotoArr;
        uniform highp sampler2D uFtwProjDepth[ ${PHOTO_PROJECT_SLOTS} ];
        uniform vec4 uFtwProjSlot[ ${PHOTO_PROJECT_SLOTS} ];
        uniform vec4 uFtwProjK;
        uniform vec4 uFtwProjDepthP;
        uniform vec4 uFtwProjFacing;
        // PHOTO PROJECTION — fragment globals written by the block at <normal_fragment_maps> and read
        // again at <opaque_fragment> (the own-light mix). All three stay 0 while uFtwProjOn is 0.
        // ftwProjK = the composited coverage over the slots, ftwProjOwn = the own-light share of it
        // (Σ w_i · ownLight_i), ftwProjRgb = the coverage-weighted photo colour.
        float ftwProjK = 0.0;
        float ftwProjOwn = 0.0;
        vec3 ftwProjRgb = vec3(0.0);
        // The projector's 24-bit window depth back to metres (its near/far ride in uFtwProjDepthP.xy),
        // so the occlusion compare + bias happen in METRES — a window-space bias is ~d² non-linear.
        float ftwProjLinDepth(float d01) {
          float n = uFtwProjDepthP.x;
          float f = uFtwProjDepthP.y;
          float z = d01 * 2.0 - 1.0;
          return 2.0 * n * f / (f + n - z * (f - n));
        }
        ${FTW_BAYER_GLSL}
        ${FTW_HASH_GLSL}
        ${FTW_AERIAL_GLSL}
        // U8 / MS3: the edit-tint strength of this fragment — the ARMED run (raw-id match vs
        // uFtwArmedId, −1 = none) reads stronger than a COMMITTED override (the per-vertex byte
        // LADDER: 255 = my edit, 128 = a world-shared edit, 0 = original — two thresholds, a run's
        // vertices all carry one byte so nothing interpolates onto a third level). 0 on every
        // untouched building. Read twice: the albedo pull at <color_fragment> and the post-lighting
        // FLOOR at <opaque_fragment> (T125).
        float ftwOverrideK() {
          float ftwArm = (uFtwArmedId >= 0.0 && abs(vFtwFid - uFtwArmedId) < 0.5) ? 1.0 : 0.0;
          float ftwOvLvl = vFtwOverride > 0.75 ? ${glf(ENRICHED.overrideTintCommittedK)}
            : (vFtwOverride > 0.25 ? ${glf(ENRICHED.overrideTintSharedK)} : 0.0);
          return max(ftwArm * ${glf(ENRICHED.overrideTintK)}, ftwOvLvl);
        }`,
      )
      .replace(
        // ULTRA S4 — after <opaque_fragment> (which writes gl_FragColor from outgoingLight) and
        // BEFORE <tonemapping_fragment>/<colorspace_fragment>, so the haze mixes in LINEAR light
        // exactly as it does on the ground. Anchoring at <fog_fragment> instead would land after
        // both, and would then be correct in the composer pass (where three compiles them as
        // no-ops for a render target) but WRONG in any direct-to-backbuffer pass — a trap, not a
        // difference of taste.
        "#include <opaque_fragment>",
        /* glsl */ `#include <opaque_fragment>
        {
          // T125 (owner 2026-09-08b, "edited buildings are no longer highlighted"): the albedo pull
          // below is a DIFFUSE term — at night the city is a dark mass (no night emissive, R3) and
          // 24 % of nothing is nothing, so an edited building read exactly like its neighbours
          // after dark. A per-channel FLOOR in LINEAR light (after <opaque_fragment>, before the
          // haze — the same seat as the aerial term): lit faces are already above it (byte-identical
          // by day), the dark mass is lifted to a faint accent glow scaled by the same K ladder.
          float ftwOvG = ftwOverrideK() * ${glf(ENRICHED.overrideTintGlow)};
          gl_FragColor.rgb = max(gl_FragColor.rgb, uFtwAccent * ftwOvG);
        }
        // PHOTO PROJECTION — the OWN-LIGHT half: the photo's own colours replace the LIT result by
        // the own-light share of the composited coverage (the albedo half at <normal_fragment_maps>
        // took the rest, K − own). In linear light, after the floor and BEFORE the haze, so a
        // projected facade recedes into the same air as the city. ftwProjOwn is 0.0 whenever the
        // projector is off → mix(x, 0, 0) = x.
        gl_FragColor.rgb = mix(gl_FragColor.rgb, ftwProjRgb, ftwProjOwn);
        gl_FragColor.rgb = ftwAerial(gl_FragColor.rgb, vFtwWPos, uFtwSunW, uFtwHaze, uFtwHazeCol,
          uFtwHazeCool, uFtwSkyLevel, uFtwAfterglowG);`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          // FPV ghost: near the camera the mass melts away entirely (the street stays
          // readable), easing to the ghost opacity with distance; uSolidK lifts the whole
          // curve back to solid as the viewpoint climbs over the rooftops; uFlatAlpha is the
          // enriched tileset's flat BUILDINGS-slider law. The combined solidity renders as a
          // SCREEN-DOOR dissolve (the F1 Bayer, jittered per building), NOT alpha blending —
          // the material stays opaque + depth-writing at every slider value, so occlusion is
          // always correct and the fade is gradual and uniform (the old alpha path needed a
          // binary depthWrite flip near solid, which read as an instant jump to full opacity
          // — owner 2026-07-14).
          float ftwD = length(vViewPosition);
          float ftwGhostA = uGhostAlpha *
            smoothstep(${glf(FPV.buildingGhostNearM)}, ${glf(FPV.buildingGhostFarM)}, ftwD);
          float ftwA = mix(1.0, mix(ftwGhostA, 1.0, uSolidK), uGhostK) * uFlatAlpha;
          if (ftwA < 0.999) {
            // Per-building jitter inside each Bayer step: 16 ordered levels become an
            // effectively continuous city-wide response (each building's threshold shifts
            // fractionally, so the skyline dissolves smoothly instead of banding).
            float ftwFb =
              (ftwBayer4(floor(mod(gl_FragCoord.xy, 4.0))) + ftwHash11(vFtwBId + 5.0)) / 16.0;
            if (ftwFb > ftwA) discard;
          }
          // 2026-10-13 — THE DAY FILL: by day the city is tokens.buildingDay (a warm light grey
          // the sun and the sky can shade); the terminator factor lerps it back to the slate
          // material colour so the owner-verified NIGHT look (dark mass + edges + shadows) is kept.
          diffuseColor.rgb = mix(uFtwDayFill, diffuseColor.rgb, uFtwNight);
          // ASK 3 RUNG 1 (2026-10-13): a per-building HUE wobble — a second hash picks a point on
          // a warm↔cool axis (a cream (1.06, 1.0, 0.92) ↔ a cool grey (0.94, 0.98, 1.06), with a
          // stone (1.02, 0.99, 0.95) in the middle), applied as a per-channel multiplier on the DAY
          // fill by BUILDINGS.hueVariation. Low chroma on purpose — neighbours differ in warmth, the
          // city stays one family. Night-gated through uFtwNight like the fill itself.
          {
            float ftwHue = ftwHash11(vFtwBId + 37.0);
            vec3 ftwWarm = vec3(1.06, 1.0, 0.92);
            vec3 ftwCool = vec3(0.94, 0.98, 1.06);
            vec3 ftwHueMul = mix(ftwWarm, ftwCool, ftwHue);
            diffuseColor.rgb *= mix(vec3(1.0), ftwHueMul, ${glf(BUILDINGS.hueVariation)} * (1.0 - uFtwNight));
          }
          // Pass 2 R2: per-building tonal variation — a subtle ± on the fill albedo keyed by the
          // building hash, so the skyline reads as massing, not one uniform slab. toneVariation 0
          // makes mix(1,1,·)=1 → byte-identical to the pre-Pass-2 look (the no-op comparator).
          float ftwTone = ftwHash11(vFtwBId + 11.0);
          diffuseColor.rgb *= mix(${glf(1 - BUILDINGS.toneVariation)}, ${glf(1 + BUILDINGS.toneVariation)}, ftwTone);
          // U8 height-override tint: the ARMED run reads stronger than a COMMITTED override —
          // "selected" vs "edited" (ftwOverrideK, <common>). Accent through the D14 token
          // bridge; both no-op at their defaults. This is the DAYLIGHT half (an albedo pull);
          // the night half is the floor at <opaque_fragment> (T125).
          float ftwOvK = ftwOverrideK();
          diffuseColor.rgb = mix(diffuseColor.rgb, uFtwAccent, ftwOvK);
        }`,
      )
      .replace(
        // PHOTO PROJECTION (the photo flow (b), 2026-10-18; K SLOTS 2026-10-21, T171) — after
        // <normal_fragment_begin> has the flat-shaded VIEW-space `normal` and before
        // <lights_physical_fragment> copies diffuseColor. Everything is camera-relative:
        // -vViewPosition is the float64-built view position, each slot's matrix maps it straight
        // into that photo's clip space (xyz/w ∈ [0,1] inside the frustum, w = the projector's eye
        // depth in metres). The slots are K UNROLLED blocks (three's `unrollLoops` — a sampler
        // array is only indexable by a constant; `continue` / `break` do not survive the unroll,
        // hence nested ifs), each with an EARLY-OUT: a fragment outside a slot's frustum, or one
        // already fully covered by an earlier slot, costs that slot one mat4 × vec4 and a few
        // compares — no fetch. The derivatives are taken ONCE, in uniform control flow, on the view
        // position; the view→clip map is affine, so each slot's uv gradients are two more mat4 × vec4
        // products inside its branch — `textureGrad` with explicit gradients and `textureLod` are
        // both legal in non-uniform flow. Compositing is front-to-back "under" in feed order (the
        // draft first, then the nearest saved photos): slot i adds (1 − K_so_far) · k_i, so the
        // first slot at full coverage wins outright and later slots fill only its feathered edges.
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        if (uFtwProjOn > 0.5) {
          vec3 ftwPV = -vViewPosition;
          vec3 ftwPVdx = dFdx(ftwPV);
          vec3 ftwPVdy = dFdy(ftwPV);
          #pragma unroll_loop_start
          for ( int i = 0; i < ${PHOTO_PROJECT_SLOTS}; i ++ ) {
            if (float( UNROLLED_LOOP_INDEX ) < uFtwProjOn - 0.5 && ftwProjK < 0.999) {
              vec4 ftwC = uFtwProjFromView[ i ] * vec4(ftwPV, 1.0);
              vec3 ftwP = ftwC.xyz / max(ftwC.w, 1e-4);
              vec2 ftwE = min(ftwP.xy, 1.0 - ftwP.xy);
              if (ftwC.w > 1e-4 && min(ftwE.x, ftwE.y) >= 0.0 && ftwP.z >= 0.0 && ftwP.z <= 1.0) {
                vec4 ftwS = uFtwProjSlot[ i ];
                vec2 ftwUv = ftwP.xy;
                vec4 ftwCx = ftwC + uFtwProjFromView[ i ] * vec4(ftwPVdx, 0.0);
                vec4 ftwCy = ftwC + uFtwProjFromView[ i ] * vec4(ftwPVdy, 0.0);
                vec2 ftwDuvDx = ftwCx.xy / max(ftwCx.w, 1e-4) - ftwUv;
                vec2 ftwDuvDy = ftwCy.xy / max(ftwCy.w, 1e-4) - ftwUv;
                float ftwFeather = smoothstep(0.0, uFtwProjFacing.z, min(ftwE.x, ftwE.y));
                // Facing: the geometric normal faces the VIEWER (flat shading, derivative-built), the
                // projector may sit on either side of a one-quad wall — abs() makes the test symmetric;
                // the depth compare below rejects the far side of a closed box regardless.
                float ftwFace = abs(dot(normal, normalize(uFtwProjApexV[ i ] - ftwPV)));
                float ftwFaceK = smoothstep(uFtwProjFacing.x, uFtwProjFacing.y, ftwFace);
                float ftwDMe = ftwC.w;
                float ftwDRef = ftwProjLinDepth(textureLod(uFtwProjDepth[ i ], ftwUv, 0.0).r);
                float ftwBias = uFtwProjDepthP.z * (1.0 + 4.0 * (1.0 - ftwFace)) + uFtwProjDepthP.w * ftwDMe;
                float ftwLit = step(ftwDMe, ftwDRef + ftwBias);
                // The range: a photo papers what it can resolve — beyond the slot's range the paint
                // fades out over a fraction of it (never a hard cut across a facade).
                float ftwRange = 1.0 - smoothstep(ftwS.z * ${glf(1 - PHOTO_PROJECT.rangeFadeFrac)}, ftwS.z, ftwDMe);
                // T170: the photo lives in layer ftwS.y of the ONE array, stretched to the square
                // layer (the uv is the photo's own normalised frame — the stretch is invisible); an
                // ImageBitmap's row 0 sits at v 0, so v is flipped (a constant since F4).
                vec2 ftwSampleUv = vec2(ftwUv.x, 1.0 - ftwUv.y);
                vec3 ftwPhoto = textureGrad(uFtwProjPhotoArr, vec3(ftwSampleUv, ftwS.y), ftwDuvDx, ftwDuvDy).rgb * uFtwProjK.w;
                float ftwKi = uFtwProjK.x * ftwS.x * ftwFeather * ftwFaceK * ftwLit * ftwRange;
                float ftwW = (1.0 - ftwProjK) * ftwKi;
                ftwProjRgb += ftwW * ftwPhoto;
                ftwProjOwn += ftwW * ftwS.w;
                ftwProjK += ftwW;
              }
            }
          }
          #pragma unroll_loop_end
          ftwProjRgb /= max(ftwProjK, 1e-4);
          // The LIT half: the photo becomes the facade's albedo by the lit share of the coverage
          // (K − the own-light share) — sun, shadow and the day/night fill then shade it like any
          // wall. The own-light half is at <opaque_fragment>.
          diffuseColor.rgb = mix(diffuseColor.rgb, ftwProjRgb, ftwProjK - ftwProjOwn);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        {
          // Pass 2 R3 night-facade emissive — DORMANT (BUILDINGS.nightWindowGain 0). A flat per-wall
          // glow reads as "painted yellow" (owner rejected it twice) and a procedural window grid read
          // "junky" (owner 2026-07-13) — so buildings carry NO night emissive; their night identity is
          // the dark mass + lit edges + cast/received SHADOWS + the golden/moon key. The wall-gate stays
          // wired (gain 0 = no-op) in case a future look wants it. wallness = 1 − |worldNormal · up|.
          float ftwWLen = length(vFtwWNormal);
          float ftwWall = ftwWLen > 0.001 ? 1.0 - abs(dot(vFtwWNormal / ftwWLen, uFtwUp)) : 1.0;
          float ftwLit = smoothstep(${glf(BUILDINGS.nightWindowLitLo)}, ${glf(BUILDINGS.nightWindowLitHi)}, ftwHash11(vFtwBId + 71.0));
          totalEmissiveRadiance += uFtwWindow * (${glf(BUILDINGS.nightWindowGain)} * uFtwNight * ftwLit * ftwWall);
          // 2026-10-13 — by day the sage emissive floor is scaled down (BUILDINGS.dayEmissiveK): a
          // direction-blind glow on the light day fill reads flat; the night keeps the full floor.
          totalEmissiveRadiance *= mix(${glf(BUILDINGS.dayEmissiveK)}, 1.0, uFtwNight);
        }`,
      )
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        ${ftwFadeDiscard("uFtwFillBirthMs")}`,
      );
  };

  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(opts.edgeColor ?? tokens.landHi), // lighter than the fill -> pronounced lit edges (design stroke)
    transparent: true,
    opacity: opts.edgeOpacity ?? BUILDINGS.edgeOpacity,
  });
  // Edges ride the SAME per-tile screen-door reveal (LineBasicMaterial uses the 'basic' shader, so
  // it has <common> + <dithering_fragment>) — otherwise the lit strokes would pop in a frame before
  // the fill finished dissolving. Its own birth holder, written by the LineSegments' onBeforeRender.
  edgeMat.onBeforeCompile = (shader) => {
    shader.uniforms.uFtwNowMs = uniforms.uNowMs;
    shader.uniforms.uFtwEdgeBirthMs = uniforms.uEdgeBirthMs;
    // ULTRA S4: the edges ride the SAME haze as the fill. Skipping them would leave the lit
    // strokes at full contrast while the mass they outline recedes — a wireframe city floating in
    // fog, which is a worse picture than no aerial perspective at all.
    shader.uniforms.uFtwHaze = uniforms.uFtwHaze;
    shader.uniforms.uFtwHazeCol = uniforms.uFtwHazeCol;
    shader.uniforms.uFtwHazeCool = uniforms.uFtwHazeCool;
    shader.uniforms.uFtwSkyLevel = uniforms.uFtwSkyLevel;
    shader.uniforms.uFtwAfterglowG = uniforms.uFtwAfterglowG;
    shader.uniforms.uFtwSunW = uniforms.uFtwSunW;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n        varying vec3 vFtwWPos;`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n        vFtwWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uFtwNowMs;
        uniform float uFtwEdgeBirthMs;
        uniform float uFtwHaze;
        uniform vec3 uFtwHazeCol;
        uniform vec3 uFtwHazeCool;
        uniform float uFtwSkyLevel;
        uniform float uFtwAfterglowG;
        uniform vec3 uFtwSunW;
        varying vec3 vFtwWPos;
        ${FTW_BAYER_GLSL}
        ${FTW_AERIAL_GLSL}`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `#include <opaque_fragment>
        gl_FragColor.rgb = ftwAerial(gl_FragColor.rgb, vFtwWPos, uFtwSunW, uFtwHaze, uFtwHazeCol,
          uFtwHazeCool, uFtwSkyLevel, uFtwAfterglowG);`,
      )
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        ${ftwFadeDiscard("uFtwEdgeBirthMs")}`,
      );
  };

  return {
    fillMat,
    edgeMat,
    uniforms,
    setPhotoProjector(feed) {
      projFeed = feed;
      projLastFrame = -1; // force the next pass to re-sync (an unbind must zero uFtwProjOn)
    },
  };
}
