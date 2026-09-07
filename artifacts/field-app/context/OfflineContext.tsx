import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { PermanentSyncError } from "@/lib/offlineSyncError";
import {
  createAsyncLock,
  discardEntryWithDependencyFailures,
  getTargetedRetryClosure,
  parseQueueStorage,
  partitionDependencyReady,
  serializeQueue,
  type AsyncLock,
  type QueueEntry,
} from "@/lib/queueEnvelope";
import { enqueueRouteStopAdd, type AddRouteStopPayload } from "@/lib/routeStopAddQueue";
import { enqueueRouteStopEdit, type UpdateRouteStopPayload } from "@/lib/routeStopEditQueue";

export interface PendingWrite {
  id: string;
  type:
    | "activity"
    | "workOrder"
    | "servicePackageOrder"
    | "reassignRouteStops"
    | "addRouteStop"
    | "updateRouteStop"
    | "checkInRouteStop"
    | "deleteRouteStop"
    | "completeDeliveryStop"
    | "deliveryIncident"
    | "serviceJobComplete"
    | "serviceJobEnRoute"
    | "serviceJobOnSite"
    | "serviceJobUpdate"
    | "serviceJobPartsUpdate"
    | "serviceLaborStart"
    | "serviceLaborStop"
    | "sampleTransition"
    | "samplingPlan"
    | "samplingAddPoint"
    | "samplingGrid"
    // Stop paired with a still-pending serviceLaborStart, identified by the
    // start's queue id rather than a server entry id (which doesn't exist
    // yet at the time the user taps stop offline). The flush handler
    // resolves the server entry id via a persisted map written when the
    // paired start succeeds.
    | "serviceLaborStopForQueuedStart";
  payload: unknown;
  createdAt: number;
  /**
   * Set when the most recent replay attempt resulted in a PERMANENT server
   * rejection (4xx). Never set for transient connectivity errors — those items
   * show as "Waiting" in the tray and are auto-retried. Cleared when the rep
   * taps "Retry" on the item.
   */
  failedReason?: string;
  /**
   * How many replay attempts have been made. Preserved through mutations so
   * the tray can show history and callers can make backoff decisions.
   */
  attempts?: number;
  /**
   * Id of another queue entry that must succeed before this one can replay.
   * Used by serviceLaborStopForQueuedStart to express its dependency on the
   * paired serviceLaborStart. The flush loop respects this: a blocked entry
   * is skipped rather than replayed out of order.
   */
  dependsOn?: string;
  /**
   * Opaque conflict token retained for reconciling a 409. The queue preserves
   * it while the rep reviews, retries, or discards the failed write.
   */
  conflictToken?: string;
  /** Wall-clock time of the latest replay attempt. */
  lastAttemptAt?: number;
  /** HTTP status from the latest classified failure, when available. */
  lastStatus?: number;
}

// Re-exported from a pure module so replay handlers (and their tests) can depend
// on it without importing this react-native-bound context. See the class doc in
// lib/offlineSyncError.ts for the transient-vs-permanent contract.
export { PermanentSyncError };

export interface ReassignRouteStopsGroup {
  routeId: number;
  stopIds: number[];
}

export interface ReassignRouteStopsPayload {
  groups: ReassignRouteStopsGroup[];
  flat?: Array<{ routeId: number; stopId: number }>;
}

// Add-stop payload shape lives beside the pure queue/overlay logic in
// lib/routeStopAddQueue.ts (unit-tested there).
export type { AddRouteStopPayload } from "@/lib/routeStopAddQueue";

// Edit-a-custom-stop payload (rename / fix address). Only fields the rep
// actually changed are present; absent fields keep their server value on
// replay. lat/lng ride along only when the address came from a location
// lookup — otherwise the server re-geocodes the freeform address text.
// Shape lives beside the pure queue logic in lib/routeStopEditQueue.ts.
export type { UpdateRouteStopPayload } from "@/lib/routeStopEditQueue";

export interface CheckInRouteStopPayload {
  routeId: number;
  stopId: number;
  /** Captured for display in the pending-sync tray. */
  customerName?: string | null;
  /** Captured for display in the pending-sync tray. */
  routeName?: string | null;
}

export interface DeleteRouteStopPayload {
  routeId: number;
  stopId: number;
  /** Captured for display in the pending-sync tray. */
  stopName?: string | null;
  /** Captured for display in the pending-sync tray. */
  routeName?: string | null;
}

