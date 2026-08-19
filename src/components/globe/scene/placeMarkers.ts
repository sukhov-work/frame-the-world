import * as THREE from "three";
import { geodeticToEcef } from "../../../lib/geo/projection";
import { sampleGroundM } from "../../../lib/geo/terrain";
import { tokens } from "../../../lib/theme/tokens";
import { PLACEMARKS } from "../tuning";
import { glf } from "./glsl";

/**
 * placeMarkers — MY PLACES on the GL globe (owner 2026-08-19b): the member's saved views as
 * quiet lavender ring-dots, the scene twin of the 2D map-window layer (MapWindow's canvas
 * drawing). One instanced billboard per place: a thin ring + core dot facing the camera,
 * angular-constant size, terrain-snapped with the Pins resnap idiom.
 *
 * Deliberately NOT the Pins system: no stems, no clustering, no shimmer, no picking — this
 * is a wayfinding overlay (where are my bookmarks), not content. depthTest stays OFF so a
 * dot reads through buildings/terrain like the aim overlay; the far hemisphere is culled
 * CPU-side instead (a depth-free dot must not shine through the planet from orbit).
 *
 * PRECISION: same anchor-at-the-camera layout as Pins — ECEF instance translations are
 * camera-relative so the float32 large×large cancellation happens on the CPU in float64.
 */

export interface PlaceMarkerSpot {
  latDeg: number;
  lonDeg: number;
}

export interface PlaceMarkersHandle {
  setPlaces(spots: readonly PlaceMarkerSpot[]): void;
  update(camera: THREE.PerspectiveCamera): void;
  /** Master visibility (the PLC / LAYERS "MY PLACES" chips via store/places.onMap). */
  setVisible(on: boolean): void;
  /** Re-ask the terrain for ground height (cheap, low cadence — the Pins idiom). */
  resnap(): void;
  dispose(): void;
}

export function attachPlaceMarkers(
  scene: THREE.Scene,
  opts: {
    /** Rendered terrain height (m above ellipsoid) at a location — null until tiles cover it. */
    terrainHeightAt?: (latDeg: number, lonDeg: number) => number | null;
  } = {},
): PlaceMarkersHandle {
  const cap = PLACEMARKS.maxRender;

  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false, // wayfinding overlay — reads through the world (far side CPU-culled)
    uniforms: {
      uColor: { value: new THREE.Color(tokens.pinLavender) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUvC;
      void main() {
        vUvC = position.xy; // plane spans [-1, 1]²
        // Billboard in VIEW space (the Pins flare recipe): corners offset along the view
        // axes at the instance's uniform scale — modelViewMatrix path only (precision note).
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float scale = length(vec3(instanceMatrix[0]));
        gl_Position = projectionMatrix * vec4(centre.xyz + vec3(position.xy * scale, 0.0), 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUvC;
      void main() {
        float r = length(vUvC);
        // Ring annulus + core dot — the 2D map-window marker anatomy, AA via smoothstep.
        float ring = smoothstep(0.98, 0.90, r) * smoothstep(0.68, 0.78, r);
        float core = 1.0 - smoothstep(0.22, 0.32, r);
        float a = max(ring, core) * ${glf(PLACEMARKS.alpha)};
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, cap);
  mesh.count = 0;
  mesh.frustumCulled = false; // instances span the whole planet
  mesh.raycast = () => {}; // decoration — never a pick target
  mesh.renderOrder = 3;
  scene.add(mesh);

  let spots: PlaceMarkerSpot[] = [];
  const positions: THREE.Vector3[] = []; // marker centre (ground + liftM), ECEF
  const grounded: boolean[] = []; // true once real terrain height answered (resnap idiom)

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion(); // identity — the shader billboards, rotation irrelevant
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _toCam = new THREE.Vector3();
  const _camLast = new THREE.Vector3(Infinity, Infinity, Infinity);
  let dirty = true;
  let shown = true;

  const place = (i: number) => {
    const s = spots[i];
    const { h, real } = sampleGroundM(
      opts.terrainHeightAt?.(s.latDeg, s.lonDeg),
      PLACEMARKS.fallbackGroundM,
    );
    const [x, y, z] = geodeticToEcef(s.latDeg, s.lonDeg, h + PLACEMARKS.liftM);
    (positions[i] ??= new THREE.Vector3()).set(x, y, z);
    grounded[i] = real;
  };

  return {
    setPlaces(next: readonly PlaceMarkerSpot[]) {
      spots = next.slice(0, cap);
      positions.length = spots.length;
      grounded.length = spots.length;
      for (let i = 0; i < spots.length; i++) place(i);
      mesh.count = spots.length;
      dirty = true;
    },

    update(camera: THREE.PerspectiveCamera) {
      if (spots.length === 0 || !shown) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      const camMoved = _camLast.distanceToSquared(camera.position) > 1;
      if (!dirty && !camMoved) return;
      _camLast.copy(camera.position);
      dirty = false;

      // Anchor AT the camera (precision note) — instance translations are camera-relative.
      mesh.position.copy(camera.position);
      for (let i = 0; i < spots.length; i++) {
        const p = positions[i];
        // Far-hemisphere cull: a depth-free overlay dot must not shine through the planet.
        _up.copy(p).normalize();
        const facing = _up.dot(_toCam.subVectors(camera.position, p).normalize()) > 0;
        const size = facing
          ? THREE.MathUtils.clamp(
              camera.position.distanceTo(p) * PLACEMARKS.angularSize,
              PLACEMARKS.minSizeM,
              PLACEMARKS.maxSizeM,
            )
          : 0; // scale 0 → degenerate quad, nothing rasterises
        _m.compose(_p.subVectors(p, camera.position), _q, _s.setScalar(size));
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },

    setVisible(on: boolean) {
      if (on === shown) return;
      shown = on;
      if (on) dirty = true; // matrices went stale while hidden
    },

    resnap() {
      let changed = false;
      for (let i = 0; i < spots.length; i++) {
        if (grounded[i]) continue;
        place(i);
        if (grounded[i]) changed = true;
      }
      if (changed) dirty = true;
    },

    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
