import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS, PHOTO_PROJECT } from "../../src/components/globe/tuning";
import { encodeGeohash } from "../../src/lib/geo/geohash";
import type { FacadeListItem, FacadeWorldItem } from "../../src/lib/wix/facadeRecords";
import {
  _resetFacadesStore,
  _setFacadesApi,
  FACADE_MINE_MAX_PAGES,
  facadeRowById,
  FACADE_WORLD_CHUNK_CELLS,
  fetchFacadeWorldCover,
  isNewerOrSame,
  mergeFacadeWorld,
  useFacadesStore,
  worldFromMine,
  type FacadesApi,
} from "../../src/store/facades";
import { useMemberStore } from "../../src/store/member";

// F3 residency (T169 / T171, 2026-10-21): the facade WORLD store — the cover-driven, THROTTLED,
// PUBLIC world read in route-sized chunks (T190, owner 2026-10-22g: no member gate — a visitor
// reads the world like a member; the member-gated posture before it); MINE paged (member-only);
// the optimistic mirror with the read-lag grace (newest-wins); the editing seam.

const T0 = "2026-10-21T10:00:00.000Z";
const T1 = "2026-10-21T10:05:00.000Z";

const world = (id: string, over: Partial<FacadeWorldItem> = {}): FacadeWorldItem => ({
  id,
  title: `Facade ${id}`,
  displayUrl: `https://static.wixstatic.com/media/${id}-display.jpg`,
  thumbUrl: null,
  updatedAt: T0,
  lat: 48.4647,
  lon: 35.0462,
  apexAltM: 137.5,
  altitudeM: 1.7,
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  focalLengthMm: 26,
  hFovDeg: 69,
  fovEstimated: false,
  textureWidth: 4032,
  textureHeight: 3024,
  strength: 1,
  ownLight: 0.6,
  rangeM: null,
  ...over,
});
const mine = (id: string, over: Partial<FacadeListItem> = {}): FacadeListItem => ({
  ...world(id),
  targetFeatureIds: [],
  alignment: {},
  capturedAt: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  fileName: null,
  fileSizeBytes: null,
  poseSource: "EXIF",
  exifPose: null,
  createdAt: T0,
  isPublic: false,
  moderation: "PRIVATE",
  ...over,
});

