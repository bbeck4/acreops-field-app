// Pure queue logic for offline custom-stop edits, extracted from
// OfflineContext so it can be unit-tested without react-native bindings.
//
// Contract: only one queued "updateRouteStop" write per stopId ever lives in
// the queue. A second edit while the first is still pending merges its changed
// fields into the existing entry (latest change per field wins), so replay
// makes a single PATCH reflecting the rep's final intent.

export interface QueuedWriteLike {
  id: string;
  type: string;
  payload: unknown;
  createdAt: number;
  failedReason?: string;
}

export interface UpdateRouteStopPayload {
  routeId: number;
  stopId: number;
  name?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Captured for display in the pending-sync tray. */
  stopName?: string | null;
}

export function enqueueRouteStopEdit<T extends QueuedWriteLike>(
  queue: T[],
  payload: UpdateRouteStopPayload,
  now: number = Date.now(),
): T[] {
  const existingIdx = queue.findIndex((w) => {
    if (w.type !== "updateRouteStop") return false;
    const p = w.payload as UpdateRouteStopPayload;
    return p.stopId === payload.stopId;
  });
  if (existingIdx >= 0) {
    const prev = queue[existingIdx].payload as UpdateRouteStopPayload;
    const merged: UpdateRouteStopPayload = { ...prev };
    if (payload.name !== undefined) merged.name = payload.name;
    if (payload.address !== undefined) {
      merged.address = payload.address;
      // lat/lng belong to the address change: overwrite (or clear) them
      // together so a stale coordinate never rides along with a new address.
      merged.lat = payload.lat;
      merged.lng = payload.lng;
    }
    if (payload.stopName !== undefined) merged.stopName = payload.stopName;
    const next = [...queue];
    next[existingIdx] = {
      ...queue[existingIdx],
      payload: merged,
      createdAt: now,
      failedReason: undefined,
    };
    return next;
  }
  return [
    ...queue,
    {
      id: now.toString() + Math.random().toString(36).substr(2, 9),
      type: "updateRouteStop",
      payload,
      createdAt: now,
    } as T,
  ];
}
