import { describe, expect, it } from "vitest";
import { verticalFovDeg } from "../../../src/lib/decode/sensors";
import { ecefToGeodetic, enuBasis, geodeticToEcef, type Vec3 } from "../../../src/lib/geo/projection";
import {
  FACADE_VIEW_RADIUS_M,
  facadeApexDistanceM,
  facadeAspect,
  facadeFrustumGeometry,
  facadeInView,
  facadePaintedVolume,
  facadeSlotFade,
  facadeVolumeDistanceM,
  facadeVolumeInView,
  planFacadeSlots,
  type FacadeSlotRow,
} from "../../../src/lib/globe/facadeResidency";
import { frustumGeometry } from "../../../src/lib/geo/frustum";
import type { FacadePose } from "../../../src/lib/wix/facadeRecords";

// F3 residency (T169 / T171, 2026-10-21): the pure slot planner — the K nearest in-view rows
// inside the range, hysteresis both ways, stable slot order — and the stored pose → frustum.

const row = (id: string, distM: number, inView = true): FacadeSlotRow => ({ id, distM, inView });
const CFG = { slots: 3, rangeM: 900, swapMarginM: 60 };

describe("planFacadeSlots — the K nearest in-view rows inside the range", () => {
  it("no residents: the nearest K in view inside the range, nearest first", () => {
    const rows = [row("far", 2000), row("c", 300), row("a", 100), row("blind", 50, false), row("b", 200), row("d", 400)];
    const plan = planFacadeSlots(rows, [], CFG);
    expect(plan.slots).toEqual(["a", "b", "c"]);
    expect(plan.released).toEqual([]);
  });

  it("the range gate: a row past rangeM is a marker, not a candidate — even with free slots", () => {
    const plan = planFacadeSlots([row("a", 100), row("edge", 900), row("past", 901)], [], CFG);
    expect(plan.slots).toEqual(["a", "edge"]);
  });

  it("the in-view gate: an out-of-view row never earns a slot", () => {
    const plan = planFacadeSlots([row("behind", 10, false), row("a", 500)], [], CFG);
    expect(plan.slots).toEqual(["a"]);
  });

  it("determinism: distance ties break by id, and a duplicate id is read once", () => {
    const plan = planFacadeSlots([row("z", 100), row("m", 100), row("a", 100), row("a", 5)], [], { ...CFG, slots: 2 });
    expect(plan.slots).toEqual(["a", "m"]);
    const again = planFacadeSlots([row("a", 100), row("z", 100), row("m", 100)], [], { ...CFG, slots: 2 });
    expect(again.slots).toEqual(["a", "m"]);
  });

  it("HYSTERESIS (keep): a resident stays inside rangeM + swapMarginM, and is released past it", () => {
    const inBand = planFacadeSlots([row("r", 900 + 60)], ["r"], CFG);
    expect(inBand.slots).toEqual(["r"]);
    expect(inBand.released).toEqual([]);
    const pastBand = planFacadeSlots([row("r", 900 + 61)], ["r"], CFG);
    expect(pastBand.slots).toEqual([]);
    expect(pastBand.released).toEqual(["r"]);
  });

  it("HYSTERESIS (keep): a resident that left the view is released at once; a vanished row too", () => {
    const plan = planFacadeSlots([row("r", 100, false), row("a", 200)], ["r", "gone"], CFG);
    expect(plan.slots).toEqual(["a"]);
    expect(plan.released).toEqual(["r", "gone"]);
  });

  it("HYSTERESIS (displace): a candidate takes a full table's slot only when nearer than the farthest resident by MORE than the margin", () => {
    const resident = ["r1", "r2", "r3"];
    // r3 at 500 is the farthest resident; a candidate at 450 is 50 nearer — inside the margin: no swap.
    const hold = planFacadeSlots([row("r1", 100), row("r2", 300), row("r3", 500), row("c", 450)], resident, CFG);
    expect(hold.slots).toEqual(["r1", "r2", "r3"]);
    expect(hold.released).toEqual([]);
    // At 430 it is 70 nearer — past the margin: it takes r3's POSITION (slot indices are texture units).
    const swap = planFacadeSlots([row("r1", 100), row("r2", 300), row("r3", 500), row("c", 430)], resident, CFG);
    expect(swap.slots).toEqual(["r1", "r2", "c"]);
    expect(swap.released).toEqual(["r3"]);
    // Exactly the margin is NOT more than the margin.
    const exact = planFacadeSlots([row("r1", 100), row("r2", 300), row("r3", 500), row("c", 440)], resident, CFG);
    expect(exact.slots).toEqual(["r1", "r2", "r3"]);
  });

  it("HYSTERESIS (displace): two candidates can take two slots, farthest resident first; a third that cannot beat the margin ends the pass", () => {
    const resident = ["r1", "r2", "r3"];
    const rows = [row("r1", 100), row("r2", 600), row("r3", 800), row("c1", 50), row("c2", 400), row("c3", 560)];
    const plan = planFacadeSlots(rows, resident, CFG);
    // c1 (50) beats r3 (800) → r3's position; c2 (400) beats r2 (600) by 200 → r2's position;
    // c3 (560) vs the farthest remaining resident r1 (100): no.
    expect(plan.slots).toEqual(["r1", "c2", "c1"]);
    expect(plan.released).toEqual(["r2", "r3"]);
  });

  it("a newcomer is never displaced in the same plan (candidates arrive nearest first)", () => {
    const plan = planFacadeSlots([row("a", 100), row("b", 200), row("c", 300), row("d", 310)], [], CFG);
    expect(plan.slots).toEqual(["a", "b", "c"]);
  });

  it("K shrank: the nearest K keepers stay, in their slot order; the rest are released", () => {
    const plan = planFacadeSlots([row("r1", 500), row("r2", 100), row("r3", 300)], ["r1", "r2", "r3"], { ...CFG, slots: 2 });
    expect(plan.slots).toEqual(["r2", "r3"]);
    expect(plan.released).toEqual(["r1"]);
  });

  it("K = 0 releases everything; a non-finite distance is ignored", () => {
    expect(planFacadeSlots([row("r", 10)], ["r"], { ...CFG, slots: 0 })).toEqual({ slots: [], released: ["r"] });
    expect(planFacadeSlots([row("nan", NaN), row("a", 10)], [], CFG).slots).toEqual(["a"]);
  });

  it("stable order: surviving residents keep their relative order ahead of newcomers", () => {
    const plan = planFacadeSlots([row("near", 10), row("r1", 700), row("r2", 50)], ["r1", "r2"], CFG);
    // Free room (K=3): nobody is displaced; r1 keeps slot 0 although it is the farthest.
    expect(plan.slots).toEqual(["r1", "r2", "near"]);
  });
});

