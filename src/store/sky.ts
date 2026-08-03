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
 * until phase A), and picking a SKY search result swaps it. Session-only by design: a reload
 * returns to the comet until phase B persists the last-tracked id alongside the prefs.
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
  target: cometTarget(),
  setTarget: (target) => set({ target }),
}));

// Dev-only introspection (mirrors window.__globe / __planStore) so browser verification can drive
// the toggles and swap targets without reaching through the UI.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__skyStore = useSkyStore;
}
