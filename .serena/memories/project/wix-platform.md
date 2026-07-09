# mem:project/wix-platform
Wix mechanics + gotchas condensed for quick recall. Full reference: `.claude/conventions/wix-headless.md`. (Referred by `mem:core`.)

## Auth (CLI + curl for REST/provisioning; SDK for app code)
- `TOKEN=$(npx @wix/cli@latest token --site "$SITE_ID")` — SITE-scoped, mint ONCE (byte-identical on re-call). No `--site` = account-scoped.
- Headers: `Authorization: Bearer $TOKEN` + `wix-site-id: $SITE_ID` + `Content-Type: application/json`.
- 401 → retry once w/ cached token → else `wix login`. 403 → app/permission/provisioning missing (not a token bug). Never re-mint as a fix; never A/B header shapes.
- App code: `@wix/astro` gives auto-auth; import the module and call it. **Never fabricate a signature — use Wix MCP.**

## Hard gotchas (each is a bug if violated)
- pnpm FAILS → `npm install --legacy-peer-deps`. Missing `WIX_CLIENT_ID` → `env pull --json`.
- Privileged backend call → `elevate()` (`@wix/essentials`), least-privilege, backend only — else 403.
- RAW >10MB upload → `generateFileResumableUploadUrl` (TUS); file readiness is async (`onFileDescriptorFileReady`).
- Wix Data has **no geo query** → geohash-prefix `hasSome` + client refine.
- Claude vision rejects RAW → send downsized JPEG. No split payments → owner-mediated payout.
- Globe = `client:only` (never SSR WebGL). No cron on headless. 30-day download links (not shortenable).
- Astro **5** only (not 6). Endpoints have exec-time/quota limits (504/429) → keep thin, decode client-side (C1).

## TODO-VERIFY (internal Wix access — safe default each; full table in IMPLEMENTATION_PLAN.md)
RAW MB cap · COOP/COEP page headers (→ single-thread SIMD) · endpoint exec-time/size · Wix AI vision model list
+ credit cost · marketplace payout roadmap (none) · `3d-tiles-renderer` bundle size. Record answers here + in DECISIONS.md once resolved.

## Provenance
Distilled from the internal `wix-headless` skill (…/ecom/ecom/.claude/claude-docs/frame-the-world/wix-headless/).
Borrowed mechanics; dropped the vertical seeder / design-Composer / multi-agent conductor (we build a bespoke instrument).
