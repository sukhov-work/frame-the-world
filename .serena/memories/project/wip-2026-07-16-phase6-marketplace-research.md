# mem:project/wip-2026-07-16-phase6-marketplace-research — Phase 6 marketplace-light (SHIPPED + VERIFIED)

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

# (research notes below — kept for provenance)
# Phase 6 marketplace-light API facts (VERIFIED via live REST)

Research + GATE-ZERO empirical probes for Phase 6 (marketplace-light). Site token minted via
`npx @wix/cli@latest token --site f597bcf5-bd38-4941-9dfe-e16d775743a3`. All curl probes below hit the
LIVE Wix gateway with the app token and were confirmed. Full research: workflow `wf_878562eb-d93`.

## PIVOTAL: site is CATALOG V3, not V1 (supersedes the owner's "use catalog V1" ask — FORCED)
- `POST /stores/v1/products/query` → **HTTP 428** `CATALOG_V3_CALLING_CATALOG_V1_API`
  ("Endpoint belongs to CATALOG_V1, but your site is using CATALOG_V3"). V1 is IMPOSSIBLE on this site;
  the installed Stores app (TPA appId 1380b703-ce81-ff05-f115-39571d94dfcd) provisioned V3.
- V3 is strictly BETTER for us: V1's only digital-file-attach method `CatalogWriteApi.CreateDigitalProduct`
  is `exposure=INTERNAL` (not on the public gateway) → a headless elevate() app could NOT create V1 digital
  products. V3 CAN (proved below).

## GATE-ZERO VERIFIED end-to-end (create digital product with secured media, app token)
- `POST https://www.wixapis.com/stores/v3/products` with `{product:{}}` → **HTTP 400 VALIDATION**
  (`name`, `productType`, `variantsInfo` required) ⇒ auth + permission `WIX_STORES.MODIFY_PRODUCTS` PASS,
  create is REACHABLE + PERMITTED programmatically.
- Full create SUCCEEDED (HTTP 200). Working body (camelCase JSON):
  ```json
  {"product":{"name":"...","productType":"DIGITAL",
    "variantsInfo":{"variants":[{"price":{"actualPrice":{"amount":"5.00"}},
      "digitalProperties":{"digitalFile":{"id":"<wixMediaFileId>"}}}]}}}
  ```
  Response: product.id (uuid), variantsInfo.variants[0].id (uuid variantId),
  `digitalProperties.digitalFile = { id, fileName, fileSize, fileType:"SECURE_PICTURE" }` — Wix
  auto-classifies the secure media type from the referenced Media file. `visible:true` by default.
- Media: `POST /site-media/v1/files/generate-upload-url {mimeType,fileName,private:true}` → `{uploadUrl}`;
  `PUT ${uploadUrl}?filename=..` (raw bytes) → `{file:{id,url,private:true,...}}`. The `file.id`
  (e.g. `166a86_..~mv2.jpg`) is what goes in `digitalFile.id`. NOTE: our retained ORIGINAL is already a
  private Wix Media file (`Photos.originalFileId`, uploaded `private:true` via TUS) → attach it directly,
  no re-upload. Cleanup: `DELETE /stores/v3/products/{id}` + `POST /site-media/v1/bulk/files/delete
  {fileIds:[..]}` (both HTTP 200).
- Service (fire-console): `wix.stores.catalog.v3.CatalogApi/CreateProduct` on artifact
  `com.wixpress.stores.catalog.stores-catalog-orchestrator`. Also CreateProductWithInventory,
  BulkCreateProducts. Delete/Update siblings on same REST base `/stores/v3/products/{id}`.

## BUY FLOW (VERIFIED from installed @wix SDK source — client-side, buyer identity, NO elevate)
- catalogReference for a Wix STORES product: `{ catalogItemId: <productId>, appId: "215238eb-22a5-4c36-9e7b-e7c08025e04e" }`
  — the FIXED Wix-Stores catalog appId (NOT the TPA appId 1380b703). Source:
  `node_modules/@wix/auto_sdk_ecom_checkout/build/cjs/index.typings.d.ts:435` (fixed-values doc).
  V3 options shape (variantId?) = confirm at build time via the V3 e-commerce-integration doc; single
  non-variant digital product likely needs no options.
- `checkout.createCheckout({ lineItems:[{ quantity:1, catalogReference }], channelType: ChannelType.WEB })`
  → checkout with `_id`. Then `redirects.createRedirectSession({ ecomCheckout:{ checkoutId }, callbacks:{ postFlowUrl } })`
  → `redirectSession.fullUrl` → `window.location.href = fullUrl`. EXACT pattern in
  `node_modules/@wix/headless-ecom/dist/services/checkout-service.js:11-33`. Packages installed:
  `@wix/auto_sdk_ecom_checkout`, `@wix/redirects`. Umbrella `@wix/ecom` re-exports `checkout`/`currentCart`.

## ORDERS visibility (elevate() — app identity, ECOM.READ_ORDERS)
- `@wix/auto_sdk_ecom_orders` `searchOrders`/`getOrder` (NOT installed yet — add it). Owner sales:
  filter `paymentStatus:'PAID'` (+ `lineItems.catalogReference.appId:'215238eb-..'`). Buyer purchases:
  filter `buyerInfo.memberId` (pin to getCurrentMember()._id server-side, never client-supplied).
- Order.paymentStatus enum: UNSPECIFIED/NOT_PAID/PAID/PARTIALLY_REFUNDED/FULLY_REFUNDED/PENDING/... ;
  Order.status: INITIALIZED/APPROVED/CANCELED/PENDING/REJECTED. BuyerInfo: contactId/email/oneof{visitorId|memberId}.

