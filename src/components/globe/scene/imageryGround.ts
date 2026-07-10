import * as THREE from "three";
import { TilesRenderer } from "3d-tiles-renderer";
import {
  TilesFadePlugin,
  UpdateOnChangePlugin,
  XYZTilesOverlay,
} from "3d-tiles-renderer/three/plugins";
// GeneratedSurfacePlugin is present at runtime (plugins index.js re-exports it) but ships without a
// .d.ts in 0.4.28, so TS can't see it. Runtime-correct; type-suppressed.
// @ts-expect-error - untyped export in 3d-tiles-renderer@0.4.28
import { GeneratedSurfacePlugin } from "3d-tiles-renderer/three/plugins";
import { GATES, GROUND, SUN, TILESETS } from "../tuning";
import { glf } from "./glsl";

/**
 * Refining imagery ground — a SECOND TilesRenderer draping real satellite imagery (Esri World
 * Imagery, z19 street-level detail) on the WGS84 ellipsoid. Each generated tile mesh is a
 * MeshBasicMaterial with the overlay texture as `map` (GeneratedSurfacePlugin.js parseToMesh),
 * so we chain onBeforeCompile to (a) grade it into the instrument's palette — desaturate,
 * darken, cool cast — (b) apply the SAME half-lambert sun shading as the base so the terminator
 * is continuous across LODs, and (c) screen-door-dissolve the whole layer in by altitude
 * (bayer discard, same technique TilesFadePlugin uses per-tile — no transparency sorting).
 * Result: descending from orbit, real terrain detail grows organically INSIDE the stylized
 * earth; there is no "switch". Attribution is shown in the DOM (index.astro).
 * Tunables: GROUND + GATES + TILESETS.
 */
export interface ImageryGroundHandle {
  tiles: TilesRenderer;
  /** Shared across every tile material — one value drives the whole layer. */
  uniforms: Record<string, THREE.IUniform>;
  /** Per-frame: altitude gate + screen-door fade + tile refinement. */
  update(alt: number): void;
  dispose(): void;
}

export function attachImageryGround(
  scene: THREE.Scene,
  opts: { camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; maxAniso: number },
): ImageryGroundHandle {
  const overlay = new XYZTilesOverlay({
    url: TILESETS.esriImageryUrl,
    levels: TILESETS.esriMaxLevel,
  });
  const tiles = new TilesRenderer();
  tiles.registerPlugin(new TilesFadePlugin()); // per-tile fade-in (the gradual reveal), no popping
  tiles.registerPlugin(new UpdateOnChangePlugin()); // only re-tile when the camera actually moves
  tiles.registerPlugin(
    new GeneratedSurfacePlugin({
      overlay,
      shape: "ellipsoid",
      applyOverlayTexture: true,
    }),
  );
  tiles.setCamera(opts.camera);
  tiles.setResolutionFromRenderer(opts.camera, opts.renderer);
  tiles.group.visible = false; // revealed by altitude in update()
  scene.add(tiles.group);

  const uniforms = {
    uFtwFade: { value: 0 }, // 0 = invisible (all fragments discarded) … 1 = fully present
    uFtwSun: { value: new THREE.Vector3(...SUN.direction).normalize() },
    uFtwNightFloor: { value: GROUND.nightFloor },
    uFtwDesat: { value: GROUND.desat },
    uFtwGain: { value: GROUND.gain },
    uFtwCast: { value: new THREE.Vector3(...GROUND.cast) },
  };
  const gradeGround = (shader: any) => {
    shader.uniforms = { ...shader.uniforms, ...uniforms };
    shader.vertexShader = shader.vertexShader.replace(
      /void\s+main\(\)\s*{/,
      (v: string) => `varying vec3 vFtwW;\n${v}`,
    ).replace(
      /#include <project_vertex>/,
      (v: string) => `${v}\n  vFtwW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      /void main\(/,
      (v: string) => /* glsl */ `
        varying vec3 vFtwW;
        uniform float uFtwFade;
        uniform vec3 uFtwSun;
        uniform float uFtwNightFloor;
        uniform float uFtwDesat;
        uniform float uFtwGain;
        uniform vec3 uFtwCast;
        float ftwBayer2(vec2 v) { return mod(3.0 * v.y + 2.0 * v.x, 4.0); }
        float ftwBayer4(vec2 v) {
          vec2 P1 = mod(v, 2.0);
          vec2 P2 = floor(0.5 * mod(v, 4.0));
          return 4.0 * ftwBayer2(P1) + ftwBayer2(P2);
        }
        ${v}`,
    ).replace(
      /#include <map_fragment>/,
      (v: string) => /* glsl */ `${v}
        {
          // palette grade + the SAME sun shading as the stylized base (continuous terminator)
          vec3 nW = normalize(vFtwW);
          float wrap = dot(nW, normalize(uFtwSun)) * 0.5 + 0.5;
          float shade = mix(uFtwNightFloor, 1.0, wrap * wrap);
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 graded = mix(diffuseColor.rgb, vec3(lum), uFtwDesat) * uFtwGain * uFtwCast;
          // blue-dominant pixels = water -> pull toward the instrument's near-black ocean so the
          // imagery's bright seas never punch through the dark palette (rivers/lakes stay slate too)
          float waterness = smoothstep(0.0, ${glf(GROUND.waterThreshold)}, diffuseColor.b - max(diffuseColor.r, diffuseColor.g));
          graded *= mix(1.0, ${glf(GROUND.waterDarken)}, waterness);
          diffuseColor.rgb = graded * shade;
        }`,
    ).replace(
      /#include <dithering_fragment>/,
      (v: string) => /* glsl */ `${v}
        {
          // altitude screen-door dissolve for the WHOLE imagery layer (offset vs TilesFadePlugin's grid)
          float fb = ftwBayer4(floor(mod(gl_FragCoord.xy + ${glf(GROUND.bayerOffsetPx)}, 4.0)));
          if ((0.5 + fb) / 16.0 > uFtwFade) discard;
        }`,
    );
  };
  tiles.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh && c.material) {
        const mat = c.material;
        // Push the imagery surface just behind the building footprints so building bases win the tie.
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = GROUND.polygonOffset;
        mat.polygonOffsetUnits = GROUND.polygonOffset;
        if (mat.map) {
          mat.map.anisotropy = opts.maxAniso; // oblique LEO/city views sample imagery at grazing angles
          mat.map.colorSpace = THREE.SRGBColorSpace;
          mat.map.needsUpdate = true;
        }
        // CHAIN (never assign) — TilesFadePlugin has already wrapped onBeforeCompile for its own fade.
        const prev = mat.onBeforeCompile;
        mat.onBeforeCompile = (shader: any, r: any) => {
          if (prev) prev(shader, r);
          gradeGround(shader);
        };
        mat.needsUpdate = true;
      }
    });
  });

  return {
    tiles,
    uniforms,
    update(alt) {
      // Active below GATES.groundActiveAlt; the layer screen-door-dissolves in across the fade band
      // so real terrain detail grows organically out of the stylized base (no switch), then keeps
      // LOD-refining (Esri z19 + TilesFadePlugin) all the way to street level.
      const on = alt < GATES.groundActiveAlt;
      tiles.group.visible = on;
      if (!on) return;
      uniforms.uFtwFade.value = THREE.MathUtils.clamp(
        (GATES.groundFadeTop - alt) / (GATES.groundFadeTop - GATES.groundFadeBottom),
        0,
        1,
      );
      tiles.update();
    },
    dispose() {
      tiles.dispose();
      scene.remove(tiles.group);
    },
  };
}
