/**
 * Debug HUD metric catalog (owner 2026-09-01) — display metadata for every metric the DBG
 * window shows. Pure data: the VALUES come from lib/globe/debugFeed (per-frame series +
 * provider snapshots polled by DebugPanel); this file says how each one reads — group, label,
 * format, sparkline/rate treatment, budget/threshold markers, and the TECHNICAL NOTE a
 * professional debug surface owes every number.
 *
 * Id grammar: `<provider>.<flat snapshot key>` (e.g. "tiles.gnd.dlLen"), or `series:<ring id>`
 * for the per-frame rings, or a panel-local source ("time.*", "mem.*", "workers.*" — read from
 * stores/browser APIs by DebugPanel itself; the import direction panel → store/lib is legal).
 *
 * Unit-tested (test/lib/globe/debugCatalog.test.ts): unique ids, known groups, non-empty
 * labels and notes, sane thresholds.
 */

import { MODELS } from "../../components/globe/tuning";

export type DebugGroupId =
  | "frame"
  | "renderer"
  | "quality"
  | "shadow"
  | "tiles"
  | "imagery"
  | "terrain"
  | "buildings"
  | "models"
  | "vector"
  | "camera"
  | "time"
  | "astro"
  | "planning"
  | "workers"
  | "system";

export const DEBUG_GROUPS: ReadonlyArray<{ id: DebugGroupId; title: string }> = [
  { id: "frame", title: "FRAME" },
  { id: "renderer", title: "RENDERER" },
  { id: "quality", title: "QUALITY" },
  { id: "shadow", title: "SHADOWS · ULTRA" },
  { id: "tiles", title: "TILE STREAMING" },
  { id: "imagery", title: "IMAGERY" },
  { id: "terrain", title: "TERRAIN" },
  { id: "buildings", title: "BUILDINGS" },
  { id: "models", title: "USER MODELS" },
  { id: "vector", title: "VECTOR · LABELS" },
  { id: "camera", title: "CAMERA" },
  { id: "time", title: "TIME" },
  { id: "astro", title: "ASTRO" },
  { id: "planning", title: "PLANNING" },
  { id: "workers", title: "WORKERS" },
  { id: "system", title: "SYSTEM" },
];

/** How a value renders. `ms1`/`float2` etc. fix the decimals so rows don't jitter width. */
export type DebugFormat =
  | "int"
  | "ms1"
  | "float2"
  | "float3"
  | "pct" // 0..1 → %
  | "mb1"
  | "deg1"
  | "m1"
  | "bool"
  | "text";

export interface DebugMetricDef {
  /** Value source id — see the grammar above. */
  id: string;
  label: string;
  group: DebugGroupId;
  fmt: DebugFormat;
  /** The technical note (InfoDot tip). ≤ ~200 chars — it must fit the tips.css bubble. */
  note: string;
  /** Keep a panel-side ring of polled values and draw a sparkline. */
  spark?: boolean;
  /** Cumulative-since-load counter: display as a differenced per-second rate (the RC11 rule). */
  rate?: boolean;
  /** Reference line for the sparkline / bar (same unit as the value). */
  budget?: number;
  /** Paint the value warn-amber above / below this (same unit as the value). */
  warnAbove?: number;
  warnBelow?: number;
}

