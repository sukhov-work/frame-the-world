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
