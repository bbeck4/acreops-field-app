import type { ProductNutrientAnalysis } from "@workspace/api-client-react";

export const TON_LBS = 2000;

export type BlendMode = "dry" | "liquid";

export interface BlendComponentRow {
  productId: number;
  name: string;
  unit: string | null;
  /** Catalog sale price per native unit. */
  price: number;
  /** Catalog cost per native unit (0 when none on file). */
  cost: number | null;
  /** lbs (dry) or gallons (liquid) of this product in the recipe. */
  qty: number;
}

export type AnalysisMap = Record<number, ProductNutrientAnalysis | undefined>;
export type CostMap = Record<number, number | undefined>;

interface NutrientDef {
  key: string;
  label: string;
  /** Guaranteed-analysis percent field used for dry blends. */
  dryField: keyof ProductNutrientAnalysis;
  /** Research performance lbs/gal field used for liquid blends. */
  perfField: keyof ProductNutrientAnalysis;
}

export const NUTRIENTS: NutrientDef[] = [
  { key: "N", label: "N", dryField: "totalN", perfField: "perfN" },
  { key: "P2O5", label: "P\u2082O\u2085", dryField: "availableP2O5", perfField: "perfP2O5" },
  { key: "K2O", label: "K\u2082O", dryField: "solubleK2O", perfField: "perfK2O" },
  { key: "S", label: "S", dryField: "sulfur", perfField: "perfS" },
  { key: "Ca", label: "Ca", dryField: "calcium", perfField: "perfCa" },
  { key: "B", label: "B", dryField: "boron", perfField: "perfB" },
  { key: "Zn", label: "Zn", dryField: "zinc", perfField: "perfZn" },
  { key: "Mn", label: "Mn", dryField: "manganese", perfField: "perfMn" },
  { key: "Fe", label: "Fe", dryField: "iron", perfField: "perfFe" },
  { key: "Cu", label: "Cu", dryField: "copper", perfField: "perfCu" },
];

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A non-negative quantity — negative inputs are clamped to 0 so they never
 * distort batch totals, nutrient shares, or order quantities. */
const pos = (v: unknown): number => {
  const n = num(v);
  return n > 0 ? n : 0;
};

export const isTonUnit = (unit: string | null | undefined): boolean => {
  const u = (unit ?? "").toLowerCase().trim();
  return u === "ton" || u === "tons";
};

/**
 * Convert a per-ton price to per-gallon using density (lbs/gal):
 * $/gal = $/ton x lbsPerGal / 2000. Non-ton products / unknown density pass
 * through unchanged.
 */
export function toPerGallonPrice(
  rawPrice: number,
  unit: string | null | undefined,
  lbsPerGal: number | null | undefined,
): number {
  if (!isTonUnit(unit)) return rawPrice;
  const density = num(lbsPerGal);
  if (density <= 0) return rawPrice;
  return (rawPrice * density) / TON_LBS;
}

export interface NutrientResult {
  key: string;
  label: string;
  /** Grade percent (dry only). */
  grade?: number;
  /** lbs/ton (dry) or lbs/gal (liquid). */
  perUnit: number;
  /** Total lbs of this nutrient in the whole batch. */
  totalLbs: number;
}

export interface BlendAnalysis {
  /** Total lbs (dry) or total gallons (liquid). */
  totalQty: number;
  nutrients: NutrientResult[];
  /** "lb/ton" (dry) or "lb/gal" (liquid). */
  perUnitLabel: string;
}

