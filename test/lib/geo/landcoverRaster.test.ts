import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { describe, expect, it } from "vitest";
import {
  clipLineToBounds,
  clipRingToBounds,
  parseVectorTile,
  ringArea,
  tileLocalToLonLat,
  type ParsedVtile,
  type VecLineFeat,
  type VecPolyFeat,
} from "../../../src/components/globe/scene/vectorTiles";
import { VECTOR } from "../../../src/components/globe/tuning";
import type { MiniMapFill } from "../../../src/store/minimap";
import { AERIAL_MIN_M, type LandClass } from "../../../src/lib/geo/bestSpotTypes";
import { BESTSPOT_SCORING_V1 } from "../../../src/lib/geo/bestSpotScoring";
import {
  accessAt,
  buildLandGrid,
  cellOfLonLat,
  classAt,
  classFraction,
  DEMOTE_K,
  LAND_CLASSES,
  LAND_CODE,
  landcoverPaint,
  landusePaint,
  localOfLonLat,
  lonLatOfCell,
  makeLandGrid,
  softAt,
  SOFT_Q,
  xOfIx,
  yOfIy,
  type LandGrid,
  type LandSource,
} from "../../../src/lib/geo/landcoverRaster";
import {
  cellEast,
  cellIndexAt,
  createLocalDsm,
  discGridSpec,
  insideSolidInterior,
  oddSpanCells,
  stampSolid,
  type LocalDsm,
} from "../../../src/lib/geo/localDsm";
import { ecefToGeodetic, enuBasis, geodeticToEcef, type Vec3 } from "../../../src/lib/geo/projection";

/**
 * BEST SPOT S2a — the landcover / accessibility raster + the MVT parser widening.
 *
 * THE FIXTURE. `fixtures/ofm-z14-9787-5662-dnipro-central-bridge.pbf` is a REAL OpenFreeMap z14
 * tile, fetched 2026-08-24 through the dated build path the TileJSON resolved to that day
 * (`https://tiles.openfreemap.org/planet` → `…/planet/20260816_080001_pt/14/9787/5662.pbf`) — the
 * tile holding 48.47831,35.05757, the Dnipro Central Bridge, the owner's hero location.
 *
 * It is TRIMMED, not synthesised. Six layers (building / landcover / landuse / transportation /
 * water / waterway) were copied out of the top-level protobuf BYTE FOR BYTE and the rest dropped
 * (poi 21.8 KB, transportation_name, place, housenumber, boundary, aeroway, water_name,
 * mountain_peak): 54,217 B → 21,643 B, with no re-encoding, so every geometry, key and value below
 * is exactly what the server served. Layer counts: building 21, landcover 108, landuse 20,
 * transportation 123, water 5, waterway 6.
 *
 * Every test here is written to FAIL if the behaviour it pins is reverted to the pre-2026-08-24
 * form. Where a pin exists to kill a specific shipped bug, that bug is REPRODUCED in the test body
 * as a negative control, so a green run cannot mean "the probe found nothing".
 */

const FIXTURE = join(__dirname, "fixtures", "ofm-z14-9787-5662-dnipro-central-bridge.pbf");
const TX = 9787;
const TY = 5662;
const TILE_Z = 14;

/** The Dnipro Central Bridge deck — BESTSPOT_PLAN §2 F3, "the owner's hero location". */
const HERO = { latDeg: 48.47831, lonDeg: 35.05757 };
/** Open Dnipro, 100 m east of the hero cell along the same parallel (probed on this fixture). */
const OPEN_WATER = { latDeg: 48.47831449155588, lonDeg: 35.05893189157896 };
/** Centroid of the fixture's tallest building (render_height 59, render_min_height 0). */
const BUILDING = { latDeg: 48.481491, lonDeg: 35.068235 };

/**
 * THE TRUE ENU WALKER — the frame every geometry assertion in this file is written in.
 *
 * Built from `projection.geodeticToEcef` + `projection.enuBasis` DIRECTLY, never from the module
 * under test: walk `x` metres east and `y` metres north along the real basis at `centre`, then read
 * the geodetic point back. This is, by construction, the frame `localDsm.rasterizeTinGround` puts
 * every terrain vertex in and the frame `horizonSweep` sweeps in — so "the raster agrees with this
 * walker" IS "the accessibility mask and the obstruction field are registered".
 *
 * It is also the negative control's yardstick: the equirectangular idiom this module used to project
 * with (`Δlon·111_320·cos φ`) misses these points by 0.94 m at 500 m and 1.42 m at the 700 m collar.
 */
function enuWalker(centre: { latDeg: number; lonDeg: number }) {
  const o: Vec3 = geodeticToEcef(centre.latDeg, centre.lonDeg, 0);
  const b = enuBasis(centre.latDeg, centre.lonDeg);
  return (x: number, y: number): [number, number] => {
    const g = ecefToGeodetic([
      o[0] + x * b.east[0] + y * b.north[0],
      o[1] + x * b.east[1] + y * b.north[1],
      o[2] + x * b.east[2] + y * b.north[2],
    ]);
    return [g.lonDeg, g.latDeg];
  };
}

/** The SHIPPED (pre-2026-08-24) projection, kept as a negative control: a module-private
 *  `M_PER_DEG_LAT = 111_320` and the equirectangular idiom. Every frame pin below reproduces the bug
 *  with it, so a green run cannot mean "the probe found nothing". */
function equirectangularOfLonLat(
  centre: { latDeg: number; lonDeg: number },
  lonDeg: number,
  latDeg: number,
): [number, number] {
  const M_PER_DEG_LAT = 111_320;
  return [
    (lonDeg - centre.lonDeg) * M_PER_DEG_LAT * Math.cos((centre.latDeg * Math.PI) / 180),
    (latDeg - centre.latDeg) * M_PER_DEG_LAT,
  ];
}

