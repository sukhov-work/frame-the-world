/**
 * U8 per-building height overrides — the localStorage-backed store (UPLIFT_PLAN §2/U8).
 * Pure + three-free: key/row shapes, sanitize, the capped persistence, the owner's per-edit
 * clamp band ("twice as low or triple as high", 2026-08-18), the drag→scale mapping, and the
 * rounded-centroid checksum that invalidates rows when a re-bake reshuffles feature ids.
 *
 * NOT the prefs blob: `sanitizeViewPrefs` keeps only known fixed keys, so an unbounded
 * per-building map stored there would be silently destroyed on the next read (lib/prefs.ts).
 * Own versioned key + insertion-capped map instead — the ttlCache write discipline.
 *
 * Value = `k`, the building's height SCALE vs its BAKED height (1 = original). A scale about
 * the live base commutes with the seat writer's incremental `+= dy` translation
 * (scene/enrichedBuildings.ts applyFeatureSeats), which is why the override is multiplicative,
 * never an absolute Y rewrite.
 *
 * Identity: bake-sequential `_FEATURE_ID_0` is NOT re-bake-stable, so rows key on
 * `(variant, cellUri, featureId)` and carry a pristine-centroid checksum (X/Z only — the
 * runtime mutates Y; bake-local metres are deterministic from the bake alone) + the run vertex
 * count. Mismatch after a re-bake ⇒ the row is ignored and dropped. The baker now carries the
 * OSM element id into `cell-*.meta.json` sidecars, so a future re-bake upgrades keys to stable
 * OSM ids (next phase).
 *
 * C6 note: overrides describe OSM building geometry — no user GPS, no coordinates beyond the
 * bake-local checksum. Local-only this phase; the batch DB sync (next phase) reuses these rows
 * via `unsyncedEntries`/`markSynced`.
 */

export const BLDG_OVERRIDES_KEY = "ftw:bldg-overrides:v1";

/** Max persisted overrides — oldest-updated rows are trimmed at write (ttlCache discipline). */
export const OVERRIDES_CAP = 1000;

/** Per-EDIT clamp band (owner 2026-08-18: one edit may halve or triple the CURRENT height).
 *  Edits compound across sessions; the absolute band below is the safety rail. */
export const EDIT_MIN_K = 0.5;
export const EDIT_MAX_K = 3;

/** Absolute scale band vs the BAKED height — keeps compounded edits sane. */
export const SCALE_MIN_K = 0.1;
export const SCALE_MAX_K = 10;

/** Checksum tolerance (m) on the stored 0.5 m-rounded centroid — loose enough to survive
 *  rounding-boundary flapping, tight enough that a reshuffled id lands on a different footprint. */
export const CENTROID_TOL_M = 1.5;

/** |k − 1| below this = "back to original" → the row is deleted, not stored. */
export const NEUTRAL_K_EPS = 0.005;

export interface OverrideRow {
  /** Height scale vs the BAKED height (1 = original; never neutral — those rows are deleted). */
  k: number;
  /** Pristine run-centroid X/Z (bake-local metres, 0.5 m-rounded) — the re-bake checksum. */
  cx: number;
  cz: number;
  /** Run vertex count — free second checksum discriminator. */
  vc: number;
  /** Baked height (m) at capture — display ("original height") + the future sync payload. */
  hM: number;
  /** Updated-at (epoch ms). */
  t: number;
  /** Synced-at (epoch ms) — set by the next-phase batch DB sync; absent/older than `t` = dirty. */
  s?: number;
}

/** key = `${variant}|${cellUri}|${featureId}` (variant/cell names are slugs — no `|`). */
export type OverrideMap = Record<string, OverrideRow>;

export function overrideKey(variant: string, cellUri: string, featureId: number): string {
  return `${variant}|${cellUri}|${featureId}`;
}

export function parseOverrideKey(
  key: string,
): { variant: string; cellUri: string; featureId: number } | null {
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const featureId = Number(parts[2]);
  if (!parts[0] || !parts[1] || !Number.isInteger(featureId) || featureId < 0) return null;
  return { variant: parts[0], cellUri: parts[1], featureId };
}

/** Keep only structurally valid rows (finite fields, k inside the absolute band, non-neutral);
 *  junk degrades to "no override", never a throw. Pure — unit-tested directly. */
