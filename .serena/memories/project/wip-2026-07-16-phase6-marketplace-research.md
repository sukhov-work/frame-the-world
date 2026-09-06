# mem:project/wip-2026-07-16-phase6-marketplace-research — Phase 6 marketplace-light (SHIPPED + VERIFIED) (compacted 2026-09-06 from 14,107 B; verbatim history: DECISIONS_ARCHIVE.md §Moved 2026-08-15)

## SHIPPED 2026-07-16 (browser/runtime-VERIFIED; gates vitest 587 · astro 0/0 · wix build Complete)
Phase 6 marketplace-light is BUILT on Catalog V3 (owner chose V1 but the site is V3 — forced). Files:
`lib/market/listing.ts` (pure: buildDigitalProduct·normalizePrice·parseListBody·formatPrice·STORES_APP_ID·PinListing) ·
`lib/wix/photosData.ts` (ownedPhoto·deleteListingProduct, shared) · `pages/api/listings.ts` (POST list · DELETE unlist ·
GET sales) · `store/market.ts` (listForSale·unlist·buy) · UI in `PhotoDetailPanel.tsx` (MarketSection) + `MyPins.tsx` (price chip)
+ `styles/photo-detail.css`/`my-pins.css` (.pd-market/.mp-badge--sale). Threaded productId/variantId/priceAmount/currency
through Photos+PublicPins schema, pinRecords (publicPinRecord listing arg — photoRecord does NOT touch listing so PATCH
preserves it), photos.ts (PATCH preserves/tears-down listing, DELETE deletes product), store/pins PublicPin, store/upload
SavedPinView+listing. Installed `@wix/ecom@1.0.2266` + `@wix/stores@1.0.830` (+@wix/redirects present). `__marketStore` dev seam.

## RUNTIME VERIFICATION (`scripts/verify-listing-member.mjs`, wix dev + Phase-5 test member — ALL PASS)
member lists their 1 public pin → POST /api/listings 200 {productId, productVariantId, priceAmount 7.5, currency null} ·
GET /api/listings shows it · **checkout resolves the DIGITAL line item @ €7.50** (catalogReference {appId 215238eb-…,
catalogItemId=productId, options:{variantId}}) · DELETE /api/listings 200 · gone after. Also visitor→/api/listings all
methods 401 SIGNED_OUT (gate works). PRODUCTION REST earlier: V3 create digital product 200 + secure media attached.

## KEY CORRECTNESS FIX (verified against live gateway): V3 checkout NEEDS options.variantId
`catalogReference:{appId, catalogItemId:productId}` ALONE → checkout with **lineItems: 0** (silently empty). WITH
`options:{variantId}` → lineItems:1, price resolves, itemType.preset DIGITAL. So productVariantId is denormalized onto
PublicPins + threaded to the client BUY. catalogItemId MUST be the productId (variantId-as-catalogItemId → 0 items too).

