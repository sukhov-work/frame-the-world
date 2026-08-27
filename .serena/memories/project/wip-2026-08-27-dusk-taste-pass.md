# ULTRA dusk TASTE PASS — what the first batch got wrong (2026-08-27c)

Second round on the owner's defect 2, after he tested `mem:project/wip-2026-08-27-ultra-render-batch`
and reported four things still wrong. Doc: `rendering/ULTRA_ARCHITECTURE.md` **§14**. Decision line:
`DECISIONS.md` §Recent **2026-08-27c**.

## THE ONE SENTENCE WORTH KEEPING

**Dimming the key is only HALF a dusk.** Directional contrast is `direct / (direct + flat)`;
`keyExtinctCurve` divided the numerator by five through the dusk band and 08-27b scaled *nothing
else*. That is the definition of flattening, and it is why the first pass could not have been tuned
into correctness — every remaining defect was a term LEFT OUT, not a knob set badly.

Measured, before: terrain anti-sun/lit ratio **0.969 at +2°**; building front:back **1.28 at 3°,
1.08 at 0°**.

## The four flat terms nobody had counted

| Where | The constant | Size |
|---|---|---|
| terrain | `shade = mix(shade, 1.0, photo)` at `photo3dK` 0.6 | took the ratio 1.112 → 1.031 on its own |
| terrain | the ambient half of 08-27b's own split | *worse at dusk than the `dayGradMin` 0.78 ramp it replaced* |
| terrain | the golden-hour cast (bell over SOLAR elevation) | blue channel −33 % on every day-side fragment |
| buildings | `BUILDINGS.emissiveIntensity` 0.1 on `tokens.land` | **3.6× the sun key** on a wall facing a 3° sun; ~100× the hemisphere |
| buildings | the unlit edge strokes | **6.4×** the lit surface of the wall they outline at 3° |

## Five things that will save a future session real time

1. **A lobe is not a hemisphere.** The first azimuth term reused `ftwAirLevel` (the air-light's Mie
   pair) as "how much bright sky does this face see" and moved the ratio by 0.06. That lobe is
   RADIANCE ALONG ONE RAY; a surface integrates the hemisphere around its normal, and the
   cosine-weighted integral of a one-sided sky is the WRAP `0.5 + 0.5·dot(n, sun)`. Its strength is
   `(1 − directK)^0.5` — free, and exactly inert at noon.
2. **`mix(x, 1.0, k)` COMPRESSES ratios**, lifting dark values more than bright ones. That is why
   the photo-shade ride needs `directK^3` and not a linear ride.
3. **Additive blending has no dim-but-solid state.** `disc + sky` means dimming and dissolving are
   the same operation. The fix is a premultiplied arm (the moon's blend triple, different axis) with
   `uSolid` EXACTLY 0 at high sun so the path degenerates to the addition it replaces.
4. **Under premultiplied "over", rgb 0 with a 1 is BLACK.** Every geometric mask that was correctly
   applied to colour alone under addition must now reach ALPHA too, or the eclipse silhouette and
   the setting limb punch black bites. ONE `cover` scalar drives both. `verify-eclipse` 37/0 is the
   proof.
5. **A lerp target dimmer than what it replaces SUBTRACTS.** The dome's afterglow rode
   `mix(legacy, dir, k)` where `k ≤ 0.3825` and the legacy band was at 0.977 at −2° (because
   `GOLDEN.fadeInLo` = sin(−12.1°)). ULTRA could only make the dusk horizon DARKER than baseline.

## Process note — a real mistake

The audit workflow (4 read-only lenses + an adversarial refutation pass, 39 agents) paid for itself
three times: it found the largest terrain flattener (hiding in the TEXTURE half of the track), it
**refuted my own idea** of tilting the HemisphereLight toward the sun by measuring the hemisphere at
**0.18 % of a facade pixel**, and its refutation of its own top finding caught a regression I had
just introduced (splitting the shade lift left `moonlit`/`ambient` suppressed under a shade that no
longer rises → the ULTRA night ground DARKER than the ULTRA-OFF one, re-opening S7's "ground
jarringly black"; both now ride `photoShade`).

**But I implemented while the refuters were still running**, so several "REFUTED" verdicts are
line-number drift from my own edits rather than real refutations. **Let the adversarial phase finish
before the tree moves.**

## Measured after

- terrain ratio **0.685 at +2°**, 0.653 at 0°, monotone from 10° down; LIT slope 0.99 → 0.49 → 0.31
  (the ratio was not bought by lifting the shadow side).
- disc level 0.771 → 0.115 across 14° → 1.6°; `solid` 0 → 0.95; `haloK` 0.60 → 0.013; tint white →
  `#ffd6bb`. `BLOOM.threshold` crossing placed at ~5.5°, deliberately ABOVE the band he watches.
- Gates: vitest 2,210/2,210 · astro 0/0 · knip 0 · `verify-ultra` 28/28 · `verify-ultra-dusk` 21/21
  · `verify-eclipse` 37/0 · `verify-rendering-charter` 85/85.

## Left open ON PURPOSE (say so, do not pretend)

- **T68** — the "sun set behind a MOUNTAIN" half of the afterglow ask is NOT shipped. `horizonProfile`
  exists and is O(1), but it is built only for a photo apex or an FPV eye and is coverage-gated;
  nothing cheap exists for a free orbit.
- **T69** — the aerial perspective never reads the surface normal, so past ~5 km a lit wall and a
  shadowed wall are the same colour to within one 8-bit code value. Lever: `hazeMaxK` as a curve.
- **T70** — the dome's Mie lobe mixes ellipsoid-scaled and raw ECEF frames (~0.19°).
- `A-BLD-4` (the edge trough) is the one finding whose adversarial verification ERRORED rather than
  returning a verdict — the least-verified line in the batch.

Related: [[project/wip-2026-08-27-ultra-render-batch]] [[project/wip-2026-08-22-ultra-track]]
[[patterns/globe-rendering]] [[patterns/sky-bodies-terrain]]
