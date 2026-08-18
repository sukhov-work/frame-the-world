# GUIDE_PLAN — the in-app user guide (owner order 2026-08-15)

> **STATUS 2026-08-15 (same-day full crunch): G1 + the G2 content SHIPPED both shells.**
> One content module `src/lib/guide/guideContent.ts` (11 chapters · ~40 topics · goal router ·
> `[[crosslinks]]` via `lib/guide/inline.ts`) → desktop `panels/Guide.tsx` (resizable window,
> chapter rail; nav GUIDE replaces FAQ) + `/m mobile/GuideSheet.tsx` (status-strip GUIDE chip,
> full sheet, index→chapter drill). **FAQ decision: ABSORBED/RETIRED** (Faq.tsx + faqContent.ts
> + faq.css + public/faq deleted; privacy/marketplace/upload copy ported into chapters).
> 12 fresh screenshots `public/guide/*.webp` (720 px desktop / 360 px portrait, all warmed in
> warm-prod-assets.mjs). Welcome gained HOW IT WORKS (data-open-guide, explore cleared).
> Content-integrity + slop-lint vitest gate (`test/lib/guide/`). Copy audited against the LIVE
> UI (both shells, CDP): double-click = pin + FPV in one motion; search bar top-nav; menu
> labels state-flipped. Remaining (G3): owner taste pass · coach-mark journeys (optional,
> owner call) · real-device pass. Inventory corrections vs this file's checklist: place quota
> DROPPED (not 50) · /m tab bar is 4 tabs (SCENE·PLAN·FIND·SEARCH) · FIND default = moon-only
> **1M**.

**Goal:** a user-friendly, in-app guide to ALL of Sidera's planning features — desktop AND /m,
**precisely** reflecting real capabilities (no phantom features, no stale claims). Multi-session
effort (G1–G3 below). UI-facing name: the app is **Sidera**; repo/technical ids stay
"frame the world".

## Ground rules

- **Accuracy is the product.** Every guide claim is verified against the LIVE UI (browser, both
  shells) before the copy lands — the inventory below is the checklist, DECISIONS.md is the
  provenance. A feature that moved/renamed since its DECISIONS line ships with the guide FIXED,
  not copied stale (this file lists the current names).
- **Fences hold:** guide UI lives under `src/components/panels|ui|mobile/**` + `src/styles/**`
  (design fence); globe `client:only` (C4); NO globe/lib edits for the guide — spotlight/coach
  anchors target DOM (stable class names), never the canvas. Instrument idiom: mono caps,
  tokens.css only, tips.css grammar for micro-help.
- **Two shells, one content source.** Guide CONTENT = one data module (chapters/steps as plain
  typed data, e.g. `src/components/panels/guideContent.ts`); desktop renders it in a panel,
  /m renders the same data in a Sheet — the PlanSheet-twin discipline (no cross-shell imports;
  fence test enforces).
- **Build on what exists:** `Faq.tsx` (nav "FAQ" island, open-gated) is the natural HOST or
  gets absorbed/retired — decide in G1, don't run two help systems long-term. InfoDots + tips
  stay the micro-layer; the guide is the structured macro-layer.

## Feature inventory to cover (the checklist — verify each in-browser)

**Time** — TimeScrubber conveyor: drag (endless), edge-taps = prev/next almanac event,
double-click-middle = NOW, date + precise-time inputs, day ◀▶ / hour ◀▶ steppers, PLAY + rate
select (FF = red), twilight bands + sun/moon curves + target trace (thick = in THIS frame),
cursor colours **teal LIVE · amber pinned-past · blue pinned-future** (2026-08-15b), NOW button;
/m MobileTimeDock twin + status-strip time chip.

**PLAN / FIND window** (2026-08-15b: ONE topnav segmented toggle beside the wordmark; shared
window is draggable + resizable (◢), keeps spot+size across the switch, × closes):
- **PLAN (LIGHT PLANNER):** sun/moon/target skyline verdicts against the REAL local horizon
  (terrain+buildings, coverage/trust readout), jump-to-time chips, THIS FRAME · NEXT 36 H,
  TODAY chronology, MOON · PHASES & DISTANCES (supermoon), SPOT STARS · NPF, Milky-Way season.
- **FIND IN FRAME** (needs FPV — the frame IS the query): per-day standings at the scrubber
  hour, body chips (**moon-only default** 2026-08-15b; sun/GC one tap), range 1W/1M/6M/1Y,
  in-frame ghost RINGS + phase-accurate body pictures + per-hit day-arc paths + dd.mm labels
  (moon adds phase %), click ring/row = jump + track (camera unmoved); **SUNSETS · IN FRAME**
  (SET/RISE/GOLD chips, per-row .ics, ±°/day drift).

