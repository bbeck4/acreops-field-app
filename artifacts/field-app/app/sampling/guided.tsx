import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ApiError,
  assignSampleCode,
  claimSampleCode,
  getGetSamplingPlanQueryKey,
  getListSamplingPlansQueryKey,
  updateSample,
  useGetSamplingPlan,
  type Sample,
  type SamplingPlanDetail,
} from "@workspace/api-client-react";

import { EmptyState } from "@/components/EmptyState";
import { useOffline } from "@/context/OfflineContext";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type Region } from "@/components/MapShim";
import { MapTypeToggle, type MapType } from "@/components/MapTypeToggle";
import { haversineKm } from "@/components/NearbyTray";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { useColors } from "@/hooks/useColors";
import {
  isSampleCollected as isCollected,
  pointInGeometry,
  sampleHasCoords as hasCoords,
} from "@/lib/sampling";
import { openNavigation } from "@/lib/navigation";
import { formatDistance, useDistanceUnit } from "@/lib/units";

type LatLng = { latitude: number; longitude: number };

// A pull within this radius of the active point reads as "you're standing on it".
// Kept generous (vs. the collect screen's 10 ft re-home threshold) so normal GPS
// jitter still trips the positive "locked in" indicator as the rep arrives.
const LOCK_RADIUS_FT = 25;
const KM_TO_FT = 3280.84;

/** Initial bearing in degrees (0–360) from point `a` to point `b`. */
function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(toRad(b.latitude));
  const x =
    Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) -
    Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function compassLabel(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8];
}

/** Average of a set of coordinates — good enough to center the map on a field. */
function centroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (acc, p) => ({ latitude: acc.latitude + p.latitude, longitude: acc.longitude + p.longitude }),
    { latitude: 0, longitude: 0 },
  );
  return { latitude: sum.latitude / points.length, longitude: sum.longitude / points.length };
}