function rawTile(): ArrayBuffer {
  const b = readFileSync(FIXTURE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function loadTile(): ParsedVtile {
  return parseVectorTile(rawTile(), TX, TY);
}

/** Shoelace area (m²) of a lon/lat ring, through the grid's own ENU frame. */
function ringAreaM2(grid: LandGrid, ring: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = localOfLonLat(grid, ring[i][0], ring[i][1]);
    const q = localOfLonLat(grid, ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1]);
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

/** Even-odd point-in-polygon over a lon/lat ring, evaluated in the grid's own ENU metres. Used to
 *  prove a cell is INSIDE the Dnipro's water polygon independently of what the raster painted. */
function insideRing(
  grid: LandGrid,
  ring: readonly (readonly [number, number])[],
  lonDeg: number,
  latDeg: number,
): boolean {
  const [px, py] = localOfLonLat(grid, lonDeg, latDeg);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = localOfLonLat(grid, ring[i][0], ring[i][1]);
    const b = localOfLonLat(grid, ring[j][0], ring[j][1]);
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

// =================================================================================================
// PART 1 — the parser widening (BESTSPOT_PLAN §4)
// =================================================================================================

describe("parser widening (a) — the deck survives", () => {
  it("PIN: `if (f.type !== 2) continue` dropped 8 transportation polygons, one of them the hero deck", () => {
    // NEGATIVE CONTROL — the shipped line, run against the same bytes. Everything it skipped is
    // enumerated here, so "the widening found nothing" cannot pass as "the widening works".
    const vt = new VectorTile(new PbfReader(new Uint8Array(rawTile())));
    const layer = vt.layers["transportation"];
    const droppedByShipped: string[] = [];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 2) droppedByShipped.push(String(f.properties.class ?? ""));
    }
    expect(droppedByShipped.sort()).toEqual([
      "bridge",
      "bridge",
      "bridge",
      "pier",
      "pier",
      "pier",
      "pier",
      "pier",
    ]);

    const tile = loadTile();
    const decks = tile.areas.filter((a) => a.kind === "deck");
    expect(decks).toHaveLength(droppedByShipped.length);
    expect(decks.filter((d) => d.cls === "bridge")).toHaveLength(3);
    expect(decks.filter((d) => d.cls === "pier")).toHaveLength(5);

    // The hero deck itself: the plan measured 29,054 m² and carries `layer = 1`.
    const grid = makeLandGrid({
      centreLatDeg: HERO.latDeg,
      centreLonDeg: HERO.lonDeg,
      halfSpanM: 250,
      cellM: 1,
    });
    const areas = decks
      .filter((d) => d.cls === "bridge")
      .map((d) => ringAreaM2(grid, d.polys[0][0]));
    const hero = Math.max(...areas);
    expect(hero).toBeGreaterThan(28_000);
    expect(hero).toBeLessThan(30_000);
    expect(decks.find((d) => ringAreaM2(grid, d.polys[0][0]) === hero)?.layer).toBe(1);
  });

  it("PIN: ≥ 2 % of the hero disc is class `deck` with hard = 1 — the shipped parser yields 0.00 %", () => {
    const tile = loadTile();
    const spec = {
      centreLatDeg: HERO.latDeg,
      centreLonDeg: HERO.lonDeg,
      halfSpanM: 250,
      cellM: 1,
    };
    const grid = buildLandGrid(spec, [tile]);
    expect(grid.nx).toBe(501); // ODD — `oddSpanCells`, so the pin is a cell CENTRE (see MINOR 2)

    const deckFrac = classFraction(grid, "deck");
    expect(deckFrac).toBeGreaterThanOrEqual(0.02);
    expect(deckFrac).toBeLessThan(0.2); // a STRIP across the river, not a flood fill

    // Every deck cell is standable at eye height, and the strip is CONTIGUOUS: walking the hero
    // cell's row must cross one unbroken run of deck, not speckle.
    const hero = cellOfLonLat(grid, HERO.lonDeg, HERO.latDeg);
    let runs = 0;
    let inRun = false;
    let runCells = 0;
    for (let ix = 0; ix < grid.nx; ix++) {
      const isDeck = classAt(grid, ix, hero.iy) === "deck";
      if (isDeck) {
        runCells++;
        expect(accessAt(grid, ix, hero.iy, 1.7, false)).toEqual({
          hard: 1,
          soft: 1,
          cls: "deck",
          groundReachable: true,
        });
      }
      if (isDeck && !inRun) runs++;
      inRun = isDeck;
    }
    expect(runs).toBe(1);
    expect(runCells).toBeGreaterThan(20); // ~25 m of deck across the row

    // NEGATIVE CONTROL — the shipped parser reproduced: `areas` never existed, so the raster had
    // nothing to paint decks from. Same bytes, same grid, ZERO deck cells.
    const before = buildLandGrid(spec, [{ lines: tile.lines, polys: tile.polys, areas: [] }]);
    expect(classFraction(before, "deck")).toBe(0);

    // SPEC CORRECTION, recorded here because the next audit will look for it. BESTSPOT_PLAN §2 F3
    // says "the deck IS the standable strip over the river". Measured on this fixture, under the
    // plan's OWN paint order (water → road → path → deck), that is not quite true: the bridge's
    // carriageway and its two footway ways are LINES, they paint over water, and they already
    // cover all 11,703 deck cells — ZERO deck cell was `water` in the no-deck build. What the deck
    // actually buys is the VERDICT, not the hard gate: soft 0.15 (a trunk carriageway, the second
    // worst rung on the ladder) becomes soft 1.0 (a place to stand), and the class the panel
    // prints stops being "primary road".
    expect(classAt(before, hero.ix, hero.iy)).toBe("majorRoad");
    expect(accessAt(before, hero.ix, hero.iy, 1.7, false).soft).toBe(0.15);
    expect(accessAt(grid, hero.ix, hero.iy, 1.7, false).soft).toBe(1);
  });
});

describe("parser widening (b)–(e) — the five fields", () => {
  const tile = loadTile();

  it("(b) road lines keep subclass / surface / access / foot / layer", () => {
    const roads = tile.lines.filter((l) => l.kind === "road");
    // The pedestrian taxonomy the plan says "exists and is thrown away".
    expect([...new Set(roads.map((r) => r.subclass).filter(Boolean))].sort()).toEqual([
      "cycleway",
      "footway",
      "path",
      "steps",
      "tram",
    ]);
    // The four demotion / exclusion channels are all present in this one tile.
    expect(roads.some((r) => r.surface === "unpaved")).toBe(true);
    expect(roads.some((r) => r.access === "no")).toBe(true);
    expect(roads.some((r) => r.foot === "no")).toBe(true);
    // `layer` is SIGNED and must not collapse to 0 — this tile carries −1 underpass paths…
    expect(roads.some((r) => r.layer === -1)).toBe(true);
    // …and must stay `undefined` where the tag is absent (0 would be an assertion nobody made).
    expect(roads.some((r) => r.layer === undefined)).toBe(true);
  });

  it("(c) water polygons keep `class` — the Dnipro and a swimming pool stop being one object", () => {
    const water = tile.polys.filter((p) => p.kind === "water");
    expect(water.map((w) => w.cls).sort()).toEqual([
      "lake",
      "lake",
      "lake",
      "lake",
      "swimming_pool",
    ]);
    expect(water.every((w) => w.intermittent === false)).toBe(true);
  });

  it("(d) the landuse layer is parsed — including the C6-relevant industrial/military class", () => {
    const landuse = tile.areas.filter((a) => a.kind === "landuse");
    // 20 features in the layer; 3 of them lie entirely in the MVT BUFFER outside the tile square
    // and are removed by the shipped `clipRingToBounds` (the river-flicker fix) exactly as every
    // other polygon layer's are. The widening changes what is PARSED, never how it is clipped.
    expect(landuse).toHaveLength(17);
    expect(landuse.some((l) => l.cls === "industrial")).toBe(true);
    // S3a §5.3(a): `Paint` carries PROVENANCE (the flag bits), not a baked soft byte — the soft
    // value is resolved from the scoring profile at READ time, which is what turned the whole
    // accessibility ladder from a re-raster into a recompose. The class is still what decides.
    expect(landusePaint("military")).toEqual({ code: LAND_CODE.blocked, flags: 0 });
    expect(landusePaint("industrial")).toEqual({ code: LAND_CODE.blocked, flags: 0 });
    expect(landusePaint("pitch")).toEqual({ code: LAND_CODE.pitch, flags: 0 });
    // …and the soft rungs those codes resolve to are unchanged.
    expect(BESTSPOT_SCORING_V1.access.soft.blocked).toBe(0.1);
    expect(BESTSPOT_SCORING_V1.access.soft.pitch).toBe(0.85);
    // A class with no ruling stays null — a `residential` ring covers half a city and must not
    // repaint the parks inside it.
    expect(landusePaint("residential")).toBeNull();
    expect(landusePaint("school")).toBeNull();
  });

  it("(e) building polygons keep render_height / render_min_height (on EVERY z14 feature)", () => {
    const builds = tile.polys.filter((p) => p.kind === "building");
    expect(builds).toHaveLength(21);
    expect(builds.every((b) => typeof b.renderHeightM === "number")).toBe(true);
    expect(builds.every((b) => typeof b.renderMinHeightM === "number")).toBe(true);
    // R1's aerial mask needs a real BASE, not an assumed 0: two of these solids start at 3 m.
    expect(builds.filter((b) => b.renderMinHeightM === 3)).toHaveLength(2);
    expect(Math.max(...builds.map((b) => b.renderHeightM ?? 0))).toBe(59);
  });

  it("waterways keep `brunnel` + `intermittent` WITHOUT flipping the shipped `tunnel` flag", () => {
    const ways = tile.lines.filter((l) => l.kind === "waterway");
    expect(ways).toHaveLength(6);
    expect(ways.filter((w) => w.brunnel === "tunnel")).toHaveLength(1);
    // THE ADDITIVITY RULE, pinned. `minimapFeed` skips `line.tunnel`, so setting it here would
    // silently delete a culverted drain from the shipped FPV mini-map. The honest answer lives in
    // `brunnel`; `tunnel` stays exactly what it always was for this kind.
    expect(ways.every((w) => w.tunnel === false)).toBe(true);
    expect(ways.every((w) => w.bridge === false)).toBe(true);
  });
});

describe("parser widening (f) — the DEAD landcover filter", () => {
  const tile = loadTile();

  it("PIN: `class ?? subclass` can never reach the subclass branch — every feature carries class", () => {
    // The fixture's two `{class:"grass", subclass:"park"}` features are the exact shape the
    // shipped filter was supposed to catch through GREEN_CLASSES' `park` entry.
    const parks = tile.polys.filter((p) => p.kind === "green" && p.subclass === "park");
    expect(parks).toHaveLength(2);

    // NEGATIVE CONTROL — the shipped expression, evaluated on those features' real properties. It
    // short-circuits on `class` EVERY time, so `park`/`meadow`/`recreation_ground` in GREEN_CLASSES
    // were unreachable code for the entire life of the module.
    const vt = new VectorTile(new PbfReader(new Uint8Array(rawTile())));
    const lc = vt.layers["landcover"];
    let reachedSubclass = 0;
    let sawParkSubclass = 0;
    for (let i = 0; i < lc.length; i++) {
      const props = lc.feature(i).properties;
      const shippedRead = String(props.class ?? props.subclass ?? "");
      if (props.class === undefined) reachedSubclass++;
      if (props.subclass === "park") {
        sawParkSubclass++;
        expect(shippedRead).toBe("grass");
        expect(shippedRead).not.toBe("park");
      }
    }
    expect(sawParkSubclass).toBe(2); // the branch HAD work to do…
    expect(reachedSubclass).toBe(0); // …and could never be reached to do it

    // The widening's own consequence: the subclass SURVIVES the parse now. Before, `VecPolyFeat`
    // had no `subclass` field at all, so this value did not exist downstream.
    expect(parks[0].cls).toBe("grass");
    expect(parks[0].subclass).toBe("park");
  });

  it("PIN: reading the subclass changes the VERDICT — a pitch is 0.85, not grass at 0.9", () => {
    // Read via SUBCLASS: green, exactly as GREEN_CLASSES always intended.
    // (S3a §5.3(a): `Paint` is `{ code, flags }` — the soft rung is resolved at read time. The
    // VERDICT this pin is about is the CODE, which is untouched.)
    expect(landcoverPaint("", "park")).toEqual({ code: LAND_CODE.green, flags: 0 });
    expect(landcoverPaint("", "meadow")).toEqual({ code: LAND_CODE.green, flags: 0 });
    expect(landcoverPaint("", "recreation_ground")).toEqual({
      code: LAND_CODE.green,
      flags: 0,
    });
    // The class-only read is not merely redundant, it is WRONG: OpenMapTiles files a sports pitch
    // as class "grass", and the ladder puts pitch/playground a rung below park/grass.
    expect(landcoverPaint("grass", "pitch")).toEqual({ code: LAND_CODE.pitch, flags: 0 });
    expect(landcoverPaint("grass", "grass")).toEqual({ code: LAND_CODE.green, flags: 0 });
    expect(BESTSPOT_SCORING_V1.access.soft.pitch).toBeLessThan(
      BESTSPOT_SCORING_V1.access.soft.green,
    );
    // A wetland is the bottom of the ladder and is NOT a hard exclusion.
    expect(landcoverPaint("wetland", "wetland")).toEqual({ code: LAND_CODE.wetland, flags: 0 });
    // No ruling ⇒ no paint. Ignorance must not be scored.
    expect(landcoverPaint("farmland", "farmland")).toBeNull();
    expect(landcoverPaint("ice", "")).toBeNull();
  });

  it("non-green landcover reaches the raster through `areas`, and geometry is never duplicated", () => {
    const cover = tile.areas.filter((a) => a.kind === "landcover");
    expect(cover.map((c) => c.cls).sort()).toEqual(["sand", "sand", "wetland", "wetland", "wetland"]);
    const green = tile.polys.filter((p) => p.kind === "green").length;
    expect(green).toBe(94);
    // 108 features in the layer, 99 survive the tile-square clip — and every survivor lands in
    // EXACTLY ONE of the two arrays. A feature counted twice would be rasterized twice.
    expect(green + cover.length).toBe(99);
  });
});

describe("the widening is ADDITIVE — shipped consumers see byte-identical data", () => {
  /**
   * The shipped (pre-2026-08-24) parser, reimplemented from the same exported primitives. If the
   * widening ever moves a feature between arrays, changes an order, admits a new green fill, or
   * perturbs a single coordinate, this diverges. This is the pin that lets the next session widen
   * the parser again without reading `vectorFeatures` / `streetNames` / `minimapFeed` / `MiniMap`.
   */
  const GREEN_CLASSES = new Set(["grass", "wood", "park", "meadow", "recreation_ground"]);

  it("`lines` and `polys` are exactly what the shipped parser produced", () => {
    const vt = new VectorTile(new PbfReader(new Uint8Array(rawTile())));
    const toLonLat = (extent: number, p: { x: number; y: number }) => {
      const { lonDeg, latDeg } = tileLocalToLonLat(TILE_Z, TX, TY, extent, p.x, p.y);
      return [lonDeg, latDeg] as [number, number];
    };
    const lines: unknown[] = [];
    const polys: unknown[] = [];

    const roadLayer = vt.layers["transportation"];
    for (let i = 0; i < roadLayer.length; i++) {
      const f = roadLayer.feature(i);
      if (f.type !== 2) continue; // ← THE SHIPPED LINE THAT DROPPED THE DECK
      const cls = String(f.properties.class ?? "");
      if (!(cls in VECTOR.roadWidthM)) continue;
      const brunnel = String(f.properties.brunnel ?? "");
      const parts: [number, number][][] = [];
      for (const part of f.loadGeometry()) {
        if (part.length < 2) continue;
        for (const clipped of clipLineToBounds(part, 0, roadLayer.extent)) {
          parts.push(clipped.map((p) => toLonLat(roadLayer.extent, p)));
        }
      }
      if (parts.length === 0) continue;
      lines.push({
        kind: "road",
        cls,
        bridge: brunnel === "bridge",
        tunnel: brunnel === "tunnel",
        lines: parts,
      });
    }
    const wwLayer = vt.layers["waterway"];
    for (let i = 0; i < wwLayer.length; i++) {
      const f = wwLayer.feature(i);
      if (f.type !== 2) continue;
      const parts: [number, number][][] = [];
      for (const part of f.loadGeometry()) {
        if (part.length < 2) continue;
        for (const clipped of clipLineToBounds(part, 0, wwLayer.extent)) {
          parts.push(clipped.map((p) => toLonLat(wwLayer.extent, p)));
        }
      }
      if (parts.length === 0) continue;
      lines.push({
        kind: "waterway",
        cls: String(f.properties.class ?? "stream"),
        bridge: false,
        tunnel: false,
        lines: parts,
      });
    }
    for (const { name, kind, filter } of [
      { name: "water", kind: "water", filter: null },
      { name: "landcover", kind: "green", filter: (c: string) => GREEN_CLASSES.has(c) },
      { name: "park", kind: "green", filter: null },
      { name: "building", kind: "building", filter: null },
    ] as const) {
      const layer = vt.layers[name];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue;
        if (filter && !filter(String(f.properties.class ?? f.properties.subclass ?? ""))) continue;
        const out: [number, number][][][] = [];
        for (const rawRing of f.loadGeometry()) {
          if (rawRing.length < 4) continue;
          const ring = clipRingToBounds(rawRing, 0, layer.extent);
          if (ring.length < 3) continue;
          const outer = ringArea(ring) > 0;
          const lonlat = ring.map((p) => toLonLat(layer.extent, p));
          if (outer || out.length === 0) out.push([lonlat]);
          else out[out.length - 1].push(lonlat);
        }
        if (out.length) polys.push({ kind, polys: out });
      }
    }

    // POSITIVE CONTROL: the reimplementation really did parse something.
    expect(lines.length).toBeGreaterThan(50);
    expect(polys.length).toBeGreaterThan(50);

    const tile = loadTile();
    expect(
      tile.lines.map((l) => ({
        kind: l.kind,
        cls: l.cls,
        bridge: l.bridge,
        tunnel: l.tunnel,
        lines: l.lines,
      })),
    ).toEqual(lines);
    expect(tile.polys.map((p) => ({ kind: p.kind, polys: p.polys }))).toEqual(polys);
  });

  it("`VecPolyFeat.kind` stays a closed 3-kind union — the MiniMapFill contract", () => {
    // The reason decks / landuse / non-green landcover live in `areas`: `minimapFeed` pushes
    // `{ kind: poly.kind }` straight into a `MiniMapFill`, so widening THIS union would break a
    // file that this slice does not own. The assignment below is the real pin, and it is enforced
    // by `astro check` rather than by vitest — the runtime expects are its positive control.
    const kind: VecPolyFeat["kind"] = "building";
    const asFill: MiniMapFill["kind"] = kind;
    expect(asFill).toBe("building");
    expect([...new Set(loadTile().polys.map((p) => p.kind))].sort()).toEqual([
      "building",
      "green",
      "water",
    ]);
  });
});

