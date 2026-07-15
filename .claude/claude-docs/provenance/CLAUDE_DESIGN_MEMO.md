
use Claude Design as a design-system factory and motion spec generator, wired to your repo through the handoff bundle and mcp commands (below) for round-trip. Don't use it as a code generator for the globe itself. The product is built for exactly this split: Claude Design handles the visual decisions; Claude Code handles the integration into your actual codebase.

Take the exported tokens verbatim into one source of truth (tokens.css + Tailwind config), then have the three.js scene read the same values at init: accent hex → pin emissive and frustum color, background hex → fog/space backdrop, golden-hour tint → sky shader grade. Without this bridge the DOM chrome and the WebGL scene drift apart, and no design tool will catch it.

Sort outputs into three buckets. Verbatim: tokens, type scale, component states. Port-with-audit: panel/card/pricing HTML+CSS, since exported code works, but must be audited for security, scalability, accessibility, SEO, and testing. Spec-only: the globe hero and zoom choreography. Claude Design can build code-powered prototypes with voice, video, shaders, 3D and built-in AI, so prototype the cinematic LEO feel and the 2.2s pin flight there to lock durations and easings, then reimplement in 3d-tiles-renderer. Never port prototype globe code.

Tokens first, once (Phase 1). After npm create @wix/new lands, one session: "Import the design system from my Claude Design project 'Frame the World' into this repo as src/styles/tokens.css + Tailwind config." The sync flow proposes a file plan (writes/deletes) that you approve before anything touches disk, so review it there. [reported behavior, third-party writeup] Immediately after, generate the GL bridge (src/lib/theme/tokens.ts) so the globe consumes the same values (D14).
Screens per phase, not a bulk dump. Pull one screen aligned to the phase you're in: detail overlay + EXIF panel + time scrubber for Phase 3, gallery/auth/pricing for Phase 5, marketplace for Phase 6. Instruct conversion to Astro/React islands wired to zustand + Wix SDK; exported code isn't production-ready as-is, so treat each import as port-with-audit.
Push reality back. After implementing a screen against real constraints (quota states, Wix checkout skin), push the implemented state back to the canvas so future design iterations start from what shipped. And remember it's snapshot semantics: the sync does not watch your repository, so re-run after any token or component change. [VERIFIED]
Fence the globe. Never let a design import write into components/globe/** or lib/**; the canvas globe prototype is motion spec only. Enforce it in CLAUDE.md rather than per-session memory:

## Claude Design MCP working agreements
- Design project: "Frame the World" (claude.ai/design/p/fb0d7afa-8a4f-4b2f-9a59-517fb1eeb46c)
- Tokens source of truth: src/styles/tokens.css (+ tailwind.config).
  After any design import, regenerate src/lib/theme/tokens.ts (GL bridge).
- Design imports may write ONLY under src/components/panels/**,
  src/components/ui/**, src/styles/**. NEVER globe/** or lib/**.
- One screen per import session; convert to Astro/React islands using
  existing components; no new dependencies from design exports.
- After implementing a screen, push implemented state back to the canvas.
- Review the proposed file plan before approving any sync write.