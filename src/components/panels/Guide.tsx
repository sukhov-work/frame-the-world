import { useEffect, useRef, useState } from "react";
import DragGrip, { usePanelDrag } from "../ui/DragGrip";
import {
  GUIDE_CHAPTERS,
  GUIDE_GOALS,
  GUIDE_INDEX,
  type GuideMedia,
  type GuideTopic,
} from "../../lib/guide/guideContent";
import { parseGuideInline } from "../../lib/guide/inline";
import { searchGuide } from "../../lib/guide/search";
import "../../styles/guide.css";
import "../../styles/tips.css";

/**
 * GUIDE — the in-app user guide, desktop shell (guide track G1, owner order 2026-08-15).
 * Replaces the FAQ panel (absorbed: one help system, per GUIDE_PLAN's no-two-systems rule).
 * Same nav-toggle + floating-window idiom as Faq/Marketplace, upgraded to the PLAN/FIND
 * resizable-window class: DragGrip + ResizeGrip, Esc-to-close, inner scroll, open-gated body.
 *
 * Content is the shared module src/lib/guide/guideContent.ts — the /m GuideSheet renders the
 * SAME data (two shells, one source; the mobile fence keeps the renderers separate). This
 * component owns only navigation chrome: chapter rail, [[crosslink]] jumps, the goal router.
 *
 * Any element with `data-open-guide` (optionally `data-guide-target="<id>"`) opens the panel —
 * the Welcome HOW IT WORKS button uses this, same delegated-DOM idiom as data-open-upload.
 */

function Shot({ m }: { m: GuideMedia }) {
  return (
    <figure className={`gd-fig${m.shell === "mobile" ? " gd-fig--m" : ""}`}>
      <img className="gd-shot" src={m.src} alt="" loading="lazy" />
      {m.caption && <figcaption className="gd-cap">{m.caption}</figcaption>}
    </figure>
  );
}

function Inline({ text, onNav }: { text: string; onNav: (id: string) => void }) {
  return (
    <>
      {parseGuideInline(text).map((run, i) =>
        run.kind === "text" ? (
          <span key={i}>{run.text}</span>
        ) : (
          <button key={i} type="button" className="gd-link" onClick={() => onNav(run.target)}>
            {run.label ?? GUIDE_INDEX.get(run.target)?.title ?? run.target}
          </button>
        ),
      )}
    </>
  );
}

function Topic({ t, onNav }: { t: GuideTopic; onNav: (id: string) => void }) {
  return (
    <section className="gd-topic" data-gd-topic={t.id}>
      <h4 className="gd-ttitle">{t.title}</h4>
      {t.where && (
        <div className="gd-where">
          {t.where.desktop && (
            <span>
              <b>DESKTOP</b> {t.where.desktop}
            </span>
          )}
          {t.where.mobile && (
            <span>
              <b>PHONE</b> {t.where.mobile}
            </span>
          )}
        </div>
      )}
      {t.body && (
        <p className="gd-body">
          <Inline text={t.body} onNav={onNav} />
        </p>
      )}
      {t.steps && (
        <ol className="gd-steps">
          {t.steps.map((s, i) => (
            <li key={i}>
              <Inline text={s} onNav={onNav} />
            </li>
          ))}
        </ol>
      )}
      {t.tip && (
        <p className="gd-tip">
          <Inline text={t.tip} onNav={onNav} />
        </p>
      )}
      {t.media?.map((m) => <Shot key={m.src} m={m} />)}
    </section>
  );
}

