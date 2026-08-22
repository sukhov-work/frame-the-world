import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AIMCONES } from "../../src/components/globe/tuning";
import {
  drawRadarCanvas,
  type RadarCanvasBody,
  type RadarCanvasOpts,
} from "../../src/components/panels/radarCanvas";
import type { AimSample } from "../../src/lib/ephemeris/azSector";
import { bandFor, bandFutureInk } from "../../src/lib/geo/radarBands";

/**
 * AUDIT #3 A1-8 → T35 — the canvas radar painter, extracted 2026-08-22 from ≈95 hand-maintained
 * duplicated lines across `panels/MapWindow` and `panels/MiniMap`.
 *
 * The two surfaces are pixel-critical twins of the GL fan, and the extraction must be a pure
 * de-duplication. Rather than compare against a transcription of the old code (the C8
 * anti-pattern this same audit called out), these pin the CONTRACT the drawing must satisfy —
 * geometry, radii, alphas and op ORDER — by recording the 2D context calls.
 *
 * Mutation that makes them RED: swap `cos`/`sin` or drop `rotRad` in `pt`, use `rIn` where
 * `rOut` belongs, apply `fillAlphaK` to the rim/line alphas, draw spokes for a circumpolar
 * body, or reorder fill-before-rim.
 */

type Op = { op: string; args: unknown[] };

/** Minimal recording 2D context — every method + property the painter touches. */
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
      push("fillStyle", v);
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
      push("strokeStyle", v);
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
/** Two runs so the fill/arc loops actually iterate more than once. */
const RUN_A = [sample(10, 5), sample(40, 20), sample(70, 5)];
const RUN_B = [sample(200, 3), sample(250, 30)];

const body = (o: Partial<RadarCanvasBody> = {}): RadarCanvasBody => ({
  key: "sun",
  color: "#ffd9a0",
  emphasized: false,
  past: [RUN_A],
  future: [RUN_B],
  spokeRuns: [RUN_A],
  nowAzDeg: 123,
  nowAltDeg: 10,
  ...o,
});

const OPTS: RadarCanvasOpts = {
  cx: 0,
  cy: 0,
  rotRad: 0,
  rBase: 100,
  mobile: false,
  dpr: 2,
  targetRayPx: 999,
  pastInk: "#PAST",
};

const draw = (opts: Partial<RadarCanvasOpts>, bodies: RadarCanvasBody[]) => {
  const ctx = recorder();
  drawRadarCanvas(ctx, { ...OPTS, ...opts }, bodies);
  return ctx.ops;
};

/** Where a compass azimuth at radius r must land for a given centre + twist. */
const at = (azDeg: number, r: number, cx = 0, cy = 0, rot = 0): [number, number] => {
  const th = ((azDeg - 90) * Math.PI) / 180 + rot;
  return [cx + r * Math.cos(th), cy + r * Math.sin(th)];
};
const near = (got: unknown[], want: [number, number]) => {
  expect(got[0] as number).toBeCloseTo(want[0], 9);
  expect(got[1] as number).toBeCloseTo(want[1], 9);
};

