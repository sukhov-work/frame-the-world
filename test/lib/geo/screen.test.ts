import { describe, expect, it } from "vitest";
import { clientToNdc, ndcToClient } from "../../../src/lib/geo/screen";

const rect = { left: 100, top: 50, width: 800, height: 600 };

describe("clientToNdc", () => {
  it("maps the viewport centre to the origin", () => {
    const [x, y] = clientToNdc(rect.left + rect.width / 2, rect.top + rect.height / 2, rect);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it("flips y (client +y down → NDC +y up) and puts corners at ±1", () => {
    expect(clientToNdc(rect.left, rect.top, rect)).toEqual([-1, 1]); // top-left → (-1, +1)
    expect(clientToNdc(rect.left + rect.width, rect.top + rect.height, rect)).toEqual([1, -1]);
  });
});

describe("ndcToClient", () => {
  it("is the inverse of clientToNdc at arbitrary points (up to rounding)", () => {
    for (const [cx, cy] of [
      [123, 77],
      [640, 410],
      [899, 649],
    ]) {
      const [nx, ny] = clientToNdc(cx, cy, rect);
      const back = ndcToClient(nx, ny, rect);
      expect(back.x).toBe(Math.round(cx));
      expect(back.y).toBe(Math.round(cy));
    }
  });
});