const pose = (over: Partial<FacadePose> = {}): FacadePose => ({
  lat: 48.4647,
  lon: 35.0462,
  apexAltM: 137.5,
  altitudeM: 1.7,
  headingDeg: 90,
  pitchDeg: 5,
  rollDeg: 0,
  focalLengthMm: 26,
  hFovDeg: 69,
  fovEstimated: false,
  textureWidth: 4032,
  textureHeight: 3024,
  ...over,
});

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("facadeFrustumGeometry — the stored pose rebuilt with no terrain lookup", () => {
  it("the apex sits at apexAltM above the ellipsoid (round-trip through ecefToGeodetic)", () => {
    const g = facadeFrustumGeometry(pose(), 120, 1.5);
    const geo = ecefToGeodetic(g.apex);
    expect(geo.latDeg).toBeCloseTo(48.4647, 6);
    expect(geo.lonDeg).toBeCloseTo(35.0462, 6);
    expect(geo.altM).toBeCloseTo(137.5, 3);
    // …and it is NOT the editor's altitudeM (1.7 m above the ground is not a height above the ellipsoid).
    expect(Math.abs(geo.altM - 1.7)).toBeGreaterThan(100);
  });

  it("the plane sits planeDistM ahead; the half-height follows the texture's aspect", () => {
    const g = facadeFrustumGeometry(pose(), 120, 1.5);
    const centre: Vec3 = [
      (g.corners[0][0] + g.corners[2][0]) / 2,
      (g.corners[0][1] + g.corners[2][1]) / 2,
      (g.corners[0][2] + g.corners[2][2]) / 2,
    ];
    expect(dist(centre, g.apex)).toBeCloseTo(120, 6);
    const halfH = dist(g.corners[0], g.corners[3]) / 2;
    const vFov = verticalFovDeg(69, 4032 / 3024);
    expect(halfH).toBeCloseTo(120 * Math.tan((vFov * Math.PI) / 360), 6);
    const halfW = dist(g.corners[0], g.corners[1]) / 2;
    expect(halfW).toBeCloseTo(120 * Math.tan((69 * Math.PI) / 360), 6);
  });

  it("the aspect falls back when the texture size is unknown — and only then", () => {
    expect(facadeAspect({ textureWidth: null, textureHeight: null }, 1.5)).toBe(1.5);
    expect(facadeAspect({ textureWidth: 0, textureHeight: 3024 }, 1.5)).toBe(1.5);
    expect(facadeAspect({ textureWidth: 3000, textureHeight: 2000 }, 1.5)).toBeCloseTo(1.5, 12);
    expect(facadeAspect({ textureWidth: 3024, textureHeight: 4032 }, 1.5)).toBeCloseTo(0.75, 12);
    const g = facadeFrustumGeometry(pose({ textureWidth: null, textureHeight: null }), 120, 2);
    const halfH = dist(g.corners[0], g.corners[3]) / 2;
    expect(halfH).toBeCloseTo(120 * Math.tan((verticalFovDeg(69, 2) * Math.PI) / 360), 6);
  });

  it("a garbage H-FOV does not poison the geometry (no NaN reaches an instance matrix)", () => {
    const g = facadeFrustumGeometry(pose({ hFovDeg: NaN }), 120, 1.5);
    for (const c of g.corners) for (const v of c) expect(Number.isFinite(v)).toBe(true);
    expect(g.forward.every(Number.isFinite)).toBe(true);
  });
});

