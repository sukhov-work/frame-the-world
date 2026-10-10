// store/find scan-config contract (owner 2026-08-15c) — bodies + range lifted out of
// panel-local state so the desktop panel, the /m FindSheet AND the SkyContextMenu
// quick-toggle share ONE truth. Defaults are owner rulings: moon-only, 1-month horizon.
import { beforeEach, describe, expect, it } from "vitest";
import { useFindStore, FIND_RANGES } from "../../src/store/find";
import { useSkyStore } from "../../src/store/sky";

describe("store/find scan config", () => {
  beforeEach(() => {
    useFindStore.setState({
      bodies: { sun: false, moon: true, target: false },
      rangeDays: 30,
      open: false,
    });
  });

  it("defaults: moon-only bodies, 1M (30-day) range", () => {
    const s = useFindStore.getState();
    expect(s.bodies).toEqual({ sun: false, moon: true, target: false });
    expect(s.rangeDays).toBe(30);
  });

  it("setBody flips one body without touching the others (the menu quick-toggle path)", () => {
    useFindStore.getState().setBody("sun", true);
    expect(useFindStore.getState().bodies).toEqual({ sun: true, moon: true, target: false });
    useFindStore.getState().setBody("moon", false);
    expect(useFindStore.getState().bodies).toEqual({ sun: true, moon: false, target: false });
  });

  it("setRangeDays writes through", () => {
    useFindStore.getState().setRangeDays(365);
    expect(useFindStore.getState().rangeDays).toBe(365);
  });

  it("publishGhosts still replaces anchor+ghosts wholesale (single-writer mirror unchanged)", () => {
    useFindStore.getState().publishGhosts({ latDeg: 48.4, lonDeg: 35.0 }, []);
    expect(useFindStore.getState().anchor).toEqual({ latDeg: 48.4, lonDeg: 35.0 });
    useFindStore.getState().publishGhosts(null, []);
    expect(useFindStore.getState().anchor).toBeNull();
    expect(useFindStore.getState().ghosts).toEqual([]);
  });
});

describe("store/sky TRACKING lock flag", () => {
  it("defaults OFF and toggles without persistence side effects on other flags", () => {
    const before = useSkyStore.getState();
    expect(before.track).toBe(false);
    before.setTrack(true);
    const after = useSkyStore.getState();
    expect(after.track).toBe(true);
    expect(after.visible).toBe(before.visible);
    expect(after.ghosts).toBe(before.ghosts);
    after.setTrack(false);
    expect(useSkyStore.getState().track).toBe(false);
  });
});

describe("store/find soloBody — FIND THIS ONE (owner 2026-10-10)", () => {
  beforeEach(() => {
    useFindStore.setState({ bodies: { sun: false, moon: true, target: false }, rangeDays: 30, open: false });
  });

  it("the target panels' button scans the named object and NOTHING else — the moon's default-on chip stands down", () => {
    useFindStore.getState().soloBody("sun");
    expect(useFindStore.getState().bodies).toEqual({ sun: true, moon: false, target: false });
    useFindStore.getState().soloBody("target");
    expect(useFindStore.getState().bodies).toEqual({ sun: false, moon: false, target: true });
  });

  it("solo leaves the range and the open flag alone (the FIND sheet's chips keep their truth)", () => {
    useFindStore.getState().setRangeDays(365);
    useFindStore.getState().soloBody("moon");
    expect(useFindStore.getState().rangeDays).toBe(365);
    expect(useFindStore.getState().open).toBe(false);
    expect(useFindStore.getState().bodies).toEqual({ sun: false, moon: true, target: false });
  });

  it("the shared FIND_RANGES list is the four owner chips", () => {
    expect(FIND_RANGES.map((r) => r.label)).toEqual(["1W", "1M", "6M", "1Y"]);
    expect(FIND_RANGES.map((r) => r.days)).toEqual([7, 30, 182, 365]);
  });
});
