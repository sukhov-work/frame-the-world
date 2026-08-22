/**
 * GUIDE SEARCH — the golden-query relevance fixture (guide finalization G-A, 2026-08-22g).
 *
 * WHY THIS EXISTS: `guideSearch.test.ts` proves the engine *works* (a title finds its topic,
 * the fuzzy ladder absorbs typos). It does not pin WHICH document wins when several are
 * plausible — and every G-E ranking lever (exact-match bonus, fuzzy floor, prefix minLen,
 * expansion sort, title multiplier) moves exactly that. Landed BEFORE the ranking changes so
 * a relevance regression cannot hide behind a green suite.
 *
 * HOW IT STAYS HONEST: a row that does not yet reach its target carries `today` — its
 * MEASURED current answer, asserted exactly. That makes this a characterization fixture, not
 * a wish list: an unfixed row cannot drift to some third answer silently, and fixing one is a
 * deliberate edit (delete `today`). `pendingCount()` is asserted, so the count can only fall
 * on purpose. When `today` is gone from every row, guide search does what the charter says.
 */
import { describe, expect, it } from "vitest";
import { GUIDE_CHAPTERS, GUIDE_GOALS } from "../../../src/lib/guide/guideContent";
import { searchGuide } from "../../../src/lib/guide/search";

interface GoldenRow {
  /** The query a reader actually types. */
  q: string;
  /** Target id, or several acceptable ones when the "right" answer is genuinely arguable. */
  want: string | string[];
  /** `top1` (default) = must rank first. `top3` = must appear in the first three. */
  mode?: "top1" | "top3";
  /**
   * MEASURED answer while the row is unfixed — `""` means the query returns nothing.
   * Delete it when the slice named in `by` lands. Never add one to silence a regression.
   */
  today?: string;
  /** Which slice of GUIDE_FINALIZATION_PLAN.md is on the hook for it. */
  by: string;
}

/** §4.4 of the charter, measured against the live index 2026-08-22. */
const GOLDEN: GoldenRow[] = [
  { q: "exif", want: "photo-upload", by: "G-E #1+#2" },
  { q: "plan", want: "plan", by: "G-E #2+#5" },
  { q: "STAND IN IT", want: "fpv", by: "G-E #5" },
  { q: "sky", want: "target", by: "G-E #5" },
  { q: "foc", want: "fpv-focal", by: "G-E #4" },
  { q: "aim", want: "move-aimstick", by: "G-E #1" },
  { q: "re-centre", want: "fpv-map-controls", by: "G-E alias" },
  { q: "recentre", want: "fpv-map-controls", by: "G-E alias" },
  { q: "comp", want: ["move-deck", "mobile-chips"], mode: "top3", by: "G-E #4" },
  { q: "FPV", want: "fpv", by: "G-E #6" },
  { q: "mobile", want: "mobile", by: "G-E #6" },
  { q: "goto", want: "target-toggles", by: "G-E #7 + G-C 14" },
  { q: "◉", want: "fpv-map-controls", by: "G-E #8 + alias" },
  { q: "/m", want: "mobile", by: "G-E #8" },
  { q: "my spot", want: "fpv-enter", by: "G-E #5" },
  { q: "explore", want: "start-explore", by: "G-C 15" },
  { q: "keyboard shortcut", want: "keys", by: "G-C 16" },
  // Alias table — every one measured returning [] against the live index.
  { q: "lens", want: "fpv-focal", mode: "top3", by: "G-E alias" },
  { q: "login", want: "save-signin", mode: "top3", by: "G-E alias" },
  { q: "log in", want: "save-signin", mode: "top3", by: "G-E alias" },
  { q: "minimap", want: "move-minimap", mode: "top3", by: "G-E alias" },
  { q: "milkyway", want: "plan-mw", mode: "top3", by: "G-E alias" },
  { q: "shutter", want: "plan-npf", mode: "top3", by: "G-E alias" },
  { q: "ghosting", want: ["target-ghosts", "find-ghosts"], mode: "top3", by: "G-E alias" },
  { q: "android", want: ["mobile", "start-shells"], mode: "top3", by: "G-E alias" },
  { q: "tablet", want: ["mobile", "start-shells"], mode: "top3", by: "G-E alias" },
  { q: "36h", want: "plan-frame", mode: "top3", by: "G-E #8 + alias" },
  // Regression floors — these already pass and must keep passing through every G-E lever.
  { q: "meteor", want: "plan-meteors", by: "SHIPPED" },
  { q: "save view name", want: "save-place", by: "SHIPPED" },
  { q: "radar", want: "target-radar", by: "SHIPPED" },
  { q: "unfollow", want: "target-unfollow", by: "SHIPPED" },
];

/**
 * Queries that must find NOTHING. A guide that answers "refund" is a guide that has started
 * guessing — and the alias table + caption indexing in G-E are exactly the changes that make
 * a corpus start matching noise.
 */
const NEGATIVES = ["qqxxyyzz", "tripod", "refund", "discord"];

/**
 * Derived rows that fail today. G-E must EMPTY this set — it is an allowlist, not a skip:
 * every entry is still asserted to fail, so accidentally fixing one also turns the suite red
 * and forces the removal to be recorded.
 */
const KNOWN_MISSES = new Set<string>();

const pendingCount = (): number => GOLDEN.filter((r) => r.today !== undefined).length;

function topOf(q: string): string {
  return searchGuide(q, 8)[0]?.id ?? "";
}

