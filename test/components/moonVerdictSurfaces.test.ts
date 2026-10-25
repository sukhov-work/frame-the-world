import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TodayCard from "../../src/components/panels/TodayCard";
import MoonCalCard from "../../src/components/panels/MoonCalCard";
import TargetPanel from "../../src/components/panels/TargetPanel";
import TargetSheet from "../../src/components/mobile/TargetSheet";
import { useTimeStore } from "../../src/store/time";
import { useSkyStore } from "../../src/store/sky";
import { usePlanStore } from "../../src/store/plan";
import { useCameraStore } from "../../src/store/camera";
import { useFindStore } from "../../src/store/find";
import { bodyTarget } from "../../src/lib/ephemeris/targets";

/**
 * T200 (owner 2026-10-25e) — the moon's perceived visibility on the planning surfaces, both shells:
 * the TODAY moonrise / moonset rows' second meta (sampled 40 min after the rise / before the set —
 * the low-moon shot, never the horizon instant), the MOON section's NOW line, and the tracked moon's
 * third badge. Rendered with `renderToStaticMarkup` over the live stores mirrored onto zustand's
 * server snapshot (the findThisOne / mobileTargetPeekAlmanac idiom); the real ephemeris, no mocks.
 * Verdicts are the model's own at Dnipro (`lib/ephemeris/moonVisibility`, its worked cases).
 */

const LAT = 48.464627;
const LON = 35.064907;
const root = join(__dirname, "../..");
const SRC = (p: string) => readFileSync(join(root, p), "utf8");

const TIME_BOOT = { ...useTimeStore.getState() };
const SKY_BOOT = { ...useSkyStore.getState() };
const PLAN_BOOT = { ...usePlanStore.getState() };
const CAM_BOOT = { ...useCameraStore.getState() };
const FIND_BOOT = { ...useFindStore.getState() };

const mirror = () => {
  Object.assign(useTimeStore.getInitialState(), useTimeStore.getState());
  Object.assign(useSkyStore.getInitialState(), useSkyStore.getState());
  Object.assign(usePlanStore.getInitialState(), usePlanStore.getState());
  Object.assign(useCameraStore.getInitialState(), useCameraStore.getState());
  Object.assign(useFindStore.getInitialState(), useFindStore.getState());
};
const at = (iso: string) => useTimeStore.setState({ live: false, timeMs: Date.parse(iso), playRate: null });

beforeEach(() => {
  useTimeStore.setState(TIME_BOOT, true);
  useSkyStore.setState(SKY_BOOT, true);
  usePlanStore.setState(PLAN_BOOT, true);
  useCameraStore.setState(CAM_BOOT, true);
  useFindStore.setState(FIND_BOOT, true);
  usePlanStore.setState({ anchor: null, target: null });
  useCameraStore.setState({ focusLatDeg: LAT, focusLonDeg: LON });
});

/** One TODAY row's kind + its meta spans (title, text), in order. */
const dayRows = (html: string) =>
  [...html.matchAll(/<span class="pp-day__kind">([^<]*)<\/span>((?:<span class="pp-day__meta"[^>]*>[^<]*<\/span>)*)/g)].map(
    (m) => ({
      kind: m[1],
      metas: [...m[2].matchAll(/<span class="pp-day__meta" title="([^"]*)">([^<]*)<\/span>/g)].map((x) => ({
        title: x[1],
        text: x[2],
      })),
    }),
  );

