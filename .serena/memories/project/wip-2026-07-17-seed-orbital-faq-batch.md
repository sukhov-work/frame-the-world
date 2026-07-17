# mem:project/wip-2026-07-17-seed-orbital-faq-batch — stock fix · 27-pin seed · orbital pass · FAQ (SHIPPED)

## SHIPPED 2026-07-17 (gates vitest 594/594 · astro 0/0 · wix build Complete; all browser/wix-cloud-VERIFIED)

### 1. OUT-OF-STOCK fix (owner hit it buying the €7.50 test product)
- **Root cause:** Catalog-V3 `productsV3.createProduct` defaults every variant to tracked-quantity-0
  → checkout blocks OUT OF STOCK. **Fix:** `createProductWithInventory` + per-variant
  `inventoryItem: { inStock: true }` — the V3 "tracked by status" method = sellable with NO
  quantity limit. Typings: `InventoryItemComposite.inStock` in
  `@wix/auto_sdk_stores_products-v-3` universal d.mts (~line 7022); plain createProduct IGNORES
  the field.
- Product creation extracted to `createListingProduct(name, price, fileId)` in
  `src/lib/wix/photosData.ts` — shared by `/api/listings` POST and `/api/dev-seed`.
- Live verify: relisted 'gps-heading' → inventory REST search (`/stores/v3/inventory-items/search`
  filter productId) shows `inStock:true trackQuantity:false availabilityStatus:IN_STOCK`; ecom
  REST `POST /ecom/v1/checkouts` line item `availability.status:"AVAILABLE"` @ 7.5 EUR.
- Admin REST recipe: `npx @wix/cli@latest token --site <siteId>` → Bearer on www.wixapis.com
  (provision-collections idiom).

### 2. Demo seed — 27/27 listed pins owned by yevhens@wix.com
- **yevhens@wix.com IS a site member** (id `166a86fa-b1da-4ad4-8ae0-25f7033a833a`) but was created
  via GOOGLE sign-in → password login impossible for scripts. Members REST query by `loginEmail`
  confirms.
- **DEV-only route `POST/GET /api/dev-seed`** (`src/pages/api/dev-seed.ts`): gated
  `import.meta.env.DEV` (404 in prod builds). POST = elevated insert with explicit
  `ownerMemberId` (member looked up by email via `members.queryMembers({fieldsets:["FULL"]})
  .eq("loginEmail",…)`) reusing `photoRecord`/`publicPinRecord`/`authorLabel` (C6 structural) +
  optional listing. GET = existing titles → idempotent re-runs. NEVER relax the DEV gate.
- **`scripts/seed-demo-pins.mjs`** (Node ≥22): serial downloads, UA
  "FrameTheWorldDemoSeed/1.0…" (Wikimedia 429s bare clients) → cache `.seed-cache/`
  (git-ignored) → preview ≤2048px via macOS **sips** (`sips -s format jpeg -s formatOptions 80
  -Z 2048`; NO sharp in repo; sips CANNOT write webp) → dims via `sips -g pixelWidth/Height` →
  preview single-PUT + original TUS (tus-js-client takes a Buffer in Node) as the TEST member
  (`frame-p5-tester@…` — media is app-owned, upload-url just needs any member) → dev-seed with
  prices cycling 5/7.5/10/12.5/15.
- Result 27 OK / 0 fail (Uyuni 20.8 MB · GP Milky Way 16.6 · White Sands 14.2 over TUS).
  `/api/market` = 28 rows. Browser: both hemispheres render the set; MARKETPLACE "FOR SALE · 28";
  row click → flight → buyer panel w/ frustum (shots `verify-shots/seed-0[1-4]*.jpeg`).
- `Special:FilePath/<Commons page name>` → redirects to the raw file URL (used for the 2 Deadvlei
  pad frames; both eyeball-verified correct).
- `DEMO_CONTENT_SEED.md` → `.claude/claude-docs/archive/` (checkboxes ticked).

### 3. Orbital-grade pass (the 3 parked tunables — poster parity)
- **Halo:** `ATMOSPHERE.orbitStartAlt` 2.5e6→**400e3**, `orbitSpanAlt` 6.5e6→**3.6e6** — uOrbit
  ~0.2 at the default LEO (used to be 0 — never engaged), fully thin ~4,000 km.
