import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  CONFORM_N,
  SCORE_TEX_N,
  STAND_INACCESSIBLE,
  STAND_SCORED_AIR,
  STAND_SCORED_GROUND,
  STAND_THRESHOLDS,
  STAND_UNKNOWN,
  attachBestSpotSheet,
  chipCapM,
  chipLines,
  displayT,
  formatAltM,
  heatLutRgba,
  inkAlpha,
  makeHeatLutTexture,
  makeMarkerMaterial,
  makePlumbMaterial,
  makeScoreTexture,
  makeSheetMaterial,
  parseCellKey,
  presenceBand,
  projectedLen,
  standByte,
  standClassOf,
  veilAlpha,
  type BestSpotFieldPack,
  type BestSpotSheetMarker,
} from "../../../src/components/globe/scene/bestSpotSheet";
import { BESTSPOT } from "../../../src/components/globe/tuning";
import { AERIAL_MIN_M } from "../../../src/lib/geo/bestSpotTypes";
import { geodeticToEcef } from "../../../src/lib/geo/projection";
import {
  HEAT_INFERNO,
  HEAT_LUT_SIZE,
  HEAT_SPOTS,
  heatRampById,
  okLightness,
} from "../../../src/lib/theme/heatPalette";

/**
 * BEST SPOT S4 — the GL sheet (SPEC_V2 §6). vitest has no WebGL, so what is pinned here is the
 * PURE half (the alpha model, the ordinal decode, the nadir proof) plus the material/texture
 * CONFIGURATION and a headless scene-graph construction — which is where the done-check's traps
 * live: every one of these can fail, and several of them fail INVISIBLY in a browser
 * (`NearestFilter` on the score texture, an sRGB tag on a data texture, a reused depth-free
 * overlay material, a renderOrder that puts a depth-tested sheet in the depth-free band).
 */

const SRC = readFileSync(
  join(__dirname, "..", "..", "..", "src", "components", "globe", "scene", "bestSpotSheet.ts"),
  "utf8",
);

// --------------------------------------------------------------------------------------------
// fixtures
// --------------------------------------------------------------------------------------------

/** A solved field with a smooth score ramp west→east and every standability class present. */
function makePack(over: Partial<BestSpotFieldPack> = {}): BestSpotFieldPack {
  const n = over.n ?? 201;
  const cellM = over.cellM ?? 3;
  const rg8 = new Uint8Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 2;
      rg8[o] = Math.round((i / (n - 1)) * 255);
      rg8[o + 1] = standByte(j % 4);
    }
  }
  const conformM = new Float32Array(CONFORM_N * CONFORM_N);
  for (let k = 0; k < conformM.length; k++) conformM[k] = 120 + (k % 17);
  return {
    n,
    cellM,
    centreLatDeg: 48.4647,
    centreLonDeg: 35.462,
    centreGroundM: 120,
    radiusM: 300,
    sheetAltM: BESTSPOT.eyeM,
    rg8,
    conformN: CONFORM_N,
    conformM,
    coverage: 0.71,
    unmappedFrac: 0.36,
    minReachM: 700,
    scoringHash: "3f9a2c17",
    ...over,
  };
}

function makeCamera(altM: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1.54, 1, 1e7);
  // Straight above the Dnipro anchor, ECEF-ish: the module only needs a world position and a
  // matrixWorld for the billboard basis.
  camera.position.set(3_469_000, 2_435_000, 4_766_000 + altM);
  camera.updateMatrixWorld(true);
  return camera;
}

const CTX_BASE = {
  altM: 900,
  viewportHPx: 982,
  viewportWPx: 1512,
  dtMs: 16,
  enabled: true,
  fpvActive: false,
  mobileShell: false,
  markers: [] as readonly BestSpotSheetMarker[],
  hoverKey: null as string | null,
  selectedKey: null as string | null,
  contactAzDeg: 62,
};

// --------------------------------------------------------------------------------------------
// §6.2 — the VEIL / INK split
// --------------------------------------------------------------------------------------------

