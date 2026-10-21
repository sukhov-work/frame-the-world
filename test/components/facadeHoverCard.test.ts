import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FacadeHoverCard, { FacadeHoverCardView } from "../../src/components/panels/FacadeHoverCard";
import { _resetFacadesStore, facadeRowById, useFacadesStore } from "../../src/store/facades";
import { facadePoseLine, type FacadeListItem, type FacadeWorldItem } from "../../src/lib/wix/facadeRecords";

// T183 (owner ask 2026-10-22): the COMPACT hover card over a saved-facade marker — thumb, title,
// pose line. The store is seeded and the row resolved through the real `facadeRowById`; the view
// takes its state as props (zustand 5 serves a hook its INITIAL state under renderToStaticMarkup —
// the myModelsTab idiom), and the store-bound default export is proven empty at that initial state.

const world = (id: string, over: Partial<FacadeWorldItem> = {}): FacadeWorldItem => ({
  id,
  title: `Facade ${id}`,
  displayUrl: `https://static.wixstatic.com/media/${id}-display.jpg`,
  thumbUrl: `https://static.wixstatic.com/media/${id}-thumb.jpg`,
  updatedAt: "2026-10-21T10:00:00.000Z",
  lat: 48.4647,
  lon: 35.0462,
  apexAltM: 137.5,
  altitudeM: 1.7,
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  focalLengthMm: 26,
  hFovDeg: 69,
  fovEstimated: false,
  textureWidth: 4032,
  textureHeight: 3024,
  strength: 1,
  ownLight: 0.6,
  rangeM: null,
  ...over,
});
const mine = (id: string, over: Partial<FacadeListItem> = {}): FacadeListItem => ({
  ...world(id),
  targetFeatureIds: [],
  alignment: {},
  capturedAt: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  fileName: null,
  fileSizeBytes: null,
  poseSource: "EXIF",
  exifPose: null,
  createdAt: "2026-10-21T10:00:00.000Z",
  isPublic: false,
  moderation: "PRIVATE",
  ...over,
});

/** Render what the store-bound card would, from the store's CURRENT state. */
const renderFromStore = () => {
  const s = useFacadesStore.getState();
  const item = s.hover ? facadeRowById(s, s.hover.id) : null;
  return renderToStaticMarkup(createElement(FacadeHoverCardView, { hover: s.hover, item }));
};

afterEach(() => _resetFacadesStore());

describe("facadePoseLine", () => {
  it("hemisphere letters, 5 decimals, heading to 0.1°", () => {
    expect(facadePoseLine({ lat: 48.4647, lon: 35.0462, headingDeg: 90 })).toBe("N 48.46470 E 35.04620 · 90.0°");
    expect(facadePoseLine({ lat: -33.8688, lon: -151.2093, headingDeg: 214.04 })).toBe("S 33.86880 W 151.20930 · 214.0°");
  });
});

describe("FacadeHoverCard", () => {
  it("an own row: the thumb, the title, the pose line, aria-hidden, at the mirrored screen point", () => {
    useFacadesStore.setState({ mine: [mine("a", { title: "Sobornyi facade" })], hover: { id: "a", screen: { x: 120, y: 340 } } });
    const html = renderFromStore();
    expect(html).toContain('class="fhover"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/left:120px/);
    expect(html).toMatch(/top:340px/);
    expect(html).toContain('src="https://static.wixstatic.com/media/a-thumb.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt=""');
    expect(html).toContain("Sobornyi facade");
    expect(html).toContain("N 48.46470 E 35.04620 · 90.0°");
    expect(html).toContain("H-FOV 69°");
  });

  it("no thumb → the display image stands in", () => {
    useFacadesStore.setState({ mine: [mine("a", { thumbUrl: null })], hover: { id: "a", screen: { x: 1, y: 2 } } });
    expect(renderFromStore()).toContain('src="https://static.wixstatic.com/media/a-display.jpg"');
  });

  it("a world-only row resolves too", () => {
    useFacadesStore.setState({ mine: [], world: [world("w", { title: "World one" })], hover: { id: "w", screen: { x: 5, y: 6 } } });
    const html = renderFromStore();
    expect(html).toContain("World one");
    expect(html).toContain('data-facade-hover="w"');
  });

  it("null hover, or a hover on a row that is gone → nothing", () => {
    useFacadesStore.setState({ mine: [mine("a")], hover: null });
    expect(renderFromStore()).toBe("");
    useFacadesStore.setState({ hover: { id: "gone", screen: { x: 1, y: 1 } } });
    expect(renderFromStore()).toBe("");
  });

  it("the store-bound island renders nothing at the initial state", () => {
    expect(renderToStaticMarkup(createElement(FacadeHoverCard))).toBe("");
  });
});
