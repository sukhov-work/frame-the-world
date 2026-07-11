# wip 2026-07-12 — README rewritten for the Wix contest (DONE)

Mode: implement (investigate-design-v3) · Tier: Standard · Status: **DONE, verified**

## What shipped
Full rewrite of root `README.md` + new committed `docs/media/` (5 curated screenshots copied
from git-ignored verify-shots: welcome.jpeg, globe-leo.jpeg, photo-fpv.jpeg,
city-night-vector.jpeg, pins-community.jpeg — ~1.1 MB).

## Canonical framing (owner-stated, now authoritative for all outward-facing text)
1. PRIMARY goal = stress test of the Wix headless ecosystem — "if Wix headless can host this,
   it can host anything". The repo goes to judges in an internal Wix contest.
2. The photo/3D-earth/ephemeris layer = owner's side hobby, chosen to make the test fun,
   challenge himself, and probe AI-agent limits.
3. The repo being 100% AI-agent-built is stated openly; the committed `.claude/` harness is
   presented as part of the deliverable (it IS tracked in git — only `.claude/.env` +
   NEXT_SESSION_PROMPT.md are ignored).

## README structure (for future edits — supersede, don't accrete)
hero image → why-this-exists → 90-second tour (2×2 image/caption table) → Wix integration
surface table (9 rows, each with verification status) → proven (6) vs falsified (6) platform
findings → architecture split diagram + stack table + status line → AI-agent section →
run-it → docs map.

## Facts verified this session (re-verify before bumping numbers)
- 377 vitest / 38 files green · astro check 0 errors 0 warnings (both run 2026-07-12).
- git: first commit 2026-07-09, head 2026-07-12, 17 commits → "four days" claim.
- THIRD_PARTY.md covers ONLY the WASM decoder licenses — imagery attribution (Esri/CARTO/OSM/
  ion/NASA/NE/OpenFreeMap) is the live app footer. First draft misdescribed it; fixed.

## Deliberate omissions / follow-ups
- **Live URL left OUT of the README** — it still serves the stale Phase 5 build. Add a demo
  link after S1–S7+ is released (`/api/ping` canary → `wix release`). Best done right before
  contest submission.
- README test/count numbers (377) will drift — refresh them in the same session as the next
  release/submission pass.
- verify-shots/ remains git-ignored; docs/media/ is the only committed imagery. Refresh the
  5 shots if the visual design shifts before judging.

Twin: DECISIONS.md "2026-07-12 (later)" line. Related: mem:core · mem:project/wix-platform.
