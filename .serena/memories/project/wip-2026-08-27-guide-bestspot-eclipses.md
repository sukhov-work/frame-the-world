# 2026-08-27d — GUIDE: the BEST SPOT chapter, eclipses, ULT, the baked regions

**Pure docs session. No `src/` behaviour touched — the only edited runtime file is
`src/lib/guide/guideContent.ts` (content data), plus two backlog rows.**

Gates: vitest **2,210/2,210** (146 files) · `astro check` 0 err / 0 warn / 8 hints · `npx knip`
exit-0. Nothing browser-verified this session (nothing needed it — the claims were read out of
the shipped components, not off a screen).

## WHAT WAS MISSING, AND HOW MUCH

The guide was frozen 2026-08-22 (`guideContent.ts` mtime 22:46). BEST SPOT shipped 2026-08-23/24
and its whole owner batch landed 2026-08-26 — **the guide had not one word about it**. Same for
the ULT chip (2026-08-22h, hours after the freeze) and the four baked regions. Eclipses had ONE
sentence, inside `target-card`, and it was already wrong (it said "the next five" for both shells;
`/m` shows four).

## WHAT SHIPPED — 13 new topics + 1 new chapter + 2 goals

| where | ids | subject |
|---|---|---|
| **new chapter `bestspot`** | `spot-open` `spot-read` `spot-markers` `spot-shortlist` `spot-actions` `spot-altitude` `spot-honesty` `spot-limits` | the heatmap, end to end |
| `target` | `target-eclipses` · `target-eclipse-scene` | the prediction rows, and what an eclipse does to the RENDERED scene |
| `move` | `move-ultra` | the ULT chip |
| `trust` | `trust-detail` | Dnipro · Pripyat/Chernobyl · St Albans · Everest |

Goals added: *"Score the ground around me for where to stand"* → `bestspot`; *"Watch an eclipse
before it happens"* → `target-eclipses`.

Edits to existing copy (all were STALE, not merely thin):
- `move-deck` — "Eight toggles" → **nine** (ULT joined the row), + the ULT list line.
- `plan-open` — the toggle is **three** segments now (`☀ PLAN · ⌖ FIND IN FRAME · ◎ BEST SPOT`),
  and PLAN/FIND/BEST SPOT are three faces of ONE window.
- `start-shells` — BEST SPOT added to what the phone leaves out.
- `target-card` — the eclipse paragraph became a `[[target-eclipses]]` crosslink.
- `fpv-walk` — a 6th step: the deck's **ALTITUDE encoder** rises/sinks. It was never documented,
  and adding it is what un-broke the alias fence (see below).

## THE FENCES BIT FOUR TIMES — read this before adding a topic

`test/lib/guide/guideSearchGolden.test.ts` is the hard one. New copy CHANGES THE RANKING of
existing queries, so every addition is a search regression risk:

1. **`fpv-walk:"altitude"` went orphan.** The alias fence needs each alias in its own topic's
   top 5; `spot-altitude` (whose `where` line is the literal label `SHEET ALTITUDE`) took the top
   slot and pushed `fpv-walk` to 6th. Deleting my own `"sheet altitude"` alias did NOT fix it —
   the `where` line alone still outranks. **The fix was to make `fpv-walk` genuinely stronger**:
   its steps never mentioned the ALTITUDE encoder, which is a real omission. Content gap and
   ranking bug were the same bug.
2. **`"top 8"` and `"1 m"` reach nothing** — the tokenizer drops the bare digit, so `"1 m"`
   returns `[]` outright. **Never author an alias containing a lone number.** Used
   `"eight markers"` / `"go there"`.
3. **`"re-solve"` stole the golden row `"re-centre" → fpv-map-controls`** via the fuzzy ladder.
   Check a new alias against the GOLDEN table's near-neighbours, not just against its own topic.
4. **The goal phrase *"Read when the light is right at a spot"* started resolving to
   `spot-markers`** — the word "spot" is now all over a chapter. Fixed by taking "spot" out of
   that topic's `keys` (`ranked spots` → `ranked cells`), not by rewording the shipped goal.

Loop that works: edit → `npx vitest run test/lib/guide` → for a ranking failure, probe with a
throwaway `vite-node` script over `searchGuide(q, 6)` rather than guessing.

**The banned-phrase lint caught my own slop pass**: the /no-slop rewrite introduced
*"cannot be scored honestly"* and `honestly` is on the intensifier list. The lint runs on `keys`
too — aliases are authored prose.

## THINGS THAT CONSTRAIN THE NEXT GUIDE SESSION

- **`allMedia()` is pinned at exactly 13** (`guideContent.test.ts:185`). Adding one shot means the
  webp on disk + real `w`/`h` + that number + `scripts/warm-prod-assets.mjs`. This session added
  ZERO media on purpose → **T72**.
- Bodies ≤ 5 sentences, tips ≤ 220 chars, steps 1–6 and **one sentence each** (`/[.!?]\s+\S/`),
  list items must not start with a digit, aliases ≤ 3 words and lower-case.
- All three surfaces (`Guide.tsx` / `GuideSheet.tsx` / `guide.astro`) render `GUIDE_CHAPTERS`
  generically — **a new topic needs no renderer edit**. Only `start` is special-cased.

## THE ONE DEFECT FOUND — T71

`BestSpotPanel.tsx:179-180` tells the user to *"TURN ▦ 3D DETAIL ON"*. That is the **/m LAYERS**
chip; BEST SPOT is desktop-only, where the same layer is **BLD**. The guide's `spot-limits.tip`
documents the mismatch verbatim, so fixing the string means editing that tip in the same commit.

Related: `mem:project/wip-2026-08-22-guide-final` · `mem:project/wip-2026-08-24-bestspot-s3-s7` ·
`mem:project/wip-2026-08-22-eclipses` · `.claude/claude-docs/bestspot/README.md`
