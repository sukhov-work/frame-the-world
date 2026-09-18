# wip 2026-09-18 — THREE /m FIXES + the SIGN-OUT root cause — DONE, shipped + released

Mode: fix (`/frame`), three owner asks, "deploy everything after you fix and test". Records: DECISIONS 2026-09-18 (+ the release
line) · §Traps / Wix (the form-POST trap) · CLAUDE.md gotcha · `conventions/wix-headless.md` §12b · `NEXT_SESSION_PROMPT.md` · `mem:core`.

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
`scripts/verify-mobile-fixes-2026-09-18.mjs [port]` — 5 legs on the house Chrome, ALL PASS: boot mirror 18000 km + chip · anon rail
(seat 16.4rem, gap 4 px) · member rail (five cells one x, EXIT's right edge aligned, NO overlaps, seat `calc(16.4rem + 52px)`, ▤ PLACES
opens the sheet) · /m menu SIGN OUT → anonymous + VISITOR cookie · desktop badge Sign out → same. Member cookie minted the
verify-places-member way. TRAPS: the desktop welcome hero owns the pointer — click (800,500) before the badge; one transient in four
runs (`refresh()` read a rejected `getCurrentMember` on a valid member cookie → the store flips anonymous; pre-existing) — the harness
re-resolves once, loudly. Shots: `verify-shots/mobile-fixes-2026-09-18/`. Gates: vitest 3,153 / 212 · astro 0/0/12 · knip 0.
Pixel sweep not run by reasoning: no catalogue pose reaches the bare-`/m`-boot altitude (all carry hashes).

Related: [[project/wip-2026-09-16-mobile-uxbatch-menu-pinch-scale]] [[project/wip-2026-09-16-audit4-triage-fixes]] [[patterns/members-pins]]
