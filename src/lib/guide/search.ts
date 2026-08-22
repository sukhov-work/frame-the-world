/**
 * GUIDE search — embedded BM25 with the sky-search fuzzy ladder (owner order 2026-08-19:
 * "efficient and fuzzy" so complex features stay findable). Pure and DOM-free; both shells
 * (Guide.tsx rail + GuideSheet index view) render the same ranked hits.
 *
 * Shape: every topic and chapter becomes one BM25 document with field-weighted term
 * frequencies (title > where > tip > steps/body); GUIDE_GOALS phrases index onto their
 * router target so "share a view" finds the save chapter in the user's own words. Query
 * tokens expand against the vocabulary exact → prefix → Damerau-Levenshtein ≤2 (reusing
 * `normalizeSky`/`editDistance` — one edit-distance implementation in the codebase), so
 * "metors", "buldings" or "trakcing" still land. Multi-token queries prefer documents
 * covering more of the query.
 */

import { editDistance, normalizeSky } from "../sky/searchIndex";
import {
  GUIDE_CHAPTERS,
  GUIDE_GOALS,
  GUIDE_INDEX,
  type GuideChapter,
  type GuideGoal,
  type GuideTopic,
} from "./guideContent";

export interface GuideSearchHit {
  /** Navigable id — feed to the renderers' nav() (topic id or chapter id). */
  id: string;
  kind: "topic" | "chapter";
  title: string;
  chapterId: string;
  chapterTitle: string;
  /** Short matched-context line (body/steps/tip text around the first query hit). */
  snip?: string;
}

/** Query-side stopwords — dropped only when other tokens remain (BM25 IDF already
 *  downweights them doc-side; dropping avoids prefix-exploding "the" → "then/there/…"). */
const STOP = new Set([
  "the", "a", "an", "and", "of", "to", "in", "on", "at", "it", "is", "are",
  "i", "my", "your", "for", "with", "want", "how", "do", "does", "when",
]);

/**
 * Crosslink grammar [[id]] / [[id|label]] → searchable text.
 *
 * A BARE `[[fpv]]` resolves to the target's TITLE, exactly as all three renderers do
 * (Guide.tsx, GuideSheet.tsx, guide.astro each fall back to `GUIDE_INDEX.get(id).title`).
 * Search used to be the only consumer that did not, so it indexed the raw id: the literal
 * string "FPV" appears nowhere in the module, and `postings.get("fpv")` held ONE document.
 * Feeding the rendered words in is a cross-surface parity fix, not a ranking tweak.
 */
function stripInline(s: string): string {
  return s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id: string, label?: string) => {
    if (label) return label;
    return GUIDE_INDEX.get(id)?.title ?? id;
  });
}

/**
 * Glyph → word, QUERY-SIDE only. The instrument labels a dozen controls with a glyph and no
 * text (`◉` is `aria-label="Centre the map on me"`), so a reader who types what they see used
 * to get nothing at all. Applied to the query, never to the corpus, so snippets keep printing
 * the glyph the reader is looking at. Lives here and not in `sky/searchIndex.ts` — that map is
 * the sky finder's Greek normalization and must not learn about UI chrome.
 */
const GLYPH_WORDS: Record<string, string> = {
  "◉": "centre map follow",
  "◎": "look from here save place",
  "∠": "radar direction",
  "⌖": "track find in frame photo pins",
  "▲": "3d",
  "▼": "2d",
  "▤": "vector saved places",
  "⊞": "layers",
  "▦": "3d detail buildings",
  "✕": "clear exit close",
  "☀": "sun",
  "☾": "moon",
  "☄": "comet",
  "◌": "mark",
  "∿": "trail",
  "✧": "ghosts",
  "⊕": "tracking",
  "🧭": "my loc location compass",
  "⤒": "rise ascend",
  "⤓": "sink descend",
  "▶": "play",
  "◢": "resize",
  "★": "supermoon",
};

/**
 * Query-only rewrites for tokens the tokenizer would otherwise destroy. `/m` and `36h` both
 * survive `normalizeSky` as unusable fragments; the shell path and the card title are what the
 * reader means. Applied before tokenizing.
 */
const QUERY_ALIASES: Array<[RegExp, string]> = [
  [/(^|\s)\/m(\s|$)/gi, " mobile phone shell "],
  [/\b36\s?h(ours)?\b/gi, " 36 h this frame next "],
  [/\b2d\b/gi, " 2d flat chart "],
  [/\b3d\b/gi, " 3d globe "],
];

