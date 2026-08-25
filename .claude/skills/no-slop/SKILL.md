---
name: no-slop
description: Slop gate for AI-written prose — reports, designs, KB articles, PR descriptions, chat answers. Use before presenting or publishing any prose deliverable, or when asked to "de-slop", "humanize", "tighten this", "make this readable", "review this doc for AI slop", or when a reader says output is padded, cryptic, or exhausting. Two modes: pass (rewrite your own draft) and detect (review someone else's — name patterns, quote lines, never output an AI-probability score).
---

# no-slop — the reader's attention is the budget

Slop is text whose cost of reading exceeds its content. It has two opposite forms, and
fixing one by dialing toward the other produces the other:

- **Padding slop** — throat-clearing, recaps, hype, hedging bloat, three bullets that say
  one thing. The 2024 disease. Reader cost: wading.
- **Compression slop** — clipped fragments, coined jargon ("the unlock", "load-bearing",
  "the seam"), referents never introduced ("the fix", "the tail"), a phrase standing in for
  a thought. The 2026 disease. Reader cost: deciphering.

One test governs both: **every sentence states one thing the reader needs, plainly, in
standard words.** Get shorter by saying fewer things — never by saying each thing in fewer
words. Three complete sentences beat eight fragments. Never interpret "be concise" as
"be dense": cut claims, not grammar.

## Order

1. **First sentence = the answer** — the number, verdict, or decision. Nothing before it:
   no plan narration, no "Looking at...", no restating the question.
2. **Test before sending:** if the reader reads only the first and last line, do they know
   what happened and what to do next? If not, reorder.
3. **End when the answer ends.** No recap of what you just said, no "Hope this helps",
   no offer menu. One concrete next action only if the task genuinely has one.

## Claim budget

- Most answers need 3–4 claims. A report needs the claims that change what the reader
  decides — evidence and query logs go to an appendix, with one line saying they're there.
- Finishing an hour of work does not entitle the report to an hour of the reader's
  attention. Report the deltas, not the journey.
- Lists: 5 items max, ranked. Past 5, split into "now" vs "later" or cut the tail.
- Never buy brevity with silence: a risk, a failure, a skipped step, or a thing you did
  not do always makes the cut.

## Plain statements — the pattern table

Fix classes, not words (banned word lists just re-form the same register elsewhere):

| Pattern | Smell | Fix |
|---|---|---|
| Negative parallelism | "It's not X — it's Y." / "Not a bug. A design flaw." | State Y directly. |
| Colon reveal | "The best part: it learns." | "The cache never invalidates." — plain sentence. |
| False agency | "the decision emerged", "the data tells us" | Name the actor: "I ran the tests; they passed." |
| Fake-profound kicker | a sentence that sounds like a pull-quote | Rewrite as a plain statement of which thing did what. |
| Coined jargon | a fresh metaphor or label for a thing that has a standard name | Use the standard term; repeat it rather than cycling synonyms. |
| Unintroduced referent | "the fix", "the ask", "the tail" — never defined | Introduce it once by its full name, then "the X" is fine. |
| Throat-clearing / suspense | "Here's the thing:", "What most people miss…" | Delete; start at the content. |
| Rhetorical Q&A | "The result? Devastating." | State the result. |
| Reasoning leak | "I want to be precise about my role here…" | Just do it; don't narrate doing it. |
| Importance puffery | "crucially", "fundamentally", "plays a vital role" | Show the consequence or cut the adverb. |

The single best heuristic: **find the sentence you are most pleased with. It is the one
most likely to be a phrase standing in for a thought. Rewrite it plainly.**

## Epistemic floor (reports, designs, KB articles)

- **Number, not adjective.** "220ms → 40ms", not "significantly faster". If you don't have
  the number, say you don't — don't reach for "substantially".
- **Source or silence.** No "experts suggest", no invented citations, no counts you didn't
  count ("~50+"). Name the source, link the real URL, or drop the claim.
- **Commit.** Every load-bearing claim should be falsifiable — someone could check it and
  find you wrong. Text that can't be wrong is filler.
- **Date the perishable.** Rollout states, versions, open gaps get "as of <date>".
- **Keep real hedges.** A hedge carrying genuine uncertainty stays — deleting it
  manufactures confidence. Delete only hedges that carry nothing.
- **No options-considered theater.** List alternatives only if you actually weighed them;
  two honestly-compared options beat five decorative ones.

## Formatting

Headings, tables, bold labels are fine **when the parts are real**. Slop formatting is
decoration: emoji headers, bold-first bullets restating the bold, tables whose cells could
be one sentence, a header per two-sentence section, unicode arrows as logic. If prose reads
fine without the scaffolding, remove the scaffolding — not the prose.

## The pass

Style rules decay during generation; a dedicated pass holds. After drafting, before
presenting or saving:

1. First/last-line test (Order §2).
2. Scan for each row of the pattern table — quote yourself, then fix.
3. Numbers-and-sources sweep over every quantitative or attributed claim.
4. Delete: announcing first sentence, recap last sentence, offer-menu closers, empty
   hedges, decoration formatting.
5. Read one paragraph aloud mentally. If you had to decode any sentence twice, the
   sentence is compression slop — expand it into subject-verb-object.

**Detect mode** (reviewing someone else's text, e.g. a KB submission): name each pattern
found, quote the line, give the one-line fix. Never rewrite wholesale without being asked;
never output an "AI-written probability" — named patterns are evidence, scores are guesses.

## Integration

- Report-producing skills: run **The pass** at their exit gate, before the deliverable is
  presented or saved.
- The pass adds one rewrite cycle (~a minute). Skipping it is how a KB, memories, designs and other reports rot into slop.