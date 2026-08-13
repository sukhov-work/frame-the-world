# mem:project/wip-2026-08-13-planning-core-restructure — ladder→core + Mobile M0 (SHIPPED)

**Session outcome (2026-08-13, /frame + investigate-design-v3, design→implement, Standard):**
(1) the planning-feature ladder was promoted to CORE scope, desktop-first; (2) Mobile M0 shipped.
Gates **vitest 704/704 (+3) · astro check 0/0 · wix build Complete (26 routes incl. /m)**;
browser-VERIFIED via Playwright-over-CDP on wix dev. **REAL-DEVICE render/touch = the M0 exit
gate, still OPEN (owner hardware).** DECISIONS 2026-08-13 line = the full record.

## 1. The restructure (owner re-ruling)
- `IMPLEMENTATION_PLAN.md §Phase 8` is NEW and owns the schedule: 8a darkness/galaxy (P1–P3) ·
  8b search/exposure (P4–P6) · 8c events (P7–P9) · 8d session tools (P10 + calculators) ·
  8e ambience/flagship (light pollution · ISS · alerts · solar umbra). MOBILE_PLAN §5 stays the
  feature SPEC; M3–M6 = mobile SURFACES of 8a–8e; M0–M2 = mobile infrastructure.
- Build invariant: pure lib (`lib/ephemeris/*`/`lib/geo/*`) + vitest → desktop panel → mobile
  sheet. **A mobile surface never precedes its desktop twin.** Twins: M1←8a-P1 · M3←8a-P2/P3+8b ·
  M4←8c (+AR/PWA mobile-native) · M5←8d · M6←8e.
- Desktop freeze AMENDED additively (2026-08-13): shipped exploration chrome/behavior frozen;
  additive planning surfaces allowed (they land desktop FIRST). AI panel stays OUT (2026-08-11).
- Consistency fixes: ARCHITECTURE §4 ladder bullet + §7 `components/mobile/`; mem:core was
  MISSING any 2026-08-11 entry (that session never updated the graph root) — backfilled.

## 2. M0 as built
- NEW: `src/pages/m.astro` (GlobeCanvas + MobileShell islands, no Welcome/boot-poster) ·
  `src/layouts/MobileLayout.astro` (Layout.astro twin + `viewport-fit=cover`) ·
  `src/components/mobile/MobileShell.tsx` (status strip; store-free — lazyContract-safe) ·
  `src/styles/mobile/mobile.css` (100dvh override of global.css's 100vh + `touch-action:none`
  + safe-area padding) · `scripts/build-milkyway-2k.mjs` · `public/textures/milkyway-2020-2k.jpg`.
