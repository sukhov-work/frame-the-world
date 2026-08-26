# WIP 2026-08-26 — RENDERING CHARTER: Group E + RC25 + RC30 SHIPPED

Continues `mem:project/wip-2026-08-25-rendering-charter-groupF`. Charter:
`.claude/claude-docs/rendering/RENDERING_CHARTER_2026-08-25.md`.

**SHIPPED: RC18, RC19, RC20, RC25, RC30.**
Gates: vitest **2,045/2,045 (139 files)** · astro 0 err / 0 warn / 6 hints · knip exit-0 ·
**`verify-rendering-charter.mjs` 85/85 ALL PASS**.

**Charter status after this session — only RC21 and Group D remain.**
Shipped: RC0–RC11 · RC18 · RC19 · RC20 · RC22 · RC23 · RC24 · RC25 · RC26 · RC27 · RC29 · RC30.
Refuted, do not build: RC12, RC28.
Left: **RC21** (recon says the live default is not safely shippable — see below) and
**Group D** (RC13/RC15/RC16/RC17 — bake infra CONFIRMED available, so unblocked).

## The session's shape: three design notes were wrong, and measurement is what caught each one

1. **RC19's banked colour path said `toneMapped: false` on the blit material. Backwards.** three
   forces `NoToneMapping` on anything rendered INTO a render target (`WebGLPrograms.js:178-186`),
   so the target holds raw linear HDR and the blit to the canvas is the ONLY remaining place
   `NeutralToneMapping` can apply. `toneMapped` stays TRUE. The note as written would have shipped
   an un-tone-mapped, clipping miniature.
2. **RC25's crux ("an incomplete chain renders black without `TEXTURE_MAX_LEVEL`") does not apply.**
   three never sets that parameter anywhere; with `generateMipmaps` false it allocates IMMUTABLE
   storage sized to `mipmaps.length`, complete over exactly those levels. The black-chain failure
   is the mutable WebGL1 path this renderer never takes.
3. **RC25's artefact is a DOUBLE ALPHA MULTIPLY, not a colour bleed** (composite is
   non-premultiplied; the drape shader premultiplies at sample time). And the DOMINANT seam is
   neither: adjacent composites share NO border texels, so coarse levels average disjoint sets
   across a shared edge — a C0 discontinuity no filter removes and only the CAP bounds.

## THE MEASUREMENT THAT REWROTE AN IMPLEMENTATION — 5.36 ms → 0.06 ms

RC25's first version read each composite back with `getImageData` and filtered in JS. Measured on
a live 512² composite: **4.10 ms readback + 1.26 ms filter = 5.36 ms per composite, main thread**,
with ~450 composites per flight. It stalled the page so hard that CDP `Runtime.evaluate` stopped
returning and the verifier **sat silent for fifty minutes**. Halving with canvas `drawImage`
instead: **0.06 ms — 89× cheaper**, and it is the CORRECT filter, because canvas 2D composites in
premultiplied alpha, the exact inverse of the shader's multiply. The pure module kept the
arithmetic (`mipByteFactor`, `maxMipLevels`, `planMipSizes`); the JS pixel filter is gone.

## Numbers worth keeping

- **RC25 browser-proven**: 357/357 composites chained at exactly 4 levels; VRAM **×1.328125 =
  85/64 to the digit**; off-state proven by RETURNING to it (mipMax 0, bytes === level-0 bytes).
- **RC25 budget arithmetic**: 4 total levels = +32.81 %; FIVE = +33.20 % and breaches the charter's
  own ≤ +33 % ceiling. "3–4 levels" and "≤ 33 %" cannot both hold — 4 is the ceiling, not a guess.
- **M13 ANSWERED — the desktop half of T34 does not exist.** On `high` the ground cache rests at
  **109.8 MB against a 322.1 MB floor**; the trim condition never arises. RC20's bank therefore
  ships mid/low only, and the desktop leg proves the off-state (the library's non-integer
  0.3/0.4 GiB pair, untouched).
- **The T34 mechanism, in one library line** (`LRUCache.js` 0.4.28):
  `hasBytesToUnload = unused && cachedBytes > minBytesSize || …` — one unvisited tile plus a cache
  above the **FLOOR** starts an eviction; the cap is never consulted.
- **RC18 browser-proven** at Dnipro FPV: tileTier=high landed while tier stayed low, pending=high,
  DPR unchanged, ZERO overlay rebuilds.
- **Creation-time levers reach almost nothing mid-session.** Flipping the ULT chip mid-session left
  **2 of 321** composites chained; with the chip on at BOOT, **452 of 452**. The ground cache never
  turns over (RC9's finding), and squeezing the cap does not help — the tiles under the camera are
  in the renderer's `usedSet`. These levers are delivered by a RELOAD.

## Two harness lessons, both paid for here

1. **A probe that reads a field which does not exist FAILS OPEN.** The RC18 leg read
   `u2().fpv?.active` — it is `__globe.fpv()`, a FUNCTION — got `undefined`, and reported
   "not in FPV" while the engine was in FPV with the split already landed. It does not throw.
2. **Every CDP call now carries a 90 s timeout.** An unbounded `Runtime.evaluate` turned a page
   stall into a fifty-minute silent hang with zero output. A hang must present as a failed check.

## Design decisions worth not re-deriving

- **A DEMOTE never splits** (RC18). Shrinking a cap mid-FPV evicts everything outside the visible
  set, then discards each fresh parse against the full cache — the U2/A9 loop. The safety argument
  for the PROMOTE half is a unit test over the tier TABLE (monotone), not prose.
- **`planTierApply` returns BOTH halves for every non-FPV call, including equal tiers.** That is
  what closes the promote-then-demote-inside-one-FPV-leg hazard: FPV exit always re-converges.
- **RC20 keys on `fpvActive`, never `flatGround`** — the flat latch's altitude term is
  un-hysteresed and would re-arm the bank every frame at 120 km, turning a bounded bank into a
  permanent raised floor with the iOS memory cost T34 worries about.
- **The LRU is re-billed under a manual mip chain.** `MemoryUtils.getTextureByteLength` scales by
  4/3 only for AUTO mipmaps; unbilled, that is ~200 MB past ULTRA's 600 MB ground cap. All three
  LRU writers now go through one `applyLruBand`.
- **Never call `pipQuad.dispose()`** — `FullScreenQuad.dispose()` disposes three's MODULE-LEVEL
  shared triangle that bloom, output and GTAO all draw with.

## RC21 — NOT built, and the reason is on record

Read-only recon mapped **40+ independent per-frame visual-change sources across 20 files**, ~14 of
them asymptotic eases with NO snap, and concluded the live default is not safely shippable: a false
negative is a frozen globe. Also established, and load-bearing for whoever builds it:
`tilesHandle.update()` (the whole 55-step chain and all three `tiles.update()` calls) must run
EVERY frame regardless — only the two GPU draws may be skipped — so the slice buys GPU/power, not
CPU. The shape it should take is the heartbeat-bounded pattern RC19 just shipped: a hard staleness
cap turns every predicate miss into a low frame rate instead of a freeze.

Related: `mem:project/wip-2026-08-25-rendering-charter-groupBC` · `…-groupF` ·
DECISIONS §Recent **2026-08-26** · `rendering/RENDERING_ARCHITECTURE.md` (RC30) · backlog T54.