describe("T200 — TODAY rows carry the moon-shot verdict (desktop TodayCard)", () => {
  it("Dnipro 2026-10-25: the moonrise row's second meta is the verdict 40 min after the rise, the moonset's 40 min before the set", () => {
    at("2026-10-25T12:00:00Z");
    mirror();
    const rows = dayRows(renderToStaticMarkup(createElement(TodayCard, { latDeg: LAT, lonDeg: LON })));
    const rise = rows.find((r) => r.kind === "☾ RISE");
    const set = rows.find((r) => r.kind === "☾ SET");
    expect(rise, "a moonrise row").toBeDefined();
    expect(set, "a moonset row").toBeDefined();
    // ☀±N first, then the verdict — exactly two metas.
    expect(rise!.metas).toHaveLength(2);
    expect(rise!.metas[0].text).toMatch(/^☀[+−-]?[\d.]+°$/);
    // The 13:46Z moonrise + 40 min: daylight, low in haze — CLEAR (the real ephemeris).
    expect(rise!.metas[1].text).toBe("☾ CLEAR");
    expect(rise!.metas[1].title).toMatch(/^Moon 40 min after moonrise — daylight · low in haze/);
    // The 03:14Z moonset − 40 min: astronomical twilight — BRIGHT.
    expect(set!.metas[1].text).toBe("☾ BRIGHT");
    expect(set!.metas[1].title).toMatch(/^Moon 40 min before moonset — astronomical twilight/);
    // Sun rows never wear the moon's verdict.
    for (const r of rows) if (!r.kind.startsWith("☾ RISE") && !r.kind.startsWith("☾ SET")) {
      expect(r.metas.some((m) => m.text.startsWith("☾ "))).toBe(false);
    }
  });

  it("the verdicts are computed inside the day memo (keyed dayKey / latKey / lonKey), the second meta spaced 6 px", () => {
    const src = SRC("src/components/panels/TodayCard.tsx");
    const memo = src.slice(src.indexOf("const rows = useMemo("), src.indexOf("}, [dayKey, latKey, lonKey]);"));
    expect(memo).toContain("moonShotVerdict(e.kind, e.utcMs, lat, lon)");
    expect(src).toMatch(/const MOON_SHOT_OFFSET_MS = 40 \* 60_000;/);
    const css = SRC("src/styles/plan-panel.css");
    expect(css).toMatch(/\.pp-day__meta \+ \.pp-day__meta \{\s*margin-left: 6px;\s*\}/);
    // The /m twin: same offset, same memo, the sentence on the aria-label (no hover on a phone).
    const m = SRC("src/components/mobile/PlanSheet.tsx");
    expect(m).toMatch(/const MOON_SHOT_OFFSET_MS = 40 \* 60_000;/);
    expect(m).toContain("moonShotVerdict(e.kind, e.utcMs, lat, lon)");
    expect(m).toMatch(/<span className="m-row__meta" aria-label=\{moonShot\.say\}>/);
    expect(SRC("src/styles/mobile/chrome.css")).toMatch(/\.m-row__meta \+ \.m-row__meta \{\s*margin-left: 6px;/);
  });
});

describe("T200 — the MOON section's NOW line", () => {
  it("MoonCalCard: ☾ NOW · <label> · <short reason> above the rows, the full reason in the title", () => {
    at("2026-10-25T14:45:00Z");
    mirror();
    const html = renderToStaticMarkup(createElement(MoonCalCard, { latDeg: LAT, lonDeg: LON }));
    const m = html.match(/<div class="pp-status pp-status--moon" title="Moon now — ([^"]*)">([^<]*)<\/div>/);
    expect(m, "the NOW line").not.toBeNull();
    expect(m![2]).toBe("☾ NOW · BRIGHT · CIVIL TWILIGHT · LOW IN HAZE");
    expect(m![1]).toMatch(/^civil twilight · low in haze — [\d.]+ mag lost, orange$/);
    // Between the section heading and the first row.
    expect(html.indexOf("MOON · PHASES &amp; DISTANCES")).toBeLessThan(html.indexOf("☾ NOW"));
    expect(html.indexOf("☾ NOW")).toBeLessThan(html.indexOf('class="pp-day"'));
  });

  it("both shells key the NOW line to the scene minute, never a render tick; /m mounts it in .m-status-line", () => {
    for (const p of ["src/components/panels/MoonCalCard.tsx", "src/components/mobile/PlanSheet.tsx"]) {
      const src = SRC(p);
      expect(src).toMatch(/moonVisibilityAt\(minuteKey \* 60_000, latKey \/ 20, lonKey \/ 20\),\s*\[minuteKey, latKey, lonKey\]/);
      expect(src).toMatch(/setMinuteKey\(Math\.floor\(sceneTimeMs\(\) \/ 60_000\)\)/);
    }
    expect(SRC("src/components/mobile/PlanSheet.tsx")).toMatch(
      /<div className="m-status-line" aria-label=\{`Moon now: [^`]*`\}>\s*\{`☾ NOW · \$\{moonNow\.label\}/,
    );
  });
});