- **Stars day-fade in orbit:** `stars.ts` update — new `dayK` over sin(sun elev at camera)
  (`STARS.dayDimStartSin 0 → dayDimFullSin 0.35`); star fade floor `dayDimFloor 0.25`, Milky Way
  `mwDayFloor 0` (mw/haze materials get `fade·fovK·mwDayK`). dayK=0 when the sun is down at the
  camera → night-side + low-altitude night paths byte-identical.
- **Earth day/orbit grade ramp:** `EARTH.orbitGrade {altLo 500e3, altHi 2e6, organic .72, sat .62,
  gain .50}`; baseEarth gains uniforms `uOrganicOrbit/uSatOrbit/uGainOrbit/uOrbitGrade`, shader
  mixes each knob toward its orbit twin; driver = `earth.uniforms.uOrbitGrade =
  smoothstep(alt, altLo, altHi)` in `stepGraticuleAndAtmosphere` (StylizedTiles). All six
  endpoints runtime-tunable on `__globe.earthUniforms`.
- Verified: `orbital-01-leo-dusk-after.jpeg` (dusk LEO poster framing) ·
  `orbital-02-dayside-stars-dimmed` (day side = star-free space, richer disc) ·
  `orbital-03-nightside-stars-full` (night unchanged: full stars/MW/city lights).
- **Dusk staging = shot-craft, not code:** boot any staged view via `#p=<lat,lon,alt,rot,decl>&t=<ms>`
  — setting `location.hash` alone is a SAME-DOCUMENT nav (the boot reader doesn't re-run);
  `location.reload()` after. Default boot POV was NOT changed (owner's signature scene).

### 4. FAQ panel (owner ask)
- `panels/Faq.tsx` (16th `client:only` island, nav FAQ button; Marketplace idiom: DragGrip
  `usePanelDrag("faq")`, Esc, open-gated body, inner `.fq-scroll`) + `panels/faqContent.ts`
  (data file, 7 sections) + `styles/faq.css` (`fq-*`; docks top:64/right:24).
- Accordion (one section open; first open by default); images lazy per open section.
- 6 shots: 720px webp via **cwebp** (`/opt/homebrew/bin/cwebp -q 78 -resize 720 0`), 11–23 KB,
  under `public/faq/{upload,nudge,time,fpv,pins,market}.webp`; privacy section text-only.
  Sources kept in `verify-shots/faq-*.jpeg`. Added to `warm-prod-assets.mjs` seed list.
- Verified: `faq-01-panel-open.jpeg` · `faq-02-time-section.jpeg`.

## TRAPS (new)
- **Vite dep cache goes stale across wix-dev restarts** → EVERY chunk 504 "Outdated Optimize Dep"
  and islands fail to hydrate; reloads don't heal it. Fix: move/delete `node_modules/.vite`,
  restart wix dev. (`rm -rf` may be permission-blocked — `mv` to /tmp works.)
- Playwright MCP screenshots: relative `filename` resolves from the REPO ROOT (allowed roots =
  repo + `.playwright-mcp`); `verify-shots/x.jpeg` is correct, `../verify-shots` escapes the root.
- The upload-flow file input opens via the "Browse files" button → browser_file_upload with the
  chooser modal.
- Wikimedia originals can carry REAL EXIF (Moeraki = FUJIFILM X-Pro1 35mm f/16 2013) — the upload
  FAQ shot shows genuine metadata.

## Owner follow-ups (unchanged/remaining)
- Real purchase loop (buy → mark paid in dashboard → 30-day-link email) — now UNBLOCKED by the
  stock fix; any of the 28 listings works.
- Plan rename ("Community Monthly Membership (Premium" template leftover).
- Skim the 27 demo pins in MY PINS / marketplace — delete any that don't land; retune prices in UI.
- Orbital grade fine-tune to taste via `__globe.earthUniforms` (six endpoints live).

Related: [[project/wip-2026-07-17-phase69-marketplace-batch]] ·
[[project/wip-2026-07-17-demo-seed-curation]] · DECISIONS 2026-07-17 STOCK+SEED+ORBITAL+FAQ line.
