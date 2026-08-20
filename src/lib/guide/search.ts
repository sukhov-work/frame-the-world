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

/** Crosslink grammar [[id]] / [[id|label]] → searchable label text. */
function stripInline(s: string): string {
  return s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id: string, label?: string) => label ?? id);
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
  /** Plain prose (body + steps + tip) for snippet extraction. */
  prose: string;
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
  addTerms(tf, t.where?.desktop, 2);
  addTerms(tf, t.where?.mobile, 2);
  addTerms(tf, t.tip, 1.5);
  for (const s of t.steps ?? []) addTerms(tf, s, 1);
  addTerms(tf, t.body, 1);
  // The chapter title rides along faintly — "mobile joystick" should reach STAND IN IT's
  // twin topics filed under THE PHONE SHELL.
  addTerms(tf, c.title, 0.5);
  const prose = [t.body, ...(t.steps ?? []), t.tip].filter(Boolean).map((s) => stripInline(s as string)).join(" ");
  return {
    id: t.id, kind: "topic", title: t.title, chapterId: c.id, chapterTitle: c.title,
    tf, len: [...tf.values()].reduce((a, b) => a + b, 0), prose,
  };
}

function chapterDoc(c: GuideChapter): Doc {
  const tf = new Map<string, number>();
  addTerms(tf, c.title, 3.5);
  addTerms(tf, c.lead, 1);
  return {
    id: c.id, kind: "chapter", title: c.title, chapterId: c.id, chapterTitle: c.title,
    tf, len: [...tf.values()].reduce((a, b) => a + b, 0), prose: stripInline(c.lead),
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

/** One query token → vocabulary terms it may stand for, best-first, capped. */
function expandToken(tok: string, index: GuideIndex): Array<{ term: string; w: number }> {
  const out: Array<{ term: string; w: number }> = [];
  const dMax = tok.length >= 7 ? 2 : tok.length >= 4 ? 1 : 0;
  for (const term of index.postings.keys()) {
    if (term === tok) {
      out.push({ term, w: 1 });
    } else if (term.startsWith(tok)) {
      // Longer coverage of the term = stronger evidence ("met" → METEORS beats "me…").
      out.push({ term, w: 0.6 + 0.35 * (tok.length / term.length) });
    } else if (dMax > 0) {
      const d = editDistance(tok, term, dMax);
      if (d <= dMax) out.push({ term, w: d === 1 ? 0.55 : 0.35 });
    }
  }
  return out.sort((a, b) => b.w - a.w).slice(0, 8);
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

/** Rank the guide against a query — top `limit` hits, best first; [] for empty/no match. */
export function searchGuide(query: string, limit = 8, index?: GuideIndex): GuideSearchHit[] {
  const ix = index ?? (defaultIndex ??= buildGuideIndex());
  let tokens = [...new Set(tokenize(query))];
  const meaningful = tokens.filter((t) => !STOP.has(t));
  if (meaningful.length > 0) tokens = meaningful;
  if (tokens.length === 0) return [];

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
    .map(([docIx, r]) => ({
      doc: ix.docs[docIx],
      terms: r.terms,
      // Coverage dominates: a doc matching both words of "save view" must beat a doc
      // matching one of them twice as well.
      final: r.score * (0.4 + 0.6 * (r.covered / tokens.length)),
    }))
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