describe("guide search — curated golden queries", () => {
  for (const row of GOLDEN) {
    const label = `${JSON.stringify(row.q)} → ${[row.want].flat().join(" | ")} [${row.by}]`;
    it(row.today === undefined ? label : `${label} (PENDING: ${row.today || "[]"})`, () => {
      const hits = searchGuide(row.q, 8);
      const top = hits[0]?.id ?? "";
      if (row.today !== undefined) {
        // Characterization: pinned to the MEASURED wrong answer until `by` lands.
        expect(top, `${row.q}: drifted off its measured answer without reaching ${row.want}`).toBe(row.today);
        return;
      }
      const want = [row.want].flat();
      if (row.mode === "top3") {
        const three = hits.slice(0, 3).map((h) => h.id);
        expect(three.some((id) => want.includes(id)), `${row.q} → ${three.join(",") || "[]"}`).toBe(true);
      } else {
        expect(top, `${row.q} → ${hits.slice(0, 3).map((h) => h.id).join(",") || "[]"}`).toBe(want[0]);
      }
    });
  }

  it("records how many golden rows are still unfixed", () => {
    // Falls to 0 when G-C's new topics and G-E's ranking + alias work have landed.
    // Change this number ONLY by deleting a `today` from a row above.
    expect(pendingCount()).toBe(0);
  });

  it("finds nothing for queries the guide does not answer", () => {
    for (const q of NEGATIVES) expect(searchGuide(q), q).toEqual([]);
  });
});

/**
 * ALIAS FENCE. `keys` is the one field a reader never sees, so nothing about it is
 * self-correcting — it is the natural home for keyword stuffing.
 *
 * The charter proposed a LEXICAL fence (every alias must appear in the copy or match a
 * rendered UI string). That was rejected on measurement: it rejects almost the entire useful
 * alias table. `lens`, `shutter`, `login`, `milkyway`, `android`, `tablet` are exactly the
 * queries the aliases exist to answer, and none of them appears in the copy or on screen —
 * a lexical fence would permit only aliases for words that were already findable.
 *
 * The fence here is BEHAVIOURAL instead, which is both stricter and aimed at the real risk:
 * an alias must find its OWN topic, must not be so generic that many topics claim it, and
 * must not resurrect a query the guide is supposed to answer with silence.
 */
describe("guide search — the alias fence", () => {
  const declared: Array<{ id: string; key: string }> = [];
  for (const ch of GUIDE_CHAPTERS)
    for (const t of ch.topics) for (const k of t.keys ?? []) declared.push({ id: t.id, key: k });

  it("every alias actually reaches the topic that declares it", () => {
    const orphans = declared.filter(({ id, key }) => !searchGuide(key, 5).some((h) => h.id === id));
    expect(orphans.map((o) => `${o.id}:"${o.key}"`)).toEqual([]);
  });

  it("no alias is generic filler claimed by many topics", () => {
    const byKey = new Map<string, string[]>();
    for (const { id, key } of declared) byKey.set(key, [...(byKey.get(key) ?? []), id]);
    const shared = [...byKey.entries()].filter(([, ids]) => ids.length > 2);
    expect(shared.map(([k, ids]) => `"${k}" on ${ids.length}: ${ids.join(",")}`)).toEqual([]);
  });

  it("aliases are lower-case search terms, not sentences", () => {
    for (const { id, key } of declared) {
      expect(key, `${id}: "${key}" is not lower-case`).toBe(key.toLowerCase());
      expect(key.split(/\s+/).length, `${id}: "${key}" is a sentence`).toBeLessThanOrEqual(3);
      expect(key.trim().length, `${id}: empty alias`).toBeGreaterThan(1);
    }
  });

  it("aliases never make an unanswerable query answerable", () => {
    for (const q of NEGATIVES) expect(searchGuide(q), q).toEqual([]);
  });

  it("the fence has something to fence", () => {
    // Zero-result validation: an empty `keys` corpus must not pass this block vacuously.
    expect(declared.length).toBeGreaterThan(200);
  });
});

describe("guide search — derived rows (every title and goal phrase)", () => {
  it("every topic title ranks its own topic first", () => {
    const misses: string[] = [];
    for (const ch of GUIDE_CHAPTERS)
      for (const t of ch.topics) if (topOf(t.title) !== t.id) misses.push(t.id);
    expect(misses.filter((id) => !KNOWN_MISSES.has(id))).toEqual([]);
    // Allowlist, not a skip: a known miss that quietly starts passing must be de-listed.
    for (const id of misses) expect(KNOWN_MISSES.has(id), `${id} now passes — remove it`).toBe(true);
  });

  it("every chapter title ranks its own chapter first", () => {
    const misses: string[] = [];
    for (const ch of GUIDE_CHAPTERS) if (topOf(ch.title) !== ch.id) misses.push(ch.id);
    expect(misses.filter((id) => !KNOWN_MISSES.has(id))).toEqual([]);
    for (const id of misses) expect(KNOWN_MISSES.has(id), `${id} now passes — remove it`).toBe(true);
  });

  it("every goal phrase ranks its own target first", () => {
    for (const g of GUIDE_GOALS)
      expect(topOf(g.goal), `goal "${g.goal}"`).toBe(g.target);
  });

  it("KNOWN_MISSES is the exact set G-E has to empty", () => {
    expect([...KNOWN_MISSES]).toEqual([]);
  });
});