/** Expand glyphs and shell shorthand in a QUERY before it is tokenized. */
function expandQuery(q: string): string {
  let out = q;
  for (const [ch, words] of Object.entries(GLYPH_WORDS))
    if (out.includes(ch)) out = `${out} ${words}`;
  for (const [re, words] of QUERY_ALIASES) out = out.replace(re, words);
  return out;
}

function tokenize(s: string): string[] {
  return normalizeSky(stripInline(s)).split(" ").filter((t) => t.length >= 2);
}

interface Doc {
  id: string;
  kind: "topic" | "chapter";
  title: string;
  chapterId: string;
  chapterTitle: string;
  /** Field-weighted term frequency. */
  tf: Map<string, number>;
  /** Weighted length (Σ tf) — the BM25 length normalizer. */
  len: number;
  /** Plain prose (body + list + steps + tip) for snippet extraction. */
  prose: string;
  /**
   * Every indexed string, normalized and joined — used ONLY to test whether the reader's
   * query appears verbatim as a phrase. BM25 is a bag of words and cannot see "my spot" as
   * one thing; that string is a rendered nav label, so a document containing it literally is
   * a better answer than one that merely scores well on "spot".
   */
  flat: string;
}

interface GuideIndex {
  docs: Doc[];
  /** term → docIx[] (postings) — the IDF source. */
  postings: Map<string, number[]>;
  avgLen: number;
}

function addTerms(tf: Map<string, number>, text: string | undefined, weight: number): void {
  if (!text) return;
  for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + weight);
}

function topicDoc(c: GuideChapter, t: GuideTopic): Doc {
  const tf = new Map<string, number>();
  addTerms(tf, t.title, 3.5);
  // The ID is real vocabulary, not a slug: `fpv`, `mobile`, `find`, `plan` are what readers
  // type and what every crosslink and deep link already uses. It has to be indexed HERE,
  // because stripInline now resolves a bare `[[fpv]]` to its rendered title — which is the
  // correct parity behaviour and which removed the literal token "fpv" from the corpus
  // entirely (the chapter is titled STAND IN IT). Indexing the id puts the word back on the
  // document that OWNS it rather than on every document that happens to link to it.
  addTerms(tf, t.id.replace(/-/g, " "), 2.5);
  addTerms(tf, t.where?.desktop, 2);
  addTerms(tf, t.where?.mobile, 2);
  // Aliases sit between `tip` and `steps`: strong enough that the ONE word a reader knows
  // wins, too weak to outrank a topic's own title. Deliberately NOT folded into `prose`, so
  // a snippet never quotes a word that does not appear in the copy.
  for (const k of t.keys ?? []) addTerms(tf, k, 1.25);
  addTerms(tf, t.tip, 1.5);
  for (const s of t.steps ?? []) addTerms(tf, s, 1);
  for (const l of t.list ?? []) addTerms(tf, l, 1);
  addTerms(tf, t.body, 1);
  // Captions are the most literal UI-label text in the corpus and were never indexed at all
  // ("pads", "credit", "portrait" had empty postings). Below body weight — a caption describes
  // a picture of the thing, not the thing.
  for (const m of t.media ?? []) addTerms(tf, m.caption, 0.75);
  // The chapter title rides along faintly — "mobile joystick" should reach STAND IN IT's
  // twin topics filed under THE PHONE SHELL.
  addTerms(tf, c.title, 0.5);
  const prose = [t.body, ...(t.list ?? []), ...(t.steps ?? []), t.tip]
    .filter(Boolean)
    .map((s) => stripInline(s as string))
    .join(" ");
  const flat = normalizeSky(
    [t.title, t.id.replace(/-/g, " "), t.where?.desktop, t.where?.mobile, ...(t.keys ?? []),
      prose, ...(t.media ?? []).map((m) => m.caption)].filter(Boolean).join(" "),
  );
  return {
    id: t.id, kind: "topic", title: t.title, chapterId: c.id, chapterTitle: c.title,
    tf, len: [...tf.values()].reduce((a, b) => a + b, 0), prose, flat,
  };
}

function chapterDoc(c: GuideChapter): Doc {
  const tf = new Map<string, number>();
  addTerms(tf, c.title, 3.5);
  addTerms(tf, c.id.replace(/-/g, " "), 2.5); // see topicDoc — "FPV" lives here, not in the title
  addTerms(tf, c.lead, 1);
  // The chapter caption too — GOTO is named ONLY in the target chapter's caption, so the
  // topic-level loop alone would not have found it.
  addTerms(tf, c.media?.caption, 0.75);
  const prose = stripInline(c.lead);
  return {
    id: c.id, kind: "chapter", title: c.title, chapterId: c.id, chapterTitle: c.title,
    tf, len: [...tf.values()].reduce((a, b) => a + b, 0), prose,
    flat: normalizeSky([c.title, c.id.replace(/-/g, " "), prose, c.media?.caption].filter(Boolean).join(" ")),
  };
}

