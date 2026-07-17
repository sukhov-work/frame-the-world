# WIP 2026-07-16 — PROD outage: black globe / dead islands on the live URL — RECOVERED (wix-VERIFIED)

**Mode:** fix (/frame). Live URL was unusable: every `_astro/*.js` island chunk intermittently 500 →
"[astro-island] Error hydrating … Failed to fetch dynamically imported module" → black globe.
Owner suspected the pins/places code; **the code was innocent.**

## Root cause (evidence-verified, curl + CDP)
- Wix serves this app on TWO paths: SSR worker (HTML, `/api/*`) and a **static-asset origin**
  (`_astro/*`, `public/*`). The worker was healthy (HTML ~1.1s cold, `/api/places` 401 in 0.75s).
  The **asset origin served every cache-MISS at 15–30s regardless of file size** (226-byte stub =
  15.6s) and Wix's ~30s gateway cutoff turns slow reads into **HTTP 500 with a classic-error-page
  HTML body** (that HTML body is also why a CSS chunk logged "MIME type text/html").
- Boot fires **14 top-level `client:only` islands in parallel** (all of `index.astro`; `client:only`
  = zero SSR, most-eager fetch) + the globe's 6–7MB textures → parallel burst against the cold
  origin → some requests cross 30s → 500 → islands die permanently (no retry on hydration import).
- **Trigger:** that day's release reset every chunk hash → all-cold. Prod had looked fine since
  2026-07-10 only because live traffic kept the old hashes warm. The cold+slow origin was always there.

## What fixed it (and what didn't)
- ✖ **Re-release did NOT fix** — new hashes are cold again; identical pathology reproduced
  (GlobeCanvas 500 @30s on the fresh revision).
- ✔ **Serial cache warming with retry-until-200**: `scripts/warm-prod-assets.mjs` — seeds from live
  HTML (`/_astro/*.{js,css}`) + a hardcoded texture list, discovers the import graph transitively
  from chunk bodies, fetches ONE AT A TIME (serial avoids the contention), retries ≤4 (many assets
  500 on try1 then 200 fast on try2). Result: 72/72 assets, 0 failures. After the full warm the
  ORIGIN itself sheds the pathology (fresh MISSes <0.7s — origin/shield warmed), so per-edge-node
  leakage stops mattering. **Re-run this script after EVERY `wix release`.**
  Usage: `node scripts/warm-prod-assets.mjs [baseUrl]` (Node ≥22 — nvm 24.10.0; system node is 20).
- Verified in a COLD headless-Chrome profile (`scripts/verify-prod-globe.mjs` — CDP: console +
  network + island-hydration probe + screenshot): full boot, 0 chunk failures, 0 hydration errors;
  Welcome hero + globe + pin + "4 FRAMES ON THE GLOBE" render. Shots:
  `verify-shots/prod-outage-01-initial-load.jpeg` (broken) → `04-final.jpeg` (fixed).
  Expected noise: TilesRenderer 1.1 warnings; 403 on `members/v1/members/my` when signed out.

## Platform facts learned (durable)
- **`wix release` REBUILDS server-side** — released hashes ≠ local `wix build` hashes (it even
  rewrites local dist/ at release time). Releases **propagate in steps**: live HTML hash sets can
  flap for minutes post-release; wait for stability before diagnosing "corruption".
- **`wix build`/`release` ship the WORKING TREE, not HEAD.** This recovery release therefore carried
  the phase-6 marketplace state (test-green per `mem:project/wip-2026-07-16-phase6-marketplace-research`;
  `/api/listings` live, 401-gated). Convention: release from a clean tree or a clean `git worktree`.
- Fastly edge is **per-node** (`x-served-by: cache-par-…XX` varies) — warming one path doesn't warm
  all nodes; only the origin-side warm ends the 500s for good.
- Mid-debug 404s were **stale local-build hashes**, not deploy corruption — always compare against
  hashes in freshly-fetched LIVE HTML.
- `x-wix-code-baas-cold-request` / `x-wix-kore-duration` headers appear on worker-served responses
  only — their ABSENCE on a slow asset proves the asset path (not the worker) is at fault.

## Open mitigations (not done — decide with owner)
1. **Escalate to the platform team**: 15–30s cold asset reads on wix-site-host is the disease.
2. **Fewer/larger chunks** (`vite.build.rollupOptions.output.manualChunks`) — origin latency is
   size-independent, so fewer requests = fewer 30s-cutoff losses.
3. **Defer non-critical islands** — all 14 are `client:only`; only GlobeCanvas is first-paint
   critical. Mind the S2 trap (position:fixed panels must stay top-level islands) and index.astro
   conflicts with parallel feature sessions.
4. `public/_headers` with `/_astro/* Cache-Control: public, max-age=31536000, immutable`
   (UNVERIFIED whether the Wix host honors `_headers`; live already sends
   `x-wix-cache-control: public, max-age=604800`).

## Session side-effects (flag to the phase-6 session)
- **Overwrote the pre-existing untracked `scripts/warm-prod-assets.mjs`** (same name existed at
  session start — the phase-6 session had likely already fought this outage). Content replaced.
- Released the working tree (= shipped the phase-6 state to prod, ~18:47 local).
- Added `scripts/verify-prod-globe.mjs` (CDP prod smoke-check; reusable).

Related: [[project/wip-2026-07-16-phase6-marketplace-research]] [[project/wip-2026-07-15-prephase6-uiux]]
(the "Vite dep-cache stale" trap there is the DEV-mode twin of this prod symptom) [[project/wix-site]]
[[decisions/session_workflow]]
