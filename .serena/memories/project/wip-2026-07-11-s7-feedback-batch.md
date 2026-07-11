# 2026-07-11 — S7 owner-feedback batch — SHIPPED (all tiers green)

**Status: DONE. astro check 0 · 356 vitest (+17) · wix build green · browser-VERIFIED via
Playwright MCP on wix dev (shots `verify-shots/s7fb-01..08`) · S5 night golden gate PASS
(night sky 2/5.9/11 ≈ baseline · K&S 10.3% · moon-shadow source switch intact).**
Owner feedback on S7: laggy/jumping street names → pin on mesh · add street lines + basic vector
terrain · ground jarringly black → uniform sun/moon light · low-alt day haze too white · tips +
info badges across the UI. DECISIONS.md "2026-07-11 (latest)" line is the full record.

## (1) Street names v3 — GL, pinned to the mesh (scene/streetNames.ts REWRITTEN)
- Root cause of v2 lag/jump: DOM restyle every 3rd frame vs 60 Hz mesh + screen-space
  re-selection reshuffle + one-shot terrain reseat snap. v3 kills it structurally: canvas-texture
  quad per street name LYING ON terrain in the anchor tangent plane, rotated along the street —
  rendered by the same composer frame ⇒ cannot lag.
- Float32: unit-plane geometry + ECEF only in mesh.matrix (CPU float64 modelView) — the
  PhotoFrustum lesson; per-mesh path does NOT need Pins-style camera anchoring (that trap is
  for float32 instanced ATTRIBUTES).
- **TRAP (cost a debug cycle): a stored per-entry basis vector aliased the module `_v` temp →
  matrices corrupted to ~1.1e9 scale when the temp was reused. Entry-owned vectors must be
  FRESH allocations, never module temps.** Diagnosed live via matrix column magnitudes.
- Text = WORLD metres: STREETS.textHeightM [22,15,11] by rank tier (road paint, optically
  scales). Canvas: 44 px, resolve `--font-ui` via getComputedStyle for ctx.font, bg halo baked
  (shadowBlur), SRGBColorSpace, aniso 8. Selection: dedupe-by-name → rank → WORLD minSep 130 m
  @ 20-frame cadence, maxVisible 40. Terrain seat lazy + EASED (reseatEveryFrames 240, ε 2.5 m,
  amortized 2 raycasts/frame round-robin). Per-frame: opacity + hysteresis upright-flip
  (`uprightFlip` pure, flipHysteresis 0.08 — flips 180° about the normal, dead band kills
  flicker on the street axis). FPV/welcome: group hidden (presence 0 > 2.5 km anyway).

## (2) Vector web — vectorTiles.ts (shared source) + vectorFeatures.ts (step 39)
- `scene/vectorTiles.ts`: ONE fetch/parse per OpenFreeMap z14 tile now RETAINS geometry and
  feeds names AND features (v2 threw geometry away). Parses transportation_name (labels),
  transportation (class + brunnel; class must be a key of VECTOR.roadWidthM to render —
  transit:0 filters), waterway, water/landcover(grass/wood/park…)/park polys. Ring winding:
  MVT y-down ⇒ CW = positive shoelace = OUTER (`ringArea` pure). Probe: 3×3 ring = 903 KB
  decoded, ~21k line verts — trivial. tileCacheMax 40 (VECTOR), version() bump per parse.
- `scene/vectorFeatures.ts`: ribbons with REAL metre widths (`ribbonStrip` pure — averaged
  vertex dirs, ±w/2, 2 tris/segment; motorway 22 → path 2, waterway river 12), fills via
  THREE.ShapeUtils.triangulateShape (holes ok, try/catch degenerate rings). Per-tile LOCAL
  tangent frame (E/N/U at tile centre; geometry local, anchor in mesh.matrix — float32-safe;
  exact because locals come from full ECEF differences, not a flat projection). Terrain: lazy
  6×6 heightAt lattice, bilinear (`bilinearHeight` pure, NaN→0), 8 raycasts/frame budget,
  cursor only advances on non-null, build flat immediately → ONE rebuild when lattice done.
  Bridges +6 m + tokens.vecBridge; tunnels skipped. Presence 15→8 km; ring 2 above 4 km.
  Night dim `nightDimFor` (smoothstep −0.12→0.05 over sin sun elev, floor 0.45) — unlit map
  ink must not glow at night. Two shared materials (fills −2 polyoffset / ribbons −3),
  vertexColors, depthWrite off, renderOrder fills 1 < ribbons 2 < labels 3; raycast noop
  everywhere (heightAt + controls must never hit ink).
