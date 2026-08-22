<!-- Authored 2026-08-22f by a 10-agent research fan-out (2 skill-distillation · 4 mapping ·
     4 adversarial verification) + synthesis. 58 findings raised, 0 refuted in verification.
     The owner's order this plan serves, verbatim in intent: "Next session focus fully on
     finalizing guide — it should be fully updated, enriched and interactive. Also judiciously
     apply [stop-slop + i-have-adhd] to clean up final output from typical AI slop, tropes and
     complexity. Make sure that all places for guide (desktop / mobile / standalone page) are
     referencing same resources, have a nice layout and support advanced search (see how we can
     make search across guide even more precise and fluent in terms of data matching)."
     Live-verified by the main agent before landing: the same-chapter crosslink no-scroll bug
     (Guide.tsx:110-116 vs the [chapterId, open] deps at :157) and the T41 mechanism
     (Joystick.tsx:115-117 — inside FPV BOTH readouts derive from the same live vertical FOV). -->

# NEXT SESSION — GUIDE FINALIZATION CHARTER (owner order 2026-08-22)

> The guide track's execution plan — `NEXT_SESSION_PROMPT.md` points here rather than inlining it
> (the `*_PLAN.md` convention: UPLIFT_PLAN, MOBILE_PLAN, the archived UXBATCH4_PLAN).
> Everything below is verified against the working tree at `a5b7fc6` + the uncommitted guide edits.
> Every claim carries a `file:line`, a doc section, or the word UNVERIFIED. Nothing here needs re-deriving.

---

## 0. What "finalized" means, in the owner's terms

The guide is finished when a reader who has never opened Plux can, from **any of the three surfaces**
(desktop `Guide.tsx` panel, `/m` `GuideSheet.tsx` sheet, the standalone `/guide` page), reach the same
resource by the same name through the same search, find every shipped control the app actually renders,
and read nothing that is false about the live UI. Concretely: one content module feeds three renderers
with no field that only two of them honour (§5 matrix); search finds a topic by its own title, by the
label printed on the button, by the glyph on the button, and by an ordinary English synonym for it
(§4); the eighteen verified factual drifts in shipped copy are corrected and the three undocumented
surfaces — Explore, the keyboard map, the T41 focal dichotomy — get topics (§2 G-C, §7); the copy passes
a lint that catches the *essayist* tells the current marketing-slop lint does not, without acquiring
rules that fight the house instrument voice (§3); and the whole thing is provable by
`npm test` + `npx astro check` + `npx knip`, with a golden-query relevance fixture so a future ranking
change cannot silently regress it. "Interactive" means the guide can *point at* the instrument
(deep links, goal routes, one navigation action per chapter) — it does not mean coach marks, progress
bars or gamification (§6 SKIP list, §9).

---

## 1. Read-before-you-start

| What | Where |
|---|---|
| Content module (67 topics / 11 chapters / 10 goals) | `src/lib/guide/guideContent.ts` (46,380 bytes) |
| Editing rules, in-file and binding | `src/lib/guide/guideContent.ts:5-17` |
| Crosslink grammar | `src/lib/guide/inline.ts:24` (`LINK_RE`) |
| Ranking engine | `src/lib/guide/search.ts` (BM25 K1=1.4/B=0.6 at `:141-142`) |
| Structure + voice gates | `test/lib/guide/guideContent.test.ts` (`allCopy()` `:20-33`, BANNED `:122-129`, caps `:137-146`) |
| Ranking gates | `test/lib/guide/guideSearch.test.ts` (12 cases, 145 lines) |
| Fence | `test/components/mobileFence.test.ts` (rule 1 blacklist `:53-63`; `/m` focus rules `:116-146`) |
| T41 ruling (ACCEPTED AS-IS, converted to a DOCS item) | `.claude/skills/frame/references/tracked-backlog.md:50` |
| T42 re-shoot remainder (8 stale shots) | `tracked-backlog.md:51` |
| T24 XSS re-verify formula | `tracked-backlog.md:33` |
| `/guide` zero-JS charter (an owner decision, not an accident) | `src/pages/guide.astro:3-6` |

**Known-stale in-repo facts to fix while you are in the files** (both measured with `sips`):
`guideContent.ts:13-14` says `/m` shots are "402 px portrait" — they are **360×783**
(`scripts/shoot-guide.mjs:9` states the target set correctly). `src/pages/guide.astro:6` says
"the goal router links chapters" — G-F changes that behaviour, so the line must change with it.
`scripts/shoot-guide.mjs:73` still calls the camera deck "the 2×4 toggle grid"; it renders nine
children over four columns (`camera-tilt.css:123-125` + `CameraTiltPanel.tsx:107-217`).

---

## 2. Ordered slices

Ordering is by **dependency**: gates → content model → copy → search → surfaces → interactivity →
anti-slop → re-shoots → record. Content-model changes precede copy edits; copy edits precede re-shoots;
the golden fixture precedes every ranking change.

---

### G-A — GATES FIRST (test-only, no product change) · effort S · deps: none

The whole session is a ranking-and-copy change over a corpus with almost no relevance coverage and no
source-shape guard on the one file in the repo that uses `set:html`. Land the proofs before the changes.

**Contents**

1. **Golden-query relevance fixture** — new `test/lib/guide/guideSearchGolden.test.ts` (SRCH-11).
   Three blocks:
   - **Curated rows** (~15, table in §4). Assert `searchGuide(q)[0].id === expected` except where §4
     marks a row `top-3`.
   - **Derived rows, free**: all 67 topic titles top-1 (66/67 pass today; sole failure `move-minimap`,
     "The mini-map" → `fpv-map`), all 11 chapter titles top-1 (9/11 pass; `fpv` and `plan` fail), all 10
     `GUIDE_GOALS` phrases top-1 (10/10 pass today). Ship the three known failures as an explicit
     `KNOWN_MISSES` set that G-E must empty — **an allowlist, not a skip**.
   - **Negatives**: `qqxxyyzz`, `tripod`, `refund`, `discord` → `[]` (all four return `[]` today).
2. **T24 source-shape guard** — extend the existing idiom at `test/styles/pinchHardening.test.ts:23`
   (which already reads `src/pages/guide.astro` as text): assert the file contains exactly **4**
   `set:html` occurrences, that every one is `set:html={inlineHtml(`, and that the file contains no
   `server:defer` and no `define:vars`. Target `server:defer` explicitly, **not** `client:` — client
   islands already ship in this repo (`src/pages/index.astro:241` `<MemberBadge client:only="react" />`)
   and the backlog row's "zero island components" means zero *server* islands.
3. **Extend the voice-lint corpus** — `allCopy()` at `test/lib/guide/guideContent.test.ts:20-33` walks
   `lead / body / tip / steps / media.caption` only. Add chapter titles, topic titles,
   `where.desktop` / `where.mobile`, and the 10 `GUIDE_GOALS.goal` strings: **150 user-visible strings
   with zero voice enforcement today**. This is a bigger real win than any single stop-slop rule.
   UNVERIFIED: whether the *existing* six BANNED regexes pass on those 150 strings — run it; if a title
   trips, fix the title, do not whitelist.

**GATE** `npx vitest run test/lib/guide test/styles/pinchHardening.test.ts` green, with
`KNOWN_MISSES.size === 3`.

---

### G-B — CONTENT MODEL (shared tier; three renderers each) · effort M · deps: G-A

Every field here lands in `src/lib/guide/guideContent.ts` (`lib/**` = shared tier, fence-safe per
`test/components/mobileFence.test.ts:8-9`) and must be rendered by **all three** renderers or it becomes
a new parity gap. Budget every field at 3× renderer work.

| Field | Why | Renderers |
|---|---|---|
| `GuideTopic.list?: string[]` → `<ul>` | 13 topics render an unordered enumeration as one long prose sentence behind a colon. Worst: `mobile-chips` = 80 words / 11 commas / ~10 chips in one sentence (`guideContent.ts:983-989`). Others: `target-menu` `:576-581`, `move-deck` `:195-201`, `find-chips` `:738-742`, `mobile-layout` `:968-971`, `find-standings` `:743-750`, `find-ghosts` `:755-758`, `plan-open` `:637-640`, `plan-frame` `:653-657`, `time-bands` `:450-455`, `target-unfollow` `:597-599`, `plan-meteors` `:693-698`, `find-sunsets` `:771-775`. **Do NOT push these into `steps`** — they are not sequential and `steps` renders as `<ol>` (`Guide.tsx:77-85`). | `Guide.tsx`, `GuideSheet.tsx`, `guide.astro` (plain text nodes, **not** a fifth `set:html` site) |
| `GuideMedia.w?: number; h?: number` | 13 lazy images reserve no box. `guide.astro:99` hard-codes `width="720"` for **nine** chapter shots, and it is **wrong** for `/guide/shell-m.webp` (360×783 on disk). Six distinct intrinsic sizes exist — 720×450, 360×783, 640×700, 320×640, 640×128, 720×673 — so a per-shell CSS ratio is refuted. | all three; delete the hard-coded `720` at `guide.astro:99` |
| `GuideTopic.keys?: string[]` | Search aliases (§4). Not rendered. | none — index only |
| `GuideGoal.route?: string[]` | Goal ROUTES (§6 IX-6). `target` stays `route[0]`. | all three |

