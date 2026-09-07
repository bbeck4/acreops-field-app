/**
 * Unit tests for syncClassify – the centralized 4xx-vs-transient
 * classification helper for offline queue replay.
 *
 * Contract:
 *   • 408 / 425 / 429   → transient (rethrows original error)
 *   • 409 key mismatch  → permanent (PermanentSyncError)
 *   • Other 4xx         → permanent (PermanentSyncError)
 *   • 503               → transient (in-flight duplicate — rethrows original)
 *   • 5xx               → transient (rethrows original error)
 *   • Unknown shape     → rethrows as-is
 */
import { describe, it, expect } from "vitest";
import { classifyAndRethrow, classifyFetchStatus } from "@/lib/syncClassify";
import { PermanentSyncError } from "@/lib/offlineSyncError";

// ---------------------------------------------------------------------------
// Helper to build a minimal ApiError-like object
// ---------------------------------------------------------------------------
function apiError(
  status: number,
  message?: string,
  dataError?: string,
): object {
  return {
    name: "ApiError",
    status,
    message: message ?? `HTTP ${status}`,
    data: dataError ? { error: dataError } : undefined,
  };
}

// ---------------------------------------------------------------------------
// classifyAndRethrow
// ---------------------------------------------------------------------------

describe("classifyAndRethrow", () => {
  it("turns 400 into PermanentSyncError", () => {
    expect(() =>
      classifyAndRethrow(apiError(400, "Bad Request"), "fallback"),
    ).toThrow(PermanentSyncError);
  });

  it("turns 401 into PermanentSyncError", () => {
    expect(() =>
      classifyAndRethrow(apiError(401, "Unauthorized"), "fallback"),
    ).toThrow(PermanentSyncError);
  });

  it("turns 403 into PermanentSyncError", () => {
    expect(() =>
      classifyAndRethrow(apiError(403, "Forbidden"), "fallback"),
    ).toThrow(PermanentSyncError);
  });

  it("turns 404 into PermanentSyncError", () => {
    expect(() =>
      classifyAndRethrow(apiError(404, "Not Found"), "fallback"),
    ).toThrow(PermanentSyncError);
  });

  it("turns 409 key mismatch into PermanentSyncError", () => {
    const err = apiError(
      409,
      "Conflict",
      "This idempotency key was already used with a different request body.",
    );
    expect(() => classifyAndRethrow(err, "fallback")).toThrow(PermanentSyncError);
  });

  it("uses the data.error field as the PermanentSyncError message when present", () => {
    const err = apiError(422, "Unprocessable", "Field ID is required");
    let caught: unknown;
    try {
      classifyAndRethrow(err, "generic fallback");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PermanentSyncError);
    expect((caught as PermanentSyncError).serverMessage).toBe(
      "Field ID is required",
    );
  });

  it("falls back to the fallback string when no data.error is present", () => {
    const err = { status: 400 };
    let caught: unknown;
    try {
      classifyAndRethrow(err, "my fallback message");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PermanentSyncError);
    expect((caught as PermanentSyncError).serverMessage).toBe(
      "my fallback message",
    );
  });

  it("keeps 408 (Request Timeout) as transient — rethrows original error, NOT PermanentSyncError", () => {
    const err = apiError(408, "Request Timeout");
    // The thrown value is the original object (rethrown as-is), not necessarily
    // an Error instance — just confirm it is NOT a PermanentSyncError.
    let caught: unknown;
    try {
      classifyAndRethrow(err, "fallback");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(PermanentSyncError);
  });

  it("keeps 425 (Too Early) as transient", () => {
    const err = apiError(425, "Too Early");
    try {
      classifyAndRethrow(err, "fallback");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  it("keeps 429 (Too Many Requests) as transient", () => {
    const err = apiError(429, "Too Many Requests");
    try {
      classifyAndRethrow(err, "fallback");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  it("keeps 503 as transient (in-flight idempotency duplicate)", () => {
    const err = apiError(
      503,
      "Service Unavailable",
      "A request with this idempotency key is already in flight.",
    );
    try {
      classifyAndRethrow(err, "fallback");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  it("keeps 500 as transient", () => {
    const err = apiError(500, "Internal Server Error");
    try {
      classifyAndRethrow(err, "fallback");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  it("keeps 502 as transient", () => {
    const err = apiError(502, "Bad Gateway");
    try {
      classifyAndRethrow(err, "fallback");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  it("rethrows unknown-shaped errors as-is (e.g. TypeError / network error)", () => {
    const networkErr = new TypeError("Failed to fetch");
    expect(() => classifyAndRethrow(networkErr, "fallback")).toThrow(TypeError);
    try {
      classifyAndRethrow(networkErr, "fallback");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  it("rethrows plain Error objects that have no status as-is", () => {
    const plainErr = new Error("connection reset");
    expect(() => classifyAndRethrow(plainErr, "fallback")).toThrow(
      "connection reset",
    );
    try {
      classifyAndRethrow(plainErr, "fallback");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });
});

// ---------------------------------------------------------------------------
// classifyFetchStatus
// ---------------------------------------------------------------------------

describe("classifyFetchStatus", () => {
  it("throws PermanentSyncError for 400", () => {
    expect(() =>
      classifyFetchStatus(400, "Server rejected this quote (HTTP 400)"),
    ).toThrow(PermanentSyncError);
  });

  it("throws PermanentSyncError for 409 with the supplied message", () => {
    const msg = "Key reuse mismatch";
    let caught: unknown;
    try {
      classifyFetchStatus(409, msg);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PermanentSyncError);
    expect((caught as PermanentSyncError).serverMessage).toBe(msg);
  });

  it("throws plain Error for 408 (transient)", () => {
    expect(() => classifyFetchStatus(408, "timeout")).toThrow(Error);
    try {
      classifyFetchStatus(408, "timeout");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  it("throws plain Error for 429 (transient)", () => {
    try {
      classifyFetchStatus(429, "rate limited");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  it("throws plain Error for 503 (transient in-flight)", () => {
    try {
      classifyFetchStatus(503, "in-flight duplicate");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });

  it("throws plain Error for 500 (transient)", () => {
    try {
      classifyFetchStatus(500, "server error");
    } catch (e) {
      expect(e).not.toBeInstanceOf(PermanentSyncError);
    }
  });
});
