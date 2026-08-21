# wip 2026-08-21d — OWNER BATCH #5 (6 post-batch-#4 fixes) — COMPLETE

DECISIONS 2026-08-21d. Gates: vitest 1,107/1,107 (+6) · astro 0 err/5 hints · regressions
S1 23/23 + S2 15/15 + S3 18/18 + NEW `scripts/verify-uxbatch5.mjs` 17/17 (shots uxb5-01..05).
NOTE: the owner's 5 screenshots arrived as byte-identical placeholder icons — every fix was
driven from the written descriptions + own browser repro/shots (flag if a fix missed intent).

## What shipped (root causes, not just deltas)
1. **Radar band resting fills** — fill alpha was ×emphEased on ALL 3 surfaces → only the
   focused body (default target) filled; sun/moon strips read EMPTY. NEW
   `AIMCONES.fillAlphaRest 0.05` (> the 0.003 shader discard gate, < fillAlpha 0.08):
   GL uAlpha = (rest + (fill−rest)·emphEased)·overlayA (aimCones.ts); MapWindow + MiniMap
   always fill (`emphasized ? fillAlpha : fillAlphaRest`; minimap keeps ×2 patch scale).
   **Focal cone edge** — GL half-width is in RAY-EXTENDED units (×rayLenK 6): 0.0015 ⇒ 3.0×
   the radar direction line (the "fat borders"); now `edgeHalfWidthK 0.000625` ⇒ 1.25×,
   `edgeAlpha 0.7`; canvas twins stroke 1.5·dpr; MiniMap cone stroked the CLOSED wedge (far
   arc) — now boundary legs only, all surfaces consistent.
2. **/m radar shrink** — `AIMCONES.mobileRadiusK 0.8` applied in aimCones radius + focalCone
   reach (orchestrator pushes `mobile: isMobileShell` into both update ctxs — scene fence) +
   MapWindow rBase (draw AND tap-promote hit test — must mirror or desync). Mobile bands
   `bandSunMobile [0.24,0.32]` / `bandMoonMobile [0.34,0.42]` via `bandFor(key, mobile)` +
   both panel twins (MiniMap gets bands but NOT the radius shrink — card already CSS-124px).
3. **/m PiP true miniature** — S3's punched hole was a 1:1 crop + the z-10 MiniMap card sat
   INSIDE the hole (between GL z-0 and map z-20) = "minimap in minimap". Now: `.mw-pip` is
   **32vw × 32dvh** (equal fractions ⇒ box aspect ≡ screen aspect ⇒ the live camera reused
   UNTOUCHED); MapWindow publishes the measured box (deadbanded 0.5px) → NEW
   `minimap.pipRect/setPipRect` (nulled in the open-effect cleanup) → `TilesHandle.pipRect()`
   → GlobeCanvas post-`composer.render()` scissored `renderer.render(scene, camera)` into the
   rect (setViewport/setScissor take CSS px — three applies DPR itself; Y-flip vs
   innerHeight; RESTORE viewport after — composer reads it next frame; tonemap/sRGB native on
   backbuffer; bloom already off on /m). Mid-stack chrome hidden while /m map is up:
   `body.m.mw-open .mm/.m-fpvhud/.fh-chip {visibility:hidden}` (mounted, subs warm).
4. **/m place-point stays** — `MapWindow.viewFromHere` on /m now ONLY `setTempPin` + stays
   open (desktop keeps requestFpvJump+close). Safe because FPV entry fires on wantKind ≠
   fpvKind — tempFpv untouched ⇒ the live FPV under the PiP never re-enters. The
   document-capture click swallow is KEPT: it now guards the trailing synthesized click from
   radar tap-promote (window no longer unmounts). Hint → "LONG-PRESS — PLACE POINT".
   Open judgement: /m map now has NO jump-to-point affordance (▲3D long-press at map centre
   + MobilePlaces VIEW remain the FPV-entry paths) — owner may want a "GO HERE" chip later.
