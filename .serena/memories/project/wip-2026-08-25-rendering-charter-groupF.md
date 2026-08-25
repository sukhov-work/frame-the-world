# WIP 2026-08-25e — RENDERING CHARTER: Group F + RC29 + RC22

Continues `mem:project/wip-2026-08-25-rendering-charter-groupBC`. Charter:
`.claude/claude-docs/rendering/RENDERING_CHARTER_2026-08-25.md`.

**SHIPPED this session: RC23, RC24, RC26, RC27, RC29, RC22 (A/B-prep).**
Gates: vitest **1,996/1,996 (137 files)** · astro 0 err / 0 warn / 5 hints · knip exit-0 ·
verify-ultra **29/29** · verify-eclipse **38/38** · `verify-rendering-charter.mjs` **70/70**.

## The two ULTRA seams — one principle

**Every ULTRA look term is driven by SOLAR ELEVATION.** That is the root of both seams, and the
fix in both cases is to make ULTRA's additions ride something that is already correct rather than
to author a second curve.

- **RC23 (× eclipse)** — an eclipse does not move the sun, so at totality the band curve still
  says "day": the aerial perspective painted a day-tinted veil over a world the eclipse had just
  darkened. Principle: **under an eclipse ULTRA's day-driven additions fade toward BASELINE**,
  because the darkening already lives in the shaders baseline carries. `haze × eclipseK` and
  `hemiTintK × eclipseK`. Exposure deliberately NOT scaled — taste lever, AB5.
  Measured: ground haze **0.0253** at totality vs **0.1138** at golden hour.
- **RC24 (dome seam)** — the dome tints from GOLDEN's bell, the ground from the four-stop band
  curve over 36°; they met at the terrain/sky junction. The orchestrator now pushes the ground's
  **own effective (gated, eased) haze value + band tint** into `atmosphere.setUltraBand()`, so the
  dome moves when the ground moves and cannot drift onto its own schedule — the `FTW_AERIAL_GLSL`
  trick (share the emitted value, not the intent). **Only the HAZE band, never the zenith**: the
  haze is what meets the terrain, and the zenith would fight the `skyBudget` guard for nothing.
  `ULTRA.domeTintK 0.45`, below `hemiTintK` on purpose — the dome is the BACKGROUND the golden
  band is read against.

**Both off-states are EXACT and that is the load-bearing half.** `mix(x, y, 0.0)` is `x`; the
browser leg asserts `=== 0` (not `< ε`) with the chip off, flips it on, then off again and
re-asserts EXACTLY 0 **after the snap** (>6.2τ on `exposureTauMs` 950).

## RC26 — the chip state nobody could see

Three ULTRA shadow levers are CONSTRUCTION-TIME, so a mid-session toggle leaves the rig on the
boot profile. NEW `ultraBootSnapshot()` freezes the boot answer — **memoized, because the pref
moves the instant the user clicks and a later read answers "what is it now", not "what did we
build with"**; ordering is safe by construction (the chip lives in the panel whose first render
precedes any toggle of it). `pref !== snapshot` → a hairline warn dot + a tooltip. GlobeCanvas
reads the same snapshot, so UI and rig cannot disagree. The ULTRA flag fence still passes (the new
function names neither the flag nor a new owner file).

## RC27 — the note that would have bitten silently

**If `AO.enabled` is ever flipped on, AO becomes an ULTRA lever by accident.**
`updateAoEnabled()` gates on `tier === "high"` and the ULTRA chip PINS the tier to `high`, so on a
machine the governor had stepped to `mid`, turning ULTRA on would also turn AO on — a coupling
nobody chose, in no tunable, inside a track whose contract is "the chip off changes no pixel".
Recorded next to `AO.enabled` with two honest options. Also: the 8192² shadow-map rollback
criteria, and the measurement that decides it (`metresPerTexel` vs the live `boundsM`, which RC4
made variable).

## The counter earned its keep

**`GROUND.heightMemoCapacity` 20_000 → 100_000.** RC11's memo overflowed and its own `overflows`
counter is the only reason it surfaced rather than reading as unexplained frame cost. The constant
was guessed from "a few thousand buildings"; the browser measured **39,302 buildings + 60,527 tree
instances across 101 loaded cells at Dnipro alone**, memo at 18,457 live entries. ~15 MB at the new
cap against a ground LRU in the hundreds.

## HARNESS TRAP — re-paid, and worth remembering

Three runs died with EVERY island failing to hydrate. Not the code: **`504 Outdated Optimize Dep`**
on the vite dep graph. The page itself answers 200 the whole time — **the diagnostic is `curl` on
the dep URL** (`node_modules/.vite/deps/three.js?v=…`). Moving `.vite` aside is not enough on its
own: the server must be fully DOWN first, then restarted, then warmed with ONE real page load
before any browser attaches.

## Deferred, with reasons

- **RC25** (capped mip chain) — transparent-border bleed needs hand-built levels judged in a
  browser A/B at a 4-tile junction; getting it wrong ships the seam grid the charter warns about.
- **RC18 / RC19 / RC20 / RC21** — with one design finding banked for RC19: **half-rate is NOT
  viable**, because `composer.render()` overwrites the PiP rect every frame. The second pass needs
  a render target + a textured-quad blit (RT linear, blit material `toneMapped: false`, map
  `colorSpace` LinearSRGB — that path reproduces the current look exactly).
- **Group D** (RC13/RC15/RC16/RC17) — untouched. **RC12 stays REFUTED** (see the groupBC memory).

Related: `mem:project/wip-2026-08-25-rendering-charter-groupBC` ·
`mem:project/wip-2026-08-25-rendering-charter` · DECISIONS §Recent **2026-08-25e** · backlog T54.
