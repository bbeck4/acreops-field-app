/**
 * Unit tests for replayWorkOrder – the pure helper that QueueSync delegates to
 * when replaying a queued "workOrder" write.
 *
 * Proves that one atomic create request is made (not multiple), that the
 * idempotency key is forwarded, and that error handling meets the
 * transient-vs-permanent contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PermanentSyncError } from "@/lib/offlineSyncError";

// ── Mock atomicCreateWorkOrder from the generated client ─────────────────────
// vi.mock must be called at the module level before imports that use it; the
// factory runs in a hoisted position.  We capture the mock fn so tests can
// control its behaviour.
vi.mock("@workspace/api-client-react", () => {
  const atomicCreateWorkOrder = vi.fn();
  return { atomicCreateWorkOrder };
});

// Import AFTER the vi.mock so we get the mocked version.
import { replayWorkOrder } from "@/lib/workOrderReplay";
import { atomicCreateWorkOrder } from "@workspace/api-client-react";

const TOKEN = "test-bearer-token";
const PENDING_WRITE_ID = "550e8400-e29b-41d4-a716-446655440000";

const BASE_PAYLOAD = {
  customerId: 42,
  lineItems: [
    { productId: 1, quantity: 2, unitPrice: 100 },
    { productId: 2, quantity: 1, unitPrice: 250 },
  ],
  marginWarningAcknowledged: false,
};

describe("replayWorkOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Exactly ONE request ────────────────────────────────────────────────
  it("makes exactly one atomicCreateWorkOrder call (not one per line item)", async () => {
    vi.mocked(atomicCreateWorkOrder).mockResolvedValue({
      id: 99,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    await replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID);

    expect(atomicCreateWorkOrder).toHaveBeenCalledTimes(1);
  });

  // ── 2. Idempotency key forwarded ──────────────────────────────────────────
  it("sends X-Idempotency-Key header matching the pending-write id", async () => {
    vi.mocked(atomicCreateWorkOrder).mockResolvedValue({
      id: 99,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    await replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID);

    const [, requestOptions] = vi.mocked(atomicCreateWorkOrder).mock.calls[0];
    expect((requestOptions?.headers as Record<string, string>)?.["X-Idempotency-Key"]).toBe(
      PENDING_WRITE_ID,
    );
  });

  // ── 3. Auth token forwarded ───────────────────────────────────────────────
  it("sends Authorization header with the bearer token", async () => {
    vi.mocked(atomicCreateWorkOrder).mockResolvedValue({
      id: 99,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    await replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID);

    const [, requestOptions] = vi.mocked(atomicCreateWorkOrder).mock.calls[0];
    expect((requestOptions?.headers as Record<string, string>)?.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  // ── 4. Line items forwarded correctly ─────────────────────────────────────
  it("forwards all line items to atomicCreateWorkOrder", async () => {
    vi.mocked(atomicCreateWorkOrder).mockResolvedValue({
      id: 99,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    await replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID);

    const [body] = vi.mocked(atomicCreateWorkOrder).mock.calls[0];
    expect(body.lineItems).toHaveLength(2);
    expect(body.lineItems?.[0]).toEqual({ productId: 1, quantity: 2, unitPrice: 100 });
    expect(body.lineItems?.[1]).toEqual({ productId: 2, quantity: 1, unitPrice: 250 });
  });

  // ── 5. Margin acknowledgement forwarded ───────────────────────────────────
  it("forwards marginWarningAcknowledged and margin summary fields", async () => {
    vi.mocked(atomicCreateWorkOrder).mockResolvedValue({
      id: 99,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    const payloadWithMargin = {
      ...BASE_PAYLOAD,
      marginWarningAcknowledged: true,
      blendedMarginPct: 18.5,
      belowFloorCount: 1,
    };
    await replayWorkOrder(payloadWithMargin, TOKEN, PENDING_WRITE_ID);

    const [body] = vi.mocked(atomicCreateWorkOrder).mock.calls[0];
    expect(body.marginWarningAcknowledged).toBe(true);
    expect(body.blendedMarginPct).toBe(18.5);
    expect(body.belowFloorCount).toBe(1);
  });

  // ── 6. Successful replay resolves ─────────────────────────────────────────
  it("resolves without throwing on 201 response", async () => {
    vi.mocked(atomicCreateWorkOrder).mockResolvedValue({
      id: 99,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    await expect(replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID)).resolves.toBeUndefined();
  });

  // ── 7. 4xx → PermanentSyncError ───────────────────────────────────────────
  it("throws PermanentSyncError for 4xx responses", async () => {
    const apiError = Object.assign(new Error("Bad Request"), {
      status: 400,
      data: { error: "Either customerId or prospectId is required" },
    });
    vi.mocked(atomicCreateWorkOrder).mockRejectedValue(apiError);

    await expect(replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID)).rejects.toThrowError(
      PermanentSyncError,
    );
  });

  // ── 8. 409 (key reuse mismatch) → PermanentSyncError ─────────────────────
  it("throws PermanentSyncError for 409 conflict", async () => {
    const apiError = Object.assign(new Error("Conflict"), {
      status: 409,
      data: { error: "This idempotency key was already used with a different request body." },
    });
    vi.mocked(atomicCreateWorkOrder).mockRejectedValue(apiError);

    await expect(replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID)).rejects.toThrowError(
      PermanentSyncError,
    );
  });

  // ── 9. 503 (in-flight) → transient (plain Error, NOT PermanentSyncError) ──
  it("throws plain Error for 503 so the item auto-retries", async () => {
    const apiError = Object.assign(new Error("Service Unavailable"), {
      status: 503,
      data: { error: "A request with this idempotency key is already in flight." },
    });
    vi.mocked(atomicCreateWorkOrder).mockRejectedValue(apiError);

    await expect(replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID)).rejects.toThrow(Error);
    // Must NOT be a PermanentSyncError.
    try {
      await replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID);
    } catch (err) {
      expect(err).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  // ── 10. 5xx → transient (plain Error) ────────────────────────────────────
  it("throws plain Error for 5xx so the item auto-retries", async () => {
    const apiError = Object.assign(new Error("Internal Server Error"), {
      status: 500,
      data: { error: "Transaction failed; please retry" },
    });
    vi.mocked(atomicCreateWorkOrder).mockRejectedValue(apiError);

    await expect(replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID)).rejects.toThrow(Error);
    try {
      await replayWorkOrder(BASE_PAYLOAD, TOKEN, PENDING_WRITE_ID);
    } catch (err) {
      expect(err).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  // ── 11. Empty payload (null) → no request made ────────────────────────────
  it("returns early without calling atomicCreateWorkOrder for null payload", async () => {
    await replayWorkOrder(null, TOKEN, PENDING_WRITE_ID);
    expect(atomicCreateWorkOrder).not.toHaveBeenCalled();
  });

  // ── 12. Empty lineItems array → still makes one request ──────────────────
  it("makes one request even when lineItems is empty", async () => {
    vi.mocked(atomicCreateWorkOrder).mockResolvedValue({
      id: 100,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    await replayWorkOrder({ customerId: 42, lineItems: [] }, TOKEN, PENDING_WRITE_ID);
    expect(atomicCreateWorkOrder).toHaveBeenCalledTimes(1);
  });
});
