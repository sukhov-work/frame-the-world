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
import {
  lruFloorBytesForCap,
  type FoveationTierCfg,
  type QueueCaps,
} from "../../../lib/globe/quality";
import { DRAPE, EARTH, FOVEATION, GATES, GOLDEN, GROUND, SHADOWS, SUN, TILESETS } from "../tuning";
import { glf, glf3 } from "./glsl";
import { makeTileFoveation } from "./tileFoveation";
import { hookTerrainPatch, makeTerrainPatchFetchPlugin, type TerrainPatchOpts } from "./terrainPatch";

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
   *  SHADOWS.groundOpacity; moon-driven frames pass moonGroundOpacity × K&S intensity.
   *  S7a: the orchestrator blends sun/moon opacity toward the DRAPE.*shadowOpacity knobs
   *  by darkBlend() before passing it in — per-mode shadow contrast. */
  setShadowStrength(opacity: number): void;
  /** Live dark-drape fraction (0 = Esri look, 1 = CARTO dark) — eased inside update(). */
  darkBlend(): number;
  /** DPR-aware SSE resolution (owner 2026-08-18 sharpness batch): setResolutionFromRenderer
   *  feeds CSS px, so a retina screen refined no deeper than a 1× one — this renderer alone
   *  spends its error budget in DEVICE px (imagery density matches the glass; buildings keep
   *  CSS-px SSE). Call after any resize / pixel-ratio change. */
  refreshResolution(): void;
  /** Per-frame: altitude gate + screen-door fade + dark-drape crossfade + shadow-overlay gate
   *  + tile refinement. `darkGround` = camera.groundMode !== 'satellite'; `flat2d` = the /m 2D
   *  map (sharper near-error target — buildings are detached there, the budget is free — and
   *  no shadow twins: nothing casts). */
  update(alt: number, darkGround: boolean, flat2d: boolean): void;
  /** Adaptive quality (RENDERING_QUALITY_PASS WS1): raise the NEAR-altitude error target (coarser
   *  terrain, fewer tiles at street level) + bound this renderer's LRU bytes on weaker tiers.
   *  `lruCapBytes` is resolved by `lruCapBytesForTier`; `null` restores the captured library default
   *  (the `high` path — byte-identical). U5: `queueCaps` bounds download/parse concurrency the same
   *  way — this renderer KEEPS ancestors + library ordering (the terrain stand-in under the camera),
   *  only its concurrency rides the tier. */
  setQualityTier(errorNear: number, lruCapBytes: number | null, queueCaps: QueueCaps | null): void;
  /** UPLIFT U6: per-tier foveation config (null = off). GROUND foveation is purely ADDITIVE —
   *  sharper terrain along the look ray + around the eye; the base errorTarget (the altitude
   *  ramp above) is NEVER relaxed here: heightAt seats buildings/frustum/FPV on this renderer,
   *  and regions only tighten, so seating can only get truer at the fovea. */
  setFoveation(cfg: FoveationTierCfg | null): void;
  /** UPLIFT U6: FPV boundary flip — regions on/off. */
  setFoveaActive(on: boolean): void;
  /** UPLIFT U6: per-frame WORLD eye + unit look while foveated. */
  setFoveaPose(eyeWorld: THREE.Vector3, fwdWorld: THREE.Vector3): void;
  /** DEV probe (__globe.u6()). */
  foveaSnapshot(): { engaged: boolean; baseErrorTarget: number };
  dispose(): void;
}

