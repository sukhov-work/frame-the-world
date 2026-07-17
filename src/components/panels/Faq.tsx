import { useEffect, useState } from "react";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import { FAQ_SECTIONS } from "./faqContent";
import "../../styles/faq.css";
import "../../styles/tips.css";

/**
 * FAQ — floating how-it-works panel, top-right (owner ask 2026-07-17). Same nav-toggle +
 * floating-window idiom as Marketplace.tsx (the freshest exemplar): DragGrip, Esc-to-close,
 * inner scroll, open-gated body so the boot cost is one button. Content lives in
 * faqContent.ts (data file); section screenshots are compressed webp under public/faq/,
 * lazy-loaded per open section so the panel never burst-fetches.
 *
 * Accordion: one section open at a time (the shots are tall — a fully-expanded list would
 * scroll forever); the first section starts open as the visitor's entry point.
 */
export default function Faq() {
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(FAQ_SECTIONS[0]?.id ?? null);
  const drag = usePanelDrag("faq");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="fq">
      <button
        className="fq-toggle tip"
        aria-expanded={open}
        data-tip="HOW THE INSTRUMENT WORKS — QUICK ANSWERS."
        data-tip-pos="down"
        onClick={() => setOpen((o) => !o)}
      >
        FAQ
      </button>
      {open && (
        <div className="fq-panel" style={drag.style} role="dialog" aria-label="FAQ">
          <DragGrip drag={drag} label="Move the FAQ" tipPos="left" />
          {/* Scroll on the INNER wrapper — an overflow root would clip the drag grip's
              outside-the-window tab (the uniform-handles rule, owner 2026-07-14). */}
          <div className="fq-scroll">
            <header className="fq-head">
              <span className="fq-title">HOW IT WORKS</span>
              <button className="fq-close" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            <ul className="fq-list">
              {FAQ_SECTIONS.map((s) => {
                const expanded = openId === s.id;
                return (
                  <li key={s.id} className="fq-section">
                    <button
                      className="fq-section-head"
                      aria-expanded={expanded}
                      onClick={() => setOpenId(expanded ? null : s.id)}
                    >
                      <span className="fq-section-title">{s.title}</span>
                      <span className="fq-chevron" aria-hidden="true">
                        {expanded ? "−" : "+"}
                      </span>
                    </button>
                    {expanded && (
                      <div className="fq-section-body">
                        {s.image && (
                          <img className="fq-shot" src={s.image} alt="" loading="lazy" />
                        )}
                        <p className="fq-copy">{s.body}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </span>
  );
}
