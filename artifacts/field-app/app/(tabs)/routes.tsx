import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated as RNAnimated,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, Polyline, Region, PROVIDER_DEFAULT } from "@/components/MapShim";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useQueryClient } from "@tanstack/react-query";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import {
  ApiError,
  getListRoutesQueryKey,
  getListWorkItemsQueryKey,
  getGetMyDayPlanQueryKey,
  getGetRoadLegQueryKey,
  getListSitesQueryKey,
  useAddRouteStop,
  useCheckInRouteStop,
  useCreateExpense,
  useCreateRoute,
  useDeleteRouteStop,
  useGetAuthMemberProfile,
  useGetMyDayPlan,
  useGetRoadLeg,
  useListCustomers,
  getListCustomersQueryKey,
  useListProspects,
  getListProspectsQueryKey,
  useSearchRouteLocations,
  getSearchRouteLocationsQueryKey,
  useUpdateRouteStop,
  useListRoutes,
  useListSites,
  useListWorkItems,
  useMarkMyDayPlan,
  useOptimizeRouteOrder,
  useReassignRouteStops,
  useReorderRouteStops,
  useSetMyDayPlan,
  CustomerRoute,
  CustomerRouteStop,
  CustomerRouteStopsReassignGroup,
  type DayPlan,
  type DayPlanMarkInputEvent,
  NearbyStop,
  type Site,
  type WorkItem,
} from "@workspace/api-client-react";
import { EmptyState } from "@/components/EmptyState";
import {
  ScheduleRow,
  fmtDrive,
  fmtWindow,
  haversineKm,
  openNav,
} from "@/components/ScheduleRow";
import {
  NEARBY_RADIUS_KM,
  NearbyTray,
  useNearbyStopsData,
  useNearbyWatch,
} from "@/components/NearbyTray";
import { QuickLogFab } from "@/components/QuickLogFab";
import { useAppAuth } from "@/context/AuthContext";
import {
  useOffline,
  type AddRouteStopPayload,
  type CheckInRouteStopPayload,
  type DeleteRouteStopPayload,
  type PendingWrite,
  type ReassignRouteStopsPayload,
  type UpdateRouteStopPayload,
} from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import { openNavigation } from "@/lib/navigation";
import { applyPendingAddStops as applyPendingAddStopsPure } from "@/lib/routeStopAddQueue";
import { usePermissions } from "@/lib/permissions";
import { formatDistance, useDistanceUnit, type DistanceUnit } from "@/lib/units";

// Optimistic flat (cross-route) stop ordering is persisted so the override
// survives app reloads while the offline-replay queue still has a pending
// reassign mutation for it.
const LOCAL_FLAT_STORAGE_KEY = "@agriops:routes_local_flat";

// Local date key (YYYY-MM-DD) in the device timezone — matches the format the
// former My Day schedule screen used for day-plan + route-date comparisons.
const dateKey = (d = new Date()) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const isDateKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const addDaysToDateKey = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
};

const formatDayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

const dayBounds = (value: string) => {
  const start = new Date(`${value}T00:00:00`);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
};

// Per-day work-location options for the compact selector at the top of the
// Today view. Keys are persisted server-side via the day-plan endpoints.
const WORK_LOCATIONS: { key: string; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "field", label: "In the field", icon: "map-pin" },
  { key: "home", label: "Home", icon: "home" },
  { key: "office", label: "Office", icon: "briefcase" },
  { key: "warehouse", label: "Warehouse", icon: "package" },
];

// Derive a stop's coordinates the same way RouteMapView does (polymorphic
// customer/prospect stops carry lat/lng directly on the stop row).
function stopCoords(stop: CustomerRouteStop): { lat: number; lng: number } | null {
  if (stop.lat != null && stop.lng != null) return { lat: stop.lat, lng: stop.lng };
  return null;
}