5. **/m dock date+time = desktop twins** — S1 #12's CSS deletion took `.md-date`'s rule body
   (left `.md-date,` dangling onto the indicator rule) ⇒ whole input `filter: invert(0.7)`,
   unstyled, light scheme. Rule rebuilt as the `.ts-date` twin (11px/3px 6px touch sizing,
   `color-scheme: dark`, indicator-scoped invert, :focus-visible accent) + the read-only
   `.md-clock` span → native `<input type="time" class="md-date md-time">` with the desktop
   `withLocalTime` null-guarded onTimeChange (tint classes dropped — desktop parity).
   `verify-uxbatch4.mjs` S1 check updated `.md-clock` → `input.md-time`.
6. **Shell-switch pose carry** — /m ALWAYS honored #p=/#f= at boot; the bug was bare
   `href="/m"` links (hash dropped → MOBILE2D.boot* 1100 km) + oblique tilt ≥10° lands 3D.
   NEW pure `mobileShellHash()` in lib/geo/urlPose.ts (unit-tested): #p= → tilt forced 0
   (2D door), alt/coords/heading/&t= preserved; #f= passes EXACT; garbage → "". Wired: an
   index.astro PROCESSED module `<script>` (imports the helper; binds both `a[href="/m"]` —
   topnav + coarse banner) + Welcome CTA onClick + the /m DESKTOP chip carries raw
   `location.hash` onto `/?d=1` at click time (MobileAccount returnTo idiom).

## Files
tuning.ts (fillAlphaRest, bandSun/MoonMobile, mobileRadiusK, FOCALCONE edgeAlpha/HalfWidthK) ·
scene/aimCones.ts (bandFor(key,mobile), mobile ctx, rest-fill, mobileNow closure) ·
scene/focalCone.ts (mobile ctx, reach ×mobileRadiusK) · StylizedTiles.ts (mobile push ×2,
TilesHandle.pipRect) · GlobeCanvas.tsx (PiP scissored pass) · MapWindow.tsx (rest fills,
mobile bands/radius ×2 sites, cone 1.5dpr, pipRect publish, /m place-only branch, hint) ·
MiniMap.tsx (mobileShell const, mobile bands, rest fills, cone legs-only 1.5dpr) ·
store/minimap.ts (pipRect) · MobileTimeDock.tsx (+time input, onTimeChange) ·
styles/mobile/dock.css (md-date rebuilt, md-time, md-clock rules removed) ·
styles/map-window.css (.mw-pip 32vw/32dvh) · styles/mobile/fpv.css (mw-open hide rung) ·
lib/geo/urlPose.ts (mobileShellHash) · index.astro (module script) · Welcome.tsx ·
MobileShell.tsx (DESKTOP chip) · tests: aimCones.test (+2 its), urlPose.test (+4 its) ·
scripts/verify-uxbatch5.mjs NEW · verify-uxbatch4.mjs (1 check updated).

## Traps (new this session)
- **/m re-mirrors the LIVE camera into location.hash ~1.6 s after boot** (urlPoseEveryFrames
  96) — verify scripts must assert the boot RESULT (camera-store probe), never the
  transformed link hash post-boot (first uxbatch5 run failed exactly there).
- GL focal-cone (and any aimCones-anchored quad) widths are in RAY-EXTENDED units when the
  group scale carries ×rayLenK — compare widths in RADAR-radius units before judging.
- Deleting a CSS rule that shares a selector list can orphan the surviving selector onto the
  NEXT rule (the S1 `.md-rate` deletion broke `.md-date`) — check the diff hunk's selector
  line, not just the deleted block.
- three's setViewport/setScissor take CSS px (internally ×pixelRatio); the composer's passes
  read the renderer viewport on the NEXT frame — always restore after a custom pass.

## Open tails
- T1 real-device: PiP scaled-pass perf/feel, band-wash taste (0.05 rest, ×2 minimap), mobile
  radar 0.8 + inward-band taste, iOS native time-input popover look.
- Possible follow-up: "GO HERE" affordance on the /m map for a placed point (see item 4).