- 5 new tokens (tokens.css + lib/theme/tokens.ts): vecRoadMajor #A7B4C4 · vecRoadMinor #5F6B7A
  · vecWater #3E6E96 · vecGreen #2E4A3A · vecBridge #C6D2DE.

## (3) Ground illumination (imageryGround grade rework)
- dayK/night/golden gates now read GEODETIC up (`sunUpDot = dot(normalize(vFtwW), sun)`) —
  solar elevation, not slope; a noon hillside no longer falls to the night floor. Slope relief
  stays via dayShade off the real normal (floor dayGradMin 0.78).
- ADDITIVE terms (dark pixels can't multiply to black): uFtwAmbDay = skyHorizon ×
  GROUND.ambientDayK 0.1 · night ambient uFtwAmbNight 0.012 × moonlight colour · NON-albedo
  moon fill GROUND.moonFillK 0.5 × uFtwMoonGlow × moonUp × night. All × (1 − uFtwHiAlt) so the
  orbital fade band stays continuous with the base. Both uniforms live via __globe.groundUniforms.
- DRAPE softened: nightFloor 0.52 · shadowOpacity 0.62 · moonShadowOpacity 0.5 (the 0.9
  near-black footprints were half the complaint).

## (4) Low-alt haze (atmosphere sky regime)
- Old horizon budget ≈ 1.2 additive > BLOOM.threshold 0.9 → bloom spread the white-out.
- Now: horizon anchor = mix(skyDay, skyHorizon, skyHorizonWhiteness 0.55) · hazeCol pulls blue
  (skyHazeBlue 0.35) · skyHorizonGain 0.16 · falloff 0.075 · very-low-alt dim ramp hazeLowAltK
  0.45 (300 m → 6 km). **Guard: test/components/globe/skyBudget.test.ts = JS twin of the shader
  horizon sum, asserts < BLOOM.threshold at every altitude — keep in sync with atmosphere.ts.**

## (5) UI tips (sub-agent, fenced to panels/ui/styles + index.astro)
- `styles/tips.css`: `.tip[data-tip][data-tip-pos=left|right|up|down]` → ::after glass pill
  (color-mix bg 78%, mono 9.5px, 0.38 s reveal delay, :focus-visible, reduced-motion, :active
  duck). ABSOLUTE positioning ⇒ the backdrop-filter containing-block trap is moot (fixed-layer
  tooltips would hit it). Inputs can't host pseudos → `span.tip.tip-wrap` wrapper.
- `ui/InfoDot.tsx` (13 px "i", role=note, tabIndex 0) — flow-level explanations.
- 32 tips + 5 InfoDots: CameraTiltPanel (8 + dot; new .ct-head header row) · TimeScrubber (5 +
  dot) · LocationFinder · PhotoDetailPanel (10 + provenance dot; panel is LEFT-docked, has
  overflow-y:auto → tips up/down, never side) · UploadFlow (5 + 2 dots) · MyPins · nav (2).
  4 native titles migrated off. Copy verified against real behavior.

## Also
- LABELS.syncEveryFrames 2→1 (city labels every frame — cheap, kills the same lag class).
- welcome.css `.street-labels` rule dropped (layer no longer DOM).

## Verify recipe used
- wix dev + Playwright MCP: real canvas click dismisses welcome → `__timeStore.setTime` +
  `__cameraStore.requestFly/setTargetZoom/setTargetTilt` → shots. Label census: traverse scene
  for `material.map.isCanvasTexture`. Golden gate: Chrome `--headless=new
  --remote-debugging-port=9333` + node24 `scripts/verify-s5-night.mjs` → PASS.

## Carried / follow-ups
- STREETS.textHeightM + VECTOR.{fill,line}Opacity are taste knobs — owner visual pass pending.
- Vector web + labels also show in SAT mode (may want dark-only — one `enabled` gate away).
- Landcover green near-subliminal by design; label-over-building occlusion now natural
  (depthTest on) — the S7 "labels draw over buildings" follow-up is RESOLVED by the GL move.
- S1–S7 + this batch still NOT released to the live URL (pre-release gate: /api/ping canary).

## Batch #2 (2026-07-12) — river flicker + URL pose — SHIPPED (377 vitest · astro check 0 ·
wix build · browser-VERIFIED, shots s7fb-09..14; DECISIONS 2026-07-12 line is the full record)

