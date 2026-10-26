import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TargetPeek, { quickTrackBody } from "../../src/components/mobile/TargetPeek";
import { useSkyStore } from "../../src/store/sky";
import { usePlanStore } from "../../src/store/plan";
import { useCameraStore } from "../../src/store/camera";
import { useTimeStore } from "../../src/store/time";
import { bodyTarget, cometTarget, planetTarget } from "../../src/lib/ephemeris/targets";
import { aimAtSkyBody } from "../../src/store/skyAim";

/**
 * THE QUICK TARGETS (owner 2026-10-27, verbatim): "I need on the left hand side two quick buttons (make them round
 * with only correspondent icons) of sun and moon to start tracking them (and goto) regardless of what is currently
 * being tracked. So e.g. we are tracking Saturn — then on the left of Saturn's name now there are a compact button
 * for the sun and next to it another button for the moon; upon clicking on any of those buttons you are
 * immediately brought to the respective target and start tracking it. Obviously for the sun panel you don't
 * display the redundant sun button, same for the moon's — consider them quick shortcuts."
 *
 * Pinned here: the two cells and their order (☀ then ☾) BEFORE the row button, the drop rule for the tracked body,
 * the cells outside the row button (never a button inside a button), the tap's four effects (the target, SHOW,
 * the camera lock, the goto), the dismissed-object rule, and the CSS that keeps the bar at the row's height.
 */

vi.mock("../../src/store/skyAim", () => ({ aimAtSkyBody: vi.fn(() => "plan") }));

const root = join(__dirname, "../..");
const NOON = Date.UTC(2026, 7, 21, 9, 40);
const render = () => {
  Object.assign(useSkyStore.getInitialState(), useSkyStore.getState());
  Object.assign(usePlanStore.getInitialState(), usePlanStore.getState());
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  Object.assign(useTimeStore.getInitialState(), useTimeStore.getState());
  return renderToStaticMarkup(createElement(TargetPeek, { onOpen: () => {} }));
};
const quickCells = (html: string) => [...html.matchAll(/data-quick="(\w+)"/g)].map((m) => m[1]);
/** The row button's own markup (from `class="m-peek"` to the bar's end). */
const rowMarkup = (html: string) => html.slice(html.indexOf('class="m-peek"'));

