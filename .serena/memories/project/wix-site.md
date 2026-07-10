# mem:project/wix-site
The live Wix project this repo is bound to (provisioned by `npm create @wix/new`, 2026-07-09). (Referred by `mem:core`.)

- **Site (live URL):** https://frame-the-a173087b-yevhens.wix-site-host.com
- **Dashboard / Business Manager:** https://manage.wix.com/dashboard/f597bcf5-bd38-4941-9dfe-e16d775743a3
- **siteId:** `f597bcf5-bd38-4941-9dfe-e16d775743a3`  (→ `--site` for `token`, `wix-site-id` header, install bodies)
- **appId:** `566ce8ce-d18c-4950-88ac-5d2c53311cd6`  (→ SDK `createClient` inputs)
- **Wix account:** yevhens@wix.com. **Business name:** "Frame the World".
- `wix.config.json` at repo root holds siteId+appId. `.env.local` (gitignored) holds `WIX_CLIENT_ID` (+ `PUBLIC_CESIUM_ION_TOKEN` slot).

## Deploy
`npx @wix/cli@latest build` → `release`. **RELEASED 2026-07-10** (owner greenlight; Esri ToS + no-moderation
accepted as POC risks): the live URL serves the full Phase-1..5 app (globe + upload/decode + projection +
ephemeris + members/pins/quota). Production canaries green: POST routes work (the official-skill 403 trial
report does NOT reproduce here), elevate()+Data writes OK in the released runtime, hosted login renders
(protocol repaired from Referer — curl without Referer sees "Invalid redirect URI", browsers are fine).
OAuth app allowlist includes localhost:4321+4322 and the prod https URLs (+ inert http prod entries).
No SSH; Wix cloud is prod. Test member: frame-p5-tester@example.com (see mem:patterns/members-pins).
GitHub: wix-private/headless-frame-the-world (owner pushed; PR #2 "Membership support" = Phase 5).
