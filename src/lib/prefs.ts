/**
 * View preferences — the tiny localStorage seam behind the camera-deck chips (owner 2026-07-21:
 * "PIN / SAT / BLD / sky / building-solidity choices must survive reloads"). One JSON blob under a
 * versioned key; every read sanitizes (junk / stale shapes degrade to defaults, never throw), every
 * write is fire-and-forget (private-mode / quota failures are silently absorbed — prefs are a
 * convenience, not state). SSR/tests-safe: no `localStorage` → loads return {}, saves no-op.
 *
 * NOT here: pinsVisible flips driven by the orchestrator's FPV declutter (StylizedTiles hides pins
 * on FPV entry through the same store setter) — only the PIN chip persists, so a reload mid-FPV
 * can't freeze the auto-hide as if the user chose it.
 */

import {
  sanitizeScoringPatch,
  type BestSpotScoringPatch,
} from "./geo/bestSpotScoring";

export const VIEW_PREFS_KEY = "ftw:view-prefs:v1";

export interface ViewPrefs {
  /** Blob revision stamp — written by every save. Rev < 2 marks a blob from before the
   *  2026-08-19b radar re-arm (see sanitize): those drop persisted FALSE for the aim/SHOW
   *  keys once, because the 2026-08-19 build could write offs the user never chose. */
  prefsRev?: number;
  /** SAT chip — ground style. */
  groundMode?: "dark" | "satellite";
  /** PIN chip — public pin markers on the globe. */
  pinsVisible?: boolean;
  /** ☀☾ chip — sun/moon guides. */
  skyGuides?: boolean;
  /** FPV BUILDINGS slider (0..1). */
  fpvBuildingSolidity?: number;
  /** BLD chip (desktop) / ▦ 3D DETAIL (/m) — 3D buildings on/off (owner rule 2026-08-18: the
   *  chips stopped being a variant A/B; WHICH bake streams is the registry's call —
   *  lib/globe/regions.ts best-variant-by-default). Replaces the retired `enrichedVariant`
   *  pref (stale keys in stored blobs are dropped by sanitize, harmlessly). */
  buildings3d?: boolean;
  /** MDL chip (MESH SUITE MS5) — everyone's uploaded 3D models on/off (default ON, the BLD
   *  recipe: a plain clause, no re-arm join). */
  modelsVisible?: boolean;
  /** TARGET panel SHOW — render the tracked sky target's tracer. (Renamed from the comet-era
   *  `cometVisible` 2026-08-03, phase C; sanitize still READS the old key so saved chip choices
   *  from the comet sessions survive — the next save rewrites them under the new name.) */
  skyTargetVisible?: boolean;
  /** TARGET panel MARK — the highlight reticle (and its daylight floor). Migrated from
   *  `cometHighlight` the same way. */
  skyTargetHighlight?: boolean;
  /** TARGET panel TRAIL — the projected day-arc trajectory (phase C; default ON). */
  skyTargetTrail?: boolean;
  /** Last-tracked sky target id (phase B) — restored lazily after boot (`store/sky`); resolves
   *  through `catalog.targetByIdAsync`, so even `ngc:`/`simbad:` ids survive a reload. */
  skyTargetId?: string;
  /** AIM systems (UPLIFT U4) — direction line + rise→set visibility cone on the 2D map, one
   *  flag per body. Sun/moon render compact unless emphasized; the emphasis itself is
   *  session-only (store/sky `aimFocus`), like TRACKING. */
  aimTarget?: boolean;
  aimSun?: boolean;
  aimMoon?: boolean;
  /** RADAR — master switch over the whole U4 aim overlay, both renderers (LAYERS batch,
   *  owner 2026-08-19). Per-body aim* flags survive underneath it. */
  aimVisible?: boolean;
  /** MY PLACES ON MAP — the member's saved-place markers on the 2D map (owner 2026-08-19). */
  savedPlacesOnMap?: boolean;
  /** VEC chip (desktop) / ▤ VECTOR (/m LAYERS) — the map-ink road/river/green ribbons
   *  (scene/vectorFeatures). Street-name labels stay on their own presence — the toggle kills
   *  the wash, not the content (owner batch #4 item 7, 2026-08-21). */
  vectorsVisible?: boolean;
  /** ULTRA HQ chip — DESKTOP-ONLY experimental (owner 2026-08-22h). Pins the quality tier to
   *  maximum regardless of measured frame time and pushes tile detail past the normal ceiling.
   *  **Default OFF** — the only key in this file whose default is false.
   *  The `/m` shell has NO surface for it and must never act on it: this blob is ONE
   *  localStorage key shared by both shells on the same origin, so a flag set on desktop IS
   *  present on `/m` in the same browser. The fence is not here — it is the single `hqAllowed`
   *  predicate every engine read is AND-ed with (StylizedTiles). Do not add a `/m` control. */
  ultraQuality?: boolean;
  /** DBG chip — the DESKTOP-ONLY debug HUD window (owner 2026-09-01). Same posture as
   *  `ultraQuality` above: **default OFF**, an instrument rather than a feature, and the blob
   *  is shared by both shells so the flag WILL be present on `/m` — the fence is the
   *  `hqExperimentsAllowed` predicate at the chip and the panel's own desktop gate, never this
   *  key. Observation-only: it opens a metrics window and activates the debugFeed collection
   *  hooks; it moves no look/tile lever. */
  debugHud?: boolean;
  /** TARGET panel GHOSTS — temporal ghost copies of the tracked body (QoL-2, owner 2026-08-14). */
  skyGhosts?: boolean;
  /** Ghost copies per time direction (1..15; the owner default is 4 each way = 8 total). */
  skyGhostCount?: number;
  /** Minutes between ghost copies (1..120). */
  skyGhostStepMin?: number;
  /**
   * BEST SPOT taste pass — the scoring **PATCH**, never the resolved profile (SPEC_V2 §5.7).
   *
   * Persisting the patch is what lets a future change to a shipped default propagate to every
   * field the owner never touched; persisting the resolved profile would freeze all ~45 leaves at
   * whatever they happened to be the day someone moved one slider. `sanitizeScoringPatch` copies
   * only keys it KNOWS, so a field removed in a later version is dropped rather than fatal, and
   * it applies the §5.5 safety/honesty clamps here at the READ — a hand-edited blob cannot smuggle
   * `access.aerialMinM: 0` (stand in the river) or `gates.minCoverage: 0` (claim knowledge nobody
   * has) past it. There is no key path from a patch to `BESTSPOT_SAFETY` at all.
   *
   * Same desktop-only caveat as `ultraQuality` above: `ftw:view-prefs:v1` is ONE localStorage key
   * shared by both shells on the same origin, so a tune saved on desktop IS present on `/m` in the
   * same browser. The fence is not here — it is the `!isMobileShell && !coarsePointerShell`
   * predicate every BEST SPOT engine read is AND-ed with. Do not add a `/m` control.
   *
   * NOT joined to the `rearmed` clause: that exists only to un-stick four default-ON radar keys a
   * 2026-08-19 build could persist false. This key has no boolean default to resurrect.
   */
  bestSpotTuning?: BestSpotScoringPatch;
}

