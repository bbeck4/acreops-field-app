import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams, Stack } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type Region } from "@/components/MapShim";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DeliveryLoad, getGetDeliveryLoadQueryKey, useGetDeliveryLoad } from "@workspace/api-client-react";

import { OfflineBanner } from "@/components/OfflineBanner";
import { useColors } from "@/hooks/useColors";
import { formatDistance, useDistanceUnit } from "@/lib/units";

function fmtDuration(min: number | null | undefined): string | null {
  if (min == null) return null;
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  planned: { bg: "#e7e7db", fg: "#6b756c" },
  en_route: { bg: "#dbeafe", fg: "#1d4ed8" },
  delivered: { bg: "#dcfce7", fg: "#15803d" },
  refused: { bg: "#fef3c7", fg: "#92400e" },
  incident: { bg: "#fee2e2", fg: "#991b1b" },
  cancelled: { bg: "#f3f4f6", fg: "#6b7280" },
};

// Marker colors mirror the dispatcher web map (artifacts/agri-platform/src/pages/dispatcher.tsx).
const DEPOT_MARKER_COLOR = "#0f172a";
const STOP_MARKER_COLOR = "#2563eb";
const STOP_DONE_COLOR = "#6b7280";
const LEG_DONE_COLOR = "#9ca3af";

function isStopDone(status: string): boolean {
  return status === "delivered" || status === "cancelled";
}

