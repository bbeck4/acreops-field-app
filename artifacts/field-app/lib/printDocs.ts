import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";

const baseStyles = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
  .muted { color: #555; font-size: 12px; }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .right { text-align: right; }
  .meta { font-size: 12px; color: #555; }
  .pill { display: inline-block; padding: 2px 8px; border: 1px solid #999; border-radius: 9999px; font-size: 11px; }
  .barcode { display: block; }
  .barcode-cell { padding: 4px 8px; }
  .barcode-cell .code { font-family: monospace; font-size: 10px; color: #555; margin-top: 2px; }
  .footer { margin-top: 24px; font-size: 11px; color: #777; border-top: 1px solid #eee; padding-top: 8px; }
`;

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Code128 patterns: each value (0-106) maps to 6 bar/space widths (modules).
const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];
const START_B = 104;
const STOP = 106;

function code128bChecksum(values: number[]): number {
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += i * values[i];
  return sum % 103;
}

export function barcodeSvg(
  value: string,
  opts: { height?: number; moduleWidth?: number; showText?: boolean } = {},
): string {
  const text = String(value ?? "");
  if (!text) return "";
  const height = opts.height ?? 40;
  const mw = opts.moduleWidth ?? 1.4;
  const showText = opts.showText ?? true;
  const values: number[] = [START_B];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const v = c >= 32 && c <= 127 ? c - 32 : "?".charCodeAt(0) - 32;
    values.push(v);
  }
  values.push(code128bChecksum(values));
  values.push(STOP);
  const widths: number[] = [];
  for (const v of values) {
    const pat = CODE128_PATTERNS[v];
    for (const ch of pat) widths.push(parseInt(ch, 10));
  }
  let x = 0;
  let bar = true;
  const rects: string[] = [];
  for (const w of widths) {
    const px = w * mw;
    if (bar) rects.push(`<rect x="${x.toFixed(2)}" y="0" width="${px.toFixed(2)}" height="${height}" />`);
    x += px;
    bar = !bar;
  }
  const totalW = x;
  const textH = showText ? 12 : 0;
  return `<svg class="barcode" xmlns="http://www.w3.org/2000/svg" width="${totalW.toFixed(2)}" height="${height + textH}" viewBox="0 0 ${totalW.toFixed(2)} ${height + textH}" shape-rendering="crispEdges">` +
    `<g fill="#000">${rects.join("")}</g>` +
    (showText ? `<text x="${(totalW / 2).toFixed(2)}" y="${height + textH - 1}" text-anchor="middle" font-family="monospace" font-size="10" fill="#000">${escapeHtml(text)}</text>` : "") +
    `</svg>`;
}

function wrapHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>${baseStyles}</style></head><body>${body}</body></html>`;
}

export interface PickLine {
  productName: string;
  sku: string;
  unit?: string;
  qtyRequested: number;
  qtyPicked: number;
  onHand: number;
  lotTracked?: boolean;
  lotCode?: string | null;
}

export interface PickDoc {
  summary?: string | null;
  customerName?: string | null;
  status: string;
  lines: PickLine[];
}

export function renderPickListHtml(pick: PickDoc): string {
  const rows = pick.lines.map((l) => `
    <tr>
      <td>
        <div class="font-medium">${escapeHtml(l.productName)}</div>
        <div class="muted">${escapeHtml(l.sku)}</div>
        <div class="barcode-cell" style="padding-left:0">${barcodeSvg(l.sku, { height: 32, moduleWidth: 1.2, showText: false })}</div>
      </td>
      <td class="right">${l.qtyRequested} ${escapeHtml(l.unit ?? "")}</td>
      <td class="right">${l.onHand}</td>
      <td>
        ${escapeHtml(l.lotCode ?? "")}
        ${l.lotTracked && l.lotCode ? `<div class="barcode-cell" style="padding-left:0">${barcodeSvg(l.lotCode, { height: 28, moduleWidth: 1.1, showText: false })}</div>` : ""}
      </td>
      <td style="width:60px">☐</td>
    </tr>`).join("");
  const body = `
    <div class="row">
      <div>
        <h1>Pick list</h1>
        <div class="meta">${escapeHtml(pick.summary ?? "")}</div>
        <div class="meta">Customer: ${escapeHtml(pick.customerName ?? "—")}</div>
      </div>
      <div class="meta right">
        Status: <span class="pill">${escapeHtml(pick.status)}</span><br/>
        Printed: ${new Date().toLocaleString()}
      </div>
    </div>
    <h2>Items to pick</h2>
    <table>
      <thead><tr><th>Product</th><th class="right">Requested</th><th class="right">On hand</th><th>Lot</th><th>✓</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">No lines</td></tr>`}</tbody>
    </table>
    <div class="footer">Picker: ____________________  &nbsp; Date: ____________  &nbsp; Signature: ____________________</div>
  `;
  return wrapHtml(`Pick list ${pick.summary ?? ""}`.trim(), body);
}

export function renderPackingSlipHtml(pick: PickDoc): string {
  const rows = pick.lines.map((l) => `
    <tr>
      <td>${escapeHtml(l.productName)}<div class="muted">${escapeHtml(l.sku)}</div></td>
      <td class="right">${l.qtyPicked ?? l.qtyRequested} ${escapeHtml(l.unit ?? "")}</td>
      <td>${escapeHtml(l.lotCode ?? "—")}</td>
    </tr>`).join("");
  const body = `
    <div class="row">
      <div>
        <h1>Packing slip</h1>
        <div class="meta">${escapeHtml(pick.summary ?? "")}</div>
      </div>
      <div class="meta right">Printed: ${new Date().toLocaleString()}</div>
    </div>
    <h2>Ship to</h2>
    <div class="meta">${escapeHtml(pick.customerName ?? "—")}</div>
    <h2>Contents</h2>
    <table>
      <thead><tr><th>Product</th><th class="right">Qty</th><th>Lot</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">No items</td></tr>`}</tbody>
    </table>
    <div class="footer">Received in good condition by: ____________________  Date: ____________</div>
  `;
  return wrapHtml(`Packing slip ${pick.summary ?? ""}`.trim(), body);
}

export interface OrderStopLine {
  productName: string;
  unit?: string;
  quantityOrdered: string | number;
  quantityDelivered?: string | number | null;
}

export interface OrderStopDoc {
  workOrderNumber?: string | null;
  customerName?: string | null;
  address?: string | null;
  instructions?: string | null;
  stopOrder?: number | null;
  status: string;
  items: OrderStopLine[];
}

export function renderStopPickListHtml(stop: OrderStopDoc): string {
  const summary = stop.workOrderNumber
    ? `Order ${stop.workOrderNumber}`
    : stop.stopOrder != null
      ? `Stop ${stop.stopOrder}`
      : "";
  const rows = stop.items.map((l) => `
    <tr>
      <td>${escapeHtml(l.productName)}</td>
      <td class="right">${escapeHtml(l.quantityOrdered)} ${escapeHtml(l.unit ?? "")}</td>
      <td style="width:60px">☐</td>
    </tr>`).join("");
  const body = `
    <div class="row">
      <div>
        <h1>Pick list</h1>
        <div class="meta">${escapeHtml(summary)}</div>
        <div class="meta">Customer: ${escapeHtml(stop.customerName ?? "—")}</div>
      </div>
      <div class="meta right">
        Status: <span class="pill">${escapeHtml(stop.status)}</span><br/>
        Printed: ${new Date().toLocaleString()}
      </div>
    </div>
    ${stop.address ? `<h2>Deliver to</h2><div class="meta">${escapeHtml(stop.address)}</div>` : ""}
    ${stop.instructions ? `<h2>Instructions</h2><div class="meta">${escapeHtml(stop.instructions)}</div>` : ""}
    <h2>Items to pick</h2>
    <table>
      <thead><tr><th>Product</th><th class="right">Quantity</th><th>✓</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">No items</td></tr>`}</tbody>
    </table>
    <div class="footer">Picker: ____________________  &nbsp; Date: ____________  &nbsp; Signature: ____________________</div>
  `;
  return wrapHtml(`Pick list ${summary}`.trim(), body);
}

export function renderStopPackingSlipHtml(stop: OrderStopDoc): string {
  const summary = stop.workOrderNumber
    ? `Order ${stop.workOrderNumber}`
    : stop.stopOrder != null
      ? `Stop ${stop.stopOrder}`
      : "";
  const rows = stop.items.map((l) => `
    <tr>
      <td>${escapeHtml(l.productName)}</td>
      <td class="right">${escapeHtml(l.quantityDelivered ?? l.quantityOrdered)} ${escapeHtml(l.unit ?? "")}</td>
    </tr>`).join("");
  const body = `
    <div class="row">
      <div>
        <h1>Packing slip</h1>
        <div class="meta">${escapeHtml(summary)}</div>
      </div>
      <div class="meta right">Printed: ${new Date().toLocaleString()}</div>
    </div>
    <h2>Ship to</h2>
    <div class="meta">${escapeHtml(stop.customerName ?? "—")}</div>
    ${stop.address ? `<div class="meta">${escapeHtml(stop.address)}</div>` : ""}
    <h2>Contents</h2>
    <table>
      <thead><tr><th>Product</th><th class="right">Qty</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="2" class="muted">No items</td></tr>`}</tbody>
    </table>
    <div class="footer">Received in good condition by: ____________________  Date: ____________</div>
  `;
  return wrapHtml(`Packing slip ${summary}`.trim(), body);
}

export interface DeliveryReceiptLine {
  productName: string;
  unit?: string;
  quantityOrdered: string | number;
  quantityDelivered?: string | number | null;
  lotCode?: string | null;
}

export interface DeliveryReceiptDoc {
  workOrderNumber?: string | null;
  customerName?: string | null;
  address?: string | null;
  stopOrder?: number | null;
  status: string;
  signedByName?: string | null;
  completedAt?: string | null;
  items: DeliveryReceiptLine[];
}

export function renderDeliveryReceiptHtml(stop: DeliveryReceiptDoc): string {
  const summary = stop.workOrderNumber
    ? `Order ${stop.workOrderNumber}`
    : stop.stopOrder != null
      ? `Stop ${stop.stopOrder}`
      : "";
  const rows = stop.items.map((l) => `
    <tr>
      <td>${escapeHtml(l.productName)}</td>
      <td class="right">${escapeHtml(l.quantityDelivered ?? l.quantityOrdered)} ${escapeHtml(l.unit ?? "")}</td>
      <td>${escapeHtml(l.lotCode ?? "—")}</td>
    </tr>`).join("");
  const deliveredAt = stop.completedAt ? new Date(stop.completedAt) : new Date();
  const body = `
    <div class="row">
      <div>
        <h1>Delivery receipt</h1>
        <div class="meta">${escapeHtml(summary)}</div>
      </div>
      <div class="meta right">
        Status: <span class="pill">${escapeHtml(stop.status)}</span><br/>
        Delivered: ${deliveredAt.toLocaleString()}
      </div>
    </div>
    <h2>Delivered to</h2>
    <div class="meta">${escapeHtml(stop.customerName ?? "—")}</div>
    ${stop.address ? `<div class="meta">${escapeHtml(stop.address)}</div>` : ""}
    <h2>Delivered items</h2>
    <table>
      <thead><tr><th>Product</th><th class="right">Qty delivered</th><th>Lot</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">No items</td></tr>`}</tbody>
    </table>
    <div class="footer">
      Received by: ${escapeHtml(stop.signedByName ?? "")} ____________________  &nbsp; Signature: ____________________  &nbsp; Date: ____________
    </div>
  `;
  return wrapHtml(`Delivery receipt ${summary}`.trim(), body);
}

export interface ServicePackageQuoteDoc {
  targetName: string;
  targetKind: "customer" | "prospect";
  planName?: string | null;
  lines: Array<{
    name: string;
    quantity: number;
    unit: string;
    baseAmount: number;
    discountAmount: number;
    amount: number;
    note?: string | null;
  }>;
  subtotal: number;
  discountTotal: number;
  total: number;
  requiresSupportWarning: boolean;
}

export function renderServicePackageQuoteHtml(doc: ServicePackageQuoteDoc): string {
  const usd = (n: number) => `$${Number(n ?? 0).toFixed(2)}`;
  const rows = doc.lines
    .map(
      (l) => `
    <tr>
      <td>${escapeHtml(l.name)}${l.note ? `<br/><span class="muted">${escapeHtml(l.note)}</span>` : ""}</td>
      <td class="right">${escapeHtml(l.quantity)} ${escapeHtml(l.unit)}</td>
      <td class="right">${usd(l.baseAmount)}</td>
      <td class="right">${l.discountAmount > 0 ? `-${usd(l.discountAmount)}` : "—"}</td>
      <td class="right">${usd(l.amount)}</td>
    </tr>`,
    )
    .join("");
  const body = `
    <div class="row">
      <div>
        <h1>Service package quote</h1>
        <div class="meta">${escapeHtml(doc.targetKind === "prospect" ? "Prospect" : "Customer")}: ${escapeHtml(doc.targetName)}</div>
        ${doc.planName ? `<div class="meta">Service plan: ${escapeHtml(doc.planName)}</div>` : ""}
      </div>
      <div class="meta right">${new Date().toLocaleDateString()}</div>
    </div>
    ${doc.requiresSupportWarning ? `<div class="meta" style="color:#b45309">⚠ Equipment optimization requires an active Support Plan.</div>` : ""}
    <table>
      <thead>
        <tr><th>Package</th><th class="right">Qty</th><th class="right">List</th><th class="right">Discount</th><th class="right">Amount</th></tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">No packages</td></tr>`}</tbody>
    </table>
    <table style="margin-top:12px">
      <tbody>
        <tr><td>Subtotal</td><td class="right">${usd(doc.subtotal)}</td></tr>
        ${doc.discountTotal > 0 ? `<tr><td>Discounts</td><td class="right">-${usd(doc.discountTotal)}</td></tr>` : ""}
        <tr><td><strong>Total</strong></td><td class="right"><strong>${usd(doc.total)}</strong></td></tr>
      </tbody>
    </table>
  `;
  return wrapHtml("Service package quote", body);
}

export async function printOrShareHtml(html: string, fileName: string): Promise<void> {
  try {
    if (Platform.OS === "ios") {
      await Print.printAsync({ html });
      return;
    }
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: fileName,
        UTI: "com.adobe.pdf",
      });
    } else {
      Alert.alert("Saved", `PDF saved to ${uri}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not print or share";
    Alert.alert("Print failed", msg);
  }
}
