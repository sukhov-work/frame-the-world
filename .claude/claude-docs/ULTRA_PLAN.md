# ULTRA PLAN — the desktop-only experimental fidelity track

> ## AS BUILT — 2026-08-22j. **THE WHOLE PLAN SHIPPED.** Everything below is the CHARTER as
> authored; this block records what actually happened to it. Full account: DECISIONS 2026-08-22j ·
> `mem:project/wip-2026-08-22-ultra-track`. Gates: vitest 1,330/1,330 · astro 0 err/5 hints ·
> knip exit-0 · `scripts/verify-ultra.mjs` **28/28**.
>
> **The owner lifted the frame-rate ceiling**, which is what made §2's construction-time levers
> shippable: *"even if it is sub 15FPS but graphics fidelity improves and gives nicer richer
> picture — worth it, user enables it in it's own volition anyways."* This **supersedes §2's
> "a 12 fps ULTRA is a broken feature"**. Measured: city OFF 30.7 ms → ON 36.1 ms (+18%).
>
> **The open question in §1 is answered:** both halves folded under `ULT`, no separate HQ chip.
>
> **THE PLAN WAS WRONG ABOUT ITS OWN S2.** `PCFSoftShadowMap` is dead code in three 0.185 —
> intercepted and rewritten to `PCFShadowMap`, with no shader branch left. Shipping S2 as written
> would have been a no-op. The r185 soft-shadow lever is `shadow.radius` on a 5-tap Vogel disk
> rotated per pixel, and it is a LIVE uniform — so S2 became cheaper AND edge-applied.
>
> **Four more findings the charter could not have known**, all source-verified: `shadow.bias`'s
> unit is a FRACTION of the shadow camera's depth range (ULTRA's 96 km range would have turned the
> shipped −2e-4 into −19 m of peter-panning) · terrain casting fails SILENTLY without
> `shadowSide = FrontSide` · `mapSize` is LATCHED, so a live set is a no-op (the boot-read §2
> sanctions is not optional, it is the only way) · a directional shadow target costs 2× a
> depth-only reading, so 8192² is ~512 MiB, not ~268 MB.
>
> **S1 CSM, PCSS, VSM and S8 GI: all REJECTED with reasons in DECISIONS.** The headline reason CSM
> was not needed: the shadow ortho already rides camera altitude, so street level clamps to 1.6 km
> (0.39 m/texel at 8192²) while a mountain view spends the same texels on 11 km of relief — an
> altitude cascade, for free.
>
> **Open tails (owner taste, not defects):** the `dayCurve` civil anchor 0.30 keeps the ground
> bright at civil twilight · **the sky DOME was not touched**, so a warm ground haze meets the old
> blue-grey dome at golden hour (a mild seam; `scene/atmosphere.ts` was outside this slice) · the
> capped mip chain of §1b step 2 · `ULTRA.shadowMapSize` is the VRAM rollback knob.

Authored 2026-08-22i as the handover for the NEXT session. Owner order, verbatim intent:

> Bring crisp 3D high-fidelity textures to the tilted view — *"the visual difference between 2d
> and tilted is huge (at least subjectively), it is less resolution, and very grayish, you know
> what i mean"*. Then push the shadow game to the limit in ULTRA: much crisper, more physically
> accurate building shadows; better sunrises/sunsets/moonlight; and **terrain casting shadows**
> ("should produce amazing looks in high mountain regions").

**THE STANDING RULES FOR THIS WHOLE TRACK** (owner, repeated three times across two sessions):
desktop ONLY · experimental · opt-in · **off by default** · **zero disruption to production
defaults** · **zero effect on mobile pipelines or stability**. Everything below hangs off the
existing `ULT` chip and its one gate. If a change cannot be made inert when the chip is off,
it does not ship.

---

## 0. What already exists — do not rebuild it

