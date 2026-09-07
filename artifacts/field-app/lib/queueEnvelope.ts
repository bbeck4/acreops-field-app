/**
 * Versioned queue-envelope module for offline write persistence.
 *
 * Responsibilities:
 *  - Wrap the raw entry array in a versioned envelope so future format changes
 *    can be migrated rather than discarded.
 *  - Migrate legacy raw-array storage (v0) to the current envelope format (v1)
 *    transparently on first read.
 *  - Validate every entry structurally; malformed / unknown-type entries are
 *    quarantined in place (kept as "failed" with a descriptive failedReason)
 *    so they remain visible to the rep rather than silently draining.
 *  - Expose serialised, single-flight AsyncStorage helpers so concurrent
 *    callers cannot lose writes via interleaved read-modify-write.
 *  - Preserve attempt-count, conflict metadata, and `dependsOn` fields through
 *    every mutation so retry logic and dependency checks have stable data.
 *
 * This module is pure TypeScript — no React or react-native bindings — so it
 * can be unit-tested with Vitest in a plain Node environment.
 */

// ─── Version constant ─────────────────────────────────────────────────────────

export const QUEUE_VERSION = 1 as const;
export type QueueVersion = typeof QUEUE_VERSION;

// ─── Entry-level types ────────────────────────────────────────────────────────

/**
 * All type values the current schema recognises. Entries whose type is NOT in
 * this set are quarantined with failedReason set to a "unsupported type"
 * message rather than silently dropped.
 */
export const KNOWN_TYPES = new Set([
  "activity",
  "workOrder",
  "servicePackageOrder",
  "reassignRouteStops",
  "addRouteStop",
  "updateRouteStop",
  "checkInRouteStop",
  "deleteRouteStop",
  "completeDeliveryStop",
  "deliveryIncident",
  "serviceJobComplete",
  "serviceJobEnRoute",
  "serviceJobOnSite",
  "serviceJobUpdate",
  "serviceJobPartsUpdate",
  "serviceLaborStart",
  "serviceLaborStop",
  "serviceLaborStopForQueuedStart",
  "sampleTransition",
  "samplingPlan",
  "samplingAddPoint",
  "samplingGrid",
]);

/**
 * A healthy queue entry. Extends the legacy PendingWrite shape with additional
 * metadata that the hardened queue tracks. All new fields are optional so the
 * migration from legacy arrays stays zero-copy for well-formed entries.
 */
export interface QueueEntry {
  /** Stable unique id (generated at queue time). */
  id: string;
  /** Discriminator for the replay handler. */
  type: string;
  /** Opaque payload; replay handlers parse and validate against their own types. */
  payload: unknown;
  /** Unix ms timestamp recorded when the entry was queued. */
  createdAt: number;
  /**
   * Set when the most recent replay attempt produced a PERMANENT server
   * rejection (4xx). Never set for transient connectivity errors — those show
   * as "Waiting" and are auto-retried. Cleared when the rep taps "Retry".
   */
  failedReason?: string;
  /**
   * How many replay attempts have been made (successful or failed). Incremented
   * by the flush loop; useful for backoff decisions and diagnostics.
   */
  attempts?: number;
  /**
   * Id of another queue entry that MUST succeed before this entry is eligible
   * for replay. Used by serviceLaborStopForQueuedStart to express its
   * dependency on the paired serviceLaborStart entry.
   *
   * A flush that finds this entry's dependency still present in the queue
   * treats the entry as blocked and keeps it without incrementing attempts.
   * A targeted single-item retry that encounters an unresolved dependency
   * also skips the entry rather than replaying it out of order.
   */
  dependsOn?: string;
  /**
   * Opaque conflict token retained for reconciling a 409. The pending tray
   * keeps the entry actionable until the rep explicitly retries or discards it.
   */
  conflictToken?: string;
  /** Wall-clock time of the most recent replay attempt. */
  lastAttemptAt?: number;
  /** HTTP status from the most recent classified failure, when available. */
  lastStatus?: number;
}

// ─── Envelope ─────────────────────────────────────────────────────────────────

/**
 * Versioned wrapper around the entry array stored in AsyncStorage.
 */
export interface QueueEnvelope {
  version: QueueVersion;
  entries: QueueEntry[];
  /**
   * Human-readable description of any structural problems found during
   * deserialization (corrupt JSON, bad version, etc.). Set by the decoder;
   * read by the UI to show a queue warning banner.
   */
  warning?: string;
}

// ─── Deserialization / migration ──────────────────────────────────────────────

/**
 * Result of parsing raw AsyncStorage content. `warning` is non-empty when any
 * structural problem was encountered — the UI should surface it to the rep.
 */
