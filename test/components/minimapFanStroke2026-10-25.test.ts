import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AIMCONES, FOCALCONE } from "../../src/components/globe/tuning";
import { fanStrokeCssPx, radarStroke } from "../../src/lib/geo/radarBands";
import { drawRadarCanvas, type RadarCanvasBody, type RadarCanvasOpts } from "../../src/components/panels/radarCanvas";
import type { AimSample } from "../../src/lib/ephemeris/azSector";

/**
 * THE MINI-MAP WEARS THE MAIN MAP'S STROKES (owner 2026-10-25, iPhone 17 Pro): "radar lines (the radar
 * itself, the focus cone, the direction lines for the tracked object) have different thickness on the
 * main map and the FPV mini-map. I like the increased thickness from the main map — make it exactly the
 * same in the mini-map."
 *
 * Measured on the twins' glass before the fix: the GL fan's direction line 2.7–3.4 CSS px and its cone
 * legs 4.2 against the mini-map's 1.4–1.7 and 2.1 (the fan's quads are RADIUS fractions, the canvas drew
 * 1 CSS px × widthK). Three rules, pinned here:
 *   1. `fanStrokeCssPx` is the fan's own geometry — `lineHalfWidthK` / `rimHalfWidthK` / the cone's
 *      `edgeHalfWidthK` over its ray-extended reach, × the shell's `widthK` — at the chart's
 *      fraction-of-height radius (`mapRadiusHK` × `mobileRadiusK` on /m) for the viewport;
 *   2. the painter takes per-kind weights (`strokeCssPx`): rim arcs + spokes at `rim`, direction lines
 *      at `line`; ABSENT, every stroke is `strokePx × widthK` — the chart and the desktop mini-map are
 *      byte-identical to before;
 *   3. the /m mini-map hands the painter the fan's weights for `window.innerHeight` and draws its cone
 *      legs at the fan's `cone`; desktop (null) keeps the 1 CSS px line + the 1.5× legs;
 *   4. the /m fullscreen chart does the same for ITS canvas height (owner 2026-10-25b: "consistently thick
 *      and stylised, as the main map, across all mobile surfaces" — T199 built the same day), its cone legs
 *      under the shell's ink lift; the desktop chart passes nothing.
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
const OPTS: RadarCanvasOpts = { cx: 0, cy: 0, rotRad: 0, rBase: 100, mobile: true, dpr: 3, targetRayPx: 999, pastInk: "#PAST" };
const draw = (opts: Partial<RadarCanvasOpts>, bodies: RadarCanvasBody[]) => {
  const ctx = recorder();
  drawRadarCanvas(ctx, { ...OPTS, ...opts }, bodies);
  return ctx.ops;
};
const widths = (ops: Op[]) => ops.filter((o) => o.op === "lineWidth").map((o) => o.args[0] as number);

describe("1. fanStrokeCssPx — the GL fan's geometry at the chart's fraction-of-height radius", () => {
  it("/m on the iPhone twin (874 px tall): the fan's own quads in CSS px — ≈2.9 line · ≈1.5 rim · ≈3.7 cone", () => {
    const f = fanStrokeCssPx(874, true);
    const r = 874 * AIMCONES.mapRadiusHK * AIMCONES.mobileRadiusK;
    const k = AIMCONES.mobileStroke.widthK;
    expect(f.line).toBeCloseTo(2 * AIMCONES.lineHalfWidthK * k * r, 12);
    expect(f.rim).toBeCloseTo(2 * AIMCONES.rimHalfWidthK * k * r, 12);
    expect(f.cone).toBeCloseTo(2 * FOCALCONE.edgeHalfWidthK * AIMCONES.rayLenK * k * r, 12);
    // The measured band on glass (2.7–3.4 for the ray, 4.1–4.2 for the legs, threshold AA included).
    expect(f.line).toBeGreaterThan(2.5);
    expect(f.line).toBeLessThan(3.5);
    expect(f.cone).toBeGreaterThan(3.3);
    expect(f.cone).toBeLessThan(4.2);
    // Twice the 2026-10-10 weight — the owner's "increased thickness".
    expect(f.line).toBeGreaterThan(1.8 * AIMCONES.strokePx * k);
  });
  it("the fan's ratios ride along: the rim is half the line, the cone legs 1.25× it (the GL rules)", () => {
    const f = fanStrokeCssPx(892, true);
    expect(f.rim / f.line).toBeCloseTo(AIMCONES.rimHalfWidthK / AIMCONES.lineHalfWidthK, 12);
    expect(f.cone / f.line).toBeCloseTo((FOCALCONE.edgeHalfWidthK * AIMCONES.rayLenK) / AIMCONES.lineHalfWidthK, 12);
    expect(f.rim / f.line).toBeCloseTo(0.5, 9);
    expect(f.cone / f.line).toBeCloseTo(1.25, 9);
  });
  it("scales with the viewport height (a collapsed Safari toolbar resizes the fan — and this), never below ~2 CSS px on a phone", () => {
    const tall = fanStrokeCssPx(874, true);
    const short = fanStrokeCssPx(714, true);
    expect(short.line / tall.line).toBeCloseTo(714 / 874, 12);
    expect(short.line).toBeGreaterThan(2);
  });
  it("desktop is the fan's desktop geometry (widthK 1, the full radius) — consumers must not call it there", () => {
    const d = fanStrokeCssPx(1000, false);
    expect(radarStroke(false).widthK).toBe(1);
    expect(d.line).toBeCloseTo(2 * AIMCONES.lineHalfWidthK * 1000 * AIMCONES.mapRadiusHK, 12);
  });
});

describe("2. the painter — per-kind weights when handed, one weight otherwise", () => {
  it("absent: every stroke is strokePx × widthK × dpr (the 2026-10-10 behaviour, byte-identical)", () => {
    const w = widths(draw({}, [body()]));
    expect(w.length).toBeGreaterThan(0);
    for (const x of w) expect(x).toBeCloseTo(AIMCONES.strokePx * AIMCONES.mobileStroke.widthK * 3, 9);
  });
  it("handed { line 3, rim 1.5 } at dpr 3: the rim arcs + spokes at 4.5 store px, the direction line at 9", () => {
    const ops = draw({ strokeCssPx: { line: 3, rim: 1.5 } }, [body()]);
    const w = widths(ops);
    expect(new Set(w.map((x) => +x.toFixed(6)))).toEqual(new Set([4.5, 9]));
    // The direction line is the LAST stroke of a body — its width is the line weight.
    const lastWidth = [...ops].reverse().find((o) => o.op === "lineWidth")!.args[0];
    expect(lastWidth).toBe(9);
    // The rim weight is set BEFORE the rim arcs and carries through the spokes: between the first
    // lineWidth and the line's lineWidth there are exactly three strokes (past rim, future rim, spokes).
    const i0 = ops.findIndex((o) => o.op === "lineWidth");
    const i1 = ops.findIndex((o, i) => i > i0 && o.op === "lineWidth");
    expect(ops.slice(i0, i1).filter((o) => o.op === "stroke").length).toBe(3);
    expect(ops[i0].args[0]).toBe(4.5);
  });
  it("the target body's ray reaches targetRayPx under the line weight (nothing else changed)", () => {
    const ops = draw({ strokeCssPx: { line: 3, rim: 1.5 }, targetRayPx: 777 }, [body({ key: "target", nowAzDeg: 90 })]);
    const lineTos = ops.filter((o) => o.op === "lineTo");
    const last = lineTos[lineTos.length - 1].args as number[];
    expect(Math.hypot(last[0], last[1])).toBeCloseTo(777, 6);
  });
});

describe("3. the source fences", () => {
  it("the /m mini-map hands the painter the fan's weights for the viewport; the cone legs read fan.cone; desktop keeps 1.5×", () => {
    const src = code(SRC("src/components/panels/MiniMap.tsx"));
    const drawFn = src.slice(src.indexOf("function draw("), src.indexOf("export default function MiniMap"));
    expect(drawFn).toMatch(/const fan = mobileShell \? fanStrokeCssPx\(window\.innerHeight, true\) : null;/);
    expect(drawFn).toMatch(/strokeCssPx: fan \? \{ line: fan\.line, rim: fan\.rim \} : undefined,/);
    expect(drawFn).toMatch(/ctx\.lineWidth = \(fan \? fan\.cone : 1\.5 \* AIMCONES\.strokePx \* stroke\.widthK\) \* dpr;/);
    // The radar + the cone legs end SQUARE like the GL quads and the chart (the roads' round caps stay on the roads).
    const roads = drawFn.indexOf('ctx.lineCap = "round"');
    const radar = drawFn.indexOf('ctx.lineCap = "butt";\n  ctx.lineJoin = "miter";');
    expect(roads).toBeGreaterThan(0);
    expect(radar).toBeGreaterThan(roads);
    expect(radar).toBeLessThan(drawFn.indexOf("drawRadarCanv" + "as("));
    // The 2026-10-10 fences hold: the store is the glass, the /m alpha profile rides.
    expect(drawFn).not.toMatch(/Math\.min\(window\.devicePixelRatio/);
    expect(drawFn).toMatch(/radarStroke\(mobileShell\)/);
    expect(drawFn).toMatch(/targetRayPx: px,/);
  });
  it("the painter resolves rim and line separately, each defaulting to the one 2026-10-10 weight", () => {
    const src = code(SRC("src/components/panels/radarCanvas.ts"));
    expect(src).toMatch(/const baseW = AIMCONES\.strokePx \* ink\.widthK;/);
    expect(src).toMatch(/const rimW = \(o\.strokeCssPx\?\.rim \?\? baseW\) \* o\.dpr;/);
    expect(src).toMatch(/const lineW = \(o\.strokeCssPx\?\.line \?\? baseW\) \* o\.dpr;/);
    expect(src).toMatch(/strokeCssPx\?: \{ line: number; rim: number \};/);
  });
  it("the /m chart hands the painter the fan's weights for its canvas height; its cone legs read fan.cone under the ink lift; desktop passes nothing", () => {
    const src = code(SRC("src/components/panels/MapWindow.tsx"));
    expect(src).toMatch(/const fan = mobileShell \? fanStrokeCssPx\(h \/ dpr, true\) : null;/);
    expect(src).toMatch(/strokeCssPx: fan \? \{ line: fan\.line, rim: fan\.rim \} : undefined,/);
    expect(src).toMatch(/ctx\.globalAlpha = Math\.min\(1, FOCALCONE\.edgeAlpha \* radarStroke\(mobileShell\)\.lineAlphaK\);\s*ctx\.lineWidth = \(fan \? fan\.cone : 1\.5\) \* dpr;/);
    // The chart's radius rule and the fan mirror agree by construction: rBase = h × mapRadiusHK × mobileRadiusK.
    expect(src).toMatch(/const rBase = h \* AIMCONES\.mapRadiusHK \* \(mobileShell \? AIMCONES\.mobileRadiusK : 1\);/);
    const f = fanStrokeCssPx(874, true);
    expect(2 * AIMCONES.lineHalfWidthK * AIMCONES.mobileStroke.widthK * (874 * AIMCONES.mapRadiusHK * AIMCONES.mobileRadiusK)).toBeCloseTo(f.line, 12);
  });
  it("fanStrokeCssPx is pure geometry from the shared tunables — no window, no store", () => {
    const src = code(SRC("src/lib/geo/radarBands.ts"));
    const start = src.indexOf("export function fanStrokeCssPx");
    const fn = src.slice(start, src.indexOf("\n}\n", start) + 3);
    expect(fn).toMatch(/AIMCONES\.mapRadiusHK/);
    expect(fn).toMatch(/AIMCONES\.mobileRadiusK/);
    expect(fn).toMatch(/AIMCONES\.lineHalfWidthK/);
    expect(fn).toMatch(/AIMCONES\.rimHalfWidthK/);
    expect(fn).toMatch(/FOCALCONE\.edgeHalfWidthK \* AIMCONES\.rayLenK/);
    expect(src).not.toMatch(/window\./);
    expect(src).not.toMatch(/store\//);
  });
});
