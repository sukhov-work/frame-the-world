/**
 * Main-thread client for the decode worker: spawn → transfer the file buffer (zero-copy) →
 * relay stage targets → resolve with a paintable Blob → ALWAYS terminate the worker (fresh
 * wasm heap per file — see worker.ts).
 */

import type { DecodeKind, DecodeWorkerMessage } from "./worker";

export interface DecodedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface DecodeHandle {
  result: Promise<DecodedImage>;
  /** Terminates the worker mid-flight; `result` rejects with an AbortError-named error. */
  cancel(): void;
}

/** Paint the no-OffscreenCanvas fallback pixels on the main thread. */
async function pixelsToBlob(rgba: ArrayBuffer, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))), "image/jpeg", 0.92),
  );
}

function abortError(): Error {
  const err = new Error("Decode cancelled");
  err.name = "AbortError";
  return err;
}

export function decodeInWorker(
  kind: DecodeKind,
  buffer: ArrayBuffer,
  onStage?: (target: number, stage: string) => void,
): DecodeHandle {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let settle: (() => void) | undefined;

  const result = new Promise<DecodedImage>((resolve, reject) => {
    settle = () => reject(abortError());

    worker.onmessage = async (event: MessageEvent<DecodeWorkerMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "stage":
          onStage?.(msg.target, msg.stage);
          break;
        case "done":
          resolve({ blob: msg.blob, width: msg.width, height: msg.height });
          break;
        case "pixels":
          try {
            resolve({ blob: await pixelsToBlob(msg.rgba, msg.width, msg.height), width: msg.width, height: msg.height });
          } catch (err) {
            reject(err);
          }
          break;
        case "error":
          reject(new Error(msg.message));
          break;
      }
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || "Decode worker crashed"));
    };
  });

  // Terminate on any settle; the returned promise keeps its original settlement.
  const done = result.finally(() => worker.terminate());

  worker.postMessage({ kind, buffer }, [buffer]);

  return {
    result: done,
    cancel: () => {
      worker.terminate();
      settle?.();
    },
  };
}
