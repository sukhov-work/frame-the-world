# Convention — Wix Managed Headless mechanics

The distilled, project-relevant mechanics for building on Wix-managed headless (Astro 5). This is the
**reference the `/frame` skill points to** for anything Wix-platform. Distilled from the internal
`wix-headless` production skill (provenance at the bottom) — mechanics kept, vertical-site conductor
machinery dropped (we build a bespoke instrument, not a stores/blog vertical).

> **Golden rule:** never fabricate a Wix API signature. When unsure, use the **Wix MCP / Wix Skills**
> (installed via the Wix plugin) to search the docs, or `gh`/web. Prefer the **Wix JS SDK** over raw REST
> in app code; use `curl` + CLI token only for one-off admin/provisioning calls.

## 1. Prerequisites (already satisfied on this machine)
- Node ≥ 20.11 (have **v22.14**). nvm-managed. Wix-scoped npm registry configured. CLI authed.
- Verify auth: `npx @wix/cli@latest whoami` → exit **0** = logged in. If not: `npx @wix/cli@latest login`
  (device-code flow; it prints a `verificationUri` + `userCode` on stdout — surface to the user, then wait).

## 2. Scaffold (Phase 1 — run once)
```bash
# Interactive:
npm create @wix/new@latest headless
# Non-interactive (agent-friendly): pass all three or it errors / falls back to prompts.
npm create @wix/new@latest headless -- \
  --folder-name . --business-name "Frame the World" --site-template   # bare --site-template = blank starter
```
- The CLI **provisions a Wix business + site** on your account, generates local code, `npm install`s,
  `git init`s, builds, and publishes a live URL. No dashboard pre-setup needed.