// Self-service entry for reps: build a route on the map, or start a blank
// ("unplanned") self-planned route and add stops as the day unfolds.
function PlanMyDayCard({
  colors,
  selectedDate,
  compact,
}: {
  colors: ReturnType<typeof useColors>;
  selectedDate: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const createRoute = useCreateRoute();

  const startUnplanned = () => {
    createRoute.mutate(
      {
        data: {
          name: `My day · ${new Date(`${selectedDate}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}`,
          routeDate: selectedDate,
          selfPlanned: true,
          stops: [],
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
        },
      },
    );
  };

  return (
    <View
      style={[
        styles.planCard,
        { backgroundColor: colors.card, borderColor: colors.border },
        compact && { marginBottom: 12 },
      ]}
    >
      {!compact && (
        <>
          <Feather name="navigation" size={22} color={colors.primary} />
          <Text style={[styles.planTitle, { color: colors.foreground }]}>Plan your day</Text>
          <Text style={[styles.planSub, { color: colors.mutedForeground }]}>
            Build a visit route from nearby customers and prospects, or start an unplanned route and add stops as you go.
          </Text>
        </>
      )}
      <View style={styles.planBtnRow}>
        <Pressable
          style={[styles.planPrimaryBtn, { backgroundColor: colors.primary }]}
          onPress={() =>
            router.push({
              pathname: "/routes/plan",
              params: { date: selectedDate },
            } as never)
          }
          disabled={createRoute.isPending}
        >
          <Feather name="map" size={14} color="#fff" />
          <Text style={styles.planPrimaryBtnText}>Build a route</Text>
        </Pressable>
        <Pressable
          style={[styles.planSecondaryBtn, { borderColor: colors.border }]}
          onPress={startUnplanned}
          disabled={createRoute.isPending}
        >
          {createRoute.isPending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="play-circle" size={14} color={colors.primary} />
          )}
          <Text style={[styles.planSecondaryBtnText, { color: colors.primary }]}>Start unplanned</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Overlay queued add-stop writes onto the routes list as synthetic stops so
// the rep sees them immediately after tapping "add". Pure logic lives in
// lib/routeStopAddQueue.ts (unit-tested there).
function applyPendingAddStops(
  routes: CustomerRoute[],
  pendingWrites: PendingWrite[],
): CustomerRoute[] {
  return applyPendingAddStopsPure(routes, pendingWrites);
}

// Overlay queued custom-stop edits (rename / fix address) onto the routes so
// the rep sees the new name/address immediately, even while the write is
// still waiting to replay. Only fields present in the payload are overlaid —
// absent fields keep their server values, mirroring the PATCH semantics.
function applyPendingStopUpdates(
  routes: CustomerRoute[],
  pendingWrites: PendingWrite[],
): CustomerRoute[] {
  const edits = new Map<number, UpdateRouteStopPayload>(); // stopId → payload
  for (const w of pendingWrites) {
    if (w.type !== "updateRouteStop") continue;
    const p = w.payload as UpdateRouteStopPayload;
    edits.set(p.stopId, p);
  }
  if (edits.size === 0) return routes;
  return routes.map((r) => ({
    ...r,
    stops: (r.stops ?? []).map((s) => {
      const edit = edits.get(s.id);
      if (!edit) return s;
      const next = { ...s };
      if (edit.name !== undefined) next.customerName = edit.name;
      if (edit.address !== undefined) {
        next.customerAddress = edit.address;
        if (edit.lat != null && edit.lng != null) {
          next.lat = edit.lat;
          next.lng = edit.lng;
        }
      }
      return next;
    }),
  }));
}

// Drop stops with a queued delete from the routes so the rep sees them gone
// immediately — and still gone after an app reload — while the delete waits
// to replay. (localRemovedStopIds only covers the in-flight online case.)
function applyPendingDeletes(
  routes: CustomerRoute[],
  pendingWrites: PendingWrite[],
): CustomerRoute[] {
  const deletedStopIds = new Set<number>();
  for (const w of pendingWrites) {
    if (w.type !== "deleteRouteStop") continue;
    const p = w.payload as DeleteRouteStopPayload;
    deletedStopIds.add(p.stopId);
  }
  if (deletedStopIds.size === 0) return routes;
  return routes.map((r) => ({
    ...r,
    stops: (r.stops ?? []).filter((s) => !deletedStopIds.has(s.id)),
  }));
}

// Synthetic stop ids are always negative; helpful for the few UI affordances
// (check-in, drag-reorder) that shouldn't be enabled until the server has
// issued a real id for the queued add.
function isPendingStopId(id: number): boolean {
  return id < 0;
}

// Client-side haversine — mirrors the server implementation so ETA pills can
// update the instant a stop is dropped during a drag (before the refetch).
function clientHaversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Overlay queued check-in writes onto the routes so the rep sees the
// optimistic checked-in state immediately — even before the write replays.
// We use the write's createdAt as the synthetic checkedInAt timestamp so
// the value is stable across re-renders while the queue lives.
function applyPendingCheckIns(
  routes: CustomerRoute[],
  pendingWrites: PendingWrite[],
): CustomerRoute[] {
  const checkedStops = new Map<number, number>(); // stopId → createdAt
  for (const w of pendingWrites) {
    if (w.type !== "checkInRouteStop") continue;
    const p = w.payload as CheckInRouteStopPayload;
    if (!checkedStops.has(p.stopId)) {
      checkedStops.set(p.stopId, w.createdAt);
    }
  }
  if (checkedStops.size === 0) return routes;
  return routes.map((r) => ({
    ...r,
    stops: (r.stops ?? []).map((s) => {
      if (s.checkedInAt || !checkedStops.has(s.id)) return s;
      return {
        ...s,
        checkedInAt: new Date(checkedStops.get(s.id)!).toISOString(),
      };
    }),
  }));
}

// Hook that wraps useCheckInRouteStop with offline fallback: if the
// network request fails with a connectivity error the check-in is queued
// for replay and the optimistic checked-in state (from applyPendingCheckIns)
// keeps the UI consistent until the write lands.
function useOfflineCheckIn() {
  const { isOnline, queueCheckInRouteStop, triggerFlush } = useOffline();
  const checkIn = useCheckInRouteStop();

  const mutate = useCallback(
    (
      {
        id: routeId,
        stopId,
        customerName,
        routeName,
      }: {
        id: number;
        stopId: number;
        customerName?: string | null;
        routeName?: string | null;
      },
      callbacks?: {
        onSuccess?: () => void;
        onError?: (err: unknown) => void;
      },
    ) => {
      // If we're already offline, skip the doomed network call entirely and
      // queue immediately so the optimistic overlay takes effect at once.
      if (!isOnline) {
        queueCheckInRouteStop({ routeId, stopId, customerName, routeName }).catch(() => {});
        triggerFlush();
        callbacks?.onSuccess?.();
        return;
      }
      checkIn.mutate({ id: routeId, stopId }, {
        onSuccess: callbacks?.onSuccess,
        onError: (err) => {
          if (isNetworkError(err)) {
            // Connectivity lost mid-request: queue and treat as success so the
            // optimistic overlay stays visible and the rep isn't left stuck.
            queueCheckInRouteStop({ routeId, stopId, customerName, routeName }).catch(() => {});
            triggerFlush();
            callbacks?.onSuccess?.();
          } else {
            callbacks?.onError?.(err);
          }
        },
      });
    },
    [checkIn, isOnline, queueCheckInRouteStop, triggerFlush],
  );

  return { mutate, isPending: checkIn.isPending };
}

function isNetworkError(error: unknown): boolean {
  // ApiError is thrown for any non-2xx HTTP response; anything else (e.g.
  // `TypeError: Network request failed` from RN's fetch, AbortError, DNS
  // failures) is treated as a connectivity problem worth queueing for retry.
  return !(error instanceof ApiError);
}

type ViewMode = "today" | "list" | "map";

const VIEW_MODE_STORAGE_KEY = "@agriops:routes_view_mode";

type StopWithEta = CustomerRouteStop & {
  distanceKmFromPrev?: number | null;
  estimatedMinutesFromPrev?: number | null;
};

type SelectedStop = StopWithEta & { routeId: number; routeName: string };

function openDirections(stop: CustomerRouteStop) {
  const addr = [stop.customerAddress, stop.customerCity, stop.customerState].filter(Boolean).join(", ");
  void openNavigation({
    lat: stop.lat,
    lng: stop.lng,
    address: addr || null,
    label: stop.customerName ?? stop.prospectName ?? null,
  });
}

function StopRow({
  stop,
  index,
  routeId,
  colors,
  onCheckIn,
  canCheckIn,
}: {
  stop: StopWithEta;
  index: number;
  routeId: number;
  colors: ReturnType<typeof useColors>;
  onCheckIn: (stopId: number) => void;
  canCheckIn: boolean;
}) {
  const router = useRouter();
  const distanceUnit = useDistanceUnit();
  const hasLocation = (stop.lat != null && stop.lng != null) || stop.customerAddress;
  const isPending = isPendingStopId(stop.id);
  const isProspect = stop.kind === "prospect";
  const stopName = isProspect
    ? stop.prospectName ?? `Prospect ${stop.prospectId}`
    : stop.customerName ?? `Customer ${stop.customerId}`;
  const goToDetail = () => {
    if (isProspect && stop.prospectId != null) {
      router.push({ pathname: "/prospect/[id]", params: { id: stop.prospectId } });
    } else if (!isProspect && stop.customerId != null) {
      router.push({ pathname: "/customer/[id]", params: { id: stop.customerId } });
    }
  };
  return (
    <View>
      {stop.estimatedMinutesFromPrev != null && index > 0 && (
        <View style={[styles.etaRow, { backgroundColor: colors.muted }]}>
          <Feather name="arrow-down" size={10} color={colors.mutedForeground} />
          <Text style={[styles.etaText, { color: colors.mutedForeground }]}>
            ~{stop.estimatedMinutesFromPrev} min · {formatDistance(stop.distanceKmFromPrev, distanceUnit)}
          </Text>
        </View>
      )}
      <View style={[styles.stopRow, { borderColor: colors.border, opacity: isPending ? 0.75 : 1 }]}>
        <View style={[styles.stopBadge, { backgroundColor: stop.checkedInAt ? colors.primary : colors.muted, borderRadius: isProspect ? 6 : 999 }]}>
          <Text style={[styles.stopBadgeText, { color: stop.checkedInAt ? "#fff" : colors.mutedForeground }]}>
            {stop.checkedInAt ? "✓" : (index + 1).toString()}
          </Text>
        </View>
        <View style={styles.stopInfo}>
          <Pressable onPress={goToDetail}>
            <Text style={[styles.stopName, { color: colors.foreground }]}>
              {stopName}
              {isProspect && <Text style={{ color: "#d97706" }}>  · Prospect</Text>}
            </Text>
          </Pressable>
          {(stop.customerCity || stop.customerState) && (
            <Text style={[styles.stopAddr, { color: colors.mutedForeground }]}>
              {[stop.customerAddress, stop.customerCity, stop.customerState].filter(Boolean).join(", ")}
            </Text>
          )}
          {isPending && (
            <View style={styles.syncingPill}>
              <Feather name="upload-cloud" size={10} color={colors.mutedForeground} />
              <Text style={[styles.syncingPillText, { color: colors.mutedForeground }]}>
                Will sync when online
              </Text>
            </View>
          )}
          {stop.checkedInAt && (
            <Text style={[styles.checkedInLabel, { color: colors.primary }]}>
              Checked in {new Date(stop.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Text>
          )}
        </View>
        <View style={styles.stopActions}>
          {hasLocation && (
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.muted }]}
              onPress={() => openDirections(stop)}
            >
              <Feather name="navigation" size={14} color={colors.primary} />
            </Pressable>
          )}
          {!stop.checkedInAt && !isPending && canCheckIn && (
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              onPress={() => onCheckIn(stop.id)}
            >
              <Text style={styles.checkInText}>Check In</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function RouteCard({
  route,
  colors,
  allowCheckIn = true,
}: {
  route: CustomerRoute;
  colors: ReturnType<typeof useColors>;
  allowCheckIn?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const checkIn = useOfflineCheckIn();
  const { canDo } = usePermissions();
  const canCheckIn = allowCheckIn && canDo("routes.edit");
  const stops = (route.stops ?? []) as StopWithEta[];
  const checkedCount = stops.filter((s) => s.checkedInAt).length;
  const total = stops.length;
  const totals = routeMapTotals(route);
  const distanceUnit = useDistanceUnit();
  const hasDistance = totals.totalKm > 0;
  const hasRemaining = totals.remainingKm > 0 && totals.remainingKm < totals.totalKm;
  const allDone = total > 0 && checkedCount === total;

  const handleCheckIn = (stopId: number) => {
    const stop = stops.find((s) => s.id === stopId);
    checkIn.mutate({ id: route.id, stopId, customerName: stop?.customerName ?? null, routeName: route.name });
  };

  return (
    <View style={[styles.routeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable style={styles.routeHeader} onPress={() => setExpanded(!expanded)}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.routeName, { color: colors.foreground }]}>{route.name}</Text>
          <Text style={[styles.routeMeta, { color: colors.mutedForeground }]}>
            {route.routeDate
              ? new Date(route.routeDate + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
              : "No date"}
            {" · "}
            {checkedCount}/{total} stops
            {route.repName ? ` · ${route.repName}` : ""}
          </Text>
          {hasDistance && (
            <Text style={[styles.routeMeta, { color: colors.mutedForeground, marginTop: 2 }]}>
              <Text>Total: </Text>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                {formatDistance(totals.totalKm, distanceUnit)} · {formatMapMinutes(totals.totalMin)}
              </Text>
              {hasRemaining ? (
                <>
                  <Text>  ·  Remaining: </Text>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                    {formatDistance(totals.remainingKm, distanceUnit)} · {formatMapMinutes(totals.remainingMin)}
                  </Text>
                </>
              ) : allDone ? (
                <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>  ·  Complete</Text>
              ) : null}
            </Text>
          )}
        </View>
        <View style={[styles.progressPill, { backgroundColor: checkedCount === total && total > 0 ? colors.primary : colors.muted }]}>
          <Text style={[styles.progressText, { color: checkedCount === total && total > 0 ? "#fff" : colors.mutedForeground }]}>
            {checkedCount}/{total}
          </Text>
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
      </Pressable>

      {expanded && (
        <View style={[styles.stopsList, { borderTopColor: colors.border }]}>
          {stops.length === 0 ? (
            <Text style={[styles.emptyStops, { color: colors.mutedForeground }]}>No stops</Text>
          ) : (
            stops.map((stop, i) => (
              <StopRow
                key={stop.id}
                stop={stop}
                index={i}
                routeId={route.id}
                colors={colors}
                onCheckIn={handleCheckIn}
                canCheckIn={canCheckIn}
              />
            ))
          )}
        </View>
      )}
    </View>
  );
}

function NextStopBanner({
  routes,
  colors,
  selectedDate,
}: {
  routes: CustomerRoute[];
  colors: ReturnType<typeof useColors>;
  selectedDate: string;
}) {
  const router = useRouter();
  const checkIn = useOfflineCheckIn();
  const { canDo } = usePermissions();
  const canCheckIn = selectedDate === dateKey() && canDo("routes.edit");
  const distanceUnit = useDistanceUnit();

  let nextStop: (StopWithEta & { routeId: number; routeName: string }) | null = null;

  for (const route of routes) {
    const stops = (route.stops ?? []) as StopWithEta[];
    // Skip pending (queued) stops — they aren't real on the server yet, so
    // check-in would fail and "next stop" should reflect actionable work.
    const first = stops.find((s) => !s.checkedInAt && !isPendingStopId(s.id));
    if (first) {
      nextStop = { ...first, routeId: route.id, routeName: route.name };
      break;
    }
  }

  if (!nextStop) return null;

  const ns = nextStop;
  const hasLocation = (ns.lat != null && ns.lng != null) || ns.customerAddress;

  return (
    <View style={[styles.nextStopBanner, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}>
      <View style={styles.nextStopHeader}>
        <View style={[styles.nextStopDot, { backgroundColor: colors.primary }]} />
        <Text style={[styles.nextStopLabel, { color: colors.primary }]}>Next Stop</Text>
        {ns.estimatedMinutesFromPrev != null && (
          <View style={[styles.etaPill, { backgroundColor: colors.primary + "20" }]}>
            <Text style={[styles.etaPillText, { color: colors.primary }]}>
              ~{ns.estimatedMinutesFromPrev} min · {formatDistance(ns.distanceKmFromPrev, distanceUnit)}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.nextStopName, { color: colors.foreground }]}>
        {ns.kind === "prospect"
          ? (ns.prospectName ?? `Prospect ${ns.prospectId}`)
          : (ns.customerName ?? `Customer ${ns.customerId}`)}
        {ns.kind === "prospect" && <Text style={{ color: "#d97706" }}>  · Prospect</Text>}
      </Text>
      {(ns.customerCity || ns.customerState) && (
        <Text style={[styles.nextStopAddr, { color: colors.mutedForeground }]}>
          {[ns.customerAddress, ns.customerCity, ns.customerState].filter(Boolean).join(", ")}
        </Text>
      )}
      {hasLocation && (
        <Pressable
          style={[styles.nextStopNavBtn, { backgroundColor: colors.primary }]}
          onPress={() => openDirections(ns)}
          testID="btn-navigate-next-stop"
        >
          <Feather name="navigation" size={18} color="#fff" />
          <Text style={styles.nextStopNavText}>Navigate to next stop</Text>
        </Pressable>
      )}
      <View style={styles.nextStopActions}>
        {ns.kind === "prospect" && ns.prospectId != null ? (
        <Pressable
          style={[styles.nextStopBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
          onPress={() => router.push({ pathname: "/prospect/[id]", params: { id: ns.prospectId! } })}
        >
          <Text style={[styles.nextStopBtnText, { color: colors.foreground }]}>View Profile</Text>
        </Pressable>
        ) : null}
        {ns.kind !== "prospect" && ns.customerId != null && (
        <Pressable
          style={[styles.nextStopBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
          onPress={() => router.push({ pathname: "/customer/[id]", params: { id: ns.customerId! } })}
        >
          <Text style={[styles.nextStopBtnText, { color: colors.foreground }]}>View Profile</Text>
        </Pressable>
        )}
        {canCheckIn && (
        <Pressable
          style={[styles.nextStopBtn, { backgroundColor: colors.primary }]}
          onPress={() => checkIn.mutate({ id: ns.routeId, stopId: ns.id, customerName: ns.customerName ?? ns.prospectName ?? null, routeName: ns.routeName })}
          disabled={checkIn.isPending}
        >
          <Feather name="check" size={13} color="#fff" />
          <Text style={[styles.nextStopBtnText, { color: "#fff" }]}>Check In</Text>
        </Pressable>
        )}
      </View>
    </View>
  );
}

type TodayStop = StopWithEta & { routeId: number; routeName: string; routeIndex: number };

function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function DaySummaryCard({
  stops,
  routeCount,
  todayLabel,
  colors,
}: {
  stops: TodayStop[];
  routeCount: number;
  todayLabel: string;
  colors: ReturnType<typeof useColors>;
}) {
  const distanceUnit = useDistanceUnit();
  const total = stops.length;
  const checkInTimes = stops
    .filter((s) => s.checkedInAt)
    .map((s) => new Date(s.checkedInAt!).getTime())
    .sort((a, b) => a - b);
  const firstTs = checkInTimes[0];
  const lastTs = checkInTimes[checkInTimes.length - 1];
  const elapsedMs = firstTs && lastTs ? lastTs - firstTs : 0;

  const totalDistanceKm = stops.reduce(
    (sum, s) => sum + (typeof s.distanceKmFromPrev === "number" ? s.distanceKmFromPrev : 0),
    0,
  );

  const avgPerStopMs = total > 1 && elapsedMs > 0 ? elapsedMs / (total - 1) : 0;

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const handleShare = async () => {
    const lines = [
      `Day complete — ${todayLabel}`,
      `${total} stop${total !== 1 ? "s" : ""} across ${routeCount} route${routeCount !== 1 ? "s" : ""}`,
      `Distance: ${formatDistance(totalDistanceKm, distanceUnit) ?? "0"}`,
      firstTs ? `First check-in: ${fmtTime(firstTs)}` : null,
      lastTs ? `Last check-in: ${fmtTime(lastTs)}` : null,
      elapsedMs > 0 ? `Working time: ${formatDuration(elapsedMs)}` : null,
      avgPerStopMs > 0 ? `Avg per stop: ${formatDuration(avgPerStopMs)}` : null,
    ].filter(Boolean) as string[];
    const message = lines.join("\n");
    try {
      await Share.share({ message, title: "Day complete" });
    } catch {
      // ignore
    }
  };

  return (
    <View
      style={[
        styles.summaryCard,
        { backgroundColor: "#16a34a10", borderColor: "#16a34a55" },
      ]}
    >
      <View style={styles.summaryHeader}>
        <View style={[styles.summaryIcon, { backgroundColor: "#16a34a" }]}>
          <Feather name="check-circle" size={16} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.summaryEyebrow, { color: "#16a34a" }]}>Day complete</Text>
          <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
            All {total} stop{total !== 1 ? "s" : ""} done
          </Text>
        </View>
        <Pressable
          onPress={handleShare}
          style={[styles.summaryShareBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="share-2" size={13} color={colors.foreground} />
          <Text style={[styles.summaryShareText, { color: colors.foreground }]}>Share</Text>
        </Pressable>
      </View>

      <View style={styles.summaryStatsRow}>
        <View style={styles.summaryStat}>
          <Text style={[styles.summaryStatValue, { color: colors.foreground }]}>{total}</Text>
          <Text style={[styles.summaryStatLabel, { color: colors.mutedForeground }]}>Stops</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryStat}>
          <Text style={[styles.summaryStatValue, { color: colors.foreground }]}>
            {formatDistance(totalDistanceKm, distanceUnit) ?? "0"}
          </Text>
          <Text style={[styles.summaryStatLabel, { color: colors.mutedForeground }]}>Distance</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryStat}>
          <Text style={[styles.summaryStatValue, { color: colors.foreground }]}>
            {elapsedMs > 0 ? formatDuration(elapsedMs) : "—"}
          </Text>
          <Text style={[styles.summaryStatLabel, { color: colors.mutedForeground }]}>Working time</Text>
        </View>
      </View>

      {(firstTs || lastTs) && (
        <View style={styles.summaryFooter}>
          {firstTs && (
            <View style={styles.summaryFooterItem}>
              <Feather name="sunrise" size={11} color={colors.mutedForeground} />
              <Text style={[styles.summaryFooterText, { color: colors.mutedForeground }]}>
                First {fmtTime(firstTs)}
              </Text>
            </View>
          )}
          {lastTs && lastTs !== firstTs && (
            <View style={styles.summaryFooterItem}>
              <Feather name="sunset" size={11} color={colors.mutedForeground} />
              <Text style={[styles.summaryFooterText, { color: colors.mutedForeground }]}>
                Last {fmtTime(lastTs)}
              </Text>
            </View>
          )}
          {avgPerStopMs > 0 && (
            <View style={styles.summaryFooterItem}>
              <Feather name="clock" size={11} color={colors.mutedForeground} />
              <Text style={[styles.summaryFooterText, { color: colors.mutedForeground }]}>
                Avg {formatDuration(avgPerStopMs)}/stop
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const DRAG_SLOT_HEIGHT = 130;
const DRAG_THRESHOLD = DRAG_SLOT_HEIGHT * 0.55;

function DragRow({
  rowKey,
  totalCount,
  isDraggable,
  draggingKey,
  onDragStart,
  onSwap,
  onDragEnd,
  children,
}: {
  rowKey: string;
  totalCount: number;
  isDraggable: boolean;
  draggingKey: string | null;
  onDragStart: (key: string) => void;
  onSwap: (key: string, dir: -1 | 1) => boolean;
  onDragEnd: (key: string) => void;
  children: React.ReactNode;
}) {
  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);
  const consumed = useSharedValue(0);

  const tryStart = () => {
    onDragStart(rowKey);
  };

  const trySwap = (dir: -1 | 1) => {
    return onSwap(rowKey, dir);
  };

  const finish = () => {
    onDragEnd(rowKey);
  };

  const pan = Gesture.Pan()
    .activateAfterLongPress(280)
    .enabled(isDraggable)
    .onStart(() => {
      lifted.value = withTiming(1, { duration: 150 });
      runOnJS(tryStart)();
    })
    .onUpdate((e) => {
      const adjusted = e.translationY - consumed.value;
      translateY.value = adjusted;
      if (adjusted > DRAG_THRESHOLD) {
        consumed.value += DRAG_SLOT_HEIGHT;
        translateY.value = e.translationY - consumed.value;
        runOnJS(trySwap)(1);
      } else if (adjusted < -DRAG_THRESHOLD) {
        consumed.value -= DRAG_SLOT_HEIGHT;
        translateY.value = e.translationY - consumed.value;
        runOnJS(trySwap)(-1);
      }
    })
    .onEnd(() => {
      translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
      consumed.value = 0;
      lifted.value = withTiming(0, { duration: 200 });
      runOnJS(finish)();
    })
    .onFinalize(() => {
      translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
      consumed.value = 0;
      lifted.value = withTiming(0, { duration: 200 });
    });

  const isMe = draggingKey === rowKey;
  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { scale: 1 + lifted.value * 0.025 },
    ],
    shadowOpacity: lifted.value * 0.25,
    shadowRadius: 8 + lifted.value * 8,
    shadowOffset: { width: 0, height: 4 + lifted.value * 4 },
    elevation: lifted.value * 8,
    zIndex: isMe ? 100 : 1,
  }));

  if (!isDraggable || totalCount < 2) {
    return <Animated.View>{children}</Animated.View>;
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}

function AddStopModal({
  visible,
  onClose,
  routes,
  selectedDate,
  colors,
  insets,
  initialMode = "customer",
}: {
  visible: boolean;
  onClose: () => void;
  routes: CustomerRoute[];
  selectedDate: string;
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
  initialMode?: "customer" | "prospect" | "location";
}) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"customer" | "prospect" | "location">(initialMode);
  // Re-apply the requested starting tab each time the modal opens (e.g. the
  // "Meeting / event" shortcut opens straight to Other location).
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(
    routes.length === 1 ? routes[0].id : null,
  );
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [submittingLocation, setSubmittingLocation] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const addStop = useAddRouteStop();
  const createRoute = useCreateRoute();
  const { isOnline, queueAddRouteStop, triggerFlush } = useOffline();
  // When the rep has no route yet for the selected day, adding a stop creates a
  // self-planned "My day" route holding it (online only, mirrors the old
  // entity-picker flow).
  const noRoutes = routes.length === 0;
  const createDayRouteWithStop = async (
    stop:
      | { customerId: number }
      | { prospectId: number }
      | { custom: { name: string; address?: string | null; lat?: number | null; lng?: number | null } },
  ) => {
    await createRoute.mutateAsync({
      data: { name: "My day", routeDate: selectedDate, selfPlanned: true, stops: [stop] },
    });
    await queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey(), exact: false });
  };
  const { data: customers, isLoading } = useListCustomers(
    { search: search || undefined },
    { query: { enabled: mode === "customer", queryKey: getListCustomersQueryKey({ search: search || undefined }) } },
  );
  const { data: prospects, isLoading: prospectsLoading } = useListProspects(
    { search: search || undefined },
    { query: { enabled: mode === "prospect", queryKey: getListProspectsQueryKey({ search: search || undefined }) } },
  );
  // Location lookup (meetings, suppliers, …) — debounce by requiring 3+ chars.
  const locationQuery = mode === "location" ? search.trim() : "";
  const { data: locationResults, isFetching: locationLoading, error: locationError } = useSearchRouteLocations(
    { q: locationQuery },
    {
      query: {
        enabled: locationQuery.length >= 3 && isOnline,
        queryKey: getSearchRouteLocationsQueryKey({ q: locationQuery }),
      },
    },
  );

  useEffect(() => {
    if (visible) {
      setSearch("");
      setMode(initialMode);
      setSubmittingId(null);
      setSubmittingLocation(null);
      setSelectedRouteId(routes.length === 1 ? routes[0].id : null);
    }
  }, [visible, routes, initialMode]);

  const handlePick = async (entityId: number, kind: "customer" | "prospect" = "customer") => {
    if (!selectedRouteId && !noRoutes) return;

    // No route yet today — create a self-planned "My day" route holding the
    // stop (online only, matching the old picker flow).
    if (!selectedRouteId) {
      if (!isOnline) {
        Alert.alert("You're offline", "Starting a new day route needs a connection. Try again when you're back online.");
        return;
      }
      setSubmittingId(entityId);
      try {
        await createDayRouteWithStop(kind === "prospect" ? { prospectId: entityId } : { customerId: entityId });
        onClose();
      } catch (e) {
        Alert.alert("Couldn't add the stop", e instanceof Error ? e.message : "Try again.");
      } finally {
        setSubmittingId(null);
      }
      return;
    }

    // Snapshot the entity fields so the optimistic stop can render without
    // needing the list to still be cached when the routes screen re-renders
    // later (especially after closing this modal).
    let snapshot: AddRouteStopPayload;
    if (kind === "prospect") {
      const prospect = (prospects ?? []).find((p) => p.id === entityId);
      snapshot = {
        routeId: selectedRouteId,
        prospectId: entityId,
        prospectName: prospect?.businessName ?? null,
      };
    } else {
      const customer = (customers ?? []).find((c) => c.id === entityId);
      snapshot = {
        routeId: selectedRouteId,
        customerId: entityId,
        customerName: customer?.name ?? null,
        customerAddress: customer?.address ?? null,
        customerCity: customer?.city ?? null,
        customerState: customer?.state ?? null,
      };
    }
    setSubmittingId(entityId);

    // Already known offline — skip the doomed network call entirely so the
    // rep sees an instant optimistic add instead of a 5s timeout.
    if (!isOnline) {
      try {
        await queueAddRouteStop(snapshot);
      } finally {
        setSubmittingId(null);
        onClose();
      }
      return;
    }

    addStop.mutate(
      { id: selectedRouteId, data: kind === "prospect" ? { prospectId: entityId } : { customerId: entityId } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
          setSubmittingId(null);
          onClose();
        },
        onError: async (err) => {
          if (isNetworkError(err)) {
            // Connectivity dropped between the online check and the request
            // landing. Queue the add so it replays when we're back online,
            // and close the modal so the rep can keep planning. The
            // optimistic overlay (driven off pendingWrites) will keep the
            // stop visible in the meantime.
            try {
              await queueAddRouteStop(snapshot);
              triggerFlush();
            } catch {
              // ignore — pendingWrites stays unchanged on failure
            }
            setSubmittingId(null);
            onClose();
            return;
          }
          // Real server-side rejection — keep the modal open so the rep can
          // pick someone else, but clear the spinner.
          setSubmittingId(null);
        },
      },
    );
  };

  // Add a custom (non-customer) location stop — a picked lookup result, or
  // the raw typed text when offline / no match (server geocodes on replay).
  const handlePickLocation = async (loc: { name: string; lat?: number | null; lng?: number | null }) => {
    if (!selectedRouteId && !noRoutes) return;
    // Nominatim display names are long ("Café X, 12 Main St, Town, …") — use
    // the first segment as the stop name, keep the full string as address.
    const shortName = loc.name.split(",")[0]?.trim() || loc.name;

    // No route yet today — create a self-planned "My day" route holding the
    // stop (online only).
    if (!selectedRouteId) {
      if (!isOnline) {
        Alert.alert("You're offline", "Starting a new day route needs a connection. Try again when you're back online.");
        return;
      }
      setSubmittingLocation(loc.name);
      try {
        await createDayRouteWithStop({
          custom: { name: shortName, address: loc.name, lat: loc.lat ?? null, lng: loc.lng ?? null },
        });
        onClose();
      } catch (e) {
        Alert.alert("Couldn't add the stop", e instanceof Error ? e.message : "Try again.");
      } finally {
        setSubmittingLocation(null);
      }
      return;
    }

    const payload: AddRouteStopPayload = {
      routeId: selectedRouteId,
      customName: shortName,
      customAddress: loc.name,
      customLat: loc.lat ?? null,
      customLng: loc.lng ?? null,
    };
    setSubmittingLocation(loc.name);

    if (!isOnline) {
      try {
        await queueAddRouteStop(payload);
      } finally {
        setSubmittingLocation(null);
        onClose();
      }
      return;
    }

    addStop.mutate(
      {
        id: selectedRouteId,
        data: {
          custom: {
            name: shortName,
            address: loc.name,
            lat: loc.lat ?? null,
            lng: loc.lng ?? null,
          },
        },
      },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
          setSubmittingLocation(null);
          onClose();
        },
        onError: async (err) => {
          if (isNetworkError(err)) {
            try {
              await queueAddRouteStop(payload);
              triggerFlush();
            } catch {
              // ignore — pendingWrites stays unchanged on failure
            }
            setSubmittingLocation(null);
            onClose();
            return;
          }
          setSubmittingLocation(null);
        },
      },
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add a stop</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {routes.length > 1 && (
            <View style={styles.modalSection}>
              <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>Route</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
              >
                {routes.map((r) => {
                  const active = r.id === selectedRouteId;
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => setSelectedRouteId(r.id)}
                      style={[
                        styles.routeChip,
                        {
                          backgroundColor: active ? colors.primary : colors.muted,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.routeChipText,
                          { color: active ? "#fff" : colors.foreground },
                        ]}
                      >
                        {r.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            {(
              [
                { key: "customer" as const, label: "Customers" },
                { key: "prospect" as const, label: "Prospects" },
                { key: "location" as const, label: "Other location" },
              ]
            ).map((m) => {
              const active = mode === m.key;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => { setMode(m.key); setSearch(""); }}
                  style={[
                    styles.routeChip,
                    {
                      backgroundColor: active ? colors.primary : colors.muted,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  testID={`add-stop-mode-${m.key}`}
                >
                  <Text style={[styles.routeChipText, { color: active ? "#fff" : colors.foreground }]}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.modalSearchBar, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.modalSearchInput, { color: colors.foreground }]}
              placeholder={
                mode === "customer"
                  ? "Search customers…"
                  : mode === "prospect"
                    ? "Search prospects…"
                    : "Search a place or address…"
              }
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>

          {!selectedRouteId && !noRoutes && (
            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
              Pick a route above to continue.
            </Text>
          )}

          {mode === "location" ? (
            <FlatList
              style={{ flex: 1 }}
              data={locationResults?.results ?? []}
              keyExtractor={(item, i) => `${item.lat},${item.lng},${i}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => {
                const isSubmitting = submittingLocation === item.name;
                const disabled =
                  (!selectedRouteId && !noRoutes) || addStop.isPending || createRoute.isPending;
                return (
                  <Pressable
                    onPress={() => handlePickLocation(item)}
                    disabled={disabled}
                    style={[
                      styles.modalRow,
                      { borderBottomColor: colors.border, opacity: disabled && !isSubmitting ? 0.5 : 1 },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalRowName, { color: colors.foreground }]}>
                        {item.name.split(",")[0]?.trim() || item.name}
                      </Text>
                      <Text style={[styles.modalRowMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
                        {item.name}
                      </Text>
                    </View>
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Feather name="plus-circle" size={18} color={colors.primary} />
                    )}
                  </Pressable>
                );
              }}
              ListFooterComponent={
                search.trim().length >= 3 && (selectedRouteId || noRoutes) ? (
                  <Pressable
                    onPress={() => handlePickLocation({ name: search.trim() })}
                    disabled={addStop.isPending || createRoute.isPending}
                    style={[styles.modalRow, { borderBottomColor: colors.border }]}
                    testID="add-stop-location-as-typed"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalRowName, { color: colors.primary }]}>
                        Add “{search.trim()}” as a stop
                      </Text>
                      <Text style={[styles.modalRowMeta, { color: colors.mutedForeground }]}>
                        {isOnline
                          ? "Use exactly what you typed — we'll look up the map location for you"
                          : "Offline — saved now, map location resolved when you're back online"}
                      </Text>
                    </View>
                    <Feather name="plus-circle" size={18} color={colors.primary} />
                  </Pressable>
                ) : null
              }
              ListEmptyComponent={
                locationLoading ? (
                  <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
                ) : (
                  <Text style={[styles.modalEmpty, { color: colors.mutedForeground }]}>
                    {search.trim().length < 3
                      ? "Type at least 3 characters to search for a place or address"
                      : locationError
                        ? `Search failed: ${locationError instanceof Error ? locationError.message : String(locationError)}`
                        : isOnline
                          ? "No places found — you can still add what you typed below"
                          : "Location lookup needs a connection — add what you typed below"}
                  </Text>
                )
              }
            />
          ) : (
          <FlatList
            style={{ flex: 1 }}
            data={
              mode === "prospect"
                ? (prospects ?? []).map((p) => ({
                    id: p.id,
                    title: p.businessName,
                    meta: [p.city, p.state].filter(Boolean).join(", "),
                  }))
                : (customers ?? []).map((c) => ({
                    id: c.id,
                    title: c.name,
                    meta: [c.city, c.state].filter(Boolean).join(", "),
                  }))
            }
            keyExtractor={(item) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => {
              const isSubmitting = submittingId === item.id;
              const disabled = (!selectedRouteId && !noRoutes) || addStop.isPending || createRoute.isPending;
              return (
                <Pressable
                  onPress={() => handlePick(item.id, mode === "prospect" ? "prospect" : "customer")}
                  disabled={disabled}
                  style={[
                    styles.modalRow,
                    { borderBottomColor: colors.border, opacity: disabled && !isSubmitting ? 0.5 : 1 },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalRowName, { color: colors.foreground }]}>
                      {item.title}
                    </Text>
                    {!!item.meta && (
                      <Text style={[styles.modalRowMeta, { color: colors.mutedForeground }]}>
                        {item.meta}
                      </Text>
                    )}
                  </View>
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Feather name="plus-circle" size={18} color={colors.primary} />
                  )}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              (mode === "prospect" ? prospectsLoading : isLoading) ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
              ) : (
                <Text style={[styles.modalEmpty, { color: colors.mutedForeground }]}>
                  {mode === "prospect" ? "No prospects found" : "No customers found"}
                </Text>
              )
            }
          />
          )}
        </View>
      </View>
    </Modal>
  );
}

