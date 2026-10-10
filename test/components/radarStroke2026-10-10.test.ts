import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AIMCONES } from "../../src/components/globe/tuning";
import { groundReachK } from "../../src/components/globe/scene/aimCones";
import { radarStroke } from "../../src/lib/geo/radarBands";
import {
  chartRayReachPx,
  drawRadarCanvas,
  type RadarCanvasBody,
  type RadarCanvasOpts,
} from "../../src/components/panels/radarCanvas";
import type { AimSample } from "../../src/lib/ephemeris/azSector";

/**
 * THE RADAR ON GLASS (owner 2026-10-10, iPhone 17 Pro): "radar lines too narrow … make them
 * thicker and more vivid (still tasteful), same for the sectors and radiuses … the directional
 * dials can still be shorter than the screen when zooming out, and end when scrolling the map".
 *
 * Four rules, pinned here:
 *   1. the STROKE PROFILE — every radar stroke on /m wears `AIMCONES.mobileStroke`, desktop is
 *      the identity (byte-identical ink);
 *   2. the canvas painter authors strokes in SCREEN CSS px × the store ratio it is handed;
 *   3. the chart's target ray covers the whole canvas from ANY anchor (`chartRayReachPx`);
 *   4. the GL fan's target ray runs past the farthest point of the tangent plane the viewport's
 *      corners can see (`groundReachK`), capped at the horizon reach.
 * Plus the source fences: the mini-map's store is sized to the glass, the GL rim/spokes are
 * quads, the orchestrator hands the fan the camera.
 */

const SRC = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

type Op = { op: string; args: unknown[] };
function recorder() {
  const ops: Op[] = [];
  const state = { globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 0 };
  const push = (op: string, ...args: unknown[]) => ops.push({ op, args });
  const ctx = {
    ops,
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(v: number) {
      state.globalAlpha = v;
      push("globalAlpha", v);
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
      push("lineWidth", v);
    },
    beginPath: () => push("beginPath"),
    closePath: () => push("closePath"),
    moveTo: (x: number, y: number) => push("moveTo", x, y),
    lineTo: (x: number, y: number) => push("lineTo", x, y),
    fill: () => push("fill"),
    stroke: () => push("stroke"),
  };
  return ctx as unknown as CanvasRenderingContext2D & { ops: Op[] };
}
const sample = (azDeg: number, altDeg: number): AimSample => ({ utcMs: 0, azDeg, altDeg });
const RUN = [sample(10, 5), sample(40, 20), sample(70, 5)];
const body = (o: Partial<RadarCanvasBody> = {}): RadarCanvasBody => ({
  key: "sun",
  color: "#ffd9a0",
  emphasized: false,
  past: [RUN],
  future: [RUN],
  spokeRuns: [RUN],
  nowAzDeg: 123,
  nowAltDeg: 10,
  ...o,
});
const OPTS: RadarCanvasOpts = { cx: 0, cy: 0, rotRad: 0, rBase: 100, mobile: false, dpr: 2, targetRayPx: 999, pastInk: "#PAST" };
const draw = (opts: Partial<RadarCanvasOpts>, bodies: RadarCanvasBody[]) => {
  const ctx = recorder();
  drawRadarCanvas(ctx, { ...OPTS, ...opts }, bodies);
  return ctx.ops;
};
const widths = (ops: Op[]) => ops.filter((o) => o.op === "lineWidth").map((o) => o.args[0] as number);
const alphas = (ops: Op[]) => ops.filter((o) => o.op === "globalAlpha").map((o) => o.args[0] as number);
const has = (xs: number[], v: number) => xs.some((x) => Math.abs(x - v) < 1e-9);

describe("1. the stroke profile", () => {
  it("desktop is the identity — the ink is byte-identical to before", () => {
    expect(radarStroke(false)).toEqual({ widthK: 1, lineAlphaK: 1, rimAlphaK: 1, fillAlphaK: 1 });
  });
  it("/m is the tuning profile: thicker, every alpha lifted, none past 1", () => {
    const m = AIMCONES.mobileStroke;
    expect(radarStroke(true)).toBe(m);
    expect(m.widthK).toBeGreaterThan(1);
    expect(m.widthK).toBeLessThanOrEqual(2); // thicker, not fat — the 2026-08-18 "bulky" lesson
    for (const k of [m.lineAlphaK, m.rimAlphaK, m.fillAlphaK]) expect(k).toBeGreaterThanOrEqual(1);
    expect(AIMCONES.lineAlpha * m.lineAlphaK).toBeLessThanOrEqual(1);
    expect(AIMCONES.rimAlpha * m.rimAlphaK).toBeLessThanOrEqual(1);
    expect(AIMCONES.fillAlpha * 2 * m.fillAlphaK).toBeLessThan(0.5); // the mini-map's doubled wash stays glassy
    expect(AIMCONES.lineAlphaDown * m.lineAlphaK).toBeLessThan(AIMCONES.lineAlpha); // a set body still pales
  });
  it("the GL rim/spoke quad is thinner than the direction line, and the horizon cap is far", () => {
    expect(AIMCONES.rimHalfWidthK).toBeGreaterThan(0);
    expect(AIMCONES.rimHalfWidthK).toBeLessThanOrEqual(AIMCONES.lineHalfWidthK);
    expect(AIMCONES.rayReachMaxM).toBeGreaterThan(AIMCONES.radiusMaxM * AIMCONES.rayLenK);
    expect(AIMCONES.strokePx).toBe(1);
  });
});

