# mem:bugs/ground-checkerboard-flicker — halftone/checker ground pattern + LOD flicker, 1500→200 km (OPEN)

**Reported by owner 2026-07-17 with screenshot (Caspian view, stylized ground, SAT off, city labels on):**
screen-wide halftone/checkerboard stipple across the terrain — persists even when the scene is calm;
sometimes clears on an angle/altitude change, sometimes only on much closer zoom. Separately, "super
flickering" during descent across the ~1500 km → 200 km altitude band. Owner notes this was investigated
before and still stands. NOT the phase55-53 one-off dark streak (different symptom).

## Prime suspect (code-verified 2026-07-17, not yet reproduced under instrumentation)
The **Pass-1 screen-door tile fade-in** (`mem:project/wip-2026-07-12-rendering-pass1-tiling-fluidity`):
new tiles dissolve in via Bayer dither + `discard` injected at `<dithering_fragment>` while the tile's
`age<1` — the same dither as `imageryGround.ts:280`, shared by the stylized tile materials (and buildings
per `mem:project/wip-2026-07-12-rendering-quality-pass`). Failure chain that matches every symptom:
- **Stuck `age<1`** (dissolve clock stalls when the tile stops being updated / driven per-frame vs
  per-time?) → the Bayer discard pattern STAYS = the persistent checkerboard; an angle/altitude change
  that swaps the LOD tile replaces the stuck material = "sometimes it goes out".
- **LOD churn at grazing angles in the 1500–200 km band** re-runs the dissolve on every arriving tile =
  the flicker; parent+child both mid-dissolve overlap = moiré-on-moiré.
- The analytic `DITHER_GLSL` banding noise (`scene/glsl.ts:23`, amplitude 1/128) is far too subtle to be
  the visible pattern — excluded.

## Investigation plan (next rendering session)
1. Reproduce at ~800–1500 km, grazing tilt; freeze with `window.__globe` / `renderer.info` and inspect a
   patterned tile's material uniforms — is `age` < 1 and no longer advancing?
2. Check the dissolve clock: frame-based vs elapsed-time; does it complete for tiles that load while
   off-screen / while rAF is throttled (occluded-tab trap)? Does every LOD swap restart it (should be
   first-appearance only)?
3. Check parent/child co-render during dissolve (depth pre-pass? draw order?).
4. Fix directions: time-based clamped dissolve with guaranteed completion · dissolve only on first
   appearance · altitude-gate the effect (skip above ~300 km where tiles are small on screen) · or swap to
   3d-tiles-renderer's native fade plugin if it composes with the stylized onBeforeCompile materials.

Parked in `NEXT_SESSION_PROMPT.md` §Carried tails (top). Related:
[[project/wip-2026-07-12-rendering-pass1-tiling-fluidity]] [[project/wip-2026-07-12-rendering-quality-pass]]
[[patterns/globe-rendering]]