// Edit a custom (meeting/supplier) stop: rename it and/or fix its address.
// Address changes go through the same location lookup used when adding the
// stop; picking a result carries its coordinates, while "use as typed" lets
// the server re-geocode the freeform text.
function EditCustomStopModal({
  target,
  onClose,
  onSaved,
  colors,
  insets,
}: {
  target: { routeId: number; stopId: number; name: string; address: string | null } | null;
  onClose: () => void;
  onSaved?: () => void;
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
}) {
  const queryClient = useQueryClient();
  const updateStop = useUpdateRouteStop();
  const { isOnline, queueUpdateRouteStop, triggerFlush } = useOffline();
  const [name, setName] = useState("");
  const [addressSearch, setAddressSearch] = useState("");
  // The pending address change (null = keep the current address).
  const [pickedAddress, setPickedAddress] = useState<{
    address: string;
    lat: number | null;
    lng: number | null;
  } | null>(null);

  useEffect(() => {
    if (target) {
      setName(target.name);
      setAddressSearch("");
      setPickedAddress(null);
    }
  }, [target]);

  const locationQuery = addressSearch.trim();
  const { data: locationResults, isFetching: locationLoading, error: locationError } = useSearchRouteLocations(
    { q: locationQuery },
    {
      query: {
        enabled: target != null && locationQuery.length >= 3 && isOnline,
        queryKey: getSearchRouteLocationsQueryKey({ q: locationQuery }),
      },
    },
  );

  if (!target) return null;

  const trimmedName = name.trim();
  const nameChanged = trimmedName.length > 0 && trimmedName !== target.name;
  const hasChanges = nameChanged || pickedAddress != null;

  const handleSave = () => {
    if (!hasChanges || updateStop.isPending) return;
    const data: { name?: string; address?: string | null; lat?: number | null; lng?: number | null } = {};
    if (nameChanged) data.name = trimmedName;
    if (pickedAddress) {
      data.address = pickedAddress.address;
      if (pickedAddress.lat != null && pickedAddress.lng != null) {
        data.lat = pickedAddress.lat;
        data.lng = pickedAddress.lng;
      }
    }
    // Queue the edit for replay (offline or connectivity lost mid-request).
    // The routes list overlays the queued change optimistically, so closing
    // the modal as "saved" keeps the UI consistent until the write lands.
    // Await the enqueue before triggering the flush so QueueSync never reads
    // the storage-backed queue ahead of the new entry landing (which would
    // strand the edit until an unrelated flush event).
    const queueForLater = async () => {
      try {
        await queueUpdateRouteStop({
          routeId: target.routeId,
          stopId: target.stopId,
          ...(nameChanged ? { name: trimmedName } : {}),
          ...(pickedAddress
            ? {
                address: pickedAddress.address,
                lat: pickedAddress.lat,
                lng: pickedAddress.lng,
              }
            : {}),
          stopName: nameChanged ? trimmedName : target.name,
        });
      } catch {
        Alert.alert(
          "Couldn't save changes",
          "The edit couldn't be saved for syncing. Please try again.",
        );
        return;
      }
      triggerFlush();
      onSaved?.();
      onClose();
    };
    // Already offline: skip the doomed network call and queue immediately.
    if (!isOnline) {
      queueForLater();
      return;
    }
    updateStop.mutate(
      { id: target.routeId, stopId: target.stopId, data },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
          onSaved?.();
          onClose();
        },
        onError: (err) => {
          if (isNetworkError(err)) {
            queueForLater();
            return;
          }
          Alert.alert(
            "Couldn't save changes",
            err instanceof Error ? err.message : "Please try again.",
          );
        },
      },
    );
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit stop</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={styles.modalSection}>
            <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>Name</Text>
            <View style={[styles.modalSearchBar, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="tag" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.modalSearchInput, { color: colors.foreground }]}
                placeholder="Stop name"
                placeholderTextColor={colors.mutedForeground}
                value={name}
                onChangeText={setName}
                testID="edit-stop-name-input"
              />
            </View>
          </View>

          <View style={styles.modalSection}>
            <Text style={[styles.modalLabel, { color: colors.mutedForeground }]}>Address</Text>
            <Text style={[styles.modalRowMeta, { color: colors.mutedForeground, marginBottom: 6 }]} numberOfLines={2}>
              {pickedAddress
                ? `New: ${pickedAddress.address}`
                : target.address
                  ? `Current: ${target.address}`
                  : "No address saved yet"}
            </Text>
            {pickedAddress && (
              <Pressable onPress={() => setPickedAddress(null)} hitSlop={6}>
                <Text style={[styles.modalRowMeta, { color: colors.primary, marginBottom: 6 }]}>
                  Keep current address instead
                </Text>
              </Pressable>
            )}
            <View style={[styles.modalSearchBar, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.modalSearchInput, { color: colors.foreground }]}
                placeholder="Search a new place or address…"
                placeholderTextColor={colors.mutedForeground}
                value={addressSearch}
                onChangeText={setAddressSearch}
                testID="edit-stop-address-input"
              />
            </View>
          </View>

          <FlatList
            style={{ flex: 1 }}
            data={locationResults?.results ?? []}
            keyExtractor={(item, i) => `${item.lat},${item.lng},${i}`}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 12 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setPickedAddress({ address: item.name, lat: item.lat, lng: item.lng });
                  setAddressSearch("");
                }}
                style={[styles.modalRow, { borderBottomColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalRowName, { color: colors.foreground }]}>
                    {item.name.split(",")[0]?.trim() || item.name}
                  </Text>
                  <Text style={[styles.modalRowMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {item.name}
                  </Text>
                </View>
                <Feather name="map-pin" size={18} color={colors.primary} />
              </Pressable>
            )}
            ListFooterComponent={
              locationQuery.length >= 3 ? (
                <Pressable
                  onPress={() => {
                    setPickedAddress({ address: locationQuery, lat: null, lng: null });
                    setAddressSearch("");
                  }}
                  style={[styles.modalRow, { borderBottomColor: colors.border }]}
                  testID="edit-stop-address-as-typed"
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalRowName, { color: colors.primary }]}>
                      Use “{locationQuery}” as the address
                    </Text>
                    <Text style={[styles.modalRowMeta, { color: colors.mutedForeground }]}>
                      We'll look up the map location for you when you save
                    </Text>
                  </View>
                  <Feather name="edit-3" size={18} color={colors.primary} />
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              locationLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
              ) : locationQuery.length >= 3 && locationError ? (
                <Text style={[styles.modalEmpty, { color: colors.mutedForeground }]}>
                  Search failed: {locationError instanceof Error ? locationError.message : String(locationError)}
                </Text>
              ) : locationQuery.length >= 3 && !isOnline ? (
                <Text style={[styles.modalEmpty, { color: colors.mutedForeground }]}>
                  Location lookup needs a connection — you can still use what you typed below
                </Text>
              ) : null
            }
          />

          <Pressable
            style={[
              styles.planPrimaryBtn,
              { backgroundColor: hasChanges ? colors.primary : colors.muted, marginTop: 8 },
            ]}
            onPress={handleSave}
            disabled={!hasChanges || updateStop.isPending}
            testID="edit-stop-save"
          >
            {updateStop.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="check" size={14} color={hasChanges ? "#fff" : colors.mutedForeground} />
            )}
            <Text style={[styles.planPrimaryBtnText, !hasChanges && { color: colors.mutedForeground }]}>
              Save changes
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// Persistent nearby-suggestions tray for the active today view. Tapping a chip
// adds the stop to the target route (the rep's self-planned route for today,
// falling back to the first route), with the same offline-aware path as the
// manual add-stop modal.
function ActiveRouteNearbyTray({
  targetRoute,
}: {
  targetRoute: CustomerRoute | null;
}) {
  const queryClient = useQueryClient();
  const addStop = useAddRouteStop();
  const { isOnline, queueAddRouteStop, triggerFlush } = useOffline();
  const { origin, error: locError, locating } = useNearbyWatch(true);
  const { data: nearby, isLoading } = useNearbyStopsData(origin);

  // Stops already on the target route, so we can show them as added.
  const queuedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const s of (targetRoute?.stops ?? []) as StopWithEta[]) {
      if (s.customerId != null) keys.add(`customer:${s.customerId}`);
      if (s.prospectId != null) keys.add(`prospect:${s.prospectId}`);
    }
    return keys;
  }, [targetRoute]);

  const onAdd = async (stop: NearbyStop) => {
    if (!targetRoute) return;
    const isProspect = stop.kind === "prospect";
    const snapshot: AddRouteStopPayload = {
      routeId: targetRoute.id,
      customerId: isProspect ? null : stop.id,
      prospectId: isProspect ? stop.id : null,
      customerName: isProspect ? null : stop.name ?? null,
      prospectName: isProspect ? stop.name ?? null : null,
      customerAddress: isProspect ? null : stop.address ?? null,
      customerCity: isProspect ? null : stop.city ?? null,
      customerState: isProspect ? null : stop.state ?? null,
    };
    if (!isOnline) {
      try {
        await queueAddRouteStop(snapshot);
      } catch {
        // ignore — pendingWrites stays unchanged on failure
      }
      return;
    }
    addStop.mutate(
      {
        id: targetRoute.id,
        data: isProspect ? { prospectId: stop.id } : { customerId: stop.id },
      },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListRoutesQueryKey() });
        },
        onError: async (err) => {
          if (isNetworkError(err)) {
            try {
              await queueAddRouteStop(snapshot);
              triggerFlush();
            } catch {
              // ignore
            }
          }
        },
      },
    );
  };

  if (!targetRoute) return null;

  return (
    <NearbyTray
      stops={nearby ?? []}
      isLoading={isLoading}
      locating={locating}
      error={locError}
      queuedKeys={queuedKeys}
      onAdd={onAdd}
      radiusKm={NEARBY_RADIUS_KM}
    />
  );
}

