import { describe, expect, it } from "vitest";
import { verticalFovDeg } from "../../../src/lib/decode/sensors";
import { ecefToGeodetic, enuBasis, geodeticToEcef, type Vec3 } from "../../../src/lib/geo/projection";
import {
  FACADE_VIEW_RADIUS_M,
  facadeApexDistanceM,
  facadeAspect,
  facadeFrustumGeometry,
  facadeInView,
  planFacadeSlots,
  type FacadeSlotRow,
} from "../../../src/lib/globe/facadeResidency";
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
