# Tracked backlog — the ONE debt/tails registry (durable; git-tracked)

Seeded 2026-08-13 from the carried tails (NEXT_SESSION_PROMPT is gitignored — THIS file is the
durable copy; the prompt mirrors it). Rules: dated rows; one row per item; audits VERIFY rows
(status changes land here with evidence), never re-discover them; closing a row = a dated state
edit, never a deletion. New debt found anywhere lands here the same session.

| ID | Since | Item | Pointer | State (dated) |
|----|-------|------|---------|---------------|
| T1 | 2026-08-13 | M0 real-device DEEP check (perf/memory/fps numbers on iPhone + Pixel; owner eyeballed the bare `/m` view OK 2026-08-13) | MOBILE_PLAN §6 M0 | OPEN — preliminary owner pass; numbers unmeasured |
| T2 | 2026-08-13 | Release canaries: `/m` served in prod + `/_wix/pages.json` lists it; `/api/sbdb` first egress | NEXT_SESSION_PROMPT §1 | OPEN — rides next `wix release` |
| T3 | 2026-07-17 | Prod login `#p=` hash round-trip smoke (fallback `?p=` + normalize) | DECISIONS 6.9 line | OPEN |
| T4 | 2026-07-17 | Phase-6 DoD tail: one real purchase loop (owner manual dashboard step) + premium plan rename | IMPLEMENTATION_PLAN §6/§6.9 | DEFERRED post-M6 — owner ruling 2026-08-13: skip for now, push long after M6. 2026-08-13 audit: the "Pricing Plans app install (`APP_NOT_INSTALLED`)" sub-item was DONE 2026-07-17 (DECISIONS: installed by owner, plan `5874dba8-…`) — row corrected |
| T5 | 2026-07-17 | Ground CHECKERBOARD + flicker 1500→200 km (owner screenshot-evidenced) | mem:bugs/ground-checkerboard-flicker | OPEN — plan drafted |
| T6 | 2026-07-14 | Owner A/B verdict BLD chip (CLASSIC vs OSM2WORLD); if o2w wins: draco 23× + untagged-height defaults | mem:project/wip-2026-07-14-osm2world-adapter | OPEN — both live on R2 |
| T7 | 2026-07-14 | HLOD coarse tier (enriched bbox building-empty above ~20 km) | dnipro-enrichment/DNIPRO_3D_ENRICHMENT_PLAN.md | OPEN |
| T8 | 2026-07-14 | dayArcs skyline fold (seam: `planFeed.profileSample()`; 2026-08-14: second seam `store/plan.profileBins` + `sampleBins` — rail-context half LANDED via the §3.1.D trace; the 3D dayArcs fold itself remains) | mem:project/wip-2026-07-14-pass3-obstruction-moat | OPEN — rail half done |
| T9 | 2026-07-14 | WS4-D subject shadow timeline | same memory as T8 | OPEN |
| T10 | 2026-07-12 | GTAO tune/enable + Pass-1 tier A/B on a weaker box | rendering/RENDERING_QUALITY_PASS.md | OPEN — GTAOPass wired default-OFF |
| T11 | 2026-08-10 | Astro taste-pass: `SKY_TARGET.ringGain` 0.55 · `ASTERISMS.highlightAlpha` 0.55 · `STARS.bvTintAmount` 0.6 · TRAIL weight/alpha | DECISIONS 2026-08-10 | OPEN — owner taste |
| T12 | 2026-08-10 | Galilean-moon points on the Jupiter disc (render-table wish) | archive/ASTRO_ENGINE_PLAN.md | OPEN — unbuilt |
| T13 | 2026-08-10 | WATCH: one non-converged FPV auto-aim glide during rapid consecutive re-tracks (not reproduced in isolation) | DECISIONS 2026-08-10 | WATCH |
| T14 | 2026-07-21 | Vite dep-cache staleness after wix-dev restart (chunks 504 "Outdated Optimize Dep"; move `node_modules/.vite` away + restart) | NEXT_SESSION_PROMPT tails | DOCUMENTED workaround — no fix planned |
| T15 | 2026-07-15 | SavedPlaces transient Wix Data WDE0054 watch | DECISIONS 2026-07-15 | WATCH |
| T16 | 2026-07-15 | Milky-way 8k ≈ 134 MB VRAM on DESKTOP (mobile solved 2026-08-13 via 2k tier; desktop 4k fallback parked) | tuning MILKYWAY notes | OPEN — parked |
| T17 | 2026-07-10 | Esri + CARTO + OpenFreeMap ToS = accepted POC risks; re-check before commercial release | ARCHITECTURE §9 | ACCEPTED RISK — dated |
| T18 | 2026-07-14 | grid-10 orphan R2 keys (harmless leftovers) | mem:project/wip-2026-07-14-osm2world-adapter | OPEN — cosmetic |
| T19 | 2026-07-12 | Street-label occlusion vs buildings (oblique smear accepted v1) | S7 digest | ACCEPTED v1 |
| T20 | 2026-07-12 | One-off dark streak 1.3 km (phase55-53, unreproduced) | DECISIONS S7 batch | WATCH — unreproduced |
| T21 | 2026-07-10 | Mid-range-phone ARW decode benchmark + peak WASM heap (empirical-validation carry) | IMPLEMENTATION_PLAN §Empirical validation | OPEN — pairs with T1 |
| T22 | 2026-07-12 | README demo URL still omitted (contest rewrite deliberately withheld it) | README | OPEN — owner call |
| T23 | 2026-08-13 | Author `conventions/contracts.md` (Hyrum contract-strings inventory) | checklists/docs.md item 11 | CLOSED 2026-08-13 — authored by audit #1 (`conventions/contracts.md`); later audits diff it |
| T24 | 2026-08-13 | astro@5.18.2 carries 5 XSS advisories with fixes only in 7.x (C4 pins Astro 5); audit #1 verified ZERO reachable sinks (no define:vars / server islands / element spread props / transition:* in any .astro file — all dynamic UI is client:only React) | audits/audit-full-2026-08-13.md §Gates | ACCEPTED RISK — dated; re-check on ANY .astro growth or new advisory |
| T25 | 2026-08-13 | Point/ellipse sky-target impostor RENDER never eyeballed (ring widening + tracked-DSO flows verified 08-03/08-10; no shot of the point/ellipse treatments themselves) | archive/ASTRO_ENGINE_PLAN.md:166 + audit finding C2/D8 | CLOSED 2026-08-13 (Phase 8a browser pass) — POINT eyeballed on the new GC target (broken-hairline ring + faint point, verify-shots/phase8a-09-gc-reticle-crop.png) · ELLIPSE eyeballed on M31 at real 178′×70′ extents + widened ring (phase8a-10-m31-ellipse-crop.png), both in FPV headed Chrome |
| T26 | 2026-08-13 | `/api/upload-url` unbounded: no `sizeBytes` cap / mint rate limit / quota linkage (auth required; media storage is the one unmetered write surface) | audit finding B9 | ACCEPTED RISK — owner ruling 2026-08-13: stays unbounded (auth suffices for this stage); re-open only on abuse evidence or commercial release |
| T27 | 2026-08-13 | B2 tail: `frame-p5-tester` password rotation (old value in git history) | audit finding B2 | WON'T-FIX — owner ruling 2026-08-13: ignore (test-only member, no privileged data); re-open only if the account gains privileges |
