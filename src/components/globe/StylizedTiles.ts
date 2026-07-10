import * as THREE from "three";
import { GlobeControls, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import {
  angularRadiusRad,
  bodyStatesAt,
  KM_PER_AU,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
} from "../../lib/ephemeris/bodies";
import { ecefToGeodetic, rayEllipsoidIntersect } from "../../lib/geo/projection";
import { goldenFactor } from "../../lib/ephemeris/golden";
import { tokens } from "../../lib/theme/tokens";
import { useUploadStore } from "../../store/upload";
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { useCameraStore } from "../../store/camera";
import { attachBaseEarth } from "./scene/baseEarth";
import { attachGraticule } from "./scene/graticule";
import { attachAtmosphere } from "./scene/atmosphere";
import { attachStars } from "./scene/stars";
import { attachBuildings } from "./scene/buildings";
import { attachImageryGround } from "./scene/imageryGround";
import { attachSky } from "./scene/sky";
import { attachPhotoFrustum } from "./PhotoFrustum";
import { createFlight } from "./flight";
import {
  CONTROLS,
  DRIFT,
  EARTH,
  FLIGHT,
  FRUSTUM,
  GATES,
  GOLDEN,
  POSE,
  SHADOWS,
  SKY,
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

  const earth = attachBaseEarth(scene, { baseScale, maxAniso });
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
  let moonIllum = 0.5;
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
    const moonGlow = SKY.moonSceneGlow * moonIllum;
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

  // --- Photo frustum + cinematic flight (Phase 3). When a photo lands (PLACE or click-to-place),
  //     fly to a pose framing it: behind the apex along −forward, lifted, looking at the plane. --
  const flight = createFlight(camera, { reduceMotion, wgs84A: WGS84_A, wgs84B: WGS84_B });
  const frustum = attachPhotoFrustum(scene, {
    terrainHeightAt: (latDeg, lonDeg) => ground.heightAt(latDeg, lonDeg),
    onPlaced(geom) {
      const apex = new THREE.Vector3(...geom.apex);
      const fwd = new THREE.Vector3(...geom.forward);
      const upLocal = apex.clone().normalize();
      const position = apex
        .clone()
        .addScaledVector(fwd, -FRUSTUM.planeDistM * FLIGHT.backFactor)
        .addScaledVector(upLocal, FRUSTUM.planeDistM * FLIGHT.liftFactor);
      const lookAt = apex.clone().addScaledVector(fwd, FRUSTUM.planeDistM);
      flight.start({ position, lookAt });
    },
  });

  // --- Idle orbital drift — the "spacecraft in LEO" feel (seed: "slightly rotating by default").
  //     Rotates the camera around Earth's axis at ISS-like angular speed; pauses the moment the
  //     user touches the scene and resumes after DRIFT.resumeMs. Skipped for reduced motion. ----
  let lastInteract = -Infinity;
  const noteInteract = () => {
    lastInteract = performance.now();
    flight.cancel(); // grabbing the globe aborts a flight — the user takes over
    useCameraStore.getState().clearTargetTilt(); // …and over a slider-set tilt glide
  };
  const dom = renderer.domElement;
  dom.addEventListener("pointerdown", noteInteract);
  dom.addEventListener("wheel", noteInteract, { passive: true });
  dom.addEventListener("touchstart", noteInteract, { passive: true });
  const _driftAxis = new THREE.Vector3(0, 0, 1); // ECEF +Z = Earth's rotation axis
  const _driftQ = new THREE.Quaternion();

  // --- Click-to-place (the missing-GPS path): while the store is in "placing", a CLICK (not a
  //     drag) casts the pointer ray at the ellipsoid and drops the photo there. ----------------
  let downX = 0;
  let downY = 0;
  const notePointerDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (useUploadStore.getState().phase !== "placing") return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // a drag, not a click
    const rect = dom.getBoundingClientRect();
    const ndc = new THREE.Vector3(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
      0.5,
    );
    const dir = ndc.unproject(camera).sub(camera.position).normalize();
    const hit = rayEllipsoidIntersect(
      [camera.position.x, camera.position.y, camera.position.z],
      [dir.x, dir.y, dir.z],
    );
    if (!hit) return; // clicked past the limb — stay in placing mode
    const g = ecefToGeodetic(hit);
    useUploadStore.getState().setPlacement(g.latDeg, g.lonDeg);
  };
  dom.addEventListener("pointerdown", notePointerDown);
  dom.addEventListener("pointerup", onPointerUp);
  // Crosshair while the globe waits for the placement click.
  const unsubCursor = useUploadStore.subscribe((s) => {
    dom.style.cursor = s.phase === "placing" ? "crosshair" : "";
  });
  const driftRadPerFrame = (DRIFT.degPerFrame * Math.PI) / 180;

  // Scratch vectors for the per-frame sun/shadow/sky work (no allocation on the hot path).
  const _camFwd = new THREE.Vector3();
  const _focus = new THREE.Vector3();
  const _focusUp = new THREE.Vector3();
  const _keyWhite = new THREE.Color(0xffffff);
  const _goldenCol = new THREE.Color(tokens.goldenHour);
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
        gastRad,
        sampleMs: lastSampleMs,
      }),
      terrainHeightAt: (lat: number, lon: number) => ground.heightAt(lat, lon),
      alt: () => WGS84_ELLIPSOID.getPositionElevation(camera.position),
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

        // True geodetic altitude above the WGS84 ellipsoid. (position.length() - WGS84_A is up to
        // ~21 km off at mid-latitudes — enough to mis-time the low-altitude gates.)
        const dist = camera.position.length();
        const alt = WGS84_ELLIPSOID.getPositionElevation(camera.position);
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
        if (camStore.targetTiltDeg !== null && !flight.active()) {
          controls.getPivotPoint(_pivot);
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
        // Mirror the live pitch into the store at low cadence for the panel readout (never at
        // 60 fps — same discipline as store/time).
        if (frameCount % 12 === 0) {
          zc.getUpDirection(camera.position, _pivotUp);
          _camBack.set(0, 0, 1).transformDirection(camera.matrixWorld);
          const liveTiltDeg = THREE.MathUtils.radToDeg(_pivotUp.angleTo(_camBack));
          if (Math.abs(liveTiltDeg - camStore.tiltDeg) > 0.25) camStore._syncTilt(liveTiltDeg);
        }

        ground.update(alt);

        // Ephemeris: re-sample when scene time moved enough (live clock or a pinned scrub).
        const tMs = sceneTimeMs();
        if (Math.abs(tMs - lastSampleMs) > SKY.sampleIntervalMs) sampleEphemeris(tMs);

        // View focus: camera-forward ray → ellipsoid (past-the-limb views fall back to the
        // sub-camera point). Drives the shadow rig AND the golden-hour key-light signal.
        camera.getWorldDirection(_camFwd);
        const focusHit = rayEllipsoidIntersect(
          [camera.position.x, camera.position.y, camera.position.z],
          [_camFwd.x, _camFwd.y, _camFwd.z],
        );
        if (focusHit) {
          _focus.set(focusHit[0], focusHit[1], focusHit[2]);
          _focusUp.copy(_focus).normalize();
        } else {
          _focusUp.copy(camera.position).normalize();
        }

        // Sun key light: ephemeris direction always; colour warms through the golden band as the
        // sun grazes the horizon AT THE FOCUS (same bell as the shader grades — buildings relight
        // in step with the ground); the shadow rig follows the focus at city altitudes AND only
        // while the sun is actually up there (a below-horizon sun would project garbage).
        if (sunLight) {
          const goldenK = goldenFactor(sunDirW.dot(_focusUp), GOLDEN);
          sunLight.color.lerpColors(_keyWhite, _goldenCol, goldenK * GOLDEN.keyStrength);
          let shadowsOn = false;
          if (alt < SHADOWS.maxAltM && focusHit && sunDirW.dot(_focusUp) > SHADOWS.minSunElevSin) {
            shadowsOn = true;
            sunLight.position.copy(_focus).addScaledVector(sunDirW, SHADOWS.lightDistM);
            sunLight.target.position.copy(_focus);
          }
          if (!shadowsOn) {
            // direction-only mode: keep the terminator agreement for building shading everywhere
            sunLight.position.copy(sunDirW).multiplyScalar(1e7);
            sunLight.target.position.set(0, 0, 0);
          }
          sunLight.castShadow = shadowsOn;
        }

        // Sun + moon bodies (camera-anchored, true apparent size; moon angular size uses the
        // camera→moon distance — it varies ±2% across an orbit swing).
        sky.update({
          camera,
          sunDir: sunDirW,
          moonPos: moonPosW,
          sunAngRad,
          moonAngRad: angularRadiusRad(MOON_RADIUS_KM * 1000, moonPosW.distanceTo(camera.position)),
          moonIllumination: moonIllum,
        });

        // Re-seat the placed photo as terrain tiles refine under it (low cadence — a raycast).
        if (++frameCount % 120 === 0) frustum.resnap();

        // Orbit-only decoration: hide the graticule + atmosphere once we dive toward the city
        // (no "wire cage" up-view, no shell overdraw over the buildings).
        const orbital = alt > GATES.decorMinAlt;
        graticule.lines.visible = orbital;
        atmosphere.mesh.visible = orbital;
        atmosphere.update(dist, alt);

        stars.update({
          alt,
          camera,
          elapsedS: (performance.now() - t0) / 1000,
          reduceMotion,
          gastRad,
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
      dom.style.cursor = "";
      unsubCursor();
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
