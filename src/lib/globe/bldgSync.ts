/**
 * MESH SUITE MS3 (2026-09-02) — the client half of D2, world-shared building edits: the merge
 * policy between MY rows (the local `ftw:bldg-overrides:v1` map — dirty edits, pending resets and
 * synced copies of what I pushed) and the WORLD's rows (fetched from /api/building-overrides), the
 * SYNC payload, and the two lookups the engine's load-model seam asks for (the rows of one cell ·
 * a row by OSM id). Pure, three-free, storage-free — the orchestrator (StylizedTiles) owns the
 * fetch, the store, the persistence and the engine calls; everything here is unit-tested directly.
 *
 * THE POLICY (MESH_SUITE_PLAN §8):
 *  · LOCAL PENDING WINS. A dirty row or a tombstone is my edit in flight: it applies here, masks
 *    the world's row for that building, and rides the next SYNC — where last-committer-wins on
 *    the server means mine lands last. Nothing a member did is ever silently replaced by a fetch.
 *  · SHARED WINS OVER MY SYNCED COPY. A synced local row is only a cache of what I pushed; on a
 *    COMPLETE fetch the server's version replaces it (someone may have re-edited since) and a
 *    synced row the server no longer has is deleted here (someone reset it). A PARTIAL fetch
 *    (`complete: false` — the endpoint's page cap) never deletes anything.
 *  · A RESET of a building the world knows is a TOMBSTONE (`d: 1`), never a plain delete —
 *    otherwise the shared row would re-apply at the next load and RESET would look broken. The
 *    tombstone becomes a `removes` entry on SYNC and dies once the removal lands.
 *  · Fetch-before-push keeps the reconciliation honest, but a failed fetch does not block the
 *    push: LWW makes an un-reconciled push safe, merely opinionated.
 *  · OSM RECOVERY. Rows carry the building's OSM id (`o`). The engine's load-model sweep asks
 *    `byOsmId` for every feature its fingerprint pass did not cover, so a row whose bake-sequential
 *    key died in a re-bake still finds its building — the §4a-2 dual key, never a hard cutover.
 */

import {
  finishSync,
  isTombstone,
  overrideKey,
  parseOverrideKey,
  rowTransform,
  sanitizeRow,
  unsyncedEntries,
  type OverrideMap,
  type OverrideRow,
} from "./bldgOverrides";
import type { FeatureTransform } from "./featureTransform";
import type { OverrideRemoveKey, OverrideSyncEntry, PublicOverride } from "../wix/overrideRecords";

/** Where an applied edit comes from: my local map, or the world's fetched rows. */
export type OverrideOrigin = "mine" | "shared";

/** The world's rows for the resolved variant, keyed by the local key grammar. In memory only —
 *  re-fetched every boot and before every SYNC; never persisted (the local map is MINE). */
export type SharedMap = Map<string, OverrideRow>;

/** What a building's edit is, as the chip and the hover note describe it. */
export type OverrideOriginLabel = "none" | "shared" | "dirty" | "synced";

/** One row as the engine's load-model seam consumes it. */
export interface EffectiveOverride {
  key: string;
  cellUri: string;
  featureId: number;
  row: OverrideRow;
  xf: FeatureTransform;
  origin: OverrideOrigin;
}

export const isDirty = (row: OverrideRow): boolean => row.s === undefined || row.s < row.t;

/** A world row (the public GET shape) → the local key + row grammar, or null for junk (the server
 *  clamps, this re-sanitizes — a store never half-applies). `updatedAt` becomes the row's `t`. */
