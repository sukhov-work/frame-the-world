import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeGeohash } from "../../src/lib/geo/geohash";
import { MODELS } from "../../src/components/globe/tuning";
import type { ModelListItem, PublicModel } from "../../src/lib/wix/modelRecords";
import {
  _resetUserModelsQueryState,
  _setUserModelsApi,
  mergeWorld,
  publicFromMine,
  useUserModelsStore,
  type UserModelsApi,
} from "../../src/store/userModels";

// MESH SUITE MS5 — the world store: the cover-driven, THROTTLED world read (a superseded answer
// is dropped, a re-poll is due after idle), MINE, click-to-place → PATCH, and the optimistic
// swap that outranks the fetched copy inside the read-lag grace.

const pub = (id: string, over: Partial<PublicModel> = {}): PublicModel => ({
  id,
  title: `Model ${id}`,
  url: `https://static.wixstatic.com/3d/${id}.glb`,
  thumbnailUrl: null,
  tris: 1000,
  glbBytes: 5000,
  bbox: [4, 3, 4],
  lat: 48.4647,
  lon: 35.0462,
  rotDeg: 0,
  scale: 1,
  tU: 0,
  pitchDeg: 0,
  rollDeg: 0,
  updatedAt: "2026-09-02T12:00:00.000Z",
  ...over,
});
const mine = (id: string, over: Partial<ModelListItem> = {}): ModelListItem => ({
  id,
  title: `Model ${id}`,
  url: `https://static.wixstatic.com/3d/${id}.glb`,
  thumbnailUrl: null,
  fileName: null,
  sourceFormat: "glb",
  glbBytes: 5000,
  tris: 1000,
  meshes: 1,
  textures: 0,
  decimatedFromTris: null,
  bbox: [4, 3, 4],
  readiness: "READY",
  hidden: false,
  lat: 48.4647,
  lon: 35.0462,
  rotDeg: 0,
  scale: 1,
  tU: 0,
  pitchDeg: 0,
  rollDeg: 0,
  createdAt: null,
  updatedAt: null,
  editedByOther: false,
  ...over,
});
/** The public shape of an own list row, as the server would answer it. */
const pubOf = (m: ModelListItem): PublicModel | null =>
  m.lat === null || m.lon === null || m.hidden || m.readiness !== "READY"
    ? null
    : { id: m.id, title: m.title, url: m.url, thumbnailUrl: m.thumbnailUrl, tris: m.tris ?? 0, glbBytes: m.glbBytes, bbox: m.bbox, lat: m.lat, lon: m.lon, rotDeg: m.rotDeg, scale: m.scale, tU: m.tU, pitchDeg: m.pitchDeg, rollDeg: m.rollDeg, updatedAt: "2026-09-02T12:00:00.000Z" };

