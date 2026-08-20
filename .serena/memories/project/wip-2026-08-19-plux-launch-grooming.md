# wip 2026-08-19d — PLUX launch grooming (brand + domain + guide refresh + guide search)

Final grooming before the first major release. Twin: DECISIONS 2026-08-19d. Four tracks in one
session, three cited research agents (repo domain-coupling scan · guide gap analysis · Wix/GoDaddy
web research).

## 1. BRAND = PLUX (owner order; supersedes "Sidera" working title 2026-08-14)

- Masters: `public/logo/PLUX_MASTER_LOGO.png` (1994×857) + `PLUX_FAVICON.png` (266×283, non-square).
  Derived with ImageMagick: `logo/plux-wordmark.webp` (trim → 1200×489, cwebp q88, 36 KB) ·
  `logo/plux-mark.png` (trim → square-pad 300 → 96px) · `public/favicon.png` (48px) ·
  `public/apple-touch-icon.png` (180px, flattened on `#05070b` — iOS renders transparency black).
  `favicon.svg` DELETED; all three heads (Layout/MobileLayout/guide.astro) now link favicon.png +
  apple-touch-icon.
- Hero: `Welcome.tsx` headline replaced by the wordmark img inside the h1 (alt carries the a11y
  name); `.wl-logo` width `clamp(16rem, 34vw, 29rem)` (welcome.css — old .wl-title font rules gone).
- Nav: index.astro logo anchor = 18px mark + "Plux" (`.logo-mark`, flex on `a.logo`); `/guide`
  `.g-brand__mark` same; /m `.m-title__mark` 14px; UploadFlow bordered-dot mark REPLACED by the
  mark img + "PLUX" (`.uf-brand__logo`; `__mark`/`__dot` CSS removed).
- Renames: page titles (Plux · Plux — Mobile · Plux — Guide), og:image:alt, guide tip "HOW PLUX
  WORKS", ICS export summaries "(Plux)" ×5 files, guideContent ×5, README header + section.
  Grep-clean: no `Sidera` left in src/ except one historical comment in Layout.astro.

## 2. DOMAIN plux.today — measured state + what breaks (owner answer in final report)

- **Live measurements (2026-08-19 ~13:00 UTC):** `.today` registry delegates to BOTH GoDaddy
  ns31/ns32.domaincontrol.com AND ns8/ns9.wixdns.net (owner added NS *records* in GoDaddy's DNS
  editor — the registrar-level replacement never happened; the correct GoDaddy screen is
  Nameservers → Change → "I'll use my own nameservers"). Wix ALREADY attached plux.today to our
  site (`x-meta-site-id` header = f597bcf5…) and primary-flipped: **the old wix-site-host URL 301s
  site-wide to https://www.plux.today, whose TLS handshake FAILS (no cert yet)** → prod is
  effectively dark until the NS fix completes and Wix issues SSL. `https://plux.today` (apex)
  301s to www fine. Wix zone still serves `www → initial.wixdns.net` (pre-connection placeholder).
- **Repo coupling (agent-verified, file:line-cited):** R2 worker CORS = `*` (unaffected) · R2 base
  URLs = env `PUBLIC_ENRICHED_TILES_URL`/`PUBLIC_TERRAIN_TILES_URL` on workers.dev (unaffected) ·
  auth/checkout redirects all relative or `window.location.origin`-derived (correct by
  construction) · release binds by siteId (unaffected) · NO astro `site:`/sitemap/manifest/SW.
  **The one hard dashboard break: the headless OAuth app allowlist** (Settings → Headless
  Settings → client → URLs) must gain `https://www.plux.today` (+ apex) or login/plan-upgrade/
  checkout-return fail with "Invalid redirect URI".
- **Origin-change facts:** localStorage is per-origin — 6 `ftw:*` keys reset (view-prefs,
  bldg-overrides ARE lost — localStorage-only until the U8 sync phase runs; simbad/sbdb caches,
  prefer-desktop, m-banner). `wixSession` cookie host-scoped → everyone logs in once more.
- **Repo changes:** `Layout.astro` SITE_URL → `https://www.plux.today` (og:image; old origin 301s
  anyway) · 7 scripts (warm-prod-assets, verify-prod-globe, seed-demo-pins, verify-{places-member,
  plan-upgrade,listing-member,phase69}) default to www.plux.today + `FTW_SITE_URL` env override.
