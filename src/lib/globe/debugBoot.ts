import { loadViewPrefs } from "../prefs";

/**
 * DEBUG HUD — the BOOT-TIME read of the `debugHud` pref (T77 MEASURE, 2026-09-05).
 *
 * WHY. The desktop `DBG` chip activates the debug feed through `DebugPanel`'s mount — and that
 * panel is mounted on `index.astro` only, behind `dbgAllowed` (desktop shell + fine pointer).
 * So on `/m`, on a coarse-pointer device and in a release build there was NO way to read a
 * single frame number: the per-frame series never activate and nothing publishes the feed.
 * The iPhone baseline (`rendering/IPHONE_BASELINE_CHECKLIST_2026-09-05.md` §A.3) needs exactly
 * that read — `renderer.info`, the tier, DPR, the resident-model counts — from Safari's console
 * on a real phone, with no CDP and no DEV seams.
 *
 * WHAT. The same sanctioned second path `ultraBoot.ts` uses: the pref is read ONCE at globe
 * construction, and if it is on the feed is activated and `window.__debugFeed` published
 * (`debugFeed.ts` `publishDebugFeedSeam`). Compiled everywhere, inert unless the user set the
 * pref (on `/m` that means a console write to `ftw:view-prefs:v1` + reload — there is no chip),
 * no behaviour: the feed is data written from and read into probes. On the desktop shell the
 * panel and this reader agree by construction — both key off the same pref, and both call the
 * same idempotent `setDebugFeedActive`.
 *
 * SSR-safe: `loadViewPrefs` is (no window → defaults), and the globe is `client:only` anyway.
 */
export function debugHudBootOn(): boolean {
  return loadViewPrefs().debugHud === true;
}