/** Goal phrases index onto their target document — the user's own wording as extra keys. */
function foldGoals(docs: Doc[], goals: readonly GuideGoal[]): void {
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const g of goals) {
    const d = byId.get(g.target);
    if (!d) continue;
    for (const t of tokenize(g.goal)) d.tf.set(t, (d.tf.get(t) ?? 0) + 1.5);
    d.len = [...d.tf.values()].reduce((a, b) => a + b, 0);
  }
}

export function buildGuideIndex(
  chapters: readonly GuideChapter[] = GUIDE_CHAPTERS,
  goals: readonly GuideGoal[] = GUIDE_GOALS,
): GuideIndex {
  const docs: Doc[] = [];
  for (const c of chapters) {
    docs.push(chapterDoc(c));
    for (const t of c.topics) docs.push(topicDoc(c, t));
  }
  foldGoals(docs, goals);
  const postings = new Map<string, number[]>();
  docs.forEach((d, ix) => {
    for (const term of d.tf.keys()) {
      const p = postings.get(term);
      if (p) p.push(ix);
      else postings.set(term, [ix]);
    }
  });
  const avgLen = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length);
  return { docs, postings, avgLen };
}

// Content is a static import — one shared index, built on first search (never in boot).
let defaultIndex: GuideIndex | null = null;

const K1 = 1.4;
const B = 0.6;

/**
 * Two-character exact vocabulary that must survive the prefix floor below — these are real
 * things a reader types, not fragments (`3d`, `1y`, `36`…). An EXACT match is never gated;
 * this set exists so the intent is documented rather than implied.
 */
const SHORT_EXACT = new Set(["3d", "2d", "1w", "1m", "6m", "1y", "80", "75", "36", "30", "24", "18"]);

/** Per-tier expansion caps — see expandToken. */
const MAX_PREFIX = 16;
const MAX_FUZZY = 5;

/**
 * One query token → vocabulary terms it may stand for, best-first, capped PER TIER.
 *
 * Three deliberate constraints, each measured (charter §4.2):
 *  · fuzzy needs 5 chars for d=1 (was 4). At 4 chars a single edit is not a typo, it is a
 *    different word: "exif" reached `fpv-exit` through "exit" and outranked the upload topic.
 *  · prefixes need 3 chars. `expandToken("re")` used to yield re/red/real/read/reads/reset/…,
 *    which is why "re-centre" returned `target-search`.
 *  · the old single `.slice(0, 8)` ranked by weight, and weight rewards SHORT terms — so "co"
 *    kept come/cone/copy/core and DROPPED compass, controls, constellation. Ranking each tier
 *    by `w × idf` keeps the rare, discriminating term instead of the short one, and capping
 *    per tier stops a flood of prefixes from starving the fuzzy tier (or the reverse).
 */
function expandToken(tok: string, index: GuideIndex): Array<{ term: string; w: number }> {
  const exact: Array<{ term: string; w: number }> = [];
  const prefix: Array<{ term: string; w: number }> = [];
  const fuzzy: Array<{ term: string; w: number }> = [];
  const dMax = tok.length >= 7 ? 2 : tok.length >= 5 ? 1 : 0;
  const allowPrefix = tok.length >= 3;
  for (const term of index.postings.keys()) {
    if (term === tok) {
      exact.push({ term, w: 1 });
    } else if (allowPrefix && term.startsWith(tok)) {
      // Longer coverage of the term = stronger evidence ("met" → METEORS beats "me…").
      prefix.push({ term, w: 0.6 + 0.35 * (tok.length / term.length) });
    } else if (dMax > 0) {
      const d = editDistance(tok, term, dMax);
      if (d <= dMax) fuzzy.push({ term, w: d === 1 ? 0.55 : 0.35 });
    }
  }
  if (SHORT_EXACT.has(tok) && exact.length === 0 && prefix.length === 0) {
    // A pinned short token with no exact posting still deserves its prefixes.
    for (const term of index.postings.keys())
      if (term.startsWith(tok)) prefix.push({ term, w: 0.6 + 0.35 * (tok.length / term.length) });
  }
  const byEvidence = (a: { term: string; w: number }, b: { term: string; w: number }) =>
    b.w * idf(index, b.term) - a.w * idf(index, a.term);
  return [
    ...exact,
    ...prefix.sort(byEvidence).slice(0, MAX_PREFIX),
    ...fuzzy.sort(byEvidence).slice(0, MAX_FUZZY),
  ];
}

