import { beforeEach, describe, expect, it } from "vitest";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BestSpotPanel, {
  bestSpotStatusLines,
  countPatchLeaves,
  heatCssForScore,
  provenanceLine,
  scoringLine,
  shortlistReady,
  SpotRow,
} from "../../src/components/panels/BestSpotPanel";
import PlanFindToggle, { pickPlanFindSeg } from "../../src/components/panels/PlanFindToggle";
import InstrumentSlider, {
  sliderKeyNorm,
  sliderNorm,
  sliderValue,
} from "../../src/components/controls/InstrumentSlider";
import { useBestSpotStore, type BestSpotSpot, type BestSpotState } from "../../src/store/bestSpot";
import { useCameraStore } from "../../src/store/camera";
import { useFindStore } from "../../src/store/find";
import { usePlanStore } from "../../src/store/plan";
import { BESTSPOT } from "../../src/components/globe/tuning";
import { heatRampById } from "../../src/lib/theme/heatPalette";
import { read, stripComments } from "../styles/_css";

/**
 * BEST SPOT panel + shared controls (S5, `SPEC_V2 §6.9`).
 *
 * HOW THIS RENDERS WITHOUT A DOM. This repo runs vitest in the NODE environment — no jsdom, no
 * happy-dom, no `@testing-library/react` (checked: none is a dependency, and no test in `test/`
 * mounts React). So the two techniques here are:
 *
 *  1. `renderToStaticMarkup` for anything about WHAT IS ON SCREEN. zustand v5 serves
 *     `getInitialState()` as the SERVER snapshot, so a server render would otherwise show boot
 *     values forever — `render()` below mirrors the live state onto the initial object first. The
 *     store is still driven through its real setters; the mirror only lets the render read them.
 *  2. Calling the HOOK-FREE leaves (`SpotRow`, `InstrumentSlider`, `ChipRow`) as plain functions and
 *     walking the returned element tree to invoke handlers. That is why those two components have
 *     no hooks: a keyboard contract that can only be string-rendered is not tested at all.
 *
 * Mutations that make these RED: drop any status line, print the relative bar without the absolute
 * score, let ULTRA survive a radius growth, hard-code the R6 lift, ungrey the top-K before the
 * requested rung lands, or word the null-track line as a polar-latitude problem.
 */

// ── Harness ───────────────────────────────────────────────────────────────────────────────────

/** The store as it booted, so each test starts from the shipped defaults. */
const BOOT: BestSpotState = { ...useBestSpotStore.getState() };

function render(): string {
  // See the docblock: zustand v5's server snapshot is `getInitialState()`.
  Object.assign(useBestSpotStore.getInitialState(), useBestSpotStore.getState());
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  return renderToStaticMarkup(createElement(BestSpotPanel));
}

/** Every element in a hook-free component's returned tree, parents before children. */
function walk(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node);
  return walk((node.props as { children?: unknown }).children, out);
}

type Props = Record<string, unknown>;
const propsOf = (el: ReactElement): Props => el.props as Props;

function findEl(tree: unknown, pred: (p: Props) => boolean): ReactElement {
  const hit = walk(tree).find((el) => pred(propsOf(el)));
  expect(hit, "no element matched").toBeDefined();
  return hit!;
}

const spot = (over: Partial<BestSpotSpot> = {}): BestSpotSpot => ({
  key: "12:34",
  rank: 1,
  score: 0.89,
  latDeg: 48.4647,
  lonDeg: 35.0462,
  distM: 62,
  bearingDeg: 45,
  contact: "graze",
  note: "ON A BRIDGE (modelled height)",
  aerial: false,
  groundReachable: true,
  leadMs: 200_000,
  // R8 half one — the shortlist's ACCESSIBILITY is re-solved at 1 m on every solve, so a row's
  // own pitch is not the field's. The panel names the two separately (§8's ladder).
  gridCellM: 1,
  obstructionRefined: false,
  ...over,
});

