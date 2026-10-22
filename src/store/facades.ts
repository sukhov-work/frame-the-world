import { create } from "zustand";
import { MODELS, PHOTO_PROJECT } from "../components/globe/tuning";
import { planModelCover, sameCover } from "../lib/models/modelPlacement";
import { FACADE_COVER_PRECISION, type FacadeListItem, type FacadeWorldItem } from "../lib/wix/facadeRecords";
import { useMemberStore } from "./member";

/**
 * FACADE PHOTOS — the WORLD store (the photo flow (b), F3 residency — T169 / T171, 2026-10-21).
 * The `store/userModels` twin for saved facade photos: three concerns, one store.
 *  • the WORLD READ — the orchestrator mirrors its focus here at the camera-mirror cadence
 *    (`reportViewport`); a THROTTLED worker plans the p5 cover (`planModelCover`, the models' law
 *    with the facade knobs) and re-queries `/api/facades?cells=` only when the cover changed or the
 *    idle re-poll is due, in chunks of `FACADE_WORLD_CHUNK_CELLS`, swapping `world` atomically; a
 *    superseded answer is dropped. T190 (owner ruling 2026-10-22g): the world read is PUBLIC —
 *    every visitor streams every member's textures, signed out and unmoderated (the C6 carve-out
 *    for textures; the row carries no owner id); a 401 is still "no world", never an error to
 *    surface (release skew — an older server still gating the read);
 *  • MINE — the member's own rows (MY FACADES), paged through `hasNext` (bounded);
 *  • the OPTIMISTIC MIRROR — a row the save flow just stored (`upsertMine`) joins `mine` AND
 *    `world` at once, so the photo is resident before the next read; a Wix Data read lags the
 *    write by ~1 s, so the local copy outranks the fetched one for `MODELS.readLagGraceMs`
 *    (`updatedAt` newest-wins — a later edit from another tab still lands).
 * `editingId` is the row the editor holds (A2's `openSaved` → `setEditing`): the markers hide it
 * and the planner skips it (slot 0 is the draft's). The scene module never reads this store (the
 * scene fence): the orchestrator subscribes and pushes `world` down as marker rows.
 */

export type FacadeWorldPhase = "idle" | "loading" | "ready" | "error";
export type FacadeMinePhase = "idle" | "loading" | "ready" | "anonymous" | "error";

/** The route's `hasSome` cap per query (the `MODEL_WORLD_MAX_CELLS` twin — the facade route
 *  names at most this many cells; a 32-cell cover goes out as two parallel reads). */
export const FACADE_WORLD_CHUNK_CELLS = 16;
/** MY FACADES pages at most this far (×`FACADE_PAGE` rows) — a health rail, not a product limit. */
export const FACADE_MINE_MAX_PAGES = 5;

/** The wire, injectable (tests drive a fake; the default lazily imports the upload-media module). */
export interface FacadesApi {
  fetchMine(skip?: number): Promise<{ facades: FacadeListItem[]; hasNext: boolean }>;
  fetchWorld(cells: readonly string[]): Promise<{ facades: FacadeWorldItem[]; complete: boolean }>;
}

const defaultApi: FacadesApi = {
  fetchMine: async (skip = 0) => (await import("../lib/save/uploadMedia")).fetchMyFacades(skip),
  fetchWorld: async (cells) => (await import("../lib/save/uploadMedia")).fetchWorldFacades(cells),
};
let api: FacadesApi = defaultApi;

/** Test / DEV seam: swap the wire. Returns the previous one; null restores the default. */
export function _setFacadesApi(next: FacadesApi | null): FacadesApi {
  const prev = api;
  api = next ?? defaultApi;
  return prev;
}