// =================================================================================================
// PART 2 — the raster
// =================================================================================================

const ORIGIN = { latDeg: 48.47831, lonDeg: 35.05757 };
const EMPTY: LandSource = { lines: [], polys: [], areas: [] };
const SPEC50 = {
  centreLatDeg: ORIGIN.latDeg,
  centreLonDeg: ORIGIN.lonDeg,
  halfSpanM: 50,
  cellM: 1,
};

/** Local metres about ORIGIN → lon/lat, through the TRUE ENU basis (see `enuWalker`). Every synthetic
 *  ring below is therefore placed in the DSM's frame, and a raster projecting in any other frame lands
 *  it on the wrong cells — which is exactly what the 500 m/1 m pins measure. */
const at = enuWalker(ORIGIN);

function squareRing(half: number): [number, number][] {
  return [at(-half, -half), at(half, -half), at(half, half), at(-half, half)];
}

function countClass(grid: LandGrid, cls: LandClass): number {
  let n = 0;
  for (let iy = 0; iy < grid.ny; iy++) {
    for (let ix = 0; ix < grid.nx; ix++) if (classAt(grid, ix, iy) === cls) n++;
  }
  return n;
}

/** Class of the cell containing a local-metre point. */
function classAtXY(grid: LandGrid, x: number, y: number): LandClass {
  const [lon, lat] = at(x, y);
  const c = cellOfLonLat(grid, lon, lat);
  return classAt(grid, c.ix, c.iy);
}

