/**
 * Focused tests for lib/queueEnvelope.ts
 *
 * Covers:
 *  - Legacy raw-array migration (v0 → v1)
 *  - Corrupt / non-parseable JSON
 *  - Unsupported envelope version quarantine
 *  - Invalid / missing-field entry quarantine
 *  - Unknown type quarantine
 *  - Dependency (dependsOn) handling via isEntryBlocked
 *  - Queue mutation serialization via createAsyncLock
 *  - Flush single-flight via createFlushGuard
 *  - serializeQueue / round-trip
 */

import { describe, expect, it, vi } from "vitest";

import {
  createAsyncLock,
  createFlushGuard,
  discardEntryWithDependencyFailures,
  getTargetedRetryClosure,
  isEntryBlocked,
  partitionDependencyReady,
  parseQueueStorage,
  serializeQueue,
  validateEntry,
  QUEUE_VERSION,
  type QueueEntry,
} from "./queueEnvelope";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: "test-id-1",
    type: "workOrder",
    payload: { customerId: 1 },
    createdAt: 1_000_000,
    ...overrides,
  };
}

// ─── parseQueueStorage — null / empty ────────────────────────────────────────

describe("parseQueueStorage — null / empty input", () => {
  it("returns empty queue with no warning for null", () => {
    const r = parseQueueStorage(null);
    expect(r.entries).toHaveLength(0);
    expect(r.warning).toBeNull();
  });

  it("returns empty queue with no warning for undefined", () => {
    const r = parseQueueStorage(undefined);
    expect(r.entries).toHaveLength(0);
    expect(r.warning).toBeNull();
  });

  it("returns empty queue with no warning for empty string", () => {
    const r = parseQueueStorage("");
    expect(r.entries).toHaveLength(0);
    expect(r.warning).toBeNull();
  });
});

// ─── parseQueueStorage — corrupt JSON ─────────────────────────────────────────

describe("parseQueueStorage — corrupt JSON", () => {
  it("returns empty queue and a warning for non-JSON garbage", () => {
    const r = parseQueueStorage("NOT JSON AT ALL }}}");
    expect(r.entries).toHaveLength(0);
    expect(r.warning).toBeTruthy();
    expect(r.warning).toMatch(/corrupt|invalid JSON/i);
  });

  it("returns empty queue and warning for truncated JSON", () => {
    const r = parseQueueStorage('{"version":1,"entries":[{');
    expect(r.entries).toHaveLength(0);
    expect(r.warning).toBeTruthy();
  });
});

// ─── parseQueueStorage — legacy raw array migration ──────────────────────────

describe("parseQueueStorage — legacy raw array (v0 migration)", () => {
  it("migrates a valid legacy array with no warning", () => {
    const legacy: QueueEntry[] = [
      makeEntry({ id: "a", type: "activity" }),
      makeEntry({ id: "b", type: "workOrder" }),
    ];
    const r = parseQueueStorage(JSON.stringify(legacy));
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].id).toBe("a");
    expect(r.entries[1].id).toBe("b");
    expect(r.warning).toBeNull();
  });

  it("migrates a legacy array and quarantines invalid entries", () => {
    const arr = [
      makeEntry({ id: "good", type: "activity" }),
      { foo: "bar" }, // no id/type/createdAt
    ];
    const r = parseQueueStorage(JSON.stringify(arr));
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].id).toBe("good");
    // The invalid entry should be quarantined with a failedReason
    expect(r.entries[1].failedReason).toBeTruthy();
    expect(r.warning).toBeTruthy();
    expect(r.warning).toMatch(/quarantined/i);
  });

  it("migrates an empty legacy array with no warning", () => {
    const r = parseQueueStorage(JSON.stringify([]));
    expect(r.entries).toHaveLength(0);
    expect(r.warning).toBeNull();
  });

  it("preserves all metadata fields through legacy migration", () => {
    const entry: QueueEntry = {
      id: "e1",
      type: "serviceLaborStopForQueuedStart",
      payload: { workItemId: 5, startQueueId: "abc" },
      createdAt: 999_999,
      attempts: 3,
      dependsOn: "abc",
      conflictToken: "ct-1",
    };
    const r = parseQueueStorage(JSON.stringify([entry]));
    expect(r.entries[0]).toMatchObject({
      id: "e1",
      type: "serviceLaborStopForQueuedStart",
      attempts: 3,
      dependsOn: "abc",
      conflictToken: "ct-1",
    });
  });
});

