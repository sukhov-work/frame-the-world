import * as THREE from "three";
import { GlobeControls, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import {
  angularRadiusRad,
  bodyStatesAt,
  KM_PER_AU,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
} from "../../lib/ephemeris/bodies";
import {
  ecefToGeodetic,
  enuBasis,
  geodeticToEcef,
  rayEllipsoidIntersect,
} from "../../lib/geo/projection";
import { frameMarker } from "../../lib/geo/offscreen";
import { goldenFactor } from "../../lib/ephemeris/golden";
import { moonPhaseIntensity } from "../../lib/ephemeris/moonlight";
import {
  GALACTIC_CENTRE_ID,
  saturnRingPoleDir,
  targetShortName,
  type TargetState,
} from "../../lib/ephemeris/targets";
import { kindGlyph } from "../../lib/sky/searchIndex";
import { useSkyStore } from "../../store/sky";
import { usePlanStore } from "../../store/plan";
import { aimAtSky } from "../../store/skyAim";
import { tokens } from "../../lib/theme/tokens";
import { useUploadStore, type AdjustableParams } from "../../store/upload";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { useCameraStore } from "../../store/camera";
import { headingDeltaDeg, wrapHeadingDeg } from "../../lib/geo/heading";
import { clampGroundM } from "../../lib/geo/terrain";
import {
  applyStoredVariant,
  resolveEnrichedUrl,
  resolveEnrichedBbox,
} from "../../lib/globe/enrichedVariant";
import { loadViewPrefs } from "../../lib/prefs";
import { clientToNdc, ndcToClient } from "../../lib/geo/screen";
import { attachBaseEarth } from "./scene/baseEarth";
import { attachGraticule } from "./scene/graticule";
import { attachAtmosphere } from "./scene/atmosphere";
import { attachStars } from "./scene/stars";
import { attachBuildings } from "./scene/buildings";
import { attachEnrichedBuildings } from "./scene/enrichedBuildings";
import { attachImageryGround } from "./scene/imageryGround";
import { attachSky } from "./scene/sky";
import { attachSkyTarget } from "./scene/skyTarget";
import { attachSkyTrail } from "./scene/skyTrail";
import { attachDayArcs } from "./scene/dayArcs";
import { attachPlanFeed } from "./scene/planFeed";
import { attachMinimapFeed } from "./scene/minimapFeed";
import { attachGeoLabels } from "./scene/geoLabels";
import { attachStreetNames } from "./scene/streetNames";
import { attachVectorFeatures } from "./scene/vectorFeatures";
import { attachVectorTiles } from "./scene/vectorTiles";
import { attachPhotoFrustum } from "./PhotoFrustum";
import { attachPins } from "./Pins";
import { usePinsStore } from "../../store/pins";
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
import { lruCapBytesForTier, type QualityTier } from "../../lib/globe/quality";
import {
  AO,
  CONTROLS,
  DRAPE,
  DRIFT,
  EARTH,
  ENRICHED,
  FLIGHT,
  FPV,
  FRUSTUM,
  GOLDEN,
  GRATICULE,
  ORCH,
  PINS,
  PLACING,
  PLAN,
  POSE,
  QUALITY,
  SEARCH,
  SHADOWS,
  SKY,
  STREETS,
  SUN,
  TEMPPIN,
  WGS84_A,
  WGS84_B,
} from "./tuning";

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
  /** Ellipsoid-surface up at a point (used for the tilt-glide pivot + the live tilt mirror). */
  getUpDirection(point: THREE.Vector3, target: THREE.Vector3): void;
  /** Rotate the camera about a pivot (azimuth, altitude) — the declination glide's rotation path. */
  _applyRotation(azimuth: number, altitude: number, pivot?: THREE.Vector3): void;
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
  // Dnipro 3D enrichment (Slice 0): entirely opt-in via PUBLIC_ENRICHED_TILES_URL. When set, the
  // global OSM buildings are masked inside ENRICHED.bbox and the self-hosted enriched tileset streams
  // in their place, seated on the rendered terrain (R1). Absent → maskBbox null + no 3rd renderer =
  // byte-identical to before (the Overture-trial-flag precedent). The `?enriched=` search param is
  // the A/B compare seam between parallel bakes (o2w variant work) — absent, this line resolves to
  // the env URL exactly as before; `off` also drops the mask → the stock Cesium OSM look.
  // The BLD chip's stored preference survives reloads (owner 2026-07-21): with no explicit
  // `?enriched=` the pref injects the variant; the SAME effective search must feed BOTH the
  // tileset URL and the mask/seat bbox, or the mask could follow a different bake than streams.
  const enrichedSearch = applyStoredVariant(
    typeof location === "undefined" ? "" : location.search,
    loadViewPrefs().enrichedVariant,
  );
  const enrichedUrl = resolveEnrichedUrl(
    import.meta.env.PUBLIC_ENRICHED_TILES_URL as string | undefined,
    enrichedSearch,
  );
  // A cross-city variant (?enriched=st-albans-o2w) is baked over its OWN box, so the OSM mask and
  // the re-seat extent must follow it; every other value resolves to ENRICHED.bbox itself.
  const enrichedBbox = resolveEnrichedBbox(ENRICHED.bbox, enrichedSearch, ENRICHED.variantBboxes);
  const buildings = attachBuildings(scene, {
    camera,
    renderer,
    ionToken,
    maskBbox: enrichedUrl ? enrichedBbox : null,
  });
  const ground = attachImageryGround(scene, { camera, renderer, ionToken });
  const enriched = enrichedUrl
    ? attachEnrichedBuildings(scene, {
        camera,
        renderer,
        url: enrichedUrl,
        bbox: enrichedBbox,
        terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
      })
    : null;
  const sky = attachSky(scene);
  const skyTarget = attachSkyTarget(scene); // tracked sky target (ASTRO ENGINE) — 10P by default
  const skyTrail = attachSkyTrail(scene); // the target's day-arc trajectory (phase C, SHOW+TRAIL)
  const dayArcs = attachDayArcs(scene); // FPV planning overlays (S6) — hidden outside FPV
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
    maskBbox: enrichedUrl ? enrichedBbox : null,
  });
  // FPV mini-map feed (owner 2026-07-14): the SAME shared MVT source, projected to local metres
  // around the walked viewer and mirrored into store/minimap for the MiniMap panel.
  const minimapFeed = attachMinimapFeed({ vtiles });

  // --- Adaptive quality fan-out (RENDERING_QUALITY_PASS WS1): GlobeCanvas owns the device tier +
  //     governor + the renderer levers (DPR/bloom/shadows); here we push the tier's TILE knobs into
  //     each module. On `high` every renderer restores its captured library default (null LRU), so a
  //     capable machine is byte-identical to before the quality pass. Called once now (the device
  //     tier) + on every governor change (via the returned setQualityTier). -----------------------
  const applyQualityTier = (tier: QualityTier) => {
    const q = QUALITY.tiers[tier];
    const lru = lruCapBytesForTier(tier, q.lruBytesMB); // null on high → each renderer's captured default
    buildings.setQualityTier(q.buildingErrorTarget, lru);
    enriched?.setQualityTier(q.buildingErrorTarget, lru);
    ground.setQualityTier(q.groundErrorNear, lru);
    streetNames.setMaxVisible(q.maxStreetNames);
    vectorFeatures.setLatticeBudget(q.vectorLatticeBudget);
  };
  applyQualityTier(qualityTier);

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
  let targetHasPole = false;
  let targetState: TargetState | null = null;
  let lastTargetId = "";
  let lastSampleMs = -Infinity;
  const sampleEphemeris = (tMs: number) => {
    lastSampleMs = tMs;
    const s = bodyStatesAt(tMs);
    const target = useSkyStore.getState().target;
    lastTargetId = target.id;
    const c = (targetState = target.stateAt(tMs));
    targetDirW.set(c.dir[0], c.dir[1], c.dir[2]);
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

  // --- GlobeControls — documented ellipsoid binding, damping for a premium feel, snappy zoom. --
  const controls = new GlobeControls(scene, camera, renderer.domElement);
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
  const _tempPinEcef = new THREE.Vector3();
  /** Refresh + return the temp pin's ECEF anchor point (on the rendered ground), or null. */
  const tempPinPoint = (): THREE.Vector3 | null => {
    const pin = useCameraStore.getState().tempPin;
    if (!pin) return null;
    const key = `${pin.latDeg},${pin.lonDeg}`;
    if (key !== tempPinKey) {
      tempPinKey = key;
      tempPinGroundM = 0;
    }
    const th = ground.heightAt(pin.latDeg, pin.lonDeg);
    if (th != null) tempPinGroundM = clampGroundM(th);
    return _tempPinEcef.fromArray(geodeticToEcef(pin.latDeg, pin.lonDeg, tempPinGroundM));
  };

  // --- Idle orbital drift — the "spacecraft in LEO" feel (seed: "slightly rotating by default").
  //     Rotates the camera around Earth's axis at ISS-like angular speed; pauses the moment the
  //     user touches the scene and resumes after DRIFT.resumeMs. Skipped for reduced motion. ----
  let lastInteract = -Infinity;
  const noteInteract = () => {
    lastInteract = performance.now();
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
    const hit = _pickRay.intersectObjects(ground.tiles.group.children, true)[0];
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
    const azDeg = wrapHeadingDeg(
      THREE.MathUtils.radToDeg(
        Math.atan2(
          targetDirW.x * b.east[0] + targetDirW.y * b.east[1] + targetDirW.z * b.east[2],
          targetDirW.x * b.north[0] + targetDirW.y * b.north[1] + targetDirW.z * b.north[2],
        ),
      ),
    );
    const altDeg = THREE.MathUtils.radToDeg(
      Math.asin(
        THREE.MathUtils.clamp(
          targetDirW.x * b.up[0] + targetDirW.y * b.up[1] + targetDirW.z * b.up[2],
          -1,
          1,
        ),
      ),
    );
    aimAtSky(azDeg, altDeg);
    if (!skyNow.open) skyNow.setOpen(true);
    return true;
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
  const notePointerDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
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
      longPressFired = false; // the long-press consumed this gesture — not a click
      return;
    }
    if (fpvActive) return; // FPV owns the pointer (look-around) — no placing, no pin-picking
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > ORCH.clickDragPx) return; // a drag, not a click
    const rect = dom.getBoundingClientRect();
    const [ndcX, ndcY] = clientToNdc(e.clientX, e.clientY, rect);
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
  dom.addEventListener("pointermove", noteHover);
  dom.addEventListener("pointerleave", noteLeave);
  // Crosshair while the globe waits for the placement click.
  const unsubCursor = useUploadStore.subscribe((s) => {
    dom.style.cursor = s.phase === "placing" ? "crosshair" : "";
    if (s.phase !== "placing") placingMarker.visible = false;
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
  const onFpvPointerDown = (e: PointerEvent) => {
    if (!fpvActive) return;
    if (!e.isPrimary) {
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
  };
  const onFpvPointerMove = (e: PointerEvent) => {
    if (!fpvActive) return;
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
    // FPV has no pin/ground picking, but a CLICK (not a look-drag) can still hit the tracked
    // sky marker: glide the look onto it + front the panel (phase C, owner feedback #2).
    // Never after a pinch — those two fingers were a zoom, not a tap.
    if (
      e.type === "pointerup" &&
      !fpvPinchedDuringDrag &&
      Math.hypot(e.clientX - fpvDownX, e.clientY - fpvDownY) <= ORCH.clickDragPx
    ) {
      const rect = dom.getBoundingClientRect();
      const [ndcX, ndcY] = clientToNdc(e.clientX, e.clientY, rect);
      trySkyMarkerClick(ndcX, ndcY);
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
  const onFpvKey = (e: KeyboardEvent) => {
    if (fpvActive && !e.metaKey && !e.ctrlKey) {
      // Arrow keys WALK on the ground plane (you walk where you look; ◀▶ strafe).
      // Shift sprints (×walkFastMult); Option/Alt creeps (×walkSlowMult). Modifier state is
      // mirrored on EVERY key event so pressing/releasing mid-stride retunes the speed live.
      fpvKeysDown.shift = e.shiftKey;
      fpvKeysDown.alt = e.altKey;
      if (e.key === "ArrowUp") { fpvKeysDown.up = true; e.preventDefault(); return; }
      if (e.key === "ArrowDown") { fpvKeysDown.down = true; e.preventDefault(); return; }
      if (e.key === "ArrowLeft") { fpvKeysDown.left = true; e.preventDefault(); return; }
      if (e.key === "ArrowRight") { fpvKeysDown.right = true; e.preventDefault(); return; }
      if (e.code === "Space") {
        // SPACE = ascend (QoL-1). Never steal Space from an interactive element — the browser
        // activates a focused button/input with it (the scrubber rail is tabIndex=0 too).
        const ae = document.activeElement as HTMLElement | null;
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
    if (camS.exploreActive) camS.setExplore(false);
    else if (up.viewMode === "fpv") up.setViewMode("orbit");
    else if (camS.tempFpv) camS.setTempFpv(false);
    else if (camS.tempPin) camS.setTempPin(null);
    else if (up.phase === "placed" && up.viewingPinId) up.clear();
  };
  const onFpvKeyUp = (e: KeyboardEvent) => {
    fpvKeysDown.shift = e.shiftKey;
    fpvKeysDown.alt = e.altKey;
    if (e.key === "ArrowUp") fpvKeysDown.up = false;
    else if (e.key === "ArrowDown") fpvKeysDown.down = false;
    else if (e.key === "ArrowLeft") fpvKeysDown.left = false;
    else if (e.key === "ArrowRight") fpvKeysDown.right = false;
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
    if (up.phase === "placing") return;
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
    dropTempPinAt(e.clientX, e.clientY);
  };
  // Long-press = the dblclick twin on glass (MOBILE_PLAN §4.3, M1). Gated on pointerType
  // "touch" — STRICTER than the plan's wording — so the frozen desktop stays behavior-identical
  // (a mouse held still 500 ms must not start dropping pins). Guards re-run at fire time via
  // dropTempPinAt; a second finger (pinch) cancels; onPointerUp above owns lift/suppression.
  const onLongPressDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !e.isPrimary) {
      cancelLongPress(); // a mouse press or a second touch is never a long-press
      return;
    }
    if (fpvActive) return;
    cancelLongPress();
    longPressFired = false;
    const { clientX, clientY } = e;
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
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
  window.addEventListener("keydown", onFpvKey);
  window.addEventListener("keyup", onFpvKeyUp);
  window.addEventListener("blur", onWinBlur);
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
  const _keyWhite = new THREE.Color(0xffffff);
  const _goldenCol = new THREE.Color(tokens.goldenHour);
  const _moonKeyCol = new THREE.Color(tokens.moonlight); // the key light's moon-shadow disguise
  let frameCount = 0;

  // --- Camera feel (2026-07-10 owner pass) — temporal zoom easing, damped auto-verticality and
  //     the declination glide. Mechanics verified against the GlobeControls source (0.4.28):
  //     the library consumes the whole wheel delta in one frame and, while zooming IN, rotates
  //     the camera around the zoom point at FULL strength as the local up changes
  //     (EnvironmentControls._setFrame) — that pair is what read as "snaps to vertical". --------
  let pendingZoom = 0; // banked wheel/pinch delta, released exp(-dt/tau) per frame
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

  // Dev-only introspection so browser verification (Playwright) can read camera altitude and tile
  // state without reaching into the closure. No secrets, no behaviour change.
  if (import.meta.env.DEV) {
    window.__globe = {
      camera,
      controls,
      tiles: buildings.tiles,
      enriched: enriched?.tiles ?? null, // Dnipro 3D enrichment (Slice 0) — null unless the URL is set
      enrichedSeats: () => enriched?.debugSeats() ?? null, // per-building re-seat coverage (2026-07-14)
      ground: ground.tiles,
      groundUniforms: ground.uniforms,
      earthUniforms: earth.uniforms,
      frustum,
      flight,
      sky,
      skyTarget,
      sunLight,
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
        controlsEnabled: controls.enabled,
      }),
      dayArcs,
      plan: () => planFeed.debug(),
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
      pins,
    };
    window.__timeStore = useTimeStore; // scrub scene time from the console / Playwright
    window.__cameraStore = useCameraStore; // drive/read the tilt glide from Playwright
  }

  // Per-frame update() error throttle (B26): a persistent error must not flood the console at
  // 60 fps — log the first, then at most once per ORCH.errorLogThrottleMs with a rolling count.
  let updateErrCount = 0;
  let lastUpdateErrLogMs = -Infinity;

  const stepFrameTiming = () => {
        now = performance.now();
        dtMs = Math.min(now - lastFrameMs, ORCH.maxFrameDtMs);
        lastFrameMs = now;

  };

  const stepZoomBrakeAndEase = () => {
        // Zoom braking near the ground: the library step is already ∝ distance-to-surface, but
        // the last kilometres still read fast — shrink the effective speed below zoomSlowAltM.
        controls.zoomSpeed =
          CONTROLS.zoomSpeed *
          THREE.MathUtils.lerp(
            CONTROLS.zoomSlowFrac,
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

  const stepControlsUpdate = () => {
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
            buildings.setGhostSolid(0); // next FPV entry starts on the ghost curve again
            buildings.setGhost(null);
            enriched?.setSolidity(null); // restore the opaque non-FPV enriched look
            camNow.clearAllTargets(); // targets set during FPV must not fire now
            // A held walk stick must not survive the exit either (clearAllTargets deliberately
            // spares it — the stick component's unmount is the usual clear; this is the backstop).
            if (camNow.fpvWalkInput) camNow.setFpvWalkInput(null);
            // Restore the pre-FPV pin visibility (no-op if the chip was re-lit inside FPV).
            if (pinsVisibleBeforeFpv && !camNow.pinsVisible) camNow.setPinsVisible(true);
            fovTargetDeg = POSE.fovDeg;
            const geomOut = upNow.phase === "placed" ? frustum.current() : null;
            const pinOut = tempPinPoint();
            if (geomOut) {
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
              fpvLiftM = 0; // the photographer's exact eye — ALTITUDE lifts from here
              fpvDragId = null;
              controls.enabled = false;
              controls.adjustHeight = false; // cameraRadius would push us off the apex
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
              fpvDragId = null;
              controls.enabled = false;
              controls.adjustHeight = false; // eye height 1.7 m is under cameraRadius
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
              if (share) {
                // Basis from the SHARED bearing (fresh scratch vectors — never alias a stored
                // basis vector to a module temp, the S7 street-names lesson).
                const shareLonR = THREE.MathUtils.degToRad(share.lonDeg);
                _skyEast.set(-Math.sin(shareLonR), Math.cos(shareLonR), 0);
                _skyNorth.crossVectors(_tempUp0, _skyEast).normalize();
                const shareH = THREE.MathUtils.degToRad(share.headingDeg);
                _tempFwd0
                  .copy(_skyEast)
                  .multiplyScalar(Math.sin(shareH))
                  .addScaledVector(_skyNorth, Math.cos(shareH));
              } else {
                // Basis: continue looking the way the camera already faces (horizontal at the pin).
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
              const eye = pinP.clone().addScaledVector(_tempUp0, fpvEyeM);
              flight.start({
                position: eye,
                lookAt: eye.clone().addScaledVector(_tempFwd0, FPV.tempLookAheadM),
              });
              fovTargetDeg = share
                ? THREE.MathUtils.clamp(share.fovDeg, FPV.minFovDeg, FPV.maxFovDeg)
                : FPV.tempFovDeg;
              lastInteract = now;
            }
          }
        }
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
              const skyLook = camNow.skyLook;
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
                const kLook = 1 - Math.exp(-dtMs / FPV.skyLookEaseTauMs);
                fpvYaw += (yawT - fpvYaw) * kLook;
                fpvPitch += (pitchT - fpvPitch) * kLook;
                if (Math.abs(yawT - fpvYaw) < 0.003 && Math.abs(pitchT - fpvPitch) < 0.003) {
                  fpvYaw = yawT;
                  fpvPitch = pitchT;
                  camNow._clearSkyLook();
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
                _fpvWalkFwd.copy(_fpvFwd).addScaledVector(_fpvUpGeo, -_fpvFwd.dot(_fpvUpGeo));
                if (_fpvWalkFwd.lengthSq() > 1e-9) _fpvWalkFwd.normalize();
                _fpvWalkRight.crossVectors(_fpvWalkFwd, _fpvUpGeo).normalize();
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
              // SPACE = ascend with hold-acceleration (QoL-1, owner 2026-08-14): gain ramps
              // QUADRATICALLY over spaceRampS (a tap nudges centimetres, a hold accelerates —
              // precision-controlled, never faster than the encoder rail), stepping the SAME
              // strictly-vertical identity the ALTITUDE encoder drives (temp: eye height;
              // photo: lift off the apex) with the same proportional floor + clamps. Mutating
              // next frame's eye/lift here (not camera.position) keeps one vertical authority.
              if (fpvKeysDown.space) {
                fpvSpaceHeldMs += dtMs;
                const gain = Math.min(1, fpvSpaceHeldMs / (FPV.spaceRampS * 1000));
                const rate = FPV.spaceLiftRatePerS * gain * gain;
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
              camera.up.copy(_fpvUp);
              camera.lookAt(_fpvLook.copy(camera.position).add(_fpvFwd));
              camera.updateMatrixWorld();
              lastInteract = now; // FPV owns the camera — the idle drift must never move it
            }
          }
          controls.adjustCamera(camera); // controls disabled: keep the near/far fit alive
        }
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
            const pinP = tempPinPoint();
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
        if (
          !reduceMotion &&
          alt > DRIFT.minAlt &&
          performance.now() - lastInteract > DRIFT.resumeMs
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
          const liveH = viewHeadingDeg(_focusUp);
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
          const upT = target.clone().normalize();
          // Horizontal approach direction: camera bearing projected on the target's horizon
          // plane; degenerate (overhead / antipodal) falls back to local north.
          const horiz = camera.position.clone().sub(target);
          horiz.addScaledVector(upT, -horiz.dot(upT));
          if (horiz.lengthSq() < 1) {
            horiz.copy(_Z).addScaledVector(upT, -_Z.dot(upT)); // north = Z − up(Z·up)
          }
          horiz.normalize();
          const pose = arrivalPose({
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
            const azAltOf = (d: THREE.Vector3) => ({
              azDeg: wrapHeadingDeg(
                THREE.MathUtils.radToDeg(
                  Math.atan2(
                    d.x * basis.east[0] + d.y * basis.east[1] + d.z * basis.east[2],
                    d.x * basis.north[0] + d.y * basis.north[1] + d.z * basis.north[2],
                  ),
                ),
              ),
              altDeg: THREE.MathUtils.radToDeg(
                Math.asin(
                  THREE.MathUtils.clamp(
                    d.x * basis.up[0] + d.y * basis.up[1] + d.z * basis.up[2],
                    -1,
                    1,
                  ),
                ),
              ),
            });
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
                // Every trackable target is far enough that the geocentric direction IS the
                // topocentric one at chip precision (the marker draws the same dir).
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
                eyeAboveGroundM: fpvEyeAboveGroundM,
                sun: sunM,
                moon: moonM,
              });
            } else if (camNow.fpvHud) {
              camNow._syncFpvHud(null);
              // FPV exited mid-glide — drop the leftover request (a re-entry must not consume it).
              if (camNow.skyLook) camNow._clearSkyLook();
            }
          } else {
            if (camNow.fpvHud) camNow._syncFpvHud(null);
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
          const liveHeadingDeg = viewHeadingDeg(_focusUp); // same frame as the heading glide
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
              const viewAzDeg = THREE.MathUtils.radToDeg(
                Math.atan2(
                  _camFwd.x * eb.east[0] + _camFwd.y * eb.east[1] + _camFwd.z * eb.east[2],
                  _camFwd.x * eb.north[0] + _camFwd.y * eb.north[1] + _camFwd.z * eb.north[2],
                ),
              );
              const viewAltDeg = THREE.MathUtils.radToDeg(
                Math.asin(
                  THREE.MathUtils.clamp(
                    _camFwd.x * eb.up[0] + _camFwd.y * eb.up[1] + _camFwd.z * eb.up[2],
                    -1,
                    1,
                  ),
                ),
              );
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

  const stepGroundUpdate = () => {
        // S7a: dark drape unless the user opted into the satellite look (SAT chip).
        ground.update(alt, camStore.groundMode !== "satellite");

  };

  const stepEphemerisResample = () => {
        // Ephemeris: re-sample when scene time moved enough (live clock or a pinned scrub).
        tMs = sceneTimeMs();
        if (Math.abs(tMs - lastSampleMs) > SKY.sampleIntervalMs) sampleEphemeris(tMs);

  };

  const stepKeyLightAndShadow = () => {
        // Key light + the ONE shadow rig (S5 §Item 7: source switch, never a second rig).
        // Sun mode: ephemeris direction; colour warms through the golden band at the focus;
        // shadows at city altitudes while the sun is up there (a below-horizon sun would
        // project garbage). Moon mode: sun down + bright-enough moon up → the SAME light
        // impersonates the moon (direction, cool colour, K&S phase intensity) and the
        // dedicated moonLight stands down so the night key is never doubled.
        moonShadows = false;
        if (sunLight) {
          const shadowEligible = alt < SHADOWS.maxAltM && !!focusHit;
          const sunUp = sunDirW.dot(_focusUp) > SHADOWS.minSunElevSin;
          const sunShadows = shadowEligible && sunUp;
          moonShadows =
            shadowEligible &&
            !sunUp &&
            moonDirW.dot(_focusUp) > SHADOWS.minSunElevSin &&
            moonIllum >= SHADOWS.moonMinIllum;
          // Per-mode shadow contrast (S7a): the flat dark drape carries a stronger overlay —
          // blended by the live dark fraction so the crossfade never steps the shadows.
          const dark01 = ground.darkBlend();
          if (moonShadows) {
            // Moon "golden hour": warm the cool moon key as the moon grazes the horizon (the SAME
            // golden bell, over MOON elevation) — mirrors the sun's dusk so both keys share one dusk
            // language across the cycle. GOLDEN.moonKeyStrength 0 → pure cool moonlight (no-op).
            const moonGoldenK = goldenFactor(moonDirW.dot(_focusUp), GOLDEN);
            sunLight.color.copy(_moonKeyCol).lerp(_goldenCol, moonGoldenK * GOLDEN.moonKeyStrength);
            sunLight.intensity = SKY.moonKeyIntensity * moonKs;
            sunLight.position.copy(_focus).addScaledVector(moonDirW, SHADOWS.lightDistM);
            sunLight.target.position.copy(_focus);
            ground.setShadowStrength(
              THREE.MathUtils.lerp(SHADOWS.moonGroundOpacity, DRAPE.moonShadowOpacity, dark01) *
                moonKs,
            );
          } else {
            const goldenK = goldenFactor(sunDirW.dot(_focusUp), GOLDEN);
            sunLight.color.lerpColors(_keyWhite, _goldenCol, goldenK * GOLDEN.keyStrength);
            // Golden hour also BRIGHTENS the building key (warm rim-lit swell, not just a hue shift —
            // the biggest visible building-dusk win). keyBrighten 0 → ×1 = byte-identical.
            sunLight.intensity = SUN.keyIntensity * (1 + goldenK * GOLDEN.keyBrighten);
            if (sunShadows) {
              sunLight.position.copy(_focus).addScaledVector(sunDirW, SHADOWS.lightDistM);
              sunLight.target.position.copy(_focus);
              ground.setShadowStrength(
                THREE.MathUtils.lerp(SHADOWS.groundOpacity, DRAPE.shadowOpacity, dark01),
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
            const b = THREE.MathUtils.clamp(alt * SHADOWS.boundsAltK, SHADOWS.boundsM, SHADOWS.maxBoundsM);
            const shCam = sunLight.shadow.camera;
            if (shCam.right !== b) {
              shCam.left = -b;
              shCam.right = b;
              shCam.top = b;
              shCam.bottom = -b;
              shCam.near = Math.max(1, SHADOWS.lightDistM - SHADOWS.depthMarginM - b);
              shCam.far = SHADOWS.lightDistM + SHADOWS.depthMarginM + b;
              shCam.updateProjectionMatrix();
            }
          }
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
          moonIntensity: moonShadows ? 0 : moonKs, // the rig carries the key in moon-shadow mode
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
  };

  const stepFrustumResnapAndTick = () => {
        // Re-seat the placed photo as terrain tiles refine under it (low cadence — a raycast).
        if (++frameCount % FRUSTUM.resnapEveryFrames === 0) frustum.resnap();

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

  };

  const stepPinHover = () => {
        // Pin hover (Phase 5.5 S4): a throttled head raycast under the pointer — the hovered
        // pin eases up + glows (globe side) and its projected head position is mirrored into
        // the pins store so the HTML details card floats next to it (PinHoverCard). Stands
        // down in FPV and while placing (the drop point owns the pointer there).
        {
          const hoverEligible = !fpvActive && upNow.phase !== "placing" && Number.isFinite(hoverX);
          const pinsStore = usePinsStore.getState();
          if (!hoverEligible) {
            if (pinsStore.hoverPin) {
              pins.setHover(null);
              pinsStore._syncHover(null, null);
              if (dom.style.cursor === "pointer") dom.style.cursor = "";
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
              if (dom.style.cursor === "pointer") dom.style.cursor = "";
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
        if (upNow.phase === "placing" && !fpvActive) {
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

  const stepGeoLabels = () => {
        // Geo labels (S7b): country boundaries + populated-place labels inside their
        // 100–2000 km altitude window (module-internal fades + rank gate + DOM cadence).
        geoLabels.update({ camera, alt });
  };

  const stepStreetNames = () => {
        // Street names v3 (S7 feedback): GL quads PINNED to the ground mesh below
        // STREETS.topAltM — same composer frame as the terrain, so they cannot lag or jump.
        // Off in FPV — the viewfinder stays clean.
        streetNames.update({
          camera,
          alt,
          focusLatDeg: camStore.focusLatDeg,
          focusLonDeg: camStore.focusLonDeg,
          enabled: !fpvActive,
        });
  };

  const stepVectorFeatures = () => {
        // Vector feature web (S7 feedback): roads / rivers / water / green from the SAME parsed
        // tiles, ribbons + fills on the rendered terrain below VECTOR.topAltM. Night-dimmed by
        // solar elevation at the view focus (map ink is unlit). Off in FPV, like the names.
        vectorFeatures.update({
          alt,
          focusLatDeg: camStore.focusLatDeg,
          focusLonDeg: camStore.focusLonDeg,
          sunElevSin: sunDirW.dot(_focusUp),
          enabled: !fpvActive,
        });
  };

  const stepMinimapFeed = () => {
        // FPV mini-map (owner 2026-07-14): feature payload (rebuilt on tile arrival / a 60 m
        // walk) + the ~20 Hz viewer pose → store/minimap. Idle outside FPV (mirrors null once).
        minimapFeed.update({
          fpvActive,
          eyeEcef: camera.position,
          headingDeg: camNow.fpvHud?.headingDeg ?? camStore.headingDeg,
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

  return {
    update() {
      // ── B19 · per-frame orchestrator: 38 ordered step-closures (each stepX carries its doc) ──
      //  1 FrameTiming 2 ZoomBrakeAndEase 3 ControlsUpdate 4 DampedVerticality 5 BuildingsUpdate
      //  6 FlightUpdate 7 ExploreJourney 8 FpvTransitions 9 FpvPose 10 FovGlide 11 GeodeticAltitude
      // 12 ViewFocus 13 IdleDrift 14 TiltGlide 15 HeadingGlide 16 ZoomGlide 17 EncoderRates
      // 18 FocalEncoder 19 StreetFloorGuard 20 LocationFinderFlyTo 21 FpvSolidity 22 FpvHudAndSkyMarkers
      // 23 PoseMirrorAndViewport 24 GroundUpdate 25 EphemerisResample 26 KeyLightAndShadow 27 SkyBodies
      //    (+SkyTarget right after 27 — the ASTRO ENGINE tracer + phase-C trail, unnumbered to keep the anchors below)
      // 28 FrustumResnapAndTick 29 ArrivalReframing 30 PinsUpdate 31 PinHover 32 TempPinMarker
      // 33 PlacementMarker 34 GraticuleAndAtmosphere 35 Stars 36 DayArcs 37 GeoLabels 38 StreetNames (S7b)
      // 39 VectorFeatures (S7 feedback — roads/water web from the shared MVT source)
      // 40 MinimapFeed (owner 2026-07-14 — FPV mini-map features + pose from the shared MVT source)
      // 41 PlanFeed (Pass 3 — sliced horizon-profile builds; LAST: reads post-update matrices)
      //
      // ORDER IS THE CONTRACT — the sequence is load-bearing, not incidental:
      //   (a) ++frameCount lives INSIDE step 28 and splits every cadence gate into pre/post groups —
      //       steps 21/22/23 read the PRE-increment count (fire on frame 0); steps 30/31/32/33 read POST.
      //   (c) idle-drift (13) runs AFTER flight/explore/FPV writes but BEFORE the encoders (lastInteract).
      //   (f) each updateMatrixWorld()/updateProjectionMatrix() flush is bound to its mutation —
      //       idle-drift (13) intentionally has NO flush; add/remove none.
      //   (h) FPV pose (9) runs BEFORE the encoders (17/18) — steering applies one frame later.
      // Snapshots (trap b): camNow (step 8) and camStore (step 14) are TWO deliberate store reads with
      //   store mutations between them — the glide/encoder/fly-to region (14-20) reads camStore; never merged.
      // One try wraps all 36 steps; the throttled catch keeps a single bad frame from freezing the canvas.
      try {
        stepFrameTiming();
        stepZoomBrakeAndEase();
        stepControlsUpdate();
        stepDampedVerticality();
        stepBuildingsUpdate();
        stepEnrichedUpdate();
        stepFlightUpdate();
        stepExploreJourney();
        stepFpvTransitions();
        stepFpvPose();
        stepFovGlide();
        stepGeodeticAltitude();
        stepViewFocus();
        stepIdleDrift();
        stepTiltGlide();
        stepHeadingGlide();
        stepZoomGlide();
        stepEncoderRates();
        stepFocalEncoder();
        stepStreetFloorGuard();
        stepLocationFinderFlyTo();
        stepFpvSolidity();
        stepFpvHudAndSkyMarkers();
        stepPoseMirrorAndViewport();
        stepGroundUpdate();
        stepEphemerisResample();
        stepKeyLightAndShadow();
        stepSkyBodies();
        stepSkyTarget();
        stepFrustumResnapAndTick();
        stepArrivalReframing();
        stepPinsUpdate();
        stepPinHover();
        stepTempPinMarker();
        stepPlacementMarker();
        stepGraticuleAndAtmosphere();
        stepStars();
        stepDayArcs();
        stepGeoLabels();
        stepStreetNames();
        stepVectorFeatures();
        stepMinimapFeed();
        stepPlanFeed();
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
    dispose() {
      dom.removeEventListener("pointerdown", noteInteract);
      dom.removeEventListener("wheel", noteInteract);
      dom.removeEventListener("touchstart", noteInteract);
      dom.removeEventListener("pointerdown", notePointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
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
      window.removeEventListener("keydown", onFpvKey);
      window.removeEventListener("keyup", onFpvKeyUp);
      window.removeEventListener("blur", onWinBlur);
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
      frustum.dispose();
      controls.dispose();
      buildings.dispose();
      enriched?.dispose();
      ground.dispose();
      sky.dispose();
      skyTarget.dispose();
      skyTrail.dispose();
      dayArcs.dispose();
      geoLabels.dispose();
      streetNames.dispose();
      vectorFeatures.dispose();
      minimapFeed.dispose();
      planFeed.dispose();
      vtiles.dispose();
      earth.dispose();
      graticule.dispose();
      atmosphere.dispose();
      stars.dispose();
    },
  };
}