export default function GuidedSamplingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const distanceUnit = useDistanceUnit();
  const queryClient = useQueryClient();
  const { isOnline } = useOffline();
  const params = useLocalSearchParams<{ planId?: string }>();
  const planId = parseInt(params.planId ?? "0", 10);

  const { data: plan, isLoading, refetch } = useGetSamplingPlan(planId, {
    query: { enabled: !!planId, queryKey: getGetSamplingPlanQueryKey(planId) },
  });

  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [manualActiveId, setManualActiveId] = useState<number | null>(null);
  const [currentZoneId, setCurrentZoneId] = useState<number | null | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [mapType, setMapType] = useState<MapType>("hybrid");
  const mapRef = useRef<unknown>(null);

  // Live-track the device so distance/bearing and the next-point suggestion stay current.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: 4000 },
        (pos) => setUserLoc({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      );
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  // Re-pull plan whenever we return from the collect screen so a freshly collected
  // point drops out of the suggestion list and the flow auto-advances.
  useFocusEffect(
    useCallback(() => {
      if (planId) void refetch();
    }, [planId, refetch]),
  );

  const samples = plan?.samples ?? [];
  const zones = plan?.zones ?? [];
  const zoneName = useCallback(
    (zoneId: number | null | undefined) =>
      zones.find((z) => z.id === zoneId)?.name ?? (zoneId ? `Zone ${zoneId}` : "Unzoned"),
    [zones],
  );

  const located = useMemo(() => samples.filter(hasCoords), [samples]);
  const uncollected = useMemo(
    () => located.filter((s) => !isCollected(s.status)),
    [located],
  );
  const collectedCount = samples.length - samples.filter((s) => !isCollected(s.status)).length;

  // Suggested next point: nearest uncollected, preferring the zone we're already working
  // (so a zone is finished before moving on), then the nearest point in any other zone.
  const suggestedId = useMemo(() => {
    if (uncollected.length === 0) return null;
    const byDist = (a: Sample, b: Sample) => {
      if (!userLoc) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      return (
        haversineKm({ lat: userLoc.latitude, lng: userLoc.longitude }, { lat: a.latitude!, lng: a.longitude! }) -
        haversineKm({ lat: userLoc.latitude, lng: userLoc.longitude }, { lat: b.latitude!, lng: b.longitude! })
      );
    };
    if (currentZoneId !== undefined) {
      const inZone = uncollected.filter((s) => (s.zoneId ?? null) === currentZoneId).sort(byDist);
      if (inZone.length > 0) return inZone[0].id;
    }
    return [...uncollected].sort(byDist)[0].id;
  }, [uncollected, userLoc, currentZoneId]);

  // The active point is a manual override if still valid+uncollected, else the suggestion.
  const activeSample = useMemo(() => {
    if (manualActiveId != null) {
      const m = located.find((s) => s.id === manualActiveId);
      if (m && !isCollected(m.status)) return m;
    }
    return located.find((s) => s.id === suggestedId) ?? null;
  }, [manualActiveId, suggestedId, located]);

  // Keep "current zone" anchored to whatever point is active so auto-advance stays in-zone.
  useEffect(() => {
    if (activeSample) setCurrentZoneId(activeSample.zoneId ?? null);
  }, [activeSample]);

  const activeLatLng = activeSample && hasCoords(activeSample)
    ? { latitude: activeSample.latitude, longitude: activeSample.longitude }
    : null;

  const distanceToActive =
    userLoc && activeLatLng
      ? haversineKm(
          { lat: userLoc.latitude, lng: userLoc.longitude },
          { lat: activeLatLng.latitude, lng: activeLatLng.longitude },
        )
      : null;
  const bearingToActive = userLoc && activeLatLng ? bearingDeg(userLoc, activeLatLng) : null;

  // Positive "you're on the spot" signal: the rep is standing inside the active
  // point's arrival radius, or anywhere inside its sampling-zone polygon. The
  // zone test backs up GPS drift on large zones where the exact point can be off.
  const activeZone = useMemo(
    () => (activeSample ? zones.find((z) => z.id === activeSample.zoneId) ?? null : null),
    [activeSample, zones],
  );
  const lockedIn = useMemo(() => {
    if (!userLoc || !activeSample) return false;
    const withinPoint =
      distanceToActive != null && distanceToActive * KM_TO_FT <= LOCK_RADIUS_FT;
    const withinZone = activeZone ? pointInGeometry(userLoc, activeZone.geometry) : false;
    return withinPoint || withinZone;
  }, [userLoc, activeSample, distanceToActive, activeZone]);

  const fieldCenter = useMemo<LatLng | null>(() => {
    const pts = located.map((s) => ({ latitude: s.latitude!, longitude: s.longitude! }));
    return (
      centroid(pts) ??
      (plan?.customerLat != null && plan?.customerLng != null
        ? { latitude: plan.customerLat, longitude: plan.customerLng }
        : null)
    );
  }, [located, plan]);

  const initialRegion = useMemo<Region | undefined>(() => {
    const c = fieldCenter ?? userLoc;
    if (!c) return undefined;
    return { latitude: c.latitude, longitude: c.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 };
  }, [fieldCenter, userLoc]);

  const openDirectionsToField = useCallback(() => {
    if (!fieldCenter) {
      return;
    }
    void openNavigation({
      lat: fieldCenter.latitude,
      lng: fieldCenter.longitude,
      label: plan?.fieldName ?? "Field",
    });
  }, [fieldCenter, plan]);

  const openDirectionsToPoint = useCallback(() => {
    if (!activeLatLng) return;
    const label = activeSample?.label || activeSample?.trackingCode || "Sample point";
    void openNavigation({ lat: activeLatLng.latitude, lng: activeLatLng.longitude, label });
  }, [activeLatLng, activeSample]);

  const [generatingCode, setGeneratingCode] = useState(false);

  const collectActive = useCallback(() => {
    if (!activeSample?.trackingCode) return;
    setManualActiveId(null);
    router.push(
      `/sampling/collect?code=${encodeURIComponent(activeSample.trackingCode)}&from=guided` as never,
    );
  }, [activeSample]);

  // No pre-printed QR/bag label for this point? Generate a serial on the spot so
  // the crew can hand-write it on a blank bag, then collect as usual. The code is
  // assigned server-side (guarantees uniqueness), so this needs a connection.
  const generateBagId = useCallback(async () => {
    if (!activeSample || activeSample.trackingCode) return;
    setGeneratingCode(true);
    try {
      const updated = await assignSampleCode(activeSample.id);
      await queryClient.invalidateQueries({
        queryKey: getGetSamplingPlanQueryKey(planId),
        exact: false,
      });
      await refetch();
      Alert.alert(
        "Bag ID created",
        `Write "${updated.trackingCode}" on the sample bag, then collect this point.`,
      );
    } catch (err) {
      Alert.alert(
        "Couldn't create a bag ID",
        err instanceof Error ? err.message : "Check your connection and try again.",
      );
    } finally {
      setGeneratingCode(false);
    }
  }, [activeSample, planId, queryClient, refetch]);

  const handleScanned = useCallback(
    async (code: string) => {
      setScanOpen(false);
      const trimmed = code.replace(/\s+/g, "").toUpperCase();
      if (!trimmed) return;
      // If the active point has no bag code yet, bind the scanned pre-printed
      // label to it so the crew can collect it straight away. If the code is
      // unknown or already used elsewhere, claim-code rejects and we fall
      // through — the collect screen then resolves/handles the scanned code.
      if (activeSample && !activeSample.trackingCode) {
        try {
          await claimSampleCode(activeSample.id, { code: trimmed });
          setManualActiveId(null);
          await queryClient.invalidateQueries({
            queryKey: getGetSamplingPlanQueryKey(planId),
            exact: false,
          });
          await refetch();
        } catch {
          /* not bindable to this point — let collect resolve the code */
        }
      }
      router.push(`/sampling/collect?code=${encodeURIComponent(trimmed)}&from=guided` as never);
    },
    [activeSample, planId, queryClient, refetch],
  );

  const selectPoint = useCallback((s: Sample) => {
    setManualActiveId(s.id);
    setCurrentZoneId(s.zoneId ?? null);
    setPickerOpen(false);
  }, []);

  // Bumping this remounts every marker at its server coordinate, snapping a
  // dragged pin back when a move can't be saved (react-native-maps keeps the
  // dragged position otherwise, since the coordinate value is unchanged).
  const [revertNonce, setRevertNonce] = useState(0);

  // Drag-to-move: persist the nudged location, mirroring the plan builder and
  // the web SamplingMap. On any failure the pin reverts to where the server
  // last confirmed it.
  const movePoint = useCallback(
    async (sample: Sample, lat: number, lng: number) => {
      if (!isOnline) {
        setRevertNonce((n) => n + 1);
        Alert.alert(
          "You're offline",
          "Moving a sample point needs a connection. Try again once you're back online.",
        );
        return;
      }
      try {
        await updateSample(sample.id, {
          latitude: lat,
          longitude: lng,
          geometry: { type: "Point", coordinates: [lng, lat] },
        });
        await refetch();
        queryClient.invalidateQueries({ queryKey: getListSamplingPlansQueryKey(), exact: false });
      } catch (err) {
        // Snap the pin back to the server-confirmed position.
        setRevertNonce((n) => n + 1);
        if (err instanceof ApiError && err.status === 404) {
          await refetch();
          Alert.alert("Point no longer exists", "The map has been refreshed.");
        } else {
          Alert.alert("Couldn't move point", err instanceof Error ? err.message : "Try again.");
        }
      }
    },
    [isOnline, refetch, queryClient],
  );

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;
  const allDone = samples.length > 0 && uncollected.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <BarcodeScanner
        visible={scanOpen}
        title="Scan sample bag"
        hint="Point at the QR or barcode on the bag label"
        onClose={() => setScanOpen(false)}
        onScanned={handleScanned}
      />

      <View
        style={[
          styles.topBar,
          { paddingTop: topPadding + 8, borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-button">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {plan?.name ?? "Guided sampling"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {plan?.fieldName ?? (plan ? `Field ${plan.fieldId}` : "Loading…")}
            {samples.length ? ` · ${collectedCount}/${samples.length} collected` : ""}
          </Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !plan ? (
        <EmptyState
          icon="alert-circle"
          title="Plan not found"
          subtitle="This sampling plan couldn't be loaded. It may have been removed."
        />
      ) : located.length === 0 ? (
        <EmptyState
          icon="map-pin"
          title="No located points"
          subtitle="This plan has no sample points with coordinates yet. Drop points on the web planner first."
        />
      ) : (
        <>
          <View style={styles.mapWrap}>
            <MapView
              ref={mapRef as never}
              style={StyleSheet.absoluteFill}
              provider={PROVIDER_DEFAULT}
              mapType={mapType}
              initialRegion={initialRegion}
              showsUserLocation
            >
              {located.map((s) => {
                const done = isCollected(s.status);
                const active = s.id === activeSample?.id;
                const activeLocked = active && lockedIn;
                const color = done
                  ? "#16a34a"
                  : activeLocked
                    ? "#16a34a"
                    : active
                      ? colors.primary
                      : "#64748b";
                return (
                  <Marker
                    key={`${s.id}-${revertNonce}`}
                    coordinate={{ latitude: s.latitude!, longitude: s.longitude! }}
                    onPress={() => selectPoint(s)}
                    title={s.label || s.trackingCode || `Sample ${s.id}`}
                    draggable
                    onDragEnd={(e: {
                      nativeEvent?: { coordinate?: { latitude: number; longitude: number } };
                    }) => {
                      const c = e?.nativeEvent?.coordinate;
                      if (c && typeof c.latitude === "number" && typeof c.longitude === "number") {
                        void movePoint(s, c.latitude, c.longitude);
                      }
                    }}
                  >
                    <View
                      style={[
                        styles.pin,
                        {
                          backgroundColor: color,
                          borderColor: activeLocked ? "#bbf7d0" : "#fff",
                          transform: [{ scale: active ? 1.25 : 1 }],
                        },
                      ]}
                    >
                      {done ? (
                        <Feather name="check" size={12} color="#fff" />
                      ) : activeLocked ? (
                        <Feather name="target" size={13} color="#fff" />
                      ) : (
                        <View style={styles.pinDot} />
                      )}
                    </View>
                  </Marker>
                );
              })}
              {userLoc && activeLatLng ? (
                <Polyline
                  coordinates={[userLoc, activeLatLng]}
                  strokeColor={lockedIn ? "#16a34a" : colors.primary}
                  strokeWidth={3}
                  lineDashPattern={[6, 6]}
                />
              ) : null}
            </MapView>

            <MapTypeToggle value={mapType} onChange={setMapType} style={styles.mapTypeBtn} />

            <Pressable
              onPress={openDirectionsToField}
              style={[styles.fieldBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <MaterialCommunityIcons name="navigation-variant-outline" size={16} color={colors.primary} />
              <Text style={[styles.fieldBtnText, { color: colors.foreground }]}>Directions to field</Text>
            </Pressable>

            <View
              pointerEvents="none"
              style={[styles.moveHint, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name="move" size={12} color={colors.primary} />
              <Text style={[styles.moveHintText, { color: colors.foreground }]}>
                Press and hold a pin to move it
              </Text>
            </View>
          </View>

          <ScrollView
            style={[styles.sheet, { backgroundColor: colors.background, borderTopColor: colors.border }]}
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 12 }}
          >
            {allDone ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.doneRow}>
                  <Feather name="check-circle" size={20} color="#16a34a" />
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>All points collected</Text>
                </View>
                <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                  Every sample in this plan is marked collected. Head back to choose another field.
                </Text>
                <Pressable
                  onPress={() => router.back()}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                    Back to plans
                  </Text>
                </Pressable>
              </View>
            ) : activeSample ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {lockedIn ? (
                  <View style={[styles.lockBanner, { backgroundColor: "#16a34a" }]}>
                    <Feather name="check-circle" size={16} color="#fff" />
                    <Text style={styles.lockBannerText}>
                      {activeZone && userLoc && pointInGeometry(userLoc, activeZone.geometry)
                        ? "You're inside the sampling zone — collect here."
                        : "You're on the point — collect here."}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.activeHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.eyebrow, { color: colors.primary }]}>NEXT SAMPLE</Text>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {activeSample.label || activeSample.trackingCode || `Sample ${activeSample.id}`}
                    </Text>
                    <Text style={[styles.muted, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {zoneName(activeSample.zoneId)}
                      {activeSample.sampleType ? ` · ${activeSample.sampleType}` : ""}
                    </Text>
                  </View>
                  {distanceToActive != null ? (
                    <View style={styles.distancePill}>
                      <Text style={[styles.distanceValue, { color: colors.foreground }]}>
                        {formatDistance(distanceToActive, distanceUnit)}
                      </Text>
                      {bearingToActive != null ? (
                        <Text style={[styles.distanceDir, { color: colors.mutedForeground }]}>
                          {compassLabel(bearingToActive)} ↗
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>

                {/* The tracking code doubles as the write-down id for bags with no printed label. */}
                {activeSample.trackingCode ? (
                  <View style={[styles.codeBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>
                        Bag ID — write on the bag if it has no printed label
                      </Text>
                      <Text style={[styles.codeValue, { color: colors.foreground }]}>
                        {activeSample.trackingCode}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="barcode" size={26} color={colors.mutedForeground} />
                  </View>
                ) : (
                  <View style={[styles.codeBox, { borderColor: colors.warning, backgroundColor: colors.warningBackground }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>
                        No bag ID yet
                      </Text>
                      <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                        No pre-printed label? Generate a serial to write on a blank bag.
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="barcode" size={26} color={colors.mutedForeground} />
                  </View>
                )}

                <View style={styles.btnRow}>
                  <Pressable
                    onPress={openDirectionsToPoint}
                    style={[styles.secondaryBtn, { borderColor: colors.primary, flex: 1 }]}
                  >
                    <Feather name="navigation" size={15} color={colors.primary} />
                    <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>To point</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setScanOpen(true)}
                    style={[styles.secondaryBtn, { borderColor: colors.primary, flex: 1 }]}
                  >
                    <Feather name="maximize" size={15} color={colors.primary} />
                    <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Scan bag</Text>
                  </Pressable>
                </View>

                {activeSample.trackingCode ? (
                  <Pressable
                    onPress={collectActive}
                    style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                  >
                    <Feather name="check" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                      Collect this sample
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={generateBagId}
                    disabled={generatingCode || !isOnline}
                    style={[
                      styles.primaryBtn,
                      { backgroundColor: colors.primary, opacity: generatingCode || !isOnline ? 0.6 : 1 },
                    ]}
                  >
                    {generatingCode ? (
                      <ActivityIndicator color={colors.primaryForeground} />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="barcode" size={16} color={colors.primaryForeground} />
                        <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                          Generate bag ID
                        </Text>
                      </>
                    )}
                  </Pressable>
                )}
                {!activeSample.trackingCode && !isOnline ? (
                  <Text style={[styles.muted, { color: colors.mutedForeground, textAlign: "center" }]}>
                    Connect to the internet to generate a bag ID.
                  </Text>
                ) : null}

                <Pressable onPress={() => setPickerOpen((v) => !v)} style={styles.overrideToggle}>
                  <Feather name={pickerOpen ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
                  <Text style={[styles.overrideText, { color: colors.mutedForeground }]}>
                    {pickerOpen ? "Hide points" : "Choose a different field point"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {(pickerOpen || (!activeSample && !allDone)) && !allDone ? (
              <PointPicker
                zones={zones}
                samples={located}
                activeId={activeSample?.id ?? null}
                userLoc={userLoc}
                distanceUnit={distanceUnit}
                colors={colors}
                onSelect={selectPoint}
              />
            ) : null}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function PointPicker({
  zones,
  samples,
  activeId,
  userLoc,
  distanceUnit,
  colors,
  onSelect,
}: {
  zones: SamplingPlanDetail["zones"];
  samples: Sample[];
  activeId: number | null;
  userLoc: LatLng | null;
  distanceUnit: ReturnType<typeof useDistanceUnit>;
  colors: ReturnType<typeof useColors>;
  onSelect: (s: Sample) => void;
}) {
  // Group points by zone so the rep can override the suggested field point per zone.
  const groups = useMemo(() => {
    const byZone = new Map<number | null, Sample[]>();
    for (const s of samples) {
      const key = s.zoneId ?? null;
      if (!byZone.has(key)) byZone.set(key, []);
      byZone.get(key)!.push(s);
    }
    return Array.from(byZone.entries()).map(([zoneId, list]) => ({
      zoneId,
      name: (zones ?? []).find((z) => z.id === zoneId)?.name ?? (zoneId ? `Zone ${zoneId}` : "Unzoned"),
      list: list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    }));
  }, [samples, zones]);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
      {groups.map((g) => {
        const remaining = g.list.filter((s) => !isCollected(s.status)).length;
        return (
          <View key={String(g.zoneId)} style={{ gap: 6 }}>
            <Text style={[styles.zoneHeader, { color: colors.mutedForeground }]}>
              {g.name} · {remaining}/{g.list.length} left
            </Text>
            {g.list.map((s) => {
              const done = isCollected(s.status);
              const active = s.id === activeId;
              const dist =
                userLoc && hasCoords(s)
                  ? formatDistance(haversineKm({ lat: userLoc.latitude, lng: userLoc.longitude }, { lat: s.latitude, lng: s.longitude }), distanceUnit)
                  : null;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => onSelect(s)}
                  disabled={done}
                  style={[
                    styles.pointRow,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary + "14" : colors.background,
                      opacity: done ? 0.55 : 1,
                    },
                  ]}
                >
                  <Feather
                    name={done ? "check-circle" : active ? "navigation" : "map-pin"}
                    size={15}
                    color={done ? "#16a34a" : active ? colors.primary : colors.mutedForeground}
                  />
                  <Text style={[styles.pointLabel, { color: colors.foreground }]} numberOfLines={1}>
                    {s.label || s.trackingCode || `Sample ${s.id}`}
                  </Text>
                  {dist ? <Text style={[styles.pointDist, { color: colors.mutedForeground }]}>{dist}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  iconBtn: { padding: 4 },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  mapWrap: { flex: 1, position: "relative" },
  fieldBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  fieldBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  mapTypeBtn: { position: "absolute", top: 12, left: 12 },
  moveHint: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  moveHintText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  pin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  pinDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  sheet: {
    maxHeight: "52%",
    borderTopWidth: 1,
  },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  muted: { fontSize: 13, fontFamily: "Inter_400Regular" },
  activeHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  eyebrow: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 2 },
  distancePill: { alignItems: "flex-end" },
  distanceValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  distanceDir: { fontSize: 12, fontFamily: "Inter_500Medium" },
  codeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  codeLabel: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 2 },
  codeValue: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  btnRow: { flexDirection: "row", gap: 10 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
  },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 13,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  overrideToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 2 },
  overrideText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  lockBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lockBannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  zoneHeader: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.4 },
  pointRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  pointLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  pointDist: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