describe("TargetPeek — the quick targets", () => {
  beforeEach(() => {
    vi.mocked(aimAtSkyBody).mockClear();
    useTimeStore.setState({ live: false, timeMs: NOON, playRate: null });
    useCameraStore.setState({ focusLatDeg: 48.4647, focusLonDeg: 35.0462 });
    usePlanStore.setState({ anchor: null, target: null });
    useSkyStore.setState({ target: cometTarget(), visible: true, track: false });
  });

  it("a comet tracked: ☀ then ☾, round icon-only cells, BEFORE the row button inside one bar", () => {
    const html = render();
    expect(html).toMatch(/^<div class="m-peekbar"><button/);
    expect(quickCells(html)).toEqual(["sun", "moon"]);
    expect(html).toMatch(/class="m-peek__quick m-peek__quick--sun" data-quick="sun" aria-label="Track the sun and go to it">☀︎<\/button>/);
    expect(html).toMatch(/class="m-peek__quick m-peek__quick--moon" data-quick="moon" aria-label="Track the moon and go to it">☾︎<\/button>/);
    expect(html.indexOf('data-quick="moon"')).toBeLessThan(html.indexOf('class="m-peek"'));
    // Icon only: the cell's content is the glyph + the text-presentation selector, nothing else.
    for (const m of html.matchAll(/data-quick="\w+"[^>]*>([^<]*)</g)) expect(m[1]).toMatch(/^[☀☾]︎$/);
  });

  it("the cells are OUTSIDE the row button — never a button inside a button", () => {
    const row = rowMarkup(render());
    expect(row).not.toMatch(/<button/); // the row's own opening tag sits before the slice; nothing nested
    expect(row).toMatch(/^class="m-peek" aria-label="Tracked target: 10P\/Tempel 2\./);
    expect(row).toMatch(/<\/button><\/div>$/);
  });

  it("the sun tracked: only ☾ (the redundant sun shortcut is dropped); the moon tracked: only ☀", () => {
    useSkyStore.setState({ target: bodyTarget("sun") });
    expect(quickCells(render())).toEqual(["moon"]);
    useSkyStore.setState({ target: bodyTarget("moon") });
    expect(quickCells(render())).toEqual(["sun"]);
    useSkyStore.setState({ target: planetTarget("saturn") });
    expect(quickCells(render())).toEqual(["sun", "moon"]);
  });

  it("the gate is `target.kind` — the almanac's own cells (☀ ☾ + the object) are untouched by the quick pair", () => {
    useSkyStore.setState({ target: planetTarget("saturn") });
    const html = render();
    expect([...html.matchAll(/m-peek__alm-cell" data-body="(\w+)"/g)].map((m) => m[1])).toEqual(["sun", "moon", "target"]);
    // The accent kind glyph that led the row is gone — the quick pair took its place; the almanac's target
    // cell still shows the kind (◉ for a planet).
    expect(html).not.toMatch(/m-peek__glyph"/);
    expect(html).toMatch(/m-peek__alm-glyph m-peek__alm-glyph--target">◉︎</);
  });

  it("a dismissed object leaves the WHOLE bar — the shortcuts ride the row (owner 2026-08-19)", () => {
    useSkyStore.setState({ visible: false });
    expect(render()).toBe("");
  });

  it("the tap: the body becomes the tracked target, SHOW on, the camera lock on, then the goto (aimAtSkyBody)", () => {
    useSkyStore.setState({ target: planetTarget("saturn"), visible: false, track: false });
    expect(quickTrackBody("sun")).toBe("plan");
    const s = useSkyStore.getState();
    expect(s.target.id).toBe("body:sun");
    expect(s.visible).toBe(true);
    expect(s.track).toBe(true);
    expect(aimAtSkyBody).toHaveBeenCalledTimes(1);
    expect(aimAtSkyBody).toHaveBeenCalledWith("sun");
    quickTrackBody("moon");
    expect(useSkyStore.getState().target.id).toBe("body:moon");
    expect(aimAtSkyBody).toHaveBeenLastCalledWith("moon");
    // The same instance each time — the row's module constants (the almanac's rise/set memo keys read the id).
    quickTrackBody("sun");
    const a = useSkyStore.getState().target;
    quickTrackBody("moon");
    quickTrackBody("sun");
    expect(useSkyStore.getState().target).toBe(a);
  });

  it("in FPV (aimAtSkyBody → \"look\") the one-shot skyLook is cleared while the body is above the lock's release altitude — the lock is the goto; below it the one-shot stays (the rise-azimuth glide)", () => {
    vi.mocked(aimAtSkyBody).mockReturnValueOnce("look");
    useCameraStore.setState({ skyLook: { azDeg: 1, altDeg: 1 }, camGeo: null });
    // The sun at solar noon in Dnipro: ~53° up → the lock would shadow the one-shot → cleared.
    expect(quickTrackBody("sun")).toBe("look");
    expect(useCameraStore.getState().skyLook).toBeNull();
    expect(useSkyStore.getState().track).toBe(true);
    // The moon is below the horizon at that instant → the lock releases next frame → the one-shot is kept.
    vi.mocked(aimAtSkyBody).mockReturnValueOnce("look");
    useCameraStore.setState({ skyLook: { azDeg: 2, altDeg: 0 } });
    expect(quickTrackBody("moon")).toBe("look");
    expect(useCameraStore.getState().skyLook).toEqual({ azDeg: 2, altDeg: 0 });
    // On the map ("plan") nothing is cleared — there is no one-shot look to shadow.
    useCameraStore.setState({ skyLook: { azDeg: 3, altDeg: 3 } });
    expect(quickTrackBody("sun")).toBe("plan");
    expect(useCameraStore.getState().skyLook).toEqual({ azDeg: 3, altDeg: 3 });
    useCameraStore.setState({ skyLook: null });
  });

  it("source fences: the tap's order (target → SHOW → lock → goto); the drop rule reads target.kind; the cells map ☀ ☾ in that order", () => {
    const src = readFileSync(join(root, "src/components/mobile/TargetPeek.tsx"), "utf8");
    const fn = src.slice(src.indexOf("export function quickTrackBody"), src.indexOf("interface AlmanacCell"));
    const order = ["sky.setTarget(kind === \"sun\" ? SUN_TARGET : MOON_TARGET);", "if (!sky.visible) sky.setVisible(true);", "sky.setTrack(true);", "aimAtSkyBody(kind);", "if (alt >= FPV.skyTrackReleaseAltDeg) cam._clearSkyLook();"];
    let at = -1;
    for (const line of order) {
      const i = fn.indexOf(line);
      expect(i, line).toBeGreaterThan(at);
      at = i;
    }
    expect(src).toMatch(/const quick = \(\["sun", "moon"\] as const\)\.filter\(\(k\) => k !== target\.kind\);/);
    expect(src).toMatch(/onClick=\{\(\) => quickTrackBody\(k\)\}/);
    expect(src).not.toMatch(/m-peek__glyph/);
    // The shell still mounts the row under the facade peek, above the dock (the bar is the row's own wrapper).
    const shell = readFileSync(join(root, "src/components/mobile/MobileShell.tsx"), "utf8");
    expect(shell).toMatch(/<FacadePeek \/>\s*<TargetPeek onOpen=/);
  });

  it("CSS: round 25 px cells riding inside the row's pads (the bar is not taller than the row), a touch extension, the body inks, the bar carries the hairline", () => {
    const css = readFileSync(join(root, "src/styles/mobile/chrome.css"), "utf8");
    const block = (sel: string) => {
      const i = css.indexOf(`\n${sel} {`);
      expect(i, `${sel} rule`).toBeGreaterThan(0);
      return css.slice(i, css.indexOf("}", i));
    };
    const cell = block(".m-peek__quick");
    expect(cell).toMatch(/width: 25px;/);
    expect(cell).toMatch(/height: 25px;/);
    expect(cell).toMatch(/border-radius: 50%;/);
    expect(cell).toMatch(/margin: -4px 0;/); // 25 − 2·4 = 17 px < the row's 22.6 px content height
    expect(cell).toMatch(/font-variant-emoji: text;/);
    expect(cell).toMatch(/padding: 0;/);
    expect(block(".m-peek__quick::before")).toMatch(/inset: -7px -2px;/);
    expect(block(".m-peek__quick--sun")).toMatch(/color: var\(--color-sun-glow\);/);
    expect(block(".m-peek__quick--moon")).toMatch(/color: var\(--color-moonlight\);/);
    const bar = block(".m-peekbar");
    expect(bar).toMatch(/display: flex;/);
    expect(bar).toMatch(/align-items: center;/);
    expect(bar).toMatch(/border-bottom: 1px solid/);
    const row = block(".m-peek");
    expect(row).not.toMatch(/border-bottom/);
    expect(row).not.toMatch(/width: 100%/);
    expect(row).toMatch(/flex: 1 1 auto;/);
    expect(row).toMatch(/min-width: 0;/);
    expect(row).toMatch(/padding: 0\.5rem 0\.9rem 0\.5rem 0\.3rem;/);
    // The row's badge a notch tighter (JUPITER + BELOW unclipped on every twin).
    expect(block(".m-peek .m-badge")).toMatch(/padding: 0\.14rem 0\.4rem;/);
    // The dead glyph rule is gone with the glyph.
    expect(css).not.toMatch(/\.m-peek__glyph\b/);
    // The narrow-phone pair shrinks a notch in its OWN media block (the 2026-10-25 block stays verbatim).
    expect(css).toMatch(/@media \(max-width: 375px\) \{\s*\.m-peekbar \{\s*gap: 2px;\s*padding-left: 0\.25rem;\s*\}\s*\.m-peek__quick \{\s*width: 21px;\s*height: 21px;\s*margin: -3px 0;/);
  });
});