## DELIVERY automation + manual payments (VERIFIED from ecom monorepo + Wix Help Center)
- On `paymentStatus → PAID` for a DIGITAL line item, the eCom order-notifications service auto-generates the
  30-day Media-Manager download link and emails the buyer. Make-or-break product-side requirement =
  the order line item is digital ⇐ product created DIGITAL + SecuredMedia attached (proved above).
- MANUAL/offline payment lifecycle: completed checkout → order status APPROVED, paymentStatus NOT_PAID;
  owner marks PAID in the Wix DASHBOARD (no code; MarkOrderAsPaid RPC is exposure=PRIVATE) → a SECOND
  "payment received" email carries the download link. 30-day link, NOT shortenable (resend from dashboard).
- Buyer email required (guest or member both deliver to email). Delivery is server-side; no headless
  Thank-You page needed for the email. B4 to test once E2E: confirm THIS site's manual method tags the txn
  offline so the paid-path delivery fires.

## Codebase seams (from research lane, this repo)
- Photos schema (`scripts/provision-collections.mjs:32-65`): ALL perms ADMIN; has originalFileId(TEXT),
  previewFileId(TEXT), ownerMemberId(TEXT req), title, isPublic(BOOL), publicPinId. NO product/price field
  → ADD (idempotent per-field add, provision-collections.mjs:142-176).
- `/api/photos` is the sole Photos writer (GET/POST/PATCH/DELETE). Copy patterns: `requireMember()`
  (`src/lib/api/http.ts:25-35`), `ownedPhoto(photoId, memberId)` = `auth.elevate(items.get)('Photos', id)`
  + ownerMemberId check (`src/pages/api/photos.ts:27-31`), `auth.elevate(items.insert/query/update)(...)`,
  `import { auth } from "@wix/essentials"`.
- UI: OWNER "LIST FOR SALE" → PhotoDetailPanel own-pin action row (`PhotoDetailPanel.tsx:328,408-437`,
  gated by store.ownPhotoId). BUYER "BUY" → foreign-pin empty seam (viewingPinId set, ownPhotoId unset,
  `PhotoDetailPanel.tsx:328`). Thread productId+price onto PublicPin→SavedPinView (`src/store/upload.ts:33-45`,
  `src/store/pins.ts`). MyPins per-row sell control optional (`MyPins.tsx:209-244`).

## SDK signatures for the endpoints (installed `@wix/stores@1.0.830` + `@wix/ecom@1.0.2266` + `@wix/redirects@1.0.119`)
- `import { productsV3 } from "@wix/stores"` → `createProduct(product, options?): Promise<V3Product>` ·
  `deleteProduct(productId)`. CRITICAL: the SDK field is `digitalFile._id` (NOT `id`) and price is
  `price.actualPrice.amount` (string). Working product input:
  `{ name, productType:"DIGITAL", variantsInfo:{ variants:[{ price:{ actualPrice:{ amount:String(p) } },
   digitalProperties:{ digitalFile:{ _id: originalFileId } } }] } }`. Return: `created._id` = productId,
  `created.variantsInfo.variants[0]._id` = variantId. (declaration confirms required paths incl.
  `variantsInfo.variants.${n}.digitalProperties.digitalFile._id`.)
- `import { checkout } from "@wix/ecom"` → `createCheckout({ lineItems:[{ quantity:1, catalogReference }],
   channelType:"WEB" }): Promise<Checkout(_id)>` · `import { redirects } from "@wix/redirects"` →
   `createRedirectSession({ ecomCheckout:{ checkoutId }, callbacks:{ postFlowUrl } })` → `redirectSession.fullUrl`.
- `import { orders } from "@wix/ecom"` → `searchOrders(search: { filter?: Record<string,any>, cursorPaging?, sort? })
   : Promise<{ orders: Order[], metadata }>` (elevate). `getOrder(_id)`. NOTE: `queryOrders` is NOT exported.

## Phase 6 DESIGN (owner decisions: Catalog V3 · self-serve on PUBLIC pins, owner-unlist)
- Photos +fields: productId(TEXT), productVariantId(TEXT), priceAmount(NUMBER), currency(TEXT).
  PublicPins +fields: productId(TEXT), priceAmount(NUMBER), currency(TEXT). (idempotent provision add.)
- Listing fields are managed ONLY by /api/listings — NOT by photoRecord() (so a PATCH's `{...existing,...photoRecord()}`
  preserves them). publicPinRecord() gains an optional `listing` arg so a PATCH rebuild carries them onto the public row.
- POST /api/listings {photoId,priceAmount} (elevate): requireMember → ownedPhoto → guard originalFileId + isPublic →
  productsV3.createProduct(digital, file=originalFileId) → write productId/variantId/priceAmount/currency to Photos +
  PublicPins(publicPinId). DELETE /api/listings?photoId= : deleteProduct(best-effort) + clear both. GET /api/listings:
  owner's listed photos + soldCount via searchOrders(paymentStatus PAID + catalogItemId $hasSome).
- DELETE /api/photos also deletes the product if listed; PATCH→private also unlists.
- BUY (client, store/market.ts, buyer identity, NO elevate): checkout.createCheckout + redirects.createRedirectSession →
  window.location = fullUrl. catalogReference = { appId: STORES_APP_ID "215238eb-…", catalogItemId: productId,
  options?: { variantId } }. UNVERIFIED: whether V3 needs options.variantId — store variantId, test in browser.
- UI: PhotoDetailPanel own-pin row = LIST/UNLIST + price input; foreign-pin seam = BUY + price. MyPins row = price badge.

Related: `mem:patterns/members-pins` · `mem:project/wix-platform` · DECISIONS 2026-07-16 line · IMPLEMENTATION_PLAN §Phase 6.