/** One road/waterway line along the x axis, with whatever tags the test is about. */
function lineFeat(over: Partial<VecLineFeat> & Pick<VecLineFeat, "kind" | "cls">): VecLineFeat {
  return {
    bridge: false,
    tunnel: false,
    lines: [[at(-30, 0), at(30, 0)]],
    ...over,
  };
}

describe("rasterizer — scanline fill", () => {
  it("PIN: a 41 × 41 m ring rasterizes to 1,681 cells at 1 m (±1 boundary cell = 1,600…1,764)", () => {
    const src: LandSource = { ...EMPTY, polys: [{ kind: "building", polys: [[squareRing(20.5)]] }] };
    const grid = buildLandGrid(SPEC50, [src]);
    expect(grid.nx).toBe(101); // ODD — the centre pin is a cell CENTRE, not a corner
    const n = countClass(grid, "building");
    expect(n).toBeGreaterThanOrEqual(40 * 40);
    expect(n).toBeLessThanOrEqual(42 * 42);
    // Cell centres now sit at 0, ±1, ±2 … m from the disc centre (odd `n`), so a [−20.5, +20.5]
    // span covers exactly 41 of them per axis. Half-integer edges on purpose: with the centre on a
    // cell centre, an INTEGER-edged ring puts its boundary exactly through a row of cell centres,
    // where the half-open crossing rule is a coin flip about which side owns them.
    expect(n).toBe(1_681);
  });

  it("PIN: a HOLE (inner ring) is NOT filled — even-odd parity, not 'fill every ring'", () => {
    const src: LandSource = {
      ...EMPTY,
      polys: [{ kind: "building", polys: [[squareRing(20.5), squareRing(10.5)]] }],
    };
    const grid = buildLandGrid(SPEC50, [src]);
    // 41² − 21² = 1,240. A rasterizer that fills each ring independently returns 1,681.
    expect(countClass(grid, "building")).toBe(1_240);
    // …and the courtyard is genuinely UNKNOWN, not "building".
    expect(classAtXY(grid, 0, 0)).toBe("unknown");
    const c = cellOfLonLat(grid, ORIGIN.lonDeg, ORIGIN.latDeg);
    expect(accessAt(grid, c.ix, c.iy, 1.7, false).hard).toBe(1);
  });

  it("a ring wholly outside the grid paints nothing (no clamping smear onto the rim)", () => {
    const far: [number, number][] = [at(200, 200), at(240, 200), at(240, 240), at(200, 240)];
    const grid = buildLandGrid(SPEC50, [{ ...EMPTY, polys: [{ kind: "building", polys: [[far]] }] }]);
    expect(countClass(grid, "building")).toBe(0);
  });
});

describe("rasterizer — line ribbons", () => {
  const rowsOfRoad = (grid: LandGrid): number[] => {
    const col = cellOfLonLat(grid, ORIGIN.lonDeg, ORIGIN.latDeg).ix;
    const rows: number[] = [];
    for (let iy = 0; iy < grid.ny; iy++) if (classAt(grid, col, iy) === "road") rows.push(iy);
    return rows;
  };

  it("PIN: a ribbon is `widthM/cellM` cells wide to within one cell, centred on the polyline", () => {
    // ON the cell-centre lattice. The centreline runs through y = 0, which IS a row of cell centres
    // now that `n` is odd, so an ODD-metre width is the tie-free case: centres at 0, ±1, ±2, ±3 are
    // inside a 3.5 m half-width and ±4 is clearly outside.
    expect(VECTOR.roadWidthM.minor).toBe(7); // the width this half of the pin is written against
    const grid = buildLandGrid(SPEC50, [
      { ...EMPTY, lines: [lineFeat({ kind: "road", cls: "minor" })] },
    ]);
    const rows = rowsOfRoad(grid);
    expect(rows).toHaveLength(7);
    expect(rows[rows.length - 1] - rows[0]).toBe(6); // contiguous, no gaps
    expect((rows[0] + rows[rows.length - 1]) / 2).toBe((grid.ny - 1) / 2); // symmetric about the centre CELL

    // OFF the lattice by half a cell, EVEN width: centres at −3.5 … +4.5 from the line ⇒ exactly 8.
    // (An 8 m ribbon ON the lattice is deliberately not asserted: its rim centres would sit EXACTLY
    // at the 4 m half-width, where the verdict is decided by the last bit of the projection — a
    // knife-edge makes a pin flaky, not falsifiable.)
    expect(VECTOR.roadWidthM.raceway).toBe(8);
    const offset = buildLandGrid(SPEC50, [
      {
        ...EMPTY,
        lines: [lineFeat({ kind: "road", cls: "raceway", lines: [[at(-30, 0.5), at(30, 0.5)]] })],
      },
    ]);
    expect(rowsOfRoad(offset)).toHaveLength(8);
  });

  it("a bend is filled on its OUTSIDE — capsules, not a union of per-segment quads", () => {
    const grid = buildLandGrid(SPEC50, [
      {
        ...EMPTY,
        lines: [lineFeat({ kind: "road", cls: "raceway", lines: [[at(-20, -20), at(0, 0), at(20, -20)]] })],
      },
    ]);
    // (1, 3) is 3.16 m from the vertex, so a round join covers it — but it is BEYOND the parametric
    // end of both segments, so a plain quad strip leaves a wedge of bare ground there.
    expect(classAtXY(grid, 1, 3)).toBe("road");
    expect(classAtXY(grid, 1, 5)).toBe("unknown"); // 5.10 m away — the join does not over-reach
  });
});

