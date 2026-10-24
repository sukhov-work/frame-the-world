import { describe, expect, it } from "vitest";
import {
  draftReprojection,
  ecefOfEnu,
  enuOfEcef,
  enuOfGeodetic,
  enuPoseOfDraft,
  geodeticOfEnu,
  intrinsicsOfDraft,
  rayThroughUv,
  solveFacadeDraft,
  uvOfClick,
  type FacadeAlignOrigin,
  type FacadeAlignPair,
  type FacadeDraftPose,
} from "../../../src/lib/geo/facadeAlign";
import { facadePairsPlanar, projectFacadePoint } from "../../../src/lib/geo/pnp";
import { frustumGeometry } from "../../../src/lib/geo/frustum";
import { rayGridDirections } from "../../../src/lib/globe/facadeTargets";
import { geodeticToEcef, type Vec3 } from "../../../src/lib/geo/projection";
import { verticalFovDeg } from "../../../src/lib/decode/sensors";

/**
 * F5's UI half, the pure part (T172, 2026-10-24): the ENU bridge the pairs ride, the one-point ray
 * (the harness's ground truth), the click → uv map, and `solveFacadeDraft` — the whole chain from a
 * misplaced draft + pairs picked on the REAL building geometry back to the truth pose, through the
 * app's own `frustumGeometry` (so the uv frame, the basis and the altitude law are pinned against
 * the renderer's builders, not against the solver's own conventions).
 */

const DEG = Math.PI / 180;
const LAT = 48.4647;
const LON = 35.0462;
const TERRAIN_M = 110.7; // the rendered ground under the street
const EYE_M = 1.7;
const W = 4032;
const H = 3024;
const HFOV = 69.4;
const M_PER_DEG_LAT = 111_320;
const mPerDegLon = M_PER_DEG_LAT * Math.cos(LAT * DEG);

/** The TRUTH: where the photographer really stood (the apex 1.7 m over the street). */
const TRUTH = { latDeg: LAT, lonDeg: LON, altM: TERRAIN_M + EYE_M, headingDeg: 214, pitchDeg: 2, rollDeg: 0.5, hFovDeg: HFOV };

/** The far face of the truth frustum 25 m out IS a wall facing the camera: world points at known uv. */
function wallPairs(uvs: [number, number][], origin: FacadeAlignOrigin, planeDistM = 25): FacadeAlignPair[] {
  const geom = frustumGeometry({ ...TRUTH, vFovDeg: verticalFovDeg(HFOV, W / H), planeDistM });
  const [tl, tr, br, bl] = geom.corners;
  const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return uvs.map(([u, v]) => {
    const p = lerp(lerp(tl, bl, v), lerp(tr, br, v), u);
    return { uv: [u, v], enu: enuOfEcef(origin, p) };
  });
}
const GRID: [number, number][] = [[0.1, 0.15], [0.9, 0.15], [0.9, 0.85], [0.1, 0.85], [0.5, 0.5], [0.3, 0.7], [0.7, 0.3], [0.5, 0.9]];

/** The DRAFT as the GPS placed it: 4 m east, 2 m north, 1 m high, 3° of heading off the truth. */
const draftOf = (over: Partial<FacadeDraftPose> = {}): FacadeDraftPose => ({
  lat: LAT + 2 / M_PER_DEG_LAT,
  lon: LON + 4 / mPerDegLon,
  apexAltM: TERRAIN_M + EYE_M + 1,
  apexAboveGroundM: EYE_M + 1,
  headingDeg: 217,
  pitchDeg: 2,
  rollDeg: 0.5,
  hFovDeg: HFOV,
  textureWidth: W,
  textureHeight: H,
  ...over,
});
/** The origin is the DRAFT's apex at the first pick (the user picks pairs on the misplaced draft). */
const originOf = (d: FacadeDraftPose): FacadeAlignOrigin => ({ lat: d.lat, lon: d.lon, altM: d.apexAltM });