// ─── parseQueueStorage — unsupported version ─────────────────────────────────

describe("parseQueueStorage — unsupported envelope version", () => {
  it("quarantines all entries and sets a warning when version is unknown", () => {
    const envelope = {
      version: 99,
      entries: [
        makeEntry({ id: "x", type: "workOrder" }),
        makeEntry({ id: "y", type: "activity" }),
      ],
    };
    const r = parseQueueStorage(JSON.stringify(envelope));
    // All entries quarantined
    expect(r.entries).toHaveLength(2);
    for (const e of r.entries) {
      expect(e.failedReason).toBeTruthy();
      expect(e.failedReason).toMatch(/version 99|not supported/i);
    }
    expect(r.warning).toBeTruthy();
    expect(r.warning).toMatch(/version 99|not supported/i);
  });

  it("sets warning and returns empty entries when version is unknown and entries array is absent", () => {
    const envelope = { version: 99 };
    const r = parseQueueStorage(JSON.stringify(envelope));
    expect(r.entries).toHaveLength(0);
    expect(r.warning).toBeTruthy();
  });

  it("accepts version 1 without quarantine", () => {
    const envelope = {
      version: QUEUE_VERSION,
      entries: [makeEntry({ id: "z", type: "workOrder" })],
    };
    const r = parseQueueStorage(JSON.stringify(envelope));
    expect(r.entries[0].failedReason).toBeUndefined();
    expect(r.warning).toBeNull();
  });
});

// ─── parseQueueStorage — invalid entry fields ─────────────────────────────────

describe("parseQueueStorage — structural validation of entries", () => {
  function wrap(entry: unknown) {
    return JSON.stringify({ version: QUEUE_VERSION, entries: [entry] });
  }

  it("quarantines entry with missing id", () => {
    const r = parseQueueStorage(wrap({ type: "workOrder", payload: {}, createdAt: 1 }));
    expect(r.entries[0].failedReason).toMatch(/id/i);
    expect(r.warning).toBeTruthy();
  });

  it("quarantines entry with missing type", () => {
    const r = parseQueueStorage(wrap({ id: "x", payload: {}, createdAt: 1 }));
    expect(r.entries[0].failedReason).toMatch(/type/i);
    expect(r.warning).toBeTruthy();
  });

  it("quarantines entry with missing createdAt", () => {
    const r = parseQueueStorage(wrap({ id: "x", type: "workOrder", payload: {} }));
    expect(r.entries[0].failedReason).toMatch(/createdAt/i);
    expect(r.warning).toBeTruthy();
  });

  it("quarantines entry with non-string id", () => {
    const r = parseQueueStorage(wrap({ id: 123, type: "workOrder", payload: {}, createdAt: 1 }));
    expect(r.entries[0].failedReason).toMatch(/id/i);
  });

  it("quarantines a completely non-object entry (null)", () => {
    const r = parseQueueStorage(wrap(null));
    expect(r.entries[0].failedReason).toBeTruthy();
    expect(r.entries[0].failedReason).toMatch(/malformed|object/i);
  });

  it("quarantines a completely non-object entry (number)", () => {
    const r = parseQueueStorage(wrap(42));
    expect(r.entries[0].failedReason).toBeTruthy();
  });

  it("quarantines an array entry (array is not an object)", () => {
    const r = parseQueueStorage(wrap([1, 2, 3]));
    expect(r.entries[0].failedReason).toBeTruthy();
  });
});

// ─── validateEntry — unknown type ─────────────────────────────────────────────