describe("paint order IS the algorithm (BESTSPOT_PLAN §4)", () => {
  it("PIN: deck OVER water, building OVER deck, path OVER road", () => {
    const src: LandSource = {
      lines: [
        lineFeat({ kind: "road", cls: "primary", lines: [[at(-40, 30), at(40, 30)]] }),
        lineFeat({ kind: "road", cls: "path", lines: [[at(-40, 30), at(40, 30)]] }),
      ],
      polys: [
        { kind: "water", cls: "lake", polys: [[squareRing(45)]] },
        { kind: "building", polys: [[squareRing(5)]] },
      ],
      areas: [{ kind: "deck", cls: "bridge", subclass: "", polys: [[squareRing(20)]] }],
    };
    const grid = buildLandGrid(SPEC50, [src]);
    expect(classAtXY(grid, 0, 0)).toBe("building"); // buildings paint LAST
    expect(classAtXY(grid, 15, 0)).toBe("deck"); // deck beats water — THE hero override
    expect(classAtXY(grid, 35, 0)).toBe("water"); // open water survives beside it
    expect(classAtXY(grid, 0, 30)).toBe("path"); // path beats road (soft 1.0 over 0.15)

    // …and the soft value follows the class that WON, not the one that painted first.
    const [plon, plat] = at(0, 30);
    const pc = cellOfLonLat(grid, plon, plat);
    expect(softAt(grid, pc.ix, pc.iy)).toBe(1);
  });
});

describe("the ground ladder and its demotions", () => {
  const read = (src: LandSource, x = 0, y = 0) => {
    const grid = buildLandGrid(SPEC50, [src]);
    const [lon, lat] = at(x, y);
    const c = cellOfLonLat(grid, lon, lat);
    return accessAt(grid, c.ix, c.iy, 1.7, false);
  };

  it("an unpainted cell is UNKNOWN at soft 0.45 and is NEVER a hard exclusion", () => {
    const grid = buildLandGrid(SPEC50, []);
    const a = accessAt(grid, 10, 10, 1.7, false);
    expect(a).toEqual({ hard: 1, soft: 0.45, cls: "unknown", groundReachable: true });
    // …and so is a cell outside the grid entirely: ignorance, not a bad spot.
    expect(accessAt(grid, -5, 999, 1.7, false).cls).toBe("unknown");
    expect(accessAt(grid, -5, 999, 1.7, false).hard).toBe(1);
  });

  it("PIN: `surface=unpaved` / `foot=no` DEMOTE a way — they never delete it", () => {
    const path = (over: Partial<VecLineFeat>) => ({
      ...EMPTY,
      lines: [lineFeat({ kind: "road", cls: "path", ...over })],
    });
    expect(read(path({}))).toMatchObject({ cls: "path", hard: 1, soft: 1 });
    expect(read(path({ surface: "unpaved" }))).toMatchObject({
      cls: "path",
      hard: 1,
      soft: DEMOTE_K,
    });
    expect(read(path({ foot: "no" }))).toMatchObject({ cls: "path", hard: 1, soft: DEMOTE_K });
    // …but access is a GATE, not a demotion.
    expect(read(path({ access: "no" }))).toMatchObject({ cls: "blocked", hard: 0 });
    expect(read(path({ access: "private" }))).toMatchObject({ cls: "blocked", hard: 0 });
  });

  it("PIN: a CULVERTED drain is not a hazard, and an INTERMITTENT one is wetland, not water", () => {
    expect(VECTOR.waterwayWidthM.river).toBe(12); // the width this pin is written against
    const river = (over: Partial<VecLineFeat>) => ({
      ...EMPTY,
      lines: [lineFeat({ kind: "waterway", cls: "river", ...over })],
    });
    expect(read(river({}))).toMatchObject({ cls: "water", hard: 0 });
    // `brunnel` is read, NOT the (hard-false for waterways) `tunnel` flag. Reading `tunnel` here
    // would leave every culvert in the city scored as an open river.
    expect(read(river({ brunnel: "tunnel", tunnel: false }))).toMatchObject({ cls: "unknown" });
    expect(read(river({ intermittent: true }))).toMatchObject({
      cls: "wetland",
      hard: 1,
      soft: 0.1,
    });
  });

  it("a live railway centreline is a hard exclusion", () => {
    expect(read({ ...EMPTY, lines: [lineFeat({ kind: "road", cls: "rail" })] })).toMatchObject({
      cls: "blocked",
      hard: 0,
    });
  });

  it("LAND_CODE and LAND_CLASSES are exact inverses (a scrambled code silently relabels the map)", () => {
    for (const cls of LAND_CLASSES) expect(LAND_CLASSES[LAND_CODE[cls]]).toBe(cls);
    expect(LAND_CODE.unknown).toBe(0); // a zero-filled Uint8Array must read as ignorance
    expect(LAND_CLASSES).toHaveLength(11);
  });

  it("every ladder rung AND its demotion is exactly representable at SOFT_Q", () => {
    for (const soft of [1, 0.9, 0.85, 0.6, 0.45, 0.15, 0.1]) {
      expect(Math.round(soft * SOFT_Q) / SOFT_Q).toBe(soft);
      const demoted = soft * DEMOTE_K * SOFT_Q;
      expect(Math.abs(demoted - Math.round(demoted))).toBeLessThan(1e-9);
    }
  });
});

// =================================================================================================
// The hero pins — real fixture, real bridge, real river
// =================================================================================================

describe("HERO: the river is a hard exclusion but the bridge over it is not", () => {
  const tile = loadTile();
  const spec = { centreLatDeg: HERO.latDeg, centreLonDeg: HERO.lonDeg, halfSpanM: 250, cellM: 1 };
  const grid = buildLandGrid(spec, [tile]);
  const deckCell = cellOfLonLat(grid, HERO.lonDeg, HERO.latDeg);
  const waterCell = cellOfLonLat(grid, OPEN_WATER.lonDeg, OPEN_WATER.latDeg);

  /** The Dnipro itself — the biggest `class = "lake"` ring on the tile (2.03 km²). */
  const dnipro = tile.polys
    .filter((p) => p.kind === "water" && p.cls === "lake")
    .map((p) => p.polys[0][0])
    .reduce((a, b) => (ringAreaM2(grid, b) > ringAreaM2(grid, a) ? b : a));

  it("PIN: the hero cell is INSIDE the water polygon and UNDER the deck → hard = 1, cls `deck`", () => {
    // "Inside the water polygon" is asserted GEOMETRICALLY, against the lake ring itself, so the
    // claim does not depend on what any paint pass decided. (This is the honest form of the pin:
    // the paint-order answer is confounded by the bridge's own road ways — see the SPEC CORRECTION
    // in the deck-fraction test above.)
    expect(ringAreaM2(grid, dnipro)).toBeGreaterThan(1_500_000); // 1.93 km² of river on this tile
    expect(insideRing(grid, dnipro, HERO.lonDeg, HERO.latDeg)).toBe(true);

    expect(accessAt(grid, deckCell.ix, deckCell.iy, 1.7, false)).toEqual({
      hard: 1,
      soft: 1,
      cls: "deck",
      groundReachable: true,
    });
  });

  it("PIN: a cell in OPEN water is still hard = 0 — the override is local to the deck", () => {
    expect(insideRing(grid, dnipro, OPEN_WATER.lonDeg, OPEN_WATER.latDeg)).toBe(true);
    const a = accessAt(grid, waterCell.ix, waterCell.iy, 1.7, false);
    expect(a.cls).toBe("water");
    expect(a.hard).toBe(0);
    expect(a.groundReachable).toBe(false);
    // …and it is genuinely ~100 m from the deck cell, not a neighbouring pixel.
    const [dx, dy] = localOfLonLat(grid, OPEN_WATER.lonDeg, OPEN_WATER.latDeg);
    expect(Math.hypot(dx, dy)).toBeGreaterThan(90);
    expect(Math.hypot(dx, dy)).toBeLessThan(110);
  });

  it("the disc reads as the plan measured it: mostly river, a deck strip, a road ribbon", () => {
    // BESTSPOT_PLAN §2 F3 measured the Central Bridge TILE at water 91.2 % / road 5.0 % / deck
    // 3.8 %. This 500 m box centred on the deck is a different frame, but the shape must hold:
    // river dominates, the deck is a few per cent, and nothing else is more than a trace.
    expect(classFraction(grid, "water")).toBeGreaterThan(0.85);
    expect(classFraction(grid, "deck")).toBeGreaterThan(0.02);
    expect(classFraction(grid, "building")).toBe(0); // no footprints in the river box
    // …and NOTHING else is more than a trace: one footway cell clipped by the box edge, and not a
    // single UNKNOWN — a 500 m box on the river is fully classified.
    expect(Math.round(classFraction(grid, "path") * grid.cls.length)).toBe(1);
    expect(classFraction(grid, "unknown")).toBe(0);
    const total = (["water", "deck", "majorRoad", "path", "unknown"] as const)
      .map((c) => classFraction(grid, c))
      .reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
  });
});

