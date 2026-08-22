/**
 * GuideSheet — the /m twin of the desktop GUIDE panel (guide track G1, 2026-08-15).
 * Renders the SAME content module (src/lib/guide/guideContent.ts) with its own markup —
 * the two-shell discipline: libs are the shared surface, desktop panels are never imported
 * (mobileFence.test.ts). Two views: the chapter index (goal router on top) and one chapter;
 * [[crosslinks]] navigate inside the sheet.
 *
 * Search is hoisted ABOVE the index/chapter split (parity fix 2026-08-22g) — it used to exist
 * only on the index view, so a reader inside a chapter had to back out to search at all.
 *
 * `seedTopic` is the ?guide=<id> deep link, resolved by MobileShell: this component mounts
 * only while its sheet is open, so it cannot read the URL itself.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GUIDE_CHAPTERS,
  GUIDE_GOALS,
  GUIDE_INDEX,
  type GuideMedia,
  type GuideTopic,
} from "../../lib/guide/guideContent";
import { parseGuideInline } from "../../lib/guide/inline";
import { capPerChapter, markSegments, searchGuide } from "../../lib/guide/search";
import { useSheetInputFocus } from "./useSheetInputFocus";
import "../../styles/mobile/chrome.css";

function Shot({ m }: { m: GuideMedia }) {
  return (
    <figure className={`m-gfig${m.shell === "mobile" ? " m-gfig--m" : ""}`}>
      {/* w/h reserve the box (see Guide.tsx Shot) — `.m-gshot` keeps width:100%/height:auto.
          The anchor is the /m half of tap-to-enlarge: these render at ~62% of a ~360px
          sheet, so the shot really IS downscaled here (it is not on desktop). */}
      <a href={m.src} target="_blank" rel="noopener">
        <img className="m-gshot" src={m.src} alt="" loading="lazy" width={m.w} height={m.h} />
      </a>
      {m.caption && <figcaption className="m-gcap">{m.caption}</figcaption>}
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
          <button key={i} type="button" className="m-glink" onClick={() => onNav(run.target)}>
            {run.label ?? GUIDE_INDEX.get(run.target)?.title ?? run.target}
          </button>
        ),
      )}
    </>
  );
}

/** Query terms wrapped in <mark> — the desktop rail's twin. */
function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {markSegments(text, q).map((s, i) => (s.hit ? <mark key={i}>{s.t}</mark> : <span key={i}>{s.t}</span>))}
    </>
  );
}

function Topic({ t, onNav }: { t: GuideTopic; onNav: (id: string) => void }) {
  return (
    <section className="m-gtopic" data-gd-topic={t.id}>
      <h4 className="m-gtitle">{t.title}</h4>
      {t.where && (
        <div className="m-gwhere">
          {t.where.mobile && (
            <span>
              <b>HERE</b> {t.where.mobile}
            </span>
          )}
          {t.where.desktop && (
            <span>
              <b>DESKTOP</b> {t.where.desktop}
            </span>
          )}
        </div>
      )}
      {t.body && (
        <p className="m-gbody">
          <Inline text={t.body} onNav={onNav} />
        </p>
      )}
      {t.list && (
        <ul className="m-glist">
          {t.list.map((l, i) => (
            <li key={i}>
              <Inline text={l} onNav={onNav} />
            </li>
          ))}
        </ul>
      )}
      {t.steps && (
        <ol className="m-gsteps">
          {t.steps.map((s, i) => (
            <li key={i}>
              <Inline text={s} onNav={onNav} />
            </li>
          ))}
        </ol>
      )}
      {t.tip && (
        <p className="m-gtip">
          <Inline text={t.tip} onNav={onNav} />
        </p>
      )}
      {t.media?.map((m) => <Shot key={m.src} m={m} />)}
    </section>
  );
}

