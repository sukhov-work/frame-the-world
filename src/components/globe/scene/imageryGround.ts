import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/core/plugins";
import {
  ImageOverlayPlugin,
  QuantizedMeshPlugin,
  TilesFadePlugin,
  UpdateOnChangePlugin,
  XYZTilesOverlay,
} from "3d-tiles-renderer/three/plugins";
import { tokens } from "../../../lib/theme/tokens";
import { EARTH, GATES, GOLDEN, GROUND, SHADOWS, SUN, TILESETS } from "../tuning";
import { glf } from "./glsl";

/**
 * Terrain ground — REAL elevation (Cesium World Terrain, ion asset 1, quantized-mesh) with Esri
 * World Imagery draped on top (ImageOverlayPlugin/XYZTilesOverlay), replacing the smooth-ellipsoid
 * GeneratedSurfacePlugin drape (2026-07-10 pre-Phase-4 pass). Hills and mountains are now
 * geometry; because OSM Buildings are height-clamped to this SAME terrain, building bases seat
 * without the old 90 m city-specific sink.
 *
 * Pipeline per tile (plugin priority order matters):
 *   QuantizedMeshPlugin (-1000, registered via the ion assetTypeHandler — NEVER up-front, its
 *   priority would make it fetch layer.json before the ion endpoint resolves)
 *   → our unlit swap (-100): MeshStandardMaterial → per-tile MeshBasicMaterial (keeps the globe's
 *     self-lit stylized look — scene lights only touch the buildings)
 *   → ImageOverlayPlugin (-15) composites Esri into `diffuseColor` after `color_fragment`
 *   → TilesFadePlugin wraps onBeforeCompile on load-model
 *   → our grade CHAINS last on load-model: palette grade + half-lambert off the REAL surface
 *     normal (slopes shade — mountains read; terminator continuous with the base) + moonlight
 *     + the altitude screen-door dissolve. Grade anchors at `alphamap_fragment` (AFTER the
 *     overlay's color_fragment injection — `map_fragment` would grade only the bare base colour).
 *
 * Shadows: MeshBasicMaterial cannot receive them (unlit, and three never binds shadow uniforms to
 * it), so each tile gets a ShadowMaterial twin riding the same geometry — fully transparent where
 * unshadowed, darkening where the sun shadow falls; toggled by altitude so orbit pays nothing.
 * Tunables: GROUND + GATES + TILESETS + SHADOWS. Attribution in the DOM (index.astro).
 */
export interface ImageryGroundHandle {
  tiles: TilesRenderer;
  /** Shared across every tile material — one value drives the whole layer. */
  uniforms: Record<string, THREE.IUniform>;
  /** Terrain height (m above the WGS84 ellipsoid) at a location, from loaded tiles; null while
   *  no tile covers it yet. Used to seat the photo frustum on the rendered ground. */
  heightAt(latDeg: number, lonDeg: number): number | null;
  /** Ground shadow darkness for the CURRENT shadow source (S5): the sun keeps
   *  SHADOWS.groundOpacity; moon-driven frames pass moonGroundOpacity × K&S intensity. */
  setShadowStrength(opacity: number): void;
  /** Per-frame: altitude gate + screen-door fade + shadow-overlay gate + tile refinement. */
  update(alt: number): void;
  dispose(): void;
}

