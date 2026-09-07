import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import MapView, { Marker, Region, PROVIDER_DEFAULT } from "@/components/MapShim";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  getListRoutesQueryKey,
  useCreateRoute,
  useListCustomerMapPins,
  useListProspects,
  useOptimizeRouteOrder,
  NearbyStop,
} from "@workspace/api-client-react";
import {
  NEARBY_RADIUS_KM,
  NearbyTray,
  haversineKm,
  nearbyStopKey,
  useNearbyStopsData,
  useNearbyWatch,
} from "@/components/NearbyTray";
import { useAppAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { formatDistance, useDistanceUnit } from "@/lib/units";

const QUEUE_SLOT_HEIGHT = 64;
const DRAG_THRESHOLD = QUEUE_SLOT_HEIGHT * 0.55;

type Coords = { lat: number; lng: number };

// Compact draggable queue row (long-press to lift, drag to swap order).
function QueueDragRow({
  rowKey,
  totalCount,
  draggingKey,
  onDragStart,
  onSwap,
  onDragEnd,
  children,
}: {
  rowKey: string;
  totalCount: number;
  draggingKey: string | null;
  onDragStart: (key: string) => void;
  onSwap: (key: string, dir: -1 | 1) => boolean;
  onDragEnd: (key: string) => void;
  children: React.ReactNode;
}) {
  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const consumed = useSharedValue(0);

  const pan = Gesture.Pan()
    .activateAfterLongPress(250)
    .enabled(totalCount > 1)
    .onStart(() => {
      lifted.value = withTiming(1, { duration: 150 });
      runOnJS(onDragStart)(rowKey);
    })
    .onUpdate((e) => {
      const adjusted = e.translationY - consumed.value;
      translateY.value = adjusted;
      if (adjusted > DRAG_THRESHOLD) {
        consumed.value += QUEUE_SLOT_HEIGHT;
        translateY.value = e.translationY - consumed.value;
        runOnJS(onSwap)(rowKey, 1);
      } else if (adjusted < -DRAG_THRESHOLD) {
        consumed.value -= QUEUE_SLOT_HEIGHT;
        translateY.value = e.translationY - consumed.value;
        runOnJS(onSwap)(rowKey, -1);
      }
    })
    .onEnd(() => {
      translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
      consumed.value = 0;
      lifted.value = withTiming(0, { duration: 200 });
      runOnJS(onDragEnd)(rowKey);
    })
    .onFinalize(() => {
      translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
      consumed.value = 0;
      lifted.value = withTiming(0, { duration: 200 });
    });

  const isMe = draggingKey === rowKey;
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: 1 + lifted.value * 0.03 }],
    shadowOpacity: lifted.value * 0.25,
    shadowRadius: 6 + lifted.value * 8,
    shadowOffset: { width: 0, height: 3 + lifted.value * 4 },
    elevation: lifted.value * 8,
    zIndex: isMe ? 100 : 1,
  }));

  if (totalCount < 2) {
    return <Animated.View>{children}</Animated.View>;
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}