### River/water flicker — FOUR stacked causes, all fixed in vectorTiles/vectorFeatures
1. MVT BUFFER overlap: neighbor tiles drew the same water twice → translucent z-fight at seams.
   Fix: clip geometry to the exact tile square at parse — `clipRingToBounds` (Sutherland–Hodgman)
   + `clipLineToBounds` (Liang–Barsky, splits on re-entry). Shared-edge lattice knots sample the
   SAME lon/lat → neighbors meet crack-free.
2. Ring-exit dropped builds → pop in/out on pans. Fix: builds PERSIST; evict only past
   VECTOR.maxBuilds 48, farthest-from-focus, never in the active ring.
3. Flat ellipsoid-0 pre-build flashed then jumped. Fix: build only when the lattice is complete.
4. THE DEEP ONE: (a) a lattice sampled mid-refinement bakes coarse heights → fill lands metres
   UNDER the final terrain (reads as missing/flickering water); (b) knots OUTSIDE the frustum
   return null FOREVER (terrain tiles exist only in-frustum — S2 lesson) and stalled whole tiles.
   Fix: cursor SKIPS unanswerable knots (NaN → mean-of-answered at pass end; all-NaN → retry),
   and a PRE-BUILD STABILITY GATE — two consecutive lattice passes must agree within
   refreshEpsM 3 m before the first build. Tiles appear exactly ONCE, seated right, and stay.
   Post-build refresh (refreshEveryFrames 240, one tile/cycle, rebuild only on ≥3 m drift, old
   geometry stays up meanwhile) converges tiles on descent. liftWaterM 3.5.
   TRADE-OFF (accepted): newly-entered tiles appear progressively ~1–3 s (verification cost).

### URL pose (share + reload-safe + welcome skip)
- `lib/geo/urlPose.ts`: `#p=<focusLat>,<focusLon>,<camAltM>,<headingDeg>,<tiltDeg>`
  (5 dp / 1 m / 0.1°); formatPoseHash/parsePoseHash/wrapLon pure; malformed → null; 14 tests.
- Write: step-23 mirror block, ORCH.urlPoseEveryFrames 96 (~1.6 s — Safari rate-limits history
  calls), history.replaceState only, on-change only, SKIPPED while welcome/Explore/FPV/flight
  owns the camera (fpv pose intentionally not written v1).
- Boot restore: StylizedTiles parses the hash → reconstructs the camera via arrivalPose
  (approachHoriz = −(sin h·east + cos h·north); groundAltM 0 at boot) instead of the LEO pose.
  Welcome.tsx initial-states hidden on the same hash → no welcome, no Explore over a shared view.
- Live round-trip verified EXACT: reload landed focus 48.4720/35.0650 · alt 2786 · hdg 47.3 ·
  tilt 52.1 from `#p=48.47200,35.06500,2793,47.3,52.1`.

Related: [[project/wip-2026-07-11-phase5.5-s7]] · [[patterns/globe-rendering]] ·
[[patterns/sky-bodies-terrain]] · DECISIONS 2026-07-11 (latest) + 2026-07-12 lines.
