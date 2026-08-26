import { describe, it, expect } from "vitest";
import {
  META_SCHEMA,
  cellUriOf,
  isPickableClass,
  metaUrlForGlb,
  parseCellMeta,
} from "../../../src/lib/globe/enrichedMeta";
import { buildTileset } from "../../../scripts/bake/lib/gltf.mjs";
import { META_SCHEMA as BAKE_SCHEMA, metaRow, cellMetaJson } from "../../../scripts/bake/lib/meta.mjs";

// RC17 — the sidecar's runtime half. The single most valuable test here is the LAST one: the
// writer and the reader are in different languages, in different trees, and nothing else forces
// them to agree.

describe("metaUrlForGlb", () => {
  it("names the baker's sibling", () => {
    expect(metaUrlForGlb("https://r2.example/enriched/dnipro-o2w/cell-10-10.glb")).toBe(
      "https://r2.example/enriched/dnipro-o2w/cell-10-10.meta.json",
    );
    expect(metaUrlForGlb("/enriched/dnipro/cell-0-0.glb")).toBe("/enriched/dnipro/cell-0-0.meta.json");
  });
  it("KEEPS the ?v cache-buster — the sidecar must invalidate with its glb, not after it", () => {
    expect(metaUrlForGlb("/enriched/x/cell-1-2.glb?v=dnipro-real-4")).toBe(
      "/enriched/x/cell-1-2.meta.json?v=dnipro-real-4",
    );
    expect(metaUrlForGlb("/enriched/x/cell-1-2.glb#frag")).toBe("/enriched/x/cell-1-2.meta.json");
  });
  it("refuses anything that is not a cell glb — a caller cannot probe the tileset by accident", () => {
    expect(metaUrlForGlb("/enriched/x/tileset.json")).toBeNull();
    expect(metaUrlForGlb("/enriched/x/cell-1-2.glb.map")).toBeNull();
    expect(metaUrlForGlb("")).toBeNull();
  });
});

// The cache-buster the baker stamps on content uris (2026-08-26) is the one place where the
// bake, the persistence key and the sidecar fetch all have to agree. These pin that agreement.
describe("cellUriOf ⇄ the baked content uri", () => {
  it("is stable across a version bump — U8 rows and banked seats key on it", () => {
    expect(cellUriOf("cell-10-10.glb?v=dnipro-real-4")).toBe("cell-10-10.glb");
    expect(cellUriOf("cell-10-10.glb?v=dnipro-real-9")).toBe("cell-10-10.glb");
    expect(cellUriOf("cell-10-10.glb")).toBe("cell-10-10.glb");
    expect(cellUriOf("https://r2.example/enriched/dnipro/cell-0-1.glb?v=x")).toBe("cell-0-1.glb");
  });

  it("agrees with what buildTileset actually writes", () => {
    const ts = buildTileset({
      originLatDeg: 48.46,
      originLonDeg: 35.05,
      bboxRegionRad: [0, 0, 0, 0, 0, 1],
      rootGeometricError: 512,
      cells: [{ regionRad: [0, 0, 0, 0, 0, 1], contentUri: "cell-3-4.glb", geometricError: 0 }],
      version: "dnipro-real-4",
    });
    const uri = ts.root.children[0].content.uri;
    expect(uri).toBe("cell-3-4.glb?v=dnipro-real-4");
    expect(cellUriOf(uri)).toBe("cell-3-4.glb");
    expect(metaUrlForGlb(uri)).toBe("cell-3-4.meta.json?v=dnipro-real-4");
  });

  it("an unversioned bake still writes a bare uri (the pre-2026-08-26 shape)", () => {
    const ts = buildTileset({
      originLatDeg: 0,
      originLonDeg: 0,
      bboxRegionRad: [0, 0, 0, 0, 0, 1],
      rootGeometricError: 512,
      cells: [{ regionRad: [0, 0, 0, 0, 0, 1], contentUri: "cell-0-0.glb" }],
      version: undefined,
    });
    expect(ts.root.children[0].content.uri).toBe("cell-0-0.glb");
  });
});