describe("drawRadarCanvas — geometry (T35)", () => {
  it("north-up, centred: azimuth 0 at the band's OUTER radius is straight up", () => {
    const ops = draw({}, [body({ past: [[sample(0, 5), sample(0, 5)]], future: [], spokeRuns: [] })]);
    const rOut = 100 * bandFor("sun")[1];
    const first = ops.find((o) => o.op === "moveTo")!;
    near(first.args, [0, -rOut]);
  });

  it("the twist rotates every point, and the centre offsets it (the chart's parameters)", () => {
    const rot = 0.7;
    const ops = draw({ cx: 320, cy: 240, rotRad: rot }, [
      body({ past: [[sample(0, 5), sample(0, 5)]], future: [], spokeRuns: [] }),
    ]);
    const rOut = 100 * bandFor("sun")[1];
    near(ops.find((o) => o.op === "moveTo")!.args, at(0, rOut, 320, 240, rot));
  });

  it("/m pulls the bands inward — the same body draws at a smaller radius", () => {
    const one = [body({ past: [[sample(0, 5), sample(0, 5)]], future: [], spokeRuns: [] })];
    const rD = draw({ mobile: false }, one).find((o) => o.op === "moveTo")!.args[1] as number;
    const rM = draw({ mobile: true }, one).find((o) => o.op === "moveTo")!.args[1] as number;
    expect(Math.abs(rM)).toBeLessThan(Math.abs(rD));
    expect(Math.abs(rM)).toBeCloseTo(100 * bandFor("sun", true)[1], 9);
  });

  it("the annular fill closes each run: outer forward, then inner REVERSED", () => {
    const ops = draw({}, [body({ future: [], spokeRuns: [] })]);
    const [rIn, rOut] = bandFor("sun").map((k) => k * 100);
    // Just the FIRST fill path (the past band) — beginPath … fill.
    const path = ops.slice(
      ops.findIndex((o) => o.op === "beginPath"),
      ops.findIndex((o) => o.op === "fill"),
    );
    const pts = path.filter((o) => o.op === "moveTo" || o.op === "lineTo");
    // 3 outer + 3 inner for RUN_A, then the closePath.
    expect(pts).toHaveLength(6);
    near(pts[0].args, at(RUN_A[0].azDeg, rOut));
    near(pts[2].args, at(RUN_A[2].azDeg, rOut));
    near(pts[3].args, at(RUN_A[2].azDeg, rIn)); // reversal starts at the LAST sample
    near(pts[5].args, at(RUN_A[0].azDeg, rIn));
    expect(path.some((o) => o.op === "closePath")).toBe(true);
  });

  it("the rim arc is an ARC ONLY — no radial legs, no close", () => {
    const ops = draw({}, [body({ future: [], spokeRuns: [] })]);
    // The rim path is the one that follows the rimAlpha write.
    const i = ops.findIndex((o) => o.op === "globalAlpha" && o.args[0] === AIMCONES.rimAlpha);
    const rim = ops.slice(i, ops.findIndex((o, j) => j > i && o.op === "stroke") + 1);
    expect(rim.filter((o) => o.op === "closePath")).toHaveLength(0);
    expect(rim.filter((o) => o.op === "moveTo")).toHaveLength(1); // one run ⇒ one subpath
    const rOut = 100 * bandFor("sun")[1];
    near(rim.find((o) => o.op === "moveTo")!.args, at(RUN_A[0].azDeg, rOut));
  });

  it("spokes span inner→outer at each run's ENDPOINTS, and vanish for a ring", () => {
    const withSpokes = draw({}, [body({ past: [], future: [] })]);
    const [rIn, rOut] = bandFor("sun").map((k) => k * 100);
    const spokes = withSpokes.filter((o) => o.op === "moveTo" || o.op === "lineTo");
    // 2 endpoints × (moveTo + lineTo) for the spokes, + the direction line's own pair.
    expect(spokes).toHaveLength(6);
    near(spokes[0].args, at(RUN_A[0].azDeg, rIn));
    near(spokes[1].args, at(RUN_A[0].azDeg, rOut));
    near(spokes[2].args, at(RUN_A[2].azDeg, rIn));
    near(spokes[3].args, at(RUN_A[2].azDeg, rOut));
    const ring = draw({}, [body({ past: [], future: [], spokeRuns: [] })]);
    expect(ring.filter((o) => o.op === "moveTo" || o.op === "lineTo")).toHaveLength(2); // line only
  });

  it("the TARGET line runs to targetRayPx; sun/moon dials cap at their own band", () => {
    const t = draw({ targetRayPx: 999 }, [body({ key: "target", past: [], future: [], spokeRuns: [] })]);
    near(t.filter((o) => o.op === "lineTo").at(-1)!.args, at(123, 999));
    for (const key of ["sun", "moon"] as const) {
      const ops = draw({ targetRayPx: 999 }, [body({ key, past: [], future: [], spokeRuns: [] })]);
      near(ops.filter((o) => o.op === "lineTo").at(-1)!.args, at(123, 100 * bandFor(key)[1]));
    }
  });
});

