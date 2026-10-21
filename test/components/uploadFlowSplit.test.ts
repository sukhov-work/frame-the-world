import { describe, expect, it } from "vitest";
import { read, ruleBody, stripComments } from "../styles/_css";

/**
 * T181 (owner 2026-10-22) — the Upload overlay's dropzone, SPLIT: the upper half is the pin flow
 * (photo | model, `classifyDrop` as before), the lower half the facade texture flow. The drop
 * TARGET decides which store ingests; the fork lives in UploadFlow, so the facade component still
 * never imports `store/upload`. Source-as-text (the facadePanel idiom): DropStep reads four
 * stores and wires DOM refs, so a static render would prove less than these shapes do.
 */

const SRC = "src/components/panels/UploadFlow.tsx";
const CSS = "src/styles/upload-flow.css";
const code = stripComments(read(SRC));
const drop = code.slice(code.indexOf("function DropStep"), code.indexOf("function ReviewStep"));
const pinHalf = drop.slice(drop.indexOf("uf-dropzone--pin"), drop.indexOf("uf-dropzone--facade"));
const facadeHalf = drop.slice(drop.indexOf("uf-dropzone uf-dropzone--facade"));

describe("the two halves", () => {
  it("the upper half is the pin flow, the lower half the facade flow — in that order", () => {
    expect(drop).toMatch(/className="uf-dropsplit"/);
    expect(drop).toMatch(/`uf-dropzone uf-dropzone--pin\$\{dragOver \? " uf-dropzone--over" : ""\}`/);
    expect(drop).toMatch(/`uf-dropzone uf-dropzone--facade\$\{facadeOver \? " uf-dropzone--over" : ""\}`/);
    expect(drop.indexOf("uf-dropzone--pin")).toBeLessThan(drop.indexOf("uf-dropzone--facade"));
    expect(facadeHalf).toContain("FACADE TEXTURE — A PHOTO PROJECTED ONTO THE BUILDINGS");
    expect(facadeHalf).toContain("Drop a photo of a facade here");
  });

  it("each half owns its dragover, its drop, its click target and its file input", () => {
    expect(pinHalf).toMatch(/onDrop=\{onDrop\}/);
    expect(pinHalf).toMatch(/inputRef\.current\?\.click\(\)/);
    expect(pinHalf).toMatch(/ref=\{inputRef\}[\s\S]*type="file"[\s\S]*accept=\{ACCEPT\}[\s\S]*multiple/);
    expect(facadeHalf).toMatch(/onDrop=\{onFacadeDrop\}/);
    expect(facadeHalf).toMatch(/facadeInputRef\.current\?\.click\(\)/);
    // the harness contract `.uf-dropzone--facade input[type=file]`: the input is INSIDE the half
    const facadeInput = facadeHalf.slice(facadeHalf.indexOf("<input"), facadeHalf.indexOf("/>", facadeHalf.indexOf("<input")));
    expect(facadeInput).toMatch(/ref=\{facadeInputRef\}/);
    expect(facadeInput).toMatch(/type="file"/);
    expect(facadeInput).toMatch(/accept=\{PHOTO_ACCEPT\}/); // photos only
    expect(facadeInput).not.toMatch(/\bmultiple\b/); // one file
    // an input inside its own click target must not re-trigger it
    expect((drop.match(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/g) ?? []).length).toBe(2);
  });

  it("the pin half keeps the photo | model fork; the facade half hands over to the facade store", () => {
    expect(drop).toMatch(/const drop = classifyDrop\(list\);/);
    expect(drop).toMatch(/useUploadStore\.getState\(\)\.loadFile\(list\[drop\.index\]\)/);
    expect(drop).toMatch(
      /const facade = useFacadePhotoStore\.getState\(\);\s*facade\.openPanel\(\);\s*void facade\.loadFile\(files\[0\]\);\s*useUploadStore\.getState\(\)\.closePanel\(\);/,
    );
    expect(code).toMatch(/import \{ useFacadePhotoStore \} from "\.\.\/\.\.\/store\/facadePhoto";/);
  });

  it("never posts a form, never autofocuses", () => {
    expect(code).not.toMatch(/method=["']post["']/i);
    expect(code).not.toMatch(/autoFocus/);
  });
});

describe("the split's styles", () => {
  const css = read(CSS);
  const block = css.slice(css.indexOf(".uf-dropsplit {"), css.indexOf(".uf-dropzone__icon {"));

  it("the halves share the height, a thin divider between, each labelled, the lower one dimmer", () => {
    expect(ruleBody(css, ".uf-dropsplit")).toMatch(/flex:\s*1/);
    expect(ruleBody(css, ".uf-dropzone--pin")).toMatch(/flex:/);
    const facade = ruleBody(css, ".uf-dropzone--facade");
    expect(facade).toMatch(/flex:/);
    expect(facade).toMatch(/border-top:\s*1px solid var\(--color-border\)/);
    expect(facade).toMatch(/opacity:/);
    expect(css).toMatch(/\.uf-dropzone--facade:hover,\s*\.uf-dropzone--facade\.uf-dropzone--over\s*{\s*opacity:\s*1;/);
    ruleBody(css, ".uf-dropzone__label");
  });

  it("the new block uses tokens only", () => {
    const body = stripComments(block);
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toMatch(/rgba?\(/);
  });
});
