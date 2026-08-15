/**
 * Guide inline grammar — the one piece of markup guideContent.ts strings may carry:
 * `[[target-id]]` or `[[target-id|Shown label]]` crosslinks between guide chapters/topics.
 * Both shells parse with this module so a link renders identically on `/` and `/m`
 * (the two-shell single-content rule, GUIDE_PLAN 2026-08-15). No other markup exists —
 * bold/italic/HTML in guide copy is a content bug, not a renderer feature.
 */

export interface GuideTextRun {
  kind: "text";
  text: string;
}

export interface GuideLinkRun {
  kind: "link";
  /** Chapter or topic id the link jumps to (validated by guideContent.test.ts). */
  target: string;
  /** Visible label; defaults to the target's own title at render time when omitted. */
  label?: string;
}

export type GuideRun = GuideTextRun | GuideLinkRun;

const LINK_RE = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g;

/** Split a guide copy string into text/link runs. Plain text yields one run. */
export function parseGuideInline(text: string): GuideRun[] {
  const runs: GuideRun[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > last) runs.push({ kind: "text", text: text.slice(last, at) });
    runs.push({ kind: "link", target: m[1], label: m[2] });
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ kind: "text", text: text.slice(last) });
  return runs;
}

/** Every crosslink target mentioned in a string — the content-integrity test walks these. */
export function guideLinkTargets(text: string): string[] {
  return [...text.matchAll(LINK_RE)].map((m) => m[1]);
}