/** The world shape of an own list row — the residency fields only (never the editor's facts). */
export function worldFromMine(item: FacadeListItem): FacadeWorldItem {
  return {
    id: item.id,
    title: item.title,
    displayUrl: item.displayUrl,
    thumbUrl: item.thumbUrl,
    updatedAt: item.updatedAt,
    lat: item.lat,
    lon: item.lon,
    apexAltM: item.apexAltM,
    altitudeM: item.altitudeM,
    headingDeg: item.headingDeg,
    pitchDeg: item.pitchDeg,
    rollDeg: item.rollDeg,
    focalLengthMm: item.focalLengthMm,
    hFovDeg: item.hFovDeg,
    fovEstimated: item.fovEstimated,
    textureWidth: item.textureWidth,
    textureHeight: item.textureHeight,
    strength: item.strength,
    ownLight: item.ownLight,
    rangeM: item.rangeM,
  };
}

/** `updatedAt` ordering: is `a` at least as new as `b`? An unparsable stamp never loses (a local
 *  row the save flow just minted may carry the server's ISO or a client `toISOString`). */
export function isNewerOrSame(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return true;
  if (!Number.isFinite(tb)) return false;
  return ta >= tb;
}

/** Merge a fetched world with the rows this browser wrote inside the read-lag grace: a fresh local
 *  row replaces (or joins) the fetched copy when it is at least as new (newest-wins); a tombstone
 *  (null) drops the fetched copy; everything else — and every stale local row — is the server's. */
export function mergeFacadeWorld(
  fetched: readonly FacadeWorldItem[],
  local: ReadonlyMap<string, { row: FacadeWorldItem | null; atMs: number }>,
  nowMs: number,
  graceMs: number,
): FacadeWorldItem[] {
  const fresh = new Map<string, FacadeWorldItem | null>();
  for (const [id, l] of local) if (nowMs - l.atMs <= graceMs) fresh.set(id, l.row);
  if (fresh.size === 0) return [...fetched];
  const out: FacadeWorldItem[] = [];
  for (const row of fetched) {
    if (!fresh.has(row.id)) {
      out.push(row);
      continue;
    }
    const l = fresh.get(row.id) ?? null;
    fresh.delete(row.id);
    if (l === null) continue; // tombstone: deleted here moments ago, the read has not caught up
    out.push(isNewerOrSame(l.updatedAt, row.updatedAt) ? l : row);
  }
  for (const l of fresh.values()) if (l) out.push(l);
  return out;
}

/** ONE cover → the world rows: chunks of `FACADE_WORLD_CHUNK_CELLS` in parallel, merged by id
 *  (newest-wins — a row that MOVED cells between two chunks' reads is taken once). Any chunk
 *  failing fails the read — a partial world would unload the photos of the missing cells. */
export async function fetchFacadeWorldCover(
  cover: readonly string[],
  fetchWorld: FacadesApi["fetchWorld"],
): Promise<{ facades: FacadeWorldItem[]; complete: boolean }> {
  const chunks: string[][] = [];
  for (let i = 0; i < cover.length; i += FACADE_WORLD_CHUNK_CELLS) chunks.push(cover.slice(i, i + FACADE_WORLD_CHUNK_CELLS));
  const answers = await Promise.all(chunks.map((cells) => fetchWorld(cells)));
  const byId = new Map<string, FacadeWorldItem>();
  let complete = true;
  for (const a of answers) {
    if (a.complete === false) complete = false;
    for (const f of a.facades) {
      const prev = byId.get(f.id);
      if (!prev || isNewerOrSame(f.updatedAt, prev.updatedAt)) byId.set(f.id, f);
    }
  }
  return { facades: [...byId.values()], complete };
}

export interface FacadesState {
  mine: FacadeListItem[];
  minePhase: FacadeMinePhase;
  mineError?: string;
  world: FacadeWorldItem[];
  worldPhase: FacadeWorldPhase;
  /** The cover the current `world` answers (null = nothing asked yet / too high). */
  cover: string[] | null;
  /** False when a cell holds more than the page — "absent" must not be read as "removed". */
  complete: boolean;
  /** The saved row the editor holds (hidden from the markers, skipped by the planner); null = none. */
  editingId: string | null;

