// Pure filtering logic for the mobile ProductPicker's blend-calculator mode.
//
// Mirrors the web calculators: when at least one product group is tagged for
// the requested calculator (showInLiquidCalculator / showInDryCalculator),
// only products in tagged groups are eligible. When NO group is tagged yet —
// including when the tag lookup failed offline — fall back to the legacy name
// heuristic (liquid = AgroLiquid groups, dry = everything else) so offline
// blending still works. While the tag list is still actively loading
// (linesPending) the eligible set is EMPTY, never the heuristic, so a rep
// can't pick a wrong-calculator product in that window.

export type CalculatorMode = "liquid" | "dry";

export const UNGROUPED = "Ungrouped";

export interface PickerProductLine {
  id: number;
  showInLiquidCalculator?: boolean | null;
  showInDryCalculator?: boolean | null;
}

export interface PickerProduct {
  name: string;
  productLineId?: number | null;
  productLineName?: string | null;
}

// Calculator-eligible candidate set (before search/category chips).
export function calculatorEligibleProducts<P extends PickerProduct>(
  products: P[] | undefined,
  productLines: PickerProductLine[] | undefined,
  calculatorMode: CalculatorMode | undefined,
  linesPending: boolean,
): P[] {
  let list = products ?? [];
  if (calculatorMode && linesPending) return [];
  if (calculatorMode) {
    const taggedIds = new Set(
      (productLines ?? [])
        .filter((l) => (calculatorMode === "liquid" ? l.showInLiquidCalculator : l.showInDryCalculator))
        .map((l) => l.id),
    );
    if (taggedIds.size > 0) {
      list = list.filter((p) => p.productLineId != null && taggedIds.has(p.productLineId));
    } else {
      // Legacy fallback (no groups tagged yet / offline): liquid = AgroLiquid
      // lines, dry = everything else.
      list = list.filter((p) => {
        const isAg = (p.productLineName ?? "").toLowerCase().includes("agroliquid");
        return calculatorMode === "liquid" ? isAg : !isAg;
      });
    }
  }
  return list;
}

// Category chips are derived from the ELIGIBLE set only, and only offered when
// there is more than one group (a single group would be a no-op chip row).
export function pickerGroupNames(eligible: PickerProduct[]): string[] {
  const names = new Set<string>();
  for (const p of eligible) names.add(p.productLineName || UNGROUPED);
  return names.size > 1 ? [...names].sort((a, b) => a.localeCompare(b)) : [];
}

// Apply the selected category chip to the eligible set.
export function filterByGroup<P extends PickerProduct>(eligible: P[], group: string | null): P[] {
  if (group == null) return eligible;
  return eligible.filter((p) => (p.productLineName || UNGROUPED) === group);
}
