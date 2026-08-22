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
import type { useBldgEditStore } from "./store/bldgEdit";
import type { useCameraStore } from "./store/camera";
import type { useTimeStore } from "./store/time";
import type { useMiniMapStore } from "./store/minimap";
import type { usePinsStore } from "./store/pins";
import type { usePlanStore } from "./store/plan";
import type { useFindStore } from "./store/find";
import type { useSkyStore } from "./store/sky";
import type { usePlacesMapStore } from "./store/places";
import type { useSaveStore } from "./store/save";
import type { useUploadStore } from "./store/upload";
import type { useMarketStore } from "./store/market";
import type { useMemberStore } from "./store/member";

declare global {
  interface Window {
    __globe?: unknown;
    __renderer?: unknown;
    __composer?: unknown;
    __quality?: unknown;
    /** QA slice A/B: the expanded chart's live view (centre/twist/zoom) — refs are otherwise
     *  unreachable from the harness; published per paint by MapWindow.draw(). `anchor*` is the
     *  RESOLVED aim anchor (audit #3 T36): the harness must read the ladder's result, never
     *  re-derive it — a transcribed copy went stale the day the ladder was hoisted. */
    __mapWindowView?: {
      latDeg: number;
      lonDeg: number;
      rot: number;
      z: number;
      anchorLatDeg: number;
      anchorLonDeg: number;
    };
    /** QA slice C: overlay fresh-instance rebuild count (imageryGround.setOverlayResolution)
     *  — the sticky-composite invariant is ≤1 per session post-boot. */
    __overlayRebuilds?: number;
    /** QA-7b DPR probe, registered by audit #3 A2-5 (it shipped 2026-08-21g through the exact
     *  `as unknown as` cast this registry exists to replace). LIVE GETTERS: the fields are read
     *  at access time, not frozen at the last governor step. `leanFlat2d` is the COARSE-POINTER
     *  latch that gates QUALITY.leanMobile.dprCap2d — permanently false on desktop, which the
     *  name now says out loud; `mapFlat` is the engine's real flat-chart latch on every shell,
     *  so a desktop assertion on it can still fail. `dpr` is the renderer's effective ratio. */
    __globeQuality?: {
      readonly tier: "low" | "mid" | "high";
      readonly dpr: number;
      readonly leanFlat2d: boolean;
      readonly mapFlat: boolean;
      readonly lean: boolean;
    };
    __timeStore?: typeof useTimeStore;
    __cameraStore?: typeof useCameraStore;
    __minimapStore?: typeof useMiniMapStore;
    __pinsStore?: typeof usePinsStore;
    __planStore?: typeof usePlanStore;
    __findStore?: typeof useFindStore;
    __bldgEditStore?: typeof useBldgEditStore;
    __skyStore?: typeof useSkyStore;
    __placesStore?: typeof usePlacesMapStore;
    __saveStore?: typeof useSaveStore;
    __uploadStore?: typeof useUploadStore;
    __marketStore?: typeof useMarketStore;
    __memberStore?: typeof useMemberStore;
  }
}

export {};
