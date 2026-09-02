import { create } from "zustand";
import { MODELS } from "../components/globe/tuning";
import { planModelCover, sameCover } from "../lib/models/modelPlacement";
import type { ModelListItem, ModelPatchAnswer, PublicModel } from "../lib/wix/modelRecords";

/**
 * MESH SUITE MS5 (D3 placement, 2026-09-02) — the WORLD's user models as the client sees them.
 *
 * Three concerns, one store:
 *  • the WORLD READ — the orchestrator mirrors its ground focus here at low cadence
 *    (`reportViewport`, the pins idiom); a THROTTLED worker plans the p5 geohash cover
 *    (`planModelCover`) and re-queries `/api/world-models` only when the cover changed (or the
 *    idle re-poll is due), swapping `world` atomically; a superseded response is dropped;
 *  • MINE — the member's own rows (`GET /api/models`), which is how the client knows which
 *    world models it may arm (MS5: own models only — the public read carries no owner id, C6);
 *  • PLACEMENT — click-to-place for a stored model (`placing`, the photo `placing` idiom: the
 *    orchestrator shows the crosshair + ground marker in orbit and calls `setPlacement` on the
 *    click) and the gizmo's commit (`commitPlacement`): both PATCH the record, swap the row into
 *    `mine` and `world` at once (optimistic — a Wix Data read lags the write by ~1 s, so a
 *    freshly patched row outranks the fetched copy for `MODELS.readLagGraceMs`);
 *  • MANAGEMENT (MESH SUITE MS6, 2026-09-02m) — the MODELS tab of the MY PINS panel reads `mine`
 *    and drives `rename` / `setHidden` / `remove`; each PATCH/DELETE answers, and the row is
 *    swapped into `mine` AND the world at once (a hidden or deleted model leaves the world here
 *    before the read lag lets the next fetch confirm it).
 *
 * MS6 opened the placement PATCH to EVERY signed-in member (LWW): the server answers `own`, and
 * a foreign commit swaps the PUBLIC row into `world` and never touches `mine`.
 *
 * The scene module never reads this store (the scene fence): the orchestrator subscribes and
 * pushes `world` down; the engine's residency numbers come back up through `_syncDensity`.
 */

export type WorldPhase = "idle" | "loading" | "ready" | "error";
export type MinePhase = "idle" | "loading" | "ready" | "anonymous" | "error";

/** The engine's residency mirror (low cadence) — the MDL chip badge + the density warning. */
export interface ModelDensity {
  /** Rows the world read answered for the current cover. */
  world: number;
  /** Models resident in the scene (GLB loaded). */
  resident: number;
  /** GLB fetches in flight. */
  loading: number;
  /** Models inside the load radius the triangle budget / count cap refused. */
  skipped: number;
  /** Resident triangles. */
  tris: number;
  /** The physical-density warning (owner 2026-09-01c) is on. */
  warn: boolean;
}

export const NO_DENSITY: Readonly<ModelDensity> = Object.freeze({ world: 0, resident: 0, loading: 0, skipped: 0, tris: 0, warn: false });

export interface PlacementPatch {
  lat: number;
  lon: number;
  rotDeg?: number;
  scale?: number;
}

export interface MetaPatch {
  title?: string;
  hidden?: boolean;
}

/** The wire, injectable (tests drive a fake; the default lazily imports the upload-media module). */
export interface UserModelsApi {
  fetchWorld(cells: readonly string[]): Promise<{ models: PublicModel[]; complete: boolean }>;
  fetchMine(): Promise<{ models: ModelListItem[] }>;
  patchPlacement(body: PlacementPatch & { id: string }): Promise<ModelPatchAnswer>;
  /** MS6: rename / hide an OWNED model. */
  patchMeta(body: MetaPatch & { id: string }): Promise<ModelPatchAnswer>;
  /** MS6: delete an OWNED model (row + media best-effort). */
  deleteModel(id: string): Promise<{ deleted: boolean; mediaDeleted: boolean }>;
}

