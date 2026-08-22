# WIP 2026-08-22g — GUIDE FINALIZATION (charter G-A…G-J, all ten slices shipped)

Executes `.claude/claude-docs/GUIDE_FINALIZATION_PLAN.md` (732 lines, authored 22f by a
10-agent fan-out). Owner order: "fully updated, enriched and interactive … all places
(desktop / mobile / standalone page) referencing same resources … support advanced search",
plus "judiciously apply stop-slop + i-have-adhd".

## Gates carried out
- **vitest 1,292/1,292 (110 files)** — +75 tests this session · `astro check` 0 err / 5 hints
  · `npx knip` exit-0
- NEW `scripts/verify-guide.mjs` — **ALL PASS**, 30 checks over all THREE surfaces
  (shots `verify-shots/guide-01..05`)
- `scripts/verify-audit3.mjs` **16/16 regression PASS**

## THE LESSON OF THIS SESSION: the charter was not enough
A 12-agent adversarial re-audit of the copy against live source raised **44 findings, 38
survived refutation** — 8 of them things the charter's own 58-finding pass had missed.
**A plan verified against source is still a plan. Re-verify the copy you just wrote.**

Worst survivors (all fixed):
- **`move-pin`: "PLAN reads the light at the pin" is FALSE.** `scene/planFeed.ts:342-351` is a
  three-rung ladder `photoApex → fpvEye → focus` with **no temp-pin rung**, and
  `dropTempPinAt` (`StylizedTiles.ts:1616-1628`) never moves the camera focus either — so the
  escape hatch "the focus IS the pin" does not exist. The pin seats the **AIM**
  (`lib/geo/aimAnchor.ts:56-57` DOES carry a tempPin rung). A bare pin gives **no** skyline
  verdict until you stand on it (`plan-verdicts.tip` corrected too).
- **`fpv-hud.where` named the wrong corner on BOTH shells** — desktop `.fh` is `bottom: 2.4rem`
  ("True bottom-left corner", `fpv-hud.css:10-16`); `/m` `.m-fpvhud` is `top: 3.1rem`, under the
  status strip. And "the same rows ride /m" was wrong: `FpvControls.tsx:119-138` renders FOUR
  of the eight (no position/COPY, no GROUND, no ☀ SUN / ☾ MOON).
- **`trust-airless` had the refraction sign BACKWARDS** — an airless sky reaches the horizon
  a few minutes *before* the refracted almanac time, not after.
- `fpv-height`: the ghost previews the **NEW** height over the solid original
  (`enrichedBuildings.ts:173-175`, `setGhostK` fed the LIVE drag) — not "a ghost of the original".
- `fpv-cone` "shows from the moment the app boots" — false at a 1,100 km boot pose; it is
  altitude-gated like the radar (`tuning.ts:2124-2130`).
- `find-mobile` called FIND "the fourth tab" (`TabBar.tsx:12-16` → it is **third**).
- `photo-upload` named the wrong gesture (SET ON GLOBE arms it, *then* you click).
- `photo-align` called the heading/pitch **encoder knobs** "sliders"; the label is PLANE ALPHA.
- **The ▲/▼ glyphs are the /m chip's** — the desktop deck renders bare `3D`/`2D`
  (`CameraTiltPanel.tsx:136`). `↑ UPLOAD HERE`, not `◎`.

## Charter claim REFUTED by measurement
**`find-sunsets` is NOT desktop-only.** `/m` ships SUNSETS IN FRAME inside the **PLAN sheet**
(`PlanSheet.tsx:284-426`, an accepted two-shell dup). Scoping it desktop-only would have
introduced a fresh error. It got a two-shell `where` naming the different homes.
(`save-ics` and `plan-mw` ARE desktop-only — those two the charter had right.)

## What shipped, by slice
- **G-A (gates first).** NEW `test/lib/guide/guideSearchGolden.test.ts` — a **characterization**
  fixture: an unfixed row pins its MEASURED wrong answer, so it can neither drift silently nor
  be "fixed" without deleting the pin. 27 rows started pending; **all 27 now reach their target
  and `KNOWN_MISSES` is EMPTY.** NEW `test/pages/guideAstroShape.test.ts` machine-checks T24's
  three `set:html` properties over a **globbed** `.astro` sweep. Voice-lint corpus **144 → 294**
  strings (titles, both `where` lines, goal phrases, aliases had ZERO enforcement; the six
  existing BANNED regexes passed clean on all 150 new ones).
- **G-B (content model).** `GuideTopic.list` (`<ul>`; 13 topics rendered an enumeration as one
  sentence — worst was 80 words / 11 commas) · `GuideMedia.w/h` with a gate that parses the real
  **WebP header** (VP8/VP8L/VP8X) so a re-shoot cannot drift · `GuideTopic.keys` ·
  `GuideGoal.route`. All four render on all three surfaces.
- **G-C/G-D (copy).** 18 charter drifts + 38 audit corrections + THREE new topics:
  `start-explore` (Explore is a permanent nav entry the guide mentioned **zero** times),
  `keys` (12 keyboard binding sites, 4 documented), `fpv-focal-axes` (**T41 CLOSED**).