- **This repo already has `.git` (no commits).** `npm create` wants to init git / may insist on a fresh
  folder. Phase-1 plan: scaffold into a temp subdir, then move files up into the repo root and keep the
  **existing** `.git` (don't nest a second repo). Verify `git status` after.
- Confirm the scaffold produced: `@wix/astro`, `@astrojs/react`, `output: 'server'`,
  `@wix/cloud-provider-fetch-adapter`, and **`wix.config.json`** (holds `siteId` + `appId`).

## 3. Auth for REST / provisioning (`@wix/cli` + `curl`)
```bash
SITE_ID="<siteId from wix.config.json>"
TOKEN=$(npx @wix/cli@latest token --site "$SITE_ID")   # SITE-scoped. Mint ONCE per run; it's byte-identical on re-call.
curl -sS -X POST "https://www.wixapis.com/<endpoint>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: $SITE_ID" \
  -H "Content-Type: application/json" \
  -d '<body>'
```
- **Bearer** prefix required. `wix-site-id` required by site-scoped families; harmless elsewhere → send always.
- `npx @wix/cli@latest token` (no `--site`) = **account-scoped** (for `manage.wix.com/...`). Don't cross scopes
  (site token on account call → `403 ACCOUNT_TOKEN_REQUIRED`, and vice-versa).
- **Recovery:** on `401` retry the same call once with the cached token; if it persists the CLI session
  expired → `wix login` (only then does a re-minted token differ). On `403` → the app/permission/provisioning
  isn't in place; surface the body, don't loop. **Never A/B-test header shapes; never re-mint as a "fix".**

## 4. Dev / build / release
| Action | Command |
|---|---|
| Local dev (hot reload, Site + Dashboard links) | `wix dev` |
| Typecheck | `npx astro check` |
| Pull env (writes `WIX_CLIENT_ID` → `.env.local`) | `npx @wix/cli@latest env pull --json` (always `--json`) |
| Build | `npx @wix/cli@latest build` |
| Release (publish to Wix cloud) | `npx @wix/cli@latest release` |
- npm installs use `--legacy-peer-deps` (**pnpm fails** against the `@wix/cli` template). Never invent
  packages; skipping a needed `@wix/<x>` → `Rollup failed to resolve import "@wix/<x>"`.
- Missing `WIX_CLIENT_ID` → build fails with `Missing environment variable WIX_CLIENT_ID` → run `env pull`.

## 5. SDK usage in app code
- `@wix/astro` gives **automatic auth** on managed headless — you generally don't hand-build a client for
  visitor calls. Import the business module and call it (Astro component script or endpoint):
  ```ts
  import { items } from "@wix/data";          // Data Collections
  import { members } from "@wix/members";     // auth / member context
  // import { elevate } from "@wix/essentials"; // admin identity (see §7)
  ```
- Install SDK packages as needed (`--legacy-peer-deps`): `@wix/sdk @wix/data @wix/members @wix/media
  @wix/pricing-plans @wix/ecom @wix/essentials`. Verify exact module/method names via Wix MCP before use.

## 6. Backend HTTP endpoints (Astro)
- Add server endpoints as Astro API routes / Wix CLI **Astro endpoints** extension. This app's contract
  (from the plan): `POST /api/upload-url`, `/api/photos`, `/api/analyze`, `/api/moderate`.
- Endpoints have **execution-time + per-minute quota limits** (504 on timeout, 429 on quota). **Never**
  run RAW decode server-side here (C1). Keep endpoints thin: validate, elevate, call SDK, return.

## 7. Elevation (admin identity)
- Visitor context is anonymous by default → privileged calls (e.g. `generateFileUploadUrl`, inserting on
  behalf of a member) return **403**. Wrap them with `elevate()` from `@wix/essentials`, **least-privilege**,
  only in backend endpoints — never expose elevated calls to the client.

## 8. Data Collections (Photos / PublicPins / Listings)
- Add via the Wix CLI **data-collections** backend extension. Schema in `ARCHITECTURE.md § Data model`.
- **No geospatial operator.** Query language: `$eq/$ne/$hasSome/$hasAll/$in/$gt/$lt/$exists/$and/$or/$not`.
  Viewport query pattern: store a **geohash** string per photo → compute covering prefixes client-side →
  `hasSome(geohashPrefix, [...])` → refine client-side. (Denormalize hot fields into `PublicPins`.)
- **Quota (10 free / unlimited paid):** enforce server-side. *(As built, Phase 5 — SUPERSEDES the
  `beforeInsert`-hook plan (D8): the headless CLI provisions **no Wix Data hooks**, and a member-session
  insert is platform-refused, so the count-and-reject lives in the elevated `POST /api/photos` handler
  (#11 → 402). Pricing Plans gates unlimited.)* UI-only enforcement is a bug.

## 9. Media Manager (RAW originals + previews)
- **Files >10MB MUST use `generateFileResumableUploadUrl` (TUS)** — RAW is 25–80MB. `generateFileUploadUrl`
  needs elevated identity. Uploads are **async** → listen for `onFileDescriptorFileReady` before using the file.
- Store **originals private**, derived low-res previews + projected textures **public**. Non-premium sites
  cap at 10GB total storage. Errors to handle: `FILE_SIZE_OVER_LIMIT`, `SITE_QUOTA_EXCEEDED`.
- Confirmed RAW extensions: `.arw .srw .nef .cr2 .cr3 .crw .rwl .rw2 .raw .raf .pef .orf .mrw .dng .sr2 .srf
  .kdc .k25 .dcr .x3f .erf .3fr` + HEIC/HEIF. **Exact per-file MB cap is TODO-VERIFY.**

## 10. eCommerce (marketplace-light) — AS BUILT on Catalog **V3** (Phase 6, 2026-07-16)
- **The site is Catalog V3, not V1** — the gateway hard-rejects every V1 call (`428
  CATALOG_V3_CALLING_CATALOG_V1_API`). V1's digital-file attach (`CatalogWriteApi.CreateDigitalProduct`) is
  `exposure=INTERNAL` (a headless app can't reach it); **V3 lets a headless elevated app create digital products.**
- List = `productsV3.createProduct` (`@wix/stores`), elevated: `{ name, productType:"DIGITAL",
  variantsInfo:{ variants:[{ price:{ actualPrice:{ amount:"9.99" } }, digitalProperties:{ digitalFile:{ _id: <wixMediaFileId> } } }] } }`.
  The digital file = the retained private original (`Photos.originalFileId`) — no re-upload. Wix classifies it
  (SECURE_PICTURE/…). Returns `product._id` (productId) + `variantsInfo.variants[0]._id` (variantId).
- Buy = CLIENT-SIDE in the buyer identity (NOT elevated): `checkout.createCheckout({ lineItems:[{ quantity:1,
  catalogReference }], channelType:"WEB" })` then `redirects.createRedirectSession({ ecomCheckout:{ checkoutId },
  callbacks:{ postFlowUrl } })` → `redirectSession.fullUrl` (Wix-hosted checkout). **`catalogReference` MUST be
  `{ appId:"215238eb-22a5-4c36-9e7b-e7c08025e04e" (fixed Wix-Stores id, NOT the TPA id), catalogItemId: productId,
  options:{ variantId } }`** — productId alone yields an EMPTY checkout (verified against the live gateway).
- Delivery: on the order becoming PAID, a preinstalled Stores automation emails the buyer a **30-day** download
  link (not shortenable). Manual/offline payment → the link arrives after the owner marks the order paid in the
  Wix dashboard (`MarkOrderAsPaid` is exposure=PRIVATE — dashboard only). **No split payments** (Wix Help Center) →
  **owner-mediated manual payout** is the only v1 path (C3). Owner sales in-app = elevated `orders.searchOrders`.

## 11. AI (premium shot-analysis + moderation)
- Runtime Claude via **Wix AI APIs** (proxy; ~1 credit/method call; docs show Claude Opus 4.6). Wix handles
  auth/billing (to the site owner in dev). Vision accepts **JPEG/PNG/GIF/WebP — NOT RAW** → always send a
  **downsized JPEG preview**. Same path doubles as the C6 moderation gate for public pins.
- Fallback: call Anthropic directly from an endpoint with your own key in Secrets Manager (needs the key).
- TODO-VERIFY: exact Wix-exposed vision model list + credit cost at realistic preview sizes.

## 12. Islands / SSR
- The globe is `client:only="react"` — **never SSR WebGL**. WASM decode runs in a **Web Worker**
  (`OffscreenCanvas`, transfer `ArrayBuffer` zero-copy). WASM is emitted as hashed Vite build assets (libraw)
  / inlined in the bundle (libheif) — **no `public/wasm/`** (falsified in Phase 2).
- WASM **threads** need `SharedArrayBuffer` → cross-origin isolation (COOP `same-origin` + COEP `require-corp`).
  *(RESOLVED by sidestep, Phase 2: we ship **single-threaded** `libraw-wasm@1.0.5` in a disposable Worker —
  no isolation, no COOP/COEP; the header question stayed moot because we never needed threads.)*

## 13. No cron
Headless has no scheduler. If ever needed (e.g. expiring listings): external trigger (GitHub Actions cron)
hitting a token-secured HTTP endpoint (ADR D11). None in v1.

---

## Gotchas quick table
| Gotcha | Do |
|---|---|
| pnpm fails on `@wix/cli` template | `npm install --legacy-peer-deps` |
| `Missing env WIX_CLIENT_ID` | `npx @wix/cli@latest env pull --json` |
| 403 on privileged backend call | `elevate()` (`@wix/essentials`), least-privilege, backend only |
| RAW upload >10MB fails | `generateFileResumableUploadUrl` (TUS); file readiness is async |
| No geo query on Wix Data | geohash-prefix `hasSome` + client refine |
| Claude vision rejects RAW | send downsized JPEG/PNG |
| Split-payment marketplace | not supported → owner-mediated payout |
| WebGL SSR crash | globe = `client:only`; decode in a Worker |
| 30-day download expiry | message buyers; not shortenable |

## Provenance — what we borrowed vs dropped from the internal `wix-headless` skill
Source (read-only reference): `/Users/yevhens/Projects/wix-private/ecom/ecom/.claude/claude-docs/frame-the-world/wix-headless/` (SKILL.md +
`references/SETUP.md`, `references/shared/AUTHENTICATION.md`, `references/custom/*/WIRING.md`, …).
- **Borrowed (this doc):** CLI+token+`curl` auth shape & recovery ladder, scaffold command + single-folder
  caveat, `env pull --json`, `--legacy-peer-deps`, elevate, resumable upload, no-geo-query, no-split-payment,
  30-day link, Astro-endpoint limits, `client:only` islands.
- **Dropped (not applicable to a bespoke instrument):** the vertical **pack/seeder** system (stores/blog/
  bookings/cms/forms/gift-cards seed recipes), the **design-system Composer** (`compose.mjs`, DESIGN.md →
  6-file emit), the multi-subagent **conductor** (`PLAN.md`/`BUILD.md` orchestration, image-wave generation),
  and app-install-per-pack curls. We install only the specific `@wix/*` SDK modules this product needs and
  hand-author every screen/island (no vertical seeding). Our design flow is **Claude Design → tokens →
  GL bridge** (see `provenance/CLAUDE_DESIGN_MEMO.md`), not the internal Composer.
