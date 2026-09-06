import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { formatDims } from "../../lib/format/readout";
import {
  angularRadiusRad,
  bodyStatesAt,
  KM_PER_AU,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
} from "../../lib/ephemeris/bodies";
import {
  dirAzAltDeg,
  ecefToGeodetic,
  enuBasis,
  geodeticToEcef,
  rayEllipsoidIntersect,
} from "../../lib/geo/projection";
import { frameMarker } from "../../lib/geo/offscreen";
import { aimAnchorFor } from "../../lib/geo/aimAnchor";
import { skylineBinsFor } from "../../lib/geo/horizonProfile";
import { goldenFactor } from "../../lib/ephemeris/golden";
import { moonPhaseIntensity } from "../../lib/ephemeris/moonlight";
import {
  bodyTarget,
  GALACTIC_CENTRE_ID,
  saturnRingPoleDir,
  targetAzAlt,
  targetShortName,
  type TargetState,
} from "../../lib/ephemeris/targets";
import { kindGlyph } from "../../lib/sky/searchIndex";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { useFindStore } from "../../store/find";
import { aimAtSky } from "../../store/skyAim";
import { tokens } from "../../lib/theme/tokens";
import { useUploadStore, type AdjustableParams } from "../../store/upload";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { useCameraStore } from "../../store/camera";
import { revertOp, useBldgEditStore, type BldgEditOp } from "../../store/bldgEdit";
import { restingEdit, revertModelOp, useModelEditStore, type ModelEditOp } from "../../store/modelEdit";
import { useUserModelsStore } from "../../store/userModels";
import {
  IDENTITY_MODEL_TRANSFORM,
  MODEL_LIFT_MAX_M,
  clampModelEdit,
  editToFeatureTransform,
  isIdentityModelTransform,
  isTilted,
  liftFloorFor,
  modelStandpoint,
  offsetGeodetic,
  tiltedExtent,
  type ModelEdit,
  type ModelTransform,
} from "../../lib/models/modelPlacement";
import { useMiniMapStore } from "../../store/minimap";
import { headingDeltaDeg, wrapHeadingDeg } from "../../lib/geo/heading";
import { chartWalkAzRad } from "../../lib/geo/slippy";
import { verticalFovDeg } from "../../lib/decode/sensors";
import { clampGroundM } from "../../lib/geo/terrain";
import { resolveEnrichedSelection } from "../../lib/globe/enrichedVariant";
import {
  fitShadowBox,
  horizonDistanceM,
  type ShadowFitProfile,
} from "../../lib/globe/shadowFit";
import { cascadeNeedsRender, fitCascades } from "../../lib/globe/shadowCascade";
import { solarChroma } from "../../lib/globe/duskLight";
import {
  aboveGateK,
  moonRigTakeoverK,
  sunKeyTroughK,
  type KeyGateProfile,
} from "../../lib/globe/keyHandoff";
import { chooseTerrainHit } from "../../lib/globe/terrainPick";
import { BAKED_REGIONS } from "../../lib/globe/regions";
import { resolveTerrainBase, terrainPatchStats } from "./scene/terrainPatch";
import {
  registerDebugAction,
  registerDebugProvider,
  type DebugSnapshot,
} from "../../lib/globe/debugFeed";
import { clientToNdc, ndcToClient } from "../../lib/geo/screen";
import { attachBaseEarth } from "./scene/baseEarth";
import { PluxGlobeControls } from "./scene/pluxGlobeControls";
import { attachGraticule } from "./scene/graticule";
import { attachAtmosphere } from "./scene/atmosphere";
import { attachStars } from "./scene/stars";
import { attachBuildings } from "./scene/buildings";
import { attachEnrichedBuildings, type BuildingPick } from "./scene/enrichedBuildings";
import { attachImageryGround } from "./scene/imageryGround";
import { attachSky } from "./scene/sky";
import { attachSkyTarget } from "./scene/skyTarget";
import { attachSkyTrail } from "./scene/skyTrail";
import { attachSkyGhosts } from "./scene/skyGhosts";
import { attachFindGhosts } from "./scene/findGhosts";
import { attachSkyNames } from "./scene/skyNames";
import { attachBldgEditLabel } from "./scene/bldgEditLabel";
import { attachBldgGizmo } from "./scene/bldgGizmo";
import { attachUserModels, type UserModelPick } from "./scene/userModels";
import { attachDayArcs } from "./scene/dayArcs";
import { attachAimCones } from "./scene/aimCones";
import { attachFocalCone } from "./scene/focalCone";
import { integratePlanned, plannedAtRest } from "../../lib/geo/plannedView";
import { derivedFov } from "../../lib/decode/params";
import { attachPlanFeed } from "./scene/planFeed";
import { attachMinimapFeed, horizontalFovDeg } from "./scene/minimapFeed";
import {
  BESTSPOT_PRESETS,
  resolveScoring,
  sanitizeScoringPatch,
  scoringDiff,
  scoringHash,
  type BestSpotScoringPatch,
} from "../../lib/geo/bestSpotScoring";
import { useBestSpotStore } from "../../store/bestSpot";
import { attachBestSpotFeed } from "./scene/bestSpotFeed";
import { attachBestSpotSheet } from "./scene/bestSpotSheet";
import { attachGeoLabels } from "./scene/geoLabels";
import { attachStreetNames } from "./scene/streetNames";
import { attachVectorFeatures } from "./scene/vectorFeatures";
import { attachVectorTiles } from "./scene/vectorTiles";
import { attachPhotoFrustum } from "./PhotoFrustum";
import { attachPins } from "./Pins";
import { usePinsStore } from "../../store/pins";
import { attachPlaceMarkers } from "./scene/placeMarkers";
import { usePlacesMapStore } from "../../store/places";
import { arrivalPose, createFlight, type FlightTarget } from "./flight";
import { createExplore } from "./explore";
import type { FrustumGeometry } from "../../lib/geo/frustum";
import {
  formatFpvHash,
  formatSceneHash,
  parseFpvHash,
  parsePoseHash,
  parseTimeHash,
  type UrlFpvPose,
} from "../../lib/geo/urlPose";
import { driftRadiansForDt } from "../../lib/globe/drift";
import { seatStep } from "../../lib/globe/enrichedMask";
import {
  deleteOverride,
  dragScaleK,
  isNeutralRow,
  loadOverrides,
  overrideKey,
  roundCentroidM,
  saveOverrides,
  tombstoneOverride,
  transformFields,
  upsertOverride,
  type OverrideRow,
} from "../../lib/globe/bldgOverrides";
import {
  applySyncResult,
  dirtyCount,
  originOf,
  OverrideIndex,
  reconcileShared,
  sharedRowFromPublic,
  syncPayload,
  type EffectiveOverride,
  type OverrideOriginLabel,
  type SharedMap,
} from "../../lib/globe/bldgSync";
import type { PublicOverride } from "../../lib/wix/overrideRecords";
import { useBldgSyncStore, type BldgSyncResult } from "../../store/bldgSync";
import { useMemberStore } from "../../store/member";
import {
  IDENTITY_TRANSFORM,
  isIdentityTransform,
  type FeatureTransform,
} from "../../lib/globe/featureTransform";
import {
  bankWindowMsLeft,
  lruCapBytesForUltra,
  queueCapsForTier,
  stickyOverlayPx,
  ultraTileLevers,
  type QualityTier,
} from "../../lib/globe/quality";
import { makeLoadAim, makeTileLatencyProbe } from "../../lib/globe/loadPriority";
import {
  AIMCONES,
  AO,
  BESTSPOT,
  CONTROLS,
  DRAPE,
  DRIFT,
  EARTH,
  ATMOSPHERE,
  ECLIPSE,
  ENRICHED,
  FLIGHT,
  FOCALCONE,
  FPV,
  FRUSTUM,
  GOLDEN,
  GRATICULE,
  GROUND,
  MOBILE2D,
  ORCH,
  PINS,
  PLACEMARKS,
  LOADING,
  PLACING,
  PLAN,
  POSE,
  QUALITY,
  RENDERER,
  SEARCH,
  SHADOWS,
  SKY,
  STARS,
  STREETS,
  SUN,
  TEMPPIN,
  ULTRA,
  WGS84_A,
  WGS84_B,
  MODELS,
} from "./tuning";
import { bandCurve, easeK, ultraLightAt } from "../../lib/globe/lightBands";
import {
  eclipseDaylightK,
  lunarEclipseFromState,
  NO_LUNAR_ECLIPSE,
  solarEclipseFromDiscs,
  type LunarEclipseState,
  type SolarEclipseState,
} from "../../lib/ephemeris/eclipse";

/**
 * StylizedTiles — the real, geo-accurate globe (ADR D1), built to the PROJECT_SEED §2 signature
 * scene: "slightly rotating by default, seen from a cinematic LOW-EARTH-ORBIT angle … stylized and
 * adaptive with zoom: explicitly NOT messy half-baked semi-realistic textures, and NOT flat."
 *
 * This file is the ORCHESTRATOR: it owns the camera pose, GlobeControls, the idle drift, and the
 * per-frame altitude gating. Each visual concern lives in its own module under `scene/`
 * (convention: `.claude/conventions/globe-tuning.md`); every tunable number lives in `tuning.ts`.
 *
 * The scene is one continuous instrument across three altitude bands, with no hard switches:
 *   • ORBIT — scene/baseEarth: NASA Blue Marble graded into the palette + VIIRS night lights.
 *   • MID  — scene/imageryGround: Esri imagery screen-door-dissolves in under the base.
 *   • CITY — the imagery keeps refining under scene/buildings (Cesium OSM, dark mass + lit edges).
 * Plus the orbit decorations: scene/graticule, scene/atmosphere (ray-based limb glow), scene/stars.
 *
 * Default POV is a spacecraft in LEO, drifting at ISS-like angular speed; drift pauses on
 * interaction and resumes after DRIFT.resumeMs (design-board motion spec). All colour flows
 * through the GL token bridge (ADR D14). Dynamically imported by GlobeCanvas ONLY when
 * `PUBLIC_CESIUM_ION_TOKEN` is present.
 */

export interface TilesHandle {
  update: () => void;
  /** Adaptive quality (RENDERING_QUALITY_PASS WS1): push a device/governor tier's TILE knobs into
   *  every module (building + ground error targets, per-renderer LRU byte caps, street-name +
   *  vector-lattice budgets). GlobeCanvas owns the renderer-level levers (DPR/bloom/shadows) and
   *  calls this on each tier change. `high` restores every library default → byte-identical. */
  setQualityTier: (tier: QualityTier) => void;
  /** RC18 — the TILE half alone (error targets, LRU cap/floor pairs, queue caps, foveation,
   *  street/lattice budgets). Every one of these moves monotonically with the tier, so a PROMOTE
   *  can only stream more detail in; GlobeCanvas lands it immediately even inside FPV. */
  setQualityTierTiles: (tier: QualityTier) => void;
  /** RC18 — the DEFERRED half (`tierOverlayPx` + the two DPR mirrors). Always rides the
   *  `pendingTier` deferral: a composite-resolution raise is a fresh-instance overlay rebuild. */
  setQualityTierDeferred: (tier: QualityTier) => void;
  /** RC18 — the tier whose TILE levers are live. Diverges from `__globeQuality.tier` (the
   *  RENDERER tier) only while a split promote's renderer half is parked in FPV. */
  tileTier: () => QualityTier;
  /** U2/A9: true while ANY FPV (photo/temp) owns the camera. GlobeCanvas's governor defers the
   *  RENDERER half of a tier application while set — composer-target realloc + a composite
   *  rebuild mid-FPV read as the point-6 "full re-render"; it lands on the first non-FPV frame.
   *  RC18: a governor PROMOTE's tile half no longer waits for that. */
  fpvActive: () => boolean;
  /** 2026-08-18e: true while the flat-map ENGINE treatment is active (/m 2D map, or desktop
   *  nadir under CONTROLS.mapFlatMaxAltM) — GlobeCanvas gates bloom off with it. */
  mapFlat: () => boolean;
  /** ULTRA HQ (owner 2026-08-22h) — true only while the desktop chip is on AND the shell gate
   *  allows it. This is the ONLY thing GlobeCanvas ever sees of the feature: it stays store-free
   *  (its own standing rule), and the shell fence is already folded in here, so a `?? false` on
   *  a null handle fails safe to OFF. */
  ultraPin: () => boolean;
  /** Batch #5 item 3: the /m PiP hole (viewport CSS px; null = none) — GlobeCanvas renders a
   *  scaled whole-view pass into exactly this rect after the main composer pass. The store
   *  read lives HERE (the orchestrator owns store facts; GlobeCanvas stays store-free). */
  pipRect: () => { x: number; y: number; w: number; h: number } | null;
  dispose: () => void;
}

/** The private GlobeControls members the orchestrator drives (B12) — 3d-tiles-renderer types them
 *  as internal, so cast ONCE through this shim instead of scattering `as any`. Behaviour verified
 *  against the library source (0.4.28); the names are load-bearing (see the camera-feel comments). */
interface GlobeControlsInternal {
  /** Per-frame zoom delta the library accumulates; the orchestrator banks + eases it (zoom smoothing). */
  zoomDelta: number;
  /** The library's current up vector (read pre-update to measure the auto-verticality it applied). */
  up: THREE.Vector3;
  /** Interaction state (EnvironmentControls.js:17-22: NONE 0 · DRAG 1 · ROTATE 2 · ZOOM 3 ·
   *  WAITING 4) — the /m 2D map reads it to tell the two-finger TILT gesture (touch ROTATE)
   *  from everything else. The constants are not re-exported at the package root. */
  state: number;
  /** The library's pointer bookkeeping — `isPointerTouch()` distinguishes glass from a mouse. */
  pointerTracker: { isPointerTouch(): boolean };
  /** Ellipsoid-surface up at a point (used for the tilt-glide pivot + the live tilt mirror). */
  getUpDirection(point: THREE.Vector3, target: THREE.Vector3): void;
  /** Rotate the camera about a pivot (azimuth, altitude) — the declination glide's rotation path. */
  _applyRotation(azimuth: number, altitude: number, pivot?: THREE.Vector3): void;
}

/**
 * Deep-merge one scoring patch onto another (`__globe.bestSpotTuning`'s merge half, SPEC_V2 §5.6).
 *
 * Plain objects recurse; everything else — numbers, booleans, enum strings, arrays — REPLACES.
 * Arrays replace deliberately: `quadrature.discColumns`-shaped fields are a whole sampling
 * decision, and an element-wise merge would let a two-element edit leave a stale tail behind.
 */
function deepMergePatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k];
    out[k] =
      v !== null && typeof v === "object" && !Array.isArray(v) &&
      prev !== null && typeof prev === "object" && !Array.isArray(prev)
        ? deepMergePatch(prev as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

export function attachStylizedTiles(opts: {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  ionToken: string;
  reduceMotion?: boolean;
  /** GlobeCanvas's DirectionalLight (buildings key + shadow caster) — the orchestrator drives its
   *  direction from the ephemeris and its shadow rig from the view focus. */
  sunLight?: THREE.DirectionalLight;
  /** The extra shadow-only cascades built at BOOT by GlobeCanvas (owner defect 1, 2026-08-27) —
   *  zero-intensity DirectionalLights whose depth maps cover the view OUTSIDE `sunLight`'s own
   *  capped box. Empty unless ULTRA was on at page load. See `lib/globe/shadowCascade`. */
  shadowCascades?: THREE.DirectionalLight[];
  /** GlobeCanvas's HemisphereLight (the sky/ground ambient fill on the buildings). ULTRA S10
   *  re-seats it onto the LOCAL UP at the view focus and tracks its intensity/tint to the
   *  ephemeris; with the chip off it is never touched. */
  hemiLight?: THREE.HemisphereLight;
  /** Initial device quality tier (RENDERING_QUALITY_PASS WS1) — the tile knobs start here so a
   *  weak device isn't briefly over-committed before the first governor correction. Default high. */
  qualityTier?: QualityTier;
  /** Mobile texture tier (MOBILE_PLAN M0): false skips the base-earth 8k swaps and loads the 2k
   *  milky-way haze. Needed because phones report maxTextureSize ≥ 8192 — GPU capability alone
   *  can't gate the ~280 MB texture budget. Default true (desktop byte-identical). */
  allow8k?: boolean;
  /** AO altitude gate (RENDERING_QUALITY_PASS R1): the orchestrator knows the camera altitude, so
   *  it tells GlobeCanvas (which owns the GTAOPass + the tier gate) whether the camera is low
   *  enough for AO. Only present when AO.enabled — undefined otherwise (zero cost). */
  aoControl?: { setAltActive(active: boolean): void };
}): TilesHandle {
  const {
    scene,
    camera,
    renderer,
    ionToken,
    reduceMotion = false,
    sunLight,
    shadowCascades = [],
    hemiLight,
    qualityTier = "high",
    allow8k = true,
    aoControl,
  } = opts;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Base ellipsoid scale: WGS84 shrunk a hair (EARTH.shrink) so the imagery ground at exact WGS84
  // always renders in front. Shared by the decorations so they hug the same surface.
  const baseScale = new THREE.Vector3(
    WGS84_A * EARTH.shrink,
    WGS84_B * EARTH.shrink,
    WGS84_A * EARTH.shrink,
  );

  const earth = attachBaseEarth(scene, {
    baseScale,
    maxAniso,
    maxTextureSize: renderer.capabilities.maxTextureSize,
    allow8k,
  });
  const graticule = attachGraticule(scene, { baseScale });
  const atmosphere = attachAtmosphere(scene, { baseScale });
  const stars = attachStars(scene, { dpr: renderer.getPixelRatio(), allow8k });
  // 3D enrichment — BEST VARIANT BY DEFAULT per baked region (owner rule 2026-08-18; registry =
  // lib/globe/regions.ts): entirely opt-in via PUBLIC_ENRICHED_TILES_URL. When set, the global
  // OSM buildings are masked inside the boot region's bbox and that region's BEST bake streams in
  // their place, seated on the rendered terrain (R1). Absent → maskBbox null + no 3rd renderer =
  // byte-identical to before (the Overture-trial-flag precedent). The `?enriched=` search param
  // is a DEV seam only (A/B compares / off); the old BLD variant pref is retired — the chips are
  // a plain live buildings on/off now (store/camera `buildings3d`). URL and mask bbox come from
  // ONE resolver call, so they can never follow different bakes. A `#p=`/`#f=` share into another
  // baked city boots THAT city's best bake (the boot-point region wins the default).
  const bootHash = typeof location === "undefined" ? "" : location.hash;
  const bootPoint = parsePoseHash(bootHash) ?? parseFpvHash(bootHash);
  const enrichedSel = resolveEnrichedSelection(
    import.meta.env.PUBLIC_ENRICHED_TILES_URL as string | undefined,
    typeof location === "undefined" ? "" : location.search,
    bootPoint?.latDeg,
    bootPoint?.lonDeg,
  );
  const enrichedUrl = enrichedSel.url;
  const enrichedBbox = enrichedSel.bbox;
  // U5: the shared download-priority aim state — written once per frame (stepLoadAim, after the
  // focus step computes the camera forward), read by the buildings/enriched download comparators.
  const loadAim = makeLoadAim();
  // U6: the foveation boundary mirror — flipped in stepViewFocus when fpvActive changes; the
  // per-tier gate (foveation null on high) lives in the modules, so this only tracks FPV.
  let foveaOn = false;
  const buildings = attachBuildings(scene, {
    camera,
    renderer,
    ionToken,
    maskBbox: enrichedBbox, // null exactly when no enriched streams (one-resolver invariant)
    loadAim,
  });
  // GLO-30 terrain patch (U7→bake slice, design ruling 2026-08-18): silent + automatic — the
  // registry decides where the high-accuracy self-baked terrain composites over CWT; the user
  // never chooses (C6-ruled 30 m native). Env base unset → pure CWT, byte-identical.
  const terrainBase = resolveTerrainBase(
    import.meta.env.PUBLIC_TERRAIN_TILES_URL as string | undefined,
  );
  const terrainCfgs = BAKED_REGIONS.flatMap((r) => (r.terrain ? [r.terrain] : []));
  const ground = attachImageryGround(scene, {
    camera,
    renderer,
    ionToken,
    terrainPatch: terrainBase && terrainCfgs.length ? { base: terrainBase, cfgs: terrainCfgs } : null,
    // #15: construct at the tier's composite resolution — the applyQualityTier call below then
    // no-ops instead of rebuilding the overlay stack it just built.
    overlayResolution: QUALITY.tiers[qualityTier].overlayResolutionPx,
  });
  // U8 per-building overrides (owner 2026-08-18) → MESH SUITE MS3 (2026-09-02): the localStorage
  // map is MINE (dirty edits, pending resets, synced copies); the WORLD's rows for the resolved
  // variant are fetched from /api/building-overrides at boot (`bldgShared`, memory only) and
  // merged by lib/globe/bldgSync's policy — local pending wins, shared wins over my synced copy.
  // The engine consults `forCell` per cell at load-model (checksum-validated; a mismatch on a
  // row with no OSM id drops it) and `byOsm` for the recovery sweep (a row whose bake-sequential
  // key died in a re-bake finds its building by OSM id and is re-keyed here with fresh facts).
  // The verbatim `?enriched=<url>` dev seam has no stable variant identity → seam omitted.
  const bldgOverrideMap = loadOverrides();
  const bldgShared: SharedMap = new Map();
  const bldgIndex = enrichedSel.variant
    ? new OverrideIndex(enrichedSel.variant, bldgOverrideMap, bldgShared)
    : null;
  const refreshBldgDirty = () =>
    useBldgSyncStore.getState()._set({ dirty: dirtyCount(bldgOverrideMap), shared: bldgShared.size });
  const bldgOverridesSeam =
    bldgIndex && enrichedSel.variant
      ? {
          forCell: (cellUri: string) => bldgIndex.forCell(cellUri),
          byOsm: (osm: string) => bldgIndex.byOsmId(osm),
          onInvalid: (cellUri: string, featureId: number) => {
            const key = overrideKey(enrichedSel.variant as string, cellUri, featureId);
            if (bldgOverrideMap[key]) deleteOverride(bldgOverrideMap, key);
            bldgShared.delete(key);
            bldgIndex.invalidate();
            refreshBldgDirty();
          },
          onRecovered: (
            row: EffectiveOverride,
            cellUri: string,
            featureId: number,
            facts: { cx: number; cz: number; vc: number; bakedHeightM: number },
          ) => {
            // The row's fingerprint died (a re-bake) and its OSM id found the building: re-key
            // it with the fresh facts so the next fingerprint pass passes on the checksum.
            const key = overrideKey(enrichedSel.variant as string, cellUri, featureId);
            const fresh: OverrideRow = {
              ...row.row,
              cx: roundCentroidM(facts.cx),
              cz: roundCentroidM(facts.cz),
              vc: facts.vc,
              hM: Math.round(facts.bakedHeightM * 10) / 10,
            };
            if (row.origin === "mine") {
              delete bldgOverrideMap[row.key];
              bldgOverrideMap[key] = fresh;
              saveOverrides(bldgOverrideMap);
            } else {
              bldgShared.delete(row.key);
              bldgShared.set(key, fresh);
            }
            bldgIndex.invalidate();
          },
        }
      : undefined;
  const enriched =
    enrichedUrl && enrichedBbox
      ? attachEnrichedBuildings(scene, {
          camera,
          renderer,
          url: enrichedUrl,
          bbox: enrichedBbox,
          terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
          loadAim,
          overrides: bldgOverridesSeam,
        })
      : null;
  // MESH SUITE MS3: the world fetch + the member SYNC. Both fail OPEN — local rows keep applying;
  // a fetch that never lands leaves the world invisible, never the user's own edits. The fetch
  // runs at boot (cells streamed before it lands are covered by `reapplyOverrides`) and again
  // before every push (fetch-before-push — the reconciliation honours last-committer-wins; a
  // failed fetch does not block the push, LWW keeps an un-reconciled push safe).
  const bldgFetchShared = async (): Promise<boolean> => {
    if (!bldgIndex || !enrichedSel.variant) return false;
    useBldgSyncStore.getState()._set({ world: "fetching" });
    try {
      const res = await fetch(
        `/api/building-overrides?variant=${encodeURIComponent(enrichedSel.variant)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { overrides?: unknown[]; complete?: boolean };
      const now = Date.now();
      const rows: Array<{ key: string; row: OverrideRow }> = [];
      for (const raw of Array.isArray(body.overrides) ? body.overrides : []) {
        const r = sharedRowFromPublic(raw as PublicOverride, now);
        if (r) rows.push(r);
      }
      const complete = body.complete === true;
      const { changed } = reconcileShared(bldgOverrideMap, bldgShared, rows, complete, now);
      if (changed > 0) saveOverrides(bldgOverrideMap);
      bldgIndex.invalidate();
      enriched?.reapplyOverrides();
      useBldgSyncStore.getState()._set({ world: "ready", complete });
      refreshBldgDirty();
      return true;
    } catch (e) {
      console.warn("[bldg-sync] world fetch failed", e);
      useBldgSyncStore.getState()._set({ world: "error" });
      refreshBldgDirty();
      return false;
    }
  };
  let bldgSyncBusy = false;
  const bldgSyncNow = async (): Promise<void> => {
    if (bldgSyncBusy || !bldgIndex || !enrichedSel.variant) return;
    bldgSyncBusy = true;
    useBldgSyncStore.getState()._set({ syncing: true, result: null });
    const done = (result: BldgSyncResult) => {
      bldgSyncBusy = false;
      useBldgSyncStore.getState()._set({ syncing: false, result });
      refreshBldgDirty();
      syncBldgEdit(); // the armed building's origin badge (UNSYNCED → SYNCED)
    };
    const outcome = (kind: BldgSyncResult["kind"], upserted = 0, removed = 0, message?: string): BldgSyncResult =>
      message ? { kind, upserted, removed, atMs: Date.now(), message } : { kind, upserted, removed, atMs: Date.now() };
    try {
      // The login gate: the member store mirrors the session; resolve it once if nobody has.
      const ms = useMemberStore.getState();
      if (ms.phase === "unknown" || ms.phase === "loading") await ms.refresh();
      if (useMemberStore.getState().phase !== "member") {
        done(outcome("signed-out"));
        return;
      }
      await bldgFetchShared();
      const payload = syncPayload(bldgOverrideMap, bldgShared);
      if (payload.upserts.length === 0 && payload.removes.length === 0) {
        if (payload.sent.length > 0) {
          // Only stale tombstones (the world already lost those rows) — they die here.
          applySyncResult(bldgOverrideMap, bldgShared, payload, Date.now());
          saveOverrides(bldgOverrideMap);
          bldgIndex.invalidate();
        }
        done(outcome("nothing"));
        return;
      }
      const res = await fetch("/api/building-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upserts: payload.upserts, removes: payload.removes }),
      });
      if (res.status === 401) {
        useMemberStore.getState()._setAnonymous();
        done(outcome("signed-out"));
        return;
      }
      if (res.status === 400) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        done(outcome("rejected", 0, 0, b.message));
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { inserted?: number; updated?: number; removed?: number };
      applySyncResult(bldgOverrideMap, bldgShared, payload, Date.now());
      saveOverrides(bldgOverrideMap);
      bldgIndex.invalidate();
      done(outcome("synced", (body.inserted ?? 0) + (body.updated ?? 0), body.removed ?? 0));
    } catch (e) {
      console.warn("[bldg-sync] push failed", e);
      done(outcome("failed"));
    }
  };
  if (bldgIndex) {
    refreshBldgDirty();
    void bldgFetchShared();
  }
  // U5 instrumentation: per-renderer download→model latency probes (tile-download-start pairs
  // with load-model per tile; load-error forgets the entry). Counters only — the DEV seam
  // (__globe.u5) reads snapshots; u5Mark() starts a time-to-first window for a scripted A/B.
  const attachLoadProbe = (t: {
    addEventListener: (type: string, cb: (e: { tile?: object }) => void) => void;
  }) => {
    const p = makeTileLatencyProbe(() => performance.now(), LOADING.latencyRing);
    t.addEventListener("tile-download-start", (e) => e.tile && p.start(e.tile));
    t.addEventListener("load-model", (e) => e.tile && p.end(e.tile));
    t.addEventListener("load-error", (e) => e.tile && p.cancel(e.tile));
    return p;
  };
  const loadProbes = {
    buildings: attachLoadProbe(buildings.tiles),
    ground: attachLoadProbe(ground.tiles),
    enriched: enriched ? attachLoadProbe(enriched.tiles) : null,
  };
  /**
   * BEST SPOT §3.4 item 1's MISSING RENDERER — a monotone counter on BUILDING tile arrivals and
   * departures (OSM + enriched), the `imageryGround.terrainEpoch()` idiom for the tilesets that
   * actually carry the obstruction mass.
   *
   * It exists because the feed's three streaming epochs were the GROUND tileset, the MVT version
   * and the enriched RE-SEAT counter — not one of which moves when a building tile lands. A disc
   * solved before the buildings streamed therefore stayed terrain-only forever, which (with
   * `▦ 3D DETAIL` off, where the tilesets are detached and nothing ever streams) produced the
   * measured 2026-08-24 failure: a 300 m Dnipro disc whose 31,417 scored cells all carried the
   * identical score byte. `dispose-model` counts too: an LRU eviction changes the DSM exactly as
   * much as an arrival does, and a re-solve that used a roof three has already thrown away is the
   * same lie in the other direction.
   */
  let builtEpochN = 0;
  const bumpBuiltEpoch = () => {
    builtEpochN++;
  };
  for (const t of [buildings.tiles, ...(enriched ? [enriched.tiles] : [])]) {
    t.addEventListener("load-model", bumpBuiltEpoch);
    t.addEventListener("dispose-model", bumpBuiltEpoch);
  }
  const sky = attachSky(scene);
  const skyTarget = attachSkyTarget(scene); // tracked sky target (ASTRO ENGINE) — 10P by default
  const skyTrail = attachSkyTrail(scene); // the target's day-arc trajectory (phase C, SHOW+TRAIL)
  const skyGhosts = attachSkyGhosts(scene); // temporal ghost copies of the tracked body (QoL-2)
  const findGhosts = attachFindGhosts(scene); // FIND v2 standings projected into the frame (owner rework)
  const skyNames = attachSkyNames(); // hover-name reveal for stars/asterisms/constellations (qol4)
  const bldgEditLabel = attachBldgEditLabel(); // U8 mesh-pinned dual-height indicator (both shells)
  const dayArcs = attachDayArcs(scene); // FPV planning overlays (S6) — hidden outside FPV
  // U4 aim cones: map direction lines + rise→set visibility sectors at the plan anchor —
  // orbit-mode only (FPV keeps the viewfinder clean; the MapWindow canvas is the FPV twin).
  const aimCones = attachAimCones({
    scene,
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
  });
  // Batch #4 S2: the planned-shot focal cone at the same anchor — orbit-mode only (in FPV you
  // are standing inside it; the MapWindow/minimap twins mirror the live hud there).
  const focalCone = attachFocalCone({
    scene,
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
  });
  const geoLabels = attachGeoLabels(scene); // NE labels + boundaries (S7b) — mid-zoom window only
  // Shared MVT source (S7 feedback batch): ONE fetch/parse per z14 tile feeds the GL street
  // names AND the vector feature web. Both seat on the RENDERED terrain, not the ellipsoid.
  const vtiles = attachVectorTiles();
  const streetNames = attachStreetNames({
    scene,
    vtiles,
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
    maxAniso,
  });
  const vectorFeatures = attachVectorFeatures({
    scene,
    vtiles,
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
    tileZ: STREETS.tileZ,
  });
  // Pass 3 planner feed (WS4 + Dnipro Slice 5): horizon profile from terrain + the streamed
  // building/tree geometry around the photo/FPV eye, almanac chips, skyline crossings — all
  // mirrored into store/plan for the PlanPanel. Owns no scene objects.
  const planFeed = attachPlanFeed({
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
    buildingsGroup: buildings.tiles.group,
    enrichedGroup: enriched?.tiles.group ?? null,
    maskBbox: enrichedBbox,
  });
  // FPV mini-map feed (owner 2026-07-14): the SAME shared MVT source, projected to local metres
  // around the walked viewer and mirrored into store/minimap for the MiniMap panel.
  const minimapFeed = attachMinimapFeed({ vtiles });
  // BEST SPOT (SPEC_V2 §7 S3d): the disc solver's scene half. The FEED owns the long-lived worker,
  // the six residency tiers and the store mirror; the SHEET owns the GL. Split because the sheet
  // must be able to paint a field the feed is no longer solving (a cancelled ladder rung is still
  // the truth on screen) and because the feed owns no scene objects at all.
  const bestSpotFeed = attachBestSpotFeed({
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
    groundGroup: ground.tiles.group,
    buildingsGroup: buildings.tiles.group,
    enrichedGroup: enriched?.tiles.group ?? null,
  });
  const bestSpotSheet = attachBestSpotSheet(scene, {
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
    maxAniso,
  });

  // --- Adaptive quality fan-out (RENDERING_QUALITY_PASS WS1): GlobeCanvas owns the device tier +
  //     governor + the renderer levers (DPR/bloom/shadows); here we push the tier's TILE knobs into
  //     each module. On `high` every renderer restores its captured library default (null LRU), so a
  //     capable machine is byte-identical to before the quality pass. Called once now (the device
  //     tier) + on every governor change (via the returned setQualityTier). -----------------------
  // QA-7b: the current tier's overlay composite base (px) — stepGroundUpdate resolves the
  // effective value (× the flat-chart raise) each frame; seeded with the constructor default.
  let tierOverlayPx: number = GROUND.overlayResolution;
  // QA slice C (2026-08-21h): the EFFECTIVE composite px — sticky-up (see stickyOverlayPx).
  // Seeded 0 so frame 1 ratchets to the boot value (== the constructor px → a no-op write).
  let overlayPxEff = 0;
  /** RC20/T34: ms left in the post-flip ground-LRU bank window, and the FPV key the latch
   *  compares against. `-1` seeds "no flip on frame 1" — without it the first frame would read
   *  as a boundary crossing and arm a 45 s bank nobody asked for. */
  let groundBankMsLeft = 0;
  let groundFpvKey = -1;
  /** The tier currently applied — so the ULTRA edge can re-run the fan-out without waiting for
   *  the governor to change its mind (it may never: on a `high` machine it is a no-op by design). */
  let activeQualityTier: QualityTier = qualityTier;
  /** ULTRA HQ mirror (owner 2026-08-22h) — written by stepUltraGate, published to GlobeCanvas
   *  via `TilesHandle.ultraPin`.
   *
   *  DECLARED HERE, not beside `hqAllowed` where it belongs by topic: `applyQualityTier` reads
   *  it and is CALLED during attach, hundreds of lines above the shell-gate block, so a
   *  `let` down there put it in the temporal dead zone and the whole tileset failed to attach
   *  with `ReferenceError: Cannot access 'ultraOn' before initialization`. Nothing catches that
   *  loudly — GlobeCanvas's `.catch` logs it as a console.WARN and the app silently renders the
   *  procedural placeholder. `astro check` cannot see it either; only running it can. */
  let ultraOn = false;
  /**
   * RC18 — the TILE half of a tier change: error targets, LRU cap/floor pairs, queue caps,
   * foveation, and the street/lattice budgets. Every lever here moves MONOTONICALLY with the
   * tier (a promote lowers every error target and raises every cap — locked by
   * `quality.test.ts` "THE SAFETY PROPERTY"), which is what makes it safe to land while FPV
   * owns the camera: a promote can only stream more detail in, never evict or rebuild.
   *
   * Deliberately NOT here — see `applyTierDeferred`.
   */
  const applyTierTiles = (tier: QualityTier) => {
    activeQualityTier = tier;
    // ULTRA HQ (owner 2026-08-22h): tile-detail overrides layered on top of the running tier —
    // NOT a fourth tier (see lib/globe/quality.ultraTileLevers). With the chip off this returns
    // `QUALITY.tiers[tier]` BY IDENTITY, so the whole expression is the previous line verbatim.
    const q = ultraTileLevers(QUALITY.tiers[tier], ultraOn, QUALITY.ultraDesktop);
    // The LRU pair likewise: `ultraOn === false` is DEFINED as lruCapBytesForTier, i.e. the
    // untouched null-on-high "restore the library default" path.
    const lru = lruCapBytesForUltra(tier, q.lruBytesMB, ultraOn, QUALITY.ultraDesktop.lruBytesMB);
    const qCaps = queueCapsForTier(tier, LOADING.queueCaps); // U5: same null-on-high rule for maxJobs
    buildings.setQualityTier(q.buildingErrorTarget, lru, qCaps);
    enriched?.setQualityTier(q.buildingErrorTarget, lru, qCaps);
    // #15: the ground rides its OWN LRU budget (modest raise over lruBytesMB on mid/low — the
    // 256 overlay composite frees ~4× per-tile VRAM, and a retained ground tile is a pan
    // re-fetch that never happens; buildings/enriched keep the shared cap — a blanket raise
    // worsens jetsam) + the per-tier overlay composite resolution.
    ground.setQualityTier(
      q.groundErrorNear,
      lruCapBytesForUltra(tier, q.groundLruBytesMB, ultraOn, QUALITY.ultraDesktop.groundLruBytesMB),
      qCaps,
    );
    // U6: per-tier foveation (null on high — byte-identical; regions/periphery only engage in
    // FPV via setFoveaActive). Safe mid-FPV: each module recomputes its base from (tier, cfg, on).
    buildings.setFoveation(q.foveation);
    enriched?.setFoveation(q.foveation);
    ground.setFoveation(q.foveation);
    streetNames.setMaxVisible(q.maxStreetNames);
    vectorFeatures.setLatticeBudget(q.vectorLatticeBudget);
  };
  /**
   * RC18 — the DEFERRED half. Three levers that must NOT land while FPV owns the camera:
   *
   *  · `tierOverlayPx` — the composite-resolution BASE. `stickyOverlayPx` only ratchets UP, so a
   *    raise reaches `ground.setOverlayResolution` on the very NEXT frame, and that call is a
   *    fresh-instance overlay rebuild: every composited texture destroyed plus a tile refetch
   *    storm (the QA-7b white-chart regression). `lib/globe/quality.ts` already excludes
   *    `overlayResolutionPx` from the ULTRA lever set for exactly this reason — RC18 excludes it
   *    from the live-promote set for the same one.
   *  · `stars.setDpr` / `ground.refreshResolution` — DPR MIRRORS. Their whole reason for existing
   *    is that GlobeCanvas has just written a new pixel ratio; with the renderer half parked the
   *    DPR has not moved, so running them here would be a self-write pretending to be an update.
   */
  const applyTierDeferred = (tier: QualityTier) => {
    // QA-7b: the tier value is the BASE only — stepGroundUpdate is the ONE writer of the
    // effective composite resolution. QA slice C: the effective value is STICKY-UP (a promote
    // to high may raise it once; a demote never lowers it — a lower write is a fresh-instance
    // overlay rebuild, the white-chart storm class).
    tierOverlayPx = ultraTileLevers(
      QUALITY.tiers[tier],
      ultraOn,
      QUALITY.ultraDesktop,
    ).overlayResolutionPx;
    // U2/A11: GlobeCanvas re-set the renderer pixel ratio just before this call (applyTier order)
    // — refresh the stars' captured uDpr so point sizes track the governor's DPR shed/restore,
    // and the ground's DEVICE-px SSE resolution (2026-08-18 sharpness batch) tracks it too.
    stars.setDpr(renderer.getPixelRatio());
    ground.refreshResolution();
  };
  /** Both halves, in the order GlobeCanvas's renderer-first sequencing depends on. The attach
   *  seed and every non-FPV tier change go through here — see `planTierApply`'s re-convergence
   *  guarantee, which is what keeps the two halves from stranding apart. */
  const applyQualityTier = (tier: QualityTier) => {
    applyTierTiles(tier);
    applyTierDeferred(tier);
  };
  applyQualityTier(qualityTier);

  // U2/A11: setResolutionFromRenderer was a ONE-SHOT per tile renderer — after any resize or
  // orientation change the screen-space-error denominator kept the old viewport height, so every
  // tile's computed error was wrong by the resize ratio and the next update() burst-loaded (or
  // mass-evicted) against phantom error. Refresh all three on every resize (cheap: a vector read).
  const onEngineResize = () => {
    buildings.tiles.setResolutionFromRenderer(camera, renderer);
    ground.refreshResolution(); // DEVICE-px SSE for the imagery (2026-08-18 sharpness batch)
    enriched?.tiles.setResolutionFromRenderer(camera, renderer);
  };
  window.addEventListener("resize", onEngineResize);

  // --- Ephemeris: ONE astronomical sample drives every light in the scene (terminator, ground
  //     grade, atmosphere, sun/moon bodies, building key light, moonlight). Re-sampled when scene
  //     time moves >SKY.sampleIntervalMs — the sun drifts 0.004°/s, so 1 s is sub-pixel. ---------
  const sunDirW = new THREE.Vector3(5, 2, 4).normalize(); // overwritten by the first sample
  const moonDirW = new THREE.Vector3(0, 0, 1);
  const moonPosW = new THREE.Vector3(0, 0, 3.8e8);
  let sunAngRad = 0.00465;
  let moonIllum = 0.5; // illuminated fraction (the moon-shadow GATE reads this)
  let moonKs = 0.05; // K&S-1991 phase intensity, 1 = full (every moonlight STRENGTH reads this)
  let gastRad = 0; // sidereal angle for the star sphere (−GAST about +Z = equatorial → ECEF)
  // Tracked sky target (ASTRO ENGINE phase A — the 2026-08-02 comet seam generalised): rides the
  // SAME sample cadence — even the fast comet drifts only ~0.3°/day (≈4e-6 °/s), so a 1 s
  // re-sample is orders of magnitude finer than any target needs. A target SWAP (SKY search)
  // forces an immediate re-sample via lastTargetId in stepSkyTarget.
  const targetDirW = new THREE.Vector3(0, 0, 1);
  const targetTailW = new THREE.Vector3(0, 0, 1);
  const targetPoleW = new THREE.Vector3(0, 0, 1); // Saturn ring-plane normal (phase D)
  // Diurnal parallax for the marker (owner 2026-08-14 round 3): TargetState.dir is GEOCENTRIC —
  // fine for stars/DSOs (infinity) but the MOON's topocentric direction differs by up to ~0.95°
  // (≈2 moon diameters; the "mark scope drawn off-target" screenshots). When the target carries
  // a finite distance, bank its ECEF position and re-derive the camera-relative direction EVERY
  // FRAME in stepSkyTarget — the exact move sky.ts makes for the moon disc, so the reticle,
  // click/hover hit tests and edge chip all land on the rendered body. targetAzAlt (ghosts/
  // trail/panel) already subtracts the observer — this closes the one remaining geocentric seam.
  const targetPosW = new THREE.Vector3();
  let targetDistM: number | null = null;
  let targetHasPole = false;
  let targetState: TargetState | null = null;
  let lastTargetId = "";
  // --- ECLIPSE state (2026-08-22k). `eclipseK` is the DAYLIGHT REMAINING scalar every light in
  //     the scene multiplies by; it is exactly 1 whenever no eclipse is under way, so the whole
  //     feature is a provable no-op on every ordinary frame. Unlike the ULTRA look this is NOT
  //     gated on a chip: an eclipse is physics, not a fidelity lever.
  //
  //     DECLARED HERE, NOT WITH THE OTHER LOOK STATE ~1,300 LINES DOWN. `sampleEphemeris` below
  //     runs at module init and writes `lunarEcl`; from the TDZ that threw
  //     `ReferenceError: Cannot access 'lunarEcl' before initialization`, the dynamic import's
  //     own .catch() swallowed it as "[globe] tiles disabled", and the WHOLE real-Earth globe
  //     silently fell back to the procedural placeholder. Browser-caught, invisible to vitest and
  //     to astro check — and the second time this exact trap has bitten in this file (see the
  //     `ultraOn` note above). `solarEcl` is seeded disjoint (separation pi) so the off state is
  //     honest before the first frame. ------------------------------------------------------------
  let solarEcl: SolarEclipseState = solarEclipseFromDiscs(Math.PI, 1, 1);
  let lunarEcl: LunarEclipseState = { ...NO_LUNAR_ECLIPSE };
  let eclipseK = 1;
  let lastEclipseMs = performance.now();
  const _eclDelta = new THREE.Vector3();
  let lastSampleMs = -Infinity;
  const sampleEphemeris = (tMs: number) => {
    lastSampleMs = tMs;
    const s = bodyStatesAt(tMs);
    const target = useSkyStore.getState().target;
    lastTargetId = target.id;
    const c = (targetState = target.stateAt(tMs));
    targetDirW.set(c.dir[0], c.dir[1], c.dir[2]);
    targetDistM = c.distanceAu != null ? c.distanceAu * KM_PER_AU * 1000 : null;
    if (targetDistM != null) targetPosW.copy(targetDirW).multiplyScalar(targetDistM);
    if (c.tailDir) targetTailW.set(c.tailDir[0], c.tailDir[1], c.tailDir[2]);
    targetHasPole = target.id === "planet:saturn";
    if (targetHasPole) {
      const p = saturnRingPoleDir(tMs);
      targetPoleW.set(p[0], p[1], p[2]);
    }
    gastRad = s.gastRad;
    sunDirW.set(s.sunDir[0], s.sunDir[1], s.sunDir[2]);
    moonDirW.set(s.moonDir[0], s.moonDir[1], s.moonDir[2]);
    moonPosW.copy(moonDirW).multiplyScalar(s.moonDistanceKm * 1000);
    sunAngRad = angularRadiusRad(SUN_RADIUS_KM, s.sunDistanceAu * KM_PER_AU);
    moonIllum = s.moonIllumination;
    // Physical relative moonlight (S5 §Item 7): quarter ≈ 9% of full, not the linear 50%.
    moonKs = moonPhaseIntensity(s.moonPhaseAngleDeg);
    // The Earth's shadow is a GEOCENTRIC object — no camera term, so unlike the solar case it
    // rides this 1 Hz sample. `moonKs` is dimmed by it right here, which is the ONE write that
    // reaches every moonlight consumer at once: uMoonGlow, uFtwMoonGlow, the moon-shadow key
    // light, the ground shadow strength and sky.ts's moonLight. Dimming any one of them alone
    // would leave a full-strength moon lighting the city under a blood-red disc.
    lunarEcl = lunarEclipseFromState(s);
    if (lunarEcl.phase !== "none") {
      const umbral = Math.min(1, Math.max(0, lunarEcl.umbralCoverage));
      const penumbral = Math.min(1, Math.max(0, lunarEcl.penumbralMag));
      moonKs *=
        (1 - ECLIPSE.penumbraDim * penumbral * (1 - umbral)) *
        (1 - (1 - ECLIPSE.umbraLight) * umbral);
    }
    const moonGlow = SKY.moonSceneGlow * moonKs;
    (earth.uniforms.uSunDir.value as THREE.Vector3).copy(sunDirW);
    (earth.uniforms.uMoonDir.value as THREE.Vector3).copy(moonDirW);
    earth.uniforms.uMoonGlow.value = moonGlow;
    (ground.uniforms.uFtwSun.value as THREE.Vector3).copy(sunDirW);
    (ground.uniforms.uFtwMoonDir.value as THREE.Vector3).copy(moonDirW);
    ground.uniforms.uFtwMoonGlow.value = moonGlow;
    (atmosphere.uniforms.uSunDir.value as THREE.Vector3).copy(sunDirW);
  };
  sampleEphemeris(sceneTimeMs());

  // --- Camera framing: globe-scale near/far (GlobeControls refines them each frame), then the
  //     signature LEO pose — oblique toward the horizon, NOT nadir (PROJECT_SEED §2). -----------
  camera.near = POSE.near;
  camera.far = POSE.far;

  const camPos = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(
    (POSE.cam.latDeg * Math.PI) / 180,
    (POSE.cam.lonDeg * Math.PI) / 180,
    POSE.cam.altM,
    camPos,
  );
  const targetPos = new THREE.Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(
    (POSE.target.latDeg * Math.PI) / 180,
    (POSE.target.lonDeg * Math.PI) / 180,
    POSE.target.altM,
    targetPos,
  );
  camera.position.copy(camPos);
  camera.up.copy(camPos).normalize(); // local "up" = away from Earth centre (spacecraft POV, no roll)
  camera.lookAt(targetPos);
  camera.updateProjectionMatrix();

  // --- URL pose restore (S7 feedback #2): a shared/reloaded `#p=` hash overrides the LEO
  //     default — the camera BOOTS at the shared view (no flight), welcome stays skipped
  //     (Welcome.tsx checks the same hash). Reconstructed through the ONE arrival derivation
  //     (arrivalPose) from the stored view focus + camera alt/heading/tilt. ------------------
  // Boots the camera at an orbit pose over a geodetic point along a view heading (shared by the
  // `#p=` restore and the `#f=` FPV restore's pre-entry framing).
  const bootPoseAt = (
    latDeg: number,
    lonDeg: number,
    headingDeg: number,
    altAboveGroundM: number,
    tiltDeg: number,
  ) => {
    const lookAt = new THREE.Vector3();
    const latRad = (latDeg * Math.PI) / 180;
    const lonRad = (lonDeg * Math.PI) / 180;
    WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, 0, lookAt);
    const upT = lookAt.clone().normalize();
    const east = new THREE.Vector3(-Math.sin(lonRad), Math.cos(lonRad), 0);
    const north = new THREE.Vector3().crossVectors(upT, east).normalize();
    // The camera sits OPPOSITE the view heading: approach = −(sin·east + cos·north).
    const h = (headingDeg * Math.PI) / 180;
    const approachHoriz = east
      .clone()
      .multiplyScalar(-Math.sin(h))
      .addScaledVector(north, -Math.cos(h))
      .normalize();
    const pose = arrivalPose({
      lookAt,
      approachHoriz,
      groundAltM: 0, // terrain hasn't loaded at boot; altM is the camera's ellipsoidal altitude
      altAboveGroundM,
      tiltDeg,
      wgs84A: WGS84_A,
      wgs84B: WGS84_B,
    });
    camera.position.copy(pose.position);
    camera.up.copy(pose.position).normalize();
    camera.lookAt(pose.lookAt);
    camera.updateProjectionMatrix();
  };
  // A shared `#f=` FPV view pending its temp-FPV entry (consumed by the entry block once the
  // pin point exists — the exact basis/eye/FOV then come from the hash, not the boot camera).
  let pendingFpvShare: UrlFpvPose | null = null;
  const urlPose = parsePoseHash(typeof location === "undefined" ? "" : location.hash);
  const urlFpv = urlPose ? null : parseFpvHash(typeof location === "undefined" ? "" : location.hash);
  if (urlPose) {
    bootPoseAt(urlPose.latDeg, urlPose.lonDeg, urlPose.headingDeg, urlPose.altM, urlPose.tiltDeg);
  } else if (urlFpv) {
    // Shared FPV view (owner 2026-07-14): boot NEAR the viewer point looking along the shared
    // bearing (tiles start streaming toward the right street), then enter temp-pin FPV — the
    // entry flight lands on the exact eye; basis/pitch/FOV apply from the hash at entry.
    bootPoseAt(
      urlFpv.latDeg,
      urlFpv.lonDeg,
      urlFpv.headingDeg,
      FPV.shareBootAltM,
      FPV.shareBootTiltDeg,
    );
    pendingFpvShare = urlFpv;
    useCameraStore.getState().setTempPin({ latDeg: urlFpv.latDeg, lonDeg: urlFpv.lonDeg });
    useCameraStore.getState().setTempFpv(true);
  }
  if (urlPose || urlFpv) {
    // Shared CUSTOM scene time (owner 2026-07-14): a `&t=` on either hash pins the scene to
    // that instant so the shared link reproduces the light too. No `t` = live (never shared).
    const urlTimeMs = parseTimeHash(location.hash);
    if (urlTimeMs !== null) useTimeStore.getState().setTime(urlTimeMs);
  }

  // --- /m 2D-first navigation (UPLIFT U1, owner point 1): the mobile shell — detected by the
  //     server-rendered body.m scope hook (MobileLayout), present before any island mounts —
  //     boots into a top-down, north-up 2D map with every building tileset detached. A shared
  //     `#p=` scene pose boots 3D instead (the north-lock would destroy the shared heading);
  //     a shared `#f=` FPV view enters FPV as always, and its exit lands in 2D. Desktop:
  //     isMobileShell false → mapMode stays "3d" → every U1 seam is inert. ------------------
  const isMobileShell =
    typeof document !== "undefined" && document.body.classList.contains("m");
  // --- HQ 3D MAP + ULTRA HQ (owner 2026-08-22h) — THE ONE GATE for both experimental chips.
  //
  //     The owner's constraint was "nothing must change on mobile", said three times. Hiding
  //     the chips is NOT isolation: `ftw:view-prefs:v1` is a single localStorage blob shared by
  //     both shells on the same origin, `useCameraStore` is the same store, and /m mounts the
  //     SAME GlobeCanvas + StylizedTiles modules. A user who enables a chip on desktop WILL
  //     have the flag true when they open /m in that browser. So the fence has to live where
  //     the ENGINE reads, not where the UI renders.
  //
  //     Both terms are load-bearing and neither alone is enough:
  //       · `!isMobileShell` excludes the /m ROUTE — but index.astro deliberately keeps
  //         tablets and touch laptops on desktop, and /m's DESKTOP chip sends a phone to
  //         `/?d=1` permanently, so a phone CAN be running the desktop shell.
  //       · `!coarsePointerShell` excludes that hardware. It is the same signal
  //         `QUALITY.leanMobile` and `TILESETS.esriMaxLevelCoarse` already key on, and it tests
  //         the PRIMARY pointer — a trackpad laptop with a touchscreen stays fine-pointer.
  //
  //     INVARIANT: every read of `hq3dMap` / `ultraQuality` anywhere in src/ sits on a line
  //     that also names `hqAllowed`, and no file outside this one may name either field.
  //     `test/components/globe/fences.test.ts` pins both halves.
  const coarsePointerShell =
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const hqAllowed = !isMobileShell && !coarsePointerShell;
  //     BEST SPOT's own gate, and it is a SEPARATE constant on purpose: `hqAllowed` answers "may
  //     this machine run the ULTRA tile levers", this answers "may this shell run a ~1 m planning
  //     surface at all" (SPEC_V2 §7 S3d, plan §7). Same two terms, same reason they are AND-ed and
  //     not a route check — `/m` mounts the SAME GlobeCanvas and `ftw:view-prefs` is ONE
  //     localStorage key shared by both shells on the same origin, so a desktop session that
  //     opened the panel genuinely has `open: true` in the store when the phone loads. The only
  //     thing that can stop the engine acting on it is a gate ON THE READ, which is why this is
  //     named here, in exactly ONE engine file, and AND-ed into every BEST SPOT engine read
  //     below. `fences.test.ts` pins both halves.
  const bestSpotAllowed = !isMobileShell && !coarsePointerShell;
  if (isMobileShell) {
    if (urlPose && urlPose.tiltDeg >= CONTROLS.twoDMaxTiltDeg) {
      useCameraStore.getState().setMapMode("3d"); // an OBLIQUE share keeps its exact 3D view
    } else {
      // No hash, an `#f=` FPV share (its exit lands in 2D), or a NADIR `#p=` share (the /m
      // pose mirror writes tilt≈0 hashes — a reload must land back on the 2D map, not in 3D).
      useCameraStore.getState().setMapMode("2d");
      // Buildings detached from frame 0 (FPV — the `#f=` case — re-attaches on entry).
      buildings.setActive(false);
      enriched?.setActive(false);
      if (!urlFpv && !urlPose) {
        // EXACT nadir, north-up (arrivalPose clamps tilt to ≥5° — construct directly):
        // screen-up = local north at the boot point, so the map reads as a chart.
        const b = enuBasis(MOBILE2D.bootLatDeg, MOBILE2D.bootLonDeg);
        camera.position.fromArray(
          geodeticToEcef(MOBILE2D.bootLatDeg, MOBILE2D.bootLonDeg, MOBILE2D.bootAltM),
        );
        camera.up.set(b.north[0], b.north[1], b.north[2]);
        camera.lookAt(
          new THREE.Vector3(
            ...geodeticToEcef(MOBILE2D.bootLatDeg, MOBILE2D.bootLonDeg, 0),
          ),
        );
        camera.updateProjectionMatrix();
      }
    }
  }

  // --- GlobeControls — documented ellipsoid binding, damping for a premium feel, snappy zoom. --
  //     T79 (2026-09-06): the subclass arms the below-camera GATE around the library's twice-a-frame
  //     whole-scene down-raycast (`scene/pluxGlobeControls.ts`) — same hits, same pushes, ~0 ms.
  const controls = new PluxGlobeControls(scene, camera, renderer.domElement);
  controls.setEllipsoid(
    (buildings.tiles as unknown as { ellipsoid?: typeof WGS84_ELLIPSOID }).ellipsoid ??
      WGS84_ELLIPSOID,
    buildings.tiles.group,
  );
  controls.enableDamping = true; // globe inertia — the single biggest "premium" interaction win
  controls.dampingFactor = CONTROLS.dampingFactor;
  controls.maxAltitude = CONTROLS.maxAltitudeRad; // allow tilting to the true horizon
  controls.cameraRadius = CONTROLS.cameraRadius; // keep a touch above rooftops via adjustHeight
  controls.zoomSpeed = CONTROLS.zoomSpeed;

  const t0 = performance.now();

  // --- Photo frustum + cinematic flight (Phase 3; arrival pose + path floor reworked in
  //     Phase 5.5 S2). When a photo lands (PLACE or click-to-place), fly to the shared arrival
  //     pose: FLIGHT.arrivalAltAboveGroundM over the rendered ground behind the photo, tilted
  //     near-horizontal so the photo superimposes on its real landscape. ----------------------
  const flight = createFlight(camera, { reduceMotion, wgs84A: WGS84_A, wgs84B: WGS84_B });

  // Terrain path floor for EVERY flight: the flight's altitude blend is ellipsoid-only, so it
  // clips through high ground unless floored. Sampled at both endpoints; clamped only upward
  // (coarse-LOD garbage must never drag the path down) and capped at Everest-plausible heights.
  const flightFloorM = (targetPos: THREE.Vector3): number => {
    const gS = ecefToGeodetic([camera.position.x, camera.position.y, camera.position.z]);
    const gT = ecefToGeodetic([targetPos.x, targetPos.y, targetPos.z]);
    const hS = ground.heightAt(gS.latDeg, gS.lonDeg) ?? 0;
    const hT = ground.heightAt(gT.latDeg, gT.lonDeg) ?? 0;
    return clampGroundM(Math.max(hS, hT)) + FLIGHT.floorClearM;
  };

  // The ONE arrival pose for a placed photo (onPlaced flights AND FPV exits): looks at the
  // image-plane centre from behind the photo, FLIGHT.arrivalAltAboveGroundM above the ground.
  const frameArrivalPose = (geom: FrustumGeometry): FlightTarget => {
    const apex = new THREE.Vector3(...geom.apex);
    const fwd = new THREE.Vector3(...geom.forward);
    const upLocal = apex.clone().normalize();
    const lookAt = apex.clone().addScaledVector(fwd, FRUSTUM.planeDistM);
    // Approach from behind the camera: horizontal projection of −forward (north for nadir shots).
    const approach = fwd.clone().negate();
    approach.addScaledVector(upLocal, -approach.dot(upLocal));
    if (approach.lengthSq() < 1e-6) approach.set(0, 0, 1).addScaledVector(upLocal, -upLocal.z);
    approach.normalize();
    const p = useUploadStore.getState().placement;
    // Clamp the terrain sample to plausible heights: unloaded/coarse quantized-mesh tiles can
    // return NEGATIVE garbage (browser-verified: Dnipro sampled from Kyiv), which would sink
    // the whole arrival to the lookAt safety floor. Clamp-only-upward discipline.
    const sampled = p ? ground.heightAt(p.latDeg, p.lonDeg) : null;
    const groundAltM =
      sampled != null
        ? clampGroundM(sampled)
        : Math.max(0, WGS84_ELLIPSOID.getPositionElevation(apex) - FRUSTUM.eyeHeightM);
    return arrivalPose({
      lookAt,
      approachHoriz: approach,
      groundAltM,
      altAboveGroundM: FLIGHT.arrivalAltAboveGroundM,
      tiltDeg: FLIGHT.arrivalTiltDeg,
      wgs84A: WGS84_A,
      wgs84B: WGS84_B,
    });
  };

  // /m 2D-map arrival (UPLIFT U1): near-nadir, approaching from the south so the landing is
  // north-up (heading 0 ⇒ approach = −north). arrivalPose clamps tilt to ≥5°; the 2D locks
  // glide the last few degrees to exact nadir after the flight settles.
  const mapArrivalPose = (
    lookAt: THREE.Vector3,
    groundAltM: number,
    altAboveGroundM: number = MOBILE2D.exitAltAboveGroundM,
  ): FlightTarget => {
    const upT = lookAt.clone().normalize();
    const east = new THREE.Vector3(-lookAt.y, lookAt.x, 0);
    if (east.lengthSq() < 1e-6) east.set(0, 1, 0); // pole fallback (never on /m in practice)
    east.normalize();
    const approach = new THREE.Vector3().crossVectors(upT, east).negate().normalize(); // −north
    return arrivalPose({
      lookAt: lookAt.clone(),
      approachHoriz: approach,
      groundAltM,
      altAboveGroundM,
      tiltDeg: 0,
      wgs84A: WGS84_A,
      wgs84B: WGS84_B,
    });
  };

  // --- Arrival re-framing (bug fix 2026-07-11): a photo selected from HIGH altitude / oblique
  //     tilt lands its onPlaced flight on terrain the tiles have not loaded yet (terrainH≈0), so
  //     the committed lookAt sits below the real ground; as tiles refine, frustum.resnap() lifts
  //     the frustum but the flight target stayed low → the photo lands SHIFTED (grows with the
  //     selection altitude/tilt; nil at city scale where terrain is already loaded). While framing
  //     a fresh selection we resnap every frame and, once the frustum SETTLES, re-fly a short glide
  //     onto the LIVE arrival pose — the live-terrain correctness FPV/focus-lock already have. Any
  //     user action (grab, glide, encoder, photo-param edit, FPV, deselect) disarms it (below). --
  let framingActive = false;
  let framingParams: AdjustableParams | null = null; // params identity at arming (photo-edit gate)
  let framingReframes = 0;
  let framingStableFrames = 0;
  let framingDeadlineMs = 0;
  const framingLookAt = new THREE.Vector3(); // committed arrival plane-centre
  const _reframeLook = new THREE.Vector3(); // live plane-centre this frame (scratch)
  const _reframePrevLook = new THREE.Vector3(); // …last frame (settle detection)
  const _reframeFwd = new THREE.Vector3();
  const beginFraming = (pose: FlightTarget): void => {
    framingActive = true;
    framingReframes = 0;
    framingStableFrames = 0;
    framingDeadlineMs = performance.now() + FLIGHT.reframeDeadlineMs;
    framingParams = useUploadStore.getState().params;
    framingLookAt.copy(pose.lookAt);
    _reframePrevLook.copy(pose.lookAt);
  };

  const frustum = attachPhotoFrustum(scene, {
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
    onPlaced(geom) {
      const pose = frameArrivalPose(geom);
      flight.start(pose, { floorM: flightFloorM(pose.position) });
      beginFraming(pose); // track the pin's terrain and re-frame once it settles
    },
  });

  // --- Public pins (Phase 5): accent markers fed by store/pins (viewport-queried Wix Data);
  //     clicking one re-opens it as the placed CAMERA VIEW (upload-store openSavedPin → the
  //     frustum rebuilds + PhotoDetailPanel shows + the onPlaced flight frames the photo).
  //     The orchestrator mirrors its view focus into the store at the same low cadence as
  //     the camera mirrors — the store THROTTLES the actual query (§Traps: throttle, not debounce). -------------------------
  const pins = attachPins(scene, {
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
  });
  pins.setPins(usePinsStore.getState().pins);
  pins.setHighlight(usePinsStore.getState().highlightId);
  let _prevPinsList = usePinsStore.getState().pins;
  const unsubPins = usePinsStore.subscribe((s) => {
    if (s.pins !== _prevPinsList) {
      _prevPinsList = s.pins;
      pins.setPins(s.pins);
    }
    pins.setHighlight(s.highlightId); // no-ops while unchanged
  });
  const _pinRay = new THREE.Raycaster();
  const _hoverAnchor = new THREE.Vector3();

  // --- MY PLACES markers (owner 2026-08-19b): the member's saved views on the GL globe —
  //     the 2D map-window layer's scene twin (dot per place, lavender). store/places feeds
  //     it; the fetch is idle-kicked HERE so the main view shows dots without the map window
  //     ever opening (the store itself only loads on map-window open). The PLC / LAYERS
  //     "MY PLACES" chips gate via `onMap`; anonymous resolves to an empty list (401-final).
  const placeMarkers = attachPlaceMarkers(scene, {
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
  });
  placeMarkers.setPlaces(usePlacesMapStore.getState().places);
  const unsubPlaces = usePlacesMapStore.subscribe((s) => placeMarkers.setPlaces(s.places));
  const placesFetchTimer = window.setTimeout(() => {
    if (usePlacesMapStore.getState().onMap) usePlacesMapStore.getState().ensureLoaded();
  }, PLACEMARKS.fetchIdleMs);

  // --- USER MODELS (MESH SUITE MS5, D3 placement 2026-09-02): the world's uploaded GLBs.
  //     store/userModels holds the cover-driven world read (mirrored from the same focus the
  //     pins query rides) and MINE; the scene module owns residency/seating/the rig. The store
  //     is PUSHED down (the scene fence) — the module never reads it. MINE resolves once the
  //     member session is known — since MS6 it is the YOURS / SHARED badge, no longer the
  //     arming gate (any signed-in member arms any model; the PATCH is open, LWW).
  const userModels = attachUserModels(scene, {
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
  });
  userModels.setModels(useUserModelsStore.getState().world);
  let _prevWorldModels = useUserModelsStore.getState().world;
  const unsubUserModels = useUserModelsStore.subscribe((s) => {
    if (s.world !== _prevWorldModels) {
      _prevWorldModels = s.world;
      userModels.setModels(s.world);
    }
  });
  let _prevMemberPhaseModels = useMemberStore.getState().phase;
  const unsubMemberModels = useMemberStore.subscribe((s) => {
    if (s.phase === _prevMemberPhaseModels) return;
    _prevMemberPhaseModels = s.phase;
    if (s.phase === "member") void useUserModelsStore.getState().loadMine();
  });
  if (_prevMemberPhaseModels === "member") void useUserModelsStore.getState().loadMine();
  /** MS5: a click-to-place is armed for a stored model OR a GPS-less photo — one crosshair. */
  const placingNow = (): boolean =>
    useUploadStore.getState().phase === "placing" || useUserModelsStore.getState().placing !== null;

  // --- Explore ambient pin journey (Phase 5.5 S4, §Item 11): armed by the nav toggle via
  //     camera.exploreActive; the controller owns the camera while cruising (drift + glides
  //     stand down) and ANY direct interaction exits — it never fights the user. ------------
  const explore = createExplore({
    camera,
    flight,
    reduceMotion,
    getPins: () => usePinsStore.getState().pins,
    getFocus: () => {
      const s = useCameraStore.getState();
      return { latDeg: s.focusLatDeg, lonDeg: s.focusLonDeg };
    },
  });

  // --- Temporary virtual pin (Phase 5.5 S2 follow-up): double-click the ground drops an accent
  //     marker; it becomes the rotate/zoom pivot (focus lock) and FPV can be entered on it just
  //     to look around. Single click elsewhere / Escape clears it. -----------------------------
  const tempPinMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tokens.accent),
    transparent: true,
    opacity: TEMPPIN.markerOpacity,
  });
  const tempPinMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), tempPinMat);
  tempPinMarker.visible = false;
  tempPinMarker.raycast = () => {};
  scene.add(tempPinMarker);
  // Sticky per-location ground height (m above ellipsoid) — heightAt returns null while tiles
  // load and NEGATIVE garbage on coarse tiles (clamp [0, 9000], the S2 discipline).
  let tempPinGroundM = 0;
  let tempPinKey = "";
  // U2/A4: the APPLIED ground is EASED toward the raw sticky sample (seatStep: the first real
  // sample snaps — the marker must land, not float up; refinements slide at TEMPPIN.groundEaseK).
  // Raw was consumed directly before, so a terrain-LOD refine under a temp-FPV eye teleported the
  // camera by the LOD delta in ONE frame (the point-6 jump). Frame-stamped: tempPinPoint() runs
  // several times per frame (transitions, pose, focus, marker) — the ease advances once.
  let tempPinAppliedM: number | null = null;
  let tempPinSampled = false;
  let tempPinEaseStamp = -1;
  const _tempPinEcef = new THREE.Vector3();
  /** Refresh + return the temp pin's ECEF anchor point (on the rendered ground), or null. */
  const tempPinPoint = (): THREE.Vector3 | null => {
    const pin = useCameraStore.getState().tempPin;
    if (!pin) return null;
    const key = `${pin.latDeg},${pin.lonDeg}`;
    if (key !== tempPinKey) {
      tempPinKey = key;
      tempPinGroundM = 0;
      tempPinAppliedM = null;
      tempPinSampled = false;
    }
    const th = ground.heightAt(pin.latDeg, pin.lonDeg);
    if (th != null) {
      tempPinGroundM = clampGroundM(th);
      tempPinSampled = true;
    }
    if (tempPinSampled && tempPinEaseStamp !== now) {
      tempPinEaseStamp = now;
      tempPinAppliedM = seatStep(tempPinAppliedM, tempPinGroundM, TEMPPIN.groundEaseK);
    }
    return _tempPinEcef.fromArray(
      geodeticToEcef(pin.latDeg, pin.lonDeg, tempPinAppliedM ?? tempPinGroundM),
    );
  };

  // U2 instrumentation (DEV): single-frame FPV eye jumps, ring-buffered with cause context so the
  // scripted soak (and a human) can pin WHICH mechanism moved the camera. 0.5 m in one frame is
  // safely above legit motion (sprint walk ≈ 0.1–0.2 m/frame at 60 Hz — dtMs recorded so a slow
  // frame can be discounted). Entry/exit flights are excluded (they legitimately traverse).
  const _u2PrevEye = new THREE.Vector3();
  let u2PrevEyeValid = false;
  let u2JumpsTotal = 0; // monotonic — the ring below caps at 50, so deltas need this
  const u2Jumps: Array<{
    atMs: number;
    dM: number;
    dtMs: number;
    kind: "photo" | "temp" | null;
    /** True when walk input (stick/keys/space-lift) was live — sprint legitimately exceeds the
     *  0.5 m/frame threshold, so only walk:false records count as teleports. */
    walk: boolean;
    groundRawM: number;
    groundAppliedM: number | null;
  }> = [];

  // --- Idle orbital drift — the "spacecraft in LEO" feel (seed: "slightly rotating by default").
  //     Rotates the camera around Earth's axis at ISS-like angular speed; pauses the moment the
  //     user touches the scene and resumes after DRIFT.resumeMs. Skipped for reduced motion. ----
  let lastInteract = -Infinity;
  const noteInteract = () => {
    lastInteract = performance.now();
    // U2/A8: while FPV is live the user CANNOT take over the orbit camera (controls disabled) —
    // their pointer/wheel is the FPV look/FOV, which must NOT cancel the FPV ENTRY flight
    // (cancelling it mid-air let stepFpvPose snap straight to the eye — a teleport, browser-real)
    // nor clear targets/explore that FPV entry already handled. The idle-drift guard above is
    // all FPV needs from this listener. The EXIT fly-out runs with fpvActive already false, so
    // grabbing the globe there still cancels — the user takes over, as designed.
    if (fpvActive) return;
    flight.cancel(); // grabbing the globe aborts a flight — the user takes over
    framingActive = false; // …and abandons the arrival re-framing (direct control wins)
    const camS = useCameraStore.getState();
    if (camS.exploreActive) camS.setExplore(false); // …and exits the ambient journey
    camS.clearAllTargets(); // …and over any slider glide (tilt/heading/zoom)
  };
  const dom = renderer.domElement;
  dom.addEventListener("pointerdown", noteInteract);
  dom.addEventListener("wheel", noteInteract, { passive: true });
  dom.addEventListener("touchstart", noteInteract, { passive: true });
  const _driftAxis = new THREE.Vector3(0, 0, 1); // ECEF +Z = Earth's rotation axis
  const _driftQ = new THREE.Quaternion();

  // Terrain-first ground picking (S2 follow-up fix): the old ellipsoid-only ray landed points
  // 100–200 m PAST the visible ground (the rendered terrain sits ABOVE the ellipsoid), so pins
  // drifted outward from the screen centre — worse with tilt. Raycast the rendered terrain
  // tiles first; the bare ellipsoid is only the past-the-limb / tiles-not-loaded fallback.
  const _pickRay = new THREE.Raycaster();
  const _pickNdc = new THREE.Vector2();
  const pickGround = (ndcX: number, ndcY: number): readonly [number, number, number] | null => {
    _pickRay.setFromCamera(_pickNdc.set(ndcX, ndcY), camera);
    // RC6: the FINEST tile wins, not the nearest hit — see lib/globe/terrainPick. A pin dropped
    // while a coarse parent was still crossfading out landed on the LOD error, by metres over
    // relief, and then quietly disagreed with the seat every other consumer derived later.
    const hit = chooseTerrainHit(_pickRay.intersectObject(ground.tiles.group, true));
    if (hit) return [hit.point.x, hit.point.y, hit.point.z];
    const d = _pickRay.ray.direction;
    return rayEllipsoidIntersect(
      [camera.position.x, camera.position.y, camera.position.z],
      [d.x, d.y, d.z],
    );
  };

  // --- Sky-marker click (ASTRO ENGINE phase C, owner feedback): clicking the tracked target's
  //     hairline ring aims the camera at it (FPV: look glide · orbit: heading + tilt raise —
  //     the shared store/skyAim idiom) and fronts the TARGET panel. The billboard mesh keeps
  //     raycast disabled (it is far bigger than the visible mark and would steal ground
  //     clicks), so the test is ANGULAR: click-ray vs the tracked direction against the LIVE
  //     ring radius (it widens for extended objects). --------------------------------------
  const trySkyMarkerClick = (ndcX: number, ndcY: number): boolean => {
    const skyNow = useSkyStore.getState();
    if (!skyNow.visible || !skyTarget.mesh.visible) return false;
    _pickRay.setFromCamera(_pickNdc.set(ndcX, ndcY), camera);
    const cosHit = Math.cos(THREE.MathUtils.degToRad(skyTarget.hitRadiusDeg()));
    if (_pickRay.ray.direction.dot(targetDirW) < cosHit) return false;
    // Bearings at the camera's own geodetic position — the same reference the edge chips use
    // outside FPV; at any trackable target's distance it matches the anchor's to chip precision.
    const g = ecefToGeodetic([camera.position.x, camera.position.y, camera.position.z]);
    const b = enuBasis(g.latDeg, g.lonDeg);
    const { azDeg, altDeg } = dirAzAltDeg(targetDirW, b);
    aimAtSky(azDeg, altDeg);
    if (!skyNow.open) skyNow.setOpen(true);
    return true;
  };

  // Coarse-pointer (touch) sky hit pad (M3c): a fingertip covers ~3× a cursor's arc, so the
  // angular picks (bodies + FIND ghosts) widen on touch devices; desktop stays ×1.
  const hitPadK =
    typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches
      ? ORCH.touchHitPadK
      : 1;

  // --- FIND v2 ghost click (owner rework 2026-08-14): tapping a projected standing JUMPS scene
  //     time onto that day's instant and tracks the body. The camera deliberately does NOT move —
  //     the frame is the query, so the real body arrives exactly where its ghost stood. ------
  const tryFindGhostClick = (ndcX: number, ndcY: number): boolean => {
    _pickRay.setFromCamera(_pickNdc.set(ndcX, ndcY), camera);
    const hit = findGhosts.pick(_pickRay.ray.direction, hitPadK);
    if (!hit) return false;
    useTimeStore.getState().setTime(hit.utcMs);
    const skyNow = useSkyStore.getState();
    // "target" ghosts belong to the CURRENT tracked target (item 10) — nothing to swap.
    if (hit.body !== "target") skyNow.setTarget(bodyTarget(hit.body));
    if (!skyNow.visible) skyNow.setVisible(true);
    return true;
  };

  // --- BEST SPOT shortlist markers on the canvas (owner batch 2026-08-26, item 3) ---------------
  //
  //     "on click - jump into it with FPV view WITHOUT making it current spot (so again we do not
  //     recalculate full heatmap)". That sentence is the whole design, and the hard half is the
  //     second clause, because owner ruling R2 makes FPV a CENTRE SOURCE: `aimAnchorFor` puts the
  //     walked eye at rung 1, so simply standing at a shortlisted cell re-keys the feed's T0, bumps
  //     `sourcesEpoch`, and re-solves the very disc the user was reading — and then keeps
  //     re-solving on every step of the walk, because `camGeo` mirrors past a 0.11 m deadband.
  //
  //     THE PREVIEW IS THEREFORE A CENTRE LOCK, not a second FPV anchor. Three facts make that the
  //     cheap repair rather than an engine fork:
  //      · the disc's centre is read in exactly ONE place (`stepBestSpotFeed`), so freezing it is
  //        one expression rather than a carve-out in the shared aim ladder — which `MapWindow`, the
  //        radar fan and the focal cone all read too, and which `aimAnchor.test.ts` pins;
  //      · the frozen value is the centre the engine ACTUALLY SOLVED (`store.centreLatDeg`), which
  //        is echoed from the request verbatim — so `t0` is byte-identical across the preview and
  //        the feed posts nothing at all;
  //      · the temp pin is restored on exit, so the unlock lands on the same centre it locked.
  //     R2 is not amended: inside the preview the sheet still renders nothing, and the disc is
  //     still about the place it was always about. The panel says so on its own line.
  let bsPreviewKey: string | null = null;
  /** The temp pin the preview borrowed — restored VERBATIM (including `null`) when it ends. */
  let bsPreviewRestorePin: { latDeg: number; lonDeg: number } | null = null;
  /** The disc centre held frozen for the preview's duration; null = not previewing. */
  let bsPreviewCentre: { latDeg: number; lonDeg: number } | null = null;
  /**
   * Have we yet SEEN the FPV latch this preview asked for? The exit test is "the FPV it rode has
   * ended", and without this latch it would fire on the frame between the request and its
   * consumption — `requestFpvJump` only posts, `setTempFpv(true)` happens inside
   * `stepFpvTransitions`, and a pointerup lands between two frames.
   */
  let bsPreviewSeenFpv = false;
  /**
   * …and how long we have been waiting for it. A preview that never arms would hold the centre lock
   * FOREVER, and a permanently frozen disc centre is a far worse failure than a preview that gives
   * up: it would look like the heatmap had simply stopped following the pin. In practice the jump
   * is consumed on the very next frame, so this rail never fires.
   */
  let bsPreviewArmFrames = 0;
  /** Did the LAST marker-hover tick leave the canvas cursor as a pointer? Only then may this step
   *  hand it back — `dom.style.cursor` is shared with the sky and pin hovers. */
  let bsMarkerCursor = false;

  const endBestSpotPreview = (): void => {
    if (bsPreviewKey === null) return;
    bsPreviewKey = null;
    bsPreviewCentre = null;
    bsPreviewSeenFpv = false;
    bsPreviewArmFrames = 0;
    const camS = useCameraStore.getState();
    if (camS.tempFpv) camS.setTempFpv(false);
    // VERBATIM, `null` included: `setTempPin(null)` is also what clears `tempFpv`/`tempPinScreen`,
    // so restoring "there was no pin" is a real restore and not a no-op.
    camS.setTempPin(bsPreviewRestorePin);
    bsPreviewRestorePin = null;
    useBestSpotStore.getState()._syncBestSpot({ previewKey: null });
  };

  /** Stand at a shortlisted cell in FPV without moving the disc. `null`, or the key already being
   *  previewed, LEAVES the preview — so one entry point serves the marker, the panel and Escape. */
  const startBestSpotPreview = (key: string | null): void => {
    if (key === null || key === bsPreviewKey) {
      endBestSpotPreview();
      return;
    }
    const bs = useBestSpotStore.getState();
    const spot = bs.topK.find((t) => t.key === key);
    if (!spot) return;
    const camS = useCameraStore.getState();
    // Only the FIRST hop captures the restore state — hopping #4 → #6 inside one preview must not
    // overwrite the pin we still owe the user.
    if (bsPreviewKey === null) {
      bsPreviewRestorePin = camS.tempPin;
      bsPreviewCentre =
        bs.centreLatDeg !== null && bs.centreLonDeg !== null
          ? { latDeg: bs.centreLatDeg, lonDeg: bs.centreLonDeg }
          : camS.tempPin;
    }
    bsPreviewKey = key;
    bsPreviewSeenFpv = false;
    bsPreviewArmFrames = 0;
    bs._syncBestSpot({ previewKey: key });
    camS.requestFpvJump({
      latDeg: spot.latDeg,
      lonDeg: spot.lonDeg,
      // The EYE THE SOLVER SCORED FROM, not a pedestrian constant: `sheetAltM` is `eyeM + liftM`,
      // and standing at a different height than the one the score is a statement about would make
      // the preview disagree with the row that offered it.
      eyeM: bs.sheetAltM,
      // …facing the EVENT. This is the answer to "why this one" made physical: the contact azimuth
      // is where the sun/moon actually touches the horizon for this disc.
      headingDeg: bestSpotFeed.contactAzDeg(),
      pitchDeg: 0,
      fovDeg: camera.fov,
    });
  };
  // The panel's own LEAVE PREVIEW / row PREVIEW actions come through the store seam, the
  // `refineSpot` grammar — except that this one's owner is the orchestrator, because a preview is
  // a CAMERA move and the feed owns no camera.
  useBestSpotStore.getState()._syncBestSpot({ previewSpot: startBestSpotPreview });

  const tryBestSpotMarkerClick = (ndcX: number, ndcY: number): boolean => {
    const bs = useBestSpotStore.getState();
    if (!bestSpotAllowed || !bs.open || !bs.heatmapOn) return false;
    const hit = bestSpotSheet.pickMarker(ndcX, ndcY);
    if (!hit) return false;
    // Selection and travel stay separate everywhere (item 1): the click SELECTS the row — which is
    // what lights the marker and reveals its GO / REFINE actions in the panel — and the preview is
    // a look, not a move. Neither touches the disc.
    bs.setSelectedKey(hit.key);
    startBestSpotPreview(hit.key);
    return true;
  };

  // --- Right-click a sky body (QoL-2 ask 7, owner 2026-08-14): the same ANGULAR test as the
  //     marker click, extended to the sun and the moon (their meshes keep raycast disabled).
  //     A hit suppresses the browser menu and mirrors {kind, screen px, az/alt} into
  //     camera.skyMenu for the SkyContextMenu island; a ground right-click keeps the native
  //     browser menu. Any canvas pointerdown clears the mirror (natural dismiss). -----------
  const _menuMoonDir = new THREE.Vector3();
  const dirToAzAltAtCamera = (dir: THREE.Vector3): { azDeg: number; altDeg: number } => {
    const g = ecefToGeodetic([camera.position.x, camera.position.y, camera.position.z]);
    return dirAzAltDeg(dir, enuBasis(g.latDeg, g.lonDeg));
  };
  // Shared angular body pick (qol3: the contextmenu test, extracted so the hover affordance
  // runs the IDENTICAL candidate set — what highlights is exactly what right-click hits).
  const pickSkyBody = (
    ndcX: number,
    ndcY: number,
  ): { kind: "sun" | "moon" | "target"; dir: THREE.Vector3 } | null => {
    _pickRay.setFromCamera(_pickNdc.set(ndcX, ndcY), camera);
    const rayDir = _pickRay.ray.direction;
    const skyNow = useSkyStore.getState();
    const candidates: Array<{
      kind: "sun" | "moon" | "target";
      dir: THREE.Vector3;
      radiusDeg: number;
    }> = [
      {
        kind: "sun",
        dir: sunDirW,
        radiusDeg: Math.max(THREE.MathUtils.radToDeg(sunAngRad) * 2, ORCH.skyMenuMinHitDeg) * hitPadK,
      },
      {
        kind: "moon",
        dir: _menuMoonDir.copy(moonPosW).sub(camera.position).normalize(),
        radiusDeg:
          Math.max(
            THREE.MathUtils.radToDeg(
              angularRadiusRad(MOON_RADIUS_KM * 1000, moonPosW.distanceTo(camera.position)),
            ) * 2,
            ORCH.skyMenuMinHitDeg,
          ) * hitPadK,
      },
    ];
    if (skyNow.visible && skyTarget.mesh.visible)
      candidates.push({ kind: "target", dir: targetDirW, radiusDeg: skyTarget.hitRadiusDeg() * hitPadK });
    let best: (typeof candidates)[number] | null = null;
    let bestDot = -1;
    for (const c of candidates) {
      const dot = rayDir.dot(c.dir);
      if (dot >= Math.cos(THREE.MathUtils.degToRad(c.radiusDeg)) && dot > bestDot) {
        best = c;
        bestDot = dot;
      }
    }
    return best;
  };
  /** MS5b (§11.3, the belt to the `e.button` braces): opening an edit menu CONSUMES a live FPV
   *  press — the glass long-press rule (`longPressFired`) applied to a `contextmenu` that arrives
   *  while a primary-button press is still down (a macOS Ctrl+click in a browser that reports it
   *  as button 0). The release then ends nothing: no tap-away, no disarm. A right press never
   *  claims the pointer (onFpvPointerDown), so for the mouse's own right button this is a no-op. */
  const menuConsumesPress = () => {
    if (fpvDragId !== null) longPressFired = true;
  };
  const onSkyContextMenu = (e: MouseEvent) => {
    const rect = dom.getBoundingClientRect();
    const [ndcX, ndcY] = clientToNdc(e.clientX, e.clientY, rect);
    const best = pickSkyBody(ndcX, ndcY);
    if (!best) {
      // MESH SUITE MS2: right-click a building in FPV → arm it (another building re-targets) and
      // open the edit menu (MOVE / ROTATE / SCALE / EXTRUDE / revert / done); a right-click
      // elsewhere with nothing armed keeps the native browser menu.
      if (fpvActive) {
        // MS5: a user model under the cursor comes first (it stands in front of the building it
        // is placed beside); an un-armable one (a visitor's click) keeps the native menu.
        const mp = pickModelAt(e.clientX, e.clientY);
        if (mp) {
          if (armModel(mp) && modelGizmoDragId === null) {
            e.preventDefault();
            openModelMenu(e.clientX, e.clientY);
            menuConsumesPress();
          }
          return;
        }
        if (modelArmed && modelGizmoDragId === null) {
          e.preventDefault();
          openModelMenu(e.clientX, e.clientY);
          menuConsumesPress();
          return;
        }
      }
      if (fpvActive && enriched) {
        const pick = pickBuildingAt(e.clientX, e.clientY);
        if (pick && !isArmedPick(pick)) {
          disarmBuilding();
          armPick(pick);
        }
        if (bldgArmed && bldgGizmoDragId === null) {
          e.preventDefault();
          openBldgMenu(e.clientX, e.clientY);
          menuConsumesPress();
        }
      }
      return;
    }
    const { azDeg, altDeg } = dirToAzAltAtCamera(best.dir);
    if (altDeg < ORCH.skyMenuMinAltDeg) return; // below the horizon — that click was terrain
    e.preventDefault();
    useCameraStore
      .getState()
      .setSkyMenu({ kind: best.kind, screenX: e.clientX, screenY: e.clientY, azDeg, altDeg });
  };

  // --- Click-to-place (the missing-GPS path): while the store is in "placing", a CLICK (not a
  //     drag) casts the pointer ray at the ground and drops the photo there. A live accent
  //     marker hugs the rendered ground under the pointer (Phase 5.5 S3) so the drop point is
  //     visible BEFORE the click — the crosshair alone hid exactly the pixel that mattered. --
  const placingMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tokens.accent),
    transparent: true,
    opacity: PLACING.markerOpacity,
    depthWrite: false,
  });
  const placingMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), placingMat);
  placingMarker.visible = false;
  placingMarker.raycast = () => {};
  scene.add(placingMarker);
  let hoverX = Number.NaN; // last pointer position over the canvas (client px)
  let hoverY = Number.NaN;
  // Tap-reveal latch (M3c): a TOUCH tap that hits nothing interactive parks a synthetic hover
  // here for ORCH.tapRevealMs — stepSkyHover runs its whole affordance cascade (body glow,
  // FIND-ghost pulse + row highlight, night star names) off it. Touch never produces a resting
  // pointer, so without the latch NO hover affordance can ever fire on glass. Any new canvas
  // press clears it (notePointerDown).
  let tapRevealX = Number.NaN;
  let tapRevealY = Number.NaN;
  let tapRevealUntil = 0;
  const noteHover = (e: PointerEvent) => {
    hoverX = e.clientX;
    hoverY = e.clientY;
  };
  const noteLeave = () => {
    hoverX = Number.NaN; // pointer off the canvas — placing marker + pin hover stand down
    hoverY = Number.NaN;
  };
  let downX = 0;
  let downY = 0;
  let anyPointerDown = false; // sky-body hover stands down while a button/finger is held (drags)
  const notePointerDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
    anyPointerDown = true;
    tapRevealUntil = 0; // a new press ends any parked tap-reveal
    // Any canvas press dismisses the sky context menu (a right press re-opens it on a hit).
    const camMenu = useCameraStore.getState();
    if (camMenu.skyMenu) camMenu.setSkyMenu(null);
  };
  const notePointerFree = () => {
    anyPointerDown = false;
  };
  // Long-press pin drop (MOBILE_PLAN §4.3, M1): state lives up here because onPointerUp must
  // know a fired press already consumed the gesture — the pin lands BEFORE the finger lifts,
  // and the release would otherwise read as an empty-map click and clear it straight back.
  let longPressTimer: number | null = null;
  let longPressFired = false;
  const cancelLongPress = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    cancelLongPress();
    if (longPressFired) {
      // The long-press consumed this gesture — not a click. In FPV the flag SURVIVES for
      // onFpvPointerEnd (bound after this handler) — it owns the FPV tap path's suppression.
      if (!fpvActive) longPressFired = false;
      return;
    }
    // MS5b (§11.3, the orbit twin): a right-button release is never a CLICK — the placing drop,
    // the pin pick and the empty-map clear are left-button gestures; `contextmenu` owns the right.
    if (e.button === 2) return;
    if (fpvActive) return; // FPV owns the pointer (look-around) — no placing, no pin-picking
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > ORCH.clickDragPx) return; // a drag, not a click
    const rect = dom.getBoundingClientRect();
    const [ndcX, ndcY] = clientToNdc(e.clientX, e.clientY, rect);
    if (useUserModelsStore.getState().placing) {
      // MS5: a stored model is being placed — cast at the rendered ground, PATCH its placement.
      const hit = pickGround(ndcX, ndcY);
      if (!hit) return; // clicked past the limb — stay in placing mode
      const g = ecefToGeodetic(hit);
      void useUserModelsStore.getState().setPlacement(g.latDeg, g.lonDeg);
      return;
    }
    if (useUploadStore.getState().phase === "placing") {
      // Placing wins the click: cast at the rendered ground and drop the photo there.
      const hit = pickGround(ndcX, ndcY);
      if (!hit) return; // clicked past the limb — stay in placing mode
      const g = ecefToGeodetic(hit);
      useUploadStore.getState().setPlacement(g.latDeg, g.lonDeg);
      return;
    }
    // Sky-marker click (phase C) beats pin picking — it only ever fires inside the marker's
    // own ring, which lives in the sky, so ground targets stay reachable.
    if (trySkyMarkerClick(ndcX, ndcY)) return;
    // FIND ghost projections next (also sky-only — a faded ghost is click-transparent).
    if (tryFindGhostClick(ndcX, ndcY)) return;
    // BEST SPOT shortlist markers (owner batch 2026-08-26, item 3). It has to sit ABOVE both the
    // pin pick and the empty-map clear: the marker stands on the ground, and the clear below would
    // otherwise eat the click and drop the temp pin the disc is centred on.
    if (tryBestSpotMarkerClick(ndcX, ndcY)) return;
    // Tap-reveal (M3c): a TOUCH tap on the open sky parks the synthetic hover — the ghost
    // pick above just seated _pickRay for this exact tap, so the skyward test is free.
    if (
      e.pointerType === "touch" &&
      dirToAzAltAtCamera(_pickRay.ray.direction).altDeg >= ORCH.skyMenuMinAltDeg
    ) {
      tapRevealX = e.clientX;
      tapRevealY = e.clientY;
      tapRevealUntil = performance.now() + ORCH.tapRevealMs;
    }
    // MESH SUITE MS6: a click on a USER MODEL in orbit stands beside it in first-person view
    // (the pins' "a click opens it" idiom; a model stands in front of the pins and the ground).
    {
      const mp = pickModelAt(e.clientX, e.clientY);
      if (mp && standBesideModel(mp.id)) return;
    }
    // Otherwise: a click on a public pin opens it as the placed camera view (Phase 5.1) —
    // the store transition triggers the frustum rebuild, the detail panel, and the flight.
    // A COLLAPSED cluster marker (adaptive de-cluster, far range) dives to differentiation
    // range instead — its members can't be told apart from up here.
    _pinRay.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const pin = pins.pick(_pinRay);
    if (pin) {
      const cs = pins.clusterState(pin.id);
      if (cs && cs.count > 1 && cs.collapsed) {
        useCameraStore.getState().requestFly({
          latDeg: pin.lat,
          lonDeg: pin.lon,
          altM: PINS.clusterDiveAltM,
        });
        return;
      }
      useCameraStore.getState().setTempPin(null); // a real pin supersedes the temp one
      useUploadStore.getState().openSavedPin({ ...pin, pinId: pin.id });
      return;
    }
    // Empty-map click (owner follow-up): clears the selected state — first the temp pin, then
    // a VIEWED saved pin (deselect). An own unsaved upload is never discarded by a stray click.
    const camS = useCameraStore.getState();
    if (camS.tempPin) {
      camS.setTempPin(null);
      return;
    }
    const up = useUploadStore.getState();
    if (up.phase === "placed" && up.viewingPinId) up.clear();
  };
  dom.addEventListener("pointerdown", notePointerDown);
  dom.addEventListener("pointerup", onPointerUp);
  dom.addEventListener("pointerup", notePointerFree);
  dom.addEventListener("pointercancel", notePointerFree);
  dom.addEventListener("pointermove", noteHover);
  dom.addEventListener("pointerleave", noteLeave);
  // Crosshair while the globe waits for the placement click.
  const unsubCursor = useUploadStore.subscribe((s) => {
    const placing = s.phase === "placing" || useUserModelsStore.getState().placing !== null;
    dom.style.cursor = placing ? "crosshair" : "";
    if (!placing) placingMarker.visible = false;
  });
  // MS5: the model placing drives the same crosshair + marker.
  const unsubModelCursor = useUserModelsStore.subscribe((s, prev) => {
    if ((s.placing !== null) === (prev.placing !== null)) return;
    const placing = s.placing !== null || useUploadStore.getState().phase === "placing";
    dom.style.cursor = placing ? "crosshair" : "";
    if (!placing) placingMarker.visible = false;
  });
  // (Idle drift is now dt-normalized — driftRadiansForDt(DRIFT.degPerSec, dtMs) per frame, F5.)

  // --- FPV photographer mode (Phase 5.5 S2): the camera sits EXACTLY at the frustum apex with
  //     the photo's pose. GlobeControls are disabled (and adjustHeight off — cameraRadius would
  //     push us off the apex), but controls.adjustCamera is still called every FPV frame: it owns
  //     the near/far plane fit, and GlobeControls.update() skips it entirely while disabled.
  //     Drag = look-around (grab-the-world), wheel = camera-FOV zoom, Escape / panel button exits.
  let fpvActive = false;
  /** Which anchor the FPV camera stands on: a placed photo's frustum apex, or the temp pin. */
  let fpvKind: "photo" | "temp" | null = null;
  /** Pin-marker visibility before FPV entry (owner 2026-07-15): FPV hides pins by default
   *  (declutter); exit restores this UNLESS the user flipped the PIN chip back on inside FPV
   *  (then the store already says true and the restore is a no-op). */
  let pinsVisibleBeforeFpv = true;
  let fpvYaw = 0; // look-around offsets (rad) on top of the anchor's own pose
  let fpvPitch = 0;
  let fpvDragId: number | null = null;
  // Temp-FPV pin identity (owner QA 2026-08-21 item 1): the per-frame re-pose compares this
  // to detect a PLACE POINT under a live session — a pin change re-seats the ENU basis at
  // the new pin and zeroes the walk offset (the stale-basis/stale-offset detach root cause).
  let fpvPinKey: string | null = null;
  let fpvLastX = 0;
  let fpvLastY = 0;
  let fpvDownX = 0; // pointer-down position — separates a marker CLICK from a look-drag
  let fpvDownY = 0;
  // Pinch-FOV (MOBILE_PLAN §4.2, M2): a SECOND touch beside the look finger drives the camera
  // FOV — spread = zoom in, same clamps as the wheel. While the pinch lives the look FREEZES
  // (both fingers move during a pinch; feeding them to yaw/pitch would swing the view), and the
  // lift click-check is suppressed (a pinch is never a marker click). Desktop-inert: a mouse
  // is always isPrimary, so the pinch branch needs a real second pointer to exist at all.
  let fpvPinchId: number | null = null;
  let fpvPinchX = 0; // the second finger's live position
  let fpvPinchY = 0;
  let fpvPinchStartDist = 0; // finger gap + FOV captured at pinch start — ratio drives the zoom
  let fpvPinchStartFov = 0;
  let fpvPinchedDuringDrag = false; // suppresses the sky-marker click on the look finger's lift
  let fovTargetDeg: number = camera.fov; // eased every frame (FPV zoom + entry/exit restore)
  // Temp-pin FPV basis, captured at ENTRY (fwd = the camera's azimuth at that moment — deriving
  // it per frame from the camera would feed back on itself). Position refreshes per frame as
  // the terrain under the pin refines.
  const _tempFwd0 = new THREE.Vector3();
  const _tempUp0 = new THREE.Vector3();
  const _tempRight0 = new THREE.Vector3();
  // Temp-FPV eye height above the pin's ground (m): the ALTITUDE encoder elevates the viewpoint
  // STRICTLY vertically in this mode (owner follow-up). Reset to eye height on entry.
  let fpvEyeM: number = FRUSTUM.eyeHeightM;
  // Photo-FPV vertical LIFT off the frustum apex (m, S6): the ALTITUDE encoder's photo identity.
  // 0 = the photographer's exact eye (the entry state, and what the photo alignment means).
  let fpvLiftM = 0;
  // FPV WALK (owner): a WORLD-SPACE displacement off the anchor (ECEF, m), integrated from held
  // arrow keys along the horizontal look of the frame each step is taken — you walk where you
  // look (◀▶ strafe). A fixed vector, NOT fwd/right scalars re-projected on the live look basis:
  // the scalar form re-aimed the ACCUMULATED displacement on every head-turn, orbiting the eye
  // around the anchor at walk radius (the pivot-ellipse bug, owner 2026-08-11). Reset on FPV entry.
  const fpvWalkOffset = new THREE.Vector3();
  // RC10 (audit gap #8) — the WALK re-seat. A temp FPV eye is built as
  // `pinGround + up·eyeM + walkOffset`, and `walkOffset` is a fixed WORLD displacement — so the
  // eye keeps the height of the ground under the PIN no matter how far you walk. Cross a balka
  // and you are underground; climb out and you are floating, and `fpvEyeAboveGroundM` reports
  // the nominal eye height either way, so nothing on screen says so. These three carry the
  // correction: the sticky last-good ground at the WALKED point, the eased delta actually
  // applied (`seatStep`, so a terrain-LOD refine slides instead of teleporting the eye — U2's
  // discipline), and the point the last sample was taken at so the resample runs on distance,
  // not on a timer.
  let fpvWalkGroundM: number | null = null;
  let fpvWalkAppliedM: number | null = null;
  const _fpvWalkSampledAt = new THREE.Vector3();
  let fpvWalkSampleValid = false;
  const fpvKeysDown = { up: false, down: false, left: false, right: false, shift: false, alt: false, space: false };
  // SPACE hold time (ms, accumulated from frame dt — clock-epoch-free): the ascend rate ramps
  // quadratically over FPV.spaceRampS (QoL-1, owner 2026-08-14). Lives beside fpvKeysDown, NOT
  // as a store rate, so a simultaneous canvas pointerdown's clearAllTargets can't null a held
  // key mid-flight (the M2 fpvWalkInput lesson).
  let fpvSpaceHeldMs = 0;
  // Sticky ground height under the photo-FPV anchor (m above ellipsoid) — feeds the eye-height
  // readout + the building solidity curve; heightAt-null/garbage tolerant (S2 discipline).
  let fpvAnchorGroundM = 0;
  // Live eye height above the local ground while ANY FPV is active (m).
  let fpvEyeAboveGroundM = 0;
  // ── U8 building height edit (owner 2026-08-18, UPLIFT §2/U8) ──────────────────────────────
  // dblclick (desktop) / double-tap (glass) on an enriched building in FPV ARMS it (accent
  // tint + chip + mesh-pinned label); while armed the primary pointer's drag is CLAIMED as the
  // height gesture (the pinch precedent — consumed before the look math, so the camera never
  // turns) and a semi-transparent ghost previews the new height over the SOLID original;
  // release COMMITS (the real mesh eases inside applyFeatureSeats) + persists to
  // ftw:bldg-overrides:v1. Esc (before the FPV unwind) / tap-away / FPV exit / BLD-off disarm.
  // Second fingers are IGNORED while armed — an explicit no-pinch-mid-edit rule, not emergent.
  let bldgArmed: {
    cellUri: string;
    featureId: number;
    bakedHeightM: number;
    footprintM: [number, number]; // MS5b: the pristine footprint (m) — the SCALE readouts' metres
    cx: number; // pristine checksum capture from the pick (rounded at persist time)
    cz: number;
    vc: number;
    osm: string | null; // MS3: the RC17 OSM id — the persisted row's recovery key
    committedK: number; // the scale each edit re-anchors on (the per-edit 0.1×/10× band, MS5b)
    liveK: number; // live drag value (== committedK between drags)
    distM: number; // pick distance — scales the drag gain
  } | null = null;
  let bldgDragId: number | null = null; // the claimed pointer while a height drag is live
  let bldgDragStartY = 0;
  let bldgDragStartK = 1;
  let bldgDragMoved = false;
  let bldgLastTapMs = 0; // glass double-tap detector (no synthesized dblclick on the canvas)
  let bldgLastTapX = 0;
  let bldgLastTapY = 0;
  // ── MESH SUITE MS2 — the MOVE / ROTATE / SCALE gizmo (owner 2026-09-01; MESH_SUITE_PLAN §7) ──
  // Four OPS on the armed building. EXTRUDE is the U8 drag above, verbatim, and the DEFAULT op on
  // arm (the U8 UX stays byte-identical when only height is edited — §4a-1). MOVE / ROTATE /
  // SCALE ride three's TransformControls on the engine's ghost RIG (scene/bldgGizmo.ts): the
  // controls get NO DOM listeners — the FPV handlers below FEED them pointers, so one gesture
  // table arbitrates the look-drag, the pinch, the U8 claim and the gizmo. In a spatial op an
  // off-handle drag is a normal look-around (the handles are explicit; the screen is no longer
  // the gesture), a tap still disarms, a handle drag previews on the ghost and COMMITS on release
  // through commitBldgTransform. GlobeControls is disabled throughout FPV (the only place a
  // building can be armed), so its whole-scene raycast never meets the gizmo pickers.
  let bldgOp: BldgEditOp = "extrude";
  let bldgGizmoDragId: number | null = null; // the claimed pointer while a gizmo drag is live
  let bldgLive: FeatureTransform | null = null; // the gizmo's clamped read-back mid-drag (else null)
  let bldgMenuDismiss = false; // the current press only closed the context menu (not a tap-away)
  // MS3: the edited building under a resting pointer while NOTHING is armed (the hover note).
  let bldgHover: BuildingPick | null = null;
  let bldgHoverAtMs = 0;
  const bldgHoverText = (pick: BuildingPick, origin: OverrideOriginLabel): string => {
    const word =
      origin === "shared" ? "shared" : origin === "dirty" ? "unsynced" : origin === "synced" ? "synced" : "edited";
    return `EDITED · ${word} · ${(pick.bakedHeightM * pick.current.sy).toFixed(1)} m · was ${pick.bakedHeightM.toFixed(1)} m`;
  };
  const bldgGizmo = attachBldgGizmo(scene, camera, {
    place: (t) => enriched?.setGhostTransform(t),
    onChange: (t) => {
      bldgLive = t;
    },
  });
  // --- MESH SUITE MS5: the armed USER MODEL session — the building session's twin, kept
  //     separate so the U8/MS2/MS3 code above stays byte-identical. The model's own
  //     anchor/body ARE the gizmo rig (no ghost, no recompose); a release folds the drag's ENU
  //     offset into a new placement and PATCHes the record (own models only at MS5; any member
  //     since MS6). MESH SUITE MS7 (owner 2026-09-03): the Y arrow is the LIFT — the anchor's
  //     own Y, stored as the row's `tU`, railed against the model's scaled box so a sunk
  //     model always keeps part of itself above the ground (`liftFloorFor`). MESH SUITE MS8
  //     (owner 2026-09-03): ROTATE's X / Z rings are the PITCH / ROLL — two more stored seats
  //     (`pitchDeg` / `rollDeg`, the YXZ triple with the yaw), the box tilted for the floor.
  let modelArmed: { id: string; title: string; mine: boolean } | null = null;
  let modelOp: ModelEditOp = "move";
  let modelLive: ModelEdit | null = null; // the gizmo's clamped read-back mid-drag (else null)
  let modelGizmoDragId: number | null = null;
  let modelMenuDismiss = false;
  let modelHoverId: string | null = null;
  let modelHoverAtMs = 0;
  let modelHoverCursor = false; // MS6: did the orbit model hover set the pointer cursor?
  let modelSaving = false;
  let modelSaveError: string | null = null;
  const _modelTop = new THREE.Vector3();
  const modelCommitted = (): ModelTransform =>
    (modelArmed && userModels.info(modelArmed.id)?.seats) || { ...IDENTITY_MODEL_TRANSFORM };
  /** MS7: the armed model's size `[w, d, h]` at scale 1 (the loaded bounds once resident) — the
   *  lift floor's input; null pins the lift. MS8: the whole box, so the floor follows a tilt. */
  const modelSizeM3 = (): [number, number, number] | null => (modelArmed ? userModels.info(modelArmed.id)?.sizeM3 ?? null : null);
  /** The committed seats as the gizmo's `start` transform speaks them (`sx` = the uniform scale,
   *  `tU` = the committed lift, MS8 `pitchDeg` / `rollDeg` = the committed tilt). */
  const startToModel = (start: FeatureTransform): ModelTransform => ({
    rotDeg: start.rotDeg,
    scale: start.sx,
    liftM: start.tU,
    pitchDeg: start.pitchDeg ?? 0,
    rollDeg: start.rollDeg ?? 0,
  });
  const modelGizmo = attachBldgGizmo(scene, camera, {
    place: (t) => {
      if (modelArmed) userModels.placeRig(modelArmed.id, t);
    },
    onChange: (t) => {
      if (modelArmed) modelLive = clampModelEdit(t, modelCommitted(), modelSizeM3());
    },
    // The model rails: ONE uniform scale (any handle), a wider move, and (MS7) the lift on its
    // height-aware floor under the absolute ceiling — `start` is the committed transform the
    // drag began on. MS8: the tilt rides the read-back (`tilt: true` — the X / Z rings), and the
    // floor is taken from the box TILTED by it.
    clamp: (raw, start) => editToFeatureTransform(clampModelEdit(raw, startToModel(start), modelSizeM3())),
    lift: true,
    liftRail: (start) => {
      const st = startToModel(start);
      return { minM: liftFloorFor(tiltedExtent(modelSizeM3(), st.scale, st.pitchDeg, st.rollDeg)), maxM: MODEL_LIFT_MAX_M };
    },
    tilt: true,
  });
  const modelSeatsDiffer = (a: ModelTransform, b: ModelTransform) =>
    Math.abs(a.liftM - b.liftM) >= 0.01 ||
    Math.abs(a.rotDeg - b.rotDeg) >= 0.05 ||
    Math.abs(a.pitchDeg - b.pitchDeg) >= 0.05 ||
    Math.abs(a.rollDeg - b.rollDeg) >= 0.05 ||
    Math.abs(a.scale - b.scale) >= 0.005;
  const modelLiveDiffers = (a: ModelEdit, b: ModelEdit) =>
    Math.abs(a.tE - b.tE) >= 0.01 ||
    Math.abs(a.tN - b.tN) >= 0.01 ||
    Math.abs(a.liftM - b.liftM) >= 0.01 ||
    Math.abs(a.rotDeg - b.rotDeg) >= 0.05 ||
    Math.abs(a.pitchDeg - b.pitchDeg) >= 0.05 ||
    Math.abs(a.rollDeg - b.rollDeg) >= 0.05 ||
    Math.abs(a.scale - b.scale) >= 0.005;
  const syncModelEdit = () => {
    const a = modelArmed;
    if (!a) {
      useModelEditStore.getState()._syncArmed(null);
      return;
    }
    const info = userModels.info(a.id);
    const committed = info?.seats ?? { ...IDENTITY_MODEL_TRANSFORM };
    useModelEditStore.getState()._syncArmed({
      id: a.id,
      title: a.title,
      mine: a.mine,
      lat: info?.lat ?? 0,
      lon: info?.lon ?? 0,
      sizeM: info?.sizeM ?? null,
      sizeM3: info?.sizeM3 ?? null,
      dragging: modelGizmoDragId !== null,
      overridden: !isIdentityModelTransform(committed),
      op: modelOp,
      committed,
      live: modelLive ?? restingEdit(committed),
      saving: modelSaving,
      saveError: modelSaveError,
    });
  };
  const disarmModel = () => {
    if (!modelArmed) return;
    const id = modelArmed.id;
    modelArmed = null;
    if (modelGizmoDragId !== null) {
      modelGizmoDragId = null;
      modelGizmo.cancel();
    }
    userModels.setDragging(id, false);
    modelGizmo.setTarget(null, "extrude");
    modelOp = "move";
    modelLive = null;
    userModels.setArmed(null);
    if (dom.style.cursor === "grab") dom.style.cursor = "";
    syncModelEdit();
  };
  /** The user model under a client point — null when none, or with the MDL chip off. Picks
   *  only (`armModel` arms, in FPV; in orbit a click stands beside it — MS6). */
  const pickModelAt = (clientX: number, clientY: number): UserModelPick | null => {
    if (!useCameraStore.getState().modelsVisible) return null;
    const rect = dom.getBoundingClientRect();
    const [ndcX, ndcY] = clientToNdc(clientX, clientY, rect);
    _pickRay.setFromCamera(_pickNdc.set(ndcX, ndcY), camera);
    return userModels.pick(_pickRay);
  };
  /** Arm a picked model. MS6 (the owner's D3): ANY signed-in member arms ANY model — the PATCH
   *  is open, last writer wins; `mine` (from the owner list — the public read carries no owner)
   *  is the chip's YOURS / SHARED badge. False for a visitor (the PATCH would 401 anyway) or a
   *  row the scene no longer knows. */
  const armModel = (pick: UserModelPick): boolean => {
    const info = userModels.info(pick.id);
    if (!info || useMemberStore.getState().phase !== "member") return false;
    if (modelArmed && modelArmed.id === pick.id) return true;
    disarmBuilding();
    disarmModel();
    modelArmed = { id: pick.id, title: info.title, mine: useUserModelsStore.getState().isMine(pick.id) };
    modelOp = "move";
    modelLive = null;
    modelHoverId = null;
    userModels.setArmed(pick.id);
    modelGizmo.setTarget(userModels.rig(pick.id), modelOp);
    syncModelEdit();
    return true;
  };
  const tryArmModel = (clientX: number, clientY: number): boolean => {
    const pick = pickModelAt(clientX, clientY);
    return pick ? armModel(pick) : false;
  };
  /** MS6 "stand beside it": a one-shot first-person pose a few model-heights back from the
   *  placement along the CURRENT heading (the PLACES-row jump path — FPV is where editing
   *  works). The orbit click; the MY PINS · MODELS row builds the same pose with heading 0. */
  const standBesideModel = (id: string): boolean => {
    const info = userModels.info(id);
    if (!info) return false;
    const pose = modelStandpoint(info.lat, info.lon, info.sizeM3, info.seats.scale, useCameraStore.getState().headingDeg, info.seats.liftM);
    useCameraStore.getState().requestFpvJump({
      latDeg: pose.latDeg,
      lonDeg: pose.lonDeg,
      eyeM: pose.eyeM,
      headingDeg: pose.headingDeg,
      pitchDeg: pose.pitchDeg,
      fovDeg: pose.fovDeg,
    });
    return true;
  };
  const applyModelOp = (op: ModelEditOp) => {
    if (!modelArmed || modelGizmoDragId !== null) return;
    modelOp = op;
    modelGizmo.setTarget(userModels.rig(modelArmed.id), op);
    syncModelEdit();
  };
  const persistModel = async (
    id: string,
    patch: { lat: number; lon: number; rotDeg: number; scale: number; tU: number; pitchDeg: number; rollDeg: number },
  ) => {
    modelSaving = true;
    modelSaveError = null;
    syncModelEdit();
    const row = await useUserModelsStore.getState().commitPlacement(id, patch);
    modelSaving = false;
    modelSaveError = row ? null : "SAVE FAILED";
    syncModelEdit();
  };
  /** A model gizmo drag ended: fold the ENU offset into a new placement, snap the seats, PATCH. */
  const finishModelDrag = (t: FeatureTransform | null, commit: boolean) => {
    if (!modelArmed) return;
    const a = modelArmed;
    userModels.setDragging(a.id, false);
    if (t && commit) {
      const e = clampModelEdit(t, modelCommitted(), modelSizeM3());
      const info = userModels.info(a.id);
      if (info) {
        const at = offsetGeodetic(info.lat, info.lon, e.tE, e.tN);
        userModels.rebase(a.id, at.latDeg, at.lonDeg);
        userModels.setSeats(a.id, { rotDeg: e.rotDeg, scale: e.scale, liftM: e.liftM, pitchDeg: e.pitchDeg, rollDeg: e.rollDeg }, true);
        void persistModel(a.id, {
          lat: at.latDeg,
          lon: at.lonDeg,
          rotDeg: e.rotDeg,
          scale: e.scale,
          tU: e.liftM,
          pitchDeg: e.pitchDeg,
          rollDeg: e.rollDeg,
        });
      }
    }
    modelLive = null;
    syncModelEdit();
  };
  const revertModel = (which: ModelEditOp | "all") => {
    if (!modelArmed) return;
    const a = modelArmed;
    const next = revertModelOp(modelCommitted(), which);
    userModels.setSeats(a.id, next, false);
    const info = userModels.info(a.id);
    if (info)
      void persistModel(a.id, {
        lat: info.lat,
        lon: info.lon,
        rotDeg: next.rotDeg,
        scale: next.scale,
        tU: next.liftM,
        pitchDeg: next.pitchDeg,
        rollDeg: next.rollDeg,
      });
    syncModelEdit();
  };
  const openModelMenu = (clientX: number, clientY: number) =>
    useModelEditStore.getState()._setMenu({ screenX: clientX, screenY: clientY });
  /** MS5b: the SCALE line leads with the current size in metres (`sizeM3` × the live scale). */
  const modelOpLine = (e: ModelEdit, sizeM3: readonly [number, number, number] | null): string | null => {
    const sg = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
    switch (modelOp) {
      case "move":
        return `↔ ${sg(e.tE)} E · ${sg(e.tN)} N · ↑ ${sg(e.liftM)} m`;
      case "rotate":
        // MS8: the tilt beside the yaw whenever the model is not upright.
        return isTilted(e) ? `↻ ${sg(-e.rotDeg)}° cw · pitch ${sg(e.pitchDeg)}° · roll ${sg(e.rollDeg)}°` : `↻ ${sg(-e.rotDeg)}° cw`;
      case "scale":
        return sizeM3
          ? `⤢ ${formatDims(sizeM3.map((v) => v * e.scale))} · ${e.scale.toFixed(2)}×`
          : `⤢ ${e.scale.toFixed(2)}×`;
      default:
        return null;
    }
  };
  /** The armed building's committed edit target — engine truth, or the armed capture's height
   *  when the cell has been LRU-evicted mid-edit (the row re-applies when it streams back). */
  const bldgCommitted = (a: { cellUri: string; featureId: number; committedK: number }): FeatureTransform =>
    enriched?.featureState(a.cellUri, a.featureId)?.target ?? { ...IDENTITY_TRANSFORM, sy: a.committedK };
  /** Deadband for the chip's live-transform mirror (never a 60 fps React churn). */
  const liveDiffers = (a: FeatureTransform, b: FeatureTransform) =>
    Math.abs(a.tE - b.tE) >= 0.01 ||
    Math.abs(a.tN - b.tN) >= 0.01 ||
    Math.abs(a.tU - b.tU) >= 0.01 ||
    Math.abs(a.rotDeg - b.rotDeg) >= 0.05 ||
    Math.abs(a.sx - b.sx) >= 0.005 ||
    Math.abs(a.sz - b.sz) >= 0.005 ||
    Math.abs(a.sy - b.sy) >= 0.005;
  const syncBldgEdit = () => {
    const a = bldgArmed;
    if (!a) {
      useBldgEditStore.getState()._syncArmed(null);
      return;
    }
    const committed = bldgCommitted(a);
    // MS2: the live transform is the gizmo's clamped read-back during a drag; otherwise the
    // committed target with the U8 drag's live height on top (identical to U8 for height-only).
    const live: FeatureTransform = bldgLive ?? { ...committed, sy: a.liveK };
    // MS3: where the committed edit lives (world-shared / mine pending / mine pushed / none).
    const originKey = enrichedSel.variant ? overrideKey(enrichedSel.variant, a.cellUri, a.featureId) : null;
    useBldgEditStore.getState()._syncArmed({
      origin: originKey ? originOf(bldgOverrideMap, bldgShared, originKey) : "none",
      featureId: a.featureId,
      cellUri: a.cellUri,
      originalHeightM: a.bakedHeightM,
      footprintM: a.footprintM,
      liveHeightM: a.bakedHeightM * live.sy,
      deltaM: a.bakedHeightM * (live.sy - 1),
      dragging: (bldgDragId !== null && bldgDragMoved) || bldgGizmoDragId !== null,
      // ANY component off the original (the U8 `|k−1| ≥ NEUTRAL_K_EPS` test, generalized).
      overridden: !isIdentityTransform({ ...committed, sy: a.liveK }),
      op: bldgOp,
      committed,
      live,
    });
  };
  const disarmBuilding = () => {
    if (!bldgArmed) return;
    bldgArmed = null;
    bldgDragId = null;
    bldgDragMoved = false;
    // MS2: a live gizmo drag dies with the session (nothing commits), the gizmo lets go of the
    // rig BEFORE the rig goes, and the next arm starts at EXTRUDE (the store resets its ask).
    if (bldgGizmoDragId !== null) {
      bldgGizmoDragId = null;
      bldgGizmo.cancel();
    }
    bldgGizmo.setTarget(null, "extrude");
    bldgOp = "extrude";
    bldgLive = null;
    if (dom.style.cursor === "grab") dom.style.cursor = "";
    enriched?.setArmedId(null);
    enriched?.hideGhost();
    syncBldgEdit();
  };
  /** The enriched building under a client point — null when none, or when arming is not
   *  possible here (no engine, not in FPV, BLD off). Picks only; `armPick` arms. */
  const pickBuildingAt = (clientX: number, clientY: number): BuildingPick | null => {
    if (!enriched || !fpvActive || !useCameraStore.getState().buildings3d) return null;
    const rect = dom.getBoundingClientRect();
    const [ndcX, ndcY] = clientToNdc(clientX, clientY, rect);
    _pickRay.setFromCamera(_pickNdc.set(ndcX, ndcY), camera);
    return enriched.pickBuilding(_pickRay);
  };
  const armPick = (pick: BuildingPick) => {
    disarmModel(); // MS5: the two edit sessions are exclusive
    bldgArmed = {
      cellUri: pick.cellUri,
      featureId: pick.featureId,
      bakedHeightM: pick.bakedHeightM,
      footprintM: pick.footprintM,
      cx: pick.cx,
      cz: pick.cz,
      vc: pick.vc,
      osm: pick.osm,
      committedK: pick.currentK,
      liveK: pick.currentK,
      distM: pick.distance,
    };
    bldgHover = null; // MS3: the hover note yields to the armed label
    enriched?.setArmedId(pick.featureId);
    syncBldgEdit();
  };
  const tryArmBuilding = (clientX: number, clientY: number): boolean => {
    const pick = pickBuildingAt(clientX, clientY);
    if (!pick) return false;
    armPick(pick);
    return true;
  };
  /** MS2: is this pick the armed building? (a right-click / long-press on ANOTHER re-targets.) */
  const isArmedPick = (pick: BuildingPick) =>
    !!bldgArmed && bldgArmed.cellUri === pick.cellUri && bldgArmed.featureId === pick.featureId;
  /** MESH SUITE MS1: apply + persist ONE building's FULL edit target — the path the U8 height
   *  commit, the RESET, the MS2 gizmo release and the DEV seam all take. The engine clamps to
   *  the rails first and the persisted row is read back from it, so storage never disagrees
   *  with the mesh. `fallback` = the armed pick's captured checksum facts, used when the cell
   *  has been LRU-evicted mid-edit (the armed state survives; the row re-applies on reload).
   *  The stored row is C6-clean: scales / metres of offset / degrees + the bake-local checksum —
   *  no coordinates, nothing that could leak. */
  const commitBldgTransform = (
    cellUri: string,
    featureId: number,
    t: FeatureTransform,
    fallback?: { cx: number; cz: number; vc: number; bakedHeightM: number; osm: string | null },
  ) => {
    if (!enriched || !enrichedSel.variant || !bldgIndex) return;
    enriched.setTransform(cellUri, featureId, t);
    const st = enriched.featureState(cellUri, featureId);
    const facts = st ?? fallback;
    if (!facts) return;
    const key = overrideKey(enrichedSel.variant, cellUri, featureId);
    const fields = transformFields(st?.target ?? t);
    const rowFacts = {
      cx: roundCentroidM(facts.cx),
      cz: roundCentroidM(facts.cz),
      vc: facts.vc,
      hM: Math.round(facts.bakedHeightM * 10) / 10,
      ...(facts.osm ? { o: facts.osm } : {}),
    };
    if (isNeutralRow(fields)) {
      // MS3: a RESET of a building the world knows is a pending REMOVAL — a tombstone masks the
      // shared row here and rides the next SYNC; a reset of a purely local edit just deletes.
      const known = bldgShared.has(key) || bldgOverrideMap[key]?.s !== undefined;
      if (known) tombstoneOverride(bldgOverrideMap, key, rowFacts, Date.now());
      else deleteOverride(bldgOverrideMap, key);
    } else {
      upsertOverride(bldgOverrideMap, key, { ...fields, ...rowFacts }, Date.now());
    }
    bldgIndex.invalidate();
    refreshBldgDirty();
  };
  /** Apply + persist the armed building's liveK (drag release / RESET-to-1) — the height-only
   *  edit; any spatial components it already carries ride along untouched. */
  const commitBldgHeight = () => {
    if (!bldgArmed || !enriched) return;
    const a = bldgArmed;
    a.committedK = a.liveK;
    enriched.hideGhost();
    const cur = enriched.featureState(a.cellUri, a.featureId)?.target ?? IDENTITY_TRANSFORM;
    commitBldgTransform(a.cellUri, a.featureId, { ...cur, sy: a.liveK }, a);
    syncBldgEdit();
  };
  /** MS2: switch the armed building's op. EXTRUDE = the U8 drag (no rig, no gizmo); the three
   *  spatial ops share ONE rig — created here if missing (body hidden until a drag starts) and
   *  the gizmo re-targeted onto it. Refused under a live drag (the frame service retries). */
  const applyBldgOp = (op: BldgEditOp) => {
    if (!bldgArmed || !enriched || bldgGizmoDragId !== null) return;
    bldgOp = op;
    if (op === "extrude") {
      bldgGizmo.setTarget(null, op);
      enriched.hideGhost();
      if (dom.style.cursor === "grab") dom.style.cursor = "";
    } else {
      if (!enriched.ghostRig()) enriched.showGhost(bldgArmed.cellUri, bldgArmed.featureId, false);
      bldgGizmo.setTarget(enriched.ghostRig(), op); // null while the cell is unloaded — retried per frame
    }
    syncBldgEdit();
  };
  /** MS2: a gizmo drag ended — commit the clamped result through the ONE commit path (a cancel
   *  puts the rig back where the drag began instead). The ghost body hides again; the real mesh
   *  eases to the target inside applyFeatureSeats exactly as after a U8 release. */
  const finishGizmoDrag = (t: FeatureTransform | null, commit: boolean) => {
    if (!bldgArmed || !enriched) return;
    const a = bldgArmed;
    enriched.setGhostBodyVisible(false);
    if (t && commit) {
      commitBldgTransform(a.cellUri, a.featureId, t, a);
      const sy = enriched.featureState(a.cellUri, a.featureId)?.target.sy ?? t.sy;
      a.liveK = sy;
      a.committedK = sy;
    } else if (t) {
      enriched.setGhostTransform(t);
    }
    bldgLive = null;
    syncBldgEdit();
  };
  /** MS2: revert ONE op's components (or everything — the U8 RESET) to the original through the
   *  same commit path: an identity result deletes the row and the tint clears. */
  const revertBldg = (which: BldgEditOp | "all") => {
    if (!bldgArmed || !enriched) return;
    const a = bldgArmed;
    const next = revertOp(bldgCommitted(a), which);
    if (bldgOp === "extrude") enriched.hideGhost(); // the U8 RESET path (commitBldgHeight hid it)
    commitBldgTransform(a.cellUri, a.featureId, next, a);
    const sy = enriched.featureState(a.cellUri, a.featureId)?.target.sy ?? next.sy;
    a.liveK = sy;
    a.committedK = sy;
    syncBldgEdit();
  };
  const openBldgMenu = (clientX: number, clientY: number) =>
    useBldgEditStore.getState()._setMenu({ screenX: clientX, screenY: clientY });
  /** MS2: the pinned label's op line — the live numbers of the active spatial op (the two U8
   *  height lines stay under it; EXTRUDE adds nothing, so that label is byte-identical). The
   *  yaw is shown in COMPASS sense (clockwise from above = the negative of `rotDeg`). MS5b: the
   *  SCALE line leads with the current footprint in metres (`footprintM` × the live scale). */
  const bldgOpLine = (t: FeatureTransform, footprintM: readonly [number, number]): string | null => {
    const sg = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
    switch (bldgOp) {
      case "move":
        return `↔ ${sg(t.tE)} E · ${sg(t.tN)} N · ↑ ${t.tU.toFixed(1)} m`;
      case "rotate":
        return `↻ ${sg(-t.rotDeg)}° cw`;
      case "scale":
        return `⤢ ${formatDims([footprintM[0] * t.sx, footprintM[1] * t.sz])} · ${t.sx.toFixed(2)} × ${t.sz.toFixed(2)}`;
      default:
        return null;
    }
  };
  const onFpvPointerDown = (e: PointerEvent) => {
    if (!fpvActive) return;
    // MS5b (owner bug 2026-09-02j, MESH_SUITE_PLAN §11.3): a RIGHT press never enters the gesture
    // table. It used to claim `fpvDragId` and sample the menu-dismiss flags BEFORE `contextmenu`
    // (macOS Chrome fires it on the press) opened the menu, so the tap-shaped release below read
    // as a tap-away and DISARMED — the menu vanished the moment the right button came up and
    // survived only under a right-DRAG (the travel skipped the tap path). The `contextmenu`
    // handler alone owns the right button now; it closes any open edit menu here (the press
    // invariant) and `onSkyContextMenu` re-opens it where the click lands. A right-drag no
    // longer looks around — it never should have.
    if (e.button === 2) {
      useBldgEditStore.getState().closeMenu();
      useModelEditStore.getState().closeMenu();
      return;
    }
    if (!e.isPrimary) {
      if (bldgArmed) return; // U8: no pinch mid-edit — second fingers are ignored while armed
      // Second finger while the look finger is down = a pinch begins (M2). Anything past two
      // pointers is ignored; a second finger with NO look finger down is ignored too.
      if (fpvDragId !== null && fpvPinchId === null) {
        fpvPinchId = e.pointerId;
        fpvPinchX = e.clientX;
        fpvPinchY = e.clientY;
        fpvPinchStartDist = Math.hypot(e.clientX - fpvLastX, e.clientY - fpvLastY);
        fpvPinchStartFov = fovTargetDeg;
        fpvPinchedDuringDrag = true;
      }
      return;
    }
    fpvDragId = e.pointerId;
    fpvLastX = e.clientX;
    fpvLastY = e.clientY;
    fpvDownX = e.clientX;
    fpvDownY = e.clientY;
    fpvPinchedDuringDrag = false;
    // A direct look-drag always beats a pending sky-look glide (never fight the user).
    if (useCameraStore.getState().skyLook) useCameraStore.getState()._clearSkyLook();
    // MS2: a canvas press closes the building context menu (the island closes itself on presses
    // elsewhere — canvas presses are left to this handler so the release below can tell a
    // "close the menu" tap from a tap-away).
    {
      const bs = useBldgEditStore.getState();
      bldgMenuDismiss = bs.menu !== null;
      if (bldgMenuDismiss) bs.closeMenu();
      const ms = useModelEditStore.getState();
      modelMenuDismiss = ms.menu !== null;
      if (modelMenuDismiss) ms.closeMenu();
    }
    // MS5: an armed model — the press goes to ITS gizmo (on a handle it claims the pointer;
    // off a handle the look-drag stays free and a tap still disarms).
    if (modelArmed) {
      if (modelGizmo.attached) {
        const rect = dom.getBoundingClientRect();
        const [nx, ny] = clientToNdc(e.clientX, e.clientY, rect);
        const committed = modelCommitted();
        if (userModels.rig(modelArmed.id) && modelGizmo.down(nx, ny, 0, editToFeatureTransform(restingEdit(committed)))) {
          modelGizmoDragId = e.pointerId;
          modelLive = restingEdit(committed);
          userModels.setDragging(modelArmed.id, true);
          syncModelEdit();
        }
      }
      return;
    }
    // U8: while armed the primary pointer is CLAIMED for the height drag (a press that never
    // crosses clickDragPx stays a tap — tap-away — see onFpvPointerMove/End).
    // MS2: in a spatial op the press goes to the GIZMO first — on a handle it claims the pointer
    // (the drag is that handle's transform, previewed on the ghost); off a handle the look-drag
    // stays free and a tap still disarms (onFpvPointerEnd).
    if (bldgArmed) {
      if (bldgOp !== "extrude") {
        if (enriched && bldgGizmo.attached) {
          const rect = dom.getBoundingClientRect();
          const [nx, ny] = clientToNdc(e.clientX, e.clientY, rect);
          const rig = enriched.ghostRig();
          const start = bldgCommitted(bldgArmed);
          if (rig && bldgGizmo.down(nx, ny, rig.liveBaseY, start)) {
            bldgGizmoDragId = e.pointerId;
            bldgLive = start;
            enriched.setGhostBodyVisible(true);
            syncBldgEdit();
          }
        }
        return;
      }
      bldgDragId = e.pointerId;
      bldgDragStartY = e.clientY;
      bldgDragStartK = bldgArmed.liveK;
      bldgDragMoved = false;
    }
  };
  const onFpvPointerMove = (e: PointerEvent) => {
    if (!fpvActive) return;
    // MS5: a live MODEL gizmo drag consumes its pointer the same way.
    if (modelArmed && modelGizmoDragId === e.pointerId) {
      const rect = dom.getBoundingClientRect();
      const [nx, ny] = clientToNdc(e.clientX, e.clientY, rect);
      modelGizmo.move(nx, ny, e.shiftKey);
      return;
    }
    if (modelArmed && fpvDragId === null && e.pointerType !== "touch") {
      const rect = dom.getBoundingClientRect();
      const [nx, ny] = clientToNdc(e.clientX, e.clientY, rect);
      if (modelGizmo.hover(nx, ny)) dom.style.cursor = "grab";
      else if (dom.style.cursor === "grab") dom.style.cursor = "";
    }
    // MS5: the hover note over an un-armed user model ("MODEL · title") — throttled like the
    // building note; a building under the pointer keeps its own note (checked below).
    if (!modelArmed && !bldgArmed && fpvDragId === null && e.pointerType !== "touch") {
      const now = performance.now();
      if (now - modelHoverAtMs >= MODELS.hoverPickMs) {
        modelHoverAtMs = now;
        modelHoverId = pickModelAt(e.clientX, e.clientY)?.id ?? null;
      }
    }
    // MS2: a live gizmo drag consumes its pointer BEFORE any look math (the U8 claim's twin).
    if (bldgArmed && bldgGizmoDragId === e.pointerId) {
      const rect = dom.getBoundingClientRect();
      const [nx, ny] = clientToNdc(e.clientX, e.clientY, rect);
      bldgGizmo.move(nx, ny, e.shiftKey);
      return;
    }
    // MS2: hover affordance over the handles (mouse/pen only — touch has no hover and re-tests
    // at the press). A resting pointer costs one raycast against a handful of picker meshes.
    if (bldgArmed && bldgOp !== "extrude" && fpvDragId === null && e.pointerType !== "touch") {
      const rect = dom.getBoundingClientRect();
      const [nx, ny] = clientToNdc(e.clientX, e.clientY, rect);
      if (bldgGizmo.hover(nx, ny)) dom.style.cursor = "grab";
      else if (dom.style.cursor === "grab") dom.style.cursor = "";
    }
    // MESH SUITE MS3: the hover NOTE over an edited building nobody has armed (mouse/pen only,
    // never during a look-drag) — one throttled pick, so a resting pointer costs nothing and a
    // moving one at most ~8 raycasts a second against the enriched meshes.
    if (!bldgArmed && fpvDragId === null && e.pointerType !== "touch" && enriched) {
      const now = performance.now();
      if (now - bldgHoverAtMs >= ENRICHED.hoverPickMs) {
        bldgHoverAtMs = now;
        const pick = pickBuildingAt(e.clientX, e.clientY);
        bldgHover = pick && !isIdentityTransform(pick.current) ? pick : null;
      }
    }
    // U8: the claimed height drag consumes its pointer BEFORE any look math (the pinch
    // precedent) — the camera never turns while armed-and-pressing. The ghost preview appears
    // on the first move past the click slack; below it, the press is still a candidate tap.
    if (bldgArmed && bldgDragId === e.pointerId && enriched) {
      const dyPx = bldgDragStartY - e.clientY; // screen-up = grow
      if (!bldgDragMoved) {
        if (Math.abs(dyPx) <= ORCH.clickDragPx) return;
        bldgDragMoved = true;
        enriched.showGhost(bldgArmed.cellUri, bldgArmed.featureId);
      }
      bldgArmed.liveK = dragScaleK(bldgDragStartK, dyPx, bldgArmed.distM, bldgArmed.bakedHeightM, {
        gainPerM: ENRICHED.overrideDragGainPerM,
        minDistM: ENRICHED.overrideDragMinDistM,
        maxDistM: ENRICHED.overrideDragMaxDistM,
      });
      enriched.setGhostK(bldgArmed.liveK);
      return;
    }
    if (fpvPinchId !== null && (e.pointerId === fpvPinchId || e.pointerId === fpvDragId)) {
      // Pinch owns BOTH fingers: track them, re-derive the gap, drive the FOV by the ratio —
      // spread = zoom in (FOV narrows), same eased fovTargetDeg + clamps as the wheel path.
      // fpvLastX/Y stay fresh so the look doesn't jump when the pinch finger lifts.
      if (e.pointerId === fpvDragId) {
        fpvLastX = e.clientX;
        fpvLastY = e.clientY;
      } else {
        fpvPinchX = e.clientX;
        fpvPinchY = e.clientY;
      }
      const dist = Math.hypot(fpvLastX - fpvPinchX, fpvLastY - fpvPinchY);
      if (fpvPinchStartDist < 8) {
        // Fingers began (or collapsed) nearly on top of each other — re-seed instead of
        // dividing by a hair's width.
        fpvPinchStartDist = dist;
        fpvPinchStartFov = fovTargetDeg;
        return;
      }
      if (dist > 8) {
        fovTargetDeg = THREE.MathUtils.clamp(
          (fpvPinchStartFov * fpvPinchStartDist) / dist,
          FPV.minFovDeg,
          FPV.maxFovDeg,
        );
      }
      return;
    }
    if (fpvDragId !== e.pointerId) return;
    // A REAL look-drag (past the click slack) releases the TRACKING lock — never fight the
    // user. A tap (marker click) and the wheel/pinch FOV zoom deliberately do NOT release.
    if (
      Math.hypot(e.clientX - fpvDownX, e.clientY - fpvDownY) > ORCH.clickDragPx &&
      useSkyStore.getState().track
    ) {
      useSkyStore.getState().setTrack(false);
    }
    // Grab-the-world: dragging right rotates the view left; sensitivity scales with the FOV
    // zoom so a zoomed-in look stays controllable.
    const k = ((FPV.lookDegPerPx * Math.PI) / 180) * (camera.fov / POSE.fovDeg);
    fpvYaw -= (e.clientX - fpvLastX) * k;
    fpvPitch += (e.clientY - fpvLastY) * k;
    fpvLastX = e.clientX;
    fpvLastY = e.clientY;
  };
  const onFpvPointerEnd = (e: PointerEvent) => {
    if (e.pointerId === fpvPinchId) {
      fpvPinchId = null; // the look finger (still down) resumes the drag seamlessly
      return;
    }
    if (fpvDragId !== e.pointerId) return;
    fpvDragId = null;
    fpvPinchId = null; // a pinch cannot outlive its anchor finger
    // The long-press / menu-open consumption flag is read ONCE per release, whichever branch
    // below ends the gesture (MS5b: a gizmo or height release used to leave it set for the NEXT
    // release to swallow).
    const pressConsumed = longPressFired;
    longPressFired = false;
    // MS5: releasing a model gizmo drag COMMITS (PATCH); a pointercancel restores the rig.
    if (modelArmed && modelGizmoDragId === e.pointerId) {
      modelGizmoDragId = null;
      const cancel = e.type === "pointercancel";
      finishModelDrag(cancel ? modelGizmo.cancel() : modelGizmo.up(), !cancel);
      return;
    }
    // MS2: releasing a gizmo drag COMMITS; a pointercancel restores the rig instead.
    if (bldgArmed && bldgGizmoDragId === e.pointerId) {
      bldgGizmoDragId = null;
      const cancel = e.type === "pointercancel";
      finishGizmoDrag(cancel ? bldgGizmo.cancel() : bldgGizmo.up(), !cancel);
      return;
    }
    // U8: releasing the claimed height drag COMMITS; a press that never moved falls through to
    // the tap path below (tap-away / double-tap re-target).
    if (bldgArmed && bldgDragId === e.pointerId) {
      bldgDragId = null;
      if (bldgDragMoved) {
        bldgDragMoved = false;
        commitBldgHeight();
        return;
      }
    }
    if (pressConsumed) return; // the sky-menu long-press / a menu opening consumed this gesture (M3c, MS5b)
    // FPV has no pin/ground picking, but a CLICK (not a look-drag) can still hit the tracked
    // sky marker: glide the look onto it + front the panel (phase C, owner feedback #2).
    // Never after a pinch — those two fingers were a zoom, not a tap.
    if (
      e.type === "pointerup" &&
      !fpvPinchedDuringDrag &&
      Math.hypot(e.clientX - fpvDownX, e.clientY - fpvDownY) <= ORCH.clickDragPx
    ) {
      // U8 glass double-tap: two qualifying taps inside the window arm the building under the
      // second tap (the desktop dblclick twin — dblclick never synthesizes from canvas touches
      // here, and longPressMs stays the temp-pin/sky twin). A single tap while armed = tap-away.
      if (e.pointerType === "touch") {
        const nowTapMs = performance.now();
        const isDoubleTap =
          nowTapMs - bldgLastTapMs <= ORCH.doubleTapMs &&
          Math.hypot(e.clientX - bldgLastTapX, e.clientY - bldgLastTapY) <= ORCH.doubleTapSlopPx;
        bldgLastTapMs = isDoubleTap ? 0 : nowTapMs;
        bldgLastTapX = e.clientX;
        bldgLastTapY = e.clientY;
        if (isDoubleTap) {
          disarmBuilding(); // re-target: the second tap's building wins
          disarmModel();
          if (tryArmModel(e.clientX, e.clientY)) return; // MS5: a model in front wins
          if (tryArmBuilding(e.clientX, e.clientY)) return;
        }
      }
      if (modelArmed) {
        if (modelMenuDismiss) {
          modelMenuDismiss = false; // that tap only closed the model menu
          return;
        }
        disarmModel(); // MS5 tap-away — modal, like the building session
        return;
      }
      if (bldgArmed) {
        if (bldgMenuDismiss) {
          bldgMenuDismiss = false; // MS2: that tap only closed the context menu
          return;
        }
        disarmBuilding(); // U8 tap-away — the edit session is modal; nothing else on this tap
        return;
      }
      const rect = dom.getBoundingClientRect();
      const [ndcX, ndcY] = clientToNdc(e.clientX, e.clientY, rect);
      // Marker first, then a FIND ghost projection — a tap on a standing jumps time onto it.
      if (!trySkyMarkerClick(ndcX, ndcY) && !tryFindGhostClick(ndcX, ndcY)) {
        // Tap-reveal (M3c): nothing interactive under the tap — park the synthetic hover
        // (the ghost pick just seated _pickRay); sky-only, same floor as the context menu.
        if (
          e.pointerType === "touch" &&
          dirToAzAltAtCamera(_pickRay.ray.direction).altDeg >= ORCH.skyMenuMinAltDeg
        ) {
          tapRevealX = e.clientX;
          tapRevealY = e.clientY;
          tapRevealUntil = performance.now() + ORCH.tapRevealMs;
        }
      }
    }
  };
  const onFpvWheel = (e: WheelEvent) => {
    if (!fpvActive) return;
    e.preventDefault(); // the page must not scroll under the look
    fovTargetDeg = THREE.MathUtils.clamp(
      fovTargetDeg * Math.exp(e.deltaY * FPV.wheelFovFactor),
      FPV.minFovDeg,
      FPV.maxFovDeg,
    );
  };
  // Escape unwinds the interaction stack one level at a time: explore → photo FPV →
  // temp-pin FPV → temp pin → a viewed saved pin (deselect). Own unsaved uploads keep their
  // UploadFlow Escape semantics (never discarded from here).
  // A focused typing surface owns its letters/arrows — walk keys must never steal them.
  const typingTarget = (ae: HTMLElement | null): boolean => {
    const tag = ae?.tagName;
    return !!ae && (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || ae.isContentEditable);
  };
  const onFpvKey = (e: KeyboardEvent) => {
    if (fpvActive && !e.metaKey && !e.ctrlKey) {
      // Arrow keys + WASD (owner 2026-08-14, ask 2) WALK on the ground plane (you walk where
      // you look; ◀▶/AD strafe). Shift sprints (×walkFastMult); Option/Alt creeps
      // (×walkSlowMult). Modifier state is mirrored on EVERY key event so pressing/releasing
      // mid-stride retunes the speed live. Guards: WASD are letters — blocked only while a
      // typing surface is focused; arrows additionally yield to an EXPLICIT tabindex owner
      // (the scrubber rail scrubs with ◀▶ — native buttons don't use arrows, so they still walk).
      const ae = document.activeElement as HTMLElement | null;
      // MESH SUITE MS2: Blender's G / R / S (+ E for the U8 extrude) switch the armed op — only
      // while a building is armed (the session is modal; S shadows walk-back for its duration,
      // which the chip hint says out loud). Routed through the store so the chip tabs, the menu
      // and the keys are ONE path (the frame service applies it).
      if (modelArmed && !typingTarget(ae)) {
        const op: ModelEditOp | null =
          e.code === "KeyG" ? "move" : e.code === "KeyR" ? "rotate" : e.code === "KeyS" ? "scale" : null;
        if (op) {
          useModelEditStore.getState().setOp(op);
          e.preventDefault();
          return;
        }
      }
      if (bldgArmed && !typingTarget(ae)) {
        const op: BldgEditOp | null =
          e.code === "KeyG"
            ? "move"
            : e.code === "KeyR"
              ? "rotate"
              : e.code === "KeyS"
                ? "scale"
                : e.code === "KeyE"
                  ? "extrude"
                  : null;
        if (op) {
          useBldgEditStore.getState().setOp(op);
          e.preventDefault();
          return;
        }
      }
      fpvKeysDown.shift = e.shiftKey;
      fpvKeysDown.alt = e.altKey;
      const isArrow = e.key.startsWith("Arrow");
      const walkBlocked = isArrow ? typingTarget(ae) || !!ae?.hasAttribute("tabindex") : typingTarget(ae);
      if (!walkBlocked) {
        if (e.key === "ArrowUp" || e.code === "KeyW") { fpvKeysDown.up = true; e.preventDefault(); return; }
        if (e.key === "ArrowDown" || e.code === "KeyS") { fpvKeysDown.down = true; e.preventDefault(); return; }
        if (e.key === "ArrowLeft" || e.code === "KeyA") { fpvKeysDown.left = true; e.preventDefault(); return; }
        if (e.key === "ArrowRight" || e.code === "KeyD") { fpvKeysDown.right = true; e.preventDefault(); return; }
      }
      if (e.code === "Space") {
        // SPACE = ascend, SHIFT+SPACE = descend (QoL-1 + owner 2026-08-14 ask 2 — the sign
        // rides the live shift mirror, so pressing/releasing Shift mid-hold reverses without
        // restarting the ramp). Never steal Space from an interactive element — the browser
        // activates a focused button/input with it (the scrubber rail is tabIndex=0 too).
        const tag = ae?.tagName;
        if (
          ae &&
          (tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" ||
            ae.isContentEditable || ae.tabIndex >= 0)
        )
          return;
        if (!fpvKeysDown.space) fpvSpaceHeldMs = 0; // key-repeat must not reset the ramp
        fpvKeysDown.space = true;
        e.preventDefault(); // Space must not scroll the page under the view
        return;
      }
    }
    if (e.key !== "Escape") return;
    const up = useUploadStore.getState();
    const camS = useCameraStore.getState();
    // The sky context menu owns the first Escape — closing it must not unwind FPV (QoL-2 ask 7;
    // the SkyContextMenu island also closes itself, so this consume is belt-and-braces).
    if (camS.skyMenu) {
      camS.setSkyMenu(null);
      return;
    }
    // U8: an armed building edit owns the next Escape — finishing the edit must not exit FPV.
    // MS2 rungs inside it: an open context menu closes first; a live gizmo drag is CANCELLED
    // (the rig returns to where the drag began, nothing commits); only then Escape disarms.
    if (modelArmed) {
      const ms = useModelEditStore.getState();
      if (ms.menu) {
        ms.closeMenu();
        return;
      }
      if (modelGizmoDragId !== null) {
        modelGizmoDragId = null;
        finishModelDrag(modelGizmo.cancel(), false);
        return;
      }
      disarmModel();
      return;
    }
    if (bldgArmed) {
      const bs = useBldgEditStore.getState();
      if (bs.menu) {
        bs.closeMenu();
        return;
      }
      if (bldgGizmoDragId !== null) {
        bldgGizmoDragId = null;
        finishGizmoDrag(bldgGizmo.cancel(), false);
        return;
      }
      disarmBuilding();
      return;
    }
    // Batch 2026-08-19 item 5: the fullscreen map window owns the next Escape — closing it
    // must never unwind FPV under it (MapWindow's own listener double-closes; idempotent).
    const mmS = useMiniMapStore.getState();
    if (mmS.mapWindowOpen) {
      mmS.setMapWindowOpen(false);
      return;
    }
    if (camS.exploreActive) camS.setExplore(false);
    else if (up.viewMode === "fpv") up.setViewMode("orbit");
    else if (camS.tempFpv) camS.setTempFpv(false);
    else if (camS.tempPin) camS.setTempPin(null);
    else if (up.phase === "placed" && up.viewingPinId) up.clear();
  };
  const onFpvKeyUp = (e: KeyboardEvent) => {
    fpvKeysDown.shift = e.shiftKey;
    fpvKeysDown.alt = e.altKey;
    if (e.key === "ArrowUp" || e.code === "KeyW") fpvKeysDown.up = false;
    else if (e.key === "ArrowDown" || e.code === "KeyS") fpvKeysDown.down = false;
    else if (e.key === "ArrowLeft" || e.code === "KeyA") fpvKeysDown.left = false;
    else if (e.key === "ArrowRight" || e.code === "KeyD") fpvKeysDown.right = false;
    else if (e.code === "Space") fpvKeysDown.space = false;
  };
  // Focus loss eats keyup events — release every held walk/ascend key or the camera walks
  // itself over the horizon on an unfocused tab (stuck-key safety, QoL-1).
  const onWinBlur = () => {
    fpvKeysDown.up = fpvKeysDown.down = fpvKeysDown.left = fpvKeysDown.right = false;
    fpvKeysDown.shift = fpvKeysDown.alt = fpvKeysDown.space = false;
  };
  // Double-click on the ground drops the temporary pin (deselecting a viewed pin first — the
  // gesture means "focus here"). Ignored while placing and while editing an own unsaved upload.
  const dropTempPinAt = (clientX: number, clientY: number) => {
    if (fpvActive) return;
    const up = useUploadStore.getState();
    if (placingNow()) return;
    if (up.phase === "placed" && !up.viewingPinId) return; // don't disturb an editing session
    const rect = dom.getBoundingClientRect();
    const [ndcX, ndcY] = clientToNdc(clientX, clientY, rect);
    const hit = pickGround(ndcX, ndcY);
    if (!hit) return; // clicked/pressed past the limb
    if (up.phase === "placed" && up.viewingPinId) up.clear(); // deselect the viewed pin first
    const g = ecefToGeodetic(hit);
    useCameraStore.getState().setTempPin({ latDeg: g.latDeg, lonDeg: g.lonDeg });
  };
  const onDblClick = (e: MouseEvent) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > ORCH.clickDragPx) return; // a drag, not a dblclick
    if (fpvActive) {
      // U8 (owner 2026-08-18): FPV dblclick was a free slot (dropTempPinAt early-returns in
      // FPV) — it now arms the building under the cursor for a height edit; a dblclick on
      // another building re-targets; on empty ground/sky it just disarms.
      disarmBuilding();
      disarmModel();
      if (tryArmModel(e.clientX, e.clientY)) return; // MS5: a user model in front wins
      tryArmBuilding(e.clientX, e.clientY);
      return;
    }
    // MS6: the first click of a dblclick on a model already asked to stand beside it — never
    // drop a temp pin under the model on top of that.
    if (pickModelAt(e.clientX, e.clientY)) return;
    dropTempPinAt(e.clientX, e.clientY);
  };
  // Long-press = the dblclick twin on glass (MOBILE_PLAN §4.3, M1; sky menu M3c). Gated on
  // pointerType "touch" — STRICTER than the plan's wording — so the frozen desktop stays
  // behavior-identical (a mouse held still 500 ms must not start dropping pins). ONE timer
  // arbitrates at FIRE time: a press on a sky body opens the context menu (the right-click
  // twin — and the only long-press FPV honours); otherwise the orbit ground press drops the
  // temp pin as before. Guards re-run at fire time via dropTempPinAt; a second finger (pinch)
  // cancels; onPointerUp / onFpvPointerEnd above own lift/suppression.
  const onLongPressDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !e.isPrimary) {
      cancelLongPress(); // a mouse press or a second touch is never a long-press
      return;
    }
    cancelLongPress();
    longPressFired = false;
    const { clientX, clientY } = e;
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      const rect = dom.getBoundingClientRect();
      const [ndcX, ndcY] = clientToNdc(clientX, clientY, rect);
      const best = pickSkyBody(ndcX, ndcY);
      if (best) {
        const { azDeg, altDeg } = dirToAzAltAtCamera(best.dir);
        if (altDeg >= ORCH.skyMenuMinAltDeg) {
          longPressFired = true;
          useCameraStore
            .getState()
            .setSkyMenu({ kind: best.kind, screenX: clientX, screenY: clientY, azDeg, altDeg });
          return;
        }
      }
      if (fpvActive) {
        // MS2: a long-press on a building (or anywhere while one is armed) opens the edit menu —
        // the right-click twin on glass; another building re-targets. A ground long-press with
        // nothing armed stays orbit-only (FPV owns its pointer).
        // MS5: a user model under the finger first (own models only).
        const mp = pickModelAt(clientX, clientY);
        if (mp && armModel(mp)) {
          if (modelGizmoDragId === null) {
            longPressFired = true;
            openModelMenu(clientX, clientY);
          }
          return;
        }
        if (modelArmed && modelGizmoDragId === null) {
          longPressFired = true;
          openModelMenu(clientX, clientY);
          return;
        }
        const pick = pickBuildingAt(clientX, clientY);
        if (pick && !isArmedPick(pick)) {
          disarmBuilding();
          armPick(pick);
        }
        if (bldgArmed && bldgGizmoDragId === null) {
          longPressFired = true;
          openBldgMenu(clientX, clientY);
        }
        return;
      }
      longPressFired = true;
      dropTempPinAt(clientX, clientY);
    }, ORCH.longPressMs);
  };
  const onLongPressMove = (e: PointerEvent) => {
    if (longPressTimer === null || !e.isPrimary) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > ORCH.clickDragPx) cancelLongPress();
  };
  dom.addEventListener("pointerdown", onLongPressDown);
  dom.addEventListener("pointermove", onLongPressMove);
  dom.addEventListener("pointercancel", cancelLongPress);
  dom.addEventListener("pointerdown", onFpvPointerDown);
  dom.addEventListener("pointermove", onFpvPointerMove);
  dom.addEventListener("pointerup", onFpvPointerEnd);
  dom.addEventListener("pointercancel", onFpvPointerEnd);
  dom.addEventListener("wheel", onFpvWheel, { passive: false });
  dom.addEventListener("dblclick", onDblClick);
  dom.addEventListener("contextmenu", onSkyContextMenu);
  window.addEventListener("keydown", onFpvKey);
  window.addEventListener("keyup", onFpvKeyUp);
  window.addEventListener("blur", onWinBlur);
  // #5 iOS resilience (batch #4 S3): hiding the page stalls the rAF-driven queue SCHEDULER but
  // leaves in-flight fetches + freshly queued jobs running — network/parse churn on a hidden tab
  // is exactly what iOS Safari's jetsam/heat accounting punishes with a page kill. Freeze all
  // nine tile queues (3 renderers × download/parse/processNode) the moment the page hides;
  // re-arm and kick on return. `autoUpdate` is the library's ONE scheduling gate (PriorityQueue)
  // — orthogonal to the tier `maxJobs` caps, so the quality fan-out never fights it.
  const setTilesNetworkPaused = (paused: boolean) => {
    for (const t of [buildings.tiles, enriched?.tiles, ground.tiles]) {
      if (!t) continue;
      for (const q of [t.downloadQueue, t.parseQueue, t.processNodeQueue]) {
        q.autoUpdate = !paused;
        if (!paused) q.scheduleJobRun();
      }
    }
  };
  const onLifecycleVisibility = () => setTilesNetworkPaused(document.hidden);
  const onPageHide = () => setTilesNetworkPaused(true);
  const onPageShow = () => setTilesNetworkPaused(false);
  document.addEventListener("visibilitychange", onLifecycleVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  const _fpvQ = new THREE.Quaternion();
  const _fpvFwd = new THREE.Vector3();
  const _fpvUp = new THREE.Vector3();
  const _fpvRight = new THREE.Vector3();
  const _fpvUpGeo = new THREE.Vector3();
  // Sky-look glide scratch (owner 2026-07-14): ENU east/north at the FPV eye.
  const _skyEast = new THREE.Vector3();
  const _skyNorth = new THREE.Vector3();
  const _fpvLook = new THREE.Vector3();
  const _fpvWalkFwd = new THREE.Vector3();
  const _fpvWalkRight = new THREE.Vector3();
  // FPV HUD scratch (S6): camera-space body directions + the inverse camera rotation.
  const _hudQ = new THREE.Quaternion();
  const _hudDir = new THREE.Vector3();
  const _hudDir2 = new THREE.Vector3();
  // U8 scratch: the armed building's roof anchor (world) for the pinned label.
  const _bldgTop = new THREE.Vector3();

  // Encoder-style rate controls (Phase 5.5 S2): the applied rates ease toward the stick so
  // deflection ramps in and release coasts out (CONTROLS.rateEaseTauMs).
  let appliedHeadingRate = 0; // deg/s
  let appliedZoomRate = 0; // log-space 1/s
  let appliedFovRate = 0; // log-space 1/s (FOCAL ZOOM encoder, FPV only — S6)
  // Zoom-glide stall release: the slider floor is ellipsoid-relative, so over real terrain the
  // glide can rest on cameraRadius/terrain forever — release it instead of fighting.
  let zoomGlideLastAlt = -1;
  let zoomStallCount = 0;
  // STICKY last-known terrain under the camera (m above the ellipsoid). Once the camera dips
  // below the surface the whole ground tileset unloads (nothing passes the SSE test from
  // underground — browser-verified: 0 tile meshes) and live heightAt can never answer again,
  // so the street floor must be enforced from memory BEFORE the crossing.
  let lastGroundM: number | null = null;

  // Scratch vectors for the per-frame sun/shadow/sky work (no allocation on the hot path).
  const _camFwd = new THREE.Vector3();
  const _focus = new THREE.Vector3();
  const _focusUp = new THREE.Vector3();
  // RC4 — the shadow rig's OWN focus. Deliberately separate from `_focus`: that vector is the
  // pivot for the tilt/heading glides and the lat/lon source for PLAN/FIND/BEST SPOT, and its
  // documented miss-fallback (the camera position itself → a pure look-rotation with no
  // translation) is load-bearing for those consumers. The rig wants the opposite thing — a
  // point on the GROUND framing the visible ground — so it gets its own.
  const _shadowFocus = new THREE.Vector3();
  const _eyeUp = new THREE.Vector3();
  const _eyeGround = new THREE.Vector3();
  const _fwdHoriz = new THREE.Vector3();
  /** Fitted ortho half-extent (m) — quantized, so the projection block still runs on change only. */
  let shadowBoundsM: number = SHADOWS.boundsM;
  /** Fitted view distance behind the current ortho extent (m) — reported by `__globe.ultraLook`. */
  let shadowViewFitM = 0;
  const _shadowFitBase: ShadowFitProfile = {
    boundsM: SHADOWS.boundsM,
    boundsAltK: SHADOWS.boundsAltK,
    maxBoundsM: SHADOWS.maxBoundsM,
    viewFitK: SHADOWS.viewFitK,
    quantM: SHADOWS.boundsQuantM,
  };
  const _shadowFitUltra: ShadowFitProfile = {
    ..._shadowFitBase,
    boundsAltK: ULTRA.boundsAltK,
    maxBoundsM: ULTRA.maxBoundsM,
  };
  // --- SHADOW CASCADES (owner defect 1, 2026-08-27). Declared HERE, above the ephemeris seam:
  //     a `let` read by the frame loop but declared below it is a TDZ throw that this file
  //     swallows into the silent-fallback path (the standing trap in this module).
  //     One record per cascade light, holding what its LIVE depth map was rendered with — the
  //     refresh test compares against these, never against a re-derivation.
  const _cascadeState = shadowCascades.map(() => ({
    halfExtentM: 0,
    centre: new THREE.Vector3(),
    keyDir: new THREE.Vector3(),
    epoch: -1,
    lastMs: 0,
    /** Live for the DEV probe — a cascade dropped by the fit reports `active: false`. */
    active: false,
    metresPerTexel: 0,
    biasM: 0,
  }));
  const _cascadeSwingRad = THREE.MathUtils.degToRad(ULTRA.cascadeRefreshDeg);
  const _casKey = new THREE.Vector3();
  /** The eye→focus distance the shadow ladder was fitted from this frame (m). */
  let shadowViewDistM = 0;
  /** RC2 — the one elevation-gate profile the key/shadow handoff ramps read (lib/globe/keyHandoff).
   *  ULTRA shares it deliberately: it shares the gate, so it must share the fade. */
  const KEY_GATE: KeyGateProfile = {
    gateSin: SHADOWS.minSunElevSin,
    bandSin: SHADOWS.fadeBandSin,
    moonMinIllum: SHADOWS.moonMinIllum,
    moonIllumSoftFrac: SHADOWS.moonIllumSoftFrac,
  };
  /** The SHADOW FIELD's own gate under ULTRA (owner taste pass, 2026-08-27c). Same crossing point
   *  as `KEY_GATE` — which is load-bearing, because that is where the rig's direction teleports
   *  from the sun to the moon and the field has to be at zero when it does — but a band a fifth
   *  as wide, so cast shadows survive the raking hour instead of dying from 3.5° up. */
  const ULTRA_SHADOW_GATE: KeyGateProfile = { ...KEY_GATE, bandSin: ULTRA.shadowFadeBandSin };
  const _keyWhite = new THREE.Color(0xffffff);
  /** Owner defect 2 — scratch for the physical extinction chromaticity applied to the key. */
  const _keyChroma = new THREE.Color();
  const _goldenCol = new THREE.Color(tokens.goldenHour);
  const _moonKeyCol = new THREE.Color(tokens.moonlight); // the key light's moon-shadow disguise
  let frameCount = 0;

  // --- ULTRA LOOK (T44 §1a + T45 S4/S9/S10/S11) — the light-transport half of the fidelity track.
  //
  //     ONE sample per frame drives every consumer, which is the point: the ULTRA_PLAN's hardest
  //     constraint is that the ground, the buildings, the key light and the exposure move TOGETHER
  //     through the twilight bands — a ground that brightens on a different curve from the city
  //     standing on it is the same incoherence that made forcing `dayK` a C2 breach in §1a.
  //
  //     THE ACCEPTANCE CRITERION IS A TIMELAPSE (owner 2026-08-22i): park the camera, scrub scene
  //     time day → golden → civil → nautical → astronomical → night and back, and judge the
  //     SEQUENCE. Every term below is therefore eased, never stepped.
  //
  //     The four tint anchors line up with ULTRA.tintStopsDeg [+10, 0, −6, −16] — day / golden /
  //     blue / night. `water` (a near-black slate) is the night anchor on purpose: night haze is
  //     DARKNESS, not grey. Painting grey over a night city is the C2 failure mode of S4.
  const _hazeDayCol = new THREE.Color(tokens.skyHorizon);
  const _hazeGoldCol = new THREE.Color(tokens.goldenHour);
  const _hazeBlueCol = new THREE.Color(tokens.atmosphereDeep);
  const _hazeNightCol = new THREE.Color(tokens.water);
  const _hazeCol = new THREE.Color();
  /** Owner defect 2 — the ANTI-SOLAR air-light tint (the cool end of the directional swing). */
  const _hazeCoolCol = new THREE.Color();
  const _ultraZeroCol = new THREE.Color(tokens.skyHorizon);
  /** Owner defect 2 — the dusk sample. Declared HERE, above the ephemeris seam, for the standing
   *  TDZ reason: a `let` read by the frame loop but declared below it throws into this module's
   *  silent-fallback path. `directK` seeds at 1 so a frame that runs before the first sample
   *  cannot darken the ground. */
  let ultraSkyLevel = 0;
  let ultraAfterglow = 0;
  /** The sky dome's directional-arm weight, eased so a chip flip dissolves. */
  let ultraDomeDir = 0;
  /** The two dusk TROUGHS on the sun-blind facade terms. Exactly 1 with the chip off — the flat
   *  parts of a building have to fall on the same curve the key falls on, or dimming the key just
   *  flattens the city (measured front:back on a wall, before this: 1.28 at 3°, 1.08 at 0°). */
  let ultraEmisK = 1;
  let ultraEdgeK = 1;
  let ultraDirectK = 1;
  /** The construction state of every live lever ULTRA writes, captured so the OFF edge is a
   *  RESTORE rather than a re-derivation. `hemiLight` in particular has no other record of where
   *  it started: three reads a HemisphereLight's direction from its world position, and its
   *  as-constructed position is the default (0,1,0). */
  const _hemiSky0 = hemiLight ? hemiLight.color.clone() : null;
  const _hemiGround0 = hemiLight ? hemiLight.groundColor.clone() : null;
  const _hemiPos0 = hemiLight ? hemiLight.position.clone() : null;
  const _hemiIntensity0 = hemiLight ? hemiLight.intensity : 0;
  const _shadowRadius0 = sunLight ? sunLight.shadow.radius : SHADOWS.radius;
  const _shadowNormalBias0 = sunLight ? sunLight.shadow.normalBias : SHADOWS.normalBias;
  const _shadowBias0 = sunLight ? sunLight.shadow.bias : SHADOWS.bias;
  /** Eased `renderer.toneMappingExposure` (S11). Seeded at the constructed value so the very
   *  first ULTRA frame ramps from where the scene actually is, not from 1.0-by-assumption. */
  let ultraExposure = renderer.toneMappingExposure;
  let lastUltraMs = performance.now();
  /** False while any ULTRA-owned lever is still unwinding back to its baseline. It is what lets
   *  the OFF steady state cost literally nothing (an early return) without making the OFF EDGE a
   *  snap — a one-frame exposure or ambient jump on a chip click reads as a flash. */
  let ultraLookSettled = true;
  /** True while the shadow rig carries ULTRA geometry — the edge detector for the rig, which
   *  cannot use the bounds comparison below: at street level both profiles clamp to the same
   *  `SHADOWS.boundsM`, so a flip would leave near/far and the bias on the wrong profile. */
  let shadowRigUltra = false;

  // --- Camera feel (2026-07-10 owner pass) — temporal zoom easing, damped auto-verticality and
  //     the declination glide. Mechanics verified against the GlobeControls source (0.4.28):
  //     the library consumes the whole wheel delta in one frame and, while zooming IN, rotates
  //     the camera around the zoom point at FULL strength as the local up changes
  //     (EnvironmentControls._setFrame) — that pair is what read as "snaps to vertical". --------
  let pendingZoom = 0; // banked wheel/pinch delta, released exp(-dt/tau) per frame
  // U2/A2: the zoom bank must die at every FPV boundary. The library's `resetState()` (fired by
  // the `enabled` setter) clears drag/rotate state + inertia but NEVER `zoomDelta`, and while
  // disabled `update()` early-returns — worse, stepZoomBrakeAndEase keeps SLOSHING the bank
  // between `pendingZoom` and the unconsumed `zc.zoomDelta` each frame, so the sum is CONSERVED
  // across an FPV session of any length and discharges as one real zoom the instant FPV exits
  // (the point-6 "violent jerk to orbit"). Zeroed at entry AND exit. (The /m 2D tilt gesture
  // never toggles controls.enabled — stepMobile2dLocks steers targets only — so no bank can
  // survive a disable there; nothing to clear on that path.)
  const zeroZoomBank = () => {
    pendingZoom = 0;
    zc.zoomDelta = 0;
  };
  let lastAlt: number = POSE.cam.altM; // previous frame's altitude (zoom braking runs pre-update)
  let lastFrameMs = performance.now();
  const _upBefore = new THREE.Vector3();
  const _pivot = new THREE.Vector3();
  const _pivotUp = new THREE.Vector3();
  const _camBack = new THREE.Vector3();
  const _qFull = new THREE.Quaternion();
  const _qCounter = new THREE.Quaternion();
  const _Z = new THREE.Vector3(0, 0, 1);
  const _east = new THREE.Vector3();
  const _north = new THREE.Vector3();
  const _fh = new THREE.Vector3();
  const _qHead = new THREE.Quaternion();

  // ── Per-frame hub (frame-locals; the B19_HANDOFF FrameContext) ── established each frame by the
  //    producer steps below and read by many later steps; NONE persist across frames. The step
  //    closures read/write these directly by name (that is why they are hoisted to this scope).
  let now = 0;
  let dtMs = 0;
  let zoomStep = 0;
  let alt = 0;
  let kRate = 0;
  let tMs = 0;
  let rateAllowed = false;
  let focusLocked = false;
  let hasFocus = false;
  let moonShadows = false;
  /** RC2 — how much of the moon key the RIG is carrying this frame (0 = all of it still on the
   *  dedicated moonLight in scene/sky.ts). The two are complementary by construction, which is
   *  what makes the source switch at sunset invisible instead of a one-frame flip. */
  let moonRigTakeover = 0;
  let focusHit: ReturnType<typeof rayEllipsoidIntersect> = null;
  let upNow = useUploadStore.getState();
  let camNow = useCameraStore.getState();
  let camStore = useCameraStore.getState();
  const zc = controls as unknown as GlobeControlsInternal;

  // Compass heading (deg; 0 = north, 90 = east) of the camera view projected on the horizon
  // plane at `up`. NaN when degenerate (pole, or looking straight down — heading undefined).
  const viewHeadingDeg = (up: THREE.Vector3): number => {
    _east.crossVectors(_Z, up);
    if (_east.lengthSq() < 1e-12) return NaN; // at a pole east/north degenerate
    _east.normalize();
    _north.crossVectors(up, _east);
    camera.getWorldDirection(_camFwd);
    _fh.copy(_camFwd).addScaledVector(up, -_camFwd.dot(up));
    if (_fh.lengthSq() < 1e-10) return NaN; // nadir view
    return THREE.MathUtils.radToDeg(Math.atan2(_fh.dot(_east), _fh.dot(_north)));
  };

  // Compass bearing of the camera's SCREEN-UP projected on the horizon plane at `up` — the /m
  // 2D map's north reference (U1). viewHeadingDeg degenerates exactly where the 2D map lives
  // (at nadir, forward ∥ up); screen-up is horizontal there and stays valid through the whole
  // 2D tilt band, and for an unrolled camera the two bearings agree at any oblique tilt.
  const mapUpHeadingDeg = (up: THREE.Vector3): number => {
    _east.crossVectors(_Z, up);
    if (_east.lengthSq() < 1e-12) return NaN; // at a pole east/north degenerate
    _east.normalize();
    _north.crossVectors(up, _east);
    _fh.set(0, 1, 0).transformDirection(camera.matrixWorld); // camera local +Y = screen-up
    _fh.addScaledVector(up, -_fh.dot(up));
    if (_fh.lengthSq() < 1e-10) return NaN; // screen-up vertical (horizon view — never 2D)
    return THREE.MathUtils.radToDeg(Math.atan2(_fh.dot(_east), _fh.dot(_north)));
  };

  /**
   * `__globe.bestSpotTuning(patch | "preset" | null)` — SPEC_V2 §5.6, plus `.export()` and
   * `.ab(A, B)`.
   *
   * The MERGE lives here and not in the store on purpose: the store REPLACES its patch (so "reset
   * this one field" is expressible at all), and the seam is the thing that has both the current
   * patch and the new one to merge from. `null` clears back to the shipped default.
   */
  const bestSpotTuning = Object.assign(
    (patch: BestSpotScoringPatch | string | null): string => {
      const st = useBestSpotStore.getState();
      if (patch === null) {
        st.setScoring(null);
        return `bestSpot: SCORING reset to default · ${scoringHash(resolveScoring(null))}`;
      }
      const raw = typeof patch === "string" ? BESTSPOT_PRESETS[patch] : patch;
      if (!raw) return `bestSpot: no such preset "${String(patch)}" — ${Object.keys(BESTSPOT_PRESETS).join(", ")}`;
      // A PRESET replaces; a partial patch merges onto what is already tuned.
      const merged =
        typeof patch === "string" ? raw : deepMergePatch(st.scoringPatch ?? {}, sanitizeScoringPatch(raw));
      st.setScoring(merged);
      const next = useBestSpotStore.getState();
      return `bestSpot: SCORING ${next.scoringPatch ? `custom (${scoringDiff(next.scoring).length} fields)` : "default"} · ${scoringHash(next.scoring)}`;
    },
    {
      /** Paste-ready TS: the PATCH (what is persisted) and the full resolved profile. */
      export: () => {
        const st = useBestSpotStore.getState();
        return [
          `// bestSpotTuning patch — ${scoringHash(st.scoring)}`,
          `const patch = ${JSON.stringify(st.scoringPatch ?? null, null, 2)} as BestSpotScoringPatch;`,
          `const resolved = ${JSON.stringify(st.scoring, null, 2)};`,
        ].join("\n");
      },
      /** Rank delta + Spearman ρ + top-10 survival between two patches. Two recomposes = 0.54 ms,
       *  and it answers the question the owner actually has ("did the RANKING change?"). */
      ab: (a: BestSpotScoringPatch | null, b: BestSpotScoringPatch | null) =>
        bestSpotFeed.ab(resolveScoring(a), resolveScoring(b)),
    },
  );

  // DEBUG HUD (owner 2026-09-01) — the two EXPENSIVE censuses, extracted so the DEV
  // `ultraLook()` probe below and the HUD's on-demand ACTIONS share one implementation
  // (the DEV block is statically eliminated from release builds; the HUD is not). Both
  // TRAVERSE — the terrain one walks the whole ground tile group, the aniso one every live
  // overlay composite — so neither may ever sit on a poll, let alone a frame.
  const terrainCastCensus = () => {
    let meshes = 0;
    let casting = 0;
    let frontSideShadow = 0;
    // Owner defect 3 (2026-08-27): the quantized-mesh SKIRT is what drew a dark band along
    // every tile boundary once terrain casting shipped. `skirtClipped` counts the casters
    // that actually carry the depth-pass draw-range clip, and `skirtGroups` the ones whose
    // geometry has the cap/skirt layout the clip depends on — if the library ever changes
    // that layout, the two numbers separate instead of the fix silently doing nothing.
    let skirtClipped = 0;
    let skirtGroups = 0;
    ground.tiles.group.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m.material as THREE.Material)?.type !== "MeshBasicMaterial") return;
      meshes++;
      if (m.castShadow) casting++;
      if ((m.material as THREE.Material).shadowSide === THREE.FrontSide) frontSideShadow++;
      if (Object.prototype.hasOwnProperty.call(m, "onBeforeShadow")) skirtClipped++;
      const g0 = m.geometry.groups[0];
      const total = m.geometry.index?.count ?? 0;
      if (g0 && g0.start === 0 && g0.count > 0 && g0.count < total) skirtGroups++;
    });
    return { meshes, casting, frontSideShadow, skirtClipped, skirtGroups };
  };
  const anisoCensus = () => {
    const plugins = (ground.tiles as unknown as { plugins?: unknown[] }).plugins ?? [];
    const plug = plugins.find(
      (p) => (p as { overlayInfo?: unknown }).overlayInfo instanceof Map,
    ) as { overlayInfo: Map<unknown, { tileInfo: Map<unknown, { target?: THREE.Texture }> }> } | undefined;
    if (!plug) return null;
    const seen: number[] = [];
    // RC25: the mip-chain level count per live composite, plus the REAL texture bytes.
    // `mipMin !== mipMax` would mean two composites disagree about their level count —
    // under three's (source, cacheKey) sharing that is a silent, intermittent bug, so it
    // is published rather than argued about. `bytes` is summed from the levels the texture
    // actually carries, because the library's own accounting scales by 4/3 for AUTO
    // mipmaps only and would under-report a hand-built chain by exactly the amount that
    // matters. `mipmaps: []` (the off-state) reports 0, not 1 — the literal the off-state
    // assertion wants.
    const mips: number[] = [];
    let bytes = 0;
    // `baseBytes` is the SAME textures counted at level 0 only, so `bytes / baseBytes` is
    // the chain's overhead and nothing else. Comparing an OFF reading against an ON reading
    // does not give that: the ULTRA chip pins the tier to `high`, which also moves the
    // composite resolution, and the first run of this check reported ×1.13 for a mix of a
    // 256²→512² resolution change and the chain. A ratio has to be taken inside one sample.
    let baseBytes = 0;
    plug.overlayInfo.forEach(({ tileInfo }) => {
      tileInfo.forEach((info) => {
        const t = info.target;
        if (!t?.isTexture) return;
        seen.push(t.anisotropy);
        const chain = (t.mipmaps ?? []) as Array<{ width: number; height: number }>;
        mips.push(chain.length);
        const img = t.image as { width?: number; height?: number } | undefined;
        const w = img?.width ?? 0;
        const h = img?.height ?? 0;
        baseBytes += w * h * 4;
        bytes += chain.length
          ? chain.reduce((n, l) => n + l.width * l.height * 4, 0)
          : w * h * 4;
      });
    });
    if (seen.length === 0)
      return {
        n: 0, min: null, max: null, mipMin: null, mipMax: null,
        chained: 0, bytes: 0, baseBytes: 0,
      };
    return {
      n: seen.length,
      min: Math.min(...seen),
      max: Math.max(...seen),
      mipMin: Math.min(...mips),
      mipMax: Math.max(...mips),
      /** How many live composites carry a chain. The stamp is CREATION-time, so a mix is
       *  the EXPECTED state after a flip until the cache turns over — `chained` is what
       *  separates "the stamp is landing" from "the stamp is landing on everything". */
      chained: mips.filter((m) => m > 0).length,
      bytes,
      baseBytes,
    };
  };

  // Dev-only introspection so browser verification (Playwright) can read camera altitude and tile
  // state without reaching into the closure. No secrets, no behaviour change.
  if (import.meta.env.DEV) {
    window.__globe = {
      camera,
      controls,
      tiles: buildings.tiles,
      enriched: enriched?.tiles ?? null, // Dnipro 3D enrichment (Slice 0) — null unless the URL is set
      enrichedSeats: () => enriched?.debugSeats() ?? null, // per-building re-seat coverage (2026-07-14)
      // T77 MEASURE (2026-09-05) — the RESEAT-SETTLE read seam: this frame's seat residuals from
      // the apply pass (plain field reads, safe inside a per-frame rAF probe — unlike
      // enrichedSeats(), which walks ~39k features), paired with the orchestrator frame and the
      // terrain epoch whose bump re-arms every target. `scripts/verify-temporal-stability.mjs`.
      seatSettle: () => ({
        frameCount,
        terrainEpoch: ground.terrainEpoch(),
        enriched: enriched?.seatSettle() ?? null,
      }),
      // MESH SUITE MS1 (2026-09-02): read / drive ONE building's edit target without the gizmo.
      // `enrichedSetTransform` takes the SAME commit path as a drag release (engine target +
      // persisted row), so a harness can prove a spatial edit applies, persists and re-applies.
      // cellUri + featureId come from the armed mirror (`__bldgEditStore`).
      enrichedState: (cellUri: string, featureId: number) =>
        enriched?.featureState(cellUri, featureId) ?? null,
      enrichedSetTransform: (cellUri: string, featureId: number, t: FeatureTransform) => {
        commitBldgTransform(cellUri, featureId, t);
        // Keep the armed state's height in step when the seam edits the armed building, so the
        // chip / label read the committed value (the gizmo will do the same at MS2).
        if (bldgArmed && bldgArmed.cellUri === cellUri && bldgArmed.featureId === featureId) {
          const sy = enriched?.featureState(cellUri, featureId)?.target.sy ?? t.sy;
          bldgArmed.liveK = sy;
          bldgArmed.committedK = sy;
        }
        syncBldgEdit();
      },
      // MESH SUITE MS5 (2026-09-02): the world models' residency + seats, and the MODEL gizmo's
      // live state (its own instance; the same handle projection as the building one below).
      userModels: () => userModels.debug(),
      modelGizmo: () => ({
        armed: modelArmed,
        op: modelOp,
        attached: modelGizmo.attached,
        inScene: modelGizmo.inScene, // MS5b §11.4: true exactly while attached
        helperRoot: () => modelGizmo.helperRoot(),
        dragging: modelGizmo.dragging,
        axis: modelGizmo.axis,
        live: modelLive,
        saving: modelSaving,
        saveError: modelSaveError,
        hoverId: modelHoverId,
        // A pick at client px through the SAME gate + ray as the pointer path (diagnostics).
        pickAt: (clientX: number, clientY: number) => pickModelAt(clientX, clientY),
        // MS6: the "stand beside it" one-shot (the orbit click / the MODELS row path).
        standBeside: (id: string) => standBesideModel(id),
        handlePx: (name: string) => modelGizmo.handleScreenPx(name, dom.getBoundingClientRect()),
        originPx: () => modelGizmo.originPx(dom.getBoundingClientRect()),
        // MS8: points along a ROTATE ring (the harness hover-searches the X ring among three).
        ringPx: (name: string, count?: number) => modelGizmo.ringPx(name, dom.getBoundingClientRect(), count),
        // Client px of a resident model's mid-height point (the harness right-clicks it).
        modelPx: (id: string) => {
          const rig = userModels.rig(id);
          if (!rig || !userModels.topWorld(id, _modelTop)) return null;
          const base = rig.anchor.getWorldPosition(new THREE.Vector3());
          const mid = base.lerp(_modelTop, 0.5);
          const vc = mid.clone().applyMatrix4(camera.matrixWorldInverse);
          if (vc.z >= 0) return null;
          const ndc = mid.clone().project(camera);
          const rect = dom.getBoundingClientRect();
          return { x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width, y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height };
        },
      }),
      // MESH SUITE MS2 (2026-09-02): the gizmo's live state + the handles' screen positions, so
      // a harness can drive it with REAL pointer events through the FPV gesture table.
      bldgGizmo: () => {
        const rig = enriched?.ghostRig() ?? null;
        return {
          op: bldgOp,
          attached: bldgGizmo.attached,
          inScene: bldgGizmo.inScene, // MS5b §11.4: true exactly while attached
          helperRoot: () => bldgGizmo.helperRoot(), // MS5b: the harness's positive control
          dragging: bldgGizmo.dragging,
          axis: bldgGizmo.axis,
          live: bldgLive,
          rig: rig ? { liveBaseY: rig.liveBaseY, bodyVisible: rig.body.visible } : null,
          handlePx: (name: string) => bldgGizmo.handleScreenPx(name, dom.getBoundingClientRect()),
          originPx: () => bldgGizmo.originPx(dom.getBoundingClientRect()),
          debug: (clientX?: number, clientY?: number) => {
            if (clientX === undefined || clientY === undefined) return bldgGizmo.debug();
            const [nx, ny] = clientToNdc(clientX, clientY, dom.getBoundingClientRect());
            return bldgGizmo.debug(nx, ny);
          },
        };
      },
      // MESH SUITE MS3 (2026-09-02): force the world fetch / the member push without the UI
      // (the counters + outcome ride `__bldgSyncStore`); `bldgShared()` lists the world rows held.
      bldgSync: {
        fetch: () => bldgFetchShared(),
        sync: () => bldgSyncNow(),
        shared: () => Object.fromEntries(bldgShared),
        local: () => ({ ...bldgOverrideMap }),
      },
      // RC5: what the Esri coverage-sentinel fallback actually did — sentinels seen, how many
      // were replaced by an upscaled ancestor, how many GETs the learned cap table skipped, and
      // how many still drew. `drawn > 0` is the only state that can still show the owner a
      // "Map data not available" tile.
      // RC24: the sky dome's live ULTRA coupling, read off the uniforms the shader samples.
      atmosphereUniforms: () => ({
        uFtwUltraK: atmosphere.uniforms.uFtwUltraK.value as number,
        uFtwUltraHaze: (atmosphere.uniforms.uFtwUltraHaze.value as THREE.Color).getHex(),
        uEclipse: atmosphere.uniforms.uEclipse.value as number,
      }),
      // RC6 / audit measurement M7: how often the nearest terrain hit is NOT the finest one.
      terrainPickStats: () => ground.pickStats(),
      resetTerrainPickStats: () => ground.resetPickStats(),
      // RC11: the exact terrain-height memo's hit rate — the number that says whether the seat
      // budgets are still raycast-bound or have become bookkeeping.
      heightMemoStats: () => ground.heightMemoStats(),
      esriPlaceholder: () => ground.placeholderStats(),
      // …and the probe that runs the SHIPPED wrapper against one real Esri tile, so a browser
      // run can reach the substitution path without depending on the terrain tileset's LOD.
      esriProbe: (z: number, x: number, y: number) => ground.placeholderProbe(z, x, y),
      ground: ground.tiles,
      groundUniforms: ground.uniforms,
      earthUniforms: earth.uniforms,
      frustum,
      flight,
      sky,
      skyTarget,
      findGhosts,
      sunLight,
      // Owner defect 1 — the cascade lights, so a probe can suppress them for an exact A/B
      // ("what the single capped box actually covered") without rebuilding the renderer.
      cascadeLights: shadowCascades,
      bodies: () => ({
        sunDir: sunDirW.toArray(),
        moonDir: moonDirW.toArray(),
        moonIllumination: moonIllum,
        moonKs, // K&S-1991 phase intensity (S5 — 1 = full moon)
        gastRad,
        targetId: lastTargetId,
        targetDir: targetDirW.toArray(),
        targetMag: targetState?.magnitude ?? null,
        targetVisible: skyTarget.mesh.visible,
        sampleMs: lastSampleMs,
      }),
      terrainHeightAt: (lat: number, lon: number) => ground.heightAt(lat, lon),
      // audit #3 (F3 · F4/T36 · A1-16): the radar seam's RESOLVED state. `anchor*` is the one
      // shared ladder's output — a verify script must read it, never re-derive it.
      // `skylineClaimed` is the one gap gate's output, `coverage` the evidence behind it, and
      // `focalGeoIds` the focal cone's BufferGeometry identities: stable across an aim-stick
      // sweep is the proof that the per-frame dispose+realloc (T38) is gone.
      aim: () => ({
        anchorLatDeg: lastAimAnchor?.latDeg ?? null,
        anchorLonDeg: lastAimAnchor?.lonDeg ?? null,
        skylineClaimed: lastAimSkyline !== null,
        coverage: usePlanStore.getState().profileCoverage,
        minCoverage: PLAN.minCoverageForGaps,
        focalGeoIds: focalCone.group.children.map((c) =>
          c instanceof THREE.Mesh ? c.geometry.uuid : null,
        ),
        shadowAutoUpdate: renderer.shadowMap.autoUpdate,
      }),
      alt: () => WGS84_ELLIPSOID.getPositionElevation(camera.position),
      fpv: () => ({
        active: fpvActive,
        kind: fpvKind,
        yawDeg: THREE.MathUtils.radToDeg(fpvYaw),
        pitchDeg: THREE.MathUtils.radToDeg(fpvPitch),
        fovDeg: camera.fov,
        fovTargetDeg,
        liftM: fpvLiftM,
        eyeM: fpvEyeM,
        eyeAboveGroundM: fpvEyeAboveGroundM,
        // RC10 — the walk re-seat's own numbers: the ground found under the walked eye, and the
        // eased correction currently applied to it. Both null while standing on the pin.
        walkGroundM: fpvWalkGroundM,
        walkAppliedM: fpvWalkAppliedM,
        walkOffsetM: +fpvWalkOffset.length().toFixed(2),
        controlsEnabled: controls.enabled,
      }),
      dayArcs,
      plan: () => planFeed.debug(),
      // BEST SPOT §5.6 — the hot-swap seam. READ half: everything a verify script needs, out of
      // the LIVE engine, never recomputed (the `__globe.ultraLook` lesson).
      bestSpot: () => bestSpotFeed.debug(),
      /**
       * §7 S4's done-check surface — the LIVE material, textures, per-child `renderOrder` and the
       * veil ceiling, read off the objects three is drawing with. It exists because `window.__globe`
       * exposes no `scene`, so nothing in `scripts/**` could reach the sheet at all and every S4
       * assertion was being made in vitest against a constructor argument (the `__globe.ultraLook`
       * lesson: a material contract asserted against the arguments that built it is not the shipped
       * state).
       */
      bestSpotSheet: () => bestSpotSheet.debug(),
      /**
       * The PUBLISHED field pack — the same object the GL sheet uploads, never a copy and never a
       * recomputation (the `__globe.ultraLook` lesson again).
       *
       * It exists for exactly one reason: S7's done-check is stated as *"the fraction of cells with
       * S > 0.6 is < 0.05"*, and nothing in the store carries a score DISTRIBUTION — the census
       * counts render classes, not brightness. A verify script that recomputed `S` in page would be
       * measuring its own arithmetic, so it reads `.r` off the texture the sheet is actually
       * sampling and de-quantises with the `displayLo`/`displayHi` the pack itself echoes.
       */
      bestSpotField: () => bestSpotFeed.field(),
      // …and the MUTATING half. Flow, in this exact order: sanitizeScoringPatch (clamps §5.5,
      // drops unknown keys, warns on refused) → deep-merge onto the CURRENT patch →
      // store.setScoring (resolves, bumps scoringEpoch, persists the PATCH — never the resolved
      // profile) → stepBestSpotFeed sees the epoch move → scoringInvalidation decides whether that
      // is a 0.272 ms recompose or a 490 ms rebuild.
      bestSpotTuning,
      tempPin: () => ({
        pin: useCameraStore.getState().tempPin,
        groundM: tempPinGroundM,
        markerVisible: tempPinMarker.visible,
      }),
      explore: () => ({
        active: useCameraStore.getState().exploreActive,
        state: explore.state(),
        legs: explore.legsFlown(),
      }),
      // U1 (/m 2D map): mode + the buildings gate's rendered truth (group membership, not a flag).
      map2d: () => ({
        isMobileShell,
        mode: useCameraStore.getState().mapMode,
        buildingsAttached: buildings.tiles.group.parent !== null,
        enrichedAttached: enriched ? enriched.tiles.group.parent !== null : null,
      }),
      // U2 (FPV stability): the live discriminator state for every point-6 mechanism — the zoom
      // bank (A2), eased vs raw pin ground (A4), the street-floor memory (A7), the enriched seat
      // epoch (A5), LRU min/max per renderer (A9) and the single-frame eye-jump ring (soak gate).
      u2: () => ({
        zoomBank: { pendingZoom, zoomDelta: zc.zoomDelta as number },
        tempPinGround: { rawM: tempPinGroundM, appliedM: tempPinAppliedM },
        lastGroundM,
        enrichedSeat: enriched?.seatState() ?? null,
        lru: {
          buildings: {
            min: buildings.tiles.lruCache.minBytesSize,
            max: buildings.tiles.lruCache.maxBytesSize,
          },
          ground: {
            min: ground.tiles.lruCache.minBytesSize,
            max: ground.tiles.lruCache.maxBytesSize,
            // RC20/T34: the resting level itself. `cached === min` IS the defect — the charter's
            // proof-of-done is literally "the cache no longer rests at exactly minBytesSize", and
            // until now no probe published the number that sentence is about.
            // Cast: 0.4.28 ships both fields at runtime (`LRUCache.js` assigns `this.itemSet`
            // and `this.cachedBytes` in the constructor) but its `.d.ts` declares only the two
            // *BytesSize knobs. DEV probe only — nothing in the render path reads these.
            cached: (ground.tiles.lruCache as unknown as { cachedBytes: number }).cachedBytes,
            items: (ground.tiles.lruCache as unknown as { itemSet: Map<unknown, unknown> }).itemSet
              .size,
            bankMsLeft: groundBankMsLeft,
          },
          enriched: enriched
            ? {
                min: enriched.tiles.lruCache.minBytesSize,
                max: enriched.tiles.lruCache.maxBytesSize,
              }
            : null,
        },
        jumps: u2Jumps.slice(),
        jumpsTotal: u2JumpsTotal,
      }),
      // U5 (closest-first loading): the live streaming discriminator — loadAncestors flags, the
      // FPV aim state, per-renderer queue depth/concurrency (untyped library internals, hence
      // the narrow cast) + download→model latency snapshots. u5Mark() opens a time-to-first
      // window (mark → teleport → read lat.*.firstAfterMarkMs).
      u5: () => {
        const qSnap = (t: unknown) => {
          const r = t as {
            loadAncestors: boolean;
            downloadQueue: { maxJobs: number; items?: unknown[]; currJobs?: number };
            parseQueue: { maxJobs: number; items?: unknown[]; currJobs?: number };
            stats?: Record<string, number>;
          };
          return {
            loadAncestors: r.loadAncestors,
            dl: {
              len: r.downloadQueue.items?.length ?? 0,
              jobs: r.downloadQueue.currJobs ?? 0,
              maxJobs: r.downloadQueue.maxJobs,
            },
            parse: {
              len: r.parseQueue.items?.length ?? 0,
              jobs: r.parseQueue.currJobs ?? 0,
              maxJobs: r.parseQueue.maxJobs,
            },
            stats: {
              queued: r.stats?.queued ?? 0,
              downloading: r.stats?.downloading ?? 0,
              parsing: r.stats?.parsing ?? 0,
              inCache: r.stats?.inCache ?? 0,
              visible: r.stats?.visible ?? 0,
            },
          };
        };
        return {
          aim: { active: loadAim.active, k: loadAim.k, epoch: loadAim.epoch },
          buildings: qSnap(buildings.tiles),
          ground: qSnap(ground.tiles),
          enriched: enriched ? qSnap(enriched.tiles) : null,
          lat: {
            buildings: loadProbes.buildings.snapshot(),
            ground: loadProbes.ground.snapshot(),
            enriched: loadProbes.enriched?.snapshot() ?? null,
          },
        };
      },
      u5Mark: () => {
        loadProbes.buildings.mark();
        loadProbes.ground.mark();
        loadProbes.enriched?.mark();
      },
      u6: () => ({
        // U6 foveation probe: engaged = regions live on that renderer NOW (FPV + tier cfg);
        // baseErrorTarget shows the periphery relax on buildings/enriched (ground never relaxes).
        fpvMirror: foveaOn,
        buildings: buildings.foveaSnapshot(),
        enriched: enriched?.foveaSnapshot() ?? null,
        ground: ground.foveaSnapshot(),
      }),
      // ULTRA HQ (owner 2026-08-22h). `allowed` is the shell gate and `pref` the RAW store flag —
      // printing both is the point: on /m with a desktop-set pref this reads
      // `{allowed:false, pref:true, on:false}`, which is the mobile-fence proof in one line.
      ultra: () => ({
        allowed: hqAllowed,
        coarsePointer: coarsePointerShell,
        pref: useCameraStore.getState().ultraQuality === true,
        on: ultraOn,
      }),
      // ULTRA LOOK probe (T44 §1a/§1b + T45 S3/S4/S5/S9/S10/S11, 2026-08-22j) — the ONE seam that
      // makes this track verifiable. Every lever it reports is otherwise unreachable from a
      // harness: the lights live in GlobeCanvas's closure, the shadow rig on a light three
      // mutates internally, and the ground's ULTRA uniforms behind an attach closure.
      //
      // It exists because the OFF-state claim ("with the chip off, nothing here is read") is only
      // worth as much as its proof, and the honest proof is EXACT ZEROS read out of the live
      // engine — not a screenshot that looks the same. `hemiPos` is reported because audit gap
      // #16 is invisible in every other way: three derives a HemisphereLight's direction from its
      // world position, so [0,1,0] IS the bug and a focus-tracking unit vector IS the fix.
      // ECLIPSE (2026-08-22k). Reported from the LIVE engine, never re-derived: the whole class
      // of bug this feature exists to fix is a geometry that disagrees with the pixels, so a
      // verify script that recomputed the ephemeris could pass while the screen showed nothing.
      // `moonOff`/`moonR` are what the sun's fragment actually reads, in sun-disc radii — if the
      // silhouette is not where the picture shows it, these two are why.
      eclipse: () => ({
        phase: solarEcl.phase,
        coverage: solarEcl.coverage,
        magnitude: solarEcl.magnitude,
        sepDeg: THREE.MathUtils.radToDeg(solarEcl.sepRad),
        sunRadDeg: THREE.MathUtils.radToDeg(solarEcl.sunRadRad),
        moonRadDeg: THREE.MathUtils.radToDeg(solarEcl.moonRadRad),
        daylightK: eclipseK,
        moonOff: (sky.sunMesh.material as THREE.ShaderMaterial).uniforms.uMoonOff.value.toArray(),
        moonR: (sky.sunMesh.material as THREE.ShaderMaterial).uniforms.uMoonR.value,
        sunUEclipse: (sky.sunMesh.material as THREE.ShaderMaterial).uniforms.uEclipse.value,
        moonDaySky: (sky.moonMesh.material as THREE.ShaderMaterial).uniforms.uDaySky.value,
        groundEclipse: ground.uniforms.uFtwEclipse.value,
        skyEclipse: atmosphere.uniforms.uEclipse.value,
        keyIntensity: sunLight ? sunLight.intensity : null,
        lunar: {
          phase: lunarEcl.phase,
          umbralCoverage: lunarEcl.umbralCoverage,
          umbralMag: lunarEcl.umbralMag,
          penumbralMag: lunarEcl.penumbralMag,
          umbraOn: (sky.moonMesh.material as THREE.ShaderMaterial).uniforms.uUmbraOn.value,
          umbraOff: (
            sky.moonMesh.material as THREE.ShaderMaterial
          ).uniforms.uUmbraOff.value.toArray(),
          umbraR: (sky.moonMesh.material as THREE.ShaderMaterial).uniforms.uUmbraR.value,
          penumbraR: (sky.moonMesh.material as THREE.ShaderMaterial).uniforms.uPenumbraR.value,
          moonKs,
        },
      }),
      ultraLook: () => ({
        on: ultraOn,
        // ground (T44 §1a + S9 + S4) — these four are the off-state proof
        photo3d: ground.uniforms.uFtwPhoto3d.value,
        dayMix: ground.uniforms.uFtwUltraLight.value,
        haze: ground.uniforms.uFtwHaze.value,
        hazeCol: (ground.uniforms.uFtwHazeCol.value as THREE.Color).getHex(),
        // DUSK (owner defect 2, 2026-08-27) — read off the LIVE uniforms and the LIVE key, never
        // re-derived, because the defect being fixed was precisely a light model whose numbers and
        // whose pixels disagreed. `skyLevel` is the one that has to fall with the sun; `keyLevel`
        // is the key's measured intensity as a fraction of its own nominal, so "the sun is still
        // too bright below 3-4°" becomes a number instead of an argument.
        dusk: {
          skyLevel: ground.uniforms.uFtwSkyLevel.value as number,
          directK: ground.uniforms.uFtwDirectK.value as number,
          afterglow: atmosphere.uniforms.uFtwAfterglow.value as number,
          hazeCool: (ground.uniforms.uFtwHazeCool.value as THREE.Color).getHex(),
          keyLevel: sunLight ? sunLight.intensity / SUN.keyIntensity : null,
          keyCol: sunLight ? sunLight.color.getHex() : null,
          sunDiscExtinct: (sky.sunMesh.material as THREE.ShaderMaterial).uniforms.uExtinct.value,
          domeSkyLevel: atmosphere.uniforms.uFtwSkyLevel.value as number,
        },
        // S11 exposure — live-written, so a stale value here means the step stopped running
        exposure: renderer.toneMappingExposure,
        // S10 hemisphere (audit gap #16)
        hemiPos: hemiLight ? hemiLight.position.toArray() : null,
        hemiIntensity: hemiLight ? hemiLight.intensity : null,
        hemiSky: hemiLight ? hemiLight.color.getHex() : null,
        // S5 + S2 + S3 shadow rig. `bias` is reported alongside near/far ON PURPOSE: its unit is
        // a FRACTION of that range, so the number is meaningless without them.
        shadow: sunLight
          ? {
              mapPx: sunLight.shadow.mapSize.x,
              radius: sunLight.shadow.radius,
              bias: sunLight.shadow.bias,
              normalBias: sunLight.shadow.normalBias,
              boundsM: sunLight.shadow.camera.right,
              near: sunLight.shadow.camera.near,
              far: sunLight.shadow.camera.far,
              casting: sunLight.castShadow,
              biasMetres: -sunLight.shadow.bias * (sunLight.shadow.camera.far - sunLight.shadow.camera.near),
              // RC4 view fit. `focusOffsetM` is the distance from the EYE'S GROUND POINT to the
              // box centre — 0 at nadir, ~d/2 when the box holds the whole look, and pinned at
              // `boundsM − boundsM/2` once the cap bites. `metresPerTexel` is the price paid:
              // the crispness trade this slice makes is meant to be read, not assumed.
              viewFitM: shadowViewFitM,
              focusOffsetM: _shadowFocus.distanceTo(_eyeGround),
              metresPerTexel:
                (2 * sunLight.shadow.camera.right) / Math.max(1, sunLight.shadow.mapSize.x),
            }
          : null,
        // THE CASCADE LADDER (owner defect 1, 2026-08-27) — read off the LIVE lights, never off
        // the fit that produced them, because the whole failure this fixes was a rig whose numbers
        // and whose pixels disagreed. `reachM` is the headline: `boundsM + focusOffset` for
        // cascade 0 and `halfExtentM` for the rest, so `coverM` vs `viewFitM` is the one ratio
        // that says whether the frame is fully shadowed. `stale` counts frames since a cascade's
        // map was last re-rendered — a number that only ever climbs would mean the refresh policy
        // has stopped firing, which is invisible in a screenshot until you turn the camera.
        cascades: shadowCascades.map((cl, i) => ({
          casting: cl.castShadow,
          active: _cascadeState[i].active,
          mapPx: cl.shadow.mapSize.x,
          boundsM: cl.shadow.camera.right,
          near: cl.shadow.camera.near,
          far: cl.shadow.camera.far,
          radius: cl.shadow.radius,
          intensity: cl.shadow.intensity,
          normalBias: cl.shadow.normalBias,
          biasMetres: _cascadeState[i].biasM,
          metresPerTexel: _cascadeState[i].metresPerTexel,
          // The one property that must hold for the ladder to compose: a cascade may never light
          // anything. `intensity` 0 makes three's `uniforms.color` exactly black.
          lightIntensity: cl.intensity,
          ageMs: _cascadeState[i].lastMs > 0 ? performance.now() - _cascadeState[i].lastMs : null,
        })),
        /** Furthest ground distance (m) any live box reaches — against `shadow.viewFitM`. */
        shadowCoverM: (() => {
          let cover = sunLight
            ? sunLight.shadow.camera.right + _shadowFocus.distanceTo(_eyeGround)
            : 0;
          for (let i = 0; i < shadowCascades.length; i++) {
            if (shadowCascades[i].castShadow && _cascadeState[i].active) {
              cover = Math.max(cover, _cascadeState[i].halfExtentM);
            }
          }
          return cover;
        })(),
        // S3 terrain casts — counted off the LIVE scene graph rather than off our own flag, so
        // the `shadowSide` trap (which fails silently and casts nothing) cannot pass this.
        // (Shared with the DEBUG HUD's on-demand action — extracted above the DEV block.)
        terrain: terrainCastCensus(),
        // §1b anisotropy — sampled off the LIVE composite textures the shader is sampling, not
        // off the value we asked for. Walks the overlay plugin's own maps (overlays → tileInfo →
        // target); a `null` here means the reach broke, which is itself the finding.
        // (Shared with the DEBUG HUD's on-demand action — extracted above the DEV block.)
        aniso: anisoCensus(),
      }),
      pins,
    };
    window.__timeStore = useTimeStore; // scrub scene time from the console / Playwright
    window.__cameraStore = useCameraStore; // drive/read the tilt glide from Playwright
  }

  // Per-frame update() error throttle (B26): a persistent error must not flood the console at
  // 60 fps — log the first, then at most once per ORCH.errorLogThrottleMs with a rolling count.
  let updateErrCount = 0;
  let lastUpdateErrLogMs = -Infinity;

  // ---- DEBUG HUD (owner 2026-09-01) ----------------------------------------------------------
  // The runtime-gated twin of the DEV `window.__globe` block above: NOT DEV-gated (the ULT
  // precedent — compiled everywhere, read only while the DBG chip is on), registered with
  // lib/globe/debugFeed and polled by DebugPanel at ≤4 Hz. Snapshots are FLAT (one key = one
  // metric row in the panel; display metadata lives in lib/globe/debugCatalog). Cheap field
  // reads only — the scene walks are the ACTIONS at the bottom. Cumulative counters here are
  // differenced into rates panel-side; never "fixed" to deltas at the source.
  const dbgUnregs: Array<() => void> = [];
  {
    // Per-renderer queue/stats/LRU snapshot, flattened under a prefix. Same narrow casts as the
    // DEV u5()/u2() probes: 0.4.28 ships these fields at runtime but declares few of them.
    const tilesSnap = (out: DebugSnapshot, p: string, t: unknown) => {
      const r = t as {
        downloadQueue: { maxJobs: number; items?: unknown[]; currJobs?: number; autoUpdate?: boolean };
        parseQueue: { maxJobs: number; items?: unknown[]; currJobs?: number; autoUpdate?: boolean };
        stats?: Record<string, number>;
        loadProgress?: number;
        lruCache: {
          minBytesSize: number;
          maxBytesSize: number;
          cachedBytes?: number;
          itemSet?: Map<unknown, unknown>;
        };
      };
      out[`${p}.dlLen`] = r.downloadQueue.items?.length ?? 0;
      out[`${p}.dlJobs`] = r.downloadQueue.currJobs ?? 0;
      out[`${p}.dlMax`] = r.downloadQueue.maxJobs;
      out[`${p}.parseLen`] = r.parseQueue.items?.length ?? 0;
      out[`${p}.parseJobs`] = r.parseQueue.currJobs ?? 0;
      out[`${p}.parseMax`] = r.parseQueue.maxJobs;
      out[`${p}.frozen`] = r.downloadQueue.autoUpdate === false;
      out[`${p}.queued`] = r.stats?.queued ?? 0;
      out[`${p}.downloading`] = r.stats?.downloading ?? 0;
      out[`${p}.parsing`] = r.stats?.parsing ?? 0;
      out[`${p}.inCache`] = r.stats?.inCache ?? 0;
      out[`${p}.visible`] = r.stats?.visible ?? 0;
      out[`${p}.used`] = r.stats?.used ?? 0;
      out[`${p}.inFrustum`] = r.stats?.inFrustum ?? 0;
      out[`${p}.failed`] = r.stats?.failed ?? 0;
      out[`${p}.progress`] = r.loadProgress ?? null;
      out[`${p}.lruMB`] = r.lruCache.cachedBytes != null ? r.lruCache.cachedBytes / 1048576 : null;
      out[`${p}.lruMinMB`] = r.lruCache.minBytesSize / 1048576;
      out[`${p}.lruMaxMB`] = r.lruCache.maxBytesSize / 1048576;
      out[`${p}.lruItems`] = r.lruCache.itemSet?.size ?? null;
    };
    // The imagery-composite reach (overlay plugin → overlayInfo → tileInfo): live composite
    // count + the Esri source-z span the level chooser is resolving to. `null`s mean the reach
    // broke — reported, never thrown (the esriPlaceholder rule).
    const imageryReach = (out: DebugSnapshot) => {
      const plugins = (ground.tiles as unknown as { plugins?: unknown[] }).plugins ?? [];
      const plug = plugins.find(
        (p) => (p as { overlayInfo?: unknown }).overlayInfo instanceof Map,
      ) as
        | {
            overlayInfo: Map<
              { calculateLevel?: (range: number[]) => number },
              { tileInfo: Map<unknown, { range?: number[] | null; target?: unknown }> }
            >;
            processQueue?: { items?: unknown[]; currJobs?: number; maxJobs?: number };
          }
        | undefined;
      if (!plug) {
        out["img.composites"] = null;
        return;
      }
      let composites = 0;
      let zMin = Infinity;
      let zMax = -Infinity;
      plug.overlayInfo.forEach(({ tileInfo }, overlay) => {
        tileInfo.forEach((info) => {
          if (!info.target) return;
          composites++;
          if (info.range && typeof overlay.calculateLevel === "function") {
            const z = overlay.calculateLevel(info.range);
            if (Number.isFinite(z)) {
              if (z < zMin) zMin = z;
              if (z > zMax) zMax = z;
            }
          }
        });
      });
      out["img.composites"] = composites;
      out["img.zMin"] = Number.isFinite(zMin) ? zMin : null;
      out["img.zMax"] = Number.isFinite(zMax) ? zMax : null;
      // The 10th queue — the overlay compositor's own PriorityQueue (maxJobs 10), which the
      // visibilitychange freeze does NOT cover (it lives on the plugin, not the renderer).
      out["img.queueLen"] = plug.processQueue?.items?.length ?? null;
      out["img.queueJobs"] = plug.processQueue?.currJobs ?? null;
    };
    dbgUnregs.push(
      registerDebugProvider("tiles", () => {
        const out: DebugSnapshot = {};
        tilesSnap(out, "bld", buildings.tiles);
        tilesSnap(out, "gnd", ground.tiles);
        if (enriched) tilesSnap(out, "enr", enriched.tiles);
        out["aim.active"] = loadAim.active;
        out["aim.k"] = loadAim.k;
        out["lat.bldMeanMs"] = loadProbes.buildings.snapshot().meanMs;
        out["lat.gndMeanMs"] = loadProbes.ground.snapshot().meanMs;
        out["lat.enrMeanMs"] = loadProbes.enriched?.snapshot().meanMs ?? null;
        out["lat.pending"] =
          loadProbes.buildings.snapshot().pending +
          loadProbes.ground.snapshot().pending +
          (loadProbes.enriched?.snapshot().pending ?? 0);
        out["fovea.on"] = foveaOn;
        out["fovea.bld"] = buildings.foveaSnapshot().engaged;
        out["fovea.gnd"] = ground.foveaSnapshot().engaged;
        out["gnd.bankMsLeft"] = groundBankMsLeft;
        imageryReach(out);
        return out;
      }),
      registerDebugProvider("ultra", () => ({
        on: ultraOn,
        allowed: hqAllowed,
        settled: ultraLookSettled,
        sunElevDeg: THREE.MathUtils.radToDeg(
          Math.asin(THREE.MathUtils.clamp(sunDirW.dot(_focusUp), -1, 1)),
        ),
        exposure: renderer.toneMappingExposure,
        keyLevel: sunLight ? sunLight.intensity / SUN.keyIntensity : null,
        directK: ultraDirectK,
        skyLevel: ultraSkyLevel,
        afterglow: ultraAfterglow,
        haze: ground.uniforms.uFtwHaze.value as number,
        photo3d: ground.uniforms.uFtwPhoto3d.value as number,
        dayMix: ground.uniforms.uFtwUltraLight.value as number,
        dark: ground.uniforms.uFtwDark.value as number,
        fade: ground.uniforms.uFtwFade.value as number,
        "shadow.casting": sunLight ? sunLight.castShadow : null,
        "shadow.mapPx": sunLight ? sunLight.shadow.mapSize.x : null,
        "shadow.radius": sunLight ? sunLight.shadow.radius : null,
        "shadow.boundsM": sunLight ? sunLight.shadow.camera.right : null,
        "shadow.mPerTexel": sunLight
          ? (2 * sunLight.shadow.camera.right) / Math.max(1, sunLight.shadow.mapSize.x)
          : null,
        "shadow.viewFitM": shadowViewFitM,
        "shadow.coverM": (() => {
          let cover = sunLight
            ? sunLight.shadow.camera.right + _shadowFocus.distanceTo(_eyeGround)
            : 0;
          for (let i = 0; i < shadowCascades.length; i++) {
            if (shadowCascades[i].castShadow && _cascadeState[i].active) {
              cover = Math.max(cover, _cascadeState[i].halfExtentM);
            }
          }
          return cover;
        })(),
        "cas1.active": _cascadeState[0]?.active ?? null,
        "cas1.mPerTexel": _cascadeState[0]?.metresPerTexel ?? null,
        "cas1.ageMs":
          _cascadeState[0] && _cascadeState[0].lastMs > 0
            ? performance.now() - _cascadeState[0].lastMs
            : null,
        "cas2.active": _cascadeState[1]?.active ?? null,
        "cas2.mPerTexel": _cascadeState[1]?.metresPerTexel ?? null,
        "cas2.ageMs":
          _cascadeState[1] && _cascadeState[1].lastMs > 0
            ? performance.now() - _cascadeState[1].lastMs
            : null,
      })),
      registerDebugProvider("astro", () => ({
        sampleAgeMs: Number.isFinite(lastSampleMs)
          ? Math.abs(sceneTimeMs() - lastSampleMs)
          : null,
        sunElevDeg: THREE.MathUtils.radToDeg(
          Math.asin(THREE.MathUtils.clamp(sunDirW.dot(_focusUp), -1, 1)),
        ),
        moonElevDeg: THREE.MathUtils.radToDeg(
          Math.asin(THREE.MathUtils.clamp(moonDirW.dot(_focusUp), -1, 1)),
        ),
        moonIllum,
        moonKs,
        gastDeg: THREE.MathUtils.radToDeg(gastRad),
        targetId: lastTargetId,
        targetMag: targetState?.magnitude ?? null,
        targetVisible: skyTarget.mesh.visible,
        "ecl.phase": solarEcl.phase,
        "ecl.coverage": solarEcl.coverage,
        "ecl.magnitude": solarEcl.magnitude,
        "ecl.sepDeg": THREE.MathUtils.radToDeg(solarEcl.sepRad),
        "ecl.daylightK": eclipseK,
        "lun.phase": lunarEcl.phase,
        "lun.umbralMag": lunarEcl.umbralMag,
        "lun.penumbralMag": lunarEcl.penumbralMag,
      })),
      registerDebugProvider("camera", () => ({
        altM: WGS84_ELLIPSOID.getPositionElevation(camera.position),
        nearM: camera.near,
        farM: camera.far,
        fovDeg: camera.fov,
        controlsEnabled: controls.enabled,
        flightActive: flight.active(),
        exploreState: explore.state(),
        exploreLegs: explore.legsFlown(),
        "fpv.active": fpvActive,
        "fpv.kind": fpvKind,
        "fpv.yawDeg": THREE.MathUtils.radToDeg(fpvYaw),
        "fpv.pitchDeg": THREE.MathUtils.radToDeg(fpvPitch),
        "fpv.eyeM": fpvEyeM,
        "fpv.eyeAboveGroundM": fpvEyeAboveGroundM,
        "fpv.walkOffsetM": +fpvWalkOffset.length().toFixed(2),
        frameCount,
        updateErrors: updateErrCount,
      })),
      registerDebugProvider("terrain", () => {
        const memo = ground.heightMemoStats();
        const pick = ground.pickStats();
        const ph = ground.placeholderStats();
        return {
          epoch: ground.terrainEpoch(),
          overlayRebuilds: ground.overlayRebuilds(),
          overlayPxEff,
          "memo.hits": memo.hits,
          "memo.misses": memo.misses,
          "memo.entries": memo.entries,
          "memo.invalidations": memo.invalidations,
          "memo.overflows": memo.overflows,
          "pick.samples": pick.samples,
          "pick.parentWinRate": pick.parentWinRate,
          "esri.sentinels": ph?.sentinels ?? null,
          "esri.substituted": ph?.substituted ?? null,
          "esri.drawn": ph?.drawn ?? null,
          patchRewrites: terrainPatchStats().rewrites,
        };
      }),
      registerDebugProvider("models", () => {
        // MESH SUITE MS5: the user-model residency — resident/loading/skipped are the density
        // story (skipped = refused by the triangle budget inside the load radius).
        const c = userModels.counts();
        const st = useUserModelsStore.getState();
        return {
          world: c.world,
          resident: c.resident,
          loading: c.loading,
          skipped: c.skipped,
          tris: c.tris,
          failed: c.failed,
          warn: c.warn,
          visible: c.visible,
          cover: st.cover?.length ?? 0,
          phase: st.worldPhase,
          mine: st.mine.length,
        };
      }),
      registerDebugProvider("buildings", () => {
        const c = enriched?.debugCounts() ?? null;
        const s = enriched?.seatState() ?? null;
        return {
          attached: buildings.tiles.group.parent !== null,
          enrichedAttached: enriched ? enriched.tiles.group.parent !== null : null,
          cells: c?.cells ?? null,
          priorityCells: c?.priorityCells ?? null,
          deferred: c?.deferred ?? null,
          rejected: c?.rejected ?? null,
          seatCacheHits: c?.seatCacheHits ?? null,
          seatCacheMisses: c?.seatCacheMisses ?? null,
          seatEpoch: s?.epoch ?? null,
          seatQuietFrames: s?.quietFrames ?? null,
        };
      }),
      registerDebugProvider("vector", () => {
        let parsed = 0;
        let pending = 0;
        let failed = 0;
        vtiles.tiles().forEach((v) => {
          if (v === "pending") pending++;
          else if (v === "failed") failed++;
          else parsed++;
        });
        const labels = streetNames.census();
        return {
          "mvt.parsed": parsed,
          "mvt.pending": pending,
          "mvt.failed": failed,
          "mvt.version": vtiles.version(),
          "labels.entries": labels.entries,
          "labels.dying": labels.dying,
          "labels.budget": labels.budget,
        };
      }),
      registerDebugProvider("planning", () => {
        const p = planFeed.debug();
        const bs = bestSpotFeed.debug();
        return {
          anchorKind: p.anchorKind,
          building: p.building,
          coverage: p.coverage,
          terrainBin: p.terrainBin,
          azBins: p.azBins,
          meshIdx: p.meshIdx,
          meshCount: p.meshCount,
          scanAgeMs: p.scanAgeMs,
          "bs.spawned": bs.workerSpawned,
          "bs.inFlight": bs.inFlight,
          "bs.jobs": bs.jobs,
          "bs.drops": bs.drops,
          "bs.firstInkMs": bs.timings.firstInkMs,
          "bs.refinedMs": bs.timings.refinedMs,
          "bs.ladderRung": bs.ladderRung,
          // Store-side worker flags served from HERE, not from DebugPanel: store/bestSpot is
          // VALUE-import-fenced to the seam's owners (fences.test.ts) and this file is one.
          "bs.solving": useBestSpotStore.getState().solving,
          "bs.tilesPending": useBestSpotStore.getState().tilesPending,
        };
      }),
      registerDebugAction("buildings.seats", () =>
        enriched ? enriched.debugSeats() : { error: "no enriched tileset attached" },
      ),
      registerDebugAction("ultra.terrainCensus", () => terrainCastCensus()),
      registerDebugAction(
        "ultra.anisoCensus",
        () => anisoCensus() ?? { error: "overlay plugin reach broke" },
      ),
    );
  }

  const stepFrameTiming = () => {
        now = performance.now();
        dtMs = Math.min(now - lastFrameMs, ORCH.maxFrameDtMs);
        lastFrameMs = now;

  };

  const stepZoomBrakeAndEase = () => {
        // Zoom braking near the ground: the library step is already ∝ distance-to-surface, but
        // the last kilometres still read fast — shrink the effective speed below zoomSlowAltM.
        // The flat MAP mostly stands down (owner 2026-08-18 "speed up the 2D map"; 18e: desktop
        // nadir too): the brake was tuned for the cinematic 3D dive, and on a flat chart it
        // read as pinch/wheel mud.
        const zoomSlowFloor = flatGroundNow() ? MOBILE2D.zoomSlowFrac : CONTROLS.zoomSlowFrac;
        controls.zoomSpeed =
          CONTROLS.zoomSpeed *
          THREE.MathUtils.lerp(
            zoomSlowFloor,
            1,
            THREE.MathUtils.smoothstep(lastAlt, 0, CONTROLS.zoomSlowAltM),
          );

        // Temporal zoom easing: bank the accumulated wheel/pinch delta and hand the controls an
        // exp-eased slice each frame — gradual, settling movement instead of one-frame steps.
        if (CONTROLS.zoomSmoothTauMs > 0) {
          pendingZoom += zc.zoomDelta;
          const kz = 1 - Math.exp(-dtMs / CONTROLS.zoomSmoothTauMs);
          let step = pendingZoom * kz;
          if (Math.abs(pendingZoom - step) < 1e-3) step = pendingZoom; // snap the tail
          zc.zoomDelta = step;
          pendingZoom -= step;
        }
        zoomStep = zc.zoomDelta as number;
        _upBefore.copy(zc.up);

  };

  // U2/A1: does THIS frame's stepFpvTransitions (which runs AFTER controls.update) enter FPV?
  // The controls flip to disabled one step too late otherwise: the entry frame's controls.update
  // still runs ENABLED and discharges banked zoom/drag into the camera — moving the pose the
  // entry math is about to capture, BEFORE the entry code can zero the bank. Same store reads the
  // transition step derives wantKind from (stores can't change mid-update — sync), plus the
  // fpvJumpRequest one-shot (its store writes land inside the transition step itself).
  const fpvEntryPending = (): boolean => {
    if (fpvActive) return false; // already in FPV → controls disabled, update() self-gates
    const up = useUploadStore.getState();
    const cam = useCameraStore.getState();
    return (
      up.viewMode === "fpv" || (cam.tempFpv && cam.tempPin !== null) || cam.fpvJumpRequest !== null
    );
  };

  const stepControlsUpdate = () => {
        if (fpvEntryPending()) return; // U2/A1: never let controls move the camera on the entry frame
        controls.update();

  };

  const stepDampedVerticality = () => {
        // Damped auto-verticality: counter-rotate the unwanted fraction of the library's
        // "walk the camera overhead" rotation (zoom-in only — zoom-out keeps its own tilt
        // handling, incl. _tiltTowardsCenter at high altitude).
        if (zoomStep > 0 && CONTROLS.zoomTiltKeep < 1 && _upBefore.angleTo(zc.up) > 1e-9) {
          _qFull.setFromUnitVectors(_upBefore, zc.up);
          _qCounter.identity().slerp(_qFull.invert(), 1 - CONTROLS.zoomTiltKeep);
          controls.getPivotPoint(_pivot);
          camera.position.sub(_pivot).applyQuaternion(_qCounter).add(_pivot);
          camera.quaternion.premultiply(_qCounter);
          camera.up.applyQuaternion(_qCounter);
        }

        camera.updateMatrixWorld();
  };

  const stepMobileBuildingsGate = () => {
        // 3D-buildings gate, BOTH shells (owner rule 2026-08-18 folded into the U1 gate): the
        // user's BLD / ▦ 3D DETAIL on/off (store `buildings3d`) composes with the /m 2D map
        // auto-detach (U1: buildings exist only in 3D — and in ANY FPV, whose entry needs the
        // streets it stands in regardless of the map mode at entry). The handles' own identity
        // guards make the per-frame call a no-op while nothing changed, so no separate gate
        // state can ever drift from the truth. Desktop with the default pref ON: `on` is always
        // true — byte-identical to the pre-rule behaviour (frozen-additive).
        const cam = useCameraStore.getState();
        const shellOn = !isMobileShell || fpvActive || cam.mapMode === "3d";
        const on = shellOn && cam.buildings3d;
        buildings.setActive(on);
        enriched?.setActive(on);
        if (!on) disarmBuilding(); // U8: BLD off detaches the renderer — the edit session ends
  };

  const stepBuildingsUpdate = () => {
        buildings.update();

  };

  const stepEnrichedUpdate = () => {
        // Dnipro 3D enrichment (Slice 0): stream the enriched tileset + R1 re-seat to the rendered
        // terrain. No-op when PUBLIC_ENRICHED_TILES_URL is unset (enriched === null).
        enriched?.update();

  };

  const stepFlightUpdate = () => {
        // Cinematic flight overrides the pose after controls (the drift pattern); an active
        // flight counts as interaction so the drift stays paused through it + resumeMs after.
        if (flight.update(now)) lastInteract = now;

  };

  const stepExploreJourney = () => {
        // Explore ambient journey (Phase 5.5 S4): competing steering (encoder deflection,
        // slider glides, FPV entry) exits the mode — the store flag then drives the
        // controller, which owns the camera while cruising/dwelling (drift stands down).
        {
          const camS = useCameraStore.getState();
          if (
            camS.exploreActive &&
            (fpvActive ||
              camS.headingRateDegPerS !== null ||
              camS.zoomRatePerS !== null ||
              camS.targetTiltDeg !== null ||
              camS.targetHeadingDeg !== null ||
              camS.targetZoomAltM !== null)
          ) {
            camS.setExplore(false);
          }
          explore.setActive(useCameraStore.getState().exploreActive);
          if (explore.update(now, dtMs)) lastInteract = now;
        }

  };

  const stepFpvTransitions = () => {
        // --- FPV modes: transitions + the per-frame pose (Phase 5.5 S2 + follow-up). Two
        //     anchors share one controller: a placed PHOTO's frustum apex (pose re-read every
        //     frame — the photo sliders steer the view live) and the TEMP pin (eye height on
        //     the ground, basis captured at entry). Entry/exit ride the same cinematic flight;
        //     buildings ghost to FPV.buildingGhostOpacity so the view is never lost in a mesh.
        upNow = useUploadStore.getState();
        camNow = useCameraStore.getState();
        // Saved-place jump (owner 2026-07-15): a one-shot full FPV pose rides the EXACT
        // share-link entry path — pendingFpvShare feeds the temp-entry basis/eye/FOV below.
        // Forcing fpvKind = null makes the entry branch fire even when already standing in a
        // temp FPV (a direct re-pose: no fly-out, the entry flight goes straight there).
        if (camNow.fpvJumpRequest) {
          const jump = camNow.fpvJumpRequest;
          camNow._consumeFpvJump();
          pendingFpvShare = jump;
          if (upNow.viewMode === "fpv") upNow.setViewMode("orbit"); // photo FPV yields
          if (fpvKind === "temp") fpvKind = null;
          camNow.setTempPin({ latDeg: jump.latDeg, lonDeg: jump.lonDeg });
          camNow.setTempFpv(true);
          // S2: the jump pose seeds the planned view (fov widened to horizontal at the live
          // aspect) — leaving FPV later keeps this plan alive on the map surfaces.
          camNow.setPlannedView({
            headingDeg: jump.headingDeg,
            hFovDeg: horizontalFovDeg(jump.fovDeg, camera.aspect),
          });
          upNow = useUploadStore.getState(); // re-snapshot after the writes above
          camNow = useCameraStore.getState();
        }
        const wantKind: "photo" | "temp" | null =
          upNow.viewMode === "fpv"
            ? "photo"
            : camNow.tempFpv && camNow.tempPin
              ? "temp"
              : null;
        // Captured BEFORE the branches: the entry code below sets fpvActive itself, so the
        // "fresh entry vs FPV→FPV jump" pin-visibility guard must read the pre-transition state.
        const wasFpvActive = fpvActive;
        if (wantKind !== fpvKind) {
          if (wantKind === null) {
            fpvKind = null;
            fpvActive = false;
            controls.adjustHeight = true;
            controls.enabled = true;
            zeroZoomBank(); // U2/A2: the pre-entry zoom bank survived the whole session — never discharge it here
            // U2/A7: the street-floor guard froze lastGroundM at its PRE-FPV value (it gates on
            // !fpvActive) — stale high ground here would clamp the exit fly-out upward the frame
            // it ends. Invalidate; the guard re-samples at the fresh view focus before clamping.
            lastGroundM = null;
            buildings.setGhostSolid(0); // next FPV entry starts on the ghost curve again
            buildings.setGhost(null);
            enriched?.setSolidity(null); // restore the opaque non-FPV enriched look
            userModels.setSolidity(null); // MS6: the models too
            disarmBuilding(); // U8: the height-edit session cannot outlive FPV
            disarmModel(); // MS5: nor the model session
            camNow.clearAllTargets(); // targets set during FPV must not fire now
            // A held walk stick must not survive the exit either (clearAllTargets deliberately
            // spares it — the stick component's unmount is the usual clear; this is the backstop).
            if (camNow.fpvWalkInput) camNow.setFpvWalkInput(null);
            // Restore the pre-FPV pin visibility (no-op if the chip was re-lit inside FPV).
            if (pinsVisibleBeforeFpv && !camNow.pinsVisible) camNow.setPinsVisible(true);
            fovTargetDeg = POSE.fovDeg;
            const geomOut = upNow.phase === "placed" ? frustum.current() : null;
            const pinOut = tempPinPoint();
            // U1 (owner point 1): on /m, FPV always exits to the 2D map — flip the mode
            // (buildings detach via the gate step) and fly out to the north-up nadir pose
            // instead of the oblique frame arrival (which the 2D locks would then fight).
            if (isMobileShell) {
              camNow.setMapMode("2d");
              const outP = geomOut
                ? new THREE.Vector3(geomOut.apex[0], geomOut.apex[1], geomOut.apex[2])
                : pinOut;
              if (outP) {
                const gOut = ecefToGeodetic([outP.x, outP.y, outP.z]);
                const pose = mapArrivalPose(
                  outP,
                  clampGroundM(ground.heightAt(gOut.latDeg, gOut.lonDeg) ?? tempPinGroundM),
                );
                flight.start(pose, { floorM: flightFloorM(pose.position) });
                // no beginFraming: the re-framing glide targets the OBLIQUE photo arrival.
              }
            } else if (geomOut) {
              const pose = frameArrivalPose(geomOut);
              flight.start(pose, { floorM: flightFloorM(pose.position) });
              beginFraming(pose); // same live-terrain settle the pin selection gets
            } else if (pinOut) {
              // Fly back out to the standard arrival pose around the temp pin.
              const upT = pinOut.clone().normalize();
              const horiz = camera.position.clone().sub(pinOut);
              horiz.addScaledVector(upT, -horiz.dot(upT));
              if (horiz.lengthSq() < 1) horiz.copy(_Z).addScaledVector(upT, -upT.z);
              horiz.normalize();
              const pose = arrivalPose({
                lookAt: pinOut.clone(),
                approachHoriz: horiz,
                groundAltM: tempPinGroundM,
                altAboveGroundM: FLIGHT.arrivalAltAboveGroundM,
                tiltDeg: FLIGHT.arrivalTiltDeg,
                wgs84A: WGS84_A,
                wgs84B: WGS84_B,
              });
              flight.start(pose, { floorM: flightFloorM(pose.position) });
            }
            lastInteract = now;
          } else if (wantKind === "photo") {
            const g = frustum.current();
            if (!g) {
              upNow.setViewMode("orbit"); // nothing placed to stand in
            } else {
              fpvKind = "photo";
              fpvActive = true;
              fpvYaw = 0;
              fpvPitch = 0;
              fpvWalkOffset.set(0, 0, 0);
              fpvWalkGroundM = null; // RC10
              fpvWalkAppliedM = null;
              fpvWalkSampleValid = false;
              fpvLiftM = 0; // the photographer's exact eye — ALTITUDE lifts from here
              fpvDragId = null;
              controls.enabled = false;
              controls.adjustHeight = false; // cameraRadius would push us off the apex
              zeroZoomBank(); // U2/A2: a wheel burst just before entry must not survive to exit
              buildings.setGhost({
                fillOpacity: FPV.buildingGhostOpacity,
                edgeOpacity: FPV.buildingGhostEdgeOpacity,
              });
              camNow.clearAllTargets();
              if (!wasFpvActive) {
                // FPV declutters: pins off by default. Only capture the restore state on a
                // FRESH entry — an FPV→FPV jump must keep the original pre-FPV memory.
                pinsVisibleBeforeFpv = camNow.pinsVisible;
                if (camNow.pinsVisible) camNow.setPinsVisible(false);
              }
              const apex = new THREE.Vector3(...g.apex);
              // Anchor ground for the eye-height readout + building solidity: terrain sample,
              // apex-derived fallback (the frameArrivalPose clamp discipline).
              const pl = upNow.placement;
              const sampledG = pl ? ground.heightAt(pl.latDeg, pl.lonDeg) : null;
              fpvAnchorGroundM =
                sampledG != null
                  ? clampGroundM(sampledG)
                  : Math.max(
                      0,
                      WGS84_ELLIPSOID.getPositionElevation(apex) - FRUSTUM.eyeHeightM,
                    );
              const lookAt = apex
                .clone()
                .addScaledVector(new THREE.Vector3(...g.forward), FRUSTUM.planeDistM);
              flight.start({ position: apex, lookAt });
              // Enter at the photo's own vertical FOV — you see what the photographer saw.
              const [tl, , , bl] = g.corners;
              const halfH = 0.5 * Math.hypot(tl[0] - bl[0], tl[1] - bl[1], tl[2] - bl[2]);
              fovTargetDeg = THREE.MathUtils.clamp(
                THREE.MathUtils.radToDeg(2 * Math.atan(halfH / FRUSTUM.planeDistM)),
                FPV.minFovDeg,
                FPV.maxFovDeg,
              );
              lastInteract = now;
            }
          } else {
            const pinP = tempPinPoint();
            if (!pinP) {
              camNow.setTempFpv(false); // pin vanished under us
            } else {
              fpvKind = "temp";
              fpvActive = true;
              fpvYaw = 0;
              fpvPitch = 0;
              fpvWalkOffset.set(0, 0, 0);
              fpvWalkGroundM = null; // RC10
              fpvWalkAppliedM = null;
              fpvWalkSampleValid = false;
              fpvDragId = null;
              controls.enabled = false;
              controls.adjustHeight = false; // eye height 1.7 m is under cameraRadius
              zeroZoomBank(); // U2/A2: a wheel burst just before entry must not survive to exit
              buildings.setGhost({
                fillOpacity: FPV.buildingGhostOpacity,
                edgeOpacity: FPV.buildingGhostEdgeOpacity,
              });
              camNow.clearAllTargets();
              if (!wasFpvActive) {
                // FPV declutters: pins off by default. Only capture the restore state on a
                // FRESH entry — an FPV→FPV jump must keep the original pre-FPV memory.
                pinsVisibleBeforeFpv = camNow.pinsVisible;
                if (camNow.pinsVisible) camNow.setPinsVisible(false);
              }
              // A shared `#f=` link carries the EXACT view — eye height, bearing, pitch, FOV
              // (owner 2026-07-14); consumed once, then the entry behaves as always.
              const share = pendingFpvShare;
              pendingFpvShare = null;
              fpvEyeM = share
                ? THREE.MathUtils.clamp(share.eyeM, 0.5, FPV.tempEyeMaxM)
                : FRUSTUM.eyeHeightM;
              _tempUp0.copy(pinP).normalize();
              // Owner QA 2026-08-21 item 2: a plain LOOK-FROM-HERE entry honours the FOCAL
              // CONE — plannedView (seeded from boot, batch #6) steers the basis exactly like
              // a share bearing does, and its hFov converts back to the camera's vertical FOV
              // (verticalFovDeg — the missing half of the horizontalFovDeg round trip). The
              // old "continue facing the camera" projection degenerated to NORTH at the /m 2D
              // nadir (|fwd·horizontal|≈0), which is what ignored the drawn cone.
              const planEntry = share ? null : camNow.plannedView;
              if (share || planEntry) {
                // Basis from the SHARED or PLANNED bearing (fresh scratch vectors — never
                // alias a stored basis vector to a module temp, the S7 street-names lesson).
                const entryLonR = THREE.MathUtils.degToRad(
                  share ? share.lonDeg : camNow.tempPin!.lonDeg,
                );
                _skyEast.set(-Math.sin(entryLonR), Math.cos(entryLonR), 0);
                _skyNorth.crossVectors(_tempUp0, _skyEast).normalize();
                const entryH = THREE.MathUtils.degToRad(
                  share ? share.headingDeg : planEntry!.headingDeg,
                );
                _tempFwd0
                  .copy(_skyEast)
                  .multiplyScalar(Math.sin(entryH))
                  .addScaledVector(_skyNorth, Math.cos(entryH));
              } else {
                // ENGINE-ABSENT GUARD, kept deliberately (audit #3 A2-4/A1-12, dated 2026-08-22).
                // INVARIANT: `plannedView` is non-null from the first non-FPV orchestrator frame
                // (the batch-#6 boot seed below) and is NEVER set back to null — `setPlannedView(null)`
                // has no call site. So this arm is unreachable in the shipped configuration, and it
                // is NOT deleted because two real states still reach it: a build without
                // PUBLIC_CESIUM_ION_TOKEN never attaches this orchestrator at all (GlobeCanvas logs
                // "tiles disabled" and the chrome still mounts), and a `#f=` URL that boots straight
                // into FPV skips the boot seed until the first exit. Basis: continue looking the way
                // the camera already faces (horizontal at the pin).
                camera.getWorldDirection(_camFwd);
                _tempFwd0.copy(_camFwd).addScaledVector(_tempUp0, -_camFwd.dot(_tempUp0));
                if (_tempFwd0.lengthSq() < 1e-6) {
                  _tempFwd0.copy(_Z).addScaledVector(_tempUp0, -_tempUp0.z); // north fallback
                }
              }
              _tempFwd0.normalize();
              _tempRight0.crossVectors(_tempFwd0, _tempUp0).normalize();
              _tempUp0.crossVectors(_tempRight0, _tempFwd0); // re-orthonormalized
              if (share) fpvPitch = THREE.MathUtils.degToRad(share.pitchDeg);
              fpvPinKey = camNow.tempPin
                ? `${camNow.tempPin.latDeg},${camNow.tempPin.lonDeg}`
                : null;
              const eye = pinP.clone().addScaledVector(_tempUp0, fpvEyeM);
              flight.start({
                position: eye,
                lookAt: eye.clone().addScaledVector(_tempFwd0, FPV.tempLookAheadM),
              });
              fovTargetDeg = share
                ? THREE.MathUtils.clamp(share.fovDeg, FPV.minFovDeg, FPV.maxFovDeg)
                : planEntry
                  ? THREE.MathUtils.clamp(
                      verticalFovDeg(planEntry.hFovDeg, camera.aspect),
                      FPV.minFovDeg,
                      FPV.maxFovDeg,
                    )
                  : FPV.tempFovDeg;
              lastInteract = now;
            }
          }
        }
  };

  // ── TRACKING lock (owner 2026-08-15c) — while sky.track is ON and FPV is live, re-aim the
  // sky-look glide at the tracked target EVERY frame (topocentric az/alt from the camera's
  // geodetic — the same basis stepFpvPose solves against, so the lock settles dead-centre).
  // The aim lives in this closure var, NOT the camera store (stores are never written at
  // 60 fps); stepFpvPose consumes it exactly like a one-shot skyLook but never clears it.
  // Releases: the target sinking below FPV.skyTrackReleaseAltDeg (here), a real look-drag
  // (onFpvPointerMove), or the TRACKING toggle itself. FPV-exit just suspends the lock.
  let skyTrackAim: { azDeg: number; altDeg: number } | null = null;
  const stepSkyTrack = () => {
    const skyNow = useSkyStore.getState();
    if (!skyNow.track || !fpvActive || flight.active()) {
      skyTrackAim = null;
      return;
    }
    const eyeGeo = ecefToGeodetic([camera.position.x, camera.position.y, camera.position.z]);
    const p = targetAzAlt(
      skyNow.target,
      sceneTimeMs(),
      eyeGeo.latDeg,
      eyeGeo.lonDeg,
      Math.max(0, eyeGeo.altM),
    );
    if (p.altDeg < FPV.skyTrackReleaseAltDeg) {
      // Below the horizon — the lock lets go ("until released or below horizon", owner).
      skyTrackAim = null;
      skyNow.setTrack(false);
      return;
    }
    skyTrackAim = { azDeg: p.azDeg, altDeg: p.altDeg };
  };

  const stepFpvPose = () => {
        if (fpvActive) {
          if (!flight.active()) {
            let posed = false;
            if (fpvKind === "photo") {
              const g = frustum.current();
              if (g) {
                camera.position.set(g.apex[0], g.apex[1], g.apex[2]);
                _fpvUpGeo.copy(camera.position).normalize();
                // S6 ALTITUDE lift: strictly vertical off the apex; 0 = exact photo alignment.
                if (fpvLiftM > 0) camera.position.addScaledVector(_fpvUpGeo, fpvLiftM);
                _fpvFwd.set(g.forward[0], g.forward[1], g.forward[2]);
                _fpvUp.set(g.up[0], g.up[1], g.up[2]);
                _fpvRight.set(g.right[0], g.right[1], g.right[2]);
                posed = true;
              }
            } else {
              const pinP = tempPinPoint();
              if (pinP) {
                // PLACE POINT under a LIVE temp FPV (owner QA 2026-08-21 item 1): the batch-#6
                // re-pose kept the OLD pin's ENU basis + the accumulated walk offset, landing
                // the eye |walkOffset| away from the new pin — the "detached radar/eye" root
                // cause. A pin change re-seats cleanly: fresh tangent basis at the NEW pin
                // with the CURRENT view direction carried over (heading survives the frame
                // change; the look elevation re-expresses as the pitch offset), walk zeroed.
                const pinKey = camNow.tempPin
                  ? `${camNow.tempPin.latDeg},${camNow.tempPin.lonDeg}`
                  : null;
                if (pinKey !== fpvPinKey) {
                  fpvPinKey = pinKey;
                  camera.getWorldDirection(_camFwd);
                  _tempUp0.copy(pinP).normalize();
                  const elev = Math.asin(
                    THREE.MathUtils.clamp(_camFwd.dot(_tempUp0), -1, 1),
                  );
                  _tempFwd0.copy(_camFwd).addScaledVector(_tempUp0, -_camFwd.dot(_tempUp0));
                  if (_tempFwd0.lengthSq() < 1e-6) {
                    _tempFwd0.copy(_Z).addScaledVector(_tempUp0, -_tempUp0.z); // degenerate fallback
                  }
                  _tempFwd0.normalize();
                  _tempRight0.crossVectors(_tempFwd0, _tempUp0).normalize();
                  _tempUp0.crossVectors(_tempRight0, _tempFwd0); // re-orthonormalized
                  fpvYaw = 0;
                  fpvPitch = elev;
                  fpvWalkOffset.set(0, 0, 0);
                  fpvWalkGroundM = null; // RC10: a new pin is a new ground reference
                  fpvWalkAppliedM = null;
                  fpvWalkSampleValid = false;
                }
                camera.position.copy(pinP).addScaledVector(_tempUp0, fpvEyeM);
                _fpvUpGeo.copy(_tempUp0);
                _fpvFwd.copy(_tempFwd0);
                _fpvUp.copy(_tempUp0);
                _fpvRight.copy(_tempRight0);
                posed = true;
              } else {
                camNow.setTempFpv(false); // pin cleared while standing on it
              }
            }
            if (posed) {
              // Sky-look glide (owner 2026-07-14): a clicked ☀/☾ edge chip requested a bearing —
              // ease the look offsets toward it against the PRE-look anchor basis. The final
              // view azimuth is az0 + fpvYaw (the −yaw rotation about geodetic up is compass-
              // clockwise) and the final elevation is baseElev + fpvPitch, so the targets fall
              // out directly; the pitch target honours the existing ±pitchClampDeg band. Any
              // direct look interaction cancels the request; arrival clears it.
              // TRACKING (owner 2026-08-15c) rides the same solve as a one-shot skyLook —
              // stepSkyTrack refreshes the aim per frame and owns clearing/release.
              const skyLook = skyTrackAim ?? camNow.skyLook;
              if (skyLook) {
                const eyeGeo = ecefToGeodetic([
                  camera.position.x,
                  camera.position.y,
                  camera.position.z,
                ]);
                const lonR = (eyeGeo.lonDeg * Math.PI) / 180;
                _skyEast.set(-Math.sin(lonR), Math.cos(lonR), 0); // ECEF z = polar axis
                _skyNorth.crossVectors(_fpvUpGeo, _skyEast).normalize();
                const az0 = Math.atan2(_fpvFwd.dot(_skyEast), _fpvFwd.dot(_skyNorth));
                const elev0 = Math.asin(THREE.MathUtils.clamp(_fpvFwd.dot(_fpvUpGeo), -1, 1));
                const maxElev = THREE.MathUtils.degToRad(FPV.pitchClampDeg);
                const azT = THREE.MathUtils.degToRad(skyLook.azDeg);
                const yawDelta = Math.atan2(Math.sin(azT - az0 - fpvYaw), Math.cos(azT - az0 - fpvYaw));
                const yawT = fpvYaw + yawDelta;
                const pitchT = THREE.MathUtils.clamp(
                  THREE.MathUtils.degToRad(skyLook.altDeg) - elev0,
                  -maxElev - elev0,
                  maxElev - elev0,
                );
                const kLook =
                  1 - Math.exp(-dtMs / (skyTrackAim ? FPV.skyTrackEaseTauMs : FPV.skyLookEaseTauMs));
                fpvYaw += (yawT - fpvYaw) * kLook;
                fpvPitch += (pitchT - fpvPitch) * kLook;
                if (Math.abs(yawT - fpvYaw) < 0.003 && Math.abs(pitchT - fpvPitch) < 0.003) {
                  fpvYaw = yawT;
                  fpvPitch = pitchT;
                  if (!skyTrackAim) camNow._clearSkyLook(); // tracking is persistent — no clear
                }
                lastInteract = now;
              }
              if (fpvYaw !== 0) {
                _fpvQ.setFromAxisAngle(_fpvUpGeo, -fpvYaw); // +yaw = look right (compass sense)
                _fpvFwd.applyQuaternion(_fpvQ);
                _fpvUp.applyQuaternion(_fpvQ);
                _fpvRight.applyQuaternion(_fpvQ);
              }
              // Clamp the TOTAL elevation (anchor pitch + look offset) inside ±FPV.pitchClampDeg.
              const baseElev = Math.asin(THREE.MathUtils.clamp(_fpvFwd.dot(_fpvUpGeo), -1, 1));
              const maxElev = THREE.MathUtils.degToRad(FPV.pitchClampDeg);
              fpvPitch = THREE.MathUtils.clamp(fpvPitch, -maxElev - baseElev, maxElev - baseElev);
              if (fpvPitch !== 0) {
                _fpvQ.setFromAxisAngle(_fpvRight, fpvPitch); // +pitch = look up
                _fpvFwd.applyQuaternion(_fpvQ);
                _fpvUp.applyQuaternion(_fpvQ);
              }
              // FPV WALK (owner): integrate held arrows + the mobile walk stick (M2) into
              // fpvWalkOffset — a fixed WORLD-SPACE displacement — stepping along THIS frame's
              // HORIZONTAL look direction (fwd projected off geodetic up) + right. Only INPUT
              // mutates the offset; a head-turn never does (true-FPV invariant — the eye stays
              // put while looking). The look itself is unchanged: lookAt uses position + _fpvFwd,
              // so moving the position keeps the heading.
              const stick = camNow.fpvWalkInput;
              const stickRaw = stick ? Math.hypot(stick.fwd, stick.right) : 0;
              const stickMag = Math.min(1, stickRaw);
              const stickOn = stick !== null && stickMag > FPV.walkStickDeadband;
              const keysOn =
                fpvKeysDown.up || fpvKeysDown.down || fpvKeysDown.left || fpvKeysDown.right;
              if (keysOn || stickOn) {
                // QA slice B (owner 2026-08-21g-end): while the EXPANDED chart is up, walking
                // is SCREEN-relative — stick/arrow-up moves me UP on the chart regardless of
                // its twist or my camera heading (heads-down map navigation; the look stays
                // free). The published twist (store/minimap.mapWindowRotRad, nulled on close)
                // de-rotates the input: basis fwd = the compass azimuth of screen-up =
                // chartWalkAzRad(0,1,rot), right = fwd + 90°, built in ENU at the eye
                // (east = polar × up — the _skyEast idiom; the _sky temps are free here, the
                // skyLook block above has consumed them). Everywhere else (plain FPV, 3D)
                // the camera-relative basis below is untouched.
                const mwRotRad = useMiniMapStore.getState().mapWindowRotRad;
                if (mwRotRad !== null) {
                  _skyEast.set(-_fpvUpGeo.y, _fpvUpGeo.x, 0).normalize(); // ENU east (polar z × up)
                  _skyNorth.crossVectors(_fpvUpGeo, _skyEast).normalize(); // ENU north
                  const azF = chartWalkAzRad(0, 1, mwRotRad); // chart-up as a compass azimuth
                  _fpvWalkFwd
                    .copy(_skyEast)
                    .multiplyScalar(Math.sin(azF))
                    .addScaledVector(_skyNorth, Math.cos(azF));
                  _fpvWalkRight
                    .copy(_skyEast)
                    .multiplyScalar(Math.sin(azF + Math.PI / 2))
                    .addScaledVector(_skyNorth, Math.cos(azF + Math.PI / 2));
                } else {
                  _fpvWalkFwd.copy(_fpvFwd).addScaledVector(_fpvUpGeo, -_fpvFwd.dot(_fpvUpGeo));
                  if (_fpvWalkFwd.lengthSq() > 1e-9) _fpvWalkFwd.normalize();
                  _fpvWalkRight.crossVectors(_fpvWalkFwd, _fpvUpGeo).normalize();
                }
              }
              if (keysOn) {
                const mult = fpvKeysDown.shift
                  ? FPV.walkFastMult
                  : fpvKeysDown.alt
                    ? FPV.walkSlowMult
                    : 1;
                const spd = (FPV.walkSpeedMps * mult * dtMs) / 1000;
                if (fpvKeysDown.up) fpvWalkOffset.addScaledVector(_fpvWalkFwd, spd);
                if (fpvKeysDown.down) fpvWalkOffset.addScaledVector(_fpvWalkFwd, -spd);
                if (fpvKeysDown.right) fpvWalkOffset.addScaledVector(_fpvWalkRight, spd);
                if (fpvKeysDown.left) fpvWalkOffset.addScaledVector(_fpvWalkRight, -spd);
              }
              if (stickOn && stick) {
                // Analog: the deflection IS the modifier (MOBILE_PLAN §4.1) — speed =
                // walkSpeedMps · walkStickMaxMult · d², so the rim sprints like Shift and the
                // first centimetre creeps like Option. Dividing by the raw magnitude keeps the
                // direction unit-length even if both axes rail simultaneously.
                const k =
                  (FPV.walkSpeedMps * FPV.walkStickMaxMult * stickMag * stickMag * dtMs) /
                  (1000 * Math.max(stickRaw, 1e-6));
                fpvWalkOffset.addScaledVector(_fpvWalkFwd, stick.fwd * k);
                fpvWalkOffset.addScaledVector(_fpvWalkRight, stick.right * k);
              }
              // SPACE = ascend, SHIFT+SPACE = descend, with hold-acceleration (QoL-1 +
              // owner 2026-08-14 ask 2): gain ramps QUADRATICALLY over spaceRampS (a tap
              // nudges centimetres, a hold accelerates — precision-controlled, never faster
              // than the encoder rail), stepping the SAME strictly-vertical identity the
              // ALTITUDE encoder drives (temp: eye height; photo: lift off the apex) with the
              // same proportional floor + clamps. The shift mirror flips the SIGN live — a
              // mid-hold Shift press reverses direction without restarting the ramp. Mutating
              // next frame's eye/lift here (not camera.position) keeps one vertical authority.
              if (fpvKeysDown.space) {
                fpvSpaceHeldMs += dtMs;
                const gain = Math.min(1, fpvSpaceHeldMs / (FPV.spaceRampS * 1000));
                const rate = FPV.spaceLiftRatePerS * gain * gain * (fpvKeysDown.shift ? -1 : 1);
                if (fpvKind === "temp") {
                  fpvEyeM = THREE.MathUtils.clamp(
                    fpvEyeM + ((rate * dtMs) / 1000) * Math.max(fpvEyeM, FPV.vertEncoderBaseM),
                    FRUSTUM.eyeHeightM,
                    FPV.tempEyeMaxM,
                  );
                } else {
                  fpvLiftM = THREE.MathUtils.clamp(
                    fpvLiftM + ((rate * dtMs) / 1000) * Math.max(fpvLiftM, FPV.vertEncoderBaseM),
                    0,
                    FPV.tempEyeMaxM,
                  );
                }
                lastInteract = now;
              } else if (fpvSpaceHeldMs !== 0) {
                fpvSpaceHeldMs = 0;
              }
              camera.position.add(fpvWalkOffset);
              // RC10 — re-seat the walked eye onto the ground it is actually over. Resampled on
              // DISTANCE, not on a timer: standing still costs nothing, and a sprint samples at a
              // fixed spatial cadence regardless of frame rate. `seatStep` is the same easing the
              // temp pin and every cell seat use, so a terrain-LOD refine under a walking viewer
              // slides the eye instead of teleporting it (the U2 point-6 jump, paid for once).
              if (fpvKind === "temp" && fpvWalkOffset.lengthSq() > 0) {
                if (
                  !fpvWalkSampleValid ||
                  camera.position.distanceToSquared(_fpvWalkSampledAt) >
                    FPV.walkReseatDistM * FPV.walkReseatDistM
                ) {
                  _fpvWalkSampledAt.copy(camera.position);
                  fpvWalkSampleValid = true;
                  const g = ecefToGeodetic([
                    camera.position.x,
                    camera.position.y,
                    camera.position.z,
                  ]);
                  const th = ground.heightAt(g.latDeg, g.lonDeg);
                  if (th != null) fpvWalkGroundM = clampGroundM(th); // sticky: null holds last-good
                }
                if (fpvWalkGroundM != null) {
                  const ref = tempPinAppliedM ?? tempPinGroundM;
                  fpvWalkAppliedM = seatStep(fpvWalkAppliedM, fpvWalkGroundM - ref, FPV.walkReseatEaseK);
                  camera.position.addScaledVector(_fpvUpGeo, fpvWalkAppliedM);
                }
              }
              camera.up.copy(_fpvUp);
              camera.lookAt(_fpvLook.copy(camera.position).add(_fpvFwd));
              camera.updateMatrixWorld();
              lastInteract = now; // FPV owns the camera — the idle drift must never move it
            }
          }
          controls.adjustCamera(camera); // controls disabled: keep the near/far fit alive
          // U2 instrumentation (DEV): record single-frame eye jumps with their ground context.
          if (import.meta.env.DEV) {
            if (!flight.active()) {
              if (u2PrevEyeValid) {
                const dM = camera.position.distanceTo(_u2PrevEye);
                if (dM > 0.5) {
                  u2JumpsTotal++;
                  u2Jumps.push({
                    atMs: Math.round(now),
                    dM: Math.round(dM * 100) / 100,
                    dtMs: Math.round(dtMs),
                    kind: fpvKind,
                    walk:
                      camNow.fpvWalkInput !== null ||
                      fpvKeysDown.up ||
                      fpvKeysDown.down ||
                      fpvKeysDown.left ||
                      fpvKeysDown.right ||
                      fpvKeysDown.space,
                    groundRawM: Math.round(tempPinGroundM * 100) / 100,
                    groundAppliedM:
                      tempPinAppliedM == null ? null : Math.round(tempPinAppliedM * 100) / 100,
                  });
                  if (u2Jumps.length > 50) u2Jumps.shift();
                }
              }
              _u2PrevEye.copy(camera.position);
              u2PrevEyeValid = true;
            } else u2PrevEyeValid = false;
          }
        } else if (import.meta.env.DEV) u2PrevEyeValid = false;
  };

  const stepFovGlide = () => {
        // FOV glide (FPV wheel zoom + the entry/exit FOV changes) — never a snap.
        if (Math.abs(camera.fov - fovTargetDeg) > FPV.fovArriveDeg) {
          camera.fov += (fovTargetDeg - camera.fov) * (1 - Math.exp(-dtMs / FPV.fovEaseTauMs));
          if (Math.abs(camera.fov - fovTargetDeg) < FPV.fovArriveDeg) camera.fov = fovTargetDeg;
          camera.updateProjectionMatrix();
        }

  };

  const stepGeodeticAltitude = () => {
        // True geodetic altitude above the WGS84 ellipsoid. (position.length() - WGS84_A is up to
        // ~21 km off at mid-latitudes — enough to mis-time the low-altitude gates.)
        alt = WGS84_ELLIPSOID.getPositionElevation(camera.position);

  };

  const stepViewFocus = () => {
        // View focus: camera-forward ray → ellipsoid (past-the-limb views fall back to the
        // sub-camera point). ONE shared frame for the heading/zoom glides, their live mirrors,
        // the shadow rig and the golden-hour key-light signal. (controls.getPivotPoint is NOT
        // usable here — it is degenerate before the first user interaction.)
        camera.getWorldDirection(_camFwd);
        focusHit = rayEllipsoidIntersect(
          [camera.position.x, camera.position.y, camera.position.z],
          [_camFwd.x, _camFwd.y, _camFwd.z],
        );
        if (focusHit) {
          _focus.set(focusHit[0], focusHit[1], focusHit[2]);
          _focusUp.copy(_focus).normalize();
        } else {
          _focus.copy(camera.position);
          _focusUp.copy(camera.position).normalize();
        }
        // U5: refresh the download-priority aim from THIS frame's camera (the comparators read
        // it asynchronously at the next queue sort). Epoch bump invalidates every tile's cached
        // biased distance; the bias itself gates on FPV — orbit/2D keep pure library ordering.
        loadAim.active = fpvActive && LOADING.fpvBiasK > 0;
        loadAim.k = LOADING.fpvBiasK;
        loadAim.eye.x = camera.position.x;
        loadAim.eye.y = camera.position.y;
        loadAim.eye.z = camera.position.z;
        loadAim.fwd.x = _camFwd.x;
        loadAim.fwd.y = _camFwd.y;
        loadAim.fwd.z = _camFwd.z;
        loadAim.epoch++;
        // U6: foveated regions ride the SAME fresh pose (compose with the U5 aim — one seam).
        // The boundary flip adds/clears regions + relaxes/restores the periphery; per frame the
        // fovea ray + eye bubble follow the eye. Tier gating (foveation null on high) is the
        // modules' — orbit/2D and desktop-high stay byte-identical by construction.
        if (fpvActive !== foveaOn) {
          foveaOn = fpvActive;
          buildings.setFoveaActive(foveaOn);
          enriched?.setFoveaActive(foveaOn);
          ground.setFoveaActive(foveaOn);
        }
        if (foveaOn) {
          buildings.setFoveaPose(camera.position, _camFwd);
          enriched?.setFoveaPose(camera.position, _camFwd);
          ground.setFoveaPose(camera.position, _camFwd);
        }
        // Pin focus lock (owner follow-up 2026-07-11): while a photo pin is selected (placed)
        // or a temp pin is set, the heading/zoom glides + encoder rates pivot around the PIN —
        // the controls relate to the pin the way FPV relates to the apex. Library drag/wheel
        // keep their own pointer-based pivots; a map click / Escape clears the selection.
        focusLocked = false;
        if (!fpvActive) {
          const gSel = upNow.phase === "placed" ? frustum.current() : null;
          if (gSel) {
            _focus.set(gSel.apex[0], gSel.apex[1], gSel.apex[2]);
            _focusUp.copy(_focus).normalize();
            focusLocked = true;
          } else {
            // On the /m 2D map the chart pivots at the SCREEN CENTRE, never a dropped pin:
            // heading/zoom corrections orbiting an off-centre pin sweep the camera through a
            // ground arc that reads as the map whirling — and MY LOCATION now drops a pin on
            // the 2D map as a matter of course (owner batch 2026-08-18).
            const pinP =
              isMobileShell && useCameraStore.getState().mapMode === "2d"
                ? null
                : tempPinPoint();
            if (pinP) {
              _focus.copy(pinP);
              _focusUp.copy(pinP).normalize();
              focusLocked = true;
            }
          }
        }
        hasFocus = focusHit !== null || focusLocked;
        lastAlt = alt;

  };

  const stepIdleDrift = () => {
        // Idle orbital drift (LEO spacecraft feel) — orbit only, paused after interaction.
        // U1: the /m 2D map is a CHART and holds still — the drift visibly slid the map
        // eastward (~3° lon in the first browser pass) and read as broken, not cinematic.
        if (
          !reduceMotion &&
          alt > DRIFT.minAlt &&
          performance.now() - lastInteract > DRIFT.resumeMs &&
          !(isMobileShell && useCameraStore.getState().mapMode === "2d")
        ) {
          _driftQ.setFromAxisAngle(_driftAxis, driftRadiansForDt(DRIFT.degPerSec, dtMs));
          camera.position.applyQuaternion(_driftQ);
          camera.up.applyQuaternion(_driftQ);
          camera.quaternion.premultiply(_driftQ);
        }

  };

  const stepTiltGlide = () => {
        // Manual declination (slider): glide the pitch toward the requested tilt around the view
        // focus. Grabbing the globe (noteInteract) or a flight cancels the glide. Sign verified
        // against the source: _applyRotation's +y pitches TOWARD nadir (newPitch = pitch − y);
        // pitch convention 0 = straight down, π/2 = horizon; clamps are applied inside.
        camStore = useCameraStore.getState();
        if (camStore.targetTiltDeg !== null && !flight.active() && !fpvActive) {
          // getPivotPoint returns null when the centre-screen ray misses the planet (horizon
          // views) and leaves the target STALE — rotating around that garbage pivot flew the
          // camera 8 km → 128 km in verification. Fall back to the view focus (which itself
          // falls back to the camera position — a pure look-rotation, no translation).
          if (controls.getPivotPoint(_pivot) === null) _pivot.copy(_focus);
          zc.getUpDirection(_pivot, _pivotUp);
          _camBack.set(0, 0, 1).transformDirection(camera.matrixWorld); // camera +Z = backward
          const pitchRad = _pivotUp.angleTo(_camBack);
          const targetRad = THREE.MathUtils.degToRad(
            THREE.MathUtils.clamp(
              camStore.targetTiltDeg,
              CONTROLS.tiltMinDeg,
              CONTROLS.tiltMaxDeg,
            ),
          );
          const delta = pitchRad - targetRad;
          if (Math.abs(delta) < CONTROLS.tiltArriveRad) {
            camStore.clearTargetTilt(); // arrived — hand the camera back
          } else {
            const kt = 1 - Math.exp(-dtMs / CONTROLS.tiltEaseTauMs);
            zc._applyRotation(0, delta * kt, _pivot);
            camera.updateMatrixWorld();
          }
        }

  };

  const stepHeadingGlide = () => {
        // Manual heading (slider): glide the camera AROUND the view focus about its local up —
        // a rigid rotation about the up axis, so the current tilt is preserved exactly. Uses the
        // SAME focus frame as the live mirror, so the knob and the readout always agree.
        // Sign: rotating the camera by +θ about local up DECREASES the view heading (RH rule
        // with heading measured clockwise from north) — hence the negation.
        if (camStore.targetHeadingDeg !== null && !flight.active() && !fpvActive) {
          // Near nadir the forward bearing is DEGENERATE (any residual-tilt sliver defines it) —
          // chasing it spun the /m 3D→2D transition through several visible turns (owner bug
          // 2026-08-18). Below the blend tilt, measure the SCREEN-UP bearing instead: the 2D
          // locks' reference, so the glide→lock handoff shares one heading definition.
          _camBack.set(0, 0, 1).transformDirection(camera.matrixWorld);
          const glidePitchRad = _focusUp.angleTo(_camBack);
          const liveH =
            glidePitchRad < THREE.MathUtils.degToRad(CONTROLS.headingUpRefMaxTiltDeg)
              ? mapUpHeadingDeg(_focusUp)
              : viewHeadingDeg(_focusUp);
          if (Number.isNaN(liveH)) {
            camStore.clearTargetHeading(); // heading undefined here (pole / nadir view)
          } else {
            const deltaH = headingDeltaDeg(liveH, camStore.targetHeadingDeg);
            if (Math.abs(deltaH) < CONTROLS.headingArriveDeg) {
              camStore.clearTargetHeading(); // arrived — hand the camera back
            } else {
              const kh = 1 - Math.exp(-dtMs / CONTROLS.headingEaseTauMs);
              _qHead.setFromAxisAngle(_focusUp, -THREE.MathUtils.degToRad(deltaH * kh));
              camera.position.sub(_focus).applyQuaternion(_qHead).add(_focus);
              camera.up.applyQuaternion(_qHead);
              camera.quaternion.premultiply(_qHead);
              camera.updateMatrixWorld();
            }
          }
        }

  };

  // 2D-map free-heading latch (batch #4 item 3): flips true on the first two-finger rotate and
  // stands the north re-lock down until 2D re-entry or an explicit heading glide.
  let mobile2dFreeHeading = false;

  const stepMobile2dLocks = () => {
        // ── /m 2D map locks (UPLIFT U1; gesture rework owner batch #4 item 3, 2026-08-21) ──
        // TILT re-locks to nadir EVERY frame while the 2D map is active — the old
        // tilt-through-15°-into-3D door is gone (the ▲ 3D chip is the only way up), so the
        // library's two-finger parallel drag (touch ROTATE — the pinch/rotate classifier,
        // EnvironmentControls.js:562-585) is now the map ROTATION gesture: while it lives the
        // HEADING lock stands down (azimuth shows through, pitch dies in the tilt lock), and
        // the map KEEPS the user's heading afterwards (free-heading) until 2D is re-entered or
        // a heading glide (the 2D chip / compass) seats it home. North-lock keeps running only
        // while the map is still un-rotated — it corrects pan-induced drift, not the user.
        // Manual glides (the 3D chip's setTargetTilt) outrank both locks — one writer per axis.
        if (!isMobileShell || fpvActive || flight.active()) return;
        if (useCameraStore.getState().mapMode !== "2d") {
          mobile2dFreeHeading = false; // re-arm the north lock for the next 2D entry
          return;
        }
        // Live tilt — the stepTiltGlide measurement (pivot up vs camera-backward).
        if (controls.getPivotPoint(_pivot) === null) _pivot.copy(_focus);
        zc.getUpDirection(_pivot, _pivotUp);
        _camBack.set(0, 0, 1).transformDirection(camera.matrixWorld);
        const pitchRad = _pivotUp.angleTo(_camBack);
        const touchRotate = zc.state === 2 /* ROTATE */ && zc.pointerTracker.isPointerTouch();
        if (touchRotate) mobile2dFreeHeading = true;
        if (
          camStore.targetTiltDeg === null &&
          pitchRad > THREE.MathUtils.degToRad(MOBILE2D.lockTiltEpsDeg)
        ) {
          // Mid-gesture the fingers' vertical component must die the SAME frame (kk = 1) or
          // the ease reads as a wobble; outside a gesture the usual glide cleans up drift.
          const kk = touchRotate ? 1 : 1 - Math.exp(-dtMs / MOBILE2D.lockEaseTauMs);
          zc._applyRotation(0, pitchRad * kk, _pivot);
          camera.updateMatrixWorld();
        }
        // A heading glide (the 2D chip's setTargetHeading(0)) re-seats north AND re-arms the lock.
        if (camStore.targetHeadingDeg !== null) mobile2dFreeHeading = false;
        if (!mobile2dFreeHeading && !touchRotate && camStore.targetHeadingDeg === null) {
          const liveH = mapUpHeadingDeg(_focusUp);
          if (!Number.isNaN(liveH)) {
            const deltaH = headingDeltaDeg(liveH, 0);
            if (Math.abs(deltaH) > MOBILE2D.lockHeadingEpsDeg) {
              const kk = 1 - Math.exp(-dtMs / MOBILE2D.lockEaseTauMs);
              _qHead.setFromAxisAngle(_focusUp, -THREE.MathUtils.degToRad(deltaH * kk));
              camera.position.sub(_focus).applyQuaternion(_qHead).add(_focus);
              camera.up.applyQuaternion(_qHead);
              camera.quaternion.premultiply(_qHead);
              camera.updateMatrixWorld();
            }
          }
        }
  };

  const stepZoomGlide = () => {
        // Manual zoom (slider): log-space exponential approach to the target altitude, dollying
        // along the camera→focus ray (radially past the limb) — the wheel/pinch alternative.
        if (camStore.targetZoomAltM !== null && !flight.active() && !fpvActive) {
          // The slider floor is ellipsoid-relative; the street is not — pre-clamp the target
          // to the last-known terrain (guard block below keeps lastGroundM fresh) so a floor
          // request ARRIVES at street level instead of diving under it.
          const targetAlt = THREE.MathUtils.clamp(
            camStore.targetZoomAltM,
            (lastGroundM ?? 0) + CONTROLS.zoomMinAltM,
            CONTROLS.zoomMaxAltM,
          );
          const errLog = Math.log((targetAlt + 1) / (alt + 1));
          if (Math.abs(errLog) < CONTROLS.zoomArriveLog) {
            camStore.clearTargetZoom(); // arrived — hand the camera back
          } else if (
            Math.abs(alt - zoomGlideLastAlt) < CONTROLS.zoomStallAltEpsM &&
            ++zoomStallCount >= CONTROLS.zoomStallFrames
          ) {
            // Resting on terrain/cameraRadius (the 2 m floor is ellipsoid-relative — under a
            // 100 m-high city it is unreachable): release instead of fighting adjustHeight.
            camStore.clearTargetZoom();
            zoomStallCount = 0;
          } else {
            if (Math.abs(alt - zoomGlideLastAlt) >= CONTROLS.zoomStallAltEpsM) zoomStallCount = 0;
            const kzm = 1 - Math.exp(-dtMs / CONTROLS.zoomEaseTauMs);
            const s = Math.exp(errLog * kzm); // multiplicative altitude step this frame
            if (hasFocus) {
              // dolly along camera→focus: altitude scales ≈ with the focus distance
              camera.position.sub(_focus).multiplyScalar(s).add(_focus);
            } else {
              // looking past the limb: move radially instead
              const centreDist = camera.position.length();
              camera.position.multiplyScalar((centreDist - alt + alt * s) / centreDist);
            }
            camera.updateMatrixWorld();
          }
          zoomGlideLastAlt = alt;
        } else {
          zoomStallCount = 0;
        }

  };

  const stepEncoderRates = () => {
        // Encoder-style rate controls (Phase 5.5 S2): per-frame velocities through the SAME
        // rotation/dolly paths as the glides. The applied rate low-passes toward the stick, so
        // deflection ramps in and release coasts out; heading wraps freely, zoom clamps hard.
        // In ANY FPV (S6 — photo FPV unlocked with the ALTITUDE/FOCAL ZOOM rework) the sticks
        // re-target: ROTATE turns the look itself, ALTITUDE (the ZOOM encoder's FPV identity)
        // elevates the viewpoint strictly vertically, FOCAL ZOOM drives the camera FOV.
        kRate = 1 - Math.exp(-dtMs / CONTROLS.rateEaseTauMs);
        rateAllowed = !flight.active();
        const stickH = (rateAllowed && camStore.headingRateDegPerS) || 0;
        appliedHeadingRate += (stickH - appliedHeadingRate) * kRate;
        if (Math.abs(appliedHeadingRate) > CONTROLS.headingRateDeadbandDegPerS) {
          if (fpvActive) {
            // + rate = compass-clockwise = look right (matches the fpvYaw convention)
            fpvYaw += THREE.MathUtils.degToRad((appliedHeadingRate * dtMs) / 1000);
            // Deflecting ROTATE is a direct look interaction — it beats a sky-look glide.
            if (camStore.skyLook) camStore._clearSkyLook();
            lastInteract = now;
          } else {
            // + rate = compass-clockwise = heading increases → rotate camera by −θ about local up
            _qHead.setFromAxisAngle(
              _focusUp,
              -THREE.MathUtils.degToRad((appliedHeadingRate * dtMs) / 1000),
            );
            camera.position.sub(_focus).applyQuaternion(_qHead).add(_focus);
            camera.up.applyQuaternion(_qHead);
            camera.quaternion.premultiply(_qHead);
            camera.updateMatrixWorld();
            lastInteract = now; // rate-steering counts as interaction (pauses the idle drift)
          }
        }
        const stickZ = (rateAllowed && camStore.zoomRatePerS) || 0;
        appliedZoomRate += (stickZ - appliedZoomRate) * kRate;
        if (Math.abs(appliedZoomRate) > CONTROLS.rateDeadbandLog) {
          if (fpvActive) {
            // FPV ALTITUDE direction (owner 2026-07-14): + rate (drag RIGHT) = ASCEND — the
            // encoder reads as an altitude gauge, not a zoom. Strictly vertical elevation;
            // proportional speed with a floor base — a pure exponential from a 1.7 m eye
            // barely gets airborne. (The orbit ZOOM branch below keeps + = zoom in.)
            if (fpvKind === "temp") {
              fpvEyeM = THREE.MathUtils.clamp(
                fpvEyeM + ((appliedZoomRate * dtMs) / 1000) * Math.max(fpvEyeM, FPV.vertEncoderBaseM),
                FRUSTUM.eyeHeightM,
                FPV.tempEyeMaxM,
              );
            } else {
              // Photo FPV (S6): the same vertical elevation as a LIFT off the apex — floor 0
              // is the photographer's exact eye, never below it.
              fpvLiftM = THREE.MathUtils.clamp(
                fpvLiftM + ((appliedZoomRate * dtMs) / 1000) * Math.max(fpvLiftM, FPV.vertEncoderBaseM),
                0,
                FPV.tempEyeMaxM,
              );
            }
            lastInteract = now;
          } else {
            // + rate = zoom IN: altitude shrinks exponentially, clamped to the slider range.
            const nextAlt = THREE.MathUtils.clamp(
              alt * Math.exp((-appliedZoomRate * dtMs) / 1000),
              CONTROLS.zoomMinAltM,
              CONTROLS.zoomMaxAltM,
            );
            const sz = nextAlt / Math.max(alt, 1e-6);
            if (Math.abs(sz - 1) > 1e-6) {
              if (hasFocus) {
                camera.position.sub(_focus).multiplyScalar(sz).add(_focus);
              } else {
                const centreDist = camera.position.length();
                camera.position.multiplyScalar((centreDist - alt + alt * sz) / centreDist);
              }
              camera.updateMatrixWorld();
              lastInteract = now;
            }
          }
        }

  };

  const stepFocalEncoder = () => {
        // FOCAL ZOOM encoder (S6, FPV only): the panel twin of the wheel-FOV zoom — nudges the
        // same eased fovTargetDeg inside the same clamp. + rate = zoom IN = the FOV narrows.
        const stickF = (rateAllowed && fpvActive && camStore.fovRatePerS) || 0;
        appliedFovRate += (stickF - appliedFovRate) * kRate;
        if (fpvActive && Math.abs(appliedFovRate) > CONTROLS.rateDeadbandLog) {
          fovTargetDeg = THREE.MathUtils.clamp(
            fovTargetDeg * Math.exp((-appliedFovRate * dtMs) / 1000),
            FPV.minFovDeg,
            FPV.maxFovDeg,
          );
          lastInteract = now;
        }

  };

  const stepStreetFloorGuard = () => {
        // Street-floor / underground guard (Phase 5.5 S2, found in browser verification): the
        // manual zoom paths target ELLIPSOID altitude, so a 2 m request over a 150 m-high city
        // dives under the street — and once underground the ground tileset fully unloads, so
        // neither adjustHeight (down-ray from the camera) nor live heightAt can recover it.
        // Sample terrain under the camera every frame below 50 km, remember the last answer,
        // and clamp the camera to lastGround + zoomMinAltM BEFORE it ever crosses under; the
        // zoom glide then stalls against the clamp and releases itself.
        if (!fpvActive && !flight.active() && alt < ORCH.groundGuardMaxAltM) {
          // Sample at the VIEW FOCUS, not the camera footprint: tiles load inside the frustum,
          // and at oblique tilt there is often NO tile directly beneath the camera (verified —
          // the footprint sample stayed null through a whole 6 km→street dive).
          if (hasFocus) {
            const fg = ecefToGeodetic([_focus.x, _focus.y, _focus.z]);
            const th = ground.heightAt(fg.latDeg, fg.lonDeg);
            if (th != null) lastGroundM = clampGroundM(th);
          }
          if (lastGroundM !== null) {
            const minAlt = lastGroundM + CONTROLS.zoomMinAltM;
            if (alt < minAlt) {
              _camBack.copy(camera.position).normalize(); // geocentric up — ε vs geodetic here
              camera.position.addScaledVector(_camBack, minAlt - alt);
              camera.updateMatrixWorld();
            }
          }
        }

  };

  const stepLocationFinderFlyTo = () => {
        // Location-finder fly-to (Phase 5.5 S1): consume a pending one-shot request — geodetic
        // target → arrival pose along the CURRENT approach azimuth (no corkscrew: the flight's
        // orientation slerp stays short when the end pose faces the way we already face), then
        // the same cinematic flight a placed photo gets. flight.start replaces an active flight.
        if (camStore.flyRequest && !fpvActive) {
          const req = camStore.flyRequest;
          camStore._consumeFlyRequest();
          if (camStore.exploreActive) camStore.setExplore(false); // a search beats the cruise
          // Terrain-aware since S2: the S1 arrival sat req.altM above the ELLIPSOID, which is
          // underground at high-plateau cities (La Paz ~3.6 km). Same extent-sized altitude,
          // now above the rendered ground, through the shared arrival-pose derivation.
          const groundT = clampGroundM(ground.heightAt(req.latDeg, req.lonDeg) ?? 0);
          const target = new THREE.Vector3(...geodeticToEcef(req.latDeg, req.lonDeg, groundT));
          // Pose-preserving pan (owner 2026-08-18, the sky-search pin re-centre): a RIGID
          // translation moving the current SCREEN-CENTRE point onto the target — position
          // shifts by (target − rayHit), lookAt = target, so tilt/heading/zoom/2D-flavour stay
          // EXACTLY as they are (curvature over a map-scale hop re-tilts by <0.05°). Uses the
          // RAW ray hit, NOT `_focus`: with a temp pin set the pin focus-lock overrides _focus
          // to the pin itself, which zeroes the delta and degenerates the pan into a
          // rotate-in-place toward the pin (probe-caught 2026-08-18). Past-the-limb views
          // (no hit) fall through to the normal cinematic arrival.
          if (req.centerOnly && focusHit) {
            const pan = camera.position
              .clone()
              .add(target)
              .sub(new THREE.Vector3(focusHit[0], focusHit[1], focusHit[2]));
            flight.start(
              { position: pan, lookAt: target },
              { floorM: flightFloorM(pan), durationMs: FLIGHT.reframeDurationMs },
            );
            lastInteract = now;
            return;
          }
          const upT = target.clone().normalize();
          // Horizontal approach direction: camera bearing projected on the target's horizon
          // plane; degenerate (overhead / antipodal) falls back to local north.
          const horiz = camera.position.clone().sub(target);
          horiz.addScaledVector(upT, -horiz.dot(upT));
          if (horiz.lengthSq() < 1) {
            horiz.copy(_Z).addScaledVector(upT, -_Z.dot(upT)); // north = Z − up(Z·up)
          }
          horiz.normalize();
          // On the /m 2D map a fly-to lands nadir + north-up (mapArrivalPose) — the oblique
          // 52° search arrival left the 2D locks to visibly re-rotate the chart after landing
          // (the same corrector family as the 3D→2D spin, owner batch 2026-08-18).
          const pose =
            isMobileShell && useCameraStore.getState().mapMode === "2d"
              ? mapArrivalPose(target, groundT, req.altM)
              : arrivalPose({
                  lookAt: target,
                  approachHoriz: horiz,
                  groundAltM: groundT,
                  altAboveGroundM: req.altM,
                  tiltDeg: SEARCH.arrivalTiltDeg,
                  wgs84A: WGS84_A,
                  wgs84B: WGS84_B,
                });
          flight.start(pose, { floorM: flightFloorM(pose.position) });
          lastInteract = now; // pause the idle drift through the flight, like any interaction
        }

  };

  const stepFpvSolidity = () => {
        // --- S6 FPV instruments: the eye height above ground drives the building solidity
        //     curve (risen over the rooftops → nothing left to see through), and the HUD
        //     mirror feeds the left-side bearings panel + the off-frame sun/moon edge chips. --
        if (fpvActive) {
          if (fpvKind === "photo") {
            // Refresh the sticky anchor ground at low cadence as terrain refines under the
            // pin (heightAt: null while loading, negative garbage on coarse tiles — S2 clamp).
            if (frameCount % FPV.anchorGroundEveryFrames === 0) {
              const pl = upNow.placement;
              const th = pl ? ground.heightAt(pl.latDeg, pl.lonDeg) : null;
              if (th != null) fpvAnchorGroundM = clampGroundM(th);
            }
            fpvEyeAboveGroundM = Math.max(0, alt - fpvAnchorGroundM);
          } else {
            // RC10: with the walk re-seat live the eye really is `fpvEyeM` above the ground it
            // stands on, wherever it has walked to — before RC10 this reported the nominal height
            // while the eye could be tens of metres under or over the terrain.
            fpvEyeAboveGroundM = fpvEyeM;
          }
          const st = THREE.MathUtils.clamp(
            (fpvEyeAboveGroundM - FPV.buildingSolidLoM) /
              (FPV.buildingSolidHiM - FPV.buildingSolidLoM),
            0,
            1,
          );
          // Owner BUILDINGS slider (0 = wireframe, 1 = solid) raises the auto eye-height curve for
          // the OSM mass, and drives the enriched set's fill opacity + edge fade directly.
          const sld = useCameraStore.getState().fpvBuildingSolidity;
          buildings.setGhostSolid(Math.max(st * st * (3 - 2 * st), sld));
          enriched?.setSolidity(sld);
          userModels.setSolidity(sld); // MS6: a model must not occlude the framed subject either
        }
  };

  // Viewer ground point (owner 2026-07-14): camera-nadir geodetic + rendered terrain height
  // there — the always-on copyable coords readout (FpvHud card, every mode). Written at the
  // pose-mirror cadence in orbit and the faster HUD cadence while FPV walks; deadbanded to
  // ~0.1 m so the LEO idle drift doesn't churn React renders.
  let lastCamGeoLat = NaN;
  let lastCamGeoLon = NaN;
  let lastCamGeoGround: number | null = null;
  const mirrorCamGeo = () => {
    const g = ecefToGeodetic([camera.position.x, camera.position.y, camera.position.z]);
    const th = ground.heightAt(g.latDeg, g.lonDeg);
    const groundAltM = th == null ? null : clampGroundM(th);
    if (
      Math.abs(g.latDeg - lastCamGeoLat) < 1e-6 &&
      Math.abs(g.lonDeg - lastCamGeoLon) < 1e-6 &&
      (groundAltM == null) === (lastCamGeoGround == null) &&
      (groundAltM == null || Math.abs(groundAltM - (lastCamGeoGround ?? 0)) < 0.05)
    ) {
      return;
    }
    lastCamGeoLat = g.latDeg;
    lastCamGeoLon = g.lonDeg;
    lastCamGeoGround = groundAltM;
    useCameraStore.getState()._syncCamGeo({ latDeg: g.latDeg, lonDeg: g.lonDeg, groundAltM });
  };

  const stepFpvHudAndSkyMarkers = () => {
        if (frameCount % FPV.hudSyncEveryFrames === 0) {
          if (fpvActive) mirrorCamGeo(); // fresh coords while walking (orbit rides the pose mirror)
          // Bearings reference: the FPV anchor while standing in a viewpoint, else the
          // camera's own geodetic position (S6 follow-up — direction chips in every mode).
          const anchorGeo = fpvActive
            ? ((fpvKind === "photo" ? upNow.placement : camNow.tempPin) ?? null)
            : null;
          // Marker consumers (phase C): sun/moon chips ride the right-panel SKY-guides chip;
          // the tracked target's chip rides the TARGET panel's SHOW toggle — either one wants
          // a bearings reference.
          const skyNow = useSkyStore.getState();
          const wantGuides = camNow.skyGuides;
          const wantTarget = skyNow.visible;
          const refGeo =
            anchorGeo ??
            (wantGuides || wantTarget
              ? ecefToGeodetic([camera.position.x, camera.position.y, camera.position.z])
              : null);
          if (refGeo) {
            const basis = enuBasis(refGeo.latDeg, refGeo.lonDeg);
            const azAltOf = (d: THREE.Vector3) => dirAzAltDeg(d, basis);
            _hudQ.copy(camera.quaternion).invert();
            const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
            const bodyMarker = (dirW: THREE.Vector3) => {
              const bearings = azAltOf(dirW);
              _hudDir.copy(dirW).applyQuaternion(_hudQ); // world → camera space
              const fm = frameMarker(
                _hudDir.x,
                _hudDir.y,
                _hudDir.z,
                tanHalfV,
                camera.aspect,
              );
              return {
                inFrame: fm.inFrame,
                dirX: fm.dirX,
                dirY: fm.dirY,
                azDeg: bearings.azDeg,
                altDeg: bearings.altDeg,
                up: bearings.altDeg > FPV.bodyMarkerMinAltDeg,
              };
            };
            const sunM = bodyMarker(sunDirW);
            // The moon is close enough that the direction must be camera-relative
            // (the sky impostor does the same — the arc/disc/marker all agree).
            const moonM = bodyMarker(
              _hudDir2.subVectors(moonPosW, camera.position).normalize(),
            );
            if (wantGuides || wantTarget) {
              camNow._syncSkyMarkers({
                sun: wantGuides ? sunM : null,
                moon: wantGuides ? moonM : null,
                // targetDirW is camera-relative for finite-distance targets (stepSkyTarget
                // re-derives it per frame — the moon's ~0.95° diurnal parallax), so the chip,
                // the reticle and the rendered body all agree.
                target: wantTarget
                  ? {
                      ...bodyMarker(targetDirW),
                      glyph: kindGlyph(skyNow.target.kind),
                      label: targetShortName(skyNow.target).toUpperCase(),
                    }
                  : null,
              });
            } else if (camNow.skyMarkers) {
              camNow._syncSkyMarkers(null);
            }
            if (fpvActive) {
              camera.getWorldDirection(_camFwd);
              const view = azAltOf(_camFwd);
              camNow._syncFpvHud({
                headingDeg: view.azDeg,
                pitchDeg: view.altDeg,
                fovDeg: camera.fov,
                aspect: camera.aspect,
                eyeAboveGroundM: fpvEyeAboveGroundM,
                sun: sunM,
                moon: moonM,
              });
            } else if (camNow.fpvHud) {
              // S2: the dying hud seeds the planned view — the shot just framed in FPV
              // survives as the focal cone on the planning surfaces (continuity seed).
              camNow.setPlannedView({
                headingDeg: camNow.fpvHud.headingDeg,
                hFovDeg: horizontalFovDeg(camNow.fpvHud.fovDeg, camNow.fpvHud.aspect),
              });
              camNow._syncFpvHud(null);
              // FPV exited mid-glide — drop the leftover request (a re-entry must not consume it).
              if (camNow.skyLook) camNow._clearSkyLook();
            }
          } else {
            if (camNow.fpvHud) {
              camNow.setPlannedView({
                headingDeg: camNow.fpvHud.headingDeg,
                hFovDeg: horizontalFovDeg(camNow.fpvHud.fovDeg, camNow.fpvHud.aspect),
              });
              camNow._syncFpvHud(null);
            }
            if (camNow.skyMarkers) camNow._syncSkyMarkers(null);
          }
        }

  };

  let lastUrlPoseHash = "";
  const stepPoseMirrorAndViewport = () => {
        // Mirror the live pose (pitch / heading / altitude) into the store at low cadence for
        // the panel readouts (never at 60 fps — same discipline as store/time).
        if (frameCount % ORCH.mirrorEveryFrames === 0) {
          zc.getUpDirection(camera.position, _pivotUp);
          _camBack.set(0, 0, 1).transformDirection(camera.matrixWorld);
          const liveTiltDeg = THREE.MathUtils.radToDeg(_pivotUp.angleTo(_camBack));
          if (Math.abs(liveTiltDeg - camStore.tiltDeg) > ORCH.tiltMirrorMinDeg) camStore._syncTilt(liveTiltDeg);
          // U1: on the /m 2D map the forward-derived heading is DEGENERATE (at nadir any
          // residual tilt direction defines it — it printed 180.5° on a north-up chart);
          // mirror the screen-up bearing instead, so the readouts + the `#p=` hash say what
          // the map shows (and a hash reload restores the same north-up chart).
          const liveHeadingDeg =
            isMobileShell && !fpvActive && camStore.mapMode === "2d"
              ? mapUpHeadingDeg(_focusUp)
              : viewHeadingDeg(_focusUp); // same frame as the heading glide
          if (!Number.isNaN(liveHeadingDeg)) {
            const wrapped = wrapHeadingDeg(liveHeadingDeg);
            if (Math.abs(headingDeltaDeg(camStore.headingDeg, wrapped)) > ORCH.headingMirrorMinDeg) {
              camStore._syncHeading(wrapped);
            }
          }
          if (Math.abs(alt - camStore.zoomAltM) / Math.max(alt, 1) > ORCH.zoomMirrorMinFrac) {
            camStore._syncZoom(alt);
          }
          // Viewport mirror for the public-pin query (Phase 5) — same cadence as the camera
          // mirrors; the pins store THROTTLES + thresholds the actual Wix Data query, so the
          // perpetual LEO idle drift never spams it. The camera store keeps the same focus as
          // the geocoding bias (location finder ranks results near what you're looking at).
          const focusGeo = ecefToGeodetic([_focus.x, _focus.y, _focus.z]);
          usePinsStore.getState().reportViewport(focusGeo.latDeg, focusGeo.lonDeg, alt);
          useUserModelsStore.getState().reportViewport(focusGeo.latDeg, focusGeo.lonDeg, alt); // MS5
          camStore._syncFocus(focusGeo.latDeg, focusGeo.lonDeg);
          if (!fpvActive) mirrorCamGeo(); // viewer ground point — FPV writes it at HUD cadence
          // URL pose (S7 feedback #2): mirror the SETTLED pose into the hash — the address bar
          // is always a shareable link and a reload lands here, not on the welcome. Skipped
          // while something else owns the camera (welcome/explore/flight); replaceState
          // only (no history spam), written only on change, ~1.6 s cadence (Safari rate-limits
          // history calls). In FPV the hash switches to the `#f=` form (owner 2026-07-14):
          // exact viewer point + eye height + bearing/pitch + FOV — first-person views share.
          if (
            frameCount % ORCH.urlPoseEveryFrames === 0 &&
            !camStore.exploreActive &&
            !flight.active() &&
            !document.body.classList.contains("welcome-active")
          ) {
            // A CUSTOM scene time (pinned/playing) rides the hash as `&t=` so the light is
            // shareable with the view; live time is never written (owner 2026-07-14).
            const shareTimeMs = useTimeStore.getState().live ? null : sceneTimeMs();
            let hash: string;
            if (fpvActive) {
              const eyeGeo = ecefToGeodetic([
                camera.position.x,
                camera.position.y,
                camera.position.z,
              ]);
              const eb = enuBasis(eyeGeo.latDeg, eyeGeo.lonDeg);
              camera.getWorldDirection(_camFwd);
              // dirAzAltDeg wraps az [0,360) — same output through formatFpvHash, which wraps anyway.
              const { azDeg: viewAzDeg, altDeg: viewAltDeg } = dirAzAltDeg(_camFwd, eb);
              hash = formatFpvHash(
                {
                  latDeg: eyeGeo.latDeg,
                  lonDeg: eyeGeo.lonDeg,
                  eyeM: fpvEyeAboveGroundM,
                  headingDeg: viewAzDeg,
                  pitchDeg: viewAltDeg,
                  fovDeg: camera.fov,
                },
                shareTimeMs,
              );
            } else {
              hash = formatSceneHash(
                {
                  latDeg: focusGeo.latDeg,
                  lonDeg: focusGeo.lonDeg,
                  altM: alt,
                  headingDeg: Number.isNaN(liveHeadingDeg) ? camStore.headingDeg : liveHeadingDeg,
                  tiltDeg: liveTiltDeg,
                },
                shareTimeMs,
              );
            }
            if (hash !== lastUrlPoseHash) {
              lastUrlPoseHash = hash;
              history.replaceState(null, "", hash);
            }
          }
        }

  };

  /** ULTRA HQ (owner 2026-08-22h) — the TILE half, applied on the chip's EDGE.
   *
   *  Split from the tier half on purpose. The tile levers (buildings SSE, street names, vector
   *  lattice, both LRU caps) are cheap to re-apply and land immediately, INCLUDING inside FPV.
   *  The tier half — the pin that stops the governor demoting — lives in GlobeCanvas and rides
   *  its existing `pendingTier` deferral, because a composer realloc mid-viewfinder is the
   *  owner-confirmed U2 "full re-render" bug.
   *
   *  Re-running `applyQualityTier(activeQualityTier)` rather than waiting for a governor change
   *  matters: on a machine that detects `high` the governor is a documented no-op, so it may
   *  never fire again and the chip would look dead. */
  const stepUltraGate = () => {
    const want = hqAllowed && useCameraStore.getState().ultraQuality === true;
    if (want === ultraOn) return;
    ultraOn = want;
    // RC18: the TILE half only. Proven inert as a change, not assumed: at a CONSTANT tier the
    // three lifted lines are all self-writes — ULTRA never overrides `overlayResolutionPx` (it is
    // on `quality.ts`'s explicit exclusion list, because `stickyOverlayPx` could never undo the
    // raise within the session), and `stars.setDpr` / `ground.refreshResolution` re-send the same
    // pixel ratio the renderer already has. `test/components/globe/fences.test.ts` pins the
    // exclusion so a future ULTRA overlay lever cannot silently stop being applied here.
    applyTierTiles(activeQualityTier);
    // --- the LOOK half (T44 §1a + T45), all edge-applied ---
    // Wake the look step: while OFF it early-returns, and only an edge can un-settle it. Without
    // this the OFF→ON flip would leave exposure, ambient and haze frozen at their baselines.
    ultraLookSettled = false;
    // T44 §1b — anisotropy. Stamped at texture CREATION, so this changes what NEW composites get
    // and leaves loaded ones alone: `anisotropy` is part of three's GL texture cache key, and
    // re-stamping live would mean a full re-upload of every drape in the working set. Documented
    // consequence: fly a little (or revisit) for the full effect. `maxAniso` is the GPU's real
    // ceiling (16 on the owner's machine); 1 is three's default, so OFF restores the exact
    // cache key the library would have produced on its own.
    ground.setUltraAnisotropy(ultraOn ? Math.min(ULTRA.anisotropy, maxAniso) : 1);
    // RC25 §1c — the capped mip chain, the other half of §1b. Anisotropy without mips can only
    // supersample WITHIN level 0; the chain is what gives heavy minification something correct to
    // sample. Same creation-time stamp, same "fly a little for the full effect" consequence, and
    // the same exact off-state: `1` level leaves `texture.mipmaps` at its `[]` library default
    // and `mipByteFactor(1)` is identically 1, so no ULTRA value changes a pixel OR a cached byte.
    ground.setUltraMipLevels(ultraOn ? ULTRA.mipLevels : 1);
    // S2 — the soft-shadow lever. NOT a shadowMap.type change: `PCFSoftShadowMap` is deprecated
    // in three 0.185 and silently rewritten to `PCFShadowMap` on the first depth pass. What
    // replaced it is a 5-tap Vogel disk rotated per pixel by interleaved gradient noise, where
    // `radius` scales the disk in texels — a LIVE uniform, no recompile, and because the disk is
    // per-pixel rotated a large radius degrades to noise rather than to banding.
    if (sunLight) {
      sunLight.shadow.radius = ultraOn ? ULTRA.shadowRadius : _shadowRadius0;
      sunLight.shadow.normalBias = ultraOn ? ULTRA.shadowNormalBias : _shadowNormalBias0;
    }
  };

  const stepGroundUpdate = () => {
        // S7a: dark drape unless the user opted into the satellite look (SAT chip).
        ground.update(
          alt,
          camStore.groundMode !== "satellite",
          flatGroundNow(),
        );
        // QA-7b (owner 2026-08-21f): the flat 2D CHART composites at overlayResolution2dPx —
        // the level chooser derives the Esri source zoom from resolution/rangeWidth, so the
        // 256 lean composite alone pins the chart one level shallow even with the coarse cap
        // at 18; the raise is what actually reaches z18. QA slice C (owner 2026-08-21g-end,
        // CRITICAL): the raise is STICKY — QA-7b restored the tier base the frame the chart
        // dropped, and every 2D↔FPV/3D flip was a fresh-instance overlay rebuild (white chart
        // + vector ink for seconds→10 s+ on device, tile refetch storm, then a blurry stall).
        // stickyOverlayPx only ratchets up (≤1 post-boot rebuild per rung per session);
        // setOverlayResolution no-ops on the same px, so the per-frame write stays free.
        overlayPxEff = stickyOverlayPx(
          overlayPxEff,
          tierOverlayPx,
          flatGround,
          GROUND.overlayResolution2dPx,
        );
        ground.setOverlayResolution(overlayPxEff);
        // RC20/T34: bank the OTHER mode's ground tiles across an FPV boundary. The library
        // rest-trims everything the current traversal did not visit down to `minBytesSize`
        // (`unused && cachedBytes > minBytesSize` — the cap is not consulted), so a flip costs
        // ~600 Esri GETs on the way back plus a full re-composite. Hold a raised floor for
        // QUALITY.lruBank.holdMs, then relax to the tier's own paired floor.
        //
        // The key is `fpvActive` and NOT `flatGround`: the flat latch carries an un-hysteresed
        // altitude term, so a camera parked at exactly CONTROLS.mapFlatMaxAltM would re-arm the
        // window every frame and silently turn the bounded bank into a permanent raised floor —
        // with the iOS memory cost T34 explicitly worries about, and nobody's decision.
        const fpvKey = fpvActive ? 1 : 0;
        groundBankMsLeft = bankWindowMsLeft(
          groundBankMsLeft,
          dtMs,
          groundFpvKey >= 0 && fpvKey !== groundFpvKey,
          QUALITY.lruBank.holdMs,
        );
        groundFpvKey = fpvKey;
        ground.setLruBank(groundBankMsLeft > 0 && QUALITY.lruBank.tiers[activeQualityTier]);
  };

  const stepEphemerisResample = () => {
        // Ephemeris: re-sample when scene time moved enough (live clock or a pinned scrub).
        tMs = sceneTimeMs();
        if (Math.abs(tMs - lastSampleMs) > SKY.sampleIntervalMs) sampleEphemeris(tMs);

  };

  /** ECLIPSES (owner 2026-08-22k) — ONE derivation, pushed to every consumer, exactly like the
   *  ULTRA light sample above.
   *
   *  It has to live HERE, before the key light and the sky bodies, for two reasons. The geometry
   *  is CAMERA-relative, so it cannot ride `sampleEphemeris`'s 1 Hz cadence (the camera moves every
   *  frame, and lunar parallax over a single flight is far larger than the whole eclipse); and the
   *  key light is stepped before the sky bodies, so deriving it inside `scene/sky.ts` would light
   *  the world with a frame-old eclipse.
   *
   *  The vectors are the ones the impostors are actually anchored on — geocentric `sunDirW` (solar
   *  parallax 8.6", ignorable) against the TOPOCENTRIC `moonPosW − camera.position`. That
   *  distinction is the entire bug: geocentrically the discs miss each other by 1.006° at the
   *  owner's Burgos instant, where the true topocentric separation is 0.062° and 88% of the sun is
   *  gone. A 1 s ephemeris sample is ample — the discs close at 1.7e-4 °/s, so a stale sample is
   *  0.065 px even at the tightest reachable zoom. */
  const stepEclipse = () => {
        const moonAngRadNow = angularRadiusRad(
          MOON_RADIUS_KM * 1000,
          moonPosW.distanceTo(camera.position),
        );
        _eclDelta.copy(moonPosW).sub(camera.position).normalize().sub(sunDirW);
        solarEcl = solarEclipseFromDiscs(_eclDelta.length(), sunAngRad, moonAngRadNow);
        // Ease the DARKNESS only. The geometry itself is already smooth; this exists so a scrub or
        // a time-jump across totality does not step the whole scene's lighting in a single frame.
        const target = eclipseDaylightK(
          solarEcl.coverage,
          ECLIPSE.daylightGamma,
          ECLIPSE.daylightFloor,
        );
        const nowMs = performance.now();
        const dtMs = nowMs - lastEclipseMs;
        lastEclipseMs = nowMs;
        eclipseK += (target - eclipseK) * easeK(dtMs, ECLIPSE.tauMs);
        // Snap the last thousandth so the OFF steady state is EXACTLY 1 and every downstream
        // multiply is a provable no-op (the ULTRA settle idiom).
        if (Math.abs(eclipseK - target) < 1e-3) eclipseK = target;
        // The GROUND grade is altitude-gated on the same ramp the sky regime uses. "The world went
        // dark" is a street-level truth: standing inside the umbra, everything you can see is
        // eclipsed. From orbit it is a ~100 km spot on a 12,700 km planet, and dimming the whole
        // day hemisphere would be a far bigger lie than leaving it alone — which is also why
        // `baseEarth` (the orbital ellipsoid) is deliberately not wired at all.
        const skyPresence =
          1 - THREE.MathUtils.smoothstep(alt, ATMOSPHERE.skyFullAlt, ATMOSPHERE.skyGoneAlt);
        ground.setEclipse(1 - skyPresence * (1 - eclipseK));
        // The dome's own multiply already sits inside its low-altitude branch, so it needs no gate.
        atmosphere.uniforms.uEclipse.value = eclipseK;
  };

  /** ULTRA LOOK (T44 §1a + T45 S4/S9/S10/S11) — ONE light sample, pushed to every consumer.
   *
   *  Runs AFTER stepGroundUpdate on purpose: the ground owns the haze gates (altitude, flat
   *  chart, dark drape) and its own easing, so reading its live `uFtwHaze` back out and handing
   *  THAT to the buildings is what makes "the same atmosphere over the city and over the ground"
   *  true by construction instead of by two parallel calculations agreeing. The cost is a
   *  one-frame lag on targets, which is nothing against easings of 0.4–1 s. */
  const stepUltraLook = () => {
    if (!ultraOn && ultraLookSettled) return; // the OFF steady state: zero per-frame cost
    const nowMs = performance.now();
    const dtMs = nowMs - lastUltraMs;
    lastUltraMs = nowMs;
    // `sunDirW · focusUp` IS sin(solar elevation) at the view focus — the same quantity the
    // ground shader evaluates per fragment, so the CPU-side terms (exposure, ambient, haze tint)
    // and the GPU-side one (dayK) are reading one curve family at one input.
    const light = ultraOn ? ultraLightAt(ULTRA, sunDirW.dot(_focusUp)) : null;

    // --- the band tint: a 4-stop palette ramp, at most two stops live at a time ---
    if (light) {
      const w = light.tint;
      _hazeCol.setRGB(
        w[0] * _hazeDayCol.r + w[1] * _hazeGoldCol.r + w[2] * _hazeBlueCol.r + w[3] * _hazeNightCol.r,
        w[0] * _hazeDayCol.g + w[1] * _hazeGoldCol.g + w[2] * _hazeBlueCol.g + w[3] * _hazeNightCol.g,
        w[0] * _hazeDayCol.b + w[1] * _hazeGoldCol.b + w[2] * _hazeBlueCol.b + w[3] * _hazeNightCol.b,
      );
    } else {
      _hazeCol.copy(_ultraZeroCol);
    }

    // --- RC23: the ULTRA × ECLIPSE seam. -----------------------------------------------------
    // Every ULTRA look term is driven by SOLAR ELEVATION, and an eclipse does not move the sun.
    // So at totality the band curve still says "day": the aerial perspective went on painting a
    // day-tinted haze over a world the eclipse had just darkened, and the hemisphere fill stayed
    // warm-lit — ULTRA's own additions covering the event. The principle, and the reason this is
    // three multiplies rather than a new curve: **under an eclipse ULTRA's day-driven additions
    // fade toward BASELINE**, because the darkening itself already lives in the shaders baseline
    // carries (`uFtwEclipse` on the ground, `uEclipse` on the dome, `× eclipseK` on the key).
    // Off-state is untouched by construction — `light` null already zeroes these — and with no
    // eclipse `eclipseK` is exactly 1, so the on-state is byte-identical too.
    // Exposure is deliberately NOT scaled here: it is a taste lever and lives in owner A/B AB5.
    // --- DUSK (owner defect 2, 2026-08-27): the three scalars that make the air-light LIGHT. ---
    //
    // One sample, one frame, every consumer — the standing rule of this track, now carrying the
    // terms whose absence produced "you uniformly illuminate the whole scene in some piss very
    // bright colour instead of naturally darkening scene and sky":
    //   · skyLevel  — the sky's own luminance. `hazeK` says how much of the far field is air;
    //                 this says how bright that air IS. Multiplying them is the fix.
    //   · afterglow — sun-side glow that OUTLIVES the sky level, below the horizon. Local by
    //                 construction: every consumer applies it through the Mie lobe.
    //   · directK   — how much direct sun survives extinction, driving BOTH the key light and the
    //                 ground's direct/ambient split so a wall and the ground it stands on dim
    //                 together. The COLOUR half of extinction is physical (`solarChroma`); this
    //                 level half is authored — see `ULTRA.keyExtinctCurve`.
    // × eclipseK for the same reason RC23 gives: ULTRA's day-driven additions must fade toward
    // baseline under an eclipse, because baseline already carries the darkening.
    const sinSunFocus = sunDirW.dot(_focusUp);
    ultraSkyLevel = light ? bandCurve(ULTRA.skyLevelCurve, sinSunFocus) * eclipseK : 0;
    ultraAfterglow = light ? bandCurve(ULTRA.afterglowCurve, sinSunFocus) * eclipseK : 0;
    ultraDirectK = light ? bandCurve(ULTRA.keyExtinctCurve, sinSunFocus) : 1;
    ultraEmisK = light ? bandCurve(ULTRA.buildingEmisCurve, sinSunFocus) : 1;
    ultraEdgeK = light ? bandCurve(ULTRA.buildingEdgeCurve, sinSunFocus) : 1;
    ultraDomeDir +=
      ((light ? ULTRA.domeDirK : 0) - ultraDomeDir) * easeK(dtMs, ULTRA.hazeTauMs);
    if (ultraDomeDir < 1e-4) ultraDomeDir = 0; // snap, so "off" is exactly off
    // The ANTI-SOLAR tint. The band ramp's own BLUE stop is exactly the right colour for the half
    // of the sky the sun is not in — reusing it keeps both ends of the directional swing inside
    // the palette (D14) instead of inventing a hue rotation nobody can tune.
    _hazeCoolCol.copy(_hazeBlueCol).lerp(_hazeDayCol, light ? light.tint[0] : 1);
    ground.setUltraTargets({
      photo3d: light ? ULTRA.photo3dK : 0,
      light: light ? 1 : 0,
      haze: light ? light.hazeK * eclipseK : 0,
      hazeCol: _hazeCol,
      hazeCool: _hazeCoolCol,
      skyLevel: ultraSkyLevel,
      afterglow: ultraAfterglow,
      directK: ultraDirectK,
    });
    // --- S4 to the buildings: the ground's EFFECTIVE, already-gated, already-eased value ---
    const hazeNow = ground.uniforms.uFtwHaze.value as number;
    buildings.setUltraHaze(hazeNow, _hazeCol, sunDirW, _hazeCoolCol, ultraSkyLevel, ultraAfterglow,
      ultraEmisK, ultraEdgeK);
    enriched?.setUltraHaze(hazeNow, _hazeCol, sunDirW, _hazeCoolCol, ultraSkyLevel, ultraAfterglow,
      ultraEmisK, ultraEdgeK);
    userModels.setUltraHaze(hazeNow, _hazeCol, sunDirW, _hazeCoolCol, ultraSkyLevel, ultraAfterglow); // MS6
    // --- RC24 to the SKY DOME: the same effective value, so the horizon haze the dome paints
    //     above the terrain agrees with the aerial perspective the ground paints below it. This
    //     is the one visible SEAM the ULTRA track shipped with (ULTRA_ARCHITECTURE §12).
    atmosphere.setUltraBand(
      hazeNow * ULTRA.domeTintK,
      _hazeCol,
      // The directional arm's own weight (taste pass 2026-08-27c) — eased on the ground's haze τ
      // so a chip flip dissolves, but NOT scaled by the haze value, which is what capped it at
      // 0.38 and made the afterglow a lerp target dimmer than the term it was replacing.
      ultraDomeDir,
      _hazeCoolCol,
      ultraSkyLevel,
      ultraAfterglow,
    );

    // --- S11 exposure: the cheapest "epic" lever, and the one that MUST ease. A per-frame
    //     exposure step reads as a flicker, and while scrubbing the sun can cross a whole
    //     twilight band in a handful of frames. OutputPass re-reads this every render.
    const expTarget = (light ? light.exposureK : 1) * RENDERER.toneMappingExposure;
    ultraExposure += (expTarget - ultraExposure) * easeK(dtMs, ULTRA.exposureTauMs);
    renderer.toneMappingExposure = ultraExposure;

    // --- S10 hemisphere: local up + ephemeris tint/intensity (audit gap #16) ---
    if (hemiLight && _hemiSky0 && _hemiGround0 && _hemiPos0) {
      const k = easeK(dtMs, ULTRA.exposureTauMs);
      // Direction. three normalizes the light's world position, so a unit vector is the whole
      // API. Eased rather than snapped ONLY so the OFF edge doesn't flip the ambient in a frame;
      // while on, `_focusUp` moves continuously with the camera and the ease is invisible.
      hemiLight.position.lerp(light && ULTRA.hemiTrackUp ? _focusUp : _hemiPos0, k);
      hemiLight.intensity += ((light ? SUN.hemiIntensity * light.hemiK : _hemiIntensity0) - hemiLight.intensity) * k;
      // Sky half tracks the band tint (warm skylight at dusk is what keeps buildings coherent
      // with the ground's band curve); ground half stays put — bounce off dark terrain has no
      // reason to change colour with the sun.
      // × eclipseK (RC23): the band tint is a function of solar elevation, so at totality it is
      // still "day" and would keep the ambient warm over a darkened world. Scaling the MIX (not
      // the colour) walks the hemisphere back to its baseline sky as the light goes — baseline is
      // already eclipse-correct, so converging on it is the coherent answer.
      hemiLight.color.lerp(
        light ? _hemiSky0.clone().lerp(_hazeCol, ULTRA.hemiTintK * eclipseK) : _hemiSky0,
        k,
      );
      hemiLight.groundColor.lerp(_hemiGround0, k);
    }

    // --- settle: snap EXACTLY to baseline and stop stepping, so "off" is off ---
    if (!ultraOn) {
      const expDone = Math.abs(ultraExposure - RENDERER.toneMappingExposure) < 1e-4;
      const hemiDone =
        !hemiLight ||
        !_hemiPos0 ||
        (hemiLight.position.distanceToSquared(_hemiPos0) < 1e-8 &&
          Math.abs(hemiLight.intensity - _hemiIntensity0) < 1e-4);
      if (expDone && hemiDone && hazeNow === 0) {
        ultraExposure = RENDERER.toneMappingExposure;
        renderer.toneMappingExposure = ultraExposure;
        if (hemiLight && _hemiSky0 && _hemiGround0 && _hemiPos0) {
          hemiLight.color.copy(_hemiSky0);
          hemiLight.groundColor.copy(_hemiGround0);
          hemiLight.position.copy(_hemiPos0);
          hemiLight.intensity = _hemiIntensity0;
        }
        buildings.setUltraHaze(0, _ultraZeroCol, sunDirW, _ultraZeroCol, 0, 0, 1, 1);
        enriched?.setUltraHaze(0, _ultraZeroCol, sunDirW, _ultraZeroCol, 0, 0, 1, 1);
        userModels.setUltraHaze(0, _ultraZeroCol, sunDirW, _ultraZeroCol, 0, 0); // MS6
        ultraSkyLevel = 0;
        ultraAfterglow = 0;
        ultraDomeDir = 0;
        ultraDirectK = 1;
        ultraEmisK = 1;
        ultraEdgeK = 1;
        atmosphere.setUltraBand(0, _ultraZeroCol, 0, _ultraZeroCol, 0, 0);
        ultraLookSettled = true;
      }
    }
  };

  const stepKeyLightAndShadow = () => {
        // Key light + the ONE shadow rig (S5 §Item 7: source switch, never a second rig).
        // Sun mode: ephemeris direction; colour warms through the golden band at the focus;
        // shadows at city altitudes while the sun is up there (a below-horizon sun would
        // project garbage). Moon mode: sun down + bright-enough moon up → the SAME light
        // impersonates the moon (direction, cool colour, K&S phase intensity) and the
        // dedicated moonLight stands down so the night key is never doubled.
        moonShadows = false;
        moonRigTakeover = 0;
        // ULTRA S5/S3: the light must stand far enough off the focus to clear the RELIEF, not
        // just the rooftops. `SHADOWS.lightDistM` 8 km puts the light inside Everest's own air
        // column, so a summit would sit behind the shadow camera's near plane and drop out of
        // the depth pass entirely — the feature would silently do nothing exactly where the
        // owner asked for it. Ortho shadow cameras pay no texel-density cost for distance; only
        // depth precision, and D24 over ~96 km still resolves ~6 mm.
        const shadowLightDistM = ultraOn ? ULTRA.lightDistM : SHADOWS.lightDistM;
        if (sunLight) {
          // Flat map = no synthetic shadow rig (owner 2026-08-18e): the day-graded photo already
          // carries the real capture shadows; the depth pass + receiver draws bought a second,
          // contradicting set (and on /m 2D the casters are detached anyway).
          // RC3 (owner bug B4a): the `!!focusHit` term is GONE. It survived the ULTRA rewrite
          // verbatim and was the single biggest shadow killer in FPV — any look at or slightly
          // above level nulls the ellipsoid intersection, and one frame later `castShadow` was
          // false AND `setTerrainCast(false)` had detached every terrain caster. Worst exactly
          // where the owner reported it: over mountains `alt` is ellipsoidal, the ray exits
          // through the relief, and a look at a facing peak barely above level killed all
          // shadows while terrain filled the frame. The rig no longer needs a hit — RC4's
          // `_shadowFocus` is built from the EYE, which always exists.
          const shadowEligible = alt < SHADOWS.maxAltM && !flatGroundNow();
          const sunDot = sunDirW.dot(_focusUp);
          const moonDot = moonDirW.dot(_focusUp);
          const sunUp = sunDot > SHADOWS.minSunElevSin;
          const sunShadows = shadowEligible && sunUp;
          moonShadows =
            shadowEligible &&
            !sunUp &&
            moonDot > SHADOWS.minSunElevSin &&
            moonIllum >= SHADOWS.moonMinIllum;
          // --- RC2 (owner bug B3): kill the boolean snap at the elevation gate. -----------------
          // Every hard flip that used to land on `minSunElevSin` — the shadow field, the sun→moon
          // key handoff, the dedicated moonlight standing down — is scaled by one of the ramps in
          // lib/globe/keyHandoff, which are built so that both arms reach zero contribution at the
          // crossing frame. The handoff weight below is the share of the moon key the RIG carries;
          // the dedicated light in scene/sky.ts carries the rest, so the two always sum to moonKs.
          moonRigTakeover = moonShadows ? moonRigTakeoverK(sunDot, KEY_GATE) : 0;
          // RC4 — frame the rig on the VIEW. `_shadowFocus` is a GROUND point built from the eye,
          // never the screen-centre ellipsoid hit, so it exists at every pitch (see lib/globe/
          // shadowFit for why pitch, not altitude, decided foreground coverage before this).
          if (sunShadows || moonShadows) {
            const eyeAlt = Math.max(alt, 0);
            _eyeUp.copy(camera.position).normalize();
            _eyeGround.copy(camera.position).addScaledVector(_eyeUp, -eyeAlt);
            let viewDistM: number;
            if (focusHit) {
              _shadowFocus.set(focusHit[0], focusHit[1], focusHit[2]);
              viewDistM = _shadowFocus.distanceTo(_eyeGround);
            } else {
              viewDistM = horizonDistanceM(eyeAlt, WGS84_A);
            }
            const fit = fitShadowBox(
              eyeAlt,
              viewDistM,
              ultraOn ? _shadowFitUltra : _shadowFitBase,
            );
            shadowBoundsM = fit.halfExtentM;
            shadowViewFitM = fit.viewDistM;
            shadowViewDistM = viewDistM;
            // Horizontal look direction. At nadir this degenerates to the zero vector, which
            // three's normalize() leaves at zero — and `pushM` is ~0 there anyway, so the box
            // lands centred under the eye exactly as it did before RC4.
            _fwdHoriz.copy(_camFwd).addScaledVector(_eyeUp, -_camFwd.dot(_eyeUp)).normalize();
            _shadowFocus.copy(_eyeGround).addScaledVector(_fwdHoriz, fit.pushM);
          }
          // Per-mode shadow contrast (S7a): the flat dark drape carries a stronger overlay —
          // blended by the live dark fraction so the crossfade never steps the shadows.
          const dark01 = ground.darkBlend();
          if (moonShadows) {
            // Moon "golden hour": warm the cool moon key as the moon grazes the horizon (the SAME
            // golden bell, over MOON elevation) — mirrors the sun's dusk so both keys share one dusk
            // language across the cycle. GOLDEN.moonKeyStrength 0 → pure cool moonlight (no-op).
            const moonGoldenK = goldenFactor(moonDot, GOLDEN);
            sunLight.color.copy(_moonKeyCol).lerp(_goldenCol, moonGoldenK * GOLDEN.moonKeyStrength);
            // × moonRigTakeover (RC2): the rig only carries as much of the moon key as the
            // dedicated moonLight has given up this frame — the two always sum to moonKs.
            sunLight.intensity = SKY.moonKeyIntensity * moonKs * moonRigTakeover;
            sunLight.position.copy(_shadowFocus).addScaledVector(moonDirW, shadowLightDistM);
            sunLight.target.position.copy(_shadowFocus);
            ground.setShadowStrength(
              THREE.MathUtils.lerp(SHADOWS.moonGroundOpacity, DRAPE.moonShadowOpacity, dark01) *
                moonKs,
            );
            // RC2: fade the shadow field over BOTH gates the moon arm sits between — its own
            // elevation, and how far the sun has committed to being down. At the crossing frame
            // both are 0, which is where the sun arm's fade also lands.
            sunLight.shadow.intensity = Math.min(aboveGateK(moonDot, KEY_GATE), moonRigTakeover);
          } else {
            const goldenK = goldenFactor(sunDot, GOLDEN);
            sunLight.color.lerpColors(_keyWhite, _goldenCol, goldenK * GOLDEN.keyStrength);
            // --- DUSK (owner defect 2, 2026-08-27): the key finally dies, and reddens honestly.
            //
            // "the sun is still too bright when it is lower than around 3-4 degrees, make sure to
            // realistically dim it and change color due to atmosphere refraction closer to the
            // horizon." Both halves were missing: `sunExtinctionK` in scene/sky.ts dims only the
            // DISC IMPOSTOR, and the line above actually BRIGHTENS the key by up to 35 % through
            // the golden band and carries full strength to the horizon.
            //
            // The two halves are deliberately different in kind. The COLOUR is physics —
            // Kasten-Young airmass through per-channel Rayleigh+aerosol optical depth
            // (`lib/globe/solarChroma`), which is why the last light of the day is orange and not
            // merely "the golden token, more of it". The LEVEL is an authored curve, because true
            // transmittance at 0° is ~1 % of zenith and this renderer has an exposure ramp rather
            // than an adapting eye (the full argument is on `ULTRA.keyExtinctCurve`).
            //
            // ULTRA-only, and inert by construction when off: `ultraDirectK` is seeded and reset
            // to exactly 1, and the chroma lerp is skipped entirely.
            if (ultraOn) {
              const chroma = solarChroma(THREE.MathUtils.radToDeg(Math.asin(
                THREE.MathUtils.clamp(sunDot, -1, 1),
              )));
              _keyChroma.setRGB(chroma[0], chroma[1], chroma[2]);
              sunLight.color.lerp(
                _keyChroma.multiply(sunLight.color),
                ULTRA.keyChromaK,
              );
            }
            // Golden hour also BRIGHTENS the building key (warm rim-lit swell, not just a hue shift —
            // the biggest visible building-dusk win). keyBrighten 0 → ×1 = byte-identical.
            // × eclipseK: the key light IS the sun, so an eclipse dims it first. This is the
            // solar arm only — the moon arm above carries its own (lunar) dimming through moonKs.
            //
            // RC2's trough: ONLY where a qualifying moon is about to take the key. With no moon
            // waiting there is no source switch to hide, and troughing anyway would kill the
            // phantom night key that the frozen night look currently depends on — that is owner
            // A/B item AB1, not this slice's call.
            sunLight.intensity =
              SUN.keyIntensity *
              (1 + goldenK * GOLDEN.keyBrighten) *
              eclipseK *
              sunKeyTroughK(sunDot, moonDot, moonIllum, KEY_GATE) *
              // The extinction LEVEL. Exactly 1 with the chip off (`ultraDirectK` is seeded 1 and
              // the settle path restores it), so the baseline key is byte-identical.
              ultraDirectK;
            // TASTE PASS (2026-08-27c) — "shadows that were there before should not just
            // disappear, they should become darker and more global."
            //
            // `aboveGateK` fades the WHOLE shadow field out over `SHADOWS.fadeBandSin` = sin(3°):
            // measured, the overlay is at 52 % by +2° and 9 % by +1°, which is precisely the band
            // where a raking terrain shadow is the most dramatic thing in the frame. That loss is
            // recorded on the tunable itself as owner A/B item AB4, deferred for a verdict; the
            // verdict is now in.
            //
            // The band cannot just be deleted — it is also what hides the sun→moon SOURCE SWITCH,
            // which teleports the rig's direction at `minSunElevSin`. So ULTRA gets its OWN,
            // narrow band for the shadow field alone (still exactly 0 AT the gate, so the
            // teleport still happens at zero contribution) while the key trough and the moon
            // takeover keep the wide one. Byte-identical with the chip off.
            sunLight.shadow.intensity = aboveGateK(sunDot, ultraOn ? ULTRA_SHADOW_GATE : KEY_GATE);
            if (sunShadows) {
              sunLight.position.copy(_shadowFocus).addScaledVector(sunDirW, shadowLightDistM);
              sunLight.target.position.copy(_shadowFocus);
              // …and the overlay DEEPENS as the sun comes down the wide band — "darker", without
              // touching the shadow's SHAPE (the elongated-projection failure mode RC4 and the
              // cascades exist to avoid). `duskK` is 0 above the band, so this is exactly the
              // shipped expression at any ordinary sun angle, and exactly it again with the chip
              // off.
              const duskK = ultraOn ? 1 - aboveGateK(sunDot, KEY_GATE) : 0;
              ground.setShadowStrength(
                THREE.MathUtils.lerp(
                  THREE.MathUtils.lerp(SHADOWS.groundOpacity, DRAPE.shadowOpacity, dark01),
                  ULTRA.groundShadowDuskK,
                  duskK,
                ) * eclipseK,
              );
            } else {
              // direction-only mode: keep the terminator agreement for building shading everywhere
              sunLight.position.copy(sunDirW).multiplyScalar(SUN.keyLightFarM);
              sunLight.target.position.set(0, 0, 0);
            }
          }
          sunLight.castShadow = sunShadows || moonShadows;
          // Altitude-adaptive shadow ORTHO bounds (2026-07-13): the fixed ±boundsM patch is tight for
          // street-level crispness but left an oblique CITY view mostly shadowless (buildings sat
          // outside a 1.6 km patch). Widen the shadow map with altitude so the visible ground gets
          // shadows; extend the depth range with it so far-from-focus buildings stay inside the frustum.
          // Only touched while casting (skips the updateProjectionMatrix cost at orbit / night).
          if (sunLight.castShadow) {
            // ULTRA S3: the base rig caps at SHADOWS.maxBoundsM 5 km — sized for CITY blocks, and
            // therefore useless for terrain, which casts tens of kilometres at low sun. The wider
            // ULTRA cap costs texels/metre, which is precisely what the 8192² map buys back; and
            // because the extent still RIDES ALTITUDE, the trade self-selects: at street level
            // both profiles clamp to boundsM (8192² over 1.6 km ≈ 0.39 m/texel — the crispest
            // building shadows this app has ever had), while a mountain view spends the same
            // texels on 11 km of relief. That altitude ramp is doing a cascade's job for free,
            // which is the other half of why CSM was not worth its blast radius here.
            //
            // RC4 folded the VIEW DISTANCE into the same number (lib/globe/shadowFit): the
            // altitude ramp is now a floor under a fit, and the result is quantized so this
            // block still only runs when the extent actually moved.
            const b = shadowBoundsM;
            const shCam = sunLight.shadow.camera;
            // The `shadowRigUltra` term is load-bearing: at street level `b` is identical under
            // both profiles, so a bounds-only comparison would leave near/far and the derived
            // bias on the OLD profile after a chip flip — a silent, position-dependent bug.
            if (shCam.right !== b || shadowRigUltra !== ultraOn) {
              shadowRigUltra = ultraOn;
              const margin = ultraOn ? ULTRA.depthMarginM : SHADOWS.depthMarginM;
              shCam.left = -b;
              shCam.right = b;
              shCam.top = b;
              shCam.bottom = -b;
              shCam.near = Math.max(1, shadowLightDistM - margin - b);
              shCam.far = shadowLightDistM + margin + b;
              shCam.updateProjectionMatrix();
              // `shadow.bias` is added to shadowCoord.z AFTER the divide, and an ortho shadow
              // matrix maps to [0,1] LINEARLY in view depth — so its unit is *fraction of the
              // near→far range*, and it silently rescales whenever that range moves. The base
              // rig's −2e-4 over 7,000 m is −1.4 m; over ULTRA's ~96 km the SAME constant would
              // be −19 m and detach every shadow from its caster. Derive it from metres instead.
              sunLight.shadow.bias = ultraOn
                ? -ULTRA.shadowBiasM / Math.max(1, shCam.far - shCam.near)
                : _shadowBias0;
            }
          }
          // --- THE CASCADES (owner defect 1, 2026-08-27) -----------------------------------------
          //
          // Everything above frames ONE box and caps it, which is why the owner's mountain views
          // showed a straight cut across the middle distance with everything beyond it fully lit:
          // measured, `viewFitM` runs 100–430 km at his poses against an 18 km `boundsM`. These
          // are the boxes outside it. The argument, the coverage table and the invariants are in
          // `lib/globe/shadowCascade`; this block is the wiring, and it owns three rules:
          //
          //  · LOCKSTEP DOWN, NEVER UP. A cascade casts only while `sunLight` does. three indexes
          //    `directionalShadow[]` by position among ALL directional lights and then truncates
          //    to the CASTER COUNT, so a non-casting light in front of a casting one drops the
          //    caster's shadow entirely (`WebGLLights.js:295-305,459-465`). `sun` is first, so
          //    cascades-off-while-sun-on is fine and is how a chip flip lands; the reverse would
          //    be a silent, position-dependent corruption and is structurally impossible here.
          //  · MOVE ONLY WHEN REFRESHING. `shadow.autoUpdate` is false, and the skip in
          //    `WebGLShadowMap.js:170` happens BEFORE `updateMatrices` — so a cascade that is not
          //    re-rendered this frame keeps a shadow matrix that still matches its map. Moving the
          //    light without setting `needsUpdate` would slide the sampled map off its geometry.
          //  · CENTRED ON THE EYE, not pushed down the look like cascade 0. Two reasons and both
          //    matter: the box then CONTAINS the eye at every pitch (so the ladder is strictly
          //    nested and no gap between cascades is possible), and it does not move when the
          //    camera merely turns — which is what makes a 1.5 s refresh cadence invisible.
          if (shadowCascades.length > 0) {
            const casting = sunLight.castShadow;
            _casKey.copy(moonShadows ? moonDirW : sunDirW);
            const epoch = ground.terrainEpoch();
            const nowMs = performance.now();
            const fits = fitCascades(
              shadowViewDistM,
              shadowBoundsM,
              ULTRA.cascadeReliefM,
              ULTRA.cascadeLightClearM,
              ULTRA.cascades,
            );
            for (let i = 0; i < shadowCascades.length; i++) {
              const cl = shadowCascades[i];
              const st = _cascadeState[i];
              const fit = casting && ultraOn ? fits[i] : null;
              st.active = fit !== null;
              if (!fit) {
                cl.castShadow = false;
                st.halfExtentM = 0; // force a full re-render when it comes back
                continue;
              }
              cl.castShadow = true;
              // The shadow FADE is cascade 0's, verbatim: the ladder must vanish over the same
              // elevation gate the key does, or dusk would step at the edge of the near box.
              cl.shadow.intensity = sunLight.shadow.intensity;
              const stale = cascadeNeedsRender({
                halfExtentM: fit.halfExtentM,
                appliedHalfExtentM: st.halfExtentM,
                centreDriftM: st.centre.distanceTo(_eyeGround),
                keySwingRad: st.keyDir.angleTo(_casKey),
                epoch,
                appliedEpoch: st.epoch,
                ageMs: nowMs - st.lastMs,
                moveFrac: ULTRA.cascadeMoveFrac,
                swingRad: _cascadeSwingRad,
                maxStaleMs: ULTRA.cascadeMaxStaleMs,
              });
              if (!stale) continue;
              const shCam = cl.shadow.camera;
              if (shCam.right !== fit.halfExtentM) {
                shCam.left = -fit.halfExtentM;
                shCam.right = fit.halfExtentM;
                shCam.top = fit.halfExtentM;
                shCam.bottom = -fit.halfExtentM;
                shCam.near = fit.nearM;
                shCam.far = fit.farM;
                shCam.updateProjectionMatrix();
              }
              cl.shadow.bias = fit.bias;
              cl.shadow.normalBias = fit.normalBiasM;
              cl.position.copy(_eyeGround).addScaledVector(_casKey, fit.lightDistM);
              cl.target.position.copy(_eyeGround);
              cl.shadow.needsUpdate = true;
              st.halfExtentM = fit.halfExtentM;
              st.centre.copy(_eyeGround);
              st.keyDir.copy(_casKey);
              st.epoch = epoch;
              st.lastMs = nowMs;
              st.metresPerTexel = fit.metresPerTexel;
              st.biasM = fit.biasM;
            }
          }
          // S3 TERRAIN CASTS — the owner's named killer feature. Gated on the shadow pass being
          // live at all (no caster matters when nothing receives), on altitude, and off the flat
          // chart. `setTerrainCast` no-ops when unchanged, so this is a comparison per frame.
          ground.setTerrainCast(
            ultraOn &&
              ULTRA.terrainCast &&
              (sunShadows || moonShadows) &&
              alt < ULTRA.terrainCastMaxAltM,
          );
        }
        // Pass 2 R3 (Dnipro identity): the night-side building facade emissive tracks the SAME
        // terminator at the view focus (sine of the sun's elevation → night factor) and lights only
        // walls perpendicular to the focus up (roofs stay dark). The enriched set mirrors it
        // (Slice 2 stylization reconcile — one ephemeris sample drives both tilesets).
        buildings.setNight(sunDirW.dot(_focusUp), _focusUp);
        enriched?.setNight(sunDirW.dot(_focusUp), _focusUp);
  };

  const stepSkyBodies = () => {
        // Sun + moon bodies (camera-anchored, true apparent size; moon angular size uses the
        // camera→moon distance — it varies ±2% across an orbit swing).
        sky.update({
          camera,
          alt, // shared geodetic sample (stepGeodeticAltitude) — drives the horizon fade band
          sunDir: sunDirW,
          moonPos: moonPosW,
          sunAngRad,
          moonAngRad: angularRadiusRad(MOON_RADIUS_KM * 1000, moonPosW.distanceTo(camera.position)),
          // RC2: was `moonShadows ? 0 : moonKs` — a same-frame flip at the sun's elevation gate,
          // which is one half of what made sunset step. The dedicated light now gives up exactly
          // the share the rig has taken (`moonRigTakeover`), so the moon key is continuous while
          // the source changes underneath it and the night key is still never doubled.
          // A-BLD-5 (owner taste pass, 2026-08-27c): the dedicated moonlight had NO moon-elevation
          // term anywhere on its path, so a BELOW-HORIZON moon still keyed every wall whose
          // azimuth faced it — at sun elevation 0 that is 82 % of the sun key, and 33× stronger in
          // the blue channel. The asymmetry is what proves it an oversight rather than a decision:
          // the GROUND has gated its moon terms on moon elevation since S7 (`moonUp` in
          // imageryGround), and the buildings never did, so the two disagreed about whether the
          // moon was up. Same ramp the sun/moon handoff already uses; exactly 1 with the chip off.
          moonIntensity:
            moonKs *
            (1 - moonRigTakeover) *
            (ultraOn ? aboveGateK(moonDirW.dot(_focusUp), KEY_GATE) : 1),
          // Owner taste pass (2026-08-27c) — the disc now carries its own authored LEVEL curve
          // and an opacity ramp, because scaling an ADDITIVE impostor down can only ever dissolve
          // it into the sky (see SKY.discLevelCurve). `false` restores the shipped disc exactly.
          ultraDisc: ultraOn,
          solar: solarEcl, // derived in stepEclipse from these same vectors, one frame earlier
          lunar: lunarEcl,
        });

  };

  const stepSkyTarget = () => {
        // Tracked sky target (ASTRO ENGINE phase A — generalises the 2026-08 comet tracer) —
        // same impostor machinery as the sun/moon, gated by the TARGET panel's toggles (store
        // read per frame: getState() is a reference read, the panel writes at most on a click).
        // A SKY-search target swap re-samples the ephemeris immediately — the 1 s cadence would
        // otherwise show the OLD body's direction under the new body's treatment for a beat.
        const skyNow = useSkyStore.getState();
        if (skyNow.target.id !== lastTargetId) sampleEphemeris(sceneTimeMs());
        // Finite-distance targets (moon/sun/planets/comets): re-derive the camera-relative
        // direction per frame from the banked ECEF position — diurnal parallax for the marker
        // (up to ~0.95° for the moon; see the targetPosW note above). Stars/DSOs stay geocentric.
        if (targetDistM != null)
          targetDirW.copy(targetPosW).sub(camera.position).normalize();
        const t = targetState;
        skyTarget.update({
          camera,
          alt,
          dir: targetDirW,
          tailDir: t?.tailDir ? targetTailW : null,
          sunDir: sunDirW,
          kind: skyNow.target.kind,
          magnitude: t?.magnitude ?? null,
          apparent: skyNow.target.apparent ?? null,
          angularDiamArcsec: t?.angularDiamArcsec ?? null,
          ringPoleDir: targetHasPole ? targetPoleW : null,
          visible: skyNow.visible,
          highlight: skyNow.highlight,
        });
        // The target's trajectory (phase C) — anchored at the SAME eye the TargetPanel prints
        // numbers for: the plan anchor when standing somewhere, else the view focus (the mirror
        // is low-cadence, but the trail rebuild is deadbanded far coarser than its lag).
        const planAnchor = usePlanStore.getState().anchor;
        skyTrail.update({
          camera,
          sceneMs: tMs,
          target: skyNow.target,
          anchor: planAnchor ?? {
            latDeg: camStore.focusLatDeg,
            lonDeg: camStore.focusLonDeg,
          },
          visible: skyNow.visible && skyNow.trail,
          dtMs,
        });
        // Temporal ghost copies (QoL-2, owner 2026-08-14) — same eye, same gate family.
        skyGhosts.update({
          camera,
          sceneMs: tMs,
          target: skyNow.target,
          anchor: planAnchor ?? {
            latDeg: camStore.focusLatDeg,
            lonDeg: camStore.focusLonDeg,
          },
          visible: skyNow.visible && skyNow.ghosts,
          countPerSide: skyNow.ghostCount,
          stepMin: skyNow.ghostStepMin,
          dtMs,
        });
  };

  // FIND v2 projections (owner rework 2026-08-14): the FIND panel computes the standings into
  // store/find; this step only draws + hit-tests the mirror. Runs right after stepSkyTarget so
  // the LIVE topocentric moon direction (the now-gap reference) matches the frame's own disc.
  const _fgMoonDir = new THREE.Vector3();
  const _fgHoverKeys: (string | null)[] = [null, null];
  const stepFindGhosts = () => {
        const findNow = useFindStore.getState();
        _fgHoverKeys[0] = findNow.hoverKey;
        _fgHoverKeys[1] = findNow.sceneHoverKey;
        findGhosts.update({
          camera,
          anchor: findNow.anchor,
          ghosts: findNow.ghosts,
          visible: findNow.open,
          hoverKeys: _fgHoverKeys,
          sunDirW,
          moonDirW: _fgMoonDir.copy(moonPosW).sub(camera.position).normalize(),
          dtMs,
        });
  };

  // --- Sky-body hover (qol3, owner 2026-08-14: right-click discoverability): the pointer
  //     resting on the sun/moon/tracked target lifts that body's brightness VERY slightly —
  //     the pin-hover grammar (banked hoverX/Y + cadence-gated angular pick + house exp ease).
  //     Runs the SAME pickSkyBody the context menu hits, so what glows is exactly what a
  //     right-click opens. Must run AFTER stepSkyBodies/stepSkyTarget: sun/moon lifts are
  //     absolute re-derivations (setHoverGlow), the target's is a post-update multiply.
  const skyHoverAmt = { sun: 0, moon: 0, target: 0 };
  let skyHoverKind: "sun" | "moon" | "target" | null = null;
  // FIND ghost hover (v2 rework): a projected standing under the pointer — pulses the ghost,
  // highlights its panel row (store/find.sceneHoverKey), and outranks the star-name reveal
  // (it is clickable; names are not). Bodies outrank ghosts.
  let skyGhostKey: string | null = null;
  // Sky NAMES hover (qol4): stars/asterisms/constellations, night sky only, bodies win ties.
  let skyNameHit: ReturnType<typeof skyNames.hitAt> = null;
  let skyNameLast: ReturnType<typeof skyNames.hitAt> = null;
  let skyNameAmt = 0;
  let skyNameNight = 0;
  const _skyNameUp = new THREE.Vector3();
  const stepSkyHover = () => {
        // Tap-reveal latch (M3c): while parked (touch tap on open sky), the tap point IS the
        // hover point — the whole cascade below (glow / ghost pulse / names) runs off it.
        const tapLatch = tapRevealUntil > performance.now() && !Number.isFinite(hoverX);
        const hx = tapLatch ? tapRevealX : hoverX;
        const hy = tapLatch ? tapRevealY : hoverY;
        const eligible = Number.isFinite(hx) && !anyPointerDown && !placingNow();
        if (!eligible) {
          skyHoverKind = null;
          skyGhostKey = null;
        } else if (frameCount % ORCH.skyHoverEveryFrames === 0) {
          const rect = dom.getBoundingClientRect();
          const [nx, ny] = clientToNdc(hx, hy, rect);
          const hit = pickSkyBody(nx, ny);
          // The context menu's own horizon floor: a "hit" on a set body is really terrain.
          skyHoverKind =
            hit && dirToAzAltAtCamera(hit.dir).altDeg >= ORCH.skyMenuMinAltDeg ? hit.kind : null;
          // Ghost pick reuses the _pickRay pickSkyBody just seated in this SAME cadence tick.
          skyGhostKey = skyHoverKind
            ? null
            : (findGhosts.pick(_pickRay.ray.direction, hitPadK)?.key ?? null);
        }
        // Row-highlight mirror (identity-guarded — the store must not churn per frame).
        if (useFindStore.getState().sceneHoverKey !== skyGhostKey)
          useFindStore.getState()._setSceneHover(skyGhostKey);
        // Name reveal (qol4, owner 2026-08-14: "reveal (very gently) their names"): the star-
        // field's own night ramp gates it — no names on a day sky — and a body hover outranks
        // a name. pickSkyBody above just seated _pickRay for this cadence tick; the same ray
        // rotated by +GAST (the star sphere applies −GAST) is the J2000 hit-test direction.
        skyNameHit = eligible && !skyHoverKind && !skyGhostKey ? skyNameHit : null;
        if (eligible && !skyHoverKind && !skyGhostKey && frameCount % ORCH.skyHoverEveryFrames === 0) {
          _skyNameUp.copy(camera.position).normalize();
          const sunEl = sunDirW.dot(_skyNameUp);
          skyNameNight = THREE.MathUtils.clamp(
            (STARS.nightVisStartSin - sunEl) / (STARS.nightVisStartSin - STARS.nightVisFullSin),
            0,
            1,
          );
          if (skyNameNight > 0.05) {
            skyNames.ensureLoaded(); // lazy catalogs — first eligible night hover kicks it
            const d = _pickRay.ray.direction;
            if (dirToAzAltAtCamera(d).altDeg >= ORCH.skyMenuMinAltDeg) {
              const cg = Math.cos(gastRad);
              const sg = Math.sin(gastRad);
              skyNameHit = skyNames.hitAt(
                [d.x * cg - d.y * sg, d.x * sg + d.y * cg, d.z],
                fpvActive && useCameraStore.getState().skyGuides,
              );
            } else skyNameHit = null;
          } else skyNameHit = null;
        }
        const kh = 1 - Math.exp(-dtMs / ORCH.skyHoverEaseTauMs);
        for (const k of ["sun", "moon", "target"] as const) {
          const target = skyHoverKind === k ? 1 : 0;
          const next = skyHoverAmt[k] + (target - skyHoverAmt[k]) * kh;
          skyHoverAmt[k] = Math.abs(next - target) < 0.004 ? target : next;
        }
        sky.setHoverGlow(skyHoverAmt.sun * ORCH.skyHoverGain, skyHoverAmt.moon * ORCH.skyHoverGain);
        skyTarget.hoverBoost(skyHoverAmt.target * ORCH.skyHoverGain);
        // The name label breathes with the same house ease, scaled by the night ramp; it
        // follows the live cursor every frame (the eased alpha alone changes at cadence).
        // skyNameLast keeps the outgoing text during the fade-out so it melts, never pops.
        if (skyNameHit) skyNameLast = skyNameHit;
        const nameTarget = skyNameHit ? skyNameNight : 0;
        skyNameAmt += (nameTarget - skyNameAmt) * kh;
        if (Math.abs(skyNameAmt - nameTarget) < 0.004) skyNameAmt = nameTarget;
        if (skyNameAmt > 0.02 && skyNameLast && Number.isFinite(hx))
          // On the tap latch the label lifts extra px — out from under the fingertip.
          skyNames.show(skyNameLast, hx, hy - (tapLatch ? ORCH.tapRevealLiftPx : 0), skyNameAmt);
        else skyNames.hide();
        // Cursor hint. The placing crosshair owns the cursor while placing (eligible=false and
        // we never write over "crosshair"); stepPinHover runs later and leaves "pointer" in
        // place while a sky body owns it (pins win ties simply by running last).
        if (skyHoverKind || skyGhostKey) dom.style.cursor = "pointer";
        else if (dom.style.cursor === "pointer" && !usePinsStore.getState().hoverPin)
          dom.style.cursor = "";
  };

  const stepFrustumResnapAndTick = () => {
        // Re-seat the placed photo as terrain tiles refine under it (low cadence — a raycast).
        // U2/A4: NOT while standing IN the photo — the camera sits on the apex, and resnap's
        // 0.5 m-threshold rebuild is a snap (not an ease), so a terrain refine would teleport
        // the photographer's eye mid-look. Deferred: the next cadence tick after exit re-seats.
        // (frameCount still ticks every frame — it splits every cadence gate, the order contract.)
        if (
          ++frameCount % FRUSTUM.resnapEveryFrames === 0 &&
          !(fpvActive && fpvKind === "photo")
        )
          frustum.resnap();

  };

  const stepArrivalReframing = () => {
        // Arrival re-framing: correct the onPlaced jump once the pin's terrain has SETTLED (see
        // the `framingActive` declaration for the full why — the committed flight target was
        // captured before the pin's tiles loaded, so the photo lands shifted from high/oblique
        // selections). Any user action already disarmed it via noteInteract; here we also bail on
        // a photo-param edit (moves the plane-centre like a resnap, but it's the user tuning),
        // a manual glide/rate, FPV, deselect, the reframe budget, or the settle deadline.
        if (framingActive) {
          const gLive = !fpvActive && upNow.phase === "placed" ? frustum.current() : null;
          if (
            !gLive ||
            upNow.params !== framingParams ||
            camStore.targetTiltDeg !== null ||
            camStore.targetHeadingDeg !== null ||
            camStore.targetZoomAltM !== null ||
            camStore.headingRateDegPerS !== null ||
            camStore.zoomRatePerS !== null ||
            camStore.exploreActive ||
            now > framingDeadlineMs ||
            framingReframes >= FLIGHT.reframeMaxCount
          ) {
            framingActive = false;
          } else {
            frustum.resnap(); // ride the loading terrain promptly (the 120-frame cadence lags ~2 s)
            _reframeLook
              .set(gLive.apex[0], gLive.apex[1], gLive.apex[2])
              .addScaledVector(
                _reframeFwd.set(gLive.forward[0], gLive.forward[1], gLive.forward[2]),
                FRUSTUM.planeDistM,
              );
            framingStableFrames =
              _reframeLook.distanceTo(_reframePrevLook) > FLIGHT.reframeSettleEpsM
                ? 0
                : framingStableFrames + 1;
            _reframePrevLook.copy(_reframeLook);
            // One corrective glide once the frustum has stopped stepping (terrain done refining)
            // AND it drifted meaningfully from the committed target — never mid-cinematic-flight.
            if (
              !flight.active() &&
              framingStableFrames >= FLIGHT.reframeSettleFrames &&
              _reframeLook.distanceTo(framingLookAt) > FLIGHT.reframeMinMoveM
            ) {
              const pose = frameArrivalPose(gLive);
              flight.start(pose, {
                floorM: flightFloorM(pose.position),
                durationMs: FLIGHT.reframeDurationMs,
              });
              framingLookAt.copy(pose.lookAt);
              framingReframes++;
              framingStableFrames = 0;
              lastInteract = now; // the correction is a flight — keep the idle drift paused
            }
          }
        }

  };

  const stepPinsUpdate = () => {
        // Public pins: distance-scaled markers + lazy terrain grounding (Phase 5). The
        // selection mirror lets the adaptive de-cluster walk an OPEN pin to its truth.
        // The PIN chip (owner 2026-07-15) gates render + pick in ONE place — update()
        // re-sets mesh.visible per frame, so the flag must flow through the handle.
        pins.setVisible(camNow.pinsVisible);
        pins.setSelected(upNow.viewingPinId ?? null);
        pins.update(camera);
        if (frameCount % PINS.resnapEveryFrames === 0) pins.resnap();

        // MY PLACES dots ride the same cadence slot (owner 2026-08-19b) — the chip gate is
        // the ONE flag, mirrored per frame like the PIN chip above.
        placeMarkers.setVisible(usePlacesMapStore.getState().onMap);
        placeMarkers.update(camera);
        if (frameCount % PLACEMARKS.resnapEveryFrames === 0) placeMarkers.resnap();

  };

  const stepPinHover = () => {
        // Pin hover (Phase 5.5 S4): a throttled head raycast under the pointer — the hovered
        // pin eases up + glows (globe side) and its projected head position is mirrored into
        // the pins store so the HTML details card floats next to it (PinHoverCard). Stands
        // down in FPV and while placing (the drop point owns the pointer there).
        {
          const hoverEligible = !fpvActive && !placingNow() && Number.isFinite(hoverX);
          const pinsStore = usePinsStore.getState();
          if (!hoverEligible) {
            if (pinsStore.hoverPin) {
              pins.setHover(null);
              pinsStore._syncHover(null, null);
              // A sky body may own the pointer cursor (stepSkyHover) — leave it in place.
              if (dom.style.cursor === "pointer" && !skyHoverKind) dom.style.cursor = "";
            }
          } else if (frameCount % PINS.hoverEveryFrames === 0) {
            const rect = dom.getBoundingClientRect();
            const [nx, ny] = clientToNdc(hoverX, hoverY, rect);
            _pinRay.setFromCamera(_pickNdc.set(nx, ny), camera);
            const hp = pins.pick(_pinRay);
            pins.setHover(hp?.id ?? null);
            if (hp) {
              const anchor = pins.hoverAnchor(_hoverAnchor);
              if (anchor) {
                // A collapsed cluster hovers as "N photos here" (the card names the count).
                const cs = pins.clusterState(hp.id);
                const hoverCount = cs && cs.collapsed ? cs.count : 1;
                _fpvLook.copy(anchor).project(camera);
                const { x, y } = ndcToClient(_fpvLook.x, _fpvLook.y, rect);
                const prev = pinsStore.hoverScreen;
                if (
                  pinsStore.hoverPin?.id !== hp.id ||
                  pinsStore.hoverCount !== hoverCount ||
                  !prev ||
                  Math.abs(prev.x - x) > ORCH.screenMoveMinPx ||
                  Math.abs(prev.y - y) > ORCH.screenMoveMinPx
                ) {
                  pinsStore._syncHover(hp, { x, y }, hoverCount);
                }
              }
              dom.style.cursor = "pointer";
            } else {
              if (pinsStore.hoverPin) pinsStore._syncHover(null, null);
              if (dom.style.cursor === "pointer" && !skyHoverKind) dom.style.cursor = "";
            }
          }
        }

  };

  const stepTempPinMarker = () => {
        // Temporary pin marker: accent dot at the double-clicked spot, angular-constant size.
        // Its projected screen position is mirrored (low cadence) so the "look from here"
        // popup floats NEXT TO the pin instead of a fixed chrome slot.
        {
          const pinP = camNow.tempPin ? tempPinPoint() : null;
          if (pinP) {
            tempPinMarker.position.copy(pinP);
            const dist = camera.position.distanceTo(pinP);
            tempPinMarker.scale.setScalar(
              THREE.MathUtils.clamp(
                dist * TEMPPIN.markerAngular,
                TEMPPIN.markerMinM,
                TEMPPIN.markerMaxM,
              ),
            );
            tempPinMarker.visible = !fpvActive; // never block the first-person view itself
            if (frameCount % TEMPPIN.screenSyncEveryFrames === 0) {
              const st = useCameraStore.getState();
              camera.getWorldDirection(_camFwd);
              const inFront = _pivot.subVectors(pinP, camera.position).dot(_camFwd) > 0;
              _fpvLook.copy(pinP).project(camera);
              if (
                !fpvActive &&
                inFront &&
                Math.abs(_fpvLook.x) < TEMPPIN.onScreenMargin &&
                Math.abs(_fpvLook.y) < TEMPPIN.onScreenMargin
              ) {
                const rect = dom.getBoundingClientRect();
                const { x, y } = ndcToClient(_fpvLook.x, _fpvLook.y, rect);
                const prev = st.tempPinScreen;
                if (!prev || Math.abs(prev.x - x) > ORCH.screenMoveMinPx || Math.abs(prev.y - y) > ORCH.screenMoveMinPx) {
                  st._syncTempPinScreen({ x, y });
                }
              } else if (st.tempPinScreen) {
                st._syncTempPinScreen(null); // off-screen / behind — hide the popup
              }
            }
          } else {
            tempPinMarker.visible = false;
          }
        }

  };

  const stepPlacementMarker = () => {
        // Live placement marker (Phase 5.5 S3): while the store is `placing`, an accent dot
        // hugs the rendered ground under the pointer — the user sees the drop point before
        // committing the click. Re-picked at low cadence (picking raycasts the tile set).
        if (placingNow() && !fpvActive) {
          if (frameCount % PLACING.repickEveryFrames === 0 && Number.isFinite(hoverX)) {
            const rect = dom.getBoundingClientRect();
            const [nx, ny] = clientToNdc(hoverX, hoverY, rect);
            const hit = pickGround(nx, ny);
            if (hit) {
              placingMarker.position.set(hit[0], hit[1], hit[2]);
              const dist = camera.position.distanceTo(placingMarker.position);
              placingMarker.scale.setScalar(
                THREE.MathUtils.clamp(
                  dist * PLACING.markerAngular,
                  PLACING.markerMinM,
                  PLACING.markerMaxM,
                ),
              );
              placingMarker.visible = true;
            } else {
              placingMarker.visible = false; // pointer past the limb
            }
          }
        } else if (placingMarker.visible) {
          placingMarker.visible = false;
        }

  };

  const stepGraticuleAndAtmosphere = () => {
        // Orbit-only decoration: fade the graticule out as we dive toward the city (no "wire
        // cage" up-view). F7: an OPACITY ramp across [fadeBottom, fadeTop] instead of the old
        // hard `visible` toggle at GATES.decorMinAlt (a visible pop). The atmosphere now stays on
        // at EVERY altitude — below the old decor gate it re-anchors to the camera and becomes the
        // low-altitude sky dome (day-blue + horizon haze; black at night so the stars own the sky).
        graticule.setPresence(
          (alt - GRATICULE.fadeBottomAltM) / (GRATICULE.fadeTopAltM - GRATICULE.fadeBottomAltM),
        );
        atmosphere.update(camera, alt);
        // Day/orbit grade ramp (2026-07-17 orbital-grade pass): the base-earth grade deepens
        // toward its orbit twins as the camera pulls away (EARTH.orbitGrade altLo→altHi).
        earth.uniforms.uOrbitGrade.value = THREE.MathUtils.smoothstep(
          alt,
          EARTH.orbitGrade.altLo,
          EARTH.orbitGrade.altHi,
        );
        // R1 AO altitude gate: tell GlobeCanvas (which owns the GTAOPass + tier gate) whether the
        // camera is low enough for ambient occlusion (city/street only). No-op unless AO.enabled.
        aoControl?.setAltActive(alt < AO.maxAltM);

  };

  const stepStars = () => {
        // Tracked-constellation figure (phase B): its lines light up whenever the tracked
        // target IS a constellation and the TARGET SHOW chip is on — any camera mode (the
        // pattern is the whole treatment; a centroid ring alone says nothing).
        const skyForStars = useSkyStore.getState();
        const trackedConstellation =
          skyForStars.visible && skyForStars.target.facts.kind === "constellation"
            ? skyForStars.target.facts.abbr
            : null;
        stars.update({
          alt,
          camera,
          elapsedS: (performance.now() - t0) / 1000,
          reduceMotion,
          gastRad,
          sunDir: sunDirW,
          // Totality genuinely brings out the bright stars and planets — the sky drops to roughly
          // deep-twilight luminance. `eclipseK` is 1 whenever nothing is happening, so the star
          // module's own night ramp is untouched on every ordinary frame.
          eclipseK,
          // S6 follow-up: asterisms are an FPV planning layer, not ambient decoration —
          // shown only while standing in a viewpoint, and only with the SKY guides on.
          asterisms: fpvActive && camNow.skyGuides,
          constellation: trackedConstellation,
          // Phase 8a P2: the galactic-equator guide lights up while the GALACTIC CENTRE is
          // the tracked target with SHOW on — the tracked-constellation precedent.
          mwBand: skyForStars.visible && skyForStars.target.id === GALACTIC_CENTRE_ID,
        });

  };

  const stepDayArcs = () => {
        // FPV planning overlays (S6): sun/moon day-arcs for the FPV anchor — the module
        // rebuilds only on anchor/day change; scene time just moves the past/future split.
        // Gated by the SKY guides toggle (S6 follow-up).
        dayArcs.update({
          camera,
          sceneMs: tMs,
          anchor:
            fpvActive && camNow.skyGuides
              ? ((fpvKind === "photo" ? upNow.placement : camNow.tempPin) ?? null)
              : null,
          dtMs,
        });
  };

  /** DEV probe mirrors for the radar seam (audit #3 F4 / A1-16) — written by stepAimCones. */
  let lastAimAnchor: { latDeg: number; lonDeg: number } | null = null;
  let lastAimSkyline: readonly number[] | null = null;

  const stepAimCones = () => {
        // U4 direction lines + visibility cones — LIVE anchor, owner lag report 2026-08-18:
        // the plan-STORE anchor is a low-cadence mirror (PLAN.mirrorEveryFrames, ~5.5 km focus
        // quantize, and its lifecycle gate leaves a STALE fpv anchor behind after FPV exit with
        // the panel closed) — a panel readout, never a per-frame geometric seat. The circle
        // instead resolves the same eye-rule live each frame: photo placement > temp pin > the
        // THIS-frame view focus (step 12's _focus, converted here — one cheap ecefToGeodetic).
        // This is also what fixes "second FPV point ignored" and "stuck after FPV exit": the
        // pin and the focus are read fresh, no mirror lifecycle in the path.
        // …through the ONE ladder all three radar surfaces share since audit #3 T36
        // (lib/geo/aimAnchor) — this call is behaviour-identical to the hand-written ladder it
        // replaces, because rung 1 (`fpvActive`) can never fire on a surface that is
        // `enabled: !fpvActive`. The chart and the mini-map now resolve the same way.
        const skyNow = useSkyStore.getState();
        const focusGeo = ecefToGeodetic([_focus.x, _focus.y, _focus.z]);
        const aimAnchor = aimAnchorFor({
          fpvActive,
          camGeo: camNow.camGeo,
          placement: (upNow.phase === "placed" && upNow.placement) || null,
          tempPin: camNow.tempPin,
          focus: { latDeg: focusGeo.latDeg, lonDeg: focusGeo.lonDeg },
        });
        // Desktop shows the radar only near the ground (owner 2026-08-19b: <10 km);
        // /m keeps the wide band — its fullscreen 2D map IS the planning surface.
        const aimBand = isMobileShell
          ? { fullAltM: AIMCONES.fullAltM, topAltM: AIMCONES.topAltM }
          : { fullAltM: AIMCONES.desktopFullAltM, topAltM: AIMCONES.desktopTopAltM };
        // Skyline gaps (owner QA 2026-08-21 item 3): feed the horizonProfile bins ONLY when
        // the plan anchor — the swept eye (photo apex / FPV eye) — sits at (≈) the radar
        // anchor. A focus anchor never owns a profile, and a far-away eye must not lend its
        // skyline to another point's radar (honesty rule; AIMCONES.skylineGuardM).
        // THE gate since audit #3 A1-16 (lib/geo/horizonProfile.skylineBinsFor) — one rule on
        // all three radar surfaces, now including the EVIDENCE floor (`profileCoverage`), which
        // reached planFeed, the store and the PLAN panels but no radar.
        const planSkyNow = usePlanStore.getState();
        const aimSkyline = skylineBinsFor({
          ready: planSkyNow.profileReady,
          bins: planSkyNow.profileBins,
          coverage: planSkyNow.profileCoverage,
          eye: planSkyNow.anchor && planSkyNow.anchor.kind !== "focus" ? planSkyNow.anchor : null,
          anchor: aimAnchor,
          guardM: AIMCONES.skylineGuardM,
          minCoverage: PLAN.minCoverageForGaps,
        });
        // audit #3 F4/A1-16 probe state — the harness must READ what the orchestrator resolved
        // (a transcribed ladder in a verify script is the C8 trap; it already bit once here).
        lastAimAnchor = aimAnchor;
        lastAimSkyline = aimSkyline;
        aimCones.update({
          sceneMs: tMs,
          anchor: aimAnchor,
          alt,
          band: aimBand,
          // RADAR master switch (LAYERS batch, 2026-08-19) ANDs the standing FPV-off rule.
          enabled: !fpvActive && skyNow.aimVisible,
          target: skyNow.target,
          aim: {
            // UNFOLLOW/SHOW-off (2026-08-19): a hidden target draws no direction line either.
            target: skyNow.aimTarget && skyNow.visible,
            sun: skyNow.aimSun,
            moon: skyNow.aimMoon,
            focus: skyNow.aimFocus,
          },
          mobile: isMobileShell, // batch #5 item 2 — /m radius shrink + inward sun/moon bands
          skylineBins: aimSkyline,
          dtMs,
        });
        // S2 focal cone — same anchor, band and master switch as the radar (one planning
        // instrument); draws the planned view, which only exists outside FPV on this surface.
        focalCone.update({
          anchor: aimAnchor,
          alt,
          band: aimBand,
          enabled: !fpvActive && skyNow.aimVisible,
          headingDeg: camNow.plannedView?.headingDeg ?? null,
          hFovDeg: camNow.plannedView?.hFovDeg ?? null,
          mobile: isMobileShell,
          dtMs,
        });
  };

  // Batch #4 S2 — planned-view seeding + joystick-rate integration. Photo placement re-seeds
  // whenever the placed photo's heading/focal change (last-writer-wins with the jump/FPV-exit
  // seeds and the stick); rates integrate OUTSIDE FPV only — inside FPV the stick writes the
  // real camera's setHeadingRate/setFovRate instead (FpvControls owns that split).
  let plannedApplied = { appliedHeadingDegPerS: 0, appliedHFovPerS: 0 };
  let lastPlacedSeedKey = "";
  const stepPlannedView = () => {
        if (upNow.phase === "placed" && upNow.exif) {
          const h = upNow.params.headingDeg ?? 0;
          const f = derivedFov(upNow.exif, upNow.params).hFovDeg;
          const key = `${h}:${f}`;
          if (key !== lastPlacedSeedKey) {
            lastPlacedSeedKey = key;
            // The FOCALCONE clamp used to be inlined here — it moved to
            // store/camera.setPlannedView (audit #3 A2-3), which is the ONE writer now, so all
            // seven seeds get it instead of just this one.
            camNow.setPlannedView({ headingDeg: h, hFovDeg: f });
          }
        } else {
          lastPlacedSeedKey = "";
        }
        if (fpvActive) return;
        const pv = camNow.plannedView;
        if (!pv) {
          // Owner batch #6 item 3: the focal cone shows FROM BOOT — seed the plan eagerly
          // from the live view heading + the temp-FPV default focal at the live aspect (the
          // aim stick's first-touch seed, done here so the cone and the stick's mm readout
          // never wait for a first input). Later seeds (photo/jump/FPV-exit/stick) overwrite.
          camNow.setPlannedView({
            headingDeg: camNow.headingDeg,
            hFovDeg: horizontalFovDeg(FPV.tempFovDeg, camera.aspect),
          });
          return;
        }
        const rates = camNow.plannedRates;
        const state = { headingDeg: pv.headingDeg, hFovDeg: pv.hFovDeg, ...plannedApplied };
        if (!rates && plannedAtRest(state)) {
          plannedApplied = { appliedHeadingDegPerS: 0, appliedHFovPerS: 0 };
          return; // released and eased out — no store churn at rest
        }
        const next = integratePlanned(
          state,
          rates?.headingDegPerS ?? 0,
          rates?.hFovPerS ?? 0,
          dtMs,
          CONTROLS.rateEaseTauMs,
          FOCALCONE.minHFovDeg,
          FOCALCONE.maxHFovDeg,
        );
        plannedApplied = {
          appliedHeadingDegPerS: next.appliedHeadingDegPerS,
          appliedHFovPerS: next.appliedHFovPerS,
        };
        camNow.setPlannedView({ headingDeg: next.headingDeg, hFovDeg: next.hFovDeg });
  };

  const stepGeoLabels = () => {
        // Geo labels (S7b): country boundaries + populated-place labels inside their
        // 100–2000 km altitude window (module-internal fades + rank gate + DOM cadence).
        geoLabels.update({ camera, alt });
  };

  // Flat-map latch (owner 2026-08-18): the vector web + street names read as MAP INK at nadir —
  // they skip the depth test (terrain LOD can never slice them) and the night dim stands down.
  // /m: exactly the 2D map mode. Desktop: the mirrored tilt inside the 2D-chip band, with
  // hysteresis so a tilt wobbling on the threshold never flickers the depth state.
  let mapFlatLatch = false;
  const mapFlatNow = (): boolean => {
    if (isMobileShell) return !fpvActive && useCameraStore.getState().mapMode === "2d";
    if (fpvActive) return false;
    if (mapFlatLatch) {
      if (camStore.tiltDeg > CONTROLS.twoDMaxTiltDeg + 5) mapFlatLatch = false;
    } else if (camStore.tiltDeg < CONTROLS.twoDMaxTiltDeg) {
      mapFlatLatch = true;
    }
    return mapFlatLatch;
  };
  // The ENGINE flat treatment (owner 2026-08-18e — desktop nadir = the same map as /m): deep
  // imagery error target, day grade, shadow rig off, bloom off, fast zoom. Desktop adds an
  // ALTITUDE bound — the flagship LEO view is also tilt≈0 and must stay byte-identical
  // (terminator, night lights, atmosphere bloom). Mirrored per frame for GlobeCanvas (bloom).
  let flatGround = false;
  const flatGroundNow = (): boolean => {
    flatGround = mapFlatNow() && (isMobileShell || alt < CONTROLS.mapFlatMaxAltM);
    return flatGround;
  };

  const stepStreetNames = () => {
        // Street names v4: GL quads PINNED to the ground mesh below STREETS.topAltM — same
        // composer frame as the terrain, so they cannot lag or jump; viewport-aware selection
        // with along-street repeats + the legibility scale. Off in FPV — the viewfinder stays
        // clean.
        streetNames.update({
          camera,
          alt,
          focusLatDeg: camStore.focusLatDeg,
          focusLonDeg: camStore.focusLonDeg,
          enabled: !fpvActive,
          mapFlat: mapFlatNow(),
          viewportH: dom.clientHeight || 1,
        });
  };

  const stepBldgEdit = () => {
        // U8: per-frame service of the armed building edit — consume the chip's one-shots,
        // re-anchor the mesh-pinned label (per-frame: it tracks a live drag), and mirror the chip
        // numbers at a deadband (React must never re-render at 60 fps). MS2: apply a requested op
        // switch, and keep the rig (with the gizmo on it) alive and seated between drags.
        // MS3: the SYNC one-shot (chip foot / menu / pill) — serviced whether or not a building
        // is armed; the push is async and reports through the sync store.
        {
          const ss = useBldgSyncStore.getState();
          if (ss.syncRequest) {
            ss._consumeSyncRequest();
            void bldgSyncNow();
          }
        }
        const bs = useBldgEditStore.getState();
        if (bs.revertRequest) {
          const which = bs.revertRequest;
          bs._consumeRevertRequest();
          if (bldgArmed && enriched && bldgGizmoDragId === null) revertBldg(which);
        }
        if (bs.disarmRequest) {
          bs._consumeDisarmRequest();
          disarmBuilding();
        }
        if (!bldgArmed) {
          bldgEditLabel.update(null, 0, 0, camera);
          // MS3: the hover note — an edited building under a resting pointer (cleared when FPV
          // ends or the pick moves off it; arming hands the building to the label above). MS6: a
          // USER MODEL under the pointer wins the slot — it stands in front of the building it was
          // placed beside (the right-click precedence, applied to the note).
          const h = fpvActive && !modelHoverId ? bldgHover : null;
          if (h && enriched?.buildingTopWorld(h.cellUri, h.featureId, h.current.sy, _bldgTop, h.current)) {
            const hk = enrichedSel.variant ? overrideKey(enrichedSel.variant, h.cellUri, h.featureId) : null;
            bldgEditLabel.hover(_bldgTop, bldgHoverText(h, hk ? originOf(bldgOverrideMap, bldgShared, hk) : "none"), camera);
          } else bldgEditLabel.hover(null, "", camera);
          return;
        }
        bldgEditLabel.hover(null, "", camera);
        if (bs.op !== bldgOp) applyBldgOp(bs.op);
        const a = bldgArmed;
        if (bldgOp !== "extrude" && enriched && bldgGizmoDragId === null) {
          // The rig dies with an LRU-evicted cell (engine rule) — re-show it when the cell streams
          // back; between drags re-place it from the committed target so it rides the easing seat.
          if (!enriched.ghostRig()) enriched.showGhost(a.cellUri, a.featureId, false);
          bldgGizmo.setTarget(enriched.ghostRig(), bldgOp); // idempotent per (rig, op)
          if (enriched.ghostRig()) enriched.setGhostTransform(bldgCommitted(a));
        }
        const live = bldgLive;
        const liveK = live ? live.sy : a.liveK;
        const anchored = enriched?.buildingTopWorld(
          a.cellUri,
          a.featureId,
          liveK,
          _bldgTop,
          live ?? undefined,
        );
        bldgEditLabel.update(
          anchored ? _bldgTop : null,
          a.bakedHeightM,
          a.bakedHeightM * liveK,
          camera,
          bldgOpLine(live ?? bldgCommitted(a), a.footprintM),
        );
        const mirror = bs.armed;
        const liveM = a.bakedHeightM * liveK;
        const dragging = (bldgDragId !== null && bldgDragMoved) || bldgGizmoDragId !== null;
        if (
          !mirror ||
          mirror.featureId !== a.featureId ||
          mirror.dragging !== dragging ||
          mirror.op !== bldgOp ||
          Math.abs(mirror.liveHeightM - liveM) >= 0.05 ||
          (live !== null && liveDiffers(mirror.live, live))
        )
          syncBldgEdit();
  };

  const stepUserModels = () => {
        // MESH SUITE MS5: the MDL gate (the BLD recipe: a plain live on/off composed with the
        // /m 2D auto-detach), residency + seat eases, the low-cadence terrain re-ask, the
        // density mirror for the chip, then the armed-model session service.
        const cam = useCameraStore.getState();
        const shellOn = !isMobileShell || fpvActive || cam.mapMode === "3d";
        const on = shellOn && cam.modelsVisible;
        userModels.setVisible(on);
        if (!on) disarmModel();
        userModels.update(camera, frameCount);
        if (frameCount % MODELS.resnapEveryFrames === 0) userModels.resnap();
        if (frameCount % MODELS.densityMirrorEveryFrames === 0) {
          const c = userModels.counts();
          useUserModelsStore.getState()._syncDensity({
            world: c.world,
            resident: c.resident,
            loading: c.loading,
            skipped: c.skipped,
            tris: c.tris,
            warn: c.warn,
          });
        }
        const ms = useModelEditStore.getState();
        if (ms.revertRequest) {
          const which = ms.revertRequest;
          ms._consumeRevertRequest();
          if (modelArmed && modelGizmoDragId === null) revertModel(which);
        }
        if (ms.disarmRequest) {
          ms._consumeDisarmRequest();
          disarmModel();
        }
        if (!modelArmed) {
          // MS6: the ORBIT hover (the stepPinHover idiom, same eligibility) — a throttled pick under
          // the resting pointer while nothing else owns it (not FPV, not placing, no pin hovered);
          // the FPV hover stays event-driven (onFpvPointerMove). The pointer cursor is handed back
          // only when this step set it (shared with the sky + pin hovers). No "button held" gate:
          // the pins have none, and a synthetic press with no release would pin it shut.
          if (!fpvActive) {
            const eligible = on && !placingNow() && Number.isFinite(hoverX) && !usePinsStore.getState().hoverPin;
            if (!eligible) {
              modelHoverId = null;
            } else if (frameCount % PINS.hoverEveryFrames === 0) {
              modelHoverId = pickModelAt(hoverX, hoverY)?.id ?? null;
            }
            if (modelHoverId) {
              if (dom.style.cursor === "") dom.style.cursor = "pointer";
              modelHoverCursor = dom.style.cursor === "pointer";
            } else if (modelHoverCursor) {
              if (dom.style.cursor === "pointer") dom.style.cursor = "";
              modelHoverCursor = false;
            }
          } else if (modelHoverCursor) {
            if (dom.style.cursor === "pointer") dom.style.cursor = "";
            modelHoverCursor = false;
          }
          // The hover note over an un-armed model — the model under the pointer wins the slot
          // (stepBldgEdit above yields it whenever `modelHoverId` is set); never beside an armed
          // building's label.
          const hid = !bldgArmed ? modelHoverId : null;
          const hInfo = hid ? userModels.info(hid) : null;
          if (hid && hInfo && userModels.topWorld(hid, _modelTop)) {
            const own = useUserModelsStore.getState().isMine(hid);
            bldgEditLabel.hover(_modelTop, `MODEL · ${hInfo.title}${own ? " · yours" : ""}`, camera);
          }
          return;
        }
        const a = modelArmed;
        // MS6: the row left the world (hidden / deleted from the list, the cover moved on) — the
        // scene dropped its `armedId` already; end the session instead of re-targeting a null rig.
        if (!userModels.info(a.id)) {
          disarmModel();
          return;
        }
        if (ms.op !== modelOp) applyModelOp(ms.op);
        // The rig dies with a released model (the residency plan) — re-target when it is back.
        if (modelGizmoDragId === null) modelGizmo.setTarget(userModels.rig(a.id), modelOp);
        const committed = modelCommitted();
        const live = modelLive ?? restingEdit(committed);
        const info = userModels.info(a.id);
        const anchored = userModels.topWorld(a.id, _modelTop);
        bldgEditLabel.pin(
          anchored ? _modelTop : null,
          {
            op: modelOpLine(live, info?.sizeM3 ?? null),
            live: a.title,
            // MS5b: the current size in metres (the upload's bounds × the live scale).
            orig: info?.sizeM3
              ? `↳ ${live.scale.toFixed(2)}× · ${formatDims(info.sizeM3.map((v) => v * live.scale))}`
              : `↳ ${live.scale.toFixed(2)}× · ${(info?.sizeM ?? 0).toFixed(1)} m`,
          },
          camera,
        );
        const mirror = ms.armed;
        const dragging = modelGizmoDragId !== null;
        if (
          !mirror ||
          mirror.id !== a.id ||
          mirror.dragging !== dragging ||
          mirror.op !== modelOp ||
          mirror.saving !== modelSaving ||
          (modelLive !== null && modelLiveDiffers(mirror.live, modelLive)) ||
          // MS8: the COMMITTED seats moved under the session (another member's edit arriving, a
          // store-side commit) — the chip's rows follow them (the same deadband, on the seats).
          modelSeatsDiffer(mirror.committed, committed)
        )
          syncModelEdit();
  };

  const stepVectorFeatures = () => {
        // Vector feature web (S7 feedback): roads / rivers / water / green from the SAME parsed
        // tiles, ribbons + fills on the rendered terrain below VECTOR.topAltM. Night-dimmed by
        // solar elevation at the view focus (map ink is unlit) — except on the flat map, where
        // ink stays readable around the clock. Off in FPV, like the names. VEC / ▤ VECTOR
        // toggle (owner batch #4 item 7): hides the ribbons only — street names stay content.
        vectorFeatures.update({
          alt,
          focusLatDeg: camStore.focusLatDeg,
          focusLonDeg: camStore.focusLonDeg,
          sunElevSin: sunDirW.dot(_focusUp),
          enabled: !fpvActive && camStore.vectorsVisible,
          mapFlat: mapFlatNow(),
        });
  };

  const stepMinimapFeed = () => {
        // FPV mini-map (owner 2026-07-14): feature payload (rebuilt on tile arrival / a 60 m
        // walk) + the ~20 Hz viewer pose → store/minimap. Idle outside FPV (mirrors null once).
        minimapFeed.update({
          fpvActive,
          eyeEcef: camera.position,
          headingDeg: camNow.fpvHud?.headingDeg ?? camStore.headingDeg,
          fovDeg: camNow.fpvHud?.fovDeg ?? null, // U3 view cone — tracks pinch-FOV live
          aspect: camNow.fpvHud?.aspect ?? null,
        });
  };

  let planSeatEpoch = 0;
  const stepPlanFeed = () => {
        // Pass 3 planner feed (WS4 + Slice 5): time-sliced horizon-profile builds + low-cadence
        // chip/blocked mirrors. Runs LAST: it reads post-update tile matrices (enriched re-seat
        // moves cells every frame) and the post-resample scene time.
        // Per-building re-seat consistency (owner 2026-07-14): a READY profile built over
        // pre-seat geometry is invalidated ONCE per settled seating epoch — after the enriched
        // writes go quiet (PLAN.reseatQuietFrames) — so the skyline verdict always matches the
        // rendered buildings without thrashing rebuilds while the easing is still running.
        if (enriched) {
          const st = enriched.seatState();
          if (
            st.epoch !== planSeatEpoch &&
            st.quietFrames >= PLAN.reseatQuietFrames &&
            planFeed.profileSample() !== null
          ) {
            planSeatEpoch = st.epoch;
            planFeed.invalidate();
          }
        }
        planFeed.update({
          sceneMs: tMs,
          photoApex: upNow.phase === "placed" ? (frustum.current()?.apex ?? null) : null,
          fpvEye: fpvActive ? camera.position : null,
          fpvEyeAboveGroundM,
          focusLatDeg: camStore.focusLatDeg,
          focusLonDeg: camStore.focusLonDeg,
        });
  };

  const stepBestSpotFeed = () => {
        // BEST SPOT (SPEC_V2 §7 S3d) — the disc's solve ladder, its refinement epochs, its store
        // mirror and the GL sheet, in that order.
        //
        // IT RUNS IMMEDIATELY AFTER stepPlanFeed AND LAST IN THE CHAIN, and both halves matter.
        // The two planning feeds mirror on the SAME cadence (BESTSPOT.mirrorEveryFrames IS
        // PLAN.mirrorEveryFrames), and `++frameCount` lives inside stepFrustumResnapAndTick, ~20
        // steps earlier — so a step placed on the other side of it lands its cadence gate on the
        // ALTERNATING frames from its twin and the panel's two halves update out of phase. Last,
        // because like planFeed it reads post-update tile matrices and the post-resample scene
        // time, and because the sheet seats on the ground this frame already moved.
        //
        // The centre is the SHARED aim ladder's (`lib/geo/aimAnchor`), resolved exactly as
        // stepAimCones resolves it — never a fresh copy (audit #3 T36 removed three of those).
        // Note the temp pin is NOT a plan anchor, so `plan.profileBins` may not be lent here: this
        // disc owns its own evidence or renders UNKNOWN.
        // ITEM 3's LIFECYCLE. The preview ends when the FPV it rode ends — Escape's rung 3, the
        // panel's LEAVE PREVIEW, a photo FPV taking over, anything at all. Reading the LIVE store
        // rather than this frame's `camNow` snapshot is deliberate: `stepFpvTransitions` consumes
        // the jump request and sets `tempFpv` several steps above here, in this same frame.
        {
          const camLive = useCameraStore.getState();
          if (bsPreviewKey !== null) {
            if (camLive.tempFpv) bsPreviewSeenFpv = true;
            else if (bsPreviewSeenFpv) endBestSpotPreview();
            else if (++bsPreviewArmFrames > BESTSPOT.previewArmFrames) endBestSpotPreview();
          }
        }
        const bsNow = useBestSpotStore.getState();
        const bsFocusGeo = ecefToGeodetic([_focus.x, _focus.y, _focus.z]);
        // THE CENTRE LOCK (item 3). While a shortlist row is being previewed in FPV the disc keeps
        // the centre it was SOLVED at, so `t0` never moves and the feed posts nothing — the field
        // and the shortlist the user is exploring survive the trip. Outside a preview this is the
        // shared aim ladder verbatim, resolved exactly as stepAimCones resolves it.
        const bsAnchor =
          bsPreviewCentre ??
          aimAnchorFor({
            fpvActive,
            camGeo: camNow.camGeo,
            placement: (upNow.phase === "placed" && upNow.placement) || null,
            tempPin: camNow.tempPin,
            focus: { latDeg: bsFocusGeo.latDeg, lonDeg: bsFocusGeo.lonDeg },
          });
        bestSpotFeed.update({
          sceneMs: tMs,
          // THE READ IS THE GATE (see `bestSpotAllowed`). The panel's own `open` + `heatmapOn`
          // switch is the feed's business — it owns the sanctioned store bridge and reads both
          // there, beside the request bands they arm.
          allowed: bestSpotAllowed,
          centreLatDeg: bsAnchor.latDeg,
          centreLonDeg: bsAnchor.lonDeg,
          // Owner R2: the toggle enables when a scratch pin exists OR FPV is live. Leaving FPV
          // with no pin behind keeps the LAST field rather than clearing it — the feed holds that.
          hasCentre: camNow.tempPin !== null || fpvActive,
          terrainEpoch: ground.terrainEpoch(),
          vectorVersion: vtiles.version(),
          seatEpoch: enriched?.seatState().epoch ?? 0,
          builtEpoch: builtEpochN,
        });
        bestSpotSheet.update({
          camera,
          altM: alt,
          viewportHPx: dom.clientHeight || 1,
          viewportWPx: dom.clientWidth || 1,
          dtMs,
          // THE READ IS THE GATE. `open` is the window, `heatmapOn` the owner's arming switch
          // (item 4 — the sheet must go away the frame it is disarmed, not merely stop solving);
          // the other two are R2 and §6.10 (C).
          enabled: bestSpotAllowed && bsNow.open && bsNow.heatmapOn,
          fpvActive,
          mobileShell: isMobileShell,
          field: bestSpotFeed.field(),
          markers: bestSpotFeed.markers(),
          // The cell outline follows whatever is being POINTED at, and falls back to the SELECTED
          // row so a picked spot stays legible on the sheet after the pointer leaves it.
          hoverKey: bsNow.hoverKey ?? bsNow.sceneHoverKey ?? bsNow.selectedKey,
          selectedKey: bsNow.selectedKey,
          contactAzDeg: bestSpotFeed.contactAzDeg(),
        });

        // --- item 3, first half: the marker under the pointer highlights its row AND anchors the
        //     "why this one" tip. The `pins.setHover` block's shape verbatim — a cadence-gated pick
        //     plus an `ORCH.screenMoveMinPx` identity guard, because this writes a React store.
        //     It runs AFTER the sheet update so the pick ledger is THIS frame's, and the whole
        //     thing is gated on the sheet actually drawing: no markers, no hover (FPV renders
        //     nothing under R2, and a disarmed disc has nothing to point at).
        if (frameCount % PINS.hoverEveryFrames === 0) {
          const bsHoverable =
            bestSpotAllowed && bsNow.open && bsNow.heatmapOn && !fpvActive && !anyPointerDown;
          let hit: ReturnType<typeof bestSpotSheet.pickMarker> = null;
          let hitX = 0;
          let hitY = 0;
          if (bsHoverable && Number.isFinite(hoverX)) {
            const rect = dom.getBoundingClientRect();
            const [nx, ny] = clientToNdc(hoverX, hoverY, rect);
            hit = bestSpotSheet.pickMarker(nx, ny);
            if (hit) ({ x: hitX, y: hitY } = ndcToClient(hit.ndcX, hit.ndcY, rect));
          }
          const prev = bsNow.sceneHoverScreen;
          if (
            (hit?.key ?? null) !== bsNow.sceneHoverKey ||
            (hit !== null &&
              (!prev ||
                Math.abs(prev.x - hitX) > ORCH.screenMoveMinPx ||
                Math.abs(prev.y - hitY) > ORCH.screenMoveMinPx))
          ) {
            useBestSpotStore.getState()._syncBestSpot({
              sceneHoverKey: hit?.key ?? null,
              sceneHoverScreen: hit ? { x: hitX, y: hitY } : null,
            });
          }
          // Cursor: claim it on a hit, and give it back only if WE were the one holding it (the
          // sky and pin hovers manage the same property with the same courtesy).
          if (hit) dom.style.cursor = "pointer";
          else if (
            bsMarkerCursor &&
            dom.style.cursor === "pointer" &&
            !skyHoverKind &&
            !usePinsStore.getState().hoverPin
          ) {
            dom.style.cursor = "";
          }
          bsMarkerCursor = hit !== null;
        }
  };

  return {
    update() {
      // ── B19 · per-frame orchestrator: named step-closures (each stepX carries its own doc) ──
      // ORDER IS THE CONTRACT — the call list BELOW is the roster (never a count or numbering
      // here: both re-staled twice — audit-1 D6, audit-2 A2). The chain runs in producer→
      // consumer BANDS; insert a new step into its band, honouring the named constraints:
      //   timing/input      FrameTiming → ZoomBrakeAndEase → ControlsUpdate → DampedVerticality
      //   tiles             MobileBuildingsGate (U1 gate BEFORE the tile update it gates) →
      //                     BuildingsUpdate → EnrichedUpdate
      //   camera control    FlightUpdate → ExploreJourney → FpvTransitions → SkyTrack (TRACKING
      //                     lock feeds the pose glide) → FpvPose → FovGlide
      //   camera frame      GeodeticAltitude → ViewFocus (the U5 download-aim refresh rides
      //                     INSIDE it — needs its fresh _camFwd; queue comparators read it async
      //                     at the next sort, one-frame lag vs the tile updates is harmless)
      //   glides/encoders   IdleDrift → TiltGlide → HeadingGlide → Mobile2dLocks (U1: after the
      //                     manual glides it defers to, before zoom; needs ViewFocus' frame) →
      //                     ZoomGlide → EncoderRates → FocalEncoder → StreetFloorGuard →
      //                     LocationFinderFlyTo
      //   FPV present/mirror FpvSolidity → FpvHudAndSkyMarkers → PoseMirrorAndViewport
      //   ground/ephemeris  GroundUpdate → EphemerisResample → KeyLightAndShadow → SkyBodies →
      //                     SkyTarget → FindGhosts (FIND v2 standings — reads store/find, needs
      //                     the fresh topocentric moon dir) → SkyHover (MUST be last of the
      //                     three: sun/moon lifts re-derive uniforms, the target's post-
      //                     multiplies, and the hover pick reads findGhosts' just-written alphas)
      //   frustum/pins      FrustumResnapAndTick (++frameCount lives INSIDE it, splitting every
      //                     cadence gate into pre/post groups: the FPV-present/mirror band reads
      //                     PRE-increment — fires on frame 0; the pins/marker steps read POST) →
      //                     ArrivalReframing → PinsUpdate → PinHover → TempPinMarker →
      //                     PlacementMarker
      //   scenery/overlays  GraticuleAndAtmosphere → Stars → DayArcs → AimCones (U4 — needs the
      //                     post-resample tMs + the alt/focus frame) → GeoLabels → StreetNames →
      //                     BldgEdit (U8: RESET consume + pinned label + deadband chip mirror;
      //                     needs post-update matrices for the roof anchor) → VectorFeatures
      //   feeds LAST        MinimapFeed → PlanFeed → BestSpotFeed (read post-update matrices;
      //                     the two plan-family mirrors must stay on ONE side of ++frameCount)
      // Cross-band constraints:
      //   (a) idle-drift runs AFTER flight/explore/FPV writes but BEFORE the encoders (lastInteract).
      //   (b) camNow (FpvTransitions) and camStore (TiltGlide) are TWO deliberate store reads with
      //       mutations between them — the glide/encoder/fly-to band reads camStore; never merged.
      //   (c) each updateMatrixWorld()/updateProjectionMatrix() flush is bound to its mutation —
      //       idle-drift intentionally has NO flush; add/remove none.
      //   (d) FpvPose runs BEFORE the encoders — steering applies one frame later.
      // One try wraps the whole chain; the throttled catch keeps a single bad frame from freezing the canvas.
      try {
        stepFrameTiming();
        stepZoomBrakeAndEase();
        stepControlsUpdate();
        stepDampedVerticality();
        stepMobileBuildingsGate();
        stepBuildingsUpdate();
        stepEnrichedUpdate();
        stepFlightUpdate();
        stepExploreJourney();
        stepFpvTransitions();
        stepSkyTrack(); // 8.5 — TRACKING lock feeds the FpvPose glide (fresh camNow, pre-pose)
        stepFpvPose();
        stepFovGlide();
        stepGeodeticAltitude();
        stepViewFocus();
        stepIdleDrift();
        stepTiltGlide();
        stepHeadingGlide();
        stepMobile2dLocks();
        stepZoomGlide();
        stepEncoderRates();
        stepFocalEncoder();
        stepStreetFloorGuard();
        stepLocationFinderFlyTo();
        stepFpvSolidity();
        stepFpvHudAndSkyMarkers();
        stepPoseMirrorAndViewport();
        stepUltraGate();
        stepGroundUpdate();
        stepEphemerisResample();
        stepEclipse();
        stepUltraLook(); // after the ground (it owns the haze gates) and the ephemeris resample
        stepKeyLightAndShadow();
        stepSkyBodies();
        stepSkyTarget();
        stepFindGhosts();
        stepSkyHover();
        stepFrustumResnapAndTick();
        stepArrivalReframing();
        stepPinsUpdate();
        stepPinHover();
        stepTempPinMarker();
        stepPlacementMarker();
        stepGraticuleAndAtmosphere();
        stepStars();
        stepDayArcs();
        stepPlannedView();
        stepAimCones();
        stepGeoLabels();
        stepStreetNames();
        stepBldgEdit();
        stepUserModels();
        stepVectorFeatures();
        stepMinimapFeed();
        stepPlanFeed();
        stepBestSpotFeed();
      } catch (err) {
        updateErrCount++;
        const tErr = performance.now();
        if (tErr - lastUpdateErrLogMs > ORCH.errorLogThrottleMs) {
          console.error(`[globe] tiles/controls update error (#${updateErrCount}):`, err);
          lastUpdateErrLogMs = tErr;
        }
      }
    },
    setQualityTier: applyQualityTier,
    setQualityTierTiles: applyTierTiles, // RC18
    setQualityTierDeferred: applyTierDeferred, // RC18
    tileTier: () => activeQualityTier, // RC18 — read the authority, never a transcribed copy
    // U2/A9: GlobeCanvas's governor DEFERS the RENDERER half of a tier application while this is
    // true — it reallocates composer targets and rebuilds every drape composite, and mid-FPV is
    // the one moment that reads as "the whole city re-rendered". Lands at the next non-FPV frame.
    fpvActive: () => fpvActive,
    // 2026-08-18e: GlobeCanvas's bloom gate — true while the flat-map engine treatment is on
    // (/m 2D map, or desktop nadir below CONTROLS.mapFlatMaxAltM). Mirrored per frame.
    mapFlat: () => flatGround,
    ultraPin: () => ultraOn,
    pipRect: () => useMiniMapStore.getState().pipRect,
    dispose() {
      window.removeEventListener("resize", onEngineResize);
      dom.removeEventListener("pointerdown", noteInteract);
      dom.removeEventListener("wheel", noteInteract);
      dom.removeEventListener("touchstart", noteInteract);
      dom.removeEventListener("pointerdown", notePointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointerup", notePointerFree);
      dom.removeEventListener("pointercancel", notePointerFree);
      dom.removeEventListener("pointermove", noteHover);
      dom.removeEventListener("pointerleave", noteLeave);
      cancelLongPress();
      dom.removeEventListener("pointerdown", onLongPressDown);
      dom.removeEventListener("pointermove", onLongPressMove);
      dom.removeEventListener("pointercancel", cancelLongPress);
      dom.removeEventListener("pointerdown", onFpvPointerDown);
      dom.removeEventListener("pointermove", onFpvPointerMove);
      dom.removeEventListener("pointerup", onFpvPointerEnd);
      dom.removeEventListener("pointercancel", onFpvPointerEnd);
      dom.removeEventListener("wheel", onFpvWheel);
      dom.removeEventListener("dblclick", onDblClick);
      dom.removeEventListener("contextmenu", onSkyContextMenu);
      window.removeEventListener("keydown", onFpvKey);
      window.removeEventListener("keyup", onFpvKeyUp);
      window.removeEventListener("blur", onWinBlur);
      document.removeEventListener("visibilitychange", onLifecycleVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      tempPinMarker.geometry.dispose();
      tempPinMat.dispose();
      scene.remove(tempPinMarker);
      placingMarker.geometry.dispose();
      placingMat.dispose();
      scene.remove(placingMarker);
      dom.style.cursor = "";
      unsubCursor();
      unsubPins();
      pins.dispose();
      window.clearTimeout(placesFetchTimer);
      unsubPlaces();
      placeMarkers.dispose();
      frustum.dispose();
      controls.dispose();
      buildings.dispose();
      enriched?.dispose();
      ground.dispose();
      sky.dispose();
      skyTarget.dispose();
      skyTrail.dispose();
      skyGhosts.dispose();
      findGhosts.dispose();
      skyNames.dispose();
      bldgEditLabel.dispose();
      bldgGizmo.dispose();
      modelGizmo.dispose();
      unsubUserModels();
      unsubMemberModels();
      unsubModelCursor();
      userModels.dispose();
      dayArcs.dispose();
      aimCones.dispose();
      focalCone.dispose();
      geoLabels.dispose();
      streetNames.dispose();
      vectorFeatures.dispose();
      minimapFeed.dispose();
      planFeed.dispose();
      // BEFORE vtiles: the sheet holds GL the scene is still walking, and the feed terminates the
      // solve worker — a worker left alive past the canvas keeps a whole thread and its resident
      // DSM/hulls (up to ~100 MiB at 3 m).
      bestSpotSheet.dispose();
      bestSpotFeed.dispose();
      for (const u of dbgUnregs) u(); // DEBUG HUD providers/actions die with the globe
      vtiles.dispose();
      earth.dispose();
      graticule.dispose();
      atmosphere.dispose();
      stars.dispose();
    },
  };
}
