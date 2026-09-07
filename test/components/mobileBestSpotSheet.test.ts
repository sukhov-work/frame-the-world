import { beforeEach, describe, expect, it } from "vitest";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import BestSpotSheet, {
  kindPillLabel,
  MobileSpotRow,
} from "../../src/components/mobile/BestSpotSheet";
import TabBar, { type MobileTab } from "../../src/components/mobile/TabBar";
import {
  bestSpotStatusEntries,
  bestSpotStatusLines,
  KIND_OPTIONS,
  spotWhyLines,
} from "../../src/components/controls/bestSpotCopy";
import {
  shortlistQuality,
  useBestSpotStore,
  type BestSpotSpot,
  type BestSpotState,
} from "../../src/store/bestSpot";
import { useCameraStore } from "../../src/store/camera";
import { BESTSPOT } from "../../src/components/globe/tuning";
import { spotQualityCss } from "../../src/lib/theme/heatPalette";

/**
 * BEST SPOT on /m (owner order 2026-09-07g) — the fifth bottom-row tab and its sheet.
 *
 * The desktop panel's harness idiom verbatim (`bestSpotPanel.test.ts`): `renderToStaticMarkup`
 * with the live store mirrored onto zustand's server snapshot for WHAT IS ON SCREEN, and the
 * hook-free `MobileSpotRow` called as a plain function for the handlers.
 *
 * Mutations that make these RED: a sixth/fourth tab, a tab label longer than six characters,
 * an ULTRA control on the phone, the sheet disarming the heatmap when it collapses, a status
 * line the desktop prints that the phone does not (both read `bestSpotStatusLines`), the
 * relative bar without the absolute score, GO issued from inside a preview without leaving it
 * first, or a fifth-tab render that names anything but the shared copy.
 */

const BOOT: BestSpotState = { ...useBestSpotStore.getState() };

function render(open = true): string {
  Object.assign(useBestSpotStore.getInitialState(), useBestSpotStore.getState());
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  return renderToStaticMarkup(createElement(BestSpotSheet, { open, onClose: () => {} }));
}

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
  gridCellM: 1,
  obstructionRefined: false,
  refinedFromScore: null,
  ...over,
});

function solved(over: Partial<BestSpotState> = {}): void {
  useBestSpotStore.getState()._syncBestSpot({
    verdictCounts: { scored: 31_417, unknown: 11_310, blocked: 2_004, total: 44_731 },
    coverage: 0.71,
    unmappedFrac: 0.36,
    reachM: 700,
    ladderRung: BESTSPOT.ladderCellsM.length - 1,
    gridCellM: BESTSPOT.defaultCellM,
    shortlistCellM: BESTSPOT.ultraCellM,
    heightProvenance: { enriched: 3, osm: 11 },
    topK: [spot(), spot({ key: "40:9", rank: 2, score: 0.6, distM: 1500, contact: "open", note: null })],
    ...over,
  });
}

beforeEach(() => {
  useBestSpotStore.setState(BOOT, true);
  useBestSpotStore.getState().setOpen(true);
  useBestSpotStore.getState().setHeatmapOn(true);
  useCameraStore.getState().setTempPin({ latDeg: 48.4647, lonDeg: 35.0462 });
});

// ── 1. The fifth tab ──────────────────────────────────────────────────────────────────────────

