# wip 2026-10-10 — the owner's device feedback: THE RADAR ON GLASS · FIND THIS ONE + the range row · THE KEYBOARD LIFT

Mode: fix (`/frame` under investigate-design-v3, portable core; no research agents — the code was read directly; every
claim measured on the Chrome twins). Owner: "a very small session with specific mobile fixes, focus on not regressing
existing web and mobile functionality … make sure to do both farm tests and chrome tests" (iPhone 17 Pro radar
screenshots; Pixel screenshots of FIND IN FRAME and SAVE VIEW). Records: DECISIONS 2026-10-10 · ARCHITECTURE (the
`radarCanvas` + `useSheetInputFocus` bullets) · `conventions/globe-tuning.md` §AIMCONES (`rayLenK` floor + the stroke
knobs + the iPhone/Pixel trap) · MOBILE_PLAN header · backlog T155 (the farm leg) + T156 (cookie hygiene) · NSP.
RELEASED TWICE the same day on the owner's "go for farm tests, then release everything": `2de06b6` (PR #137) → v1.36.24, then the
keyboard-lift fixes `d36ff18` (PR #138) + `c318ffd` (PR #139) → **v1.36.26 LIVE**; farm-verified on the real iPhone 17 Pro (DECISIONS 2026-10-10b).

## 1. THE RADAR ON GLASS (owner: "radar lines too narrow on the iPhone … make them thicker and more vivid, still tasteful; same
for the sectors and radiuses; parity with the Pixel; understand why the iPhone diverged")
**Why the iPhone diverged — the one place the two phones fell on opposite sides of 1:1.** The mini-map's backing store was
`SIZE_PX 200 × min(DPR, 2)` = 400 px, drawn into the /m card's 124 CSS px: the iPhone 17 Pro (DPR 3 → 372 physical px)
MINIFIED it — a 2 px hairline lost contrast — while the Pixel 6 Pro (DPR 3.5 → 434) MAGNIFIED it. Everything else was the
same on both phones (the GL renderer runs the lean 1.25 / flat-map 1.5 cap on every coarse pointer; the chart caps at 2×). The
GL fan's rim arcs and rise/set spokes were `LineSegments` — ONE DEVICE PIXEL at whatever ratio the renderer ran — so they read
as faint hairlines beside the world-width direction-line quad on any phone; the direction line / focal cone legs are quads
(unchanged mechanism). Can't be proven on the Pixel from here (no adb device attached) — stated as the cause with the numbers.
**The fix — one stroke profile, every surface** (`lib/geo/radarBands.radarStroke(mobile)` → `AIMCONES.mobileStroke`
`{ widthK 1.4, lineAlphaK 1.12, rimAlphaK 1.4, fillAlphaK 1.5 }`; desktop the identity):
- `panels/radarCanvas.ts` authors every stroke in SCREEN CSS px (`AIMCONES.strokePx` 1 × widthK × the store/css ratio the
  surface hands it as `dpr`); the rim / line / fill alphas carry the lifts.
- `panels/MiniMap.tsx` sizes its store to the GLASS (`clientWidth × devicePixelRatio`: 372 on the iPhone, 434 on the Pixel,
  400 on a retina desktop — never dearer); the cone legs 1.5 × the line (the 1.5× rule kept); the target ray runs to `px`
  (past the patch's corners).
- `panels/MapWindow.tsx` keeps its 2× store cap, passes `store / client`; its target ray reaches `chartRayReachPx(w, h, ax, ay)`
  = one diagonal + the anchor's offset from the centre (a panned chart used to end the ray mid-screen: "scrolling around the
  2D map and the dials suddenly end"); the tap-promote reach reads the same.
- `scene/aimCones.ts`: rim + spokes are MESH quads (`AIMCONES.rimHalfWidthK` 0.0015 × widthK ≈ 1.5 CSS px on every surface —
  a deliberate desktop change from the DPR-dependent hairline), `line.scale.x = widthK`, the alphas carry the lifts; a shell
  flip rebuilds. `scene/focalCone.ts`: the boundary rays × widthK (rebuild keyed on `mobile` too), their alpha lifted.
- THE RAY CROSSES THE SCREEN: `aimCones.update` now takes `camera`; every frame `viewReachK(camera, group.matrix, cap)` carries
  the camera and the viewport's four corner rays into the tangent group's frame and `groundReachK` (pure, tested) returns the
  farthest plane hit (a corner looking past the plane = "to the horizon" = `AIMCONES.rayReachMaxM` 400 km); the target ray's
  `scale.y = max(rayLenK 6, reach × 1.05)`. Measured: nadir /m 2.2 km → reachK 1.30 (the 6× ray stands); ▲ 3D tilt → reachK 6.8,
  rayK 7.1 (the owner's "shorter than the screen" case — the old ray ended inside the view). DEV seam `__globe.aimRadar()`
  → `{ rayK, reachK, widthK, rim: "mesh", radiusM }`.
Measured on glass (the canvases' own pixels along the gap ring between the sun and target bands — only the direction lines
cross it; `verify-mobile-fixes-2026-10-10` leg 1): iPhone twin ray 3.93 store px = **1.31 CSS px** · Pixel twin 5.13 = **1.47
CSS px** (parity ≤ 0.45) · desktop 2.62 = 1.3 CSS px (unchanged weights: the 1 px line + 1.5 px legs, within AA) · cone legs
6.28 / 7.33 / 3.02 · the chart 2.68 store px at 2× = 1.34 CSS px · every ray reaches the patch edge.

## 2. FIND THIS ONE + the range row (owner: "I expect that only this specific object will start being tracked … the default period
is 1 month and from object props we have no way to set it — make FIND IN FRAME half the width, the other half the period chips,
disabled until tracking is on")
- `store/find.soloBody(body)` → `{ sun:false, moon:false, target:false, [body]: true }`; `FIND_RANGES` (1W 7 · 1M 30 · 6M 182 ·
  1Y 365) lifted into the store — the desktop FindPanel, the /m FindSheet and both target panels read the ONE list.
- `mobile/TargetSheet.tsx` + `panels/TargetPanel.tsx`: `.m-findrow` / `.tp-findrow` — the button `flex 1 1 50%`, the four chips
  `flex 1 1 50%` (chrome.css / target-panel.css), `disabled={!findOn}`, `aria-pressed` on the active range; ON = `soloBody` +
  `setOpen(true)` (desktop: PLAN still yields), OFF = `setBody(body, false)`. The sky menu's quick-toggle stays ADDITIVE
  (`setBody(findBody, !findOn)`) — only the object panels are solo (a documented scope call; the menu is a per-body chip).
- Measured (iPhone twin): row 373 px → button 184 / chips 183; before the tap the chips are disabled; the tap → bodies
  `{sun:true, moon:false, target:false}`, open, 1M lit; 1Y tap → 365; the FIND tab shows ☀ on · ☾ off · ✦ off · 1Y.
  Desktop: the same row (btn 130 of 264), the click solos + PLAN yields, 6M → 182, a second click disarms the sun only.
- Guide `find-chips` body gained the sentence (lint ≤ 5 sentences holds).

## 3. THE KEYBOARD LIFT (owner, Pixel: "the keyboard obscures the actual dialog and input — hard to even understand that something
is hiding behind the keyboard")
`mobile/Sheet.tsx`: every non-`full` sheet rides `bottom: <lift>` — `keyboardInsetPx(innerHeight, vv.height, vv.offsetTop)`
(the layout viewport's bottom minus the visual viewport's; iOS Safari and Android Chrome ≥108 shrink only the VISUAL viewport,
so a bottom-anchored fixed sheet vanished under the keys; where a browser resizes the layout viewport instead the inset reads
0 — no double lift), re-read on every `visualViewport` resize / scroll, clamped by `sheetLiftPx(inset, innerH, sheetH,
SHEET_TOP_GUARD_PX 56)` so the head stays on the glass; `bottom` not transform (the slide-in and the drag own transform);
chrome.css eases `bottom` 160 ms; `data-lift` + `.m-sheet--lifted` are the probes. `full` sheets (SEARCH, GUIDE) never lift.
`useSheetInputFocus` is untouched (it pins the LAYOUT scroll; the lift moves the sheet). Measured: a synthetic 300 px keyboard
(`visualViewport.height` shadowed + a resize event — CDP cannot raise a soft keyboard) → the SAVE VIEW sheet's bottom 874 → 574,
`data-lift` 300, the input bottom 560 < 574, still focused, scrollY 0; the keyboard gone → 874; the full SEARCH sheet keeps its
place (top 71). The REAL keyboard is the farm leg's K check (T155 — unrun).

## Gates
vitest **3,340 / 225 files** (3,295 / 222 before; +45: `radarStroke2026-10-10` · `mobileSheetLift` · `findThisOne` + the find
store's solo tests) · `astro check` **0 / 0 / 13 hints** (12 was the baseline; the 13th is in the new code — hints are not a gate).
Browser (house Chrome :9333, dev): NEW `scripts/verify-mobile-fixes-2026-10-10.mjs` — legs 1 radar-on-glass (iPhone 402×874@3 ·
Pixel 412×892@3.5 · desktop 1600×1000@2) · 2 the dials leave the screen (the chart after a 600 px pan, the GL fan nadir + tilt) ·
3 find-this-one · 4 the keyboard lift (signed in) · 5 the desktop twin — **51 PASS · 0 FAIL (the first pass found two harness defects of its own — a tap during the sheet's slide-in, a pan stroke that started in the aim stick — fixed, then clean)**. Regressions, one Chrome, in turn:
`verify-mobile-batch-2026-09-08` 127/127 (two signed-out checks FAILED on the first pass with the member cookie still in the profile — T156; clean once signed out) · `verify-mobile-fixes-2026-09-18` ALL PASS (45; the same cookie leak on its anonymous leg the first time) · `verify-qaslice-cab` ALL PASS ·
`verify-fpv-carry-2026-09-22` 29/29 · the pose-catalogue sweep (`verify-visual-sweep --sheet --no-legs`) 68/68 checks, 2 contact sheets (verify-shots/sweep/sweep/sheet-01.png + sheet-02.png), no look regression at the nine catalogue poses.
**The farm leg is written, not run** (`tools/devicefarm/ios-mobile-fixes-2026-10-10.mjs`): `api.trycloudflare.com` and every
`*.trycloudflare.com` host timed out from this Mac all session (cloudflare.com / 1.1.1.1 fine; seven utun interfaces up — the
VPN is the first suspect); four cloudflared retries. T155. Then with the VPN on (owner): Cloudflare still dead; an SSH
reverse tunnel through localhost.run (`ssh -R 80:localhost:4321 nokey@localhost.run` → `https://<x>.lhr.life`, `wix dev
--allowed-hosts .lhr.life`) served the dev build but at ~1 s/request and 57 KB/s — two Device Farm sessions (120 s and
300 s waits, ≈10 device minutes) reached only the placeholder planet at the 1,100 km boot view (the error PNG under
`verify-shots/perf/`): a dev build cannot boot the engine over a slow tunnel. The farm leg runs against the LIVE site
after the release (`--prod`: DOM + screenshot reads, prefs-seeded target — no DEV seams in prod).

## The farm on the LIVE site (2026-10-10b) — and the keyboard finding
`ios-mobile-fixes-2026-10-10.mjs --prod`: the sun seeded through `ftw:view-prefs:v1` before the FPV boot, FIND read from the DOM,
the GL fan judged from device screenshots (an inline PNG reader; the npm registry was unreachable through the VPN), the member
cookie through WebDriver `setCookies` on the live origin. On v1.36.24: R1 store 372 · R2 the ray **3.93 store px = 1.31 css px**
(byte-equal to the Chrome twin) · R3 legs 5.97 · R4/R5 cyan on the map box's border at nadir + tilted · F1–F3 the row, the solo
scan, the FIND tab's ☀-only · K0 the member sheet opens. **The keyboard:** `element.click()` focuses but iOS raises no keyboard
for a synthetic click; a NATIVE tap (`mobile: viewportRect` → 54 pt top inset → `performActions` in `NATIVE_APP`, the element
scrolled into view first) raised the real keys — vvH 714 → 404 — **and the sheet did not lift**: iOS Safari 26 delivered no
`visualViewport` resize to the mount-time listener. Fix: `useKeyboardLift` polls (120 ms for 2.5 s) after every document
focusin/focusout and once at mount → v1.36.25 — STILL no lift on the farm (the keys rose ≈3 s after mount with no
focus event; `innerHeight` read 404 in one state) → the inset from the sheet ROOT's layout bottom + the poll held while a field
inside the sheet has focus → v1.36.26 → run 4 (≈4 device minutes): K0 the member sheet opens · K1 the native tap raised the keys (vvH 714 → 404, the layout edge 714) · **K2 the sheet lifted 310 px (`data-lift` 310)** · **K3 its bottom edge sits on the visual viewport's bottom (404 = 404) — above the keys** · K4 the name field visible (bottom 389) and focused, scrollY 0, the head at 300 — the owner's Pixel screenshot, fixed on the real iPhone (`verify-shots/perf/devicefarm-fixes-1010-2026-10-10T01-00-55-saveview-keyboard.png`). The P leg (the PLAN sheet's number field) is Safari's OWN pan: the viewport panned 310 to the field (visible at 332), nothing to lift, the harness's "keys up" read needed a pre-tap baseline (fixed in the script; INFO, not a product fault).

## Traps learned
- **The Chrome twin's synthetic `visualViewport` resize LIES about iOS** — the real phone sends none for the keyboard; only a
  real-device run caught it. A WebDriver click never raises iOS's keyboard; a native XCUITest tap does.
- A dev build over a 57 KB/s tunnel never boots the engine on a phone (two sessions wasted) — the farm tests the LIVE site.
- A `let x = AIMCONES.foo` under `as const` infers the LITERAL type (`6`) — annotate `: number` before reassigning.
- A canvas 2D `const ink = …` already lives in `MiniMap.draw` — a shadowing `const ink` inside the cone block broke `ink.viewer`.
- A SkyTarget carries a METHOD (`stateAt`) — never inject one as JSON through `__skyStore.setTarget`; the dev server serves
  the app's modules, so a harness does `await import("/src/lib/ephemeris/targets.ts")` in-page and calls `bodyTarget("sun")`.
- A touch stroke that starts inside the left aim stick (x ≲ 126, y ≳ 486 on the 402×874 twin) swings the stick, not the chart
  — chart pans start at the centre. A tap during the sheet's 400 ms slide-in lands on the scrim — sleep 800 ms after it opens.
- The house Chrome profile keeps a seeded MEMBER cookie across harnesses: the batch's two signed-out SAVE-cell checks and the
  09-18 harness's anonymous leg FAIL after any harness that signs in and does not sign out (T156) — delete the cookie in the tail.
- Serena's `replace_content` reported `ServerNotFoundError` (no JetBrains IDE) yet the edits LANDED — verify with `git diff`,
  then edit through an exact-string patcher (`scratchpad/patch.py`) instead.
- zsh: a word starting with `=` (`echo ====`) is a command-path expansion error — use `----`.

Related: `mem:project/wip-2026-09-30-align-minimap-pin-mesh-culling` (the previous device round) · `mem:project/wip-2026-08-18-u4-aim-cones`
(the radar's birth) · `mem:project/wip-2026-08-15-ux-batch` (SAVE VIEW + the /m FIND tab).