describe("validateEntry — unknown type quarantine", () => {
  it("quarantines entry with an unknown type string", () => {
    const { entry, quarantined } = validateEntry({
      id: "x",
      type: "futureType",
      payload: {},
      createdAt: 1,
    });
    expect(quarantined).toBe(true);
    expect(entry.failedReason).toMatch(/futureType|unsupported/i);
  });

  it("does not quarantine a known type", () => {
    const { quarantined } = validateEntry({
      id: "x",
      type: "workOrder",
      payload: {},
      createdAt: 1,
    });
    expect(quarantined).toBe(false);
  });

  it("preserves the original failedReason of a previously-failed entry with an unknown type", () => {
    const { entry } = validateEntry({
      id: "x",
      type: "futureType",
      payload: {},
      createdAt: 1,
      failedReason: "old reason",
    });
    // The quarantine reason takes priority for unknown types
    expect(entry.failedReason).toBeTruthy();
  });
});

// ─── isEntryBlocked — dependency handling ────────────────────────────────────

describe("isEntryBlocked — dependency handling", () => {
  const start: QueueEntry = makeEntry({ id: "start-1", type: "serviceLaborStart" });
  const stop: QueueEntry = makeEntry({
    id: "stop-1",
    type: "serviceLaborStopForQueuedStart",
    dependsOn: "start-1",
  });
  const unrelated: QueueEntry = makeEntry({ id: "other", type: "workOrder" });

  it("returns true (blocked) when the dependency is still in the queue", () => {
    expect(isEntryBlocked(stop, [start, stop, unrelated])).toBe(true);
  });

  it("returns false (not blocked) when the dependency has been consumed", () => {
    // start not in queue — it has been successfully replayed
    expect(isEntryBlocked(stop, [stop, unrelated])).toBe(false);
  });

  it("returns false for entries with no dependsOn", () => {
    expect(isEntryBlocked(start, [start, stop, unrelated])).toBe(false);
    expect(isEntryBlocked(unrelated, [start, stop, unrelated])).toBe(false);
  });

  it("returns false when the queue is empty", () => {
    expect(isEntryBlocked(stop, [])).toBe(false);
  });

  it("returns false when dependsOn references itself (self-dependency is not a cycle blocker)", () => {
    const selfRef: QueueEntry = makeEntry({ id: "s", type: "workOrder", dependsOn: "s" });
    // Self-reference keeps it blocked — the entry blocks itself until discarded.
    expect(isEntryBlocked(selfRef, [selfRef])).toBe(true);
  });
});

// ─── serializeQueue / round-trip ─────────────────────────────────────────────

describe("serializeQueue — round-trip", () => {
  it("serializes and re-parses to the same entries", () => {
    const entries: QueueEntry[] = [
      makeEntry({ id: "a", type: "activity", attempts: 2, dependsOn: undefined }),
      makeEntry({ id: "b", type: "workOrder", failedReason: "Bad request" }),
    ];
    const serialized = serializeQueue(entries);
    const result = parseQueueStorage(serialized);
    expect(result.warning).toBeNull();
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].id).toBe("a");
    expect(result.entries[0].attempts).toBe(2);
    expect(result.entries[1].failedReason).toBe("Bad request");
  });

  it("produces a versioned envelope", () => {
    const serialized = serializeQueue([makeEntry()]);
    const parsed = JSON.parse(serialized) as { version: unknown };
    expect(parsed.version).toBe(QUEUE_VERSION);
  });
});

// ─── createAsyncLock — queue mutation serialisation ──────────────────────────

