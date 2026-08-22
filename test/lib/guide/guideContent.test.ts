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

/**
 * EVERY user-visible guide string. Widened 2026-08-22g (guide finalization G-A): the original
 * walk covered lead / body / tip / steps / captions only, leaving 150 rendered strings —
 * chapter titles, topic titles, both `where` lines and the 10 goal phrases — with ZERO voice
 * enforcement. They are printed on all three surfaces like any other copy, and the goal
 * phrases are the first words a new reader ever sees. Search aliases (`keys`) ride along too:
 * they are not rendered, but they ARE authored prose and drift the same way.
 */
function allCopy(): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  for (const g of GUIDE_GOALS) out.push({ at: `goal[${g.target}]`, text: g.goal });
  for (const ch of GUIDE_CHAPTERS) {
    out.push({ at: `${ch.id}.title`, text: ch.title });
    out.push({ at: `${ch.id}.lead`, text: ch.lead });
    if (ch.media?.caption) out.push({ at: `${ch.id}.media`, text: ch.media.caption });
    for (const t of ch.topics) {
      out.push({ at: `${t.id}.title`, text: t.title });
      if (t.where?.desktop) out.push({ at: `${t.id}.where.desktop`, text: t.where.desktop });
      if (t.where?.mobile) out.push({ at: `${t.id}.where.mobile`, text: t.where.mobile });
      if (t.body) out.push({ at: `${t.id}.body`, text: t.body });
      for (const [i, l] of (t.list ?? []).entries()) out.push({ at: `${t.id}.list[${i}]`, text: l });
      if (t.tip) out.push({ at: `${t.id}.tip`, text: t.tip });
      for (const [i, s] of (t.steps ?? []).entries()) out.push({ at: `${t.id}.steps[${i}]`, text: s });
      for (const [i, k] of (t.keys ?? []).entries()) out.push({ at: `${t.id}.keys[${i}]`, text: k });
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

  it("every topic teaches something (body, list, steps or media)", () => {
    for (const ch of GUIDE_CHAPTERS)
      for (const t of ch.topics)
        expect(Boolean(t.body || t.list?.length || t.steps?.length || t.media?.length), t.id).toBe(true);
  });

  it("a list is never used where an ordered procedure belongs", () => {
    // `list` renders <ul> and `steps` renders <ol>. A topic carrying BOTH is fine (deck
    // toggles + how to use them); what must never happen is a list whose items are numbered
    // prose, which would silently re-introduce the order an <ul> denies.
    for (const ch of GUIDE_CHAPTERS)
      for (const t of ch.topics)
        for (const l of t.list ?? [])
          expect(/^\s*(step\s)?\d+[.)]/i.test(l), `${t.id}: list item reads as a numbered step`).toBe(false);
  });

  it("every goal route starts at its own target and resolves throughout", () => {
    for (const g of GUIDE_GOALS) {
      if (!g.route) continue;
      expect(g.route[0], `goal "${g.goal}" route[0]`).toBe(g.target);
      expect(g.route.length, `goal "${g.goal}" route length`).toBeGreaterThanOrEqual(3);
      expect(g.route.length, `goal "${g.goal}" route length`).toBeLessThanOrEqual(5);
      for (const id of g.route)
        expect(GUIDE_INDEX.has(id), `goal "${g.goal}" → unknown route step ${id}`).toBe(true);
      expect(new Set(g.route).size, `goal "${g.goal}" repeats a step`).toBe(g.route.length);
    }
    // Zero-result validation — an unrouted GUIDE_GOALS must not pass this vacuously.
    expect(GUIDE_GOALS.every((g) => g.route)).toBe(true);
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

/**
 * Intrinsic size straight out of the WebP header — all three container flavours, because a
 * future re-shoot may not stay lossy. Returns null for anything that is not a WebP.
 * (RIFF····WEBP + a fourcc: "VP8 " lossy · "VP8L" lossless · "VP8X" extended.)
 */
function webpSize(file: string): { w: number; h: number } | null {
  const b = readFileSync(file);
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") {
    const u24 = (at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
    return { w: u24(24) + 1, h: u24(27) + 1 };
  }
  return null;
}

describe("guide media", () => {
  it("every image exists under public/", () => {
    for (const m of allMedia())
      expect(existsSync(join(ROOT, "public", m.src)), `missing ${m.src}`).toBe(true);
  });

  it("every image declares its real on-disk size", () => {
    // The layout-shift half of the reserve-the-box fix, and the anti-drift half of a
    // re-shoot: a new crop that changes the file's dimensions turns this red instead of
    // silently mis-reserving space on all three surfaces.
    let checked = 0;
    for (const m of allMedia()) {
      const real = webpSize(join(ROOT, "public", m.src));
      expect(real, `${m.src}: unreadable webp header`).not.toBeNull();
      expect({ src: m.src, w: m.w, h: m.h }).toEqual({ src: m.src, w: real!.w, h: real!.h });
      checked += 1;
    }
    // Zero-result validation — an emptied allMedia() must not pass as "all sizes correct".
    expect(checked).toBe(13);
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

    // ————— the anti-slop pass (G-H 2026-08-22g) —————
    // Sources: hardikpandya/stop-slop + ayghri/i-have-adhd, applied JUDICIOUSLY on the owner's
    // order. MEASURED before adopting: 97 of ~120 stop-slop patterns score ZERO hits — the
    // guide already reads the way that skill is trying to produce. So these four groups are a
    // REGRESSION GUARD, not a cleanup: they are the tells an LLM writes back in when told to
    // "enrich" a doc. The rules that were REJECTED, with counts, are in
    // GUIDE_FINALIZATION_PLAN.md §3.3 — em dashes (652 here, 4,647 across src/), three-item
    // lists (every third item is a real thing on screen), -ly precision words, `never` (the C6
    // privacy guarantee) and "quotables" (which is the `tip` field's entire job).

    // Throat-clearing openers, meta-commentary and rhetorical setups — the essayist half the
    // marketing lint above never reached.
    /here'?s (the thing|what|this|that|why)|the uncomfortable truth|it turns out|let me be clear|let that sink in|make no mistake|this matters because|plot twist|spoiler:|as we'?ll see|let me walk you through|in this (section|chapter),? we'?ll|think about it|and that'?s okay|at its core|at the end of the day|when it comes to|in a world where|the reality is/i,

    // Business jargon, NARROWED. "navigate", "landscape", "moving forward" and "take a step
    // back" are DELIBERATELY absent — they are literal verbs in a walkable 3D globe
    // ("Stand in the landscape with LOOK FROM HERE").
    /\b(unpack|lean into|game-?changer|double down|deep dive|circle back|on the same page)\b/i,

    // The 15 NAMED intensifiers only — never the blanket -ly rule.
    /\b(really|literally|genuinely|honestly|actually|deeply|truly|fundamentally|inherently|inevitably|interestingly|importantly|crucially)\b/i,

    // Chat-assistant openers and closers, and the tangent sidebar. A document has no turns.
    /\b(great question|sure!|looking at your|to answer your question|hope this helps|happy to clarify|feel free to ask|by the way|keep in mind)\b/i,
  ];

  it("the lint actually walks every rendered field", () => {
    // Zero-result validation for the LINT ITSELF: a silently-narrowed allCopy() would leave
    // this suite green while enforcing nothing. Pin that each field class is represented.
    const at = allCopy().map((c) => c.at);
    for (const suffix of [".title", ".lead", ".body", ".tip", ".steps[0]", ".where.desktop", ".where.mobile", ".media"])
      expect(at.some((a) => a.endsWith(suffix)), `no ${suffix} in the lint corpus`).toBe(true);
    expect(at.some((a) => a.startsWith("goal[")), "no goal phrases in the lint corpus").toBe(true);
    // 294 strings as of the G-A widening (144 were walked before it).
    expect(allCopy().length).toBeGreaterThan(280);
  });

  it("copy carries no slop phrases", () => {
    for (const { at, text } of allCopy())
      for (const re of BANNED)
        expect(re.test(text), `${at}: "${text.match(re)?.[0]}" (${re})`).toBe(false);
  });

  it("every step is ONE bounded action", () => {
    // i-have-adhd Rule 2, the single place the guide was genuinely non-compliant: 12 of 43
    // shipped steps packed two or three actions into one numbered line ("Drag to orbit.
    // Scroll or pinch to zoom."), which is precisely what a numbered list promises not to do.
    // Landed AFTER the splits — as a lint written first it would have failed on day one.
    // Note the cap interaction: steps are 1..6, so a topic at 6 cannot absorb a split. The
    // fix there is `list` (unordered, uncapped), not a seventh step — `mobile-gestures` moved
    // wholesale because its "steps" were never sequential in the first place.
    for (const ch of GUIDE_CHAPTERS)
      for (const t of ch.topics)
        for (const [i, s] of (t.steps ?? []).entries()) {
          const at = `${t.id}.steps[${i}]`;
          // A sentence terminator with more sentence after it = a second action.
          expect(/[.!?]\s+\S/.test(s), `${at}: two sentences — "${s}"`).toBe(false);
          expect(/\band then\b.*\band then\b/i.test(s), `${at}: chained "and then"`).toBe(false);
        }
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