// Sampling-plan create payload. Mirrors the server's SamplingPlanInput shape so
// the replay handler can post it verbatim. Carried through the generic
// queueWrite("samplingPlan", …) path (like workOrder), not a dedicated queue fn.
export interface SamplingPlanPayload {
  fieldId: number;
  name: string;
  sampleTypes: string[];
  customerId?: number;
  season?: string;
}

// Add-a-single-sample-point payload. Queued when a rep drops a point in the
// field with no signal. The replay handler creates the sample via the same
// endpoint the online path uses, then assigns a bag ID (claiming a scanned
// pre-printed label first when one was carried over from the new-plan flow).
export interface SamplingAddPointPayload {
  planId: number;
  sampleType: string;
  latitude: number;
  longitude: number;
  sortOrder: number;
  /**
   * A scanned pre-printed label to claim onto this point. Only the first
   * offline point of a plan carries one; later points get a generated bag ID.
   */
  pendingCode?: string | null;
}

// Generate-grid payload. Queued when a rep generates a sampling grid offline.
// The replay handler calls the server grid endpoint, which computes the grid
// inside the field boundary and creates the sample points.
export interface SamplingGridPayload {
  planId: number;
  cellAcres: number;
  sampleType: string;
  replaceExisting: boolean;
}

interface OfflineContextValue {
  isOnline: boolean;
  pendingCount: number;
  pendingWrites: PendingWrite[];
  /** Queue ids actively being replayed right now (ephemeral; never persisted). */
  syncingWriteIds: string[];
  /**
   * Non-null when the queue contains quarantined / corrupt / unsupported-version
   * entries that cannot be replayed. The tray surfaces this as a warning banner
   * so the rep knows there are actionable failures.
   */
  queueWarning: string | null;
  queueWrite: (type: PendingWrite["type"], payload: unknown, opts?: { dependsOn?: string }) => Promise<string>;
  queueReassignRouteStops: (payload: ReassignRouteStopsPayload) => Promise<void>;
  queueAddRouteStop: (payload: AddRouteStopPayload) => Promise<void>;
  /**
   * Queue a custom-stop edit; merges into any queued edit for the same stop
   * (latest change per field wins) so only one edit per stop ever replays.
   */
  queueUpdateRouteStop: (payload: UpdateRouteStopPayload) => Promise<void>;
  /** Queue a check-in; deduplicates by stopId so double-taps never replay twice. */
  queueCheckInRouteStop: (payload: CheckInRouteStopPayload) => Promise<void>;
  /**
   * Queue a stop delete; dedupes by stopId and drops any queued edit/check-in
   * for the same stop (deleting supersedes them — replaying an edit or
   * check-in against a deleted stop would only fail).
   */
  queueDeleteRouteStop: (payload: DeleteRouteStopPayload) => Promise<void>;
  /**
   * Flush the queue, calling handler for each write.
   *
   * opts.only — when set, only the write with that id is processed; all other
   * writes pass through unchanged (supporting true per-item retry).
   *
   * Dependency handling: an entry with a `dependsOn` field is skipped (kept
   * as "Waiting") when its prerequisite entry is still present in the queue,
   * even in targeted-retry mode — this prevents serviceLaborStopForQueuedStart
   * from replaying before its paired serviceLaborStart has succeeded.
   *
   * Permanent failures (PermanentSyncError) are kept with failedReason set.
   * Transient failures (all other errors) are kept with failedReason cleared
   * so they show as "Waiting" and are auto-retried next time.
   */
  flushQueue: (
    handler: (write: PendingWrite) => Promise<void>,
    opts?: { only?: string },
  ) => Promise<void>;
  triggerFlush: () => void;
  flushSignal: number;
  /** Clears the failedReason on a single item and schedules a targeted retry. */
  retryItem: (id: string) => Promise<void>;
  /** Removes a single item from the queue permanently. */
  discardItem: (id: string) => Promise<void>;
  /**
   * Returns the id of the item currently awaiting a targeted single-item
   * retry, or null if this is a full-queue flush. Read once at the start of
   * each flush, then clear via clearPendingRetryId.
   */
  getPendingRetryId: () => string | null;
  clearPendingRetryId: () => void;
  /** Whether the pending-sync tray is open. */
  trayOpen: boolean;
  openTray: () => void;
  closeTray: () => void;
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  pendingCount: 0,
  pendingWrites: [],
  syncingWriteIds: [],
  queueWarning: null,
  queueWrite: async () => "",
  queueReassignRouteStops: async () => {},
  queueAddRouteStop: async () => {},
  queueUpdateRouteStop: async () => {},
  queueCheckInRouteStop: async () => {},
  queueDeleteRouteStop: async () => {},
  flushQueue: async () => {},
  triggerFlush: () => {},
  flushSignal: 0,
  retryItem: async () => {},
  discardItem: async () => {},
  getPendingRetryId: () => null,
  clearPendingRetryId: () => {},
  trayOpen: false,
  openTray: () => {},
  closeTray: () => {},
});