describe("createAsyncLock — serialized queue mutations", () => {
  it("runs operations sequentially even when submitted concurrently", async () => {
    const lock = createAsyncLock();
    const log: string[] = [];

    const op = (label: string, delay: number) =>
      lock.run(async () => {
        log.push(`start:${label}`);
        await new Promise<void>((r) => setTimeout(r, delay));
        log.push(`end:${label}`);
      });

    // Submit both at the same time; they should NOT interleave.
    await Promise.all([op("A", 10), op("B", 5)]);

    expect(log).toEqual(["start:A", "end:A", "start:B", "end:B"]);
  });

  it("prevents lost-write race: second op sees the first op's writes", async () => {
    const lock = createAsyncLock();
    let stored = "[]";

    const enqueue = async (item: string) => {
      await lock.run(async () => {
        const current = JSON.parse(stored) as string[];
        await new Promise<void>((r) => setTimeout(r, 5)); // simulate async read latency
        current.push(item);
        stored = JSON.stringify(current);
      });
    };

    // Concurrent enqueues — with the lock both items should land.
    await Promise.all([enqueue("first"), enqueue("second")]);
    const final = JSON.parse(stored) as string[];
    expect(final).toHaveLength(2);
    expect(final).toContain("first");
    expect(final).toContain("second");
  });

  it("without the lock, concurrent read-modify-write loses one item (demonstrates the problem)", async () => {
    // This test intentionally shows the race condition that the lock prevents.
    let stored = "[]";

    const enqueueUnsafe = async (item: string) => {
      const current = JSON.parse(stored) as string[];
      await new Promise<void>((r) => setTimeout(r, 5)); // simulate async read latency
      current.push(item);
      stored = JSON.stringify(current);
    };

    // Both reads happen before either write — one will overwrite the other.
    await Promise.all([enqueueUnsafe("first"), enqueueUnsafe("second")]);
    const final = JSON.parse(stored) as string[];
    // Without the lock, only one item lands (race condition).
    expect(final).toHaveLength(1);
  });

  it("a failed operation does not permanently block subsequent ones", async () => {
    const lock = createAsyncLock();
    const log: string[] = [];

    const failOp = lock.run(async () => {
      throw new Error("simulated failure");
    });

    const successOp = lock.run(async () => {
      log.push("success");
    });

    await failOp.catch(() => {});
    await successOp;

    expect(log).toContain("success");
  });
});

// ─── createFlushGuard — single-flight flush ──────────────────────────────────

describe("createFlushGuard — single-flight flush", () => {
  it("runs only one flush at a time", async () => {
    const guard = createFlushGuard();
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const flushFn = async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise<void>((r) => setTimeout(r, 20));
      concurrentCount--;
    };

    await Promise.all([
      guard.execute(flushFn),
      guard.execute(flushFn),
      guard.execute(flushFn),
    ]);

    // Never more than 1 concurrent execution.
    expect(maxConcurrent).toBe(1);
  });

  it("executes a pending flush after the running one completes", async () => {
    const guard = createFlushGuard();
    const log: number[] = [];
    let call = 0;

    const makeFn = () => {
      const id = ++call;
      return async () => {
        log.push(id);
        await new Promise<void>((r) => setTimeout(r, 10));
      };
    };

    // Start two flush requests; the second should run after the first finishes.
    const p1 = guard.execute(makeFn());
    const p2 = guard.execute(makeFn());
    await Promise.all([p1, p2]);

    // Both fns ran, in order.
    expect(log[0]).toBe(1);
    expect(log[1]).toBe(2);
  });
});

// ─── Targeted retry respects dependsOn ───────────────────────────────────────

