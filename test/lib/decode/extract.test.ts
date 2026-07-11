import { describe, it, expect } from "vitest";
import {
  fileExtension,
  isRawFile,
  isHeicFile,
  isBrowserDisplayable,
} from "../../../src/lib/decode/extract";

describe("fileExtension", () => {
  it("lowercases the last dotted segment", () => {
    expect(fileExtension("Photo.ARW")).toBe("arw");
    expect(fileExtension("a.b.JPeg")).toBe("jpeg");
  });
  it("is empty for no extension / trailing dot", () => {
    expect(fileExtension("noext")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
  });
});

describe("isRawFile — gates the WASM decode path", () => {
  it("matches the supported RAW extensions, case-insensitively", () => {
    for (const n of ["a.arw", "b.DNG", "c.cr3", "d.nef", "e.raf"]) {
      expect(isRawFile(n)).toBe(true);
    }
  });
  it("rejects displayable + HEIC + unknown", () => {
    for (const n of ["x.jpg", "y.png", "z.heic", "w.txt", "noext"]) {
      expect(isRawFile(n)).toBe(false);
    }
  });
});

describe("isHeicFile", () => {
  it("matches heic/heif only", () => {
    expect(isHeicFile("p.HEIC")).toBe(true);
    expect(isHeicFile("p.heif")).toBe(true);
    expect(isHeicFile("p.arw")).toBe(false);
    expect(isHeicFile("p.jpg")).toBe(false);
  });
});

describe("isBrowserDisplayable — the no-WASM native path", () => {
  it("accepts the browser-paintable image MIME types", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]) {
      expect(isBrowserDisplayable(m)).toBe(true);
    }
  });
  it("rejects RAW/HEIC/other MIME types", () => {
    for (const m of ["image/x-adobe-dng", "image/heic", "application/octet-stream", ""]) {
      expect(isBrowserDisplayable(m)).toBe(false);
    }
  });
});
