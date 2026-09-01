/**
 * DebugPanel — the DBG chip's floating metrics window (owner 2026-09-01;
 * design: claude-docs/DEBUG_HUD_PLAN.md).
 *
 * DESKTOP-ONLY, OFF BY DEFAULT. The chip persists `debugHud` in the shared prefs blob, so —
 * exactly like ULT — the flag can be true on `/m` in the same browser; the fence is the
 * module-scope desktop predicate here plus the chip's own (`hqExperimentsAllowed`), never the
 * store field.
 *
 * How it reads data, and why it looks nothing like the other panels:
 *  - The engine collects NOTHING until this window mounts (`setDebugFeedActive(true)` — one
 *    boolean per push site while closed).
 *  - Values arrive by POLLING lib/globe/debugFeed providers at DEBUGHUD cadences (fast 250 ms /
 *    slow 1 s) — never by store subscription at frame rate (the seam/mirror discipline: a
 *    per-frame globe read must never trigger a React re-render).
 *  - React renders STRUCTURE only (filter / collapse changes). Values and sparklines are
 *    written imperatively through refs on a 10 Hz tick — the game-engine HUD idiom.
 *  - Cumulative counters render as differenced per-second rates (`makeRateTracker`) — the RC11
 *    single-sample rule, applied in one place for every counter.
 *  - The heavy scene walks (debugSeats, terrain/aniso censuses) are BUTTONS (actions), and
 *    their output lands in a <pre> — they are never polled.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import DragGrip, { ResizeGrip, usePanelDrag, usePanelResize } from "../ui/DragGrip";
import InfoDot from "../ui/InfoDot";
import { useCameraStore } from "../../store/camera";
import { useUploadStore } from "../../store/upload";
// NOT store/bestSpot: it is VALUE-import-fenced to the seam's owners (fences.test.ts) — the
// worker flags arrive through the engine's "planning" provider instead.
import { sceneTimeMs, useTimeStore } from "../../store/time";
import { DEBUGHUD } from "../globe/tuning";
import {
  debugSeriesRead,
  debugSeriesStatsOf,
  makeRateTracker,
  readDebugProvider,
  runDebugAction,
  setDebugFeedActive,
  type DebugSeriesId,
  type DebugValue,
} from "../../lib/globe/debugFeed";
import {
  DEBUG_ACTIONS,
  DEBUG_GROUPS,
  DEBUG_METRICS,
  type DebugMetricDef,
} from "../../lib/globe/debugCatalog";
import "../../styles/debug-panel.css";

/** The desktop-experiment gate — the same two-term expression as CameraTiltPanel's
 *  `hqExperimentsAllowed` and the engine's `hqAllowed`, restated here because the pref blob is
 *  shared across shells: a phone on `/?d=1` with a desktop-set flag must still get nothing. */
const dbgAllowed =
  typeof document !== "undefined" &&
  !document.body.classList.contains("m") &&
  !window.matchMedia("(pointer: coarse)").matches;

const FAST_PROVIDERS = ["canvas", "tiles", "ultra", "camera"] as const;
const SLOW_PROVIDERS = [
  "astro",
  "terrain",
  "buildings",
  "vector",
  "planning",
  "system",
] as const;

interface Ring {
  buf: Float32Array;
  head: number;
  len: number;
}
const SPARK_SAMPLES = 64;

const pushRing = (r: Ring, v: number) => {
  r.buf[r.head] = v;
  r.head = (r.head + 1) % r.buf.length;
  if (r.len < r.buf.length) r.len++;
};

const fmtValue = (fmt: DebugMetricDef["fmt"], v: DebugValue): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "ON" : "off";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "—";
  switch (fmt) {
    case "int":
      return Math.round(v).toLocaleString("en-US");
    case "ms1":
      return `${v.toFixed(1)} ms`;
    case "float2":
      return v.toFixed(2);
    case "float3":
      return v.toFixed(3);
    case "pct":
      return `${(v * 100).toFixed(1)} %`;
    case "mb1":
      return `${v.toFixed(1)} MB`;
    case "deg1":
      return `${v.toFixed(1)}°`;
    case "m1":
      return v >= 10_000 ? `${(v / 1000).toFixed(1)} km` : `${v.toFixed(1)} m`;
    default:
      return String(v);
  }
};

export default function DebugPanel() {
  const on = useCameraStore((s) => s.debugHud);
  if (!dbgAllowed || !on) return null;
  return <DebugWindow />;
}