const defaultApi: UserModelsApi = {
  fetchWorld: async (cells) => (await import("../lib/save/uploadMedia")).fetchWorldModels(cells),
  fetchMine: async () => (await import("../lib/save/uploadMedia")).fetchMyModels(),
  patchPlacement: async (body) => (await import("../lib/save/uploadMedia")).patchModelPlacement(body),
  patchMeta: async (body) => (await import("../lib/save/uploadMedia")).patchModelMeta(body),
  deleteModel: async (id) => (await import("../lib/save/uploadMedia")).deleteModelRecord(id),
};
let api: UserModelsApi = defaultApi;

/** Test / DEV seam: swap the wire. Returns the previous one; null restores the default. */
export function _setUserModelsApi(next: UserModelsApi | null): UserModelsApi {
  const prev = api;
  api = next ?? defaultApi;
  return prev;
}

/** A public row from the owner's list row (what a PATCH answers) — the optimistic swap. A row
 *  that cannot be streamed (unplaced, hidden, not READY, no url) yields null. */
export function publicFromMine(item: ModelListItem, updatedAt: string): PublicModel | null {
  if (item.lat === null || item.lon === null || item.hidden || item.readiness !== "READY" || !item.url) return null;
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    thumbnailUrl: item.thumbnailUrl,
    tris: item.tris ?? 0,
    glbBytes: item.glbBytes,
    bbox: item.bbox,
    lat: item.lat,
    lon: item.lon,
    rotDeg: item.rotDeg,
    scale: item.scale,
    updatedAt,
  };
}

/** Merge a fetched world with the rows this browser patched inside the read-lag grace: a
 *  fresh local row replaces (or joins) the fetched copy; everything else is the server's. */
export function mergeWorld(
  fetched: readonly PublicModel[],
  local: ReadonlyMap<string, { row: PublicModel | null; atMs: number }>,
  nowMs: number,
  graceMs: number,
): PublicModel[] {
  const fresh = new Map<string, PublicModel | null>();
  for (const [id, l] of local) if (nowMs - l.atMs <= graceMs) fresh.set(id, l.row);
  if (fresh.size === 0) return [...fetched];
  const out: PublicModel[] = [];
  for (const row of fetched) {
    if (fresh.has(row.id)) {
      const l = fresh.get(row.id);
      if (l) out.push(l);
      fresh.delete(row.id);
    } else out.push(row);
  }
  for (const l of fresh.values()) if (l) out.push(l);
  return out;
}

export interface UserModelsState {
  world: PublicModel[];
  worldPhase: WorldPhase;
  /** False when a cell holds more than the page — "absent" must not be read as "removed". */
  complete: boolean;
  /** The cover the current `world` answers (null = nothing asked yet / too high). */
  cover: string[] | null;
  mine: ModelListItem[];
  minePhase: MinePhase;
  /** Click-to-place armed for this stored model (orbit only; the orchestrator owns the click). */
  placing: { id: string; title: string } | null;
  density: ModelDensity;

  /** Orchestrator-only: low-cadence ground-focus mirror; plans + throttles the world query. */
  reportViewport(latDeg: number, lonDeg: number, altM: number): void;
  /** Force a re-query of the last cover (after an upload / a placement elsewhere). */
  refresh(): void;
  /** The member's own rows (401 → anonymous, never an error). */
  loadMine(): Promise<void>;
  /** A row the upload flow just stored — joins `mine` (and `world` when placed) at once. */
  addMine(item: ModelListItem): void;
  isMine(id: string): boolean;
  beginPlacing(id: string, title: string): void;
  cancelPlacing(): void;
  /** The placing click: PATCH the placement of the armed model; clears `placing`. */
  setPlacement(latDeg: number, lonDeg: number): Promise<ModelListItem | null>;
  /** The gizmo commit path (and the click-to-place one): PATCH + the optimistic swap. MS6: a
   *  foreign model (the server answers `own: false`) swaps the public row into `world` only;
   *  the answer is the public row then (the owner-shaped list row is the owner's). */
  commitPlacement(id: string, patch: PlacementPatch): Promise<ModelListItem | PublicModel | null>;
  /** MS6: rename an owned model — the list row + the world swap at once; null on failure. */
  rename(id: string, title: string): Promise<ModelListItem | null>;
  /** MS6: hide / show an owned model — hidden leaves the world at once; null on failure. */
  setHidden(id: string, hidden: boolean): Promise<ModelListItem | null>;
  /** MS6: delete an owned model — gone from `mine` and the world at once; false on failure. */
  remove(id: string): Promise<boolean>;
  /** Orchestrator-only: the residency mirror. */
  _syncDensity(d: ModelDensity): void;
}