Also in this slice: add a gate that each declared `w`/`h` matches the on-disk webp header (extend the
existing `fs`-based media block at `test/lib/guide/guideContent.test.ts:107-116`), so a re-shoot that
changes a size fails instead of drifting. And fix the stale `402 px` comment at `guideContent.ts:13-14`.

**GATE** `npm test` + `npx astro check` (0 err) + `npx knip` exit-0. New optional interface fields are
invisible to knip; a new *exported* helper is not — keep helpers file-local or entry-reachable.

---

### G-C — COPY TRUTH PASS (18 verified drifts + 3 missing topics) · effort M · deps: G-B

Every item below was verified line-for-line against the live code. Ordered by severity.

**FALSE claims — fix the sentence:**

1. **COV-1** `guideContent.ts:182`, `:187`, `:253`, `:257-258` — "double-clicking drops the pin **and enters** first-person view in one motion" is false. `StylizedTiles.ts:1629-1640 → :1616-1627` writes only `setTempPin`; the four `setTempFpv(true)` call sites are `StylizedTiles.ts:616`, `:2161`, `CameraTiltPanel.tsx:404`, `SceneActions.tsx:116`. `TempPinPopup` early-returns unless `tempFpv` is FALSE (`CameraTiltPanel.tsx:395`), so a bare double-click **always** yields the popup with ◎ LOOK FROM HERE (`:404`). Fix `move-pin.where.desktop` → "Double-click the ground"; add the popup press as its own `fpv-enter` step. **Raise to the owner separately**: the app's own memo repeats the compressed claim at `CameraTiltPanel.tsx:65-68` ("DOUBLE-CLICK ANYWHERE TO / DROP A PIN & LOOK FROM THERE") — fixing only the guide leaves the two out of sync, and a UI string edit needs the owner's word.
2. **COV-2** `guideContent.ts:151-152` says a two-finger tilt lifts the `/m` flat chart into the globe — the tilt door is gone (`StylizedTiles.ts:2857-2859`, enforced `:2879-2887`); two-finger parallel drag is now ROTATE (`:2877-2878`). And `:956-957` says "the compass chip flies it back north" — `NavChip` is inert on the flat chart (`SceneActions.tsx:266-269`); the north re-seat is **two taps**, ▲ 3D then ▼ 2D (`SceneActions.tsx:241-243`). Say that plainly.
3. **COV-4** `guideContent.ts:836-837` — "Renaming and deleting live on the desktop list." No rename exists: `MyPins.tsx:340-366` renders exactly two controls, and `src/pages/api/places.ts` exports GET `:27` / POST `:48` / DELETE `:70` only. Cut "Renaming and". File rename as a feature request; do not paper over it.
4. **COV-3** `save-ics` (`:851-857`), `plan-mw` (`:682-687`), `find-sunsets` (`:769`) are desktop-only and carry no shell scoping. There is no `.ics` anywhere under `src/components/mobile/**` (`PlanSheet.tsx:125` says so in a comment). Add `where` to all three; add a "What the phone leaves out" tip on `start-shells` — that one tip converts a per-topic omission into one discoverable fact. Because `GuideSheet.tsx:48-61` orders mobile-first and labels it HERE, a desktop-only `where` renders on `/m` as a bare DESKTOP line with no HERE counterpart, which is exactly the signal wanted — **no renderer change needed**.
5. **COV-12** `guideContent.ts:822-825` — desktop SAVE PLACE is a two-step name-then-save exactly like `/m` (`CameraTiltPanel.tsx:344-386`), not a one-press. Empty name → `"Untitled place"` server-side (`:318`), whereas `/m` stamps `View · <stamp>` (`SceneActions.tsx:428`). **Land with COV-4** — "Untitled place" is permanent precisely because rename does not exist.
6. **COV-14 (b)(c)(d)** — `:259` "LOOK FROM HERE on the camera deck" is wrong (it is an island slot outside the controls card, `CameraTiltPanel.tsx:389-392`); `:924` `"Market, in the nav"` is wrong (the rendered string is `Marketplace`, `Marketplace.tsx:86`); `move-search` `:168-172` teaches none of the ↓/↑/Enter/Esc keys that `LocationFinder.tsx:258-286` binds — add a fifth step. **(a) is a NIT, downgrade it**: the search card is DOM-outside `.topnav` but renders on the same visual line (`location-finder.css:4-10` z-11 over `index.astro:325-329` z-10), so the current wording finds the control. Do not call it an error in any changelog.
7. **COV-8** `:196-201` + the chapter caption `:140` describe a "2×4 grid" — `camera-tilt.css:123-125` is 4 columns and `CameraTiltPanel.tsx:107-217` renders **nine** children (compass, 2D/3D, ☀☾, SAT, PIN, BLD, AIM, PLC, VEC). Slider set is also wrong: CAM TILT/ROTATE/ZOOM in orbit (`:94-108`, `:218-229`, `:231-247`), ALTITUDE/FOCAL ZOOM/BUILDINGS in FPV (`:231-247`, `:248-259`, `:260+`). **No re-shoot needed** — `public/guide/orbit.webp` (mtime 2026-08-22 03:34) already shows three rows. Fix `scripts/shoot-guide.mjs:73` too.
8. **COV-11** `:968` "Top strip: place, account, DESKTOP switch" — there is no place readout. `MobileShell.tsx:48-76` renders the Plux mark, the account chip, a **GUIDE** chip `:58-60`, and the DESKTOP anchor. The one item the layout topic omits is the reader's own entry point.
9. **COV-15** `:974-979` singles out FIND for covering the tab bar. `Sheet.tsx:48-73` is the single container: every sheet has ✕ `:68`, pull-down `:40-46`, scrim `:50`, and `.m-sheetroot` is `inset: 0` z-30 over `.m-bottom` z-10 (`chrome.css:214-218` vs `:7-12`). SEARCH and GUIDE are the two sheets actually passed `full` (`MobileShell.tsx:97`, `:107`); FIND is not (`FindSheet.tsx:180`).
10. **COV-17** (a) `:400-401` "0.5× to 3×" is the **per-edit** band, not the absolute one — `src/lib/globe/bldgOverrides.ts:33-40` sets `EDIT_MIN_K/EDIT_MAX_K = 0.5/3` and `SCALE_MIN_K/SCALE_MAX_K = 0.1/10`, composed at `:177-181`; edits compound. (b) `:471` "step by day and hour" omits MINUTE (`TimeScrubber.tsx:566`, `:576`). (c) `time-play` has no `where`; add `{ desktop: "▶ and the speed picker on the rail" }` (PLAY is retired on `/m`, `MobileTimeDock.tsx:369-370`).
11. **COV-13** `fpv-hud` `:319-329` omits the GROUND row (`FpvHud.tsx:92-97`), the ☀ SUN / ☾ MOON rows (`:123-130`) and the on-screen key hint (`:131-134`). Body is 3 sentences — two fit. Keep the SUN/MOON wording at "where the sun and the moon stand right now"; `bodyReadout`'s below-horizon branch is UNVERIFIED.
12. **COV-16** the `/m` ⤒/⤓ altitude pads (`FpvControls.tsx:78-111`) are named **only** in a media caption (`:264-266`) — and captions are unindexed until G-E lands. Add a fourth `fpv-walk` step. Also add ◎ SIGN IN TO SAVE (`SceneActions.tsx:408`) to `mobile-chips`, and note ⊞ LAYERS stands down in FPV (`SceneActions.tsx:142`).
13. **COV-9** untaught gesture: tapping a body's direction line on the MAP promotes it to the emphasized system (`MapWindow.tsx:843-883`, the only `setAimFocus` caller in the repo). One sentence on `fpv-map-gestures` (3-sentence body, room) or `target-radar` (4 sentences, also room).
14. **COV-10** GOTO is named only in a **chapter** caption (`:498`) and `target-toggles` `:527-533` is titled "The five toggles" while `TargetPanel.tsx:531-538` renders a sixth, ungated pill. Retitle "The action row", add GOTO scoped desktop (`TargetSheet.tsx` has no GOTO), state that MARK/TRAIL/GHOSTS need SHOW on, and quote ◎ AIM HERE verbatim (`SkyContextMenu.tsx:197`).

**MISSING topics — write them:**

