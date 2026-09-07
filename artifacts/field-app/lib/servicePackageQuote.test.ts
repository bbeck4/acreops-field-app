import { describe, it, expect } from "vitest";
import type { GetServicePackageCatalog200 } from "@workspace/api-client-react";
import { computeLocalServicePackageQuote } from "@/lib/servicePackageQuote";

// Offline pricing verification for the field-app service-package calculator.
//
// The rep's phone recomputes quotes offline purely from the cached
// /service-packages/catalog payload. That catalog is served by the server with
// any manager rate OVERRIDES already merged in, so the field-app needs no
// override-awareness of its own — it just has to price from whatever rates the
// catalog carries. This test proves exactly that: feed a catalog whose rates
// reflect an override and the offline quote must reflect the overridden rate,
// not any hardcoded 2026 default.

// A minimal catalog builder — one package plus the required scalar fields.
function catalog(
  pkg: Partial<GetServicePackageCatalog200["packages"][number]> & {
    key: string;
    model: string;
  },
  mileageRateCents = 200,
): GetServicePackageCatalog200 {
  return {
    mileageRateCents,
    packages: [
      {
        sku: `SKU-${pkg.key}`,
        name: pkg.key,
        unit: "unit",
        discountClass: "none",
        requiresSupport: false,
        isSupportPlan: false,
        rateCents: null,
        tierFirstRateCents: null,
        tierFirstUnits: null,
        tierOverflowRateCents: null,
        minCents: null,
        ...pkg,
      },
    ],
  };
}

describe("computeLocalServicePackageQuote reflects catalog (overridden) rates", () => {
  it("prices a perUnit package from the catalog rate, not a hardcoded default", () => {
    // Overridden planter rate: $90/row (9000¢), vs the $75 code default.
    const cat = catalog({ key: "planter", model: "perUnit", rateCents: 9000 });
    const q = computeLocalServicePackageQuote(cat, [{ packageKey: "planter", quantity: 10 }]);
    expect(q.total).toBe(900); // 10 * 90
    expect(q.lines[0].amount).toBe(900);
  });

  it("prices a tiered package from the catalog tier rates", () => {
    // Overridden support: $300/unit 1–5 (30000¢), $120/unit 6+ (12000¢).
    const cat = catalog({
      key: "support",
      model: "tiered",
      isSupportPlan: true,
      tierFirstRateCents: 30000,
      tierFirstUnits: 5,
      tierOverflowRateCents: 12000,
    });
    const q = computeLocalServicePackageQuote(cat, [{ packageKey: "support", quantity: 6 }]);
    // 5 * 300 + 1 * 120 = 1620 (default 4*250 + 2*100 = 1200).
    expect(q.total).toBe(1620);
  });

  it("prices a perAcreMin package with the catalog rate and floor", () => {
    // Overridden data maintenance: $2.00/acre (200¢) with a $400 floor (40000¢).
    const cat = catalog({ key: "data_maint", model: "perAcreMin", rateCents: 200, minCents: 40000 });
    const under = computeLocalServicePackageQuote(cat, [{ packageKey: "data_maint", quantity: 100 }]);
    expect(under.total).toBe(400); // 100 * 2 = 200, floored to 400
    expect(under.lines[0].note).toMatch(/minimum/i);
    const over = computeLocalServicePackageQuote(cat, [{ packageKey: "data_maint", quantity: 250 }]);
    expect(over.total).toBe(500); // 250 * 2, above the floor
  });

  it("prices mileage from the catalog mileage rate", () => {
    const cat = catalog({ key: "mileage", model: "mileage" }, 325);
    const q = computeLocalServicePackageQuote(cat, [{ packageKey: "mileage", quantity: 50 }]);
    expect(q.total).toBe(162.5); // 50 * 3.25
  });
});