describe("drawRadarCanvas — ink and alpha (T35)", () => {
  it("past wears the caller's inert grey, future the SHARED per-body ink", () => {
    for (const key of ["target", "sun", "moon"] as const) {
      const ops = draw({}, [body({ key })]);
      const fills = ops.filter((o) => o.op === "fillStyle").map((o) => o.args[0]);
      const strokes = ops.filter((o) => o.op === "strokeStyle").map((o) => o.args[0]);
      expect(fills).toEqual(["#PAST", bandFutureInk(key)]);
      expect(strokes.slice(0, 2)).toEqual(["#PAST", bandFutureInk(key)]);
    }
  });

  it("fillAlphaK scales the FILL wash only — never the rim or the direction line", () => {
    const plain = draw({}, [body()]);
    const dense = draw({ fillAlphaK: 2 }, [body()]);
    const alphas = (ops: Op[]) => ops.filter((o) => o.op === "globalAlpha").map((o) => o.args[0]);
    expect(alphas(plain)[0]).toBe(AIMCONES.fillAlphaRest);
    expect(alphas(dense)[0]).toBe(AIMCONES.fillAlphaRest * 2);
    // Every LATER alpha is identical between the two — the multiplier touched only the wash.
    expect(alphas(dense).slice(1)).toEqual(alphas(plain).slice(1));
  });

  it("emphasis breathes the wash from fillAlphaRest up to fillAlpha", () => {
    const rest = draw({}, [body({ emphasized: false })]);
    const emph = draw({}, [body({ emphasized: true })]);
    expect(rest.find((o) => o.op === "globalAlpha")!.args[0]).toBe(AIMCONES.fillAlphaRest);
    expect(emph.find((o) => o.op === "globalAlpha")!.args[0]).toBe(AIMCONES.fillAlpha);
    expect(AIMCONES.fillAlphaRest).toBeGreaterThan(0); // never rests at zero (batch #5 item 1)
  });

  it("a below-horizon body pales its direction line, and alpha is restored to 1", () => {
    const up = draw({}, [body({ nowAltDeg: 10 })]);
    const down = draw({}, [body({ nowAltDeg: -3 })]);
    const lastAlphaBeforeReset = (ops: Op[]) =>
      ops.filter((o) => o.op === "globalAlpha").at(-2)!.args[0];
    expect(lastAlphaBeforeReset(up)).toBe(AIMCONES.lineAlpha);
    expect(lastAlphaBeforeReset(down)).toBe(AIMCONES.lineAlphaDown);
    expect(AIMCONES.lineAlphaDown).toBeLessThan(AIMCONES.lineAlpha);
    for (const ops of [up, down])
      expect(ops.filter((o) => o.op === "globalAlpha").at(-1)!.args[0]).toBe(1);
  });

  it("line width is authored in CSS px and scaled by DPR", () => {
    expect(draw({ dpr: 3 }, [body()]).find((o) => o.op === "lineWidth")!.args[0]).toBe(3);
  });

  it("draws fills BEFORE rims before spokes before the direction line, per body", () => {
    const ops = draw({}, [body()]).map((o) => o.op);
    expect(ops.indexOf("fill")).toBeLessThan(ops.indexOf("stroke"));
    expect(ops.filter((o) => o === "fill")).toHaveLength(2); // past + future
    expect(ops.filter((o) => o === "stroke")).toHaveLength(4); // 2 rims + spokes + line
  });

  it("paints every body given, in order", () => {
    const ops = draw({}, [body({ key: "moon" }), body({ key: "sun" })]);
    const fills = ops.filter((o) => o.op === "fillStyle").map((o) => o.args[0]);
    expect(fills).toEqual(["#PAST", bandFutureInk("moon"), "#PAST", bandFutureInk("sun")]);
  });

  it("an empty body list paints nothing at all", () => {
    expect(draw({}, [])).toEqual([]);
  });
});

describe("neither canvas surface keeps a private radar painter", () => {
  const root = join(__dirname, "..", "..");
  it("both import drawRadarCanvas and neither re-declares sectorPath/arcPath", () => {
    for (const file of ["MapWindow.tsx", "MiniMap.tsx"]) {
      const src = readFileSync(join(root, "src", "components", "panels", file), "utf8");
      expect({ file, uses: /drawRadarCanvas\(/.test(src) }).toEqual({ file, uses: true });
      expect({ file, sector: /const sectorPath\s*=/.test(src) }).toEqual({ file, sector: false });
      expect({ file, arc: /const arcPath\s*=/.test(src) }).toEqual({ file, arc: false });
    }
    // POSITIVE CONTROL: those declarations exist — in the ONE painter.
    const painter = readFileSync(join(root, "src/components/panels/radarCanvas.ts"), "utf8");
    expect(/const sectorPath\s*=/.test(painter)).toBe(true);
    expect(/const arcPath\s*=/.test(painter)).toBe(true);
  });
});