- **G-E (search).** See the search section below.
- **G-F (parity) + THE LIVE BUG.** `nav()` wrote an identical `chapterId` for a same-chapter
  target → React bailed → the `[chapterId, open]` scroll effect never re-ran → **two shipped
  crosslinks did not scroll on either island**. Fixed with a monotonic `navSeq` in the deps.
  Plus goal→**topic** anchors on `/guide`, `/m` search hoisted **above** the index/chapter split
  (it was unreachable from inside a chapter) + the dropped snippet restored, sticky chapter
  header, `↺ GOALS`, 62/66ch measure caps matching the page, the page's missing `h1`, a topic
  tier in all three TOCs (**70** topics reachable without opening a chapter), and `/guide`
  linked from the shell at last (it had exactly two link sites, **both inside the guide**).
- **G-G (interactivity).** Escape via **CAPTURE phase** (below) · `?guide=<id>` both shells ·
  goal ROUTES with `STEP n OF m` · `/`-to-search, ↓/↑, Enter · zero-JS image anchors.
- **G-H (anti-slop).** Four new BANNED groups at **0 current hits** — a REGRESSION GUARD, since
  **97 of ~120 stop-slop patterns already scored zero** — plus one-bounded-action-per-step,
  landed AFTER the splits (12 of 43 violated it).

## Search — the two tiers the charter did not predict
Shipped: aliases · glyph/shorthand QUERY expansion (`◉ ∠ ⌖ ▲ ▼ ◎ ▤ ⊞ ▦ ✕ ☀ ☾ 🧭`, `/m`, `36h`) ·
caption indexing at topic AND **chapter** level (GOTO lives only in a chapter caption) · fuzzy
floor 4→**5** · prefix `minLen` **3** · per-tier caps ranked by **`w × idf`** (the old
`.slice(0,8)` by weight rewarded SHORT terms and dropped `compass`/`constellation`).

Identity ladder (strongest wins, never compounds): title-exact ×3.0 · **id-exact ×2.5** ·
title-phrase ×2.0 · title-lead ×2.0 · title-word ×1.5 · verbatim-phrase ×1.4 ·
**title-prefix ×1.35**.

**TRAP — resolving a bare `[[fpv]]` to its TITLE (the parity fix) DELETED the literal token
"fpv" from the corpus** (the chapter is titled STAND IN IT) and `searchGuide("FPV")` returned
`[]`. Node **ids** are now indexed at 2.5 — that is where `fpv`/`mobile`/`plan` actually live.
**TRAP — `foc` lost to `move-search`** because the rare, incidental "focus" out-IDF'd "focal"
*in the title and the id*. Where a term SITS is evidence document frequency cannot see.

Result: every curated query, all **70** topic titles, all 11 chapter titles and all **14** goal
phrases rank their own node first; all four negatives still `[]`.

**The charter's proposed LEXICAL alias fence was REJECTED on measurement** — it permits only
aliases for words that are already findable (`lens`, `shutter`, `login`, `milkyway`, `android`
appear in neither the copy nor the UI). The shipped fence is **BEHAVIOURAL**: an alias must
reach its own topic, no alias on >2 topics, no alias may answer a negative. It immediately
caught **7 real over-claims** (`start-shells:"mobile"`, `fpv-enter:"walk"`, `mobile-map:"map"`…).

## TRAPS worth carrying forward
1. **Astro scopes `<style>`.** Runtime-created DOM carries no `data-astro-cid`, so a scoped
   selector matches NOTHING — the `/guide` search dropdown rendered as raw underlined links.
   Every runtime-built class needs `:global(...)`. **Caught by eyeballing a screenshot, not by
   any test.**
2. **A descendant selector caught the nested routes.** `.g-goals a` dressed all 14 reading
   routes as full goal cards, five screens tall → `.g-goals > li > a`.
3. **A comment stripper must remove LINE comments FIRST.** Block-first let a `//` line
   containing `components/mobile/**` open a phantom block that ate ~100 lines of live code and
   turned two parity assertions red for no product reason. `stripComments` now lives in
   `test/styles/_css.ts` and is shared by both source fences.
4. **CAPTURE-phase beats registration order.** `Guide.tsx` registers
   `addEventListener("keydown", onKey, true)` + `stopImmediatePropagation()`, so it owns Escape
   ahead of the globe's bubble-phase Escape chain (`StylizedTiles.ts:1570-1596`) with **zero
   globe edits** — which matters because "no globe/lib edits" is a per-session done gate.
5. **`?guide=`, never `#guide=`.** The globe rebuilds the whole hash every ~1.6 s and both pose
   parsers are anchored (`urlPose.ts:58`). On `/m` the param must be read in **MobileShell** —
   sheet visibility is local state, so `GuideSheet` only mounts after the fact.
6. **A verify script's own constants go stale.** Three "failures" on the first run were the
   script's (a hard-coded 67 topics, an unclearedered search box, a toggle-click that CLOSED an
   already-open panel). Derive counts; guard triggers.

## Open / next
- **T42 stays OPEN** — the 8 stale crops are owner-taste by the charter's ruling. Annotated:
  `orbit.webp` needs NO re-shoot (the copy was wrong, not the image) · `upload.webp` shows the
  DROP ZONE, so its caption was corrected to match the shipped frame · any re-shoot must update
  the declared `w`/`h` or the suite fails.
- **T41 CLOSED**; **T24 re-verified + dated** in the same commit as the `guide.astro` change.
- Standing: the RELEASE GATE (owner's GoDaddy nameserver fix → Wix www TLS → OAuth allowlist),
  T1 device pass, T34, then P8/P9/M4 · U8 sync ladder.

Related: `mem:core` · `wip-2026-08-22-audit3-fixslices` · DECISIONS 2026-08-22g ·
`GUIDE_FINALIZATION_PLAN.md`.
