import { describe, it, expect } from "vitest";
import {
  calculatorEligibleProducts,
  filterByGroup,
  pickerGroupNames,
  UNGROUPED,
} from "@/lib/calculatorProducts";

const lines = [
  { id: 1, showInLiquidCalculator: true, showInDryCalculator: false },
  { id: 2, showInLiquidCalculator: false, showInDryCalculator: true },
  { id: 3, showInLiquidCalculator: false, showInDryCalculator: false },
];

const products = [
  { id: 1, name: "Pro-Germinator", productLineId: 1, productLineName: "AgroLiquid" },
  { id: 2, name: "Sure-K", productLineId: 1, productLineName: "AgroLiquid" },
  { id: 3, name: "Urea 46-0-0", productLineId: 2, productLineName: "Dry Fertilizer" },
  { id: 4, name: "Hydraulic Hose", productLineId: 3, productLineName: "Parts & Service" },
  { id: 5, name: "Seed Corn", productLineId: null, productLineName: null },
];

describe("calculatorEligibleProducts", () => {
  it("filters to tagged groups per calculator mode", () => {
    expect(calculatorEligibleProducts(products, lines, "liquid", false).map((p) => p.name)).toEqual([
      "Pro-Germinator",
      "Sure-K",
    ]);
    expect(calculatorEligibleProducts(products, lines, "dry", false).map((p) => p.name)).toEqual([
      "Urea 46-0-0",
    ]);
  });

  it("returns EMPTY (not the heuristic) while the tag list is still loading", () => {
    expect(calculatorEligibleProducts(products, undefined, "liquid", true)).toEqual([]);
    expect(calculatorEligibleProducts(products, undefined, "dry", true)).toEqual([]);
  });

  it("offline/failed tag lookup (no tags, not pending) falls back to the name heuristic", () => {
    expect(calculatorEligibleProducts(products, undefined, "liquid", false).map((p) => p.name)).toEqual([
      "Pro-Germinator",
      "Sure-K",
    ]);
    expect(calculatorEligibleProducts(products, undefined, "dry", false).map((p) => p.name)).toEqual([
      "Urea 46-0-0",
      "Hydraulic Hose",
      "Seed Corn",
    ]);
  });

  it("no calculatorMode = plain picker, everything passes through", () => {
    expect(calculatorEligibleProducts(products, lines, undefined, false)).toHaveLength(products.length);
  });

  it("tag edits take effect: tagging Parts for dry brings its products in", () => {
    const edited = lines.map((l) => (l.id === 3 ? { ...l, showInDryCalculator: true } : l));
    expect(calculatorEligibleProducts(products, edited, "dry", false).map((p) => p.name)).toEqual([
      "Urea 46-0-0",
      "Hydraulic Hose",
    ]);
  });
});

describe("pickerGroupNames (category chips)", () => {
  it("derives chips from the calculator-eligible set only", () => {
    // Liquid eligible set is all one group → no chips at all.
    const eligible = calculatorEligibleProducts(products, lines, "liquid", false);
    expect(pickerGroupNames(eligible)).toEqual([]);
  });

  it("offers chips only when there is more than one group, sorted", () => {
    expect(pickerGroupNames(products)).toEqual([
      "AgroLiquid",
      "Dry Fertilizer",
      "Parts & Service",
      UNGROUPED,
    ]);
    expect(pickerGroupNames([products[0], products[1]])).toEqual([]);
  });

  it("buckets ungrouped products under the Ungrouped chip", () => {
    const names = pickerGroupNames(products);
    expect(names).toContain(UNGROUPED);
    expect(filterByGroup(products, UNGROUPED).map((p) => p.name)).toEqual(["Seed Corn"]);
  });
});

describe("filterByGroup", () => {
  it("null group returns the full eligible set", () => {
    expect(filterByGroup(products, null)).toHaveLength(products.length);
  });

  it("filters to the selected group", () => {
    expect(filterByGroup(products, "AgroLiquid").map((p) => p.name)).toEqual([
      "Pro-Germinator",
      "Sure-K",
    ]);
  });
});
