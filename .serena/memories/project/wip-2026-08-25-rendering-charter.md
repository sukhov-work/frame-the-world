# WIP 2026-08-25b — RENDERING CHARTER (design/prep; zero code) — bugs root-caused + audit reconciled

Owner order: park the BEST SPOT tails (T52/T49/T50); review + prepare the FPV fidelity audit for a
full autonomous implementation session (Opus 5 + workflows, ultracode), folding in four newly
reported bugs, mobile perf, and ULTRA fidelity/stability. **Deliverable = NEW
`.claude/claude-docs/rendering/RENDERING_CHARTER_2026-08-25.md`** (ladder RC0–RC30, owner A/B queue
AB1–AB7, do-not-do). Method: 7 parallel read-only agents (4 bug root-cause, 2 audit reconciliation
vs HEAD 1a486c9, 1 mobile/ULTRA inventory). Registry: NEW T54 (charter) · T38 CLOSED dated (all 3
sub-items already fixed at HEAD; NEW remainder = /m PiP full second render/frame → RC19) · T43
dated edit (implement from the CHARTER, not the audit §5). DECISIONS §Recent 2026-08-25b has the
full detail; this memory is the pointer + the four mechanisms.

## The four bugs (mechanisms pinned, fixes chartered)

1. **B1 Esri "Map data not available"** (→ RC5): HTTP-**200** placeholder JPEG — live-probed
   2,521 B byte-identical, ETag `"vvvvvvvvvvvvf"`, max-age 86400; Everest z19 coverage is a sub-km
   ISLAND (summit real, 100% unavailable 256–1024 tiles out ⇒ no static cap can work). The only
   fallback path is failure-only (`imageryGround.ts:332-343`); `force-cache` + `sw.js` pin the
   placeholder. Fix: construction-time `o.fetch` wrapper (aniso-stamp precedent) — detect
   fail-soft, fetch parent, crop quadrant, upscale (placeholder never draws) + sw.js sentinel
   carve-out + once/session `cache:"default"` heal. TRAP: overriding `calculateLevel` instead —
   lock/release recompute it as a default arg; a moving cap table makes
   `DataCache.releaseViaFullKey` THROW.
2. **B2 totality square** (→ RC1): corona outer power law (no compact support, ~0.003 linear
   truncated at the sun-quad edge) + unconditional ±1/256 dither with NO discard in the sun
   fragment (`sky.ts:253,266`; quad = `sunGlowExtent 7` disc radii). Visible only near max
   eclipse (`eclipseK`→0.04 AND `tot>0`). Bloom exonerated by arithmetic. Fix: radial
   window-to-exact-zero + epsilon discard (`stars.ts:168-171` idiom; moon precedent
   `sky.ts:399-400`) + CPU-twin test. Same class in `skyTarget.ts`.
3. **B3 sunset snap** (→ RC2 + AB1): `castShadow` BOOLEAN at sun elev +0.46°
   (`SHADOWS.minSunElevSin 0.008`, `StylizedTiles.ts:4024/:4068`) fired at the key's daily max
   2.025; sun→moon switch is a same-frame FLIP (model = Krisciunas–Schaefer, NOT "Kasten & Young");
   with no qualifying moon the sun key NEVER dies (no elevation term — walls lit all night at
   1.5). ULTRA shares the gates. ENABLER (source-verified three 0.185): **`shadow.intensity` is a
   live uniform** (`WebGLLights.js:289/343`) reaching building shadows + ground twins in one
   write ⇒ RC2 = smoothstep fade over the last ~3° + moonlight handoff lerp. The "real dusk"
   package (band curve to baseline + key elevation term + phantom-night-key) is owner A/B AB1 —
   the frozen night look DEPENDS on the phantom key.
4. **B4 shadows off / partial** (→ RC3+RC4): `!!focusHit` gate survived ULTRA verbatim
   (`StylizedTiles.ts:4023`; discarded fallback at `:3107-3110`); ortho box (centre = ellipsoid
   hit, extent `clamp(alt·K,1600,cap)`) covers the viewer's foreground only at pitch ≥ ~59°
   base / ~42° ULTRA — INDEPENDENT of altitude; outside the box = fully lit hard edge (r185
   returns lit outside [0,1]). Stamp/streaming theories RULED OUT (terrain-cast stamp-at-load
   correctly wired). RC3 = gate kill + surface-projected eye fallback (XS; raw-eye fallback would
   put base-profile receivers beyond `far` — project to surface). RC4 = rig-only `_shadowFocus`
   (never re-point `_focus` — consumer sweep done), extent from view distance. Terrain casting
   outside ULTRA = design question AB7.

## Reconciliation headlines (charter §1 is the authority)

- #1/#9/#16-tracking shipped **ULTRA-gated** (T44/T45); baseline halves = A/B queue, fenced by
  the ULTRA off-state exactness contract + byte-identical-`high` + `fences.test.ts:212-308`.
- **Audit S10 REFUTED** on desktop: imagery availability-capped (errorTarget 0.05 → zero extra
  tiles, `tuning.ts:584-587`). Do not build.
- S12 → "generalize the shipped `ultraTileLevers` edge seam" (`quality.ts:154-162`), don't
  re-invent in GlobeCanvas.
- Depth ladder surface now **22 raw-ShaderMaterial instances / 14 modules** (+3 `bestSpotSheet`,
  −skyTrail from the audit's list).
- Seat/bake gaps #2–#8/#11/#13 byte-equivalent; anchors moved (heightAt now
  `imageryGround.ts:689-699`, pickGround `StylizedTiles.ts:1112-1114`, walk apply `:3036`, gate
  `:4023`, rig `:4074-4111`). Bake scope ×3 (st-albans).
- NEW: ULTRA×eclipse haze seam (haze never scaled by `eclipseK` → RC23) · dome seam confirmed
  (`atmosphere.ts` reads no band uniform → RC24) · chip-flip reload state surfaced nowhere (RC26)
  · GTAO would silently couple to the ULT tier pin if enabled (RC27 records the decision).
- M3 answered (maxAniso 16); M5 still THE §1.3 separator and orders Group C/D.

## Session shape that worked

7 agents in one message, each returning ## Findings with file:line + Confidence + Gaps; two
reconciliation agents specifically re-anchoring only LOAD-BEARING lines (not every citation).
B1's agent live-probed Esri endpoints (tilemap + placeholder bytes) — probing external services
from a research agent paid off. All mechanisms are source-computed, browser confirmation folded
into each slice's proof-of-done rather than claimed.

Related: `mem:core` · `mem:project/wip-2026-08-22-ultra-track` (gate contract, three facts) ·
`mem:project/wip-2026-08-22-eclipses` (sky.ts state) · backlog T54/T43/T38 ·
`rendering/RENDERING_CHARTER_2026-08-25.md` · DECISIONS 2026-08-25b.