export default function Guide() {
  const [open, setOpen] = useState(false);
  const [chapterId, setChapterId] = useState(GUIDE_CHAPTERS[0].id);
  // Embedded BM25+fuzzy search (owner 2026-08-19) — while a query is typed, the rail
  // swaps its chapter list for ranked hits; picking one clears the query and jumps.
  const [query, setQuery] = useState("");
  const drag = usePanelDrag("guide");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Topic to scroll to once the target chapter has rendered (crosslink / deep-link jumps).
  const pendingTopic = useRef<string | null>(null);

  const nav = (id: string) => {
    const ref = GUIDE_INDEX.get(id);
    if (!ref) return;
    pendingTopic.current = ref.topicId ?? null;
    setOpen(true);
    setChapterId(ref.chapterId);
  };

  // Delegated opener — Welcome's HOW IT WORKS (and any future data-open-guide host).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-open-guide]");
      if (!el) return;
      e.preventDefault();
      const target = el.getAttribute("data-guide-target");
      if (target && GUIDE_INDEX.has(target)) nav(target);
      else setOpen(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // After a chapter switch, land on the requested topic (or the top).
  useEffect(() => {
    const host = scrollRef.current;
    if (!host) return;
    const id = pendingTopic.current;
    pendingTopic.current = null;
    if (id) {
      const el = host.querySelector(`[data-gd-topic="${id}"]`);
      if (el) {
        (el as HTMLElement).scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
        el.classList.add("gd-topic--hit");
        setTimeout(() => el.classList.remove("gd-topic--hit"), 1600);
        return;
      }
    }
    host.scrollTop = 0;
  }, [chapterId, open]);

  const chapter = GUIDE_CHAPTERS.find((c) => c.id === chapterId) ?? GUIDE_CHAPTERS[0];
  const chapterIx = GUIDE_CHAPTERS.indexOf(chapter);
  const next = GUIDE_CHAPTERS[chapterIx + 1];

  return (
    <span className="gd">
      <button
        className="gd-toggle tip"
        aria-expanded={open}
        data-tip="HOW PLUX WORKS — THE FULL TOUR."
        data-tip-pos="down"
        onClick={() => setOpen((o) => !o)}
      >
        Guide
      </button>
      {open && (
        <div className="gd-panel" style={drag.style} role="dialog" aria-label="Guide">
          <DragGrip drag={drag} label="Move the guide" tipPos="left" />
          <div className="gd-cols">
            <aside className="gd-rail">
              <span className="gd-title">GUIDE</span>
              <input
                className="gd-search"
                type="search"
                placeholder="SEARCH…"
                aria-label="Search the guide"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Esc clears the query first — only an empty search lets it close the panel.
                  if (e.key === "Escape" && query) {
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
              />
              {query.trim() ? (
                (() => {
                  const hits = searchGuide(query);
                  return hits.length > 0 ? (
                    hits.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className="gd-hit"
                        onClick={() => {
                          setQuery("");
                          nav(h.id);
                        }}
                      >
                        <span className="gd-hit__title">{h.title}</span>
                        <span className="gd-hit__ch">{h.chapterTitle}</span>
                        {h.snip && <span className="gd-hit__snip">{h.snip}</span>}
                      </button>
                    ))
                  ) : (
                    <span className="gd-nohit">NO MATCHES</span>
                  );
                })()
              ) : (
                GUIDE_CHAPTERS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`gd-railbtn${c.id === chapter.id ? " is-on" : ""}`}
                    onClick={() => nav(c.id)}
                  >
                    {c.title}
                  </button>
                ))
              )}
            </aside>
            {/* Scroll on the INNER wrapper — an overflow root would clip the grips'
                outside-the-window tabs (the uniform-handles rule, owner 2026-07-14). */}
            <div className="gd-scroll" ref={scrollRef}>
              <header className="gd-head">
                <span className="gd-chtitle">{chapter.title}</span>
                <span className="gd-headtools">
                  {/* The same content as a standalone document — /guide (pages/guide.astro). */}
                  <a
                    className="gd-pagelink tip"
                    href="/guide"
                    target="_blank"
                    rel="noopener"
                    data-tip="OPEN THE GUIDE AS ITS OWN PAGE."
                    data-tip-pos="left"
                  >
                    ↗
                  </a>
                  <button className="gd-close" aria-label="Close" onClick={() => setOpen(false)}>
                    ×
                  </button>
                </span>
              </header>
              <p className="gd-lead">
                <Inline text={chapter.lead} onNav={nav} />
              </p>
              {chapter.id === "start" && (
                <ul className="gd-goals">
                  {GUIDE_GOALS.map((g) => (
                    <li key={g.target + g.goal}>
                      <button type="button" className="gd-goal" onClick={() => nav(g.target)}>
                        <span>{g.goal}</span>
                        <span className="gd-goal-arrow" aria-hidden="true">
                          →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {chapter.media && <Shot m={chapter.media} />}
              {chapter.topics.map((t) => (
                <Topic key={t.id} t={t} onNav={nav} />
              ))}
              {next && (
                <button type="button" className="gd-next" onClick={() => nav(next.id)}>
                  NEXT · {next.title} →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