15. **COV-5 — `start-explore`.** Explore is a permanent nav entry (`index.astro:225`) with its own island (`ExploreMode.tsx:18-41`), its own chip "◉ EXPLORING · PIN TO PIN — touch the globe or ESC to exit" (`:51-61`), its own Escape rung (`StylizedTiles.ts:1593`) and a mid-upload refusal (`:31`). The guide mentions it **zero** times; `searchGuide("explore")` returns four false positives, `searchGuide("ambient")` returns none. Ship it **text-only, no screenshot** — and raise separately that the Explore link is **not visible** in `public/guide/orbit.webp` at 1440 px, likely occluded by the LocationFinder card (`location-finder.css:9` z-11 over `.topnav` z-10). Occlusion mechanism is UNVERIFIED in a live browser; documenting an entry point the reader cannot see is half a fix.
16. **COV-6 — `keys`.** 12 keyboard binding sites, 4 documented, one on-screen hint. WASD/arrows `StylizedTiles.ts:1549-1552`; Space/Shift+Space `:1554-1569` (`walkFastMult: 3` / `walkSlowMult: 0.5`, `tuning.ts:1965`/`:1967`); the Escape chain `:1570-1594` plus six independent closers; scrubber ±10 min and Home/End = ∓6 h (`TimeScrubber.tsx:335-345`, `tuning.ts:268`, `TimeScrubber.tsx:67`); `LocationFinder.tsx:258-286`. Scope it `where: { desktop: … }` — `Slider.tsx:61-70` and `Encoder.tsx:77-83` live in `src/components/ui/`, which the fence **bans** from `/m` (`mobileFence.test.ts:53-63`), so say "every knob and slider on the desktop deck", never "every knob".
17. **COV-7 — the T41 focal dichotomy.** Its own slice, §7 / G-D.
18. **COV-18 (a)+(d) only.** Add router rows for the `mobile` and `time` chapters (nothing routes to `move`, `time`, `mobile` or `trust` today) plus rows for the two new topics; add a `PREV ·` twin to the existing `NEXT ·` on both shells (`Guide.tsx:275-279`, `GuideSheet.tsx:207-211`). **Do NOT reorder `GUIDE_CHAPTERS`** this session (COV-18 (c)) — it changes the desktop rail, the `/m` list, the `/guide` TOC and the NEXT chain in one edit, and ON YOUR PHONE leans on `fpv`/`plan` vocabulary that would then arrive later. It is an owner call. The cheaper substitute with most of the benefit: backfill `where.mobile` on topics that lack it (33 of 67 carry no `where` at all).

**GATE** `npm test` (caps at `test/lib/guide/guideContent.test.ts:65-73` and `:137-146` are the real
constraint — every proposal above was checked against them and fits) **and** a live-UI browser pass:
`GUIDE_PLAN`'s done gate is "every shipped claim demonstrated live once … no globe/lib edits"
(`archive/GUIDE_PLAN.md:117-120`). Note that new goal rows fold into BM25 at weight 1.5
(`search.ts:106-114`), so re-run `test/lib/guide/guideSearch.test.ts` and the G-A golden fixture after.

---

### G-D — T41, the focal dichotomy · effort S · deps: G-C · full text in §7

---

### G-E — SEARCH · effort M · deps: G-A (fixture), G-B (`keys`), G-C (corpus frozen) · detail in §4

---

### G-F — SURFACE PARITY · effort M/L · deps: G-B, G-E · matrix in §5

---

### G-G — INTERACTIVITY · effort M · deps: G-F · detail in §6

---

### G-H — ANTI-SLOP PASS · effort S · deps: **all copy landed** (G-C, G-D, and any new copy from G-E/F/G) · detail in §3

Runs last among the writing slices, because it is a regression guard over the final text — running it
before G-C would police copy that is about to be rewritten.

**GATE** `npx vitest run test/lib/guide/guideContent.test.ts` green with the new seventh BANNED group,
plus a recorded human score (§3 rubric) of ≥28/40 on every topic touched this session.

---

### G-I — RE-SHOOTS (T42) · effort M · deps: G-C, G-H (copy final) · owner-taste

Eight shots still date from 2026-08-15: `welcome`, `time`, `skymenu`, `plan`, `find`, `sunsets`,
`upload`, `shell-m` (`tracked-backlog.md:51`). `scripts/shoot-guide.mjs` has only **five** recipes today
(`fpv-map:29`, `orbit:76`, `fpv:91`, `fpv-m:111`, `target:131`), so the other eight need recipes added to
`RECIPES` before they can be re-taken. While in there: consider doubling the `resize:` arrays
(`:34/:81/:96/:116/:136`) — measured, the desktop shots render at ~95 % of native inside the panel
(`min(56rem,92vw)` `guide.css:37`, minus 20 px×2 padding `:44`, minus a 10 rem rail `:77-79` ≈ 686 px
content column) and the `/m` shots are **upscaled 1.18×** by `.gd-fig--m { max-width: 62% }`
(`guide.css:394-396`). 2× sources are the prerequisite for any lightbox being worth building.

**GATE** `npm test` (`guideContent.test.ts:107-116` proves every image exists on disk **and** appears in
`scripts/warm-prod-assets.mjs:25-28`) + the new w/h-matches-file check from G-B.

---

### G-J — RECORD · effort S · deps: everything

`DECISIONS.md` append (never edit history) · `write_memory` · close/annotate `tracked-backlog.md` rows
T41 (`:50`), T42 (`:51`), T28 guide-G3 remainder (`:37`) · **dated T24 re-check note on `:33`, in the same
commit as any `guide.astro` edit** — that is the row's own stated trigger · `.claude/.ship-title`.

---

## 3. G-H — the anti-slop pass, judiciously applied

The corpus was measured, not estimated: 144 linted copy strings / 22,928 chars, plus the 150 strings
`allCopy()` does not walk. **97 of ~120 stop-slop patterns score ZERO hits.** The guide is already
written in the voice stop-slop is trying to produce. This slice is a **regression guard against a future
"enrich the guide" session**, not a cleanup.

Overlap with the existing lint (`test/lib/guide/guideContent.test.ts:122-129`) is almost nil: of the 14
currently-banned tokens only `simply` and `It's worth noting` appear anywhere in stop-slop. The repo bans
**marketing adjectives**; stop-slop bans **essayist rhetoric**. Complementary, not redundant.

### 3.1 ADOPT as a lint — one new BANNED group

Append to `BANNED` at `test/lib/guide/guideContent.test.ts:122-129`. Zero current hits, zero plausible
false positives in instrument docs.

```ts
// stop-slop (hardikpandya/stop-slop, MIT) — the essayist half the marketing lint above
// does not reach: throat-clearing openers, emphasis crutches, meta-commentary, rhetorical
// setups. Measured 2026-08-22: 0 hits in 294 guide strings. This is a REGRESSION GUARD —
// these are the tells an LLM re-drafts back in when told to "enrich" a guide.
/here'?s (the thing|what|this|that|why)|the uncomfortable truth|it turns out|let me be clear|let that sink in|make no mistake|this matters because|plot twist|spoiler:|as we'?ll see|let me walk you through|in this (section|chapter),? we'?ll|think about it|and that'?s okay|at its core|at the end of the day|when it comes to|in a world where|the reality is/i,

// Business jargon, NARROWED. "navigate", "landscape", "moving forward" and "take a step
// back" are DELIBERATELY absent — they are literal verbs in a walkable 3D globe
// (guideContent.ts:100 "Stand in the landscape with LOOK FROM HERE").
/\b(unpack|lean into|game-?changer|double down|deep dive|circle back|on the same page)\b/i,

// The 15 NAMED adverbs only — never the blanket -ly rule (see the REJECT list).
/\b(really|literally|genuinely|honestly|actually|deeply|truly|fundamentally|inherently|inevitably|interestingly|importantly|crucially)\b/i,

// i-have-adhd SKILL.md:109/:113 openers + closers, and the tangent sidebar (:68, :134).
/\b(great question|sure!|looking at your|to answer your question|hope this helps|happy to clarify|feel free to ask|by the way|keep in mind)\b/i,
```

Plus the two structural lints derived from i-have-adhd Rule 2 ("one bounded action per step",
`SKILL.md:42-55`), which is the one place the guide is genuinely non-compliant:

```ts
// No step contains two sentence terminators or an "and then" chain.
it("steps are one bounded action", () => { /* /[.!?]\s+\S/ and /\band then\b.*\band then\b/i over t.steps */ });
```

