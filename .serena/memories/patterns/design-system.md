# mem:patterns/design-system — Claude Design "Frame the World" (imported 2026-07-10)

Source: Claude Design project `fb0d7afa-8a4f-4b2f-9a59-517fb1eeb46c` (owner jaysonx1009@gmail.com),
file `Frame the World.dc.html` (canvas mode, 1234 lines) + `globe-scene.js`/`image-slot.js`/`support.js`.
Round-trip CONFIRMED working after the killswitch fix (see `mem:project/dev_environment`). Fence rules +
push-back semantics: `.claude/claude-docs/provenance/CLAUDE_DESIGN_MEMO.md`. Read the canvas for pixel-level layout.

## Tokens → live in `src/styles/tokens.css` (source of truth) + GL bridge `src/lib/theme/tokens.ts`
Chrome (all adopted): bg/base `#05070B` · bg/raise `#0B0F14` · surface/1 `#12161C` · surface/2 `#1A1F27` ·
border/1 `#232935` · text/1 `#E8ECF2` · text/2 `#9AA4B2` · text/3 `#5B6472` (large/decorative only — 3.03:1
on surface fails AA body) · accent/500 `#38E1D0` · accent/600 `#2FD1C4` · danger `#E8756A` · warn `#E8A268` ·
golden tint `#FFB865`. **Accent is the ONLY element permitted to glow.**
Globe swatches on the board (`globe/land #7A8E84`, `globe/water #0A1118`) were NOT adopted — the globe is
FENCED (D14) and its palette is browser-VERIFIED (`land #38495B`/`water #0F2233` + land-hi/peak/atmosphere/
graticule/star). Divergence is deliberate; revisit only if the user wants the sage-grey/near-black globe look.

## Type (board 02) — loaded via Google Fonts `<link>` in `Layout.astro`
UI = **Space Grotesk** (400/500/600), readouts = **IBM Plex Mono** (400/500). Scale: DISPLAY 56/500/-1% ·
H2 32/500 · H3 20/500 · BODY 15/400/1.6 · MICRO 11/500/+16% (labels, uppercase) · MONO READOUT 13 (coords/
EXIF). Lat/lon + focal + heading + time always render in mono (e.g. `48.8583° N  2.2923° E · 35 MM · 128° · 18:42`).

## Spacing (4px base) + radii
4 hairline · 8 control padding · 16 row gaps · 24 panel padding · 40 section gaps · 64 page margins.
Radii: 10 (cards/panels) · 14 (large surfaces) · pill (chips/buttons).

## Motion (board 04) — the flight/interaction spec
micro (hover/fill) 180ms · panels/sheets 400ms · camera flight desktop 2200ms / mobile 1600ms ·
easing ALL flights `cubic-bezier(.65,0,.35,1)` · reduced-motion = 300ms x-fade. NO springs/bounce.
Idle globe drifts **0.035°/frame**, pauses on interaction, resumes after **8s** idle.

## Screen boards (build against these in Phase 2+)
01 Landing / Globe Home (1440×900, idle rotation) · 02 Explore (pin hover, rotation paused) ·
03 Pin→Detail (one continuous cinematic flight, 2.2s) · 04 Photo Detail (live EXIF sliders — **double-click a
slider resets to the EXIF value**; focal/heading/time-of-day rows). States board: pin (hover 1.4×, cluster,
focus ring), quota badge `7 / 10 SAVED` (free tier, D8), controls PRIMARY "UPLOAD A PHOTO" / GHOST "EXPLORE THE
GLOBE" with default/hover/focus, chips (RECENT/GOLDEN HOUR), search input default/focus/error, toast/notice.

## Rules when consuming
- Design imports write ONLY under `src/components/panels|ui/**` + `src/styles/**` — NEVER `globe/**` or `lib/**`
  (the GL bridge `lib/theme/tokens.ts` is the one exception: regenerate it after any token change).
- After implementing a screen against real constraints, `write_files` the shipped state back to the canvas
  (snapshot semantics — re-run after token/component changes). Related: `mem:core`, `mem:patterns/globe-rendering`.
