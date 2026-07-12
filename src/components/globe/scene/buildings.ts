import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { tokens } from "../../../lib/theme/tokens";
import { buildingNightFactor } from "../../../lib/globe/buildingNight";
import { BUILDINGS, EARTH, FPV, TILESETS } from "../tuning";
import { glf } from "./glsl";

/**
 * OSM building tiles (Cesium ion, TILESETS.ionAssetId) restyled to the design-board building idiom
 * (canvas ftw-scene): DARK slate mass with lighter edge strokes that catch the light — not a light
 * fill. Flat shading keeps per-facet silhouettes; a faint sage emissive stops the night side going
 * pure black. Accent stays reserved for signal (pins). Tunables: BUILDINGS + TILESETS.
 *
 * Style is applied by material swap on `load-model` (NOT BatchedTilesPlugin — locked invariant).
 * ONE shared fill material + ONE shared edge material (disposed once, here); edge GEOMETRY is
 * per-tile (disposed on `dispose-model`).
 */

// Screen-door dither (RENDERING_QUALITY_PASS F1) — the SAME 4×4 ordered bayer the imagery ground
// dissolves with (imageryGround.ts:280). Injected into the ONE shared fill + edge material so each
// tile can reveal per its own birth age WITHOUT a per-tile material (which would break the locked
// one-material invariant + recompile constantly, the reason TilesFadePlugin can't ride this layer).
const FTW_BAYER_GLSL = /* glsl */ `
  float ftwBayer2(vec2 v) { return mod(3.0 * v.y + 2.0 * v.x, 4.0); }
  float ftwBayer4(vec2 v) {
    vec2 P1 = mod(v, 2.0);
    vec2 P2 = floor(0.5 * mod(v, 4.0));
    return 4.0 * ftwBayer2(P1) + ftwBayer2(P2);
  }`;
// Pass 2 (Dnipro identity): a cheap 1-D hash for per-building variation. Fed a stable per-building
// key (batch id + per-tile seed) it returns a deterministic value in [0,1) — R2 maps it to a tonal
// tint, R3 to a "which windows are lit" gate. Lives in the ONE shared fill material's fragment.
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

export interface BuildingsHandle {
  tiles: TilesRenderer;
  update(): void;
  /** FPV ghost mode (Phase 5.5 S2 follow-up): fade ALL buildings so the first-person view is
   *  never lost inside a mesh. Both materials are shared, so this is two uniform writes —
   *  per-tile obstruction testing is impossible without breaking the one-material invariant.
   *  Pass null to restore the normal look. S6: the fill fades per-fragment by CAMERA DISTANCE
   *  (fully transparent inside FPV.buildingGhostNearM, `fillOpacity` beyond buildingGhostFarM)
   *  — distance-from-camera is global, so the falloff rides the shared material's uniforms. */
  setGhost(ghost: { fillOpacity: number; edgeOpacity: number } | null): void;
  /** S6 (owner): 0 = pure ghost curve, 1 = full opacity — the orchestrator drives it from the
   *  FPV eye height above ground (FPV.buildingSolidLoM/HiM): risen over the rooftops, there is
   *  nothing left to see through. Per-frame safe (uniform + two cheap material writes). */
  setGhostSolid(k: number): void;
  /** Adaptive quality (RENDERING_QUALITY_PASS WS1): coarsen the skyline + bound tile memory on
   *  weaker tiers. `errorTarget` raises the screen-space error (fewer building tiles); `lruCapBytes`
   *  caps this renderer's own LRU byte budget (already resolved by `lruCapBytesForTier` — `null` =
   *  restore the captured library default, the `high`-tier byte-identical path). */
  setQualityTier(errorTarget: number, lruCapBytes: number | null): void;
  /** Pass 2 R3 (Dnipro identity): drive the night-side window emissive. Pass the SINE of the sun's
   *  elevation at the view focus (`sunDir·focusUp`); the module converts it to a night factor with
   *  the SAME EARTH.lightsBand terminator the earth + ground use, so the windows light up in step
   *  with the terminator sweeping the city. City-scale — one factor across the skyline is right.
   *  `up` = the view-focus geodetic up; the emissive lights only walls perpendicular to it. */
  setNight(sunElevSin: number, up: THREE.Vector3): void;
  dispose(): void;
}