- Mobile texture tier (all additive, desktop byte-identical — verified):
  `DeviceCaps.coarsePointer` (GlobeCanvas reads `matchMedia("(pointer: coarse)")`) →
  `detectDeviceTier` caps at `mid` AND the governor `ceiling` becomes `mid` (quality.ts +
  GlobeCanvas). WHY: an iPhone otherwise detects `high` — "Apple GPU" passes STRONG_GPU and
  deviceMemory/cores DEFAULT to 8 on iOS Safari. `allow8k` opt threaded
  GlobeCanvas→StylizedTiles→{`attachBaseEarth` (skips the 3×8k swaps — the `maxTextureSize≥8192`
  gate alone can't shed them, phones report ≥8192), `attachStars` (loads `MILKYWAY.hazeTexture2k`)}.
- 2k milky-way bake: LINEAR-light Lanczos via sharp `.gamma(2.2,2.2)` (the SVS flux-per-pixel /
  sub-texel-speckle trap, DECISIONS 2026-07-15); verification = linear PATCH MEANS at the
  documented landmarks (bulge 0.998 · LMC 0.984 · dark 0.949 vs 8k; FAIL gate >12%). 572 KB,
  ~8 MB VRAM vs ~134 MB.
- Desktop deltas (owner-ratified 2026-08-11): topnav `Mobile` → `/m` (scoped-style anchor) +
  dismissible coarse-pointer banner (`#m-banner`, localStorage `ftw:m-banner-dismissed`,
  inline script, client-side only — never a UA redirect).

## 3. Verified (Playwright over CDP :9222, headed Chrome)
/m renders the LEO signature scene at 402×874 + idle drift + `#p=` pose writer (share links work
on /m for free) · coarse-shim boot → tier `mid`, network shows ONLY `milkyway-2020-2k.jpg`
(zero 8k fetches) · fine-pointer desktop unchanged (tier `high`, all 8k, banner zero-box) ·
banner show→dismiss→stays-hidden proven by RENDERED GEOMETRY. Shots
`verify-shots/mobile-m0-01..03*.jpeg`.

## 4. NEW TRAPS (verify recipes)
- **`display:flex` in CSS BEATS the `hidden` attribute** (UA display:none loses to any author
  display) — pair styled hidden-able elements with `.x[hidden]{display:none}`. A property-level
  check (`el.hidden`) read "hidden" while the banner RENDERED — only the screenshot caught it.
  Check rendered geometry (`getBoundingClientRect`), not properties.
- **Playwright `addInitScript` on a CDP-ATTACHED page** takes effect only from the NEXT
  navigation → hop `about:blank` first. A hash-only `goto` (`/m#p=…` → `/m`) is SAME-document —
  no new document, no init script, and stale `performance` entries.
- **Background-tab clicks hang** at "visible, enabled and stable" — actionability waits on
  animation frames the throttled tab never delivers → `page.bringToFront()` before clicking
  (the occluded-Chrome rAF trap generalizes beyond timing measurements).
- CDP `Emulation`/`Page.addScriptToEvaluateOnNewDocument` via `newCDPSession` did NOT inject
  (likely needs `Page.enable`); `page.addInitScript` + about:blank hop is the working recipe.

## 4b. SAME-DAY EXTENSION — audit mode added to /frame + full audit scheduled (owner order)
Owner: bare `/m` preliminary PASS → proceed; BUT before 8a/M1 → a full-session comprehensive
audit (architecture/modules/tests/docs/dead+duplicated code). Built (docs/skill-only; gates
untouched): `.claude/skills/frame/references/{audit-mode,laws,review-agent,
audit-report-template,tracked-backlog}.md` + `checklists/{code(16),platform(12),tests(8),
docs(12)}.md` — adapted from `~/Projects/personal/epistemic-filter/.claude/skills/dev`
(audit mode + the plan §9 laws mapping), every item mined from THIS repo's Traps/conventions
with `— check:`/`— anchor:`. Key design points: READ-ONLY audit (fixes = sliced sessions);
severity BLOCKER = C1–C6/wrong-math/append-only; FP ratchet; re-mine-traps step (Pesticide);
Track E mechanical FIRST (knip/depcheck/ts-prune/jscpd PROBED, registry may not serve them);
reports → `.claude/claude-docs/audits/`; **tracked-backlog.md = the ONE debt registry T1–T23**
(carried tails moved from the gitignored NEXT_SESSION_PROMPT — prompt now mirrors registry).
SKILL.md gained the Audit type + audit/comprehensive-review triggers + 4 anti-pattern rows.
First audit's extra deliverable: author `conventions/contracts.md` (Hyrum inventory, T23).
DECISIONS "2026-08-13 later" line = full record.

## 5. Open / next
SUPERSEDED same day by §4b: **THE FULL AUDIT comes first** (owner order), then fix slices,
then release canaries (T2/T3; real-device numbers = T1) → **Phase 8a** (P1 `lib/ephemeris/twilight.ts` +
desktop TimeScrubber bands · P2 MW/GC fixed-provider target · P3 season calendar in PlanPanel)
→ M1. Working tree left UNCOMMITTED (repo pattern: owner drives #pr commits).
Related: [[project/wip-2026-08-11-mobile-design]] · [[patterns/globe-rendering]] ·
[[patterns/design-system]].
