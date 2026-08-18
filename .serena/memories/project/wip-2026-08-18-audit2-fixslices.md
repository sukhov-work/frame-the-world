# WIP 2026-08-18 — AUDIT #2 fix slices 1–7 ALL WORKED (one session)

DECISIONS twin: 2026-08-18l-audit2-fixslices (the full inventory). Gates at close:
**vitest 1,013/1,013 (91 files, +24 tests / +5 files vs audit baseline 989/86)** · astro 0 err/5 hints ·
browser tier live (verify-chrome.mjs + raw-CDP probe + shot). 63 files changed.

## The two MAJORs
- **A1**: seat ease → pure exported `easeSeatM` in scene/aimCones.ts, clamp INSIDE
  (test/components/globe/aimCones.test.ts, 6 tests); browser-proven seat +11.2 m at street-level
  Dnipro (`scripts/verify-aimcone-seat.mjs` — reusable regression probe, needs Node ≥22 + CDP
  Chrome via verify-chrome.mjs).
- **B1 RULING: `checkOrigin: true` KEPT.** Key discovery: **the origin check NEVER runs in dev**
  — Astro 5.18 `render-context.js:101` composes `middleware ?? pipelineMiddleware`, and the
  origin-check wrapper lives only in `pipelineMiddleware`; @wix/astro always injects middleware
  ⇒ dev trials of this flag are structurally inert (probes: cross-site form POST → 200 dev).
  Prod: engages via base-pipeline getMiddleware. Compatible by construction (same-origin JSON
  exempt · auth routes GET-only · checkout = GET redirect · TUS = Wix domain). LANDMINE:
  webhook/service-plugin extension routes (`/_wix/extensions/...`) read no-Origin text() POSTs
  → would 403; ZERO registered today (no src/backend). Documented wix-headless.md §12b.
  Canary = next release (T2/T3, owner-present).

## Load-bearing facts discovered this session (reuse, don't re-derive)
- **Playwright MCP dies if you kill its CDP Chrome** — the MCP server disconnects for the whole
  session, tools vanish. Fall back: raw-CDP over `ws` (house idiom verify-explore-welcome.mjs);
  claude-in-chrome needs the extension connected (wasn't).
- Node default on this box is v20 (no global WebSocket) — CDP scripts need
  `~/.nvm/versions/node/v24.10.0/bin/node` or Node ≥22.
- Headless Chrome + the persistent Playwright profile collide on a stale SingletonLock after a
  kill — use an ephemeral `--profile /tmp/...` for headless probes.
- `.ship-title` must NOT include `#pr #skipreview #automerge` — the hook appends them (last
  session's title had them → doubled tags in the commit).
- `@wix/dashboard` is a dependency OF `@wix/astro` — removing the direct dep can never break
  resolution (audit-1 A4 hoisting lesson closed).
- Compaction r3 mechanics: `sed -n 'A,Bp' > block` → md5 → append archive under dated §Moved
  header → `head -N` the hot file → digests + sentinel + header note. Proof = identical md5 +
  byte arithmetic. Hot file 206→66 KB.

## Slice → artifact map (short)
S3 docs: DECISIONS r3 + F1 hook text + README counts + ARCH §4/§7 + plans→archive/ + memory
fixes (system-overview, sky-bodies-terrain SUPERSEDED header, core era rows, memory_maintenance
policy). S4 conventions: naming ×3 · testing-standards rewrite (twin rule codified) · contracts
§3 sub-seam table · trap promotions ×3 files + 4 DECISIONS §Traps lines · globe-tuning count-free
· **rename `_syncGhosts`→`publishGhosts`** · CLAUDE.md F4. S5: 7 de-exports + dashboard drop +
`dirAzAltDeg` fold ×4 + ORDER header bands. S6: fences.test.ts (scene→store, setClearColor,
boundingSphere THREE regression) + hiddenPairs.test.ts + T24/T1 edits + T28–T31 rows. S7:
verify-chrome.mjs + conventions/verify.md + ship-hook v3 (prune with containment proofs +
attention dedup/re-verify) + bake stamps ×5.

## Open = slice 8 (owner; none blocking)
B1 canary ride next release · plan-archive ratify (PLANNING_QOL/GUIDE → archive/) · T28/T29
acceptance · B4/T30 quota-display call · **phase done? → un-park UPLIFT U6 foveation**.

Related: [[project/wip-2026-08-18-audit2]] · [[project/wip-2026-08-18-u5-loading]] ·
[[decisions/session-end-autoship]] · UPLIFT_PLAN.md §2/U6.
