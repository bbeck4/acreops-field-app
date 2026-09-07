export type SoilStatus = "recent" | "stale" | "missing";

const CROP_PALETTE: Record<string, { color: string; label: string }> = {
  corn: { color: "#eab308", label: "Corn" },
  soybeans: { color: "#16a34a", label: "Soybeans" },
  wheat: { color: "#d97706", label: "Wheat" },
  cotton: { color: "#94a3b8", label: "Cotton" },
  rice: { color: "#06b6d4", label: "Rice" },
  alfalfa: { color: "#15803d", label: "Alfalfa" },
  sorghum: { color: "#dc2626", label: "Sorghum" },
  barley: { color: "#a16207", label: "Barley" },
  oats: { color: "#ca8a04", label: "Oats" },
  canola: { color: "#facc15", label: "Canola" },
  rye: { color: "#7c3aed", label: "Rye" },
  hay: { color: "#65a30d", label: "Hay" },
  fallow: { color: "#9ca3af", label: "Fallow" },
};

const OTHER_COLOR = "#6366f1";
const NONE_COLOR = "#9ca3af";

export function normalizeCrop(crop: string | null | undefined): string {
  if (!crop) return "__none__";
  const k = crop.trim().toLowerCase();
  if (!k) return "__none__";
  if (k === "soy" || k === "soybean") return "soybeans";
  if (k === "oat") return "oats";
  return k;
}

export function cropColor(crop: string | null | undefined): string {
  const k = normalizeCrop(crop);
  if (k === "__none__") return NONE_COLOR;
  return CROP_PALETTE[k]?.color ?? OTHER_COLOR;
}

export function cropLabel(crop: string | null | undefined): string {
  const k = normalizeCrop(crop);
  if (k === "__none__") return "No crop plan";
  const known = CROP_PALETTE[k];
  if (known) return known.label;
  return crop && crop.trim() ? crop.trim().replace(/\b\w/g, (c) => c.toUpperCase()) : "Other";
}

const STALE_AFTER_DAYS = 365 * 2;

export function soilStatus(latestSoilTestDate: string | Date | null | undefined): SoilStatus {
  if (!latestSoilTestDate) return "missing";
  const d = latestSoilTestDate instanceof Date ? latestSoilTestDate : new Date(latestSoilTestDate);
  if (Number.isNaN(d.getTime())) return "missing";
  const ageDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= STALE_AFTER_DAYS ? "recent" : "stale";
}

export function soilStatusColor(status: SoilStatus): string {
  switch (status) {
    case "recent": return "#16a34a";
    case "stale": return "#f59e0b";
    case "missing": return "#dc2626";
  }
}

export function soilStatusLabel(status: SoilStatus): string {
  switch (status) {
    case "recent": return "Recent (\u2264 2 yrs)";
    case "stale": return "Stale (> 2 yrs)";
    case "missing": return "Missing";
  }
}
