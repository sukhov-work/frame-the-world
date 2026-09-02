import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_CAPS, type ModelStats, type ModelViolation } from "../../src/lib/models/modelCaps";
import { useCameraStore } from "../../src/store/camera";
import { _setModelPipeline, useModelUploadStore, type ModelPipeline } from "../../src/store/modelUpload";
import { useUploadStore } from "../../src/store/upload";

// MESH SUITE MS4 — the model branch of the upload modal, driven through a FAKE pipeline (the
// three-dependent steps are browser tier — `verify-modelupload.mjs`); this pins the phase
// machine, the caps as applied, the texture ladder, the seed hand-off and the upload wire.

const healthy: ModelStats = {
  tris: 42_000,
  meshes: 6,
  textures: 2,
  maxTextureEdge: 2048,
  animations: 0,
  skinned: false,
  morphs: false,
  bbox: [12, 30, 8],
};

interface FakeOpts {
  stats?: Partial<ModelStats>;
  rawExtent?: number;
  animations?: number;
  /** GLB bytes per texture edge rung; a plain number answers every rung. */
  glbBytes?: number | Record<number, number>;
  decimate?: { tris: number; before: number } | { violation: ModelViolation };
  loadError?: Error;
  thumbnail?: boolean;
}

function fakePipeline(opts: FakeOpts = {}) {
  const calls = { load: 0, decimate: [] as number[], exportEdges: [] as number[], unitScales: [] as number[], dispose: 0 };
  const root = { fake: true };
  const pipeline: ModelPipeline = {
    load: async () => {
      calls.load++;
      if (opts.loadError) throw opts.loadError;
      return { root, animations: opts.animations ?? 0 };
    },
    rawExtent: () => opts.rawExtent ?? 30,
    inspect: (_r, animations, unitScale) => ({
      ...healthy,
      ...opts.stats,
      animations,
      bbox: [12 * unitScale, 30 * unitScale, 8 * unitScale],
    }),
    decimate: async (_r, maxTris) => {
      calls.decimate.push(maxTris);
      return opts.decimate ?? { tris: maxTris, before: 250_000 };
    },
    applyUnitScale: (_r, k) => {
      calls.unitScales.push(k);
    },
    exportGlb: async (_r, edge) => {
      calls.exportEdges.push(edge);
      const bytes = typeof opts.glbBytes === "number" ? opts.glbBytes : (opts.glbBytes?.[edge] ?? 1_500_000);
      return new ArrayBuffer(bytes);
    },
    thumbnail: async () => (opts.thumbnail === false ? null : new Blob([new Uint8Array(4)], { type: "image/png" })),
    dispose: () => {
      calls.dispose++;
    },
  };
  return { pipeline, calls };
}

const file = (name: string, size = 1024) => new File([new Uint8Array(Math.min(size, 16))], name);
const fileOfSize = (name: string, size: number) => {
  const f = file(name);
  Object.defineProperty(f, "size", { value: size });
  return f;
};

beforeEach(() => {
  useModelUploadStore.getState().clear();
  useUploadStore.getState().clear();
  useUploadStore.setState({ open: false, pendingPlacement: undefined });
  useCameraStore.getState().setTempPin(null);
});
afterEach(() => {
  _setModelPipeline(null);
  vi.unstubAllGlobals();
});

