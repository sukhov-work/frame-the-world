import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  facadePoseIsSolved,
  FACADE_PLANAR_NOTE,
  FacadeAlignView,
  FacadeGlobeHintView,
  FacadePickOverlayView,
  facadeAlignStatus,
  facadeDraftPoseOf,
  formatPx,
  liveResiduals,
  pairAddBlock,
  pairPx,
  shortFacadeKey,
  solveFacadeDraftNow,
  type FacadeAlignActions,
  type FacadeAlignViewModel,
} from "../../src/components/panels/FacadeAlignSection";
import { useFacadePhotoStore } from "../../src/store/facadePhoto";
import { editJournal } from "../../src/store/editJournal";
import { enuOfEcef, type FacadeAlignOrigin, type FacadeAlignPair, type FacadeSolved } from "../../src/lib/geo/facadeAlign";
import { facadePairsPlanar } from "../../src/lib/geo/pnp";
import { frustumGeometry } from "../../src/lib/geo/frustum";
import type { Vec3 } from "../../src/lib/geo/projection";
import { verticalFovDeg } from "../../src/lib/decode/sensors";
import type { ExtractedPhoto, PhotoExif } from "../../src/lib/decode/extract";

// F5's PAIRS UI (T172, 2026-10-24): the presentational views (props in, callbacks out — zustand 5
// serves a hook its INITIAL state under renderToStaticMarkup, so the island is not rendered here),
// the pure helpers, and `solveFacadeDraftNow` end to end on a seeded store with pairs synthesised
// on the truth frustum's far face (the facadeAlign.test.ts idiom).

// The residency store is reached lazily by the photo store — mocked to its contract (facadePhoto.test.ts).
vi.mock("../../src/store/facades", () => ({
  useFacadesStore: { getState: () => ({ setEditing: () => undefined }) },
}));

const calls: string[] = [];
const actions: FacadeAlignActions = {
  startPairPick: () => calls.push("start"),
  removePair: (i) => calls.push(`remove:${i}`),
  clearPairs: () => calls.push("clear"),
  solve: () => calls.push("solve"),
  setSolveFov: (on) => calls.push(`fov:${on}`),
};

const W = 4032;
const H = 3024;
const pair = (u: number, v: number, target?: string): FacadeAlignPair => ({ uv: [u, v], enu: [u * 10 - 5, 25, (1 - v) * 6], ...(target ? { target } : {}) });
const PAIRS: FacadeAlignPair[] = [
  pair(0.1, 0.15, "osm:w132547176"),
  pair(0.9, 0.15),
  pair(0.9, 0.85, "osm:w132547176"),
  pair(0.1, 0.85),
  pair(0.5, 0.5, "osm:r42"),
  pair(0.3, 0.7),
];
const vm = (n: number, over: Partial<FacadeAlignViewModel> = {}): FacadeAlignViewModel => ({
  previewUrl: "blob:preview",
  textureWidth: W,
  textureHeight: H,
  pairs: PAIRS.slice(0, n),
  residualsPx: PAIRS.slice(0, n).map((_, i) => 1.25 + i),
  rmsNowPx: n > 0 ? 3.4 : null,
  seated: true,
  pairPick: "none",
  solveFov: false,
  planar: null,
  ...over,
});
const render = (v: FacadeAlignViewModel) => renderToStaticMarkup(createElement(FacadeAlignView, { view: v, actions }));
/** The opening tag of the element carrying `hook`. */
const tagOf = (html: string, hook: string): string => {
  const i = html.indexOf(hook);
  if (i < 0) return "";
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
};

