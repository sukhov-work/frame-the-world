import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TargetPeek from "../../src/components/mobile/TargetPeek";
import { useSkyStore } from "../../src/store/sky";
import { usePlanStore } from "../../src/store/plan";
import { useCameraStore } from "../../src/store/camera";
import { useTimeStore } from "../../src/store/time";
import { bodyTarget, cometTarget } from "../../src/lib/ephemeris/targets";

/**
 * THE PEEK ROW'S ALMANAC (owner 2026-10-25): "for the currently tracked object we show rise and set times in
 * the bottom bar; also add the sun's and the moon's rise and set permanently, in a readable, compact form
 * with corresponding icons and the same style — make sure we can tell across the 3 pairs which is which,
 * readable but not bloating the bar, and do not make the bar itself taller; if the current object IS the
 * sun or the moon, no need to duplicate."
 *
 * Pinned here: the three cells and their order (☀ ☾ then the object), the drop rule for a tracked sun /
 * moon, two clocks per cell under one ↑/↓ legend, the bodies named in the row's label, the bearings
 * stacked in the same grammar, and the CSS invariants that keep the row's height — both clusters are the
 * two 0.56rem / 1.15 lines the single pair was (2026-09-16), the row's own pads unchanged.
 */

const root = join(__dirname, "../..");
const NOON = Date.UTC(2026, 7, 21, 9, 40); // solar noon in Dnipro — the sun up, the moon elsewhere
/** zustand v5 serves `getInitialState()` as the SERVER snapshot (the findThisOne / bestSpotPanel idiom): mirror
 *  the live stores onto it, or a server render shows boot state no matter what the test wrote. */
