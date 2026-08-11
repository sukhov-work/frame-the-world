# mem:bugs/fpv-walk-orbit — FPV walk pivot-ellipse bug (FIXED + browser-VERIFIED 2026-08-11)

**Symptom (owner):** standing still in FPV, look-around pivots correctly at the eye. After walking
with arrows, looking around swung the camera in ellipses — as if part of the pivot stayed at the
entry point; grew with distance walked.

**Root cause (source-confirmed):** `globe/StylizedTiles.ts` `stepFpvPose` stored the walk as two
SCALARS (`fpvWalkFwd`/`fpvWalkRight`) and re-applied them EVERY FRAME along the CURRENT look basis
(horizontal-projected `_fpvFwd` + `_fpvRight`). Position = anchor + fwd(yaw)·a + right(yaw)·b — so
any yaw/pitch change re-aimed the ACCUMULATED displacement, orbiting the eye around the anchor at
walk radius. Ellipse = that circle × the pitch-dependent horizontal projection wobble.

**Fix (the durable pattern):** a first-person walk offset must be a **fixed world-space vector**
(`fpvWalkOffset: THREE.Vector3`, ECEF m), integrated INCREMENTALLY at key-hold time along the
horizontal look of the frame each step is taken, then `camera.position.add(fpvWalkOffset)`.
Invariant: **only key-holds mutate the offset; a head-turn never does.** Never store first-person
displacement as coefficients over a basis that rotates with the view. Reset `.set(0,0,0)` at both
FPV entry sites (photo + temp). Straight-line-offset curvature error ≈0.009°/km — irrelevant at
walk scale.

**Speed modifiers (same session):** Shift+arrows ×3 (`FPV.walkFastMult`), Option/Alt+arrows ×0.5
(`FPV.walkSlowMult`), tuning.ts. GOTCHA: the old keydown guard excluded `altKey`, so Option+arrow
never even walked; only meta/ctrl stay excluded now (their arrow combos are browser shortcuts —
preventDefault covers Alt+Left history nav since we consume the arrow). `fpvKeysDown.shift/.alt`
mirror `e.shiftKey/.altKey` on EVERY keydown+keyup → pressing/releasing a modifier mid-stride
retunes live without re-pressing the arrow.

**Verification (all green):** vitest 701/701 · astro check 0/0 · browser (wix dev + Playwright,
`#f=` boot hash into temp-pin FPV at Dnipro, `window.__globe.camera` probe, 53 fps): 1.5 s walk =
33.07 m (22 m/s ✓); post-walk 60.6° look-drag + reverse drag → **0.000 m** position drift (pre-fix
≈ walk radius); Shift ratio 3.009; Option ratio 0.49997. Shot `verify-shots/fpv-walk-pivot-fix-01.jpeg`.

**Ops trap:** backgrounded `wix dev` piped through `head`/`tail -n` gets SIGPIPE-killed once the
spinner exceeds the line budget — run it bare, read its output file. Port was :4322 (4321 busy).

DECISIONS.md line: 2026-08-11. Related: `mem:patterns/globe-rendering` (FPV controller lives in the
orchestrator; B19/B20 extraction still pending).