describe("modelUpload store — the pipeline as a phase machine", () => {
  it("boots idle", () => {
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.unit).toBe("m");
    expect(s.violations).toEqual([]);
  });

  it("a healthy drop walks to REVIEW with its facts, a thumbnail and the file-stem title", async () => {
    const { pipeline, calls } = fakePipeline();
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("water-tower.glb", 4000)], 0, "glb");
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(s.progress).toBe(1);
    expect(s.title).toBe("water-tower");
    expect(s.format).toBe("glb");
    expect(s.stats?.tris).toBe(42_000);
    expect(s.decimatedFromTris).toBeNull();
    expect(s.glbBytes).toBe(1_500_000);
    expect(s.textureEdge).toBe(2048);
    expect(s.thumbnailUrl).toMatch(/^blob:/);
    expect(s.unit).toBe("m");
    expect(s.unitSuggested).toBe(false);
    expect(s.placement).toBeUndefined();
    expect(calls.decimate).toEqual([]);
    expect(calls.exportEdges).toEqual([2048]);
    expect(calls.unitScales).toEqual([1]);
  });

  it("refuses an over-size drop BEFORE loading anything (companions count)", async () => {
    const { pipeline, calls } = fakePipeline();
    _setModelPipeline(pipeline);
    await useModelUploadStore
      .getState()
      .begin([fileOfSize("big.gltf", 10 * 1024 * 1024), fileOfSize("big.bin", 6 * 1024 * 1024)], 0, "gltf");
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("error");
    expect(s.errorCode).toBe("RAW_TOO_LARGE");
    expect(s.error).toMatch(/16 MB/);
    expect(calls.load).toBe(0);
  });

  it("a hard refusal (rigged) lands on ERROR with the named reason and frees the scene", async () => {
    const { pipeline, calls } = fakePipeline({ stats: { skinned: true } });
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("rig.fbx")], 0, "fbx");
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("error");
    expect(s.violations.map((v) => v.code)).toEqual(["RIGGED"]);
    expect(s.error).toMatch(/RIGGED/);
    expect(calls.dispose).toBe(1);
  });

  it("over-budget triangles are DECIMATED to the cap and the original count is remembered", async () => {
    const { pipeline, calls } = fakePipeline({ stats: { tris: 250_000 }, decimate: { tris: 99_800, before: 250_000 } });
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("dense.obj")], 0, "obj");
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(calls.decimate).toEqual([MODEL_CAPS.maxTris]);
    expect(s.stats?.tris).toBe(99_800);
    expect(s.decimatedFromTris).toBe(250_000);
  });

  it("an undecimatable model (locked multi-material meshes) is refused as TOO_MANY_TRIS", async () => {
    const { pipeline } = fakePipeline({
      stats: { tris: 250_000 },
      decimate: { violation: { code: "TOO_MANY_TRIS", count: 250_000, max: MODEL_CAPS.maxTris } },
    });
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("dense.glb")], 0, "glb");
    expect(useModelUploadStore.getState().errorCode).toBe("TOO_MANY_TRIS");
  });

  it("walks the texture ladder until the GLB fits and records the rung it landed on", async () => {
    const { pipeline, calls } = fakePipeline({ glbBytes: { 2048: 12_000_000, 1024: 9_000_000, 512: 4_000_000 } });
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("textured.glb")], 0, "glb");
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(calls.exportEdges).toEqual([2048, 1024, 512]);
    expect(s.textureEdge).toBe(512);
    expect(s.glbBytes).toBe(4_000_000);
  });

  it("still over the cap at the last rung → GLB_TOO_LARGE names the rung", async () => {
    const { pipeline } = fakePipeline({ glbBytes: 9_000_000 });
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("huge.glb")], 0, "glb");
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("error");
    expect(s.errorCode).toBe("GLB_TOO_LARGE");
    expect(s.error).toMatch(/512²/);
  });

  it("an UNTEXTURED model is judged on the first rung only (lower rungs cannot shrink it)", async () => {
    const { pipeline, calls } = fakePipeline({ stats: { textures: 0, maxTextureEdge: 0 }, glbBytes: 9_000_000 });
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("bare.glb")], 0, "glb");
    expect(useModelUploadStore.getState().errorCode).toBe("GLB_TOO_LARGE");
    expect(calls.exportEdges).toEqual([2048]);
  });

  it("guesses centimetres for a 3 100-unit model, scales the bounds, and re-packs on a unit change", async () => {
    const { pipeline, calls } = fakePipeline({ rawExtent: 3_100 });
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("cm-house.obj")], 0, "obj");
    let s = useModelUploadStore.getState();
    expect(s.unit).toBe("cm");
    expect(s.unitSuggested).toBe(true);
    expect(s.stats?.bbox).toEqual([0.12, 0.3, 0.08]);
    expect(calls.unitScales).toEqual([0.01]);
    await useModelUploadStore.getState().setUnit("m");
    s = useModelUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(s.unit).toBe("m");
    expect(s.unitSuggested).toBe(false);
    expect(s.stats?.bbox).toEqual([12, 30, 8]);
    expect(calls.unitScales).toEqual([0.01, 1]);
    expect(calls.exportEdges.length).toBe(2);
  });

  it("consumes the UPLOAD HERE seed at review and retires the temp pin (the photo ingest rule)", async () => {
    const { pipeline } = fakePipeline();
    _setModelPipeline(pipeline);
    useUploadStore.getState().uploadAt(48.4647, 35.0462);
    useCameraStore.getState().setTempPin({ latDeg: 48.4647, lonDeg: 35.0462 });
    await useModelUploadStore.getState().begin([file("kiosk.glb")], 0, "glb");
    expect(useModelUploadStore.getState().placement).toEqual({ latDeg: 48.4647, lonDeg: 35.0462 });
    expect(useUploadStore.getState().pendingPlacement).toBeUndefined();
    expect(useCameraStore.getState().tempPin).toBeNull();
  });

  it("warnings ride along (dropped animations, downscaled textures) without blocking", async () => {
    const { pipeline } = fakePipeline({ animations: 2, stats: { maxTextureEdge: 4096 } });
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("anim.glb")], 0, "glb");
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(s.warnings).toEqual(["TEXTURES DOWNSCALED TO 2048² (WAS 4096²)", "2 ANIMATIONS DROPPED — MODELS ARE STATIC"]);
  });

  it("a loader failure is an ERROR with the message; a compression refusal keeps its code", async () => {
    const { pipeline } = fakePipeline({ loadError: new Error("Unexpected token") });
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("broken.gltf")], 0, "gltf");
    let s = useModelUploadStore.getState();
    expect(s.phase).toBe("error");
    expect(s.errorCode).toBe("LOAD_FAILED");
    expect(s.error).toMatch(/Unexpected token/);

    const err = Object.assign(new Error("draco"), { violation: { code: "UNSUPPORTED_COMPRESSION" } });
    _setModelPipeline(fakePipeline({ loadError: err }).pipeline);
    await useModelUploadStore.getState().begin([file("draco.glb")], 0, "glb");
    s = useModelUploadStore.getState();
    expect(s.errorCode).toBe("UNSUPPORTED_COMPRESSION");
    expect(s.error).toMatch(/DRACO/);
  });

  it("a second drop supersedes an in-flight first one (the stale result is disposed, not shown)", async () => {
    let release: () => void = () => {};
    const slow = fakePipeline();
    slow.pipeline.load = async () => {
      await new Promise<void>((r) => (release = r));
      return { root: { slow: true }, animations: 0 };
    };
    _setModelPipeline(slow.pipeline);
    const first = useModelUploadStore.getState().begin([file("first.glb")], 0, "glb");
    const fast = fakePipeline({ stats: { tris: 7 } });
    _setModelPipeline(fast.pipeline);
    await useModelUploadStore.getState().begin([file("second.glb")], 0, "glb");
    release();
    await first;
    const s = useModelUploadStore.getState();
    expect(s.fileName).toBe("second.glb");
    expect(s.stats?.tris).toBe(7);
    expect(s.phase).toBe("review");
  });

  it("clear() frees the scene, revokes the thumbnail and returns to idle", async () => {
    const { pipeline, calls } = fakePipeline();
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("x.glb")], 0, "glb");
    useModelUploadStore.getState().clear();
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.thumbnailUrl).toBeUndefined();
    expect(s.stats).toBeUndefined();
    expect(calls.dispose).toBe(1);
  });
});