## REMAINING (Wix-native, needs a real purchase — NOT code): pay → deliver
The buy REDIRECTS to the Wix-hosted checkout; on manual-payment PAID the preinstalled Stores automation emails the
30-day link, and the owner marks paid + pays out in the Wix DASHBOARD. Verified from ecom source + Help Center; the actual
purchase+delivery email is the owner's manual E2E (place order → mark paid → confirm buyer email). Minor tail: currency is
null on the pin badge (createProduct doesn't echo it; store currency is EUR — checkout shows it correctly).

# UI TAILS (2026-07-17 correctness review — missing, none block Phase 7; full list in NEXT_SESSION_PROMPT §Phase 6 UI tails)
- **No sales UI**: GET /api/listings (+soldCount) has ZERO client consumers → natural home = MY PINS third tab (PINS·PLACES·SALES).
- **No buyer discovery**: no for-sale marker on globe pins or PinHoverCard (title·author·date only); the store/market.ts
  header comment CLAIMS a buyer-facing globe marker — it does not exist. Cheap fix = hover-card price chip (panels-fenced).
- **Currency badge misleading**: currency null everywhere (createProduct doesn't echo it; store = EUR) + MyPins.tsx:233
  hardcodes a `$` prefix → "$7.50" on a EUR store. Fix: resolve site currency server-side at listing time (or const EUR), drop `$`.
- SIGN IN TO BUY → loginUrl("/") loses the viewed pin (pass the #p= share URL) · no post-checkout acknowledgment
  (postFlowUrl = same URL, BUY still shows; email-only per design — optional ?purchased=1 toast) · UNLIST is single-click
  (row delete uses arm/SURE?) · buyer BUY button itself never clicked in a real browser (checkout resolution gateway-verified).
- Data-threading verified CORRECT: globe click spreads the full PublicPin incl. productId/productVariantId/priceAmount/currency
  (StylizedTiles.ts:638 → upload.ts openSavedPin listing seed); /api/photos rowListing feeds MyPins.
- STATE 2026-07-17: gates re-run green (vitest 587 · astro 0/0) · **prod SERVES Phase 6** (live /api/listings → 401 SIGNED_OUT;
  the working-tree outage-recovery release carried it) · **code still UNCOMMITTED on master** (HEAD = PR #20) → commit/PR first.
  Chunk-500 outage owner-confirmed RESOLVED for now — warm-prod-assets.mjs ritual stands ([[project/wip-2026-07-16-prod-asset-outage]]).

# Research notes (provenance) — the Wix API facts that are NOT re-derivable from the code

Probed against the LIVE Wix gateway with a site token (`npx @wix/cli@latest token --site <SITE_ID>`).

## PIVOTAL: the site is CATALOG V3, not V1 — this SUPERSEDES the owner's "use catalog V1" ask
`POST /stores/v1/products/query` → **HTTP 428 `CATALOG_V3_CALLING_CATALOG_V1_API`**. V1 is IMPOSSIBLE
on this site. V3 is also strictly better here: V1's only digital-file-attach method
(`CatalogWriteApi.CreateDigitalProduct`) is `exposure=INTERNAL`, so a headless `elevate()` app could
not create V1 digital products at all. V3 can.

## Creating a digital product with secured media (app token, verified 200)
```json
{"product":{"name":"...","productType":"DIGITAL",
  "variantsInfo":{"variants":[{"price":{"actualPrice":{"amount":"5.00"}},
    "digitalProperties":{"digitalFile":{"id":"<wixMediaFileId>"}}}]}}}
```
Response carries `product.id`, `variantsInfo.variants[0].id` (the variantId), and a
`digitalProperties.digitalFile` whose `fileType` Wix auto-classifies (e.g. `SECURE_PICTURE`).
**The retained ORIGINAL is already a private Wix Media file** (`Photos.originalFileId`, uploaded
`private:true` via TUS), so attach it directly — no re-upload. Cleanup is
`DELETE /stores/v3/products/{id}` plus `POST /site-media/v1/bulk/files/delete`.
**SDK vs REST field trap:** in `@wix/stores` the field is `digitalFile._id`, not `id`, and the
returned ids are `created._id` / `created.variantsInfo.variants[0]._id`.

## BUY flow (client-side, buyer identity, NO elevate)
`catalogReference` for a Wix Stores product is
`{ catalogItemId: <productId>, appId: "215238eb-22a5-4c36-9e7b-e7c08025e04e", options: { variantId } }`
— that appId is the FIXED Wix-Stores catalog appId, **not** the TPA appId `1380b703-…`. Then
`checkout.createCheckout({ lineItems, channelType: "WEB" })` →
`redirects.createRedirectSession({ ecomCheckout: { checkoutId }, callbacks: { postFlowUrl } })` →
`window.location.href = redirectSession.fullUrl`.

## ORDERS visibility (elevate, ECOM.READ_ORDERS)
`orders.searchOrders({ filter, cursorPaging?, sort? })` and `getOrder(_id)` — **`queryOrders` is NOT
exported.** Owner sales filter on `paymentStatus:'PAID'` plus the catalog appId; buyer purchases
filter on `buyerInfo.memberId`, which must be pinned to `getCurrentMember()._id` server-side and
never taken from the client.

## DELIVERY automation + manual payments
On `paymentStatus → PAID` for a DIGITAL line item, the eCom order-notifications service generates the
30-day Media-Manager download link and emails the buyer. The product-side requirement is exactly that
the line item is digital, which the DIGITAL product + attached secure media above satisfies. With a
MANUAL/offline payment method the lifecycle is: completed checkout → order APPROVED with
`paymentStatus NOT_PAID`; the owner marks PAID in the Wix DASHBOARD (no code path — `MarkOrderAsPaid`
is `exposure=PRIVATE`), which sends a SECOND "payment received" email carrying the link. **The link
is 30 days and not shortenable**; resend from the dashboard.

Related: `mem:patterns/members-pins` · `mem:project/wix-platform` · DECISIONS 2026-07-16 ·
IMPLEMENTATION_PLAN §Phase 6.