describe("the alpha model — two independent knobs, not one curve", () => {
  it("reproduces §6.2's measured table at s = 0.15 / 0.45 / 0.65 / 0.85 / 0.95", () => {
    const rows: ReadonlyArray<readonly [number, number, number]> = [
      [0.15, 0.02, 0.3],
      [0.45, 0.109, 0.228],
      [0.65, 0.201, 0.18],
      [0.85, 0.311, 0.132],
      [0.95, 0.34, 0.12],
    ];
    for (const [s, ink, veil] of rows) {
      expect(inkAlpha(s)).toBeCloseTo(ink, 3);
      expect(veilAlpha(s)).toBeCloseTo(veil, 3);
    }
  });

  it("MAP VISIBILITY: max sampled aVeil <= 0.30 and min (1 - aVeil) >= 0.70 across the range", () => {
    let maxVeil = -Infinity;
    let minVisible = Infinity;
    for (let s = -0.5; s <= 1.5; s += 0.001) {
      maxVeil = Math.max(maxVeil, veilAlpha(s));
      minVisible = Math.min(minVisible, 1 - veilAlpha(s));
    }
    expect(maxVeil).toBeLessThanOrEqual(0.3);
    expect(minVisible).toBeGreaterThanOrEqual(0.7);
    // …and the best cell keeps strictly MORE of the map than the worst one does.
    expect(veilAlpha(0.95)).toBeLessThan(veilAlpha(0.15));
  });

  it("ink RISES and veil FALLS monotonically — the two knobs move in opposite directions", () => {
    for (let s = BESTSPOT.displayLo; s < BESTSPOT.displayHi; s += 0.01) {
      expect(inkAlpha(s + 0.01)).toBeGreaterThan(inkAlpha(s));
      expect(veilAlpha(s + 0.01)).toBeLessThan(veilAlpha(s));
    }
    expect(inkAlpha(BESTSPOT.displayLo)).toBeCloseTo(BESTSPOT.inkMin, 12);
    expect(inkAlpha(BESTSPOT.displayHi)).toBeCloseTo(BESTSPOT.inkMax, 12);
  });

  it("ink NEVER reaches 0: a scored-but-bad cell must still read as SCORED, which is the whole UNKNOWN-vs-low-score distinction", () => {
    expect(inkAlpha(-99)).toBeGreaterThan(0);
    expect(BESTSPOT.inkMin).toBeGreaterThan(0);
  });

  it("displayT clamps outside the display window (a scoring revision cannot push t out of [0,1])", () => {
    expect(displayT(-5)).toBe(0);
    expect(displayT(5)).toBe(1);
    expect(displayT((BESTSPOT.displayLo + BESTSPOT.displayHi) / 2)).toBeCloseTo(0.5, 12);
  });

  it("BLOOM headroom: inkMax stays under the ~0.40 smear line the tuning block names", () => {
    expect(BESTSPOT.inkMax).toBeLessThan(0.4);
    expect(BESTSPOT.bloomHeadroomNote).toMatch(/inkMax/);
  });
});

// --------------------------------------------------------------------------------------------
// §6.1 — the ramp
// --------------------------------------------------------------------------------------------

describe("the INFERNO ramp — read through LIGHTNESS, so it is testable rather than a taste", () => {
  it("okL(stop[i+1]) > okL(stop[i]) for all 10 adjacent pairs", () => {
    for (let i = 0; i < HEAT_INFERNO.length - 1; i++) {
      expect(okLightness(HEAT_INFERNO[i + 1].gl)).toBeGreaterThan(okLightness(HEAT_INFERNO[i].gl));
    }
    expect(HEAT_INFERNO).toHaveLength(11);
  });

  it("the LUT the sheet uploads is RGBA (three 0.185 has no byte RGB upload path) and opaque", () => {
    const lut = heatLutRgba(heatRampById(BESTSPOT.rampId));
    expect(lut).toHaveLength(HEAT_LUT_SIZE * 4);
    for (let i = 0; i < HEAT_LUT_SIZE; i++) expect(lut[i * 4 + 3]).toBe(255);
    // End caps land EXACTLY on the first and last stop, where a reader checks them.
    const first = HEAT_INFERNO[0].gl;
    expect(lut[0]).toBe(parseInt(first.slice(1, 3), 16));
    expect(lut[1]).toBe(parseInt(first.slice(3, 5), 16));
    expect(lut[2]).toBe(parseInt(first.slice(5, 7), 16));
  });

  it("tuning names the ramp by ID, never by colour", () => {
    expect(BESTSPOT.rampId).toBe("inferno");
    expect(BESTSPOT.rampAltId).toBe("turbo");
  });
});

// --------------------------------------------------------------------------------------------
// §6.4 — the ordinal standability axis
// --------------------------------------------------------------------------------------------

