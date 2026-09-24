# wip 2026-09-25 — the /m UX pass after the iPhone 17 Pro test (owner order; UX only, "be careful not to regress")

Mode: fix/implement, small (`/frame`; no research agents — the seats and the tests were read directly).
Records: DECISIONS 2026-09-25 · ARCHITECTURE §7a′ (the calibration paragraph) · `MOBILE_PLAN.md` header · backlog T149 addendum · NSP.
Baseline + after geometry: a scratchpad probe on the 402 × 714 / 402 × 874 twins (`verify-shots/ux-{before,after}-*.jpeg`).

## The four items (all CSS + two component edits; no store / engine change)
1. **⌖ ALIGN → the LEFT rail** (`FpvControls.tsx` `ArLookToggle`, fpv.css `.m-aralign`): a 44 px `.m-act--icon` cell
   (glyph ⌖ over ALIGN, `data-act="ar-align"`) FIXED at the verdict column's seat (`10rem + 120px + 110px + 12px`), the
   column's TOP cell while calibrating (`body.m:has(.m-arcal__actions) .m-aralign` +156 px, in ar-camera.css); hidden with
   the map open like the float it left (`body.mw-open .m-aralign`). It stays a child of `.m-arwrap` for the "ALIGNED" flash —
   fixed geometry ignores the wrap (no transform / filter ancestor). What ALIGN is: on a gyro-only rung (`relative-*`) the
   tap ties the CURRENT phone pose to the camera heading (`alignEpoch` → `scene/arLook.ts` `ladder.align`). Why it showed on
   the iPhone WHILE calibrating: aiming at the sky closes the iOS compass gate (`orientationLadder` rung 2's
   `compassMinTopHoriz` / `compassMinScreenUp`) → the ladder falls to `relative-*`. There CONFIRM is already "an ALIGN by
   eye" (`arLook.ts` commit branch) — hiding ALIGN during calibration is an owner call, NOT done.
   **The slider** (`.m-arcal__mixv`): `--m-armix-h` now reads the mini-map as RENDERED — `body.m:has(.m-arcal__mixv):has(.mm--collapsed)`
   reserves 46 px (the puck) instead of 134 (the card). The 714 twin: 55 → 128 px calibrating, 55 → 74 px in CAM view.
2. **CONFIRM nearest the stick**: DOM/visual order CANCEL · RESET · CONFIRM (was CONFIRM first). `verify-ar-calibration`
   reads the order (`ui.acts.join()`), `mobileArCamera.test` too — both updated.
3. **See-through sticks** (fpv.css `.m-joy`): fill 55 % → 24 %, blur 6 → 2 px, rim 35 → 40 %; the knob untouched; the
   focal `.m-joy__footer` on its own 72 % pill (bottom 6 px, 2 px 6 px padding) — the owner: "do not make the focal
   value transparent".
4. **The tab bar is ONE LINE** (chrome.css `.m-tab` row: glyph beside label, 0.56rem / glyph 0.85rem, padding 0.3rem 0
   0.55rem, the row's bottom pad = the safe-area only): 48.6 → 27.2 px (56 %). The bottom column 166 → 145 px. **Every seat
   above the column dropped 1.2rem**: `.m-actions` 10.8 → 9.6rem, `.m-joy` 11.2 → 10rem, `.m-joy--aim-fpv` 10rem + 120px,
   `.m-arcal__actions` 10rem + …, `--m-altcol-bottom-base` 16.4 → 15.2rem (map-window.css fallback too). The action chips'
   gap to the column: 6.7 → 8.9 px (no overlap). The live dot moved to `right: -5px` (inside the 6 px gap).

## Traps learned
- `pinchHardening.test` reads the FIRST occurrence of each audited selector in the file — a COMMENT naming `.m-actions`
  before its rule fails the audit (reworded without the literal).
- `mobileArLook.test` sliced `css.indexOf(".m-aralign {")` — the `body.mw-open … .m-aralign {` hide rule comes first
  in fpv.css; the test now looks for the line-start `"\n.m-aralign {"`.
- The probe's CDP session `close()` is synchronous (no promise) in `scripts/lib/cdp.mjs`.

Related: `mem:project/wip-2026-09-22-ar-ui-rework-fpv-quirks` (the seats this pass moved) · `mem:project/wip-2026-09-19-ar-calibration-box-meshbugs`.
