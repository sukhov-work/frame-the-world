# Convention — Globe Tuning & Scene Modules

The globe (`src/components/globe/`) is the product's signature scene and it accretes visual detail
every phase. This contract keeps it tunable and stops `StylizedTiles.ts` from re-bloating.
Established 2026-07-10 with the tuning refactor; the layout below is the verified state.

## The two-file rule
- **Structure** (geometry, shader plumbing, event wiring, lifecycle) lives in a scene module.
- **Numbers** (grades, scale heights, altitude gates, motion timing, endpoints, asset ids) live in
  **`src/components/globe/tuning.ts`** — one exported group per scene concern (`EARTH`, `ATMOSPHERE`,
  `STARS`, `GATES`, `DRIFT`, `CONTROLS`, `TILESETS`, …).
- **No magic numbers in scene code.** If a reviewer could ask "why 0.45?", the value belongs in
  `tuning.ts` with a doc line. Structural constants (Rec.709 luma weights, bayer matrices, pole
  guards, `0.5`-style half-lambert algebra) stay inline — they are math, not taste.

## tuning.ts rules
- **Pure data.** No `three` import, no side effects. Vectors are `readonly [x, y, z]` tuples;
  THREE objects are constructed at the use site.
- **No colours.** Colour flows ONLY through the GL token bridge `lib/theme/tokens.ts` (ADR D14).
  A tuning entry may *name* which token a module uses, never define a colour literal.
- **Every entry documented**: what it does, unit (metres unless stated), and provenance — mark the
  browser-VERIFIED look's values so a retune knows what baseline it departs from.
- Ellipsoid constants come from `lib/geo/projection.ts` (re-exported by tuning.ts). Never redeclare
  `WGS84_*` — the 2026-07-10 refactor removed a drifted duplicate.
- Cross-cutting values live here precisely so "must match" comments die: e.g. `SUN.direction` feeds
  the earth shader, the ground grade AND GlobeCanvas's DirectionalLight from one constant.

## GLSL tunables
Two mechanisms — pick by whether the value animates:
- **Runtime-animated / DEV-tweakable** → a uniform, default seeded from tuning
  (`uNightFloor: { value: EARTH.nightFloor }`). Exposed on `window.__globe` in DEV for live tuning.
- **Baked constants** (ramps, gains that never animate) → injected into the shader template via
  **`glf()`** from `scene/glsl.ts` (`smoothstep(${glf(EARTH.coastBand[0])}, …)`). `glf` formats a JS
  number as a GLSL float literal (`2` → `"2.0"` — GLSL ES rejects int-typed floats). Editing one
  re-instantiates the material on next page load; that's the intended tune loop.

## Scene-module idiom
One concern per file under `src/components/globe/scene/`:
```
attachX(scene, opts) → { <objects/uniforms the orchestrator gates>, update?(ctx), dispose() }
```
- The module owns its full lifecycle: creates its objects, adds them to the scene, and `dispose()`
  removes + frees everything it made (shared materials disposed exactly once, per-tile geometry on
  `dispose-model`).
- `update()` takes plain values (`alt`, `elapsedS`, …) computed ONCE per frame by the orchestrator
  (`StylizedTiles.ts`) — modules never re-derive altitude (geodetic `getPositionElevation` only;
  spherical `length()-a` is ~21 km off at mid-latitudes).
- The orchestrator owns: camera pose, GlobeControls, idle drift, per-frame gate evaluation, the
  try/catch around the frame, and `__globe` DEV introspection. New scene features (frustum, sky,
  pins) follow the same attach-module shape — the orchestrator should stay ~200 lines.
- Decorations set `raycast = () => {}` so GlobeControls never picks them.

## Traps that keep resurfacing (violations = bugs)
- **Chain, never assign, `onBeforeCompile`** on imagery-tile materials — TilesFadePlugin already
  wrapped it (`const prev = mat.onBeforeCompile; mat.onBeforeCompile = (s, r) => { prev?.(s, r); mine(s); }`).
- Colour textures = `SRGBColorSpace`; data textures (mask/elevation/normal) = `NoColorSpace`
  (an sRGB tag on data decode-darkens it — the original near-black-globe bug).
- Anything camera-relative must respect GlobeControls' **dynamic far plane** (it once hid both the
  starfield and the atmosphere's far hemisphere).
- Keep `tuning.ts` import-safe for non-globe code (GlobeCanvas, tests): pure TS module, no WebGL.
