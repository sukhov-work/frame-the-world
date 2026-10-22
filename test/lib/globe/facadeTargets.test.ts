import { afterEach, describe, expect, it } from "vitest";
import { frustumGeometry, type FrustumGeometry } from "../../../src/lib/geo/frustum";
import { add, dot, length, scale, type Vec3 } from "../../../src/lib/geo/projection";
import {
  FACADE_TARGET_GRID,
  enrichedTargetId,
  osmTargetId,
  probeFacadeTargets,
  rayGridDirections,
  registerFacadeTargetProbe,
  sampleFacadeTargets,
  type FacadeTargetCast,
} from "../../../src/lib/globe/facadeTargets";
import { FACADE_TARGET_ID_MAX_LEN, FACADE_TARGET_IDS_MAX, FACADE_TARGET_IDS_MAX_BYTES } from "../../../src/lib/wix/facadeRecords";

// F5 alignment hooks (T172, 2026-10-22): the probe grid through the far face (inset cell centres,
// clear of the edge feather), the sampling law under the server's three rails, the id contract,
// and the pull seam a SAVE reads.

const geom: FrustumGeometry = frustumGeometry({
  latDeg: 48.4647,
  lonDeg: 35.0462,
  altM: 120,
  headingDeg: 214,
  pitchDeg: -8,
  rollDeg: 3,
  hFovDeg: 70,
  vFovDeg: 54,
  planeDistM: 40,
});

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Where a ray from the apex meets the far-face plane, as the face's (u, v) — u along TL→TR, v along TL→BL. */
function faceUv(g: FrustumGeometry, dir: Vec3): [number, number] {
  const [tl, tr, , bl] = g.corners;
  const d = dot(sub(tl, g.apex), g.forward); // the plane sits at the plane distance along forward
  const p = add(g.apex, scale(dir, d / dot(dir, g.forward)));
  const eu = sub(tr, tl);
  const ev = sub(bl, tl);
  return [dot(sub(p, tl), eu) / dot(eu, eu), dot(sub(p, tl), ev) / dot(ev, ev)];
}

describe("rayGridDirections — the probe rays", () => {
  it("nx·ny unit directions (7×5 by default), all looking forward", () => {
    const dirs = rayGridDirections(geom);
    expect(dirs).toHaveLength(FACADE_TARGET_GRID.nx * FACADE_TARGET_GRID.ny);
    expect(dirs).toHaveLength(35);
    for (const d of dirs) {
      expect(length(d)).toBeCloseTo(1, 12);
      expect(dot(d, geom.forward)).toBeGreaterThan(0);
    }
    expect(rayGridDirections(geom, 3, 2)).toHaveLength(6);
  });

  it("every ray meets the far face INSIDE it; row-major from the top-left inset cell centre", () => {
    const dirs = rayGridDirections(geom, 7, 5);
    dirs.forEach((d, k) => {
      const [u, v] = faceUv(geom, d);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
      expect(u).toBeCloseTo(((k % 7) + 0.5) / 7, 9);
      expect(v).toBeCloseTo((Math.floor(k / 7) + 0.5) / 5, 9);
    });
  });

  it("the four extreme rays sit at the inset cell centres, not at the corners (clear of the 0.03-uv feather)", () => {
    const dirs = rayGridDirections(geom, 7, 5);
    const extremes = [dirs[0], dirs[6], dirs[34], dirs[28]]; // TL, TR, BR, BL cells
    const want: [number, number][] = [
      [0.5 / 7, 0.1],
      [6.5 / 7, 0.1],
      [6.5 / 7, 0.9],
      [0.5 / 7, 0.9],
    ];
    extremes.forEach((d, i) => {
      const [u, v] = faceUv(geom, d);
      expect(u).toBeCloseTo(want[i][0], 9);
      expect(v).toBeCloseTo(want[i][1], 9);
      expect(Math.min(u, 1 - u, v, 1 - v)).toBeGreaterThan(0.03);
      const corner = geom.corners[i];
      const cornerDir = scale(sub(corner, geom.apex), 1 / length(sub(corner, geom.apex)));
      expect(dot(d, cornerDir)).toBeLessThan(1 - 1e-6);
    });
  });
});