describe("FacadeAlignView — the section at 0 / 3 / 4 / 6 pairs", () => {
  it("0 pairs: the title, the tip, 0 PAIRS, the thumbnail; SOLVE + the lens box disabled; no rows, no CLEAR, no status", () => {
    const html = render(vm(0));
    expect(html).toContain('class="ff-align"');
    expect(html).toContain("ALIGN TO THE BUILDINGS");
    expect(html).toContain("0 PAIRS");
    expect(html).toContain("4 PAIRS SOLVE THE POSE, 6 ALSO THE LENS");
    expect(html).toMatch(/<img class="ff-align__thumb" src="blob:preview"/);
    expect(html).toContain(`aspect-ratio:${W} / ${H}`);
    expect(tagOf(html, "data-facade-solve=")).toMatch(/disabled/);
    expect(tagOf(html, "data-facade-solve-fov")).toMatch(/disabled/);
    expect(html).not.toContain("data-facade-pair-row");
    expect(html).not.toContain("data-facade-pairs-clear");
    expect(html).not.toContain("ff-align__status");
    expect(tagOf(html, "data-facade-pair-add")).not.toMatch(/aria-disabled/);
  });

  it("3 pairs: the rows print px · the shortened key / GROUND · the residual; SOLVE still disabled; CLEAR + NOW show", () => {
    const html = render(vm(3));
    expect(html).toContain("3 PAIRS");
    for (let i = 0; i < 3; i++) expect(html).toContain(`data-facade-pair-row="${i}"`);
    expect(html).toContain(`${Math.round(0.1 * W)}, ${Math.round(0.15 * H)}`);
    expect(html).toContain("W…47176");
    expect(html).toContain('title="osm:w132547176"');
    expect(html).toContain("GROUND");
    expect(html).toContain("1.3 PX"); // 1.25 → toFixed(1)
    expect(html).toContain("2.3 PX");
    expect(html).toContain('data-facade-pair-remove="2"');
    expect(tagOf(html, "data-facade-solve=")).toMatch(/disabled/);
    expect(html).toContain("data-facade-pairs-clear");
    expect(html).toContain("NOW · RMS 3.4 PX");
    // three numbered dots on the thumbnail at u·100% / v·100%
    expect(html.match(/class="ff-align__dot"/g)?.length).toBe(3);
    expect(html).toContain("left:10%;top:15%");
  });

  it("4 pairs: SOLVE enabled, the lens box still disabled", () => {
    const html = render(vm(4));
    expect(tagOf(html, "data-facade-solve=")).not.toMatch(/disabled/);
    expect(tagOf(html, "data-facade-solve-fov")).toMatch(/disabled/);
  });

  it("6 pairs: the lens box enabled (unchecked by default, checked when on)", () => {
    const off = render(vm(6));
    expect(tagOf(off, "data-facade-solve-fov")).not.toMatch(/disabled/);
    expect(tagOf(off, "data-facade-solve-fov")).not.toMatch(/checked/);
    expect(tagOf(render(vm(6, { solveFov: true })), "data-facade-solve-fov")).toMatch(/checked/);
    expect(off).toContain("R42");
  });

  it("+ PAIR / the thumb are aria-disabled (the tap kept) when unseated, at the cap, or mid-pick", () => {
    for (const over of [{ seated: false }, { pairPick: "photo" as const }, { pairPick: "globe" as const }]) {
      const html = render(vm(2, over));
      expect(tagOf(html, "data-facade-pair-add")).toMatch(/aria-disabled="true"/);
      expect(tagOf(html, "data-facade-pair-add")).not.toMatch(/ disabled=""/);
      expect(tagOf(html, "data-facade-pair-thumb")).toMatch(/aria-disabled="true"/);
    }
    expect(pairAddBlock({ seated: true, n: 24, pairPick: "none" })).toMatch(/CAP/);
    expect(pairAddBlock({ seated: true, n: 23, pairPick: "none" })).toBeNull();
  });

  it("a solve prints SOLVED in the ok tone; a failure prints the reason uppercased in warn", () => {
    const solved: FacadeSolved = {
      pose: { lat: 1, lon: 2, altitudeM: 1.7, headingDeg: 211, pitchDeg: 0, rollDeg: 0, hFovDeg: 60 },
      rmsPx: 0.42,
      n: 6,
      fovSolved: true,
      planar: false,
      at: "2026-10-24T12:00:00.000Z",
    };
    const ok = render(vm(6, { solved, clamped: true }));
    expect(ok).toMatch(/ff-align__status is-ok">SOLVED · RMS 0\.4 PX · 6 PAIRS · LENS SOLVED · CLAMPED TO THE RAILS/);
    const bad = render(vm(4, { failure: "the solve diverged" }));
    expect(bad).toMatch(/ff-align__status is-warn">THE SOLVE DIVERGED/);
  });
});

describe("the one-flat-wall note", () => {
  const WALL: Vec3[] = [[-5, 25, 0], [5, 25, 0], [5, 25, 6], [-5, 25, 6]];
  const CORNER: Vec3[] = [[-5, 25, 0], [5, 25, 0], [5, 25, 6], [5, 15, 0], [5, 15, 6]];
  const asPairs = (pts: Vec3[]): FacadeAlignPair[] => pts.map((enu, i) => ({ uv: [0.1 + i * 0.15, 0.5], enu: [enu[0], enu[1], enu[2]] }));

  it("shows with 4 coplanar pairs, not with a corner", () => {
    const wall = asPairs(WALL);
    const corner = asPairs(CORNER);
    expect(facadePairsPlanar(wall)).toBe(true);
    expect(facadePairsPlanar(corner)).toBe(false);
    expect(render(vm(4, { pairs: wall, residualsPx: [1, 1, 1, 1], planar: facadePairsPlanar(wall) }))).toContain(FACADE_PLANAR_NOTE);
    expect(render(vm(5, { pairs: corner, residualsPx: [1, 1, 1, 1, 1], planar: facadePairsPlanar(corner) }))).not.toContain(FACADE_PLANAR_NOTE);
  });
});

describe("the pure helpers", () => {
  it("shortFacadeKey: osm:w132547176 → W…47176; a short id as-is; none → GROUND", () => {
    expect(shortFacadeKey("osm:w132547176")).toBe("W…47176");
    expect(shortFacadeKey("osm:r42")).toBe("R42");
    expect(shortFacadeKey(undefined)).toBe("GROUND");
    expect(shortFacadeKey(null)).toBe("GROUND");
    expect(shortFacadeKey("")).toBe("GROUND");
  });

  it("formatPx / pairPx", () => {
    expect(formatPx(3.14159)).toBe("3.1 PX");
    expect(formatPx(0)).toBe("0.0 PX");
    expect(formatPx(Number.POSITIVE_INFINITY)).toBe("— PX");
    expect(formatPx(null)).toBe("— PX");
    expect(pairPx([0.5, 0.25], 4032, 3024)).toEqual([2016, 756]);
    expect(pairPx([0.33333, 1], 4032, 3024)).toEqual([1344, 3024]);
  });

  it("facadeAlignStatus: NOW only with pairs; the failure wins over a stale solve; the note at N ≥ 4 only", () => {
    expect(facadeAlignStatus({ n: 0, rmsNowPx: null, planar: null })).toEqual([]);
    expect(facadeAlignStatus({ n: 2, rmsNowPx: 7.25, planar: true })).toEqual([{ text: "NOW · RMS 7.3 PX", tone: "" }]);
    const solved = { pose: {} as FacadeSolved["pose"], rmsPx: 1, n: 4, fovSolved: false, planar: true, at: "" };
    const lines = facadeAlignStatus({ n: 4, rmsNowPx: 1, solved, failure: "nope", planar: true });
    expect(lines.map((l) => l.tone)).toEqual(["", "warn", ""]);
    expect(lines[1].text).toBe("NOPE");
    expect(lines[2].text).toBe(FACADE_PLANAR_NOTE);
    expect(facadeAlignStatus({ n: 4, rmsNowPx: 1, solved, planar: false })[1]).toEqual({
      text: "SOLVED · RMS 1.0 PX · 4 PAIRS · LENS HELD",
      tone: "ok",
    });
  });
});

describe("the pick surfaces", () => {
  it("the PHOTO overlay: header, ✕ CANCEL, the image sized to the photo, the dots", () => {
    const html = renderToStaticMarkup(
      createElement(FacadePickOverlayView, {
        previewUrl: "blob:preview",
        textureWidth: W,
        textureHeight: H,
        pairs: PAIRS.slice(0, 2),
        onPick: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(html).toContain('class="ff-pick"');
    expect(html).toContain("PAIR 3 — CLICK THE POINT ON THE PHOTO");
    expect(html).toContain("data-facade-pick-cancel");
    expect(html).toContain("✕ CANCEL");
    expect(tagOf(html, "data-facade-pick-img")).toMatch(/draggable="false"/);
    expect(tagOf(html, "data-facade-pick-img")).toContain(`aspect-ratio:${W} / ${H}`);
    expect(html.match(/class="ff-align__dot"/g)?.length).toBe(2);
  });

  it("the GLOBE hint: the pd-hint pill + ESC · CANCEL", () => {
    const html = renderToStaticMarkup(createElement(FacadeGlobeHintView, { n: 5, onCancel: () => undefined }));
    expect(html).toContain('class="pd-hint"');
    expect(html).toContain("pd-hint__pulse");
    expect(html).toContain("PAIR 5 — CLICK THE SAME POINT ON A BUILDING");
    expect(html).toContain("ESC · CANCEL");
    expect(html).toContain("data-facade-pick-cancel");
  });
});

// ── solveFacadeDraftNow end to end ────────────────────────────────────────────────────────────────

/** Phone-style street photo (test/store/facadePhoto.test.ts's EXIF_GPS). */
const EXIF_GPS: PhotoExif = {
  make: "Apple",
  model: "iPhone 15 Pro",
  focalLengthMm: 6.86,
  gpsLat: 48.4647,
  gpsLon: 35.0462,
  gpsAltitudeM: 96,
  headingDeg: 214,
  rollDeg: 1.5,
};
const extracted = (exif: PhotoExif): ExtractedPhoto => ({
  fileName: "FACADE_0001.JPG",
  fileSizeBytes: 4 * 1024 * 1024,
  previewSource: "none",
  previewUrl: "blob:preview",
  textureWidth: W,
  textureHeight: H,
  exif,
});
const s = () => useFacadePhotoStore.getState();
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

describe("solveFacadeDraftNow — a misplaced draft + pairs on the real wall → the truth, journaled", () => {
  beforeEach(() => {
    s().clear();
    editJournal.entries.length = 0;
    editJournal.baselines.clear();
    calls.length = 0;
  });

  it("refuses without a seated draft or below 4 pairs (nothing written, nothing journaled)", () => {
    expect(solveFacadeDraftNow(false).ok).toBe(false);
    s().ingest(extracted(EXIF_GPS));
    s().place();
    s()._syncApex(101.5, 1.7);
    const r = solveFacadeDraftNow(false);
    expect(r.ok).toBe(false);
    expect(s().solved).toBeUndefined();
    expect(editJournal.entries.length).toBe(0);
  });

  it("8 pairs picked through the store's machine: the pose lands on the truth; solved set; one 'solve' entry", () => {
    s().ingest(extracted(EXIF_GPS));
    s().place();
    s()._syncApex(101.5, 1.7);
    const draft = facadeDraftPoseOf(s());
    if (!draft) throw new Error("no draft");
    const mPerDegLon = M_PER_DEG_LAT * Math.cos(draft.lat * DEG);
    // The TRUTH: the draft is the truth 4 m east and 3° of heading off.
    const TRUTH = {
      latDeg: draft.lat,
      lonDeg: draft.lon - 4 / mPerDegLon,
      altM: draft.apexAltM,
      headingDeg: draft.headingDeg - 3,
      pitchDeg: draft.pitchDeg,
      rollDeg: draft.rollDeg,
      hFovDeg: draft.hFovDeg,
    };
    const GRID: [number, number][] = [[0.1, 0.15], [0.9, 0.15], [0.9, 0.85], [0.1, 0.85], [0.5, 0.5], [0.3, 0.7], [0.7, 0.3], [0.5, 0.9]];
    const geom = frustumGeometry({ ...TRUTH, vFovDeg: verticalFovDeg(TRUTH.hFovDeg, W / H), planeDistM: 25 });
    const [tl, tr, br, bl] = geom.corners;
    const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    for (const [u, v] of GRID) {
      s().startPairPick();
      expect(s().pairPick).toBe("photo");
      s().setPendingUv([u, v]);
      expect(s().pairPick).toBe("globe");
      const origin = s().pairOrigin as FacadeAlignOrigin;
      s().completePair(enuOfEcef(origin, lerp(lerp(tl, bl, v), lerp(tr, br, v), u)), "osm:w132547176");
    }
    expect(s().pairs.length).toBe(8);
    // The origin IS the draft's apex at the first pick.
    expect(s().pairOrigin).toEqual({ lat: draft.lat, lon: draft.lon, altM: 101.5 });
    // Before the solve the live residual is large (4 m + 3° off a 25 m wall).
    expect(liveResiduals(s().pairs, s().pairOrigin, draft).rmsPx!).toBeGreaterThan(50);

    const before = s().poseSnapshot();
    const r = solveFacadeDraftNow(false);
    if (!r.ok) throw new Error(r.reason);
    const after = s().poseSnapshot()!;
    const p = s().placement!;
    expect(Math.hypot((p.latDeg - TRUTH.latDeg) * M_PER_DEG_LAT, (p.lonDeg - TRUTH.lonDeg) * mPerDegLon)).toBeLessThan(1e-3);
    expect(Math.abs(after.headingDeg! - TRUTH.headingDeg)).toBeLessThan(1e-3);
    expect(Math.abs(after.pitchDeg! - TRUTH.pitchDeg)).toBeLessThan(1e-3);
    expect(Math.abs(after.rollDeg! - TRUTH.rollDeg)).toBeLessThan(1e-3);
    expect(Math.abs(after.altitudeM! - 1.7)).toBeLessThan(1e-3); // the eye over the ground under the draft
    expect(after.hFovDeg).toBe(draft.hFovDeg); // held — the lens box was off
    expect(s().solved).toBeDefined();
    expect(s().solved!.pose).toEqual(after);
    expect(s().solved!.n).toBe(8);
    expect(r.clamped).toBe(false);
    const last = editJournal.entries[editJournal.entries.length - 1];
    expect(last.label).toBe("solve");
    expect(last.steps[0].target).toBe("facade|draft");
    expect(last.steps[0].before).toEqual(before);
    expect(last.steps[0].after).toEqual(after);
    expect(last.steps[0].before).not.toEqual(last.steps[0].after);
    // The live readout of the solved pose (the apex re-seated the same) is ~0.
    s()._syncApex(101.5, 1.7);
    expect(liveResiduals(s().pairs, s().pairOrigin, facadeDraftPoseOf(s())).rmsPx!).toBeLessThan(0.05);
  });
});

describe("facadePoseIsSolved — the badge predicate survives a RE-OPEN (the advisor's catch, 2026-10-24c)", () => {
  const ROW_POSE = { lat: 48.4651, lon: 35.047, altitudeM: 1.7, headingDeg: 212.4, pitchDeg: 3.5, rollDeg: -1, hFovDeg: 69.4 };
  const item = {
    id: "fac_solved",
    title: "Kyiv facade",
    displayUrl: "https://static.wixstatic.com/media/x-display.jpg",
    thumbUrl: null,
    updatedAt: "2026-10-24T10:00:00.000Z",
    lat: ROW_POSE.lat,
    lon: ROW_POSE.lon,
    apexAltM: 101.2,
    altitudeM: ROW_POSE.altitudeM,
    headingDeg: ROW_POSE.headingDeg,
    pitchDeg: ROW_POSE.pitchDeg,
    rollDeg: ROW_POSE.rollDeg,
    focalLengthMm: 6.86,
    hFovDeg: ROW_POSE.hFovDeg,
    fovEstimated: false,
    textureWidth: 2048,
    textureHeight: 1536,
    strength: 0.8,
    ownLight: 0.4,
    rangeM: 450,
    targetFeatureIds: [],
    alignment: {
      pairs: [{ uv: [0.1, 0.2], enu: [1, 2, 3] }, { uv: [0.3, 0.4], enu: [4, 5, 6] }, { uv: [0.5, 0.6], enu: [7, 8, 9] }, { uv: [0.7, 0.8], enu: [1, 8, 3] }],
      origin: { lat: 48.4651, lon: 35.047, altM: 101.2 },
      solved: { pose: { ...ROW_POSE }, rmsPx: 0.8, n: 4, fovSolved: false, planar: true, at: "2026-10-24T10:00:00.000Z" },
    },
    capturedAt: null,
    cameraMake: "Apple",
    cameraModel: "iPhone 15 Pro",
    lensModel: null,
    fileName: "IMG_0001.HEIC",
    fileSizeBytes: 3_000_000,
    poseSource: "SOLVED" as const,
    exifPose: null,
    createdAt: "2026-10-20T09:00:00.000Z",
    isPublic: false,
    moderation: "PRIVATE",
  };

  it("a re-opened SOLVED row reads solved although its raw snapshot holds nulls (the knobs live in the synthesized EXIF)", () => {
    const st = useFacadePhotoStore.getState();
    st.openSaved(item as never);
    const snap = useFacadePhotoStore.getState().poseSnapshot()!;
    expect(snap.rollDeg).toBeNull(); // the raw snapshot would never match the solve
    expect(snap.hFovDeg).toBeNull();
    expect(facadePoseIsSolved(useFacadePhotoStore.getState())).toBe(true);
  });

  it("a nudge after the re-open drops it; the solve record stays until the pairs clear", () => {
    useFacadePhotoStore.getState().openSaved(item as never);
    useFacadePhotoStore.getState().setParam("headingDeg", 213);
    expect(facadePoseIsSolved(useFacadePhotoStore.getState())).toBe(false);
    expect(useFacadePhotoStore.getState().solved?.n).toBe(4);
    useFacadePhotoStore.getState().setParam("headingDeg", ROW_POSE.headingDeg);
    expect(facadePoseIsSolved(useFacadePhotoStore.getState())).toBe(true);
    useFacadePhotoStore.getState().clearPairs();
    expect(facadePoseIsSolved(useFacadePhotoStore.getState())).toBe(false);
  });

  it("no solve record → false; a fresh draft with no exif → false", () => {
    useFacadePhotoStore.getState().clear();
    expect(facadePoseIsSolved(useFacadePhotoStore.getState())).toBe(false);
  });
});
