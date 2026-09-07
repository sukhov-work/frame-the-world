import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseVectorTile, type ParsedVtile } from "../../../src/components/globe/scene/vectorTiles";
import {
  handleParseRequest,
  packVtile,
  unpackVtile,
  type VtileParseMessage,
} from "../../../src/lib/geo/vtileWire";

/**
 * THE WIRE'S CONTRACT IS IDENTITY (T77 lever 11, 2026-09-07j).
 *
 * The parse worker hands the main thread a flat typed-array wire; `unpackVtile` must give every
 * consumer EXACTLY what `parseVectorTile` on the main thread gave them before — values, key order,
 * `undefined`-valued optional keys — or the street names, the feature web, the mini-map, the land
 * grid and BEST SPOT's `vectorVersion` epoch all drift silently. The fixture is the committed REAL
 * Dnipro tile the other parser tests use; the synthetic cases pin the shapes the fixture may not
 * carry (holes, multi-polygons, an empty tile, a feature with no rings).
 */

const FIXTURE = join(__dirname, "fixtures", "ofm-z14-9787-5662-dnipro-central-bridge.pbf");
const TX = 9787;
const TY = 5662;

const fixtureBuffer = (): ArrayBuffer => {
  const b = readFileSync(FIXTURE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const keyOrder = (o: object): string[] => Object.keys(o);

describe("vtileWire — pack/unpack identity on the real Dnipro fixture", () => {
  const parsed = parseVectorTile(fixtureBuffer(), TX, TY);

  it("the fixture is a positive control: every GEOMETRY class is present", () => {
    // The fixture carries no `transportation_name` layer (0 labels) — the synthetic case below
    // pins the label path; the geometry classes are what the wire actually encodes.
    expect(parsed.lines.length).toBeGreaterThan(0);
    expect(parsed.polys.length).toBeGreaterThan(0);
    expect(parsed.areas.length).toBeGreaterThan(0);
    // A multi-ring polygon (a hole) somewhere in the tile — the wire's nested counts are exercised.
    const withHole = [...parsed.polys, ...parsed.areas].some((f) =>
      f.polys.some((poly) => poly.length > 1),
    );
    expect(withHole).toBe(true);
  });

  it("unpack(pack(p)) is strictly equal to p — values, undefined keys, and key order", () => {
    const { wire, transfer } = packVtile(parsed);
    expect(transfer).toEqual([wire.shape.buffer, wire.coords.buffer]);
    const back = unpackVtile(wire);
    expect(back).toStrictEqual(parsed);
    // Key ORDER is part of the contract (toStrictEqual does not check it).
    for (let i = 0; i < parsed.lines.length; i++) {
      expect(keyOrder(back.lines[i])).toEqual(keyOrder(parsed.lines[i]));
    }
    for (let i = 0; i < parsed.polys.length; i++) {
      expect(keyOrder(back.polys[i])).toEqual(keyOrder(parsed.polys[i]));
    }
    for (let i = 0; i < parsed.areas.length; i++) {
      expect(keyOrder(back.areas[i])).toEqual(keyOrder(parsed.areas[i]));
    }
    expect(JSON.stringify(back)).toBe(JSON.stringify(parsed));
  });

  it("survives the postMessage boundary (structuredClone) unchanged", () => {
    const { wire } = packVtile(parsed);
    const back = unpackVtile(structuredClone(wire));
    expect(back).toStrictEqual(parsed);
    expect(JSON.stringify(back)).toBe(JSON.stringify(parsed));
  });

  it("the coordinates are exact doubles, not a float32 round-trip", () => {
    const { wire } = packVtile(parsed);
    expect(wire.coords).toBeInstanceOf(Float64Array);
    let i = 0;
    for (const f of parsed.lines) {
      for (const ln of f.lines) {
        for (const [lon, lat] of ln) {
          expect(wire.coords[i]).toBe(lon);
          expect(wire.coords[i + 1]).toBe(lat);
          i += 2;
        }
      }
    }
    expect(i).toBeGreaterThan(0);
  });

  it("the shape stream and the coordinate array are sized exactly — nothing left over", () => {
    const { wire } = packVtile(parsed);
    let shapeUsed = 0;
    let coordsUsed = 0;
    for (const f of parsed.lines) {
      shapeUsed += 1 + f.lines.length;
      for (const ln of f.lines) coordsUsed += ln.length * 2;
    }
    for (const f of [...parsed.polys, ...parsed.areas]) {
      shapeUsed += 1;
      for (const poly of f.polys) {
        shapeUsed += 1 + poly.length;
        for (const r of poly) coordsUsed += r.length * 2;
      }
    }
    expect(wire.shape.length).toBe(shapeUsed);
    expect(wire.coords.length).toBe(coordsUsed);
  });

  it("the parsed object is not mutated by packing (the labels ride by reference, the rest is copied)", () => {
    const before = JSON.stringify(parsed);
    const { wire } = packVtile(parsed);
    expect(JSON.stringify(parsed)).toBe(before);
    expect(wire.labels).toBe(parsed.labels);
    expect(parsed.lines[0].lines).not.toBeNull();
  });
});

describe("vtileWire — synthetic shapes the fixture may not carry", () => {
  const synth: ParsedVtile = {
    tx: 1,
    ty: 2,
    labels: [
      { name: "A", rank: 0, lineLen: 1, lonDeg: 1, latDeg: 2, bLonDeg: 3, bLatDeg: 4 },
    ],
    lines: [
      // A multi-line with an EMPTY line list (a feature the clipper emptied) and an optional
      // `undefined` key — both must survive.
      {
        kind: "road",
        cls: "minor",
        bridge: false,
        tunnel: false,
        brunnel: undefined,
        subclass: undefined,
        lines: [],
      },
      {
        kind: "waterway",
        cls: "river",
        bridge: false,
        tunnel: false,
        intermittent: true,
        lines: [
          [
            [35.1, 48.4],
            [35.2, 48.5],
          ],
          [[35.3, 48.6]],
        ],
      },
    ],
    polys: [
      // Two polygons, the first with a hole, the second a single ring.
      {
        kind: "water",
        cls: "lake",
        polys: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            [
              [0.2, 0.2],
              [0.4, 0.2],
              [0.3, 0.4],
            ],
          ],
          [
            [
              [5, 5],
              [6, 5],
              [6, 6],
            ],
          ],
        ],
      },
      { kind: "building", polys: [], renderHeightM: 12.5, renderMinHeightM: undefined },
    ],
    areas: [{ kind: "deck", cls: "bridge", subclass: "", layer: 1, polys: [[[[9, 9], [10, 9], [10, 10]]]] }],
  };

  it("round-trips holes, multi-polygons, empty geometry and undefined keys", () => {
    const back = unpackVtile(structuredClone(packVtile(synth).wire));
    expect(back).toStrictEqual(synth);
    expect(JSON.stringify(back)).toBe(JSON.stringify(synth));
    expect(keyOrder(back.lines[0])).toEqual(keyOrder(synth.lines[0]));
    expect(keyOrder(back.polys[1])).toEqual(keyOrder(synth.polys[1]));
    expect("renderMinHeightM" in back.polys[1]).toBe(true);
  });

  it("an empty tile packs to two empty arrays and unpacks to an empty tile", () => {
    const empty: ParsedVtile = { tx: 3, ty: 4, labels: [], lines: [], polys: [], areas: [] };
    const { wire } = packVtile(empty);
    expect(wire.shape.length).toBe(0);
    expect(wire.coords.length).toBe(0);
    expect(unpackVtile(wire)).toStrictEqual(empty);
  });
});