/** The /m sheet's chip row's badges, in order. */
const mBadges = (html: string) => {
  const row = html.slice(html.indexOf('class="m-chips"'), html.indexOf('class="m-live"'));
  return [...row.matchAll(/<span class="(m-badge[^"]*)"[^>]*>([^<]*)<\/span>/g)].map((m) => ({ cls: m[1], text: m[2] }));
};
const tpBadges = (html: string) => {
  const row = html.slice(html.indexOf('class="tp-badges"'), html.indexOf('class="tp-live"'));
  return [...row.matchAll(/<span class="(tp-badge[^"]*)"([^>]*)>([^<]*)<\/span>/g)].map((m) => ({
    cls: m[1],
    attrs: m[2],
    text: m[3],
  }));
};

describe("T200 — the tracked moon's verdict badge, both shells", () => {
  it("TargetSheet (/m): the moon at 2026-10-25T14:45Z wears BRIGHT after ABOVE HORIZON; at 2026-11-02T08:00Z PALE", () => {
    useSkyStore.setState({ target: bodyTarget("moon"), visible: true });
    at("2026-10-25T14:45:00Z");
    mirror();
    let b = mBadges(renderToStaticMarkup(createElement(TargetSheet as never, { onClose: () => {} })));
    expect(b.map((x) => x.text)).toEqual(["ABOVE HORIZON", "BRIGHT"]);
    expect(b[1].cls).toBe("m-badge m-badge--clear");
    at("2026-11-02T08:00:00Z");
    mirror();
    b = mBadges(renderToStaticMarkup(createElement(TargetSheet as never, { onClose: () => {} })));
    expect(b.map((x) => x.text)).toEqual(["ABOVE HORIZON", "PALE"]);
    expect(b[1].cls).toBe("m-badge");
  });

  it("TargetSheet: the sun tracked never wears a moon verdict (the gate is target.kind)", () => {
    useSkyStore.setState({ target: bodyTarget("sun"), visible: true });
    at("2026-11-02T08:00:00Z");
    mirror();
    const b = mBadges(renderToStaticMarkup(createElement(TargetSheet as never, { onClose: () => {} })));
    expect(b.map((x) => x.text)).toEqual(["ABOVE HORIZON"]);
  });

  it("TargetPanel (desktop): the same verdicts, the reason in the title", () => {
    useSkyStore.setState({ target: bodyTarget("moon"), visible: true, open: true });
    at("2026-10-25T14:45:00Z");
    mirror();
    let b = tpBadges(renderToStaticMarkup(createElement(TargetPanel)));
    expect(b.map((x) => x.text)).toEqual(["ABOVE HORIZON", "BRIGHT"]);
    expect(b[1].cls).toBe("tp-badge tp-badge--up");
    expect(b[1].attrs).toMatch(/title="civil twilight · low in haze — /);
    at("2026-11-02T08:00:00Z");
    mirror();
    b = tpBadges(renderToStaticMarkup(createElement(TargetPanel)));
    expect(b.map((x) => x.text)).toEqual(["ABOVE HORIZON", "PALE"]);
    expect(b[1].cls).toBe("tp-badge");
  });

  it("parity: both shells gate on target.kind, mount the badge after the SKYLINE badge, and share the tone map", () => {
    for (const p of ["src/components/panels/TargetPanel.tsx", "src/components/mobile/TargetSheet.tsx"]) {
      const src = SRC(p);
      expect(src).toContain('const trackedMoon = target.kind === "moon";');
      expect(src).toMatch(/moonVisibilityAt\(minuteKey \* 60_000, visLatKey \/ 20, visLonKey \/ 20\)/);
      expect(src.indexOf('"BEHIND SKYLINE" : "SKYLINE CLEAR"')).toBeLessThan(src.indexOf('{moonVis && moonVis.verdict !== "below" && ('));
      expect(src).not.toMatch(/facts\.kind === "moon"/);
    }
  });
});