/** The disc as the engine would publish it once the finest requested rung has landed. */
function solved(over: Partial<BestSpotState> = {}): void {
  useBestSpotStore.getState()._syncBestSpot({
    verdictCounts: { scored: 31_417, unknown: 11_310, blocked: 2_004, total: 44_731 },
    coverage: 0.71,
    unmappedFrac: 0.36,
    reachM: 700,
    ladderRung: BESTSPOT.ladderCellsM.length - 1,
    gridCellM: BESTSPOT.defaultCellM,
    // R8 half one landed with the finest rung: the SHORTLIST's accessibility is 1 m while the
    // FIELD's obstruction is still 3 m. §8's ladder is only honest if the panel says both.
    shortlistCellM: BESTSPOT.ultraCellM,
    heightProvenance: { enriched: 3, osm: 11 },
    topK: [spot(), spot({ key: "40:9", rank: 2, score: 0.6, distM: 1500, contact: "open", note: null })],
    ...over,
  });
}

beforeEach(() => {
  useBestSpotStore.setState(BOOT, true);
  useBestSpotStore.getState().setOpen(true);
  useCameraStore.getState().setTempPin({ latDeg: 48.4647, lonDeg: 35.0462 });
  usePlanStore.getState().setOpen(false);
  useFindStore.getState().setOpen(false);
});

// ── 1. The third planfind segment ─────────────────────────────────────────────────────────────

describe("PlanFindToggle — three mutually exclusive segments", () => {
  it("renders three segments, the third labelled BEST SPOT with its tip", () => {
    Object.assign(usePlanStore.getInitialState(), usePlanStore.getState());
    Object.assign(useFindStore.getInitialState(), useFindStore.getState());
    Object.assign(useBestSpotStore.getInitialState(), useBestSpotStore.getState());
    const html = renderToStaticMarkup(createElement(PlanFindToggle));
    expect(html.match(/pft-seg/g)?.length).toBe(3);
    expect(html).toContain("◎ BEST SPOT");
    expect(html).toContain("WHERE TO STAND FOR THIS SUNRISE / SUNSET / MOONRISE / MOONSET.");
  });

  it("picking any one segment closes the other two", () => {
    const open = () => ({
      plan: usePlanStore.getState().open,
      find: useFindStore.getState().open,
      bestSpot: useBestSpotStore.getState().open,
    });
    for (const seg of ["plan", "find", "bestSpot"] as const) {
      // The state a click has to resolve: the OTHER two open, this one closed.
      usePlanStore.getState().setOpen(seg !== "plan");
      useFindStore.getState().setOpen(seg !== "find");
      useBestSpotStore.getState().setOpen(seg !== "bestSpot");
      pickPlanFindSeg(seg);
      expect(open(), `${seg}: only ${seg} may stay open`).toEqual({
        plan: seg === "plan",
        find: seg === "find",
        bestSpot: seg === "bestSpot",
      });
      // …and a second pick on the same segment closes it rather than re-opening.
      pickPlanFindSeg(seg);
      expect(open()).toEqual({ plan: false, find: false, bestSpot: false });
    }
  });

  it("never leaves two windows on the same spot, whatever it started from", () => {
    for (const seg of ["plan", "find", "bestSpot"] as const) {
      usePlanStore.getState().setOpen(true);
      useFindStore.getState().setOpen(true);
      useBestSpotStore.getState().setOpen(true);
      pickPlanFindSeg(seg);
      const openCount = [
        usePlanStore.getState().open,
        useFindStore.getState().open,
        useBestSpotStore.getState().open,
      ].filter(Boolean).length;
      expect(openCount, `${seg}: at most one window may be open`).toBeLessThanOrEqual(1);
    }
  });
});

// ── 2. The mandatory status block ─────────────────────────────────────────────────────────────

