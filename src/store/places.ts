import { create } from "zustand";
import { loadViewPrefs, saveViewPref } from "../lib/prefs";
import type { PlaceListItem } from "../lib/wix/placeRecords";

/**
 * MY PLACES ON MAP (owner 2026-08-19, LAYERS batch) — the member's saved FPV places as markers
 * on the 2D map window AND the GL globe (scene/placeMarkers, owner 2026-08-19b), a different
 * hue from the temp pin. Lazy single fetch per session (MapWindow open + the orchestrator's
 * idle kick call ensureLoaded — no boot-path cost); the endpoint is member-gated server-side,
 * so anonymous just stays empty (401 is a final answer, not an error). The LAYERS chips on
 * both shells write `onMap`; the map window + globe read everything. Save/delete paths push
 * local deltas so a just-saved place appears without a reload (owner 2026-08-19b).
 */
interface PlacesMapState {
  /** Show the markers (persisted, default ON — owner ruling). */
  onMap: boolean;
  setOnMap(on: boolean): void;
  places: readonly PlaceListItem[];
  /** True once a fetch settled definitively (rows or a 401) — failures retry next call. */
  loaded: boolean;
  ensureLoaded(): void;
  /** Push a just-saved place (POST success) — newest-first, matching the GET order. */
  addLocal(place: PlaceListItem): void;
  /** Drop a just-deleted place (DELETE success). */
  removeLocal(placeId: string): void;
}

const prefs = loadViewPrefs();

export const usePlacesMapStore = create<PlacesMapState>((set, get) => ({
  onMap: prefs.savedPlacesOnMap ?? true,
  setOnMap: (onMap) => {
    saveViewPref("savedPlacesOnMap", onMap);
    set({ onMap });
    if (onMap) get().ensureLoaded();
  },
  places: [],
  loaded: false,
  ensureLoaded: () => {
    if (get().loaded) return;
    set({ loaded: true }); // single-flight; cleared on transport failure so a retry can run
    fetch("/api/places")
      .then((r) => {
        if (r.status === 401) return { places: [] }; // anonymous — final, don't hammer
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ places?: PlaceListItem[] }>;
      })
      .then((j) => set({ places: j.places ?? [] }))
      .catch(() => set({ loaded: false }));
  },
  addLocal: (place) => set({ places: [place, ...get().places] }),
  removeLocal: (placeId) => set({ places: get().places.filter((p) => p.id !== placeId) }),
}));

// Dev-only introspection (the window.__*Store registry, global.d.ts) — browser verification
// injects saved places without a member session (the endpoint is member-gated).
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__placesStore = usePlacesMapStore;
}