export function attachBuildings(
  scene: THREE.Scene,
  opts: { camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; ionToken: string },
): BuildingsHandle {
  // S7d trial flag: Re:Earth Overture buildings (hosted 3D Tiles 1.1, meshopt-compressed glTF)
  // instead of Cesium OSM Buildings — same renderer, same styling, different source. Default OFF.
  const useOverture: boolean = TILESETS.overtureBuildings;
  const tiles = useOverture
    ? new TilesRenderer(TILESETS.overtureTilesetUrl)
    : new TilesRenderer();
  // The renderer's own LRU byte budget at construction (0.4 GB default) — restored on the `high`
  // tier so the byte-identical invariant holds; mid/low actively tighten it (setQualityTier).
  const lruDefaultBytes = tiles.lruCache.maxBytesSize;
  if (!useOverture) {
    tiles.registerPlugin(
      new CesiumIonAuthPlugin({ apiToken: opts.ionToken, assetId: TILESETS.ionAssetId }),
    );
  }
  const draco = new DRACOLoader().setDecoderPath(TILESETS.dracoDecoderPath);
  tiles.registerPlugin(
    new GLTFExtensionsPlugin({ dracoLoader: draco, meshoptDecoder: MeshoptDecoder }),
  );

  tiles.setCamera(opts.camera);
  tiles.setResolutionFromRenderer(opts.camera, opts.renderer);
  scene.add(tiles.group);

  // (The old 90 m TERRAIN.buildingSinkM hack is gone: the ground now RENDERS Cesium World
  // Terrain — the same terrain OSM Buildings are height-clamped to — so bases seat naturally.)

  const styleMat = new THREE.MeshStandardMaterial({
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
  styleMat.polygonOffset = true;
  styleMat.polygonOffsetFactor = BUILDINGS.polygonOffset;
  styleMat.polygonOffsetUnits = BUILDINGS.polygonOffset;
  // FPV ghost curve (S6): persistent uniform holders — onBeforeCompile re-binds them across
  // the transparent-toggle recompile, so state survives. uGhostK gates the whole effect (0 in
  // the normal look — the injected math multiplies alpha by exactly 1.0).
  const uGhostK = { value: 0 };
  const uSolidK = { value: 0 };
  const uGhostAlpha = { value: FPV.buildingGhostOpacity as number };
  // F1 screen-door reveal: ONE shared per-frame clock (written in update()) + per-tile birth ms
  // written by each mesh's / edge's onBeforeRender right before it draws (birth is constant per
  // tile — cheap uniform writes, no per-tile material). Fill and edge draw as SEPARATE render-list
  // items, so each needs its own birth holder.
  const uNowMs = { value: 0 };
  const uFillBirthMs = { value: 0 };
  const uEdgeBirthMs = { value: 0 };
  // Pass 2 (Dnipro identity): R2 per-building tone + R3 night window emissive, both on the ONE
  // shared fill material. uFtwNight = the day↔night factor (0..1, EARTH.lightsBand terminator;
  // written by setNight); uFtwTileSeed decorrelates tiles (written per-tile by onBeforeRender, like
  // the birth stamp); uFtwWindow = the warm sodium window colour (THREE.Color => LINEAR uniform,
  // same idiom as the earth's uCityLights).
  const uFtwNight = { value: 0 };
  const uFtwTileSeed = { value: 0 };
  const uFtwWindow = { value: new THREE.Color(tokens.cityLights) };
  // R3 facade gating: geodetic up at the view focus (city-scale ≈ constant across the visible
  // skyline; written by setNight). The night emissive lights only VERTICAL walls (roofs stay dark),
  // so it reads as lit facades — a flat roof glow read as "buildings painted yellow" (owner 2026-07-13).
  const uFtwUp = { value: new THREE.Vector3(0, 0, 1) };
  styleMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGhostK = uGhostK;
    shader.uniforms.uSolidK = uSolidK;
    shader.uniforms.uGhostAlpha = uGhostAlpha;
    shader.uniforms.uFtwNowMs = uNowMs;
    shader.uniforms.uFtwFillBirthMs = uFillBirthMs;
    shader.uniforms.uFtwNight = uFtwNight;
    shader.uniforms.uFtwTileSeed = uFtwTileSeed;
    shader.uniforms.uFtwWindow = uFtwWindow;
    shader.uniforms.uFtwUp = uFtwUp;
    // Pass 2 R2: carry a stable per-building key to the fragment. The b3dm batch id survives GLTF
    // load as `_batchid` (legacy) or `_feature_id_0` (3D Tiles 1.1) — whichever the tile has; the
    // other defaults to 0 (three disables an unbound attribute — no error). Plus the per-tile seed,
    // so ids that restart at 0 each tile don't repeat. No batch id at all → key = seed → variation
    // degrades to per-tile, never breaks the ONE-material invariant.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float _batchid;
        attribute float _feature_id_0;
        uniform float uFtwTileSeed;
        varying float vFtwBId;
        varying vec3 vFtwWNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vFtwBId = _batchid + _feature_id_0 + uFtwTileSeed;
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
        uniform float uFtwNowMs;
        uniform float uFtwFillBirthMs;
        uniform float uFtwNight;
        uniform vec3 uFtwWindow;
        uniform vec3 uFtwUp;
        varying float vFtwBId;
        varying vec3 vFtwWNormal;
        ${FTW_BAYER_GLSL}
        ${FTW_HASH_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          // FPV ghost: near the camera the mass melts away entirely (the street stays
          // readable), easing to the ghost opacity with distance; uSolidK lifts the whole
          // curve back to solid as the viewpoint climbs over the rooftops.
          float ftwD = length(vViewPosition);
          float ftwGhostA = uGhostAlpha *
            smoothstep(${glf(FPV.buildingGhostNearM)}, ${glf(FPV.buildingGhostFarM)}, ftwD);
          diffuseColor.a *= mix(1.0, mix(ftwGhostA, 1.0, uSolidK), uGhostK);
          // Pass 2 R2: per-building tonal variation — a subtle ± on the fill albedo keyed by the
          // building hash, so the skyline reads as massing, not one uniform slab. toneVariation 0
          // makes mix(1,1,·)=1 → byte-identical to the pre-Pass-2 look (the no-op comparator).
          float ftwTone = ftwHash11(vFtwBId + 11.0);
          diffuseColor.rgb *= mix(${glf(1 - BUILDINGS.toneVariation)}, ${glf(1 + BUILDINGS.toneVariation)}, ftwTone);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `#include <emissivemap_fragment>
        {
          // Pass 2 R3: warm facade emissive on the NIGHT side. Only VERTICAL walls glow — roofs stay
          // dark (a flat roof glow read as "buildings painted yellow", owner 2026-07-13). wallness =
          // 1 − |worldNormal · up| (length-guarded: a tile with no normals → objectNormal 0 → fall
          // back to all-surfaces so it can never NaN). A per-building hash gates WHICH buildings are
          // lit (city alive at night, not a uniform box); added on the faint sage floor. gain 0 → no-op.
          float ftwWLen = length(vFtwWNormal);
          float ftwWall = ftwWLen > 0.001 ? 1.0 - abs(dot(vFtwWNormal / ftwWLen, uFtwUp)) : 1.0;
          float ftwLit = smoothstep(${glf(BUILDINGS.nightWindowLitLo)}, ${glf(BUILDINGS.nightWindowLitHi)}, ftwHash11(vFtwBId + 71.0));
          totalEmissiveRadiance += uFtwWindow * (${glf(BUILDINGS.nightWindowGain)} * uFtwNight * ftwLit * ftwWall);
        }`,
      )
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        ${ftwFadeDiscard("uFtwFillBirthMs")}`,
      );
  };
  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(tokens.landHi), // lighter than the fill -> pronounced lit edges (design stroke)
    transparent: true,
    opacity: BUILDINGS.edgeOpacity,
  });
  // Edges ride the SAME per-tile screen-door reveal (LineBasicMaterial uses the 'basic' shader, so
  // it has <common> + <dithering_fragment>) — otherwise the lit strokes would pop in a frame before
  // the fill finished dissolving. Its own birth holder, written by the LineSegments' onBeforeRender.
  edgeMat.onBeforeCompile = (shader) => {
    shader.uniforms.uFtwNowMs = uNowMs;
    shader.uniforms.uFtwEdgeBirthMs = uEdgeBirthMs;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uFtwNowMs;
        uniform float uFtwEdgeBirthMs;
        ${FTW_BAYER_GLSL}`,
      )
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        ${ftwFadeDiscard("uFtwEdgeBirthMs")}`,
      );
  };
  // Ghost-mode edge opacity (lines can't ride the per-fragment fill curve — LineBasicMaterial
  // has no distance falloff worth a custom shader); setGhostSolid blends it back toward the
  // normal stroke as the viewpoint climbs.
  let ghostEdgeOpacity: number = BUILDINGS.edgeOpacity;
  // Pass 2 R2: a low-discrepancy per-tile seed sequence (golden-ratio increment — well-spread, no
  // Math.random) so tone doesn't repeat across tiles even when b3dm batch ids restart at 0 per tile.
  let tileSeedSeq = 0;
  // (S7c grow-on-zoom REMOVED 2026-07-11 same day — owner: unreliable. Buildings render at
  // full height whenever their tiles load; see DECISIONS for the reverted mechanics.)
  tiles.addEventListener("load-model", (e: any) => {
    // One birth stamp per TILE (this load-model event) — the whole b3dm dissolves in as a unit.
    const birthMs = performance.now();
    // Pass 2 R2: one low-discrepancy seed per TILE (golden-ratio increment) — see tileSeedSeq.
    const tileSeed = (tileSeedSeq++ * 0.6180339887498949) % 1.0;
    e.scene.traverse((c: any) => {
      if (c.isMesh) {
        const orig = c.material;
        c.material = styleMat; // ONE shared material is safe (disposed once, in dispose())
        if (orig && orig !== styleMat) orig.dispose(); // don't leak the original GLTF material per tile
        // F1 + Pass 2 R2: feed this tile's birth + tone seed to the shared fill material right
        // before this mesh draws (both constant per tile — cheap writes, no per-tile material).
        c.onBeforeRender = () => {
          uFillBirthMs.value = birthMs;
          uFtwTileSeed.value = tileSeed;
        };
        // Sun shadows (city scale): buildings cast onto the ground twins and onto each other.
        // Tiles arrive with both flags false — the shadow pass skips everything otherwise.
        c.castShadow = true;
        c.receiveShadow = true;
        // Pronounced edges: hard creases as line segments riding the mesh. The added child is
        // a LineSegments, so the isMesh branch skips it when traverse reaches it.
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(c.geometry, BUILDINGS.edgeAngleDeg),
          edgeMat,
        );
        edges.raycast = () => {}; // never let GlobeControls pick a decoration line
        edges.onBeforeRender = () => {
          uEdgeBirthMs.value = birthMs; // F1: same birth, its own holder (separate draw item)
        };
        c.add(edges);
      }
    });
  });
  tiles.addEventListener("dispose-model", (e: any) => {
    e.scene.traverse((c: any) => {
      // per-tile edge geometry only — edgeMat and styleMat are SHARED (disposed once, in dispose())
      if (c.isLineSegments) c.geometry.dispose();
    });
  });

  return {
    tiles,
    update() {
      uNowMs.value = performance.now(); // F1: advance the shared reveal clock before the draw
      tiles.update();
    },
    setGhost(ghost) {
      const wasTransparent = styleMat.transparent;
      styleMat.transparent = ghost !== null;
      // Alpha now lives entirely in the injected distance curve — opacity stays 1 so the
      // shader's mix() is the one source (uGhostK 0 renders identical to the pre-S6 look).
      uGhostK.value = ghost ? 1 : 0;
      if (ghost) uGhostAlpha.value = ghost.fillOpacity;
      ghostEdgeOpacity = ghost ? ghost.edgeOpacity : BUILDINGS.edgeOpacity;
      styleMat.depthWrite = ghost === null || uSolidK.value > 0.6; // ghosts must not occlude each other into solidity
      if (wasTransparent !== styleMat.transparent) styleMat.needsUpdate = true; // shader recompile
      edgeMat.opacity = ghost
        ? ghost.edgeOpacity + (BUILDINGS.edgeOpacity - ghost.edgeOpacity) * uSolidK.value
        : BUILDINGS.edgeOpacity;
    },
    setGhostSolid(k) {
      uSolidK.value = THREE.MathUtils.clamp(k, 0, 1);
      if (uGhostK.value > 0) {
        // Near-solid ghosts write depth again — a ~1.0-alpha transparent surface with
        // depthWrite off would show its own back faces through the front.
        styleMat.depthWrite = uSolidK.value > 0.6;
        edgeMat.opacity =
          ghostEdgeOpacity + (BUILDINGS.edgeOpacity - ghostEdgeOpacity) * uSolidK.value;
      }
    },
    setQualityTier(errorTarget, lruCapBytes) {
      tiles.errorTarget = errorTarget;
      tiles.lruCache.maxBytesSize = lruCapBytes ?? lruDefaultBytes; // null → captured default (high)
    },
    setNight(sunElevSin, up) {
      uFtwNight.value = buildingNightFactor(sunElevSin, EARTH.lightsBand);
      uFtwUp.value.copy(up); // R3: facade gating up (view-focus geodetic up)
    },
    dispose() {
      tiles.dispose();
      styleMat.dispose();
      edgeMat.dispose();
      draco.dispose();
      scene.remove(tiles.group);
    },
  };
}