export function sharedRowFromPublic(
  p: PublicOverride,
  nowMs: number,
): { key: string; row: OverrideRow } | null {
  // The wire is ours, but a fetch body is still input: the key parts must be what the key
  // grammar expects, or the row is junk (a `|` in a cell name would forge a different key).
  if (
    typeof p.variant !== "string" || p.variant.length === 0 || p.variant.includes("|") ||
    typeof p.cell !== "string" || p.cell.length === 0 || p.cell.includes("|") ||
    !Number.isInteger(p.featureId) || p.featureId < 0
  )
    return null;
  const t = typeof p.updatedAt === "number" && Number.isFinite(p.updatedAt) ? p.updatedAt : nowMs;
  const row = sanitizeRow({
    sy: p.heightScale,
    sx: p.sx,
    sz: p.sz,
    rotDeg: p.rotDeg,
    tE: p.tE,
    tN: p.tN,
    tU: p.tU,
    cx: p.cx,
    cz: p.cz,
    vc: p.vc,
    hM: p.bakedHeightM,
    t,
    s: t,
    o: p.osmId ?? undefined,
  });
  return row ? { key: overrideKey(p.variant, p.cell, p.featureId), row } : null;
}

/** Wix Data reads lag writes by about a second (browser-measured 2026-09-02f: a GET issued right
 *  after a landed push did not yet list the row, and a remove of it counted 0). A synced local
 *  row younger than this is never judged "gone on the server" — the fetch may simply predate it. */
export const SYNC_READ_LAG_GRACE_MS = 15_000;

/** Fold a fetch into the two maps. `shared` is REPLACED by `rows`; `local` is reconciled per the
 *  policy above (mutated in place — the caller persists it when `changed > 0`). */
export function reconcileShared(
  local: OverrideMap,
  shared: SharedMap,
  rows: ReadonlyArray<{ key: string; row: OverrideRow }>,
  complete: boolean,
  nowMs: number,
  graceMs: number = SYNC_READ_LAG_GRACE_MS,
): { changed: number } {
  shared.clear();
  for (const { key, row } of rows) shared.set(key, row);
  let changed = 0;
  for (const [key, srow] of shared) {
    const l = local[key];
    if (!l || isDirty(l)) continue; // my pending edit / reset masks the world's row until SYNC
    // A synced copy → refresh it from the world (someone may have re-edited since I pushed).
    local[key] = { ...srow, s: nowMs };
    changed++;
  }
  if (complete) {
    for (const key of Object.keys(local)) {
      const l = local[key];
      if (isDirty(l) || shared.has(key)) continue;
      if (nowMs - (l.s ?? 0) <= graceMs) continue; // just pushed — the read may lag the write
      delete local[key]; // synced here, gone on the server: someone reset it
      changed++;
    }
  }
  return { changed };
}

/** The chip's / hover note's word for a building's edit. */
export function originOf(local: OverrideMap, shared: SharedMap, key: string): OverrideOriginLabel {
  const l = local[key];
  if (l) return isDirty(l) ? "dirty" : "synced";
  return shared.has(key) ? "shared" : "none";
}

export const dirtyCount = (local: OverrideMap): number => unsyncedEntries(local).length;

/**
 * The lookups the engine's load-model seam asks for, built lazily from both maps and thrown away
 * on any change (`invalidate`). Local rows win by key; a tombstone contributes no geometry but
 * MASKS — by key, and by OSM id when it carries one, so a re-baked twin of a reset building does
 * not come back through the recovery sweep.
 */
export class OverrideIndex {
  private byCell: Map<string, EffectiveOverride[]> | null = null;
  private byOsm: Map<string, EffectiveOverride | null> | null = null;

  constructor(
    private readonly variant: string,
    private readonly local: OverrideMap,
    private readonly shared: SharedMap,
  ) {}

  invalidate(): void {
    this.byCell = null;
    this.byOsm = null;
  }

  /** The effective rows of one cell (local ∪ shared, local precedence, tombstones masked). */
  forCell(cellUri: string): EffectiveOverride[] {
    return this.ensure().byCell.get(cellUri) ?? [];
  }

  /** The effective row carrying this OSM id, null when none or masked by a pending reset. */
  byOsmId(osm: string): EffectiveOverride | null {
    return this.ensure().byOsm.get(osm) ?? null;
  }