export interface ParseResult {
  entries: QueueEntry[];
  warning: string | null;
  /** True when a legacy array should be rewritten as the current envelope. */
  needsRewrite: boolean;
}

/**
 * Validate a single candidate entry object.
 *
 * Returns the (possibly quarantined) entry and a flag indicating whether it
 * was quarantined. A quarantined entry keeps all its fields but gets
 * failedReason set to a descriptive message and its payload preserved so the
 * rep can discard it explicitly. It is never silently dropped.
 *
 * Base-field validation:
 *   - id   must be a non-empty string
 *   - type must be a string (known or unknown)
 *   - createdAt must be a positive finite number
 *
 * Unknown type → quarantine with "unsupported type" message.
 * Missing/invalid base fields → quarantine with "malformed entry" message.
 */
export function validateEntry(candidate: unknown): { entry: QueueEntry; quarantined: boolean } {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    // Not even an object — manufacture a minimal stub so the rep can see it.
    const stub: QueueEntry = {
      id: `quarantine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: "__corrupt__",
      payload: candidate,
      createdAt: Date.now(),
      failedReason: "Malformed queue entry: expected an object",
    };
    return { entry: stub, quarantined: true };
  }

  const raw = candidate as Record<string, unknown>;

  // Check base fields.
  const id = raw["id"];
  const type = raw["type"];
  const createdAt = raw["createdAt"];

  const missingFields: string[] = [];
  if (typeof id !== "string" || id.length === 0) missingFields.push("id");
  if (typeof type !== "string" || type.length === 0) missingFields.push("type");
  if (typeof createdAt !== "number" || !isFinite(createdAt) || createdAt <= 0) {
    missingFields.push("createdAt");
  }

  if (missingFields.length > 0) {
    const safeId =
      typeof id === "string" && id.length > 0
        ? id
        : `quarantine-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry: QueueEntry = {
      id: safeId,
      type: typeof type === "string" ? type : "__corrupt__",
      payload: raw["payload"],
      createdAt: typeof createdAt === "number" ? createdAt : Date.now(),
      failedReason: `Malformed queue entry: missing fields [${missingFields.join(", ")}]`,
      ...(raw["failedReason"] !== undefined ? {} : {}), // preserve existing failedReason below
      attempts: typeof raw["attempts"] === "number" ? raw["attempts"] : undefined,
      dependsOn: typeof raw["dependsOn"] === "string" ? raw["dependsOn"] : undefined,
      conflictToken: typeof raw["conflictToken"] === "string" ? raw["conflictToken"] : undefined,
      lastAttemptAt: typeof raw["lastAttemptAt"] === "number" ? raw["lastAttemptAt"] : undefined,
      lastStatus: typeof raw["lastStatus"] === "number" ? raw["lastStatus"] : undefined,
    };
    // If the entry already had a failedReason, keep it (so discard-then-reparse doesn't wipe context).
    if (typeof raw["failedReason"] === "string" && !entry.failedReason) {
      entry.failedReason = raw["failedReason"];
    }
    return { entry, quarantined: true };
  }

  // All base fields valid. Now check the type discriminator.
  const entryId = id as string;
  const entryType = type as string;
  const entryCreatedAt = createdAt as number;

  const failedReason = typeof raw["failedReason"] === "string" ? raw["failedReason"] : undefined;
  const attempts = typeof raw["attempts"] === "number" ? raw["attempts"] : undefined;
  const dependsOn = typeof raw["dependsOn"] === "string" ? raw["dependsOn"] : undefined;
  const conflictToken =
    typeof raw["conflictToken"] === "string" ? raw["conflictToken"] : undefined;
  const lastAttemptAt =
    typeof raw["lastAttemptAt"] === "number" ? raw["lastAttemptAt"] : undefined;
  const lastStatus = typeof raw["lastStatus"] === "number" ? raw["lastStatus"] : undefined;

  if (!KNOWN_TYPES.has(entryType)) {
    const entry: QueueEntry = {
      id: entryId,
      type: entryType,
      payload: raw["payload"],
      createdAt: entryCreatedAt,
      failedReason: failedReason ?? `Unsupported entry type: "${entryType}" — cannot replay`,
      attempts,
      dependsOn,
      conflictToken,
      lastAttemptAt,
      lastStatus,
    };
    return { entry, quarantined: true };
  }

  // Healthy entry.
  const entry: QueueEntry = {
    id: entryId,
    type: entryType,
    payload: raw["payload"],
    createdAt: entryCreatedAt,
    ...(failedReason !== undefined ? { failedReason } : {}),
    ...(attempts !== undefined ? { attempts } : {}),
    ...(dependsOn !== undefined ? { dependsOn } : {}),
    ...(conflictToken !== undefined ? { conflictToken } : {}),
    ...(lastAttemptAt !== undefined ? { lastAttemptAt } : {}),
    ...(lastStatus !== undefined ? { lastStatus } : {}),
  };
  return { entry, quarantined: false };
}

