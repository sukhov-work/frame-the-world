# mem:suggested_commands — Frame the World
> Live **after Phase 1** scaffolds the Astro app. Until then only the scaffold + CLI-auth commands apply.

## Wix CLI auth / provisioning
- `npx @wix/cli@latest whoami`                       # exit 0 = logged in
- `npx @wix/cli@latest login`                        # device-code flow (surface verificationUri + userCode)
- `SITE_ID=<from wix.config.json>; TOKEN=$(npx @wix/cli@latest token --site "$SITE_ID")`  # site REST token; mint ONCE
- REST: `curl -H "Authorization: Bearer $TOKEN" -H "wix-site-id: $SITE_ID" -H "Content-Type: application/json" ...`

## Scaffold (Phase 1, once)
- `npm create @wix/new@latest headless -- --folder-name . --business-name "Frame the World" --site-template`
  (preserve existing `.git`: scaffold to temp subdir → move up → keep one repo)

## Daily dev
- `npm install --legacy-peer-deps`                   # pnpm FAILS against @wix/cli template
- `wix dev`                                           # local dev, hot reload, Site + Dashboard links
- `npx @wix/cli@latest env pull --json`              # writes WIX_CLIENT_ID → .env.local (always --json)
- `npx astro check`                                  # typecheck
- `npm test`  /  `npx vitest run`                    # unit tests (FOV, geohash, projection, ephemeris)
- `npm run lint`                                     # lint

## Build / release ("prod" = Wix cloud; no SSH)
- `npx @wix/cli@latest build`
- `npx @wix/cli@latest release`                      # publishes to the live URL

## Handy
- `npm view 3d-tiles-renderer dist.unpackedSize`     # TODO-VERIFY #7 (bundle size)
- `gh api repos/wix-private/developer-docs/contents/headless-docs/<path> -H "Accept: application/vnd.github.raw"`  # Wix headless docs
