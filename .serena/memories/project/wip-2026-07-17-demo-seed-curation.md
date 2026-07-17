# mem:project/wip-2026-07-17-demo-seed-curation — demo-pin dozen curated + next-session queue reshaped

**Owner asks (2026-07-17):** (1) schedule the Phase-6 UI tails as real next-session work; (2) "a dozen
public domain nice very unusual tasteful unexpected nature photos uploaded across globe for demo effect,
surprise me". Docs-only session — no code. Chunk-500 prod outage: owner-confirmed GONE for now
(warm-script ritual stands, [[project/wip-2026-07-16-prod-asset-outage]]).

## Where everything lives
- **The dozen + alternates + license-rejects + seeding plan:** `.claude/claude-docs/DEMO_CONTENT_SEED.md`
  (NEW root working doc; archive after seeding). All 12 machine-verified: Commons
  `extmetadata.LicenseShortName` = CC0/"Public domain" (or US-Gov work) + direct URLs HTTP-200'd.
- **Ordered next-session queue:** `NEXT_SESSION_PROMPT.md` §Do next — 1) Phase 6.9 marketplace-UI
  mini-batch (spec = §Phase 6 UI tails, from [[project/wip-2026-07-16-phase6-marketplace-research]])
  → 2) demo seeding → 3) Phase 7 AI.

## SIZING UPDATE (2026-07-17 later): owner raised the seed to ~30
Bench promoted into the main list → **24 distinct locations (+3 optional same-site frames = 27)** in
`DEMO_CONTENT_SEED.md`. A round-2 hunt (US-federal: Kilauea/black-smoker/Denali/supercell · Commons CC0:
Bromo/Ha Long/baobabs/Danakil/Patagonia/Iceland/Lofoten/Australia) was **STOPPED BY THE OWNER mid-run** —
do NOT relaunch unprompted; the un-searched targets are parked in the doc's §Top-up section for an
exact-30 pass if asked. NASA WAIS "Spectacular Sundog" excluded (CC-BY tag shadows the PD-USGov basis).

## The original dozen (subject — location — why)
Blood Falls (Antarctica, PD-NSF) · Deadvlei (Namibia, CC0) · Uyuni sky-mirror (Bolivia, PDM, **20.8MB→TUS**)
· Zhangye Danxia (China, CC0) · Arher dunes Socotra (Yemen, PD-self) · Moeraki boulders (NZ, PD-self) ·
Lençóis Maranhenses lagoons (Brazil, CC0) · **light pillars Sarny (UKRAINE, CC0 — the deliberate UA pin)** ·
starling murmuration Brighton (UK, CC0, 8160×6144) · sailing stone Racetrack Playa (USA, CC0) · Milky Way
over Grand Prismatic (USA, NPS-PD, 16.6MB→TUS — echoes our own night-sky render) · dumbo octopus @4000m
Mona Canyon (**open-ocean pin** — the surprise, NOAA-PD). Every continent + an ocean.

## Seeding-script facts (for `scripts/seed-demo-pins.mjs` — NOT built yet)
- Mimic the app's own path: preview ≤2048px via single-PUT `generateFileUploadUrl`
  (`uploadMedia.ts:62`), original via TUS when >10MB (`uploadMedia.ts:81`), then `POST /api/photos`
  with SavePinBody (`pinRecords.ts:31`): title/lat/lon/`isPublic:true`/`precision:"exact"`
  (world landmarks ≠ owner GPS; C6 not implicated), pose fields null. Auth idiom =
  `scripts/verify-listing-member.mjs`.
- **OWNER RULINGS (2026-07-17, all questions RESOLVED):** pins owned by **yevhens@wix.com** (must
  exist as a SITE member — site members ≠ Wix accounts; script-as-member OR elevated insert with
  explicit `ownerMemberId` looked up by email) · **ALL 12 listed for sale** (varied €5–15; needs the
  Phase-6.9 currency fix first so badges read EUR) · quota trap DISSOLVED by the new ruling **free 100
  / premium 1000** (supersedes D8 numbers; `PIN_QUOTA_FREE`→100 + new `PIN_QUOTA_PREMIUM`=1000) —
  seed AFTER the bump lands. Additional 6.9 scope from the same rulings: persistent UPGRADE
  affordance (headless plan-purchase flow = VERIFY via Wix MCP) · **MARKETPLACE top-right button**
  in the `.topnav` cluster (`index.astro:159-161`) + public `GET /api/market` browse panel ·
  **FAQ floating panel** with screenshots, built AFTER seeding (populated globe in shots;
  `public/faq/` assets → add to warm-prod-assets seed list).
- Wikimedia 429/403s bare user-agents → fetch SERIALLY with a descriptive User-Agent (twin of the
  warm-prod-assets lesson). fws.gov hard-blocks bots (403). photolibrary.usap.gov is NXDOMAIN —
  Commons mirrors are the live hosts.

## License hunt facts (don't re-hunt)
CC-BY/CC-BY-SA were REJECTED by design (no attribution debt on demo pins). Unfindable in PD/CC0 ≥1600px
ground-level: Socotra dragon-blood trees · Baikal turquoise ice · Catatumbo · Morning Glory roll cloud ·
volcanic lightning · fairy circles · Abraham Lake bubbles · penitentes · rainbow eucalyptus. Bench holds
10 verified alternates (aurora-over-South-Pole NOAA, Fly Geyser PD-self, CC0 bioluminescence Sweden (dim),
Kamchatka CC0, Giant's Causeway, Pamukkale, White Sands, Big Red jelly, mammatus, red crabs w/ watermark).

Related: [[project/wip-2026-07-16-phase6-marketplace-research]] · DECISIONS 2026-07-17 lines ·
`DEMO_CONTENT_SEED.md` · `NEXT_SESSION_PROMPT.md` §Do next.
