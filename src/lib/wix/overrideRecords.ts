/**
 * Building-override contract + record builders — the PURE core of /api/building-overrides.
 * U8 backend prep (owner 2026-08-19) → ACTIVATED at MESH SUITE MS3 (2026-09-02): a member
 * batch-upserts their local rows into ONE world-shared collection; persisted rows apply for ALL
 * users at cell load, and any logged-in member may overwrite any building (last committer wins).
 *
 * Design (research-verified 2026-08-19; MS3 additions marked):
 *  · ONE row per building, `_id` = a deterministic FNV-1a-128 hash. MS3: of `variant|osm|<osmId>`
 *    when the row carries the building's OSM element id (the RC17 sidecars give one to 100 % of
 *    features on every live bake — MESH_SUITE_PLAN §6.1), else of the legacy `variant|cell|featureId`
 *    fingerprint — the DUAL KEY of §4a-2, never a hard cutover. The OSM key survives a re-bake
 *    (feature ids are bake-sequential and die with one); the fingerprint stays in the row as the
 *    locator + checksum. `items.bulkSave` upserts by `_id`
 *    [node_modules/@wix/wix-data-items-sdk …items.universal.d.ts], so last-write-wins falls out
 *    structurally (insert() cannot overwrite; bulkSave is THE sync verb).
 *  · Platform caps [same d.ts]: 1000 items per bulk call — SYNC_MAX mirrors it; 500 KB per item
 *    (a row here is ~300 B). bulkSave REPLACES whole items, so records are always built complete,
 *    never partial. The public GET pages by `skip()` (query `limit()` max 1000 [dev.wix.com
 *    wix-data-query/limit]) up to GET_MAX_PAGES and says whether it reached the end.
 *  · MS3: the wire carries the v2 row's spatial components (`sx sz rotDeg tE tN tU`, absent =
 *    identity). The server RE-CLAMPS onto the shared SANITY rail (`clampXf` + the scale rail —
 *    loose since MS5b 2026-09-02l; the per-edit band is a client gesture rule) and never rejects drift; identity components are OMITTED (the `transformFields` rule), so a
 *    height-only edit lands exactly as U8 sent it.
 *  · C6-clean: rows carry the bake-local centroid checksum (cx/cz metres in the bake frame —
 *    NOT geographic coordinates) and no member GPS of any kind. `memberId` (last editor,
 *    audit/revert hook) is set server-side (elevated writes run as the APP identity — the
 *    dev-seed trap) and is NEVER emitted by the public mapper.
 *  · The value/clamp contract is shared with the client store (lib/globe/bldgOverrides) —
 *    one source for the rails; the server re-clamps, never trusts.
 */

import { numOrNull, strOrNull } from "../geo/coerce";
import { isOsmId, SCALE_MAX_K, SCALE_MIN_K, transformFields, XF_RAILS } from "../globe/bldgOverrides";
import { clampXf } from "../globe/featureTransform";
import { regionOfVariant } from "../globe/regions";

export const OVERRIDES_COLLECTION = "BuildingOverrides";

/** Platform bulk-call cap (wix-data-items-sdk d.ts) — parseSyncBody rejects past it; the local
 *  store's OVERRIDES_CAP (1000) sits exactly at it, never past. Also the query page size. */
export const SYNC_MAX = 1000;

/** MS3: pages the public GET walks before answering `complete: false` (10 × SYNC_MAX rows —
 *  far above any world this app will see soon; the client never deletes on a partial fetch). */
export const GET_MAX_PAGES = 10;

/** One building override as the sync POST carries it (mirrors the local OverrideRow + key). */
export interface OverrideSyncEntry {
  variant: string;
  cell: string;
  featureId: number;
  /** MS3: the OSM element id ("w141472295") — the re-bake-stable key; null on a bake with no sidecar. */
  osmId: string | null;
  /** Height scale vs the baked height (the local row's `sy`). */
  heightScale: number;
  /** MS3: spatial components (the v2 row) — absent = identity. */
  sx?: number;
  sz?: number;
  rotDeg?: number;
  tE?: number;
  tN?: number;
  tU?: number;
  cx: number;
  cz: number;
  vc: number;
  bakedHeightM: number;
}

/** A removal as the sync POST carries it — the same identity as an upsert (the `_id` derives
 *  from `osmId` when present, else from the fingerprint). */