  /** Orchestrator-only: the low-cadence mirror of where the world read is centred (the ground
   *  focus in orbit, the EYE in first person — the models' 2026-09-30 lesson) and how far it
   *  reaches (`radiusM`, the cover's half-side). Plans + throttles the world query. */
  reportViewport(latDeg: number, lonDeg: number, altM: number, radiusM?: number): void;
  /** Force a re-query of the last cover (a save elsewhere, a sign-in). */
  refresh(): void;
  /** The member's own rows — "anonymous" without a call when the member store says so; 401 too. */
  loadMine(): Promise<void>;
  /** A row the save / edit flow just stored — replaces-or-prepends in `mine` AND mirrors into
   *  `world` at once (resident before the next read; outranks the fetched copy for the grace). */
  upsertMine(item: FacadeListItem): void;
  /** A row deleted — gone from both lists at once (a tombstone outranks the fetched copy). */
  removeMine(id: string): void;
  setEditing(id: string | null): void;
  isMine(id: string): boolean;

  /** T183 — the hovered saved-facade marker + its apex's projected screen point (px), mirrored by
   *  the orchestrator at low cadence (the `pins.hoverPin` / `hoverScreen` idiom) so
   *  panels/FacadeHoverCard can float the compact preview. Null = nothing hovered. */
  hover: FacadeHover | null;
  /** T178 — the marker context menu (right-click / long-press), a static click point (the
   *  `modelEdit.menu` idiom). Null = closed. */
  menu: FacadeMenu | null;
  /** Orchestrator-only: mirror the hover. A null id (or a null screen) clears it; an identical
   *  sync (same id, same x / y) is a no-op — no new object, no re-render. */
  _syncHover(id: string | null, screen: { x: number; y: number } | null): void;
  /** Open (or, with null, close) the marker menu. Opening clears the hover — the card would
   *  otherwise sit under the menu. */
  _setMenu(menu: FacadeMenu | null): void;
  closeMenu(): void;

  /** F6 (2026-10-23) — the /m TAP PEEK: a tap on a saved-facade marker on the view-only tier
   *  mirrors the row id + the apex pose the orchestrator computed (the T186 math — the eye at the
   *  apex over the ground, the photo's heading / pitch, its H-FOV at the live aspect) so
   *  `mobile/FacadePeek` can show the row and offer LOOK FROM HERE. Null = closed. */
  peek: FacadePeek | null;
  /** Orchestrator-only: open the peek (clears the hover / menu — /m has neither, but the fence
   *  is cheap); null closes it. */
  _setPeek(peek: FacadePeek | null): void;
  closePeek(): void;
}

export interface FacadePeek {
  id: string;
  /** The FPV pose at the photo's apex (`useCameraStore.requestFpvJump` takes it as is). */
  jump: { latDeg: number; lonDeg: number; eyeM: number; headingDeg: number; pitchDeg: number; fovDeg: number };
}

export interface FacadeHover {
  id: string;
  screen: { x: number; y: number };
}
export interface FacadeMenu {
  id: string;
  screenX: number;
  screenY: number;
}

/** A marker's row: the member's own copy first (the editor's facts — EDIT needs it), else the
 *  world copy; null when the id is in neither (a row removed under an open hover / menu). */
export function facadeRowById(
  state: Pick<FacadesState, "mine" | "world">,
  id: string,
): FacadeListItem | FacadeWorldItem | null {
  return state.mine.find((m) => m.id === id) ?? state.world.find((w) => w.id === id) ?? null;
}

let lastCover: string[] | null = null;
let lastReport: { latDeg: number; lonDeg: number; altM: number; radiusM: number } | null = null;
let lastFetchAtMs = 0;
let throttleTimer: ReturnType<typeof setTimeout> | undefined;
let querySeq = 0;
let mineSeq = 0;
/** Rows written locally (id → row or null for "gone"), with the write time — the read-lag grace. */
const localRows = new Map<string, { row: FacadeWorldItem | null; atMs: number }>();

const nowMs = () => Date.now();
const isMember = () => useMemberStore.getState().phase === "member";
const coverFor = (r: { latDeg: number; lonDeg: number; altM: number; radiusM: number }) =>
  planModelCover(r.latDeg, r.lonDeg, r.altM, {
    radiusM: r.radiusM,
    maxAltM: PHOTO_PROJECT.coverMaxAltM,
    maxCells: PHOTO_PROJECT.coverMaxCells,
    precision: FACADE_COVER_PRECISION,
  });