let lastCover: string[] | null = null;
let lastReport: { latDeg: number; lonDeg: number; altM: number } | null = null;
let lastFetchAtMs = 0;
let throttleTimer: ReturnType<typeof setTimeout> | undefined;
let querySeq = 0;
/** Rows patched locally (id → row or null for "gone"), with the patch time — the read-lag grace. */
const localRows = new Map<string, { row: PublicModel | null; atMs: number }>();

const nowMs = () => Date.now();

async function runQuery(cover: string[], set: (p: Partial<UserModelsState>) => void): Promise<void> {
  const seq = ++querySeq;
  lastCover = cover;
  lastFetchAtMs = nowMs();
  set({ worldPhase: "loading", cover });
  try {
    const res = await api.fetchWorld(cover);
    if (seq !== querySeq) return; // superseded by a newer cover
    set({
      world: mergeWorld(res.models, localRows, nowMs(), MODELS.readLagGraceMs),
      complete: res.complete !== false,
      worldPhase: "ready",
    });
  } catch (e) {
    if (seq !== querySeq) return;
    console.warn("[userModels] world query failed", e);
    set({ worldPhase: "error" });
  }
}

/** An answered OWN list row replaces its twin in `mine` and its public shape joins / leaves
 *  `world` at once (null when the row is not world-visible any more — hidden, unplaced). */
function swapOwn(
  id: string,
  model: ModelListItem,
  set: (p: Partial<UserModelsState>) => void,
  get: () => UserModelsState,
): void {
  const mine = [model, ...get().mine.filter((m) => m.id !== model.id)];
  const row = publicFromMine(model, new Date().toISOString());
  localRows.set(id, { row, atMs: nowMs() });
  const world = get().world.filter((m) => m.id !== id);
  if (row) world.push(row);
  set({ mine, minePhase: "ready", world });
}

