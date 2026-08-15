/**
 * Guide content integrity — the structural half of GUIDE_PLAN's "accuracy is the product"
 * gate (the live-UI match is verified in-browser). Enforces: globally unique ids, resolving
 * crosslinks, on-disk images that are also warmed for prod, step discipline, and a
 * banned-phrase lint so guide copy stays in the instrument voice (guide track 2026-08-15).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GUIDE_CHAPTERS,
  GUIDE_GOALS,
  GUIDE_INDEX,
  type GuideMedia,
} from "../../../src/lib/guide/guideContent";
import { guideLinkTargets, parseGuideInline } from "../../../src/lib/guide/inline";

const ROOT = join(__dirname, "../../..");

function allCopy(): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  for (const ch of GUIDE_CHAPTERS) {
    out.push({ at: `${ch.id}.lead`, text: ch.lead });
    if (ch.media?.caption) out.push({ at: `${ch.id}.media`, text: ch.media.caption });
    for (const t of ch.topics) {
      if (t.body) out.push({ at: `${t.id}.body`, text: t.body });
      if (t.tip) out.push({ at: `${t.id}.tip`, text: t.tip });
      for (const [i, s] of (t.steps ?? []).entries()) out.push({ at: `${t.id}.steps[${i}]`, text: s });
      for (const m of t.media ?? []) if (m.caption) out.push({ at: `${t.id}.media`, text: m.caption });
    }
  }
  return out;
}

function allMedia(): GuideMedia[] {
  const out: GuideMedia[] = [];
  for (const ch of GUIDE_CHAPTERS) {
    if (ch.media) out.push(ch.media);
    for (const t of ch.topics) out.push(...(t.media ?? []));
  }
  return out;
}

describe("guide structure", () => {
  it("has globally unique chapter + topic ids", () => {
    const seen = new Set<string>();
    for (const ch of GUIDE_CHAPTERS) {
      expect(seen.has(ch.id), `duplicate id ${ch.id}`).toBe(false);
      seen.add(ch.id);
      for (const t of ch.topics) {
        expect(seen.has(t.id), `duplicate id ${t.id}`).toBe(false);
        seen.add(t.id);
      }
    }
    expect(GUIDE_INDEX.size).toBe(seen.size);
  });

  it("every chapter has a lead and at least one topic", () => {
    for (const ch of GUIDE_CHAPTERS) {
      expect(ch.lead.length, ch.id).toBeGreaterThan(20);
      expect(ch.topics.length, ch.id).toBeGreaterThan(0);
    }
  });

  it("steps are 1..6 non-empty actions", () => {
    for (const ch of GUIDE_CHAPTERS)
      for (const t of ch.topics)
        if (t.steps) {
          expect(t.steps.length, t.id).toBeGreaterThan(0);
          expect(t.steps.length, t.id).toBeLessThanOrEqual(6);
          for (const s of t.steps) expect(s.trim().length, t.id).toBeGreaterThan(3);
        }
  });

  it("every topic teaches something (body, steps or media)", () => {
    for (const ch of GUIDE_CHAPTERS)
      for (const t of ch.topics)
        expect(Boolean(t.body || t.steps?.length || t.media?.length), t.id).toBe(true);
  });
});

describe("guide crosslinks", () => {
  it("every [[crosslink]] resolves to a chapter or topic id", () => {
    for (const { at, text } of allCopy())
      for (const target of guideLinkTargets(text))
        expect(GUIDE_INDEX.has(target), `${at} links to unknown [[${target}]]`).toBe(true);
  });

  it("every router goal targets a real node", () => {
    for (const g of GUIDE_GOALS)
      expect(GUIDE_INDEX.has(g.target), `goal "${g.goal}" → unknown ${g.target}`).toBe(true);
  });

  it("parser round-trips text and links", () => {
    const runs = parseGuideInline("See [[find|FIND]] and [[plan]] for more.");
    expect(runs).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", target: "find", label: "FIND" },
      { kind: "text", text: " and " },
      { kind: "link", target: "plan", label: undefined },
      { kind: "text", text: " for more." },
    ]);
    expect(parseGuideInline("no links")).toEqual([{ kind: "text", text: "no links" }]);
  });
});

describe("guide media", () => {
  it("every image exists under public/", () => {
    for (const m of allMedia())
      expect(existsSync(join(ROOT, "public", m.src)), `missing ${m.src}`).toBe(true);
  });

  it("every image is in the prod warm list (the 2026-07-16 cold-edge lesson)", () => {
    const warm = readFileSync(join(ROOT, "scripts/warm-prod-assets.mjs"), "utf8");
    for (const m of allMedia()) expect(warm.includes(`"${m.src}"`), `${m.src} not warmed`).toBe(true);
  });
});

describe("guide voice (banned-phrase lint)", () => {
  // The stop-slop subset that is regex-enforceable. Copy that trips one of these reads
  // like filler — rewrite the sentence, don't whitelist the word.
  const BANNED: RegExp[] = [
    /\b(simply|easily|seamlessly|effortlessly|powerful|robust)\b/i,
    /\b(leverage|utilize|delve|streamline|elevate your)\b/i,
    /\bin order to\b/i,
    /\bnote that\b/i,
    /\blet's\b/i,
    /\bit'?s worth\b/i,
  ];

  it("copy carries no slop phrases", () => {
    for (const { at, text } of allCopy())
      for (const re of BANNED)
        expect(re.test(text), `${at}: "${text.match(re)?.[0]}" (${re})`).toBe(false);
  });

  it("copy stays compact (bodies under 5 sentences, tips one sentence)", () => {
    for (const ch of GUIDE_CHAPTERS)
      for (const t of ch.topics) {
        if (t.body) {
          const sentences = t.body.split(/[.!?](?:\s|$)/).filter((s) => s.trim().length > 0);
          expect(sentences.length, `${t.id}.body runs long`).toBeLessThanOrEqual(5);
        }
        if (t.tip) expect(t.tip.length, `${t.id}.tip runs long`).toBeLessThanOrEqual(220);
      }
  });
});