interface FakeApi extends UserModelsApi {
  worldCalls: string[][];
  worldRows: PublicModel[];
  mineRows: ModelListItem[];
  mineStatus: number;
  patches: Array<Record<string, unknown>>;
  metaPatches: Array<Record<string, unknown>>;
  deletes: string[];
  /** Ids the fake treats as ANOTHER member's (MS6): a placement PATCH answers `own: false`. */
  foreign: Set<string>;
  gate: Array<() => void>;
  hold: boolean;
}
const makeApi = (): FakeApi => {
  const api: FakeApi = {
    worldCalls: [],
    worldRows: [],
    mineRows: [],
    mineStatus: 200,
    patches: [],
    metaPatches: [],
    deletes: [],
    foreign: new Set(),
    gate: [],
    hold: false,
    fetchWorld: async (cells) => {
      api.worldCalls.push([...cells]);
      const rows = [...api.worldRows];
      if (api.hold) await new Promise<void>((res) => api.gate.push(res));
      return { models: rows, complete: true };
    },
    fetchMine: async () => {
      if (api.mineStatus !== 200) {
        const err = new Error("no") as Error & { status?: number };
        err.status = api.mineStatus;
        throw err;
      }
      return { models: [...api.mineRows] };
    },
    patchPlacement: async (body) => {
      api.patches.push({ ...body });
      const base = api.mineRows.find((m) => m.id === body.id) ?? mine(body.id);
      const model = {
        ...base,
        lat: body.lat,
        lon: body.lon,
        rotDeg: body.rotDeg ?? base.rotDeg,
        scale: body.scale ?? base.scale,
        tU: body.tU ?? base.tU,
        pitchDeg: body.pitchDeg ?? base.pitchDeg,
        rollDeg: body.rollDeg ?? base.rollDeg,
      };
      if (api.foreign.has(body.id)) return { own: false, model: null, public: pubOf(model) };
      return { own: true, model, public: pubOf(model) };
    },
    patchMeta: async (body) => {
      api.metaPatches.push({ ...body });
      const base = api.mineRows.find((m) => m.id === body.id) ?? mine(body.id);
      const model = { ...base, title: body.title ?? base.title, hidden: body.hidden ?? base.hidden };
      api.mineRows = [model, ...api.mineRows.filter((m) => m.id !== body.id)];
      return { own: true, model, public: pubOf(model) };
    },
    deleteModel: async (id) => {
      api.deletes.push(id);
      api.mineRows = api.mineRows.filter((m) => m.id !== id);
      return { deleted: true, mediaDeleted: true };
    },
  };
  return api;
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("store/userModels", () => {
  let api: FakeApi;
  beforeEach(() => {
    vi.useFakeTimers();
    api = makeApi();
    _setUserModelsApi(api);
    _resetUserModelsQueryState();
    useUserModelsStore.setState({
      world: [],
      worldPhase: "idle",
      complete: true,
      cover: null,
      mine: [],
      minePhase: "idle",
      placing: null,
      density: { world: 0, resident: 0, loading: 0, skipped: 0, tris: 0, warn: false },
    });
  });
  afterEach(() => {
    _setUserModelsApi(null);
    vi.useRealTimers();
  });

  it("plans a p5 cover from the focus, throttles the query, and swaps the world atomically", async () => {
    api.worldRows = [pub("a"), pub("b")];
    const s = useUserModelsStore.getState();
    s.reportViewport(48.4647, 35.0462, 500);
    s.reportViewport(48.4648, 35.0463, 500); // same cover — no second timer
    expect(api.worldCalls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    expect(api.worldCalls.length).toBe(1);
    expect(api.worldCalls[0]).toContain(encodeGeohash(48.4647, 35.0462, 5));
    expect(useUserModelsStore.getState().world.map((m) => m.id)).toEqual(["a", "b"]);
    expect(useUserModelsStore.getState().worldPhase).toBe("ready");
    expect(useUserModelsStore.getState().cover).toEqual(api.worldCalls[0]);
    // The same cover again: nothing fires.
    s.reportViewport(48.4649, 35.0464, 600);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    expect(api.worldCalls.length).toBe(1);
  });

  it("re-queries when the cover changes, re-polls after idle, and forgets the world when too high", async () => {
    api.worldRows = [pub("a")];
    const s = useUserModelsStore.getState();
    s.reportViewport(48.4647, 35.0462, 500);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    expect(api.worldCalls.length).toBe(1);
    // A far move → a different cover.
    s.reportViewport(51.75, -0.34, 500);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    expect(api.worldCalls.length).toBe(2);
    expect(api.worldCalls[1]).toContain(encodeGeohash(51.75, -0.34, 5));
    // Idle: the re-poll comes due.
    await vi.advanceTimersByTimeAsync(MODELS.repollMs + 5);
    s.reportViewport(51.75, -0.34, 500);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    expect(api.worldCalls.length).toBe(3);
    // Too high: the world is dropped and the cover forgotten, so a descent re-queries at once.
    s.reportViewport(51.75, -0.34, MODELS.fetchMaxAltM + 1);
    expect(useUserModelsStore.getState().world).toEqual([]);
    expect(useUserModelsStore.getState().cover).toBeNull();
    s.reportViewport(51.75, -0.34, 500);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    expect(api.worldCalls.length).toBe(4);
  });

  it("drops a superseded answer", async () => {
    api.hold = true;
    api.worldRows = [pub("old")];
    const s = useUserModelsStore.getState();
    s.reportViewport(48.4647, 35.0462, 500);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    expect(api.gate.length).toBe(1);
    api.worldRows = [pub("new")];
    s.refresh(); // a second query on the same cover
    await flush();
    expect(api.gate.length).toBe(2);
    api.gate[0](); // the OLD answer lands first — it must be ignored
    await flush();
    expect(useUserModelsStore.getState().world).toEqual([]);
    api.gate[1]();
    await flush();
    expect(useUserModelsStore.getState().world.map((m) => m.id)).toEqual(["new"]);
  });

  it("loads MINE (a 401 is anonymous, never an error) and answers isMine", async () => {
    api.mineRows = [mine("m1")];
    await useUserModelsStore.getState().loadMine();
    expect(useUserModelsStore.getState().minePhase).toBe("ready");
    expect(useUserModelsStore.getState().isMine("m1")).toBe(true);
    expect(useUserModelsStore.getState().isMine("x")).toBe(false);
    api.mineStatus = 401;
    await useUserModelsStore.getState().loadMine();
    expect(useUserModelsStore.getState().minePhase).toBe("anonymous");
    expect(useUserModelsStore.getState().mine).toEqual([]);
    api.mineStatus = 502;
    await useUserModelsStore.getState().loadMine();
    expect(useUserModelsStore.getState().minePhase).toBe("error");
  });

  it("click-to-place: beginPlacing → setPlacement PATCHes, clears placing and swaps the row into mine + world", async () => {
    const s = useUserModelsStore.getState();
    s.addMine(mine("m1", { lat: null, lon: null }));
    expect(useUserModelsStore.getState().world).toEqual([]); // unplaced — not in the world yet
    s.beginPlacing("m1", "Kiosk");
    expect(useUserModelsStore.getState().placing).toEqual({ id: "m1", title: "Kiosk" });
    const row = await useUserModelsStore.getState().setPlacement(48.5, 35.1);
    expect(row?.lat).toBe(48.5);
    expect(api.patches).toEqual([{ id: "m1", lat: 48.5, lon: 35.1 }]);
    expect(useUserModelsStore.getState().placing).toBeNull();
    expect(useUserModelsStore.getState().world.map((m) => [m.id, m.lat, m.lon])).toEqual([["m1", 48.5, 35.1]]);
    expect(useUserModelsStore.getState().mine[0]).toMatchObject({ id: "m1", lat: 48.5, lon: 35.1 });
    // Cancel is a no-op PATCH-wise.
    s.beginPlacing("m1", "Kiosk");
    s.cancelPlacing();
    expect(await useUserModelsStore.getState().setPlacement(1, 2)).toBeNull();
    expect(api.patches.length).toBe(1);
  });

  it("MS7 — the MODELS row's RESET is ONE placement PATCH (spot kept, yaw 0 / scale 1 / lift 0, MS8 upright); an unplaced row is a no-op", async () => {
    api.mineRows = [mine("m1", { rotDeg: 45, scale: 2, tU: -1.5, pitchDeg: 30, rollDeg: -10 }), mine("m2", { lat: null, lon: null })];
    await useUserModelsStore.getState().loadMine();
    const row = await useUserModelsStore.getState().resetTransform("m1");
    expect(row).toMatchObject({ rotDeg: 0, scale: 1, tU: 0, pitchDeg: 0, rollDeg: 0, lat: 48.4647, lon: 35.0462 });
    expect(api.patches).toEqual([{ id: "m1", lat: 48.4647, lon: 35.0462, rotDeg: 0, scale: 1, tU: 0, pitchDeg: 0, rollDeg: 0 }]);
    expect(useUserModelsStore.getState().mine.find((m) => m.id === "m1")).toMatchObject({ rotDeg: 0, scale: 1, tU: 0, pitchDeg: 0, rollDeg: 0 });
    expect(useUserModelsStore.getState().world.find((m) => m.id === "m1")).toMatchObject({ rotDeg: 0, scale: 1, tU: 0, pitchDeg: 0, rollDeg: 0 });
    expect(await useUserModelsStore.getState().resetTransform("m2")).toBeNull();
    expect(await useUserModelsStore.getState().resetTransform("nope")).toBeNull();
    expect(api.patches.length).toBe(1);
    // The lift rides the gizmo commit too — and (MS8) so does the tilt, into `mine` and the world.
    await useUserModelsStore.getState().commitPlacement("m1", { lat: 48.4647, lon: 35.0462, tU: -0.8 });
    expect(api.patches[1]).toEqual({ id: "m1", lat: 48.4647, lon: 35.0462, tU: -0.8 });
    expect(useUserModelsStore.getState().world.find((m) => m.id === "m1")).toMatchObject({ tU: -0.8 });
    await useUserModelsStore.getState().commitPlacement("m1", { lat: 48.4647, lon: 35.0462, pitchDeg: 90, rollDeg: -15 });
    expect(api.patches[2]).toEqual({ id: "m1", lat: 48.4647, lon: 35.0462, pitchDeg: 90, rollDeg: -15 });
    expect(useUserModelsStore.getState().mine.find((m) => m.id === "m1")).toMatchObject({ pitchDeg: 90, rollDeg: -15 });
    expect(useUserModelsStore.getState().world.find((m) => m.id === "m1")).toMatchObject({ pitchDeg: 90, rollDeg: -15 });
  });

  it("the gizmo commit PATCHes the seats and the fresh row outranks the fetched copy inside the grace", async () => {
    api.mineRows = [mine("m1")];
    api.worldRows = [pub("m1", { rotDeg: 0, scale: 1 }), pub("other")];
    const s = useUserModelsStore.getState();
    s.reportViewport(48.4647, 35.0462, 500);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    const row = await useUserModelsStore.getState().commitPlacement("m1", { lat: 48.4647, lon: 35.0462, rotDeg: 45, scale: 2 });
    expect(row).toMatchObject({ rotDeg: 45, scale: 2 });
    expect(api.patches[0]).toEqual({ id: "m1", lat: 48.4647, lon: 35.0462, rotDeg: 45, scale: 2 });
    const w = useUserModelsStore.getState().world.find((m) => m.id === "m1")!;
    expect(w).toMatchObject({ rotDeg: 45, scale: 2 });
    // A re-fetch that still carries the STALE server copy keeps the fresh local row…
    api.worldRows = [pub("m1", { rotDeg: 0, scale: 1 }), pub("other")];
    s.refresh();
    await flush();
    expect(useUserModelsStore.getState().world.find((m) => m.id === "m1")).toMatchObject({ rotDeg: 45, scale: 2 });
    // …until the grace has passed.
    await vi.advanceTimersByTimeAsync(MODELS.readLagGraceMs + 5);
    s.refresh();
    await flush();
    expect(useUserModelsStore.getState().world.find((m) => m.id === "m1")).toMatchObject({ rotDeg: 0, scale: 1 });
    // A failed PATCH answers null and leaves the world alone.
    api.patchPlacement = async () => {
      throw new Error("nope");
    };
    expect(await useUserModelsStore.getState().commitPlacement("m1", { lat: 1, lon: 2 })).toBeNull();
  });

  it("MS6: a FOREIGN commit swaps the public row into the world and never touches mine", async () => {
    api.mineRows = [mine("own")];
    api.worldRows = [pub("own"), pub("theirs", { rotDeg: 0, scale: 1 })];
    api.foreign.add("theirs");
    const s = useUserModelsStore.getState();
    await s.loadMine();
    s.reportViewport(48.4647, 35.0462, 500);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    const row = await useUserModelsStore.getState().commitPlacement("theirs", { lat: 48.4647, lon: 35.0462, rotDeg: 90, scale: 3 });
    expect(row).toMatchObject({ id: "theirs", rotDeg: 90, scale: 3 });
    expect(useUserModelsStore.getState().mine.map((m) => m.id)).toEqual(["own"]); // not mine, still
    expect(useUserModelsStore.getState().isMine("theirs")).toBe(false);
    expect(useUserModelsStore.getState().world.find((m) => m.id === "theirs")).toMatchObject({ rotDeg: 90, scale: 3 });
    // The fresh foreign row outranks a stale fetch inside the grace, like an own one.
    s.refresh();
    await flush();
    expect(useUserModelsStore.getState().world.find((m) => m.id === "theirs")).toMatchObject({ rotDeg: 90, scale: 3 });
  });

  it("MS6: rename swaps the title into mine and the world; hide leaves the world at once (and stays gone through a stale fetch); show brings it back", async () => {
    api.mineRows = [mine("m1")];
    api.worldRows = [pub("m1"), pub("other")];
    const s = useUserModelsStore.getState();
    await s.loadMine();
    s.reportViewport(48.4647, 35.0462, 500);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    const renamed = await useUserModelsStore.getState().rename("m1", "Kiosk");
    expect(renamed?.title).toBe("Kiosk");
    expect(api.metaPatches).toEqual([{ id: "m1", title: "Kiosk" }]);
    expect(useUserModelsStore.getState().mine[0].title).toBe("Kiosk");
    expect(useUserModelsStore.getState().world.find((m) => m.id === "m1")?.title).toBe("Kiosk");
    const hidden = await useUserModelsStore.getState().setHidden("m1", true);
    expect(hidden?.hidden).toBe(true);
    expect(useUserModelsStore.getState().mine[0].hidden).toBe(true);
    expect(useUserModelsStore.getState().world.map((m) => m.id)).toEqual(["other"]);
    // A re-fetch that still lists it (the read lag) keeps it out of the world inside the grace…
    s.refresh();
    await flush();
    expect(useUserModelsStore.getState().world.map((m) => m.id)).toEqual(["other"]);
    // …and SHOW puts it straight back.
    await useUserModelsStore.getState().setHidden("m1", false);
    expect(useUserModelsStore.getState().mine[0].hidden).toBe(false);
    expect(useUserModelsStore.getState().world.map((m) => m.id).sort()).toEqual(["m1", "other"]);
    // A failed meta PATCH answers null and changes nothing.
    api.patchMeta = async () => {
      throw new Error("nope");
    };
    expect(await useUserModelsStore.getState().rename("m1", "x")).toBeNull();
    expect(useUserModelsStore.getState().mine[0].title).toBe("Kiosk");
  });

  it("MS6: remove deletes the row and drops it from mine and the world at once", async () => {
    api.mineRows = [mine("m1"), mine("m2")];
    api.worldRows = [pub("m1"), pub("m2")];
    const s = useUserModelsStore.getState();
    await s.loadMine();
    s.reportViewport(48.4647, 35.0462, 500);
    await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
    await flush();
    expect(await useUserModelsStore.getState().remove("m1")).toBe(true);
    expect(api.deletes).toEqual(["m1"]);
    expect(useUserModelsStore.getState().mine.map((m) => m.id)).toEqual(["m2"]);
    expect(useUserModelsStore.getState().world.map((m) => m.id)).toEqual(["m2"]);
    // The stale fetch inside the grace cannot resurrect it.
    api.worldRows = [pub("m1"), pub("m2")];
    s.refresh();
    await flush();
    expect(useUserModelsStore.getState().world.map((m) => m.id)).toEqual(["m2"]);
    api.deleteModel = async () => ({ deleted: false, mediaDeleted: false });
    expect(await useUserModelsStore.getState().remove("m2")).toBe(false);
    expect(useUserModelsStore.getState().mine.map((m) => m.id)).toEqual(["m2"]);
  });

  it("publicFromMine + mergeWorld are pure", () => {
    expect(publicFromMine(mine("m1", { lat: null, lon: null }), "t")).toBeNull();
    expect(publicFromMine(mine("m1", { hidden: true }), "t")).toBeNull();
    expect(publicFromMine(mine("m1", { readiness: "PENDING" }), "t")).toBeNull();
    expect(publicFromMine(mine("m1", { rotDeg: 10, scale: 2 }), "t")).toMatchObject({ id: "m1", rotDeg: 10, scale: 2, updatedAt: "t" });
    const local = new Map([
      ["a", { row: pub("a", { rotDeg: 9 }), atMs: 1000 }],
      ["gone", { row: null, atMs: 1000 }],
      ["stale", { row: pub("stale", { rotDeg: 9 }), atMs: 0 }],
    ]);
    const merged = mergeWorld([pub("a"), pub("gone"), pub("stale"), pub("b")], local, 5000, 4500);
    expect(merged.map((m) => [m.id, m.rotDeg])).toEqual([
      ["a", 9],
      ["stale", 0],
      ["b", 0],
    ]);
  });

  it("mirrors density only on change", () => {
    const s = useUserModelsStore.getState();
    const before = useUserModelsStore.getState().density;
    s._syncDensity({ ...before });
    expect(useUserModelsStore.getState().density).toBe(before);
    s._syncDensity({ ...before, resident: 2, warn: true });
    expect(useUserModelsStore.getState().density).toMatchObject({ resident: 2, warn: true });
  });
});
