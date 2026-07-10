import { describe, it, expect } from "vitest";
import { frustumGeometry, type FrustumParams } from "../../../src/lib/geo/frustum";
import {
  add,
  dot,
  ecefToGeodetic,
  enuBasis,
  geodeticToEcef,
  length,
  normalise,
  rayEllipsoidIntersect,
  scale,
  WGS84_A,
  WGS84_B,
  type Vec3,
} from "../../../src/lib/geo/projection";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

describe("ecefToGeodetic — inverse of geodeticToEcef", () => {
  const cases: Array<[number, number, number]> = [
    [0, 0, 0],
    [48.4647, 35.0462, 123], // Dnipro (the gps-heading fixture location)
    [-33.86, 151.21, 50], // Sydney (southern + eastern hemisphere)
    [71.2, -156.8, 10], // high latitude
    [46.0, 31.3, 1_100_000], // the LEO camera itself
  ];
  for (const [lat, lon, alt] of cases) {
    it(`roundtrips (${lat}, ${lon}, ${alt})`, () => {
      const g = ecefToGeodetic(geodeticToEcef(lat, lon, alt));
      expect(g.latDeg).toBeCloseTo(lat, 8);
      expect(g.lonDeg).toBeCloseTo(lon, 8);
      expect(g.altM).toBeCloseTo(alt, 4);
    });
  }
  it("handles the pole (longitude degenerates to 0 by convention)", () => {
    const g = ecefToGeodetic([0, 0, WGS84_B + 500]);
    expect(g.latDeg).toBeCloseTo(90, 6);
    expect(g.altM).toBeCloseTo(500, 3);
  });
});

describe("rayEllipsoidIntersect", () => {
  it("nadir ray from above the equator hits the sub-point", () => {
    const hit = rayEllipsoidIntersect([WGS84_A + 1_000_000, 0, 0], [-1, 0, 0]);
    expect(hit).not.toBeNull();
    expect(hit![0]).toBeCloseTo(WGS84_A, 4);
    expect(hit![1]).toBeCloseTo(0, 6);
  });
  it("returns the NEAR surface, not the back of the planet", () => {
    const hit = rayEllipsoidIntersect([0, 0, WGS84_B + 500_000], [0, 0, -1])!;
    expect(hit[2]).toBeCloseTo(WGS84_B, 4); // +Z pole, not -Z
  });
  it("misses when the ray points away from the planet", () => {
    expect(rayEllipsoidIntersect([WGS84_A + 1000, 0, 0], [1, 0, 0])).toBeNull();
    expect(rayEllipsoidIntersect([WGS84_A + 1000, 0, 0], [0, 1, 0])).toBeNull();
  });
  it("oblique ray from the LEO pose lands at a valid geodetic point", () => {
    const origin = geodeticToEcef(46.0, 31.3, 1_100_000);
    const aim = geodeticToEcef(48.4647, 35.0462, 0);
    const hit = rayEllipsoidIntersect(origin, normalise(sub(aim, origin)));
    expect(hit).not.toBeNull();
    const g = ecefToGeodetic(hit!);
    expect(g.latDeg).toBeCloseTo(48.4647, 4);
    expect(g.lonDeg).toBeCloseTo(35.0462, 4);
    expect(Math.abs(g.altM)).toBeLessThan(0.01); // on the surface
  });
});