/**
 * Parse raw AsyncStorage content into a `ParseResult`.
 *
 * Handles four cases:
 *   1. null / undefined → empty queue, no warning
 *   2. Corrupt / non-JSON string → empty queue with warning
 *   3. Legacy raw array (no version field) → migrate each element
 *   4. Versioned envelope → check version, validate entries
 *
 * Any entry that fails structural validation is quarantined in-place (kept
 * with failedReason) so the rep can review and explicitly discard it. The
 * overall `warning` is set whenever quarantine occurs or the version is
 * unrecognised so the UI can show an actionable banner.
 */
export function parseQueueStorage(raw: string | null | undefined): ParseResult {
  // Case 1: nothing stored yet.
  if (raw === null || raw === undefined || raw === "") {
    return { entries: [], warning: null, needsRewrite: false };
  }

  // Case 2: parse JSON.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      entries: [],
      warning: "Queue storage is corrupt (invalid JSON). Prior offline writes could not be recovered.",
      needsRewrite: false,
    };
  }

  // Case 3: legacy raw array.
  if (Array.isArray(parsed)) {
    return { ...migrateLegacyArray(parsed), needsRewrite: true };
  }

  // Case 4: versioned envelope.
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const version = obj["version"];

    if (version !== QUEUE_VERSION) {
      // Unknown version — quarantine all entries rather than discarding them.
      const knownEntries = Array.isArray(obj["entries"]) ? obj["entries"] : [];
      const quarantined = knownEntries.map((e: unknown) => {
        const { entry } = validateEntry(e);
        return {
          ...entry,
          failedReason:
            entry.failedReason ??
            `Queue version ${String(version)} is not supported by this app version — cannot replay`,
        } as QueueEntry;
      });
      // If there were no entries array at all, treat as corrupt.
      if (!Array.isArray(obj["entries"])) {
        return {
          entries: [],
          warning: `Queue envelope has unrecognised version (${String(version)}) and no entries array. Data may be from a newer app version.`,
          needsRewrite: false,
        };
      }
      return {
        entries: quarantined,
        warning: `Queue envelope version ${String(version)} is not supported. ${quarantined.length} pending write(s) quarantined until the app is updated.`,
        needsRewrite: false,
      };
    }

    // Version matches — validate each entry.
    const raw_entries = Array.isArray(obj["entries"]) ? obj["entries"] : [];
    return validateEntryList(raw_entries, null);
  }

  // Completely unrecognised shape.
  return {
    entries: [],
    warning: "Queue storage has an unrecognised format. Prior offline writes could not be recovered.",
      needsRewrite: false,
  };
}

/** Migrate a legacy raw-array format (v0) to the current envelope format. */
function migrateLegacyArray(arr: unknown[]): ParseResult {
  return validateEntryList(arr, null);
}

/**
 * Validate a list of raw entry candidates, quarantining invalid ones in-place.
 * Returns the list and a warning if any were quarantined.
 */
function validateEntryList(candidates: unknown[], existingWarning: string | null): ParseResult {
  const entries: QueueEntry[] = [];
  let quarantineCount = 0;

  for (const candidate of candidates) {
    const { entry, quarantined } = validateEntry(candidate);
    entries.push(entry);
    if (quarantined) quarantineCount++;
  }

  let warning = existingWarning;
  if (quarantineCount > 0) {
    const plural = quarantineCount === 1 ? "entry" : "entries";
    const msg = `${quarantineCount} queue ${plural} could not be validated and have been quarantined. Review them in the pending sync tray.`;
    warning = warning ? `${warning} ${msg}` : msg;
  }

  return { entries, warning, needsRewrite: quarantineCount > 0 };
}

/**
 * Serialize a list of entries into a versioned envelope JSON string ready for
 * AsyncStorage.setItem.
 */
export function serializeQueue(entries: QueueEntry[]): string {
  const envelope: QueueEnvelope = {
    version: QUEUE_VERSION,
    entries,
  };
  return JSON.stringify(envelope);
}

// ─── Dependency resolution ────────────────────────────────────────────────────

/**
 * Check whether a queue entry's dependency has been satisfied.
 *
 * Returns true when the entry is BLOCKED (its prerequisite is still present in
 * the queue). Returns false when the entry is free to replay.
 *
 * @param entry  The entry to check.
 * @param queue  The full current queue (used to look up whether dependsOn is
 *               still present).
 */
export function isEntryBlocked(entry: QueueEntry, queue: QueueEntry[]): boolean {
  if (!entry.dependsOn) return false;
  return queue.some((e) => e.id === entry.dependsOn);
}