describe("the ORDINAL .g axis — why LinearFilter is safe", () => {
  it("round-trips all four levels through the byte the producer writes", () => {
    const levels = [STAND_UNKNOWN, STAND_INACCESSIBLE, STAND_SCORED_AIR, STAND_SCORED_GROUND];
    expect(levels).toEqual([0, 1, 2, 3]);
    expect(levels.map(standByte)).toEqual([0, 85, 170, 255]);
    for (const level of levels) expect(standClassOf(standByte(level) / 255)).toBe(level);
  });

  it("interpolation between ADJACENT levels never lands on a non-adjacent class", () => {
    for (let level = 0; level < 3; level++) {
      const lo = standByte(level) / 255;
      const hi = standByte(level + 1) / 255;
      for (let f = 0; f <= 1; f += 1 / 512) {
        const cls = standClassOf(lo + (hi - lo) * f);
        expect(cls === level || cls === level + 1).toBe(true);
      }
    }
  });

  it("the thresholds are the MIDPOINTS of the four-level axis (1/6, 1/2, 5/6) — structural, not tuned", () => {
    expect(STAND_THRESHOLDS).toHaveLength(3);
    expect(STAND_THRESHOLDS[0]).toBeCloseTo(1 / 6, 12);
    expect(STAND_THRESHOLDS[1]).toBeCloseTo(1 / 2, 12);
    expect(STAND_THRESHOLDS[2]).toBeCloseTo(5 / 6, 12);
  });
});

// --------------------------------------------------------------------------------------------
// §6.7 — the nadir proof
// --------------------------------------------------------------------------------------------

describe("the NADIR PROOF — the reading cannot vanish at any tilt or relative azimuth", () => {
  it("max(vertical, spoke) >= 0.70 x sheetAltM over the whole 0…88 x 0…360 sweep", () => {
    const alt = 12;
    let worst = Infinity;
    let worstAt: [number, number] = [0, 0];
    for (let tilt = 0; tilt <= 88; tilt += 1) {
      for (let dAz = 0; dAz <= 360; dAz += 1) {
        const len = projectedLen(alt, tilt, dAz);
        if (len < worst) {
          worst = len;
          worstAt = [tilt, dAz];
        }
        expect(len).toBeGreaterThanOrEqual(0.7 * alt);
      }
    }
    // The worst case is the 45 deg / aligned-spoke corner, exactly 1/sqrt(2).
    expect(worst / alt).toBeCloseTo(Math.SQRT1_2, 6);
    expect(worstAt[0]).toBe(45);
  });

  it("at the app's near-nadir default the VERTICAL is invisible and the SPOKE carries it", () => {
    const alt = 3;
    const vertical = alt * Math.sin((5 * Math.PI) / 180);
    expect(vertical / 0.6312).toBeLessThan(1); // < 1 px at the natural 300 m-disc altitude
    expect(projectedLen(alt, 5, 0)).toBeCloseTo(alt * Math.cos((5 * Math.PI) / 180), 9);
    expect(projectedLen(alt, 5, 0)).toBeGreaterThan(vertical * 10);
  });

  it("a spoke perpendicular to the tilt axis projects at FULL length whatever the tilt", () => {
    for (const tilt of [0, 20, 45, 70, 88]) expect(projectedLen(1, tilt, 90)).toBeCloseTo(1, 9);
  });
});

// --------------------------------------------------------------------------------------------
// The material + texture configuration (the done-check reads these on the LIVE objects)
// --------------------------------------------------------------------------------------------

