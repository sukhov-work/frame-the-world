# WIP 2026-08-19 — Owner UX batch #3 (9/9 SHIPPED + 2 batch-#2 tails)

Full record: DECISIONS.md 2026-08-19c. Gates 1,062/1,062 · astro 0 err/5 hints ·
browser-verified BOTH shells (shots verify-shots/uxb3-01..07). Ran under the
investigate-design-v3 discipline (implement/Deep, 4-agent cited fan-out).

## The 9 items → where they live
1. Desktop toggles 2×4: `camera-tilt.css` `.ct-row` flex→grid repeat(4); compass = cell 1
   (justify-self center). Zero JSX change. Supersedes qol3 single-row.
2. Desktop radar <10 km: `AIMCONES.desktopFullAltM/desktopTopAltM` (8/10 km); aimCones
   `update` ctx gains `band`; stepAimCones passes shell-aware (isMobileShell → 25/50 km).
3. MY-PLACES-ON-MAP desktop fix — TWO causes: (a) camera-tilt lit rule missed
   `.ct-aim.is-on/.ct-places.is-on` → chips always looked OFF → owner's "enable" click
   persisted the layer off; (b) markers were 2D-MapWindow-only → new
   `globe/scene/placeMarkers.ts` (instanced billboard lavender ring-dot, PLACEMARKS tunables,
   camera-anchor precision, depthTest:false + CPU far-hemisphere cull, resnap idiom, NO
   picking) wired in StylizedTiles: attach after pins + step in stepPinsUpdate + idle
   `ensureLoaded` kick (PLACEMARKS.fetchIdleMs 3.5 s — main view loads places without the
   map window). Tail closed: `places.addLocal/removeLocal` — both save paths push the new
   place (POST returns {placeId}; client builds the PlaceListItem), MyPins delete drops it.
4. UNFOLLOW → find-in-frame off: `sky.stopFollowing` calls
   `useFindStore.setBody(map(target.id), false)`; body:sun→"sun", body:moon→"moon", else
   "target" (the targetIsBody mapping). `find.open` untouched.
5. /m LAYERS expands LEFT: `.m-layersrow` `flex-flow: row-reverse wrap-reverse` — anchor
   chip DOM-FIRST so it never moves; overflow wraps ABOVE; max-width 100vw−1.5rem.
6. RADAR BEARINGS REGRESSION (only moon line): two persistence traps from batch #2 —
   (a) stopFollowing persisted skyTargetVisible:false → boot restored SHOW-off → the new
   `&&visible` aim gate killed the cyan line permanently → dismissal now SESSION-ONLY
   (mirrors `track`); (b) un-labelled DISABLE DIRECTION could flip the WRONG body's aim
   flag while that body was tracked (pickSkyBody coincident tie) → row now names the body
   ("DISABLE SUN DIRECTION"); + ONE-TIME PREFS RE-ARM: `prefsRev` stamp — saveViewPref
   writes rev 2 on every save; sanitize drops persisted FALSE for
   aimSun/aimMoon/aimTarget/skyTargetVisible from un-stamped blobs. Deliberate offs
   re-persist stamped. Comet-era cometVisible:false loses SHOW-off once (accepted).
7. Places lists nearest-first: new pure `lib/geo/proximity.ts` (roughDistDeg2 equirect
   deg², antimeridian wrap + cos-mid-lat; stable sortByProximity). Applied at both fetch
   sites (MyPins PLACES + MobilePlaces); position = camGeo ?? focus; sorted once per fetch
   (no reshuffle while panning — deliberate).
8. /m SAVE VIEW optional name: SavePlaceChip 3-state (idle→naming→busy); naming = small
   Sheet PORTALED to <body> (the .m-actions z-10 fixed stack sits exactly where the soft
   keyboard lands; sheet = the shell's one keyboard-safe input home, per MobileSearch).
   Empty submit keeps the `View · stamp` auto title. Supersedes the 2026-08-15
   auto-title-only ruling.
9. GOTO tracked-target chip: BodyChip strip EXTRACTED FpvHud → `panels/SkyGotoChips.tsx`.
   Desktop: FpvHud renders it (every-mode S6 rule intact). /m: island mounted in m.astro
   (MiniMap fence-exemption precedent), self-gated to FPV (`body.m` && !fpvLive → null; 2D
   map has no sky); body.m CSS = thumb-size + bottom clamp 190 px (joystick/peek). BELOW
   HORIZON (tracked target ONLY — sun/moon keep hiding): dimmed `.fh-chip--down`, click →
   `nextRiseAzimuth` (new in lib/ephemeris/dayArc: first ≤0→>0 crossing of
   targetElevationSeries over 48 h, wrap-aware az lerp, computed ON CLICK) → aimAtSky(azRise, 0);
   null → current az at horizon. /m target-chip tap aims WITHOUT opening the sheet.

## Rulings this session
- UNFOLLOW dismissal is SESSION-ONLY (never persisted) — persisting it bricked the aim
  line across reloads. Follow paths still re-enable SHOW.
- prefsRev blob stamping is the pattern for future one-time pref migrations.
- Below-horizon goto = tracked target only (a permanent night-time sun chip would clutter).
- Proximity sort happens once per fetch, not live — a list must not reshuffle mid-read.

## Traps (new)
- The owner's chrome-playwright CDP Chrome (:9222) lacks the occlusion flags —
  rAF-throttled tabs freeze the globe loop; `page.bringToFront()` un-throttles. verify-chrome
  refuses the port when that foreign Chrome owns it (by design) — attach instead.
- InstancedMesh billboard markers with depthTest:false need a CPU far-hemisphere cull or
  they shine through the planet from orbit (placeMarkers `facing` dot test).
- A `.m-actions`-descendant Sheet is capped at the stack's z-10 — portal to <body>
  (createPortal precedent now exists in SavePlaceChip).

## Dev seams
- NEW `window.__placesStore` (store/places.ts + global.d.ts). `__memberStore` already
  existed (store/member.ts) — `setState({phase:"member"})` unlocks member-gated chrome for
  browser verification (server calls still 401, expected).

## UNVERIFIED-browser (unit-tested / low-risk)
- Below-horizon chip click end-to-end (PER is circumpolar from Dnipro; nextRiseAzimuth has
  3 unit tests incl. the sun-from-midnight crossing check).
- Member save SUCCESS path server-side (fake client member → 401 by design).

## Open tails
FPV mini-map saved-place markers (GL globe + 2D map now both covered) · bright-target FIND
visibility refinement · owner taste pass (LAYERS toggle order, savename sheet, chip glyphs) ·
production canary rides next `wix release` (now carries batches #2 + #3).