| Thing | Where | Note |
|---|---|---|
| `ULT` chip, pref, store field, persistence | `CameraTiltPanel.tsx` · `lib/prefs.ts` · `store/camera.ts` | shipped + verified 2026-08-22i |
| **THE GATE** — `hqAllowed = !isMobileShell && !coarsePointerShell` | `StylizedTiles.ts` (beside `isMobileShell`) | the ONE fence. Prefs blob, store and GlobeCanvas are all SHARED across shells, so hiding UI isolates nothing |
| `QUALITY.ultraDesktop` override profile + `ultraTileLevers` / `lruCapBytesForUltra` | `tuning.ts` · `lib/globe/quality.ts` | off returns its input BY IDENTITY — extend this object, never `QUALITY.tiers` |
| Tile-lever edge apply (`stepUltraGate`) + FPV-deferred tier pin | `StylizedTiles.ts` · `GlobeCanvas.tsx` | already handles the "governor fights the pin" problem |
| DEV probes | `__globe.ultra()` · `__globeQuality.ultra` · `__overlayRebuilds` | `ultra()` prints `{allowed, coarsePointer, pref, on}` — the mobile-fence proof in one line |
| Source fence | `test/components/globe/fences.test.ts` | pins WHICH files may name the flag AND that every engine read is gated. Adversarially verified to fail |

**Read first:** `rendering/FPV_FIDELITY_AUDIT_2026-08-22.md` (26 ranked gaps, 43 survived
adversarial refutation, 14 open measurements) · backlog **T43** / **T44** / **T45** ·
DECISIONS 2026-08-22h + 2026-08-22i.

---

## 1. THE TEXTURE HALF — why the tilted view looks worse, in two separable parts

The owner's two words are two different mechanisms. **This is the finding that unblocks the
whole thing — the previous attempt failed because it went after a third mechanism that turned
out not to exist.**

### 1a. "very grayish" = the PHOTOGRAPHIC GRADE, and it is separable from day/night

The flat 2D chart looks bright because `uFtwFlat2d` drives **two** effects in the ground
fragment shader, and they are independent:

```
imageryGround.ts:372   dayK  = max(dayK, uFtwFlat2d);                    // forces DAY grading
imageryGround.ts:377   photo = uFtwFlat2d * uFtwPhotoK * (1 - uFtwDark); // the photographic DE-GRADE
```

- **`photo`** (strength `GROUND.flat2dPhotoK = 1`) is the "not gray" one: at 1 it sets shade→1.0,
  desat→0, gain→1.0, cast→neutral — i.e. raw Esri colorimetry instead of the stylized grade.
- **`dayK`** is the one that would be a C2 breach in 3D: forcing it lights the night side in
  daylight **while the buildings keep the sun/moon key**, deleting the terminator, golden hour
  and moonlight. That incoherence is why the last attempt refused the "bright" half wholesale.

**The move: drive `photo` from a NEW uniform (e.g. `uFtwPhoto3d`) that ULTRA raises, and leave
line 372 alone.** Then the ground de-grades toward photographic while day/night, terminator and
moonlight stay exactly real. Judge `flat2dPhotoK`-equivalent strength on device — a partial lerp
(0.5–0.7) may read better in 3D than the chart's full 1.0, because buildings are still graded.

> **TRAP — the injected-GLSL header.** A uniform added to `shader.uniforms` but NOT declared in
> the fragment header block (`imageryGround.ts:326-353`) is a **silent compile failure**: the
> previous program keeps rendering and every poke is a no-op. Declare it in both places.

### 1b. "less resolution" = ANISOTROPY, not tile depth. This is measured and settled.

**Do not re-attempt a refinement lever.** 2026-08-22i built one in full and measured it inert:

- Zero extra tiles at 895 m AND at 5,969 m tilted 72°, with the region verifiably attached at
  the view focus and correctly sized.
- **The control that settles it:** forcing the GLOBAL ground `errorTarget` to **0.05** also
  produced **zero**. The ground is availability-capped (Esri z19 + patch L13), and
  `GROUND.errorNearAlt` is **60 km** — below that the 3D target already sits at its finest (2).
- Therefore **desktop has no unspent imagery-refinement headroom**, and "the 2D chart holds
  detail the 3D view lacks" is false.

What is actually lost at a tilt is **grazing-angle minification**. The drape composites are
created `generateMipmaps = false` with `anisotropy = 1`
(`node_modules/3d-tiles-renderer/.../images/sources/RegionImageSource.js:112-114`,
`three/src/textures/Texture.js:810`), and `imageryGround.ts` never sets a filter — while
`maxAniso` IS computed at `StylizedTiles.ts:238` and handed to `baseEarth` and `streetNames`,
just never to the ground. **`renderer.capabilities.getMaxAnisotropy()` measured 16 on the
owner's machine.**