describe("the sheet material — the shape of the thing, not its constants", () => {
  const tex = makeScoreTexture();
  const lut = makeHeatLutTexture(heatRampById(BESTSPOT.rampId));
  const mat = makeSheetMaterial(tex, lut);

  it("is DEPTH-TESTED (fails the moment makeFlatOverlayMaterial is reused) and never writes depth", () => {
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });

  it("is PREMULTIPLIED with NormalBlending — the veil/ink split depends on the blend func", () => {
    expect(mat.premultipliedAlpha).toBe(true);
    expect(mat.blending).toBe(THREE.NormalBlending);
    expect(mat.transparent).toBe(true);
  });

  it("does NOT include <premultiplied_alpha_fragment> — the fragment is written as authored", () => {
    expect(mat.fragmentShader).not.toContain("premultiplied_alpha_fragment");
    expect(mat.fragmentShader).toContain("gl_FragColor = vec4(rgb, a);");
  });

  it("never declares the derivatives extension (WebGL2-only renderer, fwidth is core in ESSL3)", () => {
    expect(SRC).not.toContain("derivatives: true");
    expect(SRC).not.toMatch(/\bextensions\s*:/);
    expect(mat.fragmentShader).toContain("fwidth(");
    expect(mat.fragmentShader).toContain("dFdx(");
  });

  it("carries the tuning polygon offset, above the vector ribbons it shares the ground with", () => {
    expect(mat.polygonOffset).toBe(true);
    expect(mat.polygonOffsetFactor).toBe(BESTSPOT.polygonOffset[0]);
    expect(mat.polygonOffsetUnits).toBe(BESTSPOT.polygonOffset[1]);
    expect(BESTSPOT.polygonOffset[0]).toBeLessThan(-3); // the ribbon value, plus one
  });

  it("bakes no bare-int GLSL floats (GLSL ES rejects `float x = 2;`)", () => {
    // Every injected tuning number goes through glf(): no ` 2)`-style int in a float slot.
    for (const shader of [mat.vertexShader, mat.fragmentShader]) {
      expect(shader).not.toMatch(/smoothstep\(\s*-?\d+\s*,/);
    }
  });
});

describe("the score texture — the two invisible regressions", () => {
  const tex = makeScoreTexture();

  it("is DATA: NoColorSpace, RG8, no mipmaps", () => {
    expect(tex.colorSpace).toBe(THREE.NoColorSpace);
    expect(tex.format).toBe(THREE.RGFormat);
    expect(tex.type).toBe(THREE.UnsignedByteType);
    expect(tex.generateMipmaps).toBe(false);
  });

  it("is LinearFilter on BOTH filters — NearestFilter makes every fwidth blocky and is otherwise invisible", () => {
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
  });

  it("is allocated ONCE at 601² — the ULTRA-cap maximum, which is at the SMALLEST radius", () => {
    expect(SCORE_TEX_N).toBe(601);
    expect(tex.image.width).toBe(601);
    expect(tex.image.height).toBe(601);
    expect((tex.image.data as Uint8Array).length).toBe(601 * 601 * 2);
    // 601² (361,201 cells) really is bigger than 3 m at the 500 m radius (335² = 112,225).
    expect(SCORE_TEX_N ** 2).toBeGreaterThan(335 ** 2);
    expect(SCORE_TEX_N).toBe((2 * BESTSPOT.ultraMaxRadiusM) / BESTSPOT.ultraCellM + 1);
  });

  it("sets unpackAlignment 1 — a 601-wide RG8 row is 1,202 bytes, not a multiple of 4", () => {
    expect(tex.unpackAlignment).toBe(1);
    expect(((601 * 2) % 4) === 0).toBe(false);
  });

  it("clamps to edge (a wrapped tap at the rim would fold the far side of the disc in)", () => {
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it("declares NO update ranges: three hard-codes componentStride 4, so a ranged RG8 upload shears rows", () => {
    expect(tex.updateRanges ?? []).toHaveLength(0);
    expect(SRC).not.toContain("addUpdateRange");
  });
});

describe("the LUT texture — the mirror-image tag", () => {
  it("is a COLOUR: SRGBColorSpace, RGBA8, 256x1", () => {
    const lut = makeHeatLutTexture(heatRampById(BESTSPOT.rampId));
    expect(lut.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(lut.format).toBe(THREE.RGBAFormat);
    expect(lut.image.width).toBe(HEAT_LUT_SIZE);
    expect(lut.image.height).toBe(1);
    // …and it is NOT the same tag as the data texture beside it.
    expect(lut.colorSpace).not.toBe(makeScoreTexture().colorSpace);
  });
});

describe("the marker + plumb materials", () => {
  it("markers are DEPTH-TESTED: a depth-free marker would shine through buildings the sheet respects", () => {
    const mat = makeMarkerMaterial(null);
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.premultipliedAlpha).toBe(true);
  });

  /**
   * SUPERSEDED (owner batch 2026-08-26, item 2). The shipped rule was "colour is IDENTITY, not
   * score: ONE ink uniform for all eight". The owner's finding is that eight identical cyan rings
   * carry no ranking at a glance; the colour is now PER INSTANCE and it is quality.
   *
   * What replaces the old assertion is the reason the repair is not simply "sample the sheet's LUT
   * in the marker shader": the marker must not wear the colour of the cell it stands on (it would
   * vanish into it), and the shortlist lives in INFERNO's near-black foot in a real disc. So the
   * marker still has NO `uLut` — the tint arrives as an attribute the CPU sampled from a DIFFERENT,
   * always-bright ramp — and the placeMarkers anatomy is untouched.
   */
  it("ITEM 2 — marker colour is QUALITY, per instance, and still not the sheet's own LUT", () => {
    const mat = makeMarkerMaterial(null);
    expect(Object.keys(mat.uniforms).sort()).toEqual([
      "uDigits",
      "uHalo",
      "uHasDigits",
      "uSelectRim",
    ]);
    // No LUT and no single ink uniform: the hue is an INSTANCED attribute now.
    expect(mat.fragmentShader).not.toContain("uLut");
    expect(mat.fragmentShader).not.toContain("uniform vec3 uInk;");
    for (const attr of ["aTint", "aVivid", "aSelect"]) {
      expect(mat.vertexShader).toContain(`attribute ${attr === "aTint" ? "vec3" : "float"} ${attr};`);
    }
    // HUE and VIVIDNESS are separate channels — that separation is what keeps §3.5 true while the
    // hue is renormalised: `markerDimK` is the floor an all-bad disc cannot climb out of.
    expect(mat.fragmentShader).toContain("vTint");
    expect(mat.fragmentShader).toContain(String(BESTSPOT.markerDimK));
    // The placeMarkers ring+core anatomy, verbatim.
    expect(mat.fragmentShader).toContain("smoothstep(0.98, 0.90, r) * smoothstep(0.68, 0.78, r)");
    expect(mat.fragmentShader).toContain("1.0 - smoothstep(0.22, 0.32, r)");
  });

  it("the plumb group is depth-tested and premultiplied like everything else on the ground", () => {
    const mat = makePlumbMaterial();
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.premultipliedAlpha).toBe(true);
  });
});

// --------------------------------------------------------------------------------------------
// The scene graph
// --------------------------------------------------------------------------------------------

describe("the scene graph — renderOrder is per OBJECT (a Group's does not propagate)", () => {
  it("the sheet is 4 and every marker/plumb child is 5, each checked individually", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const children = handle.group.children;
    expect(children.length).toBeGreaterThanOrEqual(4);
    const sheet = children.filter((c) => c.name === "bestSpotSheet");
    expect(sheet).toHaveLength(1);
    for (const c of sheet) expect(c.renderOrder).toBe(BESTSPOT.renderOrder);
    for (const c of children.filter((x) => x.name !== "bestSpotSheet")) {
      expect(c.renderOrder).toBe(BESTSPOT.markerRenderOrder);
    }
    // …and 4/5 sit BELOW the depth-free planning band (9), which is the whole point.
    expect(BESTSPOT.renderOrder).toBeLessThan(BESTSPOT.markerRenderOrder);
    expect(BESTSPOT.markerRenderOrder).toBeLessThan(9);
    handle.dispose();
  });

  it("every child is unpickable and unculled (local geometry under a planetary matrix)", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    for (const c of handle.group.children) {
      expect(c.frustumCulled).toBe(false);
      expect(c.raycast).not.toBe(THREE.Mesh.prototype.raycast);
    }
    handle.dispose();
  });

  it("the conforming grid is 64x64 quads, indexed once", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const sheet = handle.group.children.find((c) => c.name === "bestSpotSheet") as THREE.Mesh;
    expect(CONFORM_N).toBe(65);
    expect(sheet.geometry.getAttribute("position").count).toBe(CONFORM_N * CONFORM_N);
    expect(sheet.geometry.getIndex()?.count).toBe((CONFORM_N - 1) * (CONFORM_N - 1) * 6);
    handle.dispose();
  });

  it("ALLOCATE ONCE: two updates with different fields reuse the same geometry, texture and buffers", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const camera = makeCamera(900);
    const sheet = handle.group.children.find((c) => c.name === "bestSpotSheet") as THREE.Mesh;
    const mat = sheet.material as THREE.ShaderMaterial;

    handle.update({ ...CTX_BASE, camera, field: makePack({ n: 201, cellM: 3 }) });
    const geo0 = sheet.geometry;
    const posBuf0 = sheet.geometry.getAttribute("position").array;
    const idx0 = sheet.geometry.getIndex();
    const tex0 = mat.uniforms.uScore.value as THREE.DataTexture;
    const data0 = tex0.image.data;

    handle.update({ ...CTX_BASE, camera, field: makePack({ n: 601, cellM: 1, radiusM: 300 }) });
    expect(sheet.geometry).toBe(geo0);
    expect(sheet.geometry.getAttribute("position").array).toBe(posBuf0);
    expect(sheet.geometry.getIndex()).toBe(idx0);
    expect(mat.uniforms.uScore.value).toBe(tex0);
    expect((mat.uniforms.uScore.value as THREE.DataTexture).image.data).toBe(data0);
    // …and the second field actually landed.
    expect(mat.uniforms.uGridN.value).toBe(601);
    expect(mat.uniforms.uCellM.value).toBe(1);
    handle.dispose();
  });

  it("uploads the field FULL-SURFACE with row 0 = SOUTH, and clears the stale tail of a larger solve", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const camera = makeCamera(900);
    const sheet = handle.group.children.find((c) => c.name === "bestSpotSheet") as THREE.Mesh;
    const mat = sheet.material as THREE.ShaderMaterial;

    handle.update({ ...CTX_BASE, camera, field: makePack({ n: 601, cellM: 1 }) });
    const data = (mat.uniforms.uScore.value as THREE.DataTexture).image.data as Uint8Array;
    expect(data[SCORE_TEX_N * 2 - 2]).toBeGreaterThan(0); // the far EAST end of row 0 is live

    handle.update({ ...CTX_BASE, camera, field: makePack({ n: 5, cellM: 3 }) });
    // Everything past the new grid must be zeroed, or the LinearFilter tap at the last live
    // column bleeds the previous, larger solve back in.
    expect(data[SCORE_TEX_N * 2 - 2]).toBe(0);
    expect(data[0]).toBe(0); // score 0 at the west edge of the new field
    expect(data[1]).toBe(standByte(0)); // row 0 = SOUTH carries the pack's row 0
    expect(data[SCORE_TEX_N * 2 + 1]).toBe(standByte(1)); // row 1 is the pack's row 1
    handle.dispose();
  });

  it("seats the group and hides itself when the field is null or the gates are off", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const camera = makeCamera(900);
    handle.update({ ...CTX_BASE, camera, field: null });
    expect(handle.group.visible).toBe(false);

    handle.update({ ...CTX_BASE, camera, field: makePack() });
    expect(handle.group.visible).toBe(true);
    expect(handle.group.matrix.elements.some((v) => v !== 0)).toBe(true);

    // Owner R2: FPV renders nothing. The fade is exponential, so drive it past the floor.
    for (let i = 0; i < 200; i++) {
      handle.update({ ...CTX_BASE, camera, field: makePack(), fpvActive: true, dtMs: 32 });
    }
    expect(handle.group.visible).toBe(false);
    handle.dispose();
  });

  it("PRESENCE: the sheet is gone above topAltK x radius, where a cell is about one pixel", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const band = presenceBand(300);
    expect(band.fullAltM).toBe(2400);
    expect(band.topAltM).toBe(4200);
    for (let i = 0; i < 200; i++) {
      handle.update({ ...CTX_BASE, camera: makeCamera(5000), altM: 5000, field: makePack(), dtMs: 32 });
    }
    expect(handle.group.visible).toBe(false);
    handle.dispose();
  });

  it("the top-K markers seat, cap at BESTSPOT.topK, and the hover key stamps ONE uniform", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const camera = makeCamera(900);
    const markerMesh = handle.group.children.find(
      (c) => c.name === "bestSpotMarkers",
    ) as THREE.InstancedMesh;
    const list: BestSpotSheetMarker[] = Array.from({ length: BESTSPOT.topK + 4 }, (_, i) => ({
      key: `${100 + i}:${100 + i}`,
      rank: i + 1,
      latDeg: 48.4647 + i * 1e-4,
      lonDeg: 35.462 + i * 1e-4,
      score: 0.4 - i * 0.03,
      quality: 1 - i * 0.08,
    }));
    handle.update({ ...CTX_BASE, camera, field: makePack(), markers: list, hoverKey: "102:102" });
    expect(markerMesh.count).toBe(BESTSPOT.topK);

    const sheet = handle.group.children.find((c) => c.name === "bestSpotSheet") as THREE.Mesh;
    const hover = (sheet.material as THREE.ShaderMaterial).uniforms.uHoverCell.value as THREE.Vector2;
    expect(hover.x).toBe(102);
    expect(hover.y).toBe(102);

    handle.update({ ...CTX_BASE, camera, field: makePack(), markers: list, hoverKey: null });
    expect(hover.x).toBeLessThan(0); // negative = no hover, the shader's own gate
    handle.dispose();
  });

  it("ITEM 2 — the eight markers carry DIFFERENT tints, from HEAT_SPOTS and not from the sheet's LUT", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const camera = makeCamera(900);
    const mesh = handle.group.children.find(
      (c) => c.name === "bestSpotMarkers",
    ) as THREE.InstancedMesh;
    // Eight rows at the SAME absolute score band a real dense-city disc produces (best 0.38 against
    // a 0.9 display ceiling) — which is exactly the case where sampling the sheet's own INFERNO
    // would give eight near-black, indistinguishable markers.
    const list: BestSpotSheetMarker[] = Array.from({ length: BESTSPOT.topK }, (_, i) => ({
      key: `${100 + i}:100`,
      rank: i + 1,
      latDeg: 48.4647 + i * 1e-4,
      lonDeg: 35.462,
      score: 0.38 - i * 0.02,
      quality: 1 - i / (BESTSPOT.topK - 1),
    }));
    handle.update({ ...CTX_BASE, camera, field: makePack(), markers: list });
    const tint = mesh.geometry.getAttribute("aTint") as THREE.InstancedBufferAttribute;
    const vivid = mesh.geometry.getAttribute("aVivid") as THREE.InstancedBufferAttribute;
    const seen = new Set<string>();
    for (let i = 0; i < BESTSPOT.topK; i++) {
      seen.add([tint.array[i * 3], tint.array[i * 3 + 1], tint.array[i * 3 + 2]].join(","));
    }
    // The POINT of the change: the ranking is legible from the colours alone.
    expect(seen.size).toBeGreaterThanOrEqual(HEAT_SPOTS.length);
    // Rank 1 takes the ramp's TOP stop, rank 8 its bottom — and both are BRIGHT (they must read
    // against the sheet they stand on, which is the near-black end of INFERNO here).
    const top = new THREE.Color(HEAT_SPOTS[HEAT_SPOTS.length - 1].gl);
    const bot = new THREE.Color(HEAT_SPOTS[0].gl);
    expect(tint.array[0]).toBeCloseTo(top.r, 5);
    expect(tint.array[(BESTSPOT.topK - 1) * 3]).toBeCloseTo(bot.r, 5);
    // …and VIVIDNESS is the ABSOLUTE reading, so §3.5 survives the renormalised hue: every one of
    // these mediocre rows sits low on the display window.
    for (let i = 0; i < BESTSPOT.topK; i++) expect(vivid.array[i]).toBeLessThan(0.4);
    handle.dispose();
  });

  it("ITEM 1 — the SELECTED marker eases its own channel, independently of the hover", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const camera = makeCamera(900);
    const mesh = handle.group.children.find(
      (c) => c.name === "bestSpotMarkers",
    ) as THREE.InstancedMesh;
    const list: BestSpotSheetMarker[] = [0, 1].map((i) => ({
      key: `${100 + i}:100`,
      rank: i + 1,
      latDeg: 48.4647 + i * 1e-4,
      lonDeg: 35.462,
      score: 0.3,
      quality: 1 - i * 0.5,
    }));
    for (let f = 0; f < 40; f++) {
      handle.update({
        ...CTX_BASE,
        camera,
        field: makePack(),
        markers: list,
        hoverKey: "101:100",
        selectedKey: "100:100",
        dtMs: 32,
      });
    }
    const sel = mesh.geometry.getAttribute("aSelect") as THREE.InstancedBufferAttribute;
    const hov = mesh.geometry.getAttribute("aHover") as THREE.InstancedBufferAttribute;
    // Two states, two markers, no crosstalk — one shared channel would make them fight.
    expect(sel.array[0]).toBeGreaterThan(0.9);
    expect(sel.array[1]).toBeLessThan(0.1);
    expect(hov.array[0]).toBeLessThan(0.1);
    expect(hov.array[1]).toBeGreaterThan(0.9);
    handle.dispose();
  });

  /**
   * ITEM 3's hit test. `THREE.Raycaster` cannot answer this question at all — every object in the
   * group carries `raycast = () => {}`, and the marker is billboarded in the VERTEX SHADER, so a
   * plane raycast would test geometry lying flat on the tangent basis. So the pick reproduces the
   * shader's own projection, and this is what proves the reproduction is faithful.
   */
  it("ITEM 3 — pickMarker finds the marker under the pointer, and FAILS CLOSED when nothing draws", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    const pack = makePack();
    // A camera genuinely ABOVE the disc centre looking straight down it: a marker at the centre
    // then sits exactly on the view axis, i.e. NDC (0, 0), which is a fact about the projection
    // rather than about a hand-tuned number.
    const eye = geodeticToEcef(pack.centreLatDeg, pack.centreLonDeg, pack.centreGroundM + 900);
    const tgt = geodeticToEcef(pack.centreLatDeg, pack.centreLonDeg, pack.centreGroundM);
    const camera = new THREE.PerspectiveCamera(60, 1512 / 982, 1, 1e7);
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.up.set(0, 0, 1);
    camera.lookAt(tgt[0], tgt[1], tgt[2]);
    camera.updateMatrixWorld(true);

    const list: BestSpotSheetMarker[] = [
      {
        key: "100:100",
        rank: 1,
        latDeg: pack.centreLatDeg,
        lonDeg: pack.centreLonDeg,
        score: 0.38,
        quality: 1,
      },
    ];
    handle.update({ ...CTX_BASE, camera, altM: 900, field: pack, markers: list });
    const hit = handle.pickMarker(0, 0);
    expect(hit?.key).toBe("100:100");
    expect(hit?.rank).toBe(1);
    expect(Math.hypot(hit!.ndcX, hit!.ndcY)).toBeLessThan(1e-3);
    // Well away from it: a miss, not a nearest-neighbour answer.
    expect(handle.pickMarker(0.9, -0.9)).toBeNull();

    // FAIL CLOSED. Owner R2 renders nothing in FPV, so nothing may be picked there either — and
    // the fade is exponential, so drive it past the floor rather than assuming one frame does it.
    for (let i = 0; i < 200; i++) {
      handle.update({ ...CTX_BASE, camera, altM: 900, field: pack, markers: list, fpvActive: true, dtMs: 32 });
    }
    expect(handle.pickMarker(0, 0)).toBeNull();
    handle.dispose();
  });

  it("dispose() frees everything it made and leaves the scene empty", () => {
    const scene = new THREE.Scene();
    const handle = attachBestSpotSheet(scene);
    let disposals = 0;
    handle.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.addEventListener("dispose", () => disposals++);
    });
    handle.dispose();
    expect(scene.children).toHaveLength(0);
    expect(disposals).toBeGreaterThanOrEqual(3); // sheet + plumb + markers + chip geometries
  });
});