// Short clock-time label for day-timeline timestamps.
function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Elapsed hours/minutes label for the field-time card.
function fmtElapsed(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

// Day timeline: check in at the work location, head out to the field, and end
// the day. Each set step shows its time with a small undo. Online-only.
function DayTimelineCard({
  plan,
  colors,
  isOnline,
  markingEvent,
  onMark,
}: {
  plan: DayPlan | null;
  colors: ReturnType<typeof useColors>;
  isOnline: boolean;
  markingEvent: DayPlanMarkInputEvent | null;
  onMark: (event: DayPlanMarkInputEvent) => void;
}) {
  // Only relevant once the rep has picked a work location for the day.
  if (!plan?.workLocation) return null;
  const locLabel = plan.location?.label ?? "your work location";
  const busy = markingEvent != null;

  type Step = {
    set: string | null;
    label: string;
    setEvent: DayPlanMarkInputEvent;
    clearEvent: DayPlanMarkInputEvent;
    icon: keyof typeof Feather.glyphMap;
  };
  const steps: Step[] = [
    {
      set: plan.checkedInAt,
      label: `Check in at ${locLabel}`,
      setEvent: "check_in",
      clearEvent: "clear_check_in",
      icon: "log-in",
    },
    {
      set: plan.departedAt,
      label: "Heading out",
      setEvent: "depart",
      clearEvent: "clear_depart",
      icon: "truck",
    },
    {
      set: plan.endedAt,
      label: "End my day",
      setEvent: "end",
      clearEvent: "clear_end",
      icon: "flag",
    },
  ];

  return (
    <View style={[styles.timelineCard, { borderTopColor: colors.border }]}>
      {steps.map((step) => {
        const done = !!step.set;
        return (
          <View key={step.setEvent} style={styles.timelineRow}>
            <View
              style={[
                styles.timelineDot,
                { backgroundColor: done ? colors.primary : colors.muted, borderColor: colors.border },
              ]}
            >
              <Feather
                name={done ? "check" : step.icon}
                size={12}
                color={done ? colors.primaryForeground : colors.mutedForeground}
              />
            </View>
            {done ? (
              <View style={styles.timelineDoneRow}>
                <Text style={[styles.timelineDoneText, { color: colors.foreground }]} numberOfLines={1}>
                  {step.label} · {fmtClock(step.set)}
                </Text>
                <Pressable
                  onPress={() => onMark(step.clearEvent)}
                  disabled={!isOnline || busy}
                  hitSlop={8}
                  style={(!isOnline || busy) && { opacity: 0.5 }}
                  testID={`day-undo-${step.setEvent}`}
                >
                  <Text style={[styles.timelineUndo, { color: colors.mutedForeground }]}>Undo</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={[
                  styles.timelineBtn,
                  { borderColor: colors.border, backgroundColor: colors.muted },
                  (!isOnline || busy) && { opacity: 0.5 },
                ]}
                onPress={() => onMark(step.setEvent)}
                disabled={!isOnline || busy}
                testID={`day-mark-${step.setEvent}`}
              >
                {markingEvent === step.setEvent ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.timelineBtnText, { color: colors.foreground }]}>{step.label}</Text>
                )}
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function TodayView({
  routes,
  selectedDate,
  colors,
  insets,
  isRefetching,
  onRefresh,
}: {
  routes: CustomerRoute[];
  selectedDate: string;
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
  isRefetching: boolean;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const checkIn = useOfflineCheckIn();
  const reassign = useReassignRouteStops();
  const queryClient = useQueryClient();
  const { queueReassignRouteStops, queueDeleteRouteStop, triggerFlush, isOnline, pendingWrites } = useOffline();
  const { canDo } = usePermissions();
  const isSelectedToday = selectedDate === dateKey();
  const canCheckIn = isSelectedToday && canDo("routes.edit");
  const canEditRoutes = canDo("routes.edit");
  const canSeeService = canDo("service.view");
  const distanceUnit = useDistanceUnit();

  const { data: profile } = useGetAuthMemberProfile();
  const assigneeId = profile?.id;

  // Per-day work location follows the day currently selected in My Day.
  const planDate = selectedDate;
  const dayPlanParams = { date: planDate };
  const { data: dayPlan } = useGetMyDayPlan(dayPlanParams, {
    query: { queryKey: getGetMyDayPlanQueryKey(dayPlanParams) },
  });
  const setDayPlan = useSetMyDayPlan();
  const markDayPlan = useMarkMyDayPlan();
  const [savingLocation, setSavingLocation] = useState(false);
  const [markingEvent, setMarkingEvent] = useState<DayPlanMarkInputEvent | null>(null);
  const workLocation = dayPlan?.workLocation ?? null;

  // Company sites for office/warehouse day picking. Loaded lazily but cheap;
  // filtered client-side by the tapped location type.
  const { data: sites } = useListSites(undefined, {
    query: { queryKey: getListSitesQueryKey(), enabled: isOnline },
  });
  // When the rep taps office/warehouse and more than one candidate site
  // exists, show an inline picker to choose which one.
  const [sitePicker, setSitePicker] = useState<{ key: string; options: Site[] } | null>(null);

  const invalidateDayPlan = useCallback(
    () => queryClient.invalidateQueries({ queryKey: getGetMyDayPlanQueryKey(dayPlanParams) }),
    [queryClient, dayPlanParams],
  );

  const commitWorkLocation = useCallback(
    async (next: string | null, siteId?: number | null) => {
      setSavingLocation(true);
      try {
        await setDayPlan.mutateAsync({ data: { planDate, workLocation: next, siteId } });
        await invalidateDayPlan();
      } catch (e) {
        Alert.alert("Couldn't save location", e instanceof Error ? e.message : "Try again.");
      } finally {
        setSavingLocation(false);
      }
    },
    [setDayPlan, planDate, invalidateDayPlan],
  );

  const setWorkLocation = async (key: string) => {
    if (!isOnline) return;
    setSitePicker(null);
    // Tapping the active chip again clears the selection.
    if (workLocation === key) {
      await commitWorkLocation(null, null);
      return;
    }
    // Office / warehouse days can pin a specific company site.
    if (key === "office" || key === "warehouse") {
      const all = sites ?? [];
      const byType = all.filter((s) => s.type === key);
      const candidates = byType.length > 0 ? byType : all;
      if (candidates.length > 1) {
        setSitePicker({ key, options: candidates });
        return;
      }
      await commitWorkLocation(key, candidates[0]?.id ?? null);
      return;
    }
    await commitWorkLocation(key, null);
  };

  const chooseSite = async (site: Site) => {
    const key = sitePicker?.key;
    setSitePicker(null);
    if (!key) return;
    await commitWorkLocation(key, site.id);
  };

  // Day timeline marks (check in / heading out / end my day) and their undos.
  const markDay = async (event: DayPlanMarkInputEvent) => {
    if (!isOnline) return;
    setMarkingEvent(event);
    try {
      await markDayPlan.mutateAsync({ data: { planDate, event } });
      await invalidateDayPlan();
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 409
          ? "Pick where you're working from first."
          : e instanceof Error
            ? e.message
            : "Try again.";
      Alert.alert("Couldn't update your day", msg);
    } finally {
      setMarkingEvent(null);
    }
  };

  // Service-day content merged from the former My Day tab: selected-day scheduled
  // service / install jobs, the next-up banner, and unscheduled open jobs.
  const { data: serviceJobs, isLoading: ls } = useListWorkItems(
    { kind: "service_job", assigneeId },
    {
      query: {
        enabled: !!assigneeId && canSeeService,
        queryKey: getListWorkItemsQueryKey({ kind: "service_job", assigneeId }),
      },
    },
  );
  const { data: installJobs, isLoading: li } = useListWorkItems(
    { kind: "install_job", assigneeId },
    {
      query: {
        enabled: !!assigneeId && canSeeService,
        queryKey: getListWorkItemsQueryKey({ kind: "install_job", assigneeId }),
      },
    },
  );

  const { todays, nextUp, unscheduled } = useMemo(() => {
    const { start, end } = dayBounds(selectedDate);
    const all = [...(serviceJobs ?? []), ...(installJobs ?? [])];
    const todayJobs: WorkItem[] = [];
    const unscheduledOpen: WorkItem[] = [];
    for (const w of all) {
      const ws = w.scheduledWindowStart ? new Date(w.scheduledWindowStart).getTime() : null;
      const we = w.scheduledWindowEnd ? new Date(w.scheduledWindowEnd).getTime() : null;
      if (ws == null && we == null) {
        if (w.status !== "completed" && w.status !== "cancelled") {
          unscheduledOpen.push(w);
        }
        continue;
      }
      const anchorStart = ws ?? we!;
      const anchorEnd = we ?? ws!;
      if (anchorStart < end && anchorEnd >= start) todayJobs.push(w);
    }
    todayJobs.sort((a, b) => {
      const as = a.scheduledWindowStart ? new Date(a.scheduledWindowStart).getTime() : Number.MAX_SAFE_INTEGER;
      const bs = b.scheduledWindowStart ? new Date(b.scheduledWindowStart).getTime() : Number.MAX_SAFE_INTEGER;
      return as - bs;
    });
    const now = isSelectedToday ? Date.now() : start;
    const active = todayJobs.find(
      (w) => w.status === "en_route" || w.status === "on_site" || w.status === "in_progress",
    );
    const upcoming = todayJobs.find((w) => {
      if (w.status === "completed" || w.status === "cancelled") return false;
      const we = w.scheduledWindowEnd ? new Date(w.scheduledWindowEnd).getTime() : null;
      return we == null || we >= now;
    });
    return { todays: todayJobs, nextUp: active ?? upcoming ?? null, unscheduled: unscheduledOpen };
  }, [serviceJobs, installJobs, selectedDate, isSelectedToday]);

  const serviceLoading = canSeeService && (ls || li) && !serviceJobs && !installJobs;

  // GPS watch for the "Next up" drive-time pill — only enabled when there's a
  // next-up job with known coordinates so we don't request location on load.
  const hasNextCoords = nextUp?.customerLat != null && nextUp?.customerLng != null;
  const { origin: gpsOrigin } = useNearbyWatch(!!hasNextCoords);
  const nextUpDrive = useMemo(() => {
    if (!gpsOrigin || !nextUp?.customerLat || !nextUp?.customerLng) return null;
    const km = haversineKm(gpsOrigin.lat, gpsOrigin.lng, nextUp.customerLat, nextUp.customerLng);
    const mins = Math.round((km / 80) * 60); // 80 km/h average
    return { km: Math.round(km * 10) / 10, mins };
  }, [gpsOrigin, nextUp?.customerLat, nextUp?.customerLng]);

  // "Best route order" — re-sequence each route with >= 2 located stops via the
  // optimizer. Stops without coordinates keep their relative position at the
  // END of the route (the endpoint requires a complete permutation, so they
  // must stay in the payload).
  const optimize = useOptimizeRouteOrder();
  const reorder = useReorderRouteStops();
  const [optimizingRouteId, setOptimizingRouteId] = useState<number | null>(null);

  // True when a queued (offline) reassign write still references this route.
  // Optimizing on top of one would race the replay: the server order the
  // optimizer produces could be clobbered when the queued reassign finally
  // lands. Block it until the queue drains.
  const hasPendingReorderForRoute = (routeId: number) =>
    pendingWrites.some(
      (w) =>
        w.type === "reassignRouteStops" &&
        (w.payload as ReassignRouteStopsPayload | undefined)?.groups?.some(
          (g) => g.routeId === routeId,
        ),
    );

  const optimizeRoute = async (route: CustomerRoute) => {
    if (!isOnline) {
      Alert.alert("You're offline", "Optimizing needs a connection. Try again when you're back online.");
      return;
    }
    if (hasPendingReorderForRoute(route.id)) {
      Alert.alert(
        "Changes still syncing",
        "This route has stop-order changes waiting to sync. Try optimizing again once they've uploaded.",
      );
      return;
    }
    const stops = [...(route.stops ?? [])]
      .filter((s) => !isPendingStopId(s.id))
      .sort((a, b) => a.stopOrder - b.stopOrder);
    const located = stops.filter((s) => stopCoords(s) != null);
    const unlocated = stops.filter((s) => stopCoords(s) == null);
    if (located.length < 2) {
      Alert.alert("Not enough mapped stops", "Add coordinates to at least two stops to optimize the order.");
      return;
    }
    setOptimizingRouteId(route.id);
    try {
      const coordinates = located.map((s) => {
        const c = stopCoords(s)!;
        return { lat: c.lat, lng: c.lng };
      });
      const { order } = await optimize.mutateAsync({ data: { coordinates } });
      // Map the optimized indices back to located stop ids, then append the
      // unlocated stops (in their existing relative order) at the end so the
      // permutation stays complete.
      const orderedLocated = order.map((i) => located[i].id);
      const optimizedStopIds = [...orderedLocated, ...unlocated.map((s) => s.id)];
      await reorder.mutateAsync({ id: route.id, data: { stopIds: optimizedStopIds } });
      // Rebase any stale drag-order override for THIS route onto the new
      // server order. Without this, a leftover localFlat would keep driving
      // effectiveFlat (showing the pre-optimize order) and could later be
      // replayed, clobbering the server's optimized order. Other routes'
      // entries in the override are preserved.
      setLocalFlat((prev) => {
        if (!prev) return prev;
        const others = prev.filter((it) => it.routeId !== route.id);
        if (others.length === 0) return null;
        const rebasedForRoute = optimizedStopIds.map((stopId) => ({
          routeId: route.id,
          stopId,
        }));
        return [...others, ...rebasedForRoute];
      });
      await queryClient.invalidateQueries({
        queryKey: getListRoutesQueryKey(),
        exact: false,
      });
    } catch (e) {
      Alert.alert("Couldn't optimize", e instanceof Error ? e.message : "Try again.");
    } finally {
      setOptimizingRouteId(null);
    }
  };

  const todayRoutes = routes;
  // The route nearby-tray adds land on: prefer the rep's self-planned route,
  // otherwise the first route for the selected day.
  const nearbyTargetRoute =
    todayRoutes.find((r) => r.selfPlanned) ?? todayRoutes[0] ?? null;

  // Flat ordered list of (routeId, stopId) used as an optimistic override for
  // drag-reorder/move-across-routes before the server confirms. Persisted so
  // the override survives app reloads while a queued reassign is still pending.
  type FlatItem = { routeId: number; stopId: number };
  const [localFlat, setLocalFlat] = useState<FlatItem[] | null>(null);
  const [localFlatLoaded, setLocalFlatLoaded] = useState(false);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [addStopOpen, setAddStopOpen] = useState(false);
  // Which tab the Add Stop modal opens on; the "Meeting / event" shortcut
  // jumps straight to the Other-location search.
  const [addStopMode, setAddStopMode] = useState<"customer" | "location">("customer");
  const openAddStop = (mode: "customer" | "location") => {
    setAddStopMode(mode);
    setAddStopOpen(true);
  };
  const deleteStop = useDeleteRouteStop();
  // Optimistically-removed stop ids: displayed as gone while the DELETE is
  // in-flight; reverted to visible on server error.
  const [localRemovedStopIds, setLocalRemovedStopIds] = useState<Set<number>>(new Set());
  // Custom stop currently being edited (rename / address fix), or null.
  const [editStopTarget, setEditStopTarget] = useState<{
    routeId: number;
    stopId: number;
    name: string;
    address: string | null;
  } | null>(null);

  // Hydrate persisted override on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(LOCAL_FLAT_STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as FlatItem[];
            if (
              Array.isArray(parsed) &&
              parsed.every(
                (it) =>
                  it &&
                  typeof it.routeId === "number" &&
                  typeof it.stopId === "number",
              )
            ) {
              setLocalFlat(parsed);
            }
          } catch {
            // ignore malformed storage payload
          }
        }
        setLocalFlatLoaded(true);
      })
      .catch(() => setLocalFlatLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist any change so a reload mid-offline doesn't lose the override.
  useEffect(() => {
    if (!localFlatLoaded) return;
    if (!localFlat) {
      AsyncStorage.removeItem(LOCAL_FLAT_STORAGE_KEY).catch(() => {});
    } else {
      AsyncStorage.setItem(
        LOCAL_FLAT_STORAGE_KEY,
        JSON.stringify(localFlat),
      ).catch(() => {});
    }
  }, [localFlat, localFlatLoaded]);

  // Lookup of stop data by id, regardless of which route it currently lives on.
  const stopDataById = new Map<number, StopWithEta>();
  for (const r of todayRoutes) {
    for (const s of (r.stops ?? []) as StopWithEta[]) {
      stopDataById.set(s.id, s);
    }
  }
  const routeNameById = new Map<number, string>(
    todayRoutes.map((r) => [r.id, r.name]),
  );

  const baseFlat: FlatItem[] = todayRoutes.flatMap((route) =>
    ((route.stops ?? []) as StopWithEta[]).map((s) => ({
      routeId: route.id,
      stopId: s.id,
    })),
  );

  // Once the server's flat order matches our local override (because the
  // queued reassign finally landed and the routes query refetched), drop the
  // override so future server changes flow through normally.
  useEffect(() => {
    if (!localFlat) return;
    if (localFlat.length !== baseFlat.length) return;
    const matches = localFlat.every(
      (it, i) =>
        baseFlat[i] &&
        baseFlat[i].stopId === it.stopId &&
        baseFlat[i].routeId === it.routeId,
    );
    if (matches) setLocalFlat(null);
    // baseFlat is recomputed every render but only its contents matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, localFlat]);
  // If localFlat is set, only use the items still present on the server so we
  // don't render ghosts after a refetch removes a stop. Also filter out any
  // stops that have been optimistically deleted by the user.
  const effectiveFlat: FlatItem[] = (localFlat
    ? localFlat.filter((it) => stopDataById.has(it.stopId))
    : baseFlat
  ).filter((it) => !localRemovedStopIds.has(it.stopId));

  // Per-route running index for the badge / ETA "first stop" logic. When a
  // local drag override is active the server ETA values are stale, so we
  // compute them on the client using haversine (same formula as the server)
  // so the pills update the instant a stop is dropped.
  const perRouteIndex = new Map<number, number>();
  const lastStopPerRoute = new Map<number, StopWithEta>();
  const todayStops: TodayStop[] = effectiveFlat.map((it) => {
    const stop = stopDataById.get(it.stopId)!;
    const idx = perRouteIndex.get(it.routeId) ?? 0;
    perRouteIndex.set(it.routeId, idx + 1);

    let distanceKmFromPrev = stop.distanceKmFromPrev;
    let estimatedMinutesFromPrev = stop.estimatedMinutesFromPrev;

    if (localFlat) {
      if (idx === 0) {
        // First stop on this route — no prior leg.
        distanceKmFromPrev = null;
        estimatedMinutesFromPrev = null;
      } else {
        const prev = lastStopPerRoute.get(it.routeId);
        if (prev?.lat != null && prev?.lng != null && stop.lat != null && stop.lng != null) {
          const km = clientHaversineKm(prev.lat, prev.lng, stop.lat, stop.lng);
          distanceKmFromPrev = Math.round(km * 10) / 10;
          // Approximate 80 km/h average speed — mirrors the server fallback.
          estimatedMinutesFromPrev = Math.round((km / 80) * 60);
        } else {
          distanceKmFromPrev = null;
          estimatedMinutesFromPrev = null;
        }
      }
    }

    lastStopPerRoute.set(it.routeId, stop);

    return {
      ...stop,
      routeId: it.routeId,
      routeName: routeNameById.get(it.routeId) ?? "",
      routeIndex: idx,
      distanceKmFromPrev,
      estimatedMinutesFromPrev,
    };
  });

  const total = todayStops.length;
  const checkedCount = todayStops.filter((s) => s.checkedInAt).length;
  const pct = total > 0 ? Math.round((checkedCount / total) * 100) : 0;
  // Skip pending (queued) stops when picking the "Up next" highlight —
  // they aren't actionable until the queue drains and the server assigns a
  // real id, so calling them out as the next stop would be misleading.
  const nextStopId = todayStops.find(
    (s) => !s.checkedInAt && !isPendingStopId(s.id),
  )?.id;

  // Work-from-location coordinates for the day (resolved server-side; null when
  // there's no home address on file or the chosen site lacks coordinates).
  const planLocation = dayPlan?.location ?? null;
  // First not-checked-in stop with coordinates — the leg we route from the
  // work location on the map + in the mileage estimate.
  const firstOpenStop = todayStops.find(
    (s) => !s.checkedInAt && !isPendingStopId(s.id) && s.lat != null && s.lng != null,
  );
  const roadLegParams =
    planLocation && firstOpenStop?.lat != null && firstOpenStop?.lng != null
      ? {
          fromLat: planLocation.lat,
          fromLng: planLocation.lng,
          toLat: firstOpenStop.lat,
          toLng: firstOpenStop.lng,
        }
      : null;
  const { data: workLegData } = useGetRoadLeg(roadLegParams ?? { fromLat: 0, fromLng: 0, toLat: 0, toLng: 0 }, {
    query: {
      queryKey: getGetRoadLegQueryKey(
        roadLegParams ?? { fromLat: 0, fromLng: 0, toLat: 0, toLng: 0 },
      ),
      enabled: roadLegParams != null,
    },
  });
  const workLegKm = roadLegParams ? workLegData?.distanceKm ?? null : null;

  // Estimated drive distance for the day: the single work-location → first stop
  // road leg plus each SUBSEQUENT inter-stop leg. The server annotates each
  // route's first stop with a depot→first-stop distanceKmFromPrev, so we skip
  // it (routeIndex === 0) to avoid double-counting from the wrong origin.
  const estimatedDriveKm = useMemo(() => {
    let km = workLegKm ?? 0;
    for (const s of todayStops) {
      if (s.routeIndex === 0) continue;
      if (s.distanceKmFromPrev != null) km += s.distanceKmFromPrev;
    }
    return km;
  }, [todayStops, workLegKm]);

  // Elapsed field time (departedAt → endedAt or now), recomputed on a tick.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!dayPlan?.departedAt || dayPlan?.endedAt) return;
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [dayPlan?.departedAt, dayPlan?.endedAt]);
  const elapsedMs = dayPlan?.departedAt
    ? (dayPlan.endedAt ? new Date(dayPlan.endedAt).getTime() : nowTick) -
      new Date(dayPlan.departedAt).getTime()
    : null;

  // Log-as-mileage-expense dialog state.
  const createExpense = useCreateExpense();
  const [mileageDialogOpen, setMileageDialogOpen] = useState(false);
  const [mileageInput, setMileageInput] = useState("");
  const [loggingMileage, setLoggingMileage] = useState(false);

  const openMileageDialog = () => {
    const estMiles = estimatedDriveKm * 0.621371;
    setMileageInput(estMiles > 0 ? estMiles.toFixed(1) : "");
    setMileageDialogOpen(true);
  };

  const submitMileage = async () => {
    const miles = Number(mileageInput);
    if (!Number.isFinite(miles) || miles <= 0) {
      Alert.alert("Miles required", "Enter the number of miles driven.");
      return;
    }
    setLoggingMileage(true);
    try {
      await createExpense.mutateAsync({
        data: {
          entryType: "mileage",
          miles,
          expenseDate: selectedDate,
          description: "Field mileage — My Day",
        },
      });
      setMileageDialogOpen(false);
      Alert.alert("Mileage logged", `Added a draft mileage expense for ${formatDayLabel(selectedDate)}.`);
    } catch (e) {
      Alert.alert("Couldn't log mileage", e instanceof Error ? e.message : "Try again.");
    } finally {
      setLoggingMileage(false);
    }
  };

  // Group stops by route (for ETA pills / route headers, not for drag scoping)
  const stopsByRoute = new Map<number, TodayStop[]>();
  for (const s of todayStops) {
    const arr = stopsByRoute.get(s.routeId) ?? [];
    arr.push(s);
    stopsByRoute.set(s.routeId, arr);
  }

  // Live, synchronously-updated flat order during a drag. Reading React state
  // directly in `handleDragEnd` is unsafe because state updates are async and
  // the final swap may not have been committed yet.
  const liveFlatRef = useRef<FlatItem[]>([]);
  // Snapshot of the order at the moment a drag started so we can revert on
  // server error.
  const preDragFlatRef = useRef<FlatItem[] | null>(null);
  // Snapshot of "which route did each stop start on" so we can detect which
  // routes were actually changed and only commit those.
  const preDragRouteByStopRef = useRef<Map<number, number>>(new Map());

  // Undo state: snapshot of the flat order from before the most recent
  // drag, shown as a toast so the rep can revert. Captures all routes
  // touched by the drag so multi-route moves can be undone in one tap.
  const [undoState, setUndoState] = useState<{
    label: string;
    prevFlat: FlatItem[];
    routeIds: number[];
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearUndoTimer = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  };
  useEffect(() => {
    return () => clearUndoTimer();
  }, []);

  const handleDragStart = (key: string) => {
    setDraggingKey(key);
    const startFlat = effectiveFlat.map((it) => ({ ...it }));
    liveFlatRef.current = startFlat;
    preDragFlatRef.current = startFlat.map((it) => ({ ...it }));
    preDragRouteByStopRef.current = new Map(
      startFlat.map((it) => [it.stopId, it.routeId]),
    );
    setLocalFlat(startFlat);
  };

  const handleSwap = (key: string, dir: -1 | 1): boolean => {
    const stopId = Number(key.split(":")[1]);
    const current = liveFlatRef.current;
    const idx = current.findIndex((it) => it.stopId === stopId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= current.length) return false;

    const newFlat = [...current];
    const moving = newFlat[idx];
    const neighbor = newFlat[target];
    // Pending (queued) stops have no real server id yet, so they can't be
    // referenced in a reassign payload. Refuse to swap them in either
    // direction so the rep can't desync the drag order from the server.
    if (isPendingStopId(moving.stopId) || isPendingStopId(neighbor.stopId)) {
      return false;
    }
    // Swap positions, and adopt the neighbor's routeId so the moving stop
    // hops into the neighbor's route when crossing a route boundary.
    newFlat[idx] = { ...neighbor, routeId: moving.routeId };
    newFlat[target] = { ...moving, routeId: neighbor.routeId };

    liveFlatRef.current = newFlat;
    setLocalFlat(newFlat);
    return true;
  };

  const handleDragEnd = (_key: string) => {
    setDraggingKey(null);
    const live = liveFlatRef.current;
    const snapshot = preDragFlatRef.current;
    const startRoutes = preDragRouteByStopRef.current;
    liveFlatRef.current = [];
    preDragFlatRef.current = null;
    preDragRouteByStopRef.current = new Map();
    if (!snapshot || live.length === 0) return;

    // Determine which routes actually changed (membership or order).
    const routesTouched = new Set<number>();
    // Group live flat into per-route ordered stop ids.
    const liveGroups = new Map<number, number[]>();
    for (const it of live) {
      const arr = liveGroups.get(it.routeId) ?? [];
      arr.push(it.stopId);
      liveGroups.set(it.routeId, arr);
    }
    const snapGroups = new Map<number, number[]>();
    for (const it of snapshot) {
      const arr = snapGroups.get(it.routeId) ?? [];
      arr.push(it.stopId);
      snapGroups.set(it.routeId, arr);
    }
    for (const [routeId, ids] of liveGroups) {
      const before = snapGroups.get(routeId) ?? [];
      if (
        before.length !== ids.length ||
        before.some((id, i) => id !== ids[i])
      ) {
        routesTouched.add(routeId);
      }
    }
    // Also include routes that had stops dragged out entirely.
    for (const routeId of snapGroups.keys()) {
      if (!liveGroups.has(routeId)) routesTouched.add(routeId);
    }
    if (routesTouched.size === 0) {
      // Nothing changed, drop the optimistic override.
      setLocalFlat(null);
      return;
    }

    const touchedRouteIds = Array.from(routesTouched);
    // Filter out pending (queued) stop ids: the server doesn't know about
    // them yet, so the reassign payload must only describe the desired
    // ordering of real stops. The optimistic overlay re-attaches pending
    // stops on top of whatever the server returns.
    const groups = touchedRouteIds.map((routeId) => ({
      routeId,
      stopIds: (liveGroups.get(routeId) ?? []).filter((id) => !isPendingStopId(id)),
    }));

    // Snapshot the pre-drag flat order so the rep can undo this drag.
    const prevFlatSnapshot = snapshot.map((it) => ({ ...it }));
    const undoLabel =
      touchedRouteIds.length > 1
        ? `Moved across ${touchedRouteIds.length} routes`
        : `Reordered ${
            todayRoutes.find((r) => r.id === touchedRouteIds[0])?.name ?? "route"
          }`;
    setUndoState({
      label: undoLabel,
      prevFlat: prevFlatSnapshot,
      routeIds: touchedRouteIds,
    });
    clearUndoTimer();
    undoTimerRef.current = setTimeout(() => {
      setUndoState(null);
      undoTimerRef.current = null;
    }, 5000);

    // Mark startRoutes as used so eslint/no-unused-vars stays quiet.
    void startRoutes;

    // Snapshot the live (post-drag) flat order so we can re-queue it on
    // network failure and so an offline send carries the same payload.
    const liveSnapshot = live.map((it) => ({ ...it }));

    // If we already know we're offline, skip the doomed network round-trip
    // and queue immediately. The optimistic override stays in place.
    if (!isOnline) {
      queueReassignRouteStops({ groups, flat: liveSnapshot }).catch(() => {});
      return;
    }

    reassign.mutate(
      { data: { groups } },
      {
        onSuccess: async () => {
          // Wait for the refetch to land before clearing our optimistic
          // override so the UI doesn't snap back to the stale order.
          await queryClient.invalidateQueries({
            queryKey: getListRoutesQueryKey(),
            exact: false,
          });
          setLocalFlat(null);
        },
        onError: (err) => {
          if (isNetworkError(err)) {
            // Connectivity problem — keep the optimistic order and queue
            // the reassign so it replays automatically when we're back
            // online. The dedupe logic in the offline queue keeps only the
            // latest reassign payload.
            queueReassignRouteStops({ groups, flat: liveSnapshot })
              .then(() => triggerFlush())
              .catch(() => {});
            return;
          }
          // Real server-side rejection — revert to the pre-drag order.
          setLocalFlat(snapshot);
          // Clear it on next refetch tick to avoid a stuck override.
          setTimeout(() => setLocalFlat(null), 1500);
        },
      },
    );
  };

  const handleUndo = () => {
    if (!undoState) return;
    const { prevFlat, routeIds } = undoState;
    clearUndoTimer();
    setUndoState(null);
    // Build per-route stop id groups from the pre-drag flat snapshot, but
    // only for the routes actually touched by the undone drag.
    const prevGroups = new Map<number, number[]>();
    for (const it of prevFlat) {
      if (!routeIds.includes(it.routeId)) continue;
      const arr = prevGroups.get(it.routeId) ?? [];
      arr.push(it.stopId);
      prevGroups.set(it.routeId, arr);
    }
    const groups = routeIds.map((routeId) => ({
      routeId,
      stopIds: (prevGroups.get(routeId) ?? []).filter((id) => !isPendingStopId(id)),
    }));
    // Capture the current override so we can restore it if undo fails.
    const currentOverride = localFlat;
    // Optimistically restore the previous order locally.
    setLocalFlat(prevFlat);

    // Snapshot of the flat order we're trying to push to the server (the
    // pre-drag order, restricted to routes that were touched by the drag).
    const undoFlatSnapshot = prevFlat
      .filter((it) => routeIds.includes(it.routeId))
      .map((it) => ({ ...it }));

    if (!isOnline) {
      // Skip the doomed network round-trip and queue immediately. The
      // optimistically-restored order stays in place.
      queueReassignRouteStops({ groups, flat: undoFlatSnapshot }).catch(
        () => {},
      );
      return;
    }

    reassign.mutate(
      { data: { groups } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({
            queryKey: getListRoutesQueryKey(),
            exact: false,
          });
          setLocalFlat(null);
        },
        onError: (err) => {
          if (isNetworkError(err)) {
            // Keep the restored (undone) order and queue the undo for retry
            // when connectivity returns.
            queueReassignRouteStops({ groups, flat: undoFlatSnapshot })
              .then(() => triggerFlush())
              .catch(() => {});
            return;
          }
          // Server rejected the undo — roll back the local restore so the
          // UI reflects what's actually persisted on the server.
          setLocalFlat(currentOverride);
        },
      },
    );
  };

  const handleRemoveStop = (stopId: number, routeId: number, stopLabel: string) => {
    Alert.alert(
      "Remove stop?",
      `Remove "${stopLabel}" from your route? This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            // Optimistically hide the stop immediately.
            setLocalRemovedStopIds((prev) => new Set([...prev, stopId]));
            // Also drop from the drag-order override so it doesn't reappear
            // after a reorder while the DELETE is still in-flight.
            setLocalFlat((prev) =>
              prev ? prev.filter((it) => it.stopId !== stopId) : prev,
            );
            const queueDelete = () => {
              // Queue for replay; the applyPendingDeletes overlay keeps the
              // stop hidden (surviving reloads) until the delete lands.
              queueDeleteRouteStop({
                routeId,
                stopId,
                stopName: stopLabel,
                routeName: routeNameById.get(routeId) ?? null,
              })
                .then(() => triggerFlush())
                .catch(() => {});
              setLocalRemovedStopIds((prev) => {
                const next = new Set(prev);
                next.delete(stopId);
                return next;
              });
            };
            // Already offline: skip the doomed network call and queue at once.
            if (!isOnline) {
              queueDelete();
              return;
            }
            try {
              await deleteStop.mutateAsync({ id: routeId, stopId });
              await queryClient.invalidateQueries({
                queryKey: getListRoutesQueryKey(),
                exact: false,
              });
              // Remove from the "removed" set once server confirms — the
              // invalidated query will no longer include this stop anyway.
              setLocalRemovedStopIds((prev) => {
                const next = new Set(prev);
                next.delete(stopId);
                return next;
              });
            } catch (err) {
              if (isNetworkError(err)) {
                // Connectivity lost mid-request: queue for replay instead of
                // reverting, so the rep's intent isn't lost.
                queueDelete();
                return;
              }
              // Revert the optimistic removal so the stop comes back.
              setLocalRemovedStopIds((prev) => {
                const next = new Set(prev);
                next.delete(stopId);
                return next;
              });
              Alert.alert("Couldn't remove stop", "Please try again.");
            }
          },
        },
      ],
    );
  };

  const todayLabel = formatDayLabel(selectedDate);

  // Compact per-day work-location selector. Tapping the active chip clears it.
  const workLocationSelector = (
    <View style={[styles.workLocCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.workLocHeader}>
        <Text style={[styles.workLocTitle, { color: colors.mutedForeground }]}>Working from</Text>
        {!isOnline && (
          <Text style={[styles.workLocHint, { color: colors.mutedForeground }]}>Online only</Text>
        )}
      </View>
      <View style={styles.workLocChips}>
        {WORK_LOCATIONS.map((opt) => {
          const active = workLocation === opt.key;
          return (
            <Pressable
              key={opt.key}
              style={[
                styles.workLocChip,
                {
                  backgroundColor: active ? colors.primary : colors.muted,
                  borderColor: active ? colors.primary : colors.border,
                },
                (!isOnline || savingLocation) && { opacity: 0.5 },
              ]}
              onPress={() => setWorkLocation(opt.key)}
              disabled={!isOnline || savingLocation}
              testID={`work-loc-${opt.key}`}
            >
              <Feather
                name={opt.icon}
                size={12}
                color={active ? colors.primaryForeground : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.workLocChipText,
                  { color: active ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Inline site picker for office / warehouse days with more than one site. */}
      {sitePicker && (
        <View style={styles.workLocSitePicker}>
          <Text style={[styles.workLocSitePickerLabel, { color: colors.mutedForeground }]}>
            Which {sitePicker.key}?
          </Text>
          <View style={styles.workLocChips}>
            {sitePicker.options.map((s) => (
              <Pressable
                key={s.id}
                style={[styles.workLocChip, { backgroundColor: colors.muted, borderColor: colors.border }]}
                onPress={() => chooseSite(s)}
                disabled={savingLocation}
                testID={`work-loc-site-${s.id}`}
              >
                <Feather name="map-pin" size={12} color={colors.mutedForeground} />
                <Text style={[styles.workLocChipText, { color: colors.foreground }]} numberOfLines={1}>
                  {s.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Resolved location label for the current day plan, when available. */}
      {workLocation && dayPlan?.location?.label && (
        <View style={styles.workLocLabelRow}>
          <Feather name="map-pin" size={12} color={colors.mutedForeground} />
          <Text style={[styles.workLocLabelText, { color: colors.mutedForeground }]} numberOfLines={1}>
            {dayPlan.location.label}
          </Text>
        </View>
      )}

      {/* Gentle nudge when a home day has no geocoded address on file. */}
      {workLocation === "home" && dayPlan?.location == null && (
        <View style={styles.workLocLabelRow}>
          <Feather name="info" size={12} color={colors.mutedForeground} />
          <Text style={[styles.workLocLabelText, { color: colors.mutedForeground }]}>
            Add your home address in your profile so we can map it
          </Text>
        </View>
      )}

      <DayTimelineCard
        plan={dayPlan ?? null}
        colors={colors}
        isOnline={isOnline && isSelectedToday}
        markingEvent={markingEvent}
        onMark={markDay}
      />
    </View>
  );

  // Next-up service/install job banner (merged from the former My Day tab).
  const nextUpBanner = nextUp ? (
    <Pressable
      style={[styles.nextBanner, { backgroundColor: colors.primary }]}
      onPress={() => router.push(`/service/${nextUp.id}` as never)}
      testID={`next-up-${nextUp.id}`}
    >
      <Text style={styles.nextLabel}>Next up</Text>
      <Text style={styles.nextTitle}>{nextUp.summary ?? `Job #${nextUp.id}`}</Text>
      <Text style={styles.nextSub}>
        {nextUp.customerName ?? "—"} •{" "}
        {fmtWindow(
          nextUp.scheduledWindowStart as unknown as string,
          nextUp.scheduledWindowEnd as unknown as string,
        )}
      </Text>
      {nextUpDrive && (
        <View style={styles.nextDrivePill}>
          <Feather name="navigation-2" size={11} color={colors.primaryForeground} />
          <Text style={styles.nextDriveText}>
            ~{fmtDrive(nextUpDrive.mins)} · {nextUpDrive.km} km away
          </Text>
        </View>
      )}
      <Pressable
        style={styles.nextNavBtn}
        onPress={() =>
          openNav({
            address: nextUp.location,
            lat: nextUp.customerLat,
            lng: nextUp.customerLng,
            label: nextUp.customerName,
          })
        }
        testID="btn-navigate-next"
      >
        <Feather name="navigation" size={16} color={colors.primaryForeground} />
        <Text style={styles.nextNavText}>Navigate to next job</Text>
      </Pressable>
    </Pressable>
  ) : null;

  // Selected day's schedule + unscheduled sections (merged from the former My Day tab).
  const scheduleSections = canSeeService ? (
    <>
      <View style={styles.scheduleSection}>
        <Text style={[styles.scheduleSectionTitle, { color: colors.mutedForeground }]}>
          {isSelectedToday ? "Today's schedule" : "Selected day schedule"}
        </Text>
        {serviceLoading ? (
          <View style={{ padding: 24, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : todays.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={isSelectedToday ? "Nothing scheduled today" : "Nothing scheduled this day"}
            subtitle="Dispatch hasn't put any jobs on this day yet."
          />
        ) : (
          todays.map((j) => <ScheduleRow key={j.id} job={j} colors={colors} />)
        )}
      </View>
      {unscheduled.length > 0 && (
        <View style={styles.scheduleSection}>
          <Text style={[styles.scheduleSectionTitle, { color: colors.mutedForeground }]}>
            Unscheduled ({unscheduled.length})
          </Text>
          {unscheduled.map((j) => (
            <ScheduleRow key={j.id} job={j} colors={colors} />
          ))}
        </View>
      )}
    </>
  ) : null;


  // Field time & mileage summary — shown once the rep has headed out for the
  // day. Drive distance is an estimate (work→first stop road leg + inter-stop
  // legs) so we label it as such; miles can be logged as a draft expense.
  const fieldTimeCard = dayPlan?.departedAt ? (
    <View style={[styles.fieldTimeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.fieldTimeTitle, { color: colors.mutedForeground }]}>Field time &amp; mileage</Text>
      <View style={styles.fieldTimeStatsRow}>
        <View style={styles.fieldTimeStat}>
          <Feather name="clock" size={14} color={colors.mutedForeground} />
          <Text style={[styles.fieldTimeValue, { color: colors.foreground }]}>
            {elapsedMs != null ? fmtElapsed(elapsedMs) : "—"}
          </Text>
          <Text style={[styles.fieldTimeLabel, { color: colors.mutedForeground }]}>
            {dayPlan.endedAt ? "in the field" : "so far"}
          </Text>
        </View>
        <View style={styles.fieldTimeStat}>
          <Feather name="navigation" size={14} color={colors.mutedForeground} />
          <Text style={[styles.fieldTimeValue, { color: colors.foreground }]}>
            {formatDistance(estimatedDriveKm, distanceUnit) ?? "—"}
          </Text>
          <Text style={[styles.fieldTimeLabel, { color: colors.mutedForeground }]}>estimated</Text>
        </View>
      </View>
      <Pressable
        style={[styles.fieldTimeBtn, { backgroundColor: colors.primary }, !isOnline && { opacity: 0.5 }]}
        onPress={openMileageDialog}
        disabled={!isOnline}
        testID="btn-log-mileage"
      >
        <Feather name="plus" size={14} color={colors.primaryForeground} />
        <Text style={[styles.fieldTimeBtnText, { color: colors.primaryForeground }]}>
          Log as mileage expense
        </Text>
      </Pressable>
      {!isOnline && (
        <Text style={[styles.fieldTimeLabel, { color: colors.mutedForeground, marginTop: 8, textAlign: "center" }]}>
          Logging mileage needs a connection
        </Text>
      )}
    </View>
  ) : null;

  const mileageDialog = (
    <Modal
      visible={mileageDialogOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setMileageDialogOpen(false)}
    >
      <Pressable
        style={styles.mileageBackdrop}
        onPress={() => !loggingMileage && setMileageDialogOpen(false)}
      >
        <Pressable
          style={[styles.mileageDialog, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => {}}
        >
          <Text style={[styles.mileageDialogTitle, { color: colors.foreground }]}>Log mileage</Text>
          <Text style={[styles.mileageDialogSub, { color: colors.mutedForeground }]}>
            Reimbursed at your company rate once submitted.
          </Text>
          <TextInput
            style={[
              styles.mileageInput,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.muted },
            ]}
            value={mileageInput}
            onChangeText={setMileageInput}
            keyboardType="decimal-pad"
            placeholder="Miles"
            placeholderTextColor={colors.mutedForeground}
            editable={!loggingMileage}
            testID="mileage-input"
          />
          <View style={styles.mileageActions}>
            <Pressable
              style={[styles.mileageBtn, { borderColor: colors.border }]}
              onPress={() => setMileageDialogOpen(false)}
              disabled={loggingMileage}
            >
              <Text style={[styles.mileageBtnText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.mileageBtn, styles.mileageBtnPrimary, { backgroundColor: colors.primary }]}
              onPress={submitMileage}
              disabled={loggingMileage}
              testID="btn-confirm-mileage"
            >
              {loggingMileage ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.mileageBtnText, { color: colors.primaryForeground }]}>Log expense</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );

  if (total === 0) {
    return (
      <>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 80, paddingHorizontal: 16, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {workLocationSelector}
          {nextUpBanner}
          {fieldTimeCard}
          <View style={[styles.todayHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.todayHeaderTopRow}>
              <Text style={[styles.todayDate, { color: colors.mutedForeground }]}>{todayLabel}</Text>
              {canEditRoutes && (
                <View style={styles.addStopBtnRow}>
                  <Pressable
                    style={[styles.addStopBtn, { backgroundColor: colors.muted }]}
                    onPress={() => openAddStop("location")}
                    testID="btn-add-meeting"
                  >
                    <Feather name="calendar" size={13} color={colors.primary} />
                    <Text style={[styles.addStopBtnText, { color: colors.primary }]}>Meeting / event</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.addStopBtn, { backgroundColor: colors.primary }]}
                    onPress={() => openAddStop("customer")}
                    testID="btn-add-stop"
                  >
                    <Feather name="plus" size={13} color="#fff" />
                    <Text style={styles.addStopBtnText}>Add Stop</Text>
                  </Pressable>
                </View>
              )}
            </View>
            <Text style={[styles.todayTitle, { color: colors.foreground }]}>
              {isSelectedToday ? "No stops today" : "No stops this day"}
            </Text>
            <Text style={[styles.todaySub, { color: colors.mutedForeground }]}>
              No routes are scheduled for {isSelectedToday ? "today" : formatDayLabel(selectedDate)}.
            </Text>
          </View>
          <PlanMyDayCard colors={colors} selectedDate={selectedDate} />
          {scheduleSections}
        </ScrollView>
        {mileageDialog}
        <AddStopModal
          visible={addStopOpen}
          onClose={() => setAddStopOpen(false)}
          routes={todayRoutes}
          selectedDate={selectedDate}
          colors={colors}
          insets={insets}
          initialMode={addStopMode}
        />
        <EditCustomStopModal
          target={editStopTarget}
          onClose={() => setEditStopTarget(null)}
          colors={colors}
          insets={insets}
        />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: insets.bottom + 80, paddingHorizontal: 16, paddingTop: 12 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {workLocationSelector}
      {nextUpBanner}
      {fieldTimeCard}
      {total > 0 && checkedCount === total && (
        <DaySummaryCard
          stops={todayStops}
          routeCount={todayRoutes.length}
          todayLabel={todayLabel}
          colors={colors}
        />
      )}
      <View style={[styles.todayHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.todayHeaderTopRow}>
          <Text style={[styles.todayDate, { color: colors.mutedForeground }]}>{todayLabel}</Text>
          {canEditRoutes && (
            <View style={styles.addStopBtnRow}>
              <Pressable
                style={[styles.addStopBtn, { backgroundColor: colors.muted }]}
                onPress={() => openAddStop("location")}
                testID="btn-add-meeting"
              >
                <Feather name="calendar" size={13} color={colors.primary} />
                <Text style={[styles.addStopBtnText, { color: colors.primary }]}>Meeting / event</Text>
              </Pressable>
              <Pressable
                style={[styles.addStopBtn, { backgroundColor: colors.primary }]}
                onPress={() => openAddStop("customer")}
                testID="btn-add-stop"
              >
                <Feather name="plus" size={13} color="#fff" />
                <Text style={styles.addStopBtnText}>Add Stop</Text>
              </Pressable>
            </View>
          )}
        </View>
        <View style={styles.todayProgressRow}>
          <Text style={[styles.todayTitle, { color: colors.foreground }]}>
            {checkedCount} of {total} stops
          </Text>
          <Text style={[styles.todayPct, { color: colors.primary }]}>{pct}%</Text>
        </View>
        <View style={[styles.progressBarBg, { backgroundColor: colors.muted }]}>
          <View
            style={[
              styles.progressBarFill,
              {
                backgroundColor: pct === 100 ? "#16a34a" : colors.primary,
                width: `${pct}%`,
              },
            ]}
          />
        </View>
        <Text style={[styles.todaySub, { color: colors.mutedForeground, marginTop: 8 }]}>
          {todayRoutes.length} route{todayRoutes.length !== 1 ? "s" : ""} ·{" "}
          {total - checkedCount} remaining
        </Text>
      </View>

      {canEditRoutes &&
        todayRoutes
          .filter(
            (r) =>
              (r.stops ?? []).filter((s) => !isPendingStopId(s.id) && stopCoords(s) != null)
                .length >= 2,
          )
          .map((r) => {
            const busy = optimizingRouteId === r.id;
            return (
              <Pressable
                key={`optimize-${r.id}`}
                style={[
                  styles.optimizeBtn,
                  { borderColor: colors.primary, backgroundColor: colors.card },
                  (busy || !isOnline) && { opacity: 0.6 },
                ]}
                onPress={() => optimizeRoute(r)}
                disabled={busy || !isOnline}
                testID={`btn-optimize-${r.id}`}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name="shuffle" size={14} color={colors.primary} />
                )}
                <Text style={[styles.optimizeBtnText, { color: colors.primary }]}>
                  {busy
                    ? "Optimizing…"
                    : todayRoutes.length > 1
                      ? `Best order · ${r.name}`
                      : "Best route order"}
                </Text>
              </Pressable>
            );
          })}

      <Text style={[styles.dragHint, { color: colors.mutedForeground }]}>
        Tip: long-press a stop to drag — drop it into another route to move it
      </Text>
      <View style={styles.todayList}>
        {todayStops.map((stop, idx) => {
          const isNext = stop.id === nextStopId;
          const isChecked = !!stop.checkedInAt;
          const hasLocation = (stop.lat != null && stop.lng != null) || stop.customerAddress;
          const rowKey = `${stop.routeId}:${stop.id}`;
          const isDragging = draggingKey === rowKey;
          const prevStop = idx > 0 ? todayStops[idx - 1] : null;
          const showRouteDivider = !prevStop || prevStop.routeId !== stop.routeId;
          return (
            <React.Fragment key={rowKey}>
              {showRouteDivider && todayRoutes.length > 1 && (
                <View style={[styles.routeDivider, { backgroundColor: colors.muted }]}>
                  <Feather name="map" size={11} color={colors.mutedForeground} />
                  <Text style={[styles.routeDividerText, { color: colors.mutedForeground }]}>
                    {stop.routeName}
                  </Text>
                </View>
              )}
            <DragRow
              rowKey={rowKey}
              totalCount={total}
              isDraggable={!isPendingStopId(stop.id)}
              draggingKey={draggingKey}
              onDragStart={handleDragStart}
              onSwap={handleSwap}
              onDragEnd={handleDragEnd}
            >
            <View
              style={[
                styles.todayCard,
                {
                  backgroundColor: colors.card,
                  borderColor: isDragging ? colors.primary : isNext ? colors.primary : colors.border,
                  borderWidth: isDragging || isNext ? 1.5 : 1,
                },
              ]}
            >
              <View style={styles.todayCardTop}>
                <View
                  style={[
                    styles.todayBadge,
                    {
                      backgroundColor: isChecked
                        ? "#16a34a"
                        : isNext
                          ? colors.primary
                          : colors.muted,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.todayBadgeText,
                      { color: isChecked || isNext ? "#fff" : colors.mutedForeground },
                    ]}
                  >
                    {isChecked ? "✓" : (idx + 1).toString()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  {stop.kind === "prospect" ? (
                    <Pressable
                      onPress={() =>
                        stop.prospectId != null &&
                        router.push({ pathname: "/prospect/[id]", params: { id: stop.prospectId } })
                      }
                    >
                      <Text style={[styles.todayCustomer, { color: colors.foreground }]}>
                        {stop.prospectName ?? `Prospect ${stop.prospectId}`}
                        <Text style={{ color: "#d97706" }}>  · Prospect</Text>
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      disabled={stop.customerId == null}
                      onPress={() =>
                        stop.customerId != null &&
                        router.push({ pathname: "/customer/[id]", params: { id: stop.customerId } })
                      }
                    >
                      <Text style={[styles.todayCustomer, { color: colors.foreground }]}>
                        {stop.customerName ?? (stop.customerId != null ? `Customer ${stop.customerId}` : "Stop")}
                        {stop.kind === "custom" && (
                          <Text style={{ color: colors.mutedForeground }}>  · Stop</Text>
                        )}
                      </Text>
                    </Pressable>
                  )}
                  <Text style={[styles.todayRouteName, { color: colors.mutedForeground }]}>
                    {stop.routeName}
                  </Text>
                  {(stop.customerCity || stop.customerState || stop.customerAddress) && (
                    <Text style={[styles.todayAddr, { color: colors.mutedForeground }]}>
                      {[stop.customerAddress, stop.customerCity, stop.customerState]
                        .filter(Boolean)
                        .join(", ")}
                    </Text>
                  )}
                  <View style={styles.todayMetaRow}>
                    {isChecked ? (
                      <View style={[styles.todayMetaPill, { backgroundColor: "#16a34a20" }]}>
                        <Feather name="check-circle" size={10} color="#16a34a" />
                        <Text style={[styles.todayMetaText, { color: "#16a34a" }]}>
                          Checked in{" "}
                          {new Date(stop.checkedInAt!).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </Text>
                      </View>
                    ) : isNext ? (
                      <View style={[styles.todayMetaPill, { backgroundColor: colors.primary + "20" }]}>
                        <View style={[styles.nextStopDot, { backgroundColor: colors.primary }]} />
                        <Text style={[styles.todayMetaText, { color: colors.primary }]}>Up next</Text>
                      </View>
                    ) : null}
                    {stop.estimatedMinutesFromPrev != null && stop.routeIndex > 0 && !isChecked && (
                      <View style={[styles.todayMetaPill, { backgroundColor: colors.muted }]}>
                        <Feather name="clock" size={10} color={colors.mutedForeground} />
                        <Text style={[styles.todayMetaText, { color: colors.mutedForeground }]}>
                          ~{stop.estimatedMinutesFromPrev} min
                          {stop.distanceKmFromPrev != null
                            ? ` · ${formatDistance(stop.distanceKmFromPrev, distanceUnit)}`
                            : ""}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
              <View style={styles.todayActions}>
                {hasLocation && (
                  <Pressable
                    style={[styles.todayActionBtn, { backgroundColor: colors.muted }]}
                    onPress={() => openDirections(stop)}
                  >
                    <Feather name="navigation" size={13} color={colors.primary} />
                    <Text style={[styles.todayActionText, { color: colors.primary }]}>
                      Directions
                    </Text>
                  </Pressable>
                )}
                {!isChecked && !isPendingStopId(stop.id) && canCheckIn && (
                  <Pressable
                    style={[styles.todayActionBtn, { backgroundColor: colors.primary, flex: 1 }]}
                    onPress={() => checkIn.mutate({ id: stop.routeId, stopId: stop.id, customerName: stop.customerName ?? null, routeName: stop.routeName })}
                    disabled={checkIn.isPending}
                  >
                    <Feather name="check" size={13} color="#fff" />
                    <Text style={[styles.todayActionText, { color: "#fff" }]}>Check In</Text>
                  </Pressable>
                )}
                {!isChecked && isPendingStopId(stop.id) && (
                  <View
                    style={[
                      styles.todayActionBtn,
                      { backgroundColor: colors.muted, flex: 1 },
                    ]}
                  >
                    <Feather name="upload-cloud" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.todayActionText, { color: colors.mutedForeground }]}>
                      Will sync when online
                    </Text>
                  </View>
                )}
                {stop.kind === "custom" && !isPendingStopId(stop.id) && (
                  <Pressable
                    style={[
                      styles.todayActionBtn,
                      { backgroundColor: colors.muted, paddingHorizontal: 10 },
                    ]}
                    onPress={() =>
                      setEditStopTarget({
                        routeId: stop.routeId,
                        stopId: stop.id,
                        name: stop.customerName ?? "",
                        address: stop.customerAddress ?? null,
                      })
                    }
                    hitSlop={6}
                    accessibilityLabel="Edit stop"
                    testID={`edit-custom-stop-${stop.id}`}
                  >
                    <Feather name="edit-2" size={13} color={colors.mutedForeground} />
                  </Pressable>
                )}
                {!isChecked && !isPendingStopId(stop.id) && (
                  <Pressable
                    style={[
                      styles.todayActionBtn,
                      { backgroundColor: colors.muted, paddingHorizontal: 10 },
                    ]}
                    onPress={() =>
                      handleRemoveStop(
                        stop.id,
                        stop.routeId,
                        stop.customerName ?? `Stop #${stop.id}`,
                      )
                    }
                    disabled={deleteStop.isPending}
                    hitSlop={6}
                    accessibilityLabel="Remove stop"
                  >
                    <Feather name="trash-2" size={13} color={colors.mutedForeground} />
                  </Pressable>
                )}
              </View>
            </View>
            </DragRow>
            </React.Fragment>
          );
        })}
      </View>
      {scheduleSections}
    </ScrollView>
      {undoState && (
        <View
          style={[
            styles.undoToast,
            {
              backgroundColor: colors.foreground,
              bottom: insets.bottom + 88,
            },
          ]}
          pointerEvents="box-none"
        >
          <Feather name="rotate-ccw" size={14} color={colors.background} />
          <Text style={[styles.undoToastText, { color: colors.background }]} numberOfLines={1}>
            {undoState.label}
          </Text>
          <Pressable onPress={handleUndo} style={styles.undoToastBtn} hitSlop={10}>
            <Text style={[styles.undoToastBtnText, { color: colors.primary }]}>Undo</Text>
          </Pressable>
        </View>
      )}
      <View
        style={[styles.nearbyTrayDock, { bottom: insets.bottom + 12 }]}
        pointerEvents="box-none"
      >
        <ActiveRouteNearbyTray targetRoute={nearbyTargetRoute} />
      </View>
      {mileageDialog}
      <AddStopModal
        visible={addStopOpen}
        onClose={() => setAddStopOpen(false)}
        routes={todayRoutes}
        selectedDate={selectedDate}
        colors={colors}
        insets={insets}
        initialMode={addStopMode}
      />
      <EditCustomStopModal
        target={editStopTarget}
        onClose={() => setEditStopTarget(null)}
        colors={colors}
        insets={insets}
      />
    </View>
  );
}

function routeMapTotals(route: CustomerRoute) {
  const stops = (route.stops ?? []) as StopWithEta[];
  let totalKm = 0;
  let totalMin = 0;
  let remainingKm = 0;
  let remainingMin = 0;
  for (let i = 1; i < stops.length; i++) {
    const km = stops[i].distanceKmFromPrev ?? 0;
    const min = stops[i].estimatedMinutesFromPrev ?? 0;
    totalKm += km;
    totalMin += min;
    if (!stops[i].checkedInAt) {
      remainingKm += km;
      remainingMin += min;
    }
  }
  return { totalKm, totalMin, remainingKm, remainingMin };
}

function formatMapMinutes(m: number): string {
  const mins = Math.round(m);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

function formatMapKm(km: number, unit: DistanceUnit): string {
  return formatDistance(km, unit) ?? "";
}

function RouteMapView({
  routes,
  selectedDate,
  colors,
  insets,
}: {
  routes: CustomerRoute[];
  selectedDate: string;
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
}) {
  const router = useRouter();
  const checkIn = useOfflineCheckIn();
  const { canDo } = usePermissions();
  const canCheckIn = selectedDate === dateKey() && canDo("routes.edit");
  const distanceUnit = useDistanceUnit();
  const { isOnline } = useOffline();

  // The selected day's plan gives us the work-from location pin + a routing anchor.
  const mapPlanDate = selectedDate;
  const mapPlanParams = { date: mapPlanDate };
  const { data: mapDayPlan } = useGetMyDayPlan(mapPlanParams, {
    query: { queryKey: getGetMyDayPlanQueryKey(mapPlanParams), enabled: isOnline },
  });
  const planLocation = mapDayPlan?.location ?? null;

  const [selectedStop, setSelectedStop] = useState<SelectedStop | null>(null);
  // Custom stop currently being edited from the map sheet, or null.
  const [mapEditTarget, setMapEditTarget] = useState<{
    routeId: number;
    stopId: number;
    name: string;
    address: string | null;
  } | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const sheetExpandedRef = useRef(false);
  sheetExpandedRef.current = sheetExpanded;
  const slideAnim = useRef(new RNAnimated.Value(0)).current;

  // The tab bar is absolutely positioned (translucent glass on iOS), so the
  // sheet must sit ABOVE it or the bottom of the card gets masked.
  const tabBarOffset = Platform.OS === "web" ? 84 : 56 + insets.bottom;

  // Swipe up on the card to expand it for more detail; swipe down to
  // collapse, then dismiss.
  const sheetPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_evt, g) => {
        if (g.dy < -24) {
          setSheetExpanded(true);
        } else if (g.dy > 24) {
          if (sheetExpandedRef.current) setSheetExpanded(false);
          else setSelectedStop(null);
        }
      },
    }),
  ).current;

  const allStops: SelectedStop[] = routes.flatMap((route) =>
    (route.stops ?? []).map((stop) => ({ ...(stop as StopWithEta), routeId: route.id, routeName: route.name }))
  );
  const stopsWithCoords = allStops.filter((s) => s.lat != null && s.lng != null);

  // First not-checked-in stop with coordinates (in stop order) — the leg we
  // draw from the work location and summarise in the map strip.
  const orderedStops = routes.flatMap((route) =>
    ((route.stops ?? []) as StopWithEta[])
      .slice()
      .sort((a, b) => a.stopOrder - b.stopOrder),
  );
  const mapFirstOpenStop = orderedStops.find(
    (s) => !s.checkedInAt && s.lat != null && s.lng != null,
  );
  const mapLegParams =
    planLocation && mapFirstOpenStop?.lat != null && mapFirstOpenStop?.lng != null
      ? {
          fromLat: planLocation.lat,
          fromLng: planLocation.lng,
          toLat: mapFirstOpenStop.lat,
          toLng: mapFirstOpenStop.lng,
        }
      : null;
  const { data: mapLeg } = useGetRoadLeg(
    mapLegParams ?? { fromLat: 0, fromLng: 0, toLat: 0, toLng: 0 },
    {
      query: {
        queryKey: getGetRoadLegQueryKey(
          mapLegParams ?? { fromLat: 0, fromLng: 0, toLat: 0, toLng: 0 },
        ),
        enabled: mapLegParams != null,
      },
    },
  );
  // Geometry for the dashed work→first-stop polyline (falls back to a straight
  // line between the two points when routing is unavailable).
  const workLegCoords =
    mapLegParams && mapFirstOpenStop
      ? mapLeg?.geometry && mapLeg.geometry.length > 1
        ? mapLeg.geometry.map((pt) => ({ latitude: pt[0], longitude: pt[1] }))
        : [
            { latitude: planLocation!.lat, longitude: planLocation!.lng },
            { latitude: mapFirstOpenStop.lat!, longitude: mapFirstOpenStop.lng! },
          ]
      : null;

  const center =
    stopsWithCoords.length > 0
      ? {
          latitude: stopsWithCoords.reduce((s, p) => s + p.lat!, 0) / stopsWithCoords.length,
          longitude: stopsWithCoords.reduce((s, p) => s + p.lng!, 0) / stopsWithCoords.length,
          latitudeDelta: 2.5,
          longitudeDelta: 2.5,
        }
      : { latitude: 39.5, longitude: -98.35, latitudeDelta: 20, longitudeDelta: 20 };

  useEffect(() => {
    if (selectedStop) {
      RNAnimated.spring(slideAnim, { toValue: 1, useNativeDriver: true, tension: 100, friction: 12 }).start();
    } else {
      RNAnimated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
    setSheetExpanded(false);
  }, [selectedStop]);

  const sheetTranslate = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [240, 0] });

  const handleCheckIn = () => {
    if (!selectedStop) return;
    checkIn.mutate(
      {
        id: selectedStop.routeId,
        stopId: selectedStop.id,
        customerName: selectedStop.customerName ?? null,
        routeName: selectedStop.routeName,
      },
      { onSuccess: () => setSelectedStop(null) },
    );
  };

  const ROUTE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

  const routeSummaries = routes.map((route, idx) => ({
    id: route.id,
    name: route.name,
    color: ROUTE_COLORS[idx % ROUTE_COLORS.length],
    stopCount: (route.stops ?? []).length,
    checkedCount: (route.stops ?? []).filter((s) => s.checkedInAt).length,
    ...routeMapTotals(route),
  }));
  const summariesWithDistance = routeSummaries.filter((s) => s.totalKm > 0);

  return (
    <View style={{ flex: 1 }}>
      {stopsWithCoords.length === 0 ? (
        <View style={[styles.center, { backgroundColor: colors.background }]}>
          <Feather name="map-pin" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, marginTop: 12 }]}>No mapped stops</Text>
          <Text style={[styles.emptyMsg, { color: colors.mutedForeground }]}>
            Add coordinates to your customers to see them on the map.
          </Text>
        </View>
      ) : (
        <>
          <MapView
            style={{ flex: 1 }}
            provider={PROVIDER_DEFAULT}
            initialRegion={center}
            onPress={() => setSelectedStop(null)}
          >
            {/* Dashed leg from the work-from location to the first open stop. */}
            {workLegCoords && (
              <Polyline
                coordinates={workLegCoords}
                strokeColor="#64748b"
                strokeWidth={3}
                lineDashPattern={[4, 6]}
              />
            )}
            {/* Distinct work-from-location marker (home / office). */}
            {planLocation && (
              <Marker
                coordinate={{ latitude: planLocation.lat, longitude: planLocation.lng }}
                title={planLocation.label}
                onPress={(e) => {
                  e.stopPropagation?.();
                }}
              >
                <View style={[styles.workLocMapPin, { backgroundColor: "#0f766e", borderColor: "#fff" }]}>
                  <Feather
                    name={mapDayPlan?.workLocation === "home" ? "home" : "briefcase"}
                    size={13}
                    color="#fff"
                  />
                </View>
              </Marker>
            )}
            {routes.map((route, routeIdx) => {
              const color = ROUTE_COLORS[routeIdx % ROUTE_COLORS.length];
              const routeStops = (route.stops ?? []).filter((s) => s.lat != null && s.lng != null);
              const segments: { coords: { latitude: number; longitude: number }[]; completed: boolean; key: string }[] = [];
              for (let i = 0; i < routeStops.length - 1; i++) {
                const a = routeStops[i];
                const b = routeStops[i + 1];
                const coords =
                  b.geometryFromPrev && b.geometryFromPrev.length > 1
                    ? b.geometryFromPrev.map((pt) => ({ latitude: pt[0], longitude: pt[1] }))
                    : [
                        { latitude: a.lat!, longitude: a.lng! },
                        { latitude: b.lat!, longitude: b.lng! },
                      ];
                segments.push({
                  coords,
                  completed: !!a.checkedInAt && !!b.checkedInAt,
                  key: `${route.id}-seg-${i}`,
                });
              }
              return (
                <React.Fragment key={`route-${route.id}`}>
                  {segments.map((seg) => (
                    <Polyline
                      key={seg.key}
                      coordinates={seg.coords}
                      strokeColor={seg.completed ? "#9ca3af" : color}
                      strokeWidth={seg.completed ? 3 : 4}
                      lineDashPattern={seg.completed ? [6, 8] : undefined}
                    />
                  ))}
                  {routeStops.map((stop, stopIdx) => {
                  const isChecked = !!stop.checkedInAt;
                  return (
                    <Marker
                      key={stop.id}
                      coordinate={{ latitude: stop.lat!, longitude: stop.lng! }}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setSelectedStop({ ...(stop as StopWithEta), routeId: route.id, routeName: route.name });
                      }}
                    >
                      <View style={[
                        styles.mapPin,
                        { backgroundColor: isChecked ? "#6b7280" : color, borderColor: "#fff" }
                      ]}>
                        <Text style={styles.mapPinText}>
                          {isChecked ? "✓" : (stopIdx + 1).toString()}
                        </Text>
                      </View>
                    </Marker>
                  );
                })}
                </React.Fragment>
              );
            })}
          </MapView>

          {(summariesWithDistance.length > 0 ||
            (mapLegParams && mapLeg?.distanceKm != null)) && (
            <View
              style={[
                styles.mapSummaryOverlay,
                {
                  top: insets.top + 12,
                  backgroundColor: colors.card + "f2",
                  borderColor: colors.border,
                },
              ]}
              pointerEvents="box-none"
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.mapSummaryContent}
              >
                {mapLegParams && mapLeg?.distanceKm != null && planLocation && (
                  <View style={styles.mapSummaryItem}>
                    <View style={styles.mapSummaryHeader}>
                      <View style={[styles.mapSummaryDot, { backgroundColor: "#0f766e" }]} />
                      <Text
                        style={[styles.mapSummaryName, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        From {planLocation.label}
                      </Text>
                    </View>
                    <Text style={[styles.mapSummaryTotal, { color: colors.foreground }]}>
                      {formatMapKm(mapLeg.distanceKm, distanceUnit)}
                      {mapLeg.durationMin != null
                        ? ` · ${formatMapMinutes(mapLeg.durationMin)}`
                        : ""}
                    </Text>
                    <Text style={[styles.mapSummaryRemaining, { color: colors.mutedForeground }]}>
                      to first stop
                    </Text>
                  </View>
                )}
                {summariesWithDistance.map((s, i) => {
                  const leadingBorder = i > 0 || (mapLegParams && mapLeg?.distanceKm != null);
                  const allDone = s.stopCount > 0 && s.checkedCount === s.stopCount;
                  const hasRemaining = s.remainingKm > 0 && s.remainingKm < s.totalKm;
                  return (
                    <View
                      key={s.id}
                      style={[
                        styles.mapSummaryItem,
                        leadingBorder && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border, paddingLeft: 10, marginLeft: 4 },
                      ]}
                    >
                      <View style={styles.mapSummaryHeader}>
                        <View style={[styles.mapSummaryDot, { backgroundColor: s.color }]} />
                        <Text style={[styles.mapSummaryName, { color: colors.foreground }]} numberOfLines={1}>
                          {s.name}
                        </Text>
                      </View>
                      <Text style={[styles.mapSummaryTotal, { color: colors.foreground }]}>
                        {formatMapKm(s.totalKm, distanceUnit)} · {formatMapMinutes(s.totalMin)}
                      </Text>
                      {hasRemaining ? (
                        <Text style={[styles.mapSummaryRemaining, { color: colors.mutedForeground }]}>
                          {formatMapKm(s.remainingKm, distanceUnit)} · {formatMapMinutes(s.remainingMin)} left
                        </Text>
                      ) : allDone ? (
                        <Text style={[styles.mapSummaryRemaining, { color: "#16a34a" }]}>Complete</Text>
                      ) : (
                        <Text style={[styles.mapSummaryRemaining, { color: colors.mutedForeground }]}>
                          {s.checkedCount}/{s.stopCount} done
                        </Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {selectedStop && (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setSelectedStop(null)}
              pointerEvents={selectedStop ? "box-none" : "none"}
            />
          )}

          <RNAnimated.View
            {...sheetPan.panHandlers}
            style={[
              styles.bottomSheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                transform: [{ translateY: sheetTranslate }],
                bottom: tabBarOffset,
                borderBottomLeftRadius: 20,
                borderBottomRightRadius: 20,
                borderBottomWidth: 1,
                paddingBottom: 12,
              },
            ]}
            pointerEvents={selectedStop ? "auto" : "none"}
          >
            {selectedStop && (
              <>
                <Pressable onPress={() => setSheetExpanded((v) => !v)} hitSlop={12}>
                  <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
                </Pressable>
                <View style={styles.sheetHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sheetRouteName, { color: colors.mutedForeground }]}>
                      {selectedStop.routeName}
                    </Text>
                    <Text style={[styles.sheetCustomerName, { color: colors.foreground }]}>
                      {selectedStop.kind === "prospect"
                        ? (selectedStop.prospectName ?? `Prospect ${selectedStop.prospectId}`)
                        : (selectedStop.customerName ?? `Customer ${selectedStop.customerId}`)}
                      {selectedStop.kind === "prospect" && (
                        <Text style={{ color: "#d97706" }}>  · Prospect</Text>
                      )}
                    </Text>
                    {(selectedStop.customerAddress || selectedStop.customerCity) && (
                      <Text style={[styles.sheetAddr, { color: colors.mutedForeground }]}>
                        {[selectedStop.customerAddress, selectedStop.customerCity, selectedStop.customerState]
                          .filter(Boolean)
                          .join(", ")}
                      </Text>
                    )}
                    {selectedStop.checkedInAt && (
                      <Text style={[styles.checkedInLabel, { color: colors.primary }]}>
                        Checked in {new Date(selectedStop.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    )}
                  </View>
                  <Pressable onPress={() => setSelectedStop(null)}>
                    <Feather name="x" size={18} color={colors.mutedForeground} />
                  </Pressable>
                </View>

                {sheetExpanded && (
                  <View style={[styles.sheetDetails, { borderColor: colors.border }]}>
                    {(() => {
                      const route = routes.find((r) => r.id === selectedStop.routeId);
                      const stops = ((route?.stops ?? []) as StopWithEta[]).slice().sort((a, b) => a.stopOrder - b.stopOrder);
                      const pos = stops.findIndex((st) => st.id === selectedStop.id);
                      return (
                        <>
                          {pos >= 0 && (
                            <View style={styles.sheetDetailRow}>
                              <Feather name="flag" size={13} color={colors.mutedForeground} />
                              <Text style={[styles.sheetDetailText, { color: colors.foreground }]}>
                                Stop {pos + 1} of {stops.length} on {selectedStop.routeName}
                              </Text>
                            </View>
                          )}
                          {selectedStop.distanceKmFromPrev != null && selectedStop.distanceKmFromPrev > 0 && (
                            <View style={styles.sheetDetailRow}>
                              <Feather name="corner-up-right" size={13} color={colors.mutedForeground} />
                              <Text style={[styles.sheetDetailText, { color: colors.foreground }]}>
                                {formatMapKm(selectedStop.distanceKmFromPrev, distanceUnit)}
                                {selectedStop.estimatedMinutesFromPrev != null
                                  ? ` · about ${formatMapMinutes(selectedStop.estimatedMinutesFromPrev)} from the previous stop`
                                  : " from the previous stop"}
                              </Text>
                            </View>
                          )}
                          <View style={styles.sheetDetailRow}>
                            <Feather name={selectedStop.checkedInAt ? "check-circle" : "circle"} size={13} color={selectedStop.checkedInAt ? colors.primary : colors.mutedForeground} />
                            <Text style={[styles.sheetDetailText, { color: colors.foreground }]}>
                              {selectedStop.checkedInAt
                                ? `Checked in at ${new Date(selectedStop.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                                : "Not checked in yet"}
                            </Text>
                          </View>
                        </>
                      );
                    })()}
                  </View>
                )}

                <View style={styles.sheetActions}>
                  {selectedStop.kind === "prospect" && selectedStop.prospectId != null && (
                    <Pressable
                      style={[styles.sheetBtn, { backgroundColor: colors.muted, flex: 1 }]}
                      onPress={() => router.push({ pathname: "/prospect/[id]", params: { id: selectedStop.prospectId! } })}
                    >
                      <Feather name="user" size={14} color={colors.foreground} />
                      <Text style={[styles.sheetBtnText, { color: colors.foreground }]}>Profile</Text>
                    </Pressable>
                  )}
                  {selectedStop.kind !== "prospect" && selectedStop.customerId != null && (
                    <Pressable
                      style={[styles.sheetBtn, { backgroundColor: colors.muted, flex: 1 }]}
                      onPress={() => router.push({ pathname: "/customer/[id]", params: { id: selectedStop.customerId! } })}
                    >
                      <Feather name="user" size={14} color={colors.foreground} />
                      <Text style={[styles.sheetBtnText, { color: colors.foreground }]}>Profile</Text>
                    </Pressable>
                  )}

                  {selectedStop.kind === "custom" && !isPendingStopId(selectedStop.id) && (
                    <Pressable
                      style={[styles.sheetBtn, { backgroundColor: colors.muted, flex: 1 }]}
                      onPress={() =>
                        setMapEditTarget({
                          routeId: selectedStop.routeId,
                          stopId: selectedStop.id,
                          name: selectedStop.customerName ?? "",
                          address: selectedStop.customerAddress ?? null,
                        })
                      }
                      testID="map-edit-custom-stop"
                    >
                      <Feather name="edit-2" size={14} color={colors.foreground} />
                      <Text style={[styles.sheetBtnText, { color: colors.foreground }]}>Edit</Text>
                    </Pressable>
                  )}

                  {((selectedStop.lat != null && selectedStop.lng != null) || selectedStop.customerAddress) && (
                    <Pressable
                      style={[styles.sheetBtn, { backgroundColor: colors.muted, flex: 1 }]}
                      onPress={() => openDirections(selectedStop)}
                    >
                      <Feather name="navigation" size={14} color={colors.primary} />
                      <Text style={[styles.sheetBtnText, { color: colors.primary }]}>Directions</Text>
                    </Pressable>
                  )}

                  {!selectedStop.checkedInAt && canCheckIn && (
                    <Pressable
                      style={[styles.sheetBtn, { backgroundColor: colors.primary, flex: 1 }]}
                      onPress={handleCheckIn}
                      disabled={checkIn.isPending}
                    >
                      {checkIn.isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Feather name="check" size={14} color="#fff" />
                          <Text style={[styles.sheetBtnText, { color: "#fff" }]}>Check In</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </RNAnimated.View>

          <EditCustomStopModal
            target={mapEditTarget}
            onClose={() => setMapEditTarget(null)}
            onSaved={() => setSelectedStop(null)}
            colors={colors}
            insets={insets}
          />
        </>
      )}
    </View>
  );
}

export default function RoutesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentMember } = useAppAuth();
  const routeParams = useLocalSearchParams<{ date?: string | string[] }>();
  const requestedDate = Array.isArray(routeParams.date) ? routeParams.date[0] : routeParams.date;
  const [selectedDate, setSelectedDate] = useState(() =>
    isDateKey(requestedDate) ? requestedDate : dateKey(),
  );
  const [viewMode, setViewModeState] = useState<ViewMode>("today");

  useEffect(() => {
    if (isDateKey(requestedDate)) setSelectedDate(requestedDate);
  }, [requestedDate]);

  const selectDate = useCallback(
    (nextDate: string) => {
      setSelectedDate(nextDate);
      router.setParams({ date: nextDate });
    },
    [router],
  );

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_STORAGE_KEY)
      .then((stored) => {
        if (stored === "today" || stored === "list" || stored === "map") {
          setViewModeState(stored);
        }
      })
      .catch(() => {});
  }, []);

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    AsyncStorage.setItem(VIEW_MODE_STORAGE_KEY, mode).catch(() => {});
  };

  const repId = currentMember?.role === "rep" ? currentMember.id : undefined;
  const { data: serverRoutes, isLoading, refetch, isRefetching } = useListRoutes(
    repId ? { repId } : {}
  );
  const { pendingWrites } = useOffline();

  // Overlay any queued add-stop writes and pending check-ins so the rep sees
  // their changes immediately, regardless of which view (today / list / map).
  const allRoutes = React.useMemo(
    () => {
      if (!serverRoutes) return serverRoutes;
      const withAdds = applyPendingAddStops(serverRoutes, pendingWrites);
      const withEdits = applyPendingStopUpdates(withAdds, pendingWrites);
      const withDeletes = applyPendingDeletes(withEdits, pendingWrites);
      return applyPendingCheckIns(withDeletes, pendingWrites);
    },
    [serverRoutes, pendingWrites],
  );

  // Dated routes belong only to their selected day. Legacy undated routes stay
  // visible on the real current day so they are not stranded.
  const routes = React.useMemo(() => {
    if (!allRoutes) return allRoutes;
    const currentDate = dateKey();
    return allRoutes.filter(
      (route) =>
        route.routeDate === selectedDate ||
        (!route.routeDate && selectedDate === currentDate),
    );
  }, [allRoutes, selectedDate]);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const hasRoutes = routes && routes.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.screenHeader, { paddingTop: topPadding + 16, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>My Day</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {routes?.length ?? 0} route{routes?.length !== 1 ? "s" : ""} · {formatDayLabel(selectedDate)}
          </Text>
        </View>
        {hasRoutes && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {viewMode === "map" && (
              <Pressable
                onPress={() => refetch()}
                disabled={isRefetching}
                style={[styles.refreshBtn, { backgroundColor: colors.muted }]}
              >
                <Feather name="refresh-cw" size={13} color={isRefetching ? colors.mutedForeground : colors.primary} />
              </Pressable>
            )}
            <View style={[styles.toggleRow, { backgroundColor: colors.muted }]}>
              <Pressable
                style={[styles.toggleBtn, viewMode === "today" && { backgroundColor: colors.card }]}
                onPress={() => setViewMode("today")}
              >
                <Feather name="sun" size={14} color={viewMode === "today" ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.toggleBtnText, { color: viewMode === "today" ? colors.primary : colors.mutedForeground }]}>Day</Text>
              </Pressable>
              <Pressable
                style={[styles.toggleBtn, viewMode === "list" && { backgroundColor: colors.card }]}
                onPress={() => setViewMode("list")}
              >
                <Feather name="list" size={14} color={viewMode === "list" ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.toggleBtnText, { color: viewMode === "list" ? colors.primary : colors.mutedForeground }]}>List</Text>
              </Pressable>
              <Pressable
                style={[styles.toggleBtn, viewMode === "map" && { backgroundColor: colors.card }]}
                onPress={() => setViewMode("map")}
              >
                <Feather name="map" size={14} color={viewMode === "map" ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.toggleBtnText, { color: viewMode === "map" ? colors.primary : colors.mutedForeground }]}>Map</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.dateNavigator, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable
          style={[styles.dateArrowBtn, { backgroundColor: colors.muted }]}
          onPress={() => selectDate(addDaysToDateKey(selectedDate, -1))}
          accessibilityLabel="Previous day"
          testID="my-day-previous-date"
        >
          <Feather name="chevron-left" size={18} color={colors.foreground} />
        </Pressable>
        <Pressable
          style={styles.dateNavigatorLabel}
          onPress={() => selectDate(dateKey())}
          accessibilityLabel={
            selectedDate === dateKey()
              ? `Showing today, ${formatDayLabel(selectedDate)}`
              : `Showing ${formatDayLabel(selectedDate)}. Tap to return to today`
          }
          testID="my-day-selected-date"
        >
          <Feather name="calendar" size={15} color={colors.primary} />
          <View style={{ alignItems: "center" }}>
            <Text style={[styles.dateNavigatorText, { color: colors.foreground }]}>
              {formatDayLabel(selectedDate)}
            </Text>
            <Text style={[styles.dateNavigatorHint, { color: colors.mutedForeground }]}>
              {selectedDate === dateKey() ? "Today" : "Tap to return to today"}
            </Text>
          </View>
        </Pressable>
        <Pressable
          style={[styles.dateArrowBtn, { backgroundColor: colors.muted }]}
          onPress={() => selectDate(addDaysToDateKey(selectedDate, 1))}
          accessibilityLabel="Next day"
          testID="my-day-next-date"
        >
          <Feather name="chevron-right" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : viewMode === "today" ? (
        // The Today view is the merged "My Day" screen. It handles the
        // no-routes case itself (rendering the schedule, next-up banner,
        // work-location chips, add-stop entry, and the route-planning CTA),
        // so reps with service jobs but no customer route still see their day.
        <TodayView
          routes={routes ?? []}
          selectedDate={selectedDate}
          colors={colors}
          insets={insets}
          isRefetching={isRefetching}
          onRefresh={refetch}
        />
      ) : !hasRoutes ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingBottom: insets.bottom + 80 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        >
          <View style={styles.emptyState}>
            <Feather name="map" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No routes yet</Text>
            <Text style={[styles.emptyMsg, { color: colors.mutedForeground }]}>
              Plan your own visit route, or routes will appear here once your manager assigns them to you.
            </Text>
          </View>
          <PlanMyDayCard colors={colors} selectedDate={selectedDate} />
        </ScrollView>
      ) : viewMode === "map" ? (
        <RouteMapView routes={routes} selectedDate={selectedDate} colors={colors} insets={insets} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 80, paddingHorizontal: 16, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        >
          <NextStopBanner routes={routes} selectedDate={selectedDate} colors={colors} />
          <View style={styles.routeList}>
            {routes.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                colors={colors}
                allowCheckIn={selectedDate === dateKey()}
              />
            ))}
          </View>
        </ScrollView>
      )}
      <QuickLogFab bottomOffset={insets.bottom + 56} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dateNavigator: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateArrowBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  dateNavigatorLabel: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 8,
  },
  dateNavigatorText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  dateNavigatorHint: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    marginTop: 1,
  },
  // Per-day work-location selector (merged My Day feature).
  workLocCard: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12 },
  workLocHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  workLocTitle: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  workLocHint: { fontSize: 11, fontFamily: "Inter_500Medium" },
  workLocChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  workLocChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  workLocChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  workLocSitePicker: { marginTop: 10 },
  workLocSitePickerLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 6,
  },
  workLocLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  workLocLabelText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  // Day timeline (check in / heading out / end my day).
  timelineCard: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timelineDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  timelineBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: "center",
  },
  timelineBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  timelineDoneRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  timelineDoneText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  timelineUndo: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  // Field time & mileage summary card.
  fieldTimeCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  fieldTimeTitle: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  fieldTimeStatsRow: { flexDirection: "row", gap: 20, marginBottom: 12 },
  fieldTimeStat: { flexDirection: "row", alignItems: "center", gap: 6 },
  fieldTimeValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  fieldTimeLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  fieldTimeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 11,
  },
  fieldTimeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  // Log-mileage confirm dialog.
  mileageBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  mileageDialog: { borderWidth: 1, borderRadius: 16, padding: 20 },
  mileageDialogTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  mileageDialogSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 14 },
  mileageInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  mileageActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  mileageBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  mileageBtnPrimary: { borderWidth: 0 },
  mileageBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  // Next-up service/install job banner (merged My Day feature).
  nextBanner: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  nextLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  nextTitle: { color: "#fff", fontSize: 19, fontFamily: "Inter_700Bold", marginTop: 6, letterSpacing: -0.3 },
  nextSub: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 6 },
  nextDrivePill: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  nextDriveText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  nextNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingVertical: 11,
    borderRadius: 10,
    marginTop: 14,
  },
  nextNavText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 },
  // "Best route order" optimize button (merged My Day feature).
  optimizeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 11,
    marginBottom: 8,
  },
  optimizeBtnText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  // Merged service-day schedule sections.
  scheduleSection: { marginTop: 20 },
  scheduleSectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 2 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  toggleRow: { flexDirection: "row", borderRadius: 8, padding: 3, gap: 2 },
  toggleBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  toggleBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  refreshBtn: { width: 30, height: 30, borderRadius: 8, justifyContent: "center", alignItems: "center" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 60 },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptyMsg: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 260 },
  planCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 16, gap: 8, alignItems: "flex-start" },
  planTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 2 },
  planSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  planBtnRow: { flexDirection: "row", gap: 10, marginTop: 6, alignSelf: "stretch" },
  planPrimaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
  },
  planPrimaryBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  planSecondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  planSecondaryBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  nearbyTrayDock: { position: "absolute", left: 12, right: 12 },
  routeList: { gap: 12, marginTop: 12 },
  routeCard: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  routeHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  routeName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  routeMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  progressPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  progressText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  stopsList: { borderTopWidth: 1 },
  etaRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 4 },
  etaText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  stopRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  stopBadge: { width: 24, height: 24, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  stopBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  stopInfo: { flex: 1 },
  stopName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  stopAddr: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  checkedInLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  syncingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 3,
  },
  syncingPillText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  stopActions: { flexDirection: "row", gap: 6 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, justifyContent: "center", alignItems: "center" },
  checkInText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },
  emptyStops: { padding: 14, fontSize: 12, fontFamily: "Inter_400Regular" },
  nextStopBanner: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 4 },
  nextStopHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  nextStopDot: { width: 8, height: 8, borderRadius: 4 },
  nextStopLabel: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  etaPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99 },
  etaPillText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  nextStopName: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  nextStopAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 10 },
  nextStopActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  nextStopNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 10,
  },
  nextStopNavText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  nextStopBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  nextStopBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  mapPin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  mapPinText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  workLocMapPin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 5,
  },
  mapSummaryOverlay: {
    position: "absolute",
    left: 12,
    right: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  undoToast: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  undoToastText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  undoToastBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  undoToastBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  mapSummaryContent: { paddingHorizontal: 12, alignItems: "center" },
  mapSummaryItem: { paddingRight: 14, minWidth: 110 },
  mapSummaryHeader: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 },
  mapSummaryDot: { width: 8, height: 8, borderRadius: 4 },
  mapSummaryName: { fontSize: 11, fontFamily: "Inter_600SemiBold", maxWidth: 140 },
  mapSummaryTotal: { fontSize: 13, fontFamily: "Inter_700Bold" },
  mapSummaryRemaining: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 1 },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  sheetRouteName: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 2 },
  sheetCustomerName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sheetAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  sheetActions: { flexDirection: "row", gap: 8, marginBottom: 4 },
  sheetDetails: { borderTopWidth: 1, paddingTop: 12, marginBottom: 14, gap: 8 },
  sheetDetailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetDetailText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  sheetBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  sheetBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  todayHeader: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  todayDate: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  todayProgressRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  todayTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  todayPct: { fontSize: 16, fontFamily: "Inter_700Bold" },
  todaySub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  progressBarBg: { height: 8, borderRadius: 4, overflow: "hidden" },
  progressBarFill: { height: "100%", borderRadius: 4 },
  todayList: { gap: 10 },
  dragHint: { fontSize: 11, fontStyle: "italic", marginBottom: 8, marginTop: -4 },
  routeDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  routeDividerText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  todayCard: { borderRadius: 12, padding: 12, gap: 10, backgroundColor: "transparent" },
  todayCardTop: { flexDirection: "row", gap: 12 },
  todayBadge: { width: 28, height: 28, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  todayBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  todayCustomer: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  todayRouteName: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 1 },
  todayAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  todayMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  todayMetaPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99 },
  todayMetaText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  todayActions: { flexDirection: "row", gap: 8 },
  todayActionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  todayActionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12, gap: 12 },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  summaryIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: "center", alignItems: "center" },
  summaryEyebrow: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 1 },
  summaryTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  summaryShareBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  summaryShareText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  summaryStatsRow: { flexDirection: "row", alignItems: "center" },
  summaryStat: { flex: 1, alignItems: "center", gap: 2 },
  summaryStatValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryStatUnit: { fontSize: 11, fontFamily: "Inter_500Medium" },
  summaryStatLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  summaryDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", marginVertical: 4 },
  summaryFooter: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  summaryFooterItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  summaryFooterText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  todayHeaderTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  addStopBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: "flex-start" },
  addStopBtnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addStopBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: { flex: 1, marginTop: 60, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingHorizontal: 16 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalSection: { marginBottom: 12 },
  modalLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  routeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1 },
  routeChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  modalSearchBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  modalSearchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  modalHint: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 8 },
  modalRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  modalRowName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalRowMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  modalEmpty: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 32 },
});