**The slice (T43 S1 + S2, now ULTRA-gated):**
1. Stamp `anisotropy` on the drape composites. Cover **both** creation paths — the compose
   `CanvasTexture` and the single-tile `.clone()` fast path — reachable at runtime via
   `overlayPlugin.overlays[i].regionImageSource` / `.imageSource` (the `hookTerrainPatch`
   wrap idiom). Anisotropy alone is a legal win even with one mip level (multiple taps at
   level 0).
2. Optionally a **capped 3–4-level** mip chain. Higher risk: each composite is an independent
   ClampToEdge canvas cleared transparent with an `fwidth` boundary discard, so a full auto
   chain bleeds the transparent border inward and can produce a visible tile-seam grid.
3. **Live-flip cost is real and must be designed for:** `anisotropy` is part of three's texture
   cache key, so changing it on a live texture forces a full re-upload per composite. Either
   stamp at CREATION only (new tiles get it; documented as "fly a little for full effect") or
   accept one deliberate re-upload on an explicit click. **Never** route it through
   `setOverlayResolution` — that is the QA-7b overlay-rebuild storm (white chart 10 s+), and
   `stickyOverlayPx` only ratchets UP so it could not be undone in-session anyway.

**Re-instate the `HQ` chip** for 1a+1b, or fold both under `ULT`. Owner's call; the chip/CSS/
pref/gate scaffolding is one commit to read back (2026-08-22i removed it deliberately rather
than ship a decoration).

**Proof-of-done:** same pose, same scene time, ULTRA off→on: a horizon A/B screenshot pair where
the far ground gains texel definition and loses the gray cast, **with the terminator, night
lights and shadows visibly unchanged**, and `__overlayRebuilds` unchanged across every flip.

---

## 2. THE LIGHT HALF — ULTRA only (new, owner 2026-08-22i)

Owner: *"current shadows ok for representation purposes, but they are quite naive and linear"*;
wants crisper, more physically plausible building shadows, better sunrise/sunset/moonlight, and
**terrain that casts shadows**. Explicitly: no ray tracing (an M3 would die) — research what
game/3D engines actually do and what a browser can hold.

### THE GOAL, restated by the owner after the GI ruling (2026-08-22i, second message)

> *"Whatever we choose makes transitioning from day → dusk → night and vice versa more epic, not
> only in terms of shadows but general realistic atmosphere and global light feel."*

**This is the acceptance criterion for the whole half, and it re-ranks the work.** Shadows are
one contributor to it, not the objective. GI stays rejected (owner: *"i am ok with your
rulings"*) — but only on the condition that what replaces it delivers the transition. Two
consequences for planning:

1. **S4 (aerial perspective / scattering) is promoted to CO-PRIMARY with S2.** It is the single
   biggest lever on how dusk reads, and it is entirely absent today.
2. **A new sub-track — LIGHT TRANSPORT COHERENCE (S9–S11 below) — outranks S1/S3.** A perfectly
   cascaded shadow under a key light that does not change colour or intensity as the sun sets
   will still not feel epic.

**Judge it as a TIMELAPSE, never as single frames.** The proof-of-done for §2 is: park the
camera at a fixed pose over a city (and a second over Everest), scrub scene time continuously
through day → golden → civil → nautical → astronomical → night and back, ULTRA off vs on, and
watch the *sequence*. Single-frame A/Bs cannot show continuity, and continuity is the ask.
Record per-frame ms across the same sweep.

**The likely root of "naive and linear" is one line.** The whole day/night response hangs off
`dayK = smoothstep(EARTH.termBand[0], EARTH.termBand[1], sunUpDot)`
(`imageryGround.ts:369`) — a smoothstep over a **dot product**, with no physical meaning at the
band edges. Meanwhile this app already computes real twilight thresholds in the ephemeris layer
for the planner and the scrubber's light bands (sunset −0.833°, civil −6°, nautical −12°,
astronomical −18°). **Driving the renderer from the same almanac the planner uses is both more
physical and an architectural win** — one source of truth for the sun's elevation, and each
twilight band gets its own colour/intensity response instead of one blended ramp.

### First, measure and read (do not code yet)