export function computeAnalysis(
  mode: BlendMode,
  components: BlendComponentRow[],
  analysisMap: AnalysisMap,
): BlendAnalysis {
  const totalQty = components.reduce((s, c) => s + pos(c.qty), 0);

  const nutrients: NutrientResult[] = NUTRIENTS.map((n) => {
    if (mode === "dry") {
      // total nutrient lbs = sum(lbs_i * pct_i / 100)
      const totalLbs = components.reduce((s, c) => {
        const pct = num(analysisMap[c.productId]?.[n.dryField] as number | null | undefined);
        return s + (pos(c.qty) * pct) / 100;
      }, 0);
      const grade = totalQty > 0 ? (totalLbs / totalQty) * 100 : 0;
      const perUnit = (grade / 100) * TON_LBS; // lbs per ton
      return { key: n.key, label: n.label, grade, perUnit, totalLbs };
    }
    // liquid: perfField is lbs/gal of nutrient per gallon of product
    const totalLbs = components.reduce((s, c) => {
      const perGal = num(analysisMap[c.productId]?.[n.perfField] as number | null | undefined);
      return s + pos(c.qty) * perGal;
    }, 0);
    const perUnit = totalQty > 0 ? totalLbs / totalQty : 0; // lbs per gallon
    return { key: n.key, label: n.label, perUnit, totalLbs };
  }).filter((r) => r.totalLbs > 0);

  return {
    totalQty,
    nutrients,
    perUnitLabel: mode === "dry" ? "lb/ton" : "lb/gal",
  };
}

export interface LiquidProfileRow {
  key: string;
  label: string;
  /** Guaranteed analysis: label % by weight × density, lbs of nutrient per gallon of blend. */
  guarPerGal: number;
  /** Research-based effective performance, lbs of nutrient per gallon of blend. */
  effPerGal: number;
}

/**
 * Detailed liquid nutrient profile matching the web AgroLiquid calculator:
 * guaranteed lbs/gal (percent × lbs/gal density) alongside effective
 * (research performance) lbs/gal, averaged across the whole blend.
 * Rows where both values are zero are dropped.
 */
export function computeLiquidProfile(
  components: BlendComponentRow[],
  analysisMap: AnalysisMap,
): LiquidProfileRow[] {
  const totalQty = components.reduce((s, c) => s + pos(c.qty), 0);
  if (totalQty <= 0) return [];
  return NUTRIENTS.map((n) => {
    let guarTotal = 0;
    let effTotal = 0;
    for (const c of components) {
      const qty = pos(c.qty);
      if (qty <= 0) continue;
      const a = analysisMap[c.productId];
      const pct = num(a?.[n.dryField] as number | null | undefined);
      const density = num(a?.lbsPerGal);
      guarTotal += qty * (pct / 100) * density;
      effTotal += qty * num(a?.[n.perfField] as number | null | undefined);
    }
    return {
      key: n.key,
      label: n.label,
      guarPerGal: guarTotal / totalQty,
      effPerGal: effTotal / totalQty,
    };
  }).filter((r) => r.guarPerGal > 0 || r.effPerGal > 0);
}

export interface RateChartRow {
  rate: number;
  /** Effective lbs/acre per nutrient, in the same order as the labels passed in. */
  values: number[];
  costPerAcre: number;
}

/**
 * Application rate chart matching the web calculator: effective nutrient
 * lbs/acre (and $/acre) at rates from target−5 to target+5 gal/acre,
 * clamped at 0.
 */
export function buildRateChartRows(
  rate: number,
  effNutrients: { effPerGal: number }[],
  pricePerGal: number,
): RateChartRow[] {
  const rows: RateChartRow[] = [];
  for (let d = -5; d <= 5; d++) {
    const r = Number((rate + d).toFixed(2));
    if (r < 0) continue;
    rows.push({
      rate: r,
      values: effNutrients.map((n) => n.effPerGal * r),
      costPerAcre: pricePerGal * r,
    });
  }
  return rows;
}

export interface CostMargin {
  /** Blend sale price per ton (dry) or per gallon (liquid). */
  salePerUnit: number;
  /** Blend cost per ton (dry) or per gallon (liquid). */
  costPerUnit: number;
  /** Gross margin percent, null when sale price is non-positive. */
  marginPct: number | null;
  /** "ton" (dry) or "gal" (liquid). */
  unitLabel: string;
  /** True when at least one component is missing a cost basis. */
  missingCost: boolean;
}

