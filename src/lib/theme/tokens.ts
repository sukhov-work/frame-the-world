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
  land: '#38495B', // cool slate — continent fill on the stylized globe
  landHi: '#4E6072', // rolling-terrain relief + OSM building tint
  peak: '#7C8EA0', // high-terrain sheen (Himalaya/Andes/ice)
  water: '#0F2233', // deep blue-slate ocean (reads as a sphere against deep space)
  atmosphere: '#38E1D0', // limb-glow halo — cyan-teal per brief (swap to #4A93D4 Rayleigh blue to free the accent)
  graticule: '#2A3E4E', // neutral cool lat/lon grid line
  star: '#DDE6F2', // cool near-white starfield
  goldenHour: '#FFB865', // warm sun-driven tint
} as const;

export type ThemeTokens = typeof tokens;