describe("status lines — every number comes from the store", () => {
  it("renders every line of §8's ladder, and they MOVE when the store moves", () => {
    solved();
    const before = render();
    expect(before).toContain("36% UNMAPPED · COVERAGE 0.71");
    // §8, and the C2 clause of it: the FIELD's obstruction and the SHORTLIST's accessibility are
    // two different resolutions and the panel names them apart. An unqualified "1 m heatmap" is
    // a C2 violation.
    expect(before).toContain(
      `OBSTRUCTION AT ${BESTSPOT.defaultCellM} m · SHORTLIST ACCESSIBILITY AT ${BESTSPOT.ultraCellM} m`,
    );
    // D3 (2026-08-24 fix pass) — the posting line NEVER invents a number. With nothing measured the
    // panel says so; it used to fall back to `TERRAIN_POSTING_BAKED_M` (145, a measurement of the
    // DNIPRO bake) at every location on Earth, and the engine's own figure was itself the grid cell
    // size for every input, so the shipped copy read `OVER TERRAIN AT ~3 m` in a city whose real
    // posting is ~145 m. Both halves are pinned here, and both are the STORE's value.
    expect(before).toContain("TERRAIN POSTING NOT MEASURED YET");
    useBestSpotStore.getState()._syncBestSpot({ terrainPostingM: 145.4 });
    expect(render()).toContain("OVER TERRAIN POSTED AT ~145 m");
    useBestSpotStore.getState()._syncBestSpot({ terrainPostingM: 2011 });
    expect(render()).toContain("OVER TERRAIN POSTED AT ~2011 m");
    useBestSpotStore.getState()._syncBestSpot({ terrainPostingM: 0 });
    expect(before).toContain("A VERTICAL EDGE RESOLVES TO ~HALF A DISC");
    expect(before).toContain("LANDCOVER EDGES CARRY A ~1–2 CELL RIBBON");
    expect(before).toContain("EVIDENCE REACHES 700 m — BEYOND THAT, UNKNOWN");
    expect(before).toContain("SCORING: default");

    useBestSpotStore.getState()._syncBestSpot({ unmappedFrac: 0.04, coverage: 0.98, reachM: 1234 });
    const after = render();
    expect(after).toContain("4% UNMAPPED · COVERAGE 0.98");
    expect(after).toContain("EVIDENCE REACHES 1234 m — BEYOND THAT, UNKNOWN");
    expect(after).not.toContain("36% UNMAPPED");
  });

  it("the obstruction line follows the rung that LANDED, not the tier that was requested", () => {
    // S7 STRENGTHENED this: it used to read `cellM`, the REQUEST. Arming ULTRA does not make the
    // field 1 m — the 1 m rung has to land first — so quoting the request is a claim about a
    // resolution nobody has solved at yet, which is the exact class of defect this panel exists to
    // close. It reads `gridCellM`, the rung on screen.
    solved();
    useBestSpotStore.getState().setUltra(true);
    expect(useBestSpotStore.getState().cellM).toBe(BESTSPOT.ultraCellM); // the REQUEST moved…
    expect(bestSpotStatusLines(useBestSpotStore.getState())[1]).toBe(
      `OBSTRUCTION AT ${BESTSPOT.defaultCellM} m · SHORTLIST ACCESSIBILITY AT ${BESTSPOT.ultraCellM} m`,
    );
    // …and only when the 1 m rung actually lands does the line follow it.
    useBestSpotStore.getState()._syncBestSpot({ gridCellM: BESTSPOT.ultraCellM });
    expect(bestSpotStatusLines(useBestSpotStore.getState())[1]).toBe(
      `OBSTRUCTION AT ${BESTSPOT.ultraCellM} m · SHORTLIST ACCESSIBILITY AT ${BESTSPOT.ultraCellM} m`,
    );
  });

  it("S7 — the provenance badge is DRIVEN by what stands under the disc, never by a constant", () => {
    // §8: heights are metre-exact only where the enriched bake has real geometry; elsewhere they
    // are OSM-derived with ~78 % class defaults. And vegetation is fiction at the individual level
    // (151,046 of Dnipro's 161,823 canopies are seeded scatter), which is why the line says trees
    // are modelled AND why `BESTSPOT_SAFETY` clamps `graze.conf.tree` at 0.6.
    solved();
    expect(provenanceLine(useBestSpotStore.getState())).toBe(
      "BUILDING HEIGHTS: 3 SURVEYED + 11 OSM-DERIVED (~78% DEFAULTS) · TREES ARE MODELLED, NOT SURVEYED",
    );
    // Outside the two baked cities there is no enriched geometry at all — and the line must not
    // keep claiming surveyed heights.
    useBestSpotStore.getState()._syncBestSpot({ heightProvenance: { enriched: 0, osm: 7 } });
    expect(provenanceLine(useBestSpotStore.getState())).toBe(
      "BUILDING HEIGHTS: OSM-DERIVED ONLY (~78% CLASS DEFAULTS) · TREES ARE MODELLED, NOT SURVEYED",
    );
    // …and before a disc has been solved it says so rather than claiming anything.
    useBestSpotStore.getState()._syncBestSpot({ heightProvenance: { enriched: 0, osm: 0 } });
    expect(provenanceLine(useBestSpotStore.getState())).toBe("BUILDING HEIGHTS: NOT MEASURED YET");
  });

  it("S7 — the ⚠ RURAL line renders IFF the engine's built-density prior fired", () => {
    // The plan's "single most dangerous failure mode in the feature", made visible. S5 drafted this
    // line and deliberately left it UNRENDERED because no published threshold existed; S7 published
    // one (`BESTSPOT.builtDensityFloorPerKm2`) and the engine's verdict with it.
    solved();
    expect(render()).not.toContain("TERRAIN ONLY, NO SURVEYED BUILDINGS HERE");
    useBestSpotStore.getState()._syncBestSpot({ terrainOnly: true, builtDensityPerKm2: 0.05 });
    const html = render();
    expect(html).toContain("⚠ RURAL — TERRAIN ONLY, NO SURVEYED BUILDINGS HERE");
    // The claim is CHECKABLE on screen: the measured density AND the floor it fell under.
    expect(html).toContain(`0.05/km² UNDER A ${BESTSPOT.builtDensityFloorPerKm2}/km² FLOOR`);
  });

  it("SCORING: custom (N fields) appears IFF the patch is non-empty", () => {
    expect(scoringLine(useBestSpotStore.getState())).toBe("SCORING: default");
    useBestSpotStore.getState().setScoring({ weights: { p: 0.4, f: 0.15 } });
    const line = scoringLine(useBestSpotStore.getState());
    expect(line).toMatch(/^SCORING: custom \(2 fields\) · [0-9a-f]{8}/);
    expect(render()).toContain(line);
    // Clearing it goes back to "default" — a `{}` residue must not read as a tune.
    useBestSpotStore.getState().setScoring(null);
    expect(scoringLine(useBestSpotStore.getState())).toBe("SCORING: default");
  });

  it("counts LEAVES, not groups", () => {
    expect(countPatchLeaves(null)).toBe(0);
    expect(countPatchLeaves({})).toBe(0);
    expect(countPatchLeaves({ weights: { v: 1, l: 2 }, gates: { minCoverage: 0.6 } })).toBe(3);
  });

  it("announces a result that disagrees with the live profile", () => {
    useBestSpotStore.getState().setScoring({ weights: { p: 0.4 } });
    useBestSpotStore.getState()._syncBestSpot({ scoringHashLive: "deadbeef" });
    expect(scoringLine(useBestSpotStore.getState())).toContain("MAP IS STALE");
  });
});

