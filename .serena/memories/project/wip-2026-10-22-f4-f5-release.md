# wip 2026-10-22e — F4 textures (T170) + F5 alignment hooks (T172) + the RELEASE of the ten asks (IN PROGRESS)

Mode: implement · Tier: deep · Memory: serena. Owner order 2026-10-22c ("do F4 and F5 in the next session"), then a release so the
owner reads T174–T183 on the live site, then T186.

## Boot state (02:40 EEST)
- The 2026-10-22d work (57 files, T174–T183) was NOT shipped: the session-end hook ABORTED at 02:40:16 — "vitest FAILED — refusing to
  automerge red" (the log `~/.claude/logs/ftw-session-ship.log`). The baseline run of this session decides: a flake (the three timing
  tests) or a real red. Live stays v1.36.33.
- Two stale remote ship branches (014212 = e47caa1's tree, 014814 = master's tree) pruned after tree proof.

## Plan
1. Baseline green (vitest + astro) → the d-work ships with this session's work (or `/ship` first if the red is real and fixed).
2. F4 research (three 0.185 `DataArrayTexture` source audit + a browser probe on the house Chrome) → decide the array route; KTX2 = a decision line.
3. F5: the ray grid at save → `targetFeatureIds[]`.
4. Release + the live verifiers. 5. T186.

## Status
in progress — nothing landed yet.