  private ensure(): { byCell: Map<string, EffectiveOverride[]>; byOsm: Map<string, EffectiveOverride | null> } {
    if (this.byCell && this.byOsm) return { byCell: this.byCell, byOsm: this.byOsm };
    const byCell = new Map<string, EffectiveOverride[]>();
    const byOsm = new Map<string, EffectiveOverride | null>();
    const push = (e: EffectiveOverride) => {
      const arr = byCell.get(e.cellUri);
      if (arr) arr.push(e);
      else byCell.set(e.cellUri, [e]);
      if (e.row.o && !byOsm.has(e.row.o)) byOsm.set(e.row.o, e);
    };
    const seen = new Set<string>();
    for (const [key, row] of Object.entries(this.local)) {
      const k = parseOverrideKey(key);
      if (!k || k.variant !== this.variant) continue;
      seen.add(key);
      if (isTombstone(row)) {
        if (row.o) byOsm.set(row.o, null);
        continue;
      }
      push({ key, cellUri: k.cellUri, featureId: k.featureId, row, xf: rowTransform(row), origin: "mine" });
    }
    for (const [key, row] of this.shared) {
      if (seen.has(key)) continue;
      const k = parseOverrideKey(key);
      if (!k || k.variant !== this.variant) continue;
      push({ key, cellUri: k.cellUri, featureId: k.featureId, row, xf: rowTransform(row), origin: "shared" });
    }
    this.byCell = byCell;
    this.byOsm = byOsm;
    return { byCell, byOsm };
  }
}

export interface SyncPayload {
  upserts: OverrideSyncEntry[];
  removes: OverrideRemoveKey[];
  /** The `[key, t]` pairs the payload was built from — `finishSync`'s receipt. A tombstone the
   *  world no longer has is in `sent` (it dies on success) but not in `removes`. */
  sent: Array<[string, number]>;
}

/** Everything the SYNC pushes: dirty rows → upserts (the wire names: `sy` → `heightScale`, `o` →
 *  `osmId`, `hM` → `bakedHeightM`; spatial components only when present), tombstones → removes
 *  (keyed the way the SERVER knows the row — its `osmId`, which is what the `_id` hashes). */
export function syncPayload(local: OverrideMap, shared: SharedMap): SyncPayload {
  const upserts: OverrideSyncEntry[] = [];
  const removes: OverrideRemoveKey[] = [];
  const sent: Array<[string, number]> = [];
  for (const [key, row] of unsyncedEntries(local)) {
    const k = parseOverrideKey(key);
    if (!k) continue;
    sent.push([key, row.t]);
    if (isTombstone(row)) {
      const world = shared.get(key);
      if (world) removes.push({ variant: k.variant, cell: k.cellUri, featureId: k.featureId, osmId: world.o ?? null });
      continue;
    }
    const e: OverrideSyncEntry = {
      variant: k.variant,
      cell: k.cellUri,
      featureId: k.featureId,
      osmId: row.o ?? null,
      heightScale: row.sy,
      cx: row.cx,
      cz: row.cz,
      vc: row.vc,
      bakedHeightM: row.hM,
    };
    if (row.sx !== undefined) e.sx = row.sx;
    if (row.sz !== undefined) e.sz = row.sz;
    if (row.rotDeg !== undefined) e.rotDeg = row.rotDeg;
    if (row.tE !== undefined) e.tE = row.tE;
    if (row.tN !== undefined) e.tN = row.tN;
    if (row.tU !== undefined) e.tU = row.tU;
    upserts.push(e);
  }
  return { upserts, removes, sent };
}

/** A SYNC landed (HTTP 200): stamp/delete the local rows (`finishSync`) and bring the in-memory
 *  world map into step — the pushed rows are the world's now, the removed ones are gone. Mutates
 *  both maps; the caller persists `local`. */
export function applySyncResult(
  local: OverrideMap,
  shared: SharedMap,
  payload: SyncPayload,
  nowMs: number,
): void {
  finishSync(local, payload.sent, nowMs);
  for (const e of payload.upserts) {
    const key = overrideKey(e.variant, e.cell, e.featureId);
    const l = local[key];
    if (l && !isTombstone(l)) shared.set(key, { ...l });
  }
  for (const r of payload.removes) shared.delete(overrideKey(r.variant, r.cell, r.featureId));
}
