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
import type { useBldgSyncStore } from "./store/bldgSync";
import type { useCameraStore } from "./store/camera";
import type { useTimeStore } from "./store/time";
import type { useMiniMapStore } from "./store/minimap";
import type { usePinsStore } from "./store/pins";
import type { usePlanStore } from "./store/plan";
import type { useFindStore } from "./store/find";
import type { useBestSpotStore } from "./store/bestSpot";
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
      /** RC18: the RENDERER tier — what DPR, bloom, the AO gate and the composite base ran at. */
      readonly tier: "low" | "mid" | "high";
      /** RC18: the TILE tier — error targets, LRU caps, queue caps, foveation, budgets. Equal to
       *  `tier` except while a governor promote's renderer half is parked inside FPV; that
       *  divergence is the whole point of the lever split, so it must be observable. */
      readonly tileTier: "low" | "mid" | "high";
      readonly dpr: number;
      readonly leanFlat2d: boolean;
      readonly mapFlat: boolean;
      readonly lean: boolean;
      /** ULTRA HQ (owner 2026-08-22h): the tier pin is engaged — the governor still steps and
       *  its EMA stays honest, but its results are dropped. Always false on /m and on any
       *  coarse-pointer device (the gate is resolved in StylizedTiles, before GlobeCanvas
       *  ever sees it). */
      readonly ultra: boolean;
      /** ULTRA (T45 S5, 2026-08-22j): the chip state as read at BOOT, and the shadow-map edge the
       *  rig was actually built with. These two exist because the construction-time levers cannot
       *  follow a live flip — `ultra !== ultraBoot` is exactly the "toggled this session, reload
       *  for the full shadow rig" state, and `shadowMapPx` is the value AFTER the
       *  maxTextureSize clamp, so a browser check reads what the GPU got rather than what tuning
       *  asked for. */
      readonly ultraBoot: boolean;
      readonly shadowMapPx: number;
    };
    /** RC19 — the /m PiP scene cache. `renders` counts CACHE MISSES (a real second scene pass),
     *  `blits` counts frames the miniature was painted; pre-RC19 the two were equal by
     *  construction, so their ratio IS the saving. `maxStaleMs` is WRITABLE so a harness can run
     *  the cost A/B against the pre-RC19 behaviour (`0`) on a single page load. */
    __pipCache?: {
      readonly active: boolean;
      readonly renders: number;
      readonly blits: number;
      readonly rtPx: readonly [number, number] | null;
      maxStaleMs: number;
    };
    /** RC21 — the main-view on-demand render gate. SHIPS OFF (`GATE.enabled === false`); `enabled`
     *  is WRITABLE so a soak can flip it on one page, hold an ULTRA timelapse to prove no eased
     *  uniform sticks, and flip back to compare. `draws`/`skips` are CUMULATIVE SINCE PAGE LOAD —
     *  sample twice and difference, never once. */
    __frameGate?: {
      enabled: boolean;
      readonly draws: number;
      readonly skips: number;
      readonly restMs: number;
      maxStaleMs: number;
    };
    __timeStore?: typeof useTimeStore;
    __cameraStore?: typeof useCameraStore;
    __minimapStore?: typeof useMiniMapStore;
    __pinsStore?: typeof usePinsStore;
    __planStore?: typeof usePlanStore;
    __findStore?: typeof useFindStore;
    __bestSpotStore?: typeof useBestSpotStore;
    __bldgEditStore?: typeof useBldgEditStore;
    /** MESH SUITE MS3 — the world-sync counters (world fetch phase, shared/dirty rows, the last
     *  push's outcome) + `requestSync()`; `verify-meshedit.mjs` legs 15+ drive SYNC through it. */
    __bldgSyncStore?: typeof useBldgSyncStore;
    __skyStore?: typeof useSkyStore;
    __placesStore?: typeof usePlacesMapStore;
    __saveStore?: typeof useSaveStore;
    __uploadStore?: typeof useUploadStore;
    __marketStore?: typeof useMarketStore;
    __memberStore?: typeof useMemberStore;
  }
}

export {};
