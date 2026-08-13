# wip 2026-08-13 — FULL AUDIT #1 + fix slices 0–6 (owner-ordered pre-Phase-8a hygiene gate)

One session: audit (Deep, READ-ONLY phase per `.claude/skills/frame/references/audit-mode.md`)
→ report → fixes. **Report (canonical): `.claude/claude-docs/audits/audit-full-2026-08-13.md`** —
29 confirmed findings (1 BLOCKER · 1 MAJOR · rest MINOR/NIT), 0 deleted in verification (FP
ratchet 0%), severity table + fitness scorecard + slicing there. DECISIONS 2026-08-13 "latest"
line = the full twin of this memory.

## Gates after fixes
vitest **710/710 (+6)** · astro check **0/0/6 hints (= baseline)** · wix build **Complete, 26 routes**.

## The two big ones
- **D1 BLOCKER (ledger):** the audit-machinery entry prepend (same-day, working tree) had SPLICED
  itself into the PLANNING-LADDER entry's line in DECISIONS.md, eating that entry's `- **` header.
  Repaired pre-commit: line split + header reconstructed from NSP/wip memory + bracketed
  reconstruction note. LESSON → when prepending to DECISIONS in an uncommitted tree, verify the
  neighbour entry's header survives (the entry below was also uncommitted — git couldn't show the
  splice as a deletion).
- **A1 MAJOR (engine):** `Pins.groundHeight` was the ONE `heightAt` consumer without the [0,9000]
  clamp AND it latched the first finite answer (`grounded[i]`, resnap skips) → negative coarse-LOD
  garbage rooted pins underground PERMANENTLY. Fix: NEW `sampleGroundM(raw, fallbackM)` in
  `lib/geo/terrain.ts` — clamps AND returns `real:false` for out-of-range raws so resnap keeps
  refining (never latch a clamped sample). 4 regression tests in terrain.test.ts.

## New shared modules (A6 dedup — drift vectors closed)
- `src/lib/pins/fields.ts` — `publicPinCore` / `pinOpticsFields` / `pinProductFields`: the ONE
  PublicPins/optics row reader. Consumers rewired: `store/pins.pinFromItem`, `api/market.marketPin`
  (kept its productId-required + EUR-fallback deltas), `lib/wix/pinRecords.photoListItem`.
  Healed drift: market's `"1km"` literal vs DEFAULT_PRECISION_TIER.
- `src/lib/ephemeris/topo.ts` — `topoAzAlt(dir, distanceAu|null, lat, lon, altM)`: the ENU
  projection formerly duplicated in comet.ts/targets.ts (distance→parallax, null→geocentric).
  Horizons-locked tests pass unchanged = equivalence proof.
- `src/lib/sky/ttlCache.ts` — `makeTtlCache` (hit/miss TTLs, cap, silent-degrade): simbad+sbdb
  rewired. CONTRACT: old blobs used value keys `o`/`body` — reads tolerate them, writes use `v`
  (contracts.md §2 note).

## Other fixes (slice → what)
- 2: `@wix/redirects@^1.0.125` ADDED to package.json (was phantom — only hoisted-transitive under
  DYNAMIC imports in planUpgrade/market buy → runtime break risk, no build error; do NOT drop
  @wix/sdk before checking hoisting) · streetNames Group.renderOrder line deleted · GlobeCanvas
  residual setClearColor deleted (S5 re-arm) · pins throttle rename + 3 comment fixes.
- 4: test credential OUT of 5 scripts → `TEST_MEMBER_EMAIL/PASSWORD` in gitignored .env.local
  (values appended there; **owner should rotate the password** — old value is in git history) ·
  landmask script repo-relative output · bake-date stamps in both catalog generators +
  hand-stamped comets.ts/asteroids.ts (git-dated 2026-08-10).
- 5: market `buy()` refuses variantId-less listings (silent-empty-checkout guard) · photos POST
  returns the real premium limit when the wall computed it · lazyContract regex hardened (bare
  side-effect imports caught; `import type` excluded) · Dec-solstice −23.44° unit vector added ·
  golden.test imports tuning.GOLDEN (its hand mirror had drifted to pre-2026-07-13 values —
  tested nothing) + planner.test parity guard on its mirror.
- 6 (docs): audit-mode bundle baseline re-anchored 33 MB dated · README quota 100/1000 + Pricing
  Plans installed + star-count dated · wix-headless quota heading 100/1000 · globe-tuning B19
  note (2665 lines) · ARCHITECTURE §5 REWRITTEN as-built (schema source = provision script;
  **there is NO Listings collection**) · core.md §Source-layout refreshed + FPV-walk 08-11
  backfill · IMPLEMENTATION_PLAN §6.9 correction (Pricing Plans installed 2026-07-17) ·
  ASTRO_ENGINE_PLAN Phase-A tag narrowed (ring/DSO-flow verified; point/ellipse RENDER remains →
  T25) · machine-locality notes on the 2 ecom-repo absolute paths.

## Audit deliverables beyond the report
- **`conventions/contracts.md` AUTHORED (T23 CLOSED)** — Hyrum inventory: #p=/#f=/&t= grammars ·
  4 ftw:* localStorage keys · 14 window.__* DEV seams (NSP list was 3 short) · Photos/PublicPins/
  SavedPlaces field lists · R2 layout/versions · checkout catalogReference contract · 26-route
  surface. Later audits DIFF this file.
- Checklist amendments (Pesticide): code.md items 17–19 · platform.md item 13 · tests.md K&S
  9.1% correction.
- Backlog: T4 corrected (Pricing Plans installed 2026-07-17 — only purchase loop + rename remain) ·
  T23 closed · NEW T24 (astro@5.18.2 XSS advisories, fixes only in 7.x vs C4 pin — ZERO reachable
  sinks verified, re-check on .astro growth) · T25 (point/ellipse impostor render eyeball) ·
  T26 (upload-url unbounded sizeBytes/mint rate — owner ruling).

## Deferred (next sessions)
- **Slice 7:** B10 move 3 MB `public/enriched-sample/` out of the build (runtime provably never
  fetches it — URL comes from PUBLIC_ENRICHED_TILES_URL) + A5 de-export sweep (16 value exports
  used-in-module only + 27 types; knip re-run after). Wants its own wix-build verify.
- **Slice 8 (owner/browser):** B9/T26 upload caps ruling · B2 password rotation · T25 eyeball
  (visible-window browser session) · T2/T3 release canaries ride the next `wix release`.
- Track C item-3 standing deliverable (testable-but-unencoded traps): heightAt consumer-walk
  static test · [hidden]-pair CSS walk · TUS threshold chooser test — future test-authoring slices.

## Verification-tier honesty
Everything above is local-tested (vitest/astro/build). NOTHING browser/wix-cloud verified this
session: A1's visual effect, B5 guard UX, B7 display, the mobile/M0 tails (T1), canaries (T2/T3)
all stay UNVERIFIED at their tiers.