// --------------------------------------------------------------------------------------------
// §6.7 — the chip, and the file contract
// --------------------------------------------------------------------------------------------

describe("the altitude chip", () => {
  it("prints one line at pedestrian height and adds the DRONE badge at/above AERIAL_MIN_M", () => {
    expect(chipLines(BESTSPOT.eyeM)).toEqual(["1.7 m"]);
    expect(chipLines(AERIAL_MIN_M - 0.1)).toHaveLength(1);
    expect(chipLines(AERIAL_MIN_M)).toEqual(["5.0 m", "▲ DRONE"]);
    expect(chipLines(120)).toEqual(["120 m", "▲ DRONE"]);
  });

  it("formats altitude at a glance: one decimal below 10 m, whole metres above", () => {
    expect(formatAltM(1.7)).toBe("1.7 m");
    expect(formatAltM(9.96)).toBe("10.0 m");
    expect(formatAltM(12.34)).toBe("12 m");
    expect(formatAltM(400)).toBe("400 m");
  });

  it("sizes by cap height in px, NOT by the PLACEMARKS angular clamp (which gives ~8.6 px)", () => {
    // At the natural nadir altitude for a 300 m disc, worldPerPx = 0.6312 m/px.
    expect(chipCapM(0.6312)).toBeCloseTo(0.6312 * BESTSPOT.chipCapPx, 9);
    expect(chipCapM(0)).toBe(BESTSPOT.liftMinM); // degenerate wpp cannot make a zero-area quad
    expect(chipCapM(1e9)).toBe(BESTSPOT.liftMaxM); // …or a planetary one
  });

  it("parses the row ↔ marker join key and refuses anything else", () => {
    expect(parseCellKey("102:37")).toEqual({ col: 102, row: 37 });
    expect(parseCellKey(null)).toBeNull();
    expect(parseCellKey("")).toBeNull();
    expect(parseCellKey("a:b")).toBeNull();
    expect(parseCellKey("1:2:3")).toBeNull();
  });
});

describe("the file contract", () => {
  it("carries ZERO colour literals — colour flows only through lib/theme/tokens.ts", () => {
    expect(SRC.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(SRC.match(/\brgba?\s*\(/g)).toBeNull();
    expect(SRC.match(/\bhsla?\s*\(/g)).toBeNull();
    expect(SRC).toContain('from "../../../lib/theme/tokens"');
  });

  it("never reuses the depth-free overlay material factory", () => {
    expect(SRC).not.toContain("makeFlatOverlayMaterial");
  });

  it("reads its numbers from the BESTSPOT tuning block, not from literals", () => {
    expect(SRC).toContain('from "../tuning"');
    expect(SRC.match(/BESTSPOT\./g)?.length ?? 0).toBeGreaterThan(30);
  });
});
