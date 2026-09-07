import { describe, it, expect } from "vitest";
import {
  computeLiquidProfile,
  buildRateChartRows,
  toPerGallonPrice,
  TON_LBS,
  type BlendComponentRow,
  type AnalysisMap,
} from "@/lib/blend";

// Minimal component factory — only fields the math touches matter.
const comp = (productId: number, qty: number, over: Partial<BlendComponentRow> = {}): BlendComponentRow => ({
  productId,
  name: `P${productId}`,
  unit: "gal",
  price: 0,
  cost: null,
  qty,
  ...over,
});

// Analysis rows are loose objects in the map; cast keeps the test focused.
const analysis = (a: Record<string, number | null>) => a as unknown as AnalysisMap[number];

describe("computeLiquidProfile", () => {
  it("guaranteed = pct/100 × lbsPerGal; effective = perf lbs/gal (single product)", () => {
    const rows = computeLiquidProfile([comp(1, 10)], {
      1: analysis({ totalN: 28, lbsPerGal: 10.85, perfN: 4.5 }),
    });
    const n = rows.find((r) => r.key === "N")!;
    expect(n.guarPerGal).toBeCloseTo((28 / 100) * 10.85, 10);
    expect(n.effPerGal).toBeCloseTo(4.5, 10);
  });

  it("averages across mixed-density components weighted by gallons", () => {
    const rows = computeLiquidProfile(
      [comp(1, 3), comp(2, 7)],
      {
        1: analysis({ totalN: 28, lbsPerGal: 10.85, perfN: 4.5 }),
        2: analysis({ totalN: 9, lbsPerGal: 11.4, perfN: 1.2 }),
      },
    );
    const n = rows.find((r) => r.key === "N")!;
    const guar = (3 * (28 / 100) * 10.85 + 7 * (9 / 100) * 11.4) / 10;
    const eff = (3 * 4.5 + 7 * 1.2) / 10;
    expect(n.guarPerGal).toBeCloseTo(guar, 10);
    expect(n.effPerGal).toBeCloseTo(eff, 10);
  });

  it("drops rows where both guaranteed and effective are zero, keeps perf-only rows", () => {
    const rows = computeLiquidProfile([comp(1, 5)], {
      1: analysis({ totalN: 28, lbsPerGal: 10.85, perfN: 4.5, perfS: 0.3 }),
    });
    expect(rows.map((r) => r.key)).toEqual(["N", "S"]); // S has eff only
    expect(rows.find((r) => r.key === "S")!.guarPerGal).toBe(0);
  });

  it("ignores missing analysis, missing density, and non-positive quantities", () => {
    const rows = computeLiquidProfile(
      [comp(1, 5), comp(2, -3), comp(3, 5)],
      {
        1: analysis({ totalN: 28, lbsPerGal: null, perfN: 4.5 }), // no density → guar 0
        // product 3 has no analysis at all
      },
    );
    const n = rows.find((r) => r.key === "N")!;
    expect(n.guarPerGal).toBe(0);
    expect(n.effPerGal).toBeCloseTo((5 * 4.5) / 10, 10); // total gallons = 10 (neg clamped)
  });

  it("returns [] for an empty or zero-quantity blend", () => {
    expect(computeLiquidProfile([], {})).toEqual([]);
    expect(computeLiquidProfile([comp(1, 0)], { 1: analysis({ perfN: 4.5 }) })).toEqual([]);
  });
});