// =================================================================================================
// MINOR 1 — ONE DATUM. `accessAt` × `localDsm.insideSolidInterior`, composed.
// =================================================================================================

/**
 * THE DATUM THE WHOLE SECTION TURNS ON. Dnipro's right bank is ~100 m above the ellipsoid, and the
 * DSM stores `solidBase`/`solidTop` ABSOLUTELY (height above the local sphere) while the altitude
 * slider — and therefore `accessAt` — speaks ABOVE-GROUND metres.
 *
 * **EVERY test below uses a NONZERO ground on purpose.** At ground 0 the two datums coincide, so the
 * shipped bug (comparing an above-ground sheet height straight against the absolute pair) passes
 * every assertion: it is the exact shape of a check that cannot fail, and it is why R1's only aerial
 * gate shipped switched off. The "at ground 0 EVERY datum agrees" test below DEMONSTRATES that claim
 * on the same fixture rather than merely asserting it in a comment.
 */
const GROUND_M = 100;

/**
 * The accessibility mask and the obstruction field over the SAME disc, from the two constructors the
 * solver uses. `oddSpanCells` is what makes their lattices identical — asserted here, not assumed —
 * so one `(ix, iy)` means one square metre in both.
 */
function matchedPair(
  centre: { latDeg: number; lonDeg: number },
  radiusM: number,
  cellM: number,
  groundM: number,
  tiles: readonly LandSource[],
): { grid: LandGrid; dsm: LocalDsm } {
  const grid = buildLandGrid(
    { centreLatDeg: centre.latDeg, centreLonDeg: centre.lonDeg, halfSpanM: radiusM, cellM },
    tiles,
  );
  const dsm = createLocalDsm(discGridSpec(radiusM, cellM));
  dsm.ground.fill(groundM);
  dsm.groundKnown.fill(1);
  return { grid, dsm };
}

describe("HERO: owner ruling R1 — DRONE semantics at and above 5 m, over ground at 100 m", () => {
  const tile = loadTile();
  const { grid: river, dsm: riverDsm } = matchedPair(HERO, 250, 1, GROUND_M, [tile]);
  const waterCell = cellOfLonLat(river, OPEN_WATER.lonDeg, OPEN_WATER.latDeg);
  const waterC = cellIndexAt(riverDsm, waterCell.ix, waterCell.iy);

  const { grid: city, dsm: cityDsm } = matchedPair(BUILDING, 60, 1, GROUND_M, [tile]);
  const buildingCell = cellOfLonLat(city, BUILDING.lonDeg, BUILDING.latDeg);
  const buildingC = cellIndexAt(cityDsm, buildingCell.ix, buildingCell.iy);

  /** The fixture's tallest footprint, stamped into the DSM through the RASTER'S OWN frame, so the
   *  solid and the `"building"` class come from one polygon in one projection. */
  const tall = tile.polys
    .filter((p) => p.kind === "building")
    .reduce((a, b) => ((b.renderHeightM ?? 0) > (a.renderHeightM ?? 0) ? b : a));
  const ring: number[] = [];
  for (const [lon, lat] of tall.polys[0][0]) {
    const [e, n] = localOfLonLat(city, lon, lat);
    ring.push(e, n);
  }
  stampSolid(cityDsm, {
    ring,
    baseM: tall.renderMinHeightM ?? 0,
    topM: tall.renderHeightM ?? 0,
    datum: "aboveGround", // MVT render_height IS above-ground; the DSM re-bases it once, here
  });

  it("the two grids are ONE lattice — a cell index means the same square metre in both", () => {
    expect(city.nx).toBe(cityDsm.nx);
    expect(river.nx).toBe(riverDsm.nx);
    for (const ix of [0, 1, 37, 60, 119, 120]) expect(xOfIx(city, ix)).toBe(cellEast(cityDsm, ix));
    // …and the DSM really did receive the same building the raster painted.
    expect(tall.renderHeightM).toBe(59);
    expect(cityDsm.solidMask[buildingC]).toBe(1);
    expect(cityDsm.solidBase[buildingC]).toBeCloseTo(GROUND_M, 4); // ABSOLUTE: 100 + 0
    expect(cityDsm.solidTop[buildingC]).toBeCloseTo(GROUND_M + 59, 4); // ABSOLUTE: 100 + 59
  });

  it("PIN: THE DATUM. 10 m above 100 m ground is INSIDE a 59 m building — both wrong datums say free", () => {
    // THE ANSWER. One function owns the rebase, and it is given the SAME above-ground height that
    // goes into `accessAt`.
    expect(insideSolidInterior(cityDsm, buildingC, 10)).toBe(true);
    expect(accessAt(city, buildingCell.ix, buildingCell.iy, 10, insideSolidInterior(cityDsm, buildingC, 10)))
      .toEqual({ hard: 0, soft: 1, cls: "building", groundReachable: false });

    // NEGATIVE CONTROL 1 — THE SHIPPED FORM: the above-ground sheet height compared straight against
    // the ABSOLUTE pair, exactly as `accessAt(grid, ix, iy, 10, dsm.solidBase[c], dsm.solidTop[c])`
    // did. `10 >= 100` is false ⇒ not inside ⇒ hard 1: a drone declared free inside the building,
    // which is R1's only aerial gate switched off.
    const shipped = 10 >= cityDsm.solidBase[buildingC] && 10 < cityDsm.solidTop[buildingC];
    expect(shipped).toBe(false);
    expect(accessAt(city, buildingCell.ix, buildingCell.iy, 10, shipped).hard).toBe(1);

    // NEGATIVE CONTROL 2 — the OTHER datum, passed to the right function: an ABSOLUTE height (ground
    // + sheet = 110) fed to a parameter that means ABOVE-GROUND reads 210 against [100, 159) and
    // misses in the opposite direction. Both mistakes fail OPEN, which is the dangerous direction.
    expect(insideSolidInterior(cityDsm, buildingC, GROUND_M + 10)).toBe(false);
    expect(
      accessAt(city, buildingCell.ix, buildingCell.iy, 10, insideSolidInterior(cityDsm, buildingC, GROUND_M + 10))
        .hard,
    ).toBe(1);
  });

  it("PIN: at ground 0 EVERY datum agrees — which is why the shipped tests could not fail", () => {
    // The same disc, the same building, the same call — with the ground the old tests used.
    const { grid: flat, dsm: flatDsm } = matchedPair(BUILDING, 60, 1, 0, [tile]);
    stampSolid(flatDsm, { ring, baseM: 0, topM: 59, datum: "aboveGround" });
    const c = cellIndexAt(flatDsm, buildingCell.ix, buildingCell.iy);
    expect(flatDsm.solidBase[c]).toBe(0);
    expect(flatDsm.solidTop[c]).toBeCloseTo(59, 4);
    const shipped = 10 >= flatDsm.solidBase[c] && 10 < flatDsm.solidTop[c];
    // Right and wrong are indistinguishable here — the bug and the fix return the same byte.
    expect(shipped).toBe(insideSolidInterior(flatDsm, c, 10));
    expect(accessAt(flat, buildingCell.ix, buildingCell.iy, 10, shipped).hard).toBe(0);
    // …whereas the very same comparison on the 100 m-ground twin disagrees with the right answer.
    // That difference IS the bug, and it exists only at nonzero ground.
    const shipped100 = 10 >= cityDsm.solidBase[buildingC] && 10 < cityDsm.solidTop[buildingC];
    expect(shipped100).not.toBe(insideSolidInterior(cityDsm, buildingC, 10));
  });

  it("PIN: the SAME water cell is hard 0 at 1.7 m and hard 1 at 60 m, groundReachable false in both", () => {
    expect(AERIAL_MIN_M).toBe(5);
    const inSolid = (h: number) => insideSolidInterior(riverDsm, waterC, h);
    expect(inSolid(60)).toBe(false); // open river: no solid, at any datum
    const low = accessAt(river, waterCell.ix, waterCell.iy, 1.7, inSolid(1.7));
    const high = accessAt(river, waterCell.ix, waterCell.iy, 60, inSolid(60));
    expect(low.hard).toBe(0);
    expect(high.hard).toBe(1);
    expect(high.soft).toBe(1); // above the ground rules, landcover is not a preference
    expect(high.cls).toBe("water"); // …but the legend still says what you are 60 m above
    expect(low.groundReachable).toBe(false);
    expect(high.groundReachable).toBe(false); // "a place I can climb to" survives as a readout
    // The threshold is AT 5 m, not above it.
    expect(accessAt(river, waterCell.ix, waterCell.iy, 4.999, inSolid(4.999)).hard).toBe(0);
    expect(accessAt(river, waterCell.ix, waterCell.iy, 5, inSolid(5)).hard).toBe(1);
  });

  it("PIN: the interior is half-open and the ground rules still own everything below 5 m", () => {
    expect(classAt(city, buildingCell.ix, buildingCell.iy)).toBe("building");
    const a = (h: number) =>
      accessAt(city, buildingCell.ix, buildingCell.iy, h, insideSolidInterior(cityDsm, buildingC, h));
    expect(a(10).hard).toBe(0); // interior
    expect(a(60).hard).toBe(1); // over the roof (59 m)
    expect(a(59).hard).toBe(1); // ON the roof — `h < render_height` is EXCLUSIVE, you can stand there
    expect(a(58.9).hard).toBe(0);
    // Below 5 m the GROUND rules own the cell, whatever the envelope says.
    expect(a(1.7).hard).toBe(0);
    expect(a(1.7).cls).toBe("building");
    expect(a(1.7).soft).toBe(0.1); // the ground ladder's value, not the aerial flat 1
    // A cell with NO solid never gates up high, however tall its neighbours are.
    const openC = cellIndexAt(cityDsm, 0, 0);
    expect(cityDsm.solidMask[openC]).toBe(0);
    expect(insideSolidInterior(cityDsm, openC, 60)).toBe(false);
    expect(accessAt(city, 0, 0, 60, false).hard).toBe(1);
  });

  it("PIN: a solid on STILTS — the drone flies UNDER the arch, and the base is not assumed 0", () => {
    // `render_min_height = 8` over 100 m of ground ⇒ the absolute envelope is [108, 130).
    const { grid, dsm } = matchedPair(BUILDING, 60, 1, GROUND_M, [tile]);
    const stilts = [-10, -10, 10, -10, 10, 10, -10, 10];
    stampSolid(dsm, { ring: stilts, baseM: 8, topM: 30, datum: "aboveGround" });
    const c = cellIndexAt(dsm, buildingCell.ix, buildingCell.iy);
    expect(dsm.solidBase[c]).toBeCloseTo(108, 4);
    expect(insideSolidInterior(dsm, c, 6)).toBe(false); // through the arch
    expect(insideSolidInterior(dsm, c, 10)).toBe(true); // into the mass
    expect(accessAt(grid, buildingCell.ix, buildingCell.iy, 6, insideSolidInterior(dsm, c, 6)).hard).toBe(1);
    expect(accessAt(grid, buildingCell.ix, buildingCell.iy, 10, insideSolidInterior(dsm, c, 10)).hard).toBe(0);
  });

  it("PIN: the DECK still overrides water at eye height, and carries groundReachable up with it", () => {
    // R1's ladder in one cell: the hero deck is standable ground below 5 m (soft 1, not the river's
    // hard 0) AND its ground verdict rides along as the aerial secondary readout.
    const deckCell = cellOfLonLat(river, HERO.lonDeg, HERO.latDeg);
    const deckC = cellIndexAt(riverDsm, deckCell.ix, deckCell.iy);
    expect(classAt(river, deckCell.ix, deckCell.iy)).toBe("deck");
    expect(accessAt(river, deckCell.ix, deckCell.iy, 1.7, false)).toEqual({
      hard: 1,
      soft: 1,
      cls: "deck",
      groundReachable: true,
    });
    expect(accessAt(river, deckCell.ix, deckCell.iy, 60, insideSolidInterior(riverDsm, deckC, 60))).toEqual({
      hard: 1,
      soft: 1,
      cls: "deck",
      groundReachable: true, // the owner CAN climb to this column — the water cell 100 m east cannot
    });
  });
});

