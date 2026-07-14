import { describe, it, expect } from "vitest";
import { subBoxes, c6FilterXml } from "../../scripts/bake/lib/osmXml.mjs";
import { readGlb, readAccessor, readIndices } from "../../scripts/bake/lib/readGlb.mjs";
import { encodeGlb } from "../../scripts/bake/lib/gltf.mjs";
import { makeExcluder } from "../../scripts/bake/lib/exclusion.mjs";

// The OSM2World variant bake (bake-osm2world.mjs) — its pure pieces are unit-gated like the rest of
// scripts/bake: a wrong C6 strip is a policy bug (wartime geo-sensitivity), a broken readGlb ships
// an empty city. The adapter's frame math (axis, re-base) was browser-verified in the Slice-1.5
// spike and is guarded at bake time by the empirical handedness vote.

describe("subBoxes", () => {
  it("tiles the bbox exactly with no gaps/overlap", () => {
    const boxes = subBoxes([35.0, 48.42, 35.1, 48.5], 2);
    expect(boxes).toHaveLength(4);
    const b00 = boxes.find((b) => b.key === "0-0")!;
    expect(b00.bbox).toEqual([35.0, 48.42, 35.05, 48.46]);
    const b11 = boxes.find((b) => b.key === "1-1")!;
    expect(b11.bbox[2]).toBeCloseTo(35.1, 12);
    expect(b11.bbox[3]).toBeCloseTo(48.5, 12);
    // union covers the box: every sub-edge meets its neighbour exactly
    const b10 = boxes.find((b) => b.key === "1-0")!;
    expect(b10.bbox[0]).toBeCloseTo(b00.bbox[2], 12);
  });
});

describe("c6FilterXml — reference-safe C6", () => {
  const excluder = makeExcluder({}); // DEFAULT_EXCLUDE_TAGS
  const xml = [
    `<?xml version="1.0"?>`,
    `<osm version="0.6">`,
    ` <node id="1" lat="48.4" lon="35.0" version="1"/>`,
    ` <node id="2" lat="48.4" lon="35.0" version="1">`,
    `  <tag k="power" v="substation"/>`,
    ` </node>`,
    ` <node id="3" lat="48.4" lon="35.0" version="1">`,
    `  <tag k="amenity" v="fountain"/>`,
    ` </node>`,
    ` <way id="10" version="1">`,
    `  <nd ref="1"/>`,
    `  <nd ref="2"/>`,
    `  <tag k="building" v="yes"/>`,
    ` </way>`,
    ` <way id="11" version="1">`,
    `  <nd ref="1"/>`,
    `  <tag k="building" v="bunker"/>`,
    ` </way>`,
    ` <relation id="20" version="1">`,
    `  <member type="way" ref="10" role="outer"/>`,
    `  <tag k="landuse" v="military"/>`,
    ` </relation>`,
    `</osm>`,
  ].join("\n");

  const res = c6FilterXml(xml, excluder);

  it("drops excluded ways/relations whole", () => {
    expect(res.xml).not.toContain('id="11"');
    expect(res.xml).not.toContain('id="20"');
    expect(res.dropped["tag:building=bunker"]).toBe(1);
    expect(res.dropped["tag:landuse=military"]).toBe(1);
  });

  it("keeps the kept way and its geometry intact", () => {
    expect(res.xml).toContain('<way id="10"');
    expect(res.xml).toContain('<nd ref="2"/>');
  });

  it("REFERENCE-SAFE: an excluded tagged node keeps its geometry but loses its tags", () => {
    // node 2 is a substation POI *and* a vertex of kept way 10 — it must survive, tag-less.
    expect(res.xml).toMatch(/<node id="2"[^>]*\/>/);
    expect(res.xml).not.toContain('k="power"');
    expect(res.strippedNodes).toBe(1);
  });

  it("keeps benign tagged nodes and tag-less nodes", () => {
    expect(res.xml).toContain('k="amenity"');
    expect(res.xml).toMatch(/<node id="1"[^>]*\/>/);
    expect(res.kept.node).toBe(3);
    expect(res.kept.way).toBe(1);
    expect(res.kept.relation).toBe(0);
  });
});

describe("readGlb — inverse of encodeGlb (round-trip)", () => {
  it("recovers positions/normals/feature ids from an encodeGlb buffer", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 2, -3, 6, 2, -3, 5, 3, -3];
    const normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const featureIds = [0, 0, 0, 1, 1, 1];
    const glb = encodeGlb({ positions, normals, featureIds });
    const { json, bin } = readGlb(glb);
    const prim = json.meshes[0].primitives[0];
    const pos = readAccessor(json, bin, prim.attributes.POSITION);
    expect(pos.array).toEqual(positions);
    expect(pos.min).toEqual([0, 0, -3]);
    const fid = readAccessor(json, bin, prim.attributes._FEATURE_ID_0);
    expect(fid.array).toEqual(featureIds);
    // non-indexed → identity indices
    expect(readIndices(json, bin, prim, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
