import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createBuildingMaterials,
  PHOTO_PROJECT_SLOTS,
  type PhotoProjectorFeed,
  type PhotoProjectorSlot,
} from "../../../src/components/globe/scene/buildingMaterial";
import { projectorMatrix } from "../../../src/components/globe/scene/photoProjector";
import { ENRICHED, PHOTO_PROJECT } from "../../../src/components/globe/tuning";
import { frustumGeometry } from "../../../src/lib/geo/frustum";
import { glf } from "../../../src/components/globe/scene/glsl";

/**
 * T125 (owner 2026-09-08b, "edited building meshes are no longer highlighted"): the edit tint was
 * ONE albedo pull at <color_fragment> — a diffuse term, gone with the light — so after dark an
 * edited building read exactly like its neighbours (the city's night identity is a dark mass, R3).
 * The fill shader now carries the tint TWICE: the albedo pull by day and a per-channel FLOOR in
 * linear light after <opaque_fragment>, BEFORE the aerial haze (the same seat as the haze — after
 * the tone mapping it would be wrong in the direct-to-backbuffer pass). Both read one function.
 * The generated GLSL is what is pinned, through the real onBeforeCompile on a stub shader.
 */
const compile = (mat: THREE.Material) => {
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>\n",
    fragmentShader:
      "#include <common>\n#include <color_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <opaque_fragment>\n#include <dithering_fragment>\n",
  };
  mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader;
};

describe("buildingMaterial — the edit tint reads at every hour (T125)", () => {
  const { fillMat, edgeMat } = createBuildingMaterials();
  const fill = compile(fillMat);
  const edge = compile(edgeMat);

  it("defines ftwOverrideK once in <common> with the three-rung ladder (armed · mine · shared)", () => {
    const defs = fill.fragmentShader.match(/float ftwOverrideK\(\)/g) ?? [];
    expect(defs).toHaveLength(1);
    expect(fill.fragmentShader).toContain(glf(ENRICHED.overrideTintK));
    expect(fill.fragmentShader).toContain(glf(ENRICHED.overrideTintCommittedK));
    expect(fill.fragmentShader).toContain(glf(ENRICHED.overrideTintSharedK));
    expect(fill.fragmentShader.indexOf("float ftwOverrideK()")).toBeLessThan(fill.fragmentShader.indexOf("#include <color_fragment>"));
  });

  it("pulls the albedo by day AND floors the lit colour after <opaque_fragment>, before the haze", () => {
    const f = fill.fragmentShader;
    const uses = f.match(/ftwOverrideK\(\)/g) ?? [];
    expect(uses).toHaveLength(3); // the definition + two readers
    const albedo = f.indexOf("diffuseColor.rgb = mix(diffuseColor.rgb, uFtwAccent, ftwOvK);");
    const opaque = f.indexOf("#include <opaque_fragment>");
    const floor = f.indexOf("gl_FragColor.rgb = max(gl_FragColor.rgb, uFtwAccent * ftwOvG);");
    const haze = f.indexOf("gl_FragColor.rgb = ftwAerial(");
    expect(albedo).toBeGreaterThan(0);
    expect(opaque).toBeGreaterThan(albedo);
    expect(floor).toBeGreaterThan(opaque);
    expect(haze).toBeGreaterThan(floor);
    expect(f).toContain(`ftwOverrideK() * ${glf(ENRICHED.overrideTintGlow)}`);
  });

  it("the glow is a fraction of the K ladder — faint, never a neon slab (owner taste 2026-09-08c)", () => {
    expect(ENRICHED.overrideTintGlow).toBeGreaterThan(0);
    expect(ENRICHED.overrideTintGlow).toBeLessThanOrEqual(0.35);
    // the committed floor stays well under the fused bloom's threshold
    expect(ENRICHED.overrideTintCommittedK * ENRICHED.overrideTintGlow).toBeLessThan(0.2);
  });

  it("the edge material carries no override floor (edges have no _ftw_override attribute)", () => {
    expect(edge.fragmentShader).not.toContain("ftwOverrideK");
    expect(edge.fragmentShader).not.toContain("uFtwAccent");
    expect(edge.fragmentShader).toContain("gl_FragColor.rgb = ftwAerial(");
  });
});

/**
 * PHOTO PROJECTION (the photo flow (b), 2026-10-18 — PHOTO_PROJECT): a facade photo projected from its
 * own pose onto the shared fill material. Pinned through the real onBeforeCompile (the stub above
 * carries <normal_fragment_maps> so the block is generated) and the real onBeforeRender (the per-PASS
 * sync). The claims: every uniform is declared AND bound, the block is camera-relative (never the
 * float32 ECEF vFtwWPos), the fetches sit in uniform control flow, the own-light mix sits between
 * the T125 floor and the haze, the vertex stage is untouched, and the defaults are inert.
 */
