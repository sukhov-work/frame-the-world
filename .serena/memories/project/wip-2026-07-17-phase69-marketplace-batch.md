# mem:project/wip-2026-07-17-phase69-marketplace-batch — Phase 6.9 (SHIPPED + browser-VERIFIED)

## SHIPPED 2026-07-17 (gates vitest 593/593 · astro 0/0 · wix build Complete)
The five owner rulings from `mem:project/wip-2026-07-16-phase6-marketplace-research` §UI TAILS + the
2026-07-17 rulings line, all landed. Verified end-to-end by `scripts/verify-phase69.mjs`
(member-auth API tier + scripted-Chrome CDP tier; shots `verify-shots/phase69-0[1-5]*.jpeg`).

### Files / seams
- **Quota 100/1000**: `lib/wix/pinRecords.ts` `PIN_QUOTA_FREE=100` + `PIN_QUOTA_PREMIUM=1000`;
  `pages/api/photos.ts` POST = two-tier wall (plan lookup ONLY after the free wall so the common
  save path stays one count query; 402 body carries `premium: boolean` + tier message).
- **Currency**: `lib/market/listing.ts` `SITE_CURRENCY="EUR"` (research-verified: NO installed SDK
  exposes site currency — productsV3 never echoes it; @wix/ecom ecommerce-settings BUSINESS_INFO is
  `{}` in public typings, internal-only fields; Checkout.currency exists only at buy time).
  `pages/api/listings.ts` stamps it at create + EUR-falls-back on GET rows (pre-fix rows stored null).
  `formatPrice` symbol-prefixes EUR/USD/GBP/UAH ("€7.50"), ISO-suffixes others; `MyPins.tsx` `$` literal dropped.
- **SALES tab**: `MyPins.tsx` tab union `"pins"|"places"|"sales"` — first client consumer of
  `GET /api/listings`; display-only rows (`.mp-item--static`, no click) thumb · title · €price · "N SOLD".
- **Hover chip**: `PinHoverCard.tsx` renders `.pinhover__price` ("FOR SALE · €7.50") when
  `pin.productId && pin.priceAmount != null` (PublicPin already carried the fields). `store/market.ts`
  header comment corrected — there is NO globe-mesh for-sale marker.
- **MARKETPLACE panel**: `components/panels/Marketplace.tsx` + `styles/marketplace.css` (mk- prefix,
  my-pins idiom: DragGrip `usePanelDrag("marketplace")`, Esc, inner `.mk-scroll`; panel at
  right:360px, stacks to 24px under 760px). 15th `client:only` island in `index.astro` nav —
  body+fetch gated behind `open` (boot-chunk lesson). Data = new PUBLIC `pages/api/market.ts`:
  elevated `items.query("PublicPins").isNotEmpty("productId")` (builder method verified at
  `@wix/sdk-runtime query-builder.d.ts:39`), local `marketPin()` mapper (pinFromItem twin — do NOT
  import store/pins into a route: zustand + globe tuning). Row click = `openSavedPin({...p, pinId: p.id})`
  — the exact globe-pin-click call; C6-safe (rows are the already-reduced PublicPins).
- **Plan upgrade**: `lib/wix/planUpgrade.ts` — `queryPublicPlans()` → `pickUpgradePlan` (primary else
  first) → `createRedirectSession({ paidPlansCheckout: { planId }, callbacks: { postFlowUrl } })` →
  `fullUrl`. Typings-verified (auto_sdk_redirects index.typings.d.ts:306-318): paid-plans intent needs
  ONLY planId — no pre-created checkout unlike ecom; `preferences.maintainIdentity` defaults true so
  the order lands on the signed-in member. `memberHasActivePlan()` = client twin of photos.ts gate.
  UI: `MemberBadge` UPGRADE chip (`.mb-upgrade`, renders only when member + `hasPlan === false`) +
  UPGRADE button next to the QUOTA_EXCEEDED save error in `PhotoDetailPanel`.
- **returnTo**: `store/member.ts` `returnHereUrl()` = pathname+search+hash. CLICK-TIME computed on all
  three sign-in links (PhotoDetailPanel ×2 + MemberBadge) — see traps. `market.ts buy()` callbacks
  split: `thankYouPageUrl` = current URL + `?purchased=1` (COMPLETED flows only), `postFlowUrl` =
  plain URL (abandoned/interrupted also return there — a purchased param on it would false-toast).
  The toast lives in the Marketplace island (reads the param on mount, strips via replaceState, 12 s).
- **UNLIST** arm/SURE? two-press in PhotoDetailPanel MarketSection (row-delete idiom).

## TRAPS (new, hard-won)
- **Render-time login hrefs are stale**: the `#p=` pose hash is mirrored ~1.6 s AFTER render
  (`StylizedTiles.ts:1852-1911`) — an href built at render says "/". Compute returnTo in onClick.
- **`body.welcome-active` suppresses the hash mirror** (same gate as explore/flight). A harness that
  force-removes the welcome DOM leaves the class on FOREVER → no `#p=` ever. Dismiss with a REAL
  canvas click (Input.dispatchMouseEvent pressed+released).
- **Synthetic `_syncHover` is cleared within ONE frame** by the orchestrator's hover mirror — hover
  verification needs real pointer sweeps until `hoverPin.productId` (an unlisted-pin hit doubles as
  the negative case: chip correctly absent).
- **Headless-Chrome user-data-dir persists cookies across runs** — the member cookie from a prior
  run's B5 makes "signed-out" checks silently member. `Network.clearBrowserCookies` first.
- Verify scripts need **Node ≥22** (global WebSocket); default node here is 20 → use
  `~/.nvm/versions/node/v24.10.0/bin/node`.

## SITE-CONFIG GAP (owner dashboard action, NOT code)
**Pricing Plans app is NOT INSTALLED** on the site — `queryPublicPlans` → `APP_NOT_INSTALLED`
(appId 1522827f-c56c-a5c9-2ac9-00f9e6ae12d3). Until the owner installs it + creates ONE public
premium plan, `startPlanUpgrade` throws "no public plan is configured" (surfaced in the chip tip)
and `hasActivePlan()` correctly reads everyone as free. The verify script's A5 check flips green
once installed.

## UNVERIFIED tails
- `#p=` hash survival through the FULL login / checkout round-trip (verified: the login request
  carries `returnToUrl=%2F%23p%3D…`; the Wix-side redirect chain's fragment handling = smoke on
  first real login. Fallback if stripped: carry as `?p=` and normalize on load).
- Real checkout completion → `?purchased=1` toast (toast verified by direct navigation; the real
  thank-you redirect needs the manual-payment E2E, still the Phase-6 owner step).
- Test listing 'gps-heading' @ €7.50 LEFT ACTIVE (deliberate — the marketplace panel shows it;
  `node scripts/verify-phase69.mjs --cleanup` removes it).

Related: [[project/wip-2026-07-16-phase6-marketplace-research]] · `mem:patterns/members-pins` ·
DECISIONS 2026-07-17 PHASE 6.9 line · NEXT_SESSION_PROMPT (refreshed same day).
