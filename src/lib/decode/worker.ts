/// <reference lib="webworker" />
/**
 * Decode worker — one file per worker lifetime (C1: all heavy decode stays client-side, off the
 * main thread). The client (`workerClient.ts`) spawns a fresh worker per decode and terminates it
 * afterwards: the Emscripten heap never shrinks (a 26 MP ARW leaves a ~300 MB high-water mark), so
 * a disposable worker IS the "free RAW buffers immediately" strategy.
 *
 * RAW  → libraw-wasm@1.0.5 (pinned: the last single-threaded build; 1.1.2+ need pthreads +
 *        SharedArrayBuffer = COOP/COEP, unverified on Wix hosting — see wasm-modules.d.ts).
 * HEIC → libheif-js wasm bundle (dynamic import, ~1.4 MB, only when the browser lacks native HEIC).
 *
 * Stage messages are REAL decode boundaries (libraw-wasm exposes no intra-stage progress); the
 * store trickles the bar toward each stage's target so long stages still read as motion.
 */

import librawWasmUrl from "libraw-wasm/dist/libraw.wasm?url";
import { channelsToRgba } from "./convert";

export type DecodeKind = "raw" | "heic";

export interface DecodeRequest {
  kind: DecodeKind;
  buffer: ArrayBuffer;
}

export type DecodeWorkerMessage =
  | { type: "stage"; stage: string; target: number }
  | { type: "done"; blob: Blob; width: number; height: number }
  /** OffscreenCanvas-less fallback — the client paints these on the main thread. */
  | { type: "pixels"; rgba: ArrayBuffer; width: number; height: number }
  | { type: "error"; message: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

// libraw-wasm@1.0.5's Emscripten loader fetches "libraw.wasm" as a runtime sibling of its module
// URL — a dynamic path Vite's asset pipeline can't rewrite. Redirect that one request to the
// Vite-emitted asset (in dev both point at node_modules, so this is a pass-through).
const nativeFetch = worker.fetch.bind(worker);
worker.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.split("?")[0].endsWith("libraw.wasm")) return nativeFetch(librawWasmUrl, init);
  return nativeFetch(input as RequestInfo, init);
}) as typeof fetch;

function post(message: DecodeWorkerMessage, transfer: Transferable[] = []): void {
  worker.postMessage(message, transfer);
}

const stage = (name: string, target: number) => post({ type: "stage", stage: name, target });

/** Measured on the 26 MP fixture: open ≈ 3.4 s (unpack dominates), imageData ≈ 0.8 s halfSize. */
const RAW_SETTINGS = { useCameraWb: true, halfSize: true, outputBps: 8 } as const;

async function decodeRaw(buffer: ArrayBuffer): Promise<{ rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }> {
  stage("wasm", 0.15);
  const { default: LibRaw } = await import("libraw-wasm");
  const raw = new LibRaw();
  stage("unpack", 0.7);
  await raw.open(new Uint8Array(buffer), RAW_SETTINGS);
  stage("demosaic", 0.88);
  const image = await raw.imageData();
  if (!image || !image.width || !image.height || !image.data?.length) {
    throw new Error("LibRaw produced no image data");
  }
  return {
    rgba: channelsToRgba(image.data, image.width, image.height, image.colors),
    width: image.width,
    height: image.height,
  };
}

async function decodeHeic(buffer: ArrayBuffer): Promise<{ rgba: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }> {
  stage("wasm", 0.25);
  const factory = (await import("libheif-js/libheif-wasm/libheif-bundle.mjs")).default;
  const libheif = await factory();
  stage("decode", 0.8);
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(buffer));
  if (images.length === 0) throw new Error("No image in HEIC container");
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  const rgba = new Uint8ClampedArray(width * height * 4);
  await new Promise<void>((resolve, reject) => {
    image.display({ data: rgba, width, height }, (filled) =>
      filled ? resolve() : reject(new Error("HEIF processing error")),
    );
  });
  for (const img of images) img.free?.();
  return { rgba, width, height };
}

worker.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { kind, buffer } = event.data;
  try {
    const { rgba, width, height } =
      kind === "raw" ? await decodeRaw(buffer) : await decodeHeic(buffer);

    stage("encode", 0.97);
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
      ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      post({ type: "done", blob, width, height });
    } else {
      post({ type: "pixels", rgba: rgba.buffer as ArrayBuffer, width, height }, [rgba.buffer as ArrayBuffer]);
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
