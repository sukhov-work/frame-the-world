/**
 * Building-override contract + record builders (U8 backend prep, owner 2026-08-19) — the PURE
 * core of /api/building-overrides. THIS session ships localStorage-only overrides; this module
 * + the endpoint are the prepared substrate for the NEXT phase's "sync my edits" button:
 * a member batch-upserts their local rows into ONE world-shared collection; persisted rows
 * then apply for ALL users, and any logged-in member may overwrite any building (LWW).
 *
 * Design (research-verified 2026-08-19):
 *  · ONE row per building, `_id` = deterministic FNV-1a-128 hash of `variant|cell|featureId` —
 *    `items.bulkSave` upserts by `_id` [node_modules/@wix/wix-data-items-sdk …items.universal.d.ts:363],
 *    so last-write-wins falls out structurally (insert() cannot overwrite; bulkSave is THE
 *    sync verb). Hashing sidesteps unverified `_id` charset/length limits.
 *  · Platform caps: 1000 items per bulk call (d.ts:347) — SYNC_MAX mirrors it; bulkSave
 *    REPLACES whole items, so records are always built complete, never partial.
 *  · C6-clean: rows carry the bake-local centroid checksum (cx/cz metres in the bake frame —
 *    NOT geographic coordinates) and no member GPS of any kind. `memberId` (last editor,
 *    audit/revert hook) is set server-side (elevated writes run as the APP identity — the
 *    dev-seed trap) and is NEVER emitted by the public mapper.
 *  · The value/clamp contract is shared with the client store (lib/globe/bldgOverrides) —
 *    one source for the scale band; the server re-clamps, never trusts.
 */

import { numOrNull, strOrNull } from "../geo/coerce";
import { SCALE_MAX_K, SCALE_MIN_K } from "../globe/bldgOverrides";
import { regionOfVariant } from "../globe/regions";

export const OVERRIDES_COLLECTION = "BuildingOverrides";

/** Platform bulk-call cap (wix-data-items-sdk d.ts:347) — parseSyncBody rejects past it; the
 *  local store's OVERRIDES_CAP (1000) sits exactly at it, never past. */
export const SYNC_MAX = 1000;

/** One building override as the sync POST carries it (mirrors the local OverrideRow + key). */
export interface OverrideSyncEntry {
  variant: string;
  cell: string;
  featureId: number;
  heightScale: number;
  cx: number;
  cz: number;
  vc: number;
  bakedHeightM: number;
}

/** FNV-1a 64-bit over UTF-16 code units, BigInt math; two offset bases → 128 bits / 32 hex.
 *  Deterministic across client/server; collision odds at city scale (~10^5 keys) ≈ 10^-29. */
const fnv1a64 = (s: string, offset: bigint): bigint => {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let h = offset;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * PRIME) & MASK;
  }
  return h;
};

/** The deterministic row `_id` — the LWW upsert key. */
export function overrideId(variant: string, cell: string, featureId: number): string {
  const key = `${variant}|${cell}|${featureId}`;
  const a = fnv1a64(key, 0xcbf29ce484222325n);
  const b = fnv1a64(key, 0x84222325cbf29ce4n);
  return a.toString(16).padStart(16, "0") + b.toString(16).padStart(16, "0");
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown, maxLen: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= maxLen ? v : null;

/** Validate ONE untrusted sync entry (heightScale is CLAMPED to the shared band, not rejected —
 *  a client drifting past the rail must not fail the whole batch). Null = drop-worthy junk. */
export function parseSyncEntry(raw: unknown): OverrideSyncEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const variant = str(r.variant, 64);
  const cell = str(r.cell, 128);
  const featureId = num(r.featureId);
  const heightScale = num(r.heightScale);
  const cx = num(r.cx);
  const cz = num(r.cz);
  const vc = num(r.vc);
  const bakedHeightM = num(r.bakedHeightM);
  if (
    variant === null ||
    regionOfVariant(variant) === null || // unknown variant = typo or vandalism probe
    cell === null ||
    featureId === null ||
    !Number.isInteger(featureId) ||
    featureId < 0 ||
    heightScale === null ||
    cx === null ||
    cz === null ||
    vc === null ||
    !Number.isInteger(vc) ||
    vc <= 0 ||
    bakedHeightM === null ||
    bakedHeightM <= 0
  )
    return null;
  return {
    variant,
    cell,
    featureId,
    heightScale: Math.max(SCALE_MIN_K, Math.min(SCALE_MAX_K, heightScale)),
    cx,
    cz,
    vc,
    bakedHeightM,
  };
}