- `social-cover.jpg` still pre-Plux imagery — regenerate at leisure (tail).

## 3. GUIDE G2-refresh (all shipped work since G1 2026-08-15e)

- 16 stale topics corrected + 7 NEW (`fpv-map` · `fpv-height` · `target-radar` ·
  `target-unfollow` · `plan-meteors` · `save-onmap` · `mobile-map`) + 3 new GUIDE_GOALS rows
  (meteor night / sun travel / building fix). All labels verbatim from code (gap-analysis agent
  cited file:line for every claim); slop-lint + crosslink tests green unchanged.
- `shell-m.webp` re-shot: the 2D-first chart with radar bearings + LAYERS/3D chips + day steppers
  (360×783 cwebp q82, 15 KB; caption updated). **Shots still stale (TAIL for a warm-cache
  session): orbit/fpv (2×4 deck), plan (+METEORS card), skymenu (DISABLE labels + ∠ row),
  target (UNFOLLOW), fpv-m (goto chips).** Dev-local Esri drape stayed cold >60 s this session —
  don't retry re-shoots against a cold dev stream; use the owner's warm Chrome or prod.

## 4. GUIDE search (BM25 + fuzzy, embedded)

- `src/lib/guide/search.ts`: every topic+chapter = one BM25 doc (k1 1.4 · b 0.6; field weights
  title 3.5 / where 2 / tip 1.5 / steps·body 1 / chapter-title-on-topics 0.5); GUIDE_GOALS
  phrases fold onto their target doc (+1.5) so user-phrasing queries land. Query tokens expand
  against the vocabulary exact → prefix (w 0.6+0.35·len-ratio) → Damerau-Levenshtein ≤1 (≥4 ch) /
  ≤2 (≥7 ch) — REUSES `normalizeSky`+`editDistance` from `lib/sky/searchIndex` (one edit-distance
  impl in the codebase). Per (token,doc) only the best expansion counts (moon vs moonlight no
  double-count); final score × (0.4 + 0.6·coverage) so multi-word queries prefer covering docs.
  ~90-char snippets centred on the first matched term; crosslink markup stripped at index time.
- UI: desktop rail input `.gd-search` (query swaps chapter rail for `.gd-hit` rows: title +
  chapter breadcrumb + snippet; Esc clears query BEFORE the panel-close listener via
  stopPropagation) · /m GuideSheet index-view input `.m-gsearch` + `.m-ghit` rows. The zero-JS
  /guide page deliberately has NO search.
- Tests `test/lib/guide/guideSearch.test.ts` (11): every topic findable by own title ·
  distinctive-query rank-first · typo ladder ("metors"/"buliding height"/"unfolow") · prefix
  while typing · coverage ("save view name" → save-place) · goal-phrase fold · empty/garbage →
  [] · limit+uniqueness · breadcrumb+snippet · no `[[` leakage · doc-count completeness.

## Verification

vitest **1,073/1,073** (+11) · astro check 0 err/5 hints · CDP-verified: landing (wordmark hero +
nav mark, shot plux-01), desktop guide search "metor shwoer"→METEORS №1 + click-through to PLAN
chapter w/ scroll (plux-02), /m Plux strip + "unfolow"→UNFOLLOW + drill-in (plux-03), /guide
standalone renders all 7 new topics + brand. favicon/apple-touch/wordmark all fetch 200.

## Traps (new this session)

- **Hash-only page.goto is a SAME-DOCUMENT navigation** — the app keeps its camera; go
  `about:blank` first to force a real boot at a `#p=`/`#f=` pose (re-confirmed the g1 lesson).
- **DECISIONS append via Edit: old_string = the previous entry's full bold prefix** — replacing
  just the prefix swallows it (had to restore 19c's header line; caught by grep -c).
- Dev-local Esri imagery can stay cold for minutes on a fresh `wix dev` — guide-quality shots
  need the owner's warm cache or prod; the /m dark-chart style is imagery-independent and safe.

## Open tails

Owner: GoDaddy NS replacement + Wix domain verify + OAuth allowlist rows (release gate!).
Then: `wix release` (the standing canary + first Plux-branded prod) → re-run warm-prod-assets
(new default = www.plux.today). Stale guide shots (above). social-cover.jpg regen. Owner taste
pass: hero logo size, nav/strip mark sizes, search placement.
