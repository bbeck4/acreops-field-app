import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PermanentSyncError } from "@/lib/offlineSyncError";
import { postServicePackageOrder } from "@/lib/servicePackageReplay";

// Offline replay verification for a queued "servicePackageOrder" write (the
// field-app half of "Confirm reps can quote and sell service packages end to
// end"). QueueSync itself pulls in react-native, so the replay handler is
// extracted into a pure module we can drive with a mocked fetch here.
//
// Contract under test (mirrors the pending-sync tray behavior):
//   • A successful POST /api/service-packages/save resolves quietly (item is
//     consumed off the queue).
//   • A 4xx (bad/gone customer, prospect not quote-able, etc.) becomes a
//     PermanentSyncError carrying the server's message → the tray keeps it with
//     failedReason set for the rep to review/discard, never auto-retried.
//   • 408/425/429 are transient (rate-limited/timeout) → plain Error, auto-retried.
//   • A 5xx / network error stays a plain Error → the item shows as "Waiting"
//     and is auto-retried.
//   • The queue write id is sent as X-Idempotency-Key for deduplication.
//   • Missing EXPO_PUBLIC_DOMAIN throws an Error (not silently no-ops).
//   • Missing/invalid payload throws a PermanentSyncError (not silently no-ops).

const DOMAIN = "test.example.com";
const TOKEN = "test-token";
const WRITE_ID = "550e8400-e29b-41d4-a716-446655440000";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("postServicePackageOrder replay", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_DOMAIN = DOMAIN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EXPO_PUBLIC_DOMAIN;
  });

  it("posts the queued payload to /service-packages/save and resolves on success", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(201, { workOrder: { id: 42 }, quote: { total: 500 } }));

    const payload = {
      customerId: 7,
      asWorkOrder: true,
      lines: [{ packageKey: "planter", quantity: 8 }],
    };
    await expect(postServicePackageOrder(payload, TOKEN, WRITE_ID)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://${DOMAIN}/api/service-packages/save`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init?.body as string)).toEqual(payload);
  });

  it("sends X-Idempotency-Key matching the write id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(201, {}));

    await postServicePackageOrder({ customerId: 1 }, TOKEN, WRITE_ID);

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>)["X-Idempotency-Key"]).toBe(WRITE_ID);
  });

  it("omits X-Idempotency-Key when writeId is not provided (backwards compat)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(201, {}));

    await postServicePackageOrder({ customerId: 1 }, TOKEN);

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(
      (init?.headers as Record<string, string>)?.["X-Idempotency-Key"],
    ).toBeUndefined();
  });

  it("turns a 4xx rejection into a PermanentSyncError carrying the server message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(409, { error: "This prospect is still pending intake review." }),
    );

    const err = await postServicePackageOrder({ prospectId: 3, lines: [] }, TOKEN, WRITE_ID).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentSyncError);
    expect((err as PermanentSyncError).serverMessage).toMatch(/pending intake review/i);
  });

  it("falls back to a generic permanent message when a 4xx body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Bad Request", { status: 400 }),
    );

    const err = await postServicePackageOrder({ customerId: 1, lines: [] }, TOKEN, WRITE_ID).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentSyncError);
    expect((err as PermanentSyncError).serverMessage).toMatch(/HTTP 400/);
  });

  it("keeps a 408 (Request Timeout) as a plain transient Error so the item auto-retries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(408, { error: "timeout" }),
    );

    const err = await postServicePackageOrder({ customerId: 1 }, TOKEN, WRITE_ID).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentSyncError);
  });

  it("keeps a 429 (Too Many Requests) as a plain transient Error so the item auto-retries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(429, { error: "rate limited" }),
    );

    const err = await postServicePackageOrder({ customerId: 1 }, TOKEN, WRITE_ID).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentSyncError);
  });

  it("keeps a 503 as a plain transient Error (in-flight duplicate)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(503, { error: "in-flight" }),
    );

    const err = await postServicePackageOrder({ customerId: 1 }, TOKEN, WRITE_ID).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentSyncError);
  });

  it("keeps a 5xx as a plain (transient) Error so the item auto-retries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(500, { error: "boom" }),
    );

    const err = await postServicePackageOrder({ customerId: 1, lines: [] }, TOKEN, WRITE_ID).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PermanentSyncError);
  });

  it("throws an Error (not silently no-ops) when the domain is not configured", async () => {
    delete process.env.EXPO_PUBLIC_DOMAIN;
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const err = await postServicePackageOrder({ customerId: 1, lines: [] }, TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws PermanentSyncError (not silently no-ops) when the payload is null", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const err = await postServicePackageOrder(null, TOKEN, WRITE_ID).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentSyncError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws PermanentSyncError (not silently no-ops) when the payload is a primitive", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const err = await postServicePackageOrder("bad", TOKEN, WRITE_ID).catch((e) => e);
    expect(err).toBeInstanceOf(PermanentSyncError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