describe("handleParseRequest — the ONE handler both threads run", () => {
  it("parses, packs and posts with the two buffers in the transfer list", () => {
    const posted: { m: VtileParseMessage; transfer: ArrayBuffer[] }[] = [];
    handleParseRequest(
      { type: "parse", key: `${TX}/${TY}`, buf: fixtureBuffer(), tx: TX, ty: TY },
      parseVectorTile,
      (m, transfer) => posted.push({ m, transfer }),
    );
    expect(posted).toHaveLength(1);
    const { m, transfer } = posted[0];
    expect(m.type).toBe("parsed");
    if (m.type !== "parsed") return;
    expect(m.key).toBe(`${TX}/${TY}`);
    expect(m.workerMs).toBeGreaterThanOrEqual(0);
    expect(transfer).toEqual([m.wire.shape.buffer, m.wire.coords.buffer]);
    expect(unpackVtile(m.wire)).toStrictEqual(parseVectorTile(fixtureBuffer(), TX, TY));
  });

  it("a parser throw becomes a `failed` message for that key — never an exception", () => {
    const posted: VtileParseMessage[] = [];
    handleParseRequest(
      { type: "parse", key: "k", buf: new ArrayBuffer(4), tx: 0, ty: 0 },
      () => {
        throw new Error("corrupt tile");
      },
      (m) => posted.push(m),
    );
    expect(posted).toEqual([{ type: "failed", key: "k", message: "corrupt tile" }]);
  });
});
