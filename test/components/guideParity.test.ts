/**
 * THREE-SURFACE GUIDE PARITY (guide finalization G-F, 2026-08-22g).
 *
 * The owner's order: "all places for guide (desktop / mobile / standalone page) are
 * referencing same resources". One content module already feeds three renderers — the failure
 * mode is not divergent DATA, it is a field that only two of them bother to RENDER. That is
 * how `list` would quietly become desktop-only, and how `media.w/h` came to be a hard-coded
 * 720 on the page while the components had nothing at all.
 *
 * The mobile fence forbids these three files from sharing a component, so the only thing that
 * can hold them together is a test. Each rule below names a field of `GuideTopic`,
 * `GuideChapter`, `GuideMedia` or `GuideGoal` and asserts every renderer reaches for it.
 *
 * A new content field is not done until it appears here.
 */
import { describe, expect, it } from "vitest";
import { read, stripComments } from "../styles/_css";
import { GUIDE_CHAPTERS, GUIDE_GOALS, GUIDE_INDEX } from "../../src/lib/guide/guideContent";

const DESKTOP = "src/components/panels/Guide.tsx";
const MOBILE = "src/components/mobile/GuideSheet.tsx";
const PAGE = "src/pages/guide.astro";
const SURFACES = [DESKTOP, MOBILE, PAGE] as const;

const src = Object.fromEntries(SURFACES.map((f) => [f, stripComments(read(f))])) as Record<string, string>;

describe("guide parity — the fence's own comment stripper", () => {
  it("does not eat live code", () => {
    // Zero-result validation for the PROBE. A stripper that swallows half a file turns these
    // assertions red for a reason that has nothing to do with the renderers — which is
    // exactly what happened before line comments were stripped first.
    for (const f of SURFACES)
      expect(src[f].length / read(f).length, `${f}: stripper removed too much`).toBeGreaterThan(0.55);
  });
});

describe("guide parity — every content field renders on all three surfaces", () => {
  // field label → the pattern that proves the renderer consumes it
  const FIELDS: Array<[label: string, probe: RegExp]> = [
    ["topic body", /\bt\.body\b/],
    ["topic list", /\bt\.list\b/],
    ["topic steps", /\bt\.steps\b/],
    ["topic tip", /\bt\.tip\b/],
    ["topic media", /\bt\.media\b/],
    ["where.desktop", /where[?]?\.desktop/],
    ["where.mobile", /where[?]?\.mobile/],
    ["media caption", /\.caption\b/],
    ["media intrinsic width", /\bm\.w\b|\bmedia\.w\b/],
    ["media intrinsic height", /\bm\.h\b|\bmedia\.h\b/],
    ["chapter lead", /\.lead\b/],
    ["chapter media", /(ch|chapter)\.media\b/],
    ["goal router", /GUIDE_GOALS/],
    ["goal route", /\.route\b/],
    ["crosslink resolution to title", /GUIDE_INDEX\.get\(/],
  ];

  for (const [label, probe] of FIELDS)
    it(`renders ${label}`, () => {
      const missing = SURFACES.filter((f) => !probe.test(src[f]));
      expect(missing, `${label} is not rendered by: ${missing.join(", ")}`).toEqual([]);
    });

  it("all three offer search over the same ranker", () => {
    for (const f of SURFACES) expect(src[f], f).toMatch(/searchGuide/);
    // …and the same result presentation, so a hit list does not mean three different things.
    for (const f of SURFACES) expect(src[f], `${f} caps per chapter`).toMatch(/capPerChapter/);
    for (const f of SURFACES) expect(src[f], `${f} shows a snippet`).toMatch(/\bsnip\b/);
  });

  it("the two islands both carry the same-chapter navigation fix", () => {
    // nav() writes an identical chapterId when the target is in the OPEN chapter; React bails
    // and a scroll effect keyed only on [chapterId] never re-runs. Both islands need the
    // monotonic counter in their deps, or same-chapter crosslinks silently stop scrolling.
    for (const f of [DESKTOP, MOBILE]) {
      expect(src[f], `${f} has no navSeq`).toMatch(/setNavSeq\(\(n\) => n \+ 1\)/);
      expect(src[f], `${f} does not depend on navSeq`).toMatch(/\}, \[[^\]]*navSeq[^\]]*\]\)/);
    }
  });

  it("the standalone page keeps working with no JavaScript", () => {
    const page = src[PAGE];
    // Search is progressive enhancement: hidden until the script unhides it.
    expect(page).toMatch(/id="g-find"[\s\S]{0,200}hidden/);
    // Every goal, route step, chapter and topic is a real anchor.
    expect(page).toMatch(/href=\{`#\$\{g\.target\}`\}/);
    expect(page).toMatch(/<article class="g-chapter" id=\{ch\.id\}>/);
    expect(page).toMatch(/<section class="g-topic" id=\{t\.id\}>/);
    // The script builds nodes, never innerHTML — T24's four sinks stay compile-time.
    expect(page).not.toMatch(/innerHTML/);
  });
});

describe("guide parity — the goal router resolves identically everywhere", () => {
  it("every goal and route step is a rendered node id", () => {
    for (const g of GUIDE_GOALS) {
      const ref = GUIDE_INDEX.get(g.target);
      expect(ref, `goal "${g.goal}" → unknown ${g.target}`).toBeTruthy();
      for (const id of g.route ?? [])
        expect(GUIDE_INDEX.has(id), `goal "${g.goal}" route step ${id}`).toBe(true);
    }
  });

  it("every id the three surfaces can link to is actually emitted as an anchor", () => {
    // `/guide` emits `id={ch.id}` per chapter and `id={t.id}` per topic — so the set of
    // linkable ids is exactly GUIDE_INDEX. If a crosslink or goal ever pointed at something
    // outside it, the page would render a dead `#anchor` while both islands navigated fine.
    const emitted = new Set<string>();
    for (const ch of GUIDE_CHAPTERS) {
      emitted.add(ch.id);
      for (const t of ch.topics) emitted.add(t.id);
    }
    expect([...GUIDE_INDEX.keys()].filter((id) => !emitted.has(id))).toEqual([]);
    expect(emitted.size).toBe(GUIDE_INDEX.size);
  });
});
