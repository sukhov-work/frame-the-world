import * as THREE from "three";
import { GlobeControls, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import {
  angularRadiusRad,
  bodyStatesAt,
  KM_PER_AU,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
} from "../../lib/ephemeris/bodies";
import { ecefToGeodetic, geodeticToEcef, rayEllipsoidIntersect } from "../../lib/geo/projection";
import { goldenFactor } from "../../lib/ephemeris/golden";
import { moonPhaseIntensity } from "../../lib/ephemeris/moonlight";
import { tokens } from "../../lib/theme/tokens";
import { useUploadStore } from "../../store/upload";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { headingDeltaDeg, useCameraStore, wrapHeadingDeg } from "../../store/camera";
import { attachBaseEarth } from "./scene/baseEarth";
import { attachGraticule } from "./scene/graticule";
import { attachAtmosphere } from "./scene/atmosphere";
import { attachStars } from "./scene/stars";
import { attachBuildings } from "./scene/buildings";
import { attachImageryGround } from "./scene/imageryGround";
import { attachSky } from "./scene/sky";
import { attachPhotoFrustum } from "./PhotoFrustum";
import { attachPins } from "./Pins";
import { usePinsStore } from "../../store/pins";
import { arrivalPose, createFlight, type FlightTarget } from "./flight";
import { createExplore } from "./explore";
import type { FrustumGeometry } from "../../lib/geo/frustum";
import {
  CONTROLS,
  DRIFT,
  EARTH,
  FLIGHT,
  FPV,
  FRUSTUM,
  GATES,
  GOLDEN,
  PINS,
  PLACING,
  POSE,
  SEARCH,
  SHADOWS,
  SKY,
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
  dispose: () => void;
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
}): TilesHandle {
  const { scene, camera, renderer, ionToken, reduceMotion = false, sunLight } = opts;
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
  });
  const graticule = attachGraticule(scene, { baseScale });
  const atmosphere = attachAtmosphere(scene, { baseScale });
  const stars = attachStars(scene, { dpr: renderer.getPixelRatio() });
  const buildings = attachBuildings(scene, { camera, renderer, ionToken });
  const ground = attachImageryGround(scene, { camera, renderer, ionToken });
  const sky = attachSky(scene);

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
  let lastSampleMs = -Infinity;
  const sampleEphemeris = (tMs: number) => {
    lastSampleMs = tMs;
    const s = bodyStatesAt(tMs);
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

  // --- GlobeControls — documented ellipsoid binding, damping for a premium feel, snappy zoom. --
  const controls = new GlobeControls(scene, camera, renderer.domElement);
  controls.setEllipsoid(
    (buildings.tiles as any).ellipsoid ?? WGS84_ELLIPSOID,
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
    return Math.min(Math.max(hS, hT, 0), 9_000) + FLIGHT.floorClearM;
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
        ? Math.min(Math.max(sampled, 0), 9_000)
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

  const frustum = attachPhotoFrustum(scene, {
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
    onPlaced(geom) {
      const pose = frameArrivalPose(geom);
      flight.start(pose, { floorM: flightFloorM(pose.position) });
    },
  });

  // --- Public pins (Phase 5): accent markers fed by store/pins (viewport-queried Wix Data);
  //     clicking one re-opens it as the placed CAMERA VIEW (upload-store openSavedPin → the
  //     frustum rebuilds + PhotoDetailPanel shows + the onPlaced flight frames the photo).
  //     The orchestrator mirrors its view focus into the store at the same low cadence as
  //     the camera mirrors — the store debounces the actual query. -------------------------
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
    if (th != null) tempPinGroundM = Math.min(Math.max(th, 0), 9_000);
    return _tempPinEcef.fromArray(geodeticToEcef(pin.latDeg, pin.lonDeg, tempPinGroundM));
  };

  // --- Idle orbital drift — the "spacecraft in LEO" feel (seed: "slightly rotating by default").
  //     Rotates the camera around Earth's axis at ISS-like angular speed; pauses the moment the
  //     user touches the scene and resumes after DRIFT.resumeMs. Skipped for reduced motion. ----
  let lastInteract = -Infinity;
  const noteInteract = () => {
    lastInteract = performance.now();
    flight.cancel(); // grabbing the globe aborts a flight — the user takes over
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
  const onPointerUp = (e: PointerEvent) => {
    if (fpvActive) return; // FPV owns the pointer (look-around) — no placing, no pin-picking
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // a drag, not a click
    const rect = dom.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (useUploadStore.getState().phase === "placing") {
      // Placing wins the click: cast at the rendered ground and drop the photo there.
      const hit = pickGround(ndcX, ndcY);
      if (!hit) return; // clicked past the limb — stay in placing mode
      const g = ecefToGeodetic(hit);
      useUploadStore.getState().setPlacement(g.latDeg, g.lonDeg);
      return;
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
  dom.addEventListener("pointermove", noteHover);
  dom.addEventListener("pointerleave", noteLeave);
  // Crosshair while the globe waits for the placement click.
  const unsubCursor = useUploadStore.subscribe((s) => {
    dom.style.cursor = s.phase === "placing" ? "crosshair" : "";
    if (s.phase !== "placing") placingMarker.visible = false;
  });
  const driftRadPerFrame = (DRIFT.degPerFrame * Math.PI) / 180;

  // --- FPV photographer mode (Phase 5.5 S2): the camera sits EXACTLY at the frustum apex with
  //     the photo's pose. GlobeControls are disabled (and adjustHeight off — cameraRadius would
  //     push us off the apex), but controls.adjustCamera is still called every FPV frame: it owns
  //     the near/far plane fit, and GlobeControls.update() skips it entirely while disabled.
  //     Drag = look-around (grab-the-world), wheel = camera-FOV zoom, Escape / panel button exits.
  let fpvActive = false;
  /** Which anchor the FPV camera stands on: a placed photo's frustum apex, or the temp pin. */
  let fpvKind: "photo" | "temp" | null = null;
  let fpvYaw = 0; // look-around offsets (rad) on top of the anchor's own pose
  let fpvPitch = 0;
  let fpvDragId: number | null = null;
  let fpvLastX = 0;
  let fpvLastY = 0;
  let fovTargetDeg: number = camera.fov; // eased every frame (FPV zoom + entry/exit restore)
  // Temp-pin FPV basis, captured at ENTRY (fwd = the camera's azimuth at that moment — deriving
  // it per frame from the camera would feed back on itself). Position refreshes per frame as
  // the terrain under the pin refines.
  const _tempFwd0 = new THREE.Vector3();
  const _tempUp0 = new THREE.Vector3();
  const _tempRight0 = new THREE.Vector3();
  // Temp-FPV eye height above the pin's ground (m): the ZOOM encoder elevates the viewpoint
  // STRICTLY vertically in this mode (owner follow-up). Reset to eye height on entry.
  let fpvEyeM: number = FRUSTUM.eyeHeightM;
  const onFpvPointerDown = (e: PointerEvent) => {
    if (!fpvActive || !e.isPrimary) return;
    fpvDragId = e.pointerId;
    fpvLastX = e.clientX;
    fpvLastY = e.clientY;
  };
  const onFpvPointerMove = (e: PointerEvent) => {
    if (!fpvActive || fpvDragId !== e.pointerId) return;
    // Grab-the-world: dragging right rotates the view left; sensitivity scales with the FOV
    // zoom so a zoomed-in look stays controllable.
    const k = ((FPV.lookDegPerPx * Math.PI) / 180) * (camera.fov / POSE.fovDeg);
    fpvYaw -= (e.clientX - fpvLastX) * k;
    fpvPitch += (e.clientY - fpvLastY) * k;
    fpvLastX = e.clientX;
    fpvLastY = e.clientY;
  };
  const onFpvPointerEnd = (e: PointerEvent) => {
    if (fpvDragId === e.pointerId) fpvDragId = null;
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
    if (e.key !== "Escape") return;
    const up = useUploadStore.getState();
    const camS = useCameraStore.getState();
    if (camS.exploreActive) camS.setExplore(false);
    else if (up.viewMode === "fpv") up.setViewMode("orbit");
    else if (camS.tempFpv) camS.setTempFpv(false);
    else if (camS.tempPin) camS.setTempPin(null);
    else if (up.phase === "placed" && up.viewingPinId) up.clear();
  };
  // Double-click on the ground drops the temporary pin (deselecting a viewed pin first — the
  // gesture means "focus here"). Ignored while placing and while editing an own unsaved upload.
  const onDblClick = (e: MouseEvent) => {
    if (fpvActive) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // a drag, not a dblclick
    const up = useUploadStore.getState();
    if (up.phase === "placing") return;
    if (up.phase === "placed" && !up.viewingPinId) return; // don't disturb an editing session
    const rect = dom.getBoundingClientRect();
    const hit = pickGround(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!hit) return; // clicked past the limb
    if (up.phase === "placed" && up.viewingPinId) up.clear(); // deselect the viewed pin first
    const g = ecefToGeodetic(hit);
    useCameraStore.getState().setTempPin({ latDeg: g.latDeg, lonDeg: g.lonDeg });
  };
  dom.addEventListener("pointerdown", onFpvPointerDown);
  dom.addEventListener("pointermove", onFpvPointerMove);
  dom.addEventListener("pointerup", onFpvPointerEnd);
  dom.addEventListener("pointercancel", onFpvPointerEnd);
  dom.addEventListener("wheel", onFpvWheel, { passive: false });
  dom.addEventListener("dblclick", onDblClick);
  window.addEventListener("keydown", onFpvKey);
  const _fpvQ = new THREE.Quaternion();
  const _fpvFwd = new THREE.Vector3();
  const _fpvUp = new THREE.Vector3();
  const _fpvRight = new THREE.Vector3();
  const _fpvUpGeo = new THREE.Vector3();
  const _fpvLook = new THREE.Vector3();

  // Encoder-style rate controls (Phase 5.5 S2): the applied rates ease toward the stick so
  // deflection ramps in and release coasts out (CONTROLS.rateEaseTauMs).
  let appliedHeadingRate = 0; // deg/s
  let appliedZoomRate = 0; // log-space 1/s
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
    (window as any).__globe = {
      camera,
      controls,
      tiles: buildings.tiles,
      ground: ground.tiles,
      groundUniforms: ground.uniforms,
      earthUniforms: earth.uniforms,
      frustum,
      flight,
      sky,
      sunLight,
      bodies: () => ({
        sunDir: sunDirW.toArray(),
        moonDir: moonDirW.toArray(),
        moonIllumination: moonIllum,
        moonKs, // K&S-1991 phase intensity (S5 — 1 = full moon)
        gastRad,
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
        controlsEnabled: controls.enabled,
      }),
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
    (window as any).__timeStore = useTimeStore; // scrub scene time from the console / Playwright
    (window as any).__cameraStore = useCameraStore; // drive/read the tilt glide from Playwright
  }

  return {
    update() {
      // A single bad frame (transient tiles error, WebGL glitch) MUST NOT freeze the canvas.
      try {
        const now = performance.now();
        const dtMs = Math.min(now - lastFrameMs, 100);
        lastFrameMs = now;

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
        const zc = controls as any;
        if (CONTROLS.zoomSmoothTauMs > 0) {
          pendingZoom += zc.zoomDelta;
          const kz = 1 - Math.exp(-dtMs / CONTROLS.zoomSmoothTauMs);
          let step = pendingZoom * kz;
          if (Math.abs(pendingZoom - step) < 1e-3) step = pendingZoom; // snap the tail
          zc.zoomDelta = step;
          pendingZoom -= step;
        }
        const zoomStep = zc.zoomDelta as number;
        _upBefore.copy(zc.up);

        controls.update();

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
        buildings.update();

        // Cinematic flight overrides the pose after controls (the drift pattern); an active
        // flight counts as interaction so the drift stays paused through it + resumeMs after.
        if (flight.update(now)) lastInteract = now;

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

        // --- FPV modes: transitions + the per-frame pose (Phase 5.5 S2 + follow-up). Two
        //     anchors share one controller: a placed PHOTO's frustum apex (pose re-read every
        //     frame — the photo sliders steer the view live) and the TEMP pin (eye height on
        //     the ground, basis captured at entry). Entry/exit ride the same cinematic flight;
        //     buildings ghost to FPV.buildingGhostOpacity so the view is never lost in a mesh.
        const upNow = useUploadStore.getState();
        const camNow = useCameraStore.getState();
        const wantKind: "photo" | "temp" | null =
          upNow.viewMode === "fpv"
            ? "photo"
            : camNow.tempFpv && camNow.tempPin
              ? "temp"
              : null;
        if (wantKind !== fpvKind) {
          if (wantKind === null) {
            fpvKind = null;
            fpvActive = false;
            controls.adjustHeight = true;
            controls.enabled = true;
            buildings.setGhost(null);
            camNow.clearAllTargets(); // targets set during FPV must not fire now
            fovTargetDeg = POSE.fovDeg;
            const geomOut = upNow.phase === "placed" ? frustum.current() : null;
            const pinOut = tempPinPoint();
            if (geomOut) {
              const pose = frameArrivalPose(geomOut);
              flight.start(pose, { floorM: flightFloorM(pose.position) });
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
              fpvDragId = null;
              controls.enabled = false;
              controls.adjustHeight = false; // cameraRadius would push us off the apex
              buildings.setGhost({
                fillOpacity: FPV.buildingGhostOpacity,
                edgeOpacity: FPV.buildingGhostEdgeOpacity,
              });
              camNow.clearAllTargets();
              const apex = new THREE.Vector3(...g.apex);
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
              fpvDragId = null;
              controls.enabled = false;
              controls.adjustHeight = false; // eye height 1.7 m is under cameraRadius
              buildings.setGhost({
                fillOpacity: FPV.buildingGhostOpacity,
                edgeOpacity: FPV.buildingGhostEdgeOpacity,
              });
              camNow.clearAllTargets();
              fpvEyeM = FRUSTUM.eyeHeightM;
              // Basis: continue looking the way the camera already faces (horizontal at the pin).
              _tempUp0.copy(pinP).normalize();
              camera.getWorldDirection(_camFwd);
              _tempFwd0.copy(_camFwd).addScaledVector(_tempUp0, -_camFwd.dot(_tempUp0));
              if (_tempFwd0.lengthSq() < 1e-6) {
                _tempFwd0.copy(_Z).addScaledVector(_tempUp0, -_tempUp0.z); // north fallback
              }
              _tempFwd0.normalize();
              _tempRight0.crossVectors(_tempFwd0, _tempUp0).normalize();
              _tempUp0.crossVectors(_tempRight0, _tempFwd0); // re-orthonormalized
              const eye = pinP.clone().addScaledVector(_tempUp0, fpvEyeM);
              flight.start({
                position: eye,
                lookAt: eye.clone().addScaledVector(_tempFwd0, 50),
              });
              fovTargetDeg = FPV.tempFovDeg;
              lastInteract = now;
            }
          }
        }
        if (fpvActive) {
          if (!flight.active()) {
            let posed = false;
            if (fpvKind === "photo") {
              const g = frustum.current();
              if (g) {
                camera.position.set(g.apex[0], g.apex[1], g.apex[2]);
                _fpvUpGeo.copy(camera.position).normalize();
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
              camera.up.copy(_fpvUp);
              camera.lookAt(_fpvLook.copy(camera.position).add(_fpvFwd));
              camera.updateMatrixWorld();
              lastInteract = now; // FPV owns the camera — the idle drift must never move it
            }
          }
          controls.adjustCamera(camera); // controls disabled: keep the near/far fit alive
        }
        // FOV glide (FPV wheel zoom + the entry/exit FOV changes) — never a snap.
        if (Math.abs(camera.fov - fovTargetDeg) > 0.01) {
          camera.fov += (fovTargetDeg - camera.fov) * (1 - Math.exp(-dtMs / FPV.fovEaseTauMs));
          if (Math.abs(camera.fov - fovTargetDeg) < 0.01) camera.fov = fovTargetDeg;
          camera.updateProjectionMatrix();
        }

        // True geodetic altitude above the WGS84 ellipsoid. (position.length() - WGS84_A is up to
        // ~21 km off at mid-latitudes — enough to mis-time the low-altitude gates.)
        const alt = WGS84_ELLIPSOID.getPositionElevation(camera.position);

        // View focus: camera-forward ray → ellipsoid (past-the-limb views fall back to the
        // sub-camera point). ONE shared frame for the heading/zoom glides, their live mirrors,
        // the shadow rig and the golden-hour key-light signal. (controls.getPivotPoint is NOT
        // usable here — it is degenerate before the first user interaction.)
        camera.getWorldDirection(_camFwd);
        const focusHit = rayEllipsoidIntersect(
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
        let focusLocked = false;
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
        const hasFocus = focusHit !== null || focusLocked;
        lastAlt = alt;

        // Idle orbital drift (LEO spacecraft feel) — orbit only, paused after interaction.
        if (
          !reduceMotion &&
          alt > DRIFT.minAlt &&
          performance.now() - lastInteract > DRIFT.resumeMs
        ) {
          _driftQ.setFromAxisAngle(_driftAxis, driftRadPerFrame);
          camera.position.applyQuaternion(_driftQ);
          camera.up.applyQuaternion(_driftQ);
          camera.quaternion.premultiply(_driftQ);
        }

        // Manual declination (slider): glide the pitch toward the requested tilt around the view
        // focus. Grabbing the globe (noteInteract) or a flight cancels the glide. Sign verified
        // against the source: _applyRotation's +y pitches TOWARD nadir (newPitch = pitch − y);
        // pitch convention 0 = straight down, π/2 = horizon; clamps are applied inside.
        const camStore = useCameraStore.getState();
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
          if (Math.abs(delta) < 8e-4) {
            camStore.clearTargetTilt(); // arrived — hand the camera back
          } else {
            const kt = 1 - Math.exp(-dtMs / CONTROLS.tiltEaseTauMs);
            zc._applyRotation(0, delta * kt, _pivot);
            camera.updateMatrixWorld();
          }
        }

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
            if (Math.abs(deltaH) < 0.08) {
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
          if (Math.abs(errLog) < 0.005) {
            camStore.clearTargetZoom(); // arrived — hand the camera back
          } else if (
            Math.abs(alt - zoomGlideLastAlt) < 0.05 &&
            ++zoomStallCount >= CONTROLS.zoomStallFrames
          ) {
            // Resting on terrain/cameraRadius (the 2 m floor is ellipsoid-relative — under a
            // 100 m-high city it is unreachable): release instead of fighting adjustHeight.
            camStore.clearTargetZoom();
            zoomStallCount = 0;
          } else {
            if (Math.abs(alt - zoomGlideLastAlt) >= 0.05) zoomStallCount = 0;
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

        // Encoder-style rate controls (Phase 5.5 S2): per-frame velocities through the SAME
        // rotation/dolly paths as the glides. The applied rate low-passes toward the stick, so
        // deflection ramps in and release coasts out; heading wraps freely, zoom clamps hard.
        // In TEMP-pin FPV (owner follow-up) the sticks re-target: ROTATE turns the look itself
        // and ZOOM elevates the viewpoint strictly vertically. Photo FPV stays locked.
        const kRate = 1 - Math.exp(-dtMs / CONTROLS.rateEaseTauMs);
        const rateAllowed = !flight.active() && (!fpvActive || fpvKind === "temp");
        const stickH = (rateAllowed && camStore.headingRateDegPerS) || 0;
        appliedHeadingRate += (stickH - appliedHeadingRate) * kRate;
        if (Math.abs(appliedHeadingRate) > 0.01) {
          if (fpvActive) {
            if (fpvKind === "temp") {
              // + rate = compass-clockwise = look right (matches the fpvYaw convention)
              fpvYaw += THREE.MathUtils.degToRad((appliedHeadingRate * dtMs) / 1000);
              lastInteract = now;
            }
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
        if (Math.abs(appliedZoomRate) > 1e-3) {
          if (fpvActive) {
            if (fpvKind === "temp") {
              // + rate = "zoom in" = descend; strictly vertical elevation. Proportional speed
              // with a floor base — a pure exponential from a 1.7 m eye barely gets airborne.
              fpvEyeM = THREE.MathUtils.clamp(
                fpvEyeM - ((appliedZoomRate * dtMs) / 1000) * Math.max(fpvEyeM, 8),
                FRUSTUM.eyeHeightM,
                FPV.tempEyeMaxM,
              );
              lastInteract = now;
            }
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

        // Street-floor / underground guard (Phase 5.5 S2, found in browser verification): the
        // manual zoom paths target ELLIPSOID altitude, so a 2 m request over a 150 m-high city
        // dives under the street — and once underground the ground tileset fully unloads, so
        // neither adjustHeight (down-ray from the camera) nor live heightAt can recover it.
        // Sample terrain under the camera every frame below 50 km, remember the last answer,
        // and clamp the camera to lastGround + zoomMinAltM BEFORE it ever crosses under; the
        // zoom glide then stalls against the clamp and releases itself.
        if (!fpvActive && !flight.active() && alt < 50_000) {
          // Sample at the VIEW FOCUS, not the camera footprint: tiles load inside the frustum,
          // and at oblique tilt there is often NO tile directly beneath the camera (verified —
          // the footprint sample stayed null through a whole 6 km→street dive).
          if (hasFocus) {
            const fg = ecefToGeodetic([_focus.x, _focus.y, _focus.z]);
            const th = ground.heightAt(fg.latDeg, fg.lonDeg);
            if (th != null) lastGroundM = Math.min(Math.max(th, 0), 9_000);
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
          const groundT = Math.min(
            Math.max(ground.heightAt(req.latDeg, req.lonDeg) ?? 0, 0),
            9_000,
          );
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

        // Mirror the live pose (pitch / heading / altitude) into the store at low cadence for
        // the panel readouts (never at 60 fps — same discipline as store/time).
        if (frameCount % 12 === 0) {
          zc.getUpDirection(camera.position, _pivotUp);
          _camBack.set(0, 0, 1).transformDirection(camera.matrixWorld);
          const liveTiltDeg = THREE.MathUtils.radToDeg(_pivotUp.angleTo(_camBack));
          if (Math.abs(liveTiltDeg - camStore.tiltDeg) > 0.25) camStore._syncTilt(liveTiltDeg);
          const liveHeadingDeg = viewHeadingDeg(_focusUp); // same frame as the heading glide
          if (!Number.isNaN(liveHeadingDeg)) {
            const wrapped = wrapHeadingDeg(liveHeadingDeg);
            if (Math.abs(headingDeltaDeg(camStore.headingDeg, wrapped)) > 0.5) {
              camStore._syncHeading(wrapped);
            }
          }
          if (Math.abs(alt - camStore.zoomAltM) / Math.max(alt, 1) > 0.005) {
            camStore._syncZoom(alt);
          }
          // Viewport mirror for the public-pin query (Phase 5) — same cadence as the camera
          // mirrors; the pins store debounces + thresholds the actual Wix Data query, so the
          // perpetual LEO idle drift never spams it. The camera store keeps the same focus as
          // the geocoding bias (location finder ranks results near what you're looking at).
          const focusGeo = ecefToGeodetic([_focus.x, _focus.y, _focus.z]);
          usePinsStore.getState().reportViewport(focusGeo.latDeg, focusGeo.lonDeg, alt);
          camStore._syncFocus(focusGeo.latDeg, focusGeo.lonDeg);
        }

        ground.update(alt);

        // Ephemeris: re-sample when scene time moved enough (live clock or a pinned scrub).
        const tMs = sceneTimeMs();
        if (Math.abs(tMs - lastSampleMs) > SKY.sampleIntervalMs) sampleEphemeris(tMs);

        // Key light + the ONE shadow rig (S5 §Item 7: source switch, never a second rig).
        // Sun mode: ephemeris direction; colour warms through the golden band at the focus;
        // shadows at city altitudes while the sun is up there (a below-horizon sun would
        // project garbage). Moon mode: sun down + bright-enough moon up → the SAME light
        // impersonates the moon (direction, cool colour, K&S phase intensity) and the
        // dedicated moonLight stands down so the night key is never doubled.
        let moonShadows = false;
        if (sunLight) {
          const shadowEligible = alt < SHADOWS.maxAltM && !!focusHit;
          const sunUp = sunDirW.dot(_focusUp) > SHADOWS.minSunElevSin;
          const sunShadows = shadowEligible && sunUp;
          moonShadows =
            shadowEligible &&
            !sunUp &&
            moonDirW.dot(_focusUp) > SHADOWS.minSunElevSin &&
            moonIllum >= SHADOWS.moonMinIllum;
          if (moonShadows) {
            sunLight.color.copy(_moonKeyCol);
            sunLight.intensity = SKY.moonKeyIntensity * moonKs;
            sunLight.position.copy(_focus).addScaledVector(moonDirW, SHADOWS.lightDistM);
            sunLight.target.position.copy(_focus);
            ground.setShadowStrength(SHADOWS.moonGroundOpacity * moonKs);
          } else {
            const goldenK = goldenFactor(sunDirW.dot(_focusUp), GOLDEN);
            sunLight.color.lerpColors(_keyWhite, _goldenCol, goldenK * GOLDEN.keyStrength);
            sunLight.intensity = SUN.keyIntensity;
            if (sunShadows) {
              sunLight.position.copy(_focus).addScaledVector(sunDirW, SHADOWS.lightDistM);
              sunLight.target.position.copy(_focus);
              ground.setShadowStrength(SHADOWS.groundOpacity);
            } else {
              // direction-only mode: keep the terminator agreement for building shading everywhere
              sunLight.position.copy(sunDirW).multiplyScalar(1e7);
              sunLight.target.position.set(0, 0, 0);
            }
          }
          sunLight.castShadow = sunShadows || moonShadows;
        }

        // Sun + moon bodies (camera-anchored, true apparent size; moon angular size uses the
        // camera→moon distance — it varies ±2% across an orbit swing).
        sky.update({
          camera,
          sunDir: sunDirW,
          moonPos: moonPosW,
          sunAngRad,
          moonAngRad: angularRadiusRad(MOON_RADIUS_KM * 1000, moonPosW.distanceTo(camera.position)),
          moonIntensity: moonShadows ? 0 : moonKs, // the rig carries the key in moon-shadow mode
        });

        // Re-seat the placed photo as terrain tiles refine under it (low cadence — a raycast).
        if (++frameCount % 120 === 0) frustum.resnap();

        // Public pins: distance-scaled markers + lazy terrain grounding (Phase 5). The
        // selection mirror lets the adaptive de-cluster walk an OPEN pin to its truth.
        pins.setSelected(upNow.viewingPinId ?? null);
        pins.update(camera);
        if (frameCount % PINS.resnapEveryFrames === 0) pins.resnap();

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
            _pinRay.setFromCamera(
              _pickNdc.set(
                ((hoverX - rect.left) / rect.width) * 2 - 1,
                -((hoverY - rect.top) / rect.height) * 2 + 1,
              ),
              camera,
            );
            const hp = pins.pick(_pinRay);
            pins.setHover(hp?.id ?? null);
            if (hp) {
              const anchor = pins.hoverAnchor(_hoverAnchor);
              if (anchor) {
                // A collapsed cluster hovers as "N photos here" (the card names the count).
                const cs = pins.clusterState(hp.id);
                const hoverCount = cs && cs.collapsed ? cs.count : 1;
                _fpvLook.copy(anchor).project(camera);
                const x = Math.round(rect.left + ((_fpvLook.x + 1) / 2) * rect.width);
                const y = Math.round(rect.top + ((1 - _fpvLook.y) / 2) * rect.height);
                const prev = pinsStore.hoverScreen;
                if (
                  pinsStore.hoverPin?.id !== hp.id ||
                  pinsStore.hoverCount !== hoverCount ||
                  !prev ||
                  Math.abs(prev.x - x) > 2 ||
                  Math.abs(prev.y - y) > 2
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
            if (frameCount % 6 === 0) {
              const st = useCameraStore.getState();
              camera.getWorldDirection(_camFwd);
              const inFront = _pivot.subVectors(pinP, camera.position).dot(_camFwd) > 0;
              _fpvLook.copy(pinP).project(camera);
              if (
                !fpvActive &&
                inFront &&
                Math.abs(_fpvLook.x) < 1.02 &&
                Math.abs(_fpvLook.y) < 1.02
              ) {
                const rect = dom.getBoundingClientRect();
                const x = Math.round(rect.left + ((_fpvLook.x + 1) / 2) * rect.width);
                const y = Math.round(rect.top + ((1 - _fpvLook.y) / 2) * rect.height);
                const prev = st.tempPinScreen;
                if (!prev || Math.abs(prev.x - x) > 2 || Math.abs(prev.y - y) > 2) {
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

        // Live placement marker (Phase 5.5 S3): while the store is `placing`, an accent dot
        // hugs the rendered ground under the pointer — the user sees the drop point before
        // committing the click. Re-picked at low cadence (picking raycasts the tile set).
        if (upNow.phase === "placing" && !fpvActive) {
          if (frameCount % PLACING.repickEveryFrames === 0 && Number.isFinite(hoverX)) {
            const rect = dom.getBoundingClientRect();
            const hit = pickGround(
              ((hoverX - rect.left) / rect.width) * 2 - 1,
              -((hoverY - rect.top) / rect.height) * 2 + 1,
            );
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

        // Orbit-only decoration: hide the graticule once we dive toward the city (no "wire
        // cage" up-view). The atmosphere now stays on at EVERY altitude — below the old decor
        // gate it re-anchors to the camera and becomes the low-altitude sky dome (day-blue +
        // horizon haze; black at night so the stars own the sky).
        graticule.lines.visible = alt > GATES.decorMinAlt;
        atmosphere.update(camera, alt);

        stars.update({
          alt,
          camera,
          elapsedS: (performance.now() - t0) / 1000,
          reduceMotion,
          gastRad,
          sunDir: sunDirW,
        });
      } catch (err) {
        console.error("[globe] tiles/controls update error:", err);
      }
    },
    dispose() {
      dom.removeEventListener("pointerdown", noteInteract);
      dom.removeEventListener("wheel", noteInteract);
      dom.removeEventListener("touchstart", noteInteract);
      dom.removeEventListener("pointerdown", notePointerDown);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointermove", noteHover);
      dom.removeEventListener("pointerleave", noteLeave);
      dom.removeEventListener("pointerdown", onFpvPointerDown);
      dom.removeEventListener("pointermove", onFpvPointerMove);
      dom.removeEventListener("pointerup", onFpvPointerEnd);
      dom.removeEventListener("pointercancel", onFpvPointerEnd);
      dom.removeEventListener("wheel", onFpvWheel);
      dom.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("keydown", onFpvKey);
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
      ground.dispose();
      sky.dispose();
      earth.dispose();
      graticule.dispose();
      atmosphere.dispose();
      stars.dispose();
    },
  };
}
