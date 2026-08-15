import { create } from "zustand";
import { loadViewPrefs, saveViewPref } from "../lib/prefs";
import { cometTarget, type SkyTarget } from "../lib/ephemeris/targets";

/**
 * Sky-target seam (ASTRO ENGINE phase A, 2026-08-03 — generalises the 2026-08-02 comet store):
 * the panel and the SKY search write, the globe reads (`scene/skyTarget.ts` via the
 * orchestrator). Deliberately tiny: the ephemeris is pure and both sides call it directly, so
 * nothing is mirrored here.
 *
 * `target` is ALWAYS set — 10P/Tempel 2 is the standing default guest (it was the whole feature
 * until phase A), and picking a SKY search result swaps it. Phase B: the last-tracked id
 * persists (`skyTargetId`) and is restored LAZILY after boot — the resolve needs the catalog
 * chunk, which must never ride the boot path (lazy-by-contract), so the restore waits for idle
 * and silently keeps 10P when the id no longer resolves.
 *
 * `visible` / `highlight` / `trail` persist through `lib/prefs` (`skyTarget*` keys since the
 * phase-C rename; sanitize still reads the comet-era names so old saved chips survive).
 */
export interface SkyStoreState {
  /** Panel body open (the pill stays either way). */
  open: boolean;
  setOpen(open: boolean): void;
  /** SHOW — render the tracked target in the sky. */
  visible: boolean;
  setVisible(on: boolean): void;
  /** MARK — draw the highlight reticle (and keep a daylight floor so it stays findable). */
  highlight: boolean;
  setHighlight(on: boolean): void;
  /** TRAIL — draw the projected day-arc trajectory (phase C; ON by default, owner ask). */
  trail: boolean;
  setTrail(on: boolean): void;
  /** GHOSTS — temporal ghost copies of the tracked body at t ± k·step (QoL-2, owner 2026-08-14:
   *  "see the body's path precisely against the surroundings while scrubbing"). OFF by default. */
  ghosts: boolean;
  setGhosts(on: boolean): void;
  /** Ghost copies per time direction (symmetric past/future; owner default 4 → 8 total). */
  ghostCount: number;
  setGhostCount(n: number): void;
  /** Minutes between ghost copies. */
  ghostStepMin: number;
  setGhostStepMin(min: number): void;
  /** The tracked sky target — the ONE object the scene marker + trail + panel follow. */
  target: SkyTarget;
  setTarget(target: SkyTarget): void;
}

const prefs = loadViewPrefs();

export const useSkyStore = create<SkyStoreState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  visible: prefs.skyTargetVisible ?? true,
  setVisible: (visible) => {
    saveViewPref("skyTargetVisible", visible);
    set({ visible });
  },
  highlight: prefs.skyTargetHighlight ?? true,
  setHighlight: (highlight) => {
    saveViewPref("skyTargetHighlight", highlight);
    set({ highlight });
  },
  trail: prefs.skyTargetTrail ?? true,
  setTrail: (trail) => {
    saveViewPref("skyTargetTrail", trail);
    set({ trail });
  },
  ghosts: prefs.skyGhosts ?? false,
  setGhosts: (ghosts) => {
    saveViewPref("skyGhosts", ghosts);
    set({ ghosts });
  },
  ghostCount: prefs.skyGhostCount ?? 4,
  setGhostCount: (n) => {
    const ghostCount = Math.max(1, Math.min(15, Math.round(n)));
    saveViewPref("skyGhostCount", ghostCount);
    set({ ghostCount });
  },
  ghostStepMin: prefs.skyGhostStepMin ?? 10,
  setGhostStepMin: (min) => {
    const ghostStepMin = Math.max(1, Math.min(120, Math.round(min)));
    saveViewPref("skyGhostStepMin", ghostStepMin);
    set({ ghostStepMin });
  },
  target: cometTarget(),
  setTarget: (target) => {
    saveViewPref("skyTargetId", target.id);
    set({ target });
  },
}));

// Phase B: restore the last-tracked target AFTER boot settles. requestIdleCallback (setTimeout
// fallback) keeps the catalog chunk off the boot path; a stale/unresolvable id (pruned cache,
// re-baked catalog) silently keeps the 10P default. Guarded so a user pick during the idle wait
// is never overwritten.
if (typeof window !== "undefined" && prefs.skyTargetId && prefs.skyTargetId !== "comet:10P") {
  const restoreId = prefs.skyTargetId;
  const restore = () => {
    void import("../lib/sky/catalog")
      .then((cat) => cat.targetByIdAsync(restoreId))
      .then((target) => {
        if (target && useSkyStore.getState().target.id === "comet:10P")
          useSkyStore.setState({ target });
      })
      .catch(() => {
        /* stale id — the default guest stands */
      });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(restore, { timeout: 8000 });
  } else {
    setTimeout(restore, 4000);
  }
}

// Dev-only introspection (mirrors window.__globe / __planStore) so browser verification can drive
// the toggles and swap targets without reaching through the UI.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__skyStore = useSkyStore;
}