const mOff = (a: { lat: number; lon: number }, b: { latDeg: number; lonDeg: number }) =>
  Math.hypot((a.lat - b.latDeg) * M_PER_DEG_LAT, (a.lon - b.lonDeg) * mPerDegLon);

describe("the geodetic ↔ ENU bridge", () => {
  const origin: FacadeAlignOrigin = { lat: LAT, lon: LON, altM: 112.4 };

  it("round-trips ECEF and geodetic points through ENU to the millimetre; the origin is [0, 0, 0]", () => {
    expect(enuOfGeodetic(origin, LAT, LON, 112.4).map((v) => Math.abs(v) < 1e-6)).toEqual([true, true, true]);
    const p = geodeticToEcef(LAT + 0.0004, LON - 0.0006, 130);
    const enu = enuOfEcef(origin, p);
    const back = ecefOfEnu(origin, enu);
    for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - p[i])).toBeLessThan(1e-6);
    const g = geodeticOfEnu(origin, enu);
    expect(Math.abs(g.latDeg - (LAT + 0.0004))).toBeLessThan(1e-10);
    expect(Math.abs(g.lonDeg - (LON - 0.0006))).toBeLessThan(1e-10);
    expect(Math.abs(g.altM - 130)).toBeLessThan(1e-6);
  });

  it("east / north / up mean what they say (10 m north ≈ +9e-5° lat; 5 m up = +5 m alt)", () => {
    const g = geodeticOfEnu(origin, [0, 10, 5]);
    expect(g.latDeg).toBeGreaterThan(LAT);
    // 111,320 m / ° is the test's round constant (the meridian degree at 48.5° is ~111,205 m).
    expect(Math.abs((g.latDeg - LAT) * M_PER_DEG_LAT - 10)).toBeLessThan(0.05);
    expect(Math.abs(g.lonDeg - LON)).toBeLessThan(1e-9);
    expect(Math.abs(g.altM - 117.4)).toBeLessThan(1e-5);
    const e = geodeticOfEnu(origin, [10, 0, 0]);
    expect(Math.abs((e.lonDeg - LON) * mPerDegLon - 10)).toBeLessThan(0.05);
  });
});

describe("rayThroughUv + uvOfClick", () => {
  it("rayThroughUv at a cell centre equals rayGridDirections' ray for that cell; the corners hit the corners", () => {
    const geom = frustumGeometry({ ...TRUTH, vFovDeg: verticalFovDeg(HFOV, W / H), planeDistM: 25 });
    const grid = rayGridDirections(geom, 7, 5);
    // row 2 (v = 2.5 / 5), column 3 (u = 3.5 / 7) → index 2 * 7 + 3
    const d = rayThroughUv(geom, 3.5 / 7, 2.5 / 5);
    const g = grid[2 * 7 + 3];
    for (let i = 0; i < 3; i++) expect(Math.abs(d[i] - g[i])).toBeLessThan(1e-12);
    const toCorner = (c: Vec3): Vec3 => {
      const v: Vec3 = [c[0] - geom.apex[0], c[1] - geom.apex[1], c[2] - geom.apex[2]];
      const n = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / n, v[1] / n, v[2] / n];
    };
    const tl = toCorner(geom.corners[0]);
    const br = toCorner(geom.corners[2]);
    const dTl = rayThroughUv(geom, 0, 0);
    const dBr = rayThroughUv(geom, 1, 1);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(dTl[i] - tl[i])).toBeLessThan(1e-12);
      expect(Math.abs(dBr[i] - br[i])).toBeLessThan(1e-12);
    }
  });

  it("uvOfClick maps a client point over the image rect; outside → null; a degenerate rect → null", () => {
    const rect = { left: 100, top: 50, width: 800, height: 600 };
    expect(uvOfClick(100, 50, rect)).toEqual([0, 0]);
    expect(uvOfClick(900, 650, rect)).toEqual([1, 1]);
    expect(uvOfClick(300, 200, rect)).toEqual([0.25, 0.25]);
    expect(uvOfClick(99, 50, rect)).toBeNull();
    expect(uvOfClick(500, 651, rect)).toBeNull();
    expect(uvOfClick(500, 300, { ...rect, width: 0 })).toBeNull();
  });
});

