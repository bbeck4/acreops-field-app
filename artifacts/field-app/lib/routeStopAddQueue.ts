// Pure queue + overlay logic for offline add-route-stop writes, extracted
// from OfflineContext / routes.tsx so it can be unit-tested without
// react-native bindings. Mirrors the pattern in lib/routeStopEditQueue.ts.
//
// Two behaviors live here:
//   1. enqueueRouteStopAdd — 2s duplicate-tap suppression when queueing an
//      add offline (same route + same customer/prospect/custom-name target
//      within DUPLICATE_TAP_WINDOW_MS is dropped).
//   2. applyPendingAddStops — overlays queued adds onto the routes list as
//      synthetic negative-id stops, skipping any add the server refetch has
//      already returned (dedupe by customerId / prospectId / custom name)
//      so an offline-added stop never shows up twice — and never vanishes
//      while its write is still pending.

import type { QueuedWriteLike } from "./routeStopEditQueue";

export type { QueuedWriteLike };

export interface AddRouteStopPayload {
  routeId: number;
  customerId?: number | null;
  prospectId?: number | null;
  customerName?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  prospectName?: string | null;
  /** Custom (non-customer) location stop, e.g. a meeting spot. */
  customName?: string | null;
  customAddress?: string | null;
  customLat?: number | null;
  customLng?: number | null;
}

/** Window within which a repeat tap for the same target is suppressed. */
export const DUPLICATE_TAP_WINDOW_MS = 2_000;

// Minimal structural type of the generated CustomerRouteStop that the
// overlay needs. Fields are optional to stay assignable from the generated
// client type (which marks most columns optional); the real type satisfies
// this, so callers pass it directly.
export interface RouteStopLike {
  id: number;
  routeId?: number;
  kind?: string | null;
  customerId?: number | null;
  prospectId?: number | null;
  prospectName?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  lat?: number | null;
  lng?: number | null;
  stopOrder?: number;
  checkedInAt?: string | null;
  distanceKmFromPrev?: number | null;
  estimatedMinutesFromPrev?: number | null;
  geometryFromPrev?: unknown;
}

export interface RouteLike<S extends RouteStopLike = RouteStopLike> {
  id: number;
  stops?: S[] | null;
}

/**
 * Queue an add-stop write with duplicate-tap suppression: an identical
 * target (same route + same customerId/prospectId/customName) queued within
 * DUPLICATE_TAP_WINDOW_MS is dropped, so a double-tap never replays twice.
 * Distinct targets — or the same target after the window — always append.
 *
 * Returns the same array reference when the add was suppressed, so callers
 * can cheaply detect "nothing changed".
 */
export function enqueueRouteStopAdd<T extends QueuedWriteLike>(
  queue: T[],
  payload: AddRouteStopPayload,
  now: number = Date.now(),
): T[] {
  const isDuplicate = queue.some((w) => {
    if (w.type !== "addRouteStop") return false;
    const p = w.payload as AddRouteStopPayload;
    return (
      p.routeId === payload.routeId &&
      p.customerId === payload.customerId &&
      p.prospectId === payload.prospectId &&
      (p.customName ?? null) === (payload.customName ?? null) &&
      now - w.createdAt < DUPLICATE_TAP_WINDOW_MS
    );
  });
  if (isDuplicate) return queue;
  return [
    ...queue,
    {
      id: now.toString() + Math.random().toString(36).substr(2, 9),
      type: "addRouteStop",
      payload,
      createdAt: now,
    } as T,
  ];
}

/**
 * Overlay queued add-stop writes onto the routes list as synthetic stops so
 * the rep sees them immediately after tapping "add" — even when the queue
 * hasn't drained yet (offline, retrying, etc). Synthetic stops use unique
 * negative ids so they never collide with real server-issued ids and so
 * React keys remain stable per-write while the queue lives.
 *
 * If a queued add has already landed (the server returned the stop in a
 * refetch) it is skipped so the optimistic copy doesn't appear as a
 * duplicate alongside the real one. Customer/prospect stops dedupe on their
 * server-side id; custom stops have no server identity before the refetch
 * lands, so they match on name (same route, same custom name).
 */
export function applyPendingAddStops<S extends RouteStopLike, R extends RouteLike<S>>(
  routes: R[],
  pendingWrites: QueuedWriteLike[],
): R[] {
  const adds: Array<{ payload: AddRouteStopPayload; syntheticId: number }> = [];
  let counter = -1;
  for (const w of pendingWrites) {
    if (w.type !== "addRouteStop") continue;
    adds.push({
      payload: w.payload as AddRouteStopPayload,
      syntheticId: counter,
    });
    counter -= 1;
  }
  if (adds.length === 0) return routes;
  const byRoute = new Map<number, typeof adds>();
  for (const a of adds) {
    const arr = byRoute.get(a.payload.routeId) ?? [];
    arr.push(a);
    byRoute.set(a.payload.routeId, arr);
  }
  return routes.map((r) => {
    const pending = byRoute.get(r.id);
    if (!pending || pending.length === 0) return r;
    const existing = r.stops ?? [];
    const existingCustomerIds = new Set(existing.map((s) => s.customerId));
    const existingProspectIds = new Set(existing.map((s) => s.prospectId));
    const existingCustomNames = new Set(
      existing.filter((s) => s.kind === "custom").map((s) => s.customerName ?? ""),
    );
    const overlay: S[] = pending
      .filter((p) =>
        p.payload.prospectId != null
          ? !existingProspectIds.has(p.payload.prospectId)
          : p.payload.customerId != null
            ? !existingCustomerIds.has(p.payload.customerId)
            : p.payload.customName
              ? !existingCustomNames.has(p.payload.customName)
              : false,
      )
      .map((p, i) => {
        const isProspect = p.payload.prospectId != null;
        const isCustom = !isProspect && p.payload.customerId == null;
        return {
          id: p.syntheticId,
          routeId: r.id,
          kind: isProspect ? "prospect" : isCustom ? "custom" : "customer",
          customerId: isProspect || isCustom ? null : p.payload.customerId ?? null,
          prospectId: isProspect ? p.payload.prospectId ?? null : null,
          prospectName: isProspect ? p.payload.prospectName ?? null : null,
          customerName: isCustom
            ? p.payload.customName ?? null
            : isProspect
              ? null
              : p.payload.customerName ?? null,
          customerAddress: isCustom
            ? p.payload.customAddress ?? null
            : isProspect
              ? null
              : p.payload.customerAddress ?? null,
          customerCity: isProspect || isCustom ? null : p.payload.customerCity ?? null,
          customerState: isProspect || isCustom ? null : p.payload.customerState ?? null,
          lat: isCustom ? p.payload.customLat ?? null : null,
          lng: isCustom ? p.payload.customLng ?? null : null,
          stopOrder: existing.length + i + 1,
          checkedInAt: null,
          distanceKmFromPrev: null,
          estimatedMinutesFromPrev: null,
          geometryFromPrev: null,
        } as S;
      });
    if (overlay.length === 0) return r;
    return { ...r, stops: [...existing, ...overlay] };
  });
}
