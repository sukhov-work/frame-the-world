# mem:patterns/members-pins — Phase 5 mechanics: auth, collections, save flow, quota, globe pins (2026-07-10, wix-cloud-VERIFIED)

How members + save-pin + quota + public pins work, with every trap hit while building. Files:
`store/{member,save,pins}.ts` · `lib/geo/precision.ts` · `lib/wix/pinRecords.ts` · `lib/save/{pinBody,uploadMedia}.ts` ·
`pages/api/{upload-url,photos,ping}.ts` · `globe/Pins.ts` · `panels/MemberBadge.tsx` · PhotoDetailPanel `.pd-save` ·
`scripts/provision-collections.mjs` · tuning.PINS.

## Auth (managed headless — @wix/astro owns it)
- `wix()` integration auto-injects `GET /api/auth/login?returnToUrl=..` (302 → Wix-hosted login/signup page),
  `POST /api/auth/logout`, `/api/auth/callback`. Session cookie **`wixSession`** = URI-encoded JSON
  `{clientId, tokens:{accessToken:{value,expiresAt}, refreshToken:{value, role:'member'|'visitor'}}}` (Astro cookies.set object form).
- Middleware (AsyncLocalStorage) makes ALL ambient `@wix/*` calls run as the cookie's identity on server AND client.
  `auth.elevate(fn)` (@wix/essentials) = admin; needs WIX_CLIENT_SECRET (present in .env.local after `wix env pull`).
- **TRAP: OAuth app allowlist is PORT-EXACT.** The provisioned OAuth app allows localhost:4321 only; wix dev falls back
  to 4322 → hosted login dies with "Invalid redirect URI". Fix once via REST:
  `PATCH https://www.wixapis.com/oauth-app/v1/oauth-apps/{appId}` body `{oAuthApp:{id, allowedDomains:[..], allowedRedirectUris:[..], allowedRedirectDomains:[..]}, mask:{paths:[...]}}`
  (site token; 4322 entries added 2026-07-10; oAuthAppId = appId in wix.config.json).