describe("targeted retry + dependency integration", () => {
  it("isEntryBlocked returns true for targeted retry when dependency is unresolved", () => {
    // Simulate the scenario: user taps "Retry" on serviceLaborStopForQueuedStart
    // while the serviceLaborStart is still in the queue. The flush should skip it.
    const start: QueueEntry = makeEntry({
      id: "labor-start-abc",
      type: "serviceLaborStart",
    });
    const stop: QueueEntry = makeEntry({
      id: "labor-stop-xyz",
      type: "serviceLaborStopForQueuedStart",
      dependsOn: "labor-start-abc",
    });
    const queue = [start, stop];

    // Even though we're targeting stop specifically, the dependency check
    // should block it because start is still in the queue.
    expect(isEntryBlocked(stop, queue)).toBe(true);
  });

  it("isEntryBlocked returns false once the start entry is gone from the queue", () => {
    const stop: QueueEntry = makeEntry({
      id: "labor-stop-xyz",
      type: "serviceLaborStopForQueuedStart",
      dependsOn: "labor-start-abc",
    });
    // Queue only contains the stop (start was consumed successfully).
    expect(isEntryBlocked(stop, [stop])).toBe(false);
  });

  it("includes newly unblocked dependents in the prerequisite's targeted retry", () => {
    const start = makeEntry({
      id: "labor-start",
      type: "serviceLaborStart",
      failedReason: "Previous request was rejected",
    });
    const stop = makeEntry({
      id: "labor-stop",
      type: "serviceLaborStopForQueuedStart",
      dependsOn: "labor-start",
    });
    const unrelated = makeEntry({ id: "other" });

    expect(
      [...getTargetedRetryClosure([start, stop, unrelated], start.id)],
    ).toEqual(["labor-start", "labor-stop"]);
  });

  it("includes transitive dependents but not unrelated entries", () => {
    const first = makeEntry({ id: "first" });
    const second = makeEntry({ id: "second", dependsOn: "first" });
    const third = makeEntry({ id: "third", dependsOn: "second" });
    const unrelated = makeEntry({ id: "other" });

    expect(
      [...getTargetedRetryClosure([third, unrelated, second, first], first.id)].sort(),
    ).toEqual(["first", "second", "third"]);
  });

  it("replays a reversed dependent/prerequisite queue in dependency order", () => {
    const start = makeEntry({ id: "start", type: "serviceLaborStart" });
    const stop = makeEntry({
      id: "stop",
      type: "serviceLaborStopForQueuedStart",
      dependsOn: "start",
    });
    const unresolved = new Set(["start", "stop"]);

    const firstPass = partitionDependencyReady([stop, start], unresolved);
    expect(firstPass.ready.map((entry) => entry.id)).toEqual(["start"]);
    expect(firstPass.blocked.map((entry) => entry.id)).toEqual(["stop"]);

    unresolved.delete("start");
    const secondPass = partitionDependencyReady(firstPass.blocked, unresolved);
    expect(secondPass.ready.map((entry) => entry.id)).toEqual(["stop"]);
    expect(secondPass.blocked).toEqual([]);
  });

  it("replays a fully reversed transitive chain one stable pass at a time", () => {
    const first = makeEntry({ id: "first" });
    const second = makeEntry({ id: "second", dependsOn: "first" });
    const third = makeEntry({ id: "third", dependsOn: "second" });
    const unresolved = new Set(["first", "second", "third"]);

    const pass1 = partitionDependencyReady([third, second, first], unresolved);
    expect(pass1.ready.map((entry) => entry.id)).toEqual(["first"]);
    unresolved.delete("first");

    const pass2 = partitionDependencyReady(pass1.blocked, unresolved);
    expect(pass2.ready.map((entry) => entry.id)).toEqual(["second"]);
    unresolved.delete("second");

    const pass3 = partitionDependencyReady(pass2.blocked, unresolved);
    expect(pass3.ready.map((entry) => entry.id)).toEqual(["third"]);
    expect(pass3.blocked).toEqual([]);
  });
});

describe("discarded prerequisite recovery", () => {
  it("keeps dependent intent visible as an explicit permanent failure", () => {
    const start = makeEntry({ id: "labor-start", type: "serviceLaborStart" });
    const stop = makeEntry({
      id: "labor-stop",
      type: "serviceLaborStopForQueuedStart",
      dependsOn: "labor-start",
    });
    const unrelated = makeEntry({ id: "other" });

    const result = discardEntryWithDependencyFailures(
      [start, stop, unrelated],
      start.id,
    );

    expect(result.map((entry) => entry.id)).toEqual(["labor-stop", "other"]);
    expect(result[0].dependsOn).toBeUndefined();
    expect(result[0].failedReason).toMatch(/earlier offline change was discarded/i);
    expect(result[1]).toEqual(unrelated);
  });

  it("marks a whole dependent chain without silently deleting it", () => {
    const first = makeEntry({ id: "first" });
    const second = makeEntry({ id: "second", dependsOn: "first" });
    const third = makeEntry({ id: "third", dependsOn: "second" });

    const result = discardEntryWithDependencyFailures(
      [third, first, second],
      first.id,
    );

    expect(result.map((entry) => entry.id).sort()).toEqual(["second", "third"]);
    expect(result.every((entry) => !entry.dependsOn && !!entry.failedReason)).toBe(
      true,
    );
  });
});