// Shows the driver the whole route on a map: the depot/warehouse origin (when
// configured), every stop, and the road legs between them. The depot→first-stop
// leg comes from the first stop's geometryFromPrev, which the API prefixes with
// the depot when one is set — so when no depot is configured there is simply no
// depot marker and the first leg is omitted (behavior degrades cleanly).
function LoadRouteMap({ load }: { load: DeliveryLoad }) {
  const depot = load.depot ?? null;
  const stopsWithCoords = load.stops.filter((s) => s.lat != null && s.lng != null);

  const samples: { latitude: number; longitude: number }[] = stopsWithCoords.map(
    (s) => ({ latitude: s.lat!, longitude: s.lng! }),
  );
  if (depot) samples.push({ latitude: depot.lat, longitude: depot.lng });
  if (samples.length === 0) return null;

  const lats = samples.map((p) => p.latitude);
  const lngs = samples.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const region: Region = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.05),
    longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.05),
  };

  return (
    <View style={styles.mapWrap}>
      <MapView style={StyleSheet.absoluteFill} provider={PROVIDER_DEFAULT} initialRegion={region}>
        {load.stops.map((s, idx) => {
          if (!s.geometryFromPrev || s.geometryFromPrev.length < 2) return null;
          const coords = s.geometryFromPrev.map((pt) => ({
            latitude: pt[0],
            longitude: pt[1],
          }));
          const isDepotLeg = depot != null && idx === 0;
          const done = isStopDone(s.status);
          return (
            <Polyline
              key={`leg-${s.id}`}
              coordinates={coords}
              strokeColor={done ? LEG_DONE_COLOR : STOP_MARKER_COLOR}
              strokeWidth={isDepotLeg ? 3 : 4}
              lineDashPattern={isDepotLeg ? [6, 6] : undefined}
            />
          );
        })}
        {depot && (
          <Marker coordinate={{ latitude: depot.lat, longitude: depot.lng }}>
            <View style={styles.depotPin}>
              <MaterialCommunityIcons name="warehouse" size={16} color="#fff" />
            </View>
          </Marker>
        )}
        {stopsWithCoords.map((s) => {
          const done = isStopDone(s.status);
          return (
            <Marker
              key={`stop-${s.id}`}
              coordinate={{ latitude: s.lat!, longitude: s.lng! }}
              onPress={(e: { stopPropagation?: () => void }) => {
                e.stopPropagation?.();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/stop/${s.id}`);
              }}
            >
              <View style={[styles.stopPin, { backgroundColor: done ? STOP_DONE_COLOR : STOP_MARKER_COLOR }]}>
                <Text style={styles.stopPinText}>{done ? "✓" : s.stopOrder}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>
    </View>
  );
}

export default function LoadDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const loadId = Number(params.id);
  const { data: load, isLoading } = useGetDeliveryLoad(loadId, {
    query: {
      queryKey: getGetDeliveryLoadQueryKey(loadId),
      enabled: Number.isFinite(loadId),
      refetchInterval: 30_000,
    },
  });
  const distanceUnit = useDistanceUnit();
  const fmtMiles = (km: number | null | undefined) =>
    formatDistance(km, distanceUnit);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />
      <View style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.back();
          }}
          style={styles.backBtn}
          testID="load-back"
        >
          <Feather name="chevron-left" size={28} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {load?.truck ?? "Load"}
          </Text>
          {load && (
            <>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {load.stops.length} stop{load.stops.length === 1 ? "" : "s"}
                {load.plannedWindowEnd
                  ? ` · due ${new Date(load.plannedWindowEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : ""}
              </Text>
              {(load.totalDriveDistanceKm != null ||
                load.totalDriveDurationMin != null) && (
                <Text
                  style={[styles.subtitle, { color: colors.mutedForeground }]}
                  testID="load-totals"
                >
                  {[
                    fmtMiles(load.totalDriveDistanceKm),
                    fmtDuration(load.totalDriveDurationMin),
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  total drive
                </Text>
              )}
            </>
          )}
        </View>
      </View>

      {isLoading || !load ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
        <LoadRouteMap load={load} />
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 40,
            gap: 12,
          }}
        >
          {load.stops.map((s, idx) => {
            const sc = STATUS_COLORS[s.status] ?? STATUS_COLORS.planned;
            const done = s.status === "delivered" || s.status === "cancelled";
            const legParts = [
              fmtMiles(s.legDistanceKm),
              fmtDuration(s.legDurationMin),
            ].filter(Boolean);
            return (
              <Pressable
                key={s.id}
                style={({ pressed }) => [
                  styles.stopCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/stop/${s.id}`);
                }}
                testID={`stop-${s.id}`}
              >
                <View style={styles.stopHeader}>
                  <View style={[styles.orderCircle, { borderColor: colors.border }]}>
                    <Text style={[styles.orderText, { color: colors.foreground }]}>
                      {s.stopOrder}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.customerName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {s.customerName ?? "Customer"}
                    </Text>
                    <Text
                      style={[styles.address, { color: colors.mutedForeground }]}
                      numberOfLines={2}
                    >
                      {s.address ?? "No address on file"}
                    </Text>
                    {s.workOrderNumber && (
                      <Text style={[styles.orderNumber, { color: colors.mutedForeground }]}>
                        Order {s.workOrderNumber}
                      </Text>
                    )}
                    {s.eta && (
                      <Text
                        style={[styles.orderNumber, { color: colors.mutedForeground }]}
                        testID={`stop-eta-${s.id}`}
                      >
                        ETA{" "}
                        {new Date(s.eta).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                    )}
                    {idx > 0 && legParts.length > 0 && (
                      <Text
                        style={[styles.orderNumber, { color: colors.mutedForeground }]}
                        testID={`stop-leg-${s.id}`}
                      >
                        +{legParts.join(" · ")} from prev
                      </Text>
                    )}
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.statusText, { color: sc.fg }]}>{s.status}</Text>
                  </View>
                </View>
                {!done && (
                  <View
                    style={[styles.cta, { backgroundColor: colors.primary }]}
                  >
                    <Text style={styles.ctaText}>Open stop</Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapWrap: {
    height: 220,
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#e2e8f0",
  },
  depotPin: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: DEPOT_MARKER_COLOR,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  stopPin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  stopPinText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  header: {
    paddingHorizontal: 8,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backBtn: { padding: 6 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  stopCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  stopHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  orderCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  customerName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  address: { fontSize: 12, marginTop: 2, fontFamily: "Inter_400Regular" },
  orderNumber: { fontSize: 11, marginTop: 2, fontFamily: "Inter_500Medium" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "capitalize",
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  ctaText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
