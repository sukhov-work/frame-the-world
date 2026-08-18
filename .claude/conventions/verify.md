# Convention — Browser verification (the runnable recipe)

Authored 2026-08-18 (audit-2 F2) — this page + `scripts/verify-chrome.mjs` replace the prose
that was scattered across DECISIONS traps, three wip memories, UPLIFT_PLAN and the gitignored
NEXT_SESSION_PROMPT. Referenced from the `/frame` skill Phase 3 and `testing-standards.md`.

## The recipe

```bash
# 1. Dev server (skip if already yours — check first, see traps):
lsof -nP -iTCP:4321 -sTCP:LISTEN        # who owns the dev port?
wix dev                                  # if free

# 2. Verify Chrome — managed launch (port-ownership check + occlusion flags + attach info):
node scripts/verify-chrome.mjs                   # headed, CDP :9222 (Playwright MCP attaches)
node scripts/verify-chrome.mjs --headless --port 9333 --profile /tmp/ftw-cdp   # scripted probes

# 3. Drive it:
#    - Playwright MCP (global config attaches to --cdp-endpoint http://localhost:9222), or
#    - a scripts/verify-*.mjs raw-CDP script (no deps; Node ≥22 for global WebSocket;
#      idiom: verify-explore-welcome.mjs · A1 regression example: verify-aimcone-seat.mjs).
```

Screenshots go in `verify-shots/` (git-ignored) — NEVER the repo root. Pass the folder in the
filename (`verify-shots/<phase>-<nn>-<what>.jpeg`).

## Traps (each cost a real session real time)

- **Port ownership FIRST.** A stale verify Chrome (same profile, no occlusion flags) keeps the
  port; a fresh flagged launch silently fails to bind and the client attaches to the buried
  stale window where rAF is frozen (~20 min in U5). `verify-chrome.mjs` errors on a foreign
  owner and `--kill-stale`s only the verify profile.
- **The 3 occlusion flags** (`--disable-backgrounding-occluded-windows`,
  `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`) keep rAF honest
  in occluded WINDOWS — they do NOT cover tab-backgrounding: `bringToFront`/`Page.bringToFront`
  before any timed sampling, and embed an rAF-tick counter in every probe result (U2 idiom).
- **Evaluate attaches only POST-load.** The dev-local initial tile stream (~2 s warm) finishes
  before any sampler attaches — construction-relative metrics come from IN-PAGE probes
  (`__globe.u5Mark()` idiom), never evaluate-side timing.
- **Select the right tab** from `/json/list` — `/json/new` returns the fresh target; never
  assume index 0.
- **Headless + persistent profile can collide** on a stale `SingletonLock` after a kill — use
  an ephemeral `--profile /tmp/…` for headless probes (house scripts use `mkdtemp`).
- **DEV seams**: the canonical inventory (top-level + sub-seams with owners) is
  `contracts.md §3`. Rendered geometry + screenshots prove visibility — DOM properties don't
  (the `[hidden]` trap, 2026-08-13; fence: `test/styles/hiddenPairs.test.ts`).
- Playwright MCP saves screenshots relative to the repo ROOT; /m strip chips fail Playwright
  actionability (canvas "intercepts pointer events") — dispatch `.click()` in evaluate.