**12 of 43 shipped steps violate it**, verified: `move-orbit.steps[0]` `:154` ("Drag to orbit. Scroll or
pinch to zoom.") · `[1]` `:155` · `move-search.steps[3]` `:172` · `start-loop.steps[4]` `:103` ·
`fpv-enter.steps[0]` `:257-258` · `[2]` `:260-262` (three actions) · `fpv-walk.steps[1]` `:276` ·
`fpv-map-controls.steps[0]` `:356` · `[2]` `:358` · `fpv-height.steps[1]` `:400-401` ·
`time-scrub.steps[0]` `:440` (three clauses) · `mobile-gestures.steps[3]` `:998-999`.
**CAUTION: splitting is not free** — `mobile-gestures` is already at the 6-step cap (`:994-1003`) and
`fpv-map-controls`/`fpv-height` sit at 5. Land the lint **after** the splits, or it fails on day one.

### 3.2 ADOPT as human judgement (review checklist, never a gate)

- **False agency** (`structures.md:66-80`). One genuine live defect no gate catches:
  `guideContent.ts:878` `photo.lead` — "a camera file **becomes** a standing frame at its true capture
  spot". Rewrite so the reader or the app acts. Optionally `:1014` `trust.lead` "Plux is built to be
  trusted" — passive *and* telling-not-showing; the specifics already follow the colon, so the lead
  clause is cuttable.
- **Tangent suppression** (i-have-adhd Rule 4). 14 parentheticals of 12+ chars survive inline. Worst:
  `mobile-map.body` `:954-956` buries a whole second gesture in a 14-word parenthesis. Each becomes its
  own sentence/step or a `[[crosslink]]` — the escape hatch already exists and is already the stated
  policy (`guideContent.ts:12`). Same pass covers the 12 sentences carrying **two or more** em-dash
  asides (`move-deck` `:195-201` has three; also `find-chips` `:738-742`, `target-radar` `:556-563`,
  `mobile-layout` `:968-971`, `fpv-hud` `:323-327`, `save-ics` `:854-857`, `mobile-map` `:952-958`,
  `trust-accuracy` `:1020-1027`, `start-shells` `:110-114`, `time-inputs` `:471-475`, `target.lead`
  `:491-494`, `time-scrub.steps[1]` `:441`).
- **Figurative language, SPLIT — not banned.** i-have-adhd `SKILL.md:136` orders every idiom replaced
  with the literal action. ~30 guide constructions are figurative and **load-bearing house voice**:
  `:598` "One press stands the whole apparatus down", `:545-548` "the lock never fights your hand",
  `:846-849` "a private constellation of viewpoints", `:1036` "The numbers are right; the drawing is the
  instrument", `:561` "wears the body's own ink", `:396` "Map data gets heights wrong; your eyes know
  better", `:313` "It reads through the world rather than over it", `:135` "The globe is a free camera".
  **Apply the rule only where the figure HIDES a mechanic the reader must act on**: "stands down"
  (`:566`, `:959`) is genuinely ambiguous (does the radar hide, or stop updating?); "wears the body's own
  ink" obscures a colour legend; "stands the whole apparatus down" obscures a list of six things that
  clear. Keep the figures that *are* the meaning. **Never ship a regex idiom lint** — it cannot separate
  the two.
- **Scoring rubric.** stop-slop's is 5 dimensions ×10, "Below 35/50: revise." **Drop the Rhythm
  dimension** — bodies are hard-capped at 5 sentences (`test:137-145`), tips at 220 chars (`:144`), steps
  at 1..6 (`:65-73`); there is nothing to vary, and parallel construction across steps is a virtue of
  procedural documentation. Score **out of 40** on Directness / Trust / Authenticity / Density,
  threshold **28/40**, and substitute a fifth PLUX-native dimension: **Accuracy — does every label,
  gesture and number match the live UI?** (`guideContent.ts:7`). That is the only dimension in this
  project that can make the guide *wrong*. The rubric is subjective and unautomatable: review prompt
  only, never a vitest gate.

### 3.3 REJECT — with reasons (the owner said "judiciously")

| Rule | Source | Why it is rejected here |
|---|---|---|
| **"No em dashes at all"** | stop-slop `SKILL.md:25`, `structures.md:125` | **The single most destructive rule in the skill for this repo.** Measured: 65 of 144 linted copy strings, 652 occurrences in `guideContent.ts`, **4,647 across `src/**`**, 2,959 in `.claude/claude-docs`, 384 in `src/styles`. The em dash *is* the house separator. Adding `/—/` to BANNED fails on day one and demands rewriting the entire guide. The skill also **violates its own hardest rule** — `examples.md:45` ships "Speed, quality, cost—pick two." inside its recommended AFTER text. |
| **"Two items beat three" / three-item lists → two** | `SKILL.md:25`, `structures.md:122` | 19 hits, every one a UI enumeration whose third item is a real thing on screen: `start.lead` "terrain, buildings and sky"; `fpv-hud.body` "heading, pitch and eye"; `target-search.body` "constellations, Messier and NGC"; `time-bands.body` "hour, nautical and astronomical". Dropping an item makes the doc **wrong**. Loses to `guideContent.ts:7`. |
| **Blanket "kill all adverbs / no -ly words"** | `phrases.md:55` | 6 hits, all load-bearing precision: *automatically* (`start-shells`), *exactly* ×2 (`fpv-cone`, `find-jump`), *smoothly* (`fpv-map-gestures`), *hourly* (`plan-meteors` — ZHR **is** an hourly rate), *rarely* (`photo-align`). Contradicts `SKILL.md:21` "Be specific" in the same document. The 15 **named** adverbs are banned instead (3.1). |
| **Lazy extremes (every/always/never/everyone)** | `structures.md:133` | 17 hits, and in this product they are **contractual guarantees**, not rhetorical inflation: `trust-privacy.body`'s "never" is the **C6 wartime-geo promise** from `PROJECT_SEED §3`. Banning it forces a hedge — which `SKILL.md:27` "Trust readers" forbids. The skill contradicts itself; resolve for `SKILL.md:27`. |
| **"Cut quotables"** | `SKILL.md:29` | Actively harmful. `GuideTopic.tip` is documented in-file as "The one gotcha worth knowing — rendered as a distinct callout line" (`guideContent.ts:45`) and is the only field with its own length gate (220 chars). Its job **is** to be quotable. |
| **"No Wh- sentence starters"** | `structures.md:112` | 3 hits, all good, including the topic title "What is real here". A reference guide answers wh- questions by definition. |
| **"Questions answered immediately"** | `structures.md:123` | 6 hits, all deliberate framing: `plan.lead` "PLAN answers: what will the light do at this spot?"; `find.lead` "…on which days does it stand inside THIS view?". Clearest possible framing for a planning instrument. |
| **Blanket passive-voice ban** | `structures.md:95-106` | 10 hits (`:386, :451, :648, :649, :671, :726, :926, :955, :1014, :1023`). The suppressed actor is the application; "Plux paints the rail" is **worse** than "The rail is painted with the day's light". Advisory only. |
| **"Vary rhythm / mix sentence lengths / end paragraphs differently"** | `SKILL.md:25` | Unenforceable and unmeasurable under a 5-sentence cap with no paragraph tier. |
| **i-have-adhd Rule 6 (concrete time estimates)** | `SKILL.md:82-87` | Tempts invented numbers. The guide's figures are already concrete and evidence-bound ("451 named stars" `:512`, "about one arcminute" `:1021-1022`). One genuine gap exists — nobody has measured what a 1Y FIND scan costs (`find-chips` `:741`) — **measure it in-browser or leave it out**. |
| **i-have-adhd Rules 5 / 7 / 8 taken literally** | `SKILL.md:73-101` | Conversation-turn rules. A document has no turns and no completed work to report. Adding "step 3 of 11" counters or "you have now learned…" lines is exactly the ceremony the skill's own eval case `casual-message` penalises. |
| **Global brevity caps** | i-have-adhd generally | Already gated and already terse (mean body ~36 words). `SKILL.md:121` plus three eval cases (`concept-explanation`, `long-form-request`, `complex-plan`) **explicitly forbid** trading needed detail for brevity. |
| **A blanket `tldr?` field on all 67 topics** | derived | Adds text to 51 topics whose body is already one answer-first sentence. Only 8 bodies are long enough to justify it (`mobile-chips` 80 w, `mobile-map` 78, `target-radar` 75, `fpv-cone` 71, `fpv-map-controls` 71, `trust-accuracy` 68, `start-shells` 67, `move-deck` 67) — and for those the honest fix is G-B's `list` field plus a shorter body, not a new summary line. |

**Cross-skill conflict to hold in mind:** i-have-adhd `SKILL.md:135` explicitly **protects** hedges —
"Keep a hedge that carries real uncertainty; deleting it manufactures confidence." A naive slop pass
would strip "accurate to about one arcminute" (`:1021-1022`) and "brightness forecasting carries real
uncertainty" (`:1024-1025`). Stripping them is a **factual regression**, which the skill's own rubric
marks `blocker: true`.

---

## 4. G-E — the SEARCH slice, at implementation detail

**Golden fixture first (G-A), then every change below, then re-baseline.** SRCH-1/2/4/5/6/7/8/14 are all
ranking changes and none is safe to land without the fixture.

### 4.1 Alias / synonym table — home and fence

`GuideTopic.keys?: string[]` on the topic, in `src/lib/guide/guideContent.ts` (shared tier, fence-safe;
an optional interface field is invisible to knip). Indexed in `topicDoc` (`search.ts:77-93`) at a weight
between `tip` (1.5) and `steps` (1) — **not** folded into `prose`, so snippets never quote an alias.

Zero-result queries measured against the live index — all return `[]` today: `lens`, `shutter`, `login`,
`log in`, `offline`, `minimap`, `milkyway`, `android`, `tablet`, `ghosting`, `36h`. And `re-centre` /
`recentre` never reach `fpv-map-controls` (`guideContent.ts:343-364`), the topic that documents the
button.

**Anti-drift fence (mandatory, and tighter than the obvious version):** a new test asserting each `keys`
entry either (a) appears in `allCopy()` text, or (b) matches a **rendered** string in
`src/components/**` — JSX text children, `aria-label=`, `placeholder=`, `title=` values **only**, never
raw file text. Raw-text matching would bless `"RE-CENTRE"`, which exists only in comments
(`MapWindow.tsx:85`, `:119`, `map-window.css:165`) and **is never rendered**: the on-screen control is
the glyph ◉ with `aria-label="Centre the map on me"` (`MapWindow.tsx:985`).
**Also extend `allCopy()` to walk `keys`** — otherwise aliases escape the voice lint entirely (this is
the argument for landing SRCH-14 captions *before* aliases: captions are already inside the lint's reach
at `guideContent.test.ts:29`; aliases are not until you extend it).

### 4.2 Scoring changes

| # | Change | Site | Measured effect |
|---|---|---|---|
| 1 | **Exact-match bonus**: `final *= 1 + 0.35 * (exactTermsMatched / tokens.length)` | `search.ts:230` | With #2+#3: `plan`→`plan-open`, `exif`→`photo-upload`, `aim`→`move-aimstick`, `save`→`save-place`, `pin`→`move-pin`. **Note the honest limit**: the bonus is a no-op wherever all competing docs carry the exact term — it cannot rescue `sky` or `foc`. |
| 2 | **Fuzzy d1 floor 4 → 5 chars** | `search.ts:147` (`dMax` ladder) | Kills `exif`→`fpv-exit` and `plan`→`time-play` (fuzzy "play"). |
| 3 | **Prefix `minLen` 3** | `search.ts:152` | Kills the 2-char prefix explosion. `expandToken("re")` today = re/red/real/read/reads/reset/result/return — which is why `re-centre` returns `target-search`(5.442) / `time-scrub`(4.533) / `time-play`(3.006). All 2-char *exact* vocabulary survives (`3d`, `2d`, `80`, `75`, `36`, `1w`, `1m`, `6m`, `1y`, `30`). |
| 4 | **Sort expansions by `w × idf`, per-tier caps ~16 prefix / 4–6 fuzzy** | `search.ts:153`, `:159` | Today `.slice(0,8)` ordered by term **shortness** silently drops the intended term: `"co"` (37 candidates) keeps come/cone/copy/core/comet/comes/covers/corner and **drops compass, controls, compose, constellation**; `"ma"` (15) drops market, marketplace, magnitude. This is what unblocks `comp` → a compass doc. Timing headroom is ample (0.49–0.76 ms/query measured). |
| 5 | **Title-substring multiplier ×2.0, gated on ≥2 query tokens** | new, in the scorer | ×1.6 is **not enough** — `STAND IN IT` only reaches rank 2. ×2.0 makes it rank 1 and also fixes `PLAN`. **SRCH-2 and SRCH-8 propose the same three lines — ship them as ONE change so the constant is chosen once against one fixture.** |
| 6 | **`stripInline` returns the TITLE for a bare `[[id]]`** | `search.ts:43-45` | Five bare links leak raw ids into the index: `[[move]]` `:99`, `[[fpv]]` `:100`, `[[save]]` `:103`, `[[trust]]` `:125`, `[[mobile-map]]` `:152`. Result: `postings.get("fpv") === [start-loop]` only, `postings.get("mobile") === [move-orbit]` only, and `"FPV"` appears **zero** times as a literal in the module. All **three** renderers already resolve bare ids to `GUIDE_INDEX.get(id).title` (`Guide.tsx:46`, `GuideSheet.tsx:37`, `guide.astro:25`) — search is the only consumer that does not. This is a **cross-surface parity bug**, i.e. owner order 3. |
| 7 | **Index media captions** at weight 0.75, kept out of `prose` | after `search.ts:81` **and in `chapterDoc` `:95-103`** | Captions are the most literal UI-label text in the corpus and are never indexed: `postings.get("pads")`, `("credit")`, `("portrait")` are all empty. **The topic-level loop alone does NOT fix the motivating case** — GOTO lives in a *chapter* caption (`:498`), so `chapterDoc` must change too. Watch `fpv-map-controls` (len 197.5 vs avgLen 68.94) for length inflation. |
| 8 | **Glyph map** ◉ ∠ ⌖ ▲ ▼ ◎ ▤ ⊞ ▦ ✕ → word, **query-side**, living in `lib/guide/` | new; do **not** touch `searchIndex.ts:68` | `searchGuide("◉")`, `("∠")`, `("/m")`, `("N")`, `("36h")` all return `[]` today, while `"∠ RADAR"` works (the word carries it). Copy the GREEK-map idiom at `src/lib/sky/searchIndex.ts:34-59`; keep the guide map in `lib/guide/` so the sky finder's normalization is untouched and knip sees one owner. |

**Presentation (SRCH-12)**: `<mark>` the matched terms inside the existing `.gd-hit` button (additive, no
new element tier — note `guide.css:353` is `.gd-steps li::marker`, unrelated); a kind pill distinguishing
chapter from topic (`kind` is already on every hit, `search.ts:27`); a per-chapter cap applied **AFTER**
ranking (`map` returns 5/8 rows from `fpv`, `photo` 5/8, `target` 5/8, `save` 4/8 — a pre-rank cap would
drop `fpv-map-controls`, the answer to half the alias queries); an `aria-live` count on the result list
(`grep aria-live` across both shells = 0 hits today).

### 4.3 DECLINE (record in DECISIONS with the numbers)

K1/B retuning is **measurably inert** at N=78: two independent 40-query sweeps agree —
K1 1.2/1.6, B 0.35/0.8 each move 2/40 top-1 results; the aggressive K1 0.9/B 0.4 moves 4/40. Also decline:
stemming (bidirectional plurals already work — `verdicts`↔`verdict`→`plan-verdicts`, `sunsets`→
`find-sunsets`), swapping in a search library, and click-learning. **Soften one decline**: "did you
mean…" was declined on the theory that the fuzzy ladder absorbs typos silently — but `exif`→`fpv-exit`
is a silent **wrong** answer, not a silent correction. Re-check a matched-term echo after change #1.

### 4.4 Golden queries — the curated rows

`✗` = fails today. Rows marked *top-3* are pinned as top-3 because the "correct" answer is genuinely
arguable (`save-places` and `photo-pins` are defensible for `save`; `find-sunsets` for `sunset`).

| # | Query | Expected top hit | Today | Fixed by |
|---|---|---|---|---|
| 1 | `exif` | `photo-upload` | ✗ `fpv-exit` (fuzzy "exit") | 4.2 #1, #2 |
| 2 | `plan` | `plan` (chapter, "PLAN") | ✗ `time-play` (fuzzy "play") | #2, #5 |
| 3 | `STAND IN IT` | `fpv` (chapter) | ✗ `find-standings` | #5 at **2.0** |
| 4 | `sky` | `target` (chapter, "SKY TARGETS") | ✗ `trust` (prefix "skylines") | #5 |
| 5 | `foc` | `fpv-focal` | ✗ `move-search` (prefix "focus") | #4 |
| 6 | `aim` | `move-aimstick` | ✗ `target-search` (prefix "aims") | #1 |
| 7 | `re-centre` | `fpv-map-controls` | ✗ `target-search` | **alias only** (#3 alone is not enough — measured) |
| 8 | `comp` | a compass-bearing doc (`move-deck` \| `mobile-chips`) | ✗ `fpv-hud` | #4 |
| 9 | `FPV` | `fpv` (chapter) | ✗ 1 hit, `start-loop` | #6 |
| 10 | `mobile` | `mobile` (chapter) | ✗ 1 hit, `move-orbit` | #6 |
| 11 | `goto` | `target-toggles` | ✗ `[]` | #7 (**chapter** captions) + G-C item 14 |
| 12 | `◉` | `fpv-map-controls` | ✗ `[]` | #8 + alias |
| 13 | `/m` | `mobile` (chapter) | ✗ `[]` | #8 |
| 14 | `my spot` | `fpv-enter` | ✗ rank 3 (`plan-npf` \| `plan` \| `fpv-enter`) | #5 |
| 15 | `explore` | `start-explore` (**new**) | ✗ 4 false positives | G-C item 15 |
| 16 | `keyboard shortcut` | `keys` (**new**) | ✗ 1 hit, `fpv-walk` | G-C item 16 |
| 17 | `lens` \| `login` \| `minimap` \| `offline` | *top-3*: `fpv-focal` \| `save-links` \| `move-minimap` \| `trust-airless` | ✗ all `[]` | alias table |
| 18 | `meteor` | `plan-meteors` | ✓ (regression floor — `guideSearch.test.ts:22`) | must stay |
| 19 | `save view name` | `save-place` | ✓ (coverage multiplier, regression floor) | must stay |
| 20 | `qqxxyyzz` / `tripod` / `refund` / `discord` | `[]` | ✓ | must stay |

**Known tension to resolve against the fixture, not by assertion:** change #1 pushes `plan`→`plan-open`
while change #5 pushes `plan`→the `plan` chapter. Pick the constant once, with all 20 rows plus the 88
derived rows green.

---

## 5. G-F — the surface-parity slice

### 5.1 Field × surface matrix (measured)

| Capability | Desktop `Guide.tsx` | `/m` `GuideSheet.tsx` | `/guide` `guide.astro` | Verdict |
|---|---|---|---|---|
| Goal router (10) | **START chapter only** `:257` | index root `:159-169` | permanent, top `:74-86` | **GAP** → SURF-11 |
| Goal → topic precision | topic `:110-116` | topic `:95-100` | **chapter only** `:80` | **GAP** → SURF-3 / IX-7 |
| Chapter TOC | rail `:220-229` | list `:171-180` | `.g-toc` `:87-89` | ok |
| **Topic-level TOC** | **none** | **none** | **none** | **GAP** → SURF-2 |
| Search input | rail, always `:181-195` | **index view only** `:126-133` | **absent** | **GAP** ×2 → SURF-8, SURF-1 |
| Search snippet | yes `:212` | **dropped** `:146-149` | n/a | **GAP** → SRCH-10 |
| Esc clears query first | yes `:188-194` | **no handler** | n/a | **GAP** → IX-4 |
| `where` lines before body | `:58-76` | `:49-67` (mobile-first, "HERE") | `:106-115` | ok |
| `media.shell` | width only (62 %) | width only (62 %) | width only (46 % / 70 % <480 px) | NIT → SURF-7 |
| `media` w/h reserved | no `:32` | no `:23` | **wrong 720 on 9 shots** `:99` | **GAP** → G-B |
| Crosslinks | buttons `:38-52` | buttons | `#anchors` `:21-29` | ok (two grammars: `data-gd-topic` vs `id=`) |
| `NEXT ·` chapter | `:275-279` | `:207-211` | **footer link to `/` only** `:136-138` | **GAP** → SURF-2/IX-6 |
| `PREV ·` | none | none | none | GAP → G-C item 18 |
| Sticky location indicator | **header scrolls away** `:234-235` | `:196-199` | `.g-top` sticky `:163-166`, TOC top-only | **GAP** ×2 → SURF-4, SURF-5b |
| Measure cap | **none** (≈330 chars at 2560 px) | n/a | 62–66ch `:272/:304/:311/:329` | **GAP** → SURF-5 |
| `h1` | n/a | n/a | **none** (`:75` and `:95` are both `h2`) | **GAP** → SURF-9 |
| Deep link to a topic | **none** | **none** | `#id` works `:104` | **GAP** → IX-2 |
| Linked from the shell | itself only | itself only | **unlinked from both shells** | **GAP** → SURF-12 |

### 5.2 What to do about each gap

- **SURF-3 / IX-7 (S, do first — cheapest parity win in the set).** `guide.astro:80` →
  `href={'#' + g.target}`. Every goal target is guaranteed rendered (chapters `:93-94`, topics
  `:103-104`) and `guideContent.test.ts:89-92` already proves resolution; `scroll-margin-top: 64px` is
  already on `.g-topic` (`:278`). **Update the docstring at `guide.astro:6` in the same edit** — it
  currently documents the old behaviour. Add a three-surface agreement test (same goal → same node id):
  the cheapest possible enforcement of the owner's "all three reference the same resources".
- **SURF-2 (M).** Add a topic tier to all three TOCs — **but land the nav bug FIRST**. `nav(id)`
  (`Guide.tsx:110-116`) sets `pendingTopic.current` then `setChapterId(ref.chapterId)`; the scroll
  effect's deps are `[chapterId, open]` (`:157`). Clicking a topic in the **current** chapter sets an
  identical value → React bails → the effect never re-runs → **no scroll**. `GuideSheet` has the
  identical shape (`:95-100`, deps `[chapterId]` `:117`). This is live today: two same-chapter
  crosslinks (`move-minimap → move-aimstick`, `target-toggles → target-ghosts`) do not scroll on either
  island. Fix = a monotonic `navSeq` in the deps, or scroll directly when
  `ref.chapterId === chapterId`. ~4 lines × 2 files, and **worth shipping even if the topic tier slips**.
- **SURF-8 (S).** Hoist `/m`'s search input above the `if (!chapter)` split at `GuideSheet.tsx:121`;
  render `q ? hits : (chapter ? chapterView : indexView)`. The hit handler already clears the query
  before `nav()` (`:141-144`). **Keep `hostRef` on the single outer `.m-guide` div in every branch**
  (`:125`, `:195`) — `:103-117` resolves the scroller via `host.closest(".m-sheet__body")`. No new
  imports, so the fence is untouched. Add the snip line (`:146-153`) in the same edit.
- **SURF-1 (M) — `/guide` search.** Use a plain bundled `<script type="module">`, the idiom already
  proven in this repo at `src/pages/index.astro:256-266` (a non-`is:inline` script importing from
  `../lib/geo/urlPose`). Import `searchGuide`, wire an input into `.g-top`, set
  `location.hash = '#' + hit.id`. **A bundled script creates no server island and no `define:vars`, so
  T24 properties (a)(b)(c) are untouched — only the re-verify trigger fires.** State the budget: it
  pulls `guideContent.ts` (46,380 B) + `searchIndex.ts` (6,075 B) into the page bundle, ~52 KB raw of
  text the page already server-rendered. **This reverses a written invariant** (`guide.astro:3-6`, "zero
  client JS, plain server-rendered HTML with real anchors") — amend the docblock in the same commit,
  and put the cheaper alternative in front of the owner first: expand `.g-toc` `:87-89` from 11 chapters
  to a chapter→topic outline so all 67 topics are reachable by browser Ctrl+F, which is the no-JS
  reader's native search and costs nothing.
- **SURF-4 (S).** `.gd-head` (`guide.css:200-204`) is the first child of the `overflow-y:auto`
  `.gd-scroll` (`:188-198`), so it scrolls away. Add `position: sticky; top: 0; z-index: 1` **and a
  background** — `.gd-scroll` has `gap: 10px`, so a transparent sticky band lets the lead show through;
  reuse `guide.css:45`'s `color-mix(in srgb, var(--color-bg) 92%, transparent)` (`.gd-panel` already has
  `backdrop-filter: blur(10px)` at `:46`). Sticky keeps the element in flow — nothing below reflows.
- **SURF-11 (S, in the SURF-4 header).** The goal router is desktop-visible only inside START
  (`Guide.tsx:257`). Add a `↺ GOALS` affordance in the new sticky header calling `nav("start")`.
  **Do NOT move the router into the rail** — that is a relocation (not an addition) under the frozen-
  desktop rule, and the 10 rem rail (`guide.css:77-79`) already carries title, search and 11 chapters.
- **SURF-5 (S).** None of `.gd-scroll`, `.gd-body`, `.gd-lead`, `.gd-steps`, `.gd-tip` has a
  `max-width`; the panel is `min(56rem, 92vw)` (`:38`) with the resize clamp at `DragGrip.tsx:171-178`.
  Match the page exactly: lead/steps/tip 62ch, body 66ch. Keep figures full width. Inert at the resize
  floor, so the small case cannot regress.
- **SURF-9 (S).** `guide.astro` has **no `h1`** — `:75` (kicker) and `:95` (chapter) are both `h2`,
  and the page title is a span at `:66`. Swap the title span to `h1`; `.g-title` is class-selected
  (`:189-194`) so the mono micro-type survives. **Its SEO half is currently unrealized** — there is no
  `robots.txt` or sitemap in `public/`, and `/guide` is unlinked; the screen-reader/outline half stands
  alone, and pairing with SURF-12 is what makes the SEO argument true.
- **SURF-12 (S).** `grep -rn '"/guide"' src/` returns exactly two link sites, **both inside the guide
  itself** (`Guide.tsx:241`, `GuideSheet.tsx:182`). Add a nav link to `src/pages/index.astro:207-227`
  (the `.topnav` `<nav>` that already carries `/m`), and a `/m` path too (SURF-8 is restructuring that
  view anyway). Separately, try `export const prerender = true` — `astro.config.mjs:69` is
  `output: "server"` with zero `prerender` exports repo-wide, so `/guide` server-renders a 46 KB module
  on every request. A prerendered page has **no per-request render path at all**, which shrinks the
  astro@5.18.2 advisory surface for the only file using `set:html`. **Build and check `dist/` for
  `guide/index.html` against the Wix adapter before claiming it works — UNVERIFIED for this adapter.**
  Prerendered pages still ship bundled scripts, so it composes with SURF-1.
- **SURF-7 (NIT, do last or not at all).** Shell badges on shots. Phone shots are already visually
  distinct (360×783 rendered at 46–62 % against 720×450 desktop shots) and every topic already prints
  DESKTOP/PHONE lines. If it lands, put the badge strings in `guideContent.ts` as a tiny exported map so
  the voice lint keeps reach (`allCopy()` walks content only), and reuse `.gd-where b` (`guide.css:329-333`).

---

## 6. G-G — the interactivity slice

Only candidates that survived verification. SKIP verdicts stay visible.

### DO

- **IX-3 — Esc inside the guide unwinds FPV (a live bug), S.** `Guide.tsx:132-139` registers a
  bubble-phase `window` keydown; `StylizedTiles.ts:1690` registers another at mount, whose Escape branch
  (`:1572-1597`) closes the sky menu → disarms a building → closes the map window → exits explore →
  exits photo FPV → clears `tempFpv` → clears `tempPin`. Globe wins, so Esc in the guide **also exits
  first-person view**. Same trait in `Marketplace.tsx:50-55` and `MyPins.tsx:104`.
  **Fix with a CAPTURE-phase window listener** (`addEventListener("keydown", onKey, true)` +
  `stopImmediatePropagation()`): capture fires before every bubble-phase window listener **regardless of
  registration order**, so the guide owns Escape with **zero globe edits** — which matters, because
  `archive/GUIDE_PLAN.md:120` makes "no globe/lib edits" a per-session done gate. (The bug is
  intermittent today because `Guide.tsx:188-194` already `stopPropagation()`s while the search box holds
  a non-empty query.)
- **IX-2 — deep-linkable topics via `?guide=<id>`, NEVER `#guide=`. M.** The instrument **owns and
  overwrites** the hash: `StylizedTiles.ts:3380-3383` rebuilds the whole hash and
  `history.replaceState`s it every ~1.6 s (`tuning.ts:2469-2471`; `scripts/shoot-guide.mjs:212-214`
  documents the same trap). And both parsers are anchored — `src/lib/geo/urlPose.ts:58`
  `/^#?p=([^#&]+)(?:&t=\d+)?$/` — so `#p=…&guide=…` silently boots a shared pose to the default camera.
  A **query param** is safe and has a proven precedent: `Marketplace.tsx:58-68` reads `?purchased=1`,
  strips it, and replaceStates "keep the `#p=` pose hash". Outbound is free too: `Guide.tsx:239-248`'s
  ↗ link can carry `href={'/guide#' + activeId}` today.
  **`/m` prerequisite:** `MobileShell.tsx:35` owns sheet visibility in **local React state** and
  `GuideSheet` mounts only when `sheet === "guide"` (`:106-110`), so the param read must live in
  `MobileShell` and pass a seed topic down. Also note `index.astro:52-54` skips the `/m` auto-redirect
  for **any** query string — the desktop link with `?guide=` will not bounce a phone to `/m`.
  **DROP** the "write the guide id back into the instrument URL" half unless `urlPose.ts` gains a `&g=`
  key and the `StylizedTiles` formatter preserves it — that is a design change to a shipped
  sharable-pose contract (`conventions/contracts.md §1`), not an additive effect. Owner call.
- **IX-6 — goal ROUTES, M/L (the best interactivity-per-risk item after IX-7).** `GuideGoal` is
  `{goal, target}` (`guideContent.ts:58-62`). Add `route: string[]` with `target = route[0]`; render a
  numbered `STEP n OF m · <next title> →` footer reusing the shipped NEXT mechanic
  (`Guide.tsx:275-279`); on `/guide` render the route as an ordered list of real anchors — post-IX-7 that
  is the cheapest and clearest surface. `start-loop` (`:92-105`) is already a five-step prose route with
  4 of 5 steps crosslinked, so the pattern exists. Extend `guideContent.test.ts:89-92` to validate every
  id in every route. Keep routes to 3–5 steps. **Decide `foldGoals` scope explicitly** (`search.ts:106-114`
  currently folds each goal phrase at weight 1.5 onto its single target): step-1-only, or all steps.
- **IX-4 — focus hygiene + `/`-to-search, M.** `Guide.tsx:175` sets `role="dialog"` while
  `grep "focus|tabIndex|aria-modal" Guide.tsx` returns **nothing** — the accessibility claim is unbacked.
  DO: focus-in on open, focus-restore to the Guide toggle on close, `/` scoped to the open guide reusing
  the existing `typingTarget` test (`StylizedTiles.ts:1531-1534`; `j`/`k` are free but **SKIP** vim keys),
  arrow-through-hits + Enter, and port `Guide.tsx:188-194`'s layered Esc into `GuideSheet` (which has
  `onChange` only, `:126-133`). **On `/m` route every focus through
  `src/components/mobile/useSheetInputFocus.ts`** — `mobileFence.test.ts:116-121` fails on any React
  `autoFocus` under `components/mobile/**` and `:123-132` fails on any `.focus(...)` without
  `preventScroll`. **Do NOT build a focus trap** in a non-modal window floating over a live globe.
- **IX-5 — images, NIT after measurement.** The desktop-lightbox rationale is **refuted**: desktop shots
  render at ~95 % of native inside the panel and `/m`-tagged shots are **upscaled 1.18×**, so a lightbox
  "at natural size" would make them smaller. **Keep only two things**: the zero-JS `/guide` half —
  `<a href={m.src} target="_blank" rel="noopener">` around each `<img>`, one line, print-safe, honours
  `guide.astro:3-6` — and `/m` tap-to-enlarge, the one shell where the shot really is downscaled (62 % of
  a ~360 px sheet ≈ 223 px, `chrome.css:925-927`). Everything else waits on 2× re-shoots (G-I). If images
  ever become primary content, revisit the `alt=""` on all 13.

### SKIP — with the reason kept visible

- **IX-1 — "SHOW ME" buttons that drive the instrument from the guide. L, owner call.** The mechanism is
  *proven*, not speculative: cross-island store writes already ship (`PlanFindToggle.tsx:16-28`,
  `TargetPanel.tsx:5-6`). Two hard blockers: (1) `/m` sheet visibility is **local React state**
  (`MobileShell.tsx:35`), so `usePlanStore.setOpen(true)` does not open the `/m` PLAN sheet and
  "dismiss-on-arm" is unreachable from inside `GuideSheet` — it needs either a store lift or an
  `onDemo(id)` callback threaded from `MobileShell`; (2) `camera.ts:351`
  `setTempFpv: (on) => set((s) => (on && s.tempPin === null ? {} : { tempFpv: on }))` — a SHOW ME on
  `fpv-enter` is a **silent no-op** without a temp pin. Re-open only after the `/m` state question is
  decided once (it is the same lift IX-2/IX-3 would want).
- **IX-8 — read-state / progress markers.** Skip. This is a 67-topic reference document, and the owner's
  own anti-slop order exists to strip exactly this class of gamification. If continuity is ever wanted:
  **one** key `ftw:guide-last:v1` holding a single topic id, sanitized on read (the `src/lib/prefs.ts:1-13`
  pattern), registered in `conventions/contracts.md §2` in the same commit, and **never rendered on
  `/guide`** (SSR page, no session).
- **IX-9 — coach-mark journeys.** Formally **unruled**, and the zero-result grep over both DECISIONS
  files is what makes that trustworthy. `archive/GUIDE_PLAN.md:13` lists it under G3 as "optional, owner
  call"; `:100-103` specifies three tour journeys; `:113-114` scopes a coach-mark primitive in `ui/`
  (which the fence bans from `/m`, `mobileFence.test.ts:53-63`); `tracked-backlog.md:37` (T28) carries it
  as "OPEN — owner-taste class; no engineering blocker". **Report it, ship IX-6 first, re-open only on
  owner request.**
- **IX-10 — per-topic feedback widgets and freshness stamps.** Skip both. Accuracy is already
  machine-enforced (`guideContent.test.ts` + the warm-list coupling at `scripts/warm-prod-assets.mjs:22-28`)
  and a feedback endpoint needs `elevate()` plus moderation. The honest freshness line, if wanted, is a
  single `/guide` footer note naming the last shoot date — checkable, because `shoot-guide.mjs` dates each
  file. Pair it with G-I so the date means something.

---

## 7. G-D — T41, the focal dichotomy

**Owner ruling (`tracked-backlog.md:50`): ACCEPTED AS-IS. No code change. Document it in BOTH registers.**

**The mechanism, verified — and simpler than the backlog row implies.** Inside FPV both readouts derive
from the **same** live vertical FOV: `Joystick.tsx:115-117` computes
`hFovNow = s.fpvHud ? horizontalFovDeg(s.fpvHud.fovDeg, s.fpvHud.aspect) : (s.plannedView?.hFovDeg ?? null)`.
So one number is `focalFromVerticalFov(vFov)` = `24 / 2 / tan(vFov/2)` against the full-frame **height**
(`src/lib/decode/sensors.ts:145-156`, consumed by `FpvHud.tsx:105`, `FpvControls.tsx:124`,
`CameraTiltPanel.tsx:250`, `SpotStarsCard.tsx:43`, `PlanSheet.tsx:493`, `MyPins.tsx:190`), and the other is
`focalMmFromHFov(hFov)` = `18 / tan(hFov/2)` against the full-frame **width**
(`src/lib/geo/plannedView.ts:21-25`, sole consumer `Joystick.tsx:168`). **The divergence is purely the
sensor axis — there is no second source of truth.** The guide mentions none of this: a grep for
`full-frame|35 ?mm|vertical|horizontal|aspect|3:2|millimet` across the whole module returns **one** hit,
"millimetres" at `guideContent.ts:224`.

### 7.1 Guide home — a new topic `fpv-focal-axes`, placed immediately after `fpv-focal`

```ts
{
  id: "fpv-focal-axes",
  title: "Why two focal numbers",
  where: { desktop: "FOCAL on the HUD card · mm under the AIM stick",
           mobile:  "FOCAL in the HUD row · mm under the AIM stick" },
  body:
    "Two readouts describe one view and they measure different edges of the frame. " +
    "The HUD's FOCAL is the 35 mm-equivalent across the frame's HEIGHT; the AIM stick's mm " +
    "footer is the equivalent across its WIDTH. On a 3:2 frame they agree. On a tall phone " +
    "frame the HUD reads much shorter, because a tall frame is wide in one axis and narrow " +
    "in the other. Read the one that matches how you crop — a landscape crop follows the " +
    "AIM stick, a vertical crop follows the HUD.",
  tip: "Same view, two edges. Neither number is a correction of the other.",
},
```

Five sentences (the cap is 5, `guideContent.test.ts:137-140`), tip 62 chars (cap 220). Contains no banned
token from the existing six regexes or the four new ones in §3.1. Then append
` · [[fpv-focal-axes|why two numbers]]` to `move-aimstick` (`guideContent.ts:224`) and crosslink from
`fpv-hud`.

**BINDING: do not hard-code "23 MM vs 75 MM".** `Joystick.tsx:116` proves the ratio is
`horizontalFovDeg(vFov, aspect)`-dependent, so any literal pair is viewport-specific and becomes the next
drift — exactly the class of bug G-C spends a slice fixing.

### 7.2 Engineering home — `.claude/conventions/globe-tuning.md`, section **"Traps that keep resurfacing (violations = bugs)"** (`:66`)

Not `contracts.md` — that file is the Hyrum inventory of *strings* (URL grammars `§1`, localStorage keys
`§2`, `window.__*` seams `§3`), and this is a units-and-axes convention, which is what the traps section
is for. Add a dated row naming: the two constants (`FULL_FRAME_HEIGHT_MM = 24` at
`src/lib/decode/sensors.ts:146`; the `18 =` 36/2 width half-constant inside `focalMmFromHFov` at
`src/lib/geo/plannedView.ts:21-25`), the two functions, **the full consumer list of each** (six call sites
for the height path, one for the width path), the fact that they agree at 3:2 and diverge with aspect,
the `Joystick.tsx:115-117` line proving one FOV feeds both, and the owner ruling with its date. The trap
this prevents: a future contributor "fixing" one readout to match the other and silently breaking the
photographer's width-based number, or adding a seventh consumer on the wrong axis.

Then flip `tracked-backlog.md:50` from OPEN-DOCS to CLOSED with both doc pointers.

---

## 8. RISKS

1. **T24 — `set:html` (`tracked-backlog.md:33`).** The four sites are `guide.astro:96, :115, :119, :123`
   and they are the **only** `set:html` in `src/`. They are safe today because of exactly three
   properties: (a) input is the compile-time `guideContent` module; (b) every text run and every link
   label is escaped through `escapeHtml` (`guide.astro:21-32`, which handles `& < >` only — hence
   **never in attribute position**); (c) the one emitted attribute is `href="#${run.target}"` and
   `run.target` is group 1 of `LINK_RE = /\[\[([a-z0-9-]+)…/` (`inline.ts:24`), so
   `[[a" onmouseover=x|L]]` cannot match and yields a plain text run. **G-B, G-C, G-F and G-G all want
   to edit `guide.astro` this session.** Mitigations, in order: land G-A's source-shape test **first**;
   never route search hits, list items, badges or route steps through `set:html` (plain text nodes only);
   re-run the extended formula and write the dated re-check into `tracked-backlog.md:33` in the same
   commit. Note the row's "zero island components" means zero **server** islands
   (`grep -rn 'server:defer' src/` → exit 1) — a bundled `<script>` or a `client:*` island does not touch
   the `/_server-islands/[name]` sink, and client islands already ship (`index.astro:241`).
2. **Mobile fence (`test/components/mobileFence.test.ts`).** Rule 1 is a **blacklist** of
   `components/panels|ui` imports from `components/mobile/**` (`:53-63`), not an allow-list — the shared
   tiers are `lib/**`, `store/**` and `components/controls/**`. Every content-model field lands in
   `lib/guide/**` and is safe, but each costs **three renderer edits** that cannot share code across the
   fence: cost every proposal at 3×. `/m` focus work must go through `useSheetInputFocus` (`:116-146`
   fails on bare `autoFocus` and on `.focus()` without `preventScroll`). `Slider.tsx`/`Encoder.tsx` are in
   `components/ui/`, i.e. desktop-only by construction — which is why the new `keys` topic is
   desktop-scoped.
3. **Frozen desktop (additive-only).** SURF-4 (sticky property on an existing rule), SURF-5 (max-width on
   existing rules), SURF-11's header affordance, `<mark>` children and a kind pill inside the existing
   `.gd-hit` button are all additive. **Moving the goal router into the rail is a relocation, not an
   addition — declined.** So is reordering `GUIDE_CHAPTERS` (G-C item 18).
4. **Warm-prod-assets coupling.** `guideContent.test.ts:106-117` requires every `media.src` to exist under
   `public/` **and** to appear verbatim in `scripts/warm-prod-assets.mjs:25-28`. A release resets the
   asset edge cache cold (the 2026-07-16 outage lesson, `guideContent.ts:14-16`). Any new shot in G-I must
   be added to both. G-B's w/h gate adds a third coupling: declared dimensions must match the file header,
   so a re-shoot that changes a size now fails loudly instead of drifting.
5. **Guide test gates are the real design constraint.** ids unique (`:45-56`) · every crosslink resolves
   (`:82-87`) · every goal target resolves (`:89-92`) · steps 1..6, each >3 chars (`:65-73`) · bodies ≤5
   sentences split on `/[.!?](?:\s|$)/` (`:137-140`) · tips ≤220 chars (`:144`) · six BANNED regexes
   (`:122-129`). Every proposal in G-C was checked against these and fits, but the step-splitting in §3.1
   has **no headroom** on `mobile-gestures` (already 6) and one step of headroom on `fpv-map-controls` and
   `fpv-height` (5 each) — a split there forces a topic split. And `test/lib/guide/guideSearch.test.ts`
   pins four specific top hits (`meteor`, `radar`, `unfollow`, `save view name`): **any** copy edit, new
   goal row (folded at weight 1.5, `search.ts:106-114`) or caption index changes the corpus, so run the
   suite before and after every G-C/G-E edit.
6. **Prerender + Wix adapter (SURF-12) is UNVERIFIED.** Astro 5 supports per-route `prerender` under
   `output: "server"`, but this adapter's behaviour here is untested. Build and check `dist/` for
   `guide/index.html` before claiming it works.
7. **Owner questions that must not be answered by the session** (write them to
   `.claude/BLOCKING_QUESTIONS.md` only if they block a commit): the `CameraTiltPanel.tsx:65-68` memo
   wording (COV-1) · the Explore-link occlusion (COV-5) · chapter reorder (COV-18c) · adding JS to
   `/guide` against its written charter (SURF-1) · IX-1 SHOW ME · a `&g=` hash key (IX-2c) · the eight
   re-shoot crops (T42, owner taste).

---

## 9. NOT DOING (explicit)

- **Not banning em dashes.** 4,647 in `src/**`, 652 in `guideContent.ts` alone. House style wins; the
  skill breaks its own rule at `examples.md:45`.
- **Not truncating three-item lists**, not banning `never`/`every` (the C6 privacy guarantee lives in
  `trust-privacy.body`), not killing `-ly` words (`exactly`, `automatically`, `hourly` are the precision),
  not "cutting quotables" (that is the `tip` field's job), not banning Wh- openers, not chasing "vary
  rhythm" under a 5-sentence cap. Reasons per row in §3.3.
- **Not adding a blanket `tldr?` field**, not adding per-topic progress counters, read-state checkmarks,
  "you have now learned…" lines, or a feedback widget (§6 IX-8/IX-10).
- **Not building coach marks** (IX-9 — unruled, owner call).
- **Not building SHOW ME buttons** this session (IX-1 — blocked on the `/m` local-state question and the
  `camera.ts:351` no-op trap).
- **Not writing the guide hash into the instrument URL** (IX-2c — the pose grammar is an anchored public
  contract and the globe overwrites the whole hash every ~1.6 s).
- **Not reordering `GUIDE_CHAPTERS`** (COV-18c — owner call; the `where.mobile` backfill delivers most of
  the benefit with no ordering risk). *(The screenshot-staleness objection to reordering is refuted —
  none of the 13 media entries is a shot of the guide UI.)*
- **Not retuning K1/B, not adding a stemmer, not swapping in a search library, not adding click-learning**
  (§4.3 — two independent 40-query sweeps show the curve is inert at N=78).
- **Not re-shooting `orbit.webp`** for the camera-deck fix — the current shot (mtime 2026-08-22 03:34)
  already shows three rows; only the copy and `shoot-guide.mjs:73` are wrong.
- **Not building a desktop image lightbox** — measured, desktop shots already render at ~95 % of native
  and `/m`-tagged shots are upscaled; a lightbox only pays off after 2× re-shoots.
- **Not adding a focus trap** to a non-modal window over a live globe.
- **Not filling the one measurement gap with prose**: nobody has measured what a 1Y FIND scan costs
  (`find-chips` `:741`). Measure it in-browser or leave it out. Report gaps; do not invent numbers.