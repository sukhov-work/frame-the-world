import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GlobeControls, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { PluxGlobeControls } from "../../../src/components/globe/scene/pluxGlobeControls";
import {
  belowCameraGateInstalled,
  resetBelowCameraGateStats,
  uninstallBelowCameraGate,
} from "../../../src/lib/globe/belowCameraGate";
import { geodeticToEcef } from "../../../src/lib/geo/projection";
import { CONTROLS } from "../../../src/components/globe/tuning";

/**
 * T79 — the controls subclass leans on three library-PRIVATE names in 3d-tiles-renderer 0.4.28.
 * These pins make a library bump that renames or re-plumbs them fail HERE, loudly, instead of
 * silently un-gating the orbit frame (the gate is a wrapper: if the library stopped calling
 * `_getPointBelowCamera`, the orbit frame would simply be slow again with no error).
 */

const LIB = "node_modules/3d-tiles-renderer/src/three/renderer/controls/";
const env = readFileSync(`${LIB}EnvironmentControls.js`, "utf8");
const glb = readFileSync(`${LIB}GlobeControls.js`, "utf8");

type Priv = {
  _getPointBelowCamera(point?: THREE.Vector3, up?: THREE.Vector3): THREE.Intersection | null;
  _updateZoom(): void;
  actionHeightOffset: number;
};

afterEach(() => {
  uninstallBelowCameraGate();
  resetBelowCameraGateStats();
});

describe("PluxGlobeControls — the library surface it overrides is still what 0.4.28 shipped", () => {
  it("EnvironmentControls builds the down-ray from 1e5 m above and reads only distance vs cameraRadius", () => {
    const below = env.slice(env.indexOf("_getPointBelowCamera( point = this.camera.position"));
    expect(below).toMatch(/addScaledVector\( up, 1e5 \)/);
    expect(below).toMatch(/hit\.distance -= 1e5/);
    // update(): the reuse-the-hit block subtracts actionHeightOffset, then compares to cameraRadius
    expect(env).toMatch(/hit\.distance -= actionHeightOffset/);
    expect(env).toMatch(/const dist = hit\.distance;\s*if \( dist < cameraRadius \)/);
    // adjustCamera(): the second per-frame call, same one-bit consumer
    const adjust = env.slice(env.indexOf("adjustCamera( camera ) {"));
    expect(adjust).toMatch(/_getPointBelowCamera\( camera\.position, _localUp \)/);
    expect(adjust.slice(0, 600)).toMatch(/if \( dist < cameraRadius \)/);
    // _updateZoom(): the one consumer of the EXACT distance (scales the zoom by it)
    const zoom = env.slice(env.indexOf("_updateZoom() {"));
    expect(zoom.slice(0, 5000)).toMatch(/const hit = this\._getPointBelowCamera\(\);[\s\S]{0,300}scale \* dist \* 0\.01/);
    // The plane fallback is off on the globe; the ellipsoid is the only fallback.
    expect(glb).toMatch(/this\.useFallbackPlane = false;/);
    expect(glb).toMatch(/ellipsoid\.intersectRay\( _ray, _vec \)/);
    // Both names the subclass overrides exist as prototype methods.
    const proto = GlobeControls.prototype as unknown as Priv;
    expect(typeof proto._getPointBelowCamera).toBe("function");
    expect(typeof proto._updateZoom).toBe("function");
  });

  it("the tunable margin is a small positive number (any positive value keeps the gate exact)", () => {
    expect(CONTROLS.belowCameraGateMarginM).toBeGreaterThan(0);
    expect(CONTROLS.belowCameraGateMarginM).toBeLessThanOrEqual(5);
  });
});

/** A camera 700 m over Dnipro with a flat terrain slab 100 m above the ellipsoid under it. */
function rig(altM: number) {
  const scene = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(50, 1.6, 1, 1e7);
  const [x, y, z] = geodeticToEcef(48.4647, 35.0462, altM);
  camera.position.set(x, y, z);
  const up = camera.position.clone().normalize();
  camera.up.copy(up);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  // Terrain: a 4 km tangent slab at 100 m, plus a 60 m "building" soup under the camera.
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial());
  const [gx, gy, gz] = geodeticToEcef(48.4647, 35.0462, 100);
  slab.position.set(gx, gy, gz);
  slab.lookAt(slab.position.clone().add(up)); // plane normal = up
  scene.add(slab);
  const bldg = new THREE.Mesh(new THREE.BoxGeometry(40, 60, 40).toNonIndexed(), new THREE.MeshBasicMaterial());
  const [bx, by, bz] = geodeticToEcef(48.4647, 35.0462, 130);
  bldg.position.set(bx, by, bz);
  bldg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  scene.add(bldg);
  scene.updateMatrixWorld(true);
  const controls = new PluxGlobeControls(scene, camera);
  controls.setEllipsoid(WGS84_ELLIPSOID, scene);
  controls.cameraRadius = CONTROLS.cameraRadius;
  return { controls, camera, scene, up };
}