describe("facadeApexDistanceM / facadeInView — the planner's two numbers per row", () => {
  const apex = geodeticToEcef(48.4647, 35.0462, 137.5);
  const { east, up } = enuBasis(48.4647, 35.0462);
  const at = (d: number, dir: Vec3): Vec3 => [apex[0] + dir[0] * d, apex[1] + dir[1] * d, apex[2] + dir[2] * d];
  const tanHalfV = Math.tan((60 * Math.PI) / 360);

  it("distance is the straight line camera → apex", () => {
    expect(facadeApexDistanceM(apex, at(300, east))).toBeCloseTo(300, 6);
    expect(facadeApexDistanceM(apex, apex)).toBe(0);
  });

  it("in view when the apex is ahead; not when behind; the eye on the apex is always in view", () => {
    const cam = at(300, east);
    const toApex: Vec3 = [-east[0], -east[1], -east[2]];
    expect(facadeInView(apex, cam, toApex, tanHalfV, 1.5, 0)).toBe(true);
    expect(facadeInView(apex, cam, east, tanHalfV, 1.5, 0)).toBe(false);
    expect(facadeInView(apex, apex, east, tanHalfV, 1.5, 0)).toBe(true);
    // Off the axis by 70° with a 60° V-FOV at 1.5 aspect (corner cone ≈ 46°): out; a 30° margin pulls it in.
    const side = at(300, up);
    expect(facadeInView(apex, side, east, tanHalfV, 1.5, 0)).toBe(false);
    expect(facadeInView(apex, side, east, tanHalfV, 1.5, Math.PI / 4)).toBe(true);
    expect(FACADE_VIEW_RADIUS_M).toBeGreaterThan(0);
  });
});