describe("buildingMaterial — the photo projection block (the photo flow (b), 2026-10-18)", () => {
  const { fillMat, edgeMat } = createBuildingMaterials();
  const fill = compile(fillMat);
  const edge = compile(edgeMat);
  const f = fill.fragmentShader;
  const anchor = f.indexOf("#include <normal_fragment_maps>");
  const emissive = f.indexOf("#include <emissivemap_fragment>");
  const block = f.slice(anchor, emissive);

  it("the stub really generated the block (positive control for every claim below)", () => {
    expect(anchor).toBeGreaterThan(0);
    expect(emissive).toBeGreaterThan(anchor);
    expect(block).toContain("if (uFtwProjOn > 0.5)");
    expect(block.length).toBeGreaterThan(500);
  });

  it("every uFtwProj* uniform the fragment header declares is bound in shader.uniforms, and vice versa", () => {
    // `highp` is a precision qualifier (the depth sampler carries one) — the regex must see past it;
    // the per-slot holders are ARRAYS (`[ K ]`) since T171 — the regex must see past that too.
    const declared = [...f.matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(uFtwProj\w+)\s*(?:\[\s*\d+\s*\])?\s*;/g)].map((m) => m[1]).sort();
    const bound = Object.keys(fill.uniforms).filter((k) => k.startsWith("uFtwProj")).sort();
    expect(declared.length).toBe(9); // positive control: the regex matched the whole set
    expect(new Set(declared).size).toBe(declared.length); // each declared once
    expect(bound).toEqual(declared);
    // The five per-slot arrays are declared at exactly the compiled slot count.
    const arrays = [...f.matchAll(/uniform\s+(?:highp\s+)?\w+\s+(uFtwProj\w+)\s*\[\s*(\d+)\s*\]\s*;/g)].map((m) => [m[1], Number(m[2])]);
    expect(arrays.sort()).toEqual(
      [
        ["uFtwProjApexV", PHOTO_PROJECT_SLOTS],
        ["uFtwProjDepth", PHOTO_PROJECT_SLOTS],
        ["uFtwProjFromView", PHOTO_PROJECT_SLOTS],
        ["uFtwProjMap", PHOTO_PROJECT_SLOTS],
        ["uFtwProjSlot", PHOTO_PROJECT_SLOTS],
      ].sort(),
    );
    expect(PHOTO_PROJECT_SLOTS).toBe(PHOTO_PROJECT.slots);
  });

  it("T171 — the slots are K unrolled blocks in three's exact `unrollLoops` grammar, with no continue / break", () => {
    // three 0.185 `WebGLProgram.js:280` — copied verbatim: the bound must be literal digits (a
    // #define would not match), and the body is pasted K times with `[ i ]` → `[ n ]`.
    const unrollLoopPattern = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
    const matches = [...block.matchAll(unrollLoopPattern)];
    expect(matches).toHaveLength(1);
    expect(Number(matches[0][1])).toBe(0);
    expect(Number(matches[0][2])).toBe(PHOTO_PROJECT_SLOTS);
    const body = matches[0][3];
    expect(body).not.toMatch(/\b(continue|break)\b/); // neither survives the unroll (no enclosing loop)
    expect(body).toContain("UNROLLED_LOOP_INDEX");
    // Run the unroller the way three does and check the result: K copies, every index literal.
    const unrolled = block.replace(unrollLoopPattern, (_m, start, end, snippet) => {
      let out = "";
      for (let i = Number(start); i < Number(end); i++) out += snippet.replace(/\[\s*i\s*\]/g, `[ ${i} ]`).replace(/UNROLLED_LOOP_INDEX/g, String(i));
      return out;
    });
    expect(unrolled).not.toMatch(/\[\s*i\s*\]/);
    expect(unrolled).not.toContain("UNROLLED_LOOP_INDEX");
    for (let i = 0; i < PHOTO_PROJECT_SLOTS; i++) {
      expect(unrolled).toContain(`textureGrad(uFtwProjMap[ ${i} ],`);
      expect(unrolled).toContain(`textureLod(uFtwProjDepth[ ${i} ],`);
      expect(unrolled).toContain(`float( ${i} ) < uFtwProjOn - 0.5`);
    }
    // The derivatives are taken ONCE, before the loop, in uniform control flow (the gate on the
    // uniform is the only branch above them).
    const dfdx = block.indexOf("dFdx(ftwPV)");
    const loop = block.indexOf("#pragma unroll_loop_start");
    expect(dfdx).toBeGreaterThan(0);
    expect(dfdx).toBeLessThan(loop);
    expect(block.match(/dFd[xy]\(/g) ?? []).toHaveLength(2);
    // Front-to-back "under" compositing: the slot's weight is what the earlier slots left.
    expect(body).toContain("float ftwW = (1.0 - ftwProjK) * ftwKi;");
    expect(body).toContain("ftwProjK += ftwW;");
    expect(body).toContain("ftwProjOwn += ftwW * ftwS.w;");
  });

  it("the block exists once, after <normal_fragment_maps> and before <emissivemap_fragment>, gated on the uniform", () => {
    expect(f.match(/if \(uFtwProjOn > 0\.5\)/g) ?? []).toHaveLength(1);
    const gate = f.indexOf("if (uFtwProjOn > 0.5)");
    expect(gate).toBeGreaterThan(anchor);
    expect(gate).toBeLessThan(emissive);
  });

  it("samples depth with textureLod and the photo with textureGrad (uniform control flow), depth compared in metres", () => {
    expect(block).toContain("textureLod(uFtwProjDepth[ i ],");
    expect(block).toContain("textureGrad(uFtwProjMap[ i ],");
    expect(block).not.toMatch(/\btexture2D\(|\btexture\(/);
    expect(block).toContain("ftwProjLinDepth(");
    expect(f.match(/float ftwProjLinDepth\(float d01\)/g) ?? []).toHaveLength(1);
    expect(f.indexOf("float ftwProjLinDepth(")).toBeLessThan(anchor);
  });

  it("is camera-relative: reads -vViewPosition, never the float32 ECEF vFtwWPos", () => {
    expect(block).toContain("-vViewPosition");
    expect(block).toContain("uFtwProjFromView[ i ] * vec4(");
    expect(block).not.toContain("vFtwWPos");
  });

  it("the own-light mix sits after the T125 floor and before the aerial haze", () => {
    const floor = f.indexOf("gl_FragColor.rgb = max(gl_FragColor.rgb, uFtwAccent * ftwOvG);");
    const mixLine = f.indexOf("gl_FragColor.rgb = mix(gl_FragColor.rgb, ftwProjRgb, ftwProjOwn);");
    const haze = f.indexOf("gl_FragColor.rgb = ftwAerial(");
    expect(floor).toBeGreaterThan(0);
    expect(mixLine).toBeGreaterThan(floor);
    expect(haze).toBeGreaterThan(mixLine);
    expect(f.match(/mix\(gl_FragColor\.rgb, ftwProjRgb, ftwProjOwn\)/g) ?? []).toHaveLength(1);
    // …and the LIT half takes the rest of the coverage (K − own) — the two halves sum to K.
    expect(block).toContain("diffuseColor.rgb = mix(diffuseColor.rgb, ftwProjRgb, ftwProjK - ftwProjOwn);");
  });

  it("the vertex stage is untouched — zero new varyings (the point of the view-space route)", () => {
    expect(fill.vertexShader).toContain("varying vec3 vFtwWPos;"); // positive control: the vertex inject ran
    expect(fill.vertexShader).not.toContain("uFtwProj");
    expect(fill.vertexShader).not.toContain("ftwProj");
  });

  it("does not read the edit-tint ladder (ftwOverrideK stays at definition + two readers)", () => {
    expect(f.match(/ftwOverrideK\(\)/g) ?? []).toHaveLength(3);
    expect(block).not.toContain("ftwOverrideK");
  });

  it("the edge material carries no projection at all", () => {
    expect(edge.fragmentShader).not.toContain("uFtwProj");
    expect(edge.vertexShader).not.toContain("uFtwProj");
    expect(Object.keys(edge.uniforms).filter((k) => k.startsWith("uFtwProj"))).toEqual([]);
  });

  it("the defaults are inert and match PHOTO_PROJECT; the per-slot arrays are exactly K long", () => {
    const { uniforms } = createBuildingMaterials();
    expect(uniforms.uFtwProjOn.value).toBe(0);
    for (const arr of [uniforms.uFtwProjFromView, uniforms.uFtwProjApexV, uniforms.uFtwProjMap, uniforms.uFtwProjDepth, uniforms.uFtwProjSlot])
      expect(arr.value).toHaveLength(PHOTO_PROJECT_SLOTS);
    expect(uniforms.uFtwProjMap.value.every((m) => m === null)).toBe(true);
    expect(uniforms.uFtwProjDepth.value.every((d) => d === null)).toBe(true);
    for (const v of uniforms.uFtwProjSlot.value) expect(v.toArray()).toEqual([PHOTO_PROJECT.strength, 0, PHOTO_PROJECT.rangeM, PHOTO_PROJECT.ownLight]);
    expect(uniforms.uFtwProjK.value.toArray()).toEqual([1, 0, 0, PHOTO_PROJECT.gain]);
    expect(uniforms.uFtwProjDepthP.value.toArray()).toEqual([
      PHOTO_PROJECT.nearM,
      PHOTO_PROJECT.farM,
      PHOTO_PROJECT.depthBiasM,
      PHOTO_PROJECT.depthBiasPerM,
    ]);
    expect(uniforms.uFtwProjFacing.value.toArray()).toEqual([PHOTO_PROJECT.facingLo, PHOTO_PROJECT.facingHi, PHOTO_PROJECT.edgeFeather, 0]);
  });

  describe("the per-PASS sync (fillMat.onBeforeRender, keyed on render frame + camera)", () => {
    // A real projector at the equator (apex ≈ 6.378e6 m on +x), looking east (+y), so projVP has an
    // ECEF-sized translation; the viewer stands 100 m behind it.
    const geom = frustumGeometry({
      latDeg: 0,
      lonDeg: 0,
      altM: 10,
      headingDeg: 90,
      pitchDeg: 0,
      hFovDeg: 60,
      vFovDeg: 40,
      planeDistM: 120,
    });
    const projVP = projectorMatrix(geom, PHOTO_PROJECT.nearM, PHOTO_PROJECT.farM);
    const apexW = new THREE.Vector3(...geom.apex);
    const mkSlot = (patch: Partial<PhotoProjectorSlot> = {}): PhotoProjectorSlot => ({
      on: true,
      projVP: projVP.clone(),
      apexW: apexW.clone(),
      map: new THREE.Texture(),
      depth: new THREE.DepthTexture(4, 4),
      slot: new THREE.Vector4(0.8, 1, 500, 0.5),
      ...patch,
    });
    const mkFeed = (slots: PhotoProjectorSlot[] = [mkSlot()]): PhotoProjectorFeed => ({
      slots,
      k: new THREE.Vector4(1, 0, 0, 1.1),
      depthP: new THREE.Vector4(1, 3000, 0.35, 0.0004),
      facing: new THREE.Vector4(0.1, 0.3, 0.02, 0),
    });
    const camera = new THREE.PerspectiveCamera(50, 1.5, 1, 1e5);
    camera.position.set(geom.apex[0], geom.apex[1] - 100, geom.apex[2] + 5);
    camera.lookAt(apexW);
    camera.updateMatrixWorld(true);
    const scene = new THREE.Scene();
    const geometry = new THREE.BufferGeometry();
    const object = new THREE.Mesh();
    type OBR = (r: unknown, s: unknown, c: unknown, g: unknown, o: unknown, gr: unknown) => void;
    const pass = (mat: THREE.Material, frame: number, cam: THREE.Camera = camera) =>
      (mat.onBeforeRender as unknown as OBR)({ info: { render: { frame } } }, scene, cam, geometry, object, null);

    it("writes FromView = projVP × camera.matrixWorld and ApexV = matrixWorldInverse × apexW; the uploaded translation is small", () => {
      const set = createBuildingMaterials();
      const feed = mkFeed();
      set.setPhotoProjector(feed);
      pass(set.fillMat, 1);
      const u = set.uniforms;
      expect(u.uFtwProjOn.value).toBe(1);
      const want = new THREE.Matrix4().multiplyMatrices(projVP, camera.matrixWorld).elements;
      u.uFtwProjFromView.value[0].elements.forEach((e, i) => expect(Math.abs(e - want[i])).toBeLessThan(1e-9));
      const apexV = apexW.clone().applyMatrix4(camera.matrixWorldInverse);
      expect(u.uFtwProjApexV.value[0].distanceTo(apexV)).toBeLessThan(1e-9);
      expect(apexV.length()).toBeCloseTo(Math.hypot(100, 5), 6); // camera-relative: metres, not 6.4e6
      const t = u.uFtwProjFromView.value[0].elements.slice(12, 15);
      expect(Math.hypot(...t), `translation ${t.join(", ")}`).toBeLessThan(1e4);
      // the raw projVP translation IS ECEF-sized — the cancellation is real, not vacuous
      expect(Math.hypot(...projVP.elements.slice(12, 15))).toBeGreaterThan(1e6);
      expect(u.uFtwProjMap.value[0]).toBe(feed.slots[0].map);
      expect(u.uFtwProjDepth.value[0]).toBe(feed.slots[0].depth);
      expect(u.uFtwProjSlot.value[0].toArray()).toEqual(feed.slots[0].slot.toArray());
      expect(u.uFtwProjMap.value.slice(1).every((m) => m === null)).toBe(true);
      expect(u.uFtwProjK.value.toArray()).toEqual(feed.k.toArray());
      expect(u.uFtwProjDepthP.value.toArray()).toEqual(feed.depthP.toArray());
      expect(u.uFtwProjFacing.value.toArray()).toEqual(feed.facing.toArray());
    });

    it("T171 — packs the LIVE slots in feed order, skips off / textureless ones, nulls the tail, counts them in uFtwProjOn", () => {
      const set = createBuildingMaterials();
      const a = mkSlot({ slot: new THREE.Vector4(1, 1, 600, 0.6) });
      const off = mkSlot({ on: false });
      const noMap = mkSlot({ map: null });
      const b = mkSlot({ slot: new THREE.Vector4(0.5, 1, 300, 0.2) });
      set.setPhotoProjector(mkFeed([a, off, noMap, b]));
      pass(set.fillMat, 1);
      const u = set.uniforms;
      expect(u.uFtwProjOn.value).toBe(2);
      expect(u.uFtwProjMap.value[0]).toBe(a.map);
      expect(u.uFtwProjMap.value[1]).toBe(b.map);
      expect(u.uFtwProjDepth.value[1]).toBe(b.depth);
      expect(u.uFtwProjSlot.value[0].toArray()).toEqual([1, 1, 600, 0.6]);
      expect(u.uFtwProjSlot.value[1].toArray()).toEqual([0.5, 1, 300, 0.2]);
      for (let j = 2; j < PHOTO_PROJECT_SLOTS; j++) {
        expect(u.uFtwProjMap.value[j]).toBeNull();
        expect(u.uFtwProjDepth.value[j]).toBeNull();
      }
      // The arrays never change length (three's flatten reads exactly K entries).
      expect(u.uFtwProjMap.value).toHaveLength(PHOTO_PROJECT_SLOTS);
      // More live slots than K: the first K win (feed order is priority).
      const many = Array.from({ length: PHOTO_PROJECT_SLOTS + 2 }, () => mkSlot());
      set.setPhotoProjector(mkFeed(many));
      pass(set.fillMat, 2);
      expect(u.uFtwProjOn.value).toBe(PHOTO_PROJECT_SLOTS);
      expect(u.uFtwProjMap.value[PHOTO_PROJECT_SLOTS - 1]).toBe(many[PHOTO_PROJECT_SLOTS - 1].map);
    });

    it("the same frame + camera is a no-op; a new frame or a new camera re-syncs", () => {
      const set = createBuildingMaterials();
      const feed = mkFeed();
      set.setPhotoProjector(feed);
      pass(set.fillMat, 1);
      feed.k.w = 0.25;
      pass(set.fillMat, 1);
      expect(set.uniforms.uFtwProjK.value.w).toBe(1.1);
      pass(set.fillMat, 2);
      expect(set.uniforms.uFtwProjK.value.w).toBe(0.25);
      feed.k.w = 0.4;
      const cam2 = camera.clone();
      cam2.updateMatrixWorld(true);
      pass(set.fillMat, 2, cam2);
      expect(set.uniforms.uFtwProjK.value.w).toBe(0.4);
    });

    it("unbinding (null) zeroes uFtwProjOn on the next pass, even within the same frame", () => {
      const set = createBuildingMaterials();
      set.setPhotoProjector(mkFeed());
      pass(set.fillMat, 5);
      expect(set.uniforms.uFtwProjOn.value).toBe(1);
      set.setPhotoProjector(null);
      pass(set.fillMat, 5);
      expect(set.uniforms.uFtwProjOn.value).toBe(0);
    });

    it("a feed whose every slot is off, or on without a photo / depth texture, keeps the block dead", () => {
      for (const patch of [{ on: false }, { map: null }, { depth: null }] as Partial<PhotoProjectorSlot>[]) {
        const set = createBuildingMaterials();
        set.setPhotoProjector(mkFeed([mkSlot(patch), mkSlot(patch)]));
        pass(set.fillMat, 1);
        expect(set.uniforms.uFtwProjOn.value, JSON.stringify(Object.keys(patch))).toBe(0);
        expect(set.uniforms.uFtwProjMap.value.every((m) => m === null)).toBe(true);
      }
      const empty = createBuildingMaterials();
      empty.setPhotoProjector(mkFeed([]));
      pass(empty.fillMat, 1);
      expect(empty.uniforms.uFtwProjOn.value).toBe(0);
    });
  });
});
