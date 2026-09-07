import type { GetServicePackageCatalog200 } from "@workspace/api-client-react";

// Offline fallback pricing. Mirrors the server's pure calculator using the
// cached catalog rates so a rep can review, print, and share a quote without a
// connection. Plan discounts are NOT applied offline (the plan lives on the
// server) — the server re-prices authoritatively when the queued order syncs.

export type LocalQuoteLine = {
  packageKey: string;
  name: string;
  quantity: number;
  unit: string;
  baseAmount: number;
  discountAmount: number;
  amount: number;
  note: string | null;
};

export type LocalQuote = {
  planName: string | null;
  lines: LocalQuoteLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
  requiresSupportWarning: boolean;
};

const round = (c: number) => Math.round(c);
const c2d = (c: number) => Math.round(c) / 100;

export function computeLocalServicePackageQuote(
  catalog: GetServicePackageCatalog200,
  selection: Array<{ packageKey: string; quantity: number }>,
): LocalQuote {
  const lines: LocalQuoteLine[] = [];
  let hasSupport = false;
  let hasEquipmentOpt = false;

  for (const sel of selection) {
    const spec = catalog.packages.find((p) => p.key === sel.packageKey);
    if (!spec) continue;
    const qty = Number(sel.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    if (spec.isSupportPlan) hasSupport = true;
    if (spec.requiresSupport) hasEquipmentOpt = true;

    let baseCents = 0;
    let netCents = 0;
    let note: string | null = null;

    if (spec.model === "tiered") {
      const firstUnits = Math.min(qty, spec.tierFirstUnits ?? 0);
      const overflowUnits = Math.max(qty - (spec.tierFirstUnits ?? 0), 0);
      baseCents =
        firstUnits * (spec.tierFirstRateCents ?? 0) +
        overflowUnits * (spec.tierOverflowRateCents ?? 0);
      netCents = baseCents;
    } else if (spec.model === "mileage") {
      baseCents = round(qty * (catalog.mileageRateCents ?? 0));
      netCents = baseCents;
    } else if (spec.model === "perAcreMin") {
      baseCents = round(qty * (spec.rateCents ?? 0));
      netCents = Math.max(baseCents, spec.minCents ?? 0);
      if (netCents > baseCents) note = `$${((spec.minCents ?? 0) / 100).toFixed(0)} minimum applied`;
    } else {
      baseCents = round(qty * (spec.rateCents ?? 0));
      netCents = baseCents;
    }

    lines.push({
      packageKey: spec.key,
      name: spec.name,
      quantity: qty,
      unit: spec.unit,
      baseAmount: c2d(baseCents),
      discountAmount: c2d(Math.max(baseCents - netCents, 0)),
      amount: c2d(netCents),
      note,
    });
  }

  const subtotal = lines.reduce((s, l) => s + l.baseAmount, 0);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return {
    planName: null,
    lines,
    subtotal,
    discountTotal: Math.max(subtotal - total, 0),
    total,
    requiresSupportWarning: hasEquipmentOpt && !hasSupport,
  };
}
