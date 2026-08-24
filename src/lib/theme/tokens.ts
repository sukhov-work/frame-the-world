/**
 * GL token bridge (ADR D14). The single source of colour for the WebGL scene, so the DOM chrome and
 * the globe never drift apart. SOURCE OF TRUTH is `src/styles/tokens.css` — after a Claude Design
 * import, REGENERATE this file to match those custom properties (see provenance/CLAUDE_DESIGN_MEMO.md).
 *
 * Reconciled from the Claude Design project "Frame the World" board "00 · DESIGN SYSTEM" (2026-07-10).
 * Chrome tokens mirror tokens.css; globe tokens (land..star) are the FENCED, browser-tuned render palette.
 */
export const tokens = {
  bg: '#05070B', // near-black deep space
  surface: '#12161C',
  border: '#232935',
  textPrimary: '#E8ECF2',
  textSecondary: '#9AA4B2',
  textMuted: '#5B6472',
  accent: '#38E1D0', // luminous cyan-teal — pin emissive / frustum / active states (RESERVED for signal)
  accent600: '#2FD1C4', // accent hover / pressed — pin focus, active frustum edge
  warn: '#E8A268', // past/swept-already amber (scrubber language; bridged for the U4 aim cones)
  timeFuture: '#7CB0F5', // future/still-to-come blue — the cool twin of warn (U4 aim cones)
  focalCone: '#E08FC6', // planned-shot focal cone (batch #4 S2) — orchid-rose, outside every
  // radar ink family (accent/sunGlow/moonDial/past-grey/future-blue/pinLavender)
  land: '#53655C', // sage-slate — continent fill (design hue #7A8E84 at cartographic lightness)
  landHi: '#687D73', // rolling-terrain relief + OSM building emissive tint
  peak: '#8FA097', // high-terrain sheen + OSM building fill (light sage, not blown-out)
  water: '#0C1822', // deep near-black ocean (design-darkened; still separates from bg in space)
  atmosphere: '#38E1D0', // limb halo, tight bright lobe — cyan-teal per brief
  atmosphereDeep: '#4A93D4', // limb halo, broad soft lobe — Rayleigh blue + day-side limb scattering
  graticule: '#2F4045', // neutral teal-grey lat/lon grid line
  star: '#DDE6F2', // cool near-white starfield
  cityLights: '#FFC36E', // night-side VIIRS city lights — warm sodium, geographically real
  goldenHour: '#FFB865', // warm sun-driven tint
  sunCore: '#FFF3D9', // solar disc — warm white (bloom carries the blowout)
  sunGlow: '#FFD9A0', // solar halo / corona falloff — warmer than the disc
  moonlight: '#BFD0E8', // cool moonlight fill on the night side (intensity by phase)
  eclipseUmbra: '#8C2F14', // eclipsed moon inside Earth's umbra — Danjon L=2 deep copper-red
  eclipseChromo: '#FF6A55', // chromosphere/prominence hairline at a total solar eclipse's limb
  moonDial: '#DDE3EA', // U4 aim surfaces — the moon's dial/edge SILVER (owner 2026-08-18:
  // moonlight's blue-grey sat too close to the textSecondary past-sector grey on the map)
  skyDay: '#7FB8E8', // low-altitude day-sky zenith — light blue dome at city zooms
  skyHorizon: '#D8E6F2', // low-altitude horizon haze — near-white aerial perspective
  milkyWay: '#E7E3D8', // faint warm-white galactic band (subtle, near tokens.star)
  cometComa: '#9FF3C8', // comet coma — the real C2/CN green of an active nucleus
  cometTail: '#8FD8FF', // comet ion tail — cold plasma blue, anti-sunward
  // Vector map ink (S7 feedback batch) — the close-zoom street/water web (map ink, not signal)
  vecRoadMajor: '#A7B4C4', // motorway/trunk/primary — bright steel strokes
  vecRoadMinor: '#5F6B7A', // residential/service web — dim slate
  vecWater: '#3E6E96', // rivers/lakes fill + waterway lines — steel blue on near-black
  vecGreen: '#2E4A3A', // parks/grass/wood fill — muted sage
  vecBridge: '#C6D2DE', // bridges — brightest ink + a lift
  // Per-author pin hues (Phase 5.5 S4) — restrained cool family; hash(authorName) picks one
  // (weights live in globe tuning — tuning names tokens, tokens name colours, D14).
  pinTeal: '#38E1D0', // the anchor — accent hue (pins ARE signal; anonymous fallback)
  pinIce: '#7CC4F2', // ice blue
  pinMint: '#7FE8B4', // mint
  pinLavender: '#B0A6F0', // lavender
  pinWarm: '#E8BC7A', // the rare warm voice (near warn, softened)
  // BEST SPOT heat ramp — INFERNO (SPEC_V2 §6.1), the shipping scale. The one sanctioned rainbow,
  // because it is QUANTITATIVE and read by LIGHTNESS: strictly monotone in OKLab L across all 11
  // stops (0.0482 → 0.9777). `lib/theme/heatPalette.ts` turns these into the 256-entry sheet LUT.
  heat0: '#000004', // t 0.0 — near-black floor ("not here")
  heat1: '#160B39', // t 0.1 — deep indigo
  heat2: '#420A68', // t 0.2 — violet
  heat3: '#6A176E', // t 0.3 — plum
  heat4: '#932667', // t 0.4 — magenta
  heat5: '#BC3754', // t 0.5 — crimson
  heat6: '#DD513A', // t 0.6 — ember red
  heat7: '#F37819', // t 0.7 — orange
  heat8: '#FCA50A', // t 0.8 — amber
  heat9: '#F6D746', // t 0.9 — gold
  heat10: '#FCFFA4', // t 1.0 — pale straw peak ("stand here")
  // BEST SPOT heat ramp — TURBO, A/B CHIP ONLY. NOT monotone in lightness (OKLab L peaks 0.9036 at
  // t 0.5 and falls to 0.3662), so the best spot goes dark red — see the warning in tokens.css.
  // Derived from Google's canonical 256-entry turbo_srgb_floats table; provenance in tokens.css.
  heatAlt0: '#30123B', // t 0.0 — indigo
  heatAlt1: '#455ACD', // t 0.1 — blue
  heatAlt2: '#3E9BFE', // t 0.2 — azure
  heatAlt3: '#19D6CC', // t 0.3 — cyan
  heatAlt4: '#46F884', // t 0.4 — spring green
  heatAlt5: '#A3FD3C', // t 0.5 — chartreuse (Turbo's lightness peak, not its top)
  heatAlt6: '#E1DD37', // t 0.6 — yellow
  heatAlt7: '#FEA531', // t 0.7 — amber
  heatAlt8: '#F05B12', // t 0.8 — orange
  heatAlt9: '#C42503', // t 0.9 — red
  heatAlt10: '#7A0403', // t 1.0 — dark maroon (the peak, reading as the floor)
} as const;