async function runQuery(cover: string[], set: (p: Partial<FacadesState>) => void): Promise<void> {
  const seq = ++querySeq;
  lastCover = cover;
  lastFetchAtMs = nowMs();
  set({ worldPhase: "loading", cover });
  try {
    const res = await fetchFacadeWorldCover(cover, api.fetchWorld);
    if (seq !== querySeq) return; // superseded by a newer cover
    set({
      world: mergeFacadeWorld(res.facades, localRows, nowMs(), MODELS.readLagGraceMs),
      complete: res.complete !== false,
      worldPhase: "ready",
    });
  } catch (e) {
    if (seq !== querySeq) return;
    if ((e as { status?: number }).status === 401) {
      // An older server still gating the public read (release skew — T190): no world, not an error.
      lastCover = null;
      set({ world: [], cover: null, worldPhase: "idle", complete: true });
      return;
    }
    console.warn("[facades] world query failed", e);
    set({ worldPhase: "error" });
  }
}

/** Drop the world and forget the cover, so the next report (or sign-in) re-queries at once. */
function dropWorld(set: (p: Partial<FacadesState>) => void, get: () => FacadesState): void {
  if (lastCover === null && get().world.length === 0 && get().cover === null) return;
  lastCover = null;
  querySeq++;
  set({ world: [], cover: null, worldPhase: "idle", complete: true });
}

