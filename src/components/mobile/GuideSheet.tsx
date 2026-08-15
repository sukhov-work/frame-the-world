/**
 * GuideSheet — the /m twin of the desktop GUIDE panel (guide track G1, 2026-08-15).
 * Renders the SAME content module (src/lib/guide/guideContent.ts) with its own markup —
 * the two-shell discipline: libs are the shared surface, desktop panels are never imported
 * (mobileFence.test.ts). Two views: the chapter index (goal router on top) and one chapter;
 * [[crosslinks]] navigate inside the sheet.
 */
import { useEffect, useRef, useState } from "react";
import {
  GUIDE_CHAPTERS,
  GUIDE_GOALS,
  GUIDE_INDEX,
  type GuideMedia,
  type GuideTopic,
} from "../../lib/guide/guideContent";
import { parseGuideInline } from "../../lib/guide/inline";
import "../../styles/mobile/chrome.css";

function Shot({ m }: { m: GuideMedia }) {
  return (
    <figure className={`m-gfig${m.shell === "mobile" ? " m-gfig--m" : ""}`}>
      <img className="m-gshot" src={m.src} alt="" loading="lazy" />
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

export default function GuideSheet() {
  const [chapterId, setChapterId] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const pendingTopic = useRef<string | null>(null);

  const nav = (id: string) => {
    const ref = GUIDE_INDEX.get(id);
    if (!ref) return;
    pendingTopic.current = ref.topicId ?? null;
    setChapterId(ref.chapterId);
  };

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
  }, [chapterId]);

  const chapter = chapterId ? GUIDE_CHAPTERS.find((c) => c.id === chapterId) : null;

  if (!chapter) {
    return (
      <div ref={hostRef} className="m-guide">
        <div className="m-section">WHAT DO YOU WANT TO DO?</div>
        <div className="m-grows">
          {GUIDE_GOALS.map((g) => (
            <button key={g.target + g.goal} type="button" className="m-grow" onClick={() => nav(g.target)}>
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
            <button key={c.id} type="button" className="m-grow" onClick={() => nav(c.id)}>
              <span className="m-grow__ch">{c.title}</span>
              <span className="m-grow__arrow" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>
        {/* The same content as a plain document — /guide (pages/guide.astro). */}
        <a className="m-gback" href="/guide">
          OPEN AS A PAGE ↗
        </a>
      </div>
    );
  }

  const chapterIx = GUIDE_CHAPTERS.indexOf(chapter);
  const next = GUIDE_CHAPTERS[chapterIx + 1];

  return (
    <div ref={hostRef} className="m-guide">
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
      {next && (
        <button type="button" className="m-gback m-gnext" onClick={() => nav(next.id)}>
          NEXT · {next.title} →
        </button>
      )}
    </div>
  );
}
