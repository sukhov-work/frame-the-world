import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  arrivalPose,
  pathAltitude,
  pathFollowWeight,
  pathFrameWeight,
} from "../../../src/components/globe/flight";
import { WGS84_A, WGS84_B } from "../../../src/lib/geo/projection";

/** Geocentric altitude of an ECEF point above the a/b-scaled ellipsoid (the flight's metric). */
function geocentricAlt(p: THREE.Vector3): number {
  const d = p.clone().normalize();
  const s = (WGS84_A / WGS84_B) * d.z;
  return p.length() - WGS84_A / Math.sqrt(d.x * d.x + d.y * d.y + s * s);
}

describe("pathAltitude (Phase 5.5 S2 terrain floor)", () => {
  const RAMP = 0.2;

  it("keeps both endpoints EXACT even when the floor sits above them", () => {
    // Valley-to-valley across mountains: both endpoints far below the floor.
    expect(pathAltitude(0, 800, 700, 0, 2_500, RAMP)).toBe(800);
    expect(pathAltitude(1, 800, 700, 0, 2_500, RAMP)).toBe(700);
    // LEO → city descent with a floor: endpoints still exact (float ε from sin(π) aside).
    expect(pathAltitude(0, 1_100_000, 800, 2_500_000, 3_250, RAMP)).toBe(1_100_000);
    expect(pathAltitude(1, 1_100_000, 800, 2_500_000, 3_250, RAMP)).toBeCloseTo(800, 6);
  });

  it("enforces the floor mid-flight when the raw blend would dip below it", () => {
    // Short low hop (bump 200 m) between two ~750 m valleys with a 2.5 km ridge floor.
    for (const e of [0.3, 0.5, 0.7]) {
      expect(pathAltitude(e, 800, 700, 200, 2_500, RAMP)).toBeGreaterThanOrEqual(2_500);
    }
    // Without the floor the same path would cruise near the valley altitudes.
    expect(pathAltitude(0.5, 800, 700, 200, null, RAMP)).toBeLessThan(1_000);
  });

  it("never PULLS a high path down (clamp is one-way)", () => {
    // A LEO→city flight flies far above any terrain floor — the floor must be a no-op.
    const withFloor = pathAltitude(0.5, 1_100_000, 3_000, 2_500_000, 3_250, RAMP);
    const without = pathAltitude(0.5, 1_100_000, 3_000, 2_500_000, null, RAMP);
    expect(withFloor).toBe(without);
  });

  it("keeps the ballistic bump for long hauls", () => {
    const mid = pathAltitude(0.5, 1_000, 1_000, 2_500_000, null, RAMP);
    expect(mid).toBeCloseTo(1_000 + 2_500_000, 3);
  });
});

describe("pathFrameWeight (orientation blend windows)", () => {
  it("is 0 at both endpoints (start/end poses stay exact)", () => {
    expect(pathFrameWeight(0, 0.15, 0.25)).toBe(0);
    expect(pathFrameWeight(1, 0.15, 0.25)).toBe(0);
  });

  it("is fully path-following through the middle and ramps out over the last quarter", () => {
    expect(pathFrameWeight(0.5, 0.15, 0.25)).toBe(1);
    expect(pathFrameWeight(0.15, 0.15, 0.25)).toBe(1); // blend-in complete
    expect(pathFrameWeight(0.75, 0.15, 0.25)).toBe(1); // blend-out starts here
    const late = pathFrameWeight(0.9, 0.15, 0.25);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(1);
  });
});

describe("pathFollowWeight (short hops keep the plain slerp)", () => {
  it("gates by ground distance", () => {
    expect(pathFollowWeight(5_000, 100_000, 600_000)).toBe(0); // pin → nearby pin
    expect(pathFollowWeight(2_000_000, 100_000, 600_000)).toBe(1); // LEO → another city
    const mid = pathFollowWeight(350_000, 100_000, 600_000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("arrivalPose (the ONE shared arrival derivation)", () => {
  // Equatorial test point: up = +X, the YZ plane is the local horizon.
  const groundAltM = 100;
  const lookAt = new THREE.Vector3(WGS84_A + groundAltM, 0, 0);
  const east = new THREE.Vector3(0, 1, 0);

  it("arrives altAboveGroundM over the ground at the requested tilt", () => {
    const pose = arrivalPose({
      lookAt: lookAt.clone(),
      approachHoriz: east.clone(),
      groundAltM,
      altAboveGroundM: 200,
      tiltDeg: 80,
      wgs84A: WGS84_A,
      wgs84B: WGS84_B,
    });
    expect(geocentricAlt(pose.position)).toBeCloseTo(300, 0); // ground 100 + 200 above it
    // Depression geometry: drop 200 m, horizontal back-off 200·tan(80°) ≈ 1134 m.
    // (The tangent-plane offset is short enough here that earth curvature is sub-metre.)
    const toLook = pose.lookAt.clone().sub(pose.position);
    const vertical = -toLook.x; // local up is +X here
    const horizontal = Math.hypot(toLook.y, toLook.z);
    expect(vertical).toBeCloseTo(200, 0);
    const tiltDeg = (Math.atan2(horizontal, vertical) * 180) / Math.PI;
    expect(tiltDeg).toBeCloseTo(80, 1);
  });

  it("matches the S1 search-arrival geometry (extent altitude at 52°)", () => {
    const altM = 40_000;
    const pose = arrivalPose({
      lookAt: lookAt.clone(),
      approachHoriz: east.clone(),
      groundAltM,
      altAboveGroundM: altM,
      tiltDeg: 52,
      wgs84A: WGS84_A,
      wgs84B: WGS84_B,
    });
    // The 51 km tangent-plane back-off leaves the curved surface: geocentric altitude gains
    // ≈ back²/2R ≈ 205 m — inherent to the (S1-identical) tangent construction, not an error.
    const back = altM * Math.tan((52 * Math.PI) / 180);
    const curvatureLift = (back * back) / (2 * WGS84_A);
    expect(geocentricAlt(pose.position)).toBeCloseTo(groundAltM + altM + curvatureLift, -2);
    expect(pose.position.y).toBeCloseTo(back, -1);
  });

  it("never arrives below the point it frames (uphill lookAt)", () => {
    const highLook = new THREE.Vector3(WGS84_A + 500, 0, 0); // apex well above the requested alt
    const pose = arrivalPose({
      lookAt: highLook.clone(),
      approachHoriz: east.clone(),
      groundAltM: 0,
      altAboveGroundM: 200,
      tiltDeg: 80,
      wgs84A: WGS84_A,
      wgs84B: WGS84_B,
    });
    expect(geocentricAlt(pose.position)).toBeGreaterThanOrEqual(500);
  });

  it("preserves the lookAt point exactly", () => {
    const pose = arrivalPose({
      lookAt: lookAt.clone(),
      approachHoriz: east.clone(),
      groundAltM,
      altAboveGroundM: 200,
      tiltDeg: 80,
      wgs84A: WGS84_A,
      wgs84B: WGS84_B,
    });
    expect(pose.lookAt.distanceTo(lookAt)).toBe(0);
  });
});
