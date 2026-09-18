# wip 2026-09-18 — THREE /m FIXES + the SIGN-OUT root cause — DONE, shipped + released (v1.36.14)

Mode: fix (`/frame`), three owner asks, "deploy everything after you fix and test". Records: DECISIONS 2026-09-18 + 2026-09-18b ·
§Traps / Wix (the form-POST trap) · CLAUDE.md gotcha · `conventions/wix-headless.md` §12b · `NEXT_SESSION_PROMPT.md` · `mem:core`.

## 1 · The whole-planet boot — `MOBILE2D.bootAltM` 1,100,000 → 18,000,000 (`tuning.ts`)
Only the bare `/m` boot reads it (`StylizedTiles` ~1299); hashes bring their own altitude; the desktop `POSE.cam` untouched. Above
`GATES.groundActiveAlt` (3,000 km) so nothing streams until a pinch in. `CONTROLS.zoomMaxAltM` (12,000 km) is the SLIDER/rate clamp
only — the library pinch is unclamped, so the boot altitude above it is fine. Nav chip reads `18000 KM` (`formatAltM`).

## 2 · The FPV rail (`mobile/SceneActions.tsx` · `styles/mobile/fpv.css`)
BUG: a member's ▤ SAVED PLACES was a TEXT PILL rendered after ✕ EXIT VIEW; the stack (SAVE 44 + gap + EXIT ~33 + gap + pill) outgrew
the altitude column's fixed seat (`--m-altcol-bottom` 16.4rem) → ⤓ covered ◎ SAVE. FIX: in FPV the opener is a 44 px icon cell
(`m-act m-act--icon m-act--places`, ▤ / PLACES) BETWEEN ◎ SAVE and ✕ EXIT VIEW; EXIT VIEW is the LAST cell; fpv.css publishes
`--m-altcol-bottom-base: 16.4rem`, `--m-altcol-bottom: var(--m-altcol-bottom-base)`, and `body.m:has(.m-actions .m-act--places)`
lifts the token by 52 px (44 + the 8 px gap). The map window's ◉ RE-CENTRE reads the same token, so it follows. Outside FPV the
pill above MY LOC is unchanged (gate `!tempFpv`). First `:has()` in the repo's CSS.
Test: `test/components/mobileFpvRail.test.ts` — `setTempFpv(true)` refuses without a `tempPin` (set one first in tests).

## 3 · SIGN OUT — "Cross-site POST form submissions are forbidden"
ROOT CAUSE (machine-checked against prod): under `@wix/cloud-provider-fetch-adapter` Astro's `url.origin` is `http://www.plux.today`;
a browser form POST says `Origin: https://…` → `checkOrigin` (ON since 2026-08-18) 403s EVERY real form POST live. Probe: form POST
with `Origin: http://www.plux.today` → 200, `https://` → 403, JSON → 200. Dev never runs the check → invisible locally. Same mismatch
as the old "login builds an http:// callback" trap.
FIX: `store/member.ts signOut(returnTo = returnHereUrl(), navigate)` → `POST /api/signout` (JSON, `credentials: same-origin`) →
`{ logoutUrl }` → `window.location.assign(logoutUrl)`. The route (`pages/api/signout.ts`): `auth.getContextualAuth<IOAuthStrategy>()`
from `@wix/essentials` (it re-exports `@wix/sdk-runtime/context` — NO new dependency) `.logout(postFlowUrl)`, postFlowUrl =
`/api/auth/logout-callback?returnTo=<relative>` on the browser's Origin when its host is ours (else the adapter's), 502 on failure.
The chain (`/_api/iam/authentication/v1/logout` → `/api/auth/logout-callback` → returnTo) is SAME-ORIGIN on prod (probed hop by hop
with a minted member cookie) and cross-origin in dev (the IAM hop is on plux.today) — which is why a plain `fetch` of the managed
route with `redirect: follow` would have been prod-only; the top-level navigation works in both. Both shells: buttons with
busy / retry states; `.m-menu__form` + `.mb-form` deleted. Fence: `test/components/signOut.test.ts` (no `<form method=post>` in
the shells, both call `signOut()`, route hygiene).

## Verification
`scripts/verify-mobile-fixes-2026-09-18.mjs [port] [shots]` — 5 legs on the house Chrome; `FTW_APP_URL=https://www.plux.today` is
the LIVE twin. Every wait is a DOM signal (the `window.__*` seams are DEV-ONLY — a live run against them times out): ◎ SAVE renders
only once fpvHud + camGeo are live, ▤ PLACES / the SAVED PLACES pill only once the member resolved, the nav chip leaves its 1,100 km
seed on the first pose sync, the cookie role via CDP `Network.getCookies`. The member cookie is minted the verify-places-member way
and seeded via CDP `Network.setCookie` (a `document.cookie` write cannot replace a server-set cookie of the same name; the managed
cookie is Secure + SameSite=None). Dev: ALL PASS. LIVE: **ALL PASS (39)** — boot `18000 KM` on the 2D map · both rails (no overlaps,
seat `calc(16.4rem + 52px)`) · /m menu SIGN OUT → `/m#p=…` with VISITOR tokens, SIGN IN offered, no "Cross-site" page · desktop
badge the same. TRAPS: the desktop welcome hero owns the pointer — click (800,500) first; the live desktop nav can float a tip /
the expanded search bar over the badge (run 1 lost the leg; the harness now names the element under the click and falls back to a
DOM click loudly); `store/member.refresh()` turns ANY `getCurrentMember` rejection into "anonymous" (1 run in 5 showed SIGN IN on a
valid member cookie — the harness reloads once, loudly). Shots: `verify-shots/mobile-fixes-2026-09-18/` (+ `live/`).
Gates: vitest 3,153 / 212 · astro 0/0/12 · knip 0. Pixel sweep not run by reasoning: no catalogue pose reaches the bare-`/m`-boot
altitude (all carry hashes); the desktop is byte-identical by construction.

## Shipped + released
Ship hook in the foreground → `b3270cd` (PR #127), package 1.36.14; `release:full` run 1: "Site published", canary GET/POST 200,
warm 168/0/0, `verify-prod-globe` gl=true (`verify-shots/release-20260918-031035.jpeg`). Live twin ALL PASS after the release.

Related: [[project/wip-2026-09-16-mobile-uxbatch-menu-pinch-scale]] [[project/wip-2026-09-16-audit4-triage-fixes]] [[patterns/members-pins]]
