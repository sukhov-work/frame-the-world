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
  lruBankFloorBytes,
  lruFloorBytesForCap,
  type FoveationTierCfg,
  type QueueCaps,
} from "../../../lib/globe/quality";
import { bandCurveGlsl, easeK } from "../../../lib/globe/lightBands";
import { DRAPE, EARTH, FOVEATION, GATES, GOLDEN, GROUND, QUALITY, SHADOWS, SUN, TILESETS, ULTRA } from "../tuning";
import { mipByteFactor, planMipSizes } from "../../../lib/globe/mipChain";
import { FTW_AERIAL_GLSL, glf, glf3 } from "./glsl";
import { makeTileFoveation } from "./tileFoveation";
import {
  chooseTerrainHit,
  stampTileDepth,
  TerrainPickStats,
} from "../../../lib/globe/terrainPick";
import { HeightMemo, type HeightMemoStats } from "../../../lib/globe/heightMemo";
import {
  installEsriPlaceholderFallback,
  type PlaceholderProbeResult,
  type PlaceholderStats,
} from "../../../lib/globe/esriPlaceholder";
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
  /** Monotone count of terrain tiles that have finished loading (BEST SPOT §3.4 item 1). Consumers
   *  compare it per frame and rebuild on change — never a deep scene compare, never per frame. */
  terrainEpoch(): number;
  /** RC6 DEV probe (`__globe.terrainPickStats()`) — audit measurement M7: how often the nearest
   *  terrain hit is NOT the finest one, i.e. how often a crossfading coarse parent would have
   *  won the seat. DEV-only counting; the snapshot is safe to read anywhere. */
  pickStats(): {
    samples: number;
    parentWins: number;
    parentWinRate: number;
    worstDeltaM: number;
    hitsPerSample: number;
  };
  resetPickStats(): void;
  /** RC11 DEV probe (`__globe.heightMemoStats()`) — the exact terrain-height memo's hit rate,
   *  entry count and how often the terrain epoch dropped it. */
  heightMemoStats(): HeightMemoStats;
  /** Ground shadow darkness for the CURRENT shadow source (S5): the sun keeps
   *  SHADOWS.groundOpacity; moon-driven frames pass moonGroundOpacity × K&S intensity.
   *  S7a: the orchestrator blends sun/moon opacity toward the DRAPE.*shadowOpacity knobs
   *  by darkBlend() before passing it in — per-mode shadow contrast. */
  setShadowStrength(opacity: number): void;
  /** Solar-eclipse daylight REMAINING (0..1) scaling the day grade — 1 = no eclipse. The
   *  orchestrator altitude-gates it before it arrives (`stepEclipse`): being inside the umbra is a
   *  street-level truth, and from orbit the shadow is a ~100 km spot, not a hemisphere. */
  setEclipse(k: number): void;
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
  /** RC20/T34: hold the LRU floor near the cap for a bounded window after a 2D↔FPV flip, so the
   *  OTHER mode's ground tiles survive the round trip instead of being rest-trimmed to
   *  `minBytesSize` the frame the traversal stops visiting them. `false` restores the tier's own
   *  U2/A9 paired floor exactly. Idempotent — a steady frame writes nothing. */
  setLruBank(banking: boolean): void;
  /** #15 (batch #4 S3): per-tier ImageOverlayPlugin composite resolution (512 high / 256 mid+low).
   *  `resolution` is construction-time on the plugin, so a change swaps in FRESH overlay
   *  instances via the plugin's own delete→add idiom — loaded tiles re-composite at the new
   *  size and calculateLevel re-picks the Esri source zoom (~4× fewer GETs at 256). No-op when
   *  unchanged; rides the FPV-deferred tier fan-out, so it never fires mid-viewfinder. */
  setOverlayResolution(px: number): void;
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
  /** ULTRA look targets, pushed per frame by the orchestrator (T44 §1a + T45 S9/S4). All four
   *  are RAW targets — this module owns the easing (so a chip flip or a time scrub dissolves
   *  instead of stepping) and owns the altitude / flat-chart / dark-drape gates on the haze,
   *  because it is where `alt`, `flat2d` and the live `uFtwDark` already are. Every field 0 /
   *  neutral = the pre-ULTRA look, reached exactly (the easings snap to 0 under an epsilon). */
  setUltraTargets(t: {
    /** §1a photographic de-grade strength in 3D (0 = the shipped stylized grade). */
    photo3d: number;
    /** S9 how far to blend the day factor from the legacy termBand ramp to the band curve. */
    light: number;
    /** S4 aerial-perspective strength STRAIGHT FROM THE BAND CURVE — gates applied here. */
    haze: number;
    /** S4 haze tint for the current twilight band. */
    hazeCol: THREE.Color;
  }): void;
  /** T44 §1b: anisotropic filtering on the drape composites. Stamped at texture CREATION only —
   *  `anisotropy` is part of three's GL texture cache key, so changing it on a live texture
   *  forces a full re-upload per composite; new tiles pick it up as you fly. 1 = the library
   *  default (and therefore the identical cache key), so "off" costs nothing and changes nothing. */
  setUltraAnisotropy(taps: number): void;
  /** RC25: hand-build a CAPPED mip chain on each new drape composite (`levels` TOTAL, level 0
   *  included; `1` is off and is the untouched library state). Stamped at texture CREATION
   *  through the same choke point as the anisotropy, so — exactly as for `setUltraAnisotropy` —
   *  it changes what NEW composites get and leaves loaded ones alone. Also re-bills the LRU: the
   *  library scales a texture's byte cost by 4/3 only for AUTO mipmaps, so a manual chain would
   *  otherwise occupy 1.33× what the cache thinks it holds. */
  setUltraMipLevels(levels: number): void;
  /** T45 S3: let the terrain tiles CAST into the shadow map, not only receive through their
   *  ShadowMaterial twins. Applies to loaded tiles immediately and to every tile loaded after. */
  setTerrainCast(on: boolean): void;
  /** RC5 DEV probe (`__globe.esriPlaceholder()`): what the placeholder fallback actually did this
   *  session, read off the live wrapper. `null` before the first overlay is built. */
  placeholderStats(): (PlaceholderStats & { sentinelTiles: number; blocks: number }) | null;
  /** RC5 DEV probe (`__globe.esriProbe(z, x, y)`): run the SHIPPED wrapper against one real tile.
   *  Whether a camera pose ever asks for a tile outside Esri's coverage depends on the terrain
   *  tileset's own LOD there, so this is how a browser run reaches the substitution path against
   *  the live service instead of against a scripted one. */
  placeholderProbe(z: number, x: number, y: number): Promise<PlaceholderProbeResult | null>;
  dispose(): void;
}