// ---- T177 (owner test 2026-10-22): residency by the PAINTED VOLUME, a distance fade, hysteresis ----
describe("facadePaintedVolume / facadeVolumeDistanceM / facadeVolumeInView — where the photo PAINTS, not where its apex is (T177)", () => {
  const lat = 48.4647;
  const lon = 35.0462;
  const { east, north, up } = enuBasis(lat, lon);
  // A photo at 1.7 m looking due EAST (heading 90°) with a 60° H-FOV at 1.5 aspect, range 600 m.
  const geom = frustumGeometry({
    latDeg: lat,
    lonDeg: lon,
    altM: 1.7,
    headingDeg: 90,
    pitchDeg: 0,
    rollDeg: 0,
    hFovDeg: 60,
    vFovDeg: verticalFovDeg(60, 1.5),
    planeDistM: 120,
  });
  const vol = facadePaintedVolume(geom, 600);
  const at = (dE: number, dN: number, dU: number): Vec3 => [
    geom.apex[0] + east[0] * dE + north[0] * dN + up[0] * dU,
    geom.apex[1] + east[1] * dE + north[1] * dN + up[1] * dU,
    geom.apex[2] + east[2] * dE + north[2] * dN + up[2] * dU,
  ];
  const tanHalfV = Math.tan((60 * Math.PI) / 360);
  const westward: Vec3 = [-east[0], -east[1], -east[2]];

  it("the cone: length = the range, the half-angle reaches the frustum's CORNER, the sphere holds the apex and the far rim", () => {
    expect(vol.lengthM).toBe(600);
    // tan(half-diagonal) at 60° × 1.5: halfW = tan30°, halfH = tan30°/1.5 → hypot.
    const want = Math.hypot(Math.tan(Math.PI / 6), Math.tan(Math.PI / 6) / 1.5);
    expect(vol.tanHalf).toBeCloseTo(want, 6);
    expect(facadeApexDistanceM(vol.centre, geom.apex)).toBeCloseTo(300, 6);
    const rim = at(600, 600 * vol.tanHalf, 0);
    expect(facadeApexDistanceM(vol.centre, rim)).toBeLessThanOrEqual(vol.radiusM + 1e-6);
    expect(facadeApexDistanceM(vol.centre, geom.apex)).toBeLessThanOrEqual(vol.radiusM);
    // A zero / garbage range collapses the cone to its apex.
    const flat = facadePaintedVolume(geom, 0);
    expect(flat.lengthM).toBe(0);
    expect(flat.radiusM).toBe(0);
  });

  it("distance: 0 inside the cone, the apex distance behind it, the overshoot past the cap, the slant beside it", () => {
    expect(facadeVolumeDistanceM(vol, at(200, 0, 0))).toBe(0); // on the axis, inside
    expect(facadeVolumeDistanceM(vol, at(200, 200 * vol.tanHalf * 0.9, 0))).toBe(0); // inside, near the wall
    expect(facadeVolumeDistanceM(vol, at(-30, 0, 0))).toBeCloseTo(30, 6); // 30 m BEHIND the apex (the owner's case)
    expect(facadeVolumeDistanceM(vol, at(700, 0, 0))).toBeCloseTo(100, 6); // 100 m past the cap, on the axis
    const beside = facadeVolumeDistanceM(vol, at(200, 200 * vol.tanHalf + 50, 0));
    expect(beside).toBeGreaterThan(0);
    expect(beside).toBeLessThan(50); // the slant is nearer than the radial gap
    expect(beside).toBeCloseTo(50 / Math.hypot(1, vol.tanHalf), 6);
    expect(facadeVolumeDistanceM(facadePaintedVolume(geom, 0), at(10, 0, 0))).toBeCloseTo(10, 6);
  });

  it("in view: a camera 30 m behind the apex looking AT the facades (the apex behind it) is in view; far behind and looking away is not", () => {
    const cam = at(-30, 0, 0);
    expect(facadeVolumeInView(vol, cam, east, tanHalfV, 1.5, 0)).toBe(true); // looking east with the photo
    // The old apex law said NO here — the apex is behind a camera looking east… wait, the apex is AHEAD
    // of a camera 30 m west of it looking east; put the camera 30 m EAST of the apex looking east: the apex
    // is behind it and the painted facades are in front — the owner's "really bad and glitchy" case.
    const inside = at(30, 0, 0);
    expect(facadeInView(geom.apex, inside, east, tanHalfV, 1.5, 0)).toBe(false); // the apex law: dropped
    expect(facadeVolumeInView(vol, inside, east, tanHalfV, 1.5, 0)).toBe(true); // the volume law: kept
    expect(facadeVolumeDistanceM(vol, inside)).toBe(0);
    // Turned 180° inside the volume (looking west, at the apex): still in view — the sphere holds the camera.
    expect(facadeVolumeInView(vol, inside, westward, tanHalfV, 1.5, 0)).toBe(true);
    // 3 km behind the apex looking further west: the sphere is behind the camera → out.
    expect(facadeVolumeInView(vol, at(-3000, 0, 0), westward, tanHalfV, 1.5, 0)).toBe(false);
    // 3 km behind looking east: the sphere is ahead, inside the cone → in.
    expect(facadeVolumeInView(vol, at(-3000, 0, 0), east, tanHalfV, 1.5, 0)).toBe(true);
  });
});

