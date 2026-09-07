import { atomicCreateWorkOrder } from "@workspace/api-client-react";
import type { AtomicCreateWorkOrderInput } from "@workspace/api-client-react";
import { PermanentSyncError } from "@/lib/offlineSyncError";

export interface WorkOrderPayload {
  customerId?: number;
  deliverySiteId?: number;
  notes?: string;
  status?: string;
  freightCost?: number;
  lineItems?: Array<{ productId: number; quantity: number; unitPrice: number }>;
  marginWarningAcknowledged?: boolean;
  blendedMarginPct?: number | null;
  belowFloorCount?: number | null;
}

/**
 * Replay a queued "workOrder" write against POST /api/work-orders/atomic.
 *
 * The pending-write UUID (`pendingWriteId`) is sent as X-Idempotency-Key so the
 * server deduplicates replays automatically: same key + same body → returns the
 * cached 201; same key + different body → 409; concurrent in-flight duplicate →
 * 503 (safe to retry).
 *
 * Error classification:
 *   4xx (400/404/409) → PermanentSyncError – stays in queue with failedReason
 *   5xx / network     → plain Error – shows as "Waiting", auto-retried
 *   503               → plain Error – safe to retry after back-off
 */
export async function replayWorkOrder(
  payload: unknown,
  token: string,
  pendingWriteId: string,
): Promise<void> {
  const p = payload as WorkOrderPayload | null;
  if (!p || typeof p !== "object") return;

  const body: AtomicCreateWorkOrderInput = {
    customerId: p.customerId,
    deliverySiteId: p.deliverySiteId,
    notes: p.notes,
    status: p.status,
    freightCost: p.freightCost,
    lineItems: (p.lineItems ?? []).map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    marginWarningAcknowledged: p.marginWarningAcknowledged,
    blendedMarginPct: p.blendedMarginPct ?? null,
    belowFloorCount: p.belowFloorCount ?? null,
  };

  try {
    await atomicCreateWorkOrder(body, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": pendingWriteId,
      },
    });
  } catch (err: unknown) {
    // ApiError (from customFetch) exposes a numeric `status` property.
    const status = (err as { status?: number })?.status;
    if (status !== undefined && status >= 400 && status < 500 && status !== 503) {
      // 4xx (except 503) → permanent – server rejected this write.
      let msg = `Server rejected this work order (HTTP ${status})`;
      const data = (err as { data?: { error?: string } })?.data;
      if (data?.error) msg = data.error;
      throw new PermanentSyncError(msg);
    }
    // 5xx / 503 / network → transient, auto-retry.
    throw err;
  }
}
