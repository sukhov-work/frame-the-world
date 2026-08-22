import * as THREE from "three";
import { tokens } from "../../../lib/theme/tokens";
import { BUILDINGS, ENRICHED, FPV } from "../tuning";
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
  /** ULTRA S4 — world-space direction TO the sun, for the forward-scattering term. The buildings
   *  never needed the sun VECTOR before (only its elevation, via `uFtwNight`). */
  uFtwSunW: { value: THREE.Vector3 };
}

export interface BuildingMaterialSet {
  fillMat: THREE.MeshStandardMaterial;
  edgeMat: THREE.LineBasicMaterial;
  uniforms: BuildingMaterialUniforms;
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
    uFtwSunW: { value: new THREE.Vector3(0, 0, 1) },
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
    shader.uniforms.uFtwSunW = uniforms.uFtwSunW;
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
        uniform vec3 uFtwSunW;
        ${FTW_BAYER_GLSL}
        ${FTW_HASH_GLSL}
        ${FTW_AERIAL_GLSL}`,
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
        gl_FragColor.rgb = ftwAerial(gl_FragColor.rgb, vFtwWPos, uFtwSunW, uFtwHaze, uFtwHazeCol);`,
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
          // Pass 2 R2: per-building tonal variation — a subtle ± on the fill albedo keyed by the
          // building hash, so the skyline reads as massing, not one uniform slab. toneVariation 0
          // makes mix(1,1,·)=1 → byte-identical to the pre-Pass-2 look (the no-op comparator).
          float ftwTone = ftwHash11(vFtwBId + 11.0);
          diffuseColor.rgb *= mix(${glf(1 - BUILDINGS.toneVariation)}, ${glf(1 + BUILDINGS.toneVariation)}, ftwTone);
          // U8 height-override tint: the ARMED run (raw-id match vs uFtwArmedId, −1 = none)
          // reads stronger than a COMMITTED override (the per-vertex mask) — "selected" vs
          // "edited". Accent through the D14 token bridge; both no-op at their defaults.
          float ftwArm = (uFtwArmedId >= 0.0 && abs(vFtwFid - uFtwArmedId) < 0.5) ? 1.0 : 0.0;
          float ftwOvK = max(ftwArm * ${glf(ENRICHED.overrideTintK)},
            vFtwOverride * ${glf(ENRICHED.overrideTintCommittedK)});
          diffuseColor.rgb = mix(diffuseColor.rgb, uFtwAccent, ftwOvK);
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
        uniform vec3 uFtwSunW;
        varying vec3 vFtwWPos;
        ${FTW_BAYER_GLSL}
        ${FTW_AERIAL_GLSL}`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `#include <opaque_fragment>
        gl_FragColor.rgb = ftwAerial(gl_FragColor.rgb, vFtwWPos, uFtwSunW, uFtwHaze, uFtwHazeCol);`,
      )
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        ${ftwFadeDiscard("uFtwEdgeBirthMs")}`,
      );
  };

  return { fillMat, edgeMat, uniforms };
}