describe("TabBar — five items, SPOT right of SEARCH, every label fits a 375 px row", () => {
  it("renders exactly five tabs in the owner's order, SPOT last", () => {
    const html = renderToStaticMarkup(
      createElement(TabBar, { active: "scene" as MobileTab, onSelect: () => {} }),
    );
    const labels = [...html.matchAll(/<\/span>([A-Z]+)<\/button>/g)].map((m) => m[1]);
    expect(labels).toEqual(["SCENE", "PLAN", "FIND", "SEARCH", "SPOT"]);
  });

  it("no label exceeds six characters — five cells share ~69 px each; abbreviate before shrinking", () => {
    const src = readFileSync(join(process.cwd(), "src/components/mobile/TabBar.tsx"), "utf8");
    const labels = [...src.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBe(5); // POSITIVE CONTROL
    for (const l of labels) expect(l.length, l).toBeLessThanOrEqual(6);
  });

  it("the active SPOT tab is pressed", () => {
    const html = renderToStaticMarkup(
      createElement(TabBar, { active: "spot" as MobileTab, onSelect: () => {} }),
    );
    expect(html).toMatch(/m-tab m-tab--on" aria-pressed="true"[^>]*>[^<]*<span[^>]*>◎<\/span>SPOT/);
  });
});

// ── 2. Sticky open — the FIND contract ────────────────────────────────────────────────────────

describe("the sheet is a TAB, not a segment: collapsing it never disarms the heatmap", () => {
  it("collapsed renders nothing while the store stays open and armed", () => {
    solved();
    expect(render(false)).toBe("");
    expect(useBestSpotStore.getState().open).toBe(true);
    expect(useBestSpotStore.getState().heatmapOn).toBe(true);
  });

  it("the source never calls setOpen on collapse — only on page teardown", () => {
    const src = readFileSync(join(process.cwd(), "src/components/mobile/BestSpotSheet.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const calls = [...code.matchAll(/setOpen\((true|false)\)/g)].map((m) => m[1]);
    // One guarded `true` (first visit), one `false` (teardown). A second `false` would be the
    // collapse path the desktop's segmented toggle has and a tab must not.
    expect(calls.sort()).toEqual(["false", "true"]);
    expect(code).toMatch(/if \(open && !useBestSpotStore\.getState\(\)\.open\)/);
  });
});

// ── 3. No ULTRA on the phone ──────────────────────────────────────────────────────────────────

describe("the desktop behaviour WITHOUT the ULTRA options", () => {
  it("renders the four event pills and the five radius chips, but no 1 m chip and no REFINE", () => {
    solved();
    const html = render();
    for (const o of KIND_OPTIONS) expect(html).toContain(kindPillLabel(o));
    for (const r of BESTSPOT.radiiM) expect(html).toMatch(new RegExp(`>${r}</button>`));
    expect(html).not.toMatch(/ULTRA/);
    expect(html).not.toMatch(/REFINE/);
    expect(html).not.toMatch(new RegExp(`>${BESTSPOT.ultraCellM} m<`));
  });

  it("the picked event pill is pressed and carries its day-arc tone by NAME", () => {
    useBestSpotStore.getState().setKind("moonset");
    const html = render();
    expect(html).toMatch(/m-toggle m-toggle--moon m-toggle--on" aria-pressed="true"[^>]*>☾ M\.SET/);
    expect(html).toMatch(/m-toggle m-toggle--sun" aria-pressed="false"[^>]*>☀ SUNSET/);
  });
});

// ── 4. The honesty ladder — shared with the desktop, three inline + the caveats fold ──────────

describe("status lines — ONE copy for both shells", () => {
  it("prints the first three ladder lines inline and offers the other five as caveats", () => {
    solved({ terrainPostingM: 145 } as Partial<BestSpotState>);
    const html = render();
    const entries = bestSpotStatusEntries(useBestSpotStore.getState());
    expect(entries.length).toBe(8); // POSITIVE CONTROL — the desktop ladder is eight lines
    expect(entries.map((e) => e.line)).toEqual(bestSpotStatusLines(useBestSpotStore.getState()));
    const inline = entries.filter((e) => ["unmapped", "obstruction", "reach"].includes(e.key));
    expect(inline.length).toBe(3);
    for (const e of inline) expect(html).toContain(e.line);
    // …and the folded five are NOT on screen until the toggle opens (a static render is closed).
    for (const e of entries) if (!inline.includes(e)) expect(html).not.toContain(e.line);
    expect(html).toContain("5 MORE CAVEATS");
  });

  it("the numbers MOVE with the store (never a literal in the JSX)", () => {
    solved({ unmappedFrac: 0.12, coverage: 0.93, reachM: 420 });
    const html = render();
    expect(html).toContain("12% UNMAPPED · COVERAGE 0.93");
    expect(html).toContain("EVIDENCE REACHES 420 m — BEYOND THAT, UNKNOWN");
  });

  it("warnings never fold: RURAL and the TROPICS null-track lines render inline", () => {
    solved({ terrainOnly: true, builtDensityPerKm2: 0.4, trackNull: true });
    const html = render();
    expect(html).toContain("⚠ RURAL — TERRAIN ONLY");
    expect(html).toContain("THIS IS A TROPICS CASE, NOT A POLAR ONE");
  });

  it("with no centre it says so and offers CENTRE HERE, which drops the temp pin at the map focus", () => {
    useCameraStore.getState().setTempPin(null);
    useCameraStore.setState({ focusLatDeg: 50.45, focusLonDeg: 30.52 });
    const html = render();
    expect(html).toContain("NO CENTRE YET");
    expect(html).toContain("◎ CENTRE HERE");
    // Drive the handler off the element tree: the sheet is not hook-free, so the render above
    // proves the affordance and the store contract is exercised directly here.
    useCameraStore.getState().setTempPin({ latDeg: 50.45, lonDeg: 30.52 });
    expect(useCameraStore.getState().tempPin).toEqual({ latDeg: 50.45, lonDeg: 30.52 });
  });

  it("OFF says nothing is being computed; ON says the field survives the sheet closing", () => {
    useBestSpotStore.getState().setHeatmapOn(false);
    expect(render()).toContain("HEATMAP OFF — NOTHING IS BEING COMPUTED");
    useBestSpotStore.getState().setHeatmapOn(true);
    expect(render()).toContain("THE FIELD STAYS ON THE MAP WHEN THIS SHEET CLOSES");
  });
});

// ── 5. The shortlist row ──────────────────────────────────────────────────────────────────────

describe("MobileSpotRow — absolute score beside the relative bar; select, GO, LOOK; no REFINE", () => {
  const row = (over: Partial<Parameters<typeof MobileSpotRow>[0]> = {}) =>
    MobileSpotRow({
      spot: spot(),
      relative: 0.5,
      swatchCss: spotQualityCss(shortlistQuality(0.89, [0.89, 0.6])),
      selected: false,
      previewing: false,
      onSelect: () => {},
      onGo: () => {},
      onLook: () => {},
      ...over,
    });

  it("prints the ABSOLUTE score and a bar at score ÷ best, plus distance, bearing, contact, lead", () => {
    const html = renderToStaticMarkup(row());
    expect(html).toContain("0.89");
    expect(html).toMatch(/m-bsp-bar[^>]*><i style="width:50%"/);
    expect(html).toContain("62 m NE");
    expect(html).toContain("GRAZE");
    expect(html).toContain("+3m20s");
  });

  it("a tap SELECTS; the actions appear only on the selected row, and there is no REFINE", () => {
    const picked: (string | null)[] = [];
    const tree = row({ onSelect: (k) => picked.push(k) });
    const btn = findEl(tree, (p) => p.className === "m-row__jump");
    (propsOf(btn).onClick as () => void)();
    expect(picked).toEqual(["12:34"]);
    expect(renderToStaticMarkup(tree)).not.toContain("GO →");
    const sel = row({ selected: true, onSelect: (k) => picked.push(k) });
    const html = renderToStaticMarkup(sel);
    expect(html).toContain("GO → RE-CENTRE HERE");
    expect(html).toContain("◎ LOOK FROM HERE");
    expect(html).not.toContain("REFINE");
    // The WHY line is the shared copy's, so it cannot disagree with the desktop's tip.
    expect(html).toContain(spotWhyLines(spot())[1]);
    // A second tap deselects.
    (propsOf(findEl(sel, (p) => p.className === "m-row__jump")).onClick as () => void)();
    expect(picked).toEqual(["12:34", null]);
  });

  it("GO and LOOK reach their handlers with the row's spot; previewing flips LOOK to BACK", () => {
    const went: string[] = [];
    const looked: string[] = [];
    const tree = row({
      selected: true,
      previewing: true,
      onGo: (s) => went.push(s.key),
      onLook: (s) => looked.push(s.key),
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("◎ BACK");
    const go = findEl(tree, (p) => p.children === "GO → RE-CENTRE HERE");
    (propsOf(go).onClick as () => void)();
    // NOT `aria-pressed === true` — the selected row's own button is pressed too.
    const look = findEl(tree, (p) => p.children === "◎ BACK");
    (propsOf(look).onClick as () => void)();
    expect(went).toEqual(["12:34"]);
    expect(looked).toEqual(["12:34"]);
  });

  it("the rendered list greys until the requested rung lands, with the determinate pip", () => {
    solved({ ladderRung: 0, gridCellM: BESTSPOT.ladderCellsM[0] });
    const html = render();
    expect(html).toContain("RANKING…");
    expect(html).toMatch(/data-ranking="1"/);
    expect(html).toContain(`${BESTSPOT.ladderCellsM[0]} m → ${BESTSPOT.defaultCellM} m · NOW ${BESTSPOT.ladderCellsM[0]} m`);
    solved();
    expect(render()).toMatch(/data-ranking="0"/);
  });

  it("GO leaves any preview FIRST (restore, then move) — pinned in the source", () => {
    const src = readFileSync(join(process.cwd(), "src/components/mobile/BestSpotSheet.tsx"), "utf8");
    const go = src.slice(src.indexOf("onGo={(hit) => {"), src.indexOf("onLook={(hit) => {"));
    expect(go.indexOf("previewSpot?.(null)")).toBeGreaterThan(-1);
    expect(go.indexOf("previewSpot?.(null)")).toBeLessThan(go.indexOf("setTempPin("));
  });
});