describe("facadeSlotFade — 1 inside the range's head, a smoothstep to 0 at the range (T177: degrade, never clip)", () => {
  it("the band", () => {
    expect(facadeSlotFade(0, 2000, 0.35)).toBe(1);
    expect(facadeSlotFade(1300, 2000, 0.35)).toBe(1); // the fade starts at 65 %
    expect(facadeSlotFade(1650, 2000, 0.35)).toBeCloseTo(0.5, 9); // the midpoint of the band
    expect(facadeSlotFade(2000, 2000, 0.35)).toBe(0);
    expect(facadeSlotFade(2500, 2000, 0.35)).toBe(0);
    // monotone across the band
    let prev = 1;
    for (let d = 1300; d <= 2000; d += 25) {
      const f = facadeSlotFade(d, 2000, 0.35);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });
  it("edge cases: a hard edge at fadeFrac 0, the whole range at ≥ 1, garbage → 0", () => {
    expect(facadeSlotFade(1999, 2000, 0)).toBe(1);
    expect(facadeSlotFade(2000, 2000, 0)).toBe(0);
    expect(facadeSlotFade(1000, 2000, 1)).toBeCloseTo(0.5, 9);
    expect(facadeSlotFade(Number.NaN, 2000, 0.35)).toBe(0);
    expect(facadeSlotFade(10, 0, 0.35)).toBe(0);
    expect(facadeSlotFade(10, 2000, Number.NaN)).toBe(1);
  });
});

describe("planFacadeSlots — the KEEP cone (inViewKeep) is the hysteresis of the in-view gate (T177)", () => {
  it("a resident that left the narrow cone but is still inside the KEEP cone stays; one outside both is released", () => {
    const rows: FacadeSlotRow[] = [
      { id: "a", distM: 100, inView: false, inViewKeep: true },
      { id: "b", distM: 200, inView: false, inViewKeep: false },
      { id: "c", distM: 300, inView: false, inViewKeep: true }, // not resident: a candidate needs inView
    ];
    const plan = planFacadeSlots(rows, ["a", "b"], CFG);
    expect(plan.slots).toEqual(["a"]);
    expect(plan.released).toEqual(["b"]);
  });
  it("without inViewKeep the old law holds (inView alone)", () => {
    const plan = planFacadeSlots([row("a", 100, false)], ["a"], CFG);
    expect(plan.slots).toEqual([]);
    expect(plan.released).toEqual(["a"]);
  });
});
