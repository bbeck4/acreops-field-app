// Parse a scanned barcode payload. Location labels printed from the warehouse
// board are prefixed with `LOC|` (e.g. `LOC|AISLE-A-BIN-01`) so the scanner can
// tell a shelf/bin apart from a product SKU. Everything else is an item code.
export type ScanKind = "location" | "item";

export interface ParsedScan {
  kind: ScanKind;
  code: string;
}

export function parseScan(raw: string): ParsedScan {
  const trimmed = (raw ?? "").trim();
  const m = /^LOC\|(.*)$/i.exec(trimmed);
  if (m) return { kind: "location", code: m[1].trim() };
  return { kind: "item", code: trimmed };
}

export function normalizeCode(s: string): string {
  return (s ?? "").replace(/\s+/g, "").toUpperCase();
}

export function locationsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeCode(a ?? "") === normalizeCode(b ?? "");
}
