import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  NearbyStop,
  getListNearbyStopsQueryKey,
  useListNearbyStops,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { formatDistance, useDistanceUnit } from "@/lib/units";

export const NEARBY_RADIUS_KM = 20;
const MAX_CHIPS = 8;

export type Coords = { lat: number; lng: number };

type StopKey = string;

export function nearbyStopKey(s: Pick<NearbyStop, "kind" | "id">): StopKey {
  return `${s.kind}:${s.id}`;
}

/** Great-circle distance in km between two coordinates. */
export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Watches the rep's GPS while `enabled`. Emits a fresh origin only when they
 * move more than ~500 m (debounced natively by `distanceInterval`), satisfying
 * the "refresh as the rep moves" requirement without hammering the API.
 */
export function useNearbyWatch(enabled: boolean) {
  const [origin, setOrigin] = useState<Coords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          if (!cancelled) {
            setError("Location permission is needed to find nearby stops.");
            setLocating(false);
          }
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocating(false);
        }
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 500, timeInterval: 30000 },
          (p) => {
            if (!cancelled) setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude });
          },
        );
      } catch {
        if (!cancelled) {
          setError("Could not determine your location.");
          setLocating(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return { origin, error, locating };
}

/**
 * Nearby customers + prospects for the given origin. Coordinates are snapped to
 * a coarse (~500 m) grid so GPS jitter doesn't trigger a refetch on every fix.
 */
export function useNearbyStopsData(origin: Coords | null, radiusKm: number = NEARBY_RADIUS_KM) {
  const lat = origin ? Math.round(origin.lat * 200) / 200 : 0;
  const lng = origin ? Math.round(origin.lng * 200) / 200 : 0;
  const params = { lat, lng, radiusKm };
  return useListNearbyStops(params, {
    query: { enabled: origin != null, queryKey: getListNearbyStopsQueryKey(params) },
  });
}

/**
 * Persistent bottom tray of nearby customers & prospects, shown on both the
 * planning map and the active-route today view. Renders up to 8 horizontally
 * scrollable chips and collapses to a handle when dismissed.
 */
export function NearbyTray({
  stops,
  isLoading,
  locating,
  error,
  queuedKeys,
  onAdd,
  radiusKm = NEARBY_RADIUS_KM,
}: {
  stops: NearbyStop[];
  isLoading: boolean;
  locating: boolean;
  error?: string | null;
  queuedKeys: Set<StopKey>;
  onAdd: (stop: NearbyStop) => void;
  radiusKm?: number;
}) {
  const colors = useColors();
  const distanceUnit = useDistanceUnit();
  const [collapsed, setCollapsed] = useState(false);
  const top = useMemo(() => stops.slice(0, MAX_CHIPS), [stops]);

  if (collapsed) {
    return (
      <Pressable
        onPress={() => setCollapsed(false)}
        style={[styles.handleBar, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Feather name="navigation" size={13} color={colors.primary} />
        <Text style={[styles.handleText, { color: colors.foreground }]}>
          Nearby{top.length ? ` (${top.length})` : ""}
        </Text>
        <Feather name="chevron-up" size={16} color={colors.mutedForeground} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.tray, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.trayHeader}>
        <Feather name="navigation" size={13} color={colors.primary} />
        <Text style={[styles.trayTitle, { color: colors.foreground }]}>
          Nearby (within {radiusKm} km)
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setCollapsed(true)} hitSlop={10}>
          <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {locating || isLoading ? (
        <View style={styles.trayCenter}>
          <ActivityIndicator color={colors.primary} size="small" />
        </View>
      ) : error ? (
        <Text style={[styles.trayEmpty, { color: colors.mutedForeground }]}>{error}</Text>
      ) : top.length === 0 ? (
        <Text style={[styles.trayEmpty, { color: colors.mutedForeground }]}>
          No customers or prospects within {radiusKm} km of your location.
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 2, paddingRight: 4 }}
        >
          {top.map((s) => {
            const key = nearbyStopKey(s);
            const queued = queuedKeys.has(key);
            const isProspect = s.kind === "prospect";
            return (
              <Pressable
                key={key}
                onPress={() => onAdd(s)}
                disabled={queued}
                style={[
                  styles.chip,
                  {
                    borderColor: queued ? colors.primary : colors.border,
                    backgroundColor: queued ? colors.muted : colors.background,
                    opacity: queued ? 0.75 : 1,
                  },
                ]}
              >
                <View
                  style={[styles.chipDot, { backgroundColor: isProspect ? "#d97706" : "#16a34a" }]}
                />
                <View style={{ maxWidth: 150 }}>
                  <Text style={[styles.chipName, { color: colors.foreground }]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={[styles.chipMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {isProspect ? "Prospect" : "Customer"} · {formatDistance(s.distanceKm, distanceUnit)}
                  </Text>
                </View>
                <Feather
                  name={queued ? "check" : "plus"}
                  size={15}
                  color={queued ? colors.primary : colors.mutedForeground}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  handleBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderWidth: 1,
    borderRadius: 12,
  },
  handleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tray: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 6,
  },
  trayHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  trayTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  trayCenter: { paddingVertical: 16, alignItems: "center", justifyContent: "center" },
  trayEmpty: { fontSize: 12, paddingVertical: 12, lineHeight: 17 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chipMeta: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
});
