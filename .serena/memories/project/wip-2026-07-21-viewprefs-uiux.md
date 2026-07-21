# wip 2026-07-21 — view-prefs persistence + default flips + detail-panel close (owner batch)

Status: SHIPPED. Gates: vitest 609/609 · astro check 0/0 · browser-VERIFIED (Playwright MCP → CDP
Chrome `--remote-debugging-port=9222` throwaway profile → wix dev :4321; Playwright MCP needs that
CDP endpoint up FIRST or it dies `ECONNREFUSED ::1:9222`).

## What changed (owner asks)
1. **Defaults**: `store/camera.ts` → `groundMode: stored ?? "satellite"` (SAT chip lit by default),
   `fpvBuildingSolidity: stored ?? 1` (FPV buildings fully shaded; slider double-click resets to 1 now).
2. **NEW `src/lib/prefs.ts`** — the ONLY localStorage seam in src (key `ftw:view-prefs:v1`, one JSON
   blob). `sanitizeViewPrefs` (pure, tested) drops unknown keys/wrong types, clamps solidity 0..1;
   load/save are try/catch no-throw; no `localStorage` (SSR/vitest node) → `{}` / no-op.
3. **Persistence wiring** (`store/camera.ts` + `panels/CameraTiltPanel.tsx`):
   - SAT (`setGroundMode`) / ☀☾ (`setSkyGuides`) / BUILDINGS (`setFpvBuildingSolidity`) persist
     INSIDE the store setters (only ever user-driven).
   - **PIN persists at the CHIP click only** — `setPinsVisible` is shared with the orchestrator's
     FPV declutter (StylizedTiles ~1130/1181 hide-on-entry, ~1080 restore-on-exit); persisting in
     the setter would let a mid-FPV reload freeze pins-off as a fake user choice.
4. **BLD chip persistence** (`lib/globe/enrichedVariant.ts`): pure `applyStoredVariant(search,
   storedOn)` — explicit `?enriched=` ALWAYS wins verbatim (off / cross-city / even empty); pref
   injects the variant only when the URL is silent. Pure `setVariantUrl(href, on)` writes the
   EXPLICIT state (param set/deleted, `#p=` hash preserved); `toggleVariantUrl` now delegates.
   TRAP the tests lock: from a pref-active plain `/`, a raw URL toggle would flip the WRONG way —
   the chip computes effective state → `saveViewPref("enrichedVariant", next)` → navigates explicit.
   `StylizedTiles.ts` builds ONE `enrichedSearch = applyStoredVariant(location.search,
   loadViewPrefs().enrichedVariant)` feeding BOTH `resolveEnrichedUrl` AND `resolveEnrichedBbox`
   (mask/seat bbox must follow the bake that actually streams).
5. **PhotoDetailPanel.tsx**: foreign viewed pin (`viewingPinId && !ownPhotoId`) → single `✕ CLOSE`
   in `.pd-actions` (REVIEW/START OVER are upload-flow verbs; unchanged for fresh uploads + own
   pins). Header quick-close `✕` (`.pd-close` in photo-detail.css, ct-pinpop__x idiom,
   margin-left:auto in `.pd-head__title`) on EVERY placed panel → `clear()` back to the bare map.

## Verification notes (browser, wix dev)
- Fresh profile boot: SAT chip on + `groundMode:"satellite"` + solidity 1 with `stored:null`.
- Chip toggles → localStorage JSON → reload restores state + chip lit-ness (dark + pins-off case).
- BLD: ON via chip → `?enriched=dnipro-o2w`; plain `/` reload → chip STILL on + exactly the o2w
  tileset requested (perf resource entries); OFF from pref-active plain `/` → pref false, 0 o2w
  requests. Dev-store hooks used: `window.__cameraStore` / `window.__uploadStore` (DEV-only).
- Foreign-pin panel driven via `__uploadStore.getState().openSavedPin({pinId, title, lat, lon, …})`
  (synthetic record, no network); fresh upload via `ingest({fileName, exif:{gpsLat…}}, 1)` + `place()`.
- Shots: `verify-shots/0721-foreign-pin-close-only.jpeg`, `0721-fpv-solid-buildings-default.jpeg`.
- Console errors on load are pre-existing env noise: frog.wix.com telemetry refused + anonymous
  `members/v1/members/my` 403.

## Files
`src/lib/prefs.ts` (new) · `src/store/camera.ts` · `src/lib/globe/enrichedVariant.ts` ·
`src/components/globe/StylizedTiles.ts` · `src/components/panels/CameraTiltPanel.tsx` ·
`src/components/panels/PhotoDetailPanel.tsx` · `src/styles/photo-detail.css` ·
tests: `test/lib/prefs.test.ts` (new) · `test/lib/globe/enrichedVariant.test.ts` (+5) ·
`test/store/camera.test.ts` (+2, incl. defaults lock).

## Not done / open
- Prod ships with the next commit + `wix release` (nothing released this session).
- Own-pin bottom row still REVIEW/START OVER (owner only asked about foreign pins); REVIEW on an
  own viewed pin opens the overlay with the remote preview — mildly odd, candidate for a later pass.