export const useFacadesStore = create<FacadesState>((set, get) => ({
  mine: [],
  minePhase: "idle",
  mineError: undefined,
  world: [],
  worldPhase: "idle",
  cover: null,
  complete: true,
  editingId: null,
  hover: null,
  menu: null,

  _syncHover: (id, screen) => {
    const cur = get().hover;
    if (id === null || screen === null) {
      if (cur !== null) set({ hover: null });
      return;
    }
    if (cur && cur.id === id && cur.screen.x === screen.x && cur.screen.y === screen.y) return;
    set({ hover: { id, screen: { x: screen.x, y: screen.y } } });
  },

  _setMenu: (menu) => {
    if (menu === null) {
      if (get().menu !== null) set({ menu: null });
      return;
    }
    set({ menu: { id: menu.id, screenX: menu.screenX, screenY: menu.screenY }, hover: null });
  },

  closeMenu: () => {
    if (get().menu !== null) set({ menu: null });
  },

  peek: null,
  _setPeek: (peek) => {
    if (peek === null) {
      if (get().peek !== null) set({ peek: null });
      return;
    }
    set({ peek: { id: peek.id, jump: { ...peek.jump } }, hover: null, menu: null });
  },
  closePeek: () => {
    if (get().peek !== null) set({ peek: null });
  },

  reportViewport: (latDeg, lonDeg, altM, radiusM = PHOTO_PROJECT.coverRadiusM) => {
    lastReport = { latDeg, lonDeg, altM, radiusM };
    // T190: no member gate — a visitor reads the world like a member.
    const planned = coverFor(lastReport);
    if (planned === null) {
      // Too high to care: drop the world (the markers unload) and forget the cover, so the
      // descent re-queries at once.
      dropWorld(set, get);
      return;
    }
    const due = nowMs() - lastFetchAtMs >= MODELS.repollMs;
    if (sameCover(lastCover, planned) && !due) return;
    // THROTTLE, not debounce (the pins lesson): reports arrive ~5/s; let one pending timer
    // fire with the freshest report instead of resetting it forever.
    if (throttleTimer !== undefined) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = undefined;
      const r = lastReport;
      if (!r) return;
      const cover = coverFor(r);
      if (cover === null) return;
      const dueNow = nowMs() - lastFetchAtMs >= MODELS.repollMs;
      if (!sameCover(lastCover, cover) || dueNow) void runQuery(cover, set);
    }, MODELS.queryThrottleMs);
  },

  refresh: () => {
    const cover = lastCover ?? (lastReport ? coverFor(lastReport) : null);
    if (!cover) return;
    clearTimeout(throttleTimer);
    throttleTimer = undefined;
    void runQuery(cover, set);
  },

  loadMine: async () => {
    const seq = ++mineSeq;
    if (!isMember()) {
      set({ mine: [], minePhase: "anonymous", mineError: undefined });
      return;
    }
    set({ minePhase: "loading", mineError: undefined });
    try {
      const rows: FacadeListItem[] = [];
      for (let page = 0; page < FACADE_MINE_MAX_PAGES; page++) {
        const res = await api.fetchMine(rows.length);
        if (seq !== mineSeq) return; // superseded by a newer load
        for (const f of res.facades) if (!rows.some((r) => r.id === f.id)) rows.push(f);
        if (!res.hasNext || res.facades.length === 0) break;
      }
      // A row deleted moments ago may still be in the read (Wix Data read lag) — its tombstone
      // outranks the fetched copy for the same grace the WORLD read honours (the models' 2026-09-19
      // lesson: reopening the panel resurrected it and the second ✕ answered 404).
      const at = nowMs();
      const dead = (id: string) => {
        const l = localRows.get(id);
        return l !== undefined && l.row === null && at - l.atMs <= MODELS.readLagGraceMs;
      };
      set({ mine: rows.filter((r) => !dead(r.id)), minePhase: "ready", mineError: undefined });
    } catch (e) {
      if (seq !== mineSeq) return;
      const status = (e as { status?: number }).status;
      if (status === 401) set({ mine: [], minePhase: "anonymous", mineError: undefined });
      else {
        console.warn("[facades] own list failed", e);
        set({ minePhase: "error", mineError: e instanceof Error ? e.message : String(e) });
      }
    }
  },

  upsertMine: (item) => {
    const mine = [item, ...get().mine.filter((m) => m.id !== item.id)];
    const row = worldFromMine(item);
    localRows.set(item.id, { row, atMs: nowMs() });
    const world = get().world.filter((m) => m.id !== item.id);
    world.push(row);
    set({ mine, minePhase: "ready", mineError: undefined, world });
  },

  removeMine: (id) => {
    localRows.set(id, { row: null, atMs: nowMs() });
    set({
      mine: get().mine.filter((m) => m.id !== id),
      world: get().world.filter((m) => m.id !== id),
      editingId: get().editingId === id ? null : get().editingId,
    });
  },

  setEditing: (id) => {
    if (get().editingId === id) return;
    set({ editingId: id });
  },

  isMine: (id) => get().mine.some((m) => m.id === id),
}));

// The member seam: a sign-in re-loads MINE if the panel asked while anonymous; a sign-out drops
// MINE, the row under edit and the hover / menu (they may sit on an ex-own row) — and KEEPS the
// world (T190: the world is public, a visitor sees the same rows the member saw).
useMemberStore.subscribe((s, prev) => {
  if (s.phase === prev.phase) return;
  const st = useFacadesStore.getState();
  if (s.phase === "member") {
    if (st.minePhase === "anonymous") void st.loadMine();
  } else if (s.phase === "anonymous") {
    mineSeq++;
    useFacadesStore.setState({ mine: [], minePhase: "anonymous", editingId: null, hover: null, menu: null, peek: null });
  }
});

/** Test seam: forget the throttle / cover / grace memory AND the store's rows between cases. */
export function _resetFacadesStore(): void {
  lastCover = null;
  lastReport = null;
  lastFetchAtMs = 0;
  clearTimeout(throttleTimer);
  throttleTimer = undefined;
  querySeq++;
  mineSeq++;
  localRows.clear();
  useFacadesStore.setState({
    mine: [],
    minePhase: "idle",
    mineError: undefined,
    world: [],
    worldPhase: "idle",
    cover: null,
    complete: true,
    editingId: null,
    hover: null,
    menu: null,
    peek: null,
  });
}

// DEV seam (mirrors the other stores): the harness reads world / mine / cover and drives editing.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__facadesStore = useFacadesStore;
}