describe("isPickableClass", () => {
  it("admits the Building family", () => {
    expect(isPickableClass("Building")).toBe(true);
    expect(isPickableClass("BuildingPart")).toBe(true);
  });
  it("refuses the street furniture the 2.5 m height floor let through", () => {
    // Every one of these is TALLER than overrideMinPickHeightM, which is the whole point: the
    // floor could not see them. 273 HighVoltagePowerTower shipped in the Chernobyl o2w bake.
    for (const cls of [
      "HighVoltagePowerTower",
      "PowerTower",
      "Powerpole",
      "StreetLamp",
      "Wall",
      "RetainingWall",
      "Cliff",
      "Railing",
      "Flagpole",
      "Billboard",
      "MobilePhoneMast",
      "PhotovoltaicPlant",
    ])
      expect(isPickableClass(cls)).toBe(false);
  });
  it("is an ALLOW-list, so an OSM2World token nobody has seen is refused rather than admitted", () => {
    expect(isPickableClass("SomeFutureAntennaClass")).toBe(false);
    expect(isPickableClass("")).toBe(false);
  });
});

describe("parseCellMeta", () => {
  const good = {
    schema: META_SCHEMA,
    variant: "dnipro-o2w",
    skirtM: 4,
    features: [
      { id: 0, osm: "w1", cls: "Building", base: 0, top: 15, skirt: 4, src: "o2w" },
      { id: 7, osm: null, cls: "StreetLamp", base: 0, top: 6, skirt: 4, src: "o2w" },
    ],
  };

  it("indexes rows by feature id", () => {
    const m = parseCellMeta(good)!;
    expect(m.variant).toBe("dnipro-o2w");
    expect(m.skirtM).toBe(4);
    expect(m.byId.get(0)).toEqual({ osm: "w1", cls: "Building", base: 0, top: 15, skirt: 4, src: "o2w" });
    expect(m.byId.get(7)!.cls).toBe("StreetLamp");
    expect(m.byId.get(99)).toBeUndefined();
  });

  it("refuses a schema it does not understand rather than half-reading it", () => {
    expect(parseCellMeta({ ...good, schema: META_SCHEMA + 1 })).toBeNull();
    expect(parseCellMeta({ ...good, schema: undefined })).toBeNull();
    // The pre-RC17 o2w shape: no schema, no base/top. Refusing it is what keeps the fallback path
    // honest — a half-read sidecar would fence picks on classes while reporting skirted heights.
    expect(parseCellMeta({ features: [{ id: 0, osm: "w1", cls: "Building" }] })).toBeNull();
  });

  it("refuses a non-object / missing features", () => {
    expect(parseCellMeta(null)).toBeNull();
    expect(parseCellMeta("{}")).toBeNull();
    expect(parseCellMeta({ schema: META_SCHEMA })).toBeNull();
  });

  it("drops a malformed ROW without failing the cell", () => {
    const m = parseCellMeta({
      ...good,
      features: [...good.features, { id: 9, cls: "Building" }, { id: "x", cls: "Building", base: 0, top: 1, skirt: 0 }],
    })!;
    expect(m.byId.size).toBe(2);
    expect(m.byId.has(9)).toBe(false);
  });

  it("survives a sidecar with no features at all (an empty cell is legal)", () => {
    const m = parseCellMeta({ schema: META_SCHEMA, variant: "x", skirtM: 0, features: [] })!;
    expect(m.byId.size).toBe(0);
  });
});

describe("writer ⇄ reader contract", () => {
  it("the reader's schema number IS the writer's", () => {
    expect(META_SCHEMA).toBe(BAKE_SCHEMA);
  });

  it("parses a sidecar built by the real bake writer, skirt undone exactly", () => {
    // Exactly what bake.mjs / bake-osm2world.mjs emit: a 12 m building whose walls were lowered
    // 4 m, so its vertices span −4..12 and the row must read base 0 / top 12.
    const json = cellMetaJson({
      variant: "chernobyl-o2w",
      skirtM: 4,
      features: [
        metaRow({ id: 0, osm: "w456732992", cls: "Building", lo: -4, hi: 12, skirt: 4, src: "o2w" }),
        metaRow({ id: 1, osm: "n1", cls: "StreetLamp", lo: -4, hi: 6, skirt: 4, src: "o2w" }),
        metaRow({ id: 2, osm: "w2", cls: "Cliff", lo: 0, hi: 0, skirt: 0, src: "o2w" }),
      ],
    });
    const m = parseCellMeta(JSON.parse(json))!;
    expect(m).not.toBeNull();
    expect(m.variant).toBe("chernobyl-o2w");

    const b = m.byId.get(0)!;
    expect(b.base).toBe(0);
    expect(b.top - b.base).toBe(12); // the rendered height, NOT the 16 m the vertices span
    expect(isPickableClass(b.cls)).toBe(true);

    expect(isPickableClass(m.byId.get(1)!.cls)).toBe(false);
    expect(m.byId.get(2)!.skirt).toBe(0); // a flat ribbon was never skirted
  });
});