// ── 3. Degenerate states ──────────────────────────────────────────────────────────────────────

describe("empty store and a null track both render honestly", () => {
  it("an untouched store renders without throwing and claims nothing", () => {
    const html = render();
    expect(html).toContain("BEST SPOT");
    expect(html).toContain("0% UNMAPPED · COVERAGE 0.00");
    expect(html).toContain("RANKING…"); // nothing has landed, so nothing is ranked
    expect(html).not.toContain("NOTHING IN THIS DISC SCORES"); // and no confident empty verdict
  });

  it("with no centre it says so instead of showing a warm empty field", () => {
    useCameraStore.getState().setTempPin(null);
    const html = render();
    expect(html).toContain("NO CENTRE YET");
    expect(html).toContain("OFF"); // ◎ HEATMAP OFF
  });

  it("trackNull words the failure as a TROPICS case, not a polar one", () => {
    useBestSpotStore.getState()._syncBestSpot({ trackNull: true });
    const html = render();
    expect(html).toContain("⚠ NO RISE/SET SOLUTION AT THIS LATITUDE ON THIS DATE");
    expect(html).toMatch(/TROPICS/);
    expect(html).toMatch(/NOT A POLAR ONE/);
  });
});

// ── 4. The top-K list ─────────────────────────────────────────────────────────────────────────

