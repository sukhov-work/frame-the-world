import { loadViewPrefs } from "../prefs";

/**
 * ULTRA — the BOOT-TIME read of the chip (T45 S5, owner 2026-08-22j).
 *
 * WHY A SECOND READER EXISTS AT ALL. Every ULTRA lever so far is edge-applied: the orchestrator
 * watches the store and re-applies. But three of the shadow levers the owner asked for are
 * CONSTRUCTION-TIME — `renderer.shadowMap.type`, `light.shadow.mapSize` and (if it is ever
 * enabled) `AO.enabled` all recompile every material or reallocate a depth target when flipped
 * live. `ULTRA_PLAN.md` §2 names exactly two sanctioned paths and forbids a third: a lever either
 * lives in `QUALITY.ultraDesktop` (edge-applied) or is **read from the pref at BOOT**. This
 * module is that second path, and it exists so there is ONE of it rather than an inline
 * `localStorage` read in `GlobeCanvas`.
 *
 * THE FENCE IS THE POINT. `ftw:view-prefs:v1` is a single localStorage blob shared by both
 * shells on the same origin, `useCameraStore` is one store, and `/m` mounts the SAME
 * `GlobeCanvas`. A user who turns the chip on at a desktop WILL have `ultraQuality: true` in
 * storage when they next open `/m` in that browser. So the flag may only ever be read through a
 * predicate that also excludes the mobile shell and coarse-pointer hardware — which is why
 * `ultraBootOn()` below is a single expression that cannot be destructured into an ungated read,
 * and why `test/components/globe/fences.test.ts` pins both this file's membership in the
 * allow-list AND that every line naming the flag here also names `ultraShellAllowed`.
 *
 * The predicate is deliberately the SAME two terms as the orchestrator's `hqAllowed`
 * (`StylizedTiles.ts`), which the fence pins literally; a test asserts the two expressions agree
 * term for term, so they cannot drift apart into a shell where one gate opens and the other does
 * not. Both terms are load-bearing: `!isMobileShell` excludes the `/m` ROUTE but not a phone that
 * used `/m`'s DESKTOP chip to pin itself to `/?d=1`, and `!coarsePointerShell` excludes that
 * hardware while leaving a trackpad laptop with a touchscreen on the fine-pointer path.
 *
 * SSR-safe: no `document`/`window` → not allowed (the globe is `client:only`, so this only ever
 * runs in the browser, but a false default is the safe one either way).
 */

/** The shell gate — the boot-time twin of `hqAllowed` in the orchestrator. */
export function ultraShellAllowed(): boolean {
  const isMobileShell =
    typeof document !== "undefined" && document.body.classList.contains("m");
  const coarsePointerShell =
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return typeof window !== "undefined" && !isMobileShell && !coarsePointerShell;
}

/**
 * Is ULTRA on for the CONSTRUCTION-TIME levers, as of this boot?
 *
 * Deliberately a snapshot, not a subscription: a mid-session flip of the chip moves every
 * edge-applied lever immediately but leaves the shadow rig at whatever the page booted with.
 * That is the documented behaviour — a reload reaches full effect — and it is far better than
 * the alternative, which is recompiling every material in the scene on a click.
 */
export function ultraBootOn(): boolean {
  return ultraShellAllowed() && loadViewPrefs().ultraQuality === true;
}

/** Memoized across the session — see `ultraBootSnapshot`. */
let bootSnapshot: boolean | null = null;

/**
 * RC26 — the same boot answer, frozen, so the UI can tell the user what the engine actually did.
 *
 * The chip's construction-time levers (`shadowMap.type`, `shadow.mapSize`, and AO if it is ever
 * enabled) are decided once and cannot follow a live flip, so after a mid-session toggle the
 * scene is running some of ULTRA and not the rest. Nothing surfaced that anywhere: the chip lit
 * up and the shadow rig quietly stayed at the boot profile, which reads as "the feature is
 * weaker than advertised" rather than as "reload for the rest of it".
 *
 * `pref !== ultraBootSnapshot()` is exactly that state. It memoizes on first call rather than
 * re-reading, because the pref moves the moment the user clicks and a later read would answer
 * "what is it now", not "what did we build with". Ordering is safe by construction: the chip
 * lives in the panel, so the panel's first render necessarily precedes any toggle of it.
 */
export function ultraBootSnapshot(): boolean {
  if (bootSnapshot === null) bootSnapshot = ultraBootOn();
  return bootSnapshot;
}
