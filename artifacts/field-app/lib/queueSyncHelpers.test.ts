/**
 * Unit tests for queueSyncHelpers – the pure helpers for compound offline
 * write operations and idempotency key construction.
 *
 * These are pure functions (no react-native, no AsyncStorage, no Expo) so
 * Vitest can run them directly in Node.
 */
import { describe, it, expect } from "vitest";
import { stepKey, withIdempotencyKey } from "@/lib/queueSyncHelpers";

describe("stepKey", () => {
  it("produces writeId:step format", () => {
    expect(stepKey("abc123", "create")).toBe("abc123:create");
  });

  it("produces stable keys for different steps of the same write", () => {
    const wid = "550e8400-e29b-41d4-a716-446655440000";
    expect(stepKey(wid, "create")).toBe(`${wid}:create`);
    expect(stepKey(wid, "claim")).toBe(`${wid}:claim`);
    expect(stepKey(wid, "assign")).toBe(`${wid}:assign`);
    expect(stepKey(wid, "photo")).toBe(`${wid}:photo`);
    expect(stepKey(wid, "transition")).toBe(`${wid}:transition`);
  });

  it("does not collide across different write ids and same step", () => {
    expect(stepKey("id-A", "create")).not.toBe(stepKey("id-B", "create"));
  });
});

describe("withIdempotencyKey", () => {
  it("returns RequestInit with X-Idempotency-Key header set", () => {
    const opts = withIdempotencyKey("my-key-123");
    expect((opts.headers as Record<string, string>)?.["X-Idempotency-Key"]).toBe(
      "my-key-123",
    );
  });

  it("always returns an object (never undefined)", () => {
    expect(withIdempotencyKey("x")).toBeDefined();
  });

  it("different keys produce different header values", () => {
    const a = withIdempotencyKey("key-A");
    const b = withIdempotencyKey("key-B");
    expect(
      (a.headers as Record<string, string>)["X-Idempotency-Key"],
    ).not.toBe((b.headers as Record<string, string>)["X-Idempotency-Key"]);
  });
});
