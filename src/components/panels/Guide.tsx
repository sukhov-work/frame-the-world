import { useEffect, useMemo, useRef, useState } from "react";
import DragGrip, { ResizeGrip, usePanelDrag, usePanelResize } from "../ui/DragGrip";
import {
  GUIDE_CHAPTERS,
  GUIDE_GOALS,
  GUIDE_INDEX,
  type GuideMedia,
  type GuideTopic,
} from "../../lib/guide/guideContent";
import { parseGuideInline } from "../../lib/guide/inline";
import { capPerChapter, markSegments, searchGuide } from "../../lib/guide/search";
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
 * component owns only navigation chrome: chapter rail, topic list, [[crosslink]] jumps, the
 * goal router and its reading routes.
 *
 * Any element with `data-open-guide` (optionally `data-guide-target="<id>"`) opens the panel —
 * the Welcome HOW IT WORKS button uses this, same delegated-DOM idiom as data-open-upload.
 *
 * Deep link: `?guide=<id>` opens straight to a topic. A QUERY param, never a hash — the globe
 * owns and rewrites the whole hash every ~1.6 s (StylizedTiles' pose mirror) and both pose
 * parsers are anchored, so `#p=…&guide=…` would silently boot the default camera.
 */

function Shot({ m }: { m: GuideMedia }) {
  return (
    <figure className={`gd-fig${m.shell === "mobile" ? " gd-fig--m" : ""}`}>
      {/* w/h reserve the box so a lazy image does not shove the copy under it as it
          decodes; `.gd-shot` keeps width:100% + height:auto, so these are ratio hints. */}
      <img className="gd-shot" src={m.src} alt="" loading="lazy" width={m.w} height={m.h} />
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

/** Query terms wrapped in <mark> — the reader sees WHY a row matched. */
function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {markSegments(text, q).map((s, i) => (s.hit ? <mark key={i}>{s.t}</mark> : <span key={i}>{s.t}</span>))}
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
      {t.list && (
        <ul className="gd-list">
          {t.list.map((l, i) => (
            <li key={i}>
              <Inline text={l} onNav={onNav} />
            </li>
          ))}
        </ul>
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
  const [hitIx, setHitIx] = useState(-1);
  // The reading route a goal opened: ids in order + how far along the reader is.
  const [route, setRoute] = useState<{ ids: string[]; ix: number } | null>(null);
  const drag = usePanelDrag("guide");
  // Resizable since batch #4 item 14 (owner 2026-08-21 — supersedes the 2026-08-15e
  // "size is part of the design" ruling).
  const resize = usePanelResize("guide");
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Topic to scroll to once the target chapter has rendered (crosslink / deep-link jumps).
  const pendingTopic = useRef<string | null>(null);
  /**
   * Monotonic navigation counter. THE BUG THIS FIXES: nav() sets pendingTopic then
   * setChapterId(ref.chapterId). Jumping to a topic in the CURRENT chapter writes an
   * identical value, React bails out of the re-render, and the scroll effect — keyed on
   * [chapterId, open] — never re-runs, so nothing scrolls. Two shipped crosslinks hit it.
   * Bumping a counter that is also in the deps makes every nav observable.
   */
  const [navSeq, setNavSeq] = useState(0);

  const nav = (id: string) => {
    const ref = GUIDE_INDEX.get(id);
    if (!ref) return;
    pendingTopic.current = ref.topicId ?? null;
    setOpen(true);
    setChapterId(ref.chapterId);
    setNavSeq((n) => n + 1);
  };

  /** Enter a goal's reading route at step 0. */
  const startRoute = (target: string) => {
    const g = GUIDE_GOALS.find((x) => x.target === target);
    setRoute(g?.route && g.route.length > 1 ? { ids: g.route, ix: 0 } : null);
    nav(target);
  };

  /** Leaving the route's path on purpose (rail, search, GOALS) abandons it. */
  const navFree = (id: string) => {
    setRoute(null);
    nav(id);
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

  // ?guide=<id> deep link. Strip the param — KEEP the #p= pose hash — so a reload does not
  // re-open it and a shared link still carries the camera (the Marketplace ?purchased idiom).
  useEffect(() => {
    const url = new URL(window.location.href);
    const want = url.searchParams.get("guide");
    if (!want) return;
    url.searchParams.delete("guide");
    history.replaceState(null, "", url.toString());
    if (GUIDE_INDEX.has(want)) nav(want);
    else setOpen(true);
  }, []);

  /**
   * Escape, and `/` to search — on the CAPTURE phase.
   *
   * The globe registers its own bubble-phase window keydown whose Escape branch unwinds the
   * sky menu → an armed building → the MAP window → Explore → first-person view. Registration
   * order decided who won, so Escape inside the guide could ALSO drop the reader out of FPV.
   * Capture fires before every bubble-phase window listener regardless of order, so the guide
   * can own the key with zero globe edits — which matters, because "no globe/lib edits" is a
   * per-session done gate for this track.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        // Layered: a non-empty query clears first, only an empty one closes the panel.
        if (query) {
          setQuery("");
          setHitIx(-1);
        } else {
          setOpen(false);
        }
        return;
      }
      if (e.key === "/" && !typing) {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, query]);

  // Focus hygiene for a role="dialog" that was making an unbacked accessibility claim.
  // NOT a focus trap — this window floats over a live globe and must stay non-modal.
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else toggleRef.current?.focus({ preventScroll: true });
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
  }, [chapterId, open, navSeq]);

  const chapter = GUIDE_CHAPTERS.find((c) => c.id === chapterId) ?? GUIDE_CHAPTERS[0];
  const chapterIx = GUIDE_CHAPTERS.indexOf(chapter);
  const next = GUIDE_CHAPTERS[chapterIx + 1];
  const prev = GUIDE_CHAPTERS[chapterIx - 1];
  const q = query.trim();
  const hits = useMemo(() => (q ? capPerChapter(searchGuide(query, 12), 3).slice(0, 8) : []), [q, query]);
  // One object carries everything the footer needs, so `route` never has to be re-narrowed
  // inside JSX (TS cannot follow the narrowing through a derived id alone).
  const routeStep =
    route && route.ix + 1 < route.ids.length
      ? { ids: route.ids, ix: route.ix + 1, next: route.ids[route.ix + 1], of: route.ids.length }
      : null;

  return (
    <span className="gd">
      <button
        ref={toggleRef}
        className="gd-toggle tip"
        aria-expanded={open}
        data-tip="HOW PLUX WORKS — THE FULL TOUR."
        data-tip-pos="down"
        onClick={() => setOpen((o) => !o)}
      >
        Guide
      </button>
      {open && (
        <div className="gd-panel" style={{ ...drag.style, ...resize.style }} role="dialog" aria-label="Guide">
          <DragGrip drag={drag} label="Move the guide" tipPos="left" />
          <ResizeGrip resize={resize} label="Resize the guide" />
          <div className="gd-cols">
            <aside className="gd-rail">
              <span className="gd-title">GUIDE</span>
              <input
                ref={searchRef}
                className="gd-search"
                type="search"
                placeholder="SEARCH…  ( / )"
                aria-label="Search the guide"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHitIx(-1);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" && hits.length > 0) {
                    e.preventDefault();
                    setHitIx((i) => Math.min(i + 1, hits.length - 1));
                  } else if (e.key === "ArrowUp" && hits.length > 0) {
                    e.preventDefault();
                    setHitIx((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter" && hits.length > 0) {
                    e.preventDefault();
                    const pick = hits[hitIx >= 0 ? hitIx : 0];
                    setQuery("");
                    setHitIx(-1);
                    navFree(pick.id);
                  }
                }}
              />
              {q ? (
                <div className="gd-hits">
                  <span className="gd-hitcount" aria-live="polite">
                    {hits.length === 0 ? "NO MATCHES" : `${hits.length} RESULT${hits.length === 1 ? "" : "S"}`}
                  </span>
                  {hits.map((h, i) => (
                    <button
                      key={h.id}
                      type="button"
                      className={`gd-hit${i === hitIx ? " is-cur" : ""}`}
                      onClick={() => {
                        setQuery("");
                        setHitIx(-1);
                        navFree(h.id);
                      }}
                    >
                      <span className="gd-hit__title">
                        <Marked text={h.title} q={query} />
                        <span className={`gd-hit__kind gd-hit__kind--${h.kind}`}>
                          {h.kind === "chapter" ? "CH" : "TOPIC"}
                        </span>
                      </span>
                      <span className="gd-hit__ch">{h.chapterTitle}</span>
                      {h.snip && (
                        <span className="gd-hit__snip">
                          <Marked text={h.snip} q={query} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                GUIDE_CHAPTERS.map((c) => (
                  <div key={c.id} className="gd-railgroup">
                    <button
                      type="button"
                      className={`gd-railbtn${c.id === chapter.id ? " is-on" : ""}`}
                      onClick={() => navFree(c.id)}
                    >
                      {c.title}
                    </button>
                    {/* Topic tier — the rail listed 11 chapters and hid 67 topics behind
                        them. Only the open chapter expands, so the rail stays scannable. */}
                    {c.id === chapter.id && (
                      <div className="gd-railtopics">
                        {c.topics.map((t) => (
                          <button key={t.id} type="button" className="gd-railtopic" onClick={() => nav(t.id)}>
                            {t.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </aside>
            {/* Scroll on the INNER wrapper — an overflow root would clip the grips'
                outside-the-window tabs (the uniform-handles rule, owner 2026-07-14). */}
            <div className="gd-scroll" ref={scrollRef}>
              <header className="gd-head">
                <span className="gd-chtitle">{chapter.title}</span>
                <span className="gd-headtools">
                  {/* The goal router only ever renders inside START; this is how a reader
                      three chapters deep gets back to it without hunting for the rail. */}
                  <button
                    className="gd-goalsback tip"
                    onClick={() => navFree("start")}
                    data-tip="BACK TO WHAT DO YOU WANT TO DO?"
                    data-tip-pos="left"
                  >
                    ↺ GOALS
                  </button>
                  {/* The same content as a standalone document — /guide (pages/guide.astro). */}
                  <a
                    className="gd-pagelink tip"
                    href={`/guide#${chapter.id}`}
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
                      <button type="button" className="gd-goal" onClick={() => startRoute(g.target)}>
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
              {routeStep && (
                <button
                  type="button"
                  className="gd-next gd-next--route"
                  onClick={() => {
                    setRoute({ ids: routeStep.ids, ix: routeStep.ix });
                    nav(routeStep.next);
                  }}
                >
                  STEP {routeStep.ix + 1} OF {routeStep.of} · {GUIDE_INDEX.get(routeStep.next)?.title} →
                </button>
              )}
              <div className="gd-seq">
                {prev && (
                  <button type="button" className="gd-next gd-prev" onClick={() => navFree(prev.id)}>
                    ← PREV · {prev.title}
                  </button>
                )}
                {next && (
                  <button type="button" className="gd-next" onClick={() => navFree(next.id)}>
                    NEXT · {next.title} →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