/** The slice of the library's overlay this module reaches into (it exports no interface). */
type EsriFetchLike = { fetch(url: string, options?: RequestInit): Promise<Response> };

/**
 * T44 §1b — the anisotropy the drape composites are stamped with, shared by every attach.
 *
 * MODULE-SCOPED ON PURPOSE. The stamp is a wrap of `TiledRegionImageSource.prototype.fetchItem`
 * (the library exposes no hook and does not export the class — `ImageOverlayPlugin`'s public
 * surface is constructor options plus add/delete/reorder/reset), and a prototype patch is
 * process-wide. Holding the wanted value here rather than in an attach closure means a
 * dispose + re-attach cannot leave the live patch reading a dead closure's frozen value.
 *
 * `fetchItem` is the unique choke point: BOTH texture-creation paths return through it — the
 * compose `CanvasTexture` and the single-tile `.clone()` fast path — and it is the only producer
 * of the region `DataCache` entries the shader ultimately samples, so a wrap here cannot miss a
 * path. It also runs exactly once per composite (cache-miss only) and before first bind, which
 * is why stamping costs nothing: three computes the GL cache key once, with the final value.
 *
 * The value MUST be deterministic. Clones share their `.source`, and three keys GL textures by
 * (source, cacheKey) — a per-tile or varying anisotropy would fragment that sharing and multiply
 * GPU memory instead of saving it.
 */
const OVERLAY_ANISO = { wanted: 1 };
/**
 * RC25 — the capped mip chain, module-scoped for the same reason as `OVERLAY_ANISO` and stamped
 * through the same `fetchItem` choke point. `1` means OFF and is the library's own state.
 */
const OVERLAY_MIPS = { levels: 1 };
/** Structural clamp, not taste: a chain deeper than the composite can halve produces NO chain at
 *  all (`buildMipChain` returns null), so a tuning typo would silently disable the feature rather
 *  than fail. 5 is what a 256² composite (the mid/low tiers) can carry down to 16². */
const MIP_LEVELS_MAX = 5;
/** DEV probe: the min/max level count actually stamped on a live composite. `min !== max` would
 *  mean two composites disagree, which under three's (source, cacheKey) sharing is a silent,
 *  intermittent bug — so the case self-reports rather than being argued about. */
const OVERLAY_MIP_SEEN = { min: 0, max: 0 };
/** Marks the prototype as already wrapped (a second attach must not nest wrappers). */
const ANISO_STAMP_KEY = "__ftwAnisoStamped";

