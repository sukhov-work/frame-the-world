**ARCHIVED (2026-08-15)** — superseded by scripts/bake/README.md (city-onboarding runbook) + DECISIONS 2026-07-18 line.

# WIP 2026-07-18 — CITY #2: St Albans OSM2World variant (baked + R2 LIVE, Dnipro untouched)

`/frame` implement. Owner ask: "local-backed highest-fidelity (osm2world) variant for St Albans
(51°45'05.5"N 0°19'32.4"W) without disrupting Dnipro — both available", then "publish to R2 fully
prod-ready + generic docs". Gates: **vitest 596/596 (+2) · astro check 0 err/0 warn ·
browser-verified in headless system Chrome** (Playwright MCP absent). Dnipro bakes, caches,
prefixes and the default runtime path: byte-identical/untouched throughout.

## What shipped
- **`scripts/bake/cities/st-albans.json`** — base config: bbox `[-0.3692, 51.7244, -0.2821, 51.7787]`
  (~6×6 km centred on the owner's coords 51.75153/−0.32567; covers cathedral/centre, Verulamium,
  Marshalswick), grid 6 (≈1 km cells — the proven streaming granularity), UK-tuned extruder
  `classDefaultsM` (house 7 / terrace 8 / apartments 15, roofPitch 0.5), vegetation (maxTrees 60k),
  `exclusion.polygons: []` (built-in sensitive-tag blocklist still applies — C6 is Dnipro-specific
  but the blocklist is prudent everywhere). Enables a future classic bake (`npm run bake -- --city
  st-albans`) — NOT run yet.
- **`scripts/bake/cities/st-albans-o2w.json`** — `extends: st-albans`, output
  `bakes/enriched/st-albans-o2w`, version `st-albans-o2w-1`, osm2world block copied from dnipro-o2w
  (lod 2 · xmx 4 GB · **subGrid 2** → four ~3×3 km extracts · same excludeModules ·
  same dropClassesRegex incl. PoleFence/ChainLinkFence — UK gardens fence-map heavily too).
- **NEW TRAP FIXED — o2w work-cache cross-city collision** (`bake-osm2world.mjs`): `safe-*.osm` /
  `o2w-*.glb` / `convert-*.log` under `.cache/o2w/` are keyed by SUB-GRID INDEX ONLY ("0-0"…);
  raw Overpass extracts are bbox-keyed but the safe/glb mtime chain was not → city #2 would
  overwrite city #1's convert cache, and a later Dnipro re-bake would silently REUSE St Albans'
  safe-0-0.osm (exists + raw cached → rewrite skipped). Fix: `workDirFor(cfg.city)` →
  **`.cache/o2w/<city>/`**; Dnipro's 49 files `mv`'d into `.cache/o2w/dnipro-o2w/` (mv preserves
  mtime → its 16 converts stay cached). NEVER flatten the dir back.
- **Runtime cross-city bbox seam** (default byte-identical, +2 tests):
  - `tuning.ts` ENRICHED gains **`variantBboxes`** (`"st-albans"` + `"st-albans-o2w"` → the config
    bbox verbatim, `satisfies GeoBbox` inside the `as const` — the same idiom as `bbox`).
  - `enrichedVariant.ts` gains pure **`resolveEnrichedBbox(defaultBbox, search, variantBboxes)`**:
    listed variant → its bbox; no-param / unknown (dnipro-o2w) / off / verbatim-URL → `defaultBbox`
    ITSELF (identity — tests assert `toBe`). Type-only `GeoBbox` import from `enrichedMask`.
  - `StylizedTiles.ts` boot: ONE `enrichedBbox` const wired at the three former `ENRICHED.bbox`
    sites — `attachBuildings.maskBbox`, `attachEnrichedBuildings.bbox`, `attachPlanFeed.maskBbox`.
  - **BLD chip unchanged** — `ENRICHED_VARIANT_NAME="dnipro-o2w"` hardcoded; St Albans (and any
    future city) is `?enriched=<name>` URL-param-only until a city picker exists.
- **Docs:** bake README §"Onboarding another city (generic flow — worked example: St Albans)"
  (5 steps: configs → variantBboxes entry → bake → dev view → publish/verify) + §Hosting cross-ref;
  root README "Where to look next" pointer line.

## Numbers (LOD 2, 6×6 km, ~4 min cold end-to-end)
36/36 cells · 26,102 features = 25,424 Building + 678 constructions (Hedge 190 · Wall 179 ·
NodeModelInstance 67 · Powerpole 59 · StreetLamp 50 · Railing 49 · MobilePhoneMast 22 · Billboard 18 ·
Flagpole 12 · misc 32; dropped PoleFence 232 + ChainLink 6) · 21,814 trees (points 536 · rows 172 ·
wood 17,167 · park 3,939; cap 60k not hit) · 1.73M verts · **49.52 MB** · maxH 46 m
(cathedral-plausible) · MB/cell max 4.84 (2,2) · median 1.09. Extracts 25–56 MB raw · converts 5–13 s.
Handedness vote: north=−Z 25,424/25,478 (spike convention holds). Manifest:
`bakes/enriched/st-albans-o2w/bake-manifest.json`.

## R2 (LIVE)
`upload-r2.mjs --city st-albans-o2w` → **38 files / 47.24 MB → `enriched/st-albans-o2w/`**
(Worker untouched — path-agnostic). curl-verified: tileset 200 + `access-control-allow-origin:*`,
glb `glTF` magic, `enriched/dnipro/` still 200. Free tier: bucket now ≈ 400 MB of 10 GB.

## Browser verification (headless system Chrome — Playwright MCP was down)
Recipe that works: `"Google Chrome" --headless=new --use-angle=swiftshader --window-size=1600,900
--virtual-time-budget=60000 --user-data-dir=/tmp/x --screenshot=… "<url>"`. **TRAP: under the
sandboxed Bash tool Chrome dies SIGKILL (exit 137) — needs sandbox off.** npx playwright is
unusable here (npm registry blocked). Shots:
- `verify-shots/stalbans-o2w-01-city.png` — `?enriched=st-albans-o2w#p=51.7515,-0.3257,900,0,50`:
  dense o2w terraces + park tree scatter, seated, position readout 51.7418/−0.3257, no z-fight.
- `…-02-off.png` — same pose `?enriched=off`: no enriched geometry (source swap proven).
- Dnipro-default control shot did NOT finish (SwiftShader + the 20×20 km bake is too slow headless)
  — Dnipro regression is covered by the identity unit tests + untouched artifacts instead.

## Prod-readiness (the one remaining step)
Tiles are LIVE on R2 and the RELEASED app already streams them (`resolveEnrichedUrl` segment-swap
shipped 2026-07-14) — but the **`variantBboxes` mask entry ships only with the next commit +
`wix release`**; until then prod masks the DNIPRO box while streaming St Albans (stock OSM
z-fights there). Dev is fully correct now.

## Scalability notes (owner asked)
Per city: +1 config (+1 optional -o2w), +1 `variantBboxes` entry (code → needs a release), one bake,
one upload; Worker/dev-middleware/upload are already city-agnostic; caches per-city. Linear-growth
levers when cities multiply: read the bbox from `bake-manifest.json` at runtime instead of the
hardcoded map (kills the code-change-per-city + release coupling), a city picker UI (generalize the
BLD chip / ENRICHED_VARIANT_NAME), draco (49 MB→~2 MB class), R2 10 GB free ≈ 20× Dnipro-scale or
200× St-Albans-scale cities.

Related: `mem:project/wip-2026-07-14-osm2world-adapter` (the variant machinery) ·
`scripts/bake/README.md` §Onboarding another city · DECISIONS 2026-07-18 line.
