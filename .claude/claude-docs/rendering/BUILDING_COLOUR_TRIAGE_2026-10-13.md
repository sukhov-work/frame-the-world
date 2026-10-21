# BUILDING COLOUR — the triage (owner ask 3, 2026-10-13)

**Status: design + rung 1 shipped (2026-10-13); rungs 2–3 await an owner ruling; the photo flow (b) is BUILT as a desktop prototype (2026-10-18, `?facade=1` — DECISIONS 2026-10-18, `mem:project/wip-2026-10-18-photo-projection-prototype`; the owner's read 2026-10-21: "looks promising" → the full desktop flow is planned in `PHOTO_PROJECTION_PLAN_2026-10-21.md`). The §4 "RTC-safe per-draw matrix" turned out impossible in three (a non-ShaderMaterial's uniforms upload per material switch, not per draw — T165); the shipped route is a per-PASS view-space matrix on `-vViewPosition`.**
Owner's words: *"can we conditionally colour meshes (apart from user meshes) based on the colours on the map tiles below,
or some other mechanism? Buildings are mostly square primitives and in close views in a big city it is hard to distinguish
them … colours to distinguish, not textures … no pre-bake unless beneficial (Dnipro's bake exports are what I care about)
… the advanced story: take a photo from the street and project it onto the 3D geometry. TLDR: (a) a generic quick way to
make buildings minimally recognisable, (b) an advanced flow for users to use photos to enhance buildings."*

Research: four parallel tracks (data coverage, bake plumbing, runtime plumbing, imagery sampling + licence, prior art,
photo projection), every claim cited in `mem:project/wip-2026-10-13-collision-lighting-building-colour`. This file is
the decision record; the memory carries the evidence chain.

## 1. What the data can and cannot give (Dnipro, 128,649 footprints — the bake manifest)

| Signal | Coverage | Usable for |
|---|---|---|
| `building:colour` | 954 (0.74 %) | an override layer only |
| `roof:colour` | 1,433 (1.1 %) | an override layer only |
| `building:material` | ~1 % (sample; full count unverified — Overpass 504'd) | an override layer only |
| `roof:shape` | 3,943 (3.1 %) | already consumed by the extruder |
| `building:levels` | 16,891 (13.1 %) | height (consumed); a weak "era" proxy |
| `building=*` class | 100 % — but `yes` 49.6 %, `apartments` 26.2 %, `office` 7.7 %, `house` 2.7 %, `retail` 2.5 %, `commercial` 2.5 %, `garage(s)` 1.4 %, the rest < 1 % each (central sample) | a per-class palette — the ONE broad signal |
| Esri World Imagery under the footprint | every building | a **roof** colour (walls get roof-tinted massing); shadows / trees / leaf-on contaminate |

**Esri's terms bar a bake-time bulk sample** (Master Agreement E204 §3.2.c "may not otherwise scrape, download, or store
Data", §3.3.b no compiled derivative databases; E300 fn 10 "exporting volumes of basemap tiles is not permitted"; the
World Imagery item page: "not intended … to export tiles for offline"). A TRANSIENT, client-side read of the composite
the browser is already displaying — never persisted, never shipped — is defensible but not expressly licensed. Sentinel-2
(open, 10 m) is too coarse for a 20 m house. No open per-building roof-colour dataset exists for Ukraine.

Prior art (OSM2World, Streets.GL, F4 Map, OSMBuildings, Cesium OSM Buildings) all do the same thing: a light neutral
default, a per-class / per-material palette, `building:colour` as the override. None samples imagery.

## 2. The carrier — how a per-building colour reaches ONE shared material

The city is ONE `MeshStandardMaterial` per tileset (`scene/buildingMaterial.ts`, the one-material invariant; chained
`onBeforeCompile`, the per-building key `vFtwBId`, the R2 hash tone ±12 %, the U8 `_ftw_override` byte). Ranked:

1. **A per-cell palette `DataTexture` indexed by `_feature_id_0`** (one sampler written per draw in `onBeforeRender`,
   exactly like `uFtwTileSeed`; `texelFetch(uFtwPal, ivec2(int(vFtwFid), 0), 0)`; a 1,024 × 1 RGBA8 is 4 KB per cell).
   Zero wire bytes, no bake, any colour source (a sidecar class byte, an OSM tag, a transient imagery read), still one
   program. Refill on LRU reload. **The recommended carrier.**
2. A `_ftw_palette` float attribute (the `_ftw_override` precedent; absent → 0 → no-op): safe, +20 MB on the wire if baked.
3. `vertexColors: true` + `COLOR_0`: **unsafe as-is** — a geometry without a `color` attribute renders BLACK on
   `MeshStandardMaterial` (three loads `defaultAttributeValues` only for `ShaderMaterial`), +60 MB on the wire, and
   three's own `diffuseColor *= vColor` can only darken. Not this.

Night: any albedo tint vanishes after dark (T125 — "24 % of nothing is nothing"); distinguishability at night needs the
post-lighting floor idiom at `<opaque_fragment>`, if it is wanted at all.

## 3. The rungs (a) — generic quick recognisability

| Rung | What the user sees | Data / bake | Cost | Status |
|---|---|---|---|---|
| **1. Hue jitter** — the R2 hash drives a restrained HUE/chroma wobble on the day fill, not only a tone ± | neighbours differ in warmth and tint (cream / stone / grey / sand), every building its own | none | ~4 ALU | **SHIPPED 2026-10-13** (`BUILDINGS.hueVariation`, byte-identical at 0) |
| 2. Class palette — a sidecar byte per feature (`META_SCHEMA` 3, ~128 KB per city) from `building=*` + the 1 % colour tags as the override, carried by rung-1's DataTexture | apartments vs offices vs garages vs churches read as families; tagged buildings in their real colour | a re-bake of the enriched regions (Dnipro first); Cesium OSM tiles via the batch table's `building` property (in-tile presence UNVERIFIED) | 1 `texelFetch` | proposed |
| 3. Roof colour from the live composite — client-only, transient, behind a flag, never persisted | "that red-roofed one" | none shipped; a per-cell `getImageData` window once per cell load (~ms) | 1 `texelFetch` | proposed; licence grey |

Rung 1 needs the DAY fill from the lighting pass to be visible at all — on the slate fill (albedo 0.008) a hue is
invisible. The R3 lesson holds: a FLAT saturated tint reads as paint (owner 2026-07-13); rung 1 is a low-chroma wobble
around a warm grey, never a palette of colours.

## 4. The photo flow (b) — design (built 2026-10-18 as the desktop prototype; see the status line)

- **What exists.** A placed photo already carries a full projector basis: `PhotoFrustum.ts` → `{latDeg, lonDeg, altM,
  headingDeg, pitchDeg, rollDeg, hFovDeg, vFovDeg}` and `lib/geo/frustum.ts` returns the apex, forward/up/right and the
  far-face corners in ECEF; the photo texture is on the far-face plane (ADR D5 v1; "projective texturing onto tiles" is
  D5's named v2 stretch).
- **The prototype (S, zero shader surgery).** three's `SpotLight.map` IS projective texturing with occlusion: the spot's
  texture multiplies the direct light inside its cone and its own shadow map keeps it off occluded faces
  (`lights_fragment_begin.glsl.js:111-120`); both tilesets cast and receive. A placed photo = one `SpotLight` at the
  apex (`map` = the photo, `shadow.camera` fov/aspect = the frustum, `shadow.autoUpdate = false` + one `needsUpdate`).
  Limits: it is a LIGHT (daylight-dependent; it tints, it does not replace the albedo), ≤ 4 practical, the rectangle is
  inscribed in the cone. It answers the one question that decides everything: **do EXIF poses register against LOD1
  boxes at all** (77 % of Dnipro's heights are class defaults).
- **The real path (L).** A ≤ 4-projector uniform block in the shared material: `mat4 uFtwProj[4]`, the photo samplers,
  a depth map per photo (one render from a `PerspectiveCamera` at the apex into a depth target, once), per fragment:
  project → bounds → facing test → depth compare → `mix(diffuseColor, photo, k)`. Keep it projective at RUNTIME and
  persist only the pose (the pin already has it; the photo is the Wix Media file). Do NOT bake facade atlases: the bake
  writes no UVs, it would be an R2 upload per user edit, and it is textures (the owner's "no").
- **The two risks that decide it.** (1) REGISTRATION — GPS 3–15 m + heading error against boxes with guessed heights
  is a "wallpaper slide" unless the user aligns by hand (the nudge-to-align UX exists for photos; ALIGN for AR was
  removed 2026-09-30). (2) FLOAT32 — the buildings tileset is not re-centred; a projector matrix applied to 6.4e6 m
  positions swims ~0.5 m; it needs an RTC-safe per-draw matrix (the ULTRA precision discipline).
- **Moderation / C6.** A street photo projected onto a public building is user content on a public surface — it joins the
  pin moderation gate; a photo is never projected on a public pin at reduced precision.

## 5. Owner questions (not blocking)
1. Rung 1 shipped as a low-chroma wobble — right amount? (`BUILDINGS.hueVariation` is the knob; 0 = the plain grey city.)
2. Rung 2 means a re-bake of Dnipro (and the other regions) + a `META_SCHEMA` bump — worth it for the class families?
3. Rung 3 (the transient roof read): the licence stance above — proceed behind a flag, or leave it?
4. The photo prototype: a spotlight-projection spike on one of the owner's own street photos, to measure registration
   before any UI — go?
