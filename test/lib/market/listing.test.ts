import { describe, expect, it } from "vitest";
import {
  buildDigitalProduct,
  formatPrice,
  MAX_PRICE,
  normalizePrice,
  parseListBody,
  STORES_APP_ID,
} from "../../../src/lib/market/listing";

describe("STORES_APP_ID", () => {
  it("is the fixed Wix-Stores catalog app id used in every checkout catalogReference", () => {
    // Verified in @wix/auto_sdk_ecom_checkout CatalogReference.appId docs — NOT the metasite TPA id.
    expect(STORES_APP_ID).toBe("215238eb-22a5-4c36-9e7b-e7c08025e04e");
  });
});

describe("buildDigitalProduct", () => {
  it("builds a single-variant DIGITAL product with the media file as the secured digital file", () => {
    const p = buildDigitalProduct("Dnipro rooftop", 12.5, "orig-abc~mv2.arw");
    expect(p.productType).toBe("DIGITAL");
    expect(p.name).toBe("Dnipro rooftop");
    expect(p.variantsInfo.variants).toHaveLength(1);
    const v = p.variantsInfo.variants[0];
    // The SDK field is digitalFile._id (verified 2026-07-16) — NOT `id`.
    expect(v.digitalProperties.digitalFile._id).toBe("orig-abc~mv2.arw");
    // Price is a 2-dp string in the actualPrice.amount slot.
    expect(v.price.actualPrice.amount).toBe("12.50");
  });

  it("defaults a blank name and clamps a long one to 80 chars", () => {
    expect(buildDigitalProduct("", 5, "f").name).toBe("Untitled photo");
    expect(buildDigitalProduct("x".repeat(200), 5, "f").name).toHaveLength(80);
  });

  it("formats whole prices to two decimals", () => {
    expect(buildDigitalProduct("n", 9, "f").variantsInfo.variants[0].price.actualPrice.amount).toBe("9.00");
  });
});

describe("normalizePrice", () => {
  it("accepts positive numbers and strings, rounding to 2 dp", () => {
    expect(normalizePrice(9.99)).toBe(9.99);
    expect(normalizePrice("12.5")).toBe(12.5);
    expect(normalizePrice(3.14159)).toBe(3.14);
  });

  it("rejects zero, negatives, NaN, over-max and non-numeric", () => {
    expect(normalizePrice(0)).toBeNull();
    expect(normalizePrice(-4)).toBeNull();
    expect(normalizePrice(Number.NaN)).toBeNull();
    expect(normalizePrice(MAX_PRICE + 1)).toBeNull();
    expect(normalizePrice("free")).toBeNull();
    expect(normalizePrice(null)).toBeNull();
    expect(normalizePrice(undefined)).toBeNull();
  });
});

describe("parseListBody", () => {
  it("accepts a valid { photoId, priceAmount }", () => {
    const r = parseListBody({ photoId: "photo-1", priceAmount: 20 });
    expect(r).toEqual({ photoId: "photo-1", priceAmount: 20 });
  });

  it("rejects a missing/blank photoId", () => {
    expect(parseListBody({ priceAmount: 5 })).toEqual({ error: expect.stringContaining("photoId") });
    expect(parseListBody({ photoId: "", priceAmount: 5 })).toEqual({
      error: expect.stringContaining("photoId"),
    });
  });

  it("rejects an invalid price", () => {
    expect(parseListBody({ photoId: "p", priceAmount: 0 })).toEqual({
      error: expect.stringContaining("priceAmount"),
    });
    expect(parseListBody({ photoId: "p", priceAmount: "abc" })).toEqual({
      error: expect.stringContaining("priceAmount"),
    });
  });

  it("rejects a non-object body", () => {
    expect(parseListBody(null)).toEqual({ error: expect.any(String) });
    expect(parseListBody("nope")).toEqual({ error: expect.any(String) });
  });
});

describe("formatPrice", () => {
  it("appends the currency when known and trims trailing .00", () => {
    expect(formatPrice(12.5, "USD")).toBe("12.50 USD");
    expect(formatPrice(9, "EUR")).toBe("9 EUR");
    expect(formatPrice(9, null)).toBe("9");
  });

  it("returns an empty string for a null amount", () => {
    expect(formatPrice(null, "USD")).toBe("");
    expect(formatPrice(undefined, null)).toBe("");
  });
});