export function attachImageryGround(
  scene: THREE.Scene,
  opts: {
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    ionToken: string;
    /** Self-baked GLO-30 terrain patch (scene/terrainPatch.ts) — null/absent = pure CWT,
     *  byte-identical to before the bake slice. NEVER user-facing: the registry + env decide. */
    terrainPatch?: TerrainPatchOpts | null;
    /** #15 (batch #4 S3): initial ImageOverlayPlugin composite resolution — per-tier
     *  (QUALITY.tiers[*].overlayResolutionPx); absent = GROUND.overlayResolution (512). */
    overlayResolution?: number;
  },
): ImageryGroundHandle {
  const tiles = new TilesRenderer();
  // RENDERING_QUALITY_PASS WS1: this renderer's own LRU byte default (restored on `high`) + the
  // live near-altitude error endpoint (GROUND.errorTargetNear on high; raised on mid/low).
  const lruDefaultBytes = tiles.lruCache.maxBytesSize;
  const lruDefaultMinBytes = tiles.lruCache.minBytesSize; // U2/A9: min/max travel as a pair
  // RC20/T34: the last cap the tier fan-out handed us, kept so `setLruBank(false)` can restore
  // the tier's own paired floor EXACTLY rather than re-deriving it from the live max (which on
  // `high` is the library's non-integer 0.4·2³⁰ and would round).
  let lruCapBytesApplied: number | null = null;
  let lruBanking = false;
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
  // #15 (batch #4 S3): overlay factories — the rebuild path below needs FRESH instances (every
  // addOverlay pass re-wraps overlay.fetch with the download-queue adapter, so re-adding the
  // SAME instance nests wrappers). Coarse-pointer devices cap Esri one level shallower (the
  // deepest level is where a street wander burns the most GETs). fetchOptions force-cache:
  // an overlay fetches ONLY tile images — no manifests — and Esri/CARTO tile content is
  // immutable-in-practice, so the per-reload revalidation round-trips buy nothing (measured
  // ~60/reload, scripts/measure-tile-cache.mjs).
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  // RC5 (owner bug B1): the live counters of the placeholder fallback, re-pointed on every
  // overlay rebuild so `__globe.esriPlaceholder()` always reads the overlay actually fetching.
  let esriPlaceholder: ReturnType<typeof installEsriPlaceholderFallback> | null = null;
  const makeEsriOverlay = () => {
    const o = new XYZTilesOverlay({
      url: TILESETS.esriImageryUrl,
      levels: (coarsePointer ? TILESETS.esriMaxLevelCoarse : TILESETS.esriMaxLevel) + 1,
    });
    o.fetchOptions = { cache: "force-cache" };
    // Esri answers 200 with a "Map data not available" JPEG outside its local coverage, so the
    // whole failure-driven fallback path in this file (load-error → resetFailedOverlays) never
    // arms — see lib/globe/esriPlaceholder. Installed HERE, at construction, because
    // ImageOverlayPlugin._initOverlay binds whatever `fetch` it finds into the download queue
    // (ImageOverlayPlugin.js:922-930); wrapping later would nest inside the queue instead of
    // under it, and `setOverlayResolution` builds fresh overlays that would miss it entirely.
    esriPlaceholder = installEsriPlaceholderFallback(o as unknown as EsriFetchLike, {
      urlTemplate: TILESETS.esriImageryUrl,
      maxLevelsUp: GROUND.placeholderMaxLevelsUp,
    });
    return o;
  };
  const makeCartoOverlay = () => {
    const o = new XYZTilesOverlay({
      url: TILESETS.cartoDarkUrl,
      levels: TILESETS.cartoMaxLevel + 1,
      opacity: 0,
    });
    o.fetchOptions = { cache: "force-cache" };
    return o;
  };
  let cartoDark = makeCartoOverlay();
  // The dark drape attaches ONLY in dark ground mode (2026-08-18 speed batch): registered
  // up-front with opacity 0 it fetched + composited a full second tile chain for zero pixels —
  // the default mode is satellite, so most sessions paid 2× imagery for nothing. delete→add is
  // the plugin's own re-order idiom (ImageOverlayPlugin.js:154-155), so the flip is safe live.
  let cartoAttached = false;
  let esriOverlay = makeEsriOverlay();
  let overlayResolutionPx = opts.overlayResolution ?? GROUND.overlayResolution;
  const overlayPlugin = new ImageOverlayPlugin({
    renderer: opts.renderer,
    resolution: overlayResolutionPx,
    overlays: [esriOverlay],
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
    // ECLIPSE (2026-08-22k): daylight REMAINING, 0..1, already altitude-gated by the orchestrator
    // (see stepEclipse). Exactly 1 whenever nothing is happening — a provable per-frame no-op.
    uFtwEclipse: { value: 1 },
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
    // QA-7a (owner 2026-08-21f): photographic-chart strength — see GROUND.flat2dPhotoK.
    uFtwPhotoK: { value: GROUND.flat2dPhotoK },
    // --- ULTRA (T44 §1a + T45 S9/S4). ALL FOUR are seeded 0, and 0 is the identity of every
    //     expression they appear in — `mix(legacy, ultra, 0.0)` is exactly `legacy`, `max(x, 0.0)`
    //     is exactly `x`, and the haze block is skipped entirely. That is the off-state proof:
    //     with the chip off this layer renders the same instructions it did before the track. ---
    /** §1a — the photographic de-grade in 3D, ULTRA's own twin of the chart's uFtwFlat2d×uFtwPhotoK. */
    uFtwPhoto3d: { value: 0 },
    /** S9 — how far the day factor has moved from the legacy termBand ramp to the twilight-band
     *  curve. Eased on the chip's edge (and SNAPPED to 0 below an epsilon, so "off" is exact). */
    uFtwUltraLight: { value: 0 },
    /** S4 — effective aerial-perspective strength: the band curve × the altitude gate × the
     *  dark-drape scale, already eased by the orchestrator's target and this module's low-pass. */
    uFtwHaze: { value: 0 },
    /** S4 — the haze/scattering tint for the current twilight band (day → golden → blue → night). */
    uFtwHazeCol: { value: new THREE.Color(tokens.skyHorizon) },
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
        uniform float uFtwEclipse;
        uniform float uFtwNightFloor;
        uniform float uFtwDesat;
        uniform float uFtwGain;
        uniform vec3 uFtwCast;
        uniform vec3 uFtwAmbDay;
        uniform float uFtwAmbNight;
        uniform float uFtwPhotoK;
        // ULTRA (T44 §1a + T45 S9/S4). THE TRAP THIS BLOCK EXISTS FOR: a uniform added to the
        // JS shader.uniforms object but NOT declared here is a SILENT compile failure — the
        // previous program keeps rendering and every poke is a no-op, with nothing logged.
        uniform float uFtwPhoto3d;
        uniform float uFtwUltraLight;
        uniform float uFtwHaze;
        uniform vec3 uFtwHazeCol;
        // S9 — the twilight-band day curve, EMITTED from ULTRA.dayCurve by lib/globe/lightBands
        // so the shader and its JS twin cannot drift (a unit test evaluates both and compares).
        ${bandCurveGlsl("ftwUltraDayK", ULTRA.dayCurve)}
        // S4 — the SHARED aerial-perspective function (scene/glsl.ts), byte-identical to the one
        // the buildings compile, so the air over the city and the air over the ground it stands
        // on can never diverge.
        ${FTW_AERIAL_GLSL}
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
          // S9 (ULTRA, T45): the legacy line above is a smoothstep over a DOT PRODUCT — 9.2° of
          // solar elevation with no physical meaning at either edge, and the root of the owner's
          // "naive and linear". ULTRA blends it toward a curve anchored on the SAME twilight
          // thresholds the planner and the scrubber bands already use (+6/−4 golden, −6 civil,
          // −12 nautical, −18 astronomical), spanning 36° instead of 9° — so day→dusk→night takes
          // hours with structure instead of one ~37-minute blend. sunUpDot IS sin(solar
          // elevation) at this fragment, so the curve is evaluated per-fragment and still draws a
          // true terminator from orbit. mix(a, b, 0.0) is exactly the legacy value when off.
          dayK = mix(dayK, ftwUltraDayK(sunUpDot), uFtwUltraLight);
          // /m 2D map (owner 2026-08-18): a planning chart reads around the clock — the eased
          // uFtwFlat2d forces day grading (and the moon/golden adds fade with their own gates).
          // NOTE this stays OUTSIDE the ULTRA mix on purpose: forcing dayK is a C2 breach in 3D
          // (it lights the night side in daylight while the buildings keep the sun/moon key,
          // deleting the terminator, golden hour and moonlight). ULTRA drives photo instead.
          dayK = max(dayK, uFtwFlat2d);
          // The sun is partly gone: scale the day factor by what is left of it. This sits AFTER
          // the flat-2d max on purpose — a planning chart must still read around the clock — and
          // it is only coherent because the key light, the ground shadows and the sky dome are
          // scaled by the SAME number in the same frame. Dimming dayK alone would be the
          // mirror image of the documented C2 breach above.
          dayK *= uFtwEclipse;
          // QA-7a (owner 2026-08-21f): PHOTOGRAPHIC chart — on the /m 2D flat map the whole
          // stylized grade lerps OUT (raw Esri colorimetry, the MapWindow-canvas look). Gated
          // off under the dark CARTO drape (its flat grade IS the dark-mode look) and rides
          // the same eased uFtwFlat2d, so 2D↔3D dissolves. Strength: GROUND.flat2dPhotoK.
          // T44 §1a (ULTRA): the SAME de-grade, now also reachable in 3D on its own uniform. This
          // is the separation that unblocks T44 — uFtwFlat2d drove TWO independent effects and
          // only this one is safe outside the chart. max (not +): on the /m chart both terms are
          // live and the chart must not double-de-grade past 1.0; and max(x, 0.0) === x, so with
          // ULTRA off the expression is byte-for-byte the one that shipped.
          float photo = max(uFtwFlat2d * uFtwPhotoK, uFtwPhoto3d) * (1.0 - uFtwDark);
          float dayShade = mix(${glf(EARTH.dayGradMin)}, 1.0, sqrt(max(sunDot, 0.0)));
          // S7a dark drape: the Esri grade blends OUT and a UNIFORM flat shade blends IN as
          // uFtwDark rises (the CARTO overlay already owns diffuseColor by then) — the water
          // detection / desat / hiAlt harmonizer are Esri-colorimetry-specific and go with it.
          float shade = mix(
            mix(uFtwNightFloor, dayShade, dayK),
            mix(${glf(DRAPE.nightFloor)}, ${glf(DRAPE.dayShade)}, dayK),
            uFtwDark);
          shade = mix(shade, 1.0, photo);
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          // high-altitude harmonizer: extra desaturation converges mixed Esri source zooms
          // (washed low-zoom mosaic vs crisp high-zoom texture) so they stop reading as patches
          float desatEff = mix(uFtwDesat, ${glf(GROUND.hiAltDesat)}, uFtwHiAlt) * (1.0 - uFtwDark)
            * (1.0 - photo);
          vec3 graded = mix(diffuseColor.rgb, vec3(lum), desatEff)
            * mix(mix(uFtwGain, ${glf(DRAPE.gain)}, uFtwDark), 1.0, photo)
            * mix(mix(uFtwCast, ${glf3(DRAPE.cast)}, uFtwDark), vec3(1.0), photo);
          // blue-dominant pixels = water -> pull toward the instrument's near-black ocean so the
          // imagery's bright seas never punch through the dark palette (rivers/lakes stay slate too)
          float waterness = smoothstep(0.0, ${glf(GROUND.waterThreshold)}, diffuseColor.b - max(diffuseColor.r, diffuseColor.g))
            * (1.0 - uFtwDark) * (1.0 - photo);
          graded *= mix(1.0, ${glf(GROUND.waterDarken)}, waterness);
          // golden-hour cast where the sun grazes the local horizon (bell over sin(elevation);
          // GLSL twin of lib/ephemeris/golden.ts — keep in sync with tuning.GOLDEN + baseEarth).
          // Over SOLAR elevation (sunUpDot) — golden hour is a time of day, not a slope angle.
          float gold = smoothstep(${glf(GOLDEN.fadeInLo)}, ${glf(GOLDEN.fadeInHi)}, sunUpDot)
                     * (1.0 - smoothstep(${glf(GOLDEN.fadeOutLo)}, ${glf(GOLDEN.fadeOutHi)}, sunUpDot));
          graded *= mix(vec3(1.0), uFtwGoldenCol * ${glf(GOLDEN.castGain)}, gold * ${glf(GOLDEN.groundStrength)} * (1.0 - photo));
          // Night gate over solar elevation (twin of EARTH.lightsBand).
          float night = 1.0 - smoothstep(${glf(EARTH.lightsBand[0])}, ${glf(EARTH.lightsBand[1])}, sunUpDot);
          float moonUp = max(dot(nUp, uFtwMoonDir), 0.0);
          // Moonlight, two terms (S7 feedback): the albedo-scaled sheen (graded×moon — black
          // stays black) + a small NON-albedo fill so the moon actually LIFTS the dark ground.
          vec3 moonlit = (graded * uFtwMoonCol * (max(dot(nS, uFtwMoonDir), 0.0) * uFtwMoonGlow * night)
            + uFtwMoonCol * (uFtwMoonGlow * ${glf(GROUND.moonFillK)} * moonUp * night))
            * (1.0 - photo);
          // Ambient sky fill — additive, so dark source pixels never multiply to black. Scaled
          // out through the orbital fade band (uFtwHiAlt→1) to stay continuous with the base.
          vec3 ambient = (uFtwAmbDay * dayK + uFtwMoonCol * (uFtwAmbNight * night))
            * (1.0 - uFtwHiAlt) * (1.0 - photo);
          diffuseColor.rgb = graded * shade + moonlit + ambient;
          // S4 AERIAL PERSPECTIVE (ULTRA, T45) — promoted to co-primary by the owner's transition
          // steer, and absent from this app entirely before now: there is no scene.fog, no
          // distance term on ground or buildings, and the sky dome's own skyHazeBelow sits at
          // camera.far × 0.45 (≈81 km) with depthTest on, so it is geometrically unreachable.
          // vFtwW is the world position the geodetic-up term above already relies on, so this
          // adds no varying; uFtwHaze is 0 whenever ULTRA is off and the function returns early.
          diffuseColor.rgb = ftwAerial(diffuseColor.rgb, vFtwW, uFtwSun, uFtwHaze, uFtwHazeCol);
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

  // --- T45 S3 TERRAIN CASTS (ULTRA) — the owner's named killer feature -----------------------
  //
  // The ground RECEIVES today (the ShadowMaterial twins above) but never CASTS, which is why a
  // mountain at low sun has no valley shadow. three renders a cast from any mesh with
  // `castShadow` through a shared MeshDepthMaterial — the source material's lighting model is
  // irrelevant — so an unlit MeshBasicMaterial tile casts fine. TWO traps make it not "just work":
  //
  //  1. THE SIDE FLIP, and it fails SILENTLY. `getDepthMaterial` sets
  //     `side = material.shadowSide ?? shadowSide[material.side]`, where the map inverts
  //     FrontSide → BackSide (right for closed volumes, wrong for a sheet). The terrain tiles are
  //     single-sided sheets, so with the default the depth pass draws their back faces, culls
  //     everything, and the terrain casts NOTHING — no error, no warning, just no shadows.
  //     `shadowSide = FrontSide` is what makes the feature exist at all.
  //  2. SELF-SHADOW ACNE. The caster and the receiver are the SAME geometry (the twin rides it),
  //     so every slope shadows itself. It cannot be fixed with the global bias/normalBias without
  //     peter-panning the BUILDING shadows those two are tuned for — hence a dedicated depth
  //     material carrying its own polygon offset. `colorWrite: false` rides along: the shadow
  //     target's RGBA8 colour attachment is written by the depth material and never read by
  //     anything (the sampler reads the depth texture), so it is pure bandwidth.
  //
  // `customDepthMaterial` is returned verbatim by three, but `side`/`map`/`alphaTest`/`visible`
  // are still overwritten onto it per object — which is why (1) must be set on the TILE material
  // regardless of (2).
  let terrainCastOn = false;
  const terrainDepthMat = new THREE.MeshDepthMaterial({ colorWrite: false });
  terrainDepthMat.polygonOffset = true;
  terrainDepthMat.polygonOffsetFactor = ULTRA.terrainDepthOffset;
  terrainDepthMat.polygonOffsetUnits = ULTRA.terrainDepthOffset;
  const applyTerrainCast = (tileMesh: THREE.Mesh) => {
    tileMesh.castShadow = terrainCastOn;
    const mat = tileMesh.material as THREE.Material;
    mat.shadowSide = terrainCastOn ? THREE.FrontSide : null;
    tileMesh.customDepthMaterial = terrainCastOn ? terrainDepthMat : undefined;
  };

  // BEST SPOT §3.4 item 1 — the streaming epoch. Terrain has no version counter anywhere in the
  // repo (buildings/enriched publish `seatState()`; this renderer published nothing), so the disc
  // could not tell "the ground under me just got 4x finer" from "nothing happened" and would have
  // kept answering off a DSM baked from a coarse LOD. THREE lines on a listener that already
  // exists, monotone, compared per frame by `bestSpotFeed` — the `vtiles.version()` idiom.
  let terrainEpochN = 0;
  const pickStats = new TerrainPickStats();
  const heightMemo = new HeightMemo(GROUND.heightMemoCapacity);
  tiles.addEventListener("load-model", (e: any) => {
    terrainEpochN++;
    // RC6: stamp the tile's hierarchy depth onto every mesh in it, so the samplers can pick the
    // FINEST hit rather than the nearest one while a coarse parent is still crossfading out.
    stampTileDepth(e.scene, e.tile?.internal?.depth ?? -1);
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
        applyTerrainCast(c); // S3: a tile streaming in mid-session inherits the live cast state
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

  // --- ULTRA look state: RAW targets in, eased values out (see setUltraTargets) ---------------
  let ultraPhotoTarget = 0;
  let ultraLightTarget = 0;
  let ultraHazeBand = 0; // the band-curve value; the gates below turn it into uFtwHaze

  /**
   * Install the anisotropy stamp (T44 §1b). Lazy AND once: nothing is patched until the chip
   * asks for more than one tap, so a user who never touches ULTRA never runs a line of it.
   * Reached through a live overlay because the library exports neither the region-source class
   * nor any hook; patching the PROTOTYPE (not the instance) is what makes it survive
   * `setOverlayResolution`, which deletes both overlays and builds fresh ones.
   */
  /**
   * RC25 — hand-build the capped chain onto one freshly created composite.
   *
   * three's manual-mipmap path, verified in r185 source: with `generateMipmaps` false,
   * `getMipLevels` returns `texture.mipmaps.length`, the upload allocates IMMUTABLE storage with
   * `texStorage2D(TEXTURE_2D, levels, …)` sized from `mipmaps[0]`, and then uploads `mipmaps[i]`
   * at level `i`. That is why level 0 is in the array.
   *
   * The "an incomplete chain renders black unless you set TEXTURE_MAX_LEVEL" fear does not apply:
   * three never touches `TEXTURE_MAX_LEVEL`/`TEXTURE_BASE_LEVEL` anywhere (zero hits in the whole
   * package), and it does not need to — an immutable-format texture is mipmap-complete over
   * exactly its allocated levels, and this renderer is WebGL2-only. The failure mode belongs to
   * the mutable `texImage2D` path, which is unreachable here.
   *
   * THE TRAP, recorded because it is the natural thing to try: do NOT get the levels by setting
   * `generateMipmaps = true`. `getMipLevels` would then return the FULL log2(max)+1, so
   * `texStorage2D` allocates ~10 levels while the loop fills 4 — and the upload forces the flag
   * back to false BEFORE the generate-mipmaps check, so `generateMipmap` never runs and levels
   * 4..9 stay allocated-but-undefined with nothing to stop the sampler reaching them.
   */
  const attachDrapeMips = (tex: THREE.Texture) => {
    if (OVERLAY_MIPS.levels <= 1) return; // OFF — leave `mipmaps` at its `[]` library default
    const img = tex.image as unknown;
    // The single-tile fast path returns a `.clone()` sharing its `source` with the cache's base
    // texture and with every other clone. three keys GL textures by (source, cacheKey) and the
    // cache key does NOT include `mipmaps`, so whichever clone bound first would decide the level
    // count for all of them, forever. Only stamp the COMPOSE path, whose canvas this composite
    // owns outright. (Browser-measured: 452 of 452 live composites take the compose path.)
    if (typeof HTMLCanvasElement === "undefined" || !(img instanceof HTMLCanvasElement)) return;
    const sizes = planMipSizes(
      img.width,
      img.height,
      Math.min(OVERLAY_MIPS.levels, MIP_LEVELS_MAX),
    );
    if (!sizes) return; // the size cannot carry the chain → stay on the library's own path
    try {
      // Halve with `drawImage` into successively smaller canvases. MEASURED, and the reason this
      // is not a JS filter over `getImageData`: the readback path cost **5.36 ms per composite**
      // on the main thread (4.10 ms readback + 1.26 ms filter) against **0.06 ms** for this one,
      // and composites arrive in bursts of hundreds while flying. It is also the CORRECT filter
      // here — canvas 2D composites in premultiplied alpha, so the downscale premultiplies before
      // filtering, which is the inverse of the drape shader's sample-time `tint.rgb *= tint.a`
      // and is what stops a dark ring forming at coverage edges.
      const chain: unknown[] = [img];
      let src: CanvasImageSource = img;
      for (const { width, height } of sizes) {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const cx = c.getContext("2d");
        if (!cx) return;
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = "high";
        cx.drawImage(src, 0, 0, width, height);
        chain.push(c);
        src = c;
      }
      // Level 0 is the composite canvas itself: three sizes its IMMUTABLE `texStorage2D`
      // allocation from `mipmaps[0]` and then uploads `mipmaps[i]` at level `i`.
      tex.mipmaps = chain as unknown as THREE.Texture["mipmaps"];
      tex.generateMipmaps = false; // already false; asserted because the branch depends on it
      const n = chain.length;
      OVERLAY_MIP_SEEN.max = Math.max(OVERLAY_MIP_SEEN.max, n);
      OVERLAY_MIP_SEEN.min = OVERLAY_MIP_SEEN.min === 0 ? n : Math.min(OVERLAY_MIP_SEEN.min, n);
    } catch {
      /* a zero-sized or otherwise unusable canvas must never take the ground with it */
    }
  };

  /**
   * THE ONE WRITER of this renderer's LRU byte band. Three inputs move it and they must never
   * fight: the tier fan-out (`setQualityTier`), the RC20 flip bank (`setLruBank`) and the RC25
   * mip-chain re-billing (`setUltraMipLevels`). Before this was one function, each of them wrote
   * `minBytesSize` from its own reading of the other two and the last caller won.
   *
   * The composition, in order:
   *   1. the tier's cap (`null` → the captured library default — the byte-identical `high` path);
   *   2. ÷ the mip factor, because a hand-built chain occupies 1.33× what the library's own
   *      accounting bills for it (it scales by 4/3 only when `generateMipmaps` is true, and a
   *      manual chain leaves that false). Unbilled, that is ~200 MB of drape parked past ULTRA's
   *      600 MB ground cap — the U2/A9 parse → cache-full → discard → re-download loop, reached
   *      from the accounting side instead of the config side. Slightly conservative on purpose:
   *      a tile's quantized mesh does not grow with the chain, so this holds a few tiles fewer
   *      than strictly necessary, which is the correct direction to be wrong in;
   *   3. the floor — RC20's banked value if the window is open, otherwise the shipped U2/A9
   *      `lruFloorBytesForCap(cap) ?? captured` expression, byte for byte.
   *
   * With mips off, `mipByteFactor(1)` is EXACTLY 1, so step 2 is an identity and the whole
   * function reproduces the pre-RC25 pair-write — which is what keeps the ULTRA off-state exact
   * and `high` byte-identical.
   */
  const applyLruBand = () => {
    const factor = mipByteFactor(OVERLAY_MIPS.levels);
    const capRaw = lruCapBytesApplied ?? lruDefaultBytes;
    const cap = factor === 1 ? capRaw : Math.round(capRaw / factor);
    tiles.lruCache.maxBytesSize = cap;
    const shippedFloor = lruFloorBytesForCap(lruCapBytesApplied) ?? lruDefaultMinBytes;
    tiles.lruCache.minBytesSize =
      lruBankFloorBytes(cap, lruBanking, QUALITY.lruBank) ??
      (factor === 1 ? shippedFloor : Math.round(shippedFloor / factor));
  };

  const installAnisoStamp = (overlay: unknown) => {
    const ov = overlay as { init?: () => Promise<unknown>; regionImageSource?: unknown };
    Promise.resolve(ov.init?.())
      .then(() => {
        // `regionImageSource` is null until the overlay's own init resolves.
        const rs = ov.regionImageSource as { fetchItem?: unknown } | null | undefined;
        if (!rs) return;
        const proto = Object.getPrototypeOf(rs) as Record<string, unknown>;
        if (proto[ANISO_STAMP_KEY]) return; // already wrapped — never nest
        const original = proto.fetchItem;
        if (typeof original !== "function") return; // library drift → skip, never break the ground
        proto[ANISO_STAMP_KEY] = true;
        proto.fetchItem = async function (this: unknown, ...args: unknown[]) {
          const tex = (await (original as (...a: unknown[]) => Promise<unknown>).apply(
            this,
            args,
          )) as THREE.Texture | null;
          // `minFilter` is ALREADY LinearMipmapLinearFilter on both creation paths, which is the
          // gate three requires before it will issue the anisotropy texParameterf — so setting
          // this one field is sufficient and no filter change is needed. With generateMipmaps
          // false the taps all land in level 0: a real but partial win (it fixes grazing-angle
          // minification, which IS the tilt symptom, and leaves heavy minification aliasing).
          // RC25 lands the remaining half — a CAPPED, hand-built chain — right here, because
          // anisotropy without mips can only supersample within level 0.
          if (tex && (tex as THREE.Texture).isTexture) {
            tex.anisotropy = OVERLAY_ANISO.wanted;
            attachDrapeMips(tex);
          }
          return tex;
        };
      })
      .catch(() => {
        /* the stamp is a fidelity nicety — a failure here must never take the ground with it */
      });
  };

  return {
    tiles,
    uniforms,
    heightAt(latDeg, lonDeg) {
      // RC11: exact (epoch, lat, lon) memo. The seat sweep is a round-robin over a fixed set of
      // footprints, so after one wrap it asks the SAME questions forever; the terrain epoch (the
      // BEST SPOT tile-load counter that already lives next door) drops the whole memo the moment
      // the ground refines, so a hit is exactly as fresh as a raycast would have been.
      const cached = heightMemo.get(latDeg, lonDeg, terrainEpochN);
      if (cached !== undefined) return cached;
      const latRad = (latDeg * Math.PI) / 180;
      const lonRad = (lonDeg * Math.PI) / 180;
      WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, 12_000, _rayOrigin);
      WGS84_ELLIPSOID.getCartographicToNormal(latRad, lonRad, _rayDir);
      _raycaster.set(_rayOrigin, _rayDir.negate());
      _raycaster.far = 24_000;
      const hits = _raycaster.intersectObject(tiles.group, true);
      // RC6: the DEEPEST tile wins, not the nearest hit. A coarse parent stays in the scene and
      // raycastable for the whole crossfade after its children land, and over relief it can sit
      // above the fine mesh — so `[0]` seated buildings on the LOD error until the fade ended.
      const hit = chooseTerrainHit(hits);
      if (!hit) return null; // deliberately NOT memoised — "no tile yet" is the answer to retry
      const h = WGS84_ELLIPSOID.getPositionElevation(hit.point);
      heightMemo.set(latDeg, lonDeg, terrainEpochN, h);
      if (import.meta.env.DEV && hits.length > 0) {
        pickStats.note(
          hits.length,
          hit === hits[0],
          hit === hits[0] ? 0 : h - WGS84_ELLIPSOID.getPositionElevation(hits[0].point),
        );
      }
      return h;
    },
    pickStats: () => pickStats.snapshot(),
    resetPickStats: () => {
      pickStats.reset();
      heightMemo.resetStats();
    },
    heightMemoStats: () => heightMemo.stats(),
    terrainEpoch: () => terrainEpochN,
    placeholderStats: () =>
      esriPlaceholder
        ? { ...esriPlaceholder.stats, ...esriPlaceholder.memo.stats() }
        : null,
    placeholderProbe: (z, x, y) => esriPlaceholder?.probe({ z, x, y }) ?? Promise.resolve(null),
    setShadowStrength(opacity) {
      shadowMat.opacity = opacity; // ONE shared material — every twin follows
    },
    setEclipse(k) {
      uniforms.uFtwEclipse.value = k;
    },
    darkBlend() {
      return uniforms.uFtwDark.value;
    },
    refreshResolution,
    setOverlayResolution(px) {
      if (px === overlayResolutionPx) return;
      overlayResolutionPx = px;
      (overlayPlugin as unknown as { resolution: number }).resolution = px;
      // Fresh instances (see the factory comment — re-adding the same object nests the fetch
      // wrapper). The U6 visibility-guard patch + the load-error retry closure ride the PLUGIN
      // instance and survive. Bottom-up order restored: Esri first, dark drape back on top.
      const hadCarto = cartoAttached;
      overlayPlugin.deleteOverlay(esriOverlay);
      if (hadCarto) overlayPlugin.deleteOverlay(cartoDark);
      esriOverlay = makeEsriOverlay();
      cartoDark = makeCartoOverlay();
      overlayPlugin.addOverlay(esriOverlay);
      if (hadCarto) overlayPlugin.addOverlay(cartoDark);
      // QA slice C (2026-08-21h): a rebuild destroys every composited texture, and with a
      // PARKED camera UpdateOnChangePlugin never re-traverses — the fresh overlays could sit
      // at whatever level the first re-composite grabbed until the next pan (the "blurry
      // stall" tail). ONE forced traversal is enough: it re-evaluates error targets and
      // enqueues, and the plugin's own preprocessNode() re-arms itself as new nodes stream in.
      (uocPlugin as any).needsUpdate = true;
      // DEV probe (global.d.ts registry): the sticky-composite invariant is "≤1 rebuild per
      // session post-boot" — browser verification asserts THIS counter, because raw Esri GET
      // counts also carry the pre-existing LRU rest-trim churn and can't isolate the storm.
      if (import.meta.env.DEV) {
        window.__overlayRebuilds = (window.__overlayRebuilds ?? 0) + 1;
      }
    },
    setQualityTier(errorNear, lruCapBytes, queueCaps) {
      errorNearOverride = errorNear; // consumed by the update() error-ramp near endpoint
      lruCapBytesApplied = lruCapBytes; // RC20/RC25: remembered so the band can be re-derived
      applyLruBand();
      tiles.downloadQueue.maxJobs = queueCaps?.download ?? dlJobsDefault; // U5
      tiles.parseQueue.maxJobs = queueCaps?.parse ?? parseJobsDefault;
      // QA slice C: an error-target change on a parked camera is the same stall class — the
      // new target only applies on the next traversal, which UpdateOnChangePlugin would defer
      // until the camera moves. Kick once so a governor flip lands immediately.
      (uocPlugin as any).needsUpdate = true;
    },
    setLruBank(banking) {
      if (banking === lruBanking) return; // identity guard — a steady frame writes nothing
      lruBanking = banking;
      applyLruBand();
      // DELIBERATELY no `uocPlugin.needsUpdate` here, unlike setQualityTier/setOverlayResolution.
      // The rest-trim is scheduled at the END of `TilesRendererBase.update()`, and
      // UpdateOnChangePlugin returns from update() EARLY on a frame where nothing moved — which
      // is exactly the behaviour the bank wants to keep. Kicking a traversal every frame would
      // defeat the plugin and re-open the QA-7b class.
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
    setUltraTargets(t) {
      ultraPhotoTarget = t.photo3d;
      ultraLightTarget = t.light;
      ultraHazeBand = t.haze;
      (uniforms.uFtwHazeCol.value as THREE.Color).copy(t.hazeCol);
    },
    setUltraAnisotropy(taps) {
      const want = Math.max(1, Math.round(taps));
      if (want === OVERLAY_ANISO.wanted) return;
      OVERLAY_ANISO.wanted = want;
      if (want > 1) installAnisoStamp(esriOverlay);
    },
    setUltraMipLevels(levels) {
      const want = Math.min(MIP_LEVELS_MAX, Math.max(1, Math.round(levels)));
      if (want === OVERLAY_MIPS.levels) return;
      OVERLAY_MIPS.levels = want;
      if (want > 1) installAnisoStamp(esriOverlay); // the same fetchItem choke point
      // RC25 — RE-BILL THE LRU. `MemoryUtils.getTextureByteLength` scales a texture by 4/3 only
      // when `generateMipmaps` is TRUE; a manual chain bills at 1× while occupying 1.33×. Under
      // ULTRA the ground cap is 600 MB, so leaving it unbilled would park ~200 MB of drape past
      // the cap — the U2/A9 parse → cache-full → discard → re-download loop, arrived at from the
      // accounting side instead of the config side. Shrinking the cap by the same factor keeps
      // the REAL VRAM inside the budget the tier asked for.
      //
      // Slightly conservative on purpose: a ground tile's quantized mesh does not grow with the
      // chain, so scaling the whole cap holds a few tiles fewer than strictly necessary. That is
      // the correct direction to be wrong in — under-billing is the failure with teeth.
      applyLruBand();
    },
    setTerrainCast(on) {
      if (on === terrainCastOn) return;
      terrainCastOn = on;
      // Every twin's PARENT is its tile mesh (the twin is added as a child of it), so the twin
      // set doubles as the caster registry without a second collection to keep in sync.
      for (const twin of shadowTwins) {
        const parent = twin.parent as THREE.Mesh | null;
        if (parent) applyTerrainCast(parent);
      }
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
      // --- ULTRA look (T44 §1a + T45 S9/S4): ease every target, and SNAP to zero under an
      //     epsilon. The snap is what makes "off" exact rather than asymptotic — an exponential
      //     low-pass never reaches its target, and `mix(legacy, ultra, 3e-9)` is not `legacy`.
      const kPhoto = easeK(dtMs, ULTRA.photoTauMs);
      uniforms.uFtwPhoto3d.value += (ultraPhotoTarget - uniforms.uFtwPhoto3d.value) * kPhoto;
      uniforms.uFtwUltraLight.value += (ultraLightTarget - uniforms.uFtwUltraLight.value) * kPhoto;
      if (uniforms.uFtwPhoto3d.value < 1e-4) uniforms.uFtwPhoto3d.value = 0;
      if (uniforms.uFtwUltraLight.value < 1e-4) uniforms.uFtwUltraLight.value = 0;
      // Aerial perspective carries three gates the orchestrator cannot see from where it sits:
      // the altitude ramp (above it the base earth + limb shader own the look and a second
      // scattering model would double-count), the flat-chart cutout (a planning chart must stay
      // a chart), and the dark-drape scale (the CARTO look is deliberately flat).
      const hazeAlt = THREE.MathUtils.clamp(
        (ULTRA.hazeGoneAltM - alt) / (ULTRA.hazeGoneAltM - ULTRA.hazeFullAltM),
        0,
        1,
      );
      const hazeTarget = flat2d
        ? 0
        : ultraHazeBand *
          hazeAlt *
          THREE.MathUtils.lerp(1, ULTRA.hazeDarkK, uniforms.uFtwDark.value);
      uniforms.uFtwHaze.value += (hazeTarget - uniforms.uFtwHaze.value) * easeK(dtMs, ULTRA.hazeTauMs);
      if (uniforms.uFtwHaze.value < 1e-4) uniforms.uFtwHaze.value = 0;
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
      terrainDepthMat.dispose();
      shadowTwins.clear();
      tiles.dispose();
      scene.remove(tiles.group);
    },
  };
}
