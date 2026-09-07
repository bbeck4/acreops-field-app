import { extractRings } from "@/lib/mapTiles";
import type { Sample } from "@workspace/api-client-react";

/**
 * Statuses that count as "already collected" — anything past `planned` on the
 * lifecycle, plus the legacy "submitted"/"complete" rows older samples may carry.
 * Shared so the guided map and the collect screen agree on what's still pending.
 */
export const COLLECTED_STATUSES = new Set([
  "collected",
  "shipped",
  "at_lab",
  "results_received",
  "submitted",
  "complete",
  "completed",
]);

export function isSampleCollected(status: string | null | undefined): boolean {
  return !!status && COLLECTED_STATUSES.has(status);
}

export function sampleHasCoords(
  s: Sample,
): s is Sample & { latitude: number; longitude: number } {
  return typeof s.latitude === "number" && typeof s.longitude === "number";
}

/** Great-circle distance in km between two {latitude, longitude} points. */
function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ray-casting test: is [lng, lat] inside this single ring of [lng, lat] pairs? */
function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * True when the point falls inside the GeoJSON polygon(s). Toggling across every
 * ring gives even-odd fill, so polygon holes (outer ring minus inner) read as
 * outside — adequate for sampling-zone shapes. MapShim can't draw polygons on
 * native, so this math backs the "you're inside the zone" indicator instead.
 */
export function pointInGeometry(
  point: { latitude: number; longitude: number },
  geometry: unknown,
): boolean {
  const rings = extractRings(geometry);
  if (rings.length === 0) return false;
  let inside = false;
  for (const ring of rings) {
    if (pointInRing(point.longitude, point.latitude, ring as [number, number][])) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Picks the next sample to collect: nearest uncollected point, preferring the
 * zone the rep is already working so a zone is finished before moving on. Falls
 * back to `sortOrder` when there's no live location. `excludeIds` lets callers
 * drop a just-collected point that the cached plan hasn't refreshed yet (e.g.
 * offline), so the one-tap "next point" flow never loops on the same point.
 */
export function pickNextSample(
  samples: Sample[],
  opts: {
    origin?: { latitude: number; longitude: number } | null;
    preferZoneId?: number | null;
    excludeIds?: Set<number>;
  } = {},
): Sample | null {
  const { origin, preferZoneId, excludeIds } = opts;
  const candidates = samples.filter(
    (s) => !isSampleCollected(s.status) && !excludeIds?.has(s.id),
  );
  if (candidates.length === 0) return null;

  const byDist = (a: Sample, b: Sample) => {
    if (!origin || !sampleHasCoords(a) || !sampleHasCoords(b)) {
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    }
    return (
      haversineKm(origin, { latitude: a.latitude, longitude: a.longitude }) -
      haversineKm(origin, { latitude: b.latitude, longitude: b.longitude })
    );
  };

  if (preferZoneId !== undefined && preferZoneId !== null) {
    const inZone = candidates
      .filter((s) => (s.zoneId ?? null) === preferZoneId)
      .sort(byDist);
    if (inZone.length > 0) return inZone[0];
  }
  return [...candidates].sort(byDist)[0];
}
