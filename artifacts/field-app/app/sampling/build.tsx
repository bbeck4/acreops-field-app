import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { router, Stack, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ApiError,
  assignSampleCode,
  claimSampleCode,
  createSamples,
  createSamplingZones,
  deleteSample,
  deleteSamplingZone,
  getGetSamplingPlanQueryKey,
  getListSamplingPlansQueryKey,
  updateSample,
  updateSamplingZone,
  useGetSamplingPlan,
  type Sample,
  type SamplingZone,
} from "@workspace/api-client-react";

import { SamplePointsMap, type SamplePoint } from "@/components/SamplePointsMap";
import { useColors } from "@/hooks/useColors";
import { useOffline, type SamplingAddPointPayload } from "@/context/OfflineContext";

const M_PER_DEG_LAT = 111320;
const ACRES_PER_SQ_M = 1 / 4046.8564224;

type LatLng = { lat: number; lng: number };

function hasCoords(s: Sample): s is Sample & { latitude: number; longitude: number } {
  return typeof s.latitude === "number" && typeof s.longitude === "number";
}

/** Build a buffered bounding-box polygon (GeoJSON) from one or more points. */
function polygonFromPoints(pts: LatLng[], bufferM = 40): { type: "Polygon"; coordinates: number[][][] } | null {
  if (pts.length === 0) return null;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const dLat = bufferM / M_PER_DEG_LAT;
  const cosLat = Math.cos((midLat * Math.PI) / 180) || 1;
  const dLng = bufferM / (M_PER_DEG_LAT * cosLat);
  minLat -= dLat;
  maxLat += dLat;
  minLng -= dLng;
  maxLng += dLng;
  const ring = [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ];
  return { type: "Polygon", coordinates: [ring] };
}

function polygonAcres(poly: { coordinates: number[][][] }): number {
  const ring = poly.coordinates[0];
  if (!ring || ring.length < 4) return 0;
  const lats = ring.map((c) => c[1]);
  const lngs = ring.map((c) => c[0]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180) || 1;
  const widthM = (Math.max(...lngs) - Math.min(...lngs)) * M_PER_DEG_LAT * cosLat;
  const heightM = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT;
  return Math.round(widthM * heightM * ACRES_PER_SQ_M * 100) / 100;
}

