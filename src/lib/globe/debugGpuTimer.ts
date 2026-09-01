/**
 * GPU frame timer — `EXT_disjoint_timer_query_webgl2` behind a tiny query ring (DEBUG HUD,
 * owner 2026-09-01). The classic three.js WebGLRenderer exposes NO GPU timing (verified against
 * the installed 0.185 source — the only in-tree implementation is the WebGPU fallback's), so
 * the HUD brackets the draw block itself.
 *
 * The extension's contract, encoded here rather than re-learned:
 *  - results are ASYNC — available 1–5 frames later (`QUERY_RESULT_AVAILABLE`), in NANOSECONDS;
 *  - `GPU_DISJOINT_EXT` set means the GPU clock hiccupped — every in-flight result is garbage
 *    and must be discarded, not reported;
 *  - only ONE `TIME_ELAPSED_EXT` query may be active at a time (begin/end pairs never nest);
 *  - the extension is absent on Firefox/Safari and under fingerprinting protection — callers
 *    show "—" instead of a number, never a fake.
 *
 * Off-state cost: `begin()`/`end()` early-return when the ring is saturated or unsupported;
 * the caller additionally gates on `debugFeedActive()` so an idle session issues no queries.
 */

import { DEBUGHUD } from "../../components/globe/tuning";

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export interface GpuTimer {
  readonly supported: boolean;
  /** Start the frame's query (no-op if unsupported, saturated, or already open). */
  begin(): void;
  /** End the open query (no-op unless begin() opened one this frame). */
  end(): void;
  /** Harvest the oldest finished query: milliseconds, or null when nothing new landed. */
  poll(): number | null;
  dispose(): void;
}

export function createGpuTimer(gl: WebGL2RenderingContext): GpuTimer {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
  if (!ext) {
    return {
      supported: false,
      begin() {},
      end() {},
      poll: () => null,
      dispose() {},
    };
  }
  const pending: WebGLQuery[] = [];
  const free: WebGLQuery[] = [];
  let open = false;
  return {
    supported: true,
    begin() {
      if (open || pending.length >= DEBUGHUD.gpuQueryRing) return;
      const q = free.pop() ?? gl.createQuery();
      if (!q) return;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      pending.push(q);
      open = true;
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      open = false;
    },
    poll() {
      if (pending.length === 0) return null;
      // A disjoint event poisons every in-flight query — drop them all, report nothing.
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        for (const q of pending) free.push(q);
        pending.length = 0;
        return null;
      }
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return null;
      pending.shift();
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      free.push(q);
      return ns / 1e6;
    },
    dispose() {
      for (const q of pending) gl.deleteQuery(q);
      for (const q of free) gl.deleteQuery(q);
      pending.length = 0;
      free.length = 0;
      open = false;
    },
  };
}
