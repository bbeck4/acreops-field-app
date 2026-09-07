import { describe, it, expect } from "vitest";

import {
  AUDIENCE_DEFAULT,
  EMPTY_FILTER_STATE,
  FIXED_GLYPH,
  MARKER_BOX,
  MIN_GLYPH,
  MAX_GLYPH,
  acreageGlyphSize,
  audienceOptionsForUser,
  buildMapPinsParams,
  canShowProspects,
  effectiveAudience,
  filterPinsByAudience,
  isFilterStateDefault,
  mapPinsCacheKey,
  markerGlyphSize,
  markerVisualKey,
  parseNonnegativeAcres,
  validateAcreageFilters,
  type CustomerMapFilterInput,
} from "@/lib/customerMap";

function input(overrides: Partial<CustomerMapFilterInput> = {}): CustomerMapFilterInput {
  return {
    audience: "both",
    county: "",
    zip: "",
    minAcres: "",
    maxAcres: "",
    ...overrides,
  };
}

describe("defaults", () => {
  it("defaults audience to both", () => {
    expect(AUDIENCE_DEFAULT).toBe("both");
    expect(EMPTY_FILTER_STATE.audience).toBe("both");
  });

  it("isFilterStateDefault only true for the empty default state", () => {
    expect(isFilterStateDefault(EMPTY_FILTER_STATE)).toBe(true);
    expect(isFilterStateDefault({ ...EMPTY_FILTER_STATE, audience: "customers" })).toBe(false);
    expect(isFilterStateDefault({ ...EMPTY_FILTER_STATE, county: "Story" })).toBe(false);
    expect(isFilterStateDefault({ ...EMPTY_FILTER_STATE, zip: "50010" })).toBe(false);
    expect(isFilterStateDefault({ ...EMPTY_FILTER_STATE, minAcres: "10" })).toBe(false);
    expect(isFilterStateDefault({ ...EMPTY_FILTER_STATE, maxAcres: "10" })).toBe(false);
    // whitespace-only text still counts as default
    expect(isFilterStateDefault({ ...EMPTY_FILTER_STATE, county: "   " })).toBe(true);
  });
});

describe("parseNonnegativeAcres", () => {
  it("parses valid nonnegative numbers", () => {
    expect(parseNonnegativeAcres("0")).toBe(0);
    expect(parseNonnegativeAcres("120")).toBe(120);
    expect(parseNonnegativeAcres(" 40.5 ")).toBe(40.5);
  });

  it("rejects blank, invalid, and negative", () => {
    expect(parseNonnegativeAcres("")).toBeUndefined();
    expect(parseNonnegativeAcres("   ")).toBeUndefined();
    expect(parseNonnegativeAcres(null)).toBeUndefined();
    expect(parseNonnegativeAcres(undefined)).toBeUndefined();
    expect(parseNonnegativeAcres("abc")).toBeUndefined();
    expect(parseNonnegativeAcres("-5")).toBeUndefined();
    expect(parseNonnegativeAcres("NaN")).toBeUndefined();
  });
});

describe("validateAcreageFilters", () => {
  it("rejects invalid and inverted ranges", () => {
    expect(validateAcreageFilters(input({ minAcres: "-1" }))).toMatch(/Minimum/);
    expect(validateAcreageFilters(input({ maxAcres: "abc" }))).toMatch(/Maximum/);
    expect(validateAcreageFilters(input({ minAcres: "500", maxAcres: "100" }))).toMatch(
      /cannot be greater/,
    );
  });

  it("accepts blank and ordered ranges", () => {
    expect(validateAcreageFilters(input())).toBeNull();
    expect(validateAcreageFilters(input({ minAcres: "100", maxAcres: "500" }))).toBeNull();
  });
});