**TARGET panel** (top-right; /m TARGET sheet): track sun/moon/planets/stars/Messier·NGC/
comets/asteroids/GC (SKY search + long-tail), object card (RA/Dec · Δ · magnitude with
naked-eye verdict · phase/disc · SIZE→DIST), SHOW marker, TRAIL, **GHOSTS ± N EVERY step**
(N per side, max 15; first ghost exactly one step out; ghosts render BEHIND the real body —
2026-08-15b), NEXT SESSIONS dark-sky windows, rise/set jumps.

**Sky interactions:** hover = names + reticle ring (desktop), right-click sky menu (desktop) /
long-press (/m): track · aim · ghosts · rise/set jumps; tap-to-reveal names (/m); star names
at night; FIND-standing hover sync (row ⇄ ring).

**FPV (LOOK FROM HERE):** double-click ground or 🧭 MY LOCATION (client-side only, C6) or a
pin; walk (WASD/joystick), drag-look, wheel-FOV / FOCAL slider, rise/sink, camera deck
(2D/3D · day-night · SAT · PIN · BLD toggles, ALTITUDE/FOCAL ZOOM/BUILDINGS sliders), mini-map,
FPV HUD (position/focal/heading/pitch/eye/sun/moon), EXIT LOOK/ESC.

**Save & share:** `#f=`/`#p=` share links carry the exact pose **and pinned time** (`&t=`;
LIVE never persisted); **SAVE PLACE** (desktop deck) / **◎ SAVE VIEW** (/m SceneActions,
one-tap auto-title) → **MY PLACES** (desktop MY PINS · PLACES tab; /m idle SEARCH sheet);
tap = restore time first, then the exact viewpoint. Login: nav Sign in (desktop) / status-strip
chip (/m); the pose hash survives the login round trip. Quotas: 50 places; pins 100 free/1000
premium.

**Search:** LocationFinder EARTH (Photon autocomplete · Nominatim on Enter) / SKY (catalog +
enriched long-tail) with auto-aim; /m MobileSearch twin.

**Photo features (secondary chapter — owner 2026-08-14: uploads are a side gimmick):** upload
RAW/JPEG → EXIF → frustum + image plane, real-time what-if (focal/heading/pitch/position/time),
plane opacity, FPV-from-photo, member pins (C6 reduced precision default), Explore tour,
marketplace + FAQ pointers.

**Mobile shell specifics:** tab bar SCENE · PLAN · SEARCH, TargetPeek, dock, sheets, DESKTOP
link, account chip, SceneActions chips, FpvControls.

## UX shape (G1 decides; recommendation below)

Recommended: **hybrid** —
1. **GUIDE panel** (chaptered, scannable, searchable-lite): desktop = a `.pp`-grammar window
   or full overlay (FAQ's slot in the nav → "GUIDE"); /m = a full Sheet from the PLAN sheet or
   tab bar. Chapters = the inventory above, each: what it is · where it lives (both shells) ·
   a 3–5 step "do this" · the one gotcha worth knowing.
2. **Guided journeys** (3, tour-style coach marks over the live UI, skippable, mobile-aware
   touch targets): "Plan a sunset over your skyline" (FPV → FIND → SUNSETS → jump) ·
   "When does the moon stand in MY frame?" (FIND moon default → ghosts → save the view) ·
   "Scrub time like an instrument" (scrubber → bands → play → NOW).
3. First-run discoverability: Welcome gains a "HOW IT WORKS" entry; empty states already point
   at affordances (keep that grammar).

## Sessions

- **G1 (next):** in-browser inventory audit against this checklist (fix any drift found) →
  pick the UX shape (owner ratifies the hybrid or trims) → build `guideContent.ts` + the
  desktop GUIDE panel skeleton with 2–3 finished chapters + the /m Sheet twin rendering the
  same data → FAQ decision (host/absorb/retire) → gates + both-shell verify.
- **G2:** remaining chapters + the 3 guided journeys (coach-mark primitive in ui/ — DOM-anchored
  spotlight, pointer-safe, touch-sized) + copy pass (owner voice: instrument, terse, friendly).
- **G3 (buffer):** owner taste pass, screenshots for chapters if wanted, release canary ride.

## Done gates (every guide session)

`npm test` + `npx astro check` green · both shells browser-verified (402×874 for /m) · every
shipped claim demonstrated live once · DECISIONS + memory twins updated · no globe/lib edits.