interface FakeApi extends FacadesApi {
  worldCalls: string[][];
  worldRows: FacadeWorldItem[];
  worldStatus: number;
  mineCalls: number[];
  minePages: Array<{ facades: FacadeListItem[]; hasNext: boolean }>;
  mineStatus: number;
}
const makeApi = (): FakeApi => {
  const api: FakeApi = {
    worldCalls: [],
    worldRows: [],
    worldStatus: 200,
    mineCalls: [],
    minePages: [{ facades: [], hasNext: false }],
    mineStatus: 200,
    fetchWorld: async (cells) => {
      api.worldCalls.push([...cells]);
      if (api.worldStatus !== 200) {
        const err = new Error("no") as Error & { status?: number };
        err.status = api.worldStatus;
        throw err;
      }
      return { facades: [...api.worldRows], complete: true };
    },
    fetchMine: async (skip = 0) => {
      api.mineCalls.push(skip);
      if (api.mineStatus !== 200) {
        const err = new Error("no") as Error & { status?: number };
        err.status = api.mineStatus;
        throw err;
      }
      const page = api.minePages[Math.min(api.mineCalls.length - 1, api.minePages.length - 1)];
      return { facades: [...page.facades], hasNext: page.hasNext };
    },
  };
  return api;
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const tick = async () => {
  await vi.advanceTimersByTimeAsync(MODELS.queryThrottleMs + 5);
  await flush();
};

describe("store/facades", () => {
  let api: FakeApi;
  beforeEach(() => {
    vi.useFakeTimers();
    api = makeApi();
    _setFacadesApi(api);
    useMemberStore.setState({ phase: "member", member: { id: "m1", nickname: null, loginEmail: null } });
    _resetFacadesStore();
  });
  afterEach(() => {
    _setFacadesApi(null);
    _resetFacadesStore();
    useMemberStore.setState({ phase: "unknown", member: null });
    vi.useRealTimers();
  });

  it("plans a p5 cover from the focus with the facade knobs, throttles, and swaps the world atomically", async () => {
    api.worldRows = [world("a"), world("b")];
    const s = useFacadesStore.getState();
    s.reportViewport(48.4647, 35.0462, 500);
    s.reportViewport(48.4648, 35.0463, 500); // the same cover — no second timer
    expect(api.worldCalls.length).toBe(0);
    await tick();
    const st = useFacadesStore.getState();
    expect(st.cover).not.toBeNull();
    expect(st.cover!).toContain(encodeGeohash(48.4647, 35.0462, 5));
    expect(st.cover!.length).toBeLessThanOrEqual(PHOTO_PROJECT.coverMaxCells);
    expect(api.worldCalls.length).toBe(Math.ceil(st.cover!.length / FACADE_WORLD_CHUNK_CELLS));
    expect(st.world.map((r) => r.id)).toEqual(["a", "b"]);
    expect(st.worldPhase).toBe("ready");
    expect(st.complete).toBe(true);
    // `sameCover` short-circuit: the same cover again fires nothing.
    const calls = api.worldCalls.length;
    s.reportViewport(48.4649, 35.0464, 600);
    await tick();
    expect(api.worldCalls.length).toBe(calls);
  });

  it("a wide reach caps at coverMaxCells and goes out in chunks of ≤ 16 cells that together are exactly the cover", async () => {
    api.worldRows = [world("a")];
    useFacadesStore.getState().reportViewport(48.4647, 35.0462, 500, 20_000);
    await tick();
    const cover = useFacadesStore.getState().cover!;
    expect(cover.length).toBe(PHOTO_PROJECT.coverMaxCells);
    expect(cover.length).toBeGreaterThan(FACADE_WORLD_CHUNK_CELLS);
    expect(api.worldCalls.length).toBe(Math.ceil(cover.length / FACADE_WORLD_CHUNK_CELLS));
    expect(api.worldCalls.every((c) => c.length >= 1 && c.length <= FACADE_WORLD_CHUNK_CELLS)).toBe(true);
    expect(api.worldCalls.flat().sort()).toEqual(cover);
    // The fake answers the same row to every chunk: the merge dedupes by id.
    expect(useFacadesStore.getState().world.map((r) => r.id)).toEqual(["a"]);
  });

  it("above coverMaxAltM the world is dropped and the cover forgotten, so a descent re-queries at once", async () => {
    api.worldRows = [world("a")];
    const s = useFacadesStore.getState();
    s.reportViewport(48.4647, 35.0462, 500);
    await tick();
    const calls = api.worldCalls.length;
    expect(useFacadesStore.getState().world.length).toBe(1);
    s.reportViewport(48.4647, 35.0462, PHOTO_PROJECT.coverMaxAltM + 1);
    expect(useFacadesStore.getState().world).toEqual([]);
    expect(useFacadesStore.getState().cover).toBeNull();
    expect(useFacadesStore.getState().worldPhase).toBe("idle");
    s.reportViewport(48.4647, 35.0462, 500);
    await tick();
    expect(api.worldCalls.length).toBeGreaterThan(calls);
    expect(useFacadesStore.getState().world.length).toBe(1);
  });

  it("re-polls the same cover after idle (repollMs)", async () => {
    const s = useFacadesStore.getState();
    s.reportViewport(48.4647, 35.0462, 500);
    await tick();
    const calls = api.worldCalls.length;
    await vi.advanceTimersByTimeAsync(MODELS.repollMs + 5);
    s.reportViewport(48.4647, 35.0462, 500);
    await tick();
    expect(api.worldCalls.length).toBeGreaterThan(calls);
  });

  it("T190: ANONYMOUS → the world IS read (public), MINE is not; a sign-in loads MINE; a sign-out keeps the world and drops MINE", async () => {
    useMemberStore.setState({ phase: "anonymous", member: null });
    api.worldRows = [world("a")];
    api.minePages = [{ facades: [mine("a")], hasNext: false }];
    const s = useFacadesStore.getState();
    s.reportViewport(48.4647, 35.0462, 500);
    await tick();
    expect(api.worldCalls.length).toBeGreaterThan(0);
    expect(useFacadesStore.getState().cover).not.toBeNull();
    expect(useFacadesStore.getState().world.map((r) => r.id)).toEqual(["a"]);
    await s.loadMine();
    expect(api.mineCalls.length).toBe(0);
    expect(useFacadesStore.getState().minePhase).toBe("anonymous");
    // Sign-in: the member seam reloads MINE (the world needs no replay — it was never gated).
    const worldCallsAtSignIn = api.worldCalls.length;
    useMemberStore.setState({ phase: "member", member: { id: "m1", nickname: null, loginEmail: null } });
    await tick();
    expect(api.worldCalls.length).toBe(worldCallsAtSignIn);
    expect(api.mineCalls.length).toBe(1);
    expect(useFacadesStore.getState().minePhase).toBe("ready");
    useFacadesStore.getState().setEditing("a");
    // Sign-out: MINE + the row under edit go; the world and its cover STAY (a visitor sees them).
    useMemberStore.setState({ phase: "anonymous", member: null });
    expect(useFacadesStore.getState().world.map((r) => r.id)).toEqual(["a"]);
    expect(useFacadesStore.getState().cover).not.toBeNull();
    expect(useFacadesStore.getState().mine).toEqual([]);
    expect(useFacadesStore.getState().minePhase).toBe("anonymous");
    expect(useFacadesStore.getState().editingId).toBeNull();
    // …and `refresh()` re-queries while anonymous.
    const before = api.worldCalls.length;
    s.refresh();
    await tick();
    expect(api.worldCalls.length).toBeGreaterThan(before); // one query = one call per cover chunk
  });

  it("a 401 on the world read is 'no world', never an error; a 5xx is", async () => {
    api.worldStatus = 401;
    const s = useFacadesStore.getState();
    s.reportViewport(48.4647, 35.0462, 500);
    await tick();
    expect(useFacadesStore.getState().worldPhase).toBe("idle");
    expect(useFacadesStore.getState().cover).toBeNull();
    api.worldStatus = 500;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    s.reportViewport(48.4647, 35.0462, 500);
    await tick();
    expect(useFacadesStore.getState().worldPhase).toBe("error");
    warn.mockRestore();
  });

  it("loadMine pages through hasNext (skip = rows so far) and stops at the page rail; 401 → anonymous; 5xx → error", async () => {
    api.minePages = [
      { facades: [mine("a"), mine("b")], hasNext: true },
      { facades: [mine("c")], hasNext: true },
      { facades: [mine("d")], hasNext: false },
    ];
    await useFacadesStore.getState().loadMine();
    expect(api.mineCalls).toEqual([0, 2, 3]);
    expect(useFacadesStore.getState().mine.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(useFacadesStore.getState().minePhase).toBe("ready");
    // Always-more: the rail stops it.
    api.mineCalls = [];
    api.minePages = [{ facades: [mine("x")], hasNext: true }];
    await useFacadesStore.getState().loadMine();
    expect(api.mineCalls.length).toBe(FACADE_MINE_MAX_PAGES);
    api.mineCalls = [];
    api.mineStatus = 401;
    await useFacadesStore.getState().loadMine();
    expect(useFacadesStore.getState().minePhase).toBe("anonymous");
    expect(useFacadesStore.getState().mine).toEqual([]);
    api.mineStatus = 500;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useFacadesStore.getState().loadMine();
    expect(useFacadesStore.getState().minePhase).toBe("error");
    expect(useFacadesStore.getState().mineError).toBeTruthy();
    warn.mockRestore();
  });

  it("upsertMine replaces-or-prepends in MINE and mirrors the world shape into WORLD at once", () => {
    const s = useFacadesStore.getState();
    s.upsertMine(mine("a"));
    s.upsertMine(mine("b"));
    expect(useFacadesStore.getState().mine.map((m) => m.id)).toEqual(["b", "a"]);
    expect(useFacadesStore.getState().world.map((m) => m.id)).toEqual(["a", "b"]);
    expect(useFacadesStore.getState().minePhase).toBe("ready");
    s.upsertMine(mine("a", { title: "Renamed", headingDeg: 180 }));
    expect(useFacadesStore.getState().mine.map((m) => m.id)).toEqual(["a", "b"]);
    const w = useFacadesStore.getState().world.find((r) => r.id === "a")!;
    expect(w.title).toBe("Renamed");
    expect(w.headingDeg).toBe(180);
    // The world row is the slim shape — never the editor's facts.
    expect("exifPose" in w).toBe(false);
    expect("moderation" in w).toBe(false);
    expect(worldFromMine(mine("z"))).toEqual(world("z"));
    expect(s.isMine("a")).toBe(true);
    expect(s.isMine("nope")).toBe(false);
  });

  it("the read-lag grace: a just-saved row outranks the fetched copy (newest-wins), survives a read that lacks it, and expires", async () => {
    const s = useFacadesStore.getState();
    s.upsertMine(mine("a", { title: "Local", updatedAt: T1 }));
    // The server still answers the OLD copy (read lag) and does not know "b" yet.
    api.worldRows = [world("a", { title: "Stale", updatedAt: T0 })];
    s.upsertMine(mine("b", { updatedAt: T1 }));
    s.reportViewport(48.4647, 35.0462, 500);
    await tick();
    let w = useFacadesStore.getState().world;
    expect(w.find((r) => r.id === "a")!.title).toBe("Local");
    expect(w.map((r) => r.id).sort()).toEqual(["a", "b"]);
    // A LATER server copy (an edit from another tab) wins over the local one.
    api.worldRows = [world("a", { title: "Other tab", updatedAt: "2026-10-21T10:09:00.000Z" })];
    s.refresh();
    await flush();
    w = useFacadesStore.getState().world;
    expect(w.find((r) => r.id === "a")!.title).toBe("Other tab");
    // Past the grace the server's read is the truth: "b" leaves.
    await vi.advanceTimersByTimeAsync(MODELS.readLagGraceMs + 5);
    s.refresh();
    await flush();
    expect(useFacadesStore.getState().world.map((r) => r.id)).toEqual(["a"]);
  });

  it("removeMine drops the row from both lists, clears editing, and its tombstone outranks the lagging read", async () => {
    const s = useFacadesStore.getState();
    s.upsertMine(mine("a"));
    s.upsertMine(mine("b"));
    s.setEditing("a");
    s.removeMine("a");
    expect(useFacadesStore.getState().mine.map((m) => m.id)).toEqual(["b"]);
    expect(useFacadesStore.getState().world.map((m) => m.id)).toEqual(["b"]);
    expect(useFacadesStore.getState().editingId).toBeNull();
    api.worldRows = [world("a"), world("b")];
    api.minePages = [{ facades: [mine("a"), mine("b")], hasNext: false }];
    s.reportViewport(48.4647, 35.0462, 500);
    await tick();
    expect(useFacadesStore.getState().world.map((m) => m.id)).toEqual(["b"]);
    await s.loadMine();
    expect(useFacadesStore.getState().mine.map((m) => m.id)).toEqual(["b"]);
  });

  it("setEditing holds the row the editor has; removing another row keeps it", () => {
    const s = useFacadesStore.getState();
    s.setEditing("a");
    expect(useFacadesStore.getState().editingId).toBe("a");
    s.removeMine("b");
    expect(useFacadesStore.getState().editingId).toBe("a");
    s.setEditing(null);
    expect(useFacadesStore.getState().editingId).toBeNull();
  });
});

describe("the pure helpers", () => {
  it("fetchFacadeWorldCover: chunks ≤ 16, `complete` is every chunk's, a moved row is taken once (newest), one failed chunk fails the read", async () => {
    const cells = Array.from({ length: 40 }, (_, i) => `u8${"0123456789bcdefghjkmnpqrstuvwxyz"[i % 32]}${"0123456789bcdefghjkmnpqrstuvwxyz"[Math.floor(i / 32)]}0`);
    const seen: string[][] = [];
    const answer = await fetchFacadeWorldCover(cells, async (chunk) => {
      seen.push([...chunk]);
      const first = seen.length === 1;
      return {
        facades: [world("moved", { title: first ? "old" : "new", updatedAt: first ? T0 : T1 }), world(`only-${seen.length}`)],
        complete: seen.length !== 2,
      };
    });
    expect(seen.length).toBe(3);
    expect(seen.every((c) => c.length <= FACADE_WORLD_CHUNK_CELLS)).toBe(true);
    expect(seen.flat()).toEqual(cells);
    expect(answer.complete).toBe(false);
    expect(answer.facades.find((r) => r.id === "moved")!.title).toBe("new");
    expect(answer.facades.length).toBe(4);
    await expect(
      fetchFacadeWorldCover(cells, async (chunk) => {
        if (chunk[0] === cells[16]) throw new Error("boom");
        return { facades: [], complete: true };
      }),
    ).rejects.toThrow("boom");
  });

  it("mergeFacadeWorld: fresh local wins when at least as new, tombstones drop, stale local yields", () => {
    const local = new Map([
      ["a", { row: world("a", { title: "local", updatedAt: T1 }), atMs: 1000 }],
      ["b", { row: null, atMs: 1000 }],
      ["c", { row: world("c", { title: "old local", updatedAt: T0 }), atMs: 1000 }],
      ["d", { row: world("d", { title: "expired" }), atMs: 0 }],
      ["e", { row: world("e", { title: "fresh new" }), atMs: 1000 }],
    ]);
    const fetched = [world("a", { title: "server", updatedAt: T0 }), world("b"), world("c", { title: "server new", updatedAt: T1 }), world("z")];
    const out = mergeFacadeWorld(fetched, local, 1500, 1000);
    expect(out.map((r) => `${r.id}:${r.title}`)).toEqual(["a:local", "c:server new", "z:Facade z", "e:fresh new"]);
    expect(mergeFacadeWorld(fetched, new Map(), 0, 1000)).toEqual(fetched);
    expect(isNewerOrSame(T1, T0)).toBe(true);
    expect(isNewerOrSame(T0, T0)).toBe(true);
    expect(isNewerOrSame(T0, T1)).toBe(false);
    expect(isNewerOrSame("garbage", T1)).toBe(true);
    expect(isNewerOrSame(T0, "garbage")).toBe(false);
  });
});

// T178 + T183 (owner asks 2026-10-22): the marker seams — the low-cadence HOVER mirror (the
// pins.hoverPin idiom) the compact card reads, the context MENU (the modelEdit.menu idiom), and
// the row resolver (mine first, then world).
describe("store/facades — the marker hover + menu seams", () => {
  beforeEach(() => _resetFacadesStore());
  afterEach(() => _resetFacadesStore());

  it("_syncHover sets id + screen together and clears both together", () => {
    const s = () => useFacadesStore.getState();
    expect(s().hover).toBeNull();
    s()._syncHover("a", { x: 120, y: 340 });
    expect(s().hover).toEqual({ id: "a", screen: { x: 120, y: 340 } });
    s()._syncHover(null, { x: 1, y: 2 });
    expect(s().hover).toBeNull();
    s()._syncHover("a", { x: 1, y: 2 });
    s()._syncHover("a", null);
    expect(s().hover).toBeNull();
  });

  it("a repeated identical sync keeps the same object (no re-render); a move or a new id replaces it", () => {
    const s = () => useFacadesStore.getState();
    s()._syncHover("a", { x: 10, y: 20 });
    const first = s().hover;
    let notified = 0;
    const unsub = useFacadesStore.subscribe(() => notified++);
    s()._syncHover("a", { x: 10, y: 20 });
    expect(s().hover).toBe(first);
    s()._syncHover(null, null);
    s()._syncHover(null, null); // clearing twice notifies once
    expect(notified).toBe(1);
    unsub();
    s()._syncHover("a", { x: 10, y: 20 });
    const again = s().hover;
    s()._syncHover("a", { x: 11, y: 20 });
    expect(s().hover).not.toBe(again);
    s()._syncHover("b", { x: 11, y: 20 });
    expect(s().hover?.id).toBe("b");
  });

  it("_setMenu opens at the press point and clears the hover; closeMenu / _setMenu(null) close it", () => {
    const s = () => useFacadesStore.getState();
    s()._syncHover("a", { x: 10, y: 20 });
    s()._setMenu({ id: "a", screenX: 300, screenY: 200 });
    expect(s().menu).toEqual({ id: "a", screenX: 300, screenY: 200 });
    expect(s().hover).toBeNull();
    s().closeMenu();
    expect(s().menu).toBeNull();
    s()._setMenu({ id: "b", screenX: 1, screenY: 2 });
    s()._setMenu(null);
    expect(s().menu).toBeNull();
  });

  it("facadeRowById: the own row first, else the world row, else null", () => {
    const own = mine("a", { title: "mine copy" });
    const st = { mine: [own], world: [world("a", { title: "world copy" }), world("w")] };
    expect(facadeRowById(st, "a")).toBe(own);
    expect(facadeRowById(st, "w")?.title).toBe("Facade w");
    expect(facadeRowById(st, "zz")).toBeNull();
  });

  it("the reset seam and a sign-out drop the hover and the menu", () => {
    const s = () => useFacadesStore.getState();
    useMemberStore.setState({ phase: "member", member: { id: "m1", nickname: null, loginEmail: null } });
    s()._syncHover("a", { x: 1, y: 1 });
    useFacadesStore.setState({ menu: { id: "a", screenX: 1, screenY: 1 } });
    useMemberStore.setState({ phase: "anonymous", member: null });
    expect(s().hover).toBeNull();
    expect(s().menu).toBeNull();
    s()._syncHover("a", { x: 1, y: 1 });
    _resetFacadesStore();
    expect(s().hover).toBeNull();
    useMemberStore.setState({ phase: "unknown", member: null });
  });
});