describe("solveFacadeDraft — a misplaced draft + pairs on the real wall → the truth pose", () => {
  it("the planar wall, 8 pairs, the H-FOV held: back to the truth within 1 mm / 1e-3°; altitudeM = the eye over the street", () => {
    const draft = draftOf();
    const origin = originOf(draft);
    const pairs = wallPairs(GRID, origin);
    const r = solveFacadeDraft(pairs, origin, draft, { now: Date.UTC(2026, 9, 24, 12) });
    if (!r.ok) throw new Error(r.reason);
    expect(mOff(r.snapshot, TRUTH)).toBeLessThan(1e-3);
    expect(Math.abs(r.snapshot.headingDeg! - TRUTH.headingDeg)).toBeLessThan(1e-3);
    expect(Math.abs(r.snapshot.pitchDeg! - TRUTH.pitchDeg)).toBeLessThan(1e-3);
    expect(Math.abs(r.snapshot.rollDeg! - TRUTH.rollDeg)).toBeLessThan(1e-3);
    expect(r.snapshot.hFovDeg).toBe(HFOV); // held — N ≥ 6 but the checkbox is off
    // The altitude law: the solved apex (ellipsoidal) minus the ground under the draft NOW.
    expect(Math.abs(r.snapshot.altitudeM! - EYE_M)).toBeLessThan(1e-3);
    expect(r.solved.pose).toEqual(r.snapshot);
    expect(r.solved.n).toBe(8);
    expect(r.solved.fovSolved).toBe(false);
    expect(r.solved.planar).toBe(true);
    expect(r.solved.rmsPx).toBeLessThan(1e-2);
    expect(r.solved.at).toBe("2026-10-24T12:00:00.000Z");
    expect(r.clamped).toBe(false);
    // The live readout of the SOLVED pose over the pairs is ≈ 0 px; of the draft it is not.
    const seated: FacadeDraftPose = { ...draft, lat: r.snapshot.lat, lon: r.snapshot.lon, apexAltM: TRUTH.altM, apexAboveGroundM: EYE_M, headingDeg: r.snapshot.headingDeg!, pitchDeg: r.snapshot.pitchDeg!, rollDeg: r.snapshot.rollDeg! };
    expect(draftReprojection(pairs, origin, seated).rmsPx).toBeLessThan(1e-2);
    expect(draftReprojection(pairs, origin, draft).rmsPx).toBeGreaterThan(50);
  });

  it("solveFov with N ≥ 6 recovers an H-FOV the draft had 6° wrong — given DEPTH (a corner); N 4–5 holds it", () => {
    const draft = draftOf({ hFovDeg: HFOV + 6 });
    const origin = originOf(draft);
    // A fronto-parallel wall alone cannot pin the field of view (zoom and distance trade off
    // exactly — the dolly-zoom); two points on a nearer wall (a corner 13 m closer) break the tie.
    const pairs = [...wallPairs(GRID.slice(0, 6), origin), ...wallPairs([[0.92, 0.3], [0.96, 0.75]], origin, 12)];
    const r = solveFacadeDraft(pairs, origin, draft, { solveFov: true });
    if (!r.ok) throw new Error(r.reason);
    expect(r.solved.fovSolved).toBe(true);
    expect(r.solved.planar).toBe(false);
    expect(Math.abs(r.snapshot.hFovDeg! - HFOV)).toBeLessThan(1e-2);
    expect(mOff(r.snapshot, TRUTH)).toBeLessThan(5e-3);
    expect(Math.abs(r.snapshot.headingDeg! - TRUTH.headingDeg)).toBeLessThan(1e-2);
    const r5 = solveFacadeDraft(pairs.slice(0, 5), origin, draft, { solveFov: true });
    if (!r5.ok) throw new Error(r5.reason);
    expect(r5.solved.fovSolved).toBe(false);
    expect(r5.snapshot.hFovDeg).toBe(HFOV + 6); // held at the draft's number
    // The flat wall alone with the FOV released: the solve still answers (the LM lands in the
    // dolly-zoom valley) — the panel's planar note exists for exactly this.
    const flat = solveFacadeDraft(wallPairs(GRID, origin), origin, draft, { solveFov: true });
    expect(flat.ok).toBe(true);
    if (flat.ok) expect(flat.solved.planar).toBe(true);
  });

  it("the rails clamp the snapshot and say so; the solve record carries the CLAMPED pose (what was applied)", () => {
    const draft = draftOf();
    const origin = originOf(draft);
    const pairs = wallPairs(GRID, origin);
    const r = solveFacadeDraft(pairs, origin, draft, { rails: { altM: [2, 60], pitchMaxDeg: 45, rollMaxDeg: 30, hFovDeg: [5, 120] } });
    if (!r.ok) throw new Error(r.reason);
    expect(r.clamped).toBe(true);
    expect(r.snapshot.altitudeM).toBe(2);
    expect(r.solved.pose.altitudeM).toBe(2);
    const r2 = solveFacadeDraft(pairs, origin, draft, { rails: { altM: [0, 60], pitchMaxDeg: 45, rollMaxDeg: 30, hFovDeg: [5, 120] } });
    if (!r2.ok) throw new Error(r2.reason);
    expect(r2.clamped).toBe(false);
  });

  it("refuses fewer than 4 pairs, an unseated draft, and a degenerate set — ok: false, never a throw", () => {
    const draft = draftOf();
    const origin = originOf(draft);
    const pairs = wallPairs(GRID, origin);
    expect(solveFacadeDraft(pairs.slice(0, 3), origin, draft)).toMatchObject({ ok: false, reason: /at least 4/ });
    expect(solveFacadeDraft(pairs, origin, { ...draft, apexAltM: Number.NaN })).toMatchObject({ ok: false, reason: /seated/ });
    const same: FacadeAlignPair[] = [pairs[0], pairs[0], pairs[1], pairs[2]];
    expect(solveFacadeDraft(same, origin, draft).ok).toBe(false);
  });

  it("the draft's own ENU pose reprojects the pairs where the TRUTH frustum put them when the draft IS the truth", () => {
    const truthDraft = draftOf({ lat: LAT, lon: LON, apexAltM: TRUTH.altM, apexAboveGroundM: EYE_M, headingDeg: TRUTH.headingDeg });
    const origin = originOf(truthDraft);
    const pairs = wallPairs(GRID, origin);
    const pose = enuPoseOfDraft(origin, truthDraft);
    const intr = intrinsicsOfDraft(truthDraft);
    expect(intr).toEqual({ hFovDeg: HFOV, aspect: W / H, widthPx: W });
    for (const p of pairs) {
      const uv = projectFacadePoint(p.enu, pose, intr.aspect)!;
      expect(Math.abs(uv[0] - p.uv[0]) * W).toBeLessThan(0.05);
      expect(Math.abs(uv[1] - p.uv[1]) * H).toBeLessThan(0.05);
    }
  });

  it("facadePairsPlanar: one wall → true; a corner point → false; < 3 → null", () => {
    const draft = draftOf();
    const origin = originOf(draft);
    const wall = wallPairs(GRID, origin);
    expect(facadePairsPlanar(wall)).toBe(true);
    const corner = [...wall.slice(0, 6), ...wallPairs([[0.95, 0.5]], origin, 12)]; // a point 13 m nearer
    expect(facadePairsPlanar(corner)).toBe(false);
    expect(facadePairsPlanar(wall.slice(0, 2))).toBeNull();
  });
});
