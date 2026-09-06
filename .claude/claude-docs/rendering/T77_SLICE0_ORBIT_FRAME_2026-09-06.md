# T77 slice 0 — THE ORBIT FRAME: T79 the below-camera GATE (as-built, 2026-09-06)

Owner order: T77 (2026-09-02k) — a performance revamp of rendering and scene management under the
binding no-regression rule. Plan: `T77_AUDIT_PLAN_2026-09-05.md`; measurements and the slice order:
`MEASUREMENTS_2026-09-05.md` §0 / §7 / §12 (slice 0 = the orbit frame: T79 the controls' raycast,
then T80 bloom). This file is slice 0's T79 half: what was wrong, what was built, why it cannot
change behaviour, and the receipt. T80 (bloom) is NOT in this file — it waits on the owner's ruling
about pixels at `high` (§6).

## 1. The defect, measured — and re-attributed

MEASURE (2026-09-05) found every `#p=` orbit pose CPU-bound at a STATIC camera: 31–47 ms of main
thread per frame at every tier on the M3 Pro, 84 % of it in `GlobeControls.update → adjustCamera →
_getPointBelowCamera → raycaster.intersectObject(scene)` — the library's vertical down-ray from
1e5 m above the camera, over the WHOLE scene, twice a frame (`EnvironmentControls.js:995` and
`:1059`, 3d-tiles-renderer 0.4.28). The phones made it the mobile lever (`MEASUREMENTS` §11): an
iPhone 17 Pro spends 74–105 ms and a Pixel 6 Pro 78–109 ms a frame in the same place — 9–13 fps at
every orbit pose — and the quality governor's demotion to `low` does nothing for it.

MEASURE attributed the cost to "the 7.7 M-vertex enriched soup". **That was wrong.**
`scripts/probe-below-camera.mjs` (this session) times the same ray against every scene object:

| pose | whole call | base-earth sphere | enriched cells | OSM building tiles | terrain tiles |
|---|---|---|---|---|---|
| orbit (700 m) | 21.0 ms | **15.9** | 3.1 (85 k tris / 11 scenes) | 2.1 (79 k / 10) | 0.02 |
| /m (220 m) | 12.1 | **12.1** | — | — | 0.02 |
| Everest (11.5 km) | 15.0 | **14.8** | — | 0.14 | 0.06 |
| city (26 km back) | 18.7 | **15.2** | 0.04 (2.59 M tris culled by the tile traversal) | 3.6 (174 k / 23) | 0.06 |

Three quarters is `baseEarth.ts:183`: `SphereGeometry(1, EARTH.segments = 384, 384)` — 294,144
triangles — scaled to WGS84 and sunk 1.9 km under the terrain as the backdrop the imagery ground
draws over. Every other backdrop in the scene sets `raycast = () => {}`; the base earth kept
three's default, and because its bounding sphere and box ARE the planet, the default's early-outs
never fire: every vertical ray tests all 294 k triangles, twice a frame. The tile traversal
(`raycastTraverseFirstHit`) already culls terrain to nothing; the enriched and OSM tile scenes
under the ray are the remaining 3–6 ms.

## 2. What the callers actually consume (the exactness argument)

`_getPointBelowCamera()` has three callers in 0.4.28:

| caller | what it reads | when |
|---|---|---|
| `update()` :995–1030 | `hit.distance −= actionHeightOffset; if (dist < cameraRadius) push up by the difference` | every frame while `adjustHeight` |
| `adjustCamera()` :1059–1067 | `if (dist < cameraRadius) push up by the difference` | every frame while `adjustHeight` (also called by hand in FPV, where `adjustHeight` is off) |
| `_updateZoom()` :1371 | `scale × dist × 0.01` — the EXACT distance | only when a zoom ray misses the scene |

The two per-frame callers consume ONE bit — is the surface closer than `cameraRadius`
(+ the previous frame's push)? — and need the exact distance only when that bit is true. A mesh
whose whole volume lies more than `band = cameraRadius + actionHeightOffset + margin` below the
camera can therefore never change the outcome:

- if some band-reaching mesh is hit, it is the first hit regardless (the ray comes from above), and
  it is the SAME intersection object the ungated call returns;
- if no band-reaching mesh is hit, the true first hit — a far mesh or the ellipsoid fallback
  (`GlobeControls._raycast`; `useFallbackPlane` is `false` on the globe) — is beyond the band either
  way, and the decision is "no push" in both worlds — PROVIDED the ellipsoid fallback itself lies
  beyond the band. The subclass checks that first, with the library's own ray (§3), and runs the
  untouched path when it does not (a camera hugging, or under, the ellipsoid where no mesh is
  resident — the Dead-Sea / Indian-Ocean-geoid corner).

The zoom caller is routed to the untouched path by a flag set for the duration of `_updateZoom`.

## 3. What was built

- **`src/lib/globe/belowCameraGate.ts`** — wraps `THREE.Mesh.prototype.raycast` ONCE. Inert
  (one boolean test) except while ARMED; while armed, a mesh proven to top out below the band
  returns before the triangle loop. Three upper bounds on "the mesh's highest point along `up`",
  cheapest first, each exact because a triangle never leaves the hull of its vertices:
  1. the local AABB's eight corners through `matrixWorld` — tight for tiles and cells (the box is
     taken from the POSITION attribute and cached per geometry by `(version, count)` in a WeakMap,
     never `geometry.boundingBox` — the enriched seats rewrite positions after load);
  2. for a `SphereGeometry`, the scaled ellipsoid's support point `r · |scale ∘ Rᵀup|` — O(1); the
     base earth's AABB and bounding sphere both reach 9–11 km ABOVE a camera at 48° N (a diagonal
     `up`, the equatorial radius), so only this bound can prove it out;
  3. the vertex support `max(p · Lᵀup) + t · up` — one pass over the attribute, cached per geometry
     by `(version, count, Lᵀup)`, so a static pose pays it once and a drag pays ~0.1 ms per loose mesh.
  Skinned and morphed meshes are never skipped. `InstancedMesh` instances are gated one by one
  (three funnels them through a shared `Mesh`).
