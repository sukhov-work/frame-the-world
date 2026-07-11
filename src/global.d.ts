/**
 * DEV-only browser-verification seams (B11). The globe scene and every zustand store publish
 * themselves on `window.__*` under `import.meta.env.DEV` so Playwright / scripted-CDP verification
 * can drive them without reaching through the UI (see conventions/architecture-and-patterns.md
 * § DEV seams; the registry is load-bearing for the verify harness). Typing them here replaces the
 * scattered `(window as any)` / `(window as unknown as {…})` casts with one declared surface.
 *
 * The scene handles (`__globe`/`__renderer`/`__composer`) stay `unknown` — they exist only to be
 * poked at runtime and typing them would couple this file to three; the stores are typed precisely.
 */
import type { useCameraStore } from "./store/camera";
import type { useTimeStore } from "./store/time";
import type { usePinsStore } from "./store/pins";
import type { useSaveStore } from "./store/save";
import type { useUploadStore } from "./store/upload";

declare global {
  interface Window {
    __globe?: unknown;
    __renderer?: unknown;
    __composer?: unknown;
    __timeStore?: typeof useTimeStore;
    __cameraStore?: typeof useCameraStore;
    __pinsStore?: typeof usePinsStore;
    __saveStore?: typeof useSaveStore;
    __uploadStore?: typeof useUploadStore;
  }
}

export {};
