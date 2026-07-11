/**
 * GL token bridge (ADR D14). The single source of colour for the WebGL scene, so the DOM chrome and
 * the globe never drift apart. SOURCE OF TRUTH is `src/styles/tokens.css` — after a Claude Design
 * import, REGENERATE this file to match those custom properties (see CLAUDE_DESIGN_MEMO.md).
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
  skyDay: '#7FB8E8', // low-altitude day-sky zenith — light blue dome at city zooms
  skyHorizon: '#D8E6F2', // low-altitude horizon haze — near-white aerial perspective
  milkyWay: '#E7E3D8', // faint warm-white galactic band (subtle, near tokens.star)
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
} as const;

export type ThemeTokens = typeof tokens;
