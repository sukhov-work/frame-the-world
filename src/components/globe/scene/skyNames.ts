import { tokens } from "../../../lib/theme/tokens";
import { ASTERISMS, SKYNAMES } from "../tuning";
import {
  buildHoverIndex,
  hitTestNames,
  type HoverFigureIn,
  type HoverNameHit,
  type HoverNameIndex,
  type Vec3,
} from "../../../lib/sky/hoverNames";

/**
 * Sky hover-name reveal (qol4, owner 2026-08-14: "when hover over asterisms and constellations —
 * reveal (very gently) their names, same for important stars"). A DOM label layer owned by this
 * module — the geoLabels discipline (NOT a React island: the label re-anchors to the cursor at
 * hover cadence via direct style writes, and GL sprite text would forfeit the design fonts).
 *
 * The heavy catalogs (lib/sky/starNames + constellations are lazyContract HEAVY; the figure
 * assets are public/data JSON) load ON FIRST ELIGIBLE HOVER — a night-sky mouse move — never at
 * boot. Hit-testing itself is pure maths in lib/sky/hoverNames (tested twin).
 *
 * The orchestrator (stepSkyHover) owns cadence, easing, the night gate and body-hover
 * arbitration; this module owns loading + the DOM.
 */
export interface SkyNamesHandle {
  /** Kick the lazy catalog load (idempotent). Call on the first eligible hover frame. */
  ensureLoaded(): void;
  /** Hit-test a J2000 unit direction; null until the catalogs arrive (no await — a miss now
   *  becomes a hit on the next cadence tick once loading settles). */
  hitAt(dirJ2000: Vec3, includeAsterisms: boolean): HoverNameHit | null;
  /** Place/refresh the label near the cursor (client px) at the given eased opacity. */
  show(hit: HoverNameHit, clientX: number, clientY: number, alpha: number): void;
  /** Fade target reached zero — hide the label entirely. */
  hide(): void;
  dispose(): void;
}

export function attachSkyNames(): SkyNamesHandle {
  const layer = document.createElement("div");
  layer.className = "sky-names"; // welcome.css hides .geo-labels-style chrome; same discipline
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2;";
  document.body.appendChild(layer);

  const el = document.createElement("div");
  el.style.cssText =
    "position:absolute;left:0;top:0;white-space:nowrap;display:none;" +
    "font-family:var(--font-ui,sans-serif);text-transform:uppercase;" +
    `letter-spacing:0.16em;color:${tokens.textSecondary};` +
    `text-shadow:0 0 6px ${tokens.bg},0 0 2px ${tokens.bg};`;
  const nameEl = document.createElement("div");
  nameEl.style.cssText = "font:600 0.65rem var(--font-ui,sans-serif);letter-spacing:0.16em;";
  const subEl = document.createElement("div");
  subEl.style.cssText =
    "font:500 0.52rem var(--font-ui,sans-serif);letter-spacing:0.14em;opacity:0.62;margin-top:1px;";
  el.appendChild(nameEl);
  el.appendChild(subEl);
  layer.appendChild(el);

  let index: HoverNameIndex | null = null;
  let loading = false;

  const load = async () => {
    try {
      // HEAVY modules by contract (test/lib/sky/lazyContract) — dynamic import only.
      const [{ STAR_NAMES }, { CONSTELLATIONS }, asterismsRaw, figuresRaw] = await Promise.all([
        import("../../../lib/sky/starNames"),
        import("../../../lib/sky/constellations"),
        fetch(ASTERISMS.url).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)),
        ),
        fetch(ASTERISMS.figuresUrl).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)),
        ),
      ]);
      const conNames: Record<string, string> = {};
      for (const c of CONSTELLATIONS) conNames[c.abbr] = c.name;
      const constellationFigures: HoverFigureIn[] = (
        figuresRaw as { figures: { abbr: string; lines: [number, number][][] }[] }
      ).figures.map((f) => ({ name: conNames[f.abbr] ?? f.abbr, lines: f.lines }));
      index = buildHoverIndex(
        {
          stars: STAR_NAMES,
          conNames,
          asterisms: (asterismsRaw as { asterisms: HoverFigureIn[] }).asterisms,
          constellationFigures,
          anchors: CONSTELLATIONS,
        },
        {
          maxVmag: SKYNAMES.maxVmag,
          starHitBrightDeg: SKYNAMES.starHitBrightDeg,
          starHitFaintDeg: SKYNAMES.starHitFaintDeg,
        },
      );
    } catch (e) {
      console.warn("[globe] sky-name catalogs unavailable:", e);
      loading = false; // allow a retry on the next eligible hover
    }
  };

  return {
    ensureLoaded() {
      if (index || loading) return;
      loading = true;
      void load();
    },
    hitAt(dirJ2000, includeAsterisms) {
      if (!index) return null;
      return hitTestNames(index, dirJ2000, {
        includeAsterisms,
        figureHitDeg: SKYNAMES.figureHitDeg,
        anchorHitDeg: SKYNAMES.anchorHitDeg,
      });
    },
    show(hit, clientX, clientY, alpha) {
      if (nameEl.textContent !== hit.name) nameEl.textContent = hit.name;
      const sub = hit.sub ?? (hit.kind === "asterism" ? "asterism" : "");
      if (subEl.textContent !== sub) subEl.textContent = sub;
      subEl.style.display = sub ? "block" : "none";
      el.style.transform = `translate(${(clientX + SKYNAMES.offsetPx[0]).toFixed(1)}px, ${(clientY + SKYNAMES.offsetPx[1]).toFixed(1)}px)`;
      el.style.opacity = String(alpha * SKYNAMES.alpha);
      el.style.display = "block";
    },
    hide() {
      el.style.display = "none";
    },
    dispose() {
      layer.remove();
    },
  };
}
