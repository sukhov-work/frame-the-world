# Track B — Wix platform + backend + ops (C1/C6, media, marketplace, release, R2)

Format: one assertion per item, then `— check:` and `— anchor:`. Authored 2026-08-13; re-mine
DECISIONS since the baseline anchor at every audit start and append dated items.

TOC: 1 thin endpoints · 2 C6 privacy · 3 quota · 4 media/TUS · 5 Wix signatures · 6 checkout
contract · 7 release discipline · 8 R2/bake sync · 9 secrets · 10 external-data currency ·
11 auth mechanics · 12 postel boundaries · 13 collection-schema source of truth

1. Endpoints stay THIN (C1): no decode, projection, or image processing server-side; `elevate()`
   least-privilege per route; every elevated insert sets `ownerMemberId` explicitly (elevated
   writes run as the APP identity).
   — check: read each `src/pages/api/*.ts` for compute weight + elevate scope; grep elevated
   inserts for ownerMemberId.
   — anchor: PROJECT_SEED C1; DECISIONS §Traps (Phase 5).
2. C6 privacy is structural: PublicPins rows carry ONLY reduced fields (geohash cell-centre,
   1 km/p6 default; exact = opt-in); no public payload (market, pins, hover, share) leaks exact
   GPS; location edits RE-reduce to the NEW cell centre; bake-time military/critical-infra
   exclusion masks intact; `🧭 my location` stays client-only, never published.
   — check: grep PublicPins writers + GET /api/market projection for lat/lon sources; read
   `publicPinRecord`; bake config exclusion list unchanged.
   — anchor: PROJECT_SEED C6; mem:patterns/members-pins; S3 re-reduction (2026-07-11).
3. Quota is endpoint-enforced (no data hooks on headless): POST /api/photos walls at 100 free /
   1000 premium; the member-session insert path stays platform-refused (WDE0027) — the wall is
   unbypassable.
   — check: read the quota block in api/photos.ts; numbers match the 2026-07-17 ruling; no new
   write path skips it.
   — anchor: D8 supersession; DECISIONS 2026-07-17 owner rulings.
4. Media >10 MB goes through `generateFileResumableUploadUrl` (TUS) with the async
   `onFileDescriptorFileReady` contract; originals private, previews public ≤1280px; upload
   failure degrades to a warning, never blocks the save.
   — check: read lib/save upload path; grep for direct non-resumable large uploads.
   — anchor: ADR D9; conventions/wix-headless.md; CLAUDE.md gotchas.
5. No fabricated Wix API signatures: every SDK/REST call verified via Wix MCP / typings; any new
   Wix surface since baseline cites its verification.
   — check: diff `@wix/*` call sites since baseline against typings (`npx astro check` covers
   most); new REST calls name their doc.
   — anchor: CLAUDE.md hard rule; /frame non-negotiables.
6. Checkout/listing contract holds: `catalogReference` carries `options.variantId` + the fixed
   Wix-Stores appId `215238eb-…` (never the TPA id); listings create via
   `createProductWithInventory` with `inStock:true` untracked; unlist deletes the product;
   SITE_CURRENCY stamped at create.
   — check: read lib/market/listing.ts + api/listings.ts against the Phase-6/6.9 digests.
   — anchor: DECISIONS 2026-07-16 (KEY TRAP) + 2026-07-17 stock fix.
7. Release discipline: `/api/ping` canary gates every release; the sharded-edge-cache recovery
   (reload until clean) stays documented wherever release steps live; release-riding UNVERIFIED
   tails (`/api/sbdb` first egress, `/m` pages.json, `#p=` login round-trip) are tracked, not
   forgotten.
   — check: NEXT_SESSION_PROMPT + tracked-backlog rows vs the actual last-release date.
   — anchor: DECISIONS §Traps (Wix platform); 2026-07-17 release line.
8. R2/bake sync contract: `scripts/bake/cities/*.json` bbox == `tuning.ts ENRICHED.bbox` (regen
   BOTH bakes on change); `wix dev` streams tiles from local `bakes/` (zero workers.dev
   requests), build/release bake the R2 URL; the Worker stays CORS/Range-correct.
   — check: diff the two bboxes; `.env.development.local` override present; grep built client
   bundle config for the R2 URL.
   — anchor: DECISIONS 2026-07-14 local-dev tiles + 10 km extent (sync contract).
9. Secrets: ion token / OAuth client / R2 creds live in env (gitignored), never committed; no
   tokens in verify scripts, logs, or docs; `git log --all --diff-filter=A -- "*.env*"` clean.
   — check: run the git probe; grep committed files for key-shaped literals.
   — anchor: repo .gitignore; Phase-1 setup gotchas.
10. External-data currency (Lehman): the app's data dependencies age — Esri/CARTO/OpenFreeMap
    ToS status carries a dated accepted-risk note; baked catalogs (BSC5, OpenNGC, MPC comets,
    asteroids, IAU MDC when built) name their bake date + refresh path; TLE proxy (M6) states
    TLE validity days; Pricing Plans install status tracked.
    — check: walk each external dependency for a dated note in docs/backlog; flag undated ones.
    — anchor: NEXT_SESSION_PROMPT accepted-POC-risks; ASTRO_ENGINE bake scripts.
11. Auth mechanics intact: OAuth allowlist stays PORT-EXACT (4321 + 4322); login callback
    Referer repair documented; stale-member-cookie → visitor-cookie replacement respected in
    verify scripts (re-mint before member flows).
    — check: docs mention both ports; verify scripts re-mint cookies.
    — anchor: DECISIONS §Traps (Phase 5 release).
12. Postel boundaries: LIBERAL in what we accept (EXIF junk → terrain-snap altitude, missing
    heading → manual entry, TZ-naive dates, garbage OSM tags defended in the bake, tolerant
    hash parsers) · STRICT in what we emit (validated thin-endpoint payloads, C6-reduced public
    rows, exact schema writes to Photos/PublicPins). New boundaries since baseline follow it.
    — check: new input paths show fallbacks; new emit paths show validation.
    — anchor: ADR D4 (nudge-is-core); C6; laws.md.
13. Collection-schema source of truth (appended 2026-08-13, audit #1 re-mine):
    `scripts/provision-collections.mjs` is the ONE schema definition (the CLI
    `extensions.dataCollections` path does NOT provision from wix dev — falsified Phase 5);
    every field the code reads/writes on Photos/PublicPins/SavedPlaces exists in that script,
    and schema changes land there first.
    — check: diff the field names used in `src/lib/wix/*` + `src/pages/api/*` against the
    provision script's field lists.
    — anchor: DECISIONS §Traps "extensions.dataCollections does NOT provision" (Phase 5).
