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

export const VIEW_PREFS_KEY = "ftw:view-prefs:v1";

export interface ViewPrefs {
  /** SAT chip — ground style. */
  groundMode?: "dark" | "satellite";
  /** PIN chip — public pin markers on the globe. */
  pinsVisible?: boolean;
  /** ☀☾ chip — sun/moon guides. */
  skyGuides?: boolean;
  /** FPV BUILDINGS slider (0..1). */
  fpvBuildingSolidity?: number;
  /** BLD chip — the OSM2World enriched-bake variant (feeds `?enriched=` resolution at boot). */
  enrichedVariant?: boolean;
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
  /** TARGET panel GHOSTS — temporal ghost copies of the tracked body (QoL-2, owner 2026-08-14). */
  skyGhosts?: boolean;
  /** Ghost copies per time direction (1..15; the owner default is 4 each way = 8 total). */
  skyGhostCount?: number;
  /** Minutes between ghost copies (1..120). */
  skyGhostStepMin?: number;
}

/** Keep only known keys with the right types; clamp numerics. Pure — unit-tested directly. */
export function sanitizeViewPrefs(raw: unknown): ViewPrefs {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: ViewPrefs = {};
  if (r.groundMode === "dark" || r.groundMode === "satellite") out.groundMode = r.groundMode;
  if (typeof r.pinsVisible === "boolean") out.pinsVisible = r.pinsVisible;
  if (typeof r.skyGuides === "boolean") out.skyGuides = r.skyGuides;
  if (typeof r.fpvBuildingSolidity === "number" && Number.isFinite(r.fpvBuildingSolidity))
    out.fpvBuildingSolidity = Math.max(0, Math.min(1, r.fpvBuildingSolidity));
  if (typeof r.enrichedVariant === "boolean") out.enrichedVariant = r.enrichedVariant;
  // Sky-target keys, with the comet-era names as read-only fallbacks (new name wins): a blob
  // saved before the 2026-08-03 rename keeps its chip choices without a migration pass.
  const vis = typeof r.skyTargetVisible === "boolean" ? r.skyTargetVisible : r.cometVisible;
  if (typeof vis === "boolean") out.skyTargetVisible = vis;
  const hl = typeof r.skyTargetHighlight === "boolean" ? r.skyTargetHighlight : r.cometHighlight;
  if (typeof hl === "boolean") out.skyTargetHighlight = hl;
  if (typeof r.skyTargetTrail === "boolean") out.skyTargetTrail = r.skyTargetTrail;
  if (typeof r.skyTargetId === "string" && r.skyTargetId.length <= 80 && r.skyTargetId.includes(":"))
    out.skyTargetId = r.skyTargetId;
  if (typeof r.aimTarget === "boolean") out.aimTarget = r.aimTarget;
  if (typeof r.aimSun === "boolean") out.aimSun = r.aimSun;
  if (typeof r.aimMoon === "boolean") out.aimMoon = r.aimMoon;
  if (typeof r.skyGhosts === "boolean") out.skyGhosts = r.skyGhosts;
  if (typeof r.skyGhostCount === "number" && Number.isFinite(r.skyGhostCount))
    out.skyGhostCount = Math.max(1, Math.min(15, Math.round(r.skyGhostCount)));
  if (typeof r.skyGhostStepMin === "number" && Number.isFinite(r.skyGhostStepMin))
    out.skyGhostStepMin = Math.max(1, Math.min(120, Math.round(r.skyGhostStepMin)));
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
    const next = { ...loadViewPrefs(), [key]: value };
    localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — prefs are best-effort */
  }
}