const QUEUE_KEY = "@agriops:pending_writes";
const QUEUE_RECOVERY_KEY = "@agriops:pending_writes_recovery";
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 5_000;

async function pingServer(): Promise<boolean> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const res = await fetch(`https://${domain}/api/healthz`, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// Convert a QueueEntry to a PendingWrite for consumers.
// The two types are identical in shape for known fields; this cast preserves
// the type discriminator the rest of the app depends on.
function entryToWrite(entry: QueueEntry): PendingWrite {
  return entry as unknown as PendingWrite;
}

// Convert a PendingWrite back to a QueueEntry for persistence.
function writeToEntry(write: PendingWrite): QueueEntry {
  return write as unknown as QueueEntry;
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingWrites, setPendingWrites] = useState<PendingWrite[]>([]);
  const [syncingWriteIds, setSyncingWriteIds] = useState<string[]>([]);
  const [queueWarning, setQueueWarning] = useState<string | null>(null);
  const [flushSignal, setFlushSignal] = useState(0);
  const [trayOpen, setTrayOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ref (not state) so QueueSync can read it inside runFlush without
  // triggering an extra render cycle when it's set/cleared.
  const pendingRetryIdRef = useRef<string | null>(null);

  // Serialized mutation lock — all AsyncStorage read-modify-write operations
  // go through this lock so concurrent callers never interleave and lose writes.
  const lockRef = useRef<AsyncLock>(createAsyncLock());

  const triggerFlush = useCallback(() => {
    setFlushSignal((n) => n + 1);
  }, []);

  const openTray = useCallback(() => setTrayOpen(true), []);
  const closeTray = useCallback(() => setTrayOpen(false), []);

  const getPendingRetryId = useCallback(() => pendingRetryIdRef.current, []);
  const clearPendingRetryId = useCallback(() => {
    pendingRetryIdRef.current = null;
  }, []);

  const checkAndSetOnline = useCallback(async () => {
    const online = await pingServer();
    setIsOnline(online);
  }, []);

  // Internal helper: read and parse the queue from AsyncStorage.
  // Must be called inside the lock when used in a mutation context.
  async function readQueue(): Promise<{
    entries: QueueEntry[];
    warning: string | null;
    needsRewrite: boolean;
  }> {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = parseQueueStorage(raw);
    if (raw && parsed.warning) {
      // Preserve the exact bytes before any normalization or future queue
      // mutation. This turns corrupt/newer-version data into a recoverable
      // support artifact instead of silently overwriting it.
      await AsyncStorage.setItem(QUEUE_RECOVERY_KEY, raw);
      parsed.warning = `${parsed.warning} A recovery copy was retained on this device.`;
    }
    return parsed;
  }

  // Internal helper: persist entries and update state.
  // Must be called inside the lock when used in a mutation context.
  async function persistAndSetEntries(
    entries: QueueEntry[],
    warning: string | null,
  ): Promise<void> {
    await AsyncStorage.setItem(QUEUE_KEY, serializeQueue(entries));
    setPendingWrites(entries.map(entryToWrite));
    setQueueWarning(warning);
  }

  const loadQueue = useCallback(async () => {
    await lockRef.current.run(async () => {
      const { entries, warning, needsRewrite } = await readQueue();
      if (needsRewrite) {
        await persistAndSetEntries(entries, warning);
      } else {
        setPendingWrites(entries.map(entryToWrite));
        setQueueWarning(warning);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadQueue();
    checkAndSetOnline();

    intervalRef.current = setInterval(checkAndSetOnline, PING_INTERVAL_MS);

    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        checkAndSetOnline();
        loadQueue();
      }
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      appSub.remove();
    };
  }, [checkAndSetOnline, loadQueue]);

  const queueWrite = useCallback(
    async (
      type: PendingWrite["type"],
      payload: unknown,
      opts?: { dependsOn?: string },
    ): Promise<string> => {
      return lockRef.current.run(async () => {
        const { entries, warning } = await readQueue();
        const entry: QueueEntry = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          type,
          payload,
          createdAt: Date.now(),
          ...(opts?.dependsOn ? { dependsOn: opts.dependsOn } : {}),
        };
        const next = [...entries, entry];
        await persistAndSetEntries(next, warning);
        return entry.id;
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const queueReassignRouteStops = useCallback(
    async (payload: ReassignRouteStopsPayload): Promise<void> => {
      await lockRef.current.run(async () => {
        const { entries, warning } = await readQueue();
        const filtered = entries.filter((e) => e.type !== "reassignRouteStops");
        const entry: QueueEntry = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          type: "reassignRouteStops",
          payload,
          createdAt: Date.now(),
        };
        await persistAndSetEntries([...filtered, entry], warning);
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Add-stop dedupe (2s duplicate-tap suppression by route + target). Pure
  // logic lives in lib/routeStopAddQueue.ts (unit-tested there).
  const queueAddRouteStop = useCallback(async (payload: AddRouteStopPayload): Promise<void> => {
    await lockRef.current.run(async () => {
      const { entries, warning } = await readQueue();
      // enqueueRouteStopAdd works on QueuedWriteLike which is compatible with QueueEntry.
      const next = enqueueRouteStopAdd(entries, payload) as QueueEntry[];
      if (next === entries) return; // duplicate tap suppressed
      await persistAndSetEntries(next, warning);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Custom-stop edit coalescing: only one queued edit per stopId ever lives
  // in the queue. A second edit while the first is still pending merges its
  // changed fields into the existing entry (latest change per field wins),
  // so the replay makes a single PATCH reflecting the rep's final intent.
  // Pure logic lives in lib/routeStopEditQueue.ts (unit-tested there).
  const queueUpdateRouteStop = useCallback(
    async (payload: UpdateRouteStopPayload): Promise<void> => {
      await lockRef.current.run(async () => {
        const { entries, warning } = await readQueue();
        const next = enqueueRouteStopEdit(entries, payload) as QueueEntry[];
        await persistAndSetEntries(next, warning);
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Check-in deduplication: only one queued check-in per stopId ever lives in
  // the queue. Double-taps and repeated replays are both suppressed here so
  // the server never receives duplicate check-ins for the same stop.
  const queueCheckInRouteStop = useCallback(
    async (payload: CheckInRouteStopPayload): Promise<void> => {
      await lockRef.current.run(async () => {
        const { entries, warning } = await readQueue();
        const isDuplicate = entries.some((e) => {
          if (e.type !== "checkInRouteStop") return false;
          const p = e.payload as CheckInRouteStopPayload;
          return p.stopId === payload.stopId;
        });
        if (isDuplicate) return;
        const entry: QueueEntry = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          type: "checkInRouteStop",
          payload,
          createdAt: Date.now(),
        };
        await persistAndSetEntries([...entries, entry], warning);
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Delete queueing: dedupe by stopId, and remove any queued edit/check-in
  // for the same stop — the delete supersedes them, and replaying them after
  // (or before) the delete would fail against a gone stop.
  const queueDeleteRouteStop = useCallback(
    async (payload: DeleteRouteStopPayload): Promise<void> => {
      await lockRef.current.run(async () => {
        const { entries, warning } = await readQueue();
        const isDuplicate = entries.some((e) => {
          if (e.type !== "deleteRouteStop") return false;
          const p = e.payload as DeleteRouteStopPayload;
          return p.stopId === payload.stopId;
        });
        if (isDuplicate) return;
        const filtered = entries.filter((e) => {
          if (e.type !== "updateRouteStop" && e.type !== "checkInRouteStop") return true;
          const p = e.payload as { stopId?: number };
          return p?.stopId !== payload.stopId;
        });
        const entry: QueueEntry = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          type: "deleteRouteStop",
          payload,
          createdAt: Date.now(),
        };
        await persistAndSetEntries([...filtered, entry], warning);
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // flushQueue iterates the queue (or a single targeted item when opts.only
  // is set) and calls handler for each write.
  //
  // Dependency handling: an entry with `dependsOn` pointing to another entry
  // still in the queue is skipped — it cannot replay until its prerequisite
  // has been consumed. This prevents serviceLaborStopForQueuedStart from
  // running before the paired serviceLaborStart has succeeded.
  //
  // Error classification:
  //   PermanentSyncError → keep item with failedReason set (shows as "Failed"
  //     in tray; rep must retry or discard manually)
  //   Any other Error    → keep item with failedReason CLEARED (shows as
  //     "Waiting"; will be auto-retried when connectivity returns)
  const flushQueue = useCallback(
    async (
      handler: (write: PendingWrite) => Promise<void>,
      opts?: { only?: string },
    ): Promise<void> => {
      await lockRef.current.run(async () => {
        const { entries, warning } = await readQueue();
        if (entries.length === 0) return;

        const unresolvedIds = new Set(entries.map((entry) => entry.id));
        const targetedIds = opts?.only
          ? getTargetedRetryClosure(entries, opts.only)
          : null;
        const originalIndexById = new Map(
          entries.map((entry, index) => [entry.id, index]),
        );
        const retained: Array<{ index: number; entry: QueueEntry }> = [];
        const retain = (entry: QueueEntry) => {
          retained.push({
            index: originalIndexById.get(entry.id) ?? entries.length,
            entry,
          });
        };
        let candidates: QueueEntry[] = [];

        for (const entry of entries) {
          const outsideTarget = targetedIds && !targetedIds.has(entry.id);
          const automaticPermanentFailure = !opts?.only && !!entry.failedReason;
          if (outsideTarget || automaticPermanentFailure) {
            retain(entry);
          } else {
            candidates.push(entry);
          }
        }

        // Repeat dependency passes until every selected entry has either run or
        // no further prerequisite can make progress. This is a stable
        // topological replay and works even when persisted entries are reversed.
        while (candidates.length > 0) {
          const { ready, blocked } = partitionDependencyReady(
            candidates,
            unresolvedIds,
          );
          if (ready.length === 0) {
            blocked.forEach(retain);
            break;
          }

          for (const entry of ready) {
            const write = entryToWrite(entry);
            try {
              setSyncingWriteIds((current) =>
                current.includes(entry.id) ? current : [...current, entry.id],
              );
              await handler(write);
              // Success satisfies dependents in the next pass.
              unresolvedIds.delete(entry.id);
            } catch (err) {
              const newAttempts = (entry.attempts ?? 0) + 1;
              const lastAttemptAt = Date.now();
              if (err instanceof PermanentSyncError) {
                retain({
                  ...entry,
                  failedReason: err.serverMessage,
                  attempts: newAttempts,
                  lastAttemptAt,
                  lastStatus: err.status,
                  conflictToken:
                    err.status === 409
                      ? (err.conflictToken ??
                        entry.conflictToken ??
                        `conflict:${entry.id}`)
                      : entry.conflictToken,
                });
              } else {
                retain({
                  ...entry,
                  failedReason: undefined,
                  attempts: newAttempts,
                  lastAttemptAt,
                  lastStatus:
                    err && typeof err === "object" && "status" in err
                      ? Number((err as { status: unknown }).status)
                      : undefined,
                });
              }
            } finally {
              setSyncingWriteIds((current) =>
                current.filter((id) => id !== entry.id),
              );
            }
          }
          candidates = blocked;
        }

        retained.sort((a, b) => a.index - b.index);
        await persistAndSetEntries(
          retained.map(({ entry }) => entry),
          warning,
        );
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const retryItem = useCallback(async (id: string) => {
    await lockRef.current.run(async () => {
      const { entries, warning } = await readQueue();
      // Clear failedReason so the item immediately shows as "Waiting" in the
      // tray while the targeted retry is in flight.
      const updated = entries.map((e) =>
        e.id === id ? { ...e, failedReason: undefined } : e,
      );
      await persistAndSetEntries(updated, warning);
    });
    // Mark this as a targeted single-item retry; QueueSync reads the ref at
    // the start of each flush and passes { only: id } to flushQueue so only
    // this write is processed — all others are left untouched.
    pendingRetryIdRef.current = id;
    setFlushSignal((n) => n + 1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const discardItem = useCallback(async (id: string) => {
    await lockRef.current.run(async () => {
      const { entries, warning } = await readQueue();
      const updated = discardEntryWithDependencyFailures(entries, id);
      await persistAndSetEntries(updated, warning);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        pendingCount: pendingWrites.length,
        pendingWrites,
        syncingWriteIds,
        queueWarning,
        queueWrite,
        queueReassignRouteStops,
        queueAddRouteStop,
        queueUpdateRouteStop,
        queueCheckInRouteStop,
        queueDeleteRouteStop,
        flushQueue,
        triggerFlush,
        flushSignal,
        retryItem,
        discardItem,
        getPendingRetryId,
        clearPendingRetryId,
        trayOpen,
        openTray,
        closeTray,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export const useOffline = () => useContext(OfflineContext);