describe("sampleFacadeTargets — the sampling law", () => {
  it("casts every ray from the apex with farM = rangeM", () => {
    const calls: [Vec3, Vec3, number][] = [];
    sampleFacadeTargets(geom, 333, (o, d, far) => {
      calls.push([o, d, far]);
      return null;
    });
    expect(calls).toHaveLength(35);
    for (const [o, , far] of calls) {
      expect(o).toEqual(geom.apex);
      expect(far).toBe(333);
    }
    expect(sampleFacadeTargets(geom, 333, () => null)).toEqual([]);
  });

  it("de-duplicates in FIRST-SEEN order; misses, empties and a throwing cast are skipped", () => {
    const seq = ["osm:w2", null, "osm:w1", "osm:w2", "", "osm:w3", "osm:w1", "boom"];
    let k = 0;
    const cast: FacadeTargetCast = () => {
      const id = seq[k++ % seq.length];
      if (id === "boom") throw new Error("raycast blew up");
      return id;
    };
    expect(sampleFacadeTargets(geom, 500, cast, { nx: 4, ny: 2 })).toEqual(["osm:w2", "osm:w1", "osm:w3"]);
  });

  it("drops ids longer than FACADE_TARGET_ID_MAX_LEN", () => {
    const long = "x".repeat(FACADE_TARGET_ID_MAX_LEN + 1);
    const exact = "y".repeat(FACADE_TARGET_ID_MAX_LEN);
    let k = 0;
    const ids = [long, exact, "osm:w1"];
    expect(sampleFacadeTargets(geom, 500, () => ids[k++] ?? null, { nx: 3, ny: 1 })).toEqual([exact, "osm:w1"]);
  });

  it("caps the count at FACADE_TARGET_IDS_MAX", () => {
    let k = 0;
    const out = sampleFacadeTargets(geom, 500, () => `b${k++}`, { nx: 30, ny: 10 });
    expect(out).toHaveLength(FACADE_TARGET_IDS_MAX);
    expect(out[0]).toBe("b0");
    expect(out[FACADE_TARGET_IDS_MAX - 1]).toBe(`b${FACADE_TARGET_IDS_MAX - 1}`);
  });

  it("stops before the serialised set would cross FACADE_TARGET_IDS_MAX_BYTES (and the server accepts what it keeps)", () => {
    let k = 0;
    // 80-char ids: 82 bytes quoted + a comma each — ~99 fit in 8 KiB, under the count cap.
    const out = sampleFacadeTargets(geom, 500, () => String(k++).padStart(FACADE_TARGET_ID_MAX_LEN, "0"), { nx: 20, ny: 10 });
    const bytes = new TextEncoder().encode(JSON.stringify(out)).byteLength;
    expect(out.length).toBeLessThan(FACADE_TARGET_IDS_MAX);
    expect(bytes).toBeLessThanOrEqual(FACADE_TARGET_IDS_MAX_BYTES);
    expect(bytes + FACADE_TARGET_ID_MAX_LEN + 3).toBeGreaterThan(FACADE_TARGET_IDS_MAX_BYTES); // one more would not fit
    expect(out).toEqual(out.map((_, i) => String(i).padStart(FACADE_TARGET_ID_MAX_LEN, "0")));
  });

  it("the byte rail counts UTF-8 bytes, not UTF-16 units", () => {
    let k = 0;
    const out = sampleFacadeTargets(geom, 500, () => `${k++}`.padStart(40, "é"), { nx: 20, ny: 10 });
    expect(new TextEncoder().encode(JSON.stringify(out)).byteLength).toBeLessThanOrEqual(FACADE_TARGET_IDS_MAX_BYTES);
    expect(out.length).toBeLessThan(200);
  });
});

describe("the id contract", () => {
  it("osmTargetId: way / relation / node → osm:w / osm:r / osm:n", () => {
    expect(osmTargetId("way", 132547176)).toBe("osm:w132547176");
    expect(osmTargetId("relation", 1067316)).toBe("osm:r1067316");
    expect(osmTargetId("node", 42)).toBe("osm:n42");
  });

  it("osmTargetId: garbage → null", () => {
    for (const [t, id] of [
      ["way", 0],
      ["way", -5],
      ["way", 1.5],
      ["way", Number.NaN],
      ["way", "132547176"],
      ["way", null],
      ["Way", 1],
      ["area", 1],
      ["constructor", 1],
      [undefined, 1],
      [7, 1],
      ["way", 1e17], // past the 16-digit sidecar rail
    ] as [unknown, unknown][]) {
      expect(osmTargetId(t, id)).toBeNull();
    }
  });

  it("enrichedTargetId: a valid OSM id wins over the override key", () => {
    expect(enrichedTargetId("dnipro-v3", "cells/12_34.glb", 7, "w141472295")).toBe("osm:w141472295");
    expect(enrichedTargetId(null, "cells/12_34.glb", 7, "r99")).toBe("osm:r99");
  });

  it("enrichedTargetId: else the override key when the variant is known, else null", () => {
    expect(enrichedTargetId("dnipro-v3", "cells/12_34.glb", 7, null)).toBe("dnipro-v3|cells/12_34.glb|7");
    expect(enrichedTargetId("dnipro-v3", "cells/12_34.glb", 7, "x123")).toBe("dnipro-v3|cells/12_34.glb|7"); // a malformed osm falls through
    expect(enrichedTargetId(null, "cells/12_34.glb", 7, null)).toBeNull();
    expect(enrichedTargetId("", "cells/12_34.glb", 7, null)).toBeNull();
    expect(enrichedTargetId("v", "cells/a.glb", Number.NaN, null)).toBeNull();
  });
});

describe("the pull seam", () => {
  const unregs: (() => void)[] = [];
  afterEach(() => {
    while (unregs.length) unregs.pop()!();
  });

  it("null with nothing registered", () => {
    expect(probeFacadeTargets()).toBeNull();
  });

  it("last registration wins; an unregister clears only if it is still current", () => {
    const a = registerFacadeTargetProbe(() => ["osm:w1"]);
    const b = registerFacadeTargetProbe(() => ["osm:w2"]);
    unregs.push(a, b);
    expect(probeFacadeTargets()).toEqual(["osm:w2"]);
    a(); // stale — must not remove b
    expect(probeFacadeTargets()).toEqual(["osm:w2"]);
    b();
    expect(probeFacadeTargets()).toBeNull();
  });

  it("a throwing probe (or a non-array answer) reads as null — never throws into a save", () => {
    unregs.push(
      registerFacadeTargetProbe(() => {
        throw new Error("no scene");
      }),
    );
    expect(probeFacadeTargets()).toBeNull();
    unregs.push(registerFacadeTargetProbe(() => null));
    expect(probeFacadeTargets()).toBeNull();
    unregs.push(registerFacadeTargetProbe(() => "osm:w1" as unknown as string[]));
    expect(probeFacadeTargets()).toBeNull();
  });
});