export default function PlanRouteScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const requestedDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const routeDate =
    typeof requestedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : localToday;
  const routeDateLabel = new Date(`${routeDate}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const queryClient = useQueryClient();
  const distanceUnit = useDistanceUnit();

  // Ordered list of queued stops.
  const [queue, setQueue] = useState<NearbyStop[]>([]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [detailStop, setDetailStop] = useState<NearbyStop | null>(null);

  const createRoute = useCreateRoute();
  const optimize = useOptimizeRouteOrder();

  const { origin, error: locError, locating } = useNearbyWatch(true);
  const { data: nearby, isLoading: nearbyLoading } = useNearbyStopsData(origin);

  // Full customer + prospect pins for the planning map (not limited to the
  // nearby radius). Customers are scoped to the rep; the Nearby tray remains a
  // separate, distance-limited convenience driven off the /routes/nearby feed.
  const { currentMember } = useAppAuth();
  const customerParams = currentMember?.id ? { repId: currentMember.id } : undefined;
  const { data: customerPins } = useListCustomerMapPins(customerParams);
  const { data: prospectRows } = useListProspects();

  const mapStops = useMemo<NearbyStop[]>(() => {
    const out: NearbyStop[] = [];
    for (const c of customerPins ?? []) {
      if (c.lat == null || c.lng == null) continue;
      out.push({
        kind: "customer",
        id: c.id,
        name: c.name,
        address: null,
        city: c.city ?? null,
        state: c.state ?? null,
        lat: c.lat,
        lng: c.lng,
        distanceKm: origin ? haversineKm(origin, { lat: c.lat, lng: c.lng }) : 0,
      });
    }
    for (const p of prospectRows ?? []) {
      if (p.lat == null || p.lng == null) continue;
      out.push({
        kind: "prospect",
        id: p.id,
        name: p.businessName,
        address: p.address ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
        lat: p.lat,
        lng: p.lng,
        distanceKm: origin ? haversineKm(origin, { lat: p.lat, lng: p.lng }) : 0,
      });
    }
    return out;
  }, [customerPins, prospectRows, origin]);

  const queuedKeys = useMemo(() => new Set(queue.map((s) => nearbyStopKey(s))), [queue]);

  const addStop = (stop: NearbyStop) => {
    const key = nearbyStopKey(stop);
    setQueue((prev) => (prev.some((s) => nearbyStopKey(s) === key) ? prev : [...prev, stop]));
  };

  const removeStopByKey = (key: string) => {
    setQueue((prev) => prev.filter((s) => nearbyStopKey(s) !== key));
  };

  const handleDragStart = (key: string) => setDraggingKey(key);
  const handleDragEnd = () => setDraggingKey(null);
  const handleSwap = (key: string, dir: -1 | 1): boolean => {
    let swapped = false;
    setQueue((prev) => {
      const idx = prev.findIndex((s) => nearbyStopKey(s) === key);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      swapped = true;
      return next;
    });
    return swapped;
  };

  const onOptimize = () => {
    const withCoords = queue.filter((s) => s.lat != null && s.lng != null);
    if (withCoords.length < 3) {
      Alert.alert("Add more stops", "Queue at least 3 stops with locations to optimize.");
      return;
    }
    optimize.mutate(
      {
        data: {
          coordinates: withCoords.map((s) => ({ lat: s.lat as number, lng: s.lng as number })),
        },
      },
      {
        onSuccess: (res) => {
          const order = res.order ?? [];
          if (order.length !== withCoords.length) return;
          const reordered = order.map((i) => withCoords[i]).filter(Boolean) as NearbyStop[];
          if (reordered.length !== withCoords.length) return;
          // Re-sequence the stops that have coordinates; keep any coord-less
          // stops at the tail in their existing relative order.
          const withoutCoords = queue.filter((s) => s.lat == null || s.lng == null);
          setQueue([...reordered, ...withoutCoords]);
        },
        onError: () => Alert.alert("Optimize failed", "Could not optimize the route. Try again."),
      },
    );
  };

  const onStart = () => {
    if (queue.length === 0) {
      Alert.alert("No stops", "Add at least one stop, or use Start unplanned from the Routes screen.");
      return;
    }
    createRoute.mutate(
      {
        data: {
          name: `My day · ${new Date(`${routeDate}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}`,
          routeDate,
          selfPlanned: true,
          stops: queue.map((s) =>
            s.kind === "prospect" ? { prospectId: s.id } : { customerId: s.id },
          ),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
          router.replace({
            pathname: "/(tabs)/routes",
            params: { date: routeDate },
          } as never);
        },
        onError: () => Alert.alert("Could not start route", "Please try again."),
      },
    );
  };

  const region: Region | undefined = useMemo(() => {
    const pts: Coords[] = [];
    if (origin) pts.push(origin);
    for (const s of mapStops) {
      if (s.lat != null && s.lng != null) pts.push({ lat: s.lat, lng: s.lng });
    }
    if (pts.length === 0) return undefined;
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.08),
      longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.08),
    };
  }, [origin, mapStops]);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const busy = createRoute.isPending || optimize.isPending;
  const detailQueued = detailStop ? queuedKeys.has(nearbyStopKey(detailStop)) : false;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Plan my day</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {routeDateLabel} · Tap a pin to add stops
          </Text>
        </View>
      </View>

      {locating ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>Finding your location…</Text>
        </View>
      ) : locError ? (
        <View style={styles.center}>
          <Feather name="map-pin" size={36} color={colors.mutedForeground} />
          <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center", paddingHorizontal: 32 }]}>
            {locError}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.mapWrap}>
            <MapView
              style={StyleSheet.absoluteFill}
              provider={PROVIDER_DEFAULT}
              initialRegion={region}
              region={region}
              showsUserLocation
            >
              {mapStops
                .filter((s) => s.lat != null && s.lng != null)
                .map((s) => {
                  const key = nearbyStopKey(s);
                  const queued = queuedKeys.has(key);
                  return (
                    <Marker
                      key={key}
                      coordinate={{ latitude: s.lat!, longitude: s.lng! }}
                      title={s.name}
                      description={s.kind === "prospect" ? "Prospect" : "Customer"}
                      pinColor={queued ? "#2563eb" : s.kind === "prospect" ? "#d97706" : "#16a34a"}
                      onPress={() => setDetailStop(s)}
                    />
                  );
                })}
            </MapView>
          </View>

          <View style={[styles.queueBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="list" size={14} color={colors.primary} />
            <Text style={[styles.queueBarText, { color: colors.foreground }]}>
              {queue.length} stop{queue.length !== 1 ? "s" : ""} queued
            </Text>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={onOptimize}
              disabled={queue.length < 3 || busy}
              style={[
                styles.smallBtn,
                { backgroundColor: colors.muted, opacity: queue.length < 3 || busy ? 0.5 : 1 },
              ]}
            >
              {optimize.isPending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="zap" size={13} color={colors.primary} />
              )}
              <Text style={[styles.smallBtnText, { color: colors.primary }]}>Optimize order</Text>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}
          >
            {queue.length === 0 ? (
              <View style={styles.queueEmpty}>
                <Feather name="map-pin" size={26} color={colors.mutedForeground} />
                <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
                  No stops yet. Tap pins on the map or a Nearby chip to build your route.
                </Text>
              </View>
            ) : (
              queue.map((s, idx) => {
                const key = nearbyStopKey(s);
                const locParts = [s.city, s.state].filter(Boolean).join(", ");
                return (
                  <QueueDragRow
                    key={key}
                    rowKey={key}
                    totalCount={queue.length}
                    draggingKey={draggingKey}
                    onDragStart={handleDragStart}
                    onSwap={handleSwap}
                    onDragEnd={handleDragEnd}
                  >
                    <View
                      style={[
                        styles.queueRow,
                        {
                          backgroundColor: colors.card,
                          borderColor: draggingKey === key ? colors.primary : colors.border,
                          borderWidth: draggingKey === key ? 1.5 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.orderBadge, { backgroundColor: colors.primary }]}>
                        <Text style={styles.orderBadgeText}>{idx + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.queueName, { color: colors.foreground }]} numberOfLines={1}>
                          {s.name}
                        </Text>
                        <Text style={[styles.queueMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {s.kind === "prospect" ? "Prospect" : "Customer"}
                          {locParts ? ` · ${locParts}` : ""} · {formatDistance(s.distanceKm, distanceUnit)}
                        </Text>
                      </View>
                      <Feather name="menu" size={16} color={colors.mutedForeground} />
                      <Pressable onPress={() => removeStopByKey(key)} hitSlop={6} style={styles.removeBtn}>
                        <Feather name="x" size={18} color="#dc2626" />
                      </Pressable>
                    </View>
                  </QueueDragRow>
                );
              })
            )}
            {queue.length > 1 && (
              <Text style={[styles.dragHint, { color: colors.mutedForeground }]}>
                Long-press a stop to drag and reorder
              </Text>
            )}
          </ScrollView>

          <View style={{ paddingHorizontal: 16 }}>
            <NearbyTray
              stops={nearby ?? []}
              isLoading={nearbyLoading}
              locating={locating}
              error={locError}
              queuedKeys={queuedKeys}
              onAdd={addStop}
              radiusKm={NEARBY_RADIUS_KM}
            />
          </View>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <Pressable
              onPress={onStart}
              disabled={queue.length === 0 || busy}
              style={[styles.startBtn, { backgroundColor: colors.primary, opacity: queue.length === 0 || busy ? 0.5 : 1 }]}
            >
              {createRoute.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="navigation" size={16} color="#fff" />
              )}
              <Text style={styles.startBtnText}>Start route</Text>
            </Pressable>
          </View>
        </>
      )}

      <Modal
        visible={detailStop != null}
        animationType="slide"
        transparent
        onRequestClose={() => setDetailStop(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setDetailStop(null)}>
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {detailStop && (
              <>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetTitleRow}>
                  <View
                    style={[
                      styles.kindDot,
                      { backgroundColor: detailStop.kind === "prospect" ? "#d97706" : "#16a34a" },
                    ]}
                  />
                  <Text style={[styles.sheetTitle, { color: colors.foreground }]} numberOfLines={2}>
                    {detailStop.name}
                  </Text>
                </View>
                <Text style={[styles.sheetMeta, { color: colors.mutedForeground }]}>
                  {detailStop.kind === "prospect" ? "Prospect" : "Customer"} ·{" "}
                  {formatDistance(detailStop.distanceKm, distanceUnit)} away
                </Text>
                {(detailStop.address || detailStop.city || detailStop.state) && (
                  <Text style={[styles.sheetAddr, { color: colors.foreground }]}>
                    {[detailStop.address, [detailStop.city, detailStop.state].filter(Boolean).join(", ")]
                      .filter(Boolean)
                      .join("\n")}
                  </Text>
                )}
                <Pressable
                  onPress={() => {
                    if (detailQueued) {
                      removeStopByKey(nearbyStopKey(detailStop));
                    } else {
                      addStop(detailStop);
                    }
                    setDetailStop(null);
                  }}
                  style={[
                    styles.sheetBtn,
                    {
                      backgroundColor: detailQueued ? colors.muted : colors.primary,
                      borderColor: detailQueued ? colors.border : colors.primary,
                    },
                  ]}
                >
                  <Feather
                    name={detailQueued ? "x-circle" : "plus-circle"}
                    size={16}
                    color={detailQueued ? colors.foreground : "#fff"}
                  />
                  <Text
                    style={[styles.sheetBtnText, { color: detailQueued ? colors.foreground : "#fff" }]}
                  >
                    {detailQueued ? "Remove from route" : "Add stop"}
                  </Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  muted: { fontSize: 13, fontFamily: "Inter_400Regular" },
  mapWrap: { height: 220, width: "100%" },
  queueBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  queueBarText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  smallBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  queueEmpty: { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 36 },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    height: QUEUE_SLOT_HEIGHT - 8,
    borderRadius: 12,
    marginBottom: 8,
  },
  orderBadge: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  orderBadgeText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  queueName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  queueMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  removeBtn: { padding: 4 },
  dragHint: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 2, marginBottom: 4 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  startBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 8,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#9ca3af",
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kindDot: { width: 10, height: 10, borderRadius: 5 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", flex: 1 },
  sheetMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  sheetAddr: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: 2 },
  sheetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  sheetBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