export default function BuildSamplingPlanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ planId?: string; pendingCode?: string }>();
  const planId = Number(params.planId);
  // A scanned pre-printed label handed off from the new-plan flow. It's claimed
  // onto the first point the rep drops, then cleared so later points get a
  // freshly generated bag ID as usual.
  const [pendingCode, setPendingCode] = useState<string | null>(
    params.pendingCode?.trim() ? params.pendingCode.replace(/\s+/g, "").toUpperCase() : null,
  );

  const { isOnline, queueWrite, triggerFlush, pendingWrites } = useOffline();

  const { data: plan, isLoading, refetch } = useGetSamplingPlan(planId, {
    query: {
      queryKey: getGetSamplingPlanQueryKey(planId),
      enabled: Number.isFinite(planId) && planId > 0,
    },
  });

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Sample | null>(null);
  const [showZoneModal, setShowZoneModal] = useState(false);

  const topPadding = Platform.OS === "web" ? insets.top + 67 : insets.top;

  const samples = useMemo(() => plan?.samples ?? [], [plan]);
  const zones = useMemo(() => plan?.zones ?? [], [plan]);
  const zoneName = useCallback(
    (zoneId?: number | null) => zones.find((z) => z.id === zoneId)?.name ?? null,
    [zones],
  );
  const sampleType = plan?.sampleTypes?.[0] ?? "soil";

  // Points dropped offline that are still waiting in the sync queue for this
  // plan. They're shown optimistically on the map/list so the rep sees their
  // work immediately, then disappear (replaced by real rows) once synced.
  const pendingAddPoints = useMemo(
    () =>
      pendingWrites.filter(
        (w): w is typeof w & { payload: SamplingAddPointPayload } =>
          w.type === "samplingAddPoint" &&
          !!w.payload &&
          typeof w.payload === "object" &&
          (w.payload as SamplingAddPointPayload).planId === planId,
      ),
    [pendingWrites, planId],
  );

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetSamplingPlanQueryKey(planId) });
    await queryClient.invalidateQueries({ queryKey: getListSamplingPlansQueryKey() });
  }, [planId, queryClient]);

  const captureLocation = useCallback(async (): Promise<LatLng | null> => {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Location needed", "Enable location access to drop a GPS-located sample point.");
      return null;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }, []);

  // Create a sample point at a specific location and assign it a bag ID.
  // Shared by the GPS ("my location") button and map-tap add.
  const createPointAt = useCallback(
    async (loc: LatLng) => {
      // Offline: queue the point through the sync queue instead of hitting the
      // server. It'll be created (and its bag ID claimed/assigned) on flush.
      if (!isOnline) {
        const payload: SamplingAddPointPayload = {
          planId,
          sampleType,
          latitude: loc.lat,
          longitude: loc.lng,
          // Sort after both saved points and points already queued this session.
          sortOrder: samples.length + pendingAddPoints.length,
          pendingCode: pendingCode ?? null,
        };
        await queueWrite("samplingAddPoint", payload);
        // The scanned label belongs to the first point only — clear it so later
        // offline points get a freshly generated bag ID on sync.
        if (pendingCode) setPendingCode(null);
        triggerFlush();
        return;
      }
      const created = await createSamples(planId, {
        samples: [
          {
            sampleType,
            locationType: "point",
            latitude: loc.lat,
            longitude: loc.lng,
            geometry: { type: "Point", coordinates: [loc.lng, loc.lat] },
            sortOrder: samples.length,
          },
        ],
      });
      const sample = created[0];
      // Bag ID is normally assigned on create; fall back if the server returned none.
      if (sample && !sample.trackingCode) {
        if (pendingCode) {
          try {
            await claimSampleCode(sample.id, { code: pendingCode });
          } catch {
            // Scanned label couldn't be bound (unknown/voided/taken) — fall back
            // to a generated bag ID so the point still gets a code.
            try {
              await assignSampleCode(sample.id);
            } catch {
              /* non-fatal — code can be assigned later */
            }
          } finally {
            setPendingCode(null);
          }
        } else {
          try {
            await assignSampleCode(sample.id);
          } catch {
            /* non-fatal — code can be assigned later */
          }
        }
      }
      await invalidate();
    },
    [
      isOnline,
      queueWrite,
      triggerFlush,
      pendingAddPoints.length,
      createSamples,
      invalidate,
      planId,
      pendingCode,
      sampleType,
      samples.length,
    ],
  );

  const addPoint = useCallback(async () => {
    if (adding) return;
    setAdding(true);
    try {
      const loc = await captureLocation();
      if (!loc) return;
      await createPointAt(loc);
    } catch (err) {
      Alert.alert(
        "Couldn't add point",
        err instanceof Error ? err.message : "Check your connection and try again.",
      );
    } finally {
      setAdding(false);
    }
  }, [adding, captureLocation, createPointAt]);

  // Map-tap add: drop a new point at the tapped location on the satellite layer.
  const addPointAtLocation = useCallback(
    async (lat: number, lng: number) => {
      if (adding) return;
      setAdding(true);
      try {
        await createPointAt({ lat, lng });
      } catch (err) {
        Alert.alert(
          "Couldn't add point",
          err instanceof Error ? err.message : "Check your connection and try again.",
        );
      } finally {
        setAdding(false);
      }
    },
    [adding, createPointAt],
  );

  // Recompute a zone's polygon from its current member points.
  const recomputeZoneGeometry = useCallback(
    async (zoneId: number, freshSamples: Sample[]) => {
      const members = freshSamples.filter((s) => s.zoneId === zoneId && hasCoords(s));
      if (members.length === 0) {
        // No points left in this zone — remove it so no stale polygon lingers.
        // (geometry is NOT NULL server-side, so it can't be cleared in place.)
        try {
          await deleteSamplingZone(zoneId);
        } catch {
          /* best-effort cleanup */
        }
        return;
      }
      const poly = polygonFromPoints(members.map((s) => ({ lat: s.latitude!, lng: s.longitude! })));
      if (!poly) return;
      try {
        await updateSamplingZone(zoneId, { geometry: poly, acres: polygonAcres(poly) });
      } catch {
        /* geometry refresh is best-effort */
      }
    },
    [],
  );

  const reassignZone = useCallback(
    async (sample: Sample, newZoneId: number | null) => {
      const oldZoneId = sample.zoneId ?? null;
      if (oldZoneId === newZoneId) return;
      try {
        await updateSample(sample.id, { zoneId: newZoneId });
        const res = await refetch();
        const fresh = res.data?.samples ?? [];
        if (oldZoneId != null) await recomputeZoneGeometry(oldZoneId, fresh);
        if (newZoneId != null) await recomputeZoneGeometry(newZoneId, fresh);
        await invalidate();
      } catch (err) {
        Alert.alert("Couldn't update zone", err instanceof Error ? err.message : "Try again.");
      }
    },
    [invalidate, recomputeZoneGeometry, refetch],
  );

  // Drag-to-move: persist the new location and refresh the point's zone polygon.
  const movePoint = useCallback(
    async (sampleId: number, lat: number, lng: number) => {
      // Un-synced offline points (negative ids) don't exist server-side yet, so
      // there's nothing to move; they'll land at their dropped spot on sync.
      if (sampleId < 0) {
        Alert.alert("Not synced yet", "This point will be saved when you're back online.");
        return;
      }
      const target = samples.find((s) => s.id === sampleId);
      try {
        await updateSample(sampleId, {
          latitude: lat,
          longitude: lng,
          geometry: { type: "Point", coordinates: [lng, lat] },
        });
        const res = await refetch();
        const fresh = res.data?.samples ?? [];
        const zoneId = target?.zoneId ?? null;
        if (zoneId != null) await recomputeZoneGeometry(zoneId, fresh);
        await invalidate();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // The point was regenerated/removed server-side — resync so the stale
          // marker disappears instead of leaving the rep dragging a phantom point.
          await invalidate();
          Alert.alert("Point no longer exists", "The map has been refreshed.");
        } else {
          Alert.alert("Couldn't move point", err instanceof Error ? err.message : "Try again.");
        }
      }
    },
    [invalidate, recomputeZoneGeometry, refetch, samples],
  );

  const deletePoint = useCallback(
    async (sample: Sample) => {
      const oldZoneId = sample.zoneId ?? null;
      try {
        await deleteSample(sample.id);
        const res = await refetch();
        const fresh = res.data?.samples ?? [];
        if (oldZoneId != null) await recomputeZoneGeometry(oldZoneId, fresh);
        await invalidate();
        setEditing(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          await invalidate();
          setEditing(null);
          Alert.alert("Point already removed", "The map has been refreshed.");
        } else {
          Alert.alert("Couldn't delete point", err instanceof Error ? err.message : "Try again.");
        }
      }
    },
    [invalidate, recomputeZoneGeometry, refetch],
  );

  const mapPoints = useMemo<SamplePoint[]>(() => {
    const ordered = samples
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const out: SamplePoint[] = [];
    ordered.forEach((s, idx) => {
      if (hasCoords(s)) {
        out.push({ id: s.id, lat: s.latitude, lng: s.longitude, index: idx + 1, selected: editing?.id === s.id });
      }
    });
    // Overlay points queued offline (negative ids mark them as un-synced so
    // movePoint can no-op on them — they don't exist server-side yet).
    pendingAddPoints.forEach((w, i) => {
      out.push({
        id: -(i + 1),
        lat: w.payload.latitude,
        lng: w.payload.longitude,
        index: out.length + 1,
        selected: false,
      });
    });
    return out;
  }, [samples, editing?.id, pendingAddPoints]);

  const startGuided = useCallback(() => {
    router.replace(`/sampling/guided?planId=${planId}` as never);
  }, [planId]);

  if (!Number.isFinite(planId) || planId <= 0) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: colors.foreground }}>Missing plan.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
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
            {plan?.name ?? "Build plan"}
          </Text>
          {plan?.fieldName ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {plan.fieldName}
            </Text>
          ) : null}
        </View>
        <View style={styles.iconBtn} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120, gap: 16 }}>
          <Pressable
            onPress={addPoint}
            disabled={adding}
            style={[styles.addBtn, { backgroundColor: colors.primary, opacity: adding ? 0.6 : 1 }]}
            testID="add-point-button"
          >
            {adding ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <>
                <Feather name="map-pin" size={18} color={colors.primaryForeground} />
                <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>
                  Add point at my location
                </Text>
              </>
            )}
          </Pressable>

          {mapPoints.length > 0 ? (
            <SamplePointsMap
              points={mapPoints}
              onSelectPoint={(id) => {
                const s = samples.find((x) => x.id === id);
                if (s) setEditing(s);
              }}
              onMovePoint={movePoint}
              onAddPoint={addPointAtLocation}
              primaryColor={colors.primary}
              borderColor={colors.border}
              cardColor={colors.card}
              mutedColor={colors.mutedForeground}
            />
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Sample points ({samples.length + pendingAddPoints.length})
            </Text>
          </View>

          {samples.length === 0 && pendingAddPoints.length === 0 ? (
            <View style={[styles.emptyCard, { borderColor: colors.border }]}>
              <Feather name="map-pin" size={26} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No points yet. Walk to a spot and tap “Add point at my location”.
              </Text>
            </View>
          ) : (
            <>
              {samples
                .slice()
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                .map((s, idx) => (
                  <Pressable
                    key={s.id}
                    onPress={() => setEditing(s)}
                    style={[styles.pointRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                    testID={`point-${s.id}`}
                  >
                    <View style={[styles.pointIndex, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.pointIndexText, { color: colors.primaryForeground }]}>{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pointTitle, { color: colors.foreground }]} numberOfLines={1}>
                        {s.label || s.trackingCode || "Sample point"}
                      </Text>
                      <Text style={[styles.pointMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {s.trackingCode ? `Bag ${s.trackingCode}` : "No bag ID"}
                        {s.soilDepth ? ` · ${s.soilDepth}` : ""}
                        {zoneName(s.zoneId) ? ` · ${zoneName(s.zoneId)}` : ""}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              {pendingAddPoints.map((w, i) => (
                <View
                  key={w.id}
                  style={[styles.pointRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                  testID={`pending-point-${i}`}
                >
                  <View style={[styles.pointIndex, { backgroundColor: colors.mutedForeground }]}>
                    <Text style={[styles.pointIndexText, { color: colors.primaryForeground }]}>
                      {samples.length + i + 1}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pointTitle, { color: colors.foreground }]} numberOfLines={1}>
                      Sample point
                    </Text>
                    <View style={styles.pendingBadgeRow}>
                      <Feather name="clock" size={11} color={colors.mutedForeground} />
                      <Text style={[styles.pointMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                        Pending sync
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </>
          )}

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Zones ({zones.length})</Text>
            <Pressable
              onPress={() => {
                if (samples.filter(hasCoords).length === 0) {
                  Alert.alert("Add points first", "Create at least one GPS point before grouping into a zone.");
                  return;
                }
                setShowZoneModal(true);
              }}
              style={styles.linkBtn}
              testID="new-zone-button"
            >
              <Feather name="plus" size={16} color={colors.primary} />
              <Text style={[styles.linkBtnText, { color: colors.primary }]}>New zone</Text>
            </Pressable>
          </View>

          {zones.length === 0 ? (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Optional: group points into named zones (e.g. “North half”).
            </Text>
          ) : (
            zones.map((z) => {
              const count = samples.filter((s) => s.zoneId === z.id).length;
              return (
                <View
                  key={z.id}
                  style={[styles.zoneRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                >
                  <Feather name="grid" size={16} color={colors.primary} />
                  <Text style={[styles.zoneName, { color: colors.foreground }]} numberOfLines={1}>
                    {z.name}
                  </Text>
                  <Text style={[styles.zoneCount, { color: colors.mutedForeground }]}>
                    {count} {count === 1 ? "point" : "points"}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <View
        style={[
          styles.footer,
          { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 },
        ]}
      >
        <Pressable
          onPress={startGuided}
          disabled={samples.length === 0}
          style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: samples.length === 0 ? 0.5 : 1 }]}
          testID="start-guided-button"
        >
          <Feather name="navigation" size={18} color={colors.primaryForeground} />
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
            Start guided sampling
          </Text>
        </Pressable>
      </View>

      <PointEditModal
        sample={editing}
        zones={zones}
        sampleType={sampleType}
        onClose={() => setEditing(null)}
        onSavedDetails={invalidate}
        onReassignZone={reassignZone}
        onDelete={deletePoint}
      />

      <NewZoneModal
        visible={showZoneModal}
        planId={planId}
        samples={samples.filter(hasCoords)}
        zoneNameForSample={zoneName}
        onClose={() => setShowZoneModal(false)}
        onCreated={async (zone, memberIds) => {
          const res = await refetch();
          const fresh = res.data?.samples ?? [];
          await recomputeZoneGeometry(zone.id, fresh);
          await invalidate();
          setShowZoneModal(false);
          void memberIds;
        }}
      />
    </View>
  );
}

function PointEditModal({
  sample,
  zones,
  sampleType,
  onClose,
  onSavedDetails,
  onReassignZone,
  onDelete,
}: {
  sample: Sample | null;
  zones: SamplingZone[];
  sampleType: string;
  onClose: () => void;
  onSavedDetails: () => Promise<void> | void;
  onReassignZone: (sample: Sample, zoneId: number | null) => Promise<void>;
  onDelete: (sample: Sample) => Promise<void>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState("");
  const [soilDepth, setSoilDepth] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Remount per point so inputs reset to the selected sample's values.
  const key = sample?.id ?? "none";

  React.useEffect(() => {
    setLabel(sample?.label ?? "");
    setSoilDepth(sample?.soilDepth ?? "");
  }, [sample?.id]);

  if (!sample) return null;

  const save = async () => {
    setSaving(true);
    try {
      await updateSample(sample.id, {
        label: label.trim() ? label.trim() : null,
        soilDepth: soilDepth.trim() ? soilDepth.trim() : null,
      });
      await onSavedDetails();
      onClose();
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete this point?",
      sample.trackingCode
        ? `Bag ${sample.trackingCode} will be removed from the plan.`
        : "This sample point will be removed from the plan.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await onDelete(sample);
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Modal key={key} visible animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
            {sample.trackingCode ? `Bag ${sample.trackingCode}` : "Sample point"}
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
            <View style={{ gap: 6 }}>
              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Label (optional)</Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. NE corner"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              />
            </View>

            {sampleType === "soil" ? (
              <View style={{ gap: 6 }}>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Soil depth (optional)</Text>
                <TextInput
                  value={soilDepth}
                  onChangeText={setSoilDepth}
                  placeholder='e.g. 0-6"'
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                />
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Zone</Text>
              <View style={styles.chipRow}>
                <Pressable
                  onPress={() => onReassignZone(sample, null)}
                  style={[
                    styles.chip,
                    {
                      borderColor: sample.zoneId == null ? colors.primary : colors.border,
                      backgroundColor: sample.zoneId == null ? colors.primary : colors.card,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: sample.zoneId == null ? colors.primaryForeground : colors.foreground }]}>
                    Ungrouped
                  </Text>
                </Pressable>
                {zones.map((z) => {
                  const on = sample.zoneId === z.id;
                  return (
                    <Pressable
                      key={z.id}
                      onPress={() => onReassignZone(sample, z.id)}
                      style={[
                        styles.chip,
                        { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.card },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: on ? colors.primaryForeground : colors.foreground }]}>
                        {z.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={[styles.repositionNote, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Feather name="move" size={14} color={colors.mutedForeground} />
              <Text style={[styles.repositionNoteText, { color: colors.mutedForeground }]}>
                To reposition, drag this point on the map above.
              </Text>
            </View>

            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              style={[styles.deleteBtn, { borderColor: colors.destructive, opacity: deleting ? 0.6 : 1 }]}
              testID="delete-point-button"
            >
              {deleting ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <Feather name="trash-2" size={16} color={colors.destructive} />
              )}
              <Text style={[styles.deleteBtnText, { color: colors.destructive }]}>Delete point</Text>
            </Pressable>
          </ScrollView>

          <View style={styles.sheetActions}>
            <Pressable onPress={onClose} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Done</Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={saving}
              style={[styles.primaryBtn, { flex: 1, backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Save details</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NewZoneModal({
  visible,
  planId,
  samples,
  zoneNameForSample,
  onClose,
  onCreated,
}: {
  visible: boolean;
  planId: number;
  samples: Sample[];
  zoneNameForSample: (zoneId?: number | null) => string | null;
  onClose: () => void;
  onCreated: (zone: SamplingZone, memberIds: number[]) => Promise<void> | void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setName("");
      setSelected(new Set());
    }
  }, [visible]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    const memberIds = [...selected];
    if (!name.trim() || memberIds.length === 0) return;
    setSaving(true);
    try {
      const members = samples.filter((s) => selected.has(s.id) && s.latitude != null && s.longitude != null);
      const poly = polygonFromPoints(members.map((s) => ({ lat: s.latitude!, lng: s.longitude! })));
      if (!poly) {
        Alert.alert("Couldn't build zone", "Selected points have no GPS coordinates.");
        return;
      }
      const zones = await createSamplingZones(planId, {
        zones: [
          {
            name: name.trim(),
            zoneType: "zone",
            source: "drawn",
            geometry: poly,
            acres: polygonAcres(poly),
          },
        ],
      });
      const zone = zones[0];
      if (zone) {
        await Promise.all(memberIds.map((id) => updateSample(id, { zoneId: zone.id })));
        await onCreated(zone, memberIds);
      }
    } catch (err) {
      Alert.alert("Couldn't create zone", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const canCreate = name.trim().length > 0 && selected.size > 0 && !saving;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>New zone</Text>

          <View style={{ gap: 6, marginBottom: 12 }}>
            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Zone name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. North half"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              autoFocus
            />
          </View>

          <Text style={[styles.inputLabel, { color: colors.mutedForeground, marginBottom: 6 }]}>
            Include points ({selected.size} selected)
          </Text>
          <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 8 }}>
            {samples.map((s) => {
              const on = selected.has(s.id);
              const existing = zoneNameForSample(s.zoneId);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => toggle(s.id)}
                  style={[
                    styles.checkRow,
                    { borderColor: on ? colors.primary : colors.border, backgroundColor: colors.card },
                  ]}
                >
                  <Feather
                    name={on ? "check-square" : "square"}
                    size={18}
                    color={on ? colors.primary : colors.mutedForeground}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pointTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {s.label || s.trackingCode || "Sample point"}
                    </Text>
                    {existing ? (
                      <Text style={[styles.pointMeta, { color: colors.mutedForeground }]}>Currently in {existing}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.sheetActions, { marginTop: 12 }]}>
            <Pressable onPress={onClose} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={create}
              disabled={!canCreate}
              style={[styles.primaryBtn, { flex: 1, backgroundColor: colors.primary, opacity: canCreate ? 1 : 0.5 }]}
            >
              {saving ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Create zone</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 12,
  },
  addBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  note: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  emptyCard: {
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  emptyText: { fontSize: 14, textAlign: "center", fontFamily: "Inter_400Regular" },
  pointRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pointIndex: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  pointIndexText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  pointTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  pointMeta: { fontSize: 12, marginTop: 2, fontFamily: "Inter_400Regular" },
  pendingBadgeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  zoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  zoneName: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  zoneCount: { fontSize: 13, fontFamily: "Inter_400Regular" },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 12,
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 12,
    maxHeight: "88%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(127,127,127,0.4)",
  },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  sheetActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  secondaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  repositionNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  repositionNoteText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
  },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  inputLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
});
