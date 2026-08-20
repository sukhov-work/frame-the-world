/**
 * Guide search — BM25 + fuzzy ranking over the real content module (owner 2026-08-19).
 * The suite runs against the LIVE guide content on purpose: every topic must stay findable
 * by its own title, and the fuzzy ladder must keep absorbing owner-grade typos. If a content
 * edit breaks a case here, the content (or its terms) changed meaning — not the engine.
 */
import { describe, expect, it } from "vitest";
import { GUIDE_CHAPTERS } from "../../../src/lib/guide/guideContent";
import { buildGuideIndex, searchGuide } from "../../../src/lib/guide/search";

describe("guide search", () => {
  it("finds every topic by its own title", () => {
    for (const ch of GUIDE_CHAPTERS) {
      for (const t of ch.topics) {
        const hits = searchGuide(t.title, 8);
        expect(hits.map((h) => h.id), `title "${t.title}"`).toContain(t.id);
      }
    }
  });

  it("ranks a title hit first for distinctive queries", () => {
    expect(searchGuide("meteor")[0]?.id).toBe("plan-meteors");
    expect(searchGuide("radar")[0]?.id).toBe("target-radar");
    expect(searchGuide("unfollow")[0]?.id).toBe("target-unfollow");
  });

  it("absorbs typos via the fuzzy ladder", () => {
    // 1 edit, ≥4 chars
    expect(searchGuide("metors").map((h) => h.id)).toContain("plan-meteors");
    // transposition
    expect(searchGuide("buliding height").map((h) => h.id)).toContain("fpv-height");
    // 2 edits, ≥7 chars
    expect(searchGuide("unfolow").map((h) => h.id)).toContain("target-unfollow");
  });

  it("matches prefixes while typing", () => {
    expect(searchGuide("mete").map((h) => h.id)).toContain("plan-meteors");
    expect(searchGuide("joyst").map((h) => h.id)).toContain("fpv-walk");
  });

  it("prefers coverage on multi-word queries", () => {
    const hits = searchGuide("save view name");
    expect(hits[0]?.id).toBe("save-place");
  });

  it("finds topics through goal phrasing folded onto targets", () => {
    // GUIDE_GOALS: "Correct a building that looks wrong" → fpv-height.
    expect(searchGuide("building looks wrong").map((h) => h.id)).toContain("fpv-height");
  });

  it("returns [] for empty or unmatchable queries", () => {
    expect(searchGuide("")).toEqual([]);
    expect(searchGuide("   ")).toEqual([]);
    expect(searchGuide("qqxxyyzz")).toEqual([]);
  });

  it("caps results at the limit, best first, ids unique", () => {
    const hits = searchGuide("the moon", 5);
    expect(hits.length).toBeLessThanOrEqual(5);
    expect(new Set(hits.map((h) => h.id)).size).toBe(hits.length);
  });

  it("hits carry a chapter breadcrumb and topic hits a snippet", () => {
    const [top] = searchGuide("meteor");
    expect(top.chapterTitle).toBe("PLAN");
    expect(top.snip && top.snip.length).toBeGreaterThan(0);
  });

  it("strips crosslink markup from indexed text and snippets", () => {
    const hits = searchGuide("skyline verdict");
    for (const h of hits) expect(h.snip ?? "").not.toMatch(/\[\[/);
  });

  it("buildGuideIndex is content-complete (every chapter + topic is a document)", () => {
    const ix = buildGuideIndex();
    const want = GUIDE_CHAPTERS.reduce((n, c) => n + 1 + c.topics.length, 0);
    expect(ix.docs.length).toBe(want);
  });
});