const resolveCost = (c: BlendComponentRow, costMap: CostMap): number => {
  const weighted = costMap[c.productId];
  if (typeof weighted === "number" && weighted > 0) return weighted;
  return num(c.cost);
};

export function computeCostMargin(
  mode: BlendMode,
  components: BlendComponentRow[],
  analysisMap: AnalysisMap,
  costMap: CostMap,
): CostMargin {
  const totalQty = components.reduce((s, c) => s + pos(c.qty), 0);
  let saleAcc = 0;
  let costAcc = 0;
  let missingCost = false;

  for (const c of components) {
    const qty = pos(c.qty);
    if (qty <= 0) continue;
    const resolvedCost = resolveCost(c, costMap);
    if (resolvedCost <= 0) missingCost = true;
    if (mode === "dry") {
      // accumulate $ over lbs; divide by tons at the end
      saleAcc += qty * num(c.price);
      costAcc += qty * resolvedCost;
    } else {
      const lbsPerGal = analysisMap[c.productId]?.lbsPerGal;
      const perGalPrice = toPerGallonPrice(num(c.price), c.unit, lbsPerGal);
      const perGalCost = toPerGallonPrice(resolvedCost, c.unit, lbsPerGal);
      saleAcc += qty * perGalPrice;
      costAcc += qty * perGalCost;
    }
  }

  let salePerUnit = 0;
  let costPerUnit = 0;
  if (totalQty > 0) {
    if (mode === "dry") {
      salePerUnit = saleAcc / totalQty; // already $/ton because lbs cancel
      costPerUnit = costAcc / totalQty;
    } else {
      salePerUnit = saleAcc / totalQty; // $/gal
      costPerUnit = costAcc / totalQty;
    }
  }

  const marginPct = salePerUnit > 0 ? ((salePerUnit - costPerUnit) / salePerUnit) * 100 : null;

  return {
    salePerUnit,
    costPerUnit,
    marginPct,
    unitLabel: mode === "dry" ? "ton" : "gal",
    missingCost,
  };
}

export interface OrderLine {
  productId: number;
  quantity: number;
  unitPrice: number;
  comboMixKey: string;
  comboRatePerAcre?: number;
}

/**
 * Build work-order line items that apply the blend across a field. The total
 * batch is scaled to acres x ratePerAcre and split across components by their
 * share of the recipe. Dry quantities are tons; liquid quantities are gallons.
 */
export function buildOrderLines(
  mode: BlendMode,
  components: BlendComponentRow[],
  analysisMap: AnalysisMap,
  acres: number,
  ratePerAcre: number,
  comboMixKey: string,
): OrderLine[] {
  const totalQty = components.reduce((s, c) => s + pos(c.qty), 0);
  if (totalQty <= 0 || acres <= 0 || ratePerAcre <= 0) return [];
  const fieldTotal = acres * ratePerAcre; // total lbs (dry) or gallons (liquid)

  return components
    .filter((c) => pos(c.qty) > 0)
    .map((c) => {
      const share = pos(c.qty) / totalQty;
      const scaled = share * fieldTotal; // lbs (dry) or gallons (liquid) for this product
      if (mode === "dry") {
        const quantity = Math.round((scaled / TON_LBS) * 10000) / 10000; // tons
        return {
          productId: c.productId,
          quantity,
          unitPrice: Math.round(num(c.price) * 100) / 100, // $/ton
          comboMixKey,
        } satisfies OrderLine;
      }
      const lbsPerGal = analysisMap[c.productId]?.lbsPerGal;
      const perGalPrice = toPerGallonPrice(num(c.price), c.unit, lbsPerGal);
      return {
        productId: c.productId,
        quantity: Math.round(scaled * 100) / 100, // gallons
        unitPrice: Math.round(perGalPrice * 100) / 100,
        comboMixKey,
        comboRatePerAcre: ratePerAcre,
      } satisfies OrderLine;
    });
}

export function newComboMixKey(): string {
  return `blend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