/** Validate the sync POST body: `{ upserts: entry[], removes: keyTriple[] }`. Junk entries are
 *  named, not silently dropped — the sync button must be able to tell the user what failed. */
export function parseSyncBody(
  raw: unknown,
):
  | { upserts: OverrideSyncEntry[]; removes: Array<{ variant: string; cell: string; featureId: number }> }
  | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "body must be a JSON object" };
  const r = raw as Record<string, unknown>;
  const upsertsRaw = Array.isArray(r.upserts) ? r.upserts : [];
  const removesRaw = Array.isArray(r.removes) ? r.removes : [];
  if (upsertsRaw.length + removesRaw.length === 0)
    return { error: "nothing to sync (empty upserts + removes)" };
  if (upsertsRaw.length > SYNC_MAX || removesRaw.length > SYNC_MAX)
    return { error: `at most ${SYNC_MAX} entries per sync (platform bulk cap)` };
  const upserts: OverrideSyncEntry[] = [];
  for (let i = 0; i < upsertsRaw.length; i++) {
    const e = parseSyncEntry(upsertsRaw[i]);
    if (!e) return { error: `upserts[${i}] is not a valid override entry` };
    upserts.push(e);
  }
  const removes: Array<{ variant: string; cell: string; featureId: number }> = [];
  for (let i = 0; i < removesRaw.length; i++) {
    const e = removesRaw[i] as Record<string, unknown>;
    const variant = str(e?.variant, 64);
    const cell = str(e?.cell, 128);
    const featureId = num(e?.featureId);
    if (
      variant === null ||
      cell === null ||
      featureId === null ||
      !Number.isInteger(featureId) ||
      featureId < 0
    )
      return { error: `removes[${i}] is not a valid override key` };
    removes.push({ variant, cell, featureId });
  }
  return { upserts, removes };
}

/** The BuildingOverrides row (ADMIN-only collection; the endpoint is the only writer).
 *  COMPLETE by construction — bulkSave replaces whole items. memberId set explicitly (the
 *  APP-identity trap); region denormalized for coarse ops filters. */
export function overrideRecord(entry: OverrideSyncEntry, memberId: string): Record<string, unknown> {
  return {
    _id: overrideId(entry.variant, entry.cell, entry.featureId),
    variant: entry.variant,
    cell: entry.cell,
    featureId: entry.featureId,
    // Reserved: filled once bakes ship OSM ids end-to-end (the cell-*.meta.json sidecars land
    // at the NEXT re-bake) — the future re-bake-stable key.
    osmId: null,
    heightScale: entry.heightScale,
    cx: entry.cx,
    cz: entry.cz,
    vc: entry.vc,
    bakedHeightM: entry.bakedHeightM,
    region: regionOfVariant(entry.variant)?.id ?? null,
    memberId,
  };
}

/** World-facing override row (the public GET) — NO memberId (C6: never expose raw member GUIDs
 *  on world-readable surfaces; PublicPins denormalizes a display label, never the id). */
export interface PublicOverride {
  variant: string;
  cell: string;
  featureId: number;
  heightScale: number;
  cx: number;
  cz: number;
  vc: number;
}

export function publicOverride(item: Record<string, unknown>): PublicOverride | null {
  const variant = strOrNull(item.variant);
  const cell = strOrNull(item.cell);
  const featureId = numOrNull(item.featureId);
  const heightScale = numOrNull(item.heightScale);
  const cx = numOrNull(item.cx);
  const cz = numOrNull(item.cz);
  const vc = numOrNull(item.vc);
  if (
    variant === null ||
    cell === null ||
    featureId === null ||
    heightScale === null ||
    cx === null ||
    cz === null ||
    vc === null
  )
    return null;
  return { variant, cell, featureId, heightScale, cx, cz, vc };
}
