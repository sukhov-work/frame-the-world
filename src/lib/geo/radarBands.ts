/**
 * THE radar band model — one allocation, three surfaces (audit #3 A1-7 → T35, 2026-08-22).
 *
 * The concentric annular bands (owner batch #4 S2, reordered + compacted batch #6) are drawn by
 * the GL fan (`scene/aimCones`), the expanded chart (`panels/MapWindow`) and the FPV mini-map
 * (`panels/MiniMap`). `AIMCONES` was always the single source of the NUMBERS, but the mapping
 * from body → band, and the /m inward shift that goes with it, shipped as THREE hand-maintained
 * `bandFor` copies with no cross-file fence — plus two copies of the future-ink rule. Track E's
 * jscpd only saw the tip of it; the audit quantified the rest.
 *
 * Extract-then-delegate (Gall): the bodies below are byte-for-byte what `scene/aimCones`
 * shipped. `aimCones` re-exports them so its own consumers are unchanged, and the two panels
 * import from here instead of re-declaring. `test/lib/geo/radarBands.test.ts` fences the copies
 * from coming back.
 *
 * Pure and three-free — `lib/` may hold the model, `scene/` holds the geometry that draws it.
 */

import { AIMCONES } from "../../components/globe/tuning";
import { tokens } from "../theme/tokens";

/** The three bodies a radar surface can carry a band for. */
export type RadarBandKey = "target" | "sun" | "moon";

/** Per-body annular band `[inner, outer]` as unit-radius fractions. On /m the whole stack sits
 *  ~20 % closer to the centre (owner batch #5 item 2) — same widths and same order. */
export function bandFor(key: RadarBandKey, mobile = false): readonly [number, number] {
  return key === "sun"
    ? mobile
      ? AIMCONES.bandSunMobile
      : AIMCONES.bandSun
    : key === "moon"
      ? mobile
        ? AIMCONES.bandMoonMobile
        : AIMCONES.bandMoon
      : mobile
        ? AIMCONES.bandTargetMobile
        : AIMCONES.bandTarget;
}

/** Band FUTURE ink per body (owner item 17, 2026-08-21b): the sun/moon bands wear their BODY
 *  colour on the still-to-come part (sunGlow / moonDial silver) against the shared inert-grey
 *  past; the target band keeps the scrubber future-blue. */
export function bandFutureInk(key: RadarBandKey): string {
  return key === "sun" ? tokens.sunGlow : key === "moon" ? tokens.moonDial : tokens.timeFuture;
}