describe("top-K — greyed until the requested rung lands, absolute score beside a relative bar", () => {
  it("is inert and labelled RANKING… while only a coarse rung has landed", () => {
    // The coarse FIELD is honest; the coarse TOP-K is not (10 of 20 survive at 12 m).
    useBestSpotStore.getState()._syncBestSpot({ ladderRung: 0, gridCellM: BESTSPOT.ladderCellsM[0], topK: [spot()] });
    expect(shortlistReady(useBestSpotStore.getState())).toBe(false);
    const coarse = render();
    expect(coarse).toContain("RANKING…");
    expect(coarse).toContain('data-ranking="1"');
    expect(coarse).toContain(`${BESTSPOT.ladderCellsM[0]} m → ${BESTSPOT.defaultCellM} m`);

    solved();
    expect(shortlistReady(useBestSpotStore.getState())).toBe(true);
    const fine = render();
    expect(fine).not.toContain("RANKING…");
    expect(fine).toContain('data-ranking="0"');
  });

  it("prints the ABSOLUTE score AND a relative bar, plus distance, bearing and reason", () => {
    solved();
    const html = render();
    expect(html).toContain("0.89"); // absolute — §3.5, non-negotiable
    expect(html).toContain("0.60");
    expect(html).toContain("62 m NE");
    expect(html).toContain("1.5 km");
    expect(html).toContain("GRAZE");
    expect(html).toContain("OPEN HORIZON");
    expect(html).toContain("ON A BRIDGE (modelled height)");
    // The BAR is relative: #1 is the best of this shortlist so it is full, #2 is 0.60/0.89.
    expect(html).toContain("width:100%");
    expect(html).toContain(`width:${Math.round((0.6 / 0.89) * 100)}%`);
  });

  it("the row swatch is the cell's heat colour from the shared palette, never a literal", () => {
    const s = useBestSpotStore.getState();
    const css = heatCssForScore(0.89, s);
    expect(heatRampById(s.rampId).map((stop) => stop.css)).toContain(css);
    expect(css).toMatch(/^var\(--color-heat-/);
    // The display normalisation is smoothstep(displayLo, displayHi, S): the floor is the low stop.
    expect(heatCssForScore(0, s)).toBe(heatRampById(s.rampId)[0].css);
  });
});

// ── 5. Hover round trip ───────────────────────────────────────────────────────────────────────

describe("hover flows BOTH ways", () => {
  it("row hover writes store/bestSpot.hoverKey", () => {
    const tree = SpotRow({
      spot: spot(),
      relative: 1,
      swatchCss: "var(--color-heat-9)",
      hot: false,
      onHover: (key) => useBestSpotStore.getState().setHoverKey(key),
      onPick: () => {},
    });
    const row = findEl(tree, (p) => typeof p.onMouseEnter === "function");
    (propsOf(row).onMouseEnter as () => void)();
    expect(useBestSpotStore.getState().hoverKey).toBe("12:34");
    (propsOf(row).onMouseLeave as () => void)();
    expect(useBestSpotStore.getState().hoverKey).toBeNull();
  });

  it("sceneHoverKey (the canvas side) lights the row with .fnd-row--hot", () => {
    solved();
    expect(render()).not.toContain("fnd-row--hot");
    useBestSpotStore.getState()._syncBestSpot({ sceneHoverKey: "12:34" });
    expect(render()).toContain("fnd-row--hot");
  });

  it("clicking a row drops the temp pin at that cell", () => {
    useCameraStore.getState().setTempPin(null);
    const tree = SpotRow({
      spot: spot({ latDeg: 1.25, lonDeg: 2.5 }),
      relative: 1,
      swatchCss: "var(--color-heat-9)",
      hot: false,
      onHover: () => {},
      onPick: (hit) => useCameraStore.getState().setTempPin({ latDeg: hit.latDeg, lonDeg: hit.lonDeg }),
    });
    (propsOf(findEl(tree, (p) => typeof p.onClick === "function")).onClick as () => void)();
    expect(useCameraStore.getState().tempPin).toEqual({ latDeg: 1.25, lonDeg: 2.5 });
  });
});

// ── 6. R8 — ULTRA above the radius ceiling ────────────────────────────────────────────────────

describe("R8 — 1 m ULTRA is unavailable above the radius ceiling, in BOTH setter orders", () => {
  const max = BESTSPOT.ultraMaxRadiusM;
  const over = BESTSPOT.radiiM.find((r) => r > max)!;

  it("arming ULTRA first, then growing the disc, drops it", () => {
    const s = () => useBestSpotStore.getState();
    s().setRadiusM(max);
    s().setUltra(true);
    expect(s().ultra).toBe(true);
    expect(s().cellM).toBe(BESTSPOT.ultraCellM);
    s().setRadiusM(over);
    expect(s().ultra).toBe(false);
    expect(s().cellM).toBe(BESTSPOT.defaultCellM);
  });

  it("growing the disc first, then arming ULTRA, refuses it", () => {
    const s = () => useBestSpotStore.getState();
    s().setRadiusM(over);
    s().setUltra(true);
    expect(s().ultra).toBe(false);
    expect(s().cellM).toBe(BESTSPOT.defaultCellM);
  });

  it("the chip renders disabled above the ceiling and enabled at it", () => {
    useBestSpotStore.getState().setRadiusM(over);
    expect(render()).toMatch(/ULTRA/);
    expect(render()).toContain("disabled");
    useBestSpotStore.getState().setRadiusM(max);
    const at = render();
    // The only `disabled` left would be the chip's; at the ceiling it must be gone.
    expect(at).not.toContain("disabled");
  });
});

// ── 7. R6 — the empty-field lift offer ────────────────────────────────────────────────────────

describe("R6 — the lift chip is offered only when the engine computed one", () => {
  it("is absent by default", () => {
    expect(render()).not.toContain("NOTHING CLEARS THE SKYLINE");
  });

  it("prints the STORE's number, not a constant, and applying it moves the sheet", () => {
    for (const lift of [30, 57]) {
      useBestSpotStore.getState()._syncBestSpot({ suggestedLiftM: lift });
      expect(render()).toContain(`NOTHING CLEARS THE SKYLINE AT EYE LEVEL — TRY ${lift} m`);
    }
    useBestSpotStore.getState().setLiftM(57);
    expect(useBestSpotStore.getState().liftM).toBe(57);
    // The slider reads SHEET ALTITUDE = eye + lift, and the DRONE rules are in force above 5 m.
    const html = render();
    expect(html).toContain(`${Math.round(BESTSPOT.eyeM + 57)} m`);
    expect(html).toContain("▲ DRONE");
  });

  it("at eye level the sheet altitude is the pedestrian eye and there is no DRONE badge", () => {
    const html = render();
    expect(html).toContain(`${BESTSPOT.eyeM.toFixed(1)} m`);
    expect(html).not.toContain("▲ DRONE");
  });
});

// ── 8. The three progress states — and no spinner outside the 1 m re-solve ────────────────────

describe("§2.3 — no spinner", () => {
  it("READING THE MAP shows only while MVT fetches are outstanding", () => {
    expect(render()).not.toContain("READING THE MAP");
    useBestSpotStore.getState()._syncBestSpot({ tilesPending: true });
    expect(render()).toContain("READING THE MAP");
  });

  it("the ONE spinner is the explicit 1 m re-solve, and it is not spinning at rest", () => {
    solved();
    const idle = render();
    expect(idle).toContain("REFINE THIS SPOT");
    expect(idle).toContain('data-busy="0"');
    expect(idle).not.toContain('data-busy="1"');
  });
});

// ── 9. InstrumentSlider — the shared control's contract ───────────────────────────────────────

describe("InstrumentSlider", () => {
  const base = {
    label: "SHEET ALTITUDE",
    formatted: "1.7 m",
    min: BESTSPOT.eyeM,
    max: BESTSPOT.liftMaxM,
    log: true,
    onReset: () => {},
  };

  it("log mapping round-trips and puts the pedestrian end on real rail", () => {
    const { min, max } = base;
    for (const v of [min, 5, 57, max]) {
      expect(sliderValue(sliderNorm(v, min, max, true), min, max, true)).toBeCloseTo(v, 6);
    }
    expect(sliderNorm(min, min, max, true)).toBe(0);
    expect(sliderNorm(max, min, max, true)).toBe(1);
    // The whole point of the log: 1.7 → 20 m gets real travel, which linear would not give it.
    expect(sliderNorm(20, min, max, true)).toBeGreaterThan(0.4);
    expect(sliderNorm(20, min, max, false)).toBeLessThan(0.05);
  });

  it("keyboard: arrows step, Home/End jump, anything else is not ours", () => {
    expect(sliderKeyNorm("ArrowRight", 0.5, 0.02)).toBeCloseTo(0.52);
    expect(sliderKeyNorm("ArrowUp", 0.5, 0.02)).toBeCloseTo(0.52);
    expect(sliderKeyNorm("ArrowLeft", 0.5, 0.02)).toBeCloseTo(0.48);
    expect(sliderKeyNorm("ArrowDown", 0.5, 0.02)).toBeCloseTo(0.48);
    expect(sliderKeyNorm("Home", 0.5, 0.02)).toBe(0);
    expect(sliderKeyNorm("End", 0.5, 0.02)).toBe(1);
    expect(sliderKeyNorm("ArrowLeft", 0, 0.02)).toBe(0); // clamped, never negative
    expect(sliderKeyNorm("ArrowRight", 1, 0.02)).toBe(1);
    expect(sliderKeyNorm("a", 0.5, 0.02)).toBeNull();
  });

  it("the rendered track carries the ARIA slider contract", () => {
    const track = findEl(
      InstrumentSlider({ ...base, value: 20, onChange: () => {} }),
      (p) => p.role === "slider",
    );
    const p = propsOf(track);
    expect(p["aria-valuemin"]).toBe(base.min);
    expect(p["aria-valuemax"]).toBe(base.max);
    expect(p["aria-valuenow"]).toBe(20);
    expect(p["aria-valuetext"]).toBe("1.7 m");
    expect(p.tabIndex).toBe(0);
    expect(p["aria-label"]).toBe("SHEET ALTITUDE");
  });

  it("arrow keys emit a CHANGED value and double-click resets", () => {
    const seen: number[] = [];
    let reset = 0;
    const track = propsOf(
      findEl(
        InstrumentSlider({
          ...base,
          value: 20,
          onChange: (v) => seen.push(v),
          onReset: () => {
            reset++;
          },
        }),
        (p) => p.role === "slider",
      ),
    );
    let prevented = 0;
    const key = (k: string) =>
      (track.onKeyDown as (e: { key: string; preventDefault: () => void }) => void)({
        key: k,
        preventDefault: () => {
          prevented++;
        },
      });
    key("ArrowRight");
    key("ArrowLeft");
    key("Home");
    key("End");
    expect(seen).toHaveLength(4);
    expect(seen[0]).toBeGreaterThan(20);
    expect(seen[1]).toBeLessThan(20);
    expect(seen[2]).toBeCloseTo(base.min);
    expect(seen[3]).toBeCloseTo(base.max);
    expect(prevented).toBe(4);
    key("q");
    expect(seen).toHaveLength(4); // an unclaimed key must fall through
    (track.onDoubleClick as () => void)();
    key("Backspace");
    expect(reset).toBe(2);
  });
});

// ── 10. No colour literal escapes tokens.css ─────────────────────────────────────────────────

describe("ADR D14 — the new S5 surfaces carry no colour literal", () => {
  const FILES = [
    "src/styles/bestspot-panel.css",
    "src/components/panels/BestSpotPanel.tsx",
    "src/components/controls/InstrumentSlider.tsx",
    "src/components/controls/ChipRow.tsx",
  ];
  /** Hex triples/quads, and the functional colour notations. Comments are stripped first — the
   *  docblocks here talk about "dark red" and cite tokens by name on purpose. */
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|color)\s*\(/;

  it("POSITIVE CONTROL: the probe can match", () => {
    expect(LITERAL.test("color: #38e1d0;")).toBe(true);
    expect(LITERAL.test("background: rgba(0,0,0,.5)")).toBe(true);
    expect(LITERAL.test("background: var(--color-accent)")).toBe(false);
    expect(LITERAL.test("color-mix(in srgb, var(--color-bg) 72%, transparent)")).toBe(false);
  });

  it("finds none", () => {
    for (const f of FILES) {
      const src = stripComments(read(f)).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(LITERAL.exec(src)?.[0] ?? null, `${f} carries a colour literal`).toBeNull();
    }
  });
});