export interface OverrideRemoveKey {
  variant: string;
  cell: string;
  featureId: number;
  osmId: string | null;
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

/** The deterministic row `_id` — the LWW upsert key. MS3: OSM-keyed when the building has an
 *  OSM id (`variant|osm|<id>` — a cell uri is never the literal "osm", so the namespaces cannot
 *  collide), else the legacy fingerprint `variant|cell|featureId`. */
export function overrideId(
  variant: string,
  cell: string,
  featureId: number,
  osmId: string | null = null,
): string {
  const key = osmId ? `${variant}|osm|${osmId}` : `${variant}|${cell}|${featureId}`;
  const a = fnv1a64(key, 0xcbf29ce484222325n);
  const b = fnv1a64(key, 0x84222325cbf29ce4n);
  return a.toString(16).padStart(16, "0") + b.toString(16).padStart(16, "0");
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown, maxLen: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= maxLen ? v : null;

/** Validate ONE untrusted sync entry. Scalars are CLAMPED to the shared rails, not rejected —
 *  a client drifting past a rail must not fail the whole batch; a malformed `osmId` drops to null
 *  (the fingerprint still identifies the building). Null = drop-worthy junk. */
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
  // MS3: the spatial components onto the rails (absent → identity → omitted again below).
  const xf = clampXf(
    {
      sx: num(r.sx) ?? 1,
      sz: num(r.sz) ?? 1,
      rotDeg: num(r.rotDeg) ?? 0,
      tE: num(r.tE) ?? 0,
      tN: num(r.tN) ?? 0,
      tU: num(r.tU) ?? 0,
    },
    XF_RAILS,
  );
  const sy = Math.max(SCALE_MIN_K, Math.min(SCALE_MAX_K, heightScale));
  const { sy: _sy, ...spatial } = transformFields({ sy, ...xf });
  return {
    variant,
    cell,
    featureId,
    osmId: isOsmId(r.osmId) ? r.osmId : null,
    heightScale: sy,
    ...spatial,
    cx,
    cz,
    vc,
    bakedHeightM,
  };
}

/** Validate the sync POST body: `{ upserts: entry[], removes: key[] }`. Junk entries are
 *  named, not silently dropped — the sync button must be able to tell the user what failed. */
export function parseSyncBody(
  raw: unknown,
): { upserts: OverrideSyncEntry[]; removes: OverrideRemoveKey[] } | { error: string } {
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
  const removes: OverrideRemoveKey[] = [];
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
    removes.push({ variant, cell, featureId, osmId: isOsmId(e?.osmId) ? e.osmId : null });
  }
  return { upserts, removes };
}

/** The BuildingOverrides row (ADMIN-only collection; the endpoint is the only writer).
 *  COMPLETE by construction — bulkSave replaces whole items, so every spatial field is written
 *  (null = identity). memberId set explicitly (the APP-identity trap); region denormalized for
 *  coarse ops filters. */
export function overrideRecord(entry: OverrideSyncEntry, memberId: string): Record<string, unknown> {
  return {
    _id: overrideId(entry.variant, entry.cell, entry.featureId, entry.osmId),
    variant: entry.variant,
    cell: entry.cell,
    featureId: entry.featureId,
    osmId: entry.osmId,
    heightScale: entry.heightScale,
    sx: entry.sx ?? null,
    sz: entry.sz ?? null,
    rotDeg: entry.rotDeg ?? null,
    tE: entry.tE ?? null,
    tN: entry.tN ?? null,
    tU: entry.tU ?? null,
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
  osmId: string | null;
  heightScale: number;
  sx?: number;
  sz?: number;
  rotDeg?: number;
  tE?: number;
  tN?: number;
  tU?: number;
  cx: number;
  cz: number;
  vc: number;
  bakedHeightM: number;
  /** The row's last write (epoch ms, Wix `_updatedDate`) — display only; the client's `t`. */
  updatedAt?: number;
}

const updatedMs = (v: unknown): number | null => {
  const ms = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

export function publicOverride(item: Record<string, unknown>): PublicOverride | null {
  const variant = strOrNull(item.variant);
  const cell = strOrNull(item.cell);
  const featureId = numOrNull(item.featureId);
  const heightScale = numOrNull(item.heightScale);
  const cx = numOrNull(item.cx);
  const cz = numOrNull(item.cz);
  const vc = numOrNull(item.vc);
  const bakedHeightM = numOrNull(item.bakedHeightM);
  if (
    variant === null ||
    cell === null ||
    featureId === null ||
    heightScale === null ||
    cx === null ||
    cz === null ||
    vc === null ||
    bakedHeightM === null
  )
    return null;
  const out: PublicOverride = {
    variant,
    cell,
    featureId,
    osmId: isOsmId(item.osmId) ? item.osmId : null,
    heightScale,
    cx,
    cz,
    vc,
    bakedHeightM,
  };
  for (const k of ["sx", "sz", "rotDeg", "tE", "tN", "tU"] as const) {
    const v = numOrNull(item[k]);
    if (v !== null) out[k] = v;
  }
  const updatedAt = updatedMs(item._updatedDate);
  if (updatedAt !== null) out.updatedAt = updatedAt;
  return out;
}