export const DEBUG_METRICS: ReadonlyArray<DebugMetricDef> = [
  // ---- FRAME — the two clocks + whole-frame GPU-side counts --------------------------------
  {
    id: "series:frame.dt",
    label: "frame Δt",
    group: "frame",
    fmt: "ms1",
    spark: true,
    budget: 16.7,
    warnAbove: 35,
    note: "rAF-to-rAF spacing (cadence): includes vsync + compositor stalls, not just our work. Pushed before the RC21 gate, so skipped frames still count. Budget line = 60 Hz.",
  },
  {
    id: "series:frame.cpu",
    label: "orchestrator CPU",
    group: "frame",
    fmt: "ms1",
    spark: true,
    budget: 8,
    note: "tilesHandle.update() bracket — the 55-step orchestrator chain. Runs EVERY frame (the RC21 gate skips only GPU draws), so this is the cost a paused camera still pays.",
  },
  {
    id: "series:frame.draw",
    label: "draw submit",
    group: "frame",
    fmt: "ms1",
    spark: true,
    budget: 8,
    note: "composer.render() + PiP bracket, wall-clock. This is CPU-side SUBMIT time, not GPU time — a cheap submit can still queue an expensive GPU frame (see GPU ms).",
  },
  {
    id: "series:frame.gpu",
    label: "GPU frame",
    group: "frame",
    fmt: "ms1",
    spark: true,
    budget: 16.7,
    note: "EXT_disjoint_timer_query_webgl2, whole draw block. Results land 1–5 frames late; disjoint events are discarded. '—' = extension unavailable (Firefox/Safari/privacy).",
  },
  {
    id: "canvas.emaMs",
    label: "governor EMA",
    group: "frame",
    fmt: "ms1",
    spark: true,
    budget: 35,
    warnAbove: 35,
    note: "The smoothed frame time the tier governor ACTS on (α 0.1). Demote past budgetMs 35 sustained 100 frames; promote under restoreMs 13 sustained 240. Explains tier flips.",
  },
  {
    id: "canvas.hitches",
    label: "hitches",
    group: "frame",
    fmt: "int",
    rate: true,
    warnAbove: 0.5,
    note: "Frames over hitchMs 50 (≈3 missed 60 Hz frames), shown as Δ/s — the counter itself is cumulative since load and would read stale truth (the RC11 single-sample bug).",
  },
  {
    id: "mem.jsHeapMB",
    label: "JS heap",
    group: "frame",
    fmt: "mb1",
    spark: true,
    note: "performance.memory.usedJSHeapSize — Chrome-only, quantized, whole-tab JS heap (not GPU memory). A steady climb during idle orbit = a leak; sawtooth = normal GC.",
  },
  {
    id: "mem.longTasks",
    label: "long tasks",
    group: "frame",
    fmt: "int",
    rate: true,
    warnAbove: 0.2,
    note: "PerformanceObserver('longtask') count as Δ/s — main-thread blocks ≥50 ms from ANY source (decode, GC, React, extensions), a superset of what the frame brackets can see.",
  },

  // ---- RENDERER — three.js info + passes ---------------------------------------------------
  {
    id: "series:frame.calls",
    label: "draw calls",
    group: "renderer",
    fmt: "int",
    spark: true,
    note: "renderer.info.render.calls per WHOLE frame (shadow pass + composer + PiP): autoReset is off and the HUD resets once per rAF, so multi-pass frames report truthfully.",
  },
  {
    id: "series:frame.tris",
    label: "triangles",
    group: "renderer",
    fmt: "int",
    spark: true,
    note: "renderer.info.render.triangles per whole frame (instanced counts multiply). The library stores it fractionally — rounded here.",
  },
  {
    id: "canvas.infoGeometries",
    label: "geometries",
    group: "renderer",
    fmt: "int",
    spark: true,
    note: "renderer.info.memory.geometries — a live gauge (alloc/dispose), not a per-frame counter. A monotone climb while flying a loop = a geometry leak.",
  },
  {
    id: "canvas.infoTextures",
    label: "textures",
    group: "renderer",
    fmt: "int",
    spark: true,
    note: "renderer.info.memory.textures, live gauge. Tile streaming makes this breathe with the LRU; a climb with a parked camera is the anomaly.",
  },
  {
    id: "canvas.infoPrograms",
    label: "shader programs",
    group: "renderer",
    fmt: "int",
    note: "Compiled WebGL program count. A spike = an unintended material recompile (e.g. a live shadowMap.enabled flip recompiles the whole scene).",
  },
  {
    id: "canvas.bloom",
    label: "bloom pass",
    group: "renderer",
    fmt: "bool",
    note: "UnrealBloomPass.enabled — tier-gated AND flat-chart-gated per frame (~12 fullscreen draws appear/vanish on the flip).",
  },
  {
    id: "canvas.gtao",
    label: "GTAO pass",
    group: "renderer",
    fmt: "bool",
    note: "null = AO.enabled is false (not constructed — zero VRAM). Otherwise gated by tier high + low altitude; its GBuffer prepass is a full extra scene render.",
  },
  {
    id: "canvas.gateEnabled",
    label: "frame gate",
    group: "renderer",
    fmt: "bool",
    note: "RC21 on-demand rendering. SHIPS OFF (GATE.enabled false) — the predicate can't see all 40+ change sources, so maxStaleMs 200 is the only safety net when on.",
  },
  {
    id: "canvas.gateSkips",
    label: "gate skips",
    group: "renderer",
    fmt: "int",
    rate: true,
    note: "Skipped draws Δ/s (cumulative counter, differenced). Nonzero only with the RC21 gate on and the scene settled past restMs 6000.",
  },
  {
    id: "canvas.gateQuietAgeMs",
    label: "scene quiet age",
    group: "renderer",
    fmt: "ms1",
    budget: 6000,
    note: "ms since the last detected scene change (pose/sun/explicit dirty). The engine's own 'is anything still moving' clock — the RC21 settle window fills toward restMs 6000.",
  },
  {
    id: "canvas.pipActive",
    label: "PiP pass",
    group: "renderer",
    fmt: "bool",
    note: "The /m map window's scissored miniature. Off /m the render target is disposed — cost is exactly zero on desktop.",
  },
  {
    id: "canvas.pipRenders",
    label: "PiP renders",
    group: "renderer",
    fmt: "int",
    rate: true,
    note: "Full second scene renders Δ/s (pose-gated). Compare with PiP blits: blits/renders is the RC19 cache's saving; renders ≈ blits means the pose predicate keeps firing.",
  },
  {
    id: "canvas.pipBlits",
    label: "PiP blits",
    group: "renderer",
    fmt: "int",
    rate: true,
    note: "One-triangle re-presents Δ/s — every frame the PiP is up (anti-flicker; not skippable).",
  },

  // ---- QUALITY — tiers, governor, DPR ------------------------------------------------------
  {
    id: "canvas.tier",
    label: "renderer tier",
    group: "quality",
    fmt: "text",
    note: "The tier whose RENDERER levers are live (DPR, bloom, AO gate, composite base). Governor steps it from frame time between floor and ceiling; ULT pins it high.",
  },
  {
    id: "canvas.tileTier",
    label: "tile tier",
    group: "quality",
    fmt: "text",
    note: "The tier whose TILE levers are live. Diverges from renderer tier only while a promote's renderer half is parked in FPV (RC18) — divergence is the feature, not a bug.",
  },
  {
    id: "canvas.pendingTier",
    label: "pending tier",
    group: "quality",
    fmt: "text",
    note: "Non-null = a renderer-half tier change parked waiting for FPV exit (composer realloc + composite rebuild are exactly the wrong mid-viewfinder moment).",
  },
  {
    id: "canvas.deviceTier",
    label: "device tier",
    group: "quality",
    fmt: "text",
    note: "Boot-detected capability (GPU string, memory, cores, pointer). The governor's start point; low detection is capped low (frame time can't see memory pressure).",
  },
  {
    id: "canvas.tierChanges",
    label: "tier changes",
    group: "quality",
    fmt: "int",
    note: "Entries in the bounded tier log (max 50). Oscillation here = the governor thrashing between budget and restore — check EMA against the 35/13 ms thresholds.",
  },
  {
    id: "canvas.lastTierChange",
    label: "last change",
    group: "quality",
    fmt: "text",
    note: "Most recent tier step and its timestamp since page load.",
  },
  {
    id: "canvas.dpr",
    label: "effective DPR",
    group: "quality",
    fmt: "float2",
    note: "renderer.getPixelRatio() — min(devicePixelRatio, tier cap, lean cap, flat-chart cap). Only the renderer knows the winner; compare with the raw devicePixelRatio row.",
  },
  {
    id: "canvas.devicePixelRatio",
    label: "screen DPR",
    group: "quality",
    fmt: "float2",
    note: "window.devicePixelRatio — the glass. Effective DPR below this = a cap is active (tier, lean, or headless governing).",
  },
  {
    id: "canvas.ultra",
    label: "ULTRA pinned",
    group: "quality",
    fmt: "bool",
    note: "The ULT chip's live pin: tier forced high regardless of frame time. Governor keeps stepping (EMA stays honest) but its results are dropped while pinned.",
  },
  {
    id: "canvas.ultraBoot",
    label: "ULTRA at boot",
    group: "quality",
    fmt: "bool",
    note: "The shadow rig is construction-time (8k map, shadowMap.enabled). pinned ≠ boot means the chip was flipped this session — reload for the full rig (the chip's amber dot).",
  },
  {
    id: "canvas.mapFlat",
    label: "flat-chart mode",
    group: "quality",
    fmt: "bool",
    note: "The engine's real flat-map latch (nadir 2D treatment: bloom off, photographic grade, no shadow twins). Not the same thing as the /m mapMode store field.",
  },
  {
    id: "canvas.fpvActive",
    label: "FPV active",
    group: "quality",
    fmt: "bool",
    note: "First-person view owns the camera: controls disabled, tier renderer-half deferrals armed, closest-first load bias on.",
  },

  // ---- SHADOWS · ULTRA ---------------------------------------------------------------------
  {
    id: "ultra.on",
    label: "ULTRA look",
    group: "shadow",
    fmt: "bool",
    note: "The look half of the ULT chip (tuning.ULTRA). With this false every shader term is mix(legacy, ultra, 0) and eased scalars snap to exactly 0 — 'off' is exact.",
  },
  {
    id: "ultra.settled",
    label: "look settled",
    group: "shadow",
    fmt: "bool",
    note: "The engine's own settle latch: true once every eased ULTRA term has snapped to baseline and stepUltraLook early-returns. False while any dusk/exposure ease converges.",
  },
  {
    id: "ultra.sunElevDeg",
    label: "sun elev @focus",
    group: "shadow",
    fmt: "deg1",
    spark: true,
    note: "asin(sunDir · focusUp) — THE input to every ULTRA band curve (day/exposure/haze/key-extinction/afterglow…). All the bars below are functions of this one number.",
  },
  {
    id: "ultra.exposure",
    label: "exposure",
    group: "shadow",
    fmt: "float2",
    spark: true,
    note: "renderer.toneMappingExposure, eased at τ 950 ms (S11). OutputPass re-reads it every render. A FROZEN value while the sun moves means stepUltraLook stopped running.",
  },
  {
    id: "ultra.keyLevel",
    label: "key level",
    group: "shadow",
    fmt: "float2",
    spark: true,
    note: "sunLight.intensity / nominal — the keyExtinctCurve's measured output. The T67 quirk: stacking with GOLDEN.keyBrighten peaks it ~1.29 near 9° (the one non-monotone spot).",
  },
  {
    id: "ultra.directK",
    label: "direct-sun K",
    group: "shadow",
    fmt: "float2",
    note: "How much direct sun survives extinction — drives the key AND the ground's direct/ambient split so walls and ground dim together (the 2026-08-27 dusk lesson).",
  },
  {
    id: "ultra.skyLevel",
    label: "sky level",
    group: "shadow",
    fmt: "float2",
    note: "The air-light's LUMINANCE term. hazeK says how much of the far field is air; this says how bright that air is — its absence made dusk far fields glow (defect 2).",
  },
  {
    id: "ultra.afterglow",
    label: "afterglow",
    group: "shadow",
    fmt: "float2",
    note: "Sun-side glow outliving the sky level below the horizon, applied through the Mie lobe. Keyed on GEOMETRIC solar elevation — a sun behind a ridge still glows (T68, open).",
  },
  {
    id: "ultra.haze",
    label: "aerial haze",
    group: "shadow",
    fmt: "float2",
    note: "The ground's effective, gated, eased uFtwHaze — the exact value buildings and dome are handed (one shared FTW_AERIAL_GLSL keeps them from diverging).",
  },
  {
    id: "ultra.shadow.casting",
    label: "sun casting",
    group: "shadow",
    fmt: "bool",
    note: "sunLight.castShadow — altitude- and sun-elevation-gated. False at high orbit or deep night is normal; false at street noon is the finding.",
  },
  {
    id: "ultra.shadow.mapPx",
    label: "shadow map px",
    group: "shadow",
    fmt: "int",
    note: "Read off the LIGHT post-clamp (three silently clamps past maxTextureSize). 8192² costs ~512 MiB (RGBA8 colour attachment + D24 — a directional target is 2× depth-only).",
  },
  {
    id: "ultra.shadow.mPerTexel",
    label: "m / texel",
    group: "shadow",
    fmt: "float2",
    note: "Ortho extent ÷ map size — shadow crispness at the focus. RC27's rollback-decision metric for shadowMapSize.",
  },
  {
    id: "ultra.shadow.coverM",
    label: "shadow reach",
    group: "shadow",
    fmt: "m1",
    note: "Furthest ground distance any live box covers. Against view-fit: the pre-cascade single box covered 8–35 % of a mountain frame — the 2026-08-27 defect 1.",
  },
  {
    id: "ultra.shadow.viewFitM",
    label: "view fit",
    group: "shadow",
    fmt: "m1",
    note: "The ground distance the frame actually shows — the denominator for shadow reach. reach ≥ fit = the whole frame is shadow-covered.",
  },
  {
    id: "ultra.cas1.active",
    label: "cascade 1",
    group: "shadow",
    fmt: "bool",
    note: "Nested ladder box 1 (reach 60 km / 4096²). Dropped (false) when its need is within 5 % of the box below — an idle cascade is free.",
  },
  {
    id: "ultra.cas1.ageMs",
    label: "cascade 1 age",
    group: "shadow",
    fmt: "ms1",
    budget: 1500,
    warnAbove: 5000,
    note: "ms since this cascade's depth map was re-rendered (refresh on extent/terrain/eye/key change, else at 1500 ms staleness). An age that only climbs = refresh policy dead.",
  },
  {
    id: "ultra.cas2.active",
    label: "cascade 2",
    group: "shadow",
    fmt: "bool",
    note: "Ladder box 2 (reach 260 km / 2048²) — the horizon-scale box. Both cascades are zero-intensity lights (they may shadow, never light).",
  },
  {
    id: "ultra.cas2.ageMs",
    label: "cascade 2 age",
    group: "shadow",
    fmt: "ms1",
    budget: 1500,
    warnAbove: 5000,
    note: "Same staleness clock as cascade 1; the far box refreshes rarely by design (16 km centre quantization).",
  },

  // ---- TILE STREAMING (bld = OSM buildings · gnd = terrain+imagery · enr = enriched R2) ----
  {
    id: "tiles.bld.dlLen",
    label: "bld ⬇ queue",
    group: "tiles",
    fmt: "int",
    spark: true,
    note: "Buildings download queue depth (waiting). Deep + jobs pinned at max = network-bound; deep + jobs low = traversal-bound. Tier caps: 25/12/8 jobs.",
  },
  {
    id: "tiles.bld.parseLen",
    label: "bld parse queue",
    group: "tiles",
    fmt: "int",
    spark: true,
    note: "Parse is MAIN-THREAD glb decode — this queue is the hitch you feel. Tier caps 5/3/2 jobs.",
  },
  {
    id: "tiles.bld.visible",
    label: "bld visible",
    group: "tiles",
    fmt: "int",
    note: "Library stats: tiles currently visible after traversal. used − visible = traversal work that produced nothing on screen.",
  },
  {
    id: "tiles.bld.inCache",
    label: "bld in cache",
    group: "tiles",
    fmt: "int",
    note: "Tiles resident in this renderer's LRU (itemSet). Distinct from bytes — many small tiles can fill the item cap before the byte cap.",
  },
  {
    id: "tiles.bld.failed",
    label: "bld failed",
    group: "tiles",
    fmt: "int",
    warnAbove: 0,
    note: "Library stats.failed — never surfaced before this HUD. Climbing on buildings = ion trouble; on enriched = a bad bake or a missing ?v= cell.",
  },
  {
    id: "tiles.bld.lruMB",
    label: "bld LRU MB",
    group: "tiles",
    fmt: "mb1",
    spark: true,
    note: "Resident bytes vs the min/max band. cached == min is the T34 thrash signature (rest-trim re-fetching on every mode flip).",
  },
  {
    id: "tiles.gnd.dlLen",
    label: "gnd ⬇ queue",
    group: "tiles",
    fmt: "int",
    spark: true,
    note: "Ground (terrain + imagery composite) download queue. This renderer keeps ancestors + library ordering — it is the terrain stand-in under the camera.",
  },
  {
    id: "tiles.gnd.parseLen",
    label: "gnd parse queue",
    group: "tiles",
    fmt: "int",
    spark: true,
    note: "Quantized-mesh decode + composite work on the main thread.",
  },
  {
    id: "tiles.gnd.visible",
    label: "gnd visible",
    group: "tiles",
    fmt: "int",
    note: "Visible terrain tiles after traversal.",
  },
  {
    id: "tiles.gnd.failed",
    label: "gnd failed",
    group: "tiles",
    fmt: "int",
    warnAbove: 0,
    note: "Failed terrain/imagery tile loads (cumulative). See also the Esri sentinel rows under TERRAIN — coverage fallbacks are counted separately.",
  },
  {
    id: "tiles.gnd.lruMB",
    label: "gnd LRU MB",
    group: "tiles",
    fmt: "mb1",
    spark: true,
    note: "Ground LRU resident bytes. The flip bank (see bank ms) holds the floor near the cap after a 2D↔FPV flip so the other mode's tiles survive the round trip (RC20).",
  },
  {
    id: "tiles.gnd.bankMsLeft",
    label: "gnd bank ms",
    group: "tiles",
    fmt: "ms1",
    note: "LRU flip-bank window remaining (45 s hold). Reads 0 forever on tier high and under ULTRA — the bank is a low/mid-tier protection.",
  },
  {
    id: "tiles.enr.dlLen",
    label: "enr ⬇ queue",
    group: "tiles",
    fmt: "int",
    spark: true,
    note: "Enriched-cell GLBs from R2 (loadAncestors false, shallow tree) — a deep queue here is R2 latency, not traversal.",
  },
  {
    id: "tiles.enr.inCache",
    label: "enr in cache",
    group: "tiles",
    fmt: "int",
    note: "Enriched cells resident in the library LRU. '—' = no enriched tileset attached (region without a bake, or BLD off).",
  },
  {
    id: "tiles.enr.failed",
    label: "enr failed",
    group: "tiles",
    fmt: "int",
    warnAbove: 0,
    note: "Failed enriched-cell loads — a bad bake or a 404'd ?v= version shows up here first.",
  },
  {
    id: "tiles.lat.gndMeanMs",
    label: "gnd load latency",
    group: "tiles",
    fmt: "ms1",
    spark: true,
    note: "download-start → model-ready mean over a 32-ring (network + parse). The probe's own in-flight count is independent of library stats.downloading.",
  },
  {
    id: "tiles.lat.pending",
    label: "loads in flight",
    group: "tiles",
    fmt: "int",
    note: "Probe-tracked in-flight loads across all three renderers (cap 512). Divergence from stats.downloading = aborted fetches that never paired an event.",
  },
  {
    id: "tiles.aim.active",
    label: "closest-first",
    group: "tiles",
    fmt: "bool",
    note: "U5 look-biased download ordering — active exactly while FPV is on (bias k 1.5). Ground is never biased (it must load the stand-in beneath the camera first).",
  },
  {
    id: "tiles.fovea.on",
    label: "foveation",
    group: "tiles",
    fmt: "bool",
    note: "U6 load regions (look-ray + eye bubble tighten error targets; periphery relaxes). Tier high runs without foveation — null cfg = plugin present, zero cost.",
  },
  {
    id: "tiles.bld.frozen",
    label: "queues frozen",
    group: "tiles",
    fmt: "bool",
    warnAbove: 0,
    note: "autoUpdate false = the 9-queue visibility freeze is engaged (hidden tab / pagehide). True on a VISIBLE tab is the iOS resume bug.",
  },

  // ---- IMAGERY -----------------------------------------------------------------------------
  {
    id: "tiles.img.composites",
    label: "live composites",
    group: "imagery",
    fmt: "int",
    note: "Overlay composite textures currently alive (plugin reach: overlayInfo → tileInfo). '—' = the reach broke, which is itself a finding (library internals moved).",
  },
  {
    id: "tiles.img.zMin",
    label: "imagery z min",
    group: "imagery",
    fmt: "int",
    note: "Shallowest Esri source zoom the level chooser resolved for a live composite (calculateLevel over resolution/range). Caps: z≤19 fine-pointer, z≤18 coarse.",
  },
  {
    id: "tiles.img.zMax",
    label: "imagery z max",
    group: "imagery",
    fmt: "int",
    note: "Deepest live Esri source zoom. Pinned a level shallow with a 256 composite — the QA-7 lesson: composite px, DPR cap and z cap move together.",
  },
  {
    id: "tiles.img.queueLen",
    label: "compositor queue",
    group: "imagery",
    fmt: "int",
    spark: true,
    note: "The 10th queue — ImageOverlayPlugin's own processQueue (maxJobs 10). NOT covered by the visibility freeze; it keeps compositing on a hidden tab.",
  },
  {
    id: "terrain.overlayPxEff",
    label: "composite px",
    group: "imagery",
    fmt: "int",
    note: "Effective overlay composite resolution. RATCHETS UP ONLY (stickyOverlayPx, one writer) — lowering it on a mode flip reintroduces the QA-7b rebuild storm.",
  },
  {
    id: "terrain.overlayRebuilds",
    label: "overlay rebuilds",
    group: "imagery",
    fmt: "int",
    warnAbove: 1,
    note: "Fresh-instance overlay rebuilds. Invariant: ≤1 per rung post-boot. Each one destroys every composited texture — a climb is the QA-7b storm (white chart, load storm).",
  },
  {
    id: "terrain.esri.sentinels",
    label: "esri sentinels",
    group: "imagery",
    fmt: "int",
    note: "'Map data not available' tiles detected by the coverage fallback (RC5).",
  },
  {
    id: "terrain.esri.substituted",
    label: "esri substituted",
    group: "imagery",
    fmt: "int",
    note: "Sentinels replaced by an upscaled ancestor.",
  },
  {
    id: "terrain.esri.drawn",
    label: "sentinels drawn",
    group: "imagery",
    fmt: "int",
    warnAbove: 0,
    note: "The only state that still shows the user a 'Map data not available' tile — sentinel seen, no ancestor available.",
  },

  // ---- TERRAIN -----------------------------------------------------------------------------
  {
    id: "terrain.epoch",
    label: "terrain epoch",
    group: "terrain",
    fmt: "int",
    rate: true,
    note: "Monotone load-model counter shown as Δ/s — the streaming pulse (absolute value is meaningless). Also the memo-invalidation and cascade-refresh trigger.",
  },
  {
    id: "terrain.memo.hits",
    label: "height memo hits",
    group: "terrain",
    fmt: "int",
    rate: true,
    note: "Terrain-height memo hits Δ/s (RC11). The memo drops whole on terrain-epoch change, so a hit is as fresh as a raycast. Capacity 100k entries.",
  },
  {
    id: "terrain.memo.misses",
    label: "height memo misses",
    group: "terrain",
    fmt: "int",
    rate: true,
    note: "Misses Δ/s = actual down-raycasts (0.018–0.067 ms each). High misses with a settled camera = something re-asks unmemoizable questions.",
  },
  {
    id: "terrain.memo.entries",
    label: "memo entries",
    group: "terrain",
    fmt: "int",
    budget: 100000,
    note: "Live memo size vs the 100k capacity. Overflows climbing = the capacity is too small for this session's footprint set.",
  },
  {
    id: "terrain.pick.parentWinRate",
    label: "parent-win rate",
    group: "terrain",
    fmt: "pct",
    note: "How often the DEEPEST terrain hit beat the nearest one (RC6 — crossfading coarse parents sit above fine meshes over relief). DEV builds only — counting is DEV-gated.",
  },
  {
    id: "terrain.patchRewrites",
    label: "GLO-30 tiles",
    group: "terrain",
    fmt: "int",
    note: "Tile content URIs rewritten to the GLO-30 patch (Dnipro ≤z13, Everest ≤z13). 0 inside a patched region = the patch is dead and CWT is silently serving.",
  },

  // ---- BUILDINGS ---------------------------------------------------------------------------
  {
    id: "buildings.attached",
    label: "OSM attached",
    group: "buildings",
    fmt: "bool",
    note: "Cesium OSM buildings group is in the scene (BLD chip + /m 2D auto-detach compose here). Rendered truth — group membership, not a flag.",
  },
  // ---- USER MODELS — MESH SUITE MS5: residency IS the density story ---------------------------
  {
    id: "models.world",
    label: "world rows",
    group: "models",
    fmt: "int",
    note: "Model records the world read answered for the current geohash cover (p5 cells around the ground focus); 0 above the fetch ceiling.",
  },
  {
    id: "models.resident",
    label: "resident",
    group: "models",
    fmt: "int",
    budget: MODELS.maxResident,
    note: "Models with their GLB fetched and in the scene — closest first under the count cap and the triangle budget, with hysteresis on the radius.",
  },
  {
    id: "models.loading",
    label: "loading",
    group: "models",
    fmt: "int",
    note: "GLB fetches in flight (each ≤ 8 MiB, concurrency-capped); a burst after a camera move is normal.",
  },
  {
    id: "models.skipped",
    label: "skipped nearby",
    group: "models",
    fmt: "int",
    warnAbove: 0,
    note: "Models inside the load radius the triangle budget or count cap refused — the physical-density warning's number (the MDL chip turns amber).",
  },
  {
    id: "models.tris",
    label: "resident tris",
    group: "models",
    fmt: "int",
    budget: MODELS.triBudget,
    warnAbove: MODELS.densityWarnTris,
    note: "Triangles of the resident models (the records' counts) against the budget that protects the frame — no quota (owner 2026-09-01c), a warning instead.",
  },
  {
    id: "models.failed",
    label: "failed loads",
    group: "models",
    fmt: "int",
    warnAbove: 0,
    note: "GLB fetches that errored — never retried by the plan until the row changes; a served-URL or CORS problem to chase.",
  },
  {
    id: "models.cover",
    label: "cover cells",
    group: "models",
    fmt: "int",
    note: "Geohash p5 cells the last world read named (≤ 16; a 4 km cover is 4–9 cells).",
  },
  {
    id: "models.mine",
    label: "mine",
    group: "models",
    fmt: "int",
    note: "The member's own model rows — the only armable ones at MS5; 0 while anonymous or unresolved.",
  },
  {
    id: "buildings.cells",
    label: "enriched cells",
    group: "buildings",
    fmt: "int",
    note: "Baked cells resident and registered (Dnipro ~101 at full residency). '—' = no enriched tileset for this region.",
  },
  {
    id: "buildings.priorityCells",
    label: "priority cells",
    group: "buildings",
    fmt: "int",
    budget: 4,
    note: "The look-biased top-K cells the seat sweep prioritises (re-ranked every 30 frames). Shares the U5 bias law — streaming front and seating front are one number apart.",
  },
  {
    id: "buildings.seatEpoch",
    label: "seat epoch",
    group: "buildings",
    fmt: "int",
    rate: true,
    note: "Bumps only on frames that WROTE seating deltas — shown as Δ/s. Zero while quiet is the healthy settled state.",
  },
  {
    id: "buildings.seatQuietFrames",
    label: "seat quiet",
    group: "buildings",
    fmt: "int",
    budget: 90,
    note: "Frames since the last seat write. PLAN rebuilds the skyline only past 90 quiet frames — this bar filling is why the skyline waits after streaming.",
  },
  {
    id: "buildings.deferred",
    label: "seat deferrals",
    group: "buildings",
    fmt: "int",
    rate: true,
    note: "NEW (this HUD): null-TERRAIN sample deferrals Δ/s — the budget burn on footprints whose ground isn't loaded. The uncounted number behind the RC7 49.7 % stall.",
  },
  {
    id: "buildings.rejected",
    label: "seat rejections",
    group: "buildings",
    fmt: "int",
    rate: true,
    note: "Plausibility-gate rejections Δ/s (RC8 — sample too far from the cell seat). Zero over a whole steep-terrain session is itself a finding.",
  },
  {
    id: "buildings.seatCacheHits",
    label: "seat cache hits",
    group: "buildings",
    fmt: "int",
    rate: true,
    note: "Warm cell re-entries served from the seat cache Δ/s (survives LRU evictions; cleared on variant switch).",
  },

  // ---- VECTOR · LABELS ---------------------------------------------------------------------
  {
    id: "vector.mvt.parsed",
    label: "MVT parsed",
    group: "vector",
    fmt: "int",
    budget: 56,
    note: "Parsed vector tiles resident (cache cap 56, z14, ring 1 around focus). Eviction is oldest-first past the cap.",
  },
  {
    id: "vector.mvt.pending",
    label: "MVT pending",
    group: "vector",
    fmt: "int",
    note: "Vector tiles fetched but not yet parsed — in flight against the OpenFreeMap tile build.",
  },
  {
    id: "vector.mvt.failed",
    label: "MVT failed",
    group: "vector",
    fmt: "int",
    warnAbove: 0,
    note: "Failed vector tiles NEVER refetch by design (no churn) — a rising count is permanent for the session.",
  },
  {
    id: "vector.mvt.version",
    label: "MVT version",
    group: "vector",
    fmt: "int",
    rate: true,
    note: "Bumps on parse AND eviction — a change signal Δ/s, not a load count.",
  },
  {
    id: "vector.labels.entries",
    label: "street labels",
    group: "vector",
    fmt: "int",
    note: "Resident street-name labels (dying ones still fade in the scene). Selection budget rides the tier: 40/28/16.",
  },
  {
    id: "vector.labels.budget",
    label: "label budget",
    group: "vector",
    fmt: "int",
    note: "The tier's simultaneous-label cap (setMaxVisible).",
  },

  // ---- CAMERA ------------------------------------------------------------------------------
  {
    id: "camera.altM",
    label: "camera alt",
    group: "camera",
    fmt: "m1",
    spark: true,
    note: "TRUE per-frame geodetic altitude (getPositionElevation — spherical length()−a is ~21 km off at mid-latitudes). The store mirror is deadbanded 0.5 % at ~5 Hz.",
  },
  {
    id: "camera.nearM",
    label: "near plane",
    group: "camera",
    fmt: "m1",
    note: "GlobeControls' dynamic near — scales with altitude. near/far ratio drives depth precision; the charter's M1 measured it via CDP.",
  },
  {
    id: "camera.farM",
    label: "far plane",
    group: "camera",
    fmt: "m1",
    note: "Dynamic far. Eight modules anchor impostors off camera.far (sun/moon/stars/atmosphere…) — never take it over locally (audit #25).",
  },
  {
    id: "camera.fovDeg",
    label: "vertical FOV",
    group: "camera",
    fmt: "deg1",
    note: "Live camera FOV. The app prints TWO focal readouts from this: height-based 24 mm-equiv (HUD) and width-based (aim stick) — they legitimately disagree off 3:2 (T41).",
  },
  {
    id: "camera.fpv.active",
    label: "FPV",
    group: "camera",
    fmt: "bool",
    note: "First-person view: camera pinned at an eye with controls.enabled false (adjustCamera called manually per frame or the near/far fit freezes).",
  },
  {
    id: "camera.fpv.yawDeg",
    label: "FPV yaw",
    group: "camera",
    fmt: "deg1",
    note: "Live FPV heading (deg, compass). The store's fpvHud mirror runs at ~20 Hz; this is the raw closure value.",
  },
  {
    id: "camera.fpv.pitchDeg",
    label: "FPV pitch",
    group: "camera",
    fmt: "deg1",
    note: "Live FPV pitch (deg; positive looks up). Clamped by FPV.maxPitchDeg; the #f= hash carries it at 1 dp.",
  },
  {
    id: "camera.fpv.eyeAboveGroundM",
    label: "eye above ground",
    group: "camera",
    fmt: "m1",
    note: "Eye height over the RENDERED terrain (not the ellipsoid). Clamped ≥ terrain+1.7 on photo apexes — D4 distrusts EXIF vertical GPS.",
  },
  {
    id: "camera.fpv.walkOffsetM",
    label: "walk offset",
    group: "camera",
    fmt: "m1",
    note: "Metres walked from the pin (WASD/joystick). Only INPUT mutates it — a head-turn never does (the fpv-walk-orbit bug class).",
  },
  {
    id: "camera.flightActive",
    label: "flight",
    group: "camera",
    fmt: "bool",
    note: "A cinematic glide owns the camera (createFlight). Direct manipulation cancels.",
  },
  {
    id: "camera.exploreState",
    label: "explore",
    group: "camera",
    fmt: "text",
    note: "The ambient pin journey's state machine: inactive/arming/cruising/dwelling/fallback.",
  },
  {
    id: "camera.frameCount",
    label: "orchestrator frames",
    group: "camera",
    fmt: "int",
    rate: true,
    note: "update() invocations Δ/s — the orchestrator's own heartbeat, gate-independent (RC21 skips draws, never update()).",
  },
  {
    id: "camera.updateErrors",
    label: "update errors",
    group: "camera",
    fmt: "int",
    warnAbove: 0,
    note: "Orchestrator per-frame exceptions (throttle-logged 1/2 s to console, previously unreadable). Nonzero = a step is throwing and the try/catch is eating it.",
  },

  // ---- TIME --------------------------------------------------------------------------------
  {
    id: "time.sceneIso",
    label: "scene instant",
    group: "time",
    fmt: "text",
    note: "sceneTimeMs() — derived from the play anchor per read; the time store is never written at 60 fps (playbackNowMs is pure).",
  },
  {
    id: "time.live",
    label: "LIVE",
    group: "time",
    fmt: "bool",
    note: "Pinned vs live wall clock. Share links only carry &t= when NOT live.",
  },
  {
    id: "time.playRate",
    label: "play rate",
    group: "time",
    fmt: "text",
    note: "Scene-seconds per real second (60/600/3600 presets); '—' = paused/pinned.",
  },
  {
    id: "time.driftH",
    label: "drift vs now",
    group: "time",
    fmt: "float2",
    note: "Hours between the scene instant and the wall clock — reveals a scrub that walked far from now, the state most panels silently assume away.",
  },

  // ---- ASTRO -------------------------------------------------------------------------------
  {
    id: "astro.sampleAgeMs",
    label: "ephemeris age",
    group: "astro",
    fmt: "ms1",
    budget: 1000,
    warnAbove: 2500,
    note: "Scene-ms since the 1 Hz bodyStatesAt sample (the sun drifts 0.004°/s — 1 s is sub-pixel). Amber = the resample gate is wedged.",
  },
  {
    id: "astro.sunElevDeg",
    label: "sun elevation",
    group: "astro",
    fmt: "deg1",
    spark: true,
    note: "Topocentric, airless, at the view focus (asin(sunDir·up)). Twilight bands: 0 to −6 civil, −12 nautical, −18 astronomical.",
  },
  {
    id: "astro.moonElevDeg",
    label: "moon elevation",
    group: "astro",
    fmt: "deg1",
    note: "Topocentric moon elevation at the focus. The geocentric direction differs by up to ~0.95° — two moon diameters.",
  },
  {
    id: "astro.moonIllum",
    label: "moon illum",
    group: "astro",
    fmt: "pct",
    note: "Illuminated fraction. Compare moon Ks: the K&S-1991 brightness is NOT linear in it — a quarter moon is ~9 % of full, not 50 %.",
  },
  {
    id: "astro.moonKs",
    label: "moon Ks",
    group: "astro",
    fmt: "float3",
    note: "Krisciunas–Schaefer 1991 phase intensity (1 = full). Drives moonlight key intensity and ground shadow opacity at night.",
  },
  {
    id: "astro.targetId",
    label: "tracked target",
    group: "astro",
    fmt: "text",
    note: "The sky store's target (default comet 10P/Tempel). Comet/asteroid positions are a universal-variable Kepler solve inside the 1 Hz sample.",
  },
  {
    id: "astro.targetMag",
    label: "target mag",
    group: "astro",
    fmt: "float2",
    note: "Apparent magnitude from the best model (observed > JPL > engine > catalog > HG); null when no model applies (e.g. a shower radiant).",
  },
  {
    id: "astro.ecl.phase",
    label: "solar eclipse",
    group: "astro",
    fmt: "text",
    note: "Topocentric solar eclipse phase, computed EVERY frame (arithmetic only — no engine call): geocentric separation missed a real 88 %-obscured partial by 0.94°.",
  },
  {
    id: "astro.ecl.coverage",
    label: "obscuration",
    group: "astro",
    fmt: "pct",
    note: "Disc-AREA fraction covered. The almanac's 'magnitude' is the DIAMETER fraction — a different number, shown separately.",
  },
  {
    id: "astro.ecl.daylightK",
    label: "daylight K",
    group: "astro",
    fmt: "float3",
    note: "The eclipse daylight scalar every consumer multiplies by (γ 0.8 encodes limb darkening; floor 0.04). Exactly 1 with no eclipse — a provable no-op.",
  },
  {
    id: "astro.lun.phase",
    label: "lunar eclipse",
    group: "astro",
    fmt: "text",
    note: "Geocentric (rides the 1 Hz sample). penumbralMag is carried separately because astronomy-engine reports obscuration 0 for penumbral eclipses.",
  },

  // ---- PLANNING ----------------------------------------------------------------------------
  {
    id: "planning.anchorKind",
    label: "plan anchor",
    group: "planning",
    fmt: "text",
    note: "The anchor ladder: photo apex > FPV eye > view focus. Focus anchors get almanac chips only — no eye, no skyline.",
  },
  {
    id: "planning.coverage",
    label: "skyline coverage",
    group: "planning",
    fmt: "pct",
    budget: 0.5,
    warnBelow: 0.5,
    note: "Fraction of the 120 azimuth bins with real horizon evidence (a null march leaves a bin UNKNOWN, not clear). Below 0.5 no radar claims skyline gaps (WS4 honesty).",
  },
  {
    id: "planning.terrainBin",
    label: "profile build",
    group: "planning",
    fmt: "int",
    budget: 120,
    note: "The sliced horizon build's terrain-march cursor (3 bins/frame, then 2 meshes/frame). terrainBin/120 is the real 'why is the skyline not ready' fraction.",
  },
  {
    id: "planning.scanAgeMs",
    label: "crossing scan age",
    group: "planning",
    fmt: "ms1",
    budget: 300000,
    note: "Real-ms since the sun/moon/target skyline-crossing scans ran (throttle 900 ms; stale after 5 min of scrubbing).",
  },
  {
    id: "planning.bs.spawned",
    label: "BEST SPOT worker",
    group: "planning",
    fmt: "bool",
    note: "The solver worker spawns lazily on the first job and lives until dispose (cancellation is cooperative between rungs — never terminate()).",
  },
  {
    id: "planning.bs.inFlight",
    label: "BS jobs in flight",
    group: "planning",
    fmt: "int",
    note: "Pending solver jobs. Nonzero for one rung after a cancel is cooperative lag, not a leak.",
  },
  {
    id: "planning.bs.drops",
    label: "BS drops",
    group: "planning",
    fmt: "int",
    warnAbove: 0,
    note: "Results discarded on a scoringHash mismatch — nonzero means scoring was edited mid-solve.",
  },
  {
    id: "planning.bs.firstInkMs",
    label: "BS first ink",
    group: "planning",
    fmt: "ms1",
    budget: 120,
    note: "Coarse-rung latency of the last solve (target ≤120 ms warm; refined ≤1200 ms).",
  },

  // ---- WORKERS -----------------------------------------------------------------------------
  {
    id: "workers.decodePhase",
    label: "decode phase",
    group: "workers",
    fmt: "text",
    note: "The RAW pipeline: exifr preview on main → libraw-wasm demosaic in a PER-FILE worker (terminated on settle for a fresh wasm heap — 'no worker' is the steady state).",
  },
  {
    id: "workers.decodeProgress",
    label: "decode progress",
    group: "workers",
    fmt: "pct",
    note: "Stage relay from the decode worker (upload.decodeProgress).",
  },
  {
    id: "workers.decodeMs",
    label: "last decode",
    group: "workers",
    fmt: "ms1",
    note: "Wall time of the last full demosaic (26 MP ≈ 80–104 MB transient heap; buffers freed immediately — C1).",
  },
  {
    id: "planning.bs.solving",
    label: "BS solving",
    group: "workers",
    fmt: "bool",
    note: "store.solving — derived from inFlight > 0, not a separate flag. Served through the engine provider: store/bestSpot is import-fenced to the seam's owners.",
  },
  {
    id: "planning.bs.tilesPending",
    label: "BS tiles pending",
    group: "workers",
    fmt: "bool",
    note: "The BEST SPOT solve is still waiting on terrain tiles before it can claim coverage (store.tilesPending).",
  },

  // ---- SYSTEM (static — read once) ---------------------------------------------------------
  {
    id: "system.gpu",
    label: "GPU",
    group: "system",
    fmt: "text",
    note: "WEBGL_debug_renderer_info unmasked string ('(blocked)' under privacy hardening — the tier detector then defaults to mid).",
  },
  {
    id: "system.cores",
    label: "CPU cores",
    group: "system",
    fmt: "int",
    note: "navigator.hardwareConcurrency — a tier-detection signal.",
  },
  {
    id: "system.deviceMemoryGB",
    label: "device memory",
    group: "system",
    fmt: "int",
    note: "navigator.deviceMemory (Chrome, capped at 8 by spec) — '—' elsewhere.",
  },
  {
    id: "system.maxTextureSize",
    label: "max texture",
    group: "system",
    fmt: "int",
    note: "gl.MAX_TEXTURE_SIZE — clamps the 8k earth textures and the ULTRA shadow map (three clamps silently; the shadow row reads the light post-clamp).",
  },
  {
    id: "system.msaaSamples",
    label: "MSAA samples",
    group: "system",
    fmt: "int",
    note: "The composer's HalfFloat target runs 4× MSAA; the default framebuffer is antialias:false on purpose (only OutputPass's triangle draws there).",
  },
  {
    id: "system.precision",
    label: "shader precision",
    group: "system",
    fmt: "text",
    note: "highp/mediump — three's resolved fragment precision.",
  },
  {
    id: "system.coarsePointer",
    label: "coarse pointer",
    group: "system",
    fmt: "bool",
    note: "The mobile/lean signal: caps tier at mid, arms the lean DPR/bloom/shadow profile, and fences the DBG/ULT chips off.",
  },
  {
    id: "canvas.gpuTimer",
    label: "GPU timer ext",
    group: "system",
    fmt: "bool",
    note: "EXT_disjoint_timer_query_webgl2 availability — false on Firefox/Safari and under fingerprint protection; the GPU ms row shows '—' there.",
  },
  {
    id: "canvas.ctxLost",
    label: "context lost",
    group: "system",
    fmt: "bool",
    warnAbove: 0,
    note: "WebGL context lost (iOS jetsam/heat path). The loop stops rendering entirely while true; restore reallocs the composer chain.",
  },
  {
    id: "canvas.hidden",
    label: "page hidden",
    group: "system",
    fmt: "bool",
    note: "document.hidden — explains a dead FPS trace without a bug hunt (the tick early-outs and re-seats the governor clock).",
  },
];

/** The on-demand heavy probes (scene traversals) — rendered as buttons, never polled. */
export const DEBUG_ACTIONS: ReadonlyArray<{
  id: string;
  label: string;
  group: DebugGroupId;
  note: string;
}> = [
  {
    id: "buildings.seats",
    label: "SCAN SEATS",
    group: "buildings",
    note: "enriched.debugSeats() — a full cell × part × feature walk (~39k features for Dnipro) plus skirt/pickFence passes. Convergence, unseated backlog, per-ring m5, sidecar coverage.",
  },
  {
    id: "ultra.terrainCensus",
    label: "SCAN TERRAIN CAST",
    group: "shadow",
    note: "Walks the whole ground tile group: casters, FrontSide shadowSide (the silent-fail trap), and the skirt-clip pair — skirtClipped ≠ skirtGroups is the library-drift alarm.",
  },
  {
    id: "ultra.anisoCensus",
    label: "SCAN ANISO/MIPS",
    group: "imagery",
    note: "Walks every live overlay composite: anisotropy taps, mip-chain depth, real texture bytes vs level-0 bytes (the library's 4/3 accounting under-reports hand-built chains).",
  },
];