- Read the shadow rig in `GlobeCanvas.tsx` (init at ~`:116`, `:222-226`) and the per-frame
  sun/moon key + `castShadow` logic in `StylizedTiles.ts` (`stepKeyLightAndShadow`).
- Read `SHADOWS` in `tuning.ts` (`mapSize` 4096 on `high`), `QUALITY.tiers[*].shadowsEnabled` /
  `shadowMapSize`, and `AO` (`tuning.ts:314` — construction-time master switch, GTAOPass wired
  default-OFF, backlog **T10**).
- Read `imageryGround.ts` — the ground uses **`MeshBasicMaterial` (unlit)** and cannot receive
  shadows, so each tile carries a **`ShadowMaterial` twin** on the same geometry. Terrain
  currently **receives** via that twin; it does not **cast**.
- **Known from the FPV audit, already verified:** FPV shadows switch OFF whenever the look ray
  misses the ellipsoid (gap #17) · `HemisphereLight` is oriented along ECEF +Y, not local up,
  and never tracks the ephemeris (gap #16) · there is **no aerial perspective on ground or
  buildings** and `scene.fog` is absent (gap #9) · the sky dome's `skyHazeBelow` term is
  geometrically unreachable (it sits at `camera.far * 0.45 ≈ 81 km`, depthTest on,
  AdditiveBlending).

### Candidate techniques, ranked by (payoff / risk) for a WebGL2 browser

| # | Technique | What it buys | Notes for THIS codebase |
|---|---|---|---|
| S1 | **CSM — Cascaded Shadow Maps** | THE fix for "naive and linear". One 4096 map stretched over a planet-scale frustum is why near shadows are coarse; 3–4 cascades put texel density where the eye is | `three/examples/jsm/csm/CSM.js` exists. Big integration: it rewrites light setup and injects into every receiving material — and this scene has ~19 raw ShaderMaterials plus the ShadowMaterial twins. **ULTRA-only means a second code path; budget for that honestly** |
| S2 | **PCSS / PCF soft shadows** | Contact-hardening penumbra — a shadow that is sharp at the base and soft far away. This is most of the "physically accurate" feeling, cheaply | three ships `PCFSoftShadowMap`; PCSS is a shader-chunk override. Much smaller blast radius than CSM — **do this before CSM** |
| S3 | **TERRAIN CASTS** (owner's killer feature) | Mountain self-shadowing + valley shadows at low sun. Huge in the Khumbu/Everest bake | The ground tiles are Basic+ShadowMaterial twins. Casting needs `castShadow` on real geometry with a depth-writing material, and the shadow camera must cover a much larger extent than buildings do — this interacts directly with S1's cascade split. **Prototype at Everest — that bake exists precisely for this** |
| S4 | **Aerial perspective / atmospheric scattering on ground + buildings** | The single biggest "realistic sunrise/sunset" lever, and it also hides far-field aliasing. Currently absent entirely | Share the dome's haze colour/gates; zero above `skyGoneAlt` and on flat2d. **C2 risk both ways** — grey mush if wrong. Gap #9 in the audit |
| S5 | **Shadow-map size / bias / normal-offset tuning under ULTRA** | Cheapest crispness win available; acne/peter-panning are mostly bias problems | **`shadowMapSize` and `shadowsEnabled` are CONSTRUCTION-TIME** (`GlobeCanvas.tsx:116, :222-226`) — a live flip recompiles every material. ULTRA may need to size the rig at BOOT from the persisted pref, which is a legitimate exception to "edge-applied" but must still be inert when off |
| S6 | **GTAO** (already wired, default-OFF) | Contact darkening; complements shadows | Backlog **T10**. `AO.enabled` is a construction-time master switch — enabling it costs EVERY user at boot, so it must be read from the ULTRA pref at boot or stay off |
| S7 | Screen-space contact shadows | Cheap small-scale contact detail | Only if S1–S3 leave headroom |
| S8 | Real-time GI | Owner named it | **REJECTED for v1, owner-accepted 2026-08-22i.** The honest browser options (baked probes / SSGI) are either static-geometry-only — useless on a streaming tileset whose geometry arrives and evicts continuously — or a large frame cost. S4 + S9–S11 deliver the "global light feel" it was wanted for, at a fraction of the risk. **The condition of the ruling is that they actually do**; if the timelapse still reads flat after them, re-open with irradiance probes over the STATIC base earth only |

### The light-transport sub-track (S9–S11) — added by the owner's transition steer

These are what actually make dusk feel like dusk. All three are small next to CSM, and all three
are `QUALITY.ultraDesktop`-gateable or boot-read.

| # | Technique | What it buys | Notes for THIS codebase |
|---|---|---|---|
| **S9** | **Drive the day/night response from REAL SUN ELEVATION + the twilight bands**, replacing the `smoothstep(termBand, sunUpDot)` ramp | This is the "not linear" fix at its root. Sunset / civil / nautical / astronomical each get their own colour + intensity + ambient-floor response, so the sequence has *structure* instead of one blend | The almanac already exists and is already trusted by the planner and the scrubber's light bands — reuse it, do not re-derive. Touches `imageryGround.ts:369` (ground), `buildingMaterial.ts` (buildings) and the key-light step; they must move TOGETHER or the ground and buildings will disagree at the terminator — the exact incoherence that made forcing `dayK` a C2 breach in §1a |
| **S10** | **Key + ambient + hemisphere light track the ephemeris**: warm/dim the sun key through golden hour, hand over to the moon key by K&S intensity, and orient the hemisphere along LOCAL UP | Audit gap **#16**, already verified: `HemisphereLight` sits along **ECEF +Y**, not local up, and never tracks the ephemeris. On a globe that means the sky/ground ambient split is wrong everywhere except one meridian — a permanent, invisible-until-you-look error in the "global light feel" | Small, self-contained, and it is a **visual delta everywhere**, so it must be ULTRA-gated even though it is arguably a bug fix. Keep the existing K&S-1991 moon intensity model |
| **S11** | **Exposure adaptation** — ramp `toneMappingExposure` with sun elevation (optionally a slow eye-adaptation easing) | The cheapest "epic" lever there is. A camera opening up as the sun goes down is most of why a real timelapse feels cinematic. Also stops the night side reading as merely *dark* | `RENDERER.toneMappingExposure` is a static 1.0 with NeutralToneMapping. Live-writable, no recompile. **Must ease** — a per-frame exposure jump reads as a flicker — and must not fight `uFtwNightFloor` / the building night-lights model |

### Non-negotiables for the shadow slice

- Every lever either lives in `QUALITY.ultraDesktop` (edge-applied) or is read from the pref at
  BOOT (construction-time levers). **No third path.**
- Moonlight must keep its existing K&S-1991 intensity model and the `moonGroundOpacity` path —
  the owner asked for better moon shadows, not different moon physics.
- The `high` tier stays byte-identical: `test/lib/globe/quality.test.ts` locks it, and the
  reason it is locked is that this is exactly the change that would quietly break it.
- **Measure per-frame ms before and after on the owner's machine.** "Make my machine hurt" is
  opt-in, but a 12 fps ULTRA is a broken feature, not a hardcore one.

---

## 3. Suggested session shape

1. **Measure first** (one `wix dev` session): FPV audit §6 items M1/M2/M3 + current shadow-map
   size, cascade count (none), per-frame ms with shadows on/off, and the anisotropy A/B by
   stamping 16 on live composites by hand. **M3 decides how much of §1b is worth building.**
2. **§1 texture slice** — `uFtwPhoto3d` + anisotropy. Small, high payoff, directly answers the
   owner's "grayish / less resolution".
3. **§2 light + shadows**, in this order — the transition steer put the light first:
   **S9** (real sun elevation + twilight bands) → **S11** (exposure ramp) → **S4** (aerial
   perspective) → **S10** (ephemeris-tracking key/ambient/hemisphere) → **S2** (PCSS) →
   **S5** (bias/size) → **S3** (terrain casts, prototyped at Everest). **S1 (CSM) only if S2+S5
   prove insufficient. S8 rejected, owner-accepted, conditional on S4+S9–S11 landing the feel.**
   Run the day→dusk→night timelapse after EACH of S9/S11/S4/S10 — they compose, and the point
   is the sequence.
4. Re-run the mobile fence and the `high`-tier identity tests after every step.

Everest (`terrain/everest/`, live on R2 since 2026-08-22h) is the natural proving ground for
S3 and S4 — 8,849 m of real relief with true baked heights.