function DebugWindow() {
  const setDebugHud = useCameraStore((s) => s.setDebugHud);
  const drag = usePanelDrag("dbg");
  const resize = usePanelResize("dbg");
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [actionOut, setActionOut] = useState<{ id: string; text: string } | null>(null);

  // ---- imperative plumbing (no React re-render on data) ----
  const snap = useRef<Record<string, DebugValue>>({});
  const rates = useRef(makeRateTracker());
  const rateVals = useRef<Record<string, number | null>>({});
  const rings = useRef(new Map<string, Ring>());
  const valueEls = useRef(new Map<string, HTMLSpanElement>());
  const sparkEls = useRef(new Map<string, HTMLCanvasElement>());
  const hdrEls = useRef(new Map<string, HTMLSpanElement>());
  const longTasks = useRef(0);
  const scratch = useRef(new Float32Array(DEBUGHUD.ringCapacity));
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // The feed lifecycle — the whole off-state contract hangs on this pair.
  useEffect(() => {
    setDebugFeedActive(true);
    return () => setDebugFeedActive(false);
  }, []);

  // Long tasks (main-thread blocks ≥50 ms from ANY source — a superset of the frame brackets).
  useEffect(() => {
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((list) => {
        longTasks.current += list.getEntries().length;
      });
      obs.observe({ type: "longtask", buffered: false });
    } catch {
      /* Safari/Firefox: no longtask type — the row reads "—" */
    }
    return () => obs?.disconnect();
  }, []);

  // ---- polling: merge provider + panel-local snapshots, feed rings and rate values ----
  useEffect(() => {
    const specById = new Map(DEBUG_METRICS.map((m) => [m.id, m]));
    const ingest = (prefix: string, obj: Record<string, DebugValue> | null) => {
      if (!obj) {
        // A missing/throwing provider reads as absent — rows show "—", never stale numbers.
        for (const k of Object.keys(snap.current)) {
          if (k.startsWith(`${prefix}.`)) snap.current[k] = null;
        }
        return;
      }
      const nowMs = performance.now();
      for (const [k, v] of Object.entries(obj)) {
        const id = `${prefix}.${k}`;
        snap.current[id] = v;
        const spec = specById.get(id);
        if (!spec || typeof v !== "number" || !Number.isFinite(v)) continue;
        if (spec.rate) rateVals.current[id] = rates.current.rate(id, v, nowMs);
        if (spec.spark) {
          let r = rings.current.get(id);
          if (!r) {
            r = { buf: new Float32Array(SPARK_SAMPLES), head: 0, len: 0 };
            rings.current.set(id, r);
          }
          pushRing(r, spec.rate ? (rateVals.current[id] ?? 0) : v);
        }
      }
    };
    const local = () => {
      const t = useTimeStore.getState();
      const now = sceneTimeMs();
      const u = useUploadStore.getState();
      const out: Record<string, DebugValue> = {
        "time.sceneIso": `${new Date(now).toISOString().slice(0, 19)}Z`,
        "time.live": t.live,
        "time.playRate": t.playRate === null ? null : `×${t.playRate}`,
        "time.driftH": (now - Date.now()) / 3.6e6,
        "workers.decodePhase": u.phase,
        "workers.decodeProgress": u.decodeProgress,
        "workers.decodeMs": u.decodeMs ?? null,
        "mem.longTasks": longTasks.current,
      };
      const pm = (
        performance as Performance & { memory?: { usedJSHeapSize: number } }
      ).memory;
      out["mem.jsHeapMB"] = pm ? pm.usedJSHeapSize / 1048576 : null;
      return out;
    };
    const pollFast = () => {
      if (pausedRef.current) return;
      for (const p of FAST_PROVIDERS) ingest(p, readDebugProvider(p));
    };
    const pollSlow = () => {
      if (pausedRef.current) return;
      for (const p of SLOW_PROVIDERS) ingest(p, readDebugProvider(p));
      const l = local();
      for (const [id, v] of Object.entries(l)) {
        snap.current[id] = v;
        const spec = specById.get(id);
        if (spec && typeof v === "number" && Number.isFinite(v)) {
          if (spec.rate) rateVals.current[id] = rates.current.rate(id, v, performance.now());
          if (spec.spark) {
            let r = rings.current.get(id);
            if (!r) {
              r = { buf: new Float32Array(SPARK_SAMPLES), head: 0, len: 0 };
              rings.current.set(id, r);
            }
            pushRing(r, spec.rate ? (rateVals.current[id] ?? 0) : v);
          }
        }
      }
    };
    pollFast();
    pollSlow();
    const f = window.setInterval(pollFast, DEBUGHUD.fastPollMs);
    const s = window.setInterval(pollSlow, DEBUGHUD.slowPollMs);
    return () => {
      window.clearInterval(f);
      window.clearInterval(s);
    };
  }, []);

  // ---- the 10 Hz UI tick: value text + warn classes + sparklines + the FRAME header ----
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const inkLine = css.getPropertyValue("--color-accent").trim() || "#7fd4d4";
    const inkBudget = css.getPropertyValue("--color-warn").trim() || "#e8a268";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const drawSpark = (cv: HTMLCanvasElement, data: Float32Array, n: number, budget?: number) => {
      const w = DEBUGHUD.sparkWidthPx;
      const h = DEBUGHUD.sparkHeightPx;
      if (cv.width !== w * dpr) {
        cv.width = w * dpr;
        cv.height = h * dpr;
      }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (n < 2) return;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (budget !== undefined && budget > hi) hi = budget;
      if (hi - lo < 1e-9) {
        lo -= 0.5;
        hi += 0.5;
      }
      const y = (v: number) => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
      if (budget !== undefined && budget >= lo && budget <= hi) {
        ctx.strokeStyle = inkBudget;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y(budget)) + 0.5);
        ctx.lineTo(w, Math.round(y(budget)) + 0.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = inkLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * (w - 2) + 1;
        if (i === 0) ctx.moveTo(x, y(data[i]));
        else ctx.lineTo(x, y(data[i]));
      }
      ctx.stroke();
    };
    const setHdr = (id: string, text: string) => {
      const el = hdrEls.current.get(id);
      if (el && el.textContent !== text) el.textContent = text;
    };
    const tick = () => {
      if (pausedRef.current) return;
      // FRAME header — order statistics over the per-frame dt ring.
      const dt = debugSeriesStatsOf("frame.dt");
      if (dt) {
        setHdr("fps", (1000 / Math.max(0.01, dt.avg)).toFixed(0));
        setHdr("p95", `${dt.p95.toFixed(1)} ms`);
        setHdr("low1", `${(1000 / Math.max(0.01, dt.worst1)).toFixed(0)} fps`);
        setHdr("jit", `${dt.jitter.toFixed(1)} ms`);
      }
      for (const m of DEBUG_METRICS) {
        const el = valueEls.current.get(m.id);
        const cv = sparkEls.current.get(m.id);
        if (!el && !cv) continue; // filtered out / collapsed — draw nothing
        let value: DebugValue;
        let sparkData: { data: Float32Array; n: number } | null = null;
        if (m.id.startsWith("series:")) {
          const sid = m.id.slice(7) as DebugSeriesId;
          const st = debugSeriesStatsOf(sid);
          value = st ? st.last : null;
          if (cv) {
            const n = debugSeriesRead(sid, scratch.current);
            sparkData = { data: scratch.current, n };
          }
        } else {
          value = m.rate ? rateVals.current[m.id] : snap.current[m.id];
          if (cv) {
            const r = rings.current.get(m.id);
            if (r) {
              const n = Math.min(r.len, scratch.current.length);
              const start = (r.head - n + r.buf.length * 2) % r.buf.length;
              for (let i = 0; i < n; i++)
                scratch.current[i] = r.buf[(start + i) % r.buf.length];
              sparkData = { data: scratch.current, n };
            }
          }
        }
        if (el) {
          const text = m.rate
            ? value === null || value === undefined
              ? "…"
              : `${(value as number).toFixed(1)}/s`
            : fmtValue(m.fmt, value);
          if (el.textContent !== text) el.textContent = text;
          const num = typeof value === "number" ? value : typeof value === "boolean" ? +value : null;
          const warn =
            num !== null &&
            ((m.warnAbove !== undefined && num > m.warnAbove) ||
              (m.warnBelow !== undefined && num < m.warnBelow));
          el.classList.toggle("is-warn", warn);
        }
        if (cv && sparkData && sparkData.n > 0) drawSpark(cv, sparkData.data, sparkData.n, m.budget);
      }
    };
    tick();
    const h = window.setInterval(tick, DEBUGHUD.uiTickMs);
    return () => window.clearInterval(h);
  }, [filter, collapsed]);

  // ---- structure (re-rendered only on filter/collapse changes) ----
  const q = filter.trim().toLowerCase();
  const groups = useMemo(() => {
    return DEBUG_GROUPS.map((g) => {
      const metrics = DEBUG_METRICS.filter(
        (m) =>
          m.group === g.id &&
          (!q ||
            m.label.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            g.title.toLowerCase().includes(q)),
      );
      const actions = DEBUG_ACTIONS.filter(
        (a) => a.group === g.id && (!q || a.label.toLowerCase().includes(q) || g.title.toLowerCase().includes(q)),
      );
      return { ...g, metrics, actions };
    }).filter((g) => g.metrics.length > 0 || g.actions.length > 0);
  }, [q]);

  const runAction = (id: string) => {
    const t0 = performance.now();
    const out = runDebugAction(id);
    const ms = performance.now() - t0;
    let text: string;
    try {
      text = JSON.stringify(out, null, 1) ?? "undefined";
    } catch {
      text = String(out);
    }
    if (text.length > 6000) text = `${text.slice(0, 6000)}\n… (truncated)`;
    setActionOut({ id, text: `⏱ ${ms.toFixed(1)} ms\n${text}` });
  };

  return (
    <div
      className="dbg-panel"
      style={{ ...drag.style, ...resize.style }}
      role="dialog"
      aria-label="Debug window"
    >
      <DragGrip drag={drag} label="Move the debug window" tipPos="left" />
      <ResizeGrip resize={resize} label="Resize the debug window" />
      <div className="dbg-head">
        <span className="dbg-title">DEBUG</span>
        <input
          className="dbg-filter"
          type="search"
          placeholder="FILTER METRICS…"
          aria-label="Filter metrics"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          type="button"
          className={`dbg-btn${paused ? " is-on" : ""}`}
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
        >
          {paused ? "RESUME" : "PAUSE"}
        </button>
        <button
          type="button"
          className="dbg-btn dbg-close"
          onClick={() => setDebugHud(false)}
          aria-label="Close the debug window"
        >
          ✕
        </button>
      </div>
      <div className="dbg-hdr" aria-label="Frame statistics">
        <span className="dbg-hdr__cell">
          <b ref={(el) => hdrRef(hdrEls.current, "fps", el)}>—</b> fps
        </span>
        <span className="dbg-hdr__cell">
          p95 <b ref={(el) => hdrRef(hdrEls.current, "p95", el)}>—</b>
        </span>
        <span className="dbg-hdr__cell">
          1% low <b ref={(el) => hdrRef(hdrEls.current, "low1", el)}>—</b>
        </span>
        <span className="dbg-hdr__cell">
          jitter <b ref={(el) => hdrRef(hdrEls.current, "jit", el)}>—</b>
          <InfoDot
            pos="left"
            label="About the frame statistics"
            tip="Over the last ~4 s of rAF deltas: fps = 1000/avg; 1% low = fps of the worst 1% of frames; jitter = p95 − p50. Cadence, not main-thread cost — see the FRAME rows."
          />
        </span>
      </div>
      <div className="dbg-scroll">
        {groups.map((g) => {
          const isCollapsed = !!collapsed[g.id] && !q;
          return (
            <section key={g.id} className="dbg-group">
              <button
                type="button"
                className="dbg-group__head"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
              >
                <span className="dbg-group__chev">{isCollapsed ? "▸" : "▾"}</span>
                {g.title}
                <span className="dbg-group__n">{g.metrics.length}</span>
              </button>
              {!isCollapsed && (
                <div className="dbg-rows">
                  {g.metrics.map((m) => (
                    <div key={m.id} className="dbg-row">
                      <span className="dbg-row__label" title={m.id}>
                        {m.label}
                      </span>
                      <span
                        className="dbg-row__value"
                        ref={(el) => rowRef(valueEls.current, m.id, el)}
                      >
                        —
                      </span>
                      {m.spark || m.id.startsWith("series:") ? (
                        <canvas
                          className="dbg-row__spark"
                          style={{
                            width: DEBUGHUD.sparkWidthPx,
                            height: DEBUGHUD.sparkHeightPx,
                          }}
                          ref={(el) => rowRef(sparkEls.current, m.id, el)}
                        />
                      ) : (
                        <span className="dbg-row__spacer" />
                      )}
                      <InfoDot pos="left" label={m.label} tip={m.note} />
                    </div>
                  ))}
                  {g.actions.map((a) => (
                    <div key={a.id} className="dbg-row dbg-row--action">
                      <button type="button" className="dbg-btn" onClick={() => runAction(a.id)}>
                        {a.label}
                      </button>
                      <InfoDot pos="left" label={a.label} tip={a.note} />
                    </div>
                  ))}
                  {actionOut && g.actions.some((a) => a.id === actionOut.id) && (
                    <pre className="dbg-action-out">{actionOut.text}</pre>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {groups.length === 0 && <p className="dbg-empty">No metric matches “{filter}”.</p>}
      </div>
    </div>
  );
}

/** Ref-map registration that cleans up on unmount (a filtered-out row must not leave a stale
 *  element behind for the imperative tick to write into). */
function rowRef<T extends Element>(map: Map<string, T>, id: string, el: T | null): void {
  if (el) map.set(id, el);
  else map.delete(id);
}
function hdrRef(map: Map<string, HTMLSpanElement>, id: string, el: HTMLElement | null): void {
  if (el) map.set(id, el as HTMLSpanElement);
  else map.delete(id);
}