function idf(index: GuideIndex, term: string): number {
  const n = index.postings.get(term)?.length ?? 0;
  const N = index.docs.length;
  return Math.log(1 + (N - n + 0.5) / (n + 0.5));
}

function bm25(index: GuideIndex, doc: Doc, term: string): number {
  const tf = doc.tf.get(term) ?? 0;
  if (tf === 0) return 0;
  return (idf(index, term) * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.len) / index.avgLen));
}

/** ~90-char window of prose around the first hit of any matched term (word-boundary cut). */
function snipFor(doc: Doc, terms: readonly string[]): string | undefined {
  const prose = doc.prose;
  if (!prose) return undefined;
  const low = normalizeSky(prose);
  let at = -1;
  for (const t of terms) {
    const ix = low.indexOf(t);
    if (ix >= 0 && (at < 0 || ix < at)) at = ix;
  }
  if (at < 0) return prose.length > 90 ? `${prose.slice(0, 88).replace(/\s+\S*$/, "")}…` : prose;
  // normalizeSky preserves rough character alignment (case/punct → space) — good enough to
  // centre a window; exactness doesn't matter for an orientation snippet.
  const from = Math.max(0, at - 30);
  const to = Math.min(prose.length, at + 60);
  let s = prose.slice(from, to);
  if (from > 0) s = `…${s.replace(/^\S*\s+/, "")}`;
  if (to < prose.length) s = `${s.replace(/\s+\S*$/, "")}…`;
  return s;
}

/**
 * Ranking constants, chosen ONCE against the golden fixture
 * (test/lib/guide/guideSearchGolden.test.ts). Do not tune one in isolation: EXACT_BONUS and
 * TITLE_MULT pull `plan` in opposite directions (toward `plan-open` and toward the PLAN
 * chapter respectively), which is exactly why the fixture exists.
 */
/** Rewards covering the query with terms the reader literally typed. */
const EXACT_BONUS = 0.35;
/**
 * Title match, in three tiers — a document whose title the reader has effectively typed is
 * almost always the answer, but "effectively typed" has degrees:
 *  · EXACT  — the query IS the title ("plan" → the PLAN chapter, "STAND IN IT" → fpv).
 *  · PHRASE — a multi-word query sits inside the title. Measured at 1.6 the chapter
 *    "STAND IN IT" only reached rank 2, so 2.0.
 *  · WORD   — a single token is a whole word of the title ("aim" → "The AIM stick"). Small
 *    on purpose: it must outrank an incidental `where`-line mention without letting one long
 *    title hijack every one-word search.
 */
const TITLE_EXACT = 3.0;
const TITLE_PHRASE = 2.0;
const TITLE_WORD = 1.5;
/**
 * The title's FIRST word. For a one-word query the broader node is usually the better
 * landing, and "does the title lead with it" separates the chapter SKY TARGETS from the
 * topic "Names in the sky" without hard-coding either.
 */
const TITLE_LEAD = 2.0;
/**
 * The reader typed the node's own id — `fpv`, `mobile`, `plan`. These are the identifiers
 * every crosslink and deep link uses, so an exact hit is as intentional as typing the title.
 * Needed because the ids that matter most name chapters whose TITLE is something else
 * entirely (id `fpv` is titled STAND IN IT).
 */
const ID_EXACT = 2.5;
/**
 * A partly-typed word that is a prefix of a TITLE or ID word. This is the while-typing case,
 * and it corrects a genuine IDF distortion at N=78: "foc" expands to both `focal` and
 * `focus`, and `focus` is rarer — it occurs once, incidentally, in the sentence "the field
 * takes focus" — so IDF alone ranked the search topic above "Set the focal length" even
 * though `focal` carries that topic's title AND its id. Where a term SITS is evidence that
 * document frequency cannot see.
 */
const TITLE_PREFIX = 1.35;
/** The whole multi-word query appearing verbatim somewhere in the document. */
const PHRASE_ANY = 1.4;

/**
 * Split `text` into hit / non-hit segments for the query — the data behind `<mark>` in both
 * shells. Pure and DOM-free, so the two renderers highlight identically without sharing a
 * component across the mobile fence.
 *
 * Matches on the RAW typed tokens only, never on fuzzy or prefix expansions: highlighting a
 * word the reader did not type reads as a bug, and an alias is never in the visible text.
 */