const render = () => {
  Object.assign(useSkyStore.getInitialState(), useSkyStore.getState());
  Object.assign(usePlanStore.getInitialState(), usePlanStore.getState());
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  Object.assign(useTimeStore.getInitialState(), useTimeStore.getState());
  return renderToStaticMarkup(createElement(TargetPeek, { onOpen: () => {} }));
};
const cells = (html: string) => [...html.matchAll(/m-peek__alm-cell" data-body="(\w+)"/g)].map((m) => m[1]);
const clocks = (html: string) => [...html.matchAll(/class="m-peek__alm-t">([^<]*)</g)].map((m) => m[1]);
const marks = (html: string) => [...html.matchAll(/class="m-peek__alm-d">([^<]*)</g)].map((m) => m[1]);
/** The ROW's label — since 2026-10-27 the quick ☀ ☾ cells render before it with labels of their own. */
const label = (html: string) => html.match(/class="m-peek" aria-label="([^"]*)"/)?.[1] ?? "";

describe("TargetPeek — the almanac", () => {
  beforeEach(() => {
    useTimeStore.setState({ live: false, timeMs: NOON, playRate: null });
    useCameraStore.setState({ focusLatDeg: 48.4647, focusLonDeg: 35.0462 });
    usePlanStore.setState({ anchor: null, target: null });
    useSkyStore.setState({ target: cometTarget(), visible: true });
  });

  it("a comet tracked: three cells — ☀, ☾, then the object with its kind glyph — each with two clocks under one ↑/↓ legend", () => {
    const html = render();
    expect(cells(html)).toEqual(["sun", "moon", "target"]);
    // Every glyph carries U+FE0E (text presentation) so iOS never swaps ☀ / ☄ for a colour emoji.
    expect(html).toMatch(/m-peek__alm-glyph m-peek__alm-glyph--sun">☀\uFE0E</);
    expect(html).toMatch(/m-peek__alm-glyph m-peek__alm-glyph--moon">☾\uFE0E</);
    expect(html).toMatch(/m-peek__alm-glyph m-peek__alm-glyph--target">☄\uFE0E</);
    // The accent kind glyph that led the row left 2026-10-27 (the quick cells took its place; the almanac's
    // target cell carries the kind) — `mobileTargetPeekQuick.test.ts` pins the cells.
    expect(html).not.toMatch(/m-peek__glyph"/);
    expect(html.indexOf("☀")).toBeLessThan(html.indexOf("☾"));
    const c = clocks(html);
    expect(c).toHaveLength(6);
    for (const t of c) expect(t).toMatch(/^(\d\d:\d\d|—)$/);
    expect((html.match(/m-peek__alm-k/g) ?? []).length).toBe(1);
    expect(html).toMatch(/m-peek__alm-k"><span>↑<\/span><span>↓<\/span><\/span>/);
    // The sun's clocks at this observer and date are real times, not em dashes.
    expect(c[0]).toMatch(/^\d\d:\d\d$/);
    expect(c[1]).toMatch(/^\d\d:\d\d$/);
  });

  it("the row's label names every body's rise and set (the button's label replaces its content for a reader)", () => {
    const l = label(render());
    expect(l).toMatch(/^Tracked target: /);
    const t = "(\\d\\d:\\d\\d( next day| in \\d days)?|none)";
    expect(l).toMatch(new RegExp(`\\. Sun rise ${t}, set ${t}; Moon rise ${t}, set ${t}; 10P rise ${t}, set ${t}\\. `));
    expect(l).not.toMatch(/—/); // a reader hears "none", never "em dash"
    expect(l).toMatch(/Open details; hold the name to aim the view at it$/);
  });

  it("the sun tracked: two cells (☀ ☾) — its own pair would duplicate the almanac's", () => {
    useSkyStore.setState({ target: bodyTarget("sun") });
    const html = render();
    expect(cells(html)).toEqual(["sun", "moon"]);
    expect(html).not.toMatch(/m-peek__alm-glyph--target/);
    expect(clocks(html)).toHaveLength(4);
    expect((label(html).match(/Sun rise/g) ?? []).length).toBe(1);
  });

  it("the moon tracked: two cells (☀ ☾) likewise", () => {
    useSkyStore.setState({ target: bodyTarget("moon") });
    const html = render();
    expect(cells(html)).toEqual(["sun", "moon"]);
    expect(clocks(html)).toHaveLength(4);
  });

  it("the bearings stack — altitude over azimuth + cardinal — in the almanac's grammar", () => {
    const html = render();
    expect(html).toMatch(/class="m-peek__pos"><span>-?\d+°<\/span><span>\d+° [NESW]{1,3}<\/span><\/span>/);
  });

  it("a dismissed object still leaves the whole row (owner 2026-08-19 — the almanac rides the row, not the shell)", () => {
    useSkyStore.setState({ visible: false });
    expect(render()).toBe("");
  });

  it("the day's events (owner 2026-10-25c): at 15:00 the sun's rise is this morning's, not tomorrow's; a tomorrow event wears +1 in the cell and 'next day' in the label", () => {
    // 15:00 local on 2026-08-21 — the sun rose this morning; the row must print THAT rise (the old row printed tomorrow's).
    useTimeStore.setState({ live: false, timeMs: new Date(2026, 7, 21, 15, 0).getTime(), playRate: null });
    useSkyStore.setState({ target: bodyTarget("sun") });
    const html = render();
    const c = clocks(html);
    const sunRise = Number(c[0].slice(0, 2));
    expect(sunRise).toBeLessThan(12); // a morning clock, this morning's
    expect(marks(html).every((m) => /^\+\d$/.test(m))).toBe(true);
    // The label mirrors the marker's meaning in words.
    const l = label(html);
    expect(l).not.toMatch(/\+\d/);
    if (marks(html).length > 0) expect(l).toMatch(/next day|in \d days/);
    // Any marker renders INSIDE its clock span, after the digits — never a third row.
    expect(html).not.toMatch(/m-peek__alm-d"[^<]*<\/span><span class="m-peek__alm-t/);
    expect((html.match(/m-peek__alm-times/g) ?? []).length).toBe(2);
  });

  it("source fences: the almanac bodies are module constants; the own-pair rule is the kind; the pairs are the DAY's (dayRiseSet, memoised on the clock day)", () => {
    const src = readFileSync(join(root, "src/components/mobile/TargetPeek.tsx"), "utf8");
    expect(src).toMatch(/^const SUN_TARGET = bodyTarget\("sun"\);$/m);
    expect(src).toMatch(/^const MOON_TARGET = bodyTarget\("moon"\);$/m);
    expect(src).toMatch(/const ownPair = target\.kind !== "sun" && target\.kind !== "moon";/);
    expect(src).toMatch(/useDayRiseSet\(SUN_TARGET, minuteKey \* 60_000, latDeg, lonDeg\)/);
    expect(src).toMatch(/useDayRiseSet\(MOON_TARGET, minuteKey \* 60_000, latDeg, lonDeg\)/);
    expect(src).toMatch(/const sameDay = c !== null && nowMs >= c\.rs\.dayStartMs && nowMs < c\.rs\.dayEndMs;/);
    expect(src).not.toMatch(/nextRiseSet/);
    expect(src).not.toMatch(/m-peek__rs/);
    // The mobile shell still mounts it under the facade peek, above the dock.
    const shell = readFileSync(join(root, "src/components/mobile/MobileShell.tsx"), "utf8");
    expect(shell).toMatch(/<FacadePeek \/>\s*<TargetPeek onOpen=/);
  });

  it("T200 (owner 2026-10-25e): the ☾ cell carries the moon's verdict as data-vis, the label says it — no visible text, no new element", () => {
    // 14:45Z 2026-10-25, Dnipro: the moon low in civil twilight — BRIGHT (the moonVisibility worked case).
    useTimeStore.setState({ live: false, timeMs: Date.UTC(2026, 9, 25, 14, 45), playRate: null });
    const html = render();
    expect(html).toMatch(/m-peek__alm-cell" data-body="moon" data-vis="bright"/);
    expect(html).not.toMatch(/data-body="(sun|target)" data-vis=/);
    expect((html.match(/data-vis=/g) ?? []).length).toBe(1);
    // The cell's markup is otherwise the almanac's: glyph + two clocks, no badge text.
    expect(html).not.toMatch(/>BRIGHT</);
    const l = label(html);
    expect(l).toMatch(/\. Moon bright now: civil twilight · low in haze, [\d.]+ mag lost, orange\. Open details;/);
    expect(l).not.toMatch(/—/);
    // A daylight moon reads pale (2026-11-02 08:00Z).
    useTimeStore.setState({ timeMs: Date.UTC(2026, 10, 2, 8, 0) });
    const pale = render();
    expect(pale).toMatch(/data-body="moon" data-vis="pale"/);
    expect(label(pale)).toMatch(/Moon pale now: daylight/);
  });

  it("T200 CSS: the faint / lost dim is opacity only on the ☾ glyph — no box property", () => {
    const css = readFileSync(join(root, "src/styles/mobile/chrome.css"), "utf8");
    const m = css.match(/\.m-peek__alm-cell\[data-vis="faint"\] \.m-peek__alm-glyph,\s*\.m-peek__alm-cell\[data-vis="lost"\] \.m-peek__alm-glyph \{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1].trim()).toBe("opacity: 0.55;");
  });

  it("CSS invariants: both clusters are the two 0.56rem / 1.15 lines, the row's pads untouched, the glyph inks, no dead .m-peek__rs rule", () => {
    const css = readFileSync(join(root, "src/styles/mobile/chrome.css"), "utf8");
    const block = (sel: string) => {
      const i = css.indexOf(`\n${sel} {`);
      expect(i, `${sel} rule`).toBeGreaterThan(0);
      return css.slice(i, css.indexOf("}", i));
    };
    const row = block(".m-peek");
    // The vertical pads are the row's height; the left pad became the pair → name gap (2026-10-27).
    expect(row).toMatch(/padding: 0\.5rem 0\.9rem 0\.5rem 0\.3rem;/);
    expect(row).toMatch(/overflow: hidden;/);
    expect(block(".m-peek__alm-glyph")).toMatch(/font-variant-emoji: text;/);
    expect(row).toMatch(/font-size: 0\.68rem;/);
    expect(row).toMatch(/gap: 10px;/);
    for (const sel of [".m-peek__alm", ".m-peek__pos"]) {
      const b = block(sel);
      expect(b).toMatch(/font-size: 0\.56rem;/);
      expect(b).toMatch(/line-height: 1\.15;/);
      expect(b).toMatch(/font-variant-numeric: tabular-nums;/);
      expect(b).toMatch(/white-space: nowrap;/);
    }
    expect(block(".m-peek__alm")).toMatch(/margin-left: auto;/);
    expect(block(".m-peek__pos")).toMatch(/flex-direction: column;/);
    expect(block(".m-peek__pos")).toMatch(/border-left: 1px solid/);
    // The legend's rows sit on the clocks' rows: 0.5rem × 1.288 = 0.56rem × 1.15.
    expect(block(".m-peek__alm-k")).toMatch(/line-height: 1\.288;/);
    // The "+1" marker stays out of the line box: line-height 0, a relative lift, a micro size.
    const d = block(".m-peek__alm-d");
    expect(d).toMatch(/line-height: 0;/);
    expect(d).toMatch(/position: relative;/);
    expect(d).toMatch(/font-size: 0\.4\drem;/);
    expect(0.5 * 1.288).toBeCloseTo(0.56 * 1.15, 6);
    expect(block(".m-peek__alm-glyph--sun")).toMatch(/var\(--color-sun-glow\)/);
    expect(block(".m-peek__alm-glyph--moon")).toMatch(/var\(--color-moonlight\)/);
    expect(block(".m-peek__alm-glyph--target")).toMatch(/var\(--color-accent\)/);
    expect(css).not.toMatch(/\.m-peek__rs\b/);
    // The narrow-phone fallback tightens gaps only.
    expect(css).toMatch(/@media \(max-width: 375px\) \{\s*\.m-peek \{\s*gap: 7px;\s*\}\s*\.m-peek__alm \{\s*gap: 4px;\s*\}\s*\}/);
  });
});