// =================================================================================================
// MINOR 2 — ONE FRAME, ONE PARITY, ONE SEAM.
// =================================================================================================

describe("the local ENU frame IS the DSM's frame", () => {
  const grid = makeLandGrid({
    centreLatDeg: HERO.latDeg,
    centreLonDeg: HERO.lonDeg,
    halfSpanM: 700, // the plan's disc radius + the 400 m collar (§5) — where the drift is worst
    cellM: 1,
  });

  it("PIN: a round trip through the TRUE ENU basis agrees to ≪ 1 cell at 500 m and at the 700 m collar", () => {
    const walk = enuWalker(HERO);
    let worst = 0;
    let worstShipped = 0;
    for (const r of [500, 700]) {
      for (let deg = 0; deg < 360; deg += 45) {
        const x = r * Math.sin((deg * Math.PI) / 180);
        const y = r * Math.cos((deg * Math.PI) / 180);
        const [lon, lat] = walk(x, y);
        const [gx, gy] = localOfLonLat(grid, lon, lat);
        worst = Math.max(worst, Math.hypot(gx - x, gy - y));
        // NEGATIVE CONTROL — the shipped equirectangular projection on the same point.
        const [sx, sy] = equirectangularOfLonLat(HERO, lon, lat);
        worstShipped = Math.max(worstShipped, Math.hypot(sx - x, sy - y));
      }
    }
    // The frame is now the DSM's frame, to well under a 1 m ULTRA cell — this is a REGISTRATION
    // claim, not a precision one: the landcover mask and the obstruction field address the same
    // square metre.
    expect(worst).toBeLessThan(0.01);
    // …and the projection it replaced missed by more than a cell at the rim: 0.94 m at 500 m east,
    // 1.42 m at (700, 700). A systematic scale bias (111_320 vs 111_199 m/deg lat, 73_810 vs
    // 73_952 m/deg lon at this latitude), not noise.
    expect(worstShipped).toBeGreaterThan(1);
  });

  it("PIN: the drift is WORSE in the southern hemisphere and worst at the EQUATOR", () => {
    // Measured while fixing this: the equirectangular form's latitude factor is at its most wrong on
    // the equator (110_574 m/deg, not 111_320) and its cross term flips sign across it — so a fix
    // validated only at Dnipro would have shipped a bigger error to every other site.
    for (const [site, shippedFloor] of [
      [{ latDeg: -33.8688, lonDeg: 151.2093 }, 2.5], // Sydney: 2.67 m at the 700 m collar
      [{ latDeg: 0, lonDeg: -78.5 }, 4.5], // the equator: 4.72 m
    ] as const) {
      const g = makeLandGrid({
        centreLatDeg: site.latDeg,
        centreLonDeg: site.lonDeg,
        halfSpanM: 700,
        cellM: 1,
      });
      const walk = enuWalker(site);
      let worst = 0;
      let worstShipped = 0;
      for (const [x, y] of [
        [700, 700],
        [0, 700],
        [-700, 0],
        [500, -500],
      ] as const) {
        const [lon, lat] = walk(x, y);
        const [gx, gy] = localOfLonLat(g, lon, lat);
        worst = Math.max(worst, Math.hypot(gx - x, gy - y));
        const [sx, sy] = equirectangularOfLonLat(site, lon, lat);
        worstShipped = Math.max(worstShipped, Math.hypot(sx - x, sy - y));
      }
      expect(worst).toBeLessThan(0.01);
      expect(worstShipped).toBeGreaterThan(shippedFloor);
      // …and `iy` still grows NORTH below the equator (a sign slip would mirror the whole disc).
      const c = cellOfLonLat(g, site.lonDeg, site.latDeg);
      const [northLon, northLat] = walk(0, 10);
      expect(cellOfLonLat(g, northLon, northLat).iy).toBeGreaterThan(c.iy);
      const [eastLon, eastLat] = walk(10, 0);
      expect(cellOfLonLat(g, eastLon, eastLat).ix).toBeGreaterThan(c.ix);
    }
  });

  it("PIN: a disc straddling the ANTIMERIDIAN classifies, instead of reading 40,000 km east", () => {
    const centre = { latDeg: 66, lonDeg: 179.999 };
    const walk = enuWalker(centre);
    const spec = {
      centreLatDeg: centre.latDeg,
      centreLonDeg: centre.lonDeg,
      halfSpanM: 250,
      cellM: 1,
    };
    // A water polygon that spans the seam, written in local metres and projected back out.
    const water: [number, number][] = [walk(-200, -80), walk(200, -80), walk(200, 80), walk(-200, 80)];
    const g = buildLandGrid(spec, [{ ...EMPTY, polys: [{ kind: "water", cls: "lake", polys: [[water]] }] }]);

    // 222 m east of lon 179.999 at this latitude is lon −179.999: the other side of the seam.
    const [eastLon, eastLat] = walk(222, 0);
    expect(eastLon).toBeLessThan(-179.9);
    const [ex, ey] = localOfLonLat(g, eastLon, eastLat);
    expect(ex).toBeCloseTo(222, 3);
    expect(ey).toBeCloseTo(0, 3);
    // NEGATIVE CONTROL — differencing raw longitudes, which is what the shipped projection did.
    expect(equirectangularOfLonLat(centre, eastLon, eastLat)[0]).toBeLessThan(-16_000_000);

    // …and the mask is continuous across the seam: cells on BOTH sides of ±180 read `water`.
    const west = cellOfLonLat(g, ...walk(-150, 0));
    const east = cellOfLonLat(g, ...walk(150, 0));
    expect(classAt(g, west.ix, west.iy)).toBe("water");
    expect(classAt(g, east.ix, east.iy)).toBe("water");
    expect(accessAt(g, east.ix, east.iy, 1.7, false).hard).toBe(0);
    expect(classFraction(g, "water")).toBeGreaterThan(0.2);
    // The seam is not a wall: the water run across the centre row is UNBROKEN.
    const row = cellOfLonLat(g, centre.lonDeg, centre.latDeg).iy;
    let runs = 0;
    let inRun = false;
    for (let ix = 0; ix < g.nx; ix++) {
      const isWater = classAt(g, ix, row) === "water";
      if (isWater && !inRun) runs++;
      inRun = isWater;
    }
    expect(runs).toBe(1);
  });

  it("round-trips cell ↔ lon/lat, and `ix` grows EAST / `iy` grows NORTH", () => {
    const walk = enuWalker(HERO);
    for (const [ix, iy] of [
      [0, 0],
      [1, 250],
      [1400, 1400],
      [700, 700],
    ]) {
      const ll = lonLatOfCell(grid, ix, iy);
      expect(cellOfLonLat(grid, ll.lonDeg, ll.latDeg)).toEqual({ ix, iy });
    }
    const c = cellOfLonLat(grid, HERO.lonDeg, HERO.latDeg);
    expect(cellOfLonLat(grid, ...walk(10, 0)).ix).toBeGreaterThan(c.ix);
    expect(cellOfLonLat(grid, ...walk(0, 10)).iy).toBeGreaterThan(c.iy);

    // NEAREST cell centre, not `floor` — the twin of `localDsm.cellAtEnu`'s own "1.4 m is inside the
    // centre cell" pin. Asked in BOTH signs, because `floor` agrees with `round` on the positive side
    // and answers a cell to the south-west on the negative one, which is how a half-cell shift hides.
    expect(cellOfLonLat(grid, ...walk(0.4, -0.4))).toEqual(c);
    expect(cellOfLonLat(grid, ...walk(-0.4, 0.4))).toEqual(c);
    expect(cellOfLonLat(grid, ...walk(0.6, -0.6))).toEqual({ ix: c.ix + 1, iy: c.iy - 1 });
  });
});