describe("2. the canvas painter — screen CSS px × the store ratio", () => {
  it("desktop: every stroke is strokePx × dpr, the alphas are the tuning values", () => {
    const ops = draw({ dpr: 2 }, [body()]);
    const w = widths(ops);
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((x) => x === AIMCONES.strokePx * 2)).toBe(true);
    const a = alphas(ops);
    expect(has(a, AIMCONES.rimAlpha)).toBe(true);
    expect(has(a, AIMCONES.lineAlpha)).toBe(true);
    expect(has(a, AIMCONES.fillAlphaRest)).toBe(true);
  });
  it("/m at DPR 3: every stroke carries widthK, the rim / line / fill alphas their lifts", () => {
    const m = AIMCONES.mobileStroke;
    const ops = draw({ dpr: 3, mobile: true }, [body()]);
    const w = widths(ops);
    expect(w.length).toBeGreaterThan(0);
    for (const x of w) expect(x).toBeCloseTo(AIMCONES.strokePx * m.widthK * 3, 9);
    const a = alphas(ops);
    expect(has(a, AIMCONES.rimAlpha * m.rimAlphaK)).toBe(true);
    expect(has(a, AIMCONES.lineAlpha * m.lineAlphaK)).toBe(true);
    expect(has(a, AIMCONES.fillAlphaRest * m.fillAlphaK)).toBe(true);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
  });
  it("the mini-map's doubled wash and the /m lift compose on the emphasized band", () => {
    const m = AIMCONES.mobileStroke;
    const a = alphas(draw({ dpr: 3, mobile: true, fillAlphaK: 2 }, [body({ emphasized: true })]));
    expect(has(a, AIMCONES.fillAlpha * 2 * m.fillAlphaK)).toBe(true);
  });
  it("a body below the horizon pales on /m too (the lifted down-alpha, not the up one)", () => {
    const m = AIMCONES.mobileStroke;
    const a = alphas(draw({ dpr: 3, mobile: true }, [body({ nowAltDeg: -3 })]));
    expect(has(a, AIMCONES.lineAlphaDown * m.lineAlphaK)).toBe(true);
    expect(has(a, AIMCONES.lineAlpha * m.lineAlphaK)).toBe(false);
  });
});

describe("3. the chart's target ray covers the canvas from ANY anchor", () => {
  it("a centred anchor: exactly one diagonal (the batch-#4 reach, unchanged)", () => {
    expect(chartRayReachPx(800, 600, 400, 300)).toBeCloseTo(1000, 9);
  });
  it("an anchor panned three widths off the left edge still reaches every corner", () => {
    const ax = -2400;
    const ay = 300;
    const reach = chartRayReachPx(800, 600, ax, ay);
    for (const [cx, cy] of [[0, 0], [800, 0], [800, 600], [0, 600]]) {
      expect(reach).toBeGreaterThanOrEqual(Math.hypot(cx - ax, cy - ay));
    }
  });
  it("an anchor off a corner: the far corner is inside the reach", () => {
    const reach = chartRayReachPx(402, 874, -500, -900);
    expect(reach).toBeGreaterThanOrEqual(Math.hypot(402 + 500, 874 + 900));
  });
});