export default function GuideSheet({ seedTopic }: { seedTopic?: string | null }) {
  const [chapterId, setChapterId] = useState<string | null>(null);
  // Embedded BM25+fuzzy search (owner 2026-08-19) — typing swaps the view for ranked hits;
  // tapping one clears the query and drills in.
  const [query, setQuery] = useState("");
  const [route, setRoute] = useState<{ ids: string[]; ix: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingTopic = useRef<string | null>(null);
  /** See Guide.tsx — same-chapter navigation writes an identical chapterId and React bails,
   *  so the scroll effect needs a monotonic counter in its deps to fire at all. */
  const [navSeq, setNavSeq] = useState(0);

  // /m focus must route through this hook: the fence fails any bare `autoFocus` under
  // components/mobile/**, and any .focus() without preventScroll (the iOS dark-screen bug).
  useSheetInputFocus(searchRef);

  const nav = (id: string) => {
    const ref = GUIDE_INDEX.get(id);
    if (!ref) return;
    pendingTopic.current = ref.topicId ?? null;
    setChapterId(ref.chapterId);
    setNavSeq((n) => n + 1);
  };

  const startRoute = (target: string) => {
    const g = GUIDE_GOALS.find((x) => x.target === target);
    setRoute(g?.route && g.route.length > 1 ? { ids: g.route, ix: 0 } : null);
    nav(target);
  };

  const navFree = (id: string) => {
    setRoute(null);
    nav(id);
  };

  // ?guide=<id>, resolved by MobileShell and handed down — this sheet mounts only when open.
  useEffect(() => {
    if (seedTopic && GUIDE_INDEX.has(seedTopic)) nav(seedTopic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedTopic]);

  // After a chapter renders, land on the crosslinked topic (the Sheet body owns the scroll).
  useEffect(() => {
    const id = pendingTopic.current;
    pendingTopic.current = null;
    const host = hostRef.current;
    if (!host) return;
    const scroller = host.closest(".m-sheet__body") ?? host;
    if (id) {
      const el = host.querySelector(`[data-gd-topic="${id}"]`);
      if (el) {
        (el as HTMLElement).scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
        return;
      }
    }
    scroller.scrollTop = 0;
  }, [chapterId, navSeq]);

  const chapter = chapterId ? GUIDE_CHAPTERS.find((c) => c.id === chapterId) : null;
  const q = query.trim();
  const hits = useMemo(() => (q ? capPerChapter(searchGuide(query, 12), 3).slice(0, 8) : []), [q, query]);
  const chapterIx = chapter ? GUIDE_CHAPTERS.indexOf(chapter) : -1;
  const next = chapterIx >= 0 ? GUIDE_CHAPTERS[chapterIx + 1] : undefined;
  const prev = chapterIx > 0 ? GUIDE_CHAPTERS[chapterIx - 1] : undefined;
  // See Guide.tsx — one object so `route` never needs re-narrowing inside JSX.
  const routeStep =
    route && route.ix + 1 < route.ids.length
      ? { ids: route.ids, ix: route.ix + 1, next: route.ids[route.ix + 1], of: route.ids.length }
      : null;

  // ONE outer .m-guide div in every branch — the scroll effect resolves its scroller via
  // host.closest(".m-sheet__body"), so hostRef must never move between branches.
  return (
    <div ref={hostRef} className="m-guide">
      <input
        ref={searchRef}
        className="m-gsearch"
        type="search"
        placeholder="SEARCH THE GUIDE…"
        aria-label="Search the guide"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Layered Esc, the desktop rail's twin: clear the query before anything else.
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setQuery("");
          }
        }}
      />

      {q ? (
        <div className="m-grows">
          <span className="m-gcount" aria-live="polite">
            {hits.length === 0 ? "NO MATCHES" : `${hits.length} RESULT${hits.length === 1 ? "" : "S"}`}
          </span>
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              className="m-grow"
              onClick={() => {
                setQuery("");
                navFree(h.id);
              }}
            >
              <span className="m-ghit">
                <span>
                  <Marked text={h.title} q={query} />
                  <span className={`m-ghit__kind m-ghit__kind--${h.kind}`}>
                    {h.kind === "chapter" ? "CH" : "TOPIC"}
                  </span>
                </span>
                <span className="m-ghit__ch">{h.chapterTitle}</span>
                {/* The snippet was dropped on /m — the one field that tells a reader WHY a
                    row matched, on the shell with the least room to guess. */}
                {h.snip && (
                  <span className="m-ghit__snip">
                    <Marked text={h.snip} q={query} />
                  </span>
                )}
              </span>
              <span className="m-grow__arrow" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>
      ) : !chapter ? (
        <>
          <div className="m-section">WHAT DO YOU WANT TO DO?</div>
          <div className="m-grows">
            {GUIDE_GOALS.map((g) => (
              <button key={g.target + g.goal} type="button" className="m-grow" onClick={() => startRoute(g.target)}>
                <span>{g.goal}</span>
                <span className="m-grow__arrow" aria-hidden="true">
                  →
                </span>
              </button>
            ))}
          </div>
          <div className="m-section">CHAPTERS</div>
          <div className="m-grows">
            {GUIDE_CHAPTERS.map((c) => (
              <div key={c.id} className="m-gchgroup">
                <button type="button" className="m-grow" onClick={() => navFree(c.id)}>
                  <span className="m-grow__ch">{c.title}</span>
                  <span className="m-grow__arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
                {/* Topic tier — 67 topics were reachable only by opening a chapter first. */}
                <div className="m-gchtopics">
                  {c.topics.map((t) => (
                    <button key={t.id} type="button" className="m-gchtopic" onClick={() => nav(t.id)}>
                      {t.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {/* The same content as a plain document — /guide (pages/guide.astro). */}
          <a className="m-gback" href="/guide">
            OPEN AS A PAGE ↗
          </a>
        </>
      ) : (
        <>
          <button type="button" className="m-gback" onClick={() => setChapterId(null)}>
            ‹ ALL CHAPTERS
          </button>
          <div className="m-section">{chapter.title}</div>
          <p className="m-gbody m-gbody--lead">
            <Inline text={chapter.lead} onNav={nav} />
          </p>
          {chapter.media && <Shot m={chapter.media} />}
          {chapter.topics.map((t) => (
            <Topic key={t.id} t={t} onNav={nav} />
          ))}
          {routeStep && (
            <button
              type="button"
              className="m-gback m-gnext"
              onClick={() => {
                setRoute({ ids: routeStep.ids, ix: routeStep.ix });
                nav(routeStep.next);
              }}
            >
              STEP {routeStep.ix + 1} OF {routeStep.of} · {GUIDE_INDEX.get(routeStep.next)?.title} →
            </button>
          )}
          {prev && (
            <button type="button" className="m-gback m-gnext" onClick={() => navFree(prev.id)}>
              ← PREV · {prev.title}
            </button>
          )}
          {next && (
            <button type="button" className="m-gback m-gnext" onClick={() => navFree(next.id)}>
              NEXT · {next.title} →
            </button>
          )}
        </>
      )}
    </div>
  );
}