export function attachImageryGround(
  scene: THREE.Scene,
  opts: {
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    ionToken: string;
  },
): ImageryGroundHandle {
  const tiles = new TilesRenderer();
  tiles.registerPlugin(
    new CesiumIonAuthPlugin({
      apiToken: opts.ionToken,
      assetId: TILESETS.terrainAssetId,
      autoRefreshToken: true,
      assetTypeHandler: (type, tilesRenderer) => {
        if (type === "TERRAIN") {
          tilesRenderer.registerPlugin(new QuantizedMeshPlugin({}));
        }
      },
    }),
  );
  // Unlit swap — must run BEFORE ImageOverlayPlugin (-15) wraps materials, hence priority -100.
  const swappedMats = new WeakSet<THREE.Material>();
  tiles.registerPlugin({
    name: "FTW_UNLIT_TERRAIN_PLUGIN",
    priority: -100,
    processTileModel(tileScene: THREE.Object3D) {
      tileScene.traverse((c: any) => {
        if (c.isMesh && c.material) {
          const orig = c.material as THREE.Material;
          const basic = new THREE.MeshBasicMaterial();
          basic.polygonOffset = true; // imagery sits behind building footprints (bases win ties)
          basic.polygonOffsetFactor = GROUND.polygonOffset;
          basic.polygonOffsetUnits = GROUND.polygonOffset;
          c.material = basic;
          swappedMats.add(basic);
          orig.dispose();
        }
      });
    },
  } as any);
  // Per-tile dissolve. Options are load-bearing (2026-07-10 soft-loading pass): the library
  // defaults hard-pop root tiles (fadeRootTiles=false) and SNAP-complete all fades whenever >50
  // tiles fade out on a moving camera — and the idle drift moves the camera every frame, so the
  // initial load read as a patchwork of pops instead of dissolves.
  tiles.registerPlugin(
    new TilesFadePlugin({
      fadeRootTiles: true,
      fadeDuration: GROUND.fadeDurationMs,
      maximumFadeOutTiles: GROUND.maxFadeOutTiles,
    }),
  );
  const uocPlugin = new UpdateOnChangePlugin(); // only re-tile when the camera actually moves
  tiles.registerPlugin(uocPlugin);
  const overlayPlugin = new ImageOverlayPlugin({
    renderer: opts.renderer,
    resolution: GROUND.overlayResolution,
    overlays: [
      new XYZTilesOverlay({
        url: TILESETS.esriImageryUrl,
        levels: TILESETS.esriMaxLevel,
      }),
    ],
  });
  tiles.registerPlugin(overlayPlugin);
  tiles.setCamera(opts.camera);
  tiles.setResolutionFromRenderer(opts.camera, opts.renderer);
  tiles.group.visible = false; // revealed by altitude in update()
  scene.add(tiles.group);

  // --- Initial-load readiness: the layer must not reveal before tiles exist (page open at LEO is
  //     already below the fade band → uFtwFade used to snap to 1 on frame 1 over ZERO loaded
  //     tiles — the ugly patchwork). loadProgress gates the reveal until the first full drain. --
  let initialLoadStarted = false;
  let initialLoadEnded = false;
  tiles.addEventListener("tiles-load-start", () => {
    initialLoadStarted = true;
  });
  tiles.addEventListener("tiles-load-end", () => {
    initialLoadEnded = true;
  });
  // Failed Esri fetches otherwise leave PERMANENTLY blank (ungraded slate) tiles — the plugin
  // never retries unless resetFailedOverlays() is called. Debounced so an offline burst retries
  // once, not per-tile.
  let overlayRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const onLoadError = () => {
    if (overlayRetryTimer !== null) return;
    overlayRetryTimer = setTimeout(() => {
      overlayRetryTimer = null;
      (overlayPlugin as any).resetFailedOverlays?.();
    }, GROUND.overlayRetryMs);
  };
  tiles.addEventListener("load-error", onLoadError);

  const uniforms = {
    uFtwFade: { value: 0 }, // 0 = invisible (all fragments discarded) … 1 = fully present
    uFtwHiAlt: { value: 0 }, // 1 − altFade: high-altitude grade harmonizer (mixed Esri zooms)
    uFtwSun: { value: new THREE.Vector3(...SUN.direction).normalize() },
    uFtwMoonDir: { value: new THREE.Vector3(0, 0, 1) },
    uFtwMoonGlow: { value: 0 }, // SKY.moonSceneGlow × illuminated fraction (per ephemeris sample)
    uFtwMoonCol: { value: new THREE.Color(tokens.moonlight) },
    uFtwGoldenCol: { value: new THREE.Color(tokens.goldenHour) },
    uFtwNightFloor: { value: GROUND.nightFloor },
    uFtwDesat: { value: GROUND.desat },
    uFtwGain: { value: GROUND.gain },
    uFtwCast: { value: new THREE.Vector3(...GROUND.cast) },
  };
  const gradeGround = (shader: any) => {
    shader.uniforms = { ...shader.uniforms, ...uniforms };
    shader.vertexShader = shader.vertexShader.replace(
      /void\s+main\(\)\s*{/,
      (v: string) => `varying vec3 vFtwW;\nvarying vec3 vFtwN;\n${v}`,
    ).replace(
      /#include <project_vertex>/,
      (v: string) =>
        `${v}\n  vFtwW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n` +
        `  vFtwN = normalize(mat3(modelMatrix) * vec3(normal));`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      /void main\(/,
      (v: string) => /* glsl */ `
        varying vec3 vFtwW;
        varying vec3 vFtwN;
        uniform float uFtwFade;
        uniform float uFtwHiAlt;
        uniform vec3 uFtwSun;
        uniform vec3 uFtwMoonDir;
        uniform float uFtwMoonGlow;
        uniform vec3 uFtwMoonCol;
        uniform vec3 uFtwGoldenCol;
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
      // AFTER the ImageOverlayPlugin composite (which injects at color_fragment) — anchoring at
      // map_fragment would grade the bare white base and leave the Esri imagery untouched.
      /#include <alphamap_fragment>/,
      (v: string) => /* glsl */ `${v}
        {
          // palette grade + NARROW terminator off the REAL surface normal (EARTH.termBand twin of
          // baseEarth — keep in sync): slopes shade (mountains read as 3D) and the day/night
          // transition stays continuous with the stylized base.
          vec3 nS = normalize(vFtwN);
          float sunDot = dot(nS, normalize(uFtwSun));
          float dayK = smoothstep(${glf(EARTH.termBand[0])}, ${glf(EARTH.termBand[1])}, sunDot);
          float dayShade = mix(${glf(EARTH.dayGradMin)}, 1.0, sqrt(max(sunDot, 0.0)));
          float shade = mix(uFtwNightFloor, dayShade, dayK);
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          // high-altitude harmonizer: extra desaturation converges mixed Esri source zooms
          // (washed low-zoom mosaic vs crisp high-zoom texture) so they stop reading as patches
          float desatEff = mix(uFtwDesat, ${glf(GROUND.hiAltDesat)}, uFtwHiAlt);
          vec3 graded = mix(diffuseColor.rgb, vec3(lum), desatEff) * uFtwGain * uFtwCast;
          // blue-dominant pixels = water -> pull toward the instrument's near-black ocean so the
          // imagery's bright seas never punch through the dark palette (rivers/lakes stay slate too)
          float waterness = smoothstep(0.0, ${glf(GROUND.waterThreshold)}, diffuseColor.b - max(diffuseColor.r, diffuseColor.g));
          graded *= mix(1.0, ${glf(GROUND.waterDarken)}, waterness);
          // golden-hour cast where the sun grazes the local horizon (bell over sin(elevation);
          // GLSL twin of lib/ephemeris/golden.ts — keep in sync with tuning.GOLDEN + baseEarth)
          float gold = smoothstep(${glf(GOLDEN.fadeInLo)}, ${glf(GOLDEN.fadeInHi)}, sunDot)
                     * (1.0 - smoothstep(${glf(GOLDEN.fadeOutLo)}, ${glf(GOLDEN.fadeOutHi)}, sunDot));
          graded *= mix(vec3(1.0), uFtwGoldenCol * ${glf(GOLDEN.castGain)}, gold * ${glf(GOLDEN.groundStrength)});
          // cool moonlight lifts the night side by phase (the day side term is negligible vs sun)
          float night = 1.0 - smoothstep(${glf(EARTH.lightsBand[0])}, ${glf(EARTH.lightsBand[1])}, sunDot);
          vec3 moonlit = graded * uFtwMoonCol * (max(dot(nS, uFtwMoonDir), 0.0) * uFtwMoonGlow * night);
          diffuseColor.rgb = graded * shade + moonlit;
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

  // Shadow twins: ShadowMaterial renders alpha 0 where unshadowed, so the twin is invisible until
  // the sun shadow pass is active; still costs a draw, so update() hides them above SHADOWS.maxAltM.
  // Tinted toward the palette's deep water rather than pure black — real shadows are sky-lit cool,
  // and the cool cast reads on the dark graded ground where a black multiply melts in.
  const shadowMat = new THREE.ShadowMaterial({
    color: new THREE.Color(tokens.water),
    opacity: SHADOWS.groundOpacity,
    depthWrite: false,
  });
  shadowMat.polygonOffset = true; // pull toward the viewer so the twin wins the depth tie
  shadowMat.polygonOffsetFactor = -1;
  shadowMat.polygonOffsetUnits = -1;
  const shadowTwins = new Set<THREE.Mesh>();
  let shadowsActive = false;

  tiles.addEventListener("load-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh && c.material && swappedMats.has(c.material)) {
        // CHAIN (never assign) — TilesFadePlugin has already wrapped onBeforeCompile for its fade.
        const mat = c.material;
        const prev = mat.onBeforeCompile;
        mat.onBeforeCompile = (shader: any, r: any) => {
          if (prev) prev(shader, r);
          gradeGround(shader);
        };
        mat.needsUpdate = true;
        // shadow twin on the same geometry (geometry ownership stays with the tile)
        const twin = new THREE.Mesh(c.geometry, shadowMat);
        twin.receiveShadow = true;
        twin.visible = shadowsActive;
        twin.raycast = () => {}; // heightAt() must hit the terrain, not the twin
        shadowTwins.add(twin);
        c.add(twin);
      }
    });
  });
  tiles.addEventListener("dispose-model", (e: any) => {
    e.scene.traverse((c: any) => {
      if (c.isMesh && swappedMats.has(c.material)) c.material.dispose(); // our per-tile Basic swap
      if (c.isMesh && c.material === shadowMat) shadowTwins.delete(c);
    });
  });

  // Down-ray terrain sampler (the QueryManager pattern from the library's r3f utilities).
  const _rayOrigin = new THREE.Vector3();
  const _rayDir = new THREE.Vector3();
  const _raycaster = new THREE.Raycaster();
  let lastRevealMs = performance.now();

  return {
    tiles,
    uniforms,
    heightAt(latDeg, lonDeg) {
      const latRad = (latDeg * Math.PI) / 180;
      const lonRad = (lonDeg * Math.PI) / 180;
      WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, 12_000, _rayOrigin);
      WGS84_ELLIPSOID.getCartographicToNormal(latRad, lonRad, _rayDir);
      _raycaster.set(_rayOrigin, _rayDir.negate());
      _raycaster.far = 24_000;
      const hit = _raycaster.intersectObjects(tiles.group.children, true)[0];
      if (!hit) return null;
      return WGS84_ELLIPSOID.getPositionElevation(hit.point);
    },
    setShadowStrength(opacity) {
      shadowMat.opacity = opacity; // ONE shared material — every twin follows
    },
    update(alt) {
      // Active below GATES.groundActiveAlt; the layer screen-door-dissolves in across the fade band
      // so real terrain grows organically out of the stylized base (no switch), then keeps
      // LOD-refining (Esri z19 overlay + TilesFadePlugin) all the way to street level.
      const on = alt < GATES.groundActiveAlt;
      tiles.group.visible = on;
      if (!on) return;
      // Adaptive screen-space error: coarse tiles at orbit reach full coverage fast; diving
      // ramps the target back down to QuantizedMeshPlugin's fine default so cities stay sharp.
      tiles.errorTarget = THREE.MathUtils.mapLinear(
        THREE.MathUtils.clamp(alt, GROUND.errorNearAlt, GROUND.errorFarAlt),
        GROUND.errorNearAlt,
        GROUND.errorFarAlt,
        GROUND.errorTargetNear,
        GROUND.errorTargetFar,
      );
      // Reveal = altitude dissolve × initial-load readiness, low-passed (frame-rate independent)
      // so the layer grows out of the stylized base once tiles actually exist — never a snap.
      const altFade = THREE.MathUtils.clamp(
        (GATES.groundFadeTop - alt) / (GATES.groundFadeTop - GATES.groundFadeBottom),
        0,
        1,
      );
      const readiness = initialLoadEnded
        ? 1
        : initialLoadStarted
          ? THREE.MathUtils.clamp(tiles.loadProgress, 0, 1) * GROUND.revealProgressCap
          : 0;
      const now = performance.now();
      const dtMs = Math.min(now - lastRevealMs, 100);
      lastRevealMs = now;
      const k = 1 - Math.exp(-dtMs / GROUND.revealTauMs);
      uniforms.uFtwFade.value += (altFade * readiness - uniforms.uFtwFade.value) * k;
      uniforms.uFtwHiAlt.value = 1 - altFade; // harmonize the grade while the base shows through
      // Keep refinement ticking through the initial load even if the camera is static (reduced
      // motion disables the drift; UpdateOnChangePlugin would otherwise stall until a zoom).
      if (!initialLoadEnded) (uocPlugin as any).needsUpdate = true;
      const wantShadows = alt < SHADOWS.maxAltM;
      if (wantShadows !== shadowsActive) {
        shadowsActive = wantShadows;
        for (const twin of shadowTwins) twin.visible = shadowsActive;
      }
      tiles.update();
    },
    dispose() {
      if (overlayRetryTimer !== null) clearTimeout(overlayRetryTimer);
      tiles.removeEventListener("load-error", onLoadError);
      shadowMat.dispose();
      shadowTwins.clear();
      tiles.dispose();
      scene.remove(tiles.group);
    },
  };
}
