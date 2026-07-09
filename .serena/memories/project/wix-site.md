# mem:project/wix-site
The live Wix project this repo is bound to (provisioned by `npm create @wix/new`, 2026-07-09). (Referred by `mem:core`.)

- **Site (live URL):** https://frame-the-a173087b-yevhens.wix-site-host.com
- **Dashboard / Business Manager:** https://manage.wix.com/dashboard/f597bcf5-bd38-4941-9dfe-e16d775743a3
- **siteId:** `f597bcf5-bd38-4941-9dfe-e16d775743a3`  (→ `--site` for `token`, `wix-site-id` header, install bodies)
- **appId:** `566ce8ce-d18c-4950-88ac-5d2c53311cd6`  (→ SDK `createClient` inputs)
- **Wix account:** yevhens@wix.com. **Business name:** "Frame the World".
- `wix.config.json` at repo root holds siteId+appId. `.env.local` (gitignored) holds `WIX_CLIENT_ID` (+ `PUBLIC_CESIUM_ION_TOKEN` slot).

## Deploy
`npx @wix/cli@latest build` → `release`. As of 2026-07-09 the published live URL is still the **blank
scaffold** — Phase 1 globe is **browser-verified locally** in `wix dev` (stylized base ellipsoid + real OSM
buildings over Dnipro + atmosphere + starfield + graticule + snappier zoom), but **not `wix release`d yet**
(pending user greenlight; runs to `release` publish the globe to the live URL). No SSH; Wix cloud is prod.
