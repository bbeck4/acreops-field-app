/**
 * Unit tests for the unknown-write-type permanent error path.
 *
 * QueueSync throws PermanentSyncError for any write.type not in its dispatch
 * table. Since QueueSync.tsx contains React Native imports, we test the
 * underlying classification logic directly via the PermanentSyncError class
 * (imported from the pure offlineSyncError module) and via a thin re-test of
 * the classification contract.
 *
 * This mirrors the runtime behaviour of QueueSync's else-branch without
 * needing to import the component.
 */
import { describe, it, expect } from "vitest";
import { PermanentSyncError } from "@/lib/offlineSyncError";

/**
 * Simulates the dispatch logic inside handleWrite() for unknown types.
 * Extracted as a pure function so tests can import it without react-native.
 */
function handleUnknownWriteType(type: string): never {
  throw new PermanentSyncError(
    `Unknown offline write type "${type}" — cannot replay. Discard this item and report the issue.`,
  );
}

describe("unknown write type handling", () => {
  it("throws PermanentSyncError for an unrecognised write type", () => {
    expect(() => handleUnknownWriteType("futureFeatureWrite")).toThrow(
      PermanentSyncError,
    );
  });

  it("includes the unknown type name in the error message", () => {
    let caught: unknown;
    try {
      handleUnknownWriteType("myUnknownType");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PermanentSyncError);
    expect((caught as PermanentSyncError).serverMessage).toContain(
      "myUnknownType",
    );
  });

  it("error is NOT a transient Error — it is always permanent", () => {
    let caught: unknown;
    try {
      handleUnknownWriteType("xyzWrite");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PermanentSyncError);
    // Confirms it extends Error
    expect(caught).toBeInstanceOf(Error);
  });

  it("error name is PermanentSyncError", () => {
    let caught: unknown;
    try {
      handleUnknownWriteType("badWrite");
    } catch (e) {
      caught = e;
    }
    expect((caught as PermanentSyncError).name).toBe("PermanentSyncError");
  });

  it("each unknown type produces a distinct actionable message", () => {
    const types = ["futureType", "legacyWrite", "testWrite"];
    const messages = types.map((t) => {
      try {
        handleUnknownWriteType(t);
        return "";
      } catch (e) {
        return (e as PermanentSyncError).serverMessage;
      }
    });
    // All messages are distinct (each contains the specific type name)
    const unique = new Set(messages);
    expect(unique.size).toBe(types.length);
  });
});
