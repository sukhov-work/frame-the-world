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
- **An EASED scalar is not its target yet — an "EXACTLY n" assertion must wait for the SNAP.**
  Scene scalars ease toward their target and only snap inside a small epsilon, so the exact value
  the off-state claim depends on arrives several time-constants late. `eclipseK` (τ 220 ms, snap
  at 1e-3) needs ~6.2τ: a 1.2 s settle read 0.9983 and failed "must be exactly 1". The ease was
  correct and the wait was not — which is the failure that looks most like a real bug. Waits for
  steady-state assertions come from the tunable, never from a round number.
- **A cold profile is a different machine (2026-09-02).** `verify-ultra` §1b ("anisotropy
  stamped on composites created after the flip") went red twice on a fresh headless profile
  and green on a warm one — the flip window streams too few NEW composites on a cold imagery
  cache, so `aniso.max` stays 1 with nothing wrong. A fresh profile per suite retires the
  context-exhaustion and pref-carry-over traps, but a suite whose assertion counts what streams
  inside a window must run on a WARMED profile (run it second, or twice). And a comparator is
  only a comparator on the SAME warmth: stash-vs-tree on different caches proved nothing.
- **A diagnostic Chrome beside a timed suite is contention.** Two headless instances on one
  GPU halved the tile counts of the suite that was running; run diagnostics between suites.
- **A body 0.5° across is ~16 px at a wide FOV.** Verifying a lunar/solar disc detail (an umbral
  edge, a copper gradient, a carved silhouette) at the default framing shoots a picture in which
  the thing under test is invisible. Aim the pose at the almanac's OWN topocentric az/alt for that
  instant and use FOV ~6° — and re-aim per phase, because the moon moves degrees between contacts.

## The six harness ENVIRONMENT classes (added 2026-08-22, audit #3 D9)

`checklists/tests.md` item 10 requires this page to name all six. It named none — so the
symptom and the counter-move for each are here, verbatim, with the trap that produced it.

| # | Class | Symptom | Counter-move |
|---|---|---|---|
| **(a)** | **Verify-Chrome exhausts WebGL contexts across suites.** Each script opened a target with `/json/new`; nothing closed it, and each abandoned target holds a live context. | After ~5 suites `WebGLRenderer` throws `BindToCurrentSequence failed` and every later boot fails. | Every script now imports `scripts/verify-cdp-cleanup.mjs`, calls `trackTarget(PORT, target.id)` after `/json/new`, and ends on `await finishVerify(code)` — closing over plain HTTP, and from the `uncaughtException`/`unhandledRejection` handlers, which is the only `finally` a top-level-await module has (audit #3 C11; fenced by `test/verifyHarness.test.ts`). **Still restart Chrome between long suite runs** — the cleanup shrinks the leak, it does not license unbounded runs. NEVER kill the owner's persistent instance (ruling 2026-08-18: it also disconnects the Playwright MCP irrecoverably). |
| **(b)** | **Vite dep-cache staleness after a new globe-bundle import.** | `wix dev` serves `504 Outdated Optimize Dep` for EVERY module, not just the new one. | Restart `wix dev` before browser verification whenever imports changed; if it persists, move `node_modules/.vite` aside (T14). |
| **(c)** | **The resource-timing buffer overflows at 250 entries.** | `performance.getEntriesByType("resource")` silently truncates, so deep tile levels appear never to have been fetched. | Count fetches via CDP `Network.requestWillBeSent` (the `verify-qa7ab.mjs` `esriLevels` idiom). |
| **(d)** | **Headless Chrome governs to tier `low`.** | Absolute DPR/quality assertions fail on a machine where the feature works. | Assert CONSISTENCY, never absolutes: read `window.__globeQuality` and check `dpr === min(devicePixelRatio, tierCap[tier], leanCap)`. Its fields are LIVE GETTERS since audit #3 A2-5 — read them explicitly rather than relying on CDP `returnByValue` to walk accessors. |
| **(e)** | **`/m` re-mirrors the live camera into `location.hash` ~1.6 s after boot.** | A check that reads the link hash sees the app's own echo, not the pose it navigated with. | Assert boot RESULTS from the stores (`__cameraStore.getState()`), never the hash. |
| **(f)** | **`/tmp/ftw-cdp` persists prefs across verify sessions** (`groundMode`, vector toggles, view prefs). | A leg silently runs in the wrong mode — this is what made the Esri GET counter falsifiable-in-theory-only. | Probe or SET the pref as a precondition before any visual or counter assertion, and assert it (checklist 12). |

## Synthetic gesture recipes

Nine scripts drive the two-finger gestures; the shapes are easy to get subtly wrong, so they
live here rather than being re-derived per script.

**Two-finger TWIST (the expanded chart's `view.rot`)** — dispatch `Input.dispatchTouchEvent`
with TWO points and rotate them about their midpoint. The chart reads the inter-pointer ANGLE,
so the two points must move on a circle, not translate:

```js
const cx = 195, cy = 420, r = 90;          // midpoint + finger separation
const at = (a) => [
  { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: 1 },
  { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a), id: 2 },
];
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
for (let i = 1; i <= 12; i++) {            // small steps — one big jump reads as a pinch
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at((i * Math.PI) / 24) });
  await sleep(40);
}
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
```

Traps: keep the SEPARATION constant or the twist composes with a pinch and `z` drifts; the
`/m` left rail is TWO stacked z-24 pads, so any synthetic press below **x ≈ 126** lands on a
stick instead of the map; and assert the published `store/minimap.mapWindowRotRad`, not the
rendered pixels.

**Long-press** — `touchStart`, `sleep(700)` (the shape is `ORCH.longPressMs` 500 + slack),
`touchEnd` with an EMPTY `touchPoints`. Do not move between them: `DRAG_CANCEL_PX` is 6 px and
a drift past it both cancels the press and (on the chart) arms the permanent manual-pan
override.

## The newer DEV probes

- `window.__mapWindowView` — the expanded chart's live centre / twist / zoom, plus the
  **resolved aim anchor** (`anchorLatDeg`/`anchorLonDeg`). Read the anchor; never re-derive the
  ladder in a script — a transcribed copy went stale the day the ladder was hoisted and failed
  by 81.8 m against an app that was correct (audit #3 C8/T36).
- `window.__overlayRebuilds` — imagery-composite fresh-instance rebuilds. THE assert for the
  QA-7b storm; raw Esri GET counts cannot isolate it. Invariant: ≤ 1 post-boot per rung.
- `window.__globeQuality` — `{ tier, dpr, leanFlat2d, mapFlat, lean }`, live getters.
  `leanFlat2d` is the coarse-pointer-only DPR latch (permanently false on desktop — hence the
  name); `mapFlat` is the engine's real flat-chart latch on every shell.
- `window.__globe.aim()` — the radar seam's resolved state: the shared anchor, whether a
  skyline claim was made, the coverage behind it, the focal cone's BufferGeometry ids (stable
  ids across an hFov sweep proves the T38 per-frame realloc is gone) and `shadowAutoUpdate`.
