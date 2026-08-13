# mem:project/wip-2026-08-11-mobile-design — Mobile planning-app design (RATIFIED 2026-08-11)

**Status: DESIGN COMPLETE + OWNER-RATIFIED same day. Canonical artifact: `.claude/claude-docs/MOBILE_PLAN.md`.
Next step = Phase M0, next session** (route + MobileLayout + shell + real-device render/touch-orbit
proof BEFORE any UI investment). NEXT_SESSION_PROMPT retitled to "Mobile M0".

## RE-RULED 2026-08-13 (owner) — read `mem:project/wip-2026-08-13-planning-core-restructure`
The §5 feature ladder (P1–P10 + backlog + all future planning-app features) is CORE scope,
scheduled in `IMPLEMENTATION_PLAN.md §Phase 8` (8a–8e), **desktop-first then mobile**; M3–M6
below are re-scoped to the mobile SURFACES of 8a–8e (M0–M2 unchanged); the desktop freeze is
amended additively (shipped chrome frozen, new planning surfaces allowed). M0 SHIPPED 2026-08-13
(browser-verified; real-device gate open).

## Owner rulings (2026-08-11, closed the three [OPEN] items)
1. `/m` linked from the desktop topnav AND the `pointer:coarse` banner (both in M0 — the only desktop deltas).
2. Mobile = **planning-only PERMANENTLY** (never upload/marketplace/pins-browsing) but carries ALL
   current + future planning features → the full researched backlog is scheduled (M5/M6).
3. **Phase 7 (AI panel) OUT OF SCOPE FOR ALL PLANS** — IMPLEMENTATION_PLAN Phase 7 ⛔ PARKED;
   M0→M6 is the only active ladder; nothing schedules after M6.

## The decision
Separate `src/pages/m.astro` + thin shell (`src/components/mobile/**` + `MobileLayout.astro`), same
engine/stores/libs; NO middleware/UA redirect (CDN `Vary` unverifiable; sharded-edge-cache precedent).
Platform proven: `output:"server"`, `/api/ping` prod canary, `@wix/astro-pages` route registry.

## Load-bearing findings (evidence in MOBILE_PLAN.md)
- Orbit touch ALREADY works (3d-tiles-renderer EnvironmentControls — source-verified, device-UNVERIFIED until M0).
- FPV gaps → 4 additive engine seams: analog walk via store/camera into world-space `fpvWalkOffset`
  ([[bugs/fpv-walk-orbit]] invariant) · pinch-FOV in `onFpvPointer*` · long-press pin drop ·
  `&sky=<targetId>` hash extension.
- All planning logic store-mediated (planFeed→store/plan; request*/aimAtSky seams). Mobile reuses
  LIBS, never desktop panels (LocationFinder etc. stay untouched); lazyContract.test.ts fences src/.
- Sensors: iOS gesture-gated requestPermission() + webkitCompassHeading (no absolute event);
  Android deviceorientationabsolute; Wake Lock iOS 16.4+.
- Perf: 6.5 MB milkyway boot texture → 2k mobile variant; 8k-skip "mobile floor" precedent
  tuning.ts:604-610; quality tiers + governor exist.

## Schedule M0→M6 (full ladder in MOBILE_PLAN.md §6)
M0 route + render proof (+ nav link/banner, texture tier) → M1 planning loop (tabs/sheets, search,
time dock + P1 twilight bands, plan/target sheets, long-press pin, geolocation) → M2 FPV touch
(joystick, pinch FOV, wake lock) → M3 P2 MW band/GC target · P3 MW season calendar + moon score ·
P4 **Find az/el date search filtered by real skyline (category-first)** · P5 NPF/500 (D850 ≈16.3 s
test vector) · P6 moon calendar → M4 AR aim + P7 meteors (bake IAU MDC, avoid GPL showers.json) +
P8 conjunctions + P9 lunar eclipses + PWA → M5 P10 sensor-frame/mosaic + star-trail sim + ND/
timelapse calcs + What's-Up-Tonight → M6 light pollution + ISS (`/api/tle` proxy) + web-push alerts
(NO-CRON caveat) + solar-eclipse umbra path (flagship).
Permanently out: Gaia-depth, GOTO, tides/rainbow, Skyfire, AI panel.

DECISIONS.md lines: 2026-08-11 (design) + 2026-08-11 (ratification). Related:
mem:patterns/design-system (tokens, 1600 ms mobile flight) · mem:project/dev_environment.