export function sanitizeOverrides(raw: unknown): OverrideMap {
  if (typeof raw !== "object" || raw === null) return {};
  const out: OverrideMap = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!parseOverrideKey(key) || typeof val !== "object" || val === null) continue;
    const r = val as Record<string, unknown>;
    const k = r.k;
    const cx = r.cx;
    const cz = r.cz;
    const vc = r.vc;
    const hM = r.hM;
    const t = r.t;
    if (
      typeof k !== "number" || !Number.isFinite(k) || k < SCALE_MIN_K || k > SCALE_MAX_K ||
      Math.abs(k - 1) < NEUTRAL_K_EPS ||
      typeof cx !== "number" || !Number.isFinite(cx) ||
      typeof cz !== "number" || !Number.isFinite(cz) ||
      typeof vc !== "number" || !Number.isInteger(vc) || vc <= 0 ||
      typeof hM !== "number" || !Number.isFinite(hM) || hM <= 0 ||
      typeof t !== "number" || !Number.isFinite(t)
    )
      continue;
    const row: OverrideRow = { k, cx, cz, vc, hM, t };
    if (typeof r.s === "number" && Number.isFinite(r.s)) row.s = r.s;
    out[key] = row;
  }
  return out;
}

export function loadOverrides(): OverrideMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(BLDG_OVERRIDES_KEY);
    return raw ? sanitizeOverrides(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Persist the map, trimming the OLDEST-updated rows past the cap. Mutates `map` (the caller
 *  keeps holding it). Silent on storage failure — overrides degrade, never break the scene. */
export function saveOverrides(map: OverrideMap): void {
  try {
    if (typeof localStorage === "undefined") return;
    const keys = Object.keys(map);
    if (keys.length > OVERRIDES_CAP) {
      keys.sort((a, b) => map[a].t - map[b].t);
      for (const k of keys.slice(0, keys.length - OVERRIDES_CAP)) delete map[k];
    }
    localStorage.setItem(BLDG_OVERRIDES_KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota — best-effort */
  }
}

/** Upsert (or delete, when `k` is neutral) + persist in one step. */
export function upsertOverride(
  map: OverrideMap,
  key: string,
  row: Omit<OverrideRow, "t">,
  nowMs: number,
): void {
  if (Math.abs(row.k - 1) < NEUTRAL_K_EPS) delete map[key];
  else map[key] = { ...row, t: nowMs };
  saveOverrides(map);
}

export function deleteOverride(map: OverrideMap, key: string): void {
  delete map[key];
  saveOverrides(map);
}

/** Round to the checksum grid (0.5 m). */
export function roundCentroidM(x: number): number {
  return Math.round(x * 2) / 2;
}

/** Does a stored row still describe this run? Tolerance compare (never string equality — the
 *  0.5 m grid flaps at boundaries) + exact vertex count. */
export function checksumMatches(
  row: Pick<OverrideRow, "cx" | "cz" | "vc">,
  cx: number,
  cz: number,
  vc: number,
): boolean {
  return (
    vc === row.vc &&
    Math.abs(cx - row.cx) <= CENTROID_TOL_M &&
    Math.abs(cz - row.cz) <= CENTROID_TOL_M
  );
}

/** The per-edit clamp (owner band about the height the edit STARTED at, then the absolute rail). */
export function clampEditK(editStartK: number, proposedK: number): number {
  const lo = Math.max(SCALE_MIN_K, editStartK * EDIT_MIN_K);
  const hi = Math.min(SCALE_MAX_K, editStartK * EDIT_MAX_K);
  return Math.max(lo, Math.min(hi, proposedK));
}

/** Map a vertical drag to a proposed scale: screen-up grows. `dyPx` is pointer-down minus
 *  current clientY (positive = dragged up); metres-per-px grows with camera distance so a
 *  building fills a similar screen fraction per gesture at any range. Pure — the caller passes
 *  the tunables (tuning.ENRICHED.override*). */
export function dragScaleK(
  editStartK: number,
  dyPx: number,
  distM: number,
  bakedHeightM: number,
  cfg: { gainPerM: number; minDistM: number; maxDistM: number },
): number {
  const d = Math.max(cfg.minDistM, Math.min(cfg.maxDistM, distM));
  const deltaM = dyPx * cfg.gainPerM * d;
  const proposed = editStartK + deltaM / Math.max(1, bakedHeightM);
  return clampEditK(editStartK, proposed);
}

/** Rows the next-phase batch sync still needs to push (never synced, or edited since). */
export function unsyncedEntries(map: OverrideMap): Array<[string, OverrideRow]> {
  return Object.entries(map).filter(([, r]) => r.s === undefined || r.s < r.t);
}

/** Stamp rows as synced (called by the next-phase sync on success). Persists. */
export function markSynced(map: OverrideMap, keys: readonly string[], atMs: number): void {
  for (const k of keys) if (map[k]) map[k].s = atMs;
  saveOverrides(map);
}