/** Keep only known keys with the right types; clamp numerics. Pure — unit-tested directly. */
export function sanitizeViewPrefs(raw: unknown): ViewPrefs {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: ViewPrefs = {};
  // One-time radar re-arm (rev 2, owner regression report 2026-08-19b): the 2026-08-19 build
  // could persist offs the user never chose — UNFOLLOW wrote skyTargetVisible:false on every
  // use, and the then-unlabelled DISABLE DIRECTION row could flip the wrong body's aim flag
  // while that body was tracked. Un-stamped blobs drop persisted FALSE for those four keys
  // (their defaults are ON); deliberate offs re-persist stamped afterwards (saveViewPref
  // writes prefsRev on every save).
  const rearmed = typeof r.prefsRev === "number" && r.prefsRev >= 2;
  if (typeof r.prefsRev === "number" && Number.isFinite(r.prefsRev)) out.prefsRev = r.prefsRev;
  if (r.groundMode === "dark" || r.groundMode === "satellite") out.groundMode = r.groundMode;
  if (typeof r.pinsVisible === "boolean") out.pinsVisible = r.pinsVisible;
  if (typeof r.skyGuides === "boolean") out.skyGuides = r.skyGuides;
  if (typeof r.fpvBuildingSolidity === "number" && Number.isFinite(r.fpvBuildingSolidity))
    out.fpvBuildingSolidity = Math.max(0, Math.min(1, r.fpvBuildingSolidity));
  if (typeof r.buildings3d === "boolean") out.buildings3d = r.buildings3d;
  if (typeof r.modelsVisible === "boolean") out.modelsVisible = r.modelsVisible;
  // Sky-target keys, with the comet-era names as read-only fallbacks (new name wins): a blob
  // saved before the 2026-08-03 rename keeps its chip choices without a migration pass.
  const vis = typeof r.skyTargetVisible === "boolean" ? r.skyTargetVisible : r.cometVisible;
  if (typeof vis === "boolean" && (vis || rearmed)) out.skyTargetVisible = vis;
  const hl = typeof r.skyTargetHighlight === "boolean" ? r.skyTargetHighlight : r.cometHighlight;
  if (typeof hl === "boolean") out.skyTargetHighlight = hl;
  if (typeof r.skyTargetTrail === "boolean") out.skyTargetTrail = r.skyTargetTrail;
  if (typeof r.skyTargetId === "string" && r.skyTargetId.length <= 80 && r.skyTargetId.includes(":"))
    out.skyTargetId = r.skyTargetId;
  if (typeof r.aimTarget === "boolean" && (r.aimTarget || rearmed)) out.aimTarget = r.aimTarget;
  if (typeof r.aimSun === "boolean" && (r.aimSun || rearmed)) out.aimSun = r.aimSun;
  if (typeof r.aimMoon === "boolean" && (r.aimMoon || rearmed)) out.aimMoon = r.aimMoon;
  if (typeof r.aimVisible === "boolean") out.aimVisible = r.aimVisible;
  if (typeof r.savedPlacesOnMap === "boolean") out.savedPlacesOnMap = r.savedPlacesOnMap;
  if (typeof r.vectorsVisible === "boolean") out.vectorsVisible = r.vectorsVisible;
  // The desktop experimental toggle. A plain read with NO `rearmed` term: that clause exists
  // only to un-stick the four default-ON radar keys a 2026-08-19 build could persist false.
  // Joining it here would resurrect an opt-out into an opt-in — i.e. it would silently enable
  // a machine-hurting mode for users who never chose it.
  if (typeof r.ultraQuality === "boolean") out.ultraQuality = r.ultraQuality;
  // Same rule as ultraQuality: a plain read, NO `rearmed` term — an off-by-default instrument
  // has no boolean default to resurrect, and joining the re-arm would turn an opt-out into an
  // opt-in.
  if (typeof r.debugHud === "boolean") out.debugHud = r.debugHud;
  if (typeof r.skyGhosts === "boolean") out.skyGhosts = r.skyGhosts;
  if (typeof r.skyGhostCount === "number" && Number.isFinite(r.skyGhostCount))
    out.skyGhostCount = Math.max(1, Math.min(15, Math.round(r.skyGhostCount)));
  if (typeof r.skyGhostStepMin === "number" && Number.isFinite(r.skyGhostStepMin))
    out.skyGhostStepMin = Math.max(1, Math.min(120, Math.round(r.skyGhostStepMin)));
  // The BEST SPOT scoring patch — the one nested value in this blob, sanitized by its own module
  // (shape-driven: unknown keys and wrong types are dropped, the §5.5 clamps are applied).
  if (typeof r.bestSpotTuning === "object" && r.bestSpotTuning !== null)
    out.bestSpotTuning = sanitizeScoringPatch(r.bestSpotTuning);
  return out;
}

export function loadViewPrefs(): ViewPrefs {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(VIEW_PREFS_KEY);
    return raw ? sanitizeViewPrefs(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveViewPref<K extends keyof ViewPrefs>(key: K, value: ViewPrefs[K]): void {
  try {
    if (typeof localStorage === "undefined") return;
    // Every save stamps the blob revision — the rev-2 re-arm (sanitize) runs exactly until
    // the first post-fix save, after which deliberate offs persist again.
    const next = { ...loadViewPrefs(), prefsRev: 2, [key]: value };
    localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — prefs are best-effort */
  }
}