- `members.getCurrentMember({fieldsets:['FULL']})` — REJECTS (403) for visitors → try/catch → anonymous. PUBLIC fieldset omits loginEmail.
- **Test member without captcha** (hosted signup form is reCAPTCHA-gated; automation can't pass it): Node script with
  `createClient({auth: OAuthStrategy({clientId})})` → `auth.register({email,password})` / `auth.login(...)` → **StateMachine
  SUCCESS + data.sessionToken, NO captcha demanded** → replicate getMemberTokensForDirectLogin (browser-only iframe) manually:
  GET `https://<site>/_api/oauth2/authorize?clientId=..&responseType=code&state=<oauthData.state>&redirectUri=<allowed>&scope=offline_access&responseMode=query&codeChallenge=..&codeChallengeMethod=S256&prompt=none&sessionToken=<st>`
  with `redirect:'manual'` → Location has ?code&state → `auth.getMemberTokens(code, state, oauthData)` → tokens →
  `document.cookie = "wixSession=" + encodeURIComponent(JSON.stringify({clientId, tokens})) + "; path=/; max-age=10800; SameSite=None; Secure"`.
  Existing test member: **frame-p5-tester@example.com / FrameP5!test1** (memberId fd878a99-e1c7-4143-8d1a-31f9a07e3996, 1/10 quota used).

## Collections (LIVE on site; source of truth = scripts/provision-collections.mjs)
- **FALSIFIED: `extensions.dataCollections` CLI builder does NOT provision from wix dev** (polled REST list 36s+ — nothing;
  probably release-time only). Extension files deleted; provisioning = REST
  `POST wixapis.com/wix-data/v2/collections` (idempotent script re-run safe). REST perms enum: ANYONE/SITE_MEMBER/SITE_MEMBER_AUTHOR/ADMIN.
- **Photos** (26 fields): ALL perms ADMIN → member sessions CANNOT write directly (verified: WDE0027 on client insert) —
  this is what makes the quota unbypassable. Ownership = explicit `ownerMemberId` field (elevated inserts run as APP identity,
  so `_owner` is useless / SITE_MEMBER_AUTHOR wouldn't work). Exact GPS lives ONLY here.
- **PublicPins** (10 fields): read ANYONE, writes ADMIN. Fields all derive from reduced coords: latReduced/lonReduced
  (= geohash cell CENTER), geohash (tier cell), gh4/gh6 (query prefixes), precision, previewUrl, capturedAt, photoRef, title.

## C6 precision tiers (lib/geo/precision.ts — pure, tested)
exact→p9 (opt-in) · **1km→p6 (DEFAULT)** · city→p4. `reduceLocation(lat,lon,tier)` returns the cell center + gh4/gh6;
every point in a cell maps to the SAME public location (anonymity set). Server (publicPinRecord) is the ONLY builder of
PublicPins rows — client-supplied "reduced" fields can't leak. Verified live: 48.4647/35.0462 → published 48.46344/35.04089 (~150 m).
**Dnipro gh4 = `ub8g`** (NOT u8vb — hand-derivation error early in session).

## Save flow (store/save.ts → lib/save/*)
1. Original File retained in upload store (NEW `file?: File`, set in loadFile, cleared in clear) → TUS upload
   (tus-js-client: endpoint=uploadUrl, metadata {filename, contentType, token: uploadToken}) → **finalize
   `PUT ${uploadUrl}/${uploadToken}?filename=..`** → response `{file:{id,url}}`. Failure DEGRADES to warning (pin still saves).
2. Preview: fetch(previewUrl) → createImageBitmap → OffscreenCanvas ≤1280px JPEG q0.82 → `POST /api/upload-url {kind:'preview'}`
   (generateFileUploadUrl, public) → `PUT uploadUrl?filename=..` body blob → `{file:{id,url}}`; url = static.wixstatic.com/media/…
   (verified working). Required for public pins; optional for private.
3. `POST /api/photos` — endpoint: getCurrentMember → `elevate(items.query)('Photos').eq('ownerMemberId', id).count()` →
   ≥10 && no ACTIVE `orders.memberListOrders` (member context; **catch → free**, never unlimited) → 402 QUOTA_EXCEEDED →
   else elevated insert Photos + (isPublic) PublicPins + update photo.publicPinId. sizeInBytes MUST be a STRING (DECIMAL_VALUE).
- Verified live: save → 200 {photoId, publicPinId, quota 1/10}; #2..#10 → 200; **#11 → 402 QUOTA_EXCEEDED**; media both uploaded.
- **UNVERIFIED: paid path** — Pricing Plans app NOT installed on the site (appDefId 1522827f-c56c-a5c9-2ac9-00f9e6ae12d3,
  install via apps-installer-service curl) → memberListOrders currently throws → treated as free. Wire + test when marketplace lands.
- **PRE-RELEASE GATE: app-defined POST routes returned 403 IN PRODUCTION in an official-skill trial** (BACK_IN_STOCK.md).
  wix dev verified fine. Before `wix release`: hit /api/ping (kept as canary) with POST on the released URL.

## Globe pins (globe/Pins.ts + store/pins.ts + StylizedTiles wiring)
- attach-module: InstancedMesh (SphereGeometry(1,12,8) ×1000 cap), MeshBasicMaterial tokens.accent, **depthWrite:false**,
  frustumCulled:false, raycast ENABLED (decorations disable theirs; pins must not). Per-instance matrix = compose(ECEF pos,
  identity, scale = clamp(camDist × PINS.angularSize .008, 6, 45000)) — recomposed only when camera moved >1m or pins changed.
  Ground height via ground.heightAt (null until tiles → fallbackGroundM 120 + lazy resnap every 120 frames, keeps real answers).
- Viewport query (D7): orchestrator %12-frame block mirrors focus (ecefToGeodetic) + alt → `usePinsStore.reportViewport`.
  Tiers: ≥120 km → global newest-1000 (`descending('_createdDate').limit(1000)`); <120 km → `hasSome('gh4', cells)`;
  <3 km → gh6. Cells via geohashesForViewport(bounds from span = alt(km)×0.011 clamped .03..50); >120 cells → global fallback.
- **TRAP (real bug, fixed): debounce starvation.** Reports arrive ~5/s and needsRequery stays TRUE until the FIRST query
  lands — clearing+re-arming the timer on every report starves it forever. Use THROTTLE: if a timer is pending, return;
  callback reads the freshest `lastReported`. (refresh() bypasses the timer — that's why post-save refresh worked while
  organic queries never fired.)
- Click→fly: pointerup gate (≤6px) — placing wins, else Raycaster.setFromCamera → pins.pick → flyToPin (ground+2600m up,
  2400m back along current approach azimuth, lookAt pin). Verified via synthetic PointerEvents (pointerId must be fake-ok:
  no setPointerCapture in OUR handler; GlobeControls' capture throw doesn't block sibling listeners).
- **TRAP (transient): picks can miss for a few seconds right after a flight arrives** — the controls keep adjusting the
  camera (observed 2700 m → 587 m creep) and the pick ray/matrixWorld disagree with the visible frame during the creep;
  the same probe hits reliably once settled. Cosmetic for v1; revisit if users report dead clicks after flights.
- Post-save: save store lazy-imports pins store → refresh() → new pin appears immediately.

## Verification & env notes
- Vite dev serves node_modules to the page: `import('/node_modules/.vite/deps/three.js')` (page's own instance) and
  `/@fs/<abs path>` for repo files (used to feed the gps-heading.jpg fixture to loadFile in Playwright).
- **TRAP: installing npm packages while wix dev runs → 504 Outdated Optimize Dep + dead hydration** → restart dev server.
- Dev hooks: window.__memberStore/__saveStore/__pinsStore (+ existing __uploadStore/__globe/__timeStore/__cameraStore).
- Shots: verify-shots/phase5-01..06 (badge, save section, pinned 1/10, visitor LEO, pin close, pin marker).

Related: `mem:core` · `mem:project/wix-platform` · `mem:patterns/upload-flow` (decode side) ·
`mem:patterns/photo-frustum` (placement) · DECISIONS 2026-07-10 Phase 5 entry · NEXT_SESSION_PROMPT.md.