export function attachImageryGround(
  scene: THREE.Scene,
  opts: {
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    ionToken: string;
    /** Self-baked GLO-30 terrain patch (scene/terrainPatch.ts) — null/absent = pure CWT,
     *  byte-identical to before the bake slice. NEVER user-facing: the registry + env decide. */
    terrainPatch?: TerrainPatchOpts | null;
  },
): ImageryGroundHandle {
  const tiles = new TilesRenderer();
  // RENDERING_QUALITY_PASS WS1: this renderer's own LRU byte default (restored on `high`) + the
  // live near-altitude error endpoint (GROUND.errorTargetNear on high; raised on mid/low).
  const lruDefaultBytes = tiles.lruCache.maxBytesSize;
  const lruDefaultMinBytes = tiles.lruCache.minBytesSize; // U2/A9: min/max travel as a pair
  const dlJobsDefault = tiles.downloadQueue.maxJobs; // U5: restored on `high`
  const parseJobsDefault = tiles.parseQueue.maxJobs;
  let errorNearOverride: number = GROUND.errorTargetNear;
  tiles.registerPlugin(
    new CesiumIonAuthPlugin({
      apiToken: opts.ionToken,
      assetId: TILESETS.terrainAssetId,
      autoRefreshToken: true,
      assetTypeHandler: (type, tilesRenderer) => {
        if (type === "TERRAIN") {
          const qm = new QuantizedMeshPlugin({});
          // GLO-30 patch composite (U7→bake slice): wrap createChild BEFORE registration — the
          // plugin loads layer.json on init, so every tile ever created passes the serve-set
          // rule (terrainPatch.ts). Absent patch → the stock plugin, byte-identical.
          if (opts.terrainPatch) {
            hookTerrainPatch(
              qm as unknown as Parameters<typeof hookTerrainPatch>[0],
              opts.terrainPatch.base,
              opts.terrainPatch.cfgs,
            );
          }
          tilesRenderer.registerPlugin(qm);
        }
      },
    }),
  );
  // The patch fetch claimer (plain fetch — the ion Bearer never reaches the patch CDN).
  if (opts.terrainPatch) {
    tiles.registerPlugin(makeTerrainPatchFetchPlugin(opts.terrainPatch.base) as never);
  }
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
  // U6 foveated FPV loading — ADDITIVE only on this renderer (see the handle doc): the adapter
  // dispatches `needs-update` on region flips, so UpdateOnChangePlugin re-traverses even with a
  // parked camera.
  const fovea = makeTileFoveation(tiles, FOVEATION.regionErrorTargetM.ground);
  tiles.registerPlugin(fovea.plugin);
  // S7a overlay stack (composited bottom-up per tile; each `opacity` is a LIVE uniform — the
  // wrap shader reads layerInfo[i].opacity every frame, so the dark↔Esri crossfade is a plain
  // per-frame write, no re-composite): Esri imagery → CARTO dark drape. (Street names are the
  // VECTOR layer scene/streetNames.ts — a draped raster label overlay was tried and dropped:
  // blurry, and raster text cannot scale with zoom.)
  // `levels` is a COUNT (the library's generateLevels sets maxLevel = levels − 1) — passing the
  // max level directly capped Esri at z18 / CARTO at z19, one below what the sources serve
  // (the 2026-08-18 sharpness batch off-by-one).
  const cartoDark = new XYZTilesOverlay({
    url: TILESETS.cartoDarkUrl,
    levels: TILESETS.cartoMaxLevel + 1,
    opacity: 0,
  });
  // The dark drape attaches ONLY in dark ground mode (2026-08-18 speed batch): registered
  // up-front with opacity 0 it fetched + composited a full second tile chain for zero pixels —
  // the default mode is satellite, so most sessions paid 2× imagery for nothing. delete→add is
  // the plugin's own re-order idiom (ImageOverlayPlugin.js:154-155), so the flip is safe live.
  let cartoAttached = false;
  const overlayPlugin = new ImageOverlayPlugin({
    renderer: opts.renderer,
    resolution: GROUND.overlayResolution,
    overlays: [
      new XYZTilesOverlay({
        url: TILESETS.esriImageryUrl,
        levels: TILESETS.esriMaxLevel + 1,
      }),
    ],
  });
  tiles.registerPlugin(overlayPlugin);
  // U6 guard — upstream 0.4.28 bug (re-verify on any version bump): the overlay plugin's
  // 'tile-visibility-change' listener reads `tileInfo.get(tile).range` UNGUARDED
  // (ImageOverlayPlugin.js:230) while every other consumer in the file checks
  // `tileInfo.has(tile)` first. TilesFadePlugin defers visibility flips to fade-complete, so a
  // tile disposed mid-fade delivers the event AFTER its entry was deleted → TypeError inside
  // dispatchEvent (aborts the remaining listeners of that dispatch). Latent before U6; the
  // foveation region flips (forced tiles fading while dropped) hit it reliably. Swap in the
  // same body with the has-guard the library itself uses elsewhere.
  {
    const p = overlayPlugin as unknown as {
      _onTileVisibilityChange: (e: { tile: object; visible: boolean }) => void;
      overlayInfo: Map<
        { setRegionVisible(range: unknown, visible: boolean): void },
        { tileInfo: Map<object, { range: unknown }> }
      >;
    };
    const unguarded = p._onTileVisibilityChange;
    tiles.removeEventListener("tile-visibility-change", unguarded as any);
    p._onTileVisibilityChange = ({ tile, visible }) => {
      p.overlayInfo.forEach(({ tileInfo }, overlay) => {
        const info = tileInfo.get(tile);
        if (info) overlay.setRegionVisible(info.range, visible);
      });
    };
    tiles.addEventListener("tile-visibility-change", p._onTileVisibilityChange as any);
  }
  tiles.setCamera(opts.camera);
  const refreshResolution = () => {
    const size = opts.renderer.getSize(new THREE.Vector2());
    const dpr = opts.renderer.getPixelRatio();
    tiles.setResolution(opts.camera, Math.round(size.x * dpr), Math.round(size.y * dpr));
  };
  refreshResolution();
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
    uFtwDark: { value: 0 }, // S7a dark-drape fraction: 0 = Esri grade … 1 = flat dark grade
    uFtwFlat2d: { value: 0 }, // /m 2D map: forces day grading (a planning chart reads around the clock)
    uFtwSun: { value: new THREE.Vector3(...SUN.direction).normalize() },
    uFtwMoonDir: { value: new THREE.Vector3(0, 0, 1) },
    uFtwMoonGlow: { value: 0 }, // SKY.moonSceneGlow × illuminated fraction (per ephemeris sample)
    uFtwMoonCol: { value: new THREE.Color(tokens.moonlight) },
    uFtwGoldenCol: { value: new THREE.Color(tokens.goldenHour) },
    uFtwNightFloor: { value: GROUND.nightFloor },
    uFtwDesat: { value: GROUND.desat },
    uFtwGain: { value: GROUND.gain },
    uFtwCast: { value: new THREE.Vector3(...GROUND.cast) },
    // S7 feedback ("ground jarringly black"): additive ambient floors — cool skylight by day,
    // faint moonlight by night — so a dark source pixel can never multiply to pitch black.
    // Live-tunable via __globe.groundUniforms in DEV.
    uFtwAmbDay: {
      value: new THREE.Color(tokens.skyHorizon).multiplyScalar(GROUND.ambientDayK),
    },
    uFtwAmbNight: { value: GROUND.ambientNightK },
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
        uniform float uFtwDark;
        uniform float uFtwFlat2d;
        uniform vec3 uFtwSun;
        uniform vec3 uFtwMoonDir;
        uniform float uFtwMoonGlow;
        uniform vec3 uFtwMoonCol;
        uniform vec3 uFtwGoldenCol;
        uniform float uFtwNightFloor;
        uniform float uFtwDesat;
        uniform float uFtwGain;
        uniform vec3 uFtwCast;
        uniform vec3 uFtwAmbDay;
        uniform float uFtwAmbNight;
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
          // palette grade + NARROW terminator (EARTH.termBand twin of baseEarth — keep in sync).
          // S7 feedback ("uniform illumination"): the day/night gate now reads the GEODETIC up
          // (solar elevation — is it daytime HERE?), not the surface normal — a noon hillside
          // facing away from the sun used to fall to the night floor. Slope relief stays via
          // dayShade off the REAL normal, bounded at dayGradMin, never plunging to night.
          vec3 nS = normalize(vFtwN);
          vec3 nUp = normalize(vFtwW);
          float sunDot = dot(nS, normalize(uFtwSun));
          float sunUpDot = dot(nUp, normalize(uFtwSun));
          float dayK = smoothstep(${glf(EARTH.termBand[0])}, ${glf(EARTH.termBand[1])}, sunUpDot);
          // /m 2D map (owner 2026-08-18): a planning chart reads around the clock — the eased
          // uFtwFlat2d forces day grading (and the moon/golden adds fade with their own gates).
          dayK = max(dayK, uFtwFlat2d);
          float dayShade = mix(${glf(EARTH.dayGradMin)}, 1.0, sqrt(max(sunDot, 0.0)));
          // S7a dark drape: the Esri grade blends OUT and a UNIFORM flat shade blends IN as
          // uFtwDark rises (the CARTO overlay already owns diffuseColor by then) — the water
          // detection / desat / hiAlt harmonizer are Esri-colorimetry-specific and go with it.
          float shade = mix(
            mix(uFtwNightFloor, dayShade, dayK),
            mix(${glf(DRAPE.nightFloor)}, ${glf(DRAPE.dayShade)}, dayK),
            uFtwDark);
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          // high-altitude harmonizer: extra desaturation converges mixed Esri source zooms
          // (washed low-zoom mosaic vs crisp high-zoom texture) so they stop reading as patches
          float desatEff = mix(uFtwDesat, ${glf(GROUND.hiAltDesat)}, uFtwHiAlt) * (1.0 - uFtwDark);
          vec3 graded = mix(diffuseColor.rgb, vec3(lum), desatEff)
            * mix(uFtwGain, ${glf(DRAPE.gain)}, uFtwDark)
            * mix(uFtwCast, ${glf3(DRAPE.cast)}, uFtwDark);
          // blue-dominant pixels = water -> pull toward the instrument's near-black ocean so the
          // imagery's bright seas never punch through the dark palette (rivers/lakes stay slate too)
          float waterness = smoothstep(0.0, ${glf(GROUND.waterThreshold)}, diffuseColor.b - max(diffuseColor.r, diffuseColor.g))
            * (1.0 - uFtwDark);
          graded *= mix(1.0, ${glf(GROUND.waterDarken)}, waterness);
          // golden-hour cast where the sun grazes the local horizon (bell over sin(elevation);
          // GLSL twin of lib/ephemeris/golden.ts — keep in sync with tuning.GOLDEN + baseEarth).
          // Over SOLAR elevation (sunUpDot) — golden hour is a time of day, not a slope angle.
          float gold = smoothstep(${glf(GOLDEN.fadeInLo)}, ${glf(GOLDEN.fadeInHi)}, sunUpDot)
                     * (1.0 - smoothstep(${glf(GOLDEN.fadeOutLo)}, ${glf(GOLDEN.fadeOutHi)}, sunUpDot));
          graded *= mix(vec3(1.0), uFtwGoldenCol * ${glf(GOLDEN.castGain)}, gold * ${glf(GOLDEN.groundStrength)});
          // Night gate over solar elevation (twin of EARTH.lightsBand).
          float night = 1.0 - smoothstep(${glf(EARTH.lightsBand[0])}, ${glf(EARTH.lightsBand[1])}, sunUpDot);
          float moonUp = max(dot(nUp, uFtwMoonDir), 0.0);
          // Moonlight, two terms (S7 feedback): the albedo-scaled sheen (graded×moon — black
          // stays black) + a small NON-albedo fill so the moon actually LIFTS the dark ground.
          vec3 moonlit = graded * uFtwMoonCol * (max(dot(nS, uFtwMoonDir), 0.0) * uFtwMoonGlow * night)
            + uFtwMoonCol * (uFtwMoonGlow * ${glf(GROUND.moonFillK)} * moonUp * night);
          // Ambient sky fill — additive, so dark source pixels never multiply to black. Scaled
          // out through the orbital fade band (uFtwHiAlt→1) to stay continuous with the base.
          vec3 ambient = (uFtwAmbDay * dayK + uFtwMoonCol * (uFtwAmbNight * night))
            * (1.0 - uFtwHiAlt);
          diffuseColor.rgb = graded * shade + moonlit + ambient;
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
    darkBlend() {
      return uniforms.uFtwDark.value;
    },
    refreshResolution,
    setQualityTier(errorNear, lruCapBytes, queueCaps) {
      errorNearOverride = errorNear; // consumed by the update() error-ramp near endpoint
      tiles.lruCache.maxBytesSize = lruCapBytes ?? lruDefaultBytes; // null → captured default (high)
      tiles.lruCache.minBytesSize = lruFloorBytesForCap(lruCapBytes) ?? lruDefaultMinBytes; // U2/A9
      tiles.downloadQueue.maxJobs = queueCaps?.download ?? dlJobsDefault; // U5
      tiles.parseQueue.maxJobs = queueCaps?.parse ?? parseJobsDefault;
    },
    setFoveation(cfg) {
      fovea.configure(cfg);
    },
    setFoveaActive(on) {
      fovea.setActive(on);
    },
    setFoveaPose(eyeWorld, fwdWorld) {
      fovea.setPose(eyeWorld, fwdWorld);
    },
    foveaSnapshot() {
      return { ...fovea.snapshot(), baseErrorTarget: tiles.errorTarget };
    },
    update(alt, darkGround, flat2d) {
      // Active below GATES.groundActiveAlt; the layer screen-door-dissolves in across the fade band
      // so real terrain grows organically out of the stylized base (no switch), then keeps
      // LOD-refining (Esri z19 overlay + TilesFadePlugin) all the way to street level.
      const on = alt < GATES.groundActiveAlt;
      tiles.group.visible = on;
      if (!on) return;
      // Adaptive screen-space error: coarse tiles at orbit reach full coverage fast; diving
      // ramps the target back down to QuantizedMeshPlugin's fine default so cities stay sharp.
      // Near endpoint: GROUND.errorTargetNear on `high`; raised on weaker tiers (WS1). The /m
      // 2D map claws it back to errorTargetNear2d AND, close to the ground, dives to the DEEP
      // target — the imagery composite density is slaved to this number (see errorTarget2dDeep),
      // and buildings are detached in 2D so the budget is free (owner 2026-08-18/18b).
      const nearBase = flat2d
        ? Math.min(errorNearOverride, GROUND.errorTargetNear2d)
        : errorNearOverride;
      const near = flat2d
        ? THREE.MathUtils.mapLinear(
            THREE.MathUtils.clamp(alt, GROUND.error2dDeepAltM, GROUND.error2dBlendAltM),
            GROUND.error2dDeepAltM,
            GROUND.error2dBlendAltM,
            GROUND.errorTarget2dDeep,
            nearBase,
          )
        : nearBase;
      tiles.errorTarget = THREE.MathUtils.mapLinear(
        THREE.MathUtils.clamp(alt, GROUND.errorNearAlt, GROUND.errorFarAlt),
        GROUND.errorNearAlt,
        GROUND.errorFarAlt,
        near,
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
      // S7a dark-drape crossfade: altitude band × mode, eased so mode flips + descents dissolve.
      // The CARTO overlay's opacity is a LIVE uniform (layerInfo struct) — a plain write is the
      // whole crossfade; the grade blend (uFtwDark) rides the same eased value.
      const darkTarget = darkGround
        ? THREE.MathUtils.clamp(
            (DRAPE.fadeTopAltM - alt) / (DRAPE.fadeTopAltM - DRAPE.fadeBottomAltM),
            0,
            1,
          )
        : 0;
      const kDark = 1 - Math.exp(-dtMs / DRAPE.easeTauMs);
      uniforms.uFtwDark.value += (darkTarget - uniforms.uFtwDark.value) * kDark;
      // /m 2D-map day grading — same ease so the 2D↔3D flip dissolves, never snaps.
      uniforms.uFtwFlat2d.value += ((flat2d ? 1 : 0) - uniforms.uFtwFlat2d.value) * kDark;
      // Dark-drape overlay lifecycle (2026-08-18 speed batch): attach on entering dark mode,
      // detach once the crossfade has fully eased back out — never mid-fade (the eased opacity
      // needs the overlay to exist to show it).
      const wantCarto = darkGround || uniforms.uFtwDark.value > 0.005;
      if (wantCarto !== cartoAttached) {
        cartoAttached = wantCarto;
        if (wantCarto) overlayPlugin.addOverlay(cartoDark);
        else overlayPlugin.deleteOverlay(cartoDark);
      }
      if (cartoAttached) cartoDark.opacity = uniforms.uFtwDark.value;
      // Keep refinement ticking through the initial load even if the camera is static (reduced
      // motion disables the drift; UpdateOnChangePlugin would otherwise stall until a zoom).
      if (!initialLoadEnded) (uocPlugin as any).needsUpdate = true;
      // No shadow twins on the /m 2D map (2026-08-18 speed batch): buildings — the only casters
      // — are detached there, so the depth pass + per-tile twin draws bought nothing.
      const wantShadows = alt < SHADOWS.maxAltM && !flat2d;
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