describe("4. groundReachK — the GL ray runs past what the viewport's corners can see", () => {
  const cap = 1000;
  it("nadir over the anchor: four symmetric hits → the half-diagonal of the visible ground", () => {
    // camera 10 units up, corner rays sloping 1:1 in x and 0.5:1 in y
    const cam = { x: 0, y: 0, z: 10 };
    const dirs = [
      { x: 1, y: 0.5, z: -1 },
      { x: -1, y: 0.5, z: -1 },
      { x: 1, y: -0.5, z: -1 },
      { x: -1, y: -0.5, z: -1 },
    ];
    expect(groundReachK(cam, dirs, cap)).toBeCloseTo(Math.hypot(10, 5), 9);
  });
  it("a panned view: the anchor off-centre, the far corner decides", () => {
    const cam = { x: 30, y: 0, z: 10 }; // the camera sits 30 units east of the anchor
    const dirs = [
      { x: 1, y: 0.5, z: -1 },
      { x: -1, y: 0.5, z: -1 },
      { x: 1, y: -0.5, z: -1 },
      { x: -1, y: -0.5, z: -1 },
    ];
    expect(groundReachK(cam, dirs, cap)).toBeCloseTo(Math.hypot(40, 5), 9);
  });
  it("a tilted map: a corner that looks ABOVE the plane means 'to the horizon' → the cap", () => {
    const cam = { x: 0, y: 0, z: 10 };
    const dirs = [
      { x: 0, y: 1, z: 0.1 }, // the top corners look up past the horizon
      { x: 0, y: 1, z: 0.1 },
      { x: 0.5, y: -1, z: -1 },
      { x: -0.5, y: -1, z: -1 },
    ];
    expect(groundReachK(cam, dirs, cap)).toBe(cap);
  });
  it("a ray parallel to the plane (dz = 0) caps instead of dividing by zero", () => {
    const cam = { x: 0, y: 0, z: 10 };
    expect(groundReachK(cam, [{ x: 1, y: 0, z: 0 }], cap)).toBe(cap);
    expect(Number.isFinite(groundReachK(cam, [{ x: 1, y: 0, z: 0 }], cap))).toBe(true);
  });
  it("a hit beyond the cap is capped (a near-grazing corner can land thousands of km out)", () => {
    const cam = { x: 0, y: 0, z: 10 };
    expect(groundReachK(cam, [{ x: 1, y: 0, z: -0.001 }], cap)).toBe(cap);
  });
  it("a camera below the plane sees it from underneath — a hit is still a hit", () => {
    const cam = { x: 0, y: 0, z: -10 };
    expect(groundReachK(cam, [{ x: 2, y: 0, z: 1 }], cap)).toBeCloseTo(20, 9);
  });
});

describe("the source fences", () => {
  it("the mini-map sizes its store to the glass (no min(DPR, 2) cap, the client width in)", () => {
    const src = code(SRC("src/components/panels/MiniMap.tsx"));
    const drawFn = src.slice(src.indexOf("function draw("), src.indexOf("export default function MiniMap"));
    expect(drawFn).not.toMatch(/Math\.min\(window\.devicePixelRatio/);
    expect(drawFn).toMatch(/canvas\.clientWidth/);
    expect(drawFn).toMatch(/radarStroke\(mobileShell\)/);
    expect(drawFn).toMatch(/targetRayPx: px,/);
  });
  it("the chart hands the painter the anchor-offset reach and promotes along it", () => {
    const src = code(SRC("src/components/panels/MapWindow.tsx"));
    expect(src).toMatch(/targetRayPx: chartRayReachPx\(w, h, ax, ay\)/);
    expect(src).toMatch(/chartRayReachPx\(w, h, w \/ 2 \+ adx, h \/ 2 \+ ady\)/);
    expect(src).not.toMatch(/targetRayPx: Math\.hypot/);
  });
  it("the GL fan draws no LineSegments any more — rim and spokes are quads under the stroke profile", () => {
    const src = code(SRC("src/components/globe/scene/aimCones.ts"));
    expect(src).not.toMatch(/new THREE\.LineSegments/);
    expect(src).toMatch(/AIMCONES\.rimHalfWidthK \* radarStroke\(mobileNow\)\.widthK/);
    expect(src).toMatch(/b\.line\.scale\.x = stroke\.widthK/);
    expect(src).toMatch(/b\.line\.scale\.y = b\.key === "target" \? rayK/);
    expect(src).toMatch(/viewReachK\(camera, group\.matrix, AIMCONES\.rayReachMaxM \/ radius\)/);
  });
  it("the orchestrator hands the fan the camera; the focal cone's rays wear the profile too", () => {
    const orch = code(SRC("src/components/globe/StylizedTiles.ts"));
    const call = orch.slice(orch.indexOf("aimCones.update({"), orch.indexOf("focalCone.update({"));
    expect(call).toMatch(/\bcamera,/);
    const cone = code(SRC("src/components/globe/scene/focalCone.ts"));
    expect(cone).toMatch(/FOCALCONE\.edgeHalfWidthK \* radarStroke\(mobile\)\.widthK/);
    expect(cone).toMatch(/mobile !== builtMobile/);
  });
});