describe("modelUpload store — the upload wire", () => {
  function stubWire(opts: { mintStatus?: number; putStatus?: number; postStatus?: number; postBody?: unknown } = {}) {
    const seen: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({ url, init });
        const respond = (status: number, body: unknown) =>
          new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
        if (url === "/api/upload-url") {
          if (opts.mintStatus && opts.mintStatus !== 200) return respond(opts.mintStatus, { error: "SIGNED_OUT", message: "sign in to upload" });
          const kind = JSON.parse(init!.body as string).kind;
          return respond(200, kind === "model"
            ? { kind, uploadUrl: "https://upload.wixmp.com/u/abc", fileName: "water-tower.glb" }
            : { kind, uploadUrl: "https://upload.wixmp.com/u/thumb" });
        }
        if (url.startsWith("https://upload.wixmp.com/u/thumb"))
          return respond(200, { file: { id: "166a86_thumb~mv2.png", url: "https://static.wixstatic.com/media/166a86_thumb~mv2.png", mediaType: "IMAGE" } });
        if (url.startsWith("https://upload.wixmp.com/"))
          return respond(opts.putStatus ?? 200, {
            file: {
              id: "166a86_deadbeef.glb",
              url: "https://static.wixstatic.com/3d/166a86_deadbeef.glb",
              media: { model3d: { url: "https://static.wixstatic.com/3d/166a86_deadbeef.glb", thumbnail: { url: "https://static.wixstatic.com/media/t.png" } } },
              operationStatus: "READY",
            },
          });
        if (url === "/api/models")
          return respond(
            opts.postStatus ?? 200,
            opts.postBody ?? { modelId: "row-1", url: "https://static.wixstatic.com/3d/166a86_deadbeef.glb", thumbnailUrl: "https://static.wixstatic.com/media/t.png", readiness: "READY" },
          );
        return respond(404, { error: "NOT_FOUND" });
      }),
    );
    return seen;
  }

  it("mints → PUTs the GLB → uploads the thumbnail beside it → POSTs the facts (seed included) and lands on STORED", async () => {
    const { pipeline } = fakePipeline({ stats: { tris: 250_000 }, decimate: { tris: 100_000, before: 250_000 } });
    _setModelPipeline(pipeline);
    useUploadStore.getState().uploadAt(48.4647, 35.0462);
    await useModelUploadStore.getState().begin([fileOfSize("Water Tower.fbx", 4_200_000)], 0, "fbx");
    useModelUploadStore.getState().setTitle("Dnipro water tower");
    const seen = stubWire();
    await useModelUploadStore.getState().upload();
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("stored");
    expect(s.stored).toEqual({
      modelId: "row-1",
      url: "https://static.wixstatic.com/3d/166a86_deadbeef.glb",
      thumbnailUrl: "https://static.wixstatic.com/media/t.png",
      readiness: "READY",
    });
    const mint = JSON.parse(seen[0].init!.body as string);
    expect(mint).toEqual({ kind: "model", fileName: "Water-Tower.glb", mimeType: "model/gltf-binary", sizeBytes: 1_500_000 });
    expect(seen[1].url).toBe("https://upload.wixmp.com/u/abc?filename=water-tower.glb");
    expect(seen[1].init!.method).toBe("PUT");
    expect((seen[1].init!.headers as Record<string, string>)["Content-Type"]).toBe("model/gltf-binary");
    const thumbMint = JSON.parse(seen[2].init!.body as string);
    expect(thumbMint).toEqual({ kind: "preview", fileName: "Water-Tower-thumb.png", mimeType: "image/png", sizeBytes: 4 });
    expect(seen[3].url).toBe("https://upload.wixmp.com/u/thumb?filename=Water-Tower-thumb.png");
    expect((seen[3].init!.headers as Record<string, string>)["Content-Type"]).toBe("image/png");
    const posted = JSON.parse(seen[4].init!.body as string);
    expect(posted).toEqual({
      fileId: "166a86_deadbeef.glb",
      thumbnailFileId: "166a86_thumb~mv2.png",
      title: "Dnipro water tower",
      fileName: "Water Tower.fbx",
      sourceFormat: "fbx",
      rawBytes: 4_200_000,
      glbBytes: 1_500_000,
      tris: 100_000,
      meshes: 6,
      textures: 2,
      decimatedFromTris: 250_000,
      bbox: [12, 30, 8],
      lat: 48.4647,
      lon: 35.0462,
    });
  });

  it("a signed-out mint (401) keeps the packed model in REVIEW with the endpoint's code", async () => {
    const { pipeline } = fakePipeline();
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("x.glb")], 0, "glb");
    stubWire({ mintStatus: 401 });
    await useModelUploadStore.getState().upload();
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(s.errorCode).toBe("SIGNED_OUT");
    expect(s.error).toBe("sign in to upload");
    expect(s.glbBytes).toBe(1_500_000);
  });

  it("a refused record (the descriptor verdict) surfaces the server's message and stays retryable", async () => {
    const { pipeline } = fakePipeline();
    _setModelPipeline(pipeline);
    await useModelUploadStore.getState().begin([file("x.glb")], 0, "glb");
    stubWire({ postStatus: 400, postBody: { error: "NOT_A_MODEL", message: "the file is not a 3D model" } });
    await useModelUploadStore.getState().upload();
    const s = useModelUploadStore.getState();
    expect(s.phase).toBe("review");
    expect(s.errorCode).toBe("NOT_A_MODEL");
    expect(s.error).toBe("the file is not a 3D model");
  });

  it("upload() is a no-op outside REVIEW", async () => {
    stubWire();
    await useModelUploadStore.getState().upload();
    expect(useModelUploadStore.getState().phase).toBe("idle");
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
  });
});
