import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createBuildingMaterials } from "../../../src/components/globe/scene/buildingMaterial";
import { ENRICHED } from "../../../src/components/globe/tuning";
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
      "#include <common>\n#include <color_fragment>\n#include <emissivemap_fragment>\n#include <opaque_fragment>\n#include <dithering_fragment>\n",
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