describe("the grid parity — the centre pin lands on a cell CENTRE", () => {
  /** §8's honest resolution ladder: 3 m default (R3), 1 m under ULTRA and at the top-K re-solve,
   *  6 m on the mid tier; radii 100/200/300/400/500 with the plan's §5 400 m collar. */
  const CELL_M = [1, 3, 6];
  const RADII = [100, 200, 300, 400, 500];

  it("PIN: every canonical (radius, cellM) in the ladder yields an ODD n with the pin on a centre", () => {
    let shippedEven = 0;
    let combos = 0;
    for (const cellM of CELL_M) {
      for (const radiusM of RADII) {
        for (const halfSpanM of [radiusM, radiusM + 400]) {
          const grid = makeLandGrid({
            centreLatDeg: HERO.latDeg,
            centreLonDeg: HERO.lonDeg,
            halfSpanM,
            cellM,
          });
          const label = `${halfSpanM} m @ ${cellM} m`;
          combos++;

          // NEGATIVE CONTROL — the shipped count `ceil(2·halfSpan/cellM)` and the shipped cell-centre
          // lattice `(ix + 0.5 − n/2)·cellM`, reproduced on the same spec. Where that count came out
          // EVEN the disc centre resolved to a cell whose centre is (+cellM/2, +cellM/2) — a CORNER
          // read — and the parity was never chosen, only inherited from the ceiling.
          const shippedN = Math.ceil((2 * halfSpanM) / cellM);
          const shippedCentreIx = Math.floor(0 + shippedN / 2);
          const shippedCentreOffsetM = (shippedCentreIx + 0.5 - shippedN / 2) * cellM;
          if (shippedN % 2 === 0) {
            shippedEven++;
            expect(shippedCentreOffsetM, `shipped ${label}`).toBe(cellM / 2);
          } else {
            expect(shippedCentreOffsetM, `shipped ${label}`).toBe(0);
          }

          expect(grid.nx % 2, label).toBe(1);
          expect(grid.nx, label).toBe(grid.ny);
          expect(grid.nx, label).toBe(oddSpanCells(halfSpanM, cellM));
          expect(grid.nx * cellM, label).toBeGreaterThanOrEqual(2 * halfSpanM);

          // The pin: the centre lon/lat resolves to the middle cell, and that cell's CENTRE is the
          // frame origin exactly — 0, not cellM/2.
          const mid = (grid.nx - 1) / 2;
          expect(cellOfLonLat(grid, HERO.lonDeg, HERO.latDeg), label).toEqual({ ix: mid, iy: mid });
          expect(xOfIx(grid, mid), label).toBe(0);
          expect(yOfIy(grid, mid), label).toBe(0);
          const back = lonLatOfCell(grid, mid, mid);
          expect(back.lonDeg, label).toBeCloseTo(HERO.lonDeg, 9);
          expect(back.latDeg, label).toBeCloseTo(HERO.latDeg, 9);
        }
      }
    }
    // The measured reach of the negative control: 23 of the 30 canonical specs used to put the pin on
    // a corner — including EVERY 1 m (ULTRA) spec, where `2·halfSpan` is even by construction, and
    // the plan's own worked example below. The other 7 were right by accident of the ceiling, which
    // is precisely why nobody noticed.
    expect(combos).toBe(30);
    expect(shippedEven).toBe(23);
    expect(Math.ceil((2 * 700) / 1)).toBe(1_400); // §8's 700 m @ 1 m — the number the audit quoted
    expect(oddSpanCells(700, 1)).toBe(1_401);
  });

  it("PIN: the mask lattice IS the obstruction lattice for every rung of the ladder", () => {
    // `makeLandGrid` and `discGridSpec` are two constructors that must never disagree about where a
    // cell is; `oddSpanCells` is the single rule they share.
    for (const cellM of CELL_M) {
      for (const radiusM of RADII) {
        const grid = makeLandGrid({
          centreLatDeg: HERO.latDeg,
          centreLonDeg: HERO.lonDeg,
          halfSpanM: radiusM,
          cellM,
        });
        const dsm = createLocalDsm(discGridSpec(radiusM, cellM));
        const label = `${radiusM} m @ ${cellM} m`;
        expect(grid.nx, label).toBe(dsm.nx);
        for (const ix of [0, 1, (grid.nx - 1) / 2, grid.nx - 1]) {
          expect(xOfIx(grid, ix), label).toBe(cellEast(dsm, ix));
        }
      }
    }
  });
});
