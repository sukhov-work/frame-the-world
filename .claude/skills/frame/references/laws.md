# Laws of Software Engineering — encoded checks (Frame the World)

Adapted 2026-08-13 from the epistemic-filter dev-skill audit plan §9. Each applicable law names
WHERE it lives in this repo's machinery (checklist items = `code/platform/tests/docs.md` item
numbers; the law is only "applied" if a check or practice encodes it — a table row with no
encoding is decoration). Read this when authoring new checklist items so encodings stay
deliberate.

| Law | Encoding here |
|---|---|
| **Hyrum's** (every observable behavior gets depended on) | code.md 12 + docs.md 11 — the contract-strings inventory (`#p=`/`#f=`/`&t=` hash grammars, `ftw:*` prefs keys, DEV seams, collection schemas, R2 layout). Share links in the wild + saved prefs ARE the consumers; parsers stay tolerant both ways. First audit authors `conventions/contracts.md`. |
| **Gall's** (working complex systems grow from working simple ones) | audit-mode read-only + fix-slicing; any rewrite proposal names its strangler seam — the in-repo precedent is `enrichedVariant`'s `?enriched=` parallel-variant A/B (never replace, run alongside, owner verdict). |
| **Leaky Abstractions** | code.md 3–6 — the GL layer leaks are THIS repo's dominant trap class (float32 ECEF, renderOrder non-propagation, UNPACK_FLIP_Y on typed arrays, composer clear-color space, coarse-tile heightAt garbage). Every new leak found → a §Traps line + a checklist item + (where cheap) a test (tests.md 3). |
| **Tesler's** (complexity is conserved) | C1 productized: irreducible cost lives in Workers, offline bakes, or time-sliced frame budgets (code.md 2, 15; platform.md 1) — the interactive path stays light. |
| **Unintended Consequences** | the mandatory verification pass (audit-mode step 4) + the golden gates (tests.md 2) + regression suite riding every session. |
| **Zawinski's** (programs expand until they read mail) | docs.md 8 — the audit Verdict carries a scope-creep line vs the permanently-out list (AI panel, Gaia, GOTO, tides, Skyfire, mobile commerce). Owner rulings are the fence. |
| **Bus factor = 1** | true here (solo owner). Mitigation = the persistence loop itself (DECISIONS + memory graph + NEXT_SESSION_PROMPT) + this audit engine being INLINED in-repo (no external symlink dependency; the investigate-design-v3 path is enrichment, not a dependency — docs.md 10 checks its locality note). |
| **Knuth / premature optimization** | tests.md 8 + code.md 15 — every perf change cites its measurement (decode ms, patch means, fps tier evidence); the governor/tier system is the sanctioned perf lever, not ad-hoc micro-tuning. |
| **Parkinson's** (work expands to fill time) | audit-mode CADENCE — burst/boundary-triggered audits only, no idle timers. |
| **Ninety-Ninety** | report template fix-slicing sized S/M/L honestly; convergence-class work (visual taste passes, device-perf tuning) called out as open-ended. |
| **Hofstadter's** (it always takes longer) | estimates labeled as estimates in reports; measured beats estimated in every cell ("unmeasured" is a valid value). |
| **Goodhart's** (a measure that becomes a target stops measuring) | tests.md 8 — green tests ≠ rendered globe (verification tiers), fps ≠ beauty (shots ride numbers), patch-means ≠ look (the 2k-bake number+eyes pattern); never a single-metric verdict. |
| **Gilb's** (quantify) | report template requires numbers per finding; adjectives are not values. |
| **Boy Scout Rule** | bounded here by the FROZEN desktop chrome: leave-it-better applies to `lib/`, tests, docs, and dead code via audit slices — never drive-by refactors of frozen surfaces (anti-pattern: refactor-while-fixing). |
| **Murphy's / Sod's** | code.md 13 — degrade-path visibility (every fallback warns when it engages: 8k fetch, TUS, SBDB, tile retry, HEIC); platform.md 7 — the sharded-edge-cache recovery stays documented. |
| **Postel's** | platform.md 12 — liberal ingest (EXIF junk → terrain-snap, missing heading → manual, tolerant hash parsers, OSM garbage defended in the bake) + strict emit (validated thin endpoints, C6-reduced public rows). |
| **Broken Windows** | Track E triage FIRST + astro-check hints as a dated baseline (currently 6, 2026-08-13) that must not silently grow; `|| true`-class suppressions are dated temporary states. |
| **Technical Debt** | `references/tracked-backlog.md` — ONE dated registry (durable in git; NEXT_SESSION_PROMPT tails mirror it, docs.md 12); audits verify rows, never re-discover them. |
| **Kernighan's** (debugging is twice as hard as writing) | review-agent step 3 "prefer boring" lens; the 40-step orchestrator frame loop is the watch surface — new cleverness there needs a stated reason. |
| **Pesticide Paradox** (tests stop finding new bugs) | audit-mode step 2 — every audit starts by re-mining DECISIONS §Traps + entries since baseline into new checklist items; tests.md 3 converts testable traps into tests. |
| **Lehman's evolution** (systems must adapt or decay) | platform.md 10 — the app's external data ages (imagery ToS, star/comet/asteroid catalogs, TLEs, Wix app installs); every dependency carries a dated currency note + refresh path. |
| **Lindy** | design lens only — the boring-tech bets (three.js, astronomy-engine, zustand, plain CSS tokens, no Tailwind, Astro 5 pin) are deliberate; no check needed, cite when evaluating new deps. |
| **Sturgeon's** (90% of everything is crud) | the bake pipeline IS the filter for OSM reality (untagged heights → class defaults, fence-vertex 62% drop, C6 exclusion); new data sources get the same defend-at-ingest posture. |
| **Map ≠ Territory / Confirmation Bias** | already load-bearing in /frame: verification tiers ("compiles ≠ renders"), evidence discipline, zero-result validation, the falsification pass — Audit inherits. |

**Not applicable (skip, with reasons):** Conway / Brooks / Dunbar / Ringelmann / Price / Putt /
Peter (no team — the parallel review agents are a synthetic partial substitute for many
eyeballs; noted, not claimed equivalent); CAP + Fallacies of Distributed Computing (a
client-heavy app with CDN'd static backends; the one distributed lesson — edge caches are
sharded and networks lie — is already a §Traps line and platform.md 7); Amdahl / Gustafson /
Metcalfe / Moore-class scale laws (no parallel-scaling or network-effect targets);
Second-System Effect (guarded by the Gall encoding — watch-flag only, e.g. any "rewrite the
orchestrator" impulse).