export function markSegments(text: string, query: string): Array<{ t: string; hit: boolean }> {
  const toks = [...new Set(tokenize(query))].filter((t) => !STOP.has(t) && t.length >= 2);
  if (toks.length === 0 || !text) return [{ t: text, hit: false }];
  const re = new RegExp(`(${toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const out: Array<{ t: string; hit: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: text.slice(last, at), hit: false });
    out.push({ t: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), hit: false });
  return out.length > 0 ? out : [{ t: text, hit: false }];
}

/**
 * Keep a result list from becoming one chapter's table of contents. Applied AFTER ranking, so
 * the best hit in every chapter survives — a pre-rank cap would drop `fpv-map-controls`, which
 * is the answer to half the alias queries, because the FPV chapter fills 5 of 8 rows for "map".
 */
export function capPerChapter(hits: readonly GuideSearchHit[], max = 3): GuideSearchHit[] {
  const seen = new Map<string, number>();
  const out: GuideSearchHit[] = [];
  for (const h of hits) {
    const n = seen.get(h.chapterId) ?? 0;
    if (n >= max) continue;
    seen.set(h.chapterId, n + 1);
    out.push(h);
  }
  return out;
}

/** Rank the guide against a query — top `limit` hits, best first; [] for empty/no match. */
export function searchGuide(query: string, limit = 8, index?: GuideIndex): GuideSearchHit[] {
  const ix = index ?? (defaultIndex ??= buildGuideIndex());
  const raw = normalizeSky(query);
  let tokens = [...new Set(tokenize(expandQuery(query)))];
  const meaningful = tokens.filter((t) => !STOP.has(t));
  if (meaningful.length > 0) tokens = meaningful;
  if (tokens.length === 0) return [];
  const typed = new Set(tokenize(query));

  const scores = new Map<number, { score: number; covered: number; terms: string[] }>();
  for (const tok of tokens) {
    // Per (token, doc): best single expansion only — "moon"→moon and "moon"→moonlight must
    // not double-count one underlying concept.
    const bestForDoc = new Map<number, { s: number; term: string }>();
    for (const { term, w } of expandToken(tok, ix)) {
      for (const docIx of ix.postings.get(term) ?? []) {
        const s = w * bm25(ix, ix.docs[docIx], term);
        const cur = bestForDoc.get(docIx);
        if (!cur || s > cur.s) bestForDoc.set(docIx, { s, term });
      }
    }
    for (const [docIx, { s, term }] of bestForDoc) {
      const row = scores.get(docIx) ?? { score: 0, covered: 0, terms: [] };
      row.score += s;
      row.covered += 1;
      row.terms.push(term);
      scores.set(docIx, row);
    }
  }

  return [...scores.entries()]
    .map(([docIx, r]) => {
      const doc = ix.docs[docIx];
      // Coverage dominates: a doc matching both words of "save view" must beat a doc
      // matching one of them twice as well.
      let final = r.score * (0.4 + 0.6 * (r.covered / tokens.length));
      // Exact-match bonus. Honest limit: this is a no-op wherever EVERY competing document
      // carries the term, so it cannot rescue a query like "sky" on its own.
      const exact = r.terms.filter((t) => typed.has(t)).length;
      if (exact > 0) final *= 1 + EXACT_BONUS * (exact / tokens.length);
      // Identity match — the STRONGEST tier that applies wins; they never compound.
      const title = normalizeSky(doc.title);
      const words = title.split(" ");
      let boost = 1;
      if (raw.length >= 2 && title === raw) boost = TITLE_EXACT;
      else if (raw.length >= 2 && normalizeSky(doc.id) === raw) boost = ID_EXACT;
      else if (typed.size >= 2 && raw.length >= 3 && title.includes(raw)) boost = TITLE_PHRASE;
      else if (typed.size === 1 && raw.length >= 2 && words[0] === raw) boost = TITLE_LEAD;
      else if (typed.size === 1 && raw.length >= 2 && words.includes(raw)) boost = TITLE_WORD;
      else if (typed.size >= 2 && raw.length >= 4 && doc.flat.includes(raw)) boost = PHRASE_ANY;
      else if (
        typed.size === 1 &&
        raw.length >= 3 &&
        [...words, ...normalizeSky(doc.id).split(" ")].some((w) => w !== raw && w.startsWith(raw))
      )
        boost = TITLE_PREFIX;
      final *= boost;
      return { doc, terms: r.terms, final };
    })
    .sort((a, b) => b.final - a.final)
    .slice(0, limit)
    .map(({ doc, terms }) => ({
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      chapterId: doc.chapterId,
      chapterTitle: doc.chapterTitle,
      snip: doc.kind === "topic" ? snipFor(doc, terms) : undefined,
    }));
}