/**
 * Return the targeted retry plus every transitive dependent that can become
 * eligible after it succeeds. This lets one explicit retry drain newly
 * unblocked work in the same ordered flush.
 */
export function getTargetedRetryClosure(
  entries: QueueEntry[],
  targetId: string,
): Set<string> {
  const selected = new Set<string>([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (
        entry.dependsOn &&
        selected.has(entry.dependsOn) &&
        !selected.has(entry.id)
      ) {
        selected.add(entry.id);
        changed = true;
      }
    }
  }
  return selected;
}

/**
 * Split one dependency-processing pass into entries that can run now and
 * entries that still wait on an unresolved prerequisite. Repeating this after
 * each successful pass gives deterministic topological replay without relying
 * on persisted array order.
 */
export function partitionDependencyReady(
  entries: QueueEntry[],
  unresolvedIds: ReadonlySet<string>,
): { ready: QueueEntry[]; blocked: QueueEntry[] } {
  const ready: QueueEntry[] = [];
  const blocked: QueueEntry[] = [];
  for (const entry of entries) {
    if (entry.dependsOn && unresolvedIds.has(entry.dependsOn)) {
      blocked.push(entry);
    } else {
      ready.push(entry);
    }
  }
  return { ready, blocked };
}

/**
 * Remove one entry while retaining its dependents as explicit permanent
 * failures. Keeping those writes visible avoids silently losing user intent,
 * while clearing dependsOn prevents the UI from calling them "Blocked" after
 * their prerequisite no longer exists.
 */
export function discardEntryWithDependencyFailures(
  entries: QueueEntry[],
  discardedId: string,
): QueueEntry[] {
  const invalid = new Set<string>([discardedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (
        entry.dependsOn &&
        invalid.has(entry.dependsOn) &&
        !invalid.has(entry.id)
      ) {
        invalid.add(entry.id);
        changed = true;
      }
    }
  }

  return entries
    .filter((entry) => entry.id !== discardedId)
    .map((entry) =>
      invalid.has(entry.id)
        ? {
            ...entry,
            dependsOn: undefined,
            failedReason:
              "A required earlier offline change was discarded. Recreate this action, or discard this pending item.",
            lastStatus: undefined,
            conflictToken: undefined,
          }
        : entry,
    );
}

// ─── Serialized AsyncStorage mutation helper ──────────────────────────────────

/**
 * An async lock primitive that serializes an ordered queue of thunks so that
 * concurrent read-modify-write operations against AsyncStorage never interleave.
 *
 * Usage:
 *   const lock = createAsyncLock();
 *   await lock.run(async () => { ... });
 *
 * Each call to lock.run() waits for all previously enqueued operations to
 * complete before starting. This prevents the lost-write race that occurs when
 * two callers each read the queue, compute a new version, and then both write,
 * with the second write overwriting changes made by the first.
 */
export function createAsyncLock() {
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      // Chain fn onto the tail so it runs only after all prior ops finish.
      const next = tail.then(fn);
      // Update tail to a version that swallows errors (so a failed op doesn't
      // permanently block the lock — subsequent ops still run).
      tail = next.then(
        () => {},
        () => {},
      );
      return next;
    },
  };
}

export type AsyncLock = ReturnType<typeof createAsyncLock>;

// ─── Flush single-flight guard ────────────────────────────────────────────────

/**
 * A single-flight guard that prevents concurrent flush executions. If a flush
 * is already in progress when a new one is requested, the new request waits for
 * the running one to settle before starting (rather than running in parallel and
 * reading stale queue state from AsyncStorage).
 *
 * Unlike `createAsyncLock` which serialises all callers, this coalesces:
 * only one "pending" flush is queued at a time — further concurrent requests
 * attach to the same pending promise rather than stacking up.
 */
export function createFlushGuard() {
  let running: Promise<void> | null = null;
  let pending: Promise<void> | null = null;
  let pendingResolve: (() => void) | null = null;
  let pendingFn: (() => Promise<void>) | null = null;

  async function execute(fn: () => Promise<void>): Promise<void> {
    if (!running) {
      running = fn().finally(() => {
        running = null;
        if (pendingFn) {
          const nextFn = pendingFn;
          pendingFn = null;
          const resolve = pendingResolve!;
          pendingResolve = null;
          pending = null;
          running = nextFn().finally(() => {
            running = null;
            resolve();
          });
        }
      });
      return running;
    }

    // A flush is already running. Queue at most one more.
    if (!pending) {
      pending = new Promise<void>((res) => {
        pendingResolve = res;
      });
    }
    pendingFn = fn;
    return pending;
  }

  return { execute };
}

export type FlushGuard = ReturnType<typeof createFlushGuard>;