- **`src/components/globe/scene/pluxGlobeControls.ts`** — `PluxGlobeControls extends GlobeControls`:
  overrides `_getPointBelowCamera` (arms the gate after the ellipsoid pre-check; `band =
  cameraRadius + max(0, actionHeightOffset) + CONTROLS.belowCameraGateMarginM`) and `_updateZoom`
  (the exact-path flag). DEV seam `__globe.controls.belowCameraGate(enabled?)` → counters
  (`gated / exact / seen / skipped / skipBox / skipSphere / skipScan / boxesBuilt / scans / lastMs`)
  and a kill-switch for A/B runs.
- **`tuning.ts` `CONTROLS.belowCameraGateMarginM = 0.5`** — any positive value keeps the gate
  exact; a larger one only costs triangle tests.
- **`StylizedTiles.ts:1089`** — `new PluxGlobeControls(scene, camera, renderer.domElement)`; nothing
  else in the orchestrator changed.
- **Harness:** `verify-perf-baseline.mjs` records the gate counters on every `on` cell and samples
  a `gateOff` cell beside it (the library's brute force, same boot) at every non-FPV pose;
  `scripts/probe-below-camera.mjs` is the per-object attribution probe with a gate A/B.

Rejected for this slice: a terrain-only `controls.setScene` or a `raycaster.layers` mask (both
change the orbit camera's rooftop clearance — the owner's call, §6); the memoised `heightAt` (a DEM
sample, not the rendered mesh); `three-mesh-bvh` (a new dependency, a worker build, arrival hitches
— plan lever 8 stays where it is, seats / streaming).

## 4. Tests (vitest; the gate's contract is pinned by construction, not by example)

- `test/lib/globe/belowCameraGate.test.ts` — **400 random scenes** (boxes, non-indexed soups, leaning
  towers, an `InstancedMesh`, a 30 km ellipsoidal backdrop in its own frame, a doubly-tilted sunk
  disc whose AABB reaches above the ground while its vertices never do — all in a randomly rotated
  world frame): the gated and ungated first hits agree on the push decision every time, and whenever
  the decision is "push" the hit is the same object at the same distance and point; both branches
  and all three bounds are exercised (asserted counts). Plus: the box cache follows
  `attribute.version`; `topHeightAbove` equals the brute-force corner max; the sphere support bounds
  every vertex tightly and the vertex scan IS the vertex max; the scan cache keys on `(version,
  count, Lᵀup)`; **the real base-earth shape** (`baseScale` (A, B, A) · shrink, `rotation.x = π/2`)
  is skipped at 700 m over 48° N by the O(1) bound with zero scans, and found reachable 1 m over its
  polygon's top; skinned / morphed never skipped; band edge inclusive; install idempotent, inert
  unarmed, uninstall restores three's method.
- `test/components/globe/pluxGlobeControls.test.ts` — source pins on the three library-private names
  the subclass leans on (`_getPointBelowCamera` builds from 1e5 m and reads `distance`;
  `update`/`adjustCamera` compare to `cameraRadius`; `_updateZoom` scales by the exact distance;
  `useFallbackPlane = false`; the ellipsoid fallback), so a library bump fails HERE instead of
  silently un-gating; routing with a Dnipro rig (gated at 700 m: both meshes skipped, the same
  no-push answer; 1 m over a roof: the roof tested and the exact 1.0 m hit returned; the exact path
  when disabled, inside `_updateZoom`, and with the ellipsoid inside the band; the DEV toggle).

## 5. Receipt (this session; every number fresh)

Gates: vitest **2,463 / 2,463 (164 files)** · `astro check` **0 errors / 0 warnings / 9 hints** ·
knip **0**.

Browser (`wix dev`, headed :9222, M3 Pro, DPR 2, `high`):

| probe / cell | before (MEASURE / gate OFF) | after (gate ON) |
|---|---|---|
| orbit `frame.cpu` p50 | 42.8 ms | **1.3 ms** |
| orbit `frame.dt` p50 | 43.8 ms | **18.2 ms** |
| orbit `_getPointBelowCamera()` per call | 22.4 ms | **0.04 ms** (27 meshes seen, 27 skipped: 22 box · 1 sphere · 4 scan) |
| orbit hit distance | 595.1 m (a mesh) | 698.2 m (the ellipsoid fallback) — both ≫ 2.5 m: the same no-push |

`verify-perf-baseline.mjs 9222 --quick --label t79` (the `on` vs `gateOff` cells, same boot):

| cell (`high`, DPR 2) | gate ON: dt p50 / cpu p50 / fps | gate OFF (same boot): dt / cpu / fps | gate counters over the ON window |
|---|---|---|---|
| orbit.u0 | **18.1 / 1.2 / 55** | 44.5 / 43.3 / 22 | 2,412 calls · 61,928 meshes seen · 61,928 skipped (50,374 box · 2,410 sphere · 9,144 scan) · 13 scans · 0 exact |
| orbit.u1 (ULTRA) | **21.0 / 1.3 / 47** | 44.3 / 42.8 / 22 | 2,118 · 54,270 / 54,270 · 16 scans |
| city.u0 (GPU-bound: gpu 41.6, draw 30, 2,230 calls, 13.7 M tris) | **37.0 / 6.0 / 27** | 49.0 / 6.8 / 20 | 2,664 · 41,488 / 41,488 |
| city.u1 (ULTRA) | 51.4 / 6.2 / 19 | 51.8 / 7.9 / 19 | 2,058 · 31,744 / 31,744 |
| everest.u0 | **17.9 / 0.9 / 56** | 32.2 / 31.4 / 31 | 2,424 · 34,322 / 34,322 |
| everest.u1 (ULTRA) | **20.3 / 0.7 / 49** | 32.3 / 31.1 / 31 | 2,170 · 30,682 / 30,682 |
| /m (mid, DPR 1.5) | **12.1 / 12.0 / 82** | 35.8 / 35.2 / 28 | 3,600 · 24,802 / 24,802 · 12 scans |
| fpv.u0 / fpv.u1 | 21.6 / 2.0 / 46 · 27.9 / 2.0 / 36 (gpu 24.0 / 30.0) | — (`adjustHeight` is off in FPV; the gate never arms: 0 calls) | MEASURE read 21–23 / 25.1 gpu — unchanged |

32 cells · 13.0 min · 0 structural failures · 0 boot failures. The slice-0 gate from the plan —
`orbit.u0.high.m0.on` cpu ≤ 5 ms and dt ≤ 20 ms (was 42 / 43), Everest cpu ≤ 5 (was 31), the FPV
cells unchanged — **passes**. Every gated call skipped every mesh it saw (`skipped == seen`) and the
ellipsoid pre-check never had to force the exact path (`exact 0`) at these poses. JSON + MD:
`verify-shots/perf/baseline-t79-dsf2-2026-09-05T23-26-00.{json,md}`.

**A residual the gate exposes:** the `/m` chart still spends 12 ms of main thread per frame with the
controls at ~0 — a second consumer on that route (T84 in the backlog; the desktop `/m` now runs at
82 fps, so it is a phone question).

Harness list (`ENGINE_STATE_2026-09-02.md` §8): `verify-rendering-charter` **85/85** (first run 80/85 — the RC3/RC4 pitch sweep read the REAL clock at 02:45 local, the rig correctly off at night; the sweep now pins `&t=1787133600000`, Dnipro midday, and re-ran 85/85) · `verify-ultra` **28/28** · `verify-meshedit` **PASS** · `verify-usermodels` **PASS 21 legs** · `verify-qaslice-cab` **65/65** · `verify-pin-reframe` **RED with the exact pre-existing T76 signature** (`heightAt(pin) = −2047` from the 976 km start; environment-shaped, unchanged by this slice). Every desktop suite ran against the GATED build.

## 6. Owner calls this slice surfaces (none taken here)

1. **`baseEarth` `raycast = () => {}`** — one line, and the 15 ms line item disappears even with the
   gate off. It changes behaviour in two corners: the controls' pointer picks (drag pivot, zoom point)
   through tile GAPS and over not-yet-loaded ground would fall to the ellipsoid instead of a surface
   1.9 km deep, and the controls' floor over unloaded ground would be the ellipsoid instead of that
   phantom. Both are corrections, both are changes — the gate makes the cost moot, so this is
   optional hygiene, not a fix.
2. **T80 bloom at `high`** — unchanged from MEASURE: a half-res / fewer-mip `UnrealBloomPass` is a
   pixel change at `high` (the byte-identical law); ULTRA-first or an explicit ruling.
3. **The orbit camera's rooftop clearance** — NOT changed by this slice (that was the point); the
   terrain-only raycast target remains available as a lever if the owner ever wants the camera to
   ignore rooftops.

## 7. Open after this slice

- The iPhone 17 Pro's FPV page dies 40–60 s after load (`MEASUREMENTS` §11) — kill vs hang: the
  Device Farm console videos decide; the 8k base-earth texture swap is the first hypothesis.
- `verify-pin-reframe` (T76) stays as classified in the receipt.
- The Pixel's `--device` path reads 0 for the bld/gnd LRU columns — a feed-id resolution gap in the
  harness, not the engine.