describe("prospect suppression", () => {
  it("canShowProspects requires permission and no server suppression", () => {
    expect(canShowProspects({ hasProspectPermission: true })).toBe(true);
    expect(canShowProspects({ hasProspectPermission: false })).toBe(false);
    expect(canShowProspects({ hasProspectPermission: true, serverSuppressed: true })).toBe(false);
    expect(canShowProspects({ hasProspectPermission: false, serverSuppressed: false })).toBe(false);
  });

  it("effectiveAudience downgrades to customers when prospects are not allowed", () => {
    expect(effectiveAudience("both", false)).toBe("customers");
    expect(effectiveAudience("prospects", false)).toBe("customers");
    expect(effectiveAudience("customers", false)).toBe("customers");
    expect(effectiveAudience("both", true)).toBe("both");
    expect(effectiveAudience("prospects", true)).toBe("prospects");
    expect(effectiveAudience("customers", true)).toBe("customers");
  });

  it("audienceOptionsForUser hides prospect/both options for non-sales roles", () => {
    expect(audienceOptionsForUser(true)).toEqual(["both", "customers", "prospects"]);
    expect(audienceOptionsForUser(false)).toEqual(["customers"]);
  });
});

describe("filterPinsByAudience", () => {
  const pins = [
    { id: 1, kind: "customer" },
    { id: 2, kind: "prospect" },
    { id: 3, kind: "customer" },
    { id: 4, kind: "prospect" },
  ];

  it("returns both kinds for audience=both when allowed", () => {
    const out = filterPinsByAudience(pins, "both", true);
    expect(out.map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });

  it("returns only customers for audience=customers", () => {
    const out = filterPinsByAudience(pins, "customers", true);
    expect(out.map((p) => p.id)).toEqual([1, 3]);
  });

  it("returns only prospects for audience=prospects when allowed", () => {
    const out = filterPinsByAudience(pins, "prospects", true);
    expect(out.map((p) => p.id)).toEqual([2, 4]);
  });

  it("strips prospect pins for non-sales roles even if audience asks for them", () => {
    expect(filterPinsByAudience(pins, "both", false).map((p) => p.id)).toEqual([1, 3]);
    expect(filterPinsByAudience(pins, "prospects", false).map((p) => p.id)).toEqual([]);
  });
});

describe("buildMapPinsParams", () => {
  it("sends explicit audience + matching includeProspects fallback", () => {
    expect(buildMapPinsParams(input({ audience: "both" }), true)).toMatchObject({
      audience: "both",
      includeProspects: true,
    });
    expect(buildMapPinsParams(input({ audience: "customers" }), true)).toMatchObject({
      audience: "customers",
      includeProspects: false,
    });
    expect(buildMapPinsParams(input({ audience: "prospects" }), true)).toMatchObject({
      audience: "prospects",
      includeProspects: true,
    });
  });

  it("never requests prospects for non-sales roles", () => {
    const p = buildMapPinsParams(input({ audience: "both" }), false);
    expect(p.audience).toBe("customers");
    expect(p.includeProspects).toBe(false);
  });

  it("includes normalised county/zip/acreage and omits blanks", () => {
    const p = buildMapPinsParams(
      input({ county: "  Story  ", zip: " 50010 ", minAcres: "10", maxAcres: "500" }),
      true,
    );
    expect(p.county).toBe("Story");
    expect(p.zip).toBe("50010");
    expect(p.minAcres).toBe(10);
    expect(p.maxAcres).toBe(500);

    const empty = buildMapPinsParams(input(), true);
    expect(empty.county).toBeUndefined();
    expect(empty.zip).toBeUndefined();
    expect(empty.minAcres).toBeUndefined();
    expect(empty.maxAcres).toBeUndefined();
  });

  it("drops negative/invalid acreage", () => {
    const p = buildMapPinsParams(input({ minAcres: "-3", maxAcres: "x" }), true);
    expect(p.minAcres).toBeUndefined();
    expect(p.maxAcres).toBeUndefined();
  });

  it("includes repId when present", () => {
    expect(buildMapPinsParams(input({ repId: 7 }), true).repId).toBe(7);
    expect(buildMapPinsParams(input(), true).repId).toBeUndefined();
  });
});

describe("mapPinsCacheKey", () => {
  it("differs by every filter dimension so responses can't overwrite each other", () => {
    const base = mapPinsCacheKey(input(), true);
    expect(mapPinsCacheKey(input({ audience: "customers" }), true)).not.toBe(base);
    expect(mapPinsCacheKey(input({ audience: "prospects" }), true)).not.toBe(base);
    expect(mapPinsCacheKey(input({ county: "Story" }), true)).not.toBe(base);
    expect(mapPinsCacheKey(input({ zip: "50010" }), true)).not.toBe(base);
    expect(mapPinsCacheKey(input({ minAcres: "10" }), true)).not.toBe(base);
    expect(mapPinsCacheKey(input({ maxAcres: "10" }), true)).not.toBe(base);
    expect(mapPinsCacheKey(input({ repId: 3 }), true)).not.toBe(base);
  });

  it("is stable/order-independent for equivalent normalised states", () => {
    const a = mapPinsCacheKey(input({ county: "Story", zip: "50010" }), true);
    const b = mapPinsCacheKey(input({ county: " Story ", zip: " 50010 " }), true);
    expect(a).toBe(b);
  });

  it("collapses to a customers-only key when prospects are suppressed", () => {
    const suppressed = mapPinsCacheKey(input({ audience: "both" }), false);
    const customers = mapPinsCacheKey(input({ audience: "customers" }), true);
    expect(suppressed).toBe(customers);
  });
});

describe("acreageGlyphSize", () => {
  it("clamps null/zero/invalid to the minimum", () => {
    expect(acreageGlyphSize(null, "customer")).toBe(MIN_GLYPH);
    expect(acreageGlyphSize(undefined, "customer")).toBe(MIN_GLYPH);
    expect(acreageGlyphSize(0, "customer")).toBe(MIN_GLYPH);
    expect(acreageGlyphSize(-100, "customer")).toBe(MIN_GLYPH);
    expect(acreageGlyphSize(Number.NaN, "customer")).toBe(MIN_GLYPH);
  });

  it("grows monotonically with acreage", () => {
    const sizes = [1, 50, 200, 800, 2000].map((a) => acreageGlyphSize(a, "customer"));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
    // small vs large is a meaningful (strict) increase, not saturated at min
    expect(acreageGlyphSize(1000, "customer")).toBeGreaterThan(acreageGlyphSize(10, "customer"));
  });

  it("never exceeds the customer ceiling", () => {
    expect(acreageGlyphSize(1e9, "customer")).toBeLessThanOrEqual(MAX_GLYPH);
    expect(acreageGlyphSize(1e9, "customer")).toBe(MAX_GLYPH);
  });

  it("keeps a prospect star comfortably inside the declared marker box", () => {
    const glyph = acreageGlyphSize(1e9, "prospect");
    // diagonal of the rotated square must fit within MARKER_BOX
    expect(glyph * Math.SQRT2).toBeLessThanOrEqual(MARKER_BOX + 1e-9);
    expect(glyph).toBeGreaterThanOrEqual(MIN_GLYPH);
  });

  it("returns whole-point sizes so identical acreage yields identical size", () => {
    const a = acreageGlyphSize(437, "customer");
    const b = acreageGlyphSize(437, "customer");
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
  });
});

describe("markerGlyphSize / markerVisualKey", () => {
  it("uses a fixed size when sizeByAcreage is off, regardless of acreage", () => {
    expect(markerGlyphSize(false, 5, "customer")).toBe(markerGlyphSize(false, 5000, "customer"));
    expect(markerGlyphSize(false, 5, "customer")).toBe(Math.min(FIXED_GLYPH, MAX_GLYPH));
  });

  it("scales with acreage when sizeByAcreage is on", () => {
    expect(markerGlyphSize(true, 2000, "customer")).toBeGreaterThan(markerGlyphSize(true, 5, "customer"));
  });

  it("keeps a fixed-size prospect star comfortably inside the marker box", () => {
    const glyph = markerGlyphSize(false, 1234, "prospect");
    expect(glyph * Math.SQRT2).toBeLessThanOrEqual(MARKER_BOX + 1e-9);
  });

  it("visual key changes when the rendered size or mode changes", () => {
    const small = markerVisualKey(true, 5, "customer");
    const large = markerVisualKey(true, 2000, "customer");
    const fixed = markerVisualKey(false, 5, "customer");
    expect(small).not.toBe(large);
    expect(small).not.toBe(fixed);
    // identical inputs → identical key (stable, no stale-size flicker)
    expect(markerVisualKey(true, 5, "customer")).toBe(small);
  });

  it("distinguishes customer vs prospect in the key", () => {
    expect(markerVisualKey(true, 100, "customer")).not.toBe(markerVisualKey(true, 100, "prospect"));
  });
});
