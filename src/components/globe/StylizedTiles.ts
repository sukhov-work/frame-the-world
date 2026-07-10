import * as THREE from "three";
import { GlobeControls, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { ecefToGeodetic, rayEllipsoidIntersect } from "../../lib/geo/projection";
import { useUploadStore } from "../../store/upload";
import { attachBaseEarth } from "./scene/baseEarth";
import { attachGraticule } from "./scene/graticule";
import { attachAtmosphere } from "./scene/atmosphere";
import { attachStars } from "./scene/stars";
import { attachBuildings } from "./scene/buildings";
import { attachImageryGround } from "./scene/imageryGround";
import { attachPhotoFrustum } from "./PhotoFrustum";
import { createFlight } from "./flight";
import { CONTROLS, DRIFT, EARTH, FLIGHT, FRUSTUM, GATES, POSE, WGS84_A, WGS84_B } from "./tuning";

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
}): TilesHandle {
  const { scene, camera, renderer, ionToken, reduceMotion = false } = opts;
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
  const ground = attachImageryGround(scene, { camera, renderer, maxAniso });

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
      alt: () => WGS84_ELLIPSOID.getPositionElevation(camera.position),
    };
  }

  return {
    update() {
      // A single bad frame (transient tiles error, WebGL glitch) MUST NOT freeze the canvas.
      try {
        controls.update();
        camera.updateMatrixWorld();
        buildings.update();

        // Cinematic flight overrides the pose after controls (the drift pattern); an active
        // flight counts as interaction so the drift stays paused through it + resumeMs after.
        const now = performance.now();
        if (flight.update(now)) lastInteract = now;

        // True geodetic altitude above the WGS84 ellipsoid. (position.length() - WGS84_A is up to
        // ~21 km off at mid-latitudes — enough to mis-time the low-altitude gates.)
        const dist = camera.position.length();
        const alt = WGS84_ELLIPSOID.getPositionElevation(camera.position);

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

        ground.update(alt);

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
      earth.dispose();
      graticule.dispose();
      atmosphere.dispose();
      stars.dispose();
    },
  };
}