describe("PluxGlobeControls — routing", () => {
  it("installs the gate once, gates the per-frame call at altitude, skips the far meshes, keeps the hit", () => {
    const { controls, camera, up } = rig(700);
    expect(belowCameraGateInstalled()).toBe(true);
    const priv = controls as unknown as Priv;
    // Exact reference from the un-subclassed library method on the same state.
    controls.belowCameraGateEnabled = false;
    const plain = priv._getPointBelowCamera(camera.position, up);
    controls.belowCameraGateEnabled = true;
    resetBelowCameraGateStats();
    const gated = priv._getPointBelowCamera(camera.position, up);
    const s = controls.belowCameraGate();
    expect(s.gated).toBe(1);
    expect(s.exact).toBe(0);
    expect(s.seen).toBe(2);
    expect(s.skipped).toBe(2); // slab top 100 m, building top 160 m — both 500+ m under the camera
    // Ungated: the first hit is the building roof (~540 m below); gated: no mesh hit → the
    // ellipsoid fallback (700 m below). Both are far outside the 2.5 m band → the SAME decision.
    // (`_getPointBelowCamera` already subtracts the 1e5 m lift — `distance` IS metres below.)
    expect(plain).not.toBeNull();
    expect(gated).not.toBeNull();
    expect(plain!.distance).toBeGreaterThan(controls.cameraRadius);
    expect(gated!.distance).toBeGreaterThan(controls.cameraRadius);
    expect(plain!.distance).toBeCloseTo(540, 0);
    expect(gated!.distance).toBeCloseTo(700, 0);
  });

  it("hovering 1 m over the roof, the roof's mesh is tested and the exact hit comes back", () => {
    const { controls, camera, up } = rig(161);
    const priv = controls as unknown as Priv;
    resetBelowCameraGateStats();
    const hit = priv._getPointBelowCamera(camera.position, up);
    const s = controls.belowCameraGate();
    expect(s.gated).toBe(1);
    expect(s.skipped).toBe(1); // the slab (top 100 m) is skipped, the building is not
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(1, 1);
    expect(hit!.distance).toBeLessThan(controls.cameraRadius); // the library WILL push
  });

  it("routes to the exact library path during _updateZoom, when disabled, and when the ellipsoid is in the band", () => {
    const { controls, camera, up } = rig(700);
    const priv = controls as unknown as Priv;
    resetBelowCameraGateStats();
    // The zoom path: `_updateZoom` with no zoom pending returns early — the flag must still reset.
    priv._updateZoom();
    expect((controls as unknown as { _exactBelow: boolean })._exactBelow).toBe(false);
    // Disabled → exact.
    controls.belowCameraGateEnabled = false;
    priv._getPointBelowCamera(camera.position, up);
    expect(controls.belowCameraGate().exact).toBe(1);
    controls.belowCameraGateEnabled = true;
    // The ellipsoid inside the band: a camera 1 m above the ellipsoid (under the slab) → exact.
    const [x, y, z] = geodeticToEcef(48.4647, 35.0462, 1);
    camera.position.set(x, y, z);
    camera.updateMatrixWorld(true);
    resetBelowCameraGateStats();
    priv._getPointBelowCamera(camera.position, up);
    const s = controls.belowCameraGate();
    expect(s.exact).toBe(1);
    expect(s.gated).toBe(0);
  });

  it("belowCameraGate(false/true) toggles and resets the counters (the DEV A/B seam)", () => {
    const { controls } = rig(700);
    expect(controls.belowCameraGate().enabled).toBe(true);
    expect(controls.belowCameraGate(false).enabled).toBe(false);
    expect(controls.belowCameraGate().gated).toBe(0);
    expect(controls.belowCameraGate(true).enabled).toBe(true);
  });
});