describe("frustumGeometry — the gps-heading fixture reference (Dnipro, heading 214°, H-FOV 73.7°)", () => {
  // 24 mm-equiv on the committed fixture → computeHorizontalFov = 73.7°; 3:2 aspect → vFov 53.13°.
  const ref: FrustumParams = {
    latDeg: 48.4647,
    lonDeg: 35.0462,
    altM: 1.7,
    headingDeg: 214,
    pitchDeg: 0,
    hFovDeg: 73.7,
    vFovDeg: 53.13,
    planeDistM: 100,
  };

  it("apex sits at the capture location", () => {
    const { apex } = frustumGeometry(ref);
    const g = ecefToGeodetic(apex);
    expect(g.latDeg).toBeCloseTo(ref.latDeg, 8);
    expect(g.lonDeg).toBeCloseTo(ref.lonDeg, 8);
    expect(g.altM).toBeCloseTo(1.7, 4);
  });

  it("forward reproduces the compass heading 214° (SW), level pitch", () => {
    const { forward } = frustumGeometry(ref);
    const { east, north, up } = enuBasis(ref.latDeg, ref.lonDeg);
    const az = (Math.atan2(dot(forward, east), dot(forward, north)) * 180) / Math.PI;
    expect((az + 360) % 360).toBeCloseTo(214, 6);
    expect(dot(forward, up)).toBeCloseTo(0, 6); // pitch 0 = level
  });

  it("all four corners lie on the image plane at planeDistM", () => {
    const { apex, forward, corners } = frustumGeometry(ref);
    for (const c of corners) {
      expect(dot(sub(c, apex), forward)).toBeCloseTo(ref.planeDistM, 6);
    }
  });

  it("far face spans 2·d·tan(fov/2) in each axis", () => {
    const { corners } = frustumGeometry(ref);
    const [tl, tr, br, bl] = corners;
    const width = 2 * ref.planeDistM * Math.tan((ref.hFovDeg * Math.PI) / 360);
    const height = 2 * ref.planeDistM * Math.tan((ref.vFovDeg * Math.PI) / 360);
    expect(length(sub(tr, tl))).toBeCloseTo(width, 6);
    expect(length(sub(br, bl))).toBeCloseTo(width, 6);
    expect(length(sub(tl, bl))).toBeCloseTo(height, 6);
    expect(length(sub(tr, br))).toBeCloseTo(height, 6);
  });

  it("top edge is higher than the bottom edge (level camera, up ≈ geodetic up)", () => {
    const { corners } = frustumGeometry(ref);
    const { up } = enuBasis(ref.latDeg, ref.lonDeg);
    expect(dot(corners[0], up)).toBeGreaterThan(dot(corners[3], up));
  });

  it("pitch tilts forward off the horizon by exactly the pitch angle", () => {
    const { forward } = frustumGeometry({ ...ref, pitchDeg: 10 });
    const { up } = enuBasis(ref.latDeg, ref.lonDeg);
    expect(dot(forward, up)).toBeCloseTo(Math.sin((10 * Math.PI) / 180), 6);
  });

  it("roll 180° maps top-left onto roll-0's bottom-right", () => {
    const a = frustumGeometry(ref);
    const b = frustumGeometry({ ...ref, rollDeg: 180 });
    for (let i = 0; i < 3; i++) expect(b.corners[0][i]).toBeCloseTo(a.corners[2][i], 4);
  });

  it("the basis stays orthonormal under roll", () => {
    const { forward, up, right } = frustumGeometry({ ...ref, rollDeg: 33 });
    expect(length(forward)).toBeCloseTo(1, 6);
    expect(length(up)).toBeCloseTo(1, 6);
    expect(length(right)).toBeCloseTo(1, 6);
    expect(dot(forward, up)).toBeCloseTo(0, 6);
    expect(dot(forward, right)).toBeCloseTo(0, 6);
    expect(dot(up, right)).toBeCloseTo(0, 6);
  });

  it("survives a straight-down camera (degenerate horizontal reference)", () => {
    const g = frustumGeometry({ ...ref, pitchDeg: -90 });
    expect(length(g.right)).toBeCloseTo(1, 6);
    expect(length(g.up)).toBeCloseTo(1, 6);
  });

  it("image-plane centre sits planeDistM along forward", () => {
    const { apex, forward, corners } = frustumGeometry(ref);
    const centre = scale(
      corners.reduce((s, c) => add(s, c), [0, 0, 0] as Vec3),
      0.25,
    );
    const expected = add(apex, scale(forward, ref.planeDistM));
    for (let i = 0; i < 3; i++) expect(centre[i]).toBeCloseTo(expected[i], 4);
  });
});