export const useUserModelsStore = create<UserModelsState>((set, get) => ({
  world: [],
  worldPhase: "idle",
  complete: true,
  cover: null,
  mine: [],
  minePhase: "idle",
  placing: null,
  density: { ...NO_DENSITY },

  reportViewport: (latDeg, lonDeg, altM) => {
    lastReport = { latDeg, lonDeg, altM };
    const planned = planModelCover(latDeg, lonDeg, altM, {
      radiusM: MODELS.fetchRadiusM,
      maxAltM: MODELS.fetchMaxAltM,
      maxCells: MODELS.maxCells,
    });
    if (planned === null) {
      // Too high to care: drop the world (the scene unloads) and forget the cover, so the
      // descent re-queries at once.
      if (lastCover !== null || get().world.length > 0) {
        lastCover = null;
        querySeq++;
        set({ world: [], cover: null, worldPhase: "idle", complete: true });
      }
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
      const cover = planModelCover(r.latDeg, r.lonDeg, r.altM, {
        radiusM: MODELS.fetchRadiusM,
        maxAltM: MODELS.fetchMaxAltM,
        maxCells: MODELS.maxCells,
      });
      if (cover === null) return;
      const dueNow = nowMs() - lastFetchAtMs >= MODELS.repollMs;
      if (!sameCover(lastCover, cover) || dueNow) void runQuery(cover, set);
    }, MODELS.queryThrottleMs);
  },

  refresh: () => {
    const cover = lastCover ?? (lastReport ? planModelCover(lastReport.latDeg, lastReport.lonDeg, lastReport.altM, {
      radiusM: MODELS.fetchRadiusM,
      maxAltM: MODELS.fetchMaxAltM,
      maxCells: MODELS.maxCells,
    }) : null);
    if (!cover) return;
    clearTimeout(throttleTimer);
    throttleTimer = undefined;
    void runQuery(cover, set);
  },

  loadMine: async () => {
    set({ minePhase: "loading" });
    try {
      const res = await api.fetchMine();
      set({ mine: res.models, minePhase: "ready" });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) set({ mine: [], minePhase: "anonymous" });
      else {
        console.warn("[userModels] own list failed", e);
        set({ minePhase: "error" });
      }
    }
  },

  addMine: (item) => {
    const mine = [item, ...get().mine.filter((m) => m.id !== item.id)];
    const row = publicFromMine(item, new Date().toISOString());
    const patch: Partial<UserModelsState> = { mine, minePhase: "ready" };
    if (row) {
      localRows.set(item.id, { row, atMs: nowMs() });
      patch.world = [...get().world.filter((m) => m.id !== item.id), row];
    }
    set(patch);
  },

  isMine: (id) => get().mine.some((m) => m.id === id),

  beginPlacing: (id, title) => set({ placing: { id, title } }),
  cancelPlacing: () => set({ placing: null }),

  setPlacement: async (latDeg, lonDeg) => {
    const p = get().placing;
    if (!p) return null;
    set({ placing: null });
    // Placing is an OWN-model gesture (the STORED card / the MODELS row) — the answer is the
    // owner's list row; a foreign answer (never expected here) reads as "not placed".
    const row = await get().commitPlacement(p.id, { lat: latDeg, lon: lonDeg });
    return row && "readiness" in row ? row : null;
  },

  commitPlacement: async (id, patch) => {
    try {
      const answer = await api.patchPlacement({ id, ...patch });
      if (answer.own && answer.model) {
        swapOwn(id, answer.model, set, get);
        return answer.model;
      }
      // Another member's model (MS6): the public row is the truth we hold — never `mine`.
      const row = answer.public ? { ...answer.public, updatedAt: new Date().toISOString() } : null;
      localRows.set(id, { row, atMs: nowMs() });
      const world = get().world.filter((m) => m.id !== id);
      if (row) world.push(row);
      set({ world });
      return row;
    } catch (e) {
      console.warn("[userModels] placement failed", e);
      return null;
    }
  },

  rename: async (id, title) => {
    try {
      const answer = await api.patchMeta({ id, title });
      if (!answer.own || !answer.model) return null;
      swapOwn(id, answer.model, set, get);
      return answer.model;
    } catch (e) {
      console.warn("[userModels] rename failed", e);
      return null;
    }
  },

  setHidden: async (id, hidden) => {
    try {
      const answer = await api.patchMeta({ id, hidden });
      if (!answer.own || !answer.model) return null;
      swapOwn(id, answer.model, set, get);
      return answer.model;
    } catch (e) {
      console.warn("[userModels] hide failed", e);
      return null;
    }
  },

  remove: async (id) => {
    try {
      const res = await api.deleteModel(id);
      if (!res.deleted) return false;
      localRows.set(id, { row: null, atMs: nowMs() });
      set({ mine: get().mine.filter((m) => m.id !== id), world: get().world.filter((m) => m.id !== id) });
      return true;
    } catch (e) {
      console.warn("[userModels] delete failed", e);
      return false;
    }
  },

  _syncDensity: (d) => {
    const cur = get().density;
    if (
      cur.world === d.world &&
      cur.resident === d.resident &&
      cur.loading === d.loading &&
      cur.skipped === d.skipped &&
      cur.tris === d.tris &&
      cur.warn === d.warn
    )
      return;
    set({ density: { ...d } });
  },
}));

/** Test seam: forget the throttle/cover memory between cases. */
export function _resetUserModelsQueryState(): void {
  lastCover = null;
  lastReport = null;
  lastFetchAtMs = 0;
  clearTimeout(throttleTimer);
  throttleTimer = undefined;
  querySeq++;
  localRows.clear();
}

// DEV seam (mirrors the other stores): the harness reads world/mine/density and drives placing.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__userModelsStore = useUserModelsStore;
}