describe("buildRateChartRows", () => {
  it("spans target−5…target+5 with values = effPerGal × rate and costPerAcre = pricePerGal × rate", () => {
    const rows = buildRateChartRows(10, [{ effPerGal: 4.5 }, { effPerGal: 1.2 }], 12.34);
    expect(rows).toHaveLength(11);
    expect(rows[0].rate).toBe(5);
    expect(rows[10].rate).toBe(15);
    const mid = rows[5];
    expect(mid.rate).toBe(10);
    expect(mid.values).toEqual([45, 12]);
    expect(mid.costPerAcre).toBeCloseTo(123.4, 10);
  });

  it("clamps at 0: target rates below 5 drop negative rows", () => {
    const rows = buildRateChartRows(3, [{ effPerGal: 2 }], 5);
    expect(rows.map((r) => r.rate)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows[0].values).toEqual([0]);
    expect(rows[0].costPerAcre).toBe(0);
  });

  it("rounds fractional rates to 2 decimals (matches web toFixed(2))", () => {
    const rows = buildRateChartRows(2.505, [{ effPerGal: 1 }], 1);
    // -2.505 → invalid (<0) dropped after rounding to -2.5? No: r computed then rounded.
    for (const r of rows) {
      expect(r.rate).toBe(Number(r.rate.toFixed(2)));
      expect(r.rate).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("ton-unit price conversion (toPerGallonPrice)", () => {
  it("converts $/ton to $/gal via density: $/gal = $/ton × lbsPerGal / 2000", () => {
    expect(toPerGallonPrice(600, "ton", 10.85)).toBeCloseTo((600 * 10.85) / TON_LBS, 10);
    expect(toPerGallonPrice(600, "Tons", 11.4)).toBeCloseTo((600 * 11.4) / TON_LBS, 10);
  });

  it("passes through for non-ton units or unknown/zero density", () => {
    expect(toPerGallonPrice(12.5, "gal", 10.85)).toBe(12.5);
    expect(toPerGallonPrice(600, "ton", null)).toBe(600);
    expect(toPerGallonPrice(600, "ton", 0)).toBe(600);
    expect(toPerGallonPrice(600, null, 10.85)).toBe(600);
  });

  it("feeds cost/acre correctly for a ton-priced product in the rate chart", () => {
    const pricePerGal = toPerGallonPrice(600, "ton", 10.85);
    const rows = buildRateChartRows(10, [], pricePerGal);
    expect(rows[5].costPerAcre).toBeCloseTo(10 * (600 * 10.85) / TON_LBS, 10);
  });
});

// Parity with the web AgroLiquid calculator (agri-platform agroliquid-calculator.tsx):
// - guaranteed lbs/gal of nutrient = (percent / 100) * lbsPerGal (web guaranteedLbsPerGal)
// - rate chart: for d in −5..+5, r = Number((rate+d).toFixed(2)), keep r ≥ 0,
//   values = effPerGal × r, costPerAcre = costPerGal × r
describe("web calculator parity", () => {
  it("matches web math for the same inputs", () => {
    const analysisMap: AnalysisMap = {
      1: analysis({ totalN: 28, availableP2O5: 0, lbsPerGal: 10.85, perfN: 4.5 }),
      2: analysis({ availableP2O5: 9, lbsPerGal: 11.65, perfP2O5: 3 }),
    };
    const components = [comp(1, 4), comp(2, 6)];
    const rows = computeLiquidProfile(components, analysisMap);

    // Web-side reimplementation of the same formulas:
    const webGuar = (pct: number, density: number) => (pct / 100) * density;
    const totalGal = 10;
    expect(rows.find((r) => r.key === "N")!.guarPerGal)
      .toBeCloseTo((4 * webGuar(28, 10.85)) / totalGal, 10);
    expect(rows.find((r) => r.key === "P2O5")!.guarPerGal)
      .toBeCloseTo((6 * webGuar(9, 11.65)) / totalGal, 10);
    expect(rows.find((r) => r.key === "N")!.effPerGal).toBeCloseTo((4 * 4.5) / totalGal, 10);
    expect(rows.find((r) => r.key === "P2O5")!.effPerGal).toBeCloseTo((6 * 3) / totalGal, 10);

    // Rate chart parity at rate 8 with cost/gal 7.25
    const eff = rows.map((r) => ({ effPerGal: r.effPerGal }));
    const chart = buildRateChartRows(8, eff, 7.25);
    const webRates: number[] = [];
    for (let d = -5; d <= 5; d++) {
      const r = 8 + d;
      if (r >= 0) webRates.push(Number(r.toFixed(2)));
    }
    expect(chart.map((r) => r.rate)).toEqual(webRates);
    for (const row of chart) {
      expect(row.costPerAcre).toBeCloseTo(7.25 * row.rate, 10);
      row.values.forEach((v, i) => expect(v).toBeCloseTo(eff[i].effPerGal * row.rate, 10));
    }
  });
});
