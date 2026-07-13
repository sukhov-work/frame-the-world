# mem:bugs/gallery-thumbnail-stale — why the Headless-Day gallery shows no nice preview

**Symptom (2026-07-13):** The internal Wix "Headless Day" gallery
(`manage.wix.com/headless-builder-funnel/headless-day/gallery`, search "yevhen sukhov") shows the
**Frame the World** card with a pink/purple gradient + tiny text **"WIX ▲ astro — To get started, open the
`src/pages` directory in your project."** = the DEFAULT Wix+Astro STARTER page, not the globe app.

## Root cause (browser + Slack + code evidence — HIGH confidence)
1. **Preview mechanism = Wix `site-snapshotter-web`, keyed by msid (siteId).** The gallery card's big image
   `src` = `https://wix.com/site-thumbnail/{siteId}?preset=site-list` → 302 →
   `img-wixmp-…wixmp.com/images/site-snapshotter-web/{snapshotGuid}/v1/fit/w_370,h_370/file.jpg`. It is a
   **stored/cached server screenshot** (fixed GUID), NOT OG tags, NOT builder-uploaded. The `my-submission`
   form has **no preview-image upload** (fields: name/URL/siteId/GitHub/solutions only). Organizer @tuvitk
   (Slack #headless-day-26, ts 1783606563): *"it's supposed to update automatically if you submitted the
   correct msid."* Our submitted Site ID `f597bcf5-bd38-4941-9dfe-e16d775743a3` IS correct (Open link works).
2. **The stored snapshot is STALE** — captured ~provisioning (2026-07-09) when the site still served the
   Astro starter, BEFORE the first `wix release` (2026-07-10). Auto-update is effectively one-time / very
   infrequent and did not re-capture the deployed app.
3. **Compounding: the homepage is un-screenshottable server-side.** Everything visible is `client:only`
   (C4 — globe never SSR'd; `src/pages/index.astro` renders only `<header>` nav + attribution in SSR HTML;
   all islands are `client:only="react"`). A server snapshotter that doesn't run WebGL / doesn't wait
   seconds for WASM+Cesium tiles+textures captures a near-blank dark page. The starter captured fine ONLY
   because its `index.astro` hero was static SSR HTML. So even a fresh re-capture of today's site would
   likely look poor.

## Separately: social/link previews are also broken (OG gap)
Deployed `<head>` (curl): Wix injects `wix-seo-tag` `og:title`/`og:url`/`og:site_name`/`og:type` +
`twitter:card=summary_large_image` — but **NO `og:image`, `og:description`, `twitter:image`**.
`src/layouts/Layout.astro` head has none either. `summary_large_image` with no image = empty Slack/Twitter
card. NOTE: OG tags do NOT feed the gallery (snapshotter only) — fixing OG helps Slack/social, not the card.

## Fix (designed, NOT yet implemented)
- **Gallery (durable):** add a server-rendered branded **loading poster** to `index.astro` (curated
  `docs/media/globe-leo.jpeg` or `welcome.jpeg` + wordmark/tagline) that paints instantly in SSR HTML and
  persists until the globe signals ready → any snapshotter capture (any wait level) looks great, AND it
  replaces today's black-while-loading void (UX win). Fenced to panels/ui/styles + index.astro (globe/lib
  untouched). Assets already exist in `docs/media/` (5 JPEGs) → copy one to `public/` for serving.
- **Trigger re-capture:** re-save the submission (correct msid) and/or ping **@tuvitk** in
  `#headless-day-26` to regenerate; the funnel offers no self-serve refresh.
- **Social (bonus):** add `og:image`/`og:description`/`twitter:image` in Layout.astro head (or via Wix
  dashboard SEO settings, which drive the `wix-seo-tag` injections). UNVERIFIED whether an author og:image
  in the Astro head survives Wix's SEO layer — verify by curl-ing the deployed head after release.

## Verify shots
`verify-shots/gallery-01-initial.jpeg` (gallery grid; note gradient-placeholder cards = failed snapshots),
`gallery-02-yevhen-card.jpeg` (our stale starter thumbnail), `gallery-03-stored-thumbnail.png` (raw
site-snapshotter JPG). Related: `mem:project/wix-site` (msid/live URL), `mem:core` (C4 client:only).

## Fix — IMPLEMENTED 2026-07-13 (browser-verified in `wix dev`; ships on the next `wix release`)
- **SSR boot poster** (`src/pages/index.astro` `#boot-poster` + `src/styles/boot-poster.css`): the ONLY
  server-rendered visual — a full-bleed splash (clean globe cover + accent eyebrow "EVERY PHOTOGRAPH HAS
  COORDINATES" + Space Grotesk title "See your photographs where the world took them." + sub + "BUILDING
  THE GLOBE" loader) that paints in the SSR HTML, so a screenshot/OG crawler always captures the brand, not
  a black canvas. Copy + 7.5vw anchor mirror `panels/Welcome.tsx` → seamless hand-off when Welcome hydrates.
  Inline `is:inline` dismiss script removes it on first interaction / a `window` `globe:ready` event (future
  hook, never fired yet) / a 3.8 s safety timer (reduced-motion 1.2 s); min-visible 350 ms; SKIPPED on a
  `#p=` pose hash (matches Welcome). **A JS-less / WebGL-less snapshotter fires none of those → keeps the
  poster** (the whole point). z-index 200 (above app max 60; the only thing over it is `<astro-dev-toolbar>`
  z 999999 which is DEV-ONLY — absent in production).
- **Cover image** `public/social-cover.jpg` (1600×800) = a chrome-free LEO limb hero captured from the live
  globe via Playwright (dev `window.__cameraStore.setExplore(false)` to hold framing, all positioned overlays
  hidden, clipped above the dev toolbar). NOT `docs/media/globe-leo.jpeg` — that one has the app UI baked in.
- **Social/OG meta** (`src/layouts/Layout.astro` head): added `meta name=description`, `og:description`,
  `og:image` (+ width 1600/height 800/alt), `twitter:description`, `twitter:image` — all ABSOLUTE via
  `SITE_URL`. Did NOT add og:title/twitter:title (Wix injects those; duplicating fights its SEO layer).
  Fixes Slack/link cards; does NOT touch the gallery card (snapshotter only).
- **Gates:** astro check 0/0 · vitest 416 · SSR HTML curl shows poster + all og tags · poster renders +
  auto-dismisses in `wix dev` (verify-shots/poster-02..04, poster is the Welcome precursor). Design-fenced:
  only `pages/index.astro` + `layouts/Layout.astro` + `styles/boot-poster.css` + `public/` — globe/lib untouched.
- **RESOLVED — production-VERIFIED 2026-07-13 (owner-confirmed "worked, preview updated"):** after `wix
  release` + a snapshot re-capture (re-save submission / @tuvitk), the gallery card refreshed from the stale
  starter page to the new SSR poster/globe. Confirms the whole chain: snapshotter DOES re-capture on
  demand, and the SSR poster is what it grabs (the client:only homepage alone would still be blank). The
  historical steps this required were: (1) `wix release` — the live URL had served the stale
  Phase-5 build, so `/social-cover.jpg` 404s until then; (2) trigger a snapshot RE-CAPTURE (re-save the
  submission with the correct msid, and/or ping @tuvitk in #headless-day-26 — no self-serve refresh exists);
  (3) verify the OG survives Wix's SEO layer by curl-ing the live head for `og:image` after release.
